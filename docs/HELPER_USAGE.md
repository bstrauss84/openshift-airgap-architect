# Helper Usage Guide

This file defines how to choose and use helpers/agents with minimal prompt sprawl and maximum output quality.

## Core rules

- Keep `AGENTS.md` concise and global.
- Put detailed process rules in canonical docs, not repeated in prompt text.
- For any helper output that changes behavior, require code/doc evidence links.
- For security/network/disconnected recommendations, require human validation before merge.
- Scope helpers tightly to requested files and behavior; do not perform unrelated refactors.
- Reference the tracked UI contract at `docs/DESIGN_SYSTEM.md` for UI changes.

## Helper taxonomy

### 1) Doc-truth helper

Use when reconciling:

- docs-index entries
- parameter catalogs and citations
- scenario doc alignment against official docs

Primary references:

- `docs/DOC_INDEX_RULES.md`
- `docs/PARAMS_CATALOG_RULES.md`
- `docs/CANONICAL_DOC_SOURCE_AND_EXAMPLE_CAPTURE_RULES.md`

### 2) Backlog-truth helper

Use when:

- reconciling conflicting status claims
- normalizing status labels
- updating canonical item state

Primary reference:

- `docs/BACKLOG_STATUS.md`

### 3) Governance/compliance helper

Use when:

- evaluating AI-assistance policy fit
- checking secrets/data-safety guardrails
- reviewing airgap/no-phone-home assumptions

Primary references:

- `AI_GOVERNANCE.md`
- `docs/SECURITY_NOTES.md`
- `.cursor/rules/core-guidelines.mdc`

### 4) Validation helper

Use when:

- assembling verification checklist for change sets
- mapping behavior claims to tests and CI signals

Primary references:

- `docs/CONTRIBUTING.md`
- `.github/workflows/ci.yml`

### 5) Release-note / commit-hygiene helper

Use when:

- summarizing why a change exists
- ensuring commit/PR metadata includes required validation statements

Primary references:

- `AI_GOVERNANCE.md`
- `docs/CONTRIBUTING.md`

### 6) Comparative-integration helper (Bill + Daniel direction)

Use when:

- evaluating wrap vs merge vs rewrite decisions across external inspirations
- evaluating schema-truth vs docs-truth vs installer-truth decision gates
- framing bounded governance/security implications in planning artifacts
- preparing stakeholder/productization decision packets

Primary references:

- `docs/COMPREHENSIVE_COMPARATIVE_INTEGRATION_MASTER.md`
- `docs/BACKLOG_STATUS.md`
- `AI_GOVERNANCE.md`

## How to choose a helper quickly

- Status conflict? Use backlog-truth helper.
- Source/citation mismatch? Use doc-truth helper.
- Policy/risk question? Use governance helper.
- Need verification matrix? Use validation helper.
- Need final narrative for review/PR? Use release-note helper.
- Working comparative merger decision? Use comparative-integration helper.

## Prompt template (shared)

Use this structure for helper calls to reduce token waste:

```text
Goal:
Scope:
Inputs (paths):
Non-goals:
Output contract:
Evidence required:
```

Prompt header snippet for UI work:

```text
This work must align with docs/DESIGN_SYSTEM.md. If anything conflicts, STOP and propose an alternative.
```

## Output contract requirements

Every helper output should include:

- Summary of findings
- File-path evidence
- Assumptions and unknowns
- Suggested next actions
- Clear status recommendation when relevant

## Anti-sprawl rules

- Do not create helper-specific policy duplicates when policy already exists in Tier 1 docs.
- Do not add new helper docs unless existing taxonomy cannot cover the request.
- If a helper instruction grows beyond one screen, move reusable content into canonical docs and link to it.
- Treat local ignored prompt packs (for example `docs/PHASE_*` and `docs/PROMPT_*`) as non-canonical until triaged in `docs/LOCAL_IGNORED_DOCS_TRIAGE.md`.
