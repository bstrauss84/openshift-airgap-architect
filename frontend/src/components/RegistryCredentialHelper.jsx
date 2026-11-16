/**
 * OpenShift Airgap Architect - "Help me generate" registry credentials (v2.2.0)
 *
 * For a user who has a registry address, a user name and a password or token,
 * but no auth JSON: builds it in memory (shared/registryAuth.js) and hands it
 * to the field that opened the dialog. One or more registries; optionally kept
 * together with the registries already in that field (an explicit choice; a
 * registry that would change account is refused).
 *
 * Nothing is stored, copied to the clipboard or shown back: the password field
 * is masked, autofill is discouraged, the generated JSON is not displayed, and
 * every value is dropped when the dialog closes.
 *
 * Browsers' "save password?" prompt (owner report, 2026-11-03): these are
 * credentials for ANOTHER system, not a login to Architect. The dialog is a
 * real <form autocomplete="off"> that submits to nothing (Enter = Use these
 * credentials), both fields say autocomplete="off" (not "new-password", which
 * signals account creation and invites saving), the documented opt-outs of
 * common password managers are set, and the values are emptied in the DOM
 * before the dialog is removed, so the fields a browser inspects on removal
 * are empty. Browsers and extensions may still ignore these hints; nothing
 * here can guarantee that no prompt appears, and none of it weakens masking.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useState } from "react";
import { flushSync } from "react-dom";
import Modal from "./Modal.jsx";
import Button from "./Button.jsx";
import FieldLabelWithInfo from "./FieldLabelWithInfo.jsx";
import { buildAuthJson, entryProblems, registriesIn, normalizeRegistryKey } from "../shared/registryAuth.js";

const REGISTRY_HINT = `The registry these credentials are for, as host[:port] — exactly how images from it are named.

**Why it matters:**
oc-mirror picks credentials by registry address, so these are offered to this registry only.

**Examples:**
quay.io · registry.example.com · mirror.example.com:8443 · mirror.example.com:8443/ocp (a path limits the credentials to that part of the registry)

**Important notes:**
• No https://, user name or password in the address.
• ⚠️ Credentials are sent only to the registry named here; check the spelling and the port.`;

const SECRET_HINT = `The password, or an access token the registry issued (robot account, application password, personal access token).

**How it is used:**
Combined with the user name and encoded as the registry expects, in your browser. It is not stored, not shown again and not copied anywhere; it travels to the server only with this run.

**Example:**
A Quay robot account: user name myorg+mirror, token from the robot account page.

**Important notes:**
• ⚠️ Encoding is not encryption: treat the generated credentials like the password itself.
• Any character is allowed.`;

const blank = () => ({ id: Math.random().toString(36).slice(2), registry: "", username: "", password: "" });

/** Attributes that ask password managers not to offer saving or filling these fields (hints only). */
const NOT_A_LOGIN = { autoComplete: "off", "data-lpignore": "true", "data-1p-ignore": "true", "data-bwignore": "true", "data-form-type": "other" };

export default function RegistryCredentialHelper({ isOpen, onClose, onUse, idPrefix, title, purpose, defaultRegistry = "", existing = "" }) {
  const [entries, setEntries] = useState(() => [{ ...blank(), registry: defaultRegistry }]);
  const [touched, setTouched] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [keepExisting, setKeepExisting] = useState(false);
  const [error, setError] = useState("");
  const existingRegistries = registriesIn(existing);
  const titleId = `${idPrefix}-cred-helper-title`;

  // Forget every value when the dialog closes, whichever way.
  // Empty the fields in the DOM first (synchronously), then let the dialog go.
  const clearFields = () => flushSync(() => setEntries((list) => list.map((e) => ({ ...e, username: "", password: "" }))));
  const close = () => {
    clearFields();
    setEntries([{ ...blank(), registry: defaultRegistry }]);
    setTouched({});
    setAttempted(false);
    setKeepExisting(false);
    setError("");
    onClose();
  };
  const update = (id, field, value) => setEntries((list) => list.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
  const problemsOf = (e) => entryProblems(e);
  const anyProblem = entries.some((e) => Object.values(problemsOf(e)).some(Boolean));

  const use = () => {
    setAttempted(true);
    setError("");
    if (anyProblem) return;
    try {
      const json = buildAuthJson(entries, { existing, keepExisting });
      // Which registries the user typed here (names only): lets the caller relate them to its destination.
      const registries = entries.map((e) => normalizeRegistryKey(e.registry)).filter(Boolean);
      onUse(json, { registries });
      close();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} ariaLabelledBy={titleId} className="modal registry-cred-helper">
      <h3 id={titleId}>{title}</h3>
      <form autoComplete="off" noValidate className="registry-cred-form" aria-labelledby={titleId} onSubmit={(ev) => { ev.preventDefault(); use(); }}>
      <p className="modal-copy">{purpose} Enter the registry, the user name and the password or token; Architect builds the credentials file oc-mirror needs. Nothing is stored, and the values are cleared when this dialog closes.</p>
      {entries.map((e, i) => {
        const p = problemsOf(e);
        const show = (field) => Boolean(p[field]) && (attempted || touched[`${e.id}-${field}`]);
        const f = (field) => `${idPrefix}-cred-${e.id}-${field}`;
        return (
          <fieldset key={e.id} className="registry-cred-entry">
            <legend>{entries.length > 1 ? `Registry ${i + 1}` : "Registry"}</legend>
            <div className="field-control-stack">
              <FieldLabelWithInfo label="Registry address" hint={REGISTRY_HINT}>
                <input id={f("registry")} type="text" value={e.registry} placeholder="mirror.example.com:8443" {...NOT_A_LOGIN} spellCheck={false}
                  className={show("registry") ? "input-error" : ""} aria-invalid={show("registry") ? "true" : undefined} aria-describedby={show("registry") ? `${f("registry")}-error` : undefined}
                  onChange={(ev) => update(e.id, "registry", ev.target.value)} onBlur={() => setTouched((t) => ({ ...t, [`${e.id}-registry`]: true }))} />
              </FieldLabelWithInfo>
              <div className="field-control-support">{show("registry") ? <span id={`${f("registry")}-error`} className="field-error" role="alert">{p.registry}</span> : null}</div>
            </div>
            <div className="registry-cred-pair">
              <div className="field-control-stack">
                <FieldLabelWithInfo label="User name" hint={`The account name on that registry.

**For a token:**
Use the name the registry pairs with it — a robot or service account, or your own user name for a personal access token.

**Example:**
mirror-user, or a robot account such as myorg+mirror.

**Important notes:**
• A colon is not allowed in a user name (it separates name and password).
• Not stored anywhere.`}>
                  <input id={f("username")} type="text" value={e.username} {...NOT_A_LOGIN} spellCheck={false}
                    className={show("username") ? "input-error" : ""} aria-invalid={show("username") ? "true" : undefined} aria-describedby={show("username") ? `${f("username")}-error` : undefined}
                    onChange={(ev) => update(e.id, "username", ev.target.value)} onBlur={() => setTouched((t) => ({ ...t, [`${e.id}-username`]: true }))} />
                </FieldLabelWithInfo>
                <div className="field-control-support">{show("username") ? <span id={`${f("username")}-error`} className="field-error" role="alert">{p.username}</span> : null}</div>
              </div>
              <div className="field-control-stack">
                <FieldLabelWithInfo label="Password or token" hint={SECRET_HINT}>
                  <input id={f("password")} type="password" value={e.password} {...NOT_A_LOGIN}
                    className={show("password") ? "input-error" : ""} aria-invalid={show("password") ? "true" : undefined} aria-describedby={show("password") ? `${f("password")}-error` : undefined}
                    onChange={(ev) => update(e.id, "password", ev.target.value)} onBlur={() => setTouched((t) => ({ ...t, [`${e.id}-password`]: true }))} />
                </FieldLabelWithInfo>
                <div className="field-control-support">{show("password") ? <span id={`${f("password")}-error`} className="field-error" role="alert">{p.password}</span> : null}</div>
              </div>
            </div>
            {entries.length > 1 ? <Button variant="secondary" className="mini" onClick={() => setEntries((list) => list.filter((x) => x.id !== e.id))}>Remove this registry</Button> : null}
          </fieldset>
        );
      })}
      <div className="actions">
        <Button variant="secondary" className="mini" onClick={() => setEntries((list) => [...list, blank()])} disabled={entries.length >= 10}>Add another registry</Button>
      </div>
      {existingRegistries && existingRegistries.length ? (
        <label className="registry-cred-keep">
          <input type="checkbox" checked={keepExisting} onChange={(ev) => setKeepExisting(ev.target.checked)} />
          {" "}Keep the registries already in the field ({existingRegistries.join(", ")})
        </label>
      ) : null}
      {existing.trim() && existingRegistries === null ? <p className="note subtle">The field already holds text that is not credentials JSON; it will be replaced.</p> : null}
      {!anyProblem ? (
        <p className="note subtle" role="status">
          Will use: {entries.map((e) => `${normalizeRegistryKey(e.registry)} as ${e.username.trim()}`).join("; ")}{keepExisting && existingRegistries?.length ? `; plus ${existingRegistries.join(", ")} as before` : ""}.
        </p>
      ) : null}
      {error ? <div className="note warning" role="alert">{error}</div> : null}
      <div className="actions">
        <Button variant="secondary" type="button" onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit">Use these credentials</Button>
      </div>
      </form>
    </Modal>
  );
}
