# Tranche 1 automation reuse and improvement report

> **Tranche 1 deliverable 10 of 10.** Required by prompt Phase 1L: for every acquisition
> and diff step, state whether it was `REUSE AS-IS`, `PARAMETERIZED EXISTING TOOL`,
> `NEW GENERIC CAPABILITY`, or `MANUAL EVIDENCE STEP`.

**No forked `local-docs/ocp-4.22/scripts` family was created** (runbook Rule 5).

---

## 1. Step-by-step

| Step | Mode | Detail |
|---|---|---|
| Resolve latest stable 4.22.x | **MANUAL EVIDENCE STEP** | `curl` of the Cincinnati `stable-4.22.yaml` channel, applying the **same selection rule the product uses** (`backend/src/cincinnati.js` `fetchStableFile` / `fetchPatchesForChannel`). The specified `scripts/minor/acquire/` script does not exist (GAP-07). |
| Acquire + verify installer binary | **MANUAL EVIDENCE STEP** | `curl` + `sha256sum -c` against the release's own `sha256sum.txt`, **before** use. GAP-07. |
| Resolve installer source commit | **MANUAL EVIDENCE STEP** | `openshift-install version` self-report, cross-checked against `release.txt`. |
| Clone both exact releases | **MANUAL EVIDENCE STEP** | `git fetch --depth 1 <commit>`. GAP-04. |
| Extract install-config / agent-config params | **NEW GENERIC CAPABILITY** | `scripts/minor/extract/parse-go-structs.js` + `go-struct-parser.js` + `go-struct-walker.js` — §2 |
| Compute the delta | **REUSE AS-IS** | `scripts/minor/compare/diff-params.js`, unmodified, invoked exactly as its README documents |
| Validate against the shipped binary | **MANUAL EVIDENCE STEP** | `openshift-install create manifests` on crafted fixtures — §3 |
| Acquire 4.22 documentation | **MANUAL EVIDENCE STEP** | `curl` returns **403** for every docs.redhat.com URL; the agent fetch tool returns 200. GAP-02. |
| Acquire + verify oc-mirror v2 | **MANUAL EVIDENCE STEP** | `clients/ocp/latest`, checksum-verified before use. GAP-07. |
| Validate ImageSetConfiguration claims | **MANUAL EVIDENCE STEP** | `oc-mirror --v2 --dry-run` probes — §3 |
| Measure the bundle baseline | **REUSE AS-IS** | `npm run build && npm run check-size`, unmodified |
| Provenance manifest | **MANUAL EVIDENCE STEP** | hand-assembled by script into `acquisition-manifest-4.22.json`. GAP-03 generator still absent. |

`corrected-analysis.js` — the false-positive filter — was **not run**. Its rules suppress
catalog-vs-source comparison artifacts; this tranche compared **source to source**, where
those artifacts do not arise. It becomes relevant in Tranche 2, when 4.22 catalogs exist to
compare against. Recorded so its absence is not read as an oversight.

## 2. The one new generic capability

`scripts/minor/extract/parse-go-structs.js` (+ `go-struct-parser.js`, `go-struct-walker.js`),
with `parse-go-structs.test.js` — **31 hermetic fixture tests, no network, no installer
checkout**.

Justified under prompt Phase 1L: it was necessary to acquire and classify 4.22, and it is
safely isolated from product data — it reads a source clone and writes JSON outside the
repository. It touches no `data/params/**`.

It follows the architecture 0A-1 established rather than inventing one:
`--minor` required and never defaulted · `--source` explicit · fails closed on an empty
tree, a missing root struct, or an underivable commit · accepts an **unsupported** minor,
because acquiring 4.22 evidence must be possible while 4.22 is fail-closed.

### Gaps it closes

- **GAP-12 / harvest finding F1 — closed at the producer end.** The test
  `emits every field diff-params declares in INPUT_CONTRACT` asserts the producer against
  the consumer's own exported contract. Two further tests drive a changed doc comment and a
  new field end-to-end through `diff-params`. This is not theoretical: `changed_description`
  is what surfaced the **two new bare-metal deprecations** (delta ledger §4). Under the old
  broken contract this tranche would have reported `changed: 0`.
- **Rule 5 / finding F3 — provenance is derived, not asserted.** The commit is read from
  the clone with `git rev-parse HEAD`. **There is no flag to state one.** An unpinnable tree
  is a stop-and-report.
- **Deep nested extraction.** The 4.21-era extractor was shallow; the runbook warns that
  paths like `failureDomains[].topology.datacenter` need manual inspection. The walker
  recurses with per-chain cycle guarding and produced 1,127 paths at 4.22 against the
  4.21-era extractor's 525 — **zero truncated chains**.
- **Package-name collisions reported, not silently resolved.** Several installer packages
  are named `validation`; collisions are emitted in the output rather than resolved by luck.

### A defect it had, and the regression test

The first run reported a 4.21→4.22 enum change adding `"sovereign"` to
`platform.gcp.firewallRulesManagement`. **False.** The constant collector carried a const
block's preceding type forward onto an untyped `Name = "value"` line; Go does not do that.

Fixed, with a named regression test whose fixture reproduces the exact shape from
`pkg/types/gcp/platform.go`. The same bug would have mis-attributed `OSStreamLabelKey` to
`OSImageStream`.

Two things were then added because the near-miss showed the enum model was too weak:
`+kubebuilder:validation:Enum` markers are now read and **outrank** harvested constants,
and every row records `enumSource` so a classification can say which evidence class it
rests on. §3 shows why that distinction is load-bearing.

**Worth stating plainly:** the defect produced a *plausible* false finding about a real
parameter, and was caught only by checking the finding against source rather than trusting
the tool. That is the same failure shape as F1.

## 3. Exact-binary validation — the step with the highest yield

Execution-contract rule 3 requires checking upstream source **and** the exact shipped
binary. Doing both changed four conclusions that source alone would have got wrong:

| Finding | Source alone would have said | The binary said |
|---|---|---|
| `platform.aws.lbType` enum | new enum constrains values to `Classic`/`NLB` | `lbType: Bogus` **accepted** — kubebuilder markers are not applied by `openshift-install` |
| `provisioningNetworkGateway` DHCP-overlap rule | rule exists and will reject overlaps | **does not fire**; a control probe shows the pre-existing `clusterProvisioningIP` check behaves identically, so it is the shared mechanism, not a 4.22 regression |
| `kubeVirtContainer` placement | the **4.22 documentation table** lists it top-level | top-level **rejected**; `mirror.platform.kubeVirtContainer` accepted — so the catalog row is wrong and `generate.js` is right |
| operator version filtering | catalog models `includeConfig.minVersion` | `includeConfig` **rejected as an unknown field** |

The last one is a **live generated-artifact defect**: the real `buildImageSetConfig` was
invoked and its real output fed to the real binary, and oc-mirror refuses to parse it
whenever an operator `minVersion`/`maxVersion` is set (FQ-9).

None of these was reachable from documentation or source alone. The cost was roughly twenty
`create manifests` and `--dry-run` invocations.

## 4. Gaps still open after this tranche

| Gap | Status |
|---|---|
| GAP-01 PDF → text | **not needed.** HTML was used throughout, as `WEB_EXTRACTION_PLAN.md` decided and no one followed. |
| GAP-02 doc HTML fetch | **still open, and harder than recorded.** `curl` gets 403 on every URL; the Revision-3 claim of 200s does not hold here. A fetcher must solve the 403 or the capability is not automatable as specified. |
| GAP-03 ASSET_MANIFEST generator | still open; this tranche hand-assembled `acquisition-manifest-4.22.json`, which is the spec a generator should emit |
| GAP-04 pinned installer clone | still open; done manually. Now simpler to automate: fetch by **commit**, not branch. |
| GAP-05 baseline retention | **open, and the decision is now easier.** Extractions are pinned to immutable commits, so reproduction is genuinely deterministic — which weakens the original argument for committing them. Still a human decision. |
| GAP-07 binary acquisition + checksums | still open; done manually for both `openshift-install` and `oc-mirror`, fail-closed, checksums verified before use |
| GAP-08 Field Guide onboarding | untouched; Tranche 2 |
| GAP-12 producer/consumer contract | **CLOSED** at the producer end |
| GAP-13 CI coverage | still open; FQ-10 gives it concrete urgency |

## 5. Tooling changes made (full list)

| Path | Change |
|---|---|
| `scripts/minor/extract/go-struct-parser.js` | **new** — Go source reader, filesystem-free core |
| `scripts/minor/extract/go-struct-walker.js` | **new** — struct registry → flat YAML-shaped parameter list |
| `scripts/minor/extract/parse-go-structs.js` | **new** — CLI, derived provenance, fail-closed |
| `scripts/minor/extract/parse-go-structs.test.js` | **new** — 31 hermetic fixture tests |

No existing script was modified. No product source, catalog, schema, CI workflow or test
outside `scripts/minor/extract/**` was touched.
