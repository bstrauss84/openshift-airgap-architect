/**
 * Migration 002: Add Jobs Metadata Column
 *
 * Adds metadata_json column to jobs table for storing additional
 * structured data about oc-mirror runs (config paths, retry info, etc.)
 *
 * This migration formalizes what was previously handled by the
 * ensureJobsMetadataColumn() function in db.js.
 *
 * @author Bill Strauss
 */

export const up = (db) => {
  // Check if column already exists (for migration from inline pattern)
  const columns = db.prepare("PRAGMA table_info(jobs)").all();
  const hasMetadata = columns.some((col) => col.name === "metadata_json");

  if (!hasMetadata) {
    db.exec("ALTER TABLE jobs ADD COLUMN metadata_json TEXT DEFAULT ''");
  }
};

export const down = (db) => {
  // SQLite doesn't support DROP COLUMN before version 3.35.0
  // For backward compatibility, we recreate the table without the column

  // Create temporary table without metadata_json
  db.exec(`
    CREATE TABLE jobs_new (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      output TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Copy data (excluding metadata_json)
  db.exec(`
    INSERT INTO jobs_new (id, type, status, progress, message, output, created_at, updated_at)
    SELECT id, type, status, progress, message, output, created_at, updated_at
    FROM jobs
  `);

  // Drop old table and rename
  db.exec(`DROP TABLE jobs`);
  db.exec(`ALTER TABLE jobs_new RENAME TO jobs`);
};
