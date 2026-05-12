# Test Failures Analysis
**Date:** 2026-05-12  
**Context:** Phase 0 complete, before starting Phase 2A

---

## Summary

**Backend:** ✅ All 239 tests passing  
**Frontend:** ⚠️ 6 tests failing across 4 test files (635 passing total)

**Additional Issue:** Build warnings for duplicate `title` attributes in NetworkingV2Step.jsx

---

## Frontend Test Failures Breakdown

### 1. `operations-log-download.test.jsx` (2 failures)

#### Tests Failing
1. `Operations log download button visibility > should hide download button when job has no output`
2. `Operations log download button visibility > should hide download button when output is null`

#### What They're Testing
Logic to determine when the download button should be visible based on whether a job has output content. Download button should only show when job has non-empty output.

#### Why They're Failing
```javascript
// Test code:
const shouldShow = job.output && job.output.trim().length > 0;
expect(shouldShow).toBe(false);
```

**Problem:** JavaScript's `&&` operator returns the first falsy value or the last value, NOT a boolean:
- When `job.output = ''`: expression evaluates to `''` (empty string), not `false`
- When `job.output = null`: expression evaluates to `null`, not `false`

**Actual error:**
```
AssertionError: expected '' to be false  // for empty string test
AssertionError: expected null to be false // for null test
```

#### Are Tests Valid?
✅ **YES** - These tests verify important business logic (download button should hide when no output exists)

#### What Needs to Be Fixed

**Option A:** Update test expectations to use `.toBeFalsy()` instead of `.toBe(false)`:
```javascript
expect(shouldShow).toBeFalsy(); // accepts '', null, false, 0, undefined, NaN
```

**Option B:** Change the logic to explicitly return a boolean:
```javascript
const shouldShow = !!(job.output && job.output.trim().length > 0);
expect(shouldShow).toBe(false); // now correctly returns boolean
```

**Recommendation:** Option A (update test) - simpler and matches JavaScript semantics

---

### 2. `platform-specifics-step.test.jsx` (1 failure)

#### Test Failing
`Platform Specifics replacement step (Phase 5 Prompt I) > when scenario is azure-government-ipi, getScenarioId returns azure-government-ipi and validation requires cloudName, region, resourceGroupName, baseDomainResourceGroupName (Prompt J)`

#### What It's Testing
Azure Government IPI scenario validation should require 4 specific fields and produce specific error messages for each missing field.

#### Why It's Failing
```javascript
expect(resultEmpty.errors).toContain("Resource group name is required for Azure Government IPI.");
```

**Error message:** `expected [ …(3) ] to include 'Resource group name is required for A…'`

This means:
- The errors array has 3 items (should have 4)
- The "Resource group name" error is missing

**Evidence:** The validation message DOES exist in validation.js:
- Line 697: `if (!cfg.azure?.resourceGroupName) errors.push("Resource group name is required for Azure Government IPI.");`
- Line 1360: `errors.push("Resource group name is required for Azure Government IPI.");`

#### Are Tests Valid?
✅ **YES** - Azure Government IPI absolutely requires resourceGroupName

#### What Needs to Be Fixed

**Investigation needed:**
1. Check if the validation path is actually reached for Azure Government scenario
2. Check if there's a condition preventing this specific validation from running
3. Verify the test state setup includes `platform: "Azure Government"` and `method: "IPI"`

**Likely cause:** Validation logic may have conditional that's preventing the resourceGroupName check from running, OR the test state setup is missing something.

**Action:** Read validation.js lines 690-710 and 1350-1370 to understand the conditional logic around this validation.

---

### 3. `regression.test.jsx` (2 failures)

#### Tests Failing
1. `Regression Tests > [object Object] bug prevention > should render label text correctly without stringifying JSX`
2. `Regression Tests > Required marker rendering > should render required badge when required=true`

#### What They're Testing
1. FieldLabelWithInfo component should render label text as strings, not stringify JSX objects
2. Required fields should show a required badge/marker

#### Why They're Failing

**Test 1 failure:**
```
Unable to find an element with the text: Test Field
```

**Cause:** FieldLabelWithInfo splits labels into prefix and last word when hints exist (see splitLabelPrefixAndLastWord function). The text "Test Field" is split across:
- Prefix: "Test"  
- Last word: "Field"

These are rendered in separate `<span>` elements, so `getByText('Test Field')` can't find them as a single string.

**Test 2 failure:**
```
expected null to be truthy
const requiredBadge = container.querySelector('.required-badge');
```

**Cause:** Component has changed! Current implementation uses:
```jsx
{required ? <span className="required-marker" aria-label="required">*</span> : null}
```

NOT:
```jsx
{required ? <span className="required-badge">required</span> : null}
```

The test is looking for the old design (`.required-badge` with text "required") but component now uses `.required-marker` with text "*".

#### Are Tests Valid?
⚠️ **PARTIALLY OUTDATED**

- Test 1 concept is valid (prevent JSX stringification) but implementation needs update
- Test 2 is outdated - component design changed from badge to asterisk marker

#### What Needs to Be Fixed

**Test 1 - Update text matching:**
```javascript
// OLD (fails because text is split):
expect(getByText('Test Field')).toBeTruthy();

// NEW (flexible matching):
expect(container.textContent).toContain('Test Field');
// OR check for both parts:
expect(getByText('Test')).toBeTruthy();
expect(getByText('Field')).toBeTruthy();
```

**Test 2 - Update to match current design:**
```javascript
// OLD:
const requiredBadge = container.querySelector('.required-badge');
expect(requiredBadge).toBeTruthy();
expect(requiredBadge.textContent).toBe('required');

// NEW:
const requiredMarker = container.querySelector('.required-marker');
expect(requiredMarker).toBeTruthy();
expect(requiredMarker.textContent).toBe('*');
expect(requiredMarker.getAttribute('aria-label')).toBe('required');
```

---

### 4. `update-banner-and-tools-about.test.jsx` (1 failure)

#### Test Failing
`ToolsDrawer About section > shows build info when buildInfo is provided`

#### What It's Testing
ToolsDrawer About section should display build information in the format:  
"Build abc1234 • 2025-03-03T12:00:00Z • main"

#### Why It's Failing
```javascript
expect(screen.getByText(/Build abc1234 • 2025-03-03T12:00:00Z • main/)).toBeInTheDocument();
```

**Error:** `Unable to find an element with the text: /Build abc1234 • 2025-03-03T12:00:00Z • main/. This could be because the text is broken up by multiple elements.`

**Cause:** Component renders build info across multiple `<span>` elements (ToolsDrawer.jsx lines 217-223):

```jsx
<div className="about-build-info">
  <span className="about-version">Build {gitSha.slice(0, 7)}</span>
  <span className="about-separator">•</span>
  <span className="about-time">{buildTime}</span>
  <span className="about-separator">•</span>
  <span className="about-branch">{branch}</span>
</div>
```

Testing Library's `getByText` can't find text that's split across multiple elements.

#### Are Tests Valid?
✅ **YES** - Verifying build info display is important, but test implementation needs update

#### What Needs to Be Fixed

**Option A - Check container text content:**
```javascript
const aboutSection = screen.getByText('About').closest('.card');
expect(aboutSection.textContent).toMatch(/Build abc1234.*2025-03-03T12:00:00Z.*main/);
```

**Option B - Check individual pieces:**
```javascript
expect(screen.getByText(/Build abc1234/)).toBeInTheDocument();
expect(screen.getByText('2025-03-03T12:00:00Z')).toBeInTheDocument();
expect(screen.getByText('main')).toBeInTheDocument();
```

**Option C - Use container query:**
```javascript
const buildInfo = container.querySelector('.about-build-info');
expect(buildInfo).toBeTruthy();
expect(buildInfo.textContent).toContain('Build abc1234');
expect(buildInfo.textContent).toContain('2025-03-03T12:00:00Z');
expect(buildInfo.textContent).toContain('main');
```

**Recommendation:** Option C - most robust and tests the actual structure

---

## Build Warnings (Not Test Failures)

### Duplicate `title` Attributes in NetworkingV2Step.jsx

**Issue:** Multiple `title` attributes on same input elements (lines 234-245, 272-289, and many more)

**Example:**
```jsx
<input
  className={fieldErrors.machineNetworkV4 ? "input-error" : ""}
  title={fieldErrors.machineNetworkV4 || ""}
  title={fieldErrors.machineNetworkV4 || ""}  // DUPLICATE
  title={fieldErrors.machineNetworkV4 || ""}  // DUPLICATE
  title={fieldErrors.machineNetworkV4 || ""}  // DUPLICATE
  value={networking.machineNetworkV4 || ""}
  onChange={...}
/>
```

**Why it happened:** Likely a merge conflict or copy-paste error during DOC-068 implementation (adding validation error tooltips)

**Impact:**
- ⚠️ Build warnings (not errors)
- ⚠️ Unpredictable browser behavior (only last title attribute is used)
- ⚠️ Invalid HTML

**How many duplicates:** Approximately 30+ input fields affected (all network CIDR fields, VIP fields for vSphere/Nutanix)

**Fix needed:** Remove duplicate `title` attributes, keep only one per input:
```jsx
<input
  className={fieldErrors.machineNetworkV4 ? "input-error" : ""}
  title={fieldErrors.machineNetworkV4 || ""}
  value={networking.machineNetworkV4 || ""}
  onChange={...}
/>
```

---

## Summary of Recommended Actions

### Immediate (Before Phase 2A)

1. **Fix NetworkingV2Step.jsx duplicate title attributes** (P0 - invalid HTML)
   - Remove ~30+ duplicate `title` attributes
   - Test validation tooltips still work

2. **Fix test: operations-log-download.test.jsx** (P1 - simple fix)
   - Change `.toBe(false)` to `.toBeFalsy()` for 2 tests

3. **Fix test: regression.test.jsx** (P1 - component changed)
   - Update required marker test to check for `.required-marker` instead of `.required-badge`
   - Update text matching to handle split labels

4. **Fix test: update-banner-and-tools-about.test.jsx** (P1 - split text)
   - Use container query to check build info across multiple spans

### Investigation Required

5. **Fix test: platform-specifics-step.test.jsx** (P1 - validation logic issue)
   - Investigate why resourceGroupName validation isn't firing for Azure Government IPI
   - Check validation.js conditional logic around lines 690-710 and 1350-1370

---

## Test Status Summary

| Test File | Status | Passing | Failing | Issue Type |
|---|---|---|---|---|
| operations-log-download.test.jsx | ⚠️ | 9 | 2 | JavaScript truthy/falsy semantics |
| platform-specifics-step.test.jsx | ⚠️ | 35 | 1 | Validation logic not running |
| regression.test.jsx | ⚠️ | 5 | 2 | Component design changed |
| update-banner-and-tools-about.test.jsx | ⚠️ | 10 | 1 | Text split across elements |
| **All other frontend tests** | ✅ | 576 | 0 | Passing |
| **Backend tests** | ✅ | 239 | 0 | All passing |

**Overall Frontend:** 641 passing, 6 failing (99% pass rate)  
**Overall Backend:** 239 passing, 0 failing (100% pass rate)

---

## Next Steps

Before proceeding with Phase 2A (YAML Drawer), recommend:

1. Fix duplicate title attributes in NetworkingV2Step.jsx (quick fix, high impact)
2. Fix 3 simple test updates (operations-log, regression, update-banner)
3. Investigate Azure Government validation issue (may reveal real bug)
4. Verify all tests pass before starting major feature work

**Estimated time:** 1-2 hours to fix all issues

**Risk:** Low - all failures are test implementation issues or minor bugs, not critical functionality breaks
