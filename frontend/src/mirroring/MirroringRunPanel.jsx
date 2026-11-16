/**
 * OpenShift Airgap Architect - Mirroring execution (v2.2.0 M5)
 *
 * Run options, credentials for the run, the live catalog check, preflight,
 * mirror-to-disk with live log and Stop, and the profile's run history with
 * each run's immutable plan. Loaded on demand from ProfileWorkspace.
 *
 * Reused, not duplicated: the shared preflight/run services (server), the job
 * engine (GET /api/jobs/:id, POST …/stop), RunConfirmationModal,
 * OcMirrorParallelismFields, PreflightChecklist, SecretInput and the
 * mounted-secret check the Install run step uses.
 *
 * Validation follows the design system: a field's message appears after it is
 * blurred, after an attempted action, or when the server reports it.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import Modal from "../components/Modal.jsx";
import OptionRow from "../components/OptionRow.jsx";
import CollapsibleSection from "../components/CollapsibleSection.jsx";
import Switch from "../components/Switch.jsx";
import SecretInput from "../components/SecretInput.jsx";
import RunConfirmationModal from "../components/RunConfirmationModal.jsx";
import ServerFolderBrowser from "../components/ServerFolderBrowser.jsx";
import OcMirrorParallelismFields from "../components/OcMirrorParallelismFields.jsx";
import PreflightChecklist from "../components/PreflightChecklist.jsx";
import { apiFetch } from "../api.js";
import { isWithinCliLimit } from "../../../shared/ocMirrorCliLimits.js";
import { useJobWatch } from "./useJobWatch.js";
import {
  updateProfile,
  preflightProfile,
  runProfile,
  fetchProfileRuns,
  stopJob,
  prepareTransfer,
  fetchStorage,
  chooseStorage,
  browseStorage
} from "./mirroringApi.js";
import SourceCredentialField from "./SourceCredentialField.jsx";
import DestinationCredentialsField from "./DestinationCredentialsField.jsx";
import { useSourceCredential } from "./sourceCredentialSession.js";
import { WorkflowChooser, ReceiveTransferForm, modeAvailability, AirGapSteps, airGapProgress } from "./HighSideControls.jsx";
import {
  ARCHIVE_SIZE_HINT,
  RETRY_TIMES_HINT,
  RETRY_DELAY_HINT,
  IMAGE_TIMEOUT_HINT,
  LOG_LEVEL_HINT,
  SINCE_HINT,
  DRY_RUN_DESCRIPTION,
  RUN_PULL_SECRET_HINT,
  REGISTRY_URL_HINT,
  MIRROR_SECRET_HINT,
  ISOLATE_NETWORK_DESCRIPTION,
  PREPARE_TRANSFER_DESCRIPTION,
  RECEIVE_PLANNED_TITLE,
  RECEIVE_PLANNED_EXPLANATION,
  RECEIVE_RECEIVED_EXPLANATION,
  RECEIVE_SAME_SERVER_PREFILL,
  STORAGE_HINT,
  FULL_TRANSFER_DESCRIPTION
} from "./mirroringCopy.js";

const GO_DURATION_RE = /^\d+(\.\d+)?(ns|us|µs|ms|s|m|h)$/;
const SINCE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Text option fields: how to read, check and save each one. */
const TEXT_OPTIONS = [
  {
    key: "archiveSize", label: "Archive size (GiB)", hint: ARCHIVE_SIZE_HINT, section: "options", inputMode: "numeric", placeholder: "oc-mirror default",
    parse: (t) => (t === "" ? null : /^\d+$/.test(t) ? Number(t) : NaN),
    check: (v) => (v === null || (Number.isSafeInteger(v) && v >= 1) ? "" : "Archive size must be a whole number of GiB, at least 1."),
    read: (profile) => profile.options?.archiveSize
  },
  {
    key: "retryTimes", label: "Retry times", hint: RETRY_TIMES_HINT, section: "execution", inputMode: "numeric", placeholder: "default (5)",
    parse: (t) => (t === "" ? null : /^\d+$/.test(t) ? Number(t) : NaN),
    check: (v) => (v === null || (Number.isInteger(v) && v >= 0 && v <= 10) ? "" : "Retry times must be a whole number from 0 to 10.")
  },
  {
    key: "retryDelay", label: "Retry delay", hint: RETRY_DELAY_HINT, section: "execution", placeholder: "exponential backoff",
    parse: (t) => (t === "" ? null : t),
    check: (v) => (v === null || GO_DURATION_RE.test(v) ? "" : "Use a duration such as 1s, 30s or 2m.")
  },
  {
    key: "imageTimeout", label: "Image timeout", hint: IMAGE_TIMEOUT_HINT, section: "execution", placeholder: "oc-mirror default",
    parse: (t) => (t === "" ? null : t),
    check: (v) => (v === null || GO_DURATION_RE.test(v) ? "" : "Use a duration such as 10m, 30m or 1h.")
  }
];

const readOption = (profile, opt) => (opt.read ? opt.read(profile) : profile.execution?.options?.[opt.key]);
const writeBody = (section, key, value) => (section === "options" ? { options: { [key]: value } } : { execution: { options: { [key]: value } } });

/** One text option: local text, validated on blur, saved to the profile when valid and changed. */
function TextOption({ profile, opt, attempted, onSave, idPrefix }) {
  const stored = readOption(profile, opt);
  const [text, setText] = useState(stored == null ? "" : String(stored));
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState("");
  useEffect(() => { setText(stored == null ? "" : String(stored)); }, [stored]);
  const value = opt.parse(text.trim());
  const localError = opt.check(value);
  const message = localError || serverError;
  const visible = Boolean(message) && (touched || attempted || Boolean(serverError));
  const errorId = `${idPrefix}-${opt.key}-error`;
  return (
    <div className="field-control-stack">
      <FieldLabelWithInfo label={opt.label} hint={opt.hint}>
        <input
          id={`${idPrefix}-${opt.key}`}
          type="text"
          inputMode={opt.inputMode}
          value={text}
          placeholder={opt.placeholder}
          className={visible ? "input-error" : ""}
          aria-invalid={visible ? "true" : undefined}
          aria-describedby={visible ? errorId : undefined}
          onChange={(e) => { setText(e.target.value); setServerError(""); }}
          onBlur={async () => {
            setTouched(true);
            if (localError || value === (stored ?? null)) return;
            const err = await onSave(writeBody(opt.section, opt.key, value));
            setServerError(err || "");
          }}
        />
      </FieldLabelWithInfo>
      <div className="field-control-support">
        {visible ? <span id={errorId} className="field-error" role="alert">{message}</span> : null}
      </div>
    </div>
  );
}

const STATUS_TEXT = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  completed_with_warnings: "Completed with warnings",
  failed: "Failed",
  cancelled: "Stopped"
};


const MODE_LABEL = { mirrorToDisk: "Mirror to disk", mirrorToMirror: "Mirror to mirror", diskToMirror: "Disk to mirror" };
// host[:port][/path], optionally with docker://; no spaces, no other scheme.
const REGISTRY_RE = /^(docker:\/\/)?[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._\-/]*)?$/;

/** Option B: what the receipt-time oc-mirror comparison found (the preflight shows the current one in full). */
const TOOL_IDENTITY_TEXT = {
  match: "oc-mirror: same executable as the connected side (identical bytes — not a FIPS or suitability statement).",
  different: "oc-mirror: a different executable from the connected side (often the build for this machine's RHEL version or CPU). The preflight explains how to check it.",
  "local-missing": "oc-mirror: none usable on this server when the transfer was received, so the builds were not compared.",
  "not-recorded": "oc-mirror: the transfer does not record the connected side's executable SHA-256 (older Architect); not compared.",
  "invalid-recorded": "oc-mirror: the transfer's recorded SHA-256 is malformed; not compared.",
  unknown: "oc-mirror: received before builds were compared; run the preflight to compare."
};

const formatTime = (ms) => (ms ? new Date(ms).toLocaleString() : "—");

/** Last lines of a job's output, as plain text (oc-mirror colours its log with ANSI codes). */
const tail = (output, lines = 40) => String(output || "").replace(/\x1b\[[0-9;]*m/g, "").split("\n").slice(-lines).join("\n");

export default function MirroringRunPanel({ profile, onProfileChanged, onProfilesChanged, onShowOperation = null }) {
  const idPrefix = `mirroring-run-${profile.id}`;
  const [attempted, setAttempted] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Credentials: in memory for this page only, never written to the profile.
  // The Red Hat source credential is the profile's session credential (R-UX02).
  const [mountedAvailable, setMountedAvailable] = useState(false);
  const sourceCred = useSourceCredential(profile.id, "run");

  const [dryRun, setDryRun] = useState(false);
  // One run that contains everything (a new baseline), instead of only what changed.
  const [fullBaseline, setFullBaseline] = useState(false);
  const [preflight, setPreflight] = useState(null);
  const [preflightFor, setPreflightFor] = useState(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runJobId, setRunJobId] = useState(null);
  const [runs, setRuns] = useState([]);
  const logRef = useRef(null);

  // M6: workflow and destination. Credentials stay in memory only.
  const availability = modeAvailability(profile);
  const initialMode = profile.kind === "received" ? "diskToMirror"
    : (!availability[profile.execution?.mode] && profile.execution?.mode) || "mirrorToDisk";
  const [mode, setMode] = useState(initialMode);
  const [registryUrl, setRegistryUrl] = useState(profile.execution?.registryUrl || "");
  const [registryTouched, setRegistryTouched] = useState(false);
  const [mirrorSecret, setMirrorSecret] = useState("");
  // Anonymous destination: the OKD placeholder for the destination host (as Install offers).
  const [mirrorAnonymous, setMirrorAnonymous] = useState(false);
  const [receivedPlanId, setReceivedPlanId] = useState(profile.received?.at(-1)?.planId || "");
  const [isolateNetwork, setIsolateNetwork] = useState(true);
  const [transferJobId, setTransferJobId] = useState(null);
  useEffect(() => { if (availability[mode]) setMode(initialMode); }, [profile.kind, profile.received?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setReceivedPlanId((cur) => (profile.received?.some((r) => r.planId === cur) ? cur : profile.received?.at(-1)?.planId || "")); }, [profile.received]);
  const needsRegistry = mode !== "mirrorToDisk";
  const registryError = needsRegistry
    ? (!registryUrl.trim() ? "The destination registry is required for this workflow." : REGISTRY_RE.test(registryUrl.trim()) ? "" : "Use host[:port][/path], for example mirror.example.com:8443/ocp.")
    : "";
  const registryErrorVisible = Boolean(registryError) && (registryTouched || attempted);

  useEffect(() => {
    apiFetch("/api/secrets/rh-pull-secret").then((d) => setMountedAvailable(Boolean(d?.available))).catch(() => {});
  }, []);

  const credentialBody = useCallback(() => (sourceCred.mounted && !mountedAvailable ? { rhAuthSource: "inline" } : sourceCred.body), [sourceCred.body, sourceCred.mounted, mountedAvailable]);

  const loadRuns = useCallback(async () => {
    try {
      const data = await fetchProfileRuns(profile.id);
      setRuns(data.runs || []);
      // Reattach to work still running for this profile (after a reload, or
      // when returning to the profile). The job engine is the source of truth.
      const running = (data.runs || []).find((r) => r.status === "running" || r.status === "queued");
      if (running) setRunJobId((cur) => cur || running.jobId);
    } catch (e) {
      setActionError(`This profile's runs could not be read: ${e.message || String(e)}`);
    }
  }, [profile.id]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const save = async (body) => {
    setSaveError("");
    try {
      onProfileChanged(await updateProfile(profile.id, body));
      return "";
    } catch (e) {
      const detail = e?.payload?.details?.[0]?.message;
      setSaveError(detail ? "" : (e.message || String(e)));
      return detail || e.message || "Could not be saved.";
    }
  };

  /** The destination changed from the credentials (Help me generate / "Use … as the destination"): same rules as typing it. */
  const chooseDestination = (url) => {
    setRegistryUrl(url);
    setRegistryTouched(true);
    if (REGISTRY_RE.test(url) && url !== (profile.execution?.registryUrl || "")) save({ execution: { registryUrl: url } });
  };

  /** What preflight and run send for the chosen workflow (credentials for this request only). */
  const runBody = () => ({
    mode,
    dryRun,
    ...(mode === "mirrorToDisk" && fullBaseline ? { fullBaseline: true } : {}),
    ...(mode !== "diskToMirror" ? credentialBody() : {}),
    ...(needsRegistry ? { registryUrl: registryUrl.trim(), mirrorAuthSource: "inline", ...(mirrorSecret.trim() ? { mirrorPullSecret: mirrorSecret.trim() } : {}) } : {}),
    ...(mode === "diskToMirror" ? { receivedPlanId: receivedPlanId || undefined, isolateNetwork } : {})
  });

  // A preflight describes one state of the profile and credentials; any change makes it stale.
  // A finished Live catalog check (in Operators) changes what the preflight reports.
  const checkFingerprint = (profile.operators?.selected || []).map((o) => o.verification?.checkedAt || 0).join(",");
  const stateKey = `${checkFingerprint}|${profile.updatedAt}|${sourceCred.mounted}|${sourceCred.secret.length}|${mirrorAnonymous}|${dryRun}|${mode}|${registryUrl.trim()}|${mirrorSecret.trim().length}|${receivedPlanId}|${isolateNetwork}|${fullBaseline}`;
  const preflightCurrent = preflight && preflightFor === stateKey;

  const runPreflight = async () => {
    setAttempted(true);
    setActionError("");
    setPreflightLoading(true);
    try {
      const result = await preflightProfile(profile.id, runBody());
      setPreflight(result);
      setPreflightFor(stateKey);
    } catch (e) {
      setPreflight(null);
      setActionError(e.message || String(e));
    } finally {
      setPreflightLoading(false);
    }
  };

  const startRun = async () => {
    setConfirmOpen(false);
    setActionError("");
    try {
      const { jobId } = await runProfile(profile.id, runBody());
      setRunJobId(jobId);
      loadRuns();
    } catch (e) {
      setActionError(e.message || String(e));
    }
  };

  const run = useJobWatch(runJobId, {
    onSettled: () => {
      loadRuns();
      onProfilesChanged?.();
    }
  });
  const running = Boolean(runJobId) && !run.settled;


  const transfer = useJobWatch(transferJobId, { onSettled: () => onProfilesChanged?.() });
  const preparing = Boolean(transferJobId) && !transfer.settled;
  const [prepareRunId, setPrepareRunId] = useState(null);
  const [ackOpen, setAckOpen] = useState(false);
  const [sameReceiveOpen, setSameReceiveOpen] = useState(false);
  const transferMeta = transfer.job?.metadata_json ? JSON.parse(transfer.job.metadata_json) : {};
  const notPinned = transfer.job?.status === "failed" && transferMeta.code === "CATALOG_NOT_PINNED";
  const startPrepare = async (jobId, { acknowledgeUnpinned = false } = {}) => {
    setActionError("");
    setAckOpen(false);
    setPrepareRunId(jobId);
    try {
      const { jobId: id } = await prepareTransfer(profile.id, jobId, { acknowledgeUnpinned });
      setTransferJobId(id);
    } catch (e) {
      setActionError(e.message || String(e));
    }
  };
  // Only the latest completed, real mirror to disk still has its archives.
  const latestRealM2d = runs.find((r) => r.mode === "mirrorToDisk" && !r.dryRun && !r.retryOf && r.plan && !["failed", "cancelled"].includes(r.status));


  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [run.job?.output]);



  // Platform and operator content come from Red Hat registries; additional
  // images alone may come from anywhere, anonymously (the server applies the same rule).
  const needsRedHat = Boolean(profile.content.platform || profile.content.operators);
  const confirmConfig = useMemo(() => ({
    mode,
    dryRun,
    archivePath: mode === "diskToMirror" && receivedPlanId ? `${profile.paths?.receivedPath}/${receivedPlanId}` : mode === "mirrorToDisk" ? profile.paths?.archivePath : undefined,
    workspacePath: mode === "mirrorToMirror" ? profile.paths?.workspacePath : undefined,
    cachePath: profile.paths?.cachePath,
    registryUrl: needsRegistry ? registryUrl.trim() : undefined,
    configSourceType: "generated",
    advanced: profile.execution?.options || {}
  }), [dryRun, profile, mode, receivedPlanId, needsRegistry, registryUrl]);

  const canRun = preflightCurrent && preflight.ok && !running && !registryError;
  const received = profile.kind === "received";
  // Said where the fields are, so switching the workflow shows at once what this run needs.
  const workflowNeeds = mode === "diskToMirror"
    ? "Disk to mirror needs only the destination registry and its credentials. Nothing is pulled from the source registries, so no Red Hat pull secret."
    : mode === "mirrorToMirror"
      ? `Mirror to mirror needs ${needsRedHat ? "your Red Hat pull secret" : "credentials for any private source registry"} and the destination registry with its credentials.`
      : `Mirror to disk needs ${needsRedHat ? "your Red Hat pull secret (platform and operator content come from Red Hat registries)" : "credentials only for private source registries"}. It writes archive files on this server; no destination registry.`;
  const receivedList = profile.received?.length ? (
    <ul className="mirroring-run-history" aria-label="Received transfers">
      {[...profile.received].reverse().map((r) => (
        <li key={r.planId} className="mirroring-run-record">
          <div className="mirroring-run-record-head">
            <strong>Verified</strong>
            <span>Plan <code>{r.planId}</code></span>
            <span className="subtle">from {r.origin.profileName || r.origin.profileId} · received {formatTime(r.receivedAt)}</span>
          </div>
          <div className="subtle">{r.summary || "Content as recorded in the plan."} · {r.archives.length} archive file(s) · configuration SHA-256 <code>{r.configSha256.slice(0, 16)}…</code></div>
          {r.offlineReady === false ? <div className="note warning">Not offline-ready: oc-mirror could not pin every catalog on the low side; disk to mirror may need the source registry.</div> : null}
          {r.offlineReady === null && r.catalogIdentity === null ? <div className="subtle">Prepared before catalog identity was recorded: whether every catalog is pinned is not known.</div> : null}
          <div className={`subtle mirroring-tool-identity status-${r.toolIdentity?.status || "unknown"}`}>{TOOL_IDENTITY_TEXT[r.toolIdentity?.status] || TOOL_IDENTITY_TEXT.unknown}</div>
        </li>
      ))}
    </ul>
  ) : null;

  return (
    <>
      <section className="card" aria-labelledby={`${idPrefix}-workflow-heading`}>
        <h3 id={`${idPrefix}-workflow-heading`}>Choose the mirroring workflow</h3>
        <p className="subtle mirroring-card-subtitle">What this run does. The credentials, options and transfer steps below follow your choice.</p>
        <div className="card-body">
          <AirGapSteps
            idPrefix={idPrefix}
            done={airGapProgress(profile, { completedM2d: Boolean(latestRealM2d && ["completed", "completed_with_warnings"].includes(latestRealM2d.status)) })}
          />
          <WorkflowChooser profile={profile} mode={mode} onChange={setMode} disabled={running} idPrefix={idPrefix} />
          {!received && !profile.received?.length ? (
            <p className="subtle mirroring-same-architect">
              Using this same Architect on the disconnected side (for example on a laptop you carry across)?{" "}
              <Button variant="secondary" className="mini" onClick={() => setSameReceiveOpen(true)} disabled={running}>Receive a transfer here…</Button>
            </p>
          ) : null}
        </div>
      </section>

      <section className="card" aria-labelledby={`${idPrefix}-credentials-heading`}>
        <h3 id={`${idPrefix}-credentials-heading`}>{needsRegistry ? "Credentials and destination for this run" : "Credentials for this run"}</h3>
        <p className="subtle mirroring-card-subtitle">Used for the catalog check, preflight and run on this page only. Never saved in the profile, its plans or its history.</p>
        <div className="card-body">
          <p className="note mirroring-needs" role="status" aria-live="polite">{workflowNeeds}</p>
          {mode === "diskToMirror" ? (
            <p className="note subtle">Disk to mirror pulls nothing from the source registries, so no Red Hat pull secret is needed. Provide the destination registry&apos;s credentials below.</p>
          ) : null}
          {mode !== "diskToMirror" ? (
            <SourceCredentialField
              profileId={profile.id}
              site="run"
              idPrefix={idPrefix}
              label={needsRedHat ? "Red Hat pull secret" : "Pull secret (optional)"}
              hint={RUN_PULL_SECRET_HINT}
              mountedAvailable={mountedAvailable}
            />
          ) : null}
          {/* The push target first: it is needed even for anonymous access, and the credentials below are checked against it. */}
          {needsRegistry ? (
            <div className="mirroring-options-grid">
              <div className="field-control-stack">
                <FieldLabelWithInfo label="Destination registry" hint={REGISTRY_URL_HINT}>
                  <input
                    id={`${idPrefix}-registry`}
                    type="text"
                    value={registryUrl}
                    placeholder="mirror.example.com:8443/ocp"
                    className={registryErrorVisible ? "input-error" : ""}
                    aria-invalid={registryErrorVisible ? "true" : undefined}
                    aria-describedby={registryErrorVisible ? `${idPrefix}-registry-error` : undefined}
                    onChange={(e) => setRegistryUrl(e.target.value)}
                    disabled={running}
                    onBlur={() => {
                      setRegistryTouched(true);
                      if (!registryError && registryUrl.trim() !== (profile.execution?.registryUrl || "")) save({ execution: { registryUrl: registryUrl.trim() } });
                    }}
                  />
                </FieldLabelWithInfo>
                <div className="field-control-support">
                  {registryErrorVisible ? <span id={`${idPrefix}-registry-error`} className="field-error" role="alert">{registryError}</span> : null}
                </div>
              </div>
            </div>
          ) : null}
          {needsRegistry ? (
            <DestinationCredentialsField
              idPrefix={idPrefix}
              registryUrl={registryUrl}
              value={mirrorSecret}
              onChange={setMirrorSecret}
              anonymous={mirrorAnonymous}
              onAnonymousChange={setMirrorAnonymous}
              onDestinationChange={chooseDestination}
              hint={MIRROR_SECRET_HINT}
              disabled={running}
            />
          ) : null}
        </div>
      </section>

      <section className="card" aria-labelledby={`${idPrefix}-options-heading`}>
        <h3 id={`${idPrefix}-options-heading`}>Storage and run options</h3>
        <p className="subtle mirroring-card-subtitle">Where this profile&apos;s content is written, and options saved with the profile for each of its runs. Empty fields use oc-mirror&apos;s own defaults.</p>
        <div className="card-body">
          <StorageSummary profile={profile} idPrefix={idPrefix} onProfileChanged={onProfileChanged} />
          {saveError ? <Banner variant="error">{saveError}</Banner> : null}
          <div className="mirroring-options-grid">
            {!received ? <TextOption profile={profile} opt={TEXT_OPTIONS[0]} attempted={attempted} onSave={save} idPrefix={idPrefix} /> : null}
            <OcMirrorParallelismFields
              idPrefix={idPrefix}
              values={{ parallelImages: profile.execution?.options?.parallelImages, parallelLayers: profile.execution?.options?.parallelLayers }}
              // A profile stores only values oc-mirror accepts (the server refuses the
              // rest); an out-of-range number stays on screen with its message.
              onCommit={(key, value) => (isWithinCliLimit(key, value) ? save({ execution: { options: { [key]: value } } }) : null)}
              attempted={attempted}
              serverErrors={preflight?.fieldErrors || {}}
            />
            {TEXT_OPTIONS.slice(1).map((opt) => <TextOption key={opt.key} profile={profile} opt={opt} attempted={attempted} onSave={save} idPrefix={idPrefix} />)}
            <div className="field-control-stack">
              <FieldLabelWithInfo label="Log level" hint={LOG_LEVEL_HINT}>
                <select
                  id={`${idPrefix}-logLevel`}
                  className="control-enum"
                  value={profile.execution?.options?.logLevel || ""}
                  onChange={(e) => save({ execution: { options: { logLevel: e.target.value || null } } })}
                >
                  <option value="">info (default)</option>
                  <option value="debug">debug</option>
                </select>
              </FieldLabelWithInfo>
            </div>
            {!received ? <SinceField profile={profile} attempted={attempted} onSave={save} idPrefix={idPrefix} /> : null}
          </div>
        </div>
      </section>

      {mode === "diskToMirror" ? (
        <section className="card" aria-labelledby={`${idPrefix}-receive-heading`}>
          <h3 id={`${idPrefix}-receive-heading`}>Received transfers</h3>
          <p className="subtle mirroring-card-subtitle">Disk to mirror loads only a transfer that was received here: every file checked against the list made on the connected side. {RECEIVE_RECEIVED_EXPLANATION}</p>
          <div className="card-body">
            {profile.received?.length ? (
              <div className="mirroring-options-grid">
                <div className="field-control-stack">
                  <FieldLabelWithInfo label="Received transfer" hint={`The verified transfer this run loads. Each is a mirror-to-disk run of the low-side profile, received and copied into this profile.

**What runs:**
The configuration recorded with that low-side run, byte for byte (its SHA-256 is shown in the preflight). Nothing is regenerated from the profile.

**Example:**
The latest transfer is chosen by default. Load transfers in the order they were made on the connected side.

**Important notes:**
• ⚠️ A received copy that changed on disk after it was verified is refused.
• ⚠️ Loading an older transfer after a newer one rolls the registry's operator catalogs back to the older content, and oc-mirror still reports success; the preflight warns when that would happen.`}>
                    <select id={`${idPrefix}-received`} value={receivedPlanId} onChange={(e) => setReceivedPlanId(e.target.value)}>
                      {[...profile.received].reverse().map((r) => (
                        <option key={r.planId} value={r.planId}>{r.planId} — {r.origin.profileName || r.origin.profileId}, received {formatTime(r.receivedAt)}</option>
                      ))}
                    </select>
                  </FieldLabelWithInfo>
                </div>
              </div>
            ) : null}
            <ReceiveTransferForm idPrefix={idPrefix} currentProfileId={profile.id} onReceived={() => onProfilesChanged?.()} />
            {receivedList}
          </div>
        </section>
      ) : null}

      <section className="card" aria-labelledby={`${idPrefix}-run-heading`}>
        <h3 id={`${idPrefix}-run-heading`}>Preflight and run</h3>
        <p className="subtle mirroring-card-subtitle">
          Run the preflight, then {MODE_LABEL[mode].toLowerCase()}. Every run uses this profile&apos;s own archive, workspace and cache; one oc-mirror run at a time on this server.
        </p>
        <div className="card-body">
          {actionError ? <Banner variant="error">{actionError}</Banner> : null}
          {mode === "diskToMirror" ? (
            <OptionRow title="Confine the network to the destination registry" description={ISOLATE_NETWORK_DESCRIPTION}>
              <Switch checked={isolateNetwork} onChange={setIsolateNetwork} aria-label="Confine the network to the destination registry" disabled={running} />
            </OptionRow>
          ) : null}
          {mode === "mirrorToDisk" && !received ? (
            <OptionRow title="Full transfer (everything, not only what changed)" description={FULL_TRANSFER_DESCRIPTION}>
              <Switch checked={fullBaseline} onChange={setFullBaseline} aria-label="Full transfer" disabled={running} />
            </OptionRow>
          ) : null}
          <OptionRow title="Dry run (no images copied)" description={DRY_RUN_DESCRIPTION}>
            <Switch checked={dryRun} onChange={setDryRun} aria-label="Dry run" disabled={running} />
          </OptionRow>
          <div className="actions">
            <Button variant="secondary" onClick={runPreflight} disabled={preflightLoading || running}>{preflightLoading ? "Running preflight…" : "Run preflight"}</Button>
            <Button variant="primary" onClick={() => setConfirmOpen(true)} disabled={!canRun}>{running ? "Running…" : dryRun ? "Start dry run" : MODE_LABEL[mode]}</Button>
            {running ? <Button variant="destructive" onClick={() => stopJob(runJobId).catch((e) => setActionError(e.message || String(e)))}>Stop</Button> : null}
          </div>
          {!preflightCurrent && preflight ? <p className="note subtle">The profile or credentials changed after the last preflight. Run it again before mirroring.</p> : null}
          {!preflight && !running ? <p className="note subtle">Run the preflight first; mirroring starts only when nothing blocks it.</p> : null}
          {preflightCurrent ? <PreflightChecklist items={preflight.items || []} ok={Boolean(preflight.ok)} /> : null}
          {runJobId ? (
            <div className="mirroring-run-live">
              <p role="status" className="mirroring-run-status">
                <strong>{run.gone ? "Run no longer known to the server" : STATUS_TEXT[run.job?.status] || "Starting"}</strong>
                {run.job?.message ? ` — ${run.job.message}` : ""}
              </p>
              <pre ref={logRef} className="mirroring-run-log" aria-label="oc-mirror output (latest lines)" tabIndex={0}>{tail(run.job?.output) || "Waiting for output…"}</pre>
              {onShowOperation ? (
                <div className="actions">
                  <Button variant="secondary" className="mini" onClick={() => onShowOperation(runJobId)}>Full output and details</Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {mode === "mirrorToDisk" && !received ? (
        <section className="card" aria-labelledby={`${idPrefix}-prepare-heading`}>
          <h3 id={`${idPrefix}-prepare-heading`}>Prepare the transfer</h3>
          <p className="subtle mirroring-card-subtitle">{PREPARE_TRANSFER_DESCRIPTION}</p>
          <div className="card-body">
            {transferJobId && !notPinned ? <p className={`note ${transfer.job?.status === "completed_with_warnings" || transfer.job?.status === "failed" ? "warning" : "subtle"}`} role="status">{transfer.job?.message || "Preparing the transfer…"}</p> : null}
            {notPinned ? (
              <div className="note warning" role="alert">
                <strong>Transfer not prepared.</strong> oc-mirror left {(transferMeta.unpinnedCatalogs || []).join(", ") || "a catalog"} as a tag instead of pinning it to a digest during this run. A transfer made from it may need the source registry on the disconnected side — the failure reproduced for DOC-155. Run mirror to disk again (recommended), or prepare it anyway as not offline-ready.
                <div className="actions">
                  <Button variant="secondary" className="mini" onClick={() => setAckOpen(true)} disabled={preparing || running}>Prepare anyway…</Button>
                </div>
              </div>
            ) : null}
            {!latestRealM2d ? (
              <p className="note subtle">Nothing to prepare yet. After a completed mirror to disk (not a dry run), its archive files are packaged here for the trip.</p>
            ) : (
              <div className="mirroring-run-record-plan">
                {(() => {
                  const t = profile.transfers?.find((x) => x.jobId === latestRealM2d.jobId);
                  if (!t) return <span>Mirror to disk of {formatTime(latestRealM2d.startedAt || latestRealM2d.createdAt)} ({STATUS_TEXT[latestRealM2d.status] || latestRealM2d.status}) is ready to prepare.</span>;
                  return t.offlineReady === false
                    ? <span><strong>Transfer ready — not offline-ready</strong> in <code>{t.transferDir || profile.paths?.archivePath}</code>: oc-mirror could not pin every catalog. Prefer a new mirror to disk.</span>
                    : <span><strong>Transfer ready{t.cycleKind === "full" ? " (full)" : t.cycleKind === "delta" ? " (changes since the previous transfer)" : ""}</strong> in <code>{t.transferDir || profile.paths?.archivePath}</code>. Next: copy mirror_*.tar, SHA256SUMS and oaa-transfer/ to your drive or share and receive them on the disconnected side — in the order they were made.</span>;
                })()}
                <Button variant="secondary" className="mini" onClick={() => startPrepare(latestRealM2d.jobId)} disabled={preparing || running}>
                  {preparing ? "Preparing…" : profile.transfers?.some((t) => t.jobId === latestRealM2d.jobId) ? "Prepare again" : "Prepare transfer"}
                </Button>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {(() => {
        const [intro, how, ...rest] = RECEIVE_PLANNED_EXPLANATION;
        const steps = rest.filter((l) => /^\d+\. /.test(l));
        const outro = rest.filter((l) => !/^\d+\. /.test(l));
        return (
          <Modal isOpen={sameReceiveOpen} onClose={() => setSameReceiveOpen(false)} ariaLabelledBy={`${idPrefix}-same-receive-title`}>
            <h3 id={`${idPrefix}-same-receive-title`}>{RECEIVE_PLANNED_TITLE}</h3>
            <div className="mirroring-receive-explain modal-copy">
              <p>{intro}</p>
              <p><strong>{how}</strong></p>
              <ol>{steps.map((l) => <li key={l}>{l.replace(/^\d+\. /, "")}</li>)}</ol>
              {outro.map((l) => <p key={l} className="subtle">{l}</p>)}
            </div>
            <ReceiveTransferForm
              idPrefix={`${idPrefix}-same`}
              currentProfileId={profile.id}
              onReceived={() => onProfilesChanged?.()}
              suggestion={profile.transfers?.length ? { text: RECEIVE_SAME_SERVER_PREFILL, dir: profile.transfers.at(-1).transferDir || profile.paths?.archivePath } : null}
            />
            <div className="actions">
              <Button variant="secondary" onClick={() => setSameReceiveOpen(false)}>Close</Button>
            </div>
          </Modal>
        );
      })()}

      <RunConfirmationModal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} onConfirm={startRun} config={confirmConfig} />

      <Modal isOpen={ackOpen} onClose={() => setAckOpen(false)} ariaLabelledBy={`${idPrefix}-ack-title`}>
        <h3 id={`${idPrefix}-ack-title`}>Prepare a transfer that is not offline-ready?</h3>
        <p className="modal-copy">
          oc-mirror could not pin {(transferMeta.unpinnedCatalogs || []).join(", ") || "a catalog"} to a digest. If that catalog changed while oc-mirror was collecting it,
          disk to mirror will look for it in the source registry — which the disconnected side cannot reach — and fail there.
        </p>
        <p className="modal-copy subtle">The transfer manifest, its README and the disconnected side's preflight will all say "not offline-ready".</p>
        <div className="actions">
          <Button variant="secondary" onClick={() => setAckOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => startPrepare(prepareRunId, { acknowledgeUnpinned: true })}>Prepare anyway (not offline-ready)</Button>
        </div>
      </Modal>

    </>
  );
}

/** --since as a native date input (yyyy-MM-dd, the format oc-mirror documents). */
function SinceField({ profile, attempted, onSave, idPrefix }) {
  const stored = profile.execution?.options?.since || "";
  const [text, setText] = useState(stored);
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState("");
  useEffect(() => { setText(stored); }, [stored]);
  const localError = text && !SINCE_RE.test(text) ? "Use a date as yyyy-MM-dd, for example 2026-01-31." : "";
  const message = localError || serverError;
  const visible = Boolean(message) && (touched || attempted || Boolean(serverError));
  const errorId = `${idPrefix}-since-error`;
  return (
    <div className="field-control-stack">
      <FieldLabelWithInfo label="Since (incremental)" hint={SINCE_HINT}>
        <input
          id={`${idPrefix}-since`}
          type="date"
          value={text}
          className={visible ? "input-error" : ""}
          aria-invalid={visible ? "true" : undefined}
          aria-describedby={visible ? errorId : undefined}
          onChange={(e) => { setText(e.target.value); setServerError(""); }}
          onBlur={async () => {
            setTouched(true);
            if (localError || text === stored) return;
            const err = await onSave({ execution: { options: { since: text || null } } });
            setServerError(err || "");
          }}
        />
      </FieldLabelWithInfo>
      <div className="field-control-support">
        {visible ? <span id={errorId} className="field-error" role="alert">{message}</span> : null}
      </div>
    </div>
  );
}

/**
 * Where this profile's content is written (container paths), whether the
 * server's user can use it, and how much room is left. Read from the server;
 * nothing here changes storage.
 */
function StorageSummary({ profile, idPrefix, onProfileChanged }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [choiceError, setChoiceError] = useState("");
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState("");
  const [touched, setTouched] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchStorage(profile.id)
      .then((d) => { if (!cancelled) { setInfo(d); setError(""); setDraft(d?.profile?.base || ""); } })
      .catch((e) => {
        if (cancelled) return;
        // A proxy or an older server can answer with an HTML page; never show its markup.
        const msg = e.message || String(e);
        setError(/^\s*</.test(msg) ? `the server did not return storage details${e.status ? ` (HTTP ${e.status})` : ""}. If the backend was just updated, restart it.` : msg);
      });
    return () => { cancelled = true; };
  }, [profile.id, profile.updatedAt]);
  const p = info?.profile;
  const suggestions = (info?.suggestions || []).filter((r) => r.ok && r.base !== p?.base);
  const gib = (b) => (b == null ? "not reported" : `${(b / 1024 ** 3).toFixed(1)} GiB`);
  const canChoose = Boolean(p) && !p.choiceLocked;
  const localError = draft.trim() && !draft.trim().startsWith("/") ? "Use an absolute path inside the server (container), for example /mnt/mirror-data." : "";
  const shownError = choiceError || (touched ? localError : "");
  const choose = async (base) => {
    const target = String(base || "").trim();
    setTouched(true);
    setChoiceError("");
    if (!target || target === p.base || (!target.startsWith("/"))) return;
    setSaving(true);
    try {
      onProfileChanged?.(await chooseStorage(profile.id, target));
    } catch (e) {
      setChoiceError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };
  const errorId = `${idPrefix}-storage-root-error`;
  return (
    <div className="mirroring-storage" role="group" aria-label="Storage">
      {error ? <p className="note subtle">Storage details could not be loaded: {error}</p> : null}
      {p ? (
        <>
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Storage location" hint={STORAGE_HINT}>
              {canChoose ? (
                <input
                  id={`${idPrefix}-storage-root`}
                  type="text"
                  value={draft}
                  spellCheck={false}
                  autoComplete="off"
                  className={`mirroring-storage-input ${shownError ? "input-error" : ""}`.trim()}
                  aria-invalid={shownError ? "true" : undefined}
                  aria-describedby={shownError ? errorId : undefined}
                  onChange={(e) => { setDraft(e.target.value); setChoiceError(""); }}
                  onBlur={() => setTouched(true)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); choose(draft); } }}
                  disabled={saving}
                />
              ) : (
                <span id={`${idPrefix}-storage-root`} className="mirroring-storage-current"><code>{p.base}</code></span>
              )}
            </FieldLabelWithInfo>
            <div className="field-control-support">
              {shownError ? <span id={errorId} className="field-error" role="alert">{shownError}</span> : null}
              <span className="subtle">
                {p.choiceLocked
                  ? `Fixed for this profile: ${p.choiceLocked} Nothing is moved; create a new profile to use another location.`
                  : "Any directory the server can write — a path inside the server (container), for example a volume you mounted at /mnt/mirror-data. It can be changed until this profile writes anything."}
              </span>
            </div>
          </div>
          {canChoose ? (
            <div className="actions mirroring-storage-actions">
              <Button variant="secondary" className="mini" onClick={() => choose(draft)} disabled={saving || !draft.trim() || draft.trim() === p.base}>{saving ? "Checking…" : "Use this location"}</Button>
              <Button variant="secondary" className="mini" onClick={() => setBrowsing(true)} disabled={saving}>Browse…</Button>
              {suggestions.map((r) => (
                <Button key={r.base} variant="secondary" className="mini" onClick={() => { setDraft(r.base); choose(r.base); }} disabled={saving}>
                  {`Use ${r.base}${r.isDataDirDefault ? " (application data)" : ""} · ${gib(r.freeBytes)} free`}
                </Button>
              ))}
            </div>
          ) : null}
          {!p.ok ? <div className="note warning" role="alert"><strong>Runs are blocked.</strong> {p.problem}</div> : null}
          {p.ok ? (
            <p className={`mirroring-storage-free ${p.freeBytes != null && p.freeBytes < 10 * 1024 ** 3 ? "note warning" : "subtle"}`}>
              {p.base}: {gib(p.freeBytes)} free of {gib(p.totalBytes)}{p.freeBytes != null && p.freeBytes < 10 * 1024 ** 3 ? " — low: a mirror can need hundreds of GiB, and oc-mirror fails part-way when the disk fills." : "."}
            </p>
          ) : null}
          <ServerFolderBrowser
            isOpen={browsing}
            onClose={() => setBrowsing(false)}
            idPrefix={`${idPrefix}-storage`}
            list={browseStorage}
            startPath={draft.trim().startsWith("/") ? draft.trim() : null}
            onSelect={(dir) => { setBrowsing(false); setDraft(dir); choose(dir); }}
          />
          <CollapsibleSection title="Paths on the server" defaultCollapsed>
            <dl className="mirroring-paths mirroring-storage-paths">
              <dt>Archives</dt><dd><code>{p.paths.archivePath}</code></dd>
              <dt>Workspace</dt><dd><code>{p.paths.workspacePath}</code></dd>
              <dt>Cache</dt><dd><code>{p.paths.cachePath}</code></dd>
              <dt>Received</dt><dd><code>{p.paths.receivedPath}</code></dd>
            </dl>
            <p className="subtle">These are paths inside the server&apos;s container. A host directory appears here where it is mounted — for example host <code>/data/mirror</code> mounted at <code>/mnt/mirror-data</code> is used as <code>/mnt/mirror-data</code>.</p>
          </CollapsibleSection>
        </>
      ) : null}
    </div>
  );
}
