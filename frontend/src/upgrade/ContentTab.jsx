/**
 * OpenShift Airgap Architect - Upgrade › 2 Content (v2.3.0 UX correction).
 *
 * What will be mirrored for each release on the route. A stage is one release: its platform
 * release (fixed by the route) plus operators from THAT minor's catalog. Operator selection is
 * Mirroring's own experience, embedded per stage (Quick Picks, catalog scan, browse, selected
 * operators, version constraints, Live catalog check) — no second operator UI. The plan's single
 * credential context (D-2) supplies the Red Hat pull secret. "Import previous configuration"
 * suggests operators from earlier ImageSetConfigurations; it never proves what is installed.
 *
 * Mirroring the stages is a later step (Mirror & transfer); nothing here runs oc-mirror.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import Modal from "../components/Modal.jsx";
import CollapsibleSection from "../components/CollapsibleSection.jsx";
import OperatorsSection from "../mirroring/OperatorsSection.jsx";
import AdditionalImagesEditor from "../mirroring/AdditionalImagesEditor.jsx";
import { fetchMirroring, updateProfile, verifyCatalogs, fetchJob } from "../mirroring/mirroringApi.js";
import { useSourceCredential } from "../mirroring/sourceCredentialSession.js";
import { useProfilePreview } from "../mirroring/useProfilePreview.js";
import PresetImporter, { CATEGORY_LABEL, CONFIDENCE_LABEL, SOURCE_TO_KIND } from "./OperatorsTab.jsx";
import RouteCatalogScan from "./RouteCatalogScan.jsx";
import { buildScanPlan, cellEvidence, provenanceOf, scannedAt } from "./routeCatalogs.js";
import { prepareStages, saveOperatorIntent, copyStageOperators, fetchStageConfig, fetchCatalogStatus, fetchChannelEvidence } from "./upgradeApi.js";

export const checkTiming = { pollMs: 1500 };
export const downloadText = (name, text, type = "application/yaml") => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const UNCLASSIFIED = "";

/**
 * One row per operator across the route; one column per stage. Category is what the user intends
 * (never assumed: an operator without a recorded classification is "Not classified yet"); each
 * stage cell shows the selected channel and what is actually known about it in THAT stage's catalog.
 * Bulk editing: tick rows (a compact box inside the name cell), or "Select shown", then set a
 * category; categories already set are kept unless "Also replace categories already set" is on;
 * every bulk change can be undone.
 */
function OperatorMatrix({ plan, views, profiles, readOnly, onSaveIntent, statusByMinor, scans, detailsFor = () => null, onApplyChannels = null }) {
  const [filter, setFilter] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [picked, setPicked] = useState(() => new Set());
  const [bulkCategory, setBulkCategory] = useState("installed");
  const [overwrite, setOverwrite] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [suggestPicked, setSuggestPicked] = useState(null);
  const [channelFeedback, setChannelFeedback] = useState(null);
  const rows = useMemo(() => {
    const byKey = new Map();
    views.forEach((v, col) => {
      const p = profiles[v.linkedProfileId];
      if (!p?.content?.operators) return;
      for (const op of p.operators.selected) {
        const key = `${op.catalog || "redhat"}|${op.name}`;
        if (!byKey.has(key)) byKey.set(key, { key, name: op.name, display: op.displayName || op.name, catalog: op.catalog || "redhat", cells: views.map(() => null), sources: new Set() });
        const row = byKey.get(key);
        row.cells[col] = op;
        for (const src of op.sources?.length ? op.sources : ["manual"]) row.sources.add(src);
      }
    });
    return [...byKey.values()].sort((x, y) => x.display.localeCompare(y.display));
  }, [views, profiles]);
  const intent = useMemo(() => new Map((plan.operatorIntent || []).map((e) => [e.key, e])), [plan.operatorIntent]);
  const categoryOf = (r) => intent.get(r.key)?.category || UNCLASSIFIED;
  const shown = rows.filter((r) => (!filter.trim() || `${r.display} ${r.name}`.toLowerCase().includes(filter.trim().toLowerCase()))
    && (catFilter === "all" || categoryOf(r) === (catFilter === "none" ? UNCLASSIFIED : catFilter)));
  const shownKeys = new Set(shown.map((r) => r.key));
  // The selection never includes rows the filter hides.
  const selected = [...picked].filter((k) => shownKeys.has(k));
  const toggle = (key) => setPicked((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const entryFor = (r, category) => {
    const e = intent.get(r.key);
    if (e) return { name: e.name, catalogKind: e.catalogKind, channel: e.channel, sources: e.sources, category, confidence: category === "installed" && e.confidence === "imported-preset" ? "user-confirmed" : e.confidence };
    return { name: r.name, catalogKind: r.catalog, channel: null, sources: [], category, confidence: "user-entered" };
  };
  const setOne = async (r, category) => {
    const prev = intent.get(r.key) || null;
    if (!category) { await onSaveIntent({ remove: [r.key] }); setFeedback({ text: `${r.display}: not classified.`, undo: prev ? { entries: [prev] } : null }); return; }
    await onSaveIntent({ entries: [entryFor(r, category)] });
    setFeedback({ text: `${r.display}: ${CATEGORY_LABEL[category]}.`, undo: prev ? { entries: [prev] } : { remove: [r.key] } });
  };
  const applyBulk = async () => {
    const targets = shown.filter((r) => selected.includes(r.key));
    const change = targets.filter((r) => overwrite || categoryOf(r) === UNCLASSIFIED).filter((r) => categoryOf(r) !== bulkCategory);
    const kept = targets.length - change.length;
    if (!change.length) { setFeedback({ text: `Nothing changed: ${kept} operator(s) already have a category${overwrite ? " (or already this one)" : " — turn on “Also replace categories already set” to change them"}.`, undo: null }); return; }
    const prevEntries = change.map((r) => intent.get(r.key)).filter(Boolean);
    const newKeys = change.filter((r) => !intent.get(r.key)).map((r) => r.key);
    await onSaveIntent({ entries: change.map((r) => entryFor(r, bulkCategory)) });
    setFeedback({ text: `${change.length} operator(s) set to “${CATEGORY_LABEL[bulkCategory]}”.${kept ? ` ${kept} kept (already classified).` : ""}`, undo: { entries: prevEntries, remove: newKeys } });
    setPicked(new Set());
  };
  const undo = async () => {
    const u = feedback?.undo;
    if (!u) return;
    await onSaveIntent({ ...(u.entries?.length ? { entries: u.entries.map((e) => ({ name: e.name, catalogKind: e.catalogKind, channel: e.channel, sources: e.sources, category: e.category, confidence: e.confidence })) } : {}), ...(u.remove?.length ? { remove: u.remove } : {}) });
    setFeedback({ text: "Undone.", undo: null });
  };

  if (!rows.length) return <p className="subtle">No operators chosen yet. Choose them for a stage below (Quick Picks, catalog browser), or import a previous configuration.</p>;
  return (
    <div className="upgrade-matrix">
      <div className="upgrade-matrix-tools" role="group" aria-label="Filter and bulk edit operators">
        <input type="search" aria-label="Filter operators" placeholder="Filter operators" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select aria-label="Show category" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="all">All categories</option>
          <option value="none">Not classified yet</option>
          {Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {!readOnly ? (
          <>
            <Button variant="secondary" className="mini" onClick={() => setPicked(selected.length === shown.length ? new Set() : new Set(shown.map((r) => r.key)))}>
              {selected.length === shown.length && shown.length ? "Clear selection" : `Select shown (${shown.length})`}
            </Button>
            <span className="upgrade-matrix-bulk">
              <label className="sr-only" htmlFor={`upgrade-bulk-cat-${plan.id}`}>Category for the selected operators</label>
              <select id={`upgrade-bulk-cat-${plan.id}`} value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} disabled={!selected.length}>
                {Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <Button variant="primary" className="mini" disabled={!selected.length} onClick={applyBulk}>Set for {selected.length} selected</Button>
            </span>
            <label className="toggle-row upgrade-matrix-overwrite">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              <span>Also replace categories already set</span>
            </label>
          </>
        ) : null}
      </div>
      {feedback ? (
        <p className="upgrade-matrix-feedback" role="status">
          {feedback.text} {feedback.undo ? <Button variant="secondary" className="mini" onClick={undo}>Undo</Button> : null}
        </p>
      ) : null}
      <div className="upgrade-table-scroll">
        <table className="upgrade-graph-table upgrade-operator-matrix">
          <caption className="sr-only">Operators on each stage of the route, with their category and catalog evidence per stage</caption>
          <thead>
            <tr>
              <th scope="col">Operator</th>
              <th scope="col">Category</th>
              {views.map((v) => <th scope="col" key={v.id}>Stage {v.id.slice(1)} · {v.release}<span className="subtle upgrade-matrix-minor"> catalog {v.minor}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const e = intent.get(r.key);
              const cat = categoryOf(r);
              return (
                <tr key={r.key} data-selected={picked.has(r.key) ? "true" : undefined}>
                  <th scope="row">
                    <span className="upgrade-matrix-name">
                      {!readOnly ? <input type="checkbox" className="upgrade-matrix-pick" aria-label={`Select ${r.display}`} checked={picked.has(r.key)} onChange={() => toggle(r.key)} /> : null}
                      <span>{r.display}<span className="subtle"> ({r.catalog})</span></span>
                    </span>
                    <span className="subtle upgrade-matrix-why">{provenanceOf([...r.sources]).join(" · ")}</span>
                  </th>
                  <td className="upgrade-matrix-category">
                    <select aria-label={`${r.display} category`} value={cat} disabled={readOnly} onChange={(ev) => setOne(r, ev.target.value)}>
                      <option value={UNCLASSIFIED}>Not classified yet</option>
                      {Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    {e ? <span className="upgrade-badge" data-state={e.confidence === "imported-preset" ? "NOT_CHECKED" : e.confidence === "cluster-export" ? "VERIFIED" : "ATTESTED"}>{CONFIDENCE_LABEL[e.confidence]}</span> : null}
                    {e?.confidence === "imported-preset" && !readOnly ? (
                      <Button variant="secondary" className="mini" onClick={() => setOne(r, e.category === "preset-mirrored" ? "installed" : e.category)}>Confirm installed</Button>
                    ) : null}
                  </td>
                  {r.cells.map((op, i) => {
                    if (!op) return <td key={views[i].id}><span className="subtle" aria-label="not selected for this stage">—</span></td>;
                    const ev = cellEvidence(op, views[i].minor, statusByMinor[views[i].minor], scans[views[i].minor], detailsFor(op));
                    return (
                      <td key={views[i].id} className="upgrade-matrix-cell">
                        <span className="upgrade-cell-mark" data-state={ev.state} title={ev.detail} aria-hidden="true">{ev.mark}</span>
                        <span className="upgrade-cell-channel" title={ev.detail}>{op.defaultChannel || <em>no channel</em>}</span>
                        <span className="upgrade-cell-label" data-state={ev.state}>{ev.label}</span>
                        <span className="sr-only">{ev.detail}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length < rows.length ? <p className="subtle">{rows.length - shown.length} operator(s) hidden by the filter; the selection includes shown operators only.</p> : null}
      {(() => {
        // Channel suggestions from catalog evidence only; nothing changes until the user applies them.
        const suggestions = [];
        rows.forEach((r) => r.cells.forEach((op, i) => {
          if (!op) return;
          const ev = cellEvidence(op, views[i].minor, statusByMinor[views[i].minor], scans[views[i].minor], detailsFor(op));
          if (ev.suggest && ev.suggest.channel !== op.defaultChannel) suggestions.push({ key: `${views[i].id}|${r.key}`, stage: views[i], profileId: views[i].linkedProfileId, row: r, op, ...ev.suggest });
        }));
        if (!suggestions.length && !channelFeedback) return null;
        const picked = suggestPicked || new Set(suggestions.filter((x) => x.proven).map((x) => x.key));
        const togglePick = (k) => { const n = new Set(picked); if (n.has(k)) n.delete(k); else n.add(k); setSuggestPicked(n); };
        const apply = async () => {
          const chosen = suggestions.filter((x) => picked.has(x.key));
          const undo = await onApplyChannels(chosen.map((x) => ({ profileId: x.profileId, name: x.op.name, channel: x.channel })));
          setChannelFeedback({ text: `${chosen.length} channel(s) changed. Each stage's Live catalog check re-checks them.`, undo });
          setSuggestPicked(null);
        };
        return (
          <details className="upgrade-channel-suggest" open={suggestions.some((x) => x.proven)}>
            <summary>Channel suggestions ({suggestions.length}) <span className="subtle">— from catalog evidence; nothing changes until you apply</span></summary>
            {channelFeedback ? <p className="upgrade-matrix-feedback" role="status">{channelFeedback.text} {channelFeedback.undo ? <Button variant="secondary" className="mini" onClick={async () => { await onApplyChannels(channelFeedback.undo); setChannelFeedback({ text: "Channel changes undone.", undo: null }); }}>Undo</Button> : null}</p> : null}
            {suggestions.length ? (
              <>
                <ul className="upgrade-check-list">
                  {suggestions.map((x) => (
                    <li key={x.key}>
                      <label className="toggle-row">
                        <input type="checkbox" checked={picked.has(x.key)} disabled={readOnly} onChange={() => togglePick(x.key)} />
                        <span>Stage {x.stage.id.slice(1)} · <strong>{x.row.display}</strong>: {x.op.defaultChannel || "no channel"} → <strong>{x.channel}</strong> <span className="subtle">({x.why}; {provenanceOf(x.op.sources || []).join(", ")})</span></span>
                      </label>
                    </li>
                  ))}
                </ul>
                {!readOnly && onApplyChannels ? <div className="actions"><Button variant="primary" className="mini" disabled={!picked.size} onClick={apply}>Apply {picked.size} channel change(s)</Button></div> : null}
                <p className="subtle">Pre-ticked: channels a stage&apos;s catalog does not list. Others only differ from the catalog&apos;s default channel, which is not evidence they are wrong — tick them if you want the default.</p>
              </>
            ) : null}
          </details>
        );
      })()}
      <details className="upgrade-matrix-legend">
        <summary>What the marks mean</summary>
        <ul>
          <li><span className="upgrade-cell-mark" data-state="VERIFIED">✓</span> verified — the Live catalog check confirmed this channel in this stage&apos;s catalog, or it is the scanned catalog&apos;s default channel</li>
          <li><span className="upgrade-cell-mark" data-state="NOT_CHECKED">?</span> channel not checked — the operator is in the scanned catalog, but a scan records only the default channel; run the stage&apos;s Live catalog check</li>
          <li><span className="upgrade-cell-mark" data-state="NOT_CHECKED">○</span> not scanned — the channel shown is the selection only</li>
          <li><span className="upgrade-cell-mark" data-state="PENDING">…</span> scanning</li>
          <li><span className="upgrade-cell-mark" data-state="WARNING">!</span> the last scan failed · <span className="upgrade-cell-mark" data-state="WARNING">⚠</span> no version in the chosen range</li>
          <li><span className="upgrade-cell-mark" data-state="BLOCKED">✕</span> not in this stage&apos;s catalog, or the channel is missing there</li>
          <li>None of these says the operator is compatible with your running cluster; that is a readiness item.</li>
        </ul>
      </details>
    </div>
  );
}

export default function ContentTab({ plan, onPlanChanged, onShowOperation = null, credentialKey = null, onPreviewFiles = null, onGoToStep = null, onPreviewStage = null, onStageShown = null, onProfilesSeen = null }) {
  const [profiles, setProfiles] = useState({});
  // Report every loaded or saved stage profile to the shell (live YAML preview), without re-running loads.
  const seenRef = useRef(onProfilesSeen);
  seenRef.current = onProfilesSeen;
  const loadEvidenceRef = useRef(null);
  const [selected, setSelected] = useState(plan.stages[0]?.id || null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [statusByMinor, setStatusByMinor] = useState({});
  const [statusLoaded, setStatusLoaded] = useState(() => new Set());
  const [channelEvidence, setChannelEvidence] = useState({});
  const [checkAll, setCheckAll] = useState(null);
  const checkCred = useSourceCredential(credentialKey, "check");
  const loadEvidence = useCallback(async () => {
    try {
      const r = await fetchChannelEvidence(plan.id);
      setChannelEvidence(Object.fromEntries((r.evidence || []).map((e) => [`${e.catalogImage}|${e.name}`, e])));
    } catch { /* evidence stays unknown */ }
  }, [plan.id]);
  const [scans, setScans] = useState({});
  const received = plan.kind === "received";
  const stageMinors = [...new Set((plan.stageViews || []).map((v) => v.minor).filter(Boolean))];
  const loadStatus = useCallback(async (minor) => {
    try { const st = await fetchCatalogStatus(minor); setStatusByMinor((all) => ({ ...all, [minor]: st })); } catch { /* shown as not scanned */ }
    setStatusLoaded((all) => (all.has(minor) ? all : new Set([...all, minor])));
  }, []);
  loadEvidenceRef.current = loadEvidence;
  const minorsKey = stageMinors.join(",");
  useEffect(() => { for (const m of stageMinors) loadStatus(m); }, [minorsKey, loadStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadProfiles = useCallback(async () => {
    try {
      const m = await fetchMirroring();
      setProfiles(Object.fromEntries((m.profiles || []).map((p) => [p.id, p])));
      seenRef.current?.(m.profiles || []);
      loadEvidenceRef.current?.();
    } catch (err) {
      setError(`Could not load the stage profiles: ${String(err.message || err)}`);
    }
  }, []);
  useEffect(() => { loadProfiles(); }, [loadProfiles, plan.stages.length]);
  useEffect(() => { if (selected && !plan.stages.some((s) => s.id === selected)) setSelected(plan.stages[0]?.id || null); }, [plan.stages, selected]);
  useEffect(() => { if (!selected && plan.stages[0]) setSelected(plan.stages[0].id); }, [plan.stages, selected]);
  // The live YAML preview follows the stage shown here.
  useEffect(() => { if (selected && onStageShown) onStageShown(selected); }, [selected, onStageShown]);

  /** Apply reviewed channel changes, per stage profile; returns the reverse changes (Undo). */
  const applyChannels = async (changes) => {
    setError("");
    const undo = [];
    const byProfile = new Map();
    for (const c of changes) { if (!byProfile.has(c.profileId)) byProfile.set(c.profileId, []); byProfile.get(c.profileId).push(c); }
    try {
      for (const [pid, list] of byProfile) {
        const p = profiles[pid];
        if (!p) continue;
        const selectedOps = p.operators.selected.map((o) => {
          const c = list.find((x) => x.name === o.name);
          if (!c || c.channel === o.defaultChannel) return o;
          undo.push({ profileId: pid, name: o.name, channel: o.defaultChannel || null });
          return { ...o, defaultChannel: c.channel };
        });
        replaceProfile(await updateProfile(pid, { operators: { selected: selectedOps } }));
      }
    } catch (err) { setError(String(err.message || err)); }
    loadEvidence();
    return undo;
  };
  /** The existing Live catalog check, run for every stage with operators, one stage at a time. */
  const checkEveryStage = async () => {
    if (!checkCred.usable) { setError("Enter the plan's Red Hat pull secret first (Catalogs for this route, below)."); return; }
    const targets = (plan.stageViews || []).filter((v) => profiles[v.linkedProfileId]?.content?.operators && profiles[v.linkedProfileId].operators.selected.length);
    setError("");
    for (const v of targets) {
      setCheckAll({ stage: v, message: `Checking stage ${v.id.slice(1)} (${v.release})…` });
      try {
        const { jobId } = await verifyCatalogs(v.linkedProfileId, checkCred.body);
        for (let i = 0; i < 2000; i += 1) {
          const j = await fetchJob(jobId);
          if (["completed", "completed_with_warnings", "failed", "cancelled"].includes(j.status)) break;
          await new Promise((r) => setTimeout(r, checkTiming.pollMs));
        }
      } catch (err) { setError(`Stage ${v.id.slice(1)}: ${String(err.message || err)}`); }
    }
    setCheckAll(null);
    await loadProfiles();
    loadEvidence();
  };
  const prepare = async () => {
    setBusy("prepare");
    setError("");
    try {
      const r = await prepareStages(plan.id);
      onPlanChanged(r.plan);
      await loadProfiles();
      const parts = [];
      if (r.created?.length) parts.push(`${r.created.length} new stage profile(s)`);
      if (r.reused?.length) parts.push(`${r.reused.length} kept with their operators and mirrored data`);
      if (r.released?.length) parts.push(`${r.released.length} left the route and stay in Mirroring as ordinary profiles`);
      for (const c of r.carried || []) parts.push(`stage ${c.stageId.slice(1)} (${c.release}) took ${c.operators} operator(s)${c.images ? ` and ${c.images} image(s)` : ""} from the ${c.from} stage it replaces — review them`);
      if (parts.length) setNotice(`Stages prepared: ${parts.join("; ")}.`);
      setSelected(r.plan.stages[0]?.id || null);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy("");
    }
  };
  const saveIntent = async (body) => {
    setError("");
    try { onPlanChanged((await saveOperatorIntent(plan.id, { ...body, replaceConfirmed: true })).plan); } catch (err) { setError(String(err.message || err)); throw err; }
  };
  const copyLater = async (stageId) => {
    setBusy("copy");
    setError("");
    try {
      const r = await copyStageOperators(plan.id, stageId);
      onPlanChanged(r.plan);
      await loadProfiles();
      const CHECK_TEXT = { "default-channel": "default channel there", "channel-not-checked": "channel not checked there", "not-in-catalog": "NOT in that catalog", "not-scanned": "catalog not scanned" };
      setNotice(`${r.report.map((x) => `Stage ${x.stageId.slice(1)}: ${x.added?.length || 0} added${x.kept?.length ? `, ${x.kept.length} already selected (unchanged)` : ""}${x.checks?.length ? ` — ${x.checks.map((c) => `${c.name}${c.channel ? ` ${c.channel}` : ""}: ${CHECK_TEXT[c.status] || c.status}`).join(", ")}` : ""}`).join("; ")}. Copied channels are your selection until each stage's catalog confirms them.`);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy("");
    }
  };
  const recordInstalled = async () => {
    const entries = (plan.inventory?.operators || [])
      .filter((o) => o.name && SOURCE_TO_KIND[o.source])
      .map((o) => ({ name: o.name, catalogKind: SOURCE_TO_KIND[o.source], channel: o.channel || null, category: "installed", confidence: "cluster-export", sources: [{ file: `cluster export ${plan.inventory.importedAt || ""}`.trim() }] }));
    setError("");
    try {
      onPlanChanged((await saveOperatorIntent(plan.id, { entries })).plan);
      setNotice(`${entries.length} installed operator(s) from the imported cluster export recorded as installed. Choose them for the stages that need them.`);
    } catch (err) { setError(String(err.message || err)); }
  };
  const stageConfig = async (profile, view, action) => {
    setError("");
    try {
      const r = await fetchStageConfig(profile.id);
      const name = `stage-${view.id.slice(1)}-${view.release}-imageset-config.yaml`;
      if (action === "download") downloadText(name, r.imagesetConfig);
      else if (onPreviewFiles) onPreviewFiles([{ name, content: r.imagesetConfig }]);
    } catch (err) {
      setError(`The configuration for stage ${view.id.slice(1)} is not ready yet: ${String(err.message || err)}`);
    }
  };

  // The shown stage's configuration, live (same hook and route as the YAML drawer and the Handoff
  // package): its Download is enabled only when a validated file exists (owner QA P7).
  const shownView = (plan.stageViews || []).find((v) => v.id === selected) || null;
  const shownProfile = shownView?.linkedProfileId ? profiles[shownView.linkedProfileId] || null : null;
  const stagePreview = useProfilePreview(plan.kind === "received" ? null : shownProfile);

  if (!plan.path) {
    return (
      <section className="card">
        <h3>Content</h3>
        <p className="subtle">Compute the update route first: each release on it becomes one stage of content.</p>
        {onGoToStep ? <div className="actions"><Button variant="primary" onClick={() => onGoToStep("route")}>Go to Route</Button></div> : null}
      </section>
    );
  }
  const views = plan.stageViews || [];
  const view = views.find((s) => s.id === selected) || null;
  const profile = view?.linkedProfileId ? profiles[view.linkedProfileId] : null;
  const replaceProfile = (p) => { setProfiles((all) => ({ ...all, [p.id]: p })); seenRef.current?.([p]); };
  const stageIndex = views.findIndex((v) => v.id === selected);

  return (
    <div className="upgrade-content">
      {error ? <Banner variant="error">{error}</Banner> : null}
      {notice ? <Banner variant="info">{notice}</Banner> : null}
      <section className="card" aria-labelledby={`upgrade-stages-${plan.id}`}>
        <h3 id={`upgrade-stages-${plan.id}`}>Content for each release on the route</h3>
        <p className="subtle">
          Each release the cluster passes through ({plan.path.path.slice(1).join(", ")}) is one stage: its platform release and the operators you need from that minor&apos;s catalog.
        </p>
        {plan.stagesStale ? (
          <Banner variant="warning">
            <strong>These stages were prepared for a different route.</strong>{" "}
            {plan.stagesMismatch?.reason === "route-cleared"
              ? "The route was cleared by a change on Route; compute it again, then prepare the stages."
              : <>Prepared: {plan.stagesMismatch?.have?.join(", ")}. The route now needs: {plan.stagesMismatch?.want?.join(", ")}{plan.stagesMismatch?.missing?.length ? ` (missing ${plan.stagesMismatch.missing.join(", ")})` : ""}{plan.stagesMismatch?.extra?.length ? ` (no longer needed: ${plan.stagesMismatch.extra.join(", ")})` : ""}.</>}
            {" "}Mirroring is blocked until you prepare them again. Stages that stay keep their operators and mirrored data; a stage leaving the route becomes an ordinary Mirroring profile (nothing is deleted), and its operators are carried into the new stage of the same minor.
          </Banner>
        ) : null}
        {(!plan.stages.length || plan.stagesStale) && !received ? (
          <div className="actions">
            <Button variant="primary" disabled={busy === "prepare"} onClick={prepare}>{busy === "prepare" ? "Preparing…" : plan.stages.length ? "Prepare the stages again" : `Prepare ${plan.path.path.length - 1} stage(s)`}</Button>
          </div>
        ) : null}
      </section>

      {views.length ? (
        <nav className="upgrade-stage-bar" aria-label="Stages">
          <div className="upgrade-stage-chips" role="group" aria-label="Stage shown below">
            {views.map((s) => (
              <button key={s.id} type="button" className={`upgrade-stage-chip${selected === s.id ? " selected" : ""}`} aria-pressed={selected === s.id} onClick={() => setSelected(s.id)}>
                Stage {s.id.slice(1)} · {s.release}{s.operatorsSelected ? <span className="subtle"> · {s.operatorsSelected} operator{s.operatorsSelected === 1 ? "" : "s"}</span> : null}
              </button>
            ))}
          </div>
          <div className="upgrade-stage-bar-tools">
            {!received ? (() => {
              const sp = buildScanPlan(views, profiles, statusByMinor, statusLoaded);
              const busyScan = Object.values(scans).some((x) => x.state === "running" || x.state === "queued");
              const done = sp.filter((e) => e.cached).length;
              return (
                <Button variant="secondary" className="mini" onClick={() => document.getElementById(`upgrade-route-scan-${plan.id}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
                  aria-label={`Catalogs: ${busyScan ? "scanning" : `${done} of ${sp.length} minors scanned`}. Go to the catalog scans.`}>
                  {busyScan ? "Catalogs: scanning…" : `Catalogs: ${done}/${sp.length} scanned`}
                </Button>
              );
            })() : null}
            {!received ? <Button variant="secondary" className="mini" onClick={() => setImportOpen(true)}>Import previous configuration…</Button> : null}
          </div>
        </nav>
      ) : null}

      {views.length && !received ? (
        <RouteCatalogScan plan={plan} scanPlan={buildScanPlan(views, profiles, statusByMinor, statusLoaded)} credentialKey={credentialKey} scans={scans} setScans={setScans} onScanned={loadStatus} />
      ) : null}

      {views.length ? (
        <section className="card" aria-labelledby={`upgrade-matrix-${plan.id}`}>
          <h3 id={`upgrade-matrix-${plan.id}`}>Operators across the route</h3>
          <OperatorMatrix plan={plan} views={views} profiles={profiles} readOnly={received} onSaveIntent={saveIntent} statusByMinor={statusByMinor} scans={scans} detailsFor={(op) => channelEvidence[`${op.catalogImage}|${op.name}`] || null} onApplyChannels={applyChannels} />
          <div className="actions">
            {!received && stageIndex >= 0 && stageIndex < views.length - 1 ? (
              <Button variant="secondary" disabled={busy === "copy" || !profile?.operators?.selected?.length} onClick={() => copyLater(view.id)}>Copy stage {view.id.slice(1)}&apos;s operators to later stages</Button>
            ) : null}
            {!received ? <Button variant="secondary" disabled={Boolean(checkAll)} onClick={checkEveryStage} title="Runs each stage's Live catalog check: does each selected channel (and version range) exist in that stage's own catalog?">{checkAll ? checkAll.message : "Check channels in every stage"}</Button> : null}
            {!received && plan.inventory?.operators?.length ? <Button variant="secondary" onClick={recordInstalled}>Record the {plan.inventory.operators.length} installed operator(s) from the cluster export</Button> : null}
          </div>
          <p className="subtle">Category is what you intend for each operator; the badge says how that is known. Nothing is classified for you: imported files, Quick Picks and catalog scans are never treated as proof of what is installed.</p>
          <details className="upgrade-op-sequencing">
            <summary>Do operators need updating at every minor?</summary>
            <p>No. Before each minor update, every installed operator must <em>allow</em> the next minor; the others may stay where they are. Plan an operator into a stage when:</p>
            <ul>
              <li>it declares a maximum OpenShift version below that stage&apos;s minor (OLM blocks the update — Readiness shows it from the evidence bundle);</li>
              <li>its channel is named after an OpenShift version (for example OpenShift Data Foundation <code>stable-4.y</code>);</li>
              <li>its vendor ties it to the platform minor (for example OpenShift Virtualization and OpenShift Data Foundation, updated right after each platform minor).</li>
            </ul>
            <p className="subtle">An operator without a declared maximum is not blocked, but that does not prove it is supported on the new minor — check its documentation. Mirrored catalogs contain channel heads only; if an installed version cannot reach the head in one update path, widen that operator&apos;s version range in the stage.</p>
          </details>
        </section>
      ) : null}

      {view ? (
        <section className="card" aria-labelledby={`upgrade-stage-detail-${plan.id}`}>
          <h3 id={`upgrade-stage-detail-${plan.id}`}>Stage {view.id.slice(1)} · {view.release} <span className="subtle">· operator catalog {view.minor}</span></h3>
          {!profile ? (
            <p className="subtle">{received ? "No transfer for this stage has been received on this server yet." : "Prepare the stages to create this stage's content."}</p>
          ) : (
            <>
              <div className="actions">
                <Button variant="secondary" onClick={() => (onPreviewStage ? onPreviewStage(view.id) : stageConfig(profile, view, "preview"))} disabled={!onPreviewStage && !onPreviewFiles}>Preview this stage&apos;s ImageSetConfiguration</Button>
                <Button variant="secondary" disabled={!stagePreview.yaml || stagePreview.loading} aria-describedby={`upgrade-stage-dl-${plan.id}`}
                  onClick={async () => { try { downloadText(`stage-${view.id.slice(1)}-${view.release}-imageset-config.yaml`, await stagePreview.fetchForDownload()); } catch (err) { setError(String(err.message || err)); } }}>Download it</Button>
                <span id={`upgrade-stage-dl-${plan.id}`} className="subtle upgrade-dl-status" role="status">
                  {stagePreview.loading ? "Checking this stage's configuration…"
                    : stagePreview.yaml ? "Ready: validated against the oc-mirror v2 schema (the same file as in the Handoff package)."
                    : stagePreview.notReady.length ? <>Not ready to download: {stagePreview.notReady.join(" ")} {!profile.content?.operators && !received ? "" : null}</>
                    : stagePreview.error ? `Not available: ${stagePreview.error}` : "Not ready to download yet."}
                </span>
              </div>
              {!received && !profile.content?.operators ? (
                <div className="actions">
                  <Button variant="primary" onClick={async () => replaceProfile(await updateProfile(profile.id, { content: { platform: true, operators: true, additionalImages: Boolean(profile.content?.additionalImages) } }))}>Choose operators for this stage ({view.minor} catalog)</Button>
                </div>
              ) : null}
              {!received && profile.content?.operators ? (
                <OperatorsSection key={`operators-${profile.id}-${scannedAt(statusByMinor[view.minor]) || "none"}`} profile={profile} onProfileChanged={replaceProfile} onProfilesChanged={loadProfiles} onShowOperation={onShowOperation} credentialKey={credentialKey} />
              ) : null}
              {!received ? (
                <CollapsibleSection title="Additional images" subtitle={profile.additionalImages?.length ? `${profile.additionalImages.length} for this stage` : "None for this stage"} defaultCollapsed wrapInCard={false}>
                  {profile.content?.additionalImages ? (
                    <AdditionalImagesEditor key={`images-${profile.id}`} profile={profile} onProfileChanged={replaceProfile} />
                  ) : (
                    <div className="actions"><Button variant="secondary" onClick={async () => replaceProfile(await updateProfile(profile.id, { content: { ...profile.content, platform: true, additionalImages: true } }))}>Add additional images to this stage</Button></div>
                  )}
                </CollapsibleSection>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      <Modal isOpen={importOpen} onClose={() => setImportOpen(false)} ariaLabelledBy={`upgrade-import-config-${plan.id}`}>
        <h3 id={`upgrade-import-config-${plan.id}`}>Import previous configuration</h3>
        <PresetImporter plan={plan} onPlanChanged={(p) => { onPlanChanged(p); loadProfiles(); }} onClose={() => setImportOpen(false)} />
      </Modal>
    </div>
  );
}
