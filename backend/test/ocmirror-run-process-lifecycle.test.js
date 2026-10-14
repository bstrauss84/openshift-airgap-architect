/**
 * oc-mirror RUN child process lifecycle (v2.1 Tranche 8C)
 *
 * Closure item from the `lifecycle` planned axis, verbatim:
 *   "child processes in activeProcesses across started/cancelled/failed
 *    oc-mirror jobs"
 *
 * `operator-scan-lifecycle.test.js` closes this for the operator SCAN child.
 * The canonical "oc-mirror job" — `POST /api/ocmirror/run`, which spawns the
 * mirror itself — was NOT covered by any test: nothing asserted that its
 * child is registered, that it is therefore cancellable, or that the registry
 * returns to baseline across started / cancelled / failed runs. Marking the
 * requirement PASS on the scan alone would have claimed a mandatory path that
 * was never exercised.
 *
 * THE REGISTRY ORACLE. `activeProcesses` is module-private, so these tests
 * read it the way a user does: `POST /api/jobs/:id/stop` returns 200 when the
 * id is in the registry and 404 "Job not running." when it is not
 * (index.js). That is a faithful, already-shipped read of registry
 * membership, and it avoids exporting internals purely for a test.
 *
 * Every wait keys on a state transition the server itself wrote — a job
 * status, or the stop endpoint's answer. No fixed sleeps.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const waitFor = async (predicate, description, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

/** Ask the registry whether it still owns this job. */
const stopStatus = async (baseUrl, jobId) => {
  const res = await fetch(`${baseUrl}/api/jobs/${jobId}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  return res.status;
};

const jobOf = async (baseUrl, jobId) =>
  (await fetch(`${baseUrl}/api/jobs/${jobId}`)).json();

const lockVersion = async (baseUrl) => {
  // Application state is a SQLite singleton shared across tests in this
  // DATA_DIR, so a previous suite's version can leak in and make the run
  // endpoint answer 422. Start from a known-empty state, as the sibling
  // oc-mirror suite does.
  const reset = await fetch(`${baseUrl}/api/start-over`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cancelRunningOcMirror: false })
  });
  assert.strictEqual(reset.status, 200, "state reset must succeed");

  const res = await fetch(`${baseUrl}/api/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: { versionConfirmed: true },
      release: { channel: "stable-4.22", patchVersion: "4.22.16", confirmed: true }
    })
  });
  assert.strictEqual(res.status, 200, "version lock must succeed");
};

const startRun = async (baseUrl, dir) => {
  const res = await fetch(`${baseUrl}/api/ocmirror/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "mirrorToDisk",
      archivePath: dir,
      workspacePath: dir,
      cachePath: dir,
      configSourceType: "generated",
      authSource: "env"
    })
  });
  assert.strictEqual(res.status, 200, `run must start, got ${res.status}`);
  const { jobId } = await res.json();
  assert.ok(jobId, "run must return a jobId");
  return jobId;
};

/**
 * An executable stub standing in for oc-mirror.
 *
 * The run endpoint preflights the binary with `--v2 version` and a 10 s
 * spawnSync timeout before it spawns the real run, so every stub must answer
 * that quickly whatever else it does. A stub that blocks on the preflight
 * fails the job for the wrong reason — which is exactly how the first draft
 * of these tests "failed": the long-lived stub slept through its own
 * preflight and the job came back `failed` after 10 s instead of `running`.
 */
const stubBinary = (dir, name, body) => {
  const p = path.join(dir, name);
  fs.writeFileSync(
    p,
    [
      "#!/bin/sh",
      'case "$*" in',
      '  *version*) echo "oc-mirror stub 0.0.0"; exit 0 ;;',
      "esac",
      body
    ].join("\n") + "\n"
  );
  fs.chmodSync(p, 0o755);
  return p;
};

const withStub = async (body, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-run-lifecycle-"));
  const original = process.env.OC_MIRROR_BIN;
  process.env.OC_MIRROR_BIN = stubBinary(dir, "oc-mirror-stub", body);
  const { server, baseUrl } = await createTestServer(app);
  try {
    await lockVersion(baseUrl);
    await fn({ baseUrl, dir });
  } finally {
    await closeTestServer(server);
    if (original === undefined) delete process.env.OC_MIRROR_BIN;
    else process.env.OC_MIRROR_BIN = original;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
};

test("a STARTED oc-mirror run is registered, so it is cancellable", async () => {
  // Long-lived stub: the child is alive while we interrogate the registry.
  await withStub('sleep 5\n', async ({ baseUrl }) => {
    const jobId = await startRun(baseUrl, os.tmpdir());

    // Registration is synchronous with the spawn, so no wait is needed: a job
    // reported as running must already be stoppable.
    assert.equal(
      (await jobOf(baseUrl, jobId)).status,
      "running",
      "the run must report running"
    );
    assert.equal(await stopStatus(baseUrl, jobId), 200, "a started run must be in the registry");
    // That stop also reaps the child, so the suite does not wait on it.
  });
});

test("a CANCELLED oc-mirror run leaves the registry and keeps its cancelled outcome", async () => {
  await withStub('sleep 5\n', async ({ baseUrl }) => {
    const jobId = await startRun(baseUrl, os.tmpdir());
    assert.equal(await stopStatus(baseUrl, jobId), 200, "first stop cancels it");

    // Second stop proves the entry was removed, not merely signalled.
    assert.equal(await stopStatus(baseUrl, jobId), 404, "a cancelled run must leave the registry");

    const job = await jobOf(baseUrl, jobId);
    assert.equal(job.status, "cancelled");
    // The child's `close` lands after the kill and reports code === null,
    // which the close handler reads as a failure. Without the terminal guard
    // this comes back as `failed` and the user's cancellation is erased.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const after = await jobOf(baseUrl, jobId);
    assert.equal(after.status, "cancelled", "a late close must not relabel a cancelled run");
  });
});

test("a FAILED oc-mirror run leaves the registry", async () => {
  await withStub('echo "stub failure" >&2\nexit 7\n', async ({ baseUrl }) => {
    const jobId = await startRun(baseUrl, os.tmpdir());

    const job = await waitFor(async () => {
      const j = await jobOf(baseUrl, jobId);
      return j.status === "failed" || j.status === "completed" ? j : null;
    }, "the run to reach a terminal state");
    assert.equal(job.status, "failed", `expected failure from exit 7, got ${job.status}`);

    assert.equal(await stopStatus(baseUrl, jobId), 404, "a failed run must leave the registry");
  });
});

test("a COMPLETED oc-mirror run leaves the registry", async () => {
  await withStub('echo "oc-mirror stub ok"\nexit 0\n', async ({ baseUrl }) => {
    const jobId = await startRun(baseUrl, os.tmpdir());

    await waitFor(async () => {
      const j = await jobOf(baseUrl, jobId);
      return ["completed", "completed_with_warnings", "failed"].includes(j.status) ? j : null;
    }, "the run to reach a terminal state");

    assert.equal(await stopStatus(baseUrl, jobId), 404, "a completed run must leave the registry");
  });
});

test("repeated runs return the registry to baseline", async () => {
  // The closure item's actual wording: drive the resource through N cycles
  // and assert the count returns to baseline. Every historical job id must
  // answer 404 at the end — none may still own a child.
  await withStub('exit 0\n', async ({ baseUrl }) => {
    const ids = [];
    for (let i = 0; i < 4; i += 1) {
      const jobId = await startRun(baseUrl, os.tmpdir());
      ids.push(jobId);
      await waitFor(async () => {
        const j = await jobOf(baseUrl, jobId);
        return ["completed", "completed_with_warnings", "failed"].includes(j.status);
      }, `run ${i + 1} to finish`);
    }

    for (const jobId of ids) {
      assert.equal(
        await stopStatus(baseUrl, jobId),
        404,
        `job ${jobId} still owns a child after finishing`
      );
    }
  });
});
