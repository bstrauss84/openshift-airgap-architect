# Pre-Merge Testing Report - Version 1.1.0
**Date:** 2026-05-14  
**Branch:** merge-test/main-into-develop  
**Commits:** 195 (179 develop + 12 main + 4 UI fixes)  
**Tester:** Claude Sonnet 4.5 + Bill Strauss

---

## Executive Summary

**Status:** In Progress  
**Phase:** Phase 1 - Manual Feature Testing

**Automated Test Baseline:**
- ✅ Frontend: 682 tests passed, 2 skipped (684 total)
- ✅ Backend: 245 tests passed
- ✅ Total: 927 tests passing (100% pass rate)

---

## Phase 1: Manual Feature Testing

**Objective:** Test all 17 feature categories to ensure nothing is broken

### Test Environment Setup

**Frontend Dev Server:** Not started  
**Backend Server:** Not started  
**Test Browser:** Pending

### Testing Progress

#### 1.1 Core UI & Theme (15 minutes) - ⏸️ PENDING

- [ ] Toggle light/dark mode - verify localStorage persistence
- [ ] Verify readability of all text in both themes
- [ ] Collapse/expand sidebar - check state persistence
- [ ] Navigate through all tabs - verify step tracking
- [ ] Check responsive behavior (resize browser window)

**Status:** Pending  
**Notes:** Requires user to perform manual UI testing

---

#### 1.2 Cincinnati & Blueprint (20 minutes) - ⏸️ PENDING

- [ ] Click "Update" button on Blueprint step
  - Verify background job starts
  - Check Operations tab shows streaming output
  - Confirm channels/patches refresh after completion
- [ ] Select minor channel and patch version
- [ ] Lock in Blueprint - verify confirmation modal
- [ ] Check that operator scans are blocked until pull secret provided
- [ ] Provide blueprint pull secret (ephemeral) - verify not persisted in export
- [ ] Verify operator scan kicks off automatically after pull secret lock-in

**Status:** Pending  
**Notes:** Requires user to perform manual UI testing

---

#### 1.3 Secret Helpers & Generation (15 minutes) - ⏸️ PENDING

- [ ] Click "Help me generate" on Pull Secret field
  - Verify modal opens with instructions
  - Test copy-to-clipboard functionality
- [ ] Click "Help me generate" on SSH Key field
  - Verify keypair generation works
  - Download private key file
  - Verify public key copied to field
  - Check that private key is NOT in export
- [ ] Test pull secret validation (invalid JSON should error)
- [ ] Test SSH key validation (invalid format should error)

**Status:** Pending  
**Notes:** Requires user to perform manual UI testing

---

#### 1.4 Binary Downloads & Architecture Detection (10 minutes) - ⏸️ PENDING

- [ ] Monitor backend logs during startup
- [ ] Verify CPU architecture detection (x86_64, aarch64, ppc64le, s390x)
- [ ] Check that correct binaries download for detected architecture
- [ ] Verify openshift-install binary downloads correctly
- [ ] Verify oc-mirror binary downloads correctly
- [ ] Check mirror-registry binary inclusion option on Assets & Guide

**Status:** Pending  
**Notes:** Can verify architecture detection in backend logs, rest requires user testing

---

#### 1.5 AMI ID Auto-Detection (10 minutes) - ⏸️ PENDING

- [ ] Select AWS GovCloud IPI scenario
- [ ] Choose architecture (x86_64 or aarch64)
- [ ] Choose region
- [ ] Verify AMI ID auto-populates in Platform Specifics
- [ ] Check backend API call: `/api/aws/ami?version=X&arch=Y&region=Z`
- [ ] Verify AMI warming (download of AMI ID to local tar)

**Status:** Pending  
**Notes:** Requires user to perform manual UI testing

---

#### 1.6 Operator Discovery (15 minutes) - ⏸️ PENDING

- [ ] **From Operators tab:**
  - Provide Red Hat pull secret
  - Click scan buttons for Red Hat/Certified/Community catalogs
  - Verify background jobs start (check Operations tab)
  - Monitor progress indicator (0% → 100% over ~6 minutes)
  - Check that operators populate after scan completes
- [ ] **Test operator quick-picks:**
  - Select "Virtualization" quick pick - verify operators added
  - Select "OpenShift Data Foundation" - verify version-aware selection
  - Clear all selections - verify operators return to catalog lists
- [ ] **Manual operator search:**
  - Search for "logging" - verify filtering works
  - Select multiple operators - verify checkmarks and "Selected Operators" section

**Status:** Pending  
**Notes:** Requires user to perform manual UI testing

---

#### 1.7 YAML Preview Drawer (20 minutes) - ⏸️ PENDING

- [ ] Click "Show YAML" button in header
- [ ] Verify drawer slides in from right
- [ ] Check that install-config.yaml displays with syntax highlighting
- [ ] For agent-based scenarios, verify split view (install-config + agent-config)
- [ ] Test vertical drag-resize (350-800px width)
- [ ] Test horizontal drag-resize (agent split view)
- [ ] Toggle "Show sensitive values" - verify obfuscation/reveal
- [ ] Download individual YAML files - check filenames
- [ ] Verify YAML updates in real-time as you change fields
- [ ] Check debounce (100ms delay before regeneration)
- [ ] Navigate to Operators tab - verify ImageSet config displays
- [ ] Navigate to Run oc-mirror tab - verify source switching works

**Status:** Pending  
**Notes:** Requires user to perform manual UI testing

---

#### 1.8 Scenario Summary (10 minutes) - ⏸️ PENDING

- [ ] Expand scenario summary collapsible at top of each tab
- [ ] Verify live-updating as you change fields
- [ ] Check that only confirmed tabs appear
- [ ] Verify 7 configuration categories display correctly
- [ ] Test drag-resize (150-800px height)
- [ ] Verify documentation sources link correctly
- [ ] Check "This will generate" file list accuracy

**Status:** Pending  
**Notes:** Requires user to perform manual UI testing

---

#### 1.9 Field Guide Generation (15 minutes) - ⏸️ PENDING

- [ ] Complete full workflow to Assets & Guide step
- [ ] Click "Generate & Download Assets"
- [ ] Verify FIELD_MANUAL.md is included in zip
- [ ] Extract and review Field Guide content:
  - Check scenario-specific sections
  - Verify numbered, actionable steps
  - Check official Red Hat doc source citations
  - Verify compartmentalization (only relevant sections included)
- [ ] Change configuration - regenerate - verify Field Guide updates

**Status:** Pending  
**Notes:** Requires user to perform manual UI testing

---

#### 1.10 Export/Import Runs (20 minutes) - ⏸️ PENDING

- [ ] **Export:**
  - Click Export Run in Tools drawer
  - Verify JSON file downloads with timestamp
  - Check filename format: `airgap-architect-run-YYYYMMDD-HHMMSS.json`
  - Open JSON - verify credentials are stripped
  - Toggle "Include credentials" option - verify they're included
- [ ] **Import:**
  - Click Import Run in Tools drawer
  - Select previously exported file
  - Verify state loads correctly
  - Check that first-attention-step is detected
  - Verify import history is preserved
  - Test re-importing same file (should allow override after edit)

**Status:** Pending  
**Notes:** Requires user to perform manual UI testing

---

#### 1.11 Node Drawer/Side Panel (15 minutes) - ⏸️ PENDING

- [ ] Select bare-metal scenario
- [ ] Navigate to Host Inventory step
- [ ] Click "Add node" or edit existing node
- [ ] Verify node drawer slides in
- [ ] Test all fields:
  - Hostname, role (master/worker), MAC address
  - BMC address/username/password/disable certificate verification
  - Root device hints
  - Network interfaces (primary, additional)
  - Bond/VLAN configuration
- [ ] Verify real-time duplicate hostname validation
- [ ] Save node - verify it appears in host list
- [ ] Test node reordering (drag/drop if available)
- [ ] Delete node - verify removal

**Status:** Pending  
**Notes:** Requires user to perform manual UI testing

---

#### 1.12 oc-mirror Automation - All 3 Workflows (45 minutes) - ⏸️ PENDING

**1.12.1 mirrorToDisk (Internet → Disk):**
- [ ] Navigate to Run oc-mirror step
- [ ] Select "Mirror to disk" workflow
- [ ] Configure:
  - Archive path (output tar/directory)
  - Workspace path
  - Cache path
  - Advanced options (parallel images/layers, timeout, retries)
- [ ] Run preflight checks - verify validation passes
- [ ] Start mirror job - verify confirmation modal
- [ ] Check Operations tab:
  - Verify job appears with "running" status
  - Check streaming output (EventSource/SSE)
  - Monitor progress
- [ ] Test dry-run mode - verify no actual mirroring occurs
- [ ] Download generated mapping.txt/missing.txt files

**1.12.2 diskToMirror (Disk → Mirror Registry):**
- [ ] Select "Disk to mirror" workflow
- [ ] Configure:
  - Archive path (source from mirrorToDisk)
  - Registry URL (docker://registry.local:5000)
  - Mirror pull secret (ephemeral)
  - Workspace path
- [ ] Run preflight validation - check registry connectivity
- [ ] Start mirror job - monitor in Operations
- [ ] Verify strict archive validation option works

**1.12.3 mirrorToMirror (Internet → Mirror Registry):**
- [ ] Select "Mirror to mirror" workflow
- [ ] Configure:
  - Registry URL
  - Both RH pull secret and mirror pull secret (ephemeral)
  - Advanced options
- [ ] Run preflight checks - verify both credentials validate
- [ ] Start job - monitor streaming output
- [ ] Test job cancellation - verify artifact cleanup warnings

**Status:** Pending  
**Notes:** Requires user to perform manual UI testing, longest test section

---

#### 1.13 Operations Tab & Job Management (20 minutes) - ⏸️ PENDING

- [ ] Navigate to Operations tab (sidebar)
- [ ] Verify all background jobs appear:
  - Cincinnati refresh jobs
  - Operator scan jobs
  - oc-mirror run jobs
- [ ] Check job status badges (running/completed/failed)
- [ ] Test job streaming:
  - Click running job - verify EventSource stream displays live output
  - Check auto-scroll behavior
- [ ] **Download individual log:**
  - Click download button on completed job
  - Verify timestamped filename
  - Check log content includes job metadata
- [ ] **Export all logs:**
  - Click "Export all" button
  - Verify zip file with all operation logs
- [ ] Test job history (past 24 hours, past week)
- [ ] Verify job count badge in header updates

**Status:** Pending  
**Notes:** Requires user to perform manual UI testing

---

#### 1.14 Proxy Configuration (15 minutes) - ⏸️ PENDING

- [ ] Navigate to Trust & Proxy step
- [ ] Enable proxy toggle
- [ ] Configure HTTP/HTTPS/NO_PROXY settings
- [ ] Upload Proxy CA certificate (drag/drop and file select)
- [ ] Upload Mirror Registry CA certificate
- [ ] Verify trust bundle policy auto-selection:
  - Only Proxy CA → "Proxyonly"
  - Only Mirror CA → "Always"
  - Both → "Always"
- [ ] Check cert analysis tool (if >40 certs):
  - Verify size bar visualization
  - Test classification filters
  - Select/exclude specific certs
- [ ] Verify proxy settings appear in install-config YAML

**Status:** Pending  
**Notes:** Requires user to perform manual UI testing

---

#### 1.15 Feedback Functionality (10 minutes) - ⏸️ PENDING

- [ ] Click Feedback button (if visible - check high-side mode)
- [ ] Verify feedback drawer opens
- [ ] Fill out feedback form:
  - Issue type dropdown
  - Description textarea
  - Scenario context capture (auto-populated)
- [ ] Submit feedback - verify GitHub issue URL generation
- [ ] Test markdown fallback copy-to-clipboard
- [ ] Verify rate limiting (max submissions per time window)

**Status:** Pending  
**Notes:** Requires user to perform manual UI testing

---

#### 1.16 Start Over & State Reset (10 minutes) - ⏸️ PENDING

- [ ] Start background job (operator scan or oc-mirror)
- [ ] Click "Start Over" while job running
- [ ] Verify warning modal about running jobs and artifact loss
- [ ] Confirm Start Over - check state clears
- [ ] Verify localStorage is reset
- [ ] Check backend state is cleared (POST /api/state with empty)
- [ ] Verify running jobs are cancelled

**Status:** Pending  
**Notes:** Requires user to perform manual UI testing

---

#### 1.17 Update Banner & About (5 minutes) - ⏸️ PENDING

- [ ] Check for update banner (if updates available)
- [ ] Click "View Details" in About section
- [ ] Verify About modal displays:
  - Version 1.1.0
  - Git SHA
  - Build time
  - License
  - Resources links

**Status:** Pending  
**Notes:** Requires user to perform manual UI testing

---

## Phase 2: Add Missing Automated Tests

**Status:** Not Started  
**Will begin after Phase 1 completes**

### High-Priority Tests to Add

1. SSH Key Generation (`frontend/tests/ssh-key-generation.test.jsx`)
2. AMI ID Auto-Detection (`frontend/tests/ami-auto-detection.test.jsx`)
3. Field Guide Generation (`backend/test/field-guide.test.js`)
4. Binary Download Architecture Detection (`backend/test/binary-download.test.js`)
5. Operations Tab Interactions (`frontend/tests/operations-interactions.test.jsx`)
6. Node Drawer Component (`frontend/tests/host-inventory-drawer.test.jsx`)

### E2E Tests to Add

7. E2E Happy Path Workflow (`frontend/tests/e2e/happy-path.test.jsx`)
8. E2E oc-mirror Workflow (`frontend/tests/e2e/ocmirror-workflow.test.jsx`)

### Test Infrastructure Improvements

- Coverage reporting (c8 for backend, vitest --coverage for frontend)
- Cross-browser testing matrix (Chrome, Firefox, Safari)
- Dependency vulnerability scanning (Dependabot + npm audit in CI)
- Performance budgets (Lighthouse CI)

---

## Phase 3: Pre-Production Best Practices

**Status:** Not Started  
**Will begin after Phase 2 completes**

### To Implement

- [ ] Create `docs/PRE_MERGE_CHECKLIST.md`
- [ ] Optional: Staging environment validation
- [ ] Optional: API contract testing (OpenAPI/Swagger)
- [ ] Optional: Load testing (Artillery/k6)

---

## Phase 4: Final Verification

**Status:** Not Started  
**Will execute before declaring merge-ready**

### Final Checks

- [ ] All tests pass (frontend + backend)
- [ ] Coverage thresholds met (>70%)
- [ ] No security vulnerabilities (npm audit)
- [ ] Bundle size under limit (<2048 KB)
- [ ] Git working tree clean
- [ ] Documentation updated (CHANGELOG.md, README.md)
- [ ] Version bumped correctly (1.1.0)

---

## Issues Found

### Issue 1: Blueprint ↔ Operations Navigation Blocked (FIXED)

**Status:** ✅ FIXED  
**Severity:** High  
**Reported by:** User  
**Date Found:** 2026-05-14

**Description:**  
Users were unable to navigate between Blueprint and Operations tabs before locking in foundational selections. A "Lock your foundational selections to continue" warning appeared when attempting to click the Operations tab from Blueprint.

**Root Cause:**  
Navigation guards in App.jsx only allowed Blueprint tab before lock-in, blocking Operations tab. This regression occurred during the main→develop merge, where some navigation logic from commit d2034f8 wasn't fully carried over.

**Why This Matters:**  
- Users behind proxies who can't get Cincinnati "Update" button to work need to see Operations logs to debug
- Cincinnati refresh already logs to Operations (jobId is set in highlightJobId on failure)
- Test file `blueprint-cincinnati-behavior.test.jsx` confirms Cincinnati refresh jobs appear in Operations

**Fix Applied:**  
Modified frontend/src/App.jsx in 4 locations:

1. **Route guard effect** (line 470): Changed to allow both "blueprint" and "operations" pre-lock
2. **attemptNavigate function** (line 728): Allow navigation to operations pre-lock
3. **Footer Back button** (line 1234): Added special "Back to Blueprint" button when on operations tab pre-lock
4. **Next button disabled** (line 1267): Disable Next button when on operations tab pre-lock

**Note:** Sidebar.jsx already had correct logic from main merge (line 31).

**Verification:**  
- ✅ All 682 frontend tests pass
- ✅ Cincinnati behavior tests pass (7/7)
- ✅ Frontend build succeeds
- ⏸️ Manual testing pending (user to verify)

---

## Recommendations

**None yet - testing in progress**

---

## Sign-Off

**Phase 1 (Manual Testing):** Pending  
**Phase 2 (Automated Tests):** Pending  
**Phase 3 (Best Practices):** Pending  
**Phase 4 (Final Verification):** Pending  

**Ready for Merge:** ❌ Not yet

---

**Last Updated:** 2026-05-14 11:05 EDT
