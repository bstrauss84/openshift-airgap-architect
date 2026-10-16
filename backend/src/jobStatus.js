/**
 * OpenShift Airgap Architect - Job terminal-state vocabulary (L3/L4)
 *
 * A job that has reached one of these states has a recorded outcome, and
 * rewriting it destroys the only account of what happened. Two writers need
 * the same answer — the shutdown sequence, which must not relabel a finished
 * job as cancelled, and a child's late `error`/`close` handler, which must
 * not relabel a cancelled job as failed — so the definition lives here rather
 * than being duplicated and allowed to drift.
 *
 * The guard is applied AT EACH WRITER, not inside `updateJob`. Making
 * `updateJob` refuse terminal transitions would silently change behaviour for
 * every caller, including legitimate ones that amend a finished job's message.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

export const TERMINAL_JOB_STATUSES = new Set([
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled"
]);

export const isTerminalJobStatus = (status) => TERMINAL_JOB_STATUSES.has(status);
