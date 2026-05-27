/**
 * OpenShift Airgap Architect - Release Selection Step (Connected Mode)
 *
 * Simplified version picker for connected mode. Only selects OpenShift version
 * without platform/methodology configuration (cluster already exists).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useEffect, useState } from "react";
import { useApp } from "../store.jsx";
import { apiFetch } from "../api.js";
import { sortChannelsBySemverDescending } from "../shared/cincinnatiChannels.js";

const ReleaseSelectionStep = () => {
  const { state, updateState } = useApp();
  const release = state.release || {};
  const version = state.version || {};

  const [channels, setChannels] = useState([]);
  const [patches, setPatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [patchesLoading, setPatchesLoading] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState(version.selectedChannel || release.channel ? `stable-${release.channel}` : "");
  const [selectedVersion, setSelectedVersion] = useState(version.selectedVersion || release.patchVersion || "");

  // Fetch available channels on mount
  useEffect(() => {
    setLoading(true);
    apiFetch("/api/cincinnati/channels")
      .then((data) => {
        const sorted = sortChannelsBySemverDescending(data.channels || []);
        setChannels(sorted);
        // Auto-select first channel if none selected
        if (!selectedChannel && sorted.length > 0) {
          setSelectedChannel(sorted[0]);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch channels:", err);
      })
      .finally(() => setLoading(false));
  }, []);

  // Fetch patches when channel changes
  useEffect(() => {
    if (!selectedChannel) return;

    setPatchesLoading(true);
    setPatches([]);
    setSelectedVersion("");

    const channelName = selectedChannel.replace("stable-", "");
    apiFetch(`/api/cincinnati/patches?channel=${channelName}`)
      .then((data) => {
        const versions = data.versions || [];
        setPatches(versions);
        // Auto-select latest version
        if (versions.length > 0) {
          setSelectedVersion(versions[0]);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch patches:", err);
      })
      .finally(() => setPatchesLoading(false));
  }, [selectedChannel]);

  const handleConfirm = () => {
    if (!selectedChannel || !selectedVersion) return;

    const channelMinor = selectedChannel.replace("stable-", "");

    updateState({
      release: {
        channel: channelMinor,
        patchVersion: selectedVersion,
        confirmed: true
      },
      version: {
        selectedChannel,
        selectedVersion,
        versionConfirmed: true,
        confirmedByUser: true,
        confirmationTimestamp: Date.now()
      }
    });
  };

  const confirmed = version.versionConfirmed || release.confirmed;
  const canConfirm = selectedChannel && selectedVersion && !confirmed;

  return (
    <div className="step-content">
      <div className="step-body">
        <section className="card">
          <h3>Select OpenShift Version</h3>
          <p className="note">
            Choose the OpenShift version to include in your imageset-config.yaml.
            This determines which operator catalogs will be scanned and mirrored.
          </p>

          <div style={{ marginTop: "1.5rem" }}>
            <label htmlFor="channel-select" style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              Channel
            </label>
            <select
              id="channel-select"
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value)}
              disabled={loading || confirmed}
              style={{ width: "100%", maxWidth: "400px" }}
            >
              <option value="">Select a channel...</option>
              {channels.map((ch) => (
                <option key={ch} value={ch}>
                  {ch}
                </option>
              ))}
            </select>
          </div>

          {selectedChannel && (
            <div style={{ marginTop: "1.5rem" }}>
              <label htmlFor="version-select" style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                Version
              </label>
              {patchesLoading ? (
                <p className="note">Loading available versions...</p>
              ) : patches.length === 0 ? (
                <p className="note warning">No versions available for this channel.</p>
              ) : (
                <select
                  id="version-select"
                  value={selectedVersion}
                  onChange={(e) => setSelectedVersion(e.target.value)}
                  disabled={patchesLoading || confirmed}
                  style={{ width: "100%", maxWidth: "400px" }}
                >
                  <option value="">Select a version...</option>
                  {patches.map((ver) => (
                    <option key={ver} value={ver}>
                      {ver} {ver === patches[0] ? "(latest)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {selectedChannel && selectedVersion && (
            <div style={{ marginTop: "1.5rem", padding: "1rem", background: "var(--card-bg-subtle)", borderRadius: "4px" }}>
              <p style={{ margin: 0, fontSize: "0.9rem" }}>
                <strong>Preview:</strong> imageset-config will use <code>{selectedChannel}</code> channel
                with version range <code>{selectedVersion}</code> to <code>{selectedVersion}</code>.
              </p>
            </div>
          )}

          <div style={{ marginTop: "2rem", display: "flex", gap: "1rem" }}>
            {!confirmed ? (
              <button
                onClick={handleConfirm}
                disabled={!canConfirm}
                className="button-primary"
              >
                Confirm Version Selection
              </button>
            ) : (
              <div className="note" style={{ color: "var(--success-text)" }}>
                ✓ Version confirmed: {selectedVersion}
              </div>
            )}
          </div>
        </section>

        {confirmed && (
          <section className="card">
            <h3>Version Confirmed</h3>
            <dl>
              <dt>Channel:</dt>
              <dd>{selectedChannel}</dd>
              <dt>Version:</dt>
              <dd>{selectedVersion}</dd>
            </dl>
            <p className="note" style={{ marginTop: "1rem" }}>
              Proceed to the Operators step to select which operators to include in your imageset-config.
            </p>
          </section>
        )}
      </div>
    </div>
  );
};

export default ReleaseSelectionStep;
