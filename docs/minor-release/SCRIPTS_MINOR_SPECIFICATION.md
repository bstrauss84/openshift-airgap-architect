# `scripts/minor/**` Specification

> **Tranche 0A-0 deliverable 2 of 3.** Derived from the [4.21 Automation Harvest Ledger](AUTOMATION_HARVEST_LEDGER_4.21.md)
> ([machine-readable source](automation-harvest-ledger-4.21.json)), per OCP-4.22 v2.1 implementation plan Revision 3 §3.0.
>
> **This document is SPECIFICATION ONLY.** Tranche 0A-0 creates no files under `scripts/minor/`.
> Implementation is Tranche 0A-1 work item 9, and is gated on human acceptance of the harvest.

---

## 1. Why this exists

Revision 3 §3.0 requires that the `scripts/minor/**` scaffolding be **derived from** the harvest rather
than designed ahead of it, and that every `PARAMETERIZE` or `REPLACE` ledger row be traceable into this
specification. There are **49 such rows** (42 PARAMETERIZE + 7 REPLACE); §8 maps all 49.

The harvest's central finding shapes everything below:

> **The 4.20 → 4.21 toolkit fork contains zero logic divergence.** All 18 forked pairs were diffed.
> Five are byte-identical; the other 13 differ only in minor literals — directory paths, provenance
> strings, banner text, URL segments. No regex, threshold, filtering rule or control-flow construct
> differs anywhere. The fork was produced by a single `sed` substitution, recorded verbatim in
> `local-docs/ocp-4.21/ASSET_MANIFEST.md` §7.

Two consequences follow, and they point in opposite directions:

1. **Parameterization is low-risk.** The usual danger — that a rewrite silently drops per-minor special
   cases — does not apply, because there are no per-minor special cases to drop. The hard-won knowledge
   is in the *filtering rules* inside `corrected-analysis.js`, which are identical across the fork and
   must move **verbatim**.
2. **The fork mechanism is actively harmful and must not survive.** `sed` rewrites *claims* without
   rewriting *evidence*. It produced a 4.21 oc-mirror extractor asserting 4.21 provenance over
   unexamined 4.20 content (ledger finding F3); it copied a frozen 4.20 statistic into a 4.21 script
   where it still prints unconditionally; and it carried forward both a parser documented as **FAILED**
   at 4.20 and an uncorrected PDF filename that had already caused a 404.

So: **keep the logic, delete the fork.**

---

## 2. Design rules

These are derived from specific ledger evidence, not from preference.

| # | Rule | Derived from |
|---|---|---|
| **R-1** | **No forking, ever.** One script per capability, taking `--minor`. No `cp -r` + `sed` step may appear in any script, runbook or procedure. | Findings F2, F3; `AUDIT_AUTOMATION_GUIDE.md` §1.2 and Quick Reference |
| **R-2** | **No defaulted minor.** A script needing a minor takes it explicitly and fails closed if absent. `process.argv[2] \|\| "4.20"` is a fallback vector and is forbidden by `CLAUDE.md`'s no-fallback rule. | `validate-param-authority.js:23`, `validate-catalog-frontend-parity.js:28`, `validate-docs-index-frontend-parity.js:43`, `docs-index-discovery.js:20`, `scenario-doc-mapping.js:19`, `refresh-doc-index.js:16`, both backfill scripts |
| **R-3** | **Never flat-`readdir` a directory that may hold version subdirectories.** Use a recursive walk or an explicit per-version path. | Finding F11: `validate-catalog.js` and `validate-catalog-agent-networkconfig-paths.js` walk recursively and survived the layout migration; `validate-catalog-frontend-parity.js` and `analyze-catalog-gaps.js` use flat `readdir` and both broke silently |
| **R-4** | **Canonical is `data/params/<minor>/`. Never read or write the frontend mirror as a source.** | Finding F6: three artifacts invert authority, and three documents teach the inversion |
| **R-5** | **Provenance is derived, never asserted.** Record the resolved branch **and commit SHA** from the actual clone; never a string literal naming a minor. | Finding F3; `ASSET_MANIFEST.md` §4 pins `1accb6487cf3784561665c08048dde20ad672c39` |
| **R-6** | **Producer and consumer field contracts are test-enforced.** | Finding F1: `parse-go-structs.js` emits `description`/`struct`; `compare-raw-extractions.js` reads `comment`/`jsonTag`/`file`. Change detection was structurally dead and nobody noticed |
| **R-7** | **Scripts take `--workspace` explicitly.** No implicit `../analysis` sibling — that assumption only makes sense inside a per-minor fork directory, which R-1 abolishes. | All of G1/G2 |
| **R-8** | **Fail loudly on empty input.** Zero catalogs found, zero Go files found, zero docs found must be an error, never an empty-but-successful result. | `analyze-catalog-gaps.js` classified all 49 parameters as "not in catalog" from an empty directory read |
| **R-9** | **Never guess; stop and report.** An unresolvable value is a hard stop, not a default. | R6 of the plan; `phase3-backfill-doc-title.js` already models this correctly and is the preferred backfill tool |
| **R-10** | **Network only in acquisition scripts, never in anything a test invokes.** Acquisition scripts live under a clearly marked subdirectory. | R4 of the plan; `backend/test/test-network-hermeticity.test.js` |
| **R-11** | **Preserve stderr.** Capture extractor stderr to a workspace log; never `2>/dev/null`. | `extract-table-params.sh:18` discards parser stderr, so a 91%-failing parser surfaced only as low counts |
| **R-12** | **Every promoted script carries a golden-fixture test, committed and hermetic.** | R4; the gap that let F1 and the 91% parser survive |

---

## 3. Proposed layout

```
scripts/minor/
├── README.md                       # invocation contract; points at the runbook
├── lib/
│   ├── minor.js                    # --minor parsing/validation via shared/versionUtils.js only
│   ├── workspace.js                # --workspace resolution, stderr log capture
│   └── provenance.js               # resolved branch + commit SHA + SHA256 recording
├── acquire/                        # R-10: THE ONLY scripts permitted network access
│   ├── fetch-docs.sh               # PDFs for a minor
│   ├── fetch-doc-html.sh           # NEW — GAP-02
│   ├── clone-installer.sh          # NEW — GAP-04
│   ├── fetch-binaries.sh           # NEW — GAP-07
│   └── refresh-doc-index.js        # promoted, --minor
├── extract/
│   ├── pdf-to-text.sh              # NEW — GAP-01
│   ├── parse-go-structs.js
│   ├── parse-agent-config-structs.js
│   ├── extract-from-html.js        # promoted verbatim
│   ├── parse-ocp-param-tables.js   # promoted verbatim
│   ├── parse-doc-parameters.js
│   ├── extract-doc-params.sh
│   ├── extract-doc-tables.sh
│   └── consolidate-doc-params.js
├── compare/
│   ├── diff-params.js              # the model script — already fully generic
│   ├── normalize-and-compare.js
│   ├── compare-source-vs-catalogs.js
│   └── corrected-analysis.js       # ⚑ HIGHEST VALUE — rules move verbatim
├── classify/
│   └── classify-delta.js           # REPLACES analyze-catalog-gaps.js
├── report/
│   ├── analyze-by-scenario.js
│   └── generate-asset-manifest.js  # NEW — GAP-03
└── verify/
    ├── verify-parameter-coverage.js
    └── analyze-ui-coverage.js      # diagnostic only — NOT a supportStatus authority
```

Scripts under `scripts/` (not `scripts/minor/`) are unchanged: those are repository validators that run
in CI against all minors, not per-minor onboarding tooling.

### Invocation contract

```
node scripts/minor/<area>/<script>.js --minor <X.Y> --workspace <dir> [script-specific flags]
```

`--minor` is validated against `SUPPORTED_MINORS` for anything touching product data; acquisition and
extraction scripts accept any well-formed minor, because acquiring 4.22 evidence must be possible while
4.22 is still unsupported (plan R3). This distinction is load-bearing and must be implemented
deliberately, not by omission.

---

## 4. The crown jewel: `compare/corrected-analysis.js`

Revision 3 §3.0 names this artifact specifically as the one that must not be lost. It exists because the
raw comparison produced a **67% false-positive rate** (340 of 502 parameters).

**It is absorbed by parameterization, not rewritten.** Only two things change: `PARAMS_DIR` becomes
`--minor`, and the hardcoded 12-element `SCENARIOS` array becomes discovery from
`data/params/<minor>/` (which also fixes its silent omission of `oc-mirror-v2`).

**Every suppression rule moves verbatim and gets a named unit test** with a positive fixture (artefact
suppressed) *and* a negative fixture (genuine discrepancy **not** suppressed):

| Rule | Test name |
|---|---|
| 8 × `nestedRequiredPatterns` regexes | one test each, named for the pattern |
| `controlPlane.platform` / `compute.platform` context-dependence | `suppresses-platform-context-requiredness` |
| deep-nested (`>2`) array-indexed paths | `suppresses-deep-nested-conditional-requiredness` |
| `ipnet.IPNet` → catalog `string` | `suppresses-cidr-type-representation` |
| `configv1.*` → catalog `string` | `suppresses-external-enum-representation` |
| `baselineCapabilitySet` / `featureSet` enum-as-string | `suppresses-capability-enum-representation` |
| `controlPlane` object-vs-array notation | `suppresses-controlplane-notation-difference` |
| cross-platform applicability via `platformMap` | `suppresses-cross-platform-inapplicable` |
| agent-config params only for agent scenarios | `suppresses-agent-config-for-non-agent-scenario` |
| `Deprecated` field skip | `suppresses-deprecated-fields` |
| orphan-nested skip when parent absent from catalog | `suppresses-orphan-nested-when-parent-absent` |

### Domain knowledge that must travel with it

This is the content whose loss the harvest gate exists to prevent. It must appear in the script's header
comment **and** in the tracked runbook:

- Expect roughly a **67% false-positive rate** on raw comparison. Platform applicability is the single
  largest source.
- **Catalogs may legitimately be stricter than Go structs.** Agent scenarios require VIPs though the
  struct marks them optional. A stricter catalog is not a defect.
- **Go type aliases serialize as primitives in YAML.** `AWSLBType`, `CloudEnvironment`,
  `ProvisioningNetwork`, `DiskType` → `string`; `ipnet.IPNet` → `string` in CIDR notation.
  **Catalogs describe YAML, not Go.**
- `imageContentSources` and `imageDigestSources` are **mutually exclusive union members**; their
  `.source` children are required only if the parent array is present.
- Nested-struct extraction is **shallow**; deeply nested paths need manual inspection.
- **Conditional requiredness cannot be read from struct tags** — validation functions must be read.
- **Runtime defaults live in `pkg/asset/installconfig/`** and are invisible in struct tags.
- **100% automation is not achievable.** Filtering rules need human judgement.

---

## 5. Scripts absorbed by parameterization

Each row names the ledger rows it absorbs and what must change.

| Target | Absorbs | Change required |
|---|---|---|
| `compare/diff-params.js` | G2 `compare-raw-extractions.js` | Already fully generic (`--baseline/--target/--output`) — **the model for this whole family**. Derive `added_in_<minor>` labels from inputs. **Fix the F1 field contract.** |
| `extract/parse-go-structs.js` | G2 `parse-go-structs.js`; retires G1 twin | Provenance string → resolved branch + commit (R-5). Emit the field names `diff-params.js` reads (R-6). |
| `extract/parse-agent-config-structs.js` | G2 `parse-agent-config-structs.js`; retires G1 twin | Same provenance change. |
| `extract/extract-from-html.js` | G2 `extract-from-html.js` (REUSE AS-IS); retires G1 twin | **None.** Promote verbatim. Zero version literals, argv in / stdout out. |
| `extract/parse-ocp-param-tables.js` | G2 `parse-ocp-param-tables.js` (REUSE AS-IS); retires G1 twin | **None.** Promote verbatim. Detects tables by generic pattern, so survives Red Hat renumbering. |
| `extract/parse-doc-parameters.js` | G2 `parse-parameters.js`; retires G1 twin | Banner only — but it must not claim to be "the OpenShift 4.21 script" while running against 4.22 (F3). |
| `extract/extract-doc-params.sh` | G2 `extract-all-params.sh`; retires G1 twin | `--workspace` (R-7). Nonzero exit on parser failure. |
| `extract/extract-doc-tables.sh` | G2 `extract-table-params.sh`; retires G1 twin | `--workspace`. **Re-point to `parse-ocp-param-tables.js`** (the iteration-1 parser is retired). **Stop discarding stderr** (R-11). |
| `extract/consolidate-doc-params.js` | G2 `consolidate-all-params.js`; retires G1 twin **and** both `consolidate-params.js` copies | `--workspace`. Preserve the malformed-path quarantine. Regression test for the `endsWith('-params.json')` collision that crashes the retired sibling. |
| `compare/normalize-and-compare.js` | G2 `normalize-and-compare.js`; retires G1 twin | `--minor`, `--workspace`. **Remove the frozen `"Before: 72 matches (15% overlap)"` 4.20 statistic** that currently prints for every minor. |
| `compare/compare-source-vs-catalogs.js` | G2 `compare-source-vs-catalogs.js`; retires G1 twin | `--minor`, `--workspace`. Error on empty catalog directory (R-8). |
| `compare/corrected-analysis.js` | G2 `corrected-analysis.js`; retires G1 twin | See §4. |
| `report/analyze-by-scenario.js` | G2 `analyze-by-scenario.js`; retires G1 twin | `--minor`, `--workspace`. Scenario discovery from the catalog directory, not a literal array. |
| `acquire/fetch-docs.sh` | G2 `download-docs.sh`; retires G1 twin | `--minor` drives every URL. **Correct the vSphere filename to `Installing_on_VMware_vSphere`** — diagnosed in Slice 5F.1, never fixed in either copy. Record SHA256 per download for GAP-03. |
| `acquire/refresh-doc-index.js` | G7 `scripts/refresh-doc-index.js` | `--minor`. **Must refuse to write when the failure rate exceeds a threshold** — a blanket 403 (35/35 during 4.21) would otherwise empty the index (FQ-4). |
| `verify/verify-parameter-coverage.js` | G7 `scripts/verify-parameter-coverage.js` | `--minor` replacing the pinned `data/params/4.20`. |
| `verify/analyze-ui-coverage.js` | G7 `scripts/analyze-ui-coverage.js` | `--minor`. **Diagnostic only** — must carry an explicit "not an authority for `supportStatus`" banner, since inference-based `supportStatus` is the R6 violation for which `add-support-status-all.js` is retired. |

### Parameterized **in place** (stay under `scripts/`, not `scripts/minor/`)

These are repository validators that CI runs across all minors. They are not per-minor onboarding tools
and must not move.

| Script | Change |
|---|---|
| `scripts/validate-param-authority.js` | Iterate `SUPPORTED_MINORS` instead of one defaulted argument (L9, and D7 for the precise scope). |
| `scripts/validate-catalog-frontend-parity.js` | **One-line fix:** include the version segment in `feDir` (L8, F11, D2 — broken for *both* minors). |
| `scripts/validate-docs-index-frontend-parity.js` | Driven per-minor by the parent entrypoint. |
| `scripts/find-hardcoded-versions.sh` | SVG false-positive fix + 4.22 adjudications. See §6. |
| `scripts/docs-index-discovery.js` | Require `--minor` (R-2). Review `KNOWN_SECTIONS` against the 4.22 doc tree. |
| `scripts/scenario-doc-mapping.js` | Require `--minor`; derive the index path. Keep network behind `--check-urls`. |
| `scripts/backfill-citation-doc-title.js` | Require `--minor`. Make the network scrape fallback opt-in; an unmapped `docId` must stop and report (R-9). |
| `scripts/phase3-backfill-doc-title.js` | Require `--minor`. **Preferred 0B backfill tool** — already R-9-compliant: no network, exits on conflict, writes nothing on any unresolved mapping. |
| `backend/scripts/crawl-doc-examples.js` | `--minor`. Acquisition-only. |
| `backend/scripts/e2e-matrix.js` | `--minor` driving both the release object and the report path; version rules as data, not inline literals. **Strategically important** — see §7. |
| `backend/scripts/validate-e2e-examples.js` | `--minor` for report path and cited URLs. Preserve its refusal to claim "pass vs example" without a real comparison. |
| `.github/workflows/ci.yml` | Add `check:app-version` and the catalog-sync drift check; authority gate iterates `SUPPORTED_MINORS`. |
| `.pre-commit-config.yaml` | Absorb the catalog-sync hook currently living only as an untracked file. |
| `local-docs/ocp-4.21/ASSET_MANIFEST.md` | Becomes the spec for `report/generate-asset-manifest.js` (GAP-03). |

---

## 6. `find-hardcoded-versions.sh` — the highest-risk item

This guard will **reject legitimate 4.22 user-facing copy by design**, and it is **already failing** at
the baseline. Two separable pieces of work, in two different tranches.

### 6.1 — 0A-1: eliminate the SVG false-positive class

`--check` exits 1 on 6 findings, all SVG path coordinates in
`frontend/src/steps/HostInventoryV2Step.jsx:901-903,908-910`.

**Root cause.** `SEARCH_PATTERN='4\.([0-9]{2,})'` has no left boundary, so it matches the tail of any
decimal whose integer part ends in `4` and whose fraction has ≥2 digits — `14.25` yields a `4.25` match.
The classifier chain has no SVG or attribute exclusion.

**A left-boundary anchor alone is insufficient.** Worked through line by line:

| Line | Path data | Boundary anchor alone? |
|---|---|---|
| 901 | `M14.25 6H10V1.75` | ✅ fixed — only match is inside `14.25` |
| 902 | `M14.25 10H10v4.25` | ❌ `v4.25` survives |
| 903 | `M1.75 10H6v4.25` | ❌ `v4.25` survives |
| 908 | `M10 1.75h4.25V6` | ❌ `h4.25` survives |
| 909 | `M14.25 10v4.25H10` | ❌ `v4.25` survives |
| 910 | `M6 14.25H1.75V10` | ✅ fixed |

A correct fix needs **both** a left-boundary anchor **and** an SVG path-data exclusion (for example,
suppressing matches inside a `<path … d="…">` attribute whose value is pure path-command syntax).

**Constraints:**
- Must **not** weaken detection of real hardcoded OpenShift versions.
- Must preserve all **38** existing self-test assertions (11 violation + 25 exemption + 2 structural).
- Must keep the structural expected-violation count at exactly **11**.
- Must add regression fixtures for this class: an `EXEMPT_svg_path` fixture containing real path data with
  both `14.25` and `v4.25`, **plus** a negative fixture proving a genuine violation adjacent to SVG markup
  is still caught. New fixtures raise the exemption and total counts only.
- Must **not** adjudicate the SVG lines as legitimate version-copy exemptions merely to make `--check` green.

**Lineage** (so the fix is not mistaken for a new regression): the SVG entered at commit `6e54610`
(2026-10-05), confirmed by `git merge-base` to be an ancestor of the `09703fa` baseline by 12 commits.
The Versioned Copy Guard workflow has been red since then.

### 6.2 — Tranche 2: admit legitimate 4.22 copy

Per L17, **in the same commit as the copy it justifies**: extend `THRESH` (currently 4.11/4.12/4.13/4.20/4.21),
`ENUMVAL` (v4.11/v4.12/v4.20) and `VGATED` (six exact 4.20/4.21 phrases); re-point the `VIOLATE_thresh_4_22`
self-test fixture to **4.23**; update `docs/VERSIONED_COPY_INVENTORY.md`.

---

## 7. `e2e-matrix.js` is strategically important and currently undervalued

Revision 3 notes that `frontend/src/catalogPaths.js:103` throws for any minor outside `SUPPORTED_MINORS`,
so frontend catalog-driven rendering at 4.22 **cannot** be exercised before the flip.

`backend/scripts/e2e-matrix.js` calls `buildInstallConfig` and `buildAgentConfig` **as plain functions**,
bypassing the HTTP boundary entirely. Parameterized with `--minor`, it can exercise the full
scenario × path generation matrix at 4.22 **while 4.22 remains publicly unsupported** — exactly the
"data + pure logic + script-level proof" layer Tranches 2 and 3 depend on. This is the cheapest available
route to broad pre-flip 4.22 generation coverage and should be treated as a Tranche 0A-1 priority rather
than an afterthought.

---

## 8. Traceability — all 49 PARAMETERIZE / REPLACE rows

Revision 3 §3.0 acceptance requires that this specification trace back to specific ledger rows.

### REPLACE (7)

| Ledger row | Replaced by | Section |
|---|---|---|
| G2 `extract-oc-mirror-params-manual.js` | **O2** canonical per-minor oc-mirror catalog + non-vacuous validation (Tranche 0B/2). Not ported. | §5 note |
| G2 `analyze-catalog-gaps.js` | `scripts/minor/classify/classify-delta.js` | §3, §8.1 |
| G5 `AUDIT_AUTOMATION_GUIDE.md` | tracked `docs/minor-release/MINOR_ONBOARDING_RUNBOOK.md` | §8.2 |
| G9 untracked `.git/hooks/pre-commit` | tracked hook config + CI-enforced parity | §5 |
| G10 `docs/PARAM_AUTHORITY.md` | rewritten in 0A-1 | §8.3 |
| G10 `docs/DATA_AND_FRONTEND_COPIES.md` | rewritten in 0A-1 | §8.3 |
| G10 `docs/CATALOG_SYNC_GUIDE.md` | rewritten in 0A-1 | §8.3 |

### PARAMETERIZE (42)

| Group | Rows | Where specified |
|---|---|---|
| G2 (12) | `analyze-by-scenario`, `compare-raw-extractions`, `compare-source-vs-catalogs`, `consolidate-all-params`, `corrected-analysis`, `download-docs`, `extract-all-params`, `extract-table-params`, `normalize-and-compare`, `parse-agent-config-structs`, `parse-go-structs`, `parse-parameters` | §4, §5 table 1 |
| G5 (1) | `ASSET_MANIFEST.md` | §5 table 2 → GAP-03 |
| G7 (11) | `validate-param-authority`, `validate-catalog-frontend-parity`, `validate-docs-index-frontend-parity`, `find-hardcoded-versions.sh`, `refresh-doc-index`, `docs-index-discovery`, `scenario-doc-mapping`, `backfill-citation-doc-title`, `phase3-backfill-doc-title`, `verify-parameter-coverage`, `analyze-ui-coverage` | §5 tables 1 and 2, §6 |
| G8 (3) | `crawl-doc-examples`, `e2e-matrix`, `validate-e2e-examples` | §5 table 2, §7 |
| G9 (2) | `ci.yml`, `.pre-commit-config.yaml` | §5 table 2 |
| G10 (13) | `PARAMETER_CATALOG`, `NEW_SCENARIO_COVERAGE_CHECKLIST`, `PARAMS_RECONCILIATION_CHECKLIST`, `DOC_INDEX_RULES`, `VERSIONED_COPY_INVENTORY`, `VERSION_AWARENESS_MASTER_STRATEGY`, `VERSION_AWARENESS_COMPLETION_MATRIX`, `SCENARIOS_GUIDE`, 4 × `SCENARIOS_*_FAMILY`, `IMPLEMENTATION_ROADMAP_2026-05-14` | §8.3 |

### 8.1 `classify/classify-delta.js` (replaces `analyze-catalog-gaps.js`)

The only automated step connecting upstream deltas to product scope. The capability is essential; the
implementation is not reusable — it reads the frontend mirror (R-4 violation), flat-`readdir`s a directory
that now holds only subdirectories (R-3 violation, currently yielding zero catalogs), hardcodes
`recommendedMinVersion: '4.21'` in four branches, and duplicates the supported-platform policy as a
private literal map.

Requirements: read canonical `data/params/<minor>/` (R-4); take the target minor as an argument; source the
supported platform/scenario set from one shared constant; **fail loudly on zero catalogs** (R-8); and emit
an unknown platform as a **stop-and-report**, not a silent `P2` default (R-9).

Its output schema should follow `slice-5c-manual-review-params.json` — the gold-standard evidence record in
the corpus, carrying `sourceFile`, `sourceLine`, verbatim `sourceEvidence`, `featureGate`,
`featureGateCondition`, `validationConstraint` and `validationFile`. That field set is precisely what **O1**
requires to separate mechanical installer capability from product supportedness, and what **O3**-style
TechPreview distinctions need in order to survive.

### 8.2 The tracked runbook (replaces `AUDIT_AUTOMATION_GUIDE.md`)

Must:
1. Open with the **cumulative-minor-support rule as rule #1** (R8, §1.0), with **no removal step** in the
   add-a-minor procedure.
2. Carry the **corrected O1 source hierarchy**. The existing guide states *"When docs conflict with
   installer code, trust installer code"* unconditionally; O1 gives Red Hat product documentation authority
   over user-facing **supportedness** while installer source owns mechanical schema reality, and requires
   recording both facts on disagreement.
3. Invoke `scripts/minor/**` with `--minor`. **No `cp`/`sed` fork step anywhere** (R-1).
4. Use versioned catalog paths (the guide's §3.3 `md5sum` verification uses the vanished flat path).
5. Record HTML extraction as the preferred route per `WEB_EXTRACTION_PLAN.md`, not PDF (finding F5).
6. Preserve verbatim the 10 domain-knowledge items in §4 above plus the two-tier deprecation strategy
   (P0 remove / P1 mark) and the "never remove without installer-source evidence **and** a replacement
   already in the catalog" rule.
7. Carry the **oc-mirror component-versioning precedent** (finding F9): `openshift-install 4.21.20` while
   `oc-mirror` reports `4.21.0`, explicitly *not* a discrepancy. This is the in-repo evidence for
   `CLAUDE.md`'s rule that a tool's version does not extend target support, and for the deliberately
   different `oc` and `oc-mirror` resolution policies.

### 8.3 Documentation corrections

Six of the 18 enumerated workflow documents carry stale **flat** frontend catalog paths — three more than
Revision 3 §2.A anticipated (discrepancy D6): `PARAM_AUTHORITY.md`, `DATA_AND_FRONTEND_COPIES.md`,
`CATALOG_SYNC_GUIDE.md`, `PARAMETER_CATALOG.md`, `NEW_SCENARIO_COVERAGE_CHECKLIST.md`,
`PARAMS_RECONCILIATION_CHECKLIST.md`.

Two further content errors, both in `DATA_AND_FRONTEND_COPIES.md`, are why it is REPLACE rather than
PARAMETERIZE: it asserts a CI parity guarantee that **does not currently hold** (the validator is broken),
and its "copy only the scenario files the UI actually uses" advice contradicts `sync-catalogs.js`'s
whole-directory mirroring and the parity validator's set-equality assertion.

`docs/PARAMS_CATALOG_RULES.md` and `docs/VERSION_AWARE_UI_FIELD_CHECKLIST.md` are **correct as written** and
are the models the others should be rewritten against — the latter notably carries **zero** version literals
and required no maintenance across the 4.20 → 4.21 transition.

**Recommended new guard:** a repo-wide docs check rejecting any tracked governance document that references
a flat frontend catalog path. The next layout change should not be able to leave instructions behind.

---

## 9. What this specification deliberately does **not** do

- It does not create any file under `scripts/minor/`. That is 0A-1.
- It does not modify any existing script, workflow, hook, schema or product file.
- It does not assign backlog IDs. Canonical IDs come from `docs/BACKLOG_STATUS.md`
  (current namespaces: `DOC-` up to 164, `PROD-` up to 046, `PHX-`) and are the human's to assign.
- It does not re-verify ledger finding **F8** (the Field Guide compartment-selection inconsistency
  recorded in `version-state-matrix.json`). That is a documented but **unproven-for-current-code**
  hypothesis and must be re-verified against live code (plan R5) before any Field Guide edit.
