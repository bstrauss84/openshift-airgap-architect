import { test } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, "..");
const configureHref = pathToFileURL(join(backendRoot, "src", "configureFetchProxy.js")).href;

/** Isolated process: undici global dispatcher after configureFetchProxy import. */
function dispatcherNameAfterConfigure(extraEnv) {
  const code = `
import { getGlobalDispatcher } from "undici";
await import(${JSON.stringify(configureHref)});
console.log(getGlobalDispatcher().constructor.name);
`;
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["--input-type=module", "-e", code], {
      cwd: backendRoot,
      env: {
        PATH: process.env.PATH || "/usr/bin:/bin",
        NODE_ENV: "test",
        ...extraEnv
      }
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err || out || `exit ${code}`));
      else resolve(out.trim());
    });
  });
}

test("configureFetchProxy: installs a proxy-routing dispatcher by default", async () => {
  // Asserted as "not the plain Agent" rather than by exact class name. The
  // dispatcher is now CidrAwareEnvHttpProxyAgent, a thin wrapper that
  // delegates everything it does not special-case to a real
  // EnvHttpProxyAgent; pinning the class name would have made a routing
  // improvement look like a regression while testing nothing about routing.
  // The behaviour that matters is covered below with a live loopback proxy.
  const name = await dispatcherNameAfterConfigure({});
  assert.notStrictEqual(name, "Agent", "a proxy-routing dispatcher must be installed");
  assert.match(name, /ProxyAgent$/, `unexpected dispatcher: ${name}`);
});

test("configureFetchProxy: AIRGAP_FETCH_USE_ENV_PROXY=false leaves default Agent", async () => {
  const name = await dispatcherNameAfterConfigure({ AIRGAP_FETCH_USE_ENV_PROXY: "false" });
  assert.strictEqual(name, "Agent");
});

test("configureFetchProxy: AIRGAP_FETCH_USE_ENV_PROXY=0 leaves default Agent", async () => {
  const name = await dispatcherNameAfterConfigure({ AIRGAP_FETCH_USE_ENV_PROXY: "0" });
  assert.strictEqual(name, "Agent");
});

test("configureFetchProxy: explicit true still installs the proxy dispatcher", async () => {
  const name = await dispatcherNameAfterConfigure({ AIRGAP_FETCH_USE_ENV_PROXY: "true" });
  assert.notStrictEqual(name, "Agent");
  assert.match(name, /ProxyAgent$/, `unexpected dispatcher: ${name}`);
});

/**
 * NO_PROXY routing, exercised for real.
 *
 * undici matches NO_PROXY by exact hostname and dot-suffix only, so a CIDR
 * entry was stored as a literal hostname and could never match — while the
 * `oc`/`oc-mirror` this backend spawns inherit the same environment and DO
 * honour CIDRs via Go's x/net/http/httpproxy. One variable, two routing
 * behaviours inside one container, with the product's own guidance telling
 * operators to put cluster/service/machine CIDRs in NO_PROXY.
 *
 * Hermetic: a loopback listener stands in for the proxy, so a connection on
 * it means PROXIED and no connection means DIRECT. No external network and
 * no DNS — hostname cases use `.invalid`, IP cases use port 65000 with
 * nothing listening. Port 1 must NOT be used: fetch's bad-port list rejects
 * it before dispatch, which would make every case look DIRECT and pass
 * vacuously.
 */
test("configureFetchProxy: NO_PROXY routing matches the spawned Go tools", async () => {
  const net = await import("node:net");
  const { CidrAwareEnvHttpProxyAgent } = await import(configureHref);

  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const proxyPort = listener.address().port;
  let hits = 0;
  let announceHit = () => {};
  listener.on("connection", (socket) => {
    hits += 1;
    announceHit();
    socket.destroy();
  });

  const route = async (noProxy, target) => {
    hits = 0;
    const previousProxy = process.env.HTTP_PROXY;
    const previousNoProxy = process.env.NO_PROXY;
    process.env.HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;
    if (noProxy === null) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = noProxy;
    const agent = new CidrAwareEnvHttpProxyAgent();
    // Settle as soon as the listener is hit, rather than waiting out a fixed
    // timeout. A PROXIED verdict is then detected the instant the connection
    // lands and never depends on how loaded the machine is — a fixed 700ms
    // bound was measured flaky (1 failure in 3 runs), because the abort could
    // fire before the proxy connection completed and a PROXIED case would be
    // misread as DIRECT. Only the DIRECT cases wait, and only to confirm that
    // nothing arrives.
    const hit = new Promise((resolve) => { announceHit = () => resolve("PROXIED"); });
    const settled = fetch(target, { dispatcher: agent, signal: AbortSignal.timeout(600) })
      .then(() => null, () => null);
    await Promise.race([hit, settled]);
    announceHit = () => {};
    // destroy(), not close(). close() drains in-flight sockets, and the cases
    // that route DIRECT to a deliberately unroutable address leave one hanging
    // until the OS gives up — measured at ~10s each, which dominated the whole
    // file. The verdict has already been decided by the race above, so the
    // connection is of no further interest and is torn down immediately.
    await agent.destroy().catch(() => {});
    if (previousProxy === undefined) delete process.env.HTTP_PROXY;
    else process.env.HTTP_PROXY = previousProxy;
    if (previousNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = previousNoProxy;
    return hits > 0 ? "PROXIED" : "DIRECT";
  };

  try {
    // Baseline: without NO_PROXY everything goes to the proxy. If this ever
    // reports DIRECT the fixture is broken and every case below is vacuous.
    assert.strictEqual(await route(null, "http://10.128.0.5:65000/"), "PROXIED", "baseline");

    // The defect.
    assert.strictEqual(await route("10.0.0.0/8", "http://10.128.0.5:65000/"), "DIRECT", "IPv4 CIDR");
    assert.strictEqual(await route("127.0.0.1/32", "http://127.0.0.1:65000/"), "DIRECT", "/32 CIDR");
    assert.strictEqual(await route("fd00::/8", "http://[fd00::5]:65000/"), "DIRECT", "IPv6 CIDR");
    assert.strictEqual(
      await route(".svc,.cluster.local,10.0.0.0/8,172.30.0.0/16", "http://10.128.0.5:65000/"),
      "DIRECT",
      "OpenShift-style list"
    );

    // Guards against over-matching. A false bypass sends a request that was
    // meant for the proxy straight out instead, which in an airgapped
    // deployment is worse than the original bug.
    assert.strictEqual(await route("172.30.0.0/16", "http://10.128.0.5:65000/"), "PROXIED", "non-matching CIDR");
    assert.strictEqual(
      await route("10.0.0.0/8", "http://registry.internal.invalid/"),
      "PROXIED",
      "a CIDR must not match a hostname — Go does not resolve DNS to route, nor do we"
    );
    assert.strictEqual(
      await route("10.0.0.0/8", "http://[fd00::5]:65000/"),
      "PROXIED",
      "v4 CIDR must never match a v6 host"
    );

    // Pre-existing undici behaviour must be untouched.
    assert.strictEqual(await route("10.128.0.5", "http://10.128.0.5:65000/"), "DIRECT", "exact IP");
    assert.strictEqual(
      await route(".internal.invalid", "http://registry.internal.invalid/"),
      "DIRECT",
      "dot-suffix"
    );
  } finally {
    listener.close();
  }
});
