# Prometheus Metrics and Instrumentation

**Status:** Implemented in v1.7.0 (PROD-008)  
**Purpose:** Comprehensive observability for production monitoring via Prometheus/Grafana

---

## Overview

The application exposes Prometheus metrics at `/api/metrics` endpoint for scraping. Metrics cover HTTP requests, background jobs, database operations, oc-mirror workflows, and application state.

**Key Benefits:**
- Real-time performance monitoring
- Background job tracking (Cincinnati, operator scans, oc-mirror)
- Database health and query performance
- HTTP request latency and error rates
- Automatic Node.js process metrics (CPU, memory, event loop)

---

## Quick Start

### Accessing Metrics

```bash
# Fetch metrics in Prometheus text format
curl http://localhost:3000/api/metrics

# Example output:
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/api/state",status_code="200"} 42
```

### Prometheus Configuration

Add this job to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'airgap-architect'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/api/metrics'
```

### Kubernetes/OpenShift Deployment

Metrics endpoint is automatically discovered via ServiceMonitor (Prometheus Operator):

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: airgap-architect
spec:
  selector:
    matchLabels:
      app: airgap-architect
  endpoints:
    - port: http
      path: /api/metrics
      interval: 30s
```

---

## HTTP Request Metrics

### `http_requests_total`

**Type:** Counter  
**Description:** Total number of HTTP requests  
**Labels:**
- `method`: HTTP method (GET, POST, PUT, DELETE)
- `route`: Normalized route pattern (e.g., `/api/jobs/:id`)
- `status_code`: HTTP status code (200, 404, 500, etc.)

**Example:**
```
http_requests_total{method="GET",route="/api/state",status_code="200"} 1523
http_requests_total{method="POST",route="/api/generate",status_code="200"} 87
http_requests_total{method="GET",route="/api/jobs/:id",status_code="404"} 3
```

**Use Case:** Track request volume by endpoint and identify error rates

---

### `http_request_duration_seconds`

**Type:** Histogram  
**Description:** Duration of HTTP requests in seconds  
**Labels:**
- `method`: HTTP method
- `route`: Normalized route pattern
- `status_code`: HTTP status code

**Buckets:** 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30 (10ms to 30 seconds)

**Example:**
```
http_request_duration_seconds_bucket{method="GET",route="/api/state",status_code="200",le="0.05"} 1200
http_request_duration_seconds_bucket{method="GET",route="/api/state",status_code="200",le="0.1"} 1450
http_request_duration_seconds_sum{method="GET",route="/api/state",status_code="200"} 45.2
http_request_duration_seconds_count{method="GET",route="/api/state",status_code="200"} 1523
```

**Use Case:** Calculate p50, p95, p99 latency percentiles

**Prometheus Query Examples:**
```promql
# p95 latency for /api/generate endpoint
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{route="/api/generate"}[5m])) by (le))

# Average request duration by route
rate(http_request_duration_seconds_sum[5m]) / rate(http_request_duration_seconds_count[5m])

# Requests per second by endpoint
sum(rate(http_requests_total[1m])) by (route)
```

---

## Background Job Metrics

### `background_jobs_total`

**Type:** Counter  
**Description:** Total number of background jobs by type and status  
**Labels:**
- `job_type`: Job type (cincinnati-refresh, operator-scan, oc-mirror-run)
- `status`: Job status (running, completed, failed, cancelled)

**Example:**
```
background_jobs_total{job_type="cincinnati-refresh",status="completed"} 45
background_jobs_total{job_type="operator-scan",status="completed"} 23
background_jobs_total{job_type="oc-mirror-run",status="failed"} 2
```

**Use Case:** Track job success/failure rates over time

---

### `background_jobs_running`

**Type:** Gauge  
**Description:** Number of background jobs currently running  
**Labels:**
- `job_type`: Job type

**Example:**
```
background_jobs_running{job_type="oc-mirror-run"} 1
background_jobs_running{job_type="operator-scan"} 0
```

**Use Case:** Monitor concurrent job execution and detect stuck jobs

**Alert Example:**
```yaml
# Alert if oc-mirror job runs longer than 2 hours
- alert: OcMirrorJobStuck
  expr: background_jobs_running{job_type="oc-mirror-run"} > 0 for 2h
  annotations:
    summary: "oc-mirror job may be stuck"
```

---

### `background_job_duration_seconds`

**Type:** Histogram  
**Description:** Duration of background jobs in seconds  
**Labels:**
- `job_type`: Job type
- `status`: Final status (completed, failed, cancelled)

**Buckets:** 1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600 (1s to 1 hour)

**Example:**
```
background_job_duration_seconds_bucket{job_type="oc-mirror-run",status="completed",le="600"} 12
background_job_duration_seconds_bucket{job_type="oc-mirror-run",status="completed",le="1800"} 18
background_job_duration_seconds_sum{job_type="oc-mirror-run",status="completed"} 8432.5
```

**Use Case:** Identify slow jobs and track performance trends

**Prometheus Query Examples:**
```promql
# p95 oc-mirror job duration
histogram_quantile(0.95, sum(rate(background_job_duration_seconds_bucket{job_type="oc-mirror-run"}[1h])) by (le))

# Average job duration by type
rate(background_job_duration_seconds_sum[1h]) / rate(background_job_duration_seconds_count[1h])
```

---

### `background_job_errors_total`

**Type:** Counter  
**Description:** Total number of background job errors by type  
**Labels:**
- `job_type`: Job type
- `error_type`: Error classification (network, auth, storage, timeout, unknown)

**Example:**
```
background_job_errors_total{job_type="oc-mirror-run",error_type="network"} 5
background_job_errors_total{job_type="operator-scan",error_type="auth"} 1
```

**Use Case:** Classify and track error patterns

**Error Classification Logic:**
- `network`: Timeouts, connection errors, DNS failures
- `auth`: Unauthorized, forbidden, authentication failures
- `storage`: Disk space, write errors
- `unknown`: All other errors

---

## SQLite Database Metrics

### `sqlite_queries_total`

**Type:** Counter  
**Description:** Total number of SQLite queries  
**Labels:**
- `operation`: SQL operation (select, insert, update, delete)

**Example:**
```
sqlite_queries_total{operation="select"} 8234
sqlite_queries_total{operation="insert"} 456
sqlite_queries_total{operation="update"} 189
```

**Use Case:** Monitor database activity and detect query hotspots

---

### `sqlite_query_duration_milliseconds`

**Type:** Histogram  
**Description:** Duration of SQLite queries in milliseconds  
**Labels:**
- `operation`: SQL operation

**Buckets:** 1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000 (1ms to 5s)

**Example:**
```
sqlite_query_duration_milliseconds_bucket{operation="select",le="10"} 7500
sqlite_query_duration_milliseconds_bucket{operation="select",le="50"} 8100
sqlite_query_duration_milliseconds_sum{operation="select"} 45234.5
```

**Use Case:** Identify slow queries and database performance issues

**Note:** SQLite metrics are defined but not yet instrumented. Will be added in future update.

---

### `sqlite_connection_pool_size`

**Type:** Gauge  
**Description:** Number of active SQLite connections

**Example:**
```
sqlite_connection_pool_size 1
```

**Use Case:** Monitor database connection usage (SQLite uses single connection by default)

---

## oc-mirror Operation Metrics

### `oc_mirror_operations_total`

**Type:** Counter  
**Description:** Total number of oc-mirror operations by workflow and status  
**Labels:**
- `workflow`: Workflow type (mirror_to_disk, disk_to_mirror, mirror_to_mirror)
- `status`: Operation status (success, failure)

**Example:**
```
oc_mirror_operations_total{workflow="mirror_to_disk",status="success"} 23
oc_mirror_operations_total{workflow="mirror_to_disk",status="failure"} 2
```

**Use Case:** Track oc-mirror reliability and success rates

---

### `oc_mirror_duration_seconds`

**Type:** Histogram  
**Description:** Duration of oc-mirror operations in seconds  
**Labels:**
- `workflow`: Workflow type

**Buckets:** 60, 300, 600, 1800, 3600, 7200, 14400, 28800 (1 min to 8 hours)

**Example:**
```
oc_mirror_duration_seconds_bucket{workflow="mirror_to_disk",le="1800"} 12
oc_mirror_duration_seconds_bucket{workflow="mirror_to_disk",le="3600"} 18
oc_mirror_duration_seconds_sum{workflow="mirror_to_disk"} 42315.7
```

**Use Case:** Monitor oc-mirror performance and identify slow operations

---

### `oc_mirror_archive_size_bytes`

**Type:** Gauge  
**Description:** Size of oc-mirror archives in bytes  
**Labels:**
- `workflow`: Workflow type

**Example:**
```
oc_mirror_archive_size_bytes{workflow="mirror_to_disk"} 5368709120
```

**Use Case:** Track mirror archive sizes and disk usage

---

### `oc_mirror_errors_total`

**Type:** Counter  
**Description:** Total number of oc-mirror errors by workflow and type  
**Labels:**
- `workflow`: Workflow type
- `error_type`: Error classification (network, auth, storage, timeout)

**Example:**
```
oc_mirror_errors_total{workflow="mirror_to_disk",error_type="network"} 3
```

**Use Case:** Diagnose oc-mirror failure patterns

**Note:** oc-mirror metrics are defined but not yet fully instrumented. Will be added in future update.

---

## Application-Level Metrics

### `app_state_operations_total`

**Type:** Counter  
**Description:** Total number of state save/load operations  
**Labels:**
- `operation`: Operation type (save, load)

**Example:**
```
app_state_operations_total{operation="save"} 234
app_state_operations_total{operation="load"} 1523
```

**Use Case:** Monitor state persistence frequency and performance

---

### `cincinnati_discovery_total`

**Type:** Counter  
**Description:** Total number of Cincinnati version discovery operations  
**Labels:**
- `status`: Operation status (success, failure)

**Example:**
```
cincinnati_discovery_total{status="success"} 45
cincinnati_discovery_total{status="failure"} 2
```

**Use Case:** Track Cincinnati API reliability

**Note:** Cincinnati metrics are defined but not yet instrumented. Will be added in future update.

---

### `operator_scans_total`

**Type:** Counter  
**Description:** Total number of operator catalog scans  
**Labels:**
- `status`: Operation status (success, failure)

**Example:**
```
operator_scans_total{status="success"} 23
operator_scans_total{status="failure"} 1
```

**Use Case:** Monitor operator scanning health

**Note:** Operator scan metrics are defined but not yet instrumented. Will be added in future update.

---

## Default Node.js Metrics

The following Node.js process metrics are automatically collected by `prom-client`:

### Process Metrics
- `process_cpu_user_seconds_total`: User CPU time
- `process_cpu_system_seconds_total`: System CPU time
- `process_cpu_seconds_total`: Total CPU time
- `process_start_time_seconds`: Process start time
- `process_resident_memory_bytes`: Resident memory
- `process_virtual_memory_bytes`: Virtual memory
- `process_heap_bytes`: Heap size
- `process_open_fds`: Open file descriptors
- `process_max_fds`: Max file descriptors

### Node.js Metrics
- `nodejs_eventloop_lag_seconds`: Event loop lag
- `nodejs_active_handles_total`: Active handles
- `nodejs_active_requests_total`: Active requests
- `nodejs_heap_size_total_bytes`: Total heap size
- `nodejs_heap_size_used_bytes`: Used heap size
- `nodejs_external_memory_bytes`: External memory
- `nodejs_heap_space_size_total_bytes`: Heap space sizes
- `nodejs_version_info`: Node.js version

---

## Grafana Dashboard Examples

### HTTP Request Rate Panel

```json
{
  "title": "HTTP Request Rate",
  "targets": [
    {
      "expr": "sum(rate(http_requests_total[5m])) by (route)",
      "legendFormat": "{{route}}"
    }
  ]
}
```

### Background Job Success Rate

```json
{
  "title": "Job Success Rate (%)",
  "targets": [
    {
      "expr": "sum(rate(background_jobs_total{status=\"completed\"}[5m])) / sum(rate(background_jobs_total[5m])) * 100",
      "legendFormat": "Success Rate"
    }
  ]
}
```

### p95 Request Latency

```json
{
  "title": "p95 Request Latency",
  "targets": [
    {
      "expr": "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))",
      "legendFormat": "{{route}}"
    }
  ]
}
```

---

## Alert Examples

### High Error Rate

```yaml
- alert: HighHTTPErrorRate
  expr: |
    sum(rate(http_requests_total{status_code=~"5.."}[5m])) /
    sum(rate(http_requests_total[5m])) > 0.05
  for: 5m
  annotations:
    summary: "HTTP error rate above 5%"
```

### Slow Requests

```yaml
- alert: SlowHTTPRequests
  expr: |
    histogram_quantile(0.95,
      sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route)
    ) > 2.0
  for: 10m
  annotations:
    summary: "p95 latency above 2 seconds for {{$labels.route}}"
```

### Job Failures

```yaml
- alert: BackgroundJobFailures
  expr: |
    sum(rate(background_jobs_total{status="failed"}[1h])) by (job_type) > 0.1
  for: 5m
  annotations:
    summary: "Background job {{$labels.job_type}} failing frequently"
```

---

## Implementation Details

### Automatic HTTP Instrumentation

All HTTP requests are automatically instrumented via `metricsMiddleware`:

```javascript
import { metricsMiddleware } from "./middleware/metrics.js";

app.use(metricsMiddleware);
```

**Cardinality Control:**
- Routes are normalized to avoid high cardinality
- UUIDs replaced with `:id` (e.g., `/api/jobs/550e8400-...` → `/api/jobs/:id`)
- Numeric IDs replaced with `:id` (e.g., `/api/items/123` → `/api/items/:id`)
- nanoid-style IDs normalized (e.g., `/api/jobs/V1StGXR8_Z5jdHi6B-myT` → `/api/jobs/:id`)

### Background Job Instrumentation

Jobs are instrumented in `utils.js` via `updateJob()`:

```javascript
// Job started
if (updated.status === "running" && current.status !== "running") {
  recordJobStart(jobType);
}

// Job completed/failed/cancelled
if (["completed", "failed", "cancelled"].includes(updated.status)) {
  const durationSeconds = (updated.updated_at - current.created_at) / 1000;
  recordJobComplete(jobType, updated.status, durationSeconds);

  if (updated.status === "failed") {
    const errorType = classifyError(updated.message);
    recordJobError(jobType, errorType);
  }
}
```

### State Operation Instrumentation

State save/load operations instrumented in `utils.js`:

```javascript
const getState = () => {
  stateOperationsTotal.inc({ operation: "load" });
  // ... load state from DB
};

const setState = (state) => {
  // ... save state to DB
  stateOperationsTotal.inc({ operation: "save" });
};
```

---

## Testing Metrics

### Unit Tests

Run metrics module tests:

```bash
npm test -- test/metrics.test.js
```

### Integration Tests

Run metrics endpoint tests:

```bash
npm test -- test/metrics-endpoint.test.js
```

### Manual Testing

```bash
# Start the server
npm run dev

# Generate some HTTP requests
curl http://localhost:3000/api/state
curl http://localhost:3000/api/build-info
curl -X POST http://localhost:3000/api/state -H "Content-Type: application/json" -d '{}'

# Fetch metrics
curl http://localhost:3000/api/metrics

# Look for http_requests_total and http_request_duration_seconds
curl http://localhost:3000/api/metrics | grep http_requests_total
```

---

## Future Enhancements

### Planned (Not Yet Implemented)

1. **SQLite Query Instrumentation**
   - Add `recordDbQuery()` calls to all DB operations
   - Measure query performance by operation type

2. **Cincinnati Metrics**
   - Instrument `cincinnatiJob.js` with success/failure counters
   - Track version discovery latency

3. **Operator Scan Metrics**
   - Record scan duration and success rate
   - Track catalog coverage

4. **oc-mirror Metrics**
   - Fully instrument oc-mirror workflows
   - Track archive sizes and transfer rates
   - Monitor signature verification errors

5. **Custom Business Metrics**
   - Track user workflows (blueprint → generate → export)
   - Monitor platform distribution (IPI vs UPI, platforms used)
   - Track parameter usage patterns

---

## Troubleshooting

### Metrics Not Appearing

**Problem:** `/api/metrics` returns empty or missing metrics

**Solutions:**
1. Ensure `metricsMiddleware` is registered before routes
2. Check that `NODE_ENV !== "test"` (metrics disabled in tests)
3. Verify Prometheus scrape configuration

### High Cardinality Warning

**Problem:** Too many unique label combinations

**Cause:** Routes not normalized (UUIDs, IDs in labels)

**Solution:** Metrics middleware normalizes routes automatically. If adding new metrics, avoid labels with unbounded values (user IDs, timestamps, etc.)

### Memory Growth

**Problem:** Memory usage increases over time

**Cause:** Metric label combinations accumulating

**Solution:**
1. Check for unbounded label values
2. Use `register.clear()` in tests to reset metrics
3. Monitor with `process_resident_memory_bytes` metric

---

## References

- [Prometheus Documentation](https://prometheus.io/docs/)
- [prom-client Library](https://github.com/siimon/prom-client)
- [Prometheus Best Practices](https://prometheus.io/docs/practices/naming/)
- [Grafana Dashboard Examples](https://grafana.com/grafana/dashboards/)

---

**Last Updated:** 2026-05-28  
**Version:** v1.7.0  
**Status:** Implemented (partial instrumentation)
