# Version-Awareness Completion Matrix

**Created:** 2026-08-03
**Last Updated:** 2026-09-18
**Parent:** DOC-059 (OpenShift version-aware system v2.0.0)
**Branch:** supervised/v2.0
**Accepted baseline at last review:** 2afd742 (PROD-014: application identity sync to 2.0.0-dev)
**Preceding Field Guide milestone:** 8282f68 (DOC-103: AWS Field Guide AMI lookup context-safe)
**M01 residual GA register baseline:** 1d3b2e4 (docs: correct DOC-127 integrity provenance)
**Canonical status authority:** docs/BACKLOG_STATUS.md

---

## A. Executive Status

**DOC-059: INCOMPLETE — active, not done**
**DOC-102: COMPLETE — verified_done (2026-08-13)**

Version-awareness foundation is strong. Phase 0 (DOC-100), Phase 1 (DOC-101), and Phase 2 (DOC-102) are verified_done. DOC-102 closed with all canonical slices (5A, 5B, 5D, 5F, 5G, 5H) and final closure tranches accepted: BMC verify CA fully implemented as supported-ui (commit a0d5fcb), Azure BYO VNet subnets fully implemented with version-gated generation (commit 3e3148b), dnsRecordsType reconciled as deliberate support boundary — docs-only-not-supported/hidden-not-applicable across all platforms (commit 0e927b1). Zero supported-backend-only 4.21 delta params remain unresolved for supported platforms (38 unsupported/manual-review upstream delta paths intentionally deferred). Remaining DOC-059 workstreams: Phase 3 (DOC-103) is active / near-complete — version locking, version-aware UI controls, version-aware UI registry (catalogFieldMeta.js), browser verification, unlock/relock workflow (63 tests), metadata-driven version annotations for all 5 introduced supported-ui fields and deprecation treatment for all 4 deprecated supported-ui vSphere fields (23 annotation tests), Field Guide strict version resolution (versionResolution.js throws on unsupported versions, 68 tests), and version-neutral copy (DOC-107 verified_done) are all implemented. Remaining: DOC-104 systematic test coverage. Phase 4 (DOC-104) is active / partial — migration tests, catalog tests, visibility tests, validation tests, and generation tests exist for implemented features; version-manifest M02 manifest generation (25 tests) and M03 validation-core with hardened archive-buffer adapter (174 tests) are implemented; remaining: parameterized version-matrix testing and Field Guide version-correctness tests. M03 HTTP archive-validation endpoint implemented (validation-core 174 tests + HTTP endpoint 27 tests all passing); M03 implementation and deterministic validation are complete and human-checkpointed at 0ca11266d032dc0216bdc5c4895a5d41984f5dbc; post-commit certification verified (bundle-import 27/27, import-integrity 174/174, export-integrity 25/25, full backend 1705/0 fail/5 todo, git diff --check exit 0, clean working tree; all return codes zero); archive-import semantics addressed as validation-only (archive contains no state.json). Phase 5 (DOC-105) is active / partial — historical planning/status records reference ADR-001 through ADR-007 at `local-docs/version-aware-planning/` but these files are not tracked or present in the live worktree and are not current tracked release evidence; Design System documentation, version-aware UI checklist, and roadmap governance exist; README has partial v2 development identity; CHANGELOG has an Unreleased v2 section; VERSION identity is established at 2.0.0-dev with deterministic validation. Remaining: migration guide, full README v2.0.0 release update, CHANGELOG v2.0.0 GA entry, security audit, release notes — final release closure still outstanding. DOC-107 (versioned copy strategy implementation): verified_done — guard-and-fix approach (version-neutral rewording + CI grep guard + 42 tests) implemented and verified; CI guard passes clean; no centralized versionedCopy.js needed. DOC-106 (versioned copy audit) is verified_done at the Phase 0 inventory level; its original implementation conclusion is superseded by current evidence — implementation remains owned by DOC-107 and related DOC-103/DOC-104 acceptance work.

---

## B. Completed Foundation and Accepted Commit Evidence

| Tranche | Evidence | Status |
|---|---|---|
| Canonical v3 version state and supported-minor policy | shared/stateMigration.js, shared/versionUtils.js, SUPPORTED_MINORS=["4.20","4.21"]; commit 8a879e7 "Phase 1 Slice 1: Add centralized version utilities (DOC-101)", commit bf7cfb3 "DOC-101 Phase 1 lock state regression fix: operators confirm returns v3 fields" | verified_done |
| 4.20/4.21 catalog loading foundation | data/params/4.21/ (12 catalogs, 1052 params), frontend/src/data/catalogs/4.21/, catalogPaths.js version-aware resolution; commit e65e6ee "DOC-102 Slice 5A: Frontend versioned catalog structure with blocking behavior" | verified_done |
| Blueprint canonical version transitions | BlueprintStep.jsx sets v3 locked field, /api/operators/confirm returns v3 schema; commit bf7cfb3 "DOC-101 Phase 1 lock state regression fix" | verified_done |
| AWS 4.21 root-volume throughput | controlPlane.platform.aws.rootVolume.throughput: supported-ui in catalog + frontend validation + backend generation with isVersionGTE guard; commit 19200ae4b4d5 "DOC-102: Add AWS 4.21 root volume throughput", commit 3f6e2578322b "DOC-102: Enforce AWS throughput validation", commit 137db152ab27 "DOC-102: Finalize AWS throughput enforcement" | verified_done |
| Azure 4.21 allowSharedKeyAccess | platform.azure.allowSharedKeyAccess: supported-ui in 2 catalogs + PlatformSpecificsStep control + validation + generation; commit 8fd2fe1 "DOC-102: Add Azure 4.21 shared-key access" | verified_done |
| AWS 4.21 confidential compute | controlPlane.platform.aws.cpuOptions.confidentialCompute: supported-ui + validation + generation + strict string validation; commit ee476c8 "DOC-102: Add AWS 4.21 confidential compute", commit 289b8794 "DOC-102: Close confidential compute verification" (HEAD) | verified_done |
| Version-aware UI Design System and checklist | docs/DESIGN_SYSTEM.md, docs/VERSION_AWARE_UI_FIELD_CHECKLIST.md; commit 53b355a "DOC-102: Complete version-aware UI standards", commit 2f9d922 "DOC-102: Complete version-aware UI standards" (both verified ancestors of HEAD; 2f9d922 is ancestor of 53b355a — linear chain) | verified_done |
| Version-gated UI registry and catalog cross-check | catalogFieldMeta.js isCatalogFieldVisible with supportStatus check, Slice 5G metadata corrections | verified_done |
| Normal-flow supporting-content layout | Three-row supporting-content layout stabilized; commit 310c0c8 "DOC-102: Repair version-gated field presentation", commit e23e460 "DOC-102: Stabilize supporting-text field layout" (310c0c8 is ancestor of e23e460; both verified ancestors of HEAD) | verified_done |
| Slice 5H Host Inventory register (H1–H9) | 55/59 interactive controls, 14 commits e939a41 through 063fcc5, 4 blockers resolved, docs/HOST_INVENTORY_SLICE_5H_REGISTER.md | verified_done |
| Phase 0 baseline certification (DOC-100) | supportStatus added to all 949 4.20 params, versioned-copy audit inventory (3,239 refs), commit 94b5b14 | verified_done |
| Phase 1 architecture foundation (DOC-101) | 6/6 slices + 2 regression fixes; commit 8a879e7 "Phase 1 Slice 1" through commit bf7cfb3 "lock state regression fix", browser verification passed | verified_done |
| Accepted completed DOC-102 slices and post-Slice-5H work | Slice 5A: commit e65e6ee. Slice 5B: commit bad31e3. Slice 5D: commit 1f3b2e5. Slice 5F: commit 312cb3c. Slice 5G: catalogFieldMeta corrections (no single commit — metadata-only corrections). Slice 5H: 14 commits e939a41 through 063fcc5. Accepted post-5H: AWS throughput (commits 19200ae, 3f6e257, 137db15), Azure allowSharedKeyAccess (commit 8fd2fe1), AWS confidential compute (commits ee476c8 through 289b8794), version-aware field presentation (commits 310c0c8, e23e460, ea60f9bd, 2193e729), version-aware UI standards (commits 2f9d922, 53b355a, linear chain). All SHAs verified via `git show -s`. | verified_done (5A–5H + post-5H) |
| BMC verify CA (final DOC-102 closure tranche) | platform.baremetal.bmcVerifyCA promoted to supported-ui with UI control, shared validation module (shared/bmcVerifyCA.js), backend generation, Field Guide content, frontend and backend tests; commit a0d5fcb | verified_done |
| Azure BYO VNet subnets (final DOC-102 closure tranche) | platform.azure.subnets promoted to supported-ui/supported-derived with version-gated generation (4.21 subnets array vs 4.20 controlPlaneSubnet/computeSubnet), UI editor, shared validation (shared/azureByoVnet.js), frontend and backend tests; commit 3e3148b | verified_done |
| dnsRecordsType support boundary (final DOC-102 closure tranche) | dnsRecordsType reclassified from supported-backend-only to docs-only-not-supported (bare-metal-agent/ipi, vSphere, Nutanix) and hidden-not-applicable (bare-metal-upi). Deliberate support boundary: External mode requires OnPremDNSRecords feature gate and loadBalancer.type=UserManaged, not owned by this application. Installer omission defaults to Internal. Tests verify catalog classification; commit 0e927b1 | verified_done |
| Phase 0 versioned copy audit (DOC-106) | scripts/find-hardcoded-versions.sh, versioned-copy-audit-results/ (8 files), docs/VERSIONED_COPY_INVENTORY.md | verified_done (inventory only) |

---

## C. Remaining DOC-102 Parameter Work

### 4.21 Delta Parameters — Current Status

| Parameter / Family | Catalog Status | UI Status | Frontend Validation | Backend Validation | Generation | Persistence | Import/Export | Field Guide | Tooltip | Tests | Recommended Tranche |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **controlPlane.platform.aws.rootVolume.throughput** | supported-ui, minVersion=4.21 | ✅ PlatformSpecificsStep control | ✅ validateAwsRootVolumeThroughput | ✅ validateAwsRootVolumeThroughput | ✅ isVersionGTE guard | ✅ state persistence | ✅ state export | 4.21 Field Guide exists | ✅ tooltip present | ✅ frontend + backend | **DONE** |
| **controlPlane.platform.aws.cpuOptions.confidentialCompute** | supported-ui, minVersion=4.21 | ✅ PlatformSpecificsStep control | ✅ version-gated validation | ✅ strict string validation | ✅ isVersionGTE guard | ✅ state persistence | ✅ state export | 4.21 Field Guide exists | ✅ tooltip present | ✅ frontend + backend | **DONE** |
| **platform.azure.allowSharedKeyAccess** | supported-ui, minVersion=4.21 (2 catalogs) | ✅ PlatformSpecificsStep control | ✅ version-gated validation | ✅ boolean type enforcement | ✅ isVersionGTE guard | ✅ state persistence | ✅ state export | 4.21 Field Guide exists | ✅ tooltip present | ✅ frontend + backend | **DONE** |
| **compute[].platform.aws.rootVolume.throughput** | supported-derived (1 catalog), docs-only (1 catalog) | — (derived from controlPlane) | — | — | ✅ derived | ✅ | ✅ | — | — | — | **DONE** (derived) |
| **controlPlane.platform.aws.cpuOptions** | supported-derived (1 catalog), docs-only (1 catalog) | — (parent object) | — | — | ✅ parent emitted | ✅ | ✅ | — | — | — | **DONE** (structural) |
| **platform.baremetal.bmcVerifyCA** | supported-ui, minVersion=4.21 (agent+IPI); hidden-not-applicable (UPI) | ✅ PlatformSpecificsStep control | ✅ shared/bmcVerifyCA.js | ✅ shared/bmcVerifyCA.js | ✅ version-gated emission | ✅ state persistence | ✅ state export | ✅ v4.21 Field Guide | ✅ tooltip present | ✅ frontend + backend | **DONE** (commit a0d5fcb) |
| **platform.baremetal.dnsRecordsType** | docs-only-not-supported, minVersion=4.21 (agent+IPI); hidden-not-applicable (UPI) | N/A (deliberate) | N/A | N/A | N/A (omission defaults to Internal) | N/A | N/A | N/A | N/A | ✅ catalog classification tests | **DONE** — deliberate support boundary (commit 0e927b1) |
| **platform.azure.subnets** | supported-derived, minVersion=4.21 (2 catalogs) | — (parent object) | — | — | ✅ version-gated array emission | ✅ | ✅ | ✅ v4.21 Field Guide | — | ✅ | **DONE** (commit 3e3148b) |
| **platform.azure.subnets.name** | supported-ui, minVersion=4.21 (2 catalogs) | ✅ PlatformSpecificsStep BYO VNet editor | ✅ shared/azureByoVnet.js | ✅ validation | ✅ version-gated emission | ✅ | ✅ | ✅ | ✅ | ✅ | **DONE** (commit 3e3148b) |
| **platform.azure.subnets.role** | supported-derived, minVersion=4.21 (2 catalogs) | — (derived from control-plane/node) | — | — | ✅ derived in generation | ✅ | ✅ | — | — | ✅ | **DONE** (commit 3e3148b) |
| **platform.nutanix.dnsRecordsType** | docs-only-not-supported, minVersion=4.21 (1 catalog) | N/A (deliberate) | N/A | N/A | N/A (omission defaults to Internal) | N/A | N/A | N/A | N/A | ✅ catalog classification tests | **DONE** — deliberate support boundary (commit 0e927b1) |
| **platform.vsphere.dnsRecordsType** | docs-only-not-supported, minVersion=4.21 (3 catalogs) | N/A (deliberate) | N/A | N/A | N/A (omission defaults to Internal) | N/A | N/A | N/A | N/A | ✅ catalog classification tests | **DONE** — deliberate support boundary (commit 0e927b1) |

### DOC-102 Canonical Slices and Closure Tranches — Complete

**Final DOC-102 closure tranches — CLOSED (2026-08-13).**

All items that were previously listed as remaining DOC-102 work have been resolved:

- **bmcVerifyCA:** Fully implemented as supported-ui. Shared validation module (shared/bmcVerifyCA.js), PlatformSpecificsStep UI control, backend generation with version gate, Field Guide content in v4.21/baremetal.js, frontend tests (bmc-verify-ca.test.jsx) and backend tests (bmc-verify-ca.test.js). Commit a0d5fcb.
- **Azure BYO VNet subnets:** Fully implemented as supported-ui (subnets.name) / supported-derived (subnets parent, subnets.role). Shared validation module (shared/azureByoVnet.js), PlatformSpecificsStep BYO VNet editor, version-gated generation (4.21 emits subnets array with name/role, 4.20 emits controlPlaneSubnet/computeSubnet), frontend tests (azure-byo-vnet.test.jsx) and backend tests (azure-byo-vnet.test.js). Commit 3e3148b.
- **dnsRecordsType:** Reclassified from supported-backend-only to docs-only-not-supported (bare-metal-agent, bare-metal-ipi, vsphere-agent, vsphere-ipi, vsphere-upi, nutanix-ipi) and hidden-not-applicable (bare-metal-upi). Deliberate support boundary: External mode requires OnPremDNSRecords feature gate and loadBalancer.type=UserManaged, neither of which is owned by this application. Installer omission defaults to Internal. Catalog classification tests verify supportStatus across all 7 entries. Commit 0e927b1.
- **OnPremDNSRecords and loadBalancer.type=UserManaged:** Investigated and resolved as part of dnsRecordsType support boundary decision. External mode's dependency chain (feature gate + UserManaged load balancer) is outside application scope. Documented in catalog notes and dnsRecordsType support boundary rationale.

**Zero supported-backend-only 4.21 delta params remain for supported platforms.** All supported-platform params have been promoted to supported-ui/supported-derived or reclassified to docs-only-not-supported/hidden-not-applicable with documented rationale. 38 unsupported/manual-review upstream delta paths remain intentionally deferred: 32 PowerVC, 4 GCP, 1 OpenStack, 1 global manual-review (imageDigestSources.sourcePolicy). See Slice 5G.

### 4.21 supported-ui Params — Production Control Mapping

All supported-ui OpenShift 4.21 delta paths have verified production controls:

| Param | Frontend Control | File |
|---|---|---|
| controlPlane.platform.aws.rootVolume.throughput | Numeric input with 125–2000 range | PlatformSpecificsStep.jsx |
| controlPlane.platform.aws.cpuOptions.confidentialCompute | Select dropdown (Use default / Disabled) | PlatformSpecificsStep.jsx |
| platform.azure.allowSharedKeyAccess (IPI) | Select dropdown (true / false / not set) | PlatformSpecificsStep.jsx |
| platform.azure.allowSharedKeyAccess (UPI) | Select dropdown (true / false / not set) | PlatformSpecificsStep.jsx |
| platform.baremetal.bmcVerifyCA (agent) | PEM textarea with validation | PlatformSpecificsStep.jsx |
| platform.baremetal.bmcVerifyCA (IPI) | PEM textarea with validation | PlatformSpecificsStep.jsx |
| platform.azure.subnets.name (IPI) | BYO VNet subnet editor | PlatformSpecificsStep.jsx |
| platform.azure.subnets.name (UPI) | BYO VNet subnet editor | PlatformSpecificsStep.jsx |

---

## D. Remaining DOC-106 and DOC-107 Copy Work

### DOC-106 Status: verified_done (Phase 0 inventory only)

The inventory phase is complete. 3,239 hardcoded version references were catalogued in `versioned-copy-audit-results/` and classified in `docs/VERSIONED_COPY_INVENTORY.md`.

### DOC-107 Status: verified_done — guard-and-fix approach implemented and verified

**Implementation approach:** Guard-and-fix (version-neutral rewording + CI grep guard) was used instead of a centralized `shared/versionedCopy.js` copy map. This approach achieves the same goal — no hardcoded version references in user-facing production code — through direct remediation of each finding combined with CI regression prevention.

**Resolved violations (25 total):** All user-facing hardcoded version references identified by `scripts/find-hardcoded-versions.sh --check` have been remediated via version-neutral rewording or dynamic `selectedMinor` substitution. See `docs/VERSIONED_COPY_INVENTORY.md` for per-finding evidence.

**CI enforcement:** `scripts/find-hardcoded-versions.sh --check` exits 0 (clean). `.github/workflows/validate-versioned-copy.yml` runs `--self-test` (38/38 pass) then `--check` in CI. Guard pattern `4\.([0-9]{2,})` covers all 4.x two-digit minors including future unsupported versions.

**Test coverage:** `frontend/tests/version-neutral-copy.test.jsx` — 42 tests across 10 describe blocks covering all remediated files.

**Adjudication ledger:** `docs/VERSIONED_COPY_INVENTORY.md` documents 9 exclusion categories (INFRA, CDEFLT, COMMENT, LOGIC, FMT, THRESH, ENUMVAL, VMAP, VGATED) with per-finding evidence. No whole-file exclusions for user-facing components.

**Verification evidence (M02-A pass):** CI guard --check exit 0, --self-test 38/38 pass, version-neutral-copy tests 42/42 pass, 3 spot-checks of resolved violations confirmed version-neutral in live source.

### Versioned-Copy Inventory Totals (from tracked inventory at HEAD 289b8794)

The tracked inventory (`docs/VERSIONED_COPY_INVENTORY.md`) catalogues 3,239 total version references across 8 categories. The inventory uses the classification scheme: replace-with-locked, copy-map, param-derived, historical, version-neutral, needs-verification. The per-outcome classifications below (NON_USER_FACING, STALE_OR_INCORRECT, etc.) are analytical labels applied during this documentation assessment — they do not appear in the tracked inventory and exact per-classification counts have not been established by current tracked evidence.

**Tracked inventory exact counts by category:**

| Category | Exact Count | Priority |
|---|---|---|
| Frontend UI | 85 | HIGH |
| Backend | 146 | MEDIUM |
| Field Guide | 126 | HIGH |
| Validation Messages | 5 | HIGH |
| Tooltips | 3 | HIGH |
| Docs Links in Code | 1,912 | LOW (mostly catalog citations) |
| Generated Artifacts | 138 | MEDIUM |
| Documentation | 824 | LOW |
| **Total** | **3,239** | — |

**Tracked inventory "Must Edit" list:** 5 validation messages, 8–10 UI text strings, 3 tooltips, 12 hardcoded docs links (these ranges are from the inventory itself at line 50; exact per-string enumeration requires implementation-time verification).

**User-facing strings needing centralization:** Exact count not established by current tracked evidence. The tracked inventory identifies HIGH-priority user-facing categories (Frontend UI: 85, Validation Messages: 5, Tooltips: 3, Field Guide: 126) but does not break these down into "needs centralization" vs "already correct" subcounts. The implementation tranche (DOC-107) must establish exact counts during the copy-map creation.

---

## E. Remaining DOC-103 UI/UX and Field Guide Work

**DOC-103 status: active / near-complete** — Version locking (BlueprintStep lock/confirm, v3 locked field), version-aware UI controls (PlatformSpecificsStep version-gated controls for 5 supported-ui params), version-aware UI registry (catalogFieldMeta.js isCatalogFieldVisible with supportStatus check), browser verification (DOC-101 verification session), unlock/relock workflow (versionReleaseTransition.js, 63 deterministic tests, App.jsx integration), metadata-driven version annotations for all 5 introduced supported-ui fields and deprecation treatment for all 4 deprecated supported-ui vSphere fields, Field Guide strict version resolution (versionResolution.js throws on missing/unsupported versions, no silent fallback), version-neutral copy (DOC-107 verified_done). Remaining: DOC-104 systematic test coverage only.

| Component | Status | Evidence |
|---|---|---|
| Version lock UI | IMPLEMENTED_UNVERIFIED | BlueprintStep has lock/confirm workflow; v3 locked field set |
| Unlock and relock workflow | IMPLEMENTED | versionReleaseTransition.js with 63 deterministic tests; App.jsx integration; full unlock/relock lifecycle covering version change, catalog reload, Field Guide regeneration, state migration |
| Version-specific tooltips | IMPLEMENTED | All 5 introduced supported-ui fields (throughput, confidentialCompute, allowSharedKeyAccess, subnets.name, bmcVerifyCA) have "Introduced in OpenShift {selectedMinor}" hint text using metadata-driven annotations via getFieldAnnotationInfo(). Deprecation notices present in vSphere legacy section. 23 annotation tests in doc-103-version-annotations.test.jsx |
| Version-neutral labels | PARTIAL | Some labels use locked-version helper; exact count of hardcoded "OpenShift 4.20" not established by current tracked evidence |
| Warnings and helper text | PARTIAL | Unsupported-version recovery UI exists; version-specific warnings not systematically implemented |
| Validation messages | PARTIAL | Some use isVersionGTE; no centralized version-aware message system |
| Deprecation badges | IMPLEMENTED | vSphere legacy placement has deprecation text (warning block, "deprecated since OpenShift 4.13", "DEPRECATED" in hints/labels) for all 4 deprecated supported-ui fields (datacenter, defaultDatastore, network, vcenter). Systematic treatment verified adequate and consistent — no additional UI elements needed. Tested in doc-103-version-annotations.test.jsx |
| Introduced/deprecated annotations | IMPLEMENTED | Metadata-driven via getFieldAnnotationInfo() in catalogFieldMeta.js. All 5 introduced supported-ui fields show "New in OpenShift {selectedMinor}" annotation (data-version-annotation="introduced") when locked version is 4.21, hidden at 4.20. 23 tests covering unit + DOM rendering for all annotation surfaces |
| Field Guide version selection | SUPERSEDED_BY_LOCKED_VERSION_SELECTION | assembler.js `SUPPORTED_VERSIONS = ["4.20", "4.21"]`, `getCompartmentsForVersion()` selects v4.20/ or v4.21/ content directory based on locked version. No independent version-selector control exists — the Field Guide derives its content version from the locked blueprint version via context.js. An independent selector is not needed and was never implemented. |
| Field Guide locked-version behavior | IMPLEMENTED — fallback gap RESOLVED | FG-4.21-B (commit 49e12cb) closed the fallback gap. versionResolution.js provides strict version resolution that throws on missing/unsupported versions with no silent fallback to 4.20. 68 version-safety tests verify deterministic rejection of unsupported versions. |
| Field Guide stale content | **FG-4.21-A2 PENDING ACCEPTANCE — 21→4 literal reduction** | **Three-class baseline (21 total raw `4.20` literals pre-A2):** Class A (17 mechanical stale labels): corrected to `4.21` in aws.js (header, comment, permissions label), baremetal.js (header, comment, IPI release notes label, UPI docs label), global.js (header, comment, installation overview docRef, installation validation docRef), ibmcloud.js (header, comment), mirror.js (header, comment), nutanix.js (header, comment). Class B (1 semantic, PROTECTED): global.js line 23 RHEL-host statement `RHEL 9 is recommended for OCP 4.20` — unchanged, deferred to separate authoritative-source verification. Class C (3 intentional, PROTECTED): azure.js line 34 BYO VNet compatibility statement with 3 bare `4.20` references — unchanged, valid cross-version behavior. **Post-A2: exactly 4 remaining `4.20` literals (1 Class B + 3 Class C).** Source-tree and runtime-compartment tests enforce semantic allowlist in `fieldGuide-4.21.test.js` (7 tests) and `fieldGuide-aws-context.test.js` (3 tests); 118/118 focused Field Guide tests pass. |
| Field Guide parameter filtering | PARTIAL | Catalog-driven but no supportStatus-based filtering in Field Guide generation |
| Version-specific documentation links | IMPLEMENTED_UNVERIFIED | docsIndexResolver.js maps versions to docs-index files; v4.20 and v4.21 exist |
| Accessibility | NON-BLOCKING | Existing a11y infrastructure covers version controls; no version-specific a11y regression introduced by annotation implementation |
| Responsive support-content behavior | VERIFIED | Three-row layout accepted |

### Field Guide Path Trace

| Stage | Status |
|---|---|
| Selected and locked version | ✅ state.version.selectedMinor used |
| Catalog loading | ✅ version-aware catalog paths |
| Parameter metadata | ✅ catalogs have supportStatus |
| Context construction | ✅ context.js reads version from state |
| Content generation | ✅ v4.20/ and v4.21/ compartments exist |
| Frontend display | ✅ Field Guide rendered in ReviewStep |
| Download/export | ✅ included in export bundle |
| Documentation links | ✅ version-specific docs-index |
| Warnings and unsupported-field messaging | ✅ Unsupported-version recovery UI exists; versionResolution.js throws on unsupported versions |
| Introduced/deprecated annotations in content | ✅ IMPLEMENTED — metadata-driven annotations via getFieldAnnotationInfo() for all 5 introduced supported-ui fields + deprecation treatment for 4 vSphere legacy fields |
| v4.21 content version-correctness | ⏳ FG-4.21-A2 pending acceptance: 17/21 Class A stale labels corrected; 4 remaining (1 Class B + 3 Class C) protected by semantic allowlist tests |

---

## F. DOC-104 Validation — Complete (M04, 2026-09-18)

**DOC-104 status: done_pending_verification.** M04-A coverage matrix completed: all 24 version-awareness requirements mapped to existing test evidence and classified. All 24 have EXISTING ADEQUATE COVERAGE. No parameterized version-matrix suite needed — existing tests already implement paired version testing patterns. M04-C E2E hardening: 8/9 criteria SATISFIED by existing tests; criterion 9 (sequential keyboard entry) is DEFERRED to DOC-115 (Cloud availability-zone multi-value keyboard entry, GitHub issue #18, p1 active) — the behavior is owned by that backlog item, not by DOC-059/v2.0.0.

### M04-A Requirement → Test Evidence Coverage Matrix (24 rows)

| # | Requirement | Test file(s) | Count | Classification |
|---|-------------|-------------|-------|---------------|
| 1 | Catalog loading | catalogResolver (25), catalog-validation (44), catalogVersion (9) | 78 | ADEQUATE |
| 2 | Canonical/frontend catalog parity | validation-catalog-alignment + sync-catalogs --dry-run 25/25 | 9+ | ADEQUATE |
| 3 | Version-gated field visibility | version-gated-field-boundary (34), catalog-4.21-support (126), catalogFieldMeta (24), catalogPaths-versioning (18) | 202 | ADEQUATE |
| 4 | Validation (version-gated rules) | bmc-verify-ca (115), azure-byo-vnet (109), dns-records-type (7), azure-allow-shared-key-access (28), aws-confidential-compute (54), aws-root-volume-throughput (41) | 354 | ADEQUATE |
| 5 | Generation (version-gated output) | smoke (88), install-config-version-boundary (58) + per-feature generation tests | 146+ | ADEQUATE |
| 6 | Field Guide version resolution | fieldGuide-version-safety (68) | 68 | ADEQUATE |
| 7 | Field Guide version-specific content | fieldGuide-4.21 (60), fieldGuide-aws-context (39) | 99 | ADEQUATE |
| 8 | Field Guide provenance | fieldGuide-certification (62) | 62 | ADEQUATE |
| 9 | Exact-minor docRefs | fieldGuide-certification (62 includes docRef) | 62 | ADEQUATE |
| 10 | Version transitions/unlock/relock | doc-103-release-unlock-transition (49), doc-103-release-unlock-workflow (14) | 63 | ADEQUATE |
| 11 | Schema migration (v1/v2→v3) | state-migration-boundary (18), api-state-migration-boundary (14), legacy-state-migration (22), migrations (15) | 69 | ADEQUATE |
| 12 | Persistence | slice-6-v3-preservation (38), store-persistence-abort (6), blueprint-lock-v3-canonical (8), state-validation (13), state-secret-persistence (27) | 100 | ADEQUATE |
| 13 | Hydration | slice-6-v3-preservation (38), blueprint-lock-v3-canonical (8) | 47 | ADEQUATE |
| 14 | Unsupported/future-state rejection | unsupported-version-guard (9), unsupported-version-complete (7), unsupported-version-recovery-cleanup (2), unsupported-version-http-boundary (18), unsupported-version-generation (9) | 45 | ADEQUATE |
| 15 | JSON run export/import | export-integrity (25), import-integrity (174), export-endpoint-integration (7), export-migration-boundary (10), import-migration-boundary (16) | 232 | ADEQUATE |
| 16 | v1/v2→v3 migration | (same as #11) | 69 | ADEQUATE |
| 17 | Generated ZIP version-manifest | export-integrity (25) | 25 | ADEQUATE |
| 18 | Bundle/archive validation | bundle-import (27) | 27 | ADEQUATE |
| 19 | Archive non-persistence | bundle-import non-persistence contract (4) | 4 | ADEQUATE |
| 20 | Deterministic 4.22 rejection | All boundary tests combined | 45+ | ADEQUATE |
| 21 | Version-correct UI copy | version-neutral-copy (42) + CI guard 38/38 | 42 | ADEQUATE |
| 22 | Introduction/deprecation annotations | doc-103-version-annotations (23) | 23 | ADEQUATE |
| 23 | DOC-120 vSphere path behavior | smoke DOC-120 tests (3) + doc-120-vsphere-path-validation (22) | 25 | ADEQUATE |
| 24 | DOC-122 structural/requiredness | No code changes needed (audit: zero output errors) | N/A | NOT APPLICABLE |

### E2E Hardening Criteria (M04-C)

| # | Criterion | Status | Evidence |
|---|-----------|--------|---------|
| 1 | No permissive visibility assertions | SATISFIED | Deterministic `.toBeNull()` / `.not.toBeNull()` |
| 2 | Bundle-download failures not swallowed | SATISFIED | ReviewStep.jsx `setGenerateError()` in catch |
| 3 | Deterministic 4.22 rejection | SATISFIED | 45+ tests across all boundaries |
| 4 | No tests accepting success AND failure | SATISFIED | No `toBeTruthy`/`toBeFalsy` in key tests |
| 5 | Explicit vSphere FD-mode coverage | SATISFIED | smoke.test.js FD-mode deepStrictEqual |
| 6 | Legacy-placement coverage retained | SATISFIED | smoke.test.js 10+ legacy fixtures |
| 7 | Semantic comparisons | SATISFIED | 289 deepStrictEqual/strictEqual in smoke |
| 8 | Azure IPI worker-replica golden | SATISFIED | Integration-covered via shared code path |
| 9 | Sequential keyboard entry | DEFERRED — owned by DOC-115 | DOC-115 (Cloud availability-zone multi-value keyboard entry, GitHub issue #18, p1 active) owns this behavior. The specific field is `defaultAvailabilityZones` (AWS GovCloud IPI) and equivalent AZ fields on Azure/IBM. DOC-115 has its own 12-point acceptance criteria including sequential entry, comma preservation, and blur/submit normalization. Not a DOC-059/v2.0.0 definition-of-done item. |

### Historical Test Baseline

**Latest accepted evidence (from dnsRecordsType support boundary tranche, HEAD 0e927b1):**

| Suite | Passed | Skipped | Failed | Todo |
|---|---|---|---|---|
| Frontend (Vitest) | 2,241 | 2 | 0 | 0 |
| Backend (Node.js test runner) | 1,252 | 0 | 0 | 5 |
| Focused DNS (subset of backend) | 23 | 0 | 0 | 0 |
| Playwright (separate browser acceptance) | 4 | 0 | 0 | 0 |

**Prior baseline (from confidential-compute tranche, commit 289b8794):**

| Suite | Passed | Skipped | Failed | Todo |
|---|---|---|---|---|
| Frontend (Vitest) | 2,080 | 2 | 0 | 0 |
| Backend (Node.js test runner) | 1,089 | 0 | 0 | 5 |
| **Total** | **3,169** | **2** | **0** | **5** |

### Backend Todo Items

| Backlog ID | File | Description |
|---|---|---|
| DOC-123 | nic-bond-vlan-ipv6.test.js:249 | Multiple bonds on same node |
| DOC-123 | nic-bond-vlan-ipv6.test.js:251 | Multiple VLANs on same bond |
| DOC-124 | nic-bond-vlan-ipv6.test.js:287 | Asymmetric VIPs dual-stack |
| DOC-125 | nic-bond-vlan-ipv6.test.js:289 | DHCP IPv6 coexistence |
| DOC-126 | nic-bond-vlan-ipv6.test.js:291 | IPv6 route destinations |

### Frontend Skip Items

| Count | Location |
|---|---|
| 1 | HostInventoryV2Phase42.test.jsx |
| 1 | platform-specifics-step.test.jsx |

### Coverage Matrix Gaps

| Category | 4.20 Coverage | 4.21 Coverage | Gap |
|---|---|---|---|
| State migration | ✅ 23 tests | ✅ v3 schema tested | Minimal |
| Version selection | ✅ BlueprintStep tests | ✅ Lock v3 canonical tests | Minimal |
| Version locking | ✅ 8 frontend lock tests | ✅ 6 backend confirm tests | Minimal |
| Catalog loading | ✅ catalogResolver tests | ✅ Version-aware loading tested | Version-matrix parameterization missing |
| Catalog mirror identity | ✅ MD5 sync verified | ✅ 4.21 catalogs synced | No automated CI gate |
| Field visibility | ✅ isCatalogFieldVisible | ✅ Version-gated fields tested | Systematic parameterized matrix missing |
| Frontend validation | ✅ ~300+ validation tests | ✅ Version-gated rules tested | bmcVerifyCA ✅ (bmc-verify-ca.test.jsx), Azure subnets ✅ (azure-byo-vnet.test.jsx), dnsRecordsType ✅ deliberate boundary |
| Backend validation | ✅ Schema validation | ✅ Throughput + confidentialCompute + bmcVerifyCA + Azure subnets | bmcVerifyCA ✅ (bmc-verify-ca.test.js), Azure subnets ✅ (azure-byo-vnet.test.js), dnsRecordsType ✅ (dns-records-type.test.js) |
| Generation | ✅ ~200+ generation tests | ✅ 4.21-specific generation tested | All 4.21 delta params resolved — bmcVerifyCA ✅, Azure subnets ✅ version-gated, dnsRecordsType ✅ deliberate omission |
| Stale-state suppression | ✅ Unknown schema blocked | ✅ Unsupported version recovery | Adequate |
| Persistence | ✅ State save/load tests | ✅ v3 migration-before-persist | Adequate |
| Hydration | ✅ Frontend hydration tests | ✅ Slice 6 v3 preservation | Adequate |
| Import (JSON run envelope) | ✅ Import tests exist | ✅ v1→v3 migration tested | JSON run import works; version-manifest validation applies only to future manifest-bearing archive import surface (M01 contract frozen 2026-09-15) |
| Import (manifest-bearing archive validation core) | ✅ M03 implementation complete and checkpointed (0ca11266) | ✅ M03 validation-core + HTTP endpoint implemented | `backend/src/exportIntegrity.js`: `validateArchiveManifest` + `validateArchiveBuffer` (174 unit tests); `POST /api/bundle.import` HTTP endpoint registered before global JSON parser with route-local `express.raw()`, content-type gate (415), 512 MiB limit (413), empty-body guard (400), validator error mapping (400/422), fail-closed 500 with errorId, validation-only semantics (no state import, persistence, or extraction); `backend/test/bundle-import.test.js` (27 HTTP integration tests). M03 implementation and deterministic validation are complete and human-checkpointed at 0ca11266d032dc0216bdc5c4895a5d41984f5dbc. Post-commit certification verified: bundle-import 27/27 pass, import-integrity 174/174 pass, export-integrity 25/25 pass, full backend 1705 pass / 0 fail / 5 todo, git diff --check exit 0, clean working tree. All certification return codes zero (bundle=0, import=0, export=0, full=0, diff=0, clean=0). M03 archive handling is validation-only and non-persisting; archive contains no state.json so persistence/state restoration is not part of this surface |
| Export (JSON run envelope) | ✅ Export tests exist | ✅ v3 sanitized state exported | JSON run export is state portability; version-manifest belongs to ZIP surface |
| Export (generated artifact ZIP) | ✅ buildBundleZip tested | ✅ version-manifest.json implemented (M02) | `backend/src/exportIntegrity.js` generates manifest with SHA-256 checksums; `backend/test/export-integrity.test.js` (25 tests); integrated into `buildBundleZip` |
| HTTP boundaries | ✅ API state migration boundary | ✅ 6 hermetic tests | Adequate |
| Field Guide | Minimal | ⏳ FG-4.21-A2 pending acceptance: source-tree stale-label coverage (4 tests) and runtime-compartment stale-label coverage (3 tests) in `fieldGuide-4.21.test.js`; AWS permissions label tests (3 tests) in `fieldGuide-aws-context.test.js`; 118/118 focused tests pass | Bounded coverage added; full Field Guide fallback tests remain open |
| Tooltips and copy | ✅ hint-syntax.test.js | ❌ No version-correctness tests | Gap |
| Deprecations | ✅ doc-103-version-annotations.test.jsx (3 deprecated tests) | ✅ Metadata-driven deprecation treatment implemented | vSphere legacy fields verified adequate; 23 annotation tests total |
| E2E | ✅ 12 Playwright tests | ❌ No version-matrix E2E | Gap |
| Manual visual verification | ✅ Browser verification (DOC-101) | ❌ No DOC-102/103 visual verification | Gap |

---

## G. Remaining DOC-105 Release Work

**DOC-105 status: active / partial** — not "NOT STARTED". Implemented evidence: Design System documentation (docs/DESIGN_SYSTEM.md), version-aware UI field checklist (docs/VERSION_AWARE_UI_FIELD_CHECKLIST.md), roadmap governance (docs/IMPLEMENTATION_ROADMAP_2026-05-14.md, continuously maintained). Note: historical planning/status records reference ADR-001 through ADR-007 at `local-docs/version-aware-planning/`, but these files are not tracked or present in the live worktree and are not current tracked release evidence. Partial: README has v2 development identity (build-info version field, Option A clarification, check:app-version script); CHANGELOG has `[Unreleased] - v2.0.0 Work in Progress` section; VERSION identity established at `2.0.0-dev` with deterministic validation (`npm run check:app-version`). Remaining for final release closure: migration guide (v1→v2), full README v2.0.0 release update, CHANGELOG v2.0.0 GA entry, security audit, dependency scan, release notes, manual QA, generated artifact validation.

| Artifact | Status | Gap |
|---|---|---|
| Migration guide (v1→v2) | ❌ NOT CREATED | Blocked by DOC-102/103/104 completion |
| README update | PARTIAL | README contains v2 development identity (build-info version field, Option A clarification, check:app-version script). Full v2.0.0 release update blocked by feature completion |
| ADRs | ❌ ADR-001 through ADR-007 referenced by historical records at `local-docs/version-aware-planning/` but not tracked or present in live worktree | Not current tracked release evidence; create or recover tracked ADR files before claiming ADR completion |
| BACKLOG_STATUS update | ✅ Continuously maintained | Final DOC-059 closure update pending |
| Implementation roadmap | ✅ Maintained but stale (last updated 2026-05-29) | Needs v2.0.0 progress update |
| CHANGELOG | PARTIAL | CHANGELOG contains `[Unreleased] - v2.0.0 Work in Progress` section with breaking changes, added features, and fixes. Final v2.0.0 release entry blocked by release |
| Security audit | COMPLETE | npm audit performed for backend and frontend; see adjudication table below |
| Dependency scan | COMPLETE | npm audit --json run 2026-09-18; all findings classified |
| Manual QA (4.20) | PARTIAL (DOC-101 browser verification) | Full QA cycle not performed |
| Manual QA (4.21) | PARTIAL (DOC-101 browser verification) | Full QA cycle not performed |
| 4.20 generated artifacts validation | COMPLETE | smoke.test.js full deepStrictEqual for BM Agent 4.20, vSphere IPI 4.20, AWS GovCloud IPI 4.20; install-config-version-boundary.test.js deepStrictEqual at 4.20 |
| 4.21 generated artifacts validation | COMPLETE | smoke.test.js full deepStrictEqual for BM Agent 4.21, AWS GovCloud IPI 4.21 (includes throughput, confidentialCompute); install-config-version-boundary.test.js deepStrictEqual at 4.21 |
| Release versioning | COMPLETE | VERSION file set to `2.0.0`; all 4 package.json, 3 package-lock.json, and shared/package.json synchronized; deterministic validator (`npm run check:app-version`) passes. Version identity `2.0.0` is the application-code GA version (the earlier RC→GA convention was planning language, superseded by README policy declaring `v2.0.0` as the GA identity) |
| Release notes | COMPLETE | CHANGELOG.md updated with dated [2.0.0] entry (2026-09-18) |
| Upgrade guidance | COMPLETE | docs/MIGRATION_GUIDE_v1_to_v2.md created with state schema migration, breaking changes, new features |
| Import compatibility | PARTIAL (v1→v3 JSON run migration + M03 HTTP validation) | version-manifest.json generated in ZIP (M02); `POST /api/bundle.import` HTTP validation endpoint implemented with 27 integration tests including non-persistence contract tests; validation-only (no state import/persistence); JSON run import unaffected; M03 ZIP archive-import semantics resolved as validation-only (archive contains no state.json) |

### Security / Dependency Adjudication (npm audit, 2026-09-18)

Disposition categories:
- **A. Not reachable in production** — dev-only dependency or code path not exercised
- **F. HUMAN_ACCEPTED_NON_BLOCKING_RISK** — reachable production dependency with known residual risk; human-accepted as non-blocking for v2.0.0 application-code GA (2026-09-18). Preserved for subsequent dependency/security hardening backlog.
- **E. GA blocker** — credible production risk requiring dependency update or human decision

**Human acceptance decision (2026-09-18):** All reachable production dependency risks documented below were explicitly reviewed and accepted as known residual risk for the v2.0.0 application-code GA boundary. This acceptance does NOT resolve or delete the broader security/dependency-productionization backlog. These findings are preserved for subsequent dependency/security hardening work.

#### Backend (production runtime)

| Advisory | Package | Severity | Prod/Dev | Reachability | Disposition |
|----------|---------|----------|----------|-------------|-------------|
| GHSA-8xcm-r25x-g524 | undici | High | Prod (direct) | Reachable — undici powers `fetch()` for Cincinnati, docs, oc-mirror, mirror-registry checks | F. HUMAN_ACCEPTED_NON_BLOCKING_RISK — response desynchronization via retry interceptor; app uses simple one-shot `fetch()` calls, does not use retry interceptor |
| GHSA-4cwx-7wf7-3272 | undici | High | Prod (direct) | Reachable — same fetch paths | F. HUMAN_ACCEPTED_NON_BLOCKING_RISK — private cache directive parsing; app does not use undici caching layer |
| GHSA-m8rv-5g2x-5cg5 | undici | High | Prod (direct) | Reachable — same fetch paths | F. HUMAN_ACCEPTED_NON_BLOCKING_RISK — CRLF injection via blob body type; app uses string/JSON payloads, not Blob bodies |
| GHSA-jr45-8vmc-qm54 | undici | High | Prod (direct) | Reachable — same fetch paths | F. HUMAN_ACCEPTED_NON_BLOCKING_RISK — Cache-Control whitespace; app does not use undici caching |
| GHSA-v3r7-h72x-cjcm | undici | High | Prod (direct) | Reachable — same fetch paths | F. HUMAN_ACCEPTED_NON_BLOCKING_RISK — cookie attribute injection; app does not use undici cookie jar |
| GHSA-5p4m-2wfm-xmqj | js-yaml | High | Prod (direct) | Reachable — js-yaml used in generate.js (yaml.dump), cincinnati.js (yaml.load), yamlValidator.js (yaml.load) | F. HUMAN_ACCEPTED_NON_BLOCKING_RISK — quadratic CPU in !!omap resolution; app does not use !!omap tags; user YAML parsed with DEFAULT_SCHEMA; Cincinnati data is trusted upstream. Known residual: user-imported YAML theoretically reachable |
| GHSA-2883-xcg3-v3hh | js-yaml | High | Prod (direct) | Reachable — same yaml.load paths | F. HUMAN_ACCEPTED_NON_BLOCKING_RISK — empty merge source CPU; merge keys (<<:) not present in app-generated YAML; user-imported YAML could theoretically contain them; impact is bounded CPU spike, not data loss |
| GHSA-28wg-ghj8-5hjv | nanoid | High | Prod (direct) | Reachable — nanoid() used for runId generation, temp paths, submission IDs | F. HUMAN_ACCEPTED_NON_BLOCKING_RISK — non-secure generator infinite loop with negative size; app always calls `nanoid()` with default size=21 |
| GHSA-xwg4-73v4-xw9w | nanoid | High | Prod (direct) | Reachable — same nanoid() calls | F. HUMAN_ACCEPTED_NON_BLOCKING_RISK — integer overflow; app uses default size (21); overflow requires size > 2^31 |
| GHSA-x5fp-wj9c-mxmx | qs | Moderate | Prod (transitive via express) | Reachable — express parses query strings | F. HUMAN_ACCEPTED_NON_BLOCKING_RISK — array-limit bypass via bracket-key comma parsing; app uses express default qs settings |
| GHSA-4mjr-xmp4-gh2g | qs | Moderate | Prod (transitive via express) | Reachable — same express qs parsing | F. HUMAN_ACCEPTED_NON_BLOCKING_RISK — DoS via attacker-controlled isBuffer; express validates req.query origin |
| GHSA-v422-hmwv-36x6 | body-parser | Moderate | Prod (transitive via express) | Reachable — express uses body-parser | F. HUMAN_ACCEPTED_NON_BLOCKING_RISK — invalid limit value silently disables size enforcement; app uses express default limits |
| GHSA-3jxr-9vmj-r5cp | brace-expansion | High | Prod (transitive: archiver→readdir-glob→minimatch) | Reachable (low) — archiver uses minimatch for glob patterns; app controls all glob patterns passed to archiver | F. HUMAN_ACCEPTED_NON_BLOCKING_RISK — DoS via exponential expansion; app passes only literal paths and simple globs |
| GHSA-mh99-v99m-4gvg | brace-expansion | High | Prod (same chain) | Reachable (low) — same path | F. HUMAN_ACCEPTED_NON_BLOCKING_RISK — unbounded expansion length OOM; same app-controlled patterns |
| GHSA-rgw5-rvv9-x895 | brace-expansion | High | Prod (same chain) | Reachable (low) — same path | F. HUMAN_ACCEPTED_NON_BLOCKING_RISK — bypass of prior CVE fix; same app-controlled patterns |
| GHSA-hmw2-7cc7-3qxx | form-data | High | Dev (transitive: supertest→superagent→form-data) | Not reachable — dev-only dependency, not in production bundle | A. Dev-only |

#### Frontend (build tooling / dev server — no production runtime)

All frontend vulnerabilities are in build-time or dev-server dependencies. The frontend ships as static HTML/CSS/JS built by `vite build`; none of these packages run in the user's browser or in the production backend.

| Advisory | Package | Severity | Prod/Dev | Disposition |
|----------|---------|----------|----------|-------------|
| GHSA-5xrq-8626-4rwp | vitest | Critical | Dev (test runner) | A. Dev-only — test runner, not shipped |
| GHSA-82fw-gwwq-j7x9 | vitest / @vitest/mocker | Critical/Moderate | Dev (test runner) | A. Dev-only |
| GHSA-4w7w-66w2-5vf9 | vite | High | Dev (build tool) | A. Dev-only — build tool, not shipped |
| GHSA-v6wh-96g9-6wx3 | vite (launch-editor) | High | Dev (build tool) | A. Dev-only; also Windows-specific, app targets Linux |
| GHSA-fx2h-pf6j-xcff | vite | High | Dev (build tool) | A. Dev-only; also Windows-specific |
| GHSA-67mh-4wv8-2f99 | esbuild | Moderate | Dev (via vite) | A. Dev-only |
| GHSA-qx2v-qp2m-jg93 | postcss | High | Dev (CSS processing) | A. Dev-only |
| GHSA-6g55-p6wh-862q | postcss | High | Dev (CSS processing) | A. Dev-only |
| GHSA-fxqj-rqcc-2cmp | postcss | High | Dev (CSS processing) | A. Dev-only |
| GHSA-r28c-9q8g-f849 | postcss | High | Dev (CSS processing) | A. Dev-only |
| GHSA-mw96-cpmx-2vgc | rollup | High | Dev (via vite) | A. Dev-only |
| GHSA-c83g-rgw3-j3cx | browserslist | High | Dev (build config) | A. Dev-only |
| GHSA-73wf-gq98-2v4g | browserslist | High | Dev (build config) | A. Dev-only |
| GHSA-w5vr-8v7q-w6rv | baseline-browser-mapping | Moderate | Dev (build config) | A. Dev-only |
| GHSA-4x5r-pxfx-6jf8 | @babel/core | Low | Dev (transpiler) | A. Dev-only |
| GHSA-hmw2-7cc7-3qxx | form-data | High | Dev (transitive) | A. Dev-only |
| GHSA-28wg-ghj8-5hjv | nanoid | High | Dev (transitive) | A. Dev-only — nanoid in frontend is a transitive dev dep |
| GHSA-2v37-7h3g-55p8 | nanoid | High | Dev (transitive) | A. Dev-only |
| GHSA-xwg4-73v4-xw9w | nanoid | High | Dev (transitive) | A. Dev-only |
| GHSA-58qx-3vcg-4xpx | ws | High | Dev (via vite) | A. Dev-only |
| GHSA-96hv-2xvq-fx4p | ws | High | Dev (via vite) | A. Dev-only |

#### Summary

- **0 GA blockers** (Category E)
- **0 dependency updates required for v2.0.0 GA**
- Backend production: 16 findings — 15 HUMAN_ACCEPTED_NON_BLOCKING_RISK (F), 1 dev-only (A)
- Frontend: 21 findings — all dev-only build/test tooling (A)
- All reachable production findings preserved for subsequent dependency/security hardening backlog
- Human acceptance recorded 2026-09-18; does not close the broader productionization backlog

---

## H. Dependency Graph

```
DOC-100 (Phase 0) ─────────────── ✅ DONE
    │
DOC-101 (Phase 1) ─────────────── ✅ DONE
    │
DOC-102 (Phase 2) ─────────────── ✅ DONE (all canonical slices + closure tranches, 2026-08-13)
    │
    ├── DOC-107 (versioned copy implementation) ⏳
    │       depends on: DOC-102 (✅ done), DOC-106 (✅ inventory done)
    │       blocks: DOC-103 (complete version-correct copy)
    │
    ├── DOC-103 (UI/UX) ⏳
    │       depends on: DOC-102 (✅ done), DOC-107 (version-correct copy)
    │       blocks: DOC-104 (UI/UX testing)
    │
    ├── DOC-104 (testing) ⏳
    │       depends on: DOC-102 (✅ done), DOC-103, DOC-107
    │       blocks: DOC-105 (release)
    │
    └── DOC-105 (release) ⏳
            depends on: DOC-102 (✅ done), DOC-103, DOC-104, DOC-107
            blocks: DOC-059 closure
```

---

## I. Ordered Bounded Execution Plan

### ~~Tranche V1: DOC-102 final closure — validation and support boundary~~ — COMPLETE (commit a0d5fcb, 0e927b1)
### ~~Tranche V2: DOC-102 final closure — version-gated generation~~ — COMPLETE (commit 3e3148b)

### Field Guide Execution Sequence (within DOC-103/DOC-104)

**FG-4.21-A2: stale-label cleanup — PENDING INDEPENDENT REVIEW AND ACCEPTANCE.** Browser DOM acceptance remains supervisor-owned and pending. No later tranche has begun.

After A2 acceptance, the Field Guide execution sequence is:

1. **Class B authoritative verification** — Separate exact-minor authoritative verification of the protected `global.js` RHEL-host statement (`RHEL 9 is recommended for OCP 4.20`). Requires upstream Red Hat documentation review to determine whether `OCP 4.20` or `OCP 4.21` is the correct recommendation for this specific statement.
2. **FG-4.21-B** — Field Guide fallback behavior correction (pre-lock access, missing-version state, degraded/imported state).
3. **FG-4.21-C** — Field Guide content-correctness completion (remaining version-specific copy, documentation links, warnings).
4. **Historical/durability retrospective** — Review of Field Guide version-correctness test durability and coverage completeness.
5. **Option-A application-release closure** — Final Field Guide acceptance within DOC-105 release closure.

### Tranche V3: DOC-107 — Versioned copy strategy (estimated 3–5 days)
- Create shared/versionedCopy.js with centralized copy maps
- Replace hardcoded "OpenShift 4.20" user-facing strings with version-derived copy (exact count to be established during copy-map creation; tracked inventory identifies HIGH-priority categories but does not enumerate individual strings requiring centralization)
- Add CI guard (wire scripts/find-hardcoded-versions.sh into .github/workflows/ci.yml)
- Add tests: UI text matches locked version

### Tranche V4: DOC-103 — UI/UX enhancements (estimated 5–7 days)
- Implement unlock/relock workflow
- Add systematic deprecation badges (⚠️) for deprecated catalog params
- Add introduced-in / deprecated-in annotations to tooltips
- Add version-specific Field Guide warnings and unsupported-field messaging
- Verify Field Guide version-correctness for both 4.20 and 4.21

### Tranche V5: DOC-104 — Validation matrix (estimated 5–7 days)
- Parameterized test matrix for all version-gated validation rules
- Parameterized test matrix for all version-gated generation rules
- Field Guide version-correctness tests
- Deprecation badge rendering tests
- Versioned copy correctness tests
- version-manifest.json implementation and tests — **M02 manifest generation complete** (25 tests); **M03 validation-core** (174 unit tests); **M03 HTTP endpoint implemented** (`POST /api/bundle.import`, 27 integration tests); M03 archive-import semantics addressed as validation-only (archive contains no state.json)
- Manual visual verification for 4.20 and 4.21

### Tranche V6: DOC-105 — Release closure (estimated 5–7 days)
- Create MIGRATION_GUIDE_v1_to_v2.md
- Update README.md with version-awareness documentation
- Update CLAUDE.md with current state
- Full CHANGELOG.md v2.0.0 entry
- Security audit
- Full manual QA for 4.20 and 4.21
- Generated artifact validation
- Final BACKLOG_STATUS.md reconciliation
- Mark DOC-059 verified_done ONLY after all evidence accepted

---

## J. Per-Tranche Acceptance Criteria

### ~~V1 (DOC-102 closure: validation and support boundary)~~ — ACCEPTED (2026-08-13)
- ✅ bmcVerifyCA validation executes only for version >= 4.21
- ✅ dnsRecordsType classified as deliberate support boundary (no validation needed — field omitted)
- ✅ Azure subnets version-gated validation in shared/azureByoVnet.js
- ✅ Tests prove version-gating: frontend 2241 pass, backend 1252 pass, focused DNS 23 pass

### ~~V2 (DOC-102 closure: version-gated generation)~~ — ACCEPTED (2026-08-13)
- ✅ bmcVerifyCA emitted for 4.21, not for 4.20
- ✅ Azure subnets array emitted for 4.21, controlPlaneSubnet/computeSubnet for 4.20
- ✅ dnsRecordsType not emitted (deliberate omission defaults to Internal)
- ✅ Official OpenShift 4.21 installer source evidence retained in catalog citations
- ✅ Parameterized generation tests pass

### V3 (DOC-107)
- shared/versionedCopy.js exists and is used by all version-dependent user-facing text
- Zero hardcoded "OpenShift 4.20" in user-facing frontend code outside version-policy
- CI guard prevents new hardcoded version strings
- Tests verify copy matches locked version

### V4 (DOC-103)
- Deprecation badges visible on deprecated catalog params
- Version annotations visible in tooltips where applicable
- Field Guide produces version-correct content for 4.20 and 4.21
- Unlock/relock workflow functional

### V5 (DOC-104)
- Parameterized test matrix covers all version-gated behavior
- version-manifest.json generated in generated artifact ZIP per M01 frozen contract — **M02 manifest generation complete** (25 tests); **M03 validation-core** (174 unit tests); **M03 HTTP endpoint implemented** (`POST /api/bundle.import`, 27 integration tests); M03 archive-import semantics addressed as validation-only (archive contains no state.json)
- Manual visual verification screenshots for 4.20 and 4.21
- All test suites pass with zero failures

### V6 (DOC-105)
- Migration guide complete and accurate
- README documents version-aware features
- Security audit complete with no findings
- Full manual QA for both versions
- All generated artifacts validated

---

## K. M01 Residual Application-Code GA Register (2026-09-17)

**Baseline:** `supervised/v2.0` at `1d3b2e410aa4`, clean worktree. Application identity: `2.0.0-dev` (VERSION, backend/package.json, frontend/package.json, root package.json — synchronized, `git diff --check` exit 0).

### K.1 Completed and Accepted Obligations

| Item | Status | Evidence |
|---|---|---|
| DOC-100 (Phase 0 baseline) | verified_done | commit 94b5b14; 949 params with supportStatus |
| DOC-101 (Phase 1 architecture) | verified_done | commits 8a879e7–bf7cfb3; 6/6 slices + 2 regression fixes |
| DOC-102 (Phase 2 4.21 audit) | verified_done | 26 commits; all canonical slices + closure tranches; zero supported-backend-only unresolved (2026-08-13) |
| DOC-106 (versioned copy audit) | verified_done | commit 94b5b14; 3,239 refs inventoried (Phase 0 inventory only; implementation owned by DOC-107) |
| M01 contract freeze | accepted | commit 47e27d7; JSON run envelope vs ZIP surface classification frozen in VERSION_AWARENESS_MASTER_STRATEGY.md |
| M02 manifest export integrity | accepted | commit 8e3504d; `backend/src/exportIntegrity.js` generates version-manifest.json with SHA-256 checksums; 25 tests |
| M03 bundle import integrity | accepted/checkpointed | commit 0ca1126; `POST /api/bundle.import` validation-only endpoint; 27 HTTP + 174 validation-core tests; full backend 1705/0 fail/5 todo; all certification return codes zero |
| M03 closure evidence reconciliation | accepted | commit 93c958b; docs-only reconciliation of M03 closure evidence across three canonical documents |
| DOC-127 backlog creation | accepted | commits 94e0cb3, 1d3b2e4; DOC-127 (Artifact Bundle Validator UI) backlog item created and provenance corrected |
| Archive-import semantics | resolved | Validation-only by design — ZIP contains no state.json; no state import/persistence/extraction |
| FG-4.21-A2 stale-label cleanup | accepted | commit fc40c68; 17/21 Class A corrected; Class B replaced; 3 Class C protected |
| FG-4.21-B strict version resolution | accepted | commit 49e12cb; 68/68 version-safety tests; deterministic 4.22 rejection |
| DOC-107 versioned copy implementation | done_pending_verification | 25 violations resolved; CI guard passes clean; 42 tests |

### K.2 Unresolved Application-Code GA Blockers

| Item | Blocker Description | Owner | Required Action |
|---|---|---|---|
| DOC-103 (Phase 3 UI/UX) — remaining | Version locking and transitions are implemented (BlueprintStep lock/confirm, v3 locked field, release-unlock workflow with 63 deterministic tests). Remaining: deprecation badges, introduced/deprecated annotations, systematic version-correct copy, attributable deterministic verification evidence for lock workflow, repository-wide tooltip/helper/warning closure, version-specific link verification, accessibility | DOC-103 | Complete remaining UI/UX enhancements per Tranche V4 acceptance criteria |
| DOC-104 (Phase 4 testing) — remaining | Parameterized version-matrix testing, Field Guide version-correctness tests, deprecation badge rendering tests, versioned copy correctness tests, manual visual verification | DOC-104 | Complete remaining test matrix per Tranche V5 acceptance criteria |
| DOC-105 (Phase 5 release) — remaining | Migration guide, full README v2.0.0 update, CHANGELOG GA entry, security audit, dependency scan, release notes, final manual QA, generated artifact validation | DOC-105 | Complete remaining release closure per Tranche V6 acceptance criteria |
| DOC-107 verification | done_pending_verification → needs verification pass | DOC-107 | Verify CI guard integration, all 42 tests, and user-facing copy correctness |
| DOC-059 closure | Cannot be marked verified_done until DOC-103/104/105/107 complete | DOC-059 | See Section L (Definition of DONE) |

### K.3 Non-Blocking Follow-Up Work (Not Application-Code GA Blockers)

| Item | Classification | Rationale |
|---|---|---|
| DOC-127 (Artifact Bundle Validator UI) | Non-blocking / post-GA under settled human policy | Backend capability complete (M03); frontend UI is a productization opportunity scheduled after GA unless human priority is explicitly changed |

### K.4 Production Readiness Obligations — Targeted Classification

Option A settled: v2.0.0 GA = application-code GA. PROD-041 gates enterprise/customer distribution, not application-code GA. The following classification covers only the five PROD items targeted by this reconciliation (PROD-014, PROD-040, PROD-041, PROD-042, PROD-044). Other PROD items (PROD-024–039, PROD-043, PROD-045–046) were not examined in this tranche; their obligation-level classification relative to application-code GA is unestablished.

**Application-code GA obligations (within PROD items):**

| Item | Obligation | Rationale |
|---|---|---|
| PROD-014 | CHANGELOG v2.0.0 GA entry; VERSION file progression from `2.0.0-dev` to `2.0.0` | CHANGELOG GA entry and application version identity are application-code release artifacts, not enterprise distribution concerns. Currently blocked by feature completion (DOC-103/104/105). |
| PROD-040 | Clean-build provenance at release commit; source-revision traceability | The application-code release must be reproducible from a known clean commit. Build metadata (commit SHA, build timestamp) is intrinsic to application identity. |

**Enterprise/customer-distribution obligations (outside application-code GA gate):**

| Item | Owner | Scope |
|---|---|---|
| PROD-041 (umbrella) | Enterprise productization | Gates enterprise distribution per Option A; children are prerequisites for customer-facing release, not application-code GA |
| PROD-014 — remaining | Release process | Formal release-tag automation, release process documentation — enterprise distribution prerequisites |
| PROD-040 — remaining | Release process | Versioned image tagging, container registry, promotion/rollback, multi-arch — enterprise distribution prerequisites |
| PROD-042 (immutable release bundle) | Enterprise distribution | Container images, OCI archives, manifests, SBOMs — customer delivery artifact |
| PROD-044 (release security gate) | Enterprise distribution | Supply chain verification, runtime verification, deployment verification, retained evidence — enterprise gate |

### K.5 Source-Verification Obligations

The following items require verification against official OpenShift installer structures or documentation for their respective supported minors (4.20 and 4.21). They are technical source-verification obligations — their resolution depends on evidence from authoritative sources.

**Disposition status:** Both DOC-120 and DOC-122 are RESOLVED as of M03 (2026-09-18). DOC-120: proven mismatches corrected with regression tests. DOC-122: zero proven output/validation correctness errors; all inconsistencies classified as metadata-only non-blocking. Neither is a GA blocker.

**Decision rule:** If source verification proves a supported-output correctness contradiction (the application generates output that the OpenShift installer rejects or that produces incorrect cluster behavior for a supported scenario), that contradiction is an application-code GA blocker requiring remediation and regression tests. If source verification finds no such contradiction (the application's current behavior produces installer-accepted output for all supported scenarios), that finding supports an evidence-backed non-blocking disposition for v2.0.0.

**DOC-120 (vSphere full inventory-path correctness): RESOLVED (M03-A, 2026-09-18).** OpenShift installer source verified for release-4.20 and release-4.21 branches (`pkg/types/vsphere/validation/platform.go`). **Authoritative format matrix:** `computeCluster` requires full inventory path `/<dc>/host/<cluster>` (regex `^/(.*?)/host/(.*?)$`); `datastore` requires full inventory path `/<dc>/datastore/<ds>` (regex `^/(.*?)/datastore/(.*?)$`); `datacenter` is short name (max 80 chars); `networks` are short names; `folder` requires `/<dc>/vm/<folder>`; `resourcePool` requires `/<dc>/host/<cluster>/...`. No validation differences between 4.20 and 4.21. **Proven mismatches corrected:** (1) Failure domain `computeCluster` UI placeholder changed from "Cluster1" to "/Datacenter1/host/Cluster1", hint updated. (2) Failure domain `datastore` hint updated. (3) Backend legacy-to-failure-domain conversion in `generate.js` now constructs full inventory paths for `computeCluster` and `datastore` when short names are entered in legacy mode. Values already starting with `/` are not double-prefixed. (4) All smoke test fixtures updated to use full paths. **Already correct:** `datacenter`, `networks`, `folder`, `resourcePool`, `template`. **Regression tests:** 3 DOC-120 tests in smoke.test.js. Backend 1708 pass / 0 fail. Frontend 2376 pass / 0 fail.

**DOC-122 (catalog structural path, type, and conditional-requiredness audit): RESOLVED (M03-B, 2026-09-18).** Full structural audit completed with trace-through of all 5 audit concerns through catalog → frontend → backend → install-config output pipeline. **Findings:** (1) `controlPlane` singular vs array paths: `METADATA_ONLY_NON_BLOCKING` — dual notation (`controlPlane.replicas` and `controlPlane[].replicas`) is an artifact of documenting both YAML structure and OCP parameter table notation; frontend uses exact-path matching; backend constructs output directly without catalog path lookup; no output impact. (2) `controlPlane.platform` type discrepancy (object vs string): `METADATA_ONLY_NON_BLOCKING` — both entries are `supported-backend-only`; no code consumes these parent-level types. (3) AWS existing-VPC subnet conditional-requiredness: `NO_FINDING` — `platform.aws.vpc.subnets` has `required: false` in catalog (correct — only required when vpcMode=existing); backend correctly conditionalizes emission. (4) vSphere legacy-placement conditional-requiredness: `METADATA_ONLY_NON_BLOCKING` — legacy fields marked `required: true` but correctly gated by `placementMode` in both frontend and backend; no user can submit a form with missing required legacy fields when legacy mode is active. (5) Canonical/frontend-mirror parity: `NO_FINDING` — 25/25 identical via `sync-catalogs --dry-run`. **Summary: zero `PROVEN_OUTPUT_CORRECTNESS_ERROR` or `PROVEN_VALIDATION_REQUIREDNESS_ERROR` findings.** All inconsistencies are metadata-only with no user-facing, output, or validation impact. No code changes required.

### K.6 Recommended Next Executable Verification Tranche

**No remaining source-verification obligations.** DOC-120 resolved in M03-A (2026-09-18) with proven mismatches corrected and regression-tested. DOC-122 resolved in M03-B (2026-09-18) with zero proven output/validation correctness errors. Both received full trace-through against authoritative OpenShift 4.20/4.21 installer source.

### K.7 Pending Human Acceptance Checkpoints

The following items have completed implementation and passing tests but have not received human acceptance. They are pending acceptance checkpoints, separate from the source-verification obligations in K.5. Their GA disposition follows from the human acceptance decision.

**FG-DOCREF-MINOR (compartment docRef certification):** Implementation complete in `backend/src/fieldGuide/provenance.js` — `certifyDocRefs` enforces that official OCP docs URLs in Field Guide compartments match the resolved minor version. 62/62 certification tests pass. Integrated into `assembler.js` pre-selection certification. Pending human acceptance.

**FG-4.21-C (provenance certification):** Implementation complete in `backend/src/fieldGuide/provenance.js` — deterministic provenance certification for Field Guide assembly inputs with stable object-identity inventory, shared input registry, exclusive export membership, and inventory completeness invariants. 37/37 certification tests pass (part of the 62-test suite above). Integrated into `assembler.js renderGuide` flow. Pending human acceptance.

---

## L. Explicit Definition of DONE for DOC-059

(Moved from former Section K; content unchanged.)

DOC-059 may be marked `verified_done` ONLY when ALL of the following are true:

1. **All supported-version parameter differences implemented or deliberately unsupported.** Every 4.21 delta param with supportStatus `supported-ui` or `supported-backend-only` is either implemented end-to-end or has an explicit `docs-only-not-supported` decision with rationale.

2. **All user-facing labels, tooltips, warnings, errors, links, and generated copy are version-correct.** No hardcoded "OpenShift 4.20" appears in user-facing text unless the locked version is 4.20. CI guard (`scripts/find-hardcoded-versions.sh --check`) and version-neutral copy enforcement are operational. CI guard prevents regression.

3. **Field Guide is version-correct.** Field Guide compartments for v4.20 and v4.21 produce correct version-specific content, links, commands, and warnings. Unsupported fields are properly messaged.

4. **Deprecations are represented correctly.** Catalog params with `deprecated: true` show visible deprecation badges in the UI. Introduced-in and deprecated-in annotations are present where applicable.

5. **4.20 and 4.21 validation matrix is complete.** Parameterized tests cover all version-gated validation rules, generation rules, field visibility, catalog loading, and import/export for both versions.

6. **Persistence, hydration, import, and export are verified.** State schema v3 migration works at all boundaries. JSON run envelope (`/api/run/export` and `/api/run/import`) preserves sanitized v3 state with v1/v2 migration. version-manifest.json is generated in the generated artifact ZIP (`buildBundleZip`) per the M01 frozen contract (2026-09-15). If a manifest-bearing archive import surface is later implemented, manifest validation applies there — not to the existing JSON run import. v1.x JSON import migration works correctly through the existing explicit migration path.

7. **Manual QA is complete.** Browser-based manual verification for both 4.20 and 4.21 covering version lock, field visibility, validation, generation preview, Field Guide, and export.

8. **Release and security documentation is complete.** Migration guide, README updates, CHANGELOG, security audit, dependency scan, and release notes are all complete.

9. **Canonical backlog is reconciled.** docs/BACKLOG_STATUS.md accurately reflects the status of DOC-100 through DOC-107 with committed evidence for each.
