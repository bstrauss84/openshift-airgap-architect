# Contributing to OpenShift Airgap Architect

## UI Contract (North Star)

- **`docs/DESIGN_SYSTEM.md`** is the tracked UI contract for this project.
- If a change conflicts with it, the change must **STOP** and propose an alternative.
- No new tabs or steps should be added unless they map to the documented workflow.

## Run and build

- **Docker:** `docker compose up --build`
- **Podman:** `podman compose up --build`
- **UI:** http://localhost:5173  
- **Backend:** http://localhost:4000

On **Apple Silicon or other non-x86_64 hosts**, follow **README** (“Platform and architecture”) as the product source of truth for current runtime behavior. Use **`docs/OPERATOR_SCAN_ARCHITECTURE_PLAN.md`** as historical/working context.

If you use `compose down --remove-orphans` followed by `image prune --force` before `compose up --build`, prune may report *image is in use by a container*. That usually means another container (or Podman’s reference) still uses that image; you can ignore it or run `podman container prune -f` (or `docker container prune -f`) first. The app will still run. In the frontend container, *Re-optimizing dependencies because lockfile has changed* is normal when the lockfile or mounts differ from Vite’s cache and is safe to ignore.

## Verify before pushing

Run these from the repo root. They are the same checks CI runs.

```bash
# Frontend: install, build, and test
cd frontend && npm ci && npm run test
# Optional: performance budget after build (BUNDLE_SIZE_LIMIT_KB, default 2048)
# cd frontend && npm run build && npm run check-size

# Backend: install and test (use npm install if npm ci cannot be used yet)
cd backend && npm ci && npm test
```

**Secret scan (optional):** `./scripts/check-secrets.sh` from the repo root. If **gitleaks** is installed, it runs the full scan; otherwise the script falls back to a ripgrep scan for high-confidence patterns. To install gitleaks:

- **Fedora / RHEL:** `sudo dnf install gitleaks`
- **macOS:** `brew install gitleaks`
- **Other:** [gitleaks releases](https://github.com/gitleaks/gitleaks/releases) (place the binary in your PATH)

CI always runs gitleaks on push/PR; the local script is for pre-push checks.

## Data and frontend copies

**Canonical** parameter catalogs and docs index live at repo root in `data/params/` and `data/docs-index/`. The frontend keeps **copies** under **`frontend/src/data/`** only (`data/catalogs/` and `data/docs-index/`) so the app works in Docker and standalone builds. Do not add copies in other locations. See **`docs/DATA_AND_FRONTEND_COPIES.md`** for the full convention and sync rules.

## Doc index (data/docs-index)

The versioned docs index (`data/docs-index/*.json`) drives which OCP doc links are shown for each scenario. The **canonical base URL is docs.redhat.com** (e.g. `https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/`). The index is the **source of truth** and is **not auto-generated in CI**; CI only runs schema validation. See `docs/DOC_INDEX_RULES.md` for structure and inclusion rules. **Run these from the repo root** (not from `frontend/` or `backend/`):

- **Refresh the index (validate URLs, prune dead links):**
  ```bash
  node scripts/refresh-doc-index.js
  ```
  This reads `data/docs-index/4.20.json`, checks each doc URL, and overwrites the file with only live URLs. Use `node scripts/refresh-doc-index.js --dry-run` to print a summary without writing.

- **Validate schema (required keys, scenarios object, doc shape):**
  ```bash
  node scripts/validate-docs-index.js
  ```
  CI runs this on every push/PR. All documentation links must use docs.redhat.com (docs.openshift.com is shut down). Run it locally after editing any `data/docs-index/*.json` by hand.

## Optional: secret scan (pre-commit)

To avoid committing secrets, run the secret checker before committing:

```bash
./scripts/check-secrets.sh
```

This runs **gitleaks** if installed; otherwise it skips (CI runs gitleaks on every push/PR). Install: [gitleaks](https://github.com/gitleaks/gitleaks#installation).

## Optional: pre-commit hooks

```bash
pip install pre-commit   # or: brew install pre-commit
pre-commit install
```

Hooks run on `git commit`; the secret check is included when gitleaks is available.

## Optional: lint and format

- **Lint:** From repo root, `npx eslint backend frontend` (uses `.eslintrc.cjs`). Fix issues before committing if you touch linted files.
- **Format:** `npx prettier --check .` to check; `npx prettier --write .` to format (respects `.prettierignore`). Not enforced in CI.

## Feedback feature local configuration (DOC-041)

Feedback submission is backend-configured; do not hardcode recipient addresses in code or docs.

- `FEEDBACK_MODE=disabled|relay|managed|offline`
- `FEEDBACK_RELAY_URL` and `FEEDBACK_RELAY_TOKEN` for relay mode
- `FEEDBACK_PROVIDER`, `FEEDBACK_PROVIDER_WEBHOOK_URL`, and `FEEDBACK_PROVIDER_TOKEN` for managed mode
- `FEEDBACK_CHALLENGE_SECRET` for anti-bot challenge signing

Recommended local default:

```bash
FEEDBACK_MODE=disabled
```

If you want local offline handoff export, set:

```bash
FEEDBACK_MODE=offline
```

Online modes fail closed unless fully configured:
- `FEEDBACK_MODE=relay` requires `FEEDBACK_RELAY_URL` and `FEEDBACK_CHALLENGE_SECRET`
- `FEEDBACK_MODE=managed` requires `FEEDBACK_PROVIDER_WEBHOOK_URL` and `FEEDBACK_CHALLENGE_SECRET`

High-side/disconnected deployments should set mode/operating profile so feedback is hidden and submission is disabled.

## Tests (for agents and contributors)

- **Frontend:** `cd frontend && npm run test` — runs Vitest once (`vitest run`). Frontend tests can live in **`frontend/tests/`** (e.g. routing, step UI, fixtures) or next to source in `frontend/src` (e.g. `LandingPage.smoke.test.jsx`). Add `*.test.jsx` / `*.spec.jsx` in either location for new coverage.
- **Backend:** `cd backend && npm test` — runs Node `node --test` on `backend/test/`. Add `*.test.js` there; no app code changes required.

When to run: before committing, and after changing backend `src/` or frontend `src/`. CI runs both on push/PR.

Testing guardrails:

- Keep `App.jsx` null-state guards (`state?.ui`, `state?.ui?.activeStepId`, and early-return effects) intact; they prevent boot/hydration/import crashes and reduce async test flakiness.
- Keep theme readability checks in place (`frontend/tests/theme-readability.test.jsx`) to protect light/dark contrast regressions.

**Lockfile and audit:** Do not run `npm audit fix --force` unless explicitly requested; it can cause lockfile churn and breaking dependency upgrades.

## Key outputs (reference)

- `install-config.yaml`
- `agent-config.yaml` (Bare Metal + Agent-Based only)
- `imageset-config.yaml` (oc-mirror v2)
- `FIELD_MANUAL.md`
- NTP MachineConfigs when NTP is set: `99-chrony-ntp-master.yaml`, `99-chrony-ntp-worker.yaml`
- Mirror-source install-config key is version-gated: `imageDigestSources` for OCP `4.14+`, `imageContentSources` for OCP `4.13` and earlier.
- If this is questioned, use installer source for the target release branch as tie-breaker (for 4.20: `pkg/asset/agent/joiner/clusterinfo.go` has `ImageDigestSources` plus `DeprecatedImageContentSources`).

## Project rules

See `.cursor/rules/` and `AGENTS.md` for AI/agent guidance. Align to official OpenShift docs for the selected version (4.17–4.20); do not store or export credentials by default.

## Governance docs map

For canonical ownership and status tracking:

- `docs/INDEX.md` (documentation authority map)
- `docs/BACKLOG_STATUS.md` (canonical backlog/status registry)
- `docs/HELPER_USAGE.md` (helper selection and usage)
- `AI_GOVERNANCE.md` (AI-assisted workflow policy)
