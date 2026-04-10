/**
 * Tests for oc-mirror preflight and run endpoints, and job metadata.
 */
import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { app, resolveOcMirrorArtifactsBaseDir, resetStateForTests } from "../src/index.js";
import { appendJobOutput, createJob, updateJob, updateJobMetadata, getJob } from "../src/utils.js";

function createTestServer() {
  return new Promise((resolve) => {
    resetStateForTests();
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

test("POST /api/ocmirror/preflight with invalid mode returns 400", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/ocmirror/preflight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "invalidMode", workspacePath: "/tmp/ws" })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  } finally {
    server.close();
  }
});

test("POST /api/ocmirror/preflight returns shape with blockers and checks", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
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
    server.close();
  }
});

test("POST /api/ocmirror/preflight reports placeholder blockers", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/ocmirror/preflight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "diskToMirror",
        archivePath: "/tmp/archive",
        cachePath: "/tmp/cache",
        registryUrl: "__AIRA_PLACEHOLDER__::vip::id::Registry%20URL",
        configSourceType: "generated"
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.blockers.some((msg) => /marked for later completion/i.test(msg)));
  } finally {
    server.close();
  }
});

test("POST /api/ocmirror/run without version confirmed returns 400", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { versionConfirmed: false },
        release: { confirmed: false }
      })
    });
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
    server.close();
  }
});

test("POST /api/ocmirror/run with version confirmed returns jobId and job has metadata", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocmirror-test-"));
  const { server, baseUrl } = await createTestServer();
  try {
    await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { versionConfirmed: true },
        release: { channel: "stable-4.20", patchVersion: "4.20.0" }
      })
    });
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
    server.close();
  }
});

test("POST /api/ocmirror/run blocks execution when placeholders remain", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { versionConfirmed: true },
        release: { channel: "stable-4.20", patchVersion: "4.20.0", confirmed: true }
      })
    });
    const res = await fetch(`${baseUrl}/api/ocmirror/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "diskToMirror",
        archivePath: "/tmp/archive",
        cachePath: "/tmp/cache",
        registryUrl: "__AIRA_PLACEHOLDER__::vip::id::Registry%20URL",
        configSourceType: "generated"
      })
    });
    assert.strictEqual(res.status, 422);
    const body = await res.json();
    assert.match(body.error || "", /Execution blocked/i);
  } finally {
    server.close();
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
    server.close();
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
