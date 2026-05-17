/**
 * OpenShift Airgap Architect - Installation Methodology Step
 *
 * Deployment methodology selection: IPI (Installer Provisioned Infrastructure),
 * UPI (User Provisioned Infrastructure), or Agent-Based Installer. Filters available
 * methods based on selected platform compatibility.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";
import { useApp } from "../store.jsx";

const methods = [
  { value: "IPI", label: "IPI (Installer Provisioned)", sub: "Full stack automation." },
  { value: "UPI", label: "UPI (User Provisioned)", sub: "You provide the infrastructure." },
  {
    value: "Agent-Based Installer",
    label: "Agent-Based Installer",
    sub: "ISO or PXE with install-config + agent-config; strong fit for bare metal, VMware vSphere, and air-gapped installs."
  }
];

const supportedMethods = {
  "Bare Metal": ["Agent-Based Installer", "IPI", "UPI"],
  "VMware vSphere": ["IPI", "UPI", "Agent-Based Installer"],
  Nutanix: ["IPI"],
  "AWS GovCloud": ["IPI", "UPI"],
  "Azure Government": ["IPI"],
  "IBM Cloud": ["IPI"]
};

const MethodologyStep = ({ highlightErrors }) => {
  const { state, updateState } = useApp();
  const method = state.methodology?.method;
  const platform = state.blueprint?.platform;
  const connectivity = state.globalStrategy?.connectivity;
  const recommended = platform === "Bare Metal" ? "Agent-Based Installer" : null;
  const needsReview = state.reviewFlags?.methodology && state.ui?.visitedSteps?.methodology;
  const allowed = supportedMethods[platform] || methods.map((m) => m.value);
  const placeholdersEnabled = Boolean(state.ui?.placeholderValuesEnabled);

  // Decision guidance for disconnected vSphere
  const showVsphereDisconnectedGuidance = platform === "VMware vSphere" && connectivity === "disconnected";

  const togglePlaceholders = (enabled) => {
    const nextUi = { ...(state.ui || {}), placeholderValuesEnabled: enabled };
    if (!enabled) {
      updateState({
        ui: nextUi,
        hostInventory: clearPlaceholderValuesFromHostInventory(state.hostInventory)
      });
      return;
    }

    updateState({
      ui: nextUi,
      hostInventory: applyPlaceholderValuesToHostInventory(state.hostInventory, { platform, method })
    });
  };

  React.useEffect(() => {
    if (method && !allowed.includes(method)) {
      updateState({ methodology: { method: allowed[0] } });
    }
  }, [platform]);

  return (
    <div className="step">
      <div className="step-header">
        <div className="step-header-main">
          <h2>Installation Methodology</h2>
          <p className="subtle">Pick the installer workflow that matches your platform and governance model.</p>
        </div>
      </div>
      <div className="step-body">
        {needsReview ? (
          <div className="banner warning">
            Version or upstream selections changed. Review this page to ensure settings are still valid.
            <div className="actions">
              <button
                className="ghost"
                onClick={() => updateState({ reviewFlags: { ...state.reviewFlags, methodology: false } })}
              >
                Re-evaluate this page
              </button>
            </div>
          </div>
        ) : null}

        {showVsphereDisconnectedGuidance && (
          <div className="note info" style={{ marginBottom: "1rem" }}>
            <strong>Recommended for disconnected vSphere: Agent-Based Installer</strong>
            <div style={{ marginTop: "0.5rem" }}>
              Agent-Based Installer works even when the bootstrap node cannot reach vCenter API.
              ISO boots nodes directly without vCenter SDK calls during installation.
            </div>
            <details style={{ marginTop: "0.5rem" }}>
              <summary style={{ cursor: "pointer", fontWeight: "500" }}>Why this matters for disconnected vSphere</summary>
              <ul style={{ marginTop: "0.5rem", paddingLeft: "1.5rem" }}>
                <li>
                  <strong>IPI:</strong> Requires vCenter API reachable from bootstrap node. Works if vCenter itself
                  is air-gapped but fails if network isolation prevents bootstrap → vCenter traffic (NSX-T firewall,
                  management network segmentation).
                </li>
                <li>
                  <strong>Agent-Based Installer:</strong> No vCenter API calls during bootstrap. Best for network-segmented
                  environments where vCenter is on isolated management network.
                </li>
                <li>
                  <strong>UPI:</strong> Full manual VM provisioning. Use if policy restricts automated vCenter API access.
                </li>
              </ul>
              <div style={{ marginTop: "0.5rem", fontSize: "0.9em" }}>
                See <code>docs/VSPHERE_SDK_DISCONNECTED_CONSTRAINTS.md</code> for detailed decision matrix.
              </div>
            </details>
          </div>
        )}

        <div className={`card ${highlightErrors ? "highlight-errors" : ""}`}>
          <div className="note">
            Available methods depend on platform support. Unsupported methods are disabled.
          </div>
          <div className="methodology-grid">
            {methods.map((option) => (
              <button
                key={option.value}
                className={`select-card ${method === option.value ? "selected" : ""}`}
                onClick={() => updateState({ methodology: { method: option.value } })}
                disabled={!allowed.includes(option.value)}
                title={!allowed.includes(option.value) ? "Not supported for selected platform" : ""}
              >
                <div className="card-title">
                  {option.label}
                  {recommended === option.value ? <span className="badge">Recommended</span> : null}
                </div>
                <div className="card-sub">{option.sub}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MethodologyStep;
