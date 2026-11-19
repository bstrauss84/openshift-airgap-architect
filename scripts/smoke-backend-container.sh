#!/usr/bin/env bash
# Backend container smoke test (v2.2.2, permanent build gate).
#
# Builds backend/Containerfile from the REPOSITORY-ROOT context (as compose and
# Tekton do), then proves, in the built image:
#   - oc and oc-mirror exist, are regular files, mode 0755, and are readable,
#     hashable and executable as the runtime user (UID 1001, GID 0);
#   - oc-mirror implements `--v2 list operators` (operator discovery needs it);
#   - /app/tools-provenance.env records each tool's version, SHA-256, channel
#     and architecture, and the oc-mirror channel is never the global `latest`
#     (OpenShift 5.0.1 since 2026-11-19, which publishes no oc-mirror);
#   - the backend starts and answers /api/health and /api/ready.
# The 2026-11-19 regression ("FATAL: no SHA256 for oc-mirror.tar.gz") failed the
# backend image build while CI only built the frontend image; this closes that gap.
#
# Usage: CONTAINER_ENGINE=docker|podman SMOKE_PORT=4999 bash scripts/smoke-backend-container.sh
#        SMOKE_NO_CACHE=1 forces an uncached build.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIQUE_SUFFIX="$$-$(date +%s)"
IMAGE_NAME="${SMOKE_IMAGE_NAME:-openshift-airgap-architect-backend-smoke-${UNIQUE_SUFFIX}}"
CONTAINER_NAME="${SMOKE_CONTAINER_NAME:-oaa-backend-smoke-${UNIQUE_SUFFIX}}"
HOST_PORT="${SMOKE_PORT:-4999}"

# Never touch the normal application image.
if [ -n "${SMOKE_IMAGE_NAME:-}" ]; then
  case "$SMOKE_IMAGE_NAME" in
    openshift-airgap-architect-backend|localhost/openshift-airgap-architect-backend|*:latest)
      echo "Error: SMOKE_IMAGE_NAME must not be the application image or a :latest tag (rejected: $SMOKE_IMAGE_NAME)"; exit 1 ;;
  esac
  echo "$SMOKE_IMAGE_NAME" | grep -q "smoke" || { echo "Error: SMOKE_IMAGE_NAME must contain 'smoke' (rejected: $SMOKE_IMAGE_NAME)"; exit 1; }
fi

if [ -n "${CONTAINER_ENGINE:-}" ]; then ENGINE="$CONTAINER_ENGINE"
elif command -v podman >/dev/null 2>&1; then ENGINE=podman
elif command -v docker >/dev/null 2>&1; then ENGINE=docker
else echo "Error: neither podman nor docker found"; exit 1; fi
echo "Using container engine: $ENGINE"

DATA_DIR_HOST="$(mktemp -d)"
chmod 0777 "$DATA_DIR_HOST"
cleanup() {
  local rc=$?
  if $ENGINE ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    [ "$rc" -ne 0 ] && { echo "--- backend logs"; $ENGINE logs "$CONTAINER_NAME" 2>&1 | tail -40; }
    $ENGINE rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  $ENGINE rmi "$IMAGE_NAME" >/dev/null 2>&1 || true
  if [ "$ENGINE" = podman ]; then podman unshare rm -rf "$DATA_DIR_HOST" 2>/dev/null || rm -rf "$DATA_DIR_HOST" || true
  else rm -rf "$DATA_DIR_HOST" 2>/dev/null || true; fi
  exit $rc
}
trap cleanup EXIT INT TERM

cd "$REPO_ROOT"
echo "Building backend image from the repository-root context..."
$ENGINE build ${SMOKE_NO_CACHE:+--no-cache} -t "$IMAGE_NAME" -f backend/Containerfile .

echo "Checking the baked tools as UID 1001 (GID 0)..."
$ENGINE run --rm --user 1001:0 --entrypoint /bin/sh "$IMAGE_NAME" -c '
  set -eu
  case "$(uname -m)" in x86_64) want=x86_64 ;; aarch64) want=aarch64 ;; ppc64le) want=ppc64le ;; s390x) want=s390x ;; *) want="$(uname -m)" ;; esac
  for t in oc oc-mirror; do
    f=/usr/local/bin/$t
    [ -f "$f" ] && [ ! -L "$f" ] || { echo "FAIL: $f is not a regular file"; exit 1; }
    [ "$(stat -c %a "$f")" = 755 ] || { echo "FAIL: $f mode $(stat -c %a "$f"), expected 755"; exit 1; }
    [ -r "$f" ] && [ -x "$f" ] || { echo "FAIL: $f not readable/executable by $(id -u)"; exit 1; }
    sha256sum "$f" >/dev/null || { echo "FAIL: cannot hash $f as $(id -u)"; exit 1; }
  done
  oc version --client >/dev/null
  oc-mirror --v2 list operators --help | grep -q "list operators" || { echo "FAIL: oc-mirror lacks --v2 list operators"; exit 1; }
  . /app/tools-provenance.env
  for v in OC_RESOLVED_VERSION OC_RESOLVED_SHA256 OC_MIRROR_RESOLVED_VERSION OC_MIRROR_RESOLVED_SHA256 OC_MIRROR_RESOLVED_CHANNEL TOOLS_RESOLVED_ARCH; do
    eval "val=\${$v:-}"; [ -n "$val" ] || { echo "FAIL: $v missing from tools-provenance.env"; exit 1; }
  done
  [ "$OC_MIRROR_RESOLVED_CHANNEL" != latest ] || { echo "FAIL: oc-mirror resolved from the global latest channel"; exit 1; }
  [ "$TOOLS_RESOLVED_ARCH" = "$want" ] || { echo "FAIL: tools resolved for $TOOLS_RESOLVED_ARCH on a $want host"; exit 1; }
  echo "tools OK as uid $(id -u): oc $OC_RESOLVED_VERSION, oc-mirror $OC_MIRROR_RESOLVED_VERSION ($OC_MIRROR_RESOLVED_CHANNEL, $TOOLS_RESOLVED_ARCH)"
'

echo "Starting the backend on 127.0.0.1:${HOST_PORT}..."
# The same container-network declaration as docker-compose.yml (published to loopback only).
$ENGINE run -d --name "$CONTAINER_NAME" -p "127.0.0.1:${HOST_PORT}:4000" \
  -e PORT=4000 -e DATA_DIR=/data -e BIND_ADDRESS=0.0.0.0 -e OAA_CONTAINER_NETWORK=isolated \
  -v "${DATA_DIR_HOST}:/data${SMOKE_VOLUME_OPTS:-}" "$IMAGE_NAME" >/dev/null
for i in $(seq 1 60); do
  curl -sf "http://127.0.0.1:${HOST_PORT}/api/health" >/dev/null 2>&1 && break
  [ "$i" -eq 60 ] && { echo "FAIL: /api/health did not answer within 60 s"; exit 1; }
  sleep 1
done
curl -sf "http://127.0.0.1:${HOST_PORT}/api/ready" | grep -q '"ready":true' || { echo "FAIL: /api/ready is not ready"; exit 1; }
echo "Backend container smoke test PASSED"
