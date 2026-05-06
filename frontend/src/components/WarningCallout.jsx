/**
 * OpenShift Airgap Architect - Warning Callout Component
 *
 * Amber/yellow warning callout for risky options or cautions.
 * Distinct from error messages (red). Used throughout wizard for user advisories.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";

/**
 * Amber/yellow warning callout. Use for risky options, not for actual errors (red).
 */
function WarningCallout({ children, className = "" }) {
  return (
    <div className={`warning-callout ${className}`.trim()} role="status">
      {children}
    </div>
  );
}

export default WarningCallout;
