/**
 * OpenShift Airgap Architect - shared file drop zone (v2.3.0 owner QA P8).
 *
 * One upload control for file imports: a labelled, dashed drop area with a "Choose file(s)"
 * button, keyboard reachable, instead of the browser's native file input. Files are read in the
 * browser only and handed to `onFiles`; nothing is uploaded or stored by this component.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useRef, useState } from "react";
import Button from "./Button.jsx";

export default function FileDropZone({ id, label, help, accept, multiple = false, disabled = false, onFiles, buttonText }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const take = (list) => {
    const files = Array.from(list || []);
    if (!files.length || disabled) return;
    onFiles(multiple ? files : files.slice(0, 1));
  };
  return (
    <div
      className="file-drop-zone"
      data-over={over ? "true" : undefined}
      data-disabled={disabled ? "true" : undefined}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) { e.dataTransfer.dropEffect = "copy"; setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
    >
      <div className="file-drop-zone-text">
        <strong id={`${id}-label`}>{label}</strong>
        <span className="subtle">Drop {multiple ? "files" : "a file"} here, or</span>
      </div>
      <Button variant="secondary" disabled={disabled} onClick={() => inputRef.current?.click()} aria-describedby={help ? `${id}-help` : undefined} aria-label={`${buttonText || (multiple ? "Choose files" : "Choose a file")}: ${label}`}>
        {buttonText || (multiple ? "Choose files" : "Choose a file")}
      </Button>
      {help ? <div id={`${id}-help`} className="field-helper">{help}</div> : null}
      <input
        ref={inputRef}
        id={id}
        type="file"
        hidden
        multiple={multiple}
        accept={accept}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        onChange={(e) => { take(e.target.files); e.target.value = ""; }}
      />
    </div>
  );
}
