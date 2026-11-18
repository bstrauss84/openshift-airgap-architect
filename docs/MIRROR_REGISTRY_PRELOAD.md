# Mirror Registry Preload + Agent ISO Bootstrap — design contract

**Authority:** Living design contract for the mirror registry config preloading feature
and the generic agent ISO bootstrap manifest injection. Canonical status lives in
`docs/BACKLOG_STATUS.md`. Added in `feature/mirror-operator-integration`.

---

## Overview

Two related features allow the wizard to operate in a fully pre-configured high-side
(air-gapped) deployment:

1. **Mirror registry config preloading** — the backend reads a mounted JSON config file
   at startup and auto-populates wizard fields (pull secret, CA cert, registry FQDN,
   mirror sources), locking them read-only in the UI.

2. **Agent ISO bootstrap manifest injection** — during agent ISO generation, the backend
   copies any YAML files found at `BOOTSTRAP_MANIFESTS_DIR` verbatim into the agent
   installer's `openshift/` extra-manifests directory, enabling day-0 operator bootstrap
   without wizard code knowing about specific operators.

---

## Part 1 — Mirror Registry Config Preloading

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `MIRROR_REGISTRY_CONFIG` | No | Absolute path to a JSON config file. When set, preloading is active. |
| `IMAGESET_CONFIG` | No | Absolute path to an imageset-config.yaml. When set, pre-selects the OCP version. |

### Config file format

```json
{
  "hostname": "registry.corp.local",
  "port": 8443,
  "username": "admin",
  "password": "...",
  "tlsVerify": true,
  "caCertPath": "/data/ca.pem",
  "idmsPath": "/data/idms-oc-mirror.yaml",
  "itmsPath": "/data/itms-oc-mirror.yaml",
  "catalogSourcePaths": ["/data/catalog-source.yaml"]
}
```

### What happens at startup

1. `mirrorRegistryConfigLoader.loadMirrorRegistryConfig()` reads the JSON file.
2. Pull secret generated: `base64(username:password)`. Stored in the in-memory variable
   `mountedMirrorPullSecret` only — **never written to SQLite**.
3. CA cert content read from `caCertPath`.
4. Mirror sources parsed from `idmsPath` / `itmsPath` via `idmsParser.loadMirrorSources()`.
5. Default wizard state augmented with registry FQDN, CA cert, mirror sources, and
   `ui.mirrorConfigPreloaded: true`.

### Credential handling rules

- `mountedMirrorPullSecret` is **memory-only**. It is injected into `GET /api/state`
  responses and into `POST /api/generate` calls at runtime — never persisted.
- The config file `password` field is never logged. Only `username` is logged at info
  level on successful load.
- `getStateForPersistence()` strips all pull secret fields before any database write.

### UI behaviour when `mirrorConfigPreloaded === true`

- `PreloadedConfigBanner` renders above locked sections in:
  - Identity & Access (mirror registry toggle, pull secret)
  - Connectivity & Mirroring (registry FQDN)
  - Trust & Proxy (CA certificate)
  - Blueprint (shows "Pre-configured" badge on version field when `mirrorBundleDetected`)
- The Operators step and Run oc-mirror step are hidden (`wizardVisibleSteps.js`).
- The Generate Agent ISO step appears for Agent-Based Installer + Bare Metal / vSphere.

---

## Part 2 — Agent ISO Bootstrap Manifest Injection

### Environment variable

| Variable | Required | Description |
|---|---|---|
| `BOOTSTRAP_MANIFESTS_DIR` | No | Absolute path to a directory of YAML files. All `.yaml`/`.yml` files are copied into the agent ISO's `openshift/` extra-manifests directory at ISO generation time. |

### What happens at ISO generation

`POST /api/agent-iso/generate` launches a background job that:

1. Creates a work directory `/data/tmp/agent-iso-{jobId}/`.
2. Writes `install-config.yaml` and `agent-config.yaml` from wizard state (injecting
   `mountedMirrorPullSecret` if present).
3. Creates `openshift/` extra-manifests directory.
4. If `BOOTSTRAP_MANIFESTS_DIR` is set and readable, copies all `.yaml`/`.yml` files
   from it into `openshift/`. The backend has **no knowledge** of what these files
   contain — it is a dumb file copier.
5. Runs `openshift-install agent create image --dir <workDir>`.
6. Streams stdout/stderr to the job log (no credentials in the stream).
7. Reads `auth/kubeadmin-password` and `auth/kubeconfig` from the work directory on
   success. These are stored in job `metadata_json` (SQLite) and **never appended to
   the job output log**.

### Naming convention for files in `BOOTSTRAP_MANIFESTS_DIR`

Filenames control the apply order during OpenShift bootstrap:

| Prefix | Contents |
|---|---|
| `00-` | CRDs (must precede all CRs) |
| `01-` | OperatorHub disable, Namespace |
| `02-` | OperatorGroup |
| `99-` | CatalogSource, Subscription, operator CRs, IDMS/ITMS |

The wizard does not enforce or validate this convention — it is a contract between the
entity that populates `BOOTSTRAP_MANIFESTS_DIR` and `openshift-install`.

### ISO download

`GET /api/agent-iso/download/:jobId` streams the ISO file. Path is validated with
`fs.realpathSync()` to be within `/data/tmp/agent-iso-*/` before serving — directory
traversal is not possible.

---

## Security invariants

| Invariant | Enforcement |
|---|---|
| Pull secret never in SQLite | `mountedMirrorPullSecret` is a module-level `let`; `getStateForPersistence()` strips credential fields |
| Pull secret never logged | Grep `mountedMirrorPullSecret` in `index.js` — zero matches in any `logger.*` or `appendJobOutput` call |
| CA cert content never logged | Only byte count logged at info level |
| kubeadmin password never in job output | `appendJobOutput` only records character count; password stored in `metadata_json` only |
| ISO download path-safe | `fs.realpathSync` validates path is within allowed directory before `createReadStream` |

---

## Tests

| File | Tests | Coverage |
|---|---|---|
| `backend/test/mirrorRegistryConfigLoader.test.js` | 15 | Config loading, pull secret generation, CA cert, IDMS parsing, error paths |
| `backend/test/idmsParser.test.js` | — | IDMS/ITMS multi-document YAML parsing, source extraction |
| `backend/test/imageSetConfigParser.test.js` | — | imageset-config.yaml version extraction |

Test fixtures are in `backend/test/fixtures/` and use low-entropy placeholder
credentials (`secret123`) allowlisted in `.gitleaks.toml`.
