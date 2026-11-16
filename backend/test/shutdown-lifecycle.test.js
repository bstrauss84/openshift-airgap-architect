/**
 * Shutdown and temporary-credential lifecycle (v2.1 Tranche 8C, finding L4)
 *
 * Every temporary artifact this backend creates is cleaned up by the operation
 * that created it — from a child process's `close` handler, an archive
 * stream's `finally`, or a request's error path. All of those are
 * asynchronous, and the shutdown handler ended the process in the same tick as
 * it signalled the children. None of them ran.
 *
 * For jobs that cost fidelity rather than data: `markStaleJobs()` at startup
 * already rewrites every surviving `running` row to `failed` / "Server
 * restarted; job marked stale.", so an interrupted job was misdiagnosed — a
 * cancelled run, and even one that had succeeded without writing its status,
 * both came back as a failure. For temporary files it cost real exposure:
 * registry pull secrets stayed in `DATA_DIR/tmp`, a persistent volume.
 *
 * Exiting promptly is still right: `server.close()` never calls back while
 * undici holds ref'd sockets, and the shipped compose profile allows
 * `stop_grace_period: 3s`, of which `runuser` (PID 1 in the backend image)
 * spends ~2s after node exits. Measured on the reference host: SIGTERM to the
 * container does reach node's handler (logged at pid 3) and the container
 * terminates in ~2s with exit code 143. So the fix is not to wait — it is to
 * do the callbacks' work synchronously before exiting.
 *
 * These tests use fixture child processes and disposable temporary files. No
 * real credentials, container images or network access.
 */

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  trackTempArtifact,
  untrackTempArtifact,
  listTempArtifacts,
  releaseAllTempArtifacts,
  resetTempArtifactTracking
} from "../src/tempArtifacts.js";
import { createShutdownHandler } from "../src/shutdown.js";

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** A child that ignores nothing and stays alive until signalled. */
const spawnFixtureChild = () =>
  spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });

const waitFor = async (predicate, description, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe("Owned temporary artifact registry", () => {
  let scratch;

  beforeEach(() => {
    resetTempArtifactTracking();
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-l4-reg-"));
  });

  afterEach(() => {
    resetTempArtifactTracking();
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  });

  it("releases tracked files and directories synchronously", () => {
    const file = path.join(scratch, "registry-auth.json");
    const dir = path.join(scratch, "registries.d");
    fs.writeFileSync(file, "{\"auths\":{}}", { mode: 0o600 });
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "nested.yaml"), "x");

    trackTempArtifact(file, "file", "registry-auth");
    trackTempArtifact(dir, "dir", "registries-d");

    const summary = releaseAllTempArtifacts();

    assert.equal(summary.released, 2);
    assert.equal(summary.failed, 0);
    assert.deepEqual(summary.byLabel, { "registry-auth": 1, "registries-d": 1 });
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(dir), false, "a tracked directory must be removed recursively");
    assert.deepEqual(listTempArtifacts(), []);
  });

  it("does not release what its owner already cleaned up", () => {
    const file = path.join(scratch, "owned.json");
    fs.writeFileSync(file, "x");
    trackTempArtifact(file, "file", "registry-auth");

    assert.equal(untrackTempArtifact(file), true);
    assert.deepEqual(listTempArtifacts(), []);

    const summary = releaseAllTempArtifacts();
    assert.equal(summary.released, 0);
    assert.equal(fs.existsSync(file), true, "untracked paths must be left alone");
  });

  it("tolerates a tracked path that has already vanished", () => {
    const file = path.join(scratch, "gone.json");
    fs.writeFileSync(file, "x");
    trackTempArtifact(file, "file", "registry-auth");
    fs.rmSync(file);

    const summary = releaseAllTempArtifacts();
    assert.equal(summary.failed, 0, "an already-removed artifact is not a failure");
    assert.equal(summary.released, 1);
  });

  it("reports a removal it could not perform, and keeps it tracked for retry", (t) => {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      t.skip("cannot provoke EACCES as root");
      return;
    }
    const locked = path.join(scratch, "locked");
    fs.mkdirSync(locked);
    fs.writeFileSync(path.join(locked, "child"), "x");
    trackTempArtifact(path.join(locked, "child"), "file", "registry-auth");
    fs.chmodSync(locked, 0o500);

    let summary;
    try {
      summary = releaseAllTempArtifacts();
    } finally {
      fs.chmodSync(locked, 0o700);
    }

    assert.equal(summary.released, 0);
    assert.equal(summary.failed, 1);
    assert.equal(summary.failures[0].code, "EACCES");
    assert.equal(summary.failures[0].label, "registry-auth");
    assert.equal(listTempArtifacts().length, 1, "a failed removal must stay tracked");

    // And a retry, once the obstruction is gone, succeeds.
    assert.equal(releaseAllTempArtifacts().released, 1);
    assert.deepEqual(listTempArtifacts(), []);
  });

  it("ignores values that are not usable paths", () => {
    trackTempArtifact("", "file", "x");
    trackTempArtifact(null, "file", "x");
    trackTempArtifact(undefined, "dir", "x");
    assert.deepEqual(listTempArtifacts(), []);
    assert.equal(untrackTempArtifact(null), false);
  });
});

describe("Shutdown sequence", () => {
  let scratch;
  let children;

  beforeEach(() => {
    resetTempArtifactTracking();
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-l4-shut-"));
    children = [];
  });

  afterEach(() => {
    for (const child of children) {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }
    resetTempArtifactTracking();
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  });

  const harness = (overrides = {}) => {
    const calls = { exits: [], closed: 0, timersCleared: 0, jobUpdates: [] };
    const activeProcesses = overrides.activeProcesses ?? new Map();
    const shutdown = createShutdownHandler({
      getServer: () => ({ close() { calls.closed += 1; } }),
      activeProcesses,
      updateJob: overrides.updateJob ?? ((id, patch) => calls.jobUpdates.push({ id, patch })),
      getJob: overrides.getJob,
      releaseAllTempArtifacts: overrides.releaseAllTempArtifacts ?? releaseAllTempArtifacts,
      clearTimers: overrides.clearTimers ?? (() => { calls.timersCleared += 1; }),
      logger: silentLogger,
      exit: (code) => calls.exits.push(code)
    });
    return { shutdown, calls, activeProcesses };
  };

  it("stops the listener, clears timers, and exits zero exactly once", () => {
    const { shutdown, calls } = harness();

    shutdown("SIGTERM");

    assert.equal(calls.closed, 1, "the listening socket must be closed");
    assert.equal(calls.timersCleared, 1, "outstanding timers must be cleared");
    assert.deepEqual(calls.exits, [0]);
  });

  it("signals tracked children and records their cancellation", async () => {
    const child = spawnFixtureChild();
    children.push(child);
    const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));

    const activeProcesses = new Map([["job-1", child]]);
    const { shutdown, calls } = harness({ activeProcesses });

    shutdown("SIGTERM");

    const result = await exited;
    assert.equal(result.signal, "SIGTERM", "the child must actually receive SIGTERM");

    assert.equal(calls.jobUpdates.length, 1, "the job's fate must be recorded, not lost");
    assert.equal(calls.jobUpdates[0].id, "job-1");
    assert.equal(calls.jobUpdates[0].patch.status, "cancelled");
    assert.match(calls.jobUpdates[0].patch.message, /shut down/i);
    assert.equal(activeProcesses.size, 0, "the registry must be emptied");
  });

  it("does not relabel a job that already reached a terminal state", () => {
    // A child can finish between its last status write and the shutdown loop:
    // its `close` handler removes it from the registry, but until that runs
    // the entry is still there. Overwriting a real outcome with "cancelled"
    // would destroy the only record of it.
    const finished = spawnFixtureChild();
    const running = spawnFixtureChild();
    children.push(finished, running);

    const statuses = { "job-done": "completed", "job-live": "running" };
    const { shutdown, calls } = harness({
      activeProcesses: new Map([["job-done", finished], ["job-live", running]]),
      getJob: (id) => ({ status: statuses[id] })
    });

    shutdown("SIGTERM");

    const updated = calls.jobUpdates.map((u) => u.id);
    assert.deepEqual(updated, ["job-live"], "only the still-open job may be cancelled");
    assert.equal(calls.jobUpdates[0].patch.status, "cancelled");
  });

  it("cancels jobs whose state cannot be read, rather than losing them", () => {
    const child = spawnFixtureChild();
    children.push(child);
    const { shutdown, calls } = harness({
      activeProcesses: new Map([["job-unknown", child]]),
      getJob: () => null
    });

    shutdown("SIGTERM");

    assert.equal(calls.jobUpdates.length, 1, "an unreadable job must still be recorded, not skipped");
    assert.equal(calls.jobUpdates[0].patch.status, "cancelled");
  });

  it("removes outstanding temporary credentials and staging", () => {
    const authFile = path.join(scratch, "registry-auth-abc.json");
    const registriesD = path.join(scratch, "registries.d-abc");
    const staging = path.join(scratch, "airgap-runtime-package-abc");
    fs.writeFileSync(authFile, "{\"auths\":{\"example.com\":{}}}", { mode: 0o600 });
    fs.mkdirSync(registriesD);
    fs.mkdirSync(path.join(staging, "runtime-package"), { recursive: true });
    fs.writeFileSync(path.join(staging, "runtime-package", "image.tar"), "big");

    trackTempArtifact(authFile, "file", "registry-auth");
    trackTempArtifact(registriesD, "dir", "registries-d");
    trackTempArtifact(staging, "dir", "runtime-package-staging");

    const { shutdown, calls } = harness();
    shutdown("SIGTERM");

    assert.equal(fs.existsSync(authFile), false, "a pull secret must not survive shutdown");
    assert.equal(fs.existsSync(registriesD), false);
    assert.equal(fs.existsSync(staging), false, "in-flight export staging must be released");
    assert.deepEqual(calls.exits, [0]);
  });

  it("finishes its cleanup before returning, rather than scheduling it", () => {
    const child = spawnFixtureChild();
    children.push(child);
    const authFile = path.join(scratch, "registry-auth-timing.json");
    fs.writeFileSync(authFile, "x");
    trackTempArtifact(authFile, "file", "registry-auth");

    const { shutdown, calls } = harness({ activeProcesses: new Map([["job-x", child]]) });

    shutdown("SIGTERM");

    // Both assertions are made on the same tick as the call. Nothing is left
    // on a timer or a microtask, so there is no window a grace period could
    // overrun. A wall-clock assertion here would be theatre: the function is
    // synchronous by construction, and the real cost driver — rmSync — is
    // measured in single-digit milliseconds even for a 1.7 GB tree on disk.
    assert.deepEqual(calls.exits, [0], "exit must be decided before the call returns");
    assert.equal(fs.existsSync(authFile), false, "cleanup must be complete, not scheduled");
  });

  it("exits even when logging throws part-way through", () => {
    // Every step guards itself, which made the unguarded logger calls the one
    // way the handler could escape without terminating — and `shuttingDown`
    // would already have latched, so a repeat signal would skip cleanup too.
    const authFile = path.join(scratch, "registry-auth-logthrow.json");
    fs.writeFileSync(authFile, "x");
    trackTempArtifact(authFile, "file", "registry-auth");

    const exits = [];
    const shutdown = createShutdownHandler({
      getServer: () => ({ close() {} }),
      activeProcesses: new Map(),
      updateJob: () => {},
      releaseAllTempArtifacts,
      clearTimers: () => {},
      logger: { info() { throw new Error("log transport is gone"); }, warn() {}, error() {}, debug() {} },
      exit: (code) => exits.push(code)
    });

    assert.doesNotThrow(() => shutdown("SIGTERM"));
    assert.deepEqual(exits, [0], "a logging failure must not prevent termination");
    // Exiting cleanly is NOT enough. The first version of this test asserted
    // only the exit code, which quietly documented a gap: a throw from the
    // very first logger call unwound past the artifact release, so the
    // process exited 0 having left a pull secret on the /data volume — the
    // exact outcome this sequence exists to prevent.
    assert.equal(
      fs.existsSync(authFile),
      false,
      "a logging failure must not skip the credential release"
    );
  });

  it("handles a repeat signal without redoing or wedging cleanup", () => {
    const authFile = path.join(scratch, "registry-auth-repeat.json");
    fs.writeFileSync(authFile, "x");
    trackTempArtifact(authFile, "file", "registry-auth");

    let releaseCalls = 0;
    const { shutdown, calls } = harness({
      releaseAllTempArtifacts: () => {
        releaseCalls += 1;
        return releaseAllTempArtifacts();
      }
    });

    shutdown("SIGTERM");
    shutdown("SIGINT");
    shutdown("SIGTERM");

    assert.equal(releaseCalls, 1, "cleanup must run once, not once per signal");
    assert.equal(calls.closed, 1, "the listener must not be closed repeatedly");
    assert.deepEqual(calls.exits, [0, 0, 0], "every signal must still end in exit(0)");
    assert.equal(fs.existsSync(authFile), false);
  });

  it("still exits when cleanup itself fails", () => {
    const { shutdown, calls } = harness({
      releaseAllTempArtifacts: () => { throw new Error("filesystem is gone"); }
    });

    assert.doesNotThrow(() => shutdown("SIGTERM"));
    assert.deepEqual(calls.exits, [0], "a cleanup failure must not prevent termination");
  });

  it("still signals children and exits when job bookkeeping fails", async () => {
    const child = spawnFixtureChild();
    children.push(child);
    const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));

    const { shutdown, calls } = harness({
      activeProcesses: new Map([["job-db", child]]),
      updateJob: () => { throw new Error("database is locked"); }
    });

    assert.doesNotThrow(() => shutdown("SIGTERM"));
    assert.equal((await exited).signal, "SIGTERM", "the child must still be signalled");
    assert.deepEqual(calls.exits, [0]);
  });

  it("exits, and still records the job, when a child can no longer be signalled", () => {
    const dead = { kill() { throw new Error("ESRCH"); } };
    const { shutdown, calls } = harness({ activeProcesses: new Map([["job-dead", dead]]) });

    assert.doesNotThrow(() => shutdown("SIGTERM"));
    assert.deepEqual(calls.exits, [0]);
    // Without this, moving updateJob inside the kill try-block would silently
    // drop the job record for every un-signallable child and stay green.
    assert.equal(calls.jobUpdates.length, 1, "the job must still be recorded");
    assert.equal(calls.jobUpdates[0].patch.status, "cancelled");
  });
});

describe("Temporary credentials are registered by their writer", () => {
  let dataDir;
  let utils;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-l4-cred-"));
    process.env.DATA_DIR = dataDir;
    utils = await import("../src/utils.js");
  });

  after(() => {
    resetTempArtifactTracking();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("tracks a written pull secret and releases it at shutdown", () => {
    resetTempArtifactTracking();
    const authFile = utils.writeTempAuth("{\"auths\":{\"registry.example.com\":{\"auth\":\"redacted\"}}}");

    assert.ok(fs.existsSync(authFile));
    assert.equal((fs.statSync(authFile).mode & 0o777), 0o600, "pull secrets stay owner-only");
    assert.deepEqual(
      listTempArtifacts().map((a) => a.label),
      ["registry-auth"],
      "the writer must register it for shutdown"
    );

    const summary = releaseAllTempArtifacts();
    assert.equal(summary.released, 1);
    assert.equal(fs.existsSync(authFile), false);
  });

  it("keeps tracking a credential it could not delete, so shutdown retries it", (t) => {
    // Best-effort cleanup is allowed to give up; ownership tracking is not. A
    // pull secret that outlived its owner has to stay registered, or shutdown
    // loses its last chance to remove it.
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      t.skip("cannot provoke EACCES as root");
      return;
    }
    resetTempArtifactTracking();
    const authFile = utils.writeTempAuth("{\"auths\":{\"locked.example.com\":{}}}");
    const parent = path.dirname(authFile);

    fs.chmodSync(parent, 0o500);
    try {
      utils.safeUnlink(authFile);
      assert.equal(fs.existsSync(authFile), true, "precondition: deletion really failed");
      assert.deepEqual(
        listTempArtifacts().map((a) => a.label),
        ["registry-auth"],
        "a credential still on disk must stay tracked"
      );
    } finally {
      fs.chmodSync(parent, 0o700);
    }

    // And shutdown's sweep then succeeds.
    assert.equal(releaseAllTempArtifacts().released, 1);
    assert.equal(fs.existsSync(authFile), false);
  });

  it("stops tracking a credential another actor already removed", () => {
    resetTempArtifactTracking();
    const authFile = utils.writeTempAuth("{\"auths\":{}}");
    fs.rmSync(authFile);

    utils.safeUnlink(authFile); // ENOENT: gone is gone

    assert.deepEqual(listTempArtifacts(), []);
  });

  it("stops tracking once its owner unlinks it normally", () => {
    resetTempArtifactTracking();
    const authFile = utils.writeTempAuth("{\"auths\":{}}");
    assert.equal(listTempArtifacts().length, 1);

    utils.safeUnlink(authFile);

    assert.equal(fs.existsSync(authFile), false);
    assert.deepEqual(listTempArtifacts(), [], "normal cleanup must deregister it");
  });
});

describe("A real backend process shuts down cleanly", () => {
  const started = [];

  after(() => {
    for (const child of started) {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }
  });

  /** Launch src/index.js for real — the shutdown path is skipped under NODE_ENV=test. */
  const startServer = async (dataDir, port, tmpHome) => {
    const child = spawn(process.execPath, ["src/index.js"], {
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATA_DIR: dataDir,
        PORT: String(port),
        AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE: "fixture",
        // os.tmpdir() honours TMPDIR, and runtimePackage.js stages through
        // os.tmpdir(). Pointing the server at a private one keeps this test
        // from observing — or deleting — staging that belongs to another
        // process sharing /tmp on the same host.
        ...(tmpHome ? { TMPDIR: tmpHome } : {})
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    started.push(child);
    let output = "";
    child.stdout.on("data", (d) => { output += d.toString(); });
    child.stderr.on("data", (d) => { output += d.toString(); });

    const exited = new Promise((resolve) =>
      child.on("exit", (code, signal) => resolve({ code, signal }))
    );

    await waitFor(async () => {
      if (!output.includes("Server started")) return false;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/build-info`);
        return res.ok;
      } catch {
        return false;
      }
    }, "the backend to accept requests");

    return { child, exited, getOutput: () => output };
  };

  const freePort = async () => {
    const net = await import("node:net");
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.on("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const { port } = srv.address();
        srv.close(() => resolve(port));
      });
    });
  };

  it("terminates promptly with exit code 0 on SIGTERM and clears its timers", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-l4-proc-"));
    try {
      const port = await freePort();
      const { child, exited, getOutput } = await startServer(dataDir, port);

      const startedAt = Date.now();
      // A second signal in the same tick is a smoke check only: the first
      // handler reaches exit synchronously, so this does NOT exercise the
      // repeat-signal guard — the unit test above does that honestly.
      child.kill("SIGTERM");
      child.kill("SIGTERM");
      const result = await exited;
      const elapsed = Date.now() - startedAt;

      assert.equal(result.code, 0, `expected a clean exit, got ${JSON.stringify(result)}`);
      // Well inside the 3s the compose profile allows, of which runuser also
      // needs ~2s after node exits.
      assert.ok(elapsed < 2000, `shutdown took ${elapsed}ms`);
      assert.match(getOutput(), /Shutdown cleanup complete/, "the cleanup stage must have run");
      // The retention interval and the startup cleanup timeout live inside the
      // app.listen callback, which never runs under NODE_ENV=test, so this log
      // field is the only way to observe that the real closure cleared them.
      assert.match(getOutput(), /"timersCleared":true/, "the real timers must have been cleared");
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("sweeps credentials a killed predecessor left behind, and nothing else", async () => {
    // SIGKILL — what the compose profile delivers if an export is mid-save,
    // and what an OOM delivers always — runs no shutdown handler at all.
    // Boot is the only remaining chance to collect what it stranded.
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-l4-sweep-"));
    const tmpDir = path.join(dataDir, "tmp");
    fs.mkdirSync(tmpDir, { recursive: true });

    const abandoned = {
      authFile: path.join(tmpDir, "registry-auth-DEADBEEF.json"),
      sshKey: path.join(tmpDir, "airgap-key-DEADBEEF"),
      sshPub: path.join(tmpDir, "airgap-key-DEADBEEF.pub"),
      imageset: path.join(tmpDir, "imageset-DEADBEEF.yaml"),
      registriesD: path.join(tmpDir, "registries.d-DEADBEEF")
    };
    fs.writeFileSync(abandoned.authFile, "{\"auths\":{\"registry.example.com\":{}}}", { mode: 0o600 });
    fs.writeFileSync(abandoned.sshKey, "PRIVATE KEY", { mode: 0o600 });
    fs.writeFileSync(abandoned.sshPub, "ssh-ed25519 AAAA");
    fs.writeFileSync(abandoned.imageset, "kind: ImageSetConfiguration");
    fs.mkdirSync(abandoned.registriesD);
    fs.writeFileSync(path.join(abandoned.registriesD, "registry.yaml"), "docker: {}");

    // Must survive: not ours, not our naming convention.
    const bystander = path.join(tmpDir, "operator-notes.txt");
    fs.writeFileSync(bystander, "a file this backend did not create");

    // A file that DOES match a swept prefix. The sweep deletes it, and that
    // is the accepted contract rather than an oversight: DATA_DIR/tmp is an
    // OAA-owned scratch directory, every one of its five writers produces a
    // matching name, and nothing else in the product writes there. Pinned so
    // the boundary is stated by a test instead of assumed — a colliding
    // operator file placed here IS collateral.
    const collidingName = path.join(tmpDir, "imageset-operator-notes.yaml");
    fs.writeFileSync(collidingName, "hand-placed, and matches a swept prefix");

    try {
      const port = await freePort();
      const { child, exited } = await startServer(dataDir, port);

      for (const [label, target] of Object.entries(abandoned)) {
        assert.equal(fs.existsSync(target), false, `${label} should have been swept at boot`);
      }
      assert.equal(fs.existsSync(bystander), true, "a non-matching file must not be collateral");
      assert.equal(
        fs.existsSync(collidingName),
        false,
        "a prefix-matching name IS swept — the accepted boundary, pinned here deliberately"
      );

      child.kill("SIGTERM");
      await exited;
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("terminates cleanly on SIGINT as well as SIGTERM", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-l4-sigint-"));
    try {
      const port = await freePort();
      const { child, exited, getOutput } = await startServer(dataDir, port);

      child.kill("SIGINT");
      const result = await exited;

      assert.equal(result.code, 0, `expected a clean exit, got ${JSON.stringify(result)}`);
      assert.match(getOutput(), /Shutdown cleanup complete/);
      assert.match(getOutput(), /"signal":"SIGINT"/, "the handler must see the signal it got");
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("releases in-flight export staging instead of stranding it", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-l4-export-"));
    // The server stages under its own TMPDIR, so this test can only ever see
    // — and only ever delete — staging it caused. Scanning the shared
    // os.tmpdir() would race with, and could destroy, a concurrent process's
    // live export on the same host.
    const stagingHome = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-l4-tmphome-"));
    const stagingPrefix = "airgap-runtime-package-";
    try {
      const port = await freePort();
      const { child, exited } = await startServer(dataDir, port, stagingHome);

      // An export whose staged run payload is far larger than any socket
      // buffer. Leaving the body unread stalls it under backpressure, which
      // holds the export open at a known point — no sleep involved.
      const crypto = await import("node:crypto");
      const state = {
        _schemaVersion: 3,
        version: {
          _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: "4.22.16",
          selectedChannel: "stable-4.22", selectedVersion: "4.22.16", locked: true
        },
        release: { channel: "4.22", patchVersion: "4.22.16", confirmed: true },
        blueprint: {
          platform: "Bare Metal", arch: "x86_64", clusterName: "l4-export",
          baseDomain: "example.com", confirmed: true
        },
        methodology: { method: "Agent-Based Installer" },
        credentials: { sshPublicKey: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB l4@test" },
        globalStrategy: {
          fips: false,
          networking: {
            networkType: "OVNKubernetes", machineNetworkV4: "10.90.0.0/24",
            clusterNetworkCidr: "10.128.0.0/14", clusterNetworkHostPrefix: 23,
            serviceNetworkCidr: "172.30.0.0/16"
          },
          mirroring: { registryFqdn: "registry.local:5000", sources: [] }
        },
        hostInventory: { nodes: [], ipStackMode: "ipv4" },
        operators: { selected: [], stale: false },
        trust: { additionalTrustBundlePolicy: "Proxyonly", mirrorRegistryCaPem: "", proxyCaPem: "" },
        exportOptions: {
          includeCredentials: false, includeCertificates: true, includeClientTools: false,
          includeInstaller: false, includeHighSideRuntimePackage: true
        },
        exportStallFiller: crypto.randomBytes(6 * 1024 * 1024).toString("base64")
      };

      // The body is deliberately never read, so the server cannot have
      // finished the export: it is blocked writing the oversized run payload.
      const controller = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/bundle.zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
        signal: controller.signal
      });
      assert.equal(res.status, 200, "the export must have started");

      const stagingRoot = await waitFor(() => {
        const created = fs.readdirSync(stagingHome).filter((n) => n.startsWith(stagingPrefix));
        return created.length === 1 ? path.join(stagingHome, created[0]) : null;
      }, "the export staging directory to appear");

      assert.ok(fs.existsSync(stagingRoot), "precondition: the export is still staged");

      child.kill("SIGTERM");
      const result = await exited;
      controller.abort();
      await res.arrayBuffer().catch(() => {});

      assert.equal(result.code, 0);
      assert.equal(
        fs.existsSync(stagingRoot),
        false,
        "staging for an interrupted export must not survive the process"
      );
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(stagingHome, { recursive: true, force: true });
    }
  });
});
