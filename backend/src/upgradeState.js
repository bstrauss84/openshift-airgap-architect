/**
 * Upgrade workflow state (v2.3.0, RFC §8.1): the server-owned `upgrade` slice.
 *
 * Owned only by the /api/upgrade routes; Install never writes it
 * (workflowSlices.js). It holds plans — selections, the solved route with the
 * exact graph sources it came from, stage links to Upgrade-owned Mirroring
 * profiles, operator inventory projections and readiness attestations. It
 * never holds a credential, a cluster ID, a kubeconfig or a token.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import crypto from "node:crypto";
import { PLANNING_CHANNEL_RE, GRAPH_ARCHES, gaVersion } from "../../shared/upgradePath.js";

export const UPGRADE_SCHEMA = "oaa.upgrade.slice/v1";
export const MAX_PLANS = 20;
export const MAX_STAGES = 8;
export const UPDATE_METHODS = Object.freeze(["osus", "cli", "web"]);
export const STRATEGIES = Object.freeze(["standard", "cpo"]);
export const CHANNEL_STRATEGIES = Object.freeze(["per-minor", "single"]);

const PLAN_ID_RE = /^u-[A-Za-z0-9_-]{8,32}$/;
export const isValidPlanId = (id) => typeof id === "string" && PLAN_ID_RE.test(id);
export const newPlanId = () => `u-${crypto.randomBytes(9).toString("base64url")}`;

export const emptyUpgradeSlice = () => ({ _schema: UPGRADE_SCHEMA, activePlanId: null, plans: [] });

const str = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const iso = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const version = (v) => gaVersion(v) || null;
const channel = (v) => (typeof v === "string" && PLANNING_CHANNEL_RE.test(v) ? v : null);

const normalizeGraphSource = (g) => ({
  channel: channel(g?.channel),
  arch: oneOf(g?.arch, GRAPH_ARCHES, null),
  source: oneOf(g?.source, ["public", "imported"], null),
  origin: oneOf(g?.origin, ["public-api", "customer-osus", "snapshot"], null),
  sourceUrl: typeof g?.sourceUrl === "string" && /^https:\/\//.test(g.sourceUrl) ? g.sourceUrl.slice(0, 2048) : null,
  fetchedAt: iso(g?.fetchedAt),
  bodySha256: typeof g?.bodySha256 === "string" && /^[a-f0-9]{64}$/.test(g.bodySha256) ? g.bodySha256 : null
});

const normalizeRisk = (r) => ({ name: str(r?.name, 128), url: typeof r?.url === "string" && /^https:\/\//.test(r.url) ? r.url.slice(0, 2048) : null, message: str(r?.message, 2000), ruleTypes: Array.isArray(r?.ruleTypes) ? r.ruleTypes.filter((t) => typeof t === "string").slice(0, 8) : [] });

const normalizeHop = (h) => ({
  from: version(h?.from),
  to: version(h?.to),
  kind: oneOf(h?.kind, ["z-stream", "minor"], "z-stream"),
  conditional: Boolean(h?.conditional),
  risks: Array.isArray(h?.risks) ? h.risks.slice(0, 32).map(normalizeRisk) : [],
  payload: typeof h?.payload === "string" && /@sha256:[a-f0-9]{64}$/.test(h.payload) ? h.payload.slice(0, 512) : null,
  errataUrl: typeof h?.errataUrl === "string" && /^https:\/\//.test(h.errataUrl) ? h.errataUrl.slice(0, 2048) : null,
  channel: channel(h?.channel),
  channelCheck: oneOf(h?.channelCheck, ["recommended", "conditional", "missing", "not-checked"], "not-checked"),
  ...(h?.controlPlaneOnly ? { controlPlaneOnly: true } : {})
});

const normalizePath = (p) => {
  if (!p || typeof p !== "object") return null;
  const hops = Array.isArray(p.hops) ? p.hops.slice(0, 16).map(normalizeHop).filter((h) => h.from && h.to) : [];
  if (!hops.length) return null;
  return {
    solver: str(p.solver, 64),
    computedAt: iso(p.computedAt),
    conditional: Boolean(p.conditional),
    selectedBy: oneOf(p.selectedBy, ["default-convention", "user"], "default-convention"),
    path: [hops[0].from, ...hops.map((h) => h.to)],
    hops,
    alternativesTotal: Number.isInteger(p.alternativesTotal) ? p.alternativesTotal : 0,
    graphSources: Array.isArray(p.graphSources) ? p.graphSources.slice(0, 8).map(normalizeGraphSource) : [],
    reasons: Array.isArray(p.reasons) ? p.reasons.slice(0, 16).map((r) => ({ code: str(r?.code, 64), message: str(r?.message, 600) })) : []
  };
};

const STAGE_STATUS = ["planned", "mirrored", "transferred", "received", "registry-verified"];
const normalizeStage = (s, i) => ({
  id: typeof s?.id === "string" && /^s[0-9]{1,2}$/.test(s.id) ? s.id : `s${i + 1}`,
  release: version(s?.release),
  minor: typeof s?.minor === "string" && /^\d+\.\d+$/.test(s.minor) ? s.minor : null,
  profileId: typeof s?.profileId === "string" && /^p-[A-Za-z0-9_-]{8,32}$/.test(s.profileId) ? s.profileId : null,
  // Cluster progress is the user's statement (or imported evidence) — never inferred from mirroring.
  clusterUpdated: oneOf(s?.clusterUpdated, ["none", "attested", "evidenced"], "none"),
  clusterUpdatedAt: iso(s?.clusterUpdatedAt)
});

const normalizeInventory = (inv) => {
  if (!inv || typeof inv !== "object") return null;
  const op = (o) => ({ name: str(o?.name, 128), namespace: str(o?.namespace, 128), version: str(o?.version, 64), channel: str(o?.channel, 128), source: str(o?.source, 128), phase: str(o?.phase, 64) });
  return {
    importedAt: iso(inv.importedAt),
    clusterVersion: inv.clusterVersion ? {
      version: version(inv.clusterVersion.version),
      channel: str(inv.clusterVersion.channel, 64),
      upstreamConfigured: Boolean(inv.clusterVersion.upstreamConfigured),
      conditions: Array.isArray(inv.clusterVersion.conditions) ? inv.clusterVersion.conditions.slice(0, 32).map((c) => ({ type: str(c?.type, 64), status: str(c?.status, 16), reason: str(c?.reason, 128), message: str(c?.message, 1000) })) : [],
      conditionalUpdates: Array.isArray(inv.clusterVersion.conditionalUpdates) ? inv.clusterVersion.conditionalUpdates.slice(0, 200).map((u) => ({ version: version(u?.version), recommended: str(u?.recommended, 16), reason: str(u?.reason, 128), risks: Array.isArray(u?.risks) ? u.risks.slice(0, 16).map((x) => str(x, 128)) : [] })) : [],
      history: Array.isArray(inv.clusterVersion.history) ? inv.clusterVersion.history.slice(0, 50).map((h) => ({ version: version(h?.version), state: str(h?.state, 32), completionTime: iso(h?.completionTime) })) : []
    } : null,
    operators: Array.isArray(inv.operators) ? inv.operators.slice(0, 500).map(op) : [],
    machineConfigPools: Array.isArray(inv.machineConfigPools) ? inv.machineConfigPools.slice(0, 64).map((m) => ({ name: str(m?.name, 128), paused: Boolean(m?.paused), updated: str(m?.updated, 16), degraded: str(m?.degraded, 16), master: Boolean(m?.master) })) : []
  };
};

export const normalizePlan = (p) => {
  const createdAt = iso(p?.createdAt) || new Date().toISOString();
  return {
    id: p.id,
    name: str(p?.name, 120) || "Upgrade plan",
    kind: oneOf(p?.kind, ["planned", "received"], "planned"),
    createdAt,
    updatedAt: iso(p?.updatedAt) || createdAt,
    arch: oneOf(p?.arch, GRAPH_ARCHES, "amd64"),
    currentChannel: channel(p?.currentChannel),
    planningChannel: channel(p?.planningChannel),
    channelPolicy: oneOf(p?.channelPolicy, ["stable", "eus", "fast"], "stable"),
    current: version(p?.current),
    target: version(p?.target),
    strategy: oneOf(p?.strategy, STRATEGIES, "standard"),
    channelStrategy: oneOf(p?.channelStrategy, CHANNEL_STRATEGIES, "per-minor"),
    method: oneOf(p?.method, UPDATE_METHODS, "osus"),
    graphSource: oneOf(p?.graphSource, ["public", "imported"], "public"),
    conditionalReview: {
      enabled: Boolean(p?.conditionalReview?.enabled),
      // Administrator judgment, recorded as such: never proof of cluster-specific safety.
      acknowledgedRisks: Array.isArray(p?.conditionalReview?.acknowledgedRisks) ? p.conditionalReview.acknowledgedRisks.slice(0, 64).map((a) => ({ name: str(a?.name, 128), at: iso(a?.at) })).filter((a) => a.name) : []
    },
    route: Array.isArray(p?.route) ? p.route.map(version).filter(Boolean).slice(0, 17) : null,
    path: normalizePath(p?.path),
    stages: Array.isArray(p?.stages) ? p.stages.slice(0, MAX_STAGES).map(normalizeStage).filter((s) => s.release) : [],
    stagesStale: Boolean(p?.stagesStale),
    inventory: normalizeInventory(p?.inventory),
    readiness: {
      attestations: Object.fromEntries(Object.entries(p?.readiness?.attestations && typeof p.readiness.attestations === "object" ? p.readiness.attestations : {})
        .filter(([k]) => /^[a-z0-9-]{1,48}$/.test(k)).slice(0, 64)
        .map(([k, v]) => [k, { at: iso(v?.at), note: str(v?.note, 500) }]))
    },
    origin: p?.origin && typeof p.origin === "object" ? { planId: str(p.origin.planId, 40), packageSha256: typeof p.origin.packageSha256 === "string" && /^[a-f0-9]{64}$/.test(p.origin.packageSha256) ? p.origin.packageSha256 : null, importedAt: iso(p.origin.importedAt) } : null
  };
};

export const normalizeUpgradeSlice = (slice) => {
  if (!slice || typeof slice !== "object" || slice._schema !== UPGRADE_SCHEMA) return emptyUpgradeSlice();
  const plans = (Array.isArray(slice.plans) ? slice.plans : []).filter((p) => isValidPlanId(p?.id)).slice(0, MAX_PLANS).map(normalizePlan);
  const activePlanId = plans.some((p) => p.id === slice.activePlanId) ? slice.activePlanId : null;
  return { _schema: UPGRADE_SCHEMA, activePlanId, plans };
};

/** A stored slice whose schema is newer than this build: Upgrade blocks; Install and Mirroring do not. */
export const unknownUpgradeSchema = (slice) => Boolean(slice && typeof slice === "object" && typeof slice._schema === "string" && slice._schema !== UPGRADE_SCHEMA);

/** Selection fields a plan update may change; any of them invalidates a solved route. */
export const SELECTION_FIELDS = Object.freeze(["arch", "currentChannel", "planningChannel", "channelPolicy", "current", "target", "strategy", "channelStrategy", "graphSource"]);
