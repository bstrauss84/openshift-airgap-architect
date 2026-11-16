# OCP 4.22 runtime prerequisites — Tranche 3 evidence

> **4.22 is still UNSUPPORTED and fail-closed.** Tranche 3 implements the runtime
> prerequisites *behind* the closed gate. `SUPPORTED_MINORS` is unchanged, no public
> boundary accepts 4.22, and the support flip has not begun.
>
> Status authority remains [`../../BACKLOG_STATUS.md`](../../BACKLOG_STATUS.md).

Baseline: `ee2126b776a083edd261cc52972b84036ed21ee8`
(`feat(v2.1): add OpenShift 4.22 tranche 2 assets`), with `develop`, `origin/develop`,
`continuity/develop` and all three work-branch refs equal at that commit.

---

## 1. Workstream A — D3 is now the runtime architecture authority

### 1.1 Inventory of pre-existing architecture authorities

Every site that touched a CPU architecture was classified by **axis** before anything
was changed. Conflating the axes is the error this onboarding already made once.

| Location | Axis | Disposition |
|---|---|---|
| `frontend/src/steps/BlueprintStep.jsx` `PLATFORM_ARCH_SUPPORT` | 1 — target cluster | **REPLACED** by the D3 resolver |
| `frontend/src/steps/BlueprintStep.jsx` `allowedArchs` + platform-change reset effect | 1 | **REPLACED** |
| `backend/src/generate.js` `normalizeBlueprintArch` / `archForInstallConfig` | 1 (consumer) | preserved — value mapping, not a support decision |
| `backend/src/generate.js` mirror payload `architectures` | 1 (consumer) | preserved |
| `frontend/src/steps/PlatformSpecificsStep.jsx` (`arch` → AWS AMI lookup) | 1 (consumer) | preserved |
| `frontend/src/exportRunFilename.js` | 1 (consumer) | preserved — filename label |
| `backend/src/installer.js` arch alias map | 1 (consumer) | preserved |
| `backend/src/index.js` `defaultState().blueprint.arch = "x86_64"` | 1 (seed) | preserved — an initial value, not a support claim |
| `frontend/src/steps/ReviewStep.jsx` download selectors | **2 — export binary** | **PRESERVED DELIBERATELY** |
| `backend/src/openshiftInstaller.js` | 2 | preserved |
| `backend/src/index.js` `mirrorRegistryArch` | 2 | preserved |
| `backend/src/ocMirrorRuntime.js` `BAKED_IN_ARCH`, runtime-match checks | **3 — Architect runtime** | preserved |
| `backend/src/operators.js` `ARCH_MISMATCH_SIGNATURES` | 3 | preserved |
| `backend/src/index.js` detected local arch | 3 | preserved |
| `frontend/src/steps/MethodologyStep.jsx` `PLATFORM_METHODS` | none | unrelated — scenario availability, not architecture |

There was **no backend validation of target-cluster architecture at all**. The single
authority on axis 1 was the frontend constant, and it:

- was keyed by platform only, so install method could not vary;
- carried no OpenShift minor, so it could not change across releases;
- fell through `|| archOptions.map((a) => a.value)`, enabling **all four**
  architectures for any platform it did not recognise;
- offered no reason, so the tooltip could only say `Not supported on ${platform}`;
- **asserted more than the documentation supports** — vSphere `aarch64`, AWS GovCloud
  `aarch64` and bare-metal `ppc64le`/`s390x` are documented by no supported minor's
  platform book.

### 1.2 Design

| Piece | Role |
|---|---|
| `data/arch-support/<minor>.json` | canonical authority (unchanged from Tranche 2 except an additive `summary` per cell) |
| `shared/archSupport.js` | pure resolver; dataset injected, no I/O, no matrix of its own |
| `frontend/src/data/arch-support/<minor>.json` | generated UI projection |
| `scripts/sync-arch-support.js` | canonical → projection, with `--check` |
| `frontend/src/archSupportResolver.js` | loading + `SUPPORTED_MINORS` gating |

**Why a projection rather than a verbatim mirror.** 137 KB of the canonical 157 KB is
`reason` prose and per-cell `provenance` quotes — written for auditors and the guard, not
for a disabled-button tooltip. Mirroring it whole would have put ~92 KB of citation text
into the eager bundle that FQ-10 fought to reclaim. The projection keeps the canonical
*shape* (same `matrix`, same `scenarioId`, same per-architecture keys) and drops only the
audit fields, so the one resolver reads either form unchanged and `--check` fails if they
ever disagree. Measured cost: eager bundle 1,150 KB → **1,191 KB** against a 1,320 KB limit.

**The additive `summary` field.** Each cell gained a one-sentence, UI-facing `summary`
(113–189 chars, 144 cells, 20 KB total) carrying the same conclusion as `reason`. The
diff is exactly 144 insertions and nothing else. `reason` and `provenance` stay canonical-only.

**Fail-closed contract.** Unknown minor, unmodelled scenario, unrecognised architecture,
malformed version and future minor all resolve `offered: false` with an explicit
`unresolvedCause`. There is no fallback to another minor, no platform-only lookup that
discards the method, and `offered` is recomputed from the disposition at runtime, so a
hand-edited `offered: true` on a non-supported cell is ignored.

**The one case that needed thought.** Blueprint presents platform, architecture and
release on a single step, so architecture is reachable while `selectedMinor` is still
null. Defaulting to a minor would be precisely the fallback this tranche removes, so the
answer is intersected across `SUPPORTED_MINORS`: an architecture is offered only if
*every* supported minor offers it, and the exact per-minor answer takes over the moment a
release is chosen. That is strictly more conservative than any single minor and cannot
adopt one minor's semantics by accident.

### 1.3 Tests

`frontend/tests/arch-support-resolver.test.jsx` — **321 tests**, of which **288 are
parameterized over every D3 cell** (3 minors × 12 scenarios × 4 architectures × 2
assertions: canonical enforcement and projection fidelity). Plus fail-closed cases,
cross-minor intersection, adapter gating, and axis separation.

`frontend/tests/blueprint-architecture-d3.test.jsx` — **9 rendered-behaviour tests**.
Three of them fail against the replaced constant: vSphere `aarch64` and AWS GovCloud
`aarch64` are now closed, and an unrecognised platform no longer opens all four.

Axis separation is additionally pinned by the pre-existing
`frontend/tests/fips-installer-architectures.test.jsx`, untouched: the ARM64 RHEL 9 FIPS
download option remains correct, and the cluster-node FIPS statement is not re-read as an
export-binary restriction. `aarch64` also remains an **offered** target-cluster
architecture on bare metal, which is the other half of that distinction.

---

## 2. Workstream B — `provisioningNetworkGateway` runtime prerequisite

Implemented behind the closed gate so the Tranche 2 catalog asset works correctly *after*
the flip. Nothing enables 4.22.

| Layer | Implementation |
|---|---|
| UI | `PlatformSpecificsStep.jsx`, inside the existing bare-metal provisioning-network section, gated by `isCatalogFieldVisible(...)` — the same catalog-driven mechanism `bmcVerifyCA` used when it arrived at 4.21 — and additionally by `provisioningMode === "Managed"` |
| State | `state.hostInventory.provisioningNetworkGateway`, the same owner as every sibling `provisioning*` field |
| Validation | `shared/provisioningNetworkGateway.js`, called by **both** `frontend/src/validation.js` and `backend/src/generate.js` |
| Generation | `applyProvisioningNetworkGateway()` at both bare-metal emission sites, gated `isVersionGTE(selectedMinor, "4.22")` |

**Scenario contract (reconciled).** `supported-ui` is defined as "field has input
control, validation, tooltip, flows to backend ... Rendered as editable field"
(`docs/VERSION_AWARENESS_MASTER_STRATEGY.md`). An earlier revision of this tranche left
`bare-metal-agent` claiming `supported-ui` while the application offered no Agent control
— a false claim, now corrected:

| Scenario | `supportStatus` | Behaviour |
|---|---|---|
| `bare-metal-ipi` | `supported-ui` | control + validation + generation |
| `bare-metal-agent` | **`hidden-not-applicable`** | recorded, never shown, never emitted |

Evidence for the Agent disposition, verified 2026-10-08:

- the OCP Agent-based Installer parameter chapter documents the additional
  `platform.baremetal` fields it accepts — `provisioningNetwork`,
  `provisioningMACAddress`, `provisioningNetworkCIDR`, `provisioningNetworkInterface`,
  `provisioningDHCPRange`, `hosts` — and does **not** list
  `provisioningNetworkGateway`. The identifier appears **zero** times in the whole Agent
  book at 4.20, 4.21 **and** 4.22, while `provisioningNetworkCIDR` appears twice in each,
  so the absence is a property of the documentation rather than of the retrieval;
- §9.1.4 is explicit Day-2 framing: *"These fields are not used during the initial
  provisioning of the cluster, but they are available to use once the cluster has been
  installed."*;
- Architect offers no Agent input for it.

The Agent-based Installer shares the baremetal Go struct with IPI, so the installer would
mechanically accept the key. That is **not** a reason to write it — inferring Agent
support from a shared struct is exactly what the authority model forbids. The Agent Day-2
emission was therefore removed, and generation now has exactly one emission site.

> **Pre-existing, not introduced here:** the six sibling provisioning fields
> (`provisioningNetwork`, `provisioningNetworkCIDR`, `provisioningDHCPRange`,
> `provisioningNetworkInterface`, `clusterProvisioningIP`, `provisioningMACAddress`)
> carry `supported-ui` in `bare-metal-agent` at 4.20, 4.21 and 4.22 while having no Agent
> control either. Unlike the gateway they **are** documented in the Agent §9.1.4 table and
> **are** emitted through the Day-2 toggle, so the mismatch is narrower — but it is still
> a mismatch. It is recorded in the findings queue rather than fixed here: correcting it
> spans all three minors and is a same-minor data decision with its own blast radius.

**What it claims, and what it refuses to claim.** The three documented constraints
(within CIDR, outside DHCP range, ≠ provisioning IP) are enforced by the tool, because
against the shipped `openshift-install` 4.22.16 only the IP-format rejection fires — the
installer's own DHCP-overlap rule is inert (delta ledger **D1**). No message claims the
installer rejects an overlapping gateway; a test asserts no error string says so.

**Address family: IPv4 AND IPv6.** Established from the exact 4.22.16 source, not from
the surrounding UI code: the gateway is parsed with `net.ParseIP`, the kubebuilder marker
is `Format=ip` (not `ipv4`), containment is `ProvisioningNetworkCIDR.Contains()` on a
family-agnostic `ipnet.IPNet`, the DHCP-range endpoints are also `net.ParseIP`, and Red
Hat's own `provisioningNetworkCIDR` text discusses IPv6 provisioning networks ("When
using IPv6 ... this cannot be a network larger than a /64").

An earlier draft of the validator format-checked IPv6 and then ran every relational check
inside an `isIpv4()` branch, so an IPv6 gateway passed validation with all three
relations silently skipped. That is worse than rejecting it — the value looked validated
and was not. The validator now compares both families as big integers, normalises
IPv4-mapped IPv6 (`::ffff:a.b.c.d`) to IPv4 so it compares equal to the dotted-quad form
as Go's `net.IP` does, and reports an address-family **mismatch** against the CIDR
explicitly rather than skipping containment. A DHCP range in the other family is left to
that field's own validation rather than producing a derived error.

**State durability.** `stateUpdateSchema` is `z.object({}).catchall(z.unknown())`, so the
key survives updates with no schema change, and `shared/stateSanitizer.js` touches only
`hostInventory.nodes` credentials, so a gateway IP is correctly persisted rather than
stripped.

**Narrow test seam.** `buildInstallConfig()` asserts a supported minor before the helper
is reached, so the 4.22 emission rule cannot be exercised end-to-end yet.
`applyProvisioningNetworkGateway` is exported for tests with that rationale recorded at
the export. `assertSupportedOpenShiftMinorForGeneration` is untouched and
`/api/generate` still rejects 4.22.

**4.20 / 4.21 regression proof.** For both minors and both bare-metal scenarios,
`buildInstallConfig` output is asserted **byte-identical** with and without the 4.22-only
field present in state, and the string never appears. `backend/test/provisioning-network-gateway.test.js`: **28 tests**.

---

## 3. Workstream C — DOC-166 oc-mirror authority

**The substantive migration already landed in Tranche 1.5.** The audit found:

- the global authority exists at `data/oc-mirror-v2/imageset-config-schema.json`,
  derived from the pinned oc-mirror API source and verified against the exact binary;
- `buildImageSetConfig()` is hand-coded and selects **no** schema truth by target minor;
- **no production module reads `data/params/<minor>/oc-mirror-v2.json`** — verified by
  scanning every non-test file under `backend/src`, `frontend/src` and `shared`;
- `buildImageSetConfig()` still asserts a supported minor, and an unresolvable minor
  throws `UNSUPPORTED_VERSION` with `requestedVersion: null` rather than defaulting;
- the frontend performs no ImageSetConfig validation, so there is no second authority to
  disagree with.

So Tranche 3 adds the property nothing yet guarded: that the authority stays **global**.
`backend/test/oc-mirror-authority-location.test.js` (**10 tests**) fails if an
`oc-mirror-v2.json` is ever cloned into any minor, if 4.22 gains one, if a production
module starts reading the legacy file, if a schema path is built from a minor, or if the
generation gate stops rejecting unsupported minors.

**Legacy `data/params/4.20/oc-mirror-v2.json` — retained, documented.** It is inert at
runtime and is read only by tooling that walks `data/params/**` wholesale (catalog schema
validation, the citation-minor guard, the frontend mirror sync). Retiring it now would
change the 4.20 catalog count from 13 to 12 and drop a frontend mirror for no runtime
benefit, and DOC-166 §6 records that tests pin that count. It is **not** deleted for
aesthetic consistency; the relocation obligation stays open under DOC-166.

---

## 4. Workstream D — fallback audit

Twenty-four hard-coded-minor sites were found and classified. One was fixed.

### Fixed

| Site | Why it mattered |
|---|---|
| `shared/stateMigration.js` `normalizeChannelToMinor` trailing `|| '4.20'` | Unreachable today — the regex guard above it already returns `null` for anything that is not `X.Y`. But this is the state-**migration** boundary, where an imported state's target minor is established. A default sitting there means that the day the pattern is loosened, an unreadable channel silently becomes 4.20 and an import is retargeted without telling anyone. Removed; malformed still returns `null`, which callers treat as fail-closed. Zero behaviour change today. |

### Retained, with reasons

| Sites | Classification |
|---|---|
| `getOpenShiftMinorFromState(state) \|\| '4.20'` in 7 frontend components (`catalogResolver` ×2, `PlatformSpecificsStep`, `NetworkingV2Step`, `TrustProxyStep`, `IdentityAccessStep`, `ConnectivityMirroringStep`, `HostInventoryV2Step`) | Fires **only when no minor is resolvable at all**. A 4.22 state carries a real minor, so 4.22 can never inherit 4.20/4.21 semantics through these, and the flip stays atomic. Changing them would alter rendering for currently supported minors — out of scope. |
| `normalizeChannelToMinor`'s leading `return '4.20'` for an absent/non-string channel | Fires only when a v1/v2 state carries **neither** a channel nor a `selectedMinor`. Not flip-blocking for the same reason. Removing it would change which legacy bundles import successfully, which is 4.20/4.21 behaviour this tranche must not alter. **Pinned by test** so the pre-flip review sees it as a decision rather than discovering it. |
| `\|\| "4.0"` ×4 in `backend/src/index.js`, ×2 in `GlobalStrategyStep.jsx` | `4.0` is a deliberate not-a-supported-minor sentinel for docs cache keys and log fields, never a support decision. It cannot make 4.22 behave as 4.20. *(It does produce a nonexistent docs URL — findings queue.)* |
| `trustBundlePolicy.js` `selectedVersion \|\| '4.20'` | Catalog lookup for the policy option list when no version is selected; the adjacent `getTrustBundlePolicies(selectedVersion \|\| "")` is already fail-closed. Not flip-blocking. |
| `process.argv[2] \|\| "4.20"` in 4 legacy one-shot maintenance scripts | Not runtime. `scripts/minor/lib/minor.js` already enforces no-default for current tooling. |
| `getNewestSupportedMinor()`, `getLatestSupportedVersion()`, `SUPPORTED_MINORS[0]` | **Derived**, not fallbacks — they move with `SUPPORTED_MINORS` at the flip, which is the desired behaviour. `SUPPORTED_MINORS[0]` as the version-awareness baseline is required by the runbook. |

Confirmed absent: any docs-index fallback (`ensureDocsIndexForMinor` returns `null`), any
catalog fallback (`UnsupportedVersionError` before any fetch), any Field Guide `default:`
branch, and any "latest supported" inference used as a substitute for a missing minor.

`backend/test/minor-fallback-audit.test.js`: **16 tests**.

---

## 5. Operator / version prerequisites (§8)

**Not implemented in Tranche 3, and that is the evidence-backed disposition.**

`ODF_OPERATOR_EVIDENCE_4.22.md` §4 records an explicit ordering constraint:

> "removing `default` and adding the `4.22` rows must land in the same atomic enablement
> commit as widening `SUPPORTED_MINORS`. Adding rows first leaves the fallback live;
> removing `default` first breaks 4.20/4.21."

Both halves are forbidden here. What Tranche 3 *can* do without changing behaviour is make
the omission impossible to ship quietly:
`frontend/tests/operator-quick-pick-flip-atomicity.test.js` (**8 tests**) reads the real
`OperatorsStep.jsx` and fails the moment `SUPPORTED_MINORS` gains a minor that has no
Quick Pick row. The existing `version-aware-operator-quick-picks.test.js` cannot do this —
it re-declares a **mock** scenarios array and asserts the fallback is correct (lesson L10).

The tripwire distinguishes Quick Picks whose packages genuinely vary by minor (four ODF
picks) from `app-dev-suite`, which declares only `default` because its packages do not
vary. That distinction came out of the tripwire itself failing on first run.

---

## 6. DOC-179 / DOC-180

Unchanged and still tracked. No dependency was found: nothing Tranche 3 touched reads the
4.20/4.21 Field Guide `docRefs` or those docs-index files. They are **not** Tranche 3
blockers, and **not automatically Tranche 4 blockers** either — only if the Tranche 4
verification pass proves a direct dependency. They are pre-release certification
obligations.

---

## 6a. Tranche ownership — who does what, unambiguously

Recorded because Tranche 3's first report described flip work loosely as "Tranche 4
implementation". It is not. **Every change that alters public 4.22 support belongs to
the single atomic flip in Tranche 5.**

| Tranche | Owns | Public support behaviour |
|---|---|---|
| **3** (this one) | runtime prerequisites behind the closed gate | **unchanged — 4.22 closed** |
| **4** | verification only: real install-config generation matrix across the D3 combinations; confirming the 16 version-independent Quick Picks against real 4.22 catalog data; the exact flip-surface inventory; proof every flip surface can change atomically | **unchanged — 4.22 closed** |
| **5** | **the single atomic support flip** | 4.22 becomes supported |
| **6** | post-flip certification, transition and E2E | supported |
| **7** | human QA and release closure | supported |

Everything below belongs to **Tranche 5**, in one commit, and to no other tranche:

- adding the `"4.22"` operator Quick Pick rows **and** removing the `default` fallback
  (these two must be simultaneous — see §5);
- widening `SUPPORTED_MINORS` in `backend/src/versionPolicy.js` and
  `frontend/src/shared/versionPolicy.js`;
- `FIELD_GUIDE_SUPPORTED_MINORS` in `backend/src/fieldGuide/versionResolution.js`;
- the `assembler.js` import and branch;
- `provenance.js` `getAuthoritativeExport`;
- appending 4.22 to `scripts/lib/released-minor-support.json`;
- `e2e/helpers/asset-validation.js` `SUPPORTED_VERSIONS` and any assertion that
  deep-equals the old supported list.

Tranche 4 **implements none of these**. It verifies that they can all move together.

---

## 7. Fail-closed proof in the final tree

| Boundary | Result |
|---|---|
| backend / frontend `SUPPORTED_MINORS` | `["4.20","4.21"]` |
| `FIELD_GUIDE_SUPPORTED_MINORS` | `["4.20","4.21"]` |
| `isSupportedMinor("4.22")` both sides | `false` |
| `assertSupportedOpenShiftMinorForGeneration` | throws `UNSUPPORTED_VERSION` |
| `buildInstallConfig` / `buildImageSetConfig` with 4.22 | throw `UNSUPPORTED_VERSION` |
| `selectAndOrder("4.22")` | throws |
| `getAuthoritativeExport("4.22")` / `certifyExport("4.22")` | `null` / throws |
| `ensureCatalogsForMinor("4.22")` | rejects before any fetch |
| `ensureDocsIndexForMinor("4.22")` | resolves `null` |
| **`archSupportResolver` with 4.22** | **closed — 4.22 is excluded from the loaded dataset even though its projection is bundled** |
| Blueprint architecture control at 4.22 | offers nothing, and says 4.22 is not supported |
| `released-minor-support.json` | unchanged |

No preview flag, no hidden enablement mode, no partial flip.
