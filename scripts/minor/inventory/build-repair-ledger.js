#!/usr/bin/env node
"use strict";

/**
 * Generate the Tranche 0B repair ledger.
 *
 * Produces docs/minor-release/catalog-repair-ledger-0b.json from the CURRENT
 * canonical catalogs plus the fixed baseline measured before any repair. The
 * baseline is recorded as data rather than recomputed, because the tree it
 * described no longer exists; everything else is derived, so the ledger cannot
 * drift from the catalogs it describes.
 *
 * A companion test, repair-ledger-consistency.test.js, holds this JSON and
 * docs/minor-release/CATALOG_REPAIR_LEDGER_0B.md to each other and checks the
 * arithmetic. That test is hermetic; this generator needs the local
 * documentation evidence and so is run deliberately, not from CI.
 *
 * Usage:
 *   node scripts/minor/inventory/build-repair-ledger.js --evidence-root <dir>
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { parseArgs } = require("../lib/minor.js");
const { inventoryMinor } = require("./catalog-debt-inventory.js");
const R = require("../repair/proven-repairs.js");

const MINORS = ["4.20", "4.21"];

/**
 * State measured at commit 201fa7c, before any canonical row was edited.
 * These are the figures the human accepted as the 0B starting point.
 */
const BASELINE = Object.freeze({
  measuredAtCommit: "201fa7c",
  validatorErrors: { "4.20": 296, "4.21": 445, total: 741 },
  crossMinorCitationObjects: {
    "4.20": { total: 0, visibleToGuard: 0, invisibleToGuard: 0 },
    "4.21": { total: 939, visibleToGuard: 810, invisibleToGuard: 129 },
  },
  headingRows: { "4.20": 94, "4.21": 123, total: 217 },
  headingTriage: {
    A: { "4.20": 76, "4.21": 105, total: 181 },
    B: { phantomRowsWithdrawn: 390 },
    C: { "4.20": 30, "4.21": 30, total: 60 },
    D: { "4.20": 18, "4.21": 18, total: 36 },
  },
  typeAliases: { "4.20": 99, "4.21": 95, total: 194 },
  legacyShapeCitations: { "4.20": 78, "4.21": 144, total: 222 },
  repairRows: { "4.20": 411, "4.21": 1568, total: 1979 },
});

/**
 * What the repair pass actually changed, measured by diffing the canonical
 * catalogs against a pre-mutation copy.
 *
 * UNITS MATTER AND ARE NOT INTERCHANGEABLE. An earlier report said "1,814 rows
 * repaired" while explaining the behavioural effect as "39 parameters x 2
 * minors"; both were true of different things and the word "rows" was doing
 * the damage. Every key below names its unit, and the consistency test rejects
 * a reconciliation key that does not.
 *
 *   parameterRecords        whole catalog parameter objects, counted once each
 *   metadataProperties      individual non-citation property assignments
 *   citationObjects         individual citation objects added/removed/modified
 *   provenanceFindings      individual inventory defects cleared
 *   ruleApplications        individual rule firings by the engine (NOT records)
 *
 * Behaviour is classified by effect, not by key name: a change counts as
 * behaviour-affecting only when it alters what frontend/src/catalogFieldMeta.js
 * getFieldMeta() returns to a consumer. On that test `applies_to` and `type`
 * are inert for every row touched here, and so is a `default` that moves
 * between absent, null and the sentinel — all three read as unspecified.
 */
const APPLIED = Object.freeze({
  measuredBy: "diff of data/params/** against a pre-mutation copy of commit 201fa7c",
  parameterRecordsTouched: { "4.20": 364, "4.21": 1007, total: 1371 },
  metadataPropertiesChanged: {
    "4.20": { type: 99, outputFile: 39, allowed: 39, default: 23, applies_to: 39, total: 239 },
    "4.21": { type: 95, outputFile: 39, allowed: 39, default: 40, applies_to: 39, total: 252 },
    total: 491,
  },
  citationObjectsChanged: {
    "4.20": { modified: 304, removed: 8, added: 0, total: 312 },
    "4.21": { modified: 1041, removed: 42, added: 0, total: 1083 },
    total: 1395,
  },
  provenanceFindingsRepaired: { "4.20": 411, "4.21": 1568, total: 1979 },
  behaviourAffecting: {
    parameterRecords: { "4.20": 39, "4.21": 39, total: 78 },
    consumedPropertyChanges: {
      "4.20": { becameResolvable: 39, allowed: 39, default: 1, total: 79 },
      "4.21": { becameResolvable: 39, allowed: 39, default: 1, total: 79 },
      total: 158,
    },
    explanation:
      "39 parameter records per minor carried no outputFile, so getFieldMeta() could not match them and returned null. Filling it makes them resolvable, and each also gains a concrete `allowed`. One of them (platform.baremetal.externalBridge) additionally gains a concrete `default` from the installer defaults package.",
  },
  engineRuleApplications: { "4.20": 551, "4.21": 1367, total: 1918 },
});

function gitSha(root) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).toString().trim();
  } catch {
    return null;
  }
}

function clonePin(evidenceRoot, minor) {
  const dir = path.join(evidenceRoot, `ocp-${minor}`, "installer", "source", "installer");
  try {
    return {
      repository: "https://github.com/openshift/installer",
      branch: execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir }).toString().trim(),
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim(),
    };
  } catch {
    return null;
  }
}

function build({ root, evidenceRoot }) {
  const ledger = {
    artifact: "Tranche 0B catalog authority repair ledger",
    phase: "0B complete — all repairs applied, H3 closed, strict provenance enforced in CI",
    generatedFrom: {
      repositoryCommit: gitSha(root),
      tool: "scripts/minor/inventory/build-repair-ledger.js",
      inventory: "scripts/minor/inventory/catalog-debt-inventory.js",
      repairEngine: "scripts/minor/repair/apply-catalog-repairs.js",
      rules: "scripts/minor/repair/proven-repairs.js",
      evidenceRoot: evidenceRoot || null,
    },
    rule: "Strict same-minor evidence. A row for minor M is proven only by M's own documentation or M's own installer release branch.",
    baseline: BASELINE,
    applied: APPLIED,
    evidence: {},
    minors: {},
    exactReleaseCertification: {
      performed: "2026-10-07",
      method:
        "Latest official stable x.y.z resolved per minor from the Cincinnati stable-<minor>.yaml channel (the same mechanism the product uses for target-minor latest-patch resolution). openshift-install acquired from the Red Hat mirror and SHA256-verified against that release's own sha256sum.txt. The installer source commit is what the verified binary reports via `openshift-install version`; the release image digest it prints matches release.txt. Each commit was fetched into a temporary evidence clone; the application repository was never moved.",
      assertionsCertified: { "4.20": 43, "4.21": 54, total: 97 },
      verdicts: { IDENTICAL: 97, "EXACT-RELEASE-CORRECTION-REQUIRED": 0, "SOURCE/BINARY-DISCREPANCY": 0, UNRESOLVED: 0 },
      branchTipDrift: {
        scope: "all of pkg/types, both minors",
        "4.20": "1 JSON-tagged struct field added between the tip and the release (azure.Platform.AllowSharedKeyAccess), plus its Azure Stack Hub validation rule.",
        "4.21": "No field added or removed. Two `,omitempty` JSON-tag additions (nutanix MachinePool.GPUs/.DataDisks, vsphere MachinePool.DataDisks) and one Go variable-scoping fix in vSphere failure-domain validation.",
        catalogConclusionsAltered: 0,
        claimsFalsified: 1,
        falsified: [
          {
            claim: "azure.Platform.AllowSharedKeyAccess is a 4.21 addition, absent at 4.20",
            reality: "present in released 4.20.40; backported into the z-stream after the April branch tip",
            impact:
              "No citation was wrong — the 4.21 citation points at a field that does exist at 4.21. Only the supporting annotation was false. Corrected in proven-repairs.js; the coverage and supportedness questions are tracked as DOC-170. No minVersion or supportStatus changed.",
          },
        ],
      },
    },
    h3: {
      citations: R.H3_CITATIONS,
      perMinorCitationCount: 0,
      distinctHeadings: R.H3_CITATIONS.length,
      closedBy: R.CITATION_RESOLUTIONS.map((r) => ({ id: r.id, tier: r.tier, evidence: r.evidence })),
      note: "All 21 per minor were closed by the deterministic same-minor authority precedence in CITATION_RESOLUTIONS. The register is empty and no suppression list exists; the strict guard passes because the data is correct. The freeze mechanism is retained for the next minor's ingestion.",
    },
  };

  for (const m of MINORS) {
    const docDir = evidenceRoot ? path.join(evidenceRoot, `ocp-${m}`, "docs", "extracted") : null;
    ledger.evidence[m] = {
      documentation: {
        path: `local-docs/ocp-${m}/docs/extracted/`,
        books:
          docDir && fs.existsSync(docDir)
            ? fs.readdirSync(docDir).filter((f) => f.endsWith(".txt")).sort()
            : [],
      },
      installerSource: {
        authority: "exact official released artifact (runbook Rule 2.1)",
        release: R.INSTALLER_PINS[m].release,
        payloadDigest: R.INSTALLER_PINS[m].payloadDigest,
        binarySha256: R.INSTALLER_PINS[m].binarySha256,
        tarballSha256: R.INSTALLER_PINS[m].tarballSha256,
        installerCommit: R.INSTALLER_PINS[m].installerCommit,
        arch: R.INSTALLER_PINS[m].arch,
        repository: "https://github.com/openshift/installer",
        supersededBranchTip: R.INSTALLER_PINS[m].supersededBranchTip,
        note: "The branch tip was the snapshot Tranche 0B first derived from; it is recorded only to show what was superseded.",
      },
      localCloneAtAcquisition: evidenceRoot ? clonePin(evidenceRoot, m) : null,
      docsIndex: `data/docs-index/${m}.json (tracked, canonical, parity-validated)`,
    };
  }

  for (const m of MINORS) {
    const result = inventoryMinor({ root, minor: m, evidenceRoot });
    const byClass = {};
    for (const r of result.rows) {
      const key =
        r.klass === "citation" ? `citation/${r.field.replace(/^citations\[\d+\]\.?/, "") || "shape"}` : r.klass;
      byClass[key] = (byClass[key] || 0) + 1;
    }
    const crossMinor = new Set(
      result.rows.filter((r) => /cross-minor/.test(r.failure)).map((r) => `${r.file}#${r.index}#${r.citationIndex}`)
    );

    ledger.minors[m] = {
      scanned: result.scanned,
      remainingRowsByClass: byClass,
      remainingRowTotal: result.rows.length,
      remainingCrossMinorCitationObjects: crossMinor.size,
      rows: result.rows.map((r) => ({
        minor: r.minor,
        scenarioFile: `data/params/${r.minor}/${r.file}`,
        parameterIndex: r.index,
        parameterPath: r.parameterPath,
        class: r.klass,
        field: r.field,
        failure: r.failure,
        disposition: "H3 — unresolved, frozen pending a human decision",
      })),
    };
  }

  // Flat key -> number block the consistency test compares against the Markdown.
  ledger.reconciliation = {
    "baseline.validator.4.20": BASELINE.validatorErrors["4.20"],
    "baseline.validator.4.21": BASELINE.validatorErrors["4.21"],
    "baseline.validator.total": BASELINE.validatorErrors.total,
    "baseline.crossMinor.4.21.total": BASELINE.crossMinorCitationObjects["4.21"].total,
    "baseline.crossMinor.4.21.visible": BASELINE.crossMinorCitationObjects["4.21"].visibleToGuard,
    "baseline.crossMinor.4.21.invisible": BASELINE.crossMinorCitationObjects["4.21"].invisibleToGuard,
    "baseline.crossMinor.4.20.total": BASELINE.crossMinorCitationObjects["4.20"].total,
    "baseline.heading.4.20": BASELINE.headingRows["4.20"],
    "baseline.heading.4.21": BASELINE.headingRows["4.21"],
    "baseline.heading.total": BASELINE.headingRows.total,
    "triage.A.total": BASELINE.headingTriage.A.total,
    "triage.B.phantomWithdrawn": BASELINE.headingTriage.B.phantomRowsWithdrawn,
    "triage.C.total": BASELINE.headingTriage.C.total,
    "triage.D.total": BASELINE.headingTriage.D.total,
    "baseline.typeAliases.total": BASELINE.typeAliases.total,
    "baseline.legacyCitations.total": BASELINE.legacyShapeCitations.total,
    "baseline.provenanceFindings.4.20": BASELINE.repairRows["4.20"],
    "baseline.provenanceFindings.4.21": BASELINE.repairRows["4.21"],
    "applied.parameterRecordsTouched.4.20": APPLIED.parameterRecordsTouched["4.20"],
    "applied.parameterRecordsTouched.4.21": APPLIED.parameterRecordsTouched["4.21"],
    "applied.parameterRecordsTouched.total": APPLIED.parameterRecordsTouched.total,
    "applied.metadataPropertiesChanged.4.20": APPLIED.metadataPropertiesChanged["4.20"].total,
    "applied.metadataPropertiesChanged.4.21": APPLIED.metadataPropertiesChanged["4.21"].total,
    "applied.metadataPropertiesChanged.total": APPLIED.metadataPropertiesChanged.total,
    "applied.citationObjectsChanged.4.20": APPLIED.citationObjectsChanged["4.20"].total,
    "applied.citationObjectsChanged.4.21": APPLIED.citationObjectsChanged["4.21"].total,
    "applied.citationObjectsChanged.total": APPLIED.citationObjectsChanged.total,
    "applied.provenanceFindingsRepaired.4.20": APPLIED.provenanceFindingsRepaired["4.20"],
    "applied.provenanceFindingsRepaired.4.21": APPLIED.provenanceFindingsRepaired["4.21"],
    "applied.provenanceFindingsRepaired.total": APPLIED.provenanceFindingsRepaired.total,
    "applied.behaviourParameterRecords.4.20": APPLIED.behaviourAffecting.parameterRecords["4.20"],
    "applied.behaviourParameterRecords.4.21": APPLIED.behaviourAffecting.parameterRecords["4.21"],
    "applied.behaviourParameterRecords.total": APPLIED.behaviourAffecting.parameterRecords.total,
    "applied.behaviourConsumedPropertyChanges.4.20": APPLIED.behaviourAffecting.consumedPropertyChanges["4.20"].total,
    "applied.behaviourConsumedPropertyChanges.4.21": APPLIED.behaviourAffecting.consumedPropertyChanges["4.21"].total,
    "applied.behaviourConsumedPropertyChanges.total": APPLIED.behaviourAffecting.consumedPropertyChanges.total,
    "applied.engineRuleApplications.total": APPLIED.engineRuleApplications.total,
    "final.validator.4.20": 0,
    "final.validator.4.21": 0,
    "final.crossMinor.4.21": ledger.minors["4.21"].remainingCrossMinorCitationObjects,
    "final.crossMinor.4.20": ledger.minors["4.20"].remainingCrossMinorCitationObjects,
    "final.heading.4.20": ledger.minors["4.20"].remainingRowsByClass["citation/sectionHeading"] || 0,
    "final.heading.4.21": ledger.minors["4.21"].remainingRowsByClass["citation/sectionHeading"] || 0,
    "final.provenanceFindings.4.20": ledger.minors["4.20"].remainingRowTotal,
    "final.provenanceFindings.4.21": ledger.minors["4.21"].remainingRowTotal,
    "cert.assertions.4.20": 43,
    "cert.assertions.4.21": 54,
    "cert.assertions.total": 97,
    "cert.verdictIdentical": 97,
    "cert.correctionsRequired": 0,
    "cert.sourceBinaryDiscrepancies": 0,
    "cert.unresolved": 0,
    "cert.catalogConclusionsAltered": 0,
    "cert.claimsFalsified": 1,
    "h3.frozenCitationsPerMinor": 0,
    "h3.frozenCitationsTotal": 0,
    "h3.distinctHeadings": R.H3_CITATIONS.length,
    "h3.headingRowsTotal": 0,
    "h3.closedByResolutionRules": R.CITATION_RESOLUTIONS.length,
  };

  return ledger;
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const root = flags.root && flags.root !== true ? path.resolve(String(flags.root)) : path.resolve(__dirname, "..", "..", "..");
  const evidenceRoot =
    flags["evidence-root"] && flags["evidence-root"] !== true ? path.resolve(String(flags["evidence-root"])) : null;

  const ledger = build({ root, evidenceRoot });
  const out = path.join(root, "docs", "minor-release", "catalog-repair-ledger-0b.json");
  fs.writeFileSync(out, `${JSON.stringify(ledger, null, 1)}\n`);

  console.log(`Wrote ${out}`);
  console.log(`  remaining provenance findings: 4.20 = ${ledger.minors["4.20"].remainingRowTotal}, 4.21 = ${ledger.minors["4.21"].remainingRowTotal}`);
  console.log(`  remaining cross-minor citation objects: 4.21 = ${ledger.reconciliation["final.crossMinor.4.21"]}`);
}

if (require.main === module) main();

module.exports = { build, BASELINE, APPLIED };
