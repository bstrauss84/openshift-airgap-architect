/**
 * OpenShift Airgap Architect - operator catalogs for ONE Mirroring profile
 * (v2.2.0 M3)
 *
 * Uses the existing discovery engine end to end — POST /api/operators/scan
 * (with the explicit `catalogMinor` added in M1, and the profile id and
 * explicit source credential choice — inline or the server's mounted Red Hat
 * pull secret — so each catalog job is listed in Mirroring Operations), GET /api/jobs/:id,
 * POST /api/jobs/:id/stop and GET /api/operators/status — rather than a second
 * scanner. What this hook adds is the scan LIFECYCLE CONTRACT the owner asked
 * for, so that a scan can never write results into the wrong place:
 *
 *  1. A scan is captured at start as { profileId, minor, jobs } and kept in a
 *     per-profile, in-memory session registry. Navigating away (Home, another
 *     profile) unmounts the hook but does not cancel the server jobs; coming
 *     back resumes watching the same scan. Nothing is persisted and no
 *     credential is stored in the registry.
 *  2. Results are fetched for the SCAN's minor, never the current one, and are
 *     applied only if that minor is still the profile's catalog minor when
 *     they arrive. A superseded scan's results are discarded with a visible
 *     notice — they cannot overwrite current selections.
 *  3. Stop asks the server to stop each job. A 404 means the job already
 *     finished; either way the scan is marked superseded first, so a late
 *     completion is ignored. Stop is therefore safe even when cancellation
 *     arrives after completion.
 *  4. Loading cached catalogs for the current minor is a cheap read and is the
 *     only automatic action. Changing the minor, locking or unlocking never
 *     starts a scan by itself.
 *  5. Scans are independent of the single oc-mirror RUN slot (M1), which
 *     governs mirroring execution only.
 *  6. Browser reload (M4): the session { profileId, minor, jobs, startedAt }
 *     is also kept in sessionStorage (no credential is ever part of it). A
 *     reloaded page re-reads it, asks GET /api/jobs/:id for each job and
 *     reattaches: progress and Stop come back, and the same rule applies —
 *     results only for the minor the profile still has. A job the server no
 *     longer knows (restart) or a session for another minor is reported and
 *     dropped, never applied. No second job engine: the same endpoints.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../api.js";
import { isJobGone } from "../shared/jobPolling.js";
import { OPERATOR_CATALOG_IDS, OPERATOR_CATALOG_LABELS } from "../shared/operatorSearch.js";

/** Poll interval; an object so tests can shorten it without fake timers. */
export const scanTiming = { pollMs: 4000 };
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

/** profileId -> { minor, jobs: {catalogId: jobId}, startedAt, superseded } — memory only. */
const scanSessions = new Map();

/** "profileId:minor" while the scan request itself is in flight (double-click guard). */
const startingScans = new Set();

const STORAGE_PREFIX = "oaa.mirroring.scan.";

/** Persist (or clear) a session for reload recovery. Never holds a credential. */
const storeSession = (profileId, session) => {
  try {
    if (!session || session.superseded) sessionStorage.removeItem(STORAGE_PREFIX + profileId);
    else sessionStorage.setItem(STORAGE_PREFIX + profileId, JSON.stringify({ profileId, minor: session.minor, jobs: session.jobs, startedAt: session.startedAt }));
  } catch { /* storage unavailable: in-memory only */ }
};

/** A session saved before a reload, if it is well formed. */
const restoreSession = (profileId) => {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + profileId);
    if (!raw) return null;
    const s = JSON.parse(raw);
    const jobs = s && typeof s.jobs === "object" ? Object.fromEntries(Object.entries(s.jobs).filter(([k, v]) => OPERATOR_CATALOG_IDS.includes(k) && typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v))) : {};
    if (s.profileId !== profileId || typeof s.minor !== "string" || !Object.keys(jobs).length) return null;
    return { profileId, minor: s.minor, jobs, startedAt: Number(s.startedAt) || Date.now(), superseded: false, reattached: true };
  } catch {
    return null;
  }
};

/** Test seam: what a full page reload does — module memory is gone, sessionStorage stays. */
export const _simulatePageReloadForTests = () => { scanSessions.clear(); startingScans.clear(); };

/** Test seam: forget every in-memory scan session. */
export const _resetScanSessionsForTests = () => {
  scanSessions.clear();
  startingScans.clear();
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(STORAGE_PREFIX)) sessionStorage.removeItem(k);
  } catch { /* none */ }
};

export const normalizeCatalogResults = (data) => ({
  redhat: Array.isArray(data?.redhat) ? data.redhat : data?.redhat?.results || [],
  certified: Array.isArray(data?.certified) ? data.certified : data?.certified?.results || [],
  community: Array.isArray(data?.community) ? data.community : data?.community?.results || []
});

const hasAny = (catalogs) => OPERATOR_CATALOG_IDS.some((id) => catalogs[id].length > 0);

/** Why one scan job did not complete, as the server reported it (never empty for a failed job). */
export const scanFailureReason = (job) => {
  if (!job) return "";
  if (job.status === "cancelled") return "The scan was stopped.";
  let meta = null;
  try { meta = job.metadata_json ? JSON.parse(job.metadata_json) : null; } catch { /* message below */ }
  return meta?.failure?.reason || job.message || "The server reported no reason.";
};

/** One sentence for the scan banner; a reason shared by every failed catalog is said once. */
export const describeScanFailure = (failedIds, statuses, total) => {
  const reasons = [...new Set(failedIds.map((id) => scanFailureReason(statuses[id])))];
  const shared = reasons.length === 1 ? ` ${reasons[0]}` : " The reason for each catalog is shown below.";
  if (failedIds.length === total) return `No catalog could be scanned.${shared}`;
  return `The scan did not complete for: ${failedIds.map((id) => OPERATOR_CATALOG_LABELS[id] || id).join(", ")}. Results shown are from the catalogs that did.${shared}`;
};

/**
 * @param {object} args
 * @param {string} args.profileId
 * @param {string|null} args.catalogMinor  the profile's current catalog minor
 * @param {(catalogs: object, minor: string) => void} args.onCatalogsLoaded
 *   called only with catalogs for the CURRENT minor
 */
export function useProfileCatalogs({ profileId, catalogMinor, onCatalogsLoaded }) {
  const [catalogs, setCatalogs] = useState(null);
  const [catalogsMinor, setCatalogsMinor] = useState(null);
  const [cachedAt, setCachedAt] = useState(null);
  const [loadingCached, setLoadingCached] = useState(false);
  const [scan, setScan] = useState(() => {
    const live = scanSessions.get(profileId);
    if (live) return live;
    const restored = restoreSession(profileId);
    if (restored) scanSessions.set(profileId, restored);
    return restored;
  });
  const [statuses, setStatuses] = useState({});
  const [scanError, setScanError] = useState("");
  const [notice, setNotice] = useState("");
  const [authAvailable, setAuthAvailable] = useState(false);
  const minorRef = useRef(catalogMinor);
  minorRef.current = catalogMinor;
  const loadedRef = useRef(onCatalogsLoaded);
  loadedRef.current = onCatalogsLoaded;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Mirroring's mounted source credential is the server's mounted Red Hat pull
  // secret — the same one runs and live checks use — and only when chosen.
  useEffect(() => {
    apiFetch("/api/secrets/rh-pull-secret")
      .then((d) => { if (mountedRef.current) setAuthAvailable(Boolean(d?.available)); })
      .catch(() => {});
  }, []);

  /** Apply results for `minor` only if it is still the profile's catalog minor. */
  const applyIfCurrent = useCallback((data, minor) => {
    if (!mountedRef.current || minor !== minorRef.current) return false;
    const next = normalizeCatalogResults(data);
    setCatalogs(next);
    setCatalogsMinor(minor);
    setCachedAt(Object.values(data || {}).find((item) => item?.updatedAt)?.updatedAt || null);
    if (hasAny(next)) loadedRef.current?.(next, minor);
    return true;
  }, []);

  // Cheap cached read for the current minor (no scan).
  useEffect(() => {
    setCatalogs(null);
    setCatalogsMinor(null);
    setCachedAt(null);
    if (!catalogMinor) return undefined;
    let cancelled = false;
    setLoadingCached(true);
    apiFetch(`/api/operators/status?version=${encodeURIComponent(catalogMinor)}`)
      .then((data) => { if (!cancelled) applyIfCurrent(data, catalogMinor); })
      .catch(() => { if (!cancelled && mountedRef.current) setScanError("Could not read cached operator catalogs."); })
      .finally(() => { if (!cancelled && mountedRef.current) setLoadingCached(false); });
    return () => {
      cancelled = true;
      if (mountedRef.current) setLoadingCached(false);
    };
  }, [catalogMinor, applyIfCurrent]);

  // Watch the profile's scan, if one is in flight.
  useEffect(() => {
    if (!scan || scan.superseded) return undefined;
    let cancelled = false;
    let timer = null;
    const ids = Object.entries(scan.jobs || {});
    const poll = async () => {
      if (cancelled) return;
      const next = {};
      for (const [catalogId, jobId] of ids) {
        try {
          next[catalogId] = await apiFetch(`/api/jobs/${jobId}`);
        } catch (err) {
          next[catalogId] = isJobGone(err)
            ? { id: jobId, status: "failed", message: "Scan job no longer exists.", gone: true }
            : { id: jobId, status: "unknown" };
        }
      }
      if (cancelled) return;
      setStatuses(next);
      const session = scanSessions.get(profileId);
      if (session !== scan || session?.superseded) return; // stopped or replaced meanwhile
      const settled = ids.every(([catalogId]) => TERMINAL.has(next[catalogId]?.status));
      if (!settled) {
        timer = setTimeout(poll, scanTiming.pollMs);
        return;
      }
      scanSessions.delete(profileId);
      storeSession(profileId, null);
      if (scan.reattached && ids.every(([catalogId]) => next[catalogId]?.gone)) {
        // The server no longer knows these jobs (it restarted): nothing to apply.
        if (mountedRef.current) {
          setNotice(`The catalog scan for OpenShift ${scan.minor} that was running before the page reloaded is no longer known to the server (it may have restarted). Nothing from it was applied; scan again if you need fresh catalogs.`);
          setScan(null);
        }
        return;
      }
      try {
        const data = await apiFetch(`/api/operators/status?version=${encodeURIComponent(scan.minor)}`);
        if (cancelled) return;
        const applied = applyIfCurrent(data, scan.minor);
        if (!applied && mountedRef.current) {
          setNotice(`A catalog scan for OpenShift ${scan.minor} finished after the catalog minor changed to ${minorRef.current || "(none)"}. Its results were not applied to this profile.`);
        }
        const failed = ids.filter(([catalogId]) => next[catalogId]?.status !== "completed").map(([catalogId]) => catalogId);
        if (failed.length && mountedRef.current) setScanError(describeScanFailure(failed, next, ids.length));
      } catch {
        if (!cancelled && mountedRef.current) setScanError("The scan finished but its results could not be read.");
      } finally {
        if (!cancelled && mountedRef.current) setScan(null);
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [scan, profileId, applyIfCurrent]);

  /**
   * @param {string} [pullSecret] the pull secret for this scan (never stored)
   * @param {{ useMounted?: boolean }} [opts] use the server's mounted pull secret instead
   */
  const startScan = useCallback(async (pullSecret, { useMounted = false } = {}) => {
    if (!catalogMinor) return;
    const current = scanSessions.get(profileId);
    if (current && !current.superseded && current.minor === catalogMinor) return; // already scanning this minor
    const startKey = `${profileId}:${catalogMinor}`;
    if (startingScans.has(startKey)) return; // a request for this scan is already on its way
    startingScans.add(startKey);
    setScanError("");
    setNotice("");
    try {
      const body = useMounted
        ? { catalogMinor, profileId, rhAuthSource: "mounted" }
        : { catalogMinor, profileId, rhAuthSource: "inline", ...(pullSecret ? { pullSecret } : {}) };
      const data = await apiFetch("/api/operators/scan", { method: "POST", body: JSON.stringify(body) });
      const session = { profileId, minor: catalogMinor, jobs: data.jobs || {}, startedAt: Date.now(), superseded: false };
      scanSessions.set(profileId, session);
      storeSession(profileId, session);
      if (mountedRef.current) {
        setStatuses({});
        setScan(session);
      }
    } catch (e) {
      // A refused request names its field problems in `details`; "Validation failed" alone says nothing.
      const details = Array.isArray(e?.payload?.details) ? e.payload.details.map((d) => d?.message).filter(Boolean) : [];
      if (mountedRef.current) setScanError(details.length ? `The scan was not started: ${details.join(" ")}` : e?.message || "The operator scan could not be started.");
    } finally {
      startingScans.delete(startKey);
    }
  }, [catalogMinor, profileId]);

  /**
   * Stop the in-flight scan. Marks it superseded FIRST, so whatever the server
   * answers, its results can no longer be applied.
   */
  const stopScan = useCallback(async () => {
    const session = scanSessions.get(profileId);
    if (!session) return { stopped: 0, alreadyFinished: 0, failed: 0 };
    session.superseded = true;
    scanSessions.delete(profileId);
    storeSession(profileId, null);
    let stopped = 0;
    let alreadyFinished = 0;
    let failed = 0;
    for (const jobId of Object.values(session.jobs || {})) {
      try {
        await apiFetch(`/api/jobs/${jobId}/stop`, { method: "POST", body: "{}" });
        stopped += 1;
      } catch (err) {
        if (err?.status === 404) alreadyFinished += 1;
        else failed += 1;
      }
    }
    if (mountedRef.current) {
      setScan(null);
      setNotice(
        failed
          ? `The scan for OpenShift ${session.minor} could not be stopped cleanly (${failed} job(s) did not answer). It may finish in the background; its results will not be applied.`
          : `The scan for OpenShift ${session.minor} was stopped. Nothing from it will be applied.`
      );
    }
    return { stopped, alreadyFinished, failed };
  }, [profileId]);

  return {
    catalogs,
    catalogsMinor,
    cachedAt,
    loadingCached,
    scan,
    scanning: Boolean(scan && !scan.superseded),
    reattached: Boolean(scan && scan.reattached && !scan.superseded),
    statuses,
    scanError,
    notice,
    dismissNotice: () => setNotice(""),
    authAvailable,
    startScan,
    stopScan
  };
}
