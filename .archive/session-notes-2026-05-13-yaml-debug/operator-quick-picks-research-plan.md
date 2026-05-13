# Operator Quick Picks - Version-Aware Research & Implementation Plan

**Created:** 2026-05-11  
**Task:** DOC-063 - Expand operator scenario quick picks with subscription-based presets  
**Priority:** P2 (Phase 2B completion)  
**Estimated Time:** 2-3 days

---

## Objective

Add version-aware operator quick picks for subscription-based scenarios:
- OpenShift Data Foundation (ODF)
- OpenShift Platform Plus
- App Development Suite
- Other common subscription patterns

**Critical:** Operator dependencies vary significantly between OpenShift minor releases (4.16-4.21), so quick picks must be version-aware based on the user's locked-in version from Blueprint tab.

---

## Research Phase

### Step 1: Document Official Sources

Research official Red Hat OpenShift documentation for each version:

**Versions to research:** 4.16, 4.17, 4.18, 4.19, 4.20, 4.21

**Key subscription bundles:**

1. **OpenShift Data Foundation (ODF)**
   - Required operators
   - Optional/recommended operators
   - Dependencies that changed between versions

2. **OpenShift Platform Plus**
   - Core operators
   - Advanced Cluster Security (ACS)
   - Advanced Cluster Management (ACM)
   - Quay
   - OpenShift Data Foundation (nested)
   - Other components

3. **App Development Suite**
   - OpenShift Pipelines
   - OpenShift GitOps
   - Dev Spaces
   - Web Terminal
   - Other developer-focused operators

4. **Observability Stack**
   - Logging Operator (formerly EFK/ELK)
   - OpenShift Logging
   - Cluster Logging Operator
   - Elasticsearch Operator (deprecated in newer versions?)
   - Loki Operator (newer replacement?)

**Documentation URLs to check:**
- `https://docs.openshift.com/container-platform/4.{16-21}/storage/persistent_storage/persistent-storage-ocs.html`
- `https://docs.openshift.com/container-platform/4.{16-21}/installing/disconnected_install/installing-mirroring-installation-images.html`
- Red Hat subscription documentation
- ODF installation/prerequisites docs per version
- Platform Plus component lists per version

### Step 2: Create Version Dependency Matrix

Build a spreadsheet/table mapping:

| Quick Pick | OCP Version | Required Operators | Optional Operators | Notes |
|------------|-------------|-------------------|-------------------|-------|
| ODF | 4.16 | [...] | [...] | Changes from 4.15 |
| ODF | 4.17 | [...] | [...] | Changes from 4.16 |
| ... | ... | ... | ... | ... |
| Platform Plus | 4.16 | [...] | [...] | Bundle composition |
| ... | ... | ... | ... | ... |

**Key things to track:**
- Operator name (as it appears in catalog)
- Catalog source (redhat, certified, community)
- Whether required or optional
- Version-specific changes (deprecated, renamed, new)

### Step 3: Cross-Reference with Catalog Data

For each operator identified in research:
- Verify it exists in the catalog scans (redhat-operator-index, certified-operator-index)
- Note exact operator package name (may differ from display name)
- Document if operator was renamed or replaced between versions

---

## Implementation Phase

### Step 4: Design Data Structure

Create version-aware quick picks structure in OperatorsStep.jsx:

```javascript
// Option A: Nested by version
const versionAwareScenarios = {
  "4.16": [
    { id: "odf", label: "OpenShift Data Foundation", picks: { redhat: [...] } },
    // ...
  ],
  "4.17": [
    { id: "odf", label: "OpenShift Data Foundation", picks: { redhat: [...] } },
    // ...
  ],
  // ... other versions
};

// Option B: Version-mapping within scenario
const scenarios = [
  {
    id: "odf",
    label: "OpenShift Data Foundation",
    versionPicks: {
      "4.16": { redhat: [...], certified: [...] },
      "4.17": { redhat: [...], certified: [...] },
      "4.18": { redhat: [...], certified: [...] },
      "4.19": { redhat: [...], certified: [...] },
      "4.20": { redhat: [...], certified: [...] },
      "4.21": { redhat: [...], certified: [...] },
      "default": { redhat: [...] } // fallback for unknown versions
    }
  },
  {
    id: "platform-plus",
    label: "OpenShift Platform Plus",
    versionPicks: {
      "4.20": { redhat: ["odf-operator", "rhacs-operator", "advanced-cluster-management", ...] },
      "4.21": { redhat: [...] },
      "default": { redhat: [...] }
    }
  },
  // ... other scenarios
];
```

**Recommendation:** Use Option B (version-mapping within scenario) for better maintainability.

### Step 5: Update Selection Logic

Modify the quick pick handler to:
1. Get the locked-in OpenShift version from state (already available via `getOpenShiftMinorFromState(state)`)
2. Look up the scenario's `versionPicks[version]` or fall back to `versionPicks["default"]`
3. Select the correct operators for that version

```javascript
const handleScenarioClick = (scenario) => {
  const version = getOpenShiftMinorFromState(state) || "4.20";
  const picks = scenario.versionPicks?.[version] || scenario.versionPicks?.["default"] || scenario.picks;
  
  // ... rest of selection logic
};
```

### Step 6: Add Visual Indicators

Add version indicator to quick pick buttons:
- Show which version the quick pick will use
- Warn if version not locked in yet
- Show tooltip explaining version-aware behavior

Example UI enhancement:
```jsx
<button onClick={() => handleScenarioClick(scenario)}>
  {scenario.label}
  <span className="version-badge">{version}</span>
</button>
```

---

## Testing Phase

### Step 7: Create Tests

Add tests for version-aware quick picks:

**Test file:** `frontend/tests/operator-quick-picks-version-aware.test.js`

**Test cases:**
1. Selecting ODF quick pick with version 4.20 selects correct operators
2. Selecting ODF quick pick with version 4.21 selects different operators
3. Selecting Platform Plus with version 4.20 includes all required operators
4. Fallback to default when version not recognized
5. Warning shown when version not locked in
6. All operator names in quick picks actually exist in catalog (integration test)

### Step 8: Manual Validation

For each quick pick, verify:
- [ ] All operators in the list exist in catalog for that version
- [ ] No critical operators missing
- [ ] Deprecated operators excluded for newer versions
- [ ] Renamed operators handled correctly

---

## Documentation Phase

### Step 9: Code Documentation

Add comprehensive comments to the quick picks data structure:

```javascript
/**
 * Version-aware operator quick picks for common scenarios.
 * 
 * Each scenario has versionPicks mapping OpenShift minor version to operator lists.
 * Operator names must match the package names in the Red Hat/Certified catalogs.
 * 
 * Sources:
 * - ODF: https://docs.openshift.com/container-platform/4.{version}/storage/...
 * - Platform Plus: https://...
 * 
 * Maintenance notes:
 * - When adding a new OpenShift version, research operator dependencies for that version
 * - Check for deprecated/renamed/new operators
 * - Update all affected scenarios
 * - Test against actual catalog scan for that version
 */
```

### Step 10: User-Facing Documentation

Create/update documentation:

**File:** `docs/OPERATOR_QUICK_PICKS.md`

**Content:**
- What quick picks are available
- How version-aware selection works
- How to verify operators for a specific version
- How to add new quick picks
- Maintenance guide for new OpenShift versions

---

## Acceptance Criteria

- [ ] Research complete for ODF across 4.16-4.21
- [ ] Research complete for Platform Plus
- [ ] Research complete for App Dev Suite
- [ ] Version dependency matrix documented
- [ ] Data structure implemented in OperatorsStep.jsx
- [ ] Selection logic updated to use version
- [ ] Visual indicators added to UI
- [ ] Tests written and passing
- [ ] Manual validation complete
- [ ] Code documentation added
- [ ] User documentation created
- [ ] No regressions in existing quick picks
- [ ] Build passes
- [ ] Committed and pushed

---

## Risk Mitigation

**Risk:** Operator names vary or don't exist in catalog
- Mitigation: Cross-reference all names against actual catalog scans
- Mitigation: Add fallback handling for missing operators

**Risk:** Red Hat docs inconsistent or incomplete
- Mitigation: Use multiple sources (docs, subscription guides, community)
- Mitigation: Test against real catalog data

**Risk:** Version detection fails
- Mitigation: Always provide "default" fallback
- Mitigation: Show warning in UI if version not locked in

**Risk:** Maintenance burden for future versions
- Mitigation: Document process clearly
- Mitigation: Make data structure easy to update
- Mitigation: Consider future automation

---

## Next Actions

1. Begin research with ODF for 4.20 (current version)
2. Expand to 4.19, 4.21
3. Document findings in version matrix
4. Implement data structure
5. Test with real catalog data
6. Iterate and refine

---

**Status:** Plan created, ready to begin research phase
