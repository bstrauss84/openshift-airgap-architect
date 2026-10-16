#!/usr/bin/env bash
#
# The gate must bind the shipping image to the SOURCE CANDIDATE, not only the
# scan report to the image.
#
# THE GAP THIS PINS DOWN. `oaa_scan_evidence_ok` proves a report describes a
# given image, by comparing the report's subject against that image's config
# digest. That is necessary and not sufficient: an image built from an EARLIER
# candidate keeps its config digest, so stale-but-matching evidence passed the
# check. Observed live — images labelled candidate 2c65566601a4… while the
# source tree was candidate 7e3561ad5879…, with the verdict reaching RED only
# because the scan happened to report findings. Had the images been clean, the
# gate would have printed PASS for images that did not contain the source
# under test.
#
# podman is STUBBED here, so these cases are deterministic and need no images,
# no registry and no network.
#
# Run: bash scripts/security/gate-candidate-binding.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }
is()  { [ "$2" = "$3" ] && ok "$1" || bad "$1" "want [$3] got [$2]"; }

S="$(mktemp -d "${TMPDIR:-/tmp}/oaa-candbind-XXXXXX")"
trap 'rm -rf "$S"' EXIT

# --- a repo whose candidate id is computable -------------------------------
REPO="$S/repo"
mkdir -p "$REPO/scripts/security" "$REPO/scripts/release/lib" \
         "$REPO/release-certification/scan-evidence" "$REPO/backend"
cp "$HERE/image-surface.sh" "$HERE/package-surface.mjs" "$REPO/scripts/security/"
git -C "$REPO" init -q
git -C "$REPO" config user.email t@example.invalid
git -C "$REPO" config user.name Test
git -C "$REPO" config commit.gpgsign false
printf 'FROM base\nRUN npm ci --omit=dev\n' > "$REPO/backend/Containerfile"
git -C "$REPO" add -A >/dev/null; git -C "$REPO" commit -qm base
BASE="$(git -C "$REPO" rev-parse HEAD)"

# A stand-in describeCandidate so the gate's own resolver has something real to
# call. Returns a fixed id; the point under test is the COMPARISON, not how the
# id is derived (that is covered by the release harness's own tests).
CAND=1111111111111111111111111111111111111111111111111111111111111111
cat > "$REPO/scripts/release/lib/candidate.mjs" <<EOF
export function describeCandidate() { return { candidateId: "$CAND" }; }
EOF

# Make the tree image-affecting so the verdict reaches the per-role loop.
printf 'FROM other-base\nRUN npm ci --omit=dev\n' > "$REPO/backend/Containerfile"

# --- stub podman -----------------------------------------------------------
STUB="$S/bin"; mkdir -p "$STUB"
cat > "$STUB/podman" <<'EOF'
#!/usr/bin/env bash
# Minimal `podman image inspect --format {{...}}` stub.
#   OAA_STUB_ID        -> .Id
#   OAA_STUB_CANDIDATE -> io.oaa.candidate-id  (empty = label absent)
fmt=""
for a in "$@"; do case "$prev" in --format) fmt="$a";; esac; prev="$a"; done
case "$fmt" in
  *".Id"*)               printf '%s' "${OAA_STUB_ID:-}";;
  *"io.oaa.candidate-id"*) printf '%s' "${OAA_STUB_CANDIDATE:-}";;
  *)                     printf '';;
esac
EOF
chmod 755 "$STUB/podman"
PATH="$STUB:$PATH"; export PATH

DIGEST=abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
for r in backend frontend; do
  printf '{"Metadata":{"ImageID":"sha256:%s","DBUpdatedAt":"%s"},"Results":[]}\n' "$DIGEST" "$NOW" \
    > "$REPO/release-certification/scan-evidence/$r.json"
done

# shellcheck source=/dev/null
. "$REPO/scripts/security/image-surface.sh"

verdict() { ( cd "$REPO" && OAA_GATE_BASELINE="$BASE" oaa_container_scan_verdict "$REPO" | cut -f1 ); }
detail()  { ( cd "$REPO" && OAA_GATE_BASELINE="$BASE" oaa_container_scan_verdict "$REPO" | cut -f2- ); }

echo "the gate resolves the source candidate at all"
is "candidate id is readable from the release harness" "$(oaa_candidate_id "$REPO")" "$CAND"

echo
echo "image -> candidate binding"
export OAA_STUB_ID="$DIGEST"

export OAA_STUB_CANDIDATE=""
is "image with NO candidate label -> INCOMPLETE" "$(verdict)" "INCOMPLETE"
case "$(detail)" in *"no io.oaa.candidate-id"*) ok "   and says the label is absent";; *) bad "   and says the label is absent" "$(detail)";; esac

export OAA_STUB_CANDIDATE=9999999999999999999999999999999999999999999999999999999999999999
is "image from a DIFFERENT candidate -> INCOMPLETE" "$(verdict)" "INCOMPLETE"
case "$(detail)" in *"DIFFERENT candidate"*) ok "   and names both candidates";; *) bad "   and names both candidates" "$(detail)";; esac

export OAA_STUB_CANDIDATE="$CAND"
is "image from THIS candidate, clean scan -> PASS" "$(verdict)" "PASS"

echo
echo "binding is checked IN ADDITION to the report->image digest match"
# Right candidate, but the report describes a different image. Must still fail:
# the two checks are independent and neither rescues the other.
printf '{"Metadata":{"ImageID":"sha256:%s","DBUpdatedAt":"%s"},"Results":[]}\n' \
  "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" "$NOW" \
  > "$REPO/release-certification/scan-evidence/backend.json"
is "right candidate + wrong report subject -> INCOMPLETE" "$(verdict)" "INCOMPLETE"
printf '{"Metadata":{"ImageID":"sha256:%s","DBUpdatedAt":"%s"},"Results":[]}\n' "$DIGEST" "$NOW" \
  > "$REPO/release-certification/scan-evidence/backend.json"

echo
echo "an unknowable candidate REFUSES rather than switching the check off"
# A gate whose strictest check silently disables itself under an error
# condition is the shape of every fail-open defect. "I cannot determine what
# this candidate is" is exactly the state in which a binding claim is
# unprovable, so it must refuse — even though the image digest and the scan
# evidence are both perfectly valid here.
mv "$REPO/scripts/release/lib/candidate.mjs" "$S/candidate.mjs.bak"
export OAA_STUB_CANDIDATE="$CAND"
is "missing release harness -> INCOMPLETE (not PASS)" "$(verdict)" "INCOMPLETE"
case "$(detail)" in
  *"could not be determined"*) ok "   and says the candidate id is undeterminable";;
  *) bad "   and says the candidate id is undeterminable" "$(detail)";;
esac
mv "$S/candidate.mjs.bak" "$REPO/scripts/release/lib/candidate.mjs"
is "and recovers once the harness is back" "$(verdict)" "PASS"

echo
printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
