/**
 * OpenShift Airgap Architect - Preloaded Config Banner Component
 *
 * Informational banner shown when mirror registry config is pre-loaded from mounted file.
 * Explains that fields are read-only and pre-configured at backend startup.
 * Consistent with post-import warning banner pattern (BlueprintStep lines 333-369).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import React from 'react';

/**
 * Informational banner for pre-configured sections.
 *
 * @param {Object} props - Component props
 * @param {string} [props.message] - Custom message text (optional)
 * @returns {JSX.Element} Banner component
 */
export default function PreloadedConfigBanner({ message }) {
  return (
    <div className="banner info" style={{ marginBottom: '1.5rem' }}>
      <svg className="icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM7 4h2v2H7V4zm0 3h2v5H7V7z"/>
      </svg>
      <div className="content">
        <strong>Pre-configured from mounted mirror registry</strong>
        <p>{message || "These settings were loaded from a mounted configuration file and cannot be edited."}</p>
      </div>
    </div>
  );
}
