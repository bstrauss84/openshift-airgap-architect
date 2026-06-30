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
import { compartments_v421 } from "../src/fieldGuide/v4.21/index.js";
import { compartments_v420 } from "../src/fieldGuide/v4.20/index.js";
import { selectAndOrder } from "../src/fieldGuide/assembler.js";

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

    it("v4.21 compartments count equals v4.20 (all platforms included)", () => {
      const v420Count = compartments_v420.length;
      const v421Count = compartments_v421.length;
      assert.equal(
        v421Count,
        v420Count,
        `v4.21 should have same compartments as v4.20. v4.20: ${v420Count}, v4.21: ${v421Count}`
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

  describe("4.21 AWS compartments present", () => {
    it("AWS GovCloud IPI compartments exist in v4.21", () => {
      const awsIds = ["aws-govcloud-ipi-prereqs", "aws-govcloud-ipi-install"];
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
      const azureIds = ["azure-gov-ipi-prereqs", "azure-gov-ipi-install"];
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
      const ocMirror = compartments_v421.find((c) => c.id === "oc-mirror-lowside");
      assert(ocMirror, "oc-mirror-lowside compartment should exist");
      assert.equal(ocMirror.version, "4.21");
    });
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
        /Invalid OpenShift version format/,
        "Should throw clear error for invalid version format"
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
