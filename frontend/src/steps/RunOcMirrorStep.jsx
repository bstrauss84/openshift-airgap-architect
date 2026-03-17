/**
 * Feature-gated "Run oc-mirror" step (Plan §9.1).
 * Implementation contract: docs/OC_MIRROR_V2_RUN_TAB_RESEARCH_AND_PLAN.md §1–§9.
 * Shows a "Coming soon" treatment; no functional controls until the feature is implemented.
 */
import React from "react";

const RunOcMirrorStep = () => (
  <div className="step">
    <div className="step-header">
      <div className="step-header-main">
        <h2>Run oc-mirror</h2>
        <p className="subtle">Run oc-mirror on this machine using your generated imageset-config.yaml.</p>
      </div>
    </div>
    <div className="step-body">
      <section className="card run-oc-mirror-coming-soon-card">
        <span className="run-oc-mirror-badge" aria-hidden="true">Coming soon</span>
        <h3>Run oc-mirror now (optional)</h3>
        <p className="note">
          We&apos;re working on this for a future update. You will be able to run oc-mirror here using your
          generated <code>imageset-config.yaml</code>, with path validation, pull secret (used once; not stored),
          and optional inclusion of mirror output in the export bundle. Planned: mirror-to-disk, disk-to-mirror, and mirror-to-mirror with workspace and cache options.
        </p>
        <p className="note subtle">
          Until then, use the Assets &amp; Guide step to download your bundle and run oc-mirror manually
          with the generated config.
        </p>
      </section>
    </div>
  </div>
);

export default RunOcMirrorStep;
