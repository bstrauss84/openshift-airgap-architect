# Health Probes - Production Kubernetes Deployment

This document describes the health and readiness probe endpoints for production Kubernetes deployments of OpenShift Airgap Architect.

## Overview

The application provides two distinct health check endpoints:

1. **Liveness Probe** (`/api/health`) - Detects deadlocked/frozen processes
2. **Readiness Probe** (`/api/ready`) - Controls traffic routing to healthy pods

## Liveness Probe

### Purpose

The liveness probe detects when the application process has entered an unrecoverable state (deadlock, infinite loop, crash) and needs to be restarted.

**Key Principle:** The liveness probe should ONLY check process health, not dependencies.

If the liveness probe fails repeatedly, Kubernetes will restart the pod to attempt recovery.

### Endpoint

```
GET /api/health
```

### Response (Success)

**HTTP Status:** 200 OK

```json
{
  "status": "ok",
  "timestamp": "2026-05-20T14:30:45.123Z",
  "uptime": 3600.456
}
```

**Fields:**
- `status`: Always "ok" if the process is alive
- `timestamp`: Current server time (ISO 8601)
- `uptime`: Process uptime in seconds

### What It Checks

- Process is alive and responding to HTTP requests
- Event loop is not blocked
- Express server is functional

### What It Does NOT Check

- Database connectivity (checked by readiness probe)
- External dependencies
- Application business logic

### Failure Behavior

If the liveness probe fails:
1. Kubernetes marks the pod as unhealthy
2. After `failureThreshold` consecutive failures (default: 3)
3. Kubernetes kills and restarts the pod
4. New pod starts fresh with clean state

**Warning:** Aggressive liveness probe settings can cause restart loops. Be conservative.

### Kubernetes Configuration

```yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 4000
    scheme: HTTP
  initialDelaySeconds: 30    # Wait for app to start
  periodSeconds: 10           # Check every 10 seconds
  timeoutSeconds: 5           # Fail if no response in 5s
  successThreshold: 1         # One success = healthy
  failureThreshold: 3         # Three failures = restart
```

**Configuration Guidelines:**

- `initialDelaySeconds`: Set to application startup time + buffer
  - Typical: 15-30 seconds for this app
  - Too low: Restart during normal startup
  - Too high: Slow detection of startup failures

- `periodSeconds`: How often to check
  - Typical: 10-30 seconds
  - Too low: Excessive resource usage
  - Too high: Slow detection of failures

- `timeoutSeconds`: Request timeout
  - Typical: 5 seconds
  - Should be less than `periodSeconds`

- `failureThreshold`: Consecutive failures before restart
  - Typical: 3
  - Too low: False positives cause unnecessary restarts
  - Too high: Slow recovery from actual failures

## Readiness Probe

### Purpose

The readiness probe determines if the application is ready to receive production traffic. Unlike liveness, readiness checks dependencies like database connectivity.

**Key Principle:** The readiness probe should verify all critical dependencies are operational.

If the readiness probe fails, Kubernetes removes the pod from service endpoints (stops routing traffic) but does NOT restart the pod.

### Endpoint

```
GET /api/ready
```

### Response (Success)

**HTTP Status:** 200 OK

```json
{
  "ready": true,
  "checks": {
    "database_read": "ok",
    "database_write": "ok"
  },
  "timestamp": "2026-05-20T14:30:45.123Z"
}
```

### Response (Failure)

**HTTP Status:** 503 Service Unavailable

```json
{
  "ready": false,
  "checks": {
    "database_read": "ok",
    "database_write": "failed"
  },
  "error": "SQLITE_READONLY: attempt to write a readonly database",
  "timestamp": "2026-05-20T14:30:45.123Z"
}
```

**Fields:**
- `ready`: Boolean indicating overall readiness
- `checks`: Object showing status of each check
- `error`: Error message (only present on failure)
- `timestamp`: Current server time (ISO 8601)

### What It Checks

The readiness probe performs two sequential checks:

**1. Database Read Test**
- Attempts to read application state via `getState()`
- Verifies database file is readable
- Confirms schema is initialized

**2. Database Write Test**
- Inserts a test record into the `cache` table
- Immediately deletes the test record
- Verifies database is writable (not in read-only mode)

**Why Both?** Some database failures only affect writes:
- Read-only filesystem
- Disk full
- Permission issues
- Database corruption

### Failure Behavior

If the readiness probe fails:
1. Kubernetes marks the pod as "not ready"
2. Pod is removed from Service endpoints
3. Load balancer stops routing traffic to the pod
4. Pod continues running (not restarted)
5. Probe continues checking every `periodSeconds`
6. When probe succeeds, pod is added back to endpoints

**Recovery:** If the issue resolves itself (e.g., temporary network partition), the pod automatically becomes ready again without restart.

### Kubernetes Configuration

```yaml
readinessProbe:
  httpGet:
    path: /api/ready
    port: 4000
    scheme: HTTP
  initialDelaySeconds: 10    # Shorter than liveness
  periodSeconds: 5            # Check frequently
  timeoutSeconds: 3           # Shorter timeout
  successThreshold: 1         # One success = ready
  failureThreshold: 3         # Three failures = not ready
```

**Configuration Guidelines:**

- `initialDelaySeconds`: Wait for initial DB connection
  - Typical: 5-15 seconds
  - Shorter than liveness (DB connects before app is fully ready)

- `periodSeconds`: How often to check
  - Typical: 5-10 seconds
  - More frequent than liveness (faster traffic rerouting)

- `timeoutSeconds`: Request timeout
  - Typical: 3 seconds
  - DB checks are fast; slow response indicates problem

- `failureThreshold`: Consecutive failures before removal
  - Typical: 2-3
  - Lower than liveness (faster traffic failover)

## Complete Deployment Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: airgap-architect-backend
  namespace: airgap-architect
spec:
  replicas: 2
  selector:
    matchLabels:
      app: airgap-architect
      component: backend
  template:
    metadata:
      labels:
        app: airgap-architect
        component: backend
    spec:
      containers:
      - name: backend
        image: quay.io/bstrauss84/openshift-airgap-architect-backend:latest
        ports:
        - containerPort: 4000
          name: http
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATA_DIR
          value: "/data"
        volumeMounts:
        - name: data
          mountPath: /data
        livenessProbe:
          httpGet:
            path: /api/health
            port: 4000
            scheme: HTTP
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          successThreshold: 1
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /api/ready
            port: 4000
            scheme: HTTP
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          successThreshold: 1
          failureThreshold: 3
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: airgap-architect-data
```

## Common Failure Scenarios

### Scenario 1: Database File Missing

**Symptom:** Readiness probe fails immediately after pod start

**Readiness Response:**
```json
{
  "ready": false,
  "checks": {
    "database_read": "failed",
    "database_write": "unknown"
  },
  "error": "SQLITE_CANTOPEN: unable to open database file"
}
```

**Cause:**
- `/data` directory not mounted
- PersistentVolume not provisioned
- Incorrect DATA_DIR environment variable

**Resolution:**
1. Check PVC is bound: `kubectl get pvc -n airgap-architect`
2. Verify volume mount: `kubectl describe pod <pod-name> -n airgap-architect`
3. Check DATA_DIR env var matches volume mountPath

### Scenario 2: Read-Only Filesystem

**Symptom:** Readiness probe shows database_read ok, database_write failed

**Readiness Response:**
```json
{
  "ready": false,
  "checks": {
    "database_read": "ok",
    "database_write": "failed"
  },
  "error": "SQLITE_READONLY: attempt to write a readonly database"
}
```

**Cause:**
- Volume mounted read-only
- Filesystem full
- Permission issues

**Resolution:**
1. Check PV access mode: `kubectl get pv`
2. Verify PVC is ReadWriteOnce or ReadWriteMany: `kubectl get pvc -n airgap-architect -o yaml`
3. Check filesystem space: `kubectl exec -it <pod-name> -n airgap-architect -- df -h /data`

### Scenario 3: Process Deadlock

**Symptom:** Liveness probe fails, pod restarts

**Liveness Response:** (none - timeout)

**Cause:**
- Event loop blocked
- Infinite loop in request handler
- Unhandled async exception

**Resolution:**
1. Check pod logs before restart: `kubectl logs <pod-name> -n airgap-architect --previous`
2. Look for error patterns in logs
3. Enable debug logging: Set LOG_LEVEL=debug

### Scenario 4: Slow Startup

**Symptom:** Pod restarts during startup (liveness fails before app is ready)

**Cause:**
- `initialDelaySeconds` too low for application startup time
- App takes longer than expected to initialize

**Resolution:**
1. Increase `initialDelaySeconds` in liveness probe
2. Check pod logs for slow operations: `kubectl logs <pod-name> -n airgap-architect`
3. Consider startup probe for long initialization times

### Scenario 5: Intermittent Network Issues

**Symptom:** Readiness probe flapping (pod marked ready/not ready repeatedly)

**Cause:**
- Network timeouts
- Transient database connection issues
- `timeoutSeconds` too aggressive

**Resolution:**
1. Increase `timeoutSeconds` in readiness probe
2. Increase `failureThreshold` to tolerate transient failures
3. Check network latency: `kubectl exec -it <pod-name> -n airgap-architect -- ping <db-host>`

## Troubleshooting

### Check Probe Status

**View pod conditions:**
```bash
kubectl describe pod <pod-name> -n airgap-architect
```

Look for:
- `Ready: True/False` - Readiness probe status
- `ContainersReady: True/False` - All containers ready
- Recent events showing probe failures

**View probe events:**
```bash
kubectl get events -n airgap-architect --field-selector involvedObject.name=<pod-name>
```

### Test Probes Manually

**From within cluster:**
```bash
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl http://airgap-architect-backend-service.airgap-architect.svc.cluster.local:4000/api/health
```

**From pod itself:**
```bash
kubectl exec -it <pod-name> -n airgap-architect -- \
  curl http://localhost:4000/api/health
kubectl exec -it <pod-name> -n airgap-architect -- \
  curl http://localhost:4000/api/ready
```

**Port-forward for local testing:**
```bash
kubectl port-forward -n airgap-architect <pod-name> 4000:4000
curl http://localhost:4000/api/health
curl http://localhost:4000/api/ready
```

### Check Logs

**Application logs:**
```bash
kubectl logs <pod-name> -n airgap-architect
```

**Logs with timestamps:**
```bash
kubectl logs <pod-name> -n airgap-architect --timestamps
```

**Follow logs in real-time:**
```bash
kubectl logs -f <pod-name> -n airgap-architect
```

**Previous container logs (after restart):**
```bash
kubectl logs <pod-name> -n airgap-architect --previous
```

### Structured Logging

Readiness probe failures are logged with structured JSON:

```json
{
  "level": "error",
  "time": 1716208245123,
  "err": {
    "message": "SQLITE_READONLY: attempt to write a readonly database",
    "stack": "..."
  },
  "checks": {
    "database_read": "ok",
    "database_write": "failed"
  },
  "msg": "Readiness probe failed"
}
```

**Search for probe failures:**
```bash
kubectl logs <pod-name> -n airgap-architect | grep "Readiness probe failed"
```

## Logging Exclusion

Health probe endpoints are excluded from normal request logging to reduce log noise. This is configured in `backend/src/middleware/logging.js`:

```javascript
const SKIP_LOG_PATTERN = /^\/(api\/)?(health|ready|jobs\/count)$/;
```

Probes run frequently (every 5-10 seconds) and would generate excessive logs. Only failures are logged (via `logger.error` in readiness probe).

## Advanced: Startup Probe

For applications with very long startup times (>30 seconds), consider adding a startup probe:

```yaml
startupProbe:
  httpGet:
    path: /api/ready
    port: 4000
  initialDelaySeconds: 0
  periodSeconds: 5
  timeoutSeconds: 3
  successThreshold: 1
  failureThreshold: 30  # Allow up to 150 seconds (30 * 5s)
```

**How it works:**
1. Startup probe runs first
2. Liveness and readiness probes disabled until startup succeeds
3. Allows long initialization without restart
4. Once startup succeeds, normal probes take over

**When to use:**
- Application initialization takes >30 seconds
- Database migrations run at startup
- Large data preloading required

## Performance Considerations

### Probe Overhead

**Request Rate:**
- Liveness: 1 request per 10 seconds = 6 requests/minute/pod
- Readiness: 1 request per 5 seconds = 12 requests/minute/pod
- Total: ~18 requests/minute/pod

**Database Overhead:**
- Readiness probe performs 1 INSERT + 1 DELETE every 5 seconds
- Minimal impact due to SQLite's write-ahead logging (WAL mode)
- Test records use unique keys to avoid conflicts

### Scaling

With multiple replicas, probe overhead scales linearly:
- 3 replicas = 54 requests/minute to health endpoints
- 10 replicas = 180 requests/minute

This is negligible compared to application traffic.

## References

- [Kubernetes Probe Documentation](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Kubernetes Best Practices: Health Checks](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes)
- Backend Implementation: `backend/src/index.js` (lines 733-767)
- Logging Middleware: `backend/src/middleware/logging.js`

## Revision History

- **2026-05-20**: Initial documentation for PROD-006
  - Enhanced liveness probe with uptime
  - Enhanced readiness probe with DB write test
  - Structured logging for failures
