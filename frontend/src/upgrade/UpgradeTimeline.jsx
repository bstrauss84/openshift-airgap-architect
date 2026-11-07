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
import { getMinorVersion, compareVersions } from "../../../shared/versionUtils.js";

const kindLabel = (hop) => (hop.controlPlaneOnly ? "control plane only" : hop.kind === "minor" ? "minor update" : "z-stream update");
const minorOf = (v) => { try { return getMinorVersion(v) || ""; } catch { return ""; } };
/** EUS only when the graph itself lists the release in an eus-4.x channel — never inferred from an even minor. */
const eusOf = (v, nodeInfo) => (nodeInfo?.[v]?.channels || []).some((c) => c === `eus-${minorOf(v)}`);

/**
 * The route as a release rail (v2.3.0 UX): each release is a node, tinted by its minor (the
 * minor is also written out — colour never carries meaning alone), with an EUS badge only when
 * the update graph lists that release in an EUS channel. Each update between nodes shows its
 * kind and the channel the cluster must be on for it.
 */
export default function UpgradeTimeline({ path, selectedIndex = null, onSelect = null, nodeInfo = null, exploreBefore = null }) {
  // Exploration (D-1): releases before the planning range are labelled as such on the rail.
  const outside = (v) => Boolean(exploreBefore && minorOf(v) && compareVersions(`${minorOf(v)}.0`, `${exploreBefore}.0`) < 0);
  if (!path?.hops?.length) return null;
  const minors = [...new Set(path.path.map(minorOf))];
  const tint = (v) => `m${minors.indexOf(minorOf(v)) % 4}`;
  const Node = ({ v, meta }) => (
    <span className="upgrade-rail-node-body">
      <span className="upgrade-timeline-version">{v}</span>
      <span className="upgrade-timeline-meta">{meta}</span>
      <span className="upgrade-rail-badges">
        <span className="upgrade-rail-minor">OpenShift {minorOf(v)}</span>
        {eusOf(v, nodeInfo) ? <span className="upgrade-badge upgrade-eus-badge" data-state="NOT_CHECKED" title="This release is in an EUS channel of the update graph">EUS</span> : null}
        {outside(v) ? <span className="upgrade-rail-outside">outside planning range</span> : null}
      </span>
    </span>
  );
  return (
    <ol className="upgrade-timeline upgrade-rail" aria-label={`Update route: ${path.path.join(" to ")}`}>
      <li className="upgrade-timeline-item">
        <div className="upgrade-timeline-node upgrade-rail-node" data-tint={tint(path.path[0])} data-explore={outside(path.path[0]) ? "true" : undefined}>
          <Node v={path.path[0]} meta="current release" />
        </div>
      </li>
      {path.hops.map((hop, i) => (
        <li className="upgrade-timeline-item" key={`${hop.from}-${hop.to}`}>
          <span className="upgrade-rail-link" aria-hidden="true">
            <span className="upgrade-rail-link-kind">{kindLabel(hop)}</span>
            <span className="upgrade-rail-link-line" data-conditional={hop.conditional ? "true" : undefined} />
            <span className="upgrade-rail-link-channel">{hop.channel}</span>
          </span>
          <button
            type="button"
            className={`upgrade-timeline-node upgrade-rail-node select-card${selectedIndex === i ? " selected" : ""}`}
            data-tint={tint(hop.to)}
            data-explore={outside(hop.to) ? "true" : undefined}
            aria-pressed={selectedIndex === i}
            onClick={onSelect ? () => onSelect(selectedIndex === i ? null : i) : undefined}
            aria-label={`Update ${i + 1}: ${hop.from} to ${hop.to}, ${kindLabel(hop)}, channel ${hop.channel}${eusOf(hop.to, nodeInfo) ? ", EUS release" : ""}${outside(hop.to) ? ", outside Architect's planning range" : ""}${hop.conditional ? ", conditional update with known risks" : ""}.${onSelect ? " Show details." : ""}`}
          >
            <Node v={hop.to} meta={i === path.hops.length - 1 ? "target" : `update ${i + 1}`} />
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
      <h4 id={`upgrade-hop-${index}-title`}>Update {index + 1}: {hop.from} → {hop.to}</h4>
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
