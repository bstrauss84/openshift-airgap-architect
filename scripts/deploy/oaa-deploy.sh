#!/usr/bin/env bash
# OpenShift Airgap Architect — staged deployment with Podman (v2.2.0).
#
# Replaces the one-liner `compose down && image prune && compose up --build`,
# which on enterprise hosts (RHEL 9, Podman 4.9, podman-compose 1.0.6, FIPS,
# HTTPS-inspecting proxies) failed in ways that hid the cause:
#   - podman-compose 1.0.6 ignores a failed `podman build` and then tries to run
#     localhost/...:latest images that were never built (and still exits 0);
#   - podman 4.9 accepts `build --retry` but ignores it, and `pull --retry`
#     does not exist, so a dropped CDN connection ("unexpected EOF") just fails;
#   - an inspecting proxy breaks curl/npm/dnf inside the build ("self-signed
#     certificate in certificate chain") unless its CA reaches the build;
#   - the old flow removed the running app before knowing the new build worked;
#   - `podman --cgroup-manager=cgroupfs compose up` does not reach the compose
#     provider's own `podman run` calls (Podman 4.9.4 cmd/podman/compose.go
#     passes the environment, not global flags): containers then fail with
#     `unable to start unit "libpod-….scope": Interactive authentication required`,
#     and podman-compose 1.0.6 still exits 0 and goes on to the next service.
#
# Stages (each can be run alone; nothing here prunes, resets or deletes volumes):
#   preflight    read-only host checks: podman mode, storage, the EFFECTIVE cgroup
#                manager (what nested podman calls inherit), XDG_RUNTIME_DIR and the
#                systemd user instance, network backend, FIPS, umask, proxy, CA,
#                ports, existing containers, reachability. Blocking problems
#                ([BLOCK]) stop build, smoke and up as well
#   images       read-only inventory of the UBI base images the builds need
#   pull         optional pre-pull of those images, bounded retries
#   build        build backend then frontend with `podman build`, exit codes
#                checked, bounded retries for transient failures only
#   smoke        one throwaway container from the built backend image with a
#                published loopback port: proves cgroup scope creation, rootless
#                networking and port forwarding before any application container
#   up           smoke, then start with compose using ONLY the images just built
#                (--no-build): backend first (must be running and answer HTTP),
#                then frontend (--no-deps). Refuses to replace existing project
#                containers unless --recreate (compose down of THIS project only)
#   verify       container state + HTTP checks (a container that is "Up" with
#                broken rootless port forwarding, or only "Created", fails here)
#   all          preflight (stops on any [BLOCK]), images, [pull], build, up
#   write-cgroupfs-override PATH   write a CONTAINERS_CONF_OVERRIDE file for the
#                documented temporary cgroupfs workaround (never applied for you)
#
# Configuration (environment):
#   OAA_BUILD_CA          PEM with your inspecting proxy's CA, given to the build as
#                         a secret (never a layer, never history). Must live OUTSIDE
#                         this repository.
#   OAA_BACKEND_IMAGE     default localhost/openshift-airgap-architect-backend:latest
#   OAA_FRONTEND_IMAGE    default localhost/openshift-airgap-architect-frontend:latest
#   OAA_COMPOSE_FILES     colon-separated compose files (default docker-compose.yml);
#                         the images they name must equal the two above
#   OAA_COMPOSE_PROJECT   compose project name (default: compose's own default)
#   OAA_BACKEND_URL       default http://127.0.0.1:4000/api/health
#   OAA_FRONTEND_URL      default http://127.0.0.1:5173/
#   OAA_RETRIES           attempts for transient failures (default 3, max 10)
#   OAA_RETRY_DELAY       seconds before the first retry, then doubled (default 10)
#   OAA_HEALTH_TIMEOUT    seconds to wait for HTTP health (default 120)
#   OAA_ALLOW_PREVIOUS_IMAGE=1  let `up` start images this script did not just build
#                         (refused by default after a failed build or a changed tag)
#   OAA_BACKEND_SERVICE / OAA_FRONTEND_SERVICE  compose service names (backend / frontend)
#   OAA_PODMAN / OAA_COMPOSE  override the podman / compose commands (no podman
#                         options in them: use CONTAINERS_CONF_OVERRIDE)
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PODMAN="${OAA_PODMAN:-podman}"
BACKEND_IMAGE="${OAA_BACKEND_IMAGE:-localhost/openshift-airgap-architect-backend:latest}"
FRONTEND_IMAGE="${OAA_FRONTEND_IMAGE:-localhost/openshift-airgap-architect-frontend:latest}"
COMPOSE_FILES="${OAA_COMPOSE_FILES:-docker-compose.yml}"
PROJECT="${OAA_COMPOSE_PROJECT:-}"
BACKEND_URL="${OAA_BACKEND_URL:-http://127.0.0.1:4000/api/health}"
FRONTEND_URL="${OAA_FRONTEND_URL:-http://127.0.0.1:5173/}"
RETRIES="${OAA_RETRIES:-3}"
RETRY_DELAY="${OAA_RETRY_DELAY:-10}"
HEALTH_TIMEOUT="${OAA_HEALTH_TIMEOUT:-120}"
BUILD_CA="${OAA_BUILD_CA:-}"
BACKEND_SERVICE="${OAA_BACKEND_SERVICE:-backend}"
FRONTEND_SERVICE="${OAA_FRONTEND_SERVICE:-frontend}"
BLOCKERS=0
STATE_DIR="${OAA_DEPLOY_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/oaa-deploy}"
LOG_DIR="${OAA_DEPLOY_LOG_DIR:-${TMPDIR:-/tmp}/oaa-deploy-$(id -u)}"
case "$RETRIES" in ''|*[!0-9]*) RETRIES=3 ;; esac
[ "$RETRIES" -lt 1 ] && RETRIES=1
[ "$RETRIES" -gt 10 ] && RETRIES=10

WARNINGS=0
say()  { printf '%s\n' "$*"; }
ok()   { printf '  [ok]   %s\n' "$*"; }
info() { printf '  [info] %s\n' "$*"; }
warn() { printf '  [WARN] %s\n' "$*"; WARNINGS=$((WARNINGS + 1)); }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
redact() { sed -E 's#(://)[^/@]*@#\1***@#g'; }

compose_cmd() {
  if [ -n "${OAA_COMPOSE:-}" ]; then printf '%s' "$OAA_COMPOSE"; return; fi
  if command -v podman-compose >/dev/null 2>&1; then printf 'podman-compose'; else printf '%s compose' "$PODMAN"; fi
}
compose() {
  local args=() f
  [ -n "$PROJECT" ] && args+=(-p "$PROJECT")
  local IFS=:
  for f in $COMPOSE_FILES; do args+=(-f "$f"); done
  unset IFS
  # shellcheck disable=SC2046
  (cd "$REPO_ROOT" && $(compose_cmd) "${args[@]}" "$@")
}

# ---------------------------------------------------------------------------
# Failure classification (shared by pull and build)
# ---------------------------------------------------------------------------
# Permanent classes are checked first: they must never be retried.
classify() { # <log file> [stage: build|runtime]
  # Specific, permanent causes first; never classify by exit code (125/126) alone.
  local f="$1" stage="${2:-build}"
  if grep -Eqi 'x509:|certificate signed by unknown authority|self[- ]signed certificate|certificate verify failed|SSL certificate problem|tls: failed to verify|FATAL: TLS verification failed' "$f"; then echo tls; return; fi
  if grep -Eqi '407 Proxy Authentication Required|Proxy Authentication Required|proxy needs credentials|\(curl 22\).*407' "$f"; then echo proxy-auth; return; fi
  if grep -Eqi 'fips[^"]{0,60}(not allowed|not permitted|disabled|not supported|unsupported)|(not allowed|not permitted|not supported|disabled)[^"]{0,40} in fips' "$f"; then echo fips; return; fi
  if grep -Eqi 'Failed to obtain podman configuration|cannot re-exec process|XDG_RUNTIME_DIR[^"]{0,60}(not set|invalid|not owned|permission)|no such file or directory[^"]{0,40}/run/user/' "$f"; then echo session; return; fi
  if grep -Eqi 'unable to start unit "runc-buildah' "$f"; then echo systemd-build; return; fi
  if grep -Eqi 'unable to start unit "libpod-' "$f"; then echo systemd-runtime; return; fi
  if grep -Eqi 'Interactive authentication required' "$f"; then [ "$stage" = runtime ] && echo systemd-runtime || echo systemd-build; return; fi
  if grep -Eqi 'address already in use' "$f"; then echo port-conflict; return; fi
  if grep -Eqi 'slirp4netns failed|pasta failed|failed to start rootlessport|rootlessport[^"]{0,40}(error|failed)|error setting up (pasta|slirp4netns)|setting up network for container[^"]{0,40}failed' "$f"; then echo rootless-network; return; fi
  if grep -Eqi 'lsetxattr|cannot relabel|relabel(ing)? failed|SELinux relabeling|EACCES: permission denied, (mkdir|open|scandir) .?/data' "$f"; then echo volume-permission; return; fi
  if grep -Eqi 'unauthorized|authentication required|401 Unauthorized|403 Forbidden|requested access to the resource is denied|invalid username/password|denied: ' "$f"; then echo auth; return; fi
  if grep -Eqi 'digest mismatch|Digest did not match|did not match the expected digest|computed digest|sha256sum: WARNING|checksum (mismatch|did not match)|: FAILED$' "$f"; then echo integrity; return; fi
  if grep -Eqi 'no image found in manifest list for architecture|does not match the specified platform|exec format error|FATAL: unsupported build architecture' "$f"; then echo arch; return; fi
  if grep -Eqi 'image not known|no such image|unable to find image|repository does not exist' "$f"; then echo image-missing; return; fi
  if grep -Eqi 'manifest unknown|name unknown|not found: manifest|reading manifest .* not found|404 Not Found' "$f"; then echo not-found; return; fi
  if grep -Eqi 'unexpected EOF|connection reset by peer|i/o timeout|TLS handshake timeout|net/http: request canceled|timeout awaiting|502 Bad Gateway|503 Service Unavailable|504 Gateway|429 Too Many Requests|server misbehaving|temporary failure in name resolution|no route to host|connection refused|could not connect for .*curl (6|7|28)|npm ERR! code (ECONNRESET|ETIMEDOUT|EAI_AGAIN)|Curl error \((6|7|28|56)\)' "$f"; then echo transient; return; fi
  echo unknown
}

# explain <class>: what happened, which layer is responsible, the next SAFE action.
explain() {
  case "$1" in
    tls) say "  -> TLS trust: a certificate could not be verified. Layer: customer network (inspecting proxy)."
         say "     Next: host pulls need the proxy CA in the host trust (update-ca-trust, or /etc/containers/certs.d/<registry>/ca.crt);"
         say "     curl/npm/dnf inside the build need it as OAA_BUILD_CA=<pem> (passed as a build secret). Not a credentials problem." ;;
    proxy-auth) say "  -> The proxy requires authentication (407). Layer: customer proxy. Next: put proxy credentials in HTTPS_PROXY. Not a registry credentials problem." ;;
    fips) say "  -> The system's FIPS cryptographic policy rejected an operation. Layer: customer crypto policy / certificate."
          say "     Next: check the algorithm named above (e.g. a proxy CA with SHA-1 or a small RSA key) and replace that certificate; do not disable FIPS." ;;
    session) say "  -> Rootless Podman has no valid user session (XDG_RUNTIME_DIR missing, not owned by you, or not reachable). Layer: customer login/session."
             say "     Next: log in as the deploying user directly (ssh or console — not su / sudo -i), or ask an administrator to enable lingering for that user." ;;
    systemd-build) say "  -> A build step could not create its systemd scope (runc-buildah-….scope: Interactive authentication required). Layer: customer session/systemd."
                   say "     Next: a real login session for this user; or, after administrator review, the verified temporary override ('$0 write-cgroupfs-override')." ;;
    systemd-runtime) say "  -> Container start could not create its systemd scope (libpod-….scope: Interactive authentication required). Layer: customer session/systemd."
                     say "     Building the images worked; starting containers needs the same session. A '--cgroup-manager' flag on 'podman compose' does NOT reach"
                     say "     the compose provider's own podman calls. Next: a real login session, or the verified override exported in this shell"
                     say "     (CONTAINERS_CONF_OVERRIDE, which child processes inherit); then '$0 up --recreate' to replace containers created under the old manager." ;;
    rootless-network) say "  -> Rootless networking (slirp4netns / pasta / rootlessport) failed. Layer: customer host networking, not OAA."
                      say "     Next: 'podman info' network fields, the host's slirp4netns/pasta packages, and the session checks." ;;
    port-conflict) say "  -> A published port is already in use on this host. Layer: host. Next: free the port or change the host port in an override file." ;;
    volume-permission) say "  -> A volume could not be labelled or accessed (SELinux or ownership). Layer: host storage. Next: add :Z to bind mounts you added, or fix the directory owner." ;;
    auth) say "  -> Registry credentials: refused (401/403). Layer: registry. registry.access.redhat.com needs none; check 'podman login' only if you changed registries." ;;
    integrity) say "  -> Integrity: content did not match its digest/checksum. Not retried. Re-run later; if it persists, an intermediary is altering content." ;;
    arch) say "  -> Architecture: no image or binary for $(uname -m). Not retried." ;;
    image-missing) say "  -> The image is not in this user's storage. Layer: deployment step. Next: '$0 build' as this same user (rootful and rootless stores are separate)." ;;
    not-found) say "  -> Not found: the image/tag/manifest does not exist (or a proxy blocks the path). Not retried." ;;
    transient) say "  -> Transient transport failure (dropped connection / truncated download). Layer: customer network/CDN path."
               say "     Image layers from registry.access.redhat.com and registry.redhat.io are served by Quay's CDN:"
               say "     allow cdn.quay.io and cdn01.quay.io … cdn06.quay.io (Red Hat article 7084334)." ;;
    app-exit) say "  -> The container started and its process exited. Layer: the application or its configuration (environment, volumes), not the container runtime."
              say "     Next: read the container log above; check DATA_DIR volume permissions and the environment set in your override file." ;;
    *) say "  -> Unclassified failure; see the log above. Collect '$0 preflight' output and the log for support." ;;
  esac
}

# run_with_retry <label> <cmd...>: bounded retries for transient failures only.
run_with_retry() {
  local label="$1"; shift
  mkdir -p "$LOG_DIR"
  local log attempt=1 delay="$RETRY_DELAY" rc class
  while :; do
    log="$LOG_DIR/$(printf '%s' "$label" | tr -c 'A-Za-z0-9_.-' '_')-attempt$attempt.log"
    say "==> $label (attempt $attempt of $RETRIES)"
    # Synchronous pipe (not process substitution): the log must be complete
    # before it is classified. Output still streams live.
    "$@" 2>&1 | tee "$log"
    rc=${PIPESTATUS[0]}
    if [ $rc -eq 0 ]; then return 0; fi
    class="$(classify "$log")"
    say "!! $label failed (exit $rc, class: $class). Log: $log"
    explain "$class"
    if [ "$class" != transient ] || [ "$attempt" -ge "$RETRIES" ]; then return $rc; fi
    say "   retrying in ${delay}s…"
    sleep "$delay"
    attempt=$((attempt + 1)); delay=$((delay * 2))
  done
}

# ---------------------------------------------------------------------------
# preflight (read-only)
# ---------------------------------------------------------------------------
pinfo() { "$PODMAN" info --format "$1" 2>/dev/null || echo "?"; }

http_probe() { # <url> <label>  — classifies reachability through the configured proxy
  local code rc
  code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 15 --max-time 30 "$1" 2>"$LOG_DIR/probe.err")"; rc=$?
  if [ $rc -eq 0 ]; then
    case "$code" in 407) warn "$2: proxy authentication required (407)";; *) ok "$2 reachable (HTTP $code)";; esac
  else
    case $rc in
      60|35|51|58|77) warn "$2: TLS verification failed (curl $rc) — the HOST does not trust the certificate presented (inspecting proxy CA missing from host trust?)" ;;
      5|6|7|28) warn "$2: not reachable (curl $rc) — check HTTPS_PROXY / NO_PROXY / firewall" ;;
      *) warn "$2: probe failed (curl $rc): $(head -c 200 "$LOG_DIR/probe.err")" ;;
    esac
  fi
}

port_in_use() { ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"; }
url_port() { printf '%s' "$1" | sed -E 's#^[a-z]+://[^/:]+:?([0-9]*)/?.*#\1#'; }

block() { printf '  [BLOCK] %s\n' "$*"; BLOCKERS=$((BLOCKERS + 1)); }

# The compose project this deployment owns — derived exactly as podman-compose
# 1.0.6 does (explicit -p, else COMPOSE_PROJECT_NAME, else the lower-cased
# directory name of the first compose file without [^-_a-z0-9]).
project_name() {
  if [ -n "$PROJECT" ]; then printf '%s' "$PROJECT"; return; fi
  if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then printf '%s' "$COMPOSE_PROJECT_NAME" | tr 'A-Z' 'a-z' | tr -cd -- '-_a-z0-9'; return; fi
  local first="${COMPOSE_FILES%%:*}"
  case "$first" in /*) ;; *) first="$REPO_ROOT/$first" ;; esac
  basename "$(dirname "$(readlink -f "$first")")" | tr 'A-Z' 'a-z' | tr -cd -- '-_a-z0-9'
}

# runtime_check: can THIS user's podman create and start containers from this
# shell — and will the compose provider's nested podman calls see the same
# configuration? Prints [BLOCK] lines; returns 1 if anything blocks.
#
# Facts behind it (Podman 4.9.4 cmd/podman/compose.go:252-256): `podman compose`
# runs the provider with os.Environ() plus DOCKER_HOST/DOCKER_BUILDKIT/
# DOCKER_CONFIG and only the arguments after `compose`. A global flag such as
# `podman --cgroup-manager=cgroupfs compose …` is consumed by the outer podman
# and never reaches the provider's own `podman run`. Environment variables —
# CONTAINERS_CONF_OVERRIDE included — do.
runtime_check() {
  local before=$BLOCKERS
  case "$PODMAN" in *[[:space:]]*) block "OAA_PODMAN='$PODMAN' carries options; options given to this podman do not reach the compose provider's podman calls. Use CONTAINERS_CONF_OVERRIDE (inherited by child processes) instead." ;; esac
  case "${OAA_COMPOSE:-}" in *--cgroup-manager*|*--root\ *|*--runroot*) block "OAA_COMPOSE='$OAA_COMPOSE' passes podman global options to the compose wrapper; they are not forwarded to the provider's nested podman calls. Use CONTAINERS_CONF_OVERRIDE." ;; esac
  if ! "$PODMAN" info --format '{{.Host.Arch}}' >/dev/null 2>"$LOG_DIR/podman-info.err"; then
    block "podman cannot start for this user: $(head -c 300 "$LOG_DIR/podman-info.err" 2>/dev/null | tr '\n' ' ')"
    explain session
    return 1
  fi
  local rootless cgm src
  rootless="$(pinfo '{{.Host.Security.Rootless}}')"; cgm="$(pinfo '{{.Host.CgroupManager}}')"
  if [ "$rootless" = true ]; then
    local x="${XDG_RUNTIME_DIR:-}"
    if [ -z "$x" ]; then block "XDG_RUNTIME_DIR is not set: no valid login session for rootless podman."; explain session
    elif [ ! -d "$x" ] || [ "$(stat -c %u "$x" 2>/dev/null)" != "$(id -u)" ] || [ ! -w "$x" ]; then
      block "XDG_RUNTIME_DIR=$x is missing, not owned by uid $(id -u), or not writable: not a valid session for this user."; explain session
    fi
  fi
  src="containers.conf defaults"; [ -n "${CONTAINERS_CONF_OVERRIDE:-}" ] && src="CONTAINERS_CONF_OVERRIDE=$CONTAINERS_CONF_OVERRIDE"
  if [ "$rootless" = true ] && [ "$cgm" = systemd ]; then
    if systemctl --user show-environment >/dev/null 2>&1; then
      ok "effective cgroup manager: systemd ($src); systemd user instance reachable"
    else
      block "effective cgroup manager is systemd ($src) but this user's systemd instance is not reachable: building may work, yet every container start fails with 'unable to start unit \"libpod-….scope\": Interactive authentication required'."
      explain systemd-runtime
    fi
  elif [ "$cgm" = cgroupfs ]; then
    ok "effective cgroup manager: cgroupfs ($src) — inherited by the compose provider's podman calls through the environment"
    info "cgroupfs is a temporary workaround for a missing session: rootless containers get no cgroup resource limits; containers keep the manager they were created with (use 'up --recreate' after switching)."
    if [ -n "${CONTAINERS_CONF_OVERRIDE:-}" ] && ! grep -Eq '^[[:space:]]*cgroup_manager[[:space:]]*=[[:space:]]*"cgroupfs"' "$CONTAINERS_CONF_OVERRIDE" 2>/dev/null; then
      info "cgroupfs comes from elsewhere than $CONTAINERS_CONF_OVERRIDE"
    fi
  else
    ok "effective cgroup manager: $cgm ($src)"
  fi
  [ "$BLOCKERS" = "$before" ]
}

require_runtime() { # <stage>
  mkdir -p "$LOG_DIR"
  runtime_check || die "the $1 stage cannot run in this session (see [BLOCK] above); nothing was changed"
}

cmd_preflight() {
  mkdir -p "$LOG_DIR"
  say "== Preflight (read-only) =="
  case "$PODMAN" in *[[:space:]]*) block "OAA_PODMAN='$PODMAN' carries options; options given to this podman do not reach the compose provider's podman calls. Use CONTAINERS_CONF_OVERRIDE (inherited by child processes) instead."; return 1 ;; esac
  command -v "$PODMAN" >/dev/null 2>&1 || die "podman not found"
  local pv; pv="$("$PODMAN" --version 2>&1 | head -1)"
  if ! "$PODMAN" info --format '{{.Host.Arch}}' >/dev/null 2>&1; then
    runtime_check
    say "Preflight stopped: nothing else can be checked until podman starts (${pv:-podman version unknown})."
    return 1
  fi
  ok "$pv"
  local cc; cc="$(compose_cmd)"
  if $cc version >/dev/null 2>&1 || $cc --version >/dev/null 2>&1; then ok "compose: $($cc --version 2>/dev/null | tail -1)"; else warn "compose command '$cc' not working"; fi
  local rootless cgm cgv graph runtime netb events
  rootless="$(pinfo '{{.Host.Security.Rootless}}')"; cgm="$(pinfo '{{.Host.CgroupManager}}')"; cgv="$(pinfo '{{.Host.CgroupsVersion}}')"
  graph="$(pinfo '{{.Store.GraphRoot}}')"; runtime="$(pinfo '{{.Host.OCIRuntime.Name}}')"; netb="$(pinfo '{{.Host.NetworkBackend}}')"; events="$(pinfo '{{.Host.EventLogger}}')"
  info "user $(id -un) (uid $(id -u)), rootless=$rootless, storage $graph"
  info "OCI runtime $runtime, cgroup manager $cgm (cgroups $cgv), network backend $netb, events $events"
  if [ "$(id -u)" = 0 ] && [ "$rootless" = false ]; then info "rootful podman: images built here are NOT visible to rootless users (separate stores)"; fi
  runtime_check
  if [ "$rootless" = true ]; then local linger; linger="$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || echo '?')"; info "loginctl Linger=$linger"; fi
  [ -n "${CONTAINERS_CONF:-}" ] && warn "CONTAINERS_CONF=$CONTAINERS_CONF REPLACES every containers.conf; prefer CONTAINERS_CONF_OVERRIDE (layered on top)"
  [ -n "${CONTAINERS_CONF_OVERRIDE:-}" ] && info "CONTAINERS_CONF_OVERRIDE=$CONTAINERS_CONF_OVERRIDE (layered override in effect)"
  local fips; fips="$(cat /proc/sys/crypto/fips_enabled 2>/dev/null || echo '?')"; info "FIPS mode: $([ "$fips" = 1 ] && echo enabled || echo "$fips")"
  local um; um="$(umask)"; info "umask $um"
  case "$um" in 0022|022|0002|002) ;; *) info "restrictive umask: the images normalise file modes; bind mounts you add may need ':U' or explicit modes" ;; esac
  if [ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]; then info "HTTPS_PROXY=$(printf '%s' "${HTTPS_PROXY:-${https_proxy:-}}" | redact)"; info "NO_PROXY=${NO_PROXY:-${no_proxy:-<unset>}}"; else info "no HTTPS_PROXY in this shell"; fi
  if [ -n "$BUILD_CA" ]; then
    check_build_ca && ok "build CA $BUILD_CA: $(openssl x509 -in "$BUILD_CA" -noout -subject -enddate 2>/dev/null | tr '\n' ' ')"
  else
    info "no OAA_BUILD_CA: builds trust only the UBI images' system CAs (fine without an inspecting proxy)"
  fi
  local p
  for p in "$(url_port "$BACKEND_URL")" "$(url_port "$FRONTEND_URL")"; do
    [ -n "$p" ] || continue
    if port_in_use "$p"; then info "port $p is in use (fine if it is this deployment; 'up' checks the containers)"; else ok "port $p free"; fi
  done
  if [ -n "$graph" ] && [ "$graph" != "?" ]; then info "free space for $graph: $(df -h --output=avail "$graph" 2>/dev/null | tail -1 | tr -d ' ')"; fi
  local existing; existing="$("$PODMAN" ps -a --format '{{.Names}} {{.Status}}' 2>/dev/null | grep -E 'airgap-architect' || true)"
  [ -n "$existing" ] && info "existing containers named *airgap-architect*:" && printf '%s\n' "$existing" | sed 's/^/           /'
  say "-- reachability (through this shell's proxy settings) --"
  http_probe "https://registry.access.redhat.com/v2/" "registry.access.redhat.com"
  http_probe "https://cdn01.quay.io/" "cdn01.quay.io (image layer CDN)"
  http_probe "https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/latest/release.txt" "mirror.openshift.com"
  http_probe "https://registry.npmjs.org/" "registry.npmjs.org"
  if [ "$BLOCKERS" -gt 0 ]; then say "Preflight finished with $BLOCKERS blocking problem(s) and $WARNINGS warning(s): fix the [BLOCK] items before building or starting."; return 1; fi
  say "Preflight finished with $WARNINGS warning(s)."
}

check_build_ca() {
  [ -f "$BUILD_CA" ] || die "OAA_BUILD_CA=$BUILD_CA does not exist"
  grep -q 'BEGIN CERTIFICATE' "$BUILD_CA" || die "OAA_BUILD_CA=$BUILD_CA holds no PEM certificate"
  grep -q 'PRIVATE KEY' "$BUILD_CA" && die "OAA_BUILD_CA=$BUILD_CA contains a PRIVATE KEY; give the CA certificate only"
  local real; real="$(readlink -f "$BUILD_CA")"
  case "$real" in "$REPO_ROOT"/*) die "OAA_BUILD_CA must live outside the repository ($REPO_ROOT) so it can never be committed or copied into an image";; esac
  return 0
}

# ---------------------------------------------------------------------------
# images / pull
# ---------------------------------------------------------------------------
base_images() {
  awk 'toupper($1)=="FROM"{for(i=2;i<=NF;i++){if($i ~ /^--/) continue; print $i; break}}' \
    "$REPO_ROOT/backend/Containerfile" "$REPO_ROOT/frontend/Containerfile" | grep '/' | sort -u
}
cmd_images() {
  say "== Required base images =="
  local img
  for img in $(base_images); do
    if "$PODMAN" image exists "$img" 2>/dev/null; then ok "$img present ($("$PODMAN" image inspect --format '{{.Digest}}' "$img" 2>/dev/null))"; else info "$img not present (build will pull it, or run '$0 pull')"; fi
  done
}
cmd_pull() {
  say "== Pre-pull base images (bounded retries) =="
  local img
  for img in $(base_images); do
    run_with_retry "pull $img" "$PODMAN" pull "$img" || die "could not pull $img"
  done
}

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
build_one() { # <backend|frontend>
  local role="$1" tag file
  case "$role" in
    backend) tag="$BACKEND_IMAGE"; file=backend/Containerfile ;;
    frontend) tag="$FRONTEND_IMAGE"; file=frontend/Containerfile ;;
    *) die "unknown image $role" ;;
  esac
  local args=(build -f "$file" -t "$tag")
  [ "$role" = backend ] && args+=(--build-arg "APP_GIT_SHA=${APP_GIT_SHA:-$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)}")
  if [ -n "$BUILD_CA" ]; then check_build_ca; args+=(--secret "id=oaa_build_ca,src=$BUILD_CA,type=file"); fi
  [ -n "${OAA_BUILD_EXTRA_ARGS:-}" ] && read -r -a extra <<< "$OAA_BUILD_EXTRA_ARGS" && args+=("${extra[@]}")
  if ! (cd "$REPO_ROOT" && run_with_retry "build $role" "$PODMAN" "${args[@]}" .); then
    record_build "$role" failed "-"
    die "the $role image did not build; nothing was started or replaced (a previous $tag, if any, will not be used by 'up')"
  fi
  "$PODMAN" image exists "$tag" || { record_build "$role" failed "-"; die "build reported success but $tag does not exist"; }
  local id; id="$("$PODMAN" image inspect --format '{{.Id}}' "$tag")"
  record_build "$role" built "$id"
  ok "$role image $tag ${id:0:19}"
}
# Build record per project: "<role> <built|failed> <image id> <epoch>". `up`
# uses it so a stale image is never started after a failed build, and so the
# tag it starts is the image this script built.
build_record_file() { printf '%s/%s.builds' "$STATE_DIR" "$(project_name)"; }
record_build() { # role status id
  mkdir -p "$STATE_DIR"; local f; f="$(build_record_file)"
  { grep -v "^$1 " "$f" 2>/dev/null; printf '%s %s %s %s\n' "$1" "$2" "$3" "$(date +%s)"; } > "$f.t" && mv "$f.t" "$f"
}
check_build_record() { # role tag
  local f line status id cur; f="$(build_record_file)"
  line="$(grep "^$1 " "$f" 2>/dev/null)"; status="$(printf '%s' "$line" | awk '{print $2}')"; id="$(printf '%s' "$line" | awk '{print $3}')"
  cur="$("$PODMAN" image inspect --format '{{.Id}}' "$2" 2>/dev/null)"
  if [ "${OAA_ALLOW_PREVIOUS_IMAGE:-}" = 1 ]; then [ -n "$line" ] || info "no build record for $1; OAA_ALLOW_PREVIOUS_IMAGE=1 — starting $2 as it is"; return 0; fi
  [ "$status" = failed ] && die "the last $1 build failed; $2 is an older image. Fix the build, or start the previous image deliberately with OAA_ALLOW_PREVIOUS_IMAGE=1."
  [ -z "$line" ] && die "no record of building $2 for project '$(project_name)' with this script. Run '$0 build', or start the existing image deliberately with OAA_ALLOW_PREVIOUS_IMAGE=1."
  [ "$cur" = "$id" ] || die "$2 now points at ${cur:0:19}, not the image this script built (${id:0:19}). Rebuild, or start it deliberately with OAA_ALLOW_PREVIOUS_IMAGE=1."
  ok "$1 image is the one built by this script (${id:0:19})"
}

cmd_build() {
  say "== Build =="
  require_runtime build
  case "${1:-all}" in
    backend|frontend) build_one "$1" ;;
    all) build_one backend; build_one frontend ;;
    *) die "build what? (backend|frontend)" ;;
  esac
}

# ---------------------------------------------------------------------------
# up / verify
# ---------------------------------------------------------------------------
compose_images() { compose config 2>/dev/null | awk '$1=="image:"{print $2}' | tr -d '"' | sort -u; }

# wait_http <url> <timeout-seconds>: 0 when the URL answers 200 (proxy bypassed).
wait_http() {
  local deadline=$(( $(date +%s) + $2 )) code
  while [ "$(date +%s)" -lt "$deadline" ]; do
    code="$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 5 "$1" 2>/dev/null)"
    [ "$code" = 200 ] && return 0
    sleep 2
  done
  LAST_HTTP_CODE="${code:-no answer}"
  return 1
}

free_port() { local p=18080; while port_in_use "$p" && [ "$p" -lt 18180 ]; do p=$((p + 1)); done; printf '%s' "$p"; }

# smoke: one throwaway container from the just-built backend image, started the
# way compose will start the real ones (same user, same environment, a
# published loopback port): proves systemd/cgroup scope creation, rootless
# networking and port forwarding work BEFORE any application container exists.
# Touches only the container it names; removes it on every path.
cmd_smoke() {
  say "== Container runtime smoke test =="
  require_runtime smoke
  "$PODMAN" image exists "$BACKEND_IMAGE" || die "$BACKEND_IMAGE does not exist; run '$0 build' first"
  local name="oaa-deploy-smoke-$$-$RANDOM" port; port="$(free_port)"
  local log="$LOG_DIR/smoke-$name.log"
  # shellcheck disable=SC2064
  trap "\"$PODMAN\" rm -f '$name' >/dev/null 2>&1" EXIT
  if ! "$PODMAN" run -d --name "$name" --label io.oaa.deploy-smoke=1 -p "127.0.0.1:$port:8080" --entrypoint node "$BACKEND_IMAGE" \
        -e "require('http').createServer((q,r)=>r.end('oaa-smoke')).listen(8080)" > "$log" 2>&1; then
    cat "$log"
    local class; class="$(classify "$log" runtime)"
    say "!! the runtime smoke container could not start (class: $class). No application container was created."
    explain "$class"
    "$PODMAN" rm -f "$name" >/dev/null 2>&1; trap - EXIT
    exit 1
  fi
  if ! wait_http "http://127.0.0.1:$port/" 30; then
    { "$PODMAN" inspect --format '{{.State.Status}} {{.State.Error}}' "$name"; "$PODMAN" logs --tail 20 "$name"; } >> "$log" 2>&1
    sed 's/^/   /' "$log"
    local class; class="$(classify "$log" runtime)"; [ "$class" = unknown ] && class=rootless-network
    say "!! the smoke container runs but its published port 127.0.0.1:$port does not answer (class: $class)."
    explain "$class"
    "$PODMAN" rm -f "$name" >/dev/null 2>&1; trap - EXIT
    exit 1
  fi
  "$PODMAN" rm -f "$name" >/dev/null 2>&1; trap - EXIT
  ok "a container started, served HTTP on a published loopback port, and was removed ($name)"
}

# service_state <service>: "<status>|<error>|<id>" of this project's container for that service.
service_state() {
  local proj; proj="$(project_name)"
  "$PODMAN" ps -a --filter "label=com.docker.compose.project=$proj" --filter "label=com.docker.compose.service=$1" \
    --format '{{.ID}}' 2>/dev/null | head -1 | while read -r id; do
      "$PODMAN" inspect --format "{{.State.Status}}|{{.State.Error}}|$id" "$id" 2>/dev/null
    done
}

# start_service <service> <url> [extra compose up args]: start it, require
# state "running" and an HTTP 200; on failure classify and stop the deployment.
start_service() {
  local svc="$1" url="$2"; shift 2
  local log="$LOG_DIR/up-$svc.log"
  say "--> starting $svc"
  compose up -d --no-build "$@" "$svc" > "$log" 2>&1
  local rc=$?
  local st; st="$(service_state "$svc")"
  local status="${st%%|*}"
  if [ "$status" != running ]; then
    cat "$log"
    local id="${st##*|}" err; err="$(printf '%s' "$st" | cut -d'|' -f2)"
    [ -n "$err" ] && printf '%s\n' "$err" >> "$log"
    [ -n "$id" ] && "$PODMAN" logs --tail 30 "$id" >> "$log" 2>&1
    local class; class="$(classify "$log" runtime)"
    # The runtime started it and the process exited: that is the application (or its configuration), not the host.
    [ "$class" = unknown ] && [ "$status" = exited ] && class=app-exit
    say "!! $svc is ${status:-not created} (compose exit $rc — podman-compose reports success even when the container did not start; class: $class)."
    explain "$class"
    say "   The deployment stopped here; nothing after $svc was started. Inspect: $log"
    say "   To retry after fixing the cause: '$0 up --recreate' (replaces only containers of compose project '$(project_name)'; volumes kept)."
    exit 1
  fi
  if ! wait_http "$url" "$HEALTH_TIMEOUT"; then
    say "!! $svc is running but $url did not answer 200 within ${HEALTH_TIMEOUT}s (last: $LAST_HTTP_CODE)."
    say "   'Up' is not ready: application or port forwarding problem. Last log lines:"
    "$PODMAN" logs --tail 30 "${st##*|}" 2>&1 | sed 's/^/   /'
    exit 1
  fi
  ok "$svc running and $url answers 200"
}

cmd_up() {
  say "== Start (compose, no rebuild, backend first) =="
  require_runtime up
  local recreate=0; [ "${1:-}" = "--recreate" ] && recreate=1
  local img
  for img in "$BACKEND_IMAGE" "$FRONTEND_IMAGE"; do
    "$PODMAN" image exists "$img" || die "$img does not exist; run '$0 build' first (compose would otherwise run an image that was never built)"
  done
  check_build_record backend "$BACKEND_IMAGE"
  check_build_record frontend "$FRONTEND_IMAGE"
  local cfg; cfg="$(compose config 2>/dev/null)"
  local named; named="$(printf '%s\n' "$cfg" | awk '$1=="image:"{print $2}' | tr -d '"' | sort -u)"
  if [ -n "$named" ]; then
    for img in $named; do
      case "$img" in "$BACKEND_IMAGE"|"$FRONTEND_IMAGE") ;; *) die "the compose files name image $img, which this script did not build (set OAA_BACKEND_IMAGE / OAA_FRONTEND_IMAGE or OAA_COMPOSE_FILES)";; esac
    done
  else
    warn "could not read the images from 'compose config'; continuing with the built tags"
  fi
  if printf '%s\n' "$cfg" | grep -Eq '^[[:space:]]*-[[:space:]]*"?([0-9]+:){1,2}[0-9]+"?[[:space:]]*$'; then
    warn "a published port in the compose files is not bound to 127.0.0.1; the application is then reachable from the network"
  fi
  info "compose project: $(project_name)"
  local existing; existing="$(compose ps -q 2>/dev/null | grep -c . || true)"
  if [ "${existing:-0}" != 0 ]; then
    [ $recreate = 1 ] || die "compose project '$(project_name)' already has containers (any state); re-run with 'up --recreate' to replace them (the backend-data volume is kept)"
    say "   replacing the containers of compose project '$(project_name)' only (volumes kept; nothing is pruned)"
    compose down || die "compose down failed"
  fi
  cmd_smoke
  start_service "$BACKEND_SERVICE" "$BACKEND_URL"
  start_service "$FRONTEND_SERVICE" "$FRONTEND_URL" --no-deps
  say "Deployment started and verified."
}

cmd_verify() {
  say "== Verify (state + HTTP) =="
  local svc url st bad=0
  for pair in "$BACKEND_SERVICE|$BACKEND_URL" "$FRONTEND_SERVICE|$FRONTEND_URL"; do
    svc="${pair%%|*}"; url="${pair#*|}"
    st="$(service_state "$svc")"
    local status="${st%%|*}"
    if [ "$status" != running ]; then say "!! $svc is ${status:-absent}, not running."; bad=1; continue; fi
    if wait_http "$url" "$HEALTH_TIMEOUT"; then ok "$url -> 200"; else
      say "!! $url did not answer 200 within ${HEALTH_TIMEOUT}s (last: $LAST_HTTP_CODE). 'Up' is not ready; rootless port forwarding or the application failed."
      "$PODMAN" logs --tail 30 "${st##*|}" 2>&1 | sed 's/^/   /'; bad=1
    fi
  done
  [ $bad = 0 ] || return 1
  say "Deployment verified."
}

cmd_write_override() {
  local path="${1:-}"; [ -n "$path" ] || die "usage: $0 write-cgroupfs-override <file>"
  [ -e "$path" ] && die "$path exists; not overwriting"
  cat > "$path" <<'EOF'
# OpenShift Airgap Architect — TEMPORARY workaround for rootless Podman without a
# systemd user session ("Interactive authentication required" during build).
# Layered on top of every containers.conf when exported for one shell:
#   export CONTAINERS_CONF_OVERRIDE=<this file>
# Remove it once the user has a proper login session (or lingering) again.
# cgroupfs cannot apply cgroup resource limits to rootless containers.
[engine]
cgroup_manager = "cgroupfs"
events_logger = "file"
EOF
  say "Wrote $path. To use it for this shell only:  export CONTAINERS_CONF_OVERRIDE=$path"
  say "It is not applied for you, and it does not change any system or user configuration file."
}

usage() { sed -n '2,/^set -u/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    preflight) cmd_preflight ;;
    images) cmd_images ;;
    pull) cmd_pull ;;
    build) cmd_build "${1:-all}" ;;
    smoke) cmd_smoke ;;
    up) cmd_up "${1:-}" ;;
    verify) cmd_verify ;;
    all)
      local pull=0 recreate=""
      for a in "$@"; do case "$a" in --pull) pull=1 ;; --recreate) recreate=--recreate ;; *) die "unknown option $a" ;; esac; done
      cmd_preflight || die "preflight found blocking problems; nothing was built or started"
      cmd_images
      [ $pull = 1 ] && cmd_pull
      cmd_build all; cmd_up "$recreate" ;;
    write-cgroupfs-override) cmd_write_override "${1:-}" ;;
    -h|--help|help|"") usage ;;
    *) die "unknown command $cmd (try --help)" ;;
  esac
}
main "$@"
