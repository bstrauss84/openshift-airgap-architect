# OCP 4.22 onboarding evidence — Tranche 1

> **4.22 is UNSUPPORTED and fail-closed.** Every document in this directory is
> acquisition, research and classification evidence. **None of it authorizes any product
> behaviour**, and no 4.22 product asset exists.
>
> Supported minors remain **4.20 and 4.21**. Status authority for anything here is
> `docs/BACKLOG_STATUS.md`.

Produced by Phase 1 / Tranche 1 of the v2.1 OCP 4.22 onboarding effort, following
[`../MINOR_ONBOARDING_RUNBOOK.md`](../MINOR_ONBOARDING_RUNBOOK.md).

---

## Deliverables

| # | Document | Contents |
|---|---|---|
| 1 | [`ACQUISITION_MANIFEST_4.22.md`](ACQUISITION_MANIFEST_4.22.md) · [json](acquisition-manifest-4.22.json) | exact release pin, hashes, commits, Cincinnati snapshot, reproduction |
| 2 | [`MECHANICAL_DELTA_LEDGER_4.21_TO_4.22.md`](MECHANICAL_DELTA_LEDGER_4.21_TO_4.22.md) · [json](mechanical-delta-4.21-to-4.22.json) | exact 4.21.35 → 4.22.16 source delta, binary-verified |
| 3 | [`SUPPORTABILITY_CLASSIFICATION_4.22.md`](SUPPORTABILITY_CLASSIFICATION_4.22.md) · [json](supportability-classification-4.22.json) | proposed classifications + 4 human-review items |
| 4 | [`PLATFORM_METHOD_ARCH_MATRIX_4.22.md`](PLATFORM_METHOD_ARCH_MATRIX_4.22.md) · [json](platform-method-arch-4.22.json) | platform × method × architecture, FIPS, DOC-156 |
| 5 | [`ODF_OPERATOR_EVIDENCE_4.22.md`](ODF_OPERATOR_EVIDENCE_4.22.md) | ODF 4.22 packages, Quick Pick deltas, O9 |
| 6 | [`DOC165_GENERATED_CONFIG_COVERAGE_4.22.md`](DOC165_GENERATED_CONFIG_COVERAGE_4.22.md) | agent-config / NMState coverage research |
| 7 | [`DOC166_OC_MIRROR_V2_AUTHORITY.md`](DOC166_OC_MIRROR_V2_AUTHORITY.md) | global oc-mirror v2 authority split |
| 8 | [`FIELD_GUIDE_DOCS_INDEX_SOURCES_4.22.md`](FIELD_GUIDE_DOCS_INDEX_SOURCES_4.22.md) · [json](docs-sources-4.22.json) | 4.22 book inventory and compartment plan |
| 9 | [`FQ10_BUNDLE_BUDGET_EVIDENCE.md`](FQ10_BUNDLE_BUDGET_EVIDENCE.md) | bundle baseline — **blocker before Tranche 2** |
| 10 | [`AUTOMATION_REUSE_REPORT_TRANCHE_1.md`](AUTOMATION_REUSE_REPORT_TRANCHE_1.md) | reuse vs improvement, gap status |

## Tranche 1.5 — blocker closure

| Document | Contents |
|---|---|
| [`FQ9_IMAGESET_CONFIG_REMEDIATION.md`](FQ9_IMAGESET_CONFIG_REMEDIATION.md) | FQ-9 root cause and fix, full field audit, catalog reconciliation, DOC-166 status |
| [`H_ITEM_DISPOSITIONS.md`](H_ITEM_DISPOSITIONS.md) | final deterministic dispositions for H1–H4 |

Both **supersede** parts of the Tranche-1 documents above; the superseded sections carry
inline pointers.

## The short version

- Exact release **4.22.16**, installer commit **`92820966521d640aa5f0edfb69bcfd9c168c2210`**,
  diffed against exact **4.21.35** / `006669f5812a47dbc733b6736584b87ef696e898`.
  Neither branch tip was used.
- **23 additions, 0 removals**, 2 new deprecations, 1 enum change, 0 type or requiredness
  changes, and **zero agent-config deltas of any class**.
- Exactly **one** `SUPPORTED-UI` candidate: `platform.baremetal.provisioningNetworkGateway`.
  Everything else new is behind a non-default feature gate. *(Tranche 2: confirmed and
  implemented — documentation re-verified in the 4.22 Provisioning APIs book.)*
- **Four HUMAN-REVIEW-REQUIRED items**; none blocks Tranche 2.
- **FQ-10 blocked Tranche 2 and is now closed** (Tranche 1.5): per-minor lazy loading
  took the eager bundle from 2,698 KB to 1,146 KB, and an explicit three-metric budget
  now gates CI.
- **FQ-9 is closed** (Tranche 1.5): the generated `imageset-config.yaml` is accepted by
  the exact current oc-mirror v2, and a second silent defect — the mirror payload
  architecture — was found and fixed alongside it.

## Raw evidence

Binaries, source clones, documentation HTML and probe scratch directories are **not
tracked**. They are under `/home/bistraus/oaa-v2.1-evidence/ocp-4.22/`, and deliverable 1
carries hashes plus deterministic reproduction instructions for all of it.

## Tranche 2 — asset authoring

| Document | Contents |
|---|---|
| [`TRANCHE_2_ASSET_AUTHORING_4.22.md`](TRANCHE_2_ASSET_AUTHORING_4.22.md) | the 4.22 catalogs, docs-index, architecture-support matrix and Field Guide, with acquisition-time URL validation, the citation section-heading remapping, and the fail-closed proof |
| [`TRANCHE_3_RUNTIME_PREREQUISITES.md`](TRANCHE_3_RUNTIME_PREREQUISITES.md) | D3 as the runtime architecture authority, the `provisioningNetworkGateway` runtime prerequisite, the DOC-166 audit, and the support-flip fallback audit — all behind the closed gate |

Tranche 2 **supersedes** the Tranche 1 "deliberately not done" list below: those assets
now exist. Classification **C1 stands as written** — its documentation citation was
re-verified in the OCP 4.22 *Provisioning APIs* book (Chapter 13 §13.1.1 `.spec`), and
`platform.baremetal.provisioningNetworkGateway` is authored as `supported-ui`.

## What Tranche 1 deliberately did not do *(superseded by Tranche 2)*

> **Historical.** Every line in this paragraph was true at the end of Tranche 1 and is
> no longer true. It is retained as the Tranche 1 record, not as current status.

No `data/params/4.22/**`. No frontend 4.22 mirror. No `data/docs-index/4.22.json`.
No `backend/src/fieldGuide/v4.22/**`.

## Current status

- **Tranche 2 assets are complete** — catalogs, docs-index, architecture-support matrix
  and Field Guide source, all validated.
- **Tranche 3 runtime prerequisites are complete** — the architecture matrix is the
  runtime authority, `provisioningNetworkGateway` has UI, state, validation and
  version-gated generation, and the support-flip fallback audit is closed.
- **4.22 remains UNSUPPORTED and fail-closed.** `SUPPORTED_MINORS` is unchanged and no
  public boundary accepts 4.22.
- **4.20 and 4.21 behaviour is unchanged**, including byte-identical install-config.
- **Tranche 4 has not begun, and the support flip has not begun.**
