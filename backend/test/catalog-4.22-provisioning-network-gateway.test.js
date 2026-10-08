/**
 * `platform.baremetal.provisioningNetworkGateway` — 4.22 catalog asset (C1)
 *
 * **4.22 IS STILL UNSUPPORTED AND FAIL-CLOSED.** These are ASSET tests: they read
 * the canonical catalog data and assert what it encodes. They deliberately do not
 * exercise generation or any resolver for 4.22, because no public boundary accepts
 * 4.22 — and the last block below proves that adding this asset did not change
 * that.
 *
 * The field is the only `supported-ui` parameter the 4.22 onboarding adds, and its
 * authority chain is split across two sources, so each half is pinned separately:
 *
 *   mechanical — exact released 4.22.16 installer source, no feature gate;
 *   supportedness — OCP 4.22 Provisioning APIs Ch. 13 §13.1.1 `.spec`, which is
 *     same-minor Red Hat product documentation and carries the three constraints.
 *
 * The constraints are recorded as DOCUMENTED semantics, not as installer-enforced
 * validation: the installer's DHCP-overlap check is inert against the shipped
 * binary (mechanical delta ledger D1). A test that let the catalog claim otherwise
 * would re-introduce exactly the overclaim C1 warned against.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUPPORTED_MINORS } from "../src/versionPolicy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const PATH = "platform.baremetal.provisioningNetworkGateway";

/**
 * Scenario contract, reconciled in Tranche 3.
 *
 *   bare-metal-ipi    supported-ui          control + validation + generation
 *   bare-metal-agent  hidden-not-applicable recorded, never shown, never emitted
 *
 * `supported-ui` means "field has input control, validation, tooltip, flows to
 * backend" (docs/VERSION_AWARENESS_MASTER_STRATEGY.md). Architect offers no
 * Agent control, and the OCP Agent-based Installer parameter chapter does not
 * list the field among the additional platform.baremetal parameters it accepts
 * — it appears ZERO times in the whole Agent book at 4.20, 4.21 and 4.22, while
 * provisioningNetworkCIDR appears twice in each. A shared Go struct is not a
 * licence to emit an undocumented key into an Agent install-config.
 */
const UI_SCENARIOS = ["bare-metal-ipi"];
const RECORDED_NOT_OFFERED_SCENARIOS = ["bare-metal-agent"];
const OWNING_SCENARIOS = [...UI_SCENARIOS, ...RECORDED_NOT_OFFERED_SCENARIOS];
/** Every other 4.22 scenario must NOT carry the row at all. */
const NON_OWNING_SCENARIOS = [
  "aws-govcloud-ipi", "aws-govcloud-upi", "azure-government-ipi", "azure-government-upi",
  "bare-metal-upi", "ibm-cloud-ipi", "nutanix-ipi", "vsphere-agent", "vsphere-ipi", "vsphere-upi",
];

const catalog = (tree, scenario) =>
  JSON.parse(readFileSync(join(REPO, tree, "4.22", `${scenario}.json`), "utf8"));

const row = (scenario, tree = "data/params") =>
  catalog(tree, scenario).parameters.find((p) => p.path === PATH);

describe("4.22 catalog asset — platform.baremetal.provisioningNetworkGateway", () => {
  describe("applicability is derived from the provisioning-network family", () => {
    for (const s of OWNING_SCENARIOS) {
      it(`${s} carries the row`, () => {
        assert.ok(row(s), `${s} should model ${PATH}`);
      });

      it(`${s} also models the fields the row is constrained against`, () => {
        const paths = new Set(catalog("data/params", s).parameters.map((p) => p.path));
        assert.ok(paths.has("platform.baremetal.provisioningNetwork"));
        assert.ok(paths.has("platform.baremetal.provisioningNetworkCIDR"));
      });
    }

    for (const s of NON_OWNING_SCENARIOS) {
      it(`${s} does NOT carry the row`, () => {
        assert.equal(row(s), undefined, `${s} must not model ${PATH}`);
      });
    }

    it("bare-metal-upi is excluded because it models no provisioning network at all", () => {
      const paths = new Set(catalog("data/params", "bare-metal-upi").parameters.map((p) => p.path));
      assert.ok(!paths.has("platform.baremetal.provisioningNetwork"));
      assert.ok(!paths.has("platform.baremetal.provisioningNetworkCIDR"));
    });
  });

  describe("metadata", () => {
    for (const s of UI_SCENARIOS) {
      it(`${s} is supported-ui — it has a control, validation and generation`, () => {
        assert.equal(row(s).supportStatus, "supported-ui");
      });
    }

    for (const s of RECORDED_NOT_OFFERED_SCENARIOS) {
      it(`${s} is hidden-not-applicable — recorded, not offered, not emitted`, () => {
        const r = row(s);
        assert.equal(r.supportStatus, "hidden-not-applicable");
        assert.match(r.description, /NOT EXPOSED and NOT EMITTED/);
        assert.match(r.versionNotes, /appears ZERO times/);
      });

      it(`${s} does not claim supported-ui without an Agent control`, () => {
        // The contract this reconciliation exists to enforce.
        assert.notEqual(row(s).supportStatus, "supported-ui");
      });
    }

    for (const s of OWNING_SCENARIOS) {
      describe(s, () => {
        it("is introduced at 4.22, with no maximum", () => {
          const r = row(s);
          assert.equal(r.minVersion, "4.22");
          assert.equal(r.maxVersion, null);
        });

        it("is an optional single IP string, not an array or a CIDR", () => {
          const r = row(s);
          assert.equal(r.type, "string");
          assert.equal(r.required, false);
          assert.match(r.allowed, /IPv4 or IPv6 address/);
        });

        it("is not marked deprecated and declares no removal", () => {
          const r = row(s);
          assert.notEqual(r.deprecated, true);
          assert.equal(r.removalVersion, undefined);
          assert.equal(r.replacementPath, undefined);
        });

        it("applies_to names only its own scenario", () => {
          assert.deepEqual(row(s).applies_to, [s]);
        });
      });
    }
  });

  describe("documented constraints are encoded", () => {
    for (const s of UI_SCENARIOS) {
      describe(s, () => {
        it("records the Managed-only conditional relationship", () => {
          const c = row(s).conditionals;
          assert.ok(c, "conditionals are required for this row");
          assert.match(c.requires, /platform\.baremetal\.provisioningNetwork set to Managed/);
          assert.match(c.omitWhen, /Unmanaged or Disabled/);
        });

        it("records that the installer accepts-and-ignores the field when not Managed", () => {
          assert.match(row(s).conditionals.omitWhen, /accepts the field in that case but ignores it/);
        });

        it("records the within-CIDR constraint", () => {
          const r = row(s);
          assert.match(`${r.description} ${r.versionNotes} ${r.conditionals.note}`, /within .*provisioningNetworkCIDR/);
        });

        it("records the outside-DHCP-range constraint", () => {
          const r = row(s);
          assert.match(`${r.description} ${r.versionNotes} ${r.conditionals.note}`, /outside .*provisioningDHCPRange/);
        });

        it("records that it must differ from the provisioning IP", () => {
          const r = row(s);
          assert.match(
            `${r.description} ${r.versionNotes} ${r.conditionals.note}`,
            /(must not be the same as ProvisioningIP|different from the provisioning IP)/
          );
        });

        it("records the IP-format constraint the binary DOES enforce", () => {
          assert.match(row(s).versionNotes, /"not-an-ip" REJECTED as not a valid IP/);
        });

        it("does NOT claim the DHCP-overlap rule is installer-enforced (delta ledger D1)", () => {
          const r = row(s);
          assert.match(r.versionNotes, /INERT against the shipped 4\.22\.16 binary/);
          assert.match(r.conditionals.note, /no UI validation may claim the installer rejects an overlapping value/);
        });

        it("carries no validationRules — the constraints are documented, not metadata-enforced", () => {
          assert.equal(row(s).validationRules, undefined);
        });
      });
    }
  });

  describe("provenance", () => {
    for (const s of OWNING_SCENARIOS) {
      describe(s, () => {
        it("cites same-minor Red Hat product documentation", () => {
          const doc = row(s).citations.find((c) => c.docId === "provisioning-apis-provisioning");
          assert.ok(doc, "a Red Hat 4.22 documentation citation is required for supported-ui");
          assert.equal(
            doc.url,
            "https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/html/provisioning_apis/provisioning-metal3-io-v1alpha1"
          );
          assert.equal(doc.sectionHeading, "13.1.1. .spec");
        });

        it("cites the exact 4.22 installer source symbol", () => {
          const src = row(s).citations.find((c) => c.docId === "installer-source-code");
          assert.ok(src);
          assert.equal(src.docTitle, "OpenShift Installer 4.22 Source Code");
          assert.match(src.sectionHeading, /Platform\.ProvisioningNetworkGateway$/);
          assert.match(src.url, /\/blob\/release-4\.22\/pkg\/types\/baremetal\/platform\.go$/);
        });

        it("every citation carries 4.22 provenance and no other minor", () => {
          for (const c of row(s).citations) {
            const m = c.url.match(/openshift_container_platform\/(\d+\.\d+)|release-(\d+\.\d+)\//);
            assert.ok(m, `citation has no minor-bearing provenance: ${c.url}`);
            assert.equal(m[1] || m[2], "4.22");
          }
        });

        it("records that the field is new at 4.22", () => {
          // Both rows must state the introduction minor; only the supported-ui
          // row carries the full exact-release provenance sentence, because the
          // agent row's notes are given over to its non-applicability evidence.
          assert.match(row(s).versionNotes, /Introduced at 4\.22/);
        });
      });
    }
  });

  describe("exact-release provenance on the offered row", () => {
    for (const s of UI_SCENARIOS) {
      it(`${s} records absence from the exact 4.21.35 release source`, () => {
        assert.match(row(s).versionNotes, /absent from the exact 4\.21\.35 release source/);
      });
    }
  });

  describe("the generated frontend mirror matches canonical", () => {
    for (const s of OWNING_SCENARIOS) {
      it(`${s} mirror row is identical to canonical`, () => {
        assert.deepEqual(row(s, "frontend/src/data/catalogs"), row(s, "data/params"));
      });
    }
  });

  describe("adding the asset did not open the support gate", () => {
    it("4.22 is still not a supported minor", () => {
      assert.ok(!SUPPORTED_MINORS.includes("4.22"));
      assert.deepEqual([...SUPPORTED_MINORS], ["4.20", "4.21"]);
    });

    it("the field was NOT backfilled into 4.20 or 4.21", () => {
      for (const minor of ["4.20", "4.21"]) {
        for (const s of OWNING_SCENARIOS) {
          const params = JSON.parse(
            readFileSync(join(REPO, "data/params", minor, `${s}.json`), "utf8")
          ).parameters;
          assert.equal(
            params.find((p) => p.path === PATH),
            undefined,
            `${minor}/${s} must not carry a 4.22-only field`
          );
        }
      }
    });

    it("generation wiring exists but is version-gated, not reachable for 4.22 publicly", () => {
      // Tranche 2 asserted the generator did not mention the field at all,
      // because the wiring was explicitly deferred. Tranche 3 added it, so that
      // assertion is obsolete by design. What must stay true is the gate: the
      // emission helper is guarded by isVersionGTE(selectedMinor, "4.22") and
      // buildInstallConfig() still refuses a 4.22 state outright.
      const gen = readFileSync(join(REPO, "backend/src/generate.js"), "utf8");
      assert.match(gen, /applyProvisioningNetworkGateway/);
      assert.match(gen, /isVersionGTE\(selectedMinor, "4\.22"\)/);
    });
  });
});
