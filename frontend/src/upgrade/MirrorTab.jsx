/**
 * OpenShift Airgap Architect - Upgrade › 4 Mirror & transfer (v2.3.0 UX correction).
 *
 * Gets each stage's content into the disconnected registry, with Mirroring's own engine:
 *  - ONE setup card: method, mirror registry, catalog-tag choice and the plan's credentials
 *    (memory only, this tab, this plan — D-2). Nothing else on this page asks for them again.
 *  - A stage table: what each stage holds, where it stands (content only), and its actions.
 *  - "Mirror this stage…" = one oc-mirror job; "Mirror all N stages…" = N jobs, one after another,
 *    each after its own server preflight, stopping at the first failure. Both use the same
 *    reviewed confirmation. Neither updates or contacts the cluster.
 *  - Stage details embed Mirroring's run panel (preflight, options, log, prepare transfer,
 *    received transfers) in managed mode; "Open in Mirroring" offers the full workspace with a
 *    way straight back to this plan and stage.
 *
 * Mirror to mirror never replaces an existing catalog tag silently (owner refinement 4): the
 * confirmation lists every catalog tag that exists (or could not be checked) and each needs its
 * own acknowledgement; the server checks again at start. Placing content in a registry does not
 * activate it in any cluster.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import Modal from "../components/Modal.jsx";
import Switch from "../components/Switch.jsx";
import OptionRow from "../components/OptionRow.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import MirroringRunPanel from "../mirroring/MirroringRunPanel.jsx";
import SourceCredentialField from "../mirroring/SourceCredentialField.jsx";
import DestinationCredentialsField from "../mirroring/DestinationCredentialsField.jsx";
import { ReceiveTransferForm } from "../mirroring/HighSideControls.jsx";
import { useSourceCredential, useDestinationCredential } from "../mirroring/sourceCredentialSession.js";
import { useJobWatch } from "../mirroring/useJobWatch.js";
import { fetchMirroring, stopJob } from "../mirroring/mirroringApi.js";
import { normalizeRegistryReference } from "../../../shared/registryReference.js";
import { SEQ_REGISTRY_HINT, SEQ_SOURCE_HINT } from "./upgradeCopy.js";
import { previewSequence, startSequence, destinationCheck, saveMirrorSettings } from "./upgradeApi.js";
import { StageProgress, contentStateText } from "./stageStatus.jsx";

export const METHODS = [
  ["mirrorToDisk", "Mirror to disk", "Connected side", "Download each stage into archive files on this server, then carry them across the air gap."],
  ["mirrorToMirror", "Mirror to mirror", "Reaches both sides", "Copy each stage straight into your registry. No archives, no transfer."],
  ["diskToMirror", "Disk to mirror", "Disconnected side", "Load each received stage transfer into your registry."]
];
const METHOD_NAME = Object.fromEntries(METHODS.map(([k, l]) => [k, l]));
const JOB_STATE = { pending: "waiting", running: "running", "mirrored-to-disk": "✓ mirrored to disk", "registry-verified": "✓ in the registry, verified", "preflight-blocked": "✕ preflight blocked", refused: "✕ refused", failed: "✕ failed", stopped: "■ stopped", "not-run": "not run", "registry-unverified": "✕ not verified in the registry" };

/** The reviewed confirmation for one or several stage jobs (replaces the old "Running work that will be stopped" dialog). */
export function MirrorJobsDialog({ plan, review, sourceReady, destReady, destAnonymous, busy, error, onCancel, onConfirm }) {
  const [acks, setAcks] = useState({});
  const [showPaths, setShowPaths] = useState(false);
  useEffect(() => { setAcks({}); setShowPaths(false); }, [review?.preview?.token]);
  if (!review) return null;
  const { preview, catalogs = [] } = review;
  const m2m = preview.mode === "mirrorToMirror";
  const n = preview.stages.length;
  const replaceable = catalogs.filter((c) => c.exists !== false);
  const allAcked = replaceable.every((c) => acks[c.destination]);
  const problems = preview.stages.filter((s) => s.problem);
  const verb = m2m ? "mirror-to-mirror" : "mirror-to-disk";
  const title = `${m2m ? "Mirror" : "Mirror"} ${n === 1 ? `stage ${preview.stages[0].stageId.slice(1)}` : `${n} stages`} ${m2m ? "to the registry" : "to disk"}?`;
  return (
    <Modal isOpen onClose={onCancel} ariaLabelledBy={`upgrade-jobs-${plan.id}`} className="modal upgrade-jobs-dialog">
      <h3 id={`upgrade-jobs-${plan.id}`}>{title}</h3>
      {error ? <Banner variant="error">{error}</Banner> : null}
      {problems.length ? <Banner variant="error">{problems.map((p) => `Stage ${p.stageId.slice(1)}: ${p.problem}`).join(" ")}</Banner> : null}
      <h4>{n === 1 ? "Job that will run" : "Jobs that will run (one after another)"}</h4>
      <ol className="upgrade-jobs-list">
        {preview.stages.map((s) => (
          <li key={s.stageId}>
            <strong>{s.release}</strong> · platform{s.operators ? ` + ${s.operators} operator${s.operators === 1 ? "" : "s"} (catalog ${s.catalogMinor})` : ""}
          </li>
        ))}
      </ol>
      <h4>Where the output goes</h4>
      {m2m ? (
        <p className="modal-copy">{[...new Set(preview.stages.map((s) => s.destination).filter(Boolean))].map((d) => <code key={d}>{d}</code>)}</p>
      ) : (
        <p className="modal-copy">One archive folder per stage, on this server. <Button variant="secondary" className="mini" aria-expanded={showPaths} onClick={() => setShowPaths((v) => !v)}>{showPaths ? "Hide paths" : "Show paths"}</Button></p>
      )}
      {!m2m && showPaths ? <ul className="upgrade-paths">{preview.stages.map((s) => <li key={s.stageId}>Stage {s.stageId.slice(1)}: <code>{s.destination}</code></li>)}</ul> : null}
      {m2m && replaceable.length ? (
        <div className="upgrade-overwrite">
          <h4>Catalog tags that would be replaced</h4>
          <p className="modal-copy">oc-mirror replaces a catalog tag&apos;s content with this stage&apos;s selection. Clusters whose CatalogSource polls one of these tags may see the change. Acknowledge each one, or cancel and turn on “Write catalogs under a plan-specific tag”.</p>
          <ul className="upgrade-check-list">
            {replaceable.map((c) => (
              <li key={c.destination}>
                <label className="toggle-row">
                  <input type="checkbox" checked={Boolean(acks[c.destination])} onChange={(e) => setAcks((a) => ({ ...a, [c.destination]: e.target.checked }))} />
                  <span><code>{c.destination}</code> — {c.exists === true ? "already in the registry; it will be replaced" : "could not be checked (treated as existing)"}{c.problem ? ` (${c.problem})` : ""}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <h4>Credentials used</h4>
      <ul className="modal-copy">
        <li>Red Hat pull secret: {sourceReady ? "entered for this plan" : "not entered — the preflight will stop the first job"}. Held in server memory for these jobs only; never saved.</li>
        {m2m ? <li>Registry credentials: {destReady ? (destAnonymous ? "anonymous access (your choice)" : "entered for this plan") : "not entered — the preflight will stop the first job"}.</li> : null}
      </ul>
      <h4>If a job fails</h4>
      <p className="modal-copy">{n === 1 ? "Nothing else is started. Its log stays in Operations." : "The remaining jobs do not start. Finished stages keep their output."} Each job&apos;s preflight runs right before it.</p>
      <h4>What will not happen</h4>
      <p className="modal-copy">Your cluster is not updated or contacted. {m2m ? "Content placed in the registry is not activated in any cluster. " : ""}Other plans and Mirroring profiles are not changed.</p>
      <div className="actions">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={busy || problems.length > 0 || !allAcked} onClick={() => onConfirm(replaceable.map((c) => c.destination))}>
          {busy ? "Starting…" : `Start ${n} ${verb} job${n === 1 ? "" : "s"}`}
        </Button>
      </div>
    </Modal>
  );
}

export default function MirrorTab({ plan, highSide, onPlanChanged, credentialKey, onShowOperation = null, onOpenStageInMirroring = null, initialStageId = null, onGoToStep = null, onProfilesSeen = null }) {
  const [profiles, setProfiles] = useState({});
  // Report every loaded or saved stage profile to the shell (live YAML preview), without re-running loads.
  const seenRef = useRef(onProfilesSeen);
  seenRef.current = onProfilesSeen;
  const [error, setError] = useState("");
  const [registryDraft, setRegistryDraft] = useState(plan.mirror?.registryUrl || "");
  const [registryError, setRegistryError] = useState("");
  const [details, setDetails] = useState(initialStageId);
  const [review, setReview] = useState(null);
  const [reviewError, setReviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const received = plan.kind === "received";
  const method = plan.mirror?.method || (received || highSide ? "diskToMirror" : "mirrorToDisk");
  const sourceCred = useSourceCredential(credentialKey, "run");
  const destCred = useDestinationCredential(credentialKey);
  const { job } = useJobWatch(jobId, { onSettled: () => { onPlanChanged(null); loadProfiles(); } });
  const meta = job?.metadata_json ? JSON.parse(job.metadata_json) : null;
  const running = Boolean(job && ["queued", "running"].includes(job.status));

  const loadProfiles = useCallback(async () => {
    try {
      const m = await fetchMirroring();
      setProfiles(Object.fromEntries((m.profiles || []).map((p) => [p.id, p])));
      seenRef.current?.(m.profiles || []);
    } catch (err) {
      setError(`Could not load the stage profiles: ${String(err.message || err)}`);
    }
  }, []);
  useEffect(() => { loadProfiles(); }, [loadProfiles, plan.stages.length, plan.updatedAt]);
  useEffect(() => { setRegistryDraft(plan.mirror?.registryUrl || ""); }, [plan.mirror?.registryUrl]);
  useEffect(() => { if (initialStageId) setDetails(initialStageId); }, [initialStageId]);

  const saveSettings = async (body) => {
    setError("");
    try {
      const r = await saveMirrorSettings(plan.id, body);
      onPlanChanged(r.plan);
      loadProfiles();
      return true;
    } catch (err) {
      if (err.payload?.code === "REGISTRY_REFERENCE_INVALID") setRegistryError(String(err.message || err));
      else setError(String(err.message || err));
      return false;
    }
  };
  const commitRegistry = async () => {
    const v = registryDraft.trim();
    if ((v || null) === (plan.mirror?.registryUrl || null)) { setRegistryError(""); return; }
    if (v) {
      const r = normalizeRegistryReference(v);
      if (!r.ok) { setRegistryError(r.reason); return; }
    }
    setRegistryError("");
    await saveSettings({ registryUrl: v || null });
  };

  const views = plan.stageViews || [];
  const canRunAll = !received && (method === "mirrorToDisk" || method === "mirrorToMirror") && views.length > 0;
  const needsRegistry = method !== "mirrorToDisk";

  const openReview = async (stageIds = null) => {
    setReviewError("");
    setError("");
    try {
      const scope = { mode: method, ...(stageIds ? { stageIds } : {}) };
      const preview = await previewSequence(plan.id, scope);
      let catalogs = [];
      if (method === "mirrorToMirror") {
        const check = await destinationCheck(plan.id, { ...scope, ...destCred.body });
        catalogs = check.catalogs || [];
      }
      setReview({ scope, preview, catalogs });
    } catch (err) {
      setError(String(err.message || err));
    }
  };
  const start = async (acknowledgedOverwrites) => {
    setBusy(true);
    setReviewError("");
    try {
      const r = await startSequence(plan.id, {
        ...review.scope,
        ...sourceCred.body,
        ...(method === "mirrorToMirror" ? destCred.body : {}),
        previewToken: review.preview.token,
        ...(acknowledgedOverwrites.length ? { acknowledgedOverwrites } : {})
      });
      setJobId(r.jobId);
      setReview(null);
    } catch (err) {
      if (err.payload?.code === "CATALOG_OVERWRITE_NOT_ACKNOWLEDGED" && err.payload.catalogs) setReview((rv) => ({ ...rv, catalogs: err.payload.catalogs }));
      setReviewError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  };

  const detailView = views.find((v) => v.id === details) || null;
  const detailProfile = detailView?.linkedProfileId ? profiles[detailView.linkedProfileId] : null;
  const managed = useMemo(() => ({
    method,
    credentialKey,
    settingsHint: `${METHOD_NAME[method]}, the registry and the credentials come from “How content gets to the disconnected side” above.`
  }), [method, credentialKey]);

  if (!plan.path) {
    return (
      <section className="card">
        <h3>Mirror &amp; transfer</h3>
        <p className="subtle">Compute the route and prepare the stages first.</p>
        {onGoToStep ? <div className="actions"><Button variant="primary" onClick={() => onGoToStep("route")}>Go to Route</Button></div> : null}
      </section>
    );
  }

  return (
    <div className="upgrade-mirror">
      {error ? <Banner variant="error">{error}</Banner> : null}
      <section className="card" aria-labelledby={`upgrade-setup-${plan.id}`}>
        <h3 id={`upgrade-setup-${plan.id}`}>How content gets to the disconnected side</h3>
        <div className="upgrade-method-cards" role="radiogroup" aria-label="Mirroring method for this plan">
          {METHODS.filter(([k]) => !received || k === "diskToMirror").map(([k, label, side, desc]) => (
            <button key={k} type="button" role="radio" aria-checked={method === k} className={`select-card upgrade-method-card${method === k ? " selected" : ""}`} disabled={running} onClick={() => method !== k && saveSettings({ method: k })}>
              <span className="card-title">{label}</span>
              <span className="mirroring-profile-meta">{side}</span>
              <span className="subtle">{desc}</span>
              {method === k ? <span className="select-card-check" aria-hidden="true">✓ Selected</span> : null}
            </button>
          ))}
        </div>
        <div className="field-grid upgrade-fields">
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Mirror registry" hint={SEQ_REGISTRY_HINT}>
              <input id={`upgrade-registry-${plan.id}`} type="text" autoComplete="off" spellCheck={false} value={registryDraft} placeholder="mirror.example.com:8443/ocp"
                className={registryError ? "input-error" : ""} aria-invalid={registryError ? "true" : undefined} aria-describedby={registryError ? `upgrade-registry-err-${plan.id}` : undefined}
                onChange={(e) => setRegistryDraft(e.target.value)} onBlur={commitRegistry} onKeyDown={(e) => { if (e.key === "Enter") commitRegistry(); }} disabled={running} />
            </FieldLabelWithInfo>
            <div className="field-control-support">
              {registryError ? <span id={`upgrade-registry-err-${plan.id}`} className="field-error" role="alert">{registryError}</span>
                : <span className="field-helper">Entered once: used by every stage{needsRegistry ? "" : " (when you load them)"}, the update instructions and the OSUS templates. Never put credentials here.</span>}
            </div>
          </div>
        </div>
        {needsRegistry ? (
          <OptionRow title="Write catalogs under a plan-specific tag" description="oc-mirror replaces a catalog tag's content with each stage's selection. A plan-specific tag leaves the tags existing clusters use untouched (the generated CatalogSource then names the new tag).">
            <Switch checked={plan.mirror?.catalogTag === "plan"} disabled={running || received} onChange={(on) => saveSettings({ catalogTag: on ? "plan" : "source" })} aria-label="Write catalogs under a plan-specific tag" />
          </OptionRow>
        ) : null}
        <h4>Credentials <span className="subtle">(this browser tab only — never saved)</span></h4>
        {method !== "diskToMirror" ? (
          <SourceCredentialField profileId={credentialKey} site="run" idPrefix={`upgrade-src-${plan.id}`} hint={SEQ_SOURCE_HINT} />
        ) : <p className="subtle">Disk to mirror pulls nothing from Red Hat registries: no Red Hat pull secret is needed.</p>}
        {needsRegistry ? (
          <DestinationCredentialsField
            idPrefix={`upgrade-dest-${plan.id}`}
            registryUrl={plan.mirror?.registryUrl || registryDraft}
            value={destCred.secret}
            onChange={(v) => destCred.set({ secret: v, anonymous: false })}
            anonymous={destCred.anonymous}
            onAnonymousChange={(on) => destCred.set({ secret: on ? "" : destCred.secret, anonymous: on })}
            onDestinationChange={(v) => { setRegistryDraft(v); }}
            disabled={running}
          />
        ) : null}
      </section>

      <section className="card" aria-labelledby={`upgrade-stagetable-${plan.id}`}>
        <h3 id={`upgrade-stagetable-${plan.id}`}>Stages</h3>
        {!views.length ? (
          <p className="subtle">No stages yet. Prepare them on the Content step. {onGoToStep ? <Button variant="secondary" className="mini" onClick={() => onGoToStep("content")}>Go to Content</Button> : null}</p>
        ) : (
          <ul className="upgrade-stage-rows">
            {views.map((v) => {
              const [state, text] = contentStateText(v.content?.state);
              const p = v.linkedProfileId ? profiles[v.linkedProfileId] : null;
              return (
                <li key={v.id} className={`upgrade-stage-row${details === v.id ? " open" : ""}`}>
                  <div className="upgrade-stage-row-main">
                    <div className="upgrade-stage-row-title">
                      <strong>Stage {v.id.slice(1)} · {v.release}</strong>
                      <span className="subtle">platform{v.operatorsSelected ? ` + ${v.operatorsSelected} operator${v.operatorsSelected === 1 ? "" : "s"}` : ""}{p?.execution?.registryUrl && needsRegistry && p.execution.registryUrl !== plan.mirror?.registryUrl ? ` · own registry ${p.execution.registryUrl}` : ""}</span>
                    </div>
                    <span className="upgrade-badge" data-state={state}>{text}</span>
                    <div className="upgrade-stage-row-actions">
                      {canRunAll ? <Button variant="secondary" disabled={running} onClick={() => openReview([v.id])}>Mirror this stage…</Button> : null}
                      <Button variant="secondary" aria-expanded={details === v.id} aria-controls={`upgrade-stage-details-${plan.id}`} onClick={() => setDetails((d) => (d === v.id ? null : v.id))}>{details === v.id ? "Hide details" : "Details"}</Button>
                      {onOpenStageInMirroring && v.linkedProfileId ? <Button variant="secondary" onClick={() => onOpenStageInMirroring(v)}>Open in Mirroring ↗</Button> : null}
                    </div>
                  </div>
                  <StageProgress view={v} compact />
                </li>
              );
            })}
          </ul>
        )}
        <div className="actions">
          {canRunAll && views.length > 1 ? <Button variant="primary" disabled={running} onClick={() => openReview(null)}>Mirror all {views.length} stages {method === "mirrorToMirror" ? "to the registry" : "to disk"}…</Button> : null}
          {running ? <Button variant="destructive" onClick={() => stopJob(jobId)}>Stop</Button> : null}
          <Button variant="secondary" onClick={() => setReceiveOpen(true)}>Receive a stage transfer…</Button>
        </div>
        {method === "diskToMirror" ? <p className="subtle">Disk to mirror loads one received transfer at a time: open a stage&apos;s details, then run its preflight and disk to mirror.</p> : null}
        {meta?.stages ? (
          <div role="status" aria-live="polite" className="upgrade-job-status">
            <p><strong>{job.status === "completed" ? "Finished." : running ? "Running." : `${job.status}.`}</strong> {job.message}</p>
            <ol>{meta.stages.map((s) => <li key={s.stageId}>Stage {s.stageId.slice(1)} ({s.release}): {JOB_STATE[s.state] || s.state}{s.detail ? ` — ${s.detail}` : ""}{s.jobId && onShowOperation ? <> <Button variant="secondary" className="mini" onClick={() => onShowOperation(s.jobId)}>Log</Button></> : null}</li>)}</ol>
          </div>
        ) : null}
      </section>

      {detailView && detailProfile ? (
        <section className="card upgrade-stage-details" id={`upgrade-stage-details-${plan.id}`} aria-labelledby={`upgrade-stage-details-h-${plan.id}`}>
          <h3 id={`upgrade-stage-details-h-${plan.id}`}>Stage {detailView.id.slice(1)} · {detailView.release}: run, transfer and checks</h3>
          <MirroringRunPanel key={detailProfile.id} profile={detailProfile} onProfileChanged={(p) => { setProfiles((all) => ({ ...all, [p.id]: p })); seenRef.current?.([p]); }} onProfilesChanged={() => { loadProfiles(); onPlanChanged(null); }} onShowOperation={onShowOperation} requestDestinationCheck managed={managed} />
        </section>
      ) : null}

      <MirrorJobsDialog
        plan={plan}
        review={review}
        sourceReady={sourceCred.usable}
        destReady={destCred.ready}
        destAnonymous={destCred.anonymous}
        busy={busy}
        error={reviewError}
        onCancel={() => setReview(null)}
        onConfirm={start}
      />

      <Modal isOpen={receiveOpen} onClose={() => setReceiveOpen(false)} ariaLabelledBy={`upgrade-receive-${plan.id}`}>
        <h3 id={`upgrade-receive-${plan.id}`}>Receive a stage transfer</h3>
        <p className="modal-copy subtle">Name the folder on this server where you copied one stage&apos;s transfer (the mirror_*.tar archives, SHA256SUMS and oaa-transfer). Architect verifies every file, then links it to its stage. {highSide ? "" : "This is normally done on the disconnected side."}</p>
        <ReceiveTransferForm idPrefix={`upgrade-receive-form-${plan.id}`} onReceived={() => { loadProfiles(); onPlanChanged(null); }} />
        <div className="actions"><Button variant="secondary" onClick={() => setReceiveOpen(false)}>Close</Button></div>
      </Modal>
    </div>
  );
}
