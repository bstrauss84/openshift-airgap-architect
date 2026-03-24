# Local Ignored Docs Triage and Promotion Plan

This file tracks local ignored docs discovered in the workspace and defines how to preserve relevant content safely.

## Why this exists

The repository currently contains many local docs ignored by git (for example `docs/PHASE_*`, `docs/E2E_*`, `docs/UI_NORTH_STAR.md`).
Some contain potentially relevant project context, but they are not canonical until promoted.

## Scope and evidence

Ignored docs inventory source:

- `git ls-files --others -i --exclude-standard docs`

This triage file uses that inventory as input and defines promotion criteria and next actions.

## Triage classes

- `ingest_then_archive`: extract still-relevant claims into tracked canonical docs, then archive local source.
- `archive_now`: safe to archive immediately (historical, local-only, or regeneratable artifacts).
- `keep_local`: intentionally keep in local workspace for active ad-hoc work (should be temporary).

## Final reconciliation status (all ignored docs)

This section supersedes the initial triage and records final disposition for every ignored top-level local doc currently matched by `.gitignore`.

| Local ignored doc | Final action | Canonical target or rationale |
|---|---|---|
| `docs/DEEP_DIVE_FINDINGS.md` | ingest_then_archive | Resolve any still-open platform findings into `docs/BACKLOG_STATUS.md`; archive historical narrative. |
| `docs/E2E_BACKLOG.md` | ingest_then_archive | Canonicalize remaining backlog rows in `docs/BACKLOG_STATUS.md`. |
| `docs/E2E_EXHAUSTIVE_REPORT_4.20.md` | ingest_then_archive | Keep only unresolved evidence in `docs/BACKLOG_STATUS.md`; archive bulk report. |
| `docs/E2E_FINDINGS_AND_RECOMMENDATIONS.md` | ingest_then_archive | Promote surviving recommendations to `docs/BACKLOG_STATUS.md`; archive tactical detail. |
| `docs/E2E_FOLLOWUP_REPORT_4.20.md` | archive_now | Historical follow-up report; status truth now in `docs/BACKLOG_STATUS.md`. |
| `docs/E2E_K_COMPLETION_CHECKLIST.md` | archive_now | Completion snapshot only; superseded by canonical backlog. |
| `docs/E2E_K_PART4_CHECKLIST.md` | ingest_then_archive | Keep unresolved verification notes in canonical backlog; archive checklist. |
| `docs/E2E_MATRIX.md` | archive_now | Stale matrix view; canonical scenario/status registry is tracked elsewhere. |
| `docs/E2E_PART2_REPORT_4.20.md` | ingest_then_archive | Preserve unresolved discrepancies in `docs/BACKLOG_STATUS.md`; archive report. |
| `docs/E2E_REPORT_4.20.md` | ingest_then_archive | Promote still-relevant matrix-level gaps into canonical backlog. |
| `docs/HANDOFF_PACKET.md` | archive_now | Local handoff note; non-canonical by design. |
| `docs/LANDING_PAGE_CHANGES.md` | archive_now | Local UI notes; superseded by tracked docs and code. |
| `docs/PATTERNFLY_SCOPE.md` | archive_now | Local scope note; superseded by tracked docs and code. |
| `docs/PHASE1_CI_AGENT_PROMPT.md` | ingest_then_archive | Promote durable CI/doc-host guardrails into tracked governance docs; archive prompt text. |
| `docs/PHASE_1-3_REDO_DELTA_REPORT.md` | ingest_then_archive | Capture any still-open deltas in canonical backlog; archive historical report. |
| `docs/PHASE_4_5_COVERAGE_BARE_METAL_AGENT.md` | ingest_then_archive | Keep only unresolved coverage gaps in canonical backlog; archive full working file. |
| `docs/PHASE_4_5_RECOMMENDATIONS.md` | ingest_then_archive | Promote surviving recommendations; archive tactical list. |
| `docs/PHASE_5_A1_4.20_NOTES.md` | ingest_then_archive | Canonicalize open A1 notes in backlog; archive local note. |
| `docs/PHASE_5_AGENT_ROLES.md` | archive_now | Local process aid; governance now tracked in `docs/HELPER_USAGE.md` and `AI_GOVERNANCE.md`. |
| `docs/PHASE_5_B_DEFERRAL_LIST.md` | ingest_then_archive | Keep deferred status rows in `docs/BACKLOG_STATUS.md`; archive local deferral file. |
| `docs/PHASE_5_E_VULN_AND_AUDIT.md` | ingest_then_archive | Promote unresolved security/dependency items into canonical backlog; archive report. |
| `docs/PHASE_5_F_GIT_HYGIENE.md` | ingest_then_archive | Promote durable hygiene policy into tracked governance docs/backlog; archive local note. |
| `docs/PHASE_5_GAP_REMEDIATION_AND_CARRYOVER.md` | ingest_then_archive | Already partially ingested; ingest remaining unresolved rows, then archive. |
| `docs/PHASE_5_HOW_TO_USE_PROMPTS_AND_DOCS.md` | archive_now | Local execution instructions; canonical helper guidance is tracked. |
| `docs/PHASE_5_IDENTITY_ACCESS_AND_HEADER_FOLLOWUPS.md` | ingest_then_archive | Preserve unresolved follow-ups in canonical backlog; archive local working note. |
| `docs/PHASE_5_POST_PHASE_REVIEW.md` | archive_now | Historical completion report. |
| `docs/PHASE_5_POST_SCENARIO_AGENT_PLAN.md` | archive_now | Local plan artifact; canonical status tracked in `docs/BACKLOG_STATUS.md`. |
| `docs/PHASE_5_POST_SCENARIO_PROMPTS.md` | archive_now | Local prompt pack; non-canonical execution artifact. |
| `docs/PHASE_5_PROMPTS_NEXT.md` | archive_now | Local prompt pack; non-canonical execution artifact. |
| `docs/PHASE_5_REMAINING_WORK.md` | ingest_then_archive | Remaining actionable rows have canonical equivalents in backlog; archive source list. |
| `docs/PHASE_5_REPO_HEALTH_REPORT.md` | archive_now | Historical health snapshot; superseded by current tracked status docs. |
| `docs/PHASE_5_SCENARIO_EXPANSION.md` | ingest_then_archive | Promote unresolved scenario expansion items into canonical backlog; archive local plan. |
| `docs/PHASE_5_TRANSITION_PLAN.md` | archive_now | Local transition narrative; non-canonical. |
| `docs/PHASE_5_WHAT_NEXT_AFTER_5_1_5_2.md` | archive_now | Local sequencing note; superseded by canonical backlog. |
| `docs/PROMPT_GUARDRAILS.md` | ingest_then_archive | Extract durable guardrails into `docs/HELPER_USAGE.md`/`AI_GOVERNANCE.md`; archive local file. |
| `docs/REFACTOR_MVP_TRACKER.md` | ingest_then_archive | Move unresolved work items to canonical backlog; archive tactical tracker. |
| `docs/REQUIREMENTS_REMAINING.md` | ingest_then_archive | Reconcile surviving requirement gaps in canonical backlog; archive local checklist. |
| `docs/REQUIREMENTS_VERBATIM.md` | ingest_then_archive | Keep only unresolved requirement commitments in canonical backlog; archive local mirror. |
| `docs/REVIEW_NOTES.md` | ingest_then_archive | Lift any still-open issue(s) to canonical backlog and archive local notes. |
| `docs/SCENARIO_CATALOG_PLAN.md` | archive_now | Early planning artifact superseded by tracked scenario/docs-index rules and data. |
| `docs/TESTING_NOTES.md` | ingest_then_archive | Promote durable test guidance into `docs/CONTRIBUTING.md`; archive local notes. |
| `docs/UI_NORTH_STAR.md` | ingest_then_archive | Extract durable UI contract language into tracked docs (primarily `docs/DESIGN_SYSTEM.md`); archive local source. |
| `docs/e2e-examples/SNIPPETS_INVENTORY.md` | archive_now | Regeneratable crawl inventory; non-canonical. |
| `docs/e2e-examples/snippets/*` | archive_now | Regeneratable crawl output. |
| `docs/e2e-examples/nmstate/*` | archive_now | Local example corpus; non-canonical. |

## Safe promotion workflow

For each `ingest_then_archive` candidate:

1. Read file and extract concrete claims.
2. Verify claim against tracked code/docs/tests.
3. Promote only verified content into tracked canonical docs.
4. Add provenance note in `docs/BACKLOG_STATUS.md` item.
5. Do not duplicate full local doc verbatim unless explicitly needed.

## Canonical ingestion summary (completed)

The remaining local-doc work has been normalized to this rule:

1. Canonical status and prioritization live in `docs/BACKLOG_STATUS.md`.
2. Canonical helper/governance guidance lives in `docs/HELPER_USAGE.md` and `AI_GOVERNANCE.md`.
3. Canonical scenario navigation lives in `docs/SCENARIOS_GUIDE.md` and family guides.
4. Local ignored docs are archival evidence, not active authority.

## Verification pass outcomes (Phase 5/E2E ingestion)

The following local docs were reviewed and reconciled against tracked code/docs:

- `docs/PHASE_5_REMAINING_WORK.md`
- `docs/E2E_BACKLOG.md`
- `docs/PHASE_5_GAP_REMEDIATION_AND_CARRYOVER.md`

Result:

- Carry-over item implemented and verified in canonical backlog: dual-stack E2E assertion parity (`DOC-018`).
- Scope-gated carry-over item recorded as deferred: OVN MTU/geneve/ipsec install-config expansion (`DOC-019`).
- Item treated as covered/superseded by tracked guidance: trust-bundle policy note (`DOC-020`).
- Local continuity items recorded for verification closure: header actions reorg (`DOC-021`) and "Help me decide" parity (`DOC-022`).

Canonical references:

- Status registry: `docs/BACKLOG_STATUS.md`
- Scenario navigation: `docs/SCENARIOS_GUIDE.md`

## Archive operation guidance (full set)

Archive destination:

- `/home/billstrauss/code/archived_docs`

Archive mode:

- Move ignored local docs and regeneratable example corpora out of the repository working tree into the archive path.
- Preserve relative paths under `docs/` so archived context remains navigable.
