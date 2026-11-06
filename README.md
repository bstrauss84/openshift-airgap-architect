# OpenShift Airgap Architect

A local-first wizard that generates OpenShift disconnected (air-gapped) installation assets and, from v2.2.0, plans and runs oc-mirror content mirroring. It runs entirely on your machine using Docker or Podman—no data is sent to external services except when you explicitly trigger operator discovery, release-channel updates or an oc-mirror run.

<!--
  TEMPORARY RELEASE NOTICE — maintainer note.

  This block announces the v2.x transition and is deliberately short-lived. Remove it
  once the v2 transition is no longer news, at a normal release of the maintainer's
  choosing. No removal version or date is fixed here on purpose.

  The "Release history" section further down is PERMANENT and must stay when this
  block is removed.

  The v2.2.0 subsection was switched to its released wording at publication.
-->

## 🚀 Major v2.x update available

**I'm sorry this major update has taken longer than expected, and thank you for your
patience.** This is the largest change since the project started.

OpenShift Airgap Architect is maintained by one person in spare time, and much of the
past several months has gone into rebuilding, validating and testing version-aware
configuration support: the app is now built around the OpenShift version you select,
rather than assuming a single release. The parameter catalogs, validation,
documentation links and Field Guide all follow your chosen version. I appreciate
everyone who has continued following and using the project.

### Released: v2.0 and v2.1 — version awareness and OpenShift 4.22

**v2.0 supports OpenShift 4.20 and 4.21; v2.1 adds 4.22.** The supported set is
4.20, 4.21 and 4.22, and later releases are rejected rather than approximated. The
v2.1.1 and v2.1.2 patches added update notifications, build identity and export
credential fixes. See [Release history](#release-history) for what is published and
where to download it.

### New in v2.2.0 — Mirroring

> **Fixed in v2.2.1 (released 2026-11-06): Mirroring runs failed in the v2.2.0 backend container.** The v2.2.0 image
> installs `oc-mirror` so that the non-root backend user can execute it but not read it, so every Mirroring run stops
> with `EACCES: permission denied, open '/usr/local/bin/oc-mirror'`. **Use v2.2.1 and rebuild your images**
> (`podman compose up --build -d`). Install and operator scans were not affected. Details: the
> [v2.2.1 release notes](docs/releases/v2.2.1.md) and the
> [v2.2.0 known issue](docs/releases/v2.2.0.md#post-publication-known-issue-2026-11-06).

v2.2.0 is a minor feature release, not another patch: it adds a second workflow beside
Install. **Mirroring** plans and runs oc-mirror v2 without an install:

- **Independent profiles** — each with its own content, its own locked OpenShift
  release (4.20–4.22), its own storage location and its own history, separate from Install.
- **Content** — the platform release, operators (catalog discovery, the same Scenario
  Quick Picks as Install, and a live check that each package and channel exists) and
  additional images; existing ImageSetConfiguration files can be imported.
- **ImageSetConfiguration** — a labelled DRAFT while the profile is incomplete, then the
  validated file, checked against the oc-mirror v2 schema.
- **Three workflows** — mirror to disk, disk to mirror and mirror to mirror, each behind
  a preflight check.
- **Connected → disconnected transfer** — Prepare transfer adds checksums, the exact
  configuration and its provenance; Receive transfer verifies every file, refuses
  transfers that arrive out of order, and compares the disconnected side's oc-mirror with
  the build that made the archives (advisory, never blocking).
- **Credentials** — the Red Hat pull secret stays in page memory for one profile and
  destination credentials are given per run; neither is ever stored. Anonymous access
  for destination registries that need no login.
- **Operations** — every run, transfer and check with its log and result, and "Run the
  same again" for runs that stopped for a temporary reason.

**Status:** released in v2.2.0 (2026-11-05); see [Release history](#release-history) for
downloads. The three workflows pass lab tests with the real oc-mirror 4.22.19 against
synthetic registries; validation at customer sites (RHEL 9, Podman 4.9, FIPS, a real
disconnected registry with OpenShift release content) is still pending. Supported
OpenShift versions remain 4.20, 4.21 and 4.22. See [Mirroring workflow](#mirroring-workflow),
the full [Mirroring user guide](docs/MIRRORING_WORKFLOW.md#part-a--user-guide) and the
[v2.2.0 release notes](docs/releases/v2.2.0.md).

### Upgrading

**If you are upgrading, please read the release notes and the migration guide before
you start.** There are changes to how saved configurations work and a required
version-confirmation step, and a few things behave differently on purpose.

**Before upgrading, save your configuration with Tools → Export Run**, and restore it
afterwards with Tools → Import Run. Credentials are deliberately excluded and must be
re-entered. Mirroring profiles are kept on the server, not in an exported run.

- [Changelog](CHANGELOG.md) — everything, newest first
- [v2.2.1 release notes](docs/releases/v2.2.1.md) — patch: fixes Mirroring in the backend container (v2.2.0 known issue)
- [v2.2.0 release notes](docs/releases/v2.2.0.md) — minor: the Mirroring workflow
- [v2.1.2 release notes](docs/releases/v2.1.2.md) — patch: export credential fixes and maintenance
- [v2.1.1 release notes](docs/releases/v2.1.1.md) — patch: update notifications and build identity
- [v2.1 release notes](docs/releases/v2.1.0.md) — OpenShift 4.22 support
- [v2.0 release notes](docs/releases/v2.0.0.md) — the version-awareness rebuild
- [Migration guide: v1.x → v2.0](docs/MIGRATION_GUIDE_v1_to_v2.md) — **read this if you are coming from v1.x**


## Table of contents

- **Overview**
  - [What it is](#what-it-is)
  - [Who it's for](#who-its-for)
  - [Key features](#key-features)
- **Getting Started**
  - [Quick start (container)](#quick-start-container)
  - [Enterprise deployment (RHEL 9, FIPS, proxy, Podman 4.9)](#enterprise-deployment)
  - [Mirroring storage on its own volume](#mirroring-storage-volume)
  - [Local development](#local-development)
  - [Running without Compose](#running-without-compose)
  - [Container run](#container-run)
  - [Corporate HTTP proxy and backend egress](#corporate-proxy-backend-egress)
  - [Updating the app](#updating-the-app)
- **Core Workflows**
  - [Mirroring workflow](#mirroring-workflow)
  - [Generating assets](#generating-assets)
  - [Operator workflows](#operator-workflows)
  - [Run oc-mirror](#run-oc-mirror)
  - [Operations](#operations)
  - [Mock mode (offline demo)](#mock-mode-offline-demo)
  - [End-to-End (E2E) testing](#e2e-testing)
  - [Load testing](#load-testing)
- **Platform, Security, and Operations**
  - [Platform and architecture (multi-arch / Apple Silicon)](#platform-and-architecture-multi-arch--apple-silicon)
  - [Mounted Red Hat pull secret](#mounted-red-hat-pull-secret)
  - [Build info and update checks](#build-info-and-update-checks)
  - [Troubleshooting](#troubleshooting)
- **Reference**
  - [Screenshots](#screenshots)
  - [Architecture](#architecture)
  - [Install-config references (4.20/4.21/4.22)](#install-config-references-420421422)
  - [Release history](#release-history)
  - [License and contributing](#license-and-contributing)
  - [Documentation and governance map](#documentation-and-governance-map)

<a id="what-it-is"></a>
## What it is

OpenShift Airgap Architect guides you through scenario-based configuration (Bare Metal Agent-Based, Bare Metal IPI/UPI, VMware vSphere IPI/UPI, AWS GovCloud IPI/UPI, Azure Government IPI, Nutanix IPI, IBM Cloud IPI) and produces:

- **install-config.yaml** — Installer input for your chosen platform
- **agent-config.yaml** — For Bare Metal + Agent-Based Installer only
- **imageset-config.yaml** — oc-mirror v2 format for mirroring release and operator content
- **FIELD_MANUAL.md** — A compartmentalized, scenario-specific field guide with numbered, actionable sections drawn from official OCP documentation for the selected version (4.20, 4.21 or 4.22), tailored to your exact configuration (platform, connectivity, FIPS, proxy, NTP, mirroring, operators, and specific values like cluster name, VIPs, and registry FQDN). Each section cites official Red Hat doc sources with version-correct URLs.
- **NTP MachineConfigs** — When NTP servers are set (e.g. `99-chrony-ntp-master.yaml`, `99-chrony-ntp-worker.yaml`)

The app uses official OpenShift 4.20–4.22 parameter catalogs and aligns generated YAML with the docs for the selected version.

A separate **Mirroring** workflow plans and runs oc-mirror v2 content (platform release, operators, additional images) without an install, including the transfer to and receipt on a disconnected side; see [Mirroring workflow](#mirroring-workflow).

<a id="who-its-for"></a>
## Who it's for

- Platform engineers and SREs planning disconnected or restricted-network OpenShift installs
- Anyone who wants a single place to configure cluster identity, networking, mirroring, trust bundles, and platform-specific settings before running the installer or oc-mirror
- Teams that need repeatable, documented config generation without storing credentials in the app

<a id="key-features"></a>
## Key features

- **Scenario-driven UI** — Pick install method (e.g. Agent-Based, vSphere IPI); the wizard shows only relevant steps and fields
- **Version-aware** — Cincinnati channels and patch selection; generated assets match the chosen OCP version (4.20, 4.21 or 4.22). Version-specific parameter catalogs, Field Guide content with version-correct documentation URLs, and metadata-driven annotations for fields introduced or deprecated across versions
- **Credentials-safe** — Pull secrets and BMC/vCenter-style credentials are not persisted by default; optional export with explicit inclusion. Helpers generate pull secrets and SSH keypairs locally and are not stored (see [Identity & Access](#screenshots) and [Mirror secret helper](#screenshots)).
- **Operator discovery** — Optional scan of certified/community/Red Hat operators: Architect downloads each catalog over TLS it verifies itself and lists it with `oc-mirror list operators` (requires registry.redhat.io auth)
- **Trust and proxy** — additionalTrustBundle and proxy settings with version-appropriate policy (e.g. Proxyonly / Always)
- **Mirroring workflow** — Independent oc-mirror profiles (platform, operators, additional images) with a per-profile release lock, catalog discovery and live catalog checks, DRAFT and validated ImageSetConfiguration preview, mirror to disk, checksummed transfer, verified receipt and disk to mirror, or mirror to mirror; see [Mirroring workflow](#mirroring-workflow)
- **Run oc-mirror** — Built-in tab to run oc-mirror v2 directly from the app (mirror-to-disk, disk-to-mirror, mirror-to-mirror workflows; per-run credentials; comprehensive preflight validation with blockers; live job streaming to Operations)
- **Operations** — Background job viewer with live streaming output, job history, and downloadable timestamped logs for Cincinnati refresh, operator scans, and oc-mirror runs
- **Modal accessibility** — Consistent focus trap behavior across all dialogs with keyboard navigation (Tab/Shift+Tab cycling, Escape key support, focus restoration)
- **Feedback (GitHub-oriented)** — Optional in-app feedback drawer that generates a prefilled GitHub issue URL plus copyable markdown fallback. Hidden/disabled on high-side profiles.
- **Dark mode** — Toggle between light and dark themes in the Tools drawer; all UI elements honor the selected theme
- **Live YAML Preview** — Right-side resizable drawer shows real-time generated YAML as you configure. Displays install-config.yaml (or split view with agent-config.yaml for agent-based scenarios). ImageSet config visible on Operators tab. Credentials obfuscated by default with "Show sensitive values" toggle. Download individual files. Syntax highlighting for readability. Available on all configuration tabs after Blueprint lock-in.
- **IPv6-only single-stack support** — Configure OpenShift clusters with IPv6 networking only (no IPv4). IP stack mode selector supports IPv4-only, IPv6-only, and dual-stack (IPv4+IPv6) modes. Available for bare metal and vSphere platforms (all installation methods). Automatic state migration from v1.2.x exports.
- **Export options** — Choose whether to include credentials, certificates, client tools, and openshift-install in the run bundle. Advanced option to bundle a complete high-side runtime package (container images + deployment scripts) for deploying the application on fully disconnected systems.

<a id="quick-start-container"></a>
## Quick start (container)

**Prerequisites:** a container engine **and a Compose provider**. Installing Podman or
Docker alone is not enough — `podman compose` delegates to a separate provider, and
without one it fails with `looking up compose provider failed` and a list of paths it
searched.

| Host | Install |
|---|---|
| Fedora | `sudo dnf install podman podman-compose` |
| RHEL / CentOS Stream 9+ | `sudo dnf install podman podman-compose` |
| Ubuntu / Debian | `sudo apt install podman podman-compose` (or Docker Engine with the `docker-compose-plugin` package) |
| Docker, any distro | Docker Engine with the Compose plugin — `docker compose version` must work |

Check before you start:

```bash
podman compose version   # or: docker compose version
```

Roughly 20 GB of free disk is needed for the images plus mirrored content.

**Docker:**

```bash
docker compose up --build -d
```

**Podman:** Use **`podman compose`** (Compose V2), the same `docker-compose.yml` (one file for both Docker and Podman); so build and run use the same daemon and you avoid "image not known" after build:

```bash
podman compose up --build -d
```

> **Optional revision provenance.** `.git` is excluded from the build context, so the image
> cannot discover its own commit. Prefixing `APP_GIT_SHA="$(git rev-parse HEAD)"` adds the
> exact revision to **Tools → About**; without it the revision is simply omitted. Update
> checks do **not** need it — they compare the installed version with published GitHub
> Releases.

If your system only has `podman-compose` (Python), use that; the project does not ship a separate `podman-compose.yml`.

> **Enterprise hosts (RHEL 9 with Podman 4.9 / podman-compose 1.0.6, FIPS, an HTTPS-inspecting proxy,
> restrictive umask):** use the staged procedure instead of `compose up --build` —
> `scripts/deploy/oaa-deploy.sh preflight`, then `build`, `up` (runtime smoke test, then backend, then frontend), `verify` (or `all`). podman-compose 1.0.6
> ignores a failed image build and then tries to run images that were never built; the script checks every
> build, retries dropped CDN transfers a bounded number of times, passes your proxy CA to the build as a
> secret, and verifies the result over HTTP. See [docs/ENTERPRISE_PODMAN_DEPLOYMENT.md](docs/ENTERPRISE_PODMAN_DEPLOYMENT.md).

Then open the UI at **http://localhost:5173** (ports are bound to localhost by default; see [Container run](#container-run) to change that).

<a id="enterprise-deployment"></a>
### Enterprise deployment (RHEL 9, FIPS, proxy, Podman 4.9)

Full guide: **[docs/ENTERPRISE_PODMAN_DEPLOYMENT.md](docs/ENTERPRISE_PODMAN_DEPLOYMENT.md)**. Run these checks as the user
who will own the containers, in a real login (ssh or console — not `su` or `sudo -i`). Each line says what you should
see; if you see something else, **STOP** and fix that first.

| Check | Command | Expected | STOP if |
|---|---|---|---|
| Rootless session | `loginctl show-user "$(id -un)" -p State -p Linger; echo "$XDG_RUNTIME_DIR"` | `State=active` (or `Linger=yes`), `/run/user/<uid>` | empty `XDG_RUNTIME_DIR`, or no session — log in directly as that user |
| User systemd and D-Bus | `systemctl --user is-system-running` | `running` or `degraded` | `Failed to connect to bus` (session or lingering missing; an administrator enables lingering) |
| cgroup manager | `podman info --format '{{.Host.CgroupManager}}'` | `systemd` | `systemd` with no user session — see guide §5 before using the temporary `cgroupfs` override |
| Versions | `podman --version; podman-compose --version` | Podman 4.9+ / podman-compose 1.0.6+ | podman-compose 1.0.6 continues after a failed build — use the staged script below, never `compose up --build` |
| FIPS / crypto policy | `fips-mode-setup --check; update-crypto-policies --show` | as your organisation requires | never disable FIPS; a corporate CA FIPS rejects must be replaced |
| Corporate CA | `curl -sSI https://cdn-ubi.redhat.com/ -o /dev/null && echo ok` | `ok` | `SSL certificate problem` — pass your proxy CA to the build: `OAA_BUILD_CA=/path/ca.pem` |
| Proxy and Quay CDN | `env \| grep -i _proxy; curl -sSI https://quay.io/v2/ -o /dev/null -w '%{http_code}\n'` | `401` (reachable) | timeouts — allow `quay.io`, `cdn*.quay.io`, `registry.access.redhat.com`, `cdn-ubi.redhat.com` (guide §4) |
| umask and readability | `umask` | `0022` (or `0077` — handled; see guide §6) | — |
| SELinux and volumes | `getenforce` | `Enforcing` (keep it) | bind mounts without `:Z`/`:z` fail with `permission denied` |
| Free space | `df -h ~/.local/share/containers` | ≥ 20 GB, plus room for mirrored content | low space — put Mirroring content on its own volume (below) |

Then run the staged procedure — preflight, build, start (smoke test, backend, frontend), verify:

```bash
scripts/deploy/oaa-deploy.sh preflight     # read-only; prints BLOCK lines with the fix
scripts/deploy/oaa-deploy.sh build         # each image built and checked separately
scripts/deploy/oaa-deploy.sh up            # refuses images it did not build; stops at the first failed stage
scripts/deploy/oaa-deploy.sh verify        # HTTP checks of 127.0.0.1:4000 and :5173
```

Build-time needs the network (Red Hat CDN, npm, nodejs.org, GitHub, mirror.openshift.com, through your proxy);
the running backend needs only what you mirror from. A failed or half-created start is replaced with
`scripts/deploy/oaa-deploy.sh up --recreate` — it removes only this project's containers and keeps the data
volume. For a support case, collect the diagnostics in guide §5.5 (proxy credentials are redacted).
Never use `podman system reset`, `system migrate` or global `prune` to "fix" a deployment.

<a id="mirroring-storage-volume"></a>
### Mirroring storage on its own volume

Mirroring archives, oc-mirror's workspace and cache can reach hundreds of GB. Like the Install workflow's Run oc-mirror
step, each Mirroring profile can use any directory the server can write. To use a separate disk with containers, mount it
into the backend and type the path **inside the container** in the profile's **Storage and run options** card:

```yaml
# compose.override.yml (or docker-compose.yml), backend service
services:
  backend:
    volumes:
      - /data/mirror:/mnt/mirror-data:Z      # host path : container path : SELinux label
    # optional: make it the default for new profiles
    # environment:
    #   - OAA_MIRROR_STORAGE_ROOT=/mnt/mirror-data
```

Then choose `/mnt/mirror-data` (not `/data/mirror`, which exists only on the host). The directory must be writable by
the container user (rootless Podman: `podman unshare chown 1001:0 /data/mirror`, or `:U` on the mount). Under it every
profile gets its own `profiles/<id>/` with `archives/sets/<plan>/`, `plans/<plan>/`, `received/<plan>/`, `workspace/`
and `cache/`. A profile's location can be changed until it writes anything; after that it stays put, so its history
and cache are never split — nothing is moved. Running the backend directly on a host: type an absolute host path.
Details: guide §9.

### Rebuild and restart (preserving data)

Build the new images **first**, and replace the running containers only once both builds succeeded:

**Podman** (recommended; required on RHEL 9 / podman-compose 1.0.6)
```bash
scripts/deploy/oaa-deploy.sh build && scripts/deploy/oaa-deploy.sh up --recreate && scripts/deploy/oaa-deploy.sh verify
```

**Docker**
```bash
docker compose build && docker compose up -d
```

The `backend-data` named volume is preserved unless you explicitly pass `-v` to `compose down`. All app state (wizard configuration, job history) lives in that volume. Old images are kept so you can roll back; remove them yourself when no longer needed (`podman images`, `podman rmi <id>`). Do not use `podman system reset` to "clean up": it deletes every image, container and volume of that user, in every project.

### SELinux (Podman on Fedora/RHEL)

If you mount files or folders with Podman, add `:Z` or `:z` to volume mounts as needed.

<a id="local-development"></a>
## Local development

- **Backend:** `cd backend && npm install && npm run dev` (or start via your IDE). Set `DATA_DIR` if you want state outside `./data` (e.g. `backend/data`).
- **Frontend:** `cd frontend && npm install && npm run dev`. Vite serves the UI; point it at the backend (default `http://localhost:4000` via `VITE_API_BASE`).
- **Tests:** `npm test` in `backend/` and `frontend/`. See `docs/CONTRIBUTING.md` for contribution and test conventions.

The backend uses SQLite for state and job history; the frontend uses React + Vite.

<a id="running-without-compose"></a>
## Running without Compose

If you prefer not to use Docker Compose or Podman Compose, you can run the frontend and backend yourself on the host.

**Supported runtime: Node.js 22.** Both container images use UBI 9 Node.js 22, and host-native development targets the same major version. Node.js 20 is retired on RHEL 9 and is not a supported target.

1. **Backend** (Node 22):
   ```bash
   cd backend && npm install && npm run dev
   ```
   The API listens on `http://localhost:4000` by default. Set `DATA_DIR` if you want state in a specific directory (e.g. `./data`).

   **Host build prerequisites:** `better-sqlite3` publishes no prebuilt binary for Node 22, so a host-native `npm install` / `npm ci` compiles it from source. Install `make`, `gcc-c++`, and `python3` first (on Fedora/RHEL: `sudo dnf install make gcc-c++ python3`). To avoid host build tooling entirely, use the supported container workflow (`podman compose up --build`) — the UBI 9 Node.js 22 image already ships these tools.

2. **Frontend** (Node 22):
   ```bash
   cd frontend && npm install && npm run dev
   ```
   Set `VITE_API_BASE=http://localhost:4000` if your backend is elsewhere. The UI is served at `http://localhost:5173`.

3. Open **http://localhost:5173** in a browser. The frontend will call the backend at the URL configured by `VITE_API_BASE`.

Operator scan and bundle generation (including oc/oc-mirror binaries) require the same backend environment (Node, oc-mirror resolution, `DATA_DIR`) as when run via Compose; only the process manager differs.

<a id="container-run"></a>
## Container run

The stack is two services (frontend, backend). Ports in `docker-compose.yml` are bound to **127.0.0.1** by default so the app is not exposed on the LAN. To allow access from other machines, change the left side of the port mapping to `0.0.0.0` (e.g. `"0.0.0.0:5173:5173"`).

- **Frontend:** 5173 (nginx serving the built static assets; binds `0.0.0.0` **inside the container**, which is what makes the published port work)
- **Backend:** 4000 (Express API; binds `0.0.0.0` inside the container because `docker-compose.yml` sets `BIND_ADDRESS=0.0.0.0` with `OAA_CONTAINER_NETWORK=isolated` — outside a container it binds `127.0.0.1` and refuses anything else while unauthenticated)
- **State:** Backend uses a named volume for SQLite; run bundles and temp files are under that data path.

> **Publishing on `0.0.0.0` publishes an UNAUTHENTICATED API.** The Compose stack runs
> with authentication off — that is the supported local single-user mode — so the
> `127.0.0.1:` prefixes in `docker-compose.yml` are the only thing keeping it off your
> network. The backend cannot detect this for you: a process inside a container cannot
> see how its ports were published. If you need network access, use the authenticated
> OpenShift overlay (`manifests/openshift/`), or put your own authenticating proxy in
> front and set `OAA_AUTH_MODE=proxy` with `OAA_PROXY_SHARED_SECRET` and
> `OAA_ALLOWED_ORIGINS`. See [docs/API.md](docs/API.md) → Authentication.

### Container images and security (UBI, non-root)

Both containers use **Red Hat UBI 9** images and run the application **non-root** where possible:

- **Frontend:** UBI 9 Node.js 22; app runs as UID 1001. No writable volume; no root needed.
- **Backend:** UBI 9 Node.js 22; the **Node process runs as UID 1001** (user `appuser` in the image). The mounted data volume (`/data`) must be writable by that user. The backend image uses an **entrypoint script** that:
  1. Runs initially as root (only to fix volume permissions).
  2. Runs `chown -R 1001:0` on `DATA_DIR` (default `/data`) so the volume is writable by the app user.
  3. Drops to UID 1001 via `runuser` and starts the Node server.

So the backend does **not** run the application as root; root is used only briefly at container start to set ownership on the mounted volume. If the volume is already writable by 1001 (e.g. first run after a clean volume, or a volume you pre-created with the right ownership), the chown is a no-op and the process still drops to 1001. This matches common practice for secure container workloads. The image installs `util-linux` (for `runuser`) and creates a system user `appuser` with UID 1001 so the drop works correctly. See `backend/scripts/entrypoint.sh` and `docs/POST_UBI_VERIFICATION.md` for details and troubleshooting.

### Same-host vs remote access

- **Same-host:** Using the app on the same machine where Compose runs: leave `VITE_API_BASE` as `http://localhost:4000`. The frontend is built with this URL, so the browser (on the same host) can reach the backend at localhost:4000.
- **Remote access:** To use the UI from another machine (e.g. laptop to dev server), (1) expose ports on the host by changing port mappings to `0.0.0.0:5173:5173` and `0.0.0.0:4000:4000`, and (2) set `VITE_API_BASE` to the URL where the backend is reachable from the **client** browser (e.g. `http://<host-ip-or-name>:4000`). The frontend container reads this at startup; if you keep `VITE_API_BASE=http://localhost:4000`, API calls from a remote browser will go to the client's localhost and fail. Override the env when starting the stack (e.g. `VITE_API_BASE=http://192.168.1.10:4000 docker compose up`) or in a compose override file.

<a id="corporate-proxy-backend-egress"></a>
### Corporate HTTP proxy and backend egress

The browser talks only to the **backend API** (see `VITE_API_BASE`). Outbound calls to the internet (GitHub for Cincinnati release data, Red Hat mirrors for tools, registries for `oc-mirror`, and so on) are made **from the backend container** (Node `fetch`, `curl`, or spawned `oc` / `oc-mirror`). They are **not** configured by the wizard’s **Trust / proxy** fields, which apply to the **OpenShift cluster** `install-config` proxy and trust bundle, not to how this application reaches GitHub or `registry.redhat.io`.

**Configure corporate proxy on the backend service:** Set standard variables on the **backend** container (Compose, Kubernetes, or `docker run`), for example:

```yaml
# Example fragment for compose.override.yml — backend only
services:
  backend:
    environment:
      - HTTP_PROXY=http://proxy.corp.example:8080
      - HTTPS_PROXY=http://proxy.corp.example:8080
      - NO_PROXY=localhost,127.0.0.1,.svc.cluster.local
```

Lowercase `http_proxy` / `https_proxy` / `no_proxy` are also honored by common stacks. **`curl`** (used to download `openshift-install` from `mirror.openshift.com`) and **Go-based tools** (`oc-mirror`, `oc`) inherit the same environment when the backend spawns them, so operator scan and Run oc-mirror benefit from these variables once they are set for the backend process.

**Container image build (pre-baked `oc` / `oc-mirror`):** In [`backend/Containerfile`](backend/Containerfile), a **`RUN`** layer uses **`curl`** to download `openshift-client-linux.tar.gz` and **`oc-mirror.tar.gz`** from **`mirror.openshift.com`** and bakes them into the image. That happens during **`docker compose build` / `podman compose build`**, not when the container starts—so **runtime** `HTTP_PROXY` on the backend service does **not** apply to those downloads. On the **build host**, export `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` (Docker BuildKit and Podman usually forward them into build steps), or configure proxy for the build daemon. For fully disconnected **builds**, use build-args **`OCP_CLIENT_URL`** and **`OCP_MIRROR_URL`** to point `curl` at internal mirrors of the same tarballs (see [Platform and architecture](#platform-and-architecture-multi-arch--apple-silicon)). The same stage runs **`npm ci`** for backend dependencies (lockfile-exact, deterministic installs); restricted networks may need access to **`registry.npmjs.org`** (or an internal npm mirror via `.npmrc` during the image build—advanced).

**Feedback (Tools → Feedback):** With **`FEEDBACK_MODE=github`** (default), the backend **does not** submit issues to the GitHub API. It validates input and returns a pre-filled **`githubIssueUrl`**. Opening that link runs in the **user’s browser**, which must reach **`github.com`** (and related GitHub hosts) via the **workstation** proxy or allowlist—or use the drawer’s copy / JSON export instead of opening the link. **`FEEDBACK_MODE=offline`** avoids GitHub-oriented behavior entirely (see [Build info and update checks](#build-info-and-update-checks)). Feedback API calls stay between the browser and your backend only.

**TLS interception:** an inspecting proxy must be trusted in three separate places — trusting it in one does not fix the others (details: [docs/ENTERPRISE_PODMAN_DEPLOYMENT.md](docs/ENTERPRISE_PODMAN_DEPLOYMENT.md#3-certificate-trust-three-separate-places)):

- **Host** (pulling the UBI base images): the host trust store (`update-ca-trust`) or `/etc/containers/certs.d/<registry>/ca.crt`.
- **Image build** (`dnf`, `curl`, `npm ci` inside `RUN` steps): these use the *image's* trust, not the host's. Pass the CA as a build secret: `OAA_BUILD_CA=/path/corp-ca.pem scripts/deploy/oaa-deploy.sh build` (`podman build --secret id=oaa_build_ca,src=…,type=file`). It is never written to a layer or the image history; never pass a CA as a `--build-arg`.
- **Running backend**: mount the CA read-only and set **`SSL_CERT_FILE`** (oc-mirror, oc, Architect's verified catalog downloads) and **`NODE_EXTRA_CA_CERTS`** (Node requests) to it.

**Quick troubleshooting:**

| Symptom | Likely cause |
|---------|----------------|
| Blueprint release channels or patches never load | Backend cannot reach **GitHub** (`api.github.com`, `raw.githubusercontent.com`) or TLS to those hosts fails. |
| Tools → About update check errors | Optional **GitHub** API access; set `CHECK_UPDATES=false` to disable (see [Build info and update checks](#build-info-and-update-checks)). |
| Operator scan or Run oc-mirror fails with registry timeouts | **Proxy** or **firewall** to `registry.redhat.io` / `quay.io` (and other image hosts in your `imageset-config.yaml`); confirm **`REGISTRY_AUTH_FILE`** is set for auth (separate from HTTP proxy). |
| AWS GovCloud region list empty or errors | Backend needs **`mirror.openshift.com`** for the `openshift-install` tarball used to read stream metadata. |
| **`docker compose build` / `podman build` fails** downloading oc or oc-mirror | **Build-time** egress: set proxy on the **build host** or pass build proxy settings; or use **`OCP_CLIENT_URL`** / **`OCP_MIRROR_URL`** to internal tarball URLs. **`curl: (60)` / `SSL certificate problem`** there is a trust problem, not egress: pass the proxy CA as `OAA_BUILD_CA` (see TLS interception). |
| **`writing blob: … unexpected EOF`** pulling a UBI base image | A proxy or firewall dropped a Quay **CDN** transfer: allow `cdn.quay.io` and `cdn01.quay.io` … `cdn06.quay.io`. Not a credentials or tag problem; the deploy script retries it a bounded number of times. |
| **`npm ci` fails inside backend image build** | Allow **`registry.npmjs.org`** (or npm mirror) from the build environment through the proxy. |
| Feedback “open GitHub” does nothing or errors in the browser | **Browser** cannot reach **`github.com`**; fix workstation proxy/allowlist or use **`FEEDBACK_MODE=offline`** / copy-export workflow. |

**Optional firewall / proxy allow list:** Some teams allow direct egress to specific hosts instead of (or in addition to) forwarding through a proxy. The table below lists **fixed** targets the app code hits; **oc-mirror runs are not fully covered** by any static list because they pull arbitrary image references from your `imageset-config.yaml` (release payload, operators, `additionalImages`, your mirror host, and transitive registries). For full mirror requirements, use Red Hat’s disconnected installation and oc-mirror v2 documentation.

| Tier | Hosts | Used for |
|------|-------|----------|
| **1 — App-defined HTTPS** | `api.github.com`, `raw.githubusercontent.com` | Cincinnati channel/patch lists (`openshift/cincinnati-graph-data`). |
| | `mirror.openshift.com` | **Image build** (`Containerfile` `curl`) and **runtime** client downloads (`openshift-install`, optional `oc-mirror` resolution / export). |
| | `docs.redhat.com` | **Update Docs Links** (field manual doc cache). |
| | `registry.npmjs.org` | **Image build** only: `npm ci` for backend (and frontend) dependencies in Containerfiles. |
| | `registry.access.redhat.com`, `cdn.quay.io`, `cdn01.quay.io` … `cdn06.quay.io` | **Build host**: UBI base images; their layers are served by Quay's CDN (Red Hat article 7084334). |
| | `cdn-ubi.redhat.com` | **Image build**: `dnf` / `microdnf` package installs in the Containerfiles. |
| | `nodejs.org`, `github.com` | **Image build** (backend): contacted while the native SQLite module installs (Node headers, prebuilt-binary attempt). |
| **Browser (Feedback, github mode)** | `github.com` (and related GitHub hosts) | User opens pre-filled issue link from Tools → Feedback; not a backend `fetch`. |
| **2 — Representative registries** (not exhaustive) | `registry.redhat.io`, `quay.io`, `registry.access.redhat.com`, `registry.connect.redhat.com`, `cloud.openshift.com` | Operator catalog scan (`oc-mirror list operators`), typical connected **Run oc-mirror** pulls; align with your pull secret and official mirror docs. |

**Fallbacks when GitHub or the network is unavailable:**

- **`MOCK_MODE=true`** — Bundled Cincinnati data; no GitHub (see [Mock mode (offline demo)](#mock-mode-offline-demo)).
- **`CHECK_UPDATES=false`** — Disables the optional GitHub “new version” check on About.
- **`FEEDBACK_MODE=offline`** — Avoids GitHub-oriented feedback behavior where applicable (see env table under [Build info and update checks](#build-info-and-update-checks)).

If **GitHub is blocked** and you cannot use **`MOCK_MODE`**, live Cincinnati channel/patch lists cannot be loaded in the app; that is a policy constraint, not a missing UI setting. If **all** Red Hat registries are blocked with no proxy path, connected operator scan and connected **Run oc-mirror** cannot succeed in that environment; use a connected jump host and transfer artifacts per [Run oc-mirror](#run-oc-mirror).

**`AIRGAP_FETCH_USE_ENV_PROXY`:** The backend enables undici **`EnvHttpProxyAgent`** by default so Node **`fetch`** honors `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`. Set to **`false`** or **`0`** only if you must disable that behavior (see [Build info and update checks](#build-info-and-update-checks) env table).

### Running behind a reverse proxy or OpenShift Route

When users reach the app through a **different hostname** than the one the frontend container uses internally (for example an OpenShift Route like `https://airgap-architect.example.com`, or an nginx/HAProxy hostname), the Vite dev server will block requests unless that hostname is explicitly allowed.

**Why this happens:** The browser sends the external hostname in the HTTP `Host` header. Vite only accepts a limited set of hosts by default (e.g. `localhost`) to reduce certain security risks. Any other host is rejected with a message like: *"Blocked request. This host ("airgap-architect.example.com") is not allowed."*

**What you need to do:**

1. **Set `VITE_ALLOWED_HOSTS`** to the exact hostname (or hostnames) that users type in the browser.
   - **One host:** `VITE_ALLOWED_HOSTS=airgap-architect.example.com`
   - **Several hosts:** Comma-separated, no spaces: `VITE_ALLOWED_HOSTS=app.example.com,airgap-architect.example.com`
   - Use the same value that appears in the browser's address bar (including subdomain). Do not include `https://` or a path—only the hostname.

2. **Where to set it** depends on how you run the app:
   - **Docker Compose / Podman Compose:** Add to the `frontend` service in `docker-compose.yml` under `environment`, or pass it when starting:
     `VITE_ALLOWED_HOSTS=airgap-architect.example.com docker compose up --build`
   - **OpenShift (Deployment, DeploymentConfig, etc.):** Add an environment variable to the **frontend** container spec:
     - **Name:** `VITE_ALLOWED_HOSTS`
     - **Value:** The hostname of your Route (e.g. `airgap-architect.cjmays.com`). You can find it in the OpenShift console under **Networking → Routes** for your app, or in the Route's **Host** field.
   - **Kubernetes:** Set `VITE_ALLOWED_HOSTS` in the frontend Pod/Deployment's env (e.g. `env` or `envFrom`).
   - **Local dev (npm run dev):** Export before starting, e.g.
     `export VITE_ALLOWED_HOSTS=my-app.mycompany.com` then `npm run dev`, or pass inline: `VITE_ALLOWED_HOSTS=my-app.mycompany.com npm run dev`.

3. **If the UI still can't reach the backend**, you are likely using a reverse proxy or Route for the **frontend** only. The browser then needs to call the backend at a URL it can reach (often the same host with a path, or a separate backend host). Set **`VITE_API_BASE`** to that URL (e.g. `https://airgap-architect.example.com/api` if your proxy forwards `/api` to the backend, or `https://airgap-architect-backend.example.com` if the backend has its own hostname). The frontend container reads both `VITE_ALLOWED_HOSTS` and `VITE_API_BASE` at startup; rebuild or restart the frontend after changing them.

4. **Security note:** Only add hostnames you control and that users are supposed to use. Leaving `VITE_ALLOWED_HOSTS` unset is safe for local use (localhost remains allowed). For production-like deployments behind a proxy or Route, setting it to your actual hostname(s) is the intended approach.

<a id="production-deployment"></a>
## Production Deployment (Kubernetes/OpenShift)

For production deployment to Kubernetes or OpenShift clusters, comprehensive manifests and documentation are provided in the `manifests/` directory.

### Quick Start

Deploy to an existing Kubernetes or OpenShift cluster:

```bash
# 1. Review and customize manifests (see manifests/README.md)
cd manifests/

# 2. Create namespace (optional)
kubectl create namespace airgap-architect

# 3. Apply manifests using Kustomize
kubectl apply -k . -n airgap-architect

# 4. Verify deployment
kubectl get pods -n airgap-architect
kubectl get routes -n airgap-architect  # OpenShift only
```

### What's Included

The `manifests/` directory contains:

- **Base manifests** (`manifests/base/`):
  - `backend-deployment.yaml` - Backend Deployment (1 replica, SQLite single-writer limitation)
  - `frontend-deployment.yaml` - Frontend Deployment (2+ replicas, horizontally scalable)
  - `backend-service.yaml` / `frontend-service.yaml` - ClusterIP Services
  - `pvc.yaml` - PersistentVolumeClaim (250Gi for SQLite database + oc-mirror archives)
  - `configmap.yaml` - Environment variables (PORT, DATA_DIR, LOG_LEVEL, etc.)
  - `secret.yaml` - Template for pull secrets (user must populate)

- **OpenShift-specific** (`manifests/openshift/`):
  - `route-backend.yaml` / `route-frontend.yaml` - TLS edge Routes

- **Kustomize** (`manifests/kustomization.yaml`) - Root configuration for environment overlays

### Key Features

✅ **Production-ready** (v1.6.0):
- Structured logging with JSON output (Pino)
- Health probes (liveness: `/api/health`, readiness: `/api/ready` with DB checks)
- Resource requests and limits defined (backend: 500m-2000m CPU / 1-4Gi RAM, frontend: 100m-500m CPU / 256-512Mi RAM)
- Request correlation with X-Request-ID propagation
- Backend schema validation for all API endpoints (Zod)
- Non-root execution. Compose and the base manifests pin UID 1001; the OpenShift
  overlay leaves the UID to the cluster — see [Security](#security)

### Resource Requirements

**Backend:**
- Replicas: 1 (required - SQLite single-writer limitation)
- CPU: 500m requests, 2000m limits
- Memory: 1Gi requests, 4Gi limits
- Storage: 250Gi PVC (50GB database + 200GB oc-mirror archives)

**Frontend:**
- Replicas: 2+ (horizontally scalable)
- CPU: 100m requests, 500m limits
- Memory: 256Mi requests, 512Mi limits

See `docs/CAPACITY_PLANNING.md` for detailed sizing, monitoring, and tuning guidance.

### Backup and Disaster Recovery

SQLite database backup procedures are documented in `docs/BACKUP_RESTORE.md`:

**Quick backup:**
```bash
# Automated backup script (uses SQLite VACUUM INTO)
./scripts/backup-sqlite.sh <namespace> <backup-dir>

# Verify backup integrity
./scripts/verify-backup.sh /path/to/backup.db
```

**Backup methods:**
1. Online backup (VACUUM INTO) - no downtime, consistent snapshot
2. Kubernetes VolumeSnapshot - fast, storage-layer snapshots
3. File copy with WAL checkpoint - simple, requires brief pause

**Restore procedures:**
See `docs/BACKUP_RESTORE.md` for complete disaster recovery procedures, RTO/RPO guidance, and restore testing.

### Monitoring and Observability

**Structured Logging:**
- JSON logs in production (`LOG_LEVEL=info` default)
- Request correlation with X-Request-ID headers
- Error IDs for client-to-server log correlation

**Health Endpoints:**
- `/api/health` - Liveness probe (process health)
- `/api/ready` - Readiness probe (DB read + write checks)

**Logs:**
```bash
# View backend logs
kubectl logs -f deployment/airgap-architect-backend -n airgap-architect

# View frontend logs
kubectl logs -f deployment/airgap-architect-frontend -n airgap-architect
```

See `docs/HEALTH_PROBES.md` for probe configuration and troubleshooting.

### Configuration

All configuration is via ConfigMap and Secret. Common settings:

**Environment variables** (ConfigMap):
- `LOG_LEVEL` - Logging verbosity (trace, debug, info, warn, error; default: info)
- `LOG_FORMAT` - Log format (json or pretty; default: json in production)
- `DATA_DIR` - SQLite database location (default: /data)
- `VITE_API_BASE` - Frontend API URL (e.g., http://airgap-architect-backend:4000)
- `FEEDBACK_MODE` - Feedback submission mode (github, offline, disabled; default: github)
- `CHECK_UPDATES` - Update check on About page (true/false; default: true)

**Secrets** (Secret):
- Pull secret content (base64 encoded)
- Mirror registry credentials (base64 encoded)

See `manifests/README.md` for complete configuration reference.

### Scaling Considerations

**Backend scaling:**
- ⚠️ Backend CANNOT scale horizontally (SQLite single-writer limitation)
- Scale vertically by increasing resource limits
- Consider external oc-mirror storage for large deployments

**Frontend scaling:**
- ✅ Frontend CAN scale horizontally (stateless)
- Increase replicas for high availability and load distribution
- Example: `kubectl scale deployment airgap-architect-frontend --replicas=3`

### Security

**Container security:**
- UBI 9 base images (Red Hat Universal Base Image)
- Non-root execution (UID 1001, fsGroup 1001)
- No privileged escalation required

> **The UID differs between the two deployment models, on purpose.**
>
> - **Compose and `manifests/base/`** pin `runAsUser: 1001` and `fsGroup: 1001`.
>   There is no SCC to assign anything, so the identity has to be stated.
> - **The OpenShift overlay removes both pins.** Under `restricted-v2` OpenShift
>   *assigns* a UID and fsGroup from the namespace's own
>   `openshift.io/sa.scc.uid-range`, and an explicitly requested value outside that
>   range is rejected at admission — 1001 is not in a default namespace range. So
>   `oc kustomize manifests/openshift` renders `runAsNonRoot: true`,
>   `allowPrivilegeEscalation: false`, `seccompProfile: RuntimeDefault`, all
>   capabilities dropped, and **no** `runAsUser` or `fsGroup`. An earlier revision
>   of this README said the manifests were "unlikely to be admitted as-is"; that
>   described the base, and it is no longer true of the overlay.
>
> The images support this: the backend's files and Node runtime are usable by an
> arbitrary UID with GID 0, checked locally under Podman. Applying the overlay to a
> cluster is outside this release's delivery scope — the procedure and post-deploy
> checks live in [`manifests/README.md`](manifests/README.md). Tracked as
> **PROD-039** and **PROD-003**; if you deploy to OpenShift, please report what you
> find.

**Network security:**
- TLS edge termination on Routes (OpenShift)
- ClusterIP Services (not exposed externally by default)
- Configure Ingress or Routes for external access

**Secrets management:**
- Store pull secrets in Kubernetes/OpenShift Secrets
- Mount secrets as files (not environment variables)
- See `manifests/base/secret.yaml` for template

### Troubleshooting

**Common issues:**

| Issue | Solution |
|-------|----------|
| Backend pods stuck in CrashLoopBackOff | Check PVC is bound and writable by UID 1001. See logs: `kubectl logs <pod>` |
| Frontend can't reach backend | Verify VITE_API_BASE points to backend Service URL (e.g., http://airgap-architect-backend:4000) |
| Database connection errors | Check /api/ready endpoint returns 200. Verify PVC is mounted and SQLite file exists |
| Resource limits too low (OOMKilled) | Increase memory limits in Deployment. See `docs/CAPACITY_PLANNING.md` for sizing guidance |
| No external access to UI | Create Ingress (Kubernetes) or Route (OpenShift) for frontend Service |

**Debug commands:**
```bash
# Check pod status
kubectl get pods -n airgap-architect

# View pod logs
kubectl logs <pod-name> -n airgap-architect

# Describe pod for events
kubectl describe pod <pod-name> -n airgap-architect

# Check PVC status
kubectl get pvc -n airgap-architect

# Test readiness probe manually
kubectl exec <backend-pod> -n airgap-architect -- curl http://localhost:4000/api/ready
```

### Complete Documentation

For comprehensive deployment guidance, see:
- `manifests/README.md` - Deployment guide with prerequisites, customization, troubleshooting
- `docs/CAPACITY_PLANNING.md` - Resource sizing, monitoring alerts, performance tuning
- `docs/BACKUP_RESTORE.md` - Backup strategies, disaster recovery, restore procedures
- `docs/HEALTH_PROBES.md` - Health probe configuration, failure scenarios, tuning
- `docs/API_SCHEMA.md` - API contract, request/response schemas, validation rules

<a id="updating-the-app"></a>
## Updating the app

Before updating, open **Tools → Export Run** and save your configuration JSON; after updating, restore it with **Tools → Import Run** and re-enter your credentials, which are deliberately excluded. A Run JSON is not a full backup — see **[docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md)** for the data volume. Follow **[docs/UPDATING.md](docs/UPDATING.md)** for your deployment.

Update checks compare the installed application version with the newest published GitHub Release and do **not** require `APP_GIT_SHA` (see [Build info and update checks](#build-info-and-update-checks)).

<a id="mirroring-workflow"></a>
## Mirroring workflow

> **Full guide:** [Mirroring user guide](docs/MIRRORING_WORKFLOW.md#part-a--user-guide) in
> [`docs/MIRRORING_WORKFLOW.md`](docs/MIRRORING_WORKFLOW.md) — content, credentials, the three workflows, transfer
> integrity, the oc-mirror build check and current limits. Mirroring is new in v2.2.0.

**Mirroring** (landing page → **Open Mirroring**) plans and runs oc-mirror v2 without an install. It is
independent of Install: its own profiles, its own OpenShift release per profile, its own storage and history.
A profile can hold any combination of **OpenShift platform** content (one 4.20, 4.21 or 4.22 release),
**Operators** (Red Hat, Certified and Community catalogs) and **Additional images**. Unsupported versions are
refused, never replaced.

| Workflow | Where it runs | What it does |
|---|---|---|
| Mirror to disk → **Prepare transfer** | Connected side | Downloads the images into archive files, then adds checksums (`SHA256SUMS`), the exact configuration and its provenance (`oaa-transfer/`) |
| **Receive transfer** → Disk to mirror | Disconnected side | Verifies every copied file, then uploads the verified archives into your registry with the received configuration, byte for byte |
| Mirror to mirror | One machine that reaches both sides | Copies straight from the sources into your registry |

Quick start:

1. **New profile** → name it and choose the content.
2. **Platform**: choose the channel and patch, **Lock release**.
3. **Operators**: **Scan catalogs** for the minor (Red Hat pull secret), add operators or a Scenario Quick Pick,
   **Check catalogs**.
4. **Additional images**: add image references.
5. **Show YAML**: DRAFT while items remain to fix; the validated ImageSetConfiguration once ready.
6. **Run & transfers**: choose the workflow, enter the credentials it needs (used for that run only, never
   stored), **Run preflight**, run. Follow it in **Operations**.
7. Disconnected site: **Prepare transfer**, copy the archives with `SHA256SUMS` and `oaa-transfer/`, then
   **Receive transfer…** and **Disk to mirror** on the disconnected side.

On receipt, the disconnected side compares its own oc-mirror with the build that made the archives (same bytes
or a different build; never blocking, and not a FIPS or suitability statement). Architect does not carry oc-mirror
or oc inside a transfer (optional verified tool tarballs are planned for a later release). Use v2.2.1 or later for
Mirroring in containers: v2.2.0's backend image cannot run Mirroring (`EACCES` on the bundled oc-mirror).

Full guide, including credentials, storage, integrity checks, transfer order and current limits:
[docs/MIRRORING_WORKFLOW.md — Part A](docs/MIRRORING_WORKFLOW.md#part-a--user-guide).
Screenshots: [Mirroring](#screenshots-mirroring). Storage for large mirrors:
[Mirroring storage on its own volume](#mirroring-storage-volume).

<a id="generating-assets"></a>
## Generating assets

1. Complete the wizard (Blueprint → Methodology → scenario steps → Operators if desired → Assets & Guide).
2. On the **Assets & Guide** step, use **Export** to download a run bundle (ZIP) containing generated YAML and the field manual. Export options control inclusion of credentials, certificates, and client tools.
3. **install-config.yaml** and **agent-config.yaml** (when applicable) are also available as inline copy/download from the same step.
4. Use **Update Docs Links** to refresh cached documentation links used in the field manual.

For disconnected mirror mapping in `install-config.yaml`, the generator emits `imageDigestSources` for OCP `4.14+` and `imageContentSources` for OCP `4.13` and earlier.

### High-Side Runtime Package Export

The **Export** options include an advanced feature: **Include high-side runtime package artifacts**. When enabled, the export bundle contains a complete runtime package for deploying the application on a fully disconnected (high-side) system:

**What's included:**
- Container images (OCI archives for backend and frontend)
- Docker Compose configuration for deployment
- Launch scripts (`load-runtime-images.sh`, `start-high-side.sh`)
- Bundled configuration payload (your current state)
- SHA256 checksums for integrity verification
- Comprehensive startup guide (`HIGH_SIDE_STARTUP_GUIDE.md`)

**Prerequisites:**
- Container images must be built locally (`docker compose build` or `podman compose build`)
- Images tagged as: `localhost/openshift-airgap-architect-backend:latest` and `localhost/openshift-airgap-architect-frontend:latest`
- Podman or Docker available on the export system

**Usage flow:**
1. Enable "Include high-side runtime package artifacts" in Export options
2. Click Export to download the bundle
3. Transfer the bundle to the disconnected system
4. Extract and verify checksums: `sha256sum -c SHA256SUMS.txt`
5. Load container images: `bash runtime-package/launch/load-runtime-images.sh`
6. Start the runtime: `bash runtime-package/launch/start-high-side.sh`
7. Access UI at `http://localhost:5173` (backend on `localhost:4000`)

**High-side behavior:**
- Runtime starts with `AIRGAP_RUNTIME_SIDE=high-side` environment variable
- Auto-imports bundled configuration on first startup
- Internet-dependent features (Cincinnati, operator discovery) are automatically disabled
- Localhost-only port binding by default (127.0.0.1)

For remote access from another approved high-side workstation, use SSH port forwarding:
```bash
ssh -L 5173:localhost:5173 -L 4000:localhost:4000 <user>@<runtime-host>
```

See `HIGH_SIDE_STARTUP_GUIDE.md` in the runtime package for complete instructions, firewall considerations, and SELinux notes.

<a id="operator-workflows"></a>
## Operator workflows

- **Operator scan** downloads each catalog over verified TLS (the pull secret is used only for that download) and lists the local copy with `oc-mirror list operators`; it requires valid **registry.redhat.io** credentials. A registry certificate that cannot be verified fails the scan; trust a corporate CA with `SSL_CERT_FILE` / `SSL_CERT_DIR` or `/etc/containers/certs.d/<host>/ca.crt`.
- **Recommended:** Mount an auth file into the backend and set `REGISTRY_AUTH_FILE`:

  ```bash
  REGISTRY_AUTH_FILE=/data/registry-auth.json docker compose up --build
  ```

  To mount a local file, add a volume in `docker-compose.yml`, e.g.:

  ```yaml
  backend:
    volumes:
      - ./my-pull-secret.json:/data/registry-auth.json:Z
  ```

- **Optional:** In the Operators step you can paste a Red Hat pull secret; it is used only for the scan, not stored, and is cleared on **Start Over**.
- Scans can take several minutes; navigation does not cancel running jobs. Use the Operations step to view logs and clear completed jobs.
- If an `oc-mirror` run is active and you click **Start Over**, the confirmation modal warns you and lists relevant paths. Continuing cancels the active `oc-mirror` run safely (non-destructive) and returns to Landing; review those paths for partial artifacts before re-running.

<a id="run-oc-mirror"></a>
## Run oc-mirror

The **Run oc-mirror** tab lets you run oc-mirror v2 directly from the app against the generated (or an external) `imageset-config.yaml`. oc-mirror runs as a background job inside the backend container. You can stream its output and manage the job from the Operations tab.

### Workflows

Three workflows are supported. The correct choice depends on whether the machine running the app has direct internet access to Red Hat registries:

| Workflow | When to use | Steps |
|---|---|---|
| **Step 1 — Mirror to disk** | Fully disconnected: internet side | Pulls from Red Hat → writes tar archives + working-dir to a local path |
| **Step 2 — Disk to mirror** | Fully disconnected: disconnected side | Reads tar archives from a local path → pushes to your mirror registry |
| **Mirror to mirror** | Machine has access to both Red Hat and the registry | Pulls from Red Hat → pushes directly to mirror registry in one step |

For **fully disconnected** environments: run Step 1 on an internet-connected machine, physically transfer the archive directory (and working-dir) across the air gap, then run Step 2 on or near the disconnected registry. Mirror-to-mirror is for jumpbox or partially connected scenarios.

### Credentials per workflow

| Workflow | Credentials needed |
|---|---|
| Mirror to disk | Red Hat pull secret (registry.redhat.io / quay.io) |
| Disk to mirror | Mirror registry credentials only |
| Mirror to mirror | Both Red Hat pull secret + mirror registry credentials (combined into a single auth file) |

The Authentication section on the Run oc-mirror tab is conditionally rendered based on which workflow is selected and what credentials are already available from earlier steps (Blueprint retained pull secret, Identity & Access mirror registry credentials).

### Preflight validation

Before running oc-mirror, the **Run preflight** button validates your configuration and credentials:

- **Pull secret validation** — For mirror-to-disk and mirror-to-mirror modes, validates that a Red Hat pull secret is present, is valid JSON, and contains an `auths` object. Missing or invalid pull secrets are reported as **blockers** (preflight will not pass).
- **Mirror registry credentials** — For disk-to-mirror and mirror-to-mirror modes, validates that mirror registry credentials are present and valid. Missing credentials are reported as **blockers**.
- **Advanced options validation** — Validates `logLevel`, `parallelImages`, `parallelLayers`, `imageTimeout`, `retryTimes`, and `retryDelay` against allowed values and formats.
- **External config validation** — When using an external `imageset-config.yaml`, validates YAML structure, required fields (`apiVersion`, `kind`, `mirror`), and platform/operator configuration.
- **Human-readable error messages** — All validation errors are translated to beginner-friendly messages with corrective guidance.

Preflight results show severity (blocker, warning, info) and a summary count. **Blockers** must be resolved before the run button activates. Results are displayed inline with color-coded severity indicators.

### Storage: archive, workspace, and cache paths

oc-mirror requires three directories inside the backend container:

| Path (container-internal) | Default | Purpose | Typical size |
|---|---|---|---|
| **Archive** | `/data/oc-mirror/archives` | Mirror-to-disk: destination for tar archives and working-dir. Disk-to-mirror: source for those archives. | 50–200+ GB per OCP release + operators |
| **Workspace** | `/data/oc-mirror/workspace` | oc-mirror metadata, cluster-resources, logs (`working-dir/`). Keep between runs for incremental mirroring (`--since`). | 1–5 GB |
| **Cache** | `/data/oc-mirror/cache` | Image layer cache. Safe to delete (rebuilds automatically); keeping it saves significant time on re-runs. Not used in mirror-to-mirror mode. | 5–50+ GB |

All three paths live inside the `backend-data` Docker/Podman named volume by default. For large mirrors (50–200+ GB archives), the default named volume likely lacks space. **Mount external storage** instead.

### Mounting external storage for oc-mirror (recommended for large mirrors)

Create a `compose.override.yml` file in the same directory as `docker-compose.yml`. This file is gitignored and will never be committed. A tracked template **`compose.override.yml.example`** is included in the repository with annotated examples for common overrides (external storage, proxy, VITE_ALLOWED_HOSTS, REGISTRY_AUTH_FILE) and notes on Docker vs Podman auto-merge behavior.

#### Option A — Single path (all three subdirs under one mount)

```yaml
# compose.override.yml
services:
  backend:
    volumes:
      - /path/to/large-drive/oc-mirror:/data/oc-mirror:Z
```

Replace `/path/to/large-drive/oc-mirror` with a host path that has enough space (50–200+ GB minimum for a single OCP release + common operators).

**What happens with the subdirectories:** The app uses three subdirectories under this path — `archives/`, `workspace/`, and `cache/`. **You do not need to create them.** The app creates all three automatically on the first run. You will see them appear in the archive/workspace/cache path fields as `/data/oc-mirror/archives`, `/data/oc-mirror/workspace`, and `/data/oc-mirror/cache` — which map to `<your-host-path>/archives`, `<your-host-path>/workspace`, and `<your-host-path>/cache` on the host. Nothing is dumped directly into the root of the mounted directory.

#### Option B — Split paths (each subdir mounted from a different host location)

Use this if your storage is spread across multiple drives or you want fine-grained control:

```yaml
# compose.override.yml
services:
  backend:
    volumes:
      - /mnt/fast-ssd/oc-mirror/archives:/data/oc-mirror/archives:Z
      - /mnt/fast-ssd/oc-mirror/workspace:/data/oc-mirror/workspace:Z
      - /mnt/fast-ssd/oc-mirror/cache:/data/oc-mirror/cache:Z
```

**With split paths you must pre-create the host directories** before starting the stack, because Compose will error if a bind-mount target doesn't exist on the host:

```bash
mkdir -p /mnt/fast-ssd/oc-mirror/archives
mkdir -p /mnt/fast-ssd/oc-mirror/workspace
mkdir -p /mnt/fast-ssd/oc-mirror/cache
```

> **Do not use `sudo mkdir`** — the directory must be owned by the user who runs `podman compose` / `docker compose`, not by root. See [Permissions and SELinux](#permissions-and-selinux-podman-on-fedorarhelcentos) below.

#### Rebuild and restart after adding the override

**Podman** (both files passed explicitly — reliable on RHEL 9/10):
```bash
OAA_COMPOSE_FILES=docker-compose.yml:compose.override.yml scripts/deploy/oaa-deploy.sh up --recreate && scripts/deploy/oaa-deploy.sh verify
```
(Add `scripts/deploy/oaa-deploy.sh build &&` in front when the images must be rebuilt as well.)

**Docker:**
```bash
docker compose up -d
```

The named `backend-data` volume (app state, SQLite database) is **preserved** — only the `oc-mirror` paths are now served from your external mount.

> **Docker Compose** merges `compose.override.yml` automatically. **Podman Compose** may not — the behavior depends on the Compose provider installed (`podman-compose` Python package vs Docker Compose V2 plugin). **On RHEL 9/10**, always pass both files explicitly with `-f` flags as shown above to guarantee the override is applied.

> **Sequence keys are appended, not replaced.** Across `-f` files Compose merges list-valued keys such as `ports:`, `volumes:`, and `environment:`. For `volumes:` and `environment:` that is usually what you want — the override adds to the base. For `ports:` it is not: an override that lists a different host port yields **both** mappings, so the base `4000`/`5173` bindings stay bound and can collide with another stack. To replace a list rather than extend it, use the provider's explicit list-replacement mechanism — `!override` in the Compose provider tested here:
>
> ```yaml
> services:
>   backend:
>     ports: !override
>       - "127.0.0.1:4000:4000"
> ```
>
> Verify the result with `podman compose -f docker-compose.yml -f compose.override.yml config` before starting the stack.

### Permissions and SELinux (Podman on Fedora/RHEL/CentOS)

**This section applies to you if you are running Podman on a Linux host with SELinux enforcing (Fedora, RHEL, CentOS Stream).** If you skip these steps you will see `EACCES: permission denied` when the app tries to browse or write to the mounted directory.

There are two independent requirements — both must be satisfied:

#### 1. `:Z` volume label (SELinux relabeling — required on Fedora/RHEL/CentOS)

All volume mounts in `compose.override.yml` **must** include `:Z` so Podman relabels the host directory with the correct SELinux context for container access:

```yaml
      - /path/to/large-drive/oc-mirror:/data/oc-mirror:Z
```

Without `:Z`, SELinux blocks the container from reading or writing the directory at the kernel level, even if the file permissions look correct. This is the most common cause of `EACCES: permission denied` on Fedora.

> **Note:** `:Z` (uppercase) sets a private, unshared label — safe for a single container. `:z` (lowercase) sets a shared label for multiple containers. Use `:Z` unless you have a specific reason for `:z`.

#### 2. Directory ownership (must be owned by the user running podman, not root)

Create the host directory as yourself — **not with `sudo`**:

```bash
# Correct — owned by your user
mkdir -p /path/to/large-drive/oc-mirror

# Wrong — owned by root; the container's chown step cannot fix this
sudo mkdir -p /path/to/large-drive/oc-mirror
```

If you already created it with `sudo`, fix it:

```bash
sudo chown $USER /path/to/large-drive/oc-mirror
# or for a split-path setup:
sudo chown $USER /path/to/archives /path/to/workspace /path/to/cache
```

**Why this matters:** The backend container runs the app as UID 1001 (`appuser`). The entrypoint starts as root and attempts `chown -R 1001:0` on the data directory before dropping privileges. With rootless Podman, the container's root maps to your host UID, so it can only chown files your host user owns. If the directory was created with `sudo` (owned by host root), the chown fails silently and UID 1001 cannot access the directory. The entrypoint falls back to `chmod o+rwX` in that case, but `:Z` is still required for SELinux.

#### Quick diagnosis

If you see `EACCES: permission denied` in the Browse directory modal or in oc-mirror run logs:

1. Check that your `compose.override.yml` includes `:Z` on every volume mount.
2. Check that the host directory is owned by your user: `ls -la /path/to/large-drive/`
3. If both look correct, check SELinux context: `ls -laZ /path/to/large-drive/oc-mirror` — it should include `container_file_t` or similar after a `:Z`-mounted start.
4. Restart after any change: `OAA_COMPOSE_FILES=docker-compose.yml:compose.override.yml scripts/deploy/oaa-deploy.sh up --recreate` (no rebuild is needed for mount changes)

### Mounting a Red Hat pull secret for oc-mirror (persistent, no paste required)

If you want oc-mirror to authenticate to Red Hat registries without pasting a pull secret on every run, mount your pull secret JSON and set `REGISTRY_AUTH_FILE`:

```yaml
# compose.override.yml
services:
  backend:
    environment:
      - REGISTRY_AUTH_FILE=/data/registry-auth.json
    volumes:
      - /path/to/your/pull-secret.json:/data/registry-auth.json:Z
      - /path/to/large-drive/oc-mirror:/data/oc-mirror:Z
```

`REGISTRY_AUTH_FILE` is intentionally NOT set in `docker-compose.yml`. The backend reads `REGISTRY_AUTH_FILE` from its own environment to locate the auth JSON, then uses those credentials for the runs that need them (`--authfile=<path>` for mirror runs; the Operators scan uses them only for its own verified catalog download) — the env var itself is stripped from the child oc-mirror process because oc-mirror v2's embedded cache registry (distribution/distribution v3) interprets `REGISTRY_*` env vars as registry config keys, causing a goroutine panic at startup (`registry/handlers/app.go NewApp`). Set `REGISTRY_AUTH_FILE` only in a `compose.override.yml` alongside the file mount. A mounted `REGISTRY_AUTH_FILE` is used by both the Operators scan and the Run oc-mirror tab, so you do not need to retain a pull secret from Blueprint for those operations. (`REGISTRY_AUTH_FILE` and the mounted *pull secret* described under [Mounted Red Hat pull secret](#mounted-red-hat-pull-secret) are separate mechanisms: operator scans read only the former.)

Alternatively, on the Blueprint step tick **"Retain pull secret for use on subsequent pages"** after entering your Red Hat pull secret. The session-retained secret is then available as a one-click option in the Run oc-mirror Authentication section for the mirror-to-disk and mirror-to-mirror workflows.

### Running oc-mirror without Compose (local / standalone)

If you're running the backend directly (not via Compose), ensure:

1. The backend process has write access to the archive, workspace, and cache directories you configure.
2. Set `DATA_DIR` to a path with sufficient space (or configure paths individually in the Run oc-mirror tab).
3. Any pull secret you need is either mounted at `REGISTRY_AUTH_FILE`, retained from Blueprint, or pasted directly in the Authentication section.

```bash
DATA_DIR=/mnt/large-drive/airgap-data \
REGISTRY_AUTH_FILE=/mnt/large-drive/airgap-data/registry-auth.json \
  cd backend && npm run dev
```

Then configure the archive, workspace, and cache paths in the Run oc-mirror tab to point inside `DATA_DIR` (e.g. `/mnt/large-drive/airgap-data/oc-mirror/archives`).

### After a successful mirror-to-disk run

When the run completes, a summary modal appears automatically showing:
- Elapsed time
- Archive directory path (inside the container)
- Next-step instructions

The archive directory contains tar archives and a `working-dir/` subdirectory. **You must transfer the entire archive directory** (not just the tar files — oc-mirror needs `working-dir/` for disk-to-mirror) to the disconnected side, along with your other deliverables (install-config, agent-config, field manual, cluster-resources).

To find the archive on your host when using Compose with the default named volume:

**Podman**
```bash
podman volume inspect openshift-airgap-architect_backend-data
```

**Docker**
```bash
docker volume inspect openshift-airgap-architect_backend-data
```

Look for the `Mountpoint` field — that host directory corresponds to `/data` inside the container. The archives will be at `<Mountpoint>/oc-mirror/archives/`.

If you used a `compose.override.yml` mount (recommended for large mirrors), the archives are at the host path you specified directly.

<a id="operations"></a>
## Operations

The **Operations** tab provides a central view of all background jobs (Cincinnati channel refresh, operator scans, oc-mirror runs) with live streaming output, job history, and downloadable logs.

### Features

- **Job history** — All jobs (Cincinnati refresh, operator scan, oc-mirror run) are tracked with start/end time, status (running, completed, failed), and elapsed duration.
- **Live output** — Job output streams in real-time while a job is running. Logs are preserved after completion.
- **Download logs** — Each job has a **Download Logs** button that downloads a timestamped text file with the job's complete output. Filename format: `{job-type}_{YYYY-MM-DD_HH-MM-SS}.txt` (e.g., `oc-mirror-run_2026-05-08_14-30-45.txt`, `operator-scan_2026-05-08_09-15-22.txt`, `cincinnati-refresh_2026-05-08_08-00-12.txt`).
- **Clear completed jobs** — Remove finished jobs from the history to reduce clutter. Running jobs cannot be cleared.
- **Pre-lock access** — The Operations tab is accessible before Blueprint lock-in, so you can view Cincinnati refresh logs immediately on first launch.

### Job types

| Job type | When it runs | Logs contain |
|----------|--------------|--------------|
| **Cincinnati refresh** | On app startup and when **Update** is clicked on Blueprint | Release channel data, available versions, upgrade paths |
| **Operator scan** | When **Scan** or **Update Operators** is clicked on Operators step | List of available operators, catalogs, channels (from `oc-mirror list operators`) |
| **oc-mirror run** | When **Run oc-mirror** is clicked on Run oc-mirror step | oc-mirror v2 output (mirror progress, image pulls, tar archive creation, registry pushes) |

All jobs run as background processes in the backend container. Navigation during a job does not cancel it; use the **Stop** button on the Operations tab to cancel a running oc-mirror job if needed.

### Prometheus Metrics

The backend exposes Prometheus metrics at `/api/metrics` for production monitoring. Metrics include HTTP request rates, latency percentiles, background job tracking, and state operations.

**Quick test:**
```bash
curl http://localhost:3000/api/metrics
```

**Prometheus scrape configuration:**
```yaml
scrape_configs:
  - job_name: 'airgap-architect'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/api/metrics'
```

**Key metrics:**
- `http_requests_total` — HTTP request counts by method, route, status code
- `http_request_duration_seconds` — Request latency histogram (p50, p95, p99)
- `background_jobs_total` — Job counts by type (cincinnati-refresh, operator-scan, oc-mirror-run) and status
- `background_jobs_running` — Currently running jobs gauge
- `background_job_duration_seconds` — Job execution time histogram
- `app_state_operations_total` — State save/load operation counts

**Grafana dashboards:**

Example PromQL queries for dashboards:

```promql
# Request rate by endpoint
sum(rate(http_requests_total[5m])) by (route)

# p95 request latency
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))

# Job success rate
sum(rate(background_jobs_total{status="completed"}[5m])) / sum(rate(background_jobs_total[5m])) * 100

# Currently running oc-mirror jobs
background_jobs_running{job_type="oc-mirror-run"}
```

See **`docs/METRICS.md`** for complete metric definitions, labels, bucket configurations, alert examples, and Grafana dashboard templates.

<a id="mock-mode-offline-demo"></a>
## Mock mode (offline demo)

With no registry access, run with bundled Cincinnati and operator data:

```bash
MOCK_MODE=true docker compose up --build
```

If you have registry access but only need to avoid **GitHub** (for example Cincinnati graph data) while staying otherwise connected, prefer **`HTTP_PROXY` / `HTTPS_PROXY` on the backend** or the allow-list guidance in [Corporate HTTP proxy and backend egress](#corporate-proxy-backend-egress) before relying on mock data.

<a id="e2e-testing"></a>
## End-to-End (E2E) Testing

Playwright-based E2E tests validate critical user workflows including wizard completion, import/export, and background job tracking.

**Prerequisites:**
- Application running (frontend at `:5173`, backend at `:4000`)
- Playwright installed (`npm install` from project root)

**Run E2E tests:**
```bash
# Headless (CI mode)
npm run test:e2e

# With browser visible
npm run test:e2e:headed

# Interactive UI mode (best for development)
npm run test:e2e:ui

# Debug mode (step through tests)
npm run test:e2e:debug
```

**Test coverage:**
- **Wizard completion** - Full flow from blueprint → configure → generate → export
- **Import/export** - Export configuration, clear state, import, verify restoration
- **Operations** - Job history, Cincinnati refresh, log viewing, job status tracking

**12 E2E tests across 3 test suites.** See `e2e/README.md` for detailed test documentation, debugging tips, and CI integration guide.

<a id="load-testing"></a>
## Load Testing

Validate application performance and capacity planning under concurrent user load.

**Load test script:** `scripts/load-test.sh`

**Run load tests:**
```bash
# Default (10 concurrent users, 30 minutes)
./scripts/load-test.sh

# Custom configuration
./scripts/load-test.sh http://localhost:4000 25 60  # 25 users, 60 minutes
```

**Test scenarios:**
- **Health check baseline** - 1000 rapid-fire requests to establish minimum latency
- **Cincinnati channels** - 500 version discovery requests to test external API caching
- **State operations** - 500 save + 500 load to validate SQLite performance
- **Concurrent users** - Realistic wizard workflow with configurable users and duration
- **YAML generation** - 100 generation requests to test computational overhead

**Performance targets:**
- Health check: P95 <50ms
- State save/load: P95 <200ms
- Cincinnati: P95 <2s
- YAML generation: P95 <1s
- Failure rate: <1%

**Resource monitoring:**
```bash
# Docker Compose
docker stats

# Kubernetes
kubectl top pod -l app=airgap-architect
```

**Results:** Automatically generates timestamped results directory with latency percentiles (P50, P95, P99), request counts, failure rates, and per-user summaries. See `docs/LOAD_TESTING.md` for detailed analysis guide, optimization recommendations, and production deployment checklist.

<a id="platform-and-architecture-multi-arch--apple-silicon"></a>
## Platform and architecture (multi-arch / Apple Silicon)

**The backend image builds natively for the host architecture.** `Containerfile` detects `$(uname -m)` at build time and downloads the matching `oc`/`oc-mirror` binaries (x86_64, aarch64, ppc64le, s390x). No `platform: linux/amd64` override is needed — Apple Silicon users get a native aarch64 image that runs without emulation.

- **Supported build architectures:** x86_64 (amd64), aarch64 (arm64), ppc64le, s390x.
- **Tool version policy (oc and oc-mirror differ deliberately):**
  - **`oc-mirror` → global latest.** Resolved from `clients/ocp/latest`, independent of the target OpenShift minor. Red Hat directs users to the latest oc-mirror v2 regardless of which releases are mirrored, and operator discovery needs it: `--v2 list operators` does not exist in 4.21.x.
  - **`oc` → latest patch within the selected target minor.** Resolved from `clients/ocp/latest-<minor>`, so a 4.20 bundle gets the newest 4.20.z and a 4.22 bundle gets the newest 4.22.z. Never a different minor.
  - No z-stream is hardcoded. Each artifact is verified against that channel's own `sha256sum.txt` before use, and the resolved version/digest is recorded. Acquisition fails closed on download, checksum-metadata, or integrity errors.
  - A later rebuild may legitimately pick up a newer `oc-mirror`. That is intentional. **A tool binary from a newer stream does not extend supported target versions — Architect targets 4.20, 4.21 and 4.22 only.**
- **Custom binary URLs:** Pass `--build-arg OCP_CLIENT_URL=<url> --build-arg OCP_CLIENT_SHA256=<hex>` and/or `--build-arg OCP_MIRROR_URL=<url> --build-arg OCP_MIRROR_SHA256=<hex>` to override the resolved download URLs at build time. The SHA256 arg is required when overriding a URL — the build fails without it. `--build-arg OC_CHANNEL=` / `OC_MIRROR_CHANNEL=` select a different release channel.
- **Runtime override:** Set **`OC_MIRROR_BIN`** to a path to override the baked-in binary at runtime without rebuilding. For URL-based override, set **`OC_MIRROR_URL`** and **`OC_MIRROR_SHA256`** (both required).
- **Mirror path pattern:** `https://mirror.openshift.com/pub/openshift-v4/<arch>/clients/ocp/<channel>/` where `<channel>` is `latest` (oc-mirror) or `latest-<minor>` (oc). Supported `<arch>`: x86_64, amd64, aarch64, arm64, ppc64le, s390x.
- **Export bundle:** The Assets step can include oc/oc-mirror in the download bundle and lets you pick the architecture. Both binaries are resolved and checksum-verified per request, and the bundle carries `tools/TOOLS_PROVENANCE.json` recording the exact resolved version, SHA256, channel, and source URL for each. That selection does not change the backend's Operators scan binary.

See **`docs/OPERATOR_SCAN_ARCHITECTURE_PLAN.md`** for root cause, design, and Podman/macOS notes.

<a id="mounted-red-hat-pull-secret"></a>
## Mounted Red Hat pull secret

In pipeline or hardened-container environments you can pre-mount a Red Hat pull secret file into the backend container instead of pasting it in the UI each session. The file is read by the backend only; **its contents are never sent to the browser**.

**Detection priority (first match wins):**
1. `PULL_SECRET_FILE` env var — explicit path override
2. `/run/secrets/pull-secret` — Docker/Podman native `--secret` mount
3. `/data/pull-secret.json` — bind-mount into the data directory
4. `~/.openshift/pull-secret` — `oc` CLI default location (non-container dev runs)

The file must be valid JSON with an `.auths` key containing at least one Red Hat registry entry (`registry.redhat.io`, `quay.io`, `cloud.openshift.com`, or `registry.connect.redhat.com`).

When a mounted secret is detected:
- **Blueprint step** — an informational badge reports that a mounted secret is present on the server. The pull secret field is left **empty**, and the credential's contents are never sent to the browser. Paste a secret there only if you want to use a *different* one.
- **Run oc-mirror step** — a "Use mounted Red Hat pull secret" option appears in the Authentication section for `mirrorToDisk` and `mirrorToMirror` modes. The backend authenticates with the mounted file server-side.
- **Operator catalog scans** authenticate separately, through `REGISTRY_AUTH_FILE` — a mounted *pull secret* does not feed a scan. See [Mounting a Red Hat pull secret for oc-mirror](#mounting-a-red-hat-pull-secret-for-oc-mirror-persistent-no-paste-required).
- The secret is **never stored to disk or database, and never transmitted to the browser** — it is held in backend memory only, for the lifetime of the backend process.

> Prior releases pre-populated the Blueprint field from the mounted file. That required an
> endpoint which returned the raw credential to any caller, so it was withdrawn in v2.1
> (`GET /api/secrets/rh-pull-secret/content` now returns `410 ENDPOINT_WITHDRAWN`). Only a
> non-sensitive `{ available: boolean }` probe remains. Nothing else about the mounted-secret
> workflow changed: server-side mirror operations still use it.

**Example `compose.override.yml`** to mount a pull secret:
```yaml
services:
  backend:
    environment:
      - PULL_SECRET_FILE=/run/secrets/pull-secret
    secrets:
      - pull-secret
secrets:
  pull-secret:
    file: /home/user/pull-secret.json
```

<a id="build-info-and-update-checks"></a>
## Build info and update checks

The **Tools → About** panel shows build info (version, revision when supplied, build time) and update status. The backend exposes:

- **`GET /api/build-info`** — Returns the synchronized application `version` (from `backend/package.json`), `gitSha`, `buildTime`, `repo`, `branch`. The `version` field reflects the deterministic package-derived application version (e.g. `2.0.0-dev`), kept in sync across all manifests by `npm run check:app-version`. No git commands run at runtime.
- **`GET /api/update-info`** — When update checks are enabled, compares the installed `version` with the newest **published, stable GitHub Release** of `APP_REPO` (drafts and prereleases excluded; release metadata must name that repository; an older release never prompts a downgrade) and returns `updateStatus`, `urgent`, `installedVersion`, `releaseIdentity`, `checkedAt`, `error`, etc. The Git SHA is not used. This trusts GitHub's published-release API state; it does not verify release signatures or checksums. Cached (success ~6h, failure ~15min). Set **`CHECK_UPDATES=false`** (or `0`) to disable with no request. See [docs/UPDATING.md](docs/UPDATING.md#what-counts-as-an-available-update).

**Env vars (backend):**

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_GIT_SHA` | Optional revision provenance shown in Tools → About (short or full SHA). Not used for update checks. | `unknown` |
| `APP_BUILD_TIME` | Build timestamp (e.g. ISO or human-readable). | `unknown` |
| `APP_REPO` | GitHub repo whose published Releases are checked (e.g. `owner/repo`). | `bstrauss84/openshift-airgap-architect` |
| `APP_BRANCH` | Branch for documentation links. Configuration only — not shown as build provenance, not used for update checks. | `main` |
| `CHECK_UPDATES` | Set to `false` or `0` to disable update checks. | enabled |
| `AIRGAP_FETCH_USE_ENV_PROXY` | Set to `false` or `0` to disable undici `EnvHttpProxyAgent` for Node `fetch` (not usually needed). | enabled (proxy agent on) |
| `FEEDBACK_MODE` | Feedback mode: `disabled`, `github`, or `offline`. | `github` |
| `FEEDBACK_GITHUB_REPO` | Optional GitHub issue target override (`owner/repo`). | `APP_REPO` |

**Wiring examples:**

- **Podman Compose / Docker Compose:** The plain **`podman compose up --build -d`** / **`docker compose up --build -d`** is all that is required, including for update checks. Optionally, the backend image accepts **APP_GIT_SHA** as a **build-arg** (see `backend/Containerfile`) to record the revision: **`podman compose build --build-arg APP_GIT_SHA=$(git rev-parse HEAD)`** (or `docker compose build --build-arg ...`). **APP_BUILD_TIME** is computed automatically during the build. If you omit the build-arg (or build from a tarball without `.git`), the revision is unknown and Tools → About simply omits it. The application **version** and **build timestamp** are still shown, update checks still run, and a missing revision does not mean the build is a development build. For `docker run` / OpenShift without building from a clone, see **`scripts/set-build-env.sh`** to pass build args.

- **Docker / Podman run:** Pass at start:
  ```bash
  docker run -e APP_GIT_SHA=abc1234 -e APP_BUILD_TIME="2025-03-03 12:00" -e APP_REPO=bstrauss84/openshift-airgap-architect -e APP_BRANCH=main ...
  ```

- **OpenShift Deployment:** Add to the backend container spec:
  ```yaml
  env:
    - name: APP_REPO
      value: "bstrauss84/openshift-airgap-architect"
    - name: APP_BRANCH
      value: "main"
    - name: APP_GIT_SHA
      valueFrom:
        fieldRef:
          fieldPath: metadata.annotations['openshift.io/git-commit']
    # Or a fixed value / build-time substitution
    - name: APP_BUILD_TIME
      value: "2025-03-03"
  ```

**Git clone vs tarball:** When building from a **git clone**, you may pass `--build-arg APP_GIT_SHA=$(git rev-parse HEAD)` so Tools → About shows the commit. Builds from a **tarball or archive without `.git`** can pass the SHA manually or omit it (defaults to "unknown"). No git commands are run by the backend at runtime. For **docker run** or **OpenShift**, set **APP_GIT_SHA** and **APP_BUILD_TIME** at container start; optional helper **`scripts/set-build-env.sh`** prints `export` lines you can source or put in a `.env` file.

<a id="troubleshooting"></a>
## Troubleshooting

- **Build fails at `COPY … frontend/package.json …` with `checking on sources under "…/frontend": copier: stat: "/frontend/package.json": no such file or directory`** (or the same for `backend/package.json`) — the image was built with the `frontend/` (or `backend/`) folder as the **build context**. Both Containerfiles must be built from the **repository root**, because they copy from `frontend/`, `backend/`, `shared/` and `data/`. Use `podman build -f frontend/Containerfile .` (note the final `.`), or `podman compose up --build -d`, which sets this for you. In a pipeline or build service, set the context directory to the repository root (empty / `.`) and the Dockerfile path to `frontend/Containerfile` or `backend/Containerfile`. `frontend/Dockerfile` and `backend/Dockerfile` are legacy and unsupported: do not select them. No release changes this requirement.
- **Podman build fails before app startup with `open /etc/passwd: permission denied` (RHEL 9 / FIPS / hardened hosts)** — If this happens while pulling or unpacking UBI base images (before frontend/backend build steps), it is typically a **host Podman storage issue**, not an app logic issue. A common signature in `strace` is `quotactl(...PRJQUOTA...) = -1 EACCES` against `/var/lib/containers/storage/...` on XFS `prjquota` mounts. This is usually caused by host policy/agent restrictions on quota syscalls (for example endpoint security), not by the generated assets.
  - Confirm runtime first: use `podman compose up --build` (preferred) and verify `podman info` reports the expected graph root and overlay driver.
  - Treat SELinux as a separate control: if the same failure reproduces in permissive mode, SELinux is likely not the root cause for this specific error pattern.
  - Check hardened controls/agents (Trellix/McAfee or similar) and allowlist Podman/Buildah + `/var/lib/containers` paths; this is a frequent root cause of `quotactl(...)=EACCES` on hardened RHEL.
  - If policy cannot be changed quickly, move container storage to a filesystem/profile that does not block Podman quota operations (or remove the blocking project-quota policy on the storage path) and rebuild. Do **not** use `podman system reset` for this: it deletes every image, container and volume of that user (all projects) and can disrupt the rootless network of running containers. To start from an empty store, point Podman at a new `graphroot` instead and remove the old one only after the new deployment works.
  - `quotacheck` is not the right validation tool for XFS project quotas in this scenario; use `mount`, `xfs_quota`, `podman info`, and `strace` evidence instead.
- **"Blocked request. This host ("…") is not allowed"** — You are running the Vite dev server (e.g. in a container or locally) and opening the app using a hostname that Vite does not allow by default (for example an OpenShift Route hostname like `airgap-architect.cjmays.com`). Set the environment variable **`VITE_ALLOWED_HOSTS`** to that hostname so the dev server accepts the request. Example: `VITE_ALLOWED_HOSTS=airgap-architect.cjmays.com`. For multiple hostnames, use a comma-separated list with no spaces. See [Running behind a reverse proxy or OpenShift Route](#running-behind-a-reverse-proxy-or-openshift-route) for where to set it (Compose, OpenShift, Kubernetes, or local dev) and how to confirm the correct hostname.
- **"additional properties 'platform' not allowed"** — You're using the Python **`docker-compose`** with an old schema. Prefer **`podman compose`** so Podman doesn't delegate to `/usr/local/bin/docker-compose`; see [Quick start](#quick-start-container). On macOS, see also the compose-provider workaround in `docs/OPERATOR_SCAN_ARCHITECTURE_PLAN.md` or CONTRIBUTING.
- **"no such image" or "image not known" after build (Podman)** — With podman-compose 1.0.6 this usually means the **build failed** and compose went on to run an image that was never built. Build with `scripts/deploy/oaa-deploy.sh build`, which stops at the first failed build and says why, then `up`.
- **`unable to start unit "runc-buildah-….scope"` (build) or `"libpod-….scope"` (container start): Interactive authentication required** — rootless Podman without a usable systemd user session (`su` / `sudo -i`). Log in as that user directly (or have an administrator enable lingering). `podman --cgroup-manager=cgroupfs compose …` does **not** help: the option is not passed to the compose provider's own `podman` calls. A temporary, verified alternative is `scripts/deploy/oaa-deploy.sh write-cgroupfs-override ~/oaa-cgroupfs.conf`, `export CONTAINERS_CONF_OVERRIDE=~/oaa-cgroupfs.conf`, check `podman info --format '{{.Host.CgroupManager}}'` prints `cgroupfs`, then `up --recreate`. `scripts/deploy/oaa-deploy.sh preflight` blocks on this before building or starting; see [docs/ENTERPRISE_PODMAN_DEPLOYMENT.md](docs/ENTERPRISE_PODMAN_DEPLOYMENT.md#5-systemd-cgroups-sessions-and-rootless-networking).
- **Containers show `Up` but the UI or API does not answer** — rootless port forwarding can fail while the container runs; `scripts/deploy/oaa-deploy.sh verify` checks the published ports over HTTP and prints the container logs.
- **Port already in use** — Change `PORT` (backend) or the host port in `docker-compose.yml` (e.g. 4001:4000, 5174:5173).
- **Operator scan fails** — Ensure registry.redhat.io credentials are valid and mounted (or pasted in UI for that session). If the job fails with a message about the binary not running, the backend runtime architecture may not have a usable oc-mirror (e.g. Apple Silicon: use native aarch64 binary or set **OC_MIRROR_BIN** / **OC_MIRROR_URL**). See **Platform and architecture** above and `docs/OPERATOR_SCAN_ARCHITECTURE_PLAN.md`.
- **oc-mirror run fails with auth error** — Ensure the correct credentials are provided for the selected workflow. Mirror-to-disk needs a Red Hat pull secret (registry.redhat.io / quay.io); disk-to-mirror needs mirror registry credentials; mirror-to-mirror needs both. If using `REGISTRY_AUTH_FILE`, verify the file is mounted and accessible inside the container.
- **"EACCES: permission denied" in Browse directory or run logs** — Two causes on Fedora/RHEL/CentOS: (1) missing `:Z` SELinux label on the volume mount in `compose.override.yml` — add `:Z` to every bind-mount line and rebuild; (2) host directory created with `sudo` (owned by root) — fix with `sudo chown $USER /your/path`. See [Permissions and SELinux](#permissions-and-selinux-podman-on-fedorarhelcentos) for full details.
- **oc-mirror archives not found on host** — If using the default named volume, use `podman volume inspect openshift-airgap-architect_backend-data` (or `docker volume inspect`) to find the volume mountpoint on the host. For large mirrors, use `compose.override.yml` to bind-mount a host path instead; see [Mounting external storage for oc-mirror](#mounting-external-storage-for-oc-mirror-recommended-for-large-mirrors).
- **Cincinnati or docs stale** — Use **Update** (release channels) or **Update Docs Links** (field manual links) in the UI; the backend refreshes caches on demand.
- **Validation errors on a step** — Required fields are marked; check Identity & Access (pull secret, SSH key), Networking (CIDRs), and Platform Specifics for your scenario.
- **SELinux denials (Podman)** — Use `:Z` on volume mounts or adjust context as needed for your host.
- **Feedback not visible** — The feature is hidden when `FEEDBACK_MODE=disabled` or when running in a high-side/disconnected operating profile.

<a id="screenshots"></a>
## Screenshots

Captured from the running application (v2.2.0 development build, light theme, 1440 px wide). All names,
addresses and credentials shown are synthetic examples.

### Install

The wizard walks through Blueprint → Methodology → scenario-specific steps → Operators (optional) → Assets & Guide.

**Landing — Choose workflow.** Install (net-new disconnected install), Mirroring (oc-mirror content without an install), and Upgrade (coming soon).

![Landing page with the Install, Upgrade (coming soon) and Mirroring cards](docs/images/v2.2.0/landing.png)

**Blueprint — Foundational choices.** Target platform, CPU architecture, OpenShift release (channel and patch, 4.20–4.22 only; a newer upstream release such as 5.0 is named and refused), and an optional Red Hat pull secret. After you paste one, "Retain pull secret for use on subsequent pages" keeps it in memory for operator scans and Run oc-mirror without re-pasting.

![Blueprint step: Bare Metal, x86_64, stable-4.22 / 4.22.20 selected, the unsupported 5.0 notice and the pull secret field](docs/images/v2.2.0/blueprint.png)

**Methodology — Installer type.** IPI, UPI or Agent-Based Installer, limited to what the platform supports. The scenario summary above every step expands to show what will be generated.

![Methodology step with Agent-Based Installer selected](docs/images/v2.2.0/methodology.png)

**Identity & Access — Cluster identity and credentials.** Cluster name and base domain, the mirror registry pull secret (paste, upload or "Help me generate"; anonymous pulls are also possible), SSH public key (paste or generate), and FIPS mode. Credentials are not stored.

![Identity & Access step with a mirror registry enabled, a masked pull secret and an example SSH public key](docs/images/v2.2.0/identity-access.png)

**Mirror registry pull secret helper.** Builds the pull secret JSON in the browser from the registry address, user name and password; not stored or exported.

![Mirror registry pull secret helper with example values and the generated JSON](docs/images/v2.2.0/mirror-secret-helper.png)

**SSH keypair helper.** Generates a keypair; the private key must be saved immediately because it is not stored.

![Generate SSH keypair dialog before generating: key type and the save-now warning](docs/images/v2.2.0/ssh-keypair-helper.png)

**Networking — Machine, cluster and service networks.** IPv4, IPv6 or dual-stack; API and Ingress VIPs for bare metal.

![Networking step, IPv4 only, with API and Ingress VIPs](docs/images/v2.2.0/networking-ipv4.png)

![Networking step, dual-stack, with IPv6 networks and VIPs](docs/images/v2.2.0/networking-dualstack.png)

**Connectivity & Mirroring — Mirror mapping and NTP.** With a mirror registry: the local registry, source → mirror paths (pre-filled for the release repositories), and NTP servers for install-config and agent-config.

![Connectivity & Mirroring step with mirror paths for mirror.example.com:8443 and two NTP servers](docs/images/v2.2.0/connectivity-mirroring.png)

**Trust & Proxy — Corporate proxy and CA bundles.** HTTP/HTTPS proxy and no-proxy list, mirror and proxy CA bundles, trust bundle policy (Proxyonly / Always) and a trust analysis.

![Trust & Proxy step with the proxy enabled and the CA bundle fields](docs/images/v2.2.0/trust-proxy.png)

**Platform Specifics.** Changes by scenario: for Bare Metal Agent it holds the optional day-2 bare metal fields and the BMC CA certificate; for vSphere IPI the vCenter credentials, failure domains (datacenter, compute cluster, datastore, networks), storage and machine counts.

![Platform Specifics for Bare Metal Agent-Based](docs/images/v2.2.0/platform-specifics.png)

![Platform Specifics for vSphere IPI with a failure domain](docs/images/v2.2.0/platform-specifics-vsphere-ipi.png)

**Hosts / Inventory — Nodes (Agent-Based).** Commands to gather interface and disk facts from each machine, then node counts and a grid where each node opens in an editor (role, hostname, root device hints, network). Settings can be applied from one node to others.

![Hosts step: how to gather host information](docs/images/v2.2.0/hosts-instructions.png)

![Hosts step: node grid with master-0 open in the node editor](docs/images/v2.2.0/hosts-grid-edit.png)

![Apply settings to other nodes dialog](docs/images/v2.2.0/hosts-apply-settings-modal.png)

**Operators — Catalog strategy.** Scenario Quick Picks (here Virtualization and Local Storage), the selected operators with their packages and default channels, and the Red Hat, Certified and Community catalogs to browse and search. Scanning the catalogs needs registry.redhat.io credentials; once scanned, the listing is kept on the server and reused, as here (a cached listing of the Red Hat 4.22 catalogs from an earlier lab scan; no credential entered).

![Install Operators step: Virtualization and Local Storage Quick Picks applied, five selected operators and the Red Hat catalog](docs/images/v2.2.0/operators-install.png)

**Assets & Guide — Export and previews.** Export options per credential class, then previews of install-config.yaml, agent-config.yaml, imageset-config.yaml and the Field Manual; Download Bundle.

![Assets & Guide: export options and the install-config.yaml preview](docs/images/v2.2.0/assets-and-guide.png)

**imageset-config.yaml** (generated for mirroring): platform channel and version range, architectures, update graph and operators.

![imageset-config.yaml preview for stable-4.22, 4.22.20](docs/images/v2.2.0/imageset-config-preview.png)

**Tools.** Home, light/dark theme, Export Run / Import Run (credentials excluded), Start Over and About.

![Tools drawer](docs/images/v2.2.0/tools-menu.png)

<a id="screenshots-mirroring"></a>
### Mirroring

How to use it: [Mirroring workflow](#mirroring-workflow) and the user guide in [docs/MIRRORING_WORKFLOW.md](docs/MIRRORING_WORKFLOW.md#part-a--user-guide). The run and transfer records below come from a lab run of the exact oc-mirror 4.22.19 against synthetic registries, not from a customer environment.

**Profiles and overview.** Each profile has its own content, OpenShift release, storage and history. The overview states what is included, the status in words and anything still to fix; the content tabs and Run & transfers sit below it.

![Mirroring: profile list and the overview of "Edge site — OpenShift 4.22" with the Platform tab](docs/images/v2.2.0/mirroring-overview.png)

**Platform — release and lock.** The same release selector as Install, per profile. Lock holds the release steady while you build the rest of the profile.

![Mirroring Platform tab with release 4.22.20 locked](docs/images/v2.2.0/mirroring-platform.png)

**Operators — catalogs, Quick Picks, selection.** Catalog discovery (scan once per minor), the shared Scenario Quick Picks, the catalog browser with search, and the Selected list with each operator's live catalog check status.

![Mirroring Operators tab: Virtualization and Local Storage Quick Picks applied, the Red Hat catalog and five selected operators](docs/images/v2.2.0/mirroring-operators.png)

**Additional images.** Any image references, one per row or several at once.

![Mirroring Additional images tab with two images](docs/images/v2.2.0/mirroring-additional-images.png)

**Show YAML — DRAFT and validated preview.** While a profile still has items to fix (here: the release is not locked yet), the drawer shows a DRAFT of the ImageSetConfiguration with the blockers and a Go to button; it cannot be downloaded. Once the profile is ready, the validated file is shown, checked against the oc-mirror v2 schema and the scanned catalogs, and Download saves exactly that file.

![YAML drawer showing a DRAFT ImageSetConfiguration and the blocker "Lock the selected OpenShift release"](docs/images/v2.2.0/mirroring-imageset-draft.png)

![YAML drawer showing the validated ImageSetConfiguration for release 4.22.20 with Download](docs/images/v2.2.0/mirroring-imageset-preview.png)

**Run & transfers — choose the workflow.** Mirror to disk → Prepare transfer → carry across → Receive transfer → Disk to mirror, or Mirror to mirror; the five steps show where the profile is.

![Workflow chooser with the five transfer steps and Mirror to mirror selected](docs/images/v2.2.0/mirroring-workflow-chooser.png)

**Credentials and destination.** The Red Hat pull secret for the source, the destination registry, and destination credentials (or anonymous access). Credentials are used for this run only and never stored.

![Credentials and destination card: empty pull secret, destination mirror.example.com:8443/ocp4, masked destination credentials](docs/images/v2.2.0/mirroring-run-destination.png)

![Help me generate for destination registry credentials](docs/images/v2.2.0/mirroring-registry-credential-helper.png)

**Preflight and run.** Preflight first; the run starts only when nothing blocks it.

![Preflight and run card for mirror to mirror](docs/images/v2.2.0/mirroring-run-preflight.png)

**Prepare the transfer (connected side).** After a mirror to disk: checksums, the exact configuration and provenance written next to the archives.

![Prepare the transfer card showing a ready transfer](docs/images/v2.2.0/mirroring-prepare-transfer.png)

**Operations.** Every run, transfer, receipt and catalog check, newest first. Selecting one shows its outcome, the oc-mirror build that ran, the plan and configuration checksums, archive files with sizes and SHA-256, the command (credentials file never shown), related operations and the output; the log can be downloaded. Shown here: the lab mirror to disk behind the transfer above.

![Mirroring Operations with a completed mirror to disk selected: details, archive checksum, command and oc-mirror output](docs/images/v2.2.0/mirroring-operations.png)

**Receive transfer (disconnected side).** Name the folder the files were copied to; every file is checked before anything is loaded.

![Receive a transfer dialog](docs/images/v2.2.0/mirroring-receive-transfer.png)

**Received profile and disk to mirror.** The received profile is read-only; the received transfers list shows what was verified and how this server's oc-mirror compares with the build that made the archives ("same executable … not a FIPS or suitability statement").

![Disconnected side: the received profile with disk to mirror as the next step](docs/images/v2.2.0/mirroring-disconnected-overview.png)

![Received transfers card: verified plan and the oc-mirror build comparison](docs/images/v2.2.0/mirroring-received-transfers.png)

![Preflight and run card for disk to mirror](docs/images/v2.2.0/mirroring-disk-to-mirror-run.png)

**Dark theme.**

![Mirroring overview in the dark theme](docs/images/v2.2.0/mirroring-overview-dark.png)

<a id="architecture"></a>
## Architecture

- **Frontend:** React, Vite, PatternFly-derived styling. Container image: Red Hat UBI 9 Node.js 22.
- **Backend:** Node.js, Express, SQLite (state and job history). Container image: Red Hat UBI 9 Node.js 22; runs as non-root (UID 1001) via entrypoint that chowns the data volume then drops to `appuser`; build-info stage uses UBI 9 minimal. `oc` and `oc-mirror` are resolved at build time from their respective Red Hat channels — no z-stream is hardcoded — and each is verified against that channel's own `sha256sum.txt` for the build architecture. See [Tool version policy](#platform-and-architecture-multi-arch--apple-silicon).
- **Data:** Parameter catalogs and doc index under `data/params` and `data/docs-index`; frontend copies under `frontend/src/data` for the build. See `docs/DATA_AND_FRONTEND_COPIES.md`.

<a id="install-config-references-420421422"></a>
<a id="install-config-references-420421"></a>
## Install-config references (4.20/4.21/4.22)

Use these official docs to validate `install-config.yaml` for supported platforms:

**OpenShift 4.22:**

- [AWS GovCloud](https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/html/installing_on_aws/installation-config-parameters-aws)
- [Azure Government](https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/html/installing_on_azure/installation-config-parameters-azure)
- [VMware vSphere](https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/html/installing_on_vmware_vsphere/installation-config-parameters-vsphere)
- [Nutanix](https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/html/installing_on_nutanix/installation-config-parameters-nutanix)
- [Agent-based Installer](https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/html/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent)

**OpenShift 4.21:**

- [AWS GovCloud](https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/installing_on_aws/installation-config-parameters-aws)
- [Azure Government](https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/installing_on_azure/installation-config-parameters-azure)
- [VMware vSphere](https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/installing_on_vmware_vsphere/installation-config-parameters-vsphere)
- [Nutanix](https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/installing_on_nutanix/installation-config-parameters-nutanix)
- [Agent-based Installer](https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent)

**OpenShift 4.20:**

- [AWS GovCloud](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_aws/installation-config-parameters-aws)
- [Azure Government](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_azure/installation-config-parameters-azure)
- [VMware vSphere](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_vmware_vsphere/installation-config-parameters-vsphere)
- [Nutanix](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_nutanix/installation-config-parameters-nutanix)
- [Agent-based Installer](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent)

Notes: `credentialsMode` and `publish` apply to cloud (AWS/Azure). For vSphere, Nutanix, and bare metal agent-based installs, see the platform-specific docs for required and optional fields.

<a id="release-history"></a>
<a id="release-notes"></a>
## Release history

| Where to look | What it covers |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | Every release, newest first — features, fixes and breaking changes |
| [v2.2.1 release notes](docs/releases/v2.2.1.md) | Patch: Mirroring runs work in the backend container again (v2.2.0 known issue: `EACCES` on the bundled oc-mirror); certification checks the final image as its application user; release-closeout verification |
| [v2.2.0 release notes](docs/releases/v2.2.0.md) | Minor: the Mirroring workflow — oc-mirror profiles, three workflows, verified connected → disconnected transfer, Operations |
| [v2.1.2 release notes](docs/releases/v2.1.2.md) | Patch: per-file Download and runtime-package credential-exposure fixes, export switches that work, IPv6 rendezvousIP, Field Guide VIP guidance |
| [v2.1.1 release notes](docs/releases/v2.1.1.md) | Patch: restored update notifications, truthful build identity, corrected repository URL |
| [v2.1 release notes](docs/releases/v2.1.0.md) | OpenShift 4.22 support, operator preset corrections, version-transition safety |
| [v2.0 release notes](docs/releases/v2.0.0.md) | The version-awareness rebuild; OpenShift 4.20 and 4.21 support |
| [Migration guide: v1.x → v2.0](docs/MIGRATION_GUIDE_v1_to_v2.md) | What changes when upgrading from v1.x |
| [SBOM and provenance](docs/security/SBOM_AND_PROVENANCE.md) | Software bill of materials, vulnerability evidence and signing — what is generated, what is attached to a release, and how to verify it |
| [Release-history evidence](docs/releases/evidence/README.md) | The commit-by-commit audit behind these notes |

**Supported OpenShift versions:** 4.20 (baseline), 4.21, 4.22. Later releases are
rejected deterministically rather than approximated — see the v2.1 notes for why.

**Downloadable releases:** published releases, with their source snapshot, SBOMs,
vulnerability evidence and a `SHA256SUMS` covering all of them, are listed on the
[Releases page](https://github.com/bstrauss84/openshift-airgap-architect/releases).
A git tag on its own is not a release — if a version is not listed there, no assets
were published for it. [SBOM and provenance](docs/security/SBOM_AND_PROVENANCE.md)
describes each asset and how to verify it.

**No container images are published.** This project is distributed as source: you
build the two images locally with `docker compose build` / `podman compose build`.
There is no registry to pull from.

### At a glance

- **v2.2.1** — Patch release: fixes the v2.2.0 known issue — every Mirroring run failed in the backend container with `EACCES` on the bundled oc-mirror (installed 0751, unreadable by the non-root backend user); now root-owned 0755. Adds a certification check of the final image as its application user and live release-closeout verification. Rebuild your images to get the fix.
- **v2.2.0** — Minor release: adds the Mirroring workflow — independent oc-mirror v2 profiles for the OpenShift release, operators and additional images; mirror to disk, a verified connected → disconnected transfer, disk to mirror, and mirror to mirror; Operations history. Lab-tested with the real oc-mirror against synthetic registries; customer acceptance pending at release.
- **v2.1.2** — Patch release: fixes two export paths that could include excluded credentials (per-file YAML Download; the hidden runtime package), makes the Proxy values and SSH public key switches work, and corrects IPv6-only rendezvousIP, Field Guide VIP checks, documentation links and the post-import notice. Securely delete and rotate credentials in affected files from earlier versions.
- **v2.1.1** — Patch release: restores update notifications (based on published releases, no Git revision required), reports build identity truthfully, and corrects the repository URL in generated files. Existing v2.1.0 installations may not detect it automatically.
- **v2.1.0** — OpenShift 4.22 support, with per-version parameter catalogs, Field Guide and documentation. Adds the bare-metal provisioning network gateway setting, enforces supported CPU architectures at generation, and makes operator presets version-aware.
- **v2.0.0** — Version-awareness architecture complete. Supports OpenShift 4.20 (baseline) and 4.21, with version-specific parameter catalogs, Field Guide content and metadata-driven annotations. Tagged 2026-10-06.
- **v1.7.1** — Last v1.x release (2026-05-29). It is preserved as the legacy v1.x
  line; see the Releases page for which version `main` currently carries.

**Version identity:** the application-code version does not by itself imply
enterprise/customer-distribution readiness, security certification, signed/SBOM/provenance
completion, immutable disconnected bundle availability, hosted multi-user readiness, ATO,
or compliance readiness. Those gates are tracked separately under PROD-041 and its
productization/security children.

<a id="license-and-contributing"></a>
## License and contributing

See the repository license file. Contributions are welcome; please read `docs/CONTRIBUTING.md` and `docs/CODE_STYLE_RULES.md` before opening a pull request.

<a id="documentation-and-governance-map"></a>
## Documentation and governance map

For canonical process and policy ownership:

- `docs/INDEX.md` — authority map for docs and working artifacts
- `docs/SCENARIOS_GUIDE.md` — scenario-specific navigation hub and working-doc map
- `docs/BACKLOG_STATUS.md` — canonical backlog and status registry
- `docs/HELPER_USAGE.md` — helper/agent selection and usage
- `AI_GOVERNANCE.md` — AI-assistance governance and compliance policy
