/**
 * OpenShift Airgap Architect - Process shutdown sequence (L4)
 *
 * The previous handler cleared the retention interval, sent SIGTERM to tracked
 * children, and called `process.exit(0)` in the same tick. Exiting promptly is
 * right — `server.close()` genuinely never calls back while undici keeps ref'd
 * sockets for outgoing Cincinnati/GitHub requests, and the shipped compose
 * profile allows only `stop_grace_period: 3s`, of which `runuser` (PID 1 in
 * the backend image) consumes roughly 2s after node exits. There is no budget
 * to wait for anything.
 *
 * What was missing is that everything which cleans up after a child —
 * marking its job finished, unlinking its registry auth file, removing its
 * registries.d directory — lives in that child's `close` handler, and the
 * process is gone before any of it runs.
 *
 * For jobs the consequence is fidelity, not loss: `markStaleJobs()` at
 * startup (index.js) already flips every surviving `running` row to `failed`
 * / "Server restarted; job marked stale.". So an interrupted job was not
 * stuck — it was MISDIAGNOSED, including work that had actually succeeded but
 * not yet written its status. Recording `cancelled` here states what really
 * happened, and because `markStaleJobs` only targets `running`, these rows
 * are correctly left alone on the next boot. For temporary files the
 * consequence was real loss: pull secrets stayed on the /data volume.
 *
 * This sequence therefore does the same work the callbacks would have done,
 * but synchronously, which is the only kind of cleanup a terminating process
 * can guarantee. It performs no asynchronous work and no waiting, so its own
 * DURATION is bounded — its LATENCY is not, see the known gap below.
 *
 * KNOWN GAP — high-side runtime-package export (L4-D), and where it is NOT.
 *
 * Staging an export runs `detectContainerEngine`, two `inspectImage` calls
 * and two `podman save` calls in ONE synchronous block — measured at 5,344 ms
 * on a host that has podman. A signal arriving inside that block is not
 * delivered until it returns, because Node dispatches signal handlers as
 * event-loop callbacks.
 *
 * That block is UNREACHABLE IN THE SHIPPED CONTAINER. `backend/Containerfile`
 * installs no podman and no docker — verified by running the shipped image —
 * so `detectContainerEngine()` fails two ENOENT `spawnSync` calls in ~3 ms,
 * the export is skipped with "No container engine detected", and the grace
 * period is never at risk. The earlier claim that compose's
 * `stop_grace_period: 3s` guarantees a SIGKILL here was wrong for the shipped
 * artifact; it describes only a backend run directly on a host that has a
 * container engine (`npm run dev`, bare metal). In that configuration the
 * block is real, and staging under `os.tmpdir()` is additionally never
 * reclaimed at startup — the boot sweep covers DATA_DIR/tmp only.
 *
 * So: no compose change is justified on this evidence. Recorded rather than
 * acted on, and corrected rather than left overstated.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { isTerminalJobStatus } from "./jobStatus.js";

/**
 * Build the signal handler.
 *
 * @param {object} deps
 * @param {() => (import("node:http").Server | undefined)} deps.getServer
 * @param {Map<string, import("node:child_process").ChildProcess>} deps.activeProcesses
 * @param {(id: string, patch: object) => unknown} deps.updateJob
 * @param {(id: string) => ({ status?: string } | null | undefined)} [deps.getJob]
 * @param {() => {released:number, failed:number, byLabel:object, failures:Array}} deps.releaseAllTempArtifacts
 * @param {() => void} [deps.clearTimers]
 * @param {object} deps.logger
 * @param {(code: number) => void} [deps.exit] - injectable so the sequence can
 *   be exercised directly; defaults to ending this process.
 */
export function createShutdownHandler({
  getServer,
  activeProcesses,
  updateJob,
  getJob,
  releaseAllTempArtifacts,
  clearTimers,
  logger,
  exit = (code) => process.exit(code)
}) {
  let shuttingDown = false;

  /**
   * Logging must never decide whether cleanup happens.
   *
   * Every step below guards its own failure, but the logger calls sat outside
   * those guards: a throw from one (EPIPE on a closed stdout during container
   * teardown is the realistic trigger) unwound out of this function, was
   * swallowed by the caller, and exited 0 with step 4 — the credential
   * release — never reached. That is precisely the outcome L4 exists to
   * prevent, defeated by a non-security failure.
   */
  const log = (level, ...args) => {
    try {
      logger[level](...args);
    } catch {
      // Nothing can be reported here: the reporting channel is what failed.
    }
  };

  return function shutdown(signal) {
    if (shuttingDown) {
      // A repeat signal is an operator saying "stop now". The first pass has
      // already done the synchronous cleanup, so there is nothing to protect
      // and nothing to redo.
      log("warn", { tag: "shutdown", signal }, "Repeat shutdown signal; exiting now");
      exit(0);
      return;
    }
    shuttingDown = true;

    // Every step below guards its own failure, but the logger calls are not
    // inside any of them. A throw from one would escape the signal callback as
    // an uncaught exception, exit non-zero with artifacts unreleased — and
    // because `shuttingDown` has already latched, a repeat signal would take
    // the fast path and never retry. Terminating is the one thing that must
    // happen no matter what, so it owns the `finally`.
    try {
      runShutdownSteps(signal);
    } catch {
      // Deliberately swallowed, and deliberately not logged: every step
      // guards itself, so the only way to land here is the reporting channel
      // itself failing. Rethrowing would surface as an uncaught exception in
      // a signal handler — a non-zero exit that tells an operator the
      // shutdown broke, when the only thing that broke was a log write.
    } finally {
      exit(0);
    }
  };


  function runShutdownSteps(signal) {
    log("info", { tag: "shutdown", signal }, "Shutting down");

    // 1. Stop accepting new work. This closes the listening socket; it is not
    //    awaited, because its callback waits on connections that outlive the
    //    server.
    try {
      getServer()?.close();
    } catch (err) {
      log("debug", { err, tag: "shutdown" }, "Closing listener failed");
    }

    // 2. Stop timers so nothing new is scheduled behind us. The outcome is
    //    reported below: the retention interval lives inside the `app.listen`
    //    callback, which never runs under NODE_ENV=test, so a log field is
    //    the only way a test can observe that it was actually cleared.
    let timersCleared = false;
    try {
      clearTimers?.();
      timersCleared = true;
    } catch (err) {
      log("debug", { err, tag: "shutdown" }, "Clearing timers failed");
    }

    // 3. Signal tracked children, and record the cancellation ourselves. Their
    //    own `close` handlers would have done this, but they will not run.
    let signalled = 0;
    for (const [jobId, child] of activeProcesses.entries()) {
      try {
        child.kill("SIGTERM");
        signalled += 1;
      } catch (err) {
        log("debug", { err, tag: "shutdown", jobId }, "Kill child process failed during shutdown");
      }
      try {
        // A child can finish between its last status write and this loop —
        // its `close` handler removes it from the registry, but if that has
        // not run yet the entry is still here. Relabelling a job that already
        // completed or failed would destroy the real outcome, so only a job
        // that is still open gets cancelled.
        const current = getJob?.(jobId);
        if (current && isTerminalJobStatus(current.status)) {
          log("debug", {
            tag: "shutdown",
            jobId,
            status: current.status
          }, "Job already terminal; leaving its outcome intact");
        } else {
          updateJob(jobId, {
            // progress 0 matches the other two cancellation writers (Start
            // Over and the Stop route); the UI reads this field.
            status: "cancelled",
            progress: 0,
            message: `Cancelled: backend shut down (${signal}).`
          });
        }
      } catch (err) {
        // Bookkeeping must never block termination.
        log("debug", { err, tag: "shutdown", jobId }, "Recording job cancellation failed");
      }
    }
    activeProcesses.clear();

    // 4. Remove the temporary artifacts those children owned — registry auth
    //    files above all — plus any export staging still outstanding.
    let artifacts = { released: 0, failed: 0, byLabel: {}, failures: [] };
    try {
      artifacts = releaseAllTempArtifacts();
    } catch (err) {
      log("error", { err, tag: "shutdown" }, "Temporary artifact cleanup failed");
    }
    if (artifacts.failed > 0) {
      log("warn", {
        tag: "shutdown",
        failed: artifacts.failed,
        failures: artifacts.failures
      }, "Some temporary artifacts could not be removed");
    }

    // Counts and categories only: never the contents of a credential file.
    log("info", {
      tag: "shutdown",
      signal,
      timersCleared,
      childrenSignalled: signalled,
      artifactsReleased: artifacts.released,
      artifactsFailed: artifacts.failed,
      artifactsByLabel: artifacts.byLabel
    }, "Shutdown cleanup complete");

    // 5. SQLite (better-sqlite3) commits synchronously, so everything written
    //    above is already durable. The caller's `finally` terminates.
  }
}
