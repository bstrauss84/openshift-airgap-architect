/**
 * OpenShift Update Service graph client (v2.3.0 Upgrade workflow, RFC §6.1).
 *
 * - Fetches from exactly ONE host, fixed in code:
 *   https://api.openshift.com/api/upgrades_info/v1/graph. No request can
 *   change the host, path, scheme or port. A user-provided URL is never
 *   fetched: data from a customer's own OpenShift Update Service enters only
 *   as an imported file the user captured themselves (no SSRF surface).
 * - Channel and architecture are allowlisted before any request: channels
 *   stable/fast/eus of a SUPPORTED minor only; graph API architecture names.
 * - No redirects, a timeout, a streamed body cap, strict schema validation.
 *   An empty graph (what the API returns for an unknown channel or
 *   architecture, with HTTP 200) is an error, not "no updates".
 * - The cache is written only after validation (no partial or poisoned
 *   entry), with the exact source URL, fetch time and body SHA-256. A
 *   checksum is integrity evidence for that copy only: the graph API is not
 *   signed, so nothing here claims Red Hat authenticity.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import crypto from "node:crypto";
import { z } from "zod";
import { getCache, setCache } from "./utils.js";
import { SUPPORTED_MINORS } from "./versionPolicy.js";
import { normalizeGraph, PLANNING_CHANNEL_RE, GRAPH_ARCHES } from "../../shared/upgradePath.js";
import { getMinorVersion, compareVersions, isVersionGTE } from "../../shared/versionUtils.js";

export const GRAPH_ENDPOINT = "https://api.openshift.com/api/upgrades_info/v1/graph";
export const GRAPH_TIMEOUT_MS = 15000;
export const GRAPH_MAX_BYTES = 4 * 1024 * 1024;
export const GRAPH_MAX_NODES = 2000;
export const GRAPH_MAX_EDGES = 50000;
/** Age after which a fetched graph is presented "as of" its time rather than as current. */
export const GRAPH_STALE_MS = 24 * 60 * 60 * 1000;
export const GRAPH_SOURCES = Object.freeze(["public", "imported"]);

export class UpdateGraphError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const channelMinor = (channel) => channel.split("-")[1];

/** Allowlist check; throws UpdateGraphError(400/422). */
export const assertGraphRequest = (channel, arch) => {
  if (typeof channel !== "string" || !PLANNING_CHANNEL_RE.test(channel)) {
    throw new UpdateGraphError("GRAPH_CHANNEL_INVALID", "Choose a stable, fast or eus channel (for example stable-4.22).", 400);
  }
  if (!SUPPORTED_MINORS.includes(channelMinor(channel))) {
    throw new UpdateGraphError("UNSUPPORTED_VERSION", `OpenShift ${channelMinor(channel)} is not supported by this version of Architect (supported: ${SUPPORTED_MINORS.join(", ")}).`, 422);
  }
  if (!GRAPH_ARCHES.includes(arch)) {
    throw new UpdateGraphError("GRAPH_ARCH_INVALID", `Architecture must be one of ${GRAPH_ARCHES.join(", ")}.`, 400);
  }
};

const nodeSchema = z.object({
  version: z.string().max(64),
  payload: z.string().max(512).optional(),
  metadata: z.record(z.string().max(256), z.string().max(4096)).optional()
}).passthrough();
const riskSchema = z.object({
  url: z.string().max(2048).optional(),
  name: z.string().max(256),
  message: z.string().max(8192).optional(),
  matchingRules: z.array(z.object({ type: z.string().max(64) }).passthrough()).max(64).optional()
}).passthrough();
const bodySchema = z.object({
  nodes: z.array(nodeSchema).max(GRAPH_MAX_NODES),
  edges: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])).max(GRAPH_MAX_EDGES),
  conditionalEdges: z.array(z.object({
    edges: z.array(z.object({ from: z.string().max(64), to: z.string().max(64) })).max(GRAPH_MAX_EDGES),
    risks: z.array(riskSchema).max(256)
  }).passthrough()).max(5000).optional()
}).passthrough();

/** Validate a raw graph body (fetched or imported). Returns the parsed body. */
export const validateGraphBody = (text) => {
  let raw;
  try {
    raw = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    throw new UpdateGraphError("GRAPH_INVALID", "The update graph is not valid JSON.", 422);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) throw new UpdateGraphError("GRAPH_INVALID", "The update graph does not have the OpenShift Update Service graph format (nodes, edges, conditionalEdges).", 422);
  const n = parsed.data.nodes.length;
  if (parsed.data.edges.some(([a, b]) => a >= n || b >= n)) throw new UpdateGraphError("GRAPH_INVALID", "The update graph has an edge that points outside its node list.", 422);
  if (n === 0) throw new UpdateGraphError("GRAPH_EMPTY", "The update graph is empty. The channel or architecture may not exist, or no release of it has been published.", 404);
  return parsed.data;
};

const cacheKey = (source, channel, arch) => `upgrade_graph_v1:${source}:${channel}:${arch}`;

const readCapped = async (res) => {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > GRAPH_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new UpdateGraphError("GRAPH_TOO_LARGE", `The update graph response exceeded ${GRAPH_MAX_BYTES} bytes and was discarded.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
};

/** Build an entry (what is cached and returned) from a validated body. */
export const buildEntry = ({ body, text, channel, arch, source, sourceUrl, fetchedAt, origin, minors = SUPPORTED_MINORS }) => {
  const normalized = normalizeGraph(body, { channel, arch, supportedMinors: minors });
  if (!normalized.versions.length) {
    throw new UpdateGraphError("GRAPH_EMPTY", minors === SUPPORTED_MINORS
      ? `The ${channel} graph for ${arch} has no release in the supported minors (${SUPPORTED_MINORS.join(", ")}).`
      : `The ${channel} graph for ${arch} is empty.`, 404);
  }
  return {
    source,
    origin,
    channel,
    arch,
    sourceUrl,
    fetchedAt,
    bodySha256: crypto.createHash("sha256").update(text).digest("hex"),
    // The exact bytes, kept so a plan package can carry a re-verifiable snapshot.
    rawText: text,
    normalized
  };
};

/** GET one channel graph from the single allowlisted host; validated before anything is kept. */
const fetchGraphText = async (channel, arch, fetchImpl) => {
  const url = new URL(GRAPH_ENDPOINT);
  url.searchParams.set("channel", channel);
  url.searchParams.set("arch", arch);
  let res;
  try {
    res = await fetchImpl(url.toString(), { headers: { Accept: "application/json", "User-Agent": "airgap-architect" }, redirect: "error", signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new UpdateGraphError(timedOut ? "GRAPH_TIMEOUT" : "GRAPH_UNREACHABLE", timedOut
      ? `The update graph service did not answer within ${GRAPH_TIMEOUT_MS / 1000} seconds.`
      : "The update graph service (api.openshift.com) could not be reached. On a disconnected system, import a graph snapshot instead.");
  }
  if (res.status >= 300 && res.status < 400) throw new UpdateGraphError("GRAPH_REDIRECT_REFUSED", "The update graph service answered with a redirect, which Architect does not follow.");
  if (!res.ok) throw new UpdateGraphError("GRAPH_HTTP_ERROR", `The update graph service answered HTTP ${res.status}.`);
  const text = await readCapped(res);
  return { url, text, body: validateGraphBody(text) };
};

/** Fetch from the public graph API and cache (only after validation). */
export const refreshPublicGraph = async (channel, arch, { fetchImpl = fetch, now = () => Date.now() } = {}) => {
  assertGraphRequest(channel, arch);
  const { url, text, body } = await fetchGraphText(channel, arch, fetchImpl);
  const entry = buildEntry({ body, text, channel, arch, source: "public", origin: "public-api", sourceUrl: url.toString(), fetchedAt: new Date(now()).toISOString() });
  setCache(cacheKey("public", channel, arch), entry);
  return entry;
};

/**
 * Exploration only (v2.3.0, owner decision D-1): stable-4.1 … stable-<newest supported> from the
 * SAME allowlisted host, with the same limits and validation, cached under a separate "explore"
 * source that planning, stages, instructions and packages never read (readCachedGraph refuses it).
 * Older minors are therefore never usable for anything but showing a route.
 */
export const EXPLORE_CHANNEL_RE = /^stable-4\.(\d{1,2})$/;
const newestSupported = () => SUPPORTED_MINORS[SUPPORTED_MINORS.length - 1];
/** 4.1 … newest supported minor (shared version comparison; 4.0 was never a public GA release). */
export const exploreMinors = () => {
  const out = [];
  for (let i = 1; i < 100 && isVersionGTE(newestSupported(), `4.${i}`); i += 1) out.push(`4.${i}`);
  return out;
};
export const assertExploreRequest = (channel, arch) => {
  const minor = typeof channel === "string" && EXPLORE_CHANNEL_RE.test(channel) ? getMinorVersion(channel.slice("stable-".length)) : null;
  if (!minor || compareVersions(minor, "4.1") < 0) throw new UpdateGraphError("GRAPH_CHANNEL_INVALID", "Exploration reads stable-4.N channels from 4.1 on.", 400);
  if (!isVersionGTE(newestSupported(), minor)) throw new UpdateGraphError("UNSUPPORTED_VERSION", `OpenShift ${minor} is not supported by this version of Architect (supported: ${SUPPORTED_MINORS.join(", ")}).`, 422);
  if (!GRAPH_ARCHES.includes(arch)) throw new UpdateGraphError("GRAPH_ARCH_INVALID", `Architecture must be one of ${GRAPH_ARCHES.join(", ")}.`, 400);
};
export const readExplorationGraph = (channel, arch) => getCache(cacheKey("explore", channel, arch))?.value || null;
let exploreFetchOverride = null;
/** Tests only: serve exploration graphs without the network. */
export const _setExploreFetchForTests = (fn) => { exploreFetchOverride = fn; };
export const explorationGraph = async (channel, arch, { fetchImpl = exploreFetchOverride || fetch, now = () => Date.now(), maxAgeMs = GRAPH_STALE_MS } = {}) => {
  assertExploreRequest(channel, arch);
  const hit = readExplorationGraph(channel, arch);
  if (hit && now() - Date.parse(hit.fetchedAt) < maxAgeMs) return hit;
  const { url, text, body } = await fetchGraphText(channel, arch, fetchImpl);
  const entry = buildEntry({ body, text, channel, arch, source: "explore", origin: "public-api", sourceUrl: url.toString(), fetchedAt: new Date(now()).toISOString(), minors: exploreMinors() });
  setCache(cacheKey("explore", channel, arch), entry);
  return entry;
};

/**
 * Import a graph the user captured (snapshot from a plan package, or the JSON
 * their own OpenShift Update Service returned). Validated exactly like a
 * fetched graph; labelled with its origin; never described as authenticated.
 */
export const importGraph = ({ channel, arch, text, origin, capturedAt, sourceUrl, now = () => Date.now() }) => {
  assertGraphRequest(channel, arch);
  if (!["customer-osus", "snapshot"].includes(origin)) throw new UpdateGraphError("GRAPH_ORIGIN_INVALID", "Unknown graph origin.", 400);
  if (typeof text !== "string" || Buffer.byteLength(text) > GRAPH_MAX_BYTES) throw new UpdateGraphError("GRAPH_TOO_LARGE", `The imported graph must be at most ${GRAPH_MAX_BYTES} bytes.`, 413);
  const body = validateGraphBody(text);
  const capturedMs = capturedAt ? Date.parse(capturedAt) : NaN;
  const entry = buildEntry({
    body, text, channel, arch,
    source: "imported",
    origin,
    // Recorded as given by the user; not fetched or verified by Architect.
    sourceUrl: typeof sourceUrl === "string" && /^https:\/\/[^\s"'<>]{1,2000}$/.test(sourceUrl) ? sourceUrl : null,
    fetchedAt: Number.isFinite(capturedMs) ? new Date(capturedMs).toISOString() : new Date(now()).toISOString()
  });
  entry.importedAt = new Date(now()).toISOString();
  entry.capturedAtKnown = Number.isFinite(capturedMs);
  setCache(cacheKey("imported", channel, arch), entry);
  return entry;
};

/** Cached entry (public or imported) or null. */
export const readCachedGraph = (source, channel, arch) => {
  if (!GRAPH_SOURCES.includes(source)) return null;
  const hit = getCache(cacheKey(source, channel, arch));
  return hit?.value || null;
};

/** Freshness and provenance, as shown next to every path. */
export const describeGraphEntry = (entry, now = Date.now()) => {
  if (!entry) return null;
  const ageMs = Math.max(0, now - Date.parse(entry.fetchedAt));
  return {
    source: entry.source,
    origin: entry.origin,
    channel: entry.channel,
    arch: entry.arch,
    sourceUrl: entry.sourceUrl,
    fetchedAt: entry.fetchedAt,
    importedAt: entry.importedAt || null,
    capturedAtKnown: entry.capturedAtKnown !== false,
    bodySha256: entry.bodySha256,
    ageMs,
    stale: entry.source !== "public" || ageMs > GRAPH_STALE_MS,
    integrity: "checksum of this copy only; the graph is not signed, so its authenticity is not verified",
    counts: {
      versions: entry.normalized.versions.length,
      edges: entry.normalized.edges.length,
      conditional: entry.normalized.conditional.length,
      excludedUnsupported: entry.normalized.excludedUnsupported
    }
  };
};
