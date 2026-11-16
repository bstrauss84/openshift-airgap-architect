/**
 * OpenShift Airgap Architect - the Red Hat source credential at one place of a
 * Mirroring profile (v2.2.0, R-UX02 / R-UX03)
 *
 * Shows, in this order of precedence:
 *  - the credential accepted here: which registries it covers (names only,
 *    never values), where it was entered, Replace and Forget;
 *  - the profile's credential entered elsewhere in this session, with
 *    "Use it here" (explicit reuse) or "Enter a different one";
 *  - otherwise the pull-secret field (paste, drag and drop, upload; link to
 *    console.redhat.com — no "Help me generate": a Red Hat pull secret is
 *    downloaded, not generated) and, when the server has one, the switch for
 *    the mounted pull secret.
 * The value lives in sourceCredentialSession.js (page memory only).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useState } from "react";
import Button from "../components/Button.jsx";
import SecretInput from "../components/SecretInput.jsx";
import OptionRow from "../components/OptionRow.jsx";
import Switch from "../components/Switch.jsx";
import { registriesIn } from "../shared/registryAuth.js";
import { useSourceCredential, SITE_LABEL } from "./sourceCredentialSession.js";

export const RED_HAT_PULL_SECRET_URL = "https://console.redhat.com/openshift/install/pull-secret";

const covers = (secret) => {
  const regs = registriesIn(secret);
  if (regs === null) return "not readable as auth JSON — the server will say why";
  return regs.length ? regs.join(", ") : "no registries";
};

export default function SourceCredentialField({ profileId, site, idPrefix, label = "Red Hat pull secret", hint, mountedAvailable = false, rows = 4, ariaLabel }) {
  const cred = useSourceCredential(profileId, site);
  const [replacing, setReplacing] = useState(false);
  const { entry } = cred;

  if (cred.usable && !replacing) {
    return (
      <div className="mirroring-source-cred" role="group" aria-label={label} id={`${idPrefix}-source-credential`}>
        <p className="note subtle mirroring-source-cred-status" role="status">
          {entry.mounted
            ? <><strong>Using the pull secret mounted into the container</strong> for this profile in this browser session.</>
            : <><strong>{label} entered for this profile</strong> (registries: {covers(entry.secret)}){entry.enteredFor !== site ? `, entered for ${SITE_LABEL[entry.enteredFor] || "another step"}` : ""}.</>}
          {" "}Kept in this page only — never saved, gone after a reload — and used for this profile&apos;s scans, catalog checks and runs where you accept it.
        </p>
        <div className="actions mirroring-source-cred-actions">
          <Button variant="secondary" className="mini" onClick={() => setReplacing(true)}>Replace</Button>
          <Button variant="secondary" className="mini" onClick={() => cred.forget()}>Forget</Button>
        </div>
      </div>
    );
  }

  if (cred.offerReuse && !replacing) {
    return (
      <div className="mirroring-source-cred" role="group" aria-label={label} id={`${idPrefix}-source-credential`}>
        <p className="note mirroring-source-cred-offer" role="status">
          {entry.mounted
            ? <>You chose the pull secret mounted into the container for {SITE_LABEL[entry.enteredFor] || "another step"} of this profile.</>
            : <>A {label.toLowerCase()} was entered for {SITE_LABEL[entry.enteredFor] || "another step"} of this profile in this session (registries: {covers(entry.secret)}).</>}
        </p>
        <div className="actions mirroring-source-cred-actions">
          <Button variant="primary" className="mini" onClick={() => cred.approve()}>Use it here</Button>
          <Button variant="secondary" className="mini" onClick={() => setReplacing(true)}>Enter a different one</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mirroring-source-cred" id={`${idPrefix}-source-credential`}>
      {mountedAvailable ? (
        <OptionRow title="Use the pull secret mounted into the container" description="Nothing is pasted; the server reads its mounted Red Hat pull secret for each request.">
          <Switch
            checked={false}
            onChange={(on) => { if (on) { cred.set({ mounted: true }); setReplacing(false); } }}
            aria-label="Use the pull secret mounted into the container"
          />
        </OptionRow>
      ) : null}
      <div className="credentials-field-constrained">
        <SecretInput
          id={`${idPrefix}-pull-secret`}
          value=""
          onChange={(v) => { if (String(v || "").trim()) { cred.set({ secret: v }); setReplacing(false); } }}
          label={label}
          labelEmphasis={label}
          hint={hint}
          getPullSecretUrl={RED_HAT_PULL_SECRET_URL}
          rows={rows}
          aria-label={ariaLabel}
        />
      </div>
      {replacing ? (
        <div className="actions"><Button variant="secondary" className="mini" onClick={() => setReplacing(false)}>Cancel</Button></div>
      ) : null}
    </div>
  );
}
