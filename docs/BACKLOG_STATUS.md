# Backlog and Status Registry

This file is the canonical, tracked source of truth for project backlog and implementation status.

Do not use local-only files (for example `LOCAL_BACKLOG.md`) as canonical status references in committed docs.

## Canonical status vocabulary

- `active`: planned and in-scope
- `deferred`: intentionally postponed
- `blocked`: cannot progress until blocker is resolved
- `done_pending_verification`: implemented, but verification is incomplete
- `verified_done`: implemented and verified against code/tests
- `obsolete`: no longer relevant to current direction
- `superseded`: replaced by another item

## Priority vocabulary

- `p0`: urgent correctness/security impact
- `p1`: high product impact
- `p2`: normal planned work
- `p3`: low-priority improvement

## Evidence-first reconciliation workflow

For each status update:

1. Capture the claim source (doc path and text).
2. Verify in code and tests.
3. Set canonical status from evidence.
4. If conflicts exist, mark older claim as superseded and link back here.

## Comparative authority chain (explicit)

For comparative-program governance, authority order is:

1. **Canonical status authority (only):** this file (`docs/BACKLOG_STATUS.md`)
2. **Umbrella comparative strategy:** `docs/COMPREHENSIVE_COMPARATIVE_INTEGRATION_MASTER.md`
3. **Tool-specific deep-dive dossiers:** ABA, discovery-iso, clusterfile revised dossier, autoshiftv2 dossier
4. **Historical/background comparative docs:** non-primary unless explicitly promoted in `docs/INDEX.md`

Status conflicts are always resolved here, not in umbrella or per-tool comparative docs.

## Active reconciliation items

| item_id | title | status | priority | source_docs | code_evidence | next_action |
|---|---|---|---|---|---|---|
| DOC-001 | Normalize docs host to docs.redhat.com in docs-index and frontend copy | active | p1 | `docs/DOC_INDEX_RULES.md`, `docs/CANONICAL_DOC_SOURCE_AND_EXAMPLE_CAPTURE_RULES.md`, `data/docs-index/4.20.json`, `frontend/src/data/docs-index/4.20.json` | `scripts/refresh-doc-index.js`, `scripts/validate-docs-index.js` | Replace remaining docs.openshift.com links or explicitly document exceptions in one canonical place. |
| DOC-002 | Reconcile scenario ID inventory across rules, schema, and docs-index | active | p1 | `docs/DOC_INDEX_RULES.md`, `schema/scenarios.json`, `data/docs-index/4.20.json` | `scripts/validate-docs-index.js`, `scripts/validate-catalog.js` | Align scenario list and document unsupported or pending scenario IDs clearly. |
| DOC-003 | Replace missing `UI_NORTH_STAR.md` contract reference with tracked source | done_pending_verification | p1 | `docs/CONTRIBUTING.md`, `.gitignore` | `docs/DESIGN_SYSTEM.md` | Keep `docs/DESIGN_SYSTEM.md` as tracked UI contract and remove stale references. |
| DOC-004 | Remove references to missing `PHASE_5_*` documents | done_pending_verification | p1 | `docs/CODE_STYLE_RULES.md`, `frontend/src/catalogResolver.js`, `backend/src/generate.js` | referenced source files | Replace with links to tracked governance docs (`docs/INDEX.md`, `docs/PARAMS_CATALOG_RULES.md`). |
| DOC-005 | Add canonical docs/navigation hub and authority labels | done_pending_verification | p1 | `docs/INDEX.md` | N/A | Keep this file updated as authority map changes. |
| DOC-006 | Consolidate helper usage model into one tracked guide | done_pending_verification | p2 | `AGENTS.md`, `docs/HELPER_USAGE.md` | N/A | Keep helper taxonomy and routing rules synchronized with `AGENTS.md`. |
| DOC-007 | Introduce AI governance policy for Cursor-first workflow | done_pending_verification | p1 | `AI_GOVERNANCE.md` | CI and process docs | Adopt policy in contributor flow and future PR templates if added. |
| DOC-008 | Resolve E2E inventory count drift ("9 scenarios" vs current docs-index) | done_pending_verification | p2 | `docs/e2e-examples/INVENTORY.md`, `data/docs-index/4.20.json` | N/A | Clarify scope language to avoid mismatch with scenario IDs. |
| DOC-009 | Investigate missing README screenshots under `docs/images/` | active | p2 | `README.md` | N/A | Either add assets, update paths, or remove image links. |
| DOC-010 | Create single scenario navigation hub with TOC and links | done_pending_verification | p1 | `docs/SCENARIOS_GUIDE.md`, `docs/INDEX.md` | N/A | Keep scenario map current as scenario IDs and working docs change. |
| DOC-011 | Add authority banners to high-traffic working docs | done_pending_verification | p2 | scenario and comparative working docs under `docs/` | N/A | Expand to remaining working docs over time where useful. |
| DOC-012 | Expand authority banners to remaining verification/reference working docs | done_pending_verification | p2 | vSphere verification docs, bare-metal VIP truth doc, UBI/pull-secret verification docs, cached `ocp-4.20-*` docs | N/A | Keep canonical pointers in place so readers can distinguish working/reference artifacts from policy docs. |
| DOC-013 | Consolidate scenarios into a handful of family-level hub docs with TOCs | done_pending_verification | p1 | `docs/SCENARIOS_BARE_METAL_FAMILY.md`, `docs/SCENARIOS_VSPHERE_FAMILY.md`, `docs/SCENARIOS_CLOUD_FAMILY.md`, `docs/SCENARIOS_NUTANIX_FAMILY.md`, `docs/SCENARIOS_GUIDE.md` | N/A | Keep all deep docs linked; no relevant detail removed from source docs. |
| DOC-014 | Validate relevance of scenario-related docs during consolidation | done_pending_verification | p1 | scenario family guides + deep working docs | N/A | Maintain relevance snapshot tables and review when scenario scope changes. |
| DOC-015 | Triage local ignored docs and decide promotion/archive strategy | verified_done | p1 | ignored `docs/*` inventory from git ignored set | `git ls-files --others -i --exclude-standard docs`, `docs/LOCAL_IGNORED_DOCS_TRIAGE.md` | Keep the final reconciliation table updated when new ignored docs appear. |
| DOC-016 | Create tracked local-doc triage and promotion framework | done_pending_verification | p1 | `docs/LOCAL_IGNORED_DOCS_TRIAGE.md` | local ignored docs inventory command | Use this framework to safely ingest relevant local docs into tracked canonical sources. |
| DOC-017 | Ingest still-relevant items from local Phase 5/E2E docs into canonical backlog | verified_done | p1 | local `docs/PHASE_*`, `docs/E2E_*` | `docs/LOCAL_IGNORED_DOCS_TRIAGE.md` reconciliation table + existing code/doc evidence | Keep future ingestion incremental and canonical; archive local source docs after reconciliation. |
| DOC-018 | Implement E2E dual-stack assertion parity from local backlog (B-3) | verified_done | p1 | `docs/E2E_BACKLOG.md`, `docs/PHASE_5_REMAINING_WORK.md` | `backend/scripts/validate-e2e-examples.js` (`enforceDualStackInstallChecks`), `node backend/scripts/validate-e2e-examples.js` | Keep this assertion in sync with dual-stack generation behavior and future e2e matrix paths. |
| DOC-019 | Evaluate OVN MTU and optional OVN knobs from local backlog (B-4) | deferred | p2 | `docs/E2E_BACKLOG.md` | `backend/src/generate.js` (currently emits only `ovnKubernetesConfig.ipv4.internalJoinSubnet`) | Keep deferred unless product scope requires `mtu`/`genevePort`/`ipsecConfig`; implement catalog + generate + E2E together if reactivated. |
| DOC-020 | Reconcile trust-bundle policy local backlog note (B-5) with tracked docs | superseded | p2 | `docs/E2E_BACKLOG.md`, `docs/PHASE_5_REMAINING_WORK.md` | `docs/PARAMS_CATALOG_RULES.md`, `frontend/src/steps/TrustProxyStep.jsx` | Treated as covered by tracked Trust/Proxy guidance; reopen only if user-facing docs remain unclear. |
| DOC-021 | Reconcile local header-actions reorg item (§9.2) with current UI | done_pending_verification | p2 | `docs/PHASE_5_REMAINING_WORK.md` | `frontend/src/App.jsx` (`runActionsOpen`, `prefsOpen`, export/import/start-over handlers), `frontend/tests/start-over-ocmirror-warning.test.jsx` | Add/confirm explicit tests for run-actions and preferences keyboard/a11y interactions before moving to `verified_done`. |
| DOC-022 | Reconcile local "Help me decide" deferral with segmented flow | deferred | p2 | `docs/PHASE_5_REMAINING_WORK.md`, `docs/PHASE_5_B_DEFERRAL_LIST.md` | `frontend/src/steps/GlobalStrategyStep.jsx` ("Help me decide" controls/modal), segmented flow step set in `frontend/src/App.jsx` (no Global Strategy step) | Deferred for a docs-only consolidation pass; reactivate in a UI implementation pass. |
| DOC-023 | Stabilize `docs/SCENARIOS_GUIDE.md` TOC link behavior across markdown renderers | done_pending_verification | p1 | user-reported navigation issue in `docs/SCENARIOS_GUIDE.md` | explicit section anchors in `docs/SCENARIOS_GUIDE.md` | Verify link resolution in Cursor preview and GitHub-style rendering; extend anchor normalization if any section still fails. |
| DOC-024 | Keep reconciled local docs ignored and out of commits/pushes | verified_done | p2 | `docs/LOCAL_IGNORED_DOCS_TRIAGE.md`, user decision for local ignored retention | `git ls-files --others -i --exclude-standard docs` (ignored set remains local-only) | Maintain `.gitignore` coverage and avoid staging ignored docs in docs-only pushes. |
| DOC-025 | Ingest durable local prompt/UI/testing guardrails into tracked governance docs | verified_done | p1 | `docs/UI_NORTH_STAR.md`, `docs/PROMPT_GUARDRAILS.md`, `docs/TESTING_NOTES.md` | updates to `docs/DESIGN_SYSTEM.md`, `docs/HELPER_USAGE.md`, `AI_GOVERNANCE.md`, `docs/CONTRIBUTING.md` | Keep tracked governance docs authoritative; archive local source notes. |
| DOC-026 | Split cloud and Nutanix family docs for cleaner scenario governance | verified_done | p1 | `docs/SCENARIOS_GUIDE.md`, `docs/INDEX.md`, former cloud+nutanix family guide | `docs/SCENARIOS_CLOUD_FAMILY.md`, `docs/SCENARIOS_NUTANIX_FAMILY.md`, updated family references | Keep scenario map updated as cloud/nutanix complexity changes. |
| DOC-027 | Remove tracked raw OCP snapshot docs from canonical reading path | verified_done | p1 | previous tracked `docs/ocp-4.20-*` snapshot docs | deleted tracked snapshot files + updated `docs/INDEX.md` and `docs/SCENARIOS_GUIDE.md` | Keep raw external captures local/archive-only going forward; do not reintroduce as canonical tracked docs. |
| DOC-028 | Remove local-only pattern leak from tracked docs (`docs/PHASE*`) | verified_done | p1 | `.gitignore` local-only rules (`docs/PHASE*`) | removed tracked `docs/PHASE_G_ADDING_A_VERSION.md` from repo | Keep local-only pattern files out of tracked history going forward. |
| DOC-029 | Execute comprehensive comparative integration planning artifact and canonical linkage | done_pending_verification | p1 | `docs/COMPREHENSIVE_COMPARATIVE_INTEGRATION_MASTER.md`, `.cursor/plans/comprehensive_comparative_integration_plan_58fa5b4f.plan.md` | master artifact in `docs/`, comparative/gov/security/stakeholder sections | Verify cross-links and ensure follow-on backlog items are registered before moving to `verified_done`; keep status truth in this file only. |
| DOC-030 | Add per-operation log download for current and historical Operations jobs | done_pending_verification | p1 | user backlog intake (2026-03-24) | `frontend/src/steps/OperationsStep.jsx` per-job downloads (log, metadata, support bundle) + enriched operations export payload with oc-mirror metadata | Run manual UI verification for completed/failed/running jobs and confirm filenames/metadata content before marking `verified_done`. |
| DOC-031 | Perform full disconnected-scenario support audit across all documented/supported scenarios | active | p1 | user backlog intake (2026-03-24), `docs/SCENARIOS_GUIDE.md`, `data/docs-index/4.20.json` | scenario mappings, validation rules, generator paths | Produce scenario-by-scenario disconnected support matrix and register gaps with priority. |
| DOC-032 | Normalize cross-scenario tab/field aesthetics and logical grouping to IBM Cloud IPI quality bar | active | p2 | user backlog intake (2026-03-24), `docs/DESIGN_SYSTEM.md` | step UIs under `frontend/src/steps/` | Define reusable layout contract and apply per scenario tab set without regressions. |
| DOC-033 | Verify root device hints path from UI/state to generated YAML previews and exports | done_pending_verification | p1 | user backlog intake (2026-03-24), bare metal docs and host inventory notes | `frontend/src/steps/HostInventoryV2Step.jsx`, `frontend/src/steps/HostInventoryStep.jsx`, `frontend/src/hostInventoryV2Helpers.js`, `frontend/src/validation.js`, `frontend/src/placeholderValuesHelpers.js`, `backend/src/generate.js`, `backend/test/smoke.test.js`, `frontend/src/data/catalogs/bare-metal-agent.json`, `frontend/src/data/catalogs/bare-metal-ipi.json`, `frontend/src/data/catalogs/vsphere-agent.json` | Validate in UI for bare-metal-agent, bare-metal-ipi, and vsphere-agent that `rootDeviceHints.{deviceName,hctl,model,vendor,serialNumber,minSizeGigabytes,wwn,rotational}` appear in Assets/Review and export bundle as expected. |
| DOC-034 | Implement persistent real-time YAML side drawer per tab/scenario | active | p2 | user backlog intake (2026-03-24), `docs/DESIGN_SYSTEM.md` | preview generation flow + drawer components | Design/implement collapsible persistent YAML drawer that coexists with Tools and Host drawers. |
| DOC-035 | Research and add support for OpenShift 4.20 `platform: none` install paths where valid | active | p1 | user backlog intake (2026-03-24), OpenShift 4.20 docs | scenario gating + generator + validation + docs-index alignment | Deliver docs-grounded support boundaries and implementation plan for `platform: none`. |
| DOC-036 | Fix import-run reload override issue (post-import edits not replaced by same import) | active | p1 | user backlog intake (2026-03-24) | import/run state handling in app store and import path | Reproduce deterministically and fix merge/overwrite semantics for re-import of same run file. |
| DOC-037 | Design high-side/low-side local-first operating modes with capability gating | done_pending_verification | p1 | user backlog intake (2026-03-24), governance and security docs | `backend/src/index.js` profile contract + capability-gated routes (`/api/profile/capabilities`, release/docs/operators/aws/update/feedback/oc-mirror), frontend gating in `frontend/src/steps/BlueprintStep.jsx`, `frontend/src/steps/OperatorsStep.jsx`, `frontend/src/steps/ReviewStep.jsx`, `frontend/src/steps/RunOcMirrorStep.jsx` | Verify disconnected profile behavior end-to-end in UI with `AIRGAP_RUNTIME_SIDE=high-side`, then move to `verified_done`. |
| DOC-038 | Add high-side hardening controls for government/disconnected operation profiles | active | p1 | user backlog intake (2026-03-24), `docs/SECURITY_NOTES.md`, `AI_GOVERNANCE.md` | network call surfaces, secret handling, operation safeguards | Define and implement hardening baseline (network restrictions, logging hygiene, safe defaults) for high-side runs. |
| DOC-039 | Expand methodology/sub-scenario intelligence for disconnected decision support (e.g. vSphere SDK constraints) | active | p1 | user backlog intake (2026-03-24), scenario family docs | methodology flow logic + scenario constraints + guidance content | Add rules and guidance that steer users to valid disconnected paths based on environmental constraints. |
| DOC-040 | Expand UPI support with standardized manifest/prep assistance where feasible | active | p1 | user backlog intake (2026-03-24), UPI scenario docs | UPI scenario flows + generated artifacts + field manual content | Identify repeatable UPI prep tasks and add standardized helpers/templates without over-assuming infra specifics. |
| DOC-041 | Implement secure in-app feedback mechanism with anti-abuse and hidden destination identity | active | p1 | user backlog intake (2026-03-24) | top-bar UI + backend feedback endpoint + rate limiting/abuse controls | Keep destination identity out of tracked code/docs/client payloads, use GitHub issue draft generation (URL + markdown fallback), and disable/hide feedback on high-side/disconnected profiles. |
| DOC-042 | Deep comparative enrichment P1 baseline hardening with file-level capability evidence | done_pending_verification | p1 | `docs/COMPREHENSIVE_COMPARATIVE_INTEGRATION_MASTER.md`, deep enrichment plan (P1) | capability map and evidence model (`E1-E4`) added to master comparative artifact | Verify cited code/doc surfaces remain current after next implementation wave; then move to `verified_done`. |
| DOC-043 | Deep comparative enrichment P2 per-tool deep dives with equal depth and implications | done_pending_verification | p1 | `docs/COMPREHENSIVE_COMPARATIVE_INTEGRATION_MASTER.md`, `docs/ABA_COMPARISON_REVISED_PLAN_2026-03-24.md`, `docs/DISCOVERY_ISO_COMPARISON_REVISED_PLAN_2026-03-24.md`, `docs/CLUSTERFILE_COMPARISON_REVISED_PLAN_2026-03-17.md` | per-tool evidence ledgers + explicit implications/gate outcomes appended, including clusterfile deep capability dossier, ABA/discovery execution packets, and cross-tool granularity standard | Verify each comparative doc includes capability IDs, execution packets, scenario matrix, trust boundaries, and verification checklist before moving to `verified_done`; this file remains canonical status source. |
| DOC-044 | Deep comparative enrichment P3 capability taxonomy and scored cross-tool matrix | done_pending_verification | p1 | `docs/COMPREHENSIVE_COMPARATIVE_INTEGRATION_MASTER.md` | stable capability ID taxonomy + scored matrix with absorb outcomes | Confirm scoring assumptions with stakeholder review before converting to implementation backlog commitments. |
| DOC-045 | Deep comparative enrichment P4 bounded source-of-truth/security/governance/product gates | done_pending_verification | p1 | `docs/COMPREHENSIVE_COMPARATIVE_INTEGRATION_MASTER.md`, `AI_GOVERNANCE.md`, `docs/HELPER_USAGE.md` | G1-G4 gate model applied to major recommendations with pass/fail outcomes | Validate gate language with governance owners; promote to `verified_done` when accepted. |
| DOC-046 | Deep comparative enrichment P5 canonical backlog translation and ownership linkage | done_pending_verification | p1 | `docs/BACKLOG_STATUS.md`, `docs/INDEX.md`, `docs/COMPREHENSIVE_COMPARATIVE_INTEGRATION_MASTER.md` | comparative outcomes translated into canonical rows and index linkage | Confirm ownership and sequence alignment with active DOC-030+ roadmap items. |
| DOC-047 | Deep comparative enrichment P6 low-drift future-agent execution packets | done_pending_verification | p1 | `docs/COMPREHENSIVE_COMPARATIVE_INTEGRATION_MASTER.md` | FP-01 through FP-04 packets include scope, non-goals, evidence, acceptance criteria | Validate packet readiness with next implementation planning session; then mark `verified_done`. |
| DOC-048 | Add AutoShiftv2 deep comparative stream and integrate Day-2 handoff findings into master comparative strategy | done_pending_verification | p1 | `docs/AUTOSHIFTV2_COMPARISON_REVISED_PLAN_2026-03-23.md`, `docs/COMPREHENSIVE_COMPARATIVE_INTEGRATION_MASTER.md` | capability dossier (`CAP-AS2-*`), packetized recommendations (`AS2-P1`..`AS2-P4`), master comparative section `3.4` + extension scoring | Verify cross-tool parity against granularity standard (capabilities, packets, scenario matrix, trust boundaries, acceptance checks) before moving to `verified_done`; preserve canonical status authority in this file. |
| DOC-049 | Close pass-1 behavior mismatches before next disconnected continuation slice | done_pending_verification | p0 | user-directed pass closure request, `docs/OC_MIRROR_V2_RUN_TAB_RESEARCH_AND_PLAN.md` | `backend/src/index.js`, `backend/src/installer.js`, `frontend/src/steps/ReviewStep.jsx`, `frontend/src/steps/BlueprintStep.jsx`, `frontend/src/steps/OperatorsStep.jsx`, continuation/cache tests | Verify import->continuation default, start-over cache preservation, continuation lock enforcement, operator cache-scope degradation, installer host OS/FIPS claim alignment, and mirror-output export deprecation in manual and automated checks before moving to `verified_done`. |

## Execution sequencing (DOC-030 to DOC-041)

This sequence is intended to maximize risk reduction and unblock dependent work.

| order | item_id | rationale |
|---|---|---|
| 1 | DOC-031 | Full disconnected-scenario audit is foundational; prevents building features on incorrect scenario assumptions. |
| 2 | DOC-035 | `platform: none` support boundary depends on audit outcomes and OpenShift 4.20 doc-grounded scope. |
| 3 | DOC-039 | Methodology/sub-scenario decision intelligence depends on validated scenario matrix from DOC-031 and DOC-035. |
| 4 | DOC-033 | Root device hints correctness is a high-confidence correctness bug and should be fixed early. |
| 5 | DOC-036 | Import override issue is a user-facing data integrity bug; fix before larger UX expansions. |
| 6 | DOC-030 | Per-operation log download is operationally valuable and low-risk once operations data semantics are confirmed. |
| 7 | DOC-037 | High/low-side mode design defines runtime capability gating model used by several later enhancements. |
| 8 | DOC-038 | High-side hardening profile builds directly on DOC-037 operating-mode boundaries. |
| 9 | DOC-040 | UPI simplification should follow audit + methodology + mode/hardening baselines to avoid inconsistent helpers. |
| 10 | DOC-032 | Cross-scenario layout normalization is broad and should follow correctness and scenario-truth fixes. |
| 11 | DOC-034 | Persistent live YAML drawer depends on stable per-tab relevance and UX/layout conventions from DOC-032. |
| 12 | DOC-041 | Feedback mechanism should be implemented after core usability/correctness updates to capture meaningful usage feedback. |

## Dependency map (DOC-030 to DOC-041)

| item_id | depends_on | unblock_condition |
|---|---|---|
| DOC-035 | DOC-031 | disconnected scenario audit completed with explicit supported/unsupported matrix |
| DOC-039 | DOC-031, DOC-035 | scenario constraint model documented and accepted |
| DOC-038 | DOC-037 | high/low-side capability gating model defined |
| DOC-040 | DOC-031, DOC-039 | scenario/methodology constraints finalized for UPI helper scope |
| DOC-034 | DOC-032 | tab/section consistency baseline established |
| DOC-041 | DOC-037, DOC-038 | mode/hardening/privacy constraints defined for secure feedback design |

## Suggested sprint buckets

- **Sprint A (correctness + scope truth):** DOC-031, DOC-035, DOC-033, DOC-036  
- **Sprint B (operations + mode controls):** DOC-030, DOC-037, DOC-038  
- **Sprint C (UX/system expansion):** DOC-039, DOC-040, DOC-032, DOC-034  
- **Sprint D (feedback channel):** DOC-041

## Archived phase progression (fully reconciled)

The following progression consolidates archived local phase docs from:

- `/home/billstrauss/code/archived_docs/openshift-airgap-architect-local-docs-20260323-193417/docs`

| phase_or_workstream | canonical_status | evidence_paths | notes |
|---|---|---|---|
| Phase 1-3 docs-index/catalog normalization | verified_done | `data/docs-index/4.20.json`, `scripts/validate-docs-index.js`, `scripts/validate-catalog.js` | Folded into `DOC-001` and `DOC-002`. |
| Phase 4.5 coverage mapping | superseded | segmented flow + catalog-driven step set in tracked frontend | Historical planning artifact; replaced by implemented flow. |
| Phase 5 A1 param alignment | verified_done | tracked catalogs + `frontend/src/steps/PlatformSpecificsStep.jsx` | Historical A1 items resolved in tracked implementation. |
| Phase 5 A2 tab relevance/platform none handling | verified_done | `frontend/src/App.jsx`, `frontend/src/steps/NetworkingV2Step.jsx`, `backend/src/generate.js` | Historical A2 items reconciled. |
| Phase 5 B restore + carry-over | done_pending_verification | `frontend/src/steps/TrustProxyStep.jsx`, `frontend/src/steps/GlobalStrategyStep.jsx` | `DOC-022` remains deferred for segmented parity. |
| Phase 5 C segmented default flow | verified_done | segmented step map in `frontend/src/App.jsx` | Treated as complete. |
| Phase 5 D wizard checkmarks/progress | verified_done | `frontend/tests/wizard-flow-progress.test.jsx` | Reconciled as complete. |
| Phase 5 E vulnerability/audit | done_pending_verification | package manifests + audit process | Keep periodic audit reruns in backlog. |
| Phase 5 F git hygiene | verified_done | `.github/workflows/ci.yml`, `.gitignore` | Hygiene workflow is active. |
| Phase 5 G bloat/archive manifest | active | archive triage docs + archived local set | Manifest-style archival curation remains active. |
| Phase 5 H code consistency | done_pending_verification | tracked docs and comments | Requires occasional drift checks. |
| Phase 5 I UX polish | done_pending_verification | current UI + targeted tests | Keep in verification cadence. |
| Phase 5 J AMI/discovery | verified_done | installer/warming routes + Platform Specifics UI | Marked complete by repo evidence. |
| Phase 5 K E2E matrix/validation | active | `backend/scripts/e2e-matrix.js`, `backend/scripts/validate-e2e-examples.js` | Active as ongoing validation system. |
| Phase 5 L extras (a11y/perf/error boundaries) | deferred | scattered tests/docs | Future hardening bucket. |
| Phase 5 section 9.1 oc-mirror gate | superseded | `frontend/src/steps/RunOcMirrorStep.jsx` | Replaced by implemented flow. |
| Phase 5 section 9.2 header actions verify/reorg | done_pending_verification | `frontend/src/App.jsx`, `DOC-021` | Pending explicit a11y verification closure. |
| Phase 5 section 9.3 operations panel maturation | done_pending_verification | `frontend/src/steps/OperationsStep.jsx` | Needs final verification sweep. |
| REFACTOR_MVP_TRACKER multi-phase plan | superseded | tracked Phase 5 outcomes + canonical backlog | Kept historical only in archive. |
| Scenario catalog plan (future versions) | deferred | tracked 4.20 data/rules docs | 4.21+ remains future work. |

## Consolidated archived item registry

All actionable items found across archived phase/backlog docs are tracked here (including historical IDs where present).

| item_id | title | status | priority | source_docs | code_evidence | next_action |
|---|---|---|---|---|---|---|
| PHX-001 (B-1) | Dual-stack emit IPv6 cluster/service networks in generation | verified_done | p1 | archived `E2E_BACKLOG.md` | `backend/src/generate.js` | Keep regression tests aligned with matrix expansion. |
| PHX-002 (B-2) | Expose dual-stack IPv6 CIDRs in wizard/state | verified_done | p1 | archived `E2E_BACKLOG.md` | `frontend/src/steps/NetworkingV2Step.jsx`, `frontend/src/validation.js` | Maintain catalog parity if paths change. |
| PHX-003 (B-3) | Validate dual-stack has >=2 cluster/service network entries | verified_done | p1 | archived `E2E_BACKLOG.md`, `PHASE_5_REMAINING_WORK.md` | `backend/scripts/validate-e2e-examples.js` (`enforceDualStackInstallChecks`) | Keep validator rule synchronized with generator behavior. |
| PHX-004 (B-4) | OVN MTU/geneve/ipsec optional support | deferred | p2 | archived `E2E_BACKLOG.md`, `E2E_FINDINGS_AND_RECOMMENDATIONS.md` | `backend/src/generate.js` | Reactivate only with explicit product scope. |
| PHX-005 (B-5) | Trust-bundle policy guidance | superseded | p2 | archived `E2E_BACKLOG.md` | `docs/PARAMS_CATALOG_RULES.md`, `frontend/src/steps/TrustProxyStep.jsx` | Reopen only if tracked docs become unclear. |
| PHX-006 (B-6) | Add E2E path for host MTU/SR-IOV agent-config output | active | p3 | archived `E2E_BACKLOG.md` | current matrix scripts do not include host-advanced path | Add optional matrix cell + assertions. |
| PHX-007 (B-7) | Add E2E/UI path for bond/VLAN nmstate outputs | deferred | p3 | archived `E2E_BACKLOG.md` | host networking generation exists but path coverage partial | Revisit when product requires bond/VLAN validation. |
| PHX-008 (B-8) | Optional value-level E2E comparison vs doc examples | deferred | p3 | archived `E2E_BACKLOG.md` | validator currently structure-oriented | Add flag-based value diff mode if needed. |
| PHX-009 (B-9) | credentialsMode/arbiter/featureSet extended paths | deferred | p3 | archived `E2E_BACKLOG.md` | partial implementation in platform-specific UI | Keep deferred until product scope says otherwise. |
| PHX-010 (B-10) | Cluster-name/replicas placeholder parity with docs | deferred | p3 | archived `E2E_BACKLOG.md` | fixtures/defaults intentionally differ | Document intentional differences or align defaults later. |
| PHX-011 (sec 9.1) | oc-mirror "Coming soon" gate | superseded | p2 | archived `PHASE_5_POST_SCENARIO_AGENT_PLAN.md` | `frontend/src/steps/RunOcMirrorStep.jsx` | No action; feature is implemented. |
| PHX-012 (sec 9.2) | Header actions verify/reorganize | done_pending_verification | p2 | archived `PHASE_5_REMAINING_WORK.md` | `frontend/src/App.jsx`, `DOC-021` | Complete targeted a11y/keyboard verification tests. |
| PHX-013 (sec 9.3) | Operations logs/clear/export placement | done_pending_verification | p2 | archived `PHASE_5_REMAINING_WORK.md` | `frontend/src/steps/OperationsStep.jsx` | Run final behavior verification and close. |
| PHX-014 (G) | Bloat review and archive manifest decisions | active | p2 | archived post-phase docs | `docs/LOCAL_IGNORED_DOCS_TRIAGE.md` | Maintain manifest-like archive registry as docs evolve. |
| PHX-015 (E) | Periodic npm vulnerability reconciliation | done_pending_verification | p2 | archived `PHASE_5_E_VULN_AND_AUDIT.md` | package manifests and audit workflow | Run periodic audit and capture result in tracked docs. |
| PHX-016 (B-help) | "Help me decide" segmented-flow parity | deferred | p2 | archived `PHASE_5_B_DEFERRAL_LIST.md` | legacy control in `frontend/src/steps/GlobalStrategyStep.jsx` | Deferred in docs-only pass; reactivate in UI pass. |
| PHX-017 (GAP-arch) | Blueprint architecture carry-over to install-config | verified_done | p1 | archived `PHASE_5_GAP_REMEDIATION_AND_CARRYOVER.md` | `backend/src/generate.js` | Keep mapping documented and tested. |
| PHX-018 (GAP-adv) | Advanced params (hyperthreading/capabilities/cpuPartitioning/minimalISO) | verified_done | p2 | archived gap/remediation docs | platform-specific and validation tracked files | Keep catalog and UI mapping synchronized. |
| PHX-019 (GAP-vsphere) | vSphere failureDomains field parity | verified_done | p1 | archived gap/remediation docs | `frontend/src/steps/PlatformSpecificsStep.jsx` | Monitor for drift as docs/catalogs evolve. |
| PHX-020 (GAP-defer) | Deferred featureSet/arbiter/imageContentSources | deferred | p2 | archived gap/remediation docs | tracked defer items and rules docs | Maintain as explicit defer set. |
| PHX-021 (overrides) | YAML overrides escape hatch concept | deferred | p3 | archived recommendations/UI north-star docs | no tracked implementation | Keep as optional future UX enhancement. |
| PHX-022 (apiVersion) | Verify agent-config apiVersion alignment | done_pending_verification | p2 | archived recommendations docs | backend tests + generation | Confirm with explicit test assertion and close. |
| PHX-023 (rootDeviceHints) | Expand rootDeviceHints beyond minimal fields | deferred | p3 | archived findings/recommendations docs | host inventory + generate logic | Revisit for advanced bare-metal use cases. |
| PHX-024 (SR-IOV/VRF parity) | Host advanced networking parity gaps | deferred | p3 | archived recommendations docs | host inventory + generation | Reassess when day-2 style networking scope expands. |
| PHX-025 (bond mode naming) | Bond mode naming vs nmstate alignment | deferred | p3 | archived recommendations/findings docs | generation nmstate builder | Validate naming semantics before activating. |
| PHX-026 (identity header) | Scenario header collapsible behavior | verified_done | p2 | archived identity/header follow-up docs | `frontend/src/components/ScenarioHeaderPanel.jsx` | None. |
| PHX-027 (identity pull-secret) | Pull-secret/mirror-secret gating and handling | done_pending_verification | p1 | archived identity/header follow-up docs | identity/access step + store/export paths | Add/verify secret persistence exclusion tests. |
| PHX-028 (identity key downloads) | Separate SSH pub/pem download ergonomics | verified_done | p2 | archived identity/header follow-up docs | Identity step implementation | None. |
| PHX-029 (landing workflow) | Pre-wizard landing net-new/upgrade/mirror-only flows | deferred | p2 | archived requirements docs | current landing page provides partial coverage | Treat as future product feature decision. |
| PHX-030 (PatternFly contradiction) | Reconcile PatternFly status mismatch across requirement docs | active | p2 | archived `REQUIREMENTS_VERBATIM.md`, `REQUIREMENTS_REMAINING.md` | tracked UI implementation and styling docs | Resolve single canonical status statement. |
| PHX-031 (host apply confirm) | Host apply confirmation modal for overwrite | active | p2 | archived requirements docs | host inventory flows | Implement and test in UI pass. |
| PHX-032 (iface/mac paste helper) | Paste helper for `<iface> <mac>` pairs | active | p2 | archived requirements docs | host inventory paths | Implement parsing helper + tests. |
| PHX-033 (import credential notice) | Post-import "credentials not configured" warning | active | p2 | archived requirements docs | import path in app/store | Implement import-state warning UX + tests. |
| PHX-034 (backend YAML unit coverage) | Broaden generation unit tests (NIC/bond/VLAN/IPv6) | active | p2 | archived requirements docs | `backend/test/` suite | Add targeted backend test cases. |
| PHX-035 (import cert warning) | Post-import certificate exclusion warning | active | p2 | archived requirements docs | import/export handling | Implement warning and validation signal. |
| PHX-036 (duplicate run) | Clone/duplicate run workflow | deferred | p3 | archived requirements docs | export/import exists | Keep as lower-priority UX enhancement. |
| PHX-037 (version fingerprint) | Version dependency fingerprinting per page | deferred | p3 | archived requirements docs | no tracked implementation | Optional future UX telemetry signal. |
| PHX-038 (left-nav incomplete badge) | Sidebar incomplete badges | deferred | p3 | archived requirements docs | step flags currently available in app state | Implement only if UX priority increases. |
| PHX-039 (MVP phases 2-12) | Legacy MVP tracker continuation | superseded | p3 | archived `REFACTOR_MVP_TRACKER.md` | segmented flow/canonical backlog supersedes | Keep historical only. |
| PHX-040 (4.21 catalog/index) | Add 4.21 docs-index and param coverage | deferred | p3 | archived scenario-catalog plan docs | current tracked data is 4.20 | Activate when version support moves forward. |
| PHX-041 (coverage awareness view) | In-app catalog coverage awareness reporting | deferred | p3 | archived UI north-star docs | no tracked implementation | Optional dev/admin feature. |
| PHX-042 (review diff view) | Review-step "what changed" diff panel | deferred | p3 | archived UI north-star docs | no tracked implementation | Optional UX improvement. |
| PHX-043 (CI docs host rules) | Ensure CI/rules prefer docs.redhat.com and avoid hard host assumptions | active | p1 | archived CI prompt docs | docs-index scripts + rules docs | Finish remaining host normalization under `DOC-001`. |
| PHX-044 (matrix/checklist count drift) | Reconcile archived E2E checklist counts with current matrix | active | p2 | archived E2E checklists/reports | `backend/scripts/e2e-matrix.js`, tracked inventory docs | Update tracked inventory language to current matrix dimensions. |

## Archived contradiction resolution map

| contradiction_id | source_conflict | canonical_resolution |
|---|---|---|
| C-001 | Archived B-3 marked open in one file and done in another | Canonical status is `verified_done` via `PHX-003` and `DOC-018`. |
| C-002 | Archived B-5 marked "Next" despite tracked trust/proxy guidance present | Canonical status is `superseded` via `PHX-005` and `DOC-020`. |
| C-003 | Archived section 9.1 says "Coming soon" while repo has working Run oc-mirror flow | Canonical status is `superseded` via `PHX-011`. |
| C-004 | PatternFly listed done in one archived requirements doc and not done in another | Canonical status is `active` via `PHX-030` until explicitly reconciled. |
| C-005 | Archived E2E reports/checklists use old scenario/cell counts | Canonical status is `active` via `PHX-044`; tracked matrix script is source of current count truth. |

## Deferred items

| item_id | title | status | priority | source_docs | rationale |
|---|---|---|---|---|---|
| DEF-001 | Placeholder values non-destructive architecture | deferred | p2 | `docs/PLACEHOLDER_VALUES_DEFERRED.md` | Keep deferred until export-token architecture is defined and validated. |
| DEF-002 | Full automation for frontend data-copy parity checks in CI | deferred | p2 | `docs/DATA_AND_FRONTEND_COPIES.md`, `.github/workflows/ci.yml` | Requires additional script and CI integration; low-risk to defer in first pass. |
| DEF-003 | Deep per-scenario verification sweep for all status-bearing docs | deferred | p2 | `docs/*_DOC_REVIEW_AND_PLAN.md` | Requires larger implementation sweep; sequence after canonical registry rollout. |

## Completed and verified

Verified items: `DOC-015`, `DOC-017`, `DOC-018`, `DOC-024`, `DOC-025`, `DOC-026`, `DOC-027`.

## Intake template for future recommendations

Use this template for new requests (for example, "support platform none scenarios across the app"):

```markdown
### request_id: REQ-XXX
- request_title:
- category: docs | helper | backlog | governance | feature
- scope: global | scenario-specific
- scenario_ids:
- motivation:
- affected_sources:
- initial_priority: p0 | p1 | p2 | p3
- status: active
- validation_requirements:
- owner:
```

## Migration rule for old status references

When updating any status-bearing working doc:

1. Keep historical narrative if useful.
2. Add: `Canonical status: docs/BACKLOG_STATUS.md`.
3. Remove references to untracked/local-only backlog files.

## Low-risk migration sequence

Use this order to reduce churn and avoid context loss:

1. Establish canonical authority links (`docs/INDEX.md`, this file, `docs/HELPER_USAGE.md`, `AI_GOVERNANCE.md`).
2. Normalize broken/missing references to tracked docs.
3. Reconcile status labels in high-traffic docs and add superseded pointers.
4. Reconcile machine-readable contradictions (scenario IDs, docs host links) with evidence.
5. Add archive banners to superseded historical docs after their key context is captured here.

## Conflict resolution workflow

1. If two docs disagree, open or update one item row in this file.
2. Attach evidence paths from code/tests/CI to the row.
3. Set canonical status and next action in this file.
4. In older docs, add a short note pointing to this item row as canonical status.
