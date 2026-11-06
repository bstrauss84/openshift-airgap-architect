/**
 * OpenShift Airgap Architect - Upgrade route timeline (v2.3.0, RFC §5.3).
 *
 * The solved route as an ordered list: each step shows the release, the
 * channel the cluster must be on for it, the kind of update, its errata and
 * any risk — in text, never colour alone. A vertical list on narrow screens.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React from "react";

const kindLabel = (hop) => (hop.controlPlaneOnly ? "control plane only" : hop.kind === "minor" ? "minor update" : "z-stream update");

export default function UpgradeTimeline({ path, selectedIndex = null, onSelect = null }) {
  if (!path?.hops?.length) return null;
  return (
    <ol className="upgrade-timeline" aria-label={`Update route: ${path.path.join(" to ")}`}>
      <li className="upgrade-timeline-item">
        <div className="upgrade-timeline-node">
          <span className="upgrade-timeline-version">{path.path[0]}</span>
          <span className="upgrade-timeline-meta">current release</span>
        </div>
      </li>
      {path.hops.map((hop, i) => (
        <li className="upgrade-timeline-item" key={`${hop.from}-${hop.to}`}>
          <span className="upgrade-timeline-arrow" aria-hidden="true">→</span>
          <button
            type="button"
            className={`upgrade-timeline-node select-card${selectedIndex === i ? " selected" : ""}`}
            aria-pressed={selectedIndex === i}
            onClick={onSelect ? () => onSelect(i) : undefined}
            aria-label={`Step ${i + 1}: ${hop.from} to ${hop.to}, channel ${hop.channel}, ${kindLabel(hop)}${hop.conditional ? ", conditional update with known risks" : ""}`}
          >
            <span className="upgrade-timeline-version">{hop.to}</span>
            <span className="upgrade-timeline-meta">{hop.channel} · {kindLabel(hop)}</span>
            {hop.conditional ? <span className="upgrade-badge" data-state="WARNING">⚠ conditional</span> : null}
            {hop.channelCheck === "missing" ? <span className="upgrade-badge" data-state="BLOCKED">✕ not in {hop.channel}</span> : null}
            {hop.channelCheck === "not-checked" ? <span className="upgrade-badge" data-state="NOT_CHECKED">? channel not checked</span> : null}
          </button>
        </li>
      ))}
    </ol>
  );
}

export function HopDetail({ hop, index }) {
  if (!hop) return null;
  const digest = hop.payload && hop.payload.includes("@") ? hop.payload.slice(hop.payload.indexOf("@") + 1) : null;
  return (
    <section className="card" aria-labelledby={`upgrade-hop-${index}-title`}>
      <h4 id={`upgrade-hop-${index}-title`}>Step {index + 1}: {hop.from} → {hop.to}</h4>
      <dl className="modal-summary">
        <dt>Channel for this step</dt><dd>{hop.channel} ({hop.channelCheck === "recommended" ? "the update is recommended in this channel" : hop.channelCheck === "conditional" ? "the update is conditional in this channel" : hop.channelCheck === "missing" ? "this channel does not have the update" : "not checked against this channel"})</dd>
        <dt>Kind</dt><dd>{kindLabel(hop)}</dd>
        <dt>Release image digest</dt><dd><code>{digest || "not in the graph"}</code></dd>
        <dt>Errata</dt><dd>{hop.errataUrl ? <a href={hop.errataUrl} target="_blank" rel="noopener noreferrer">{hop.errataUrl}</a> : "none listed"}</dd>
      </dl>
      {hop.conditional ? (
        <div className="note warning">
          <strong>Conditional update.</strong> The update graph lists known risks for this update:
          <ul>
            {hop.risks.map((r) => (
              <li key={r.name}><strong>{r.name}</strong>{r.ruleTypes?.length ? ` (${r.ruleTypes.join(", ")})` : ""}: {r.message} {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">details</a> : null}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
