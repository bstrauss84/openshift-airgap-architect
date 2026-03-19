import React from "react";
import { useApp } from "../store.jsx";
import Switch from "../components/Switch.jsx";
import {
  applyPlaceholderValuesToHostInventory,
  clearPlaceholderValuesFromHostInventory
} from "../placeholderValuesHelpers.js";

const methods = [
  { value: "IPI", label: "IPI (Installer Provisioned)", sub: "Full stack automation." },
  { value: "UPI", label: "UPI (User Provisioned)", sub: "You provide the infrastructure." },
  { value: "Agent-Based Installer", label: "Agent-Based Installer", sub: "Ideal for bare metal and airgapped." }
];

const supportedMethods = {
  "Bare Metal": ["Agent-Based Installer", "IPI", "UPI"],
  "VMware vSphere": ["IPI", "UPI"],
  Nutanix: ["IPI"],
  "AWS GovCloud": ["IPI", "UPI"],
  "Azure Government": ["IPI"]
};

const MethodologyStep = ({ highlightErrors }) => {
  const { state, updateState } = useApp();
  const method = state.methodology?.method;
  const platform = state.blueprint?.platform;
  const recommended = platform === "Bare Metal" ? "Agent-Based Installer" : null;
  const needsReview = state.reviewFlags?.methodology && state.ui?.visitedSteps?.methodology;
  const allowed = supportedMethods[platform] || methods.map((m) => m.value);
  const placeholdersEnabled = Boolean(state.ui?.placeholderValuesEnabled);

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

        {platform === "Bare Metal" ? (
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Placeholder Values Mode</h3>
                <div className="card-subtitle">
                  Enable safe placeholders for sensitive disconnected-environment fields.
                </div>
              </div>
            </div>
            <div className="card-body">
              <label className="toggle-row">
                <Switch
                  checked={placeholdersEnabled}
                  onChange={(e) => togglePlaceholders(e.target.checked)}
                  aria-label="Enable placeholder values for sensitive environment-specific fields"
                />
                <span>Enable placeholder values for sensitive environment-specific fields</span>
              </label>
              <p className="note subtle">
                When enabled, the app replaces sensitive values (like host root devices, MACs, IPs, and BMC details)
                with non-sensitive placeholders so you can progress through disconnected workflows.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default MethodologyStep;
