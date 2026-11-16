/**
 * Operator-scan process lifecycle (v2.1 Tranche 8C, finding L3)
 *
 * `runScanJob` spawns oc-mirror from operators.js — the one spawn site that
 * lives outside index.js, where the `activeProcesses` registry used to be a
 * module-local Map. The scan child was therefore invisible to everything that
 * reads that registry:
 *
 *   - `POST /api/jobs/:id/stop` answered 404 "Job not running." for every
 *     catalog scan, while the job row said `running` and the child kept
 *     pulling;
 *   - the shutdown sequence never signalled it and never recorded its fate;
 *   - nothing ever timed it out.
 *
 * Two further defects shared one cause — more than one path could write a
 * job's outcome. Node emits BOTH `error` and `close` for a failed spawn, so
 * the generic `close` message overwrote the ENOENT diagnostic and replaced
 * the output with an empty string; and a late `close` relabelled a
 * `cancelled` job `failed`.
 *
 * Everything here uses real fixture children (node one-liners) and disposable
 * temp files. No registry credentials, no catalog images, no network, and no
 * fixed sleeps — every wait keys on an observable transition.
 */

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runScanJob, createSharedAuthRelease, getResults } from "../src/operators.js";
import { setCatalogOpenerForTests } from "../src/verifiedCatalog.js";
import { activeProcesses } from "../src/processRegistry.js";
import { isTerminalJobStatus, TERMINAL_JOB_STATUSES } from "../src/jobStatus.js";
import { getJob, updateJob, writeTempAuth, safeUnlink } from "../src/utils.js";
import { listTempArtifacts, releaseAllTempArtifacts } from "../src/tempArtifacts.js";
import { createShutdownHandler } from "../src/shutdown.js";

// These tests drive oc-mirror stand-ins; the verified catalog fetch is
// covered by verified-catalog-fetch.test.js. The catalog name is passed
// through so the stand-ins see what they always saw.
setCatalogOpenerForTests(async (image) => ({ localReference: image, resolvedDigest: `sha256:${"d".repeat(64)}`, manifestDigest: `sha256:${"d".repeat(64)}`, fetchedAt: Date.now(), close: async () => {} }));

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

let scratch;

/** Write an executable node script that stands in for the oc-mirror binary. */
const fixtureBinary = (name, body) => {
  const scriptPath = path.join(scratch, `${name}.js`);
  fs.writeFileSync(scriptPath, body);
  const shimPath = path.join(scratch, name);
  fs.writeFileSync(shimPath, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`, { mode: 0o755 });
  return shimPath;
};

/**
 * A stand-in oc-mirror that IGNORES SIGTERM, ready in single-digit milliseconds.
 *
 * WHY THIS IS NOT A NODE SCRIPT. The escalation test gives the child 50ms
 * before SIGTERM. A node fixture cannot install `process.on('SIGTERM')` until
 * the runtime has booted, and node's boot does not fit in 50ms on a loaded
 * machine — so SIGTERM arrived while the default disposition was still in
 * effect, the child died of SIGTERM, and the test reported "expected SIGKILL,
 * received SIGTERM" as though the production escalation were broken. It is
 * not: measured over 20 runs with every core saturated, the node fixture lost
 * this race 5 times, and 0 times idle.
 *
 * A POSIX shell installs `trap` before it has done anything else. Measured
 * under the same saturated load: ready in 3-8ms, 0/20 races. The margin is
 * ~6x rather than negative.
 *
 * The fixture also touches a sentinel file the moment the trap is armed, so
 * readiness is OBSERVED by the test rather than assumed. If this ever regresses
 * the suite says "the fixture never became ready", which is the true cause,
 * instead of blaming the signal escalation it was written to prove.
 */
const stubbornFixture = (name) => {
  const readyPath = path.join(scratch, `${name}.ready`);
  const shimPath = path.join(scratch, name);
  fs.writeFileSync(
    shimPath,
    `#!/bin/sh\ntrap '' TERM\n: > "${readyPath}"\nwhile :; do sleep 1; done\n`,
    { mode: 0o755 },
  );
  return { shimPath, readyPath };
};

const waitFor = async (predicate, description, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const waitForTerminal = (jobId) =>
  waitFor(() => {
    const job = getJob(jobId);
    return job && isTerminalJobStatus(job.status) ? job : null;
  }, `job ${jobId} to reach a terminal state`);

/** The oc-mirror child, once the (stand-in) verified catalog fetch has handed over to it. */
const waitForChild = async (jobId) => {
  await waitFor(() => typeof activeProcesses.get(jobId)?.on === "function", `job ${jobId} to start its oc-mirror child`);
  return activeProcesses.get(jobId);
};

const waitForDeregistration = (jobId) =>
  waitFor(() => !activeProcesses.has(jobId), `job ${jobId} to leave the process registry`);

describe("Operator scan process ownership", () => {
  before(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-l3-"));
  });

  after(() => {
    for (const [, child] of activeProcesses) {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }
    activeProcesses.clear();
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  });

  beforeEach(() => {
    activeProcesses.clear();
  });

  const startScan = (overrides = {}) =>
    runScanJob({
      version: "4.22",
      catalogId: "redhat",
      catalogImage: "registry.example.test/redhat-operator-index:v4.22",
      ...overrides
    });

  it("registers its child under the job id, and deregisters when it exits", async () => {
    const jobId = startScan({ ocMirrorPath: fixtureBinary("quick-exit", "// exits 0 as soon as the script ends\n") });

    // Registration is synchronous with the spawn, so there is nothing to wait
    // for here: a job that reports `running` must already be stoppable.
    assert.ok(activeProcesses.has(jobId), "the scan child must be in the registry immediately");
    assert.equal(getJob(jobId).status, "running");

    await waitForDeregistration(jobId);
    assert.equal(activeProcesses.size, 0, "the registry must return to baseline");
  });

  it("records a spawn failure with its real diagnostic, not a generic message", async () => {
    const jobId = startScan({ ocMirrorPath: path.join(scratch, "does-not-exist-oc-mirror") });

    const job = await waitForTerminal(jobId);

    assert.equal(job.status, "failed");
    // Node emits `error` and then `close`. The close handler used to win and
    // replace this with "oc-mirror failed (redhat)." and an empty output.
    assert.match(job.message, /failed to start/i, `got: ${job.message}`);
    assert.match(job.message, /ENOENT/, "the underlying spawn error must survive");
    assert.ok(job.output && job.output.length > 0, "the diagnostic must reach the output column");
    await waitForDeregistration(jobId);
  });

  it("preserves the architecture-mismatch guidance", async () => {
    const archFailure = fixtureBinary(
      "arch-mismatch",
      "process.stderr.write('oc-mirror: /lib64/ld-linux-x86-64.so.2: bad ELF interpreter');process.exitCode = 1;"
    );
    const jobId = startScan({ ocMirrorPath: archFailure });

    const job = await waitForTerminal(jobId);

    assert.equal(job.status, "failed");
    assert.match(job.message, /not compatible with this container's CPU architecture/);
    assert.match(job.message, /OC_MIRROR_BIN/, "the actionable remedy must be preserved");
  });

  it("completes and caches results on the success path", async () => {
    const goodScan = fixtureBinary(
      "good-scan",
      "process.stdout.write('NAME  DISPLAY NAME  DEFAULT CHANNEL\\nfoo   Foo Operator  stable\\n');"
    );
    const jobId = startScan({ version: "4.21", catalogId: "certified", ocMirrorPath: goodScan });

    const job = await waitForTerminal(jobId);

    assert.equal(job.status, "completed", `got ${job.status}: ${job.message}`);
    assert.equal(job.progress, 100);
    const cached = getResults("4.21", "certified");
    assert.ok(cached, "a successful scan must cache its results");
    assert.ok(cached.results.some((r) => r.name === "foo"), "the parsed operator must be stored");
  });

  it("times out a scan that never finishes, and the child actually dies", async () => {
    const neverExits = fixtureBinary("never-exits", "setInterval(() => {}, 1000);");
    const jobId = startScan({ ocMirrorPath: neverExits, timeoutMs: 50 });
    const child = await waitForChild(jobId);
    assert.ok(child, "precondition: the scan is registered");
    const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));

    const job = await waitForTerminal(jobId);

    assert.equal(job.status, "failed");
    assert.match(job.message, /timed out/i);
    // Asserted on the child, not just on the job row: a job marked failed
    // while oc-mirror keeps pulling is the failure mode, not the fix.
    assert.equal((await exited).signal, "SIGTERM");
    await waitForDeregistration(jobId);
  });

  it("escalates to SIGKILL when a timed-out scan ignores SIGTERM", async () => {
    // A cooperative child cannot catch this: oc-mirror can ignore SIGTERM
    // while mid-write, and nothing else in the codebase escalates. Without
    // escalation the job says `failed` while the child keeps running, and
    // shutdown only re-sends the same ignored signal.
    const { shimPath: stubborn, readyPath } = stubbornFixture("ignores-sigterm");
    const jobId = startScan({
      ocMirrorPath: stubborn,
      timeoutMs: 50,
      sigkillAfterMs: 150
    });
    const child = await waitForChild(jobId);
    assert.ok(child, "precondition: the scan is registered");
    const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));

    // OBSERVED readiness, not an assumed head start. The whole test is
    // meaningless if SIGTERM lands before the child is ignoring it, so that
    // precondition is proven rather than hoped for — and if it ever stops
    // holding, this is the assertion that fails, naming the real cause.
    await waitFor(() => fs.existsSync(readyPath), "the stubborn fixture to arm its SIGTERM trap", 5000);

    const job = await waitForTerminal(jobId);
    assert.equal(job.status, "failed");
    assert.match(job.message, /timed out/i);

    // Raced against a deadline: without the escalation this await never
    // settles, and the suite wedges with no TAP output and a leaked process
    // instead of reporting a failure. A regression must be legible in CI.
    const result = await Promise.race([
      exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("child never exited: SIGTERM was ignored and nothing escalated")), 10000)
      )
    ]);
    assert.equal(result.signal, "SIGKILL", "a child that ignores SIGTERM must be killed");
    await waitForDeregistration(jobId);
    assert.equal(activeProcesses.size, 0, "and the registry must not retain it");
  });

  it("reports a sub-second timeout limit without claiming zero seconds", async () => {
    const neverExits = fixtureBinary("never-exits-ms", "setInterval(() => {}, 1000);");
    const jobId = startScan({ ocMirrorPath: neverExits, timeoutMs: 50 });

    const job = await waitForTerminal(jobId);
    assert.match(job.message, /timed out after 50ms/, `got: ${job.message}`);
    await waitForDeregistration(jobId);
  });

  it("a cancelled scan stays cancelled when its child's close handler lands", async () => {
    const neverExits = fixtureBinary("cancel-target", "setInterval(() => {}, 1000);");
    const jobId = startScan({ version: "4.20", catalogId: "community", ocMirrorPath: neverExits });

    // What POST /api/jobs/:id/stop does, minus its own registry delete: the
    // child's `close` handler owns that, and watching for it is how this test
    // knows the late callback has actually run without waiting on a clock.
    const child = await waitForChild(jobId);
    assert.ok(child, "precondition: the scan must be cancellable at all");
    child.kill("SIGTERM");
    updateJob(jobId, { status: "cancelled", message: "Stopped by user.", progress: 0 });

    await waitForDeregistration(jobId); // the close handler has now run

    const job = getJob(jobId);
    assert.equal(job.status, "cancelled", "a late close must not relabel a cancelled job");
    assert.equal(job.message, "Stopped by user.");
    assert.equal(
      getResults("4.20", "community"),
      null,
      "a cancelled scan must not cache a truncated catalog"
    );
  });

  it("shutdown signals a scan child, records it, and releases its credential", async () => {
    const neverExits = fixtureBinary("shutdown-target", "setInterval(() => {}, 1000);");
    const authFile = writeTempAuth("{\"auths\":{\"registry.example.test\":{}}}");
    const jobId = startScan({ ocMirrorPath: neverExits, authFile });

    const child = await waitForChild(jobId);
    assert.ok(child, "the scan must be visible to shutdown");
    const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));

    const exits = [];
    const shutdown = createShutdownHandler({
      getServer: () => undefined,
      activeProcesses,
      updateJob,
      getJob,
      releaseAllTempArtifacts,
      clearTimers: () => {},
      logger: silentLogger,
      exit: (code) => exits.push(code)
    });
    shutdown("SIGTERM");

    assert.deepEqual(exits, [0]);
    assert.equal((await exited).signal, "SIGTERM", "the scan child must be reaped");
    assert.equal(getJob(jobId).status, "cancelled", "its fate must be recorded, not lost");
    assert.equal(fs.existsSync(authFile), false, "its pull secret must not survive");
    assert.deepEqual(
      listTempArtifacts().filter((a) => a.path === authFile),
      [],
      "and it must be deregistered"
    );
  });

  it("a fast scan must not delete the credential a slow sibling is still using", async () => {
    // One pull secret serves every catalog in a scan request. Since v2.2.0 M7 it is
    // used by OAA's verified catalog fetch only (oc-mirror lists a loopback
    // copy without it), so it must outlive every sibling's FETCH — and nothing
    // longer. Reverting to a per-scan unlink fails the first assertion.
    const authFile = writeTempAuth("{\"auths\":{\"registry.example.test\":{}}}");
    const release = createSharedAuthRelease(authFile, 2);
    let finishSlowFetch;
    const slowFetch = new Promise((r) => { finishSlowFetch = r; });
    const resolver = (wait) => async (image) => { await wait; return { localReference: image, resolvedDigest: `sha256:${"e".repeat(64)}`, manifestDigest: `sha256:${"e".repeat(64)}`, fetchedAt: Date.now(), close: async () => {} }; };

    const slow = startScan({
      catalogId: "certified",
      ocMirrorPath: fixtureBinary("shared-slow", "setTimeout(() => {}, 1500);"),
      authFile,
      onSettled: release,
      catalogResolver: resolver(slowFetch)
    });
    const fast = startScan({
      catalogId: "redhat",
      ocMirrorPath: fixtureBinary("shared-fast", "// exits immediately\n"),
      authFile,
      onSettled: release,
      catalogResolver: resolver(Promise.resolve())
    });

    await waitForTerminal(fast);
    assert.equal(fs.existsSync(authFile), true, "the first catalog to finish must not delete a credential its sibling's fetch still needs");

    finishSlowFetch();
    await waitForChild(slow);
    await waitFor(() => !fs.existsSync(authFile), "the credential to be released once every fetch is done");
    assert.notEqual(getJob(slow).status, "completed", "released while oc-mirror is still running: it never needed the credential");
    assert.deepEqual(listTempArtifacts().filter((a) => a.path === authFile), [], "and it must be deregistered once released");
    await waitForTerminal(slow);
  });

  it("stopping during the verified fetch cancels the job; oc-mirror never starts", async () => {
    const marker = path.join(scratch, "fetch-stop-spawned");
    let aborted = false;
    const jobId = startScan({
      ocMirrorPath: fixtureBinary("must-not-run", `require("fs").writeFileSync(${JSON.stringify(marker)}, "x");`),
      catalogResolver: (_image, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => { aborted = true; reject(Object.assign(new Error("Stopped."), { code: "ABORTED" })); });
      })
    });
    const handle = activeProcesses.get(jobId);
    assert.ok(handle, "the fetch phase must be stoppable");
    handle.kill("SIGTERM");
    activeProcesses.delete(jobId);
    updateJob(jobId, { status: "cancelled", message: "Stopped by user.", progress: 0 });
    await waitFor(() => aborted, "the fetch to be aborted");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(getJob(jobId).status, "cancelled");
    assert.equal(fs.existsSync(marker), false);
    assert.equal(activeProcesses.has(jobId), false);
  });

  it("a job cancelled while its fetch finishes leaves nothing registered and spawns nothing", async () => {
    // Shutdown marks jobs cancelled without removing the registry entry. The
    // fetch then completing must not leave its handle behind (it did once).
    const marker = path.join(scratch, "late-fetch-spawned");
    let finish;
    const jobId = startScan({
      ocMirrorPath: fixtureBinary("late-must-not-run", `require("fs").writeFileSync(${JSON.stringify(marker)}, "x");`),
      catalogResolver: (image) => new Promise((r) => { finish = () => r({ localReference: image, resolvedDigest: `sha256:${"f".repeat(64)}`, manifestDigest: `sha256:${"f".repeat(64)}`, fetchedAt: Date.now(), close: async () => {} }); })
    });
    updateJob(jobId, { status: "cancelled", message: "Server shutdown.", progress: 0 });
    finish();
    await waitForDeregistration(jobId);
    assert.equal(getJob(jobId).status, "cancelled");
    assert.equal(fs.existsSync(marker), false);
  });

  it("leaves a mounted REGISTRY_AUTH_FILE alone", async () => {
    const mounted = path.join(scratch, "mounted-auth.json");
    fs.writeFileSync(mounted, "{\"auths\":{}}");
    const saved = process.env.REGISTRY_AUTH_FILE;
    process.env.REGISTRY_AUTH_FILE = mounted;

    let jobId;
    try {
      // No `authFile`: this is the prefetch shape, where the operator supplies
      // the credential and it is emphatically not ours to delete.
      jobId = startScan({ ocMirrorPath: fixtureBinary("mounted-auth-exit", "// exits 0 as soon as the script ends\n") });
      await waitForTerminal(jobId);
    } finally {
      if (saved === undefined) delete process.env.REGISTRY_AUTH_FILE;
      else process.env.REGISTRY_AUTH_FILE = saved;
    }

    assert.equal(fs.existsSync(mounted), true, "a mounted credential must never be unlinked");
    assert.deepEqual(
      listTempArtifacts().filter((a) => a.path === mounted),
      [],
      "and it must never have been tracked as ours"
    );
  });
});

describe("Shared scan credential ownership", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-l3-auth-"));
  });

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("releases only after the last catalog settles", () => {
    const authFile = path.join(dir, "registry-auth-shared.json");
    fs.writeFileSync(authFile, "{\"auths\":{}}");
    const release = createSharedAuthRelease(authFile, 3);

    release();
    assert.equal(fs.existsSync(authFile), true, "still in use by two more scans");
    release();
    assert.equal(fs.existsSync(authFile), true, "still in use by one more scan");
    release();
    assert.equal(fs.existsSync(authFile), false, "the last scan releases it");
  });

  it("is safe to over-release and safe with no credential at all", () => {
    const authFile = path.join(dir, "registry-auth-extra.json");
    fs.writeFileSync(authFile, "{}");
    const release = createSharedAuthRelease(authFile, 1);
    release();
    assert.doesNotThrow(() => release());

    const noop = createSharedAuthRelease(null, 3);
    assert.doesNotThrow(() => { noop(); noop(); noop(); noop(); });
  });
});

describe("Terminal job status vocabulary", () => {
  it("covers every state a completed job can be in", () => {
    for (const status of ["completed", "completed_with_warnings", "failed", "cancelled"]) {
      assert.equal(isTerminalJobStatus(status), true, `${status} must be terminal`);
    }
    for (const status of ["running", "pending", undefined, null, ""]) {
      assert.equal(isTerminalJobStatus(status), false, `${String(status)} must not be terminal`);
    }
    assert.equal(TERMINAL_JOB_STATUSES.size, 4);
  });
});
