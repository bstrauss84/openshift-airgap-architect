# Updating OpenShift Airgap Architect

This document describes how to update the app when a newer version is available (e.g. when the Landing page or Tools → About shows "Update available").

## Before you update: save your work

Updating replaces the running application. Save your configuration first:

1. **Tools → Export Run** and keep the downloaded **JSON** file.
2. Update using one of the procedures below.
3. **Tools → Import Run** and select that JSON file.
4. **Re-enter your credentials.**

**Credentials are deliberately not carried across.** As of v2.1 an imported run
is stripped of credential material before it is stored — Red Hat and mirror
pull secrets, SSH private keys, platform and BMC passwords, and any username
and password embedded in a proxy URL. Everything else, including proxy
endpoints and the rest of your configuration, is preserved. Earlier versions
persisted some of those credentials on import; that was a disclosure defect,
not a feature.

**A JSON Run is not the same thing as a generated bundle ZIP.** Only the JSON
file from Tools → Export Run can be imported back into the application. The
generated artifact ZIP from the Assets & Guide step contains install-config
and Field Guide output for your cluster — it is not a restorable run, and the
endpoint that used to validate uploaded ZIPs was withdrawn in v2.1.

> Cross-version import is **not** guaranteed. Importing a run exported by one
> version into a different version has not been verified by automated
> source-version → target-version tests, so treat the exported JSON as a
> convenience, not a migration guarantee, and keep it until the updated
> instance is working. Imports from v1.x and v2.x into the current schema are
> migrated and are covered by tests.

## Git clone vs tarball builds

- **Built from a git clone** (with a `.git` directory): The backend image can determine the current commit and build time during `podman compose up --build`. Tools → About shows real build metadata, and the app can tell you if an update is available. This is the normal case.
- **Built from a tarball or snapshot without `.git`**: The image cannot determine build SHA or time, so Tools → About shows “Build unknown • unknown • main” and update availability cannot be determined (you may see “Update check unavailable”). This is expected behavior, not a bug. To get build info and update checks, build from a git clone instead.

## Podman Compose (recommended)

**Primary workflow when you have a local git repo:**

1. From the repo root:
   ```bash
   git pull
   podman compose up --build -d
   ```

2. Refresh the app in your browser. The "Update available" banner should disappear once the running build matches the latest commit.

**If you rely on pre-built images instead of building from source:**

```bash
podman compose pull
podman compose up --build -d
```

To fully restart the stack:

```bash
podman compose down
podman compose up -d
```

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

- **Build info** (Tools → About) shows the Git SHA, build time, repo, and branch the running instance was built from. When the image is built from a **git clone** (with `.git`), the Containerfile computes these during build. When built from a **tarball without `.git`**, they show as “unknown” and update checks cannot run; that is expected. See the main README for env wiring for `docker run` or OpenShift.
- **Update checks** compare the running build’s SHA to the latest commit on the configured branch (default: `main`). They only work when the build has a known SHA (i.e. built from a clone). To disable, set `CHECK_UPDATES=false` (or `0`) in the backend environment.
