/**
 * OpenShift Airgap Architect - destination (mirror registry) credentials for
 * a Mirroring run (v2.2.0)
 *
 * The same choice Install offers for its mirror registry ("Anonymous pulls" in
 * Identity & Access): use real credentials — pasted, uploaded or made with
 * Help me generate (the shared generator; destination only) — or anonymous
 * access, which sends the OKD-documented placeholder credential for the
 * destination host. The value stays in the caller's memory for this page.
 *
 * The destination (docker://host[:port][/path], the push target) and the
 * credentials (auth keys: which registries they are for) are different
 * things, so they are related, never merged (owner B, 2026-11-03):
 *  - Help me generate starts from the destination's host[:port];
 *  - when it returns ONE registry and the destination is empty, that registry
 *    becomes the destination (exactly as typed — no path added or removed);
 *  - when it returns one registry that does not cover a set destination, the
 *    user chooses (use it as the destination / keep the destination);
 *  - several registries, or pasted JSON with several entries: no guess;
 *  - whenever the credentials cover none of the destination, a warning says
 *    so. Cancel never changes anything.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useEffect, useState } from "react";
import Button from "../components/Button.jsx";
import SecretInput from "../components/SecretInput.jsx";
import RegistryCredentialHelper from "../components/RegistryCredentialHelper.jsx";
import { anonymousRegistryAuthJson, normalizeRegistryKey, registriesIn, OKD_ANONYMOUS_DOC_URL } from "../shared/registryAuth.js";

/** The registry host[:port] a destination URL names (the auth key), or "". */
export const destinationHost = (registryUrl) => {
  const host = String(registryUrl || "").trim().replace(/^docker:\/\//, "").split("/")[0];
  return normalizeRegistryKey(host) ? host.toLowerCase() : "";
};

/** The destination as an auth-key-shaped string, host[:port][/path] (lower-case host), or "". */
export const destinationKey = (registryUrl) => {
  const raw = String(registryUrl || "").trim().replace(/^docker:\/\//, "").replace(/\/+$/, "");
  return normalizeRegistryKey(raw) || "";
};

/**
 * Whether credentials with these auth keys apply to the destination: a key
 * equal to it, or a prefix of it at a path boundary (as containers/image looks
 * them up; mirror.example.com:8443 covers mirror.example.com:8443/ocp, not the
 * reverse).
 */
export const credentialsCover = (keys, destKey) => Boolean(destKey) && (keys || []).some((k) => destKey === k || destKey.startsWith(`${k}/`));

/**
 * @param {object} p
 * @param {string} p.value          the credential JSON sent with the run
 * @param {(v: string) => void} p.onChange
 * @param {boolean} p.anonymous
 * @param {(on: boolean) => void} p.onAnonymousChange
 */
export default function DestinationCredentialsField({ idPrefix, registryUrl, value, onChange, anonymous, onAnonymousChange, onDestinationChange = null, hint, purpose = "For the registry oc-mirror pushes into. The account needs push rights on the destination path.", disabled = false }) {
  const [helperOpen, setHelperOpen] = useState(false);
  const [backup, setBackup] = useState("");
  // A choice the user has to make after Help me generate (one registry that does not cover the destination).
  const [pending, setPending] = useState(null);
  // A note about the destination, shown only while the destination is still the one it describes.
  const [notice, setNoticeState] = useState(null);
  const host = destinationHost(registryUrl);
  const destKey = destinationKey(registryUrl);
  const keys = anonymous ? null : registriesIn(value);
  const setNotice = (text, forDest = destKey) => setNoticeState(text ? { text, forDest } : null);
  const mismatch = !anonymous && !pending && Array.isArray(keys) && keys.length > 0 && destKey && !credentialsCover(keys, destKey);

  // The credentials from Help me generate, related to the destination (never silently re-targeted).
  const useGenerated = (json, meta = {}) => {
    onChange(json);
    setNotice("");
    setPending(null);
    const regs = meta.registries || [];
    if (regs.length !== 1) {
      if (!destKey && regs.length > 1) setNotice("These credentials name several registries, so none is taken as the destination. Enter the destination registry above.");
      return;
    }
    const reg = regs[0];
    if (!destKey) {
      if (onDestinationChange) {
        onDestinationChange(reg);
        setNotice(`Destination set to ${reg} from the credentials. Add a path (for example ${reg}/ocp) if the images should go under one.`, destinationKey(reg));
      }
      return;
    }
    if (!credentialsCover([reg], destKey)) setPending({ reg });
  };

  // Anonymous follows the destination host: the placeholder names exactly that registry.
  useEffect(() => {
    if (!anonymous) return;
    const next = host ? anonymousRegistryAuthJson(host) : "";
    if (next !== value) onChange(next);
  }, [anonymous, host]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (anon) => {
    if (anon === anonymous) return;
    if (anon) setBackup(value);
    onAnonymousChange(anon);
    if (!anon) onChange(backup);
  };

  return (
    <div className="mirroring-destination-cred credentials-field-constrained">
      <fieldset className="mirroring-destination-auth" disabled={disabled}>
        <legend className="credentials-mirror-label">Destination registry authentication</legend>
        <label className="toggle-row">
          <input type="radio" name={`${idPrefix}-dest-auth`} checked={!anonymous} onChange={() => choose(false)} />
          <span>Use destination registry credentials (paste, upload, or generate)</span>
        </label>
        <label className="toggle-row">
          <input type="radio" name={`${idPrefix}-dest-auth`} checked={anonymous} onChange={() => choose(true)} aria-describedby={`${idPrefix}-dest-okd`} />
          <span>Anonymous access (the registry needs no credentials)</span>
        </label>
      </fieldset>
      {notice && notice.forDest === destKey ? <p className="note subtle" role="status">{notice.text}</p> : null}
      {pending ? (
        <div className="note warning mirroring-destination-choice" role="alert">
          These credentials are for <code>{pending.reg}</code>, but the destination is <code>{destKey}</code>. Which should be used?
          <div className="actions">
            {onDestinationChange ? <Button variant="secondary" className="mini" onClick={() => { onDestinationChange(pending.reg); setPending(null); }} disabled={disabled}>{`Use ${pending.reg} as the destination`}</Button> : null}
            <Button variant="secondary" className="mini" onClick={() => setPending(null)}>{`Keep ${destKey}`}</Button>
          </div>
        </div>
      ) : null}
      {mismatch ? (
        <p className="note warning" role="status">
          None of these credentials is for the destination <code>{destKey}</code> (they are for {keys.join(", ")}). oc-mirror would push there without
          credentials. Add credentials for it, choose Anonymous access if it needs none, or correct the destination.
        </p>
      ) : null}
      {!anonymous && !destKey && Array.isArray(keys) && keys.length === 1 && onDestinationChange ? (
        <p className="note subtle">
          The credentials are for <code>{keys[0]}</code>.{" "}
          <Button variant="secondary" className="mini" onClick={() => onDestinationChange(keys[0])} disabled={disabled}>{`Use ${keys[0]} as the destination`}</Button>
        </p>
      ) : null}
      {anonymous ? (
        <div id={`${idPrefix}-dest-okd`} className="note warning mirroring-destination-okd">
          Uses the <a href={OKD_ANONYMOUS_DOC_URL} target="_blank" rel="noopener noreferrer">OKD-documented dummy pull secret</a> for
          {" "}{host ? <code>{host}</code> : "the destination registry"} — a placeholder, not an account. Choose this only when the registry
          accepts pushes without logging in; a registry that requires a login refuses the run.
          {!host ? <div><strong>Enter the destination registry first</strong>; the placeholder names its host.</div> : null}
        </div>
      ) : (
        <>
          <SecretInput
            id={`${idPrefix}-mirror-secret`}
            label="Destination registry credentials"
            hint={hint}
            value={value}
            onChange={onChange}
            rows={3}
            placeholder='Paste, drag and drop, or upload {"auths":{"mirror.example.com:8443":{"auth":"…"}}}'
            additionalButtons={<Button variant="secondary" className="mini" onClick={() => setHelperOpen(true)} disabled={disabled}>Help me generate</Button>}
          />
          <RegistryCredentialHelper
            key={helperOpen ? "open" : "closed"}
            isOpen={helperOpen}
            onClose={() => setHelperOpen(false)}
            idPrefix={`${idPrefix}-destination`}
            title="Destination registry credentials"
            purpose={purpose}
            defaultRegistry={host}
            existing={value}
            onUse={useGenerated}
          />
        </>
      )}
    </div>
  );
}
