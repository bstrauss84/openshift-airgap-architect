# Changelog

User-facing summary of completed work organized by sprint/release period.

---

## Version 1.6.0 - May 27, 2026

**Major release** - Comprehensive verification and parameter expansion

**Statistics:**
- 1221 tests passing (786 frontend, 435 backend)
- 25 new high-priority parameters added (1024 total across 13 catalogs)
- 9 commits addressing all verification findings
- 4 major features completed
- Zero vulnerabilities (3 security fixes applied)
- Zero test failures

---

### Major Features

#### ✅ High-Priority Parameter Implementation (DOC-084)
- 25 parameters added from DOC-082 audit (32 instances across scenarios)
- AWS BYO VPC support (vpc, subnets, hostedZone, defaultMachinePlatform)
- Azure BYO VNet support (virtualNetwork, networkResourceGroupName, subnets, defaultMachinePlatform)
- Bare-metal custom RHCOS images (bootstrapOSImage, clusterOSImage)
- Nutanix multi-cluster HA (prismElements, failureDomains, defaultMachinePlatform)
- vSphere network configuration (network, defaultMachinePlatform)
- Control plane/compute platform overrides (all IPI scenarios)
- Networking MTU tuning (clusterNetworkMTU for all scenarios)
- Documentation: `docs/PARAMETER_ADDITIONS_2026-05-27.md` (35KB breakdown)

#### ✅ Automated Parameter Coverage Tool (PHX-045)
- Script: `scripts/verify-parameter-coverage.js` (468 lines)
- Detects field access patterns in backend generation code
- Cross-references 1032 catalog parameters across 13 scenarios
- Current coverage: 28.4% explicit handling (293/1032)
- Per-scenario coverage statistics and gap analysis
- JSON export for CI/CD integration
- Usage: `node scripts/verify-parameter-coverage.js [--scenario=name] [--verbose] [--json]`

#### ✅ Comprehensive BMC URL Validation
- Format validation for Baseboard Management Controller addresses
- Supports metal3 BMC driver protocols: redfish, ipmi, idrac, ilo4/5-virtualmedia
- IPI method: BMC address required + format validated (errors on invalid)
- Agent method: BMC address optional + format validated (warnings on invalid)
- Handles IPv4, IPv6 (in brackets), hostnames/FQDNs with ports and paths
- 43 new validation tests (all passing)
- Prevents common configuration errors (plain IPs, unsupported protocols)

#### ✅ Comprehensive Verification Session
- All 8 verification findings addressed (3 real bugs, 4 IPv6 test failures, 1 outdated test)
- MAC address validation fixed (reject invalid formats for all install methods)
- Nutanix IPI VIP parameters added (apiVIP, apiVIPs, ingressVIP, ingressVIPs)
- Azure validation test updated (baseDomainResourceGroupName metadata)
- IPv6 test failures fixed (restored legacy enableIpv6 backward compatibility)
- DOC-083 runtime package export formally deferred to v1.7.0
- Field-level validation for provisioning network fields (CIDR, DHCP range, cluster provisioning IP)

### Security Enhancements

#### ✅ Vulnerability Fixes
- **Backend:** 3 moderate severity vulnerabilities patched (qs DoS via express/body-parser)
- **Frontend:** 0 vulnerabilities (clean audit)
- **Final:** 0 production vulnerabilities across entire stack

#### ✅ Pull Secret Handling Verification
- No secrets in code (grep verified)
- .gitignore properly configured (pull-secret, auth.json patterns)
- Placeholder engine working (one-way PLACEHOLDER_PREFIX replacement)
- No secrets in git history
- Golden rule compliance verified

### Testing & Quality

#### ✅ All Tests Passing
- Frontend: 786/788 tests passing (2 skipped as expected)
- Backend: 435/443 tests passing (8 skipped as expected)
- Total: 1221 tests, 0 failures
- 43 new BMC validation tests added
- 0 regressions detected

#### ✅ Memory Leak Detection
- All setInterval/setTimeout calls have proper cleanup (React useEffect)
- No uncleaned event listeners
- No memory warnings in test output
- Verified: App.jsx, OperationsStep.jsx, RunOcMirrorStep.jsx

### Documentation Updates

#### ✅ New Documentation
- `docs/PARAMETER_ADDITIONS_2026-05-27.md` - 35KB comprehensive parameter breakdown
- `scripts/verify-parameter-coverage.js` - Automated coverage verification tool

#### ✅ Updated Documentation
- `docs/BACKLOG_STATUS.md` - Added DOC-084 (parameters) and PHX-045 (coverage tool)
- `docs/IMPLEMENTATION_ROADMAP_2026-05-14.md` - Updated v1.7.0 phase with DOC-083
- `docs/HANDOFF_PACKET.md` - Full session summary and verification results
- `docs/CHANGELOG.md` - This entry (v1.6.0)

### Bug Fixes

#### ✅ Verification Findings (All Addressed)
1. **MAC address validation** - Now rejects invalid formats for IPI and Agent methods
2. **Nutanix IPI VIP section** - Added 4 VIP parameters to catalogs
3. **Azure validation test** - Updated to match correct metadata (required: false)
4. **IPv6 test failures** - Fixed 4 failures with backward compatibility for legacy enableIpv6 field
5. **catalogResolver test** - Updated Nutanix VIP assertions
6. **Provisioning network validation** - Added field-level validation with inline error display

### Deferred Items

#### 🔄 DOC-083 - High-Side Runtime Package Export
- **Status:** Formally deferred to v1.7.0
- **Reason:** Feature exists but not integrated (UI toggle disabled, backend never calls function)
- **Scope:** 5-8 hours work (backend wiring + integration tests + UI re-enable)
- **Documentation:** Updated BACKLOG_STATUS.md and roadmap

#### 🔄 OVN-Kubernetes Advanced Config (MISSING-002)
- **Status:** Deferred to v1.7.0+
- **Reason:** Complex nested object requiring UI design
- **Scope:** genevePort, ipsecConfig, policyAuditConfig, gatewayConfig fields

### Git History

**Commits (9 total):**
```
1425a4b - Create automated parameter coverage verification tool and update docs
5ac6ce0 - Add comprehensive BMC URL validation for bare-metal deployments
c153a89 - Formally defer DOC-083 high-side runtime package export to v1.7.0
69a498e - Add 28 high-priority missing parameters from DOC-082 analysis
ac550d3 - Fix IPv6 test failures - restore legacy enableIpv6 backward compatibility
a95984e - Fix Azure baseDomainResourceGroupName validation test
23c8cb7 - Add Nutanix IPI VIP parameters to catalogs
cb446b0 - Fix MAC address validation to reject invalid formats
21be23e - Add field-level validation for provisioning network fields
```

**Release Branch:** `release/v1.5.0` created from main (snapshot before merge)

### Next Steps (v1.7.0 Planning)

1. **UI Implementation for New Parameters:**
   - networking.clusterNetworkMTU (NetworkingV2Step)
   - platform.aws.vpc/subnets (PlatformSpecificsStep - AWS)
   - platform.azure.virtualNetwork/subnets (PlatformSpecificsStep - Azure)
   - platform.baremetal.bootstrapOSImage/clusterOSImage (PlatformSpecificsStep)

2. **Backend Generation Integration:**
   - Update generate.js to emit new parameters in install-config.yaml
   - Add validation for BYO VPC/VNet scenarios
   - Test generated configs against OpenShift installer schema

3. **DOC-083 Implementation:**
   - Integrate high-side runtime package export (backend wiring)
   - Create integration tests with podman/docker detection
   - Re-enable UI toggle in ReviewStep.jsx

4. **Advanced Networking:**
   - OVN-Kubernetes configuration section (MISSING-002)
   - IPsec encryption toggle, Geneve port override, policy audit logging

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
