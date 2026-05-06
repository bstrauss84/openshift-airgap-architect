/**
 * OpenShift Airgap Architect - Switch Toggle Component
 *
 * Shared toggle switch for on/off options that affect generated output.
 * Styled as a sliding switch; uses checkbox for accessibility.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";

/**
 * Shared toggle switch for on/off options that affect generated output.
 * Styled as a sliding switch; uses checkbox for accessibility.
 */
function Switch({ checked, onChange, disabled = false, "aria-label": ariaLabel, id }) {
  return (
    <label className="switch-wrap" style={{ cursor: disabled ? "not-allowed" : "pointer" }}>
      <input
        type="checkbox"
        role="switch"
        checked={Boolean(checked)}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        aria-label={ariaLabel}
        id={id}
        className="switch-input"
      />
      <span className="switch-slider" aria-hidden />
    </label>
  );
}

export default Switch;
