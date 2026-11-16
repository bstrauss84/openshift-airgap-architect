/**
 * OpenShift Airgap Architect - watch one job until it settles (v2.2.0 M5)
 *
 * Polls GET /api/jobs/:id — the existing job engine, not a second one — for a
 * Mirroring run or catalog check. A 404 is terminal (the job is gone, e.g. the
 * backend restarted); network errors and 5xx are transient and polling goes on
 * (shared/jobPolling.js). Stops on unmount and when the job id changes.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { useEffect, useRef, useState } from "react";
import { fetchJob } from "./mirroringApi.js";
import { isJobGone, isTerminalJobStatus } from "../shared/jobPolling.js";

export const JOB_POLL_MS = 1500;

/**
 * @param {string|null} jobId
 * @param {{ onSettled?: (job: object|null) => void }} [options]
 * @returns {{ job: object|null, gone: boolean, settled: boolean }}
 */
export function useJobWatch(jobId, { onSettled } = {}) {
  const [job, setJob] = useState(null);
  const [gone, setGone] = useState(false);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  useEffect(() => {
    setJob(null);
    setGone(false);
    if (!jobId) return undefined;
    let cancelled = false;
    let timer = null;
    const controller = new AbortController();
    const tick = async () => {
      try {
        const next = await fetchJob(jobId, { signal: controller.signal });
        if (cancelled) return;
        setJob(next);
        if (isTerminalJobStatus(next.status)) {
          settledRef.current?.(next);
          return;
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        if (isJobGone(err)) {
          setGone(true);
          settledRef.current?.(null);
          return;
        }
      }
      timer = setTimeout(tick, JOB_POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  return { job, gone, settled: gone || Boolean(job && isTerminalJobStatus(job.status)) };
}
