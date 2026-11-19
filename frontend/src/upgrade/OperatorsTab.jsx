/**
 * OpenShift Airgap Architect - Upgrade › "Import previous configuration" (v2.3.0 UX correction).
 *
 * Rendered inside a modal on the Content step (it no longer owns a whole tab). The normal operator
 * experience is Mirroring's own (Quick Picks, scan, browse, constraints) per stage; this importer
 * only SUGGESTS operators, images and release hints from earlier ImageSetConfiguration files.
 *
 * Two clearly separated things:
 *  1. Optional PRESETS from earlier ImageSetConfiguration files: what someone
 *     once asked oc-mirror to mirror. Reviewed, edited and accepted by the
 *     user; always labelled "imported preset (unverified)" with the file(s)
 *     each item came from. Never presented as installed, mirrored or current.
 *  2. The plan's operator list: accepted operators are recorded with where they
 *     came from (imported preset — unverified). Owner QA 4: no category is asked
 *     for here; it changed nothing Architect generates. Whether an operator is
 *     installed is an optional note on Content (cluster evidence vs. statement).
 * Accepted operators are added to each stage's operator selection, where the
 * existing Mirroring operator browser, constraints and live catalog check
 * apply, each stage resolving the channel against its own catalog.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import Modal from "../components/Modal.jsx";
import FileDropZone from "../components/FileDropZone.jsx";
import { analyzePresets, saveOperatorIntent, applyIntentToStages, updatePlan } from "./upgradeApi.js";

export const SOURCE_TO_KIND = { "redhat-operators": "redhat", "certified-operators": "certified", "community-operators": "community" };
const MAX_FILE_BYTES = 1024 * 1024;

/** File contents as text (FileReader works everywhere File.text() may not). */
const readText = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ""));
  r.onerror = () => reject(new Error(`${file.name} could not be read.`));
  r.readAsText(file);
});
const sourcesText = (sources) => (sources?.length ? sources.map((s) => s.file).join(", ") : "—");

export default function PresetImporter({ plan, onPlanChanged, onClose = null }) {
  const readOnly = plan.kind === "received";
  const [analysis, setAnalysis] = useState(null);
  const [choices, setChoices] = useState({});
  const [imageChoices, setImageChoices] = useState({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [addToStages, setAddToStages] = useState(true);
  const [releaseHint, setReleaseHint] = useState(null);

  const readFiles = async (fileList) => {
    setError("");
    setNotice("");
    const files = [...(fileList || [])].slice(0, 10);
    if (!files.length) return;
    const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) { setError(`${tooBig.name} is larger than 1 MiB; an ImageSetConfiguration is normally a few kilobytes.`); return; }
    setBusy("analyze");
    try {
      const payload = await Promise.all(files.map(async (f) => ({ name: f.name, text: await readText(f) })));
      const r = await analyzePresets(plan.id, payload);
      setAnalysis(r);
      setChoices(Object.fromEntries(r.operators.map((o) => [o.key, { accept: !o.conflicts.length, channel: o.suggestedChannel || o.channelOptions[0] || "", category: "preset-mirrored" }])));
      setImageChoices(Object.fromEntries(r.images.map((i) => [i.name, true])));
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy("");
    }
  };

  const acceptPresets = async () => {
    setBusy("accept");
    setError("");
    try {
      const accepted = analysis.operators.filter((o) => choices[o.key]?.accept);
      const entries = accepted.map((o) => ({
        name: o.name, catalogKind: o.catalogKind, channel: choices[o.key].channel || null,
        category: choices[o.key].category, confidence: "imported-preset", sources: o.sources
      }));
      const images = analysis.images.filter((i) => imageChoices[i.name]).map((i) => ({ name: i.name, sources: i.sources }));
      const r = await saveOperatorIntent(plan.id, { entries, images });
      let latest = r.plan;
      let stageNote = "";
      if (addToStages && plan.stages.length && (entries.length || images.length)) {
        const applied = await applyIntentToStages(plan.id, entries.map((e) => `${e.catalogKind}|${e.name}`), images.length > 0);
        latest = applied.plan;
        stageNote = ` Added to ${applied.report.filter((x) => x.added?.length || x.imagesAdded?.length).length} stage(s), each from its own catalog; existing selections were not changed.`;
      }
      onPlanChanged(latest);
      setNotice(`${entries.length} operator(s) and ${images.length} image(s) recorded as unverified presets.${stageNote}${r.skipped.length ? ` Kept ${r.skipped.length} entry(ies) you or a cluster export had already confirmed: ${r.skipped.map((x) => x.key.split("|")[1]).join(", ")}.` : ""}`);
      setAnalysis(null);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy("");
    }
  };

  const applyReleaseHint = async (r) => {
    setReleaseHint(null);
    await updatePlan(plan.id, { currentChannel: r.channel.startsWith("eus-") || r.channel.startsWith("fast-") || r.channel.startsWith("stable-") ? r.channel : plan.currentChannel, current: r.minVersion }).then(onPlanChanged).catch((err) => setError(String(err.message || err)));
  };

  return (
    <div className="upgrade-operators">
      {error ? <Banner variant="error">{error}</Banner> : null}
      {notice ? <Banner variant="info">{notice}</Banner> : null}
      <div className="upgrade-presets" aria-labelledby={`upgrade-presets-${plan.id}`}>
        <p className="subtle">
          Load ImageSetConfiguration files you used before to get suggested operators, images and release hints. A file says what
          was <em>asked</em> to be mirrored — not what is installed, what was mirrored successfully, or what is in your registry — so
          everything stays labelled “imported preset — unverified”.
        </p>
        <FileDropZone id={`upgrade-presets-files-${plan.id}`} label="ImageSetConfiguration files" multiple accept=".yaml,.yml,text/yaml,application/yaml,text/plain"
          disabled={readOnly || busy === "analyze"} onFiles={readFiles}
          help="Up to 10 files, 1 MiB each. oc-mirror v2 files are checked against the v2 schema; v1 files are read for platform channels, operator packages and additional images only." />
        {busy === "analyze" ? <div className="loading" role="status">Reading the files…</div> : null}

        {analysis ? (
          <div className="upgrade-presets-review">
            <h4>Files</h4>
            <ul>
              {analysis.files.map((f) => (
                <li key={`${f.index}-${f.fileName}`}>
                  <code>{f.fileName}</code> — {f.status === "valid" ? <span className="upgrade-badge" data-state="NOT_CHECKED">read · {f.format}</span> : <span className="upgrade-badge" data-state="BLOCKED">✕ not used</span>}
                  {f.errors?.length ? <span className="subtle"> {f.errors.join(" ")}</span> : null}
                  {f.notes?.length ? <ul className="subtle">{f.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
                </li>
              ))}
            </ul>

            {analysis.releases.length ? (
              <>
                <h4>Release hints</h4>
                <ul>
                  {analysis.releases.map((r) => (
                    <li key={`${r.channel}-${r.minVersion}-${r.maxVersion}`}>
                      {r.channel} {r.minVersion || "?"}{r.maxVersion && r.maxVersion !== r.minVersion ? `–${r.maxVersion}` : ""} <span className="upgrade-badge" data-state={r.supported ? "NOT_CHECKED" : "BLOCKED"}>{r.supported ? "hint · unverified" : "✕ unsupported minor"}</span>
                      <span className="subtle"> {r.note} From: {sourcesText(r.sources)}.</span>
                      {r.supported && r.minVersion && !readOnly ? <> <Button variant="secondary" onClick={() => (plan.current && plan.current !== r.minVersion ? setReleaseHint(r) : applyReleaseHint(r))}>Use {r.minVersion} as the current release…</Button></> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {analysis.operators.length ? (
              <>
                <h4>Operators found</h4>
                <table className="upgrade-graph-table">
                  <caption className="subtle">Tick what to add to the plan. The channel can be changed now or later; each stage then resolves it against its own catalog. Confidence: {analysis.confidence}.</caption>
                  <thead><tr><th scope="col">Add</th><th scope="col">Operator</th><th scope="col">Channel</th><th scope="col">From</th><th scope="col">Notes</th></tr></thead>
                  <tbody>
                    {analysis.operators.map((o) => {
                      const c = choices[o.key] || {};
                      const set = (patch) => setChoices((all) => ({ ...all, [o.key]: { ...c, ...patch } }));
                      return (
                        <tr key={o.key}>
                          <td><input type="checkbox" aria-label={`Add ${o.name}`} checked={Boolean(c.accept)} onChange={(e) => set({ accept: e.target.checked })} /></td>
                          <th scope="row">{o.name}<span className="subtle"> ({o.catalogKind}, catalog {o.catalogMinors.join(", ")})</span></th>
                          <td>
                            {o.channelOptions.length > 1 ? (
                              <select aria-label={`${o.name} channel`} value={c.channel || ""} onChange={(e) => set({ channel: e.target.value })}>
                                {o.channelOptions.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
                              </select>
                            ) : (
                              <input type="text" aria-label={`${o.name} channel`} value={c.channel || ""} placeholder="catalog default" onChange={(e) => set({ channel: e.target.value.trim() })} />
                            )}
                          </td>
                          <td>{sourcesText(o.sources)}{o.duplicates ? ` (in ${o.duplicates} files)` : ""}</td>
                          <td>{o.conflicts.length ? <span className="upgrade-badge" data-state="WARNING">⚠ {o.conflicts.join(" ")}</span> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : null}

            {analysis.images.length ? (
              <>
                <h4>Additional images found</h4>
                <ul>
                  {analysis.images.map((i) => (
                    <li key={i.name}><label className="toggle-row"><input type="checkbox" checked={Boolean(imageChoices[i.name])} onChange={(e) => setImageChoices((all) => ({ ...all, [i.name]: e.target.checked }))} /> <code>{i.name}</code> <span className="subtle">from {sourcesText(i.sources)}</span></label></li>
                  ))}
                </ul>
              </>
            ) : null}

            {plan.stages.length ? (
              <label className="toggle-row">
                <input type="checkbox" checked={addToStages} onChange={(e) => setAddToStages(e.target.checked)} />
                <span>Also add the ticked operators to every stage (each from its own minor&apos;s catalog; nothing already selected is changed)</span>
              </label>
            ) : <p className="subtle">Prepare the stages to add these operators to them; until then they are recorded in the plan only.</p>}
            <div className="actions">
              <Button variant="primary" disabled={readOnly || busy === "accept"} onClick={acceptPresets}>Add the ticked items</Button>
              <Button variant="secondary" onClick={() => setAnalysis(null)}>Discard this import</Button>
            </div>
          </div>
        ) : null}
      </div>
      {onClose ? <div className="actions"><Button variant="secondary" onClick={onClose}>Close</Button></div> : null}

      <Modal isOpen={Boolean(releaseHint)} onClose={() => setReleaseHint(null)} ariaLabelledBy={`upgrade-hint-${plan.id}`}>
        <h3 id={`upgrade-hint-${plan.id}`}>Replace the current release?</h3>
        <p className="modal-copy">The plan says the cluster runs <strong>{plan.current}</strong>. Replace it with <strong>{releaseHint?.minVersion}</strong> from an imported file? A configuration file is not evidence of what the cluster runs; the route will need to be computed again.</p>
        <div className="actions">
          <Button variant="secondary" onClick={() => setReleaseHint(null)}>Keep {plan.current}</Button>
          <Button variant="primary" onClick={() => applyReleaseHint(releaseHint)}>Use {releaseHint?.minVersion}</Button>
        </div>
      </Modal>
    </div>
  );
}
