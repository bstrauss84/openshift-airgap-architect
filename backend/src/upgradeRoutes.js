/**
 * /api/upgrade routes (v2.3.0 Upgrade workflow, RFC §8.3).
 *
 * Planning only: nothing here contacts a cluster, patches ClusterVersion or
 * approves an InstallPlan. Mirroring for a plan runs through the existing
 * Mirroring engine on Upgrade-owned stage profiles (one release each).
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { z } from "zod";
import { SUPPORTED_MINORS, buildUnsupportedVersionError } from "./versionPolicy.js";
import {
  MAX_PLANS, emptyUpgradeSlice, newPlanId, isValidPlanId, normalizePlan, SELECTION_FIELDS,
  UPDATE_METHODS, STRATEGIES, CHANNEL_STRATEGIES
} from "./upgradeState.js";
import {
  refreshPublicGraph, importGraph, readCachedGraph, describeGraphEntry, assertGraphRequest, UpdateGraphError, GRAPH_STALE_MS
} from "./updateGraph.js";
import { solvePath, classifyTargets, validateRoute, buildHops, channelPrefix, PLANNING_CHANNEL_RE, GRAPH_ARCHES, gaVersion } from "../../shared/upgradePath.js";
import { getMinorVersion } from "../../shared/versionUtils.js";

const planIdParam = (req, res) => {
  if (!isValidPlanId(req.params.id)) { res.status(400).json({ error: "Invalid plan id.", code: "PLAN_ID_INVALID" }); return null; }
  return req.params.id;
};

const versionField = z.string().max(16).refine((v) => Boolean(gaVersion(v)), "Use a released version such as 4.21.40.");
const channelField = z.string().max(32).regex(PLANNING_CHANNEL_RE, "Use a stable, fast or eus channel such as stable-4.22.");

export const upgradePlanCreateSchema = z.object({ name: z.string().max(120).optional() }).strict();
export const upgradePlanUpdateSchema = z.object({
  name: z.string().max(120).optional(),
  arch: z.enum(GRAPH_ARCHES).optional(),
  currentChannel: channelField.nullable().optional(),
  planningChannel: channelField.nullable().optional(),
  channelPolicy: z.enum(["stable", "eus", "fast"]).optional(),
  current: versionField.nullable().optional(),
  target: versionField.nullable().optional(),
  strategy: z.enum(STRATEGIES).optional(),
  channelStrategy: z.enum(CHANNEL_STRATEGIES).optional(),
  method: z.enum(UPDATE_METHODS).optional(),
  graphSource: z.enum(["public", "imported"]).optional(),
  conditionalReview: z.object({
    enabled: z.boolean(),
    acknowledgedRisks: z.array(z.string().max(128)).max(64).optional()
  }).strict().optional()
}).strict();
export const upgradeGraphRefreshSchema = z.object({ channel: channelField, arch: z.enum(GRAPH_ARCHES) }).strict();
export const upgradeGraphImportSchema = z.object({
  channel: channelField,
  arch: z.enum(GRAPH_ARCHES),
  origin: z.enum(["customer-osus", "snapshot"]),
  text: z.string().min(2).max(4 * 1024 * 1024),
  capturedAt: z.string().max(64).optional(),
  sourceUrl: z.string().max(2048).optional()
}).strict();
export const upgradeSolveSchema = z.object({
  route: z.array(versionField).min(2).max(17).optional()
}).strict();
export const upgradeActiveSchema = z.object({ planId: z.string().max(40).nullable() }).strict();
const secretText = z.string().min(2).max(65536);
export const upgradeSequenceSchema = z.object({
  mode: z.enum(["mirrorToDisk", "mirrorToMirror"]),
  stageIds: z.array(z.string().regex(/^s[0-9]{1,2}$/)).max(8).optional(),
  registryUrl: z.string().max(2048).optional(),
  rhAuthSource: z.enum(["inline", "mounted"]).optional(),
  rhPullSecret: secretText.optional(),
  mirrorPullSecret: secretText.optional(),
  destinationAuth: z.enum(["credentials", "anonymous"]).optional(),
  advanced: z.record(z.string().max(64), z.unknown()).optional(),
  previewToken: z.string().regex(/^[a-f0-9]{64}$/).optional()
}).strict();

const unsupported = (res, minor) => {
  const e = buildUnsupportedVersionError(minor);
  return res.status(422).json({ error: e.message, code: e.code, requestedVersion: e.requestedVersion, supportedVersions: e.supportedVersions });
};

/** The minor a channel names, or a version's minor, when it is outside support. */
const unsupportedMinorIn = (patch) => {
  for (const key of ["currentChannel", "planningChannel"]) {
    const c = patch[key];
    if (typeof c === "string") { const m = c.split("-")[1]; if (!SUPPORTED_MINORS.includes(m)) return m; }
  }
  for (const key of ["current", "target"]) {
    const v = patch[key];
    if (typeof v === "string" && gaVersion(v) && !SUPPORTED_MINORS.includes(getMinorVersion(v))) return getMinorVersion(v);
  }
  return null;
};

/** Planning channel default: the target minor in the plan's channel policy (eus-4.22 for CPO). */
export const defaultPlanningChannel = (plan) => {
  if (!plan.target) return null;
  const minor = getMinorVersion(plan.target);
  if (plan.strategy === "cpo") return "eus-4.22";
  if (plan.channelPolicy === "eus") return SUPPORTED_MINORS.includes(minor) && Number(minor.split(".")[1]) % 2 === 0 ? `eus-${minor}` : `stable-${minor}`;
  return `${plan.channelPolicy}-${minor}`;
};

export function registerUpgradeRoutes(app, deps) {
  const { validateBody, readUpgradeSlice, writeUpgradeSlice, isHighSide, describePlanExtras = () => ({}), onPlanDeleted = () => ({ ok: true, report: {} }), materializeStages = null, previewDeletion = () => ({}), previewSequence = null, startSequence = null, sequenceRunning = () => null } = deps;

  const loadPlan = (req, res) => {
    const id = planIdParam(req, res);
    if (!id) return null;
    const slice = readUpgradeSlice();
    const plan = slice.plans.find((p) => p.id === id);
    if (!plan) { res.status(404).json({ error: "No such upgrade plan.", code: "PLAN_NOT_FOUND" }); return null; }
    return { slice, plan };
  };
  const savePlan = (slice, plan) => {
    const next = { ...slice, plans: slice.plans.map((p) => (p.id === plan.id ? normalizePlan({ ...plan, updatedAt: new Date().toISOString() }) : p)) };
    writeUpgradeSlice(next);
    return readUpgradeSlice().plans.find((p) => p.id === plan.id);
  };
  const graphFor = (plan, channel) => readCachedGraph(plan.graphSource, channel, plan.arch);
  const describePlan = (plan) => {
    const planning = plan.planningChannel ? graphFor(plan, plan.planningChannel) : null;
    const freshness = describeGraphEntry(planning);
    return {
      ...plan,
      graph: freshness,
      // A route computed from a graph that has since changed or aged is shown "as of" its time, never as current.
      pathStatus: !plan.path ? "none"
        : !planning ? "graph-missing"
        : plan.path.graphSources[0]?.bodySha256 && plan.path.graphSources[0].bodySha256 !== planning.bodySha256 ? "graph-changed"
        : freshness?.stale ? "as-of" : "current",
      ...describePlanExtras(plan)
    };
  };

  app.get("/api/upgrade", (req, res) => {
    const slice = readUpgradeSlice();
    res.json({ _schema: slice._schema, activePlanId: slice.activePlanId, plans: slice.plans.map(describePlan), supportedMinors: SUPPORTED_MINORS, highSide: isHighSide() });
  });

  app.post("/api/upgrade/plans", validateBody(upgradePlanCreateSchema), (req, res) => {
    const slice = readUpgradeSlice();
    if (slice.plans.length >= MAX_PLANS) return res.status(409).json({ error: `At most ${MAX_PLANS} upgrade plans can be kept. Delete one first.`, code: "PLAN_LIMIT" });
    const id = newPlanId();
    const plan = normalizePlan({ id, name: req.body.name || `Upgrade plan ${slice.plans.length + 1}`, createdAt: new Date().toISOString() });
    writeUpgradeSlice({ ...slice, activePlanId: id, plans: [...slice.plans, plan] });
    res.status(201).json(describePlan(readUpgradeSlice().plans.find((p) => p.id === id)));
  });

  app.post("/api/upgrade/active", validateBody(upgradeActiveSchema), (req, res) => {
    const slice = readUpgradeSlice();
    const planId = req.body.planId;
    if (planId !== null && !slice.plans.some((p) => p.id === planId)) return res.status(404).json({ error: "No such upgrade plan.", code: "PLAN_NOT_FOUND" });
    writeUpgradeSlice({ ...slice, activePlanId: planId });
    res.json({ activePlanId: planId });
  });

  app.post("/api/upgrade/plans/:id", validateBody(upgradePlanUpdateSchema), (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    const { slice, plan } = loaded;
    if (plan.kind === "received") return res.status(409).json({ error: "A received plan is read-only.", code: "PLAN_READ_ONLY" });
    const patch = { ...req.body };
    const bad = unsupportedMinorIn(patch);
    if (bad) return unsupported(res, bad);
    const next = { ...plan, ...patch };
    if (patch.conditionalReview) {
      next.conditionalReview = {
        enabled: patch.conditionalReview.enabled,
        acknowledgedRisks: patch.conditionalReview.enabled ? (patch.conditionalReview.acknowledgedRisks || []).map((name) => ({ name, at: new Date().toISOString() })) : []
      };
    }
    const selectionChanged = SELECTION_FIELDS.some((k) => k in patch && patch[k] !== plan[k]) || (patch.conditionalReview && !patch.conditionalReview.enabled && plan.path?.conditional);
    if (selectionChanged) {
      if (!("planningChannel" in patch) || patch.planningChannel === null) next.planningChannel = defaultPlanningChannel(next);
      if (plan.stages.some((s) => s.profileId) && plan.path && next.target !== plan.target) {
        // Stage profiles keep their own history; a changed route makes them stale, never rewritten (RFC §8.4).
        next.stagesStale = true;
      }
      next.path = null;
      next.route = null;
    }
    res.json(describePlan(savePlan(slice, next)));
  });

  app.delete("/api/upgrade/plans/:id", (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    const { slice, plan } = loaded;
    const removeStageProfiles = req.query.removeStageProfiles === "true";
    const seq = sequenceRunning(plan.id);
    if (seq) return res.status(409).json({ error: "A stage sequence of this plan is running. Stop it before deleting the plan.", code: "STAGE_RUNNING", jobId: seq });
    const outcome = onPlanDeleted(plan, { removeStageProfiles });
    if (!outcome.ok) return res.status(outcome.status || 409).json(outcome.json);
    const plans = slice.plans.filter((p) => p.id !== plan.id);
    writeUpgradeSlice({ ...slice, plans, activePlanId: slice.activePlanId === plan.id ? null : slice.activePlanId });
    res.json({ ok: true, deletedPlanId: plan.id, ...outcome.report });
  });

  /** What deleting this plan would touch (for the layered confirmation, RFC §18.4). Changes nothing. */
  app.get("/api/upgrade/plans/:id/deletion-preview", (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    res.json(previewDeletion(loaded.plan));
  });

  /** Create or reuse one Upgrade-owned Mirroring profile per required release. */
  app.post("/api/upgrade/plans/:id/stages", (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    const { slice, plan } = loaded;
    if (plan.kind === "received") return res.status(409).json({ error: "A received plan's stages come from its transfers.", code: "PLAN_READ_ONLY" });
    if (!plan.path) return res.status(409).json({ error: "Compute the update route first.", code: "PATH_REQUIRED" });
    if (!materializeStages) return res.status(501).json({ error: "Stages are not available.", code: "NOT_AVAILABLE" });
    const outcome = materializeStages(plan);
    if (!outcome.ok) return res.status(outcome.status).json(outcome.json);
    const saved = savePlan(slice, { ...plan, stages: outcome.stages, stagesStale: false });
    res.json({ plan: describePlan(saved), ...outcome.report });
  });

  /** The exact scope of a stage sequence, for review before it is started (no secrets in or out). */
  app.post("/api/upgrade/plans/:id/sequence/preview", validateBody(upgradeSequenceSchema), (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    if (!previewSequence) return res.status(501).json({ error: "Not available.", code: "NOT_AVAILABLE" });
    const { rhPullSecret: _a, mirrorPullSecret: _b, ...scope } = req.body;
    const out = previewSequence(loaded.plan, scope);
    res.status(out.ok ? 200 : out.status).json(out.json);
  });

  /** Start a reviewed sequence (explicit confirmation token required). */
  app.post("/api/upgrade/plans/:id/sequence", validateBody(upgradeSequenceSchema), (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    if (!startSequence) return res.status(501).json({ error: "Not available.", code: "NOT_AVAILABLE" });
    if (!req.body.previewToken) return res.status(400).json({ error: "Review the sequence first; starting it needs the reviewed scope.", code: "SEQUENCE_NOT_REVIEWED" });
    const out = startSequence(loaded.plan, req.body);
    res.status(out.ok ? 202 : out.status).json(out.json);
  });

  app.get("/api/upgrade/graph", (req, res) => {
    const channel = String(req.query.channel || "");
    const arch = String(req.query.arch || "");
    const source = req.query.source === "imported" ? "imported" : "public";
    try { assertGraphRequest(channel, arch); } catch (err) { return res.status(err.status).json({ error: err.message, code: err.code }); }
    const entry = readCachedGraph(source, channel, arch);
    if (!entry) return res.status(404).json({ error: source === "public" ? "This graph has not been loaded yet. Refresh it from the update service." : "No imported graph for this channel and architecture.", code: "GRAPH_NOT_LOADED" });
    res.json({ graph: describeGraphEntry(entry), normalized: entry.normalized });
  });

  app.post("/api/upgrade/graph/refresh", validateBody(upgradeGraphRefreshSchema), async (req, res) => {
    if (isHighSide()) return res.status(409).json({ error: "This is a disconnected (high-side) Architect: it never contacts api.openshift.com. Import a graph snapshot or your OpenShift Update Service's graph instead.", code: "GRAPH_OFFLINE_SIDE" });
    try {
      const entry = await refreshPublicGraph(req.body.channel, req.body.arch);
      res.json({ graph: describeGraphEntry(entry) });
    } catch (err) {
      if (err instanceof UpdateGraphError) return res.status(err.status).json({ error: err.message, code: err.code });
      res.status(502).json({ error: "The update graph could not be loaded.", code: "GRAPH_FAILED" });
    }
  });

  app.post("/api/upgrade/graph/import", validateBody(upgradeGraphImportSchema), (req, res) => {
    try {
      const entry = importGraph(req.body);
      res.json({ graph: describeGraphEntry(entry) });
    } catch (err) {
      if (err instanceof UpdateGraphError) return res.status(err.status).json({ error: err.message, code: err.code });
      res.status(422).json({ error: "The graph could not be imported.", code: "GRAPH_INVALID" });
    }
  });

  app.get("/api/upgrade/plans/:id/targets", (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    const { plan } = loaded;
    if (!plan.current) return res.status(409).json({ error: "Choose the current version first.", code: "CURRENT_REQUIRED" });
    const channel = req.query.channel && PLANNING_CHANNEL_RE.test(String(req.query.channel)) ? String(req.query.channel) : plan.planningChannel || plan.currentChannel;
    if (!channel) return res.status(409).json({ error: "Choose a channel first.", code: "CHANNEL_REQUIRED" });
    const entry = graphFor(plan, channel);
    if (!entry) return res.status(409).json({ error: `Load the ${channel} graph first.`, code: "GRAPH_NOT_LOADED" });
    if (!entry.normalized.nodes[plan.current]) return res.status(409).json({ error: `${plan.current} is not in the ${channel} graph for ${plan.arch}.`, code: "SOURCE_NOT_IN_GRAPH" });
    res.json({ channel, graph: describeGraphEntry(entry), targets: classifyTargets(entry.normalized, plan.current, { supportedMinors: SUPPORTED_MINORS }) });
  });

  app.post("/api/upgrade/plans/:id/solve", validateBody(upgradeSolveSchema), async (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    const { slice, plan } = loaded;
    if (!plan.current || !plan.target) return res.status(409).json({ error: "Choose the current and target versions first.", code: "SELECTION_INCOMPLETE" });
    const planningChannel = plan.planningChannel || defaultPlanningChannel(plan);
    const planning = graphFor(plan, planningChannel);
    if (!planning) return res.status(409).json({ error: `Load the ${planningChannel} graph for ${plan.arch} first.`, code: "GRAPH_NOT_LOADED", channel: planningChannel });
    // Each hop is validated in the channel the cluster is on for it; public graphs
    // for those channels are loaded on demand (a connected low side only).
    const stepGraphs = {};
    const sources = [describeGraphEntry(planning)];
    if (plan.channelStrategy === "per-minor" && channelPrefix(planningChannel) !== "eus") {
      for (const minor of SUPPORTED_MINORS) {
        const ch = `${channelPrefix(planningChannel)}-${minor}`;
        let entry = graphFor(plan, ch);
        const aged = entry && entry.source === "public" && Date.now() - Date.parse(entry.fetchedAt) > GRAPH_STALE_MS;
        if ((!entry || aged) && plan.graphSource === "public" && !isHighSide()) {
          try { entry = await refreshPublicGraph(ch, plan.arch); } catch { /* recorded as not checked */ }
        }
        if (entry) { stepGraphs[ch] = entry.normalized; if (ch !== planningChannel) sources.push(describeGraphEntry(entry)); }
      }
    }
    const includeConditional = plan.conditionalReview.enabled;
    let result;
    if (req.body.route) {
      const v = validateRoute({ graph: planning.normalized, route: req.body.route, supportedMinors: SUPPORTED_MINORS, allowConditional: includeConditional });
      if (!v.ok || req.body.route[0] !== plan.current || req.body.route[req.body.route.length - 1] !== plan.target) {
        return res.status(409).json({ error: "That route is not a valid sequence of updates in the graph for this plan.", code: v.reason || "ROUTE_ENDPOINTS", ...v });
      }
      const hops = buildHops({ graph: planning.normalized, versions: req.body.route, strategy: plan.strategy, channelStrategy: plan.channelStrategy, stepGraphs });
      result = { ok: !hops.some((h) => h.channelCheck === "missing"), conditional: hops.some((h) => h.conditional), path: req.body.route, hops, selectedBy: "user", alternativesTotal: 0, reasons: [] };
    } else {
      result = solvePath({ graph: planning.normalized, source: plan.current, target: plan.target, supportedMinors: SUPPORTED_MINORS, strategy: plan.strategy, includeConditional, channelStrategy: plan.channelStrategy, stepGraphs });
    }
    const unsupportedReason = result.reasons?.find((r) => r.code === "SOURCE_UNSUPPORTED" || r.code === "TARGET_UNSUPPORTED");
    if (unsupportedReason) return res.status(422).json({ error: unsupportedReason.message, code: "UNSUPPORTED_VERSION", reasons: result.reasons, supportedVersions: SUPPORTED_MINORS });
    if (!result.path) return res.status(409).json({ error: result.reasons?.[0]?.message || "No route.", code: result.reasons?.[0]?.code || "NO_PATH", reasons: result.reasons, conditionalAvailable: Boolean(result.conditionalAvailable) });
    const path = {
      solver: result.solver || "oaa.upgrade.solver/v1",
      computedAt: new Date().toISOString(),
      conditional: Boolean(result.conditional),
      selectedBy: result.selectedBy,
      path: result.path,
      hops: result.hops,
      alternativesTotal: result.alternativesTotal || 0,
      graphSources: sources.map((s) => ({ channel: s.channel, arch: s.arch, source: s.source, origin: s.origin, sourceUrl: s.sourceUrl, fetchedAt: s.fetchedAt, bodySha256: s.bodySha256 })),
      reasons: (result.reasons || []).map((r) => ({ code: r.code, message: r.message }))
    };
    const saved = savePlan(slice, { ...plan, planningChannel, path, route: result.path });
    res.json({ plan: describePlan(saved), ok: result.ok, alternatives: result.alternatives || [], alternativesTotal: result.alternativesTotal || 0 });
  });

  return { defaultPlanningChannel };
}
