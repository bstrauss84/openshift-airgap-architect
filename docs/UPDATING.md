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

The build SHA is passed **in from the host at build time**. It is not read from
`.git`, because `.dockerignore` excludes `.git/` from the build context, so the
image never sees it. `backend/Containerfile` declares `ARG APP_GIT_SHA=unknown`
and `docker-compose.yml` defaults it to `${APP_GIT_SHA:-unknown}`.

- **With the build-arg or environment variable set:** Tools → About shows the real
  SHA and build time, and update checks can run.
  ```bash
  APP_GIT_SHA=$(git rev-parse HEAD) podman compose up --build -d
  # or: podman compose build --build-arg APP_GIT_SHA=$(git rev-parse HEAD)
  ```
  `scripts/set-build-env.sh` sets this for you.
- **Without it:** the SHA is `unknown`, Tools → About shows “Build unknown”, and
  update checks cannot run at all. This is expected behaviour, not a bug —
  **and it applies even when you built from a git clone.** Having a `.git`
  directory is not sufficient; the value must be passed explicitly.

## Podman Compose (recommended)

**Primary workflow when you have a local git repo:**

1. From the repo root:
   ```bash
   git pull
   APP_GIT_SHA=$(git rev-parse HEAD) podman compose up --build -d
   ```
   Without `APP_GIT_SHA`, the rebuilt image reports its SHA as `unknown` and
   update checks stop working — see "Where the build SHA comes from" above.

2. Refresh the app in your browser. Once the running build matches the configured
   branch, Tools → About reports "Up to date" and the development-build note
   disappears.

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

- **Build info** (Tools → About) shows the Git SHA, build time, repo, and branch the running instance was built from. The build time is computed in-image; the **SHA must be passed in** (see "Where the build SHA comes from"). Without it both update checks and the SHA display fall back to `unknown`. See the main README for env wiring for `docker run` or OpenShift.
- **Update checks** ask GitHub for the newest commit on the configured branch (default: `main`) and compare it to the running build's SHA. To disable, set `CHECK_UPDATES=false` (or `0`) in the backend environment.

### What the update states mean

A differing commit on a branch is **not** evidence that a newer supported release
was published, so the app reports what it actually knows:

| State | Meaning |
|---|---|
| `up-to-date` | The running build matches the configured branch head. |
| `development-branch-ahead` | The branch carries a different commit. Normal for a development build. It does **not** mean a release is available, and depending on which branch is configured the branch may even be **older** than what you are running. |
| `offline` | The lookup failed (timeout, network error, GitHub error). No update is implied. |
| `unknown` | The running build has no identifiable SHA, so no comparison is possible. |
| `disabled` | `CHECK_UPDATES` is off. |
| `published-supported-update` | A newer published, supported release was confirmed by a trusted release-identity source. **This is the only state that raises the urgent upgrade banner.** |

> `published-supported-update` is currently **unreachable**. The app has no trusted
> release-identity source yet, so the backend always reports
> `releaseIdentity: null`. The urgent banner is therefore fail-closed by design
> and will not appear until that contract is implemented and reviewed.
