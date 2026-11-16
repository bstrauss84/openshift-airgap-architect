/**
 * OpenShift Airgap Architect - post-import follow-up notice (PHX-033, PHX-035)
 *
 * Shown above every step after a run import, so it is seen wherever the import
 * lands (a locked run opens on its first attention step, not on Blueprint).
 * Lists only what this imported run still needs and where to enter it; each
 * entry drops out once it is re-entered, and the notice disappears with the
 * last one. Values are never displayed.
 */
import React from "react";
import Button from "./Button.jsx";
import { getImportFollowUps } from "../importFollowUp.js";

function FollowUpList({ items }) {
  return (
    <ul style={{ marginTop: 6, marginBottom: 0, paddingLeft: 24 }}>
      {items.map((item) => (
        <li key={item.id} data-import-follow-up={item.id}>
          <strong>{item.label}</strong> — {item.where}
        </li>
      ))}
    </ul>
  );
}

export default function ImportFollowUpNotice({ state, onDismiss }) {
  const { credentials, certificates } = getImportFollowUps(state);
  if (credentials.length === 0 && certificates.length === 0) return null;
  return (
    <div className="note warning import-follow-up-notice" role="status" data-testid="import-follow-up-notice">
      <strong>Imported run: re-enter what was left out of the file</strong>
      {credentials.length > 0 ? (
        <>
          <p style={{ marginTop: 6, marginBottom: 0 }}>
            Saved runs never include credentials. This run needs:
          </p>
          <FollowUpList items={credentials} />
        </>
      ) : null}
      {certificates.length > 0 ? (
        <>
          <p style={{ marginTop: 6, marginBottom: 0 }}>
            Certificates are missing from the imported file and may need to be added again:
          </p>
          <FollowUpList items={certificates} />
        </>
      ) : null}
      <div className="actions" style={{ marginTop: 8 }}>
        <Button onClick={onDismiss}>Dismiss</Button>
      </div>
    </div>
  );
}
