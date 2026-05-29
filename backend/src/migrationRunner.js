/**
 * Database Migration Runner
 *
 * Manages database schema migrations with version tracking and rollback support.
 *
 * Features:
 * - Sequential migration execution
 * - Migration version tracking in database
 * - Rollback support for failed migrations
 * - Transaction-based migration application
 * - Automatic discovery of migration files
 *
 * Usage:
 *   import { runMigrations, rollbackMigration } from './migrationRunner.js';
 *   await runMigrations(db);  // Apply all pending migrations
 *   await rollbackMigration(db);  // Rollback last migration
 *
 * @author Bill Strauss
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Initialize migrations tracking table
 */
function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `);
}

/**
 * Get list of applied migrations
 */
function getAppliedMigrations(db) {
  const rows = db.prepare('SELECT name FROM migrations ORDER BY id').all();
  return rows.map((row) => row.name);
}

/**
 * Mark migration as applied
 */
function recordMigration(db, name) {
  db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(name, Date.now());
}

/**
 * Remove migration record (for rollback)
 */
function removeMigrationRecord(db, name) {
  db.prepare('DELETE FROM migrations WHERE name = ?').run(name);
}

/**
 * Discover migration files in migrations directory
 */
async function discoverMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const files = fs.readdirSync(migrationsDir);
  const migrations = files
    .filter((file) => file.endsWith('.js'))
    .sort() // Lexicographic sort ensures numeric order (001, 002, etc.)
    .map((file) => ({
      name: file,
      path: path.join(migrationsDir, file),
    }));

  return migrations;
}

/**
 * Run all pending migrations
 *
 * @param {Database} db - better-sqlite3 database instance
 * @returns {Promise<number>} Number of migrations applied
 */
export async function runMigrations(db) {
  ensureMigrationsTable(db);

  const appliedMigrations = getAppliedMigrations(db);
  const availableMigrations = await discoverMigrations();

  const pendingMigrations = availableMigrations.filter(
    (migration) => !appliedMigrations.includes(migration.name)
  );

  if (pendingMigrations.length === 0) {
    logger.info({ tag: 'migrations' }, 'No pending migrations');
    return 0;
  }

  logger.info(
    { tag: 'migrations', count: pendingMigrations.length, migrations: pendingMigrations.map((m) => m.name) },
    'Running pending migrations'
  );

  let appliedCount = 0;

  for (const migration of pendingMigrations) {
    try {
      logger.info({ tag: 'migrations', migration: migration.name }, 'Applying migration');

      // Import migration module
      const migrationModule = await import(migration.path);

      if (typeof migrationModule.up !== 'function') {
        throw new Error(`Migration ${migration.name} does not export an 'up' function`);
      }

      // Run migration in a transaction
      const applyMigration = db.transaction(() => {
        migrationModule.up(db);
        recordMigration(db, migration.name);
      });

      applyMigration();

      logger.info({ tag: 'migrations', migration: migration.name }, 'Migration applied successfully');
      appliedCount++;
    } catch (error) {
      logger.error(
        { tag: 'migrations', migration: migration.name, err: error },
        'Migration failed'
      );
      throw new Error(`Migration ${migration.name} failed: ${error.message}`);
    }
  }

  logger.info({ tag: 'migrations', count: appliedCount }, 'All migrations applied successfully');
  return appliedCount;
}

/**
 * Rollback the last applied migration
 *
 * @param {Database} db - better-sqlite3 database instance
 * @returns {Promise<string|null>} Name of rolled back migration, or null if none to rollback
 */
export async function rollbackMigration(db) {
  ensureMigrationsTable(db);

  const appliedMigrations = getAppliedMigrations(db);

  if (appliedMigrations.length === 0) {
    logger.info({ tag: 'migrations' }, 'No migrations to rollback');
    return null;
  }

  const lastMigration = appliedMigrations[appliedMigrations.length - 1];
  const migrationPath = path.join(__dirname, 'migrations', lastMigration);

  try {
    logger.info({ tag: 'migrations', migration: lastMigration }, 'Rolling back migration');

    // Import migration module
    const migrationModule = await import(migrationPath);

    if (typeof migrationModule.down !== 'function') {
      throw new Error(`Migration ${lastMigration} does not export a 'down' function`);
    }

    // Run rollback in a transaction
    const rollback = db.transaction(() => {
      migrationModule.down(db);
      removeMigrationRecord(db, lastMigration);
    });

    rollback();

    logger.info({ tag: 'migrations', migration: lastMigration }, 'Migration rolled back successfully');
    return lastMigration;
  } catch (error) {
    logger.error({ tag: 'migrations', migration: lastMigration, err: error }, 'Rollback failed');
    throw new Error(`Rollback of ${lastMigration} failed: ${error.message}`);
  }
}

/**
 * Get current migration status
 *
 * @param {Database} db - better-sqlite3 database instance
 * @returns {Promise<Object>} Migration status information
 */
export async function getMigrationStatus(db) {
  ensureMigrationsTable(db);

  const appliedMigrations = getAppliedMigrations(db);
  const availableMigrations = await discoverMigrations();

  const pendingMigrations = availableMigrations
    .filter((migration) => !appliedMigrations.includes(migration.name))
    .map((m) => m.name);

  return {
    applied: appliedMigrations,
    pending: pendingMigrations,
    total: availableMigrations.length,
    appliedCount: appliedMigrations.length,
    pendingCount: pendingMigrations.length,
  };
}
