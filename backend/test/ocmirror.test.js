/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Tests for oc-mirror preflight and run endpoints, and job metadata.
 */
import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { app, resolveOcMirrorArtifactsBaseDir } from "../src/index.js";
import { appendJobOutput, createJob, updateJob, updateJobMetadata, getJob } from "../src/utils.js";

function createTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function resetState(baseUrl) {
  const res = await fetch(`${baseUrl}/api/start-over`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cancelRunningOcMirror: false })
  });
  assert.strictEqual(res.status, 200, "State reset via /api/start-over must succeed");
}

test("POST /api/ocmirror/preflight with invalid mode returns 400", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await resetState(baseUrl);
    const res = await fetch(`${baseUrl}/api/ocmirror/preflight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "invalidMode", workspacePath: "/tmp/ws" })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  } finally {
    await closeServer(server);
  }
});

test("POST /api/ocmirror/preflight returns shape with blockers and checks", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await resetState(baseUrl);
    const res = await fetch(`${baseUrl}/api/ocmirror/preflight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "mirrorToMirror",
        workspacePath: "/nonexistent/path/for/workspace",
        registryUrl: "docker://registry.local:5000",
        configSourceType: "generated",
        authSource: "env"
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.blockers));
    assert.ok(Array.isArray(data.warnings));
    assert.ok(typeof data.checks === "object");
    assert.ok("workspacePath" in data.checks);
    assert.ok("config" in data.checks);
    assert.ok("auth" in data.checks);
    assert.ok("registryUrl" in data.checks);
  } finally {
    await closeServer(server);
  }
});

test("POST /api/ocmirror/run without version confirmed returns 400", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await resetState(baseUrl);
    const setupRes = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { _schemaVersion: 3, locked: false },
        release: { confirmed: false }
      })
    });
    assert.strictEqual(setupRes.status, 200, "State setup must succeed");
    const res = await fetch(`${baseUrl}/api/ocmirror/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "mirrorToDisk",
        archivePath: "/tmp/arch",
        workspacePath: "/tmp/ws",
        cachePath: "/tmp/cache",
        configSourceType: "generated",
        authSource: "env"
      })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  } finally {
    await closeServer(server);
  }
});

test("POST /api/ocmirror/run with v3 locked:false after prior locked:true still returns 400", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await resetState(baseUrl);
    const lockRes = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { _schemaVersion: 3, locked: true, selectedMinor: "4.20", selectedPatch: "4.20.8" },
        release: { channel: "4.20", patchVersion: "4.20.8", confirmed: true }
      })
    });
    assert.strictEqual(lockRes.status, 200, "Lock state setup must succeed");
    const midState = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.strictEqual(midState.version?.locked, true, "State should be locked after first POST");

    const unlockRes = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { _schemaVersion: 3, locked: false },
        release: { confirmed: false }
      })
    });
    assert.strictEqual(unlockRes.status, 200, "Unlock state setup must succeed");
    const afterState = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.strictEqual(afterState.version?.locked, false, "State should be unlocked after second POST with locked:false");

    const res = await fetch(`${baseUrl}/api/ocmirror/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "mirrorToDisk",
        archivePath: "/tmp/arch",
        workspacePath: "/tmp/ws",
        cachePath: "/tmp/cache",
        configSourceType: "generated",
        authSource: "env"
      })
    });
    assert.strictEqual(res.status, 400, "oc-mirror run must return 400 when version is explicitly unlocked");
    const data = await res.json();
    assert.ok(data.error);
  } finally {
    await closeServer(server);
  }
});

test("v3 state merge: locked:false overwrites leaked locked:true via deepMerge", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await resetState(baseUrl);
    const lockRes = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { _schemaVersion: 3, locked: true, selectedMinor: "4.21", selectedPatch: "4.21.5" },
        release: { channel: "4.21", patchVersion: "4.21.5", confirmed: true }
      })
    });
    assert.strictEqual(lockRes.status, 200, "Lock state setup must succeed");

    const unlockRes = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { _schemaVersion: 3, locked: false },
        release: { confirmed: false }
      })
    });
    assert.strictEqual(unlockRes.status, 200, "Unlock state setup must succeed");

    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.strictEqual(state.version?.locked, false, "locked:false must override leaked locked:true");
    assert.strictEqual(state.version?._schemaVersion, 3, "Schema version must remain v3");
    assert.strictEqual(state.release?.confirmed, false, "release.confirmed must sync with locked:false");
  } finally {
    await closeServer(server);
  }
});

test("POST /api/ocmirror/run with version confirmed returns jobId and job has metadata", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocmirror-test-"));
  const { server, baseUrl } = await createTestServer();
  try {
    await resetState(baseUrl);
    const stateUpdateRes = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { versionConfirmed: true },
        release: { channel: "stable-4.20", patchVersion: "4.20.0", confirmed: true }
      })
    });
    assert.strictEqual(stateUpdateRes.status, 200, "State update should succeed");

    const stateGetRes = await fetch(`${baseUrl}/api/state`);
    const currentState = await stateGetRes.json();
    assert.strictEqual(currentState.version?.locked, true, "Legacy versionConfirmed should migrate to locked:true");
    assert.strictEqual(currentState.version?._schemaVersion, 3, "State should be migrated to schema v3");

    const res = await fetch(`${baseUrl}/api/ocmirror/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "mirrorToDisk",
        archivePath: tmpDir,
        workspacePath: tmpDir,
        cachePath: tmpDir,
        configSourceType: "generated",
        authSource: "env"
      })
    });
    if (res.status !== 200) {
      const errorBody = await res.json();
      assert.fail(`Expected 200, got ${res.status}. Error: ${errorBody.error || JSON.stringify(errorBody)}`);
    }
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.jobId);
    const jobRes = await fetch(`${baseUrl}/api/jobs/${data.jobId}`);
    assert.strictEqual(jobRes.status, 200);
    const job = await jobRes.json();
    assert.strictEqual(job.type, "oc-mirror-run");
    assert.ok(job.metadata_json !== undefined);
    const meta = typeof job.metadata_json === "string" ? JSON.parse(job.metadata_json) : job.metadata_json;
    assert.strictEqual(meta.mode, "mirrorToDisk");
    assert.ok(meta.workspaceDir);
    assert.ok(meta.startedAt);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {}
    await closeServer(server);
  }
});

test("createJob and updateJobMetadata persist metadata", () => {
  const id = createJob("oc-mirror-run", "test");
  const row = getJob(id);
  assert.ok(row);
  assert.strictEqual(row.type, "oc-mirror-run");
  assert.ok(row.metadata_json !== undefined);
  const empty = typeof row.metadata_json === "string" ? (row.metadata_json ? JSON.parse(row.metadata_json) : {}) : row.metadata_json;
  updateJobMetadata(id, { mode: "diskToMirror", workspaceDir: "/path/ws" });
  const updated = getJob(id);
  const meta = typeof updated.metadata_json === "string" ? JSON.parse(updated.metadata_json) : updated.metadata_json;
  assert.strictEqual(meta.mode, "diskToMirror");
  assert.strictEqual(meta.workspaceDir, "/path/ws");
});

test("resolveOcMirrorArtifactsBaseDir uses archive for m2d/d2m and workspace for m2m", () => {
  const m2d = resolveOcMirrorArtifactsBaseDir("mirrorToDisk", "", "/tmp/archive");
  const d2m = resolveOcMirrorArtifactsBaseDir("diskToMirror", "/tmp/ws-unused", "/tmp/archive");
  const m2m = resolveOcMirrorArtifactsBaseDir("mirrorToMirror", "/tmp/workspace", "/tmp/archive");
  assert.strictEqual(m2d, path.resolve("/tmp/archive"));
  assert.strictEqual(d2m, path.resolve("/tmp/archive"));
  assert.strictEqual(m2m, path.resolve("/tmp/workspace"));
  const empty = resolveOcMirrorArtifactsBaseDir("mirrorToMirror");
  assert.strictEqual(empty, "");
});

test("POST /api/start-over cancels running oc-mirror jobs", async () => {
  const runningJobId = createJob("oc-mirror-run", "Running run");
  updateJob(runningJobId, { status: "running", progress: 1, message: "oc-mirror running." });
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/start-over`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancelRunningOcMirror: true })
    });
    assert.strictEqual(res.status, 200);
    const job = getJob(runningJobId);
    assert.strictEqual(job.status, "cancelled");
    assert.match(job.message || "", /Start Over/i);
  } finally {
    await closeServer(server);
  }
});

test("appendJobOutput redacts common secrets before persistence", () => {
  const id = createJob("oc-mirror-run", "secret redaction test");
  appendJobOutput(
    id,
    [
      'payload={"auth":"ZXhhbXBsZTpzZWNyZXQ="}',
      "password=hunter2",
      "Authorization: Bearer supersecrettoken",
      "Authorization: Basic dXNlcjpzZWNyZXQ="
    ].join("\n")
  );
  const job = getJob(id);
  assert.ok(job?.output);
  assert.match(job.output, /"auth":"\[REDACTED\]"/);
  assert.match(job.output, /password=\[REDACTED\]/);
  assert.match(job.output, /Authorization:\s*Bearer\s+\[REDACTED\]/);
  assert.match(job.output, /Authorization:\s*Basic\s+\[REDACTED\]/);
  assert.ok(!job.output.includes("hunter2"));
  assert.ok(!job.output.includes("supersecrettoken"));
});

test("updateJob redacts direct output writes", () => {
  const id = createJob("operator-scan", "direct output redaction");
  updateJob(id, {
    output: 'error: failed login at https://admin:s3cr3t@example.com and token=abc123'
  });
  const job = getJob(id);
  assert.ok(job?.output);
  assert.match(job.output, /https:\/\/\[REDACTED\]:\[REDACTED\]@example\.com/);
  assert.match(job.output, /token=\[REDACTED\]/);
  assert.ok(!job.output.includes("s3cr3t"));
  assert.ok(!job.output.includes("abc123"));
});

test("isolation: fresh start-over produces unlocked state", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await resetState(baseUrl);
    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.strictEqual(state.version?.locked, undefined, "Fresh state should have no locked field");
    assert.strictEqual(state.version?.versionConfirmed, false, "Fresh state should have versionConfirmed false");
  } finally {
    await closeServer(server);
  }
});

test("isolation: no cross-test state leakage after lock and reset", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await resetState(baseUrl);
    const lockRes = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { _schemaVersion: 3, locked: true, selectedMinor: "4.21" },
        release: { confirmed: true }
      })
    });
    assert.strictEqual(lockRes.status, 200);
    const lockedState = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.strictEqual(lockedState.version?.locked, true, "State should be locked");

    await resetState(baseUrl);
    const freshState = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.strictEqual(freshState.version?.locked, undefined, "After reset, locked should not persist");
    assert.strictEqual(freshState.version?.versionConfirmed, false, "After reset, versionConfirmed should be false");
  } finally {
    await closeServer(server);
  }
});

test("isolation: oc-mirror run returns 400 for unlocked state after reset", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await resetState(baseUrl);
    const res = await fetch(`${baseUrl}/api/ocmirror/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "mirrorToDisk",
        archivePath: "/tmp/arch",
        workspacePath: "/tmp/ws",
        cachePath: "/tmp/cache",
        configSourceType: "generated",
        authSource: "env"
      })
    });
    assert.strictEqual(res.status, 400, "Unlocked state after reset must return 400");
  } finally {
    await closeServer(server);
  }
});

test("isolation: separate servers share state but reset isolates them", async () => {
  const s1 = await createTestServer();
  const s2 = await createTestServer();
  try {
    await resetState(s1.baseUrl);
    const lockRes = await fetch(`${s1.baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { _schemaVersion: 3, locked: true, selectedMinor: "4.20" },
        release: { confirmed: true }
      })
    });
    assert.strictEqual(lockRes.status, 200);

    const s2State = await (await fetch(`${s2.baseUrl}/api/state`)).json();
    assert.strictEqual(s2State.version?.locked, true, "Server 2 sees state set by server 1 (shared SQLite)");

    await resetState(s2.baseUrl);
    const s1State = await (await fetch(`${s1.baseUrl}/api/state`)).json();
    assert.strictEqual(s1State.version?.locked, undefined, "After reset via server 2, server 1 also sees clean state");
  } finally {
    await closeServer(s1.server);
    await closeServer(s2.server);
  }
});

test("legacy contract: versionConfirmed:true on fresh state migrates to locked:true", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await resetState(baseUrl);
    const res = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { versionConfirmed: true },
        release: { channel: "stable-4.20", patchVersion: "4.20.0", confirmed: true }
      })
    });
    assert.strictEqual(res.status, 200);
    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.strictEqual(state.version?.locked, true, "Legacy versionConfirmed:true must migrate to locked:true");
    assert.strictEqual(state.version?._schemaVersion, 3, "Must be schema v3");
    assert.strictEqual(state.version?.versionConfirmed, undefined, "Legacy field must be cleared");
  } finally {
    await closeServer(server);
  }
});

test("legacy contract: versionConfirmed:false on fresh state keeps unlocked", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await resetState(baseUrl);
    const res = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { versionConfirmed: false },
        release: { confirmed: false }
      })
    });
    assert.strictEqual(res.status, 200);
    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.strictEqual(state.version?.locked, false, "Legacy versionConfirmed:false must result in locked:false");
    assert.strictEqual(state.version?.versionConfirmed, undefined, "Legacy field must be cleared");
  } finally {
    await closeServer(server);
  }
});

test("legacy contract: versionConfirmed:false CANNOT unlock v3 locked:true (OR semantics)", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await resetState(baseUrl);
    const lockRes = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { _schemaVersion: 3, locked: true, selectedMinor: "4.20" },
        release: { confirmed: true }
      })
    });
    assert.strictEqual(lockRes.status, 200);

    const legacyRes = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { versionConfirmed: false },
        release: { confirmed: false }
      })
    });
    assert.strictEqual(legacyRes.status, 200);

    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.strictEqual(state.version?.locked, true,
      "Legacy versionConfirmed:false CANNOT unlock v3 locked:true — OR semantics preserve lock");
    assert.strictEqual(state.version?.versionConfirmed, undefined, "Legacy field must be cleared");
  } finally {
    await closeServer(server);
  }
});

test("legacy contract: only explicit v3 locked:false can unlock", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await resetState(baseUrl);
    const lockRes = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { _schemaVersion: 3, locked: true, selectedMinor: "4.20" },
        release: { confirmed: true }
      })
    });
    assert.strictEqual(lockRes.status, 200);

    const unlockRes = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { _schemaVersion: 3, locked: false },
        release: { confirmed: false }
      })
    });
    assert.strictEqual(unlockRes.status, 200);

    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.strictEqual(state.version?.locked, false,
      "Explicit v3 locked:false MUST unlock — this is the only unlock path");
  } finally {
    await closeServer(server);
  }
});

test("legacy contract: complete v2 state with all confirmation fields migrates correctly", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await resetState(baseUrl);
    const res = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { versionConfirmed: true, confirmedByUser: true, selectedVersion: "4.20.8" },
        release: { channel: "stable-4.20", patchVersion: "4.20.0", confirmed: true }
      })
    });
    assert.strictEqual(res.status, 200);
    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.strictEqual(state.version?.locked, true, "Both legacy fields true → locked:true");
    assert.strictEqual(state.version?._schemaVersion, 3);
    assert.strictEqual(state.version?.versionConfirmed, undefined, "versionConfirmed cleared");
    assert.strictEqual(state.version?.confirmedByUser, undefined, "confirmedByUser cleared");
    assert.strictEqual(state.release?.confirmed, true, "release.confirmed synced from locked");
  } finally {
    await closeServer(server);
  }
});
