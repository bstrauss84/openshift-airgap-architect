/**
 * Proxy URL userinfo must not reach the high-side runtime package's run payload.
 *
 * Found during v2.1.2 review, present in released v2.1.1: with
 * `includeHighSideRuntimePackage`, the bundle's
 * runtime-package/payloads/imported-run.bundle.json carried a client-supplied
 * `http://user:password@proxy` verbatim, because sanitizeStateForExport never
 * stripped proxy userinfo — the one credential class DOC-176 hardened on the
 * generation paths but not here. The endpoint itself must survive.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import crypto from "node:crypto";

process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE = "fixture";
const { app } = await import("../src/index.js");
const { createTestServer, closeTestServer } = await import("./helpers/httpServerLifecycle.js");

const PASS = `OAA_SYNTH_CANARY_PROXYPASS_${crypto.randomBytes(6).toString("hex")}`;

function members(buf) {
  let e = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  const out = new Map();
  let pos = buf.readUInt32LE(e + 16);
  for (let i = 0; i < buf.readUInt16LE(e + 10); i++) {
    const m = buf.readUInt16LE(pos + 10), cs = buf.readUInt32LE(pos + 20), us = buf.readUInt32LE(pos + 24);
    const nl = buf.readUInt16LE(pos + 28), xl = buf.readUInt16LE(pos + 30), cl = buf.readUInt16LE(pos + 32), lo = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nl);
    const ds = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const raw = buf.subarray(ds, ds + (m === 0 ? us : cs));
    out.set(name, (m === 8 ? zlib.inflateRawSync(raw) : raw).toString("utf8"));
    pos += 46 + nl + xl + cl;
  }
  return out;
}

let server, baseUrl;
before(async () => { ({ server, baseUrl } = await createTestServer(app)); });
after(async () => { delete process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE; await closeTestServer(server); });

describe("runtime package run payload never carries proxy userinfo", () => {
  it("default export: endpoint kept, password absent from every bundle member", async () => {
    const state = {
      _schemaVersion: 3,
      version: { _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: "4.22.16", selectedChannel: "stable-4.22", selectedVersion: "4.22.16", locked: true },
      release: { channel: "4.22", patchVersion: "4.22.16", confirmed: true },
      blueprint: { platform: "Bare Metal", arch: "x86_64", clusterName: "rpcred", baseDomain: "example.com", confirmed: true },
      methodology: { method: "Agent-Based Installer" },
      credentials: { sshPublicKey: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB rp@test" },
      globalStrategy: {
        proxyEnabled: true,
        proxies: { httpProxy: `http://rpuser:${PASS}@proxy.rpcred.example:3128`, httpsProxy: `http://rpuser:${PASS}@proxy.rpcred.example:3129` },
        networking: { machineNetworkV4: "10.90.0.0/24" },
      },
      hostInventory: { nodes: [], ipStackMode: "ipv4" },
      exportOptions: { includeCredentials: false, includeCertificates: true, includeHighSideRuntimePackage: true },
    };
    const res = await fetch(`${baseUrl}/api/bundle.zip`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
    assert.equal(res.status, 200);
    const files = members(Buffer.from(await res.arrayBuffer()));
    const payloadName = [...files.keys()].find((n) => n.endsWith("imported-run.bundle.json"));
    assert.ok(payloadName, "runtime package payload missing");
    for (const [name, body] of files) assert.ok(!body.includes(PASS), `proxy password leaked into ${name}`);
    const payload = JSON.parse(files.get(payloadName));
    assert.match(payload.state.globalStrategy.proxies.httpProxy, /^http:\/\/proxy\.rpcred\.example:3128\/?$/, "endpoint must be preserved");
  });
});
