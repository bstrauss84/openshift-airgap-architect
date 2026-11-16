"use strict";

/**
 * Ledger consistency.
 *
 * docs/minor-release/CATALOG_REPAIR_LEDGER_0B.md is the document a reviewer
 * reads; catalog-repair-ledger-0b.json is what tooling reads. A number that
 * appears in one and not the other, or in both with different values, makes
 * the pair untrustworthy — and a ledger nobody can trust is worse than no
 * ledger, because it is quoted.
 *
 * This test holds them to each other and checks the arithmetic identities the
 * Markdown claims. Both artifacts are tracked, so the test is hermetic: it
 * reads no local documentation evidence and touches no catalogs.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const DOCS = path.join(__dirname, "..", "..", "..", "docs", "minor-release");
const MD_PATH = path.join(DOCS, "CATALOG_REPAIR_LEDGER_0B.md");
const JSON_PATH = path.join(DOCS, "catalog-repair-ledger-0b.json");

const markdown = fs.readFileSync(MD_PATH, "utf-8");
const ledger = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));

/** Parse the `| key | value |` rows of the Reconciliation section. */
function parseReconciliationTable(text) {
  const start = text.indexOf("## 11. Reconciliation (machine-checked)");
  assert.notStrictEqual(start, -1, "the Markdown must carry a Reconciliation section");
  const section = text.slice(start, text.indexOf("\n## ", start + 10));
  const out = {};
  for (const line of section.split("\n")) {
    const m = line.match(/^\|\s*([a-zA-Z0-9.]+)\s*\|\s*(\d+)\s*\|$/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

const fromMarkdown = parseReconciliationTable(markdown);
const fromJson = ledger.reconciliation;

describe("repair ledger: Markdown and JSON agree", () => {
  test("the Markdown reconciliation table is not empty", () => {
    assert.ok(Object.keys(fromMarkdown).length >= 20, "expected the full reconciliation table");
  });

  test("the JSON carries a reconciliation block", () => {
    assert.ok(fromJson && typeof fromJson === "object");
  });

  test("every key in the Markdown exists in the JSON with the same value", () => {
    const mismatches = [];
    for (const [k, v] of Object.entries(fromMarkdown)) {
      if (!(k in fromJson)) mismatches.push(`${k}: missing from JSON`);
      else if (fromJson[k] !== v) mismatches.push(`${k}: md=${v} json=${fromJson[k]}`);
    }
    assert.deepStrictEqual(mismatches, []);
  });

  test("every key in the JSON appears in the Markdown", () => {
    const missing = Object.keys(fromJson).filter((k) => !(k in fromMarkdown));
    assert.deepStrictEqual(missing, [], "the document must not omit a number the tooling publishes");
  });
});

describe("repair ledger: arithmetic reconciles", () => {
  const v = (k) => {
    assert.ok(k in fromJson, `reconciliation is missing ${k}`);
    return fromJson[k];
  };

  test("baseline validator errors sum to the accepted total", () => {
    assert.strictEqual(v("baseline.validator.4.20") + v("baseline.validator.4.21"), v("baseline.validator.total"));
  });

  test("baseline heading rows sum to the heading total", () => {
    assert.strictEqual(v("baseline.heading.4.20") + v("baseline.heading.4.21"), v("baseline.heading.total"));
  });

  test("triage A + D accounts for every heading row", () => {
    // B is withdrawn phantom rows and C is counted separately by
    // construction: class-C citations address no book, so the corrected
    // checker reports them `unknown` rather than as heading debt (§3.2.1).
    assert.strictEqual(
      v("triage.A.total") + v("triage.D.total"),
      v("baseline.heading.total"),
      "every heading row must be classified A or D"
    );
  });

  test("guard-visible plus guard-invisible equals the real cross-minor debt", () => {
    assert.strictEqual(
      v("baseline.crossMinor.4.21.visible") + v("baseline.crossMinor.4.21.invisible"),
      v("baseline.crossMinor.4.21.total"),
      "810 + 129 = 939; the guard saw only the first term"
    );
  });

  test("the heading findings that remain are exactly the frozen set", () => {
    assert.strictEqual(v("final.heading.4.20") + v("final.heading.4.21"), v("h3.headingRowsTotal"));
  });

  test("an empty freeze register means nothing is left frozen", () => {
    const registerEmpty = v("h3.distinctHeadings") === 0;
    if (registerEmpty) {
      assert.strictEqual(v("h3.frozenCitationsPerMinor"), 0);
      assert.strictEqual(v("h3.frozenCitationsTotal"), 0);
      assert.strictEqual(v("h3.headingRowsTotal"), 0);
    } else {
      assert.ok(v("h3.frozenCitationsPerMinor") > 0, "a non-empty register must freeze something");
    }
  });

  test("frozen citation counts stay consistent across minors", () => {
    assert.strictEqual(v("h3.frozenCitationsPerMinor") * 2, v("h3.frozenCitationsTotal"));
  });

  test("baseline-unresolved rows were closed by rules, not by suppression", () => {
    const closedCount = v("triage.D.total") - v("h3.headingRowsTotal");
    if (closedCount > 0) {
      assert.ok(
        v("h3.closedByResolutionRules") > 0,
        "rows left the unresolved set, so resolution rules must account for them"
      );
      assert.ok(Array.isArray(ledger.h3.closedBy) && ledger.h3.closedBy.length > 0);
      for (const r of ledger.h3.closedBy) {
        assert.ok(r.id, "each closure rule needs an id");
        assert.ok(r.tier >= 1 && r.tier <= 4, `${r.id}: needs an authority tier`);
        assert.ok(r.evidence && r.evidence.length > 60, `${r.id}: needs substantive evidence`);
      }
    }
  });

  test("every provenance finding is cleared", () => {
    assert.strictEqual(v("final.provenanceFindings.4.20"), 0);
    assert.strictEqual(v("final.provenanceFindings.4.21"), 0);
  });

  test("exact-release certification reconciles", () => {
    assert.strictEqual(
      v("cert.assertions.4.20") + v("cert.assertions.4.21"),
      v("cert.assertions.total")
    );
    assert.strictEqual(
      v("cert.verdictIdentical"),
      v("cert.assertions.total"),
      "every installer assertion must certify against the exact released artifact"
    );
    for (const k of ["cert.correctionsRequired", "cert.sourceBinaryDiscrepancies", "cert.unresolved"]) {
      assert.strictEqual(v(k), 0, `${k} must be zero for 0B to be certified`);
    }
    assert.strictEqual(
      v("cert.catalogConclusionsAltered"),
      0,
      "branch-tip usage altered no catalog conclusion"
    );
  });

  test("a falsified claim is recorded with its correction, not quietly dropped", () => {
    const n = v("cert.claimsFalsified");
    const falsified = ledger.exactReleaseCertification.branchTipDrift.falsified;
    assert.strictEqual(Array.isArray(falsified) ? falsified.length : 0, n);
    for (const f of falsified) {
      assert.ok(f.claim && f.reality && f.impact, "each falsified claim needs claim, reality and impact");
    }
  });

  test("installer provenance is an exact release, never a branch tip", () => {
    for (const m of ["4.20", "4.21"]) {
      const src = ledger.evidence[m].installerSource;
      assert.match(String(src.release), new RegExp(`^${m.replace(".", "\\.")}\\.\\d+$`));
      assert.match(String(src.installerCommit), /^[0-9a-f]{40}$/);
      assert.match(String(src.payloadDigest), /^sha256:[0-9a-f]{64}$/);
      assert.match(String(src.binarySha256), /^[0-9a-f]{64}$/);
      assert.notStrictEqual(src.installerCommit, src.supersededBranchTip);
    }
  });

  test("no final measure exceeds its baseline", () => {
    const pairs = [
      ["final.validator.4.20", "baseline.validator.4.20"],
      ["final.validator.4.21", "baseline.validator.4.21"],
      ["final.crossMinor.4.21", "baseline.crossMinor.4.21.total"],
      ["final.crossMinor.4.20", "baseline.crossMinor.4.20.total"],
      ["final.heading.4.20", "baseline.heading.4.20"],
      ["final.heading.4.21", "baseline.heading.4.21"],
    ];
    for (const [fin, base] of pairs) {
      assert.ok(v(fin) <= v(base), `${fin} (${v(fin)}) must not exceed ${base} (${v(base)})`);
    }
  });

  test("both validators are clean", () => {
    assert.strictEqual(v("final.validator.4.20"), 0);
    assert.strictEqual(v("final.validator.4.21"), 0);
  });

  test("4.20 carries no cross-minor provenance, before or after", () => {
    assert.strictEqual(v("baseline.crossMinor.4.20.total"), 0);
    assert.strictEqual(v("final.crossMinor.4.20"), 0);
  });
});

describe("repair ledger: counts name their unit and cannot be confused", () => {
  const v = (k) => fromJson[k];

  /**
   * Five units were being reported interchangeably, which is how
   * "1,814 rows repaired" and "39 parameters x 2 minors" ended up describing
   * the same pass. Every applied.* key must say what it counts.
   */
  const UNITS = [
    "parameterRecordsTouched",
    "metadataPropertiesChanged",
    "citationObjectsChanged",
    "provenanceFindingsRepaired",
    "behaviourParameterRecords",
    "behaviourConsumedPropertyChanges",
    "engineRuleApplications",
  ];

  test("every applied.* key carries a recognised unit name", () => {
    const bad = Object.keys(fromJson)
      .filter((k) => k.startsWith("applied."))
      .filter((k) => !UNITS.some((u) => k.includes(u)));
    assert.deepStrictEqual(bad, [], "an applied count must name its unit");
  });

  test("all five reporting units are published", () => {
    for (const u of UNITS) {
      assert.ok(
        Object.keys(fromJson).some((k) => k.includes(u)),
        `${u} must appear in the reconciliation`
      );
    }
  });

  test("no key calls a property or citation count a 'row'", () => {
    // "row" is permitted only where it genuinely counts inventory finding
    // rows, which is what the inventory emits.
    const legitimate = /headingRowsTotal/;
    const offenders = Object.keys(fromJson).filter((k) => /row/i.test(k) && !legitimate.test(k));
    assert.deepStrictEqual(
      offenders,
      [],
      "'row' is reserved for the inventory's own finding rows; property and citation counts must not borrow it"
    );
  });

  test("per-minor applied counts sum to their totals", () => {
    for (const u of [
      "parameterRecordsTouched",
      "metadataPropertiesChanged",
      "citationObjectsChanged",
      "provenanceFindingsRepaired",
      "behaviourParameterRecords",
      "behaviourConsumedPropertyChanges",
    ]) {
      assert.strictEqual(
        v(`applied.${u}.4.20`) + v(`applied.${u}.4.21`),
        v(`applied.${u}.total`),
        `applied.${u} must sum`
      );
    }
  });

  test("provenance findings repaired equals baseline minus what remains", () => {
    for (const m of ["4.20", "4.21"]) {
      assert.strictEqual(
        v(`applied.provenanceFindingsRepaired.${m}`),
        v(`baseline.provenanceFindings.${m}`) - ledger.minors[m].remainingRowTotal,
        `${m}: repaired + remaining must equal the baseline`
      );
    }
  });

  test("behaviour-affecting counts never exceed the totals they are drawn from", () => {
    for (const m of ["4.20", "4.21"]) {
      assert.ok(v(`applied.behaviourParameterRecords.${m}`) <= v(`applied.parameterRecordsTouched.${m}`));
      assert.ok(
        v(`applied.behaviourConsumedPropertyChanges.${m}`) <= v(`applied.metadataPropertiesChanged.${m}`)
      );
    }
  });

  test("the engine's rule-application count is not presented as a record count", () => {
    assert.ok(
      v("applied.engineRuleApplications.total") > v("applied.parameterRecordsTouched.total"),
      "the two differ; publishing only the larger one as 'records' was the original defect"
    );
    assert.match(markdown, /engine rule applications.*not\* a record count/is);
  });
});

describe("repair ledger: the H3 set is explicit and excluded from mutation", () => {
  test("the JSON enumerates the frozen citations", () => {
    assert.ok(Array.isArray(ledger.h3.citations));
    assert.strictEqual(ledger.h3.citations.length, fromJson["h3.distinctHeadings"]);
    for (const c of ledger.h3.citations) {
      assert.ok(c.docId, "an H3 entry needs a docId");
      assert.ok(c.sectionHeading, "an H3 entry needs a sectionHeading");
    }
  });

  test("the frozen set matches the repair engine's own rule table", () => {
    const { H3_CITATIONS } = require("../repair/proven-repairs.js");
    assert.deepStrictEqual(
      ledger.h3.citations.map((c) => `${c.docId}::${c.sectionHeading}`).sort(),
      H3_CITATIONS.map((c) => `${c.docId}::${c.sectionHeading}`).sort(),
      "the ledger and the engine must freeze exactly the same rows"
    );
  });

  test("every remaining row is dispositioned as H3", () => {
    for (const minor of ["4.20", "4.21"]) {
      for (const row of ledger.minors[minor].rows) {
        assert.match(row.disposition, /^H3 —/, `${minor} ${row.parameterPath} must be marked unresolved`);
      }
    }
  });

  test("remaining row counts match the per-minor row lists", () => {
    for (const minor of ["4.20", "4.21"]) {
      assert.strictEqual(ledger.minors[minor].rows.length, ledger.minors[minor].remainingRowTotal);
    }
  });

  test("no suppression structure is recorded anywhere in the ledger", () => {
    // Keys, not prose: the ledger legitimately *says* that no suppression list
    // exists, which a substring scan would flag.
    const banned = /^(suppress|suppressions|allowlist|whitelist|ignorelist|exceptions|waivers)$/i;
    const offenders = [];
    (function walk(node, trail) {
      if (!node || typeof node !== "object") return;
      for (const [k, val] of Object.entries(node)) {
        if (banned.test(k)) offenders.push([...trail, k].join("."));
        walk(val, [...trail, k]);
      }
    })(ledger, []);
    assert.deepStrictEqual(offenders, [], "an unresolved row is frozen and reported, never excused");
  });
});

describe("repair ledger: the Markdown does not carry superseded totals", () => {
  // Intermediate figures from the inventory passes that were later corrected.
  // They may be discussed as history, but must never appear as a current
  // total in the reconciliation table.
  const superseded = [83, 112, 568, 291, 277, 608, 1722];

  test("no superseded count survives as a reconciliation value", () => {
    const current = new Set(Object.values(fromMarkdown));
    const leaked = superseded.filter((n) => current.has(n));
    assert.deepStrictEqual(leaked, [], "a corrected intermediate count must not reappear as a current total");
  });

  test("the document states the phase and the 4.22 boundary", () => {
    assert.match(markdown, /H3 closed by deterministic/i);
    assert.match(markdown, /4\.22 acquisition has \*\*not\*\* begun/i);
  });
});
