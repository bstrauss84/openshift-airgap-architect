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
- **Credentials-safe** — Pull secrets and BMC/vCenter-style credentials are not persisted by default; optional export with explicit inclusion
- **Operator discovery** — Optional scan of certified/community/Red Hat operators via `oc-mirror list operators` (requires registry.redhat.io auth)
- **Trust and proxy** — additionalTrustBundle and proxy settings with version-appropriate policy (e.g. Proxyonly / Always)
- **Export options** — Choose whether to include credentials, certificates, client tools, and openshift-install in the run bundle

## Quick start (container)

**Docker:**

```bash
docker compose up --build
```

**Podman:** Use **`podman compose`** (Compose V2), not the standalone `docker-compose` binary, so build and run use the same daemon and you avoid “image not known” after build:

```bash
podman compose up --build
```

If your system uses `podman-compose` (Python):

```bash
podman-compose up --build
```

Then open the UI at **http://localhost:5173** (ports are bound to localhost by default; see [Container run](#container-run) to change that).

### SELinux (Podman on Fedora/RHEL)

If you mount files or folders with Podman, add `:Z` or `:z` to volume mounts as needed.

## Local development

- **Backend:** `cd backend && npm install && npm run dev` (or start via your IDE). Set `DATA_DIR` if you want state outside `./data` (e.g. `backend/data`).
- **Frontend:** `cd frontend && npm install && npm run dev`. Vite serves the UI; point it at the backend (default `http://localhost:4000` via `VITE_API_BASE`).
- **Tests:** `npm test` in `backend/` and `frontend/`. See `docs/CONTRIBUTING.md` for contribution and test conventions.

The backend uses SQLite for state and job history; the frontend uses React + Vite.

## Container run

The stack is two services (frontend, backend). Ports in `docker-compose.yml` are bound to **127.0.0.1** by default so the app is not exposed on the LAN. To allow access from other machines, change the left side of the port mapping to `0.0.0.0` (e.g. `"0.0.0.0:5173:5173"`).

- **Frontend:** 5173 (Vite dev server in container)
- **Backend:** 4000 (Express API)
- **State:** Backend uses a named volume for SQLite; run bundles and temp files are under that data path.

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

Operator scan uses the **oc-mirror** binary inside the backend container. The default backend image is built for the host architecture (e.g. **linux/amd64** on Intel/AMD, **linux/arm64** on Apple Silicon). The baked-in `oc`/`oc-mirror` binaries in the image are x86_64 only, so **Operator scan works out of the box on amd64 Linux**; on **Apple Silicon (aarch64)** the scan will fail with an architecture mismatch or runtime error.

A previous workaround that forced the backend to **linux/amd64** (so x86_64 binaries ran under emulation) has been **removed** because **oc-mirror segfaults under amd64 emulation** on Apple Silicon and is not reliable. A proper architecture-aware solution (native aarch64 binary selection and/or `OC_MIRROR_BIN` override) is planned; until then, Apple Silicon users should see **`docs/OPERATOR_SCAN_ARCHITECTURE_PLAN.md`** for current status and options.

## Troubleshooting

- **“additional properties 'platform' not allowed”** — You’re using the Python **`docker-compose`** with an old schema. Prefer **`podman compose`** so Podman doesn’t delegate to `/usr/local/bin/docker-compose`; see [Quick start](#quick-start-container). On macOS, see also the compose-provider workaround in `docs/OPERATOR_SCAN_ARCHITECTURE_PLAN.md` or CONTRIBUTING.
- **“no such image” or “image not known” after build (Podman)** — Use **`podman compose`** for the whole workflow. If it still happens, try a clean rebuild: `podman compose down`, `podman rmi localhost/openshift-airgap-architect-backend:latest` (if it exists), then `podman compose up --build`.
- **Port already in use** — Change `PORT` (backend) or the host port in `docker-compose.yml` (e.g. 4001:4000, 5174:5173).
- **Operator scan fails** — Ensure registry.redhat.io credentials are valid and mounted (or pasted in UI for that session). On Apple Silicon / ARM, see **Platform and architecture** above and `docs/OPERATOR_SCAN_ARCHITECTURE_PLAN.md`. Check backend logs for auth or architecture errors.
- **Cincinnati or docs stale** — Use **Update** (release channels) or **Update Docs Links** (field manual links) in the UI; the backend refreshes caches on demand.
- **Validation errors on a step** — Required fields are marked; check Identity & Access (pull secret, SSH key), Networking (CIDRs), and Platform Specifics for your scenario.
- **SELinux denials (Podman)** — Use `:Z` on volume mounts or adjust context as needed for your host.

## Screenshots

_Screenshots will be added here in a future update (landing, wizard steps, Assets & Guide)._

## Architecture

- **Frontend:** React, Vite, PatternFly-derived styling
- **Backend:** Node.js, Express, SQLite (state and job history)
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
