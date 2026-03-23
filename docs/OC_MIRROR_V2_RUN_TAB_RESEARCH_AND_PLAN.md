# oc-mirror v2 Run Tab — Implementation Contract (OpenShift 4.20)

**Purpose:** Buildable contract for the "Run oc-mirror" tab. A later implementation pass can follow §1–§9 directly without re-deciding scope, APIs, state, or artifact rules.

**Status:** Implementation contract complete. v1 implementation completed on branch `feat/oc-mirror-run-tab-v1` (see "Implementation Pass (v1)" below).

**Doc source:** OpenShift 4.20 Disconnected environments → Chapter 5 "Mirroring images for a disconnected installation by using the oc-mirror plugin v2" (docs.redhat.com).

**Structure:** §1–§9 = implementation contract. "Reference" and Phase A onward = condensed 4.20 truth and prior narrative.

---

## Phase 0 — Repo Grounding (Corrected)

### Paths verified (current reality)

| Item | Location | Verified |
|------|----------|----------|
| Canonical docs index 4.20 | `data/docs-index/4.20.json` | **Exists** (previous pass incorrectly said "not present"; `.gitignore` has `!/data/docs-index/` so it is tracked). |
| Frontend docs index copy | `frontend/src/data/docs-index/4.20.json` | Exists; contains `sharedDocs` including `about-oc-mirror-v2` → disconnected_environments index URL. |
| Working doc (this file) | `docs/OC_MIRROR_V2_RUN_TAB_RESEARCH_AND_PLAN.md` | Replaced placeholder with full plan. |
| Run oc-mirror step | `frontend/src/steps/RunOcMirrorStep.jsx` | Placeholder only: "Coming soon" card, no controls, no API calls. |
| Operations step | `frontend/src/steps/OperationsStep.jsx` | Full: `/api/jobs`, `/api/jobs/:id`, SSE `/api/jobs/:id/stream`, stop for `oc-mirror-run`; `streamEnded` state; export/clear. |
| Connectivity & Mirroring | `frontend/src/steps/ConnectivityMirroringStep.jsx` | Manages `globalStrategy.mirroring.registryFqdn`, `mirroring.sources`; IDMS hint; no Run-tab coupling. |
| Backend API | `backend/src/index.js` | `POST /api/ocmirror/run` (m2d only), `POST /api/system/path-check`; jobs CRUD + SSE + stop; defaultState `mirrorWorkflow.outputPath`, `includeInExport`. |
| oc-mirror runtime | `backend/src/ocMirrorRuntime.js` | Binary resolution (OC_MIRROR_BIN → baked-in → mirror by arch → OC_MIRROR_URL); shared with operators.js. |
| Generate / field manual | `backend/src/generate.js` | `buildImageSetConfig`, field manual with m2d/d2m commands; **bug:** manual says `oc apply -f ${outputPath}/cluster-resources` but 4.20 docs place resources under `working-dir/cluster-resources` (see §Corrections). |
| Operators | `backend/src/operators.js` | Uses oc-mirror for `list operators` (v1 API); REGISTRY_AUTH_FILE; no Run-tab. |
| Utils / DB | `backend/src/utils.js`, `backend/src/db.js` | Jobs table: id, type, status, progress, message, output, created_at, updated_at — **no metadata column**. writeTempAuth, appendJobOutput (500KB trim). |
| E2E matrix | `backend/scripts/e2e-matrix.js` | Uses `mirroring` in state; no oc-mirror run. |
| Operator scan plan | `docs/OPERATOR_SCAN_ARCHITECTURE_PLAN.md` | oc-mirror binary arch; Run oc-mirror must align. |
| Data/copies | `docs/DATA_AND_FRONTEND_COPIES.md` | Canonical data/docs-index, data/params; frontend copies under frontend/src/data. |
| Params rules | `docs/PARAMS_CATALOG_RULES.md` | IDMS/ITMS from oc-mirror v2. |
| Backlog | `LOCAL_BACKLOG.md` | #1: Run oc-mirror tab listed as future feature; CPU/OS agnostic. |

### Repo search results (summary)

- **oc-mirror:** Backend run endpoint, binary resolution, operators scan, generate.js and field manual, README, DOC_INDEX_RULES, CONTRIBUTING, styles. No mirrorToDisk/diskToMirror/mirrorToMirror strings; workflow names only in this plan and docs.
- **delete / delete images:** Only in doc fetch content and this plan; no app code.
- **workspace / cache-dir:** Not in backend; only in 4.20 doc content and this plan.
- **imageSetConfig / cluster-resources:** generate.js builds imageset-config; field manual says "cluster-resources" (path bug above). No cluster-resources in backend paths.
- **includeInExport:** index.js defaultState and buildBundleZip; mirror output dir included when set.
- **path-check:** POST /api/system/path-check; used by /api/ocmirror/run.
- **authfile / REGISTRY_AUTH_FILE:** operators.js and index.js (ocmirror run); temp auth file, never persisted.
- **dry-run:** Only in 4.20 docs and this plan; not in app.

### What exists vs partial vs missing

| Area | Exists | Partial | Missing |
|------|--------|---------|---------|
| Run oc-mirror UI | — | Placeholder step only | Mode selection, paths, auth, preflight, run/stop, summary. |
| Backend oc-mirror run | m2d only, one path, no workspace/cache | — | d2m, m2m, dry-run, delete; workspace/cache-dir; job metadata. |
| Operations / jobs | Full list, SSE, stop, export, clear | Job schema has no metadata_json | oc-mirror-specific metadata, artifact paths in UI. |
| Preflight | path-check for one path | — | Multi-path, structure checks, preflight endpoint. |
| Auth | Temp auth for run; REGISTRY_AUTH_FILE | — | Explicit model (paste vs reuse vs mount); never persist. |
| Field manual | m2d/d2m commands | Path to cluster-resources wrong | working-dir/cluster-resources; optional workspace/cache note. |

### Corrections to previous pass

1. **Canonical docs-index:** `data/docs-index/4.20.json` **exists** (and is not gitignored; exceptions in .gitignore). Previous claim that it was "not present" was wrong.
2. **Field manual path:** 4.20 docs place cluster resources at `<workspace_or_archive>/working-dir/cluster-resources`. generate.js currently says `${outputPath}/cluster-resources`; it should be `${outputPath}/working-dir/cluster-resources` (when outputPath is the file:// target, oc-mirror creates working-dir inside it).
3. **Working doc:** Was a one-line placeholder; now replaced with this full plan.

---

# Implementation contract (v1)

The following sections are the **buildable contract** for the next implementation pass. No ambiguity: endpoints, shapes, and rules are explicit.

---

## §1 Final v1 scope / deferred scope

### In v1 (included)

| Category | Items |
|----------|--------|
| **Workflows** | mirrorToDisk, diskToMirror, mirrorToMirror. Dry-run only as an option for mirrorToDisk (checkbox), not a fourth mode. |
| **Path selection** | Archive path (m2d: destination; d2m: source). Workspace path. Cache path (m2d and d2m only; hidden for m2m). |
| **Config source** | "Use generated imageset-config" (default) or "External file" with path. |
| **Registry** | Registry URL (docker://...) for d2m and m2m; default from `globalStrategy.mirroring.registryFqdn`. |
| **Auth** | One-time: "Use mirror-registry credentials from Identity & Access" or "Paste/upload pull secret for this run (not stored)". No persistence of auth content or path. |
| **Preflight** | New endpoint `POST /api/ocmirror/preflight`; Run button gated on no blockers. |
| **Live logs** | Existing SSE job stream. |
| **Operations history** | Job type `oc-mirror-run` with metadata (mode, paths, etc.). |
| **Stop/cancel** | Existing `POST /api/jobs/:id/stop`; SIGTERM; status cancelled. |
| **Artifact path summary** | After run: archive dir, workspace dir, cache dir (if used), cluster-resources path, dry-run paths if applicable. |
| **Manual handoff** | Summary and metadata must enable user to continue manually (paths, no app-owned moves). |
| **Include in export** | Existing `mirrorWorkflow.includeInExport` + archive path; export adds that directory to ZIP. |

### Explicitly out of v1 (deferred)

- oc-mirror **delete** (generate + execute).
- Break-glass **cleanup/reset** (force delete cache/workspace from UI).
- **Signature-policy / registries.d / policy** advanced controls.
- **Enclave-specific** workflows (registries.conf, multi-enclave).
- **Deep reachability** checks (registry/DNS/SSL probing from app).
- Any other mode or capability not listed in "In v1" above.

---

## §2 Backend API contracts

### 2A. Preflight endpoint

**Endpoint:** `POST /api/ocmirror/preflight`

**Request body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| mode | string | yes | One of: `mirrorToDisk`, `diskToMirror`, `mirrorToMirror`. |
| archivePath | string | mode-dependent | For m2d: destination dir. For d2m: source dir. Omitted for m2m. |
| workspacePath | string | yes | Working dir for cluster-resources and logs. |
| cachePath | string | mode-dependent | For m2d and d2m only. Omitted or ignored for m2m. |
| registryUrl | string | d2m, m2m | e.g. `docker://registry.local:5000`. Empty for m2d. |
| configSourceType | string | yes | `generated` or `external`. |
| configPath | string | if external | Absolute or relative path to ImageSetConfiguration file. |
| authSource | string | yes | `reuse` (from Identity & Access), `pasted`, or `env`. |
| minBytes | number | no | Minimum free bytes for archive/workspace (default 0). |

**Response (200):**

```json
{
  "ok": true,
  "blockers": ["string"],
  "warnings": ["string"],
  "checks": {
    "archivePath": { "exists": false, "writable": true, "freeBytes": 0, "meetsMin": true, "structure": "ok" | "missing" | "invalid" },
    "workspacePath": { "exists": false, "creatable": true, "writable": true, "freeBytes": 0 },
    "cachePath": { "exists": false, "creatable": true, "writable": true },
    "config": "present" | "missing",
    "auth": "present" | "missing",
    "registryUrl": "non-empty" | "empty"
  }
}
```

- **blockers:** List of human-readable strings. If non-empty, Run must be disabled. Examples: "Archive path is not writable.", "Insufficient disk space at archive path.", "Config file not found.", "d2m requires existing archive structure (working-dir or tar files).".
- **warnings:** Non-blocking; e.g. "Low disk space.", "Workspace already contains oc-mirror data."
- **Per-mode required checks:**  
  - **m2d:** archivePath writable + meetsMin; workspacePath creatable and writable; cachePath creatable and writable; config present; auth present or warning.  
  - **d2m:** archivePath exists + structure (working-dir or *.tar); workspacePath; cachePath; config present; registryUrl non-empty; auth present or warning.  
  - **m2m:** workspacePath creatable and writable; config present; registryUrl non-empty; auth present or warning. No archivePath or cachePath checks.
- **What preflight does NOT do:** No credential validation, no registry reachability, no DNS/SSL checks. Those are left to oc-mirror at run time.

**Structure validation for d2m archivePath:** Consider "ok" if path exists and (contains a `working-dir` directory or contains at least one `.tar` file). Otherwise "invalid" and add a blocker.

### 2B. Run endpoint

**Endpoint:** `POST /api/ocmirror/run` (extend existing).

**Request body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| mode | string | yes | `mirrorToDisk` \| `diskToMirror` \| `mirrorToMirror`. |
| dryRun | boolean | no | Default false. Only valid for mirrorToDisk. |
| archivePath | string | m2d, d2m | For m2d: destination. For d2m: source (--from file://...). |
| workspacePath | string | yes | --workspace file://... |
| cachePath | string | m2d, d2m | --cache-dir. Omit for m2m. |
| registryUrl | string | d2m, m2m | docker://... |
| configSourceType | string | yes | `generated` \| `external`. |
| configPath | string | if external | Path to ImageSetConfiguration. |
| authSource | string | yes | `reuse` \| `pasted` \| `env`. |
| pullSecret | string | if pasted | JSON string; written to temp file, never stored. |
| advanced | object | no | See §7. logLevel, parallelImages, parallelLayers, imageTimeout, retryTimes, retryDelay, since, strictArchive. |

**Backend behavior:** Version must be confirmed (existing check). Resolve oc-mirror binary (existing). If configSourceType is `generated`, build config via `buildImageSetConfig(state)` and write to temp file. If `external`, use configPath (must exist). If authSource is `reuse`, read mirror-registry pull secret from state and write to temp file. If `pasted`, use pullSecret. If `env`, use process.env.REGISTRY_AUTH_FILE. Spawn oc-mirror with correct args per mode; pass --workspace, --cache-dir when provided; add --dry-run for mirrorToDisk when dryRun is true. On process exit (close), write job metadata (see §4) to job row. Temp config and temp auth files are unlinked after run.

**Response (200):** `{ "jobId": "string" }`. No wait; client uses jobId to poll or SSE.

**Errors (4xx/5xx):** 400 if version not confirmed, required path missing, or preflight not passed (if app enforces). 500 on path/config/fs errors.

### 2C. Stop behavior

- **Request:** `POST /api/jobs/:id/stop` (existing). No body.
- **Behavior:** If job is in `activeProcesses`, send SIGTERM to process, remove from map, call `updateJob(id, { status: "cancelled", message: "Stopped by user.", progress: 0 })`. If job not running, 404.
- **Partial artifacts:** No app action on disk. Workspace/cache/archive may contain partial data. UI must state: "Stopped by user. Partial artifacts may remain on disk; you can inspect paths below or run again."
- **Metadata:** On stop, backend does not write exitCode or finishedAt to metadata (process did not exit normally). Status and message are enough.

---

## §3 Frontend state / screen contract

### 3A. Screen sections (final order)

1. **Mode** — Choose workflow (Mirror to disk | Disk to mirror | Mirror to mirror).
2. **Config source** — Generated vs external path.
3. **Paths** — Archive, workspace, cache (visibility by mode).
4. **Destination / registry** — Registry URL for d2m and m2m.
5. **Auth** — Reuse from Identity & Access | Paste/upload for this run.
6. **Advanced** — Collapsible: dry-run (m2d only), log level, parallel-*, retry-*, image-timeout, since, strict-archive.
7. **Preflight** — Button "Run preflight"; display blockers and warnings; gate Run on no blockers.
8. **Run status / last run** — Run button, Stop when running, and after run: status, elapsed time, mode, paths (archive, workspace, cache, cluster-resources, dry-run paths if any), link to Operations.

### 3B. Per-section fields

| Section | Field name (state) | Type | Default | When shown | When hidden | Notes |
|--------|--------------------|------|---------|------------|-------------|-------|
| Mode | mirrorWorkflow.mode | string | `mirrorToDisk` | Always | — | Radio. |
| Config | mirrorWorkflow.configSourceType | string | `generated` | Always | — | Radio: generated \| external. |
| Config | mirrorWorkflow.configPath | string | "" | When external | When generated | Text input; validated when external. |
| Paths | mirrorWorkflow.archivePath | string | e.g. dataDir/oc-mirror/archives | m2d, d2m | m2m | Label: "Archive directory" (m2d: "Destination"; d2m: "Source"). |
| Paths | mirrorWorkflow.workspacePath | string | e.g. dataDir/oc-mirror/workspace | Always | — | |
| Paths | mirrorWorkflow.cachePath | string | e.g. dataDir/oc-mirror/cache | m2d, d2m | m2m | |
| Registry | mirrorWorkflow.registryUrl | string | from globalStrategy.mirroring.registryFqdn | d2m, m2m | m2d | Prefix docker:// if user omits. |
| Auth | (no state) | — | — | — | — | Choice per run: reuse \| paste. Not persisted. |
| Advanced | mirrorWorkflow.dryRun | boolean | false | m2d only | d2m, m2m | Checkbox "Dry run (no mirror)". |
| Advanced | mirrorWorkflow.logLevel | string | `info` | Always in advanced | — | info \| debug. |
| Advanced | mirrorWorkflow.parallelImages | number | 4 | Always in advanced | — | |
| Advanced | mirrorWorkflow.parallelLayers | number | 5 | Always in advanced | — | |
| Advanced | mirrorWorkflow.imageTimeout | string | "10m" | Always in advanced | — | |
| Advanced | mirrorWorkflow.retryTimes | number | 2 | Always in advanced | — | |
| Advanced | mirrorWorkflow.retryDelay | string | "1s" | Always in advanced | — | |
| Advanced | mirrorWorkflow.since | string | "" | Always in advanced | — | Optional. |
| Advanced | mirrorWorkflow.strictArchive | boolean | false | Always in advanced | — | |
| — | mirrorWorkflow.includeInExport | boolean | false | Always | — | Checkbox "Include mirror output in export bundle". |
| — | mirrorWorkflow.lastRunJobId | string | null | After a run | — | Link to Operations. Not required for v1 but recommended. |

**Long-help (durable):** Mode section: each radio has a short paragraph (what it is, when to use it). Same card/note pattern as AWS GovCloud IPI; no hover-only critical info. Deferred note: "Delete and reset workspace are not available in this version."

### 3C. Validation behavior

- **Field-level:** archivePath, workspacePath, cachePath non-empty when visible. registryUrl non-empty for d2m/m2m. configPath required and non-empty when configSourceType is external.
- **Preflight-gating:** Run button disabled until preflight has been run and `blockers.length === 0`. Warnings do not block; show them so user can acknowledge.
- **Errors:** Display inline under field or in a summary card; use existing app error patterns.
- **Remembered between visits:** mirrorWorkflow.* paths, mode, configSourceType, configPath, registryUrl, advanced flags, includeInExport. Not remembered: auth choice and pullSecret (never stored).

### 3D. Result presentation (after a run)

Display in "Run status / last run" section:

- **Status:** completed | failed | cancelled.
- **Elapsed time:** finishedAt − startedAt from job metadata (or created_at/updated_at if metadata missing).
- **Mode:** mirrorToDisk | diskToMirror | mirrorToMirror.
- **Paths (copyable or plain text):** Archive dir, Workspace dir, Cache dir (if used), Cluster-resources path (workspacePath + `/working-dir/cluster-resources`). If dry-run: Mapping file path, Missing file path.
- **Link:** "View full logs in Operations" → navigate to Operations step and select this job (or open in new context).
- **Manual handoff:** One line: "To continue manually, use the paths above. Run oc-mirror from the command line with the same workspace and cache for incremental runs."

---

## §4 Job metadata / Operations contract

### 4A. Job metadata model

**Schema:** Add column `metadata_json` to table `jobs`. Type TEXT. Default `''` or `'{}'`. Store JSON string.

**Backward compatibility:** Existing rows have no metadata_json (or NULL). Frontend and API must treat missing metadata as "legacy job"; show id, type, status, message, output, created_at, updated_at only.

**Migration:** On app init or first use of oc-mirror run, run: `ALTER TABLE jobs ADD COLUMN metadata_json TEXT DEFAULT '{}';` (or equivalent). If column already exists, skip. For SQLite, default empty string is fine; parse as JSON when present and non-empty.

**Shape of metadata_json for type `oc-mirror-run`:**

```json
{
  "mode": "mirrorToDisk",
  "dryRun": false,
  "archiveDir": "/path/to/archive",
  "workspaceDir": "/path/to/workspace",
  "cacheDir": "/path/to/cache",
  "registryUrl": "",
  "configSourceType": "generated",
  "configPath": "",
  "exitCode": 0,
  "startedAt": 1700000000000,
  "finishedAt": 1700000100000,
  "clusterResourcesPath": "/path/to/workspace/working-dir/cluster-resources",
  "dryRunMappingPath": "",
  "dryRunMissingPath": ""
}
```

- **startedAt / finishedAt:** Unix ms. Set when process starts; finishedAt when process closes. Omit or null if job was stopped (cancelled).
- **clusterResourcesPath:** Derived: workspaceDir + `/working-dir/cluster-resources`. Omit for dry-run-only if no working-dir yet.
- **dryRunMappingPath / dryRunMissingPath:** Set when dryRun is true; paths to mapping.txt and missing.txt under workspace working-dir/dry-run/.

**utils.updateJob:** Must support writing metadata. Either extend `updateJob(id, { ..., metadata_json: string })` and DB UPDATE to include metadata_json, or add `updateJobMetadata(id, object)` that reads row, merges object into metadata_json, writes back. Implementation chooses one; contract is that completed/failed/cancelled oc-mirror-run jobs have this shape in metadata_json.

### 4B. Log/output model

- **Streamed live:** Combined stdout and stderr of oc-mirror process via existing appendJobOutput + SSE. No change.
- **Stored in job.output:** Truncated to 500KB (existing appendJobOutput behavior). Keep.
- **Must NOT store:** Auth content, auth file path, or any secret. No echo of pullSecret or REGISTRY_AUTH_FILE value in output or metadata.
- **Stream end:** When process exits, SSE sends final job snapshot (with output and status). streamEnded in UI.
- **oc-mirror log files on disk:** Path to working-dir/logs may be stored in metadata (e.g. `logsDir: workspaceDir + "/working-dir/logs"`). UI can show "Logs on disk: &lt;path&gt;" for user to open manually. Not required for v1 list row; optional in expanded detail.

### 4C. Operations UI rendering

- **List row:** Badge "oc-mirror run"; status badge; created_at; message. If metadata_json exists and has mode, append mode to subtitle (e.g. "mirrorToDisk · completed") so user can distinguish without expanding.
- **Expanded row:** Existing "View logs" and log &lt;pre&gt;. Add a **summary block** when type is oc-mirror-run and metadata is present: Mode, Archive dir, Workspace dir, Cache dir (if any), Registry (if any), Cluster-resources path, Status and exit code. Paths as copyable text or secondary line. No secrets.
- **Historical runs:** Same data from metadata; no re-streaming. User can open any job and see summary + truncated output.

---

## §5 Artifact ownership / continuity contract

### 5A. Ownership model

| Artifact | Who creates | Where it lives | Preserved? | App may delete? | User re-use later? |
|---------|-------------|----------------|------------|-----------------|--------------------|
| Temp auth file | App | dataDir/tmp | No | Yes (after run) | No |
| Generated imageset-config (temp) | App | dataDir/tmp | No | Yes (after run) | No |
| Archive / tar outputs | oc-mirror | User-chosen archivePath | Yes | No | Yes |
| working-dir (cluster-resources, logs, dry-run) | oc-mirror | User-chosen workspacePath | Yes | No | Yes |
| Cache contents | oc-mirror | User-chosen cachePath | Yes | No | Yes |
| Job record + output in DB | App | SQLite | Yes | Clear completed (user action) | View history |

### 5B. Manual continuation contract

The app **must** leave behind and surface:

- **Exact paths:** archivePath, workspacePath, cachePath (when used). Displayed in Run tab result and in Operations job metadata.
- **Cluster-resources path:** `workspacePath + "/working-dir/cluster-resources"`. Shown in result and metadata.
- **Dry-run paths (if applicable):** mapping.txt and missing.txt under workspacePath/working-dir/dry-run/.
- **Generated imageset-config:** Not copied to a durable user path in v1. User can re-export from app or use "Assets & Guide" to get config. Optional future: "Save generated config to workspace" as a copy. v1 contract: no requirement to write config to user path; temp only.
- **Exact command line:** Optional for v1. If implemented, store in metadata as `commandLine: "oc mirror ..."` (no secrets). Otherwise user follows docs; paths are sufficient.
- **Run summary file on disk:** Not required. Summary is in UI and in job metadata.
- **Instructions:** One line in UI: "To continue manually, use the paths above. Same workspace and cache enable incremental runs."

### 5C. Export/bundle behavior

- **"Include in export"** means: when mirrorWorkflow.includeInExport is true and mirrorWorkflow.archivePath (or outputPath for backward compat) is set, add that directory to the ZIP as `mirror-output/` (existing buildBundleZip behavior). Resolve path on backend; if not a directory or not accessible, add error file to ZIP.
- **Do not include** workspace or cache in export by default; only the archive dir. Contract: include only the user-chosen archive path (the file:// target for m2d). Large archives are user responsibility; no size cap in v1. Safe default: includeInExport defaults to false; user opts in.

---

## §6 Path / mount / durability contract

### 6A. Path model

- **Expectation:** UI and backend treat archive/workspace/cache as **host-mounted durable paths** when the app runs in a container. User is responsible for choosing paths that persist (e.g. mounted volumes). Backend path-check runs in process; if backend runs in container, paths are container paths (so user must enter paths that are valid inside the container, typically host mounts).
- **Ephemeral paths:** App does not detect "ephemeral" vs "durable". If implementation wants to warn when path is under /tmp or dataDir/tmp, optional; not in contract. Defaults: use dataDir/oc-mirror/archives, dataDir/oc-mirror/workspace, dataDir/oc-mirror/cache so that in container deployments dataDir is usually a volume.
- **Defaults:** Acceptable defaults are dataDir-based as above. User can override to any path the backend can read/write.

### 6B. Reuse/reset decision model

| Situation | v1 behavior |
|-----------|--------------|
| workspacePath already contains oc-mirror state (e.g. working-dir) | **Allow and proceed.** Preflight may add warning "Workspace already contains oc-mirror data." Do not block. |
| archivePath already contains tar artifacts | **Allow and proceed.** Normal for incremental m2d or for d2m source. Optional warning. |
| cachePath already contains cache data | **Allow and proceed.** Normal for incremental. |
| Selected dirs appear unrelated (e.g. d2m archive from different workspace) | **Allow and proceed.** No deep validation of "match" in v1. Optional warning if workspace has no working-dir but archive has tars. |
| User wants to "reset" or "clean" workspace/cache | **Deferred.** No reset/clean button in v1. User does it manually outside the app. |

### 6C. Unsafe combinations

- **Overlapping dirs:** If archivePath is inside workspacePath or vice versa, or cachePath equals workspacePath, **warn** in preflight (blocker or warning at implementer choice; recommend blocker: "Archive path must not be inside workspace path.").
- **Nested confusion:** If archivePath === workspacePath, oc-mirror may accept it (single file path for m2d). Contract: allow archivePath === workspacePath for m2d; for d2m keep them as separate fields but they may point to same path. No nested requirement (e.g. workspace inside archive) in contract.
- **Insufficient space:** Preflight checks freeBytes and meetsMin; blocker if below threshold.
- **d2m invalid structure:** If archivePath exists but has no working-dir and no .tar, blocker: "Source archive path must contain oc-mirror output (working-dir or tar files)."

---

## §7 Advanced flags contract

| Flag | In v1 UI? | Default | Helper text | Validation |
|------|------------|---------|-------------|------------|
| logLevel | Yes (advanced) | info | "Log level: info or debug." | info \| debug |
| parallelImages | Yes (advanced) | 4 | "Max concurrent image pulls." | number 1–32 |
| parallelLayers | Yes (advanced) | 5 | "Max concurrent layer pulls." | number 1–32 |
| imageTimeout | Yes (advanced) | "10m" | "Timeout per image (e.g. 10m)." | string, duration-like |
| retryTimes | Yes (advanced) | 2 | "Number of retries on failure." | number 0–10 |
| retryDelay | Yes (advanced) | "1s" | "Delay between retries." | string, duration-like |
| since | Yes (advanced) | "" | "Incremental: only mirror images newer than this (ISO or digest)." | string, optional |
| strictArchive | Yes (advanced) | false | "Strict archive validation." | boolean |
| cacheDir | Yes (paths section) | dataDir/oc-mirror/cache | Path for cache. | path string |
| workspace | Yes (paths section) | dataDir/oc-mirror/workspace | Path for workspace. | path string |
| authfile | No (v1) | — | Handled by auth source (reuse/paste/env). | — |
| securePolicy / registries.d / rootless-storage-path | No (v1) | — | Deferred. | — |

Backend must pass these to oc-mirror CLI when provided: --log-level, --parallel-images, --parallel-layers, --image-timeout, --retry-times, --retry-delay, --since (if non-empty), --strict-archive (if true).

---

## §8 Minimal foundational updates (optional this pass)

- **Working doc:** This file; no further change required this pass except contract refinements.
- **RunOcMirrorStep.jsx:** Optional: add TODO comments referencing §3 section numbers for each future section. Do not implement UI.
- **Backend/db:** No code change this pass; migration for metadata_json is part of implementation pass.
- **Field manual:** generate.js was already updated to use working-dir/cluster-resources in a prior pass; confirm in implementation.

---

## §9 Test/validation expectations for implementation pass

The implementation pass **must** add and run:

### Backend

- **Preflight:** Unit or integration tests for `POST /api/ocmirror/preflight` with mode mirrorToDisk, diskToMirror, mirrorToMirror; assert request/response shape; assert blockers for invalid path, missing config; assert warnings where defined.
- **Run:** Tests for `POST /api/ocmirror/run` with each mode (mocked spawn or real binary in CI); assert job created, correct CLI args (--workspace, --cache-dir, --from, docker://), metadata written on exit.
- **Stop:** Assert POST stop returns 200 and job status becomes cancelled; no metadata exitCode/finishedAt when stopped.
- **Metadata:** Assert getJob returns metadata_json for oc-mirror-run jobs; legacy jobs without column or empty metadata do not break.

### Frontend

- **Run tab:** Renders mode selection, path inputs, config source, registry, auth choice, preflight button, Run/Stop. Mode change shows/hides archive and cache appropriately. Preflight result disables Run when blockers.length > 0.
- **No secrets in DOM or export:** Assert pullSecret or auth content is not rendered in DOM; not in exported state or operations export.

### Operations

- **List:** oc-mirror-run jobs show type label; when metadata exists, list row shows mode (or message) so user can distinguish.
- **Detail:** Expanded job shows summary block with paths when metadata present; log content unchanged.

### Preflight

- **Structure (d2m):** Test that archivePath with working-dir returns structure ok; without returns invalid and blocker.

### Scripts

- **validate-docs-index.js:** Run if docs-index changed (not required for Run tab only).
- **validate-catalog:** Run if catalog changed (not required for Run tab only).

### Manual checklist (implementation pass)

- [ ] Run mirrorToDisk with generated config; verify archive and working-dir created; verify cluster-resources path; verify job metadata.
- [ ] Run diskToMirror from same archive; verify registry receives content; verify job metadata.
- [ ] Run mirrorToMirror; verify no cache used; verify cluster-resources in workspace.
- [ ] Dry-run for m2d; verify mapping.txt and missing.txt paths in result and metadata.
- [ ] Stop a running job; verify status cancelled and partial artifacts remain; verify UI message.
- [ ] Preflight with invalid path; verify Run disabled. Preflight with valid paths; verify Run enabled.
- [ ] Export bundle with includeInExport; verify mirror-output in ZIP.
- [ ] Open Operations; select oc-mirror job; verify summary and logs.

---

## Blockers / unresolved

1. **Operations/SSE stability:** If existing job streaming or list is flaky, the implementation pass must fix or document as prerequisite before relying on it for Run tab.
2. **Field manual:** generate.js cluster-resources path was fixed to working-dir/cluster-resources in a prior pass; implementation pass should confirm and keep.
3. **Large export:** No size cap on "include in export"; user responsibility. Document in UI if desired.

---

# Reference (condensed)

## 4.20 workflow summary

- **m2d:** `oc mirror -c <config> file://<path> --v2`; optional --workspace, --cache-dir. Archives + working-dir under path; cache enables incremental.
- **d2m:** `oc mirror -c <config> --from file://<path> docker://<registry> --v2`; same path has archives + working-dir; cache used.
- **m2m:** `oc mirror -c <config> --workspace file://<path> docker://<registry> --v2`; no cache; workspace holds cluster-resources only.
- **Dry-run:** m2d with --dry-run; produces working-dir/dry-run/mapping.txt, missing.txt.
- **Cluster-resources:** Always under &lt;workspace&gt;/working-dir/cluster-resources.

## Auth (condensed)

Temp auth only when user supplies (reuse from state or paste). Never persist; unlink after run. REGISTRY_AUTH_FILE in env. No auth in logs or metadata.

---

## Phase A — 4.20 oc-mirror v2 Critical Truth (Re-verified)

**Source:** https://docs.redhat.com/.../disconnected_environments/about-installing-oc-mirror-v2 (Chapter 5, all expanded sections).

### 1. Three workflow modes

- **mirrorToDisk (m2d):** `oc mirror -c <config> file://<file_path> --v2`. Optional: `--workspace`, `--cache-dir`. Archives and working files under `<file_path>`. Cache used; enables incremental and resume.
- **diskToMirror (d2m):** `oc mirror -c <config> --from file://<file_path> docker://<mirror_registry> --v2`. Same `<file_path>` contains archives and generated cluster resources. Cache used.
- **mirrorToMirror (m2m):** `oc mirror -c <config> --workspace file://<file_path> docker://<mirror_registry> --v2`. Direct stream to registry; **no cache**; workspace holds cluster resources only.

### 2. Delete model

- **DeleteImageSetConfiguration:** apiVersion mirror.openshift.io/v2alpha1, kind DeleteImageSetConfiguration; `delete:` with platform/operators/additionalImages.
- **Phase 1 (generate):** `oc mirror delete --config delete-isc.yaml --workspace file://<workdir> --v2 --generate docker://<registry>` → produces `<workdir>/working-dir/delete/delete-images.yaml`.
- **Phase 2 (execute):** `oc mirror delete --v2 --delete-yaml-file <workdir>/working-dir/delete/delete-images.yaml docker://<registry>`.
- **Registry GC:** Delete removes manifests only; storage reclaimed only after registry garbage collection. Docs warn: do not modify/delete cache or workspace carelessly; m2m has no local cache so delete targets remote only.

### 3. Workspace / cache / continuity

- **--workspace:** Working files (IDMS, ITMS, CatalogSource, ClusterCatalog, UpdateService, logs, metadata, dry-run outputs, delete plans). Used to repeat/resume, apply to cluster, generate tar for d2m. **Do not remove or modify**; loss causes failed/inconsistent operations. Docs: "not necessary to back up" because regenerated each cycle — but deleting it breaks continuity.
- **--cache-dir:** Persistent blobs/manifests for **m2d and d2m only**. Default $HOME. Enables incremental and `--since`. If deleted/corrupted → full remirror. **Back up after successful operations.**
- **Which modes use what:** m2d and d2m use cache; m2m does not. All modes that write cluster resources use a workspace (explicit or implicit).

### 4. Dry run

- **Command:** `oc mirror -c <config> file://<workspace_path> --dry-run --v2`.
- **Produces:** `working-dir/dry-run/mapping.txt` (all images that would be mirrored), `missing.txt` (images not in cache). For first run, both lists match.
- **Meaningful for app:** Yes — validates config and shows image set size before a long run; first-class in v1 as an option alongside m2d.

### 5. Generated artifacts

- **cluster-resources:** Under `working-dir/cluster-resources` (IDMS, ITMS, CatalogSource, ClusterCatalog, UpdateService, signature ConfigMap).
- **logs:** `working-dir/logs/` (e.g. mirroring_error_*.log).
- **archives:** Tar files under the file:// path (m2d/d2m).
- **dry-run:** `working-dir/dry-run/mapping.txt`, `missing.txt`.
- **delete:** `working-dir/delete/delete-images.yaml`.

### 6. Flags to plan into UX (v1 or advanced)

- **Required for correctness:** `-c`, `--config`; `file://` path or `--from file://`; `docker://` for d2m/m2m; `--v2`.
- **Path semantics:** `--workspace`, `--cache-dir` (m2d/d2m).
- **Safe defaults to expose:** `--log-level` (info), `--parallel-images` (4), `--parallel-layers` (5), `--image-timeout` (10m), `--retry-times` (2), `--retry-delay` (1s).
- **Advanced (collapsible or later):** `--since`, `--strict-archive`, signature/registries.d/policy.

### 7. 4.20 credential/DNS/SSL verification note

Docs state oc-mirror v2 verifies that the complete image set is mirrored. Release notes for 4.20 were not re-scraped; if there is explicit "verify credentials/DNS/SSL before populating cache," the app should not duplicate deep checks — rely on oc-mirror for that; app preflight stays path/config/auth-presence only.

---

## Phase B — V1 Scope (Hard Boundaries)

### Required in v1 (must ship)

- **mirrorToDisk** with generated imageset-config, user-chosen archive dir, optional workspace and cache-dir (or sensible defaults).
- **diskToMirror** with user-chosen source archive dir, registry destination, optional workspace/cache; config from generated or same-as-prior.
- **mirrorToMirror** with registry destination, optional workspace; no cache.
- **Dry-run** as an option (e.g. checkbox or "Run dry-run") for m2d; show mapping/missing location in result.
- **Preflight checks** (paths writable, disk space, archive structure for d2m, config present).
- **Live logs** via existing SSE job stream.
- **Historical Operations record** (job type oc-mirror-run with mode in metadata or message).
- **Artifact path summary** after run (archive dir, workspace dir, cluster-resources path).
- **Stop/cancel** (existing POST /api/jobs/:id/stop).
- **Include mirror output in bundle/export** (existing mirrorWorkflow.includeInExport + outputPath).

### Can exist but advanced (v1 UI, gated)

- **Explicit workspace/cache-dir** inputs (defaulted under one base dir).
- **--since** and **--strict-archive** (advanced section).
- **Log level** (info/debug) and **parallel-*** in an "Advanced options" block.

### Deferred from v1 (explicitly out of scope)

- **Full delete support** (generate + execute delete). Reason: safety, two-phase flow, GC semantics; design contract only in this doc.
- **Break-glass cleanup/reset** (force-cache-delete, wipe workspace from UI).
- **Signature-policy / secure-policy / registries.d / policy** advanced controls.
- **Enclave-specific flows** (registries.conf, multi-enclave).
- **Deep reachability diagnostics** (probing registry/DNS/SSL from app).

---

## Phase C — Mode-Specific Contracts

### mirrorToDisk

| Aspect | Contract |
|--------|----------|
| Required inputs | Image set config (generated or path); archive destination directory (file://). |
| Optional inputs | Workspace dir; cache-dir; auth (temp file or REGISTRY_AUTH_FILE); dry-run flag; log-level, parallel-*, retry-*, image-timeout. |
| Required paths | Archive destination: must be writable, sufficient space (configurable threshold). |
| Optional paths | Workspace (default: e.g. &lt;archive&gt;/workspace or &lt;base&gt;/workspace); cache-dir (default: e.g. &lt;base&gt;/cache). |
| Workspace | Not required by CLI; if omitted oc-mirror uses default. For continuity and cluster-resources, app should pass --workspace. |
| cache-dir | Used; enables incremental. Default or user path. |
| Artifacts created | Tar archives in archive dir; working-dir (metadata, cluster-resources, logs, dry-run if used) under workspace or inside archive dir per oc-mirror behavior. |
| Artifacts pre-exist | None required. |
| Preserved | All of archive dir + workspace/cache for reuse. |
| Export | User can include archive dir in bundle (existing includeInExport). |
| Reuse in later run | Same cache + workspace for incremental m2d or for d2m. |
| Summary UI | Mode, status, archive path, workspace path, cluster-resources path, dry-run paths if run. |
| Operations metadata | mode: mirrorToDisk, archiveDir, workspacePath, cacheDir, exitCode, startedAt, finishedAt. |

### diskToMirror

| Aspect | Contract |
|--------|----------|
| Required inputs | Source archive dir (--from file://); registry destination (docker://); image set config (generated or path; should match content of archive for consistency). |
| Optional inputs | Workspace dir; cache-dir; auth; log-level, parallel-*, retry-*. |
| Required paths | Source dir: must exist, readable; must contain archives and ideally working-dir (for continuity). |
| Optional paths | Workspace (reuse from m2d or same dir as archive); cache-dir. |
| Workspace | Same as used for m2d that produced the archive, or co-located; required for correct cluster-resources generation. |
| cache-dir | Used. |
| Artifacts created | Updated working-dir (cluster-resources, logs); no new tar archives. |
| Artifacts pre-exist | Archive dir with tar(s) and working-dir from prior m2d. |
| Preserved | Workspace/cache; registry now has content. |
| Export | N/A (no new archive to include). |
| Reuse | Workspace/cache for next incremental or delete. |
| Summary UI | Mode, status, source path, registry, workspace path, cluster-resources path. |
| Operations metadata | mode: diskToMirror, archiveDir, workspacePath, cacheDir, registryUrl, exitCode, startedAt, finishedAt. |

### mirrorToMirror

| Aspect | Contract |
|--------|----------|
| Required inputs | Image set config; registry destination (docker://). |
| Optional inputs | Workspace dir; auth; log-level, parallel-*, retry-*. |
| Required paths | Workspace (or default) for cluster-resources output. |
| Optional paths | None. |
| Workspace | Required for cluster-resources; no archive path. |
| cache-dir | **Not used** (docs). |
| Artifacts created | working-dir/cluster-resources, logs; no tar. |
| Artifacts pre-exist | None. |
| Preserved | Workspace only. |
| Summary UI | Mode, status, registry, workspace path, cluster-resources path. |
| Operations metadata | mode: mirrorToMirror, workspacePath, registryUrl, exitCode, startedAt, finishedAt. |

### dry-run

- **As:** Option for mirrorToDisk (e.g. "Dry run (no mirror)" checkbox or separate action). Not a fourth top-level mode.
- **Produces:** working-dir/dry-run/mapping.txt, missing.txt.
- **Surface:** In result summary: "Dry run completed. Mapping: &lt;path&gt;, Missing: &lt;path&gt;." Link or copy path into Operations job metadata.

### delete (deferred; contract for later)

- **Phase 1:** DeleteImageSetConfiguration path, workspace (from prior mirror), registry. Output: delete-images.yaml path.
- **Phase 2:** delete-yaml-file path, registry. Executes delete. **Deferred:** Safety, GC, and UX (confirmations, warnings) required before implementation.

---

## Phase D — Auth / Credential / Secret Model

- **Temp auth files:** App creates a temp file via `writeTempAuth(contents)` only when user supplies pull secret (paste or upload) for that run. File path is not stored in state or job; file is deleted after job exit (success or failure).
- **Cluster pull secret vs mirroring auth:** Remain separate. Docs: "Do not use this image registry credentials file as the pull secret when you install a cluster." Run tab must not conflate install pull secret with mirroring auth.
- **Run tab acceptance:** (1) **Reuse from Identity & Access:** Use mirror-registry pull secret already in state for this run only (read once, write to temp file, pass REGISTRY_AUTH_FILE). (2) **Paste/upload for this run:** User supplies JSON; app writes temp auth, never persists. (3) **Environment:** If REGISTRY_AUTH_FILE is set in backend, use it when user does not supply paste/upload (existing behavior).
- **Persistence:** No auth content or auth file path in DB or app_state. Job output and metadata must not echo auth content or paths that contain secrets.
- **Source vs destination:** For m2d/m2m, auth must cover source (Red Hat) and optionally mirror (push). For d2m, auth for mirror (push). Single combined auth file (auths with multiple keys) is the documented pattern.
- **Current one-time flow:** Sufficient for v1; expand only to "reuse from Identity & Access" and keep paste/upload as one-time.

---

## Phase E — Preflight / Validation (Implementation-Grade)

### Endpoint

- **New:** `POST /api/ocmirror/preflight` (or extend path-check). Body: `{ mode, archivePath, workspacePath, cachePath, registryUrl, configPath?, minBytes? }`. Returns structured result per path and global pass/fail/warn.

### Result shape (proposed)

```json
{
  "ok": true,
  "blockers": [],
  "warnings": [],
  "checks": {
    "archivePath": { "exists": true, "writable": true, "freeBytes": 123, "meetsMin": true, "structure": "ok" },
    "workspacePath": { "exists": false, "creatable": true, "writable": true, "freeBytes": 456 },
    "cachePath": { "exists": false, "creatable": true, "writable": true },
    "config": "present",
    "auth": "present"
  }
}
```

- **blockers:** List of strings that must be fixed before run (e.g. "Archive path not writable", "Insufficient disk space").
- **warnings:** List of strings user can acknowledge (e.g. "Low disk space", "Workspace from different run").
- **d2m:** Add check that archivePath contains expected structure (e.g. working-dir or *.tar).
- **Auth:** "present" if temp auth will be used or REGISTRY_AUTH_FILE is set; "missing" warns for m2d/m2m.

### Per-mode

- **m2d:** Require archivePath writable + meetsMin; workspacePath creatable/writable; cachePath creatable/writable; config present; auth present or warn.
- **d2m:** Require archivePath exists + structure; workspacePath; cachePath; config; registryUrl non-empty; auth present or warn.
- **m2m:** Require workspacePath; registryUrl; config; auth.

### App vs oc-mirror

- **App preflight:** Paths, disk space, structure, config file existence, auth presence. No credential validation, no registry reachability.
- **oc-mirror at runtime:** Per 4.20, oc-mirror verifies and runs; failures (auth, DNS, SSL) appear in job output. App surfaces logs and artifact paths; does not duplicate deep verification.

---

## Phase F — Operations / Live Log / Persistence Model

### Job metadata fields (to add or encode)

- Store in DB: add **metadata_json** column to jobs table (JSON). For oc-mirror-run: `{ mode, archiveDir, workspacePath, cacheDir, registryUrl, imageSetConfigSource, dryRun, exitCode?, startedAt?, finishedAt? }`. If schema change deferred, encode minimal info in `message` (e.g. "mirrorToDisk completed" + paths in output tail).

### Live log

- **Streamed:** Combined stdout+stderr of oc-mirror process via existing appendJobOutput and SSE. No change to streaming mechanism.
- **Persisted:** Truncated to 500KB (existing); do not store full oc-mirror log files in DB. Store paths to working-dir/logs in metadata so user can open on disk.

### Summary after completion

- Parse or store: exitCode, finishedAt; paths (archiveDir, workspacePath, clusterResourcesPath). Display in Run tab "Last run" and in Operations job detail.

### Status values

- Existing: queued, running, completed, failed, cancelled. No new values.

### Stop/cancel

- Existing: POST /api/jobs/:id/stop sends SIGTERM to process. User sees "Stopped by user" and status cancelled. Partial artifacts remain on disk; document in UI that user may need to reuse or reset workspace/cache.

### Partial/incomplete runs

- Represent as status failed or cancelled; message and output explain. No "partial" status; show artifact paths so user can inspect.

### Re-open / view later

- Operations list shows all jobs; user clicks "View logs" for any job. Run tab can show "Last oc-mirror run" with link to that job and paths from metadata.

### Shared SSE / stream behavior

- **Assessment:** OperationsStep uses SSE and streamEnded; if shared infra is unstable (e.g. reconnects, missing chunks), the oc-mirror feature should not assume perfect streaming. Plan: (1) Rely on existing SSE for v1. (2) If evidence shows Operations streaming is broken, treat fixing or stabilizing it as a prerequisite or parallel task before or during Run tab implementation. (3) Do not build a separate log pipeline for oc-mirror only; keep one job model.

---

## Phase G — Artifact Ownership / Continuity

| Owner | What | Preserve for manual use? | User-selectable? |
|-------|------|---------------------------|------------------|
| App | Temp imageset YAML in dataDir/tmp | No (ephemeral) | No |
| App | Temp auth file in dataDir/tmp | No (deleted after run) | No |
| App | Job record and output in SQLite | Yes (history) | N/A |
| oc-mirror | Tar archives in archive dir | **Yes** | Yes (archive path) |
| oc-mirror | working-dir (cluster-resources, logs, dry-run, delete) | **Yes** | Yes (workspace path) |
| oc-mirror | cache dir contents | **Yes** | Yes (cache path) |

- **Preserved for continuity:** User must be able to run oc-mirror manually later using the same archive, workspace, and cache. App must not move or copy these after run; app operates in user-chosen directories.
- **Export bundle:** "Include mirror output" means adding the **archive directory** (or user-chosen output dir) to the ZIP. Paths in summary should make it clear where cluster-resources and logs live (e.g. `<archiveDir>/working-dir/cluster-resources`).
- **Cleanup:** App does not delete workspace or cache. Any "reset" or "clean" is deferred from v1.

---

## Phase H — UX / Screen Architecture (v1 Concrete)

### Section 1: Mode selection (card)

- **Title:** Choose workflow
- **Content:** Radio group: Mirror to disk | Disk to mirror | Mirror to mirror. Each option has durable long-help (what it is, when to use it, main consequence). Use AWS GovCloud IPI quality: same card/note pattern, no hover-only.
- **Deferred:** "Delete" and "Reset workspace" mentioned in a short note as "not available in this version" with link to docs.

### Section 2: Paths (card)

- **Fields:** Archive directory (m2d: destination; d2m: source); Workspace directory; Cache directory (hidden for m2m). Defaults: e.g. &lt;dataDir&gt;/oc-mirror/archives, workspace, cache.
- **Behavior:** Mode changes which fields are required/visible. Preflight result summary shown after "Run preflight" (pass/warn/fail per path).

### Section 3: Image set and registry (card)

- **Fields:** Config source: "Use generated imageset-config" (default) or "External file" with path. Registry URL (docker://...) for d2m and m2m; default from globalStrategy.mirroring.registryFqdn.
- **Helper:** docker:// syntax; registry must be reachable from backend.

### Section 4: Authentication (card)

- **Fields:** "Use mirror-registry credentials from Identity & Access" | "Paste or upload pull secret for this run (not stored)". Same security rules as Phase D.

### Section 5: Preflight and run (card)

- **Preflight:** Button "Run preflight"; results (blockers, warnings, path summary). Run button disabled until no blockers (or user acknowledges warnings if we allow that).
- **Advanced (collapsible):** Dry run (m2d only); log level; parallel-images, parallel-layers; retry-*, image-timeout; since, strict-archive.
- **Run:** "Run oc-mirror" primary button; "Stop" when job running.
- **Result:** Summary of last run: mode, status, paths (archive, workspace, cluster-resources), link to Operations for full logs.

### Integration with Operations

- Run tab shows last oc-mirror job and link "View full logs in Operations". Operations step unchanged; oc-mirror-run jobs show type label and, when metadata exists, mode and paths in detail.

### Dry-run placement

- In Preflight and run card: checkbox "Dry run (no mirror)" for mirrorToDisk. When checked, backend runs with --dry-run; result shows mapping.txt and missing.txt paths.

---

## Phase I — Implementation Plan (Task-Ready)

### 1. Current state summary

- Run oc-mirror: placeholder step; backend POST /api/ocmirror/run does m2d only with outputPath, no workspace/cache, temp config and optional temp auth; jobs table has no metadata; field manual cluster-resources path wrong.

### 2. Desired end state summary

- Run tab: mode (m2d, d2m, m2m), paths, registry, auth, preflight, run/stop, dry-run option, artifact summary. Backend: preflight endpoint; ocmirror/run accepts mode and paths; job metadata stored; correct CLI flags per mode. Field manual: correct working-dir/cluster-resources path.

### 3. Backend tasks

- Add `metadata_json` column to jobs (migration or new column default '').
- Implement `POST /api/ocmirror/preflight` (or equivalent) with body and result shape in Phase E.
- Extend `POST /api/ocmirror/run`: accept mode, workspacePath, cacheDir, archiveDir (or from), registryUrl, dryRun, optional flags; build CLI args per mode; pass --workspace, --cache-dir when provided; write metadata to job on completion.
- Keep temp config and temp auth lifecycle; never persist auth path or content.
- Fix field manual in generate.js: cluster-resources path `${outputPath}/working-dir/cluster-resources` (and document when workspace is separate).

### 4. Frontend tasks

- Replace RunOcMirrorStep placeholder with sections 1–5 (mode, paths, image set & registry, auth, preflight & run). Use existing card/long-help patterns.
- Wire preflight API; gate Run button on preflight result.
- Call /api/ocmirror/run with mode and paths; show jobId and link to Operations; poll or subscribe to job for "last run" summary.
- Persist mirrorWorkflow defaults (outputPath, workspacePath, cacheDir) in state if desired for next run.

### 5. State/data model tasks

- mirrorWorkflow: add workspacePath, cacheDir; keep outputPath, includeInExport. Optional: lastRunJobId for linking to Operations.
- No auth in state; auth only in request body and temp file.

### 6. Job/operations tasks

- Persist metadata_json for oc-mirror-run jobs. OperationsStep can show mode (and key paths) from metadata when available.
- No change to SSE or stop semantics.

### 7. Preflight tasks

- Implement checks per Phase E; return blockers and warnings; frontend displays and blocks run on blockers.

### 8. Path/artifact tasks

- All paths user-input or defaulted; no post-run copy/move. Summary and metadata store paths for continuity.

### 9. Security/auth tasks

- No auth in logs or metadata; temp auth file unlinked after run; doc in code and this plan.

### 10. Tests to add

- Backend: preflight endpoint (m2d/d2m/m2m); ocmirror/run with mode and paths (unit or integration with mocked spawn); metadata written to job.
- Frontend: Run tab renders mode selection and paths; preflight result disables/enables Run; no secrets in DOM or export.
- E2E (optional): one m2d dry-run flow.

### 11. Validations to run

- validate-docs-index.js if docs-index touched; validate-catalog if catalogs touched. For this plan: no catalog/docs-index change.

### 12. Deferred / follow-up

- Delete workflows (generate + execute); break-glass reset; signature/registries.d advanced; enclave flows; deep registry reachability.

### 13. Blockers / unknowns

- **Shared Operations/SSE stability:** If log streaming or job list is broken in production, that must be fixed or worked around before relying on it for Run tab. Document as dependency.
- **Field manual path:** Confirmed wrong; fix in implementation pass.

---

## Phase J — Working Doc and Optional Stub Updates

- **Working doc:** This file is the complete plan (Phases 0–I). Placeholder replaced.
- **Optional stub:** RunOcMirrorStep.jsx could add one line in the "Coming soon" note: "Planned: mirror-to-disk, disk-to-mirror, mirror-to-mirror with workspace and cache options." Only if useful for visibility; not required for implementation.

---

## Phase K — Testing / Validation (This Pass)

- **Code changes this pass:** None (doc only).
- **Scripts run:** None. validate-docs-index and validate-catalog not run because no docs-index or catalog file was changed.
- **Result:** No test execution; no regression. If a future pass edits code, it must run the relevant backend and frontend tests and report.

---

## Implementation Pass (v1) — Completed

**Branch:** `feat/oc-mirror-run-tab-v1` (created for this pass; no commit/stage).

### What was implemented

| Contract section | Implementation |
|-----------------|----------------|
| **§1 v1 scope** | mirrorToDisk, diskToMirror, mirrorToMirror; dry-run (m2d only); paths (archive, workspace, cache); config source generated/external; registry URL; auth reuse/pasted/env; preflight; run/stop; job metadata; artifact summary; includeInExport. No delete, no break-glass, no enclave, no signature-policy, no deep reachability. |
| **§2A Preflight** | `POST /api/ocmirror/preflight` with request/response shape; per-mode checks (archivePath, workspacePath, cachePath, config, auth, registryUrl); d2m archive structure; path-overlap blockers; no credential/registry/DNS checks. |
| **§2B Run** | `POST /api/ocmirror/run` extended: mode, dryRun, configSourceType, configPath, authSource, pullSecret, advanced flags; workspacePath, cachePath, registryUrl; temp config/auth lifecycle; job metadata on start and on exit (exitCode, finishedAt, clusterResourcesPath, dryRunMappingPath, dryRunMissingPath). |
| **§2C Stop** | Existing `POST /api/jobs/:id/stop`; no change. |
| **§3 Run tab UI** | RunOcMirrorStep replaced with full v1 UI: Mode, Config source, Paths, Destination/registry, Auth, Advanced (collapsible), Preflight, Run status/last run. Long-help, preflight button, Run gated on no blockers, Stop when running, last-run summary with link to Operations. |
| **§4 Job metadata** | `jobs.metadata_json` TEXT column (migration in db.js); createJob/updateJob/updateJobMetadata in utils; metadata fields: mode, dryRun, archiveDir, workspaceDir, cacheDir, registryUrl, configSourceType, configPath, exitCode, startedAt, finishedAt, clusterResourcesPath, dryRunMappingPath, dryRunMissingPath. Legacy jobs without metadata_json remain readable. |
| **§5 Operations** | oc-mirror-run jobs: mode in row subtitle; expanded details show summary block (mode, status, exit code, paths, registry, cluster-resources, dry-run paths, timestamps). Non-oc-mirror and legacy jobs unchanged. |
| **§6 Artifact/handoff** | Temp config/auth cleaned up; archive/workspace/cache preserved; includeInExport defaults false, adds archive path only; UI warns on export size; summary shows paths for manual continuation. |
| **Start Over safety** | Start Over now checks for active `oc-mirror` runs, conditionally warns in the confirmation modal, and cancels tracked running `oc-mirror` jobs if the user proceeds. Modal includes artifact path reminders to review for partial content. |

### Deviations from contract

- None. Path-overlap rule: archive/workspace/cache overlap is a blocker (per §6C).

### Test results

- **Backend:** 71/71 tests pass. `backend/test/ocmirror.test.js`: preflight invalid mode 400; preflight response shape; run without version confirmed 400 (state explicitly set unconfirmed); run with version confirmed returns jobId and job metadata; createJob + updateJobMetadata persist metadata.
- **Frontend:** 192 passed, 2 skipped. `frontend/tests/run-oc-mirror-step.test.jsx`: Run step renders mode selection and Run disabled until preflight; after preflight with no blockers, Run button enabled.
- validate-docs-index / validate-catalog: not run (no docs-index or catalog changes).

### Still deferred from v1

- oc-mirror **delete**; break-glass **cleanup/reset**; **signature-policy / registries.d**; **enclave** flows; **deep reachability** checks.

### Manual validation checklist (suggested)

- [ ] **mirrorToDisk generated config** — Set archive/workspace/cache paths, run preflight, run; confirm job in Operations with metadata; confirm artifact paths in summary.
- [ ] **mirrorToDisk external config** — External config path, preflight, run; confirm correct config used.
- [ ] **diskToMirror** — Set archive (existing m2d output), workspace, cache, registry URL; preflight, run; confirm CLI and metadata.
- [ ] **mirrorToMirror** — Workspace and registry URL only; preflight, run; confirm no archive/cache in CLI.
- [ ] **dryRun mirrorToDisk** — Enable dry-run, run; confirm dry-run artifact paths in metadata/summary.
- [ ] **Stop/cancel** — Start run, click Stop; confirm job cancelled and partial-artifact message.
- [ ] **Operations metadata** — After run, open Operations, expand job; confirm mode, paths, exit code, timestamps in summary block.
- [ ] **includeInExport** — Enable include in export, run m2d, export bundle; confirm archive path in ZIP; confirm UI warning when enabling.
- [ ] **Manual handoff** — After run, use summary paths to run oc-mirror from CLI with same config; confirm no app-owned moves.

---

## Final Checklist (Answer to Closing Questions)

1. **Is the oc-mirror v2 Run-tab plan now implementation-grade?**  
   Yes. Mode contracts, auth model, preflight shape, job metadata, artifact ownership, and UX sections are concrete enough to implement from.

2. **What is explicitly in v1?**  
   mirrorToDisk, diskToMirror, mirrorToMirror, dry-run (option for m2d), preflight, live logs, Operations history, artifact path summary, stop, include-in-export. Optional advanced: workspace/cache inputs, since, strict-archive, log-level, parallel-*.

3. **What is explicitly deferred from v1?**  
   Full delete (generate + execute); break-glass cleanup/reset; signature-policy and registries.d advanced; enclave flows; deep reachability checks.

4. **Is the working doc now actually complete in-repo?**  
   Yes. This file replaces the placeholder and contains the full hardened plan.

5. **Blockers/unknowns remaining?**  
   (1) Reliance on existing Operations/SSE — if unstable, stabilize or document as prerequisite. (2) Field manual path bug to fix in implementation. (3) No 4.20 release-note scrape for "verify credentials before mirroring" — app leaves runtime verification to oc-mirror.
