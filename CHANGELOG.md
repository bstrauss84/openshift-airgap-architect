# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-05-19

### Added

**Smart Signature Retry for oc-mirror Operator Images (DOC-079)**
- Automatic per-image signature retry when oc-mirror fails on missing signature manifests
- Addresses production issue with certified/community operators (e.g., NetApp Trident)
- Three-tier signature strategy implementation:
  - **Tier 1 (Per-image, automatic):** Smart retry disables signatures only for failing images
  - **Tier 2 (Per-registry, manual):** UI toggles for certified/community registries
  - **Tier 3 (Global, emergency):** `--remove-signatures` flag (all signatures disabled)
- Smart retry workflow:
  - Detects `completed_with_warnings` status + signature failures in job output
  - Parses failing image paths with regex: `/error mirroring image docker:\/\/([^@\s]+)@sha256:[^\s]+.*error: reading signatures.*name unknown: Image not found/g`
  - Generates per-image registries.d configs: `docker: <image-path>: use-sigstore-attachments: false`
  - Auto-retries oc-mirror with same config + per-image signature disable
  - UI displays signature failures + retry status
- **Security benefit:** Example - NetApp Trident 11 images, 1 fails signature → retry disables 1 image only, 10 keep verification (91% security retained)

### Technical Details

**Backend**
- New functions in `backend/src/index.js` (lines 2101-2283, 2481-2494, 2585-2650):
  - `parseSignatureErrors()` - Extract failing image registry paths from logs
  - `writePerImageRegistriesDConfigs()` - Generate per-image registries.d configs
  - `retryWithPerImageSignatureDisable()` - Trigger auto-retry with signature disable
  - Smart retry trigger in job close handler (detects warnings + signature errors)
  - Request body storage for retry capability
- New test suite: `backend/test/signature-smart-retry.test.js` (10 unit tests passing)
  - Tests regex parsing, YAML generation, deduplication, edge cases

**Frontend**
- Modified: `frontend/src/steps/RunOcMirrorStep.jsx` (lines 1684-1707)
  - Signature failure UI (displays failed images, retry status)
- Signature verification toggles (from v1.4.0, lines 118-126, 1200-1257):
  - Per-registry manual toggles for certified/community operators
  - Generates registries.d configs per registry hostname
  - Sets CONTAINERS_REGISTRIES_D env var

**Documentation**
- New: `docs/FIELD_MANUAL_SIGNATURE_VERIFICATION.md`
  - Smart retry explanation and workflow
  - Three-tier strategy comparison
  - Troubleshooting guide
  - Security considerations
  - Version history

**Test Results**
- 10 new unit tests passing (signature parsing, config generation)
- 968 total tests passing (707 frontend + 261 backend)

### References
- Red Hat Solution Article 7139982 (per-image signature disable approach)
- oc-mirror developer guidance
- containers registries.d documentation

---

## [1.4.0] - 2026-05-19

### Added

**Per-Registry Signature Toggles for oc-mirror (DOC-079 Phase 1)**
- Manual signature verification toggles for oc-mirror operator mirroring
- UI toggles for certified/community operator registries
- Addresses signature verification failures for operators with missing signature manifests
- Three-tier signature strategy (Tier 2 implementation):
  - **Tier 2 (Per-registry, manual):** UI toggles generate per-registry registries.d configs
  - Certified operators: `registry.connect.redhat.com` toggle
  - Community operators: `registry.community.openshift.com` toggle
- Backend generates registries.d configs with `use-sigstore-attachments: false` per registry
- Sets CONTAINERS_REGISTRIES_D environment variable for oc-mirror execution
- Automatic cleanup on job completion

### Technical Details

**Backend**
- New functions in `backend/src/index.js` (lines 2016-2099):
  - Per-registry registries.d config generation
  - CONTAINERS_REGISTRIES_D environment variable handling
  - Cleanup on job completion
- Validation schema: `backend/src/schemas.js` (lines 87-119)

**Frontend**
- Modified: `frontend/src/steps/RunOcMirrorStep.jsx` (lines 118-126, 1200-1257)
  - Added signature verification toggles for certified/community registries
  - CollapsibleSection for signature options
  - State tracking for registry-level signature disable

**State Schema Changes**
```javascript
operatorMirrorSettings: {
  disableSignatureCertified: boolean,   // NEW: Disable signatures for certified operators
  disableSignatureCommunity: boolean    // NEW: Disable signatures for community operators
}
```

### Notes
- All signatures verified by default (safe)
- Manual toggles provide per-registry granularity
- Superseded by v1.5.0 automatic per-image retry (recommended approach)

---

## [1.3.0] - 2026-05-18

### Added

**IPv6-Only Single-Stack Support (DOC-074) - BREAKING CHANGE**
- IPv6-only single-stack network configuration support
- Platform support verified:
  - ✅ Bare Metal (Agent/IPI/UPI) - all methods supported
  - ✅ vSphere (Agent/IPI/UPI) - all methods supported
  - ❌ AWS GovCloud - IPv4-only enforced
  - ❌ IBM Cloud IPI - IPv4-only enforced
- IP stack mode selector (dropdown): IPv4 only / IPv6 only / Dual-stack
- Conditional field visibility:
  - IPv6-only mode: hides IPv4 fields (machine/cluster/service networks, VIPs)
  - Dual-stack mode: shows both IPv4 and IPv6 fields with (IPv4)/(IPv6) labels
  - IPv4-only mode: shows only IPv4 fields (legacy behavior)
- Backend generation handles IPv6-only configurations:
  - Single IPv6 network entries in install-config.yaml
  - No IPv4 networks when IPv6-only selected
  - VIP handling: IPv6-only uses apiVipV6/ingressVipV6 only
  - nmstate generation: IPv4 disabled, IPv6 enabled for IPv6-only nodes
  - Platform-specific VIP emission (bare metal, vSphere, Nutanix)
- Mode-specific validation:
  - IPv4-only: requires IPv4 machine network, cluster/service CIDRs, VIPs
  - IPv6-only: requires IPv6 machine network, cluster/service CIDRs, VIPs
  - Dual-stack: requires both IPv4 and IPv6 networks
  - Per-node validation: static mode requires address matching IP stack mode

**State Schema v3 Migration - BREAKING CHANGE**
- Replaced `hostInventory.enableIpv6` boolean with `ipStackMode` enum ('ipv4', 'ipv6', 'dual-stack')
- Automatic migration logic:
  - `enableIpv6=true` → `ipStackMode='dual-stack'`
  - `enableIpv6=false` → `ipStackMode='ipv4'`
- Backward compatibility: auto-detect dual-stack from IPv6 network presence

**Platform Support Matrix Documentation**
- New: `docs/IPV6_PLATFORM_SUPPORT_MATRIX.md`
- Documents IPv6-only support per platform and installation method
- Includes platform-specific limitations and requirements

### Fixed

**Critical: Pull Secret Not Showing in YAML Preview (DOC-075)**
- Fixed pull secret displaying as `{"auths":{}}` in YAML preview drawer
- Root cause: `buildPreviewFiles()` generated preview YAML without forcing `includeCredentials=true`
- Fix: Modified `buildPreviewFiles` to create previewState with `exportOptions.includeCredentials` forced to true
- Impact: Users can now verify pull secrets in preview before export
- File: `backend/src/index.js` (lines 2317-2339)

**VIP Validation UX Improvements (DOC-076)**
- Removed inline VIP error spans (too intrusive), kept hover-only tooltips
- Improved "needs review" badge logic after import:
  - Added `state.ui.isImported` flag when importing runs
  - Cleared `visitedSteps` on import (only track current session)
  - Modified Sidebar badge logic: show "needs review" if (visitedSteps[stepId] OR isImported) AND (reviewFlags OR errorFlags)
  - Enhanced `reconcileReviewFlagsForImportedState` to SET flags for errors AND clear flags for valid steps
- Better distinction between current session and imported state
- Files: `frontend/src/App.jsx`, `frontend/src/components/Sidebar.jsx`, `frontend/src/steps/NetworkingV2Step.jsx`, `frontend/src/validation.js`

**Operator Catalog Version Mismatch After Import (DOC-077)**
- Fixed operator catalog showing wrong version after import (e.g., 4.18 import showed 4.21 operators)
- Root cause: catalogs computed from cached state without version check
- Fix: Added version match check - only use cached catalogs if `state.operators.version === current version`
- Enhanced `removeOperator` to add removed operator to catalogs if missing (ensures unselected operators appear in available list)
- File: `frontend/src/steps/OperatorsStep.jsx` (lines 242-244, 615-667)

**Imageset Config Browse Button (DOC-078)**
- Fixed browse button in Run oc-mirror "Use external file" option (was directory-only, needed file selection)
- Root cause: Browse dialog hardcoded for directory selection - files visible but not clickable
- Fix: Added file mode detection: `isFileMode = browseTarget === "imageset-config"`
  - File mode: files clickable, selected file highlighted, button text "Select"
  - Directory mode: existing behavior unchanged
- Impact: Users can now select imageset config files from browse dialog (previously had to type full paths manually)
- File: `frontend/src/steps/RunOcMirrorStep.jsx` (lines 1718-1750)

### Changed

**Networking UI**
- NetworkingV2Step: IP stack mode selector with conditional field visibility
- Added comprehensive tooltip for Cluster Network IPv6 Host Prefix
- Fixed validation error display: removed className from FieldLabelWithInfo wrappers (prevented double red borders)

**Validation**
- New: `validateIpStackModeRequirements()` function enforces mode-specific network requirements
- Per-node validation: static mode requires address matching IP stack mode

### Technical Details

**Backend**
- Modified: `backend/src/index.js` (schema v3 migration logic)
- Modified: `backend/src/generate.js` (IPv6-only YAML generation)
  - `buildInstallConfig` / `buildAgentConfig` handle IPv6-only mode (single IPv6 entries, no IPv4)
  - `buildClusterNetwork` / `buildServiceNetwork` mode-specific CIDR generation
  - VIP handling per mode (IPv6-only, dual-stack, IPv4-only)
  - nmstate generation: IPv4 disabled, IPv6 enabled for IPv6-only
- Modified: `backend/src/fieldGuide/context.js` (added ipStackMode)
- Modified: `backend/test/fixtures/builders.js`, `backend/test/fixtures/base-states.js` (ipStackMode defaults)
- New test: `backend/test/nic-bond-vlan-ipv6.test.js` (IPv6-only cluster generation test)

**Frontend**
- Modified: `frontend/src/steps/NetworkingV2Step.jsx` (IP stack mode selector, conditional fields)
- Modified: `frontend/src/steps/GlobalStrategyStep.jsx`, `frontend/src/steps/HostInventoryV2Step.jsx`, `frontend/src/steps/HostInventoryStep.jsx`
- Modified: `frontend/src/validation.js` (mode validation)
- Modified: `frontend/src/placeholderValuesHelpers.js`

**State Schema Changes**
```javascript
// BEFORE (schema v2):
hostInventory: {
  enableIpv6: boolean
}

// AFTER (schema v3):
hostInventory: {
  ipStackMode: 'ipv4' | 'ipv6' | 'dual-stack'
}
```

**Test Results**
- All 232 backend tests passing
- Updated test fixtures: withDualStack uses ipStackMode, bond/VLAN node structures fixed
- Added IPv6-only cluster generation test (3-node HA, single IPv6 entries, nmstate IPv4 disabled)

**Migration Notes**
- State schema v3 migration runs automatically on app load
- Old states with `enableIpv6` boolean auto-converted to `ipStackMode` enum
- Dual-stack auto-detected from presence of IPv6 networks in imported states

### Commits
- `70a4433` IPv6-only single-stack support (state schema v3, ipStackMode enum, conditional UI)
- `5db9ba9` Critical bug fixes (pull secret preview, VIP validation UX, operator catalog version mismatch, imageset browse)

### Known Issues
- None

---

## [1.2.2] - 2026-05-17

### Fixed

**VIP Validation Error Display**
- Added visible inline error messages for VIP validation failures
- VIP fields now show validation errors as inline warning spans (not just hover tooltips)
- Pattern matches overlap warnings: `<span className="note warning inline">{fieldErrors.apiVip}</span>`
- Covers all VIP fields across scenarios:
  - bare-metal-agent/ipi: API VIP, Ingress VIP (IPv4 + IPv6 when dual-stack enabled)
  - vsphere-agent/ipi: API VIPs, Ingress VIPs (IPv4 + IPv6 when dual-stack enabled)
  - nutanix-ipi: API VIP, Ingress VIP (IPv4 + IPv6 when dual-stack enabled)
- Added missing error className and title attributes to vSphere IPI VIP inputs

**Node Drawer Tooltips Enhanced to Gold Standard**
- Upgraded 6 tooltips in NodeDrawerAgentContent.jsx to gold standard format:
  - Primary Interface Type
  - IP assignment
  - Ethernet interface
  - Ethernet MAC
  - Bond name
  - Bond mode
- Each tooltip now includes comprehensive sections:
  - **What is this:** Concept explanation
  - **When needed:** Required/optional context
  - **Format:** Expected input format and constraints
  - **How it's used:** Where written in agent-config.yaml, how NetworkManager uses it
  - **Important:** Warnings about failures, misconfiguration consequences
  - **Example:** Real-world concrete examples
- Tooltips now match quality standard of NetworkingV2Step subnet fields
- Fixed syntax errors (backticks inside template literals replaced with single quotes)

### Technical Notes
- VIP validation logic unchanged (from v1.2.1), only error display improved
- Tooltip content focuses on bare metal/Agent-based installer patterns
- All 707 frontend tests passing

## [1.2.1] - 2026-05-17

### Changed

**Node Drawer Comprehensive Redesign (LOCAL #33 + #55 + #56)**
- Extracted Agent/IPI drawer content into separate components
  - New: `frontend/src/components/NodeDrawerAgentContent.jsx` (578 lines)
  - New: `frontend/src/components/NodeDrawerIpiContent.jsx` (215 lines)
  - Reduced `HostInventoryV2Step.jsx` from 1662 to 940 lines (-43% / -722 lines)
- Added visual grouping for like-configurations using Run oc-mirror mirror strategy pattern:
  - Root Device Hints (8 fields) in `.workflow-group`
  - Ethernet/Bond/VLAN configs in `.option-subgroup` (conditional on interface type)
  - Static IP Configuration in `.workflow-group` (conditional on mode=static)
  - DNS Configuration in `.workflow-group`
  - BMC Configuration in `.workflow-group` (conditional)
  - Advanced section in `.workflow-group` (collapsible)
- Reordered sections: **Advanced now appears above Additional Interfaces**
  - Fixes LOCAL #33 JSX parse error blocking section reorder
  - Eliminated problematic nested ternary structure
- Applied consistent visual hierarchy and spacing:
  - Top-level sections use `.workflow-group` (border, header, description)
  - Nested/conditional sections use `.option-subgroup` (left-border accent)
  - Dividers between major sections
- Responsive across drawer width range (400-800px resizable)
- Dark mode support for all new groups (existing CSS)
- Preserves all existing functionality:
  - Validation, handlers, conditional rendering (arbiter, type-based, mode-based)
  - Bond member styling, additional interfaces cards, advanced routes
- **Field alignment fixes (LOCAL #56):**
  - Fixed visual misalignment in Primary Network section
  - Converted fields to use `FieldLabelWithInfo` consistently (Primary Interface Type + IP assignment, Bond name + Bond mode, Ethernet interface + MAC)
  - Added tooltips to previously unlabeled fields (IP assignment, Bond name, Ethernet interface, Ethernet MAC)

**VIP Validation & Dynamic Placeholders (LOCAL #57 + #58)**
- **Added VIP validation for bare-metal-agent** (LOCAL #57):
  - Extended `validateVipsInMachineNetwork` to include bare-metal-agent scenarios
  - API VIP and Ingress VIP must now be within machine network CIDR for all platforms (bare-metal-ipi/agent, vsphere-ipi/agent, nutanix-ipi)
  - Validation error: "API VIPs must be within the machine network (e.g. 10.90.0.0/24)"
- **Dynamic VIP placeholders** (LOCAL #58):
  - VIP input placeholders now dynamically reflect machine network CIDR
  - Example: If machine network is 192.168.1.0/24 → API VIP placeholder shows "e.g. 192.168.1.2", Ingress VIP shows "e.g. 192.168.1.3"
  - Created `getVipPlaceholders(cidr)` helper function (suggests start+2 for API, start+3 for Ingress)
  - Defaults to "e.g. 10.90.0.2" and "e.g. 10.90.0.3" if machine network not configured
  - Updated all VIP fields in NetworkingV2Step (bare-metal, vsphere, nutanix)

### Added

- Comprehensive test suite: `frontend/tests/node-drawer-redesign.test.jsx`
  - Component extraction tests (Agent/IPI content renders without errors)
  - Visual grouping tests (8 logical sections wrapped correctly)
  - Section order tests (Advanced before Additional Interfaces)
  - Conditional rendering tests (arbiter nodes, interface types, IP modes)
  - Responsive behavior tests

### Technical Details

**Frontend**
- New components: `NodeDrawerAgentContent.jsx`, `NodeDrawerIpiContent.jsx`
- Modified: `frontend/src/steps/HostInventoryV2Step.jsx` (refactored to use components)
- Modified: `frontend/src/components/NodeDrawerAgentContent.jsx` (field alignment fixes)
- Modified: `frontend/src/steps/NetworkingV2Step.jsx` (dynamic VIP placeholders, `getVipPlaceholders` helper)
- Modified: `frontend/src/validation.js` (bare-metal-agent VIP validation)
- New test: `frontend/tests/node-drawer-redesign.test.jsx`
- No new CSS required (reused `.workflow-group` and `.option-subgroup` from Run oc-mirror)

**Benefits**
- Improved visual scannability with clear section boundaries
- Easier maintenance (smaller component files vs 1600+ line monolith)
- Consistent with app-wide grouping patterns
- Better user experience: like-configs grouped together regardless of drawer width
- Better VIP validation: catches configuration errors early (VIPs outside machine network)
- Better UX: dynamic placeholders provide contextually relevant examples

**Roadmap Updates**
- Phase 4 (Testing & Validation) deferred to v2.0.0 (post version-aware system)
- Reasoning: ~180 fields × 5 OCP versions = 900+ test cases; better to test after app structure stabilizes with version-aware work
- Current 707 frontend + 261 backend unit tests provide adequate safety net for v1.3.0

### Commits

1. `<pending>` Node drawer comprehensive redesign + VIP validation + alignment fixes (LOCAL #33 + #55 + #56 + #57 + #58)

---

## [1.2.0] - 2026-05-15

### Added

**FIPS Binary Selection (LOCAL #4 - v1.2.0 Phase 3 Complete)**
- Multi-variant `openshift-install` binary support with architecture selection
  - Linux standard, Linux FIPS RHEL 9, macOS (Intel + ARM64)
  - Supports x86_64, arm64, ppc64le, s390x architectures
- FIPS installer toggle in ReviewStep Advanced/Tools section
  - Auto-enables when FIPS mode enabled on Identity & Access tab
  - Auto-disables when FIPS mode disabled (respects user override)
- Platform/architecture dropdown with conditional options:
  - FIPS ON: Linux RHEL 9 FIPS variants only (amd64, arm64, ppc64le, s390x)
  - FIPS OFF: All standard variants (Linux + macOS Intel/ARM64)
- Binary caching by variant key: `export-{version}-{platform}-{arch}-{fips|standard}/`
- Automatic cleanup: Keeps last 2 versions, runs after successful download
- FIPS binaries preserve `-fips` suffix: `openshift-install-fips` vs `openshift-install`
- Comprehensive test suite: 11 tests validating binary URLs (OpenShift 4.21.15)
  - Partial downloads (first 6 MB) to verify accessibility
  - All variants tested: Linux FIPS (4 archs), Linux standard, macOS (2 variants)

**UI Enhancements**
- Option subgroup styling (`.option-subgroup`) for hierarchical/nested options
  - Left border (3px) + indentation (0.5rem) for visual hierarchy
  - Subtle background to group related controls
  - Dark mode support with appropriate color adjustments
  - Applied to FIPS toggle + platform/arch dropdown grouping

**AWS Platform Specifics (Partial - LOCAL #41/42)**
- Service endpoints configuration for custom VPC endpoints
  - Support for airgap/restricted AWS regions (GovCloud, Secret, Top Secret)
  - Name + URL pairs with validation
- Root volume advanced settings:
  - IOPS configuration for provisioned IOPS volumes
  - KMS key ARN for encryption-at-rest
- Enhanced tooltips for AWS-specific fields

### Fixed

**Critical: XDG_RUNTIME_DIR Template Literal Escape**
- Fixed `ReferenceError: XDG_RUNTIME_DIR is not defined` crash in RunOcMirrorStep
- Escaped `${XDG_RUNTIME_DIR}` shell variables in bash code examples
  - Affected lines: 1067, 1139 in `frontend/src/steps/RunOcMirrorStep.jsx`
  - Pattern: Shell variables in JSX template literals must use `\${VAR}` not `${VAR}`
- Added 5 regression tests (`frontend/tests/template-literal-escape-bug.test.jsx`)
  - Tests all steps with code examples
  - Documents correct escape pattern for shell variables in JSX
  - Lists 10 common shell variables that need escaping (XDG_RUNTIME_DIR, HOME, PATH, etc.)

**Critical: FIPS Binary Download (5 iterative fixes)**
1. **Corrected architecture normalization**: `x64 → x86_64` (not `amd64`) for mirror paths
   - Mirror structure: Path uses `x86_64`, filename uses `amd64`
   - URL: `https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/{version}/openshift-install-rhel9-amd64.tar.gz`
2. **Fixed binary naming in archives**: FIPS binaries named `openshift-install-fips`, not `openshift-install`
   - Code now checks for both filenames after extraction
3. **Simplified download/extraction** to match proven `installer.js` pattern
   - Removed complex temp directory logic
   - Extract directly to cacheDir like oc/oc-mirror downloads
4. **Enhanced error diagnostics**:
   - Shows all attempted URLs on failure
   - Includes exact curl command, exit code, stderr output
   - Logs proxy configuration status
   - Provides troubleshooting checklist
5. **Environment variable inheritance**:
   - Subprocess now inherits HTTP_PROXY, HTTPS_PROXY, NO_PROXY
   - Critical for corporate proxy environments

**Lessons Learned (documented in CLAUDE.md handoff)**
- Binary archives can have different filenames than expected (e.g., `openshift-install-fips`)
- Mirror path conventions differ from filename conventions (x86_64 vs amd64)
- Always match proven patterns from working code (installer.js) before innovating
- Iterative debugging with enhanced error messages reveals root causes faster
- Test partial downloads (6 MB) to validate URLs without downloading full binaries

**UPI Prep Guide Links**
- Removed broken UPI prep guide links from scenario summary dropdown
  - Guides exist in `docs/UPI_PREP_GUIDES/` but cannot be served by frontend
  - Would require additional backend routes or external hosting
  - Comment added noting guides accessible in repository
- Prevents 404 errors in documentation dropdown

### Changed

- Merged main hotfix (v1.1.4) into develop to sync branches (commit daf2fef)
  - Resolves "1 commit behind main" status on GitHub
  - Preserves all develop features while incorporating hotfix
- Simplified binary download logic to match `installer.js` pattern (proven working)
- Enhanced error messages with comprehensive troubleshooting information

### Technical Details

**Backend**
- New module: `backend/src/openshiftInstaller.js` (266 lines)
  - Multi-variant installer binary management
  - Architecture normalization and URL building
  - Download with fallback, caching, cleanup
- New test suite: `backend/test/openshiftInstaller.test.js` (11 tests, ~4.4s)
  - Tests all binary variants for OpenShift 4.21.15
  - Partial downloads (first 6 MB) verify accessibility
- Enhanced: `backend/src/index.js` runtime-info endpoint
  - Added `detectedPlatform` and `detectedInstallerVariant`
- Backend tests: **261 passing** (11 new for installer)

**Frontend**
- Modified: `frontend/src/steps/ReviewStep.jsx` (lines 559-630)
  - FIPS toggle with auto-sync useEffect
  - Platform/architecture dropdown with conditional options
  - Option subgroup wrapper for visual grouping
- Modified: `frontend/src/steps/RunOcMirrorStep.jsx`
  - XDG_RUNTIME_DIR escaping (lines 1067, 1139)
- Modified: `frontend/src/styles.css`
  - Added `.option-subgroup` class (lines 5983-5996)
- New test: `frontend/tests/template-literal-escape-bug.test.jsx` (5 tests)
- Frontend tests: **697 passing** (5 new for template literal regression)

**State Schema Changes**
```javascript
exportOptions: {
  includeInstaller: boolean,
  installerUseFips: boolean,      // NEW: Use FIPS RHEL 9 variant
  installerPlatformArch: string   // NEW: "linux-amd64", "mac-arm64", "" = default
}
```

### Commits (in order)

1. `c024d58` Add FIPS binary selection + fix XDG_RUNTIME_DIR bug + UI grouping
2. `596afb9` AWS Platform Specifics + UPI prep guide cleanup + doc updates
3. `daf2fef` Merge main hotfix into develop to sync branches
4. `5eb47f1` CRITICAL FIX: Correct openshift-install binary download URLs
5. `f7af71f` Enhance openshift-install download error diagnostics
6. `14a1b9c` Simplify binary download/extraction to match working installer.js pattern
7. `1ddbb41` FIX: FIPS binary named 'openshift-install-fips' in archive
8. `f4f640d` Preserve FIPS binary name (openshift-install-fips) in cache and export

### Known Issues

None

### Migration Notes

- FIPS binaries now exported as `tools/openshift-install-fips` (not `tools/openshift-install`)
- Standard binaries exported as `tools/openshift-install`
- Cache directory structure: `export-{version}-{platform}-{arch}-{fips|standard}/`
- Old cached binaries auto-cleaned (keeps last 2 versions only)

### Documentation Updates

- Updated `docs/IMPLEMENTATION_ROADMAP_2026-05-14.md`: Marked LOCAL #4 complete
- Updated `docs/BACKLOG_STATUS.md`: DOC-LOCAL-004 marked verified_done
- Updated `docs/CLAUDE.md`: Added FIPS binary implementation lessons learned
- Updated `LOCAL_BACKLOG.md`: Marked #4 complete with implementation details

---

## [1.1.4] - 2026-05-15

### Fixed

**Critical: XDG_RUNTIME_DIR Template Literal Escape (Hotfix to main)**
- Fixed `ReferenceError: XDG_RUNTIME_DIR is not defined` crash in RunOcMirrorStep
- Escaped `${XDG_RUNTIME_DIR}` shell variables in bash code examples
  - Affected lines: 1067, 1139 in `frontend/src/steps/RunOcMirrorStep.jsx`
  - Changed `${XDG_RUNTIME_DIR}` to `\${XDG_RUNTIME_DIR}` in template literals
- Pattern: Shell variables in JSX template literals must use `\${VAR}` to prevent JavaScript interpolation
- Added 5 regression tests to prevent similar bugs (`frontend/tests/template-literal-escape-bug.test.jsx`)
  - Tests all steps with code examples (identity-access, connectivity-mirroring, trust-proxy, run-oc-mirror)
  - Documents correct escape pattern
  - Lists common shell variables that need escaping

### Technical Details

- Frontend tests: **696 passing** (5 new regression tests)
- Hotfix applied to **main branch** only (merged into develop as part of v1.2.0)

### Commits

- `6b9d4fc` CRITICAL FIX: Escape ${XDG_RUNTIME_DIR} template literal in bash examples

---

## [1.1.3] - 2026-05-14

### Fixed

- **Critical runtime error in ReviewStep.jsx** - Removed remaining `includeCredentials` variable reference
  - Error: `ReferenceError: includeCredentials is not defined` (line 372)
  - Replaced with `inclusion.pullSecret` in installConfigDisplay logic
  - Missed during v1.1.2 refactor from legacy checkboxes to granular controls
  - Tests: 682/682 frontend passing

## [1.1.2] - 2026-05-14

### Added

- **Granular export inclusion controls** (ReviewStep.jsx UI integration - highside phase 2)
  - Per-class credential inclusion controls replacing legacy includeCredentials checkbox:
    - Pull secret (install-config pullSecret)
    - Platform credentials (vSphere/Nutanix)
    - Mirror registry credentials
    - BMC credentials (for bare metal hosts)
    - Trust bundles and certificate material
    - SSH public key
    - Proxy values
  - Runtime package export option (includeHighSideRuntimePackage) - Bundle OCI-archive container images and docker-compose for disconnected deployment
  - Collapsible "Per-class inclusion controls" section for better UX organization
  - Integration with canonicalizeExportOptions and resolveSecretInclusion from v1.1.1 core modules

### Changed

- **Export Options UI redesign** - Replaced simple "Include credentials in export" and "Include certificates in export" toggles with granular per-class controls
- **State management** - Updated refresh() dependencies to track individual inclusion flags (pullSecret, mirrorRegistryCredentials, platformCredentials, bmcCredentials)
- **Pull secret preview logic** - Now checks inclusion.pullSecret instead of legacy includeCredentials flag

### Removed

- Legacy includeCredentials and includeCertificates checkboxes (replaced by granular controls)
- handleCredentialsToggle function (no longer needed with per-class UI)

### Notes

- Completes v1.1.1 phased highside integration (phase 2: UI layer)
- All v1.1.0 features preserved (YAML drawer, tooltips, scenario summary)
- Test suite: 927/927 passing (682 frontend, 245 backend)

## [1.1.1] - 2026-05-14

### Added

- **Highside infrastructure foundation** - Core backend/frontend modules for future airgap deployment workflows
  - Runtime package export system (backend/src/runtimePackage.js) - OCI-archive container image bundling for disconnected environments
  - Export inclusion framework (backend/src/exportInclusion.js, frontend/src/exportInclusion.js) - Granular credential and certificate inclusion controls
  - Placeholder engine (backend/src/placeholderEngine.js, frontend/src/placeholderEngine.js) - Safe deterministic placeholders for environment-specific fields
  - Integrated from feat/highside-lowside-packaging-foundation branch via selective cherry-pick

### Changed

- **Versioned implementation roadmap** - Created IMPLEMENTATION_ROADMAP_2026-05-14.md
  - Organizes backlog by semantic versioning (1.1.x patch, 1.x.0 minor, x.0.0 major)
  - Adds missing backlog items from BACKLOG_STATUS.md (PHX-* items)
  - Includes upgrade/mirror-only landing page flows (PHX-029) in v3.0.0 exploratory phase
  - Replaces REVISED_PHASED_PLAN_2026-05-10.md as active roadmap

- **Backlog status updates**
  - PROD-001 marked verified_done (all 927 tests passing)
  - DOC-063 marked verified_done (operator quick picks complete: Platform Plus, App Dev Suite, Quay, ODF)

### Notes

- v1.1.1 uses phased integration approach: core infrastructure only, UI integration deferred to v1.1.2
- All v1.1.0 features preserved (YAML drawer, tooltips, scenario summary, Cincinnati, proxy support)
- Test suite: 927/927 passing (682 frontend, 245 backend)

## [1.1.0] - 2026-05-14

### Added

- **Live-updating YAML drawer** (DOC-034) - Real-time YAML preview with security-first design
  - Install-config and agent-config split view with syntax highlighting (Prism.js)
  - Credential obfuscation by default (pullSecret, sshKey, passwords, tokens, proxy credentials)
  - "Show sensitive values" toggle for controlled visibility
  - Vertical drag-resize (350-800px width) and horizontal drag-resize for agent split view
  - Download buttons per YAML file with warnings for incomplete configurations
  - 100ms debounce for optimal performance
  - Mobile responsive design (tablet 90vw, mobile 100vw)
  - Tab visibility: all tabs except Landing, Blueprint, Assets & Guide, Operations
  - ImageSet preview on Operators/Run oc-mirror with source switching

- **Comprehensive tooltip expansion** (DOC-049) - 100% field coverage with gold standard formatting
  - 87/87 FieldLabelWithInfo tooltips enhanced with beginner-friendly explanations
  - **Bold** section headers with structured WHAT/WHY/WHEN/FORMAT/EXAMPLE/IMPORTANT sections
  - Real-world examples and security warnings where applicable
  - Covers all steps: Platform Specifics, Identity & Access, Networking, Connectivity, Trust, Operators, Run oc-mirror, Host Inventory

- **Live-updating scenario summary panel** (DOC-058) - Collapsible configuration overview
  - Dynamic configuration sections (Identity, Networking, Connectivity, Trust, Platform, Hosts, Operators)
  - Shows only confirmed tabs with real-time updates as user progresses
  - Dynamic documentation sources matching Field Guide logic
  - Resizable panel with drag handle (150-800px height)
  - Professional styling with bold uppercase labels, blue category headers, bullet points
  - Added replica count fields to vSphere IPI, Azure Gov IPI, IBM Cloud IPI

- **VERSION file** - Single source of truth for version tracking at repository root
- **CHANGELOG.md** - Release notes following Keep a Changelog format
- **release/1.0** branch - Preserves v1.0.0 baseline from main branch

### Fixed

- **Blueprint ↔ Operations navigation** (DOC-070) - Critical pre-lock navigation regression
  - Users can now navigate between Blueprint and Operations tabs before locking in foundational selections
  - Required for debugging Cincinnati "Update" button failures (proxy issues, network errors)
  - Operations logs accessible pre-lock for Cincinnati refresh troubleshooting
  - 7 passing tests confirm Cincinnati refresh logging integration

- **YAML drawer performance** - Reduced debounce from 500ms to 100ms for snappier real-time updates
- **YAML drawer visibility** - Fixed tab visibility on Run oc-mirror step
- **Import regression** - Removed guard blocking YAML generation on import

### Changed

- **Documentation organization** - Root directory minimized from 17 to 6 markdown files
  - Moved planning docs to `docs/` (COMPREHENSIVE_MASTER_PLAN, CATALOG_SYNC_GUIDE, SETUP_COMPLETE, TOOLTIP_EXPANSION_MASTER_PLAN)
  - Archived completed work summaries to `.archive/` (tooltip-work, scenario-summary, test-failures, yaml-drawer)
  - Updated all cross-references in CLAUDE.md and BACKLOG_STATUS.md

### Security

- **Git history cleanup** - Removed sensitive chat history file (`claude_chat_history.txt`) from all commits
  - Added to `.gitignore` to prevent future tracking
  - Complete purge from 395 commits using git-filter-repo

- **YAML drawer credential obfuscation** - All sensitive fields masked by default with opt-in visibility toggle

## [1.0.0] - 2026-05-14

### Added

- Initial stable release with core airgap installation wizard functionality
- Blueprint configuration wizard for OpenShift 4.17-4.20 disconnected installations
- Platform support: vSphere (IPI/UPI), Bare Metal (UPI), AWS, Azure, GCP, Nutanix
- Networking configuration: IPv4, IPv6, dual-stack with validation
- Cincinnati integration for release channel and patch version selection
- Operator catalog discovery and selection
- Host inventory management for bare metal deployments
- Trust bundle and proxy configuration
- Import/export configuration state
- Docker and Podman container support
- Comprehensive test suite (927 tests: 682 frontend, 245 backend)

[1.1.3]: https://github.com/bstrauss84/openshift-airgap-architect/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/bstrauss84/openshift-airgap-architect/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/bstrauss84/openshift-airgap-architect/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/bstrauss84/openshift-airgap-architect/compare/release/1.0...v1.1.0
[1.0.0]: https://github.com/bstrauss84/openshift-airgap-architect/releases/tag/v1.0.0
