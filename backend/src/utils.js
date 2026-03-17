/** State and job helpers: cache get/set, job CRUD, temp auth file for oc-mirror, run state in SQLite. */
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { db, dataDir } from "./db.js";

const now = () => Date.now();

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
  return id;
};

const updateJob = (id, patch) => {
  const current = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  if (!current) return null;
  const metadataJson =
    patch.metadata_json !== undefined
      ? (typeof patch.metadata_json === "string" ? patch.metadata_json : JSON.stringify(patch.metadata_json))
      : current.metadata_json;
  const updated = {
    status: patch.status ?? current.status,
    progress: patch.progress ?? current.progress,
    message: patch.message ?? current.message,
    output: patch.output ?? current.output,
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
  return updated;
};

/** Merge object into job metadata_json (for oc-mirror-run). Existing keys preserved if not in patch. */
const updateJobMetadata = (id, patch) => {
  const row = db.prepare("SELECT metadata_json FROM jobs WHERE id = ?").get(id);
  if (!row) return null;
  let meta = {};
  try {
    if (row.metadata_json) meta = JSON.parse(row.metadata_json);
  } catch {}
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
  if (!row) return null;
  return JSON.parse(row.state_json);
};

const setState = (state) => {
  db.prepare(
    "INSERT INTO app_state (id, state_json, updated_at) VALUES ('singleton', ?, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at"
  ).run(JSON.stringify(state), now());
};

const ensureTempDir = () => {
  const dir = path.join(dataDir, "tmp");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const writeTempAuth = (contents) => {
  const dir = ensureTempDir();
  const filePath = path.join(dir, `registry-auth-${nanoid()}.json`);
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
};

const safeUnlink = (filePath) => {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    // ignore
  }
};

const appendJobOutput = (id, chunk, maxBytes = 500000) => {
  const current = getJob(id);
  if (!current) return null;
  const next = `${current.output || ""}${chunk}`;
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
  writeTempAuth,
  safeUnlink,
  appendJobOutput
};
