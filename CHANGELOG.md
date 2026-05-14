# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.1]: https://github.com/bstrauss84/openshift-airgap-architect/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/bstrauss84/openshift-airgap-architect/compare/release/1.0...v1.1.0
[1.0.0]: https://github.com/bstrauss84/openshift-airgap-architect/releases/tag/v1.0.0
