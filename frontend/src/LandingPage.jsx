/**
 * OpenShift Airgap Architect - Landing Page
 *
 * Landing page with path selection cards: Install (primary), Upgrade, Operator mirroring.
 * Install CTA shows "Start new install" or "Continue install" based on progress state.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";

/**
 * Landing page with three path cards: Install (primary), Upgrade, Operator mirroring (disabled).
 * Install CTA shows "Start new install" or "Continue install" in a footer rail; onStartInstall is
 * called when the user clicks the Install card (parent decides step index).
 */
const LandingPage = ({ hasProgress, onStartInstall }) => {
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
          className="landing-card landing-card-install"
          onClick={onStartInstall}
          aria-label={footerCtaText}
        >
          <div className="landing-card-inner">
            <div className="landing-card-top">
              <h2 className="landing-card-title">Install</h2>
              <p className="landing-card-subtitle">Net-new disconnected install</p>
            </div>
            <p className="landing-card-desc">
              Create a new OpenShift cluster in an air-gapped environment. Configure blueprint, release,
              methodology, operators, and generate install assets.
            </p>
            <div className="landing-card-footer-rail">{footerCtaText}</div>
          </div>
        </button>

        <div className="landing-card landing-card-upgrade landing-card-coming-soon" aria-disabled="true">
          <span className="landing-card-badge">Coming soon</span>
          <div className="landing-card-inner">
            <div className="landing-card-top">
              <h2 className="landing-card-title">Upgrade</h2>
              <p className="landing-card-subtitle">Platform & operator updates</p>
            </div>
            <p className="landing-card-desc">
              Upgrade an existing disconnected cluster or operator set. Plan and apply platform or
              operator updates from your mirror.
            </p>
            <p className="landing-card-note">Not available in this build.</p>
          </div>
        </div>

        <div className="landing-card landing-card-operator landing-card-coming-soon" aria-disabled="true">
          <span className="landing-card-badge">Coming soon</span>
          <div className="landing-card-inner">
            <div className="landing-card-top">
              <h2 className="landing-card-title">Operator mirroring</h2>
              <p className="landing-card-subtitle">Mirror and catalog</p>
            </div>
            <p className="landing-card-desc">
              Mirror content and build catalogs without a full install workflow. Use when you need to
              sync images or manage operator catalogs.
            </p>
            <p className="landing-card-note">Not available in this build.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;
