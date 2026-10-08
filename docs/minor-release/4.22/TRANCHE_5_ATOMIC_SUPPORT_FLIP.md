# OpenShift 4.22 — the atomic support flip (Tranche 5)

> **4.22 IS SUPPORTED BY THIS CANDIDATE.** One unstaged delta moves every support
> surface together. There is no intermediate state in which some surfaces say 4.22
> is supported and others do not.
>
> **G1 is not closed here.** Full post-flip real-output certification is owned by
> **Tranche 6**. This tranche ran only enough focused deterministic testing to prove
> the newly reachable 4.22 path does not fail immediately — and it does not.
>
> Status authority remains [`../../BACKLOG_STATUS.md`](../../BACKLOG_STATUS.md) (DOC-186).

Baseline `TRANCHE_5_BASELINE` = `7b0cf3961027b535ffc0a7c2baf5c6ab88c00dd4`
(`feat(v2.1): close OpenShift 4.22 pre-flip blockers`), with all six
`develop` / work-branch refs equal at that commit, a clean worktree and an empty index.

The flip checklist is the committed S1–S11 inventory in
[`TRANCHE_4_PRE_FLIP_VERIFICATION.md`](TRANCHE_4_PRE_FLIP_VERIFICATION.md) §5.
No flip surface was invented beyond it; the one addition is justified in §3.

---

## 1. The eleven surfaces

| # | Path | Before | After |
|---|---|---|---|
| S1 | `backend/src/versionPolicy.js` | `SUPPORTED_MINORS = ["4.20","4.21"]` | `+ "4.22"` |
| S2 | `frontend/src/shared/versionPolicy.js` | same | `+ "4.22"` — byte-identical declaration, asserted |
| S3 | `backend/src/fieldGuide/versionResolution.js` | `FIELD_GUIDE_SUPPORTED_MINORS = ["4.20","4.21"]` | `+ "4.22"`, and newly asserted **equal** to `SUPPORTED_MINORS` |
| S4 | `backend/src/fieldGuide/assembler.js` | imports v4.20/v4.21 | imports `compartments_v422`, branches on `"4.22"` |
| S5 | `backend/src/fieldGuide/provenance.js` | `getAuthoritativeExport("4.22") === null` | returns `compartments_v422` (object identity, which certification keys off) |
| S6 | `scripts/lib/released-minor-support.json` | `previouslyReleasedMinors: ["4.20","4.21"]` | `+ "4.22"`; 4.20/4.21 retained; `baselineMinor` **still 4.20** |
| S7 | **both** `versionPolicy.js` | no 4.22 row → `source: "forward"` | `"4.22": ["Proxyonly","Always"]` → `source: "explicit"` |
| S8 | `e2e/helpers/asset-validation.js` | 4.20, 4.21 | `+ { minor: '4.22', patch: '4.22.0' }` |
| S9 | `frontend/src/steps/OperatorsStep.jsx` | no `"4.22"` row; `"default"` live | explicit `"4.22"` rows on all version-aware picks; **`default` removed from data *and* from resolution** |
| S10 | `frontend/src/steps/OperatorsStep.jsx` | `openshift-ai` flat, names `rhods-prometheus-operator` | converted to `versionPicks`; 4.20/4.21 preserved byte-exact; 4.22 omits the package, **no replacement** |
| S11 | tests/fixtures pinning the supported set | `["4.20","4.21"]` | `["4.20","4.21","4.22"]`, or retargeted to 4.23 — classified individually in §5 |

### S7 is not cosmetic

The ≥4.17 forward rule already returned the right *policies* for 4.22, which is why
this looks optional. What it did not do is mark the source `explicit`, so a
flipped-but-unlisted 4.22 would resolve `source: "forward"` and
`getForwardOpenShiftMinorDocNotice()` would tell users of a **supported** minor that
"OpenShift 4.22 is not yet fully reflected in this tool's version-scrubbed docs index
and catalogs". That statement is false once 4.22 ships. The post-flip assertion is now
universal rather than per-minor: **no** supported minor may carry the caveat, and 4.23
still does.

### S9: removing `default` required a fail-closed replacement

Resolution was `versionPicks?.[version] || versionPicks?.["default"] || picks`.
`version` is `getOpenShiftMinorFromState(state) || ""`, so it can legitimately be `""`
or an unsupported minor; deleting the `default` key alone would have left `picks`
`undefined` and crashed `Object.entries(picks)`.

`resolveScenarioPicks(scenario, minor)` now returns the per-minor row or `null`, with
**no fallback**, and the three call sites plus the render path fail closed: the button
is disabled, titled *"Not defined for OpenShift X.Y"*, and clicking reports
*"Quick Pick … is not defined for OpenShift X.Y"*. This is plan **O5** — the behaviour
the ODF evidence §4 specified — not added scope: the alternative to it is a crash.

### S10: 4.20 and 4.21 are preserved, by human decision

The B1 evidence argues `rhods-prometheus-operator` is independently wrong at 4.20/4.21
too. Removing it there changes currently-shipping behaviour on already-supported minors
and is **explicitly out of scope** for this flip. The exact rows:

| Minor | `redhat` | `certified` |
|---|---|---|
| 4.20 | `rhods-operator`, `rhods-prometheus-operator`, `nfd` | `gpu-operator-certified` |
| 4.21 | `rhods-operator`, `rhods-prometheus-operator`, `nfd` | `gpu-operator-certified` |
| 4.22 | `rhods-operator`, `nfd` | `gpu-operator-certified` |

A test asserts the 4.22 row contains **no** package matching `/prometheus/i`, so a
future "obvious" substitution of `odf-prometheus-operator` fails rather than passes.

### S9: the ODF 4.22 rows

From [`ODF_OPERATOR_EVIDENCE_4.22.md`](ODF_OPERATOR_EVIDENCE_4.22.md) §1–§2, verified
present in the committed real catalog scan:

| Quick Pick | 4.21 | 4.22 | Added |
|---|---|---|---|
| `odf` | 11 | **12** | `ocs-tls-profiles` |
| `odf-local-storage` | 12 | **13** | `ocs-tls-profiles` |
| `odf-disaster-recovery` | 14 | **16** | `ocs-tls-profiles`, `odr-volsync-plugin-operator` |
| `platform-plus` | 15 | **16** | `ocs-tls-profiles` |
| `app-dev-suite` | 4 (`default` only) | **4** | nothing — packages do not vary, but rows are now explicit because there is no fallback |

A test asserts each 4.22 row is its 4.21 row **plus exactly these additions and minus
nothing**, so a row cannot be silently rewritten.

---

## 2. Derived surfaces — resolved 4.22 with no edit

The Tranche 4 inventory marked these `NO DIRECT TRANCHE 5 EDIT REQUIRED`. None was
touched. Each is now **proved** to resolve 4.22, rather than assumed to:

| # | Surface | Proof |
|---|---|---|
| D1 | `frontend/src/catalogPaths.js` | `getCatalogForScenario("bare-metal-agent","4.22")` returns parameters; `getLatestSupportedVersion()` is `4.22` |
| D2 | `frontend/src/docsIndexResolver.js` | resolves 4.22; returns null only for 4.23 |
| D3 | `frontend/src/archSupportResolver.js` | `hasArchSupportForMinor("4.22")` is true; `offeredArchSupportForState(4.22, bare-metal-ipi)` = `[x86_64, aarch64]`, `vsphere-ipi` = `[x86_64]` |
| D4 | version-awareness baseline | `SUPPORTED_MINORS[0]` — deliberately still 4.20, asserted |
| D5 | trust-bundle policy **list** | already correct via the forward rule; only `source`/notice needed S7 |
| — | `backend/test/t4-d3-generation-matrix.test.js` | derives its minor list from `SUPPORTED_MINORS`; auto-extended 96 → **144** cells |
| — | Cincinnati auto-selection and the recovery UI | newest supported minor moved to 4.22; the recovery button is now "Switch to 4.22" |

---

## 3. One surface the inventory did not list

`scripts/minor/repair/proven-repairs.js` `INSTALLER_PINS` had no 4.22 entry.
`scripts/minor/repair/exact-release-provenance.test.js` enforces that the pinned
minors are **exactly** the supported minors, so the flip made that invariant fail.

This is a genuine coherence requirement, not symmetry: every supported minor must
carry exact-release provenance. The entry was **transcribed** from the committed
Tranche 1 acquisition manifest
([`acquisition-manifest-4.22.json`](acquisition-manifest-4.22.json) `installer`) — a
release resolved from the stable-4.22 Cincinnati channel (not the branch tip, not
fast/candidate 4.22.17), checksum-verified against the mirror's own `sha256sum.txt`
before use, with the commit self-reported by that exact released binary. **No value
was invented.**

---

## 4. Post-flip support assertions

All verified by committed deterministic tests:

| Assertion | Result |
|---|---|
| backend supported minors exactly 4.20, 4.21, 4.22 | ✅ |
| frontend supported minors exactly 4.20, 4.21, 4.22 | ✅ (and byte-identical to backend) |
| support metadata consistent under the Tranche 4A bidirectional guard | ✅ `check:supported-minors` |
| `isSupportedMinor("4.22") === true` | ✅ both sides |
| catalog resolver resolves 4.22 | ✅ |
| docs-index resolver resolves 4.22 | ✅ |
| architecture resolver resolves 4.22 | ✅ |
| Field Guide resolves 4.22 | ✅ assembles real 4.22 markdown |
| `getAuthoritativeExport("4.22")` succeeds | ✅ returns `compartments_v422` by identity |
| direct generation accepts 4.22 | ✅ `buildInstallConfig` / `buildImageSetConfig` |
| HTTP generation accepts valid 4.22 state | ✅ `GET /api/generate` → 200, output names `stable-4.22` and contains neither `stable-4.21` nor `stable-4.20` |
| unsupported 4.23 remains deterministic `UNSUPPORTED_VERSION` | ✅ at every boundary |
| no fallback from 4.23 to 4.22 | ✅ nothing generated, nothing persisted, nothing normalised |
| no legacy Operator Quick Pick `default` | ✅ absent from data **and** resolution |
| every supported minor has explicit Quick Pick behaviour | ✅ |

### Focused real-4.22 generation smoke (G1 remains Tranche 6's)

| Check | Result |
|---|---|
| D3 architecture matrix | **144** cells (was 96): 45 supported, 99 hidden, 0 locked, 0 unknown, **0 failures**. 15/33 per minor, identical at 4.20, 4.21 and 4.22. |
| G2 guard after the flip | every hidden 4.22 cell is **refused before any YAML**; the guard was not weakened |
| cross-minor leakage | each minor's imageset names its own channel and no other, 4.22 included |
| `provisioningNetworkGateway` at 4.22 | emits through the **real** `buildInstallConfig`; absent value emits nothing; DHCP-overlap and malformed-IP are refused by the real builder |
| the same field at 4.20/4.21 | still emits nothing — the gate is `>= 4.22` |
| Field Guide at 4.22 | assembles; contains no **newer** minor; cites 4.21 only as backward provenance |
| imageDigestSources pivot | holds at 4.22 as at 4.20/4.21 |

**No 4.22 generation defect was exposed.**

#### A correction to the Tranche 4 G1 closure condition

Tranche 4 §2 predicted closure as *"48 further cells, 12 supported, 36 hidden"*. The
real result is 48 further cells — **15 supported, 33 hidden**. The "12/36" figure
contradicts Tranche 4's own §2 statement that the supported distribution is
`{x86_64: 12, aarch64: 3}` = 15 per minor; it omitted the three `aarch64` cells. The
cell *count* (48) was right. This is an arithmetic slip in that paragraph, not a
change in the data: the canonical dataset is 15/33 at **every** minor, 4.22 included.

---

## 5. S11 classification

Only tests asserting **what the supported set is** were changed. Coverage loops,
mocked Cincinnati payloads, adversarial fixtures and historical snapshots were left
alone — a pinned `["4.20","4.21"]` is not automatically a support claim.

| Class | Treatment |
|---|---|
| asserts the supported set / an error's `supportedVersions` | updated to `["4.20","4.21","4.22"]`, or derived from `SUPPORTED_MINORS` where it had been hard-coded (including one `length === 2` count that is exactly why it went stale) |
| uses 4.22 as *the unsupported minor* | retargeted to **4.23**, preserving the test's purpose; this is also what keeps "no fallback from 4.23 to 4.22" honest |
| pinned the **pre-flip** state (Tranche 2/3/4 tripwires) | inverted to assert the post-flip state, so reverting any single surface fails |
| synthetic partial-flip fixtures | **unchanged** — they must keep failing, and they do |
| coverage loops over minors, mocked channel lists | **unchanged** — breadth is Tranche 6's concern, not a support-policy claim |

Two newly-correct behaviours were updated rather than preserved, because the flip
legitimately changes them: Cincinnati auto-selection now picks **4.22** as the newest
supported minor, and the unsupported-version recovery button now reads
**"Switch to 4.22"**.

One test was corrected rather than merely retargeted: a new positive control asserted
that a guide contains no *other* supported minor, which failed because the 4.22 Field
Guide legitimately says *"bmcVerifyCA is available in OpenShift 4.21 and later"*. The
invariant was narrowed to the real property — **no guide may name a minor newer than
itself** — which still catches forward leakage and permits backward provenance.

One new registry entry was required: `platform.baremetal.provisioningNetworkGateway`
is the only `supported-ui` catalog parameter 4.22 adds, so the version-gated UI field
registry in `frontend/tests/version-gated-field-boundary.test.jsx` had to carry it.
That addition generates real behaviour tests: the control renders at 4.22, is absent at
4.21, and is absent on a non-applicable platform.

---

## 6. Partial-flip adversarial results

The committed suite was re-run. **Every incomplete state is still rejected.**

| # | Partial state | Result |
|---|---|---|
| P1 | backend supports 4.22, frontend does not | **detected** |
| P2 | frontend offers 4.22, backend rejects | **detected** |
| P3 | released metadata claims a minor the code does not support | **detected** |
| P4 | coherent full flip | **accepted** — not vacuous |
| P5 | architecture data visible before version support | **closed** by the adapter filter |
| P6 | Field Guide list vs support list | asserted **equal**, now post-flip |
| P7 | Quick Pick rows and support | asserted to **coexist in both directions**; `default` gone |
| P8 | support enabled while rows absent | **detected** (simulated against a hypothetical next flip, so the case stays live) |
| P9 | S7 omitted | **inverted**: no supported minor carries the caveat; 4.23 still does |
| P10 | the guard's detection boundary | three widening shapes, all **detected** |
| P11 | code supports a minor the record omits | **detected** (G3) |
| P12 | coherent flip after the G3 fix | **accepted** |

Reverting any single one of S1, S2, S3, S4, S5, S6, S7, S8, S9 or S10 in isolation
fails a committed guard.

---

## 7. Gate results

| Gate | Result |
|---|---|
| `backend && npm test` | **2,299 tests, 2,294 pass, 0 fail, 5 todo** (336 suites) |
| `frontend && npm test` | **3,340 tests, 3,338 pass, 0 fail, 2 skipped** (137 files) |
| `npm run test:tooling` | **415 pass, 0 fail** |
| `check:supported-minors` | PASS — supported and released both `[4.20, 4.21, 4.22]`, baseline 4.20 |
| `check:version-lists` | PASS |
| `check:app-version` | PASS |
| `validate-catalogs` / `validate-authority` | PASS |
| `check:citation-minor:strict` | PASS |
| `sync-catalogs:check` / `sync-docs-index:check` | PASS |
| `frontend && npm run build` | PASS |
| `frontend && npm run check-size` | PASS — eager 1193 KB / 1320 KB, largest lazy chunk 100 KB / 150 KB |
| `scripts/security/tranche-security-gate.sh` | **OVERALL: GREEN**, no baseline broadening |
| `git diff --check` | clean |

This is **not** the Tranche 6 post-flip validation matrix. It is the proof that the
atomic flip itself is internally coherent and regression-free.

---

## 8. What remains

| Item | Owner |
|---|---|
| **G1** — full post-flip real-output certification, including the full E2E program | **Tranche 6** |
| **DOC-184** (B2, `jaeger-product`) | independent pre-release debt; **no** package substituted, Tempo/OpenTelemetry **not** inferred as replacements |
| **DOC-185** | independent pre-release obligation |
| **DOC-179**, **DOC-180** | independent pre-release obligations |
| `rhods-prometheus-operator` at 4.20/4.21 | independent pre-release cleanup; human explicitly scoped it out of this flip |
| Agent sibling provisioning-field taxonomy | pre-existing cross-minor debt |

**v2.1 is not release-complete. Tranche 6 and Tranche 7 are not complete.**
Nothing is staged or committed; the human owns every git mutation.
