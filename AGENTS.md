# AGENTS — OpenShift Airgap Architect

This file is a quick "README for AI" to keep work consistent.

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

## Project Constraints

- Align to official OpenShift docs for selected version (4.20–4.21) and encode version differences explicitly.
- **Parameter authority:** `data/params/<version>/*.json` is canonical; `frontend/src/data/catalogs/<version>/` must match. Before changing YAML field names or validation for a cataloged path, confirm against the params file.
- No credentials stored or exported by default. Helpers are user-initiated; do not persist secrets.
- Long-running operations must be observable (logs/progress/history) and safe (path validation, disk checks).

## Where Things Live

- Frontend: `frontend/src`
- Backend: `backend/src`
- Docs cache: `docs/` (saved reference docs and review notes)
- **Frontend copies of repo data:** `frontend/src/data/` only — `data/catalogs/<version>/` (param catalogs) and `data/docs-index/<version>/` (scenario doc links). Canonical source is `data/params/<version>/` and `data/docs-index/<version>/` at repo root.

## Documentation Hierarchy

See **CLAUDE.md** for rules and **docs/BACKLOG_STATUS.md** for status.

## Git Workflow

**User controls commits.** Provide `git add` and `git commit` commands in your response, but do not execute them.

**Do not stage or commit unless requested.**

**Do not stash, reset, restore, or clean without explicit user request.**

---

**Last Updated:** 2026-07-09
**Revision:** Aligned with CLAUDE.md, removed stale workflow claims
