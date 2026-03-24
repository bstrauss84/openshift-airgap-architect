# Nutanix Scenario Family Guide

This family guide isolates Nutanix scenario truth so cloud-family guidance stays clean and focused.

## Table of contents

- [Scope](#scope)
- [Canonical sources](#canonical-sources)
- [Scenario map](#scenario-map)
- [Deep docs and references](#deep-docs-and-references)
- [Coverage and gap snapshot](#coverage-and-gap-snapshot)
- [Follow-ups](#follow-ups)

<a id="scope"></a>
## Scope

- `nutanix-ipi`

<a id="canonical-sources"></a>
## Canonical sources

- `data/docs-index/4.20.json`
- `data/params/4.20/nutanix-ipi.json`
- `docs/DOC_INDEX_RULES.md`
- `docs/PARAMS_CATALOG_RULES.md`
- `docs/BACKLOG_STATUS.md`
- `docs/SCENARIOS_GUIDE.md`

<a id="scenario-map"></a>
## Scenario map

| Scenario ID | Method | Deep tracked doc | Current truth location |
|---|---|---|---|
| `nutanix-ipi` | IPI | `docs/NUTANIX_4_20_IPI_DOC_REVIEW_AND_PLAN.md` | docs-index + params + Nutanix deep doc |

<a id="deep-docs-and-references"></a>
## Deep docs and references

- `docs/NUTANIX_4_20_IPI_DOC_REVIEW_AND_PLAN.md`
- `docs/NEW_SCENARIO_COVERAGE_CHECKLIST.md`
- `docs/PARAMS_RECONCILIATION_CHECKLIST.md`

<a id="coverage-and-gap-snapshot"></a>
## Coverage and gap snapshot

| Area | Status | Notes |
|---|---|---|
| Scenario navigation | covered | Nutanix has a dedicated family-home doc and deep doc reference. |
| Deep scenario truth | covered | Primary working truth remains in Nutanix deep review/plan doc. |
| Follow-up debt | partial | Keep unresolved Nutanix-specific gaps in canonical backlog and avoid scattered side docs. |

<a id="follow-ups"></a>
## Follow-ups

- Keep this guide as the first Nutanix entry point and avoid creating parallel "final/followup" docs.
- When Nutanix caveats stabilize, promote durable rules into this family guide and global policy docs where appropriate.
- Keep status truth centralized in `docs/BACKLOG_STATUS.md`.
