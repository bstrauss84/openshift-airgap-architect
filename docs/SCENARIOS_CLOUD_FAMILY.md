# Cloud Scenario Family Guide

This family guide covers cloud scenarios that currently do not have one deep standalone tracked doc per scenario.

It is canonical for cloud scenario navigation and coverage framing.

## Table of contents

- [Scope](#scope)
- [Canonical sources](#canonical-sources)
- [Scenario map](#scenario-map)
- [Scenario truth sections](#scenario-truth-sections)
- [Coverage and gap snapshot](#coverage-and-gap-snapshot)
- [Follow-ups](#follow-ups)

<a id="scope"></a>
## Scope

- `aws-govcloud-ipi`
- `aws-govcloud-upi`
- `azure-government-ipi`
- `ibm-cloud-ipi`

<a id="canonical-sources"></a>
## Canonical sources

- `data/docs-index/4.20.json`
- `data/params/4.20/aws-govcloud-ipi.json`
- `data/params/4.20/aws-govcloud-upi.json`
- `data/params/4.20/azure-government-ipi.json`
- `data/params/4.20/ibm-cloud-ipi.json`
- `docs/DOC_INDEX_RULES.md`
- `docs/PARAMS_CATALOG_RULES.md`
- `docs/BACKLOG_STATUS.md`
- `docs/SCENARIOS_GUIDE.md`

<a id="scenario-map"></a>
## Scenario map

| Scenario ID | Method | Deep tracked doc | Current truth location |
|---|---|---|---|
| `aws-govcloud-ipi` | IPI | no standalone deep doc | docs-index + params + app behavior |
| `aws-govcloud-upi` | UPI | no standalone deep doc | docs-index + params + app behavior |
| `azure-government-ipi` | IPI | no standalone deep doc | docs-index + params + app behavior |
| `ibm-cloud-ipi` | IPI | no standalone deep doc | docs-index + params + app behavior |

<a id="scenario-truth-sections"></a>
## Scenario truth sections

### AWS GovCloud (`aws-govcloud-ipi`, `aws-govcloud-upi`)

- Primary truth is catalog/docs-index plus platform-specific wizard and generation behavior.
- `publish` and `credentialsMode` behavior should stay aligned with cloud-specific platform sections and validations.
- Networking and mirroring constraints are shared with global rules in `docs/PARAMS_CATALOG_RULES.md`.
- Required-region validation and publish-related constraints are enforced in tracked validation logic.

### Azure Government (`azure-government-ipi`)

- Primary truth is catalog/docs-index plus Azure platform-specific sections in the app.
- Cloud name/region/resource-group and publish/credentials behavior are treated as cloud family truth.
- Any scenario-specific caveat not covered by shared cloud rules belongs in this family guide section first.
- Required Azure field validation is implemented in tracked validation rules for this scenario.

### IBM Cloud (`ibm-cloud-ipi`)

- IBM Cloud is a supported scenario and is explicitly tracked here as cloud-family truth.
- Primary references:
  - `data/params/4.20/ibm-cloud-ipi.json`
  - `data/docs-index/4.20.json`
  - tracked backend/frontend implementation and validations
- Current structural rule: IBM Cloud scenario truth is maintained in this family guide unless a dedicated deep doc becomes necessary.
- Current implementation-enforced caveats:
  - `credentialsMode` is treated as `Manual` for IBM Cloud IPI.
  - IBM Cloud networking is currently treated as IPv4-only in 4.20 validations.
  - Existing-VPC mode requires network resource group, VPC name, and subnet values.

<a id="coverage-and-gap-snapshot"></a>
## Coverage and gap snapshot

| Area | Status | Notes |
|---|---|---|
| Scenario navigation | covered | All cloud scenarios are represented in this family map. |
| Scenario-specific caveats | partial | Some caveats still live in implementation/backlog narratives and should be promoted here when durable. |
| Deep docs | intentionally minimal | No forced per-scenario deep-doc sprawl unless complexity justifies it. |
| IBM Cloud structural presence | covered | IBM Cloud now has explicit family-home placement. |

<a id="follow-ups"></a>
## Follow-ups

- If cloud-scenario complexity grows, split deep docs by scenario only when required by sustained differences.
- Keep this guide concise, scenario-specific, and non-duplicative of global policy docs.
- Use `docs/BACKLOG_STATUS.md` for open/active/deferred status tracking.
