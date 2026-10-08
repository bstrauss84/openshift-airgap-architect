#!/usr/bin/env bash
#
# OAA Tranche Security Gate
# =========================
#
# Fail-closed security certification for a complete working tree, run before a commit
# is recommended for any implementation tranche.
#
#   ./scripts/security/tranche-security-gate.sh [--json <path>]
#
# Covers BOTH halves. A clean gitleaks run alone is not sufficient:
#   1. repository / supply-chain exposure  - secrets in worktree, index, history,
#      untracked files; sensitive file hygiene; production dependency vulnerabilities
#   2. runtime credential lifecycle        - synthetic canaries proving credentials do
#      not reach persistence, logs, errors, previews or default exports
#
# GUARANTEES
#   - never prints a secret value; gitleaks always runs with --redact and only safe
#     metadata (rule, path, line, fingerprint) is reported
#   - never mutates Git: no add, commit, stash, checkout. Read-only plumbing only.
#   - reports go to a temp directory outside the repository, are never committed, and
#     are never uploaded as a CI artifact
#   - PASS / BASELINE / RED / INCOMPLETE / N/A are distinct; N/A requires proven
#     applicability
#   - a required tool that is missing yields INCOMPLETE, never a silent skip
#
# RESOLVED HISTORY BASELINE. A finding in reachable history that has been resolved and
# independently verified is NOT hidden with a gitleaks allowlist — that would destroy
# the ability to notice that the historical content changed, that something new appeared
# beside it, or that a fresh finding was added. Gitleaks keeps detecting everything and
# scripts/security/history-scan-baseline-cli.mjs accounts for EVERY finding against the
# opaque digests in scripts/security/history-scan-baseline.json. Anything unregistered,
# changed, added or miscounted is RED.
#
# EXIT: 0 = GREEN. 1 = RED/INCOMPLETE. 2 = gate could not run.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

TS="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT_DIR="${OAA_GATE_REPORT_DIR:-/tmp/oaa-tranche-security-gate-$TS}"
mkdir -p "$REPORT_DIR" || exit 2

JSON_OUT=""
if [ "${1:-}" = "--json" ]; then JSON_OUT="${2:-$REPORT_DIR/result.json}"; fi

# --- result accumulation ----------------------------------------------------
declare -a R_NAME R_STATUS R_DETAIL
OVERALL_OK=1

record() { # name, status, detail
  R_NAME+=("$1"); R_STATUS+=("$2"); R_DETAIL+=("${3:-}")
  case "$2" in
    # BASELINE = findings that exactly match the resolved history baseline. Not a pass
    # by suppression: every one was still detected and mechanically accounted for.
    PASS|BASELINE|"N/A") ;;
    *) OVERALL_OK=0 ;;
  esac
}

have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# Context
# ---------------------------------------------------------------------------
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
BRANCH="$(git branch --show-current 2>/dev/null || echo unknown)"
DIRTY_MOD="$(git diff --name-only HEAD 2>/dev/null | wc -l | tr -d ' ')"
DIRTY_UNTRACKED="$(git ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')"
STAGED="$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')"

GITLEAKS_VER="not installed"
have gitleaks && GITLEAKS_VER="$(gitleaks version 2>&1 | head -1)"
NODE_VER="$(node --version 2>/dev/null || echo 'not installed')"
NPM_VER="$(npm --version 2>/dev/null || echo 'not installed')"
TRIVY_VER="not installed"; have trivy && TRIVY_VER="$(trivy --version 2>&1 | head -1)"
GRYPE_VER="not installed"; have grype && GRYPE_VER="$(grype version 2>&1 | head -1)"

# ---------------------------------------------------------------------------
# Snapshot builder - deterministic, assembled from Git inventories.
# Never scans node_modules, dist, .git or downloaded evidence.
# ---------------------------------------------------------------------------
snapshot_from_list() { # listfile, destdir
  local list="$1" dest="$2"
  mkdir -p "$dest"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    [ -f "$f" ] || continue
    mkdir -p "$dest/$(dirname "$f")"
    cp -- "$f" "$dest/$f" 2>/dev/null
  done < "$list"
}

# Run gitleaks over a directory; echo the finding count, write redacted metadata.
scan_dir() { # dir, label -> echoes count
  local dir="$1" label="$2"
  local rep="$REPORT_DIR/gitleaks-$label.json"
  gitleaks detect --source "$dir" --no-git --config "$REPO_ROOT/.gitleaks.toml" \
    --redact --report-format json --report-path "$rep" --exit-code 9 \
    >"$REPORT_DIR/gitleaks-$label.log" 2>&1
  if [ -f "$rep" ]; then jq 'length' "$rep" 2>/dev/null || echo ERR; else echo ERR; fi
}

# Print ONLY safe metadata for findings. Never Secret/Match.
dump_findings() { # label
  local rep="$REPORT_DIR/gitleaks-$1.json"
  [ -f "$rep" ] || return 0
  jq -r '.[] | "      rule=\(.RuleID) path=\(.File) line=\(.StartLine) fingerprint=\(.Fingerprint)"' "$rep" 2>/dev/null
}

# ---------------------------------------------------------------------------
# 1-4. Secret scans
# ---------------------------------------------------------------------------
if ! have gitleaks; then
  record "Secret scan — worktree"          "INCOMPLETE" "gitleaks not installed (required)"
  record "Secret scan — index"             "INCOMPLETE" "gitleaks not installed (required)"
  record "Secret scan — reachable history" "INCOMPLETE" "gitleaks not installed (required)"
  record "Gitleaks config self-test"       "INCOMPLETE" "gitleaks not installed (required)"
else
  # Config self-test FIRST: a vacuous config makes every scan below meaningless.
  if "$REPO_ROOT/scripts/security/gitleaks-selftest.sh" >"$REPORT_DIR/gitleaks-selftest.log" 2>&1; then
    record "Gitleaks config self-test" "PASS" "rules live; apiCommit exception proven narrow"
  else
    record "Gitleaks config self-test" "RED" "see $REPORT_DIR/gitleaks-selftest.log"
  fi

  # (1) worktree: tracked + relevant untracked, as the tree stands now.
  git ls-files > "$REPORT_DIR/list-worktree.txt"
  git ls-files --others --exclude-standard >> "$REPORT_DIR/list-worktree.txt"
  snapshot_from_list "$REPORT_DIR/list-worktree.txt" "$REPORT_DIR/snap-worktree"
  n="$(scan_dir "$REPORT_DIR/snap-worktree" worktree)"
  [ "$n" = "0" ] && record "Secret scan — worktree" "PASS" "0 findings" \
                 || record "Secret scan — worktree" "RED" "${n} finding(s)"

  # (2) index/staged content, materialised read-only via checkout-index.
  if [ "$STAGED" = "0" ]; then
    record "Secret scan — index" "PASS" "index empty (nothing staged)"
  else
    mkdir -p "$REPORT_DIR/snap-index"
    git checkout-index -a -f --prefix="$REPORT_DIR/snap-index/" >/dev/null 2>&1
    n="$(scan_dir "$REPORT_DIR/snap-index" index)"
    [ "$n" = "0" ] && record "Secret scan — index" "PASS" "0 findings" \
                   || record "Secret scan — index" "RED" "${n} finding(s)"
  fi

  # (3) reachable history for the active branch (real git log walk).
  gitleaks detect --source "$REPO_ROOT" --config "$REPO_ROOT/.gitleaks.toml" \
    --redact --report-format json --report-path "$REPORT_DIR/gitleaks-history.json" \
    --exit-code 9 >"$REPORT_DIR/gitleaks-history.log" 2>&1
  if [ -f "$REPORT_DIR/gitleaks-history.json" ]; then
    n="$(jq 'length' "$REPORT_DIR/gitleaks-history.json")"
    if [ "$n" = "0" ]; then
      record "Secret scan — reachable history" "PASS" "0 findings"
    elif [ ! -x "$(command -v node 2>/dev/null)" ]; then
      record "Secret scan — reachable history" "INCOMPLETE" \
             "${n} finding(s); node unavailable so they could not be reconciled"
    else
      # Findings exist. They are NOT allowlisted away — gitleaks detected every one and
      # they are all still in the report. Reconcile each against the opaque baseline.
      HIST_RECON="$REPORT_DIR/history-reconciliation.txt"
      node "$REPO_ROOT/scripts/security/history-scan-baseline-cli.mjs" history \
        "$REPORT_DIR/gitleaks-history.json" >"$HIST_RECON" 2>&1
      recon_rc=$?
      recon_status="$(grep -m1 '^STATUS=' "$HIST_RECON" | cut -d= -f2-)"
      recon_unexpected="$(grep -m1 '^UNEXPECTED=' "$HIST_RECON" | cut -d= -f2-)"
      case "$recon_status" in
        PASS_WITH_RESOLVED_BASELINE)
          record "Secret scan — reachable history" "BASELINE" \
                 "resolved baseline matched; unexpected=${recon_unexpected:-0}" ;;
        PASS)
          record "Secret scan — reachable history" "PASS" "unexpected=${recon_unexpected:-0}" ;;
        *)
          record "Secret scan — reachable history" "RED" \
                 "unexpected=${recon_unexpected:-?} reconciliation=${recon_status:-UNKNOWN} rc=$recon_rc" ;;
      esac
    fi
  else
    record "Secret scan — reachable history" "INCOMPLETE" "scan produced no report"
  fi
fi

# ---------------------------------------------------------------------------
# 5. Sensitive file hygiene
# ---------------------------------------------------------------------------
SENSITIVE_RE='(^|/)(pull-?secret(\.json|\.txt)?|auth\.json|config\.json|kubeconfig|\.kube/config|credentials|\.env(\..*)?|id_rsa|id_ecdsa|id_ed25519|.*\.pem|.*\.key|.*\.p12|.*\.pfx|.*\.keytab)$'
{ git ls-files; git ls-files --others --exclude-standard; } | sort -u > "$REPORT_DIR/all-paths.txt"
grep -iE "$SENSITIVE_RE" "$REPORT_DIR/all-paths.txt" > "$REPORT_DIR/sensitive-candidates.txt" 2>/dev/null

SENS_REAL=0
: > "$REPORT_DIR/sensitive-classified.txt"
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$f" ] || continue
  cls="REVIEW"
  if grep -qE -- "-----BEGIN [A-Z ]*PRIVATE KEY-----" "$f" 2>/dev/null; then
    cls="PRIVATE-KEY"
  elif grep -qE -- "-----BEGIN CERTIFICATE-----" "$f" 2>/dev/null; then
    cls="PUBLIC-CERT (not a private key)"
  elif grep -qE -- "^ssh-(rsa|ed25519|ecdsa)" "$f" 2>/dev/null; then
    cls="PUBLIC-SSH-KEY (not a private key)"
  fi
  echo "      $cls  $f" >> "$REPORT_DIR/sensitive-classified.txt"
  case "$cls" in PRIVATE-KEY|REVIEW) SENS_REAL=$((SENS_REAL+1)) ;; esac
done < "$REPORT_DIR/sensitive-candidates.txt"

if [ "$SENS_REAL" -eq 0 ]; then
  record "Sensitive untracked/tracked files" "PASS" "no private keys or credential files"
else
  record "Sensitive untracked/tracked files" "RED" "$SENS_REAL path(s) need classification"
fi

# ---------------------------------------------------------------------------
# 5b. Current-tree credential-artifact guard
#
# Because resolved history is retained rather than rewritten, the current tree is the
# boundary that matters. This fails if tracked source carries a credential-bearing
# cluster-import manifest, or an embedded kubeconfig with a real bearer token or
# private key.
#
# Content-aware on purpose: ordinary credential-free `kind: Secret` templates are NOT
# banned. A file is a finding only when it carries decodable credential material.
# ---------------------------------------------------------------------------
if have node; then
  TREE_GUARD="$REPORT_DIR/tree-credential-artifacts.txt"
  node "$REPO_ROOT/scripts/security/history-scan-baseline-cli.mjs" tree >"$TREE_GUARD" 2>&1
  tree_status="$(grep -m1 '^STATUS=' "$TREE_GUARD" | cut -d= -f2-)"
  tree_scanned="$(grep -m1 '^SCANNED=' "$TREE_GUARD" | cut -d= -f2-)"
  if [ "$tree_status" = "PASS" ]; then
    record "Current-tree credential artifacts" "PASS" "${tree_scanned} path(s); none found"
  else
    record "Current-tree credential artifacts" "RED" "see $TREE_GUARD"
  fi
else
  record "Current-tree credential artifacts" "INCOMPLETE" "node not installed (required)"
fi

# ---------------------------------------------------------------------------
# 6. Runtime credential canaries + security regression tests
# ---------------------------------------------------------------------------
run_node_test() { # label, dir, cmd...
  local label="$1"; shift
  local dir="$1"; shift
  ( cd "$dir" && "$@" ) >"$REPORT_DIR/test-$label.log" 2>&1
  return $?
}

# Each sub-gate is derived from the OUTCOME OF ITS OWN NAMED TESTS, not inferred from a
# single aggregate run. The previous version reported four statuses from one exit code,
# which is how "Default export PASS" was printed while a proxy credential was reaching
# the default export. A sub-gate whose tests did not demonstrably run is INCOMPLETE, not
# PASS.
BE_DATA="$(mktemp -d "$REPORT_DIR/backend-data.XXXXXX")"
NODE_ENV=test DATA_DIR="$BE_DATA" run_node_test backend-canary "$REPO_ROOT/backend" \
  node --test --test-concurrency=1 --test-reporter=tap test/credential-canary-surfaces.test.js
CANARY_RC=$?
CANARY_LOG="$REPORT_DIR/test-backend-canary.log"

# Map a named test (substring) to PASS / RED / INCOMPLETE from the TAP stream.
subgate() { # display-name, tap-substring
  local name="$1" needle="$2" line
  if [ ! -s "$CANARY_LOG" ]; then
    record "$name" "INCOMPLETE" "canary suite produced no output"; return
  fi
  # The TAP line for this specific test. Nested subtests are indented.
  line="$(grep -E "^[[:space:]]*(ok|not ok) " "$CANARY_LOG" | grep -F -- "$needle" | head -1)"
  if [ -z "$line" ]; then
    # The test proving this sub-gate did not run. Never PASS on absence.
    record "$name" "INCOMPLETE" "required test not found: $needle"; return
  fi
  case "$line" in
    *"not ok"*) record "$name" "RED"  "see $CANARY_LOG" ;;
    *)          record "$name" "PASS" "$needle" ;;
  esac
}

if [ "$CANARY_RC" -ne 0 ]; then
  # Any failure in the suite fails the umbrella outright; per-sub-gate detail follows.
  record "Credential persistence canaries" "RED" "see $CANARY_LOG"
else
  record "Credential persistence canaries" "PASS" "backend canary sweep (all assertions)"
fi
subgate "SQLite persistence"        "persists no canary to disk"
subgate "State API credential guard" "REJECTS a state carrying a credentials block"
subgate "Logs/error redaction"      "rejection body contains no credential canary"
subgate "Default export redaction"  "install-config carries NO credential canary"
subgate "Default export — proxy"    "proxy ENDPOINT is preserved"
subgate "Explicit opt-in export"    "explicit credential-inclusive export DOES carry"

if run_node_test frontend-canary "$REPO_ROOT/frontend" \
     npx vitest run tests/credential-canary-browser-storage.test.js; then
  record "Frontend browser storage" "PASS" "localStorage, sessionStorage, IndexedDB"
else
  record "Frontend browser storage" "RED" "see $REPORT_DIR/test-frontend-canary.log"
fi

if NODE_ENV=test DATA_DIR="$(mktemp -d "$REPORT_DIR/backend-data2.XXXXXX")" \
     run_node_test backend-secrets "$REPO_ROOT/backend" \
     node --test --test-concurrency=1 \
       test/state-secret-persistence.test.js test/security.test.js test/export-integrity.test.js; then
  record "Security regression tests" "PASS" "state-secret-persistence, security, export-integrity"
else
  record "Security regression tests" "RED" "see $REPORT_DIR/test-backend-secrets.log"
fi

# ---------------------------------------------------------------------------
# 7. Production dependency vulnerability gate
#    Policy: Critical BLOCK, High BLOCK, Moderate/Low report-only.
#    A nonzero npm exit caused only by Moderate/Low is NOT a gate failure.
# ---------------------------------------------------------------------------
audit_prod() { # label, dir
  local label="$1" dir="$2"
  local out="$REPORT_DIR/audit-$label.json"
  ( cd "$dir" && npm audit --omit=dev --json ) > "$out" 2>"$REPORT_DIR/audit-$label.err"
  if ! jq -e '.metadata.vulnerabilities' "$out" >/dev/null 2>&1; then
    record "${label^} prod dependencies" "INCOMPLETE" "audit did not produce severity data (offline?)"
    return
  fi
  local c h m l t
  c=$(jq -r '.metadata.vulnerabilities.critical // 0' "$out")
  h=$(jq -r '.metadata.vulnerabilities.high     // 0' "$out")
  m=$(jq -r '.metadata.vulnerabilities.moderate // 0' "$out")
  l=$(jq -r '.metadata.vulnerabilities.low      // 0' "$out")
  t=$(jq -r '.metadata.vulnerabilities.total    // 0' "$out")
  local detail="critical=$c high=$h moderate=$m low=$l total=$t"
  if [ "$c" -gt 0 ] || [ "$h" -gt 0 ]; then
    record "${label^} prod dependencies" "RED" "$detail"
  else
    record "${label^} prod dependencies" "PASS" "$detail"
  fi
}
audit_prod backend  "$REPO_ROOT/backend"
audit_prod frontend "$REPO_ROOT/frontend"

# ---------------------------------------------------------------------------
# 8. Container / base-image applicability
#    N/A only when no shipping-image surface changed, with diff evidence.
# ---------------------------------------------------------------------------
CHANGED="$(git diff --name-only HEAD; git ls-files --others --exclude-standard)"
IMAGE_SURFACE="$(printf '%s\n' "$CHANGED" | grep -iE '(^|/)(Containerfile|Dockerfile)|(^|/)(backend|frontend|shared)/package(-lock)?\.json$|^package(-lock)?\.json$|\.containerignore$|(^|/)entrypoint' || true)"
if [ -n "$IMAGE_SURFACE" ]; then
  if have trivy || have grype; then
    record "Container scan" "INCOMPLETE" "shipping-image surface changed; image scan not executed by this gate"
  else
    record "Container scan" "INCOMPLETE" "shipping-image surface changed and no image scanner installed"
  fi
else
  record "Container scan" "N/A" "no Containerfile/Dockerfile, base image, or production dependency/lockfile changed in this tranche"
fi

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
echo
echo "OAA Tranche Security Gate"
echo "========================="
echo "repo      : $REPO_ROOT"
echo "branch    : $BRANCH"
echo "HEAD      : $HEAD_SHA"
echo "dirty     : $DIRTY_MOD modified, $DIRTY_UNTRACKED untracked, $STAGED staged"
echo "tools     : gitleaks=$GITLEAKS_VER | node=$NODE_VER | npm=$NPM_VER"
echo "            trivy=$TRIVY_VER | grype=$GRYPE_VER"
echo "reports   : $REPORT_DIR"
echo

for i in "${!R_NAME[@]}"; do
  printf '%-36s %-10s %s\n' "${R_NAME[$i]}" "${R_STATUS[$i]}" "${R_DETAIL[$i]}"
  case "${R_STATUS[$i]}" in
    RED)
      case "${R_NAME[$i]}" in
        *"reachable history"*)
          # Only the reconciler's output, which lists UNEXPECTED findings and the
          # reasons it refused. Deliberately NOT the full finding list: dumping every
          # finding would republish exactly what the baseline covers.
          [ -f "${HIST_RECON:-}" ] && grep -E '^      ' "$HIST_RECON" ;;
        *"Secret scan"*)
          lbl="$(printf '%s' "${R_NAME[$i]}" | sed 's/.*— //; s/ .*//')"
          dump_findings "$lbl" ;;
        "Current-tree credential artifacts")
          [ -f "${TREE_GUARD:-}" ] && grep -E '^      ' "$TREE_GUARD" ;;
      esac
      [ -f "$REPORT_DIR/sensitive-classified.txt" ] && \
        [ "${R_NAME[$i]}" = "Sensitive untracked/tracked files" ] && \
        cat "$REPORT_DIR/sensitive-classified.txt" ;;
  esac
done

echo
if [ "$OVERALL_OK" -eq 1 ]; then
  echo "OVERALL: GREEN"
else
  echo "OVERALL: RED/INCOMPLETE"
fi

if [ -n "$JSON_OUT" ]; then
  {
    printf '{\n  "head": "%s",\n  "branch": "%s",\n  "timestamp": "%s",\n' "$HEAD_SHA" "$BRANCH" "$TS"
    printf '  "tools": {"gitleaks": "%s", "node": "%s", "npm": "%s"},\n' "$GITLEAKS_VER" "$NODE_VER" "$NPM_VER"
    printf '  "checks": [\n'
    for i in "${!R_NAME[@]}"; do
      sep=","; [ "$i" -eq $(( ${#R_NAME[@]} - 1 )) ] && sep=""
      printf '    {"name": %s, "status": "%s", "detail": %s}%s\n' \
        "$(jq -Rn --arg v "${R_NAME[$i]}" '$v')" "${R_STATUS[$i]}" \
        "$(jq -Rn --arg v "${R_DETAIL[$i]}" '$v')" "$sep"
    done
    printf '  ],\n  "overall": "%s"\n}\n' "$([ "$OVERALL_OK" -eq 1 ] && echo GREEN || echo RED/INCOMPLETE)"
  } > "$JSON_OUT"
  echo "JSON: $JSON_OUT"
fi

[ "$OVERALL_OK" -eq 1 ] && exit 0
exit 1
