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

**A Run JSON is not a full backup.** It carries your wizard configuration only.
It does **not** include job history, downloaded binaries, generated artifacts, or
anything else in the backend data volume (`backend-data:/data`). `podman compose
down` keeps that volume; `podman compose down -v` **destroys** it. To back up the
database and data volume separately — which you should do before a significant
update — follow [docs/BACKUP_RESTORE.md](BACKUP_RESTORE.md).

> Cross-version import is **not** guaranteed. Importing a run exported by one
> version into a different version has not been verified by automated
> source-version → target-version tests, so treat the exported JSON as a
> convenience, not a migration guarantee, and keep it until the updated
> instance is working. Imports from v1.x and v2.x into the current schema are
> migrated and are covered by tests.

## Where the build SHA comes from

The build SHA is optional provenance. It is passed **in from the host at build
time** and is not read from `.git`, because `.dockerignore` excludes `.git/` from
the build context. `backend/Containerfile` declares `ARG APP_GIT_SHA=unknown` and
`docker-compose.yml` defaults it to `${APP_GIT_SHA:-unknown}`.

- **With it:** Tools → About also shows the revision.
  ```bash
  APP_GIT_SHA=$(git rev-parse HEAD) podman compose up --build -d
  ```
- **Without it** (plain `podman compose up --build -d` / `docker compose up --build -d`):
  the revision is simply omitted from Tools → About. The version and build time
  are still shown, and **update checks work normally** — they compare the
  installed version with published GitHub Releases and never use the SHA.

## Podman Compose (recommended)

**Primary workflow when you have a local git repo:**

1. From the repo root:
   ```bash
   git pull
   podman compose up --build -d
   ```
   Optionally prefix `APP_GIT_SHA=$(git rev-parse HEAD)` to also record the
   revision; update checks do not need it.

2. Refresh the app in your browser. Once the installed version matches the newest
   published release, Tools → About reports "Up to date" and the update banner
   disappears.

**There are no pre-built images to pull.** This release is distributed as source;
`docker-compose.yml` names `localhost/openshift-airgap-architect-{backend,frontend}`,
which are the images your own `--build` produces. `compose pull` has nothing to
fetch and will fail. Building from source is the supported path.

To fully restart the stack:

```bash
podman compose down      # keeps the backend-data volume
podman compose up -d
```

## Docker Compose

Same steps as Podman Compose, using `docker compose`:

```bash
git pull
docker compose up --build -d
```

As with Podman, prefixing `APP_GIT_SHA=$(git rev-parse HEAD)` is optional and only
records the revision in Tools → About; update checks do not need it.

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

- **Build info** (Tools → About) shows the application version (always, from
  `package.json`), the revision (only when `APP_GIT_SHA` was supplied) and the
  build time. `APP_BRANCH` is configuration, not build provenance, and is not
  shown.
- **Update checks** ask the GitHub Releases API for `APP_REPO` and compare the
  newest published, stable release with the installed version. No Git SHA is
  required. To disable, set `CHECK_UPDATES=false` (or `0`) in the backend
  environment; no request is then made.

### What counts as an available update

A release is offered only when **all** of these hold:

- it is listed by `GET https://api.github.com/repos/<APP_REPO>/releases`, and its
  API and HTML URLs name that same repository (a response naming any other
  repository fails the whole check closed);
- it is published (not a draft) and not a prerelease;
- its tag is a stable `MAJOR.MINOR.PATCH` (optional leading `v`) with a valid
  publication date;
- its version is **strictly newer** than the installed version. A different
  commit, a bare tag, the same version or an older release is never an update.

**Trust boundary.** This verifies GitHub's published-release API state for the
configured repository over HTTPS. It does **not** verify any signature or
checksum of release artifacts.

### What the update states mean

| State | Meaning |
|---|---|
| `up-to-date` | No eligible published release is newer than the installed version. |
| `published-supported-update` | A newer eligible published release exists. **The only state that raises the update banner.** |
| `offline` | The lookup gave no trustworthy answer (timeout, network error, GitHub error, rate limit, malformed or foreign-repository metadata). No update is implied either way. |
| `unknown` | The installed version is missing or not a stable `X.Y.Z`, so no comparison is possible. |
| `disabled` | `CHECK_UPDATES` is off. |
