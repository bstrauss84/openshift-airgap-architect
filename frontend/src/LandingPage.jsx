/**
 * OpenShift Airgap Architect - Landing Page
 *
 * Landing page with path selection cards: Install (primary), Upgrade (coming soon), Mirroring.
 * Install CTA shows "Start new install" or "Continue install" based on progress state.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";

/**
 * Landing page with three path cards: Install (primary), Upgrade (coming soon) and Mirroring.
 * Install CTA shows "Start new install" or "Continue install" in a footer rail; onStartInstall is
 * called when the user clicks the Install card (parent decides step index). Mirroring opens the
 * standalone Mirroring workspace (v2.2.0), a separate workflow from the Install wizard.
 */
const LandingPage = ({ hasProgress, onStartInstall, onStartMirroring }) => {
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

        <button
          type="button"
          className="landing-card landing-card-mirroring"
          onClick={onStartMirroring}
          aria-label="Open Mirroring"
        >
          <div className="landing-card-inner">
            <div className="landing-card-top">
              <h2 className="landing-card-title">Mirroring</h2>
              <p className="landing-card-subtitle">Plan content for disconnected sites</p>
            </div>
            <p className="landing-card-desc">
              Plan oc-mirror v2 content without an install: the OpenShift platform release, operators and
              additional images, in independent profiles.
            </p>
            <div className="landing-card-footer-rail">Open Mirroring →</div>
          </div>
        </button>
      </div>
    </div>
  );
};

export default LandingPage;
