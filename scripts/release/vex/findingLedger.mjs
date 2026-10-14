/**
 * Vulnerability finding ledger: applicability, evidence and policy disposition.
 *
 * WHY THIS EXISTS. A scanner tally ("1 CRITICAL / 253 HIGH") is not a release
 * decision, and the gap between the two is where release hardening goes wrong.
 * The failure mode is always the same shape: a finding is talked down to "not
 * really applicable" in a chat message, nobody records the evidence, and the
 * next run of the scanner produces the same number with nobody remembering why
 * it was acceptable last time. This module makes the talking-down step a typed,
 * validated, testable record or makes it impossible.
 *
 * THREE DISTINCTIONS THE MODEL REFUSES TO COLLAPSE
 *
 *   1. STATUS vs DISPOSITION. Status is a claim about the world ("the
 *      vulnerable code is not present"). Disposition is what the project does
 *      about it ("this does not block the release"). A status never implies a
 *      disposition on its own; `dispositionFor` is the only bridge, and it
 *      refuses to cross for anything it cannot justify.
 *
 *   2. CONFIDENCE. `verified-by-execution` (we ran the real artifact and
 *      observed the behaviour), `vendor-asserted` (Red Hat says so in CSAF/VEX
 *      or an RHSA) and `inferred` (we reasoned about it) are not
 *      interchangeable. Inference alone can never retire a finding; it can only
 *      ever escalate to a human.
 *
 *   3. EVIDENCE vs ASSERTION. An evidence record must name a retrievable
 *      source — an RHSA id, a CSAF VEX document, an upstream commit, a command
 *      that was run. A status string with no evidence behind it is the thing
 *      this module exists to prevent.
 *
 * FAIL CLOSED. Every validation below rejects rather than defaults:
 *
 *   - an unknown status, component, source or confidence value throws;
 *   - `not-applicable-with-evidence` and `configuration-mitigated-with-evidence`
 *     require at least one VENDOR evidence record carrying a justification
 *     string, so "not applicable" cannot be asserted from reasoning alone;
 *   - `fix-available-now` requires a concrete fixed version in the remediation,
 *     because "a fix exists somewhere" is not a remediation;
 *   - `unknown-applicability` can NEVER be auto-dispositioned to non-blocking;
 *     it always routes to a human;
 *   - no waiver is granted here. The ledger prepares the evidence a human needs
 *     and marks the decision as outstanding. Granting exceptions lives in
 *     `scripts/release/lib/status.mjs` waiver governance, authored by a person.
 */

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/**
 * Applicability status. Fixed vocabulary; new values are a deliberate code
 * change, never a free-text field, because free text is how "probably fine"
 * enters a release record.
 */
export const STATUS = Object.freeze({
  /** Vendor fix exists and can be adopted now (rebuild, bump, repin). */
  FIX_AVAILABLE_NOW: "fix-available-now",
  /** Genuinely applicable, vendor has not shipped a fix yet. */
  VENDOR_FIX_PENDING: "vendor-fix-pending",
  /** Does not apply to this artifact, and the evidence for that is attached. */
  NOT_APPLICABLE_WITH_EVIDENCE: "not-applicable-with-evidence",
  /** Applies in principle; our configuration removes the attack path, with evidence. */
  CONFIGURATION_MITIGATED_WITH_EVIDENCE: "configuration-mitigated-with-evidence",
  /** Applies, no fix, no mitigation. Blocks until a human decides otherwise. */
  CONFIRMED_APPLICABLE_UNRESOLVED: "confirmed-applicable-unresolved",
  /** Not yet analysed. The honest default; never a passing state. */
  UNKNOWN_APPLICABILITY: "unknown-applicability",
});

export const STATUSES = Object.freeze(Object.values(STATUS));

/** Where the vulnerable thing lives. Drives who owns the remediation. */
export const COMPONENT = Object.freeze({
  BACKEND_IMAGE_OS_PKG: "backend-image/os-pkg",
  FRONTEND_IMAGE_OS_PKG: "frontend-image/os-pkg",
  BACKEND_IMAGE_GO_BINARY: "backend-image/go-binary",
  BACKEND_IMAGE_APP_DEP: "backend-image/app-dep",
  FRONTEND_IMAGE_APP_DEP: "frontend-image/app-dep",
  /** Present only in a build stage; never shipped. Still must be proven, not assumed. */
  BUILDER_ONLY: "builder-only",
});

export const COMPONENTS = Object.freeze(Object.values(COMPONENT));

/**
 * Evidence sources, split into VENDOR and LOCAL.
 *
 * The split is load-bearing: the fail-closed rule for `not-applicable` requires
 * a VENDOR source specifically. Local execution evidence is valuable — often
 * stronger than the vendor's own statement — but a project asserting its own
 * inapplicability with no vendor corroboration is exactly the self-certifying
 * pattern this ledger is meant to surface to a human.
 */
export const EVIDENCE_SOURCE = Object.freeze({
  /** Red Hat Security Advisory (errata). */
  RHSA: "rhsa",
  /** Red Hat CSAF VEX document (per-CVE product_status + justification flag). */
  CSAF_VEX: "csaf-vex",
  /** Upstream project commit, PR or release note. */
  UPSTREAM: "upstream",
  /** Prose statement on the vendor's CVE page. */
  VENDOR_STATEMENT: "vendor-statement",
  /** A command we ran against the real artifact, with its observed output. */
  LOCAL_EXECUTION: "local-execution",
  /** Static inspection of the real artifact (symbols, strings, file lists). */
  LOCAL_STATIC: "local-static",
  /** Scanner output. Describes the finding; never justifies dismissing it. */
  SCANNER: "scanner",
});

export const EVIDENCE_SOURCES = Object.freeze(Object.values(EVIDENCE_SOURCE));

/** Sources that count as independent vendor corroboration. */
const VENDOR_SOURCES = Object.freeze([
  EVIDENCE_SOURCE.RHSA,
  EVIDENCE_SOURCE.CSAF_VEX,
  EVIDENCE_SOURCE.VENDOR_STATEMENT,
  EVIDENCE_SOURCE.UPSTREAM,
]);

/** How strongly the evidence is held. Never inferred from the source alone. */
export const CONFIDENCE = Object.freeze({
  VERIFIED_BY_EXECUTION: "verified-by-execution",
  VENDOR_ASSERTED: "vendor-asserted",
  INFERRED: "inferred",
});

export const CONFIDENCES = Object.freeze(Object.values(CONFIDENCE));

/** What the project does about the finding. */
export const DISPOSITION = Object.freeze({
  NON_BLOCKING_WITH_EVIDENCE: "non-blocking-with-evidence",
  BLOCKS_RELEASE: "blocks-release",
  REQUIRES_HUMAN_DECISION: "requires-human-decision",
});

export const DISPOSITIONS = Object.freeze(Object.values(DISPOSITION));

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

const isNonEmpty = (v) => typeof v === "string" && v.trim() !== "";

/**
 * One retrievable piece of evidence.
 *
 * `justification` is mandatory for CSAF VEX because the VEX justification
 * string ("vulnerable_code_not_present", "component_not_present", …) is the
 * whole substance of the vendor's claim. A VEX citation without it records
 * that Red Hat said something, not what.
 */
/**
 * Brand stamped on records that actually went through `makeEvidence()`.
 *
 * Not exported, and a Symbol rather than a string key, so it cannot be
 * forged from outside this module or copied in from a JSON fixture. Checking
 * `EVIDENCE_SOURCES.includes(e.source)` was NOT equivalent: a plain object
 * literal with a valid `source` satisfied it while bypassing every guard
 * below — the justification requirement, the confidence enum, and the
 * local-execution rule. That mattered because evidence is the only route to
 * `not-applicable-with-evidence`, i.e. the only way a finding stops blocking.
 */
const EVIDENCE_BRAND = Symbol("oaa.vex.evidence");

export function makeEvidence({ source, ref, summary, justification = null, confidence, observedAt = null }) {
  if (!EVIDENCE_SOURCES.includes(source)) {
    throw new TypeError(`unknown evidence source "${source}" (expected one of: ${EVIDENCE_SOURCES.join(", ")})`);
  }
  if (!isNonEmpty(ref)) {
    throw new TypeError(`evidence from "${source}" needs a retrievable ref (advisory id, URL, commit or command)`);
  }
  if (!isNonEmpty(summary)) {
    throw new TypeError(`evidence ${ref} needs a summary of what it actually shows`);
  }
  if (!CONFIDENCES.includes(confidence)) {
    throw new TypeError(`evidence ${ref} has unknown confidence "${confidence}"`);
  }
  if (source === EVIDENCE_SOURCE.CSAF_VEX && !isNonEmpty(justification)) {
    throw new TypeError(`CSAF VEX evidence ${ref} must record the vendor justification string verbatim`);
  }
  if (source === EVIDENCE_SOURCE.LOCAL_EXECUTION && confidence !== CONFIDENCE.VERIFIED_BY_EXECUTION) {
    // Claiming you ran something and then not claiming execution confidence is
    // a mislabelled record; the two must agree or the ledger is lying.
    throw new TypeError(`local-execution evidence ${ref} must carry confidence "${CONFIDENCE.VERIFIED_BY_EXECUTION}"`);
  }
  return Object.freeze({
    [EVIDENCE_BRAND]: true,
    source,
    ref: ref.trim(),
    summary: summary.trim(),
    justification: justification ? String(justification).trim() : null,
    confidence,
    observedAt,
  });
}

export const isVendorEvidence = (e) => VENDOR_SOURCES.includes(e.source);

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/** Statuses that may not be asserted without vendor corroboration. */
const REQUIRE_VENDOR_EVIDENCE = Object.freeze([
  STATUS.NOT_APPLICABLE_WITH_EVIDENCE,
  STATUS.CONFIGURATION_MITIGATED_WITH_EVIDENCE,
]);

/**
 * A remediation description.
 *
 * `fixedVersion` is the version that actually resolves the finding, `action`
 * is what someone must do. `fix-available-now` requires `fixedVersion` because
 * a remediation nobody can act on is a wish.
 */
export function makeRemediation({ action, fixedVersion = null, effort = null, provenBy = null }) {
  if (!isNonEmpty(action)) throw new TypeError("remediation needs an action a person can carry out");
  return Object.freeze({ action: action.trim(), fixedVersion, effort, provenBy });
}

/**
 * Create a validated finding.
 *
 * `cveIds` is a list so grouped OS findings (one package, many kernel CVEs)
 * are first-class rather than being flattened into 141 near-identical rows
 * that nobody reads.
 */
export function makeFinding({
  id,
  cveIds,
  packageName,
  installedVersion,
  component,
  severity,
  scannerSource,
  status,
  evidence = [],
  remediation = null,
  notes = null,
  humanDecision = null,
}) {
  if (!isNonEmpty(id)) throw new TypeError("finding needs a stable id");
  const cves = Array.isArray(cveIds) ? cveIds.filter(isNonEmpty) : [];
  if (cves.length === 0) throw new TypeError(`finding "${id}" needs at least one CVE id`);
  if (!isNonEmpty(packageName)) throw new TypeError(`finding "${id}" needs a package name`);
  if (!isNonEmpty(installedVersion)) throw new TypeError(`finding "${id}" needs the installed version`);
  if (!COMPONENTS.includes(component)) {
    throw new TypeError(`finding "${id}" has unknown component "${component}"`);
  }
  if (!isNonEmpty(severity)) throw new TypeError(`finding "${id}" needs a severity`);
  if (!isNonEmpty(scannerSource)) throw new TypeError(`finding "${id}" needs a scanner source`);
  if (!STATUSES.includes(status)) {
    throw new TypeError(`finding "${id}" has unknown status "${status}" (expected one of: ${STATUSES.join(", ")})`);
  }

  const ev = Object.freeze([...evidence]);
  for (const e of ev) {
    // The brand, not the shape. A shape check accepts a hand-rolled literal
    // that never ran makeEvidence()'s guards, which is the one bypass that
    // reaches `non-blocking-with-evidence`.
    if (!e?.[EVIDENCE_BRAND]) {
      throw new TypeError(`finding "${id}" carries an evidence record that did not come from makeEvidence()`);
    }
  }

  if (REQUIRE_VENDOR_EVIDENCE.includes(status)) {
    const vendor = ev.filter((e) => isVendorEvidence(e) && isNonEmpty(e.justification));
    if (vendor.length === 0) {
      throw new TypeError(
        `finding "${id}" claims "${status}" but carries no vendor evidence with a justification; ` +
          `local reasoning cannot retire a finding — use "${STATUS.UNKNOWN_APPLICABILITY}" and escalate`,
      );
    }
  }

  if (status === STATUS.FIX_AVAILABLE_NOW && !isNonEmpty(remediation?.fixedVersion)) {
    throw new TypeError(`finding "${id}" claims "${status}" but names no fixed version to move to`);
  }

  if (status === STATUS.UNKNOWN_APPLICABILITY && ev.some((e) => e.confidence === CONFIDENCE.VENDOR_ASSERTED && isVendorEvidence(e))) {
    // Not an error, but worth refusing silently: if the vendor has spoken, the
    // status should say what they said rather than staying "unknown".
    if (!isNonEmpty(notes)) {
      throw new TypeError(
        `finding "${id}" is "${status}" yet carries vendor-asserted evidence; record a note explaining why the vendor statement is not decisive`,
      );
    }
  }

  return Object.freeze({
    id: id.trim(),
    cveIds: Object.freeze([...cves]),
    cveCount: cves.length,
    packageName: packageName.trim(),
    installedVersion: installedVersion.trim(),
    component,
    severity,
    scannerSource,
    status,
    evidence: ev,
    remediation,
    notes,
    humanDecision,
  });
}

// ---------------------------------------------------------------------------
// Disposition
// ---------------------------------------------------------------------------

/**
 * Map a finding to a policy disposition.
 *
 * The only path to `non-blocking-with-evidence` runs through a status that
 * already required vendor evidence to construct. Everything else either blocks
 * or goes to a person. There is deliberately no branch that turns a severity
 * threshold, an age, or a count into a pass.
 */
export function dispositionFor(finding) {
  if (!finding || !STATUSES.includes(finding.status)) {
    throw new TypeError("dispositionFor() requires a validated finding");
  }
  switch (finding.status) {
    case STATUS.NOT_APPLICABLE_WITH_EVIDENCE:
    case STATUS.CONFIGURATION_MITIGATED_WITH_EVIDENCE: {
      // Construction already guaranteed vendor evidence exists. Confidence is
      // checked here as well: a vendor record that we only *inferred* applies
      // to our exact artifact is not enough to close the finding ourselves.
      const strong = finding.evidence.some(
        (e) => e.confidence === CONFIDENCE.VERIFIED_BY_EXECUTION || e.confidence === CONFIDENCE.VENDOR_ASSERTED,
      );
      return strong ? DISPOSITION.NON_BLOCKING_WITH_EVIDENCE : DISPOSITION.REQUIRES_HUMAN_DECISION;
    }
    case STATUS.FIX_AVAILABLE_NOW:
      // A fix exists and has not been taken. That is a release blocker until
      // either the fix is adopted or a human waives it; it is never "fine".
      return DISPOSITION.BLOCKS_RELEASE;
    case STATUS.CONFIRMED_APPLICABLE_UNRESOLVED:
      return DISPOSITION.BLOCKS_RELEASE;
    case STATUS.VENDOR_FIX_PENDING:
      // Nothing to adopt, so it cannot simply block forever; but nobody except
      // a human may decide to ship with it.
      return DISPOSITION.REQUIRES_HUMAN_DECISION;
    case STATUS.UNKNOWN_APPLICABILITY:
      // The one absolute rule: unknown is never auto-dispositioned.
      return DISPOSITION.REQUIRES_HUMAN_DECISION;
    default:
      /* c8 ignore next */
      throw new TypeError(`no disposition rule for status "${finding.status}"`);
  }
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export class FindingLedger {
  constructor(findings = []) {
    this.findings = [];
    for (const f of findings) this.add(f);
  }

  add(finding) {
    if (!finding || !STATUSES.includes(finding.status)) {
      throw new TypeError("FindingLedger.add() requires a finding built by makeFinding()");
    }
    if (this.findings.some((f) => f.id === finding.id)) {
      throw new TypeError(`duplicate finding id "${finding.id}"`);
    }
    this.findings.push(finding);
    return this;
  }

  /** Findings with their computed disposition attached. */
  dispositioned() {
    return this.findings.map((f) => ({ ...f, disposition: dispositionFor(f) }));
  }

  countsByStatus() {
    const out = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const f of this.findings) out[f.status] += 1;
    return out;
  }

  countsByDisposition() {
    const out = Object.fromEntries(DISPOSITIONS.map((d) => [d, 0]));
    for (const f of this.findings) out[dispositionFor(f)] += 1;
    return out;
  }

  /** Distinct CVE ids across every finding, so grouped rows still tally. */
  cveTotal() {
    return new Set(this.findings.flatMap((f) => f.cveIds)).size;
  }

  /**
   * Fix availability, taken from the remediation's `fixedVersion`.
   *
   * Reported as CVE counts, not finding counts: one grouped finding covering
   * 141 kernel CVEs must not read as "1 unfixed thing".
   */
  fixAvailability() {
    let fixed = 0;
    let unfixed = 0;
    for (const f of this.findings) {
      if (isNonEmpty(f.remediation?.fixedVersion)) fixed += f.cveCount;
      else unfixed += f.cveCount;
    }
    return { cvesWithFixAvailable: fixed, cvesWithNoFixAvailable: unfixed, total: fixed + unfixed };
  }

  /** Everything a person must rule on before this can be certified. */
  humanDecisions() {
    return this.dispositioned()
      .filter((f) => f.disposition === DISPOSITION.REQUIRES_HUMAN_DECISION || f.disposition === DISPOSITION.BLOCKS_RELEASE)
      .map((f) => ({
        id: f.id,
        cveIds: f.cveIds,
        packageName: f.packageName,
        component: f.component,
        severity: f.severity,
        status: f.status,
        disposition: f.disposition,
        question: f.humanDecision ?? "No decision text recorded; a human must state the question before it can be answered.",
        remediation: f.remediation?.action ?? null,
      }));
  }

  /**
   * True only when nothing is outstanding.
   *
   * Deliberately not called `isGreen`: this module reports, it does not
   * certify. Certification verdicts live in `lib/status.mjs`.
   */
  isFullyDispositioned() {
    return this.dispositioned().every((f) => f.disposition === DISPOSITION.NON_BLOCKING_WITH_EVIDENCE);
  }

  toJSON() {
    return {
      findingCount: this.findings.length,
      cveTotal: this.cveTotal(),
      countsByStatus: this.countsByStatus(),
      countsByDisposition: this.countsByDisposition(),
      fixAvailability: this.fixAvailability(),
      fullyDispositioned: this.isFullyDispositioned(),
      findings: this.dispositioned(),
    };
  }
}
