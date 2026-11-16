# OpenShift 4.22 — post-flip certification (Tranche 6)

Baseline `TRANCHE_6_BASELINE` = `dfbbb8aed3c813da86c98a6c613517fbb9628ccd`
(`feat(v2.1): enable OpenShift 4.22 support`), all six `develop` / work-branch refs
equal, clean worktree, empty index.

Exact certification target: **OpenShift 4.22.16** — the release the Tranche 1
acquisition manifest resolved from the `stable-4.22` Cincinnati channel, checksum
verified before use. `4.22.0` appears only where a constant models minor parsing.

Status authority: [`../../BACKLOG_STATUS.md`](../../BACKLOG_STATUS.md) (DOC-187).

> **First pass (Tranche 6): substantial certification, but NOT accepted.** Former gap
> **G1** was closed against real output, and the 12-scenario, D3, transition, Field
> Guide, bundle and provenance matrices all passed. Human review rejected the final
> GREEN for two reasons: the report asserted "all 21 Quick Picks resolved — no package
> silently skipped" while simultaneously recording that Service Mesh delivered 2 of 3
> packages, and findings **F1–F4** were classified as non-blocking rather than closed.
>
> **Second pass (Tranche 6A): findings closed.** The Quick Pick contradiction was real
> and is resolved by removing a stale package, not by rewording. F1, F2 and F3 are
> fixed; F4 is now mechanically prevented. §§20–24 below record each disposition.
> Nothing in §§1–19 is rewritten to imply the first pass was clean — the sections that
> recorded a finding now point to where it was closed.

---

## 1. Supported-minor matrix

| Surface | 4.20 | 4.21 | 4.22 | 4.23 |
|---|---|---|---|---|
| version policy | ✅ | ✅ | ✅ | **refused** |
| catalog loading | ✅ | ✅ | ✅ | **refused** |
| docs-index loading | ✅ | ✅ | ✅ | **null** |
| architecture support | ✅ 15/33 | ✅ 15/33 | ✅ 15/33 | **absent** |
| Field Guide resolution | ✅ | ✅ | ✅ | **throws** |
| generation (install-config / agent-config / imageset) | ✅ | ✅ | ✅ | **UNSUPPORTED_VERSION** |
| validation | ✅ | ✅ | ✅ | **refused** |
| import / export | ✅ | ✅ | ✅ | **422, nothing persisted** |
| bundle identity | ✅ | ✅ | ✅ | **422** |
| Operator Quick Picks | ✅ 21 | ✅ 21 | ✅ 21 | **no inheritance** |
| trust-bundle policy | explicit | explicit | explicit | **forward only** |
| version copy / annotations | ✅ | ✅ | ✅ | recovery UI |

Backend and frontend `SUPPORTED_MINORS` are byte-identical declarations; the
version-awareness baseline is still `4.20` and did not move with the flip.

---

## 2. Real 4.22 generation — all 12 scenarios (§6, closes G1)

Driven through the exported builders under normal production policy. **No
test-only support bypass exists or was used.** Fixtures are the canonical 12
scenario states retargeted to 4.22.16.

| # | Scenario | install-config | platform block | agent-config | imageset |
|---|---|---|---|---|---|
| 1 | aws-govcloud-ipi | ✅ | `aws` | n/a | ✅ `stable-4.22` |
| 2 | aws-govcloud-upi | ✅ | `aws` | n/a | ✅ |
| 3 | azure-government-ipi | ✅ | `azure` | n/a | ✅ |
| 4 | azure-government-upi | ✅ | `azure` | n/a | ✅ |
| 5 | bare-metal-agent | ✅ | `baremetal` | ✅ 3 hosts | ✅ |
| 6 | bare-metal-ipi | ✅ | `baremetal` | n/a | ✅ |
| 7 | bare-metal-upi | ✅ | `none` | n/a | ✅ |
| 8 | ibm-cloud-ipi | ✅ | `ibmcloud` | n/a | ✅ |
| 9 | nutanix-ipi | ✅ | `nutanix` | n/a | ✅ |
| 10 | vsphere-agent | ✅ | `vsphere` | ✅ 3 hosts | ✅ |
| 11 | vsphere-ipi | ✅ | `vsphere` | n/a | ✅ |
| 12 | vsphere-upi | ✅ | `vsphere` | n/a | ✅ |

**12 / 12 PASS.** Every scenario: parses as YAML, carries exactly one platform
block, names no other minor, leaks none of `osImageStream` / `ipFamily` /
`hostPlacement` / `management`, and keeps credentials out of the default export.

Two results worth stating explicitly:

- **Every 4.22 install-config is byte-identical to the same state at 4.20.** That is
  the correct outcome, not a missing test: the only install-config path 4.22 adds
  that Architect exposes is the optional bare-metal IPI gateway, which these minimal
  states do not set. Any difference would be an unintended version-conditional
  default.
- **Agent-config is byte-identical at 4.21 and 4.22**, matching the ledger's
  "agent-config deltas of any class: 0".

The mirror path is certified separately with `usingMirrorRegistry` on: all 12
scenarios emit `imageDigestSources` and never `imageContentSources` at 4.22.

---

## 3. D3 architecture real-output certification (§7)

| Metric | 4.20 | 4.21 | 4.22 | Total |
|---|---|---|---|---|
| cells | 48 | 48 | 48 | **144** |
| `supported` | 15 | 15 | 15 | **45** |
| `hidden` | 33 | 33 | 33 | **99** |
| `locked` | 0 | 0 | 0 | **0** |
| `unknown` | 0 | 0 | 0 | **0** |
| failures | 0 | 0 | 0 | **0** |

All 45 supported cells emit the expected architecture in real parsed install-config
*and* in the imageset payload, and the two never disagree. The dataset is identical
across minors — asserted, so a future divergence is visible rather than silent.

**Locked cells: none exist.** The D3 contract has a `locked` disposition and the
dataset declares none, so "a locked cell cannot be overridden" is **vacuous**, not
passing. A test fails if a locked cell is ever added, at which point the override
contract must be certified for real.

### G2 remains closed after the flip

| Route | Result |
|---|---|
| exported builders, all 99 hidden cells | **refused**, both builders |
| stale / imported v2.0.0-era combination | **refused** |
| **crafted HTTP `POST /api/generate`** | **refused** — no YAML, no imageset |
| seeded-state `GET /api/generate` | **refused** |
| error body | names the architecture; no credentials, no unrelated state |
| supported 4.22 cell on the same route | **accepted**, emits `architecture: arm64` |

The last row matters: without it the guard could be passing for the wrong reason.

---

## 4. `provisioningNetworkGateway` through real 4.22 flows (§8)

| Case | Result |
|---|---|
| Managed + valid IPv4, inside CIDR, outside DHCP, ≠ provisioning IP | **emits** |
| boundary value just above the DHCP range | **emits** |
| Managed + valid IPv6 | **emits** |
| blank / absent | **omitted**, rest of file unchanged |
| outside CIDR | **rejected** |
| inside DHCP range (v4 and v6) | **rejected** |
| equals cluster provisioning IP | **rejected** |
| malformed IP | **rejected** |
| IPv6 gateway on IPv4 CIDR | **rejected**, named explicitly as a family mismatch |
| IPv4 gateway on IPv6 CIDR | **rejected**, same |
| Unmanaged / Disabled, valid value | **not emitted**, generation succeeds |
| bare-metal **Agent** at 4.22 | **never emitted**; output identical with and without |
| 4.20 / 4.21 | **never emitted**; byte-identical with and without; not even validated |

Every rejection produces **no install-config at all**.

### Recorded behaviour — validation precedes applicability

In `Unmanaged` / `Disabled` mode an **invalid** gateway still blocks generation:
`applyProvisioningNetworkGateway` validates first and checks applicability second.
A *valid* value in those modes is carried harmlessly and generation succeeds.

This is defensible — the alternative lets a wrong value sit in saved state and
resurface when the user switches back to Managed — and it fails closed with an
accurate message. It is **newly reachable** at 4.22 because the helper is gated
`>= 4.22`, but it is not new behaviour and produces no wrong artifact. Asserted as
current behaviour and flagged for human review as a strictness question; **not
changed here.**

---

## 5. Field delta reconciliation (§9)

The frozen ledger was **not** re-derived; the shipped files were reconciled against it.

| Count | Accepted | Measured |
|---|---|---|
| install-config paths | 1104 → 1127 | ✅ |
| added / removed | 23 / 0 | ✅ (and the two agree arithmetically) |
| type / requiredness changes | 0 / 0 | ✅ |
| enum changes | 1 | ✅ |
| deprecation markers | 2 | ✅ `bootstrapOSImage`, `clusterOSImage` |
| agent-config deltas | 0 | ✅ 21 → 21 |
| scenario rows | 1051 → 1097 | ✅ **+46** |
| distinct new paths / removed | 9 / 0 | ✅ |

### The six upstream capability families

| Family | Disposition | Shipped |
|---|---|---|
| bare-metal `provisioningNetworkGateway` | `supported-ui` (IPI), `hidden-not-applicable` (Agent) | ✅ |
| `osImageStream` | `docs-only-not-supported` | ✅ |
| AWS `ipFamily` | `docs-only-not-supported` (H2) | ✅ |
| Azure `ipFamily` | `hidden-not-applicable` (H1) | ✅ |
| AWS `hostPlacement` | `docs-only-not-supported` | ✅ |
| machine-pool `management` | `hidden-not-applicable` (C4) | ✅ |

**Exactly one new 4.22 path is ordinary editable UI** —
`platform.baremetal.provisioningNetworkGateway` — asserted against the shipped
catalogs rather than against prose. The two deprecated OS-image fields are still
modelled and are **not** badged `deprecated: true` (H4).

A support status can never be *upgraded* across minors: a rank check proves no row
became more supported at 4.22 than it was at 4.21.

---

## 6. Field Guide runtime certification (§10)

| Check | Result |
|---|---|
| resolver accepts 4.22 | ✅ |
| assembler selects v4.22, and only 4.22 compartments | ✅ |
| `getAuthoritativeExport("4.22")` | ✅ by object identity |
| `certifyExport("4.22")` | ✅ |
| `certifyDocRefs(v4.22, "4.22")` | ✅ — and **rejects** the same compartments as 4.21, so not vacuous |
| compartments | **40**, all stamped `4.22`, ids unique |
| source modules | 9 present |
| ids / ordering vs v4.21 | identical — a clone, then scrubbed |
| OCP doc references | 58 URLs, **all** `/4.22/`, none `/4.20/` or `/4.21/` |
| non-OCP references | ≤ 5 (RHEL hardening guide); carry no OpenShift minor |
| unsupported 4.22 parameters presented as supported | **none** |

15 real guides rendered (3 minors × 5 scenarios): each states its own minor, is
tailored to the state, and **names no newer minor**. A guide may cite an *older*
minor as provenance — the 4.22 guide correctly says *"bmcVerifyCA is available in
OpenShift 4.21 and later"* — which is why the invariant is "no newer minor" rather
than "no other minor". The 4.22 guide differs from the 4.21 guide: not a silent clone.

---

## 7. Docs-index certification (§11)

For 4.20, 4.21 and 4.22: version field correct, base URL carries its own minor,
schema valid, canonical and frontend mirror **byte-identical**, and every URL cites
its own minor and no other.

4.22 covers all **12** scenarios including `azure-government-upi`. DOC-180 is
**recorded, not repaired**: 4.20 and 4.21 still omit that scenario, and the 4.21 →
4.22 difference is exactly that one entry. No external HEAD/GET validation was
performed; URL liveness is DOC-179's concern and is unchanged.

---

## 8. Operator Quick Picks (§12)

**21 Quick Picks: 6 version-aware, 15 flat.** Every one resolves to a non-empty
package set at all three supported minors.

> **CORRECTED IN TRANCHE 6A.** This section originally claimed "no required package is
> silently skipped". That was the *title* of a test whose assertion actually exempted
> `jaeger-product` through a disposition allowlist, so what was proven was the weaker
> "no **undispositioned** package is skipped" — which is compatible with, not
> contradictory to, the DOC-184 finding below. The absolute claim was the report's
> error.
>
> Tranche 6A removed the stale package and **emptied the allowlist**, so the absolute
> claim is now literally what is asserted, with no exemptions: every package every
> Quick Pick names resolves in the catalog of its own minor. See §20.

`default` is gone from data **and** from resolution. No version-aware pick resolves
for 4.23 by inheritance.

### OpenShift AI — exact

| Minor | redhat | certified |
|---|---|---|
| 4.20 | `rhods-operator`, `rhods-prometheus-operator`, `nfd` | `gpu-operator-certified` |
| 4.21 | `rhods-operator`, `rhods-prometheus-operator`, `nfd` | `gpu-operator-certified` |
| **4.22** | **`rhods-operator`, `nfd`** | **`gpu-operator-certified`** |

4.22 does **not** request `rhods-prometheus-operator` and substitutes **no**
replacement Prometheus package. Verified against the catalog scan: the package is
present at 4.20/4.21 and absent at 4.22; every package the 4.22 row names resolves.

### Other version-aware picks

Five, each with explicit 4.20 / 4.21 / 4.22 rows. ODF 4.22 counts: `odf` 12,
`odf-local-storage` 13, `odf-disaster-recovery` 16, `platform-plus` 16.
`app-dev-suite` repeats an identical row at each minor because its packages do not
vary and there is no fallback.

### DOC-184 impact, measured — **CLOSED in Tranche 6A**

As measured in the first pass: `service-mesh` named three packages and delivered
**two** — `servicemeshoperator` and `kiali-ossm` — at **every** supported minor.
`jaeger-product` is absent at 4.20, 4.21 and 4.22 alike, so the behaviour was
identical before and after the flip and the 4.22 onboarding neither caused nor
worsened it.

**That measurement is what made the "no package silently skipped" claim false**, and
it is now fixed rather than carried: the stale reference was removed on Red Hat's own
evidence. Full disposition in §20.

---

## 9. Version transition matrix (§13)

All six ordered pairs, through the real `computeReleaseTransition` flow.

| Edge | Accepted | Minor/patch/channel moved | Left unlocked | Operators invalidated | Catalogs / docs / arch re-resolved |
|---|---|---|---|---|---|
| 4.20 → 4.21 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4.20 → 4.22 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4.21 → 4.22 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4.22 → 4.21 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4.22 → 4.20 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4.21 → 4.20 | ✅ | ✅ | ✅ | ✅ | ✅ |

After every transition: no trace of the source minor in the version/release block,
the input state is not mutated, the trust-bundle policy is explicit at the
destination, no source-minor catalog image survives in operator state, and every
version-aware Quick Pick has an explicit row at the destination.

**The 4.22-only gateway does not leak backward.** Transitioning 4.22 → 4.21/4.20
keeps the value in `hostInventory` — deliberately, because destroying user input on
a version change would be worse — while the destination catalog has **no row** for
the path, so no control renders and generation never reads it. Returning to 4.22
makes it available again without re-entry.

`4.20|4.21|4.22 → 4.23` is refused with `UNSUPPORTED_VERSION`, no patch, and
**no partial mutation**. A patch from the wrong minor is refused, not coerced.

All three minors offer the same 12 platform scenarios. The one extra catalog entry
at 4.20 is the inert legacy `oc-mirror-v2` file (DOC-166), pinned so the exception
cannot spread.

---

## 10. State import / export (§14)

Export → re-import → generate round-trips at every supported minor, with the minor
preserved and generation still working afterwards. An exported 4.22 state declares
4.22 and no older minor.

**Legacy v2-shaped import** (`schemaVersion: 2`, no canonical `selectedMinor`) is
certified separately because it is the shape real saved runs use: at 4.20, 4.21 and
4.22 it migrates, persists the right minor, and generates its own channel with no
cross-minor leak. A legacy-shaped 4.23 import is refused and the prior 4.22 state
survives.

Rejected 4.23 attempts across `/api/state`, `/api/generate`, `/api/bundle.prepare`,
`/api/bundle.zip` and `/api/run/import` all return 422 `UNSUPPORTED_VERSION`,
produce no YAML, echo no credentials, and leave a good 4.22 state intact.

A future state schema version (`version._schemaVersion: 99` — the canonical marker)
is blocked at the persistence boundary and does not pollute the stored state.

---

## 11. Bundles (§15)

Real ZIPs built for all three minors; each is a valid archive containing
`version-manifest.json` and `install-config.yaml`. The 4.22 manifest reports
`selectedMinor: 4.22`, `selectedPatch: 4.22.16`, `lockedVersion: true`,
`sha-256` / `lowercase-hex`, checksums that verify, and **no other minor anywhere**.
The default bundle carries no credential canary.

---

## 12. Installer / tool provenance (§16)

| Minor | Release | Branch | Digest / commit |
|---|---|---|---|
| 4.20 | 4.20.40 | `release-4.20` | pinned |
| 4.21 | 4.21.35 | `release-4.21` | pinned |
| **4.22** | **4.22.16** | `release-4.22` | pinned |

The pinned minors are exactly the supported minors. The 4.22 pin matches the Tranche 1
acquisition manifest **field for field** (release, payload digest, binary SHA256,
tarball SHA256, commit, arch). Every pin is well-formed, names its own minor, is
**not** a mutable `latest` reference, and no two pins share a digest or commit.

Installer artifact selection: the mirror path is built from the architecture,
`aarch64` normalises to the `arm64` filename the mirror uses, the RHEL9 FIPS variant
is arch-specific and Linux-only, **installer-binary FIPS selection reads no cluster
state** (it is a property of the machine running `openshift-install`, not of the
target cluster), and no z-stream is hardcoded.

`oc` / `oc-mirror` policy split holds at 4.22: `oc` resolves `latest-4.22` →
4.22.16, `oc-mirror` resolves the **global** `latest` regardless of target minor.
4.22 is the case that proves it — both happen to be 4.22.16, so the *channel*, not
the version, is what distinguishes them, and that is what is asserted.

No `data/params/4.21|4.22/oc-mirror-v2.json` exists; the legacy 4.20 copy is the
only one and remains inert (DOC-166).

---

## 13. Trust-bundle policy (§17)

All three supported minors carry an **explicit** `["Proxyonly","Always"]` allowlist
row in **both** policy modules, so none shows the "not yet fully reflected" caveat.
4.23 has no explicit row and does not inherit 4.22's; the ≥4.17 forward rule still
returns the right policy list for it.

---

## 14. HTTP / API boundaries (§19)

Positive, per supported minor: `POST /api/state` persists, `POST`/`GET
/api/generate` return artifacts naming only that minor, `POST /api/bundle.prepare`
is accepted, `POST /api/operators/confirm` is not refused as unsupported.

Negative, 4.23: deterministic 422, stable `UNSUPPORTED_VERSION` code, correct
`requestedVersion`, `supportedVersions` equal to the real supported set, no state
persistence, no partial artifact, no credential material in the body, and no
fallback to 4.22.

### Finding F1 — version-source coherence returned HTTP 500 — **FIXED in Tranche 6A**

`POST /api/state` **merges**. A client that posts a partial version block can leave
`version.selectedVersion` pointing at a different minor than `selectedMinor`. The
Field Guide's coherence guard then refuses — correctly: no YAML, no guide, no silent
pick between the two minors. In the first pass the error surfaced as **HTTP 500**.

Proven **version-agnostic and pre-existing**: it reproduces from 4.21 → 4.20 with no
4.22 involved at all. Attribution, however, is not acceptability — a client-controlled
state must not produce a server-fault response. Fixed in §21.

---

## 15. E2E / browser disposition (§20)

**E2E is non-evidential in this environment, for two independent reasons.**

1. **Browser binaries are not installed.** `chrome-headless-shell` is absent, so
   every spec that launches a page fails at browser launch. 4 browser tests in the
   version-awareness spec cannot run.
2. **More importantly: the E2E suite targets a stale backend.** `localhost:4000`
   reports `version: 2.0.0`, `buildTime: 2026-10-06T21:06:53Z`, `branch: main`, and
   is served by a container — it is the **pre-flip v2.0.0 GA build**, not this
   worktree. Against it, a legacy 4.22 import correctly returns
   `supportedVersions: ["4.20","4.21"]`, because that build genuinely does not
   support 4.22.

The second point also means the API-level E2E runs that *did* pass are not evidence
about this worktree: they pass because they assert 4.20/4.21 behaviour the old build
also satisfies.

**No E2E PASS was claimed in the first pass.** The identical scenarios were re-run
against the real worktree code through `createTestServer(app)`, where all four cases
behave correctly (4.20/4.21/4.22 import, migrate, persist and generate their own
channel; 4.23 is refused and the prior state survives). That case is now a permanent
backend test.

> **Superseded by Tranche 6A §23.** The corrected spec has since been executed against
> an isolated backend launched from this worktree: **60 API-level cases pass, 0 fail.**
> Two further defects in the first pass's own spec edits were found and fixed in the
> process. Browser-only cases remain not-run.

`e2e/specs/validation/version-awareness.spec.js` **was corrected** to the three-minor
matrix — 4.22 added to every per-minor loop and to the 12-scenario matrix, the
browser gate expecting `Switch to 4.22`, and 4.23 as the unsupported sentinel. Two
rejection tests that accepted *either* success or failure via `if/else` were made
strict. **These corrections are unverified in this environment** and must be run in
Tranche 7 against a backend built from this worktree, with browsers installed.

### Pre-existing E2E defect, recorded

`e2e/helpers/asset-validation.js` does `import yaml from 'js-yaml'`, but the repo
root resolves **js-yaml@5**, which provides no default export. The helper therefore
cannot be loaded under Node ESM at all, which breaks
`e2e/specs/validation/asset-structure.spec.js` at module load. Present well before
the 4.22 work (backend pins js-yaml@4; the root `^5.2.1` predates this effort).
Not a product defect and not caused by this tranche.

---

## 16. Gates

| Gate | Result |
|---|---|
| backend `npm test` | **2,591 tests / 2,586 pass / 0 fail / 5 todo** (388 suites) |
| frontend `npm test` | **3,505 tests / 3,503 pass / 0 fail / 2 skipped** (762 files) |
| `npm run test:tooling` | **446 pass / 0 fail** |
| `check:supported-minors`, `check:version-lists`, `check:app-version`, `test:app-version` | PASS |
| `validate-catalogs`, `validate-authority`, `check:citation-minor:strict` | PASS |
| `sync-catalogs:check`, `sync-docs-index:check` | PASS |
| `find-hardcoded-versions.sh --self-test` / `--check` | PASS (43 self-test assertions) |
| `validate-param-authority.js`, `validate-arch-support.js` | PASS (144 cells) |
| frontend `npm run build` | PASS |
| frontend `npm run check-size` | PASS — eager 1193/1320 KB, largest lazy 100/150 KB |
| `tranche-security-gate.sh` | **OVERALL: GREEN**, no baseline broadening |
| `git diff --check` | clean |

The security gate initially went RED on a literal base64 credential canary **this
tranche introduced** in a new test. It was replaced with a runtime-generated
synthetic canary, following the convention in `credential-canary-surfaces.test.js`.
The baseline was **not** broadened.

---

## 17. DOC-179 / 180 / 184 / 185 disposition

| Item | Classification | Evidence |
|---|---|---|
| **DOC-179** — dead Field Guide `docRef` URLs at 4.20/4.21 | **pre-release cleanup, non-blocking** | No 4.22 OCP reference is affected: all 58 carry `/4.22/`. No supported-version certification failed. URL liveness was not re-tested (external network). |
| **DOC-180** — `azure-government-upi` missing from the 4.20/4.21 docs index | **pre-release cleanup, non-blocking** | 4.22 includes the scenario; the gap affects only documentation links at 4.20/4.21 and no generation, validation or support boundary. |
| **DOC-184** — `jaeger-product` | **CLOSED in Tranche 6A** | Was quantified as 2 of 3 delivered at every supported minor. The stale package is now removed from the Quick Pick on Red Hat evidence; no replacement substituted. See §20. |
| **DOC-185** — missing TP caveats for AWS `ipFamily` / `hostPlacement` | **pre-release cleanup, non-blocking** | Both are correctly `docs-only-not-supported` and neither reaches UI or generation. A guidance gap, not a correctness one. |

None produced a supported-version certification failure.

---

## 18. Findings recorded for the backlog

| # | Finding | Class | First-pass call | Tranche 6A outcome |
|---|---|---|---|---|
| F1 | `/api/generate` returned **HTTP 500** for a version-incoherent state | pre-existing, version-agnostic, fails closed | non-blocking | **FIXED** — §21 |
| F2 | Gateway validation preceded applicability, so an **invalid** value blocked generation in `Unmanaged`/`Disabled` | newly reachable at 4.22 | non-blocking | **FIXED** — §22 |
| F3 | `e2e/helpers/asset-validation.js` could not load under Node ESM | pre-existing E2E test infrastructure | non-blocking | **FIXED** — §24 |
| F4 | The E2E suite certified a stale v2.0.0 container | environment / harness | non-blocking | **PREVENTED** — §23 |
| — | "all 21 Quick Picks … no package silently skipped" contradicted the DOC-184 measurement | reporting error over a real silent skip | not identified | **RESOLVED** — §20 |

---

## 19. Remaining obligations (superseded by §25)

See §25 for the post-Tranche-6A list.

---

# Tranche 6A — bounded closure

Baseline unchanged: `dfbbb8aed3c813da86c98a6c613517fbb9628ccd`. The Tranche 6
candidate was corrected in place, not replaced.

## 20. The Quick Pick contradiction, and DOC-184

### What was actually wrong

Two claims could not both be true. Tracing the pick end to end settled it:

| Step | Finding |
|---|---|
| Quick Pick definition | `service-mesh` named `servicemeshoperator`, `kiali-ossm`, `jaeger-product` |
| catalog lookup (real `oc-mirror --v2 list operators` scan) | `jaeger-product` **absent** at redhat-4.20, redhat-4.21 **and** redhat-4.22 |
| `applyScenario` | `if (!found) return;` — **silent skip**, no warning, no counter |
| selected operator state | 2 operators, not 3 |
| ImageSetConfig | mirrors 2 operators |

So claim B was right. Claim A was the *title* of a test whose assertion exempted
`jaeger-product` via a disposition allowlist. The contradiction was in the reporting;
the silent skip underneath it was real and had been real since before 4.22.

### Authoritative disposition — category 5, *invalid stale dependency*

From Red Hat's own documentation for the supported versions, not from package names:

- The Jaeger Operator **is removed from the `redhat-operators` catalog** — Red Hat's
  stated plan, and the committed scan confirms the removal at all three minors.
- Support for distributed tracing platform (Jaeger) **3.5 ended 2025-11-03**, before
  any minor this product supports.
- The OSSM 3.x *Distributed tracing and Service Mesh* chapter lists its prerequisites
  verbatim as the **Tempo Operator**, the **distributed tracing data collection
  Operator**, a `TempoStack`, an `Istio` and an `IstioCNI` instance. **No Jaeger
  operator appears**, and tracing is an **optional integration**, not a Service Mesh
  prerequisite.
- Service Mesh 3 **no longer installs or manages** tracing components at all.

**Correction made:** `jaeger-product` removed from the `service-mesh` Quick Pick, and
the description changed from *"Istio-based service mesh with Kiali observability and
Jaeger distributed tracing"* to *"Istio-based service mesh with Kiali observability"*,
since the pick no longer delivers tracing.

**No replacement substituted.** `tempo-product` and `opentelemetry-product` are both
present in the 4.22 catalog, so their omission is deliberate, not forced: they are
prerequisites of an optional *tracing* integration, and adding them would be a new
product capability rather than a stale-reference fix. A test asserts they are absent
*and* that they exist in the catalog, so the distinction cannot be lost.

### The claim is now absolute

| Quick Pick | 4.20 | 4.21 | 4.22 |
|---|---|---|---|
| `service-mesh` | `servicemeshoperator`, `kiali-ossm` | same | same |

The disposition allowlist is **empty**, and a test asserts that emptiness. Every
package every Quick Pick names resolves in the catalog of its own minor — proven
three ways: per Quick Pick/minor/catalog, as one global sweep, and through a
reproduction of `applyScenario`'s own lookup including its silent-skip branch. A
further test shows the *old* package set would still drop one package today, so a
revert cannot be silent.

## 21. F1 — `/api/generate` no longer returns 500 for client state

| | |
|---|---|
| **Symptom** | A version-incoherent state produced `HTTP 500` with a raw message. |
| **Immediate mechanism** | `FIELD_GUIDE_VERSION_ERROR` was absent from each route's error-mapping chain (`UNSUPPORTED_VERSION`→422, trust errors→409/422, `CONFIGURATION_VALIDATION`→400) and fell through to the `return res.status(500)` default. |
| **Lifecycle cause** | The chain enumerates known error codes. A code raised deeper in the stack — the Field Guide resolver — was never added, and nothing fails when a code is missing: it just degrades to 500. |
| **Blast radius** | `GET`/`POST /api/generate` and `POST /api/bundle.zip` (via `handleBundleZipError`), at every minor. Fail-closed throughout: no artifact was ever produced. |
| **Authoritative fix** | Map `FIELD_GUIDE_VERSION_ERROR` alongside `CONFIGURATION_VALIDATION` → **400**, at all four sites. No new taxonomy; the error keeps its own stable code, which is now returned in the body. |

**Reachability, measured** — attribution was not enough, but it does scope the fix:

| Route in | Reachable? |
|---|---|
| normal version transition (coherent patch) | **No** — 200 at all three minors |
| legacy v2-shaped import | **No** — migration produces a coherent state |
| partial `POST /api/state` (merge leaves a stale version field) | **Yes** |
| directly supplied incoherent `/api/generate` body | **Yes** |

Both reachable paths are client-controlled, which is exactly why 500 was wrong.

**Negative matrix, all three minors:** 400 with `code: FIELD_GUIDE_VERSION_ERROR`;
byte-identical on repeat (deterministic); no credentials, no unrelated state, no stack
trace; no `files` key; `bundle.zip` identical. `bundle.prepare` legitimately returns
200 — it issues a token and generates nothing — and is asserted to emit no artifact.
`UNSUPPORTED_VERSION` still maps to **422**, so the conventions stay distinct.

## 22. F2 — gateway applicability now precedes validation

**Reproduced**, bare-metal IPI at 4.22, before the fix:

| State | Before | After |
|---|---|---|
| Managed + valid | emits | emits |
| Managed + invalid | **throws** | **throws** (unchanged) |
| Unmanaged/Disabled + stale **valid** | omits | omits |
| Unmanaged/Disabled + stale **invalid** | **throws** | **omits** |
| Unmanaged/Disabled + **malformed** | **throws** | **omits** |
| any mode + **non-string** | throws | **throws** (unchanged) |

**UI lifecycle, determined:** changing the provisioning mode calls
`updateInventory({ provisioningNetwork })` only. The control is rendered solely when
`provisioningMode === "Managed"`, so the value is **hidden but preserved** — never
pruned or cleared.

**The contract, and the precedent.** The same function already treats *version*
inapplicability as "return before validating", which is why a stale value at 4.20/4.21
never blocked. Mode inapplicability is the same kind of fact — the OCP Provisioning
APIs chapter says the field is *"only used when ProvisioningNetwork is set to
Managed"*, and `openshift-install` accepts and ignores it otherwise. Treating one kind
as skip and the other as reject was internally inconsistent, and once 4.22 became
supported it produced a real trap: a hidden, uncorrectable field failing generation.

**Fix:** applicability is checked before validity. Preservation on mode change is kept
deliberately — the same choice the version transition makes, because destroying user
input is worse. Managed-mode relational validation (CIDR containment, DHCP overlap,
provisioning-IP collision, address family) is untouched and asserted so.

## 23. F4 — the harness can no longer certify a stale build

**Root cause:** `global-setup.js` checked `/api/health` and nothing else. Liveness is
not identity, and the failure is silent: a pre-flip build passes every 4.20/4.21
assertion. `e2e/helpers/api.js` additionally hardcoded `localhost:4000`.

**Prevention:** `e2e/helpers/backend-identity.mjs` verifies, before any spec runs:

| Check | Expectation derived from |
|---|---|
| application version | `backend/package.json` |
| supported minors | the backend's own `SUPPORTED_MINORS`, probed **behaviourally** by making the running backend refuse 4.99 and reading `supportedVersions` |
| source revision | `git rev-parse HEAD`, compared only when the backend reports a real SHA |

No SHA or version is hardcoded — a test asserts the guard's source contains no
40-hex string. The probe supplies its state inline and persists nothing. A mismatch
**aborts** the run with a message naming each discrepancy. `E2E_BACKEND_URL` /
`OAA_BROWSER_BACKEND_URL` make the target explicit.

**Proven against the real failure:** the guard is unit-tested with the exact identity
the stale container reported (`2.0.0`, `2026-10-06`, `[4.20, 4.21]`) and refuses it,
naming both mismatches; it accepts a matching build; `gitSha: "unknown"` is skipped
rather than treated as a mismatch. Live, it **accepted** the worktree backend
(version + supportedMinors + gitSha all checked) and **refused** the still-running
container on :4000.

## 24. F3 — the E2E asset-validation helper loads again

**Root cause:** `import yaml from 'js-yaml'` — a **default** import — while the
repository root resolves **js-yaml v5**, which is ESM-first and exports only named
bindings. Under Node ESM this threw *"does not provide an export named 'default'"*, so
the module could not be imported at all and
`e2e/specs/validation/asset-structure.spec.js` failed at load.

**Fix:** `import * as yaml from 'js-yaml'`. A namespace import resolves `yaml.load`
against both the root's v5 and the backend's v4 (CJS), so **no dependency change** was
made and every call site is unchanged.

**Closure test** lives under `scripts/` so `npm run test:tooling` runs it on every
change — the E2E suite needs a browser and a backend, which is why the breakage went
unnoticed. It asserts the module imports, exports its full surface, and that its core
validation *executes*: `parseYaml`, `resolveYamlPath`, `loadCatalogParams` against a
real 4.22 catalog, `checkRequiredFields` in both directions, and `makeVersionedFixture`
retargeting to 4.22.16. A sweep asserts no file under `e2e/` reintroduces a default
js-yaml import.

## 25. Current-worktree E2E results and remaining obligations

An isolated backend was launched **from this worktree** on port 4399 (the user's
existing container on :4000 was neither modified nor stopped, and the launched process
was torn down afterwards). The identity guard verified it before the run.

| | Count |
|---|---|
| version-awareness cases executed | **64** |
| **API-level passed** | **60** |
| API-level failed | **0** |
| browser-only, **not run** | **4** |

Two further defects in the first pass's own spec edits were found and fixed here: a
4.22 block had been inserted **inside** an unrelated test (`name is not defined`), and
the strict rejection tests imported an unsupported state that `/api/run/import`
correctly refuses — so they asserted against a stale unconfirmed state rather than the
generation boundary. They now assert at both boundaries with the state supplied inline.

### Browser-only cases, not run (no `chrome-headless-shell` installed)

1. `locked 4.23 → unsupported-version recovery boundary blocks wizard`
2. `locked 4.20 → passes gate, renders wizard`
3. `locked 4.21 → passes gate, renders wizard`
4. `locked 4.22 → passes gate, renders wizard`

No PASS is claimed for these. Browser installation is environment setup and is left to
the QA tranche, as is manual acceptance of the 4.22 recovery UI (`Switch to 4.22`) and
of the `provisioningNetworkGateway` control rendering at 4.22 but not at 4.21.

### Remaining obligations

- The four browser-only cases above, plus manual QA of the 4.22 wizard flow.
- **DOC-179** (dead Field Guide `docRef` URLs at 4.20/4.21) and **DOC-180**
  (`azure-government-upi` missing from the 4.20/4.21 docs index) — both re-reviewed,
  neither produced a supported-version certification failure.
- **DOC-185** (missing TP caveats for AWS `ipFamily` / `hostPlacement`).
- Whether to offer a distributed-tracing Quick Pick (Tempo + OpenTelemetry) is an open
  **product** question raised by §20, deliberately not decided here.
- Release identity **not** bumped, no tag created. **v2.1 is not release-complete.**

### Gates after closure

| Gate | Result |
|---|---|
| backend | **2,618 tests / 2,613 pass / 0 fail / 5 todo** (390 suites) |
| frontend | **3,529 / 3,527 pass / 0 fail / 2 skipped** (768 files) |
| tooling | **479 pass / 0 fail** |
| root checks (9) + hardcoded-version scan + param/arch authority | PASS |
| build / bundle budget | PASS — eager 1193/1320 KB, largest lazy 100/150 KB |
| `tranche-security-gate.sh` | **OVERALL: GREEN**, no baseline broadening |
| `git diff --check` | clean |
