#!/bin/bash
# scripts/find-hardcoded-versions.sh
# Versioned Copy Audit - Phase 0 Inventory
# Searches for hardcoded OpenShift version references in user-facing code

set -e

OUTPUT_DIR="versioned-copy-audit-results"
mkdir -p "$OUTPUT_DIR"

echo "============================================"
echo "Versioned Copy/Messaging/UX Text Audit"
echo "Phase 0: Inventory of Hardcoded Versions"
echo "============================================"
echo ""

# Search patterns
PATTERN='(4\.(20|21|22|23|24|25|26|27|28|29)|OCP 4\.|OpenShift 4\.|current version|this release|this version)'

echo "[1/8] Searching Frontend UI Code..."
grep -rn --include="*.jsx" --include="*.js" \
  -E "$PATTERN" \
  frontend/src/ 2>/dev/null | \
  grep -v "node_modules\|test\|\.test\." > "$OUTPUT_DIR/frontend-versions.txt" || echo "  No matches in frontend"

echo "[2/8] Searching Backend Code..."
grep -rn --include="*.js" \
  -E "$PATTERN" \
  backend/src/ 2>/dev/null | \
  grep -v "node_modules\|test\|\.test\." > "$OUTPUT_DIR/backend-versions.txt" || echo "  No matches in backend"

echo "[3/8] Searching Field Guide..."
grep -rn --include="*.js" \
  -E "$PATTERN" \
  backend/src/fieldGuide/ 2>/dev/null > "$OUTPUT_DIR/fieldguide-versions.txt" || echo "  No matches in field guide"

echo "[4/8] Searching Documentation..."
grep -rn --include="*.md" \
  -E "$PATTERN" \
  docs/ 2>/dev/null | \
  grep -v "BACKLOG_STATUS\|IMPLEMENTATION_ROADMAP\|CHANGELOG" > "$OUTPUT_DIR/docs-versions.txt" || echo "  No matches in docs"

echo "[5/8] Searching Validation Messages..."
grep -rn --include="*.js" --include="*.jsx" \
  -E '"[^"]*4\.(20|21|22)[^"]*"|"[^"]*OCP 4\.[^"]*"|"[^"]*OpenShift 4\.[^"]*"' \
  frontend/src/validation.js backend/src/validation.js 2>/dev/null > "$OUTPUT_DIR/validation-messages.txt" || echo "  No matches in validation"

echo "[6/8] Searching Tooltips and Hints..."
grep -rn --include="*.jsx" \
  -E 'hint=|tooltip=|FieldLabelWithInfo' \
  frontend/src/steps/ 2>/dev/null | \
  grep -E "$PATTERN" > "$OUTPUT_DIR/tooltip-versions.txt" || echo "  No matches in tooltips"

echo "[7/8] Searching Generated Artifacts (Templates)..."
grep -rn --include="*.js" \
  -E "$PATTERN" \
  backend/src/generate.js backend/src/fieldGuide/ 2>/dev/null > "$OUTPUT_DIR/generated-artifacts.txt" || echo "  No matches in generation"

echo "[8/8] Searching Docs Links in Code..."
grep -rn --include="*.js" --include="*.jsx" --include="*.json" \
  -E 'docs\.redhat\.com.*4\.(20|21|22)|docs\.openshift\.com.*4\.(20|21|22)' \
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
  echo ""
  echo "Next step: Review findings and create docs/VERSIONED_COPY_INVENTORY.md"
  echo "Classify each finding as:"
  echo "  - replace-with-locked: Replace with state.version.selectedMinor"
  echo "  - copy-map: Move to centralized version-aware copy map"
  echo "  - param-derived: Derive from catalog params metadata"
  echo "  - historical: Keep as historical/reference (OK to be static)"
  echo "  - version-neutral: Rewrite to be version-agnostic"
  echo "  - needs-verification: Requires docs/source check"
else
  echo "✅ No hardcoded version references found!"
fi

echo ""
echo "Audit complete: $(date)"
