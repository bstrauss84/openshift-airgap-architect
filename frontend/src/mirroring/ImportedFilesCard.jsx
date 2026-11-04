/**
 * OpenShift Airgap Architect - files imported into a profile (v2.2.0 M4)
 *
 * Provenance (file name, SHA-256, when, how), a read-only view of the stored
 * original, and the parts of each file the guided editor cannot represent.
 * Those parts are never changed silently: each stays "needs review" — and
 * blocks generation — until the user leaves it out explicitly. The original
 * file always keeps them.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import Modal from "../components/Modal.jsx";
import { fetchImportOriginal, reviewImport } from "./mirroringApi.js";

const MODE_LABEL = { separate: "Imported as its own profile", merge: "Merged with other files", into: "Added to this profile" };

const ImportedFilesCard = ({ profile, onProfileChanged }) => {
  const [original, setOriginal] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const imports = profile.imports || [];
  if (!imports.length) return null;

  const view = async (imp) => {
    setError("");
    try {
      setOriginal(await fetchImportOriginal(profile.id, imp.id));
    } catch (e) {
      setError(e.message || String(e));
    }
  };
  const omit = async (imp, itemIds) => {
    setBusy(true);
    setError("");
    try {
      onProfileChanged(await reviewImport(profile.id, imp.id, itemIds));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby={`mirroring-imports-heading-${profile.id}`}>
      <h3 id={`mirroring-imports-heading-${profile.id}`}>Imported files</h3>
      <p className="card-subtitle mirroring-card-subtitle">
        The originals are stored unchanged on the server next to this profile and verified against their SHA-256 when shown.
      </p>
      {error ? <Banner variant="error">{error}</Banner> : null}
      <ul className="mirroring-import-records">
        {imports.map((imp) => {
          const open = imp.unresolved.filter((u) => u.status === "open");
          return (
            <li key={imp.id} className="mirroring-import-record">
              <div className="mirroring-import-file-head">
                <strong className="mirroring-import-file-name">{imp.fileName}</strong>
                <Button variant="secondary" className="mini" onClick={() => view(imp)} aria-label={`View the original ${imp.fileName}`}>View original</Button>
              </div>
              <div className="subtle mirroring-import-meta">
                {MODE_LABEL[imp.mode] || "Imported"} · {new Date(imp.importedAt).toLocaleString()} · {imp.bytes} bytes · SHA-256 <code>{imp.sha256}</code>
              </div>
              {imp.unresolved.length ? (
                <div className={open.length ? "note warning" : "note"} role="status">
                  <strong>
                    {open.length
                      ? `Needs review: ${open.length} part(s) of this file cannot be represented in the editor.`
                      : "Every part this editor cannot represent has been left out of the profile."}
                  </strong>
                  <ul className="mirroring-import-findings">
                    {imp.unresolved.map((u) => (
                      <li key={u.id} className="mirroring-import-item">
                        <span>
                          <span className="mirroring-import-item-state">{u.status === "open" ? "Needs review:" : "Left out (still in the original):"}</span>{" "}
                          {u.message}
                        </span>
                        {u.status === "open" ? (
                          <Button variant="secondary" className="mini" disabled={busy} onClick={() => omit(imp, [u.id])} aria-label={`Leave out of this profile: ${u.path}`}>
                            Leave out
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {open.length > 1 ? (
                    <div className="actions">
                      <Button variant="secondary" disabled={busy} onClick={() => omit(imp, "all")}>Leave all {open.length} out of this profile</Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Modal isOpen={Boolean(original)} onClose={() => setOriginal(null)} ariaLabelledBy="mirroring-import-original-title" className="modal mirroring-import-modal">
        <h3 id="mirroring-import-original-title">Original: {original?.fileName}</h3>
        <p className="modal-copy subtle">Read-only. SHA-256 {original?.sha256} (verified). {original?.bytes} bytes.</p>
        <pre className="mirroring-import-original" tabIndex={0} aria-label={`Contents of ${original?.fileName}`}>{original?.content}</pre>
        <div className="actions">
          <Button variant="secondary" onClick={() => setOriginal(null)}>Close</Button>
        </div>
      </Modal>
    </section>
  );
};

export default ImportedFilesCard;
