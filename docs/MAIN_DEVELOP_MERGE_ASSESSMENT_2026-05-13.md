# Main → Develop Merge Conflict Assessment

**Date:** 2026-05-13  
**Purpose:** Assess feasibility of merging main branch changes into develop before merging develop → main  
**Status:** 9 conflicts identified, mostly LOW-MEDIUM complexity

---

## Executive Summary

- **Merge base:** adedb5490cb04893f86c5ad2c8593c2a0bf40f03
- **Commits on main only:** 12 commits (new features + fixes since branch divergence)
- **Commits on develop only:** 179 commits (major feature development)
- **Files changed on main:** 42 files
- **Files changed on develop:** 240 files
- **Conflicting files:** 9 files with merge conflicts
- **Auto-merge files:** 33 files can be auto-merged

**Recommendation:** PROCEED WITH CAUTION - Manual conflict resolution required for 9 files  
**Estimated effort:** 2-4 hours for conflict resolution + testing

---

## Commits on Main (Not in Develop)

Main has 12 new commits with important features and fixes:

```
d2034f8 fixed issue with operations tab visibility
3ef5832 Cincinnati refresh jobs, Blueprint loading/errors, manual release, AWS region errors
aed7862 compose: pass VITE_ALLOWED_HOSTS into frontend; clarify vite allowedHosts
3bed9d4 Added corporate proxy support to the containerized implementation
18876b3 Test corporate proxy bootstrap: EnvHttpProxyAgent default and opt-out
7896888 Add backend corporate proxy support for fetch and document egress paths
74ca70d Host inventory: single MTU for base and VLAN; default 1500
0f86663 Align bare-metal Agent Day-2 install-config with OCP 4.20 §9.1.4
7303e26 refactor(docs): generic forward-minor notice; minor-only label
c5b27cd fix(trust): forward-compatible policy for OCP 4.17+ minors (e.g. 4.21)
4ae7b16 feat(trust): gate policy UI on PEM bundle; align defaults with OCP 4.20
08737f1 fix(generate): emit additionalTrustBundlePolicy when version string is missing
```

**Key features to merge IN:**
1. Corporate proxy support (backend + frontend + containerization)
2. Cincinnati refresh job improvements
3. Manual release/patch selection
4. Trust bundle policy enhancements (4.20 alignment)
5. Host inventory MTU fixes
6. Operations tab visibility fix

---

## Conflict Breakdown

### CONFLICT #1: `backend/package-lock.json`

**Type:** Dependency version conflicts  
**Complexity:** LOW (auto-resolvable)  
**Cause:** Both branches added/updated npm dependencies independently

**Resolution strategy:**
- Delete package-lock.json
- Run `npm install` in backend directory
- Commit regenerated lockfile
- Verify no breaking changes

**Risk:** LOW - Standard dependency merge procedure

---

### CONFLICT #2: `backend/package.json`

**Type:** Dependency additions  
**Complexity:** LOW-MEDIUM  
**Cause:** Main added proxy-related dependencies, develop may have added others

**Main changes:**
- Likely added `env-http-proxy-agent` or similar for proxy support

**Resolution strategy:**
- Manually merge dependencies section
- Keep all dependencies from both branches
- Regenerate package-lock.json
- Test that all features still work

**Risk:** LOW - Additive changes, unlikely to conflict functionally

---

### CONFLICT #3: `data/params/4.20/bare-metal-agent.json`

**Type:** Catalog data conflict  
**Complexity:** MEDIUM  
**Cause:** Main updated bare-metal agent parameters per OCP 4.20 §9.1.4

**Main changes:**
- Day-2 install-config alignment
- Possibly MTU-related parameter updates

**Develop changes:**
- Unknown - need to inspect conflict markers

**Resolution strategy:**
- Manually review both versions of conflicting sections
- Prefer main's version for OCP 4.20 compliance
- Verify no develop-specific parameters are lost
- Regenerate catalog if needed

**Risk:** MEDIUM - Incorrect merge could break bare-metal agent scenario generation

---

### CONFLICT #4: `frontend/src/App.jsx`

**Type:** Code logic conflict  
**Complexity:** MEDIUM-HIGH  
**Cause:** Both branches modified App.jsx extensively

**Main changes:**
- Cincinnati refresh job integration
- Blueprint loading/error handling
- Operations tab highlights

**Develop changes:**
- YAML drawer integration (Phase 2A)
- Segmented flow implementation
- Import/export refactoring
- ShowPreview guard removal (recent bug fix)

**Resolution strategy:**
1. Use 3-way merge tool to identify conflict sections
2. Preserve develop's YAML drawer and segmented flow changes
3. Integrate main's Cincinnati refresh job logic
4. Carefully merge Blueprint loading/error handling
5. Test ALL scenarios after merge (both develop features + main features)

**Risk:** HIGH - Core application file, many moving parts
**Testing required:** Full smoke test + YAML drawer + Cincinnati features

---

### CONFLICT #5: `frontend/src/components/ToolsDrawer.jsx`

**Type:** Component modification conflict  
**Complexity:** MEDIUM  
**Cause:** Both branches modified ToolsDrawer component

**Main changes:**
- Possibly Operations tab visibility fix integration

**Develop changes:**
- Unknown - likely UI refinements or additions

**Resolution strategy:**
- Manually merge component code
- Preserve develop's structural changes
- Integrate main's visibility fixes
- Test Tools drawer after merge

**Risk:** MEDIUM - UI component, visual testing required

---

### CONFLICT #6: `frontend/src/data/catalogs/bare-metal-agent.json`

**Type:** Catalog data conflict (frontend copy)  
**Complexity:** MEDIUM  
**Cause:** Same as #3, frontend catalog copy

**Resolution strategy:**
- Apply same resolution as backend catalog (#3)
- Ensure frontend and backend catalogs stay in sync

**Risk:** MEDIUM - Same as #3

---

### CONFLICT #7: `frontend/src/steps/BlueprintStep.jsx`

**Type:** Step component conflict  
**Complexity:** MEDIUM-HIGH  
**Cause:** Both branches modified Blueprint step extensively

**Main changes:**
- Cincinnati refresh job UI integration
- Blueprint loading states
- Error display for refresh failures

**Develop changes:**
- Tooltip expansions (Phase 1-2)
- UI refinements
- Validation improvements

**Resolution strategy:**
1. Preserve develop's tooltip infrastructure
2. Integrate main's Cincinnati refresh job UI
3. Merge loading/error handling states
4. Test Blueprint step thoroughly

**Risk:** MEDIUM-HIGH - Complex component with new async job handling

---

### CONFLICT #8: `frontend/src/steps/TrustProxyStep.jsx`

**Type:** Step component conflict  
**Complexity:** MEDIUM  
**Cause:** Main updated trust policy logic for 4.20 compatibility

**Main changes:**
- Trust bundle policy gating on PEM bundle
- 4.20 default alignment
- Forward-compatible policy for 4.17+ minors

**Develop changes:**
- Tooltip expansions
- UI refinements
- Possible validation changes

**Resolution strategy:**
1. Preserve develop's UI/tooltip changes
2. Integrate main's trust policy logic updates
3. Test trust policy behavior with and without PEM bundles
4. Verify 4.20 alignment

**Risk:** MEDIUM - Trust policy is security-critical, needs careful testing

---

### CONFLICT #9: `frontend/src/validation.js`

**Type:** Validation logic conflict  
**Complexity:** MEDIUM  
**Cause:** Both branches modified validation rules

**Main changes:**
- Trust policy validation updates
- Possibly AWS region validation

**Develop changes:**
- Extensive validation additions (segmented flow, new scenarios)
- Platform-specific validation enhancements

**Resolution strategy:**
1. Manually merge validation functions
2. Ensure no validation rules are lost from either branch
3. Run full validation test suite
4. Test all scenarios (especially trust, AWS, bare-metal)

**Risk:** MEDIUM - Validation affects all scenarios, comprehensive testing required

---

## Auto-Merge Files (33 files)

These files can be auto-merged by git without conflicts:

**Backend:**
- backend/Containerfile
- backend/Dockerfile
- backend/src/cincinnati.js
- backend/src/generate.js (portions)
- backend/src/index.js (portions)
- backend/src/versionPolicy.js
- backend/test/smoke.test.js

**Added files (main):**
- backend/src/cincinnatiJob.js
- backend/src/configureFetchProxy.js
- backend/test/configureFetchProxy.test.js

**Frontend:**
- frontend/src/components/Sidebar.jsx
- frontend/src/hostInventoryV2Helpers.js
- frontend/src/hostInventoryV2Validation.js
- frontend/src/shared/trustBundlePolicy.js
- frontend/src/shared/versionPolicy.js
- frontend/src/steps/GlobalStrategyStep.jsx
- frontend/src/steps/HostInventoryStep.jsx
- frontend/src/steps/HostInventoryV2Step.jsx
- frontend/src/steps/OperationsStep.jsx
- frontend/src/steps/PlatformSpecificsStep.jsx

**Documentation:**
- README.md
- docs/BACKLOG_STATUS.md
- docs/POST_UBI_VERIFICATION.md

**Config:**
- docker-compose.yml

**Data:**
- (Various catalog and test files)

---

## Conflict Categorization by Complexity

### LOW Complexity (Auto-resolve, minimal testing): 2 files
- `backend/package-lock.json` - Regenerate via npm install
- `backend/package.json` - Merge dependencies list

### MEDIUM Complexity (Manual merge, component testing): 4 files
- `data/params/4.20/bare-metal-agent.json` - Catalog alignment
- `frontend/src/components/ToolsDrawer.jsx` - Component merge
- `frontend/src/data/catalogs/bare-metal-agent.json` - Frontend catalog
- `frontend/src/steps/TrustProxyStep.jsx` - Trust policy + UI merge

### HIGH Complexity (Careful reconciliation, full testing): 3 files
- `frontend/src/App.jsx` - Core app logic, many features intersecting
- `frontend/src/steps/BlueprintStep.jsx` - Cincinnati integration + tooltips
- `frontend/src/validation.js` - All scenario validation rules

---

## Recommended Merge Process

### Phase 1: Preparation (30 minutes)

1. Create fresh feature branch from develop:
   ```bash
   git checkout develop
   git checkout -b merge-main-into-develop
   ```

2. Ensure clean working tree
3. Run full test suite on develop to establish baseline
4. Note all passing test counts

### Phase 2: Merge and Resolve Conflicts (2-3 hours)

1. **Merge main into feature branch:**
   ```bash
   git merge main --no-ff
   ```

2. **Resolve LOW complexity conflicts first:**
   - Delete and regenerate package-lock.json
   - Merge package.json dependencies manually
   - Test: `npm install && npm test`

3. **Resolve MEDIUM complexity conflicts:**
   - Use 3-way merge tool (e.g., kdiff3, meld, or VS Code)
   - For catalog files: prefer main's OCP 4.20 compliance
   - For components: preserve develop structure, add main features
   - Test each component after resolution

4. **Resolve HIGH complexity conflicts:**
   - App.jsx: Section-by-section merge, preserve both feature sets
   - BlueprintStep.jsx: Integrate Cincinnati UI into develop structure
   - validation.js: Merge all validation rules, ensure no loss
   - Test: Full smoke test + scenario validation suite

### Phase 3: Testing (1-2 hours)

1. **Run full test suites:**
   - Frontend: `cd frontend && npm test`
   - Backend: `cd backend && npm test`
   - Target: 674+ frontend tests, 239+ backend tests passing

2. **Manual smoke testing:**
   - Cincinnati refresh job UI (main feature)
   - Manual release/patch selection (main feature)
   - Corporate proxy configuration (main feature)
   - YAML drawer (develop feature)
   - Segmented flow (develop feature)
   - All quick scenarios (bare-metal, vSphere, AWS, Azure, etc.)

3. **Regression testing:**
   - Operations tab visibility
   - Trust bundle policy behavior
   - Bare-metal agent configuration generation
   - Host inventory MTU handling

### Phase 4: Review and Merge (30 minutes)

1. Create pull request: `merge-main-into-develop` → `develop`
2. Run CI/CD pipeline (if available)
3. Get user/stakeholder approval
4. Merge to develop
5. Push to remote

---

## Risk Assessment

**Overall Risk:** MEDIUM  
**Justification:** 9 conflicts across core application files, but most are manageable with careful 3-way merging

**Highest Risk Areas:**
1. **App.jsx** - Many features intersecting, high change frequency
2. **BlueprintStep.jsx** - Cincinnati integration complexity
3. **validation.js** - Validation rules affect all scenarios

**Mitigations:**
- Comprehensive testing after each conflict resolution
- Full regression test suite before merge
- User acceptance testing of both main and develop features
- Rollback plan (feature branch can be abandoned if issues arise)

---

## Success Criteria

**Merge is successful when:**

1. ✅ All 9 conflicts resolved without data/feature loss
2. ✅ Frontend test suite passes: 674+ tests
3. ✅ Backend test suite passes: 239+ tests
4. ✅ Main features working:
   - Cincinnati refresh jobs
   - Manual release/patch selection
   - Corporate proxy support
   - Trust policy 4.20 alignment
   - Operations tab visibility
5. ✅ Develop features working:
   - YAML drawer (all scenarios)
   - Segmented flow
   - Tooltip expansions
   - Import/export
6. ✅ No regressions in any scenario
7. ✅ Documentation updated (BACKLOG_STATUS, etc.)

---

## Timeline Estimate

- **Preparation:** 30 minutes
- **Conflict resolution:** 2-3 hours
- **Testing:** 1-2 hours
- **Review and merge:** 30 minutes

**Total:** 4-6 hours (full working session)

**Best approach:** Dedicate uninterrupted block of time, don't rush

---

## Conclusion

The main → develop merge is **feasible but requires careful attention**. The 9 conflicts are concentrated in core files that have been heavily modified on both branches. The key to success is:

1. Systematic conflict resolution (LOW → MEDIUM → HIGH)
2. Testing after each resolution
3. Full regression testing before final merge
4. No shortcuts on high-complexity files (App.jsx, validation.js)

**Recommendation:** Proceed with merge, allocate 4-6 hours, test thoroughly.

**Alternative:** If time-constrained, defer main → develop merge until after develop → main merge is complete, then sync main changes in as patches.

---

**Assessment completed:** 2026-05-13  
**Assessor:** Claude Sonnet 4.5 (AI assistant)  
**Verified by:** Pending user review
