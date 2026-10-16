#!/usr/bin/env bash
#
# The gate must read the certification harness's artifacts AS EMITTED.
#
# THE DEFECT THIS PINS DOWN. `scripts/release/axes/image-vulnerabilities.mjs`
# writes `<run>/image-vulnerabilities/<role>.scan.json`. The gate read
# `<evdir>/<role>.json`. Pointing OAA_SCAN_EVIDENCE_DIR at a real certification
# run therefore reported "scan evidence does not exist" while the correct files
# sat in that very directory. It failed closed, so it was never a false GREEN —
# but it turned a manual copy-and-rename into an unwritten release step, and
# unwritten release steps are the ones that get skipped.
#
# Fixtures here are shaped exactly like a real run directory. podman is STUBBED,
# so every case is deterministic and needs no image, registry or network.
#
# Run: bash scripts/security/gate-evidence-contract.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }
is()  { [ "$2" = "$3" ] && ok "$1" || bad "$1" "want [$3] got [$2]"; }

S="$(mktemp -d "${TMPDIR:-/tmp}/oaa-evcontract-XXXXXX")"
trap 'rm -rf "$S"' EXIT

# --- repo with a computable candidate --------------------------------------
REPO="$S/repo"
mkdir -p "$REPO/scripts/security" "$REPO/scripts/release/lib" "$REPO/backend"
cp "$HERE/image-surface.sh" "$HERE/package-surface.mjs" "$REPO/scripts/security/"
git -C "$REPO" init -q
git -C "$REPO" config user.email t@example.invalid
git -C "$REPO" config user.name Test
git -C "$REPO" config commit.gpgsign false
printf 'FROM base\nRUN npm ci --omit=dev\n' > "$REPO/backend/Containerfile"
git -C "$REPO" add -A >/dev/null; git -C "$REPO" commit -qm base
BASE="$(git -C "$REPO" rev-parse HEAD)"
CAND=2222222222222222222222222222222222222222222222222222222222222222
cat > "$REPO/scripts/release/lib/candidate.mjs" <<EOF
export function describeCandidate() { return { candidateId: "$CAND" }; }
EOF
# image-affecting change, so the verdict reaches the per-role evidence loop
printf 'FROM other-base\nRUN npm ci --omit=dev\n' > "$REPO/backend/Containerfile"

# --- stub podman ------------------------------------------------------------
STUB="$S/bin"; mkdir -p "$STUB"
cat > "$STUB/podman" <<'EOF'
#!/usr/bin/env bash
fmt=""; prev=""
for a in "$@"; do case "$prev" in --format) fmt="$a";; esac; prev="$a"; done
case "$fmt" in
  *".Id"*)                 printf '%s' "${OAA_STUB_ID:-}";;
  *"io.oaa.candidate-id"*) printf '%s' "${OAA_STUB_CANDIDATE:-}";;
  *)                       printf '';;
esac
EOF
chmod 755 "$STUB/podman"; PATH="$STUB:$PATH"; export PATH

DIGEST=cafe00cafe00cafe00cafe00cafe00cafe00cafe00cafe00cafe00cafe00cafe
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export OAA_STUB_ID="$DIGEST" OAA_STUB_CANDIDATE="$CAND"

# shellcheck source=/dev/null
. "$REPO/scripts/security/image-surface.sh"

# A report shaped like trivy's, with a controllable finding count.
mk_report() { # path crit high
  node -e '
    const [p,c,h,want,now] = process.argv.slice(1);
    const v = (s) => ({ VulnerabilityID: "CVE-0000-" + s + Math.random().toString(36).slice(2), Severity: s });
    const vulns = [...Array(+c)].map(() => v("CRITICAL")).concat([...Array(+h)].map(() => v("HIGH")));
    require("node:fs").writeFileSync(p, JSON.stringify({
      Metadata: { ImageID: "sha256:" + want, DBUpdatedAt: now },
      Results: [{ Target: "x", Vulnerabilities: vulns }],
    }));
  ' "$1" "$2" "$3" "$DIGEST" "$NOW"
}

EV="$S/run/image-vulnerabilities"      # shaped exactly like a certification run
mkdir -p "$EV"
printf '{"database":{"builtAt":"%s"}}\n' "$NOW" > "$EV/scan-summary.json"

verdict() { ( cd "$REPO" && OAA_GATE_BASELINE="$BASE" OAA_SCAN_EVIDENCE_DIR="$EV" \
               oaa_container_scan_verdict "$REPO" | cut -f1 ); }
detail()  { ( cd "$REPO" && OAA_GATE_BASELINE="$BASE" OAA_SCAN_EVIDENCE_DIR="$EV" \
               oaa_container_scan_verdict "$REPO" | cut -f2- ); }
reset_ev() { rm -f "$EV"/backend.json "$EV"/backend.scan.json "$EV"/frontend.json "$EV"/frontend.scan.json; }

echo "the resolver, directly"
reset_ev
is "neither name present -> absent (rc 1)" \
   "$(oaa_resolve_scan_evidence "$EV" backend >/dev/null 2>&1; echo $?)" "1"
mk_report "$EV/backend.scan.json" 0 0
is "canonical <role>.scan.json resolves" \
   "$(oaa_resolve_scan_evidence "$EV" backend)" "$EV/backend.scan.json"
reset_ev; mk_report "$EV/backend.json" 0 0
is "legacy <role>.json still resolves" \
   "$(oaa_resolve_scan_evidence "$EV" backend)" "$EV/backend.json"
reset_ev; mk_report "$EV/backend.scan.json" 0 0; cp "$EV/backend.scan.json" "$EV/backend.json"
is "both present and IDENTICAL -> canonical, no conflict" \
   "$(oaa_resolve_scan_evidence "$EV" backend)" "$EV/backend.scan.json"
mk_report "$EV/backend.json" 1 0
is "both present and DIFFERENT -> conflict (rc 2)" \
   "$(oaa_resolve_scan_evidence "$EV" backend >/dev/null 2>&1; echo $?)" "2"

echo
echo "end-to-end through the verdict, run-directory shaped"
reset_ev
mk_report "$EV/backend.scan.json" 0 0; mk_report "$EV/frontend.scan.json" 0 0
is "as-emitted artifacts, clean scan, matching candidate -> PASS" "$(verdict)" "PASS"

reset_ev
mk_report "$EV/backend.scan.json" 1 2; mk_report "$EV/frontend.scan.json" 0 0
is "as-emitted artifacts with BLOCKING findings -> RED" "$(verdict)" "RED"
case "$(detail)" in *"1 critical, 2 high"*) ok "   and reports the real counts";; *) bad "   and reports the real counts" "$(detail)";; esac

reset_ev
mk_report "$EV/backend.scan.json" 0 0; mk_report "$EV/frontend.scan.json" 0 0
cp "$EV/backend.scan.json" "$EV/backend.json"; mk_report "$EV/backend.json" 1 0
is "conflicting duplicate names -> INCOMPLETE, not a silent pick" "$(verdict)" "INCOMPLETE"
case "$(detail)" in *"differ"*) ok "   and names the disagreement";; *) bad "   and names the disagreement" "$(detail)";; esac

reset_ev
is "no evidence at all -> INCOMPLETE" "$(verdict)" "INCOMPLETE"

echo
echo "resolving the filename does NOT relax any other guard"
reset_ev
mk_report "$EV/backend.scan.json" 0 0; mk_report "$EV/frontend.scan.json" 0 0
# Export, call, restore. A `VAR=x is "$(verdict)"` prefix would NOT work here:
# the command substitution is expanded while building the argument list, i.e.
# before the prefix is applied to `is`, so the verdict would be computed with
# the OLD candidate and the case would pass vacuously.
export OAA_STUB_CANDIDATE=9999999999999999999999999999999999999999999999999999999999999999
is "as-emitted artifacts + WRONG source candidate -> INCOMPLETE" "$(verdict)" "INCOMPLETE"
export OAA_STUB_CANDIDATE="$CAND"

node -e '
  const fs=require("node:fs"), p=process.argv[1];
  const j=JSON.parse(fs.readFileSync(p,"utf8"));
  j.Metadata.ImageID="sha256:deadbeef"; fs.writeFileSync(p, JSON.stringify(j));
' "$EV/backend.scan.json"
is "as-emitted artifacts + WRONG image digest -> INCOMPLETE" "$(verdict)" "INCOMPLETE"

mk_report "$EV/backend.scan.json" 0 0
node -e '
  const fs=require("node:fs"), p=process.argv[1];
  const j=JSON.parse(fs.readFileSync(p,"utf8"));
  delete j.Metadata.DBUpdatedAt; fs.writeFileSync(p, JSON.stringify(j));
' "$EV/backend.scan.json"
printf '{"database":{}}\n' > "$EV/scan-summary.json"
is "as-emitted artifacts + no database timestamp -> INCOMPLETE" "$(verdict)" "INCOMPLETE"
printf '{"database":{"builtAt":"%s"}}\n' "$NOW" > "$EV/scan-summary.json"

printf 'not json' > "$EV/backend.scan.json"
is "as-emitted artifacts + malformed JSON -> INCOMPLETE" "$(verdict)" "INCOMPLETE"

echo
printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
