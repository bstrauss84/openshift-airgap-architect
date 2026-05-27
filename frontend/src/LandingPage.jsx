/**
 * OpenShift Airgap Architect - Landing Page
 *
 * Landing page with mode selection cards for connected vs disconnected flows.
 * Detects operator-managed mode and recommends connected flow when appropriate.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";
import { useApp } from "./store.jsx";

const LandingPage = ({ hasProgress, onStartInstall }) => {
  const context = useApp();
  const runtimeInfo = context?.runtimeInfo || {};
  const updateState = context?.updateState || (() => {});
  const operatorManaged = runtimeInfo?.operatorManaged || false;
  const pullSecretMounted = runtimeInfo?.pullSecretMounted || false;

  const startConnectedFlow = () => {
    updateState({
      docs: { connectivity: "connected" },
      ui: { showLanding: false, activeStepId: "release-selection" }
    });
  };

  const startDisconnectedFlow = () => {
    updateState({
      docs: { connectivity: "fully-disconnected" },
      ui: { showLanding: false, activeStepId: "blueprint" }
    });
    if (onStartInstall) onStartInstall();
  };

  const footerCtaText = hasProgress ? "Continue install →" : "Start new install →";

  return (
    <div className="landing">
      <div className="landing-header">
        <h1 className="landing-title">What would you like to do?</h1>
        <p className="landing-subtitle">Choose a path to get started.</p>
      </div>
      <div className="landing-cards">
        <button
          type="button"
          className={`landing-card landing-card-connected ${operatorManaged && pullSecretMounted ? "landing-card-recommended" : ""}`}
          onClick={startConnectedFlow}
          aria-label="Generate ImageSet Configuration"
        >
          {operatorManaged && pullSecretMounted && (
            <span className="landing-card-badge landing-card-badge-success">✓ Detected - Recommended</span>
          )}
          <div className="landing-card-inner">
            <div className="landing-card-top">
              <div className="landing-card-icon">📋</div>
              <h2 className="landing-card-title">Generate ImageSet Configuration</h2>
              <p className="landing-card-subtitle">Connected mode</p>
            </div>
            <p className="landing-card-desc">
              I'm running on a connected OpenShift cluster and want to select operators for mirroring to a disconnected environment.
            </p>
            <ul className="landing-card-features">
              <li>Select operators from live Red Hat catalogs</li>
              <li>Generate imageset-config.yaml only</li>
              <li>Simplified 4-step workflow</li>
            </ul>
          </div>
        </button>

        <button
          type="button"
          className="landing-card landing-card-install"
          onClick={startDisconnectedFlow}
          aria-label={footerCtaText}
        >
          <div className="landing-card-inner">
            <div className="landing-card-top">
              <div className="landing-card-icon">🏗️</div>
              <h2 className="landing-card-title">Build Disconnected Cluster</h2>
              <p className="landing-card-subtitle">Net-new disconnected install</p>
            </div>
            <p className="landing-card-desc">
              I want to generate install-config, agent-config, and imageset-config for deploying a new OpenShift cluster in an airgapped environment.
            </p>
            <ul className="landing-card-features">
              <li>Full platform and networking configuration</li>
              <li>Generate all deployment configs</li>
              <li>Run oc-mirror from the wizard</li>
            </ul>
            <div className="landing-card-footer-rail">{footerCtaText}</div>
          </div>
        </button>
      </div>
    </div>
  );
};

export default LandingPage;
