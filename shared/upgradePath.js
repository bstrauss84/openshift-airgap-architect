/**
 * OpenShift update-graph normalization and deterministic path solving
 * (v2.3.0 Upgrade workflow, RFC §6). Pure functions, shared by the backend
 * (authoritative) and the frontend (display).
 *
 * Rules this module enforces:
 *  - Only real edges from the OpenShift Update Service graph are traversed.
 *    No edge is ever synthesized, and nothing here models `--force`.
 *  - Recommended routing uses unconditional `edges` only. `conditionalEdges`
 *    (updates with known risks) are kept separately with their risk metadata
 *    and are used only when the caller explicitly asks for conditional review.
 *  - Only versions in the supported minors passed in (OAA: 4.20–4.22) are
 *    kept; everything else is counted, never silently used.
 *  - One update never crosses more than one minor.
 *  - Among equal-length recommended routes, the default choice is the route
 *    with the highest version at each successive step. That is a
 *    deterministic display convention (it matches the head-of-channel routes
 *    Red Hat's own tools show), NOT a safety ranking: a newer intermediate
 *    release is not assumed to be safer or to contain every fix. All
 *    equal-length alternatives are returned so the user can choose another.
 *
 * Version parsing and comparison use shared/versionUtils.js only.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { normalizeVersion, getMinorVersion, compareVersions } from "./versionUtils.js";

export const SOLVER_VERSION = "oaa.upgrade.solver/v1";

/** Channel names this workflow may plan with (minor is checked separately against support). */
export const PLANNING_CHANNEL_RE = /^(stable|fast|eus)-4\.\d+$/;
/** Graph API architecture names (the API rejects x86_64 with HTTP 400). */
export const GRAPH_ARCHES = Object.freeze(["amd64", "arm64", "s390x", "ppc64le", "multi"]);
/** Human architecture names shown in the UI → graph API names. */
export const ARCH_ALIASES = Object.freeze({ x86_64: "amd64", aarch64: "arm64", amd64: "amd64", arm64: "arm64", s390x: "s390x", ppc64le: "ppc64le", multi: "multi" });

const PAYLOAD_RE = /^[a-z0-9][a-z0-9.\-/:_]*@sha256:[a-f0-9]{64}$/;
const MAX_RISK_TEXT = 2000;

/** The version string if it is a plain GA x.y.z release; otherwise null (pre-releases, hotfixes). */
export const gaVersion = (v) => {
  if (typeof v !== "string") return null;
  try {
    return normalizeVersion(v) === v ? v : null;
  } catch {
    return null;
  }
};

const minorOf = (v) => getMinorVersion(v);
const channelMinor = (channel) => {
  const m = typeof channel === "string" ? channel.match(/-(\d+\.\d+)$/) : null;
  return m ? m[1] : null;
};
export const channelPrefix = (channel) => (typeof channel === "string" ? channel.split("-")[0] : null);
const safeHttpsUrl = (u) => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 2048 ? u : null);
const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");

/**
 * Normalize one graph response body.
 *
 * @param {object} body - `{ nodes, edges, conditionalEdges }` as served by the graph API
 * @param {{ channel: string, arch: string, supportedMinors: string[] }} ctx
 */
export function normalizeGraph(body, { channel, arch, supportedMinors }) {
  const supported = new Set(supportedMinors || []);
  const nodes = Array.isArray(body?.nodes) ? body.nodes : [];
  const indexVersion = new Array(nodes.length).fill(null);
  const out = {};
  let excludedUnsupported = 0;
  let invalidNodes = 0;
  nodes.forEach((n, i) => {
    const v = gaVersion(n?.version);
    if (!v) { invalidNodes += 1; return; }
    if (!supported.has(minorOf(v))) { excludedUnsupported += 1; return; }
    const meta = n?.metadata && typeof n.metadata === "object" ? n.metadata : {};
    const channels = String(meta["io.openshift.upgrades.graph.release.channels"] || "")
      .split(",").map((c) => c.trim()).filter((c) => /^[a-z]+-\d+\.\d+$/.test(c));
    out[v] = {
      payload: typeof n.payload === "string" && PAYLOAD_RE.test(n.payload) ? n.payload : null,
      errataUrl: safeHttpsUrl(meta.url),
      channels
    };
    indexVersion[i] = v;
  });

  const conditionalKeys = new Map();
  for (const group of Array.isArray(body?.conditionalEdges) ? body.conditionalEdges : []) {
    const risks = (Array.isArray(group?.risks) ? group.risks : []).map((r) => ({
      name: clip(r?.name, 128),
      url: safeHttpsUrl(r?.url),
      message: clip(r?.message, MAX_RISK_TEXT),
      ruleTypes: [...new Set((Array.isArray(r?.matchingRules) ? r.matchingRules : []).map((m) => m?.type).filter((t) => typeof t === "string"))].sort()
    })).filter((r) => r.name);
    for (const e of Array.isArray(group?.edges) ? group.edges : []) {
      const from = gaVersion(e?.from);
      const to = gaVersion(e?.to);
      if (!from || !to || !out[from] || !out[to]) continue;
      const key = `${from}>${to}`;
      const existing = conditionalKeys.get(key);
      conditionalKeys.set(key, { from, to, risks: existing ? mergeRisks(existing.risks, risks) : risks });
    }
  }

  const edgeSet = new Set();
  const edges = [];
  for (const pair of Array.isArray(body?.edges) ? body.edges : []) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [a, b] = pair;
    if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
    const from = indexVersion[a];
    const to = indexVersion[b];
    if (!from || !to || compareVersions(from, to) >= 0) continue;
    const key = `${from}>${to}`;
    // An edge listed both ways is treated as conditional: the risk wins.
    if (conditionalKeys.has(key) || edgeSet.has(key)) continue;
    edgeSet.add(key);
    edges.push([from, to]);
  }
  edges.sort((x, y) => compareVersions(x[0], y[0]) || compareVersions(x[1], y[1]));
  const conditional = [...conditionalKeys.values()].sort((x, y) => compareVersions(x.from, y.from) || compareVersions(x.to, y.to));
  const versions = Object.keys(out).sort(compareVersions);
  return { channel, arch, versions, nodes: out, edges, conditional, excludedUnsupported, invalidNodes };
}

const mergeRisks = (a, b) => {
  const byName = new Map(a.map((r) => [r.name, r]));
  for (const r of b) if (!byName.has(r.name)) byName.set(r.name, r);
  return [...byName.values()].sort((x, y) => x.name.localeCompare(y.name));
};

const adjacency = (graph, includeConditional) => {
  const adj = new Map();
  const add = (from, to, conditional, risks) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push({ to, conditional, risks });
  };
  for (const [from, to] of graph.edges) add(from, to, false, []);
  if (includeConditional) for (const c of graph.conditional) add(c.from, c.to, true, c.risks);
  return adj;
};

/** Minor index distance; an edge may cross at most one minor. */
const minorStep = (supportedMinors, from, to) => supportedMinors.indexOf(minorOf(to)) - supportedMinors.indexOf(minorOf(from));

const bfsDistances = (start, neighbors) => {
  const dist = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const u = queue.shift();
    for (const w of neighbors(u)) {
      if (!dist.has(w)) { dist.set(w, dist.get(u) + 1); queue.push(w); }
    }
  }
  return dist;
};

const permittedEdges = (graph, supportedMinors, includeConditional) => {
  const adj = adjacency(graph, includeConditional);
  const forward = new Map();
  const reverse = new Map();
  for (const [from, list] of adj) {
    for (const e of list) {
      const step = minorStep(supportedMinors, from, e.to);
      if (step < 0 || step > 1) continue;
      if (!forward.has(from)) forward.set(from, []);
      forward.get(from).push(e);
      if (!reverse.has(e.to)) reverse.set(e.to, []);
      reverse.get(e.to).push(from);
    }
  }
  return { forward, reverse };
};

/**
 * Risk facts per conditional edge: `${from}>${to}` → { risks: [{ name, always, url }], always }.
 * "Always" (matchingRules type Always) applies to every cluster; other rule types (PromQL) apply
 * only to clusters matching the condition, which Architect cannot evaluate offline.
 */
export const conditionalEdgeRisks = (graph) => {
  const out = new Map();
  for (const c of graph?.conditional || []) {
    const risks = (c.risks || []).map((r) => ({ name: r.name, always: (r.ruleTypes || []).includes("Always"), url: r.url || null }));
    out.set(`${c.from}>${c.to}`, { risks, always: risks.some((r) => r.always) });
  }
  return out;
};

/**
 * The least-risk route from `source` to every reachable version when conditional edges are
 * allowed: a conditional edge whose risks include an "Always" rule costs 100, any other
 * conditional edge 1, a recommended edge 0; ties go to fewer updates. Returns
 * version → { cost, hops, via: [{ from, to, risks, always }] } (via = the conditional hops only).
 */
export function leastRiskRoutes(graph, source, { supportedMinors }) {
  const all = permittedEdges(graph, supportedMinors, true);
  const facts = conditionalEdgeRisks(graph);
  const best = new Map([[source, { cost: 0, hops: 0, prev: null, edge: null }]]);
  const done = new Set();
  for (;;) {
    let u = null;
    for (const [k, v] of best) {
      if (done.has(k)) continue;
      const b = u ? best.get(u) : null;
      if (!b || v.cost < b.cost || (v.cost === b.cost && v.hops < b.hops)) u = k;
    }
    if (!u) break;
    done.add(u);
    for (const e of all.forward.get(u) || []) {
      const f = e.conditional ? facts.get(`${u}>${e.to}`) : null;
      const w = !e.conditional ? 0 : f?.always ? 100 : 1;
      const cand = { cost: best.get(u).cost + w, hops: best.get(u).hops + 1, prev: u, edge: e.conditional ? { from: u, to: e.to, risks: f?.risks || [], always: Boolean(f?.always) } : null };
      const o = best.get(e.to);
      if (!o || cand.cost < o.cost || (cand.cost === o.cost && cand.hops < o.hops)) best.set(e.to, cand);
    }
  }
  const out = new Map();
  for (const [v, b] of best) {
    const via = [];
    for (let cur = v; best.get(cur)?.prev; cur = best.get(cur).prev) if (best.get(cur).edge) via.unshift(best.get(cur).edge);
    out.set(v, { cost: b.cost, hops: b.hops, via });
  }
  return out;
}

/**
 * Why later releases are conditional-only: for each minor boundary above the source's minor, the
 * releases from which the graph RECOMMENDS an update into the next minor, and which of those the
 * source reaches through recommended updates alone.
 */
export function minorGates(graph, source, { supportedMinors }) {
  const rec = permittedEdges(graph, supportedMinors, false);
  const reach = bfsDistances(source, (u) => (rec.forward.get(u) || []).map((e) => e.to));
  const startIdx = supportedMinors.indexOf(minorOf(source));
  const gates = [];
  for (let i = Math.max(0, startIdx); i < supportedMinors.length - 1; i += 1) {
    const from = supportedMinors[i];
    const to = supportedMinors[i + 1];
    const entries = graph.versions.filter((v) => minorOf(v) === from && (rec.forward.get(v) || []).some((e) => minorOf(e.to) === to));
    gates.push({ from, to, recommendedFrom: entries, reachableRecommended: entries.filter((v) => reach.has(v)) });
  }
  return gates;
}

/**
 * Classify every supported version above `source`: reachable through
 * recommended updates, reachable only through conditional updates, or not
 * reachable in this graph.
 */
export function classifyTargets(graph, source, { supportedMinors }) {
  const rec = permittedEdges(graph, supportedMinors, false);
  const all = permittedEdges(graph, supportedMinors, true);
  const recDist = bfsDistances(source, (u) => (rec.forward.get(u) || []).map((e) => e.to));
  const allDist = bfsDistances(source, (u) => (all.forward.get(u) || []).map((e) => e.to));
  const least = leastRiskRoutes(graph, source, { supportedMinors });
  return graph.versions
    .filter((v) => compareVersions(v, source) > 0)
    .map((v) => {
      const status = recDist.has(v) ? "recommended" : allDist.has(v) ? "conditional-only" : "unreachable";
      // A conditional-only target is not "conditional" itself: name the least-risk conditional
      // hop(s) on the way, and whether a risk there applies to every cluster.
      const lr = status === "conditional-only" ? least.get(v) : null;
      return {
        version: v,
        status,
        hops: recDist.get(v) ?? allDist.get(v) ?? null,
        ...(lr ? { via: lr.via, alwaysRisk: lr.via.some((h) => h.always) } : {})
      };
    });
}

const reason = (code, message, extra = {}) => ({ code, message, ...extra });

/**
 * The channel the cluster must be on for a hop (RFC §6.4).
 * per-minor (guided default): the hop's destination minor in the planning
 * prefix (stable/fast); eus/CPO: the EUS target channel throughout;
 * single: the planning channel throughout.
 */
export function hopChannel(graph, hop, channelStrategy) {
  const prefix = channelPrefix(graph.channel);
  if (prefix === "eus" || channelStrategy === "single") return graph.channel;
  return `${prefix}-${minorOf(hop.to)}`;
}

/**
 * Solve a route.
 *
 * @param {object} p
 * @param {object} p.graph - normalizeGraph() output for the planning channel
 * @param {string} p.source - current cluster version
 * @param {string} p.target - requested version
 * @param {string[]} p.supportedMinors
 * @param {"standard"|"cpo"} [p.strategy]
 * @param {boolean} [p.includeConditional] - allow conditional updates (explicit review only)
 * @param {"per-minor"|"single"} [p.channelStrategy]
 * @param {Record<string, object>} [p.stepGraphs] - normalized graphs by channel, to validate each hop in its channel
 * @param {number} [p.maxAlternatives]
 */
export function solvePath({ graph, source, target, supportedMinors, strategy = "standard", includeConditional = false, channelStrategy = "per-minor", stepGraphs = {}, maxAlternatives = 10 }) {
  const reasons = [];
  const result = (extra) => ({ solver: SOLVER_VERSION, source, target, channel: graph?.channel || null, arch: graph?.arch || null, strategy, channelStrategy, ...extra });
  const src = gaVersion(source);
  const dst = gaVersion(target);
  if (!src) return result({ ok: false, reasons: [reason("SOURCE_INVALID", "The current version must be a released x.y.z version.")] });
  if (!dst) return result({ ok: false, reasons: [reason("TARGET_INVALID", "The target version must be a released x.y.z version.")] });
  if (!supportedMinors.includes(minorOf(src))) {
    return result({ ok: false, reasons: [reason("SOURCE_UNSUPPORTED", `OpenShift ${minorOf(src)} is outside the supported range (${supportedMinors.join(", ")}). Architect plans updates that start from a supported release; follow Red Hat's guidance to reach ${supportedMinors[0]} first.`, { supportedVersions: supportedMinors })] });
  }
  if (!supportedMinors.includes(minorOf(dst))) {
    return result({ ok: false, reasons: [reason("TARGET_UNSUPPORTED", `OpenShift ${minorOf(dst)} is not supported by this version of Architect (supported: ${supportedMinors.join(", ")}).`, { supportedVersions: supportedMinors })] });
  }
  if (compareVersions(src, dst) === 0) return result({ ok: false, reasons: [reason("SAME_VERSION", "The cluster is already at the target version; there is nothing to update.")] });
  if (compareVersions(src, dst) > 0) return result({ ok: false, reasons: [reason("DOWNGRADE", "OpenShift does not support downgrades. Choose a target newer than the current version.")] });
  if (!graph || !Array.isArray(graph.versions)) return result({ ok: false, reasons: [reason("GRAPH_MISSING", "No update graph is loaded.")] });
  if (!graph.versions.length) return result({ ok: false, reasons: [reason("GRAPH_EMPTY", "The update graph for this channel and architecture is empty.")] });
  if (!graph.nodes[src]) return result({ ok: false, reasons: [reason("SOURCE_NOT_IN_GRAPH", `${src} is not in the ${graph.channel} graph for ${graph.arch}. Check the channel and architecture, or choose the channel the cluster is on.`)] });
  if (!graph.nodes[dst]) return result({ ok: false, reasons: [reason("TARGET_NOT_IN_GRAPH", `${dst} is not in the ${graph.channel} graph for ${graph.arch}.`)] });

  if (strategy === "cpo") {
    if (channelPrefix(graph.channel) !== "eus" || minorOf(src) !== "4.20" || minorOf(dst) !== "4.22" || channelMinor(graph.channel) !== "4.22") {
      return result({ ok: false, reasons: [reason("CPO_NOT_ELIGIBLE", "A Control Plane Only update is planned from 4.20 to 4.22 in the eus-4.22 channel only. Use a standard update for this route.")] });
    }
  }
  if (channelMinor(graph.channel) && compareVersions(`${channelMinor(graph.channel)}.0`, `${minorOf(dst)}.0`) < 0) {
    return result({ ok: false, reasons: [reason("TARGET_NOT_IN_CHANNEL", `${graph.channel} cannot reach ${minorOf(dst)} releases; plan with the ${channelPrefix(graph.channel)}-${minorOf(dst)} channel.`)] });
  }

  const attempt = (withConditional) => {
    const { forward, reverse } = permittedEdges(graph, supportedMinors, withConditional);
    const fromSrc = bfsDistances(src, (u) => (forward.get(u) || []).map((e) => e.to));
    if (!fromSrc.has(dst)) return null;
    const toDst = bfsDistances(dst, (u) => reverse.get(u) || []);
    const total = fromSrc.get(dst);
    const onShortest = (u, w) => fromSrc.get(u) + 1 === fromSrc.get(w) && fromSrc.get(w) + (toDst.get(w) ?? Infinity) === total;
    const nextOptions = (u) => (forward.get(u) || [])
      .filter((e) => fromSrc.has(e.to) && onShortest(u, e.to))
      .sort((x, y) => compareVersions(y.to, x.to) || Number(x.conditional) - Number(y.conditional));
    // Enumerate shortest routes in convention order (highest version first at each step).
    let routes = [];
    let count = 0;
    const keep = withConditional ? 5000 : maxAlternatives + 1;
    const walk = (u, acc) => {
      if (u === dst) {
        count += 1;
        if (routes.length < keep) routes.push(acc.slice());
        return;
      }
      if (count > 5000) return;
      for (const e of nextOptions(u)) { acc.push(e); walk(e.to, acc); acc.pop(); }
    };
    walk(src, []);
    if (withConditional) {
      // Among equally short routes, prefer fewer updates whose risk applies to EVERY cluster
      // ("Always"), then fewer conditional updates; the convention order breaks ties (stable sort).
      const facts = conditionalEdgeRisks(graph);
      const score = (r) => {
        let always = 0;
        let cond = 0;
        let prev = src;
        for (const e of r) { if (e.conditional) { cond += 1; if (facts.get(`${prev}>${e.to}`)?.always) always += 1; } prev = e.to; }
        return [always, cond];
      };
      routes = routes.map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => a.s[0] - b.s[0] || a.s[1] - b.s[1] || a.i - b.i).map((x) => x.r).slice(0, maxAlternatives + 1);
    }
    return { routes, count, total };
  };

  let found = attempt(false);
  let conditionalRoute = false;
  if (!found) {
    reasons.push(reason("NO_RECOMMENDED_PATH", `The ${graph.channel} graph has no recommended update route from ${src} to ${dst}.`));
    if (!includeConditional) {
      const anyRoute = attempt(true);
      return result({ ok: false, reasons, conditionalAvailable: Boolean(anyRoute) });
    }
    found = attempt(true);
    conditionalRoute = Boolean(found);
    if (!found) {
      reasons.push(reason("NO_PATH", `No update route exists from ${src} to ${dst} in ${graph.channel}, even with conditional updates.`));
      return result({ ok: false, reasons, conditionalAvailable: false });
    }
  }

  const toHops = (route) => buildHops({ graph, versions: [src, ...route.map((e) => e.to)], strategy, channelStrategy, stepGraphs });
  const [chosen, ...others] = found.routes;
  const hops = toHops(chosen);
  for (const hop of hops) {
    if (hop.channelCheck === "missing") reasons.push(reason("EDGE_NOT_IN_STEP_CHANNEL", `The update ${hop.from} → ${hop.to} is not in the ${hop.channel} graph the cluster would be on for that step.`, { from: hop.from, to: hop.to, channel: hop.channel }));
  }
  const blocking = reasons.some((r) => r.code === "EDGE_NOT_IN_STEP_CHANNEL");
  return result({
    ok: !blocking,
    conditional: conditionalRoute,
    reasons,
    path: [src, ...hops.map((h) => h.to)],
    hops,
    selectedBy: "default-convention",
    alternatives: others.map((r) => [src, ...r.map((e) => e.to)]),
    alternativesTotal: Math.max(0, found.count - 1),
    hopCount: found.total
  });
}

/**
 * Hop records for a route given as versions (each hop must be a real edge of
 * `graph`; validateRoute() checks that first). Records the channel the
 * cluster must be on for the hop and whether that channel's own graph has the
 * edge ("recommended" / "conditional" / "missing" / "not-checked").
 */
export function buildHops({ graph, versions, strategy = "standard", channelStrategy = "per-minor", stepGraphs = {} }) {
  const hops = [];
  for (let i = 1; i < versions.length; i += 1) {
    const from = versions[i - 1];
    const to = versions[i];
    const cond = graph.conditional.find((c) => c.from === from && c.to === to);
    const recommended = graph.edges.some(([a, b]) => a === from && b === to);
    const hop = {
      from,
      to,
      kind: minorOf(from) === minorOf(to) ? "z-stream" : "minor",
      conditional: !recommended && Boolean(cond),
      risks: !recommended && cond ? cond.risks : [],
      payload: graph.nodes[to]?.payload || null,
      errataUrl: graph.nodes[to]?.errataUrl || null
    };
    hop.channel = hopChannel(graph, hop, channelStrategy);
    if (strategy === "cpo" && minorOf(to) === "4.21") hop.controlPlaneOnly = true;
    const stepGraph = stepGraphs[hop.channel] || (hop.channel === graph.channel ? graph : null);
    if (!stepGraph) hop.channelCheck = "not-checked";
    else if (stepGraph.edges.some(([a, b]) => a === from && b === to)) hop.channelCheck = "recommended";
    else if (stepGraph.conditional.some((c) => c.from === from && c.to === to)) hop.channelCheck = "conditional";
    else hop.channelCheck = "missing";
    hops.push(hop);
  }
  return hops;
}

/**
 * Re-validate a chosen route (for example a user-selected alternative): every
 * hop must be a real edge of the planning graph (recommended unless the plan
 * is an acknowledged conditional plan).
 */
export function validateRoute({ graph, route, supportedMinors, allowConditional = false }) {
  if (!Array.isArray(route) || route.length < 2) return { ok: false, reason: "ROUTE_INVALID" };
  for (let i = 1; i < route.length; i += 1) {
    const from = route[i - 1];
    const to = route[i];
    const step = minorStep(supportedMinors, from, to);
    if (step < 0 || step > 1) return { ok: false, reason: "ROUTE_MINOR_SKIP", from, to };
    const rec = graph.edges.some(([a, b]) => a === from && b === to);
    const cond = graph.conditional.some((c) => c.from === from && c.to === to);
    if (!rec && !(allowConditional && cond)) return { ok: false, reason: cond ? "ROUTE_CONDITIONAL" : "ROUTE_EDGE_MISSING", from, to };
  }
  return { ok: true };
}

/**
 * Exploration only (v2.3.0, owner decision D-1): a route between any two releases from 4.1 up to
 * the newest supported minor, using ONLY real edges, each taken from the graph of the channel the
 * cluster is on for that hop (stable-<destination minor>). The per-step graphs are merged so that
 * an edge into minor N comes from stable-4.N alone, then the planning solver runs unchanged over
 * the merged graph (recommended edges, at most one minor per hop, highest-release convention).
 * Nothing is synthesized. The caller labels the result as exploration and generates nothing from it.
 *
 * @param {object} p
 * @param {Record<string, object>} p.graphs - normalized stable-4.N graphs by channel
 * @param {string} p.source
 * @param {string} p.target
 * @param {string[]} p.minors - every minor that may appear (4.1 … newest supported)
 * @param {string[]} p.planningMinors - the planning range (SUPPORTED_MINORS)
 * @param {string} p.arch
 */
export function exploreRoute({ graphs, source, target, minors, planningMinors, arch }) {
  const src = gaVersion(source);
  const dst = gaVersion(target);
  const fail = (code, message, nextStep = null) => ({ ok: false, exploration: true, reasons: [reason(code, message)], nextStep });
  if (!src) return fail("SOURCE_INVALID", "Enter the release the cluster runs as x.y.z, for example 4.12.30.");
  if (!dst) return fail("TARGET_INVALID", "Enter the release to explore up to as x.y.z, for example 4.18.10.");
  if (!minors.includes(minorOf(src))) return fail("SOURCE_OUT_OF_RANGE", `Exploration covers OpenShift 4.1 to ${minors[minors.length - 1]}.`);
  if (!minors.includes(minorOf(dst))) return fail("TARGET_UNSUPPORTED", `OpenShift ${minorOf(dst)} is not supported by this version of Architect (supported: ${planningMinors.join(", ")}).`);
  if (compareVersions(src, dst) >= 0) return fail("TARGET_NOT_NEWER", "Choose a release newer than the one the cluster runs.");
  const merged = { channel: `stable-${minorOf(dst)}`, arch, nodes: {}, edges: [], conditional: [] };
  for (const [channel, g] of Object.entries(graphs)) {
    if (!g) continue;
    const intoMinor = channelMinor(channel);
    for (const [v, n] of Object.entries(g.nodes)) {
      const prev = merged.nodes[v];
      merged.nodes[v] = prev ? { ...prev, channels: [...new Set([...(prev.channels || []), ...(n.channels || [])])] } : n;
    }
    for (const [a, b] of g.edges) if (minorOf(b) === intoMinor) merged.edges.push([a, b]);
    for (const c of g.conditional) if (minorOf(c.to) === intoMinor) merged.conditional.push(c);
  }
  merged.versions = Object.keys(merged.nodes).sort(compareVersions);
  const srcChannels = [`stable-${minorOf(src)}`];
  if (!merged.nodes[src]) {
    return fail("SOURCE_NOT_IN_GRAPHS", `${src} is not in Red Hat's update graph today (${srcChannels.join(", ")} for ${arch}). Updates from it are no longer listed.`,
      `Update within ${minorOf(src)} to a release that is still listed (see the OpenShift ${minorOf(src)} documentation), or contact Red Hat support.`);
  }
  if (!merged.nodes[dst]) return fail("TARGET_NOT_IN_GRAPHS", `${dst} is not in the stable-${minorOf(dst)} graph for ${arch}. Choose a release that channel lists.`);
  const solved = solvePath({ graph: merged, source: src, target: dst, supportedMinors: minors, stepGraphs: graphs, channelStrategy: "per-minor", maxAlternatives: 3 });
  const reasons = (solved.reasons || []).map((r) => (r.code === "NO_RECOMMENDED_PATH"
    ? { ...r, message: `Red Hat's update graph today has no recommended route from ${src} to ${dst}${solved.conditionalAvailable ? " (a route exists only through conditional updates, which have known risks)" : ""}.` }
    : r));
  if (!solved.ok) {
    return { ok: false, exploration: true, reasons, conditionalAvailable: Boolean(solved.conditionalAvailable),
      nextStep: solved.conditionalAvailable ? `Review the conditional updates and their risks in the OpenShift ${minorOf(dst)} documentation before choosing such a route.` : `Check that each minor between ${minorOf(src)} and ${minorOf(dst)} has a listed update, or choose a nearer target.` };
  }
  const firstSupported = solved.path.find((v) => planningMinors.includes(minorOf(v))) || null;
  return { ...solved, exploration: true, reasons, firstSupported, nodeInfo: Object.fromEntries(solved.path.map((v) => [v, { channels: merged.nodes[v]?.channels || [] }])) };
}
