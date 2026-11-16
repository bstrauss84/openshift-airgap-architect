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
#
# A ROOT-RELATIVE PATH IS NOW VALID, and is the supported production shape.
# "/api" means "this page's own origin", which is what the OpenShift topology
# needs: nginx in this container proxies /api to the backend Service, and
# oauth-proxy authenticates the single Route in front of it. The session is a
# cookie, so a cross-origin absolute URL would simply not carry it.
#
# "//host/path" is rejected with the other malformed shapes: it is
# protocol-relative, so it points at a DIFFERENT origin while looking
# relative — the one spelling that silently breaks the same-origin property
# this check exists to permit.
case "$API_BASE" in
  "//"*)
    echo "FATAL: VITE_API_BASE must not be protocol-relative (got: ${API_BASE}); use /api for same-origin or an absolute URL" >&2
    exit 1
    ;;
  "" | /* | http://* | https://*) ;;
  *)
    echo "FATAL: VITE_API_BASE must be empty, a root-relative path such as /api, or an absolute http:// or https:// URL (got: ${API_BASE})" >&2
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

# ---------------------------------------------------------------------------
# Render the nginx server block, including the same-origin /api proxy.
#
# The template ships outside nginx.d precisely so an unrendered placeholder can
# never be loaded; this writes the real config into the included directory.
#
# The rendering itself lives in oaa-render-nginx.sh so it can be executed by a
# test: it decides the listen address (the authentication boundary in the
# OpenShift topology) and the DNS resolver, and both were previously wrong in
# ways no test could reach from here. This script ends in `exec
# /usr/libexec/s2i/run`, which exists only inside the image.
# ---------------------------------------------------------------------------
NGINX_TEMPLATE=/opt/app-root/etc/oaa-nginx.conf.template
NGINX_CONF=/opt/app-root/etc/nginx.d/oaa.conf
NGINX_RENDER=/opt/app-root/bin/oaa-render-nginx.sh

PROXY_SECRET="${OAA_PROXY_SHARED_SECRET:-}"

# A same-origin deployment that forwards identity but no shared secret would
# be refused by the backend on every request, presenting as a blanket 401 with
# no obvious cause. Catch it here, where the message can say why.
if [ -n "${OAA_REQUIRE_PROXY_SECRET:-}" ] && [ -z "$PROXY_SECRET" ]; then
  echo "FATAL: OAA_REQUIRE_PROXY_SECRET is set but OAA_PROXY_SHARED_SECRET is empty." >&2
  echo "       The backend runs with OAA_AUTH_MODE=proxy and will reject every request without it." >&2
  exit 1
fi

if [ -r "$NGINX_TEMPLATE" ]; then
  # Fails closed: a bad backend origin, an unacceptable listen address, a
  # non-loopback listen address in the authenticated topology, or a resolv.conf
  # with nothing usable in it all stop the container here with a reason,
  # instead of starting an nginx that is wrong in a way only a cluster shows.
  "$NGINX_RENDER" "$NGINX_TEMPLATE" "$NGINX_CONF"
else
  echo "WARNING: ${NGINX_TEMPLATE} is not readable; using the config baked at build time" >&2
fi

echo "OAA frontend: serving static build on :5173 (apiBase=${API_BASE:-<same origin>}, probe listener on :8081/healthz)"

exec /usr/libexec/s2i/run
