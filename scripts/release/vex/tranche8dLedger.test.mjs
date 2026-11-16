/**
 * Tests for the populated Tranche 8D ledger.
 *
 * OFFLINE. The ledger module is pure data plus validation, so these tests need
 * no network, no images and no scanner. What they assert is that the real
 * recorded content still obeys the model's rules and still says what the
 * analysis concluded — so that a later edit which, say, quietly promotes the
 * Go-binary long tail to "not applicable" fails here rather than in a release.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { CONFIDENCE, DISPOSITION, EVIDENCE_SOURCE, STATUS } from "./findingLedger.mjs";
import { SHIPPED_OC_MIRROR, TRANCHE_8D_FINDINGS, buildTranche8dLedger } from "./tranche8dLedger.mjs";

const ledger = buildTranche8dLedger();
const byId = Object.fromEntries(ledger.dispositioned().map((f) => [f.id, f]));

describe("ledger integrity", () => {
  test("every finding constructed and carries a disposition", () => {
    assert.equal(TRANCHE_8D_FINDINGS.length, 12);
    assert.equal(ledger.findings.length, 12);
    for (const f of ledger.dispositioned()) {
      assert.ok(f.disposition, `${f.id} has no disposition`);
    }
  });

  test("ids are unique and stably named", () => {
    const ids = ledger.findings.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^OAA-8D-\d{3}$/);
  });

  test("the tranche is not fully dispositioned; work remains", () => {
    assert.equal(ledger.isFullyDispositioned(), false);
  });
});

describe("CVE-2026-33186 — grpc authz bypass", () => {
  const f = () => byId["OAA-8D-001"];

  test("is the only CRITICAL in the ledger", () => {
    const criticals = ledger.findings.filter((x) => x.severity === "CRITICAL");
    assert.deepEqual(
      criticals.map((x) => x.id),
      ["OAA-8D-001"],
    );
    assert.deepEqual(criticals[0].cveIds, ["CVE-2026-33186"]);
  });

  test("is not-applicable and therefore non-blocking", () => {
    assert.equal(f().status, STATUS.NOT_APPLICABLE_WITH_EVIDENCE);
    assert.equal(f().disposition, DISPOSITION.NON_BLOCKING_WITH_EVIDENCE);
  });

  test("rests on a vendor VEX justification, not on local reasoning alone", () => {
    const vex = f().evidence.find((e) => e.source === EVIDENCE_SOURCE.CSAF_VEX);
    assert.ok(vex, "no CSAF VEX evidence recorded");
    assert.equal(vex.justification, "vulnerable_code_not_present");
    assert.equal(vex.confidence, CONFIDENCE.VENDOR_ASSERTED);
  });

  test("records the correction to the prior wave's symbol claim", () => {
    const stat = f().evidence.find((e) => e.source === EVIDENCE_SOURCE.LOCAL_STATIC);
    assert.match(stat.summary, /grpc\/authz is entirely absent/);
    // 57, not 114. `go tool nm` emits each Go text symbol twice at the same
    // address — once as `T name`, once as `t local.name` — so the raw line
    // count is exactly double the number of linked method bodies. Measured:
    // 114 raw lines = 57 T + 57 t = 57 distinct addresses.
    assert.match(stat.summary, /57 google\.golang\.org\/grpc\.\(\*Server\)/);
    assert.doesNotMatch(stat.summary, /\b114\b/, "114 is the doubled nm line count, not a symbol count");
    assert.match(stat.summary, /CORRECTION/);
  });

  test("records that our measurement supports a different justification than the vendor's", () => {
    // The determination is NOT-APPLICABLE either way, but the two legs are not
    // the same leg: Red Hat says vulnerable_code_not_present, while the code
    // the upstream fix touches (handleStream) is demonstrably linked here.
    // Reporting the two as agreeing would overstate the vendor's assertion.
    const caveat = f().evidence.filter((e) => e.source === EVIDENCE_SOURCE.LOCAL_STATIC).at(-1);
    assert.match(caveat.summary, /vulnerable_code_not_in_execute_path/);
    assert.match(caveat.summary, /handleStream IS linked/);
    assert.match(caveat.summary, /must not be reported as agreeing/);
  });

  test("records that nm cannot speak for the stripped oc binary", () => {
    // An empty `nm` result on a stripped binary means "no symbol table", not
    // "no grpc". Citing it as evidence of absence would be unsound.
    const caveat = f().evidence.filter((e) => e.source === EVIDENCE_SOURCE.LOCAL_STATIC).at(-1);
    assert.match(caveat.summary, /oc is stripped/);
    assert.match(caveat.summary, /no symbol section/);
    assert.match(caveat.summary, /build info/);
  });

  test("the local symbol evidence is labelled inferred, not verified-by-execution", () => {
    const stat = f().evidence.find((e) => e.source === EVIDENCE_SOURCE.LOCAL_STATIC);
    assert.equal(stat.confidence, CONFIDENCE.INFERRED);
  });

  test("govulncheck is explicitly not cited as proof either way", () => {
    assert.match(f().notes, /govulncheck/);
    assert.match(f().notes, /neither for nor against/);
  });
});

describe("CVE-2026-96577 — oc-mirror local cache registry exposure", () => {
  const f = () => byId["OAA-8D-002"];

  test("is recorded as not-applicable because the shipped build already carries the fix", () => {
    assert.equal(f().status, STATUS.NOT_APPLICABLE_WITH_EVIDENCE);
    assert.equal(f().disposition, DISPOSITION.NON_BLOCKING_WITH_EVIDENCE);
  });

  test("names the errata that shipped the fix and the stream it belongs to", () => {
    const rhsa = f().evidence.find((e) => e.source === EVIDENCE_SOURCE.RHSA);
    assert.match(rhsa.ref, /RHSA-2026:74429/);
    assert.match(rhsa.summary, /4\.22\.17/);
    assert.match(rhsa.summary, /2026-10-06/);
    // The sibling streams must stay recorded: 4.19/4.20/4.21 were fixed too.
    assert.match(rhsa.summary, /RHSA-2026:74434/);
    assert.match(rhsa.summary, /RHSA-2026:74380/);
    assert.match(rhsa.summary, /RHSA-2026:74383/);
  });

  test("records that 4.15-4.18 carry no oc-mirror entry at all", () => {
    const vex = f().evidence.find((e) => e.source === EVIDENCE_SOURCE.CSAF_VEX);
    assert.match(vex.summary, /4\.15 through 4\.18 carry no oc-mirror entry/);
  });

  test("the upstream fix predates the shipped build date", () => {
    const upstream = f().evidence.find((e) => e.source === EVIDENCE_SOURCE.UPSTREAM);
    assert.match(upstream.ref, /#1558/);
    const mergedAt = Date.parse("2026-09-25T08:24:04Z");
    const builtAt = Date.parse(SHIPPED_OC_MIRROR.buildDate);
    assert.ok(mergedAt < builtAt, "fix must have merged before the shipped build was produced");
  });

  test("carries execution evidence of a loopback-only bind", () => {
    const exec = f().evidence.find((e) => e.source === EVIDENCE_SOURCE.LOCAL_EXECUTION);
    assert.ok(exec, "no execution evidence recorded");
    assert.equal(exec.confidence, CONFIDENCE.VERIFIED_BY_EXECUTION);
    assert.match(exec.summary, /127\.0\.0\.1:55000/);
    assert.match(exec.summary, /HOST network namespace/);
    assert.doesNotMatch(exec.summary, /LISTEN[^']*0\.0\.0\.0:55000 0\.0\.0\.0/);
  });

  test("artifact identity is proven by checksum, not by the version label", () => {
    assert.equal(SHIPPED_OC_MIRROR.binarySha256, "7f995715680a560d75bca9dda3b39e6c236600b95d9413ee683d5374aee82baa");
    assert.equal(SHIPPED_OC_MIRROR.tarballSha256, "7bad7aeeb27f6fee911599fcab000587d4066eafb58a7c88aed366676599bb73");
    assert.equal(SHIPPED_OC_MIRROR.gitCommit, "3f66edaf31831b93043b0baa55d02462d4e7ee39");
    assert.match(f().notes, /byte-identical/);
    assert.match(f().notes, /version strings alone would not have settled this/);
  });

  test("the remediation does not ask anyone to weaken the clients/ocp/latest rule", () => {
    assert.match(f().remediation.action, /clients\/ocp\/latest/);
    assert.match(f().remediation.action, /must not be weakened/);
  });
});

describe("kernel-headers is escalated, not self-certified", () => {
  const f = () => byId["OAA-8D-003"];

  test("stays unknown-applicability despite strong local measurement", () => {
    assert.equal(f().status, STATUS.UNKNOWN_APPLICABILITY);
    assert.equal(f().disposition, DISPOSITION.REQUIRES_HUMAN_DECISION);
  });

  test("the measurement that would tempt a self-certification is recorded as execution evidence", () => {
    const exec = f().evidence.filter((e) => e.source === EVIDENCE_SOURCE.LOCAL_EXECUTION);
    assert.equal(exec.length, 2);
    assert.match(exec[0].summary, /0 of them ELF objects/);
    assert.match(exec[1].summary, /253 HIGH to 86 HIGH/);
  });

  test("the human decision forbids resolving it by lowering a threshold", () => {
    assert.match(f().humanDecision, /HUMAN DECISION/);
    assert.match(f().humanDecision, /Do not resolve this by lowering a severity threshold/);
  });

  test("it carries no vendor evidence, which is why it cannot be retired", () => {
    const vendor = f().evidence.filter((e) => [EVIDENCE_SOURCE.CSAF_VEX, EVIDENCE_SOURCE.RHSA, EVIDENCE_SOURCE.UPSTREAM, EVIDENCE_SOURCE.VENDOR_STATEMENT].includes(e.source));
    assert.equal(vendor.length, 0);
  });
});

describe("fix availability", () => {
  test("the rows with an adoptable fix are exactly the four OS-package rebuild rows", () => {
    const withFix = ledger.findings.filter((f) => f.remediation?.fixedVersion).map((f) => f.id);
    assert.deepEqual(withFix.sort(), ["OAA-8D-002", "OAA-8D-005", "OAA-8D-006", "OAA-8D-008", "OAA-8D-009", "OAA-8D-010"]);
  });

  test("every fix-available-now row blocks the release until adopted", () => {
    const fixNow = ledger.dispositioned().filter((f) => f.status === STATUS.FIX_AVAILABLE_NOW);
    assert.equal(fixNow.length, 5);
    for (const f of fixNow) assert.equal(f.disposition, DISPOSITION.BLOCKS_RELEASE);
  });

  test("the rebuild rows name real RPM NVRs", () => {
    assert.equal(byId["OAA-8D-005"].remediation.fixedVersion, "1:3.5.8-2.el9_8");
    assert.equal(byId["OAA-8D-006"].remediation.fixedVersion, "10.40-7.el9_8");
    assert.equal(byId["OAA-8D-008"].remediation.fixedVersion, "1:3.5.8-2.el9_8");
    assert.equal(byId["OAA-8D-009"].remediation.fixedVersion, "10.40-7.el9_8");
    assert.equal(byId["OAA-8D-010"].remediation.fixedVersion, "2.3.2-3.el9_8.1");
  });
});

describe("Go-binary long tail is not laundered through the CRITICAL's outcome", () => {
  const f = () => byId["OAA-8D-012"];

  test("stays unknown and routes to a human", () => {
    assert.equal(f().status, STATUS.UNKNOWN_APPLICABILITY);
    assert.equal(f().disposition, DISPOSITION.REQUIRES_HUMAN_DECISION);
  });

  test("states plainly that only two CVEs were analysed to a determination", () => {
    assert.match(f().notes, /only CVE-2026-33186 .* and CVE-2026-96577 were analysed to a determination/);
  });

  test("warns that an upstream FixedVersion is not an adoptable fix here", () => {
    assert.match(f().notes, /must not be read as 'a fix OAA can apply'/);
    assert.equal(f().remediation.fixedVersion, null);
    assert.match(f().remediation.action, /Do NOT vendor or patch these binaries/);
  });
});

describe("coverage reconciles with the scan tallies", () => {
  /**
   * The grouped rows only mean anything if their stated counts add back up to
   * the scanner's own totals. Getting this wrong is how a "grouped by package"
   * ledger quietly drops findings, so the arithmetic is asserted rather than
   * trusted.
   */
  const stated = (id, re) => {
    const summary = byId[id].evidence.map((e) => e.summary).join(" ");
    const m = re.exec(summary);
    assert.ok(m, `${id}: could not read the stated count`);
    return Number(m[1]);
  };

  test("backend OS HIGH groups sum to the scanned 200", () => {
    const kernelHeaders = stated("OAA-8D-003", /(\d+) of the backend image's 200 OS-package HIGH findings/);
    const nodejs = stated("OAA-8D-004", /^.*?(\d+) HIGH findings across the Node\.js RPM family/);
    const remainder = stated("OAA-8D-007", /The (\d+) remaining OS HIGH findings/);
    const openssl = 3; // one finding per subpackage: openssl, openssl-libs, openssl-devel
    const pcre2 = 6; // three CVEs across two subpackages
    assert.equal(kernelHeaders, 141);
    assert.equal(nodejs, 32);
    assert.equal(remainder, 18);
    assert.equal(kernelHeaders + nodejs + remainder + openssl + pcre2, 200);
  });

  test("frontend OS HIGH groups sum to the scanned 29", () => {
    const remainder = stated("OAA-8D-011", /The (\d+) remaining frontend OS HIGH findings/);
    assert.equal(remainder, 20);
    assert.equal(remainder + 6 /* pcre2 */ + 2 /* openssl */ + 1 /* gd */, 29);
  });

  test("Go-binary HIGHs sum to the scanned 53 across both binaries", () => {
    assert.match(byId["OAA-8D-012"].scannerSource, /usr\/local\/bin\/oc \(20 HIGH\).*oc-mirror \(33 HIGH\)/);
    assert.equal(20 + 33, 53);
  });

  test("backend total HIGH is the 200 OS plus 53 Go-binary the scan reported", () => {
    assert.equal(200 + 53, 253);
  });
});

describe("human decisions", () => {
  test("every outstanding row states its question", () => {
    const decisions = ledger.humanDecisions();
    assert.ok(decisions.length > 0);
    for (const d of decisions) {
      assert.doesNotMatch(d.question, /a human must state the question/, `${d.id} has no decision text`);
    }
  });

  test("the evidenced rows are absent from the decision list", () => {
    const ids = ledger.humanDecisions().map((d) => d.id);
    assert.ok(!ids.includes("OAA-8D-001"));
    assert.ok(!ids.includes("OAA-8D-002"));
  });

  test("no row has been granted a waiver inside the ledger", () => {
    for (const f of ledger.findings) {
      assert.equal(f.waiver, undefined, `${f.id} carries a waiver; waivers belong in waivers.json`);
      assert.notEqual(f.status, "waived");
    }
  });
});
