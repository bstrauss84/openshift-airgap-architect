/**
 * OpenShift Airgap Architect - Channel graph view (v2.3.0, RFC §5.3).
 *
 * Not a force-directed hairball: a lane layout (one column per supported
 * minor, releases ascending), drawing only the planned route and the
 * selected release's own updates. Zoom and pan with buttons or the keyboard
 * (+ − arrows 0); releases are focusable and arrow keys move between them.
 * An accessible table shows the same data. No graph library is used.
 * Motion is limited (no animation), so reduced-motion needs nothing extra.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useMemo, useState } from "react";
import Button from "../components/Button.jsx";

const LANE_W = 220;
const ROW_H = 26;
const TOP = 40;

const minorOf = (v) => v.split(".").slice(0, 2).join(".");

export default function UpgradeGraphView({ graph, path = null, supportedMinors = ["4.20", "4.21", "4.22"] }) {
  const [selected, setSelected] = useState(path?.path?.[path.path.length - 1] || null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [mode, setMode] = useState("graph");

  const layout = useMemo(() => {
    if (!graph) return null;
    const lanes = supportedMinors.map((m) => graph.versions.filter((v) => minorOf(v) === m));
    const pos = {};
    lanes.forEach((vs, li) => vs.forEach((v, ri) => { pos[v] = { x: 40 + li * LANE_W, y: TOP + ri * ROW_H }; }));
    const height = TOP + Math.max(1, ...lanes.map((l) => l.length)) * ROW_H + 20;
    return { lanes, pos, height, width: 40 + supportedMinors.length * LANE_W };
  }, [graph, supportedMinors]);

  if (!graph || !layout) return <p className="subtle">Load a graph to see it.</p>;
  const onPath = new Set(path?.path || []);
  const pathEdges = new Set((path?.hops || []).map((h) => `${h.from}>${h.to}`));
  const shown = [
    ...(path?.hops || []).map((h) => ({ from: h.from, to: h.to, onPath: true, conditional: h.conditional })),
    ...(selected ? graph.edges.filter(([a, b]) => (a === selected || b === selected) && !pathEdges.has(`${a}>${b}`)).map(([a, b]) => ({ from: a, to: b })) : []),
    ...(selected ? graph.conditional.filter((c) => (c.from === selected || c.to === selected) && !pathEdges.has(`${c.from}>${c.to}`)).map((c) => ({ from: c.from, to: c.to, conditional: true })) : [])
  ].filter((e) => layout.pos[e.from] && layout.pos[e.to]);

  const zoom = (f) => setView((v) => ({ ...v, scale: Math.min(4, Math.max(0.4, v.scale * f)) }));
  const pan = (dx, dy) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  const reset = () => setView({ x: 0, y: 0, scale: 1 });
  const onKey = (e) => {
    const map = { "+": () => zoom(1.25), "=": () => zoom(1.25), "-": () => zoom(0.8), "0": reset };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  };
  const moveSelection = (e, v) => {
    const lane = supportedMinors.indexOf(minorOf(v));
    const list = layout.lanes[lane];
    const i = list.indexOf(v);
    let next = null;
    if (e.key === "ArrowDown") next = list[i + 1];
    else if (e.key === "ArrowUp") next = list[i - 1];
    else if (e.key === "ArrowRight") next = layout.lanes[lane + 1]?.[Math.min(i, (layout.lanes[lane + 1]?.length || 1) - 1)];
    else if (e.key === "ArrowLeft") next = layout.lanes[lane - 1]?.[Math.min(i, (layout.lanes[lane - 1]?.length || 1) - 1)];
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(v); return; }
    if (next) { e.preventDefault(); e.stopPropagation(); setSelected(next); document.getElementById(`upgrade-graph-node-${next.replace(/\./g, "-")}`)?.focus(); }
  };
  const vbW = layout.width / view.scale;
  const vbH = Math.min(layout.height, 600) / view.scale;
  const sel = selected && graph.nodes[selected];
  return (
    <div className="upgrade-graph-wrap">
      <div className="upgrade-graph-toolbar" role="toolbar" aria-label="Graph view controls">
        <Button variant="secondary" aria-pressed={mode === "graph"} onClick={() => setMode("graph")}>Graph</Button>
        <Button variant="secondary" aria-pressed={mode === "table"} onClick={() => setMode("table")}>Accessible table</Button>
        {mode === "graph" ? (
          <>
            <Button variant="secondary" onClick={() => zoom(1.25)} aria-label="Zoom in">＋</Button>
            <Button variant="secondary" onClick={() => zoom(0.8)} aria-label="Zoom out">－</Button>
            <Button variant="secondary" onClick={() => pan(0, -80)} aria-label="Pan up">↑</Button>
            <Button variant="secondary" onClick={() => pan(0, 80)} aria-label="Pan down">↓</Button>
            <Button variant="secondary" onClick={() => pan(-120, 0)} aria-label="Pan left">←</Button>
            <Button variant="secondary" onClick={() => pan(120, 0)} aria-label="Pan right">→</Button>
            <Button variant="secondary" onClick={reset}>Reset view</Button>
          </>
        ) : null}
        <span className="subtle" role="note">Solid blue: planned route. Dashed: conditional update. Only the route and the selected release&apos;s updates are drawn.</span>
      </div>
      {mode === "graph" ? (
        <svg
          className="upgrade-graph-svg"
          viewBox={`${view.x} ${view.y} ${vbW} ${vbH}`}
          role="group"
          aria-label={`${graph.channel} update graph, ${graph.versions.length} releases in the supported minors`}
          tabIndex={0}
          onKeyDown={onKey}
        >
          {supportedMinors.map((m, i) => <text key={m} className="upgrade-graph-lane-label" x={40 + i * LANE_W} y={20}>OpenShift {m}</text>)}
          {shown.map((e) => {
            const a = layout.pos[e.from];
            const b = layout.pos[e.to];
            const mid = (a.x + b.x) / 2 + (a.x === b.x ? 60 : 0);
            return <path key={`${e.from}>${e.to}`} className={`upgrade-graph-edge${e.onPath ? " on-path" : ""}${e.conditional ? " conditional" : ""}`} d={`M${a.x},${a.y} Q${mid},${(a.y + b.y) / 2} ${b.x},${b.y}`} />;
          })}
          {graph.versions.map((v) => {
            const p = layout.pos[v];
            if (!p) return null;
            return (
              <g
                key={v}
                id={`upgrade-graph-node-${v.replace(/\./g, "-")}`}
                className={`upgrade-graph-node${onPath.has(v) ? " on-path" : ""}${selected === v ? " selected" : ""}`}
                transform={`translate(${p.x},${p.y})`}
                tabIndex={onPath.has(v) || selected === v ? 0 : -1}
                role="button"
                aria-label={`${v}${onPath.has(v) ? ", on the planned route" : ""}`}
                aria-pressed={selected === v}
                onClick={() => setSelected(v)}
                onKeyDown={(e) => moveSelection(e, v)}
              >
                <circle r={6} />
                <text x={10} y={4}>{v}</text>
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ maxHeight: 420, overflow: "auto" }}>
          <table className="upgrade-graph-table">
            <caption className="subtle">{graph.channel} ({graph.arch}): recommended and conditional updates from each release in the supported minors.</caption>
            <thead><tr><th scope="col">Release</th><th scope="col">On route</th><th scope="col">Recommended updates to</th><th scope="col">Conditional updates to</th></tr></thead>
            <tbody>
              {graph.versions.map((v) => (
                <tr key={v}>
                  <th scope="row">{v}</th>
                  <td>{onPath.has(v) ? "yes" : ""}</td>
                  <td>{graph.edges.filter(([a]) => a === v).map(([, b]) => b).join(", ")}</td>
                  <td>{graph.conditional.filter((c) => c.from === v).map((c) => c.to).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel ? (
        <div className="note subtle" role="status" style={{ margin: 8 }}>
          <strong>{selected}</strong> · {graph.edges.filter(([a]) => a === selected).length} recommended and {graph.conditional.filter((c) => c.from === selected).length} conditional updates from it
          {sel.errataUrl ? <> · <a href={sel.errataUrl} target="_blank" rel="noopener noreferrer">errata</a></> : null}
        </div>
      ) : null}
    </div>
  );
}
