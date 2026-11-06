# Mirroring workflow (v2.2.0) — contract and status

**Authority:** living design contract for the standalone Mirroring workflow. Canonical
status lives in `docs/BACKLOG_STATUS.md` (owner item **PHX-029**). The UI contract is
`docs/DESIGN_SYSTEM.md`; this file adds Mirroring-specific acceptance rules on top of it.

**Status:** M1 (backend foundation), M2 (shell, navigation, profiles, content selection,
shared release selector), M3 (shared Tools/Home, operator selection, additional images,
profile YAML preview; owner-accepted 2026-10-26 with corrections), M4 (M3 corrections,
one oc-mirror v2 schema authority for both workflows, secure import, scan recovery after
reload), M5 (live catalog verification, structured preflight, mirror to disk with an
immutable plan) and M6 (transfer manifest, verified receive on the disconnected side, disk to
mirror from the received plan, mirror to mirror, profile isolation) and M7 (verified catalog
fetch, catalog identity and offline readiness, real-binary disconnected integration, enterprise
deployment) implemented and released in v2.2.0. v2.2.1 (2026-11-06) fixes Mirroring in the backend container (the
v2.2.0 image could not read its own oc-mirror; see A9).

**How this file is organised.** Part A is the user guide: what Mirroring is and how to run each of
its three workflows. Sections 1–5 are the design contract and implementation record that Part A
summarises; they keep the exact rules, error codes and evidence.

---

## Part A — User guide

### A1. What Mirroring is

Mirroring plans and runs **oc-mirror v2** without an install. It sits beside Install on the landing page
(**Open Mirroring**) and is independent of it: its own profiles, its own OpenShift release per profile, its
own storage, and its own history in **Operations**. Nothing you do in Mirroring changes the Install
workflow, and an Install run export or Start Over does not touch Mirroring profiles.

A **profile** is one piece of content you want to mirror, kept on the server:

- **OpenShift platform** — one release (channel and patch) of OpenShift 4.20, 4.21 or 4.22, plus the
  update graph if you want it.
- **Operators** — packages from the Red Hat, Certified and Community catalogs. With platform content the
  catalogs follow the platform's minor; operators alone need a catalog minor you choose.
- **Additional images** — any container image references. Needs no OpenShift version.

Any combination works. Only 4.20, 4.21 and 4.22 are accepted; another version (for example 4.23 or 5.0,
which Red Hat's update service may already list) is refused everywhere — saving, preview, preflight and
run — and is never silently replaced by a supported one.

### A2. Which workflow, and on which side

| Workflow | Runs where | Needs | Produces |
|---|---|---|---|
| **Mirror to disk** | Connected side (internet or proxy access to Red Hat and the image sources) | Red Hat pull secret for platform/operator content | Archive files (`mirror_*.tar`) in the profile's archive directory |
| **Prepare transfer** | Connected side, after a completed mirror to disk | Nothing new | `SHA256SUMS` and an `oaa-transfer/` folder next to the archives |
| *Carry the files across* | You | Drive, DVD or file share | — |
| **Receive transfer** | Disconnected side | The copied folder, mounted where the server can read it | A verified copy in a profile (`Received: …` if the server did not know the origin) |
| **Disk to mirror** | Disconnected side | Destination registry and its credentials (or anonymous access) | Images in your registry |
| **Mirror to mirror** | One machine that reaches both the sources and your registry | Red Hat pull secret and destination credentials | Images in your registry, no archive or transfer |

The connected side and the disconnected side can be two Architect servers, or one Architect on a laptop
carried across ("Using this same Architect on the disconnected side?" → **Receive a transfer here…**).

### A3. Quick start

1. Landing page → **Open Mirroring** → **New profile**. Name it and choose the content types.
2. **Platform** tab: choose the channel and patch, then **Lock release**.
3. **Operators** tab: **Scan catalogs** once per OpenShift minor (several minutes, needs the Red Hat pull
   secret), then add operators from the catalog or a **Scenario Quick Pick**. **Check catalogs** confirms
   that each selected package and channel exists in the live catalog right now.
4. **Additional images** tab: add image references (**Add several…** accepts a pasted list or an
   ImageSetConfiguration's `additionalImages`).
5. **Show YAML** shows the ImageSetConfiguration: labelled **DRAFT** while the profile still has items to
   fix (not downloadable), the validated file once it is ready.
6. **Run & transfers**: choose the workflow, enter the credentials it needs, review storage and options,
   **Run preflight**, then run. Watch it here or under **Operations**.
7. For a disconnected site: **Prepare transfer** → copy the archives, `SHA256SUMS` and `oaa-transfer/` →
   on the disconnected side **Receive transfer…** → **Disk to mirror**.

Each step is described below.

### A4. Building the content

- **Overview and tabs.** The profile overview shows what is included, the status in words and every item
  still to fix, each with a **Go to** button. Below it the tabs are **Platform**, **Operators · n**,
  **Additional images · n** (only those selected) and **Run & transfers**; a tab holding a problem says
  `· n to fix`. A received profile has no content tabs: its content is the transfer's.
- **Lock.** The lock holds the release steady while you build the rest: refreshing the update service
  cannot change it, and the generated platform content uses exactly that release. Each profile has its own
  lock; Install's lock is separate.
- **Catalog discovery vs Live catalog check.** *Scan catalogs* downloads the three catalog images for one
  minor and lists what they contain; the list is shared by every profile on that server and kept until you
  scan again. *Check catalogs* asks the live catalogs, for your selection only, whether each package,
  channel and version range exists today. Packages that were not found, or a channel that does not exist,
  block the run; anything that could not be checked is reported as not verified, never as passed.
- **Quick Picks** are the same presets as in Install. A pick adds only operators the scanned catalogs
  contain, reports the rest, and removing it keeps operators you also chose yourself.
- **Import YAML…** reads existing ImageSetConfiguration files (up to 10 files, 1 MiB each). Invalid files are
  never applied. Parts the editor cannot represent (several release channels, `oci://` catalogs, Helm,
  blocked images and similar) become explicit review items, and the original file is kept unchanged with the
  profile.

### A5. Credentials

- **Red Hat pull secret (source).** Used by scans, catalog checks, preflight and runs that pull platform
  or operator content. Paste, drag and drop or upload it, or switch on **Use the pull secret mounted into the
  container** (never used unless switched on). A pasted secret is kept in page memory for that profile only,
  so you enter it once per profile and confirm with **Use it here** elsewhere. It is gone on reload, Forget,
  or when the profile is deleted. It is never saved in the profile, in server state, in browser storage, in
  logs or in a transfer.
- **Destination registry (disk to mirror, mirror to mirror).** The destination is the push target
  (`host[:port][/path]`). Destination registry credentials are an auth JSON. **Help me generate** builds it in
  the browser from the registry address, user name and password or token. A warning appears if the
  credentials do not cover the destination. **Anonymous access** sends the placeholder credential documented
  by OKD for registries without authentication; a registry that requires a login refuses it. Destination
  credentials are asked for each run and never stored.
- Mirror to disk sends only the source credentials and disk to mirror only the destination credentials.
  Temporary auth files live in a private memory-backed directory and are removed after the run.

### A6. Running

- **Storage and run options.** Each profile has its own archive, workspace and cache directories under a
  storage location you choose: any directory the server can write, typed or picked with **Browse…**. The
  location can be changed until the profile has written anything. Archives can reach hundreds of GB; see
  [Mirroring storage on its own volume](../README.md#mirroring-storage-volume). Run options (parallel
  images and layers, retries, timeouts, log level, archive size, `--since` for mirror to disk) are saved per
  profile and checked like oc-mirror checks them.
- **Preflight** checks paths, free space and writability, credentials, the destination, the configuration,
  options, the oc-mirror binary (version, commit, SHA-256), registry trust, profile isolation, existing
  archives, the live catalog check and, for disk to mirror, the received configuration's identity, the transfer
  order and the oc-mirror build comparison (A8). A blocking item stops the run.
- **One oc-mirror run at a time** on a server, across Install and Mirroring. Every run writes an immutable plan
  (the exact configuration, its SHA-256, the oc-mirror binary used, options) before oc-mirror starts.
- **Operations** (Profiles | Operations switch) lists every Mirroring run, transfer, receipt and catalog check, and
  the catalog scans started from a Mirroring profile:
  live output, Stop, the stored log (credentials removed), oc-mirror's own error list, archive names and
  checksums, and the outcome. **Run the same again** is offered for runs that stopped for a temporary reason. It
  repeats the original plan exactly, with fresh credentials, and checks the result before reporting it.
- **Disk to mirror network confinement** (on by default): oc-mirror can reach only the destination registry,
  so a transfer that is not complete for offline use fails instead of quietly reaching the internet.

### A7. Transfer integrity

- **Prepare transfer** is offered for the latest completed mirror to disk. It hashes every archive, checks the
  archived image blobs against their digests, records which catalogs oc-mirror pinned to a digest and writes
  `SHA256SUMS` plus `oaa-transfer/`: `transfer-manifest.json` (origin, plan, configuration SHA-256, the
  oc-mirror build, each archive's size and SHA-256), the exact `imageset-config.yaml` and `plan.json`, and
  `README-TRANSFER.txt`. No credential is ever written. A catalog oc-mirror left as a tag makes the transfer
  not ready for offline use; that refuses Prepare unless you confirm **Prepare anyway**, and every later step
  states it.
- On any machine you can check a copy with `sha256sum -c SHA256SUMS`.
- **Receive transfer** re-hashes every file against the manifest before copying anything. It names each problem
  (missing, altered, short copy, extra archive, unsafe names or tar entries) and refuses an unsupported
  OpenShift version.
- **Order.** Each mirror to disk records whether it is a full or a delta cycle and what it follows. The
  disconnected side refuses a delta whose predecessor was never loaded and anything older than what was
  already loaded, before oc-mirror runs; a **Full transfer** is the explicit repair for a gap.
- **Disk to mirror** uses the received configuration byte for byte, never a regenerated one.
- **Limits, as implemented.** Disk to mirror does not carry sigstore signatures through the archive.
  Completeness is checked from the archive and oc-mirror's records, not by re-reading the source. Exit 0 is
  reported as oc-mirror's own claim, and destination checks need the destination reachable.

### A8. The oc-mirror build on the disconnected side

The transfer manifest records the executable SHA-256, version and commit of the oc-mirror that ran mirror to
disk. On receipt, and in the disk-to-mirror preflight, the disconnected side compares it with its own
oc-mirror:

| Result | Meaning |
|---|---|
| **Same bytes** | Exactly the executable the connected side ran. This proves identical bytes only — not FIPS capability, and not that the build suits this machine's RHEL version or CPU. |
| **Different bytes** | A different build. Often intended (the build for this machine's RHEL version or architecture); not by itself a sign of damage. |
| **Not recorded** | The transfer was prepared by an older Architect; nothing to compare. |
| **No usable oc-mirror** | This server has none to compare (disk to mirror needs one). |

The comparison never blocks and never downloads anything. `README-TRANSFER.txt` explains how to check by hand,
offline: `sha256sum "$(command -v oc-mirror)"`, and when the connected side's build came from a recorded Red Hat
release directory, that versioned directory (never `latest`) and its `sha256sum.txt`.

Architect v2.2.0 does **not** put oc-mirror or oc into a transfer; carry the tools yourself. Red Hat documents
only that the oc-mirror binary must match the RHEL version in use; there is no separate FIPS oc-mirror, and
Architect makes no FIPS claim for it. Optional verified tool companions were implemented for v2.2.1 but moved to a
later release, pending a review of binary-level license notices; v2.2.1 does not carry tools either.

### A9. Deployment notes and what is not yet proven

- Enterprise hosts (RHEL 9, rootless Podman 4.9, FIPS, an HTTPS-inspecting proxy, a corporate CA): see
  [Enterprise deployment](../README.md#enterprise-deployment). Catalog downloads verify TLS against the same
  trust oc-mirror uses (`SSL_CERT_FILE`, `SSL_CERT_DIR`, `/etc/containers/certs.d`) and honour the proxy.
- The disconnected side runs with `AIRGAP_RUNTIME_SIDE=high-side` (no update-service warm-up or update check).
- Lab-proven with the exact oc-mirror 4.22.19 against synthetic registries (§3d, §3e, §3g). **Not yet
  demonstrated:** OpenShift platform (release) content into a real disconnected registry, real Red Hat
  operator content mirrored end to end, Quay or other production registries as the destination, a customer
  RHEL 9 / Podman 4.9.4 / FIPS host. Customer acceptance is pending; this guide is not a support statement.
- **v2.2.0 container known issue, fixed in v2.2.1 (released 2026-11-06):** in the v2.2.0 backend image every Mirroring run fails with
  `EACCES` on `/usr/local/bin/oc-mirror`. The non-root backend user could execute the binary but not read it, and
  the run plan hashes it. v2.2.1 installs the bundled tools owned by root with mode 0755. Certification now checks
  the final image as the application user: read, hash and execute oc-mirror and oc, and the backend's own
  resolve-and-hash path.

---

## 1. Owner decisions (approved 2026-10-23)

| # | Decision |
|---|---|
| 1 | **OAA-native Mirroring** (RFC option C). The upstream openshift/mirror-gui project is not embedded or deployed as a companion; useful UX ideas may be borrowed. |
| 2 | **Separate top-level workflow.** Landing page: Install, Upgrade, Mirroring. Mirroring owns its navigation, state, version selections, configurations and operations. Install is unchanged. |
| 3 | **Validation timing.** Validity is computed continuously; inline errors appear after touch/blur or an explicit Proceed. Needs-review alone never produces red errors. The contradictory older `DESIGN_SYSTEM.md` prose is corrected in M2. |
| 4 | **Versions** — *revised at M3 acceptance, 2026-10-26.* With platform **and** operators content, the operator catalog minor is **derived from the platform release minor** (no separate selector; "Operator catalogs follow the selected OpenShift platform minor."). Operators without platform need an explicit catalog minor (never invented). Additional-images-only content needs no OpenShift version. Catalog minors must be supported (4.20/4.21/4.22; No Fallback). A stored catalog minor that differs from the platform (an override saved before the revision, or an imported cross-minor file) is preserved, blocks generation and is reconciled explicitly: align to the platform minor, or split the operators into their own profile. *Original 2026-10-23 wording:* independent versions, mismatch a warning only. |
| 5 | **Profiles.** Each profile owns its selections, state, destination, workspace, cache, archive provenance and history. The Install lock is preserved. One oc-mirror run at a time. Cross-profile contamination is tested before multi-profile execution ships (M6). |
| 6 | **Advanced scope.** delete/reset, signature policy/`registries.d` and enclave flows stay deferred. Mirror-to-disk dry-run previews are in scope. `--since` only where the binary honours it (mirror-to-disk). |
| 7 | **Accessibility.** Shared selection-card semantics and app-wide reduced-motion are done in M2. |
| 8 | **Known defects** found during planning are fixed inside v2.2.0 (M1); no separate v2.1.3. |

## 2. M1 backend contract (implemented)

### State ownership

- `state.mirroring` is **server-owned**: written only by `/api/mirroring/*`.
  `POST /api/state` ignores it, `GET /api/state` and `GET /api/run/export` omit it, an
  Install run import neither erases nor injects it, and Install Start Over preserves it.
- Shape (normalized and size-bounded by `backend/src/mirroringState.js`):
  `{ _schema: 1, activeProfileId, profiles: { <id>: profile } }`; a profile has
  `name`, `content {platform, operators, additionalImages}`, `platform {release, version,
  architecture, graph, kubeVirtContainer}`, `operators {catalogMinor, selected[]}`,
  `additionalImages[] {name, source}`, `execution {mode, registryUrl, lastRunJobId}`, `history[]`.
- Directories are **derived, never client-supplied**:
  `<DATA_DIR>/oc-mirror/profiles/<id>/{archives,workspace,cache}`. Write bodies are strict
  schemas; unknown keys (paths, history, job ids) are refused with 400.
- No state schema bump: `_schemaVersion` stays 3 (the slice is additive and preserved by
  `shared/stateMigration.js`).

### Routes

| Route | Purpose |
|---|---|
| `GET /api/mirroring` | Slice with derived paths, warnings and readiness per profile |
| `POST /api/mirroring/active` | Which profile the UI has open (`{profileId}` or `null`), so it survives a reload (M2) |
| `POST /api/mirroring/profiles` | Create (always unlocked) |
| `POST /api/mirroring/profiles/:id` | Section-wise update (POST, not PATCH: the CORS preflight allows GET/POST/DELETE only); a locked release cannot change (409 `VERSION_LOCKED`); writes never lock |
| `POST /api/mirroring/profiles/:id/lock` · `/unlock` | Neutral lock of the profile's own release (shared handler with `POST /api/operators/confirm`, which is unchanged) |
| `DELETE /api/mirroring/profiles/:id` | Removes the record only; data on disk is never deleted; 409 while running |
| `POST /api/mirroring/profiles/:id/preview` | ImageSetConfiguration for the selected content only |
| `POST /api/mirroring/profiles/:id/preview-draft` | DRAFT of an unready profile (same generator; blockers; never downloadable or runnable) — §3h |
| `POST /api/mirroring/profiles/:id/preflight` · `/run` | Shared preflight/run services with profile paths; never reuse Install credentials |
| `POST /api/mirroring/start-over` | Cancels only Mirroring runs; resets only the slice |
| `POST /api/operators/scan` · `/prefetch` with `catalogMinor` | Catalog discovery without the Install lock (exact, supported minor; 400/422 otherwise) |

### Version boundaries (No Fallback)

422 `UNSUPPORTED_VERSION` at persistence (create/update/lock), generation (preview),
preflight and run, for the platform minor, the platform patch's minor and the catalog
minor, independently and including deselected (retained) sections. The generator
(`buildImageSetConfig(state, { content, catalogMinor })`) re-asserts the same rules;
without `content` it produces the Install configuration unchanged.

### Execution corrections (verified against the shipped binary, oc-mirror `4.22.0…ed9ff0d`)

- **One run at a time** across Install and Mirroring: 409 `OC_MIRROR_RUN_IN_PROGRESS`
  (reservation taken synchronously before any await; freed on Stop). The signature
  auto-retry also respects it.
- **`--cache-dir` for every mode.** mirrorToMirror uses the cache; without the flag it
  wrote to `$HOME/.oc-mirror/.cache`, shared by all runs (ephemeral in the container).
  Install mirrorToMirror now uses its stored cache path.
- **`--since` only for mirrorToDisk** (the binary warns for diskToMirror and ignores it
  for mirrorToMirror); preflight says so.
- **External configs:** parsed with js-yaml (the previous `import("yaml")` named a
  package that is not a dependency, so every external-config preflight failed);
  canonicalised (realpath), contained to the file-browser roots, regular file, ≤ 1 MiB,
  single document.
- A generated-config 422 now marks its job failed instead of leaving it queued.

## 3. M2 user interface (implemented)

- **Entry.** Landing page: Install (unchanged), Upgrade (Coming soon), **Mirroring** (enabled).
  A workflow router above the Install `VersionSupportGate` renders `MirroringShell` beside
  the Install shell, so Mirroring needs no Install release, loads no Install catalogs, and an
  unsupported Install minor cannot lock the user out (its recovery screen offers **Open
  Mirroring**). The open workflow is kept in `sessionStorage` for reloads; Home returns to
  the landing page.
- **Profiles.** Server-backed list (`select-card` buttons with `aria-pressed`), New profile,
  open/select (persisted server-side), rename and change content, delete with a confirmation
  that states mirrored data on disk is kept. Loading, empty, error/Retry and "select a
  profile" states. No credential is ever sent in a profile write.
- **Content selection.** "What would you like to mirror?": profile name plus three
  combinable cards (OpenShift platform, Operators, Additional images; 3 / 2 / 1 columns).
  Continue requires at least one type; validation shows after blur or Continue only.
  Deselecting a saved type keeps its settings and says so.
- **Platform release.** Only when platform content is selected: the shared
  `<ReleaseSelector>` / `useOpenShiftRelease` (extracted from Blueprint) bound to the
  profile, with per-profile Lock / Unlock. Operators and Additional images sections state
  that they are not available in this build. Additional-images-only profiles fetch no
  OpenShift data at all.
- **Shared improvements (app-wide).** Selection cards carry `aria-pressed` and a visible
  "✓ Selected" cue at every call site; `FieldLabelWithInfo` help icons are keyboard
  reachable; `prefers-reduced-motion` honoured; theme preference shared via
  `useThemePreference`. `docs/DESIGN_SYSTEM.md` records the X10 resolution and these rules.

## 3a. M3 content and preview (implemented)

- **Shared Tools drawer and Home.** Install and Mirroring open the same `ToolsDrawer`
  (Navigation → **Home**, Appearance, plus Install-only Run state / Start Over). The theme
  toggle lives only there; one global preference. Home is navigation, never Start Over: it
  makes no API call, cancels no job, deletes no profile. Install resumes the step it left
  (including in-memory secrets, which stay unpersisted); Mirroring reopens the active
  profile; unsaved content-selection drafts are kept for the browser session only.
- **Operator catalog minor.** *(Superseded at M3 acceptance — see §3b: with platform
  content the catalogs now follow the platform minor and there is no selector.)* Shown whenever Operators is selected (4.20 / 4.21 / 4.22),
  with or without platform content. Never invented: operators-only starts empty and the
  profile is not ready until a minor is chosen. With platform content it follows the
  platform minor (`catalogMinorSource: "platform"`) until the user picks one
  (`"user"`). A different minor shows a mismatch warning that claims neither compatibility
  nor incompatibility. Unsupported minors return 422 (no fallback). Images-only profiles
  have no version at all.
- **Scan lifecycle.** A scan is bound to the profile and the minor it started for; results
  apply only if the profile's minor is still that minor. Changing the minor during a scan
  asks: stop and change, change and let it finish (results discarded with a notice), or
  keep. Stop marks the scan superseded before calling `/api/jobs/:id/stop`, so a late
  completion or a failed stop never applies anything. One in-flight start per profile and
  minor (no duplicate POSTs); Lock / Unlock and navigating Home neither start nor cancel
  scans; a running scan is picked up again on return. Changing minor keeps selections as
  intent and re-resolves them through `operatorMinorReconciliation`. Scans use the existing
  scan/job/stop endpoints and are separate from the M1 one-run guard. Catalog metadata is
  shared per minor (the existing cache); selections are per profile and never cross into
  Install.
- **Shared operator UI.** Extracted from the Install Operators step and used by both:
  `OperatorCatalogBrowser` (three catalogs, display-name cards, search by display name
  **and** package name with per-catalog counts and an "All matches" grouped view; search
  never removes a selection), `SelectedOperatorCard`, `OperatorVersionConstraints`
  (min/max help corrected: values are written on the channel, `includeConfig` is not a
  YAML key). Install keeps its behaviour; its mount-time catalog load is now cancelled on
  unmount.
- **Additional images.** Row editor; each row has an id and a provenance (`source`:
  `user` or a suggester); editing a suggested row sets `userModified` so automation may
  never overwrite it. Nothing is added automatically in M3. Validation on blur/Proceed;
  only a fully valid list is saved; duplicates reported.
- **Preview.** The shared `YamlDrawer` (imageset mode) shows the active profile's
  ImageSetConfiguration from the existing generator, labelled with the profile, refreshed
  on change, cleared on profile switch. Not-ready profiles show their readiness list and
  disable Download. The preview API reports per content type whether it is included,
  not selected, or unresolved. No platform channel is ever fabricated; Install output is
  byte-identical (no options passed). The drawer hides the Install-only reveal toggle:
  an ImageSetConfiguration holds no credentials, and Download regenerates the same file.

## 3b. M4 corrections, schema authority, import and scan recovery (implemented)

### M3 owner corrections

- **Catalogs follow the platform.** `deriveCatalogMinor` (server) sets the catalog minor
  from the platform release minor on create, update and lock, and returns selections
  resolved for another minor to intent; a write that sets a different minor is refused
  (`CATALOG_MINOR_FOLLOWS_PLATFORM`). Preserved conflicts are resolved with
  `POST /api/mirroring/profiles/:id/reconcile-catalog {action: "align"|"split"}` (one
  write). A platform-minor change during a scan shows a stale-scan banner with Stop; that
  scan's results are never applied.
- **Search** sits with the available operators (above the selected list), placeholder
  "Search by name or package", width `min(100%, 40rem)`; shared with Install.
- **Remove controls** are compact `ghost mini` buttons. Image rows place the label, then
  the input and Remove on one grid row, then the support band, so validation messages
  never move Remove (verified in a browser with an error shown and cleared, 1366 and
  375 px; the "rows need attention" summary sits below the rows for the same reason).

### One oc-mirror v2 structural authority (DOC-166)

```
oc-mirror binary (global, clients/ocp/latest; verified 4.22.19 ed9ff0d)
        │  API source + probes  ──►  data/oc-mirror-v2/imageset-config-schema.json
        │                                (fields: type/requiredness/enum/format; rules; provenance)
        ▼                                         │
backend/src/imagesetConfigValidator.js  ◄─────────┘   (bounded parser + validator, fails closed)
        ▲            ▲              ▲               ▲
 Install preview   Install       Mirroring        Mirroring import,
 /export/run       external-     preview /        Install external
 (generated)       config        preflight / run  config (uploaded)
                   preflight     (generated)
```

- The schema is **global** (a property of the tool), never copied per OpenShift minor;
  `data/params/4.20/oc-mirror-v2.json` stays inert legacy data (DOC-166 §6).
- **Supported OpenShift minors** are a separate concern: they govern the *values* the
  generator emits (`stable-<minor>`, catalog `:v<minor>` tags) and what import accepts as
  a target, through `versionPolicy` (No Fallback). Structural validity never implies
  version support, and an unsupported minor is never replaced.
- **Structural validity is not availability.** Whether a catalog, package or channel exists
  is a live-catalog question (scan), reported separately: profile status "awaiting live
  catalog verification" until the scanned catalogs for the minor contain each operator;
  the scan data lists default channels only, so a non-default imported channel is not
  checked.
- **Where Architect is stricter than the binary**, each rule records the probe evidence
  (`authority: architect`): extra YAML documents (silently ignored by oc-mirror),
  case-duplicated keys (last wins), unknown channel `type` (silently `ocp`), `apiVersion`
  (unchecked), missing names, empty `mirror`, `archiveSize` < 1, credentials in URLs.
  Case-variant keys are read as documented keys with a warning. Findings say when oc-mirror
  would fail: at load (`binary`) or while collecting (`binary-at-run`).
- Evidence: `backend/test/fixtures/imageset-config/binary-probes.json` (37 probes with the
  binary's verdicts) and `genuine.json` (Red Hat 4.22 documentation examples, including
  the oc-mirror v1 examples the binary rejects, and upstream oc-mirror files). Parity test:
  Install's external-config preflight and Mirroring import reject exactly the same probes.
- **Newly detected Install defect, corrected deliberately:** the archive-size field accepted
  fractions and negatives and the generator emitted them; oc-mirror refuses
  `archiveSize: 4.5`. The field now explains it on blur and the generated file is reported
  invalid (`IMAGESET_CONFIG_INVALID`) instead of being shown, exported or run. Valid inputs
  are byte-identical (924/924 Install artifacts vs `99ba454`).

### Import (`POST /api/mirroring/import/analyze` → `/apply`)

- Up to 10 files, 1 MiB each, 6 MiB total; raw bytes base64-encoded; one YAML document;
  depth ≤ 32, ≤ 20 aliases, ≤ 20 000 expanded nodes, YAML 1.2 core tags only, duplicate keys
  refused. Invalid files are never applied; oc-mirror is never run.
- Mapping never invents a release, catalog minor, channel or package metadata. A package
  without a channel stays without one until the scanned catalogs supply the default, and
  only within the catalog the file named. Parts the guided editor cannot represent
  (several release channels, ranges, custom/digest/`oci://` catalogs, `targetRepo`,
  Helm, blocked images, samples, …) become **unresolved items**: the profile is "needs
  review" until each is left out explicitly; the original keeps them.
- Several files: one profile each (default), one merged profile, or merged into the open
  profile. Conflicting platform releases, catalog minors, package channels/limits and
  archive sizes need explicit resolutions; rows a person typed or edited are never
  removed or changed; duplicates are listed once.
- Originals are stored unchanged (mode 0600) under the profile's own directory
  (`imports/<sha256>.yaml`), hashed, and verified on view; a failed import removes what it
  wrote and changes no state.

### Scan recovery after a browser reload

The scan session identity (`profileId`, minor, job ids, start time — never a credential)
is also kept in `sessionStorage`. A reloaded page reattaches through `GET /api/jobs/:id`:
progress and Stop return; results apply only to the minor the profile still has; jobs the
server no longer knows (restart) are reported and dropped; tampered or foreign stored
sessions are ignored. No second job engine.

### Residual / known (at M4)

- Superseded by §3c: M5 added runs, editable archive size and the F13 fix.

## 3c. M5 content validation and mirror to disk (implemented)

### Live catalog verification (`POST /api/mirroring/profiles/:id/verify-catalogs`)

- For each included operator, oc-mirror's own listing (the scan engine):
  `--v2 list operators --catalog=<image> --package=<name>` for the package and its channels,
  and `--channel=<channel>` for the versions when a min/max is set. The output contract was
  captured from the exact binary (4.22.19) against a synthetic File-Based Catalog in a
  disposable registry (`backend/test/fixtures/operator-package-lookup/`); results are cached
  per catalog image and package (SQLite `operator_package_details`, migration 003).
- Verdicts: **verified**, **package not found**, **channel not found** (definitive; they block
  the run, 409 `CATALOG_VERIFICATION_FAILED`), **no version in range** (states what the
  catalog lists), **not verified** (unreachable, refused credentials, timeout, unexpected
  output). Nothing that could not be checked is reported as passed. Each lookup has its own
  deadline: a registry that accepts connections and never answers hung the binary.
- The verification record belongs to the server: a client cannot write it, and a record for
  a different catalog image, channel or range reads as stale ("not verified").
- One check per profile at a time; it runs as a job (progress, Stop) and is picked up again
  after a reload. The pull secret is used for the check only.

### Structured preflight (shared with Install)

`computeOcMirrorPreflight` now also returns `items` (`id`, `status`: pass / warn / block /
unverified / info, `label`, `detail`), rendered by the shared `PreflightChecklist` in Install
"Run oc-mirror" and in Mirroring. The flat `blockers` / `warnings` stay authoritative for `ok`.
Shared items: paths (nearest existing directory for space and writability), credentials
(content-aware: Red Hat registry credentials only for platform or operator content; an
additional-images-only profile may pull anonymously and is told which image registries the
secret does not cover), mirror registry, configuration, options within the binary's limits,
the oc-mirror binary (version, commit, SHA-256, found without downloading), registry trust
(system store plus `SSL_CERT_FILE` / `SSL_CERT_DIR`). Mirroring adds: profile content,
workflow, configuration identity (SHA-256), profile isolation (realpath containment),
existing archives in the destination, archive size, live catalog check.

### Mirror to disk with an immutable plan

- `POST /api/mirroring/profiles/:id/run` runs **mirror to disk only**; disk to mirror and
  mirror to mirror return 409 `MIRRORING_MODE_NOT_AVAILABLE` until M6 (disk to mirror will run
  from the stored plan, never from a regenerated configuration — DOC-155 H2).
- Before oc-mirror starts, the run writes
  `<DATA_DIR>/oc-mirror/profiles/<id>/plans/<planId>/{imageset-config.yaml,plan.json}`
  exclusively (`wx`) and read-only (0444): the exact configuration given to `--config`, its
  SHA-256, the oc-mirror binary actually executed (version, commit, SHA-256, source), the
  catalogs and packages as generated, the live-verification state, the profile's directories
  and non-secret options, imported originals by hash (never copied or changed). No credential
  or auth-file path is written. The plan file is never deleted; `GET …/plans/:planId`
  re-verifies both hashes before showing it (409 `PLAN_CHANGED` otherwise).
- Runs reuse the shared run service and job engine: live log, progress, Stop, one run at a
  time, history per profile (`GET …/runs`, including automatic signature retries), dry run.
- Run options (parallel images/layers 1–10, retry times, retry delay, image timeout, log
  level, `--since` as yyyy-MM-dd) and archive size (whole GiB ≥ 1) are saved per profile,
  validated like the binary validates them, passed to oc-mirror and recorded in the plan.

### Corrections

- **F13** signature auto-retry: the run's config and auth file are owned by a resources
  object handed to the retry, released exactly once (retry success, failure, Stop, launch
  failure); the retry inherits the original run's signature exemptions plus the failing images.
- **F12** parallel images/layers: 1–10 everywhere (`shared/ocMirrorCliLimits.js`, exact-binary
  probe), Install included.
- **F19** Install lock: the client flushes its debounced save before locking and the server
  refuses an incomplete selection (409 `RELEASE_SELECTION_INCOMPLETE`).
- Preflight path checks failed (`df`) for directories that do not exist yet.

### Residual / known

- Disk to mirror, mirror to mirror, the cross-profile contamination fixture and the
  disconnected high-side test are M6 (done; §3d). DOC-155: baseline arms A1–A3 passed with
  zero egress; perturbation arms B/C ran in M6 (§3d).

## 3d. M6 disconnected execution and profile isolation (implemented)

### Transfer (low side) — `POST /api/mirroring/profiles/:id/transfer {jobId}`

- Offered for the profile's **latest completed, non-dry mirror to disk** only (409
  `NOT_TRANSFERABLE` otherwise; `ARCHIVES_REPLACED` when a later run rewrote the archive
  directory; `PLAN_CHANGED` when the stored plan no longer matches its SHA-256; `PROFILE_BUSY`).
- Runs as a job. Writes next to the archives: `SHA256SUMS` (coreutils format) and
  `oaa-transfer/` = `transfer-manifest.json` (schema `oaa.mirroring.transfer/v1`), the plan's
  `plan.json` and `imageset-config.yaml` (byte copies, 0444) and `README-TRANSFER.txt`.
- The manifest records the origin (profile, plan, plan SHA-256, job), the configuration
  SHA-256, the oc-mirror binary (version, commit, SHA-256, architecture), the content summary,
  each archive's name, size, SHA-256 and whether it carries oc-mirror's `working-dir`, the
  catalogs as oc-mirror pinned them (`isc_pinned_*.yaml` inside the archive), and
  `"credentials": "none …"`. No credential or auth-file path is written.
- **Unpinned catalogs** (a catalog oc-mirror left as a tag instead of a digest) are listed in
  `unpinnedCatalogs` and named in the job message and the README with the remedy: run mirror
  to disk again, then prepare again. Basis: DOC-155 (below).
- Archive tar headers are inspected in place (ustar, GNU long names, pax): absolute paths,
  `..`, links, devices and oversized metadata are refused before anything is recorded.

### Receive (high side) — `POST /api/mirroring/receive {transferDir}`

- `transferDir` must resolve (realpath) under `DATA_DIR` or `/tmp`
  (`TRANSFER_DIR_INVALID`); mount the transfer media there.
- Verification re-hashes **every** file against the manifest and reports each problem with a
  recovery step: missing, altered (SHA-256), short (interrupted copy), extra archive, altered
  configuration or plan, missing manifest, unsafe names, symlinks, unsafe tar entries, and a
  plan whose target minor is unsupported (No Fallback — no substitution). Nothing is copied
  until everything verifies; the copy into `<profile>/received/<planId>/` re-hashes as it
  writes.
- Destination: the origin profile when this server has it (low and high side on one server),
  otherwise a new **received** profile (`kind: "received"`, name `Received: <origin name>`),
  reused for later transfers of the same origin. A received profile's content cannot be edited
  (409 `RECEIVED_PROFILE_READ_ONLY`); its YAML preview is the received configuration.
- `AIRGAP_RUNTIME_SIDE=high-side` (set by the runtime package for the disconnected side)
  skips the Cincinnati warm-up and disables the update check.

### Disk to mirror

- Requires a received transfer (`receivedPlanId`, default the latest). oc-mirror runs with
  `--config` = the **received** `imageset-config.yaml` (the low side's exact bytes; SHA-256
  re-checked before the run — preflight item *Configuration identity*), `--from file://` the
  staged transfer, the profile's own workspace and cache. Never a regenerated configuration
  (DOC-155 H2).
- **Network confinement** (default on, switchable): oc-mirror gets
  `HTTP(S)_PROXY=http://127.0.0.1:9` with `NO_PROXY` = the destination host and loopback, so
  nothing but the destination registry is reachable through the proxy. Preflight reports it
  (pass when on, warn when off).
- No Red Hat pull secret is asked for; destination credentials are per run, never stored.

### Mirror to mirror

- Re-enabled with the profile's own workspace and cache (F14); destination registry saved on
  the profile (`execution.registryUrl`, validated `host[:port][/path]`); both credentials per run.

### Isolation (tested)

Two profiles with different content and catalog minors, repeated runs, a failed run, a
cancelled-then-resumed run: profile A's tree hash is unchanged by every run of B; a second run
while one is active is refused (409); B cannot run A's received plan; received directories are
inside the profile root (realpath containment, preflight *Profile isolation*).

### Disconnected end-to-end (exact binary)

Low side: real mirror to disk → Prepare transfer → copy → `sha256sum -c` 4/4 OK, no credential
in the transfer. High side in a network namespace with a dummy default route, every
non-loopback TCP connect and every DNS query redirected to a tripwire, all other egress
counted and dropped, `nss-resolve` masked: damaged copy refused with recovery guidance; good
copy received into a read-only received profile; disk to mirror with and without confinement
both completed; destination digest = source digest. **Attempted egress: 0** (tripwire 0, nft
0, pcap 0) across backend start-up, receive and both runs. Scope: one additional-image transfer.

### DOC-155 perturbation arms (exact binary, synthetic catalog)

- **Proven:** (H2) a disk-to-mirror configuration that differs from the mirror-to-disk one —
  added, dropped or changed package or channel, or merely **reordered** packages — makes disk
  to mirror pull the source catalog ("Catalog has not been filtered previously") and fail
  disconnected. M6 prevents this by construction (received bytes, identity check).
  (H1-gap) when oc-mirror's best-effort catalog pin fails and the tag moves during collection,
  mirror to disk exits 0 with an archive that disk to mirror cannot use offline; the pinned
  file then keeps a tag — M6 flags it (`unpinnedCatalogs`).
- **Not reproduced:** a moving tag when pinning succeeds; empty, stale or different cache
  directory on the high side; a changed catalog tag (fails fast, no egress).
- **Not tested:** pre-fix oc-mirror builds; which mechanism produced the original report.
- Observed: `--image-timeout` did not bound a catalog pull against a source that accepts and
  never answers (900 s).

### Corrections

- **F14** Install: the cache directory is offered and sent for all three modes; the
  mirror-to-mirror note no longer says the cache is unused.
- **F23** `--since`: the binary accepts only `yyyy-MM-dd` (verified on 4.22.19); the Install
  hint says so and preflight blocks any other value for mirror to disk (`fieldErrors.since`).

### Residual / known (at M6)

- The disconnected test covered additional-image content; platform and operator content on a
  real disconnected registry is M7 owner QA.
- Container scan and the Node runtime advisory (F21) are tracked separately; see the M6
  checkpoint.

## 3e. M7 catalog trust, catalog identity and integration (implemented)

### Catalog fetch and listing

- Catalog scans (`POST /api/operators/scan` / `prefetch`) and live catalog checks
  (`verify-catalogs`) fetch the catalog image themselves (`backend/src/verifiedRegistry.js`):
  TLS verified against the trust oc-mirror uses when it mirrors (Go system roots with
  `SSL_CERT_FILE` / `SSL_CERT_DIR` semantics, `/etc/containers/certs.d/<host>/ca.crt`), the
  corporate proxy honoured with the target verified through the tunnel, token/basic auth sent
  only to HTTPS endpoints the registry named and never across a redirect to another origin,
  every manifest and blob checked against its digest and size, bounded retries for transient
  failures only. The pull secret is used for this download only.
- oc-mirror then lists the digest-pinned copy served read-only on loopback
  (`loopbackRegistry.js`; `--src-tls-verify=false` for that loopback address only, an empty
  per-listing `--authfile`, no network). oc-mirror 4.22 refuses `oci://` for
  `list operators` (its argument check runs before the OCI handling), hence the loopback.
- A certificate that cannot be verified fails the scan or check closed before any request is
  sent; oc-mirror is not started. Untrusted, refused and unreachable read as "Not verified"
  with the reason.
- A failed scan shows its reason in the Operators card (once when every catalog failed for the
  same reason, otherwise per catalog; job metadata `failure: { code, reason }`). A connection
  the backend's `HTTPS_PROXY` refused is reported as the proxy's failure (host and port only,
  never proxy credentials) rather than as the registry being unreachable; nothing was sent to
  the registry. A connected-side backend needs a working proxy or direct access to the registry.
- Identity: each scan stores the reference as written, the digest it resolved to and the
  platform manifest listed (`operator_catalog_identity`, migration 004); each check records
  `catalogDigest`. Cache: `DATA_DIR/catalog-cache`, two most recent layouts per catalog.

### Catalog identity and offline readiness (DOC-155)

- Prepare transfer compares, per catalog, the digest OAA verified at the last check (recorded
  in the plan) with the digest oc-mirror pinned in the archive (`isc_pinned`, newest across all
  archives): **matches-verified**, **differs-from-verified** (catalog changed after the check;
  warning), **not-verified** (never checked), **unpinned** (still a tag).
- A transfer is offline-ready only when every catalog is pinned. An unpinned catalog refuses
  Prepare transfer (`CATALOG_NOT_PINNED`); "Prepare anyway" (confirmation dialog,
  `acknowledgeUnpinned`) records `offlineReady: false`, which the manifest, README, received
  record and the disk-to-mirror preflight (*Catalog identity*, warning) all state.
- No silent tag-to-digest rewrite: pinning a catalog by digest changes the destination tag
  (`sha256-<filtered digest>`) and the generated CatalogSource names, so it remains the
  user's explicit choice in their own configuration.

### Receive result

A successful receipt stays in the dialog with the profile, plan, files verified, manifest
SHA-256 and offline readiness, and offers **Open "<profile>"** and **Receive another
transfer**; nothing switches behind the dialog.

### Real-binary disconnected integration (exact oc-mirror 4.22.19)

Synthetic authenticated TLS registries for `registry.redhat.io` / `quay.io` (custom CA via
`SSL_CERT_FILE`) behind a fault-injecting proxy; Red Hat, Certified and Community catalogs for
4.22 and 4.21; operators-only, mixed, additional-images-only and a 1.25 GB image; authenticated
TLS destination on the high side; both sides in network namespaces with the all-egress
tripwire. Results: live checks verified; identity matches / differs / unpinned as staged;
damaged and incomplete transfers refused with the file named; d2m to the authenticated
destination with source digests preserved; a stopped d2m resumed; the DOC-155 B2r1 transfer
refused, and when accepted it failed disconnected with every attempt captured by network
confinement (~33 s of oc-mirror retries). High side: zero non-loopback egress. A blob larger
than `archiveSize` gets an archive of its own (oc-mirror does not split a blob).

### Not covered automatically

OpenShift platform (release) content on a real disconnected registry; real Red Hat catalogs
and registry token auth; Quay or other production registries as destination; a Podman
4.9.4-rhel host for the deployment procedure.

## 3f. Post-M7 completion (implemented; owner follow-up, not M8)

### Transfer mental model
Mirror to disk downloads into archive files; **Prepare transfer** packages and documents them (checksums,
exact configuration, provenance); **Receive transfer** identifies and verifies every file on the disconnected
side; **Disk to mirror** uploads the verified archive contents; **Mirror to mirror** copies directly. A
transfer is not another mirror run. The run panel shows the five steps with the profile's position in words
(Done / Next / Step n). Same-Architect receipt (a laptop or server carried across) is a link and dialog only;
the dialog can prefill the profile's own prepared transfer, received through the same strict path (re-hash,
containment, copy). Running disk to mirror in place from the low-side archive folder was not implemented:
oc-mirror writes a working-dir into its `--from` directory and every later mirror to disk deletes that
folder's archives (verified), so a verified copy is the only immutable source.

### Run panel order
Choose the workflow → credentials (and destination) for this run, with a line stating what the chosen
workflow needs → live catalog check (operators) → storage and run options → **Received transfers** (disk to
mirror only; selects the transfer to load) → preflight and run → **Prepare the transfer** (mirror to disk
only) → Mirroring activity (history with Details). Mirror to mirror shows no transfer card.

### Operations
**Scope (v2.2.0 stabilization, 2026-11-03).** Listed: oc-mirror runs (all three workflows, dry runs,
automatic signature retries, "Run the same again" attempts), Prepare transfer, Receive transfer, live catalog
checks (`operator-verify`: do the selected packages/channels exist) and catalog scans (`operator-scan`: which
operators the three catalogs for a minor contain; one entry per catalog, linked as "Same scan"; package count,
verified digest, failure reason; Stop while running; no command, archive or retry because a scan copies no
images). Scans are listed only when started from a Mirroring profile by this version (the scan request carries
`profileId`); Install scans, older scans and other servers' scans are not. Not listed: preflight (synchronous,
no job), YAML preview, imports. Records persist in the job table, subject to its retention.

**Source credential (FQ-SCAN-1).** Mirroring scans, live checks, preflight and runs use the same explicit
choice: the pasted Red Hat pull secret (`rhAuthSource: "inline"`) or, only when switched on, the mounted one
(`PULL_SECRET_FILE`, `/run/secrets/pull-secret`, `DATA_DIR/pull-secret.json`, `~/.openshift/pull-secret`;
`rhAuthSource: "mounted"`). `REGISTRY_AUTH_FILE` (Install scans) is never used by Mirroring. "Help me
generate" is offered for destination registry credentials only (owner decision 2026-11-03).

Profiles | Operations switch. `GET /api/mirroring/operations` (all Mirroring jobs, linked: mirror to disk ↔
its transfer ↔ its receipt ↔ the disk to mirror that used it; retry ↔ run), `GET …/operations/:jobId`
(content summary from the verified plan, run outcome, oc-mirror's own `mirroring_errors_*.txt` for the run,
archive names/sizes/SHA-256, storage root), `GET …/operations/:jobId/log` (stored output, already redacted,
colour codes and temporary credential paths removed, header naming the run). Each run records the oc-mirror
binary (version, commit, SHA-256) and its storage root; the command is shown with the credentials file
hidden. **Outcome** reads oc-mirror's exit status as a bit field (1 generic, 2 release, 4 operators,
8 additional images, 16 Helm); exit 0 is reported as oc-mirror's own claim, not an independent check.
Live output, Stop and reattachment use the existing job engine; the open view and operation survive a reload.

### Storage location
See §3g (free choice, like Install's directories); `OAA_MIRROR_STORAGE_ROOT` is only the default for new profiles.

### Bulk images
Section-aware: in a whole ImageSetConfiguration only `additionalImages` entries are taken; `blockedImages`,
`delete`, operators/packages/channels, platform and helm entries are reported by section. Shared validation
in `frontend/src/shared/imageRef.js` (512-character limit, as the server).

### Corrections
- Receive: a folder that is (inside) an already-received copy is refused before anything is read;
  previously staging deleted that copy.
- Receive checks free space before any profile is created or byte copied.
- **Prepare again** always failed for a non-root server (read-only `SHA256SUMS`); fixed.
- Preflight: the archive-replacement warning states the verified behaviour (deleted at run start, also by a
  dry run or a run that then fails); **Transfer order** warns when an older received transfer is chosen after a
  newer one was loaded (oc-mirror rolls the catalogs back and exits 0).
- Help: `--image-timeout` covers all retries of an image; `--since` is not a failed-image retry.

### Known, not fixed here (research: `~/oaa-investigations/v220/recovery-research/`)
- The automatic signature retry passes its workaround only as `CONTAINERS_REGISTRIES_D`, which the shipped
  oc-mirror ignores; it cannot succeed. The flag `--registries.d` works but persists into the workspace.
- One archive folder per profile: a dry run or failed mirror to disk deletes an unprepared transfer.
- A truncated cache blob is archived silently (exit 0); checksums made afterwards pass.

## 3g. Recovery hardening and secure credential entry (implemented; owner-authorized, not M8)

Exact-binary basis: `recovery-research/IMPLEMENTATION_PROOFS.md` (X1–X6) and `OAA_EXACT_BINARY_INTEGRATION.md`
(S1–S4, OAA's own API against oc-mirror 4.22.19) — outside the repository.

### Credentials
- **Help me generate** (superseded 2026-11-03: destination registry credentials only — see §3h) on every Mirroring credential field and in the retry dialog: registry address, user name,
  password or token → auth JSON built in the browser (UTF-8), one or more registries, optionally kept with the
  registries already in the field (explicit; a registry that would change account is refused). Not shown, copied
  or kept.
- Server (`registryAuth.js`): every credential set is parsed and checked; keys normalized only in ways that cannot
  redirect them; errors never echo values or keys; source and destination sets are combined only when they agree
  on every shared registry (`REGISTRY_AUTH_CONFLICT`). Mirror to disk sends only source credentials, disk to mirror
  only destination credentials. Temporary auth files: private memory-backed directory (`/dev/shm/oaa-secrets-…`,
  0700/0600, or `OAA_SECRET_TMPDIR`), swept at start-up. `/api` responses are `no-store`. The mounted secret is used
  only when chosen. A mounted destination-registry secret is not supported.

### Archives are never destroyed (E13)
Mirror to disk deletes top-level `mirror_*.tar` in its destination at start (also dry runs and failing runs).
A successful real run's archives move to `archives/sets/<planId>/` before the job is recorded; before every mirror to
disk any top-level archive is moved into its run's set or `archives/preserved/<time>/`. Prepare transfer reads the
run's own set; older runs stay transferable; failed runs never get a set. History stays in `archives/working-dir`.

### Transfer order
Each successful mirror to disk records its cycle (full/delta, baseline and produced history SHA-256, predecessor
plan); the manifest carries it. The disconnected side records what each destination received and refuses — before
oc-mirror runs — a delta whose predecessor was not loaded (`TRANSFER_GAP`) and anything older than what was loaded
(`TRANSFER_ROLLBACK`); repeats are allowed; legacy transfers are a warning unless provably older. **Full transfer**
(`fullBaseline` → `--since 2000-01-01`) is the explicit rebaseline that repairs a gap. No override for a known rollback.

### Blob content (E5d)
Prepare transfer and Receive hash every content-addressed blob entry (`docker/registry/v2/blobs/sha256/xx/<hex>/data`)
in the same pass as the archive SHA-256 and refuse a mismatch (`CACHE_CONTENT_CORRUPT`, digests listed); nothing is
deleted. Scope: content addressing of archived blobs (manifests are blobs); not a re-download from the source.
Cost: about 1.2 GB/s per core in Node (X4) on top of the existing SHA-256 pass.

### Signature retry (E12/X3)
`--registries.d` with per-repository entries only (oc-mirror ignores `CONTAINERS_REGISTRIES_D`); the workspace copy is
snapshotted and restored exactly (tree hash), with a ledger restored at start-up; an unverifiable restore refuses later
runs on that workspace. Eligible: operator and additional-image failures with the exact signature-read error; never
release images, fatal errors or disk to mirror. Resolved and still-failing repositories are reported; exempted images
are mirrored without sigstore signatures (a cluster that requires them rejects those images).

### Run the same again (manual) and result checks
Operations classify an unfinished run (temporary errors, stop, credentials/certificates → offered; missing source
content, signature-only, unknown → not offered). The retry runs the original plan's configuration and options byte
for byte (new linked plan; SHA-256 asserted), the same profile's workspace and cache, fresh credentials; disk to
mirror re-hashes the received copy first and keeps confinement. Result check before the outcome is recorded:
mirror to disk — archive set, tar safety, blob content, history advanced, catalogs pinned, error list empty;
disk to mirror / mirror to mirror — oc-mirror's own dry run lists the mapping and each destination manifest is fetched
with the attempt's credentials. Outcomes: fully verified / partly verified / incomplete / could not be verified.
No automatic retry loop.

### Storage location (free choice)
Any directory the server can write, typed or picked with **Browse…** (folders listed through the server under the
data directory, /tmp, mounted volumes and existing locations), validated (real directory, not system / application /
another profile's directory, writable; a missing last folder is created), chosen while the profile has written
nothing and nothing runs; fixed afterwards. Layout under it: `profiles/<id>/{archives/sets/<plan>, plans/<plan>,
received/<plan>, workspace, cache}`. `OAA_MIRROR_STORAGE_ROOT` = default for new profiles.

### Known limitations
- d2m does not carry sigstore signatures through the archive (X3); signature retries are not offered for d2m.
- oc-mirror cannot mirror a digest-referenced additional image from a registry with a port (upstream; S1).
- Completeness of a mirror to disk is checked from the archive and oc-mirror's records, not by re-reading the
  source; destination checks need the destination reachable with the attempt's credentials.
- Platform (release) content, real Red Hat registries, FIPS-mode hashing and Podman 4.9.4-rhel not exercised.

## 3h. Profile workspace UX (owner-approved R-UX01..R-UX09, v2.2.0)

Design baseline: `~/oaa-investigations/v220/stabilization/R-UX_DESIGN_RFC_2026-11-03.md` (Option A, approved with refinements).

- **Tabs (R-UX01).** Under the profile overview: `Platform`, `Operators · n`, `Additional images · n` (as selected) and
  `Run & transfers`; one content type → `Content | Run & transfers`; received profiles → no tabs. WAI-ARIA tablist
  (arrows, Home, End). Panels stay mounted (`hidden`), so typed values and running scans, checks and runs survive
  switching. Presentation only: one profile, one saved document, one ImageSetConfiguration.
- **Blockers stay visible.** Each readiness item in the overview has a `Go to` button (`Go to release lock` opens
  Platform and focuses Lock release, or the release section when Lock cannot take focus); a tab holding a blocker
  says `· n to fix`.
- **Sticky Profiles | Operations (R-UX05).** The step header was sticky but its parent shrank to the viewport;
  `.mirroring-shell .step` now grows with its content inside the `.main` scroll container.
- **One transient Red Hat source credential per profile session (R-UX02).** `sourceCredentialSession.js`: pasted
  pull secret or the mounted one (explicit switch), page memory only, keyed by profile; gone on reload, Forget or
  profile deletion; never in the profile, server state, URLs, browser storage, job metadata or logs; never shared
  across profiles; never a destination credential. Entered at one place (scan, check, run, Run the same again), it
  is used elsewhere only after `Use it here`; `Replace` swaps it for the profile (other places accept again).
- **No generator on Red Hat source fields (R-UX03).** Console link, paste, drag and drop, upload. `Help me
  generate` stays for destination registry credentials only.
- **Anonymous destination (owner addition, parity with Install's "Anonymous pulls").** Destination registry
  authentication: real credentials, or anonymous access, which sends the OKD-documented placeholder
  (`{"auths":{"<host>":{"auth":"aWQ6cGFzcwo=","email":""}}}`, https://github.com/orgs/okd-project/discussions/1930)
  for the destination host; preflight says "anonymous access — the OKD placeholder credential". Verified on the
  exact oc-mirror (mirror to mirror into a registry without authentication: exit 0; against a login-protected
  registry: refused with an authentication error).
- **Live catalog check in Operators (R-UX04).** Beside `Selected (n)`: what it asks versus Scan catalogs, the
  session credential, Check/Stop, progress, the job summary and an action per kind of problem (not in the catalog,
  channel not found, no version in range, needs credentials, credentials refused, could not be checked, not checked
  yet, changed since). History: Operations.
- **Selection-first operators (R-UX06).** `Selected (n)` panel beside the catalog browser (sticky, compact rows:
  name, catalog, channel, Quick Pick / imported marks, live-check status, Remove); `Browse | Selected (n)` on
  narrow screens; additions and removals announced.
- **Scenario Quick Picks (R-UX07).** Install's definitions and selection logic, now shared
  (`shared/operatorQuickPicks.js`: `applyScenarioPicks`, `removeScenarioPicks`; `components/operators/
  ScenarioQuickPicks.jsx`); Install's behaviour and output unchanged. Mirroring: the profile's catalog minor, the
  scanned catalogs only; missing packages are reported, never added; ownership by `sources`.
- **Less duplication (R-UX08).** `Latest activity` line (newest operation, status, time, View in Operations); the
  run panel's activity card and the "Storage on the server" card are gone (paths: Storage and run options); a run's
  configuration opens from Operations (`View configuration`).
- **DRAFT preview (R-UX09).** When the validated preview answers `PROFILE_NOT_READY`, the drawer asks
  `preview-draft`: the same generator and schema check over the groups that can be rendered honestly (a selected
  but unlocked release is shown as selected, never invented; unrenderable groups named), labelled DRAFT with the
  blockers and `Go to` buttons. Download is disabled for a draft and only ever fetches the validated route; once
  ready, the validated body equals the draft body.

### Owner refinements (2026-11-03, after §3h acceptance)
- **No "save password?" invitation in Help me generate.** A real `<form autocomplete="off">` that submits to nothing
  (Enter = Use these credentials); fields `autocomplete="off"` (not `new-password`) with the documented opt-outs of
  common password managers; values emptied in the DOM before the dialog is removed. Masking and non-persistence
  unchanged. Browsers and extensions may still ignore these hints — no suppression is guaranteed.
- **Destination and destination credentials agree.** The destination (`docker://host[:port][/path]`, the push
  target) comes first and is required, also for anonymous access; Help me generate starts from its host[:port].
  One generated registry fills an empty destination exactly as typed; one registry that does not cover a set
  destination asks (use it / keep the destination); several registries (generated or pasted) are never guessed;
  a pasted single entry is offered, not forced; Cancel changes nothing; a warning appears whenever the credentials
  cover none of the destination (prefix rule of containers/image). Preflight sends exactly the destination shown.
- **Content tabs stick under the shell header** once scrolled to it (`position: sticky`, offset = measured header
  height `--mirroring-header-h`), and return to their place when scrolling back up.
- **A deliberate tab switch starts at the top of the new panel.** After a click or arrow-key activation, if the reader
  had scrolled past the tab row, the page container (`#mirroring-main`) is moved (instantly, before paint) so the row
  is back at its own place under the header and the new panel starts right below it; near the top nothing moves;
  Go to links still scroll to their own target; nested lists are never scrolled.
- **Transfer companions (oc-mirror / oc next to the transfer):** owner decision 2026-11-04 — Option B for
  v2.2.0 (identity check, §3i); packaging the tools is deferred to v2.2.1
  (`~/oaa-investigations/v220/ux-tranche/TRANSFER_COMPANIONS_RFC_2026-11-03.md`).

## 3i. oc-mirror identity on the disconnected side (Option B, owner-approved 2026-11-04)

- `backend/src/ocMirrorIdentity.js`: `recordedToolIdentity` keeps only well-formed manifest values (64-hex
  SHA-256, commit, architecture, a release directory such as `4.22.19`, never `latest`);
  `compareToolIdentity` → `match` / `different` / `local-missing` / `not-recorded` / `invalid-recorded`;
  `localToolIdentity` finds this server's oc-mirror as preflight does (no download; a regular, non-empty
  file) and reports its source as `OC_MIRROR_BIN` or "built into this image", never a path.
- Receive stores the result on the received record (`toolIdentity`, plus the recorded commit, architecture
  and release) and in the job output; the received transfers list shows it; the disk-to-mirror preflight item
  *oc-mirror build* is pass (match), warn (different, invalid), unverified (no local binary) or info (older
  transfer) — never blocking. Only the SHA-256 decides; a version string is shown for orientation.
- `README-TRANSFER.txt` gains "CHECK OC-MIRROR ON THE DISCONNECTED SIDE (optional, offline)": `sha256sum` of the
  local binary, and the versioned Red Hat directory with `sha256sum -c --ignore-missing sha256sum.txt` when the
  manifest records release and architecture (generic guidance otherwise).
- Transfer format unchanged (`oaa.mirroring.transfer/v1`); older transfers read as *not recorded*. No binary is
  bundled or downloaded. Same bytes is not a FIPS or suitability statement.
- Verified: unit tests (`backend/test/oc-mirror-identity.test.js`), integration tests
  (`mirroring-m6-highside.test.js`, Option B), and the exact-binary harness (mirror to disk → Prepare → copy →
  `sha256sum -c` OK → receive *match*; disconnected side restarted with a different oc-mirror build → *Different
  bytes*, warn, run not blocked).
- Known: the image's baked oc-mirror carries no recorded release directory or architecture at run time
  (`/app/tools-provenance.env` is not read; FQ-TC-4), so its README falls back to generic guidance.

## 4. UI acceptance contract (applies to M2–M7)

Design consistency is a release acceptance requirement. A Mirroring screen is done only
when all of the following hold and have been verified in a real browser:

1. **Primitives:** `Button`, `FieldLabelWithInfo`, `TooltipInfo`, `SecretInput`, `Switch`,
   `Banner`, `CollapsibleSection`, `Modal` (+ `useFocusTrap`), `YamlDrawer`, `.select-card`
   and existing tokens. No raw `<button>`, no new styling system, no hardcoded semantic colours.
2. **Field structure:** `.field-control-stack` / `.field-control-support`; supporting content
   ordered validation → version annotation → helper. Extend the field-structure guard to
   render Mirroring screens and prove it fails on a deliberate violation, then revert.
3. **Validation:** touched/blur/Proceed model (decision 3); no red on untouched fields.
4. **Versions:** supported-minor gating with no implicit minor; platform and catalog minor
   independent (decision 4). The Blueprint release/patch selector and its Update/Refresh
   mechanism are reused through an extracted shared hook/component, not copied.
5. **Help content:** hints use the repository template-literal syntax with what / why /
   example / caveats; no one-sentence or decorative tooltips.
6. **Accessibility:** keyboard traversal, visible focus, `aria-pressed` and a non-colour
   selection cue on selection cards, `role="alert"`/`role="status"` where appropriate,
   app-wide `prefers-reduced-motion`. Never colour alone for selection, validation or status.
7. **Themes:** light and dark, including themed `<select>`, dropdowns, popovers and modals.
8. **Responsive:** 1920, 1366, 768, 375 px and split-screen; 3/2/1 card columns at the
   documented breakpoints.
9. **Evidence:** automated tests plus a brief owner walkthrough
   (`Where | What | Previous | Expected | PASS/CHANGE`), with untested scenarios named.

## 5. Tranches

M1 backend foundation (done, unreleased) → M2 (done, unreleased) shell, landing card, content chooser,
shared release selector, selection-card a11y, reduced motion, X10 doc correction →
M3 (done, unreleased; accepted with corrections) content generation UI, operator picker extraction + search,
additional-images rows with provenance → M4 (done, unreleased) M3 corrections, shared structural
authority, import and structural validation, scan reload recovery → M5 (done, unreleased) content validation, offline
`unverified`, per-profile mirror-to-disk with an immutable plan manifest → M6 (done, unreleased)
transfer manifest and verified receive, disk-to-mirror from the received plan (never
regenerated), mirror-to-mirror, contamination fixture, disconnected high-side test → M7 (done, unreleased) verified catalog fetch, catalog identity and offline readiness,
real-binary disconnected integration, enterprise deployment → post-M7 completion (§3f). All within v2.2.0.
