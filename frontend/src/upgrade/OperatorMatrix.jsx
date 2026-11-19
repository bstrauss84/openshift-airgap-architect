/**
 * OpenShift Airgap Architect - Upgrade › Content › "Operators across the route" (owner QA 4).
 *
 * One row per operator, one column per stage, every column sharing the same row boundaries:
 *  - each stage cell has the same three lines: mark + selected channel · verdict · catalog default
 *    (or "copied from stage N"), so rows never grow unpredictably;
 *  - explanations live in one expandable detail row per operator ("Details"), not inside cells;
 *  - the "on the cluster" note is OPTIONAL and off by default. An audit (owner QA 4) showed the old
 *    four-way "category" changed nothing that Architect generates — not the ImageSetConfigurations,
 *    channels, catalogs, readiness or instructions; it was descriptive metadata saved in the plan.
 *    It is kept only as a note (installed / new), clearly labelled, with installed state from the
 *    readiness bundle shown as cluster evidence and anything the user picks as their statement.
 * Channel evidence, suggestions (explicit, with Undo) and the copied-default banner are unchanged.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useMemo, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import Switch from "../components/Switch.jsx";
import { cellEvidence, provenanceOf, scannedDefault } from "./routeCatalogs.js";

/** The optional note. Stored values from earlier plans map onto it (see noteOf). */
export const NOTE_LABEL = { installed: "Installed (your statement)", requested: "New — not installed yet" };
const NOT_NOTED = "";
/** preset-mirrored (imported files) is provenance, not a statement; retained was "installed, kept". */
export const noteOf = (e) => (!e ? NOT_NOTED : e.category === "installed" || e.category === "retained" ? "installed" : e.category === "requested" ? "requested" : NOT_NOTED);

export default function OperatorMatrix({ plan, views, profiles, readOnly, onSaveIntent, statusByMinor, scans, detailsFor = () => null, onApplyChannels = null, onRecordInstalled = null, clusterOperatorCount = 0 }) {
  const [filter, setFilter] = useState("");
  const [noteFilter, setNoteFilter] = useState("all");
  const [notesOn, setNotesOn] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [bulkNote, setBulkNote] = useState("installed");
  const [overwrite, setOverwrite] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [open, setOpen] = useState(() => new Set());
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
  const noteFor = (r) => noteOf(intent.get(r.key));
  const fromEvidence = (r) => intent.get(r.key)?.confidence === "cluster-export";
  const shown = rows.filter((r) => (!filter.trim() || `${r.display} ${r.name}`.toLowerCase().includes(filter.trim().toLowerCase()))
    && (!notesOn || noteFilter === "all" || noteFor(r) === (noteFilter === "none" ? NOT_NOTED : noteFilter)));
  const shownKeys = new Set(shown.map((r) => r.key));
  const selected = [...picked].filter((k) => shownKeys.has(k)); // never includes rows the filter hides
  const toggle = (key) => setPicked((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const toggleOpen = (key) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  // One evidence computation per cell, with the copied-from stage's catalog default (owner QA 3b).
  const evidence = (r, i) => {
    const op = r.cells[i];
    if (!op) return null;
    const copied = (op.sources || []).map((x) => /^upgrade:copied-from-(s\d+)$/.exec(x)?.[1]).find(Boolean) || null;
    const srcIdx = copied ? views.findIndex((v) => v.id === copied) : -1;
    const srcOp = srcIdx >= 0 ? r.cells[srcIdx] : null;
    const sourceDefault = srcOp ? (detailsFor(srcOp)?.listing?.defaultChannel || scannedDefault(statusByMinor[views[srcIdx].minor], srcOp)) : null;
    return { ...cellEvidence(op, views[i].minor, statusByMinor[views[i].minor], scans[views[i].minor], detailsFor(op), { sourceDefault }), copiedFrom: copied };
  };

  const entryFor = (r, note) => {
    const e = intent.get(r.key);
    if (e) return { name: e.name, catalogKind: e.catalogKind, channel: e.channel, sources: e.sources, category: note, confidence: e.confidence === "cluster-export" || e.confidence === "imported-preset" ? "user-confirmed" : e.confidence };
    return { name: r.name, catalogKind: r.catalog, channel: null, sources: [], category: note, confidence: "user-entered" };
  };
  const setOne = async (r, note) => {
    const prev = intent.get(r.key) || null;
    if (!note) { await onSaveIntent({ remove: [r.key] }); setFeedback({ text: `${r.display}: not noted.`, undo: prev ? { entries: [prev] } : null }); return; }
    await onSaveIntent({ entries: [entryFor(r, note)] });
    setFeedback({ text: `${r.display}: ${NOTE_LABEL[note]}.`, undo: prev ? { entries: [prev] } : { remove: [r.key] } });
  };
  const applyBulk = async () => {
    const targets = shown.filter((r) => selected.includes(r.key));
    const change = targets.filter((r) => overwrite || noteFor(r) === NOT_NOTED).filter((r) => noteFor(r) !== bulkNote);
    const kept = targets.length - change.length;
    if (!change.length) { setFeedback({ text: `Nothing changed: ${kept} operator(s) already noted${overwrite ? " (or already this note)" : " — turn on “Also change operators already noted” to change them"}.`, undo: null }); return; }
    const prevEntries = change.map((r) => intent.get(r.key)).filter(Boolean);
    const newKeys = change.filter((r) => !intent.get(r.key)).map((r) => r.key);
    await onSaveIntent({ entries: change.map((r) => entryFor(r, bulkNote)) });
    setFeedback({ text: `${change.length} operator(s) noted as “${NOTE_LABEL[bulkNote]}”.${kept ? ` ${kept} kept (already noted).` : ""}`, undo: { entries: prevEntries, remove: newKeys } });
    setPicked(new Set());
  };
  const undo = async () => {
    const u = feedback?.undo;
    if (!u) return;
    await onSaveIntent({ ...(u.entries?.length ? { entries: u.entries.map((e) => ({ name: e.name, catalogKind: e.catalogKind, channel: e.channel, sources: e.sources, category: e.category, confidence: e.confidence })) } : {}), ...(u.remove?.length ? { remove: u.remove } : {}) });
    setFeedback({ text: "Undone.", undo: null });
  };

  if (!rows.length) return <p className="subtle">No operators chosen yet. Choose them for a stage below (Quick Picks, catalog browser), or import a previous configuration.</p>;
  const notedCount = rows.filter((r) => noteFor(r) !== NOT_NOTED).length;
  const suggestions = [];
  rows.forEach((r) => r.cells.forEach((op, i) => {
    if (!op) return;
    const ev = evidence(r, i);
    if (ev.suggest && ev.suggest.channel !== op.defaultChannel) suggestions.push({ key: `${views[i].id}|${r.key}`, stage: views[i], profileId: views[i].linkedProfileId, row: r, op, ev, ...ev.suggest });
  }));
  const copiedStale = suggestions.filter((x) => x.pretick && x.ev.copiedFrom);
  const cols = 1 + (notesOn ? 1 : 0) + views.length;

  return (
    <div className="upgrade-matrix">
      <div className="upgrade-matrix-toolbar">
        <div className="upgrade-matrix-find" role="search" aria-label="Find operators">
          <input type="search" className="upgrade-matrix-search" aria-label="Filter operators" placeholder="Filter by name…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {notesOn ? (
            <select className="upgrade-matrix-catfilter" aria-label="Show note" value={noteFilter} onChange={(e) => setNoteFilter(e.target.value)}>
              <option value="all">All operators</option>
              <option value="none">Not noted</option>
              {Object.entries(NOTE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          ) : null}
          <span className="subtle upgrade-matrix-count" role="status">{shown.length === rows.length ? `${rows.length} operator${rows.length === 1 ? "" : "s"}` : `Showing ${shown.length} of ${rows.length}`}</span>
        </div>
        <div className="upgrade-matrix-notes-toggle">
          <Switch checked={notesOn} onChange={setNotesOn} aria-label="Note which operators are already installed" />
          <span>
            <strong>Note which operators are already installed</strong> <span className="subtle">(optional{notedCount ? ` · ${notedCount} noted` : ""})</span>
            <span className="subtle upgrade-matrix-notes-why">A note for you and the handoff. It does not change what is mirrored, the channels, readiness or the update instructions.</span>
          </span>
        </div>
        {notesOn && !readOnly ? (
          <div className="upgrade-matrix-bulk-panel" role="group" aria-labelledby={`upgrade-bulk-title-${plan.id}`}>
            <div className="upgrade-matrix-bulk-head">
              <strong id={`upgrade-bulk-title-${plan.id}`}>Note several operators at once</strong>
              <span className="subtle">{selected.length ? `${selected.length} selected` : "Tick operators in the table, or select all shown."}</span>
              <Button variant="tertiary" className="mini" disabled={!shown.length} onClick={() => setPicked(selected.length === shown.length ? new Set() : new Set(shown.map((r) => r.key)))}>
                {selected.length === shown.length && shown.length ? "Clear selection" : `Select shown (${shown.length})`}
              </Button>
            </div>
            <div className="upgrade-matrix-bulk-row">
              <label className="upgrade-matrix-bulk-field" htmlFor={`upgrade-bulk-cat-${plan.id}`}>
                <span className="subtle">Note</span>
                <select id={`upgrade-bulk-cat-${plan.id}`} aria-label="Note for the selected operators" value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} disabled={!selected.length}>
                  {Object.entries(NOTE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label className="toggle-row upgrade-matrix-overwrite">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} disabled={!selected.length} />
                <span>Also change operators already noted</span>
              </label>
              <Button variant="primary" className="mini upgrade-matrix-apply" disabled={!selected.length} onClick={applyBulk}>Note {selected.length} selected</Button>
            </div>
            <p className="subtle upgrade-matrix-notes-why">
              Only the readiness bundle (Readiness › Check my cluster&apos;s readiness) is evidence of what is installed; a note you choose is your statement.
              Noting an operator as installed does not stop OLM from updating it.
              {onRecordInstalled && clusterOperatorCount ? <> <Button variant="secondary" className="mini" onClick={onRecordInstalled}>Fill in the {clusterOperatorCount} installed operator(s) from the cluster evidence</Button></> : null}
            </p>
          </div>
        ) : null}
      </div>
      {feedback ? (
        <p className="upgrade-matrix-feedback" role="status">
          {feedback.text} {feedback.undo ? <Button variant="tertiary" className="mini" onClick={undo}>Undo</Button> : null}
        </p>
      ) : null}
      {copiedStale.length ? (
        <Banner variant="warning">
          <strong>{copiedStale.length} channel{copiedStale.length === 1 ? " was" : "s were"} copied from an earlier stage and {copiedStale.length === 1 ? "is" : "are"} not this stage&apos;s catalog default.</strong>{" "}
          For example {copiedStale[0].row.display}: stage {copiedStale[0].stage.id.slice(1)} would mirror <code>{copiedStale[0].ev.selected}</code>, but its {copiedStale[0].stage.minor} catalog defaults to <code>{copiedStale[0].ev.catalogDefault}</code>.
          {" "}They are pre-ticked in Channel suggestions below; nothing changes until you apply them.
          {" "}<Button variant="secondary" className="mini" onClick={() => document.getElementById(`upgrade-channel-suggest-${plan.id}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" })}>Review suggestions</Button>
        </Banner>
      ) : null}
      <div className="upgrade-table-scroll">
        <table className="upgrade-operator-matrix">
          <caption className="sr-only">Operators on each stage of the route, with the selected channel and catalog evidence per stage</caption>
          <thead>
            <tr>
              <th scope="col" className="upgrade-mx-op">Operator</th>
              {notesOn ? <th scope="col" className="upgrade-mx-note">On the cluster</th> : null}
              {views.map((v) => <th scope="col" key={v.id} className="upgrade-mx-stage">Stage {v.id.slice(1)} · {v.release}<span className="subtle upgrade-matrix-minor">catalog {v.minor}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const e = intent.get(r.key);
              const isOpen = open.has(r.key);
              const detailId = `upgrade-mx-detail-${plan.id}-${r.key.replace(/[^a-z0-9-]/gi, "-")}`;
              const evs = r.cells.map((_, i) => evidence(r, i));
              return (
                <React.Fragment key={r.key}>
                  <tr className="upgrade-mx-row" data-selected={picked.has(r.key) ? "true" : undefined}>
                    <th scope="row" className="upgrade-mx-op">
                      <div className="upgrade-mx-opgrid">
                        {notesOn && !readOnly ? <input type="checkbox" className="upgrade-matrix-pick" aria-label={`Select ${r.display}`} checked={picked.has(r.key)} onChange={() => toggle(r.key)} /> : <span aria-hidden="true" />}
                        <span className="upgrade-mx-name">{r.display}<span className="subtle"> ({r.catalog})</span></span>
                        <span aria-hidden="true" />
                        <span className="subtle upgrade-matrix-why" title={provenanceOf([...r.sources]).join(" · ")}>{provenanceOf([...r.sources]).join(" · ")}</span>
                        <span aria-hidden="true" />
                        <span><Button variant="tertiary" className="mini upgrade-mx-details" aria-expanded={isOpen} aria-controls={detailId} aria-label={`${isOpen ? "Hide" : "Show"} details for ${r.display}`} onClick={() => toggleOpen(r.key)}>{isOpen ? "Hide details" : "Details"}</Button></span>
                      </div>
                    </th>
                    {notesOn ? (
                      <td className="upgrade-mx-note">
                        <select aria-label={`${r.display} on the cluster`} value={noteFor(r)} disabled={readOnly} onChange={(ev) => setOne(r, ev.target.value)}>
                          <option value={NOT_NOTED}>Not noted</option>
                          {Object.entries(NOTE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                        <span className="subtle upgrade-mx-note-src">{fromEvidence(r) ? "from cluster evidence" : e && noteFor(r) !== NOT_NOTED ? "your statement" : " "}</span>
                      </td>
                    ) : null}
                    {r.cells.map((op, i) => {
                      if (!op) return <td key={views[i].id} className="upgrade-matrix-cell upgrade-mx-empty"><span className="subtle" aria-label="not selected for this stage">—</span></td>;
                      const ev = evs[i];
                      const third = ev.catalogDefault && ev.catalogDefault !== ev.selected
                        ? <>Catalog default: <code>{ev.catalogDefault}</code> ({ev.defaultFrom})</>
                        : ev.copiedFrom ? `copied from stage ${ev.copiedFrom.slice(1)}` : " ";
                      return (
                        <td key={views[i].id} className="upgrade-matrix-cell" data-state={ev.state}>
                          <div className="upgrade-cell">
                            <span className="upgrade-cell-sel">
                              <span className="upgrade-cell-mark" data-state={ev.state} aria-hidden="true">{ev.mark}</span>
                              <span className="upgrade-cell-channel" title={ev.copiedFrom ? `Selected channel (copied from stage ${ev.copiedFrom.slice(1)})` : "Selected channel: what this stage mirrors"}>{ev.selected || <em>no channel</em>}</span>
                            </span>
                            <span className="upgrade-cell-label" data-state={ev.state}>{ev.label}</span>
                            <span className="upgrade-cell-default" title={ev.catalogDefault ? `This stage's catalog default (${ev.defaultFrom})` : undefined}>{third}</span>
                          </div>
                          <span className="sr-only">{ev.detail}</span>
                        </td>
                      );
                    })}
                  </tr>
                  {isOpen ? (
                    <tr className="upgrade-mx-detail" id={detailId}>
                      <td colSpan={cols}>
                        <dl className="upgrade-mx-detail-list">
                          <dt>Why it is in the stages</dt><dd>{provenanceOf([...r.sources]).join(" · ")}</dd>
                          {e ? <><dt>Note</dt><dd>{noteFor(r) ? NOTE_LABEL[noteFor(r)] : "Not noted"}{fromEvidence(r) ? " — from the cluster evidence (readiness bundle)" : e.confidence === "imported-preset" ? " — from an imported configuration file (unverified)" : ""}</dd></> : null}
                          {r.cells.map((op, i) => (op ? (
                            <React.Fragment key={views[i].id}>
                              <dt>Stage {views[i].id.slice(1)} · {views[i].release}</dt>
                              <dd>{evs[i].detail}{evs[i].copiedFrom ? ` Copied from stage ${evs[i].copiedFrom.slice(1)}.` : ""}{evs[i].catalogDefault ? ` Catalog default: ${evs[i].catalogDefault} (from the ${evs[i].defaultFrom}).` : ""}</dd>
                            </React.Fragment>
                          ) : null))}
                        </dl>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length < rows.length ? <p className="subtle">{rows.length - shown.length} operator(s) hidden by the filter; the selection includes shown operators only.</p> : null}
      {suggestions.length || channelFeedback ? (() => {
        const pickedSet = suggestPicked || new Set(suggestions.filter((x) => x.pretick).map((x) => x.key));
        const togglePick = (k) => { const n = new Set(pickedSet); if (n.has(k)) n.delete(k); else n.add(k); setSuggestPicked(n); };
        const apply = async () => {
          const chosen = suggestions.filter((x) => pickedSet.has(x.key));
          const undoList = await onApplyChannels(chosen.map((x) => ({ profileId: x.profileId, name: x.op.name, channel: x.channel })));
          setChannelFeedback({ text: `${chosen.length} channel(s) changed. Each stage's Live catalog check re-checks them.`, undo: undoList });
          setSuggestPicked(null);
        };
        return (
          <details className="upgrade-channel-suggest" id={`upgrade-channel-suggest-${plan.id}`} open={suggestions.some((x) => x.pretick)}>
            <summary>Channel suggestions ({suggestions.length}) <span className="subtle">— from catalog evidence; nothing changes until you apply</span></summary>
            {channelFeedback ? <p className="upgrade-matrix-feedback" role="status">{channelFeedback.text} {channelFeedback.undo ? <Button variant="tertiary" className="mini" onClick={async () => { await onApplyChannels(channelFeedback.undo); setChannelFeedback({ text: "Channel changes undone.", undo: null }); }}>Undo</Button> : null}</p> : null}
            {suggestions.length ? (
              <>
                <ul className="upgrade-check-list">
                  {suggestions.map((x) => (
                    <li key={x.key}>
                      <label className="toggle-row">
                        <input type="checkbox" checked={pickedSet.has(x.key)} disabled={readOnly} onChange={() => togglePick(x.key)} />
                        <span>Stage {x.stage.id.slice(1)} · <strong>{x.row.display}</strong>: {x.op.defaultChannel || "no channel"} → <strong>{x.channel}</strong> <span className="subtle">({x.why}; {provenanceOf(x.op.sources || []).join(", ")})</span></span>
                      </label>
                    </li>
                  ))}
                </ul>
                {!readOnly && onApplyChannels ? <div className="actions"><Button variant="primary" className="mini" disabled={!pickedSet.size} onClick={apply}>Apply {pickedSet.size} channel change(s)</Button></div> : null}
                <p className="subtle">Pre-ticked: channels a stage&apos;s catalog does not list, stages with no channel, and channels copied from an earlier stage where they are that stage&apos;s default while this stage&apos;s catalog has another default. Others only differ from the catalog&apos;s default, which is not evidence they are wrong — tick them if you want the default.</p>
              </>
            ) : null}
          </details>
        );
      })() : null}
      <details className="upgrade-matrix-legend">
        <summary>How to read a stage cell</summary>
        <ul>
          <li><strong>First line</strong> — the selected channel: what this stage will mirror.</li>
          <li><strong>Second line</strong> — what this stage&apos;s own catalog says about it (below).</li>
          <li><strong>Third line</strong> — this stage&apos;s catalog default when it differs, or “copied from stage N”. <strong>Details</strong> on a row explains every stage.</li>
          <li><span className="upgrade-cell-mark" data-state="VERIFIED">✓</span> verified — the Live catalog check confirmed the channel in this stage&apos;s catalog, or it is the scanned catalog&apos;s default</li>
          <li><span className="upgrade-cell-mark" data-state="WARNING">≠</span> not this catalog&apos;s default — the channel exists (Live check) or may exist, but this catalog defaults to another one; for version-named channels (for example ODF stable-4.y) you usually want this stage&apos;s default</li>
          <li><span className="upgrade-cell-mark" data-state="NOT_CHECKED">?</span> not confirmed here — a scan knows only default channels; run “Check channels in every stage”</li>
          <li><span className="upgrade-cell-mark" data-state="NOT_CHECKED">○</span> not scanned · <span className="upgrade-cell-mark" data-state="PENDING">…</span> scanning · <span className="upgrade-cell-mark" data-state="WARNING">!</span> scan failed · <span className="upgrade-cell-mark" data-state="WARNING">⚠</span> no version in range</li>
          <li><span className="upgrade-cell-mark" data-state="BLOCKED">✕</span> not in this stage&apos;s catalog, or the channel is missing there</li>
          <li>None of these says the operator is compatible with your running cluster; that is a readiness item.</li>
        </ul>
      </details>
    </div>
  );
}
