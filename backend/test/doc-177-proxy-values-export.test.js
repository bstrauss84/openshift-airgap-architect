/**
 * DOC-177 — the "Proxy values" export switch must govern the exported bundle.
 *
 * Before this fix `inclusion.proxyValues` had no consumer: switching it off left
 * every proxy endpoint in install-config.yaml and the Field Manual. These tests
 * download the real bundle through /api/bundle.zip, decompress it, and read the
 * generated files, so they prove what a user actually receives.
 *
 * Contract pinned here:
 *   - ON (and the default, and a legacy state with no `inclusion`): endpoints present.
 *   - OFF: every configured value is replaced by its REPLACE_WITH_… marker; the
 *     proxy block itself is kept, so the bundle never silently describes a
 *     cluster without a proxy; unset values are not invented.
 *   - Proxy userinfo stays under the credential contract (DOC-176) either way.
 *   - Nothing outside the proxy values changes: other bundle members are
 *     byte-identical and the run backup still carries the user's settings.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import crypto from "node:crypto";
import yaml from "js-yaml";

import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { SUPPORTED_MINORS } from "../src/versionPolicy.js";
import { applyProxyValueInclusion, PROXY_VALUE_MARKERS } from "../src/exportInclusion.js";

const PATCH = { "4.20": "4.20.40", "4.21": "4.21.35", "4.22": "4.22.16" };

// Runtime-generated so no credential-shaped literal is committed to source.
const PROXY_PASS = `OAA_SYNTH_CANARY_PROXYPASS_${crypto.randomBytes(6).toString("hex")}`;
const HTTP_HOST = "proxy-http.doc177.example.internal";
const HTTPS_HOST = "proxy-https.doc177.example.internal";
const NO_PROXY = ".doc177-internal.example,10.77.0.0/16";

function proxyState(minor, inclusion, { includeCredentials = false } = {}) {
  const patch = PATCH[minor];
  return {
    _schemaVersion: 3,
    version: { _schemaVersion: 3, selectedMinor: minor, selectedPatch: patch, selectedChannel: `stable-${minor}`, selectedVersion: patch, locked: true },
    release: { channel: minor, patchVersion: patch, confirmed: true },
    blueprint: { platform: "Bare Metal", arch: "x86_64", clusterName: "doc177", baseDomain: "example.com", confirmed: true },
    methodology: { method: "Agent-Based Installer" },
    credentials: { sshPublicKey: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB doc177@test" },
    globalStrategy: {
      fips: false,
      proxyEnabled: true,
      proxies: {
        httpProxy: `http://doc177user:${PROXY_PASS}@${HTTP_HOST}:3128`,
        httpsProxy: `http://${HTTPS_HOST}:3129`,
        noProxy: NO_PROXY,
      },
      networking: {
        networkType: "OVNKubernetes",
        machineNetworkV4: "10.90.0.0/24",
        clusterNetworkCidr: "10.128.0.0/14",
        clusterNetworkHostPrefix: 23,
        serviceNetworkCidr: "172.30.0.0/16",
      },
      mirroring: { registryFqdn: "registry.local:5000", sources: [] },
    },
    hostInventory: { nodes: [], ipStackMode: "ipv4" },
    operators: { selected: [], stale: false },
    trust: { additionalTrustBundlePolicy: "Proxyonly", mirrorRegistryCaPem: "", proxyCaPem: "" },
    exportOptions: {
      includeCredentials,
      includeCertificates: true,
      ...(inclusion === undefined ? {} : { inclusion }),
    },
  };
}

function parseZipEntries(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("EOCD not found");
  const count = buffer.readUInt16LE(eocd + 10);
  let pos = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pos + 10);
    const compSize = buffer.readUInt32LE(pos + 20);
    const uncompSize = buffer.readUInt32LE(pos + 24);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.toString("utf8", pos + 46, pos + 46 + nameLen);
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(dataStart, dataStart + (method === 0 ? uncompSize : compSize));
    entries.set(name, (method === 8 ? zlib.inflateRawSync(raw) : raw).toString("utf8"));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

let server, baseUrl;
before(async () => { ({ server, baseUrl } = await createTestServer(app)); });
after(async () => {
  // Leave a neutral state for later suites sharing this DATA_DIR.
  await postJson("/api/state", proxyState("4.22", { proxyValues: true }));
  await closeTestServer(server);
});

const postJson = (path, body) =>
  fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function downloadBundle(state) {
  const res = await postJson("/api/bundle.zip", { state });
  assert.equal(res.status, 200, `bundle.zip returned ${res.status}: ${res.status === 200 ? "" : await res.text()}`);
  return parseZipEntries(Buffer.from(await res.arrayBuffer()));
}

describe("DOC-177 applyProxyValueInclusion (unit)", () => {
  it("returns the state unchanged when the switch is on, absent, or legacy", () => {
    for (const inclusion of [{ proxyValues: true }, {}, undefined]) {
      const st = proxyState("4.22", inclusion);
      assert.equal(applyProxyValueInclusion(st), st);
    }
  });

  it("replaces configured values with markers and does not mutate the input", () => {
    const st = proxyState("4.22", { proxyValues: false });
    const before = JSON.stringify(st);
    const out = applyProxyValueInclusion(st);
    assert.equal(JSON.stringify(st), before, "input state was mutated");
    assert.deepEqual(out.globalStrategy.proxies, {
      httpProxy: PROXY_VALUE_MARKERS.httpProxy,
      httpsProxy: PROXY_VALUE_MARKERS.httpsProxy,
      noProxy: PROXY_VALUE_MARKERS.noProxy,
    });
    assert.equal(out.globalStrategy.proxyEnabled, true, "the proxy requirement must stay visible");
  });

  it("never invents a value the user did not configure", () => {
    const st = proxyState("4.22", { proxyValues: false });
    st.globalStrategy.proxies = { httpProxy: "", httpsProxy: `http://${HTTPS_HOST}:3129` };
    const out = applyProxyValueInclusion(st).globalStrategy.proxies;
    assert.equal(out.httpProxy, "");
    assert.equal(out.httpsProxy, PROXY_VALUE_MARKERS.httpsProxy);
    assert.equal(out.noProxy, undefined);
  });
});

describe("DOC-177 downloaded bundle honours the Proxy values switch", () => {
  for (const minor of SUPPORTED_MINORS) {
    describe(minor, () => {
      it("ON: endpoints are exported; proxy userinfo is still stripped by default", async () => {
        const files = await downloadBundle(proxyState(minor, { proxyValues: true }));
        const ic = yaml.load(files.get("install-config.yaml"));
        assert.equal(ic.proxy.httpProxy, `http://${HTTP_HOST}:3128/`);
        // stripProxyCredentials normalizes through URL, which appends "/" (DOC-176, unchanged).
        assert.equal(ic.proxy.httpsProxy, `http://${HTTPS_HOST}:3129/`);
        assert.equal(ic.proxy.noProxy, NO_PROXY);
        const manual = files.get("FIELD_MANUAL.md");
        assert.ok(manual.includes(HTTP_HOST) && manual.includes(HTTPS_HOST), "Field Manual lost the endpoints");
        for (const [name, body] of files) assert.ok(!body.includes(PROXY_PASS), `proxy password leaked into ${name}`);
      });

      it("OFF: endpoints are replaced by markers in install-config.yaml and the Field Manual", async () => {
        const files = await downloadBundle(proxyState(minor, { proxyValues: false }));
        const ic = yaml.load(files.get("install-config.yaml"));
        assert.deepEqual(ic.proxy, {
          httpProxy: PROXY_VALUE_MARKERS.httpProxy,
          httpsProxy: PROXY_VALUE_MARKERS.httpsProxy,
          noProxy: PROXY_VALUE_MARKERS.noProxy,
        }, "the proxy block must be kept, carrying markers rather than values");
        assert.ok(files.get("FIELD_MANUAL.md").includes(PROXY_VALUE_MARKERS.httpProxy), "Field Manual has no marker");
        for (const [name, body] of files) {
          for (const leaked of [HTTP_HOST, HTTPS_HOST, NO_PROXY, PROXY_PASS]) {
            assert.ok(!body.includes(leaked), `${leaked} leaked into ${name} with Proxy values off`);
          }
        }
      });
    });
  }

  it("OFF also wins over explicit credential inclusion: no userinfo or endpoint escapes", async () => {
    const files = await downloadBundle(proxyState("4.22", { proxyValues: false, pullSecret: true }, { includeCredentials: true }));
    for (const [name, body] of files) {
      assert.ok(!body.includes(PROXY_PASS), `proxy password leaked into ${name}`);
      assert.ok(!body.includes(HTTP_HOST), `endpoint leaked into ${name}`);
    }
  });

  it("ON with explicit credential inclusion keeps the userinfo (DOC-176 contract unchanged)", async () => {
    const files = await downloadBundle(proxyState("4.22", { proxyValues: true, pullSecret: true }, { includeCredentials: true }));
    assert.ok(yaml.load(files.get("install-config.yaml")).proxy.httpProxy.includes(PROXY_PASS));
  });

  it("changes nothing outside the proxy values", async () => {
    const on = await downloadBundle(proxyState("4.22", { proxyValues: true }));
    const off = await downloadBundle(proxyState("4.22", { proxyValues: false }));
    assert.deepEqual([...off.keys()].sort(), [...on.keys()].sort(), "bundle membership changed");
    for (const name of ["agent-config.yaml", "imageset-config.yaml"]) {
      assert.equal(off.get(name), on.get(name), `${name} changed with the proxy switch`);
    }
    const icOn = yaml.load(on.get("install-config.yaml"));
    const icOff = yaml.load(off.get("install-config.yaml"));
    delete icOn.proxy;
    delete icOff.proxy;
    assert.deepEqual(icOff, icOn, "install-config changed outside the proxy block");
  });

  it("OFF also governs the high-side runtime package's run payload inside the bundle", async () => {
    // Review finding: runtime-package/payload/imported-run.bundle.json is a member
    // of the same bundle.zip, so it must not carry the endpoints either.
    process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE = "fixture";
    try {
      for (const proxyValues of [false, true]) {
        const st = proxyState("4.22", { proxyValues });
        st.exportOptions.includeHighSideRuntimePackage = true;
        const files = await downloadBundle(st);
        const payloadName = [...files.keys()].find((n) => n.endsWith("imported-run.bundle.json"));
        assert.ok(payloadName, `runtime package payload missing; members: ${[...files.keys()].join(", ")}`);
        const payload = files.get(payloadName);
        assert.equal(payload.includes(HTTPS_HOST), proxyValues, `payload endpoint presence wrong for proxyValues=${proxyValues}`);
        assert.ok(!payload.includes(PROXY_PASS), "proxy password leaked into the runtime package payload");
        if (!proxyValues) {
          for (const [name, body] of files) assert.ok(!body.includes(HTTPS_HOST), `${HTTPS_HOST} leaked into ${name}`);
        }
      }
    } finally {
      delete process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE;
    }
  });

  it("the run backup still carries the user's proxy settings (re-import is lossless)", async () => {
    await postJson("/api/state", proxyState("4.22", { proxyValues: false }));
    const body = await (await fetch(`${baseUrl}/api/run/export`)).json();
    assert.ok(String(body.state.globalStrategy.proxies.httpsProxy).includes(HTTPS_HOST));
    assert.equal(body.state.globalStrategy.proxies.noProxy, NO_PROXY);
  });
});
