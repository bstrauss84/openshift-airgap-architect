# OpenShift Airgap Architect - AI Agent Instructions

**Purpose:** This file establishes the documentation hierarchy and authority for AI agents working on this codebase.

---

## Documentation Hierarchy (Single Source of Truth)

### 1. Canonical Status Registry: `/docs/BACKLOG_STATUS.md`

**Authority:** Single source of truth for ALL status claims  
**Items:** DOC-001 through DOC-056+  
**Purpose:** Evidence-first reconciliation of all work completed, in progress, and planned

**Before making status claims:**
1. Check `/docs/BACKLOG_STATUS.md` first
2. Provide code/commit evidence for any updates
3. Use canonical status vocabulary ONLY (see below)
4. If updating status, add a row to the BACKLOG_STATUS.md table with evidence

**Status vocabulary (canonical):**
- `active`: planned and in-scope
- `deferred`: intentionally postponed
- `blocked`: cannot progress until blocker resolved
- `done_pending_verification`: implemented, verification incomplete
- `verified_done`: implemented and verified against code/tests
- `obsolete`: no longer relevant
- `superseded`: replaced by another item

**Priority vocabulary:**
- `p0`: urgent correctness/security impact
- `p1`: high product impact
- `p2`: normal planned work
- `p3`: low-priority improvement

### 2. Active Execution Plan: `/docs/IMPLEMENTATION_ROADMAP_2026-05-14.md`

**Authority:** Current phased implementation roadmap (semantic versioning)  
**Created:** 2026-05-14 (replaces REVISED_PHASED_PLAN_2026-05-10.md)  
**Current Version:** v1.1.3 (released 2026-05-14)  
**Current Phase:** v1.2.0 Phase 1 - ✅ **100% COMPLETE** (4/4 items done)  
**Purpose:** Semantic versioning roadmap with release history and phased features

**What it contains:**
- Semantic versioning strategy (patch/minor/major)
- Release history (v1.1.0 through v1.1.3)
- Phased roadmap (v1.2.0 through v2.0.0)
- Success criteria per phase
- Dependency tracking

**When to update:**
- Mark items complete with dates + commit evidence
- Update phase completion percentages
- Track version bumps and releases
- Cross-reference BACKLOG_STATUS.md for detailed status

**Current focus:** v1.2.0 Phase 3 (AWS Platform Specifics, FIPS binary selection)  
**Next phase:** v1.3.0 (Testing & Validation)

### 3. Historical Work Plan: `/docs/COMPREHENSIVE_MASTER_PLAN.md`

**Authority:** Detailed historical phase/batch tracking (Phases 1-2 tooltip work)  
**Status:** Phases 1-2 COMPLETE (100% tooltip coverage)  
**Purpose:** Reference for tooltip standards and completed tooltip expansion work

**Use for:**
- Tooltip formatting standards (gold standard reference)
- Historical batch completion tracking
- Quality checklist for FieldLabelWithInfo components
- Evidence of Phases 1-2 completion

**Do NOT use for:** Current work planning (use REVISED_PHASED_PLAN instead)

### 4. Local Backlog: `/LOCAL_BACKLOG.md` (not committed)

**Authority:** User's personal tracking (in .gitignore)  
**Purpose:** Lower-priority items, experimental work, deferred features  
**Scope:** NOT canonical - check BACKLOG_STATUS.md for any claims

---

## Evidence Requirements

For any status update to BACKLOG_STATUS.md:

**Required fields:**
1. **Commit SHA** or **file path** - Concrete code evidence
2. **Test files** - Link to passing tests (if applicable)
3. **Source documentation** - Reference planning docs or user requests
4. **Next action** - What remains if not `verified_done`

**Example row:**
```markdown
| DOC-049 | Comprehensive Tooltip Expansion | verified_done | p1 | `docs/COMPREHENSIVE_MASTER_PLAN.md` | Commits 0e3fe69-596fc2a, `frontend/tests/hint-syntax.test.js` passing | Tooltip expansion complete. |
```

---

## Work Session Protocol

### At End of Work Session

1. **Update docs/COMPREHENSIVE_MASTER_PLAN.md progress (if tooltip work)**
   - Mark completed phases/batches
   - Update completion percentages
   - Add completion dates

2. **Add completed items to docs/BACKLOG_STATUS.md with evidence**
   - Follow canonical status vocabulary
   - Provide commit SHAs or file paths
   - Link to tests if applicable

3. **Archive session notes to `.archive/session-notes-YYYY-MM-DD/`**
   - Move temporary working files
   - Delete `.bak` files
   - Create README.md index in archive directory

4. **Update this file if patterns change**
   - New documentation files added
   - Authority structure changes
   - Process improvements discovered

---

## Tooltip Standards (Phases 1-2 Complete)

All FieldLabelWithInfo tooltips must use gold standard formatting:

### Required Format

```jsx
<FieldLabelWithInfo
  label="Field Name"
  hint={`Brief one-line description.

**What is this:**
Explanation of the concept or field purpose.

**When needed:**
Scenarios where this is required or optional.

**Format:**
Expected input format, data type, constraints.

**How it's used:**
Where this appears in generated configs or how it affects deployment.

**Important:**
⚠️ Critical warnings, immutability notes, security considerations.

**Example:**
Concrete real-world example values.`}
  required={isRequired}
>
```

### Quality Checklist

- ✅ Template literal syntax `{`...`}`
- ✅ **Bold** section headers (renders as yellow highlighting)
- ✅ Comprehensive WHAT/WHY/WHEN/FORMAT/EXAMPLE sections
- ✅ Beginner-friendly language, no unexplained jargon
- ✅ Real-world examples with actual values
- ✅ Security warnings (⚠️) where applicable
- ✅ Immutability noted ("cannot be changed after installation")

---

## File Organization

### Keep (Living Documents)
- `docs/BACKLOG_STATUS.md` - Canonical status registry (single source of truth)
- `docs/IMPLEMENTATION_ROADMAP_2026-05-14.md` - **ACTIVE execution plan** (replaces REVISED_PHASED_PLAN)
- `docs/HANDOFF_PACKET.md` - Handoff packet for new Claude sessions (quick reference)
- `docs/COMPREHENSIVE_MASTER_PLAN.md` - Historical plan (Phases 1-2 tooltip work, quality standards)
- `docs/DISCONNECTED_SCENARIO_MATRIX.md` - Disconnected deployment support (all 12 scenarios)
- `docs/PLATFORM_NONE_SUPPORT_BOUNDARIES.md` - Platform: none usage rules
- `docs/UPI_PREP_GUIDES/` - UPI preparation guides (bare-metal, vSphere, AWS, Azure)
- `docs/HIGH_SIDE_FEATURES_BACKLOG.md` - High-side feature roadmap
- `LOCAL_BACKLOG.md` - User's personal backlog (not committed)
- `docs/TOOLTIP_EXPANSION_MASTER_PLAN.md` - Tooltip audit data reference
- `docs/SETUP_COMPLETE.md` - Catalog sync reference guide
- `UI_STANDARDS.md` - UI design and implementation standards
- `docs/CATALOG_SYNC_GUIDE.md` - Catalog synchronization procedures

### Archive (Session Notes)
Create `.archive/session-notes-YYYY-MM-DD/` directories for:
- Temporary working files
- Session status reports
- Audit findings
- Implementation notes

Include a README.md index listing all archived files.

### Delete (Temporary Artifacts)
- `.bak` files after validation
- Temporary test output
- Build artifacts not in `.gitignore`

---

## Git Workflow

### Commit Message Format

Follow existing patterns in the repository:

```
Brief summary (70 chars or less)

Optional longer description:
- Bullet points for multiple changes
- Reference DOC-XXX items when applicable
- Explain WHY not just WHAT

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

### Before Committing

1. Review git status and diff
2. Stage specific files (avoid `git add -A`)
3. Write meaningful commit message
4. Ensure tests pass
5. Check for sensitive data (.env, credentials)

### Branch Strategy

- **main:** Production-ready code
- **develop:** Active development (default target)
- Feature branches: For experimental work

---

## Testing Requirements

### Before Marking Work Complete

1. ✅ Frontend tests pass: `npm test`
2. ✅ Backend tests pass: `npm test` (backend directory)
3. ✅ Build succeeds: `npm run build`
4. ✅ No console errors in development mode
5. ✅ Validate tooltips render correctly (check UI)

### Test Coverage Expectations

- New features require tests
- Bug fixes should include regression tests
- UI changes: manual verification required
- API changes: integration tests required

---

## Common Pitfalls

### ❌ Don't Do This

1. **Don't claim work is complete without code evidence**
   - Bad: "I updated the tooltips" (no commit reference)
   - Good: "Updated tooltips in commit a1b2c3d, verified in UI"

2. **Don't use non-canonical status terms**
   - Bad: "mostly done", "in progress", "finished"
   - Good: `verified_done`, `done_pending_verification`, `active`

3. **Don't duplicate status claims across multiple docs**
   - Canonical status lives in docs/BACKLOG_STATUS.md only
   - Other docs reference it: "See DOC-049"

4. **Don't archive or delete living documents**
   - docs/COMPREHENSIVE_MASTER_PLAN.md is living historical reference, not session notes
   - Check this file before archiving anything

5. **Don't skip evidence when updating status**
   - Every status change needs commit SHA or file path
   - "It's done" without evidence is not acceptable

### ✅ Do This Instead

1. **Provide concrete evidence for all claims**
   - Link to specific commits
   - Reference test files
   - Point to lines of code

2. **Use canonical vocabulary consistently**
   - Learn the 6 status terms
   - Learn the 4 priority levels
   - Use them everywhere

3. **Keep docs/BACKLOG_STATUS.md as single source of truth**
   - Update it when work completes
   - Reference it from other docs
   - Check it before making claims

4. **Archive session notes, keep living docs**
   - Session-specific findings → archive
   - Ongoing tracking → living docs

5. **Always include next_action if not verified_done**
   - What remains to do
   - What blocks completion
   - What verification is needed

---

## Debugging Protocol: Systematic Over Clever

**See `.research/POSTMORTEM_WHY_I_FAILED.md` for detailed case study (2026-05-13 YAML bug)**

### Core Rule: After 2-3 Failed Fix Attempts

**STOP GUESSING. Start instrumenting.**

### The 6-Step Protocol

#### 1. Instrument FIRST, Fix SECOND
**Do this IMMEDIATELY (attempt #1 or #2):**
- Add comprehensive logging to ALL relevant code paths
- Log ALL conditional branches (which path taken + WHY)
- Log ALL early returns with the reason they're returning
- Log state snapshots before/after key operations
- Log request/response pairs with timing

**Don't:** Make educated guesses without evidence. Logs don't lie.

#### 2. Compare Working vs Broken Flows
**If something works in scenario A but not B:**
- Trace BOTH scenarios with logging enabled
- Ask user to test BOTH scenarios
- Compare logs side-by-side
- Find the exact divergence point
- Question WHY they diverge

**Don't:** Assume you know what's different. Prove it with logs.

#### 3. Question ALL Assumptions
**Guards and early returns are SUSPECTS, not givens:**
- "Why does this guard exist?"
- "What happens if I remove it?"
- "Is this guard necessary or redundant?"
- "Could this guard be CAUSING the bug?"

**Don't:** Assume existing code is correct. It might be the bug.

#### 4. Listen to User Frustration as Data
**When user says:**
- "Still broken" → Your analysis is wrong, start over
- "I don't see how..." → Your approach is flawed
- "Tired of guessing" → Need systematic approach
- "What is X doing that Y isn't?" → THIS IS THE KEY QUESTION

**Don't:** Treat frustration as noise. It's signal.

#### 5. Never Claim "Fixed" Without User Testing
**Language matters:**
- ✅ "This SHOULD fix it, please test"
- ✅ "If my analysis is correct, this will help"
- ✅ "Let's try this approach"
- ❌ "This is 100% fixed"
- ❌ "This is definitely the issue"
- ❌ "Smoking gun found"

**Don't:** Confuse confidence with correctness. Wait for confirmation.

#### 6. Use Plan Mode After 2-3 Failures
**Signals need for systematic investigation:**
- Forces comprehensive exploration
- Prevents guess-and-check loops
- Gets user buy-in for thorough approach
- Use parallel agents to investigate independently

**Don't:** Keep guessing for 10+ attempts. That's the definition of insanity.

### Red Flags That You're Off Track

- ❌ Claiming "fixed" multiple times
- ❌ Finding 40+ "smoking guns" but nothing works
- ❌ User frustration increasing
- ❌ Not comparing working vs broken flows
- ❌ Guessing at root cause without evidence
- ❌ Adding logging too late (attempt #8+)
- ❌ Assuming guards/early returns are correct

### Why This Matters

**Real example (2026-05-13):**
- Bug: One line `if (!showPreview) return;` blocking YAML generation
- Attempts: 10+ failed guesses (delays, POST vs GET, state closures)
- User clue: "what is show/hide doing that import isn't?" ← The answer was in this question
- Fix: Plan mode → systematic comparison → found guard → deleted 1 line → done
- Time wasted: Hours of guessing when logging would have shown it immediately

**Lesson:** Debugging is not about being clever. It's about being systematic.

---

## Critical Bug History (Learn from These)

### Pull Secret Field Bug (v1.1.3 Hotfix - 2026-05-14)

**Issue:** Pull secret field showed "Pull secret must be valid JSON" and wouldn't accept input.

**Root Cause:**
- `SecretInput.jsx` handleBlur used `e.target.value` to get field value
- When field is masked (hidden), `e.target.value` contains dots ("••••••••") not actual value
- Blur event sent dots to parent onChange, corrupting the pull secret

**Fix:**
- Changed handleBlur to use `localValue` instead of `e.target.value`
- `localValue` state always contains actual secret value regardless of show/hide
- Added auto-show on focus when error present

**Files:**
- `frontend/src/components/SecretInput.jsx`
- `frontend/tests/secret-input-blur-bug.test.jsx` (7 regression tests)

**Lesson:** When working with masked input fields, **NEVER** trust `e.target.value` - use state instead.

**Why This Matters:**
This broke the ENTIRE wizard on main branch. Users couldn't enter pull secrets on Blueprint step.
If you see similar "field won't accept input" bugs, check if component uses masked/hidden values.

### Test Deletion Anti-Pattern (2026-05-15)

**What Happened:** Created tests for SSH keygen warning feature, tests failed due to navigation issues, deleted tests instead of fixing them.

**Why It's Wrong:**
- Marks feature as "tested" when it's only manually verified
- Removes regression protection
- Hides implementation complexity
- Future developers assume tests exist

**Correct Approaches:**
1. **Fix the tests** - Proper mocks, navigation, state setup
2. **Create documentation tests** - With manual verification checklist
3. **Never delete failing tests** without replacing them

**Resolution:**
Created documentation tests in `frontend/tests/ssh-keygen-close-warning.test.jsx` with:
- Feature documentation (what/why/how)
- Implementation details (state, handlers, button wiring)
- 13-step manual verification checklist
- Related bug pattern notes (e.target.value on masked fields)

**Lesson:** Failing tests reveal problems. Fix the problem (test OR code), don't delete the evidence.

---

## Validation Patterns (v1.2.1 - 2026-05-17)

### VIP Validation (API VIP + Ingress VIP)

**Requirement:** API VIP and Ingress VIP must be within the machine network CIDR.

**Why:** OpenShift documentation states: "The VIPs, apiVIP and ingressVIP, must come from the same networking.machineNetwork segment."

**Implementation:**

File: `frontend/src/validation.js`  
Function: `validateVipsInMachineNetwork(state)`

**Platforms validated:**
- ✅ bare-metal-ipi
- ✅ bare-metal-agent (added v1.2.1)
- ✅ vsphere-ipi
- ✅ vsphere-agent
- ✅ nutanix-ipi

**How it works:**
1. Parse machine network CIDR (e.g., 10.90.0.0/24)
2. Calculate IP range (start: 10.90.0.0, end: 10.90.0.255)
3. Check if each VIP is within range
4. Error if VIP is outside: "API VIPs must be within the machine network (e.g. 10.90.0.0/24)"

**Dynamic VIP Placeholders:**

File: `frontend/src/steps/NetworkingV2Step.jsx`  
Helper: `getVipPlaceholders(machineNetworkCidr)`

**Behavior:**
- If machine network is 10.90.0.0/24 → suggests API VIP: 10.90.0.2, Ingress VIP: 10.90.0.3
- If machine network is 192.168.1.0/24 → suggests API VIP: 192.168.1.2, Ingress VIP: 192.168.1.3
- Uses start+2 for API (avoids .0 network address and .1 gateway)
- Uses start+3 for Ingress
- Defaults to "e.g. 10.90.0.2" if machine network not configured

**When to update:**
- If adding a new platform that uses VIPs, add it to `validateVipsInMachineNetwork`
- If changing machine network field location, update `getVipPlaceholders` usage

**Error Display Pattern (v1.2.2):**

Validation errors must be visible inline, not just in hover tooltips.

**Pattern:**
```jsx
<FieldLabelWithInfo label="API VIP" /* ... */>
  <input
    className={fieldErrors.apiVip ? "input-error" : ""}
    title={fieldErrors.apiVip || ""}
    /* ... */
  />
</FieldLabelWithInfo>
{fieldErrors.apiVip && <span className="note warning inline">{fieldErrors.apiVip}</span>}
```

**Why:**
- Title attribute errors only visible on hover
- Inline spans immediately visible (matches overlap warning pattern)
- Red text with yellow background for high visibility

**When to use:**
- Any field with validation logic in `validation.js` that sets `fieldErrors[fieldKey]`
- Pattern matches existing overlap warnings (e.g., NetworkingV2Step lines 380, 383)

---

## UI Patterns (v1.2.2)

### Tooltip Gold Standard

All FieldLabelWithInfo tooltips should follow this comprehensive format:

**Required Sections:**
1. **One-line description** - Brief summary at top
2. **What is this:** - Concept explanation
3. **When needed:** - Required/optional context, scenarios where applicable
4. **Format:** - Expected input format, constraints, validation rules
5. **How it's used:** - Where written in config files, how OpenShift uses it
6. **Important:** - ⚠️ Warnings about failures, immutability, security
7. **Example:** - Real-world concrete examples

**Example (from NodeDrawerAgentContent.jsx):**
```jsx
<FieldLabelWithInfo
  label="Ethernet MAC"
  hint={`Hardware MAC address of the physical network interface.

**What is this:**
The unique 48-bit hardware identifier burned into the NIC...

**When needed:**
Always required when configuring ethernet interfaces...

**Format:**
Six colon-separated hexadecimal pairs...

**How it's used:**
Written to agent-config.yaml interfaces section with 'macAddress:' key...

**Important:**
⚠️ Wrong MAC address = network configuration applied to wrong NIC...

**Example:**
Dell R640 eno1 MAC from BIOS → 52:54:00:6b:34:56`}
>
```

**Why this format:**
- Beginner-friendly: explains WHY not just WHAT
- Production-ready: includes failure modes and best practices
- Hardware-specific: real server models, actual interface names
- Comprehensive: user doesn't need to search docs

**When to use:**
- All new tooltips
- When updating existing basic tooltips
- When user reports confusion about a field

**Quality reference:**
- NetworkingV2Step.jsx: Machine Network field (lines 344-359)
- NodeDrawerAgentContent.jsx: Enhanced tooltips (v1.2.2)

---

## High-Side Integration (v1.1.1 - v1.1.3)

The app supports **high-side (disconnected) deployments** where the tool runs on an air-gapped network.

### Architecture (added v1.1.1)

**Backend Modules:**
- `backend/src/runtimePackage.js` - Packages Node.js runtime for target OS/arch (~50-100MB)
- `backend/src/exportInclusion.js` - Controls what gets included in exports
- `backend/src/placeholderEngine.js` - Replaces sensitive values with placeholders

**Frontend Modules:**
- `frontend/src/exportInclusion.js` - Export inclusion UI logic
- `frontend/src/placeholderEngine.js` - Client-side placeholder handling

### UI Integration (added v1.1.2)

**ReviewStep.jsx Changes:**
- Export inclusion checkboxes (7 credential/certificate categories)
- `includeHighSideRuntimePackage` toggle for bundling Node.js runtime
- Per-class credential inclusion: pullSecret, mirrorRegistryPullSecret, sshKey, certificates, etc.

**Export Categories:**
1. Pull secrets (Red Hat, mirror registry, operators)
2. SSH keys (public + private)
3. Certificates (mirror registry CA, proxy CA)
4. Mirror registry credentials
5. Proxy credentials
6. vCenter/BMC credentials
7. Platform-specific credentials

### Critical Rules

**DO NOT:**
- Modify export inclusion logic without understanding placeholder system
- Assume placeholders are reversible (they're ONE-WAY)
- Change ReviewStep.jsx without testing all export options

**Important Files:**
- `frontend/src/steps/ReviewStep.jsx` - Main export UI
- `backend/src/generate.js` - Uses placeholder engine during generation
- `backend/src/exportInclusion.js` - Defines what can be excluded

**Testing:**
- High-side integration is core functionality, not optional
- Changes to ReviewStep require testing all 7 export option categories
- Runtime package size varies by platform (Node.js binary + dependencies)

---

## PROD Phase 1: Production Readiness (v1.6.0 - Complete)

**Completion Date:** 2026-05-20  
**Status:** All 6 critical items verified_done  
**Version:** Implemented in v1.6.0 release

### Implementation Summary

PROD Phase 1 addresses 6 critical blockers required before ANY production deployment:

1. **PROD-002: Structured Logging Framework** ✅
   - Pino logging library with JSON output for production
   - AsyncLocalStorage-based request correlation
   - Error ID generation for client-to-server correlation
   - 87 console statements replaced across 5 backend files
   - Files: `backend/src/logger.js`, `backend/src/middleware/logging.js`
   - Tests: `backend/test/logger.test.js` (14 tests passing)

2. **PROD-003: Kubernetes/OpenShift Deployment Manifests** ✅
   - 13 manifest files: Deployments, Services, PVC, ConfigMap, Secret, Routes
   - Kustomize structure for environment overlays
   - Restricted-v2 SCC compatible (UID 1001, non-root)
   - Files: `manifests/base/*.yaml`, `manifests/openshift/*.yaml`
   - Documentation: `manifests/README.md`

3. **PROD-004: Resource Limits and Capacity Planning** ✅
   - Backend: 500m-2000m CPU, 1-4Gi RAM
   - Frontend: 100m-500m CPU, 256-512Mi RAM
   - Load test script: `scripts/load-test.sh` (5 test scenarios)
   - Documentation: `docs/CAPACITY_PLANNING.md` (40KB, 13 sections)

4. **PROD-005: SQLite Backup/Restore Procedures** ✅
   - Comprehensive backup/restore documentation (703 lines)
   - 4 executable scripts: backup, verify, restore, test
   - Online backup using SQLite VACUUM INTO
   - Documentation: `docs/BACKUP_RESTORE.md`
   - Scripts: `scripts/backup-sqlite.sh`, `scripts/verify-backup.sh`, `scripts/restore-sqlite.sh`, `scripts/test-backup-restore.sh`

5. **PROD-006: Enhanced Health Probes** ✅
   - Liveness probe: `/api/health` (process health only)
   - Readiness probe: `/api/ready` (DB read + write checks)
   - K8s probe configurations in deployment manifests
   - Documentation: `docs/HEALTH_PROBES.md` (400+ lines)
   - Tests: `backend/test/health-probes.test.js` (13 tests passing)

6. **PROD-007: Backend Request Schema Validation** ✅
   - 12 new Zod schemas for previously unvalidated routes
   - Enhanced validateBody middleware with error IDs
   - Applied to all 22 POST routes
   - Documentation: `docs/API_SCHEMA.md`
   - Tests: `backend/test/validation.test.js` (63 tests passing)

### Testing Status

- **Backend:** 373 tests passing (90 new tests from PROD Phase 1)
- **Frontend:** 707 tests passing (no changes)
- **Total:** 1080 tests passing

**Pre-existing failures (not related to PROD Phase 1):**
- `backend/test/openshiftInstaller.test.js`: 1 failure (Node.js test runner serialization issue)
- `frontend/tests/placeholderValuesHelpers.test.js`: 1 failure (IPv6 placeholder values)
- `frontend/tests/networking-v2-step.test.jsx`: 3 failures (dual-stack IPv6 VIP placeholders)

### Critical Files Added

**Backend:**
- `backend/src/logger.js` - Pino logger utility
- `backend/src/middleware/logging.js` - Request correlation middleware
- `backend/test/logger.test.js` - Logger tests (14 tests)
- `backend/test/health-probes.test.js` - Health probe tests (13 tests)
- `backend/test/validation.test.js` - Schema validation tests (63 tests)

**Kubernetes Manifests:**
- `manifests/base/backend-deployment.yaml`
- `manifests/base/backend-service.yaml`
- `manifests/base/frontend-deployment.yaml`
- `manifests/base/frontend-service.yaml`
- `manifests/base/pvc.yaml`
- `manifests/base/configmap.yaml`
- `manifests/base/secret.yaml`
- `manifests/openshift/route-backend.yaml`
- `manifests/openshift/route-frontend.yaml`
- `manifests/kustomization.yaml`
- `manifests/README.md`

**Scripts:**
- `scripts/backup-sqlite.sh` - Automated SQLite backup
- `scripts/verify-backup.sh` - Backup integrity validation
- `scripts/restore-sqlite.sh` - Safe restore with prompts
- `scripts/test-backup-restore.sh` - Backup/restore test suite
- `scripts/load-test.sh` - Load testing script

**Documentation:**
- `docs/BACKUP_RESTORE.md` - SQLite backup and disaster recovery (703 lines)
- `docs/HEALTH_PROBES.md` - K8s health probe configuration (400+ lines)
- `docs/API_SCHEMA.md` - API contract and validation rules
- `docs/CAPACITY_PLANNING.md` - Resource requirements and scaling (40KB)

### Critical Dependencies Added

**Backend (`backend/package.json`):**
- `pino ^10.3.1` - Production logging library
- `pino-pretty ^13.1.3` - Development pretty-printing

### Next Steps

After v1.6.0 release, PROD Phase 2 items become active:
- PROD-008: Prometheus metrics and instrumentation
- PROD-009: Formal database migration system
- PROD-010: End-to-end tests for critical workflows
- PROD-011: Load testing with documented results
- PROD-012: Automated job cleanup/retention policy
- PROD-013: Capacity planning validation
- PROD-014: Establish versioning and changelog maintenance

---

## Questions?

If you're unsure about:
- **Status vocabulary:** Check BACKLOG_STATUS.md header
- **What to archive:** Check "File Organization" section above
- **Commit format:** Check git log for recent examples
- **Testing requirements:** Check "Testing Requirements" section above

**When in doubt:** Ask the user before making assumptions about:
- Status of incomplete work
- Whether to archive or keep a file
- Priority of new work
- Scope of a feature request

---

**Last Updated:** 2026-05-20  
**Revision:** PROD Phase 1 completion (v1.6.0) - Added PROD Phase 1 section documenting completion of 6 critical production readiness items (structured logging, K8s manifests, resource limits, backup/restore procedures, health probes, schema validation), updated BACKLOG_STATUS.md to mark PROD-002 through PROD-007 as verified_done with implementation evidence
