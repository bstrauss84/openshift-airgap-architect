# OpenShift Airgap Architect — Claude Agent Instructions

This file provides durable rules and current status for AI agents working on this codebase.

---

## Product Scope

**OpenShift Airgap Architect v2.0.0** supports exactly:

- **4.20** (baseline)
- **4.21** (current)

**4.22 is unsupported.** Cincinnati availability does not equal product support.

No fallback from 4.22 to 4.21 is allowed for catalogs, validation, preview, generated artifacts, bundle preparation, or bundle downloads.

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

## Evidence and Testing Discipline

- Mark work `done_pending_verification` until tests pass and manual checks complete
- Move to `verified_done` only after evidence is committed to git
- Cite commit SHAs, file paths, test results, and manual verification
- Never claim completion without code evidence

---

## Documentation Authority Hierarchy

1. **`docs/BACKLOG_STATUS.md`** — Single source of truth for all status claims
2. **`CLAUDE.md`** (this file) — Durable agent rules and current immediate task
3. **`docs/HANDOFF_PACKET.md`** — Latest accepted work, next task pointer
4. **`docs/IMPLEMENTATION_ROADMAP_2026-05-14.md`** — Versioned roadmap

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

## Current Immediate Next Step

**Slice 5F is accepted and committed.** The recovery button is styled and functional.

**Next task:** Determine the next v2.0 version-aware slice from current code and canonical backlog.

Read:
- `docs/BACKLOG_STATUS.md` (DOC-102, DOC-103, DOC-104 status)
- `docs/HANDOFF_PACKET.md` (current branch, HEAD, clean status)
- Git log last 8 commits

Then propose the next slice from DOC-102/DOC-103/DOC-104 work remaining.

**Do not start Slice 5G or any new implementation until the next task is chosen from a read-only reconciliation.**

**Do not trust old planning docs that claim implementation has not started.**

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

**Last Updated:** 2026-07-09
**Revision:** Slice 5F cleanup — concise durable rules, removed stale roadmap claims
