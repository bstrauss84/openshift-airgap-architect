# OpenShift Airgap Architect - Cross-Scenario UI Consistency Analysis

**Analysis Date:** 2026-05-10  
**Reference Standard:** IBM Cloud IPI section (`PlatformSpecificsStep.jsx`, lines 1074-1540)  
**Analyst:** Claude Sonnet 4.5  
**Status:** READ-ONLY ANALYSIS - NO CHANGES IMPLEMENTED

---

## Executive Summary

### Consistency Rating: **MODERATE**

The application demonstrates a **moderate level of UI consistency** across scenario steps, with the IBM Cloud IPI section serving as a well-structured reference. However, several **significant spacing and layout inconsistencies** exist that impact visual coherence and user experience.

### Key Findings

**Strengths:**
- Consistent use of `field-grid` CSS class across all scenarios
- Uniform card structure with card-header/card-title/card-subtitle pattern
- Standardized subsection headers using `platform-specifics-subsection` class
- Consistent FieldLabelWithInfo component usage for labeled fields

**Major Inconsistencies Identified:** 7 categories
- **Field grid spacing variations:** 6 different marginTop/marginBottom combinations
- **Subsection header spacing:** Inconsistent margins before/after subsections
- **Card body padding:** Variations in first-child margin handling
- **Proxy fields layout:** Recently changed to 3-column 500px min-width (may not align with reference)
- **Grid modifier classes:** Inconsistent use of `field-grid--no-paired-layout`
- **Typography:** Minor inconsistencies in note/hint text sizing

---

## Reference Standard: IBM Cloud IPI

**File:** `/home/billstrauss/code/openshift-airgap-architect/frontend/src/steps/PlatformSpecificsStep.jsx`  
**Lines:** 1074-1540 (IBM Cloud IPI section)

### Documented Patterns

#### 1. Card Structure
```jsx
<section className="card">
  <div className="card-header">
    <h3 className="card-title">IBM Cloud IPI</h3>
    <div className="card-subtitle">Placement, VPC path, endpoint overrides...</div>
  </div>
  <div className="card-body">
    {/* Content */}
  </div>
</section>
```

**CSS Values (from styles.css lines 556-609):**
- Card padding: `1.5rem` (24px)
- Card margin-bottom: `1.5rem` (24px)
- Card border-radius: `0.75rem` (12px)
- Card header margin-bottom: `16px`
- Card title font-size: `1rem`
- Card title font-weight: `600`

#### 2. Field Grid Layouts

**Base Pattern (lines 4195-4203):**
```css
.platform-specifics .field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  column-gap: 1.25rem;  /* 20px */
  row-gap: 1.5rem;       /* 24px */
  width: 100%;
  align-items: stretch;
  margin-top: 0.75rem;   /* 12px default */
}
```

**Standard Inline Styles in IBM Cloud IPI:**
```jsx
// After subsection header, before fields
<div className="field-grid" style={{ marginTop: 8, marginBottom: 16 }}>

// For mid-section field groups
<div className="field-grid" style={{ marginTop: 8, marginBottom: 12 }}>

// For final field group in section
<div className="field-grid" style={{ marginBottom: 16 }}>
```

**Observed IBM Cloud Pattern:**
- First field-grid after subsection: `mt:8 mb:16` (most common)
- Intermediate field-grids: `mt:8 mb:12`
- No marginTop specified defaults to CSS `0.75rem` (12px)

#### 3. Subsection Headers

**Structure (line 1081):**
```jsx
<h4 className="platform-specifics-subsection">Placement</h4>
```

**CSS (lines 4369-4376):**
```css
.platform-specifics-subsection {
  font-size: 1rem;
  font-weight: 600;
  margin: 1.5rem 0 1rem;  /* Top: 24px, Bottom: 16px */
  color: #374151;
  border-left: 3px solid #3b82f6;
  padding-left: 0.75rem;  /* 12px */
}
```

**IBM Cloud Pattern:**
- Subsection header placed before field-grid
- Often followed by `<p className="note subtle">` with `marginTop: 0, marginBottom: 8`
- Field-grid after note has `marginTop: 8`

#### 4. Label Alignment

**FieldLabelWithInfo Component:**
- Used consistently across all scenarios
- Provides tooltip hints via `hint` prop
- Required badge via `required` prop
- Children contain input/select/textarea

**Field Label CSS (lines 4221-4226):**
```css
.platform-specifics .field-grid label {
  align-items: flex-start;
  min-width: 0;
  margin: 0;
  padding: 0;
}
```

#### 5. Typography

**Note Text:**
- Class: `note subtle`
- Used for hints/descriptions
- Common pattern: `style={{ marginTop: 0, marginBottom: 8 }}`

---

## Per-Scenario Findings

### 1. AWS GovCloud (IPI/UPI)

**File:** `PlatformSpecificsStep.jsx`  
**Lines:** 297-902

#### Field Grid Spacing Variations
**Inconsistency #1: Non-standard spacing**
- Line 316: `<div className="field-grid">` - NO inline style (uses CSS default mt:12px)
  - **Issue:** Should be `mt:8 mb:16` to match IBM Cloud pattern after subsection
- Line 419: `<div className="field-grid">` - NO inline style
  - **Issue:** Inconsistent with reference
- Line 530: `<div className="field-grid">` - NO inline style
  - **Issue:** Should specify margins for consistency

**Inconsistency #2: Correct usage**
- Line 933: `style={{ marginTop: 12 }}` - Used for Azure Government section
  - **Note:** This is Azure, not AWS, but demonstrates variation

#### Card Structure
- **Correct:** Consistent card-header/card-title/card-subtitle pattern (lines 298-300)
- **Correct:** Proper card-body wrapper (line 302)

#### Subsection Headers
- **Correct:** Uses `platform-specifics-subsection` class (lines 309, 415, 529, 590, 624, 669, 717, 829)
- **Correct:** Proper border-left blue accent

#### Recommendations
**Priority: MEDIUM**
- Add explicit marginTop/marginBottom to field-grids at lines 316, 419, 530, 591, 625, 673, 721, 830
- Standardize to `mt:8 mb:16` pattern after subsection headers
- Standardize to `mt:8 mb:12` for intermediate sections

---

### 2. Azure Government (IPI/UPI)

**File:** `PlatformSpecificsStep.jsx`  
**Lines:** 926-1073

#### Field Grid Spacing
**Inconsistency #3: Different initial spacing**
- Line 933: `style={{ marginTop: 12 }}` 
  - **Issue:** Deviates from reference `mt:8` pattern
  - **Impact:** Creates 4px extra space vs. IBM Cloud standard

#### Card Structure
- **Correct:** Matches reference pattern (lines 928-931)

#### Subsection Headers
- **Missing:** Azure Government section has NO subsection headers
  - **Issue:** Flat structure, less organized than IBM Cloud reference
  - **Impact:** All fields in single field-grid, harder to scan visually

#### Recommendations
**Priority: MEDIUM**
- Change line 933 marginTop from 12 to 8
- **Consider:** Add subsection headers if Azure config grows (currently compact)

---

### 3. vSphere (IPI/UPI/Agent)

**File:** `PlatformSpecificsStep.jsx`  
**Lines:** 1856-2530

#### Field Grid Spacing
**Inconsistency #4: Credentials section non-standard**
- Line 1871: `style={{ marginTop: 8, marginBottom: 20 }}`
  - **Issue:** `mb:20` is unique to vSphere, not used in IBM Cloud reference
  - **Impact:** Creates extra 4px vertical space vs. standard `mb:16`

**Inconsistency #5: Placement section**
- Line 1953: `style={{ marginTop: 8, marginBottom: 12 }}`
  - **Status:** CORRECT for intermediate sections
- Line 1979: `style={{ marginTop: 8, marginBottom: 16 }}`
  - **Status:** CORRECT for final field group

#### Card Structure
- **Correct:** Matches reference pattern
- **Complex:** Conditional rendering for IPI/UPI/Agent paths

#### Subsection Headers
- **Correct:** Uses `platform-specifics-subsection` (lines 1870, 1949)
- **Correct:** Proper spacing

#### Special Cases
- Line 2148: Nested card for failure domains
  - **Pattern:** `<div className="card" style={{ marginBottom: 16, padding: 16 }}>`
  - **Status:** Appropriate for nested structure
- Line 2159: Field-grid inside failure domain card has NO style
  - **Issue:** Should have explicit spacing for consistency

#### Recommendations
**Priority: LOW-MEDIUM**
- Line 1871: Change `marginBottom: 20` to `marginBottom: 16` (standardize)
- Line 2159: Add `style={{ marginTop: 8, marginBottom: 16 }}` to failure domain field-grids

---

### 4. Nutanix IPI

**File:** `PlatformSpecificsStep.jsx`  
**Lines:** 1540-1856

#### Field Grid Spacing
**Inconsistency #6: Perfect adherence to reference**
- Line 1549: `style={{ marginTop: 8, marginBottom: 16 }}` ✓
- Line 1579: `style={{ marginBottom: 16 }}` ✓
- Line 1628: `style={{ marginBottom: 16 }}` ✓

**Status:** Nutanix IPI section demonstrates EXCELLENT consistency with IBM Cloud reference

#### Card Structure
- **Correct:** Perfect match to reference pattern

#### Subsection Headers
- **Correct:** Proper use of `platform-specifics-subsection` (lines 1548, 1577, 1627, 1713, 1817)
- **Correct:** Organized into logical groups (Connection, Credentials, Infrastructure, Topology, Advanced)

#### Recommendations
**Priority: NONE**
- Nutanix IPI is the GOLD STANDARD alongside IBM Cloud IPI
- Use as additional reference for other scenarios

---

### 5. Bare Metal (IPI/UPI/Agent)

**File:** `PlatformSpecificsStep.jsx`  
**Lines:** 902-925

#### Field Grid Spacing
- **Note:** Bare Metal Agent section has NO field-grids
- Uses OptionRow component for toggle switches

#### Card Structure
- **Correct:** Matches reference pattern (lines 904-907)

#### Subsection Headers
- **N/A:** No subsections (very simple card)

#### Recommendations
**Priority: NONE**
- Current structure appropriate for simple toggle configuration

---

### 6. Trust & Proxy Tab - Proxy Fields

**File:** `/home/billstrauss/code/openshift-airgap-architect/frontend/src/steps/TrustProxyStep.jsx`  
**Lines:** 576-668

#### Proxy Fields Grid Layout

**Current Implementation (commit 5230d81):**
```css
/* Line 1098-1104 in styles.css */
.proxy-fields-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(500px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
  align-items: start;
  overflow-x: auto;
}
```

**Comparison to IBM Cloud IPI Reference:**

| Aspect | Proxy Fields | IBM Cloud IPI | Match? |
|--------|--------------|---------------|--------|
| Column count | 3 (fixed) | auto-fit | ❌ |
| Min width | 500px | 220px | ❌ |
| Column gap | 20px | 20px (1.25rem) | ✅ |
| Row gap | 20px | 24px (1.5rem) | ❌ |
| Responsiveness | overflow-x auto | auto-fit responsive | ❌ |

**Analysis:**
The proxy fields use a **CUSTOM 3-column fixed layout** that significantly deviates from the reference standard:

1. **Fixed 3-column vs. responsive auto-fit**
   - Proxy: `repeat(3, minmax(500px, 1fr))` - forces 3 columns
   - Reference: `repeat(auto-fit, minmax(220px, 1fr))` - adapts to available space

2. **Minimum width: 500px vs. 220px**
   - Proxy fields are **2.27× wider minimum** than reference
   - Causes horizontal scrolling on medium-width viewports
   - Reference allows narrower columns that wrap naturally

3. **Gap mismatch**
   - Proxy row-gap: `20px`
   - Reference row-gap: `24px` (1.5rem)
   - **4px discrepancy**

4. **Overflow handling**
   - Proxy: `overflow-x: auto` (horizontal scrollbar)
   - Reference: No overflow (columns wrap naturally)

**User Impact:**
- On laptop screens (1366px-1600px), proxy fields trigger horizontal scroll
- Inconsistent with rest of wizard's responsive behavior
- Fields feel "locked" vs. fluid reference layout

#### Recommendations
**Priority: HIGH**

**Option A: Align to Reference Standard (Recommended)**
```css
.proxy-fields-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  column-gap: 1.25rem;  /* 20px */
  row-gap: 1.5rem;      /* 24px */
  margin-bottom: 20px;
  align-items: start;
  width: 100%;
}
```
- **Benefits:** Matches reference, responsive, no horizontal scroll
- **Tradeoff:** Fields may wrap to 2 or 3 columns depending on viewport width
- **Risk:** LOW - same pattern used successfully throughout app

**Option B: Hybrid - Reduce Min Width**
```css
.proxy-fields-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  column-gap: 1.25rem;
  row-gap: 1.5rem;
  /* ... */
}
```
- **Benefits:** Maintains preference for wider fields while reducing overflow
- **Tradeoff:** Still wider than reference (300px vs 220px)
- **Risk:** LOW - moderate improvement

**Option C: Keep Current (Not Recommended)**
- **Benefits:** Maintains 500px width as apparently intended
- **Tradeoffs:** Inconsistent with rest of UI, horizontal scroll on medium screens
- **Risk:** MEDIUM - user frustration with scrolling

---

## Field Grid Spacing Summary

### Spacing Variants Found

| Pattern | Lines (PlatformSpecificsStep.jsx) | Count | Status |
|---------|-----------------------------------|-------|--------|
| `mt:8 mb:16` | 1082, 1338, 1404, 1435, 1549, 1979 | 6 | ✅ STANDARD |
| `mt:8 mb:12` | 1161, 1953, 2700 | 3 | ✅ ACCEPTABLE |
| `mt:8 mb:20` | 1871, 2533, 2605 | 3 | ⚠️ NON-STANDARD |
| `mt:0 mb:16` | 1215, 1579, 1628, 1740 | 4 | ✅ ACCEPTABLE |
| `mt:12 mb:0` | 933, 2955, 3124 | 3 | ⚠️ NON-STANDARD |
| `mt:4 mb:0` | 2402 | 1 | ⚠️ NON-STANDARD |
| NO STYLE | 316, 419, 530, 591, 625, 673, 721, 830, 2159 | 9+ | ⚠️ INCONSISTENT |

### Recommended Standard

**After Subsection Header:**
```jsx
<div className="field-grid" style={{ marginTop: 8, marginBottom: 16 }}>
```

**Intermediate Section:**
```jsx
<div className="field-grid" style={{ marginTop: 8, marginBottom: 12 }}>
```

**Final Section (before next subsection/card end):**
```jsx
<div className="field-grid" style={{ marginBottom: 16 }}>
```

---

## Card Structure Analysis

### Card Padding

**Standard (from styles.css line 558):**
```css
.card {
  padding: 1.5rem;  /* 24px */
}
```

**All scenarios:** ✅ Consistent use of card class with standard padding

**Exception:** Failure domain nested cards (line 2154)
- Custom: `style={{ padding: 16 }}`
- **Rationale:** Nested cards use less padding to differentiate from parent
- **Status:** Appropriate design decision

### Card Margins

**Standard:**
```css
.card {
  margin-bottom: 1.5rem;  /* 24px */
}
```

**All scenarios:** ✅ Consistent

---

## Typography Analysis

### Subsection Headers

**Standard CSS (line 4369-4376):** ✅ Consistent across all scenarios

### Note Text

**Classes found:**
- `note subtle` - Most common, for hints/descriptions
- `note warning` - For warnings/validation errors

**Spacing patterns:**
```jsx
// Common pattern (IBM Cloud reference)
<p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>

// Variations found
style={{ marginTop: 8, marginBottom: 0 }}  // Rare
style={{ marginBottom: 12 }}                // Occasional
```

**Status:** Mostly consistent, minor variations acceptable for context

### Field Labels

**FieldLabelWithInfo component:** ✅ Used consistently across all scenarios

**No inconsistencies found** in label rendering or alignment

---

## Proposed Changes (NOT IMPLEMENTED)

### Phase A: Low-Risk Spacing Standardization

**Effort:** 2-3 hours  
**Risk:** LOW  
**Files Affected:** `PlatformSpecificsStep.jsx` only

#### Changes

1. **AWS GovCloud field-grids (lines 316, 419, 530, 591, 625, 673, 721, 830)**
   - ADD: `style={{ marginTop: 8, marginBottom: 16 }}` after subsection headers
   - ADD: `style={{ marginTop: 8, marginBottom: 12 }}` for intermediate sections

2. **Azure Government field-grid (line 933)**
   - CHANGE: `marginTop: 12` → `marginTop: 8`

3. **vSphere Credentials section (line 1871)**
   - CHANGE: `marginBottom: 20` → `marginBottom: 16`

4. **vSphere failure domain field-grids (line 2159, others)**
   - ADD: `style={{ marginTop: 8, marginBottom: 16 }}`

**Testing:**
- Visual regression: Compare before/after screenshots of each scenario
- Ensure no layout shifts or overlaps
- Verify spacing feels uniform across scenarios

---

### Phase B: Medium-Risk Proxy Fields Layout

**Effort:** 3-4 hours  
**Risk:** MEDIUM  
**Files Affected:** `styles.css` (lines 1098-1117), possibly `TrustProxyStep.jsx`

#### Option A Changes (Recommended)

**File:** `styles.css` line 1098-1104

**CHANGE FROM:**
```css
.proxy-fields-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(500px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
  align-items: start;
  overflow-x: auto;
}
```

**CHANGE TO:**
```css
.proxy-fields-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  column-gap: 1.25rem;  /* 20px - maintain current */
  row-gap: 1.5rem;      /* 24px - align to reference */
  margin-bottom: 20px;
  align-items: start;
  width: 100%;
}
/* Remove overflow-x auto */
```

**Rationale:**
- Aligns to IBM Cloud IPI reference pattern
- Eliminates horizontal scrolling
- Maintains responsive behavior
- Increases row-gap from 20px to 24px (4px increase)

**Testing:**
- Test on viewports: 1024px, 1366px, 1920px, 2560px
- Verify 3-column layout on wide screens (1600px+)
- Verify 2-column layout on medium screens (1024-1600px)
- Verify 1-column layout on narrow screens (<1024px)
- Check field widths feel appropriate, not too narrow
- Ensure textarea height (4 rows) works well in all layouts

**Rollback Plan:**
- Keep commit 5230d81 values in version control
- Easy rollback if user prefers fixed 500px width

---

### Phase C: High-Risk Structural Changes

**Effort:** 4-6 hours  
**Risk:** HIGH  
**Status:** NOT RECOMMENDED without explicit user approval

#### Potential Changes (NOT proposed for implementation)

1. **Azure Government subsection headers**
   - Add subsection headers if field count grows
   - **Current:** Not needed (only 4 fields)

2. **Field-grid modifier class standardization**
   - Audit use of `field-grid--no-paired-layout`
   - Ensure consistent application

3. **Card subtitle element standardization**
   - Some use `<div className="card-subtitle">`
   - Some use `<p className="card-subtitle">`
   - **Impact:** Minimal, both render identically

---

## Implementation Strategy

### Recommended Approach: Phased Rollout with Per-Item Approval

Given user's explicit requirement for **per-item approval**, the implementation should follow this process:

#### Step 1: User Review & Prioritization
1. User reviews this report
2. User selects which changes to implement:
   - Phase A: Spacing standardization (Y/N)
   - Phase B: Proxy fields layout (Option A/B/C/None)
   - Phase C: Structural changes (individual approval)

#### Step 2: Implementation (IF Approved)
1. Create feature branch: `ui-consistency-[phase-name]`
2. Implement approved changes only
3. Run visual regression tests
4. Create screenshots showing before/after for each change
5. Submit for user review before merging

#### Step 3: Validation
1. User validates each change visually
2. User can reject individual items even within approved phase
3. Approved items merged to main
4. Rejected items documented for future consideration

### Risk Mitigation

**For ALL changes:**
- Create before/after screenshots
- Test on multiple screen sizes (1024px, 1366px, 1920px, 2560px)
- Test both light and dark modes
- Verify with real data (not just placeholder text)
- Check edge cases (very long field labels, long tooltips)

**For Proxy Fields specifically:**
- Test with actual proxy URLs (long domain names)
- Test with empty fields
- Test with validation errors showing
- Test collapsible behavior (fields hidden when proxy disabled)

---

## Risk Assessment

### Phase A: Spacing Standardization

| Change | Risk | Rationale |
|--------|------|-----------|
| Add mt:8 mb:16 to field-grids | LOW | Just margin tweaks, no layout change |
| Change mt:12 → mt:8 | LOW | 4px difference imperceptible |
| Change mb:20 → mb:16 | LOW | 4px difference, aligns to standard |

**Overall Risk:** LOW  
**Recommendation:** SAFE TO IMPLEMENT

### Phase B: Proxy Fields Layout

| Approach | Risk | Rationale |
|----------|------|-----------|
| Option A (align to reference) | MEDIUM | Significant layout change, fields may wrap differently |
| Option B (hybrid 300px) | LOW-MEDIUM | Moderate change, less disruptive |
| Option C (keep current) | NONE | No change |

**Overall Risk:** MEDIUM  
**Recommendation:** IMPLEMENT WITH TESTING

**Specific Risks:**
1. **Field width perception:** Users accustomed to 500px may find 220px-300px "too narrow"
   - **Mitigation:** Test with real proxy URLs, adjust if needed
2. **Wrapping behavior:** Fields may wrap to 2 columns on medium screens
   - **Mitigation:** Verify wrapping looks intentional, not broken
3. **Textarea height:** 4 rows in narrower fields may feel cramped
   - **Mitigation:** Consider increasing rows to 5-6 if needed

### Phase C: Structural Changes

**Overall Risk:** HIGH  
**Recommendation:** DO NOT IMPLEMENT without explicit user request

---

## Summary of Inconsistencies

### Critical Files for Implementation

If user approves changes, these files will need modification:

1. `/home/billstrauss/code/openshift-airgap-architect/frontend/src/steps/PlatformSpecificsStep.jsx`
   - Lines to modify: 316, 419, 530, 591, 625, 673, 721, 830 (AWS GovCloud)
   - Lines to modify: 933 (Azure Government)
   - Lines to modify: 1871 (vSphere)
   - Lines to modify: 2159+ (vSphere failure domains)

2. `/home/billstrauss/code/openshift-airgap-architect/frontend/src/styles.css`
   - Lines to modify: 1098-1117 (proxy-fields-grid)

3. `/home/billstrauss/code/openshift-airgap-architect/frontend/src/steps/TrustProxyStep.jsx`
   - No changes needed (uses proxy-fields-grid class)

### Total Changes Summary

| Category | Count | Priority |
|----------|-------|----------|
| Field-grid spacing fixes | ~13 | MEDIUM |
| Proxy fields layout change | 1 | HIGH |
| Structural improvements | 0 | N/A |

**Total Effort Estimate:** 5-7 hours (if all approved)

---

## Conclusion

The OpenShift Airgap Architect demonstrates **moderate UI consistency** with clear reference patterns established by the IBM Cloud IPI section. The **primary inconsistencies are spacing-related** rather than structural, making them **low-risk to fix**.

The **proxy fields layout** represents the most significant deviation from the reference standard, requiring careful consideration of user preference vs. consistency. Recent commits (924fab1, 5230d81) show intentional design toward 500px fixed-width fields, which may reflect user preference for wider fields despite inconsistency with the reference.

**Recommendation:**
1. **Implement Phase A** (spacing standardization) - low risk, clear improvement
2. **User decision on Phase B** (proxy fields) - requires tradeoff discussion
3. **Skip Phase C** unless specific issues arise

**Next Steps:**
1. User reviews this report
2. User approves/rejects proposed changes per category
3. Implementation only proceeds with explicit approval
4. Each change validated with before/after screenshots

---

**End of Report**
