/**
 * Upgrade readiness (v2.3.0, RFC §8.7).
 *
 * Every check has one of five states, and only evidence moves a check to
 * VERIFIED:
 *   VERIFIED     evidence Architect holds (an imported cluster export, a
 *                verified registry check, the graph itself)
 *   BLOCKED      evidence that something prevents the update
 *   WARNING      evidence of a risk that does not by itself block
 *   ATTESTED     the administrator's own statement — recorded as judgment,
 *                never shown as verified
 *   NOT_CHECKED  no evidence either way
 * Without imported cluster evidence, cluster readiness is "not verified".
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { getMinorVersion } from "../../shared/versionUtils.js";

export const STATES = Object.freeze(["VERIFIED", "BLOCKED", "WARNING", "ATTESTED", "NOT_CHECKED", "PENDING"]);
/**
 * v2.3.0 UX: PENDING = work still to do in Architect (for example a stage not yet in the registry).
 * It gates the update instructions like BLOCKED, but it is not evidence of a problem and is shown
 * as a to-do with the step that does it. Every check also names its group and its next action.
 */
const GROUP = (id) => (/^(route|graph-freshness|current-channel)$/.test(id) ? "route" : /^(content|signatures)/.test(id) ? "content" : "cluster");
const INVENTORY_FOR = { "cvo-health": "clusterversion", "cvo-upgradeable": "clusterversion", "current-version": "clusterversion", "mcp-health": "mcp", "cpo-topology": "mcp", "operator-compat": "csv" };
const actionFor = (id, state) => {
  if (state === "VERIFIED") return null;
  if (INVENTORY_FOR[id] && state !== "ATTESTED") return { kind: "import", inventoryKind: INVENTORY_FOR[id] };
  if (/^(content|signatures)/.test(id)) return { kind: "step", step: "mirror" };
  if (/^(route|graph-freshness|current-channel)$/.test(id)) return { kind: "step", step: "route" };
  return null;
};

/** Checks an administrator may attest (things Architect cannot observe). */
export const ATTESTABLE = Object.freeze({
  "etcd-backup": "A current etcd backup exists and was verified to restore (per the target release's backup documentation).",
  "api-removals": "Workloads were checked for APIs removed in the target Kubernetes version (APIRequestCount review) and migrated.",
  "admin-acks": "Every administrator acknowledgement the cluster requires for this update (admin-gates) has been reviewed and given.",
  "osus-health": "The OpenShift Update Service is installed, its graph URL answers, and ClusterVersion's upstream points to it.",
  "cpo-pause-window": "The documented limit on how long machine config pools may stay paused (certificate rotation) is understood, and the whole Control Plane Only window fits within it.",
  "eus-entitlement": "The cluster is entitled to Extended Update Support for the EUS releases on this route.",
  "operator-compat": "Every installed operator was confirmed to support each OpenShift minor on this route before that minor's update."
});

const check = (id, state, title, detail, extra = {}) => ({ id, state, title, detail, group: GROUP(id), action: actionFor(id, state), ...extra });
const attestedOr = (plan, id, title, notChecked) => {
  const a = plan.readiness?.attestations?.[id];
  return a?.at
    ? check(id, "ATTESTED", title, `Stated by the administrator ${a.at}${a.note ? ` (“${a.note}”)` : ""}. This is administrator judgment, not verified by Architect.`, { attestable: true })
    : check(id, "NOT_CHECKED", title, notChecked, { attestable: true, attestText: ATTESTABLE[id] });
};

const cond = (inv, type) => inv?.clusterVersion?.conditions?.find((c) => c.type === type);

/**
 * @param {object} plan - normalized plan (with path, stages, inventory, readiness)
 * @param {object} ctx
 * @param {string} ctx.pathStatus - none | current | as-of | graph-changed | graph-missing
 * @param {Array} ctx.stageViews - upgradeStageViews(plan)
 * @param {Record<string, {exists: boolean|null}>} ctx.signatureEvidence - by stage id
 */
export function evaluateReadiness(plan, { pathStatus = "none", stageViews = [], signatureEvidence = {} } = {}) {
  const checks = [];
  const inv = plan.inventory;
  const path = plan.path;

  // Route and graph.
  if (!path) checks.push(check("route", "NOT_CHECKED", "Update route", "No route has been computed yet."));
  else {
    const missing = path.hops.filter((h) => h.channelCheck === "missing");
    const notChecked = path.hops.filter((h) => h.channelCheck === "not-checked");
    if (missing.length) checks.push(check("route", "BLOCKED", "Update route", `The update ${missing[0].from} → ${missing[0].to} is not in the ${missing[0].channel} graph the cluster would be on for it.`));
    else if (path.conditional) checks.push(check("route", "WARNING", "Update route", "The route uses conditional updates (updates with known risks). See the conditional-risk check."));
    else if (notChecked.length) checks.push(check("route", "NOT_CHECKED", "Update route", `Recommended in ${path.graphSources[0]?.channel}, but not yet checked against the channel the cluster is on for ${notChecked.map((h) => `${h.from} → ${h.to} (${h.channel})`).join(", ")}. Load those channel graphs and compute the route again.`));
    else checks.push(check("route", "VERIFIED", "Update route", `Every update on the route is a recommended edge in the channel the cluster is on for it (${path.hops.map((h) => h.channel).filter((c, i, a) => a.indexOf(c) === i).join(", ")}).`));
  }
  const freshness = {
    current: check("graph-freshness", "VERIFIED", "Graph freshness", "The route comes from a graph fetched from the update service within the last day."),
    "as-of": check("graph-freshness", "WARNING", "Graph freshness", "The route comes from a graph snapshot or a fetch older than a day. Recommendations change; confirm against your OpenShift Update Service (or refresh) before each update."),
    "graph-changed": check("graph-freshness", "BLOCKED", "Graph freshness", "The graph changed after this route was computed. Compute the route again; the old route is history, not a current recommendation."),
    "graph-missing": check("graph-freshness", "BLOCKED", "Graph freshness", "The graph this route came from is no longer loaded."),
    none: check("graph-freshness", "NOT_CHECKED", "Graph freshness", "No route yet.")
  };
  checks.push(freshness[pathStatus] || freshness.none);

  // Conditional risks: graph condition, cluster evidence and administrator judgment kept apart.
  const condHops = (path?.hops || []).filter((h) => h.conditional);
  if (condHops.length) {
    const acknowledged = new Set((plan.conditionalReview?.acknowledgedRisks || []).map((a) => a.name));
    for (const hop of condHops) {
      for (const risk of hop.risks) {
        const always = risk.ruleTypes.includes("Always");
        const evaluated = inv?.clusterVersion?.conditionalUpdates?.find((u) => u.version === hop.to && u.risks.includes(risk.name));
        const layers = {
          graph: `${risk.name}: ${risk.message || "(no message)"}${always ? " — applies to every cluster (rule: Always)." : risk.ruleTypes.includes("PromQL") ? " — applies when the cluster matches a PromQL condition Architect cannot evaluate offline." : ""}`,
          clusterEvidence: evaluated ? `The imported ClusterVersion evaluated this update as Recommended=${evaluated.recommended} (${evaluated.reason || "no reason"}).` : "No cluster evaluation imported.",
          administratorJudgment: acknowledged.has(risk.name) ? "Acknowledged by the administrator (judgment, not proof of cluster-specific safety)." : "Not acknowledged."
        };
        const state = evaluated?.recommended === "True" ? "WARNING" : always || !acknowledged.has(risk.name) ? "BLOCKED" : "WARNING";
        checks.push(check(`risk-${risk.name}`.slice(0, 48).toLowerCase(), state, `Conditional update ${hop.from} → ${hop.to}`, layers.graph, { layers, url: risk.url }));
      }
    }
  }

  // Cluster state, from an imported export only.
  if (!inv?.clusterVersion) {
    checks.push(check("cvo-health", "NOT_CHECKED", "Cluster version operator", `Import \`oc get clusterversion version -o json\` to check Available, Failing and Progressing.`));
    checks.push(check("cvo-upgradeable", "NOT_CHECKED", "Upgradeable condition", "Import the ClusterVersion to check whether minor updates are allowed."));
    checks.push(check("current-version", "NOT_CHECKED", "Current version", "The current version is what you selected; it is not confirmed by a cluster export."));
  } else {
    const failing = cond(inv, "Failing");
    const available = cond(inv, "Available");
    const progressing = cond(inv, "Progressing");
    if (failing?.status === "True") checks.push(check("cvo-health", "BLOCKED", "Cluster version operator", `Failing=True: ${failing.reason} ${failing.message}`.trim()));
    else if (available?.status !== "True") checks.push(check("cvo-health", "BLOCKED", "Cluster version operator", "Available is not True in the imported ClusterVersion."));
    else if (progressing?.status === "True") checks.push(check("cvo-health", "WARNING", "Cluster version operator", "An update is in progress in the imported ClusterVersion."));
    else checks.push(check("cvo-health", "VERIFIED", "Cluster version operator", `Available=True, Failing=False in the export imported ${inv.importedAt || ""}.`.trim()));
    const up = cond(inv, "Upgradeable");
    const crossesMinor = (path?.hops || []).some((h) => h.kind === "minor");
    if (up?.status === "False") checks.push(check("cvo-upgradeable", crossesMinor ? "BLOCKED" : "WARNING", "Upgradeable condition", `Upgradeable=False (${up.reason}): ${up.message}${crossesMinor ? " Minor-version updates are blocked until this is resolved." : " This blocks minor updates only."}`));
    else checks.push(check("cvo-upgradeable", "VERIFIED", "Upgradeable condition", "No Upgradeable=False condition in the imported ClusterVersion."));
    if (inv.clusterVersion.version && plan.current && inv.clusterVersion.version !== plan.current) checks.push(check("current-version", "BLOCKED", "Current version", `The plan starts at ${plan.current}, but the imported cluster runs ${inv.clusterVersion.version}.`));
    else if (inv.clusterVersion.version) checks.push(check("current-version", "VERIFIED", "Current version", `The imported cluster runs ${inv.clusterVersion.version}.`));
    else checks.push(check("current-version", "NOT_CHECKED", "Current version", "The imported ClusterVersion has no completed version."));
    if (plan.currentChannel && inv.clusterVersion.channel && inv.clusterVersion.channel !== plan.currentChannel) checks.push(check("current-channel", "WARNING", "Current channel", `The plan says ${plan.currentChannel}; the cluster is on ${inv.clusterVersion.channel}.`));
  }
  if (!inv?.machineConfigPools?.length) checks.push(check("mcp-health", "NOT_CHECKED", "Machine config pools", "Import `oc get mcp -o json` to check that no pool is degraded or still updating."));
  else {
    const degraded = inv.machineConfigPools.filter((m) => m.degraded === "True");
    const updating = inv.machineConfigPools.filter((m) => m.updated !== "True");
    const paused = inv.machineConfigPools.filter((m) => m.paused);
    if (degraded.length) checks.push(check("mcp-health", "BLOCKED", "Machine config pools", `Degraded: ${degraded.map((m) => m.name).join(", ")}.`));
    else if (updating.length || paused.length) checks.push(check("mcp-health", "WARNING", "Machine config pools", `${updating.length ? `Not updated: ${updating.map((m) => m.name).join(", ")}. ` : ""}${paused.length ? `Paused: ${paused.map((m) => m.name).join(", ")}.` : ""}`.trim()));
    else checks.push(check("mcp-health", "VERIFIED", "Machine config pools", "Every imported pool is updated and none is degraded or paused."));
  }

  // Operators: package compatibility metadata is not available offline (U5).
  const opsImported = inv?.operators?.length || 0;
  const opCheck = attestedOr(plan, "operator-compat", "Operator compatibility", opsImported
    ? `${opsImported} installed operator(s) imported. Architect cannot read their maximum supported OpenShift version offline, so compatibility with each minor on the route is not verified. Check each operator's documentation and its Upgradeable condition before each minor update.`
    : "No installed operators imported, and Architect cannot verify operator compatibility offline. Check each installed operator supports every minor on the route.");
  checks.push(opCheck);

  // Administrator-side prerequisites Architect cannot observe.
  checks.push(attestedOr(plan, "etcd-backup", "etcd backup", "Take and verify an etcd backup before the update (and before each minor step)."));
  checks.push(attestedOr(plan, "api-removals", "Removed APIs", "Review APIRequestCount for APIs removed in the Kubernetes versions on this route."));
  const reaches422 = (path?.hops || []).some((h) => getMinorVersion(h.to) === "4.22" && getMinorVersion(h.from) === "4.21");
  if (reaches422) checks.push(attestedOr(plan, "admin-acks", "Administrator acknowledgements", "The 4.21 → 4.22 update can require an administrator acknowledgement (for example Azure and vSphere clusters without managed boot images). Check `oc get configmap admin-gates -n openshift-config-managed -o yaml` and give the required acknowledgements."));
  if (plan.method === "osus") checks.push(attestedOr(plan, "osus-health", "OpenShift Update Service", "Confirm the update service answers and ClusterVersion's upstream points to it (see the OSUS instructions)."));

  // Content in the disconnected registry, per stage.
  if (!stageViews.length) checks.push(check("content", "NOT_CHECKED", "Release content in the registry", "No stages prepared yet."));
  for (const s of stageViews) {
    const st = s.content?.state;
    const sig = signatureEvidence[s.id];
    const title = `Stage ${s.id.slice(1)} content (${s.release})`;
    if (st === "registry-verified") checks.push(check(`content-${s.id}`, "VERIFIED", title, "Mirrored into the destination registry and every mapped image confirmed present there."));
    else if (st === "in-registry-unverified") checks.push(check(`content-${s.id}`, "WARNING", title, "Mirrored into the registry, but not confirmed by a destination check. Run it again with the destination check, or verify manually."));
    else if (st === "profile-missing") checks.push(check(`content-${s.id}`, "BLOCKED", title, "This stage has no Mirroring profile. Prepare the stages again (or receive this stage's transfer)."));
    else checks.push(check(`content-${s.id}`, "PENDING", title, st === "mirrored-to-disk" || st === "transfer-prepared" ? "To do: mirrored to disk; not yet loaded into the disconnected registry." : st === "transfer-received" ? "To do: received; load it into the registry with disk to mirror." : "To do: not mirrored yet."));
    if (sig && sig.exists === false) checks.push(check(`signatures-${s.id}`, "BLOCKED", `Stage ${s.id.slice(1)} release signatures`, "The run produced no signature-configmap in cluster-resources (oc-mirror only warns when it cannot). Without it, the cluster cannot verify the release."));
    else if (sig && sig.exists) checks.push(check(`signatures-${s.id}`, "VERIFIED", `Stage ${s.id.slice(1)} release signatures`, `signature-configmap found at ${sig.path}.`));
  }

  // Control Plane Only: documented prerequisites; an unverified one is not a pass.
  let cpo = null;
  if (plan.strategy === "cpo") {
    const pools = inv?.machineConfigPools || [];
    const nonMaster = pools.filter((m) => !m.master);
    const topology = !pools.length
      ? check("cpo-topology", "NOT_CHECKED", "Control Plane Only: pools to pause", "Import `oc get mcp -o json`: a Control Plane Only update pauses every pool except master, so the cluster must have separate worker pools.")
      : nonMaster.length
        ? check("cpo-topology", "VERIFIED", "Control Plane Only: pools to pause", `Non-master pools to pause: ${nonMaster.map((m) => m.name).join(", ")}.`)
        : check("cpo-topology", "BLOCKED", "Control Plane Only: pools to pause", "Only the master pool exists (single-node or compact cluster). Use a standard update.");
    const window = attestedOr(plan, "cpo-pause-window", "Control Plane Only: paused-pool window", "Confirm the documented limit on keeping pools paused.");
    const ent = attestedOr(plan, "eus-entitlement", "Control Plane Only: EUS entitlement", "Confirm the cluster is entitled to EUS for 4.20 and 4.22.");
    checks.push(topology, window, ent);
    const items = [topology, window, ent, opCheck];
    cpo = {
      eligible: items.every((c) => c.state === "VERIFIED" || c.state === "ATTESTED"),
      missing: items.filter((c) => !(c.state === "VERIFIED" || c.state === "ATTESTED")).map((c) => c.id)
    };
  }

  const blocked = checks.filter((c) => c.state === "BLOCKED");
  const pending = checks.filter((c) => c.state === "PENDING");
  const notChecked = checks.filter((c) => c.state === "NOT_CHECKED");
  return {
    checks,
    summary: {
      state: blocked.length ? "blocked" : pending.length || notChecked.length ? "incomplete" : "ready-to-proceed",
      blocked: blocked.length,
      pending: pending.length,
      notChecked: notChecked.length,
      warnings: checks.filter((c) => c.state === "WARNING").length,
      attested: checks.filter((c) => c.state === "ATTESTED").length,
      clusterEvidence: Boolean(inv?.clusterVersion),
      clusterReadiness: inv?.clusterVersion ? "from imported export" : "not verified (no cluster evidence)"
    },
    cpo
  };
}
