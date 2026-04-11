import React from "react";

/**
 * Shared toggle switch for on/off options that affect generated output.
 * Styled as a sliding switch; uses checkbox for accessibility.
 */
function Switch({ checked, onChange, disabled = false, "aria-label": ariaLabel, id }) {
  const isChecked = Boolean(checked);
  const onToggle = () => {
    if (disabled) return;
    onChange(!isChecked);
  };
  const onKeyDown = (event) => {
    if (disabled) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onChange(!isChecked);
    }
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isChecked}
      aria-label={ariaLabel}
      id={id}
      disabled={disabled}
      className="switch-wrap"
      data-checked={isChecked ? "true" : "false"}
      style={{ cursor: disabled ? "not-allowed" : "pointer" }}
      onClick={onToggle}
      onKeyDown={onKeyDown}
    >
      <span className="switch-slider" aria-hidden />
    </button>
  );
}

export default Switch;
