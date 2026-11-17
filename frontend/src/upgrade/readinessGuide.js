/**
 * OpenShift Airgap Architect - Upgrade › Readiness: plain-language guidance per check
 * (v2.3.0 owner QA P5).
 *
 * For each check: what it is, why it matters, how to check it (exact commands; read-only unless
 * marked), whether the readiness bundle covers it, what success looks like and what to do if it
 * fails, with the Red Hat documentation for the OpenShift minor it applies to.
 *
 * Documentation links: the book and section titles below were confirmed in the official
 * openshift-docs source for enterprise-4.20, 4.21 and 4.22 (_topic_maps/_topic_map.yml, checked
 * 2026-11-17). Links open the book for that minor; the section path names the page inside it.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { getMinorVersion } from "../../../shared/versionUtils.js";

const DOCS = "https://docs.redhat.com/en/documentation/openshift_container_platform";
const BOOK_TITLE = { updating_clusters: "Updating clusters", operators: "Operators", etcd: "etcd", backup_and_restore: "Backup and restore", disconnected_environments: "Disconnected environments" };
export const docLink = (minor, book, section) => ({
  url: `${DOCS}/${minor}/html/${book}/index`,
  label: `OpenShift ${minor} · ${BOOK_TITLE[book] || book}${section ? ` › ${section}` : ""}`
});

/** Minors the guidance refers to: the one the cluster runs and each minor the route updates to. */
export const routeMinors = (plan) => {
  const current = getMinorVersion(plan?.current || "") || null;
  const targets = [...new Set((plan?.path?.hops || []).filter((h) => h.kind === "minor").map((h) => getMinorVersion(h.to)).filter(Boolean))];
  return { current, targets, next: targets[0] || current };
};

const prepareDocs = (m) => (m.targets.length ? m.targets : [m.current]).filter(Boolean).map((t) => docLink(t, "updating_clusters", `Preparing to update a cluster › Preparing to update to OpenShift Container Platform ${t}`));

/**
 * @returns {null | { what, why, bundle: boolean, commands: Array<{cmd, note?}>, success, failure, docs, caution? }}
 */
export function guideFor(id, plan) {
  const m = routeMinors(plan);
  // No minor known (no current release yet): version-specific links are skipped, never defaulted.
  const cur = m.current;
  const at = (minor, book, section) => (minor ? [docLink(minor, book, section)] : []);
  const cli = at(cur, "updating_clusters", "Performing a cluster update › Updating a cluster using the CLI");
  if (id === "cvo-health" || id === "current-version") return {
    what: id === "cvo-health" ? "The cluster version operator (CVO) runs every update. This checks it reports the cluster as available and not failing." : "Confirms the cluster really runs the release the plan starts from.",
    why: id === "cvo-health" ? "An update started while the CVO reports Failing, or while another update is still in progress, can stall halfway." : "The route, the stages and the instructions are all computed from the starting release. A different release means a different route.",
    bundle: true,
    commands: [{ cmd: "oc get clusterversion" }, { cmd: "oc adm upgrade", note: "read-only without arguments: shows the current version, channel and conditions" }],
    success: id === "cvo-health" ? "AVAILABLE is True, PROGRESSING is False, and there is no Failing condition." : `VERSION shows ${plan?.current || "the plan's current release"}.`,
    failure: id === "cvo-health" ? "Run `oc describe clusterversion version` and read the Failing condition's message; it names the component at fault. Fix that first. Do not start the update." : "Change the current release on the Route step, compute the route again and prepare the stages again.",
    docs: [...cli]
  };
  if (id === "cvo-upgradeable") return {
    what: "The Upgradeable condition on ClusterVersion. When it is False, the cluster refuses to start a minor update (4.y to 4.y+1).",
    why: "It is how the cluster itself says something must be fixed or acknowledged before the next minor: an operator that does not allow it, a pending administrator acknowledgement, or a component that is not ready.",
    bundle: true,
    commands: [{ cmd: "oc adm upgrade" }, { cmd: "oc get clusterversion version -o jsonpath='{.status.conditions[?(@.type==\"Upgradeable\")]}{\"\\n\"}'" }],
    success: "No Upgradeable condition, or Upgradeable=True.",
    failure: "The reason and message name the cause (often an operator or an acknowledgement). Resolve it; updates within the same minor (z-stream) are still allowed meanwhile.",
    docs: [...prepareDocs(m), ...cli]
  };
  if (id === "cluster-operators") return {
    what: "Every cluster operator (the components that make up OpenShift) is available, not degraded and not blocking updates.",
    why: "A degraded or unavailable operator usually makes the update stop partway. Upgradeable=False on any of them blocks the next minor update.",
    bundle: true,
    commands: [{ cmd: "oc get clusteroperators" }],
    success: "Every row: AVAILABLE True, PROGRESSING False, DEGRADED False.",
    failure: "Run `oc describe clusteroperator <name>` for each problem row and follow its message. For olm with Upgradeable=False, an installed operator does not allow the next minor (see Operator compatibility).",
    docs: [...cli]
  };
  if (id === "mcp-health" || id === "cpo-topology") return {
    what: id === "mcp-health" ? "Machine config pools group nodes that receive the same operating-system configuration. This checks none is degraded, paused or still updating." : "A Control Plane Only update pauses every pool except master, so the cluster needs separate worker pools.",
    why: "The update rolls new configuration out to every pool. A degraded or paused pool stops the update from completing on those nodes.",
    bundle: true,
    commands: [{ cmd: "oc get mcp" }, { cmd: "oc get nodes" }],
    success: "Every pool: UPDATED True, UPDATING False, DEGRADED False, and the machine counts match.",
    failure: "Run `oc describe mcp <name>` to see which node and why. Fix the node (often a failed configuration or a drain blocked by a PodDisruptionBudget) before updating.",
    docs: [...cli, ...(id === "cpo-topology" ? at(cur, "updating_clusters", "Performing a cluster update › Performing a Control Plane Only update") : [])]
  };
  if (id === "operator-compat") return {
    what: "Each installed OLM operator must allow the next OpenShift minor before that minor's update. Operators do not have to be updated at every step — only those that block the next minor or whose channel is named after an OpenShift version.",
    why: "An operator that declares a maximum OpenShift version makes OLM set Upgradeable=False, which blocks the minor update. An operator without a declared maximum does not block — but that alone does not mean it is supported on the new minor.",
    bundle: true,
    commands: [
      { cmd: "oc get subscriptions.operators.coreos.com -A" },
      { cmd: "oc get csv -A" },
      { cmd: "oc get clusteroperator olm -o jsonpath='{.status.conditions[?(@.type==\"Upgradeable\")].message}{\"\\n\"}'", note: "names the operators blocking the next minor, if any" }
    ],
    success: "olm is Upgradeable, no installed operator's maximum is below the next minor, and every operator with a version-named channel (for example OpenShift Data Foundation stable-4.y) has a channel for it in the next stage's catalog.",
    failure: "Update the operator first (change its channel if the channel is version-named, then approve the update if it uses Manual approval), from the content mirrored for that stage. Some operators are updated right after each platform minor instead (for example OpenShift Virtualization and OpenShift Data Foundation) — follow that operator's documentation.",
    docs: [...at(m.next || cur, "operators", "Administrator tasks › Updating installed Operators"), ...prepareDocs(m)]
  };
  if (id === "api-removals") return {
    what: "Each Kubernetes version removes some old API versions. This checks no client still uses an API that is removed by a release on this route.",
    why: "After the update, requests to a removed API fail, so anything still using one (operators, CI jobs, scripts) breaks.",
    bundle: true,
    commands: [
      { cmd: "oc get apirequestcounts" },
      { cmd: "oc get apirequestcounts -o jsonpath='{range .items[?(@.status.removedInRelease!=\"\")]}{.status.removedInRelease}{\"\\t\"}{.metadata.name}{\"\\n\"}{end}'", note: "APIs scheduled for removal, with the Kubernetes version that removes them" },
      { cmd: "oc get apirequestcounts <resource>.<version>.<group> -o jsonpath='{range .status.currentHour..byUser[*]}{..byVerb[*].verb}{\",\"}{.username}{\",\"}{.userAgent}{\"\\n\"}{end}' | sort -k 2 -t, -u | column -t -s, -NVERBS,USERNAME,USERAGENT", note: "who still calls one of them" }
    ],
    note: "Red Hat's “Preparing to update” guides for 4.21 and 4.22 list no Kubernetes API removals; the check still reads APIRequestCount so a later change is not missed.",
    success: "No requests in the last 24 hours to an API removed by a release on the route. Clients that run less often than daily (monthly jobs) do not show up; check those separately.",
    failure: "Migrate each client to the replacement API, wait for the counts to drop, then collect the bundle again. The cluster may also ask for an administrator acknowledgement for the removal.",
    docs: prepareDocs(m)
  };
  if (id === "admin-acks") return {
    what: "Some minor updates require an administrator to confirm they reviewed a specific change (for example removed APIs) before the cluster allows them.",
    why: "Until the acknowledgement is given, Upgradeable stays False and the minor update cannot start. The cluster only lists the acknowledgements for the minor it runs now; later ones appear after reaching that minor.",
    bundle: true,
    commands: [
      { cmd: "oc -n openshift-config-managed get configmap admin-gates -o jsonpath='{.data}{\"\\n\"}'", note: "what must be acknowledged, with a description" },
      { cmd: "oc -n openshift-config get configmap admin-acks -o jsonpath='{.data}{\"\\n\"}'", note: "what was acknowledged" },
      { cmd: "oc -n openshift-config patch cm admin-acks --patch '{\"data\":{\"<ack-key>\":\"true\"}}' --type=merge", note: "CHANGES THE CLUSTER: records your acknowledgement. Only after you reviewed and resolved what it describes." }
    ],
    success: "Every gate for leaving the current minor is acknowledged (true in admin-acks).",
    failure: "Read each gate's description and the linked documentation, resolve it, then acknowledge it.",
    docs: prepareDocs(m)
  };
  if (id === "etcd-backup") return {
    what: "A backup of etcd (the cluster's database) taken just before the update, kept off the cluster.",
    why: "If an update fails in a way that cannot be fixed forward, restoring etcd is the documented way back. A backup made after the problem starts is no use.",
    bundle: false,
    commands: [
      { cmd: "oc debug --as-root node/<control-plane-node>", note: "opens a debug shell on one control plane node (this starts a debug pod; it does not change the cluster's configuration)" },
      { cmd: "chroot /host" },
      { cmd: "/usr/local/bin/cluster-backup.sh /home/core/assets/backup", note: "writes the snapshot and static pod resources to that folder on the node" }
    ],
    success: "The script reports a snapshot_<timestamp>.db and a static_kuberesources_<timestamp>.tar.gz. Copy both off the node to safe storage.",
    failure: "Do not start the update without a backup. Fix what the script reports (often disk space on the node) and take it again.",
    caution: "Architect never takes, checks or restores a backup, and never asks you to restore one to test it. Restoring a production cluster is a disaster-recovery procedure, not a check. This item is your statement only and is always shown as such. The static_kuberesources archive can contain etcd encryption keys: store it securely.",
    docs: at(cur, "etcd", "Backing up and restoring etcd data › Backing up etcd")
  };
  if (id === "evidence-age") return {
    what: "How old the uploaded cluster evidence is.",
    why: "Cluster state changes. Evidence from yesterday says nothing about a pool that degraded this morning.",
    bundle: true,
    commands: [{ cmd: "bash oaa-readiness-collector.sh" }],
    success: "Collected within the last day, and again right before each update on the route.",
    failure: "Run the collector again and upload the new file.",
    docs: []
  };
  if (id === "osus-health") return {
    what: "The OpenShift Update Service (OSUS) in the disconnected network serves the update graph to the cluster.",
    why: "With OSUS, the cluster offers only updates the graph recommends; if it does not answer, the cluster shows no updates.",
    bundle: false,
    commands: [{ cmd: "oc get clusterversion version -o jsonpath='{.spec.upstream}{\"\\n\"}'" }, { cmd: "oc adm upgrade", note: "lists the updates the cluster receives from it" }],
    success: "upstream points to your OSUS graph URL and `oc adm upgrade` lists the next release on the route.",
    failure: "Follow the OSUS instructions on the Update the cluster step (graph data image, policy engine route, CA trust).",
    docs: at(cur, "disconnected_environments", "Updating a cluster in a disconnected environment › Updating a cluster in a disconnected environment using OSUS")
  };
  if (id === "cpo-pause-window" || id === "eus-entitlement") return {
    what: id === "eus-entitlement" ? "Control Plane Only updates between even minors rely on Extended Update Support for those releases." : "During a Control Plane Only update, worker pools stay paused across two minors.",
    why: id === "eus-entitlement" ? "Without the entitlement, the EUS releases on this route are not supported for the cluster." : "Paused pools do not receive certificate rotations; the documentation limits how long they may stay paused.",
    bundle: false,
    commands: [{ cmd: "oc get mcp", note: "shows which pools are paused" }],
    success: "You confirmed it against the documentation and your subscription.",
    failure: "Use a standard update instead.",
    docs: at(cur, "updating_clusters", "Performing a cluster update › Performing a Control Plane Only update")
  };
  return null;
}
