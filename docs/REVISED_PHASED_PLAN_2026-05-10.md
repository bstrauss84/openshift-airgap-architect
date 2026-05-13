# Revised Phased Implementation Plan

**Created:** 2026-05-10  
**Based on:** Backlog Review 2026-05-10  
**Objective:** Clean, actionable phases based on verified backlog status and user priorities

---

## Context

After systematic backlog review (see `docs/BACKLOG_REVIEW_2026-05-10.md`):

- **10 items upgraded to verified_done**
- **4 items deferred to high-side feature branch**
- **3 merges** (DOC-032+COMP7, COMP9+COMP10, DOC-059+LOCAL#7)
- **1 removal** (LOCAL #45 covered by other items)
- **Clean baseline established:** ~40 active items requiring work

---

## Phase Sequencing

### **Phase 0: Quick Wins & Foundation** ✅ **COMPLETE**

**Priority:** P0/P1  
**Goal:** Clear blockers, establish momentum, fix high-value bugs  
**Status:** 12 of 12 items complete (100%)  
**Completed:** 2026-05-12

#### Completed Items (12)

- ✅ **DOC-021:** Header actions a11y/keyboard tests (verified_done 2026-05-10)
- ✅ **DOC-024:** Node drawer duplicate hostname validation (verified_done 2026-05-12)
- ✅ **DOC-025:** Bare metal provisioning network audit (verified_done 2026-05-12 - already existed)
- ✅ **DOC-036:** Import-run reload override fix (verified_done 2026-05-10)
- ✅ **DOC-061:** Double proxy field width (verified_done 2026-05-10)
- ✅ **DOC-062:** Clear selections button for Operators tab (verified_done 2026-05-10)
- ✅ **DOC-064:** Sidebar operational tabs exclusion (verified_done 2026-05-12)
- ✅ **DOC-065:** Operators collapsible catalog selection (verified_done 2026-05-12)
- ✅ **DOC-066:** Scan Status conditional auto-expansion (verified_done 2026-05-12)
- ✅ **DOC-067:** ImageSet fields standardized tooltips (verified_done 2026-05-12)
- ✅ **DOC-068:** Validation error tooltips on alert icons (verified_done 2026-05-12)
- ✅ **LOCAL #5:** Frontend/backend logs expansion (verified_done 2026-05-12)

#### Success Criteria

- ✅ 12/12 Phase 0 items marked verified_done
- ✅ Tests passing
- ✅ No regressions
- ✅ All quick wins complete

---

### **Phase 1: Critical Audits & Research** (2-3 weeks)

**Priority:** P1  
**Goal:** Establish foundational knowledge before major features  
**Dependencies:** Phase 0 complete

#### Items (3)

- **DOC-031:** Disconnected scenario support audit ⭐ **FOUNDATIONAL**
  - Produce scenario-by-scenario matrix
  - Document gaps with priority
  - Output: `docs/DISCONNECTED_SCENARIO_MATRIX.md`
- **DOC-035:** Platform: none research and implementation
  - Research valid platform: none paths per 4.20 docs
  - Implement scenario gating + generation + validation
  - Dependencies: DOC-031 (disconnected audit)
- **DOC-040:** UPI support expansion
  - Identify repeatable UPI prep tasks
  - Add standardized helpers/templates
  - Dependencies: DOC-031, DOC-039 (when unblocked)

#### Success Criteria

- Disconnected scenario matrix complete
- Platform: none support boundaries documented
- UPI helper framework established

---

### **Phase 2: Major UI Features** (6-8 weeks total, can parallelize)

**Priority:** P1/P2  
**Goal:** High-value user-facing features  
**Dependencies:** Phase 0-1 complete

#### 2A: YAML Drawer ✅ **COMPLETE** (verified 2026-05-12)

- ✅ **DOC-034:** Live-updating YAML drawer with security-first design — verified_done 2026-05-12
  - All 24 specifications implemented and tested
  - Security obfuscation with "Show sensitive values" toggle
  - Vertical drag-resize (350-800px), horizontal split for agent-based
  - Real-time updates (100ms debounce)
  - Syntax highlighting, download buttons, mobile responsive
  - Commits: 3858d60, 9475242, 377f9a2, ee686b2, f29e70c, db4bfdc

- ✅ **YAML Drawer Bug Fixes** — verified_done 2026-05-13
  - **Critical Fix:** Removed showPreview guard that blocked YAML generation during imports (App.jsx:556)
  - **Race Condition Fix:** Added request ID tracking and AbortController to ReviewStep.jsx
  - **Debugging Protocol:** Added comprehensive debugging guidelines to CLAUDE.md
  - **Evidence:** Commits 459e7bc, 022c43c
  - **Verification:** All 4 test scenarios passing (initial load, import, methodology change, hide/show)
  - **Lessons Learned:** Documented in `.research/POSTMORTEM_WHY_I_FAILED.md`

#### 2B: Preview & Summary Enhancements ✅ **COMPLETE** (verified 2026-05-11)

- ✅ **DOC-057:** Preview panels always display (incomplete warnings) — verified_done 2026-05-10
- ✅ **DOC-058:** Scenario summary dropdown rework (live updating + docs sources) — verified_done 2026-05-11
- ⏳ **DOC-063:** Expand operator quick picks (Platform Plus, App Dev Suite) — **IN PROGRESS**
  - Platform Plus quick pick added (ACM+MCE, RHACS, Quay, ODF base stack)
  - App Development Suite quick pick added (GitOps, Pipelines, DevSpaces, Web Terminal)
  - Quay quick pick added
  - Quay + Bridge integration quick pick added
  - Version-aware ODF quick picks implemented (4.16-4.21 support)
  - **Remaining:** Research RHADS-SSC completed, decided NOT to add (air-gapped unsupported)

#### Success Criteria

- ✅ YAML drawer functional with all 24 specs (complete 2026-05-12)
- ✅ Preview panels show with incomplete warnings (complete 2026-05-10)
- ✅ Scenario summary live-updates (complete 2026-05-11)
- ⏳ New operator quick picks available (Platform Plus, App Dev Suite, Quay complete; RHADS-SSC declined)

---

### **Phase 3: Platform Completeness** (3-4 weeks)

**Priority:** P1/P2  
**Goal:** Complete platform-specific implementations  
**Dependencies:** Phase 0-1 complete

#### Items (4)

- **LOCAL #41/#42:** AWS Platform Specifics completion
  - Instance-type picker / guided selection
  - Restricted/secret-region ergonomics
  - Remaining optional 4.20 params (serviceEndpoints, userTags, etc.)
  - Per-pool params (amiID, iamProfile, iamRole, zones)
  - Root volume iops, kmsKeyARN
- **LOCAL #4:** FIPS vs regular installer binary
  - Backend pulls both binaries
  - Assets bundle includes correct one based on FIPS checkbox
- ✅ **DOC-060:** Mirror-registry binary in assets — verified_done 2026-05-10
  - Toggle added to Assets & Guide export options
  - Downloads latest mirror-registry-amd64.tar.gz at export time
  - Caches for reuse, includes in bundle under tools/

#### Success Criteria

- AWS Platform Specifics fully complete (no deferred items)
- FIPS binary selection working
- Mirror-registry binary available in assets

---

### **Phase 4: Testing & Validation** (3-4 weeks)

**Priority:** P1 (before any release)  
**Goal:** Comprehensive testing across all scenarios  
**Dependencies:** Phases 0-3 substantially complete

#### Items (Merged COMP Phase 9 + 10)

- **COMP Phase 9:** Testing & Validation (comprehensive)
  - Visual regression testing (all resolutions, zoom, light/dark)
  - Responsive behavior testing
  - Functional testing (end-to-end flows for each scenario)
  - Accessibility testing (keyboard nav, screen reader, ARIA, contrast)
- **COMP Phase 10 (merged):** Systematic Scenario Validation
  - Validate ALL scenarios (12+) against comprehensive checklist
  - Per field: tooltip, validation, defaults, allowed values
  - Per section: structure, spacing, conditional logic
  - Per tab: navigation, state persistence, progress
  - Per scenario: generated YAMLs valid, field guide accurate, bundle complete

#### Success Criteria

- All visual regression tests pass
- All functional tests pass
- All accessibility tests pass
- Scenario validation matrix 100% complete

---

### **Phase 5: Polish & Deferred Items** (2-3 weeks)

**Priority:** P2/P3  
**Goal:** Complete deferred polish items  
**Dependencies:** Can run after Phase 0-1, in parallel with others

#### Items (5)

- **DOC-032 (merged with COMP Phase 7):** Cross-scenario aesthetics + uniformity audit
  - Define reusable layout contract
  - Audit typography/spacing/layout/components/dark mode
  - Apply normalization across all scenarios
  - **Deferred to this phase** per user request
- **DOC-039:** Methodology/sub-scenario intelligence
  - Add rules/guidance for disconnected decision support
  - **Deferred to this phase** per user request
- **COMP Phase 4:** Field Guide Enhancements
  - More dynamic response to user configuration
  - Better organization, troubleshooting guidance
- **COMP Phase 5:** Single-Value Dropdown Review
  - Audit dropdowns with only one value
  - Convert to text/badge or keep as dropdown
- **COMP Phase 8:** Backend Test Consolidation
  - Audit fixtures
  - Create shared fixture files
  - Refactor tests

#### Success Criteria

- Layout contract defined and applied
- Methodology intelligence implemented
- Field Guide enhanced
- Dropdown audit complete
- Test fixtures consolidated

---

### **Phase 6: Version-Aware System** (8-12 weeks) ⭐ **MASSIVE PROJECT**

**Priority:** P1  
**Goal:** Make app version-aware for OpenShift minor releases  
**Dependencies:** Phases 0-5 complete and stable  
**Recommendation:** Treat as separate project

#### Items (merged DOC-059 + LOCAL #7)

- **DOC-059:** OpenShift version-aware system
  - Parse openshift-install binary for new releases
  - Download PDF docs for each release
  - Generate version-aware params JSON files
  - Carry forward unchanged values, annotate deltas
  - Field Guide compartmentalization (LOCAL #7 merged)
  - oc-mirror special case handling

#### Sub-Phases

1. **Research & Baseline:** Document 4.20 as baseline
2. **Delta Detection:** Build tooling to identify changes between versions
3. **Pipeline:** Automated workflow for version-aware catalogs
4. **Frontend/Backend:** Make components version-aware
5. **Field Guide:** Compartmentalization + automation
6. **oc-mirror:** Latest binary + version-specific params

#### Success Criteria

- Configs accurate for 2+ minor releases (4.20, 4.21)
- Field Guide compartments defined
- Version update pipeline documented and proven

---

### **Phase 7: Post High-Side Branch Merge** (variable timing)

**Priority:** Variable  
**Goal:** Integrate high-side branch work  
**Dependencies:** High-side feature branch merge

#### Items from High-Side Branch (4)

- **DOC-037:** High-side/low-side operating modes
- **DOC-038:** High-side hardening controls
- **LOCAL #8:** Obfuscate sensitive info in deliverables
- **LOCAL #40:** Global template mode

#### Items Unblocked After YAML Drawer (1)

- **LOCAL #33:** Node drawer reorder (move Advanced above Additional Interfaces)
  - **Dependency:** DOC-034 (YAML drawer) complete

#### Success Criteria

- High-side branch merged successfully
- Operating modes functional
- Template mode working
- Node drawer reorder complete

---

### **Phase 8: Exploratory & Future** (no timeline)

**Priority:** P2/P3  
**Goal:** Research and evaluate future enhancements

#### Items (4)

- **LOCAL #6:** Operator dependencies (exploratory)
  - Research automation for version-specific operator dependencies
- **LOCAL #10:** LocalStorage vs SQLite evaluation
  - Evaluate browser storage vs server-side storage
- **LOCAL #25:** Export compression format choice
  - Allow users to choose zip/tar/tar.gz
- **LOCAL #35:** VRF/SR-IOV validation
  - Doc-backed proof for primary interface support
  - Validated install test path
- **LOCAL #47:** Dockerfile/Containerfile parity enforcement
  - Automation or CI check to prevent drift

#### Success Criteria

- Research documented with recommendations
- Implement only if approved and high value

---

### **Awaiting Stakeholder Review** (external dependency)

**Priority:** P1  
**Goal:** Unblock comparative enrichment items

#### Items (7)

- **DOC-042 through DOC-048:** Deep comparative enrichment
  - All marked done_pending_verification
  - Awaiting stakeholder review for scoring, gates, packets
  - Schedule review session to unblock

---

## Execution Strategy

### Recommended Order

**Weeks 1-2:** Phase 0 (Quick Wins)  
**Weeks 3-5:** Phase 1 (Critical Audits)  
**Weeks 6-13:** Phase 2A (YAML Drawer) — **Priority focus**  
**Weeks 6-9:** Phase 2B (Preview/Summary) — Can parallelize with 2A start  
**Weeks 10-13:** Phase 3 (Platform Completeness)  
**Weeks 14-17:** Phase 4 (Testing & Validation) — **Before release**  
**Weeks 18-20:** Phase 5 (Polish & Deferred)  
**Weeks 21-32:** Phase 6 (Version-Aware System) — **Separate project**  
**Variable:** Phase 7 (High-Side Branch Merge) — **When branch ready**  
**Ongoing:** Phase 8 (Exploratory) — **As needed**

**Total estimated time (Phases 0-5):** ~20 weeks (5 months)  
**Phase 6 adds:** ~12 weeks (3 months)  
**Total with Phase 6:** ~32 weeks (8 months)

---

## Parallelization Opportunities

**Can run in parallel:**

- Phase 2B (Preview/Summary) || Phase 3 (Platform Completeness)
- Phase 5 (Polish) can start after Phase 1, doesn't block Phase 2-4

**Must run sequentially:**

- Phase 0 → Phase 1 (audits need clean baseline)
- Phase 1 → Phase 2A (YAML drawer benefits from audit knowledge)
- Phases 0-5 → Phase 6 (version-aware needs stable foundation)

---

## Risk Mitigation

### High-Risk Items

1. **Phase 2A (YAML Drawer):** Complex, potential conflicts
  - Mitigation: Thorough design phase, incremental implementation
2. **Phase 6 (Version-Aware):** Massive scope, high complexity
  - Mitigation: Separate project, break into sub-phases, prototype first
3. **Phase 4 (Testing):** May uncover regressions
  - Mitigation: Run tests incrementally after each prior phase

### External Dependencies

- **High-side branch:** Phases depend on branch merge timing
- **Stakeholder review:** DOC-042-048 blocked until reviewed

---

## Success Metrics

**Phase 0:** All bugs fixed, tests passing, no regressions  
**Phase 1:** Disconnected matrix complete, research documented  
**Phase 2:** YAML drawer + preview/summary working, user-tested  
**Phase 3:** All platforms complete, no deferred params  
**Phase 4:** All scenarios validated, comprehensive test suite passing  
**Phase 5:** Visual consistency achieved, tests consolidated  
**Phase 6:** Multi-version support proven for 2+ releases  
**Phase 7:** High-side features integrated, template mode working  

---

## Deferred Items Summary

**Deferred to High-Side Branch:**

- DOC-037, DOC-038, LOCAL #8, #40

**Deferred to Later Phases:**

- DOC-032 (Phase 5)
- DOC-039 (Phase 5)
- COMP Phase 3 (Phase 5 or later)

**Blocked:**

- LOCAL #33 (until YAML drawer complete)
- LOCAL #9 (session management - keep deferred)

**Awaiting Review:**

- DOC-042 through DOC-048 (comparative enrichment)

---

## Next Steps

1. ✅ Backlog documents updated
2. ✅ Review summary created
3. ✅ Revised plan created
4. **User approval** of this plan
5. **Begin Phase 0** immediately after approval
6. **Track progress** in BACKLOG_STATUS.md

---

**Plan Created:** 2026-05-10  
**Estimated Duration:** 5-8 months (depending on Phase 6 inclusion)  
**Next Action:** User review and approval, then begin Phase 0