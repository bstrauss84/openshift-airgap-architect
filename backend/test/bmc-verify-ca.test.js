import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { buildInstallConfig, validateBmcVerifyCA, MAX_BMC_VERIFY_CA_BYTES } from "../src/generate.js";
import { bareMetalAgent, bareMetalIpi } from "./fixtures/base-states.js";
import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

async function resetState(baseUrl) {
  await fetch(`${baseUrl}/api/start-over`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cancelRunningOcMirror: false })
  });
}

after(async () => {
  const { server, baseUrl } = await createTestServer(app);
  try {
    await resetState(baseUrl);
  } finally {
    await closeTestServer(server);
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SAMPLE_PEM = "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAMa...\n-----END CERTIFICATE-----";

const makeAgent421 = (hiOverrides = {}) => bareMetalAgent({
  version: { selectedMinor: "4.21", selectedPatch: "4.21.0" },
  release: { channel: "4.21", patchVersion: "4.21.0" },
  hostInventory: { ...hiOverrides },
});

const makeAgent420 = (hiOverrides = {}) => bareMetalAgent({
  version: { selectedMinor: "4.20", selectedPatch: "4.20.8" },
  release: { channel: "4.20", patchVersion: "4.20.8" },
  hostInventory: { ...hiOverrides },
});

const makeIpi421 = (hiOverrides = {}) => bareMetalIpi({
  version: { selectedMinor: "4.21", selectedPatch: "4.21.0" },
  release: { channel: "4.21", patchVersion: "4.21.0" },
  hostInventory: { ...hiOverrides },
});

const makeIpi420 = (hiOverrides = {}) => bareMetalIpi({
  version: { selectedMinor: "4.20", selectedPatch: "4.20.8" },
  release: { channel: "4.20", patchVersion: "4.20.8" },
  hostInventory: { ...hiOverrides },
});

const makeAgentSNO421 = (hiOverrides = {}) => bareMetalAgent({
  version: { selectedMinor: "4.21", selectedPatch: "4.21.0" },
  release: { channel: "4.21", patchVersion: "4.21.0" },
  hostInventory: {
    nodes: [
      { role: "master", hostname: "sno-0", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:01" } },
    ],
    apiVip: "10.90.0.2",
    ingressVip: "10.90.0.3",
    machineNetworkCidr: "10.90.0.0/24",
    ipStackMode: "ipv4",
    ...hiOverrides,
  },
});

const makeUpi421 = (hiOverrides = {}) => bareMetalAgent({
  version: { selectedMinor: "4.21", selectedPatch: "4.21.0" },
  release: { channel: "4.21", patchVersion: "4.21.0" },
  methodology: { method: "UPI" },
  hostInventory: {
    nodes: [
      { role: "master", hostname: "m0", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:01" } },
      { role: "master", hostname: "m1", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:02" } },
      { role: "master", hostname: "m2", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:03" } },
    ],
    apiVip: "10.90.0.2",
    ingressVip: "10.90.0.3",
    machineNetworkCidr: "10.90.0.0/24",
    ipStackMode: "ipv4",
    ...hiOverrides,
  },
});

function loadCatalog(version, scenario) {
  const filePath = path.resolve(__dirname, '..', '..', 'data', 'params', version, `${scenario}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseInstallConfig(result) {
  return yaml.load(result);
}

// ===================================================================
// Production validation tests (validateBmcVerifyCA)
// ===================================================================

describe("bmcVerifyCA — production validation", () => {
  it("valid PEM accepted", () => {
    const result = validateBmcVerifyCA(SAMPLE_PEM);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, SAMPLE_PEM);
  });

  it("arbitrary non-empty string accepted", () => {
    const result = validateBmcVerifyCA("some-custom-ca-content");
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, "some-custom-ca-content");
  });

  it("undefined returns valid+blank", () => {
    assert.deepStrictEqual(validateBmcVerifyCA(undefined), { valid: true, blank: true });
  });

  it("null returns valid+blank", () => {
    assert.deepStrictEqual(validateBmcVerifyCA(null), { valid: true, blank: true });
  });

  it("empty string returns valid+blank", () => {
    assert.deepStrictEqual(validateBmcVerifyCA(""), { valid: true, blank: true });
  });

  it("whitespace-only returns valid+blank", () => {
    assert.deepStrictEqual(validateBmcVerifyCA("   \n\t  "), { valid: true, blank: true });
  });

  it("boolean returns invalid", () => {
    const r = validateBmcVerifyCA(true);
    assert.strictEqual(r.valid, false);
    assert.ok(r.error.includes("must be a string"));
  });

  it("number returns invalid", () => {
    const r = validateBmcVerifyCA(42);
    assert.strictEqual(r.valid, false);
    assert.ok(r.error.includes("must be a string"));
  });

  it("object returns invalid", () => {
    const r = validateBmcVerifyCA({});
    assert.strictEqual(r.valid, false);
    assert.ok(r.error.includes("must be a string"));
  });

  it("array returns invalid", () => {
    const r = validateBmcVerifyCA([]);
    assert.strictEqual(r.valid, false);
    assert.ok(r.error.includes("must be a string"));
  });

  it("NUL byte returns invalid", () => {
    const r = validateBmcVerifyCA("cert\0content");
    assert.strictEqual(r.valid, false);
    assert.ok(r.error.includes("NUL byte"));
  });

  it("exactly 256 KiB accepted", () => {
    const value = "A".repeat(262144);
    const result = validateBmcVerifyCA(value);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, value);
  });

  it("256 KiB + 1 byte returns invalid", () => {
    const value = "A".repeat(262145);
    const r = validateBmcVerifyCA(value);
    assert.strictEqual(r.valid, false);
    assert.ok(r.error.includes("exceeds 256 KiB"));
  });

  it("MAX_BMC_VERIFY_CA_BYTES is 262144", () => {
    assert.strictEqual(MAX_BMC_VERIFY_CA_BYTES, 262144);
  });

  it("non-empty content is not trimmed", () => {
    const value = "  \n-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----\n  ";
    const result = validateBmcVerifyCA(value);
    assert.strictEqual(result.value, value);
  });
});

// ===================================================================
// Catalog tests
// ===================================================================

describe("bmcVerifyCA — catalog", () => {
  it("4.20 IPI has no bmcVerifyCA param", () => {
    const catalog = loadCatalog("4.20", "bare-metal-ipi");
    const param = catalog.parameters.find(p => p.path === "platform.baremetal.bmcVerifyCA");
    assert.strictEqual(param, undefined);
  });

  it("4.20 Agent has no bmcVerifyCA param", () => {
    const catalog = loadCatalog("4.20", "bare-metal-agent");
    const param = catalog.parameters.find(p => p.path === "platform.baremetal.bmcVerifyCA");
    assert.strictEqual(param, undefined);
  });

  it("4.21 IPI bmcVerifyCA is supported-ui", () => {
    const catalog = loadCatalog("4.21", "bare-metal-ipi");
    const param = catalog.parameters.find(p => p.path === "platform.baremetal.bmcVerifyCA");
    assert.ok(param, "bmcVerifyCA param must exist");
    assert.strictEqual(param.supportStatus, "supported-ui");
    assert.strictEqual(param.minVersion, "4.21");
  });

  it("4.21 Agent bmcVerifyCA is supported-ui", () => {
    const catalog = loadCatalog("4.21", "bare-metal-agent");
    const param = catalog.parameters.find(p => p.path === "platform.baremetal.bmcVerifyCA");
    assert.ok(param, "bmcVerifyCA param must exist");
    assert.strictEqual(param.supportStatus, "supported-ui");
    assert.strictEqual(param.minVersion, "4.21");
  });

  it("4.21 UPI bmcVerifyCA is hidden-not-applicable", () => {
    const catalog = loadCatalog("4.21", "bare-metal-upi");
    const param = catalog.parameters.find(p => p.path === "platform.baremetal.bmcVerifyCA");
    assert.ok(param, "bmcVerifyCA param must exist in UPI catalog");
    assert.strictEqual(param.supportStatus, "hidden-not-applicable");
  });

  it("4.21 IPI bmcVerifyCA type is string", () => {
    const catalog = loadCatalog("4.21", "bare-metal-ipi");
    const param = catalog.parameters.find(p => p.path === "platform.baremetal.bmcVerifyCA");
    assert.ok(param);
    assert.strictEqual(param.type, "string");
  });

  it("canonical and frontend mirrors are identical for IPI", () => {
    const canonicalPath = path.resolve(__dirname, '..', '..', 'data', 'params', '4.21', 'bare-metal-ipi.json');
    const mirrorPath = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'data', 'catalogs', '4.21', 'bare-metal-ipi.json');
    const canonical = fs.readFileSync(canonicalPath, 'utf8');
    const mirror = fs.readFileSync(mirrorPath, 'utf8');
    assert.strictEqual(canonical, mirror);
  });

  it("canonical and frontend mirrors are identical for Agent", () => {
    const canonicalPath = path.resolve(__dirname, '..', '..', 'data', 'params', '4.21', 'bare-metal-agent.json');
    const mirrorPath = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'data', 'catalogs', '4.21', 'bare-metal-agent.json');
    const canonical = fs.readFileSync(canonicalPath, 'utf8');
    const mirror = fs.readFileSync(mirrorPath, 'utf8');
    assert.strictEqual(canonical, mirror);
  });

  it("canonical and frontend mirrors are identical for UPI", () => {
    const canonicalPath = path.resolve(__dirname, '..', '..', 'data', 'params', '4.21', 'bare-metal-upi.json');
    const mirrorPath = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'data', 'catalogs', '4.21', 'bare-metal-upi.json');
    const canonical = fs.readFileSync(canonicalPath, 'utf8');
    const mirror = fs.readFileSync(mirrorPath, 'utf8');
    assert.strictEqual(canonical, mirror);
  });
});

// ===================================================================
// Backend generation tests
// ===================================================================

describe("bmcVerifyCA — generation", () => {
  it("omitted value produces no bmcVerifyCA in Agent multi-node", () => {
    const state = makeAgent421();
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform?.baremetal?.bmcVerifyCA, undefined);
  });

  it("omitted value produces no bmcVerifyCA in IPI", () => {
    const state = makeIpi421();
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform?.baremetal?.bmcVerifyCA, undefined);
  });

  it("PEM emits exact output in Agent multi-node", () => {
    const state = makeAgent421({ bmcVerifyCA: SAMPLE_PEM });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.baremetal.bmcVerifyCA, SAMPLE_PEM);
  });

  it("PEM emits exact output in IPI", () => {
    const state = makeIpi421({ bmcVerifyCA: SAMPLE_PEM });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.baremetal.bmcVerifyCA, SAMPLE_PEM);
  });

  it("empty string does not emit bmcVerifyCA", () => {
    const state = makeAgent421({ bmcVerifyCA: "" });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform?.baremetal?.bmcVerifyCA, undefined);
  });

  it("whitespace-only does not emit bmcVerifyCA", () => {
    const state = makeAgent421({ bmcVerifyCA: "   " });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform?.baremetal?.bmcVerifyCA, undefined);
  });

  it("4.20 stale value is suppressed in Agent", () => {
    const state = makeAgent420({ bmcVerifyCA: SAMPLE_PEM });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform?.baremetal?.bmcVerifyCA, undefined);
  });

  it("4.20 stale value is suppressed in IPI", () => {
    const state = makeIpi420({ bmcVerifyCA: SAMPLE_PEM });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform?.baremetal?.bmcVerifyCA, undefined);
  });

  it("Agent SNO stale value is suppressed (platform.none)", () => {
    const state = makeAgentSNO421({ bmcVerifyCA: SAMPLE_PEM });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform?.baremetal, undefined);
    assert.deepStrictEqual(ic.platform.none, {});
  });

  it("UPI stale value is suppressed (platform.none)", () => {
    const state = makeUpi421({ bmcVerifyCA: SAMPLE_PEM });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform?.baremetal, undefined);
    assert.deepStrictEqual(ic.platform.none, {});
  });

  it("content with leading/trailing whitespace is preserved as-is", () => {
    const value = "  \n-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----\n  ";
    const state = makeAgent421({ bmcVerifyCA: value });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.baremetal.bmcVerifyCA, value);
  });

  it("bmcVerifyCA coexists with apiVIPs and ingressVIPs", () => {
    const state = makeAgent421({ bmcVerifyCA: SAMPLE_PEM });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.ok(ic.platform.baremetal.apiVIPs);
    assert.ok(ic.platform.baremetal.ingressVIPs);
    assert.strictEqual(ic.platform.baremetal.bmcVerifyCA, SAMPLE_PEM);
  });
});

// ===================================================================
// buildInstallConfig rejection tests
// ===================================================================

describe("bmcVerifyCA — buildInstallConfig rejection", () => {
  it("rejects boolean", () => {
    const state = makeAgent421({ bmcVerifyCA: true });
    assert.throws(() => buildInstallConfig(state), /must be a string/);
  });

  it("rejects number", () => {
    const state = makeAgent421({ bmcVerifyCA: 42 });
    assert.throws(() => buildInstallConfig(state), /must be a string/);
  });

  it("rejects object", () => {
    const state = makeAgent421({ bmcVerifyCA: {} });
    assert.throws(() => buildInstallConfig(state), /must be a string/);
  });

  it("rejects array", () => {
    const state = makeAgent421({ bmcVerifyCA: [] });
    assert.throws(() => buildInstallConfig(state), /must be a string/);
  });

  it("rejects NUL byte", () => {
    const state = makeAgent421({ bmcVerifyCA: "cert\0data" });
    assert.throws(() => buildInstallConfig(state), /NUL byte/);
  });

  it("rejects over 256 KiB", () => {
    const state = makeAgent421({ bmcVerifyCA: "A".repeat(262145) });
    assert.throws(() => buildInstallConfig(state), /exceeds 256 KiB/);
  });

  it("rejects boolean in IPI", () => {
    const state = makeIpi421({ bmcVerifyCA: true });
    assert.throws(() => buildInstallConfig(state), /must be a string/);
  });

  it("rejects NUL byte in IPI", () => {
    const state = makeIpi421({ bmcVerifyCA: "cert\0data" });
    assert.throws(() => buildInstallConfig(state), /NUL byte/);
  });
});

// ===================================================================
// Persistence / import-export tests
// ===================================================================

describe("bmcVerifyCA — persistence", () => {
  it("round-trip state retains bmcVerifyCA", () => {
    const state = makeAgent421({ bmcVerifyCA: SAMPLE_PEM });
    const serialized = JSON.stringify(state);
    const deserialized = JSON.parse(serialized);
    assert.strictEqual(deserialized.hostInventory.bmcVerifyCA, SAMPLE_PEM);
  });

  it("import/export round trip retains bmcVerifyCA in output", () => {
    const state = makeAgent421({ bmcVerifyCA: SAMPLE_PEM });
    const exported = JSON.parse(JSON.stringify(state));
    const imported = JSON.parse(JSON.stringify(exported));
    assert.strictEqual(imported.hostInventory.bmcVerifyCA, SAMPLE_PEM);
    const result = buildInstallConfig(imported);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.baremetal.bmcVerifyCA, SAMPLE_PEM);
  });

  it("retained hidden value is still suppressed when version downgraded", () => {
    const state = makeAgent421({ bmcVerifyCA: SAMPLE_PEM });
    const exported = JSON.parse(JSON.stringify(state));
    exported.version.selectedMinor = "4.20";
    exported.version.selectedPatch = "4.20.8";
    exported.release.channel = "4.20";
    exported.release.patchVersion = "4.20.8";
    assert.strictEqual(exported.hostInventory.bmcVerifyCA, SAMPLE_PEM);
    const result = buildInstallConfig(exported);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform?.baremetal?.bmcVerifyCA, undefined);
  });
});

// ===================================================================
// API rejection tests (HTTP boundary)
// ===================================================================

describe("bmcVerifyCA — API rejection", () => {
  async function postGenerateWithCA(baseUrl, hiOverrides) {
    const state = makeAgent421(hiOverrides);
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    return { status: res.status, body: await res.json() };
  }

  it("rejects boolean via HTTP", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await postGenerateWithCA(baseUrl, { bmcVerifyCA: true });
      assert.strictEqual(status, 500);
      assert.ok(body.error.includes("must be a string"), "error must mention string");
      assert.strictEqual(body.files, undefined, "no files payload");
    } finally {
      await closeTestServer(server);
    }
  });

  it("rejects NUL byte via HTTP", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await postGenerateWithCA(baseUrl, { bmcVerifyCA: "cert\0data" });
      assert.strictEqual(status, 500);
      assert.ok(body.error.includes("NUL byte"), "error must mention NUL byte");
      assert.strictEqual(body.files, undefined, "no files payload");
    } finally {
      await closeTestServer(server);
    }
  });

  it("accepts PEM via HTTP for Agent multi-node", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await postGenerateWithCA(baseUrl, { bmcVerifyCA: SAMPLE_PEM });
      assert.strictEqual(status, 200);
      assert.ok(body.files, "must return files payload");
      const ic = yaml.load(body.files["install-config.yaml"]);
      assert.strictEqual(ic.platform.baremetal.bmcVerifyCA, SAMPLE_PEM);
    } finally {
      await closeTestServer(server);
    }
  });

  it("accepts PEM via HTTP for IPI", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeIpi421({ bmcVerifyCA: SAMPLE_PEM });
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.ok(body.files, "must return files payload");
      const ic = yaml.load(body.files["install-config.yaml"]);
      assert.strictEqual(ic.platform.baremetal.bmcVerifyCA, SAMPLE_PEM);
    } finally {
      await closeTestServer(server);
    }
  });
});

// ===================================================================
// Import migration boundary tests
// ===================================================================

describe("bmcVerifyCA — import boundary via POST /api/run/import", () => {
  it("PEM survives real import endpoint", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      await resetState(baseUrl);
      const state = makeAgent421({ bmcVerifyCA: SAMPLE_PEM });
      state.version._schemaVersion = 3;
      const res = await fetch(`${baseUrl}/api/run/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaVersion: 2, state }),
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.state.hostInventory.bmcVerifyCA, SAMPLE_PEM);
    } finally {
      await closeTestServer(server);
    }
  });

  it("undefined bmcVerifyCA remains omitted after real import", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      await resetState(baseUrl);
      const state = makeAgent421();
      state.version._schemaVersion = 3;
      const res = await fetch(`${baseUrl}/api/run/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaVersion: 2, state }),
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.state.hostInventory?.bmcVerifyCA, undefined);
    } finally {
      await closeTestServer(server);
    }
  });
});

// ===================================================================
// Hidden-state suppression and restoration round-trip
// ===================================================================

describe("bmcVerifyCA — suppression and restoration", () => {
  it("retained value suppressed for 4.20, emits again on return to 4.21 Agent", () => {
    const state = makeAgent421({ bmcVerifyCA: SAMPLE_PEM });

    state.version.selectedMinor = "4.20";
    state.version.selectedPatch = "4.20.8";
    state.release.channel = "4.20";
    state.release.patchVersion = "4.20.8";
    const result420 = buildInstallConfig(state);
    const ic420 = parseInstallConfig(result420);
    assert.strictEqual(ic420.platform?.baremetal?.bmcVerifyCA, undefined);

    state.version.selectedMinor = "4.21";
    state.version.selectedPatch = "4.21.0";
    state.release.channel = "4.21";
    state.release.patchVersion = "4.21.0";
    const result421 = buildInstallConfig(state);
    const ic421 = parseInstallConfig(result421);
    assert.strictEqual(ic421.platform.baremetal.bmcVerifyCA, SAMPLE_PEM);
  });

  it("retained value suppressed for UPI, emits again on return to Agent", () => {
    const state = makeAgent421({ bmcVerifyCA: SAMPLE_PEM });

    state.methodology.method = "UPI";
    const resultUpi = buildInstallConfig(state);
    const icUpi = parseInstallConfig(resultUpi);
    assert.strictEqual(icUpi.platform?.baremetal, undefined);

    state.methodology.method = "Agent-Based Installer";
    const resultAgent = buildInstallConfig(state);
    const icAgent = parseInstallConfig(resultAgent);
    assert.strictEqual(icAgent.platform.baremetal.bmcVerifyCA, SAMPLE_PEM);
  });

  it("retained value suppressed for IPI 4.20, emits again on return to IPI 4.21", () => {
    const state = makeIpi421({ bmcVerifyCA: SAMPLE_PEM });

    state.version.selectedMinor = "4.20";
    state.version.selectedPatch = "4.20.8";
    state.release.channel = "4.20";
    state.release.patchVersion = "4.20.8";
    const result420 = buildInstallConfig(state);
    const ic420 = parseInstallConfig(result420);
    assert.strictEqual(ic420.platform?.baremetal?.bmcVerifyCA, undefined);

    state.version.selectedMinor = "4.21";
    state.version.selectedPatch = "4.21.0";
    state.release.channel = "4.21";
    state.release.patchVersion = "4.21.0";
    const result421 = buildInstallConfig(state);
    const ic421 = parseInstallConfig(result421);
    assert.strictEqual(ic421.platform.baremetal.bmcVerifyCA, SAMPLE_PEM);
  });

  it("retained value suppressed for non-bare-metal platform, emits on return", () => {
    const agentState = makeAgent421({ bmcVerifyCA: SAMPLE_PEM });

    const awsState = {
      ...agentState,
      blueprint: { platform: "AWS GovCloud", baseDomain: "example.com", clusterName: "test-cluster" },
      methodology: { method: "IPI" },
      platformConfig: { region: "us-gov-west-1" },
      credentials: { awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE", awsSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
    };
    const resultAws = buildInstallConfig(awsState);
    const icAws = parseInstallConfig(resultAws);
    assert.strictEqual(icAws.platform?.baremetal, undefined);

    const resultAgent = buildInstallConfig(agentState);
    const icAgent = parseInstallConfig(resultAgent);
    assert.strictEqual(icAgent.platform.baremetal.bmcVerifyCA, SAMPLE_PEM);
  });
});

// ===================================================================
// POST /api/state — full boundary matrix
// ===================================================================

describe("bmcVerifyCA — POST /api/state boundary", () => {
  async function postState(baseUrl, patch) {
    return fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  it("valid non-empty string: 200 and exact content persisted", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      await resetState(baseUrl);
      await postState(baseUrl, { hostInventory: { bmcVerifyCA: SAMPLE_PEM } });
      const getRes = await fetch(`${baseUrl}/api/state`);
      const hydrated = await getRes.json();
      assert.strictEqual(hydrated.hostInventory.bmcVerifyCA, SAMPLE_PEM);
    } finally { await closeTestServer(server); }
  });

  it("null: 200 and property absent afterward", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      await resetState(baseUrl);
      await postState(baseUrl, { hostInventory: { bmcVerifyCA: SAMPLE_PEM } });
      await postState(baseUrl, { hostInventory: { bmcVerifyCA: null } });
      const getRes = await fetch(`${baseUrl}/api/state`);
      const hydrated = await getRes.json();
      assert.strictEqual(hydrated.hostInventory?.bmcVerifyCA, undefined);
    } finally { await closeTestServer(server); }
  });

  it("empty string: 200 and property absent afterward", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      await resetState(baseUrl);
      await postState(baseUrl, { hostInventory: { bmcVerifyCA: SAMPLE_PEM } });
      await postState(baseUrl, { hostInventory: { bmcVerifyCA: "" } });
      const getRes = await fetch(`${baseUrl}/api/state`);
      const hydrated = await getRes.json();
      assert.strictEqual(hydrated.hostInventory?.bmcVerifyCA, undefined);
    } finally { await closeTestServer(server); }
  });

  it("whitespace-only: 200 and property absent afterward", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      await resetState(baseUrl);
      await postState(baseUrl, { hostInventory: { bmcVerifyCA: SAMPLE_PEM } });
      await postState(baseUrl, { hostInventory: { bmcVerifyCA: "  \n\t  " } });
      const getRes = await fetch(`${baseUrl}/api/state`);
      const hydrated = await getRes.json();
      assert.strictEqual(hydrated.hostInventory?.bmcVerifyCA, undefined);
    } finally { await closeTestServer(server); }
  });

  it("number: 400 with path and no echo", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await postState(baseUrl, { hostInventory: { bmcVerifyCA: 42 } });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.details[0].path, "hostInventory.bmcVerifyCA");
      assert.ok(!JSON.stringify(body).includes("42"));
    } finally { await closeTestServer(server); }
  });

  it("boolean: 400 with path", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await postState(baseUrl, { hostInventory: { bmcVerifyCA: true } });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.details[0].path, "hostInventory.bmcVerifyCA");
    } finally { await closeTestServer(server); }
  });

  it("object: 400 with path and marker not echoed", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await postState(baseUrl, { hostInventory: { bmcVerifyCA: { marker: "probe-obj" } } });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.details[0].path, "hostInventory.bmcVerifyCA");
      assert.ok(!JSON.stringify(body).includes("probe-obj"));
    } finally { await closeTestServer(server); }
  });

  it("array: 400 with path", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await postState(baseUrl, { hostInventory: { bmcVerifyCA: ["probe-arr"] } });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.details[0].path, "hostInventory.bmcVerifyCA");
      assert.ok(!JSON.stringify(body).includes("probe-arr"));
    } finally { await closeTestServer(server); }
  });

  it("NUL: 400 with path", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await postState(baseUrl, { hostInventory: { bmcVerifyCA: "cert\0data" } });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.details[0].path, "hostInventory.bmcVerifyCA");
    } finally { await closeTestServer(server); }
  });

  it("oversize UTF-8: 400 with path", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await postState(baseUrl, { hostInventory: { bmcVerifyCA: "A".repeat(262145) } });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.details[0].path, "hostInventory.bmcVerifyCA");
    } finally { await closeTestServer(server); }
  });

  it("content with leading/trailing newlines preserved exactly via GET", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      await resetState(baseUrl);
      const val = "\n-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----\n";
      await postState(baseUrl, { hostInventory: { bmcVerifyCA: val } });
      const getRes = await fetch(`${baseUrl}/api/state`);
      const hydrated = await getRes.json();
      assert.strictEqual(hydrated.hostInventory.bmcVerifyCA, val);
    } finally { await closeTestServer(server); }
  });
});

// ===================================================================
// POST /api/run/import — full boundary matrix
// ===================================================================

describe("bmcVerifyCA — POST /api/run/import boundary", () => {
  function makeImportPayload(hiOverrides) {
    const state = makeAgent421(hiOverrides);
    state.version._schemaVersion = 3;
    return { schemaVersion: 2, state };
  }

  async function postImport(baseUrl, payload) {
    return fetch(`${baseUrl}/api/run/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  it("valid non-empty: accepted and exact", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      await resetState(baseUrl);
      const res = await postImport(baseUrl, makeImportPayload({ bmcVerifyCA: SAMPLE_PEM }));
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.state.hostInventory.bmcVerifyCA, SAMPLE_PEM);
    } finally { await closeTestServer(server); }
  });

  it("null: accepted and normalized absent", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      await resetState(baseUrl);
      const res = await postImport(baseUrl, makeImportPayload({ bmcVerifyCA: null }));
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.state.hostInventory?.bmcVerifyCA, undefined);
    } finally { await closeTestServer(server); }
  });

  it("empty: accepted and normalized absent", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      await resetState(baseUrl);
      const res = await postImport(baseUrl, makeImportPayload({ bmcVerifyCA: "" }));
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.state.hostInventory?.bmcVerifyCA, undefined);
    } finally { await closeTestServer(server); }
  });

  it("whitespace-only: accepted and normalized absent", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      await resetState(baseUrl);
      const res = await postImport(baseUrl, makeImportPayload({ bmcVerifyCA: "  \n  " }));
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.state.hostInventory?.bmcVerifyCA, undefined);
    } finally { await closeTestServer(server); }
  });

  it("number: 400 with path and no echo", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await postImport(baseUrl, makeImportPayload({ bmcVerifyCA: 99 }));
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.details[0].path, "hostInventory.bmcVerifyCA");
      assert.ok(!JSON.stringify(body).includes("99"));
    } finally { await closeTestServer(server); }
  });

  it("boolean: 400 with path", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await postImport(baseUrl, makeImportPayload({ bmcVerifyCA: true }));
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.details[0].path, "hostInventory.bmcVerifyCA");
    } finally { await closeTestServer(server); }
  });

  it("object: 400 with path and marker not echoed", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await postImport(baseUrl, makeImportPayload({ bmcVerifyCA: { marker: "probe-import" } }));
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.details[0].path, "hostInventory.bmcVerifyCA");
      assert.ok(!JSON.stringify(body).includes("probe-import"));
    } finally { await closeTestServer(server); }
  });

  it("array: 400 with path", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await postImport(baseUrl, makeImportPayload({ bmcVerifyCA: ["arr"] }));
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.details[0].path, "hostInventory.bmcVerifyCA");
    } finally { await closeTestServer(server); }
  });

  it("NUL: 400 with path", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await postImport(baseUrl, makeImportPayload({ bmcVerifyCA: "cert\0data" }));
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.details[0].path, "hostInventory.bmcVerifyCA");
    } finally { await closeTestServer(server); }
  });

  it("oversize: 400 with path", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await postImport(baseUrl, makeImportPayload({ bmcVerifyCA: "A".repeat(262145) }));
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.details[0].path, "hostInventory.bmcVerifyCA");
    } finally { await closeTestServer(server); }
  });
});

// ===================================================================
// GET /api/run/export — exact content preservation
// ===================================================================

describe("bmcVerifyCA — GET /api/run/export", () => {
  it("value with leading/trailing newlines exported exactly", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      await resetState(baseUrl);
      const val = "\n-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----\n";
      const state = makeAgent421({ bmcVerifyCA: val });
      await fetch(`${baseUrl}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const exportRes = await fetch(`${baseUrl}/api/run/export`);
      assert.strictEqual(exportRes.status, 200);
      const exported = await exportRes.json();
      assert.strictEqual(exported.state.hostInventory.bmcVerifyCA, val);
    } finally { await closeTestServer(server); }
  });

  it("undefined bmcVerifyCA remains omitted in export", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      await resetState(baseUrl);
      const state = makeAgent421();
      state.version._schemaVersion = 3;
      await fetch(`${baseUrl}/api/run/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaVersion: 2, state }),
      });
      const exportRes = await fetch(`${baseUrl}/api/run/export`);
      assert.strictEqual(exportRes.status, 200);
      const exported = await exportRes.json();
      assert.strictEqual(exported.state.hostInventory?.bmcVerifyCA, undefined);
    } finally { await closeTestServer(server); }
  });
});

// ===================================================================
// Generation endpoint tests (via /api/generate)
// ===================================================================

describe("bmcVerifyCA — generation endpoint", () => {
  async function postGenerate(baseUrl, state) {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    return { status: res.status, body: await res.json() };
  }

  it("4.21 IPI: exact value emitted", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await postGenerate(baseUrl, makeIpi421({ bmcVerifyCA: SAMPLE_PEM }));
      assert.strictEqual(status, 200);
      const ic = yaml.load(body.files["install-config.yaml"]);
      assert.strictEqual(ic.platform.baremetal.bmcVerifyCA, SAMPLE_PEM);
    } finally { await closeTestServer(server); }
  });

  it("4.21 Agent multi-node: exact value emitted", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await postGenerate(baseUrl, makeAgent421({ bmcVerifyCA: SAMPLE_PEM }));
      assert.strictEqual(status, 200);
      const ic = yaml.load(body.files["install-config.yaml"]);
      assert.strictEqual(ic.platform.baremetal.bmcVerifyCA, SAMPLE_PEM);
    } finally { await closeTestServer(server); }
  });

  it("4.20: suppressed", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await postGenerate(baseUrl, makeAgent420({ bmcVerifyCA: SAMPLE_PEM }));
      assert.strictEqual(status, 200);
      const ic = yaml.load(body.files["install-config.yaml"]);
      assert.strictEqual(ic.platform?.baremetal?.bmcVerifyCA, undefined);
    } finally { await closeTestServer(server); }
  });

  it("UPI: suppressed (platform.none)", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await postGenerate(baseUrl, makeUpi421({ bmcVerifyCA: SAMPLE_PEM }));
      assert.strictEqual(status, 200);
      const ic = yaml.load(body.files["install-config.yaml"]);
      assert.strictEqual(ic.platform?.baremetal, undefined);
    } finally { await closeTestServer(server); }
  });

  it("Agent SNO: suppressed (platform.none)", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await postGenerate(baseUrl, makeAgentSNO421({ bmcVerifyCA: SAMPLE_PEM }));
      assert.strictEqual(status, 200);
      const ic = yaml.load(body.files["install-config.yaml"]);
      assert.strictEqual(ic.platform?.baremetal, undefined);
    } finally { await closeTestServer(server); }
  });

  it("invalid state reaching generation: fails closed", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status } = await postGenerate(baseUrl, makeAgent421({ bmcVerifyCA: "cert\0bad" }));
      assert.strictEqual(status, 500);
    } finally { await closeTestServer(server); }
  });
});
