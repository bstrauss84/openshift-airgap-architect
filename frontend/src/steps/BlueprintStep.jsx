import React, { useEffect, useRef, useMemo, useState } from "react";
import { apiFetch } from "../api.js";
import { useApp } from "../store.jsx";
import { validateBlueprintPullSecretOptional } from "../validation.js";
import SecretInput from "../components/SecretInput.jsx";
import { sortChannelsBySemverDescending, getNewestChannel } from "../shared/cincinnatiChannels.js";

const archOptions = [
  { value: "x86_64", label: "x86_64", sub: "Intel/AMD" },
  { value: "aarch64", label: "aarch64", sub: "ARM64" },
  { value: "ppc64le", label: "ppc64le", sub: "IBM Power" },
  { value: "s390x", label: "s390x", sub: "IBM Z" }
];

const platformOptions = [
  { value: "Bare Metal", label: "Bare Metal", rec: "Rec: Agent" },
  { value: "VMware vSphere", label: "VMware vSphere", rec: "Rec: IPI" },
  { value: "Nutanix", label: "Nutanix", rec: "Rec: IPI" },
  { value: "AWS GovCloud", label: "AWS GovCloud", rec: "Rec: IPI" },
  { value: "Azure Government", label: "Azure Government", rec: "Rec: IPI" }
];

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
  /** After a forced patch refresh, skip the release.channel effect once so it does not overwrite POST results with a stale GET. */
  const skipChannelPatchFetchRef = useRef(false);
  const blueprintPullSecretRaw = state.blueprint?.blueprintPullSecretEphemeral ?? "";
  const blueprintPullSecretTrimmed = blueprintPullSecretRaw.trim();
  const blueprintPullSecretError = useMemo(() => {
    if (!blueprintPullSecretTrimmed) return "";
    const r = validateBlueprintPullSecretOptional(blueprintPullSecretTrimmed);
    return r.valid ? "" : r.error;
  }, [blueprintPullSecretTrimmed]);

  const updateBlueprint = (patch) => {
    if (locked) return;
    updateState({ blueprint: { ...blueprint, ...patch, confirmed: false, confirmationTimestamp: null } });
  };

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
      skipChannelPatchFetchRef.current = true;
    }
    setPatchesLoading(true);
    setPatches([]);
    const endpoint = force ? "/api/cincinnati/patches/update" : "/api/cincinnati/patches";
    const data = force
      ? await apiFetch(endpoint, { method: "POST", body: JSON.stringify({ channel }) })
      : await apiFetch(`${endpoint}?channel=${channel}`);
    setPatches(data.versions || []);
    if (releaseLocked) {
      setPatchesLoading(false);
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
    setPatchesLoading(false);
  };

  useEffect(() => {
    if (!release?.channel) return;
    if (skipChannelPatchFetchRef.current) {
      skipChannelPatchFetchRef.current = false;
      return;
    }
    fetchPatches(release.channel).catch(() => setPatchesLoading(false));
  }, [release?.channel]);

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
    setRefreshNote("Refreshing channels from upstream…");
    try {
      const data = await apiFetch("/api/cincinnati/update", { method: "POST" });
      const newChannels = sortChannelsBySemverDescending(data.channels || []);
      setChannels(newChannels);
      if (newChannels.length === 0) {
        setRefreshNote("");
        setRefreshing(false);
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
      await fetchPatches(channelToLoad, true);
      setRefreshNote("");
      setUpdatedMessage(true);
      setTimeout(() => setUpdatedMessage(false), 5000);
    } catch {
      setRefreshNote("");
    }
    setRefreshing(false);
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
            {archOptions.map((option) => (
              <button
                key={option.value}
                className={`select-card ${blueprint?.arch === option.value ? "selected" : ""}`}
                disabled={locked}
                onClick={() => updateBlueprint({ arch: option.value })}
              >
                <div className="card-title">{option.label}</div>
                <div className="card-sub">{option.sub}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-header" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>OpenShift release</h3>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <button type="button" className="ghost" onClick={refresh} disabled={releaseLocked}>
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
          <div className="field-grid" style={{ alignItems: "flex-end", gap: "0.5rem 1rem" }}>
            <label className="label-emphasis" style={{ minWidth: "10rem" }}>
              Minor channel
              <select
                value={release?.channel ?? ""}
                disabled={releaseLocked}
                onChange={(e) => updateChannel(e.target.value || null)}
              >
                <option value="" disabled>Select channel</option>
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
                {patches.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>
          {loading ? <div className="loading">Loading channels…</div> : null}
          {patchesLoading && release?.channel ? <div className="loading">Loading patches…</div> : null}
          <p className="note note-prominent">
            Operator scans are blocked until you lock these selections.
            {releaseLocked ? " Release is locked; use Start Over to change it." : ""}
          </p>
        </section>

        <section className="card pull-secret-section">
          <h3>Red Hat pull secret</h3>
          <div className="pull-secret-layout">
            <div className="pull-secret-left">
              <SecretInput
                value={blueprintPullSecretRaw}
                onChange={(v) => updateBlueprint({ blueprintPullSecretEphemeral: v })}
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
