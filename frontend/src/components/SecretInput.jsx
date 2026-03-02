import React, { useRef, useState } from "react";

/**
 * Shared pull-secret / credential input: masked by default, show/hide toggle,
 * paste, drag-and-drop, file upload, consistent helper/error placement.
 * Use for all pull secret fields across Blueprint, Identity & Access, Operators, Global Strategy.
 */
function SecretInput({
  value = "",
  onChange,
  label = "Pull secret (JSON)",
  labelEmphasis,
  helperText,
  notPersistedMessage,
  errorMessage,
  disabled = false,
  placeholder = "Paste, drag and drop, or upload a Red Hat pull secret",
  rows = 8,
  required,
  "aria-label": ariaLabel,
  id: idProp
}) {
  const [showSecret, setShowSecret] = useState(false);
  const fileRef = useRef(null);
  const id = idProp || `secret-input-${Math.random().toString(36).slice(2, 9)}`;

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      const r = new FileReader();
      r.onload = () => {
        const text = typeof r.result === "string" ? r.result : "";
        onChange(text.trim ? text.trim() : text);
      };
      r.readAsText(file);
      return;
    }
    const text = e.dataTransfer?.getData("text/plain") || e.dataTransfer?.getData("text");
    if (text != null && text.trim()) onChange(text.trim());
  };

  const handlePaste = (e) => {
    const v = e.clipboardData?.getData("text");
    if (v != null) {
      e.preventDefault();
      onChange(v.trim ? v.trim() : v);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      const text = typeof r.result === "string" ? r.result : "";
      onChange(text.trim ? text.trim() : text);
    };
    r.readAsText(file);
    e.target.value = "";
  };

  const displayValue = showSecret ? value : (value ? "\u2022".repeat(12) : "");
  const hasError = Boolean(errorMessage);

  return (
    <div className="pull-secret-section-inline">
      <div className="pull-secret-label-row">
        <span className="label-emphasis">{labelEmphasis || label}</span>
        {required ? <span className="required-indicator">(required)</span> : null}
        <button
          type="button"
          className="ghost pull-secret-toggle"
          style={{ padding: "2px 8px", fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: 4 }}
          onClick={() => setShowSecret((s) => !s)}
          aria-label={showSecret ? "Hide" : "Show"}
          disabled={disabled}
        >
          <span aria-hidden>{showSecret ? "\u2007" : "\u{1F441}"}</span>
          {showSecret ? "Hide" : "Show"}
        </button>
      </div>
      <div
        className={`pull-secret-field-wrap ${hasError ? "input-error" : ""}`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={handleDrop}
      >
        {!value ? (
          <div className="pull-secret-placeholder" aria-hidden>
            {placeholder}
          </div>
        ) : null}
        <textarea
          id={id}
          className={`pull-secret-field ${hasError ? "input-error" : ""}`}
          role="textbox"
          aria-label={ariaLabel || label}
          value={displayValue}
          onChange={(e) => showSecret && onChange(e.target.value)}
          onPaste={handlePaste}
          placeholder=""
          disabled={disabled}
          readOnly={!showSecret}
          autoComplete="off"
          rows={rows}
          style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}
        />
      </div>
      <input
        type="file"
        accept=".json,text/plain"
        style={{ display: "none" }}
        ref={fileRef}
        onChange={handleFileChange}
      />
      <div className="pull-secret-upload-wrap">
        <button
          type="button"
          className="ghost pull-secret-upload"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
        >
          Upload file
        </button>
      </div>
      {errorMessage ? (
        <div className="note warning" style={{ marginTop: 8 }}>{errorMessage}</div>
      ) : null}
      {helperText ? (
        <p className="note note-prominent pull-secret-helper">{helperText}</p>
      ) : null}
      {notPersistedMessage ? (
        <p className="note">{notPersistedMessage}</p>
      ) : null}
    </div>
  );
}

export default SecretInput;
