/**
 * Optional, read-only cluster inventory import for Upgrade plans (v2.3.0,
 * RFC §7, owner decision D8).
 *
 * The user runs read-only `oc get … -o json` commands where the cluster is
 * reachable and pastes or uploads the output. Architect never contacts a
 * cluster. Every document is projected through an allowlist: only names,
 * versions, channels, phases and conditions are kept. Cluster IDs,
 * annotations, data/binaryData, spec.upstream and anything credential-like
 * are discarded. Kubeconfigs and Secrets are refused outright.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import fs from "node:fs";
import { gaVersion } from "../../shared/upgradePath.js";

/** The read-only collector script users run where `oc` is logged in (served as a download). */
export const COLLECTOR_SCRIPT = fs.readFileSync(new URL("./assets/oaa-readiness-collector.sh", import.meta.url), "utf8");

export const INVENTORY_MAX_BYTES = 20 * 1024 * 1024;
export const INVENTORY_KINDS = Object.freeze(["clusterversion", "csv", "subscription", "mcp"]);

export class InventoryError extends Error {
  constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; }
}

const str = (v, n = 200) => (typeof v === "string" ? v.slice(0, n) : "");
/**
 * Free text from a cluster (condition messages) is kept for the administrator, but anything that
 * looks credential-bearing is masked first: URL userinfo, bearer/basic values, token= / password=
 * style pairs and long base64 runs.
 */
export const redactText = (v, n = 1000) => str(v, 4000)
  .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[redacted]@")
  .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]")
  .replace(/\b(token|password|passwd|secret|auth|apikey|api_key|access_key)(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, "$1$2[redacted]")
  .replace(/[A-Za-z0-9+/]{64,}={0,2}/g, "[redacted]")
  .slice(0, n);
const itemsOf = (doc) => (Array.isArray(doc?.items) ? doc.items : doc && typeof doc === "object" && doc.kind && doc.kind !== "List" ? [doc] : []);

const refuseSensitive = (doc) => {
  if (doc && typeof doc === "object" && (Array.isArray(doc.clusters) || Array.isArray(doc.users)) && (doc.kind === "Config" || Array.isArray(doc.contexts))) {
    throw new InventoryError("INVENTORY_KUBECONFIG_REFUSED", "That is a kubeconfig. Architect never accepts cluster credentials; paste the output of the read-only `oc get … -o json` command instead.", 400);
  }
  const items = itemsOf(doc);
  if (items.some((i) => i?.kind === "Secret")) {
    throw new InventoryError("INVENTORY_SECRET_REFUSED", "The document contains a Secret. Architect does not accept Secrets.", 400);
  }
};

const conditionsOf = (obj) => (Array.isArray(obj?.status?.conditions) ? obj.status.conditions.slice(0, 32).map((c) => ({ type: str(c?.type, 64), status: str(c?.status, 16), reason: str(c?.reason, 128), message: redactText(c?.message, 1000) })) : []);

const projectClusterVersion = (doc) => {
  const cv = itemsOf(doc).find((i) => i?.kind === "ClusterVersion");
  if (!cv) throw new InventoryError("INVENTORY_KIND_MISMATCH", "No ClusterVersion found. Use the output of `oc get clusterversion version -o json`.");
  const history = Array.isArray(cv.status?.history) ? cv.status.history : [];
  return {
    // spec.clusterID and spec.upstream are deliberately not read.
    version: gaVersion(cv.status?.desired?.version) || gaVersion(history.find((h) => h?.state === "Completed")?.version) || null,
    channel: str(cv.spec?.channel, 64),
    upstreamConfigured: typeof cv.spec?.upstream === "string" && cv.spec.upstream.length > 0,
    conditions: conditionsOf(cv),
    conditionalUpdates: (Array.isArray(cv.status?.conditionalUpdates) ? cv.status.conditionalUpdates : []).slice(0, 200).map((u) => {
      const rec = (Array.isArray(u?.conditions) ? u.conditions : []).find((c) => c?.type === "Recommended");
      return { version: gaVersion(u?.release?.version) || null, recommended: str(rec?.status, 16), reason: str(rec?.reason, 128), risks: (Array.isArray(u?.risks) ? u.risks : []).slice(0, 16).map((r) => str(r?.name, 128)) };
    }).filter((u) => u.version),
    history: history.slice(0, 50).map((h) => ({ version: gaVersion(h?.version) || null, state: str(h?.state, 32), completionTime: typeof h?.completionTime === "string" ? h.completionTime : null })).filter((h) => h.version)
  };
};

const projectCsvs = (doc) => itemsOf(doc).filter((i) => i?.kind === "ClusterServiceVersion").slice(0, 500).map((c) => ({
  name: str(c.metadata?.name, 128),
  namespace: str(c.metadata?.namespace, 128),
  version: str(c.spec?.version, 64),
  channel: "",
  source: "",
  phase: str(c.status?.phase, 64)
}));

const projectSubscriptions = (doc) => itemsOf(doc).filter((i) => i?.kind === "Subscription").slice(0, 500).map((s) => ({
  name: str(s.spec?.name, 128),
  namespace: str(s.metadata?.namespace, 128),
  version: str(s.status?.installedCSV, 128),
  channel: str(s.spec?.channel, 128),
  source: str(s.spec?.source, 128),
  phase: str(s.status?.state, 64)
}));

const projectMcps = (doc) => itemsOf(doc).filter((i) => i?.kind === "MachineConfigPool").slice(0, 64).map((m) => {
  const cond = (t) => (Array.isArray(m.status?.conditions) ? m.status.conditions.find((c) => c?.type === t)?.status : "") || "";
  return { name: str(m.metadata?.name, 128), paused: Boolean(m.spec?.paused), updated: str(cond("Updated"), 16), degraded: str(cond("Degraded"), 16), master: m.metadata?.name === "master" };
});

/**
 * Parse and project one pasted document. Returns a partial inventory to merge.
 */
export const projectInventory = (kind, text) => {
  if (!INVENTORY_KINDS.includes(kind)) throw new InventoryError("INVENTORY_KIND_INVALID", "Unknown inventory kind.", 400);
  if (typeof text !== "string" || Buffer.byteLength(text) > INVENTORY_MAX_BYTES) throw new InventoryError("INVENTORY_TOO_LARGE", "The document must be at most 20 MiB.", 413);
  let doc;
  try { doc = JSON.parse(text); } catch { throw new InventoryError("INVENTORY_NOT_JSON", "Paste JSON output (`-o json`)."); }
  refuseSensitive(doc);
  if (kind === "clusterversion") return { clusterVersion: projectClusterVersion(doc) };
  if (kind === "mcp") {
    const pools = projectMcps(doc);
    if (!pools.length) throw new InventoryError("INVENTORY_KIND_MISMATCH", "No MachineConfigPool found. Use `oc get mcp -o json`.");
    return { machineConfigPools: pools };
  }
  const ops = kind === "csv" ? projectCsvs(doc) : projectSubscriptions(doc);
  if (!ops.length) throw new InventoryError("INVENTORY_KIND_MISMATCH", kind === "csv" ? "No ClusterServiceVersion found. Use `oc get csv -A -o json`." : "No Subscription found. Use `oc get subscriptions.operators.coreos.com -A -o json`.");
  return { operators: ops, operatorsKind: kind };
};

/** Read-only commands the UI shows for each kind. */
export const INVENTORY_COMMANDS = Object.freeze({
  clusterversion: "oc get clusterversion version -o json",
  csv: "oc get csv -A -o json",
  subscription: "oc get subscriptions.operators.coreos.com -A -o json",
  mcp: "oc get mcp -o json"
});

/* ---------------------------------------------------------------------------------------------
 * One readiness evidence bundle (v2.3.0 owner QA P4): the output of the read-only collector
 * script (assets/oaa-readiness-collector.sh). Every section goes through the same allowlist
 * projections as the individual imports, plus ClusterOperators, removed-API usage and the
 * administrator-acknowledgement gates. A section the collector could not read is reported as
 * such and its checks stay "not checked" — nothing is filled in. The bundle's own collection
 * time is kept so the evidence age is always visible.
 * ------------------------------------------------------------------------------------------- */
export const BUNDLE_KIND = "OAAReadinessBundle";
export const BUNDLE_SECTIONS = Object.freeze(["clusterversion", "clusteroperators", "mcp", "subscriptions", "csv", "apirequestcounts", "admingates", "adminacks"]);

const projectClusterOperators = (doc) => itemsOf(doc).filter((i) => i?.kind === "ClusterOperator").slice(0, 128).map((co) => ({
  name: str(co.metadata?.name, 128),
  version: str((Array.isArray(co.status?.versions) ? co.status.versions : []).find((v) => v?.name === "operator")?.version, 64),
  conditions: conditionsOf(co).filter((c) => ["Available", "Degraded", "Progressing", "Upgradeable"].includes(c.type))
}));

const MINOR_RE = /^4\.\d{1,2}$/;
const projectCsvMax = (doc) => itemsOf(doc).filter((i) => i?.kind === "ClusterServiceVersion").slice(0, 500).map((c) => {
  // Collector output carries maxOpenShiftVersion directly; a raw CSV carries it in olm.properties.
  let max = c.maxOpenShiftVersion;
  if (max == null && typeof c.metadata?.annotations?.["olm.properties"] === "string") {
    try { max = JSON.parse(c.metadata.annotations["olm.properties"]).find((p) => p?.type === "olm.maxOpenShiftVersion")?.value; } catch { max = null; }
  }
  const m = String(max ?? "").trim().match(/^(4\.\d{1,2})(?:\.\d+)?$/);
  return { name: str(c.metadata?.name, 128), namespace: str(c.metadata?.namespace, 128), version: str(c.spec?.version, 64), phase: str(c.status?.phase, 64), maxOpenShiftVersion: m && MINOR_RE.test(m[1]) ? m[1] : null };
});

const projectApiRemovals = (doc) => itemsOf(doc).filter((i) => i?.kind === "APIRequestCount" && typeof i.status?.removedInRelease === "string" && i.status.removedInRelease).slice(0, 500).map((a) => ({
  name: str(a.metadata?.name, 200),
  removedInRelease: str(a.status.removedInRelease, 16),
  requestCount: Number.isFinite(Number(a.status?.requestCount)) ? Number(a.status.requestCount) : 0
}));

const projectAdminGates = (gatesDoc, acksDoc) => {
  const gates = gatesDoc?.kind === "ConfigMap" && gatesDoc.data && typeof gatesDoc.data === "object" ? gatesDoc.data : {};
  const acks = acksDoc?.kind === "ConfigMap" && acksDoc.data && typeof acksDoc.data === "object" ? acksDoc.data : {};
  return Object.keys(gates).filter((k) => /^ack-[a-z0-9.-]{1,120}$/.test(k)).slice(0, 64).map((k) => ({
    key: k,
    description: redactText(gates[k], 500),
    acknowledged: acks[k] === true || acks[k] === "true"
  }));
};

/**
 * Parse and project a readiness bundle. Returns { inventory, sections } where inventory replaces
 * the plan's inventory as one source with one collection time.
 */
export const projectBundle = (text, { now = Date.now() } = {}) => {
  if (typeof text !== "string" || Buffer.byteLength(text) > INVENTORY_MAX_BYTES) throw new InventoryError("INVENTORY_TOO_LARGE", "The bundle must be at most 20 MiB.", 413);
  let doc;
  try { doc = JSON.parse(text); } catch { throw new InventoryError("INVENTORY_NOT_JSON", "That is not JSON. Upload the file the collector script wrote."); }
  refuseSensitive(doc);
  if (doc?.kind !== BUNDLE_KIND || !doc.sections || typeof doc.sections !== "object") {
    throw new InventoryError("BUNDLE_KIND_MISMATCH", "That is not a readiness bundle. Upload the file written by the collector script, or use Advanced to import one command's output.");
  }
  if (doc.apiVersion !== "v1") throw new InventoryError("BUNDLE_VERSION_UNSUPPORTED", "This bundle format version is not supported. Download the collector script again.");
  const at = Date.parse(doc.collectedAt);
  if (!Number.isFinite(at)) throw new InventoryError("BUNDLE_TIME_MISSING", "The bundle has no valid collection time.");
  if (at > now + 60 * 60 * 1000) throw new InventoryError("BUNDLE_TIME_FUTURE", "The bundle's collection time is in the future. Check the clock where it was collected.");
  for (const name of BUNDLE_SECTIONS) refuseSensitive(doc.sections[name]);

  const sections = {};
  const inventory = { source: "bundle", collector: str(doc.collector, 64), collectedAt: new Date(at).toISOString() };
  const take = (name, fn) => {
    const sec = doc.sections[name];
    if (!sec || typeof sec !== "object") { sections[name] = { state: "missing" }; return; }
    if (sec.error) { sections[name] = { state: "unavailable", reason: ["forbidden", "not-found", "failed"].includes(sec.error) ? sec.error : "failed" }; return; }
    try {
      const n = fn(sec);
      sections[name] = { state: "imported", count: n };
    } catch (err) {
      if (!(err instanceof InventoryError)) throw err;
      sections[name] = { state: "invalid", reason: err.message };
    }
  };
  take("clusterversion", (sec) => { inventory.clusterVersion = projectClusterVersion(sec); return 1; });
  take("clusteroperators", (sec) => { inventory.clusterOperators = projectClusterOperators(sec); return inventory.clusterOperators.length; });
  take("mcp", (sec) => { inventory.machineConfigPools = projectMcps(sec); return inventory.machineConfigPools.length; });
  take("subscriptions", (sec) => { inventory.operators = projectSubscriptions(sec); return inventory.operators.length; });
  take("csv", (sec) => { inventory.csvs = projectCsvMax(sec); return inventory.csvs.length; });
  take("apirequestcounts", (sec) => { inventory.apiRemovals = projectApiRemovals(sec); return inventory.apiRemovals.length; });
  take("admingates", (sec) => {
    const acks = doc.sections.adminacks && !doc.sections.adminacks.error ? doc.sections.adminacks : null;
    inventory.adminGates = projectAdminGates(sec, acks);
    inventory.adminAcksRead = Boolean(acks);
    return inventory.adminGates.length;
  });
  sections.adminacks = doc.sections.adminacks?.error ? { state: "unavailable", reason: ["forbidden", "not-found"].includes(doc.sections.adminacks.error) ? doc.sections.adminacks.error : "failed" } : doc.sections.adminacks ? { state: "imported" } : { state: "missing" };
  // Installed CSVs fill in the subscriptions' versions and phases (never the other way round).
  if (inventory.operators && inventory.csvs) {
    const byName = new Map(inventory.csvs.map((c) => [`${c.namespace}/${c.name}`, c]));
    inventory.operators = inventory.operators.map((o) => {
      const c = byName.get(`${o.namespace}/${o.version}`);
      return c ? { ...o, csvPhase: c.phase, maxOpenShiftVersion: c.maxOpenShiftVersion } : o;
    });
  }
  if (!Object.values(sections).some((s) => s.state === "imported")) throw new InventoryError("BUNDLE_EMPTY", "The bundle contains no readable evidence. Check that you were logged in with `oc` when the collector ran.");
  inventory.sections = sections;
  return { inventory, sections };
};
