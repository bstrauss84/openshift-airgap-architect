/**
 * Migration 001: Initial Schema
 *
 * Creates the foundational database tables for the application.
 * This migration captures the base schema that existed before the
 * formal migration system was introduced.
 *
 * Tables:
 * - cache: Key-value cache for Cincinnati data, operator catalogs
 * - jobs: Background job tracking (Cincinnati refresh, operator scans, oc-mirror)
 * - operator_results: Operator scan results by version and catalog
 * - docs_links: Documentation links cache
 * - app_state: Application wizard state (singleton)
 *
 * @author Bill Strauss
 */

export const up = (db) => {
  // Cache table: Key-value store for Cincinnati data, operator catalogs, etc.
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Jobs table: Background job tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
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

  // Operator results table: Operator scan results
  db.exec(`
    CREATE TABLE IF NOT EXISTS operator_results (
      version TEXT NOT NULL,
      catalog TEXT NOT NULL,
      results_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (version, catalog)
    )
  `);

  // Documentation links cache
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs_links (
      key TEXT PRIMARY KEY,
      links_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Application state: Wizard configuration state
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
};

export const down = (db) => {
  // Drop all tables in reverse dependency order
  db.exec(`DROP TABLE IF EXISTS app_state`);
  db.exec(`DROP TABLE IF EXISTS docs_links`);
  db.exec(`DROP TABLE IF EXISTS operator_results`);
  db.exec(`DROP TABLE IF EXISTS jobs`);
  db.exec(`DROP TABLE IF EXISTS cache`);
};
