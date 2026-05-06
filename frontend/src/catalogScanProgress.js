/**
 * OpenShift Airgap Architect - Catalog Scan Progress Calculator
 *
 * Deterministic "fake" progress for operator catalog scans.
 * 19 steps of 5% from 0 to 95 over 6 minutes; completion sets 100% via caller.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

export const DURATION_MS = 360_000; // 6 minutes
const STEPS = 19;
const STEP_PCT = 5;
const CAP_PCT = 95;

/**
 * Compute progress percentage from elapsed time.
 * Returns 0–95; caller sets 100 on completion.
 * @param {number} elapsedMs - Time since scan start (ms)
 * @returns {number} Progress 0–95
 */
export function getDeterministicProgress(elapsedMs) {
  if (elapsedMs <= 0) return 0;
  const step = Math.floor((elapsedMs / DURATION_MS) * STEPS);
  const pct = Math.min(CAP_PCT, step * STEP_PCT);
  return Math.max(0, pct);
}
