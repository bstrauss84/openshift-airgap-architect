"use strict";

/**
 * Per-rule tests for the promoted false-positive filter.
 *
 * The 0A-0 harvest identified corrected-analysis.js as the single
 * highest-value artifact in the 4.21 toolkit: it encodes the rules that reduced
 * a 67% false-positive rate (340 of 502) to an actionable finding set, and
 * those rules existed only as untracked, untested code on one machine.
 *
 * Every suppression rule gets BOTH:
 *   - a positive fixture proving the artefact IS suppressed, and
 *   - a negative fixture proving a genuine discrepancy is NOT suppressed.
 *
 * The negative halves are the point. A filter with only positive tests can be
 * widened until it suppresses everything and the tests still pass.
 *
 * Hermetic: fixture trees under os.tmpdir(), no repository data, no network.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  correctedAnalysis,
  isRequiredFalsePositive,
  isTypeFalsePositive,
  isApplicableToScenario,
  normalizePath,
  discoverScenarios,
  NESTED_REQUIRED_PATTERNS,
} = require("./corrected-analysis.js");

describe("normalizePath", () => {
  test("strips array notation at every depth", () => {
    assert.strictEqual(normalizePath("compute[].name"), "compute.name");
    assert.strictEqual(
      normalizePath("networking.clusterNetwork[].cidr"),
      "networking.clusterNetwork.cidr"
    );
    assert.strictEqual(
      normalizePath("platform.vsphere.failureDomains[].topology.networks[]"),
      "platform.vsphere.failureDomains.topology.networks"
    );
  });

  test("leaves a plain path untouched", () => {
    assert.strictEqual(normalizePath("baseDomain"), "baseDomain");
  });
});

describe("RULE SET 1 — CONDITIONAL_REQUIRED suppression", () => {
  // One case per carried-over regex. Each is required only IF its parent exists.
  const suppressed = [
    ["imageContentSources[].source", "union member child"],
    ["imageDigestSources[].mirrors", "union member child"],
    ["networking.clusterNetwork[].cidr", "network child"],
    ["networking.clusterNetwork[].hostPrefix", "network child"],
    ["platform.baremetal.hosts[].bmc.username", "BMC child"],
    ["platform.baremetal.hosts[].bmc.password", "BMC child"],
    ["platform.baremetal.hosts[].bmc.address", "BMC child"],
    ["controlPlane.platform.azure.osDisk.diskSizeGB", "Azure disk child"],
    ["controlPlane.platform.azure.osDisk.diskType", "Azure disk child"],
    ["controlPlane.platform.aws.rootVolume.iops", "AWS rootVolume child"],
    ["controlPlane.platform.aws.rootVolume.size", "AWS rootVolume child"],
    ["controlPlane.platform.aws.rootVolume.kmsKeyARN", "AWS rootVolume child"],
    ["platform.azure.subscriptionId", "Azure field"],
    ["platform.azure.resourceGroup", "Azure field"],
    ["platform.baremetal.hosts[].bootMACAddress", "bare metal host child"],
    ["platform.baremetal.hosts[].bmc", "bare metal host child"],
    ["platform.baremetal.hosts[].bmc.disableCertificateVerification", "bare metal host child"],
    ["platform.baremetal.provisioningNetworkInterface", "bare metal provisioning"],
    ["platform.baremetal.provisioningBridge", "bare metal provisioning"],
    ["platform.baremetal.provisioningNetworkCIDR", "bare metal provisioning"],
  ];

  for (const [p, why] of suppressed) {
    test(`suppresses ${p} (${why})`, () => {
      assert.strictEqual(
        isRequiredFalsePositive(p, true, false),
        true,
        `${p} is required only if its parent exists; flagging it is a false positive`
      );
    });
  }

  test("every carried-over nested-required regex is exercised above", () => {
    // Guards against a rule being added to the script without a test.
    for (const re of NESTED_REQUIRED_PATTERNS) {
      const covered = suppressed.some(([p]) => re.test(normalizePath(p)));
      assert.ok(covered, `no fixture exercises ${re}`);
    }
  });

  test("suppresses controlPlane.platform / compute.platform context-dependence", () => {
    assert.strictEqual(isRequiredFalsePositive("controlPlane.platform", true, false), true);
    assert.strictEqual(isRequiredFalsePositive("compute[].platform", true, false), true);
  });

  test("suppresses platform-specific fields nested under controlPlane/compute", () => {
    assert.strictEqual(
      isRequiredFalsePositive("controlPlane.platform.aws.type", true, false),
      true
    );
  });

  test("suppresses deep array-indexed nesting (depth > 2)", () => {
    assert.strictEqual(
      isRequiredFalsePositive("platform.vsphere.failureDomains[].topology.datacenter", true, false),
      true
    );
  });

  describe("negative controls — a genuine requiredness mismatch is NOT suppressed", () => {
    test("a top-level required field is reported", () => {
      assert.strictEqual(
        isRequiredFalsePositive("baseDomain", true, false),
        false,
        "baseDomain is unconditionally required; a mismatch here is real"
      );
    });

    test("a two-segment non-matching path is reported", () => {
      assert.strictEqual(isRequiredFalsePositive("networking.networkType", true, false), false);
    });

    test("a shallow array path that matches no pattern is reported", () => {
      assert.strictEqual(isRequiredFalsePositive("compute[].replicas", true, false), false);
    });

    test("platform-context suppression does not fire when the catalog is the stricter side", () => {
      // sourceRequired=false, catalogRequired=true: catalog is stricter, which
      // is legitimate, but it must not be silently swallowed by the
      // context-dependence rule, which is scoped to the opposite direction.
      assert.strictEqual(isRequiredFalsePositive("controlPlane.platform", false, true), false);
    });
  });
});

describe("RULE SET 2 — TYPE_REPRESENTATION suppression", () => {
  test("suppresses ipnet.IPNet rendered as a CIDR string", () => {
    assert.strictEqual(
      isTypeFalsePositive("networking.machineNetwork[].cidr", "object", "string", "ipnet.IPNet"),
      true
    );
  });

  test("suppresses configv1.* external enums rendered as strings", () => {
    assert.strictEqual(
      isTypeFalsePositive("platform.aws.lbType", "object", "string", "configv1.AWSLBType"),
      true
    );
  });

  test("suppresses baselineCapabilitySet enum-as-string", () => {
    assert.strictEqual(
      isTypeFalsePositive("capabilities.baselineCapabilitySet", "object", "string", "v1.CapabilitySet"),
      true
    );
  });

  test("suppresses featureSet enum-as-string", () => {
    assert.strictEqual(isTypeFalsePositive("featureSet", "object", "string", "v1.FeatureSet"), true);
  });

  test("suppresses controlPlane object-vs-array notation", () => {
    assert.strictEqual(isTypeFalsePositive("controlPlane", "object", "array", "MachinePool"), true);
  });

  describe("negative controls — a genuine type mismatch is NOT suppressed", () => {
    test("string declared as integer is reported", () => {
      assert.strictEqual(isTypeFalsePositive("compute[].replicas", "int", "string", "int64"), false);
    });

    test("a plain Go string vs catalog array is reported", () => {
      assert.strictEqual(isTypeFalsePositive("platform.aws.region", "string", "array", "string"), false);
    });

    test("CIDR suppression requires the ipnet.IPNet Go type, not just the name", () => {
      assert.strictEqual(
        isTypeFalsePositive("networking.machineNetwork[].cidr", "object", "string", "SomeStruct"),
        false,
        "suppression must key off the Go type, not the field name"
      );
    });

    test("external-enum suppression does not fire for a non-configv1 object", () => {
      assert.strictEqual(
        isTypeFalsePositive("platform.aws.lbType", "object", "string", "aws.CustomStruct"),
        false
      );
    });
  });
});

describe("RULE SET 3 — PLATFORM_SPECIFIC applicability", () => {
  test("AWS parameters are not applicable to a vSphere scenario", () => {
    assert.strictEqual(
      isApplicableToScenario({ path: "platform.aws.region" }, "vsphere-ipi"),
      false,
      "the single largest false-positive source"
    );
  });

  test("AWS parameters ARE applicable to an AWS scenario", () => {
    assert.strictEqual(
      isApplicableToScenario({ path: "platform.aws.region" }, "aws-govcloud-ipi"),
      true
    );
  });

  test("maps scenario prefixes to installer platform names", () => {
    assert.strictEqual(
      isApplicableToScenario({ path: "platform.baremetal.apiVIPs" }, "bare-metal-ipi"),
      true,
      "'bare' must map to 'baremetal'"
    );
    assert.strictEqual(
      isApplicableToScenario({ path: "platform.ibmcloud.region" }, "ibm-cloud-ipi"),
      true,
      "'ibm' must map to 'ibmcloud'"
    );
  });

  test("platform.none is applicable everywhere", () => {
    assert.strictEqual(isApplicableToScenario({ path: "platform.none" }, "vsphere-upi"), true);
  });

  test("agent-config parameters apply only to agent scenarios", () => {
    const agentParam = { path: "hosts[].role", outputFile: "agent-config.yaml" };
    assert.strictEqual(isApplicableToScenario(agentParam, "bare-metal-agent"), true);
    assert.strictEqual(isApplicableToScenario(agentParam, "bare-metal-ipi"), false);
    assert.strictEqual(isApplicableToScenario(agentParam, "vsphere-agent"), true);
  });

  test("platform-agnostic parameters apply to every scenario", () => {
    for (const s of ["vsphere-ipi", "aws-govcloud-upi", "bare-metal-agent", "nutanix-ipi"]) {
      assert.strictEqual(isApplicableToScenario({ path: "baseDomain" }, s), true);
    }
  });

  test("controlPlane/compute platform overrides respect the scenario platform", () => {
    assert.strictEqual(
      isApplicableToScenario({ path: "controlPlane.platform.aws.type" }, "vsphere-ipi"),
      false
    );
    assert.strictEqual(
      isApplicableToScenario({ path: "compute.platform.vsphere.cpus" }, "vsphere-ipi"),
      true
    );
  });
});

describe("scenario discovery (replaces the hardcoded 12-element list)", () => {
  function catalogDir(names) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-ca-cat-"));
    for (const n of names) {
      fs.writeFileSync(path.join(dir, `${n}.json`), JSON.stringify({ parameters: [] }), "utf-8");
    }
    return dir;
  }

  test("discovers every catalog, including oc-mirror-v2", () => {
    // The harvested script's literal SCENARIOS array silently omitted
    // oc-mirror-v2, so it was never analysed.
    const dir = catalogDir(["bare-metal-ipi", "vsphere-ipi", "oc-mirror-v2"]);
    assert.deepStrictEqual(discoverScenarios(dir), [
      "bare-metal-ipi",
      "oc-mirror-v2",
      "vsphere-ipi",
    ]);
  });

  test("fails closed on an empty catalog directory", () => {
    // A zero-catalog read must not report every parameter as missing.
    const dir = catalogDir([]);
    assert.throws(() => discoverScenarios(dir), /No catalog files found/);
  });

  test("fails closed on a missing catalog directory", () => {
    assert.throws(
      () => discoverScenarios(path.join(os.tmpdir(), "oaa-definitely-absent-dir")),
      /Catalog directory not found/
    );
  });
});

describe("end-to-end on a fixture minor", () => {
  function buildFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-ca-e2e-"));
    const workspace = path.join(root, "ws");
    const catalogRoot = path.join(root, "params");
    const catalogDir = path.join(catalogRoot, "4.99");
    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(catalogDir, { recursive: true });

    fs.writeFileSync(
      path.join(workspace, "installer-source-params.json"),
      JSON.stringify({
        source: "fixture",
        parameters: [
          { path: "baseDomain", type: "string", required: true, goType: "string" },
          // Present in catalog, genuine requiredness mismatch -> must be reported.
          { path: "networking.networkType", type: "string", required: true, goType: "string" },
          // AWS-only -> must not be reported as missing from a vSphere catalog.
          { path: "platform.aws.region", type: "string", required: true, goType: "string" },
          // CIDR representation -> must not be reported as a type mismatch.
          {
            path: "networking.machineNetwork[].cidr",
            type: "object",
            required: true,
            goType: "ipnet.IPNet",
          },
        ],
      }),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(workspace, "agent-config-params.json"),
      JSON.stringify({ source: "fixture", parameters: [] }),
      "utf-8"
    );

    fs.writeFileSync(
      path.join(catalogDir, "vsphere-ipi.json"),
      JSON.stringify({
        version: "4.99",
        scenarioId: "vsphere-ipi",
        parameters: [
          { path: "baseDomain", type: "string", required: true },
          { path: "networking.networkType", type: "string", required: false },
          { path: "networking.machineNetwork[].cidr", type: "string", required: true },
        ],
      }),
      "utf-8"
    );

    return { workspace, catalogRoot };
  }

  test("reports the real mismatch and suppresses the three artefacts", () => {
    const { workspace, catalogRoot } = buildFixture();
    const result = correctedAnalysis({ minor: "4.99", workspace, catalogRoot });
    const scenario = result.byScenario["vsphere-ipi"];

    assert.strictEqual(
      scenario.realMissing,
      0,
      "platform.aws.region must not count as missing from a vSphere catalog"
    );
    assert.strictEqual(
      scenario.realDiscrepancies,
      1,
      "only the genuine networkType requiredness mismatch should survive"
    );
    assert.strictEqual(scenario.details.discrepanciesHighConfidence[0].path, "networking.networkType");
  });

  test("records the minor it analysed and the filters it applied", () => {
    const { workspace, catalogRoot } = buildFixture();
    const result = correctedAnalysis({ minor: "4.99", workspace, catalogRoot });

    assert.strictEqual(result.minor, "4.99");
    assert.deepStrictEqual(result.scenariosAnalyzed, ["vsphere-ipi"]);
    assert.ok(result.filteringApplied.requiredFilters.length >= 3);
    assert.ok(result.filteringApplied.typeFilters.length >= 3);
    assert.ok(result.filteringApplied.applicabilityFilters.length >= 4);
  });

  test("works for an arbitrary future minor with no code change", () => {
    // The whole point of de-forking: 4.23 must need no new script.
    const { workspace, catalogRoot } = buildFixture();
    const renamed = path.join(catalogRoot, "4.123");
    fs.renameSync(path.join(catalogRoot, "4.99"), renamed);
    const result = correctedAnalysis({ minor: "4.123", workspace, catalogRoot });
    assert.strictEqual(result.minor, "4.123");
    assert.strictEqual(result.byScenario["vsphere-ipi"].realDiscrepancies, 1);
  });

  test("fails closed when an extraction input is missing", () => {
    const { workspace, catalogRoot } = buildFixture();
    fs.unlinkSync(path.join(workspace, "installer-source-params.json"));
    assert.throws(
      () => correctedAnalysis({ minor: "4.99", workspace, catalogRoot }),
      /Missing installer-source extraction/
    );
  });
});
