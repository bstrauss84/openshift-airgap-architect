/**
 * OpenShift Airgap Architect - Upgrade › Content & runs (v2.3.0, RFC §4, §8.2, §8.5).
 *
 * The update route and the registry content are different things. Every
 * release the cluster is updated to becomes one stage: one Upgrade-owned
 * Mirroring profile with exactly one pinned release and that minor's
 * operator catalog. Each stage runs through the existing Mirroring panels
 * (operators, preflight, mirror to disk / mirror to mirror / disk to mirror,
 * transfers) — the same engine, not a copy. A reviewed sequence can run
 * several stages in order and stops at the first failure. Content status is
 * evidence-based; mirroring never marks the cluster as updated.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import Modal from "../components/Modal.jsx";
import ScopedConfirmModal from "../components/ScopedConfirmModal.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import OperatorsSection from "../mirroring/OperatorsSection.jsx";
import MirroringRunPanel from "../mirroring/MirroringRunPanel.jsx";
import SourceCredentialField from "../mirroring/SourceCredentialField.jsx";
import DestinationCredentialsField from "../mirroring/DestinationCredentialsField.jsx";
import { ReceiveTransferForm } from "../mirroring/HighSideControls.jsx";
import { useSourceCredential } from "../mirroring/sourceCredentialSession.js";
import { useJobWatch } from "../mirroring/useJobWatch.js";
import { fetchMirroring, updateProfile, stopJob } from "../mirroring/mirroringApi.js";
import { SEQ_MODE_HINT, SEQ_REGISTRY_HINT, SEQ_SOURCE_HINT } from "./upgradeCopy.js";
import { prepareStages, previewSequence, startSequence, setClusterProgress } from "./upgradeApi.js";

export const CONTENT_STATE_TEXT = {
  planned: ["NOT_CHECKED", "○ planned — not mirrored yet"],
  running: ["NOT_CHECKED", "… running"],
  "mirrored-to-disk": ["WARNING", "▣ mirrored to disk — not yet in the disconnected registry"],
  "transfer-prepared": ["WARNING", "⇢ transfer prepared — carry it across the air gap"],
  "transfer-received": ["WARNING", "⇢ transfer received — load it with disk to mirror"],
  "in-registry-unverified": ["WARNING", "⚠ in the registry, not confirmed by a destination check"],
  "registry-verified": ["VERIFIED", "✓ in the registry, every image confirmed"],
  "profile-missing": ["BLOCKED", "✕ no stage profile (prepare stages, or receive this stage's transfer)"]
};
/**
 * Where one stage stands, as steps (no percentages: oc-mirror reports none we
 * could honestly turn into one). Every step comes from recorded evidence —
 * the stage's runs, transfers, receipts and destination checks — or, for the
 * last step, from your own statement. Steps a mirror-to-mirror stage does not
 * need are shown as "not needed". The only motion is a pulse on the step in
 * progress, which reduced motion turns off.
 */
export function StageProgress({ view }) {
  const kinds = new Set((view.content?.evidence || []).map((e) => e.kind));
  const viaRegistryDirect = kinds.has("mirrored-to-registry");
  const steps = [
    { id: "planned", label: "Planned", done: view.content?.state !== "profile-missing" },
    { id: "disk", label: "Mirrored to disk", done: kinds.has("mirrored-to-disk"), skip: viaRegistryDirect && !kinds.has("mirrored-to-disk") },
    { id: "transfer", label: "Transfer prepared", done: kinds.has("transfer-prepared"), skip: viaRegistryDirect && !kinds.has("transfer-prepared") },
    { id: "received", label: "Received", done: kinds.has("transfer-received"), skip: viaRegistryDirect && !kinds.has("transfer-received") },
    { id: "registry", label: "In the registry", done: kinds.has("mirrored-to-registry") || kinds.has("loaded-into-registry") },
    { id: "verified", label: "Registry verified", done: kinds.has("registry-verified") },
    { id: "cluster", label: "Cluster updated (your statement)", done: view.clusterUpdated === "attested" }
  ];
  const running = view.content?.state === "running";
  const next = steps.findIndex((st) => !st.done && !st.skip);
  return (
    <ol className="upgrade-stage-progress" aria-label={`Stage ${view.id.slice(1)} progress`}>
      {steps.map((st, i) => {
        const state = st.done ? "done" : st.skip ? "skipped" : running && i === next ? "active" : "todo";
        return (
          <li key={st.id} className="upgrade-stage-progress-step" data-state={state} aria-current={i === next ? "step" : undefined}>
            <span className="upgrade-stage-progress-dot" aria-hidden="true">{state === "done" ? "✓" : state === "skipped" ? "–" : state === "active" ? "●" : "○"}</span>
            <span>{st.label}{state === "skipped" ? " (not needed)" : state === "active" ? " (in progress)" : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}

const SEQ_STATE = { pending: "waiting", running: "running", "mirrored-to-disk": "✓ mirrored to disk", "registry-verified": "✓ in registry, verified", "preflight-blocked": "✕ preflight blocked", refused: "✕ refused", failed: "✕ failed", stopped: "■ stopped", "not-run": "not run", "registry-unverified": "✕ not verified in the registry" };

function SequenceCard({ plan, onDone }) {
  const [mode, setMode] = useState("mirrorToDisk");
  const [registry, setRegistry] = useState("");
  const [destSecret, setDestSecret] = useState("");
  const [destAnonymous, setDestAnonymous] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState(null);
  const [busy, setBusy] = useState(false);
  const credKey = `upgrade-sequence-${plan.id}`;
  const cred = useSourceCredential(credKey, "sequence");
  const { job } = useJobWatch(jobId, { onSettled: onDone });
  const meta = job?.metadata_json ? JSON.parse(job.metadata_json) : null;
  const scope = () => ({ mode, ...(mode === "mirrorToMirror" ? { registryUrl: registry.trim() } : {}) });

  const review = async () => {
    setError("");
    try { setPreview(await previewSequence(plan.id, scope())); } catch (err) { setError(String(err.message || err)); }
  };
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const body = {
        ...scope(),
        ...cred.body,
        ...(mode === "mirrorToMirror" ? (destAnonymous ? { destinationAuth: "anonymous" } : destSecret.trim() ? { mirrorPullSecret: destSecret.trim() } : {}) : {}),
        previewToken: preview.token
      };
      const r = await startSequence(plan.id, body);
      setJobId(r.jobId);
      setPreview(null);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  };
  const running = job && ["queued", "running"].includes(job.status);
  return (
    <section className="card" aria-labelledby={`upgrade-seq-${plan.id}`}>
      <h3 id={`upgrade-seq-${plan.id}`}>Run every stage in order</h3>
      <p className="subtle">Each stage runs through the same preflight and run as a single Mirroring run. The sequence stops at the first blocked preflight, failed run or (mirror to mirror) unverified destination; nothing continues silently. It never updates the cluster.</p>
      {error ? <Banner variant="error">{error}</Banner> : null}
      <div className="field-grid">
        <div className="field-control-stack">
          <FieldLabelWithInfo label="Mode" hint={SEQ_MODE_HINT}>
            <select id={`upgrade-seq-mode-${plan.id}`} className="control-enum" value={mode} disabled={running} onChange={(e) => { setMode(e.target.value); setPreview(null); }}>
              <option value="mirrorToDisk">Mirror to disk</option>
              <option value="mirrorToMirror">Mirror to mirror</option>
            </select>
          </FieldLabelWithInfo>
          <div className="field-control-support" />
        </div>
        {mode === "mirrorToMirror" ? (
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Destination registry" hint={SEQ_REGISTRY_HINT}>
              <input id={`upgrade-seq-registry-${plan.id}`} type="text" value={registry} autoComplete="off" disabled={running} onChange={(e) => { setRegistry(e.target.value); setPreview(null); }} />
            </FieldLabelWithInfo>
            <div className="field-control-support" />
          </div>
        ) : null}
      </div>
      <SourceCredentialField profileId={credKey} site="sequence" idPrefix={`upgrade-seq-src-${plan.id}`} hint={SEQ_SOURCE_HINT} />
      {mode === "mirrorToMirror" ? (
        <DestinationCredentialsField idPrefix={`upgrade-seq-dest-${plan.id}`} registryUrl={registry} value={destSecret} onChange={setDestSecret} anonymous={destAnonymous} onAnonymousChange={setDestAnonymous} onDestinationChange={setRegistry} disabled={running} />
      ) : null}
      <div className="actions">
        <Button variant="primary" disabled={running || !plan.stages.length} onClick={review}>Review the sequence…</Button>
        {running ? <Button variant="destructive" onClick={() => stopJob(jobId)}>Stop the sequence</Button> : null}
      </div>
      {meta?.stages ? (
        <div role="status" aria-live="polite">
          <p><strong>{job.status === "completed" ? "Completed." : job.status === "running" ? "Running." : `${job.status}.`}</strong> {job.message}</p>
          <ol>{meta.stages.map((s) => <li key={s.stageId}>Stage {s.stageId.slice(1)} ({s.release}): {SEQ_STATE[s.state] || s.state}{s.detail ? ` — ${s.detail}` : ""}{s.jobId ? ` (job ${s.jobId})` : ""}</li>)}</ol>
        </div>
      ) : null}
      <ScopedConfirmModal
        isOpen={Boolean(preview)}
        onClose={() => setPreview(null)}
        id={`upgrade-seq-confirm-${plan.id}`}
        title="Run these stages in order?"
        intro={`${preview?.mode === "mirrorToMirror" ? "Mirror to mirror" : "Mirror to disk"}, one stage after another. Each stage's preflight runs right before it.`}
        removed={[]}
        kept={["Every other Mirroring profile and Upgrade plan", "The cluster: nothing here updates it"]}
        affected={(preview?.stages || []).map((s) => `Stage ${s.stageId.slice(1)} — ${s.release}${s.operators ? `, ${s.operators} operator(s) from ${s.catalogMinor}` : ""} → ${s.destination || "the stage's archive directory"}`)}
        notes={["Stops at the first blocked preflight or failed stage; the stages after it are not run.", "Credentials are kept in server memory only for this sequence and are never written to disk, logs or job records."]}
        confirmLabel="Start the sequence"
        confirmVariant="primary"
        busy={busy}
        onConfirm={start}
      />
    </section>
  );
}

export default function ContentTab({ plan, highSide, onPlanChanged, onShowOperation = null }) {
  const [profiles, setProfiles] = useState({});
  const [selected, setSelected] = useState(plan.stages[0]?.id || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receiveOpen, setReceiveOpen] = useState(false);
  const received = plan.kind === "received";

  const loadProfiles = useCallback(async () => {
    try {
      const m = await fetchMirroring();
      setProfiles(Object.fromEntries((m.profiles || []).map((p) => [p.id, p])));
    } catch (err) {
      setError(`Could not load the stage profiles: ${String(err.message || err)}`);
    }
  }, []);
  useEffect(() => { loadProfiles(); }, [loadProfiles, plan.stages.length]);

  const prepare = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await prepareStages(plan.id);
      onPlanChanged(r.plan);
      await loadProfiles();
      setSelected(r.plan.stages[0]?.id || null);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  };

  if (!plan.path) return <section className="card"><h3>Content</h3><p className="subtle">Compute the update route on the Path tab first.</p></section>;
  const views = plan.stageViews || [];
  const view = views.find((s) => s.id === selected) || null;
  const profile = view?.linkedProfileId ? profiles[view.linkedProfileId] : null;
  const replaceProfile = (p) => { setProfiles((all) => ({ ...all, [p.id]: p })); };

  return (
    <div className="upgrade-content">
      {error ? <Banner variant="error">{error}</Banner> : null}
      <section className="card" aria-labelledby={`upgrade-stages-${plan.id}`}>
        <h3 id={`upgrade-stages-${plan.id}`}>Stages: what must be in the disconnected registry</h3>
        <p className="subtle">
          The cluster passes through {plan.path.path.slice(1).join(", ")}. Each of those releases must be in your registry before its update, so each is one stage:
          one release per oc-mirror configuration (pinned from stable-&lt;minor&gt;), with that minor&apos;s operator catalog.
          Separate configurations avoid oc-mirror&apos;s own cross-channel calculation, which adds releases nobody planned and fails for EUS channel pairs.
        </p>
        {plan.stagesStale ? <Banner variant="warning">The route changed after the stages were prepared. Prepare them again; stage profiles whose release left the route are kept as ordinary Mirroring profiles with their history.</Banner> : null}
        {!received ? (
          <div className="actions">
            <Button variant={plan.stages.length ? "secondary" : "primary"} disabled={busy} onClick={prepare}>{busy ? "Preparing…" : plan.stages.length ? "Prepare stages again" : "Prepare stages"}</Button>
          </div>
        ) : (
          <div className="actions">
            <Button variant="secondary" onClick={() => setReceiveOpen(true)}>Receive a stage transfer…</Button>
          </div>
        )}
        {views.length ? (
          <ul className="upgrade-stage-list">
            {views.map((s) => {
              const [state, text] = CONTENT_STATE_TEXT[s.content?.state] || ["NOT_CHECKED", s.content?.state || "unknown"];
              return (
                <li key={s.id}>
                  <button type="button" className={`select-card${selected === s.id ? " selected" : ""}`} aria-pressed={selected === s.id} onClick={() => setSelected(s.id)}>
                    <span className="card-title">Stage {s.id.slice(1)} · {s.release}</span>
                    <span className="mirroring-profile-meta">OpenShift {s.minor}{s.operatorsSelected ? ` · ${s.operatorsSelected} operator(s)` : ""}</span>
                    <span className="upgrade-badge" data-state={state}>{text}</span>
                    <span className="mirroring-profile-meta">Cluster: {s.clusterUpdated === "attested" ? `updated to ${s.release} (your statement)` : "not recorded as updated"}</span>
                    <span className="select-card-check" aria-hidden="true">✓ Open</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {!received && plan.stages.length ? <SequenceCard plan={plan} onDone={() => { onPlanChanged(null); loadProfiles(); }} /> : null}

      {view ? (
        <section className="card" aria-labelledby={`upgrade-stage-detail-${plan.id}`}>
          <h3 id={`upgrade-stage-detail-${plan.id}`}>Stage {view.id.slice(1)}: {view.release}</h3>
          <p className="subtle">Required to update to {view.release}. {received ? "This stage's received transfer is loaded into your registry with disk to mirror, then checked against the registry." : "Mirror to disk if this server cannot reach the disconnected registry (then prepare a transfer); mirror to mirror if it can."}</p>
          <StageProgress view={view} />
          <label className="switch-row">
            <input type="checkbox" checked={view.clusterUpdated === "attested"} onChange={async (e) => onPlanChanged(await setClusterProgress(plan.id, view.id, e.target.checked ? "attested" : "none"))} />
            <span>I have updated the cluster to {view.release} (recorded as your statement; Architect never infers this from mirroring).</span>
          </label>
          {!profile ? (
            <p className="subtle">{received ? "No transfer for this stage has been received on this server yet." : "Prepare the stages to create this stage's profile."}</p>
          ) : (
            <>
              {!received && !profile.content?.operators ? (
                <div className="actions">
                  <Button variant="secondary" onClick={async () => replaceProfile(await updateProfile(profile.id, { content: { platform: true, operators: true, additionalImages: Boolean(profile.content?.additionalImages) } }))}>Add operators to this stage ({view.minor} catalog)</Button>
                </div>
              ) : null}
              {!received && profile.content?.operators ? (
                <OperatorsSection key={`operators-${profile.id}`} profile={profile} onProfileChanged={replaceProfile} onProfilesChanged={loadProfiles} onShowOperation={onShowOperation} />
              ) : null}
              <MirroringRunPanel key={profile.id} profile={profile} onProfileChanged={replaceProfile} onProfilesChanged={() => { loadProfiles(); onPlanChanged(null); }} onShowOperation={onShowOperation} requestDestinationCheck />
            </>
          )}
        </section>
      ) : null}

      <Modal isOpen={receiveOpen} onClose={() => setReceiveOpen(false)} ariaLabelledBy={`upgrade-receive-${plan.id}`}>
        <h3 id={`upgrade-receive-${plan.id}`}>Receive a stage transfer</h3>
        <p className="modal-copy subtle">Name the folder on this server where you copied one stage&apos;s transfer (the mirror_*.tar archives, SHA256SUMS and oaa-transfer). Architect verifies every file, then links it to its stage here. {highSide ? "" : "This is normally done on the disconnected side."}</p>
        <ReceiveTransferForm idPrefix={`upgrade-receive-form-${plan.id}`} onReceived={() => { loadProfiles(); onPlanChanged(null); }} />
        <div className="actions"><Button variant="secondary" onClick={() => setReceiveOpen(false)}>Close</Button></div>
      </Modal>
    </div>
  );
}
