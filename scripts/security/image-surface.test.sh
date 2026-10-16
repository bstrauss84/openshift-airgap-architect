#!/usr/bin/env bash
#
# Regression tests for scripts/security/image-surface.sh.
#
# Every case builds a throwaway git repository under $TMPDIR and exercises the
# real functions against it. Nothing here touches the repository it ships in —
# which matters, because the thing under test is itself a git-diff policy and
# a test that mutated the live repo could not be trusted.
#
# The central case is COMMITTED-IMAGE-CHANGE: the gate's original HEAD-relative
# diff reports that as "nothing changed", which is the false GREEN.
#
# Run: bash scripts/security/image-surface.test.sh      (no network, no podman)
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$HERE/image-surface.sh"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }
is()   { [ "$2" = "$3" ] && ok "$1" || bad "$1" "want [$3] got [$2]"; }

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/oaa-surface-test-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

# A repository with one commit per step, so a baseline can point at any of them.
mkrepo() { # dir
  local d="$1"; mkdir -p "$d"
  git -C "$d" init -q
  git -C "$d" config user.email t@example.invalid
  git -C "$d" config user.name  Test
  git -C "$d" config commit.gpgsign false
  mkdir -p "$d/backend/src"
  printf 'FROM base\nRUN npm ci --omit=dev\n' > "$d/backend/Containerfile"
  printf '{"name":"x"}\n'                      > "$d/package.json"
  printf 'console.log(1)\n'                    > "$d/backend/src/index.js"
  git -C "$d" add -A >/dev/null
  git -C "$d" commit -qm base
  git -C "$d" rev-parse HEAD
}

echo "baseline resolution"
R="$ROOT/r1"; BASE="$(mkrepo "$R")"

( unset OAA_GATE_BASELINE
  out="$(oaa_gate_baseline "$R" 2>&1)"; rc=$?
  [ $rc -ne 0 ] && case "$out" in *"no release baseline declared"*) exit 0;; esac; exit 1 )
is "absent baseline REFUSES (does not default to HEAD)" "$?" "0"

( unset OAA_GATE_BASELINE
  out="$(oaa_gate_baseline "$R" 2>&1)"
  case "$out" in *origin/main*|*origin/develop*) exit 1;; *) exit 0;; esac )
is "refusal names no branch to silently substitute" "$?" "0"

OAA_GATE_BASELINE="$BASE" out="$(oaa_gate_baseline "$R")"
is "explicit baseline resolves" "$(printf '%s' "$out" | cut -f1)" "$BASE"
is "explicit baseline reports its source" "$(printf '%s' "$out" | cut -f2)" "OAA_GATE_BASELINE"

OAA_GATE_BASELINE=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef \
  oaa_gate_baseline "$R" >/dev/null 2>&1
is "unresolvable baseline REFUSES" "$?" "1"

mkdir -p "$R/release-certification"; printf '%s\n' "$BASE" > "$R/release-certification/gate-baseline"
( unset OAA_GATE_BASELINE; out="$(oaa_gate_baseline "$R")"
  [ "$(printf '%s' "$out" | cut -f2)" = "release-certification/gate-baseline" ] )
is "marker file is honoured when env is unset" "$?" "0"
rm -rf "$R/release-certification"

# Non-ancestor: a sibling commit on an orphan branch.
# Return by BRANCH NAME, not `checkout -`: after an orphan checkout there is
# no usable previous-branch entry, so `-` fails and HEAD stays on the orphan.
# The baseline would then be HEAD itself — an ancestor of itself — and the
# case would pass vacuously while testing nothing.
MAIN="$(git -C "$R" rev-parse --abbrev-ref HEAD)"
git -C "$R" checkout -q --orphan other >/dev/null 2>&1
printf 'x\n' > "$R/other.txt"; git -C "$R" add -A >/dev/null; git -C "$R" commit -qm other
OTHER="$(git -C "$R" rev-parse HEAD)"
git -C "$R" checkout -qf "$MAIN" >/dev/null 2>&1
is "returned to the original branch (guards the case below)" "$(git -C "$R" rev-parse --abbrev-ref HEAD)" "$MAIN"
[ "$(git -C "$R" rev-parse HEAD)" != "$OTHER" ] && ok "orphan commit is genuinely off HEAD's history" \
  || bad "orphan commit is genuinely off HEAD's history" "HEAD == OTHER, case would be vacuous"
OAA_GATE_BASELINE="$OTHER" oaa_gate_baseline "$R" >/dev/null 2>&1
is "non-ancestor baseline REFUSES" "$?" "1"

echo
echo "surface detection across all four change sources"
surface_of() { OAA_GATE_BASELINE="$BASE" oaa_image_surface "$BASE" "$R"; }

is "clean tree  -> no surface (N/A preserved)" "$(surface_of)" ""

printf 'console.log(2)\n' > "$R/backend/src/index.js"
is "UNSTAGED source-only -> no surface (N/A preserved)" "$(surface_of)" ""

git -C "$R" add -A >/dev/null
is "STAGED source-only -> no surface (N/A preserved)" "$(surface_of)" ""

git -C "$R" commit -qm "source only"
is "COMMITTED source-only -> no surface (N/A preserved)" "$(surface_of)" ""

printf 'FROM base\nRUN npm ci\n' > "$R/backend/Containerfile"
is "UNSTAGED image change -> detected" "$(surface_of)" "backend/Containerfile"

git -C "$R" add -A >/dev/null
is "STAGED image change -> detected" "$(surface_of)" "backend/Containerfile"

git -C "$R" commit -qm "image change"
# THE REGRESSION. HEAD-relative diff reports nothing here; that is the bug.
is "COMMITTED image change -> STILL detected" "$(surface_of)" "backend/Containerfile"

legacy="$( { git -C "$R" diff --name-only HEAD; git -C "$R" ls-files --others --exclude-standard; } \
           | grep -iE "$OAA_IMAGE_SURFACE_CORE" || true )"
is "control: the old HEAD-relative rule misses it" "$legacy" ""

printf '{}\n' > "$R/npm-shrinkwrap.json"
case "$(surface_of)" in *npm-shrinkwrap.json*) r=0;; *) r=1;; esac
is "untracked npm-shrinkwrap.json -> detected" "$r" "0"
rm -f "$R/npm-shrinkwrap.json"

echo
echo "strict mode widens to shipped source (opt-in, retroactive policy change)"
printf 'console.log(3)\n' > "$R/backend/src/index.js"
is "default mode: shipped source is NOT surface" "$(surface_of)" "backend/Containerfile"
got="$(OAA_GATE_SURFACE_STRICT=1 OAA_GATE_BASELINE="$BASE" oaa_image_surface "$BASE" "$R" | grep -c 'backend/src/index.js')"
is "strict mode: shipped source IS surface" "$got" "1"
git -C "$R" checkout -q -- backend/src/index.js

echo
echo "scan evidence binding"
EV="$ROOT/ev.json"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OLD="$(date -u -d '72 hours ago' +%Y-%m-%dT%H:%M:%SZ)"
WANT=aaaabbbbccccddddeeeeffff00001111222233334444555566667777888899990

oaa_scan_evidence_ok "$ROOT/missing.json" "$WANT" >/dev/null 2>&1
is "absent evidence REFUSES" "$?" "1"

printf 'not json' > "$EV"
oaa_scan_evidence_ok "$EV" "$WANT" >/dev/null 2>&1
is "unparseable evidence REFUSES" "$?" "1"

printf '{"Metadata":{"DBUpdatedAt":"%s"}}\n' "$NOW" > "$EV"
oaa_scan_evidence_ok "$EV" "$WANT" >/dev/null 2>&1
is "evidence with no ImageID REFUSES" "$?" "1"

printf '{"Metadata":{"ImageID":"sha256:%s","DBUpdatedAt":"%s"}}\n' "deadbeef" "$NOW" > "$EV"
oaa_scan_evidence_ok "$EV" "$WANT" >/dev/null 2>&1
is "evidence for a DIFFERENT image REFUSES" "$?" "1"

printf '{"Metadata":{"ImageID":"sha256:%s","DBUpdatedAt":"%s"}}\n' "$WANT" "$OLD" > "$EV"
oaa_scan_evidence_ok "$EV" "$WANT" >/dev/null 2>&1
is "stale database REFUSES" "$?" "1"

printf '{"Metadata":{"ImageID":"sha256:%s"}}\n' "$WANT" > "$EV"
oaa_scan_evidence_ok "$EV" "$WANT" >/dev/null 2>&1
is "evidence with no DB timestamp REFUSES" "$?" "1"

printf '{"Metadata":{"ImageID":"sha256:%s","DBUpdatedAt":"%s"}}\n' "$WANT" "$NOW" > "$EV"
oaa_scan_evidence_ok "$EV" "$WANT" >/dev/null 2>&1
is "fresh, matching evidence is accepted" "$?" "0"

# An ArtifactName that looks right must not rescue a mismatched subject:
# "/scan" is the operator-controlled mount path, not an identity.
printf '{"ArtifactName":"localhost/oaa-backend:latest","Metadata":{"ImageID":"sha256:deadbeef","DBUpdatedAt":"%s"}}\n' "$NOW" > "$EV"
oaa_scan_evidence_ok "$EV" "$WANT" >/dev/null 2>&1
is "a plausible ArtifactName cannot substitute for the config digest" "$?" "1"

echo
printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
