/**
 * OpenShift Airgap Architect - one oc-mirror operation at a time (v2.2.0 M1)
 *
 * Owner decision 5 (2026-10-23): permit only one oc-mirror mirroring run at a
 * time, across the Install and Mirroring workflows. Two concurrent runs can
 * collide on oc-mirror's local cache registry port (default 55000; startup
 * fails when it is already bound), and two runs that share a destination,
 * working-dir or cache corrupt each other's archives and incremental history.
 *
 * A run is "active" from the moment a request reserves the slot until its
 * child process leaves the process registry. The reservation covers the
 * asynchronous window before spawn (binary resolution, temp files), so two
 * requests arriving together cannot both pass the check. Once spawned, the
 * child's presence in `activeProcesses` with a running oc-mirror-run job is
 * the signal; a user Stop removes it from the registry immediately, so a
 * stopped run does not hold the slot while its process exits.
 *
 * Operator catalog scans (`oc-mirror list operators`) are not mirroring runs
 * and are not limited by this guard.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

import { activeProcesses } from "./processRegistry.js";

const RUN_JOB_TYPE = "oc-mirror-run";

/** @type {Set<string>} reservations taken before the child is spawned */
const pending = new Set();

/**
 * @param {(id: string) => ({ type?: string, status?: string } | undefined)} getJob
 * @returns {{ active: boolean, jobId: string|null }} jobId is null while a run is
 *   still starting (reserved, not yet spawned) — a reservation has no job id to report.
 */
export const findActiveOcMirrorRun = (getJob) => {
  if (pending.size > 0) return { active: true, jobId: null };
  for (const id of activeProcesses.keys()) {
    const job = getJob(id);
    if (job && job.type === RUN_JOB_TYPE && job.status === "running") return { active: true, jobId: id };
  }
  return { active: false, jobId: null };
};

/**
 * Atomically check and reserve. Synchronous on purpose: no await may occur
 * between the check and the reservation.
 * @returns {{ ok: true, token: string } | { ok: false, activeJobId: string|null }}
 */
export const reserveOcMirrorRun = (getJob, token) => {
  const active = findActiveOcMirrorRun(getJob);
  if (active.active) return { ok: false, activeJobId: active.jobId };
  pending.add(token);
  return { ok: true, token };
};

/** Release a pre-spawn reservation (spawned, or failed before spawning). */
export const releaseOcMirrorRunReservation = (token) => {
  pending.delete(token);
};

export const OC_MIRROR_RUN_IN_PROGRESS = "OC_MIRROR_RUN_IN_PROGRESS";

export const runInProgressBody = (activeJobId) => ({
  error: "Another oc-mirror run is already in progress. Wait for it to finish or stop it in Operations before starting a new run.",
  code: OC_MIRROR_RUN_IN_PROGRESS,
  activeJobId
});

/** Test-only: forget all reservations. */
export const _resetOcMirrorRunGuardForTests = () => pending.clear();
