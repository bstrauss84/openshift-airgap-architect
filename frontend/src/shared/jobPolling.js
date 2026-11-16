/**
 * When a polled async job has stopped existing.
 *
 * WHAT WENT WRONG. Two places polled `/api/jobs/<id>` on a timer and neither
 * treated a 404 as an answer:
 *
 *   - `OperatorsStep` wrapped the fetch in `catch { /* ignore *\/ }`, so a
 *     missing job produced no status entry, `allDone` could never become true,
 *     and the loop re-armed every 4 seconds until a 150-iteration safety cap
 *     ten minutes later.
 *   - `RunOcMirrorStep` had no `.catch` at all on its 2-second `setInterval`,
 *     so a missing job produced an unhandled rejection twice a second for as
 *     long as the step stayed mounted.
 *
 * A human saw exactly that during manual QA: the same few job IDs returning
 * `404 Job not found` over and over in the browser console.
 *
 * THE CONTRACT. A 404 for a job we were already polling is TERMINAL. The job
 * is gone — the backend restarted, its history was cleared, or the run was
 * pruned — and no amount of asking again will bring it back. That is different
 * from a network error or a 5xx, which are transient and worth retrying.
 *
 * Suppressing the console error while continuing to poll would have hidden the
 * symptom and kept the wasted traffic, so this deliberately keys on the status
 * code rather than on the message.
 */

/** True when a polled job no longer exists and polling must stop. */
export function isJobGone(error) {
  return error?.status === 404;
}

/**
 * True when polling for a set of job ids should stop.
 *
 * @param {string[]} ids every job id being polled
 * @param {(id: string) => string|undefined} statusOf terminal status, if known
 * @param {Set<string>} goneIds ids that answered 404
 */
export function allJobsSettled(ids, statusOf, goneIds) {
  return ids.every((id) => {
    if (goneIds.has(id)) return true;
    const status = statusOf(id);
    return status === "completed" || status === "failed";
  });
}

/** Statuses after which a job will not change again. */
export const TERMINAL_JOB_STATUSES = Object.freeze([
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
]);

export function isTerminalJobStatus(status) {
  return TERMINAL_JOB_STATUSES.includes(status);
}
