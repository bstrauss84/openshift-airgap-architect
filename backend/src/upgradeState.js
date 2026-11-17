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
import { normalizeRegistryReference } from "../../shared/registryReference.js";
import crypto from "node:crypto";
import { PLANNING_CHANNEL_RE, GRAPH_ARCHES, gaVersion } from "../../shared/upgradePath.js";
import { redactText } from "./upgradeInventory.js";

export const UPGRADE_SCHEMA = "oaa.upgrade.slice/v1";
export const MAX_PLANS = 20;
export const MAX_STAGES = 8;
export const UPDATE_METHODS = Object.freeze(["osus", "cli", "web"]);
export const STRATEGIES = Object.freeze(["standard", "cpo"]);
/** How a plan's stages are mirrored by default (v2.3.0 UX: entered once, per plan). */
export const MIRROR_METHODS = Object.freeze(["mirrorToDisk", "mirrorToMirror", "diskToMirror"]);
export const CATALOG_TAG_MODES = Object.freeze(["source", "plan"]);
/** The plan-specific catalog tag for a stage minor: deterministic, lowercase, OCI-valid. */
export const planCatalogTag = (planId, minor) => `v${minor}-oaa-${String(planId).slice(2).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}`;
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
  // Received plans: the connected side's stage profile (matched to received transfers by their origin).
  originProfileId: typeof s?.originProfileId === "string" && /^p-[A-Za-z0-9_-]{8,32}$/.test(s.originProfileId) ? s.originProfileId : null,
  configSha256: typeof s?.configSha256 === "string" && /^[a-f0-9]{64}$/.test(s.configSha256) ? s.configSha256 : null,
  // Cluster progress is the user's statement (or imported evidence) — never inferred from mirroring.
  clusterUpdated: oneOf(s?.clusterUpdated, ["none", "attested", "evidenced"], "none"),
  clusterUpdatedAt: iso(s?.clusterUpdatedAt)
});

const normalizeInventory = (inv) => {
  if (!inv || typeof inv !== "object") return null;
  const minor = (v) => (typeof v === "string" && /^4\.\d{1,2}$/.test(v) ? v : null);
  const op = (o) => ({ name: str(o?.name, 128), namespace: str(o?.namespace, 128), version: str(o?.version, 64), channel: str(o?.channel, 128), source: str(o?.source, 128), phase: str(o?.phase, 64),
    ...(o?.csvPhase !== undefined ? { csvPhase: str(o.csvPhase, 64) } : {}), ...(o?.maxOpenShiftVersion !== undefined ? { maxOpenShiftVersion: minor(o.maxOpenShiftVersion) } : {}) });
  const conds = (l) => (Array.isArray(l) ? l.slice(0, 32).map((c) => ({ type: str(c?.type, 64), status: str(c?.status, 16), reason: str(c?.reason, 128), message: redactText(c?.message, 1000) })) : []);
  const SECTION_STATES = ["imported", "unavailable", "missing", "invalid"];
  // Readiness-bundle fields (owner QA P4) are kept only when present, through the same allowlist.
  const bundle = inv.source === "bundle" ? {
    source: "bundle",
    collector: str(inv.collector, 64),
    collectedAt: iso(inv.collectedAt),
    sections: Object.fromEntries(Object.entries(inv.sections && typeof inv.sections === "object" ? inv.sections : {}).filter(([k, v]) => /^[a-z]{2,32}$/.test(k) && SECTION_STATES.includes(v?.state)).slice(0, 16)
      .map(([k, v]) => [k, { state: v.state, ...(v.reason ? { reason: str(v.reason, 300) } : {}), ...(Number.isFinite(v.count) ? { count: v.count } : {}) }])),
    ...(Array.isArray(inv.clusterOperators) ? { clusterOperators: inv.clusterOperators.slice(0, 128).map((co) => ({ name: str(co?.name, 128), version: str(co?.version, 64), conditions: conds(co?.conditions) })) } : {}),
    ...(Array.isArray(inv.csvs) ? { csvs: inv.csvs.slice(0, 500).map((c) => ({ name: str(c?.name, 128), namespace: str(c?.namespace, 128), version: str(c?.version, 64), phase: str(c?.phase, 64), maxOpenShiftVersion: minor(c?.maxOpenShiftVersion) })) } : {}),
    ...(Array.isArray(inv.apiRemovals) ? { apiRemovals: inv.apiRemovals.slice(0, 500).map((a) => ({ name: str(a?.name, 200), removedInRelease: str(a?.removedInRelease, 16), requestCount: Number.isFinite(Number(a?.requestCount)) ? Number(a.requestCount) : 0 })) } : {}),
    ...(Array.isArray(inv.adminGates) ? { adminGates: inv.adminGates.slice(0, 64).filter((g) => /^ack-[a-z0-9.-]{1,120}$/.test(g?.key || "")).map((g) => ({ key: g.key, description: redactText(g?.description, 500), acknowledged: g?.acknowledged === true })), adminAcksRead: inv.adminAcksRead === true } : {})
  } : {};
  return {
    ...bundle,
    importedAt: iso(inv.importedAt),
    clusterVersion: inv.clusterVersion ? {
      version: version(inv.clusterVersion.version),
      channel: str(inv.clusterVersion.channel, 64),
      upstreamConfigured: Boolean(inv.clusterVersion.upstreamConfigured),
      conditions: conds(inv.clusterVersion.conditions),
      conditionalUpdates: Array.isArray(inv.clusterVersion.conditionalUpdates) ? inv.clusterVersion.conditionalUpdates.slice(0, 200).map((u) => ({ version: version(u?.version), recommended: str(u?.recommended, 16), reason: str(u?.reason, 128), risks: Array.isArray(u?.risks) ? u.risks.slice(0, 16).map((x) => str(x, 128)) : [] })) : [],
      history: Array.isArray(inv.clusterVersion.history) ? inv.clusterVersion.history.slice(0, 50).map((h) => ({ version: version(h?.version), state: str(h?.state, 32), completionTime: iso(h?.completionTime) })) : []
    } : null,
    operators: Array.isArray(inv.operators) ? inv.operators.slice(0, 500).map(op) : [],
    machineConfigPools: Array.isArray(inv.machineConfigPools) ? inv.machineConfigPools.slice(0, 64).map((m) => ({ name: str(m?.name, 128), paused: Boolean(m?.paused), updated: str(m?.updated, 16), degraded: str(m?.degraded, 16), master: Boolean(m?.master) })) : []
  };
};

export const MAX_INTENT = 300;
const INTENT_CATEGORIES = ["preset-mirrored", "installed", "requested", "retained"];
const INTENT_CONFIDENCE = ["imported-preset", "cluster-export", "user-confirmed", "user-entered"];
const normalizeSources = (list) => (Array.isArray(list) ? list.slice(0, 10).map((x) => ({ file: str(x?.file, 120), sha256: typeof x?.sha256 === "string" && /^[a-f0-9]{64}$/.test(x.sha256) ? x.sha256 : null })).filter((x) => x.file) : []);
const normalizeIntent = (e) => {
  const name = typeof e?.name === "string" && /^[a-z0-9][a-z0-9._-]{0,252}$/.test(e.name) ? e.name : null;
  const catalogKind = ["redhat", "certified", "community"].includes(e?.catalogKind) ? e.catalogKind : null;
  if (!name || !catalogKind) return null;
  return {
    key: `${catalogKind}|${name}`,
    name,
    catalogKind,
    channel: typeof e?.channel === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(e.channel) ? e.channel : null,
    category: oneOf(e?.category, INTENT_CATEGORIES, "preset-mirrored"),
    confidence: oneOf(e?.confidence, INTENT_CONFIDENCE, "imported-preset"),
    sources: normalizeSources(e?.sources),
    updatedAt: iso(e?.updatedAt)
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
    // One registry reference and mirroring method for the whole plan (v2.3.0 UX). A stored value that
    // is not a clean host[:port]/path (never credentials) is dropped rather than kept.
    mirror: {
      registryUrl: typeof p?.mirror?.registryUrl === "string" && normalizeRegistryReference(p.mirror.registryUrl).ok ? normalizeRegistryReference(p.mirror.registryUrl).value : null,
      method: oneOf(p?.mirror?.method, MIRROR_METHODS, p?.kind === "received" ? "diskToMirror" : "mirrorToDisk"),
      // "source": catalogs keep their source tag (oc-mirror replaces whatever that tag held in the registry);
      // "plan": each stage writes its catalog under a plan-specific tag, leaving existing consumers untouched.
      catalogTag: oneOf(p?.mirror?.catalogTag, CATALOG_TAG_MODES, "source")
    },
    conditionalReview: {
      enabled: Boolean(p?.conditionalReview?.enabled),
      // Administrator judgment, recorded as such: never proof of cluster-specific safety.
      acknowledgedRisks: Array.isArray(p?.conditionalReview?.acknowledgedRisks) ? p.conditionalReview.acknowledgedRisks.slice(0, 64).map((a) => ({ name: str(a?.name, 128), at: iso(a?.at) })).filter((a) => a.name) : []
    },
    route: Array.isArray(p?.route) ? p.route.map(version).filter(Boolean).slice(0, 17) : null,
    path: normalizePath(p?.path),
    stages: Array.isArray(p?.stages) ? p.stages.slice(0, MAX_STAGES).map(normalizeStage).filter((s) => s.release) : [],
    stagesStale: Boolean(p?.stagesStale),
    // Owner correction pass: what the user intends for each operator, with where it came from.
    // Imported presets stay "imported-preset" until the user (or a cluster export) confirms otherwise.
    operatorIntent: Array.isArray(p?.operatorIntent) ? p.operatorIntent.slice(0, MAX_INTENT).map(normalizeIntent).filter(Boolean) : [],
    presetImages: Array.isArray(p?.presetImages) ? p.presetImages.slice(0, 200).map((i) => ({ name: str(i?.name, 512), sources: normalizeSources(i?.sources) })).filter((i) => /^[a-z0-9][a-z0-9.\-]*(:\d+)?(\/[a-z0-9._\-]+)+(:[A-Za-z0-9._-]{1,128}|@sha256:[a-f0-9]{64})$/.test(i.name)) : [],
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
