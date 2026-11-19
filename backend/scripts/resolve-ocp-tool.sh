#!/bin/sh
# OpenShift Airgap Architect — resolve, verify and install one Red Hat client tool
# (oc or oc-mirror) from a mirror.openshift.com channel at image build time.
#
# Why this exists (2026-11-19 build regression): the channel `clients/ocp/latest`
# moved to OpenShift 5.0.1, whose sha256sum.txt publishes NO oc-mirror artifact
# (neither oc-mirror.tar.gz nor oc-mirror.rhel9.tar.gz) on any architecture, so
# the build failed with "FATAL: no SHA256 for oc-mirror.tar.gz". This script makes
# every step explicit and fail-closed:
#
#   1. sha256sum.txt and release.txt are downloaded from the SAME channel, and
#      release.txt is verified against sha256sum.txt's own entry for it, so the
#      version we record and the checksums we trust come from one snapshot of a
#      mutable channel (a channel flip between requests fails the build).
#   2. The resolved version must belong to the channel's minor (latest-4.22 → 4.22.z).
#   3. The artifact's checksum must be present and exactly 64 lowercase hex digits;
#      when it is missing, the error names the channel, the release it resolved
#      to, and what to do — never a fallback to another artifact or unverified bytes.
#   4. The download is checked with `sha256sum --check --strict`.
#   5. The archive must contain the expected member as a REGULAR file; only that
#      member is extracted (no owners preserved) and it is made 0755.
#   6. The binary must be an ELF executable for the build architecture
#      (e_machine checked against the architecture directory).
#   7. Optionally the binary is executed (--run "<args>") to prove it runs here.
#
# TLS: curl uses its normal verification (CURL_CA_BUNDLE from the optional
# oaa_build_ca secret is honoured); nothing here disables it.
#
# Usage:
#   resolve-ocp-tool.sh --arch-dir x86_64 --channel latest-4.22 \
#     --artifact oc-mirror.tar.gz --member oc-mirror --dest /usr/local/bin/oc-mirror \
#     [--sha <64-hex override>] [--url <artifact URL override>] [--run "version --output=json"]
# Prints provenance lines: VERSION=… SHA256=… CHANNEL=… ARCH=… URL=…
#
# Test hook: OAA_RESOLVE_FIXTURES=<dir> serves <dir>/<arch>/<channel>/<file>
# instead of the network (used by backend/test/resolve-ocp-tool.test.js only;
# the Containerfile never sets it, and checksum verification still applies).
#
# Developed with AI assistance from Claude (Anthropic).
set -eu

die() { echo "FATAL: $*" >&2; exit 1; }

ARCH_DIR="" CHANNEL="" ARTIFACT="" MEMBER="" DEST="" SHA_OVERRIDE="" URL_OVERRIDE="" RUN_ARGS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --arch-dir) ARCH_DIR="$2"; shift 2 ;;
    --channel) CHANNEL="$2"; shift 2 ;;
    --artifact) ARTIFACT="$2"; shift 2 ;;
    --member) MEMBER="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    --sha) SHA_OVERRIDE="$2"; shift 2 ;;
    --url) URL_OVERRIDE="$2"; shift 2 ;;
    --run) RUN_ARGS="$2"; shift 2 ;;
    *) die "unknown argument $1" ;;
  esac
done
[ -n "$ARCH_DIR" ] && [ -n "$CHANNEL" ] && [ -n "$ARTIFACT" ] && [ -n "$MEMBER" ] && [ -n "$DEST" ] || die "usage: --arch-dir --channel --artifact --member --dest are required"
case "$ARCH_DIR" in x86_64|aarch64|ppc64le|s390x) ;; *) die "unsupported architecture directory $ARCH_DIR" ;; esac
case "$CHANNEL" in *[!A-Za-z0-9.-]*|"") die "invalid channel name '$CHANNEL'" ;; esac
case "$ARTIFACT$MEMBER" in */*|*..*) die "artifact and member must be plain file names" ;; esac
if [ -n "$URL_OVERRIDE" ] && [ -z "$SHA_OVERRIDE" ]; then die "a URL override for $ARTIFACT requires a SHA256 override"; fi

BASE="https://mirror.openshift.com/pub/openshift-v4/${ARCH_DIR}/clients/ocp/${CHANNEL}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# fetch <url> <output-file>
fetch() {
  if [ -n "${OAA_RESOLVE_FIXTURES:-}" ]; then
    rel="${1#https://mirror.openshift.com/pub/openshift-v4/}"
    rel="$(printf '%s' "$rel" | sed 's#/clients/ocp/#/#')"
    src="${OAA_RESOLVE_FIXTURES}/${rel}"
    [ -f "$src" ] || { echo "FATAL: HTTP error for $1 (curl 22) — fixture $src missing" >&2; return 22; }
    cp "$src" "$2"
    return 0
  fi
  curl -fsSL --proto '=https' --retry 4 --retry-delay 5 --retry-connrefused --connect-timeout 30 "$1" -o "$2" || { rc=$?
    case $rc in
      35|51|53|54|58|59|60|66|77|80|82|83|90|91) echo "FATAL: TLS verification failed for $1 (curl $rc). Behind an HTTPS-inspecting proxy, supply its CA as the oaa_build_ca build secret (README: Corporate CA and proxy)." >&2 ;;
      5|6|7|28|97) echo "FATAL: could not connect for $1 (curl $rc): check HTTPS_PROXY / NO_PROXY and that mirror.openshift.com is allowed." >&2 ;;
      22) echo "FATAL: HTTP error for $1 (curl 22) — not a TLS or proxy problem; a 407 means the proxy needs credentials in HTTPS_PROXY." >&2 ;;
      *) echo "FATAL: download failed for $1 (curl $rc)." >&2 ;;
    esac; return $rc; }
}

# 1. One snapshot: checksums first, then release.txt verified against them.
fetch "${BASE}/sha256sum.txt" "$WORK/sha256sum.txt"
fetch "${BASE}/release.txt" "$WORK/release.txt"
sum_of() { awk -v f="$1" '$2==f {v=$1} END {print v}' "$WORK/sha256sum.txt"; }
rel_sha="$(sum_of release.txt)"
[ -n "$rel_sha" ] || die "${CHANNEL} (${ARCH_DIR}) sha256sum.txt has no entry for release.txt; the resolved version cannot be bound to its checksums."
(cd "$WORK" && printf '%s  %s\n' "$rel_sha" release.txt | sha256sum --check --strict --status) \
  || die "${CHANNEL} (${ARCH_DIR}) release.txt does not match its sha256sum.txt entry (the channel changed between requests, or the metadata is inconsistent). Retry the build."
VERSION="$(awk '/^Name:/ {v=$2} END {print v}' "$WORK/release.txt")"
[ -n "$VERSION" ] || die "could not resolve a version from ${BASE}/release.txt"

# 2. The version must belong to the channel's minor.
chan_minor="$(printf '%s' "$CHANNEL" | sed -n 's/^\(latest\|stable\|fast\|candidate\|eus\)-\([0-9][0-9]*\.[0-9][0-9]*\)$/\2/p')"
if [ -n "$chan_minor" ]; then
  case "$VERSION" in "${chan_minor}".*) ;; *) die "${CHANNEL} resolved to ${VERSION}, which is not a ${chan_minor} release" ;; esac
fi

# 3. The artifact's checksum, from the same snapshot (or an explicit override).
if [ -n "$SHA_OVERRIDE" ]; then SHA="$SHA_OVERRIDE"; else SHA="$(sum_of "$ARTIFACT")"; fi
if [ -z "$SHA" ]; then
  die "no SHA256 for ${ARTIFACT}: the ${CHANNEL} channel (${ARCH_DIR}) resolves to OpenShift ${VERSION}, whose sha256sum.txt does not list ${ARTIFACT}, so it cannot be downloaded and verified. Red Hat's global 'latest' channel moved to OpenShift 5.0, which publishes no oc-mirror; build with OC_MIRROR_CHANNEL=latest-<newest supported 4.x minor> (the default), or pin OCP_MIRROR_URL together with OCP_MIRROR_SHA256. See docs/BUILD_TROUBLESHOOTING.md."
fi
printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{64}$' || die "the SHA256 for ${ARTIFACT} is not 64 lowercase hex digits: '${SHA}'"

# 4. Download and verify.
URL="${URL_OVERRIDE:-${BASE}/${ARTIFACT}}"
echo "Downloading ${MEMBER} ${VERSION} (${ARCH_DIR}, ${CHANNEL}) from: ${URL}" >&2
fetch "$URL" "$WORK/artifact.tgz"
(cd "$WORK" && printf '%s  %s\n' "$SHA" artifact.tgz | sha256sum --check --strict --status) \
  || die "${ARTIFACT} failed SHA-256 verification (expected ${SHA})"

# 5. The archive must hold the member as a regular file; extract only it.
listing="$(tar -tvzf "$WORK/artifact.tgz")" || die "${ARTIFACT} is not a readable gzip tar archive"
# GNU tar -tv columns: mode owner/group size date time NAME [-> link target];
# the name is field 6 (the last field of a symlink line is its target).
entry="$(printf '%s\n' "$listing" | awk -v m="$MEMBER" '{n=$6} (n==m || n=="./" m) && f=="" {f=$0} END {print f}')"
[ -n "$entry" ] || die "${ARTIFACT} does not contain ${MEMBER}"
case "$entry" in -*) ;; *) die "${MEMBER} in ${ARTIFACT} is not a regular file" ;; esac
member_path="$(printf '%s\n' "$entry" | awk '{v=$6} END {print v}')"
mkdir -p "$WORK/x"
tar --no-same-owner --no-same-permissions -xzf "$WORK/artifact.tgz" -C "$WORK/x" "$member_path"
bin="$WORK/x/$member_path"
[ -f "$bin" ] && [ ! -L "$bin" ] || die "${MEMBER} was not extracted as a regular file"

# 6. ELF executable for this architecture (EI_DATA at 5; e_machine at 18).
magic="$(od -An -tx1 -N4 "$bin" | tr -d ' \n')"
[ "$magic" = "7f454c46" ] || die "${MEMBER} is not an ELF executable"
data="$(od -An -tx1 -j5 -N1 "$bin" | tr -d ' \n')"
mach="$(od -An -tx1 -j18 -N2 "$bin" | tr -d ' \n')"
[ "$data" = "02" ] && mach="$(printf '%s' "$mach" | sed 's/^\(..\)\(..\)$/\2\1/')"
case "$ARCH_DIR:$mach" in
  x86_64:3e00|aarch64:b700|ppc64le:1500|s390x:1600) ;;
  *) die "${MEMBER} is built for ELF machine 0x${mach}, not ${ARCH_DIR}" ;;
esac

install -m 0755 "$bin" "$DEST"

# 7. It runs here (an architecture or libc mismatch fails now, not at first use).
if [ -n "$RUN_ARGS" ]; then
  # shellcheck disable=SC2086
  "$DEST" $RUN_ARGS >/dev/null 2>"$WORK/run.err" || { cat "$WORK/run.err" >&2; die "${DEST} ${RUN_ARGS} failed"; }
fi

echo "VERSION=${VERSION}"
echo "SHA256=${SHA}"
echo "CHANNEL=${CHANNEL}"
echo "ARCH=${ARCH_DIR}"
echo "URL=${URL}"
