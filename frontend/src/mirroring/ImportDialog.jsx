/**
 * OpenShift Airgap Architect - import ImageSetConfiguration files (v2.2.0 M4)
 *
 * Choose files -> the server validates and maps them (POST
 * /api/mirroring/import/analyze, nothing saved) -> review each file's status,
 * what it maps to, what cannot be represented, and any merge conflicts ->
 * Import (POST /api/mirroring/import/apply, one atomic write).
 *
 * Status vocabulary, never shown by colour alone:
 *  - "Not a valid ImageSetConfiguration" (YAML or shape problems; never imported)
 *  - "Valid structure — needs review" (parts the editor cannot represent)
 *  - "Valid structure — catalogs not checked yet" (operators to verify live)
 *  - "Valid structure"
 *
 * Files are read as raw bytes and sent base64-encoded so the server's UTF-8
 * check sees exactly what is on disk.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import Modal from "../components/Modal.jsx";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import { analyzeImport, applyImport } from "./mirroringApi.js";
import { IMPORT_FILES_HINT, IMPORT_MODE_HINT } from "./mirroringCopy.js";

const MAX_FILES = 10;
const MAX_BYTES = 1024 * 1024;

const toBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const readFile = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve({ name: file.name, contentBase64: toBase64(reader.result) });
  reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
  reader.readAsArrayBuffer(file);
});

export const fileStatus = (f) => {
  if (f.status === "invalid") return { icon: "✕", label: "Not a valid ImageSetConfiguration", tone: "error" };
  if (!f.representable) return { icon: "!", label: "Valid structure — nothing here can be represented in a profile", tone: "warning" };
  if ((f.unresolved || []).length) return { icon: "!", label: `Valid structure — needs review (${f.unresolved.length} part(s) cannot be represented)`, tone: "warning" };
  if (f.summary?.operators) return { icon: "…", label: "Valid structure — operator catalogs not checked yet", tone: "info" };
  return { icon: "✓", label: "Valid structure", tone: "ok" };
};

const summaryLines = (s) => {
  const lines = [];
  if (s.content.platform) lines.push(`OpenShift release ${s.platformRelease}`);
  if (s.content.operators) lines.push(`${s.operators} operator(s) from the OpenShift ${s.catalogMinor} catalogs${s.operatorsWithoutChannel ? ` (${s.operatorsWithoutChannel} without a channel: resolved from the scanned catalogs later)` : ""}`);
  if (s.content.additionalImages) lines.push(`${s.images} additional image(s)`);
  if (s.archiveSize) lines.push(`Archive size ${s.archiveSize} GiB`);
  return lines;
};

const ImportDialog = ({ isOpen, onClose, onImported, activeProfile = null }) => {
  const [files, setFiles] = useState([]); // [{ name, contentBase64 }]
  const [analysis, setAnalysis] = useState(null);
  const [mode, setMode] = useState("separate");
  const [resolutions, setResolutions] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const inputRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!isOpen) {
      setFiles([]); setAnalysis(null); setMode("separate"); setResolutions({}); setError(""); setReadError("");
    }
  }, [isOpen]);

  // Re-analyse whenever the files, the mode or the target change.
  useEffect(() => {
    if (!files.length) { setAnalysis(null); return undefined; }
    const mySeq = ++seq.current;
    setBusy(true);
    setError("");
    analyzeImport({ files, mode, ...(mode === "into" && activeProfile ? { profileId: activeProfile.id } : {}) })
      .then((r) => { if (mySeq === seq.current) setAnalysis(r); })
      .catch((e) => { if (mySeq === seq.current) { setAnalysis(null); setError(e.message || String(e)); } })
      .finally(() => { if (mySeq === seq.current) setBusy(false); });
    return undefined;
  }, [files, mode, activeProfile]);

  const chooseFiles = async (list) => {
    setReadError("");
    const chosen = Array.from(list || []);
    if (chosen.length > MAX_FILES) { setReadError(`Choose at most ${MAX_FILES} files.`); return; }
    const big = chosen.find((f) => f.size > MAX_BYTES);
    if (big) { setReadError(`${big.name} is larger than 1 MiB; an ImageSetConfiguration is normally a few kilobytes.`); return; }
    try {
      setFiles(await Promise.all(chosen.map(readFile)));
      setResolutions({});
    } catch (e) {
      setReadError(e.message);
    }
  };
  const removeFile = (index) => {
    setFiles((fs) => fs.filter((_, i) => i !== index));
    setResolutions({});
  };

  const validCount = analysis ? analysis.files.filter((f) => f.status === "valid").length : 0;
  const unresolvedConflicts = useMemo(
    () => (analysis?.conflicts || []).filter((c) => !c.options.some((o) => o.id === resolutions[c.id])),
    [analysis, resolutions]
  );
  const canImport = Boolean(analysis) && !busy && analysis.blocking.length === 0 && unresolvedConflicts.length === 0;

  const doImport = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await applyImport({ files, mode, resolutions, ...(mode === "into" && activeProfile ? { profileId: activeProfile.id } : {}) });
      onImported(result);
      onClose();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabelledBy="mirroring-import-title" className="modal mirroring-import-modal">
      <h3 id="mirroring-import-title">Import ImageSetConfiguration files</h3>
      <p className="modal-copy subtle">
        Nothing is saved until you choose Import. Files are checked on the server; oc-mirror is not run.
      </p>

      <div className="field-control-stack">
        <FieldLabelWithInfo label="Files to import" hint={IMPORT_FILES_HINT}>
          <input
            ref={inputRef}
            id="mirroring-import-files"
            type="file"
            multiple
            accept=".yaml,.yml,application/yaml,text/yaml,application/x-yaml"
            onChange={(e) => chooseFiles(e.target.files)}
            aria-describedby={readError ? "error-mirroring-import-files" : "mirroring-import-files-help"}
            aria-invalid={readError ? "true" : undefined}
          />
        </FieldLabelWithInfo>
        <div className="field-control-support">
          {readError ? <span id="error-mirroring-import-files" className="field-error" role="alert">{readError}</span> : null}
          <div className="field-helper" id="mirroring-import-files-help">Up to {MAX_FILES} .yaml files, 1 MiB each.</div>
        </div>
      </div>

      {busy && !analysis ? <div className="loading" role="status">Checking the files…</div> : null}
      {error ? <Banner variant="error">{error}</Banner> : null}

      {analysis ? (
        <ul className="mirroring-import-files" aria-label="Checked files">
          {analysis.files.map((f) => {
            const st = fileStatus(f);
            return (
              <li key={`${f.index}-${f.sha256}`} className={`mirroring-import-file tone-${st.tone}`}>
                <div className="mirroring-import-file-head">
                  <strong className="mirroring-import-file-name">{f.fileName}</strong>
                  <Button variant="secondary" className="mini" onClick={() => removeFile(f.index)} aria-label={`Remove ${f.fileName} from the import`}>Remove</Button>
                </div>
                <div className="mirroring-import-status" role="status">
                  <span aria-hidden="true" className="mirroring-import-status-icon">{st.icon}</span> {st.label}
                </div>
                <div className="subtle mirroring-import-meta">{f.bytes} bytes · SHA-256 {f.sha256.slice(0, 12)}…</div>
                {f.status === "invalid" ? (
                  <ul className="mirroring-import-findings">
                    {f.errors.slice(0, 8).map((e, i) => (
                      <li key={i}>{e.line ? `Line ${e.line}: ` : ""}{e.message}</li>
                    ))}
                    {f.errors.length > 8 ? <li>…and {f.errors.length - 8} more.</li> : null}
                  </ul>
                ) : (
                  <>
                    <ul className="mirroring-import-findings">
                      {summaryLines(f.summary).map((l) => <li key={l}>{l}</li>)}
                    </ul>
                    {f.summary.catalogPlatformMismatch ? (
                      <p className="note warning">
                        The operator catalogs are for OpenShift {f.summary.catalogPlatformMismatch.catalogMinor} but the platform release is{" "}
                        {f.summary.catalogPlatformMismatch.platformMinor}. They are imported as written; the profile then asks whether to align
                        the catalogs to the platform or move the operators into their own profile.
                      </p>
                    ) : null}
                    {f.unresolved?.length ? (
                      <div className="note warning">
                        <strong>Cannot be represented here (kept in the original file):</strong>
                        <ul className="mirroring-import-findings">
                          {f.unresolved.map((u) => <li key={u.id}>{u.message}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {f.warnings?.length ? (
                      <details className="mirroring-import-warnings">
                        <summary>{f.warnings.length} note(s) about how the file is read</summary>
                        <ul className="mirroring-import-findings">{f.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
                      </details>
                    ) : null}
                    {f.alreadyImportedInto?.length ? (
                      <p className="subtle">This exact file is already imported into: {f.alreadyImportedInto.join(", ")}.</p>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {analysis && (validCount >= 1) ? (
        <div className="mirroring-import-mode">
          <FieldLabelWithInfo label="How to import" hint={IMPORT_MODE_HINT} />
          <div role="radiogroup" aria-label="How to import">
          <label className="toggle-row">
            <input type="radio" name="mirroring-import-mode" value="separate" checked={mode === "separate"} onChange={() => setMode("separate")} />{" "}
            One profile per file
          </label>
          {validCount >= 2 ? (
            <label className="toggle-row">
              <input type="radio" name="mirroring-import-mode" value="merge" checked={mode === "merge"} onChange={() => setMode("merge")} />{" "}
              Merge into one new profile
            </label>
          ) : null}
          {activeProfile ? (
            <label className="toggle-row">
              <input type="radio" name="mirroring-import-mode" value="into" checked={mode === "into"} onChange={() => setMode("into")} />{" "}
              Add to the open profile &ldquo;{activeProfile.name}&rdquo;
            </label>
          ) : null}
          </div>
        </div>
      ) : null}

      {analysis?.conflicts?.length ? (
        <div className="mirroring-import-conflicts">
          <h4>Choose where the files disagree ({analysis.conflicts.length - unresolvedConflicts.length} of {analysis.conflicts.length} chosen)</h4>
          {analysis.conflicts.map((c) => (
            <fieldset key={c.id} className="mirroring-import-conflict">
              <legend>{c.message}</legend>
              {c.options.map((o) => (
                <label key={o.id} className="toggle-row">
                  <input
                    type="radio"
                    name={`conflict-${c.id}`}
                    value={o.id}
                    checked={resolutions[c.id] === o.id}
                    onChange={() => setResolutions((r) => ({ ...r, [c.id]: o.id }))}
                  />{" "}
                  {o.label}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      ) : null}

      {analysis?.blocking?.length ? (
        <div className="note warning" role="status">
          {analysis.blocking.map((b) => <div key={b}>{b}</div>)}
        </div>
      ) : null}

      <div className="actions">
        <Button variant="primary" onClick={doImport} disabled={!canImport}>
          {busy && analysis ? "Working…" : mode === "into" ? "Import into this profile" : "Import"}
        </Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
};

export default ImportDialog;
