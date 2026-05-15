# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 2026-05-15

### Changed

**Node Drawer Comprehensive Redesign (LOCAL #33 + #55)**
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
- New test: `frontend/tests/node-drawer-redesign.test.jsx`
- No new CSS required (reused `.workflow-group` and `.option-subgroup` from Run oc-mirror)

**Benefits**
- Improved visual scannability with clear section boundaries
- Easier maintenance (smaller component files vs 1600+ line monolith)
- Consistent with app-wide grouping patterns
- Better user experience: like-configs grouped together regardless of drawer width

### Commits

1. `<pending>` Node drawer comprehensive redesign (LOCAL #33 + #55)

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
