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
user guide. Owner UX acceptance is pending.

- [Part A — User guide](#part-a--user-guide)
- [Part B — Design and contracts](#part-b--design-and-contracts)
- [Part C — Evidence and limitations](#part-c--evidence-and-limitations)

---

## Part A — User guide

### A1. Plans

A **plan** is one cluster update. Choose **Upgrade** on the landing page, then
**New Upgrade plan**. Plans are independent: creating, changing or deleting one
never changes another plan, a Mirroring profile or the Install workflow.

Tabs: **Path**, **Operators**, **Content & runs**, **Instructions**,
**Readiness**, **Review & export**. The tab row stays visible under the header
while you scroll (the same mechanism as Mirroring); choosing another tab brings
you to the top of it, and switching keeps everything you typed. **Home** (in
Tools) is navigation only.

### A2. Path — choose the route

1. **Architecture** — x86_64, aarch64, s390x, ppc64le or multi.
2. **Channel policy** — **Stable** (guided default), **EUS** (even minors;
   enables a Control Plane Only update from 4.20 to 4.22), or **Fast**
   (advanced; supported releases with less time in the field).
3. **Graph source** — the public update graph (fetched by Architect from
   `api.openshift.com` only), or an **imported graph**: a snapshot from a plan
   package, or the JSON your own OSUS returns. Architect never fetches from an
   address you type; the Import panel shows the read-only `curl` command to run
   where your OSUS is reachable.
4. **Current channel** and **current release** — each disabled field says what
   it needs first. Only supported minors are offered.
5. **Target release** — only releases reachable through **recommended**
   updates. Releases reachable only through *conditional* updates appear only
   while **Review conditional updates** (Advanced) is on.
6. **Compute the update route.**

The route shows every step, the channel the cluster must be on for it, its
release digest and errata. Its header says **Recommended route** only for a
graph fetched within the last day; otherwise **as of** the graph's time. The
graph's origin, time and SHA-256 are shown; the checksum describes this copy
only — the graph is not signed, so its authenticity is not verified.

Among equally short recommended routes, the one with the highest release at
each step is shown **by convention**. That is not a safety ranking; the other
routes are listed and you may choose any of them (each is validated).

The **Channel graph** (collapsed) draws only the planned route and the selected
release's updates, one lane per minor; it has keyboard zoom/pan (+, −, 0, arrow
keys on releases) and an **Accessible table**.

### A2b. Operators — presets and intent

**Presets from earlier ImageSetConfigurations (optional).** Load up to 10 files
(1 MiB each). oc-mirror v2 files are checked against the v2 schema; v1
(`v1alpha2`) files are read for platform channels, operator packages and
additional images only. For each file you see whether it was read and what was
ignored. Found operators show their channel (choose one when files disagree),
the file(s) they came from and any conflict; conflicting ones start unticked.
Release hints are only hints — using one as the current release asks first
when it would replace your choice. A configuration file says what was *asked*
to be mirrored, not what is installed, mirrored or in your registry, so every
accepted item stays **imported preset — unverified**.

**Operators in this plan** lists each operator's **category** — previously
mirrored or selected (from files), currently installed, new (requested), or
installed and kept without an update — and its **confidence**: imported preset,
imported cluster export, confirmed by you, or entered by you. An imported preset
never replaces an entry confirmed by you or by a cluster export unless you say
so. **Add the selected operators to every stage** adds each operator from that
stage's own catalog minor; selections already in a stage are not changed. The
Mirroring operator browser and Live catalog check then apply per stage.

### A3. Content & runs — what must be in the disconnected registry

Every release the cluster is updated to (not the one it runs) must be in your
registry before that update. **Prepare stages** creates one **stage** per
release; each stage is a Mirroring profile owned by the plan, with exactly one
pinned release (`stable-<minor>`, min = max) and that minor's operator catalog.

For each stage:
- **Add operators to this stage** uses the same operator browser as Mirroring
  (the catalog follows the stage minor).
- The **run panel** is Mirroring's own: preflight, mirror to disk, mirror to
  mirror, disk to mirror, transfers, storage, logs, Stop and history. Upgrade
  runs ask for the post-run **destination check**, so "in the registry" is
  evidence, not assumption.
- **I have updated the cluster to …** records your statement; mirroring never
  marks the cluster as updated.
- A **progress line** shows the stage's steps (planned, mirrored to disk,
  transfer prepared, received, in the registry, registry verified, cluster
  updated) from recorded evidence only — no percentages; steps a
  mirror-to-mirror stage does not need show as "not needed".

**Run every stage in order** previews the exact scope, then runs the stages one
after another through the same preflight and run as a single Mirroring run. It
stops at the first blocked preflight, failed run, or (mirror to mirror) a
destination that is not fully verified; later stages are not run. **Stop the
sequence** stops the current stage and the rest. The Red Hat pull secret is used
from this browser session (Use it here / Replace / Forget) and is held in server
memory only while the sequence runs.

Large archives never go through the browser: they stay in each stage's storage
directory and move with Mirroring's verified transfer (`mirror_*.tar`,
`SHA256SUMS`, `oaa-transfer/`). On the disconnected side, **Receive a stage
transfer** verifies every file and links it to its stage.

In the Mirroring workflow, stage profiles are marked "Upgrade stage"; their
release, unlock and delete are refused there (manage them from the plan).

### A4. Instructions

Three methods, each per step of the route:
- **OpenShift Update Service (recommended)** — one-time setup (registry trust
  under the key `updateservice-registry`, the operator, graph data, the
  UpdateService, pointing ClusterVersion's `upstream` at it), then per step:
  apply the stage's cluster resources, set the channel, check the cluster's own
  recommendation (`oc adm upgrade recommend --version …`, read-only), update
  (`oc adm upgrade --to=…`), watch.
- **CLI without OSUS** — apply each stage's release signature ConfigMap, pause
  MachineHealthChecks, then `oc adm upgrade --allow-explicit-upgrade
  --to-image <registry>/openshift/release-images@sha256:…` with the digest from
  the update graph.
- **Web console** — Administration → Cluster Settings, through the update
  service (it cannot update to an explicit image).

Every step links the documentation of the minor it updates **into** (never 5.0
documentation). Steps list the readiness checks still open ("run only after …").
A conditional update gets **no executable update command**. Control Plane Only
pause/unpause steps are **withheld** until their prerequisites are verified or
attested. Never generated: `--force`, `--allow-upgrade-with-warnings`,
`--allow-not-recommended`, `oc adm upgrade accept`.

### A5. Readiness

Every check is **✓ Verified**, **✕ Blocked**, **⚠ Warning**, **✎ Attested** or
**? Not checked**. Only evidence verifies: an imported read-only cluster export,
a verified registry check, the graph itself. **Attested** is your statement
(for example an etcd backup) and is never shown as verified. Without cluster
evidence, cluster readiness is **not verified**.

**Import cluster evidence** (optional): run `oc get clusterversion version -o
json`, `oc get subscriptions.operators.coreos.com -A -o json`, `oc get csv -A -o
json` or `oc get mcp -o json` where the cluster is reachable and paste the
output. Only names, versions, channels, phases and conditions are kept; the
cluster ID, upstream URL, annotations and anything credential-like are
discarded; kubeconfigs and Secrets are refused.

### A6. Review & export

The review lists the route, channels, strategy, graph sources and their age,
stages and their evidence, and the **artifacts**, each labelled:
**validated configuration** (stage ImageSetConfigurations), **template — fill
in** (OSUS operator, UpdateService, registry CA ConfigMap, ClusterVersion
upstream patch), or **produced by a completed run** (files oc-mirror wrote into
`working-dir/cluster-resources`; never fabricated).

**Download the plan package (.zip)**: the plan, re-verifiable graph snapshots,
validated stage configurations, instructions (Markdown), readiness, templates,
`tools/ACQUIRE_TOOLS.md` and `SHA256SUMS`. It never contains archives,
credentials, imported evidence or attestation notes. On the disconnected side,
**Import plan…** with `oaa-upgrade-package.json`: every checksum is checked
before anything is imported, and the plan is imported read-only. The checksums
show integrity, not who made the package (it is not signed).

**Delete plan…** asks separately whether its stage profile records go too
(default: kept as ordinary Mirroring profiles). Mirrored data on disk is never
deleted; the dialog lists the directories.

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
releases of other minors are refused with 422 `UNSUPPORTED_VERSION`; graph nodes
of other minors are dropped and counted. No route is invented from an
unsupported release.

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

Preview → token → start. Each stage: profile preflight handler, then the
Mirroring run handler (unchanged code paths). Stop on first failure; Stop via
the job; credentials in the sequence closure only; plan deletion refused while
it runs. Restart of the server marks a running sequence as interrupted (stale
job); resume by running the remaining stages.

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
…/:id/operator-intent/apply-to-stages` · `GET /api/start-over/preview`.

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
- UI: Playwright against the isolated QA environment, light/dark, 768/375 px,
  keyboard tabs, Home.

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
- The plan package is integrity-checked, not signed.
