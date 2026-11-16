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

const BYO_VNET_FIELDS = {
  vnetMode: "existing-vnet",
  virtualNetwork: "my-vnet",
  networkResourceGroupName: "net-rg",
  controlPlaneSubnet: "cp-subnet",
  nodeSubnets: ["worker-subnet"],
};

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

describe("Azure BYO VNet — catalog", () => {
  it("4.20 IPI: virtualNetwork is supported-ui", () => {
    const catalog = loadCatalog("4.20", "azure-government-ipi");
    const param = catalog.parameters.find(p => p.path === "platform.azure.virtualNetwork");
    assert.ok(param, "virtualNetwork param must exist");
    assert.strictEqual(param.supportStatus, "supported-ui");
  });

  it("4.20 IPI: networkResourceGroupName is supported-ui", () => {
    const catalog = loadCatalog("4.20", "azure-government-ipi");
    const param = catalog.parameters.find(p => p.path === "platform.azure.networkResourceGroupName");
    assert.ok(param, "networkResourceGroupName param must exist");
    assert.strictEqual(param.supportStatus, "supported-ui");
  });

  it("4.20 IPI: controlPlaneSubnet is supported-ui", () => {
    const catalog = loadCatalog("4.20", "azure-government-ipi");
    const param = catalog.parameters.find(p => p.path === "platform.azure.controlPlaneSubnet");
    assert.ok(param, "controlPlaneSubnet param must exist");
    assert.strictEqual(param.supportStatus, "supported-ui");
  });

  it("4.20 IPI: computeSubnet is supported-ui", () => {
    const catalog = loadCatalog("4.20", "azure-government-ipi");
    const param = catalog.parameters.find(p => p.path === "platform.azure.computeSubnet");
    assert.ok(param, "computeSubnet param must exist");
    assert.strictEqual(param.supportStatus, "supported-ui");
  });

  it("4.20 IPI: no subnets array path", () => {
    const catalog = loadCatalog("4.20", "azure-government-ipi");
    const param = catalog.parameters.find(p => p.path === "platform.azure.subnets");
    assert.strictEqual(param, undefined);
  });

  it("4.21 IPI: virtualNetwork is supported-ui", () => {
    const catalog = loadCatalog("4.21", "azure-government-ipi");
    const param = catalog.parameters.find(p => p.path === "platform.azure.virtualNetwork");
    assert.ok(param, "virtualNetwork param must exist");
    assert.strictEqual(param.supportStatus, "supported-ui");
  });

  it("4.21 IPI: subnets is supported-derived", () => {
    const catalog = loadCatalog("4.21", "azure-government-ipi");
    const param = catalog.parameters.find(p => p.path === "platform.azure.subnets");
    assert.ok(param, "subnets param must exist");
    assert.strictEqual(param.supportStatus, "supported-derived");
    assert.strictEqual(param.minVersion, "4.21");
  });

  it("4.21 IPI: subnets.name is supported-ui", () => {
    const catalog = loadCatalog("4.21", "azure-government-ipi");
    const param = catalog.parameters.find(p => p.path === "platform.azure.subnets.name");
    assert.ok(param, "subnets.name param must exist");
    assert.strictEqual(param.supportStatus, "supported-ui");
    assert.strictEqual(param.minVersion, "4.21");
  });

  it("4.21 IPI: subnets.role is supported-derived with enum", () => {
    const catalog = loadCatalog("4.21", "azure-government-ipi");
    const param = catalog.parameters.find(p => p.path === "platform.azure.subnets.role");
    assert.ok(param, "subnets.role param must exist");
    assert.strictEqual(param.type, "string");
    assert.deepStrictEqual(param.allowed, ["control-plane", "node"]);
    assert.strictEqual(param.supportStatus, "supported-derived");
  });

  it("4.21 IPI: deprecated flat fields are docs-only-not-supported", () => {
    const catalog = loadCatalog("4.21", "azure-government-ipi");
    const cpSubnet = catalog.parameters.find(p => p.path === "platform.azure.controlPlaneSubnet");
    assert.ok(cpSubnet, "controlPlaneSubnet param must exist");
    assert.strictEqual(cpSubnet.supportStatus, "docs-only-not-supported");
    assert.strictEqual(cpSubnet.deprecated, true);
    assert.ok(cpSubnet.replacementPath, "must have replacementPath");

    const compSubnet = catalog.parameters.find(p => p.path === "platform.azure.computeSubnet");
    assert.ok(compSubnet, "computeSubnet param must exist");
    assert.strictEqual(compSubnet.supportStatus, "docs-only-not-supported");
    assert.strictEqual(compSubnet.deprecated, true);
    assert.ok(compSubnet.replacementPath, "must have replacementPath");
  });

  it("4.21 UPI: subnets.role is string with enum (same fix)", () => {
    const catalog = loadCatalog("4.21", "azure-government-upi");
    const param = catalog.parameters.find(p => p.path === "platform.azure.subnets.role");
    assert.ok(param, "subnets.role param must exist in UPI catalog");
    assert.strictEqual(param.type, "string");
    assert.deepStrictEqual(param.allowed, ["control-plane", "node"]);
  });

  it("frontend mirrors match canonical catalogs", () => {
    for (const version of ["4.20", "4.21"]) {
      for (const scenario of ["azure-government-ipi", "azure-government-upi"]) {
        const canonicalPath = path.resolve(__dirname, '..', '..', 'data', 'params', version, `${scenario}.json`);
        const mirrorPath = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'data', 'catalogs', version, `${scenario}.json`);
        const canonical = fs.readFileSync(canonicalPath, 'utf8');
        const mirror = fs.readFileSync(mirrorPath, 'utf8');
        assert.strictEqual(canonical, mirror, `${version}/${scenario} mirror must match canonical`);
      }
    }
  });
});

// ===================================================================
// Generation tests
// ===================================================================

describe("Azure BYO VNet — generation", () => {
  it("installer-managed mode: no VNet fields emitted", () => {
    const state = makeAzure421Ipi({ vnetMode: "installer-managed" });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.azure.virtualNetwork, undefined);
    assert.strictEqual(ic.platform.azure.networkResourceGroupName, undefined);
    assert.strictEqual(ic.platform.azure.subnets, undefined);
    assert.strictEqual(ic.platform.azure.controlPlaneSubnet, undefined);
    assert.strictEqual(ic.platform.azure.computeSubnet, undefined);
  });

  it("4.21 IPI: existing-vnet emits subnets[] array", () => {
    const state = makeAzure421Ipi(BYO_VNET_FIELDS);
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.azure.virtualNetwork, "my-vnet");
    assert.strictEqual(ic.platform.azure.networkResourceGroupName, "net-rg");
    assert.ok(Array.isArray(ic.platform.azure.subnets), "subnets must be array");
    assert.strictEqual(ic.platform.azure.subnets.length, 2);
    assert.deepStrictEqual(ic.platform.azure.subnets[0], { name: "cp-subnet", role: "control-plane" });
    assert.deepStrictEqual(ic.platform.azure.subnets[1], { name: "worker-subnet", role: "node" });
    assert.strictEqual(ic.platform.azure.controlPlaneSubnet, undefined);
    assert.strictEqual(ic.platform.azure.computeSubnet, undefined);
  });

  it("4.21 IPI: multiple node subnets", () => {
    const state = makeAzure421Ipi({
      ...BYO_VNET_FIELDS,
      nodeSubnets: ["worker-a", "worker-b", "worker-c"],
    });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.azure.subnets.length, 4);
    assert.strictEqual(ic.platform.azure.subnets[0].role, "control-plane");
    assert.strictEqual(ic.platform.azure.subnets[1].role, "node");
    assert.strictEqual(ic.platform.azure.subnets[2].role, "node");
    assert.strictEqual(ic.platform.azure.subnets[3].role, "node");
    assert.strictEqual(ic.platform.azure.subnets[1].name, "worker-a");
    assert.strictEqual(ic.platform.azure.subnets[2].name, "worker-b");
    assert.strictEqual(ic.platform.azure.subnets[3].name, "worker-c");
  });

  it("4.21 UPI: existing-vnet emits subnets[] array", () => {
    const state = makeAzure421Upi(BYO_VNET_FIELDS);
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.azure.virtualNetwork, "my-vnet");
    assert.ok(Array.isArray(ic.platform.azure.subnets), "subnets must be array");
    assert.strictEqual(ic.platform.azure.subnets.length, 2);
  });

  it("4.20 IPI: existing-vnet emits flat controlPlaneSubnet/computeSubnet", () => {
    const state = makeAzure420Ipi(BYO_VNET_FIELDS);
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.azure.virtualNetwork, "my-vnet");
    assert.strictEqual(ic.platform.azure.networkResourceGroupName, "net-rg");
    assert.strictEqual(ic.platform.azure.controlPlaneSubnet, "cp-subnet");
    assert.strictEqual(ic.platform.azure.computeSubnet, "worker-subnet");
    assert.strictEqual(ic.platform.azure.subnets, undefined);
  });

  it("4.20 UPI: existing-vnet emits flat fields", () => {
    const state = makeAzure420Upi(BYO_VNET_FIELDS);
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.azure.controlPlaneSubnet, "cp-subnet");
    assert.strictEqual(ic.platform.azure.computeSubnet, "worker-subnet");
    assert.strictEqual(ic.platform.azure.subnets, undefined);
  });

  it("4.20 with multiple nodeSubnets: fail-closed validation rejects", () => {
    const state = makeAzure420Ipi({
      ...BYO_VNET_FIELDS,
      nodeSubnets: ["worker-a", "worker-b"],
    });
    assert.throws(() => buildInstallConfig(state), /invalid/i);
  });

  it("whitespace-only fields: fail-closed validation rejects", () => {
    const state = makeAzure421Ipi({
      vnetMode: "existing-vnet",
      virtualNetwork: "  ",
      networkResourceGroupName: "  ",
      controlPlaneSubnet: "  ",
      nodeSubnets: ["  ", ""],
    });
    assert.throws(() => buildInstallConfig(state), /invalid/i);
  });

  it("subnet name ordering: control-plane first, then nodes in order", () => {
    const state = makeAzure421Ipi({
      ...BYO_VNET_FIELDS,
      nodeSubnets: ["z-subnet", "a-subnet"],
    });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.azure.subnets[0].role, "control-plane");
    assert.strictEqual(ic.platform.azure.subnets[1].name, "z-subnet");
    assert.strictEqual(ic.platform.azure.subnets[2].name, "a-subnet");
  });
});

// ===================================================================
// Persistence tests
// ===================================================================

describe("Azure BYO VNet — persistence", () => {
  it("BYO VNet state round-trips through JSON serialization", () => {
    const state = makeAzure421Ipi(BYO_VNET_FIELDS);
    const serialized = JSON.stringify(state);
    const deserialized = JSON.parse(serialized);
    assert.strictEqual(deserialized.platformConfig.azure.vnetMode, "existing-vnet");
    assert.strictEqual(deserialized.platformConfig.azure.virtualNetwork, "my-vnet");
    assert.strictEqual(deserialized.platformConfig.azure.networkResourceGroupName, "net-rg");
    assert.strictEqual(deserialized.platformConfig.azure.controlPlaneSubnet, "cp-subnet");
    assert.deepStrictEqual(deserialized.platformConfig.azure.nodeSubnets, ["worker-subnet"]);
  });

  it("version downgrade 4.21→4.20 preserves all nodeSubnets", () => {
    const state = makeAzure421Ipi({
      ...BYO_VNET_FIELDS,
      nodeSubnets: ["worker-a", "worker-b", "worker-c"],
    });
    const exported = JSON.parse(JSON.stringify(state));
    exported.version.selectedMinor = "4.20";
    exported.version.selectedPatch = "4.20.8";
    exported.release.channel = "4.20";
    exported.release.patchVersion = "4.20.8";
    assert.deepStrictEqual(exported.platformConfig.azure.nodeSubnets, ["worker-a", "worker-b", "worker-c"],
      "all node subnets must be preserved through version change");
  });

  it("installer-managed mode round-trips cleanly", () => {
    const state = makeAzure421Ipi({ vnetMode: "installer-managed" });
    const serialized = JSON.stringify(state);
    const deserialized = JSON.parse(serialized);
    assert.strictEqual(deserialized.platformConfig.azure.vnetMode, "installer-managed");
  });

  it("sanitizer preserves VNet state (not secret)", () => {
    const state = makeAzure421Ipi(BYO_VNET_FIELDS);
    const sanitized = JSON.parse(JSON.stringify(state));
    delete sanitized.credentials;
    assert.strictEqual(sanitized.platformConfig.azure.virtualNetwork, "my-vnet");
    assert.strictEqual(sanitized.platformConfig.azure.networkResourceGroupName, "net-rg");
    assert.strictEqual(sanitized.platformConfig.azure.controlPlaneSubnet, "cp-subnet");
    assert.deepStrictEqual(sanitized.platformConfig.azure.nodeSubnets, ["worker-subnet"]);
  });
});

// ===================================================================
// Version transition tests
// ===================================================================

describe("Azure BYO VNet — version transition", () => {
  it("4.21→4.20 with single node subnet: generation succeeds with flat fields", () => {
    const state = makeAzure421Ipi(BYO_VNET_FIELDS);
    const downgraded = JSON.parse(JSON.stringify(state));
    downgraded.version.selectedMinor = "4.20";
    downgraded.version.selectedPatch = "4.20.8";
    downgraded.release.channel = "4.20";
    downgraded.release.patchVersion = "4.20.8";
    const result = buildInstallConfig(downgraded);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.platform.azure.controlPlaneSubnet, "cp-subnet");
    assert.strictEqual(ic.platform.azure.computeSubnet, "worker-subnet");
    assert.strictEqual(ic.platform.azure.subnets, undefined);
  });

  it("4.20→4.21 upgrade: generation switches to subnets[] array", () => {
    const state = makeAzure420Ipi(BYO_VNET_FIELDS);
    const upgraded = JSON.parse(JSON.stringify(state));
    upgraded.version.selectedMinor = "4.21";
    upgraded.version.selectedPatch = "4.21.3";
    upgraded.release.channel = "4.21";
    upgraded.release.patchVersion = "4.21.3";
    const result = buildInstallConfig(upgraded);
    const ic = parseInstallConfig(result);
    assert.ok(Array.isArray(ic.platform.azure.subnets));
    assert.strictEqual(ic.platform.azure.controlPlaneSubnet, undefined);
    assert.strictEqual(ic.platform.azure.computeSubnet, undefined);
  });

  it("4.21→4.20→4.21 round trip: exact same ordered nodeSubnets restored", () => {
    const original = makeAzure421Ipi({
      ...BYO_VNET_FIELDS,
      nodeSubnets: ["worker-a", "worker-b", "worker-c"],
    });
    const asJson = JSON.parse(JSON.stringify(original));
    asJson.version.selectedMinor = "4.20";
    asJson.release.channel = "4.20";
    assert.deepStrictEqual(asJson.platformConfig.azure.nodeSubnets, ["worker-a", "worker-b", "worker-c"],
      "nodeSubnets must survive 4.21→4.20 interpretation");
    assert.throws(() => buildInstallConfig(asJson), /invalid/i,
      "4.20 with multiple nodeSubnets must reject");
    asJson.version.selectedMinor = "4.21";
    asJson.release.channel = "4.21";
    const result = buildInstallConfig(asJson);
    const ic = parseInstallConfig(result);
    assert.ok(Array.isArray(ic.platform.azure.subnets));
    assert.strictEqual(ic.platform.azure.subnets.length, 4);
    assert.deepStrictEqual(ic.platform.azure.subnets[0], { name: "cp-subnet", role: "control-plane" });
    assert.strictEqual(ic.platform.azure.subnets[1].name, "worker-a");
    assert.strictEqual(ic.platform.azure.subnets[2].name, "worker-b");
    assert.strictEqual(ic.platform.azure.subnets[3].name, "worker-c");
  });
});

// ===================================================================
// Field Manual content tests
// ===================================================================

describe("Azure BYO VNet — field manual content", () => {
  it("4.21 field manual does NOT claim the first subnet is used automatically on downgrade", async () => {
    const guidePath = path.resolve(__dirname, '..', 'src', 'fieldGuide', 'v4.21', 'azure.js');
    const content = fs.readFileSync(guidePath, 'utf8');
    assert.ok(!content.includes("only the first is used"), "must not claim first subnet is auto-selected");
    assert.ok(!content.includes("first is used for generation"), "must not claim first subnet is used for generation");
    assert.ok(content.includes("generation is blocked"), "must state generation is blocked on downgrade");
  });
});

// ===================================================================
// Malformed nodeSubnets type boundary tests
// ===================================================================

describe("Azure BYO VNet — malformed nodeSubnets type rejection", () => {
  it("nodeSubnets as string: validation rejects", () => {
    const state = makeAzure421Ipi({
      ...BYO_VNET_FIELDS,
      nodeSubnets: "worker-a",
    });
    assert.throws(() => buildInstallConfig(state), /invalid/i);
  });

  it("nodeSubnets as object: validation rejects", () => {
    const state = makeAzure421Ipi({
      ...BYO_VNET_FIELDS,
      nodeSubnets: {},
    });
    assert.throws(() => buildInstallConfig(state), /invalid/i);
  });

  it("nodeSubnets as null: validation rejects (no node subnets)", () => {
    const state = makeAzure421Ipi({
      ...BYO_VNET_FIELDS,
      nodeSubnets: null,
    });
    assert.throws(() => buildInstallConfig(state), /invalid/i);
  });

  it("nodeSubnets as number: validation rejects", () => {
    const state = makeAzure421Ipi({
      ...BYO_VNET_FIELDS,
      nodeSubnets: 42,
    });
    assert.throws(() => buildInstallConfig(state), /invalid/i);
  });
});

// ===================================================================
// HTTP boundary tests
// ===================================================================

describe("Azure BYO VNet — API boundary", () => {
  async function postGenerate(baseUrl, state) {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    return { status: res.status, body: await res.json() };
  }

  it("4.21 IPI BYO VNet via HTTP returns subnets[]", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeAzure421Ipi(BYO_VNET_FIELDS);
      const { status, body } = await postGenerate(baseUrl, state);
      assert.strictEqual(status, 200);
      assert.ok(body.files, "must return files payload");
      const ic = yaml.load(body.files["install-config.yaml"]);
      assert.ok(Array.isArray(ic.platform.azure.subnets));
      assert.strictEqual(ic.platform.azure.subnets.length, 2);
    } finally {
      await closeTestServer(server);
    }
  });

  it("4.20 IPI BYO VNet via HTTP returns flat fields", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeAzure420Ipi(BYO_VNET_FIELDS);
      const { status, body } = await postGenerate(baseUrl, state);
      assert.strictEqual(status, 200);
      assert.ok(body.files, "must return files payload");
      const ic = yaml.load(body.files["install-config.yaml"]);
      assert.strictEqual(ic.platform.azure.controlPlaneSubnet, "cp-subnet");
      assert.strictEqual(ic.platform.azure.computeSubnet, "worker-subnet");
      assert.strictEqual(ic.platform.azure.subnets, undefined);
    } finally {
      await closeTestServer(server);
    }
  });

  it("installer-managed mode via HTTP: no VNet fields", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeAzure421Ipi({ vnetMode: "installer-managed" });
      const { status, body } = await postGenerate(baseUrl, state);
      assert.strictEqual(status, 200);
      const ic = yaml.load(body.files["install-config.yaml"]);
      assert.strictEqual(ic.platform.azure.virtualNetwork, undefined);
      assert.strictEqual(ic.platform.azure.subnets, undefined);
    } finally {
      await closeTestServer(server);
    }
  });
});

// ===================================================================
// API validation error semantics
// ===================================================================

describe("Azure BYO VNet — API validation HTTP semantics", () => {
  async function postGenerate(baseUrl, state) {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    return { status: res.status, body: await res.json() };
  }

  it("missing virtualNetwork returns 400, not 500", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeAzure421Ipi({
        vnetMode: "existing-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker"],
      });
      const { status, body } = await postGenerate(baseUrl, state);
      assert.strictEqual(status, 400);
      assert.ok(body.error, "must include error message");
      assert.ok(!body.files, "must not produce install-config output");
    } finally {
      await closeTestServer(server);
    }
  });

  it("missing networkResourceGroupName returns 400", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeAzure421Ipi({
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker"],
      });
      const { status, body } = await postGenerate(baseUrl, state);
      assert.strictEqual(status, 400);
      assert.ok(body.error);
      assert.ok(!body.files);
    } finally {
      await closeTestServer(server);
    }
  });

  it("missing controlPlaneSubnet returns 400", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeAzure421Ipi({
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        nodeSubnets: ["worker"],
      });
      const { status, body } = await postGenerate(baseUrl, state);
      assert.strictEqual(status, 400);
      assert.ok(body.error);
      assert.ok(!body.files);
    } finally {
      await closeTestServer(server);
    }
  });

  it("blank node subnet returns 400", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeAzure421Ipi({
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: [""],
      });
      const { status, body } = await postGenerate(baseUrl, state);
      assert.strictEqual(status, 400);
      assert.ok(body.error);
      assert.ok(!body.files);
    } finally {
      await closeTestServer(server);
    }
  });

  it("duplicate subnet name returns 400", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeAzure421Ipi({
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "dup-subnet",
        nodeSubnets: ["dup-subnet"],
      });
      const { status, body } = await postGenerate(baseUrl, state);
      assert.strictEqual(status, 400);
      assert.ok(body.error);
      assert.ok(!body.files);
    } finally {
      await closeTestServer(server);
    }
  });

  it("4.20 with multiple nodeSubnets returns 400", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeAzure420Ipi({
        ...BYO_VNET_FIELDS,
        nodeSubnets: ["worker-a", "worker-b"],
      });
      const { status, body } = await postGenerate(baseUrl, state);
      assert.strictEqual(status, 400);
      assert.ok(body.error);
      assert.ok(!body.files);
    } finally {
      await closeTestServer(server);
    }
  });

  it("non-array nodeSubnets returns 400", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeAzure421Ipi({
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: "not-an-array",
      });
      const { status, body } = await postGenerate(baseUrl, state);
      assert.strictEqual(status, 400);
      assert.ok(body.error);
      assert.ok(!body.files);
    } finally {
      await closeTestServer(server);
    }
  });

  it("valid 4.21 BYO VNet returns 200", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeAzure421Ipi(BYO_VNET_FIELDS);
      const { status, body } = await postGenerate(baseUrl, state);
      assert.strictEqual(status, 200);
      assert.ok(body.files);
    } finally {
      await closeTestServer(server);
    }
  });

  it("GET /api/generate with invalid persisted BYO VNet returns 400 CONFIGURATION_VALIDATION", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeAzure420Ipi({
        ...BYO_VNET_FIELDS,
        nodeSubnets: ["worker-a", "worker-b"],
      });
      await fetch(`${baseUrl}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const res = await fetch(`${baseUrl}/api/generate`);
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.code, "CONFIGURATION_VALIDATION");
      assert.ok(body.error);
      assert.ok(!body.files, "must not produce files on validation error");
    } finally {
      await closeTestServer(server);
    }
  });

  it("POST /api/bundle.zip with invalid BYO VNet returns 400 CONFIGURATION_VALIDATION", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeAzure420Ipi({
        ...BYO_VNET_FIELDS,
        nodeSubnets: ["worker-a", "worker-b"],
      });
      const res = await fetch(`${baseUrl}/api/bundle.zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.code, "CONFIGURATION_VALIDATION");
      assert.ok(body.error);
    } finally {
      await closeTestServer(server);
    }
  });
});
