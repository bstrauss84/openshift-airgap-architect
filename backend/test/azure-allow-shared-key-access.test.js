import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { buildInstallConfig } from "../src/generate.js";
import { azureGovernmentIpi } from "./fixtures/base-states.js";
import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const makeAzure421Ipi = (azureOverrides = {}) => azureGovernmentIpi({
  version: { selectedMinor: "4.21", selectedPatch: "4.21.3" },
  release: { channel: "4.21", patchVersion: "4.21.3" },
  platformConfig: {
    region: "usgovvirginia",
    azure: {
      region: "usgovvirginia",
      baseDomainResourceGroupName: "dns-rg",
      ...azureOverrides,
    },
  },
});

const makeAzure421Upi = (azureOverrides = {}) => azureGovernmentIpi({
  version: { selectedMinor: "4.21", selectedPatch: "4.21.3" },
  release: { channel: "4.21", patchVersion: "4.21.3" },
  methodology: { method: "UPI" },
  platformConfig: {
    region: "usgovvirginia",
    azure: {
      region: "usgovvirginia",
      baseDomainResourceGroupName: "dns-rg",
      ...azureOverrides,
    },
  },
});

const makeAzure420Ipi = (azureOverrides = {}) => azureGovernmentIpi({
  version: { selectedMinor: "4.20", selectedPatch: "4.20.8" },
  release: { channel: "4.20", patchVersion: "4.20.8" },
  platformConfig: {
    region: "usgovvirginia",
    azure: {
      region: "usgovvirginia",
      baseDomainResourceGroupName: "dns-rg",
      ...azureOverrides,
    },
  },
});

const makeAzure420Upi = (azureOverrides = {}) => azureGovernmentIpi({
  version: { selectedMinor: "4.20", selectedPatch: "4.20.8" },
  release: { channel: "4.20", patchVersion: "4.20.8" },
  methodology: { method: "UPI" },
  platformConfig: {
    region: "usgovvirginia",
    azure: {
      region: "usgovvirginia",
      baseDomainResourceGroupName: "dns-rg",
      ...azureOverrides,
    },
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
// Catalog tests
// ===================================================================

describe("Azure allowSharedKeyAccess — catalog", () => {
  it("4.20 Azure IPI has no allowSharedKeyAccess path", () => {
    const catalog = loadCatalog("4.20", "azure-government-ipi");
    const params = catalog.parameters.filter(p => p.path === "platform.azure.allowSharedKeyAccess");
    assert.strictEqual(params.length, 0);
  });

  it("4.20 Azure UPI has no allowSharedKeyAccess path", () => {
    const catalog = loadCatalog("4.20", "azure-government-upi");
    const params = catalog.parameters.filter(p => p.path === "platform.azure.allowSharedKeyAccess");
    assert.strictEqual(params.length, 0);
  });

  it("4.21 Azure IPI path is supported-ui and boolean", () => {
    const catalog = loadCatalog("4.21", "azure-government-ipi");
    const param = catalog.parameters.find(p => p.path === "platform.azure.allowSharedKeyAccess");
    assert.ok(param, "allowSharedKeyAccess param must exist");
    assert.strictEqual(param.supportStatus, "supported-ui");
    assert.strictEqual(param.type, "boolean");
    assert.strictEqual(param.minVersion, "4.21");
    assert.strictEqual(param.maxVersion, null);
  });

  it("4.21 Azure UPI path is supported-ui and boolean", () => {
    const catalog = loadCatalog("4.21", "azure-government-upi");
    const param = catalog.parameters.find(p => p.path === "platform.azure.allowSharedKeyAccess");
    assert.ok(param, "allowSharedKeyAccess param must exist");
    assert.strictEqual(param.supportStatus, "supported-ui");
    assert.strictEqual(param.type, "boolean");
    assert.strictEqual(param.minVersion, "4.21");
    assert.strictEqual(param.maxVersion, null);
  });

  it("canonical and frontend mirrors are identical for IPI", () => {
    const canonicalPath = path.resolve(__dirname, '..', '..', 'data', 'params', '4.21', 'azure-government-ipi.json');
    const mirrorPath = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'data', 'catalogs', '4.21', 'azure-government-ipi.json');
    const canonical = fs.readFileSync(canonicalPath, 'utf8');
    const mirror = fs.readFileSync(mirrorPath, 'utf8');
    assert.strictEqual(canonical, mirror);
  });

  it("canonical and frontend mirrors are identical for UPI", () => {
    const canonicalPath = path.resolve(__dirname, '..', '..', 'data', 'params', '4.21', 'azure-government-upi.json');
    const mirrorPath = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'data', 'catalogs', '4.21', 'azure-government-upi.json');
    const canonical = fs.readFileSync(canonicalPath, 'utf8');
    const mirror = fs.readFileSync(mirrorPath, 'utf8');
    assert.strictEqual(canonical, mirror);
  });
});

// ===================================================================
// Generation tests
// ===================================================================

describe("Azure allowSharedKeyAccess — generation", () => {
  it("4.21 Azure IPI explicit true emits true", () => {
    const state = makeAzure421Ipi({ allowSharedKeyAccess: true });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.azure.allowSharedKeyAccess, true);
  });

  it("4.21 Azure IPI explicit false emits false", () => {
    const state = makeAzure421Ipi({ allowSharedKeyAccess: false });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.azure.allowSharedKeyAccess, false);
  });

  it("4.21 Azure UPI explicit true emits true", () => {
    const state = makeAzure421Upi({ allowSharedKeyAccess: true });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.azure.allowSharedKeyAccess, true);
  });

  it("4.21 Azure UPI explicit false emits false", () => {
    const state = makeAzure421Upi({ allowSharedKeyAccess: false });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.azure.allowSharedKeyAccess, false);
  });

  it("undefined omits field", () => {
    const state = makeAzure421Ipi();
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.azure.allowSharedKeyAccess, undefined);
  });

  it("4.20 stale true is suppressed", () => {
    const state = makeAzure420Ipi({ allowSharedKeyAccess: true });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform?.azure?.allowSharedKeyAccess, undefined);
  });

  it("4.20 stale false is suppressed", () => {
    const state = makeAzure420Ipi({ allowSharedKeyAccess: false });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform?.azure?.allowSharedKeyAccess, undefined);
  });

  it("non-Azure stale value is suppressed", () => {
    const state = {
      ...makeAzure421Ipi({ allowSharedKeyAccess: false }),
      blueprint: {
        platform: "Bare Metal",
        baseDomain: "example.com",
        clusterName: "test-cluster",
      },
      methodology: { method: "Agent-Based Installer" },
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
      },
    };
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform?.azure, undefined);
  });
});

// ===================================================================
// Invalid production state rejection
// ===================================================================

describe("Azure allowSharedKeyAccess — buildInstallConfig rejection", () => {
  it('rejects string "true"', () => {
    const state = makeAzure421Ipi({ allowSharedKeyAccess: "true" });
    assert.throws(() => buildInstallConfig(state), /must be a boolean/);
  });

  it('rejects string "false"', () => {
    const state = makeAzure421Ipi({ allowSharedKeyAccess: "false" });
    assert.throws(() => buildInstallConfig(state), /must be a boolean/);
  });

  it("rejects 0", () => {
    const state = makeAzure421Ipi({ allowSharedKeyAccess: 0 });
    assert.throws(() => buildInstallConfig(state), /must be a boolean/);
  });

  it("rejects 1", () => {
    const state = makeAzure421Ipi({ allowSharedKeyAccess: 1 });
    assert.throws(() => buildInstallConfig(state), /must be a boolean/);
  });

  it("rejects object", () => {
    const state = makeAzure421Ipi({ allowSharedKeyAccess: {} });
    assert.throws(() => buildInstallConfig(state), /must be a boolean/);
  });

  it("rejects array", () => {
    const state = makeAzure421Ipi({ allowSharedKeyAccess: [] });
    assert.throws(() => buildInstallConfig(state), /must be a boolean/);
  });
});

// ===================================================================
// Persistence / import-export tests
// ===================================================================

describe("Azure allowSharedKeyAccess — persistence", () => {
  it("undefined round trip remains undefined", () => {
    const state = makeAzure421Ipi();
    const serialized = JSON.stringify(state);
    const deserialized = JSON.parse(serialized);
    assert.strictEqual(deserialized.platformConfig.azure.allowSharedKeyAccess, undefined);
  });

  it("true round trip remains true", () => {
    const state = makeAzure421Ipi({ allowSharedKeyAccess: true });
    const serialized = JSON.stringify(state);
    const deserialized = JSON.parse(serialized);
    assert.strictEqual(deserialized.platformConfig.azure.allowSharedKeyAccess, true);
  });

  it("false round trip remains false", () => {
    const state = makeAzure421Ipi({ allowSharedKeyAccess: false });
    const serialized = JSON.stringify(state);
    const deserialized = JSON.parse(serialized);
    assert.strictEqual(deserialized.platformConfig.azure.allowSharedKeyAccess, false);
  });

  it("export/import retains explicit false", () => {
    const state = makeAzure421Ipi({ allowSharedKeyAccess: false });
    const exported = JSON.parse(JSON.stringify(state));
    const imported = JSON.parse(JSON.stringify(exported));
    assert.strictEqual(imported.platformConfig.azure.allowSharedKeyAccess, false);
    const result = buildInstallConfig(imported);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.azure.allowSharedKeyAccess, false);
  });

  it("hidden stale value remains suppressed", () => {
    const state = makeAzure421Ipi({ allowSharedKeyAccess: false });
    const exported = JSON.parse(JSON.stringify(state));
    exported.version.selectedMinor = "4.20";
    exported.version.selectedPatch = "4.20.8";
    exported.release.channel = "4.20";
    exported.release.patchVersion = "4.20.8";
    assert.strictEqual(exported.platformConfig.azure.allowSharedKeyAccess, false);
    const result = buildInstallConfig(exported);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform?.azure?.allowSharedKeyAccess, undefined);
  });
});

// ===================================================================
// HTTP boundary tests
// ===================================================================

describe("Azure allowSharedKeyAccess — API rejection", () => {
  async function postGenerate(baseUrl, azureOverrides) {
    const state = makeAzure421Ipi(azureOverrides);
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    return { status: res.status, body: await res.json() };
  }

  it('rejects string "true" via HTTP with clear error and no files', async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await postGenerate(baseUrl, { allowSharedKeyAccess: "true" });
      assert.strictEqual(status, 500);
      assert.ok(body.error.includes("must be a boolean"), "error must mention boolean");
      assert.strictEqual(body.files, undefined, "no files payload");
    } finally {
      await closeTestServer(server);
    }
  });

  it("accepts explicit true via HTTP", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await postGenerate(baseUrl, { allowSharedKeyAccess: true });
      assert.strictEqual(status, 200);
      assert.ok(body.files, "must return files payload");
      const ic = yaml.load(body.files["install-config.yaml"]);
      assert.strictEqual(ic.platform.azure.allowSharedKeyAccess, true);
    } finally {
      await closeTestServer(server);
    }
  });

  it("accepts explicit false via HTTP", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await postGenerate(baseUrl, { allowSharedKeyAccess: false });
      assert.strictEqual(status, 200);
      assert.ok(body.files, "must return files payload");
      const ic = yaml.load(body.files["install-config.yaml"]);
      assert.strictEqual(ic.platform.azure.allowSharedKeyAccess, false);
    } finally {
      await closeTestServer(server);
    }
  });
});
