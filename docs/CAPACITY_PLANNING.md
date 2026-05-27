# OpenShift Airgap Architect - Capacity Planning Guide

**Version:** 1.0  
**Last Updated:** 2026-05-20  
**Applies to:** v1.x deployment (Kubernetes/OpenShift)

This document provides comprehensive capacity planning guidance for deploying OpenShift Airgap Architect in production Kubernetes/OpenShift environments.

---

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Resource Requirements](#resource-requirements)
3. [Defined Resource Limits](#defined-resource-limits)
4. [Storage Requirements](#storage-requirements)
5. [Concurrent Operation Limits](#concurrent-operation-limits)
6. [Scaling Recommendations](#scaling-recommendations)
7. [Production Deployment Sizes](#production-deployment-sizes)
8. [Monitoring and Alerting](#monitoring-and-alerting)
9. [Performance Expectations](#performance-expectations)
10. [Tuning Recommendations](#tuning-recommendations)
11. [Load Testing](#load-testing)
12. [Disaster Recovery](#disaster-recovery)
13. [Troubleshooting](#troubleshooting)

---

## Quick Reference

### Minimum Requirements (Small Deployment)

| Component | CPU | Memory | Storage | Replicas |
|-----------|-----|--------|---------|----------|
| Backend | 500m | 1Gi | 250Gi PVC | 1 (fixed) |
| Frontend | 100m | 256Mi | - | 1-2 |
| **Total** | **600m-700m** | **1.25-1.5Gi** | **250Gi** | **2-3 pods** |

### Recommended Production (Medium Deployment)

| Component | CPU | Memory | Storage | Replicas |
|-----------|-----|--------|---------|----------|
| Backend | 1000m | 2Gi | 250Gi PVC | 1 (fixed) |
| Frontend | 200m | 512Mi | - | 2-3 |
| **Total** | **1.4-1.6 cores** | **3-3.5Gi** | **250Gi** | **3-4 pods** |

### High-Load (Large Deployment)

| Component | CPU | Memory | Storage | Replicas |
|-----------|-----|--------|---------|----------|
| Backend | 2000m | 4Gi | 500Gi PVC | 1 (fixed) |
| Frontend | 500m | 512Mi | - | 3-5 |
| **Total** | **3.5-4.5 cores** | **5.5-6Gi** | **500Gi** | **4-6 pods** |

---

## Resource Requirements

### Backend Pod

The backend handles all business logic, database operations, external API calls, and spawns oc-mirror processes.

**Base Requirements:**
- **CPU:** 500m (0.5 cores) minimum
  - Typical usage: 200-400m idle, 800-1500m during YAML generation
  - Spike to 2000m during oc-mirror operations (process spawn overhead)
- **Memory:** 1Gi minimum
  - Typical usage: 400-800Mi idle
  - 1.5-2Gi during oc-mirror jobs (spawned process overhead)
  - 3-4Gi peak for large operator catalog scans
- **Disk I/O:** Medium to High
  - SQLite database reads/writes (state persistence)
  - oc-mirror workspace I/O (image manifest downloads, tar creation)
  - Temporary file operations (YAML generation, Field Guide rendering)

**Process Model:**
- Single Node.js process (Express server)
- Spawns oc-mirror child processes for image mirroring
- Spawns openshift-install for version manifests (minimal overhead)

**Key Dependencies:**
- SQLite database (single-writer, file-based)
- oc-mirror binary (~500MB, downloaded on-demand)
- openshift-install binary (~150MB, downloaded on-demand)

### Frontend Pod

The frontend is a static Vite-built React SPA served by a simple HTTP server.

**Base Requirements:**
- **CPU:** 100m (0.1 cores) minimum
  - Typical usage: 50-80m
  - Spike to 200-300m under high concurrent user load
- **Memory:** 256Mi minimum
  - Typical usage: 150-200Mi
  - Up to 512Mi under sustained load (static asset caching)
- **Disk I/O:** Low
  - Static assets only (HTML, JS, CSS)
  - No database or file operations

**Process Model:**
- Single Node.js process (HTTP server)
- Stateless: all application state in backend

**Scaling:**
- Horizontally scalable (increase replicas for more users)
- Default: 2 replicas (high availability)
- Recommended max: 5 replicas (diminishing returns beyond this)

---

## Defined Resource Limits

These limits are configured in `manifests/base/backend-deployment.yaml` and `manifests/base/frontend-deployment.yaml`.

### Backend Resources

```yaml
resources:
  requests:
    cpu: "500m"      # 0.5 cores guaranteed
    memory: "1Gi"    # 1 GiB guaranteed
  limits:
    cpu: "2000m"     # 2 cores max (throttled beyond this)
    memory: "4Gi"    # 4 GiB max (OOM kill beyond this)
```

**Rationale:**
- **500m request:** Ensures responsive YAML generation and API operations
- **2000m limit:** Allows oc-mirror process spawn overhead without unbounded CPU usage
- **1Gi request:** Sufficient for typical wizard operations + SQLite cache
- **4Gi limit:** Handles large operator catalog scans without OOM

**Scaling Constraints:**
- Backend MUST run exactly 1 replica (SQLite single-writer limitation)
- Deployment strategy: `Recreate` (ensures only one pod accesses SQLite at a time)

### Frontend Resources

```yaml
resources:
  requests:
    cpu: "100m"      # 0.1 cores guaranteed
    memory: "256Mi"  # 256 MiB guaranteed
  limits:
    cpu: "500m"      # 0.5 cores max
    memory: "512Mi"  # 512 MiB max
```

**Rationale:**
- **100m request:** Minimal for static HTTP serving
- **500m limit:** Handles concurrent user traffic without impacting other workloads
- **256Mi request:** Sufficient for static asset serving + HTTP caching
- **512Mi limit:** Prevents memory leaks from impacting cluster

**Scaling Constraints:**
- Frontend can scale horizontally (2-5 replicas recommended)
- Deployment strategy: `RollingUpdate` (zero-downtime deployments)

### When to Adjust Limits

**Increase backend memory if:**
- You see OOM kills: `kubectl get events --field-selector reason=OOMKilled`
- Mirroring >100GB images in single oc-mirror job
- Running many concurrent operator catalog scans

**Increase backend CPU if:**
- YAML generation takes >2 seconds (slow user experience)
- API response times consistently >500ms
- oc-mirror jobs fail with timeout errors

**Increase frontend replicas if:**
- >20 concurrent wizard users reported
- API response times degrade under load (backend overloaded)
- Pod CPU consistently >80% of limit

**Decrease limits if:**
- Cluster resources are scarce
- Typical usage is consistently <50% of limits
- You want to co-locate with other workloads

---

## Storage Requirements

### PersistentVolumeClaim (PVC)

Configured in `manifests/base/pvc.yaml`:

```yaml
spec:
  accessModes:
  - ReadWriteOnce  # SQLite single-writer requirement
  resources:
    requests:
      storage: 250Gi  # Recommended default
```

**What Lives on the PVC:**

1. **SQLite Database:** `/data/app.db`
   - Typical size: 10-50MB (state snapshots, Cincinnati cache)
   - Maximum size: ~500MB (many saved configurations, long cache history)

2. **oc-mirror Workspace:** `/data/oc-mirror-workspace/`
   - Per-job size: 50-200GB (varies by OCP version and operator count)
   - Multiple jobs accumulate (old workspaces not auto-deleted)

3. **Downloaded Binaries:** `/data/cache/`
   - oc-mirror binary: ~500MB
   - openshift-install binaries: ~150MB per version
   - Total: ~1-2GB

4. **Temporary Files:** `/data/tmp/`
   - Generated YAML files: <1MB per generation
   - Field Guide PDFs: ~500KB per document
   - Auto-cleaned on pod restart

**Sizing Recommendations:**

| Use Case | PVC Size | Rationale |
|----------|----------|-----------|
| Development/Testing | 50Gi | Single OCP version, minimal operator mirroring |
| Small Production (1-3 OCP versions) | 100Gi | 2-3 oc-mirror jobs, limited operators |
| **Recommended Production** | **250Gi** | 5-10 oc-mirror jobs, full operator catalogs |
| Large Production (many versions) | 500Gi+ | 10+ OCP versions, comprehensive operator sets |
| High-side (disconnected) | 1Ti+ | Long-term archive of all mirrored content |

**Storage Class Recommendations:**

- **Best:** SSD-backed storage (improves SQLite query performance)
- **Acceptable:** Network-attached storage (NFS, Ceph RBD)
- **Avoid:** Slow spinning disks (SQLite write latency >100ms impacts UX)

**Example storageClassName configuration:**

```yaml
# AWS EKS
storageClassName: gp3-csi

# Azure AKS
storageClassName: managed-csi-premium

# OpenShift Container Storage
storageClassName: ocs-storagecluster-ceph-rbd

# VMware vSphere
storageClassName: thin-csi
```

**Disk Space Monitoring:**

Alert when:
- PVC usage >80% (prevents oc-mirror job failures)
- PVC usage >90% (critical, may cause pod eviction)

Cleanup strategies:
- Delete old oc-mirror workspaces: `rm -rf /data/oc-mirror-workspace/old-*`
- Vacuum SQLite: `sqlite3 /data/app.db 'VACUUM;'` (recovers deleted space)
- Archive old configurations: move to S3/external storage

---

## Concurrent Operation Limits

### oc-mirror Jobs

**Limit:** 1 active job at a time

**Why:**
- oc-mirror spawns multiple goroutines (internal concurrency)
- Each job can consume 1-2GB RAM + significant CPU
- Multiple concurrent jobs risk OOM kills

**Backend Enforcement:**
- Job queue system (implemented in `backend/src/ocMirrorJob.js`)
- New jobs wait until active job completes
- Clients poll for job status

**Scaling Workaround:**
- Increase backend memory limit to 6-8Gi for concurrent jobs (experimental)
- NOT RECOMMENDED: SQLite lock contention, unpredictable resource usage

### Operator Catalog Scans

**Limit:** 3-5 concurrent scans (soft limit)

**Why:**
- Network I/O bound (fetching operator metadata from registries)
- Minimal memory per scan (~50-100MB)
- Too many concurrent scans may trigger rate limits on registry.redhat.io

**Backend Behavior:**
- No hard enforcement (Node.js async I/O handles this naturally)
- Typical usage: 1-2 scans at a time (user-initiated)

**Tuning:**
- If you see registry.redhat.io 429 errors: reduce concurrent scans
- Set environment variable: `MAX_CONCURRENT_OPERATOR_SCANS=3`

### Cincinnati Version Refreshes

**Limit:** No limit (lightweight)

**Why:**
- Simple HTTP GET requests (~50KB response)
- Cached in SQLite (1-hour TTL)
- Minimal resource impact

**Backend Behavior:**
- On-demand queries (user navigates to version dropdown)
- Automatic background refresh (every 4 hours)

### Wizard Users (Concurrent Sessions)

**Typical Limit:** 10-20 concurrent users per deployment

**Why:**
- SQLite write serialization (one state save at a time)
- Backend CPU/memory capacity
- Frontend replica count

**Measured Capacity:**
- With default resource limits: 10 concurrent users (comfortable)
- With increased limits (2 cores, 4Gi): 20-30 concurrent users
- With 5 frontend replicas: 50+ concurrent users (backend becomes bottleneck)

**Bottleneck Analysis:**
1. **Backend CPU:** YAML generation is CPU-intensive
2. **SQLite writes:** State saves serialize (100-200ms per write)
3. **Network I/O:** Cincinnati/operator queries compete for bandwidth

**Scaling Recommendations:**
- **<10 users:** Default configuration sufficient
- **10-30 users:** Increase backend CPU to 1500m, add frontend replica
- **30-50 users:** Increase backend to 2000m/4Gi, 3-5 frontend replicas
- **50+ users:** Consider external PostgreSQL (requires code changes)

---

## Scaling Recommendations

### Vertical Scaling (Increase Pod Resources)

**When to scale vertically:**
- Single-user operations are slow (YAML generation, oc-mirror)
- Pod CPU/memory consistently >80% of limit
- OOM kills or CPU throttling observed

**How to scale:**

1. Edit deployment manifest:
   ```bash
   kubectl edit deployment airgap-architect-backend
   ```

2. Update resource limits:
   ```yaml
   resources:
     requests:
       cpu: "1000m"  # Increase from 500m
       memory: "2Gi"  # Increase from 1Gi
     limits:
       cpu: "2500m"   # Increase from 2000m
       memory: "6Gi"  # Increase from 4Gi
   ```

3. Apply changes (triggers pod restart):
   ```bash
   kubectl rollout status deployment airgap-architect-backend
   ```

### Horizontal Scaling (Increase Replicas)

**Frontend only** (backend CANNOT scale horizontally due to SQLite)

**When to scale horizontally:**
- Many concurrent users (>10 simultaneous wizard sessions)
- Frontend pod CPU >60% under normal load
- Want zero-downtime deployments (rolling updates)

**How to scale:**

```bash
# Scale to 3 frontend replicas
kubectl scale deployment airgap-architect-frontend --replicas=3

# Verify scaling
kubectl get pods -l component=frontend
```

**Automatic scaling (HPA):**

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: airgap-architect-frontend-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: airgap-architect-frontend
  minReplicas: 2
  maxReplicas: 5
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70  # Scale up when >70% CPU
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80  # Scale up when >80% memory
```

**Frontend scaling limits:**
- Minimum: 1 replica (not recommended for production)
- Recommended: 2-3 replicas (high availability + moderate load)
- Maximum: 5 replicas (diminishing returns, backend becomes bottleneck)

### Backend Scaling Constraints

**CANNOT increase replicas beyond 1.**

**Why:**
- SQLite is single-writer (multiple pods = database corruption)
- Deployment strategy is `Recreate` (enforces single pod)

**Workarounds for high load:**

1. **Read Replicas (Future Enhancement):**
   - Use PostgreSQL/MySQL instead of SQLite
   - Read replicas for state queries
   - Single writer for state updates
   - Requires code changes (not implemented)

2. **Queue System (Future Enhancement):**
   - Separate oc-mirror job worker pods
   - Backend delegates jobs to worker queue
   - Workers can scale horizontally
   - Requires code changes (not implemented)

3. **External Storage (Current Workaround):**
   - Increase backend resources (vertical scaling only)
   - Optimize SQLite queries (add indexes)
   - Use SSD storage for faster I/O

---

## Production Deployment Sizes

### Small Deployment (1-10 Users)

**Use Case:**
- Single team (5-10 engineers)
- Occasional deployments (1-2 per month)
- Limited OCP versions (1-2 versions)

**Resources:**

```yaml
Backend:
  replicas: 1
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: 1500m
      memory: 2Gi

Frontend:
  replicas: 1
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 300m
      memory: 512Mi

Storage:
  pvc: 100Gi
```

**Total Cluster Resources:**
- CPU: 600m request, 1.8 cores limit
- Memory: 1.25Gi request, 2.5Gi limit
- Storage: 100Gi PVC

**Expected Performance:**
- YAML generation: <1s
- oc-mirror jobs: 30-60 min (50GB image set)
- Concurrent users: 5 comfortable, 10 max

---

### Medium Deployment (10-50 Users) - RECOMMENDED

**Use Case:**
- Multiple teams (10-30 engineers)
- Regular deployments (weekly)
- Multiple OCP versions (3-5 versions)
- Full operator catalog mirroring

**Resources:**

```yaml
Backend:
  replicas: 1
  resources:
    requests:
      cpu: 1000m
      memory: 2Gi
    limits:
      cpu: 2000m
      memory: 4Gi

Frontend:
  replicas: 2
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi

Storage:
  pvc: 250Gi
```

**Total Cluster Resources:**
- CPU: 1.2 cores request, 3 cores limit
- Memory: 2.5Gi request, 5Gi limit
- Storage: 250Gi PVC

**Expected Performance:**
- YAML generation: <500ms
- oc-mirror jobs: 30-45 min (100GB image set)
- Concurrent users: 15-20 comfortable, 30 max

**This is the recommended default configuration for production.**

---

### Large Deployment (50+ Users)

**Use Case:**
- Enterprise-wide platform team
- Continuous deployments (daily)
- Many OCP versions (5-10 versions)
- Comprehensive operator catalog
- High-side/air-gapped with long-term archive

**Resources:**

```yaml
Backend:
  replicas: 1
  resources:
    requests:
      cpu: 1500m
      memory: 3Gi
    limits:
      cpu: 2000m
      memory: 4Gi

Frontend:
  replicas: 3-5  # Use HPA
  resources:
    requests:
      cpu: 200m
      memory: 512Mi
    limits:
      cpu: 500m
      memory: 512Mi

Storage:
  pvc: 500Gi - 1Ti
```

**Total Cluster Resources:**
- CPU: 2.1-2.5 cores request, 4.5-5 cores limit
- Memory: 4.5-5.5Gi request, 6.5-7Gi limit
- Storage: 500Gi-1Ti PVC

**Expected Performance:**
- YAML generation: <300ms
- oc-mirror jobs: 45-90 min (200GB+ image sets)
- Concurrent users: 30-50 comfortable

**Additional Recommendations:**
- Use HPA for frontend (2-5 replicas based on load)
- SSD-backed storage (NVMe preferred)
- Dedicated nodeSelector for performance isolation
- Prometheus/Grafana monitoring
- Automated backup/restore

---

## Monitoring and Alerting

### Key Metrics to Track

#### Resource Utilization

1. **CPU Usage:**
   - Backend: `container_cpu_usage_seconds_total{pod=~"airgap-architect-backend-.*"}`
   - Frontend: `container_cpu_usage_seconds_total{pod=~"airgap-architect-frontend-.*"}`
   - **Alert on:** >80% of limit for >5 minutes

2. **Memory Usage:**
   - Backend: `container_memory_working_set_bytes{pod=~"airgap-architect-backend-.*"}`
   - Frontend: `container_memory_working_set_bytes{pod=~"airgap-architect-frontend-.*"}`
   - **Alert on:** >85% of limit (approaching OOM)

3. **Disk Usage:**
   - PVC usage: `kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes`
   - **Alert on:** >80% full (prevent oc-mirror job failures)

#### Application Performance

4. **API Response Times:**
   - Health check: `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{endpoint="/api/health"}[5m]))`
   - State operations: `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{endpoint="/api/state"}[5m]))`
   - YAML generation: `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{endpoint="/api/generate"}[5m]))`
   - **Alert on:** P95 >2s (degraded user experience)

5. **oc-mirror Job Duration:**
   - Track custom metric: `ocmirror_job_duration_seconds`
   - **Alert on:** >2 hours (likely stalled or failing)

6. **Error Rates:**
   - HTTP 5xx errors: `rate(http_requests_total{status=~"5.."}[5m])`
   - **Alert on:** >1% error rate

#### Availability

7. **Pod Restarts:**
   - `kube_pod_container_status_restarts_total{pod=~"airgap-architect-.*"}`
   - **Alert on:** >3 restarts in 1 hour (crash loop)

8. **OOM Kills:**
   - Check events: `kubectl get events --field-selector reason=OOMKilled`
   - **Alert on:** Any OOM kill (increase memory limit)

9. **Probe Failures:**
   - Liveness: `kube_pod_container_status_ready{pod=~"airgap-architect-.*"} == 0`
   - **Alert on:** Pod not ready for >2 minutes

### Sample Prometheus Alerts

```yaml
groups:
- name: airgap-architect
  rules:
  # CPU throttling
  - alert: AirgapArchitectHighCPU
    expr: |
      rate(container_cpu_usage_seconds_total{pod=~"airgap-architect-.*"}[5m])
      / on(pod) kube_pod_container_resource_limits{resource="cpu", pod=~"airgap-architect-.*"}
      > 0.8
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "Airgap Architect pod {{ $labels.pod }} CPU >80%"
      description: "Consider increasing CPU limit or investigating high load."

  # Memory pressure
  - alert: AirgapArchitectHighMemory
    expr: |
      container_memory_working_set_bytes{pod=~"airgap-architect-.*"}
      / on(pod) kube_pod_container_resource_limits{resource="memory", pod=~"airgap-architect-.*"}
      > 0.85
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "Airgap Architect pod {{ $labels.pod }} memory >85%"
      description: "Risk of OOM kill. Increase memory limit."

  # Disk space
  - alert: AirgapArchitectDiskFull
    expr: |
      kubelet_volume_stats_used_bytes{persistentvolumeclaim="airgap-architect-data"}
      / kubelet_volume_stats_capacity_bytes{persistentvolumeclaim="airgap-architect-data"}
      > 0.8
    for: 10m
    labels:
      severity: warning
    annotations:
      summary: "Airgap Architect PVC >80% full"
      description: "Clean up old oc-mirror workspaces or expand PVC."

  # API latency
  - alert: AirgapArchitectSlowAPI
    expr: |
      histogram_quantile(0.95,
        rate(http_request_duration_seconds_bucket{pod=~"airgap-architect-backend-.*"}[5m])
      ) > 2
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "Airgap Architect API P95 latency >2s"
      description: "Check backend resource limits and database performance."

  # Error rate
  - alert: AirgapArchitectHighErrorRate
    expr: |
      rate(http_requests_total{pod=~"airgap-architect-backend-.*",status=~"5.."}[5m])
      / rate(http_requests_total{pod=~"airgap-architect-backend-.*"}[5m])
      > 0.01
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "Airgap Architect HTTP 5xx error rate >1%"
      description: "Check application logs for errors."

  # Pod restarts
  - alert: AirgapArchitectPodRestarting
    expr: |
      rate(kube_pod_container_status_restarts_total{pod=~"airgap-architect-.*"}[15m]) > 0
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "Airgap Architect pod {{ $labels.pod }} is restarting"
      description: "Check logs for crash cause (OOM, error, probe failure)."
```

### Grafana Dashboard

**Recommended panels:**

1. **Resource Overview:**
   - CPU usage (backend + frontend)
   - Memory usage (backend + frontend)
   - Disk usage (PVC)

2. **API Performance:**
   - Request rate (req/s)
   - P50/P95/P99 latency
   - Error rate (%)

3. **oc-mirror Jobs:**
   - Active job count
   - Average job duration
   - Job success/failure rate

4. **User Activity:**
   - Active wizard sessions (tracked via state saves)
   - YAML generation count (per hour)
   - Cincinnati version queries (per hour)

**Dashboard JSON:**

See `manifests/monitoring/grafana-dashboard.json` (future enhancement)

---

## Performance Expectations

### Normal Operation Latencies

| Operation | Target | Acceptable | Degraded |
|-----------|--------|------------|----------|
| Health check (`/api/health`) | <50ms | <200ms | >500ms |
| State load (`GET /api/state`) | <100ms | <300ms | >1s |
| State save (`POST /api/state`) | <200ms | <500ms | >2s |
| Cincinnati channels (`/api/cincinnati/channels`) | <500ms | <2s | >5s |
| YAML generation (`POST /api/generate`) | <500ms | <1s | >3s |
| Operator catalog scan | <30s | <60s | >2min |
| oc-mirror job (50GB) | 30-45min | 60min | >90min |

### Throughput Expectations

**Wizard Operations (Concurrent Users):**
- **Small deployment:** 5-10 concurrent users
- **Medium deployment:** 15-20 concurrent users
- **Large deployment:** 30-50 concurrent users

**State Persistence (SQLite Writes):**
- **Sequential writes:** ~100 writes/second
- **Concurrent writes:** ~20 writes/second (lock contention)
- Measured with 100MB database, SSD storage

**oc-mirror Jobs:**
- **Concurrent jobs:** 1 (hard limit)
- **Job queue:** Unlimited (queued jobs wait)

### Network I/O

**Inbound (User Requests):**
- **Health checks:** 1-10 req/s (monitoring + user traffic)
- **State operations:** 5-20 req/s (typical wizard usage)
- **Cincinnati queries:** 0.5-2 req/s (periodic refresh)

**Outbound (External APIs):**
- **Cincinnati API:** ~10 requests/hour (background refresh)
- **registry.redhat.io:** 50-200 req/s during operator scans
- **Proxy egress:** Required if behind corporate firewall

**Bandwidth:**
- **Inbound:** <1 Mbps (HTTP API traffic)
- **Outbound:** 10-50 Mbps during oc-mirror jobs (image manifest downloads)

---

## Tuning Recommendations

### Database Optimization (SQLite)

#### 1. Enable WAL Mode

Write-Ahead Logging improves concurrent read performance.

```javascript
// backend/src/db.js (already implemented)
db.pragma('journal_mode = WAL');
```

**Benefits:**
- Readers don't block writers
- Faster state queries under load

**Trade-off:**
- Slightly more disk space (~2x during checkpoint)

#### 2. Increase Cache Size

Larger cache reduces disk I/O.

```javascript
// backend/src/db.js
db.pragma('cache_size = -64000');  // 64MB cache
```

**When to increase:**
- Database >100MB
- High query frequency (>50 queries/sec)

#### 3. Optimize Busy Timeout

Reduce lock contention during concurrent writes.

```javascript
// backend/src/db.js (already implemented)
db.pragma('busy_timeout = 5000');  // 5 second timeout
```

**When to increase:**
- Many concurrent state saves (>10 users)
- Seeing SQLITE_BUSY errors in logs

#### 4. Periodic Vacuum

Reclaim disk space from deleted records.

```bash
# Run weekly via cron job
kubectl exec -it deployment/airgap-architect-backend -- sqlite3 /data/app.db 'VACUUM;'
```

**Benefits:**
- Recovers disk space
- Defragments database (faster queries)

**Trade-off:**
- Locks database during vacuum (run during maintenance window)

### Storage Class Tuning

#### Use SSD-Backed Storage

SQLite performance is disk I/O bound.

**AWS EBS:**
```yaml
storageClassName: gp3-csi  # General Purpose SSD
# OR
storageClassName: io2-csi  # Provisioned IOPS (for high load)
```

**Azure Disk:**
```yaml
storageClassName: managed-csi-premium  # Premium SSD
```

**OpenShift Container Storage:**
```yaml
storageClassName: ocs-storagecluster-ceph-rbd  # Ceph RBD (SSD pool)
```

**Benchmark comparison:**
- HDD (7200 RPM): ~100 IOPS → State save: 200-500ms
- SSD (SATA): ~10K IOPS → State save: 50-100ms
- NVMe SSD: ~100K IOPS → State save: 10-30ms

#### Enable Volume Expansion

Allow PVC growth without downtime.

```yaml
# In StorageClass
allowVolumeExpansion: true
```

**How to expand:**
```bash
# Edit PVC
kubectl edit pvc airgap-architect-data

# Change storage request
spec:
  resources:
    requests:
      storage: 500Gi  # Increase from 250Gi

# Wait for resize
kubectl get pvc -w
```

### Node Selector for Performance

Pin pods to high-performance nodes.

```yaml
# backend-deployment.yaml
spec:
  template:
    spec:
      nodeSelector:
        node.kubernetes.io/instance-type: m5.2xlarge  # AWS example
        disktype: ssd  # Custom label
```

**When to use:**
- Mixed node types in cluster
- Want to isolate performance-critical workloads
- Dedicated node pool for platform tools

### Resource Quotas (Namespace Isolation)

Prevent noisy neighbors from impacting performance.

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: airgap-architect-quota
spec:
  hard:
    requests.cpu: "4"
    requests.memory: "8Gi"
    limits.cpu: "8"
    limits.memory: "16Gi"
    persistentvolumeclaims: "1"
```

**Benefits:**
- Guaranteed resources
- Prevents over-provisioning

### Backend Environment Tuning

#### Increase Node.js Memory Limit

For large oc-mirror jobs.

```yaml
# backend-deployment.yaml
env:
- name: NODE_OPTIONS
  value: "--max-old-space-size=3072"  # 3GB heap
```

**When to use:**
- oc-mirror jobs >100GB
- Seeing "JavaScript heap out of memory" errors

#### Adjust Worker Thread Pool

For concurrent file I/O operations.

```yaml
env:
- name: UV_THREADPOOL_SIZE
  value: "8"  # Default is 4
```

**When to use:**
- Many concurrent SQLite queries
- oc-mirror workspace I/O contention

### Frontend Optimization

#### Enable HTTP/2

Improves asset loading with multiplexing.

(Requires ingress/route configuration, not pod-level)

#### Add CDN (Future Enhancement)

Serve static assets from CDN.

**Benefits:**
- Reduced pod load
- Faster page loads for remote users

**Not implemented:** Frontend currently served directly from pod

---

## Load Testing

### Running the Load Test Script

The load test script simulates realistic wizard workflows under concurrent load.

**Location:** `scripts/load-test.sh`

#### Basic Usage

```bash
# Default: 10 users, 30 minutes, localhost
./scripts/load-test.sh

# Custom: 25 users, 60 minutes, production URL
./scripts/load-test.sh https://airgap.example.com 25 60
```

#### What It Tests

1. **Health check endpoint:** 1000 rapid requests (baseline latency)
2. **Cincinnati channels:** 500 requests (version discovery)
3. **State operations:** 500 saves + 500 loads (SQLite performance)
4. **Concurrent users:** N users for M minutes (realistic workflow)
5. **YAML generation:** 100 requests (CPU-intensive operation)

#### Interpreting Results

**Sample output:**
```
Health Check Performance:
  Requests: 1000
  Average: 45ms
  P50 (median): 38ms
  P95: 78ms
  P99: 120ms
  Max: 250ms

State Save Performance:
  Requests: 500
  Average: 150ms
  P50: 120ms
  P95: 280ms
  P99: 450ms
  Max: 800ms
```

**What's good:**
- Health check P95 <200ms
- State operations P95 <500ms
- Cincinnati P95 <2s
- YAML generation P95 <1s

**What's concerning:**
- P95 >2x expected (increase resources)
- P99 >5x expected (investigate outliers)
- Many failures (check logs for errors)

#### Monitoring During Load Test

**Terminal 1: Run load test**
```bash
./scripts/load-test.sh http://localhost:4000 20 10
```

**Terminal 2: Monitor pod resources**
```bash
watch -n 2 'kubectl top pod -l app=airgap-architect'
```

**Terminal 3: Check for OOM kills**
```bash
kubectl get events --field-selector reason=OOMKilled -w
```

**Terminal 4: Tail logs**
```bash
kubectl logs -f deployment/airgap-architect-backend
```

#### Load Test Scenarios

**Scenario 1: Verify Resource Limits (Quick)**
```bash
# 10 users, 5 minutes
./scripts/load-test.sh http://localhost:4000 10 5
```
**Goal:** Confirm pod doesn't exceed resource limits.

**Scenario 2: Sustained Load (Standard)**
```bash
# 20 users, 30 minutes
./scripts/load-test.sh http://localhost:4000 20 30
```
**Goal:** Measure performance under typical production load.

**Scenario 3: Stress Test (Find Breaking Point)**
```bash
# 50 users, 60 minutes
./scripts/load-test.sh http://localhost:4000 50 60
```
**Goal:** Find maximum capacity before degradation.

#### When to Run Load Tests

- **Before production deployment:** Validate resource limits
- **After infrastructure changes:** Ensure no regression
- **Capacity planning:** Find scaling thresholds
- **Performance tuning:** Measure impact of optimizations

---

## Disaster Recovery

### Backup Strategy

#### What to Back Up

1. **SQLite Database:** `/data/app.db`
   - Contains: User configurations, Cincinnati cache, job history
   - Frequency: Daily
   - Retention: 30 days

2. **oc-mirror Workspace:** `/data/oc-mirror-workspace/` (optional)
   - Contains: Mirrored images, manifests
   - Frequency: After each successful job (if archiving)
   - Retention: Based on policy (e.g., last 3 versions)

3. **Configuration:** `manifests/` directory
   - Contains: K8s manifests, ConfigMaps, Secrets
   - Frequency: On each change (GitOps recommended)
   - Retention: Git history

#### Backup Methods

**Option 1: PVC Snapshots (Recommended)**

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: airgap-architect-data-snapshot
spec:
  volumeSnapshotClassName: csi-snapshot-class
  source:
    persistentVolumeClaimName: airgap-architect-data
```

**Benefits:**
- Fast (copy-on-write)
- Point-in-time consistency
- Native K8s integration

**How to automate:**
```bash
# Daily cron job
kubectl create -f snapshot.yaml
kubectl delete volumesnapshot airgap-architect-data-snapshot-$(date -d '7 days ago' +%Y%m%d)
```

**Option 2: SQL Dump**

```bash
# Backup SQLite database
kubectl exec deployment/airgap-architect-backend -- \
  sqlite3 /data/app.db '.backup /data/backup/app-$(date +%Y%m%d).db'

# Copy to S3
kubectl exec deployment/airgap-architect-backend -- \
  aws s3 cp /data/backup/app-$(date +%Y%m%d).db s3://backups/airgap-architect/
```

**Benefits:**
- Portable (can restore to different cluster)
- Incremental backups possible

**Option 3: Full PVC Clone**

```bash
# Clone PVC using rsync
kubectl run backup --image=alpine --command -- \
  sh -c "apk add rsync && rsync -av /source/ /dest/"
```

**Benefits:**
- Complete data copy (including oc-mirror workspace)

**Trade-off:**
- Slow (copies all data)

### Restore Procedures

#### Restore from Snapshot

```bash
# 1. Scale down deployment
kubectl scale deployment airgap-architect-backend --replicas=0

# 2. Delete old PVC
kubectl delete pvc airgap-architect-data

# 3. Create PVC from snapshot
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: airgap-architect-data
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 250Gi
  dataSource:
    name: airgap-architect-data-snapshot-20260515
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
EOF

# 4. Scale up deployment
kubectl scale deployment airgap-architect-backend --replicas=1
```

#### Restore from SQL Dump

```bash
# 1. Copy backup to pod
kubectl cp app-20260515.db \
  airgap-architect-backend-xxxxx:/data/app-restore.db

# 2. Replace database
kubectl exec deployment/airgap-architect-backend -- \
  mv /data/app.db /data/app.db.old && \
  mv /data/app-restore.db /data/app.db

# 3. Restart pod
kubectl rollout restart deployment airgap-architect-backend
```

### RTO/RPO Considerations

| Scenario | RTO (Recovery Time) | RPO (Data Loss) |
|----------|---------------------|-----------------|
| Pod crash (no data loss) | <1 min | None (liveness probe restarts) |
| PVC corruption | 5-15 min | Last snapshot (24h) |
| Namespace deletion | 10-30 min | Last backup (24h) |
| Cluster failure | 30-60 min | Last offsite backup (24h) |

**Improving RTO:**
- Use VolumeSnapshots (faster restore than full copy)
- Automate restore procedures (scripts, runbooks)
- Practice restores quarterly

**Improving RPO:**
- Increase backup frequency (every 6 hours)
- Enable SQLite WAL archiving (transaction-level recovery)
- Use replicated storage (e.g., Ceph multi-replica)

### High Availability Considerations

**Current Limitations:**
- Backend: Single replica (SQLite constraint)
- Frontend: Multi-replica capable

**Single Point of Failure:**
- Backend pod failure: 30-60s downtime (K8s restart)
- PVC failure: Requires restore (5-15 min downtime)

**Mitigation:**
- Use storage with high durability (multi-AZ, replicated)
- Monitor pod health (liveness/readiness probes)
- Have restore procedures documented and tested

**Future Enhancement: External Database**

Replace SQLite with PostgreSQL/MySQL for:
- Multi-replica backend (high availability)
- Faster backups (incremental WAL archiving)
- Better concurrency (many simultaneous users)

**Not implemented** (requires code changes).

---

## Troubleshooting

### Common Issues

#### 1. Pod OOM Killed

**Symptoms:**
- Pod restarts frequently
- `kubectl get events` shows `OOMKilled`
- Last logs show no error (killed mid-operation)

**Diagnosis:**
```bash
# Check memory usage
kubectl top pod -l app=airgap-architect

# Check for OOM kills
kubectl get events --field-selector reason=OOMKilled

# Review resource limits
kubectl get pod -l app=airgap-architect -o jsonpath='{.items[*].spec.containers[*].resources}'
```

**Resolution:**
1. Increase memory limit in deployment
2. Identify memory leak (review logs before restart)
3. Optimize oc-mirror job size (split large jobs)

**Prevention:**
- Set memory request = 50% of limit
- Alert on memory usage >85%

#### 2. Slow API Response Times

**Symptoms:**
- YAML generation takes >3s
- State saves timeout
- Frontend feels sluggish

**Diagnosis:**
```bash
# Check CPU throttling
kubectl top pod -l app=airgap-architect

# Check disk I/O (requires node access)
kubectl exec -it deployment/airgap-architect-backend -- \
  sh -c 'time dd if=/dev/zero of=/data/test.img bs=1M count=100'

# Check SQLite query performance
kubectl exec -it deployment/airgap-architect-backend -- \
  sqlite3 /data/app.db 'EXPLAIN QUERY PLAN SELECT * FROM state_snapshots ORDER BY updated_at DESC LIMIT 1;'
```

**Resolution:**
1. Increase backend CPU limit
2. Upgrade to SSD storage
3. Vacuum SQLite database
4. Add missing indexes

**Prevention:**
- Monitor P95 latency
- Regular SQLite maintenance

#### 3. PVC Full (oc-mirror Job Fails)

**Symptoms:**
- oc-mirror job fails with "no space left on device"
- Pod events show volume full
- New state saves fail

**Diagnosis:**
```bash
# Check PVC usage
kubectl exec -it deployment/airgap-architect-backend -- df -h /data

# Find large files
kubectl exec -it deployment/airgap-architect-backend -- \
  du -sh /data/*
```

**Resolution:**
```bash
# Delete old oc-mirror workspaces
kubectl exec -it deployment/airgap-architect-backend -- \
  rm -rf /data/oc-mirror-workspace/old-*

# Vacuum SQLite
kubectl exec -it deployment/airgap-architect-backend -- \
  sqlite3 /data/app.db 'VACUUM;'

# Expand PVC (if allowVolumeExpansion enabled)
kubectl edit pvc airgap-architect-data
# Change storage: 500Gi
```

**Prevention:**
- Alert on PVC usage >80%
- Automated cleanup of old workspaces
- Size PVC appropriately (500Gi+ for large deployments)

#### 4. SQLite Database Locked

**Symptoms:**
- State saves fail with "database is locked"
- Logs show SQLITE_BUSY errors
- Multiple oc-mirror jobs running

**Diagnosis:**
```bash
# Check for multiple backend pods (should be 1)
kubectl get pod -l component=backend

# Check for stuck transactions
kubectl exec -it deployment/airgap-architect-backend -- \
  sqlite3 /data/app.db 'PRAGMA busy_timeout; PRAGMA journal_mode;'
```

**Resolution:**
```bash
# Ensure only 1 backend replica
kubectl scale deployment airgap-architect-backend --replicas=0
kubectl scale deployment airgap-architect-backend --replicas=1

# If corrupted, restore from backup
```

**Prevention:**
- Deployment strategy: `Recreate` (never >1 replica)
- Increase busy_timeout pragma
- Enable WAL mode

#### 5. Frontend 404 Errors

**Symptoms:**
- Frontend pod returns 404 for static assets
- User sees blank page
- Browser console shows failed asset loads

**Diagnosis:**
```bash
# Check pod logs
kubectl logs deployment/airgap-architect-frontend

# Check filesystem
kubectl exec -it deployment/airgap-architect-frontend -- ls -la /app/dist
```

**Resolution:**
1. Verify image built correctly
2. Check VITE_API_BASE environment variable
3. Rebuild and redeploy frontend image

#### 6. oc-mirror Job Hangs

**Symptoms:**
- oc-mirror job runs for hours with no progress
- No logs emitted
- Backend unresponsive

**Diagnosis:**
```bash
# Check backend processes
kubectl exec -it deployment/airgap-architect-backend -- ps aux | grep oc-mirror

# Check network connectivity
kubectl exec -it deployment/airgap-architect-backend -- \
  curl -I https://registry.redhat.io

# Check job logs
kubectl logs deployment/airgap-architect-backend | grep -A 20 "oc-mirror"
```

**Resolution:**
1. Kill stuck oc-mirror process
2. Check network/proxy configuration
3. Reduce ImageSetConfiguration size
4. Increase backend memory limit

**Prevention:**
- Implement job timeout (2 hour max)
- Monitor job progress (periodic log output)

---

## Appendix: Resource Calculation Examples

### Example 1: 15 Concurrent Users

**Assumptions:**
- 15 users actively using wizard
- Each user saves state every 2 minutes (7.5 writes/sec)
- Occasional YAML generation (1 per minute total)
- Background Cincinnati refresh (1 per hour)

**Backend Resource Usage:**
- CPU: 600-800m (state I/O + YAML generation)
- Memory: 1.5-2Gi (SQLite cache + Node.js heap)
- Disk I/O: 50 IOPS (SQLite writes)

**Frontend Resource Usage:**
- CPU: 150-200m per pod (static serving)
- Memory: 200-256Mi per pod

**Recommended Configuration:**
- Backend: 1000m CPU, 2Gi RAM
- Frontend: 2 replicas, 200m CPU, 512Mi RAM each

### Example 2: Large oc-mirror Job (150GB)

**Assumptions:**
- Mirroring OCP 4.15 + 50 operators
- Total image size: 150GB
- Network bandwidth: 100 Mbps
- No concurrent wizard users

**Backend Resource Usage:**
- CPU: 1500-2000m (oc-mirror goroutines + compression)
- Memory: 2.5-3.5Gi (image manifest caching + tar operations)
- Disk I/O: 200 IOPS (writing tar archives)
- Network I/O: 12.5 MB/s sustained

**Duration:**
- Download: ~3 hours (150GB at 12.5 MB/s)
- Processing: +30 min (manifest generation, tar creation)
- Total: ~3.5-4 hours

**Recommended Configuration:**
- Backend: 2000m CPU, 4Gi RAM
- PVC: 500Gi (2x image size for workspace + archives)

---

## Summary

This capacity planning guide provides comprehensive resource sizing, scaling strategies, and operational guidance for deploying OpenShift Airgap Architect in production.

**Key Takeaways:**

1. **Resource Limits:** Backend 500m-2000m CPU, 1-4Gi RAM; Frontend 100m-500m CPU, 256-512Mi RAM
2. **Storage:** 250Gi PVC default (scale to 500Gi+ for many OCP versions)
3. **Scaling:** Frontend scales horizontally; backend limited to 1 replica (SQLite)
4. **Monitoring:** Alert on CPU >80%, memory >85%, disk >80%, API P95 >2s
5. **Performance:** YAML generation <1s, state operations <500ms, oc-mirror 30-60min/50GB
6. **Load Testing:** Use `scripts/load-test.sh` to validate capacity
7. **Backup:** Daily PVC snapshots, 30-day retention

**For most deployments, the recommended Medium size (2Gi RAM, 250Gi PVC, 2-3 frontend replicas) provides excellent performance for 15-30 concurrent users.**

For questions or issues, consult the troubleshooting section or application logs.
