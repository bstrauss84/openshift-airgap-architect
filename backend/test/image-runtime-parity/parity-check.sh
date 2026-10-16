#!/usr/bin/env bash
# Runtime parity harness for the backend container image (Tranche 8D).
#
# A smaller scan report is NOT evidence that an image still works. This script
# exercises the behaviours that the single-stage -> builder/minimal split could
# plausibly have broken, and is meant to be run against BOTH the pre-change and
# post-change images so the output can be diffed:
#
#   backend/test/image-runtime-parity/parity-check.sh <image-ref> <outdir>
#
# Exit status is non-zero if any check fails. Every check prints a line of the
# form "RESULT <name> PASS|FAIL <detail>" so two runs can be diffed directly.
#
# Checks, and what each would catch:
#   bin-oc / bin-oc-mirror  vendored Go binaries did not survive the COPY, or
#                           lost the exec bit, or now miss a shared library
#                           (the minimal runtime has fewer .so files).
#   sqlite-load             better-sqlite3's compiled .node was built against a
#                           different Node ABI or a libstdc++ the runtime lacks.
#   boot-build-info         the server actually starts and serves HTTP.
#   boot-db                 the app opened/migrated its SQLite database at boot.
#   uid-drop                entrypoint.sh's root -> UID 1001 handoff still works.
#                           This needs /sbin/runuser, which lives in util-linux
#                           (NOT util-linux-core) -- the single most likely way
#                           to break this image while "hardening" it.
#   datadir-perms           DATA_DIR is chowned/chmodded so UID 1001 can write.
#   ssh-keygen              POST /api/ssh/keypair for all three supported
#                           algorithms. openssh-clients is installed for this
#                           endpoint and NOTHING ELSE, so dropping the package
#                           is invisible until a user asks for a key. Also
#                           asserts no private key survives in DATA_DIR/tmp.
#   disk-space              POST /api/system/path-check. The only consumer of
#                           coreutils `df`; index.js spawns it by name and the
#                           minimal base supplies coreutils-single, not
#                           coreutils, so this is worth proving rather than
#                           assuming.
#   installer-toolchain     The openshift-install download path (installer.js,
#                           openshiftInstaller.js) runs curl -> tar -xzf ->
#                           chmod +x into DATA_DIR/tools as the app uid. Proven
#                           offline with a locally built tarball: `tar -z`
#                           forks gzip, which is a separate package from tar.
#   engine-absent           The high-side runtime-package export calls
#                           `podman save`/`docker save`; neither engine is in
#                           the image, by design. The required behaviour is a
#                           documented degradation note inside the bundle, not
#                           a 500 and not a silently empty artifact.
#   no-proxy                HTTP_PROXY/NO_PROXY routing via undici's
#                           EnvHttpProxyAgent. Discriminating and offline: the
#                           proxy host is unresolvable, so a NO_PROXY'd origin
#                           must fail ECONNREFUSED (went direct) while a
#                           non-NO_PROXY origin must fail ENOTFOUND (went via
#                           the proxy). Asserting only "undici is present"
#                           cannot tell those two apart.
#   bindmount-selinux       A `:Z`-relabelled host bind mount as DATA_DIR,
#                           booted through the real entrypoint. Covers the
#                           compose.override.yml case documented in
#                           docker-compose.yml (external storage for oc-mirror
#                           archives); named volumes do not exercise the
#                           relabel or the host-side chown fallback.
#   sigterm                 SIGTERM reaches node (pid 1 is a shell, so this only
#                           works because entrypoint.sh uses exec) and the
#                           container exits 143 promptly.
#   arbitrary-uid           OpenShift assigns a random UID with gid 0; the image
#                           must tolerate it.
set -u

IMAGE="${1:?usage: parity-check.sh <image-ref> <outdir>}"
OUT="${2:?usage: parity-check.sh <image-ref> <outdir>}"
mkdir -p "$OUT"
FAILED=0
CID_PREFIX="oaa-parity-$$"

result() { # name status detail
  printf 'RESULT %-18s %-4s %s\n' "$1" "$2" "$3"
  [ "$2" = PASS ] || FAILED=1
}

cleanup() {
  podman rm -f "${CID_PREFIX}-run" "${CID_PREFIX}-uid" "${CID_PREFIX}-bind" >/dev/null 2>&1 || true
  podman volume rm -f "${CID_PREFIX}-data" >/dev/null 2>&1 || true
  # The bind-mount probe directory is written by a subuid-mapped container
  # process, so the host user may not be able to unlink its contents directly.
  # Hand the removal back to a container that owns the mapping.
  if [ -n "${BIND_HOST_DIR:-}" ] && [ -d "${BIND_HOST_DIR}" ]; then
    podman unshare rm -rf "${BIND_HOST_DIR}" >/dev/null 2>&1 \
      || rm -rf "${BIND_HOST_DIR}" >/dev/null 2>&1 || true
  fi
}
BIND_HOST_DIR=""
trap cleanup EXIT

echo "=== parity: $IMAGE ==="
podman image inspect "$IMAGE" --format 'IMAGE_ID {{.Id}}' | tee "$OUT/image-id.txt"
podman image inspect "$IMAGE" --format 'SIZE {{.Size}}'

# --- static checks ---------------------------------------------------------
for b in oc oc-mirror; do
  if podman run --rm --entrypoint /usr/local/bin/"$b" "$IMAGE" version --client 2>&1 \
       | tee "$OUT/$b-version.txt" | grep -qiE 'version|Client'; then
    result "bin-$b" PASS "$(head -1 "$OUT/$b-version.txt" | tr -d '\r')"
  else
    # oc-mirror needs --v2 and prints its version differently
    if podman run --rm --entrypoint /usr/local/bin/"$b" "$IMAGE" --v2 version 2>&1 \
         | tee "$OUT/$b-version.txt" | grep -qiE 'version'; then
      result "bin-$b" PASS "$(head -2 "$OUT/$b-version.txt" | tr '\n' ' ')"
    else
      result "bin-$b" FAIL "could not get version; see $OUT/$b-version.txt"
    fi
  fi
done

# better-sqlite3 loads and can execute SQL against a real on-disk DB.
podman run --rm --entrypoint node "$IMAGE" \
  /app/test-image-parity/sqlite-probe.cjs > "$OUT/sqlite-probe.txt" 2>&1
# The probe file is not in the image; fall back to -e form.
if ! grep -q 'SQLITE_OK' "$OUT/sqlite-probe.txt" 2>/dev/null; then
  podman run --rm --workdir /app --entrypoint node "$IMAGE" -e \
    'const D=require("better-sqlite3");const d=new D("/tmp/p.db");d.exec("create table t(a)");d.prepare("insert into t values (?)").run(42);console.log("SQLITE_OK",d.prepare("select a from t").get().a,process.version,process.versions.modules);' \
    > "$OUT/sqlite-probe.txt" 2>&1
fi
if grep -q 'SQLITE_OK 42' "$OUT/sqlite-probe.txt"; then
  result sqlite-load PASS "$(grep SQLITE_OK "$OUT/sqlite-probe.txt")"
else
  result sqlite-load FAIL "see $OUT/sqlite-probe.txt"
fi

# --- live container --------------------------------------------------------
podman volume create "${CID_PREFIX}-data" >/dev/null
podman run -d --name "${CID_PREFIX}-run" \
  -e PORT=4000 -e DATA_DIR=/data -e MOCK_MODE=true \
  -v "${CID_PREFIX}-data":/data \
  -p 127.0.0.1:14400:4000 "$IMAGE" >/dev/null 2>"$OUT/run-err.txt"

ok=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1:14400/api/build-info -o "$OUT/build-info.json" 2>/dev/null; then
    ok=1; break
  fi
  sleep 1
done
podman logs "${CID_PREFIX}-run" > "$OUT/container.log" 2>&1

if [ "$ok" = 1 ]; then
  result boot-build-info PASS "$(tr -d '\n' < "$OUT/build-info.json" | cut -c1-160)"
else
  result boot-build-info FAIL "no HTTP 200 from /api/build-info in 60s; see $OUT/container.log"
fi

# DB file actually created/migrated under DATA_DIR by the running app.
podman exec "${CID_PREFIX}-run" ls -l /data > "$OUT/datadir-listing.txt" 2>&1
if grep -qE '\.db|\.sqlite' "$OUT/datadir-listing.txt"; then
  result boot-db PASS "$(grep -E '\.db|\.sqlite' "$OUT/datadir-listing.txt" | head -1)"
else
  result boot-db FAIL "no sqlite file in DATA_DIR; see $OUT/datadir-listing.txt"
fi

# The node process must be running as UID 1001, not root.
podman exec "${CID_PREFIX}-run" ps -o pid,user,uid,args -e > "$OUT/ps.txt" 2>&1 \
  || podman exec "${CID_PREFIX}-run" cat /proc/1/status > "$OUT/ps.txt" 2>&1
# Match on /proc/<pid>/comm, NOT on cmdline: the `podman exec sh -c ...` probe
# process has the search strings in its OWN cmdline and would self-match (it
# did, reporting "pid 1 uid 0" and a spurious FAIL). comm of the probe is "sh".
NODE_UID=$(podman exec "${CID_PREFIX}-run" sh -c \
  'for p in /proc/[0-9]*; do [ "$(cat $p/comm 2>/dev/null)" = node ] || continue; echo "$(basename $p) $(grep ^Uid: $p/status | cut -f2)"; done' 2>/dev/null | head -1)
echo "node pid/uid: $NODE_UID" >> "$OUT/ps.txt"
if [ "${NODE_UID##* }" = "1001" ]; then
  result uid-drop PASS "node pid/uid = $NODE_UID (root dropped to 1001 via runuser)"
else
  result uid-drop FAIL "node not running as uid 1001 (got '$NODE_UID'); see $OUT/ps.txt"
fi

# DATA_DIR must be writable by the app's uid.
if podman exec --user 1001 "${CID_PREFIX}-run" touch /data/.parity-write 2>>"$OUT/datadir-listing.txt"; then
  result datadir-perms PASS "uid 1001 can write DATA_DIR"
else
  result datadir-perms FAIL "uid 1001 cannot write DATA_DIR; see $OUT/datadir-listing.txt"
fi

# --- canonical data integrity ----------------------------------------------
# index.js refuses to start when the canonical data root is missing, so a boot
# alone is weak evidence. Drive the generator, which READS canonical data: a
# mispackaged image surfaces as "No architecture-support matrix is available"
# inside a user's YAML preview rather than as a startup failure. Asserted
# against that exact documented string, not merely against HTTP 200.
cat > "$OUT/export-state.json" <<'JSON'
{"state":{"_schemaVersion":3,
"version":{"_schemaVersion":3,"selectedMinor":"4.22","selectedPatch":"4.22.16","selectedChannel":"stable-4.22","selectedVersion":"4.22.16","locked":true},
"release":{"channel":"4.22","patchVersion":"4.22.16","confirmed":true},
"blueprint":{"platform":"Bare Metal","arch":"x86_64","clusterName":"parity","baseDomain":"example.com","confirmed":true},
"methodology":{"method":"Agent-Based Installer"},
"credentials":{"sshPublicKey":"ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB parity@test"},
"globalStrategy":{"fips":false,"networking":{"networkType":"OVNKubernetes","machineNetworkV4":"10.90.0.0/24","clusterNetworkCidr":"10.128.0.0/14","clusterNetworkHostPrefix":23,"serviceNetworkCidr":"172.30.0.0/16"},"mirroring":{"registryFqdn":"registry.local:5000","sources":[]}},
"hostInventory":{"nodes":[],"ipStackMode":"ipv4"},
"operators":{"selected":[],"stale":false},
"trust":{"additionalTrustBundlePolicy":"Proxyonly","mirrorRegistryCaPem":"","proxyCaPem":""},
"exportOptions":{"includeCredentials":false,"includeCertificates":true,"includeClientTools":false,"includeInstaller":false}}}
JSON
if curl -fsS --max-time 60 -X POST -H 'Content-Type: application/json' \
     --data @"$OUT/export-state.json" \
     http://127.0.0.1:14400/api/generate -o "$OUT/generate.json" 2>"$OUT/generate-err.txt" \
   && [ -s "$OUT/generate.json" ] \
   && ! grep -qi "no architecture-support matrix" "$OUT/generate.json"; then
  result canonical-data PASS "generator served $(wc -c < "$OUT/generate.json") bytes with no missing-matrix error"
else
  result canonical-data FAIL "canonical data unavailable to the generator; see $OUT/generate.json $OUT/generate-err.txt"
fi

# --- TLS trust store --------------------------------------------------------
# The backend fetches from mirror.openshift.com and the Cincinnati API over
# TLS. A minimal runtime that dropped ca-certificates would fail only at
# request time, in production. Assert the bundle exists and node can read it;
# no network is used, so this stays deterministic offline.
podman exec "${CID_PREFIX}-run" sh -c \
  'test -s /etc/pki/tls/certs/ca-bundle.crt && node -e "const n=require(\"tls\").rootCertificates.length; if(n<50) process.exit(1); console.log(\"TLS_OK\",n)"' \
  > "$OUT/tls-trust.txt" 2>&1
if grep -q TLS_OK "$OUT/tls-trust.txt"; then
  result tls-trust PASS "$(grep TLS_OK "$OUT/tls-trust.txt")"
else
  result tls-trust FAIL "system CA bundle missing or unreadable; see $OUT/tls-trust.txt"
fi

# --- proxy plumbing ---------------------------------------------------------
# configureFetchProxy is imported first in index.js; undici must be present in
# the shipped node_modules for corporate-proxy egress to work at all.
podman exec "${CID_PREFIX}-run" node \
  -e 'require("/app/node_modules/undici");console.log("PROXY_DEP_OK")' \
  > "$OUT/proxy-dep.txt" 2>&1
if grep -q PROXY_DEP_OK "$OUT/proxy-dep.txt"; then
  result proxy-deps PASS "undici present for proxy-aware fetch"
else
  result proxy-deps FAIL "see $OUT/proxy-dep.txt"
fi

# --- credential temp-file handling -----------------------------------------
# writeTempAuth writes 0600 pull secrets into DATA_DIR/tmp, and the Tranche 8C
# startup sweep reclaims them. Both need that directory to be creatable and
# writable by the app's uid inside THIS image.
podman exec --user 1001 "${CID_PREFIX}-run" sh -c \
  'mkdir -p /data/tmp && umask 077 && printf "{}" > /data/tmp/registry-auth-parity.json && stat -c "%a" /data/tmp/registry-auth-parity.json && rm -f /data/tmp/registry-auth-parity.json && echo CRED_OK' \
  > "$OUT/credential-tmp.txt" 2>&1
if grep -q CRED_OK "$OUT/credential-tmp.txt" && grep -q '^600$' "$OUT/credential-tmp.txt"; then
  result credential-tmp PASS "DATA_DIR/tmp usable, 0600 preserved"
else
  result credential-tmp FAIL "see $OUT/credential-tmp.txt"
fi

# --- export generation ------------------------------------------------------
# The end-to-end artifact path: generate a real bundle.zip through the running
# image. Catches a runtime that boots but cannot produce output (missing
# archiver, missing canonical data, a broken native module under load).
if curl -fsS --max-time 120 -X POST -H 'Content-Type: application/json' \
     --data @"$OUT/export-state.json" \
     http://127.0.0.1:14400/api/bundle.zip -o "$OUT/bundle.zip" 2>"$OUT/export-err.txt"; then
  # PK magic, and the manifest the importer requires must be present.
  if head -c 2 "$OUT/bundle.zip" | grep -q 'PK' \
     && grep -aq 'version-manifest.json' "$OUT/bundle.zip"; then
    result export-generate PASS "bundle.zip $(wc -c < "$OUT/bundle.zip") bytes, PK + manifest"
  else
    result export-generate FAIL "response is not a manifest-bearing zip; see $OUT/bundle.zip"
  fi
else
  result export-generate FAIL "POST /api/bundle.zip failed; see $OUT/export-err.txt"
fi

# --- ssh-keygen -------------------------------------------------------------
# backend/src/index.js spawns `ssh-keygen` by name. It is the ONLY consumer of
# openssh-clients in the shipping image, so a hardening pass that drops that
# package breaks exactly one endpoint and nothing else notices. All three
# algorithms the handler accepts are exercised, because -t rsa/-t ecdsa take
# different code paths through ssh-keygen than ed25519.
SSH_OK=1
SSH_DETAIL=""
for alg in ed25519 rsa ecdsa; do
  code=$(curl -sS -o "$OUT/ssh-$alg.json" -w '%{http_code}' --max-time 90 \
    -X POST -H 'Content-Type: application/json' -d "{\"algorithm\":\"$alg\"}" \
    http://127.0.0.1:14400/api/ssh/keypair 2>>"$OUT/ssh-err.txt")
  if [ "$code" = 200 ] && grep -q '"publicKey"' "$OUT/ssh-$alg.json"; then
    SSH_DETAIL="$SSH_DETAIL $alg=ok"
  else
    SSH_OK=0
    SSH_DETAIL="$SSH_DETAIL $alg=HTTP$code"
  fi
done
# Private key material must not survive the request. generateSshKeypair writes
# into DATA_DIR/tmp and unlinks; a leftover file here is a credential leak.
LEFTOVER=$(podman exec "${CID_PREFIX}-run" sh -c \
  'ls /data/tmp 2>/dev/null | grep -c "^airgap-key-" || true' 2>/dev/null | tr -d '\r')
if [ "$SSH_OK" = 1 ] && [ "${LEFTOVER:-0}" = 0 ]; then
  result ssh-keygen PASS "ssh-keygen usable:$SSH_DETAIL; no key material left in DATA_DIR/tmp"
else
  result ssh-keygen FAIL "keygen:$SSH_DETAIL leftoverKeys=${LEFTOVER:-?}; see $OUT/ssh-*.json"
fi

# --- df / disk space --------------------------------------------------------
# checkPath() spawns `df -Pk` and reports "df command is not available in the
# backend image." on ENOENT. The minimal base ships coreutils-single rather
# than coreutils, so df's presence is a property to prove, not to assume.
if curl -fsS --max-time 30 -X POST -H 'Content-Type: application/json' \
     -d '{"path":"/data","minBytes":1024}' \
     http://127.0.0.1:14400/api/system/path-check -o "$OUT/path-check.json" 2>"$OUT/path-check-err.txt" \
   && grep -q '"freeBytes"' "$OUT/path-check.json" \
   && ! grep -qi 'df command is not available' "$OUT/path-check.json"; then
  result disk-space PASS "$(tr -d '\n' < "$OUT/path-check.json" | cut -c1-120)"
else
  result disk-space FAIL "df-backed path-check failed; see $OUT/path-check.json $OUT/path-check-err.txt"
fi

# --- openshift-install toolchain -------------------------------------------
# openshift-install is NOT baked into the image: installer.js and
# openshiftInstaller.js download it at request time and then run
# `tar -xzf` + `chmod +x` into DATA_DIR/tools as the app uid. Proven offline
# against a tarball built in place -- `tar -z` forks /usr/bin/gzip, which comes
# from a different package than tar, so "tar exists" is not sufficient.
podman exec --user 1001 "${CID_PREFIX}-run" sh -c '
set -e
d=/data/tools/parity-installer
rm -rf "$d"; mkdir -p "$d"; cd "$d"
printf "#!/bin/sh\necho installer-ran\n" > openshift-install
tar -czf probe.tar.gz openshift-install
rm -f openshift-install
tar -xzf probe.tar.gz -C "$d"
chmod +x "$d/openshift-install"
"$d/openshift-install"
command -v curl >/dev/null || { echo "curl missing"; exit 1; }
rm -rf "$d"
echo INSTALLER_TOOLCHAIN_OK' > "$OUT/installer-toolchain.txt" 2>&1
if grep -q INSTALLER_TOOLCHAIN_OK "$OUT/installer-toolchain.txt" \
   && grep -q installer-ran "$OUT/installer-toolchain.txt"; then
  result installer-toolchain PASS "curl+tar+gzip+chmod usable by uid 1001 under DATA_DIR"
else
  result installer-toolchain FAIL "see $OUT/installer-toolchain.txt"
fi

# --- container engine absent (documented degradation) -----------------------
# runtimePackage.js shells out to `podman save` / `docker save`. Neither engine
# is installed in this image and neither should be: README documents "Podman or
# Docker available on the export system" as a PREREQUISITE OF THE HOST. The
# contract being asserted is therefore the degradation, not the capability --
# HTTP 200, a RUNTIME_PACKAGE_NOT_INCLUDED.txt note in the bundle, and
# specifically NOT the RUNTIME_PACKAGE_ERROR.txt that the catch block writes
# when staging throws. Zip member NAMES are stored uncompressed in the local
# header, so `grep -a` sees them without needing a host unzip.
sed 's/"includeInstaller":false/"includeInstaller":false,"includeHighSideRuntimePackage":true/' \
  "$OUT/export-state.json" > "$OUT/rtpkg-state.json"
RT_CODE=$(curl -sS -o "$OUT/rtpkg-bundle.zip" -w '%{http_code}' --max-time 180 \
  -X POST -H 'Content-Type: application/json' --data @"$OUT/rtpkg-state.json" \
  http://127.0.0.1:14400/api/bundle.zip 2>"$OUT/rtpkg-err.txt")
if [ "$RT_CODE" = 200 ] \
   && head -c 2 "$OUT/rtpkg-bundle.zip" | grep -q 'PK' \
   && grep -aq 'RUNTIME_PACKAGE_NOT_INCLUDED.txt' "$OUT/rtpkg-bundle.zip" \
   && ! grep -aq 'RUNTIME_PACKAGE_ERROR.txt' "$OUT/rtpkg-bundle.zip"; then
  result engine-absent PASS "no engine in image -> HTTP 200 + NOT_INCLUDED note ($(wc -c < "$OUT/rtpkg-bundle.zip") bytes)"
else
  result engine-absent FAIL "HTTP $RT_CODE; want 200 + RUNTIME_PACKAGE_NOT_INCLUDED.txt and no ERROR.txt; see $OUT/rtpkg-bundle.zip $OUT/rtpkg-err.txt"
fi

# --- SIGTERM ---------------------------------------------------------------
START=$(date +%s)
podman stop -t 10 "${CID_PREFIX}-run" >/dev/null 2>&1
ELAPSED=$(( $(date +%s) - START ))
EXITCODE=$(podman inspect "${CID_PREFIX}-run" --format '{{.State.ExitCode}}' 2>/dev/null)
podman logs "${CID_PREFIX}-run" > "$OUT/container-final.log" 2>&1
if [ "$EXITCODE" = 143 ] && [ "$ELAPSED" -le 8 ]; then
  result sigterm PASS "exit $EXITCODE after ${ELAPSED}s"
else
  result sigterm FAIL "exit=$EXITCODE elapsed=${ELAPSED}s (want 143, fast); see $OUT/container-final.log"
fi

# --- arbitrary UID with gid 0 (OpenShift SCC restricted-v2) -----------------
# The default CMD runs entrypoint.sh, which expects to start as root. Under an
# arbitrary non-root UID `runuser` cannot work, so this check asserts the
# weaker, actually-required property: the app's files and the node runtime are
# readable/executable by an arbitrary uid with gid 0, and node can start the
# server directly. This mirrors how the frontend image was validated.
podman run --rm --user 12345:0 --entrypoint node "$IMAGE" \
  -e 'const D=require("/app/node_modules/better-sqlite3");new D("/tmp/x.db").exec("create table t(a)");console.log("ARBUID_OK",process.getuid(),process.getgid());' \
  > "$OUT/arbitrary-uid.txt" 2>&1
if grep -q 'ARBUID_OK 12345 0' "$OUT/arbitrary-uid.txt"; then
  result arbitrary-uid PASS "$(grep ARBUID_OK "$OUT/arbitrary-uid.txt")"
else
  result arbitrary-uid FAIL "see $OUT/arbitrary-uid.txt"
fi

# --- NO_PROXY routing -------------------------------------------------------
# proxy-deps above proves only that undici is installed. This proves the
# routing DECISION, and does it offline and deterministically by making the two
# outcomes fail differently:
#   proxy host  = proxy.invalid  -> unresolvable, so going via the proxy
#                                   fails with ENOTFOUND
#   target      = 127.0.0.1:1    -> nothing listening, so going direct
#                                   fails with ECONNREFUSED
# NO_PROXY honoured  => ECONNREFUSED; NO_PROXY ignored => ENOTFOUND.
podman run --rm --entrypoint node \
  -e HTTP_PROXY=http://proxy.invalid:3128 -e NO_PROXY=127.0.0.1,localhost "$IMAGE" -e '
const {EnvHttpProxyAgent}=require("/app/node_modules/undici");
new EnvHttpProxyAgent().dispatch({origin:"http://127.0.0.1:1/",path:"/",method:"GET"},
 {onConnect(){},onError(e){console.log("CODE",e.code||e.message)},onHeaders(){},onData(){},onComplete(){}});
' > "$OUT/no-proxy-bypass.txt" 2>&1
podman run --rm --entrypoint node \
  -e HTTP_PROXY=http://proxy.invalid:3128 -e NO_PROXY=example.org "$IMAGE" -e '
const {EnvHttpProxyAgent}=require("/app/node_modules/undici");
new EnvHttpProxyAgent().dispatch({origin:"http://127.0.0.1:1/",path:"/",method:"GET"},
 {onConnect(){},onError(e){console.log("CODE",e.code||e.message)},onHeaders(){},onData(){},onComplete(){}});
' > "$OUT/no-proxy-via.txt" 2>&1
if grep -q 'CODE ECONNREFUSED' "$OUT/no-proxy-bypass.txt" \
   && grep -q 'CODE ENOTFOUND' "$OUT/no-proxy-via.txt"; then
  result no-proxy PASS "NO_PROXY bypasses proxy (ECONNREFUSED); non-matching origin uses it (ENOTFOUND)"
else
  result no-proxy FAIL "bypass=$(grep CODE "$OUT/no-proxy-bypass.txt" || echo none) via=$(grep CODE "$OUT/no-proxy-via.txt" || echo none)"
fi

# --- SELinux-relabelled bind mount as DATA_DIR ------------------------------
# docker-compose.yml documents a compose.override.yml that bind-mounts external
# storage for oc-mirror archives. A named volume (used by every check above)
# exercises neither the SELinux relabel nor entrypoint.sh's chown/chmod
# fallback against a host-owned directory, so this boots the real entrypoint
# over a `:Z` bind mount and then writes as the app uid.
BIND_HOST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/oaa-parity-bind-XXXXXX")
podman run -d --name "${CID_PREFIX}-bind" \
  -e PORT=4000 -e DATA_DIR=/data -e MOCK_MODE=true \
  -v "$BIND_HOST_DIR":/data:Z \
  -p 127.0.0.1:14401:4000 "$IMAGE" >/dev/null 2>"$OUT/bind-run-err.txt"
bok=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1:14401/api/build-info -o /dev/null 2>/dev/null; then
    bok=1; break
  fi
  sleep 1
done
podman logs "${CID_PREFIX}-bind" > "$OUT/bind-container.log" 2>&1
podman exec --user 1001 "${CID_PREFIX}-bind" sh -c \
  'printf ok > /data/.parity-bind-probe && echo BIND_WRITE_OK' >> "$OUT/bind-container.log" 2>&1
podman exec "${CID_PREFIX}-bind" ls -la /data >> "$OUT/bind-container.log" 2>&1
if [ "$bok" = 1 ] && grep -q BIND_WRITE_OK "$OUT/bind-container.log" \
   && grep -qE 'airgap-architect\.db' "$OUT/bind-container.log"; then
  result bindmount-selinux PASS "booted on :Z bind mount; uid 1001 wrote DATA_DIR and the DB landed there"
else
  result bindmount-selinux FAIL "booted=$bok; see $OUT/bind-container.log $OUT/bind-run-err.txt"
fi
podman rm -f "${CID_PREFIX}-bind" >/dev/null 2>&1 || true

echo "=== $IMAGE : $( [ $FAILED = 0 ] && echo ALL PASS || echo FAILURES ) ==="
exit $FAILED
