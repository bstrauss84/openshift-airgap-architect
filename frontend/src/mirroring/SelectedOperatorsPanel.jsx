/**
 * OpenShift Airgap Architect - Selected operators and their Live catalog check
 * (v2.2.0, R-UX04 / R-UX06)
 *
 * Always beside the catalog browser on wide screens (and one tap away on
 * narrow ones): every selected operator as a compact row — name, catalog,
 * channel, its live-check status in words — with Remove. Below the rows, the
 * Live catalog check for exactly these operators: what it asks (not the same
 * question as Scan catalogs), the profile's session source credential, the
 * button, progress, a summary and what to do about each kind of problem. The
 * full record of every check stays in Operations.
 *
 * Statuses: verified · package not found · channel not found · no version in
 * range · needs credentials (none given) · credentials refused · could not be
 * reached / not trusted · not checked yet (added after the last check) ·
 * changed since its last check. A completed check with problems never reads
 * as success.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useEffect, useState } from "react";
import Button from "../components/Button.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import { isOperatorResolved } from "../shared/operatorMinorReconciliation.js";
import { OPERATOR_CATALOG_LABELS } from "../shared/operatorSearch.js";
import SourceCredentialField from "./SourceCredentialField.jsx";
import { useSourceCredential } from "./sourceCredentialSession.js";
import { useJobWatch } from "./useJobWatch.js";
import { verifyCatalogs, stopJob, fetchProfileRuns } from "./mirroringApi.js";
import { CATALOG_CHECK_HINT, RUN_PULL_SECRET_HINT } from "./mirroringCopy.js";

const formatTime = (ms) => (ms ? new Date(ms).toLocaleString() : "—");

/** One operator's live-check state, in words, from the profile's server-side record. */
export function checkStateOf(op, recorded) {
  if (!isOperatorResolved(op)) return { key: "unresolved", tone: "unverified", text: "Not resolved for this catalog minor yet" };
  const v = recorded?.verification;
  if (!v) return { key: "not-checked", tone: "unverified", text: "Not checked yet" };
  const stale = v.catalogImage !== op.catalogImage || v.channel !== op.defaultChannel || v.minVersion !== (op.minVersion || "") || v.maxVersion !== (op.maxVersion || "");
  if (stale) return { key: "stale", tone: "unverified", text: "Changed since its last check" };
  if (v.status === "verified") return { key: "verified", tone: "ok", text: "Verified", detail: v.message, at: v.checkedAt };
  if (v.status === "package-not-found") return { key: "package-not-found", tone: "error", text: "Not in the catalog", detail: v.message, at: v.checkedAt };
  if (v.status === "channel-not-found") return { key: "channel-not-found", tone: "error", text: "Channel not found", detail: v.message, at: v.checkedAt };
  if (v.status === "range-empty") return { key: "range-empty", tone: "warning", text: "No version in range", detail: v.message, at: v.checkedAt };
  const m = String(v.message || "");
  if (/none were given|needs credentials/.test(m)) return { key: "credentials-missing", tone: "unverified", text: "Needs credentials", detail: m, at: v.checkedAt };
  if (/refused the credentials/.test(m)) return { key: "credentials-refused", tone: "error", text: "Credentials refused", detail: m, at: v.checkedAt };
  if (/could not be reached|offline|certificate|timed? ?out|in time/.test(m)) return { key: "unreachable", tone: "unverified", text: "Could not be checked", detail: m, at: v.checkedAt };
  return { key: "unverified", tone: "unverified", text: "Not verified", detail: m, at: v.checkedAt };
}

const ACTION = {
  "package-not-found": (n) => `${n} not in the live catalog: remove ${n === 1 ? "it" : "them"} or choose another package; runs are blocked until then.`,
  "channel-not-found": (n) => `${n} with a channel the live catalog does not have: remove or change ${n === 1 ? "it" : "them"}; runs are blocked until then.`,
  "credentials-missing": (n) => `${n} not checked because no Red Hat pull secret was given: enter it above, then check again.`,
  "credentials-refused": (n) => `${n} not checked because the registry refused the pull secret: replace it, then check again.`,
  unreachable: (n) => `${n} could not be checked (registry not reachable or not trusted): see the reason on each row; on a disconnected machine check on a connected one.`,
  "not-checked": (n) => `${n} not checked yet (added after the last check): check again to include ${n === 1 ? "it" : "them"}.`,
  stale: (n) => `${n} changed since the last check: check again.`,
  "range-empty": (n) => `${n} with no version in the minimum/maximum you set: adjust the range or check the listed versions.`
};

export default function SelectedOperatorsPanel({ profile, selected, onRemove, mountedAvailable = false, onProfilesChanged = null, onShowOperation = null, catalogMinor, id }) {
  const idPrefix = `mirroring-selected-${profile.id}`;
  const cred = useSourceCredential(profile.id, "check");
  const [verifyJobId, setVerifyJobId] = useState(null);
  const [error, setError] = useState("");
  const recordedById = new Map((profile.operators?.selected || []).map((op) => [op.id, op]));
  const checkable = (profile.operators?.selected || []).filter((op) => op.catalogImage && op.defaultChannel);

  // A check that is still running (after a reload, or started before switching tabs) is followed again.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => fetchProfileRuns(profile.id)).then((d) => { if (!cancelled && d?.activeVerification) setVerifyJobId((cur) => cur || d.activeVerification.jobId); }).catch(() => {});
    return () => { cancelled = true; };
  }, [profile.id]);

  const verify = useJobWatch(verifyJobId, { onSettled: () => onProfilesChanged?.() });
  const verifying = Boolean(verifyJobId) && !verify.settled;

  const start = async () => {
    setError("");
    try {
      const { jobId } = await verifyCatalogs(profile.id, cred.mounted && !mountedAvailable ? { rhAuthSource: "inline" } : cred.body);
      setVerifyJobId(jobId);
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  const states = selected.map((op) => ({ op, state: checkStateOf(op, recordedById.get(op.id)) }));
  const counts = states.reduce((acc, { state }) => ({ ...acc, [state.key]: (acc[state.key] || 0) + 1 }), {});
  const actions = Object.keys(ACTION).filter((k) => counts[k]).map((k) => ACTION[k](counts[k]));

  return (
    <aside className="mirroring-selected-panel" aria-labelledby={`${idPrefix}-heading`} id={id}>
      <h4 id={`${idPrefix}-heading`} className="mirroring-selected-heading">Selected ({selected.length})</h4>
      {selected.length === 0 ? (
        <p className="subtle mirroring-selected-empty">None yet. Add operators from the catalog or a Quick Pick.</p>
      ) : (
        <ul className="mirroring-selected-list" aria-label="Selected operators">
          {states.map(({ op, state }) => (
            <li key={op.id} className={`mirroring-selected-row tone-${state.tone}`}>
              <div className="mirroring-selected-main">
                <span className="mirroring-selected-name">{op.displayName || op.name}</span>
                <span className="subtle mirroring-selected-meta">
                  {op.catalog ? OPERATOR_CATALOG_LABELS[op.catalog] || op.catalog : "catalog not known"} · {op.defaultChannel ? `channel ${op.defaultChannel}` : "no channel yet"}
                  {(op.sources || []).filter((s) => s !== "manual" && !String(s).startsWith("import:")).length ? " · Quick Pick" : ""}
                  {isOperatorResolved(op) && op.verifiedMinor && op.verifiedMinor === catalogMinor ? ` · in the scanned ${catalogMinor} catalogs` : ""}
                  {op.defaultChannel && (op.sources || []).some((s) => String(s).startsWith("import:")) ? " · imported channel (scan data lists default channels only)" : ""}
                </span>
                <span className={`mirroring-selected-status status-${state.key}`}>{state.text}</span>
                {state.detail && state.key !== "verified" ? <span className="subtle mirroring-selected-detail">{state.detail}{state.at ? ` (${formatTime(state.at)})` : ""}</span> : null}
              </div>
              <Button variant="secondary" className="mini" onClick={() => onRemove(op.id)} aria-label={`Remove ${op.displayName || op.name}`}>Remove</Button>
            </li>
          ))}
        </ul>
      )}

      {selected.length ? (
        <div className="mirroring-check" role="group" aria-labelledby={`${idPrefix}-check-heading`}>
          <h5 id={`${idPrefix}-check-heading`} className="mirroring-check-heading">Live catalog check</h5>
          <p className="subtle mirroring-check-explain">
            Scan catalogs lists what the OpenShift {catalogMinor || ""} catalogs offer. Check catalogs asks the live catalogs, right now,
            whether each selected package and channel exists. Runs are blocked for operators found missing; every check is kept in Operations.
          </p>
          <SourceCredentialField profileId={profile.id} site="check" idPrefix={`${idPrefix}-check`} label="Red Hat pull secret" hint={RUN_PULL_SECRET_HINT} mountedAvailable={mountedAvailable} rows={3} />
          <div className="actions mirroring-check-actions">
            <FieldLabelWithInfo label={`Check the ${checkable.length} resolved operator(s)`} hint={CATALOG_CHECK_HINT}>
              <Button variant="secondary" onClick={start} disabled={verifying || !checkable.length} aria-label={verifying ? "Checking catalogs" : "Check catalogs"}>
                {verifying ? "Checking catalogs…" : "Check catalogs"}
              </Button>
            </FieldLabelWithInfo>
            {verifying ? <Button variant="destructive" onClick={() => stopJob(verifyJobId).catch(() => {})}>Stop check</Button> : null}
            {verifyJobId && onShowOperation ? <Button variant="secondary" className="mini" onClick={() => onShowOperation(verifyJobId)}>View in Operations</Button> : null}
          </div>
          {!verifying && !cred.usable ? <p className="note subtle" role="note">Enter or accept the Red Hat pull secret first: the Red Hat catalogs refuse a check without one.</p> : null}
          {error ? <p className="note warning" role="alert">{error}</p> : null}
          {verifying ? <p className="note subtle" role="status">Checking {checkable.length} operator(s)… {verify.job?.progress ?? 0}%</p> : null}
          {verify.job && verify.settled ? <p className={`note ${verify.job.status === "completed" ? "subtle" : "warning"}`} role="status">{verify.job.message}</p> : null}
          {actions.length ? (
            <div className="note warning mirroring-check-actions-list" role="status">
              <strong>What to do</strong>
              <ul>{actions.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
          ) : counts.verified === selected.length ? <p className="note subtle" role="status">All {selected.length} selected operator(s) verified at their last check.</p> : null}
        </div>
      ) : null}
    </aside>
  );
}
