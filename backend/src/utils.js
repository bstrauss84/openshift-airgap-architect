/**
 * OpenShift Airgap Architect - Utilities
 *
 * State management, job tracking, and temporary auth file helpers.
 * All state and job data persisted to SQLite. Pull secrets never persisted to disk.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { db, dataDir } from "./db.js";
import logger from "./logger.js";
import { recordJobStart, recordJobComplete, recordJobError, stateOperationsTotal } from "./metrics.js";

const now = () => Date.now();

const REDACTED = "[REDACTED]";

/**
 * Best-effort log redaction for auth-bearing output persisted to job history.
 * Keeps non-sensitive logs readable while preventing accidental secret storage.
 */
const redactJobOutputForStorage = (text) => {
  if (typeof text !== "string" || text.length === 0) return text;
  return text
    // Docker/OCI pull-secret auth payloads.
    .replace(/("auth"\s*:\s*")[^"]+(")/gi, `$1${REDACTED}$2`)
    // Common password/token fields in JSON-ish or key-value output.
    .replace(/("?(?:password|passwd|token|access_token|refresh_token|client_secret)"?\s*[:=]\s*")[^"]*(")/gi, `$1${REDACTED}$2`)
    .replace(/((?:password|passwd|token|access_token|refresh_token|client_secret)\s*[:=]\s*)([^\s,;]+)/gi, `$1${REDACTED}`)
    // HTTP Authorization headers.
    .replace(/(Authorization\s*:\s*Bearer\s+)[^\s]+/gi, `$1${REDACTED}`)
    .replace(/(Authorization\s*:\s*Basic\s+)[^\s]+/gi, `$1${REDACTED}`)
    // URLs with embedded credentials.
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s/]+)@/gi, `$1${REDACTED}:${REDACTED}@`);
};

const getCache = (key) => {
  const row = db.prepare("SELECT value, updated_at FROM cache WHERE key = ?").get(key);
  if (!row) return null;
  return { value: JSON.parse(row.value), updatedAt: row.updated_at };
};

const setCache = (key, value) => {
  db.prepare(
    "INSERT INTO cache (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(key, JSON.stringify(value), now());
};

const createJob = (type, message = "") => {
  const id = nanoid();
  const ts = now();
  db.prepare(
    "INSERT INTO jobs (id, type, status, progress, message, output, created_at, updated_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, type, "queued", 0, message, null, ts, ts, "");

  if (process.env.NODE_ENV !== "test") {
    logger.info({ tag: "job:create", jobId: id, type, message, status: "queued" }, "Job created");
  }

  return id;
};

const updateJob = (id, patch) => {
  const current = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  if (!current) return null;
  const sanitizedOutput = patch.output !== undefined
    ? redactJobOutputForStorage(String(patch.output ?? ""))
    : current.output;
  const metadataJson =
    patch.metadata_json !== undefined
      ? (typeof patch.metadata_json === "string" ? patch.metadata_json : JSON.stringify(patch.metadata_json))
      : current.metadata_json;
  const updated = {
    status: patch.status ?? current.status,
    progress: patch.progress ?? current.progress,
    message: patch.message ?? current.message,
    output: sanitizedOutput,
    updated_at: now(),
    metadata_json: metadataJson ?? ""
  };
  db.prepare(
    "UPDATE jobs SET status = ?, progress = ?, message = ?, output = ?, updated_at = ?, metadata_json = ? WHERE id = ?"
  ).run(
    updated.status,
    updated.progress,
    updated.message,
    updated.output,
    updated.updated_at,
    updated.metadata_json,
    id
  );

  // Log terminal state transitions (completed, failed, cancelled) and running state
  if (process.env.NODE_ENV !== "test") {
    const statusChanged = updated.status !== current.status;
    const isTerminalState = ["completed", "failed", "cancelled"].includes(updated.status);
    const isRunning = updated.status === "running" && current.status !== "running";

    if (statusChanged && (isTerminalState || isRunning)) {
      const duration = updated.updated_at - current.created_at;
      logger.info({ tag: "job:update", jobId: id, type: current.type, status: updated.status, progress: updated.progress, message: updated.message, duration: isTerminalState ? `${(duration / 1000).toFixed(1)}s` : undefined }, "Job status changed");

      // Record Prometheus metrics
      const jobType = current.type; // e.g., "cincinnati-refresh", "operator-scan", "oc-mirror-run"

      if (isRunning) {
        // Job started running
        recordJobStart(jobType);
      } else if (isTerminalState) {
        // Job completed/failed/cancelled
        const durationSeconds = duration / 1000;
        recordJobComplete(jobType, updated.status, durationSeconds);

        // Record error if job failed
        if (updated.status === "failed") {
          // Try to classify error type from message
          const message = updated.message?.toLowerCase() || "";
          let errorType = "unknown";
          if (message.includes("network") || message.includes("timeout") || message.includes("connection")) {
            errorType = "network";
          } else if (message.includes("auth") || message.includes("unauthorized") || message.includes("forbidden")) {
            errorType = "auth";
          } else if (message.includes("disk") || message.includes("space") || message.includes("storage")) {
            errorType = "storage";
          }
          recordJobError(jobType, errorType);
        }
      }
    }
  }

  return updated;
};

/** Merge object into job metadata_json (for oc-mirror-run). Existing keys preserved if not in patch. */
const updateJobMetadata = (id, patch) => {
  const row = db.prepare("SELECT metadata_json FROM jobs WHERE id = ?").get(id);
  if (!row) return null;
  let meta = {};
  try {
    if (row.metadata_json) meta = JSON.parse(row.metadata_json);
  } catch (err) {
    logger.debug({ err }, "Job metadata JSON parse failed");
  }
  const merged = { ...meta, ...patch };
  const str = JSON.stringify(merged);
  db.prepare("UPDATE jobs SET metadata_json = ?, updated_at = ? WHERE id = ?").run(str, now(), id);
  return merged;
};

const getJob = (id) => db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);

const listJobs = () => db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all();

const listJobsByType = (type) => db.prepare("SELECT * FROM jobs WHERE type = ?").all(type);

/** Delete jobs in terminal state (completed, failed, cancelled). Returns number deleted. */
const deleteCompletedJobs = () => {
  const result = db.prepare("DELETE FROM jobs WHERE status IN ('completed', 'failed', 'cancelled')").run();
  return result.changes;
};

const getJobsCount = () => {
  const row = db.prepare("SELECT COUNT(*) AS count FROM jobs").get();
  return row?.count ?? 0;
};

const markStaleJobs = () => {
  db.prepare("UPDATE jobs SET status = ?, message = ?, updated_at = ? WHERE status = ?")
    .run("failed", "Server restarted; job marked stale.", now(), "running");
};

const getState = () => {
  const row = db.prepare("SELECT state_json FROM app_state WHERE id = 'singleton'").get();
  if (process.env.NODE_ENV !== "test") {
    stateOperationsTotal.inc({ operation: "load" });
  }
  if (!row) return null;
  return JSON.parse(row.state_json);
};

const setState = (state) => {
  db.prepare(
    "INSERT INTO app_state (id, state_json, updated_at) VALUES ('singleton', ?, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at"
  ).run(JSON.stringify(state), now());
  if (process.env.NODE_ENV !== "test") {
    stateOperationsTotal.inc({ operation: "save" });
  }
};

const ensureTempDir = () => {
  const dir = path.join(dataDir, "tmp");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const writeTempAuth = (contents) => {
  const dir = ensureTempDir();
  const filePath = path.join(dir, `registry-auth-${nanoid()}.json`);
  fs.writeFileSync(filePath, contents, { mode: 0o600, encoding: "utf8" });
  return filePath;
};

const mergePullSecrets = (a, b) => {
  const parsedA = JSON.parse(a);
  const parsedB = JSON.parse(b);
  return JSON.stringify({ auths: { ...parsedA.auths, ...parsedB.auths } });
};

const safeUnlink = (filePath) => {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Intentionally suppressed - best-effort cleanup; file may already be deleted
  }
};

const appendJobOutput = (id, chunk, maxBytes = 500000) => {
  const current = getJob(id);
  if (!current) return null;
  const next = redactJobOutputForStorage(`${current.output || ""}${String(chunk ?? "")}`);
  const trimmed = next.length > maxBytes ? next.slice(next.length - maxBytes) : next;
  return updateJob(id, { output: trimmed });
};

export {
  now,
  getCache,
  setCache,
  createJob,
  updateJob,
  updateJobMetadata,
  getJob,
  listJobs,
  listJobsByType,
  deleteCompletedJobs,
  getJobsCount,
  markStaleJobs,
  getState,
  setState,
  redactJobOutputForStorage,
  writeTempAuth,
  mergePullSecrets,
  safeUnlink,
  appendJobOutput
};
