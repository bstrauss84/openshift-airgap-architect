/**
 * OpenShift Airgap Architect - Placeholder Card Component
 *
 * Placeholder for wizard steps not yet implemented when using dynamic step maps.
 * Provides consistent UI for unavailable steps.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";

/** Placeholder for a step not yet implemented when using dynamic step maps. */
export default function PlaceholderCard({ title }) {
  return (
    <div className="card placeholder-card">
      <div className="card-header">
        <h3>{title || "Step"}</h3>
      </div>
      <div className="note">This step is not yet available.</div>
    </div>
  );
}
