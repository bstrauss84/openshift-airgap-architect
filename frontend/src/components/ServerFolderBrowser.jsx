/**
 * OpenShift Airgap Architect - choose a folder on the server (v2.2.0)
 *
 * The browser cannot open a native folder picker for the server's (or
 * container's) filesystem, so — like Install's Run oc-mirror "Browse" — this
 * lists folders through the server. Directories only, starting from the
 * locations the server allows (data directory, /tmp, mounted volumes, existing
 * locations); any other path can still be typed in the field.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import Button from "./Button.jsx";

export default function ServerFolderBrowser({ isOpen, onClose, onSelect, list, startPath = null, idPrefix, title = "Choose a folder on the server" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = async (p) => {
    setLoading(true);
    setError("");
    try {
      setData(await list(p));
    } catch (e) {
      setError(e.message || String(e));
      if (p) { try { setData(await list(null)); } catch { /* keep the error */ } }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (isOpen) load(startPath); }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const titleId = `${idPrefix}-browse-title`;
  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabelledBy={titleId} className="modal server-folder-browser">
      <h3 id={titleId}>{title}</h3>
      <p className="modal-copy subtle">Folders on the server — inside its container when it runs in one. A disk mounted at /mnt/mirror-data appears as /mnt/mirror-data.</p>
      {error ? <div className="note warning" role="alert">{error}</div> : null}
      {loading ? <p className="note subtle" role="status">Loading…</p> : null}
      {data && !data.path ? (
        <>
          <p className="server-folder-current"><strong>Start from</strong></p>
          <ul className="server-folder-list" aria-label="Locations">
            {data.roots.map((r) => <li key={r}><Button variant="secondary" className="mini" onClick={() => load(r)}>{r}</Button></li>)}
          </ul>
        </>
      ) : null}
      {data?.path ? (
        <>
          <p className="server-folder-current" aria-live="polite"><strong>Current folder:</strong> <code>{data.path}</code>{data.writable === false ? " — the server cannot write here" : ""}</p>
          {data.requestedMissing ? <p className="note subtle">That folder does not exist yet; showing the nearest existing one. A missing last folder is created when you use it.</p> : null}
          <div className="actions">
            <Button variant="secondary" className="mini" onClick={() => load(data.parent)} disabled={!data.parent}>Up one level</Button>
            <Button variant="secondary" className="mini" onClick={() => load(null)}>Other locations</Button>
          </div>
          {data.entries.length ? (
            <ul className="server-folder-list" aria-label={`Folders in ${data.path}`}>
              {data.entries.map((n) => <li key={n}><Button variant="secondary" className="mini" onClick={() => load(`${data.path.replace(/\/$/, "")}/${n}`)}>{n}/</Button></li>)}
            </ul>
          ) : <p className="note subtle">No folders here.</p>}
        </>
      ) : null}
      <div className="actions">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => onSelect(data.path)} disabled={!data?.path || data.writable === false}>Use this folder</Button>
      </div>
    </Modal>
  );
}
