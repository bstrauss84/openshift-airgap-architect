/**
 * OpenShift Airgap Architect - Upgrade › Review & export (v2.3.0, RFC §9.2-9.3).
 *
 * One page with the route, its graph source and age, stages and their
 * evidence, readiness, artifacts (labelled VALIDATED / TEMPLATE / PRODUCED BY
 * RUN — oc-mirror output is never fabricated) and the plan package.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useEffect, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import { Freshness } from "./PathTab.jsx";
import { CONTENT_STATE_TEXT } from "./ContentTab.jsx";
import { fetchArtifacts, fetchReadiness, packageZipUrl } from "./upgradeApi.js";

export const LABEL_TEXT = { VALIDATED: "validated configuration", TEMPLATE: "template — fill in", PRODUCED_BY_RUN: "produced by a completed run", NOT_READY: "not ready" };

export default function ReviewTab({ plan, onPreviewArtifacts, onDelete }) {
  const [artifacts, setArtifacts] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchArtifacts(plan.id), fetchReadiness(plan.id)])
      .then(([a, r]) => { if (!cancelled) { setArtifacts(a.files); setReadiness(r); } })
      .catch((err) => { if (!cancelled) setError(String(err.message || err)); });
    return () => { cancelled = true; };
  }, [plan.id, plan.updatedAt]);
  return (
    <div className="upgrade-review">
      {error ? <Banner variant="error">{error}</Banner> : null}
      <section className="card" aria-labelledby={`upgrade-review-${plan.id}`}>
        <h3 id={`upgrade-review-${plan.id}`}>Review</h3>
        <dl className="modal-summary">
          <dt>Route</dt><dd>{plan.path ? plan.path.path.join(" → ") : "not computed"}</dd>
          <dt>Architecture</dt><dd>{plan.arch}</dd>
          <dt>Channels</dt><dd>{plan.path ? [...new Set(plan.path.hops.map((h) => h.channel))].join(", ") : "—"} ({plan.channelStrategy === "single" ? "single target channel" : "per minor"})</dd>
          <dt>Strategy</dt><dd>{plan.strategy === "cpo" ? "Control Plane Only (4.20 → 4.22)" : "Standard"}{plan.channelPolicy === "fast" ? " · fast channel" : ""}</dd>
          <dt>Update method</dt><dd>OSUS (recommended), CLI or web console — see Instructions</dd>
          <dt>Readiness</dt><dd>{readiness ? `${readiness.summary.state}; cluster readiness ${readiness.summary.clusterReadiness}` : "…"}</dd>
        </dl>
        {plan.graph ? <Freshness graph={plan.graph} label="Planning graph" /> : null}
        {plan.path?.graphSources?.length ? (
          <ul className="subtle">{plan.path.graphSources.map((g) => <li key={g.channel}>{g.channel}: {g.origin} at {g.fetchedAt} (SHA-256 {g.bodySha256?.slice(0, 16)}…)</li>)}</ul>
        ) : null}
        <h4>Stages</h4>
        {plan.stageViews?.length ? (
          <ul>{plan.stageViews.map((s) => <li key={s.id}>Stage {s.id.slice(1)} ({s.release}): {(CONTENT_STATE_TEXT[s.content?.state] || [null, s.content?.state])[1]}; cluster {s.clusterUpdated === "attested" ? "updated (your statement)" : "not recorded as updated"}</li>)}</ul>
        ) : <p className="subtle">No stages prepared.</p>}
      </section>
      <section className="card" aria-labelledby={`upgrade-artifacts-${plan.id}`}>
        <h3 id={`upgrade-artifacts-${plan.id}`}>Artifacts</h3>
        <p className="subtle">Configuration and resources for this plan. Files oc-mirror writes (ImageDigestMirrorSet, CatalogSource, signature ConfigMap, UpdateService) appear only after a stage&apos;s run produced them.</p>
        {artifacts ? (
          <ul>{artifacts.map((f) => <li key={f.name}><code>{f.name}</code> — <span className="upgrade-badge" data-state={f.label === "VALIDATED" || f.label === "PRODUCED_BY_RUN" ? "VERIFIED" : f.label === "NOT_READY" ? "BLOCKED" : "NOT_CHECKED"}>{LABEL_TEXT[f.label] || f.label}</span> {f.description}</li>)}</ul>
        ) : <div className="loading" role="status">Loading artifacts…</div>}
        <div className="actions">
          <Button variant="secondary" disabled={!artifacts?.some((f) => f.content)} onClick={() => onPreviewArtifacts(artifacts)}>Preview in the YAML drawer</Button>
          {plan.path ? <a className="ghost" href={packageZipUrl(plan.id)} download>Download the plan package (.zip)</a> : null}
        </div>
        <p className="subtle">The package holds the plan, its graph snapshots, validated stage configurations, instructions, readiness, templates and tool guidance — never mirrored archives or credentials. Its SHA256SUMS show the files were not changed after Architect wrote them; they do not prove who wrote them (the package is not signed). On the disconnected side, import <code>oaa-upgrade-package.json</code> with “Import plan…”.</p>
      </section>
      <section className="card">
        <h3>Delete this plan</h3>
        <p className="subtle">You choose separately whether its stage profiles go too. Mirrored data on disk is never deleted.</p>
        <Button variant="destructive" onClick={onDelete}>Delete plan…</Button>
      </section>
    </div>
  );
}
