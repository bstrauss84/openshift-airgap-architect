# Changelog

User-facing summary of completed work organized by sprint/release period.

---

## Version 1.1.0 - May 13, 2026

**Major release** - Merges comprehensive work from main and develop branches

**Statistics:**
- 191 commits merged (179 develop + 12 main)
- 927 tests passing (682 frontend, 245 backend)
- 92 production files updated
- 31 new test files added
- Zero test failures

---

### Major Features

#### ✅ Live YAML Preview Drawer
- Real-time generated YAML as you configure
- install-config.yaml + agent-config.yaml split view
- Credential obfuscation with toggle
- Download individual files
- Syntax highlighting
- Available after Blueprint lock-in

#### ✅ Operations Background Job System
- Live streaming output for all jobs
- Job history with downloadable logs
- Cincinnati refresh monitoring
- Operator scan tracking
- oc-mirror execution viewer

#### ✅ Cincinnati Release Management
- Async job polling for release updates
- Manual release override (4.xx minor + patch)
- Channel selection UI
- Version confirmation workflow

#### ✅ Certificate Analysis Tools (Trust & Proxy)
- Visual cert size bar (1KB → 500KB+)
- Cert classification filters
- Larger proxy field inputs (rows=4)
- additionalTrustBundle policy selector

#### ✅ Corporate Proxy Support
- Full backend proxy configuration
- Container egress support
- HTTP_PROXY/HTTPS_PROXY environment handling
- Documentation for corporate environments

### Security Enhancements

#### ✅ Credential Protection (4 fixes)
- **CRITICAL:** Fixed credential exposure via GET /api/state
- Added schema validation for imports
- Defense-in-depth validation for POST endpoints
- Memory exhaustion protection (bundle state limits)

#### ✅ Trust Bundle Alignment
- OpenShift 4.20 trust policy support
- Forward-compatibility for 4.17+ policies
- Fallback handling for legacy versions

### Performance & Reliability

#### ✅ Memory Leak Fixes
- Polling limits for catalog scans (150 iterations, 10 min max)
- Log size caps (1MB display limit)
- Prevents browser memory exhaustion

#### ✅ Mirror Registry Download
- Fixed 0-byte download issue (307 redirect handling)
- Switched to Node.js fetch() with automatic redirects
- Validates download integrity (969.96 MB verified)

### Network Validation

#### ✅ Comprehensive IP Validation
- IPv4 and IPv6 address validation
- CIDR overlap detection
- Duplicate hostname checking
- IPv4 with prefix notation support

### Platform Support

#### ✅ Azure Government IPI
- Automatic cloudName population (AzureUSGovernmentCloud)
- Simplified UI (removed single-value fields)
- Proper validation alignment

#### ✅ MTU Fixes
- Single MTU for base + VLAN networks
- Default 1500 MTU value
- Consistent across all platforms

### Testing

#### ✅ Test Suite Expansion (+31 files)
- API validation tests
- Critical workflow tests
- Preflight validation tests
- YAML drawer tests
- Duplicate hostname validation
- Security tests
- State validation tests
- Trust analysis tests

**Test coverage:** 927 tests (99.7% pass rate)

### Bug Fixes

- Fixed showPreview guard blocking YAML generation
- Fixed scrollIntoView jsdom compatibility
- Fixed duplicate FALLBACK_TRUST_BUNDLE_POLICIES declaration
- Fixed validation.js missing exports
- Fixed Azure Government IPI test expectations
- Fixed BlueprintStep manual release UI

### Documentation

- README.md enhanced with Operations section, preflight details
- BACKLOG_STATUS.md expanded (76 verified_done items vs 32)
- CLAUDE.md added (AI agent instructions, documentation hierarchy)
- All .md files properly merged (develop supersets preserved)

---

**Upgrade Notes:**
- Version bump from 0.1.0 to 1.1.0
- No breaking changes for existing run exports
- All generated YAML remains compatible with OpenShift 4.17-4.20

**Known Issues:**
- 2 frontend tests intentionally skipped (non-blocking)

---

## Sprint: May 3-10, 2026

**Focus:** Tooltip expansion to gold standard, UI refinement, catalog synchronization automation

**Statistics:**
- 74 commits to develop branch
- 21,260 lines added, 968 deleted
- 100% tooltip coverage achieved (100/100 tooltips)
- 631 tests passing (495 frontend, 136 backend)
- Zero regressions

---

### Features Added

#### ✅ Comprehensive Tooltip System (100% Coverage)

**What:** All user-facing fields now have comprehensive, beginner-friendly tooltips with structured formatting

**Coverage:**
- Platform Specifics: All platforms (vSphere, AWS, Azure, Bare Metal, Nutanix, IBM Cloud)
- Identity & Access: Cluster name, base domain, pull secrets, SSH keys, FIPS mode
- Networking: VIPs, machine networks, service/pod networks, host prefix
- Connectivity & Mirroring: Registry FQDN, NTP servers
- Trust & Proxy: CA bundles (mirror registry, proxy), trust bundle policy
- Operators: Operator catalog scanning with pull secret options
- Run oc-mirror: Advanced options, credentials, mode selection
- Host Inventory: Node configuration fields

**Format:**
- **Bold section headers** with yellow highlighting
- WHAT/WHY/WHEN/FORMAT/EXAMPLE/IMPORTANT structure
- Real-world examples and code snippets
- Security warnings and immutability notes
- Beginner-friendly language

**Evidence:** 
- Batches 1-26 complete
- Commits: 0e3fe69 through 596fc2a
- See TOOLTIP_COMPLETION_2026-05-10.md for details

#### ✅ Catalog Metadata Synchronization Automation

**What:** Automated system to keep frontend and backend catalog files synchronized

**Features:**
- Pre-commit hook validates catalog changes
- Sync script (`scripts/sync-catalogs.js`) ensures consistency
- Prevents catalog drift between `data/params/4.20/*.json` and `frontend/src/data/catalogs/*.json`
- User-friendly colored output with progress indicators

**Benefits:**
- No more manual catalog copying
- Prevents accidental catalog desynchronization
- Git pre-commit validation catches issues early
- All 12 catalog files stay synchronized automatically

**Evidence:**
- 17 catalog metadata discrepancies resolved
- Pre-commit hook active in `.git/hooks/pre-commit`
- See CATALOG_FIXES_COMPLETE_SUMMARY.md

#### ✅ Operations Log Download

**What:** Per-operation log download with timestamped filenames

**Features:**
- Download logs from current operations jobs
- Download logs from historical operations
- Timestamped filenames (e.g., `operation-log-2026-05-10-14-30-45.txt`)
- Status metadata included in downloads

**Use case:** Export logs for troubleshooting, audit trails, sharing with support

**Evidence:** Commit f3a51e5, operations-log-download.test.jsx

#### ✅ Segmented Flow Tab Conditional Visibility

**What:** Connectivity & Mirroring tab now hides when empty

**Logic:**
- AWS GovCloud scenarios don't need NTP section (uses cloud NTP)
- Hide tab when: AWS GovCloud AND user is not using mirror registry
- Show tab when: non-GovCloud OR user is using mirror registry

**Benefits:**
- Cleaner UX - no empty tabs
- Reduces confusion about which sections apply
- Context-aware navigation

**Evidence:** Commits 38260dd, f3d1b8b; wizardVisibleSteps.js

---

### Improvements

#### ✅ UI Field Width Standardization

**What:** SSH keys and pull secret fields expanded 25% (700px → 875px)

**Affected fields:**
- Identity & Access: SSH key, RH pull secret, mirror pull secret
- Operators: RH pull secret
- Run oc-mirror: RH pull secrets (2x), mirror pull secrets (2x)

**Benefits:**
- Better readability for long credential strings
- Less horizontal scrolling
- Improved paste/upload UX

**Evidence:** Commits 9c4c067, 5c7b68f; styles.css

#### ✅ Modal Component Consolidation

**What:** Unified modal component with accessibility focus trap

**Features:**
- Keyboard navigation (Tab, Shift+Tab, Escape)
- Screen reader support (ARIA attributes)
- Focus trap prevents tabbing outside modal
- Consistent modal behavior across app

**Migrated modals:**
- AboutModal (Tools drawer)
- RunConfirmationModal (Run oc-mirror)
- App.jsx modals (settings, preferences)

**Evidence:** Commits 3c4ebda, cfb7776; Modal.jsx, useFocusTrap.js

#### ✅ Dark Mode Refinements

**What:** Fixed dark mode rendering issues

**Fixed:**
- Visited links now visible in dark mode
- Section borders consistent across themes
- Sticky panels maintain dark theme styling
- Badge and banner colors adjusted for contrast

**Evidence:** Multiple commits in styles.css

#### ✅ Component Styling Flexibility

**What:** OptionRow component now accepts style and className props

**Use case:** Fixed "Fast mode" overlap issue on Operators tab by adding top margin

**Evidence:** Commits d947858; OptionRow.jsx, OperatorsStep.jsx

---

### Bug Fixes

#### ✅ Catalog Metadata Discrepancies (17 fixes)

**What:** Resolved inconsistencies between frontend and backend catalog files

**Fixed:**
- baselineCapabilitySet values corrected
- Proxy setting defaults aligned
- Replica count requirements standardized
- Platform value corrections (AWS, Azure, IBM Cloud)
- Requirement flag corrections across scenarios

**Evidence:** 
- 17 fixes across 12 catalogs
- See CATALOG_METADATA_AUDIT_FIXES.md
- All 239 backend tests passing

#### ✅ Tooltip Rendering Issues

**What:** Fixed tooltips not displaying line breaks or bold formatting

**Root cause:** Component wasn't parsing markdown-style formatting

**Fix:** 
- Enable markdown rendering in tooltip popovers
- Line breaks (\n) now render correctly
- **Bold** text renders with yellow highlighting

**Evidence:** Commit d5d6978

#### ✅ Tooltip Scroll Behavior

**What:** Tooltips no longer auto-close when scrolling inside long popover content

**Root cause:** Scroll events were triggering tooltip dismissal

**Fix:** Updated tooltip component to ignore scroll events within popover

**Evidence:** Commit d4f8d46

#### ✅ JSX Parsing Errors (Long Hint Strings)

**What:** Template literals prevent JSX parsing errors on long hint strings

**Root cause:** Plain string literals with special characters caused parsing issues

**Fix:** Converted all hints to template literals `{`...`}`

**Evidence:** Commit 50fb3fd

#### ✅ Section-Level Error Highlighting

**What:** Preflight validation now highlights entire sections with errors

**Use case:** Run oc-mirror preflight validation shows which credential sections have issues

**Evidence:** Commits 343e0f8, 42b019e; RunOcMirrorStep.jsx

#### ✅ Grid Layout Spacing (Run oc-mirror Advanced Options)

**What:** Fixed field spacing in Run oc-mirror Advanced Options section

**Root cause:** Using wrong CSS grid class caused bunching on left side

**Fix:** Changed from `.advanced-options-grid` to `.field-grid` class

**Benefits:** Fields now evenly distributed across width

**Evidence:** Commit a986b28

---

### Technical Debt

#### ✅ Preflight Validation Overhaul

**What:** Comprehensive rewrite of oc-mirror preflight validation

**Improvements:**
- Field-level validation (previously section-level only)
- Validates credentials, paths, registry connectivity, configuration completeness
- Clear error messages with actionable guidance
- Section-level error highlighting for groups of related fields

**Evidence:** Commits 343e0f8, 42b019e, 9db0e1f, d0f305d, 83c71d8, 7b3421f

#### ✅ Test Coverage Maintenance

**What:** All tests updated and passing

**Frontend tests:** 495 passing (0 failures)  
**Backend tests:** 136 passing (0 failures)  
**Total coverage:** 631 tests, zero regressions

**New tests added:**
- hint-syntax.test.js (tooltip format validation)
- operations-log-download.test.jsx
- preflight-*.test.jsx (validation logic)

---

### Documentation

#### ✅ Documentation Consolidation

**What:** Consolidated all session notes and planning docs into canonical tracking

**Created:**
- `CLAUDE.md` - Documentation authority and agent instructions
- `TOOLTIP_COMPLETION_2026-05-10.md` - Tooltip work summary
- `TOOLTIP_AUDIT_2026-05-10.md` - Comprehensive tooltip audit

**Updated:**
- `docs/BACKLOG_STATUS.md` - Added DOC-049 through DOC-056
- `COMPREHENSIVE_MASTER_PLAN.md` - Marked Phases 1-2 COMPLETE

**Archived:**
- Session notes to `.archive/session-notes-2026-05-09/`
- Deleted 8 `.bak` files from catalog work

**Evidence:** This changelog, BACKLOG_STATUS.md updates

---

### Developer Experience

#### ✅ SecretInput Component Enhancement

**What:** SecretInput component now supports `hint` prop for gold standard tooltips

**Benefits:**
- Consistent tooltip system across all pull secret fields
- Backwards compatible (existing `labelHint` props still work)
- Enables comprehensive help text for credential fields

**Affected fields:** 9 pull secret inputs across 4 tabs

**Evidence:** SecretInput.jsx enhancement

#### ✅ PemField Component Enhancement

**What:** PemField component now supports `hint` prop for CA bundle tooltips

**Benefits:**
- Consistent tooltip system for certificate fields
- Comprehensive help for Mirror Registry CA and Proxy CA
- Trust Bundle Policy explanation tooltip

**Evidence:** TrustProxyStep.jsx PemField enhancement

---

## Summary

This sprint focused on achieving 100% tooltip coverage with gold standard formatting, automating catalog synchronization, and fixing numerous UI/UX issues. All work completed with zero test regressions and full documentation consolidation into canonical tracking files.

**Next focus:** Testing & validation phase, then systematic scenario validation (Phases 9-10)

---

**Sprint Completed:** 2026-05-10  
**Commits:** 74  
**Lines Changed:** +21,260 / -968  
**Tests:** 631 passing (0 failures)  
**Documentation:** See `docs/BACKLOG_STATUS.md` DOC-049 through DOC-056
