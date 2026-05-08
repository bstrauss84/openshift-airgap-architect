/**
 * OpenShift Airgap Architect - Switch Toggle Component
 *
 * Shared toggle for on/off options. Implemented as a native `button` (not a
 * checkbox) so clicks do not move focus into a clipped checkbox inside a
 * scrollable `#main-content` — that pattern triggers browser scroll-into-view
 * and layout jumps on long wizard steps.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";

/**
 * Accessible switch: `role="switch"` + `aria-checked` on a focusable button.
 */
function Switch({ checked, onChange, disabled = false, "aria-label": ariaLabel, id }) {
  const isOn = Boolean(checked);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={ariaLabel}
      id={id}
      disabled={disabled}
      className="switch-control"
      onClick={() => {
        if (!disabled) onChange(!isOn);
      }}
    >
      <span className="switch-slider" aria-hidden />
    </button>
  );
}

export default Switch;
