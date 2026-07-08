#!/usr/bin/env bash
# Frontend container smoke test — proves Vite resolves shared/versionUtils.js at runtime

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIQUE_SUFFIX="$$-$(date +%s)"
IMAGE_NAME="${SMOKE_IMAGE_NAME:-openshift-airgap-architect-frontend-smoke-${UNIQUE_SUFFIX}}"
CONTAINER_NAME="${SMOKE_CONTAINER_NAME:-oaa-frontend-smoke-${UNIQUE_SUFFIX}}"
HOST_PORT="${SMOKE_PORT:-5174}"

# Reject unsafe image name overrides
if [ -n "${SMOKE_IMAGE_NAME:-}" ]; then
  if [ "$SMOKE_IMAGE_NAME" = "openshift-airgap-architect-frontend" ] || \
     [ "$SMOKE_IMAGE_NAME" = "localhost/openshift-airgap-architect-frontend" ]; then
    echo "❌ Error: SMOKE_IMAGE_NAME cannot be set to the normal application image name."
    echo "   Rejected: $SMOKE_IMAGE_NAME"
    echo "   This would cause the cleanup to remove the application image."
    exit 1
  fi
  if ! echo "$SMOKE_IMAGE_NAME" | grep -q "smoke"; then
    echo "❌ Error: SMOKE_IMAGE_NAME override must contain the token 'smoke'."
    echo "   Rejected: $SMOKE_IMAGE_NAME"
    echo "   Example: my-custom-smoke-image"
    exit 1
  fi
fi

# Detect container engine
if [ -n "${CONTAINER_ENGINE:-}" ]; then
  ENGINE="$CONTAINER_ENGINE"
elif command -v podman &>/dev/null; then
  ENGINE=podman
elif command -v docker &>/dev/null; then
  ENGINE=docker
else
  echo "❌ Error: Neither podman nor docker found. Install one and retry."
  exit 1
fi

echo "🐳 Using container engine: $ENGINE"
echo "📦 Building frontend image from repo root context..."

cd "$REPO_ROOT"

cleanup() {
  local exit_code=$?
  echo ""
  echo "🧹 Cleaning up..."
  if $ENGINE ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "   Stopping container: $CONTAINER_NAME"
    $ENGINE stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
    echo "   Removing container: $CONTAINER_NAME"
    $ENGINE rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  if [ -n "${IMAGE_NAME:-}" ]; then
    echo "   Removing image: $IMAGE_NAME"
    $ENGINE rmi "${IMAGE_NAME}:latest" >/dev/null 2>&1 || true
  fi
  exit $exit_code
}

trap cleanup EXIT INT TERM

# Build with repo root context
$ENGINE build -t "$IMAGE_NAME" -f frontend/Containerfile .

echo "🚀 Starting frontend container on port $HOST_PORT..."
$ENGINE run -d \
  --name "$CONTAINER_NAME" \
  -p "127.0.0.1:${HOST_PORT}:5173" \
  "$IMAGE_NAME"

echo "⏳ Waiting for Vite dev server to become ready..."
max_wait=30
elapsed=0
until curl -sf "http://127.0.0.1:${HOST_PORT}" >/dev/null 2>&1; do
  if [ $elapsed -ge $max_wait ]; then
    echo "❌ Vite did not become ready within ${max_wait}s"
    echo ""
    echo "Container logs:"
    $ENGINE logs "$CONTAINER_NAME"
    exit 1
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done

echo "✅ Vite is ready"
echo ""

# Test critical routes that import shared/versionUtils.js
test_routes=(
  "/"
  "/src/App.jsx"
  "/src/shared/versionPolicy.js"
  "/src/shared/cincinnatiChannels.js"
)

failed=0
for route in "${test_routes[@]}"; do
  echo "🔍 Testing: $route"
  response=$(curl -s -w "\n%{http_code}" "http://127.0.0.1:${HOST_PORT}${route}")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | head -n -1)

  if [ "$http_code" != "200" ]; then
    echo "   ❌ HTTP $http_code (expected 200)"
    failed=1
  else
    echo "   ✅ HTTP 200"
  fi

  # Check for import resolution errors in response
  forbidden_patterns=(
    "Failed to resolve import"
    "import-analysis"
    "Internal Server Error"
    "Cannot find module"
    "ERR_MODULE_NOT_FOUND"
  )

  for pattern in "${forbidden_patterns[@]}"; do
    if echo "$body" | grep -qi "$pattern"; then
      echo "   ❌ Response contains forbidden pattern: $pattern"
      failed=1
    fi
  done
done

# Check container logs for errors
echo ""
echo "📋 Checking container logs for import errors..."
logs=$($ENGINE logs "$CONTAINER_NAME" 2>&1)

forbidden_log_patterns=(
  "Failed to resolve import"
  "import-analysis"
  "Internal Server Error"
  "Cannot find module"
  "ERR_MODULE_NOT_FOUND"
)

for pattern in "${forbidden_log_patterns[@]}"; do
  if echo "$logs" | grep -qi "$pattern"; then
    echo "❌ Container log contains forbidden pattern: $pattern"
    echo ""
    echo "Full container logs:"
    echo "$logs"
    failed=1
  fi
done

if [ $failed -eq 0 ]; then
  echo "✅ No import errors found in logs"
  echo ""
  echo "🎉 Frontend container smoke test PASSED"
  echo "   All routes returned HTTP 200"
  echo "   No import resolution errors detected"
  exit 0
else
  echo ""
  echo "❌ Frontend container smoke test FAILED"
  echo ""
  echo "Full container logs:"
  $ENGINE logs "$CONTAINER_NAME"
  exit 1
fi
