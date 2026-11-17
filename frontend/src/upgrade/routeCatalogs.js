/**
 * OpenShift Airgap Architect - Upgrade › Content: catalog evidence for every stage (v2.3.0 owner QA).
 *
 * Pure helpers (no I/O) so they are unit-testable:
 *  - buildScanPlan: one entry per DISTINCT catalog minor on the route (several stages of the same
 *    minor share one scan), with the stages and operators that need it and what is already cached.
 *    A scan reads the Red Hat, Certified and Community index images for that minor
 *    (registry.redhat.io/redhat/<kind>-operator-index:v<minor>; multi-architecture images).
 *  - cellEvidence: what is actually known about one stage's selection of one operator, from the
 *    strongest evidence available — the Live catalog check (package + channel + range), else the
 *    scanned catalog (which records each package's DEFAULT channel only), else nothing. Names and
 *    version patterns are never used as evidence.
 *  - provenanceOf: why an operator is in a stage (manual, Quick Pick, copied, imported, plan list).
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { catalogImagesForMinor } from "../shared/operatorMinorReconciliation.js";

export const CATALOG_KINDS = ["redhat", "certified", "community"];
const KIND_LABEL = { redhat: "Red Hat", certified: "Certified", community: "Community" };
export const catalogKindLabel = (k) => KIND_LABEL[k] || k;

/** A minor counts as scanned only when every catalog of that minor has cached results. */
export const scannedAt = (status) => {
  if (!status) return null;
  const times = CATALOG_KINDS.map((k) => status[k]?.updatedAt).filter(Boolean).map((t) => (typeof t === "number" ? t : Date.parse(t))).filter(Number.isFinite);
  return times.length === CATALOG_KINDS.length ? Math.min(...times) : null;
};
export const partlyScanned = (status) => Boolean(status && CATALOG_KINDS.some((k) => status[k]?.updatedAt));

/**
 * @param {Array} views - plan.stageViews
 * @param {Record<string, object>} profiles - stage profiles by id
 * @param {Record<string, object>} statusByMinor - GET /api/operators/status?version=<minor> results
 */
export function buildScanPlan(views, profiles, statusByMinor = {}, loaded = null) {
  const byMinor = new Map();
  for (const v of views || []) {
    if (!v?.minor) continue;
    const p = v.linkedProfileId ? profiles[v.linkedProfileId] : null;
    if (!byMinor.has(v.minor)) {
      byMinor.set(v.minor, { minor: v.minor, stages: [], profileId: p?.id || v.linkedProfileId || null, operators: new Set(), catalogs: catalogImagesForMinor(v.minor) });
    }
    const entry = byMinor.get(v.minor);
    entry.stages.push({ id: v.id, release: v.release });
    if (!entry.profileId && p?.id) entry.profileId = p.id;
    if (p?.content?.operators) for (const op of p.operators.selected || []) entry.operators.add(op.name);
  }
  return [...byMinor.values()].map((e) => {
    const status = statusByMinor[e.minor];
    const at = scannedAt(status);
    // Until this minor's cache status has loaded, it is neither "scanned" nor "to scan" (owner QA P1:
    // treating unknown as unscanned started automatic rescans of cached catalogs on every mount).
    const checking = Boolean(loaded) && !loaded.has(e.minor);
    return {
      ...e,
      operators: [...e.operators].sort(),
      scannedAt: at,
      cached: Boolean(at),
      checking,
      partial: !at && partlyScanned(status),
      missingCatalogs: at ? [] : CATALOG_KINDS.filter((k) => !status?.[k]?.updatedAt),
      reason: e.operators.size
        ? `${e.stages.map((s) => `stage ${s.id.slice(1)} (${s.release})`).join(", ")}: ${e.operators.size} operator${e.operators.size === 1 ? "" : "s"} to check`
        : `${e.stages.map((s) => `stage ${s.id.slice(1)} (${s.release})`).join(", ")}: no operators yet — scan to browse and choose them`
    };
  });
}

/** Client copy of the server's operatorVerificationState staleness rule (mirroringState.js). */
const liveCheck = (op) => {
  const v = op?.verification;
  if (!v) return null;
  const stale = v.catalogImage !== (op.catalogImage || "") || v.channel !== (op.defaultChannel || "") || v.minVersion !== (op.minVersion || "") || v.maxVersion !== (op.maxVersion || "");
  return stale ? null : v;
};

/**
 * Evidence for one stage's selection of one operator.
 * @returns {{ state: string, mark: string, label: string, detail: string }}
 *   state is a readiness-style token for styling: VERIFIED | BLOCKED | WARNING | NOT_CHECKED | PENDING
 */
export function cellEvidence(op, minor, status, scan, details = null) {
  const ch = op.defaultChannel || null;
  const live = liveCheck(op);
  // The package listing the Live catalog check cached for THIS catalog image: every channel and the default.
  const listing = details?.listing || null;
  const listed = listing ? listing.channels.map((c) => c.name) : null;
  const def = listing?.defaultChannel || null;
  if (live?.status === "verified") return { state: "VERIFIED", mark: "✓", label: ch && def === ch ? "verified · default" : "verified", detail: `Live catalog check: ${op.name}${ch ? ` channel ${ch}` : ""} is in the ${minor} catalog.${listed ? ` Channels listed: ${listed.join(", ")}${def ? ` (default ${def})` : ""}.` : ""}` };
  if (live?.status === "channel-not-found") return { state: "BLOCKED", mark: "✕", label: "channel missing", detail: `Live catalog check: the ${minor} catalog has ${op.name}, but not channel ${ch}.${listed ? ` Channels listed: ${listed.join(", ")}.` : ""} Choose another channel for this stage.`, ...(def ? { suggest: { channel: def, proven: true, why: `${ch} is not listed in the ${minor} catalog; ${def} is its default channel there` } } : {}) };
  if (live?.status === "package-not-found") return { state: "BLOCKED", mark: "✕", label: "not in catalog", detail: `Live catalog check: ${op.name} is not in the ${minor} catalog.` };
  if (live?.status === "range-empty") return { state: "WARNING", mark: "⚠", label: "no version in range", detail: `Live catalog check: no ${op.name} version in the chosen range in the ${minor} catalog.` };
  // A cached listing without a current live verdict (e.g. the channel changed since the check).
  if (listing && ch) {
    if (listed.includes(ch)) return { state: "VERIFIED", mark: "✓", label: ch === def ? "listed · default" : "listed", detail: `The ${minor} catalog lists ${op.name} channel ${ch} (channels: ${listed.join(", ")}; default ${def || "unknown"}), from its last Live catalog check.` };
    return { state: "BLOCKED", mark: "✕", label: "channel missing", detail: `The ${minor} catalog does not list ${op.name} channel ${ch} (channels: ${listed.join(", ")}).`, ...(def ? { suggest: { channel: def, proven: true, why: `${ch} is not listed in the ${minor} catalog; ${def} is its default channel there` } } : {}) };
  }
  if (scan?.state === "running") return { state: "PENDING", mark: "…", label: "scanning", detail: `The ${minor} catalogs are being scanned.` };
  const at = scannedAt(status);
  if (!at) {
    if (scan?.state === "failed" || scan?.state === "timeout") return { state: "WARNING", mark: "!", label: "scan failed", detail: `The last scan of the ${minor} catalogs did not finish (${scan.message || scan.state}). ${ch ? `Channel ${ch} is your selection, not verified.` : ""}`.trim() };
    return { state: "NOT_CHECKED", mark: "○", label: "not scanned", detail: `The ${minor} catalogs have not been scanned. ${ch ? `Channel ${ch} is the selection, not verified for this stage.` : "No channel chosen yet."}`.trim() };
  }
  const hit = (status[op.catalog || "redhat"]?.results || []).find((e) => String(e.name || "").toLowerCase() === String(op.name || "").toLowerCase());
  if (!hit) return { state: "BLOCKED", mark: "✕", label: "not in catalog", detail: `${op.name} is not in the scanned ${catalogKindLabel(op.catalog || "redhat")} catalog for ${minor}.` };
  if (!ch) return { state: "NOT_CHECKED", mark: "?", label: "no channel", detail: `${op.name} is in the ${minor} catalog (default channel ${hit.defaultChannel || "unknown"}); no channel is chosen for this stage yet.` };
  if (ch === hit.defaultChannel) return { state: "VERIFIED", mark: "✓", label: "default channel", detail: `Scanned ${minor} catalog: ${ch} is ${op.name}'s default channel.` };
  return { state: "NOT_CHECKED", mark: "?", label: "channel not checked", detail: `${op.name} is in the ${minor} catalog, whose default channel is ${hit.defaultChannel || "unknown"}. Whether ${ch} exists there is not known from a scan: use “Check channels in every stage”.`, ...(hit.defaultChannel ? { suggest: { channel: hit.defaultChannel, proven: false, why: `the ${minor} catalog's default channel is ${hit.defaultChannel}; whether ${ch} exists there is not yet checked` } } : {}) };
}

/** Why this operator is in a stage, from its recorded sources (never a guess about installation). */
export function provenanceOf(sources = []) {
  const out = new Set();
  for (const s of sources.length ? sources : ["manual"]) {
    if (s === "manual") out.add("added by you");
    else if (s.startsWith("import:")) out.add("from an imported configuration");
    else if (s.startsWith("upgrade:copied-from-s")) out.add(`copied from stage ${s.slice("upgrade:copied-from-s".length)}`);
    else if (s.startsWith("upgrade:")) out.add("from the plan's operator list");
    else out.add("Quick Pick");
  }
  return [...out];
}
