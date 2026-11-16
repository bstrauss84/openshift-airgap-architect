/**
 * OpenShift Airgap Architect - Mirroring workflows and transfer (v2.2.0 M6)
 *
 * - modeAvailability(): which oc-mirror workflows a profile can run, mirroring
 *   the server's rules (the server enforces them; this only explains them).
 * - WorkflowChooser: selection cards with aria-pressed and a written cue.
 * - ReceiveTransferForm: the high-side handoff — name a directory, every file is
 *   verified on the server, problems come back with how to fix them.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useState } from "react";
import Button from "../components/Button.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import { useJobWatch } from "./useJobWatch.js";
import { receiveTransfer } from "./mirroringApi.js";
import { WORKFLOW_HINT, TRANSFER_DIR_HINT, AIR_GAP_STEPS } from "./mirroringCopy.js";

export const WORKFLOWS = [
  { mode: "mirrorToDisk", title: "Mirror to disk", side: "Connected side", description: "Download the images into archive files in this profile's archive directory, to carry across the air gap." },
  { mode: "mirrorToMirror", title: "Mirror to mirror", side: "Reaches both sides", description: "Copy straight from the source registries into your registry. No archive files, no transfer." },
  { mode: "diskToMirror", title: "Disk to mirror", side: "Disconnected side", description: "Upload a received, verified transfer into your registry, exactly as recorded on the connected side." }
];

/** null = available; otherwise the reason it is not (same rules as the server). */
export const modeAvailability = (profile) => (profile.kind === "received"
  ? {
    mirrorToDisk: "Runs on the connected side, in the profile this transfer came from.",
    mirrorToMirror: "Needs the source registries; run it from a planned profile.",
    diskToMirror: profile.received?.length ? null : "Receive a transfer first."
  }
  : {
    mirrorToDisk: null,
    mirrorToMirror: null,
    diskToMirror: profile.received?.length ? null : "Needs a received transfer: run mirror to disk, Prepare transfer, then Receive transfer."
  });

/**
 * Where a profile is in the air-gap sequence. `done` is the number of steps
 * already behind it; the next one is marked current. Stated in words (Done /
 * Next), never by colour alone.
 */
export function airGapProgress(profile, { completedM2d = false } = {}) {
  if (profile.kind === "received" || profile.received?.length) return 4;
  if (profile.transfers?.length) return 2;
  return completedM2d ? 1 : 0;
}

export function AirGapSteps({ done, idPrefix }) {
  return (
    <div className="mirroring-steps-wrap">
      <ol className="mirroring-steps" aria-label="Mirroring across an air gap" id={`${idPrefix}-steps`}>
        {AIR_GAP_STEPS.map((step, i) => {
          const state = i < done ? "done" : i === done ? "current" : "upcoming";
          return (
            <li key={step.key} className={`mirroring-step is-${state}`} aria-current={state === "current" ? "step" : undefined}>
              <span className="mirroring-step-state">{state === "done" ? "Done" : state === "current" ? "Next" : `Step ${i + 1}`}</span>
              <span className="mirroring-step-title">{step.title}</span>
              <span className="mirroring-step-detail">{step.detail}</span>
            </li>
          );
        })}
      </ol>
      <p className="subtle mirroring-steps-note">Mirror to mirror skips all of this when one machine can reach both the source registries and your registry.</p>
    </div>
  );
}

export function WorkflowChooser({ profile, mode, onChange, disabled, idPrefix }) {
  const availability = modeAvailability(profile);
  return (
    <div className="field-control-stack">
      <FieldLabelWithInfo label="Workflow" hint={WORKFLOW_HINT}>
        <div className="mirroring-workflow-grid" role="group" aria-label="Workflow" id={`${idPrefix}-workflow`}>
          {WORKFLOWS.map((w) => {
            const reason = availability[w.mode];
            const selected = mode === w.mode;
            return (
              <button
                key={w.mode}
                type="button"
                className={`select-card ${selected ? "selected" : ""}`}
                aria-pressed={selected}
                aria-describedby={`${idPrefix}-${w.mode}-desc`}
                disabled={disabled || Boolean(reason)}
                data-workflow={w.mode}
                onClick={() => onChange(w.mode)}
              >
                <span className="card-title">{w.title}</span>
                <span className="mirroring-profile-meta">{w.side}</span>
                <span className="mirroring-workflow-desc" id={`${idPrefix}-${w.mode}-desc`}>{reason ? `Not available: ${reason}` : w.description}</span>
                <span className="select-card-check" aria-hidden="true">✓ Selected</span>
              </button>
            );
          })}
        </div>
      </FieldLabelWithInfo>
    </div>
  );
}

/**
 * High-side handoff: name the directory that holds the transfer; the server
 * verifies and copies it, then reports which profile received it.
 */
export function ReceiveTransferForm({ idPrefix, onReceived, onOpenProfile = null, currentProfileId = null, suggestion = null }) {
  const [dir, setDir] = useState("");
  const [touched, setTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [error, setError] = useState("");
  const watch = useJobWatch(jobId, { onSettled: (job) => { if (job?.status === "completed") onReceived?.(job); } });
  const busy = Boolean(jobId) && !watch.settled;
  const localError = dir.trim() ? (dir.trim().startsWith("/") ? "" : "Use an absolute path on the server, for example /data/transfer/site-a.") : "Name the directory that holds the transfer.";
  // An empty field is flagged only when the user tries to receive; a malformed
  // path is flagged as soon as the field is left.
  const visible = Boolean(localError) && (attempted || (touched && Boolean(dir.trim())));
  const errorId = `${idPrefix}-transfer-dir-error`;
  const meta = watch.job?.metadata_json ? JSON.parse(watch.job.metadata_json) : {};
  const problems = Array.isArray(meta.problems) ? meta.problems : [];

  const succeeded = watch.job?.status === "completed";
  const receiveAnother = () => { setJobId(null); setDir(""); setTouched(false); setAttempted(false); setError(""); };

  const submit = async () => {
    setAttempted(true);
    setError("");
    if (localError) return;
    try {
      const { jobId: id } = await receiveTransfer(dir.trim());
      setJobId(id);
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  if (succeeded) {
    // Keep the result on screen; the next step is the user's choice.
    const elsewhere = meta.profileId && meta.profileId !== currentProfileId;
    return (
      <div className="mirroring-receive">
        <div role="status" className="note">
          <strong>Received.</strong> {watch.job?.message || ""}
          <dl className="modal-summary mirroring-receive-result">
            {meta.profileName ? <><dt>Profile</dt><dd>{meta.profileName}</dd></> : null}
            {meta.planId ? <><dt>Plan</dt><dd><code>{meta.planId}</code></dd></> : null}
            {meta.archives ? <><dt>Verified</dt><dd>{meta.archives} archive file(s), every file checked against the manifest</dd></> : null}
            <dt>Offline-ready</dt><dd>{meta.offlineReady === true ? "Yes: every operator catalog is pinned to a digest" : meta.offlineReady === false ? "No: oc-mirror could not pin every catalog on the low side; disk to mirror may need the source registry" : "Not known: the transfer predates catalog identity records"}</dd>
            {meta.manifestSha256 ? <><dt>Manifest SHA-256</dt><dd><code>{meta.manifestSha256}</code></dd></> : null}
          </dl>
        </div>
        <div className="actions">
          {elsewhere && onOpenProfile ? (
            <Button variant="primary" onClick={() => onOpenProfile(meta)}>{`Open “${meta.profileName || "the profile"}”`}</Button>
          ) : null}
          <Button variant="secondary" onClick={receiveAnother}>Receive another transfer</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mirroring-receive">
      {suggestion && !dir ? (
        <div className="note subtle mirroring-receive-suggestion">
          {suggestion.text}{" "}
          <Button variant="secondary" className="mini" onClick={() => { setDir(suggestion.dir); setTouched(true); }} disabled={busy}>Use this profile&apos;s transfer</Button>
          <div><code>{suggestion.dir}</code></div>
        </div>
      ) : null}
      <div className="mirroring-receive-row">
        <div className="field-control-stack">
          <FieldLabelWithInfo label="Transfer directory on the server" hint={TRANSFER_DIR_HINT}>
            <input
              id={`${idPrefix}-transfer-dir`}
              type="text"
              value={dir}
              placeholder="/data/transfer/site-a"
              className={visible ? "input-error" : ""}
              aria-invalid={visible ? "true" : undefined}
              aria-describedby={visible ? errorId : undefined}
              onChange={(e) => setDir(e.target.value)}
              onBlur={() => setTouched(true)}
              disabled={busy}
            />
          </FieldLabelWithInfo>
          <div className="field-control-support">
            {visible ? <span id={errorId} className="field-error" role="alert">{localError}</span> : null}
          </div>
        </div>
        <Button variant="secondary" onClick={submit} disabled={busy}>{busy ? "Checking the transfer…" : "Verify and receive"}</Button>
      </div>
      {error ? <div className="note warning" role="alert">{error}</div> : null}
      {jobId ? (
        <div role="status" className={`note ${watch.job?.status === "failed" ? "warning" : ""}`}>
          <strong>{watch.job?.status === "failed" ? "Not received." : "Checking…"}</strong>{" "}
          {/* The job message repeats the problems; with the list shown, a lead line is enough. */}
          {problems.length ? "The transfer did not pass verification:" : watch.job?.message || ""}
          {problems.length ? (
            <>
              <ul className="mirroring-receive-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
              {meta.recovery?.length ? <p><strong>To fix:</strong> {meta.recovery.join(" ")}</p> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
