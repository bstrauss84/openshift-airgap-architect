# Scenario Guide and Working-Doc Map

This is the canonical scenario navigation entry point.

If you are not sure where scenario truth lives, start here first.

Scope: tracked repository docs only. Local and archived docs are triaged through `docs/LOCAL_IGNORED_DOCS_TRIAGE.md`.

## Table of contents

- [How to use this guide](#how-to-use-this-guide)
- [Canonical scenario family guides](#canonical-scenario-family-guides)
- [Supported scenario map](#supported-scenario-map)
- [Family deep docs](#family-deep-docs)
- [Cross-scenario rules and references](#cross-scenario-rules-and-references)
- [Historical and non-canonical materials](#historical-and-non-canonical-materials)
- [When to create a new scenario doc](#when-to-create-a-new-scenario-doc)

<a id="how-to-use-this-guide"></a>
## How to use this guide

1. Identify scenario ID in `data/docs-index/4.20.json`.
2. Go to the family guide listed for that scenario.
3. Use `docs/BACKLOG_STATUS.md` for canonical status.
4. Use deep working docs only for implementation detail and provenance.

<a id="canonical-scenario-family-guides"></a>
## Canonical scenario family guides

- `docs/SCENARIOS_BARE_METAL_FAMILY.md`
- `docs/SCENARIOS_VSPHERE_FAMILY.md`
- `docs/SCENARIOS_CLOUD_FAMILY.md`
- `docs/SCENARIOS_NUTANIX_FAMILY.md`

<a id="supported-scenario-map"></a>
## Supported scenario map

| Scenario ID | Platform / Method | Family guide | Primary deep doc(s) |
|---|---|---|---|
| `bare-metal-agent` | Bare Metal / Agent-based | `docs/SCENARIOS_BARE_METAL_FAMILY.md` | `docs/BARE_METAL_4_20_AGENT_DOC_REVIEW_AND_PLAN.md` |
| `bare-metal-ipi` | Bare Metal / IPI | `docs/SCENARIOS_BARE_METAL_FAMILY.md` | `docs/BARE_METAL_4_20_IPI_DOC_REVIEW_AND_PLAN.md` |
| `bare-metal-upi` | Bare Metal / UPI | `docs/SCENARIOS_BARE_METAL_FAMILY.md` | `docs/BARE_METAL_4_20_UPI_DOC_REVIEW_AND_PLAN.md` |
| `vsphere-agent` | vSphere / Agent-based | `docs/SCENARIOS_VSPHERE_FAMILY.md` | `docs/VSPHERE_4_20_AGENT_DOC_REVIEW_AND_PLAN.md` |
| `vsphere-ipi` | vSphere / IPI | `docs/SCENARIOS_VSPHERE_FAMILY.md` | `docs/VSPHERE_4_20_IPI_DOC_REVIEW_AND_PLAN.md` |
| `vsphere-upi` | vSphere / UPI | `docs/SCENARIOS_VSPHERE_FAMILY.md` | `docs/VSPHERE_4_20_UPI_DOC_REVIEW_AND_PLAN.md` |
| `aws-govcloud-ipi` | AWS GovCloud / IPI | `docs/SCENARIOS_CLOUD_FAMILY.md` | family-level cloud sections + params/docs-index |
| `aws-govcloud-upi` | AWS GovCloud / UPI | `docs/SCENARIOS_CLOUD_FAMILY.md` | family-level cloud sections + params/docs-index |
| `azure-government-ipi` | Azure Government / IPI | `docs/SCENARIOS_CLOUD_FAMILY.md` | family-level cloud sections + params/docs-index |
| `ibm-cloud-ipi` | IBM Cloud / IPI | `docs/SCENARIOS_CLOUD_FAMILY.md` | explicit IBM section in cloud family guide |
| `nutanix-ipi` | Nutanix / IPI | `docs/SCENARIOS_NUTANIX_FAMILY.md` | `docs/NUTANIX_4_20_IPI_DOC_REVIEW_AND_PLAN.md` |

<a id="family-deep-docs"></a>
## Family deep docs

- Bare metal deep docs:
  - `docs/BARE_METAL_4_20_AGENT_DOC_REVIEW_AND_PLAN.md`
  - `docs/BARE_METAL_4_20_IPI_DOC_REVIEW_AND_PLAN.md`
  - `docs/BARE_METAL_4_20_UPI_DOC_REVIEW_AND_PLAN.md`
- vSphere deep docs:
  - `docs/VSPHERE_4_20_AGENT_DOC_REVIEW_AND_PLAN.md`
  - `docs/VSPHERE_4_20_IPI_DOC_REVIEW_AND_PLAN.md`
  - `docs/VSPHERE_4_20_UPI_DOC_REVIEW_AND_PLAN.md`
- Nutanix deep docs:
  - `docs/NUTANIX_4_20_IPI_DOC_REVIEW_AND_PLAN.md`

<a id="cross-scenario-rules-and-references"></a>
## Cross-scenario rules and references

- `docs/DOC_INDEX_RULES.md`
- `docs/PARAMS_CATALOG_RULES.md`
- `docs/CANONICAL_DOC_SOURCE_AND_EXAMPLE_CAPTURE_RULES.md`
- `docs/DATA_AND_FRONTEND_COPIES.md`
- `docs/PARAMS_RECONCILIATION_CHECKLIST.md`
- `docs/e2e-examples/README.md`
- `docs/e2e-examples/INVENTORY.md`
- `docs/e2e-examples/REFERENCE.md`

<a id="historical-and-non-canonical-materials"></a>
## Historical and non-canonical materials

Working and historical docs can still be useful for provenance, but they are non-canonical for current status decisions.

Use `docs/BACKLOG_STATUS.md` for status truth and `docs/LOCAL_IGNORED_DOCS_TRIAGE.md` for archive/local handling.

Raw external snapshots are intentionally excluded from tracked scenario truth.
Keep them local/archive-only when needed for temporary research, and ingest only durable conclusions into canonical docs.

<a id="when-to-create-a-new-scenario-doc"></a>
## When to create a new scenario doc

Create a new standalone scenario working doc only when all are true:

1. The scenario has unique truth/caveats not covered by an existing family guide.
2. The update cannot be represented as a section in an existing family guide.
3. The new doc links to:
   - `docs/SCENARIOS_GUIDE.md`
   - `docs/BACKLOG_STATUS.md`
   - `docs/INDEX.md`
