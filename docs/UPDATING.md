# Updating OpenShift Airgap Architect

This document describes how to update the app when a newer version is available (e.g. when the Landing page or Tools → About shows "Update available").

## Podman Compose (recommended)

1. Pull the latest images and rebuild:
   ```bash
   podman compose pull
   podman compose up --build -d
   ```
   Or, if you build locally from source:
   ```bash
   git pull
   podman compose up --build -d
   ```

2. Restart the stack if you use a long-running compose project:
   ```bash
   podman compose down
   podman compose up -d
   ```

3. Refresh the app in your browser. The "Update available" banner should disappear once the running build matches the latest commit.

## Docker Compose

Same steps as Podman Compose, using `docker compose`:

```bash
docker compose pull
docker compose up --build -d
```

## OpenShift / Kubernetes

Redeploy using your usual process (e.g. update the image tag or trigger a new build from source). Ensure the backend has access to GitHub (or set `CHECK_UPDATES=false`) if you want to avoid update checks in restricted environments.

## Local development (npm)

From the repo root:

```bash
git pull
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

## Build info and update checks

- **Build info** (Tools → About) shows the Git SHA, build time, repo, and branch the running instance was built from. These come from env vars (`APP_GIT_SHA`, `APP_BUILD_TIME`, `APP_REPO`, `APP_BRANCH`). See the main README for wiring these in Compose or OpenShift.
- **Update checks** compare that SHA to the latest commit on the configured branch (default: `main`). To disable, set `CHECK_UPDATES=false` (or `0`) in the backend environment.
