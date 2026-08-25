/**
 * Field Guide Provenance Certification Tests (FG-4.21-C)
 *
 * Deterministic provenance certification for Field Guide assembly inputs.
 * Exercises the real public buildFieldGuide boundary and the certification API.
 *
 * Mutation tests temporarily modify exported arrays/objects and restore them
 * with try/finally to prevent leakage between cases.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFieldGuide } from "../src/fieldGuide/index.js";
import { compartments_v420 } from "../src/fieldGuide/v4.20/index.js";
import { compartments_v421 } from "../src/fieldGuide/v4.21/index.js";
import {
  ProvenanceError,
  INPUT_CLASSIFICATION,
  certifyExport,
  validateSelectedSubset,
  classifyDocsLinks,
  getAuthoritativeExport,
  certifySharedInput,
  getAcceptedSharedInputs,
} from "../src/fieldGuide/provenance.js";
import { FIELD_GUIDE_SUPPORTED_MINORS } from "../src/fieldGuide/versionResolution.js";
import { globalPrereqs as globalPrereqs420 } from "../src/fieldGuide/v4.20/global.js";
import { globalPrereqs as globalPrereqs421 } from "../src/fieldGuide/v4.21/global.js";

// --- Helpers ---

const makeState = (minor, patch, opts = {}) => ({
  blueprint: { platform: opts.platform || "Bare Metal", clusterName: "test", baseDomain: "example.com" },
  methodology: { method: opts.method || "Agent-Based Installer" },
  version: {
    selectedMinor: minor,
    selectedPatch: patch,
    selectedChannel: `stable-${minor}`,
    locked: true,
    _schemaVersion: 3,
  },
  release: { patchVersion: patch },
});

// --- Tests ---

describe("Field Guide Provenance Certification (FG-4.21-C)", () => {

  describe("valid states produce certified markdown through buildFieldGuide", () => {
    it("valid 4.20 locked state returns markdown", () => {
      const md = buildFieldGuide(makeState("4.20", "4.20.15"));
      assert(typeof md === "string" && md.length > 0, "should return non-empty markdown");
      assert(md.includes("OCP 4.20"), "should include OCP 4.20");
    });

    it("valid 4.21 locked state returns markdown", () => {
      const md = buildFieldGuide(makeState("4.21", "4.21.5"));
      assert(typeof md === "string" && md.length > 0, "should return non-empty markdown");
      assert(md.includes("OCP 4.21"), "should include OCP 4.21");
    });
  });

  describe("deterministic inventory from authoritative exports", () => {
    it("certifyExport succeeds for 4.20 and returns the authoritative array", () => {
      const certified = certifyExport("4.20");
      assert.strictEqual(certified, compartments_v420, "should return the v4.20 export by identity");
      assert(certified.length > 0, "v4.20 export should be non-empty");
      const ids = certified.map(c => c.id);
      assert.strictEqual(new Set(ids).size, ids.length, "all IDs should be unique");
      for (const c of certified) {
        assert.equal(c.version, "4.20", `compartment "${c.id}" should have version 4.20`);
        assert(typeof c.id === "string" && c.id.trim().length > 0, `compartment should have nonempty ID`);
      }
    });

    it("certifyExport succeeds for 4.21 and returns the authoritative array", () => {
      const certified = certifyExport("4.21");
      assert.strictEqual(certified, compartments_v421, "should return the v4.21 export by identity");
      assert(certified.length > 0, "v4.21 export should be non-empty");
      const ids = certified.map(c => c.id);
      assert.strictEqual(new Set(ids).size, ids.length, "all IDs should be unique");
      for (const c of certified) {
        assert.equal(c.version, "4.21", `compartment "${c.id}" should have version 4.21`);
        assert(typeof c.id === "string" && c.id.trim().length > 0, `compartment should have nonempty ID`);
      }
    });

    it("inventory expectations derived from exports, not hard-coded counts", () => {
      const v420 = getAuthoritativeExport("4.20");
      const v421 = getAuthoritativeExport("4.21");
      assert.strictEqual(v421.length, v420.length + 1, "v4.21 should have exactly one more compartment than v4.20");
      const extraInV421 = v421.filter(c => !v420.some(c420 => c420.id === c.id));
      assert.strictEqual(extraInV421.length, 1, "exactly one compartment should be unique to v4.21");
      assert.strictEqual(extraInV421[0].id, "bm-bmc-verify-ca");
    });

    it("getAuthoritativeExport returns null for unsupported versions", () => {
      assert.strictEqual(getAuthoritativeExport("4.22"), null);
      assert.strictEqual(getAuthoritativeExport("4.19"), null);
      assert.strictEqual(getAuthoritativeExport(""), null);
    });
  });

  describe("mixed-version substitution detection", () => {
    it("4.20 object substituted into 4.21 export fails at buildFieldGuide boundary", () => {
      const saved = compartments_v421[0];
      try {
        compartments_v421[0] = compartments_v420[0];
        assert.throws(
          () => buildFieldGuide(makeState("4.21", "4.21.5")),
          (err) => {
            assert.equal(err.name, "ProvenanceError");
            return true;
          }
        );
      } finally {
        compartments_v421[0] = saved;
      }
    });

    it("identity substitution detected even when version field patched to match", () => {
      const saved421_0 = compartments_v421[0];
      const saved420_0_version = compartments_v420[0].version;
      try {
        compartments_v420[0].version = "4.21";
        compartments_v421[0] = compartments_v420[0];
        assert.throws(
          () => buildFieldGuide(makeState("4.21", "4.21.5")),
          (err) => {
            assert.equal(err.name, "ProvenanceError");
            assert.match(err.message, /identity substitution/i);
            assert.equal(err.invariant, "no-cross-version-identity");
            return true;
          }
        );
      } finally {
        compartments_v421[0] = saved421_0;
        compartments_v420[0].version = saved420_0_version;
      }
    });
  });

  describe("mixed-provenance detection (exclusive export membership)", () => {
    it("original v4.21 compartment inserted into v4.20 export fails at buildFieldGuide boundary", () => {
      compartments_v420.push(compartments_v421[0]);
      try {
        assert.throws(
          () => buildFieldGuide(makeState("4.21", "4.21.5")),
          (err) => {
            assert.equal(err.name, "ProvenanceError");
            assert.equal(err.invariant, "exclusive-export-membership");
            assert.match(err.message, /4\.20/);
            return true;
          }
        );
      } finally {
        compartments_v420.pop();
      }
    });
  });

  describe("inventory completeness (missing/moved compartments)", () => {
    it("removed original compartment from owning export fails at buildFieldGuide boundary", () => {
      const removed = compartments_v421.pop();
      try {
        assert.throws(
          () => buildFieldGuide(makeState("4.21", "4.21.5")),
          (err) => {
            assert.equal(err.name, "ProvenanceError");
            assert.equal(err.invariant, "inventory-completeness");
            assert.match(err.message, new RegExp(removed.id));
            assert.match(err.message, /missing/);
            return true;
          }
        );
      } finally {
        compartments_v421.push(removed);
      }
    });

    it("original 4.21 compartment moved to 4.20 export fails at buildFieldGuide boundary", () => {
      const moved = compartments_v421.pop();
      compartments_v420.push(moved);
      try {
        assert.throws(
          () => buildFieldGuide(makeState("4.21", "4.21.5")),
          (err) => {
            assert.equal(err.name, "ProvenanceError");
            assert.equal(err.invariant, "inventory-completeness");
            assert.match(err.message, /4\.20/);
            assert.match(err.message, /moved/);
            return true;
          }
        );
      } finally {
        compartments_v420.pop();
        compartments_v421.push(moved);
      }
    });
  });

  describe("inconsistent structured minor", () => {
    it("compartment with wrong version field fails at buildFieldGuide boundary", () => {
      const saved = compartments_v421[0].version;
      try {
        compartments_v421[0].version = "4.20";
        assert.throws(
          () => buildFieldGuide(makeState("4.21", "4.21.5")),
          (err) => {
            assert.equal(err.name, "ProvenanceError");
            assert.equal(err.invariant, "version-consistency");
            assert.match(err.message, /4\.20/);
            return true;
          }
        );
      } finally {
        compartments_v421[0].version = saved;
      }
    });
  });

  describe("unsupported 4.22 structured provenance", () => {
    it("compartment claiming version 4.22 fails at buildFieldGuide boundary", () => {
      const saved = compartments_v421[0].version;
      try {
        compartments_v421[0].version = "4.22";
        assert.throws(
          () => buildFieldGuide(makeState("4.21", "4.21.5")),
          (err) => {
            assert.equal(err.name, "ProvenanceError");
            assert.match(err.message, /4\.22/);
            assert.equal(err.invariant, "version-consistency");
            return true;
          }
        );
      } finally {
        compartments_v421[0].version = saved;
      }
    });

    it("certifyExport rejects 4.22 as unsupported version", () => {
      assert.throws(
        () => certifyExport("4.22"),
        (err) => {
          assert.equal(err.name, "ProvenanceError");
          assert.match(err.message, /4\.22/);
          assert.equal(err.invariant, "supported-version");
          return true;
        }
      );
    });
  });

  describe("unattributable compartment input", () => {
    it("injected compartment in authoritative export fails at buildFieldGuide boundary", () => {
      const injected = {
        id: "injected-source",
        version: "4.21",
        title: "Unattributable Injected Section",
        order: 999,
        items: [{ text: "UNATTRIBUTABLE_ACCEPTED" }],
      };
      compartments_v421.push(injected);
      try {
        assert.throws(
          () => buildFieldGuide(makeState("4.21", "4.21.5")),
          (err) => {
            assert.equal(err.name, "ProvenanceError");
            assert.equal(err.invariant, "unattributable-source");
            assert.match(err.message, /injected-source/);
            return true;
          }
        );
      } finally {
        compartments_v421.pop();
      }
    });

    it("null entry in authoritative export fails at buildFieldGuide boundary", () => {
      compartments_v421.push(null);
      try {
        assert.throws(
          () => buildFieldGuide(makeState("4.21", "4.21.5")),
          (err) => {
            assert.equal(err.name, "ProvenanceError");
            assert.equal(err.invariant, "compartment-shape");
            assert.match(err.message, /null/);
            return true;
          }
        );
      } finally {
        compartments_v421.pop();
      }
    });

    it("foreign compartment not in certified export fails validateSelectedSubset", () => {
      const certified = certifyExport("4.21");
      const foreign = { id: "foreign-test", version: "4.21", title: "Foreign", order: 999, items: [] };
      assert.throws(
        () => validateSelectedSubset([foreign], certified, "4.21"),
        (err) => {
          assert.equal(err.name, "ProvenanceError");
          assert.equal(err.invariant, "identity-preserving-subset");
          assert.match(err.message, /unattributable/i);
          return true;
        }
      );
    });

    it("compartment from wrong version export fails validateSelectedSubset for 4.21", () => {
      const certified = certifyExport("4.21");
      assert.throws(
        () => validateSelectedSubset([compartments_v420[0]], certified, "4.21"),
        (err) => {
          assert.equal(err.name, "ProvenanceError");
          assert.equal(err.invariant, "identity-preserving-subset");
          return true;
        }
      );
    });

    it("compartment from wrong version export fails validateSelectedSubset for 4.20", () => {
      const certified = certifyExport("4.20");
      assert.throws(
        () => validateSelectedSubset([compartments_v421[0]], certified, "4.20"),
        (err) => {
          assert.equal(err.name, "ProvenanceError");
          assert.equal(err.invariant, "identity-preserving-subset");
          return true;
        }
      );
    });
  });

  describe("duplicate-ID ambiguity", () => {
    it("same-reference duplication at two positions fails at buildFieldGuide boundary", () => {
      const lastIndex = compartments_v421.length - 1;
      const saved = compartments_v421[lastIndex];
      try {
        compartments_v421[lastIndex] = compartments_v421[0];
        assert.throws(
          () => buildFieldGuide(makeState("4.21", "4.21.5")),
          (err) => {
            assert.equal(err.name, "ProvenanceError");
            assert.equal(err.invariant, "unique-id");
            assert.match(err.message, new RegExp(compartments_v421[0].id));
            return true;
          }
        );
      } finally {
        compartments_v421[lastIndex] = saved;
      }
    });
  });

  describe("Azure Class C compatibility text", () => {
    it("4.21 Azure Government guide renders with 4.20 backward-compatibility text", () => {
      const state = makeState("4.21", "4.21.5", { platform: "Azure Government", method: "IPI" });
      const md = buildFieldGuide(state);
      assert(typeof md === "string" && md.length > 0, "should return markdown");
      assert(md.includes("4.20"), "should include 4.20 backward-compatibility reference");
    });

    it("compatibility text and cross-version URLs are not used as provenance detectors", () => {
      const state = makeState("4.21", "4.21.5", { platform: "Azure Government", method: "IPI" });
      const md = buildFieldGuide(state);
      assert(typeof md === "string" && md.length > 0,
        "should produce markdown despite 4.20 text in compartment items");
      assert(md.includes("BYO VNet") || md.includes("VNet"),
        "Azure compatibility text should be present in output");
    });
  });

  describe("shared and global input classification", () => {
    it("INPUT_CLASSIFICATION has expected entries and is frozen", () => {
      assert.equal(INPUT_CLASSIFICATION.VERSION_SPECIFIC, "version-specific");
      assert.equal(INPUT_CLASSIFICATION.SHARED, "shared");
      assert.equal(INPUT_CLASSIFICATION.RUNTIME_METADATA, "runtime-metadata");
      assert(Object.isFrozen(INPUT_CLASSIFICATION));
    });

    it("global.js compartments are version-specific with separate objects per version", () => {
      assert.equal(globalPrereqs420.version, "4.20");
      assert.equal(globalPrereqs421.version, "4.21");
      assert.notStrictEqual(globalPrereqs420, globalPrereqs421,
        "v4.20 and v4.21 globalPrereqs should be different object references");
      assert(compartments_v420.includes(globalPrereqs420),
        "v4.20 globalPrereqs should be in v4.20 export");
      assert(compartments_v421.includes(globalPrereqs421),
        "v4.21 globalPrereqs should be in v4.21 export");
    });

    it("shared inputs are bound and certified through production assembly", () => {
      buildFieldGuide(makeState("4.21", "4.21.5"));
      const registry = getAcceptedSharedInputs();
      assert(registry.size >= 2, "at least renderer and troubleshooting should be registered");
      for (const [fn, classification] of registry) {
        assert.equal(typeof fn, "function", "registered input should be a function");
        assert.equal(classification, INPUT_CLASSIFICATION.SHARED,
          "shared inputs should have SHARED classification");
      }
    });

    it("certifySharedInput rejects unregistered function", () => {
      const unregistered = () => {};
      assert.throws(
        () => certifySharedInput(unregistered, "unregistered-fn"),
        (err) => {
          assert.equal(err.name, "ProvenanceError");
          assert.equal(err.invariant, "accepted-shared-binding");
          return true;
        }
      );
    });

    it("docsLinks classified as runtime metadata through production assembly", () => {
      const links = [
        { label: "OCP 4.21 docs", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/installing/index" },
      ];
      const md = buildFieldGuide(makeState("4.21", "4.21.5"), links);
      assert(typeof md === "string" && md.length > 0, "should produce markdown with docsLinks");
    });

    it("non-array docsLinks fails at buildFieldGuide boundary", () => {
      assert.throws(
        () => buildFieldGuide(makeState("4.21", "4.21.5"), "not-an-array"),
        (err) => {
          assert.equal(err.name, "ProvenanceError");
          assert.equal(err.invariant, "runtime-metadata-shape");
          assert.match(err.message, /string/);
          return true;
        }
      );
    });

    it("falsy non-array docsLinks values fail at buildFieldGuide boundary", () => {
      for (const falsy of [false, 0, ""]) {
        assert.throws(
          () => buildFieldGuide(makeState("4.21", "4.21.5"), falsy),
          (err) => {
            assert.equal(err.name, "ProvenanceError");
            assert.equal(err.invariant, "runtime-metadata-shape");
            return true;
          },
          `should reject docsLinks=${JSON.stringify(falsy)}`
        );
      }
    });

    it("classifyDocsLinks validates shape without inferring version from URLs", () => {
      const links = [
        { label: "OCP 4.21 docs", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/installing/index" },
        { label: "OCP 4.20 docs", url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/index" },
      ];
      const result = classifyDocsLinks(links);
      assert.strictEqual(result, links, "should return the input array unchanged");
    });

    it("classifyDocsLinks rejects entry with missing label", () => {
      assert.throws(
        () => classifyDocsLinks([{ url: "https://example.com" }]),
        (err) => {
          assert.equal(err.name, "ProvenanceError");
          assert.equal(err.invariant, "runtime-metadata-shape");
          return true;
        }
      );
    });

    it("classifyDocsLinks rejects entry with missing url", () => {
      assert.throws(
        () => classifyDocsLinks([{ label: "Test" }]),
        (err) => {
          assert.equal(err.name, "ProvenanceError");
          assert.equal(err.invariant, "runtime-metadata-shape");
          return true;
        }
      );
    });

    it("classifyDocsLinks rejects non-object entry", () => {
      assert.throws(
        () => classifyDocsLinks([null]),
        (err) => {
          assert.equal(err.name, "ProvenanceError");
          assert.equal(err.invariant, "runtime-metadata-shape");
          return true;
        }
      );
    });

    it("classifyDocsLinks accepts empty array", () => {
      assert.deepStrictEqual(classifyDocsLinks([]), []);
    });

    it("classifyDocsLinks accepts null/undefined", () => {
      assert.deepStrictEqual(classifyDocsLinks(null), []);
      assert.deepStrictEqual(classifyDocsLinks(undefined), []);
    });
  });

  describe("ProvenanceError diagnostics", () => {
    it("carries resolvedMinor, compartmentId, sourceIdentity, and invariant", () => {
      const err = new ProvenanceError("test", {
        resolvedMinor: "4.21",
        compartmentId: "test-id",
        sourceIdentity: "4.20",
        invariant: "test-invariant",
      });
      assert.equal(err.name, "ProvenanceError");
      assert.equal(err.code, "PROVENANCE_ERROR");
      assert.equal(err.resolvedMinor, "4.21");
      assert.equal(err.compartmentId, "test-id");
      assert.equal(err.sourceIdentity, "4.20");
      assert.equal(err.invariant, "test-invariant");
      assert.equal(err.message, "test");
      assert(err instanceof Error);
    });

    it("defaults diagnostic fields to null when not provided", () => {
      const err = new ProvenanceError("minimal");
      assert.equal(err.resolvedMinor, null);
      assert.equal(err.compartmentId, null);
      assert.equal(err.sourceIdentity, null);
      assert.equal(err.invariant, null);
    });
  });
});
