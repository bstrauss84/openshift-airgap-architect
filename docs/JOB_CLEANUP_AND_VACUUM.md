# Job Cleanup and SQLite VACUUM Strategy

## Overview

The application implements automated job cleanup to prevent unbounded database growth and maintain optimal performance. This document describes the retention policy, cleanup mechanisms, and SQLite VACUUM strategy.

## Automated Job Cleanup (PROD-012)

### Retention Policy

Jobs are automatically cleaned up based on two criteria:

1. **Age-based retention**: Jobs older than `JOB_RETENTION_DAYS` are deleted
2. **Count-based retention**: If total job count exceeds `JOB_MAX_COUNT`, oldest terminal jobs are deleted

### Environment Variables

```bash
# Keep jobs for 7 days (default)
JOB_RETENTION_DAYS=7

# Keep at most 100 jobs total (default)
JOB_MAX_COUNT=100
```

### Cleanup Behavior

- **Running jobs are never deleted** regardless of age or count limits
- Only terminal state jobs are eligible for cleanup:
  - `completed` - Job finished successfully
  - `failed` - Job encountered an error
  - `cancelled` - Job was manually cancelled

- Cleanup runs on two schedules:
  - **Startup cleanup**: 60 seconds after server start (allows startup jobs to complete)
  - **Daily cleanup**: Every 24 hours thereafter

### Cleanup Logic

1. **Age-based deletion**: Delete terminal jobs where `updated_at < NOW - JOB_RETENTION_DAYS`
2. **Count-based deletion**: If total jobs > `JOB_MAX_COUNT`, delete oldest terminal jobs until within limit
3. **Running job protection**: Jobs with `status = 'running'` are excluded from both cleanup passes

### Manual Cleanup API

DELETE `/api/jobs?completed=true`

Deletes all terminal state jobs immediately (bypasses retention policy).

## SQLite VACUUM Strategy

### What is VACUUM?

SQLite `VACUUM` command rebuilds the database file to:
- Reclaim disk space from deleted records
- Defragment the database for better performance
- Reset auto-increment counters
- Reduce file size

### When to VACUUM

**Automatic triggers (recommended):**
- After job cleanup deletes > 50 jobs
- Database file size > 100 MB and > 25% wasted space
- Once per week during low-usage periods (e.g., Sunday 2 AM)

**Manual triggers:**
```sql
-- Check database size and wasted space
PRAGMA page_count;
PRAGMA freelist_count;
-- If freelist_count / page_count > 0.25, consider VACUUM

-- Run VACUUM
VACUUM;
```

### VACUUM Performance Impact

- **Locks database**: No writes during VACUUM (reads OK)
- **Duration**: Proportional to database size (typically seconds to minutes)
- **Disk space**: Requires 2x database size free space temporarily
- **Best time**: Low-usage periods (nights, weekends)

### Implementation Status

**Current (v1.7.0):**
- ✅ Automated job cleanup with retention policy
- ✅ Configurable retention days and max count
- ✅ Scheduled daily cleanup
- ⏸️ Manual VACUUM required

**Future (v1.8.0+):**
- Automatic VACUUM after cleanup deletes > threshold
- Configurable VACUUM schedule (cron-like)
- Disk space monitoring before VACUUM
- VACUUM progress metrics

### Manual VACUUM Procedure

**Option 1: SQLite CLI**
```bash
# Backup first (always!)
cp /data/app.db /data/app.db.backup

# Run VACUUM
sqlite3 /data/app.db "VACUUM;"

# Check new size
ls -lh /data/app.db
```

**Option 2: Node.js Script**
```javascript
import Database from "better-sqlite3";

const db = new Database("/data/app.db");

console.log("Before VACUUM:", db.prepare("PRAGMA page_count").get());
db.pragma("wal_checkpoint(TRUNCATE)"); // Checkpoint WAL first
db.exec("VACUUM");
console.log("After VACUUM:", db.prepare("PRAGMA page_count").get());

db.close();
```

### VACUUM Best Practices

1. **Always backup before VACUUM**: Use backup scripts in `scripts/backup-sqlite.sh`
2. **Run during low usage**: Avoid peak hours
3. **Monitor disk space**: Ensure 2x database size free
4. **Checkpoint WAL first**: `PRAGMA wal_checkpoint(TRUNCATE)` before VACUUM
5. **Verify integrity after**: `PRAGMA integrity_check`

## Monitoring Job Cleanup

### Log Messages

Successful cleanup:
```
{"level":"info","tag":"job_cleanup","deletedByAge":15,"deletedByCount":5,"totalDeleted":20,"retentionDays":7,"maxJobCount":100,"msg":"Scheduled job cleanup completed"}
```

Failed cleanup:
```
{"level":"error","tag":"job_cleanup","err":{"type":"SqliteError","message":"..."},"msg":"Scheduled job cleanup failed"}
```

### Prometheus Metrics

(Future: v1.8.0+)
```
airgap_job_cleanup_total{status="success|failure"}
airgap_jobs_deleted_total{reason="age|count"}
airgap_database_vacuum_duration_seconds
```

## Troubleshooting

### Jobs Not Being Deleted

**Check retention settings:**
```bash
echo $JOB_RETENTION_DAYS  # Should be 7 (or your custom value)
echo $JOB_MAX_COUNT       # Should be 100 (or your custom value)
```

**Check job status:**
```sql
SELECT status, COUNT(*) FROM jobs GROUP BY status;
-- Only 'completed', 'failed', 'cancelled' are eligible for cleanup
```

**Check job ages:**
```sql
SELECT id, type, status, updated_at FROM jobs ORDER BY updated_at DESC LIMIT 20;
-- Compare updated_at to current time - retention period
```

### Database Growing Too Large

**Check job count:**
```sql
SELECT COUNT(*) FROM jobs;
-- Should be <= JOB_MAX_COUNT after cleanup runs
```

**Run manual cleanup:**
```bash
curl -X DELETE 'http://localhost:4000/api/jobs?completed=true'
```

**VACUUM database:**
```bash
sqlite3 /data/app.db "VACUUM;"
```

### VACUUM Fails

**Insufficient disk space:**
```bash
df -h /data
# Need 2x database size free
```

**Database locked:**
```sql
-- Check for active connections
PRAGMA wal_checkpoint;
-- Try again after checkpoint
```

**WAL file large:**
```sql
PRAGMA wal_checkpoint(TRUNCATE);
-- Truncate WAL, then VACUUM
```

## Related Documentation

- [Backup and Restore](BACKUP_RESTORE.md) - SQLite backup procedures
- [Capacity Planning](CAPACITY_PLANNING.md) - Resource requirements and scaling
- [Health Probes](HEALTH_PROBES.md) - Database health monitoring

## References

- [SQLite VACUUM documentation](https://www.sqlite.org/lang_vacuum.html)
- [SQLite WAL mode](https://www.sqlite.org/wal.html)
- [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
