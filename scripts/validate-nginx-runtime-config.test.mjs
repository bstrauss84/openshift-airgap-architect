/**
 * AUTH-03 / AUTH-05 — what the frontend container actually serves, and where.
 *
 * These run the REAL renderer (`frontend/container/oaa-render-nginx.sh`) over
 * the REAL template, with fixture inputs, and then test the result two ways:
 *
 *   1. by BINDING SOCKETS to the listen directives it produced and connecting
 *      to them from this host's own non-loopback interface address, which is
 *      the bypass the authenticated topology must refuse;
 *   2. by asserting the exact resolver directive emitted from a given
 *      resolv.conf.
 *
 * WHY SOCKETS AND NOT A GREP. The defect was not a missing string. It was that
 * `listen 5173` on every interface made nginx — which forwards the caller's
 * X-Forwarded-User and attaches the backend's shared secret — reachable from
 * any pod that could reach the pod IP, so an unauthenticated request came out
 * the other side authenticated. A test that greps for `127.0.0.1` passes on a
 * config that also still listens on `[::]`, which is exactly how the original
 * block was written. Binding what was rendered and then trying to connect from
 * elsewhere is the property, not the spelling.
 *
 * WHAT THESE TESTS ARE NOT. nginx is not installed in this environment, so
 * this exercises the socket semantics of the directives the renderer emits,
 * not nginx's own parsing of them. `nginx -t` runs at image build time over
 * the same rendered output (frontend/Containerfile), and the wave's handoff
 * records a real nginx run under podman with this config. Neither this file
 * nor those proves anything about a cluster.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const RENDER = path.join(REPO_ROOT, "frontend", "container", "oaa-render-nginx.sh");
const TEMPLATE = path.join(REPO_ROOT, "frontend", "container", "nginx-oaa.conf.template");
const ENTRYPOINT = path.join(REPO_ROOT, "frontend", "container", "oaa-entrypoint.sh");

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-nginx-render-"));
after(() => fs.rmSync(WORK, { recursive: true, force: true }));

/** A real non-loopback address of this machine, or null. */
function nonLoopbackAddress() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return null;
}
const LAN = nonLoopbackAddress();

let seq = 0;
/** Render the real template with the real script. Throws with stderr on failure. */
function render(env, { resolvConf = "nameserver 172.30.0.10\n" } = {}) {
  const id = `r${seq++}`;
  const resolvPath = path.join(WORK, `${id}.resolv.conf`);
  const outPath = path.join(WORK, `${id}.conf`);
  fs.writeFileSync(resolvPath, resolvConf);
  const stdout = execFileSync("bash", [RENDER, TEMPLATE, outPath], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, OAA_RESOLV_CONF: resolvPath, ...env },
  });
  return { conf: fs.readFileSync(outPath, "utf8"), stdout, outPath };
}

function renderFails(env, opts) {
  try {
    render(env, opts);
  } catch (err) {
    return String(err.stderr || err.message);
  }
  return null;
}

/**
 * Every `listen` directive in a server block, as { host, port }.
 *
 * Deliberately parses the whole file rather than looking for one line: the
 * original defect was a second `listen [::]:5173` sitting under the first.
 */
function listenDirectives(conf) {
  const out = [];
  for (const raw of conf.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#") || !line.startsWith("listen")) continue;
    const spec = line.replace(/^listen\s+/, "").replace(/;.*$/, "").trim();
    const v6 = /^\[([^\]]+)\]:(\d+)$/.exec(spec);
    if (v6) {
      out.push({ host: v6[1], port: Number(v6[2]) });
      continue;
    }
    const v4 = /^([0-9.]+):(\d+)$/.exec(spec);
    if (v4) {
      out.push({ host: v4[1], port: Number(v4[2]) });
      continue;
    }
    const bare = /^(\d+)$/.exec(spec);
    if (bare) out.push({ host: "*", port: Number(bare[1]) });
  }
  return out;
}

/**
 * Bind the rendered directives for real, on an ephemeral port.
 *
 * `ipv6Only` mirrors nginx: a `listen [::]:port` there defaults to
 * `ipv6only=on` and gets its own socket, which is why the template can carry
 * both families on one port. Node's default is dual-stack, which would make
 * the second bind EADDRINUSE and quietly turn this into a one-socket test.
 */
async function bindAs(directives, port) {
  const servers = [];
  for (const d of directives) {
    const host = d.host === "*" ? undefined : d.host;
    const server = net.createServer((s) => {
      // The client destroys on connect; without this the reset surfaces as an
      // unhandled 'error' and fails the test for the wrong reason.
      s.on("error", () => {});
      s.end("ok");
    });
    server.on("error", () => {});
    await new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      server.once("error", onError);
      const done = () => {
        server.removeListener("error", onError);
        resolve();
      };
      if (host === undefined) server.listen(port, done);
      else server.listen({ port, host, ipv6Only: host.includes(":") }, done);
    });
    servers.push(server);
  }
  return {
    close: () => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))),
  };
}

function tcpConnect(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const finish = (v) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs, () => finish({ connected: false, error: "ETIMEDOUT" }));
    sock.on("connect", () => finish({ connected: true, error: null }));
    sock.on("error", (e) => finish({ connected: false, error: e.code || e.message }));
  });
}

/** An ephemeral port nothing is using, so the bind test is deterministic. */
async function freePort() {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const { port } = probe.address();
  await new Promise((r) => probe.close(r));
  return port;
}

const PROXY_ENV = {
  OAA_NGINX_LISTEN_ADDRESS: "127.0.0.1",
  OAA_REQUIRE_PROXY_SECRET: "1",
  OAA_PROXY_SHARED_SECRET: "s".repeat(44),
  OAA_BACKEND_ORIGIN: "http://airgap-architect-backend:4000",
};

const COMPOSE_ENV = {
  OAA_BACKEND_ORIGIN: "http://airgap-architect-backend:4000",
};

describe("AUTH-03 — the authenticated topology serves 5173 on loopback only", () => {
  test("renders loopback listen directives for BOTH address families", () => {
    // oauth-proxy's upstream is the NAME `localhost`, which can resolve to ::1
    // first. A 127.0.0.1-only bind would have been a working bypass fix and a
    // broken deployment.
    const { conf } = render(PROXY_ENV);
    const app = listenDirectives(conf).filter((d) => d.port === 5173);
    assert.deepEqual(
      app.map((d) => d.host).sort(),
      ["127.0.0.1", "::1"],
      "the serving port must be bound on loopback only, in both families"
    );
  });

  test("a socket bound as rendered REFUSES this host's own interface address", async (t) => {
    if (!LAN) {
      t.diagnostic("no non-loopback IPv4 interface; the distinguishing case cannot be exercised");
      return;
    }
    const { conf } = render(PROXY_ENV);
    const port = await freePort();
    const app = listenDirectives(conf).filter((d) => d.port === 5173);
    const bound = await bindAs(app, port);
    try {
      const local = await tcpConnect("127.0.0.1", port);
      assert.equal(local.connected, true, "the oauth-proxy sidecar reaches nginx over loopback and must still work");

      const bypass = await tcpConnect(LAN, port);
      assert.equal(bypass.connected, false, `an unauthenticated nginx answered on ${LAN}:${port}`);
      assert.equal(bypass.error, "ECONNREFUSED");
    } finally {
      await bound.close();
    }
  });

  test("the OLD directives are what this test would have caught", async (t) => {
    if (!LAN) {
      t.diagnostic("no non-loopback IPv4 interface");
      return;
    }
    // Pin the regression explicitly: bind the pre-fix shape and show the
    // bypass connects. Without this, a future change that reverted the
    // renderer could leave the test above passing against nothing.
    const port = await freePort();
    const bound = await bindAs([{ host: "*", port: 5173 }], port);
    try {
      const bypass = await tcpConnect(LAN, port);
      assert.equal(bypass.connected, true, "`listen 5173` was reachable from the pod IP — that was the defect");
    } finally {
      await bound.close();
    }
  });

  test("the probe listener stays reachable from off-host, and serves only /healthz", async (t) => {
    const { conf } = render(PROXY_ENV);
    const probe = listenDirectives(conf).filter((d) => d.port === 8081);
    assert.ok(probe.length > 0, "a loopback-bound app port needs a probe port the kubelet can reach");
    assert.deepEqual(probe.map((d) => d.host).sort(), ["0.0.0.0", "::"]);

    // It must not be a second way in: no proxying, no identity, no secret, no
    // static root inside that server block.
    const block = conf.slice(conf.lastIndexOf("server {"));
    assert.match(block, /location = \/healthz/);
    assert.doesNotMatch(block, /proxy_pass/);
    assert.doesNotMatch(block, /X-Forwarded-User/);
    assert.doesNotMatch(block, /X-OAA-Proxy-Auth/);
    assert.doesNotMatch(block, /try_files/);

    if (!LAN) {
      t.diagnostic("no non-loopback IPv4 interface; reachability half skipped");
      return;
    }
    const port = await freePort();
    const bound = await bindAs(probe, port);
    try {
      const fromLan = await tcpConnect(LAN, port);
      assert.equal(fromLan.connected, true, "the kubelet connects to the pod IP; a loopback probe port never goes Ready");
    } finally {
      await bound.close();
    }
  });

  test("forwards the identity headers oauth-proxy OWNS, and clears the one it does not", () => {
    // openshift/oauth-proxy replaces X-Forwarded-User / -Email via
    // setRequestHeader (strip, then set). It never touches
    // X-Forwarded-Groups, so a forwarded group claim would be the caller's
    // own words wearing the proxy's credential.
    const { conf } = render(PROXY_ENV);
    assert.match(conf, /proxy_set_header\s+X-Forwarded-User\s+\$http_x_forwarded_user;/);
    assert.match(conf, /proxy_set_header\s+X-Forwarded-Groups\s+"";/);
    assert.doesNotMatch(conf, /X-Forwarded-Groups\s+\$http_x_forwarded_groups;/);
  });

  test("REFUSES to render a non-loopback listen address in the authenticated topology", () => {
    const err = renderFails({ ...PROXY_ENV, OAA_NGINX_LISTEN_ADDRESS: "0.0.0.0" });
    assert.ok(err, "rendering must fail, not warn");
    assert.match(err, /OAA_REQUIRE_PROXY_SECRET is set/);
    assert.match(err, /proxied as an authenticated one/);
  });

  test("REFUSES an arbitrary listen address rather than writing it into the config", () => {
    const err = renderFails({ ...COMPOSE_ENV, OAA_NGINX_LISTEN_ADDRESS: "10.0.0.5" });
    assert.match(String(err), /must be 127\.0\.0\.1 or 0\.0\.0\.0/);
  });
});

describe("AUTH-03 — local Compose is unchanged", () => {
  test("defaults to every interface, because the container boundary is the boundary there", async (t) => {
    const { conf } = render(COMPOSE_ENV);
    const app = listenDirectives(conf).filter((d) => d.port === 5173);
    assert.deepEqual(app.map((d) => d.host).sort(), ["0.0.0.0", "::"]);

    if (!LAN) {
      t.diagnostic("no non-loopback IPv4 interface");
      return;
    }
    // A published port forwards to the CONTAINER's address, so a loopback
    // bind here would break `podman compose up` outright.
    const port = await freePort();
    const bound = await bindAs(app, port);
    try {
      const reachable = await tcpConnect(LAN, port);
      assert.equal(reachable.connected, true, "Compose publishes the container's address; this must stay reachable");
    } finally {
      await bound.close();
    }
  });

  test("keeps the streaming and large-download contract in the /api block", () => {
    // SSE job logs and multi-GB bundle downloads both go through here. These
    // are the directives that make them work; the AUTH-03 change moves the
    // listen address and must not have disturbed them.
    for (const env of [COMPOSE_ENV, PROXY_ENV]) {
      const { conf } = render(env);
      assert.match(conf, /proxy_buffering\s+off;/);
      assert.match(conf, /proxy_cache\s+off;/);
      assert.match(conf, /proxy_read_timeout\s+3600s;/);
      assert.match(conf, /client_max_body_size\s+0;/);
      assert.match(conf, /proxy_request_buffering off;/);
      assert.match(conf, /proxy_http_version\s+1\.1;/);
    }
  });

  test("renders no unsubstituted placeholder, and no secret when none is given", () => {
    const { conf } = render(COMPOSE_ENV);
    assert.doesNotMatch(conf, /OAA_LISTEN_DIRECTIVES|OAA_RESOLVER_DIRECTIVE/);
    assert.doesNotMatch(conf, /"OAA_BACKEND_ORIGIN"|"OAA_PROXY_SHARED_SECRET"/);
    assert.match(conf, /X-OAA-Proxy-Auth\s+"";/, "no secret configured must render an empty header, not a placeholder");
  });

  test("the secret is never printed by the renderer", () => {
    const { stdout } = render(PROXY_ENV);
    assert.doesNotMatch(stdout, new RegExp(PROXY_ENV.OAA_PROXY_SHARED_SECRET));
    assert.match(stdout, /proxyAuth=configured/);
  });
});

describe("AUTH-05 — the resolver comes from the pod, not from a guess", () => {
  test("uses the nameserver in resolv.conf, which on OpenShift is the dns-default ClusterIP", () => {
    const { conf } = render(PROXY_ENV, {
      resolvConf: "search ns.svc.cluster.local svc.cluster.local cluster.local\nnameserver 172.30.0.10\noptions ndots:5\n",
    });
    assert.match(conf, /^\s*resolver\s+172\.30\.0\.10 valid=30s ipv6=off;$/m);
  });

  test("NEVER emits the kube-dns name that does not exist on OpenShift", () => {
    // The original default. OpenShift's cluster DNS Service is `dns-default`
    // in `openshift-dns`; nginx resolves a named resolver through the SYSTEM
    // resolver at config load, so this one name is the one that cannot be
    // looked up, and the pod CrashLoopBackOffs rather than degrading.
    // Directive lines only. The comments in the template and in this file
    // name the old value on purpose, so that the next reader knows what was
    // wrong; what must never reappear is a line nginx executes.
    const directivesOnly = (text) =>
      text
        .split("\n")
        .filter((l) => !l.trim().startsWith("#"))
        .join("\n");

    for (const env of [COMPOSE_ENV, PROXY_ENV]) {
      assert.doesNotMatch(directivesOnly(render(env).conf), /kube-dns/);
    }
    assert.doesNotMatch(directivesOnly(fs.readFileSync(TEMPLATE, "utf8")), /kube-dns/);
    assert.doesNotMatch(directivesOnly(fs.readFileSync(ENTRYPOINT, "utf8")), /kube-dns/);
  });

  test("brackets IPv6 nameservers, as nginx requires", () => {
    const { conf } = render(PROXY_ENV, { resolvConf: "nameserver fd02::a\nnameserver 172.30.0.10\n" });
    assert.match(conf, /resolver\s+\[fd02::a\] 172\.30\.0\.10 valid=30s ipv6=off;/);
  });

  test("ignores comments, search/options lines and duplicates", () => {
    const { conf } = render(PROXY_ENV, {
      resolvConf: [
        "# generated by the kubelet",
        "; another comment style",
        "search svc.cluster.local",
        "nameserver 10.96.0.10",
        "nameserver 10.96.0.10",
        "options ndots:5 timeout:1",
        "",
      ].join("\n"),
    });
    assert.match(conf, /resolver\s+10\.96\.0\.10 valid=30s ipv6=off;/);
  });

  test("caps the list rather than emitting an unbounded directive", () => {
    const { conf } = render(PROXY_ENV, {
      resolvConf: ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"].map((n) => `nameserver ${n}`).join("\n"),
    });
    assert.match(conf, /resolver\s+1\.1\.1\.1 2\.2\.2\.2 3\.3\.3\.3 valid=30s ipv6=off;/);
  });

  test("an explicit override still wins, because some distributions differ", () => {
    const { conf } = render({ ...PROXY_ENV, OAA_NGINX_RESOLVER: "10.43.0.10" });
    assert.match(conf, /resolver\s+10\.43\.0\.10 valid=30s ipv6=off;/);
  });

  test("FAILS CLOSED when resolv.conf has nothing usable, instead of shipping a broken proxy", () => {
    const err = renderFails(PROXY_ENV, { resolvConf: "search svc.cluster.local\noptions ndots:5\n" });
    assert.ok(err, "a config with no resolver cannot serve /api; it must not be installed");
    assert.match(err, /no usable 'nameserver' entry/);
  });

  test("rejects a resolv.conf line that is not an address", () => {
    const err = renderFails(PROXY_ENV, { resolvConf: "nameserver dns-default.openshift-dns.svc\n" });
    assert.match(String(err), /no usable 'nameserver' entry/);
  });
});

describe("the entrypoint and the image build use this renderer", () => {
  test("the entrypoint delegates rather than carrying its own copy of the logic", () => {
    const entry = fs.readFileSync(ENTRYPOINT, "utf8");
    assert.match(entry, /oaa-render-nginx\.sh/);
    assert.doesNotMatch(entry, /^\s*NGINX_RESOLVER=/m, "the resolver default must not be duplicated here");
  });

  test("the image build validates the RENDERED config with the same script", () => {
    const cf = fs.readFileSync(path.join(REPO_ROOT, "frontend", "Containerfile"), "utf8");
    assert.match(cf, /oaa-render-nginx\.sh/);
    assert.match(cf, /nginx -t/);
    assert.match(cf, /COPY[^\n]*oaa-render-nginx\.sh/);
  });
});
