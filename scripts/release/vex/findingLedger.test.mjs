/**
 * Deterministic tests for the finding ledger model.
 *
 * FIXTURES ONLY. No network, no container engine, no images, no scanner. Every
 * input below is a literal in this file, so a failure here always means the
 * model changed and never that the world did.
 *
 * The tests are organised around the failure modes the module exists to
 * prevent, not around its function list: an unevidenced "not applicable", an
 * auto-dispositioned unknown, a fix-available row with nothing to move to, and
 * a grouped finding whose CVE count silently collapses to one.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  CONFIDENCE,
  COMPONENT,
  DISPOSITION,
  DISPOSITIONS,
  EVIDENCE_SOURCE,
  FindingLedger,
  STATUS,
  STATUSES,
  dispositionFor,
  isVendorEvidence,
  makeEvidence,
  makeFinding,
  makeRemediation,
} from "./findingLedger.mjs";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const vexEvidence = () =>
  makeEvidence({
    source: EVIDENCE_SOURCE.CSAF_VEX,
    ref: "https://security.access.redhat.com/data/csaf/v2/vex/2026/cve-2026-00001.json",
    justification: "vulnerable_code_not_present",
    confidence: CONFIDENCE.VENDOR_ASSERTED,
    summary: "Vendor places the component in known_not_affected.",
  });

const localExecEvidence = () =>
  makeEvidence({
    source: EVIDENCE_SOURCE.LOCAL_EXECUTION,
    ref: "ss -ltn inside the shipping image",
    confidence: CONFIDENCE.VERIFIED_BY_EXECUTION,
    summary: "Observed a loopback-only listener.",
  });

const baseFinding = (overrides = {}) =>
  makeFinding({
    id: "FIX-1",
    cveIds: ["CVE-2026-00001"],
    packageName: "example",
    installedVersion: "1.0.0",
    component: COMPONENT.BACKEND_IMAGE_OS_PKG,
    severity: "HIGH",
    scannerSource: "trivy-fixture",
    status: STATUS.VENDOR_FIX_PENDING,
    ...overrides,
  });

// ---------------------------------------------------------------------------

describe("vocabularies", () => {
  test("statuses are exactly the agreed six", () => {
    assert.deepEqual([...STATUSES].sort(), [
      "configuration-mitigated-with-evidence",
      "confirmed-applicable-unresolved",
      "fix-available-now",
      "not-applicable-with-evidence",
      "unknown-applicability",
      "vendor-fix-pending",
    ]);
  });

  test("dispositions are exactly three and include no implicit pass", () => {
    assert.deepEqual([...DISPOSITIONS].sort(), ["blocks-release", "non-blocking-with-evidence", "requires-human-decision"]);
  });

  test("scanner and local sources do not count as vendor corroboration", () => {
    assert.equal(isVendorEvidence({ source: EVIDENCE_SOURCE.SCANNER }), false);
    assert.equal(isVendorEvidence({ source: EVIDENCE_SOURCE.LOCAL_EXECUTION }), false);
    assert.equal(isVendorEvidence({ source: EVIDENCE_SOURCE.LOCAL_STATIC }), false);
    assert.equal(isVendorEvidence({ source: EVIDENCE_SOURCE.CSAF_VEX }), true);
    assert.equal(isVendorEvidence({ source: EVIDENCE_SOURCE.RHSA }), true);
    assert.equal(isVendorEvidence({ source: EVIDENCE_SOURCE.UPSTREAM }), true);
  });
});

describe("evidence validation", () => {
  test("rejects an unknown source", () => {
    assert.throws(
      () => makeEvidence({ source: "a-blog-post", ref: "x", summary: "y", confidence: CONFIDENCE.INFERRED }),
      /unknown evidence source/,
    );
  });

  test("rejects evidence with no retrievable ref", () => {
    assert.throws(
      () => makeEvidence({ source: EVIDENCE_SOURCE.RHSA, ref: "   ", summary: "y", confidence: CONFIDENCE.VENDOR_ASSERTED }),
      /retrievable ref/,
    );
  });

  test("rejects evidence with no summary of what it shows", () => {
    assert.throws(
      () => makeEvidence({ source: EVIDENCE_SOURCE.RHSA, ref: "RHSA-1", summary: "", confidence: CONFIDENCE.VENDOR_ASSERTED }),
      /summary of what it actually shows/,
    );
  });

  test("CSAF VEX evidence must carry the vendor justification string verbatim", () => {
    assert.throws(
      () =>
        makeEvidence({
          source: EVIDENCE_SOURCE.CSAF_VEX,
          ref: "vex.json",
          summary: "vendor says not affected",
          confidence: CONFIDENCE.VENDOR_ASSERTED,
        }),
      /must record the vendor justification string/,
    );
    assert.equal(vexEvidence().justification, "vulnerable_code_not_present");
  });

  test("local-execution evidence cannot be labelled anything but verified-by-execution", () => {
    assert.throws(
      () =>
        makeEvidence({
          source: EVIDENCE_SOURCE.LOCAL_EXECUTION,
          ref: "ss -ltn",
          summary: "saw a listener",
          confidence: CONFIDENCE.INFERRED,
        }),
      /must carry confidence "verified-by-execution"/,
    );
  });

  test("evidence records are frozen so a ledger cannot be edited after review", () => {
    const e = vexEvidence();
    assert.throws(() => {
      e.justification = "component_not_present";
    }, TypeError);
  });
});

describe("fail-closed: not-applicable requires vendor evidence", () => {
  test("rejects not-applicable backed only by local reasoning", () => {
    assert.throws(
      () =>
        baseFinding({
          status: STATUS.NOT_APPLICABLE_WITH_EVIDENCE,
          evidence: [
            makeEvidence({
              source: EVIDENCE_SOURCE.LOCAL_STATIC,
              ref: "nm binary",
              summary: "symbol absent",
              confidence: CONFIDENCE.INFERRED,
            }),
          ],
        }),
      /carries no vendor evidence with a justification/,
    );
  });

  test("rejects not-applicable with no evidence at all", () => {
    assert.throws(() => baseFinding({ status: STATUS.NOT_APPLICABLE_WITH_EVIDENCE }), /carries no vendor evidence/);
  });

  test("rejects vendor evidence whose justification is blank", () => {
    assert.throws(
      () =>
        baseFinding({
          status: STATUS.NOT_APPLICABLE_WITH_EVIDENCE,
          evidence: [
            makeEvidence({
              source: EVIDENCE_SOURCE.RHSA,
              ref: "RHSA-2026:1",
              summary: "an advisory exists",
              confidence: CONFIDENCE.VENDOR_ASSERTED,
            }),
          ],
        }),
      /carries no vendor evidence with a justification/,
    );
  });

  test("accepts not-applicable once a justified vendor record is present", () => {
    const f = baseFinding({ status: STATUS.NOT_APPLICABLE_WITH_EVIDENCE, evidence: [vexEvidence()] });
    assert.equal(f.status, STATUS.NOT_APPLICABLE_WITH_EVIDENCE);
    assert.equal(dispositionFor(f), DISPOSITION.NON_BLOCKING_WITH_EVIDENCE);
  });

  test("configuration-mitigated is held to the same bar", () => {
    assert.throws(
      () => baseFinding({ status: STATUS.CONFIGURATION_MITIGATED_WITH_EVIDENCE, evidence: [localExecEvidence()] }),
      /carries no vendor evidence/,
    );
  });

  test("an evidence object not built by makeEvidence is rejected", () => {
    assert.throws(
      () => baseFinding({ evidence: [{ source: "csaf-vex-ish", ref: "x" }] }),
      /did not come from makeEvidence/,
    );
  });

  test("a hand-rolled literal that mimics a VALID evidence record is still rejected", () => {
    // The bypass this closes. The guard used to check only that `source` was a
    // known value, so a literal wearing a real source passed — skipping every
    // makeEvidence() check and reaching non-blocking-with-evidence, the one
    // status that stops a finding blocking the release. Shape is not provenance.
    const forged = {
      source: EVIDENCE_SOURCE.CSAF_VEX,
      ref: "https://example.invalid/vex.json",
      summary: "looks exactly like the real thing",
      justification: "vulnerable_code_not_present",
      confidence: CONFIDENCE.VENDOR_ASSERTED,
      observedAt: "2026-10-14",
    };
    assert.throws(
      () => baseFinding({ status: STATUS.NOT_APPLICABLE_WITH_EVIDENCE, evidence: [forged] }),
      /did not come from makeEvidence/,
    );
  });

  test("a structural clone of a real record loses the brand and is rejected", () => {
    // JSON round-tripping is the realistic way this happens: load last run's
    // evidence from disk, feed it back in. The brand is a Symbol, so it does
    // not survive serialisation — deliberately. Re-validate, do not re-trust.
    const real = vexEvidence();
    const roundTripped = JSON.parse(JSON.stringify(real));
    // Compare string keys only: object spread copies enumerable Symbol keys
    // too, so `{...real}` would still carry the brand and prove nothing.
    assert.deepEqual(
      roundTripped,
      Object.fromEntries(Object.entries(real)),
      "round-trip must preserve every enumerable string-keyed field",
    );
    assert.throws(
      () => baseFinding({ status: STATUS.NOT_APPLICABLE_WITH_EVIDENCE, evidence: [roundTripped] }),
      /did not come from makeEvidence/,
    );
  });
});

describe("fail-closed: unknown is never auto-dispositioned", () => {
  test("unknown-applicability always routes to a human", () => {
    const f = baseFinding({ status: STATUS.UNKNOWN_APPLICABILITY });
    assert.equal(dispositionFor(f), DISPOSITION.REQUIRES_HUMAN_DECISION);
  });

  test("piling on strong local evidence does not make unknown non-blocking", () => {
    const f = baseFinding({ status: STATUS.UNKNOWN_APPLICABILITY, evidence: [localExecEvidence(), localExecEvidence()] });
    assert.equal(dispositionFor(f), DISPOSITION.REQUIRES_HUMAN_DECISION);
  });

  test("unknown carrying a vendor statement must explain why the vendor is not decisive", () => {
    assert.throws(
      () => baseFinding({ status: STATUS.UNKNOWN_APPLICABILITY, evidence: [vexEvidence()] }),
      /record a note explaining why the vendor statement is not decisive/,
    );
    const ok = baseFinding({
      status: STATUS.UNKNOWN_APPLICABILITY,
      evidence: [vexEvidence()],
      notes: "The VEX covers the plugin image, not the standalone tarball we ship.",
    });
    assert.equal(dispositionFor(ok), DISPOSITION.REQUIRES_HUMAN_DECISION);
  });

  test("dispositionFor refuses anything that is not a validated finding", () => {
    assert.throws(() => dispositionFor(null), /requires a validated finding/);
    assert.throws(() => dispositionFor({ status: "probably-fine" }), /requires a validated finding/);
  });
});

describe("fail-closed: fix-available-now needs something to move to", () => {
  test("rejects fix-available-now with no fixed version", () => {
    assert.throws(
      () => baseFinding({ status: STATUS.FIX_AVAILABLE_NOW, remediation: makeRemediation({ action: "rebuild" }) }),
      /names no fixed version/,
    );
  });

  test("rejects fix-available-now with no remediation at all", () => {
    assert.throws(() => baseFinding({ status: STATUS.FIX_AVAILABLE_NOW }), /names no fixed version/);
  });

  test("an available but unadopted fix blocks the release", () => {
    const f = baseFinding({
      status: STATUS.FIX_AVAILABLE_NOW,
      remediation: makeRemediation({ action: "rebuild", fixedVersion: "1.0.1" }),
    });
    assert.equal(dispositionFor(f), DISPOSITION.BLOCKS_RELEASE);
  });

  test("remediation requires an action a person can carry out", () => {
    assert.throws(() => makeRemediation({ action: "" }), /action a person can carry out/);
  });
});

describe("finding field validation", () => {
  test("rejects a finding with no CVE ids", () => {
    assert.throws(() => baseFinding({ cveIds: [] }), /at least one CVE id/);
    assert.throws(() => baseFinding({ cveIds: undefined }), /at least one CVE id/);
  });

  for (const [field, matcher] of [
    ["id", /needs a stable id/],
    ["packageName", /needs a package name/],
    ["installedVersion", /needs the installed version/],
    ["severity", /needs a severity/],
    ["scannerSource", /needs a scanner source/],
  ]) {
    test(`rejects a finding with no ${field}`, () => {
      assert.throws(() => baseFinding({ [field]: "" }), matcher);
    });
  }

  test("rejects an unknown component and an unknown status", () => {
    assert.throws(() => baseFinding({ component: "somewhere" }), /unknown component/);
    assert.throws(() => baseFinding({ status: "mostly-ok" }), /unknown status/);
  });

  test("findings are frozen", () => {
    const f = baseFinding();
    assert.throws(() => {
      f.status = STATUS.NOT_APPLICABLE_WITH_EVIDENCE;
    }, TypeError);
  });
});

describe("disposition rules", () => {
  test("every status maps to a disposition, and only two can be non-blocking", () => {
    const nonBlocking = STATUSES.filter((s) => {
      const evidence = s === STATUS.NOT_APPLICABLE_WITH_EVIDENCE || s === STATUS.CONFIGURATION_MITIGATED_WITH_EVIDENCE ? [vexEvidence()] : [];
      const remediation = s === STATUS.FIX_AVAILABLE_NOW ? makeRemediation({ action: "rebuild", fixedVersion: "2" }) : null;
      const notes = s === STATUS.UNKNOWN_APPLICABILITY ? "n/a" : null;
      const f = baseFinding({ status: s, evidence, remediation, notes });
      return dispositionFor(f) === DISPOSITION.NON_BLOCKING_WITH_EVIDENCE;
    });
    assert.deepEqual(nonBlocking.sort(), ["configuration-mitigated-with-evidence", "not-applicable-with-evidence"]);
  });

  test("vendor-fix-pending goes to a human rather than silently blocking or passing", () => {
    assert.equal(dispositionFor(baseFinding({ status: STATUS.VENDOR_FIX_PENDING })), DISPOSITION.REQUIRES_HUMAN_DECISION);
  });

  test("confirmed-applicable-unresolved blocks", () => {
    assert.equal(
      dispositionFor(baseFinding({ status: STATUS.CONFIRMED_APPLICABLE_UNRESOLVED })),
      DISPOSITION.BLOCKS_RELEASE,
    );
  });
});

describe("FindingLedger", () => {
  const ledger = () =>
    new FindingLedger([
      baseFinding({ id: "A", status: STATUS.NOT_APPLICABLE_WITH_EVIDENCE, evidence: [vexEvidence()] }),
      baseFinding({
        id: "B",
        cveIds: ["CVE-2026-1", "CVE-2026-2", "CVE-2026-3"],
        status: STATUS.FIX_AVAILABLE_NOW,
        remediation: makeRemediation({ action: "rebuild", fixedVersion: "9" }),
      }),
      baseFinding({ id: "C", cveIds: ["CVE-2026-4", "CVE-2026-5"], status: STATUS.UNKNOWN_APPLICABILITY }),
    ]);

  test("rejects anything that is not a validated finding", () => {
    assert.throws(() => new FindingLedger([{ id: "X", status: "fine" }]), /requires a finding built by makeFinding/);
  });

  test("rejects duplicate finding ids", () => {
    assert.throws(() => new FindingLedger([baseFinding({ id: "A" }), baseFinding({ id: "A" })]), /duplicate finding id/);
  });

  test("counts by status and by disposition", () => {
    const l = ledger();
    assert.equal(l.countsByStatus()[STATUS.NOT_APPLICABLE_WITH_EVIDENCE], 1);
    assert.equal(l.countsByStatus()[STATUS.FIX_AVAILABLE_NOW], 1);
    assert.equal(l.countsByStatus()[STATUS.UNKNOWN_APPLICABILITY], 1);
    assert.deepEqual(l.countsByDisposition(), {
      [DISPOSITION.NON_BLOCKING_WITH_EVIDENCE]: 1,
      [DISPOSITION.BLOCKS_RELEASE]: 1,
      [DISPOSITION.REQUIRES_HUMAN_DECISION]: 1,
    });
  });

  test("fix availability is counted in CVEs, so a grouped row cannot read as one", () => {
    // B groups three CVEs and has a fix; A (1) and C (2) have none.
    assert.deepEqual(ledger().fixAvailability(), {
      cvesWithFixAvailable: 3,
      cvesWithNoFixAvailable: 3,
      total: 6,
    });
  });

  test("cveTotal deduplicates across findings", () => {
    const l = new FindingLedger([
      baseFinding({ id: "A", cveIds: ["CVE-1", "CVE-2"] }),
      baseFinding({ id: "B", cveIds: ["CVE-2", "CVE-3"] }),
    ]);
    assert.equal(l.cveTotal(), 3);
  });

  test("humanDecisions surfaces blockers and unknowns, never the evidenced rows", () => {
    const ids = ledger()
      .humanDecisions()
      .map((d) => d.id)
      .sort();
    assert.deepEqual(ids, ["B", "C"]);
  });

  test("a finding with no decision text still surfaces, with the gap stated", () => {
    const [d] = new FindingLedger([baseFinding({ id: "C", status: STATUS.UNKNOWN_APPLICABILITY })]).humanDecisions();
    assert.match(d.question, /a human must state the question/);
  });

  test("isFullyDispositioned is only true when nothing is outstanding", () => {
    assert.equal(ledger().isFullyDispositioned(), false);
    const clean = new FindingLedger([baseFinding({ id: "A", status: STATUS.NOT_APPLICABLE_WITH_EVIDENCE, evidence: [vexEvidence()] })]);
    assert.equal(clean.isFullyDispositioned(), true);
  });

  test("toJSON is a complete, serialisable record", () => {
    const json = JSON.parse(JSON.stringify(ledger().toJSON()));
    assert.equal(json.findingCount, 3);
    assert.equal(json.cveTotal, 6);
    assert.equal(json.fullyDispositioned, false);
    assert.equal(json.findings.length, 3);
    for (const f of json.findings) assert.ok(DISPOSITIONS.includes(f.disposition));
  });
});
