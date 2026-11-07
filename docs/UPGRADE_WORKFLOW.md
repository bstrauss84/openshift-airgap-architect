# Upgrade workflow (v2.3.0)

The Upgrade workflow plans a supported, disconnected update of an OpenShift
**4.20, 4.21 or 4.22** cluster: the route from the OpenShift update graph, the
release content to mirror for every step, the move across the air gap, and the
OpenShift Update Service (OSUS), CLI and web-console steps. It is a workflow of
its own beside Install and Mirroring.

**Architect never connects to a cluster, never starts an update, never patches
ClusterVersion and never approves an InstallPlan.** The cluster's Cluster
Version Operator performs every update.

Status: implemented on `feat/v2.3.0-upgrade` (not released). This document is
the implementation-reconciled RFC (owner-approved rev 2, 2026-11-06) plus the
user guide, updated for the owner-approved UX redesign (2026-11-07). Owner UX
acceptance is pending.

- [Part A — User guide](#part-a--user-guide)
- [Part B — Design and contracts](#part-b--design-and-contracts)
- [Part C — Evidence and limitations](#part-c--evidence-and-limitations)

---

## Part A — User guide

### A0. Plans and steps

A **plan** is one cluster update. Choose **Upgrade** on the landing page, then
**New Upgrade plan**. Plans are independent: creating, changing or deleting one
never changes another plan, a Mirroring profile or the Install workflow. The
plan header has **Rename** and **Delete plan…**.

Six numbered steps, each answering one question; a glyph shows where each stands
(✓ done · ● needs attention · ◐ in progress · ○ not started):

1. **Route** — where am I going, and by which updates?
2. **Content** — what will be mirrored for each release?
3. **Readiness** — can I mirror, and can I update the cluster?
4. **Mirror & transfer** — get the content into the disconnected registry.
5. **Update the cluster** — how an administrator carries out each update.
6. **Handoff** — what is done, what is left, and the download.

The step row and a compact **route strip** (route, content in the registry,
cluster updates recorded) stay visible while you scroll. Choosing a step brings
you to its top; going back keeps everything you chose. **Home** (in Tools) is
navigation only.

### A1. Route

**Cluster today**: architecture, current channel, current release. **Update to**:
target release (only releases reachable through **recommended** updates;
conditional-only ones appear only while **Review conditional updates** is on, in
Advanced) and channel policy (**Stable**, guided default; **EUS**, which enables a
Control Plane Only update from 4.20 to 4.22; **Fast**, advanced). Each disabled
field says what it needs first. Then **Compute the update route**.

The **route rail** shows each release, tinted by its minor (the minor is also
written out), the kind of each update and the channel the cluster must be on for
it. An **EUS** badge appears only when the update graph lists that release in an
EUS channel — never because a minor is even. Select an update for its digest,
errata and any risks. Provenance is one line (host, channel, age) with
**Details** (checksum: integrity of this copy only; the graph is not signed). The
default among equally short routes is the highest release at each step, by
convention, not a safety ranking; other routes can be chosen.

**Graph source**: the public update graph (fetched only from
`api.openshift.com`) by default. **Change source or import a graph…** opens (and
closes) the panel with the read-only `curl` command for your own OSUS and the
import form; Architect never fetches an address you type.

**Explore older releases** (collapsed; exploration only): enter any release from
4.1 and a release to explore up to (for example 4.12.30 → 4.18.10, or
4.19.10 → 4.22.22). The route uses only real recommended updates from each
step's own `stable-4.N` graph, "as Red Hat's update graph lists it today".
Releases before the planning range are marked **outside planning range**, with
links to that minor's documentation; nothing — no stage, configuration, command
or run — is generated for them. When a route reaches 4.20 or later, **Plan the
supported part** fills Cluster today and Update to from its first supported
release. When no route can be shown, the exact reason and a next step are shown
(for example, a release Red Hat no longer lists).

### A2. Content

Every release the cluster passes through must be in your registry before its
update. **Prepare N stage(s)** creates one **stage** per release (a Mirroring
profile owned by the plan, one pinned release, that minor's operator catalog).

- **Stage chips** choose which stage is shown below.
- **Operators across the route** — one row per operator, one column per stage
  (its channel, or —), with its **category** (previously mirrored or selected,
  currently installed, new request, kept) and how that is known (imported preset
  — unverified, imported cluster export, confirmed by you, chosen here).
  **Confirm installed** turns a preset into your statement. **Copy stage N's
  operators to later stages** adds the same packages to each later stage from
  its own minor's catalog; existing selections are never changed.
- The stage card embeds Mirroring's own operator experience: catalog scan,
  **Quick Picks**, browse and search, selected operators, version constraints,
  the **Live catalog check**, and **Additional images**. The Red Hat pull
  secret is the plan's (entered once; see A4).
- **Preview this stage's ImageSetConfiguration** / **Download it** — available
  at any time. **Show YAML** (header) opens the live preview of one stage, chosen
  in the drawer and following the stage shown on Content; it updates by itself
  when the stage's operators, images or plan settings change, and is the same
  validated file as the stage's download and the Handoff package (one generator,
  `POST /api/mirroring/profiles/:id/preview`). A stage that cannot generate yet
  says why; nothing is downloadable then.
- **Category is never assumed.** An operator without a recorded classification
  is **Not classified yet**; under its name the matrix says why it is in the
  stage (added by you, Quick Pick, copied from stage N, from an imported
  configuration, from the plan's operator list). **Bulk edit:** tick operators
  (or **Select shown** — the selection never includes rows the filter hides),
  choose a category and **Set for N selected**; categories already set are kept
  unless **Also replace categories already set** is on; the result says how many
  changed and offers **Undo**. Imported files, Quick Picks and catalog scans are
  never proof of what is installed; "Currently installed" chosen by you is your
  statement, distinct from an imported cluster export.
- **Each stage cell shows evidence from that stage's own catalog:** ✓ verified
  (Live catalog check, or the scanned catalog's default channel), ? channel not
  checked (the package is in the scanned catalog, but a scan records only the
  default channel — run the stage's Live catalog check), ○ not scanned (the
  channel is your selection only), … scanning, ! scan failed, ⚠ no version in the
  range, ✕ not in the catalog / channel missing. None of these is compatibility
  with your running cluster.
- **Catalogs for this route** lists each distinct catalog minor once (all stages
  of a minor share one scan of the Red Hat, Certified and Community catalogs),
  why it is needed and whether it is cached. **Scan N catalog sets not yet
  scanned** runs them one minor at a time with the plan's Red Hat pull secret;
  **Stop** cancels the running jobs; a failure does not stop the next minor; each
  minor can be (re)scanned alone; the matrix updates as each finishes. Nothing is
  scanned without an explicit action; **Scan new stage catalogs automatically** is
  an opt-in for this plan in this browser session. Copying operators to later
  stages reports what each target catalog's scan says about the copied channel
  and never replaces it.
- **Import previous configuration…** (a compact dialog) loads earlier
  ImageSetConfiguration files (up to 10; oc-mirror v2 checked against the
  schema; v1 read for platform channels, operator packages and images only). Each
  file, operator, conflict and release hint is shown with the file(s) it came
  from; accepting adds the ticked operators to every stage (optional) and records
  them as **imported preset — unverified**. A file is never proof of what is
  installed or mirrored; using a release hint as the current release asks first.

### A3. Readiness

Two questions, kept apart:

- **Before mirroring** — stages prepared, mirror registry set, the plan's Red
  Hat pull secret and registry credentials entered (this tab only), the route
  and graph checks. Each row says where to fix it (**Go to …**). Each job still
  runs its own preflight right before it starts.
- **Before updating the cluster** — content in the registry per stage, release
  signatures, cluster health from imported evidence, operator compatibility and
  administrator statements.

States: **✓ Verified** (evidence), **✎ Your statement** (attested; never shown
as verified), **⚠ Warning**, **✕ Blocked** (evidence of a problem), **○ To do**
(work still to do in Architect, such as a stage not yet in the registry) and
**? Not checked** (no evidence yet — missing optional evidence is not a
failure). Evidence checks have **Import cluster evidence**, which opens the
import with the right kind and its read-only command (`oc get clusterversion
version -o json`, `oc get subscriptions.operators.coreos.com -A -o json`, `oc
get csv -A -o json`, `oc get mcp -o json`). Only names, versions, channels,
phases and conditions are kept; cluster ID, upstream URL, annotations and
anything credential-like are discarded; kubeconfigs and Secrets are refused.

### A4. Mirror & transfer

**How content gets to the disconnected side** is entered once for the plan:

- **Method** — **Mirror to disk** (connected side; archives, then a transfer),
  **Mirror to mirror** (reaches both sides; straight into your registry), or
  **Disk to mirror** (disconnected side; loads received transfers).
- **Mirror registry** — `host[:port]/path`, used by every stage (a stage may be
  given its own registry in its details), the update instructions and the OSUS
  templates. A value with a scheme, `@`, user name, password, token, query or
  spaces is refused; credentials are never part of it.
- **Write catalogs under a plan-specific tag** (mirror to mirror / disk to
  mirror) — oc-mirror replaces a catalog tag's content with each stage's
  selection; a plan-specific tag leaves the tags existing clusters use untouched.
- **Credentials** (this browser tab only, never saved): the plan's Red Hat pull
  secret and registry credentials (or anonymous access). They are used for this
  plan's catalog scans, catalog checks and runs — never another plan or a
  Mirroring profile — and are gone after a reload.

**Stages** lists each stage's content and progress (content only: mirrored to
disk → transfer prepared → received → in the registry → verified; steps a
mirror-to-mirror stage does not need show "not needed").

- **Mirror this stage…** — one oc-mirror job for that stage.
- **Mirror all N stages to disk… / to the registry…** — N jobs, one after
  another, each after its own server preflight, stopping at the first failure.

Both open the same confirmation: **Jobs that will run**, **Where the output
goes** (one archive folder per stage, or the registry), **Credentials used**,
**If a job fails**, and **What will not happen** (the cluster is not updated or
contacted; content placed in a registry is not activated in any cluster). For
mirror to mirror, every catalog tag that already exists in the registry, or that
could not be checked, is listed and needs its own acknowledgement; the server
checks again at start.

**Details** shows the stage's run panel (Mirroring's own preflight, options,
log, prepare transfer, received transfers, destination check), with the method,
registry and credentials taken from the plan. **Open in Mirroring ↗** opens the
full Mirroring workspace at that stage; **← Back to Upgrade plan "…" · stage N**
returns to the same plan, step and stage. **Receive a stage transfer…** verifies
a carried transfer and links it to its stage. Large archives never go through
the browser.

### A5. Update the cluster

**These are instructions for an administrator to run. Architect never connects
to, changes or updates your cluster.** Choose **OpenShift Update Service
(recommended)**, **CLI without OSUS** or **Web console**. The mirror registry in
the commands is the plan's (shown, with **Change**); nothing is asked again.

Steps are grouped: before the first update (including one-time OSUS setup), then
one card per update. Each update card keeps three things apart: **content for
that release** (evidence from runs and checks), **cluster evidence** (only an
imported ClusterVersion), and **I have completed this update** (your statement;
never inferred from mirroring). Every step cites the documentation of the minor
it updates into. Conditional updates get no executable update command; Control
Plane Only steps are withheld until their prerequisites are verified or attested.
Never generated: `--force`, `--allow-upgrade-with-warnings`,
`--allow-not-recommended`, `oc adm upgrade accept`.

**Download these instructions** (all, or one update's steps) is available at any
time — you do not have to finish an update to get the files to carry it out.

### A6. Handoff

A summary: route, content in the registry, operators, readiness, cluster updates
recorded (your statements) and **Still to do** (each with **Go**). **Download the
handoff package (.zip)** — available at any time: the plan, re-verifiable graph
snapshots, validated stage configurations, instructions, readiness, templates,
`tools/ACQUIRE_TOOLS.md` and `SHA256SUMS`; never archives, credentials,
imported evidence or attestation notes. **Individual files** (collapsed) lists
each file with its label — **validated configuration**, **template — fill in**
or **produced by a completed run** — and Preview / Download. On the disconnected
side, **Import plan…** checks every checksum before importing (read-only; the
checksums show integrity, not authorship).

**Delete plan…** (plan header) asks separately whether its stage profile records
go too (default: kept as ordinary Mirroring profiles). Mirrored data on disk is
never deleted.

### A7. Client tools

Mirroring and Upgrade do not package `oc` or `oc-mirror` (pending the
third-party notice assessment, `docs/N5_TOOL_REDISTRIBUTION_ASSESSMENT.md`).
`tools/ACQUIRE_TOOLS.md` names the exact versioned directory and recorded
SHA-256 of the oc-mirror build the stages ran, `oc` from `latest-<target
minor>`, and the `sha256sum -c` check. Install's existing optional bundling is
unchanged.

---

## Part B — Design and contracts

### B1. Supported versions

Exactly 4.20, 4.21 and 4.22 (`backend/src/versionPolicy.js`). Channels and
releases of other minors are refused with 422 `UNSUPPORTED_VERSION` for
planning; graph nodes of other minors are dropped and counted. No route is
invented from an unsupported release.

**Exploration tier (owner decision D-1, display only).** `POST
/api/upgrade/explore` routes between releases from 4.1 up to the newest supported
minor. It reads `stable-4.N` graphs from the same host into a separate `explore`
cache that planning never reads (`readCachedGraph` refuses that source; planning
still answers 422 for `stable-4.12`). `exploreRoute` (shared) merges the per-step
graphs so an edge into minor N comes only from `stable-4.N`, then runs the
unchanged solver. Nothing is synthesized, no plan changes, and nothing is
generated for releases outside the supported range; targets above the newest
supported minor are refused (422). Reason codes: `SOURCE_OUT_OF_RANGE`,
`TARGET_UNSUPPORTED`, `TARGET_NOT_NEWER`, `SOURCE_NOT_IN_GRAPHS` (with a next
step), `TARGET_NOT_IN_GRAPHS`, `NO_RECOMMENDED_PATH`, `GRAPH_UNAVAILABLE`.

### B2. Graph retrieval (`backend/src/updateGraph.js`)

- One fixed host: `https://api.openshift.com/api/upgrades_info/v1/graph`;
  allowlisted channel (`stable|fast|eus-4.<supported>`) and architecture
  (`amd64|arm64|s390x|ppc64le|multi`; the API rejects `x86_64`).
- No redirects, 15 s timeout, 4 MiB streamed cap, strict schema (node/edge
  caps, edge indexes in range). An empty graph (the API's 200 answer for an
  unknown channel or arch) is an error.
- The cache is written only after validation, with source URL, time, body
  SHA-256 and the exact raw bytes (so a package snapshot can be re-verified).
- Imports (customer OSUS or snapshot) are validated identically and labelled
  with their origin; they are always shown "as of" and never as live.
- The disconnected side (`AIRGAP_RUNTIME_SIDE=high-side`) never fetches.

### B3. Path solving (`shared/upgradePath.js`)

- BFS over **recommended** edges only; conditional edges are kept apart with
  their risks and used only on explicit review. No edge is synthesized.
- One minor per update; versions only increase.
- Each hop is validated in the channel the cluster is on for it (per-minor
  guided default; single target channel only when every hop exists in it).
- Equal-length tie-break: highest version at each step (display convention).
- Control Plane Only: eus-4.22, 4.20 → 4.22 only; the 4.21 hop is marked.
- Deterministic reason codes: `SOURCE_UNSUPPORTED`, `TARGET_UNSUPPORTED`,
  `SAME_VERSION`, `DOWNGRADE`, `SOURCE_NOT_IN_GRAPH`, `TARGET_NOT_IN_GRAPH`,
  `TARGET_NOT_IN_CHANNEL`, `CPO_NOT_ELIGIBLE`, `NO_RECOMMENDED_PATH`
  (+ whether a conditional route exists), `NO_PATH`, `EDGE_NOT_IN_STEP_CHANNEL`.

### B4. oc-mirror v2 and even/odd channels (Red Hat Solution 7087007)

The solution describes oc-mirror **v1** (`v1alpha2`) failing on mixed even/odd
channels. Exact-binary evidence (oc-mirror `4.22.0-202609221258…5b31abd`,
SHA-256 `4d0d4f91…`, `--dry-run`, 2026-11-06) for **v2** (`v2alpha1`):

| Configuration | Result |
|---|---|
| eus-4.20 + eus-4.22 (pinned) | **fails**: `NoVersionsFound … "eus-4.21"` (v2 still steps one minor; eus-4.21 is empty) |
| stable-4.20 + 4.21 + 4.22, each pinned min = max | succeeds but **adds 4.20.44** (oc-mirror's own head-to-head chain) |
| single eus-4.22, 4.20.14 → 4.22.22, `shortestPath` | 4.20.14, 4.20.44, 4.21.40, 4.22.22 (matches the recommended route here) |
| single stable-4.21, min = max = 4.21.40 | exactly one release payload (+ its components) |
| stable-4.20 with only `maxVersion` | pulls **4.18.x and 4.19.x** releases |

Therefore Architect never asks oc-mirror to solve the route. It computes the
route, then generates **one ImageSetConfiguration per required release**, one
platform channel each, `minVersion = maxVersion`, no `shortestPath`/`full` —
exactly the shape the Mirroring generator already produces and validates. That
triggers none of the cross-channel logic, so even/odd separation is not needed
as a rule. Multi-channel configurations stay unused unless future exact-binary
evidence justifies them.

### B5. Stages (`backend/src/upgradeStages.js`)

One stage per release the cluster is updated to, in update order; graph-data
image on the first stage only. A stage profile carries `ownedBy {workflow:
upgrade, planId, stageId}`; the Mirroring API refuses changing its release,
removing its platform content, unlocking and deleting it (409
`PROFILE_OWNED_BY_UPGRADE`); operator, image and run choices stay editable.
A release that is only in fast (not stable) is refused for staging
(`STAGE_RELEASE_NOT_IN_STABLE`). Re-preparing reuses matching stages and
releases (never rewrites) a stage whose release left the route. Stage status
comes only from evidence: mirrored to disk, transfer prepared/received, in the
registry, registry verified (`verifyDestination`: oc-mirror's dry-run mapping,
then a manifest fetch per image).

### B6. Sequences

Preview → token → start, for one stage (`stageIds: ["s2"]`, "Mirror this
stage…") or several ("Mirror all…"); one code path and one confirmation. Each
stage: profile preflight handler, then the Mirroring run handler (unchanged code
paths). Stop on first failure; Stop via the job; credentials in the sequence
closure only; plan deletion refused while it runs. Restart of the server marks a
running sequence as interrupted (stale job); resume by running the remaining
stages.

Mirror to mirror: the destination is the reviewed registry, else the stage's own,
else the plan's. The preview lists what each stage writes (`writes.releases`:
version-specific release tags; `writes.catalogs`: the catalog repository and tag
— the source tag, or the plan-specific `targetTag`). Verified on the exact
oc-mirror 4.22.0 binary against an isolated registry: a filtered catalog is
pushed to the source tag and **replaces** that tag's content (an image whiteout
of `/configs` plus the new packages), while `targetTag` writes a separate tag and
leaves the original untouched. Therefore `POST …/sequence/destination-check`
(read-only manifest GETs with the request's destination credentials) reports
each catalog tag as existing, absent or unknown, and starting needs every
existing-or-unknown tag in `acknowledgedOverwrites` (checked again at start; 409
`CATALOG_OVERWRITE_NOT_ACKNOWLEDGED`). Architect never applies CatalogSource,
IDMS or ITMS resources.

### B7. Server-side run contract (N4 and source credentials)

Every run path (Install, Mirroring, "Run the same again", Upgrade stage and
sequence) re-applies the preflight's destination-credential, source-credential
and trust rules in `startOcMirrorRun` (shared `destinationCredentialProblem`
and the preflight's pull-secret validators). Source rule: mirror to disk and
mirror to mirror with Red Hat content (every Install run; any Mirroring platform
or operator content; retries by the original plan's content) need a pull secret
with a Red Hat registry; additional-images-only content may pull anonymously but
a given secret must be valid; disk to mirror needs no source credential. Anonymous
destination access is an explicit `destinationAuth: "anonymous"` (the server
supplies the OKD placeholder). Missing credentials or a blocked trust store →
409 `PREFLIGHT_BLOCKED` before anything is spawned.

### B7a. Plan mirror settings and registry references

`plan.mirror = { registryUrl, method, catalogTag }` (`POST …/:id/mirror`). The
registry reference is validated and normalized by `shared/registryReference.js`
(`host[:port][/path]`, lowercase host; refused without echo: schemes, `@` or
userinfo, query, fragment, whitespace, control characters, token-like path parts,
over-long values). The same validator now guards every registry reference the
server accepts (run and preflight bodies, Mirroring destinations, the sequence,
instruction overrides). A new registry propagates to every stage that followed
the previous one; a stage given its own keeps it. `catalogTag: "plan"` sets each
stage's `operators.catalogTargetTag` (`v4.NN-oaa-<plan>`), emitted as
`targetTag` in its ImageSetConfiguration. Credentials are never part of these
settings; the browser keeps one memory-only credential context per plan
(`upgrade-plan:<id>`; source and destination).

### B7b. Presets and operator intent (`backend/src/upgradePresets.js`)

Analysis is pure (nothing stored): shared safe YAML parser (size, encoding,
depth, aliases), v2alpha1 through the shared structural validator, v1alpha2
field by field; per-file provenance (base name + SHA-256); duplicates merged;
differing channels and unsupported minors reported; nothing widens support.
`operatorIntent` entries carry category, confidence and sources; an
`imported-preset` entry never replaces a `cluster-export`/`user-confirmed` one
without `replaceConfirmed`. Applying to stages adds packages at each stage's
catalog minor and never changes existing selections; preset images go to the
last stage.

### B8. Reset and isolation contract (owner RFC §18)

| Action | Changes | Always preserved | Jobs |
|---|---|---|---|
| New Install (`POST /api/start-over` with preview token) | Install state | `mirroring`, `upgrade` slices | cancels only running jobs tagged `workflow: install`, only if asked |
| Install autosave / run import / export | Install state only | server-owned slices stripped/kept | — |
| `POST /api/mirroring/start-over` | nothing (410 Gone) | everything | — |
| New Mirroring profile / New Upgrade plan | adds one record | everything else | — |
| Delete Upgrade plan | plan record (+ stage profile records only on request) | disk data, jobs | refused while running |
| Home / workflow switch / reload | nothing | everything | — |

- `backend/src/workflowSlices.js` holds the single list of server-owned slices
  and the helpers; a structural test fails on any unreviewed state write.
- Job ownership is positive; a running job without a recognised tag is never
  cancelled (reported as unclassified).
- Temp sweep keeps every tracked (in-use) file and every file of a running job.
- `GET /api/start-over/preview` and the reset share `planInstallReset`; a scope
  change returns 409 `RESET_SCOPE_CHANGED`.
- A stored `upgrade` slice from a newer Architect blocks Upgrade only (409
  `UPGRADE_SCHEMA_UNKNOWN`) and is never normalized away.

### B9. Security and privacy

- No user URL is fetched (no SSRF surface); one hard-coded graph host.
- No credential, cluster ID, kubeconfig or token is stored in state, plans,
  snapshots, packages, job metadata or logs (canary tests). Attestation notes
  and imported evidence never leave the server in packages.
- Checksums are described as integrity only; nothing claims authenticity.
- Only read-only, user-run commands are suggested for evidence.

### B10. API (all under the existing access control; strict bodies)

`GET /api/upgrade` · `POST /api/upgrade/plans` · `POST|DELETE
/api/upgrade/plans/:id` · `POST /api/upgrade/active` · `GET
/api/upgrade/graph` · `POST /api/upgrade/graph/refresh|import` · `GET
…/:id/targets` · `POST …/:id/solve` · `POST …/:id/stages` · `GET
…/:id/deletion-preview` · `POST …/:id/sequence/preview|sequence` · `GET
…/:id/readiness` · `POST|DELETE …/:id/inventory` · `POST …/:id/attest` · `POST
…/:id/cluster-progress` · `GET …/:id/instructions` · `GET …/:id/artifacts` ·
`GET …/:id/package.zip|package.json` · `POST /api/upgrade/import` · `POST
…/:id/presets/analyze` · `POST …/:id/operator-intent` · `POST
…/:id/operator-intent/apply-to-stages` · `POST …/:id/mirror` · `POST
…/:id/stages/:stageId/copy-operators` · `POST …/:id/sequence/destination-check`
· `POST /api/upgrade/explore` · `GET /api/start-over/preview`.

Readiness checks carry `group` (`route` / `content` / `cluster`) and `action`
(`{kind: "import", inventoryKind}` or `{kind: "step", step}`); `PENDING` marks a
to-do in Architect (it gates the instructions like `BLOCKED` but is not evidence
of a problem).

---

## Part C — Evidence and limitations

### C1. Evidence (development environment)

- Backend tests: `backend/test/upgrade-*.test.js`, `n4-preflight-run-contract`,
  `workflow-reset-isolation`, `workflow-slices-boundaries` (fail-first where
  they reproduce a defect).
- Frontend tests: `frontend/tests/upgrade-ui.test.jsx`,
  `start-over-ocmirror-warning.test.jsx` (scoped reset).
- Graph fixtures: verbatim captures of the public graph (2026-11-06) with
  provenance, `backend/test/fixtures/upgrade-graph/`.
- Exact-binary: the B4 table; and a stage dry run through the Upgrade API on an
  isolated QA backend (live graph → 4.20.14 → 4.20.44 → 4.21.42 → 4.22.22; stage
  2 mapping = one release payload + 190 components).
- UI: Playwright against the isolated QA environment, light/dark, 1366/390/375
  px: no sideways overflow on any step, labels next to their controls, the
  graph-source panel toggling, every Route select opening at 10/50/90 % of its
  width, the confirmation dialog contents, Open in Mirroring and back.
- UX correction defects reproduced before their fixes: F1 (a stage's operator
  selection saved into another stage; `upgrade-f1-stage-operator-isolation`),
  and the release dropdown that seemed to open only from its arrow (Chrome 157:
  the Target select was disabled during a `/targets` round trip and its options
  were then replaced, closing a just-opened popup; now computed in the same
  render).
- Exploration: live against `api.openshift.com` (2026-11-07): 4.14.10 → 4.14.58
  → 4.15.59 → 4.16.55; 4.19.10 → 4.19.55 → 4.20.46 → 4.21.42 → 4.22.22 (first
  supported 4.20.46); 4.23 → 422.

### C2. Not verified here

- Non-dry stage mirroring of Red Hat release content (needs a Red Hat pull
  secret; none authorized for QA). The transfer/receive/disk-to-mirror engine is
  the existing Mirroring engine.
- A real cluster update, a real OSUS, real conditional-risk evaluation on a
  cluster, RHEL 9 / FIPS / proxy / non-amd64 customer environments.
- Documentation URLs: docs.redhat.com refuses automated requests (HTTP 403);
  `data/upgrade-docs/upgrade-docs.json` records how each was established and
  awaits human confirmation.
- Operator OpenShift-compatibility metadata (`olm.maxOpenShiftVersion`) is not
  read offline: compatibility is "not checked" unless attested.

### C3. Known limitations

- Stages pin releases from `stable-<minor>`; fast-only releases cannot be staged
  until promoted.
- Stage profiles keep separate caches (profile isolation), so layers shared
  between releases are downloaded per stage.
- `multi` architecture plans are planning-only (no stage generation).
- A sequence runs mirror to disk or mirror to mirror; disk to mirror runs per
  received stage.
- Exploration shows today's recommendations only; it cannot reconstruct what was
  recommended in the past, and documentation links for older minors await human
  confirmation.
- The catalog-tag check needs the destination reachable from this server; an
  unreachable destination is "could not be checked" and must be acknowledged.
- The plan package is integrity-checked, not signed.
