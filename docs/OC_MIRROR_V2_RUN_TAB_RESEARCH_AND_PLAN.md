# oc-mirror v2 Run Tab — Implementation-Grade Plan (OpenShift 4.20)

**Purpose:** Blueprint for implementing the "Run oc-mirror" tab so a later pass can implement from this doc without rediscovering fundamentals.

**Status:** Planning complete (second hardening pass). No feature implementation in this pass.

**Doc source:** OpenShift 4.20 Disconnected environments → Chapter 5 "Mirroring images for a disconnected installation by using the oc-mirror plugin v2" (docs.redhat.com).

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
