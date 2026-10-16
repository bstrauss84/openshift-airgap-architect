#!/usr/bin/env bash
#
# Startup-identity matrix for backend/scripts/entrypoint.sh.
#
# WHY THIS EXISTS. The shipped OpenShift manifests could never start either
# image. manifests/base/backend-deployment.yaml sets runAsNonRoot: true with
# runAsUser: 1001 and capabilities drop ALL, while entrypoint.sh called
# `runuser` unconditionally — and runuser refuses outright for a non-root
# caller. Nothing caught it because the backend and frontend suites never
# start a container, and the Compose path (which starts as root) works fine.
# This harness exercises the identities the PLATFORM chooses, which is the
# only place that difference shows up.
#
# It overlays the entrypoint onto an existing image rather than rebuilding, so
# a result is attributable to the entrypoint and nothing else, and so the
# control run can use the committed version for comparison.
#
# Usage:  identity-matrix.sh <image-ref> [control-entrypoint]
#   e.g.  identity-matrix.sh localhost/openshift-airgap-architect-backend:latest
#         identity-matrix.sh localhost/oaa-backend:unitc-verify \
#                            <(git show HEAD:backend/scripts/entrypoint.sh)
#
# Requires podman. Runs offline. Creates and removes only its own containers
# and its own scratch directories under /tmp.
set -u

IMG="${1:?usage: identity-matrix.sh <image-ref> [control-entrypoint]}"
CONTROL="${2:-}"

HERE="$(cd "$(dirname "$0")" && pwd)"
EP="$HERE/../../scripts/entrypoint.sh"
[ -f "$EP" ] || { echo "cannot find entrypoint at $EP" >&2; exit 2; }

SCRATCH="$(mktemp -d /tmp/oaa-identity-XXXXXX)"
EP_COPY="$SCRATCH/entrypoint.sh"
cp "$EP" "$EP_COPY"; chmod 755 "$EP_COPY"

DATA="$SCRATCH/data"
RO="$SCRATCH/data-ro"
mkdir -p "$RO"; chmod 555 "$RO"

FAILURES=0

cleanup() {
  # Files written inside the container belong to subuid-mapped owners that the
  # host user cannot unlink directly; unshare into the mapping to remove them.
  podman unshare rm -rf "$SCRATCH" 2>/dev/null || rm -rf "$SCRATCH" 2>/dev/null
}
trap cleanup EXIT

ready() { # container name -> poll the app's own health endpoint
  for _ in $(seq 1 40); do
    if podman exec "$1" node -e \
      'fetch("http://127.0.0.1:4000/api/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
      2>/dev/null; then return 0; fi
    sleep 0.5
  done
  return 1
}

run_case() { # label, entrypoint, expect(start|fail), podman args...
  local label="$1" ep="$2" expect="$3"; shift 3
  local cname="oaa-identity-$$-$RANDOM"

  # A pristine volume per case. Sharing one conflates "this identity cannot
  # start" with "this identity cannot write the previous identity's files" —
  # different defects, different owners. The second is what fsGroup is for.
  podman unshare rm -rf "$DATA" 2>/dev/null || true
  mkdir -p "$DATA"; chmod 777 "$DATA"

  if ! podman run -d --name "$cname" \
        -v "$ep":/app/entrypoint.sh:ro,Z "$@" "$IMG" >/dev/null 2>&1; then
    printf '  %-44s %-5s FAIL  (container could not be created)\n' "$label" "-"
    FAILURES=$((FAILURES + 1)); return
  fi

  local got; if ready "$cname"; then got=start; else got=fail; fi
  local why; why="$(podman logs "$cname" 2>&1 \
    | grep -iE '^FATAL|runuser|not writable|does not exist' | head -1)"
  podman rm -f "$cname" >/dev/null 2>&1

  if [ "$got" = "$expect" ]; then
    printf '  %-44s %-5s PASS  %s\n' "$label" "$got" "$why"
  else
    printf '  %-44s %-5s FAIL  (expected %s) %s\n' "$label" "$got" "$expect" "$why"
    FAILURES=$((FAILURES + 1))
  fi
}

NONROOT="--cap-drop ALL --security-opt no-new-privileges"

echo "image: $IMG"
echo
echo "current entrypoint:"
#                                                      expect
run_case "root (Compose/podman-compose path)"   "$EP_COPY" start \
         -e DATA_DIR=/data -v "$DATA":/data:Z
run_case "non-root 1001 (manifests/base)"       "$EP_COPY" start \
         --user 1001 $NONROOT -e DATA_DIR=/data -v "$DATA":/data:Z
run_case "arbitrary UID 12345:0 (OpenShift SCC)" "$EP_COPY" start \
         --user 12345:0 $NONROOT -e DATA_DIR=/data -v "$DATA":/data:Z
run_case "non-root, DATA_DIR not writable"      "$EP_COPY" fail \
         --user 1001 $NONROOT -e DATA_DIR=/data -v "$RO":/data:Z
run_case "non-root, DATA_DIR missing"           "$EP_COPY" fail \
         --user 1001 $NONROOT -e DATA_DIR=/nonexistent

if [ -n "$CONTROL" ] && [ -r "$CONTROL" ]; then
  CTL="$SCRATCH/control.sh"; cp "$CONTROL" "$CTL"; chmod 755 "$CTL"
  echo
  echo "control entrypoint (expected to fail the non-root cases):"
  run_case "root (Compose/podman-compose path)"   "$CTL" start \
           -e DATA_DIR=/data -v "$DATA":/data:Z
  run_case "non-root 1001 (manifests/base)"       "$CTL" fail \
           --user 1001 $NONROOT -e DATA_DIR=/data -v "$DATA":/data:Z
  run_case "arbitrary UID 12345:0 (OpenShift SCC)" "$CTL" fail \
           --user 12345:0 $NONROOT -e DATA_DIR=/data -v "$DATA":/data:Z
fi

echo
if [ "$FAILURES" -eq 0 ]; then echo "ALL PASS"; else echo "$FAILURES FAILED"; fi
exit $([ "$FAILURES" -eq 0 ] && echo 0 || echo 1)
