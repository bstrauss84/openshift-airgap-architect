/**
 * The PLACEHOLDER PATTERN for an axis that is registered but not yet provable.
 *
 * Tranche 8A's reasoning, preserved because it is the reason this file still
 * exists: an axis that is absent from the registry is a gap nobody sees; an
 * axis that is present and reports INCOMPLETE is a gap that appears in every
 * summary, keeps the overall verdict out of GREEN, and carries its own
 * closure plan. That is the difference between a gap list in a document and a
 * gap list that enforces itself.
 *
 * Such an axis MUST NOT be converted to PASS, NOT_APPLICABLE or WAIVED to
 * obtain a green run. NOT_APPLICABLE in particular would be false for any
 * axis that genuinely applies to this product.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * STATUS, 2026-10-16: THIS FILE NO LONGER DEFINES ANY AXIS.
 *
 * It used to export four — `lifecycle`, `compatibility`, `connectivity` and
 * `artifacts` — each hard-coded to INCOMPLETE. All four have been replaced by
 * real axis modules carrying the same ids, which is exactly the substitution
 * the original header described: "the placeholder is replaced by a real axis
 * module with the same id, and nothing else in the harness changes."
 *
 *   lifecycle      -> axes/lifecycle.mjs      executes backend resource probes
 *   compatibility  -> axes/compatibility.mjs  host matrix, verified cells only
 *   connectivity   -> axes/connectivity.mjs   profiles under real egress denial
 *   artifacts      -> axes/artifacts.mjs      release unit, checksums, identity
 *
 * The four declarations are NOT kept here alongside the real modules. Two
 * registrations of one axis id, one of them permanently INCOMPLETE, is the
 * "duplicate authority" problem the §3.15 audit exists to find — and a reader
 * who opened this file would be told four proofs do not exist when they do.
 *
 * `plannedAxis` itself is retained, and deliberately. It is the documented
 * way to register the NEXT gap, and deleting it would mean the next person
 * who needs it either reinvents it or, far more likely, just leaves the axis
 * out of the registry — which is the failure mode 8A designed it against.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { incomplete } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";

/**
 * Build a registered-but-unprovable axis.
 *
 * @param {object} spec
 * @param {string} spec.id              axis id, stable across tranches
 * @param {string} spec.title           human title
 * @param {string[]} spec.inputs        staleness inputs the real axis will use
 * @param {string} spec.owner           canonical backlog item
 * @param {string} spec.tranche         tranche that closes it
 * @param {string} spec.reason          why the proof cannot be performed today
 * @param {string[]} spec.closure       concrete steps to close
 * @param {object} [spec.known]         what was established without proving
 */
export function plannedAxis(spec) {
  return {
    id: spec.id,
    title: spec.title,
    inputs: spec.inputs,
    planned: true,
    // Planned axes are required: omitting them from the registry would hide
    // the gap, and marking them optional would let a full run go GREEN
    // without the proofs they stand for.
    required: true,
    // Nothing to reuse — these report the absence of a proof, and that answer
    // must be recomputed if the closure plan ever lands.
    reuse: REUSE.NEVER,
    async run() {
      return incomplete(spec.id, `${spec.reason} (owner: ${spec.owner}; closes in ${spec.tranche})`, {
        evidence: {
          plannedAxis: true,
          backlogItem: spec.owner,
          closesIn: spec.tranche,
          reason: spec.reason,
          closure: spec.closure,
          knownAtRegistration: spec.known ?? null,
        },
      });
    },
  };
}

/**
 * No axis is currently in the planned state.
 *
 * Kept as an explicit empty export rather than removed, so the registry's
 * `...planned` spread shape stays available for the next gap without an
 * import change.
 */
export default [];
