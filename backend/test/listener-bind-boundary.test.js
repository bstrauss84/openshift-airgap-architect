/**
 * AUTH-01 — the listening socket, not the configuration that describes it.
 *
 * THE DEFECT THIS FILE EXISTS FOR. `backend/src/accessControl.js` refused
 * `OAA_AUTH_MODE=disabled` with a non-loopback `BIND_ADDRESS`, and
 * `backend/src/index.js` then called `app.listen(port)` with NO host. Node,
 * given no host, binds the unspecified address — `::`, every interface. So
 * the guard validated an environment variable that nothing consumed, and
 * unauthenticated mode passed its own loopback check while serving the whole
 * network.
 *
 * `backend/test/access-control-boundary.test.js` could not have caught this:
 * it asserts on `assertAccessControlConfig()`, which is exactly the half that
 * was already right. The only test that distinguishes "configured loopback"
 * from "bound to loopback" is one that starts the real server and tries to
 * CONNECT from somewhere else.
 *
 * So this file spawns `src/index.js` as a real process and makes real TCP
 * connections to a real non-loopback interface address on this machine. No
 * mocks, no middleware harness, no assertion about a string.
 *
 * WHAT IT CANNOT COVER, STATED RATHER THAN IMPLIED. The container exception
 * (`OAA_CONTAINER_NETWORK=isolated`) is proven here only in its REFUSING
 * direction, because this test host is not a container. The accepting
 * direction is a unit test with an injected probe in
 * access-control-boundary.test.js, plus the podman run recorded in the wave's
 * handoff. A test cannot conjure a container network namespace it is not in.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "index.js");
const DATA_DIR = path.join(os.tmpdir(), "oaa-listener-bind-boundary");
const SECRET = "z".repeat(40);

/**
 * A routable address of this machine that is NOT loopback.
 *
 * This is the whole point of the file: `127.0.0.1` would succeed under either
 * the broken and the fixed behaviour. Without such an interface the
 * distinguishing test cannot be run at all, and saying so is better than
 * passing vacuously.
 */
function nonLoopbackAddress() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

const LAN = nonLoopbackAddress();

/** Start the real server; resolve with its parsed startup record. */
function startServer(env, { expectExit = false, timeoutMs = 25000 } = {}) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      NODE_ENV: expectExit ? "test" : "production",
      MOCK_MODE: "true",
      LOG_FORMAT: "json",
      DATA_DIR,
      PORT: "0",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));

  return new Promise((resolve, reject) => {
    const done = (v) => {
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`server did not ${expectExit ? "exit" : "start"} in ${timeoutMs}ms\n${stdout}\n${stderr}`));
    }, timeoutMs);

    child.on("exit", (code) => done({ child, code, stdout, stderr, startup: null }));

    child.stdout.on("data", () => {
      if (expectExit) return;
      for (const line of stdout.split("\n")) {
        if (!line.startsWith("{")) continue;
        let rec = null;
        try {
          rec = JSON.parse(line);
        } catch {
          continue;
        }
        if (rec.tag === "startup" && rec.msg === "Server started") {
          done({ child, code: null, get stdout() { return stdout; }, get stderr() { return stderr; }, startup: rec });
          return;
        }
      }
    });
  });
}

/** Raw TCP reachability. No HTTP client, no retries, no ambiguity. */
function tcpConnect(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const finish = (result) => {
      sock.destroy();
      resolve(result);
    };
    sock.setTimeout(timeoutMs, () => finish({ connected: false, error: "ETIMEDOUT" }));
    sock.on("connect", () => finish({ connected: true, error: null }));
    sock.on("error", (err) => finish({ connected: false, error: err.code || err.message }));
  });
}

async function httpGet(host, port, requestPath) {
  const res = await fetch(`http://${host}:${port}${requestPath}`);
  return { status: res.status, body: await res.text() };
}

const running = new Set();
const track = (r) => {
  if (r.child && r.code === null) running.add(r.child);
  return r;
};
after(() => {
  for (const c of running) c.kill("SIGKILL");
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

describe("AUTH-01 — unauthenticated mode is bound to loopback, not merely configured for it", () => {
  it("binds 127.0.0.1 and REFUSES a connection to this host's own network interface", async (t) => {
    if (!LAN) {
      t.diagnostic("no non-loopback IPv4 interface on this host; the distinguishing case cannot be exercised");
      return;
    }
    const s = track(await startServer({ OAA_AUTH_MODE: "disabled" }));
    const port = s.startup.boundPort;

    // The socket, as the kernel sees it.
    assert.equal(s.startup.boundAddress, "127.0.0.1", "the server must bind loopback, not the unspecified address");
    assert.equal(s.startup.loopbackOnly, true);

    // The service really is up on loopback — otherwise the refusal below
    // would prove nothing but that nothing is listening anywhere.
    const health = await httpGet("127.0.0.1", port, "/api/health");
    assert.equal(health.status, 200, "the app must still serve the local developer");

    // The defect, directly: before the fix this connected.
    const lan = await tcpConnect(LAN, port);
    assert.equal(lan.connected, false, `an unauthenticated API answered on ${LAN}:${port}`);
    assert.equal(lan.error, "ECONNREFUSED");

    s.child.kill("SIGTERM");
  });

  it("does not quietly bind the IPv6 unspecified address either", async (t) => {
    // `app.listen(port)` bound `::`, which is dual-stack: it accepted IPv4
    // traffic too. An IPv6-only assertion would have missed the real exposure,
    // so this checks the address family that was actually wrong.
    const s = track(await startServer({ OAA_AUTH_MODE: "disabled" }));
    assert.notEqual(s.startup.boundAddress, "::");
    assert.notEqual(s.startup.boundAddress, "0.0.0.0");
    s.child.kill("SIGTERM");
  });

  it("REFUSES TO START when asked to bind a network interface without the container declaration", async () => {
    const s = await startServer({ OAA_AUTH_MODE: "disabled", BIND_ADDRESS: "0.0.0.0" }, { expectExit: true });
    assert.notEqual(s.code, 0, "a refusal that still starts the server is not a refusal");
    assert.match(s.stderr, /refuses to start bound to "0\.0\.0\.0"/);
  });

  it("REFUSES the container declaration on a host that is not a container", async () => {
    // The declaration is not a magic word. This test runs on a bare host, so
    // the corroborating evidence is absent and the process must still refuse —
    // which is what stops the realistic accident of lifting these lines out of
    // docker-compose.yml into a systemd unit.
    const s = await startServer(
      { OAA_AUTH_MODE: "disabled", BIND_ADDRESS: "0.0.0.0", OAA_CONTAINER_NETWORK: "isolated" },
      { expectExit: true }
    );
    assert.notEqual(s.code, 0);
    assert.match(s.stderr, /NOT running inside a container/);
  });
});

describe("AUTH-01 — authenticated mode is reachable, and still refuses an anonymous caller", () => {
  it("binds every interface in proxy mode BUT answers 401 to a caller that skipped the proxy", async (t) => {
    if (!LAN) {
      t.diagnostic("no non-loopback IPv4 interface on this host");
      return;
    }
    // proxy mode must bind the pod's interfaces — a loopback bind there would
    // make the backend unreachable from the frontend pod. What protects it is
    // identity, and this proves identity is what answers on the wire.
    const s = track(
      await startServer({
        OAA_AUTH_MODE: "proxy",
        OAA_PROXY_SHARED_SECRET: SECRET,
        OAA_ALLOWED_ORIGINS: "https://airgap-architect.apps.example.com",
      })
    );
    const port = s.startup.boundPort;
    assert.equal(s.startup.boundAddress, "0.0.0.0");
    assert.equal(s.startup.loopbackOnly, false);

    const lan = await tcpConnect(LAN, port);
    assert.equal(lan.connected, true, "the backend Service must be reachable in the deployed topology");

    const anon = await httpGet(LAN, port, "/api/state");
    assert.equal(anon.status, 401, "a request that reached the port directly must not be served");
    assert.match(anon.body, /PROXY_AUTH_REQUIRED/);

    // A probe endpoint stays open on purpose: the kubelet carries no identity.
    const probe = await httpGet(LAN, port, "/api/health");
    assert.equal(probe.status, 200);

    s.child.kill("SIGTERM");
  });
});
