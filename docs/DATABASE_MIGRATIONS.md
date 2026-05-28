# Database Migration System

## Overview

OpenShift Airgap Architect uses a formal database migration system to manage SQLite schema changes. This replaces the previous inline schema creation and column addition pattern with versioned, trackable, and rollback-capable migrations.

**Key Benefits:**
- **Version Control:** All schema changes tracked in git
- **Rollback Support:** Revert migrations if needed
- **Team Coordination:** Clear migration history prevents conflicts
- **Production Safety:** Tested migrations reduce deployment risk
- **Audit Trail:** Migration table tracks what was applied when

## Architecture

### Components

**Migration Runner** (`backend/src/migrationRunner.js`):
- Discovers migration files in `backend/src/migrations/`
- Executes pending migrations in sequential order
- Tracks applied migrations in `migrations` table
- Provides rollback capability
- Runs migrations in transactions for atomicity

**Migration Files** (`backend/src/migrations/NNN_description.js`):
- Numbered sequentially (001, 002, 003, ...)
- Export `up(db)` function for applying changes
- Export `down(db)` function for rollback
- Named with descriptive slug: `001_initial_schema.js`

**Database Integration** (`backend/src/db.js`):
- Runs migrations automatically on app startup
- Fails fast if migrations fail
- Logs migration progress

### Migration Tracking Table

The system creates a `migrations` table to track applied migrations:

```sql
CREATE TABLE migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
)
```

**Fields:**
- `id`: Auto-incrementing primary key (application order)
- `name`: Migration filename (e.g., "001_initial_schema.js")
- `applied_at`: Unix timestamp (milliseconds) when applied

## Creating New Migrations

### Step 1: Determine Migration Number

List existing migrations:

```bash
ls backend/src/migrations/
```

Use the next sequential number (e.g., if `002_add_jobs_metadata.js` exists, use `003`).

### Step 2: Create Migration File

Create `backend/src/migrations/NNN_description.js`:

```javascript
/**
 * Migration NNN: Brief Description
 *
 * Detailed explanation of what this migration does and why.
 *
 * @author Your Name
 */

export const up = (db) => {
  // Apply schema changes
  db.exec(`
    CREATE TABLE new_table (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
};

export const down = (db) => {
  // Revert schema changes
  db.exec(`DROP TABLE IF EXISTS new_table`);
};
```

### Step 3: Test Migration

**Test on fresh database:**

```bash
# Delete test database
rm /data/airgap-architect.db

# Start app (migrations run automatically)
npm start
```

**Test rollback:**

```bash
node -e "
import Database from 'better-sqlite3';
import { rollbackMigration } from './src/migrationRunner.js';
const db = new Database('/data/airgap-architect.db');
await rollbackMigration(db);
db.close();
"
```

**Test re-apply after rollback:**

```bash
# Restart app (re-applies rolled back migration)
npm start
```

### Step 4: Add Automated Tests

Add test cases to `backend/test/migrations.test.js`:

```javascript
it("should apply migration NNN correctly", async () => {
  const db = createTestDb();
  await runMigrations(db);

  // Verify migration results
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  assert.ok(tables.some(t => t.name === "new_table"), "new_table should exist");

  db.close();
  cleanupTestDb();
});
```

### Step 5: Document Migration

Add entry to this file's **Migration History** section (see below).

## Migration Patterns

### Adding a Column

```javascript
export const up = (db) => {
  // Check if column exists (for backward compatibility)
  const columns = db.prepare("PRAGMA table_info(table_name)").all();
  const hasColumn = columns.some((col) => col.name === "new_column");

  if (!hasColumn) {
    db.exec("ALTER TABLE table_name ADD COLUMN new_column TEXT DEFAULT ''");
  }
};

export const down = (db) => {
  // SQLite doesn't support DROP COLUMN before 3.35.0
  // Recreate table without the column

  db.exec(`
    CREATE TABLE table_name_new (
      id TEXT PRIMARY KEY,
      existing_column TEXT NOT NULL
    )
  `);

  db.exec(`
    INSERT INTO table_name_new (id, existing_column)
    SELECT id, existing_column FROM table_name
  `);

  db.exec(`DROP TABLE table_name`);
  db.exec(`ALTER TABLE table_name_new RENAME TO table_name`);
};
```

### Creating a Table

```javascript
export const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS new_table (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
};

export const down = (db) => {
  db.exec(`DROP TABLE IF EXISTS new_table`);
};
```

### Creating an Index

```javascript
export const up = (db) => {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_table_column
    ON table_name(column_name)
  `);
};

export const down = (db) => {
  db.exec(`DROP INDEX IF EXISTS idx_table_column`);
};
```

### Data Migration

```javascript
export const up = (db) => {
  // Add column
  db.exec("ALTER TABLE users ADD COLUMN full_name TEXT DEFAULT ''");

  // Populate column from existing data
  db.exec(`
    UPDATE users
    SET full_name = first_name || ' ' || last_name
    WHERE full_name = ''
  `);
};

export const down = (db) => {
  // Recreate table without new column
  db.exec(`
    CREATE TABLE users_new (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL
    )
  `);

  db.exec(`
    INSERT INTO users_new (id, first_name, last_name)
    SELECT id, first_name, last_name FROM users
  `);

  db.exec(`DROP TABLE users`);
  db.exec(`ALTER TABLE users_new RENAME TO users`);
};
```

## Running Migrations

### Automatic (Production)

Migrations run automatically when the app starts:

```javascript
// backend/src/db.js
import { runMigrations } from "./migrationRunner.js";

try {
  await runMigrations(db);
} catch (error) {
  logger.error({ err: error }, "Database migration failed");
  throw error;
}
```

If migrations fail, the app exits immediately to prevent running with incorrect schema.

### Manual (Development)

**Check migration status:**

```bash
node -e "
import Database from 'better-sqlite3';
import { getMigrationStatus } from './src/migrationRunner.js';
const db = new Database('/data/airgap-architect.db');
const status = await getMigrationStatus(db);
console.log('Applied:', status.applied);
console.log('Pending:', status.pending);
db.close();
"
```

**Apply pending migrations:**

```bash
node -e "
import Database from 'better-sqlite3';
import { runMigrations } from './src/migrationRunner.js';
const db = new Database('/data/airgap-architect.db');
await runMigrations(db);
db.close();
"
```

**Rollback last migration:**

```bash
node -e "
import Database from 'better-sqlite3';
import { rollbackMigration } from './src/migrationRunner.js';
const db = new Database('/data/airgap-architect.db');
const rolledBack = await rollbackMigration(db);
console.log('Rolled back:', rolledBack);
db.close();
"
```

## Rollback Procedures

### Development Rollback

If you need to undo the last migration during development:

```bash
# Rollback migration
node -e "
import Database from 'better-sqlite3';
import { rollbackMigration } from './src/migrationRunner.js';
const db = new Database('/data/airgap-architect.db');
await rollbackMigration(db);
db.close();
"

# Restart app (with fixed migration code)
npm start
```

### Production Rollback

**⚠️ Production rollbacks require careful planning.**

**Before rollback:**
1. **Backup database:** See `docs/BACKUP_RESTORE.md`
2. **Review down() function:** Ensure it doesn't lose data
3. **Test rollback:** On copy of production database
4. **Plan re-apply:** How to fix and re-apply migration

**Rollback steps:**

```bash
# 1. Backup database
./scripts/backup-sqlite.sh

# 2. Stop application
systemctl stop airgap-architect

# 3. Rollback migration
cd /app/backend
node -e "
import Database from 'better-sqlite3';
import { rollbackMigration } from './src/migrationRunner.js';
const db = new Database('/data/airgap-architect.db');
const rolledBack = await rollbackMigration(db);
console.log('Rolled back:', rolledBack);
db.close();
"

# 4. Fix migration code (deploy corrected version)
# ... deployment process ...

# 5. Restart application (re-applies fixed migration)
systemctl start airgap-architect
```

### Rolling Back Multiple Migrations

There is no batch rollback. Roll back migrations one at a time:

```bash
for i in {1..3}; do
  node -e "
  import Database from 'better-sqlite3';
  import { rollbackMigration } from './src/migrationRunner.js';
  const db = new Database('/data/airgap-architect.db');
  await rollbackMigration(db);
  db.close();
  "
done
```

## Testing Migrations

### Unit Tests

Add tests to `backend/test/migrations.test.js`:

```javascript
describe("Migration NNN", () => {
  it("should create expected tables", async () => {
    const db = createTestDb();
    await runMigrations(db);

    // Verify results
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    assert.ok(tables.some(t => t.name === "expected_table"));

    db.close();
    cleanupTestDb();
  });

  it("should rollback cleanly", async () => {
    const db = createTestDb();
    await runMigrations(db);
    await rollbackMigration(db);

    // Verify rollback
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    assert.ok(!tables.some(t => t.name === "expected_table"));

    db.close();
    cleanupTestDb();
  });
});
```

Run tests:

```bash
cd backend
npm test -- test/migrations.test.js
```

### Manual Testing

**Test on fresh database:**

```bash
# Delete database
rm /data/airgap-architect.db

# Start app
npm start

# Verify schema
sqlite3 /data/airgap-architect.db ".schema"
```

**Test on existing database:**

```bash
# Backup current database
cp /data/airgap-architect.db /data/airgap-architect.db.bak

# Start app (applies new migrations)
npm start

# Verify schema
sqlite3 /data/airgap-architect.db ".schema"

# Restore if needed
mv /data/airgap-architect.db.bak /data/airgap-architect.db
```

## Troubleshooting

### Migration Fails on Startup

**Symptom:** App exits with "Database migration failed"

**Diagnosis:**

```bash
# Check migration status
node -e "
import Database from 'better-sqlite3';
import { getMigrationStatus } from './src/migrationRunner.js';
const db = new Database('/data/airgap-architect.db');
try {
  const status = await getMigrationStatus(db);
  console.log(status);
} catch (error) {
  console.error(error);
}
db.close();
"
```

**Solutions:**

1. **Fix migration code:** Correct syntax errors or logic bugs
2. **Rollback migration:** Remove failed migration record manually
3. **Restore backup:** If data corruption occurred

### Duplicate Column Error

**Symptom:** `"duplicate column name: column_name"`

**Cause:** Migration ran partially (column added but not recorded)

**Fix:**

Check if column exists before adding:

```javascript
export const up = (db) => {
  const columns = db.prepare("PRAGMA table_info(table_name)").all();
  const hasColumn = columns.some((col) => col.name === "column_name");

  if (!hasColumn) {
    db.exec("ALTER TABLE table_name ADD COLUMN column_name TEXT");
  }
};
```

### Migration Recorded But Not Applied

**Symptom:** Migration in `migrations` table but schema changes missing

**Cause:** Migration transaction committed before error occurred

**Fix:**

Remove migration record and re-run:

```bash
sqlite3 /data/airgap-architect.db "DELETE FROM migrations WHERE name = 'NNN_migration_name.js'"
npm start
```

### Cannot Rollback (down function missing)

**Symptom:** `"Migration NNN does not export a 'down' function"`

**Cause:** Migration file missing `down` export

**Fix:**

Add `down` function to migration file:

```javascript
export const down = (db) => {
  // Revert changes from up() function
};
```

## Migration History

### 001_initial_schema.js

**Applied:** 2026-05-27 (v1.7.0)  
**Description:** Captures base schema that existed before formal migration system

**Tables Created:**
- `cache`: Key-value cache for Cincinnati data, operator catalogs
- `jobs`: Background job tracking
- `operator_results`: Operator scan results by version and catalog
- `docs_links`: Documentation links cache
- `app_state`: Application wizard state (singleton)

**Notes:** This migration uses `CREATE TABLE IF NOT EXISTS` to handle databases that already have these tables (backward compatibility with pre-migration deployments).

### 002_add_jobs_metadata.js

**Applied:** 2026-05-27 (v1.7.0)  
**Description:** Adds `metadata_json` column to jobs table

**Changes:**
- Added `metadata_json TEXT DEFAULT ''` to jobs table
- Stores additional structured data about oc-mirror runs (config paths, retry info, etc.)

**Notes:** Checks if column exists before adding (handles databases where ensureJobsMetadataColumn() previously ran). Down migration recreates table without the column (SQLite < 3.35.0 doesn't support DROP COLUMN).

## Best Practices

### DO

✅ **Number migrations sequentially** (001, 002, 003, ...)  
✅ **Use descriptive names** (add_column, create_table, not migration1)  
✅ **Include both up and down** functions  
✅ **Test rollback before deploying**  
✅ **Check column existence** before ALTER TABLE ADD COLUMN  
✅ **Use transactions** (migrations run in transactions automatically)  
✅ **Document complex migrations** with inline comments  
✅ **Test on copy of production data** before production deployment  

### DON'T

❌ **Don't modify existing migrations** after they're deployed (create new migration instead)  
❌ **Don't delete migrations** from migrations/ directory (breaks rollback)  
❌ **Don't assume migration order** (always check `getMigrationStatus()`)  
❌ **Don't skip writing down() function** (makes rollback impossible)  
❌ **Don't lose data in down()** without clear intent (e.g., dropping audit columns)  
❌ **Don't run migrations manually** in production (let app startup handle it)  
❌ **Don't commit failed migrations** to git (fix and test first)  

## Security Considerations

### SQL Injection Prevention

Migrations use `db.exec()` for schema changes (trusted code only). Never construct migration SQL from user input.

**Safe:**
```javascript
db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY)");
```

**Unsafe (never do this):**
```javascript
const tableName = getUserInput(); // NEVER DO THIS
db.exec(`CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY)`);
```

### Production Database Access

- **Backup before migration:** See `docs/BACKUP_RESTORE.md`
- **Test migrations on copy:** Never test rollback on production first
- **Limit access:** Only deployment automation should run migrations
- **Audit migrations:** Review migration code in PR before merge

## Related Documentation

- **Backup & Restore:** `docs/BACKUP_RESTORE.md`
- **Database Schema:** `backend/src/migrations/001_initial_schema.js` (authoritative reference)
- **Migration Runner:** `backend/src/migrationRunner.js` (implementation details)
- **Migration Tests:** `backend/test/migrations.test.js` (usage examples)

---

**Last Updated:** 2026-05-27  
**Version:** 1.0.0 (introduced in v1.7.0)
