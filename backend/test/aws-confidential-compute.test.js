import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { buildInstallConfig, validateAwsConfidentialCompute, VALID_CONFIDENTIAL_COMPUTE_POLICIES } from "../src/generate.js";
import { awsGovcloudIpi } from "./fixtures/base-states.js";
import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const makeAws421Ipi = (platformOverrides = {}) => awsGovcloudIpi({
  version: { selectedMinor: "4.21", selectedPatch: "4.21.3" },
  release: { channel: "4.21", patchVersion: "4.21.3" },
  platformConfig: {
    region: "us-gov-west-1",
    aws: { ...platformOverrides },
  },
});

const makeAws420Ipi = (platformOverrides = {}) => awsGovcloudIpi({
  version: { selectedMinor: "4.20", selectedPatch: "4.20.8" },
  release: { channel: "4.20", patchVersion: "4.20.8" },
  platformConfig: {
    region: "us-gov-west-1",
    aws: { ...platformOverrides },
  },
});

const makeAws421Upi = (platformOverrides = {}) => awsGovcloudIpi({
  version: { selectedMinor: "4.21", selectedPatch: "4.21.3" },
  release: { channel: "4.21", patchVersion: "4.21.3" },
  methodology: { method: "UPI" },
  platformConfig: {
    region: "us-gov-west-1",
    aws: { ...platformOverrides },
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
// Production validation tests (validateAwsConfidentialCompute)
// ===================================================================

describe("AWS confidential compute — production validation", () => {
  it("Disabled accepted", () => {
    const result = validateAwsConfidentialCompute("Disabled");
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, "Disabled");
  });

  it("AMDEncryptedVirtualizationNestedPaging accepted", () => {
    const result = validateAwsConfidentialCompute("AMDEncryptedVirtualizationNestedPaging");
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, "AMDEncryptedVirtualizationNestedPaging");
  });

  it("undefined returns valid+blank", () => {
    assert.deepStrictEqual(validateAwsConfidentialCompute(undefined), { valid: true, blank: true });
  });

  it("null returns valid+blank", () => {
    assert.deepStrictEqual(validateAwsConfidentialCompute(null), { valid: true, blank: true });
  });

  it("empty string returns valid+blank", () => {
    assert.deepStrictEqual(validateAwsConfidentialCompute(""), { valid: true, blank: true });
  });

  it("invalid string throws", () => {
    assert.throws(() => validateAwsConfidentialCompute("invalid"), /must be one of/);
  });

  it("boolean throws", () => {
    assert.throws(() => validateAwsConfidentialCompute(true), /must be a string/);
  });

  it("number throws", () => {
    assert.throws(() => validateAwsConfidentialCompute(42), /must be a string/);
  });

  it("object throws", () => {
    assert.throws(() => validateAwsConfidentialCompute({}), /must be a string/);
  });

  it("array throws", () => {
    assert.throws(() => validateAwsConfidentialCompute([]), /must be a string/);
  });

  it("exported enum has exactly two values", () => {
    assert.deepStrictEqual(VALID_CONFIDENTIAL_COMPUTE_POLICIES, ["Disabled", "AMDEncryptedVirtualizationNestedPaging"]);
  });
});

// ===================================================================
// Catalog tests
// ===================================================================

describe("AWS confidential compute — catalog", () => {
  it("4.20 IPI has no cpuOptions or confidentialCompute path", () => {
    const catalog = loadCatalog("4.20", "aws-govcloud-ipi");
    const ccParams = catalog.parameters.filter(p =>
      p.path.includes("cpuOptions") || p.path.includes("confidentialCompute")
    );
    assert.strictEqual(ccParams.length, 0);
  });

  it("4.21 IPI confidentialCompute type is string", () => {
    const catalog = loadCatalog("4.21", "aws-govcloud-ipi");
    const param = catalog.parameters.find(p =>
      p.path === "controlPlane.platform.aws.cpuOptions.confidentialCompute"
    );
    assert.ok(param, "confidentialCompute param must exist");
    assert.strictEqual(param.type, "string");
  });

  it("4.21 IPI confidentialCompute has exact enum values", () => {
    const catalog = loadCatalog("4.21", "aws-govcloud-ipi");
    const param = catalog.parameters.find(p =>
      p.path === "controlPlane.platform.aws.cpuOptions.confidentialCompute"
    );
    assert.ok(param);
    assert.deepStrictEqual(param.allowed, ["Disabled", "AMDEncryptedVirtualizationNestedPaging"]);
  });

  it("4.21 IPI confidentialCompute is supported-ui", () => {
    const catalog = loadCatalog("4.21", "aws-govcloud-ipi");
    const param = catalog.parameters.find(p =>
      p.path === "controlPlane.platform.aws.cpuOptions.confidentialCompute"
    );
    assert.ok(param);
    assert.strictEqual(param.supportStatus, "supported-ui");
    assert.strictEqual(param.minVersion, "4.21");
    assert.strictEqual(param.maxVersion, null);
  });

  it("4.21 IPI cpuOptions structural parent is supported-derived", () => {
    const catalog = loadCatalog("4.21", "aws-govcloud-ipi");
    const param = catalog.parameters.find(p =>
      p.path === "controlPlane.platform.aws.cpuOptions"
    );
    assert.ok(param, "cpuOptions param must exist");
    assert.strictEqual(param.supportStatus, "supported-derived");
    assert.strictEqual(param.minVersion, "4.21");
  });

  it("4.21 UPI cpuOptions is docs-only-not-supported", () => {
    const catalog = loadCatalog("4.21", "aws-govcloud-upi");
    const param = catalog.parameters.find(p =>
      p.path === "controlPlane.platform.aws.cpuOptions"
    );
    assert.ok(param, "UPI cpuOptions param must exist");
    assert.strictEqual(param.supportStatus, "docs-only-not-supported");
  });

  it("4.21 UPI confidentialCompute is docs-only-not-supported", () => {
    const catalog = loadCatalog("4.21", "aws-govcloud-upi");
    const param = catalog.parameters.find(p =>
      p.path === "controlPlane.platform.aws.cpuOptions.confidentialCompute"
    );
    assert.ok(param, "UPI confidentialCompute param must exist");
    assert.strictEqual(param.supportStatus, "docs-only-not-supported");
  });

  it("canonical and frontend mirrors are identical for IPI", () => {
    const canonicalPath = path.resolve(__dirname, '..', '..', 'data', 'params', '4.21', 'aws-govcloud-ipi.json');
    const mirrorPath = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'data', 'catalogs', '4.21', 'aws-govcloud-ipi.json');
    const canonical = fs.readFileSync(canonicalPath, 'utf8');
    const mirror = fs.readFileSync(mirrorPath, 'utf8');
    assert.strictEqual(canonical, mirror);
  });

  it("canonical and frontend mirrors are identical for UPI", () => {
    const canonicalPath = path.resolve(__dirname, '..', '..', 'data', 'params', '4.21', 'aws-govcloud-upi.json');
    const mirrorPath = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'data', 'catalogs', '4.21', 'aws-govcloud-upi.json');
    const canonical = fs.readFileSync(canonicalPath, 'utf8');
    const mirror = fs.readFileSync(mirrorPath, 'utf8');
    assert.strictEqual(canonical, mirror);
  });
});

// ===================================================================
// Backend generation tests
// ===================================================================

describe("AWS confidential compute — generation", () => {
  it("omitted value produces no cpuOptions", () => {
    const state = makeAws421Ipi();
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.controlPlane?.platform?.aws?.cpuOptions, undefined);
  });

  it("Disabled emits exact output", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: "Disabled" } });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.controlPlane.platform.aws.cpuOptions.confidentialCompute, "Disabled");
  });

  it("AMDEncryptedVirtualizationNestedPaging emits exact output", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: "AMDEncryptedVirtualizationNestedPaging" } });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.controlPlane.platform.aws.cpuOptions.confidentialCompute, "AMDEncryptedVirtualizationNestedPaging");
  });

  it("no empty cpuOptions object emitted", () => {
    const state = makeAws421Ipi({ cpuOptions: {} });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.controlPlane?.platform?.aws?.cpuOptions, undefined);
  });

  it("cpuOptions with empty-string confidentialCompute does not emit", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: "" } });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.controlPlane?.platform?.aws?.cpuOptions, undefined);
  });

  it("4.20 stale value is suppressed", () => {
    const state = makeAws420Ipi({ cpuOptions: { confidentialCompute: "Disabled" } });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.controlPlane?.platform?.aws?.cpuOptions, undefined);
  });

  it("4.21 UPI stale value is suppressed", () => {
    const state = makeAws421Upi({ cpuOptions: { confidentialCompute: "Disabled" } });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.controlPlane?.platform?.aws?.cpuOptions, undefined);
  });

  it("non-AWS stale value is suppressed", () => {
    const state = {
      ...makeAws421Ipi({ cpuOptions: { confidentialCompute: "Disabled" } }),
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
    assert.strictEqual(ic.controlPlane?.platform?.aws, undefined);
  });

  it("confidentialCompute coexists with existing root-volume fields", () => {
    const state = makeAws421Ipi({
      rootVolumeSize: 200,
      rootVolumeType: "gp3",
      rootVolumeIops: 5000,
      cpuOptions: { confidentialCompute: "Disabled" },
    });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.controlPlane.platform.aws.rootVolume.size, 200);
    assert.strictEqual(ic.controlPlane.platform.aws.rootVolume.type, "gp3");
    assert.strictEqual(ic.controlPlane.platform.aws.rootVolume.iops, 5000);
    assert.strictEqual(ic.controlPlane.platform.aws.cpuOptions.confidentialCompute, "Disabled");
  });
});

// ===================================================================
// buildInstallConfig rejection tests
// ===================================================================

describe("AWS confidential compute — buildInstallConfig rejection", () => {
  it("rejects invalid string", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: "invalid" } });
    assert.throws(() => buildInstallConfig(state), /must be one of/);
  });

  it("rejects boolean", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: true } });
    assert.throws(() => buildInstallConfig(state), /must be a string/);
  });

  it("rejects number", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: 42 } });
    assert.throws(() => buildInstallConfig(state), /must be a string/);
  });

  it("rejects object", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: {} } });
    assert.throws(() => buildInstallConfig(state), /must be a string/);
  });

  it("rejects array", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: [] } });
    assert.throws(() => buildInstallConfig(state), /must be a string/);
  });
});

// ===================================================================
// Persistence / import-export tests
// ===================================================================

describe("AWS confidential compute — persistence", () => {
  it("round-trip state retains confidentialCompute", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: "Disabled" } });
    const serialized = JSON.stringify(state);
    const deserialized = JSON.parse(serialized);
    assert.strictEqual(deserialized.platformConfig.aws.cpuOptions.confidentialCompute, "Disabled");
  });

  it("import/export round trip retains confidentialCompute in output", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: "AMDEncryptedVirtualizationNestedPaging" } });
    const exported = JSON.parse(JSON.stringify(state));
    const imported = JSON.parse(JSON.stringify(exported));
    assert.strictEqual(imported.platformConfig.aws.cpuOptions.confidentialCompute, "AMDEncryptedVirtualizationNestedPaging");
    const result = buildInstallConfig(imported);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.controlPlane.platform.aws.cpuOptions.confidentialCompute, "AMDEncryptedVirtualizationNestedPaging");
  });

  it("retained hidden value is still suppressed from inapplicable output", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: "Disabled" } });
    const exported = JSON.parse(JSON.stringify(state));
    exported.version.selectedMinor = "4.20";
    exported.version.selectedPatch = "4.20.8";
    exported.release.channel = "4.20";
    exported.release.patchVersion = "4.20.8";
    assert.strictEqual(exported.platformConfig.aws.cpuOptions.confidentialCompute, "Disabled");
    const result = buildInstallConfig(exported);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.controlPlane?.platform?.aws?.cpuOptions, undefined);
  });
});

// ===================================================================
// API rejection tests (HTTP boundary)
// ===================================================================

describe("AWS confidential compute — API rejection", () => {
  async function postGenerateWithCC(baseUrl, platformOverrides) {
    const state = makeAws421Ipi(platformOverrides);
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    return { status: res.status, body: await res.json() };
  }

  it("rejects invalid string via HTTP", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await postGenerateWithCC(baseUrl, { cpuOptions: { confidentialCompute: "invalid" } });
      assert.strictEqual(status, 500);
      assert.ok(body.error.includes("must be one of"), "error must mention valid values");
      assert.strictEqual(body.files, undefined, "no files payload");
    } finally {
      await closeTestServer(server);
    }
  });

  it("rejects boolean via HTTP", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await postGenerateWithCC(baseUrl, { cpuOptions: { confidentialCompute: true } });
      assert.strictEqual(status, 500);
      assert.ok(body.error.includes("must be a string"), "error must mention string");
      assert.strictEqual(body.files, undefined, "no files payload");
    } finally {
      await closeTestServer(server);
    }
  });

  it("accepts Disabled via HTTP", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await postGenerateWithCC(baseUrl, { cpuOptions: { confidentialCompute: "Disabled" } });
      assert.strictEqual(status, 200);
      assert.ok(body.files, "must return files payload");
      const ic = yaml.load(body.files["install-config.yaml"]);
      assert.strictEqual(ic.controlPlane.platform.aws.cpuOptions.confidentialCompute, "Disabled");
    } finally {
      await closeTestServer(server);
    }
  });

  it("accepts AMDEncryptedVirtualizationNestedPaging via HTTP", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const { status, body } = await postGenerateWithCC(baseUrl, { cpuOptions: { confidentialCompute: "AMDEncryptedVirtualizationNestedPaging" } });
      assert.strictEqual(status, 200);
      assert.ok(body.files, "must return files payload");
      const ic = yaml.load(body.files["install-config.yaml"]);
      assert.strictEqual(ic.controlPlane.platform.aws.cpuOptions.confidentialCompute, "AMDEncryptedVirtualizationNestedPaging");
    } finally {
      await closeTestServer(server);
    }
  });
});
