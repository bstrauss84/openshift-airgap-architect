/**
 * OpenShift Airgap Architect - Upgrade › Operators (v2.3.0 correction pass).
 *
 * Two clearly separated things:
 *  1. Optional PRESETS from earlier ImageSetConfiguration files: what someone
 *     once asked oc-mirror to mirror. Reviewed, edited and accepted by the
 *     user; always labelled "imported preset (unverified)" with the file(s)
 *     each item came from. Never presented as installed, mirrored or current.
 *  2. The plan's OPERATOR INTENT: each operator's category (previously
 *     mirrored / currently installed / newly requested / kept as is) and how
 *     we know it (imported preset, imported cluster export, confirmed by you,
 *     entered by you).
 * Accepted operators are added to each stage's operator selection, where the
 * existing Mirroring operator browser, constraints and live catalog check
 * apply (Content & runs). No second operator catalog UI.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useMemo, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import Modal from "../components/Modal.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import { PRESET_FILES_HINT } from "./upgradeCopy.js";
import { analyzePresets, saveOperatorIntent, applyIntentToStages, updatePlan } from "./upgradeApi.js";

export const CATEGORY_LABEL = {
  "preset-mirrored": "Previously mirrored or selected (from files)",
  installed: "Currently installed",
  requested: "New: requested for installation",
  retained: "Installed, kept without an update"
};
export const CONFIDENCE_LABEL = {
  "imported-preset": "imported preset — unverified",
  "cluster-export": "imported cluster export",
  "user-confirmed": "confirmed by you",
  "user-entered": "entered by you"
};
const SOURCE_TO_KIND = { "redhat-operators": "redhat", "certified-operators": "certified", "community-operators": "community" };
const MAX_FILE_BYTES = 1024 * 1024;

/** File contents as text (FileReader works everywhere File.text() may not). */
const readText = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ""));
  r.onerror = () => reject(new Error(`${file.name} could not be read.`));
  r.readAsText(file);
});
const sourcesText = (sources) => (sources?.length ? sources.map((s) => s.file).join(", ") : "—");

export default function OperatorsTab({ plan, onPlanChanged }) {
  const readOnly = plan.kind === "received";
  const [analysis, setAnalysis] = useState(null);
  const [choices, setChoices] = useState({});
  const [imageChoices, setImageChoices] = useState({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedIntent, setSelectedIntent] = useState({});
  const [includeImages, setIncludeImages] = useState(false);
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
      const entries = analysis.operators.filter((o) => choices[o.key]?.accept).map((o) => ({
        name: o.name, catalogKind: o.catalogKind, channel: choices[o.key].channel || null,
        category: choices[o.key].category, confidence: "imported-preset", sources: o.sources
      }));
      const images = analysis.images.filter((i) => imageChoices[i.name]).map((i) => ({ name: i.name, sources: i.sources }));
      const r = await saveOperatorIntent(plan.id, { entries, images });
      onPlanChanged(r.plan);
      setNotice(`${entries.length} operator(s) and ${images.length} image(s) added to the plan as unverified presets.${r.skipped.length ? ` Kept ${r.skipped.length} entry(ies) you or a cluster export had already confirmed: ${r.skipped.map((s) => s.key.split("|")[1]).join(", ")}.` : ""}`);
      setAnalysis(null);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy("");
    }
  };

  const fromInventory = useMemo(() => (plan.inventory?.operators || [])
    .filter((o) => o.name && SOURCE_TO_KIND[o.source])
    .map((o) => ({ name: o.name, catalogKind: SOURCE_TO_KIND[o.source], channel: o.channel || null, category: "installed", confidence: "cluster-export", sources: [{ file: `cluster export ${plan.inventory.importedAt || ""}`.trim() }] })), [plan.inventory]);

  const save = async (body, message) => {
    setBusy("save");
    setError("");
    try {
      const r = await saveOperatorIntent(plan.id, body);
      onPlanChanged(r.plan);
      if (message) setNotice(message);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy("");
    }
  };
  const updateEntry = (e, patch) => save({ entries: [{ name: e.name, catalogKind: e.catalogKind, channel: e.channel, category: e.category, confidence: e.confidence, sources: e.sources, ...patch }], replaceConfirmed: true });

  const apply = async () => {
    setBusy("apply");
    setError("");
    try {
      const keys = Object.keys(selectedIntent).filter((k) => selectedIntent[k]);
      const r = await applyIntentToStages(plan.id, keys, includeImages);
      onPlanChanged(r.plan);
      setNotice(r.report.map((x) => `Stage ${x.stageId.slice(1)}: ${x.added?.length || 0} added${x.kept?.length ? `, ${x.kept.length} already selected (unchanged)` : ""}${x.imagesAdded?.length ? `, ${x.imagesAdded.length} image(s)` : ""}`).join("; ") + ". Check the channels with the Live catalog check in each stage (Content & runs).");
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

      <section className="card" aria-labelledby={`upgrade-presets-${plan.id}`}>
        <h3 id={`upgrade-presets-${plan.id}`}>Presets from earlier ImageSetConfigurations (optional)</h3>
        <p className="subtle">
          Load one or more ImageSetConfiguration files you used before. They suggest operators, images and release hints you can
          review and edit. A configuration file says what was <em>asked</em> to be mirrored — not what is installed in the cluster,
          what was mirrored successfully, or what is in your registry — so everything here stays labelled “imported preset — unverified”.
        </p>
        <div className="field-control-stack">
          <FieldLabelWithInfo label="ImageSetConfiguration files" hint={PRESET_FILES_HINT}>
            <input
              id={`upgrade-presets-files-${plan.id}`}
              type="file"
              multiple
              accept=".yaml,.yml,text/yaml,application/yaml,text/plain"
              disabled={readOnly || busy === "analyze"}
              onChange={(e) => { readFiles(e.target.files); e.target.value = ""; }}
            />
          </FieldLabelWithInfo>
          <div className="field-control-support">
            <span className="field-helper"
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
              onDrop={(e) => { e.preventDefault(); if (!readOnly) readFiles(e.dataTransfer.files); }}>
              Up to 10 files, 1 MiB each. oc-mirror v2 files are checked against the v2 schema; v1 files are read for platform channels, operator packages and additional images only.
            </span>
          </div>
        </div>
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
                  <caption className="subtle">Tick what to add to the plan. Channel and category can be changed now or later. Confidence: {analysis.confidence}.</caption>
                  <thead><tr><th scope="col">Add</th><th scope="col">Operator</th><th scope="col">Channel</th><th scope="col">Category</th><th scope="col">From</th><th scope="col">Notes</th></tr></thead>
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
                          <td>
                            <select aria-label={`${o.name} category`} value={c.category || "preset-mirrored"} onChange={(e) => set({ category: e.target.value })}>
                              {Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                            </select>
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
                    <li key={i.name}><label className="switch-row"><input type="checkbox" checked={Boolean(imageChoices[i.name])} onChange={(e) => setImageChoices((all) => ({ ...all, [i.name]: e.target.checked }))} /> <code>{i.name}</code> <span className="subtle">from {sourcesText(i.sources)}</span></label></li>
                  ))}
                </ul>
              </>
            ) : null}

            <div className="actions">
              <Button variant="primary" disabled={readOnly || busy === "accept"} onClick={acceptPresets}>Add the ticked items to the plan</Button>
              <Button variant="secondary" onClick={() => setAnalysis(null)}>Discard this import</Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="card" aria-labelledby={`upgrade-intent-${plan.id}`}>
        <h3 id={`upgrade-intent-${plan.id}`}>Operators in this plan</h3>
        <p className="subtle">Each operator&apos;s category says what you intend; its confidence says how that is known. Imported presets never become “installed” on their own — confirm them, or import a cluster export on the Readiness tab.</p>
        {fromInventory.length && !readOnly ? (
          <div className="actions">
            <Button variant="secondary" disabled={Boolean(busy)} onClick={() => save({ entries: fromInventory }, `${fromInventory.length} installed operator(s) from the imported cluster export added.`)}>Add the {fromInventory.length} installed operator(s) from the imported cluster export</Button>
          </div>
        ) : null}
        {plan.operatorIntent?.length ? (
          <>
            <table className="upgrade-graph-table">
              <thead><tr><th scope="col">Select</th><th scope="col">Operator</th><th scope="col">Channel</th><th scope="col">Category</th><th scope="col">Confidence</th><th scope="col">From</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {plan.operatorIntent.map((e) => (
                  <tr key={e.key}>
                    <td><input type="checkbox" aria-label={`Select ${e.name}`} checked={Boolean(selectedIntent[e.key])} onChange={(ev) => setSelectedIntent((all) => ({ ...all, [e.key]: ev.target.checked }))} /></td>
                    <th scope="row">{e.name}<span className="subtle"> ({e.catalogKind})</span></th>
                    <td>{e.channel || "catalog default"}</td>
                    <td>
                      <select aria-label={`${e.name} category`} value={e.category} disabled={readOnly} onChange={(ev) => updateEntry(e, { category: ev.target.value })}>
                        {Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </td>
                    <td><span className="upgrade-badge" data-state={e.confidence === "imported-preset" ? "NOT_CHECKED" : e.confidence === "cluster-export" ? "VERIFIED" : "ATTESTED"}>{CONFIDENCE_LABEL[e.confidence]}</span></td>
                    <td>{sourcesText(e.sources)}</td>
                    <td>
                      {!readOnly && e.confidence === "imported-preset" ? <Button variant="secondary" onClick={() => updateEntry(e, { confidence: "user-confirmed", category: e.category === "preset-mirrored" ? "installed" : e.category })}>Confirm installed</Button> : null}
                      {!readOnly ? <Button variant="secondary" onClick={() => save({ remove: [e.key] })}>Remove</Button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <label className="switch-row">
              <input type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)} disabled={!plan.presetImages?.length} />
              <span>Also add the plan&apos;s {plan.presetImages?.length || 0} preset image(s) to the last stage</span>
            </label>
            <div className="actions">
              <Button variant="primary" disabled={readOnly || !plan.stages.length || !Object.values(selectedIntent).some(Boolean) || busy === "apply"} onClick={apply}>Add the selected operators to every stage</Button>
            </div>
            {!plan.stages.length ? <p className="subtle">Prepare the stages (Content & runs) first.</p> : <p className="subtle">Each stage gets the operator from its own catalog minor; selections already in a stage are not changed. Browse, adjust and check them in Content & runs with the Mirroring operator tools.</p>}
          </>
        ) : <p className="subtle">No operators yet. Import presets above, add installed operators from a cluster export, or choose operators per stage in Content & runs.</p>}
      </section>

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
