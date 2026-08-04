# Version-Awareness Completion Matrix

**Created:** 2026-08-03
**Parent:** DOC-059 (OpenShift version-aware system v2.0.0)
**Branch:** develop
**HEAD:** 289b8794aa9e6b3f13319a9c837bac1d540d2145
**Canonical status authority:** docs/BACKLOG_STATUS.md

---

## A. Executive Status

**DOC-059: INCOMPLETE — active, not done**

Version-awareness foundation is strong but multiple workstreams remain open. Phase 0 (DOC-100) and Phase 1 (DOC-101) are verified_done. Phase 2 (DOC-102) is partially complete with Slices 5A–5H closed; two concrete tranches remain: Slice 5I (version-aware validation for bmcVerifyCA, dnsRecordsType, Azure subnets, OnPremDNSRecords/loadBalancer dependency investigation) and Slice 5J (version-aware backend generation for remaining 4.21 supported-backend-only params including Azure subnets). Phase 3 (DOC-103) is active / partial — version locking, version-aware UI controls, version-aware UI registry (catalogFieldMeta.js), and browser verification are implemented, but version-specific tooltips, deprecation badges, introduced/deprecated annotations, and systematic version-correct copy are not. Phase 4 (DOC-104) is active / partial — migration tests, catalog tests, visibility tests, validation tests, and generation tests exist for implemented features, but parameterized version-matrix testing, Field Guide version-correctness tests, and version-manifest.json tests are not started. Phase 5 (DOC-105) is active / partial — ADRs (ADR-001 through ADR-007), Design System documentation, version-aware UI checklist, and roadmap governance exist, but migration guide, README v2.0.0 update, CHANGELOG, security audit, and release notes are not created. DOC-107 (versioned copy strategy implementation): centralized copy system not started, field-specific user-facing copy partial, repository-wide remediation incomplete, CI hardcoded-version enforcement not started. DOC-106 (versioned copy audit) is verified_done at the Phase 0 inventory level; its original implementation conclusion is superseded by current evidence — implementation remains owned by DOC-107 and related DOC-103/DOC-104 acceptance work.

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
| Accepted completed DOC-102 slices and post-Slice-5H work | Slice 5A: commit e65e6ee. Slice 5B: commit bad31e3. Slice 5D: commit 1f3b2e5. Slice 5F: commit 312cb3c. Slice 5G: catalogFieldMeta corrections (no single commit — metadata-only corrections). Slice 5H: 14 commits e939a41 through 063fcc5. Accepted post-5H: AWS throughput (commits 19200ae, 3f6e257, 137db15), Azure allowSharedKeyAccess (commit 8fd2fe1), AWS confidential compute (commits ee476c8 through 289b8794), version-aware field presentation (commits 310c0c8, e23e460, ea60f9bd, 2193e729), version-aware UI standards (commits 2f9d922, 53b355a, linear chain). All SHAs verified via `git show -s`. Slices 5I (validation) and 5J (generation) remain active. | verified_done (5A–5H + post-5H); active (5I–5J) |
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
| **platform.baremetal.bmcVerifyCA** | supported-backend-only, minVersion=4.21 (3 catalogs) | ❌ No UI control | ❌ None | ❌ None | ❌ Not emitted | N/A | N/A | ❌ Not covered | ❌ None | ❌ None | Slice 5I/5J |
| **platform.baremetal.dnsRecordsType** | supported-backend-only, minVersion=4.21 (3 catalogs) | ❌ No UI control | ❌ None | ❌ None | ❌ Not emitted | N/A | N/A | ❌ Not covered | ❌ None | ❌ None | Slice 5I/5J |
| **platform.azure.subnets** | supported-backend-only, minVersion=4.21 (2 catalogs) | ❌ No UI control | ❌ None | ❌ None | ❌ Not emitted (noted in Slice 5J acceptance criteria) | N/A | N/A | ❌ Not covered | ❌ None | ❌ None | Slice 5J |
| **platform.azure.subnets.name** | supported-backend-only, minVersion=4.21 (2 catalogs) | ❌ No UI control | ❌ None | ❌ None | ❌ Not emitted | N/A | N/A | ❌ Not covered | ❌ None | ❌ None | Slice 5J |
| **platform.azure.subnets.role** | supported-backend-only, minVersion=4.21 (2 catalogs) | ❌ No UI control | ❌ None | ❌ None | ❌ Not emitted | N/A | N/A | ❌ Not covered | ❌ None | ❌ None | Slice 5J |
| **platform.nutanix.dnsRecordsType** | supported-backend-only, minVersion=4.21 (1 catalog) | ❌ No UI control | ❌ None | ❌ None | ❌ Not emitted | N/A | N/A | ❌ Not covered | ❌ None | ❌ None | Slice 5I/5J |
| **platform.vsphere.dnsRecordsType** | supported-backend-only, minVersion=4.21 (3 catalogs) | ❌ No UI control | ❌ None | ❌ None | ❌ Not emitted | N/A | N/A | ❌ Not covered | ❌ None | ❌ None | Slice 5I/5J |

### Remaining DOC-102 Slices

**Slice 5I — Version-aware validation rules:**
- Version-gated validation for bmcVerifyCA (supportStatus: supported-backend-only, minVersion: 4.21; present in 3 bare-metal catalogs: bare-metal-agent, bare-metal-ipi, bare-metal-upi). **Evidence disposition:** catalog inventory: complete (3 catalogs, supportStatus/minVersion verified); catalog-declared representation: string with a PEM-content description; absence from the application's 4.20 catalogs: established; authoritative OpenShift 4.21 installer representation: unresolved (requires inspection of openshift/installer release-4.21 pkg/types/baremetal/platform.go); authoritative validation and generation behavior: unresolved; frontend/backend implementation: not authorized until the authoritative source audit is accepted. **Next action:** inspect the pinned OpenShift installer release-4.21 source, record the exact Go type, validation, generation path, scenarios, and omission/default semantics
- Version-gated validation for dnsRecordsType (supportStatus: supported-backend-only, minVersion: 4.21; present in 7 catalog entries total: 3 bare-metal [bare-metal-agent, bare-metal-ipi, bare-metal-upi] + 3 vSphere [vsphere-agent, vsphere-ipi, vsphere-upi] + 1 Nutanix [nutanix-ipi]). **Evidence disposition:** catalog inventory: complete (7 entries across 3 platforms, catalog-declared enum Internal/External and dependency constraints documented); catalog-declared representation: enum with Internal/External values, External mode references OnPremDNSRecords feature gate and loadBalancer.type=UserManaged; absence from the application's 4.20 catalogs: established; authoritative OpenShift 4.21 installer representation: unresolved (enum values, dependency constraints, and External-mode prerequisites require verification against upstream installer source); authoritative validation and generation behavior: unresolved; frontend/backend implementation: not authorized until the authoritative source audit is accepted
- Version-gated validation for Azure subnets (supportStatus: supported-backend-only, minVersion: 4.21; platform.azure.subnets.name and platform.azure.subnets.role in 2 catalogs: azure-government-ipi, azure-government-upi; conditional on BYO VNet). **Evidence disposition:** catalog inventory: complete (2 catalogs, both Azure Government, name/role fields documented); catalog-declared representation: nested object with name and role fields; absence from the application's 4.20 catalogs: established; authoritative OpenShift 4.21 installer representation: unresolved (exact YAML structure for subnets array requires verification against openshift/installer release-4.21 — do not infer from catalog path names); authoritative validation and generation behavior: unresolved; frontend/backend implementation: not authorized until the authoritative source audit is accepted
- OnPremDNSRecords feature-gate dependency investigation (referenced in dnsRecordsType catalog notes as prerequisite for External mode; present in 7 catalogs matching dnsRecordsType distribution). **Evidence disposition:** catalog inventory: complete (7 catalogs, feature gate reference documented); catalog-declared representation: feature gate required for dnsRecordsType=External; absence from the application's 4.20 catalogs: established; authoritative OpenShift 4.21 installer representation: unresolved (feature gate enablement mechanism and interaction with dnsRecordsType=External not verified against upstream installer); authoritative validation and generation behavior: unresolved; frontend/backend implementation: not authorized until the authoritative source audit is accepted
- loadBalancer.type=UserManaged dependency investigation (referenced in dnsRecordsType catalog notes as prerequisite for External mode; loadBalancer entries present in 7 catalogs: 3 bare-metal + 3 vSphere + 1 Nutanix; not a separate catalog parameter path — it is a dependency constraint on dnsRecordsType behavior). **Evidence disposition:** catalog inventory: complete (7 catalogs, loadBalancer.type entries with UserManaged value documented); catalog-declared representation: dependency constraint on dnsRecordsType=External behavior; absence from the application's 4.20 catalogs: established; authoritative OpenShift 4.21 installer representation: unresolved (interaction between loadBalancer.type=UserManaged and dnsRecordsType=External not verified against upstream installer); authoritative validation and generation behavior: unresolved; frontend/backend implementation: not authorized until the authoritative source audit is accepted

**Slice 5J — Version-aware backend generation:**
- Generation logic for all remaining 4.21-only supported-backend-only params
- platform.azure.subnets.name and platform.azure.subnets.role generation (per DOC-102 acceptance criteria)
- Parameterized backend generation tests for 4.20 and 4.21
- Prove 4.21-only structure is not emitted for 4.20

### 4.21 supported-ui Params — Production Control Mapping

All 4 supported-ui minVersion=4.21 params have verified production controls:

| Param | Frontend Control | File |
|---|---|---|
| controlPlane.platform.aws.rootVolume.throughput | Numeric input with 125–2000 range | PlatformSpecificsStep.jsx |
| controlPlane.platform.aws.cpuOptions.confidentialCompute | Select dropdown (Use default / Disabled) | PlatformSpecificsStep.jsx |
| platform.azure.allowSharedKeyAccess (IPI) | Select dropdown (true / false / not set) | PlatformSpecificsStep.jsx |
| platform.azure.allowSharedKeyAccess (UPI) | Select dropdown (true / false / not set) | PlatformSpecificsStep.jsx |

---

## D. Remaining DOC-106 and DOC-107 Copy Work

### DOC-106 Status: verified_done (Phase 0 inventory only)

The inventory phase is complete. 3,239 hardcoded version references were catalogued in `versioned-copy-audit-results/` and classified in `docs/VERSIONED_COPY_INVENTORY.md`.

### DOC-107 Status: active — centralized not started; field-specific partial; repository-wide incomplete; CI enforcement not started

**Centralized copy system — not started:**
1. ❌ `shared/versionedCopy.js` or equivalent centralized copy map — does not exist
2. ❌ Template interpolation helpers (getCopyForVersion) — do not exist
3. ❌ Catalog/parameter-derived copy system — not implemented as centralized facility
4. ❌ Locked-version-derived copy — not implemented as centralized facility
5. ❌ CI hardcoded-version guard — `scripts/find-hardcoded-versions.sh` exists but is not wired into CI

**Field-specific user-facing copy — partial:** Azure shared-key warning/helper text, confidential-compute compatibility guidance, catalog-derived descriptions as hint text, v4.20/v4.21 Field Guide prose exist and work correctly without a centralized system.

**Repository-wide remediation — incomplete:** 3,239 hardcoded version references inventoried (DOC-106); exact count needing centralization not yet established.

**CI hardcoded-version enforcement — not started:** `scripts/find-hardcoded-versions.sh` exists but is not wired into CI.

**Ad hoc version-aware behavior already present (not copy):** Version-gated validation rules, conditional control rendering, and catalog-driven field visibility exist but are code behaviors, not user-facing copy. "Root volume throughput (MiB/s)" appearing only for 4.21 is visibility behavior (control presence/absence), not copy. Examples of actual version-aware user-facing copy: catalog descriptions from versioned catalogs appearing as hint text, Azure shared-key warning/helper text, confidential-compute compatibility guidance, Field Guide content directories producing version-specific prose (v4.20/ vs v4.21/). These work correctly without a centralized copy system. DOC-107 owns the centralized system; these existing behaviors are not DOC-107 deliverables.

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

**DOC-103 status: active / partial** — not "NOT STARTED". Implemented evidence: version locking (BlueprintStep lock/confirm, v3 locked field), version-aware UI controls (PlatformSpecificsStep version-gated controls for 4 supported-ui params), version-aware UI registry (catalogFieldMeta.js isCatalogFieldVisible with supportStatus check), browser verification (DOC-101 verification session). Remaining: version-specific tooltips, deprecation badges, introduced/deprecated annotations, systematic version-correct copy, Field Guide version-correctness verification, unlock/relock workflow.

| Component | Status | Evidence |
|---|---|---|
| Version lock UI | IMPLEMENTED_UNVERIFIED | BlueprintStep has lock/confirm workflow; v3 locked field set |
| Unlock and relock workflow | PARTIAL | Lock exists; explicit unlock/relock flow not implemented |
| Version-specific tooltips | PARTIAL | 4.21 supported-ui params (throughput, confidentialCompute, allowSharedKeyAccess) have tooltips; catalog descriptions from versioned catalogs feed into hint text for IBM Cloud fields. Not done: systematic version annotations ("introduced in 4.21"), deprecation notices in tooltips, version-specific warning text |
| Version-neutral labels | PARTIAL | Some labels use locked-version helper; exact count of hardcoded "OpenShift 4.20" not established by current tracked evidence |
| Warnings and helper text | PARTIAL | Unsupported-version recovery UI exists; version-specific warnings not systematically implemented |
| Validation messages | PARTIAL | Some use isVersionGTE; no centralized version-aware message system |
| Deprecation badges | PARTIAL | vSphere legacy placement has deprecation text; no systematic deprecation badges |
| Introduced/deprecated annotations | NOT_STARTED | Catalog has deprecated field; UI does not render introduced-in or deprecated-in annotations |
| Field Guide version selection | SUPERSEDED_BY_LOCKED_VERSION_SELECTION | assembler.js `SUPPORTED_VERSIONS = ["4.20", "4.21"]`, `getCompartmentsForVersion()` selects v4.20/ or v4.21/ content directory based on locked version. No independent version-selector control exists — the Field Guide derives its content version from the locked blueprint version via context.js. An independent selector is not needed and was never implemented. |
| Field Guide locked-version behavior | IMPLEMENTED — state-derived; fallback gap open | context.js `getOpenShiftMinorFromSources(release, state.version)` derives version from state via 6-source resolution chain (selectedMinor → channel → selectedPatch → release.patchVersion → selectedVersion → release.selectedVersion). Falls back to "4.20" if all sources return null. **Fallback classification: REACHABLE_STALE_VERSION_RISK.** The fallback is reachable before version lock (user navigates to Field Guide pre-lock) or with degraded/imported state where version fields are absent. When reached, Field Guide silently serves 4.20 content regardless of user intent. After a successful version lock, `state.version.selectedMinor` is populated and the fallback is not reached. Locked-version Field Guide behavior is not fully verified while this fallback gap is open. **Required resolution:** Either block Field Guide generation with a clear version-selection message when no canonical locked version exists, or derive only from valid canonical version state. Never silently default user-facing output to 4.20. |
| Field Guide stale content | 16 STALE REFS in v4.21 | 16 references to "OCP 4.20" or "OpenShift 4.20" found in v4.21 Field Guide content files (verified by `grep -rn` against backend/src/fieldGuide/v4.21/): ibmcloud.js:5, nutanix.js:5, nutanix.js:26, azure.js:5, aws.js:5, aws.js:29, aws.js:35, baremetal.js:5, baremetal.js:110, baremetal.js:172, mirror.js:4, vsphere.js:27, global.js:4, global.js:19, global.js:23, global.js:162. Categories: JSDoc module headers (7: ibmcloud, nutanix, azure, aws, baremetal, mirror, global), user-facing command text (5: nutanix:26, aws:29, aws:35, baremetal:110, baremetal:172), user-facing prose (2: vsphere:27, global:23), documentation link labels (2: global:19, global:162). These should reference "OCP 4.21" or use version-derived copy. |
| Field Guide parameter filtering | PARTIAL | Catalog-driven but no supportStatus-based filtering in Field Guide generation |
| Version-specific documentation links | IMPLEMENTED_UNVERIFIED | docsIndexResolver.js maps versions to docs-index files; v4.20 and v4.21 exist |
| Accessibility | NOT_STARTED | No version-awareness-specific a11y work |
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
| Warnings and unsupported-field messaging | ❌ NOT IMPLEMENTED |
| Introduced/deprecated annotations in content | ❌ NOT IMPLEMENTED |
| v4.21 content version-correctness | ❌ 16 stale "OCP 4.20" refs in v4.21 content (see stale content row in table above for exact file:line list) |

---

## F. Remaining DOC-104 Validation Work

**DOC-104 status: active / partial** — not "NOT STARTED". Implemented evidence: migration tests (v1→v3 state schema migration), catalog tests (catalog loading and mirror identity verification), visibility tests (isCatalogFieldVisible with supportStatus), validation tests (version-gated validation for throughput, confidentialCompute, allowSharedKeyAccess), generation tests (version-gated generation with isVersionGTE guards). Remaining: parameterized version-matrix testing across all version-gated behavior, Field Guide version-correctness tests, version-manifest.json tests, deprecation badge rendering tests, versioned copy correctness tests.

### Historical Test Baseline (from confidential-compute tranche, HEAD 289b8794)

These totals are historical evidence from the already-pushed confidential-compute tranche at commit 289b8794aa9e6b3f13319a9c837bac1d540d2145. This documentation session did not run test suites and did not certify a new test baseline.

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
| Frontend validation | ✅ ~300+ validation tests | ✅ Version-gated rules tested | bmcVerifyCA, dnsRecordsType, Azure subnets NOT tested |
| Backend validation | ✅ Schema validation | ✅ Throughput + confidentialCompute | bmcVerifyCA, dnsRecordsType NOT tested |
| Generation | ✅ ~200+ generation tests | ✅ 4.21-specific generation tested | Remaining 4.21 backend-only params NOT generated |
| Stale-state suppression | ✅ Unknown schema blocked | ✅ Unsupported version recovery | Adequate |
| Persistence | ✅ State save/load tests | ✅ v3 migration-before-persist | Adequate |
| Hydration | ✅ Frontend hydration tests | ✅ Slice 6 v3 preservation | Adequate |
| Import | ✅ Import tests exist | ✅ v1→v3 migration tested | Version-manifest validation NOT tested |
| Export | ✅ Export tests exist | ❌ version-manifest.json NOT implemented | Critical gap |
| HTTP boundaries | ✅ API state migration boundary | ✅ 6 hermetic tests | Adequate |
| Field Guide | Minimal | ❌ No version-correctness tests | Critical gap |
| Tooltips and copy | ✅ hint-syntax.test.js | ❌ No version-correctness tests | Gap |
| Deprecations | ❌ No deprecation-badge tests | ❌ Not implemented | Blocked by DOC-103 |
| E2E | ✅ 12 Playwright tests | ❌ No version-matrix E2E | Gap |
| Manual visual verification | ✅ Browser verification (DOC-101) | ❌ No DOC-102/103 visual verification | Gap |

---

## G. Remaining DOC-105 Release Work

**DOC-105 status: active / partial** — not "NOT STARTED". Implemented evidence: ADRs (ADR-001 through ADR-007 exist in docs/), Design System documentation (docs/DESIGN_SYSTEM.md), version-aware UI field checklist (docs/VERSION_AWARE_UI_FIELD_CHECKLIST.md), roadmap governance (docs/IMPLEMENTATION_ROADMAP_2026-05-14.md, continuously maintained). Remaining: migration guide (v1→v2), README v2.0.0 update, CHANGELOG v2.0.0 entry, security audit, dependency scan, release notes, manual QA, generated artifact validation.

| Artifact | Status | Gap |
|---|---|---|
| Migration guide (v1→v2) | ❌ NOT CREATED | Blocked by DOC-102/103/104 completion |
| README update | ❌ NOT UPDATED for v2.0.0 | Blocked by feature completion |
| ADRs | ✅ ADR-001 through ADR-007 exist | May need post-implementation updates |
| BACKLOG_STATUS update | ✅ Continuously maintained | Final DOC-059 closure update pending |
| Implementation roadmap | ✅ Maintained but stale (last updated 2026-05-29) | Needs v2.0.0 progress update |
| CHANGELOG | ❌ No v2.0.0 entry | Blocked by release |
| Security audit | ❌ NOT PERFORMED for v2.0.0 | Requires complete feature set |
| Dependency scan | ❌ Not run for v2.0.0 | Requires pre-release execution |
| Manual QA (4.20) | PARTIAL (DOC-101 browser verification) | Full QA cycle not performed |
| Manual QA (4.21) | PARTIAL (DOC-101 browser verification) | Full QA cycle not performed |
| 4.20 generated artifacts validation | ❌ NOT PERFORMED | Requires generation tests |
| 4.21 generated artifacts validation | ❌ NOT PERFORMED | Requires generation tests |
| Release versioning | ❌ VERSION file not updated to 2.0.0 | At release time |
| Release notes | ❌ NOT CREATED | At release time |
| Upgrade guidance | ❌ NOT CREATED | Blocked by migration guide |
| Import compatibility | PARTIAL (v1→v3 migration exists) | version-manifest.json not implemented |

---

## H. Dependency Graph

```
DOC-100 (Phase 0) ─────────────── ✅ DONE
    │
DOC-101 (Phase 1) ─────────────── ✅ DONE
    │
DOC-102 (Phase 2) ─── Slices 5A-5H ✅ DONE
    │                  Slice 5I ⏳ (validation)
    │                  Slice 5J ⏳ (generation)
    │
    ├── DOC-107 (versioned copy implementation) ⏳
    │       depends on: DOC-106 (✅ inventory done)
    │       blocks: DOC-103 (complete version-correct copy)
    │
    ├── DOC-103 (UI/UX) ⏳
    │       depends on: DOC-102 Slice 5I (validation rules)
    │       depends on: DOC-107 (version-correct copy)
    │       blocks: DOC-104 (UI/UX testing)
    │
    ├── DOC-104 (testing) ⏳
    │       depends on: DOC-102, DOC-103, DOC-107
    │       blocks: DOC-105 (release)
    │
    └── DOC-105 (release) ⏳
            depends on: DOC-102, DOC-103, DOC-104, DOC-107
            blocks: DOC-059 closure
```

---

## I. Ordered Bounded Execution Plan

### Tranche V1: DOC-102 Slice 5I — Version-aware validation (estimated 3–5 days)
- Add version-gated frontend validation for bmcVerifyCA, dnsRecordsType
- Add version-gated frontend validation for Azure subnets (conditional on BYO VNet)
- Investigate OnPremDNSRecords feature-gate dependency against 4.21 installer
- Investigate loadBalancer.type=UserManaged dependency against 4.21 installer
- Add parameterized validation tests for 4.20 vs 4.21

### Tranche V2: DOC-102 Slice 5J — Version-aware generation (estimated 3–5 days)
- Add backend generation for all remaining 4.21 supported-backend-only params
- Verify platform.azure.subnets.name and .role against actual 4.21 installer schema
- Add parameterized generation tests proving 4.21-only output not emitted for 4.20
- Retain official OpenShift source evidence

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
- version-manifest.json implementation and tests
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

### V1 (Slice 5I)
- All 4.21-only validation rules execute only for version >= 4.21
- All 4.20 validation behavior unchanged
- Tests prove version-gating with 4.20 and 4.21 state fixtures
- Zero regressions in existing test suites

### V2 (Slice 5J)
- All 4.21 supported-backend-only params emitted in generated YAML for 4.21
- None of those params emitted for 4.20
- Official OpenShift 4.21 installer schema evidence retained
- Parameterized generation tests pass

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
- version-manifest.json generated in exports and validated on import
- Manual visual verification screenshots for 4.20 and 4.21
- All test suites pass with zero failures

### V6 (DOC-105)
- Migration guide complete and accurate
- README documents version-aware features
- Security audit complete with no findings
- Full manual QA for both versions
- All generated artifacts validated

---

## K. Explicit Definition of DONE for DOC-059

DOC-059 may be marked `verified_done` ONLY when ALL of the following are true:

1. **All supported-version parameter differences implemented or deliberately unsupported.** Every 4.21 delta param with supportStatus `supported-ui` or `supported-backend-only` is either implemented end-to-end or has an explicit `docs-only-not-supported` decision with rationale.

2. **All user-facing labels, tooltips, warnings, errors, links, and generated copy are version-correct.** No hardcoded "OpenShift 4.20" appears in user-facing text unless the locked version is 4.20. Centralized copy system (shared/versionedCopy.js) is operational. CI guard prevents regression.

3. **Field Guide is version-correct.** Field Guide compartments for v4.20 and v4.21 produce correct version-specific content, links, commands, and warnings. Unsupported fields are properly messaged.

4. **Deprecations are represented correctly.** Catalog params with `deprecated: true` show visible deprecation badges in the UI. Introduced-in and deprecated-in annotations are present where applicable.

5. **4.20 and 4.21 validation matrix is complete.** Parameterized tests cover all version-gated validation rules, generation rules, field visibility, catalog loading, and import/export for both versions.

6. **Persistence, hydration, import, and export are verified.** State schema v3 migration works at all boundaries. version-manifest.json is generated in exports and validated on import. v1.x import migration works correctly.

7. **Manual QA is complete.** Browser-based manual verification for both 4.20 and 4.21 covering version lock, field visibility, validation, generation preview, Field Guide, and export.

8. **Release and security documentation is complete.** Migration guide, README updates, CHANGELOG, security audit, dependency scan, and release notes are all complete.

9. **Canonical backlog is reconciled.** docs/BACKLOG_STATUS.md accurately reflects the status of DOC-100 through DOC-107 with committed evidence for each.
