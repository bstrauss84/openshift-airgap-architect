# Tooltip Expansion Master Plan

**Last Updated:** 2026-05-09 (Batch 15 complete)
**Current Status:** 73/174 tooltips expanded (~42%)
**Current Batch:** Batch 16 (ready to start)

---

## Executive Summary

This document tracks the comprehensive tooltip expansion initiative for PlatformSpecificsStep.jsx. The goal is to expand all 174 hint attributes from brief catalog descriptions to comprehensive, formatted explanations that meet the "uninformed idiot test" - a complete beginner should understand what to enter, why it's needed, when to use it, and see examples.

### Quality Standards

Each tooltip MUST:
1. ✅ Never just repeat the field label
2. ✅ Explain WHAT to enter (format, examples, expected values)
3. ✅ Explain WHY it's needed (purpose, impact on deployment)
4. ✅ Explain WHEN to use it (scenarios where required vs. optional)
5. ✅ Provide examples (real-world values)
6. ✅ Use beginner-friendly language (no unexplained jargon)

### Formatting Standard (NEW - Applied from Batch 4 onward)

```
Brief one-line description.

**What is [concept]:**
Explanation paragraph.

**Options/Values:** (if applicable)
• Option 1: Description
• Option 2: Description

**When to use:**
Guidance paragraph or bulleted list.

**Requirements:** (if applicable)
1. Requirement one
2. Requirement two

**Important notes:**
• Critical consideration one
• Critical consideration two

**Example:**
Concrete example values
```

---

## Overall Progress

| Metric | Count | Percentage |
|--------|-------|------------|
| **Total Tooltips** | 174 | 100% |
| **Expanded** | 73 | 42% |
| **Remaining** | 101 | 58% |

### Completion by Section

| Platform/Section | Expanded | Remaining | % Complete |
|------------------|----------|-----------|------------|
| AWS GovCloud IPI | ~12 | ~8 | ~60% |
| vSphere IPI/UPI | ~15 | ~10 | ~60% |
| Azure Government | ~6 | ~4 | ~60% |
| IBM Cloud | ~10 | ~5 | ~67% |
| Nutanix IPI | ~8 | ~2 | ~80% |
| Bare Metal IPI | ~8 | ~15 | ~35% |
| Advanced/Global | ~12 | ~8 | ~60% |

---

## Batches Completed

### ✅ Batch 1-10: Initial Expansions (Commits: 0e3fe69 - aae60e3)
**Count:** 58 tooltips
**Status:** Content complete, but need REFORMATTING to new structured format
**Note:** These were expanded before the structured formatting standard was established

### ✅ Batch 11: Nutanix IPI Fields (Commit: 4aa9b91)
**Count:** 3 tooltips (61/174 total)
**Fields:**
- ✅ platform.nutanix.subnet (UUID/name, required)
- ✅ platform.vsphere machine pool fields (worker zones)

**Validation:** All consistent with catalog

### ✅ Batch 12: Bare Metal Provisioning (Commit: c8e6b49)
**Count:** 3 tooltips (66/174 total)
**Fields:**
- ✅ platform.baremetal.provisioningDHCPRange
- ✅ platform.baremetal.provisioningMACAddress  
- ✅ capabilities.additionalEnabledCapabilities

**Validation:** All consistent with catalog

### ✅ Batch 13: Bare Metal Provisioning Network (Commit: efb8de2)
**Count:** 3 tooltips (69/174 total)
**Fields:**
- ✅ platform.baremetal.provisioningNetworkCIDR
- ✅ platform.baremetal.provisioningNetworkInterface
- ✅ platform.baremetal.clusterProvisioningIP

**Validation:** All consistent with catalog (including "third IP" default)

### ✅ Batch 14: vSphere Legacy Deprecated (Commit: 47bc061)
**Count:** 2 tooltips (71/174 total)
**Fields:**
- ⚠️ platform.vsphere.folder (deprecated - not in catalog)
- ⚠️ platform.vsphere.resourcePool (deprecated - not in catalog)

**Validation:** Deprecated fields not in catalog (expected)

### ✅ JSX Parsing Fix (Commit: 50fb3fd)
**Issue:** Long hint strings with special characters (quotes, backslashes, backticks) caused JSX/Babel parsing errors
**Solution:** Converted all 46 hint attributes from `hint="..."` to `hint={\`...\`}` with proper escaping
**Test:** Created hint-syntax.test.js to prevent regression
**Status:** Build passing, all tests green

### ✅ Batch 15: IBM Cloud VPC & vSphere Networks (Commit: pending)
**Count:** 2 tooltips (73/174 total)
**Fields:**
- ✅ platform.ibm deployment VPC mode (UI-only control field, not in catalog)
- ✅ platform.vsphere.failureDomains[].topology.networks

**Validation:** vSphere networks consistent with catalog; IBM VPC mode is UI control field (N/A)

---

## Remaining Work

### Phase 1: Complete Initial Expansion (Target: 174/174)

#### Batch 16+: Remaining Fields (101 tooltips)

**High Priority - Bare Metal IPI (estimated ~15 fields):**
- [ ] platform.baremetal.bootstrapProvisioningIP
- [ ] platform.baremetal.externalBridge
- [ ] platform.baremetal.provisioningBridge
- [ ] platform.baremetal.hosts[] fields (BMC details, boot MAC, etc.)
- [ ] Others to be identified

**Medium Priority - AWS/vSphere/Azure/IBM (estimated ~40 fields):**
- [ ] Remaining AWS optional params (serviceEndpoints, userTags, publicIpv4Pool, etc.)
- [ ] Remaining vSphere fields (vCenter server, datacenter, datastore when not using FD)
- [ ] Azure remaining fields
- [ ] IBM Cloud remaining fields

**Lower Priority - Advanced/Global (estimated ~20 fields):**
- [ ] Remaining capability/hyperthreading/partitioning fields
- [ ] Any other advanced configuration options

**To Identify (~28 fields):**
- Systematic audit of PlatformSpecificsStep.jsx needed to identify all remaining short hints

---

### Phase 2: Reformat Earlier Batches (58 tooltips)

**Goal:** Apply the structured formatting standard to Batches 1-10

**Effort:** ~5-10 hours total (5-10 min per tooltip)

**Priority:** P2 (after Phase 1 complete)

**Batches to reformat:**
- Batch 1: vSphere Failure Domain & Machine Pool (11 tooltips)
- Batch 2: AWS & Nutanix (6 tooltips)
- Batch 3: Azure Government (4 tooltips)
- Batch 4: IBM Cloud Region/Resources (6 tooltips)
- Batch 5: IBM Cloud Subnets & Encryption (5 tooltips)
- Batch 6: Advanced & Nutanix (6 tooltips)
- Batch 7: AWS GovCloud (7 tooltips)
- Batch 8: vSphere Zones & Template (3 tooltips)
- Batch 9: AWS/vSphere/IBM (6 tooltips)
- Batch 10: Nutanix Endpoint/Credentials (4 tooltips)

**Strategy:** Do in batches of 10-15 tooltips at a time

---

### Phase 3: Catalog Validation & Discrepancy Resolution

**Status:** Ongoing during expansion

**Discrepancies Found:**
1. ⚠️ platform.nutanix.storageContainer - not found in nutanix-ipi.json catalog
2. ⚠️ platform.nutanix.prismCentral.username - tooltip should clarify "optional"
3. ✅ All Batch 12-14 fields validated as consistent

**Action Items:**
- [ ] Investigate storageContainer - verify if field exists in 4.20/4.21 docs
- [ ] Update Nutanix username tooltip to explicitly state "optional"
- [ ] Complete catalog validation for all remaining tooltips
- [ ] Compile final discrepancy report after all tooltips expanded

---

## Related Work & Context

### From LOCAL_BACKLOG.md

This tooltip expansion work appears to be a sub-task or follow-up to several completed backlog items:

- **#44 (Complete):** vSphere IPI/UPI doc-truth audit + Platform Specifics redesign
  - Implementation included expanding vSphere tooltips with formatted structure
  - This tooltip expansion extends that pattern to ALL platforms

- **#41/#42 (Partially Complete):** AWS Platform Specifics layout/grouping/doc-alignment
  - AWS tooltips partially expanded but more remain

- **Phase B (Complete):** Form consistency and standard layout polish
  - This tooltip work complements the layout/field-grid improvements

### Key Documents

- `/tmp/tooltip-decision-logic.md` - Standards for tooltip vs printed notes
- `/tmp/tooltip-catalog-validation-notes.md` - Batch-by-batch validation tracking
- `/tmp/tooltip-reformatting-todo.md` - Phase 2 reformatting checklist
- `/tmp/tooltip-audit-progress.md` - Outdated (shows 6/~100, actual is 71/174)
- `frontend/tests/hint-syntax.test.js` - Prevents JSX parsing regressions

### Catalog Locations

- Frontend: `frontend/src/data/catalogs/*.json`
- Backend params: `data/params/4.20/*.json`

---

## Technical Implementation

### File Being Modified

- **Primary:** `frontend/src/steps/PlatformSpecificsStep.jsx` (2318 lines)
- **Test:** `frontend/tests/hint-syntax.test.js` (validates all hints use template literals)

### Syntax Requirements

**All hints MUST use template literal syntax:**
```jsx
// ✅ CORRECT
hint={`Your expanded tooltip content here...`}

// ❌ INCORRECT (causes JSX parsing errors)
hint="Your tooltip content"
```

**Special character escaping in template literals:**
- Backslashes: `\` → `\\`
- Backticks: `` ` `` → ``\` ``
- Template interpolation: `${` → `\${`

### Testing

**After each batch:**
1. Run build: `npm run build`
2. Run hint syntax test: `npm test hint-syntax`
3. Commit with descriptive message: `Batch N: <summary> (X/174, ~Y%)`

---

## Workflow

### Per-Batch Process

1. **Identify 2-5 related fields** for expansion (keep batches small and thematic)
2. **Expand tooltips** using structured format with:
   - Brief description
   - What is [concept]
   - Options/requirements
   - When to use
   - Examples
3. **Validate against catalog** (check type, required, description consistency)
4. **Update tracking doc** (`/tmp/tooltip-catalog-validation-notes.md`)
5. **Test build:** `npm run build` and `npm test hint-syntax`
6. **Commit:** `git commit -m "Batch N: <summary> (X/174, ~Y%)"`
7. **Push:** `git push origin develop`
8. **Update this master plan** with batch completion

### Batch Commit Message Format

```
Batch N: <Brief summary of fields expanded> (X/174, ~Y%)

Expanded tooltips for:
- field.path.one: <one-line summary>
- field.path.two: <one-line summary>

Validation:
- All fields consistent with catalog [or note discrepancies]

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

---

## Success Criteria

### Phase 1 Complete (Initial Expansion)
- [ ] All 174 tooltips expanded to comprehensive content
- [ ] All tooltips using template literal syntax
- [ ] All tooltips validated against catalogs
- [ ] Build passing
- [ ] hint-syntax.test.js passing

### Phase 2 Complete (Reformatting)
- [ ] All 58 early-batch tooltips reformatted to structured format
- [ ] Consistent formatting across all 174 tooltips
- [ ] Build passing

### Phase 3 Complete (Validation)
- [ ] All catalog discrepancies documented
- [ ] All "should clarify" items addressed
- [ ] Final validation report delivered

---

## Notes

- **Formatting Evolution:** Batches 1-10 completed before structured format established; need reformatting (Phase 2)
- **Batch Size:** Keep batches small (2-5 fields) for manageable commits and easier review
- **Deprecated Fields:** vSphere folder/resourcePool are deprecated but still in UI for legacy mode - expected not in catalog
- **JSX Safety:** Template literal syntax is MANDATORY - the build will fail with parsing errors if double-quote syntax is used for long hints
- **Test Coverage:** hint-syntax.test.js prevents regression to double-quote syntax

---

## Quick Reference

### Current State
- **Branch:** develop
- **Last Batch:** 15 (IBM Cloud VPC & vSphere networks)
- **Next Batch:** 16 (TBD - need to identify next 2-5 fields)
- **Progress:** 73/174 (42%)

### Key Commands
```bash
# Build test
npm run build

# Hint syntax test
npm test hint-syntax

# Find short hints (candidates for expansion)
grep -n 'hint=' frontend/src/steps/PlatformSpecificsStep.jsx | grep -v 'hint={\`' | head -20

# Commit batch
git add -A
git commit -m "Batch N: <summary> (X/174, ~Y%)"
git push origin develop
```

---

**Maintained by:** Claude Sonnet 4.5
**Project:** OpenShift Airgap Architect
**Repository:** bstrauss84/openshift-airgap-architect
