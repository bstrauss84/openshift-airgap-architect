/**
 * Field Guide v4.21 Tests (DOC-102 Slice 5F)
 *
 * Proves:
 * - v4.21 field guide loads correctly
 * - v4.21 compartments are version-aware
 * - v4.21 does not fallback to v4.20
 * - vSphere compartments are deferred (missing 4.21 docs)
 * - All v4.21 compartments have version: "4.21"
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compartments_v421 } from "../src/fieldGuide/v4.21/index.js";
import { compartments_v420 } from "../src/fieldGuide/v4.20/index.js";
import { selectAndOrder } from "../src/fieldGuide/assembler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const V421_SOURCE_DIR = join(__dirname, "..", "src", "fieldGuide", "v4.21");

describe("Field Guide v4.21 (DOC-102 Slice 5F)", () => {
  describe("v4.21 compartments load", () => {
    it("exports compartments_v421 array", () => {
      assert(Array.isArray(compartments_v421), "compartments_v421 should be an array");
      assert(compartments_v421.length > 0, "compartments_v421 should not be empty");
    });

    it("all v4.21 compartments have version: '4.21'", () => {
      const wrongVersions = compartments_v421.filter((c) => c.version !== "4.21");
      assert.equal(
        wrongVersions.length,
        0,
        `All compartments should have version: "4.21", found ${wrongVersions.length} with wrong version`
      );
    });

    it("v4.21 compartments count is v4.20 + 1 (bmBmcVerifyCa added)", () => {
      const v420Count = compartments_v420.length;
      const v421Count = compartments_v421.length;
      assert.equal(
        v421Count,
        v420Count + 1,
        `v4.21 should have v4.20 + 1 compartments (bmBmcVerifyCa). v4.20: ${v420Count}, v4.21: ${v421Count}`
      );
    });

    it("vSphere compartments ARE present in v4.21", () => {
      const vsphereIds = [
        "vsphere-ipi-prereqs",
        "vsphere-ipi-install",
        "vsphere-upi-prereqs",
        "vsphere-upi-install",
        "vsphere-agent-prereqs",
        "vsphere-agent-methodology-context",
        "vsphere-agent-install",
      ];

      const foundVSphere = compartments_v421.filter((c) => vsphereIds.includes(c.id));
      assert.equal(
        foundVSphere.length,
        7,
        `vSphere compartments should be included in v4.21, found ${foundVSphere.length}`
      );
    });
  });

  describe("v4.21 docRefs use 4.21 URLs", () => {
    it("no v4.21 compartment has 4.20 URLs in docRefs", () => {
      const wrong420Refs = [];
      compartments_v421.forEach((c) => {
        (c.docRefs || []).forEach((ref) => {
          if (ref.url && ref.url.includes("/4.20/")) {
            wrong420Refs.push({ compartmentId: c.id, url: ref.url });
          }
        });
      });

      assert.equal(
        wrong420Refs.length,
        0,
        `v4.21 compartments should not reference 4.20 URLs. Found ${wrong420Refs.length} bad refs: ${JSON.stringify(wrong420Refs)}`
      );
    });

    it("all v4.21 docRefs use 4.21 URLs", () => {
      const allDocRefs = compartments_v421.flatMap((c) => c.docRefs || []);
      const ocpDocRefs = allDocRefs.filter((ref) =>
        ref.url.includes("docs.redhat.com/en/documentation/openshift_container_platform")
      );

      const correct421Refs = ocpDocRefs.filter((ref) => ref.url.includes("/4.21/"));
      const totalOcpRefs = ocpDocRefs.length;

      assert(
        totalOcpRefs > 0,
        "Should have at least some OCP documentation references"
      );
      assert.equal(
        correct421Refs.length,
        totalOcpRefs,
        `All OCP doc refs should use /4.21/. Found ${correct421Refs.length} correct out of ${totalOcpRefs} total`
      );
    });
  });

  describe("version-aware compartment selection", () => {
    it("selecting for 4.21 returns v4.21 compartments", () => {
      const ctx421 = { versionMajorMinor: "4.21", platform: "Bare Metal", methodology: "IPI" };
      const selected = selectAndOrder("4.21", ctx421);

      assert(selected.length > 0, "Should return compartments for 4.21");
      selected.forEach((c) => {
        assert.equal(c.version, "4.21", `Compartment ${c.id} should have version 4.21`);
      });
    });

    it("selecting for 4.20 returns v4.20 compartments", () => {
      const ctx420 = { versionMajorMinor: "4.20", platform: "Bare Metal", methodology: "IPI" };
      const selected = selectAndOrder("4.20", ctx420);

      assert(selected.length > 0, "Should return compartments for 4.20");
      selected.forEach((c) => {
        assert.equal(c.version, "4.20", `Compartment ${c.id} should have version 4.20`);
      });
    });

    it("4.21 selection does not return v4.20 compartments", () => {
      const ctx421 = { versionMajorMinor: "4.21", platform: "Bare Metal", methodology: "IPI" };
      const selected = selectAndOrder("4.21", ctx421);

      const has420Compartments = selected.some((c) => c.version === "4.20");
      assert.equal(
        has420Compartments,
        false,
        "4.21 selection should NOT include 4.20 compartments (no fallback)"
      );
    });
  });

  describe("4.21 bare-metal compartments present", () => {
    it("bare-metal-ipi compartments exist in v4.21", () => {
      const bmIds = ["bm-ipi-prereqs", "bm-ipi-install"];
      const found = compartments_v421.filter((c) => bmIds.includes(c.id));
      assert.equal(
        found.length,
        2,
        `Should have 2 bare-metal IPI compartments in v4.21, found ${found.length}`
      );
    });

    it("bare-metal-agent compartments exist in v4.21", () => {
      const bmIds = ["bm-agent-prereqs", "bm-agent-install"];
      const found = compartments_v421.filter((c) => bmIds.includes(c.id));
      assert.equal(
        found.length,
        2,
        `Should have 2 bare-metal Agent compartments in v4.21, found ${found.length}`
      );
    });
  });

  describe("4.21 bmBmcVerifyCa compartment (DOC-102)", () => {
    it("bm-bmc-verify-ca compartment exists in v4.21", () => {
      const comp = compartments_v421.find((c) => c.id === "bm-bmc-verify-ca");
      assert(comp, "bm-bmc-verify-ca compartment should exist");
      assert.equal(comp.version, "4.21");
    });

    it("bm-bmc-verify-ca has correct conditions", () => {
      const comp = compartments_v421.find((c) => c.id === "bm-bmc-verify-ca");
      assert(comp, "bm-bmc-verify-ca compartment should exist");
      assert.deepStrictEqual(comp.conditions.platforms, ["Bare Metal"]);
      assert(Array.isArray(comp.conditions.methodologies));
      assert(comp.conditions.methodologies.includes("Agent-Based Installer"));
      assert(comp.conditions.methodologies.includes("IPI"));
      assert(!comp.conditions.methodologies.includes("UPI"));
    });

    it("bm-bmc-verify-ca has items", () => {
      const comp = compartments_v421.find((c) => c.id === "bm-bmc-verify-ca");
      assert(comp, "bm-bmc-verify-ca compartment should exist");
      assert(Array.isArray(comp.items));
      assert(comp.items.length > 0, "bm-bmc-verify-ca should have at least one item");
    });

    it("bm-bmc-verify-ca is NOT in v4.20", () => {
      const comp = compartments_v420.find((c) => c.id === "bm-bmc-verify-ca");
      assert.equal(comp, undefined, "bm-bmc-verify-ca should not exist in v4.20");
    });

    it("bm-bmc-verify-ca selected for 4.21 Bare Metal Agent", () => {
      const ctx = { versionMajorMinor: "4.21", platform: "Bare Metal", methodology: "Agent-Based Installer" };
      const selected = selectAndOrder("4.21", ctx);
      const found = selected.find((c) => c.id === "bm-bmc-verify-ca");
      assert(found, "bm-bmc-verify-ca should appear for 4.21 Bare Metal Agent");
    });

    it("bm-bmc-verify-ca selected for 4.21 Bare Metal IPI", () => {
      const ctx = { versionMajorMinor: "4.21", platform: "Bare Metal", methodology: "IPI" };
      const selected = selectAndOrder("4.21", ctx);
      const found = selected.find((c) => c.id === "bm-bmc-verify-ca");
      assert(found, "bm-bmc-verify-ca should appear for 4.21 Bare Metal IPI");
    });

    it("bm-bmc-verify-ca NOT selected for 4.21 Bare Metal UPI", () => {
      const ctx = { versionMajorMinor: "4.21", platform: "Bare Metal", methodology: "UPI" };
      const selected = selectAndOrder("4.21", ctx);
      const found = selected.find((c) => c.id === "bm-bmc-verify-ca");
      assert.equal(found, undefined, "bm-bmc-verify-ca should NOT appear for Bare Metal UPI");
    });

    it("bm-bmc-verify-ca NOT selected for 4.20 Bare Metal Agent", () => {
      const ctx = { versionMajorMinor: "4.20", platform: "Bare Metal", methodology: "Agent-Based Installer" };
      const selected = selectAndOrder("4.20", ctx);
      const found = selected.find((c) => c.id === "bm-bmc-verify-ca");
      assert.equal(found, undefined, "bm-bmc-verify-ca should NOT appear for 4.20");
    });
  });

  describe("4.21 AWS compartments present", () => {
    it("AWS GovCloud IPI compartments exist in v4.21", () => {
      const awsIds = ["aws-govcloud-prereqs", "aws-govcloud-install"];
      const found = compartments_v421.filter((c) => awsIds.includes(c.id));
      assert.equal(
        found.length,
        2,
        `Should have 2 AWS GovCloud IPI compartments in v4.21, found ${found.length}`
      );
    });
  });

  describe("4.21 Azure compartments present", () => {
    it("Azure Government IPI compartments exist in v4.21", () => {
      const azureIds = ["azure-gov-prereqs", "azure-gov-install"];
      const found = compartments_v421.filter((c) => azureIds.includes(c.id));
      assert.equal(
        found.length,
        2,
        `Should have 2 Azure Government IPI compartments in v4.21, found ${found.length}`
      );
    });
  });

  describe("4.21 global compartments present", () => {
    it("global prereqs compartment exists in v4.21", () => {
      const globalPrereqs = compartments_v421.find((c) => c.id === "global-prereqs");
      assert(globalPrereqs, "global-prereqs compartment should exist");
      assert.equal(globalPrereqs.version, "4.21");
    });

    it("proxy-config compartment exists in v4.21", () => {
      const proxyConfig = compartments_v421.find((c) => c.id === "proxy-config");
      assert(proxyConfig, "proxy-config compartment should exist");
      assert.equal(proxyConfig.version, "4.21");
    });

    it("fips-prereqs compartment exists in v4.21", () => {
      const fipsPrereqs = compartments_v421.find((c) => c.id === "fips-prereqs");
      assert(fipsPrereqs, "fips-prereqs compartment should exist");
      assert.equal(fipsPrereqs.version, "4.21");
    });
  });

  describe("4.21 mirror compartments present", () => {
    it("oc-mirror low-side compartment exists in v4.21", () => {
      const ocMirror = compartments_v421.find((c) => c.id === "oc-mirror-low-side");
      assert(ocMirror, "oc-mirror-low-side compartment should exist");
      assert.equal(ocMirror.version, "4.21");
    });
  });

  describe("A1a: vSphere prerequisite version corrections (4.20)", () => {
    const vsphereMethodologies = [
      { methodology: "IPI", prereqsId: "vsphere-ipi-prereqs" },
      { methodology: "UPI", prereqsId: "vsphere-upi-prereqs" },
      { methodology: "Agent-Based Installer", prereqsId: "vsphere-agent-prereqs" },
    ];

    for (const { methodology, prereqsId } of vsphereMethodologies) {
      it(`${methodology} 4.20: contains ESXi 8.0 Update 1 requirement`, () => {
        const selected = selectAndOrder("4.20", { platform: "VMware vSphere", methodology });
        const prereqs = selected.find((c) => c.id === prereqsId);
        assert(prereqs, `${prereqsId} should be selected`);
        const versionItem = prereqs.items[0].text;
        assert(versionItem.includes("8.0 Update 1"), `${prereqsId} items[0] should require ESXi 8.0 Update 1, got: ${versionItem}`);
      });

      it(`${methodology} 4.20: contains vSphere Foundation 9 alternative`, () => {
        const selected = selectAndOrder("4.20", { platform: "VMware vSphere", methodology });
        const prereqs = selected.find((c) => c.id === prereqsId);
        const versionItem = prereqs.items[0].text;
        assert(versionItem.includes("vSphere Foundation 9"), `${prereqsId} items[0] should include vSphere Foundation 9 alternative, got: ${versionItem}`);
      });

      it(`${methodology} 4.20: contains Cloud Foundation 5.0 requirement`, () => {
        const selected = selectAndOrder("4.20", { platform: "VMware vSphere", methodology });
        const prereqs = selected.find((c) => c.id === prereqsId);
        const versionItem = prereqs.items[0].text;
        assert(versionItem.includes("Cloud Foundation") && versionItem.includes("5.0 or later"), `${prereqsId} items[0] should require Cloud Foundation 5.0 or later, got: ${versionItem}`);
      });

      it(`${methodology} 4.20: contains Cloud Foundation 9 alternative`, () => {
        const selected = selectAndOrder("4.20", { platform: "VMware vSphere", methodology });
        const prereqs = selected.find((c) => c.id === prereqsId);
        const versionItem = prereqs.items[0].text;
        assert(versionItem.includes("Cloud Foundation 9"), `${prereqsId} items[0] should include Cloud Foundation 9 alternative, got: ${versionItem}`);
      });

      it(`${methodology} 4.20: does NOT contain 7.0 Update 2`, () => {
        const selected = selectAndOrder("4.20", { platform: "VMware vSphere", methodology });
        const prereqs = selected.find((c) => c.id === prereqsId);
        const versionItem = prereqs.items[0].text;
        assert(!versionItem.includes("7.0 Update 2"), `${prereqsId} items[0] must not reference 7.0 Update 2`);
      });

      it(`${methodology} 4.20: does NOT contain 7.0 U2`, () => {
        const selected = selectAndOrder("4.20", { platform: "VMware vSphere", methodology });
        const prereqs = selected.find((c) => c.id === prereqsId);
        const versionItem = prereqs.items[0].text;
        assert(!versionItem.includes("7.0 U2"), `${prereqsId} items[0] must not reference 7.0 U2`);
      });
    }
  });

  describe("A1a: vSphere prerequisite version corrections (4.21)", () => {
    const vsphereMethodologies = [
      { methodology: "IPI", prereqsId: "vsphere-ipi-prereqs" },
      { methodology: "UPI", prereqsId: "vsphere-upi-prereqs" },
      { methodology: "Agent-Based Installer", prereqsId: "vsphere-agent-prereqs" },
    ];

    for (const { methodology, prereqsId } of vsphereMethodologies) {
      it(`${methodology} 4.21: contains ESXi 8.0 Update 1 requirement`, () => {
        const selected = selectAndOrder("4.21", { platform: "VMware vSphere", methodology });
        const prereqs = selected.find((c) => c.id === prereqsId);
        assert(prereqs, `${prereqsId} should be selected`);
        const versionItem = prereqs.items[0].text;
        assert(versionItem.includes("8.0 Update 1"), `${prereqsId} items[0] should require ESXi 8.0 Update 1, got: ${versionItem}`);
      });

      it(`${methodology} 4.21: contains vSphere Foundation 9 alternative`, () => {
        const selected = selectAndOrder("4.21", { platform: "VMware vSphere", methodology });
        const prereqs = selected.find((c) => c.id === prereqsId);
        const versionItem = prereqs.items[0].text;
        assert(versionItem.includes("vSphere Foundation 9"), `${prereqsId} items[0] should include vSphere Foundation 9 alternative, got: ${versionItem}`);
      });

      it(`${methodology} 4.21: contains Cloud Foundation 5.0 requirement`, () => {
        const selected = selectAndOrder("4.21", { platform: "VMware vSphere", methodology });
        const prereqs = selected.find((c) => c.id === prereqsId);
        const versionItem = prereqs.items[0].text;
        assert(versionItem.includes("Cloud Foundation") && versionItem.includes("5.0 or later"), `${prereqsId} items[0] should require Cloud Foundation 5.0 or later, got: ${versionItem}`);
      });

      it(`${methodology} 4.21: contains Cloud Foundation 9 alternative`, () => {
        const selected = selectAndOrder("4.21", { platform: "VMware vSphere", methodology });
        const prereqs = selected.find((c) => c.id === prereqsId);
        const versionItem = prereqs.items[0].text;
        assert(versionItem.includes("Cloud Foundation 9"), `${prereqsId} items[0] should include Cloud Foundation 9 alternative, got: ${versionItem}`);
      });

      it(`${methodology} 4.21: does NOT contain 7.0 Update 2`, () => {
        const selected = selectAndOrder("4.21", { platform: "VMware vSphere", methodology });
        const prereqs = selected.find((c) => c.id === prereqsId);
        const versionItem = prereqs.items[0].text;
        assert(!versionItem.includes("7.0 Update 2"), `${prereqsId} items[0] must not reference 7.0 Update 2`);
      });

      it(`${methodology} 4.21: does NOT contain 7.0 U2`, () => {
        const selected = selectAndOrder("4.21", { platform: "VMware vSphere", methodology });
        const prereqs = selected.find((c) => c.id === prereqsId);
        const versionItem = prereqs.items[0].text;
        assert(!versionItem.includes("7.0 U2"), `${prereqsId} items[0] must not reference 7.0 U2`);
      });
    }
  });

  describe("A1a: Nutanix prerequisite version corrections (4.20)", () => {
    it("Nutanix IPI 4.20: contains AOS 6.5.2.7 requirement", () => {
      const selected = selectAndOrder("4.20", { platform: "Nutanix", methodology: "IPI" });
      const prereqs = selected.find((c) => c.id === "nutanix-ipi-prereqs");
      assert(prereqs, "nutanix-ipi-prereqs should be selected");
      const versionItem = prereqs.items[0].text;
      assert(versionItem.includes("6.5.2.7"), `nutanix-ipi-prereqs items[0] should require AOS 6.5.2.7, got: ${versionItem}`);
    });

    it("Nutanix IPI 4.20: contains Prism Central pc.2022.6 requirement", () => {
      const selected = selectAndOrder("4.20", { platform: "Nutanix", methodology: "IPI" });
      const prereqs = selected.find((c) => c.id === "nutanix-ipi-prereqs");
      const versionItem = prereqs.items[0].text;
      assert(versionItem.includes("pc.2022.6"), `nutanix-ipi-prereqs items[0] should require Prism Central pc.2022.6, got: ${versionItem}`);
    });
  });

  describe("A1a: Nutanix prerequisite version corrections (4.21)", () => {
    it("Nutanix IPI 4.21: contains AOS 6.5.2.7 requirement", () => {
      const selected = selectAndOrder("4.21", { platform: "Nutanix", methodology: "IPI" });
      const prereqs = selected.find((c) => c.id === "nutanix-ipi-prereqs");
      assert(prereqs, "nutanix-ipi-prereqs should be selected");
      const versionItem = prereqs.items[0].text;
      assert(versionItem.includes("6.5.2.7"), `nutanix-ipi-prereqs items[0] should require AOS 6.5.2.7, got: ${versionItem}`);
    });

    it("Nutanix IPI 4.21: contains Prism Central pc.2022.6 requirement", () => {
      const selected = selectAndOrder("4.21", { platform: "Nutanix", methodology: "IPI" });
      const prereqs = selected.find((c) => c.id === "nutanix-ipi-prereqs");
      const versionItem = prereqs.items[0].text;
      assert(versionItem.includes("pc.2022.6"), `nutanix-ipi-prereqs items[0] should require Prism Central pc.2022.6, got: ${versionItem}`);
    });

    it("Nutanix IPI 4.21: does NOT retain stale OCP 4.20 reference", () => {
      const selected = selectAndOrder("4.21", { platform: "Nutanix", methodology: "IPI" });
      const prereqs = selected.find((c) => c.id === "nutanix-ipi-prereqs");
      const versionItem = prereqs.items[0].text;
      assert(!versionItem.includes("OCP 4.20"), `nutanix-ipi-prereqs items[0] must not reference OCP 4.20`);
      assert(!versionItem.includes("4.20"), `nutanix-ipi-prereqs items[0] must not reference 4.20`);
    });
  });

  describe("unsupported version blocking (Slice 5F.2)", () => {
    it("throws clear error for version 4.22 (future)", () => {
      assert.throws(
        () => selectAndOrder("4.22", { platform: "Bare Metal", methodology: "IPI" }),
        /OpenShift 4\.22 is not supported.*Supported versions:/,
        "Should throw clear error for unsupported version 4.22"
      );
    });

    it("throws clear error for version 4.99 (far future)", () => {
      assert.throws(
        () => selectAndOrder("4.99", { platform: "Bare Metal", methodology: "IPI" }),
        /OpenShift 4\.99 is not supported.*Supported versions:/,
        "Should throw clear error for unsupported version 4.99"
      );
    });

    it("throws clear error for invalid version format", () => {
      assert.throws(
        () => selectAndOrder("invalid", { platform: "Bare Metal", methodology: "IPI" }),
        /OpenShift version is required/,
        "Should throw clear error for invalid version format (treated as null by normalizer)"
      );
    });

    it("throws clear error for missing version", () => {
      assert.throws(
        () => selectAndOrder(null, { platform: "Bare Metal", methodology: "IPI" }),
        /OpenShift version is required/,
        "Should throw clear error for missing version"
      );
    });

    it("throws clear error for empty string version", () => {
      assert.throws(
        () => selectAndOrder("", { platform: "Bare Metal", methodology: "IPI" }),
        /OpenShift version is required/,
        "Should throw clear error for empty string version"
      );
    });

    it("does NOT silently fallback to v4.20 for unsupported versions", () => {
      try {
        selectAndOrder("4.22", { platform: "Bare Metal", methodology: "IPI" });
        assert.fail("Should have thrown an error, not returned v4.20 compartments");
      } catch (err) {
        assert(err.message.includes("not supported"), "Error should indicate version not supported");
      }
    });
  });
});

describe("FG-4.21-A2: source-tree stale-label coverage", () => {
  const CLASS_B_TEXT = "Ensure the installer host runs RHEL 8.6+ or RHEL 9 (RHEL 9 is recommended for OCP 4.20).";
  const CLASS_C_TEXT = "If using an existing VNet (BYO VNet): configure virtualNetwork, networkResourceGroupName, and subnet topology. OpenShift 4.21 uses platform.azure.subnets[] with role: control-plane and role: node entries, supporting multiple node subnets. If a multi-node configuration is later interpreted as 4.20, all subnet values are preserved in state but generation is blocked because 4.20 can represent only one compute subnet. To generate for 4.20, explicitly reduce the configuration to one node subnet. Configurations requiring multiple node subnets must use OpenShift 4.21.";

  it("v4.21 source directory exists and contains .js files", () => {
    const files = readdirSync(V421_SOURCE_DIR).filter((f) => f.endsWith(".js"));
    assert(files.length > 0, "v4.21 source directory should contain .js files");
  });

  it("Class B: global.js preserves exactly one RHEL-host statement with one raw 4.20", () => {
    const content = readFileSync(join(V421_SOURCE_DIR, "global.js"), "utf8");
    const classBLines = content.split("\n").filter((l) => l.includes(CLASS_B_TEXT));
    assert.equal(classBLines.length, 1, `global.js must contain exactly one line with the RHEL-host statement, found: ${classBLines.length}`);
    const matches = classBLines[0].match(/4\.20/g);
    assert.equal(
      matches && matches.length,
      1,
      `Class B source line must contain exactly one raw '4.20', found: ${matches ? matches.length : 0}`
    );
  });

  it("Class C: azure.js preserves exactly one BYO VNet statement with three bare 4.20", () => {
    const content = readFileSync(join(V421_SOURCE_DIR, "azure.js"), "utf8");
    const classCLines = content.split("\n").filter((l) => l.includes(CLASS_C_TEXT));
    assert.equal(classCLines.length, 1, `azure.js must contain exactly one line with the BYO VNet statement, found: ${classCLines.length}`);
    const matches = classCLines[0].match(/4\.20/g);
    assert.equal(
      matches && matches.length,
      3,
      `BYO VNet statement must contain exactly three bare '4.20', found: ${matches ? matches.length : 0}`
    );
  });

  it("exactly 4 raw 4.20 literals: 1 in global.js (Class B), 3 in azure.js (Class C), 0 elsewhere", () => {
    const files = readdirSync(V421_SOURCE_DIR).filter((f) => f.endsWith(".js"));
    const violations = [];
    let classBFound = 0;
    let classCFound = 0;
    for (const file of files) {
      const content = readFileSync(join(V421_SOURCE_DIR, file), "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes("4.20")) continue;
        if (file === "global.js" && line.includes(CLASS_B_TEXT)) {
          classBFound++;
          const count = (line.match(/4\.20/g) || []).length;
          if (count > 1) violations.push(`${file}:${i + 1}: Class B line has ${count} raw 4.20 (approved: 1): ${line.trim()}`);
          continue;
        }
        if (file === "azure.js" && line.includes(CLASS_C_TEXT)) {
          classCFound++;
          const count = (line.match(/4\.20/g) || []).length;
          if (count > 3) violations.push(`${file}:${i + 1}: Class C line has ${count} raw 4.20 (approved: 3): ${line.trim()}`);
          continue;
        }
        violations.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }
    assert.equal(classBFound, 1, `Expected exactly 1 Class B line in global.js, found: ${classBFound}`);
    assert.equal(classCFound, 1, `Expected exactly 1 Class C line in azure.js, found: ${classCFound}`);
    assert.equal(
      violations.length,
      0,
      `No raw 4.20 outside path-qualified Class B/C allowlist. Violations:\n${violations.join("\n")}`
    );
  });
});

describe("FG-4.21-A2: runtime-compartment stale-label coverage", () => {
  const CLASS_B_TEXT = "Ensure the installer host runs RHEL 8.6+ or RHEL 9 (RHEL 9 is recommended for OCP 4.20).";
  const CLASS_C_TEXT = "If using an existing VNet (BYO VNet): configure virtualNetwork, networkResourceGroupName, and subnet topology. OpenShift 4.21 uses platform.azure.subnets[] with role: control-plane and role: node entries, supporting multiple node subnets. If a multi-node configuration is later interpreted as 4.20, all subnet values are preserved in state but generation is blocked because 4.20 can represent only one compute subnet. To generate for 4.20, explicitly reduce the configuration to one node subnet. Configurations requiring multiple node subnets must use OpenShift 4.21.";

  it("Class B: global-prereqs compartment contains exactly one RHEL-host item", () => {
    const comp = compartments_v421.find((c) => c.id === "global-prereqs");
    assert(comp, "global-prereqs compartment must exist");
    const matchingItems = comp.items.filter((i) => i.text === CLASS_B_TEXT);
    assert.equal(matchingItems.length, 1, `global-prereqs must contain exactly one RHEL-host item, found: ${matchingItems.length}`);
  });

  it("Class C: azure-gov-prereqs compartment contains exactly one BYO VNet item with three 4.20", () => {
    const comp = compartments_v421.find((c) => c.id === "azure-gov-prereqs");
    assert(comp, "azure-gov-prereqs compartment must exist");
    const matchingItems = comp.items.filter((i) => i.text === CLASS_C_TEXT);
    assert.equal(matchingItems.length, 1, `azure-gov-prereqs must contain exactly one BYO VNet item, found: ${matchingItems.length}`);
    const matches = matchingItems[0].text.match(/4\.20/g);
    assert.equal(
      matches && matches.length,
      3,
      `BYO VNet item must contain exactly three '4.20', found: ${matches ? matches.length : 0}`
    );
  });

  it("exactly 1 Class B + 1 Class C runtime entry, no duplicates, no other raw 4.20", () => {
    const violations = [];
    let classBFound = 0;
    let classCFound = 0;
    for (const comp of compartments_v421) {
      const texts = [];
      if (comp.title) texts.push({ field: "title", value: comp.title });
      for (const ref of comp.docRefs || []) {
        if (ref.label) texts.push({ field: `docRef.label`, value: ref.label });
      }
      for (let idx = 0; idx < (comp.items || []).length; idx++) {
        const item = comp.items[idx];
        if (item.text) texts.push({ field: `items[${idx}].text`, value: item.text });
        if (item.cmd) texts.push({ field: `items[${idx}].cmd`, value: item.cmd });
      }
      for (const entry of texts) {
        if (!entry.value.includes("4.20")) continue;
        if (comp.id === "global-prereqs" && entry.value === CLASS_B_TEXT) {
          classBFound++;
          continue;
        }
        if (comp.id === "azure-gov-prereqs" && entry.value === CLASS_C_TEXT) {
          classCFound++;
          continue;
        }
        violations.push(`${comp.id} ${entry.field}: ${entry.value.substring(0, 80)}...`);
      }
    }
    assert.equal(classBFound, 1, `Expected exactly 1 Class B entry in global-prereqs, found: ${classBFound}`);
    assert.equal(classCFound, 1, `Expected exactly 1 Class C entry in azure-gov-prereqs, found: ${classCFound}`);
    assert.equal(
      violations.length,
      0,
      `No raw 4.20 outside path-qualified Class B/C allowlist in runtime compartments. Violations:\n${violations.join("\n")}`
    );
  });
});