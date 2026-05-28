# Load Testing Guide

**Purpose:** Validate application performance, resource limits, and capacity planning under realistic concurrent load.

**Status:** Load testing infrastructure complete. Awaiting execution with production-like deployment.

---

## Overview

The load test suite (`scripts/load-test.sh`) validates application behavior under concurrent user load, measuring:
- HTTP request latency (p50, p95, p99)
- State persistence performance (SQLite)
- Cincinnati version discovery responsiveness
- YAML generation throughput
- Concurrent user capacity
- Memory and CPU usage under load

---

## Prerequisites

**Required:**
1. Application running (backend at `:4000`, frontend at `:5173`)
2. `curl` command available
3. `jq` (optional, for JSON parsing)
4. Sufficient system resources (8GB+ RAM recommended for load testing)

**Deployment:**
```bash
# Local development
docker compose up --build

# OR Kubernetes/OpenShift
kubectl apply -f manifests/base/
```

**Verify application is ready:**
```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/ready
```

---

## Running Load Tests

### Quick Start

**Default test (10 concurrent users, 30 minutes):**
```bash
./scripts/load-test.sh
```

**Custom configuration:**
```bash
./scripts/load-test.sh <base-url> <concurrent-users> <duration-minutes>

# Examples:
./scripts/load-test.sh http://localhost:4000 10 5     # 10 users, 5 minutes
./scripts/load-test.sh http://localhost:4000 25 30    # 25 users, 30 minutes
./scripts/load-test.sh http://localhost:4000 50 60    # 50 users, 1 hour
```

**Monitor resources during test:**
```bash
# Docker Compose
docker stats

# Kubernetes/OpenShift
kubectl top pod -l app=airgap-architect
watch kubectl get pods -l app=airgap-architect
kubectl get events --field-selector reason=OOMKilled
```

---

## Test Scenarios

### Test 1: Health Check Baseline (1000 requests)

**Purpose:** Establish baseline for fastest endpoint.

**Metrics:**
- Total requests: 1000
- Expected P95: <50ms
- Expected P99: <100ms

**What it measures:**
- Minimal overhead response time
- Process health
- No database or computation

### Test 2: Cincinnati Channels Discovery (500 requests)

**Purpose:** Validate version discovery performance.

**Metrics:**
- Total requests: 500
- Expected P95: <2000ms (2s)
- Expected P99: <5000ms (5s)

**What it measures:**
- External API call performance (Cincinnati graph)
- Caching effectiveness
- Network latency handling

### Test 3: State Save/Load Operations (500 save + 500 load)

**Purpose:** Validate SQLite performance under load.

**Metrics:**
- Save operations: 500
- Load operations: 500
- Expected P95 (save): <200ms
- Expected P95 (load): <100ms

**What it measures:**
- SQLite write performance
- SQLite read performance
- State persistence overhead

### Test 4: Concurrent User Simulation

**Purpose:** Realistic multi-user wizard workflow.

**Configuration:**
- Concurrent users: Configurable (default 10)
- Duration: Configurable (default 30 minutes)
- Per-user workflow:
  1. Load state
  2. Update configuration
  3. Save state
  4. Check Cincinnati channels (33% probability)
  5. Health check
  6. Think time: 1-5 seconds (random)

**Metrics:**
- Total requests per user
- Failure rate per user
- Overall throughput

**What it measures:**
- Multi-user scalability
- Resource contention
- Failure rates under realistic load

### Test 5: YAML Generation Performance (100 requests)

**Purpose:** Validate configuration generation throughput.

**Metrics:**
- Total requests: 100
- Expected P95: <1000ms (1s)
- Expected P99: <2000ms (2s)

**What it measures:**
- YAML generation computation time
- Template rendering performance
- Validation overhead

---

## Expected Performance Baselines

### Latency Targets

| Operation | P50 | P95 | P99 | Max Acceptable |
|-----------|-----|-----|-----|----------------|
| Health Check | <20ms | <50ms | <100ms | 200ms |
| State Load | <50ms | <100ms | <200ms | 500ms |
| State Save | <100ms | <200ms | <500ms | 1000ms |
| Cincinnati Channels | <500ms | <2000ms | <5000ms | 10000ms |
| YAML Generation | <500ms | <1000ms | <2000ms | 5000ms |

### Throughput Targets

| Metric | Target | Acceptable | Notes |
|--------|--------|------------|-------|
| Concurrent users | 25+ | 10+ | Without OOM or CPU throttling |
| Requests/second | 100+ | 50+ | Aggregated across all users |
| Failure rate | <0.1% | <1% | Network/timeout failures |

### Resource Usage Targets

| Resource | Backend | Frontend | Notes |
|----------|---------|----------|-------|
| CPU (avg) | <1 core | <0.2 cores | Under 10 concurrent users |
| CPU (peak) | <2 cores | <0.5 cores | During YAML generation |
| Memory (avg) | <1GB | <256MB | Steady state |
| Memory (peak) | <2GB | <512MB | With cached data |

---

## Analyzing Results

### Output Files

Load test creates timestamped results directory:
```
load-test-results-YYYYMMDD-HHMMSS/
├── health_timings.txt          # Health check latencies (ms)
├── cincinnati_timings.txt      # Cincinnati latencies (ms)
├── state_save_timings.txt      # State save latencies (ms)
├── state_load_timings.txt      # State load latencies (ms)
├── generate_timings.txt        # YAML generation latencies (ms)
└── user_summary.txt            # Per-user request counts and failures
```

### Summary Statistics

The script automatically calculates:
- Request count
- Average latency
- P50 (median)
- P95
- P99
- Max latency

**Example output:**
```
Health Check Performance:
  Requests: 1000
  Average: 18ms
  P50 (median): 15ms
  P95: 32ms
  P99: 78ms
  Max: 145ms
```

### Import to Spreadsheet

For trend analysis:
```bash
# Combine timing files
cd load-test-results-YYYYMMDD-HHMMSS/
cat *_timings.txt > all_timings.csv
```

Import `all_timings.csv` into Excel/Google Sheets for visualization.

---

## Load Testing Scenarios

### Scenario 1: Light Load (Development)

**Configuration:**
- Concurrent users: 5
- Duration: 5 minutes

**Purpose:** Validate basic functionality and establish baseline.

**Command:**
```bash
./scripts/load-test.sh http://localhost:4000 5 5
```

### Scenario 2: Normal Load (Production-Like)

**Configuration:**
- Concurrent users: 10-15
- Duration: 30 minutes

**Purpose:** Validate performance under expected production load.

**Command:**
```bash
./scripts/load-test.sh http://localhost:4000 15 30
```

### Scenario 3: Peak Load (Capacity Planning)

**Configuration:**
- Concurrent users: 25-50
- Duration: 1 hour

**Purpose:** Identify resource limits and failure points.

**Command:**
```bash
./scripts/load-test.sh http://localhost:4000 50 60
```

### Scenario 4: Stress Test (Breaking Point)

**Configuration:**
- Concurrent users: 100+
- Duration: Until failure or 2 hours

**Purpose:** Determine maximum capacity and failure modes.

**Command:**
```bash
./scripts/load-test.sh http://localhost:4000 100 120
```

---

## Failure Mode Analysis

### Common Failure Patterns

**1. Memory Exhaustion (OOM)**
- **Symptom:** Pod/container killed, error logs show OOMKilled
- **Check:** `kubectl get events --field-selector reason=OOMKilled`
- **Solution:** Increase memory limits in `manifests/base/backend-deployment.yaml`

**2. CPU Throttling**
- **Symptom:** P95/P99 latencies increase over time, slow responses
- **Check:** `kubectl top pod -l app=airgap-architect`
- **Solution:** Increase CPU limits or reduce concurrent load

**3. Database Locking**
- **Symptom:** State save/load operations timeout, "database is locked" errors
- **Check:** Review backend logs for SQLite errors
- **Solution:** Implement connection pooling or switch to WAL mode (already enabled)

**4. Connection Exhaustion**
- **Symptom:** "Too many open files" or connection refused errors
- **Check:** `lsof -p <pid> | wc -l`
- **Solution:** Increase file descriptor limits

**5. Timeout Failures**
- **Symptom:** Requests fail with timeout errors after 30s
- **Check:** Review timing files for >30000ms values
- **Solution:** Optimize slow operations or increase timeout

---

## Optimization Recommendations

### Based on Load Test Results

**If P95 health check >100ms:**
- Check for logging overhead
- Verify no database queries in health endpoint
- Review middleware overhead

**If P95 state operations >500ms:**
- Enable SQLite WAL mode (already enabled)
- Consider connection pooling
- Review state payload size
- Add database indexes if needed

**If P95 Cincinnati >5s:**
- Increase cache TTL for channel data
- Implement background refresh job
- Add circuit breaker for external API failures

**If P95 YAML generation >2s:**
- Profile template rendering
- Cache compiled templates
- Optimize validation logic
- Consider async generation for large configs

**If failure rate >1%:**
- Review error logs for root causes
- Check network connectivity
- Verify resource limits are adequate
- Add retry logic for transient failures

---

## Production Deployment Checklist

Before deploying to production:

- [ ] Run load tests with production-like configuration (15+ concurrent users, 30+ minutes)
- [ ] Verify all P95 latencies meet targets
- [ ] Confirm failure rate <1%
- [ ] Check memory usage under load (should not exceed limits)
- [ ] Verify no OOM kills during load test
- [ ] Review logs for errors or warnings
- [ ] Test with realistic state payload sizes
- [ ] Validate resource limits are adequate (see `docs/CAPACITY_PLANNING.md`)
- [ ] Document observed capacity (max concurrent users, throughput)
- [ ] Set up monitoring and alerting (Prometheus/Grafana)

---

## Continuous Load Testing

### Automated Testing

**CI/CD Integration:**
```yaml
# Example GitHub Actions workflow
- name: Run load tests
  run: |
    docker compose up --build -d
    sleep 30  # Wait for services to be ready
    ./scripts/load-test.sh http://localhost:4000 10 5
    docker compose down

- name: Upload load test results
  uses: actions/upload-artifact@v3
  with:
    name: load-test-results
    path: load-test-results-*/
```

**Scheduled Regression Testing:**
- Run weekly load tests against staging environment
- Compare results to baseline
- Alert on performance degradation (>20% slower)

---

## Known Limitations

1. **Single-node testing** - Script targets single backend instance, not load-balanced cluster
2. **No oc-mirror testing** - Script does not trigger oc-mirror jobs (too heavy for automated testing)
3. **Simple state payloads** - Uses minimal state, not complex multi-step wizard configurations
4. **Network-only** - Does not test disk I/O for large archive operations

For comprehensive capacity testing, supplement with:
- Manual oc-mirror job execution (50-200GB archives)
- Multi-replica deployment testing
- Storage subsystem benchmarking

---

## Results Template

### Load Test Report

**Date:** YYYY-MM-DD  
**Version:** vX.X.X  
**Deployment:** Development / Staging / Production  
**Configuration:** X concurrent users, Y minutes duration

#### Environment

| Component | Specification |
|-----------|---------------|
| CPU | X cores @ Y GHz |
| Memory | XGB RAM |
| Storage | SSD / HDD |
| Network | X Mbps |
| Deployment | Docker Compose / Kubernetes |

#### Results

| Operation | Requests | Avg | P50 | P95 | P99 | Max | Failures |
|-----------|----------|-----|-----|-----|-----|-----|----------|
| Health Check | 1000 | Xms | Xms | Xms | Xms | Xms | 0 |
| State Load | 500 | Xms | Xms | Xms | Xms | Xms | X |
| State Save | 500 | Xms | Xms | Xms | Xms | Xms | X |
| Cincinnati | 500 | Xms | Xms | Xms | Xms | Xms | X |
| YAML Generate | 100 | Xms | Xms | Xms | Xms | Xms | X |

#### Resource Usage

| Metric | Backend | Frontend |
|--------|---------|----------|
| CPU (avg) | X% | X% |
| CPU (peak) | X% | X% |
| Memory (avg) | XMB | XMB |
| Memory (peak) | XMB | XMB |

#### Findings

- **Performance:** (Meets/Exceeds/Below) targets
- **Capacity:** Maximum X concurrent users observed
- **Issues:** (List any failures, errors, or warnings)

#### Recommendations

1. (Action item from results)
2. (Action item from results)

---

**Last Updated:** 2026-05-28  
**Script Version:** scripts/load-test.sh (PROD-004 implementation)
