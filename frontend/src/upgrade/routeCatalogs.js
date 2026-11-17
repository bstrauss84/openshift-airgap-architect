/**
 * OpenShift Airgap Architect - Upgrade › Content: catalog evidence for every stage (v2.3.0 owner QA).
 *
 * Pure helpers (no I/O) so they are unit-testable:
 *  - buildScanPlan: one entry per DISTINCT catalog minor on the route (several stages of the same
 *    minor share one scan), with the stages and operators that need it and what is already cached.
 *    A scan reads the Red Hat, Certified and Community index images for that minor
 *    (registry.redhat.io/redhat/<kind>-operator-index:v<minor>; multi-architecture images).
 *  - cellEvidence: what is actually known about one stage's selection of one operator, keeping the
 *    selected channel, this catalog's default and the verdict apart; evidence from the Live catalog
 *    check (package + channel + range + listing), else the scanned catalog (which records each
 *    package's DEFAULT channel only), else nothing. Names and version patterns are never evidence.
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

/** The default channel of `name` in a minor's scanned catalog, or null. */
export const scannedDefault = (status, op) => {
  if (!scannedAt(status) && !status?.[op?.catalog || "redhat"]?.updatedAt) return null;
  const hit = (status?.[op?.catalog || "redhat"]?.results || []).find((e) => String(e.name || "").toLowerCase() === String(op?.name || "").toLowerCase());
  return hit?.defaultChannel || null;
};

/**
 * Evidence for one stage's selection of one operator (owner QA round 3b). Keeps apart:
 *  - `selected`: the channel this stage will mirror (Mirroring's `defaultChannel` field), and
 *    whether it was copied from another stage;
 *  - `catalogDefault` / `defaultFrom`: this stage's catalog default, from the Live catalog check's
 *    listing or, failing that, the scan ("live check" | "scan");
 *  - the verdict (state/mark/label/detail): verified, exists but not the default, not confirmed,
 *    missing, pending, not scanned.
 * `ctx.sourceDefault` is the default channel in the catalog of the stage this one was copied from:
 * a copied channel equal to it was that stage's default, not a choice for this stage, so a
 * different default here is suggested and pre-ticked (`suggest.pretick`).
 * @returns {{ state, mark, label, detail, selected, catalogDefault, defaultFrom, suggest? }}
 */
export function cellEvidence(op, minor, status, scan, details = null, ctx = {}) {
  const ch = op.defaultChannel || null;
  const live = liveCheck(op);
  const listing = details?.listing || null;
  const listed = listing ? listing.channels.map((c) => c.name) : null;
  const scanDef = scannedDefault(status, op);
  const catalogDefault = listing?.defaultChannel || scanDef || null;
  const defaultFrom = listing?.defaultChannel ? "live check" : scanDef ? "scan" : null;
  const copiedDefault = Boolean(ctx.sourceDefault && ch && ch === ctx.sourceDefault);
  const base = { selected: ch, catalogDefault, defaultFrom };
  const notDefault = (how) => ({
    ...base, state: "WARNING", mark: "≠", label: "not this catalog's default",
    detail: `${how} ${ch} is ${op.name}'s selected channel for this stage, but the ${minor} catalog's default is ${catalogDefault}.${copiedDefault ? ` ${ch} was copied from an earlier stage, where it is the default; it would be mirrored from the ${minor} catalog as shown.` : ""}`,
    suggest: { channel: catalogDefault, pretick: copiedDefault, why: copiedDefault ? `copied from an earlier stage, where ${ch} is the default; the ${minor} catalog's default is ${catalogDefault}` : `the ${minor} catalog's default is ${catalogDefault}` }
  });
  if (live?.status === "verified") {
    if (catalogDefault && ch && catalogDefault !== ch) return notDefault(`Live catalog check: the channel exists in the ${minor} catalog.`);
    return { ...base, state: "VERIFIED", mark: "✓", label: ch && catalogDefault === ch ? "verified · default" : "verified", detail: `Live catalog check: ${op.name}${ch ? ` channel ${ch}` : ""} is in the ${minor} catalog.${listed ? ` Channels listed: ${listed.join(", ")}${catalogDefault ? ` (default ${catalogDefault})` : ""}.` : ""}` };
  }
  if (live?.status === "channel-not-found") return { ...base, state: "BLOCKED", mark: "✕", label: "channel missing", detail: `Live catalog check: the ${minor} catalog has ${op.name}, but not channel ${ch}.${listed ? ` Channels listed: ${listed.join(", ")}.` : ""} Choose another channel for this stage.`, ...(catalogDefault ? { suggest: { channel: catalogDefault, pretick: true, why: `${ch} is not in the ${minor} catalog; ${catalogDefault} is its default there` } } : {}) };
  if (live?.status === "package-not-found") return { ...base, state: "BLOCKED", mark: "✕", label: "not in catalog", detail: `Live catalog check: ${op.name} is not in the ${minor} catalog.` };
  if (live?.status === "range-empty") return { ...base, state: "WARNING", mark: "⚠", label: "no version in range", detail: `Live catalog check: no ${op.name} version in the chosen range in the ${minor} catalog.` };
  // A cached listing without a current live verdict (for example the channel changed since the check).
  if (listing && ch) {
    if (!listed.includes(ch)) return { ...base, state: "BLOCKED", mark: "✕", label: "channel missing", detail: `The ${minor} catalog does not list ${op.name} channel ${ch} (channels: ${listed.join(", ")}).`, ...(catalogDefault ? { suggest: { channel: catalogDefault, pretick: true, why: `${ch} is not in the ${minor} catalog; ${catalogDefault} is its default there` } } : {}) };
    if (catalogDefault && ch !== catalogDefault) return notDefault(`The ${minor} catalog lists the channel (last Live catalog check).`);
    return { ...base, state: "VERIFIED", mark: "✓", label: "listed · default", detail: `The ${minor} catalog lists ${op.name} channel ${ch} as its default (channels: ${listed.join(", ")}), from its last Live catalog check.` };
  }
  if (scan?.state === "running" || scan?.state === "queued") return { ...base, state: "PENDING", mark: "…", label: "scanning", detail: `The ${minor} catalogs are being scanned.` };
  const at = scannedAt(status);
  if (!at && !scanDef) {
    if (scan?.state === "failed" || scan?.state === "timeout") return { ...base, state: "WARNING", mark: "!", label: "scan failed", detail: `The last scan of the ${minor} catalogs did not finish (${scan.message || scan.state}). ${ch ? `Channel ${ch} is the selection, not confirmed for this stage.` : ""}`.trim() };
    return { ...base, state: "NOT_CHECKED", mark: "○", label: "not scanned", detail: `The ${minor} catalogs have not been scanned. ${ch ? `Channel ${ch} is the selection, not confirmed for this stage.` : "No channel chosen yet."}`.trim() };
  }
  if (!scanDef) {
    const kindScanned = Boolean(status?.[op.catalog || "redhat"]?.updatedAt);
    if (kindScanned) return { ...base, state: "BLOCKED", mark: "✕", label: "not in catalog", detail: `${op.name} is not in the scanned ${catalogKindLabel(op.catalog || "redhat")} catalog for ${minor}.` };
    return { ...base, state: "NOT_CHECKED", mark: "○", label: "not scanned", detail: `The ${catalogKindLabel(op.catalog || "redhat")} catalog for ${minor} has not been scanned.` };
  }
  if (!ch) return { ...base, state: "NOT_CHECKED", mark: "?", label: "no channel", detail: `${op.name} is in the ${minor} catalog (default channel ${scanDef}); no channel is chosen for this stage yet.`, suggest: { channel: scanDef, pretick: true, why: `no channel chosen; the ${minor} catalog's default is ${scanDef}` } };
  if (ch === scanDef) return { ...base, state: "VERIFIED", mark: "✓", label: "catalog default", detail: `Scanned ${minor} catalog: ${ch} is ${op.name}'s default channel.` };
  return {
    ...base, state: "NOT_CHECKED", mark: "?", label: "not confirmed here",
    detail: `${op.name}'s selected channel ${ch} is not the ${minor} catalog's default (${scanDef}). A scan records only default channels, so whether ${ch} exists in the ${minor} catalog is not known: run “Check channels in every stage”.${copiedDefault ? ` ${ch} was copied from an earlier stage, where it is the default.` : ""}`,
    suggest: { channel: scanDef, pretick: copiedDefault, why: copiedDefault ? `copied from an earlier stage, where ${ch} is the default; the ${minor} catalog's default is ${scanDef}` : `the ${minor} catalog's default is ${scanDef}; ${ch} is not confirmed there` }
  };
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
