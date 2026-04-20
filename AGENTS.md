# AGENTS — OpenShift Airgap Architect

This file is a quick “README for AI” to keep work consistent.

## Run & Build
- Docker: `docker compose up --build`
- Podman: `podman compose up --build`
- UI: http://localhost:5173
- Backend: http://localhost:4000

## Key Outputs
- `install-config.yaml`
- `agent-config.yaml` (Bare Metal + Agent-Based only)
- `imageset-config.yaml` (oc-mirror v2)
- `FIELD_MANUAL.md`
- NTP MachineConfigs: `99-chrony-ntp-master.yaml`, `99-chrony-ntp-worker.yaml` (only when NTP set)

## Project Constraints (must follow)
- Align to official OpenShift docs for selected version (4.17–4.20) and encode version differences explicitly.
- **Parameter authority:** `data/params/<version>/*.json` is canonical; `frontend/src/data/catalogs/` must match. Before changing YAML field names or validation for a cataloged path, confirm against the params file, then run `node scripts/validate-param-authority.js` (see `docs/PARAM_AUTHORITY.md`).
- No credentials stored or exported by default. Helpers are user‑initiated; do not persist secrets.
- Long‑running operations must be observable (logs/progress/history) and safe (path validation, disk checks).

## Where Things Live
- Frontend: `frontend/src`
- Backend: `backend/src`
- Docs cache: `docs/` (saved reference docs and review notes)
- **Frontend copies of repo data:** `frontend/src/data/` only — `data/catalogs/` (param catalogs) and `data/docs-index/` (scenario doc links). Canonical source is `data/params/` and `data/docs-index/` at repo root. See `docs/DATA_AND_FRONTEND_COPIES.md`. Do not add copies elsewhere.

## Common Touchpoints
- UI state & validation: `frontend/src/App.jsx`, `frontend/src/validation.js`
- Wizard steps: `frontend/src/steps/*`
- YAML generation: `backend/src/generate.js`
- API routes: `backend/src/index.js`

## Scoped prompts
- Use `@file` to focus on a specific file, e.g. `@frontend/src/steps/GlobalStrategyStep.jsx`
- Use `@folder` to focus on a subtree, e.g. `@frontend/src/steps/`
- Use `@git` for repo status/diff context

## Notes
- Sticky step headers should remain visible throughout scroll.
- Show YAML preview only on Global Strategy, Host Inventory, Operators.
- **Plan Manager (Phase 5):** For every prompt or coordination change that updates docs or files, the summary must include concrete `git add` and `git commit` commands for those changes so the user can commit in one step.
- Governance map: `docs/INDEX.md`, `docs/BACKLOG_STATUS.md`, `docs/HELPER_USAGE.md`, `AI_GOVERNANCE.md`.
