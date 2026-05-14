# Comprehensive Master Plan - OpenShift Airgap Architect
## All Remaining Work Phases & Tasks

**Last Updated:** 2026-05-10
**Status:** Active Development  
**Current Focus:** Phases 1-2 COMPLETE (100% tooltip coverage) - Next: Phase 9 (Testing & Validation)

---

## Table of Contents
1. [Phase 1: Comprehensive Tooltip Expansion](#phase-1-comprehensive-tooltip-expansion)
2. [Phase 2: Tooltip Reformatting (Earlier Batches)](#phase-2-tooltip-reformatting-earlier-batches)
3. [Phase 3: Trust & Export Features](#phase-3-trust--export-features)
4. [Phase 4: Field Guide Enhancements](#phase-4-field-guide-enhancements)
5. [Phase 5: Single-Value Dropdown Review](#phase-5-single-value-dropdown-review)
6. [Phase 6: YAML View Drawer](#phase-6-yaml-view-drawer)
7. [Phase 7: Uniformity & Consistency Audit](#phase-7-uniformity--consistency-audit)
8. [Phase 8: Backend Test Consolidation](#phase-8-backend-test-consolidation)
9. [Phase 9: Testing & Validation](#phase-9-testing--validation)
10. [Phase 10: Systematic Scenario Validation](#phase-10-systematic-scenario-validation)

---

## Phase 1: Comprehensive Tooltip Expansion
**Status:** ✅ COMPLETE (100/100 FieldLabelWithInfo tooltips, 100%)  
**Completion Date:** 2026-05-10  
**Priority:** P0 (Critical)  
**Actual Time:** Batches 1-26 completed over May 3-10, 2026  
**Evidence:** See `docs/BACKLOG_STATUS.md` DOC-049, DOC-056; `TOOLTIP_COMPLETION_2026-05-10.md`

### Gold Standard Reference
**Model:** `Cluster Name` field in `IdentityAccessStep.jsx` (lines 210-224)

```jsx
<FieldLabelWithInfo
  label="Cluster Name"
  hint="Short identifier for this cluster (lowercase alphanumeric and hyphens only, no underscores or special chars). This becomes part of your cluster's URLs and DNS records. Example: 'prod-cluster' or 'dev-ocp'. The full cluster domain will be <cluster-name>.<base-domain> - e.g., prod-cluster.example.com. API endpoint becomes api.prod-cluster.example.com and applications are *.apps.prod-cluster.example.com. Keep it short (under 15 characters recommended) and descriptive. This cannot be changed after installation."
  required
/>
```

### Quality Standards (Applied to EVERY Field)
Each tooltip MUST:
1. ✅ Never just repeat the field label
2. ✅ Explain WHAT to enter (format, examples, expected values)
3. ✅ Explain WHY it's needed (purpose, impact on deployment)
4. ✅ Explain WHEN to use it (scenarios where required vs. optional)
5. ✅ Provide examples (real-world values)
6. ✅ Use beginner-friendly language (no unexplained jargon)
7. ✅ Include "This cannot be changed" if immutable

### Formatting Standard (Applied from Batch 4+)
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

### Params.json Cross-Validation (MANDATORY)
For EACH tooltip expansion, cross-reference against params.json files:

**Locations:**
- `frontend/src/data/catalogs/*.json`
- `data/params/4.20/*.json`

**Validation Checklist:**
- [ ] **allowed values**: Tooltip claims match params.json "allowed" field
- [ ] **required status**: Tooltip "required" matches params.json required=true/false
- [ ] **default value**: Tooltip default mentions match params.json "default"
- [ ] **type**: Tooltip describes correct data type (string, int, bool, array, object)
- [ ] **Note inconsistencies**: Document when tooltip conflicts with params.json
- [ ] **Note missing params**: Document when params.json missing fields that exist in UI

### Progress Tracking

#### ✅ ALL BATCHES COMPLETE (100%)

**Platform Specifics Tooltips (Batches 1-14):**
- ✅ **Batches 1-10** (58 tooltips) - vSphere, AWS, Azure, IBM Cloud, Nutanix
- ✅ **Batch 11** (3 tooltips) - Nutanix IPI fields
- ✅ **Batch 12** (3 tooltips) - Bare Metal provisioning
- ✅ **Batch 13** (3 tooltips) - Bare Metal provisioning network
- ✅ **Batch 14** (2 tooltips) - vSphere legacy deprecated fields

**Reformatting + New Tooltips (Batches 15-26):**
- ✅ **Batches 15-26** (87 tooltips) - Applied **bold** markdown formatting to all
- ✅ **Batch 27** (14 tooltips) - Missing fields: SSH Key, FIPS, CA bundles, 9 pull secrets

**Infrastructure Fixes:**
- ✅ **JSX Parsing Fix** - All hints use template literals
- ✅ **Tooltip Rendering Fix** - Line breaks and **bold** formatting enabled
- ✅ **Scroll Behavior Fix** - Tooltips don't auto-close while scrolling

**Final Coverage:**
- **100 FieldLabelWithInfo tooltips** with gold standard **bold** formatting
- **14 additional tooltips** added to previously uncovered fields
- **All tabs covered:** Platform Specifics, Identity & Access, Networking, Connectivity, Trust & Proxy, Operators, Run oc-mirror, Host Inventory

**Total Complete:** 100/100 required tooltips (100%)

### Completion Summary
All tooltips now meet gold standard criteria:
1. ✅ Template literal syntax `{`...`}` for multiline content
2. ✅ **Bold** section headers (renders as yellow highlighting)
3. ✅ Comprehensive WHAT/WHY/WHEN/FORMAT/EXAMPLE/IMPORTANT sections
4. ✅ Beginner-friendly language with real-world examples
5. ✅ Security warnings and immutability notes where applicable
6. ✅ Code snippets and JSON examples with proper formatting

### Discrepancies Found
1. ⚠️ `platform.nutanix.storageContainer` - not in nutanix-ipi.json catalog
2. ⚠️ `platform.nutanix.prismCentral.username` - should clarify "optional"
3. ⚠️ `platform.vsphere.folder`, `platform.vsphere.resourcePool` - deprecated (not in catalog, expected)

---

## Phase 2: Tooltip Reformatting (Earlier Batches)
**Status:** ✅ COMPLETE (100%)  
**Completion Date:** 2026-05-10  
**Priority:** P2  
**Actual Time:** Completed as part of Batches 16-26  
**Evidence:** See `docs/BACKLOG_STATUS.md` DOC-049; `TOOLTIP_COMPLETION_2026-05-10.md`

### Completed Work
All tooltips from Batches 1-10 (and all subsequent batches) now use the structured **bold** markdown formatting standard.

### Reformatted Batches
- ✅ Batch 1: vSphere Failure Domain & Machine Pool (11 tooltips)
- ✅ Batch 2: AWS & Nutanix (6 tooltips)
- ✅ Batch 3: Azure Government (4 tooltips)
- ✅ Batch 4: IBM Cloud Region/Resources (6 tooltips)
- ✅ Batch 5: IBM Cloud Subnets & Encryption (5 tooltips)
- ✅ Batch 6: Advanced & Nutanix (6 tooltips)
- ✅ Batch 7: AWS GovCloud (7 tooltips)
- ✅ Batch 8: vSphere Zones & Template (3 tooltips)
- ✅ Batch 9: AWS/vSphere/IBM (6 tooltips)
- ✅ Batch 10: Nutanix Endpoint/Credentials (4 tooltips)

### Applied Formatting
- ✅ NEW FORMATTED structure (paragraphs, **bold** headers, bullets)
- ✅ All content maintained, presentation restructured
- ✅ Consistent WHAT/WHY/WHEN/FORMAT/EXAMPLE/IMPORTANT sections

---

## Phase 3: Trust & Export Features
**Status:** NOT STARTED  
**Priority:** P3 (Lower priority)  
**Estimated Time:** 4-6 days total

### Phase 3.1: Add help/explanation mode for trust concepts
**Description:** Educational mode explaining certificate chains, trust bundles, CA hierarchy

**Requirements:**
- Modal or expandable section with educational content
- Diagrams/illustrations of trust chain concepts
- Examples of valid vs. invalid certificate scenarios
- Integration point: Trust & Proxy step

**Deliverables:**
- [ ] Help mode UI component
- [ ] Educational content written
- [ ] Integration with Trust & Proxy step
- [ ] User testing/feedback

### Phase 3.2: Add trust path testing for endpoints
**Description:** Validate that trust bundle covers all endpoints the cluster needs

**Requirements:**
- Test registry URLs against configured trust bundle
- Test proxy URLs if configured
- Test mirror registry URL if configured
- Surface warnings for uncovered endpoints

**Deliverables:**
- [ ] Trust path validation logic
- [ ] UI to display validation results
- [ ] Warning/error messages for gaps
- [ ] Documentation

### Phase 3.3: Add export preview for install-config.yaml
**Description:** Preview install-config.yaml before export

**Requirements:**
- Syntax-highlighted YAML preview
- Toggle between all generated configs (install-config, agent-config, imageset-config)
- Copy-to-clipboard functionality
- Validation warnings inline

**Deliverables:**
- [ ] YAML preview component
- [ ] Syntax highlighting
- [ ] Multi-config toggle
- [ ] Copy button
- [ ] Integration with Assets & Guide / Review steps

---

## Phase 4: Field Guide Enhancements
**Status:** NOT STARTED  
**Priority:** P2  
**Estimated Time:** 2-3 days

### 4.1: Scenario Summary Dropdown Enhancement

**Current State:** Brief generic summary in dropdown

**Goal:** Robust, comprehensive scenario-specific summary with **live updating** behavior

**Requirements:**
- Expand each scenario summary to include:
  - Platform overview (what it is, why choose it)
  - Key prerequisites
  - Network requirements
  - Common gotchas
  - Link to official OpenShift docs for that scenario
- Match tooltip comprehensiveness standard
- Use structured formatting (paragraphs, bullets)
- **Live updating values:** Summary dynamically reflects user's actual configuration as they make selections:
  - Proxy enabled/disabled
  - FIPS on/off
  - NTP servers configured
  - Dual-stack networking
  - Mirror registry usage
  - Other scenario-specific selections
- **Documentation sources section:** Replicate the accurate documentation sources section from Field Guide, with **live real-time links** to docs relevant to the user's specific scenario + configurations
- **Implementation note:** Review Field Guide generation logic for initial summary section and documentation sources section; apply same behavior to scenario summary dropdown

**Scenarios to Enhance:**
- [ ] vSphere IPI
- [ ] vSphere UPI  
- [ ] vSphere Agent
- [ ] Bare Metal IPI
- [ ] Bare Metal UPI
- [ ] Bare Metal Agent
- [ ] AWS GovCloud IPI
- [ ] AWS GovCloud UPI
- [ ] Azure Government IPI
- [ ] Azure Government UPI
- [ ] Nutanix IPI
- [ ] IBM Cloud IPI

**Deliverables:**
- [ ] Enhanced summaries for all 12+ scenarios
- [ ] Live updating logic integrated
- [ ] Documentation sources section with real-time links
- [ ] Validation that summaries match official docs
- [ ] User feedback on clarity

**Canonical tracking:** See `docs/BACKLOG_STATUS.md` DOC-058

---

## Phase 5: Single-Value Dropdown Review
**Status:** NOT STARTED  
**Priority:** P2  
**Estimated Time:** 1-2 days

### Goal
Identify and rationalize dropdowns with only one possible value

### Process
1. **Audit all dropdown fields** across all scenarios
2. **Identify single-value dropdowns** (e.g., Azure cloudName = "AzureUSGovernmentCloud")
3. **Cross-reference with OpenShift 4.20/4.21 docs** - confirm field truly only allows one value
4. **Decision for each:**
   - **Remove field entirely** (auto-populate behind the scenes)
   - **Convert to read-only display** (show but don't let user change)
   - **Keep dropdown** (if OpenShift docs suggest future values may be added)
5. **Document rationale** for each decision

### Known Candidates
- [ ] Azure `cloudName` (only AzureUSGovernmentCloud?)
- [ ] Others TBD during audit

### Deliverables
- [ ] Audit spreadsheet: field, scenario, current values, doc-allowed values, decision
- [ ] Implementation of removals/conversions
- [ ] Tests updated
- [ ] Documentation updated

---

## Phase 6: YAML View Drawer
**Status:** NOT STARTED  
**Priority:** P1 (elevated from P2)  
**Estimated Time:** 4-6 days (increased scope)

### Goal
Persistent, optional YAML view drawer showing generated configs with **security-first design**

### Requirements

**UI/UX:**
- **Show/Hide YAML button** placed to the **left of the Tools button** in header
- Right-side drawer (distinct from Tools drawer and Host Inventory side panel - **no conflict**)
- Expandable/collapsible with **smooth expand/collapse animation**
- When expanded: overlays content area (or pushes it left)
- When collapsed: hidden completely
- Internal horizontal and vertical scrollbars
- Syntax-highlighted YAML
- Read-only initially (edit mode is future Phase 6.2)
- **Drag-resize capability:** Allow user to drag drawer edge to expand/shrink width, with **limits** to ensure left panel sections retain enough space
- **Slick, modern design** with appropriate visual polish

**Tab Visibility:**
- Drawer and Show/Hide YAML button visible on **all tabs EXCEPT:**
  - Landing page
  - Blueprint page
  - Assets & Guide page
  - Operations page

**Config Display & Switching:**
- **Agent-based paths:** Show scrollable view with:
  - **install-config.yaml** (top half of drawer space)
  - **agent-config.yaml** (bottom half of drawer space)
  - Each config independently scrollable
- **Non-agent paths:** Show install-config.yaml only
- **Operators tab:** Pivot to **ImageSet config** (imageset-config.yaml)
- **Run oc-mirror tab:** 
  - Show generated ImageSet config by default if available (when drawer set to "Show")
  - Pivot to uploaded ImageSet config when user specifies and provides one in Run oc-mirror options

**Download Buttons:**
- **Download button per YAML file** displayed (e.g., separate downloads for install-config, agent-config, ImageSet config)

**Warnings for Incomplete Files:**
- Show clear warnings/badges when files are incomplete
- Identify what's missing before user can treat files as valid

**Sync Behavior:**
- **Real-time live updates** as user fills out wizard fields
- Updates reflect immediately in YAML view
- Highlights recently changed sections (optional enhancement)

**Security Requirements (PARAMOUNT):**
- **ALWAYS obfuscate pull secrets and credential fields** in YAML display by default
- User must **explicitly toggle "Show sensitive values"** to reveal credentials in drawer
- Credentials **NEVER** included in:
  - Git commits
  - Logs (frontend or backend)
  - localStorage or any persistence
- Security golden rules already in place must not be violated

**Blueprint Pull Secret Carry-Over:**
- If user specifies on Blueprint page to keep Red Hat pull secret in memory/cache
- AND user is NOT using mirror registry
- Then pull secret can carry over to drawer in same way it carries to subsequent tabs
- BUT pull secret must be **obscured/hidden by default** in drawer
- Only shown if user explicitly toggles "Show sensitive values"

**Technical Considerations:**
- Don't conflict with Tools drawer or Host Inventory side panel
- Use same drawer/modal z-index hierarchy
- Mobile-responsive (maybe hide or overlay differently on small screens)
- Performant (debounce YAML regeneration)
- Drag-resize must respect minimum left panel width constraints

### Phases

**Phase 6.1: Read-Only YAML Drawer (Initial)**
- [ ] UI component (drawer, toggle, tabs)
- [ ] Syntax highlighting (YAML)
- [ ] Live sync from state
- [ ] Copy buttons
- [ ] Context-aware config switching
- [ ] Mobile-responsive behavior

**Phase 6.2: Editable YAML (Future)**
- [ ] Two-way sync (edit YAML → update state)
- [ ] Validation before applying edits
- [ ] Conflict resolution (what if user edits YAML while changing fields?)
- [ ] Undo/redo for YAML edits
- [ ] Warning banners ("Direct YAML edit mode - advanced users only")

### Deliverables (Phase 6.1)
- [ ] YAML drawer component with drag-resize
- [ ] Show/Hide YAML button (left of Tools button)
- [ ] Tab visibility logic (hide on Landing, Blueprint, Assets/Guide, Operations)
- [ ] Multi-config display (install-config + agent-config split view for agent paths)
- [ ] Download buttons per YAML file
- [ ] Incomplete file warnings
- [ ] Security: credential obfuscation by default + "Show sensitive values" toggle
- [ ] Real-time live updates from wizard state
- [ ] Integration with all visible tabs
- [ ] Syntax highlighting (YAML)
- [ ] Copy buttons per config
- [ ] Conflict avoidance with Tools drawer and Host Inventory panel
- [ ] Mobile-responsive behavior
- [ ] Expand/collapse animation
- [ ] Tests (drawer open/close, config switching, download, security obfuscation, drag-resize, tab visibility)
- [ ] Documentation

**Canonical tracking:** See `docs/BACKLOG_STATUS.md` DOC-034

---

## Phase 7: Uniformity & Consistency Audit
**Status:** NOT STARTED  
**Priority:** P2  
**Estimated Time:** 2-3 days

### Goal
Ensure consistent spacing, fonts, positioning, formatting across ALL scenarios

### Scope
- **All tabs:** Identity & Access, Networking, Platform Specifics, Trust & Proxy, Host Inventory, etc.
- **All scenarios:** vSphere IPI/UPI/Agent, Bare Metal, AWS, Azure, Nutanix, IBM Cloud
- **All components:** Cards, field grids, buttons, labels, hints, modals, drawers

### Audit Checklist

**Typography:**
- [ ] Font sizes consistent (headings, body, labels, hints)
- [ ] Font weights consistent
- [ ] Line heights consistent
- [ ] Text colors consistent (light mode and dark mode)

**Spacing:**
- [ ] Card padding consistent
- [ ] Section margins consistent
- [ ] Field grid gaps consistent
- [ ] Button spacing consistent
- [ ] Subsection header margins consistent

**Layout:**
- [ ] Field grid column widths consistent
- [ ] Label alignment consistent (top, left, wrapping behavior)
- [ ] Info icon positioning consistent
- [ ] Required badge placement consistent
- [ ] Error message placement consistent

**Component Structure:**
- [ ] All hints use FieldLabelWithInfo
- [ ] All cards have card-header/card-title/card-subtitle structure
- [ ] All sections use consistent class names
- [ ] All modals use shared Modal component

**Dark Mode:**
- [ ] All colors have dark mode overrides
- [ ] Contrast ratios meet accessibility standards
- [ ] Dark mode toggles correctly everywhere

### Process
1. **Pick one scenario/tab as reference** (e.g., vSphere IPI Identity & Access)
2. **Document all spacing/sizing values** from reference
3. **Audit every other scenario/tab** against reference
4. **Document deviations** in spreadsheet
5. **Fix deviations** in batches
6. **Visual regression testing** (before/after screenshots)

### Deliverables
- [ ] Uniformity audit spreadsheet
- [ ] CSS/component fixes
- [ ] Before/after screenshots
- [ ] Style guide documentation (optional - document the standard)

---

## Phase 8: Backend Test Consolidation
**Status:** NOT STARTED  
**Priority:** P3  
**Estimated Time:** 1 day

### Goal
Consolidate backend test fixtures into shared files

### Current State
- Test fixtures scattered across individual test files
- Duplication of common state objects
- Hard to maintain consistency

### Target State
- Shared fixtures in `backend/test/fixtures/`
- Common state builders/factories
- Easy to import and reuse
- Clear documentation

### Tasks
- [ ] Audit current test fixtures across all backend tests
- [ ] Identify common patterns (minimal state, full state, scenario variations)
- [ ] Create shared fixture files:
  - `backend/test/fixtures/states.js` (common state objects)
  - `backend/test/fixtures/builders.js` (state builder functions)
  - `backend/test/fixtures/install-configs.js` (expected outputs)
- [ ] Refactor tests to use shared fixtures
- [ ] Remove duplication
- [ ] Add documentation

### Deliverables
- [ ] Shared fixture files
- [ ] Refactored tests
- [ ] Documentation (how to use fixtures)
- [ ] All tests still passing

---

## Phase 9: Testing & Validation
**Status:** NOT STARTED  
**Priority:** P1 (Before release)  
**Estimated Time:** 2-3 days

### 9.1: Visual Regression Testing
- [ ] All resolutions: 1920px, 1366px, 768px, 375px
- [ ] Zoom levels: 100%, 125%, 150%, 200%
- [ ] Light mode and dark mode
- [ ] All scenarios, all tabs
- [ ] Screenshot comparisons (baseline vs current)

### 9.2: Responsive Behavior Testing
- [ ] Breakpoint transitions work correctly
- [ ] No horizontal scroll on mobile
- [ ] Touch targets appropriately sized
- [ ] Drawers/modals work on small screens

### 9.3: Functional Testing
- [ ] End-to-end wizard flows for each scenario
- [ ] Form validation works correctly
- [ ] State persistence across navigation
- [ ] Export bundle generation
- [ ] Field guide generation
- [ ] Operator scanning (if credentials provided)
- [ ] oc-mirror workflows

### 9.4: Accessibility Testing
- [ ] Keyboard navigation (Tab, Shift+Tab, Enter, Esc)
- [ ] ARIA labels present and correct
- [ ] Screen reader testing
- [ ] Color contrast ratios (WCAG AA)
- [ ] Focus indicators visible
- [ ] No keyboard traps

### Deliverables
- [ ] Test results documentation
- [ ] Bug list (if any found)
- [ ] Fixes for critical bugs
- [ ] Accessibility audit report

---

## Phase 10: Systematic Scenario Validation
**Status:** NOT STARTED  
**Priority:** P1 (Quality assurance)  
**Estimated Time:** 2-3 days

### Goal
Validate ALL 12+ install scenarios against comprehensive checklist

### User Request
"Systematically checking each of those boxes for each and every tab, section, field, component, for each and every install scenario"

### Scenarios to Validate
- [ ] vSphere IPI
- [ ] vSphere UPI
- [ ] vSphere Agent
- [ ] Bare Metal IPI
- [ ] Bare Metal UPI
- [ ] Bare Metal Agent
- [ ] AWS GovCloud IPI
- [ ] AWS GovCloud UPI
- [ ] Azure Government IPI
- [ ] Azure Government UPI
- [ ] Nutanix IPI
- [ ] IBM Cloud IPI

### Validation Checklist (Per Scenario)

**Per Field:**
- [ ] Tooltip comprehensive (gold standard)
- [ ] Validation works correctly
- [ ] Required/optional status correct
- [ ] Default values correct
- [ ] Allowed values enforced
- [ ] Error messages helpful
- [ ] Params.json alignment verified

**Per Section:**
- [ ] Card structure consistent
- [ ] Spacing uniform
- [ ] Conditional logic works (show/hide based on choices)
- [ ] Help text accurate

**Per Tab:**
- [ ] Navigation works
- [ ] State saves on next/back
- [ ] Validation prevents progress when incomplete
- [ ] Progress indicator updates

**Per Scenario:**
- [ ] Generated install-config.yaml valid
- [ ] Generated agent-config.yaml valid (if applicable)
- [ ] Generated imageset-config.yaml valid (if operators selected)
- [ ] Field guide accurate and complete
- [ ] Export bundle contains all expected files
- [ ] No console errors
- [ ] Performance acceptable

### Process
1. **Create scenario validation matrix** (spreadsheet)
2. **For each scenario, go through checklist** (manual testing)
3. **Document findings** (pass/fail, notes)
4. **Fix failures** as they're found
5. **Retest after fixes**
6. **Sign off when all pass**

### Deliverables
- [ ] Scenario validation matrix (12+ scenarios x 50+ checkpoints)
- [ ] Bug list
- [ ] Fixes implemented
- [ ] Final validation report

---

## Success Criteria by Phase

### Phase 1 Complete
- [ ] All 174 tooltips expanded to comprehensive content
- [ ] All tooltips validated against params.json
- [ ] All discrepancies documented
- [ ] Build passing, tests passing

### Phase 2 Complete
- [ ] All 58 early-batch tooltips reformatted to structured standard
- [ ] Consistent formatting across all 174 tooltips

### Phase 3 Complete
- [ ] Help mode for trust concepts implemented
- [ ] Trust path testing working
- [ ] Export preview functional

### Phase 4 Complete
- [ ] All scenario summaries enhanced
- [ ] Summaries validated against official docs

### Phase 5 Complete
- [ ] All single-value dropdowns audited
- [ ] Unnecessary dropdowns removed or converted
- [ ] Rationale documented

### Phase 6 Complete (6.1)
- [ ] YAML drawer functional (read-only)
- [ ] Live sync working
- [ ] Config switching working
- [ ] Mobile-responsive

### Phase 7 Complete
- [ ] Uniformity audit complete
- [ ] All deviations fixed
- [ ] Style guide documented

### Phase 8 Complete
- [ ] Test fixtures consolidated
- [ ] Tests refactored
- [ ] All tests passing

### Phase 9 Complete
- [ ] Visual regression passed
- [ ] Functional testing passed
- [ ] Accessibility audit passed
- [ ] Critical bugs fixed

### Phase 10 Complete
- [ ] All scenarios validated
- [ ] Validation matrix complete
- [ ] All failures fixed
- [ ] Final sign-off

---

## Priority & Timeline

### Critical Path (Must Do Before Release)
1. **Phase 1** - Tooltip Expansion (4-6 days) ← IN PROGRESS
2. **Phase 2** - Tooltip Reformatting (5-10 hours)
3. **Phase 9** - Testing & Validation (2-3 days)
4. **Phase 10** - Scenario Validation (2-3 days)

**Total Critical:** ~10-13 days

### High Priority (Should Do Soon)
5. **Phase 4** - Field Guide Enhancements (2-3 days)
6. **Phase 5** - Single-Value Dropdown Review (1-2 days)
7. **Phase 7** - Uniformity Audit (2-3 days)

**Total High Priority:** ~5-8 days

### Medium Priority (Nice to Have)
8. **Phase 6.1** - YAML Drawer (Read-Only) (3-4 days)
9. **Phase 3.1-3.3** - Trust & Export Features (4-6 days)

**Total Medium Priority:** ~7-10 days

### Lower Priority (Future)
10. **Phase 8** - Test Consolidation (1 day)
11. **Phase 6.2** - YAML Drawer (Editable) (3-4 days)

---

## Current Status & Next Steps

### Where We Are
- **Phase 1:** Batch 14 complete (71/174, 41%)
- **All other phases:** Not started

### Immediate Next Steps (Batch 15)
1. **Identify next 2-5 fields** to expand (continue bare metal IPI or start AWS optionals)
2. **Expand tooltips** using gold standard structure
3. **Validate against params.json**
4. **Test build** (npm run build, npm test hint-syntax)
5. **Commit & push** (Batch 15: <summary> (X/174, ~Y%))
6. **Update tracking files** and this master plan

### Post-Phase 1 Decision Point
After completing all 174 tooltips and reformatting:
- **Estimate remaining work:** ~20-30 days (all phases)
- **Prioritize based on user feedback:** What's most important?
- **Consider MVP release:** Ship with Phases 1-2, 9-10 complete?

---

## Related Documents
- `TOOLTIP_EXPANSION_MASTER_PLAN.md` - Original tooltip-specific plan (superseded by Phase 1-2 of this doc)
- `LOCAL_BACKLOG.md` - Overall backlog (50+ items, different scope)
- `/tmp/tooltip-catalog-validation-notes.md` - Batch-by-batch validation tracking
- `/tmp/tooltip-reformatting-todo.md` - Phase 2 checklist
- `/tmp/tooltip-decision-logic.md` - Tooltip vs printed notes standards
- `frontend/tests/hint-syntax.test.js` - JSX syntax validation

---

**Maintained by:** Claude Sonnet 4.5  
**Project:** OpenShift Airgap Architect  
**Repository:** bstrauss84/openshift-airgap-architect  
**Last Review:** 2026-05-09
