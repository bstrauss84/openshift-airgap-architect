# Documentation Index and Authority Map

This is the canonical map for project documentation authority, ownership, and usage.

Use this file first when deciding where new information belongs.

## Scope note

This authority map is built from tracked repository docs (`git ls-files`).
Local ignored docs under `docs/` are not treated as canonical until they are explicitly triaged and promoted.
Triage source and process: `docs/LOCAL_IGNORED_DOCS_TRIAGE.md`.

## Authority tiers

### Tier 1: Authoritative current truth

These files define current expected behavior and process.

- Product behavior and operations: `README.md`
- Contributor workflow: `docs/CONTRIBUTING.md`
- Security and secrets policy: `docs/SECURITY_NOTES.md`
- SBOM, vulnerability evidence and provenance status: `docs/security/SBOM_AND_PROVENANCE.md`
- API exposure, authentication and trust-anchor decisions awaiting human sign-off: `docs/security/DECISION_RECORD_API_EXPOSURE_AND_TRUST_ANCHORS.md`
- Release notes and the commit-coverage audit behind them: `docs/releases/`
- Update workflow: `docs/UPDATING.md`
- Data and docs source-of-truth rules:
  - `docs/DATA_AND_FRONTEND_COPIES.md`
  - `docs/DOC_INDEX_RULES.md`
  - `docs/PARAMS_CATALOG_RULES.md`
  - `docs/PARAM_AUTHORITY.md`
  - `docs/CANONICAL_DOC_SOURCE_AND_EXAMPLE_CAPTURE_RULES.md`
- UI consistency contract: `docs/DESIGN_SYSTEM.md`
- Version-aware UI field checklist: `docs/VERSION_AWARE_UI_FIELD_CHECKLIST.md`
- Scenario navigation hub: `docs/SCENARIOS_GUIDE.md`
- Backlog and status truth: `docs/BACKLOG_STATUS.md`
- Helper selection and usage: `docs/HELPER_USAGE.md`
- AI governance and compliance: `AI_GOVERNANCE.md`

Policy-retention rule:

- Keep only non-duplicative policy docs in Tier 1.
- If two policy docs govern the same behavior, one becomes canonical and the other must be downgraded or merged.

### Tier 2: Working docs

These files are valuable but may include historical context, implementation notes, and in-progress decisions.

- Scenario review and reconciliation docs:
  - `docs/*_DOC_REVIEW_AND_PLAN.md`
  - `docs/*_AUDIT*.md`
  - `docs/*_FINDINGS*.md`
  - `docs/*_VERIFICATION*.md`
- Comparative docs (role-scoped):

  > **NOT TRACKED IN THIS REPOSITORY.** The six comparative documents listed
  > below are local working notes that were never committed. They are kept in
  > this index as a record of the analysis the architecture drew on, and are
  > explicitly marked absent so a reader does not hunt for them — this file's
  > own rule at the bottom ("confirm linked files exist and are tracked") was
  > being violated by these entries.
  >
  > `BACKLOG_STATUS.md` names the umbrella document as #2 in its authority
  > chain. Since that file is not in the repository, the operative authority
  > chain for anyone working from a clone is: `docs/BACKLOG_STATUS.md`, then
  > `CLAUDE.md`, then `docs/IMPLEMENTATION_ROADMAP_2026-05-14.md` (historical).
  > No substitute document is invented here to satisfy the link.

  - Umbrella/master comparative strategy (not canonical status authority):
    - `docs/COMPREHENSIVE_COMPARATIVE_INTEGRATION_MASTER.md` — *absent (untracked local note)*
  - Tool-specific deep-dive comparative dossiers (implementation-grade planning; not canonical status authority):
    - `docs/ABA_COMPARISON_REVISED_PLAN_2026-03-24.md` — *absent (untracked local note)*
    - `docs/DISCOVERY_ISO_COMPARISON_REVISED_PLAN_2026-03-24.md` — *absent (untracked local note)*
    - `docs/CLUSTERFILE_COMPARISON_REVISED_PLAN_2026-03-17.md` — *absent (untracked local note)*
    - `docs/AUTOSHIFTV2_COMPARISON_REVISED_PLAN_2026-03-23.md` — *absent (untracked local note)*
  - Historical/background comparative docs (non-primary for current implementation guidance):
    - `docs/CLUSTERFILE_FEATURE_ANALYSIS_AND_PLAN.md` — *absent (untracked local note)*
  - Related comparative/context planning docs:
    - `docs/OPERATOR_SCAN_ARCHITECTURE_PLAN.md`
    - `docs/OC_MIRROR_V2_RUN_TAB_RESEARCH_AND_PLAN.md`

### Tier 3: Historical or superseded

Historical snapshots are retained for context but are not authoritative when they conflict with Tier 1.

When updating a historical doc, add a short banner at top with:

- `Authority: Historical`
- `Superseded by: <Tier 1 path>`
- `Reason: <short reason>`

### Raw external captures (non-canonical)

Raw external snapshots are not tracked as canonical project docs in this repository.
If a temporary capture is needed for research, keep it local/archive-only and ingest durable conclusions into Tier 1 docs.

## Canonical ownership by topic

- Docs index and doc URL policy: `docs/DOC_INDEX_RULES.md`
- Parameter catalog policy: `docs/PARAMS_CATALOG_RULES.md`; enforcement workflow: `docs/PARAM_AUTHORITY.md`
- Data copy and sync policy: `docs/DATA_AND_FRONTEND_COPIES.md`
- Scenario-specific navigation and grouping: `docs/SCENARIOS_GUIDE.md`
- Scenario family consolidation hubs:
  - `docs/SCENARIOS_BARE_METAL_FAMILY.md`
  - `docs/SCENARIOS_VSPHERE_FAMILY.md`
  - `docs/SCENARIOS_CLOUD_FAMILY.md`
  - `docs/SCENARIOS_NUTANIX_FAMILY.md`
- Backlog status and intake: `docs/BACKLOG_STATUS.md`
- Helper and agent invocation strategy: `docs/HELPER_USAGE.md`
- AI assistance governance and compliance: `AI_GOVERNANCE.md`

## Contradiction handling rule

When two docs conflict:

1. Tier 1 beats Tier 2 and Tier 3.
2. Machine-checked truth (code/tests/CI) beats text claims.
3. Resolve the conflict in Tier 1 first, then mark older statements as superseded.

## Where to add new information

- New process or policy: add to Tier 1 doc and link here.
- New scenario investigation: update `docs/SCENARIOS_GUIDE.md`, then create/update Tier 2 working docs and cross-link from `docs/BACKLOG_STATUS.md`.
- New future request or deferred item: add to `docs/BACKLOG_STATUS.md` using the intake template there.
- New promotion of local ignored content: follow `docs/LOCAL_IGNORED_DOCS_TRIAGE.md`.

## Required cross-check before merge

For any doc-governance change:

1. Update this index when authority or ownership changes.
2. Confirm linked files exist and are tracked.
3. Confirm no new references to local-only files (for example `LOCAL_BACKLOG.md`).
