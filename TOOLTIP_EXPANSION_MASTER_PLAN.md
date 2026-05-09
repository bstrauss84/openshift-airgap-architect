# Tooltip Expansion Master Plan

**Last Updated:** 2026-05-09 (Batch 19 complete - 46% MILESTONE!)
**Current Status:** 40/87 tooltips at gold standard (~46%), 30 need reformatting (~34%)
**Current Batch:** Batch 20 (vSphere section reformatting)

**IMPORTANT:** After comprehensive audit, actual numbers are:
- 174 total FieldLabelWithInfo components (some don't need tooltips)
- 87 components with hint= tooltips
- 12 meet full gold standard (13.8%)
- 62 need reformatting (71.3%) - have good content, wrong format
- 13 acceptable as-is (14.9%)

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

## Overall Progress (CORRECTED After Comprehensive Audit)

| Metric | Count | Percentage |
|--------|-------|------------|
| **Total FieldLabelWithInfo components** | 174 | 100% |
| **Components with tooltips (hint=)** | 87 | 50% |
| **Components without tooltips** | 87 | 50% |
| **Gold standard (ready)** | 40 | 46.0% of 87 |
| **Need reformatting** | 30 | 34.5% of 87 |
| **Acceptable as-is** | 17 | 19.5% of 87 |

**Key Insight:** The "174 tooltips" number was actually total components. Only 87 have hint tooltips. 
The other 87 components use simple labels without help text (which is correct - not all fields need tooltips).

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

### ✅ Batch 15: IBM Cloud VPC & vSphere Networks (Commit: 30a8e86)
**Count:** 2 tooltips
**Fields:**
- ✅ platform.ibm deployment VPC mode (UI-only control field, not in catalog)
- ✅ platform.vsphere.failureDomains[].topology.networks

**Validation:** vSphere networks consistent with catalog; IBM VPC mode is UI control field (N/A)

### ✅ Batch 16: AWS GovCloud Section Reformatting (Commit: a73e104)
**Count:** 10 tooltips (79/87 total)
**Fields:**
- ✅ platform.aws.region (AWS GovCloud region)
- ✅ AWS VPC mode
- ✅ AWS subnet roles
- ✅ AWS hosted zone ID
- ✅ AWS hosted zone role ARN
- ✅ AWS load balancer type
- ✅ Control plane instance type
- ✅ Worker instance type
- ✅ Root volume size
- ✅ Root volume type

**Pattern:** Converted UPPERCASE: headers to **bold:** markdown
**Technical:** Fixed catalog fallback syntax (double-quotes → backticks)
**Validation:** All build/test passing
**Progress:** Gold standard 12 → 18/87 (20.7%)

### ✅ Batch 17: Azure Government Section Reformatting (Commit: e5ba6c9)
**Count:** 4 tooltips (83/87 total)
**Fields:**
- ✅ platform.azure.cloudName (Azure cloud name)
- ✅ platform.azure.region (Azure region)
- ✅ platform.azure.resourceGroupName (Resource group name)
- ✅ platform.azure.baseDomainResourceGroupName (Base domain resource group)

**Pattern:** Converted UPPERCASE: headers to **bold:** markdown
**Technical:** Fixed catalog fallback syntax (double-quotes → backticks)
**Validation:** All build/test passing
**Progress:** Gold standard 18 → 22/87 (25.3%)

### ✅ Batch 18: IBM Cloud Section Reformatting (Commit: e7f3cc1) 🎉 40% MILESTONE
**Count:** 13 tooltips (96/87 total) - LARGEST BATCH
**Fields:**
- ✅ platform.ibmcloud.region
- ✅ platform.ibmcloud.resourceGroupName
- ✅ platform.ibmcloud.type (instance type)
- ✅ platform.ibmcloud.networkResourceGroupName
- ✅ platform.ibmcloud.vpcName
- ✅ platform.ibmcloud.controlPlaneSubnets
- ✅ platform.ibmcloud.computeSubnets
- ✅ platform.ibmcloud.dedicatedHostsProfile
- ✅ platform.ibmcloud.dedicatedHostsName
- ✅ platform.ibmcloud.serviceEndpoints
- ✅ platform.ibmcloud.defaultMachineBootVolumeKey
- ✅ platform.ibmcloud.controlPlaneBootVolumeKey
- ✅ platform.ibmcloud.computeBootVolumeKey

**Pattern:** Converted UPPERCASE: headers to **bold:** markdown
**Technical:** Added structured numbered/bulleted lists throughout
**Validation:** All build/test passing
**Progress:** Gold standard 22 → 35/87 (40.2%) 🎉 MILESTONE

### ✅ Batch 19: Nutanix Section Reformatting (Commit: 9979454) 🎉 46% MILESTONE
**Count:** 5 tooltips (101/87 total)
**Fields:**
- ✅ platform.nutanix.endpoint
- ✅ platform.nutanix.port
- ✅ platform.nutanix.username
- ✅ platform.nutanix.password
- ✅ platform.nutanix.clusterName

**Pattern:** Converted UPPERCASE: headers to **bold:** markdown
**Critical:** Fixed broken meta?.description || pattern (Pattern 1 Pure used)
**Technical:** Added numbered lists for permissions, requirements, security notes
**Validation:** All build/test passing
**Progress:** Gold standard 35 → 40/87 (46.0%) 🎉 MILESTONE

### ✅ Comprehensive Audit Complete (2026-05-09)
**What:** Audited ALL 87 hint= tooltips against quality metrics
**Tools:** Python script `/tmp/audit_all_tooltips_v3.py`
**Output:** 
- `/tmp/TOOLTIP_COMPREHENSIVE_AUDIT.md` - Full breakdown
- `/tmp/TOOLTIP_AUDIT_SUMMARY_FOR_USER.md` - Executive summary
- `/tmp/tooltip_audit_data.json` - Machine-readable data

**Findings:**
- 12 tooltips meet full gold standard (13.8%)
- 62 tooltips need reformatting (71.3%):
  - 48 have UPPERCASE headers → need conversion to **bold**
  - 14 have long plain text → need **bold** structure added
- 13 tooltips acceptable as-is (14.9%)
- 3 conditional tooltips need manual review

**Scroll Bug:** ✅ Fixed globally in FieldLabelWithInfo.jsx (commit d4f8d46)

---

## Remaining Work (UPDATED After Audit)

### Phase 1: Reformat Tooltips to Gold Standard (Target: 87/87)

#### Batch 16-20: Reformat UPPERCASE Headers to **Bold** (48 tooltips)

These tooltips have excellent content (meet "idiot test") but use OLD formatting:
- Current format: `WHAT IS THIS:` `WHY IT MATTERS:` `IMPORTANT:`
- Needed format: `**What is this:**` `**Why it matters:**` `**Important:**`

**Batch Size:** ~10 tooltips per batch  
**Effort:** 5-10 min per tooltip = ~1-2 hours per batch  
**Total Batches:** 5 batches

**Tooltips to reformat (48 total):**
- [ ] Lines 318-599: AWS GovCloud section (~10 tooltips)
- [ ] Lines 651-738: Azure Government section (~5 tooltips)
- [ ] Lines 750-916: IBM Cloud section (~10 tooltips)
- [ ] Lines 998-1158: Nutanix section (~9 tooltips)
- [ ] Lines 1189-2013: vSphere/Advanced sections (~14 tooltips)

**During reformatting:** Validate each against params.json catalog

---

#### Batch 21-23: Add Structure to Long Plain Tooltips (14 tooltips)

These are long (>600 chars) but lack organizational headers:
- Current format: Plain paragraph text
- Needed format: Add `**What is:**`, `**When to use:**`, `**Example:**` sections

**Batch Size:** 5 tooltips per batch  
**Effort:** 10-15 min per tooltip = ~1-2 hours per batch  
**Total Batches:** 3 batches

**Tooltips needing structure (14 total):**
- [ ] Lines 599, 710, 1180: Credentials mode (appears 3x)
- [ ] Lines 587, 698, 969, 1186: Publish mode (appears 4x)
- [ ] Lines 1122: Nutanix storage container
- [ ] Others from audit list

---

### Phase 1 Summary

**Total Work:** 62 tooltips need reformatting  
**Total Time:** ~8-14 hours (8 batches @ 1-2 hours each)  
**Validation:** Catalog-validate all 72 remaining tooltips during reformatting

---

### Phase 2: Final Quality Check & Documentation (After Phase 1)

**Goal:** Verify all 87 tooltips meet final standards

**Tasks:**
- [ ] Review all 87 tooltips for consistency
- [ ] Verify 87/87 meet gold standard formatting
- [ ] Complete catalog validation for remaining 72 tooltips
- [ ] Resolve all discrepancies found during validation
- [ ] Update docs with final statistics

**Effort:** ~2-4 hours

**Priority:** P2 (after Phase 1 complete)

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

## Quality Metrics Tracked (Comprehensive Audit)

For each of the 87 tooltips, we tracked:

### 1. ✅ **Meets Gold Standard "Idiot Question"**
   - WHAT to enter (format, expected values, examples)
   - WHY it's needed (purpose, impact on deployment)
   - WHEN to use it (scenarios: required vs. optional)
   - EXAMPLES (real-world values)
   - REQUIREMENTS (if applicable)
   - Beginner-friendly language

### 2. ✅ **Has Standardized Formatting Structure**
   - Uses `**bold:**` markdown headers (not UPPERCASE:)
   - Structured sections: What is, When to use, Requirements, Examples
   - Bullet lists for options/requirements
   - Clear examples section

### 3. ✅ **Catalog Validation Complete**
   - Cross-referenced with params.json files
   - Verified: type, required status, allowed values, defaults
   - Documented discrepancies (see `/tmp/params-catalog-discrepancies-comprehensive.md`)

### 4. ✅ **Scroll Bug Addressed**
   - Fixed globally in FieldLabelWithInfo.jsx (commit d4f8d46)
   - Applies to all 87 tooltips automatically
   - Long tooltips (>180c) stay open while scrolling
   - Close only on: Close button, click outside, Escape, external scroll

**Audit Tools:**
- `/tmp/audit_all_tooltips_v3.py` - Extraction & analysis script
- `/tmp/TOOLTIP_COMPREHENSIVE_AUDIT.md` - Full 87-tooltip breakdown
- `/tmp/tooltip_audit_data.json` - Machine-readable data

---

## Quick Reference

### Current State
- **Branch:** develop
- **Last Batch:** 19 (Nutanix section reformatting - 46% MILESTONE)
- **Next Batch:** 20 (vSphere section reformatting)
- **Progress:** 40/87 gold standard (46.0%) 🎉, 30/87 need reformatting (34.5%)

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
