#!/usr/bin/env bash
# Test podman/docker compose build and run: backend + frontend respond correctly.
# Run from repo root. Requires: podman or docker, curl
set -e

COMPOSE_CMD=""
if command -v podman-compose &>/dev/null; then
  COMPOSE_CMD="podman-compose"
elif command -v podman &>/dev/null && podman compose version &>/dev/null 2>&1; then
  COMPOSE_CMD="podman compose"
elif command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
else
  echo "No podman-compose or docker compose found. Skipping compose test."
  exit 0
fi

echo "Using: $COMPOSE_CMD"
cd "$(dirname "$0")/.."

# Clean up previous run (ignore errors)
$COMPOSE_CMD down --remove-orphans 2>/dev/null || true

# Build and start (MOCK_MODE for Cincinnati/operator mock data)
MOCK_MODE=true $COMPOSE_CMD up --build -d

# Wait for backend
BACKEND_URL="http://127.0.0.1:4000"
FRONTEND_URL="http://127.0.0.1:5173"
MAX_WAIT=60
for i in $(seq 1 $MAX_WAIT); do
  if curl -sf "$BACKEND_URL/api/health" >/dev/null 2>&1; then
    echo "Backend healthy"
    break
  fi
  if [ "$i" -eq "$MAX_WAIT" ]; then
    echo "Backend did not become healthy in ${MAX_WAIT}s"
    $COMPOSE_CMD logs backend
    $COMPOSE_CMD down --remove-orphans
    exit 1
  fi
  sleep 1
done

# Wait for frontend
for i in $(seq 1 $MAX_WAIT); do
  if curl -sf -o /dev/null -w "%{http_code}" "$FRONTEND_URL/" 2>/dev/null | grep -q 200; then
    echo "Frontend responding"
    break
  fi
  if [ "$i" -eq "$MAX_WAIT" ]; then
    echo "Frontend did not respond in ${MAX_WAIT}s"
    $COMPOSE_CMD logs frontend
    $COMPOSE_CMD down --remove-orphans
    exit 1
  fi
  sleep 1
done

# API smoke tests
echo "Testing /api/health..."
curl -sf "$BACKEND_URL/api/health" | grep -q '"ok":true' || { echo "health check failed"; exit 1; }

echo "Testing /api/state..."
STATE=$(curl -sf "$BACKEND_URL/api/state")
echo "$STATE" | grep -q 'runId' || { echo "state missing runId"; exit 1; }

echo "Testing /api/schema/stepMap..."
curl -sf "$BACKEND_URL/api/schema/stepMap" | grep -qE '"mvpSteps"|"blueprint"' || { echo "stepMap invalid"; exit 1; }

echo "Testing /api/cincinnati/channels (MOCK_MODE)..."
curl -sf "$BACKEND_URL/api/cincinnati/channels" | grep -qE '"channels"|"4\.' || { echo "cincinnati channels failed"; exit 1; }

echo "Testing POST /api/operators/confirm (lock flow)..."
CONFIRM=$(curl -sf -X POST "$BACKEND_URL/api/operators/confirm" -H "Content-Type: application/json" -d "{}")
echo "$CONFIRM" | grep -qE '"ok":\s*true|"versionConfirmed"' || { echo "operators/confirm failed: $CONFIRM"; exit 1; }

echo "Testing frontend HTML..."
curl -sf "$FRONTEND_URL/" | grep -q 'OpenShift Airgap Architect' || { echo "frontend HTML check failed"; exit 1; }

echo "All compose smoke tests passed."
$COMPOSE_CMD down --remove-orphans
