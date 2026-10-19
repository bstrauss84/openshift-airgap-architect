#!/bin/bash
#
# Render frontend/container/nginx-oaa.conf.template into a real nginx server
# block. Called by oaa-entrypoint.sh at container start and by
# frontend/Containerfile at build time (so `nginx -t` validates the rendered
# shape, not the template).
#
# WHY THIS IS A SEPARATE FILE rather than more `sed` inside the entrypoint:
# the three things it decides — the listen address, the resolver and the
# fail-closed refusal — are the authentication-relevant ones, and they need a
# test that runs them for real. The entrypoint ends in
# `exec /usr/libexec/s2i/run`, which only exists inside the image, so it
# cannot be executed under `node --test`. This can, and
# scripts/validate-nginx-runtime-config.test.mjs does exactly that: renders
# with real fixtures and then binds real sockets to the directives produced.
#
# Pure bash on purpose. No awk, no sed, no envsubst — the substitution is
# parameter expansion over the template's lines, so the only dependency is the
# shell the entrypoint already requires.
#
# Usage:
#   oaa-render-nginx.sh <template> <output>
#
# Environment:
#   OAA_BACKEND_ORIGIN          absolute http(s) URL of the backend Service
#   OAA_PROXY_SHARED_SECRET     value attached to proxied /api requests
#   OAA_REQUIRE_PROXY_SECRET    set => authenticated topology; loopback enforced
#   OAA_NGINX_LISTEN_ADDRESS    127.0.0.1 (authenticated) | 0.0.0.0 (Compose)
#   OAA_NGINX_RESOLVER          explicit override; otherwise derived
#   OAA_RESOLV_CONF             resolv.conf to derive from (default /etc/resolv.conf)
#
# @author Bill Strauss
# Developed with AI assistance from Claude (Anthropic) and Cursor AI.

set -euo pipefail

TEMPLATE="${1:?usage: oaa-render-nginx.sh <template> <output>}"
OUTPUT="${2:?usage: oaa-render-nginx.sh <template> <output>}"

PORT=5173
BACKEND_ORIGIN="${OAA_BACKEND_ORIGIN:-http://airgap-architect-backend:4000}"
PROXY_SECRET="${OAA_PROXY_SHARED_SECRET:-}"
LISTEN_ADDRESS="${OAA_NGINX_LISTEN_ADDRESS:-0.0.0.0}"
RESOLV_CONF="${OAA_RESOLV_CONF:-/etc/resolv.conf}"

fatal() {
  echo "FATAL: $*" >&2
  exit 1
}

# --- the backend origin -----------------------------------------------------
case "$BACKEND_ORIGIN" in
  http://* | https://*) ;;
  *) fatal "OAA_BACKEND_ORIGIN must be an absolute http:// or https:// URL (got: ${BACKEND_ORIGIN})" ;;
esac
case "$BACKEND_ORIGIN" in
  *[\"\\\;]* | *$'\n'* | *' '*)
    fatal "OAA_BACKEND_ORIGIN contains characters that cannot appear in an nginx directive"
    ;;
esac

# --- the shared secret ------------------------------------------------------
# Never echoed, here or anywhere else in this script.
if [ -n "$PROXY_SECRET" ]; then
  case "$PROXY_SECRET" in
    *[\"\\\;]* | *$'\n'*)
      fatal "OAA_PROXY_SHARED_SECRET contains characters that cannot appear in an nginx header value"
      ;;
  esac
fi

# --- the listen address, and the refusal that makes it mean something -------
#
# Only two values are accepted. An arbitrary address here would be a way to
# write something unvalidated into the config, and there is no third topology:
# either the pod's oauth-proxy sidecar is the only client (loopback) or the
# container boundary is doing the work (Compose).
case "$LISTEN_ADDRESS" in
  localhost | 127.0.0.1) LISTEN_ADDRESS=127.0.0.1 ;;
  0.0.0.0 | all) LISTEN_ADDRESS=0.0.0.0 ;;
  *) fatal "OAA_NGINX_LISTEN_ADDRESS must be 127.0.0.1 or 0.0.0.0 (got: ${LISTEN_ADDRESS})" ;;
esac

# OAA_REQUIRE_PROXY_SECRET marks the authenticated topology: the deployment
# where oauth-proxy is in front and this server must not be reachable past it.
# Serving 5173 on the pod IP there is a complete authentication bypass — a
# forged X-Forwarded-User plus the shared secret this config attaches — so it
# is refused at start rather than left for a NetworkPolicy to catch.
if [ -n "${OAA_REQUIRE_PROXY_SECRET:-}" ] && [ "$LISTEN_ADDRESS" != "127.0.0.1" ]; then
  fatal "OAA_REQUIRE_PROXY_SECRET is set (authenticated deployment) but OAA_NGINX_LISTEN_ADDRESS is ${LISTEN_ADDRESS}.
       In that topology oauth-proxy reaches nginx over the pod's loopback (--upstream=http://localhost:5173).
       Listening on ${LISTEN_ADDRESS} would also serve any pod that can reach this pod's IP, and this config
       forwards the caller's X-Forwarded-User and attaches the backend shared secret — an unauthenticated
       caller would be proxied as an authenticated one. Set OAA_NGINX_LISTEN_ADDRESS=127.0.0.1."
fi

if [ "$LISTEN_ADDRESS" = "127.0.0.1" ]; then
  # Both families: oauth-proxy connects to the name `localhost`, which may
  # resolve to ::1 before 127.0.0.1.
  LISTEN_DIRECTIVES="    listen       127.0.0.1:${PORT};
    listen       [::1]:${PORT};"
else
  LISTEN_DIRECTIVES="    listen       0.0.0.0:${PORT};
    listen       [::]:${PORT};"
fi

# --- the resolver -----------------------------------------------------------
#
# Derived from this pod's own resolv.conf. The kubelet writes the cluster DNS
# service address there on every cluster (`dns-default` in openshift-dns on
# OpenShift, `kube-dns` in kube-system upstream), and the container engine
# writes a working one under Compose — so reading it is correct everywhere,
# while naming a service is correct on exactly one distribution.
derive_resolver() {
  local line key value servers=() s
  [ -r "$RESOLV_CONF" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in \#* | \;* | "") continue ;; esac
    # shellcheck disable=SC2086
    set -- $line
    key="${1:-}"
    value="${2:-}"
    [ "$key" = "nameserver" ] || continue
    [ -n "$value" ] || continue
    # nginx wants IPv6 nameservers in square brackets.
    case "$value" in
      *:*) value="[${value}]" ;;
    esac
    # Reject anything that is not an address: a resolver is not a hostname
    # here, and an unexpected token must not reach the config file.
    case "$value" in
      *[!0-9a-fA-F.:%\[\]]*) continue ;;
    esac
    for s in ${servers[@]+"${servers[@]}"}; do
      [ "$s" = "$value" ] && continue 2
    done
    servers+=("$value")
    # nginx queries name servers round-robin; three is plenty and keeps the
    # directive readable.
    [ "${#servers[@]}" -ge 3 ] && break
  done < "$RESOLV_CONF"
  [ "${#servers[@]}" -gt 0 ] || return 1
  echo "${servers[*]}"
}

if [ -n "${OAA_NGINX_RESOLVER:-}" ]; then
  RESOLVER="$OAA_NGINX_RESOLVER"
  RESOLVER_SOURCE="OAA_NGINX_RESOLVER"
else
  if ! RESOLVER="$(derive_resolver)"; then
    fatal "no usable 'nameserver' entry in ${RESOLV_CONF}, so the /api proxy would have no resolver.
       nginx re-resolves the backend Service name per request and cannot do that without one.
       Set OAA_NGINX_RESOLVER explicitly (an IP address, e.g. the cluster DNS service IP) if this
       container legitimately has no resolv.conf."
  fi
  RESOLVER_SOURCE="$RESOLV_CONF"
fi
case "$RESOLVER" in
  *[\"\\\;]* | *$'\n'*) fatal "resolver value contains characters that cannot appear in an nginx directive" ;;
esac
RESOLVER_DIRECTIVE="resolver                ${RESOLVER} valid=30s ipv6=off;"

# --- render -----------------------------------------------------------------
[ -r "$TEMPLATE" ] || fatal "template ${TEMPLATE} is not readable"

tmp="${OUTPUT}.tmp.$$"
: > "$tmp"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    *OAA_LISTEN_DIRECTIVES*)
      printf '%s\n' "$LISTEN_DIRECTIVES" >> "$tmp"
      continue
      ;;
    *OAA_RESOLVER_DIRECTIVE*)
      # Keep the template's indentation.
      printf '%s%s\n' "${line%%OAA_RESOLVER_DIRECTIVE*}" "$RESOLVER_DIRECTIVE" >> "$tmp"
      continue
      ;;
  esac
  line="${line//OAA_BACKEND_ORIGIN/$BACKEND_ORIGIN}"
  line="${line//OAA_PROXY_SHARED_SECRET/$PROXY_SECRET}"
  printf '%s\n' "$line" >> "$tmp"
done < "$TEMPLATE"

if grep -qE 'OAA_(LISTEN_DIRECTIVES|RESOLVER_DIRECTIVE|BACKEND_ORIGIN|PROXY_SHARED_SECRET)' "$tmp"; then
  rm -f "$tmp"
  fatal "rendered config still contains an unsubstituted placeholder; refusing to install it"
fi

mv "$tmp" "$OUTPUT"

# Deliberately reports the decisions, never the secret.
echo "OAA nginx config rendered: listen=${LISTEN_ADDRESS}:${PORT} resolver=${RESOLVER} (from ${RESOLVER_SOURCE}) backend=${BACKEND_ORIGIN} proxyAuth=$([ -n "$PROXY_SECRET" ] && echo configured || echo absent)"
