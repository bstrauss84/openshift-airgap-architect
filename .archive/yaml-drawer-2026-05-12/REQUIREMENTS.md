# YAML Drawer (DOC-034) - Comprehensive Requirements & Current State

**Date:** 2026-05-12  
**Phase:** 2A - YAML Drawer Implementation  
**Priority:** P1 (High)  
**Estimated Time:** 4-6 weeks

---

## Executive Summary

**Current State:** PARTIAL IMPLEMENTATION (Basic preview, ~20% of requirements met)  
**Status:** Active development needed  
**Blocking Issues:** 
1. Update delay (500ms debounce causes "next field" update behavior)
2. Limited tab coverage (only 5 tabs, missing 7+ tabs)
3. No drag-resize capability
4. No multi-config split view (install-config + agent-config)
5. No security obfuscation toggle
6. Fixed right pane (not drawer-style)
7. No download buttons per file
8. Missing ImageSet config pivot on Operators tab

---

## Complete Requirements (24 Specifications)

### 1. UI/UX Requirements (9 specs)

#### 1.1 Show/Hide YAML Button Placement ⚠️ PARTIALLY DONE
**Requirement:** Button placed **left of Tools button** in header  
**Current State:** Button exists in header actions on some tabs  
**Gap:** Button placement not standardized, not on all required tabs  
**Evidence:** `frontend/src/steps/IdentityAccessStep.jsx` line ~120 has button

#### 1.2 Right-Side Drawer ❌ NOT DONE
**Requirement:** Distinct drawer (not fixed pane), no conflict with Tools or Host Inventory  
**Current State:** Fixed `<aside className="preview-pane">` in App.jsx  
**Gap:** Not a drawer - it's a fixed right pane, no expand/collapse animation  
**Evidence:** `frontend/src/App.jsx` lines 1085-1114

#### 1.3 Expandable/Collapsible with Animation ❌ NOT DONE
**Requirement:** Smooth expand/collapse animation  
**Current State:** Shows/hides instantly with conditional render  
**Gap:** No animation, just appears/disappears

#### 1.4 Overlay or Push Content ❌ NOT DONE
**Requirement:** When expanded, overlays content or pushes left  
**Current State:** Fixed layout, doesn't overlay or push  
**Gap:** Layout needs rework

#### 1.5 Internal Scrollbars ✅ DONE
**Requirement:** Horizontal and vertical scrollbars  
**Current State:** Has scrollable `<pre>` element  
**Evidence:** `frontend/src/App.jsx` line 1099

#### 1.6 Syntax Highlighting ❌ NOT DONE
**Requirement:** YAML syntax highlighting  
**Current State:** Plain text in `<pre>` tag, no highlighting  
**Gap:** Need syntax highlighter library (e.g., Prism.js, highlight.js)

#### 1.7 Read-Only (Phase 6.1) ✅ DONE
**Requirement:** Read-only initially (edit mode is Phase 6.2 future work)  
**Current State:** Read-only `<pre>` tag  
**Status:** Correct for Phase 6.1

#### 1.8 Drag-Resize Capability ❌ NOT DONE
**Requirement:** Drag drawer edge to expand/shrink width, with limits to preserve left panel space  
**Current State:** Fixed width, no resize  
**Gap:** Need drag handle + resize logic + min/max width constraints

#### 1.9 Slick, Modern Design ⚠️ PARTIALLY DONE
**Requirement:** Appropriate visual polish  
**Current State:** Basic card design, functional but not polished  
**Gap:** Needs visual refinement (border, shadow, header styling)

---

### 2. Tab Visibility Requirements (2 specs)

#### 2.1 Visible Tabs ⚠️ PARTIALLY DONE
**Requirement:** Drawer visible on all tabs EXCEPT Landing, Blueprint, Assets & Guide, Operations  
**Current State:** Excluded steps in `previewEnabled`: landing, blueprint, assets-guide, operations, run-oc-mirror  
**Gap:** Incorrectly excludes `run-oc-mirror` (should show ImageSet config there!)  
**Evidence:** `frontend/src/App.jsx` line 428

**Should be visible on:**
- ✅ Identity & Access (works)
- ✅ Networking (works)
- ✅ Trust & Proxy (works)  
- ✅ Connectivity & Mirroring (works)
- ❌ Platform Specifics (missing - not confirmed tested)
- ❌ Hosts/Inventory (missing - not confirmed tested)
- ⚠️ Operators (excluded currently, but SHOULD show for ImageSet config)
- ❌ Run oc-mirror (excluded currently, but SHOULD show ImageSet config!)

#### 2.2 Button Visibility ⚠️ PARTIALLY DONE
**Requirement:** Show/Hide YAML button visible on same tabs as drawer  
**Current State:** `previewControls` passed to steps, but only some steps render button  
**Gap:** Not all eligible tabs have the button in their header  
**Evidence:** Need to audit which steps actually render the button

---

### 3. Config Display & Switching Requirements (4 specs)

#### 3.1 Agent-Based Paths: Split View ❌ NOT DONE
**Requirement:** Scrollable view with install-config.yaml (top half) + agent-config.yaml (bottom half)  
**Current State:** Shows single config only, no split view  
**Gap:** Need to detect agent-based scenarios and show 2 configs simultaneously  
**Evidence:** `frontend/src/App.jsx` only shows `previewFiles[previewTarget]`

#### 3.2 Non-Agent Paths: Single View ✅ DONE
**Requirement:** Show install-config.yaml only  
**Current State:** Shows install-config.yaml  
**Status:** Works for non-agent paths

#### 3.3 Operators Tab: ImageSet Config ❌ NOT DONE
**Requirement:** Pivot to imageset-config.yaml on Operators tab  
**Current State:** Preview pane doesn't even show on Operators tab  
**Gap:** Need to show ImageSet config when on Operators tab  
**Evidence:** Line 428 excludes from previewEnabled

#### 3.4 Run oc-mirror Tab: ImageSet Config Switching ❌ NOT DONE
**Requirement:** Show generated ImageSet by default, pivot to uploaded ImageSet when user provides one  
**Current State:** Preview pane excluded from this tab entirely  
**Gap:** Need complex logic to show generated vs uploaded ImageSet  
**Evidence:** Line 428 excludes run-oc-mirror

---

### 4. Download Buttons (1 spec)

#### 4.1 Download Per YAML File ❌ NOT DONE
**Requirement:** Separate download button for each YAML file (install-config, agent-config, ImageSet)  
**Current State:** No download buttons in preview pane  
**Gap:** Need download buttons that trigger file downloads  
**Note:** Review tab has download functionality - can reuse pattern

---

### 5. Warnings for Incomplete Files (1 spec)

#### 5.1 Incomplete Configuration Warnings ✅ DONE
**Requirement:** Show warnings when files incomplete, identify what's missing  
**Current State:** Shows "⚠️ Incomplete Configuration" warning  
**Evidence:** `frontend/src/App.jsx` lines 1094-1098  
**Status:** Works!

---

### 6. Sync Behavior (2 specs)

#### 6.1 Real-Time Live Updates ⚠️ BROKEN
**Requirement:** Updates reflect immediately as user fills wizard fields  
**Current State:** 500ms debounce delay causes "next field" update behavior  
**Issue:** When user changes field A, YAML doesn't update until they start editing field B  
**Root Cause:** `frontend/src/App.jsx` line 553 - `setTimeout(..., 500)` debounce  
**User Complaint:** "I only see updates after I start editing a second field... this is crappy behavior"  
**Evidence:** Lines 553-561 useEffect with 500ms timeout

**Expected Behavior:**
- Update when field exits (onBlur)
- Update when field changes (onChange) - immediate or very short debounce (<100ms)
- NOT when next field starts editing

**Fix Needed:**
- Remove 500ms debounce OR
- Reduce to 100ms OR  
- Trigger immediate update on field blur

#### 6.2 Recently Changed Highlights (Optional) ❌ NOT DONE
**Requirement:** Highlight recently changed sections  
**Status:** Optional enhancement, not required for Phase 6.1

---

### 7. Security Requirements (3 specs) - PARAMOUNT

#### 7.1 Credential Obfuscation by Default ❌ NOT DONE
**Requirement:** ALWAYS obfuscate pull secrets and credentials in YAML by default  
**Current State:** No obfuscation - credentials shown in plain text  
**Gap:** CRITICAL SECURITY ISSUE  
**Evidence:** Need to scan preview YAML and replace sensitive values with `***REDACTED***`

#### 7.2 "Show Sensitive Values" Toggle ❌ NOT DONE
**Requirement:** User must explicitly toggle to reveal credentials  
**Current State:** No toggle exists  
**Gap:** Need checkbox/toggle in drawer header  
**Implementation:** 
```jsx
<label>
  <input type="checkbox" checked={showSensitive} onChange={...} />
  Show sensitive values
</label>
```

#### 7.3 Never Persist Credentials ✅ DONE
**Requirement:** Credentials NEVER in commits, logs, localStorage  
**Current State:** Credentials not persisted (existing security model works)  
**Status:** Already compliant

---

### 8. Blueprint Pull Secret Carry-Over (1 spec)

#### 8.1 Pull Secret from Blueprint Tab ⚠️ NEEDS REVIEW
**Requirement:** If user keeps pull secret on Blueprint AND not using mirror registry, carry to drawer (obscured by default)  
**Current State:** Backend generates with pull secret from state  
**Gap:** Need to verify obfuscation when showing in drawer  
**Status:** Backend logic exists, frontend obfuscation needed

---

### 9. Technical Considerations (2 specs)

#### 9.1 No Drawer Conflicts ⚠️ UNKNOWN
**Requirement:** Don't conflict with Tools drawer or Host Inventory side panel  
**Current State:** Current right pane is fixed, so no drawer conflicts yet  
**Gap:** When implementing as drawer, need z-index hierarchy + positioning logic  
**Implementation:** Use `z-index: 10070` (higher than Tools drawer 10060)

#### 9.2 Mobile-Responsive ❌ NOT DONE
**Requirement:** Hide or overlay differently on small screens  
**Current State:** No mobile-specific behavior  
**Gap:** Need media queries + responsive layout

---

## Current Implementation Details

### Files Modified/Created
1. **frontend/src/App.jsx** (lines 192-194, 422-430, 447-575, 1085-1114)
   - `showPreview` state
   - `previewFiles` state  
   - `previewEnabled` logic
   - Preview generation useEffect
   - Preview pane render

2. **Step files with Show YAML button** (partial coverage):
   - `frontend/src/steps/IdentityAccessStep.jsx`
   - `frontend/src/steps/GlobalStrategyStep.jsx`
   - `frontend/src/steps/HostInventoryStep.jsx`
   - `frontend/src/steps/HostInventoryV2Step.jsx`
   - `frontend/src/steps/OperatorsStep.jsx` (button exists but preview disabled!)

### API Endpoint
- `POST /api/generate` - Generates YAML files
- Returns: `{ files: { "install-config.yaml": "...", "agent-config.yaml": "..." } }`

### CSS Classes
- `.preview-pane` - Right-side fixed pane
- `.card` - Card wrapper
- `.preview` - `<pre>` element for YAML content

---

## Gap Analysis Summary

| Category | Total Specs | Done | Partial | Not Done | %  Complete |
|---|---|---|---|---|---|
| UI/UX | 9 | 2 | 2 | 5 | 22% |
| Tab Visibility | 2 | 0 | 2 | 0 | 50% |
| Config Display | 4 | 1 | 0 | 3 | 25% |
| Download Buttons | 1 | 0 | 0 | 1 | 0% |
| Warnings | 1 | 1 | 0 | 0 | 100% |
| Sync Behavior | 2 | 0 | 1 | 1 | 25% |
| Security | 3 | 1 | 0 | 2 | 33% |
| Blueprint Carry-Over | 1 | 0 | 1 | 0 | 50% |
| Technical | 2 | 0 | 1 | 1 | 25% |
| **TOTAL** | **25** | **5** | **7** | **13** | **30%** |

---

## Critical Issues to Fix FIRST

### Issue #1: Update Delay (User Complaint) 🔥
**Problem:** 500ms debounce causes delayed updates - user sees update only when editing next field  
**File:** `frontend/src/App.jsx` line 553  
**Current Code:**
```javascript
const timeout = setTimeout(() => {
  apiFetch("/api/generate")
    .then(...)
}, 500);
```

**Fix Options:**
1. **Remove debounce entirely** - update immediately (might cause performance issues)
2. **Reduce to 100ms** - fast enough to feel instant, prevents excessive API calls
3. **Trigger on field blur** - update when user leaves field (cleanest UX)

**Recommendation:** Option 3 (field blur) + 100ms debounce for typing within field

### Issue #2: Missing Tabs (High Priority) 🔥
**Problem:** Preview excluded from Operators and Run oc-mirror tabs  
**File:** `frontend/src/App.jsx` line 428  
**Current:** `excludedSteps = ["landing", "blueprint", "assets-guide", "operations", "run-oc-mirror"]`  
**Should Be:** `excludedSteps = ["landing", "blueprint", "assets-guide", "operations"]`

**Fix:** Remove "run-oc-mirror" from excludedSteps, add logic to show ImageSet config

### Issue #3: Security Obfuscation (CRITICAL) 🔥
**Problem:** Credentials shown in plain text  
**Risk:** HIGH - security violation  
**Fix:** Implement credential masking before Phase 2A completes

---

## Recommendations

### Should We Use Plan Mode First?
**YES - STRONGLY RECOMMENDED**

**Reasons:**
1. **Complex Feature (30% complete, 70% remaining)** - 13 specs not done, 7 partial
2. **Multiple Files to Modify** - App.jsx, all step files, new drawer component, CSS
3. **Architectural Decisions Needed:**
   - Drawer component architecture (new component vs modify existing)
   - State management for drawer width/collapsed state
   - Security obfuscation strategy (client-side vs server-side)
   - Multi-config display strategy (tabs vs split panes)
4. **User Wants to Review Approach** - Plan mode lets you approve design before implementation
5. **Risk of Breaking Current Preview** - Current preview works (ish) - don't want to break it

**Plan Mode Benefits:**
- Explore codebase to understand preview generation fully
- Design drawer component architecture
- Plan security obfuscation strategy
- Identify all files that need modification
- Present approach for user approval before coding

### Should Work Be Delegated to Agents?
**PARTIALLY - WITH CAUTION**

**Can Delegate (Low Risk):**
1. **Syntax highlighting research** - Agent can research best YAML highlighter library
2. **CSS/animation work** - Agent can implement expand/collapse animation
3. **Download button implementation** - Straightforward, can delegate
4. **Mobile-responsive CSS** - Can delegate with clear breakpoint specs

**Should NOT Delegate (High Risk):**
1. **Fixing update delay issue** - Core UX issue, needs careful analysis
2. **Security obfuscation logic** - CRITICAL, must review carefully
3. **Multi-config split view** - Complex state management
4. **Drawer architecture decisions** - Foundational, sets pattern for rest

**Cannot Delegate (Requires Context):**
1. **Tab visibility logic changes** - Touches core routing/step logic
2. **Integration with existing drawers** - Requires understanding Tools/Host Inventory patterns

---

## Proposed Implementation Plan

### Phase 1: Plan Mode (1-2 hours)
1. Enter plan mode
2. Explore preview generation flow
3. Design drawer component architecture
4. Plan security obfuscation strategy
5. Identify all files to modify
6. Create step-by-step implementation plan
7. Get user approval

### Phase 2: Critical Fixes (1-2 days)
1. Fix update delay issue (Option 3: blur + 100ms debounce)
2. Implement security obfuscation (credential masking)
3. Fix tab visibility (add Operators, Run oc-mirror)
4. Test all three fixes thoroughly

### Phase 3: Drawer Component (2-3 days)
1. Create YamlDrawer component (separate from preview pane)
2. Implement expand/collapse animation
3. Implement drag-resize with limits
4. Move Show/Hide button to header (left of Tools)
5. Update z-index hierarchy (no conflicts)

### Phase 4: Multi-Config Display (2-3 days)
1. Detect agent-based scenarios
2. Implement split view (install-config + agent-config)
3. Implement ImageSet config pivot (Operators tab)
4. Implement ImageSet switching (Run oc-mirror tab)

### Phase 5: Polish & Features (1-2 days)
1. Add syntax highlighting
2. Add download buttons per file
3. Improve visual design
4. Mobile-responsive behavior
5. Add "Show sensitive values" toggle

### Phase 6: Testing (1-2 days)
1. Test all tabs
2. Test drag-resize
3. Test security obfuscation
4. Test multi-config scenarios
5. Test mobile responsive
6. Document usage

**Total Estimated Time:** 8-12 days (2-3 weeks with testing)

---

## Next Steps

**Immediate Actions:**
1. ✅ **Enter Plan Mode** - Design comprehensive approach
2. ⏳ **Fix Critical Issue #1** - Update delay (user complaint)
3. ⏳ **Fix Critical Issue #2** - Tab visibility
4. ⏳ **Fix Critical Issue #3** - Security obfuscation

**Do NOT:**
- Start implementing without plan approval
- Break existing preview functionality
- Delegate security-critical work
- Skip testing after each phase

---

**Created:** 2026-05-12  
**For:** DOC-034 Phase 2A YAML Drawer Implementation  
**Status:** Ready for Plan Mode
