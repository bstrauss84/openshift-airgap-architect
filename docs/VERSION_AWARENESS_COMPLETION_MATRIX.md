# Version-Awareness Completion Matrix

**Created:** 2026-08-03
**Last Updated:** 2026-08-18
**Parent:** DOC-059 (OpenShift version-aware system v2.0.0)
**Branch:** develop
**Accepted baseline at last review:** 8282f68d8b501eef0dd68ef1768466451a58e9d5
**Canonical status authority:** docs/BACKLOG_STATUS.md

---

## A. Executive Status

**DOC-059: INCOMPLETE — active, not done**
**DOC-102: COMPLETE — verified_done (2026-08-13)**

Version-awareness foundation is strong. Phase 0 (DOC-100), Phase 1 (DOC-101), and Phase 2 (DOC-102) are verified_done. DOC-102 closed with all canonical slices (5A, 5B, 5D, 5F, 5G, 5H) and final closure tranches accepted: BMC verify CA fully implemented as supported-ui (commit a0d5fcb), Azure BYO VNet subnets fully implemented with version-gated generation (commit 3e3148b), dnsRecordsType reconciled as deliberate support boundary — docs-only-not-supported/hidden-not-applicable across all platforms (commit 0e927b1). Zero supported-backend-only 4.21 delta params remain unresolved for supported platforms (38 unsupported/manual-review upstream delta paths intentionally deferred). Remaining DOC-059 workstreams: Phase 3 (DOC-103) is active / partial — version locking, version-aware UI controls, version-aware UI registry (catalogFieldMeta.js), and browser verification are implemented, but version-specific tooltips, deprecation badges, introduced/deprecated annotations, and systematic version-correct copy are not. Phase 4 (DOC-104) is active / partial — migration tests, catalog tests, visibility tests, validation tests, and generation tests exist for implemented features, but parameterized version-matrix testing, Field Guide version-correctness tests, and version-manifest.json tests are not started. Phase 5 (DOC-105) is active / partial — ADRs (ADR-001 through ADR-007), Design System documentation, version-aware UI checklist, and roadmap governance exist; README has partial v2 development identity; CHANGELOG has an Unreleased v2 section; VERSION identity is established at 2.0.0-dev with deterministic validation. Remaining: migration guide, full README v2.0.0 release update, CHANGELOG v2.0.0 GA entry, security audit, release notes — final release closure still outstanding. DOC-107 (versioned copy strategy implementation): centralized copy system not started, field-specific user-facing copy partial, repository-wide remediation incomplete, CI hardcoded-version enforcement not started. DOC-106 (versioned copy audit) is verified_done at the Phase 0 inventory level; its original implementation conclusion is superseded by current evidence — implementation remains owned by DOC-107 and related DOC-103/DOC-104 acceptance work.

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

**DOC-105 status: active / partial** — not "NOT STARTED". Implemented evidence: ADRs (ADR-001 through ADR-007 exist in docs/), Design System documentation (docs/DESIGN_SYSTEM.md), version-aware UI field checklist (docs/VERSION_AWARE_UI_FIELD_CHECKLIST.md), roadmap governance (docs/IMPLEMENTATION_ROADMAP_2026-05-14.md, continuously maintained). Partial: README has v2 development identity (build-info version field, Option A clarification, check:app-version script); CHANGELOG has `[Unreleased] - v2.0.0 Work in Progress` section; VERSION identity established at `2.0.0-dev` with deterministic validation (`npm run check:app-version`). Remaining for final release closure: migration guide (v1→v2), full README v2.0.0 release update, CHANGELOG v2.0.0 GA entry, security audit, dependency scan, release notes, manual QA, generated artifact validation.

| Artifact | Status | Gap |
|---|---|---|
| Migration guide (v1→v2) | ❌ NOT CREATED | Blocked by DOC-102/103/104 completion |
| README update | PARTIAL | README contains v2 development identity (build-info version field, Option A clarification, check:app-version script). Full v2.0.0 release update blocked by feature completion |
| ADRs | ✅ ADR-001 through ADR-007 exist | May need post-implementation updates |
| BACKLOG_STATUS update | ✅ Continuously maintained | Final DOC-059 closure update pending |
| Implementation roadmap | ✅ Maintained but stale (last updated 2026-05-29) | Needs v2.0.0 progress update |
| CHANGELOG | PARTIAL | CHANGELOG contains `[Unreleased] - v2.0.0 Work in Progress` section with breaking changes, added features, and fixes. Final v2.0.0 release entry blocked by release |
| Security audit | ❌ NOT PERFORMED for v2.0.0 | Requires complete feature set |
| Dependency scan | ❌ Not run for v2.0.0 | Requires pre-release execution |
| Manual QA (4.20) | PARTIAL (DOC-101 browser verification) | Full QA cycle not performed |
| Manual QA (4.21) | PARTIAL (DOC-101 browser verification) | Full QA cycle not performed |
| 4.20 generated artifacts validation | ❌ NOT PERFORMED | Requires generation tests |
| 4.21 generated artifacts validation | ❌ NOT PERFORMED | Requires generation tests |
| Release versioning | PARTIAL | VERSION file set to `2.0.0-dev`; all 4 package.json and 3 package-lock.json synchronized; deterministic validator (`npm run check:app-version`). Identity progression to `2.0.0-rc.N` → `2.0.0` at release time; deliberate RC and GA tags are separate milestones requiring final release closure |
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
