#!/usr/bin/env bash
#
# Gitleaks configuration self-test.
#
# Proves two things a clean scan cannot prove on its own:
#
#   1. THE RULES ARE LIVE. A config without `[extend] useDefault = true` loads ZERO rules
#      and every scan passes vacuously. That was the real state of this repository until
#      the Tranche 1.5 security gate tested it: a GitHub PAT, a private key, a Slack bot
#      token and two generic API keys were all missed. A green scan meant nothing.
#
#   2. THE apiCommit EXCEPTION IS NARROW. The allowlist that suppresses the DOC-166
#      provenance Git SHA-1 must not suppress a real generic-api-key finding in another
#      field of the same file, in another file, with another value shape, or under
#      another rule.
#
# DETERMINISM. gitleaks' `generic-api-key` rule is ENTROPY-GATED, so a uniformly random
# alphanumeric string occasionally falls below threshold. An earlier revision of this
# script used plain random values and flaked between PASS and FAIL across runs. A
# security gate that flakes is barely better than one that silently passes, so every
# secret-shaped value here is generated with guaranteed character-class diversity.
#
# Every value is generated at RUNTIME into a temp directory: no realistic
# credential-shaped literal is committed, and no value is ever printed.
#
# Exit 0 = config behaves correctly. Nonzero = config is vacuous or over-broad.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG="$REPO_ROOT/.gitleaks.toml"
SCHEMA_REL="data/oc-mirror-v2/imageset-config-schema.json"
GEN="$(dirname "${BASH_SOURCE[0]}")/_selftest_fixtures.py"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks-selftest: gitleaks not installed - cannot verify configuration" >&2
  exit 2
fi
if [ ! -f "$CONFIG" ]; then
  echo "gitleaks-selftest: $CONFIG not found" >&2
  exit 2
fi
if [ ! -f "$GEN" ]; then
  echo "gitleaks-selftest: fixture generator $GEN not found" >&2
  exit 2
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/oaa-gitleaks-selftest.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

fail=0
note() { printf '  %-58s %s\n' "$1" "$2"; }

scan_rules() { # dir -> comma-joined unique rule IDs ("" if none)
  local dir="$1"
  local out="$dir/.selftest-report.json"
  gitleaks detect --source "$dir" --no-git --config "$CONFIG" --redact \
    --report-format json --report-path "$out" --exit-code 9 >/dev/null 2>&1
  if [ -f "$out" ]; then jq -r '[.[].RuleID] | unique | join(",")' "$out" 2>/dev/null; else echo ""; fi
}
scan_count() { # dir -> finding count, or ERR
  local dir="$1"
  local out="$dir/.selftest-report.json"
  gitleaks detect --source "$dir" --no-git --config "$CONFIG" --redact \
    --report-format json --report-path "$out" --exit-code 9 >/dev/null 2>&1
  if [ -f "$out" ]; then jq 'length' "$out" 2>/dev/null || echo ERR; else echo ERR; fi
}
# A negative control must DETECT something. Absent/ERR counts as failure, never success.
expect_detected() { # label, count
  local label="$1" n="$2"
  if [ -n "$n" ] && [ "$n" != "ERR" ] && [ "$n" != "0" ]; then
    note "$label" "PASS"
  else
    note "$label" "FAIL got=${n:-<none>} want>=1"
    fail=1
  fi
}

python3 -I "$GEN" "$WORK" "$REPO_ROOT/$SCHEMA_REL" || { echo "fixture generation failed" >&2; exit 2; }

# ---------------------------------------------------------------------------
# A. Rules are live. Asserted as DETECTOR COVERAGE rather than a finding count,
#    so the result does not depend on how many times a rule happens to match.
# ---------------------------------------------------------------------------
live_rules="$(scan_rules "$WORK/live")"
missing=""
for want in github-pat private-key slack-bot-token generic-api-key; do
  case ",$live_rules," in *",$want,"*) ;; *) missing="$missing $want" ;; esac
done
if [ -z "$missing" ]; then
  note "A. default rules are live (4 distinct detectors)" "PASS"
else
  note "A. default rules are live (4 distinct detectors)" "FAIL missing:$missing"
  echo "     -> .gitleaks.toml is not loading the default ruleset. Check [extend] useDefault." >&2
  fail=1
fi

# ---------------------------------------------------------------------------
# B. The real apiCommit provenance SHA is suppressed.
# ---------------------------------------------------------------------------
if [ -f "$REPO_ROOT/$SCHEMA_REL" ]; then
  n="$(scan_count "$WORK/fp")"
  if [ "$n" = "0" ]; then
    note "B. apiCommit provenance SHA suppressed" "PASS"
  else
    note "B. apiCommit provenance SHA suppressed" "FAIL got=$n want=0"
    fail=1
  fi
else
  note "B. apiCommit provenance SHA suppressed" "SKIP schema file absent"
fi

# ---------------------------------------------------------------------------
# C-F. Negative controls. Each must still be DETECTED, proving the exception is
#      scoped by rule AND path AND field AND value shape - not by any one alone.
# ---------------------------------------------------------------------------
expect_detected "C. synthetic key in another FIELD of same file detected" "$(scan_count "$WORK/neg1")"
expect_detected "D. apiCommit-named field in another PATH detected"       "$(scan_count "$WORK/neg2")"
expect_detected "E. non-40-hex value in real apiCommit field detected"    "$(scan_count "$WORK/neg3")"
expect_detected "F. different RULE in exempted path still detected"       "$(scan_count "$WORK/neg4")"
expect_detected "G. real secret in a stopword-bearing FILE still detected" "$(scan_count "$WORK/neg5")"
expect_detected "H. near-miss of an allowlisted stopword still detected"   "$(scan_count "$WORK/neg6")"

if [ "$fail" -eq 0 ]; then
  echo "  gitleaks configuration self-test: PASS"
  exit 0
fi
echo "  gitleaks configuration self-test: FAIL" >&2
exit 1
