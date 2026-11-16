/**
 * OpenShift Airgap Architect - add many additional images at once (v2.2.0)
 *
 * Paste a list, choose a file, or drag one in (plain text or YAML — see
 * shared/imageList.js for what is understood). Shows what will be added,
 * what is already in the profile and which lines are not images, before
 * anything changes. Only valid, new images are added.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useMemo, useRef, useState } from "react";
import Modal from "../components/Modal.jsx";
import Button from "../components/Button.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import { parseImageList, MAX_IMAGE_LIST_BYTES } from "../shared/imageList.js";
import { validateImageRef } from "../shared/imageRef.js";
import { BULK_IMAGES_HINT } from "./mirroringCopy.js";

export const MAX_ADDITIONAL_IMAGES = 500; // the server's limit per profile

export default function BulkImagesDialog({ isOpen, onClose, onAdd, existing, validate = validateImageRef, idPrefix }) {
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);
  // Pasted text has the same size limit as a chosen file.
  const tooLarge = new Blob([text]).size > MAX_IMAGE_LIST_BYTES;
  const result = useMemo(() => (tooLarge ? parseImageList("", { validate }) : parseImageList(text, { validate, existing })), [text, validate, existing, tooLarge]);
  const room = Math.max(0, MAX_ADDITIONAL_IMAGES - existing.length);
  const tooMany = result.images.length > room;
  const sections = Object.entries(result.otherSections || {});
  const titleId = `${idPrefix}-bulk-title`;

  const close = () => { setText(""); setFileError(""); onClose(); };
  const readFile = (file) => {
    setFileError("");
    if (!file) return;
    if (file.size > MAX_IMAGE_LIST_BYTES) { setFileError(`${file.name} is larger than 1 MiB; a list of images is much smaller than that.`); return; }
    const r = new FileReader();
    r.onload = () => setText((t) => (t.trim() ? `${t.replace(/\s*$/, "")}\n` : "") + (typeof r.result === "string" ? r.result : ""));
    r.onerror = () => setFileError(`${file.name} could not be read.`);
    r.readAsText(file);
  };

  return (
    <Modal isOpen={isOpen} onClose={close} ariaLabelledBy={titleId} className="modal mirroring-bulk-modal">
      <h3 id={titleId}>Add several images</h3>
      <p className="modal-copy">
        Paste your list below, choose a file, or drag a file onto the box. One image per line — a plain text file
        or a YAML list both work. You will see exactly what will be added before anything changes.
      </p>
      <div className="field-control-stack">
        <FieldLabelWithInfo label="Images, one per line" hint={BULK_IMAGES_HINT}>
          <textarea
            id={`${idPrefix}-bulk-text`}
            className={`mirroring-bulk-text ${dragging ? "is-dragging" : ""}`}
            rows={10}
            value={text}
            placeholder={"quay.io/org/app:v1.2.3\nregistry.example.com/team/tool@sha256:…\n- name: quay.io/org/other:2.0"}
            onChange={(e) => setText(e.target.value)}
            onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
            onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer?.files?.[0];
              if (file) readFile(file);
              else {
                const dropped = e.dataTransfer?.getData("text/plain");
                if (dropped) setText((t) => (t.trim() ? `${t.replace(/\s*$/, "")}\n` : "") + dropped);
              }
            }}
            spellCheck={false}
            autoComplete="off"
          />
        </FieldLabelWithInfo>
        <div className="field-control-support">
          {fileError ? <span className="field-error" role="alert">{fileError}</span> : null}
        </div>
      </div>
      <input type="file" ref={fileRef} accept=".txt,.list,.yaml,.yml,text/plain,application/x-yaml,application/yaml" style={{ display: "none" }}
        onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="actions mirroring-bulk-file">
        <Button variant="secondary" className="mini" onClick={() => fileRef.current?.click()}>Choose file…</Button>
      </div>

      {tooLarge ? <p className="note warning" role="alert">The list is larger than 1 MiB; a list of images is much smaller than that. Remove what is not an image list, or split it.</p> : null}
      {text.trim() && !tooLarge ? (
        <div className="mirroring-bulk-summary" role="status">
          <p>
            <strong>{result.images.length} new image(s)</strong> will be added
            {result.duplicates.length ? <> · {result.duplicates.length} already in this profile (skipped)</> : null}
            {result.ignored ? <> · {result.ignored} YAML line(s) that are not images (ignored)</> : null}
            {sections.map(([key, n]) => <React.Fragment key={key}> · {n} entr{n === 1 ? "y" : "ies"} under {key}: (not images to mirror, ignored)</React.Fragment>)}
            {result.invalid.length ? <> · <strong>{result.invalid.length} line(s) not added</strong></> : null}.
          </p>
          {tooMany ? (
            <p className="note warning">A profile holds at most {MAX_ADDITIONAL_IMAGES} additional images; only {room} more fit. Remove some lines or split the list across profiles.</p>
          ) : null}
          {result.invalid.length ? (
            <ul className="mirroring-bulk-invalid" aria-label="Lines that were not added">
              {result.invalid.slice(0, 50).map((p) => (
                <li key={`${p.line}-${p.text}`}>Line {p.line}: <code>{p.text}</code> — {p.reason}</li>
              ))}
              {result.invalid.length > 50 ? <li>…and {result.invalid.length - 50} more.</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="actions">
        <Button variant="secondary" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!result.images.length || tooMany || tooLarge} onClick={() => { onAdd(result.images); close(); }}>
          {result.images.length ? `Add ${result.images.length} image(s)` : "Add images"}
        </Button>
      </div>
    </Modal>
  );
}
