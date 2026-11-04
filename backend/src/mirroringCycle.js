/**
 * OpenShift Airgap Architect - incremental transfer cycles (v2.2.0)
 *
 * oc-mirror's mirror to disk writes a delta archive: only blobs not listed in
 * the workspace's newest history file (working-dir/.history/.history-<RFC3339>),
 * or with --since D the newest history strictly before D 00:00 UTC; after a
 * successful run it writes a new history = baseline + this archive's blobs
 * (oc-mirror history.go at the shipped commit; verified on 4.22.19). On the
 * disconnected side, a skipped delta silently loses content and an older
 * transfer applied after a newer one rolls the catalogs back while exiting 0.
 *
 * This module records where each successful mirror to disk sits in that chain
 * (cycle) and decides, per destination registry, whether a received transfer can
 * be applied: first full, next delta, repeat, missing predecessor, rollback,
 * rebaseline, or unknown (legacy transfers without a cycle record).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const HISTORY_PREFIX = ".history-";

/** History files of a mirror-to-disk workspace (<dest>/working-dir/.history), oldest first. */
export function readHistory(destDir) {
  const dir = path.join(destDir, "working-dir", ".history");
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.startsWith(HISTORY_PREFIX)); } catch { return []; }
  return names.map((name) => {
    const full = path.join(dir, name);
    let sha256 = null;
    let bytes = null;
    try {
      const st = fs.lstatSync(full);
      if (!st.isFile()) return null;
      bytes = st.size;
      sha256 = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    } catch { return null; }
    const time = Date.parse(name.slice(HISTORY_PREFIX.length));
    return { name, time: Number.isFinite(time) ? time : null, sha256, bytes };
  }).filter(Boolean).sort((a, b) => (a.time ?? 0) - (b.time ?? 0) || a.name.localeCompare(b.name));
}

/** The history oc-mirror uses as the delta baseline (null = full archive). */
export function baselineFor(histories, since = null) {
  const usable = histories.filter((h) => h.time != null);
  if (!since) return usable.at(-1) || null;
  const cut = Date.parse(`${since}T00:00:00Z`);
  if (!Number.isFinite(cut)) return null;
  return usable.filter((h) => h.time < cut).at(-1) || null;
}

/**
 * The cycle record for a successful mirror to disk.
 * @param {{ before: object[], after: object[], since: string|null, planId: string, createdAt: string,
 *   priorRuns: { planId: string, produced?: { sha256: string }|null, startedAt?: number, finishedAt?: number }[] }} p
 */
export function cycleRecord({ before, after, since, planId, createdAt, priorRuns = [] }) {
  const baseline = baselineFor(before, since);
  const known = new Set(before.map((h) => h.name));
  const produced = after.filter((h) => !known.has(h.name)).at(-1) || null;
  // The run that wrote the baseline history: by its recorded history hash, or —
  // for runs from before cycles were recorded — by when the file was written.
  let previousPlanId = null;
  if (baseline) {
    const bySha = priorRuns.find((r) => r.produced?.sha256 && r.produced.sha256 === baseline.sha256);
    const byTime = baseline.time != null ? priorRuns.find((r) => r.startedAt && r.finishedAt && baseline.time >= r.startedAt - 1000 && baseline.time <= r.finishedAt + 60000) : null;
    previousPlanId = (bySha || byTime)?.planId || null;
  }
  return {
    schema: "oaa.mirroring.cycle/v1",
    planId,
    createdAt,
    kind: baseline ? "delta" : "full",
    since: since || null,
    baseline: baseline ? { name: baseline.name, sha256: baseline.sha256 } : null,
    produced: produced ? { name: produced.name, sha256: produced.sha256 } : null,
    previousPlanId
  };
}

/** Destination registry as a comparison key (scheme dropped, host lower-cased, no trailing slash). */
export function destinationKey(registryUrl) {
  const k = String(registryUrl || "").trim().replace(/^docker:\/\//i, "").replace(/\/+$/, "");
  const i = k.indexOf("/");
  return i < 0 ? k.toLowerCase() : `${k.slice(0, i).toLowerCase()}${k.slice(i)}`;
}

/**
 * Whether a received transfer may be loaded into a destination that already
 * received the cycles in `applied` (oldest first, as loaded there).
 * @param {{ planId: string, planCreatedAt: number|null, cycle: object|null }} t
 * @param {{ planId: string, planCreatedAt: number|null, produced?: { sha256: string }|null }[]} applied
 * @returns {{ status: "first"|"next"|"repeat"|"rebaseline"|"unknown"|"gap"|"rollback", allowed: boolean, message: string }}
 */
export function cycleDecision(t, applied) {
  const older = (a) => a.planCreatedAt != null && t.planCreatedAt != null && a.planCreatedAt > t.planCreatedAt;
  const latest = applied.at(-1) || null;
  if (latest && latest.planId === t.planId) {
    return { status: "repeat", allowed: true, message: `Plan ${t.planId} is the transfer last loaded into this registry; loading it again changes nothing and finishes anything that did not arrive.` };
  }
  if (applied.some((a) => a.planId === t.planId) || applied.some(older)) {
    const newer = applied.filter((a) => a.planId !== t.planId && (older(a) || applied.indexOf(a) > applied.findIndex((x) => x.planId === t.planId))).map((a) => a.planId);
    return { status: "rollback", allowed: false, message: `A newer transfer (${[...new Set(newer)].join(", ") || latest?.planId}) was already loaded into this registry. Loading plan ${t.planId} now would roll its operator catalogs back to older content while oc-mirror reports success, so it is refused. Load the newest transfer, or have the connected side prepare a full transfer.` };
  }
  if (!t.cycle) {
    return { status: "unknown", allowed: true, message: `This transfer was prepared before Architect recorded transfer order, so whether earlier transfers are missing cannot be checked. Load transfers in the order they were made.` };
  }
  if (!applied.length) {
    return t.cycle.kind === "full"
      ? { status: "first", allowed: true, message: "The first transfer for this registry, and a full one (it contains everything)." }
      : { status: "gap", allowed: false, message: `This transfer holds only what changed since an earlier transfer${t.cycle.previousPlanId ? ` (${t.cycle.previousPlanId})` : ""}, which was never loaded into this registry. Load that one first, or have the connected side prepare a full transfer.` };
  }
  if (t.cycle.kind === "full") {
    return { status: "rebaseline", allowed: true, message: "A full transfer, newer than everything loaded into this registry: it contains everything, so missing earlier transfers do not matter." };
  }
  const chained = applied.some((a) => (a.produced?.sha256 && t.cycle.baseline?.sha256 && a.produced.sha256 === t.cycle.baseline.sha256) || (t.cycle.previousPlanId && a.planId === t.cycle.previousPlanId));
  return chained
    ? { status: "next", allowed: true, message: `The next transfer after ${t.cycle.previousPlanId || "the one already loaded"}.` }
    : { status: "gap", allowed: false, message: `This transfer holds only what changed since ${t.cycle.previousPlanId ? `plan ${t.cycle.previousPlanId}` : "an earlier transfer"}, which was not loaded into this registry. Loading it would silently leave that transfer's content out, so it is refused. Load the missing transfer first, or have the connected side prepare a full transfer.` };
}
