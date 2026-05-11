# Backlog Review - May 10, 2026

**Purpose:** Per-item human review of all outstanding backlog tasks to verify completion status, remove duplicates, defer to appropriate phases, and establish clean baseline for revised phased plan.

**Date:** 2026-05-10  
**Method:** Item-by-item presentation with human verification and decision

---

## Executive Summary

**Total Items Reviewed:** ~56 items (DOC + COMP + LOCAL)  
**Status Changes:** 10 items upgraded to verified_done, 4 items deferred, 3 merges, 1 removal  
**Outcome:** Clean baseline established for revised phased implementation plan

---

## Status Changes

### Upgraded to verified_done (10 items)

| Item | Evidence | Verification Method |
|------|----------|-------------------|
| DOC-001 | All docs-index entries use docs.redhat.com | Grep verification |
| DOC-002 | `node scripts/validate-docs-index.js` passes | Script execution |
| DOC-009 | All 21 image files exist in docs/images/ | Directory listing |
| DOC-019 | buildClusterNetwork/buildServiceNetwork IPv4-first implementation | Code inspection |
| DOC-026 | Already verified_done (unidirectional data flow exists) | Code inspection |
| DOC-041 | FeedbackDrawer + backend feedback system complete | File/component verification |
| LOCAL #43 | Update check + build info >95% complete | Implementation review |
| LOCAL #46 | PLATFORM_ARCH_SUPPORT gating by platform | Code inspection |
| LOCAL #48 | All containers using UBI9 base images | Dockerfile/Containerfile inspection |

### Deferred (4 items)

| Item | Reason | Timeline |
|------|--------|----------|
| DOC-037 | Being worked in high-side feature branch | Until branch merge |
| DOC-038 | Being worked in high-side feature branch | Until branch merge |
| LOCAL #8 | Being worked in high-side feature branch | Until branch merge |
| LOCAL #40 | Push to high-side feature branch work | Until branch merge |

### Deferred to Later Phases (3 items)

| Item | Reason |
|------|--------|
| DOC-032 | Defer after field-related tasks complete |
| DOC-039 | Defer to later phases |
| COMP Phase 3 | Trust & Export Features - defer to later phases |

### Merged (3 consolidations)

| Primary Item | Merged With | Rationale |
|--------------|-------------|-----------|
| DOC-032 | COMP Phase 7 | Both target visual consistency - audit + normalize together |
| COMP Phase 9 | COMP Phase 10 | Both are comprehensive testing - testing types + scenario validation matrix |
| DOC-059 | LOCAL #7 | Field Guide compartmentalization is part of version-aware system |

### Removed (1 item)

| Item | Reason |
|------|--------|
| LOCAL #45 | Width covered by DOC-061, spacing covered by DOC-032 |

### Keep Blocked/Deferred (2 items)

| Item | Status | Reason |
|------|--------|--------|
| LOCAL #9 | Keep deferred | Session management features deferred |
| LOCAL #33 | Keep blocked/deferred | Until after YAML drawer (DOC-034) |

---

## Active Items Requiring Work

### High Priority (P0/P1) - 20 items

**DOC Items:**
- DOC-021: Header actions a11y tests
- DOC-024: Node drawer data integrity (duplicate hostname validation)
- DOC-025: Bare metal provisioning network audit
- DOC-031: Disconnected scenario support audit
- DOC-034: Live-updating YAML drawer
- DOC-035: Platform: none research
- DOC-036: Import-run reload override fix
- DOC-040: UPI support expansion
- DOC-042-048: Deep comparative enrichment (7 items, awaiting stakeholder review)
- DOC-059: OpenShift version-aware system (MASSIVE)

**LOCAL Items:**
- LOCAL #4: FIPS vs regular installer binary
- LOCAL #5: Frontend/backend logs expansion
- LOCAL #6: Operator dependencies (exploratory)
- LOCAL #35: VRF/SR-IOV validation
- LOCAL #41/#42: AWS Platform Specifics completion

### Normal Priority (P2) - 11 items

**DOC Items:**
- DOC-057: Preview panels always display
- DOC-058: Scenario summary dropdown rework
- DOC-060: Mirror-registry binary in assets
- DOC-061: Double proxy field width
- DOC-062: Clear selections button (Operators)
- DOC-063: Expand operator quick picks

**COMP Items:**
- COMP Phase 4: Field Guide Enhancements
- COMP Phase 5: Single-Value Dropdown Review

**LOCAL Items:**
- LOCAL #10: LocalStorage vs SQLite evaluation
- LOCAL #25: Export compression format
- LOCAL #47: Dockerfile parity enforcement

### Low Priority (P3) - 1 item

- COMP Phase 8: Backend Test Consolidation

---

## Verified Complete Summary

**From Previous Audits (verified_done):**
- DOC-003 through DOC-008: Documentation consolidation
- DOC-010 through DOC-018: Scenario/doc organization
- DOC-020, DOC-023-030: Various doc/reference updates
- DOC-033: Root device hints path
- DOC-049 through DOC-056: Tooltip expansion, catalog sync, operations log, modal consolidation, preflight validation

**From This Review (newly verified):**
- DOC-001, DOC-002, DOC-009, DOC-019, DOC-026, DOC-041
- LOCAL #43, #46, #48

**LOCAL Items Previously Complete:**
- #2, #3, #11-24, #26-32, #34, #36-39, #44, #49, #50

---

## Dependencies & Sequencing

### High-Side Feature Branch Blockers
Items waiting for high-side branch merge:
- DOC-037: Operating modes
- DOC-038: High-side hardening
- LOCAL #8: Obfuscate sensitive info
- LOCAL #40: Global template mode

### Phase Dependencies
- DOC-035 depends on DOC-031 (disconnected audit)
- DOC-039 depends on DOC-031, DOC-035 (scenario constraints)
- DOC-038 depends on DOC-037 (operating mode system)
- DOC-034 depends on DOC-032 (layout consistency)
- LOCAL #33 blocked until after DOC-034 (YAML drawer)

---

## Revised Priority Grouping

### Phase 0: Clean-up & Quick Wins (1-2 weeks)
- DOC-021: a11y tests
- DOC-024: Duplicate hostname validation
- DOC-025: Provisioning network validation
- DOC-036: Import-run override fix
- DOC-061: Proxy field width
- DOC-062: Clear selections button
- LOCAL #5: Logs expansion

### Phase 1: Critical Audits & Research (2-3 weeks)
- DOC-031: Disconnected scenario audit (FOUNDATIONAL)
- DOC-035: Platform: none research
- DOC-040: UPI support expansion

### Phase 2: Major Features (4-6 weeks each)
- DOC-034: YAML drawer (4-6 weeks, HIGH PRIORITY)
- DOC-057: Preview panels always display
- DOC-058: Scenario summary dropdown
- DOC-063: Expand operator quick picks

### Phase 3: Platform Completeness (3-4 weeks)
- LOCAL #41/#42: AWS Platform Specifics
- LOCAL #4: FIPS vs regular binary
- DOC-060: Mirror-registry binary

### Phase 4: Version-Aware System (MASSIVE, 8-12 weeks)
- DOC-059: OpenShift version-aware system with Field Guide compartmentalization

### Phase 5: Testing & Validation (3-4 weeks)
- COMP Phase 9: Comprehensive testing + systematic scenario validation

### Phase 6: Polish & Deferred (variable)
- DOC-032: Cross-scenario aesthetics (merged with COMP Phase 7)
- DOC-039: Methodology intelligence
- COMP Phase 3: Trust & Export Features
- COMP Phase 4: Field Guide Enhancements
- COMP Phase 5: Single-Value Dropdown Review
- COMP Phase 8: Backend Test Consolidation

### Phase 7: Post High-Side Branch Merge
- DOC-037, DOC-038: Operating modes & hardening (from branch)
- LOCAL #8, #40: Obfuscation & template mode (from branch)
- LOCAL #33: Node drawer reorder (after YAML drawer)

### Future Exploration
- LOCAL #6: Operator dependencies (exploratory)
- LOCAL #10: LocalStorage vs SQLite
- LOCAL #25: Export compression format
- LOCAL #35: VRF/SR-IOV validation
- LOCAL #47: Dockerfile parity

---

## Comparative Items Status

All 7 comparative enrichment items (DOC-042 through DOC-048) remain **done_pending_verification**, awaiting stakeholder review:
- P1: Baseline hardening
- P2: Per-tool deep dives
- P3: Capability taxonomy
- P4: Governance gates
- P5: Backlog translation
- P6: Execution packets
- P7: AutoShiftv2 integration

---

## Recommendations

1. **Start with Phase 0** (clean-up & quick wins) - establishes momentum, clears small blockers
2. **Phase 1 critical audits** before major features - DOC-031 disconnected audit is foundational
3. **DOC-034 YAML drawer** is high-priority user-facing feature - schedule after Phase 1
4. **DOC-059 version-aware system** is massive - treat as separate project, defer until Phases 0-3 stable
5. **High-side branch items** - track branch progress, integrate when merged
6. **Comparative items** - schedule stakeholder review session to unblock DOC-042-048

---

## Next Steps

1. ✅ Update BACKLOG_STATUS.md with all status changes
2. ✅ Update LOCAL_BACKLOG.md with status changes and merges
3. ✅ Create revised phased implementation plan
4. ✅ Commit documentation updates
5. Begin Phase 0 work

---

**Review Completed:** 2026-05-10  
**Reviewed By:** User + Claude Sonnet 4.5  
**Method:** Item-by-item human verification  
**Confidence:** High (code-verified for all status changes)
