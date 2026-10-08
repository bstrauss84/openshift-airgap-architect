# OCP 4.22 pre-flip verification — Tranche 4, corrected by Tranche 4A

> **Superseded by Tranche 5.** When this document was written, 4.22 was not supported
> and nothing in Tranche 4 or 4A enabled it — §11 records that fail-closed state, which
> was accurate at the Tranche 4A commit. The atomic flip landed in **Tranche 5**; see
> [`TRANCHE_5_ATOMIC_SUPPORT_FLIP.md`](TRANCHE_5_ATOMIC_SUPPORT_FLIP.md). This document
> is retained as the pre-flip evidence and as the authoritative S1–S11 flip checklist;
> its present-tense claims about 4.22 being unsupported describe the pre-flip state.
>
> **Tranche 4 outcome: the atomic flip was BLOCKED** — blockers **B1** and **G2**,
> coverage gaps **G1** and **G3**, plus pre-existing defect **B2**.
>
> **Tranche 4A outcome: G2 CLOSED, G3 CLOSED, B1 DISPOSED (research complete,
> production change owned by Tranche 5), B2 recorded as independent backlog debt,
> G1 deferred to post-flip Tranche 6 by decision.**
>
> Status authority remains [`../../BACKLOG_STATUS.md`](../../BACKLOG_STATUS.md).

Baseline: `c1af5446cfd47191b2c24dabad2e51ceda036a63`
(`feat(v2.1): complete OpenShift 4.22 tranche 3 prerequisites`), with all six
`develop` / work-branch refs equal at that commit.

---

## 1. Scope

### Tranche 4 — verification only

| Added | Kind |
|---|---|
| `backend/test/t4-d3-generation-matrix.test.js` | test |
| `frontend/tests/t4-quick-pick-catalog-verification.test.js` | test |
| `scripts/t4-flip-surface-inventory.test.mjs` | test |
| `docs/minor-release/4.22/operator-catalog-scan-4.22.json` | acquired evidence |
| this document | evidence |

No file under `backend/src`, `frontend/src` or `shared/` was modified in Tranche 4.

### Tranche 4A — bounded correction

Tranche 4A *does* change production code, which Tranche 4 deliberately did not. The
change is confined to closing G2 and G3; it adds no support for 4.22.

| Path | Kind | Finding |
|---|---|---|
| `shared/scenarioId.js` | new — canonical `(platform, method) → scenarioId` | G2 |
| `backend/src/archSupportData.js` | new — backend loader for `data/arch-support/` | G2 |
| `backend/src/generate.js` | modified — target-architecture assertion at both builders | G2 |
| `frontend/src/hostInventoryV2Helpers.js` | modified — `getScenarioId` delegates to the shared map | G2 |
| `scripts/validate-supported-minors.mjs` | modified — bidirectional support-metadata invariant | G3 |
| `scripts/validate-supported-minors.test.mjs` | modified — 8 new tests | G3 |
| `scripts/t4-flip-surface-inventory.test.mjs` | modified — P11 inverted, P12 added | G3 |
| `backend/test/t4-d3-generation-matrix.test.js` | modified — gap tests inverted | G2 |
| `backend/test/imageset-config-schema.test.js` | modified — arch shapes narrowed | G2 |
| `frontend/tests/t4-quick-pick-catalog-verification.test.js` | modified — B1 block, silent-disappearance invariant | B1 |
| `docs/minor-release/4.22/rhoai-package-evidence-4.22.json` | acquired evidence | B1 |
| this document | evidence — rewritten with the Tranche 4A outcomes | all |
| `docs/BACKLOG_STATUS.md` | DOC-183 / DOC-184 / DOC-185 added | B2, Findings Queue |
| `docs/minor-release/4.22/ODF_OPERATOR_EVIDENCE_4.22.md` | Quick Pick count corrected to 21 = 5 + **16** | count |
| `docs/minor-release/4.22/TRANCHE_3_RUNTIME_PREREQUISITES.md` | same count corrected in the tranche-ownership table | count |
| `docs/minor-release/4.22/TRANCHE_2_ASSET_AUTHORING_4.22.md` | field-delta evidence wording; new §2.6 | §9 cleanup |

**No new support table, no 4.22 special case, no independent architecture allowlist, and
no support-widening loader or production bypass were created.** The generation guard
consults the existing `shared/archSupport.js` resolver over the existing canonical
`data/arch-support/<minor>.json` dataset.

---

## 2. D3 architecture matrix against real generated output

| Metric | Value |
|---|---|
| Cells evaluated | **96** (4.20 + 4.21 × 12 scenarios × 4 architectures) |
| `supported` — real-YAML positive cases | **30** |
| `hidden` — negative cases | **66** |
| `locked` | **0** |
| `unknown` | **0** |
| Failures | **0** |
| **4.22 cells exercised against real output** | **0 — see gap G1** |
| Tests in `t4-d3-generation-matrix.test.js` after Tranche 4A | **145**, 0 fail |

For all 30 supported cells both `controlPlane.architecture` and
`compute[0].architecture` carry the expected value in real parsed YAML, the
imageset payload `mirror.platform.architectures` agrees with install-config, no
minor leaks another minor's channel, and an unsupported minor produces no output.

**In Tranche 4 the 66 hidden cells were negative cases only in the sense that the
matrix declared them hidden — generation accepted them anyway (finding G2). After
Tranche 4A they are negative cases in generated output too: every one is now refused
before any YAML is produced.** The "identical emission at every supported minor" loop
was scoped to the offered architectures accordingly.

**There are no `locked` cells.** The matrix declares none, so "locked cannot be
overridden" has nothing to verify and is reported as vacuous rather than as a pass.

Axis independence holds in real output: `openshiftInstaller.js` never reads
`blueprint`, `installerPlatformArch` is read only from `exportOptions`,
`ocMirrorRuntime.js` uses `process.arch`, and changing `blueprint.arch` leaves
`exportOptions` untouched.

### G1 — 4.22 real output is not reachable (coverage gap)

`buildInstallConfig()` and `buildImageSetConfig()` assert a supported minor
before doing anything. That is correct and neither Tranche 4 nor Tranche 4A weakened
it, so the 48 cells of the 4.22 matrix could not be exercised against real YAML. The
only ways to produce real 4.22 output today are to change `SUPPORTED_MINORS` or to
add a production bypass, both of which both tranches forbid.

What narrows the gap, asserted rather than assumed: **the architecture emission
path takes the minor as no input.** `normalizeBlueprintArch` is a four-line
mapping with no minor parameter and no version branch, and the same architecture
emits identically at every supported minor. Both properties are pinned by tests,
so if emission ever becomes minor-dependent the gap stops being benign and those
tests fail.

**Residual risk: low. Status: OPEN — deferred to Tranche 6 by decision.**

**Why it is not closed here.** The only two ways to exercise real 4.22 output are to
change `SUPPORTED_MINORS` or to add a production bypass. A test-only
support-widening loader was considered in Tranche 4 and rejected; that rejection is
affirmed, not merely tolerated — a loader that can widen support for a test is a
loader that can widen support, and the fail-closed policy is the product's main
defence against a partial flip. Tranche 4A introduces **no** such mechanism.

**What the deferral costs, stated exactly.** The 48 cells of the 4.22 architecture
matrix are verified against the canonical dataset and against the resolver, but not
against parsed 4.22 YAML. The residual risk is bounded by the two pinned properties
above (emission takes no minor input; identical emission at every supported minor),
both of which the G2 guard now also exercises for the architectures it refuses.

**Closure condition for Tranche 6:** re-run `backend/test/t4-d3-generation-matrix.test.js`
with `"4.22"` added to its minor list, post-flip. Expected result: 48 further cells,
12 supported, 36 hidden, 0 failures.

> **Corrected in Tranche 5.** The cell count (48) was right; "12 supported, 36 hidden"
> was not. It contradicts §2 of this same document, which states the supported
> distribution is `{x86_64: 12, aarch64: 3}` — **15** per minor, not 12 — so the figure
> omitted the three `aarch64` cells. The matrix derives its minor list from
> `SUPPORTED_MINORS`, so it auto-extended at the flip with no edit, and the measured
> result is **48 further cells, 15 supported, 33 hidden, 0 failures**, giving totals of
> 144 / 45 / 99. The dataset is 15/33 at every minor, 4.22 included. An arithmetic slip
> in this paragraph, not a change in the data.

### G2 — a hidden architecture was not rejected by generation — **CLOSED in Tranche 4A**

#### Root cause

| Layer | Finding |
|---|---|
| **Symptom** | A state carrying `vsphere-ipi` + `aarch64` — `hidden` at every minor, because the vSphere book documents `amd64` only — generated `architecture: arm64` into install-config *and* `architectures: [arm64]` into imageset-config. |
| **Immediate mechanism** | `buildInstallConfig()` and `buildImageSetConfig()` asserted the **minor** and then passed `blueprint.arch` through `normalizeBlueprintArch`, a four-line pure mapping with no support check and a pass-through default. No code path validated target-cluster architecture support. |
| **Lifecycle / system cause** | Tranche 3 made D3 the runtime architecture authority **on the UI surface only** — because that was the only surface that had an architecture gate to migrate. Generation never had one, so there was nothing to migrate and the absence was invisible to a migration-shaped review. The authority moved; the unguarded boundary stayed unguarded. |
| **Blast radius** | Every non-UI route into state: **import of a state saved by v2.0.0** (whose `PLATFORM_ARCH_SUPPORT` *did* offer vSphere `aarch64` and AWS GovCloud `aarch64`, so real saved states carry combinations D3 now closes), a direct `POST /api/state`, and any future non-UI path. Both generated artifacts, at every supported minor. |
| **Authoritative fix** | Assert target-architecture support at the generation boundary, from the same resolver and the same canonical dataset the UI uses. |

#### The fix

`assertTargetArchitectureSupported(state, selectedMinor)` runs immediately after the
existing minor assertion in **both** `buildInstallConfig()` and `buildImageSetConfig()`,
before any YAML is produced. It:

1. reads `blueprint.arch`; **absent architecture emits nothing and is not an error**, which is the pre-existing contract;
2. normalises the alias spellings `amd64`→`x86_64` and `arm64`→`aarch64` — these denote the same architectures and have always generated correctly, so rejecting them would be a regression, not a fix;
3. resolves `(platform, installMethod)` to a scenario id through the new **shared** `shared/scenarioId.js` — the frontend helper now delegates to the same map, so there is one table and two consumers rather than a duplicated platform/method table;
4. calls `resolveArchitectureSupport()` from `shared/archSupport.js` over `data/arch-support/<minor>.json`, loaded by `backend/src/archSupportData.js` (path convention copied from `catalogValidator.js`; fails closed on a missing or malformed file);
5. throws `UNSUPPORTED_ARCHITECTURE` when the cell is not `offered`.

For a state whose platform/method pair is **not** a modelled scenario, the guard still
refuses an architecture the product does not model at all, and refuses one no scenario
offers at that minor — so an unmodelled scenario is not an escape hatch.

**It does not silently rewrite, coerce, or drop the architecture**, and it does not fall
back to `amd64`. The error names the architecture, the minor, the platform, the install
method, the scenario id and the disposition, and carries no other state — no sensitive
state is dumped.

#### Verified

| Case | Result |
|---|---|
| `vsphere-ipi` + `aarch64`, install-config | **REJECTED** `UNSUPPORTED_ARCHITECTURE`, `disposition=hidden`, `scenarioId=vsphere-ipi` |
| `vsphere-ipi` + `aarch64`, imageset-config | **REJECTED**, same code |
| every `hidden` cell in the matrix, both builders | **REJECTED** (parameterised over `HIDDEN_CELLS`) |
| every `supported` cell | still emits, unchanged |
| alias spellings `amd64` / `arm64` | still emit |
| `blueprint.arch` unset | still emits nothing, no error |
| a rejected call | **produces no YAML at all** — asserted, not assumed |
| an architecture the product does not model | **REJECTED** |
| the guard reads the shared resolver, not a local table | asserted (`PLATFORM_ARCH_SUPPORT` absent from the function body, comments stripped before matching) |
| export/download and runtime architecture axes | unaffected — cross-axis test retained |

#### Intended behaviour change, recorded rather than buried

`ppc64le` and `s390x` are `hidden` for **every** scenario at **every** minor in the
canonical dataset, so they can no longer be generated at all. The supported distribution
is `{x86_64: 12, aarch64: 3}` per minor. Pre-existing 4.20/4.21 states carrying
vSphere/AWS-GovCloud `aarch64` or bare-metal `ppc64le`/`s390x` now fail with a named
error instead of generating an install-config the product does not claim to support.
That is the point of the fix, and it is a behaviour change for *currently supported*
minors — `backend/test/imageset-config-schema.test.js` was narrowed accordingly, keeping
its assertions that the `ppc64le`/`s390x` **mappings** are still recorded while the
**generation** of them is refused.

---

## 3. `provisioningNetworkGateway` real-output verification

Verified through real `buildInstallConfig` output at 4.20/4.21 and through the
existing exported seam for the 4.22 rule (48 tests, all passing):

| Case | Result |
|---|---|
| Managed + valid IPv4 | emits |
| Managed + valid IPv6 | emits |
| blank / absent | no emission |
| Unmanaged | no emission |
| Disabled | no emission |
| outside CIDR (v4 and v6) | rejected |
| DHCP-range overlap (v4 and v6) | rejected |
| equals provisioning IP (v4 and v6) | rejected |
| address-family mismatch | rejected, both directions |
| 4.20 / 4.21 install-config | **byte-identical** with and without the field in state |
| Agent scenario | no control, no emission, `hidden-not-applicable` |

The preview/review generation path is `buildPreviewFiles`, which calls
`assertSupportedOpenShiftVersion` before any builder — so its 4.22 behaviour
shares gap **G1** and is verifiable only post-flip.

---

## 4. Operator Quick Pick verification against the real 4.22 catalog

Catalogs scanned with `oc-mirror --v2 list operators` against
`registry.redhat.io` on 2026-10-08 and committed as
[`operator-catalog-scan-4.22.json`](operator-catalog-scan-4.22.json) (redhat
4.20/4.21/4.22 and certified 4.22; 151 packages in redhat 4.22). Tests read the
fixture, never the network.

**Count correction.** The accepted Tranche 1 evidence says *"20 Quick Picks …
15 are flat"*. There are **21: 5 version-aware and 16 flat**. The `scenarios`
array is byte-identical to its state at the Tranche 1 commit, so this is an
off-by-one in the evidence document, not a code change. All **16** were verified.

| # | Quick Pick | Packages | 4.22 result |
|---|---|---|---|
| 1 | `virtualization` | kubevirt-hyperconverged, mtv-operator, kubernetes-nmstate-operator | ✅ all present |
| 2 | `local-storage` | lvms-operator, local-storage-operator | ✅ |
| 3 | `openshift-ai` | rhods-operator, **rhods-prometheus-operator**, nfd, gpu-operator-certified | ❌ **1 missing** |
| 4 | `compliance` | compliance-operator, file-integrity-operator | ✅ |
| 5 | `disconnected` | cincinnati-operator | ✅ |
| 6 | `qol` | web-terminal, devspaces, rhdh | ✅ |
| 7 | `node-health` | self-node-remediation, fence-agents-remediation, node-healthcheck-operator, node-maintenance-operator, node-observability-operator | ✅ |
| 8 | `gitops` | openshift-gitops-operator | ✅ |
| 9 | `cicd` | openshift-pipelines-operator-rh | ✅ |
| 10 | `logging` | cluster-logging, loki-operator | ✅ |
| 11 | `service-mesh` | servicemeshoperator, kiali-ossm, **jaeger-product** | ❌ **1 missing** |
| 12 | `serverless` | serverless-operator | ✅ |
| 13 | `network-observability` | netobserv-operator | ✅ |
| 14 | `cost-management` | costmanagement-metrics-operator | ✅ |
| 15 | `quay` | quay-operator | ✅ |
| 16 | `quay-bridge` | quay-operator, quay-bridge-operator | ✅ |

**31 of 33 package references verified present. 2 unresolved.**

### B1 — `rhods-prometheus-operator` — **DISPOSED in Tranche 4A: omit, no replacement**

Present in the redhat catalog at **4.20 and 4.21**, **absent at 4.22**. The
`openshift-ai` Quick Pick is version-independent, so at 4.22 it would name a
package the catalog does not carry. `applyScenario` skips a not-found package
**silently** (`if (!found) return;`, no warning), so the user would mirror three
operators instead of four and be told nothing. This is exactly plan **O5**.

#### Evidence

Acquired as a Tranche 4A acquisition step and committed as
[`rhoai-package-evidence-4.22.json`](rhoai-package-evidence-4.22.json) — the real
declarative-config (FBC) for both packages, extracted from the pinned index digests with
`oc image extract --path=/configs/<package>/`. Tests read the fixture, never the network.

| Question | Answer | Source |
|---|---|---|
| Is it an OLM dependency of `rhods-operator`? | **No.** `rhods-operator` declares **zero** `olm.package.required` and **zero** `olm.gvk.required` properties on **any** bundle at 4.20, 4.21 or 4.22. | FBC |
| Does any `rhods-operator` bundle reference it? | **No.** The string `rhods-prometheus-operator` occurs **0** times in the `rhods-operator` FBC at all three minors. | FBC |
| Was it ever a shipping component? | It is **one** bundle, `rhods-prometheus-operator.4.10.0`, `createdAt 2021-04-15`, published **only** on a `beta` channel. The 4.20 and 4.21 FBC files are **byte-identical** (`859e97d2…`) — a frozen artifact carried forward unchanged, then dropped. | FBC |
| Does the 4.22 operator ship Prometheus images? | **No.** The `stable-3.x` head `rhods-operator.3.5.1` has 150 `relatedImages` and **none** is a Prometheus image. Bundles ≤ `3.0.0` vendored four `openshift4/ose-prometheus-*` images **inside the rhods-operator bundle**; `3.2.0` and later (there is no 3.1.x) carry none. Those were never the separate package. | FBC |
| Does Red Hat's own disconnected-install guide name it? | **No.** The RHOAI Self-Managed 3.3 disconnected-install guide's `ImageSetConfiguration` example names exactly one OpenShift AI package, `rhods-operator`, and the string `prometheus` does not occur anywhere in the document (both halves checked). | [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_openshift_ai_self-managed/3.3/html-single/installing_and_uninstalling_openshift_ai_self-managed_in_a_disconnected_environment/index) |

#### Disposition: **A — omit at 4.22 with no replacement**

**No replacement is claimed, because no evidence supports one.** `odf-prometheus-operator`
is present at 4.22 and has a similar name; it is an OpenShift Data Foundation component
with a different bundle image and purpose, and nothing links it to OpenShift AI. A
similar name is not evidence.

**Exact intended 4.22 `openshift-ai` package set:**

| Catalog | Packages |
|---|---|
| `redhat` | `rhods-operator`, `nfd` |
| `certified` | `gpu-operator-certified` |

All three verified present in the real 4.22 catalogs. This is the current set minus the
one package — nothing is added.

**4.20 / 4.21 behaviour is preserved as-is by this tranche.** The evidence does argue
the entry is *independently* wrong at 4.20/4.21 too — a beta-channel-only 2021 artifact
that the operator never required and the documentation never names — but removing it
there is a change to currently-shipping behaviour on supported minors, so it is the
human's call in Tranche 5, not a side effect of a 4.22 tranche. Both options are listed
in the Tranche 5 checklist.

**Production timing: Tranche 5 (S10). Not enabled now** — a test pins that the
production Quick Pick still names the package, and fails the moment S10 lands.

#### New invariant: a required Quick Pick package cannot disappear silently

`frontend/tests/t4-quick-pick-catalog-verification.test.js` now checks every flat Quick
Pick package against every scanned catalog (`redhat` at 4.20/4.21/4.22, `certified` at
4.22) and **fails on any absence that is not explicitly dispositioned**, naming the
package and the minor. The disposition registry is exact in both directions: listing a
minor where the package is in fact present fails too, so a disposition cannot outlive the
fact it describes, and an unused entry fails as dead weight. B1 and B2 are its only two
entries.

### B2 — `jaeger-product` — recorded as independent backlog debt

Absent at **4.20, 4.21 and 4.22 alike**, so it is **not a 4.22 regression** and it is
**not caused by, and does not block, the flip** — the behaviour is identical before and
after. The `service-mesh` Quick Pick has been silently under-delivering on every
supported minor.

`tempo-product` and `opentelemetry-product` **are** present in the 4.22 catalog. That is
recorded as a fact about the catalog, **not** as a claim that either replaces
`jaeger-product` in this Quick Pick: no evidence was gathered for a replacement, and a
plausible successor is not a verified one. Deciding the `service-mesh` package set needs
its own evidence pass against Red Hat's distributed-tracing documentation.

**Disposition: independent backlog debt, tracked separately from the 4.22 onboarding, for
pre-release closure.** See `DOC-184` in [`../../BACKLOG_STATUS.md`](../../BACKLOG_STATUS.md).

### Version-aware picks — Tranche 5 input

All 14 candidate ODF packages exist in the real 4.22 catalog, including
`ocs-tls-profiles` (confirmed **new at 4.22**: absent from the 4.21 catalog) and
`odr-volsync-plugin-operator`. Tranche 5 can author the `"4.22"` rows from
verified evidence. No version-aware pick carries a `"4.22"` row yet, and
`"default"` is still present — the correct pre-flip state.

---

## 5. Atomic flip-surface inventory

### Requires a direct Tranche 5 edit

| # | Path | Symbol / key | Pre-flip | Post-flip | Why atomic |
|---|---|---|---|---|---|
| S1 | `backend/src/versionPolicy.js` | `SUPPORTED_MINORS` | `["4.20","4.21"]` | `+ "4.22"` | every backend gate reads it |
| S2 | `frontend/src/shared/versionPolicy.js` | `SUPPORTED_MINORS` | `["4.20","4.21"]` | `+ "4.22"` | hand-synchronised twin of S1; divergence is detected and fails CI |
| S3 | `backend/src/fieldGuide/versionResolution.js` | `FIELD_GUIDE_SUPPORTED_MINORS` | `["4.20","4.21"]` | `+ "4.22"` | separate declaration; can diverge from S1 |
| S4 | `backend/src/fieldGuide/assembler.js` | import + branch | 4.20/4.21 | `+ compartments_v422` | S3 without S4 resolves a supported minor to nothing |
| S5 | `backend/src/fieldGuide/provenance.js` | `getAuthoritativeExport` | 4.20/4.21 | `+ 4.22` | certification would fail for a supported minor |
| S6 | `scripts/lib/released-minor-support.json` | `previouslyReleasedMinors` | `["4.20","4.21"]` | `+ "4.22"` | **now guarded both ways** — `check:supported-minors` fails if S1/S2 land without it (G3 closed) |
| S7 | both `versionPolicy.js` | `TRUST_BUNDLE_POLICY_ALLOWLIST` | no 4.22 row | add `"4.22": ["Proxyonly","Always"]` | **not in the expected-class list.** The ≥4.17 forward rule already returns the right policies, so this looks optional — but without the row 4.22 resolves `source: "forward"` and `getForwardOpenShiftMinorDocNotice()` shows users of a *supported* minor "OpenShift 4.22 is not yet fully reflected in this tool's version-scrubbed docs index and catalogs", which would be false |
| S8 | `e2e/helpers/asset-validation.js` | `SUPPORTED_VERSIONS` | 4.20, 4.21 | `+ 4.22` | E2E asset validation would skip 4.22 |
| S9 | `frontend/src/steps/OperatorsStep.jsx` | `versionPicks` | no `"4.22"` row; `"default"` present | add 5 `"4.22"` rows **and** remove `default` | adding rows alone leaves the fallback live; removing `default` alone breaks 4.20/4.21 |
| S10 | `frontend/src/steps/OperatorsStep.jsx` | `openshift-ai` picks | `redhat: [rhods-operator, rhods-prometheus-operator, nfd]`, `certified: [gpu-operator-certified]` | drop `rhods-prometheus-operator` per **B1** | the package does not exist at 4.22; the Quick Pick is version-independent, so the row cannot differ by minor without converting it to `versionPicks` |
| S11 | ~31 test files | pinned `["4.20","4.21"]` | pinned | update together | enumerated now so the flip does not discover them |

### No direct Tranche 5 edit required — derived

| # | Surface | Derivation |
|---|---|---|
| D1 | `frontend/src/catalogPaths.js` | `import.meta.glob` + `SUPPORTED_MINORS.includes()`; the 4.22 catalogs are already on disk and become resolvable the moment S2 lands |
| D2 | `frontend/src/docsIndexResolver.js` | same pattern; no static import map remains |
| D3 | `frontend/src/archSupportResolver.js` | filters its dataset on `SUPPORTED_MINORS` at module scope |
| D4 | version-awareness baseline | `SUPPORTED_MINORS[0]`, deliberately unchanged at 4.20 |
| D5 | trust-bundle **policy list** for 4.22 | already correct via the ≥4.17 forward rule (only the `source`/notice needs S7) |

---

## 6. Partial-flip adversarial matrix

| # | Partial state | Result |
|---|---|---|
| P1 | backend supports 4.22, frontend does not | **detected** |
| P2 | frontend offers 4.22, backend rejects | **detected** |
| P3 | released metadata claims 4.22, code does not support it | **detected** (superset guard) |
| P4 | coherent full flip | **accepted** — the guard is not vacuous |
| P5 | architecture data visible before version support | **closed** by the adapter's `SUPPORTED_MINORS` filter |
| P6 | catalogs resolve 4.22 while the Field Guide rejects it | two separate declarations, pinned equal pre-flip |
| P7 | Quick Pick `"4.22"` rows added before support | **detected** by the Tranche 3 tripwire |
| P8 | support enabled while Quick Pick rows absent | **detected** by the per-minor row assertion |
| P9 | flipped but S7 omitted | **reproduced**: 4.22 keeps a false "not yet reflected" caveat |
| P10 | the guard's detection boundary, stated exactly | three widening shapes, all **detected** |
| P11 | code supports 4.22, released metadata omits it | **DETECTED** — was the G3 gap, now closed |
| P12 | a coherent full flip, after the G3 fix | **accepted** — the new invariant is not vacuous |

### G3 — one partial state passed every guard — **CLOSED in Tranche 4A**

**The gap.** `validate-supported-minors` enforced that `SUPPORTED_MINORS` is a
**superset** of the recorded released minors — it stops a released minor being dropped.
It did not require the converse, so flipping S1/S2 while forgetting S6 passed silently.
Second-order consequence: with 4.22 supported but unrecorded, a later change could remove
4.22 from `SUPPORTED_MINORS` and the cumulative guard would raise nothing, because it
never learned 4.22 had shipped.

**The fix.** Two checks were added to `scripts/validate-supported-minors.mjs`, ahead of
the baseline guard:

| Check id | Enforces |
|---|---|
| `support-metadata-bidirectional` | every minor in `SUPPORTED_MINORS` also appears in `previouslyReleasedMinors`. With the existing superset check, support and record are now **equal sets** — enabling a minor and recording it are one atomic change, in both directions. |
| `support-metadata-well-formed` | every record entry is a well-formed `<major>.<minor>` string, with no duplicates. Added because the new equality check is only as trustworthy as the record it reads. |

The error names the offending minors and both lists, and says why the two must move
together.

**Not raw key equality.** The invariant compares `SUPPORTED_MINORS` against
`previouslyReleasedMinors` only. `baselineMinor` is a separate field with separate
semantics and is deliberately left to the pre-existing baseline guard; no other key in
`released-minor-support.json` is folded into the comparison, so intentionally
unsupported, future or historical metadata in that file cannot be mistaken for a support
claim.

**Verified** — 8 new tests in `scripts/validate-supported-minors.test.mjs` plus the
inverted P11 and the new P12:

| Case | Result |
|---|---|
| code supports a minor the record omits | **FAILS** `SUPPORT METADATA INCOMPLETE` |
| record claims a minor the code does not support | **FAILS** (superset guard, unchanged) |
| a currently supported minor disappears from the record | **FAILS** |
| a currently supported minor disappears from the code | **FAILS** |
| duplicate record entry | **FAILS** |
| malformed record entry | **FAILS** |
| a complete, coherent flip | **PASSES** — not vacuous |
| the current pre-flip state `[4.20, 4.21]` | **PASSES** |

Three pre-existing tests encoded the old one-way semantics (widen the code, leave the
record behind) and were updated to record the minor as well — which is the atomicity the
invariant exists to enforce, not a weakening of those tests.

**S6 is no longer an unbacked checklist item.** `npm run check:supported-minors` now
fails the flip if `released-minor-support.json` is not updated in the same commit.

---

## 7. Field Guide, catalog and docs-index pre-flip readiness

**Field Guide — READY.** 9 modules, 40 compartments, all `version: "4.22"`, ids
and ordering identical to v4.21, zero unclassified 4.21 copy, the Class-C
allowlist is exactly 5 entries and unchanged, all doc references carry 4.22
provenance and none cites a book path that does not exist at 4.22. The wiring
Tranche 5 needs is fully identified (S3–S5) and no hidden runtime dependency
remains: `assembler.js` and `provenance.js` contain no reference to v4.22.

**Catalogs / docs-index — READY.** 12 canonical 4.22 scenarios validate, 1,097
parameters, zero `unknown-needs-review`, mirrors exact, same-minor citation guard
clean across 3,390 citations, docs-index canonical and mirror match, and the
production resolvers still reject 4.22.

---

## 8. Backlog dispositions

| Item | Status after Tranche 4A |
|---|---|
| **DOC-156** | Runtime resolver complete (Tranche 3) and now authoritative at the **generation** boundary too (G2). Real-output residual **verified for 4.20/4.21**; the 4.22 half is **open as G1** and closes in Tranche 6. |
| **DOC-166** | Reconfirmed: global ImageSetConfig authority is authoritative, no 4.22 per-minor catalog is required, legacy 4.20 catalog retirement stays non-blocking, and the flip does not depend on deleting it. |
| **DOC-179** | Does **not** block the flip. No flip surface reads the 4.20/4.21 Field Guide `docRefs`. Pre-release obligation. |
| **DOC-180** | Does **not** block the flip. 4.22 has its own `azure-government-upi` entry; the 4.20/4.21 gap is independent. Pre-release obligation. |
| **DOC-183** | This tranche pair: pre-flip verification plus the G2/G3 corrections. `done_pending_verification` until committed. |
| **DOC-184** | **B2** — `service-mesh` Quick Pick names `jaeger-product`, absent at 4.20/4.21/4.22. Independent backlog debt; **not** a 4.22 regression, **not** a flip blocker. Needs its own evidence pass before any package is substituted. |
| **DOC-185** | **Findings Queue** — the v4.22 Field Guide carries a Technology-Preview caveat for `osImageStream` (RHEL 10) but none for the other two 4.22 TP surfaces a user will meet in Red Hat's own 4.22 AWS documentation: `platform.aws.ipFamily` (dual-stack) and `*.hostPlacement` (Dedicated Hosts), both classified `docs-only-not-supported`. Not a flip blocker; recorded rather than silently expanding Tranche 4A's scope. |
| **Agent sibling provisioning fields** | Pre-existing cross-minor taxonomy debt, recorded in the Tranche 3 evidence. Not introduced by 4.22, **not a flip blocker**; resolve before release-quality closure since it affects user-facing semantics. |

---

## 9. Tranche 5 checklist

One commit. Nothing below may land alone.

| # | Surface | Action |
|---|---|---|
| 1 | S1 `backend/src/versionPolicy.js` | `SUPPORTED_MINORS` += `"4.22"` |
| 2 | S2 `frontend/src/shared/versionPolicy.js` | same |
| 3 | S7 both policy modules | `TRUST_BUNDLE_POLICY_ALLOWLIST["4.22"] = ["Proxyonly","Always"]` |
| 4 | S3 `fieldGuide/versionResolution.js` | `FIELD_GUIDE_SUPPORTED_MINORS` += `"4.22"` |
| 5 | S4 `fieldGuide/assembler.js` | import `compartments_v422`, add the branch |
| 6 | S5 `fieldGuide/provenance.js` | import and return `compartments_v422` for `"4.22"` |
| 7 | S6 `scripts/lib/released-minor-support.json` | append `"4.22"` — **now enforced**, `check:supported-minors` fails without it |
| 8 | S8 `e2e/helpers/asset-validation.js` | add the 4.22 entry |
| 9 | S9 `OperatorsStep.jsx` | add 5 `"4.22"` `versionPicks` rows (ODF packages verified present) **and** remove `"default"` |
| 10 | S10 `OperatorsStep.jsx` | `openshift-ai`: drop `rhods-prometheus-operator` per **B1** |
| 11 | S11 | update the ~31 test files pinning `["4.20","4.21"]` |
| 12 | `frontend/tests/t4-quick-pick-catalog-verification.test.js` | remove the B1 pin ("4.22 is NOT yet wired") and the `rhods-prometheus-operator` disposition entry — the invariant will then require the package to be gone from the Quick Pick, not dispositioned |
| 13 | — | re-run the full certification set and the security gate |

### Decisions the human owns before Tranche 5

| Item | Decision needed |
|---|---|
| **B1 at 4.20/4.21** | S10 removes `rhods-prometheus-operator` outright (one flat list, no minor branch) — **or** `openshift-ai` is converted to `versionPicks` to keep the package at 4.20/4.21. The evidence (§4) argues it is wrong at every minor, so removing it outright is the smaller and better-supported change, but it alters currently-shipping behaviour on supported minors. |
| **G1** | Confirmed **deferred to Tranche 6**. No action in Tranche 5. |

**No longer blocking:** **G2** (closed), **G3** (closed). **B2** (DOC-184), **G1**,
DOC-179, DOC-180 and DOC-185 do not block the flip.

---

## 10. 4.22 vs 4.21 field delta, and where each field is represented

Three counts describe the same change and are not interchangeable — see
[`TRANCHE_2_ASSET_AUTHORING_4.22.md`](TRANCHE_2_ASSET_AUTHORING_4.22.md) §2.6:

| Count | Value |
|---|---|
| install-config parameter paths, exact 4.21.35 → exact 4.22.16 | 1,104 → **1,127** |
| installer paths **added** | **23** |
| installer paths **removed** | **0** |
| agent-config paths | 21 → **21**, deltas of any class: **0** |
| type / requiredness / structure changes | **0 / 0 / 0** |
| enum changes | **1** |
| new deprecation markers | **2** |
| distinct catalog paths added | **9** |
| catalog **rows** added | **46** (9 paths × the scenarios that model their parent surface) |

**Nothing was removed.** The only 4.21 → 4.22 subtractions are two *deprecation markers*
on paths that still exist and are still accepted by the 4.22.16 binary
(`platform.baremetal.bootstrapOSImage`, `platform.baremetal.clusterOSImage`); neither is
removed from install-config and neither changes Architect's behaviour.

### The 9 catalog paths: representation today, and whether that is right

"FE" = a user-facing control in the frontend. "BE" = read or emitted by the backend
generator. "FG" = a Field Guide compartment.

| # | Path | `supportStatus` | FE | BE | FG | Should it have representation? |
|---|---|---|---|---|---|---|
| 1 | `platform.baremetal.provisioningNetworkGateway` | `supported-ui` (`bare-metal-ipi`) / `hidden-not-applicable` (`bare-metal-agent`) | ✅ control + validation | ✅ validated and emitted, gated `>= 4.22` | ✅ | **Yes, both — and it has both.** The only new 4.22 field Red Hat documents as a supported install-config parameter. Correct as built. |
| 2 | `osImageStream` | `docs-only-not-supported` | ❌ | ❌ | ✅ TP caveat | **No control, yes guidance.** RHEL 10 is Technology Preview at 4.22 and needs `TechPreviewNoUpgrade`, which Architect does not generate. A control would imply support the product does not have; the caveat tells the user why their cluster is RHEL 9. Correct as built. |
| 3 | `platform.aws.ipFamily` | `docs-only-not-supported` | ❌ | ❌ | ❌ | **No control. A Field Guide caveat is arguably missing** — AWS dual-stack is documented and TP at 4.22, so a GovCloud user reading Red Hat's 4.22 AWS book will meet it. Recorded as **DOC-185**. |
| 4 | `platform.azure.ipFamily` | `hidden-not-applicable` | ❌ | ❌ | ❌ | **No, correctly.** Mechanically present in 4.22.16 source but **undocumented** at 4.22 — no same-minor citation exists to carry, and runbook Rule 2 forbids turning absence of documentation into support. |
| 5 | `controlPlane.management` | `hidden-not-applicable` | ❌ | ❌ | ❌ | **No, correctly.** DevPreview-only and undocumented. |
| 6 | `compute[].management` | `hidden-not-applicable` | ❌ | ❌ | ❌ | **No, correctly.** Same. |
| 7 | `controlPlane.platform.aws.hostPlacement` | `docs-only-not-supported` | ❌ | ❌ | ❌ | **No control.** AWS Dedicated Hosts, TP at 4.22, and meaningless without real dedicated-host IDs the airgap workflow cannot supply. Same missing-caveat note as #3 — **DOC-185**. |
| 8 | `compute[].platform.aws.hostPlacement` | `docs-only-not-supported` | ❌ | ❌ | ❌ | **No.** Same. |
| 9 | `platform.aws.defaultMachinePlatform.hostPlacement` | `docs-only-not-supported` | ❌ | ❌ | ❌ | **No.** Same. |

Verified by grep over `backend/src`, `frontend/src` and `shared/`: `ipFamily`,
`hostPlacement` and `.management` have **zero** production references;
`provisioningNetworkGateway` has 24 across generation, shared validation, the frontend
step and the Field Guide; `osImageStream` has exactly one, the Field Guide caveat.

**Summary: 1 of 9 should be represented in both the frontend and the backend, and is.
The other 8 should be in neither, and are not. 1 of those 8 carries user-facing guidance
and should; 2 more arguably should and do not (DOC-185).** No field is represented in
only one half by accident.

The 14 installer paths that exist at 4.22 but have **no** catalog row at all are the
`hostPlacement` leaf paths (recorded in their parent row's `versionNotes`) and the
`arbiter.*` mount points (no 4.21 catalog models `arbiter.platform.aws.*`). Both
omissions are deliberate and pre-date 4.22.

---

## 11. Fail-closed proof after Tranche 4A

Re-verified at the end of this tranche, with production code now changed:

| Surface | State |
|---|---|
| `backend/src/versionPolicy.js` `SUPPORTED_MINORS` | `["4.20","4.21"]` |
| `frontend/src/shared/versionPolicy.js` `SUPPORTED_MINORS` | `["4.20","4.21"]` |
| `FIELD_GUIDE_SUPPORTED_MINORS` | `["4.20","4.21"]` |
| `scripts/lib/released-minor-support.json` | `["4.20","4.21"]`, baseline `4.20` |
| `buildInstallConfig` / `buildImageSetConfig` for 4.22 | reject before the new architecture guard is even reached — the minor assertion still runs first |
| `getAuthoritativeExport("4.22")` | `null` |
| catalog / docs-index / arch-support resolvers | still filter on `SUPPORTED_MINORS` |
| `OperatorsStep.jsx` | no `"4.22"` row; `"default"` still present |
| preview flag for 4.22 | none added |

The G2 guard **cannot** widen support: it runs *after* `assertSupportedOpenShiftMinorForGeneration`,
and its only effect is to refuse more states, never to admit one.
