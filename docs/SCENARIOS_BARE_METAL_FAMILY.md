# Bare Metal Scenario Family Guide

This is the family-level consolidation guide for bare-metal scenarios.

It does not replace deep working docs; it centralizes navigation and validation status.

## Table of contents

- [Scope](#scope)
- [Canonical sources](#canonical-sources)
- [Scenario map](#scenario-map)
- [Scenario truth sections](#scenario-truth-sections)
- [Deep working docs (authoritative for detail)](#deep-working-docs-authoritative-for-detail)
- [Cross-cutting technical notes](#cross-cutting-technical-notes)
- [Relevance validation snapshot](#relevance-validation-snapshot)
- [Gaps and follow-ups](#gaps-and-follow-ups)



## Scope

- `bare-metal-agent`
- `bare-metal-ipi`
- `bare-metal-upi`



## Canonical sources

- `data/docs-index/4.20.json`
- `docs/DOC_INDEX_RULES.md`
- `docs/PARAMS_CATALOG_RULES.md`
- `docs/BACKLOG_STATUS.md`
- `docs/SCENARIOS_GUIDE.md`



## Scenario map


| Scenario ID        | Install method | Canonical docs-index status | Primary deep doc                                    |
| ------------------ | -------------- | --------------------------- | --------------------------------------------------- |
| `bare-metal-agent` | Agent-based    | Present in docs-index       | `docs/BARE_METAL_4_20_AGENT_DOC_REVIEW_AND_PLAN.md` |
| `bare-metal-ipi`   | IPI            | Present in docs-index       | `docs/BARE_METAL_4_20_IPI_DOC_REVIEW_AND_PLAN.md`   |
| `bare-metal-upi`   | UPI            | Present in docs-index       | `docs/BARE_METAL_4_20_UPI_DOC_REVIEW_AND_PLAN.md`   |




## Deep working docs (authoritative for detail)

- `docs/BARE_METAL_4_20_AGENT_DOC_REVIEW_AND_PLAN.md`
- `docs/BARE_METAL_4_20_IPI_DOC_REVIEW_AND_PLAN.md`
- `docs/BARE_METAL_4_20_UPI_DOC_REVIEW_AND_PLAN.md`



## Scenario truth sections

### `bare-metal-agent`

- Agent-based install flow with `agent-config.yaml` output in scope.
- Host inventory, rendezvous, and agent-config-oriented constraints are defined in the deep agent doc.
- Use this scenario when host-level inventory and agent workflow behavior are required.

### `bare-metal-ipi`

- Installer-provisioned bare metal flow with bare-metal platform sections in install-config.
- Provisioning-network and host/provisioning choices belong to this scenario, not UPI.
- Use deep IPI doc for provisioning-specific caveats and parameter mapping.

### `bare-metal-upi`

- User-provisioned bare metal flow; no IPI host provisioning blocks should be treated as canonical output.
- UPI behavior is intentionally constrained compared with IPI (manual provisioning responsibilities remain external to app-generated YAML).
- Use deep UPI doc for UPI-only caveats and mapping.



## Cross-cutting technical notes

- `docs/BARE_METAL_IPV4_IPV6_VIP_TRUTH_4_20.md`
- `docs/MIRRORING_SECTION_GATING.md`
- `docs/PLACEHOLDER_VALUES_DEFERRED.md`



## Relevance validation snapshot


| Artifact                                       | Why still relevant                                   | Validation basis                           |
| ---------------------------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| `BARE_METAL_4_20_AGENT_DOC_REVIEW_AND_PLAN.md` | Scenario-specific truth and implementation alignment | File header and scenario snapshot sections |
| `BARE_METAL_4_20_IPI_DOC_REVIEW_AND_PLAN.md`   | IPI-specific mapping/reconciliation details          | File snapshot and docs mapping sections    |
| `BARE_METAL_4_20_UPI_DOC_REVIEW_AND_PLAN.md`   | UPI-specific constraints and mapping                 | File snapshot and docs mapping sections    |
| `BARE_METAL_IPV4_IPV6_VIP_TRUTH_4_20.md`       | Cross-scenario networking/VIP truth decisions        | Truth table and UI consequences sections   |
| `MIRRORING_SECTION_GATING.md`                  | Current frontend/backend gating rule                 | Explicit rule and status sections          |




## Gaps and follow-ups

- Keep this family guide synchronized when new bare-metal scenario docs are added.
- Keep status claims in `docs/BACKLOG_STATUS.md`; do not duplicate status truth here.

