/**
 * OpenShift Airgap Architect - Upgrade workflow help text (v2.3.0).
 *
 * Field hints follow the app's structured template (what, why it matters,
 * format/example, caveats), like mirroring/mirroringCopy.js.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

export const ARCH_HINT = `The CPU architecture of the cluster's release payload.

**Why it matters:**
The OpenShift update graph is published separately for each architecture, and release images differ by architecture.

**Format:**
x86_64, aarch64 (arm64), s390x, ppc64le, or multi for heterogeneous clusters.

**Example:**
x86_64 for most clusters.`;

export const POLICY_HINT = `Which family of update channels this plan uses.

**Why it matters:**
Stable is the guided default. EUS channels (4.20 and 4.22) allow a Control Plane Only update from 4.20 to 4.22, where worker pools update once at the end.

**Caveats:**
Fast receives releases earlier than stable. Those releases are fully supported but have had less time in the field, and a release that is only in fast cannot be staged for mirroring until it reaches stable.

**Example:**
Stable for a normal update.`;

export const SOURCE_HINT = `Where the update graph comes from.

**Why it matters:**
The graph decides which updates are recommended. On a disconnected system there is no access to api.openshift.com.

**Format:**
Public update graph (fetched by Architect from api.openshift.com only), or an imported graph: a snapshot from a plan package, or the JSON your own OpenShift Update Service returns.

**Caveats:**
Architect never fetches from an address you type; imported graphs are labelled as imported and are never presented as live.`;

export const CURRENT_CHANNEL_HINT = `The update channel the cluster is on now.

**Why it matters:**
The cluster's current release must be in this channel's graph for a route to be computed from it.

**Example:**
stable-4.20. Read it with: oc get clusterversion version -o jsonpath='{.spec.channel}'

**Caveats:**
Only channels of the supported minors (4.20, 4.21, 4.22) are offered.`;

export const CURRENT_RELEASE_HINT = `The exact release the cluster runs now.

**Why it matters:**
The route starts here; it is not mirrored again, because the cluster already runs it.

**Example:**
4.20.14. Read it with: oc get clusterversion version -o jsonpath='{.status.desired.version}'

**Caveats:**
Only releases of supported minors that are in the current channel's graph are listed.`;

export const TARGET_HINT = (channel) => `The release to end on.

**Why it matters:**
Only releases reachable from the current one through recommended updates are offered (computed in ${channel}).

**Caveats:**
Releases reachable only through conditional updates appear only while “Review conditional updates” is on. Releases of unsupported minors are never offered.

**Example:**
4.22.22.`;

export const CHANNEL_STRATEGY_HINT = `How the cluster's channel changes during the update.

**Why it matters:**
The cluster only sees updates that are in the channel it is on.

**Format:**
Per minor (guided): set the channel to each update's minor before that update, as the update documentation describes. Single target channel: stay on the target channel throughout.

**Caveats:**
Every update on the route is checked against the channel the cluster is on for it; a missing update blocks the route.`;

export const SEQ_MODE_HINT = `How the stages are mirrored.

**Why it matters:**
Mirror to disk writes archives you carry across the air gap; mirror to mirror pushes straight into a registry this server can reach.

**Caveats:**
Disk to mirror loads one received transfer at a time, from each stage on the disconnected side.

**Example:**
Mirror to disk on a connected workstation.`;

export const SEQ_REGISTRY_HINT = `The registry and path oc-mirror pushes into.

**Why it matters:**
Every stage is checked against this registry after its run; the content counts as in the registry only when every image is confirmed there.

**Format:**
host[:port]/path, without a scheme.

**Example:**
mirror.example.com:8443/ocp`;

export const SEQ_SOURCE_HINT = `The Red Hat pull secret for every stage of this sequence.

**Why it matters:**
Release images and operator catalogs come from Red Hat registries.

**Caveats:**
Held in this browser tab, and in server memory only while the sequence runs. It is never written to disk, logs, job records or the plan.

**Example:**
The pull secret from console.redhat.com.`;

export const INSTRUCTIONS_REGISTRY_HINT = `Your disconnected registry, used to fill in the commands.

**Why it matters:**
Commands that name release images by digest need the registry and path they were mirrored to.

**Format:**
host[:port]/path, without credentials. Leave it empty to keep a placeholder.

**Example:**
mirror.example.com:8443/ocp`;

export const IMPORT_CHANNEL_HINT = `The channel this graph was requested for.

**Why it matters:**
A graph belongs to one channel and one architecture; it is stored and used under that channel.

**Example:**
stable-4.22 (the channel parameter of the curl command).

**Caveats:**
Only channels of supported minors are accepted.`;

export const IMPORT_ORIGIN_HINT = `Where this graph came from.

**Why it matters:**
The origin is recorded with the graph and shown wherever a route uses it, so nobody mistakes an import for a live fetch.

**Format:**
Your own OpenShift Update Service, or a saved snapshot.

**Example:**
From my OpenShift Update Service.`;

export const JSON_INPUT_HINT = `A JSON document.

**Why it matters:**
Architect validates it before using it and keeps only the fields it needs.

**Format:**
Paste the JSON, choose a file, or drop it here.

**Caveats:**
Nothing here is a credential; do not paste kubeconfigs or Secrets (they are refused).`;

export const INVENTORY_KIND_HINT = `Which read-only export you are importing.

**Why it matters:**
Each kind fills different readiness checks (cluster version operator, operators, machine config pools).

**Format:**
Run the command shown below where the cluster is reachable, and paste its JSON output.

**Caveats:**
Each import replaces the previous one of the same kind.`;

export const PRESET_FILES_HINT = `One or more ImageSetConfiguration files you used before.

**Why it matters:**
They suggest operators, images and release hints so you do not start from nothing.

**Caveats:**
A file says what was asked to be mirrored. It is not evidence of what is installed, mirrored or in your registry; everything it suggests stays unverified until you or a cluster export confirms it.

**Format:**
oc-mirror v2 (v2alpha1) files are fully checked; v1 (v1alpha2) files are read for platform channels, operator packages and additional images only. Up to 10 files, 1 MiB each.`;

export const EXPLORE_SOURCE_HINT = `The exact release the cluster runs, from 4.1 on.

**Why it matters:**
The route starts here. It is found only in Red Hat's update graph as it is today.

**Format:**
x.y.z, for example 4.12.30. Read it with: oc get clusterversion version -o jsonpath='{.status.desired.version}'

**Caveats:**
A release Red Hat no longer lists in any channel cannot be explored; Architect says so and suggests a next step.`;

export const EXPLORE_TARGET_HINT = (newest) => `The release to explore up to.

**Why it matters:**
An older target (for example 4.18) lets you inspect the route without choosing a supported release.

**Format:**
x.y.z, up to ${newest}. Newer minors are not supported by this version of Architect.

**Caveats:**
Exploration shows the route only. Configurations, commands and mirroring are prepared only within the planning range.`;
