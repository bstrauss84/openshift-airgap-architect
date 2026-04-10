import React from "react";
import { buildPlaceholderEntry, isPlaceholderToken, registerPlaceholderEntry } from "../placeholderEngine.js";

export default function PlaceholderToggleRow({
  state,
  updateState,
  value,
  onValueChange,
  type,
  label,
  className = ""
}) {
  const active = isPlaceholderToken(value || "");

  const onToggle = (checked) => {
    if (!checked) {
      onValueChange("");
      return;
    }
    const entry = buildPlaceholderEntry({ type, label });
    onValueChange(entry.token);
    updateState({ placeholders: registerPlaceholderEntry(state, entry) });
  };

  return (
    <div className={`toggle-row ${className}`.trim()} style={{ marginTop: 6 }}>
      <label className="host-inventory-v2-checkbox-label" style={{ marginBottom: 0 }}>
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={`Mark ${label} for later completion`}
        />
        {" "}Mark for later completion
      </label>
      {active ? <span className="subtle">Placeholder active</span> : null}
    </div>
  );
}
