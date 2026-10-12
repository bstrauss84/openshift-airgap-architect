#!/bin/bash
#
# Writes deployment-time configuration, then hands off to the UBI nginx image's
# own run script.
#
# WHY NOT just exec nginx: /usr/libexec/s2i/run sources
# `generate_container_user` (OpenShift arbitrary-UID support) and wires the
# access and error logs to stdout/stderr. Re-implementing those here would
# quietly drop both.
#
# WHY A FILE instead of baking the value: `import.meta.env.VITE_API_BASE` is
# substituted when `vite build` runs, so a production bundle cannot read the
# container's environment. docker-compose.yml and the frontend Deployment both
# supply VITE_API_BASE at RUN time; writing it here keeps that working.
set -euo pipefail

RUNTIME_DIR=/tmp/oaa-runtime
mkdir -p "$RUNTIME_DIR"

API_BASE="${VITE_API_BASE:-}"

# Fail closed on a malformed endpoint rather than emitting a broken bundle
# config that would surface later as unexplained API failures in the browser.
case "$API_BASE" in
  "" | http://* | https://*) ;;
  *)
    echo "FATAL: VITE_API_BASE must be an absolute http:// or https:// URL (got: ${API_BASE})" >&2
    exit 1
    ;;
esac

# Reject characters that could break out of the JSON string literal below.
case "$API_BASE" in
  *[\"\\]* | *$'\n'*)
    echo "FATAL: VITE_API_BASE contains characters that are not valid in a URL" >&2
    exit 1
    ;;
esac

cat > "$RUNTIME_DIR/runtime-config.js" <<CONFIG
// Generated at container start by frontend/container/oaa-entrypoint.sh.
// Empty apiBase means "fall back to the build-time default" — see src/api.js.
window.__OAA_RUNTIME_CONFIG__ = { "apiBase": "${API_BASE}" };
CONFIG

echo "OAA frontend: serving static build on :5173 (apiBase=${API_BASE:-<build-time default>})"

exec /usr/libexec/s2i/run
