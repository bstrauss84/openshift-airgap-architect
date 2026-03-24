# vSphere Scenario Family Guide

This is the family-level consolidation guide for vSphere scenarios.

It centralizes the large vSphere doc set without deleting any detail docs.

## Table of contents

- [Scope](#scope)
- [Canonical sources](#canonical-sources)
- [Scenario map](#scenario-map)
- [Scenario truth sections](#scenario-truth-sections)
- [Deep working docs (authoritative for detail)](#deep-working-docs-authoritative-for-detail)
- [Verification and follow-up docs](#verification-and-follow-up-docs)
- [Relevance validation snapshot](#relevance-validation-snapshot)
- [Gaps and follow-ups](#gaps-and-follow-ups)

<a id="scope"></a>
## Scope

- `vsphere-agent`
- `vsphere-ipi`
- `vsphere-upi`

<a id="canonical-sources"></a>
## Canonical sources

- `data/docs-index/4.20.json`
- `docs/DOC_INDEX_RULES.md`
- `docs/PARAMS_CATALOG_RULES.md`
- `docs/BACKLOG_STATUS.md`
- `docs/SCENARIOS_GUIDE.md`

<a id="scenario-map"></a>
## Scenario map

| Scenario ID | Install method | Canonical docs-index status | Primary deep doc |
|---|---|---|---|
| `vsphere-agent` | Agent-based | Present in docs-index | `docs/VSPHERE_4_20_AGENT_DOC_REVIEW_AND_PLAN.md` |
| `vsphere-ipi` | IPI | Present in docs-index | `docs/VSPHERE_4_20_IPI_DOC_REVIEW_AND_PLAN.md` |
| `vsphere-upi` | UPI | Present in docs-index | `docs/VSPHERE_4_20_UPI_DOC_REVIEW_AND_PLAN.md` |

<a id="deep-working-docs-authoritative-for-detail"></a>
## Deep working docs (authoritative for detail)

- `docs/VSPHERE_4_20_AGENT_DOC_REVIEW_AND_PLAN.md`
- `docs/VSPHERE_4_20_IPI_DOC_REVIEW_AND_PLAN.md`
- `docs/VSPHERE_4_20_UPI_DOC_REVIEW_AND_PLAN.md`

<a id="scenario-truth-sections"></a>
## Scenario truth sections

### `vsphere-agent`

- Agent-based vSphere flow with vSphere platform values plus agent-oriented host flow.
- Use deep agent doc for scenario-specific caveats and host-flow behavior.

### `vsphere-ipi`

- IPI flow with vSphere platform topology and failure-domain concerns.
- Structural audits and follow-up findings under this family remain supporting evidence, not status authority.
- Use deep IPI doc first, then audit/follow-up docs as provenance.

### `vsphere-upi`

- UPI flow on vSphere with UPI responsibilities and constraints separated from IPI assumptions.
- Use deep UPI doc for scenario-specific caveats and mapping.

<a id="verification-and-follow-up-docs"></a>
## Verification and follow-up docs

- `docs/VSPHERE_4_20_IPI_STRUCTURAL_AUDIT.md`
- `docs/VSPHERE_IPI_UPI_AUDIT_AND_PLAN.md`
- `docs/VSPHERE_CORRECTIVE_FOLLOWUP_FINDINGS.md`
- `docs/VSPHERE_HARDENING_FINDINGS.md`
- `docs/VSPHERE_FINAL_VERIFICATION.md`

<a id="relevance-validation-snapshot"></a>
## Relevance validation snapshot

| Artifact | Why still relevant | Validation basis |
|---|---|---|
| `VSPHERE_4_20_IPI_DOC_REVIEW_AND_PLAN.md` | Most complete IPI scenario truth and implementation sync narrative | Current code truth table and phase sections |
| `VSPHERE_4_20_UPI_DOC_REVIEW_AND_PLAN.md` | UPI-specific doc mapping and conditional rules | Phase A mapping and scenario scope sections |
| `VSPHERE_4_20_AGENT_DOC_REVIEW_AND_PLAN.md` | Agent-based vSphere-specific caveats and coverage decisions | Top-level status/caveat statements |
| `VSPHERE_4_20_IPI_STRUCTURAL_AUDIT.md` | Structural validation evidence for completed IPI behavior | Itemized audit sections |
| `VSPHERE_FINAL_VERIFICATION.md` | Final verification snapshot and evidence checklist | Phase tables and deliverable checklist |
| `VSPHERE_IPI_UPI_AUDIT_AND_PLAN.md` | Cross-method synthesis and implementation context | status line and discrepancy sections |

<a id="gaps-and-follow-ups"></a>
## Gaps and follow-ups

- Status terminology differs across vSphere docs; canonicalize in `docs/BACKLOG_STATUS.md`.
- Keep this family guide as the first stop to avoid opening many vSphere docs blindly.
