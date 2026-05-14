# Manual Testing Checklist - v1.1.0 Pre-Merge

**Date:** 2026-05-14  
**Branch:** merge-test/main-into-develop  
**Version:** 1.1.0  
**Tester:** ___________

---

## Testing Environment Setup

**Prerequisites:**
- [ ] Docker or Podman running
- [ ] Port 5173 available
- [ ] Red Hat pull secret available (for operator discovery)
- [ ] Clean state: `podman compose down -v && podman compose up --build -d`
- [ ] UI accessible at http://localhost:5173

**Optional (for full oc-mirror testing):**
- [ ] `oc` binary installed
- [ ] `oc-mirror` v2 binary installed
- [ ] Mirror registry credentials available

---

## 1. Core UI & Theme

**Test Steps:**
- [ ] Landing page loads with wizard CTA button
- [ ] Click "Begin Configuration" → enters Blueprint step
- [ ] Tools menu (gear icon) accessible
- [ ] Dark mode toggle works (click Tools → Dark Mode)
  - [ ] All tabs render correctly in dark mode
  - [ ] Switch back to light mode works
- [ ] Sidebar navigation visible after Blueprint lock-in
- [ ] Footer navigation (Back/Next buttons) functional

**Expected Results:**
- UI renders without console errors
- Theme persists across page refreshes
- All PatternFly components render correctly in both themes

**Notes:**
_____________________________________

---

## 2. Cincinnati & Blueprint

**Test Steps:**
- [ ] Blueprint step loads
- [ ] Cluster name field accepts valid input (lowercase, hyphens, 1-15 chars)
- [ ] Base domain field accepts valid domain
- [ ] Platform dropdown shows all platforms (vSphere IPI/UPI, Bare Metal, AWS, Azure, GCP, Nutanix, IBM Cloud)
- [ ] Select platform → shows platform-specific fields
- [ ] OpenShift version dropdown shows 4.17-4.20
- [ ] Click "Update" button to fetch release channels
  - [ ] Operations tab shows Cincinnati refresh job
  - [ ] Job completes successfully
  - [ ] Release channel dropdown populates
- [ ] Select channel → patch version dropdown populates
- [ ] Test Cincinnati failure scenario (disconnect network):
  - [ ] Click Update while offline
  - [ ] Operations tab shows failed job with error message
  - [ ] Can navigate to Operations tab before lock-in (DOC-070 fix)

**Expected Results:**
- Cincinnati integration works online
- Errors are gracefully handled offline
- Blueprint ↔ Operations navigation works before lock-in

**Notes:**
_____________________________________

---

## 3. Secret Helpers & Generation

**Test Steps:**
- [ ] Identity & Access step: SSH key helper
  - [ ] Click "Generate SSH Keypair"
  - [ ] Modal opens with public/private key display
  - [ ] Copy buttons work
  - [ ] Download buttons work
  - [ ] Keys are not automatically populated in form (user must paste)
- [ ] Connectivity & Mirroring step: Pull secret helper
  - [ ] Click "Generate Pull Secret" or "Merge Pull Secrets"
  - [ ] Modal shows helper UI
  - [ ] Generated secrets can be copied
  - [ ] Secrets are not auto-populated (user must paste)

**Expected Results:**
- Helpers generate valid credentials locally
- No credentials are persisted without explicit export
- Download/copy functionality works
- Modals are keyboard accessible (Tab, Shift+Tab, Escape)

**Notes:**
_____________________________________

---

## 4. Binary Downloads & Architecture Detection

**Test Steps:**
- [ ] Assets & Guide tab: Binary downloads section
  - [ ] Architecture auto-detected correctly (check platform: x86_64, aarch64)
  - [ ] All download links present:
    - [ ] openshift-install
    - [ ] oc client
    - [ ] oc-mirror v2
  - [ ] Links point to correct architecture
  - [ ] Version matches selected OpenShift version

**Expected Results:**
- Correct architecture detected on your system
- Download links are valid Red Hat mirror URLs
- Version in URL matches selected OCP version

**Notes:**
_____________________________________

---

## 5. AMI ID Auto-Detection (AWS/Azure)

**Test Steps:**
- [ ] Select AWS GovCloud IPI platform in Blueprint
- [ ] Lock in Blueprint → Platform Specifics step loads
- [ ] AMI ID field shows auto-detection toggle
- [ ] Enable auto-detection
- [ ] Enter region (us-gov-west-1)
- [ ] AMI ID auto-populates based on selected OCP version
- [ ] Repeat for Azure Government IPI:
  - [ ] Select Azure platform
  - [ ] Image SKU auto-detects for selected version

**Expected Results:**
- AMI IDs match selected OCP version and region
- Auto-detection can be disabled for manual entry
- Azure image SKU aligns with version

**Notes:**
_____________________________________

---

## 6. Operator Discovery

**Test Steps:**
- [ ] Operators step: Click "Scan Operators"
- [ ] Enter Red Hat pull secret in modal
- [ ] Job starts and streams to Operations tab
- [ ] Wait for completion (may take 2-3 minutes)
- [ ] Operator list populates with certified/community/Red Hat operators
- [ ] Search/filter operators by name
- [ ] Select multiple operators
- [ ] Selected operators persist in state
- [ ] Test offline scenario:
  - [ ] Disconnect network, click "Scan Operators"
  - [ ] Job fails with network error in Operations
  - [ ] Error message is helpful

**Expected Results:**
- Scan completes with 100+ operators listed
- Operators can be selected/deselected
- State persists across tab navigation
- Offline errors are clear

**Notes:**
_____________________________________

---

## 7. YAML Preview Drawer (DOC-034)

**Test Steps:**
- [ ] After Blueprint lock-in, "Show YAML" button appears in header
- [ ] Click "Show YAML" → drawer slides in from right
- [ ] Drawer shows install-config.yaml preview
- [ ] Syntax highlighting renders (YAML keywords colored)
- [ ] Make changes in any step → YAML updates in real-time (debounced 100ms)
- [ ] Test agent-based scenario (Bare Metal):
  - [ ] Drawer shows split view: install-config + agent-config
  - [ ] Horizontal drag handle between splits works
  - [ ] Both YAMLs update live
- [ ] Test Operators step:
  - [ ] Drawer shows ImageSet config
  - [ ] Source toggle switches between install-config and ImageSet
- [ ] Test Run oc-mirror step:
  - [ ] Drawer shows ImageSet config
  - [ ] Source toggle works
- [ ] Vertical drag-resize:
  - [ ] Drag left edge to resize drawer
  - [ ] Min width: 350px, Max width: 800px
- [ ] Security:
  - [ ] Credentials are obfuscated by default (pullSecret, sshKey, passwords show "********")
  - [ ] Toggle "Show sensitive values" → credentials visible
  - [ ] Toggle off → credentials obfuscated again
- [ ] Download buttons:
  - [ ] Click download for install-config → file downloads with correct name
  - [ ] Click download for agent-config (if applicable) → file downloads
  - [ ] Click download for ImageSet → file downloads
- [ ] Warning messages:
  - [ ] With incomplete config (missing required fields), warning banner shows
  - [ ] Warning message is helpful
- [ ] Close drawer:
  - [ ] Click "Hide YAML" or outside drawer → drawer closes
  - [ ] Re-open → drawer shows last viewed config
- [ ] Keyboard accessibility:
  - [ ] Tab through drawer controls
  - [ ] Escape key closes drawer
  - [ ] Focus trap works (Tab cycles within drawer)
- [ ] Mobile responsive:
  - [ ] Resize browser to tablet width → drawer adapts
  - [ ] Resize to mobile width → drawer goes full-screen

**Expected Results:**
- Drawer is smooth and responsive (100ms debounce)
- No performance issues with real-time updates
- Credentials obfuscated by default
- Download functionality works
- Keyboard and mobile UX is polished

**Notes:**
_____________________________________

---

## 8. Scenario Summary Panel (DOC-058)

**Test Steps:**
- [ ] After Blueprint lock-in, scenario summary panel appears above sidebar
- [ ] Panel is collapsed by default (shows "Configuration Summary" with expand arrow)
- [ ] Click expand → panel opens with configuration sections
- [ ] Sections shown (only for visited tabs):
  - [ ] Identity (Cluster name, Base domain, SSH key status)
  - [ ] Networking (Network type, CIDR ranges)
  - [ ] Connectivity (Mirror registry, Pull secret status)
  - [ ] Trust (Proxy settings, Trust bundle status)
  - [ ] Platform (Platform type, region/datacenter, credentials status)
  - [ ] Hosts (Host count, role breakdown) - for bare metal only
  - [ ] Operators (Operator count, catalog sources)
- [ ] Progress through wizard → summary updates live
- [ ] Only confirmed tabs show in summary (visited + validated + not flagged)
- [ ] Documentation sources listed at bottom:
  - [ ] Links to official Red Hat docs
  - [ ] Links match selected platform and version
- [ ] Drag-resize:
  - [ ] Drag bottom edge to resize panel height
  - [ ] Min height: 150px, Max height: 800px
- [ ] Styling:
  - [ ] Bold uppercase labels
  - [ ] Blue category headers
  - [ ] Bullet points for multi-value fields
  - [ ] Row dividers for readability
  - [ ] Custom scrollbar styling
- [ ] Collapse/expand persists across tab navigation

**Expected Results:**
- Summary updates in real-time as user progresses
- Only shows sections for confirmed tabs
- Documentation sources are accurate for selected platform/version
- Resizing is smooth and persists
- Professional visual polish

**Notes:**
_____________________________________

---

## 9. Field Guide Generation (FIELD_MANUAL.md)

**Test Steps:**
- [ ] Complete all required configuration steps
- [ ] Assets & Guide tab: Field Guide section
- [ ] Click "Generate Field Guide"
- [ ] FIELD_MANUAL.md downloads
- [ ] Open file in Markdown viewer
- [ ] Verify structure:
  - [ ] Numbered sections (1, 2, 3...)
  - [ ] Compartmentalized by scenario (platform, connectivity, FIPS, proxy, NTP, etc.)
  - [ ] Each section cites official Red Hat doc sources
  - [ ] Sections include actionable steps
  - [ ] Configuration values embedded (cluster name, VIPs, registry FQDN, etc.)
- [ ] Test different scenarios:
  - [ ] vSphere IPI with proxy → proxy sections included
  - [ ] Bare Metal with NTP → NTP sections included
  - [ ] AWS without proxy → proxy sections omitted
- [ ] Version alignment:
  - [ ] Doc sources match selected OCP version (4.17-4.20)

**Expected Results:**
- Field guide is scenario-specific and actionable
- Configuration values are correctly substituted
- Doc citations are accurate for selected version
- Only relevant sections are included

**Notes:**
_____________________________________

---

## 10. Export/Import State

**Test Steps:**
- [ ] Configure partial wizard state (complete 3-4 steps)
- [ ] Click Tools → Export
- [ ] Modal shows export options:
  - [ ] Include credentials (checkbox)
  - [ ] Include certificates (checkbox)
  - [ ] Include client tools (checkbox)
  - [ ] Include openshift-install (checkbox)
- [ ] Test export WITHOUT credentials:
  - [ ] Uncheck "Include credentials"
  - [ ] Click "Export"
  - [ ] Bundle downloads (.tar.gz)
  - [ ] Extract bundle → verify credentials are NOT present in install-config.yaml
- [ ] Test export WITH credentials:
  - [ ] Export with "Include credentials" checked
  - [ ] Extract bundle → verify credentials ARE present
- [ ] Test import:
  - [ ] Click "Start Over" to reset wizard
  - [ ] Click "Import Configuration"
  - [ ] Upload previous export bundle
  - [ ] Wizard state restores:
    - [ ] All form fields populated
    - [ ] Correct step is active
    - [ ] Sidebar reflects import
  - [ ] If exported without credentials:
    - [ ] Verify credentials fields are empty (not restored)
  - [ ] If exported with credentials:
    - [ ] Verify credentials are restored

**Expected Results:**
- Export respects credential inclusion checkbox
- Import restores exact wizard state
- Credentials only restored if explicitly included in export
- Bundle structure is correct (install-config.yaml, agent-config.yaml if applicable, imageset-config.yaml, state.json)

**Notes:**
_____________________________________

---

## 11. Node Drawer/Side Panel

**Test Steps:**
- [ ] Host Inventory step (bare metal scenarios only)
- [ ] Add a host to inventory
- [ ] Click "Edit" or click on host row → node drawer opens from right
- [ ] Drawer shows host details form:
  - [ ] Hostname
  - [ ] Role (master/worker)
  - [ ] BMC details (address, username, password, disableCertificateVerification)
  - [ ] Boot MAC address
  - [ ] rootDeviceHints
  - [ ] networkConfig
- [ ] Edit fields → changes save on "Save"
- [ ] Keyboard accessibility:
  - [ ] Tab through fields
  - [ ] Escape closes drawer
  - [ ] Focus trap works
- [ ] Close drawer:
  - [ ] Click "Cancel" → changes discarded
  - [ ] Click "Save" → changes persist
  - [ ] Click outside drawer → same as Cancel

**Expected Results:**
- Drawer opens smoothly
- Form validation works (required fields enforced)
- Changes only saved on explicit "Save"
- Keyboard navigation polished

**Notes:**
_____________________________________

---

## 12. oc-mirror Automation (3 Workflows)

**Test Steps:**

### Workflow 1: Mirror-to-Disk
- [ ] Run oc-mirror step: Select "Mirror to disk" workflow
- [ ] Enter source pull secret
- [ ] Enter output directory path
- [ ] Click "Run oc-mirror"
- [ ] Preflight validation runs:
  - [ ] Blockers prevent run if critical issues found (missing pull secret, invalid imageset)
  - [ ] Warnings allow run but show alerts
- [ ] Job starts and streams to Operations tab
- [ ] Live output shows mirror progress
- [ ] Job completes or fails with clear message
- [ ] Download logs button available after completion

### Workflow 2: Disk-to-Mirror
- [ ] Select "Disk to mirror" workflow
- [ ] Enter input directory path (from previous mirror-to-disk)
- [ ] Enter mirror registry credentials
- [ ] Enter mirror registry URL
- [ ] Preflight validation runs
- [ ] Run job → verify streaming output
- [ ] Job completes with success/failure message

### Workflow 3: Mirror-to-Mirror
- [ ] Select "Mirror to mirror" workflow
- [ ] Enter source pull secret
- [ ] Enter mirror registry credentials
- [ ] Enter mirror registry URL
- [ ] Preflight validation runs
- [ ] Run job → verify streaming output
- [ ] Job completes with success/failure message

**Common Tests:**
- [ ] Per-run credentials not persisted between runs
- [ ] Previous run credentials cleared on new run
- [ ] Validation errors are actionable
- [ ] Can cancel running job from Operations tab
- [ ] Job history shows all previous runs
- [ ] Download logs works for completed/failed jobs
- [ ] Test without oc-mirror binary installed:
  - [ ] Preflight shows blocker "oc-mirror binary not found"
  - [ ] Run button disabled
  - [ ] Error message is helpful

**Expected Results:**
- All 3 workflows function correctly
- Preflight validation catches issues before run
- Live streaming is responsive
- Credentials are not persisted
- Jobs can be cancelled mid-run
- Logs are downloadable and timestamped

**Notes:**
_____________________________________

---

## 13. Operations Tab & Job Management

**Test Steps:**
- [ ] Operations tab accessible from sidebar
- [ ] Job history shows all background jobs:
  - [ ] Cincinnati refresh
  - [ ] Operator scan
  - [ ] oc-mirror runs
- [ ] Each job shows:
  - [ ] Job type label
  - [ ] Timestamp
  - [ ] Status (running/completed/failed)
  - [ ] Expand arrow to view output
- [ ] Click expand on completed job:
  - [ ] Full output displayed
  - [ ] Output is scrollable
  - [ ] Syntax highlighting for structured output
- [ ] Live job streaming:
  - [ ] Start a long job (operator scan or oc-mirror)
  - [ ] Navigate to Operations while job running
  - [ ] Output streams in real-time
  - [ ] No performance degradation with long output
- [ ] Download logs:
  - [ ] Click "Download Log" for completed job
  - [ ] File downloads with timestamp in filename
  - [ ] Log file contains full output
- [ ] Cancel running job:
  - [ ] Click "Cancel" on running job
  - [ ] Job stops gracefully
  - [ ] Status updates to "Cancelled"
  - [ ] Partial output preserved
- [ ] Job highlighting:
  - [ ] When Cincinnati fails, job is highlighted in Operations
  - [ ] highlightJobId set correctly on error (DOC-070)
  - [ ] Click job → scrolls to and expands it
- [ ] Test Operations access before Blueprint lock-in:
  - [ ] Before locking Blueprint, click sidebar "Operations"
  - [ ] Tab loads (DOC-070 fix allows pre-lock access)
  - [ ] Can view Cincinnati refresh jobs before locking
  - [ ] Footer shows "Back to Blueprint" button

**Expected Results:**
- Operations tab is stable with long outputs
- Live streaming works without lag
- Job management (cancel, download) is reliable
- Pre-lock Operations access works (DOC-070)
- Job highlighting on errors works

**Notes:**
_____________________________________

---

## 14. Proxy Configuration

**Test Steps:**
- [ ] Trust & Proxy step
- [ ] Enable "Use HTTP Proxy"
- [ ] Enter proxy settings:
  - [ ] HTTP proxy URL
  - [ ] HTTPS proxy URL
  - [ ] No-proxy list (comma-separated domains)
- [ ] Test proxy authentication:
  - [ ] Use proxy URL with credentials: `http://user:pass@proxy.example.com:8080`
  - [ ] Verify credentials obfuscated in YAML drawer
  - [ ] Toggle "Show sensitive values" → credentials visible
- [ ] Test no-proxy list:
  - [ ] Enter multiple domains
  - [ ] Verify formatted correctly in YAML preview
- [ ] Test proxy policy (version-aware):
  - [ ] OCP 4.17-4.19: policy should be "Proxyonly"
  - [ ] OCP 4.20: policy should be "Always"
  - [ ] Verify in YAML preview
- [ ] Disable proxy:
  - [ ] Uncheck "Use HTTP Proxy"
  - [ ] Verify proxy section removed from YAML preview

**Expected Results:**
- Proxy credentials obfuscated by default
- No-proxy list formatted correctly
- Proxy policy is version-appropriate
- YAML updates immediately on changes

**Notes:**
_____________________________________

---

## 15. Additional Trust Bundle

**Test Steps:**
- [ ] Trust & Proxy step
- [ ] Enable "Use Additional Trust Bundle"
- [ ] Paste PEM-formatted CA certificate (can be multi-cert bundle)
- [ ] Test validation:
  - [ ] Invalid PEM → error message shown
  - [ ] Valid PEM → no error
- [ ] Test size limits:
  - [ ] API restricts bundles >1MB
  - [ ] Documented limit mentioned in tooltip/error
- [ ] Verify in YAML preview:
  - [ ] Trust bundle appears in install-config.yaml
  - [ ] Formatting preserved (indented correctly)
- [ ] Test analyze endpoint (if available):
  - [ ] Click "Analyze Bundle" (if UI button exists)
  - [ ] Backend validates bundle
  - [ ] Results shown (certificate count, expiration, issuer)

**Expected Results:**
- Trust bundle validation catches invalid PEM
- Size limits enforced
- Bundle appears correctly in YAML
- Analysis provides useful feedback

**Notes:**
_____________________________________

---

## 16. Feedback Functionality

**Test Steps:**
- [ ] Click Tools → Feedback
- [ ] Feedback drawer opens from right
- [ ] Form fields:
  - [ ] Feedback text (required)
  - [ ] Category dropdown (bug/feature/question/other)
  - [ ] Optional: Email for follow-up
- [ ] Fill form and click "Submit"
- [ ] GitHub issue URL generated
- [ ] Prefilled issue template with feedback details
- [ ] Markdown fallback shown (can copy to clipboard)
- [ ] Test high-side profile (if `DISABLE_FEEDBACK=true` env var):
  - [ ] Feedback menu item hidden
  - [ ] Drawer not accessible

**Expected Results:**
- Feedback drawer is user-friendly
- GitHub integration generates correct URL
- Markdown fallback works for disconnected environments
- High-side profiles disable feedback cleanly

**Notes:**
_____________________________________

---

## 17. Start Over & State Reset

**Test Steps:**
- [ ] Complete several wizard steps
- [ ] Click Tools → Start Over
- [ ] Confirmation modal appears
- [ ] Click "Cancel" → no changes, modal closes
- [ ] Click Tools → Start Over again
- [ ] Click "Confirm" → wizard resets:
  - [ ] Navigates back to Landing page
  - [ ] All form fields cleared
  - [ ] Sidebar hidden
  - [ ] YAML drawer closed
  - [ ] Job history cleared (or persisted if by design)
- [ ] Verify clean slate:
  - [ ] Click "Begin Configuration" again
  - [ ] No residual state from previous session

**Expected Results:**
- Reset is complete (no leftover state)
- Confirmation prevents accidental reset
- User can start fresh configuration

**Notes:**
_____________________________________

---

## 18. Update Banner & About

**Test Steps:**
- [ ] With `CHECK_UPDATES=true` (default):
  - [ ] If new version available on GitHub, banner shows at top
  - [ ] Banner is dismissable
  - [ ] Banner shows GitHub release URL
- [ ] Click Tools → About
- [ ] About modal shows:
  - [ ] App name and version (1.1.0)
  - [ ] License info (MIT)
  - [ ] Contributors
  - [ ] GitHub repository link
  - [ ] Build info (if available)
- [ ] Close modal (Escape key or click outside)
- [ ] Test with `CHECK_UPDATES=false`:
  - [ ] Update banner never shows
  - [ ] About modal still shows version info

**Expected Results:**
- Update banner works when enabled
- About modal shows accurate version info
- Optional features can be disabled via env vars

**Notes:**
_____________________________________

---

## Summary of Findings

**Total Tests Passed:** _____ / _____  
**Total Tests Failed:** _____  
**Blocker Issues:** _____  
**Non-Blocker Issues:** _____

### Critical Issues (Blockers)
_List any issues that prevent core functionality from working:_

1. 
2. 
3. 

### Non-Critical Issues (Can fix post-merge)
_List UI polish issues, minor bugs, or enhancements:_

1. 
2. 
3. 

### Recommendations
- [ ] Ready to merge to main
- [ ] Need to fix blocker issues first
- [ ] Need additional testing in area: ___________

---

**Tested By:** ___________  
**Date Completed:** ___________  
**Time Taken:** ___________  
**Branch:** merge-test/main-into-develop  
**Commit:** 88da4c0
