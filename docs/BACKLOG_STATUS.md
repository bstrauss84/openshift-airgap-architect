# Backlog and Status Registry

This file is the canonical, tracked source of truth for project backlog and implementation status.

Do not use local-only files (for example `LOCAL_BACKLOG.md`) as canonical status references in committed docs.

## Canonical status vocabulary

- `active`: planned and in-scope
- `deferred`: intentionally postponed
- `blocked`: cannot progress until blocker is resolved
- `done_pending_verification`: implemented, but verification is incomplete
- `verified_done`: implemented and verified against code/tests
- `obsolete`: no longer relevant to current direction
- `superseded`: replaced by another item

## Priority vocabulary

- `p0`: urgent correctness/security impact
- `p1`: high product impact
- `p2`: normal planned work
- `p3`: low-priority improvement

## Evidence-first reconciliation workflow

For each status update:

1. Capture the claim source (doc path and text).
2. Verify in code and tests.
3. Set canonical status from evidence.
4. If conflicts exist, mark older claim as superseded and link back here.

## Active reconciliation items

| item_id | title | status | priority | source_docs | code_evidence | next_action |
|---|---|---|---|---|---|---|
| DOC-001 | Normalize docs host to docs.redhat.com in docs-index and frontend copy | active | p1 | `docs/DOC_INDEX_RULES.md`, `docs/CANONICAL_DOC_SOURCE_AND_EXAMPLE_CAPTURE_RULES.md`, `data/docs-index/4.20.json`, `frontend/src/data/docs-index/4.20.json` | `scripts/refresh-doc-index.js`, `scripts/validate-docs-index.js` | Replace remaining docs.openshift.com links or explicitly document exceptions in one canonical place. |
| DOC-002 | Reconcile scenario ID inventory across rules, schema, and docs-index | active | p1 | `docs/DOC_INDEX_RULES.md`, `schema/scenarios.json`, `data/docs-index/4.20.json` | `scripts/validate-docs-index.js`, `scripts/validate-catalog.js` | Align scenario list and document unsupported or pending scenario IDs clearly. |
| DOC-003 | Replace missing `UI_NORTH_STAR.md` contract reference with tracked source | done_pending_verification | p1 | `docs/CONTRIBUTING.md`, `.gitignore` | `docs/DESIGN_SYSTEM.md` | Keep `docs/DESIGN_SYSTEM.md` as tracked UI contract and remove stale references. |
| DOC-004 | Remove references to missing `PHASE_5_*` documents | done_pending_verification | p1 | `docs/CODE_STYLE_RULES.md`, `frontend/src/catalogResolver.js`, `backend/src/generate.js` | referenced source files | Replace with links to tracked governance docs (`docs/INDEX.md`, `docs/PARAMS_CATALOG_RULES.md`). |
| DOC-005 | Add canonical docs/navigation hub and authority labels | done_pending_verification | p1 | `docs/INDEX.md` | N/A | Keep this file updated as authority map changes. |
| DOC-006 | Consolidate helper usage model into one tracked guide | done_pending_verification | p2 | `AGENTS.md`, `docs/HELPER_USAGE.md` | N/A | Keep helper taxonomy and routing rules synchronized with `AGENTS.md`. |
| DOC-007 | Introduce AI governance policy for Cursor-first workflow | done_pending_verification | p1 | `AI_GOVERNANCE.md` | CI and process docs | Adopt policy in contributor flow and future PR templates if added. |
| DOC-008 | Resolve E2E inventory count drift ("9 scenarios" vs current docs-index) | done_pending_verification | p2 | `docs/e2e-examples/INVENTORY.md`, `data/docs-index/4.20.json` | N/A | Clarify scope language to avoid mismatch with scenario IDs. |
| DOC-009 | Investigate missing README screenshots under `docs/images/` | active | p2 | `README.md` | N/A | Either add assets, update paths, or remove image links. |

## Deferred items

| item_id | title | status | priority | source_docs | rationale |
|---|---|---|---|---|---|
| DEF-001 | Placeholder values non-destructive architecture | deferred | p2 | `docs/PLACEHOLDER_VALUES_DEFERRED.md` | Keep deferred until export-token architecture is defined and validated. |
| DEF-002 | Full automation for frontend data-copy parity checks in CI | deferred | p2 | `docs/DATA_AND_FRONTEND_COPIES.md`, `.github/workflows/ci.yml` | Requires additional script and CI integration; low-risk to defer in first pass. |
| DEF-003 | Deep per-scenario verification sweep for all status-bearing docs | deferred | p2 | `docs/*_DOC_REVIEW_AND_PLAN.md` | Requires larger implementation sweep; sequence after canonical registry rollout. |

## Completed and verified

No items have been marked `verified_done` in this initial consolidation pass.
Verification requires explicit code/test evidence capture.

## Intake template for future recommendations

Use this template for new requests (for example, "support platform none scenarios across the app"):

```markdown
### request_id: REQ-XXX
- request_title:
- category: docs | helper | backlog | governance | feature
- scope: global | scenario-specific
- scenario_ids:
- motivation:
- affected_sources:
- initial_priority: p0 | p1 | p2 | p3
- status: active
- validation_requirements:
- owner:
```

## Migration rule for old status references

When updating any status-bearing working doc:

1. Keep historical narrative if useful.
2. Add: `Canonical status: docs/BACKLOG_STATUS.md`.
3. Remove references to untracked/local-only backlog files.

## Low-risk migration sequence

Use this order to reduce churn and avoid context loss:

1. Establish canonical authority links (`docs/INDEX.md`, this file, `docs/HELPER_USAGE.md`, `AI_GOVERNANCE.md`).
2. Normalize broken/missing references to tracked docs.
3. Reconcile status labels in high-traffic docs and add superseded pointers.
4. Reconcile machine-readable contradictions (scenario IDs, docs host links) with evidence.
5. Add archive banners to superseded historical docs after their key context is captured here.

## Conflict resolution workflow

1. If two docs disagree, open or update one item row in this file.
2. Attach evidence paths from code/tests/CI to the row.
3. Set canonical status and next action in this file.
4. In older docs, add a short note pointing to this item row as canonical status.
