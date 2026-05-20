#!/bin/bash
# OpenShift Airgap Architect - Load Testing Script
#
# Tests realistic wizard workflows under concurrent load to validate
# resource limits and capacity planning.
#
# Usage: ./scripts/load-test.sh [base-url] [concurrent-users] [duration-minutes]
#
# Examples:
#   ./scripts/load-test.sh http://localhost:4000 10 5
#   ./scripts/load-test.sh https://airgap.example.com 25 30
#
# Prerequisites: curl, jq (optional for JSON parsing)
#
# Author: Bill Strauss

set -euo pipefail

# Configuration
BASE_URL=${1:-http://localhost:4000}
CONCURRENT_USERS=${2:-10}
DURATION_MIN=${3:-30}
DURATION_SEC=$((DURATION_MIN * 60))
RESULTS_DIR="./load-test-results-$(date +%Y%m%d-%H%M%S)"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test tracking
TOTAL_REQUESTS=0
FAILED_REQUESTS=0
SUCCESS_REQUESTS=0

echo "========================================="
echo "OpenShift Airgap Architect - Load Test"
echo "========================================="
echo ""
echo "Configuration:"
echo "  Base URL: $BASE_URL"
echo "  Concurrent Users: $CONCURRENT_USERS"
echo "  Duration: ${DURATION_MIN} minutes (${DURATION_SEC} seconds)"
echo "  Results Directory: $RESULTS_DIR"
echo ""

# Create results directory
mkdir -p "$RESULTS_DIR"

# Check prerequisites
if ! command -v curl &> /dev/null; then
    echo -e "${RED}ERROR: curl is required but not installed${NC}"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo -e "${YELLOW}WARNING: jq not installed, JSON parsing disabled${NC}"
    HAS_JQ=false
else
    HAS_JQ=true
fi

# Test connectivity
echo "Testing connectivity to $BASE_URL..."
if ! curl -s --max-time 5 "$BASE_URL/api/health" > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Cannot connect to $BASE_URL/api/health${NC}"
    echo "Ensure the application is running and accessible."
    exit 1
fi
echo -e "${GREEN}✓ Connectivity test passed${NC}"
echo ""

# Function to log request outcome
log_request() {
    local status=$1
    ((TOTAL_REQUESTS++))
    if [ "$status" = "success" ]; then
        ((SUCCESS_REQUESTS++))
    else
        ((FAILED_REQUESTS++))
    fi
}

# Function to record timing
record_timing() {
    local operation=$1
    local duration_ms=$2
    echo "$duration_ms" >> "$RESULTS_DIR/${operation}_timings.txt"
}

# Test 1: Baseline health check load
echo "========================================="
echo "Test 1: Health Check Endpoint (Baseline)"
echo "========================================="
echo "Sending 1000 rapid-fire health check requests..."
START_TIME=$(date +%s%N)

for i in {1..1000}; do
    REQ_START=$(date +%s%N)
    if curl -s --max-time 2 "$BASE_URL/api/health" > /dev/null 2>&1; then
        log_request "success"
    else
        log_request "failure"
    fi
    REQ_END=$(date +%s%N)
    DURATION_MS=$(( (REQ_END - REQ_START) / 1000000 ))
    record_timing "health" "$DURATION_MS"

    # Progress indicator every 100 requests
    if (( i % 100 == 0 )); then
        echo "  Progress: $i/1000 requests completed"
    fi
done

END_TIME=$(date +%s%N)
TOTAL_MS=$(( (END_TIME - START_TIME) / 1000000 ))
echo ""
echo -e "${GREEN}✓ Health check test complete${NC}"
echo "  Total requests: $TOTAL_REQUESTS"
echo "  Successful: $SUCCESS_REQUESTS"
echo "  Failed: $FAILED_REQUESTS"
echo "  Total time: ${TOTAL_MS}ms"
echo "  Average: $((TOTAL_MS / 1000))ms per request"
echo ""

# Reset counters for next test
TOTAL_REQUESTS=0
FAILED_REQUESTS=0
SUCCESS_REQUESTS=0

# Test 2: Cincinnati channels endpoint
echo "========================================="
echo "Test 2: Cincinnati Channels Discovery"
echo "========================================="
echo "Testing version discovery endpoint (500 requests)..."

for i in {1..500}; do
    REQ_START=$(date +%s%N)
    if curl -s --max-time 10 "$BASE_URL/api/cincinnati/channels" > /dev/null 2>&1; then
        log_request "success"
    else
        log_request "failure"
    fi
    REQ_END=$(date +%s%N)
    DURATION_MS=$(( (REQ_END - REQ_START) / 1000000 ))
    record_timing "cincinnati" "$DURATION_MS"

    if (( i % 50 == 0 )); then
        echo "  Progress: $i/500 requests completed"
    fi
done

echo ""
echo -e "${GREEN}✓ Cincinnati channels test complete${NC}"
echo "  Total requests: $TOTAL_REQUESTS"
echo "  Successful: $SUCCESS_REQUESTS"
echo "  Failed: $FAILED_REQUESTS"
echo ""

# Reset counters
TOTAL_REQUESTS=0
FAILED_REQUESTS=0
SUCCESS_REQUESTS=0

# Test 3: State operations (save/load)
echo "========================================="
echo "Test 3: State Save/Load Operations"
echo "========================================="
echo "Testing realistic state persistence (500 save + 500 load)..."

# Sample state payload (minimal but valid)
STATE_PAYLOAD='{
  "state": {
    "blueprint": {
      "clusterName": "load-test-cluster",
      "baseDomain": "example.com",
      "selectedVersions": ["4.15"],
      "includeLatestZ": true
    },
    "globalStrategy": {
      "platform": "bare-metal-ipi",
      "fips": false,
      "highAvailability": "FullHA"
    }
  }
}'

# Save state operations
for i in {1..500}; do
    REQ_START=$(date +%s%N)
    if curl -s --max-time 5 -X POST "$BASE_URL/api/state" \
        -H "Content-Type: application/json" \
        -d "$STATE_PAYLOAD" > /dev/null 2>&1; then
        log_request "success"
    else
        log_request "failure"
    fi
    REQ_END=$(date +%s%N)
    DURATION_MS=$(( (REQ_END - REQ_START) / 1000000 ))
    record_timing "state_save" "$DURATION_MS"

    if (( i % 50 == 0 )); then
        echo "  Save progress: $i/500 requests completed"
    fi
done

# Load state operations
for i in {1..500}; do
    REQ_START=$(date +%s%N)
    if curl -s --max-time 5 "$BASE_URL/api/state" > /dev/null 2>&1; then
        log_request "success"
    else
        log_request "failure"
    fi
    REQ_END=$(date +%s%N)
    DURATION_MS=$(( (REQ_END - REQ_START) / 1000000 ))
    record_timing "state_load" "$DURATION_MS"

    if (( i % 50 == 0 )); then
        echo "  Load progress: $i/500 requests completed"
    fi
done

echo ""
echo -e "${GREEN}✓ State operations test complete${NC}"
echo "  Total requests: $TOTAL_REQUESTS"
echo "  Successful: $SUCCESS_REQUESTS"
echo "  Failed: $FAILED_REQUESTS"
echo ""

# Reset counters
TOTAL_REQUESTS=0
FAILED_REQUESTS=0
SUCCESS_REQUESTS=0

# Test 4: Concurrent user simulation
echo "========================================="
echo "Test 4: Concurrent User Workflow"
echo "========================================="
echo "Simulating $CONCURRENT_USERS concurrent users for ${DURATION_MIN} minutes..."
echo "Each user performs realistic wizard workflow:"
echo "  - Load state"
echo "  - Update configuration"
echo "  - Save state"
echo "  - Check Cincinnati channels"
echo "  - Random think time (1-5 seconds)"
echo ""

# Function to simulate a single user workflow
simulate_user() {
    local user_id=$1
    local start_time=$SECONDS
    local end_time=$((SECONDS + DURATION_SEC))
    local user_requests=0
    local user_failures=0

    while [ $SECONDS -lt $end_time ]; do
        # 1. Load state
        if ! curl -s --max-time 5 "$BASE_URL/api/state" > /dev/null 2>&1; then
            ((user_failures++))
        fi
        ((user_requests++))

        # 2. Save updated state
        USER_STATE=$(echo "$STATE_PAYLOAD" | sed "s/load-test-cluster/user-${user_id}-cluster/")
        if ! curl -s --max-time 5 -X POST "$BASE_URL/api/state" \
            -H "Content-Type: application/json" \
            -d "$USER_STATE" > /dev/null 2>&1; then
            ((user_failures++))
        fi
        ((user_requests++))

        # 3. Check Cincinnati channels (occasional)
        if (( RANDOM % 3 == 0 )); then
            if ! curl -s --max-time 10 "$BASE_URL/api/cincinnati/channels" > /dev/null 2>&1; then
                ((user_failures++))
            fi
            ((user_requests++))
        fi

        # 4. Health check
        if ! curl -s --max-time 2 "$BASE_URL/api/health" > /dev/null 2>&1; then
            ((user_failures++))
        fi
        ((user_requests++))

        # Think time: 1-5 seconds
        sleep $((RANDOM % 5 + 1))
    done

    # Write user summary
    echo "User $user_id: $user_requests requests, $user_failures failures" >> "$RESULTS_DIR/user_summary.txt"
}

# Launch concurrent users in background
PIDS=()
for i in $(seq 1 $CONCURRENT_USERS); do
    simulate_user $i &
    PIDS+=($!)
done

echo "Load test running with PIDs: ${PIDS[*]}"
echo "Duration: ${DURATION_MIN} minutes"
echo ""
echo "To monitor resources during this test:"
echo "  kubectl top pod -l app=airgap-architect"
echo "  kubectl get events --field-selector reason=OOMKilled"
echo ""
echo "Press Ctrl+C to stop early (will wait for current operations to finish)"
echo ""

# Wait for all background jobs
for pid in "${PIDS[@]}"; do
    wait "$pid"
done

echo ""
echo -e "${GREEN}✓ Concurrent user simulation complete${NC}"
echo ""

# Test 5: YAML generation endpoint
echo "========================================="
echo "Test 5: YAML Generation Performance"
echo "========================================="
echo "Testing configuration generation endpoint (100 requests)..."

GENERATE_PAYLOAD='{
  "state": {
    "blueprint": {
      "clusterName": "perf-test",
      "baseDomain": "example.com",
      "selectedVersions": ["4.15"],
      "includeLatestZ": true,
      "pullSecret": "{\"auths\":{}}"
    },
    "globalStrategy": {
      "platform": "bare-metal-ipi",
      "fips": false,
      "highAvailability": "FullHA"
    },
    "networkingV2": {
      "clusterNetworkCidr": "10.128.0.0/14",
      "clusterNetworkHostPrefix": 23,
      "serviceNetworkCidr": "172.30.0.0/16",
      "machineNetworkCidr": "10.90.0.0/24"
    },
    "hostInventory": {
      "nodes": []
    }
  }
}'

for i in {1..100}; do
    REQ_START=$(date +%s%N)
    if curl -s --max-time 30 -X POST "$BASE_URL/api/generate" \
        -H "Content-Type: application/json" \
        -d "$GENERATE_PAYLOAD" > /dev/null 2>&1; then
        log_request "success"
    else
        log_request "failure"
    fi
    REQ_END=$(date +%s%N)
    DURATION_MS=$(( (REQ_END - REQ_START) / 1000000 ))
    record_timing "generate" "$DURATION_MS"

    if (( i % 10 == 0 )); then
        echo "  Progress: $i/100 requests completed"
    fi
done

echo ""
echo -e "${GREEN}✓ YAML generation test complete${NC}"
echo "  Total requests: $TOTAL_REQUESTS"
echo "  Successful: $SUCCESS_REQUESTS"
echo "  Failed: $FAILED_REQUESTS"
echo ""

# Generate summary statistics
echo "========================================="
echo "Test Results Summary"
echo "========================================="
echo ""

# Function to calculate percentiles
calculate_stats() {
    local file=$1
    local operation=$2

    if [ ! -f "$file" ]; then
        echo "No data for $operation"
        return
    fi

    local count=$(wc -l < "$file")
    if [ "$count" -eq 0 ]; then
        echo "No data for $operation"
        return
    fi

    local sorted=$(sort -n "$file")
    local p50=$(echo "$sorted" | awk -v p=50 -v c="$count" 'NR==int((c*p)/100)+1')
    local p95=$(echo "$sorted" | awk -v p=95 -v c="$count" 'NR==int((c*p)/100)+1')
    local p99=$(echo "$sorted" | awk -v p=99 -v c="$count" 'NR==int((c*p)/100)+1')
    local max=$(echo "$sorted" | tail -1)
    local sum=$(echo "$sorted" | awk '{s+=$1} END {print s}')
    local avg=$((sum / count))

    echo "$operation Performance:"
    echo "  Requests: $count"
    echo "  Average: ${avg}ms"
    echo "  P50 (median): ${p50}ms"
    echo "  P95: ${p95}ms"
    echo "  P99: ${p99}ms"
    echo "  Max: ${max}ms"
    echo ""
}

calculate_stats "$RESULTS_DIR/health_timings.txt" "Health Check"
calculate_stats "$RESULTS_DIR/cincinnati_timings.txt" "Cincinnati Channels"
calculate_stats "$RESULTS_DIR/state_save_timings.txt" "State Save"
calculate_stats "$RESULTS_DIR/state_load_timings.txt" "State Load"
calculate_stats "$RESULTS_DIR/generate_timings.txt" "YAML Generation"

# User summary
if [ -f "$RESULTS_DIR/user_summary.txt" ]; then
    echo "Concurrent User Summary:"
    cat "$RESULTS_DIR/user_summary.txt"
    echo ""
fi

echo "========================================="
echo "Recommendations"
echo "========================================="
echo ""
echo "1. Review P95/P99 latencies:"
echo "   - Health/State ops should be <500ms P95"
echo "   - Cincinnati should be <2s P95"
echo "   - YAML generation should be <1s P95"
echo ""
echo "2. Check for errors:"
echo "   - Review failed requests in summary above"
echo "   - Check application logs for errors"
echo "   - Look for OOM kills: kubectl get events --field-selector reason=OOMKilled"
echo ""
echo "3. Monitor resource usage:"
echo "   - kubectl top pod -l app=airgap-architect"
echo "   - Compare against resource limits in manifests/base/*.yaml"
echo "   - If CPU/memory usage >80%, consider increasing limits"
echo ""
echo "4. Results saved to: $RESULTS_DIR"
echo "   - Review timing files for detailed analysis"
echo "   - Import into spreadsheet for trend analysis"
echo ""
echo -e "${GREEN}Load test complete!${NC}"
