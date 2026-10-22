/**
 * Per-file Download must follow the export policy, not the preview policy.
 *
 * The preview is generated with credentials and the SSH key forced IN so the
 * drawer's "Show sensitive values" toggle has something to reveal; the drawer
 * redacts them for display. Its per-file Download used to write those preview
 * bytes verbatim, so with every credential switch OFF a single downloaded
 * install-config.yaml still carried the pull secret, BMC/vCenter passwords,
 * proxy userinfo and the SSH key. Downloads now request `exportPolicy: true`,
 * which applies exactly the bundle's rules.
 *
 * Also pinned: the "SSH public key" switch ("Include install-config sshKey")
 * was inert; it now omits the optional sshKey from exported files.
 *
 * Canaries are generated at runtime (see credential-canary-surfaces.test.js).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import crypto from "node:crypto";
import yaml from "js-yaml";

import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const tag = crypto.randomBytes(5).toString("hex").toUpperCase();
const C = {
  PULL: `OAA_SYNTH_CANARY_PULL_${tag}`,
  BMC: `OAA_SYNTH_CANARY_BMCPASS_${tag}`,
  VC: `OAA_SYNTH_CANARY_VCPASS_${tag}`,
  PROXY: `OAA_SYNTH_CANARY_PROXYPASS_${tag}`,
  SSH: `AAAAC3NzaOAASYNTHSSH${tag}`,
};
const pullAuth = Buffer.from(`u:${C.PULL}`).toString("base64");

const ALL_ON = { pullSecret: true, platformCredentials: true, mirrorRegistryCredentials: true, bmcCredentials: true, trustBundleAndCertificates: true, sshPublicKey: true, proxyValues: true };
const ALL_OFF = { pullSecret: false, platformCredentials: false, mirrorRegistryCredentials: false, bmcCredentials: false, trustBundleAndCertificates: true, sshPublicKey: false, proxyValues: true };

function common(inclusion) {
  return {
    _schemaVersion: 3,
    version: { _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: "4.22.16", selectedChannel: "stable-4.22", selectedVersion: "4.22.16", locked: true },
    release: { channel: "4.22", patchVersion: "4.22.16", confirmed: true },
    credentials: {
      sshPublicKey: `ssh-ed25519 ${C.SSH} synthetic@example`,
      pullSecretPlaceholder: JSON.stringify({ auths: { "quay.io": { auth: pullAuth, email: "" } } }),
    },
    globalStrategy: { proxyEnabled: true, proxies: { httpProxy: `http://pu:${C.PROXY}@proxy.policy.example:3128`, noProxy: ".policy.example" }, networking: { machineNetworkV4: "10.70.0.0/24" } },
    exportOptions: { includeCredentials: Boolean(inclusion.pullSecret), includeCertificates: true, inclusion },
  };
}

const SCENARIOS = {
  "bare metal IPI (BMC)": (inclusion) => ({
    ...common(inclusion),
    blueprint: { platform: "Bare Metal", arch: "x86_64", clusterName: "pol", baseDomain: "example.com", confirmed: true },
    methodology: { method: "IPI" },
    hostInventory: { apiVip: "10.70.0.5", ingressVip: "10.70.0.6", ipStackMode: "ipv4", nodes: [
      { role: "master", hostname: "m0", bmc: { address: "redfish://10.70.0.101/redfish/v1/Systems/1", username: "bmcadmin", password: C.BMC, bootMACAddress: "00:00:5E:00:53:01" } },
    ] },
  }),
  "vSphere IPI (vCenter)": (inclusion) => ({
    ...common(inclusion),
    blueprint: { platform: "VMware vSphere", arch: "x86_64", clusterName: "pol", baseDomain: "example.com", confirmed: true },
    methodology: { method: "IPI" },
    hostInventory: { apiVip: "10.70.0.5", ingressVip: "10.70.0.6", nodes: [] },
    platformConfig: { vsphere: { placementMode: "legacy", vcenter: "vc.policy.example", username: "vcadmin", password: C.VC, datacenter: "dc1", cluster: "c1", datastore: "ds1", network: "VM Network" } },
  }),
};

function zipMembers(buf) {
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
after(async () => { await closeTestServer(server); });

const generate = async (state, exportPolicy) => {
  const res = await fetch(`${baseUrl}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, isolateArtifacts: true, exportPolicy }) });
  assert.equal(res.status, 200);
  return (await res.json()).files;
};
const bundle = async (state) => {
  const res = await fetch(`${baseUrl}/api/bundle.zip`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
  assert.equal(res.status, 200);
  return zipMembers(Buffer.from(await res.arrayBuffer()));
};
const secretsIn = (text) => ({ pull: text.includes(pullAuth), bmc: text.includes(C.BMC), vcenter: text.includes(C.VC), proxy: text.includes(C.PROXY), ssh: text.includes(C.SSH) });

for (const [name, build] of Object.entries(SCENARIOS)) {
  describe(`per-file download export policy — ${name}`, () => {
    const platformSecret = name.startsWith("bare") ? "bmc" : "vcenter";

    it("baseline: the PREVIEW still carries every credential (the reveal toggle needs them)", async () => {
      const ic = (await generate(build(ALL_OFF), false))["install-config.yaml"];
      const s = secretsIn(ic);
      assert.ok(s.pull && s.proxy && s.ssh && s[platformSecret], `preview lost a credential: ${JSON.stringify(s)}`);
    });

    it("OFF: export-policy bytes carry no credential and no SSH key, but keep every structural/non-credential value", async () => {
      const files = await generate(build(ALL_OFF), true);
      for (const [file, text] of Object.entries(files)) {
        if (typeof text !== "string") continue; // artifact not applicable to this scenario
        const s = secretsIn(text);
        assert.deepEqual(s, { pull: false, bmc: false, vcenter: false, proxy: false, ssh: false }, `${file} leaked: ${JSON.stringify(s)}`);
      }
      const ic = yaml.load(files["install-config.yaml"]);
      assert.ok("pullSecret" in ic, "pullSecret key is mandatory structure and must remain (as an empty auths placeholder)");
      assert.equal(ic.sshKey, undefined, "sshKey must be omitted when the SSH public key switch is off");
      assert.match(ic.proxy.httpProxy, /proxy\.policy\.example:3128/, "the non-secret proxy endpoint must remain");
      assert.equal(ic.metadata.name, "pol");
    });

    it("ON: export-policy bytes carry the opted-in credentials", async () => {
      const s = secretsIn((await generate(build(ALL_ON), true))["install-config.yaml"]);
      assert.ok(s.pull && s.proxy && s.ssh && s[platformSecret], `opted-in credential missing: ${JSON.stringify(s)}`);
    });

    for (const [label, inclusion] of [["OFF", ALL_OFF], ["ON", ALL_ON]]) {
      it(`${label}: a per-file download is byte-identical to the bundle's member`, async () => {
        const state = build(inclusion);
        const files = await generate(state, true);
        const zip = await bundle(state);
        for (const member of ["install-config.yaml", "agent-config.yaml", "imageset-config.yaml"]) {
          if (!zip.has(member)) continue;
          assert.equal(files[member], zip.get(member), `${member} differs between per-file download and bundle`);
        }
      });
    }
  });
}

describe("SSH public key switch", () => {
  it("the bundle honours it: OFF omits sshKey, ON keeps it, nothing else changes", async () => {
    const on = yaml.load((await bundle(SCENARIOS["bare metal IPI (BMC)"]({ ...ALL_OFF, sshPublicKey: true }))).get("install-config.yaml"));
    const off = yaml.load((await bundle(SCENARIOS["bare metal IPI (BMC)"]({ ...ALL_OFF, sshPublicKey: false }))).get("install-config.yaml"));
    assert.match(on.sshKey, new RegExp(C.SSH));
    assert.equal(off.sshKey, undefined);
    delete on.sshKey;
    assert.deepEqual(off, on);
  });

  it("a legacy state without an inclusion map keeps the historical default (key included)", async () => {
    const state = SCENARIOS["bare metal IPI (BMC)"](ALL_OFF);
    state.exportOptions = { includeCredentials: false, includeCertificates: true };
    assert.match(yaml.load((await bundle(state)).get("install-config.yaml")).sshKey, new RegExp(C.SSH));
  });
});
