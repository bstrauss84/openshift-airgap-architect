# SQLite Backup and Restore Procedures

**OpenShift Airgap Architect** - Production Database Operations

---

## Overview

The application uses SQLite with WAL (Write-Ahead Logging) mode for persistent storage at `/data/airgap-architect.db`. This document provides comprehensive backup and restore procedures for production deployments.

**Database Contents:**
- Application state (wizard progress, configurations)
- Background job tracking (mirror syncs, catalog operations)
- Operator scan results cache
- Cincinnati version data cache
- Documentation links index

**Recovery Objectives:**
- **RTO (Recovery Time Objective):** <15 minutes
- **RPO (Recovery Point Objective):** 24 hours (with daily backups)

---

## Backup Methods

### Method 1: Online Backup (VACUUM INTO) - Recommended

**Advantages:**
- No downtime required
- No write pauses
- Consistent point-in-time snapshot
- Built-in integrity verification

**Disadvantages:**
- Requires SQLite 3.27+ (available in modern containers)
- Temporary disk space (2x database size)

**When to Use:**
- Production environments requiring zero downtime
- Daily automated backups
- Ad-hoc backups before major changes

**Automated Script:**

```bash
./scripts/backup-sqlite.sh [namespace] [backup-dir]
```

**Example:**
```bash
# Backup from default namespace to ./backups
./scripts/backup-sqlite.sh default ./backups

# Backup from production namespace
./scripts/backup-sqlite.sh production /mnt/nfs/backups
```

**What It Does:**
1. Finds backend pod in specified namespace
2. Executes `VACUUM INTO` inside pod (creates consistent backup)
3. Copies backup file from pod to local storage
4. Verifies backup integrity
5. Cleans up temporary files in pod

**Manual Steps (if script unavailable):**

```bash
# 1. Find backend pod
POD=$(kubectl get pod -n default -l app=airgap-architect,component=backend -o jsonpath='{.items[0].metadata.name}')

# 2. Create backup inside pod
kubectl exec -n default "$POD" -- \
  sqlite3 /data/airgap-architect.db "VACUUM INTO '/data/backup-$(date +%Y%m%d-%H%M%S).db'"

# 3. Copy backup to local storage
kubectl cp -n default "${POD}:/data/backup-$(date +%Y%m%d-%H%M%S).db" \
  ./backups/airgap-architect-$(date +%Y%m%d-%H%M%S).db

# 4. Cleanup pod backup
kubectl exec -n default "$POD" -- rm "/data/backup-$(date +%Y%m%d-%H%M%S).db"

# 5. Verify backup
./scripts/verify-backup.sh ./backups/airgap-architect-TIMESTAMP.db
```

---

### Method 2: Kubernetes Volume Snapshot

**Advantages:**
- Fast (storage-layer operation)
- Consistent with entire volume
- No pod execution required
- Good for disaster recovery

**Disadvantages:**
- Requires VolumeSnapshot support in storage class
- Captures entire PVC (may include other files)
- Restore requires PVC creation

**When to Use:**
- Disaster recovery scenarios
- Pre-upgrade snapshots
- Storage migration
- Kubernetes clusters with snapshot-capable storage

**Prerequisites:**
- Storage class with snapshot support
- VolumeSnapshot CRD installed
- CSI driver supporting snapshots

**Steps:**

```bash
# 1. Create VolumeSnapshot
cat <<EOF | kubectl apply -f -
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: airgap-architect-snapshot-$(date +%Y%m%d-%H%M%S)
  namespace: default
spec:
  volumeSnapshotClassName: csi-snapclass
  source:
    persistentVolumeClaimName: airgap-architect-data
EOF

# 2. Verify snapshot ready
kubectl get volumesnapshot -n default

# 3. Verify readyToUse is true
kubectl describe volumesnapshot -n default airgap-architect-snapshot-TIMESTAMP
```

**Restore from Volume Snapshot:**

```bash
# 1. Create PVC from snapshot
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: airgap-architect-data-restored
  namespace: default
spec:
  dataSource:
    name: airgap-architect-snapshot-TIMESTAMP
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  storageClassName: gp3
EOF

# 2. Update deployment to use restored PVC
kubectl patch deployment airgap-architect-backend -n default \
  -p '{"spec":{"template":{"spec":{"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"airgap-architect-data-restored"}}]}}}}'

# 3. Restart deployment
kubectl rollout restart deployment airgap-architect-backend -n default
```

---

### Method 3: File Copy with WAL Checkpoint

**Advantages:**
- Simple, no special tools required
- Works with any SQLite version
- Good for local testing

**Disadvantages:**
- Requires brief write pause (WAL checkpoint)
- Less safe than VACUUM INTO
- Not recommended for production

**When to Use:**
- Local development backups
- Testing restore procedures
- Emergency backup when VACUUM fails

**Steps:**

```bash
# 1. Find backend pod
POD=$(kubectl get pod -n default -l app=airgap-architect,component=backend -o jsonpath='{.items[0].metadata.name}')

# 2. Checkpoint WAL (pause writes briefly)
kubectl exec -n default "$POD" -- \
  sqlite3 /data/airgap-architect.db "PRAGMA wal_checkpoint(TRUNCATE);"

# 3. Copy database file
kubectl cp -n default "${POD}:/data/airgap-architect.db" \
  ./backups/airgap-architect-$(date +%Y%m%d-%H%M%S).db

# 4. Verify backup
./scripts/verify-backup.sh ./backups/airgap-architect-TIMESTAMP.db
```

---

## Restore Procedures

### Restore from Online Backup

**Automated Script:**

```bash
./scripts/restore-sqlite.sh <backup-file> [namespace]
```

**Example:**
```bash
./scripts/restore-sqlite.sh ./backups/airgap-architect-20260520-143000.db default
```

**What It Does:**
1. Verifies backup integrity before restore
2. Prompts for confirmation (destructive operation)
3. Scales backend deployment to 0 replicas
4. Waits for pod termination
5. Scales back to 1 replica (new pod starts)
6. Copies backup to new pod
7. Replaces database file
8. Removes WAL files (fresh start)
9. Restarts pod to pick up new database

**Manual Steps:**

```bash
# 1. Verify backup
./scripts/verify-backup.sh ./backups/airgap-architect-TIMESTAMP.db

# 2. Scale down backend
kubectl scale deployment -n default airgap-architect-backend --replicas=0
kubectl wait --for=delete pod -n default -l app=airgap-architect,component=backend --timeout=60s

# 3. Scale back up
kubectl scale deployment -n default airgap-architect-backend --replicas=1
kubectl wait --for=condition=ready pod -n default -l app=airgap-architect,component=backend --timeout=60s

# 4. Get new pod
POD=$(kubectl get pod -n default -l app=airgap-architect,component=backend -o jsonpath='{.items[0].metadata.name}')

# 5. Copy backup to pod
kubectl cp ./backups/airgap-architect-TIMESTAMP.db -n default "${POD}:/data/airgap-architect-restore.db"

# 6. Replace database
kubectl exec -n default "$POD" -- sh -c "
  mv /data/airgap-architect.db /data/airgap-architect.db.old || true
  mv /data/airgap-architect-restore.db /data/airgap-architect.db
  rm -f /data/airgap-architect.db-wal /data/airgap-architect.db-shm
"

# 7. Restart pod
kubectl delete pod -n default "$POD"
kubectl wait --for=condition=ready pod -n default -l app=airgap-architect,component=backend --timeout=60s

# 8. Verify application
curl http://localhost:3001/api/health
```

---

### Restore from Volume Snapshot

See Method 2: Kubernetes Volume Snapshot above for restore procedure.

---

## Backup Verification

**Always verify backups before trusting them for recovery.**

**Automated Script:**

```bash
./scripts/verify-backup.sh <backup-file>
```

**What It Checks:**
1. SQLite integrity check (PRAGMA integrity_check)
2. App state table exists and readable
3. All expected tables present (5+ tables)

**Example Output:**
```
Verifying backup: ./backups/airgap-architect-20260520-143000.db
  Integrity check... ✓ OK
  App state check... ✓ OK (3 rows)
  Table check... ✓ OK (6 tables)
✓ Backup verification complete
```

**Manual Verification:**

```bash
sqlite3 ./backups/airgap-architect-TIMESTAMP.db "PRAGMA integrity_check;"
# Expected: ok

sqlite3 ./backups/airgap-architect-TIMESTAMP.db "SELECT COUNT(*) FROM app_state;"
# Expected: >= 0

sqlite3 ./backups/airgap-architect-TIMESTAMP.db ".tables"
# Expected: app_state cache docs_links jobs operator_results
```

---

## Disaster Recovery Scenarios

### Scenario 1: Complete Data Loss

**Situation:** PVC deleted, database corrupted beyond repair.

**Recovery:**
1. Stop backend deployment: `kubectl scale deployment airgap-architect-backend --replicas=0`
2. Delete corrupted PVC: `kubectl delete pvc airgap-architect-data`
3. Create new PVC (deployment will auto-create, or manually create)
4. Scale up deployment: `kubectl scale deployment airgap-architect-backend --replicas=1`
5. Wait for pod ready: `kubectl wait --for=condition=ready pod -l app=airgap-architect,component=backend --timeout=60s`
6. Restore from backup: `./scripts/restore-sqlite.sh <backup-file>`
7. Verify application: Access UI and check wizard state

**RTO:** 10-15 minutes  
**RPO:** Last backup (24 hours if daily backups)

---

### Scenario 2: Partial Corruption

**Situation:** Database file exists but has corrupted pages.

**Detection:**
```bash
POD=$(kubectl get pod -l app=airgap-architect,component=backend -o jsonpath='{.items[0].metadata.name}')
kubectl exec "$POD" -- sqlite3 /data/airgap-architect.db "PRAGMA integrity_check;"
# Output: *** in database main ***
# Page X: btree page does not have a usable amount of space
```

**Recovery:**
1. Attempt to dump good data:
```bash
kubectl exec "$POD" -- sqlite3 /data/airgap-architect.db ".dump" > recovered.sql
```

2. If dump fails, restore from backup:
```bash
./scripts/restore-sqlite.sh ./backups/airgap-architect-LATEST.db
```

**RTO:** 15-30 minutes  
**RPO:** Last backup or last good dump

---

### Scenario 3: Migration to New Cluster

**Situation:** Moving application to new Kubernetes cluster.

**Steps:**

1. **Source Cluster:**
```bash
# Backup from source
./scripts/backup-sqlite.sh default ./migration-backups

# Verify backup
./scripts/verify-backup.sh ./migration-backups/airgap-architect-TIMESTAMP.db
```

2. **Target Cluster:**
```bash
# Deploy application (without existing data)
kubectl apply -f kubernetes/

# Wait for backend ready
kubectl wait --for=condition=ready pod -l app=airgap-architect,component=backend --timeout=120s

# Restore backup
./scripts/restore-sqlite.sh ./migration-backups/airgap-architect-TIMESTAMP.db default

# Verify application
curl http://CLUSTER_IP:3001/api/health
```

**RTO:** 20-30 minutes (includes deployment)  
**RPO:** Migration snapshot (zero data loss)

---

### Scenario 4: Rollback After Bad Upgrade

**Situation:** Application upgrade caused data corruption or unexpected behavior.

**Prevention:** Always backup before upgrades.

**Recovery:**

```bash
# 1. Rollback deployment
kubectl rollout undo deployment airgap-architect-backend

# 2. Restore pre-upgrade backup
./scripts/restore-sqlite.sh ./backups/pre-upgrade-airgap-architect.db

# 3. Verify application
curl http://localhost:3001/api/health
```

**RTO:** 5-10 minutes  
**RPO:** Pre-upgrade snapshot (zero data loss)

---

## Best Practices

### Backup Frequency

**Recommended Schedule:**
- **Daily:** Automated backups at 2 AM local time
- **Pre-change:** Manual backup before upgrades, config changes
- **Weekly:** Long-term retention snapshots
- **Monthly:** Archive snapshots for compliance

**Example Cron Job:**

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: airgap-architect-backup
  namespace: default
spec:
  schedule: "0 2 * * *"  # 2 AM daily
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: alpine:3.18
            command:
            - /bin/sh
            - -c
            - |
              apk add --no-cache sqlite curl
              POD=$(kubectl get pod -l app=airgap-architect,component=backend -o jsonpath='{.items[0].metadata.name}')
              TIMESTAMP=$(date +%Y%m%d-%H%M%S)
              kubectl exec "$POD" -- sqlite3 /data/airgap-architect.db "VACUUM INTO '/data/backup-${TIMESTAMP}.db'"
              kubectl cp "${POD}:/data/backup-${TIMESTAMP}.db" "/backups/airgap-architect-${TIMESTAMP}.db"
              kubectl exec "$POD" -- rm "/data/backup-${TIMESTAMP}.db"
            volumeMounts:
            - name: backup-storage
              mountPath: /backups
          volumes:
          - name: backup-storage
            persistentVolumeClaim:
              claimName: backup-pvc
          restartPolicy: OnFailure
```

---

### Retention Policy

**Recommended Retention:**
- **Daily backups:** Keep 7 days
- **Weekly backups:** Keep 4 weeks
- **Monthly backups:** Keep 12 months

**Automated Cleanup Script:**

```bash
#!/bin/bash
# scripts/cleanup-old-backups.sh
BACKUP_DIR=${1:-./backups}

# Keep last 7 daily backups
find "$BACKUP_DIR" -name "airgap-architect-*.db" -mtime +7 -delete

# Keep weekly backups (Sundays) for 4 weeks
# Keep monthly backups (1st of month) for 12 months
# (Implement as needed based on naming convention)
```

---

### Test Restore Procedures

**Quarterly Testing:**

1. Create test namespace:
```bash
kubectl create namespace airgap-test
```

2. Deploy application in test namespace:
```bash
kubectl apply -f kubernetes/ -n airgap-test
```

3. Restore latest backup:
```bash
./scripts/restore-sqlite.sh ./backups/airgap-architect-LATEST.db airgap-test
```

4. Verify application functionality:
- Access UI
- Check wizard state
- Verify background jobs
- Test export generation

5. Cleanup:
```bash
kubectl delete namespace airgap-test
```

**Document test results:**
- Date tested
- Backup age
- Restore time (RTO)
- Issues encountered
- Resolution steps

---

### Off-Site Storage

**Critical for disaster recovery.**

**Options:**

1. **S3-Compatible Storage:**
```bash
# Upload to S3
aws s3 cp ./backups/airgap-architect-TIMESTAMP.db \
  s3://backup-bucket/airgap-architect/TIMESTAMP.db

# Download from S3
aws s3 cp s3://backup-bucket/airgap-architect/TIMESTAMP.db \
  ./backups/airgap-architect-TIMESTAMP.db
```

2. **NFS/Network Storage:**
```bash
# Mount NFS in backup script
mount -t nfs nfs-server:/backups /mnt/nfs-backups
./scripts/backup-sqlite.sh default /mnt/nfs-backups
```

3. **Rsync to Remote Server:**
```bash
rsync -avz ./backups/ backup-server:/opt/backups/airgap-architect/
```

---

### Monitoring and Alerting

**Monitor backup success:**

1. **Check backup file exists:**
```bash
# Alert if no backup in last 25 hours
find /backups -name "airgap-architect-*.db" -mtime -1 | grep -q . || echo "ALERT: No recent backup"
```

2. **Check backup size:**
```bash
# Alert if backup size drops significantly
CURRENT_SIZE=$(stat -c%s /backups/airgap-architect-LATEST.db)
EXPECTED_MIN_SIZE=1048576  # 1 MB minimum
if [ "$CURRENT_SIZE" -lt "$EXPECTED_MIN_SIZE" ]; then
  echo "ALERT: Backup size too small"
fi
```

3. **Check backup integrity:**
```bash
# Alert if integrity check fails
./scripts/verify-backup.sh /backups/airgap-architect-LATEST.db || echo "ALERT: Backup integrity failed"
```

**Prometheus Metrics (future enhancement):**
- `backup_last_success_timestamp` - Last successful backup
- `backup_duration_seconds` - Backup operation duration
- `backup_size_bytes` - Backup file size
- `backup_integrity_check` - Integrity verification result

---

## Troubleshooting

### Backup Script Fails: "No backend pod found"

**Cause:** Backend deployment not running or label mismatch.

**Solution:**
```bash
# Check backend pods
kubectl get pods -l app=airgap-architect,component=backend

# If no pods, check deployment
kubectl get deployment airgap-architect-backend

# Check logs
kubectl logs deployment/airgap-architect-backend
```

---

### Backup Integrity Check Fails

**Cause:** Backup file corrupted during copy or storage failure.

**Solution:**
1. Delete corrupted backup
2. Create new backup immediately
3. Check storage health (disk errors, network issues)
4. Verify kubectl cp works correctly

---

### Restore Fails: "PRAGMA integrity_check failed"

**Cause:** Backup file corrupted.

**Solution:**
1. Try previous backup:
```bash
ls -lt ./backups/airgap-architect-*.db | head -n 5
./scripts/restore-sqlite.sh ./backups/airgap-architect-PREVIOUS.db
```

2. If all backups corrupted, check backup process and storage

---

### Pod Won't Start After Restore

**Cause:** Database file permissions or WAL mode issues.

**Solution:**
```bash
POD=$(kubectl get pod -l app=airgap-architect,component=backend -o jsonpath='{.items[0].metadata.name}')

# Check file permissions
kubectl exec "$POD" -- ls -la /data/

# Reset permissions
kubectl exec "$POD" -- chown -R node:node /data/

# Remove WAL files
kubectl exec "$POD" -- rm -f /data/airgap-architect.db-wal /data/airgap-architect.db-shm

# Check logs
kubectl logs "$POD"
```

---

### VACUUM INTO Fails: "Disk Full"

**Cause:** Insufficient disk space (needs 2x database size).

**Solution:**
1. Check disk usage:
```bash
kubectl exec "$POD" -- df -h /data
```

2. Clean up old files or increase PVC size:
```bash
kubectl patch pvc airgap-architect-data -p '{"spec":{"resources":{"requests":{"storage":"20Gi"}}}}'
```

3. Use Method 3 (file copy) if expansion not possible

---

## Related Documentation

- [Production Deployment Guide](PRODUCTION_DEPLOYMENT.md) - PROD-001
- [Disaster Recovery SLAs](DISASTER_RECOVERY_SLAS.md) - PROD-006
- [Database Health Monitoring](HEALTH_MONITORING.md) - PROD-007

---

## Changelog

| Date | Version | Changes |
|---|---|---|
| 2026-05-20 | 1.0.0 | Initial backup/restore procedures (PROD-005) |

---

**Last Updated:** 2026-05-20  
**Maintained By:** OpenShift Airgap Architect Team
