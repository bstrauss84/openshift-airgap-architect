/**
 * OpenShift Airgap Architect - Mirroring operations (v2.2.0)
 *
 * Everything the Mirroring workflow ran, across profiles: oc-mirror runs (and
 * automatic signature retries), transfer preparations, receipts, live
 * catalog checks and operator catalog scans (one entry per catalog). A view over the existing job engine — the list comes from
 * GET /api/mirroring/operations, live status and output from GET /api/jobs/:id
 * (useJobWatch), Stop is POST /api/jobs/:id/stop. Nothing is invented: a value
 * the server did not record is shown as not recorded.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import { useJobWatch } from "./useJobWatch.js";
import Modal from "../components/Modal.jsx";
import SourceCredentialField from "./SourceCredentialField.jsx";
import DestinationCredentialsField from "./DestinationCredentialsField.jsx";
import { useSourceCredential } from "./sourceCredentialSession.js";
import { apiFetch } from "../api.js";
import { fetchOperations, fetchOperation, fetchOperationLog, stopJob, retryOperation, fetchPlan } from "./mirroringApi.js";
import { OPERATIONS_HINT, RETRY_VS_UPDATE_HINT, RECOVERY_CLASS_TEXT, VERIFICATION_STATE_TEXT, RUN_PULL_SECRET_HINT, MIRROR_SECRET_HINT } from "./mirroringCopy.js";

export const STATUS_TEXT = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  completed_with_warnings: "Completed with warnings",
  failed: "Failed",
  cancelled: "Stopped"
};
const ACTIVE = new Set(["queued", "running"]);
const STOPPABLE = new Set(["run", "catalog-check", "catalog-scan"]);

// eslint-disable-next-line no-control-regex
const plain = (text) => String(text || "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r(?!\n)/g, "\n");
const when = (ms) => (ms ? new Date(Number(ms)).toLocaleString() : "—");
export const elapsed = (from, to) => {
  if (!from) return "—";
  const s = Math.max(0, Math.round((Number(to || Date.now()) - Number(from)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : m ? `${m} min ${s % 60} s` : `${s} s`;
};

function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 60000);
}

/** Ticks once a second while `active`, so elapsed time stays live. */
function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export default function MirroringOperations({ profiles, selectedJobId, onSelect, onOpenProfile }) {
  const [ops, setOps] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [profileFilter, setProfileFilter] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await fetchOperations();
      setOps(data.operations || []);
      setError("");
      setStatus("ready");
    } catch (e) {
      setError(e.message || String(e));
      setStatus((s) => (s === "loading" ? "error" : s));
    }
  }, []);

  const anyActive = ops.some((o) => ACTIVE.has(o.status));
  useEffect(() => {
    load();
    const t = setInterval(load, anyActive ? 4000 : 15000);
    return () => clearInterval(t);
  }, [load, anyActive]);

  const shown = profileFilter ? ops.filter((o) => o.profileId === profileFilter) : ops;
  const selected = ops.find((o) => o.jobId === selectedJobId) || null;

  return (
    <div className="mirroring-layout mirroring-ops-layout">
      <section className="card" aria-labelledby="mirroring-ops-heading">
        <h3 id="mirroring-ops-heading">Operations</h3>
        <p className="subtle mirroring-card-subtitle">
          Every run, transfer, receipt, catalog scan and live catalog check of the Mirroring workflow on this server,
          newest first. Choose one to see its details, output and result.
        </p>
        <div className="card-body">
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Show" hint={OPERATIONS_HINT}>
              <select id="mirroring-ops-filter" className="control-enum" value={profileFilter} onChange={(e) => setProfileFilter(e.target.value)}>
                <option value="">All profiles</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FieldLabelWithInfo>
          </div>
          {error ? <Banner variant="error">{error}</Banner> : null}
          {status === "loading" ? <p className="note subtle" role="status">Loading operations…</p> : null}
          {status !== "loading" && !shown.length ? (
            <p className="note subtle">Nothing has run yet{profileFilter ? " for this profile" : ""}. Runs, transfers, receipts, catalog scans and live catalog checks appear here as soon as they start. Scans started before this version, or on another Architect server, are not listed.</p>
          ) : null}
          <ul className="mirroring-ops-list" aria-label="Operations">
            {shown.map((o) => (
              <li key={o.jobId}>
                <button
                  type="button"
                  className={`select-card mirroring-ops-item ${o.jobId === selectedJobId ? "selected" : ""}`}
                  aria-pressed={o.jobId === selectedJobId}
                  onClick={() => onSelect(o.jobId)}
                >
                  <span className="card-title">{o.title || o.kind}</span>
                  <span className={`mirroring-ops-status status-${o.status}`}>{STATUS_TEXT[o.status] || o.status}</span>
                  <span className="mirroring-profile-meta">{o.profileExists ? o.profileName : o.profileId ? "Deleted profile" : "No profile recorded"} · {when(o.startedAt || o.createdAt)}</span>
                  <span className="select-card-check" aria-hidden="true">✓ Shown</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <div className="mirroring-detail">
        {selected ? (
          <OperationDetails key={selected.jobId} summary={selected} onSelect={onSelect} onOpenProfile={onOpenProfile} onChanged={load} />
        ) : (
          <section className="card">
            <h3>Choose an operation</h3>
            <p className="subtle">
              {shown.length
                ? "Pick an entry from the list to see its details. A running oc-mirror, catalog scan or catalog check can be followed live and stopped here; its output stays available after you leave this page or reload it."
                : "When something has run, choose it from the list to see its details and output."}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

function OperationDetails({ summary, onSelect, onOpenProfile, onChanged }) {
  const jobId = summary.jobId;
  const [op, setOp] = useState(summary);
  const [actionError, setActionError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const logRef = useRef(null);
  const pinned = useRef(true);
  const sectionRef = useRef(null);
  // One column (narrow screens): the details sit below the list; bring them into view.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 900px)").matches) sectionRef.current?.scrollIntoView?.({ block: "start" });
  }, []);

  const watch = useJobWatch(jobId, { onSettled: () => { onChanged?.(); fetchOperation(jobId).then((d) => setOp(d.operation)).catch(() => {}); } });
  useEffect(() => { fetchOperation(jobId).then((d) => setOp(d.operation)).catch(() => {}); }, [jobId]);

  const job = watch.job;
  const statusNow = job?.status || op.status;
  const active = ACTIVE.has(statusNow);
  const now = useNow(active);
  const output = plain(job?.output);
  const meta = job?.metadata_json ? (() => { try { return JSON.parse(job.metadata_json); } catch { return {}; } })() : {};
  const finishedAt = meta.finishedAt || op.finishedAt;
  const exitCode = meta.exitCode ?? op.exitCode;

  // Follow the end of the output unless the reader scrolled up.
  useEffect(() => {
    const el = logRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [output]);

  const stop = async () => {
    setActionError("");
    try { await stopJob(jobId); onChanged?.(); } catch (e) { setActionError(e.message || String(e)); }
  };
  const download = async () => {
    setActionError("");
    setDownloading(true);
    try {
      const { text, filename } = await fetchOperationLog(jobId);
      downloadText(filename, text);
    } catch (e) {
      setActionError(e.message || String(e));
    } finally {
      setDownloading(false);
    }
  };

  // The configuration a run used, read from its stored plan and checked against its SHA-256.
  const [planView, setPlanView] = useState(null);
  const openPlan = async () => {
    setPlanView({ loading: true });
    try {
      const data = await fetchPlan(op.profileId, op.plan.planId, op.plan.planSha256);
      setPlanView({ plan: data.plan, yaml: data.imagesetConfig });
    } catch (e) {
      setPlanView({ error: e.message || String(e) });
    }
  };
  const failed = statusNow === "failed" || statusNow === "completed_with_warnings";
  const [retryOpen, setRetryOpen] = useState(false);
  const headingId = `mirroring-op-${jobId}-heading`;
  return (
    <section ref={sectionRef} className="card mirroring-op" aria-labelledby={headingId}>
      <h3 id={headingId}>{op.title || op.kind}</h3>
      <p role="status" className="mirroring-run-status">
        <strong>{watch.gone ? "No longer known to the server" : STATUS_TEXT[statusNow] || statusNow}</strong>
        {(job?.message || op.message) ? ` — ${job?.message || op.message}` : ""}
      </p>
      <div className="card-body">
        {actionError ? <Banner variant="error">{actionError}</Banner> : null}
        <div className="actions">
          {active && STOPPABLE.has(op.kind) ? <Button variant="destructive" onClick={stop}>Stop</Button> : null}
          <Button variant="secondary" onClick={download} disabled={downloading}>{downloading ? "Preparing log…" : "Download log"}</Button>
          {op.profileExists && op.profileId ? <Button variant="secondary" onClick={() => onOpenProfile(op.profileId)}>{`Open “${op.profileName}”`}</Button> : null}
          {op.kind === "run" && op.plan?.planId && op.plan.kind !== "received" && op.profileExists ? <Button variant="secondary" onClick={openPlan}>View configuration</Button> : null}
        </div>

        <dl className="modal-summary mirroring-op-summary">
          <dt>Profile</dt><dd>{op.profileExists ? op.profileName : op.profileId ? `${op.profileName || op.profileId} (deleted)` : "Not recorded"}</dd>
          {op.kind === "run" ? <><dt>Workflow</dt><dd>{op.title}</dd></> : null}
          {op.contentSummary ? <><dt>Content</dt><dd>{op.contentSummary}</dd></> : null}
          {op.source && op.kind !== "catalog-scan" ? <><dt>Source</dt><dd>{op.source}</dd></> : null}
          {op.destination ? <><dt>Destination</dt><dd><code>{op.destination}</code></dd></> : null}
          <dt>Started</dt><dd>{when(op.startedAt || op.createdAt)}</dd>
          <dt>{active ? "Running for" : "Took"}</dt><dd>{elapsed(op.startedAt || op.createdAt, active ? now : finishedAt || job?.updated_at || op.updatedAt)}</dd>
          {op.kind === "catalog-scan" ? <><dt>Catalog</dt><dd><code>{op.source || "not recorded"}</code></dd></> : null}
          {op.kind === "catalog-scan" && op.packages != null ? <><dt>Operators found</dt><dd>{op.packages}</dd></> : null}
          {op.kind === "catalog-scan" && op.catalogDigest ? <><dt>Catalog digest</dt><dd><code>{op.catalogDigest}</code> (verified over TLS)</dd></> : null}
          {op.kind === "run" ? <><dt>Exit code</dt><dd>{exitCode == null ? (active ? "Still running" : "Not recorded") : exitCode}</dd></> : null}
          {op.tool ? <><dt>oc-mirror</dt><dd>{op.tool.version || "version not reported"}{op.tool.gitCommit ? ` · commit ${op.tool.gitCommit.slice(0, 12)}` : ""}{op.tool.sha256 ? <> · SHA-256 <code>{op.tool.sha256}</code></> : null}</dd></> : null}
          {op.plan?.planId ? <><dt>Plan</dt><dd><code>{op.plan.planId}</code>{op.plan.kind === "received" ? " (received; run exactly as recorded on the connected side)" : ""}</dd></> : null}
          {op.plan?.configSha256 ? <><dt>Configuration SHA-256</dt><dd><code>{op.plan.configSha256}</code></dd></> : null}
          {op.plan?.kind === "received" ? <><dt>Network</dt><dd>{op.plan.networkConfined ? "Confined to the destination registry" : "Not confined (switched off for this run)"}</dd></> : null}
          {op.workspaceDir && op.mode === "mirrorToMirror" ? <><dt>Workspace</dt><dd><code>{op.workspaceDir}</code></dd></> : null}
          {op.cacheDir ? <><dt>Cache</dt><dd><code>{op.cacheDir}</code></dd></> : null}
          {op.transferDir ? <><dt>{op.kind === "receive" ? "Transfer folder" : "Transfer written to"}</dt><dd><code>{op.transferDir}</code></dd></> : null}
          {op.archives != null ? <><dt>Archive files</dt><dd>{op.archives}{op.bytes ? ` (${(op.bytes / 1024 ** 3).toFixed(2)} GiB)` : ""}</dd></> : null}
          {op.manifestSha256 ? <><dt>Manifest SHA-256</dt><dd><code>{op.manifestSha256}</code></dd></> : null}
          {op.storage ? <><dt>Storage root</dt><dd><code>{op.storage.base}</code> {op.storage.source === "configured" ? "(OAA_MIRROR_STORAGE_ROOT)" : "(application data directory)"}</dd></> : null}
          {op.outcome && !active ? <><dt>Result</dt><dd>{op.outcome.text}</dd></> : null}
          {op.offlineReady != null ? <><dt>Offline-ready</dt><dd>{op.offlineReady ? "Yes: every operator catalog is pinned to a digest" : "No: a catalog is still a tag; disk to mirror may need the source registry"}</dd></> : null}
        </dl>

        {failed ? (
          <div className="note warning mirroring-op-failure" role="alert">
            <strong>{statusNow === "failed" ? "What went wrong" : "What did not complete"}</strong>
            <ul>
              {op.kind === "run" && exitCode != null && exitCode !== 0 ? <li>oc-mirror exited with code {exitCode}. The last lines of the output below say why.</li> : null}
              {op.failedImages?.length ? <li>Images that failed: {op.failedImages.join(", ")}</li> : null}
              {op.signatureFailures ? <li>{op.signatureFailures} signature error(s){op.retriedAs ? "; an automatic retry was started (see Related)." : "."}</li> : null}
              {(op.problems || []).map((p) => <li key={p}>{p}</li>)}
              {op.failureReason ? <li>{op.failureReason}</li> : null}
            </ul>
            {op.recovery?.length ? <p><strong>To fix:</strong> {op.recovery.join(" ")}</p> : null}
          </div>
        ) : null}

        {op.kind === "run" && op.recovery && op.recovery.classification !== "NONE" && !active ? (
          <div className={`note ${op.recovery.eligible ? "subtle" : "warning"} mirroring-op-recovery`}>
            <h4 className="mirroring-op-subheading">What to do next: {RECOVERY_CLASS_TEXT[op.recovery.classification] || op.recovery.classification}</h4>
            <p>{op.recovery.text}</p>
            {op.recovery.requires?.length ? <p className="subtle">Needed for another attempt: {op.recovery.requires.join(", ")}.</p> : null}
            {op.recovery.eligible && op.profileExists ? (
              <div className="actions mirroring-op-retry">
                <Button variant="primary" onClick={() => setRetryOpen(true)}>Run the same again…</Button>
                <FieldLabelWithInfo label="Run the same again, or a new mirror?" hint={RETRY_VS_UPDATE_HINT}>
                  <span />
                </FieldLabelWithInfo>
              </div>
            ) : null}
          </div>
        ) : null}

        {op.verification ? (
          <div className="mirroring-op-verification">
            <h4 className="mirroring-op-subheading">Result check: {VERIFICATION_STATE_TEXT[op.verification.state] || op.verification.state}</h4>
            <p className="subtle">Checked by Architect after oc-mirror finished — {op.verification.scope || "what could be checked"}.</p>
            <ul className="mirroring-op-checks">
              {(op.verification.checks || []).map((c) => <li key={c.name}><strong>{c.ok ? "OK" : "Not OK"}</strong> — {c.name}: {c.detail}</li>)}
            </ul>
          </div>
        ) : null}

        {op.signatureRetry || op.signatureRecovery ? (
          <p className="note subtle mirroring-op-signature">
            {op.signatureRecovery
              ? (op.signatureRecovery.verified
                ? `Signature retry: ${op.signatureRecovery.resolved.join(", ")} mirrored without sigstore signatures, for this retry only.`
                : `Signature retry: still failing — ${op.signatureRecovery.unresolved.join(", ") || "see the output"}.`)
              : op.signatureRetry.reason || (op.signatureRetry.state === "started" ? "An automatic signature retry was started (see Related)." : "")}
          </p>
        ) : null}

        {op.errorFile ? (
          <>
            <h4 className="mirroring-op-subheading">oc-mirror&apos;s error list</h4>
            <p className="subtle">Written by oc-mirror for this run (<code>{op.errorFile.file}</code>){op.errorFile.truncated ? "; the first lines are shown" : ""}.</p>
            <pre className="mirroring-run-log mirroring-op-command" tabIndex={0} aria-label="oc-mirror error list">{op.errorFile.lines.join("\n")}</pre>
          </>
        ) : null}

        {op.archiveList?.length ? (
          <>
            <h4 className="mirroring-op-subheading">Archive files</h4>
            <ul className="mirroring-op-archives" aria-label="Archive files">
              {op.archiveList.map((a) => (
                <li key={a.file}><code>{a.file}</code> · {(a.bytes / 1024 ** 2).toFixed(1)} MiB · SHA-256 <code>{a.sha256}</code></li>
              ))}
            </ul>
          </>
        ) : null}

        {op.command ? (
          <>
            <h4 className="mirroring-op-subheading">Command</h4>
            <p className="subtle">As oc-mirror was started; the credentials file is never shown.</p>
            <pre className="mirroring-run-log mirroring-op-command" tabIndex={0} aria-label="oc-mirror command">{op.command}</pre>
          </>
        ) : null}

        {op.links?.length ? (
          <>
            <h4 className="mirroring-op-subheading">Related</h4>
            <ul className="mirroring-op-links">
              {op.links.map((l) => (
                // Two links with the same label (e.g. a transfer prepared twice) are told apart by time.
                <li key={l.jobId}>
                  <Button variant="secondary" className="mini" onClick={() => onSelect(l.jobId)}>
                    {op.links.filter((x) => x.label === l.label).length > 1 ? `${l.label} (${when(l.at)})` : l.label}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <h4 className="mirroring-op-subheading">Output</h4>
        <p className="subtle">{active ? "Live; follows the newest lines unless you scroll up." : "Final."} The server keeps the last 500 KB of output for each operation.</p>
        <pre
          ref={logRef}
          className="mirroring-run-log mirroring-op-log"
          tabIndex={0}
          aria-label="Output"
          onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
        >
          {output || (active ? "Waiting for output…" : watch.gone ? "The server no longer has this operation's output." : "No output was recorded.")}
        </pre>
      </div>
      <Modal isOpen={Boolean(planView)} onClose={() => setPlanView(null)} ariaLabelledBy={`${headingId}-plan`}>
          <h3 id={`${headingId}-plan`}>Configuration of this run</h3>
          {planView?.loading ? <p role="status">Loading the plan…</p> : null}
          {planView?.error ? <Banner variant="error">{planView.error}</Banner> : null}
          {planView?.plan ? (
            <>
              <dl className="modal-summary">
                <dt>Plan</dt><dd><code>{planView.plan.planId}</code></dd>
                <dt>Created</dt><dd>{new Date(planView.plan.createdAt).toLocaleString()}</dd>
                <dt>Configuration SHA-256</dt><dd><code>{planView.plan.imagesetConfig.sha256}</code></dd>
                <dt>oc-mirror</dt><dd>{planView.plan.tool?.version} · SHA-256 <code>{planView.plan.tool?.sha256}</code></dd>
              </dl>
              <pre className="mirroring-plan-yaml" tabIndex={0} aria-label="ImageSetConfiguration stored in this plan">{planView.yaml}</pre>
            </>
          ) : null}
          <div className="actions"><Button variant="secondary" onClick={() => setPlanView(null)}>Close</Button></div>
        </Modal>
        {retryOpen ? (
        <RetryDialog
          op={op}
          onClose={() => setRetryOpen(false)}
          onStarted={(newJobId) => { setRetryOpen(false); onChanged?.(); onSelect(newJobId); }}
        />
      ) : null}
    </section>
  );
}

/** Fresh credentials for one "Run the same again" attempt; nothing is kept. */
function RetryDialog({ op, onClose, onStarted }) {
  const needsSource = op.mode !== "diskToMirror";
  const needsDest = op.mode !== "mirrorToDisk";
  // The profile's session source credential (R-UX02), reused only when accepted here.
  const sourceCred = useSourceCredential(op.profileId, "retry");
  const [mountedAvailable, setMountedAvailable] = useState(false);
  useEffect(() => { apiFetch("/api/secrets/rh-pull-secret").then((d) => setMountedAvailable(Boolean(d?.available))).catch(() => {}); }, []);
  const [destSecret, setDestSecret] = useState("");
  const [destAnonymous, setDestAnonymous] = useState(false);
  const [registry, setRegistry] = useState((op.destination || "").replace(/^docker:\/\//, ""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const idPrefix = `retry-${op.jobId}`;
  const start = async () => {
    setError("");
    if (needsDest && !registry.trim()) { setError("Enter the destination registry."); return; }
    setBusy(true);
    try {
      const body = {
        ...(needsSource && sourceCred.usable ? sourceCred.body : {}),
        ...(needsDest ? { registryUrl: registry.trim(), mirrorAuthSource: "inline", ...(destSecret.trim() ? { mirrorPullSecret: destSecret.trim() } : {}) } : {})
      };
      const { jobId } = await retryOperation(op.profileId, op.jobId, body);
      onStarted(jobId);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen onClose={onClose} ariaLabelledBy={`${idPrefix}-title`} className="modal mirroring-retry-modal">
      <h3 id={`${idPrefix}-title`}>Run the same again</h3>
      <p className="modal-copy">
        Runs exactly what this run ran — the same configuration and options, byte for byte — with this profile&apos;s
        workspace and cache, so only what is still missing is fetched. The result is checked when it finishes.
        {op.mode === "diskToMirror" ? " The received transfer is checked again, file by file, before anything is loaded." : ""}
      </p>
      <p className="modal-copy subtle">Credentials are needed again: they were not kept from the first attempt.</p>
      {needsSource ? (
        <SourceCredentialField profileId={op.profileId} site="retry" idPrefix={`${idPrefix}-pull`} label="Source pull secret" hint={RUN_PULL_SECRET_HINT} mountedAvailable={mountedAvailable} rows={3} />
      ) : null}
      {needsDest ? (
        <>
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Destination registry" hint={`The registry this attempt pushes into, as before.

**Format:**
host[:port][/path], for example mirror.example.com:8443/ocp.

**Example:**
The registry the original run used is filled in.

**Important notes:**
• ⚠️ Use the same registry as the original run, or the result check compares against the wrong place.`}>
              <input id={`${idPrefix}-registry`} type="text" value={registry} onChange={(e) => setRegistry(e.target.value)} spellCheck={false} autoComplete="off" />
            </FieldLabelWithInfo>
          </div>
          <DestinationCredentialsField idPrefix={`${idPrefix}-dest`} registryUrl={registry} value={destSecret} onChange={setDestSecret}
            anonymous={destAnonymous} onAnonymousChange={setDestAnonymous} onDestinationChange={setRegistry} hint={MIRROR_SECRET_HINT} purpose="For the registry this attempt pushes into." />
        </>
      ) : null}
      {error ? <div className="note warning" role="alert">{error}</div> : null}
      <div className="actions">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={start} disabled={busy}>{busy ? "Starting…" : "Run the same again"}</Button>
      </div>

    </Modal>
  );
}
