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
  const recommended = platform === "Bare Metal" ? "Agent-Based Installer" : null;
  const needsReview = state.reviewFlags?.methodology && state.ui?.visitedSteps?.methodology;
  const allowed = supportedMethods[platform] || methods.map((m) => m.value);
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
        <div className={`card ${highlightErrors ? "highlight-errors" : ""}`}>
          <div className="note">
            Available methods depend on platform support. Unsupported methods are disabled.
          </div>
          <div className="grid">
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
