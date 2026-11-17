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
const INVENTORY_FOR = { "cvo-health": "clusterversion", "cvo-upgradeable": "clusterversion", "current-version": "clusterversion", "mcp-health": "mcp", "cpo-topology": "mcp", "operator-compat": "csv", "cluster-operators": "bundle", "api-removals": "bundle", "admin-acks": "bundle", "evidence-age": "bundle" };
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

/**
 * Kubernetes version of each supported OpenShift minor, from each release's own release notes
 * ("{product-title} {product-version} release uses Kubernetes 1.3x"; openshift-docs
 * enterprise-4.20/4.21/4.22, rn-ocp-*about-this-release.adoc).
 */
export const KUBE_FOR_MINOR = Object.freeze({ "4.20": "1.33", "4.21": "1.34", "4.22": "1.35" });
const kubeNum = (v) => { const m = String(v || "").match(/^1\.(\d+)/); return m ? Number(m[1]) : null; };
const minorNum = (v) => { const m = String(v || "").match(/^4\.(\d+)/); return m ? Number(m[1]) : null; };
export const EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const cond = (inv, type) => inv?.clusterVersion?.conditions?.find((c) => c.type === type);

/**
 * @param {object} plan - normalized plan (with path, stages, inventory, readiness)
 * @param {object} ctx
 * @param {string} ctx.pathStatus - none | current | as-of | graph-changed | graph-missing
 * @param {Array} ctx.stageViews - upgradeStageViews(plan)
 * @param {Record<string, {exists: boolean|null}>} ctx.signatureEvidence - by stage id
 */
export function evaluateReadiness(plan, { pathStatus = "none", stageViews = [], signatureEvidence = {}, now = Date.now() } = {}) {
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
  // How old the cluster evidence is (bundle collection time, else the import time).
  const evidenceAt = Date.parse(inv?.collectedAt || inv?.importedAt || "");
  if (inv && Number.isFinite(evidenceAt)) {
    const hours = Math.max(0, Math.round((now - evidenceAt) / 3600000));
    const label = inv.collectedAt ? `collected ${inv.collectedAt}` : `imported ${inv.importedAt}`;
    checks.push(now - evidenceAt > EVIDENCE_MAX_AGE_MS
      ? check("evidence-age", "WARNING", "Cluster evidence age", `The cluster evidence was ${label} (${hours} h ago). Cluster state changes; collect it again right before each update.`)
      : check("evidence-age", "VERIFIED", "Cluster evidence age", `The cluster evidence was ${label} (${hours ? `${hours} h` : "less than an hour"} ago). Collect it again right before each update.`));
  }
  const crossesMinorHop = (path?.hops || []).some((h) => h.kind === "minor");
  if (inv?.clusterOperators) {
    const cos = inv.clusterOperators;
    const c = (co, t) => co.conditions.find((x) => x.type === t);
    const down = cos.filter((co) => c(co, "Available")?.status === "False");
    const degraded = cos.filter((co) => c(co, "Degraded")?.status === "True");
    const notUp = cos.filter((co) => c(co, "Upgradeable")?.status === "False");
    const progressing = cos.filter((co) => c(co, "Progressing")?.status === "True");
    const names = (l) => l.map((co) => `${co.name}${c(co, "Upgradeable")?.status === "False" && l === notUp ? ` (${c(co, "Upgradeable").reason || "no reason"})` : ""}`).join(", ");
    if (!cos.length) checks.push(check("cluster-operators", "NOT_CHECKED", "Cluster operators", "The bundle lists no cluster operators."));
    else if (down.length || degraded.length) checks.push(check("cluster-operators", "BLOCKED", "Cluster operators", `${down.length ? `Not available: ${names(down)}. ` : ""}${degraded.length ? `Degraded: ${names(degraded)}.` : ""}`.trim()));
    else if (notUp.length) checks.push(check("cluster-operators", crossesMinorHop ? "BLOCKED" : "WARNING", "Cluster operators", `Upgradeable=False: ${names(notUp)}.${crossesMinorHop ? " Minor-version updates are blocked until this is resolved (for olm, an installed operator does not allow the next minor; update or remove it first)." : " This blocks minor updates only."}`));
    else if (progressing.length) checks.push(check("cluster-operators", "WARNING", "Cluster operators", `Still progressing: ${names(progressing)}. Wait until they settle before starting an update.`));
    else checks.push(check("cluster-operators", "VERIFIED", "Cluster operators", `All ${cos.length} cluster operators are available, not degraded and not blocking updates.`));
  } else if (inv?.source === "bundle") {
    checks.push(check("cluster-operators", "NOT_CHECKED", "Cluster operators", `The bundle could not read cluster operators (${inv.sections?.clusteroperators?.reason || inv.sections?.clusteroperators?.state || "missing"}).`));
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

  // Operators. A declared olm.maxOpenShiftVersion is evidence that OLM will block the minor update
  // beyond it (the olm cluster operator reports Upgradeable=False). No declared maximum is NOT
  // evidence of support, so without a blocker the check stays the administrator's to confirm.
  const opsImported = inv?.operators?.length || 0;
  const minorTargets = (path?.hops || []).filter((h) => h.kind === "minor").map((h) => getMinorVersion(h.to));
  const capped = (inv?.csvs || []).filter((c) => c.maxOpenShiftVersion);
  const blockers = capped.map((c) => ({ c, hit: minorTargets.find((m) => minorNum(m) > minorNum(c.maxOpenShiftVersion)) })).filter((x) => x.hit);
  let opCheck;
  if (blockers.length) {
    const first = minorTargets[0];
    const now1 = blockers.filter((x) => x.hit === first);
    const fmt = (l) => l.map(({ c, hit }) => `${c.name} (maximum ${c.maxOpenShiftVersion}; blocks the update to ${hit})`).join(", ");
    opCheck = now1.length
      ? check("operator-compat", "BLOCKED", "Operator compatibility", `Installed operators that do not allow the next minor: ${fmt(now1)}. Update each to a version that allows ${first} (change its channel if the channel is version-named) before that update.${blockers.length > now1.length ? ` Later on the route: ${fmt(blockers.filter((x) => x.hit !== first))}.` : ""}`)
      : check("operator-compat", "WARNING", "Operator compatibility", `Not blocking the first update, but must be updated before a later one: ${fmt(blockers)}.`);
  } else {
    opCheck = attestedOr(plan, "operator-compat", "Operator compatibility", inv?.csvs
      ? `${inv.csvs.length} installed operator version(s) read; none declares a maximum OpenShift version that blocks this route (${capped.length} declare one). That means OLM will not block the updates — it does not prove each operator is supported on every minor. Check version-named channels (for example OpenShift Data Foundation stable-4.y) and each operator's support statement, then confirm here.`
      : opsImported
        ? `${opsImported} installed operator(s) imported. Without their versions (CSV), Architect cannot read their maximum supported OpenShift version, so compatibility with each minor on the route is not verified. Check each operator's documentation and its Upgradeable condition before each minor update.`
        : "No installed operators imported, and Architect cannot verify operator compatibility offline. Check each installed operator supports every minor on the route.");
  }
  checks.push(opCheck);

  // Administrator-side prerequisites Architect cannot observe.
  checks.push(attestedOr(plan, "etcd-backup", "etcd backup", "Take and verify an etcd backup before the update (and before each minor step)."));
  const kubeFrom = kubeNum(KUBE_FOR_MINOR[getMinorVersion(plan.current || "")]);
  const kubeTo = Math.max(...minorTargets.map((m) => kubeNum(KUBE_FOR_MINOR[m])).filter(Number.isFinite), -1);
  if (Array.isArray(inv?.apiRemovals) && kubeFrom != null && kubeTo > kubeFrom) {
    const onRoute = inv.apiRemovals.filter((a) => { const k = kubeNum(a.removedInRelease); return k != null && k > kubeFrom && k <= kubeTo; });
    const used = onRoute.filter((a) => a.requestCount > 0);
    const range = `Kubernetes 1.${kubeFrom + 1}${kubeTo > kubeFrom + 1 ? `–1.${kubeTo}` : ""}`;
    checks.push(used.length
      ? check("api-removals", "BLOCKED", "Removed APIs", `Still in use (APIRequestCount, last 24 h) and removed in ${range} on this route: ${used.slice(0, 12).map((a) => `${a.name} (removed in ${a.removedInRelease}, ${a.requestCount} requests)`).join(", ")}${used.length > 12 ? ` and ${used.length - 12} more` : ""}. Find the clients and migrate them, then collect again.`)
      : check("api-removals", "VERIFIED", "Removed APIs", `No requests in the last 24 h (APIRequestCount) to an API removed in ${range}${onRoute.length ? ` (${onRoute.length} such API(s) exist, all unused)` : ""}. Clients that run less often than daily do not show here.`));
  } else checks.push(attestedOr(plan, "api-removals", "Removed APIs", "Review APIRequestCount for APIs removed in the Kubernetes versions on this route."));
  const reaches422 = (path?.hops || []).some((h) => getMinorVersion(h.to) === "4.22" && getMinorVersion(h.from) === "4.21");
  if (Array.isArray(inv?.adminGates) && crossesMinorHop) {
    // The cluster lists only the gates of the minor it runs now; later minors' gates appear after reaching them.
    const curMinor = getMinorVersion(inv.clusterVersion?.version || plan.current || "");
    const relevant = inv.adminGates.filter((g) => g.key.startsWith(`ack-${curMinor}-`));
    const open = relevant.filter((g) => !g.acknowledged);
    if (open.length) checks.push(check("admin-acks", inv.adminAcksRead ? "BLOCKED" : "NOT_CHECKED", "Administrator acknowledgements", `${inv.adminAcksRead ? "Not yet acknowledged" : "Required (the bundle could not read admin-acks to see whether they were given)"}: ${open.map((g) => `${g.key} — ${g.description}`).join(" ")} Review each and acknowledge it (oc patch configmap admin-acks -n openshift-config) before the minor update.`));
    else if (minorTargets.length === 1) checks.push(check("admin-acks", "VERIFIED", "Administrator acknowledgements", relevant.length ? `Every acknowledgement for leaving ${curMinor} was given (${relevant.map((g) => g.key).join(", ")}).` : `The cluster requires no acknowledgement for leaving ${curMinor}.`));
    else checks.push(attestedOr(plan, "admin-acks", "Administrator acknowledgements", relevant.length
      ? `Every acknowledgement for leaving ${curMinor} was given (${relevant.map((g) => g.key).join(", ")}). Later minors' acknowledgements appear only after the cluster reaches them; collect again then.`
      : `The cluster requires no acknowledgement for leaving ${curMinor}. Later minors' acknowledgements appear only after the cluster reaches them; collect again then.`));
  } else if (reaches422) checks.push(attestedOr(plan, "admin-acks", "Administrator acknowledgements", "The 4.21 → 4.22 update can require an administrator acknowledgement (for example Azure and vSphere clusters without managed boot images). Check `oc get configmap admin-gates -n openshift-config-managed -o yaml` and give the required acknowledgements."));
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
