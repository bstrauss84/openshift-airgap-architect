import React, { useEffect, useRef, useMemo, useState } from "react";
import { apiFetch } from "../api.js";
import { useApp } from "../store.jsx";
import { validateBlueprintPullSecretOptional, validateManualOpenShiftRelease } from "../validation.js";
import SecretInput from "../components/SecretInput.jsx";
import { sortChannelsBySemverDescending, getNewestChannel } from "../shared/cincinnatiChannels.js";

const archOptions = [
  { value: "x86_64", label: "x86_64", sub: "Intel/AMD" },
  { value: "aarch64", label: "aarch64", sub: "ARM64" },
  { value: "ppc64le", label: "ppc64le", sub: "IBM Power" },
  { value: "s390x", label: "s390x", sub: "IBM Z" }
];

/** OCP 4.20 supported architectures per platform (from platform-specific install docs). */
const PLATFORM_ARCH_SUPPORT = {
  "Bare Metal":       ["x86_64", "aarch64", "ppc64le", "s390x"],
  "VMware vSphere":   ["x86_64", "aarch64"],
  "Nutanix":          ["x86_64"],
  "AWS GovCloud":     ["x86_64", "aarch64"],
  "Azure Government": ["x86_64"],
  "IBM Cloud":        ["x86_64"]
};

const platformOptions = [
  { value: "Bare Metal", label: "Bare Metal", rec: "Rec: Agent" },
  { value: "VMware vSphere", label: "VMware vSphere", rec: "Rec: IPI" },
  { value: "Nutanix", label: "Nutanix", rec: "Rec: IPI" },
  { value: "AWS GovCloud", label: "AWS GovCloud", rec: "Rec: IPI" },
  { value: "Azure Government", label: "Azure Government", rec: "Rec: IPI" },
  { value: "IBM Cloud", label: "IBM Cloud", rec: "Rec: IPI" }
];

const JOB_TERMINAL = new Set(["completed", "failed", "cancelled"]);

async function pollJobUntilTerminal(jobId, { timeoutMs = 120000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await apiFetch(`/api/jobs/${jobId}`);
    if (JOB_TERMINAL.has(job.status)) return job;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("Timed out waiting for Cincinnati refresh job.");
}

const BlueprintStep = () => {
  const { state, updateState } = useApp();
  const blueprint = state.blueprint;
  const release = state.release;
  const version = state.version || {};
  const locked = blueprint?.confirmed;
  const releaseLocked = version?.versionConfirmed ?? release?.confirmed;

  const [channels, setChannels] = useState([]);
  const [patches, setPatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [patchesLoading, setPatchesLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState("");
  const [updatedMessage, setUpdatedMessage] = useState(false);
  const [mountedSecretBadge, setMountedSecretBadge] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [manualMinor, setManualMinor] = useState("");
  const [manualPatch, setManualPatch] = useState("");
  const [manualApplyError, setManualApplyError] = useState("");
  /** Suppress automatic patch fetch for N `release.channel` effect runs (forced refresh + StrictMode). */
  const channelPatchAutoFetchSuppressRef = useRef(0);
  const prevAdvancedOpenRef = useRef(false);
  const patchFetchGenerationRef = useRef(0);
  const blueprintPullSecretRaw = state.blueprint?.blueprintPullSecretEphemeral ?? "";
  const blueprintPullSecretTrimmed = blueprintPullSecretRaw.trim();
  const blueprintPullSecretError = useMemo(() => {
    if (!blueprintPullSecretTrimmed) return "";
    const r = validateBlueprintPullSecretOptional(blueprintPullSecretTrimmed);
    return r.valid ? "" : r.error;
  }, [blueprintPullSecretTrimmed]);

  const allowedArchs = PLATFORM_ARCH_SUPPORT[blueprint?.platform] || archOptions.map((a) => a.value);

  const updateBlueprint = (patch) => {
    if (locked) return;
    updateState({ blueprint: { ...blueprint, ...patch, confirmed: false, confirmationTimestamp: null } });
  };

  // When platform changes, reset arch to x86_64 if the current selection is no longer supported.
  useEffect(() => {
    if (locked) return;
    const supported = PLATFORM_ARCH_SUPPORT[blueprint?.platform];
    if (supported && blueprint?.arch && !supported.includes(blueprint.arch)) {
      updateState({ blueprint: { ...blueprint, arch: "x86_64", confirmed: false, confirmationTimestamp: null } });
    }
  }, [blueprint?.platform]);

  // Check for a mounted Red Hat pull secret and pre-populate if the field is empty and not locked.
  useEffect(() => {
    if (locked || blueprintPullSecretTrimmed) return;
    apiFetch("/api/secrets/rh-pull-secret")
      .then((d) => {
        if (!d.available) return;
        return apiFetch("/api/secrets/rh-pull-secret/content").then((c) => {
          if (c.pullSecret) {
            updateBlueprint({ blueprintPullSecretEphemeral: c.pullSecret });
            setMountedSecretBadge(true);
          }
        });
      })
      .catch(() => {});
  }, []);

  const updateVersionSelection = (patch) => {
    updateState({
      version: {
        selectedChannel: version.selectedChannel ?? (release?.channel ? `stable-${release.channel}` : null),
        selectedVersion: version.selectedVersion ?? release?.patchVersion,
        selectionTimestamp: version.selectionTimestamp ?? Date.now(),
        confirmedByUser: false,
        confirmationTimestamp: null,
        versionConfirmed: false,
        ...patch
      },
      operators: {
        ...state.operators,
        stale: true
      }
    });
  };

  useEffect(() => {
    setLoading(true);
    apiFetch("/api/cincinnati/channels")
      .then((data) => {
        setChannels(sortChannelsBySemverDescending(data.channels || []));
        if (!data.channels?.length && !releaseLocked) {
          updateState({
            release: { ...release, channel: null, patchVersion: null, confirmed: false, followLatestMinor: true }
          });
          updateVersionSelection({ selectedChannel: null, selectedVersion: null, selectionTimestamp: Date.now() });
        }
        if (!releaseLocked && !release?.channel && data.channels?.length) {
          const channel = getNewestChannel(data.channels);
          if (channel) {
            updateState({
              release: { ...release, channel, followLatestMinor: true, confirmed: false }
            });
            updateVersionSelection({ selectedChannel: `stable-${channel}`, selectedVersion: null, selectionTimestamp: Date.now() });
          }
        }
      })
      .finally(() => {
        setLoading(false);
        apiFetch("/api/cincinnati/update", { method: "POST" })
          .then((data) => {
            if (data.channels?.length) {
              setChannels(sortChannelsBySemverDescending(data.channels));
            }
          })
          .catch(() => {});
      });
  }, []);

  const fetchPatches = async (channel, force = false) => {
    if (!channel) return;
    if (force && channel !== release?.channel) {
      channelPatchAutoFetchSuppressRef.current = 1;
    }
    const gen = ++patchFetchGenerationRef.current;
    setPatchesLoading(true);
    setPatches([]);
    const endpoint = force ? "/api/cincinnati/patches/update" : "/api/cincinnati/patches";
    try {
      const data = force
        ? await apiFetch(endpoint, { method: "POST", body: JSON.stringify({ channel }) })
        : await apiFetch(`${endpoint}?channel=${encodeURIComponent(channel)}`);
      if (gen !== patchFetchGenerationRef.current) return;
      setPatches(data.versions || []);
      if (releaseLocked) {
        return;
      }
      if (data.versions?.length) {
        const patchVersion = data.versions[0];
        updateState({ release: { ...release, channel, patchVersion, confirmed: false } });
        updateVersionSelection({
          selectedChannel: `stable-${channel}`,
          selectedVersion: patchVersion,
          selectionTimestamp: Date.now()
        });
      } else {
        updateState({ release: { ...release, channel, patchVersion: null, confirmed: false } });
        updateVersionSelection({
          selectedChannel: `stable-${channel}`,
          selectedVersion: null,
          selectionTimestamp: Date.now()
        });
      }
    } finally {
      setPatchesLoading(false);
    }
  };

  useEffect(() => {
    if (!release?.channel) return;
    if (channelPatchAutoFetchSuppressRef.current > 0) {
      channelPatchAutoFetchSuppressRef.current -= 1;
      return;
    }
    fetchPatches(release.channel).catch(() => setPatchesLoading(false));
  }, [release?.channel]);

  useEffect(() => {
    const wasOpen = prevAdvancedOpenRef.current;
    if (advancedOpen && !wasOpen) {
      setManualMinor(String(release?.channel ?? ""));
      setManualPatch(String(release?.patchVersion ?? ""));
    }
    prevAdvancedOpenRef.current = advancedOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seed when the panel opens; release is read from the render that opened it.
  }, [advancedOpen]);

  const updateChannel = (channel) => {
    if (releaseLocked) return;
    updateState({
      release: { ...release, channel, patchVersion: null, confirmed: false, followLatestMinor: false }
    });
    updateVersionSelection({ selectedChannel: `stable-${channel}`, selectedVersion: null, selectionTimestamp: Date.now() });
  };

  const updatePatch = (patchVersion) => {
    if (releaseLocked) return;
    updateState({ release: { ...release, patchVersion, confirmed: false } });
    updateVersionSelection({ selectedChannel: `stable-${release.channel}`, selectedVersion: patchVersion, selectionTimestamp: Date.now() });
  };

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError("");
    setRefreshNote("Queuing Cincinnati refresh…");
    try {
      const { jobId } = await apiFetch("/api/cincinnati/refresh-job", {
        method: "POST",
        body: JSON.stringify({ preferredChannel: release?.channel || null })
      });
      setRefreshNote("Refresh running—Operations shows live progress…");
      const job = await pollJobUntilTerminal(jobId);
      if (job.status !== "completed") {
        const outLines = job.output ? String(job.output).trim().split("\n").filter(Boolean) : [];
        const msg =
          (job.message && String(job.message).trim()) ||
          outLines[outLines.length - 1] ||
          "Cincinnati refresh failed.";
        setRefreshError(String(msg));
        updateState({ ui: { ...(state.ui || {}), highlightJobId: jobId } });
        return;
      }
      const chRes = await apiFetch("/api/cincinnati/channels");
      const newChannels = sortChannelsBySemverDescending(chRes.channels || []);
      setChannels(newChannels);
      if (newChannels.length === 0) {
        setUpdatedMessage(true);
        setTimeout(() => setUpdatedMessage(false), 5000);
        return;
      }
      const newestChannel = getNewestChannel(newChannels);
      const followLatest = release?.followLatestMinor === true;
      let channelToLoad;
      if (releaseLocked) {
        channelToLoad = release?.channel || newestChannel;
      } else if (followLatest) {
        channelToLoad = newestChannel;
      } else {
        const cur = release?.channel;
        channelToLoad = cur && newChannels.includes(cur) ? cur : newestChannel;
      }
      await fetchPatches(channelToLoad, false);
      setUpdatedMessage(true);
      setTimeout(() => setUpdatedMessage(false), 5000);
    } catch (e) {
      setPatchesLoading(false);
      setRefreshError(e?.message || String(e));
    } finally {
      setRefreshNote("");
      setRefreshing(false);
    }
  };

  const applyManualRelease = () => {
    setManualApplyError("");
    const r = validateManualOpenShiftRelease(manualMinor, manualPatch);
    if (!r.ok) {
      setManualApplyError(r.errors[0]);
      return;
    }
    const minor = manualMinor.trim();
    const patch = manualPatch.trim();
    if (minor !== (release?.channel || "")) {
      channelPatchAutoFetchSuppressRef.current = 2;
      patchFetchGenerationRef.current += 1;
    }
    updateState({
      release: { ...release, channel: minor, patchVersion: patch, confirmed: false, followLatestMinor: false },
      operators: { ...state.operators, stale: true }
    });
    updateVersionSelection({
      selectedChannel: `stable-${minor}`,
      selectedVersion: patch,
      selectionTimestamp: Date.now()
    });
    setPatches([patch]);
    setRefreshError("");
  };

  return (
    <div className="step">
      <div className="step-header">
        <div className="step-header-main">
          <h2>Foundational selections</h2>
          <p className="subtle">Set target platform, architecture, and OpenShift release. These choices drive downstream steps.</p>
        </div>
      </div>

      <div className="step-body">
        {locked ? (
          <div className="note warning" style={{ marginBottom: 16 }}>
            Foundational selections are locked. Use Start Over to change platform, architecture, or release.
          </div>
        ) : null}
        <section className="card">
          <h3>Target Platform</h3>
          <div className="grid">
            {platformOptions.map((option) => (
              <button
                key={option.value}
                className={`select-card ${blueprint?.platform === option.value ? "selected" : ""}`}
                disabled={locked}
                onClick={() => updateBlueprint({ platform: option.value })}
              >
                <div className="card-title">{option.label}</div>
                <div className="card-sub">{option.rec}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="card">
          <h3>CPU Architecture</h3>
          <p className="card-subtitle" style={{ marginTop: 4, marginBottom: 12 }}>
            Target cluster host/node architecture (the machines that will run OpenShift). Not your local workstation or browser machine.
          </p>
          <div className="grid">
            {archOptions.map((option) => {
              const isSupported = allowedArchs.includes(option.value);
              return (
                <button
                  key={option.value}
                  className={`select-card ${blueprint?.arch === option.value ? "selected" : ""}`}
                  disabled={locked || !isSupported}
                  title={!isSupported ? `Not supported on ${blueprint?.platform || "this platform"}` : undefined}
                  onClick={() => updateBlueprint({ arch: option.value })}
                >
                  <div className="card-title">{option.label}</div>
                  <div className="card-sub">{option.sub}</div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="card">
          <div className="card-header" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>OpenShift release</h3>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <button type="button" className="ghost" onClick={refresh} disabled={releaseLocked || refreshing}>
                Update
              </button>
              <span
                className="subtle"
                style={{
                  fontSize: "0.8125rem",
                  minHeight: "1.25rem",
                  lineHeight: 1.25
                }}
              >
                {(refreshing && refreshNote) || updatedMessage
                  ? (refreshing && refreshNote ? refreshNote : "Channels updated.")
                  : "\u00A0"}
              </span>
            </div>
          </div>
          {refreshError ? (
            <div className="note" style={{ marginBottom: 12, color: "var(--danger, #c62828)" }} role="alert">
              {refreshError}
            </div>
          ) : null}
          <div className="field-grid" style={{ alignItems: "flex-end", gap: "0.5rem 1rem" }}>
            <label className="label-emphasis" style={{ minWidth: "10rem" }}>
              Minor channel
              <select
                value={release?.channel ?? ""}
                disabled={releaseLocked}
                onChange={(e) => updateChannel(e.target.value || null)}
              >
                <option value="" disabled>Select channel</option>
                {release?.channel && !channels.includes(release.channel) ? (
                  <option key={`manual-ch-${release.channel}`} value={release.channel}>
                    stable-{release.channel} (manual)
                  </option>
                ) : null}
                {channels.map((ch) => (
                  <option key={ch} value={ch}>stable-{ch}</option>
                ))}
              </select>
            </label>
            <label className="label-emphasis" style={{ minWidth: "10rem" }}>
              Patch version
              <select
                value={release?.patchVersion ?? ""}
                disabled={releaseLocked || patchesLoading || !release?.channel}
                onChange={(e) => updatePatch(e.target.value || null)}
              >
                <option value="" disabled>Select patch</option>
                {release?.patchVersion && !patches.includes(release.patchVersion) ? (
                  <option key={`manual-pv-${release.patchVersion}`} value={release.patchVersion}>
                    {release.patchVersion} (manual)
                  </option>
                ) : null}
                {patches.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>
          {loading ? <div className="loading">Loading channels…</div> : null}
          {patchesLoading && release?.channel ? <div className="loading">Loading patches…</div> : null}
          <details
            className="subtle"
            style={{ marginTop: 12, marginBottom: 8 }}
            onToggle={(e) => setAdvancedOpen(e.target.open)}
          >
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Advanced: set release manually</summary>
            <p className="note" style={{ marginTop: 10, marginBottom: 8 }}>
              Use only when Cincinnati lists are empty or wrong for your environment. Verify versions against the{" "}
              <a
                href="https://github.com/openshift/cincinnati-graph-data/tree/master/channels"
                target="_blank"
                rel="noreferrer"
              >
                openshift/cincinnati-graph-data channels
              </a>{" "}
              tree for your disconnected reality before locking the blueprint.
            </p>
            <div className="field-grid" style={{ alignItems: "flex-end", gap: "0.5rem 1rem", maxWidth: "32rem" }}>
              <label className="label-emphasis">
                Minor (e.g. 4.17)
                <input
                  type="text"
                  data-testid="blueprint-manual-minor"
                  value={manualMinor}
                  disabled={releaseLocked}
                  onChange={(e) => setManualMinor(e.target.value)}
                  placeholder="4.17"
                  autoComplete="off"
                />
              </label>
              <label className="label-emphasis">
                Patch (e.g. 4.17.12)
                <input
                  type="text"
                  data-testid="blueprint-manual-patch"
                  value={manualPatch}
                  disabled={releaseLocked}
                  onChange={(e) => setManualPatch(e.target.value)}
                  placeholder="4.17.12"
                  autoComplete="off"
                />
              </label>
              <button type="button" className="primary" data-testid="blueprint-manual-apply" onClick={applyManualRelease} disabled={releaseLocked}>
                Apply
              </button>
            </div>
            {manualApplyError ? (
              <div className="note" style={{ marginTop: 8, color: "var(--danger, #c62828)" }} role="alert">
                {manualApplyError}
              </div>
            ) : null}
          </details>
          <p className="note note-prominent">
            Operator scans are blocked until you lock these selections.
            {releaseLocked ? " Release is locked; use Start Over to change it." : ""}
          </p>
        </section>

        <section className="card pull-secret-section">
          <h3>Red Hat pull secret</h3>
          {mountedSecretBadge && blueprintPullSecretTrimmed && (
            <div style={{
              display: "inline-block",
              marginBottom: 10,
              padding: "4px 10px",
              borderRadius: 4,
              fontSize: "0.8rem",
              background: "var(--card-bg-subtle, var(--card-bg))",
              border: "1px solid var(--border-color)",
              color: "var(--text-subtle)"
            }}>
              Pre-populated from a mounted pull secret file — you can override or clear this.
            </div>
          )}
          <div className="pull-secret-layout">
            <div className="pull-secret-left">
              <SecretInput
                value={blueprintPullSecretRaw}
                onChange={(v) => {
                  if (!v.trim()) setMountedSecretBadge(false);
                  updateBlueprint({ blueprintPullSecretEphemeral: v });
                }}
                label="Pull secret (JSON)"
                labelEmphasis="Pull secret (JSON)"
                labelHint="Not stored or exported. Optional; required only if you plan to include Operators in your mirror."
                getPullSecretUrl="https://console.redhat.com/openshift/downloads#tool-pull-secret"
                errorMessage={blueprintPullSecretError || undefined}
                disabled={locked}
                placeholder="Paste, drag and drop, or upload a Red Hat pull secret"
                rows={8}
                aria-label="Red Hat pull secret JSON"
              />
            </div>
            <div className="pull-secret-right">
              <p className="note note-prominent pull-secret-helper">
                Optional. Only required if you plan to include Operators in your mirror. Used only to fetch the latest Operator catalog metadata from Red Hat. Not stored or transmitted anywhere except to authenticate those requests.
              </p>
              {blueprintPullSecretTrimmed ? (
                <div className="blueprint-retain-row" style={{ marginTop: 16, width: "max-content", maxWidth: "100%" }}>
                  <span className="credentials-mirror-label" style={{ display: "block", marginBottom: 6 }}>
                    Retain pull secret for use on subsequent pages (kept in memory only; never saved or exported).
                  </span>
                  <label className="toggle-row" style={{ display: "flex", justifyContent: "flex-start", width: "100%" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(blueprint?.blueprintRetainPullSecret)}
                      onChange={(e) => updateBlueprint({ blueprintRetainPullSecret: e.target.checked })}
                      disabled={locked}
                      aria-describedby="retain-pull-secret-desc"
                    />
                    <span id="retain-pull-secret-desc" aria-hidden="true" />
                  </label>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default BlueprintStep;
