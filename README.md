# OpenShift Airgap Architect

A local-first wizard that generates OpenShift disconnected (air-gapped) installation assets. It runs entirely on your machine using Docker or Podman—no data is sent to external services except when you explicitly trigger operator discovery or release-channel updates.

## What it is

OpenShift Airgap Architect guides you through scenario-based configuration (Bare Metal Agent-Based, Bare Metal IPI/UPI, VMware vSphere, AWS GovCloud, Azure Government, Nutanix) and produces:

- **install-config.yaml** — Installer input for your chosen platform
- **agent-config.yaml** — For Bare Metal + Agent-Based Installer only
- **imageset-config.yaml** — oc-mirror v2 format for mirroring release and operator content
- **FIELD_MANUAL.md** — A tailored markdown guide with version-specific notes and doc links
- **NTP MachineConfigs** — When NTP servers are set (e.g. `99-chrony-ntp-master.yaml`, `99-chrony-ntp-worker.yaml`)

The app uses official OpenShift 4.17–4.20 parameter catalogs and aligns generated YAML with the docs for the selected version.

## Who it's for

- Platform engineers and SREs planning disconnected or restricted-network OpenShift installs
- Anyone who wants a single place to configure cluster identity, networking, mirroring, trust bundles, and platform-specific settings before running the installer or oc-mirror
- Teams that need repeatable, documented config generation without storing credentials in the app

## Key features

- **Scenario-driven UI** — Pick install method (e.g. Agent-Based, vSphere IPI); the wizard shows only relevant steps and fields
- **Version-aware** — Cincinnati channels and patch selection; generated assets match the chosen OCP version (4.17–4.20)
- **Credentials-safe** — Pull secrets and BMC/vCenter-style credentials are not persisted by default; optional export with explicit inclusion. Helpers generate pull secrets and SSH keypairs locally and are not stored (see [Identity & Access](#screenshots) and [Mirror secret helper](#screenshots)).
- **Operator discovery** — Optional scan of certified/community/Red Hat operators via `oc-mirror list operators` (requires registry.redhat.io auth)
- **Trust and proxy** — additionalTrustBundle and proxy settings with version-appropriate policy (e.g. Proxyonly / Always)
- **Export options** — Choose whether to include credentials, certificates, client tools, and openshift-install in the run bundle

## Quick start (container)

**Docker:**

```bash
docker compose up --build
```

**Podman:** Use **`podman compose`** (Compose V2), the same `docker-compose.yml` (one file for both Docker and Podman); so build and run use the same daemon and you avoid “image not known” after build:

```bash
podman compose up --build
```

If your system only has `podman-compose` (Python), use that; the project does not ship a separate `podman-compose.yml`.

Then open the UI at **http://localhost:5173** (ports are bound to localhost by default; see [Container run](#container-run) to change that).

### SELinux (Podman on Fedora/RHEL)

If you mount files or folders with Podman, add `:Z` or `:z` to volume mounts as needed.

## Local development

- **Backend:** `cd backend && npm install && npm run dev` (or start via your IDE). Set `DATA_DIR` if you want state outside `./data` (e.g. `backend/data`).
- **Frontend:** `cd frontend && npm install && npm run dev`. Vite serves the UI; point it at the backend (default `http://localhost:4000` via `VITE_API_BASE`).
- **Tests:** `npm test` in `backend/` and `frontend/`. See `docs/CONTRIBUTING.md` for contribution and test conventions.

The backend uses SQLite for state and job history; the frontend uses React + Vite.

## Running without Compose

If you prefer not to use Docker Compose or Podman Compose, you can run the frontend and backend yourself on the host.

1. **Backend** (Node 20+):
   ```bash
   cd backend && npm install && npm run dev
   ```
   The API listens on `http://localhost:4000` by default. Set `DATA_DIR` if you want state in a specific directory (e.g. `./data`).

2. **Frontend** (Node 20+):
   ```bash
   cd frontend && npm install && npm run dev
   ```
   Set `VITE_API_BASE=http://localhost:4000` if your backend is elsewhere. The UI is served at `http://localhost:5173`.

3. Open **http://localhost:5173** in a browser. The frontend will call the backend at the URL configured by `VITE_API_BASE`.

Operator scan and bundle generation (including oc/oc-mirror binaries) require the same backend environment (Node, oc-mirror resolution, `DATA_DIR`) as when run via Compose; only the process manager differs.

## Container run

The stack is two services (frontend, backend). Ports in `docker-compose.yml` are bound to **127.0.0.1** by default so the app is not exposed on the LAN. To allow access from other machines, change the left side of the port mapping to `0.0.0.0` (e.g. `"0.0.0.0:5173:5173"`).

- **Frontend:** 5173 (Vite dev server in container; binds to `0.0.0.0` inside the container via `--host 0.0.0.0`)
- **Backend:** 4000 (Express API)
- **State:** Backend uses a named volume for SQLite; run bundles and temp files are under that data path.

### Container images and security (UBI, non-root)

Both containers use **Red Hat UBI 9** images and run the application **non-root** where possible:

- **Frontend:** UBI 9 Node.js 20; app runs as UID 1001. No writable volume; no root needed.
- **Backend:** UBI 9 Node.js 20; the **Node process runs as UID 1001** (user `appuser` in the image). The mounted data volume (`/data`) must be writable by that user. The backend image uses an **entrypoint script** that:
  1. Runs initially as root (only to fix volume permissions).
  2. Runs `chown -R 1001:0` on `DATA_DIR` (default `/data`) so the volume is writable by the app user.
  3. Drops to UID 1001 via `runuser` and starts the Node server.

So the backend does **not** run the application as root; root is used only briefly at container start to set ownership on the mounted volume. If the volume is already writable by 1001 (e.g. first run after a clean volume, or a volume you pre-created with the right ownership), the chown is a no-op and the process still drops to 1001. This matches common practice for secure container workloads. The image installs `util-linux` (for `runuser`) and creates a system user `appuser` with UID 1001 so the drop works correctly. See `backend/scripts/entrypoint.sh` and `docs/POST_UBI_VERIFICATION.md` for details and troubleshooting.

### Same-host vs remote access

- **Same-host:** Using the app on the same machine where Compose runs: leave `VITE_API_BASE` as `http://localhost:4000`. The frontend is built with this URL, so the browser (on the same host) can reach the backend at localhost:4000.
- **Remote access:** To use the UI from another machine (e.g. laptop to dev server), (1) expose ports on the host by changing port mappings to `0.0.0.0:5173:5173` and `0.0.0.0:4000:4000`, and (2) set `VITE_API_BASE` to the URL where the backend is reachable from the **client** browser (e.g. `http://<host-ip-or-name>:4000`). The frontend container reads this at startup; if you keep `VITE_API_BASE=http://localhost:4000`, API calls from a remote browser will go to the client’s localhost and fail. Override the env when starting the stack (e.g. `VITE_API_BASE=http://192.168.1.10:4000 docker compose up`) or in a compose override file.

### Running behind a reverse proxy or OpenShift Route

When users reach the app through a **different hostname** than the one the frontend container uses internally (for example an OpenShift Route like `https://airgap-architect.example.com`, or an nginx/HAProxy hostname), the Vite dev server will block requests unless that hostname is explicitly allowed.

**Why this happens:** The browser sends the external hostname in the HTTP `Host` header. Vite only accepts a limited set of hosts by default (e.g. `localhost`) to reduce certain security risks. Any other host is rejected with a message like: *"Blocked request. This host ("airgap-architect.example.com") is not allowed."*

**What you need to do:**

1. **Set `VITE_ALLOWED_HOSTS`** to the exact hostname (or hostnames) that users type in the browser.
   - **One host:** `VITE_ALLOWED_HOSTS=airgap-architect.example.com`
   - **Several hosts:** Comma-separated, no spaces: `VITE_ALLOWED_HOSTS=app.example.com,airgap-architect.example.com`
   - Use the same value that appears in the browser’s address bar (including subdomain). Do not include `https://` or a path—only the hostname.

2. **Where to set it** depends on how you run the app:
   - **Docker Compose / Podman Compose:** Add to the `frontend` service in `docker-compose.yml` under `environment`, or pass it when starting:  
     `VITE_ALLOWED_HOSTS=airgap-architect.example.com docker compose up --build`
   - **OpenShift (Deployment, DeploymentConfig, etc.):** Add an environment variable to the **frontend** container spec:
     - **Name:** `VITE_ALLOWED_HOSTS`
     - **Value:** The hostname of your Route (e.g. `airgap-architect.cjmays.com`). You can find it in the OpenShift console under **Networking → Routes** for your app, or in the Route’s **Host** field.
   - **Kubernetes:** Set `VITE_ALLOWED_HOSTS` in the frontend Pod/Deployment’s env (e.g. `env` or `envFrom`).
   - **Local dev (npm run dev):** Export before starting, e.g.  
     `export VITE_ALLOWED_HOSTS=my-app.mycompany.com` then `npm run dev`, or pass inline: `VITE_ALLOWED_HOSTS=my-app.mycompany.com npm run dev`.

3. **If the UI still can’t reach the backend**, you are likely using a reverse proxy or Route for the **frontend** only. The browser then needs to call the backend at a URL it can reach (often the same host with a path, or a separate backend host). Set **`VITE_API_BASE`** to that URL (e.g. `https://airgap-architect.example.com/api` if your proxy forwards `/api` to the backend, or `https://airgap-architect-backend.example.com` if the backend has its own hostname). The frontend container reads both `VITE_ALLOWED_HOSTS` and `VITE_API_BASE` at startup; rebuild or restart the frontend after changing them.

4. **Security note:** Only add hostnames you control and that users are supposed to use. Leaving `VITE_ALLOWED_HOSTS` unset is safe for local use (localhost remains allowed). For production-like deployments behind a proxy or Route, setting it to your actual hostname(s) is the intended approach.

## Updating the app

When the Landing page or **Tools → About** shows that an update is available, follow **[docs/UPDATING.md](docs/UPDATING.md)** for your deployment. Build info and update checks depend on how the image was built (see [Build info and update checks](#build-info-and-update-checks)); builds from a git clone get real SHA/time; builds from a tarball without `.git` show “unknown” and cannot report update availability.

## Generating assets

1. Complete the wizard (Blueprint → Methodology → scenario steps → Operators if desired → Assets & Guide).
2. On the **Assets & Guide** step, use **Export** to download a run bundle (ZIP) containing generated YAML and the field manual. Export options control inclusion of credentials, certificates, and client tools.
3. **install-config.yaml** and **agent-config.yaml** (when applicable) are also available as inline copy/download from the same step.
4. Use **Update Docs Links** to refresh cached documentation links used in the field manual.

## Operator workflows

- **Operator scan** uses `oc-mirror list operators` and requires valid **registry.redhat.io** credentials.
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

## Mock mode (offline demo)

With no registry access, run with bundled Cincinnati and operator data:

```bash
MOCK_MODE=true docker compose up --build
```

## Platform and architecture (Apple Silicon / non-x86_64)

**Operators scan** uses a local **oc-mirror** binary inside the backend container. The binary is chosen to match the **backend container runtime architecture** (not the Blueprint/target cluster architecture). The default backend image bakes in **x86_64** `oc`/`oc-mirror`, so **Operator scan works out of the box on amd64/x86_64 Linux**. On **Apple Silicon (aarch64)** the backend runs natively as arm64; the app can auto-download native aarch64 binaries from the OpenShift mirror, or you can provide your own via **`OC_MIRROR_BIN`** or **`OC_MIRROR_URL`** (overrides, not required for standard x86_64 users).

- **Mirror path pattern:** `https://mirror.openshift.com/pub/openshift-v4/<arch>/clients/ocp/latest/` (e.g. `oc-mirror.tar.gz`, `openshift-client-linux.tar.gz`). Supported `<arch>`: x86_64, amd64, aarch64, arm64, ppc64le, s390x.
- **Apple Silicon:** Prefer a **native aarch64** oc-mirror (auto-download or mount a binary and set **`OC_MIRROR_BIN=/opt/tools/oc-mirror`**). Do not use forced linux/amd64 emulation; it was removed because oc-mirror segfaults under emulation.
- **Export bundle:** The Assets step can include oc/oc-mirror in the download bundle; you can select which **architecture** to include (default: reuse the backend's local binaries when the selected arch matches). That selection does not change the backend's Operators scan binary.

See **`docs/OPERATOR_SCAN_ARCHITECTURE_PLAN.md`** for root cause, design, and Podman/macOS notes.

## Build info and update checks

The **Tools → About** panel shows build info (Git SHA, build time, repo, branch) and update status. The backend exposes:

- **`GET /api/build-info`** — Returns `gitSha`, `buildTime`, `repo`, `branch` from env (no git at runtime).
- **`GET /api/update-info`** — When update checks are enabled, compares `APP_GIT_SHA` to the latest commit on the configured branch and returns `enabled`, `isOutdated`, `currentSha`, `latestSha`, `checkedAt`, `error`, etc. Cached (success ~6h, failure ~15min). Set **`CHECK_UPDATES=false`** (or `0`) to disable.

**Env vars (backend):**

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_GIT_SHA` | Git commit SHA of the running build (short or full). | `unknown` |
| `APP_BUILD_TIME` | Build timestamp (e.g. ISO or human-readable). | `unknown` |
| `APP_REPO` | GitHub repo for update check (e.g. `owner/repo`). | `bstrauss84/openshift-airgap-architect` |
| `APP_BRANCH` | Branch to compare against (e.g. `main`). | `main` |
| `CHECK_UPDATES` | Set to `false` or `0` to disable update checks. | enabled |

**Wiring examples:**

- **Podman Compose / Docker Compose:** The backend image computes **APP_GIT_SHA** and **APP_BUILD_TIME** from **.git** during the image build (see `backend/Containerfile`). Run **`podman compose up --build`** from a **git clone** (with `.git` present) and Tools → About will show the current commit and build time. **If you build from a tarball or snapshot that has no `.git` directory**, the image cannot determine build SHA or time, so Tools → About will show “Build unknown • unknown • main” and update availability cannot be determined (update check will show as unavailable). That is expected behavior, not a bug. For `docker run` / OpenShift without building from a clone, see **`scripts/set-build-env.sh`** to pass build args.

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

**Git clone vs tarball:** Builds from a normal **git clone** (with `.git`) get real build SHA and time; Tools → About and update checks work as intended. Builds from a **tarball or archive without `.git`** get “unknown” build info and cannot determine update availability; that is expected. No git commands are run by the backend at runtime. For **docker run** or **OpenShift**, set **APP_GIT_SHA** and **APP_BUILD_TIME** at container start; optional helper **`scripts/set-build-env.sh`** prints `export` lines you can source or put in a `.env` file.

## Troubleshooting

- **"Blocked request. This host ("…") is not allowed"** — You are running the Vite dev server (e.g. in a container or locally) and opening the app using a hostname that Vite does not allow by default (for example an OpenShift Route hostname like `airgap-architect.cjmays.com`). Set the environment variable **`VITE_ALLOWED_HOSTS`** to that hostname so the dev server accepts the request. Example: `VITE_ALLOWED_HOSTS=airgap-architect.cjmays.com`. For multiple hostnames, use a comma-separated list with no spaces. See [Running behind a reverse proxy or OpenShift Route](#running-behind-a-reverse-proxy-or-openshift-route) for where to set it (Compose, OpenShift, Kubernetes, or local dev) and how to confirm the correct hostname.
- **“additional properties 'platform' not allowed”** — You’re using the Python **`docker-compose`** with an old schema. Prefer **`podman compose`** so Podman doesn’t delegate to `/usr/local/bin/docker-compose`; see [Quick start](#quick-start-container). On macOS, see also the compose-provider workaround in `docs/OPERATOR_SCAN_ARCHITECTURE_PLAN.md` or CONTRIBUTING.
- **“no such image” or “image not known” after build (Podman)** — Use **`podman compose`** for the whole workflow. If it still happens, try a clean rebuild: `podman compose down`, `podman rmi localhost/openshift-airgap-architect-backend:latest` (if it exists), then `podman compose up --build`.
- **Port already in use** — Change `PORT` (backend) or the host port in `docker-compose.yml` (e.g. 4001:4000, 5174:5173).
- **Operator scan fails** — Ensure registry.redhat.io credentials are valid and mounted (or pasted in UI for that session). If the job fails with a message about the binary not running, the backend runtime architecture may not have a usable oc-mirror (e.g. Apple Silicon: use native aarch64 binary or set **OC_MIRROR_BIN** / **OC_MIRROR_URL**). See **Platform and architecture** above and `docs/OPERATOR_SCAN_ARCHITECTURE_PLAN.md`.
- **Cincinnati or docs stale** — Use **Update** (release channels) or **Update Docs Links** (field manual links) in the UI; the backend refreshes caches on demand.
- **Validation errors on a step** — Required fields are marked; check Identity & Access (pull secret, SSH key), Networking (CIDRs), and Platform Specifics for your scenario.
- **SELinux denials (Podman)** — Use `:Z` on volume mounts or adjust context as needed for your host.

## Screenshots

The wizard walks through Blueprint → Methodology → scenario-specific steps → Operators (optional) → Assets & Guide. Below are key screens in order.

**Landing — Choose workflow.** Install (net-new disconnected), Upgrade (coming soon), or Operator mirroring (coming soon).

![Landing page: Install, Upgrade, Operator mirroring cards](docs/images/landing.png?v=2)

**Blueprint — Foundational choices.** Target platform, CPU architecture, OpenShift release (channel + patch), and Red Hat pull secret.

![Blueprint: platform, architecture, release, pull secret](docs/images/blueprint.png?v=2)

**Methodology — Scenario summary and installer type.** After lock-in, the scenario summary shows what will be generated; you pick IPI, UPI, or Agent-Based Installer.

![Methodology: scenario summary and installation type](docs/images/methodology.png)

**Identity & Access — Cluster identity and credentials.** Base domain, cluster name, mirror registry pull secret (paste/upload or generate via helper), SSH key (paste or generate keypair), and FIPS mode. Credentials are not stored by default.

![Identity & Access: cluster identity, pull secret, SSH key, FIPS](docs/images/identity-access.png)

**Mirror registry pull secret helper.** Generates pull secret JSON locally from registry FQDN and credentials; not stored or exported.

![Mirror registry pull secret helper](docs/images/mirror-secret-helper.png)

**SSH keypair helper.** Generate a keypair locally; the app reminds you to save the private key — it is not stored.

![Generate SSH keypair helper](docs/images/ssh-keypair-helper.png)

**Networking — Machine, cluster, and service CIDRs.** IPv4 by default; enable IPv6 for dual-stack and optional cluster/service IPv6 fields.

![Networking: IPv4 only](docs/images/networking-ipv4.png)

![Networking: dual-stack with IPv6](docs/images/networking-dualstack.png)

**Connectivity & Mirroring — Local registry and NTP.** Mirror mapping (source → mirror paths) and NTP servers for install-config and agent-config.

![Connectivity & Mirroring: mirror paths and NTP](docs/images/connectivity-mirroring.png)

**Trust & Proxy — Corporate proxy and CA bundles.** Optional proxy (HTTP/HTTPS/noProxy); mirror and proxy CA bundles; trust bundle policy (Proxyonly / Always).

![Trust & Proxy: proxy and CA bundles](docs/images/trust-proxy.png)

**Platform Specifics — Advanced options.** Boot artifact URI, hyperthreading, capabilities, CPU partitioning, minimal ISO, and other scenario-specific options.

![Platform Specifics: advanced options](docs/images/platform-specifics.png)

**Platform Specifics — vSphere IPI.** The step changes by scenario; for vSphere IPI it shows vCenter server, datacenter, datastore, optional compute cluster and VM network, failure domains, and credentials.

![Platform Specifics: vSphere IPI](docs/images/platform-specifics-vsphere-ipi.png)

**Hosts / Inventory — Bare metal nodes (Agent-Based).** Instructions to gather host info (interfaces, disks), then set node counts and edit each host (role, root device, network, bond/VLAN). You can apply settings from one node to others.

![Hosts: how to gather host info](docs/images/hosts-instructions.png)

![Hosts: node grid and edit panel](docs/images/hosts-grid-edit.png)

![Apply settings to other nodes](docs/images/hosts-apply-settings-modal.png)

**Operators — Catalog strategy and discovery.** Scenario Quick Picks (e.g. Virtualization, GitOps), selected operators, and available catalogs. Enable discovery and run Scan / Update Operators to populate from registry.redhat.io.

![Operators: quick picks and selected operators](docs/images/operators-quick-picks.png)

![Operators: discovery and scan](docs/images/operators-discovery.png)

**Assets & Guide — Export and previews.** Export options (credentials, certificates, oc/oc-mirror, openshift-install), architecture choice for bundle binaries, and previews of install-config.yaml, agent-config.yaml, imageset-config.yaml, and the Field Manual.

![Assets & Guide: export options and install-config preview](docs/images/assets-and-guide.png)

**imageset-config.yaml** (generated for mirroring): platform channel/version and operator packages/channels.

![imageset-config.yaml preview](docs/images/imageset-config-preview.png)

**Tools menu.** Theme (dark mode), Export Run / Import Run, Open Operations (background jobs), and Start Over.

![Tools: theme, export/import, operations, start over](docs/images/tools-menu.png)

## Architecture

- **Frontend:** React, Vite, PatternFly-derived styling. Container image: Red Hat UBI 9 Node.js 20.
- **Backend:** Node.js, Express, SQLite (state and job history). Container image: Red Hat UBI 9 Node.js 20; runs as non-root (UID 1001) via entrypoint that chowns the data volume then drops to `appuser`; build-info stage uses UBI 9 minimal. oc/oc-mirror are installed in-image from the OpenShift mirror.
- **Data:** Parameter catalogs and doc index under `data/params` and `data/docs-index`; frontend copies under `frontend/src/data` for the build. See `docs/DATA_AND_FRONTEND_COPIES.md`.

## Install-config references (4.20)

Use these official docs to validate `install-config.yaml` for supported platforms:

- [AWS GovCloud](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_aws/installation-config-parameters-aws)
- [Azure Government](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_azure/installation-config-parameters-azure)
- [VMware vSphere](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_vmware_vsphere/installation-config-parameters-vsphere)
- [Nutanix](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_nutanix/installation-config-parameters-nutanix)
- [Agent-based Installer](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent)

Notes: `credentialsMode` and `publish` apply to cloud (AWS/Azure). For vSphere, Nutanix, and bare metal agent-based installs, see the platform-specific docs for required and optional fields.

## License and contributing

See the repository license file. Contributions are welcome; please read `docs/CONTRIBUTING.md` and `docs/CODE_STYLE_RULES.md` before opening a pull request.
