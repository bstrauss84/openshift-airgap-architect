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
import { migrateStateToV3 } from "../../shared/stateMigration.js";
import { getState } from "../src/utils.js";

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

// ===================================================================
// Import migration boundary tests
// ===================================================================

describe("AWS confidential compute — import migration boundary", () => {
  it("Disabled survives v3 import migration", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: "Disabled" } });
    state.version._schemaVersion = 3;
    const result = migrateStateToV3(state);
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.migrated.platformConfig.aws.cpuOptions.confidentialCompute, "Disabled");
  });

  it("AMDEncryptedVirtualizationNestedPaging survives v3 import migration", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: "AMDEncryptedVirtualizationNestedPaging" } });
    state.version._schemaVersion = 3;
    const result = migrateStateToV3(state);
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.migrated.platformConfig.aws.cpuOptions.confidentialCompute, "AMDEncryptedVirtualizationNestedPaging");
  });

  it("undefined cpuOptions remains omitted after import migration", () => {
    const state = makeAws421Ipi();
    state.version._schemaVersion = 3;
    const result = migrateStateToV3(state);
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.migrated.platformConfig.aws?.cpuOptions, undefined);
  });

  it("v1 state with cpuOptions survives migration to v3", () => {
    const state = {
      release: { channel: "4.21", patchVersion: "4.21.3", confirmed: true },
      blueprint: { platform: "AWS GovCloud", baseDomain: "aws.example.com", clusterName: "test" },
      methodology: { method: "IPI" },
      platformConfig: { region: "us-gov-west-1", aws: { cpuOptions: { confidentialCompute: "Disabled" } } },
      credentials: { awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE", awsSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
    };
    const result = migrateStateToV3(state);
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.migrated.platformConfig.aws.cpuOptions.confidentialCompute, "Disabled");
  });
});

// ===================================================================
// Hidden-state suppression and restoration round-trip
// ===================================================================

describe("AWS confidential compute — suppression and restoration", () => {
  it("retained SEV-SNP suppressed for 4.20, emits again on return to 4.21 IPI", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: "AMDEncryptedVirtualizationNestedPaging" } });

    state.version.selectedMinor = "4.20";
    state.version.selectedPatch = "4.20.8";
    state.release.channel = "4.20";
    state.release.patchVersion = "4.20.8";
    const result420 = buildInstallConfig(state);
    const ic420 = parseInstallConfig(result420);
    assert.strictEqual(ic420.controlPlane?.platform?.aws?.cpuOptions, undefined);

    state.version.selectedMinor = "4.21";
    state.version.selectedPatch = "4.21.3";
    state.release.channel = "4.21";
    state.release.patchVersion = "4.21.3";
    const result421 = buildInstallConfig(state);
    const ic421 = parseInstallConfig(result421);
    assert.strictEqual(ic421.controlPlane.platform.aws.cpuOptions.confidentialCompute, "AMDEncryptedVirtualizationNestedPaging");
  });

  it("retained SEV-SNP suppressed for UPI, emits again on return to IPI", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: "AMDEncryptedVirtualizationNestedPaging" } });

    state.methodology.method = "UPI";
    const resultUpi = buildInstallConfig(state);
    const icUpi = parseInstallConfig(resultUpi);
    assert.strictEqual(icUpi.controlPlane?.platform?.aws?.cpuOptions, undefined);

    state.methodology.method = "IPI";
    const resultIpi = buildInstallConfig(state);
    const icIpi = parseInstallConfig(resultIpi);
    assert.strictEqual(icIpi.controlPlane.platform.aws.cpuOptions.confidentialCompute, "AMDEncryptedVirtualizationNestedPaging");
  });

  it("retained SEV-SNP suppressed for non-AWS, emits again on return to AWS GovCloud IPI", () => {
    const awsState = makeAws421Ipi({ cpuOptions: { confidentialCompute: "AMDEncryptedVirtualizationNestedPaging" } });

    const bareMetalState = {
      ...awsState,
      blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "test-cluster" },
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
    const resultBm = buildInstallConfig(bareMetalState);
    const icBm = parseInstallConfig(resultBm);
    assert.strictEqual(icBm.controlPlane?.platform?.aws, undefined);

    const resultAws = buildInstallConfig(awsState);
    const icAws = parseInstallConfig(resultAws);
    assert.strictEqual(icAws.controlPlane.platform.aws.cpuOptions.confidentialCompute, "AMDEncryptedVirtualizationNestedPaging");
  });
});

// ===================================================================
// Real HTTP /api/state persistence/hydration boundary
// ===================================================================

describe("AWS confidential compute — /api/state persistence", () => {
  it("undefined cpuOptions remains omitted after persistence", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeAws421Ipi();
      await fetch(`${baseUrl}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const persisted = getState();
      assert.strictEqual(persisted.platformConfig.aws?.cpuOptions, undefined);
    } finally {
      await closeTestServer(server);
    }
  });

  it("Disabled persists and hydrates via POST/GET /api/state", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: "Disabled" } });
      await fetch(`${baseUrl}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const persisted = getState();
      assert.strictEqual(persisted.platformConfig.aws.cpuOptions.confidentialCompute, "Disabled");
    } finally {
      await closeTestServer(server);
    }
  });

  it("AMDEncryptedVirtualizationNestedPaging persists and hydrates", async () => {
    const { server, baseUrl } = await createTestServer(app);
    try {
      const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: "AMDEncryptedVirtualizationNestedPaging" } });
      await fetch(`${baseUrl}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const persisted = getState();
      assert.strictEqual(persisted.platformConfig.aws.cpuOptions.confidentialCompute, "AMDEncryptedVirtualizationNestedPaging");
    } finally {
      await closeTestServer(server);
    }
  });
});

// ===================================================================
// Real export boundary: sanitization preserves cpuOptions
// ===================================================================

describe("AWS confidential compute — export boundary", () => {
  function simulateExportEndpoint(state) {
    const stateMigrationResult = migrateStateToV3(state);
    if (stateMigrationResult.error) return { status: 400, body: { error: stateMigrationResult.error } };
    const v3State = stateMigrationResult.migrated;
    const sanitized = JSON.parse(JSON.stringify(v3State));
    if (sanitized.blueprint) {
      delete sanitized.blueprint.blueprintPullSecretEphemeral;
      delete sanitized.blueprint.sshPrivateKeyEphemeral;
    }
    return { status: 200, body: { state: sanitized, migrated: stateMigrationResult.wasV1 || stateMigrationResult.wasV2 } };
  }

  it("Disabled survives export sanitization", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: "Disabled" } });
    state.version._schemaVersion = 3;
    const res = simulateExportEndpoint(state);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.state.platformConfig.aws.cpuOptions.confidentialCompute, "Disabled");
  });

  it("AMDEncryptedVirtualizationNestedPaging survives export sanitization", () => {
    const state = makeAws421Ipi({ cpuOptions: { confidentialCompute: "AMDEncryptedVirtualizationNestedPaging" } });
    state.version._schemaVersion = 3;
    const res = simulateExportEndpoint(state);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.state.platformConfig.aws.cpuOptions.confidentialCompute, "AMDEncryptedVirtualizationNestedPaging");
  });

  it("undefined cpuOptions remains omitted in export", () => {
    const state = makeAws421Ipi();
    state.version._schemaVersion = 3;
    const res = simulateExportEndpoint(state);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.state.platformConfig.aws?.cpuOptions, undefined);
  });
});
