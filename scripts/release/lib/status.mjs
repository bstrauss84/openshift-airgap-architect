/**
 * Certification result model.
 *
 * TWO LEVELS, deliberately distinct.
 *
 *   AXIS STATUS    what one proof found
 *   RUN VERDICT    what the run as a whole says about release readiness
 *
 * Conflating them is how a partial run can print "GREEN". A run that executed
 * three of fourteen required axes may legitimately have three PASSes, but it
 * has said nothing whatsoever about the release. So the run verdict carries a
 * state the axis statuses do not have: PARTIAL.
 *
 * AXIS STATUSES — five, and the distinctions are the whole point. The failure
 * mode this model exists to prevent is the one the v2.1 Tranche 7C.2 security
 * gate ran into: a required proof that could not be performed being reported
 * as if it had passed.
 *
 *   PASS           required proof RAN against the bound candidate and succeeded
 *   FAIL           required proof RAN and found a release-blocking defect
 *   INCOMPLETE     required proof could NOT be performed (tool/evidence absent)
 *   WAIVED         human-authorized exception: rationale + owner + expiry
 *   NOT_APPLICABLE axis demonstrably does not apply, with evidence for the claim
 *
 * RUN VERDICTS — four.
 *
 *   GREEN       every required axis ran and is non-blocking
 *   RED         a required axis proved a defect
 *   INCOMPLETE  all required axes attempted, some could not be proven
 *   PARTIAL     required axes were not attempted at all — says nothing about release
 *
 * Rules enforced mechanically rather than by convention, each because it has
 * already been violated somewhere in this repository's history:
 *
 *   1. INCOMPLETE never becomes PASS.
 *   2. A missing tool yields INCOMPLETE, never a silent skip and never N/A.
 *   3. N/A requires evidence justifying the inapplicability claim.
 *   4. A waiver can never produce PASS, and never applies to a non-waivable axis.
 *   5. Malformed waiver governance cannot coexist with a GREEN run verdict.
 *   6. A partial run can never be GREEN.
 */

/** @typedef {"PASS"|"FAIL"|"INCOMPLETE"|"WAIVED"|"NOT_APPLICABLE"} Status */
/** @typedef {"GREEN"|"RED"|"INCOMPLETE"|"PARTIAL"} Verdict */

export const PASS = "PASS";
export const FAIL = "FAIL";
export const INCOMPLETE = "INCOMPLETE";
export const WAIVED = "WAIVED";
export const NOT_APPLICABLE = "NOT_APPLICABLE";

export const STATUSES = Object.freeze([PASS, FAIL, INCOMPLETE, WAIVED, NOT_APPLICABLE]);

/** Statuses that do not block a release. */
const NON_BLOCKING = Object.freeze([PASS, WAIVED, NOT_APPLICABLE]);

export function isStatus(value) {
  return STATUSES.includes(value);
}

export function isBlocking(status) {
  return !NON_BLOCKING.includes(status);
}

export function result(axisId, status, detail, { evidence = null, artifacts = [], durationMs = 0 } = {}) {
  if (!isStatus(status)) {
    throw new TypeError(`unknown certification status "${status}" for axis "${axisId}"`);
  }
  if (status === NOT_APPLICABLE && !evidence) {
    // N/A is a claim about the world and needs its justification attached. Without
    // this, "not applicable" becomes the cheapest way to turn a gap green.
    throw new TypeError(`axis "${axisId}" reported NOT_APPLICABLE without evidence justifying it`);
  }
  return {
    axis: axisId,
    status,
    detail: String(detail ?? ""),
    evidence,
    artifacts: [...artifacts],
    durationMs,
  };
}

export const pass = (axis, detail, opts) => result(axis, PASS, detail, opts);
export const fail = (axis, detail, opts) => result(axis, FAIL, detail, opts);
export const incomplete = (axis, detail, opts) => result(axis, INCOMPLETE, detail, opts);
export const notApplicable = (axis, detail, opts) => result(axis, NOT_APPLICABLE, detail, opts);

// ---------------------------------------------------------------------------
// Waivers
// ---------------------------------------------------------------------------

/**
 * Required waiver fields. A waiver without an accountable human and a review
 * date is an indefinite suppression wearing a different name.
 */
const WAIVER_FIELDS = Object.freeze(["id", "axis", "reason", "owner", "authorizedBy", "expires"]);

/**
 * Accepted expiry forms: a bare ISO date, or a full UTC ISO timestamp.
 *
 * Deliberately strict on TWO axes, because a waiver expiry is exactly the
 * wrong field to get loosely parsed.
 *
 *   SYNTAX   `new Date("01/02/2026")` parses, and means January 2nd to one
 *            reader and February 1st to another.
 *
 *   CALENDAR a shape-only regex is not enough. JavaScript's Date silently
 *            NORMALISES impossible dates: `new Date("2026-02-31T23:59:59Z")`
 *            yields March 3rd, so a typo'd or fabricated expiry would quietly
 *            become a real — and later — date. Every component is therefore
 *            round-tripped against the constructed Date, which rejects
 *            2026-02-29 (not a leap year), 2026-02-31 and 2026-04-31 while
 *            accepting 2028-02-29.
 */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

export function parseExpiry(value) {
  const s = String(value ?? "");

  const dateOnly = ISO_DATE.exec(s);
  const instant = ISO_INSTANT.exec(s);
  if (!dateOnly && !instant) return null;

  const [y, mo, d] = (dateOnly ?? instant).slice(1, 4).map(Number);
  // A bare date means end of that day UTC: a waiver that "expires 2026-10-12"
  // is still in force during the 12th.
  const [h, mi, sec] = instant ? instant.slice(4, 7).map(Number) : [23, 59, 59];
  const ms = instant?.[7] ? Number(instant[7].padEnd(3, "0")) : 0;

  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (h > 23 || mi > 59 || sec > 59) return null;

  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, sec, ms));
  if (Number.isNaN(dt.getTime())) return null;
  // The normalisation check: if any component came back different, the input
  // named a day that does not exist.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

export function validateWaiver(waiver) {
  const missing = WAIVER_FIELDS.filter((f) => !waiver?.[f] || String(waiver[f]).trim() === "");
  if (missing.length) return `missing required field(s): ${missing.join(", ")}`;
  if (!parseExpiry(waiver.expires)) {
    return `expiry "${waiver.expires}" is not an unambiguous, real calendar date (YYYY-MM-DD) or UTC instant (YYYY-MM-DDTHH:MM:SSZ)`;
  }
  return null;
}

/**
 * Validate a whole waiver set against the axis registry.
 *
 * Returns only waivers that are structurally valid AND permitted. Everything
 * rejected becomes a governance error, and governance errors force the run
 * verdict off GREEN — a malformed waiver file is a governance failure, not a
 * no-op.
 */
export function validateWaiverSet(list, { knownAxisIds = [], nonWaivableAxisIds = [] } = {}) {
  const errors = [];
  const valid = [];
  const seenIds = new Set();
  const seenAxes = new Set();

  for (const w of list ?? []) {
    const id = w?.id ?? "(no id)";
    const problem = validateWaiver(w);
    if (problem) {
      errors.push(`waiver ${id}: ${problem}`);
      continue;
    }
    if (seenIds.has(w.id)) {
      errors.push(`waiver ${w.id}: duplicate waiver id`);
      continue;
    }
    seenIds.add(w.id);

    if (!knownAxisIds.includes(w.axis)) {
      errors.push(`waiver ${w.id}: unknown axis "${w.axis}"`);
      continue;
    }
    if (nonWaivableAxisIds.includes(w.axis)) {
      // Policy is in the axis registry, not in this file and not in JSON.
      // Changing it must be a deliberate code change, not an added JSON entry.
      errors.push(`waiver ${w.id}: axis "${w.axis}" is NON-WAIVABLE by project policy and cannot be waived`);
      continue;
    }
    if (seenAxes.has(w.axis)) {
      errors.push(`waiver ${w.id}: a second active waiver for axis "${w.axis}" is ambiguous`);
      continue;
    }
    seenAxes.add(w.axis);
    valid.push(w);
  }
  return { waivers: valid, errors };
}

/**
 * Apply a human-authorized waiver to an axis result.
 *
 * Returns the ORIGINAL result unchanged when the waiver does not apply, so an
 * expired, mismatched or forbidden waiver can never quietly suppress a
 * finding. The original status is preserved under `waivedFrom` so evidence
 * always records what was observed, not only what it was downgraded to.
 */
export function applyWaiver(res, waiver, now = new Date(), { nonWaivable = false } = {}) {
  if (!waiver) return res;
  if (waiver.axis !== res.axis) return res;
  if (!isBlocking(res.status)) return res; // nothing to waive

  if (nonWaivable) {
    return { ...res, waiverRejected: `waiver ${waiver.id}: axis "${res.axis}" is non-waivable by project policy` };
  }
  const expires = parseExpiry(waiver.expires);
  if (!expires) {
    return { ...res, waiverRejected: `waiver ${waiver.id}: unparseable or ambiguous expiry "${waiver.expires}"` };
  }
  if (expires <= now) {
    return { ...res, waiverRejected: `waiver ${waiver.id} expired ${waiver.expires}` };
  }
  return {
    ...res,
    status: WAIVED,
    waivedFrom: res.status,
    waiver: {
      id: waiver.id,
      reason: waiver.reason,
      owner: waiver.owner,
      authorizedBy: waiver.authorizedBy,
      expires: waiver.expires,
    },
  };
}

// ---------------------------------------------------------------------------
// Rollup
// ---------------------------------------------------------------------------

/** Rollup across the axes that actually RAN. Says nothing about coverage. */
export function overall(results) {
  if (results.some((r) => r.status === FAIL)) return "RED";
  if (results.some((r) => r.status === INCOMPLETE)) return "INCOMPLETE";
  return "GREEN";
}

/**
 * The release verdict: what this run says about shipping.
 *
 * Precedence RED > PARTIAL > INCOMPLETE > GREEN.
 *
 * PARTIAL outranks INCOMPLETE because it is the stronger statement. INCOMPLETE
 * means "we tried everything and some proofs were unavailable"; PARTIAL means
 * "we did not try", which cannot be read as a near-miss.
 *
 * FAIL still outranks PARTIAL: a proven defect is actionable now and should
 * not be masked by the fact that coverage was also incomplete.
 */
export function releaseVerdict({ results = [], missingRequiredAxes = [], governanceErrors = [] } = {}) {
  if (results.some((r) => r.status === FAIL)) return "RED";
  if (missingRequiredAxes.length) return "PARTIAL";
  if (results.some((r) => r.status === INCOMPLETE)) return "INCOMPLETE";
  // A malformed waiver file means the governance that gates exceptions is
  // itself untrustworthy. That cannot sit underneath a GREEN.
  if (governanceErrors.length) return "INCOMPLETE";
  return "GREEN";
}

/** Deterministic process exit codes, so CI can branch on the verdict. */
export const EXIT = Object.freeze({
  GREEN: 0,
  RED: 1,
  INCOMPLETE: 2,
  HARNESS_ERROR: 3,
  PARTIAL: 4,
});

export function exitCodeFor(verdict) {
  return EXIT[verdict] ?? EXIT.HARNESS_ERROR;
}
