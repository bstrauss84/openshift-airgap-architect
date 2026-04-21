# Post-UBI container verification

> Authority: Working verification note
> Canonical status source: `docs/BACKLOG_STATUS.md`
> Canonical navigation source: `docs/INDEX.md`

After migrating app containers from Debian/Alpine to Red Hat UBI 9, use this doc to verify that all critical flows still work. The main failure mode was **backend failing to start** because the mounted data volume (`/data`) was not writable by the app user (UID 1001), causing `SqliteError: attempt to write a readonly database` at startup (`markStaleJobs()`). When the backend does not start, **every** button that calls the API (Start Over, Yes lock selections, operator scan, etc.) will fail because the frontend cannot reach a healthy backend.

## Root cause and fix

- **Cause:** The original (Debian) backend ran as **root** and could write to the mounted `/data` volume. After UBI migration we ran the Node process as UID 1001 via `runuser`; (1) the volume was often root-owned so 1001 could not write, and (2) in the UBI image user 1001 did not exist in `/etc/passwd` and `runuser -u 1001` failed. That led to SQLite readonly and/or container startup failure → backend not running or not persisting state.
- **Fix:** Backend runs **non-root** (UID 1001): the image creates a system user `appuser` (UID 1001). The **entrypoint** (`backend/scripts/entrypoint.sh`) runs as root only long enough to `chown -R 1001:0` on `DATA_DIR` (default `/data`), then uses `runuser -u appuser` to start the Node process. The image installs `util-linux` so `runuser` is available. The app process never runs as root; root is used only to fix volume permissions at startup.

## Quick sanity checks (run after `podman compose up` / `docker compose up`)

1. **Backend is up and DB is usable**
   ```bash
   curl -s http://localhost:4000/api/health   # → {"ok":true}
   curl -s http://localhost:4000/api/ready    # → {"ready":true}
   ```
   If `/api/ready` returns 503, the DB is not readable (backend may have started but something is wrong with state).

2. **Frontend can reach backend**
   - Open http://localhost:5173. The app should load; if the initial state never loads, check browser devtools Network tab for failed requests to `http://localhost:4000/api/state`.
   - Ensure `VITE_API_BASE` for the frontend build points to where the browser can reach the backend (e.g. `http://localhost:4000` for same-host).

3. **State and Start Over**
   - Load the app; confirm the wizard shows (Blueprint or current step).
   - Use **Tools → Start Over**. It should clear state and return to Blueprint. This calls `POST /api/start-over` and overwrites DB state.
   - If Start Over hangs or shows an error, the backend may be down or returning 5xx (check backend logs and `/api/ready`).

4. **Yes, lock selections**
   - Go to Blueprint, choose platform/arch/release, then try to leave the step (e.g. click Methodology or Proceed). The “Lock foundational selections?” modal appears.
   - Click **Yes, lock selections**. This calls `POST /api/operators/confirm` and writes to the DB. The modal should close and navigation should continue.
   - If the button stays on “Locking…” or nothing happens, the request to `/api/operators/confirm` is failing (network or backend error). Check backend logs and Network tab.

## API flows that must work (for manual or automated checks)

| Flow | Frontend trigger | Backend endpoint(s) | Backend dependency |
|------|------------------|---------------------|--------------------|
| Load state | App init | GET /api/state | DB read |
| Persist state | Any step change (debounced) | POST /api/state | DB write |
| Start Over | Tools → Start Over → Yes, start over | POST /api/start-over | DB write, DATA_DIR/tmp cleanup |
| Lock selections | “Yes, lock selections” in modal | POST /api/operators/confirm | DB write |
| Release confirm | “Yes” in release modal | POST /api/operators/confirm | DB write |
| Blueprint confirm | “Yes” in blueprint modal | (local state only) | — |
| Cincinnati channels | Blueprint step load | GET /api/cincinnati/channels | Cache/network: GitHub `api.github.com` + `raw.githubusercontent.com` (or `MOCK_MODE`) |
| Cincinnati update | Update button | POST /api/cincinnati/update | Same as channels |
| Patches | Version picker | GET /api/cincinnati/patches, POST /api/cincinnati/patches/update | Same as channels |
| Operator credentials | Operators step | GET /api/operators/credentials | REGISTRY_AUTH_FILE (optional) |
| Operator scan | Operators → Scan / discovery | POST /api/operators/scan | DB (jobs), oc-mirror binary, `REGISTRY_AUTH_FILE`; egress to catalog registries (e.g. `registry.redhat.io`) via proxy env inherited by `oc-mirror` |
| Operator prefetch | Operators prefetch | POST /api/operators/prefetch | oc-mirror, auth |
| Operator status | Operators step | GET /api/operators/status | DB (operator_results) |
| Jobs list / stream | Operations step | GET /api/jobs, GET /api/jobs/:id/stream | DB, EventSource |
| Job stop / delete | Operations step | POST /api/jobs/:id/stop, DELETE /api/jobs | DB write |
| Export run | Review / Tools | GET /api/run/export | DB read |
| Import run | Tools | POST /api/run/import | DB write |
| Generate YAML | Review / Assets | GET/POST /api/generate | DB read |
| Bundle ZIP | Download bundle | GET/POST /api/bundle.zip | DB read, DATA_DIR, oc/installer paths |
| Build info / update info | Tools → About | GET /api/build-info, GET /api/update-info | Env vars; optional `fetch` to `api.github.com` (disable with `CHECK_UPDATES=false`) |
| SSH keypair | Identity step | POST /api/ssh/keypair | Spawn `ssh-keygen` (openssh in image) |
| AWS regions/AMI | AWS platform steps | GET /api/aws/regions, GET /api/aws/ami | `curl` to `mirror.openshift.com` (openshift-install tarball), then local `openshift-install coreos print-stream-json` |
| Docs update | Update Docs Links | POST /api/docs/update | DB/cache, `fetch` to `docs.redhat.com` |
| Run oc-mirror job | Run oc-mirror tab | POST /api/oc-mirror/run, job stream | `oc-mirror` subprocess; inherits `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` from backend env (not `REGISTRY_AUTH_FILE`); image pulls per `imageset-config.yaml` |
| Runtime info | Review step | GET /api/runtime-info | oc-mirror binary, arch |
| Path check | (internal) | POST /api/system/path-check | DATA_DIR writable, `df` |
| Schema stepMap | App init | GET /api/schema/stepMap | Static |

## Backend dependencies in UBI image

- **Corporate proxy:** At **runtime**, Cincinnati, docs refresh, update checks, and optional `oc-mirror` tarball resolution use Node **`fetch`** (honors `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` via undici `EnvHttpProxyAgent` unless `AIRGAP_FETCH_USE_ENV_PROXY=false`). **`curl`**, **`oc-mirror`**, and **`oc`** inherit the same container environment. At **image build** time, [`backend/Containerfile`](../backend/Containerfile) uses **`curl`** to `mirror.openshift.com` and **`npm install`**; those use the **build host’s** proxy settings, not the running pod’s env. **Feedback (github mode):** no server-side GitHub API for submit; the browser must reach `github.com` for the issue link. See README [Corporate HTTP proxy and backend egress](../README.md#corporate-proxy-backend-egress).

- **SQLite (better-sqlite3):** DB file under `DATA_DIR` (default `/data`). Backend runs as UID 1001; the entrypoint chowns that directory to 1001:0 at startup so the process can write.
- **oc / oc-mirror:** Installed at build time into `/usr/local/bin` from OpenShift mirror. Used for operator scan, prefetch, runtime info, and bundle export. If the binary is missing or wrong arch, operator scan and related flows fail; other flows (state, Start Over, lock, generate YAML, export/import run) do not need oc-mirror.
- **ssh-keygen:** From `openssh-clients` package in the image. Required for SSH keypair generation in Identity step.
- **DATA_DIR:** Must be writable for DB, temp files, and oc-mirror output. The entrypoint chowns it to 1001:0 at container start so the non-root Node process can write.

## Suggested verification order

1. Backend health and readiness: `curl` `/api/health` and `/api/ready`.
2. Frontend load and initial state: open UI, confirm no console/network errors, state loads.
3. Start Over and Lock: use Start Over once, then go through Blueprint and lock selections; confirm modals and navigation work.
4. One full path: complete a minimal scenario (e.g. Bare Metal Agent, lock, fill required fields, generate, export run) to confirm state → generate → export.
5. Operators (if needed): configure registry auth, run operator scan; confirm job appears and completes or fails with a clear error (not “backend unreachable”).
6. Tools: Export/Import run, Update Docs Links, Build info in About.

## Tests (unit/integration)

- **Backend:** `cd backend && npm test` — exercises API handlers and DB (with test DATA_DIR). Does not require oc-mirror or real network.
- **Frontend:** `cd frontend && npm run test` — exercises UI and store with mocked API. Does not require a running backend.

End-to-end tests that hit a real backend (e.g. in container) are not in this repo; use the manual checklist above or add E2E in CI against a built backend image.
