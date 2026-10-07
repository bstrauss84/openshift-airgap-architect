# OpenShift Airgap Architect — Claude Agent Instructions

This file provides durable rules and current status for AI agents working on this codebase.

---

## Product Scope

**OpenShift Airgap Architect v2.0.0** supports exactly:

- **4.20** (baseline)
- **4.21** (current)

**4.22 is unsupported.** Cincinnati availability does not equal product support.

No fallback from 4.22 to 4.21 is allowed for catalogs, validation, preview, generated artifacts, bundle preparation, or bundle downloads.

### Tool version is not target support

A CLI binary distributed from a newer Red Hat client stream does **not** extend Architect's target OpenShift support. Architect may ship or execute an `oc-mirror` labelled 4.22+ while still supporting only target 4.20 and 4.21.

Target-version rejection must remain enforced independently of tool versions, at every boundary: release selection, imported state, catalog selection, generated configuration, preview, validation, Field Guide behavior, persisted state, and the operator workflow.

Never relax a target-version guard because a tool binary came from a newer stream.

---

## Version State Invariants

The canonical v3 state schema version fields are:

- `version.selectedMinor` (e.g., "4.21")
- `version.selectedPatch` (e.g., "4.21.20")
- `version.selectedChannel` (e.g., "stable-4.21")
- `version.locked` (boolean)

`release` is backward compatibility only.

Unknown or future schema versions (`_schemaVersion > 3`) block.

---

## Version-Aware Rules

### No Fallback Rule

If the user selects 4.22 (or any unsupported version):

- Return HTTP 422 UNSUPPORTED_VERSION
- Display recovery UI with clear "Switch to 4.21" button
- Do not silently fall back to 4.21 in any pipeline

### Shared Utilities Only

Use `shared/versionUtils.js`, `frontend/src/shared/catalogVersion.js`, and `frontend/src/shared/versionHelpers.js` for all version parsing and comparison.

**Do not** add ad hoc version parsers (split("."), substring, local regex) in production logic.

### Schema Migration Rule

Unknown schemas block at all boundaries:

- Backend: `shared/stateMigration.js` throws on `_schemaVersion > 3`
- Frontend: `frontend/src/shared/versionHelpers.js detectUnknownSchema` blocks
- API: `/api/state` validates migration before persist

---

## External tool version policy

`oc` and `oc-mirror` follow **deliberately different** rules. Do not collapse them during future maintenance.

| Tool | Policy | Channel |
|---|---|---|
| `oc-mirror` | Latest available release **globally**, independent of target minor | `clients/ocp/latest` |
| `oc` | Latest patch **within the selected supported target minor** | `clients/ocp/latest-<minor>` |

Rationale: Red Hat directs users to the latest `oc-mirror` v2 regardless of which OpenShift versions are mirrored, whereas `oc` carries a client/server compatibility expectation tied to the target cluster release. Operator discovery additionally *requires* a recent `oc-mirror`: `--v2 list operators` does not exist in 4.21.x.

Both tools must always be:

1. Resolved from the official Red Hat mirror (never a hardcoded z-stream default)
2. Verified against that channel's own `sha256sum.txt` **before** use or packaging
3. Recorded with exact resolved version, SHA256, architecture, and source URL

Fail closed on download failure, missing/unparseable checksum metadata, checksum mismatch, or unsupported architecture. Never silently fall back to an older cached binary, to `--v1`, or to unverified bytes. A later rebuild legitimately resolving a newer `oc-mirror` is **intentional**, not a reproducibility defect.

Do not rewrite Field Guide guidance to claim arbitrary future `oc` clients are supported against older clusters; Field Guide target-release compatibility guidance remains authoritative.

---

## OAA Implementation-Agent Execution Contract

Follow this for any non-trivial implementation tranche.

1. **Requirement Ledger before edits.** For each requirement record: current behavior → authoritative evidence → planned change → deterministic test → manual verification.
2. **Identifiers are immutable.** Keep the user's requirement IDs (R1, R2, …) exactly as given. Never rename, renumber, merge, or reconstruct them from memory.
3. **Verify external CLI/API behavior twice.** Check authoritative upstream docs/source **and** the exact binary actually shipped or executed. Documentation alone is not evidence that the bundled binary implements the documented contract.
4. **Hypothesis ≠ root cause.** Label unproven mechanisms as hypotheses and say so.
5. **"Edited" is not "fixed."** Only claim a fix after the real user-facing path is exercised and passes.
6. **Behavior-level tests** for user-facing behavior wherever practical, not just string assertions.
7. **Findings Queue.** Record unrelated discoveries for the backlog instead of silently expanding scope.
8. **Reconcile docs last.** README and `docs/BACKLOG_STATUS.md` updates happen only after final tested behavior.
9. **No final report while background work is running.** Wait for every shell/agent task to finish.
10. **Final report maps:** requirement → implementation → test → manual verification → remaining work.
11. **Never invent or reuse backlog IDs** without reading canonical `docs/BACKLOG_STATUS.md` first.
12. **The human controls Git mutations** unless explicitly instructed otherwise.
13. **When vendor behavior varies across versions**, exact-binary validation is mandatory.

If a requirement conflicts with another requirement or with proven upstream behavior, **stop and report the conflict before editing**.

---

## Evidence and Testing Discipline

- Mark work `done_pending_verification` until tests pass and manual checks complete
- Move to `verified_done` only after evidence is committed to git
- Cite commit SHAs, file paths, test results, and manual verification
- Never claim completion without code evidence

---

## Documentation Authority Hierarchy

1. **`docs/BACKLOG_STATUS.md`** — Single source of truth for all status claims
2. **`CLAUDE.md`** (this file) — Durable agent rules and current immediate task
3. **`docs/IMPLEMENTATION_ROADMAP_2026-05-14.md`** — Versioned roadmap

> A previous revision listed `docs/HANDOFF_PACKET.md` at position 3. That file
> has never been tracked in this repository, and `docs/LOCAL_IGNORED_DOCS_TRIAGE.md`
> classifies it as a local handoff note, "non-canonical by design", triaged
> `archive_now`. The dangling entry is removed rather than replaced: no
> substitute document is invented to satisfy a stale link.

**UI contract:** `docs/DESIGN_SYSTEM.md` is the canonical UI consistency contract.
Before adding or modifying version-gated UI fields, read `docs/VERSION_AWARE_UI_FIELD_CHECKLIST.md`.

When docs conflict, trust the order above.

---

## Git Safety Rules

### Before Committing

1. Review `git status` and `git diff`
2. Stage specific files (avoid `git add -A`)
3. Write meaningful commit message
4. Ensure tests pass
5. Check for sensitive data (`.env`, credentials)

### Destructive Operations Require User Approval

- `git reset --hard`, `git push --force`, `git checkout --` (on files)
- Deleting branches, dropping database tables, killing processes
- Force-pushing, amending published commits
- Removing or downgrading packages
- Modifying CI/CD pipelines

Run `git status` before any command that could discard uncommitted work. Stop and ask the user how to proceed.

### Never Skip Hooks

Do not use `--no-verify` or `--no-gpg-sign` unless explicitly requested. If a hook fails, investigate and fix.

---

## Claude Session Rules

### Do Not Stage or Commit Unless Requested

The user controls the commit workflow. Provide exact `git add` and `git commit` commands in your response, but do not execute them.

### Do Not Stash, Reset, Restore, or Clean Without Explicit Request

`git stash`, `git reset`, `git restore`, `git clean` are destructive. Only run after user approval.

### Do Not Discard Working-Tree Changes

If the user asks for a new task and the working tree is dirty, stop and report status. Ask the user how to proceed.

---

## Testing Requirements

### Before Marking Work Complete

1. Frontend tests pass: `cd frontend && npm test`
2. Backend tests pass: `cd backend && npm test`
3. Build succeeds: `npm run build`
4. No console errors in development mode
5. Manual verification if UI changes

### Test Coverage Expectations

- New features require tests
- Bug fixes should include regression tests
- UI changes: manual verification required
- API changes: integration tests required

---

**Last Updated:** 2026-09-18
**Revision:** v2.0.0 GA — removed stale next-step section, version awareness complete
