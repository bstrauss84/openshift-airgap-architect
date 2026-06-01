# Versioned Copy/Messaging/UX Text Inventory

**Generated:** 2026-05-29  
**Tool:** `scripts/find-hardcoded-versions.sh`  
**Phase:** v2.0.0 Phase 0 (DOC-106)  
**Total Findings:** 3,239

---

## Summary

| Category | Count | Priority |
|----------|-------|----------|
| Frontend UI | 85 | HIGH |
| Backend | 146 | MEDIUM |
| Field Guide | 126 | HIGH |
| Validation Messages | 5 | HIGH |
| Tooltips | 3 | HIGH |
| Docs Links in Code | 1,912 | LOW (mostly catalog citations) |
| Generated Artifacts | 138 | MEDIUM |
| Documentation | 824 | LOW (intentionally versioned docs) |

---

## Classification Legend

- **replace-with-locked**: Replace with `state.version.selectedMinor` or version utility
- **copy-map**: Move to centralized version-aware copy map (`shared/versionedCopy.js`)
- **param-derived**: Derive from catalog params metadata (versionNotes, etc.)
- **historical**: Keep as historical/reference (OK to be static - comments, docs)
- **version-neutral**: Rewrite to be version-agnostic
- **needs-verification**: Requires docs/source check before decision

---

## Critical Findings Requiring Phase 1 Action

### HIGH PRIORITY: User-Facing Text (Must adapt to locked version)

| File | Line | Snippet | Classification | Phase 1 Action |
|------|------|---------|----------------|----------------|
| `frontend/src/validation.js` | 794 | `"Nutanix IPI requires credentialsMode Manual (OpenShift 4.20...)"` | replace-with-locked | Use `${version}` in error message |
| `frontend/src/validation.js` | 801 | `"...per OpenShift 4.20 Nutanix install-config parameters."` | replace-with-locked | Use `${version}` |
| `frontend/src/validation.js` | 1186-1192 | `"IBM Cloud ... in OpenShift 4.20 is documented as IPv4 only."` (3 instances) | replace-with-locked | Use `${version}` |
| `frontend/src/components/AboutModal.jsx` | 125 | Hardcoded docs link to 4.20 | copy-map | Use `getDocsUrlForVersion()` |
| `frontend/src/steps/TrustProxyStep.jsx` | 971 | `"(OpenShift 4.20)"` in UI text | replace-with-locked | Use `${version}` |
| `frontend/src/steps/GlobalStrategyStep.jsx` | 1395 | `"(OpenShift 4.20 default..."` | replace-with-locked | Use `${version}` |
| `frontend/src/steps/HostInventoryStep.jsx` | 660, 701 | `"4.20"` in UI labels | replace-with-locked | Use `${version}` |

**Total HIGH Priority**: ~15-20 user-facing strings requiring Phase 1 updates

---

### MEDIUM PRIORITY: Version-Specific Logic (Already correct pattern!)

| File | Lines | Pattern | Classification | Phase 1 Action |
|------|-------|---------|----------------|----------------|
| `frontend/src/steps/OperatorsStep.jsx` | 84-127 | ODF Quick Pick version maps (`"4.20": {...}, "4.21": {...}`) | historical | **KEEP AS-IS** - Already version-aware! This is CORRECT pattern for version-specific operator lists. |

**Note**: OperatorsStep.jsx already implements version-specific operator mappings correctly. This is the TARGET pattern for Phase 1.

---

### LOW PRIORITY: Docs Links (Catalog citations)

| Category | Count | Classification | Phase 1 Action |
|----------|-------|----------------|----------------|
| Catalog `citations` fields | ~1,900 | historical | KEEP - catalog citations are version-specific by design. When 4.21 catalogs added, they'll have 4.21 citations. |

**Note**: Most "docs-links.txt" findings are catalog JSON citations pointing to version-specific docs. This is CORRECT and intentional.

---

### LOW PRIORITY: Field Guide (Version-specific by compartment)

| File | Pattern | Classification | Phase 1 Action |
|------|---------|----------------|----------------|
| `backend/src/fieldGuide/v4.20/*.js` | `"OpenShift 4.20"` references | historical | KEEP - field guide v4.20 SHOULD reference 4.20. When v4.21 added, it will reference 4.21. Compartmentalization is CORRECT. |

**Note**: Field guide already uses version subdirectories (`v4.20/`). References to "4.20" in v4.20 compartments are correct.

---

## Detailed Analysis by Category

### 1. Frontend Validation Messages (5 findings) - **ACTION REQUIRED**

All 5 validation error messages hardcode "OpenShift 4.20":

```javascript
// BEFORE (hardcoded):
errors.push("IBM Cloud install-config networking in OpenShift 4.20 is documented as IPv4 only.");

// AFTER (Phase 1 - version-aware):
const version = state.version?.selectedMinor || "4.20";
errors.push(`IBM Cloud install-config networking in OpenShift ${version} is documented as IPv4 only.`);
```

**Phase 1 Implementation**: Update `frontend/src/validation.js` lines 794, 801, 1186, 1189, 1192 to use template literals with version variable.

---

### 2. Frontend UI Text (8-10 findings) - **ACTION REQUIRED**

User-visible text in step components mentioning "OpenShift 4.20" or "(4.20)":

```jsx
// BEFORE (hardcoded):
<span>Per-disk rootDeviceHints values (4.20)</span>

// AFTER (Phase 1 - version-neutral):
<span>Per-disk rootDeviceHints values</span>
// OR if version context is needed:
<span>Per-disk rootDeviceHints values (OpenShift {state.version?.selectedMinor || "4.20"})</span>
```

**Phase 1 Implementation**: 
- Lines can be made version-neutral (remove version reference entirely if not needed)
- OR use version-aware copy helper: `{getCopyForVersion("rootDeviceHints-label", version)}`

---

### 3. Tooltips (3 findings) - **REVIEW NEEDED**

Three tooltip instances mentioning specific versions:

1. **Line 676 (PlatformSpecificsStep)**: `"...OpenShift 4.20+)..."` - Change to version-neutral "recent OpenShift versions" or param-derived
2. **Line 2386 (Nutanix endpoint hint)**: Version compatibility note - Change to version-neutral language
3. **Line 4288 (vSphere legacy resource pool)**: `"not recommended for OpenShift 4.20+"` - Change to "recent OpenShift versions"

**Phase 1 Implementation**: Rewrite tooltips to be version-neutral or use param `versionNotes` field

---

### 4. Docs Links (1,912 findings) - **MOSTLY OK**

**Breakdown:**
- ~1,900: Catalog `citations` fields with version-specific docs URLs (CORRECT - keep as-is)
- ~12: Hardcoded docs links in frontend components (ACTION REQUIRED)

**Example ACTION REQUIRED**:
```javascript
// BEFORE (AboutModal.jsx line 125):
href="https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/index"

// AFTER (Phase 1):
import { getDocsUrlForVersion } from '../shared/docsLinks';
href={getDocsUrlForVersion("installing", state.version?.selectedMinor || "4.20")}
```

**Phase 1 Implementation**: Create `shared/docsLinks.js` helper, update ~12 hardcoded docs links

---

### 5. Field Guide (126 findings) - **MOSTLY OK**

**Pattern**: `backend/src/fieldGuide/v4.20/` files reference "OpenShift 4.20" or "4.20"

**Classification**: historical/correct - Field guide uses version subdirectories. References to 4.20 in v4.20 compartments are intentional.

**Phase 1 Action**: Minimal - ensure field guide template system uses `{{version}}` placeholders for rendering

---

### 6. Operators Quick Picks (Version-aware already!) - **CORRECT PATTERN**

`frontend/src/steps/OperatorsStep.jsx` lines 84-127:

```javascript
const ODF_BASE_OPERATORS = {
  "4.20": { redhat: ["ocs-operator", "odf-operator", ...] },
  "4.21": { redhat: ["ocs-operator", "odf-operator", ...] }
};
```

**Classification**: historical/correct - This is ALREADY the target pattern for version-specific logic.

**Phase 1 Action**: NONE - use this as reference implementation for other version-specific features

---

## Phase 1 Implementation Plan Summary

### Must Address (HIGH Priority)

1. **5 validation error messages** in `frontend/src/validation.js`
   - Lines: 794, 801, 1186, 1189, 1192
   - Pattern: Template literals with `${version}` variable

2. **8-10 UI text strings** in step components
   - Files: TrustProxyStep.jsx, GlobalStrategyStep.jsx, HostInventoryStep.jsx, BlueprintStep.jsx
   - Pattern: Version-neutral rewrites OR template literals

3. **3 tooltip instances** with version references
   - File: PlatformSpecificsStep.jsx
   - Pattern: Version-neutral language

4. **~12 hardcoded docs links** in frontend components
   - Files: AboutModal.jsx, various steps
   - Pattern: `shared/docsLinks.js` helper with `getDocsUrlForVersion()`

### Keep As-Is (Correct Patterns)

1. **Catalog citations** (1,900+ findings) - Version-specific by design
2. **Field guide v4.20 references** - Correct (compartmentalized by version)
3. **OperatorsStep version maps** - Correct pattern (reference implementation)

### Estimated Phase 1 Effort

- Validation messages: 30 min
- UI text strings: 1-2 hours
- Tooltips: 1 hour
- Docs links helper + updates: 2 hours
- Testing: 2 hours
- **Total**: ~6-8 hours

---

## CI Enforcement Strategy (Phase 1)

Create `.github/workflows/validate-versioned-copy.yml`:

```yaml
- name: Block hardcoded 4.20 in user-facing code
  run: |
    FORBIDDEN=$(grep -rn --include="*.jsx" --include="*.js" \
      -E '".*OpenShift 4\.20.*"|".*4\.20.*"' \
      frontend/src/steps/ frontend/src/validation.js \
      --exclude-dir=tests \
      | grep -v "ILLUSTRATIVE\|test\|OperatorsStep.jsx" || true)
    
    if [ -n "$FORBIDDEN" ]; then
      echo "ERROR: Hardcoded 4.20 found:"
      echo "$FORBIDDEN"
      exit 1
    fi
```

**Exceptions allowed:**
- `OperatorsStep.jsx` (version maps are correct pattern)
- Test files
- Comments marked ILLUSTRATIVE

---

## Recommendations for Phase 1

1. **Start with validation messages** (5 quick wins, high user impact)
2. **Create `shared/versionedCopy.js`** and `shared/docsLinks.js` utilities early
3. **Use OperatorsStep.jsx version maps as reference** for other version-specific logic
4. **Write tests first** for version-aware copy behavior
5. **Enable CI enforcement** after cleanup to prevent regressions

---

## Files for Phase 1 Update

### Must Edit
1. `frontend/src/validation.js` (5 error messages)
2. `frontend/src/steps/TrustProxyStep.jsx` (1 UI text)
3. `frontend/src/steps/GlobalStrategyStep.jsx` (1 UI text)
4. `frontend/src/steps/HostInventoryStep.jsx` (2 UI texts)
5. `frontend/src/steps/PlatformSpecificsStep.jsx` (3 tooltips, ~8 docs links)
6. `frontend/src/steps/BlueprintStep.jsx` (comments only - low priority)
7. `frontend/src/components/AboutModal.jsx` (1 docs link)

### Must Create
1. `shared/versionedCopy.js` - Centralized copy map
2. `shared/docsLinks.js` - Version-aware docs URL builder
3. `.github/workflows/validate-versioned-copy.yml` - CI enforcement

---

## Status

- ✅ Phase 0 Inventory Complete
- ⏳ Phase 1 Implementation Pending
- ⏳ CI Enforcement Pending
- ⏳ Test Coverage Pending

**Next Step**: Begin Phase 1 implementation starting with validation messages (quick wins)

---

**Generated:** 2026-05-29  
**Tool:** `scripts/find-hardcoded-versions.sh`  
**Raw Results:** `versioned-copy-audit-results/` (8 files, 3,239 findings)
