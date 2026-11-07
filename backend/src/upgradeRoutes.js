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
  refreshPublicGraph, importGraph, readCachedGraph, describeGraphEntry, assertGraphRequest, UpdateGraphError, GRAPH_STALE_MS,
  explorationGraph, exploreMinors
} from "./updateGraph.js";
import { solvePath, classifyTargets, validateRoute, buildHops, channelPrefix, PLANNING_CHANNEL_RE, GRAPH_ARCHES, gaVersion, exploreRoute } from "../../shared/upgradePath.js";
import { getMinorVersion, compareVersions } from "../../shared/versionUtils.js";
import { evaluateReadiness, ATTESTABLE } from "./upgradeReadiness.js";
import { projectInventory, InventoryError, INVENTORY_KINDS, INVENTORY_COMMANDS } from "./upgradeInventory.js";
import { buildInstructions } from "./upgradeInstructions.js";
import { analyzePresetFiles, OPERATOR_CATEGORIES } from "./upgradePresets.js";
import { normalizeRegistryReference } from "../../shared/registryReference.js";
import { registryReferenceField } from "./schemas.js";
import { MIRROR_METHODS, CATALOG_TAG_MODES } from "./upgradeState.js";

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
export const upgradeInventorySchema = z.object({ kind: z.enum(INVENTORY_KINDS), text: z.string().min(2).max(20 * 1024 * 1024) }).strict();
export const upgradeAttestSchema = z.object({ checkId: z.string().max(48), attested: z.boolean(), note: z.string().max(500).optional() }).strict();
export const upgradeClusterProgressSchema = z.object({ stageId: z.string().regex(/^s[0-9]{1,2}$/), state: z.enum(["none", "attested"]) }).strict();
export const upgradeImportSchema = z.object({ text: z.string().min(2).max(9 * 1024 * 1024) }).strict();
const intentEntry = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,252}$/),
  catalogKind: z.enum(["redhat", "certified", "community"]),
  channel: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/).nullable().optional(),
  category: z.enum(["preset-mirrored", "installed", "requested", "retained"]),
  confidence: z.enum(["imported-preset", "cluster-export", "user-confirmed", "user-entered"]),
  sources: z.array(z.object({ file: z.string().max(120), sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional() }).strict()).max(10).optional()
}).strict();
export const upgradePresetAnalyzeSchema = z.object({ files: z.array(z.object({ name: z.string().max(255), text: z.string().max(2 * 1024 * 1024) }).strict()).min(1).max(10) }).strict();
export const upgradeIntentSchema = z.object({
  entries: z.array(intentEntry).max(300).optional(),
  images: z.array(z.object({ name: z.string().max(512), sources: z.array(z.object({ file: z.string().max(120), sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional() }).strict()).max(10).optional() }).strict()).max(200).optional(),
  remove: z.array(z.string().max(300)).max(300).optional(),
  replaceConfirmed: z.boolean().optional()
}).strict();
export const upgradeIntentApplySchema = z.object({ keys: z.array(z.string().max(300)).max(300), includeImages: z.boolean().optional() }).strict();
/** Plan-level mirroring settings (v2.3.0 UX): one registry reference and method reused by every stage, the instructions and templates. Never credentials. */
export const upgradeMirrorSettingsSchema = z.object({
  registryUrl: z.string().max(2048).nullable().optional(),
  method: z.enum(MIRROR_METHODS).optional(),
  catalogTag: z.enum(CATALOG_TAG_MODES).optional()
}).strict();
export const upgradeCopyOperatorsSchema = z.object({ toStageIds: z.array(z.string().regex(/^s\d{1,2}$/)).max(8).optional() }).strict();
export const upgradeExploreSchema = z.object({ arch: z.enum(GRAPH_ARCHES), source: z.string().max(16), target: z.string().max(16) }).strict();
export const upgradeActiveSchema = z.object({ planId: z.string().max(40).nullable() }).strict();
const secretText = z.string().min(2).max(65536);
export const upgradeSequenceSchema = z.object({
  mode: z.enum(["mirrorToDisk", "mirrorToMirror"]),
  stageIds: z.array(z.string().regex(/^s[0-9]{1,2}$/)).max(8).optional(),
  registryUrl: registryReferenceField.optional(),
  // Catalog tags the user saw would be replaced and accepted, by exact destination reference.
  acknowledgedOverwrites: z.array(z.string().max(600)).max(100).optional(),
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
  const { validateBody, readUpgradeSlice, writeUpgradeSlice, isHighSide, describePlanExtras = () => ({}), onPlanDeleted = () => ({ ok: true, report: {} }), materializeStages = null, previewDeletion = () => ({}), previewSequence = null, startSequence = null, sequenceRunning = () => null, stageEvidence = () => ({ clusterResources: {}, signatureEvidence: {} }), buildArtifacts = null, applyIntentToStages = null, applyMirrorToStages = null, checkSequenceDestination = null, copyStageOperators = null } = deps;

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

  /**
   * Plan mirroring settings: the registry reference and method entered once and reused by every
   * stage (unless a stage was deliberately given its own), the sequence, instructions and templates.
   * The reference is validated and normalized here; it can never carry a credential.
   */
  app.post("/api/upgrade/plans/:id/mirror", validateBody(upgradeMirrorSettingsSchema), (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    const { slice, plan } = loaded;
    const next = { ...plan.mirror };
    if ("registryUrl" in req.body) {
      if (req.body.registryUrl === null || !req.body.registryUrl.trim()) next.registryUrl = null;
      else {
        const r = normalizeRegistryReference(req.body.registryUrl);
        if (!r.ok) return res.status(400).json({ error: r.reason, code: r.code });
        next.registryUrl = r.value;
      }
    }
    if (req.body.method) next.method = req.body.method;
    if (req.body.catalogTag) next.catalogTag = req.body.catalogTag;
    let report = [];
    if ((next.registryUrl !== plan.mirror.registryUrl || next.catalogTag !== plan.mirror.catalogTag) && applyMirrorToStages) {
      const applied = applyMirrorToStages(plan, plan.mirror, next);
      if (!applied.ok) return res.status(applied.status).json(applied.json);
      report = applied.report;
    }
    const saved = savePlan(slice, { ...plan, mirror: next });
    res.json({ plan: describePlan(saved), report });
  });

  /** Copy a stage's operators to later stages, each from its own minor's catalog (never changes existing selections). */
  app.post("/api/upgrade/plans/:id/stages/:stageId/copy-operators", validateBody(upgradeCopyOperatorsSchema), (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    if (loaded.plan.kind === "received") return res.status(409).json({ error: "A received plan is read-only.", code: "PLAN_READ_ONLY" });
    if (!/^s\d{1,2}$/.test(req.params.stageId)) return res.status(400).json({ error: "Invalid stage id.", code: "STAGE_ID_INVALID" });
    if (!copyStageOperators) return res.status(501).json({ error: "Not available.", code: "NOT_AVAILABLE" });
    const out = copyStageOperators(loaded.plan, req.params.stageId, req.body.toStageIds);
    if (!out.ok) return res.status(out.status).json(out.json);
    res.json({ plan: describePlan(readUpgradeSlice().plans.find((p) => p.id === loaded.plan.id)), report: out.report });
  });

  /**
   * Exploration only (owner decision D-1): a route between releases from 4.1 up to the newest
   * supported minor, from REAL edges of each step's stable-4.N graph (same allowlisted host, its own
   * cache). Never changes a plan; nothing is generated from it. Targets above the newest supported
   * minor are refused (422), as everywhere else.
   */
  app.post("/api/upgrade/explore", validateBody(upgradeExploreSchema), async (req, res) => {
    if (isHighSide()) return res.status(409).json({ error: "Exploration reads the public update graph (api.openshift.com), which the disconnected side does not reach.", code: "GRAPH_OFFLINE_SIDE" });
    const minors = exploreMinors();
    const src = gaVersion(req.body.source);
    const dst = gaVersion(req.body.target);
    if (dst && !minors.includes(getMinorVersion(dst)) && compareVersions(getMinorVersion(dst), minors[minors.length - 1]) > 0) return unsupported(res, getMinorVersion(dst));
    if (!src || !dst || !minors.includes(getMinorVersion(src)) || !minors.includes(getMinorVersion(dst))) {
      return res.json(exploreRoute({ graphs: {}, source: req.body.source, target: req.body.target, minors, planningMinors: SUPPORTED_MINORS, arch: req.body.arch }));
    }
    const from = minors.indexOf(getMinorVersion(src));
    const to = minors.indexOf(getMinorVersion(dst));
    if (to < from) return res.json(exploreRoute({ graphs: {}, source: src, target: dst, minors, planningMinors: SUPPORTED_MINORS, arch: req.body.arch }));
    const graphs = {};
    const sources = [];
    const failures = [];
    for (const m of minors.slice(from, to + 1)) {
      const channel = `stable-${m}`;
      try {
        const entry = await explorationGraph(channel, req.body.arch);
        graphs[channel] = entry.normalized;
        sources.push({ channel, fetchedAt: entry.fetchedAt, bodySha256: entry.bodySha256 });
      } catch (err) {
        failures.push({ code: "GRAPH_UNAVAILABLE", message: `The ${channel} graph for ${req.body.arch} could not be read: ${err instanceof UpdateGraphError ? err.message : "unexpected error"}` });
      }
    }
    if (failures.length) return res.json({ ok: false, exploration: true, reasons: failures, nextStep: "Try again when api.openshift.com is reachable from this server." });
    const out = exploreRoute({ graphs, source: src, target: dst, minors, planningMinors: SUPPORTED_MINORS, arch: req.body.arch });
    const docs = out.ok
      ? [...new Set(out.hops.map((h) => getMinorVersion(h.to)).filter((m) => !SUPPORTED_MINORS.includes(m)))].map((m) => ({ minor: m, url: `https://docs.redhat.com/en/documentation/openshift_container_platform/${m}/html/updating_clusters/index`, humanVerified: false }))
      : [];
    res.json({ ...out, graphSources: sources, docs, asOf: "Red Hat's update graph as it is today; past recommendations are not reconstructed." });
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
  /**
   * Read-only destination check before a mirror-to-mirror operation: which catalog tags would be
   * replaced. Uses destination credentials for this request only (temporary auth file removed after).
   */
  app.post("/api/upgrade/plans/:id/sequence/destination-check", validateBody(upgradeSequenceSchema), async (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    if (!checkSequenceDestination) return res.status(501).json({ error: "Not available.", code: "NOT_AVAILABLE" });
    const { rhPullSecret: _a, ...scope } = req.body;
    const out = await checkSequenceDestination(loaded.plan, scope, { mirrorPullSecret: req.body.mirrorPullSecret, destinationAuth: req.body.destinationAuth });
    res.status(out.ok ? 200 : out.status).json(out.json);
  });

  app.post("/api/upgrade/plans/:id/sequence", validateBody(upgradeSequenceSchema), async (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    if (!startSequence) return res.status(501).json({ error: "Not available.", code: "NOT_AVAILABLE" });
    if (!req.body.previewToken) return res.status(400).json({ error: "Review the sequence first; starting it needs the reviewed scope.", code: "SEQUENCE_NOT_REVIEWED" });
    const out = await startSequence(loaded.plan, req.body);
    res.status(out.ok ? 202 : out.status).json(out.json);
  });

  const readinessFor = (plan) => {
    const described = describePlan(plan);
    const ev = stageEvidence(plan);
    return { described, evidence: ev, readiness: evaluateReadiness(plan, { pathStatus: described.pathStatus, stageViews: described.stageViews || [], signatureEvidence: ev.signatureEvidence }) };
  };

  /** Readiness checklist (evidence-based states; never asserts cluster readiness without evidence). */
  app.get("/api/upgrade/plans/:id/readiness", (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    const { readiness } = readinessFor(loaded.plan);
    res.json({ ...readiness, attestable: ATTESTABLE, inventoryCommands: INVENTORY_COMMANDS });
  });

  /** Read-only cluster export import (projected; kubeconfigs and Secrets refused; cluster ID dropped). */
  app.post("/api/upgrade/plans/:id/inventory", validateBody(upgradeInventorySchema), (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    const { slice, plan } = loaded;
    try {
      const part = projectInventory(req.body.kind, req.body.text);
      const inventory = { ...(plan.inventory || {}), ...part, importedAt: new Date().toISOString() };
      delete inventory.operatorsKind;
      const saved = savePlan(slice, { ...plan, inventory });
      res.json({ inventory: saved.inventory });
    } catch (err) {
      if (err instanceof InventoryError) return res.status(err.status).json({ error: err.message, code: err.code });
      res.status(422).json({ error: "The document could not be read.", code: "INVENTORY_INVALID" });
    }
  });

  app.delete("/api/upgrade/plans/:id/inventory", (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    savePlan(loaded.slice, { ...loaded.plan, inventory: null });
    res.json({ ok: true });
  });

  /** Administrator statements for checks Architect cannot observe (recorded as judgment). */
  app.post("/api/upgrade/plans/:id/attest", validateBody(upgradeAttestSchema), (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    const { slice, plan } = loaded;
    if (!ATTESTABLE[req.body.checkId]) return res.status(400).json({ error: "That check is decided by evidence, not by a statement.", code: "NOT_ATTESTABLE" });
    const attestations = { ...(plan.readiness?.attestations || {}) };
    if (req.body.attested) attestations[req.body.checkId] = { at: new Date().toISOString(), note: req.body.note || "" };
    else delete attestations[req.body.checkId];
    savePlan(slice, { ...plan, readiness: { attestations } });
    res.json(readinessFor(readUpgradeSlice().plans.find((p) => p.id === plan.id)).readiness);
  });

  /** The administrator's own record of cluster progress per stage (never inferred from mirroring). */
  app.post("/api/upgrade/plans/:id/cluster-progress", validateBody(upgradeClusterProgressSchema), (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    const { slice, plan } = loaded;
    if (!plan.stages.some((s) => s.id === req.body.stageId)) return res.status(404).json({ error: "No such stage.", code: "STAGE_NOT_FOUND" });
    const stages = plan.stages.map((s) => (s.id === req.body.stageId ? { ...s, clusterUpdated: req.body.state, clusterUpdatedAt: req.body.state === "none" ? null : new Date().toISOString() } : s));
    res.json(describePlan(savePlan(slice, { ...plan, stages })));
  });

  /** OSUS / CLI / web instructions for the solved route. */
  app.get("/api/upgrade/plans/:id/instructions", (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    const { readiness, evidence } = readinessFor(loaded.plan);
    // The plan's registry is the single source; an explicit ?registry= (validated, never echoed) or run evidence may stand in.
    let registry = loaded.plan.mirror?.registryUrl || evidence.registry || "";
    if (typeof req.query.registry === "string" && req.query.registry.trim()) {
      const r = normalizeRegistryReference(req.query.registry);
      if (!r.ok) return res.status(400).json({ error: r.reason, code: r.code });
      registry = r.value;
    }
    const out = buildInstructions(loaded.plan, { readiness, registry, clusterResources: evidence.clusterResources });
    if (!out.ok) return res.status(409).json({ error: out.message, code: out.code });
    res.json(out);
  });

  /** Artifacts: validated stage ImageSetConfigurations, documented templates, and files completed runs produced. */
  app.get("/api/upgrade/plans/:id/artifacts", (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    if (!buildArtifacts) return res.status(501).json({ error: "Not available.", code: "NOT_AVAILABLE" });
    res.json(buildArtifacts(loaded.plan));
  });

  /**
   * Analyze one or more earlier ImageSetConfigurations as presets. Nothing is
   * stored: the user reviews, edits and accepts what to apply.
   */
  app.post("/api/upgrade/plans/:id/presets/analyze", validateBody(upgradePresetAnalyzeSchema), (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    const out = analyzePresetFiles(req.body.files);
    if (out.error) return res.status(out.error.status).json({ error: out.error.message, code: out.error.code });
    res.json({ ...out, categories: OPERATOR_CATEGORIES });
  });

  /**
   * Merge accepted operator intent into the plan. An imported preset never
   * replaces an entry confirmed by the user or by a cluster export unless the
   * request says so explicitly (replaceConfirmed).
   */
  app.post("/api/upgrade/plans/:id/operator-intent", validateBody(upgradeIntentSchema), (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    const { slice, plan } = loaded;
    if (plan.kind === "received") return res.status(409).json({ error: "A received plan is read-only.", code: "PLAN_READ_ONLY" });
    const byKey = new Map(plan.operatorIntent.map((e) => [e.key, e]));
    for (const k of req.body.remove || []) byKey.delete(k);
    const skipped = [];
    for (const e of req.body.entries || []) {
      const key = `${e.catalogKind}|${e.name}`;
      const existing = byKey.get(key);
      const strongerExisting = existing && ["cluster-export", "user-confirmed"].includes(existing.confidence) && e.confidence === "imported-preset";
      if (strongerExisting && !req.body.replaceConfirmed) { skipped.push({ key, reason: `kept: already ${existing.category} (${existing.confidence}); an imported preset does not replace it` }); continue; }
      byKey.set(key, { ...e, key, updatedAt: new Date().toISOString() });
    }
    const images = new Map((plan.presetImages || []).map((i) => [i.name, i]));
    for (const i of req.body.images || []) images.set(i.name, i);
    const saved = savePlan(slice, { ...plan, operatorIntent: [...byKey.values()], presetImages: [...images.values()] });
    res.json({ plan: describePlan(saved), skipped });
  });

  /** Add accepted operators (and optionally preset images) to the plan's stage profiles; existing selections are never changed. */
  app.post("/api/upgrade/plans/:id/operator-intent/apply-to-stages", validateBody(upgradeIntentApplySchema), (req, res) => {
    const loaded = loadPlan(req, res);
    if (!loaded) return;
    const { plan } = loaded;
    if (!plan.stages.length) return res.status(409).json({ error: "Prepare the stages first.", code: "STAGES_REQUIRED" });
    if (!applyIntentToStages) return res.status(501).json({ error: "Not available.", code: "NOT_AVAILABLE" });
    const entries = plan.operatorIntent.filter((e) => req.body.keys.includes(e.key));
    const out = applyIntentToStages(plan, entries, { includeImages: Boolean(req.body.includeImages) });
    if (!out.ok) return res.status(out.status).json(out.json);
    res.json({ plan: describePlan(readUpgradeSlice().plans.find((p) => p.id === plan.id)), report: out.report });
  });

  app.get("/api/upgrade/graph", (req, res) => {
    const channel = String(req.query.channel || "");
    const arch = String(req.query.arch || "");
    const source = req.query.source === "imported" ? "imported" : "public";
    try { assertGraphRequest(channel, arch); } catch (err) { return res.status(err.status).json({ error: err.message, code: err.code }); }
    const entry = readCachedGraph(source, channel, arch);
    // "Not loaded yet" is a normal state of the selection flow, not an error (200, loaded: false).
    if (!entry) return res.json({ loaded: false, code: "GRAPH_NOT_LOADED", message: source === "public" ? "This graph has not been loaded yet. Refresh it from the update service." : "No imported graph for this channel and architecture.", graph: null, normalized: null });
    res.json({ loaded: true, graph: describeGraphEntry(entry), normalized: entry.normalized });
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

  return { defaultPlanningChannel, describePlan };
}
