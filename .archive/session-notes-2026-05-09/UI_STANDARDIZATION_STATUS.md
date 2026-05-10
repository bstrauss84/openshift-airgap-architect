# UI Standardization - Status Report
**Date:** 2026-05-10  
**Session:** Comprehensive UI cleanup and standardization

---

## ✅ Completed Work

### 1. Pull Secret Field Width Constraints
**Status:** Complete  
**Files Modified:**
- `frontend/src/steps/IdentityAccessStep.jsx` - Added `.credentials-field-constrained` wrapper
- `frontend/src/steps/OperatorsStep.jsx` - Constrained pull secret field
- `frontend/src/steps/RunOcMirrorStep.jsx` - Constrained all 4 SecretInput instances (RH + mirror)

**Result:** All pull secret and SSH key fields now ~700px max-width, matching Blueprint tab layout.

---

### 2. Nutanix IPI Field Standardization  
**Status:** Complete  
**File:** `frontend/src/steps/PlatformSpecificsStep.jsx`

**Changes:**
- **Endpoint field:** Constrained to 400px max-width (was full-width)
- **Username field:** Added `.field-medium` class (~220px width)
- **Password field:** Added `.field-medium` class (~220px width) to match username
- **Credentials mode field (Access section):** Constrained to 280px
- **Publish field (Access section):** Constrained to 320px

**Rationale:** Credentials fields don't need full width. Access fields kept visible for user education (show platform requirements) but made much narrower.

---

### 3. Run oc-mirror Advanced Options
**Status:** Complete  
**File:** `frontend/src/styles.css`

**Changes:**
- Fixed `.advanced-options-grid`:
  - Changed from `auto-fit` to `auto-fill`
  - Changed from `max-content` to `1fr`
  - Changed `align-items: end` to `align-items: start`

**Result:** Consistent 1rem gaps, fields wrap properly to fill available space.

---

### 4. vSphere Message Corrections
**Status:** Complete  
**File:** `frontend/src/steps/PlatformSpecificsStep.jsx`

**Changes:**
- Updated failure domains message from "For vSphere IPI at least one..." to "For vSphere IPI, at least one..." (added comma for clarity, updated to "4.20+")

**Agent Findings:**
- vSphere Agent-based IS supported in 4.20 ✅
- Failure domains are IPI-ONLY (not valid for UPI or Agent-based)
- **Critical:** Catalogs incorrectly include failure domains for vsphere-upi.json (26 refs) and vsphere-agent.json (13 refs)

**Recommendation:** Remove `platform.vsphere.failureDomains` from vsphere-upi.json and verify if supported in vsphere-agent.json per 4.20 agent-config.yaml schema.

---

### 5. Azure Government IPI Review
**Status:** Complete (verified as correct)  
**File:** `frontend/src/steps/PlatformSpecificsStep.jsx`

**Findings:**
- **Cloud name dropdown:** Shows only "AzureUSGovernmentCloud" - INTENTIONAL. This is the only supported value for Azure Government per OpenShift docs. Tooltip explains why. Keeping for user education.
- **Field gaps:** All fields in single `.field-grid` with standard `gap: 1rem` - no inconsistencies found in code.
- **Azure UPI?:** Confirmed Azure only supports IPI per OpenShift documentation. No UPI option available for Azure.

**Result:** No changes needed - section is already correct.

---

### 6. CSS Infrastructure
**Status:** Complete  
**File:** `frontend/src/styles.css`

**Added:**
```css
.credentials-field-constrained {
  max-width: 700px;
  width: 100%;
}

.credentials-field-constrained textarea {
  width: 100%;
}
```

**Updated:**
```css
.advanced-options-grid {
  /* Changed auto-fit/max-content to auto-fill/1fr */
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  align-items: start; /* was end */
}
```

---

### 7. Documentation
**Status:** Complete  
**File:** `UI_STANDARDS.md` (created)

**Contents:**
- Reference implementation (Azure as gold standard)
- Layout patterns (field-grid, credentials constraints, short/medium fields)
- Spacing & hierarchy (card structure, label spacing)
- Component usage (SecretInput, FieldLabelWithInfo, Switch)
- Responsive behavior & breakpoints
- Accessibility guidelines
- Common patterns & anti-patterns
- Quick reference tables

---

## ⏳ Remaining Work (Large Scope)

### 8. AWS GovCloud IPI Field Standardization
**Status:** Pending  
**File:** `frontend/src/steps/PlatformSpecificsStep.jsx`

**Agent Verification:** Fields are CORRECT per 4.20 docs ✅  
Instance types and root volumes properly conditional to IPI-only.

**Needed:** Width standardization for ~15+ fields:
- Region dropdown - constrain width
- AMI ID input - constrain width  
- VPC mode dropdown - constrain width
- Machine counts (control plane, worker replicas) - use `.field-short`
- Root volume size - use `.field-short`
- Root volume type dropdown - constrain width (currently too wide)
- Instance type inputs (control plane, worker) - constrain width (currently too wide)
- Publish dropdown - constrain width (currently too wide)
- Credentials mode dropdown - constrain width (currently too wide)
- Load balancer type dropdown - constrain width
- Plus subnet fields, Route 53 fields, etc.

**Estimated effort:** 1-2 hours to apply appropriate width classes/constraints to all fields.

---

### 9. AWS GovCloud UPI Field Standardization
**Status:** Pending  
**File:** `frontend/src/steps/PlatformSpecificsStep.jsx`

**Agent Verification:** Fields are CORRECT per 4.20 docs ✅  
All shown fields are valid for UPI.

**Needed:** Same width standardization as AWS IPI (shared fields).

**Estimated effort:** 30-60 minutes (many fields shared with IPI).

---

### 10. IBM Cloud IPI Field Standardization
**Status:** Pending  
**File:** `frontend/src/steps/PlatformSpecificsStep.jsx`

**Needed:** Width and spacing standardization for ~20+ fields:
- Region input - constrain width
- Resource group inputs - constrain width
- VPC inputs - constrain width  
- Subnet inputs - constrain width
- Instance type input - constrain width
- Dedicated host fields - constrain width
- Boot volume encryption fields - constrain width
- Service endpoints textarea - constrain width
- Ensure consistent 1rem gaps throughout
- Fix any field alignment issues

**Estimated effort:** 2-3 hours due to large number of fields and complex layout.

---

## Critical Issues Found

### 1. vSphere Catalog Data Issue
**Problem:** `platform.vsphere.failureDomains` parameter exists in:
- `vsphere-upi.json` (26 references) - **INCORRECT:** Failure domains are IPI-only
- `vsphere-agent.json` (13 references) - **NEEDS VERIFICATION:** Check if supported in agent-config.yaml

**Impact:** UI shows failure domains section for UPI when it shouldn't.

**Fix Required:** Update catalog files to remove failure domains from non-IPI scenarios.

**Source:** Agent research against OpenShift 4.20 docs and [vSphere IPI Zonal Enhancement](https://github.com/openshift/enhancements/blob/master/enhancements/installer/vsphere-ipi-zonal.md)

---

## Recommendations

### For Immediate Next Steps:

1. **Option A - Complete in one session:**
   - Apply field width constraints to all AWS IPI/UPI fields
   - Apply field width constraints to all IBM Cloud fields
   - Test all scenarios in browser
   - Update UI_STANDARDS.md with new patterns
   - Estimated time: 3-4 hours

2. **Option B - Incremental approach:**
   - Pick one platform at a time (AWS or IBM Cloud)
   - Apply standardization
   - Test and verify
   - Move to next platform
   - Allows for user feedback between platforms

3. **Option C - Delegate to agent:**
   - Create specialized agent to apply width constraints systematically
   - Agent follows UI_STANDARDS.md patterns
   - Review and test agent's changes

### For Catalog Data Fix:

1. Remove `platform.vsphere.failureDomains` from `data/params/4.20/vsphere-upi.json`
2. Verify if agent-config.yaml supports failureDomains for Agent-based vSphere in 4.20
   - If YES: Keep in vsphere-agent.json
   - If NO: Remove from vsphere-agent.json
3. Run catalog sync to update frontend copies
4. Test vSphere UPI scenario - failure domains section should not appear

---

## Build Status

**Latest build:** ✅ Successful  
**Test status:** Ready for browser testing  
**Dev server:** Running at http://localhost:5175

---

## Key Patterns Established

1. **Credential fields:** 700px max-width via `.credentials-field-constrained`
2. **Short numeric fields:** Use `.field-short` class (180px container, 140px input)
3. **Medium text fields:** Use `.field-medium` class (220px container, 200px input)  
4. **Endpoint/URL fields:** 350-400px max-width (custom inline style)
5. **Read-only display fields:** 280-320px max-width
6. **Field grids:** Always use `gap: 1rem`, `align-items: start`
7. **Dropdowns with limited options:** Constrain width to content, not full-width

---

## Files Modified This Session

1. `frontend/src/styles.css` - Added credentials constraint, fixed advanced-options-grid
2. `frontend/src/steps/IdentityAccessStep.jsx` - Pull secret + SSH key constraints
3. `frontend/src/steps/OperatorsStep.jsx` - Pull secret constraint
4. `frontend/src/steps/RunOcMirrorStep.jsx` - Pull secret constraints (4 instances)
5. `frontend/src/steps/PlatformSpecificsStep.jsx` - Nutanix fields, vSphere message
6. `UI_STANDARDS.md` - Created comprehensive UI guide
7. `UI_STANDARDIZATION_STATUS.md` - This file

---

## Next Session Prep

**If continuing with AWS/IBM Cloud standardization:**
1. Have browser open to test each platform
2. Reference UI_STANDARDS.md for width patterns
3. Work through one platform at a time
4. Test after each major section completed

**If fixing catalog data:**
1. Backup current catalogs
2. Research agent-config.yaml schema for vSphere Agent-based
3. Update catalog files
4. Run `npm run sync-catalogs`
5. Test affected scenarios

---

**Session completed:** 2026-05-10  
**Total tasks completed:** 7 of 10  
**Build status:** ✅ Passing  
**Ready for:** Browser testing and continued standardization
