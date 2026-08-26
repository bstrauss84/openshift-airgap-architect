#!/bin/bash
# scripts/find-hardcoded-versions.sh
# Versioned Copy Audit & Enforcement Guard
#
# Modes:
#   (no args)     Full audit — writes results to temp directory
#   --check       CI guard — exits nonzero for unclassified hardcoded version
#                 references in production frontend code
#   --self-test   Deterministic synthetic-fixture validation of the classifier.
#                 Creates fixtures in TMPDIR, runs through the exact filter
#                 chain used by --check, and asserts expected violations and
#                 exemptions. Exits nonzero on any assertion failure.
#
# Adjudication categories (each documented in docs/VERSIONED_COPY_INVENTORY.md):
#   INFRA   — version infrastructure (enumerated authority files, not directory-wide)
#   CDEFLT  — fallback defaults (getOpenShiftMinorFromState || "4.20")
#   COMMENT — JS code comments (// or /* or * continuation)
#   LOGIC   — version comparison code (isVersionGTE, compareVersions)
#   FMT     — format examples (e.g., must look like, placeholder)
#   THRESH  — PlatformSpecificsStep feature-introduction threshold notation (4.20+, 4.21+)
#   ENUMVAL — API enum values (baselineCapabilitySet)
#   VMAP    — OperatorsStep version-keyed data maps and format examples
#   VGATED  — PlatformSpecificsStep version-gated delta descriptions (isCatalogFieldVisible)
#
# Previously unexempted findings in NetworkingV2Step.jsx (10) and
# NodeDrawerAgentContent.jsx (1) have been resolved via production edits.

set -euo pipefail

MODE="audit"
if [ "${1:-}" = "--check" ]; then MODE="check"; fi
if [ "${1:-}" = "--self-test" ]; then MODE="self-test"; fi

# Detect OpenShift 4.x version references (4.20+ including any future minor)
SEARCH_PATTERN='4\.([0-9]{2,})'

# ---------------------------------------------------------------------------
# classify_raw — the single adjudication filter chain
#
# Reads raw grep output from stdin, applies every adjudication exclusion in
# sequence, and writes unclassified violations to stdout.  Both --check and
# --self-test call this function so the classifier is never duplicated.
# ---------------------------------------------------------------------------
classify_raw() {
  local f
  f=$(cat)

  [ -z "$f" ] && return 0

  # Step 2: INFRA — enumerated version infrastructure authority files
  # Each file is listed individually; new shared/ files are NOT auto-excluded.
  f=$(echo "$f" \
    | grep -v -E 'frontend/src/shared/(versionPolicy|catalogVersion|cincinnatiChannels|openShiftMinor|versionHelpers|trustBundlePolicy)\.js' \
    | grep -v -E 'frontend/src/(docsIndexResolver|catalogPaths|catalogFieldMeta|catalogResolver)\.js' \
    || true)
  [ -z "$f" ] && return 0

  # Step 3: CDEFLT — fallback defaults (getOpenShiftMinorFromState || "4.20")
  f=$(echo "$f" | grep -v -E "getOpenShiftMinor.*\|\|.*['\"]4\." || true)
  [ -z "$f" ] && return 0

  # Step 4: COMMENT — JS code comments (// or /* or * continuation)
  f=$(echo "$f" | grep -v -E ':\s*(//|/\*|\*\s)' || true)
  [ -z "$f" ] && return 0

  # Step 5: LOGIC — version comparison code in validation.js
  f=$(echo "$f" | grep -v -E \
    'validation\.js:.*(azureMinor|isVersionGTE|SUPPORTED_MINORS|compareVersions)' || true)
  [ -z "$f" ] && return 0

  # Step 6: FMT — format examples in validation messages and labels
  f=$(echo "$f" \
    | grep -v -E 'validation\.js:.*(e\.g\.|must look like)' \
    | grep -v -E 'BlueprintStep\.jsx:.*(placeholder=|e\.g\.|OCP 4\.[0-9]+ supported)' \
    | grep -v -E 'PlatformSpecificsStep\.jsx:.*(rhcos|RHCOS|different RHCOS than)' \
    || true)
  [ -z "$f" ] && return 0

  # Step 7: THRESH — PlatformSpecificsStep version threshold notation and deprecation notices
  # Enumerated versions: 4.11, 4.12, 4.13, 4.20, 4.21 only.
  # A new threshold like "4.30+" is NOT auto-exempted — it reaches the violation set.
  # Scoped to PlatformSpecificsStep only; new files using threshold notation are not auto-excluded.
  f=$(echo "$f" | grep -v -E 'PlatformSpecificsStep\.jsx:.*(4\.(11|12|13|20|21)\+|[Dd]eprecated.*4\.13|v4\.(11|12) /)' || true)
  [ -z "$f" ] && return 0

  # Step 8: ENUMVAL — API enum values (baselineCapabilitySet)
  # Pinned to PlatformSpecificsStep, the baselineCapabilityOptions variable,
  # and the specific adjudicated versions (v4.11, v4.12, v4.20).
  f=$(echo "$f" | grep -v -E 'PlatformSpecificsStep\.jsx:.*baselineCapabilityOptions.*v4\.(11|12|20)' || true)
  [ -z "$f" ] && return 0

  # Step 9: VMAP — OperatorsStep version-keyed data maps and format examples
  # Object keys like "4.20": { ... } (quoted version followed by colon),
  # counter-example "not OpenShift 4.20", and hint examples with minVersion/maxVersion.
  # The object-key pattern requires a trailing colon to avoid exempting arbitrary
  # user-facing strings that happen to contain a quoted 4.x version.
  f=$(echo "$f" | grep -v -E \
    'OperatorsStep\.jsx:.*("4\.[0-9]+"[[:space:]]*:|not OpenShift 4\.|minVersion|maxVersion)' || true)
  [ -z "$f" ] && return 0

  # Step 10: VGATED — PlatformSpecificsStep version-gated delta descriptions
  # Correctly shown only for the matching version via isCatalogFieldVisible.
  # Every phrase includes the specific adjudicated version (4.20 or 4.21).
  # "OpenShift 4.30 supports multiple node subnets" is NOT exempted.
  f=$(echo "$f" | grep -v -E \
    'PlatformSpecificsStep\.jsx:.*(required for OpenShift 4\.20|4\.20 supports only one node subnet|4\.21 supports multiple node subnet|must use OpenShift 4\.21|Remove extras to generate for 4\.20|OpenShift 4\.21 and later)' || true)
  [ -z "$f" ] && return 0

  # Return unclassified violations (strip blank lines)
  echo "$f" | grep -v '^$' || true
}

# ---------------------------------------------------------------------------
# --check: CI enforcement guard
# ---------------------------------------------------------------------------
if [ "$MODE" = "check" ]; then

  # Step 1: All version references in production frontend source, minus tests
  raw=$(grep -rn --include="*.jsx" --include="*.js" \
    -E "$SEARCH_PATTERN" \
    frontend/src/ 2>/dev/null \
    | grep -v -E '\.test\.|__tests__|/tests/' \
    || true)

  [ -z "$raw" ] && { echo "PASS: No version references found in frontend source."; exit 0; }

  # DOCSRC findings (lines 962, 1492, 3183, 4114, 4678, 4709, 5165) are RESOLVED:
  # version-neutral wording, threshold notation, or dynamic selectedMinor.
  # No exemption needed — these lines no longer match the search pattern.

  # NetworkingV2Step.jsx (10) and NodeDrawerAgentContent.jsx (1) findings are
  # RESOLVED via version-neutral wording and dynamic selectedMinor. No exemption needed.

  violations=$(echo "$raw" | classify_raw)

  if [ -n "$violations" ]; then
    count=$(echo "$violations" | wc -l | tr -d ' ')
    echo "FAIL: $count unclassified hardcoded version reference(s):"
    echo ""
    echo "$violations"
    echo ""
    echo "Each finding must be resolved (version-neutral, version-derived, or adjudicated)."
    echo "See docs/VERSIONED_COPY_INVENTORY.md for classification guidance."
    exit 1
  fi

  echo "PASS: No unclassified hardcoded version references in frontend production code."
  exit 0
fi

# ---------------------------------------------------------------------------
# --self-test: deterministic synthetic-fixture classifier validation
# ---------------------------------------------------------------------------
if [ "$MODE" = "self-test" ]; then

  SYNTH_DIR="${TMPDIR:-/tmp}/versioned-copy-self-test-$$"
  mkdir -p "$SYNTH_DIR/frontend/src/steps"
  mkdir -p "$SYNTH_DIR/frontend/src/shared"

  # --- Fixture: PlatformSpecificsStep.jsx ---
  # Lines prefixed EXEMPT_ must be classified (removed by filter chain).
  # Lines prefixed VIOLATE_ must survive as unclassified violations.
  cat > "$SYNTH_DIR/frontend/src/steps/PlatformSpecificsStep.jsx" << 'FIXTURE'
const EXEMPT_thresh_4_20 = "Subnet roles (OpenShift 4.20+):";
const EXEMPT_thresh_4_21 = "Confidential compute (OpenShift 4.21+).";
const EXEMPT_thresh_4_11 = "OpenShift 4.11+ uses a modular capability system";
const EXEMPT_thresh_4_13 = "required for some platforms in 4.13+";
const EXEMPT_deprecated = "Deprecated in OpenShift 4.13+ legacy";
const EXEMPT_deprecated_lc = "deprecated since OpenShift 4.13.";
const EXEMPT_vnot = "v4.11 / v4.12 / etc.:";
const EXEMPT_enumval = "baselineCapabilityOptions = ['None','v4.11','v4.12','v4.20','vCurrent']";
const EXEMPT_vgated_required = "required for OpenShift 4.20.";
const EXEMPT_vgated_multi = "4.21 supports multiple node subnets.";
const EXEMPT_vgated_must = "must use OpenShift 4.21.";
const EXEMPT_vgated_remove = "Remove extras to generate for 4.20.";
const EXEMPT_vgated_later = "OpenShift 4.21 and later.";
const EXEMPT_vgated_single = "4.20 supports only one node subnet.";
const EXEMPT_rhcos = "different RHCOS than 4.20";
const VIOLATE_thresh_future = "New feature (OpenShift 4.30+):";
const VIOLATE_thresh_4_22 = "New feature (OpenShift 4.22+):";
const VIOLATE_deprecated_future = "Deprecated in OpenShift 4.30+";
const VIOLATE_vgated_required_future = "required for OpenShift 4.30";
const VIOLATE_vgated_must_future = "must use OpenShift 4.30";
const VIOLATE_vgated_later_future = "OpenShift 4.30 and later";
const VIOLATE_userfacing = "OpenShift 4.30 introduces new lifecycle";
const VIOLATE_subnet_future = "OpenShift 4.30 supports multiple node subnets";
const VIOLATE_enumval_future = "baselineCapability v4.30 is new";
FIXTURE

  # --- Fixture: OperatorsStep.jsx ---
  cat > "$SYNTH_DIR/frontend/src/steps/OperatorsStep.jsx" << 'FIXTURE'
const EXEMPT_map_key = { "4.20": { redhat: ["ocs-operator"] } };
const EXEMPT_map_key2 = { "4.21": { redhat: ["ocs-operator"] } };
const EXEMPT_not_ocp = "not OpenShift 4.20 lifecycle";
const EXEMPT_minver = "minVersion: 4.20";
const VIOLATE_quoted_copy = "Requires OpenShift 4.30 or later";
FIXTURE

  # --- Fixture: validation.js (LOGIC + FMT exemptions) ---
  cat > "$SYNTH_DIR/frontend/src/validation.js" << 'FIXTURE'
const EXEMPT_logic = isVersionGTE("4.20", selectedMinor);
const EXEMPT_fmt = "e.g. 4.20, 4.21";
FIXTURE

  # --- Fixture: BlueprintStep.jsx (FMT exemption) ---
  cat > "$SYNTH_DIR/frontend/src/steps/BlueprintStep.jsx" << 'FIXTURE'
const EXEMPT_placeholder = 'placeholder="4.21"';
FIXTURE

  # --- Fixture: shared/versionPolicy.js (INFRA exemption) ---
  cat > "$SYNTH_DIR/frontend/src/shared/versionPolicy.js" << 'FIXTURE'
const EXEMPT_infra = SUPPORTED_MINORS = ["4.20", "4.21"];
FIXTURE

  # --- Fixture: SomeNewStep.jsx (CDEFLT + COMMENT exemptions) ---
  cat > "$SYNTH_DIR/frontend/src/steps/SomeNewStep.jsx" << 'FIXTURE'
const EXEMPT_cdeflt = getOpenShiftMinorFromState(state) || "4.20";
  // EXEMPT_comment: This supports OpenShift 4.20 and 4.21
const VIOLATE_new_step_copy = "Requires OpenShift 4.30 for full support";
FIXTURE

  # --- Grep the synthetic tree exactly as --check does ---
  raw=$(grep -rn --include="*.jsx" --include="*.js" \
    -E "$SEARCH_PATTERN" \
    "$SYNTH_DIR/frontend/src/" 2>/dev/null \
    | grep -v -E '\.test\.|__tests__|/tests/' \
    || true)

  # Rewrite paths: strip SYNTH_DIR prefix so classify_raw sees "frontend/src/..."
  raw=$(echo "$raw" | sed "s|$SYNTH_DIR/||g")

  # --- Run through the exact same classifier ---
  violations=$(echo "$raw" | classify_raw)

  # --- Assertion harness ---
  pass_count=0
  fail_count=0
  total_count=0

  assert_violation() {
    local label="$1"
    total_count=$((total_count + 1))
    if echo "$violations" | grep -q "$label"; then
      echo "  PASS [violation]: $label correctly caught"
      pass_count=$((pass_count + 1))
    else
      echo "  FAIL [violation]: $label was exempted but must be a violation"
      fail_count=$((fail_count + 1))
    fi
  }

  assert_exemption() {
    local label="$1"
    total_count=$((total_count + 1))
    if echo "$violations" | grep -q "$label"; then
      echo "  FAIL [exemption]: $label appeared in violations but must be exempted"
      fail_count=$((fail_count + 1))
    else
      echo "  PASS [exemption]: $label correctly exempted"
      pass_count=$((pass_count + 1))
    fi
  }

  echo "=== Versioned Copy Classifier Self-Test ==="
  echo ""

  # Must-violate assertions (future-version / unrelated user-facing copy)
  echo "Violation assertions (must be caught by classifier):"
  assert_violation "VIOLATE_thresh_future"
  assert_violation "VIOLATE_thresh_4_22"
  assert_violation "VIOLATE_deprecated_future"
  assert_violation "VIOLATE_vgated_required_future"
  assert_violation "VIOLATE_vgated_must_future"
  assert_violation "VIOLATE_vgated_later_future"
  assert_violation "VIOLATE_userfacing"
  assert_violation "VIOLATE_subnet_future"
  assert_violation "VIOLATE_enumval_future"
  assert_violation "VIOLATE_quoted_copy"
  assert_violation "VIOLATE_new_step_copy"
  echo ""

  # Must-exempt assertions (reviewed 4.20/4.21 exclusions)
  echo "Exemption assertions (must be classified by filter chain):"
  assert_exemption "EXEMPT_thresh_4_20"
  assert_exemption "EXEMPT_thresh_4_21"
  assert_exemption "EXEMPT_thresh_4_11"
  assert_exemption "EXEMPT_thresh_4_13"
  assert_exemption "EXEMPT_deprecated"
  assert_exemption "EXEMPT_deprecated_lc"
  assert_exemption "EXEMPT_vnot"
  assert_exemption "EXEMPT_enumval"
  assert_exemption "EXEMPT_vgated_required"
  assert_exemption "EXEMPT_vgated_multi"
  assert_exemption "EXEMPT_vgated_must"
  assert_exemption "EXEMPT_vgated_remove"
  assert_exemption "EXEMPT_vgated_later"
  assert_exemption "EXEMPT_vgated_single"
  assert_exemption "EXEMPT_rhcos"
  assert_exemption "EXEMPT_map_key"
  assert_exemption "EXEMPT_map_key2"
  assert_exemption "EXEMPT_not_ocp"
  assert_exemption "EXEMPT_minver"
  assert_exemption "EXEMPT_logic"
  assert_exemption "EXEMPT_fmt"
  assert_exemption "EXEMPT_placeholder"
  assert_exemption "EXEMPT_infra"
  assert_exemption "EXEMPT_cdeflt"
  assert_exemption "EXEMPT_comment"
  echo ""

  # Structural: guard must exit nonzero (violations exist)
  total_count=$((total_count + 1))
  if [ -n "$violations" ]; then
    echo "  PASS [structural]: classifier returned violations"
    pass_count=$((pass_count + 1))
  else
    echo "  FAIL [structural]: classifier returned no violations"
    fail_count=$((fail_count + 1))
  fi

  # Structural: violation count must match expected
  total_count=$((total_count + 1))
  if [ -n "$violations" ]; then
    vcount=$(echo "$violations" | wc -l | tr -d ' ')
  else
    vcount=0
  fi
  if [ "$vcount" -eq 11 ]; then
    echo "  PASS [structural]: exactly 11 violations found"
    pass_count=$((pass_count + 1))
  else
    echo "  FAIL [structural]: expected 11 violations, got $vcount"
    fail_count=$((fail_count + 1))
  fi

  echo ""
  echo "Results: $pass_count passed, $fail_count failed ($total_count total)"

  if [ $fail_count -gt 0 ]; then
    echo ""
    echo "Violation output for diagnosis:"
    echo "$violations"
    echo ""
    echo "SELF-TEST FAILED"
    exit 1
  fi

  echo "SELF-TEST PASSED"
  exit 0
fi

# ---------------------------------------------------------------------------
# Audit mode (default): full inventory scan
# ---------------------------------------------------------------------------

OUTPUT_DIR="${OAA_SUPERVISOR_SCRATCH:-${TMPDIR:-/tmp}}/versioned-copy-audit-results"
mkdir -p "$OUTPUT_DIR"

echo "============================================"
echo "Versioned Copy/Messaging/UX Text Audit"
echo "============================================"
echo ""
echo "Results directory: $OUTPUT_DIR"
echo ""

BROAD_PATTERN='(4\.([0-9]{2,})|OCP 4\.|OpenShift 4\.|current version|this release|this version)'

echo "[1/8] Searching Frontend UI Code..."
grep -rn --include="*.jsx" --include="*.js" \
  -E "$BROAD_PATTERN" \
  frontend/src/ 2>/dev/null | \
  grep -v "node_modules\|test\|\.test\." > "$OUTPUT_DIR/frontend-versions.txt" || echo "  No matches in frontend"

echo "[2/8] Searching Backend Code..."
grep -rn --include="*.js" \
  -E "$BROAD_PATTERN" \
  backend/src/ 2>/dev/null | \
  grep -v "node_modules\|test\|\.test\." > "$OUTPUT_DIR/backend-versions.txt" || echo "  No matches in backend"

echo "[3/8] Searching Field Guide..."
grep -rn --include="*.js" \
  -E "$BROAD_PATTERN" \
  backend/src/fieldGuide/ 2>/dev/null > "$OUTPUT_DIR/fieldguide-versions.txt" || echo "  No matches in field guide"

echo "[4/8] Searching Documentation..."
grep -rn --include="*.md" \
  -E "$BROAD_PATTERN" \
  docs/ 2>/dev/null | \
  grep -v "BACKLOG_STATUS\|IMPLEMENTATION_ROADMAP\|CHANGELOG" > "$OUTPUT_DIR/docs-versions.txt" || echo "  No matches in docs"

echo "[5/8] Searching Validation Messages..."
grep -rn --include="*.js" --include="*.jsx" \
  -E '"[^"]*4\.([0-9]{2,})[^"]*"|"[^"]*OCP 4\.[^"]*"|"[^"]*OpenShift 4\.[^"]*"' \
  frontend/src/validation.js backend/src/validation.js 2>/dev/null > "$OUTPUT_DIR/validation-messages.txt" || echo "  No matches in validation"

echo "[6/8] Searching Tooltips and Hints..."
grep -rn --include="*.jsx" \
  -E 'hint=|tooltip=|FieldLabelWithInfo' \
  frontend/src/steps/ 2>/dev/null | \
  grep -E "$BROAD_PATTERN" > "$OUTPUT_DIR/tooltip-versions.txt" || echo "  No matches in tooltips"

echo "[7/8] Searching Generated Artifacts (Templates)..."
grep -rn --include="*.js" \
  -E "$BROAD_PATTERN" \
  backend/src/generate.js backend/src/fieldGuide/ 2>/dev/null > "$OUTPUT_DIR/generated-artifacts.txt" || echo "  No matches in generation"

echo "[8/8] Searching Docs Links in Code..."
grep -rn --include="*.js" --include="*.jsx" --include="*.json" \
  -E 'docs\.redhat\.com.*4\.([0-9]{2,})|docs\.openshift\.com.*4\.([0-9]{2,})' \
  frontend/src/ backend/src/ data/ 2>/dev/null > "$OUTPUT_DIR/docs-links.txt" || echo "  No matches in docs links"

echo ""
echo "============================================"
echo "Summary"
echo "============================================"

total_findings=0
for file in "$OUTPUT_DIR"/*.txt; do
  if [ -f "$file" ]; then
    count=$(wc -l < "$file" 2>/dev/null || echo "0")
    filename=$(basename "$file")
    printf "%-30s %5d findings\n" "$filename" "$count"
    total_findings=$((total_findings + count))
  fi
done

echo "--------------------------------------------"
printf "%-30s %5d findings\n" "TOTAL" "$total_findings"
echo ""

if [ $total_findings -gt 0 ]; then
  echo "Results saved to: $OUTPUT_DIR/"
else
  echo "No hardcoded version references found."
fi

echo ""
echo "Audit complete: $(date)"
