/**
 * OpenShift Airgap Architect - Mirroring content selection (v2.2.0 M2)
 *
 * "What would you like to mirror?" — the profile name plus three independently
 * selectable content types. Validation follows the approved contract: validity
 * is computed on every render, but an inline error is shown only after the
 * field is blurred or after Continue is pressed; an untouched field is never
 * red. Deselecting a type never deletes its saved settings (the server keeps
 * every section of a profile).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useMemo, useState } from "react";
import Button from "../components/Button.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import { CONTENT_TYPES, CONTENT_TYPES_HINT, PROFILE_NAME_HINT } from "./mirroringCopy.js";

const NAME_MAX = 80;

/**
 * Unsaved name/content edits per profile, kept in memory for this browser
 * session only (no secrets: a name and three booleans), so Home and back does
 * not lose a half-finished selection. Cleared on Continue or Cancel.
 */
const drafts = new Map();
export const _resetContentDraftsForTests = () => drafts.clear();

export const validateContentSelection = ({ name, content }) => {
  const errors = {};
  const trimmed = String(name ?? "").trim();
  if (!trimmed) errors.name = "Enter a profile name.";
  else if (trimmed.length > NAME_MAX) errors.name = `Use at most ${NAME_MAX} characters.`;
  if (!CONTENT_TYPES.some((t) => content?.[t.key])) {
    errors.content = "Select at least one content type: OpenShift platform, Operators or Additional images.";
  }
  return errors;
};

const ContentSelection = ({ profile, saving, onSubmit, onCancel, forceShowErrors = false }) => {
  const [name, setNameState] = useState(() => drafts.get(profile.id)?.name ?? (profile.name || ""));
  const [content, setContentState] = useState(() => drafts.get(profile.id)?.content ?? { ...profile.content });
  const setName = (v) => { setNameState(v); drafts.set(profile.id, { name: v, content }); };
  const setContent = (fn) => setContentState((c) => {
    const next = typeof fn === "function" ? fn(c) : fn;
    drafts.set(profile.id, { name, content: next });
    return next;
  });
  const [touched, setTouched] = useState({});
  const [attempted, setAttempted] = useState(false);

  // Validation truth: always current.
  const errors = useMemo(() => validateContentSelection({ name, content }), [name, content]);
  // Presentation: only after blur or an explicit Continue.
  const show = (field) => Boolean(errors[field]) && (forceShowErrors || attempted || touched[field]);

  const deselectedButSaved = CONTENT_TYPES.filter((t) => profile.content?.[t.key] && !content[t.key]);

  const toggle = (key) => setContent((c) => ({ ...c, [key]: !c[key] }));

  const submit = () => {
    if (Object.keys(errors).length) {
      setAttempted(true);
      return;
    }
    drafts.delete(profile.id);
    onSubmit({ name: name.trim(), content });
  };

  return (
    <section className="card" aria-labelledby="mirroring-content-heading">
      <h3 id="mirroring-content-heading">What would you like to mirror?</h3>
      <p className="card-subtitle mirroring-card-subtitle">Name this profile and choose one or more content types. You can change both later.</p>
      <div className="card-body">
        <div className="field-grid mirroring-name-grid">
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Profile name" hint={PROFILE_NAME_HINT} required>
              <input
                type="text"
                id="mirroring-profile-name"
                className={show("name") ? "input-error" : ""}
                value={name}
                maxLength={NAME_MAX + 20}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                aria-invalid={show("name") ? "true" : undefined}
                aria-describedby={show("name") ? "error-mirroring-profile-name" : undefined}
                autoComplete="off"
              />
            </FieldLabelWithInfo>
            <div className="field-control-support">
              {show("name") ? (
                <span id="error-mirroring-profile-name" className="field-error" role="alert">{errors.name}</span>
              ) : null}
              <div className="field-helper">A label for this plan only; it is not written into generated files.</div>
            </div>
          </div>
        </div>

        <div
          className="field-control-stack mirroring-content-field"
          role="group"
          aria-labelledby="mirroring-content-types-label"
          aria-describedby={show("content") ? "error-mirroring-content" : "mirroring-content-helper"}
        >
          <div id="mirroring-content-types-label" className="mirroring-group-label">
            <FieldLabelWithInfo label="Content to mirror" hint={CONTENT_TYPES_HINT} required />
          </div>
          <div className="mirroring-content-grid">
            {CONTENT_TYPES.map((t) => {
              const selected = Boolean(content[t.key]);
              return (
                <button
                  key={t.key}
                  type="button"
                  className={`select-card ${selected ? "selected" : ""}`}
                  aria-pressed={selected}
                  aria-describedby={`mirroring-content-desc-${t.key}`}
                  data-content-type={t.key}
                  onClick={() => toggle(t.key)}
                >
                  <span className="mirroring-content-card-head">
                    <span className="card-title">{t.title}</span>
                    <span className="select-card-check" aria-hidden="true">✓ Selected</span>
                  </span>
                  <span className="mirroring-content-card-desc" id={`mirroring-content-desc-${t.key}`}>{t.description}</span>
                </button>
              );
            })}
          </div>
          <div className="field-control-support">
            {show("content") ? (
              <span id="error-mirroring-content" className="field-error" role="alert">{errors.content}</span>
            ) : null}
            <div className="field-helper" id="mirroring-content-helper">
              Select one or more. A selected card shows a check mark and a heavier border.
            </div>
          </div>
        </div>

        {deselectedButSaved.length ? (
          <div className="note" role="status">
            {deselectedButSaved.map((t) => t.title).join(" and ")} settings are kept in this profile and come back if you select {deselectedButSaved.length === 1 ? "it" : "them"} again.
          </div>
        ) : null}

        <div className="actions">
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Continue"}
          </Button>
          {onCancel ? (
            <Button variant="secondary" onClick={() => { drafts.delete(profile.id); onCancel(); }} disabled={saving}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
};

export default ContentSelection;
