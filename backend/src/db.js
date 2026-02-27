/** SQLite DB for app state cache, jobs, and operator scan results. Path from DATA_DIR. */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/** Default /tmp/... is writable under OpenShift non-root; set DATA_DIR for persistence. */
const dataDir = process.env.DATA_DIR || "/tmp/airgap-architect-data";
const dbPath = path.join(dataDir, "airgap-architect.db");

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    output TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS operator_results (
    version TEXT NOT NULL,
    catalog TEXT NOT NULL,
    results_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (version, catalog)
  );
  CREATE TABLE IF NOT EXISTS docs_links (
    key TEXT PRIMARY KEY,
    links_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_state (
    id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

export { db, dataDir };
