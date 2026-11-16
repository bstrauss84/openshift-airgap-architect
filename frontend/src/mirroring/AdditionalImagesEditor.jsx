/**
 * OpenShift Airgap Architect - additional images rows (v2.2.0 M3)
 *
 * One row per image, each with a stable identity and an owner:
 *  - `source: "user"` for anything a person typed;
 *  - other sources are reserved for future operator-managed suggestions;
 *  - editing a non-user row marks it `userModified`, so a later automatic
 *    change can never overwrite or remove it.
 * Nothing is added automatically in M3.
 *
 * Validation follows the contract: computed always, shown after blur or a save
 * attempt. Only a fully valid list is saved (the server rejects invalid image
 * references); an invalid row keeps its text and says why, instead of being
 * dropped. Empty rows are drafts and are not saved.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import Banner from "../components/Banner.jsx";
import Button from "../components/Button.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import { updateProfile } from "./mirroringApi.js";
import { ADDITIONAL_IMAGE_HINT } from "./mirroringCopy.js";
import BulkImagesDialog from "./BulkImagesDialog.jsx";

import { validateImageRef } from "../shared/imageRef.js";

// Shared with the bulk import (and Install later); same policy as the server.
export { validateImageRef };

const newRowId = () => `img-${Math.random().toString(36).slice(2, 12)}`;

const AdditionalImagesEditor = ({ profile, onProfileChanged }) => {
  const [rows, setRows] = useState(() => profile.additionalImages.map((img) => ({ ...img })));
  const [touched, setTouched] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const savedRef = useRef(JSON.stringify(profile.additionalImages));

  const errors = useMemo(() => {
    const out = {};
    const seen = new Map();
    rows.forEach((r) => {
      const msg = validateImageRef(r.name);
      if (msg) out[r.id] = msg;
      const key = r.name.trim();
      if (key) {
        if (seen.has(key)) out[r.id] = out[r.id] || "This image is already in the list.";
        seen.set(key, r.id);
      }
    });
    return out;
  }, [rows]);
  const show = (id) => Boolean(errors[id]) && (attempted || touched[id]);

  const persist = async (nextRows) => {
    const hasErrors = nextRows.some((r) => validateImageRef(r.name)) ||
      new Set(nextRows.map((r) => r.name.trim()).filter(Boolean)).size !== nextRows.filter((r) => r.name.trim()).length;
    if (hasErrors) {
      setAttempted(true);
      return;
    }
    const payload = nextRows
      .filter((r) => r.name.trim())
      .map((r) => ({ id: r.id, name: r.name.trim(), source: r.source || "user", ...(r.userModified ? { userModified: true } : {}) }));
    const serialized = JSON.stringify(payload);
    if (serialized === savedRef.current) return;
    try {
      const updated = await updateProfile(profile.id, { additionalImages: payload });
      savedRef.current = serialized;
      setSaveError("");
      onProfileChanged(updated);
    } catch (e) {
      setSaveError(e.message || String(e));
    }
  };

  // Save valid edits if the editor unmounts mid-change (profile switch, Home).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => () => { persist(rowsRef.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const editRow = (id, name) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, name, ...(r.source !== "user" ? { userModified: true } : {}) } : r)));
  const addRow = () => setRows((rs) => [...rs, { id: newRowId(), name: "", source: "user" }]);
  // Bulk add: the dialog only hands over valid, new references. Empty draft
  // rows are replaced rather than kept in front of the new images.
  const addMany = (refs) => {
    const next = [...rows.filter((r) => r.name.trim()), ...refs.map((name) => ({ id: newRowId(), name, source: "user" }))];
    setRows(next);
    persist(next);
  };
  const removeRow = (id) => {
    const next = rows.filter((r) => r.id !== id);
    setRows(next);
    persist(next);
  };

  const invalidCount = Object.keys(errors).length;

  return (
    <section className="card" aria-labelledby={`mirroring-images-heading-${profile.id}`}>
      <h3 id={`mirroring-images-heading-${profile.id}`}>Additional images</h3>
      <p className="card-subtitle mirroring-card-subtitle">
        Container images to mirror alongside, or instead of, platform and operator content. No OpenShift version is needed.
      </p>
      {saveError ? <Banner variant="error">Could not save additional images: {saveError}</Banner> : null}
      {rows.length === 0 ? <p className="subtle">No additional images yet.</p> : null}
      <ul className="mirroring-image-rows">
        {rows.map((r, i) => (
          <li key={r.id} className="mirroring-image-row" data-image-source={r.source}>
            <div className="field-control-stack">
              <FieldLabelWithInfo label={`Image ${i + 1}`} hint={ADDITIONAL_IMAGE_HINT}>
                <input
                  type="text"
                  id={`mirroring-image-${r.id}`}
                  className={show(r.id) ? "input-error" : ""}
                  value={r.name}
                  placeholder="quay.io/org/app:v1.2.3"
                  onChange={(e) => editRow(r.id, e.target.value)}
                  onBlur={() => {
                    setTouched((t) => ({ ...t, [r.id]: true }));
                    persist(rowsRef.current);
                  }}
                  aria-invalid={show(r.id) ? "true" : undefined}
                  aria-describedby={show(r.id) ? `error-mirroring-image-${r.id}` : undefined}
                  autoComplete="off"
                  spellCheck={false}
                />
              </FieldLabelWithInfo>
              <div className="field-control-support">
                {show(r.id) ? (
                  <span id={`error-mirroring-image-${r.id}`} className="field-error" role="alert">{errors[r.id]}</span>
                ) : null}
                {r.source !== "user" ? (
                  <div className="field-helper">
                    Suggested by {r.source}{r.userModified ? " — edited by you, so it is kept as you wrote it" : ""}.
                  </div>
                ) : null}
              </div>
            </div>
            <Button variant="secondary" className="mini mirroring-image-remove" onClick={() => removeRow(r.id)} aria-label={`Remove image ${i + 1}`}>Remove</Button>
          </li>
        ))}
      </ul>
      {/* Below the rows, never above them: inserting it above would push every
          row (and its Remove control) down when the first error appears. */}
      {attempted && invalidCount ? (
        <div className="note warning" role="status">
          {invalidCount} image row(s) need attention; the list is saved once every row is valid. Nothing you typed was discarded.
        </div>
      ) : null}
      <div className="actions">
        <Button variant="secondary" onClick={addRow}>Add image</Button>
        <Button variant="secondary" onClick={() => setBulkOpen(true)}>Add several…</Button>
      </div>
      <BulkImagesDialog
        isOpen={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onAdd={addMany}
        existing={rows.map((r) => r.name.trim()).filter(Boolean)}
        validate={validateImageRef}
        idPrefix={`mirroring-images-${profile.id}`}
      />
    </section>
  );
};

export default AdditionalImagesEditor;
