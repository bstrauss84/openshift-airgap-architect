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

## The short version

- Exact release **4.22.16**, installer commit **`92820966521d640aa5f0edfb69bcfd9c168c2210`**,
  diffed against exact **4.21.35** / `006669f5812a47dbc733b6736584b87ef696e898`.
  Neither branch tip was used.
- **23 additions, 0 removals**, 2 new deprecations, 1 enum change, 0 type or requiredness
  changes, and **zero agent-config deltas of any class**.
- Exactly **one** `SUPPORTED-UI` candidate: `platform.baremetal.provisioningNetworkGateway`.
  Everything else new is behind a non-default feature gate.
- **Four HUMAN-REVIEW-REQUIRED items**; none blocks Tranche 2.
- **FQ-10 does block Tranche 2**: the frontend bundle is already 1,077 KB over budget
  before 4.22 adds ~810 KB more.

## Raw evidence

Binaries, source clones, documentation HTML and probe scratch directories are **not
tracked**. They are under `/home/bistraus/oaa-v2.1-evidence/ocp-4.22/`, and deliverable 1
carries hashes plus deterministic reproduction instructions for all of it.

## What was deliberately not done

No `data/params/4.22/**`. No frontend 4.22 mirror. No `data/docs-index/4.22.json`.
No `backend/src/fieldGuide/v4.22/**`. No change to `SUPPORTED_MINORS`. No product UI or
backend behaviour change. **Tranche 2 has not begun.**
