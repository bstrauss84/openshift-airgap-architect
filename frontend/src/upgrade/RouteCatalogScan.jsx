/**
 * OpenShift Airgap Architect - Upgrade › Content › "Catalogs for this route" (v2.3.0 owner QA).
 *
 * Coordinated operator catalog scanning across the route, on the EXISTING scan mechanism
 * (POST /api/operators/scan per catalog minor → one job per catalog: Red Hat, Certified,
 * Community; results cached per minor and reused by every stage and by Mirroring):
 *  - the plan is deduplicated by catalog minor and shown before anything starts;
 *  - nothing is downloaded without an explicit action; "scan new stage catalogs automatically"
 *    is an opt-in for this plan in this browser session only (memory, never persisted);
 *  - cached minors are skipped unless rescanned; one minor runs at a time (bounded), each job has
 *    a timeout, Stop cancels the running jobs and skips the rest, and one minor's failure does not
 *    stop the others;
 *  - the Red Hat pull secret is the plan's in-memory credential (D-2), sent per request only.
 * Catalog availability is not compatibility with a running cluster; that stays a readiness item.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import OptionRow from "../components/OptionRow.jsx";
import Switch from "../components/Switch.jsx";
import SourceCredentialField from "../mirroring/SourceCredentialField.jsx";
import { useSourceCredential } from "../mirroring/sourceCredentialSession.js";
import { fetchJob, stopJob } from "../mirroring/mirroringApi.js";
import { startCatalogScan } from "./upgradeApi.js";
import { catalogKindLabel, CATALOG_KINDS } from "./routeCatalogs.js";

export const scanTiming = { pollMs: 2000, jobTimeoutMs: 45 * 60 * 1000 };
/** planId → true: the user allowed automatic scans of new stage catalogs (memory only). */
const autoScanAllowed = new Map();
export const _resetAutoScanForTests = () => autoScanAllowed.clear();

const ago = (when) => {
  const ms = Date.now() - (typeof when === "number" ? when : Date.parse(when));
  if (!Number.isFinite(ms)) return "";
  const h = Math.floor(ms / 3600000);
  return h >= 48 ? `${Math.floor(h / 24)} days ago` : h >= 1 ? `${h} h ago` : `${Math.max(1, Math.floor(ms / 60000))} min ago`;
};
const TERMINAL = new Set(["completed", "completed_with_warnings", "failed", "cancelled", "error"]);

export default function RouteCatalogScan({ plan, scanPlan, credentialKey, scans, setScans, onScanned }) {
  const cred = useSourceCredential(credentialKey, "scan");
  const [error, setError] = useState("");
  const [auto, setAuto] = useState(() => autoScanAllowed.get(plan.id) === true);
  const runRef = useRef({ stop: false, jobs: [] });
  const running = Object.values(scans).some((s) => s.state === "running" || s.state === "queued");
  const toScan = scanPlan.filter((e) => !e.cached);

  const setScan = useCallback((minor, patch) => setScans((all) => ({ ...all, [minor]: { ...(all[minor] || {}), ...patch } })), [setScans]);

  const scanOne = useCallback(async (entry) => {
    setScan(entry.minor, { state: "running", message: "Starting…", progress: 0, catalogs: {} });
    let jobs;
    try {
      const body = { catalogMinor: entry.minor, ...(entry.profileId ? { profileId: entry.profileId } : {}), ...(cred.mounted ? { rhAuthSource: "mounted" } : { rhAuthSource: "inline", pullSecret: cred.secret }) };
      jobs = (await startCatalogScan(body)).jobs || {};
    } catch (err) {
      setScan(entry.minor, { state: "failed", message: String(err.message || err) });
      return;
    }
    runRef.current.jobs = Object.values(jobs);
    const started = Date.now();
    const done = {};
    while (true) {
      if (runRef.current.stop) {
        await Promise.all(Object.values(jobs).filter((id) => !done[id]).map((id) => stopJob(id).catch(() => {})));
        setScan(entry.minor, { state: "cancelled", message: "Stopped." });
        return;
      }
      if (Date.now() - started > scanTiming.jobTimeoutMs) {
        await Promise.all(Object.values(jobs).filter((id) => !done[id]).map((id) => stopJob(id).catch(() => {})));
        setScan(entry.minor, { state: "timeout", message: `No result within ${Math.round(scanTiming.jobTimeoutMs / 60000)} minutes.` });
        return;
      }
      const catalogs = {};
      for (const [kind, id] of Object.entries(jobs)) {
        try {
          const j = done[id] || await fetchJob(id);
          if (TERMINAL.has(j.status)) done[id] = j;
          catalogs[kind] = { status: j.status, progress: j.progress ?? null, message: j.message || "" };
        } catch (err) {
          done[id] = { status: "failed", message: String(err.message || err) };
          catalogs[kind] = { status: "failed", progress: null, message: String(err.message || err) };
        }
      }
      const vals = Object.values(catalogs);
      const progress = vals.length ? Math.round(vals.reduce((n, c) => n + (TERMINAL.has(c.status) ? 100 : Number(c.progress) || 0), 0) / vals.length) : 0;
      if (vals.length && vals.every((c) => TERMINAL.has(c.status))) {
        const failed = vals.filter((c) => !c.status.startsWith("completed"));
        setScan(entry.minor, failed.length
          ? { state: "failed", catalogs, progress: 100, message: `${failed.length} catalog(s) did not finish: ${Object.entries(catalogs).filter(([, c]) => !c.status.startsWith("completed")).map(([k, c]) => `${catalogKindLabel(k)} (${c.message || c.status})`).join("; ")}` }
          : { state: "completed", catalogs, progress: 100, message: "Scanned." });
        await onScanned(entry.minor);
        return;
      }
      setScan(entry.minor, { state: "running", catalogs, progress, message: `Scanning… ${progress}%` });
      await new Promise((r) => setTimeout(r, scanTiming.pollMs));
    }
  }, [cred.mounted, cred.secret, onScanned, setScan]);

  const run = useCallback(async (entries) => {
    if (!entries.length) return;
    setError("");
    if (!cred.usable) { setError("Enter the Red Hat pull secret for this plan first."); return; }
    runRef.current = { stop: false, jobs: [] };
    for (const e of entries) setScan(e.minor, { state: "queued", message: "Waiting", progress: 0, catalogs: {} });
    for (const e of entries) {
      if (runRef.current.stop) { setScan(e.minor, { state: "cancelled", message: "Not started (stopped)." }); continue; }
      await scanOne(e); // one minor at a time; a failure is recorded and the next minor still runs
    }
  }, [cred.usable, scanOne, setScan]);

  // Opt-in only: scan catalogs of new stages automatically for this plan in this session.
  const autoKey = toScan.map((e) => e.minor).join(",");
  useEffect(() => {
    if (!auto || running || !cred.usable || !toScan.length) return;
    const fresh = toScan.filter((e) => !scans[e.minor] || scans[e.minor].state === "cancelled");
    if (fresh.length) run(fresh);
  }, [auto, autoKey, cred.usable]); // eslint-disable-line react-hooks/exhaustive-deps

  const stateText = (e) => {
    const s = scans[e.minor];
    if (s?.state === "running") return `Scanning… ${s.progress ?? 0}%`;
    if (s?.state === "queued") return "Waiting to start";
    if (s?.state === "failed" || s?.state === "timeout") return `Failed: ${s.message}`;
    if (s?.state === "cancelled") return s.message;
    if (e.cached) return `Scanned ${ago(e.scannedAt)}`;
    if (e.partial) return "Partly scanned — scan again";
    return "Not scanned";
  };
  const stateToken = (e) => {
    const s = scans[e.minor]?.state;
    return s === "running" || s === "queued" ? "PENDING" : s === "failed" || s === "timeout" ? "WARNING" : e.cached ? "VERIFIED" : "NOT_CHECKED";
  };

  return (
    <section className="card upgrade-route-scan" aria-labelledby={`upgrade-route-scan-${plan.id}`}>
      <h3 id={`upgrade-route-scan-${plan.id}`}>Catalogs for this route</h3>
      <p className="subtle">
        Each OpenShift minor on the route has its own operator catalogs. Scanning reads the Red Hat, Certified and Community catalog
        images for that minor once; every stage of that minor uses the result. A scan shows which operators exist and their default
        channel. It does not show that an operator is compatible with your running cluster.
      </p>
      {error ? <Banner variant="error">{error}</Banner> : null}
      <ul className="upgrade-scan-plan">
        {scanPlan.map((e) => (
          <li key={e.minor} className="upgrade-scan-row" data-state={stateToken(e)}>
            <div className="upgrade-scan-row-main">
              <strong>OpenShift {e.minor}</strong>
              <span className="upgrade-badge" data-state={stateToken(e)}>{stateText(e)}</span>
              {!running ? <Button variant="secondary" className="mini" disabled={!cred.usable} onClick={() => run([e])}>{e.cached ? "Rescan" : "Scan"}</Button> : null}
            </div>
            <div className="subtle upgrade-scan-why">{e.reason}</div>
            <details className="upgrade-scan-details">
              <summary>Catalog images</summary>
              <ul>
                {CATALOG_KINDS.map((k) => (
                  <li key={k}><code>{e.catalogs[k]}</code>{scans[e.minor]?.catalogs?.[k] ? <span className="subtle"> — {scans[e.minor].catalogs[k].status}{scans[e.minor].catalogs[k].progress != null && !TERMINAL.has(scans[e.minor].catalogs[k].status) ? ` ${scans[e.minor].catalogs[k].progress}%` : ""}</span> : null}</li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
      {!cred.usable ? (
        <SourceCredentialField profileId={credentialKey} site="scan" idPrefix={`upgrade-route-scan-cred-${plan.id}`} label="Red Hat pull secret" />
      ) : null}
      <div className="actions">
        {!running ? (
          <Button variant="primary" disabled={!cred.usable || !toScan.length} onClick={() => run(toScan)}>
            {toScan.length ? `Scan ${toScan.length} catalog set${toScan.length === 1 ? "" : "s"} not yet scanned` : "Every catalog on the route is scanned"}
          </Button>
        ) : (
          <Button variant="destructive" onClick={() => { runRef.current.stop = true; }}>Stop scanning</Button>
        )}
      </div>
      <OptionRow title="Scan new stage catalogs automatically" description="For this plan, in this browser session only: when the route gains a stage whose catalogs are not scanned, scan them without asking again. Scans download several hundred megabytes per minor.">
        <Switch checked={auto} disabled={!cred.usable} onChange={(on) => { setAuto(on); if (on) autoScanAllowed.set(plan.id, true); else autoScanAllowed.delete(plan.id); }} aria-label="Scan new stage catalogs automatically" />
      </OptionRow>
    </section>
  );
}
