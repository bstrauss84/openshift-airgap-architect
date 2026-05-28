/**
 * Migration System Tests
 *
 * Tests for the database migration runner including:
 * - Migration discovery and execution
 * - Transaction rollback on failure
 * - Rollback capability
 * - Migration status tracking
 * - Idempotency (running migrations multiple times)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations, rollbackMigration, getMigrationStatus } from "../src/migrationRunner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testDbPath = path.join(__dirname, "test-migrations.db");

/**
 * Create a temporary test database
 */
function createTestDb() {
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  return new Database(testDbPath);
}

/**
 * Clean up test database
 */
function cleanupTestDb() {
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
}

describe("Migration System", () => {
  after(() => {
    cleanupTestDb();
  });

  describe("runMigrations", () => {
    it("should create migrations table on first run", async () => {
      const db = createTestDb();

      await runMigrations(db);

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'").all();
      assert.strictEqual(tables.length, 1, "migrations table should exist");

      db.close();
      cleanupTestDb();
    });

    it("should apply all pending migrations in order", async () => {
      const db = createTestDb();

      const appliedCount = await runMigrations(db);

      // Should have applied migrations (001 and 002 exist)
      assert.ok(appliedCount >= 2, `Should apply at least 2 migrations, got ${appliedCount}`);

      // Check migrations table records
      const migrations = db.prepare("SELECT name FROM migrations ORDER BY id").all();
      assert.ok(migrations.length >= 2, "Should have at least 2 migration records");
      assert.ok(migrations[0].name.includes("001"), "First migration should be 001");
      assert.ok(migrations[1].name.includes("002"), "Second migration should be 002");

      db.close();
      cleanupTestDb();
    });

    it("should create expected tables from migrations", async () => {
      const db = createTestDb();

      await runMigrations(db);

      // Check that base tables exist (from 001_initial_schema.js)
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
      const tableNames = tables.map((t) => t.name);

      assert.ok(tableNames.includes("cache"), "cache table should exist");
      assert.ok(tableNames.includes("jobs"), "jobs table should exist");
      assert.ok(tableNames.includes("operator_results"), "operator_results table should exist");
      assert.ok(tableNames.includes("docs_links"), "docs_links table should exist");
      assert.ok(tableNames.includes("app_state"), "app_state table should exist");
      assert.ok(tableNames.includes("migrations"), "migrations table should exist");

      db.close();
      cleanupTestDb();
    });

    it("should add metadata_json column to jobs table", async () => {
      const db = createTestDb();

      await runMigrations(db);

      // Check jobs table has metadata_json column (from 002_add_jobs_metadata.js)
      const columns = db.prepare("PRAGMA table_info(jobs)").all();
      const columnNames = columns.map((c) => c.name);

      assert.ok(columnNames.includes("metadata_json"), "jobs table should have metadata_json column");

      db.close();
      cleanupTestDb();
    });

    it("should be idempotent (no-op when migrations already applied)", async () => {
      const db = createTestDb();

      // Run migrations first time
      const firstCount = await runMigrations(db);
      assert.ok(firstCount >= 2, "Should apply migrations on first run");

      // Run migrations second time
      const secondCount = await runMigrations(db);
      assert.strictEqual(secondCount, 0, "Should apply zero migrations on second run");

      db.close();
      cleanupTestDb();
    });

    it("should rollback on migration failure", async () => {
      const db = createTestDb();

      // Create a temporary bad migration
      const migrationsDir = path.join(__dirname, "../src/migrations");
      const badMigrationPath = path.join(migrationsDir, "999_bad_migration.js");

      const badMigrationContent = `
export const up = (db) => {
  throw new Error("Intentional migration failure");
};

export const down = (db) => {
  // Nothing to rollback
};
`;

      fs.writeFileSync(badMigrationPath, badMigrationContent);

      try {
        await runMigrations(db);
        assert.fail("Should have thrown error on bad migration");
      } catch (error) {
        assert.ok(error.message.includes("999_bad_migration"), "Error should reference bad migration");
        assert.ok(error.message.includes("Intentional migration failure"), "Error should include original message");
      }

      // Check that bad migration was NOT recorded
      const migrations = db.prepare("SELECT name FROM migrations WHERE name LIKE '%999%'").all();
      assert.strictEqual(migrations.length, 0, "Bad migration should not be recorded");

      // Clean up bad migration file
      fs.unlinkSync(badMigrationPath);

      db.close();
      cleanupTestDb();
    });
  });

  describe("rollbackMigration", () => {
    it("should rollback the last applied migration", async () => {
      const db = createTestDb();

      // Apply all migrations
      await runMigrations(db);

      // Get current migration count
      const beforeMigrations = db.prepare("SELECT name FROM migrations").all();
      const beforeCount = beforeMigrations.length;
      assert.ok(beforeCount >= 2, "Should have at least 2 migrations applied");

      // Rollback last migration
      const rolledBack = await rollbackMigration(db);
      assert.ok(rolledBack, "Should return name of rolled back migration");
      assert.ok(rolledBack.includes("002"), "Should rollback 002_add_jobs_metadata migration");

      // Check migration count decreased
      const afterMigrations = db.prepare("SELECT name FROM migrations").all();
      assert.strictEqual(afterMigrations.length, beforeCount - 1, "Should have one fewer migration");

      // Check metadata_json column was removed
      const columns = db.prepare("PRAGMA table_info(jobs)").all();
      const columnNames = columns.map((c) => c.name);
      assert.ok(!columnNames.includes("metadata_json"), "metadata_json column should be removed");

      db.close();
      cleanupTestDb();
    });

    it("should return null when no migrations to rollback", async () => {
      const db = createTestDb();

      // Don't apply any migrations
      await runMigrations(db); // Creates migrations table
      db.prepare("DELETE FROM migrations").run(); // Clear all records

      const result = await rollbackMigration(db);
      assert.strictEqual(result, null, "Should return null when no migrations to rollback");

      db.close();
      cleanupTestDb();
    });

    it("should allow re-applying migration after rollback", async () => {
      const db = createTestDb();

      // Apply all migrations
      await runMigrations(db);

      // Rollback last migration
      await rollbackMigration(db);

      // Re-apply migrations
      const appliedCount = await runMigrations(db);
      assert.strictEqual(appliedCount, 1, "Should re-apply the rolled back migration");

      // Check metadata_json column exists again
      const columns = db.prepare("PRAGMA table_info(jobs)").all();
      const columnNames = columns.map((c) => c.name);
      assert.ok(columnNames.includes("metadata_json"), "metadata_json column should exist after re-apply");

      db.close();
      cleanupTestDb();
    });
  });

  describe("getMigrationStatus", () => {
    it("should return correct status for fresh database", async () => {
      const db = createTestDb();

      // Create migrations table but don't apply migrations
      db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          applied_at INTEGER NOT NULL
        )
      `);

      const status = await getMigrationStatus(db);

      assert.ok(status.total >= 2, "Should detect at least 2 available migrations");
      assert.strictEqual(status.appliedCount, 0, "Should have zero applied migrations");
      assert.strictEqual(status.pendingCount, status.total, "All migrations should be pending");
      assert.strictEqual(status.applied.length, 0, "applied array should be empty");
      assert.strictEqual(status.pending.length, status.total, "pending array should match total");

      db.close();
      cleanupTestDb();
    });

    it("should return correct status after applying migrations", async () => {
      const db = createTestDb();

      await runMigrations(db);

      const status = await getMigrationStatus(db);

      assert.ok(status.appliedCount >= 2, "Should have at least 2 applied migrations");
      assert.strictEqual(status.pendingCount, 0, "Should have zero pending migrations");
      assert.strictEqual(status.appliedCount, status.total, "All migrations should be applied");
      assert.strictEqual(status.applied.length, status.appliedCount, "applied array length should match count");
      assert.strictEqual(status.pending.length, 0, "pending array should be empty");

      db.close();
      cleanupTestDb();
    });

    it("should return correct status after partial migration", async () => {
      const db = createTestDb();

      await runMigrations(db);
      await rollbackMigration(db);

      const status = await getMigrationStatus(db);

      assert.ok(status.total >= 2, "Should have at least 2 total migrations");
      assert.ok(status.appliedCount >= 1, "Should have at least 1 applied migration");
      assert.strictEqual(status.pendingCount, 1, "Should have 1 pending migration");
      assert.ok(status.pending[0].includes("002"), "Pending migration should be 002");

      db.close();
      cleanupTestDb();
    });
  });

  describe("Migration file structure", () => {
    it("should have up and down functions in all migrations", async () => {
      const migrationsDir = path.join(__dirname, "../src/migrations");
      const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".js"));

      assert.ok(files.length >= 2, "Should have at least 2 migration files");

      for (const file of files) {
        const migration = await import(path.join(migrationsDir, file));
        assert.strictEqual(typeof migration.up, "function", `${file} should export 'up' function`);
        assert.strictEqual(typeof migration.down, "function", `${file} should export 'down' function`);
      }
    });

    it("should have migrations with correct naming convention", async () => {
      const migrationsDir = path.join(__dirname, "../src/migrations");
      const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".js"));

      for (const file of files) {
        assert.ok(/^\d{3}_[a-z_]+\.js$/.test(file), `${file} should follow NNN_snake_case.js naming convention`);
      }
    });
  });
});
