import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { buildInstallConfig, validateAwsRootVolumeThroughput } from "../src/generate.js";
import { awsGovcloudIpi } from "./fixtures/base-states.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const makeAws421Ipi = (platformOverrides = {}) => awsGovcloudIpi({
  version: { selectedMinor: "4.21", selectedPatch: "4.21.3" },
  release: { channel: "4.21", patchVersion: "4.21.3" },
  platformConfig: {
    region: "us-gov-west-1",
    aws: { rootVolumeThroughput: 500, ...platformOverrides },
  },
});

const makeAws420Ipi = (platformOverrides = {}) => awsGovcloudIpi({
  version: { selectedMinor: "4.20", selectedPatch: "4.20.8" },
  release: { channel: "4.20", patchVersion: "4.20.8" },
  platformConfig: {
    region: "us-gov-west-1",
    aws: { rootVolumeThroughput: 500, ...platformOverrides },
  },
});

const makeAws421Upi = (platformOverrides = {}) => awsGovcloudIpi({
  version: { selectedMinor: "4.21", selectedPatch: "4.21.3" },
  release: { channel: "4.21", patchVersion: "4.21.3" },
  methodology: { method: "UPI" },
  platformConfig: {
    region: "us-gov-west-1",
    aws: { rootVolumeThroughput: 500, ...platformOverrides },
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
// Production validation tests (validateAwsRootVolumeThroughput)
// ===================================================================

describe("AWS root volume throughput — production validation", () => {
  it("125 accepted", () => {
    const result = validateAwsRootVolumeThroughput(125, "gp3");
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, 125);
  });

  it("2000 accepted", () => {
    const result = validateAwsRootVolumeThroughput(2000, "gp3");
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, 2000);
  });

  it("500 accepted with blank volume type (effective gp3)", () => {
    const result = validateAwsRootVolumeThroughput(500, undefined);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, 500);
  });

  it("blank value returns valid+blank", () => {
    assert.deepStrictEqual(validateAwsRootVolumeThroughput(undefined, "gp3"), { valid: true, blank: true });
    assert.deepStrictEqual(validateAwsRootVolumeThroughput(null, "gp3"), { valid: true, blank: true });
    assert.deepStrictEqual(validateAwsRootVolumeThroughput("", "gp3"), { valid: true, blank: true });
  });

  it("124 throws", () => {
    assert.throws(() => validateAwsRootVolumeThroughput(124, "gp3"), /at least 125/);
  });

  it("2001 throws", () => {
    assert.throws(() => validateAwsRootVolumeThroughput(2001, "gp3"), /at most 2000/);
  });

  it("fraction throws", () => {
    assert.throws(() => validateAwsRootVolumeThroughput(125.5, "gp3"), /integer/);
  });

  it("NaN throws", () => {
    assert.throws(() => validateAwsRootVolumeThroughput(NaN, "gp3"), /finite number/);
  });

  it("Infinity throws", () => {
    assert.throws(() => validateAwsRootVolumeThroughput(Infinity, "gp3"), /finite number/);
  });

  it("non-numeric string throws", () => {
    assert.throws(() => validateAwsRootVolumeThroughput("abc", "gp3"), /finite number/);
  });

  it("gp2 with throughput throws", () => {
    assert.throws(() => validateAwsRootVolumeThroughput(500, "gp2"), /only valid for gp3/);
  });

  it("io1 with throughput throws", () => {
    assert.throws(() => validateAwsRootVolumeThroughput(500, "io1"), /only valid for gp3/);
  });

  it("io2 with throughput throws", () => {
    assert.throws(() => validateAwsRootVolumeThroughput(500, "io2"), /only valid for gp3/);
  });
});

// ===================================================================
// Catalog tests
// ===================================================================

describe("AWS root volume throughput — catalog", () => {
  it("4.20 AWS IPI has no supported throughput UI path", () => {
    const catalog = loadCatalog("4.20", "aws-govcloud-ipi");
    const throughputParams = catalog.parameters.filter(p =>
      p.path.includes("rootVolume.throughput")
    );
    assert.strictEqual(throughputParams.length, 0);
  });

  it("4.21 AWS IPI control-plane path is supported-ui", () => {
    const catalog = loadCatalog("4.21", "aws-govcloud-ipi");
    const param = catalog.parameters.find(p =>
      p.path === "controlPlane.platform.aws.rootVolume.throughput"
    );
    assert.ok(param, "controlPlane throughput param must exist");
    assert.strictEqual(param.supportStatus, "supported-ui");
    assert.strictEqual(param.minVersion, "4.21");
    assert.strictEqual(param.maxVersion, null);
  });

  it("4.21 AWS IPI compute path is supported-derived", () => {
    const catalog = loadCatalog("4.21", "aws-govcloud-ipi");
    const param = catalog.parameters.find(p =>
      p.path === "compute[].platform.aws.rootVolume.throughput"
    );
    assert.ok(param, "compute throughput param must exist");
    assert.strictEqual(param.supportStatus, "supported-derived");
    assert.strictEqual(param.minVersion, "4.21");
    assert.strictEqual(param.maxVersion, null);
  });

  it("4.21 AWS UPI controlPlane path is docs-only-not-supported", () => {
    const catalog = loadCatalog("4.21", "aws-govcloud-upi");
    const param = catalog.parameters.find(p =>
      p.path === "controlPlane.platform.aws.rootVolume.throughput"
    );
    assert.ok(param, "UPI controlPlane throughput param must exist");
    assert.strictEqual(param.supportStatus, "docs-only-not-supported");
  });

  it("4.21 AWS UPI compute path is docs-only-not-supported", () => {
    const catalog = loadCatalog("4.21", "aws-govcloud-upi");
    const param = catalog.parameters.find(p =>
      p.path === "compute[].platform.aws.rootVolume.throughput"
    );
    assert.ok(param, "UPI compute throughput param must exist");
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

describe("AWS root volume throughput — generation", () => {
  it("4.21 AWS IPI emits control-plane throughput", () => {
    const state = makeAws421Ipi();
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.controlPlane.platform.aws.rootVolume.throughput, 500);
  });

  it("4.21 AWS IPI emits compute throughput", () => {
    const state = makeAws421Ipi();
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.compute[0].platform.aws.rootVolume.throughput, 500);
  });

  it("both values are identical integers", () => {
    const state = makeAws421Ipi({ rootVolumeThroughput: 750 });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.controlPlane.platform.aws.rootVolume.throughput, 750);
    assert.strictEqual(ic.compute[0].platform.aws.rootVolume.throughput, 750);
    assert.strictEqual(typeof ic.controlPlane.platform.aws.rootVolume.throughput, "number");
    assert.strictEqual(Number.isInteger(ic.controlPlane.platform.aws.rootVolume.throughput), true);
  });

  it("blank value is omitted", () => {
    const state = makeAws421Ipi({ rootVolumeThroughput: undefined });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    const cpRootVol = ic.controlPlane?.platform?.aws?.rootVolume;
    if (cpRootVol) {
      assert.strictEqual(cpRootVol.throughput, undefined);
    }
  });

  it("4.20 stale value is suppressed", () => {
    const state = makeAws420Ipi();
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    const cpRootVol = ic.controlPlane?.platform?.aws?.rootVolume;
    if (cpRootVol) {
      assert.strictEqual(cpRootVol.throughput, undefined);
    }
    const compRootVol = ic.compute?.[0]?.platform?.aws?.rootVolume;
    if (compRootVol) {
      assert.strictEqual(compRootVol.throughput, undefined);
    }
  });

  it("4.21 AWS UPI stale value is suppressed", () => {
    const state = makeAws421Upi();
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    const cpRootVol = ic.controlPlane?.platform?.aws?.rootVolume;
    if (cpRootVol) {
      assert.strictEqual(cpRootVol.throughput, undefined);
    }
  });

  it("4.21 non-AWS stale value is suppressed", () => {
    const state = {
      ...makeAws421Ipi(),
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
    assert.strictEqual(ic.compute?.[0]?.platform?.aws, undefined);
  });

  it("throughput coexists with existing root-volume fields", () => {
    const state = makeAws421Ipi({
      rootVolumeSize: 200,
      rootVolumeType: "gp3",
      rootVolumeIops: 5000,
      rootVolumeThroughput: 300,
    });
    const result = buildInstallConfig(state);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.controlPlane.platform.aws.rootVolume.size, 200);
    assert.strictEqual(ic.controlPlane.platform.aws.rootVolume.type, "gp3");
    assert.strictEqual(ic.controlPlane.platform.aws.rootVolume.iops, 5000);
    assert.strictEqual(ic.controlPlane.platform.aws.rootVolume.throughput, 300);
    assert.strictEqual(ic.compute[0].platform.aws.rootVolume.size, 200);
    assert.strictEqual(ic.compute[0].platform.aws.rootVolume.type, "gp3");
    assert.strictEqual(ic.compute[0].platform.aws.rootVolume.iops, 5000);
    assert.strictEqual(ic.compute[0].platform.aws.rootVolume.throughput, 300);
  });
});

// ===================================================================
// buildInstallConfig rejection tests
// ===================================================================

describe("AWS root volume throughput — buildInstallConfig rejection", () => {
  it("rejects 124 throughput", () => {
    const state = makeAws421Ipi({ rootVolumeThroughput: 124 });
    assert.throws(() => buildInstallConfig(state), /at least 125/);
  });

  it("rejects 2001 throughput", () => {
    const state = makeAws421Ipi({ rootVolumeThroughput: 2001 });
    assert.throws(() => buildInstallConfig(state), /at most 2000/);
  });

  it("rejects fraction throughput", () => {
    const state = makeAws421Ipi({ rootVolumeThroughput: 125.5 });
    assert.throws(() => buildInstallConfig(state), /integer/);
  });

  it("rejects NaN throughput", () => {
    const state = makeAws421Ipi({ rootVolumeThroughput: NaN });
    assert.throws(() => buildInstallConfig(state), /finite number/);
  });

  it("rejects gp2 with throughput", () => {
    const state = makeAws421Ipi({ rootVolumeThroughput: 500, rootVolumeType: "gp2" });
    assert.throws(() => buildInstallConfig(state), /only valid for gp3/);
  });
});

// ===================================================================
// Persistence / import-export tests
// ===================================================================

describe("AWS root volume throughput — persistence", () => {
  it("round-trip state retains rootVolumeThroughput", () => {
    const state = makeAws421Ipi();
    const serialized = JSON.stringify(state);
    const deserialized = JSON.parse(serialized);
    assert.strictEqual(deserialized.platformConfig.aws.rootVolumeThroughput, 500);
  });

  it("import/export round trip retains rootVolumeThroughput", () => {
    const state = makeAws421Ipi();
    const exported = JSON.parse(JSON.stringify(state));
    const imported = JSON.parse(JSON.stringify(exported));
    assert.strictEqual(imported.platformConfig.aws.rootVolumeThroughput, 500);
    const result = buildInstallConfig(imported);
    const ic = parseInstallConfig(result);
    assert.strictEqual(ic.controlPlane.platform.aws.rootVolume.throughput, 500);
    assert.strictEqual(ic.compute[0].platform.aws.rootVolume.throughput, 500);
  });

  it("retained hidden value is still suppressed from inapplicable output", () => {
    const state = makeAws421Ipi();
    const exported = JSON.parse(JSON.stringify(state));
    exported.version.selectedMinor = "4.20";
    exported.version.selectedPatch = "4.20.8";
    exported.release.channel = "4.20";
    exported.release.patchVersion = "4.20.8";
    assert.strictEqual(exported.platformConfig.aws.rootVolumeThroughput, 500);
    const result = buildInstallConfig(exported);
    const ic = parseInstallConfig(result);
    const cpRootVol = ic.controlPlane?.platform?.aws?.rootVolume;
    if (cpRootVol) {
      assert.strictEqual(cpRootVol.throughput, undefined);
    }
  });
});
