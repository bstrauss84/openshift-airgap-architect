/**
 * OpenShift Airgap Architect - SQLite Database Connection
 *
 * Initializes and exports SQLite database connection for application state caching,
 * background job tracking, operator scan results, and Cincinnati data caching.
 * Database location configurable via DATA_DIR environment variable.
 *
 * Uses formal migration system for schema management (see migrations/ directory).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrationRunner.js";
import logger from "./logger.js";

const dataDir = process.env.DATA_DIR || "/data";
const dbPath = path.join(dataDir, "airgap-architect.db");

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma("journal_mode = WAL");

// Run database migrations
// This replaces the old inline schema creation and column addition pattern
try {
  await runMigrations(db);
} catch (error) {
  logger.error({ err: error }, "Database migration failed");
  throw error;
}

export { db, dataDir };
