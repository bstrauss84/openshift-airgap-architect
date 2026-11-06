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
import { gaVersion } from "../../shared/upgradePath.js";

export const INVENTORY_MAX_BYTES = 20 * 1024 * 1024;
export const INVENTORY_KINDS = Object.freeze(["clusterversion", "csv", "subscription", "mcp"]);

export class InventoryError extends Error {
  constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; }
}

const str = (v, n = 200) => (typeof v === "string" ? v.slice(0, n) : "");
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

const conditionsOf = (obj) => (Array.isArray(obj?.status?.conditions) ? obj.status.conditions.slice(0, 32).map((c) => ({ type: str(c?.type, 64), status: str(c?.status, 16), reason: str(c?.reason, 128), message: str(c?.message, 1000) })) : []);

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
