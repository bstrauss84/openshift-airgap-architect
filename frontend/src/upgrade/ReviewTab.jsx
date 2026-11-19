/**
 * OpenShift Airgap Architect - Upgrade › 6 Handoff (v2.3.0 UX correction).
 *
 * A short summary and the download, available at ANY time — the files needed to carry out the
 * updates never wait for an update to be done. Shows the route, where content preparation,
 * operators and readiness stand, what is still to do (each with a link to the step that does
 * it), the main handoff package, and — collapsed — the individual files with their provenance
 * labels (validated configuration / template / produced by a completed run). Mirrored archives
 * never travel through the browser; plan deletion lives in the plan header, not here.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useEffect, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import CollapsibleSection from "../components/CollapsibleSection.jsx";
import { fetchArtifacts, fetchReadiness, packageZipUrl } from "./upgradeApi.js";
import { downloadText } from "./ContentTab.jsx";

export const LABEL_TEXT = { VALIDATED: "validated configuration", TEMPLATE: "template — fill in", PRODUCED_BY_RUN: "produced by a completed run", NOT_READY: "not ready" };
const labelState = (l) => (l === "VALIDATED" || l === "PRODUCED_BY_RUN" ? "VERIFIED" : l === "NOT_READY" ? "BLOCKED" : "NOT_CHECKED");

export default function ReviewTab({ plan, onPreviewArtifacts, onGoToStep = null }) {
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

  const views = plan.stageViews || [];
  const inRegistry = views.filter((v) => v.content?.state === "registry-verified").length;
  const updated = views.filter((v) => v.clusterUpdated === "attested").length;
  const operators = views.reduce((n, v) => n + (v.operatorsSelected || 0), 0);
  const s = readiness?.summary;
  const todo = [
    !plan.path ? { text: "Compute the update route", step: "route" } : null,
    plan.path && (!plan.stages.length || plan.stagesStale) ? { text: "Prepare the stages", step: "content" } : null,
    views.length && inRegistry < views.length ? { text: `Get ${views.length - inRegistry} stage(s) into the registry`, step: "mirror" } : null,
    !plan.mirror?.registryUrl ? { text: "Set the mirror registry (the commands use it)", step: "mirror" } : null,
    s?.blocked ? { text: `Resolve ${s.blocked} blocked readiness check(s)`, step: "readiness" } : null,
    s?.notChecked ? { text: `Review ${s.notChecked} readiness check(s) with no evidence yet`, step: "readiness" } : null
  ].filter(Boolean);

  return (
    <div className="upgrade-review">
      {error ? <Banner variant="error">{error}</Banner> : null}
      <section className="card" aria-labelledby={`upgrade-handoff-${plan.id}`}>
        <h3 id={`upgrade-handoff-${plan.id}`}>Handoff</h3>
        <p className="upgrade-handoff-route">{plan.path ? plan.path.path.join(" → ") : "No route yet"} <span className="subtle">· {plan.channelPolicy} · {plan.arch}{plan.strategy === "cpo" ? " · Control Plane Only" : ""}</span></p>
        {plan.path?.conditional ? (
          <Banner variant="warning">
            <strong>This route includes {plan.path.hops.filter((h) => h.conditional).length === 1 ? "a conditional update" : `${plan.path.hops.filter((h) => h.conditional).length} conditional updates`}:</strong>{" "}
            {plan.path.hops.filter((h) => h.conditional).map((h) => `${h.from} → ${h.to} (${(h.risks || []).map((r) => `${r.name}${(r.ruleTypes || []).includes("Always") ? ", applies to every cluster" : ", applies only to matching clusters"}`).join("; ")})`).join(" · ")}.
            {" "}The instructions give no command for {plan.path.hops.filter((h) => h.conditional).length === 1 ? "it" : "them"}; the cluster evaluates whether each risk applies (<code>oc adm upgrade</code>). Acknowledged risks are your judgment, not proof of safety.
          </Banner>
        ) : null}
        <ul className="upgrade-summary-tiles">
          <li><span className="upgrade-tile-label">Content in the registry</span><span className="upgrade-tile-value">{views.length ? `${inRegistry} of ${views.length} stages` : "no stages"}</span></li>
          <li><span className="upgrade-tile-label">Operators</span><span className="upgrade-tile-value">{operators ? `${operators} across ${views.length} stages` : "none chosen"}</span></li>
          <li><span className="upgrade-tile-label">Readiness</span><span className="upgrade-tile-value">{s ? [s.blocked ? `${s.blocked} blocked` : null, s.pending ? `${s.pending} to do` : null, s.attested ? `${s.attested} your statements` : null, s.notChecked ? `${s.notChecked} not checked` : null].filter(Boolean).join(", ") || "all verified or attested" : "…"}</span></li>
          <li><span className="upgrade-tile-label">Cluster updates (your statements)</span><span className="upgrade-tile-value">{plan.path ? `${updated} of ${plan.path.hops.length}` : "—"}</span></li>
        </ul>
        {todo.length ? (
          <div className="upgrade-todo">
            <h4>Still to do</h4>
            <ul>
              {todo.map((t) => <li key={t.text}>{t.text}{onGoToStep ? <> <Button variant="tertiary" className="mini" onClick={() => onGoToStep(t.step)}>Go</Button></> : null}</li>)}
            </ul>
          </div>
        ) : <p className="subtle">Nothing left to prepare in Architect. The updates themselves are run by an administrator (Update the cluster).</p>}
        <div className="upgrade-handoff-download">
          <Button variant="primary" disabled={!plan.path} onClick={() => { const a = document.createElement("a"); a.href = packageZipUrl(plan.id); a.download = ""; document.body.appendChild(a); a.click(); a.remove(); }}>Download the handoff package (.zip)</Button>
          <p className="subtle">Download it now — everything needed to carry out the updates: the plan, route and graph snapshots, validated stage configurations, OSUS / CLI / web console instructions, readiness and templates, with SHA256SUMS. Never mirrored archives or credentials. The checksums show the files were not changed after Architect wrote them; they do not prove who wrote them (the package is not signed). On the disconnected side, use “Import plan…” with <code>oaa-upgrade-package.json</code>.</p>
        </div>
      </section>
      <CollapsibleSection title="Individual files" subtitle={artifacts ? `${artifacts.length} file(s)` : "Loading…"} defaultCollapsed>
        {artifacts ? (
          <>
            <ul className="upgrade-file-list">
              {artifacts.map((f) => (
                <li key={f.name}>
                  <code>{f.name}</code> <span className="upgrade-badge" data-state={labelState(f.label)}>{LABEL_TEXT[f.label] || f.label}</span>
                  <span className="upgrade-file-actions">
                    {f.content ? <Button variant="secondary" className="mini" onClick={() => onPreviewArtifacts([f])}>Preview</Button> : null}
                    {f.content ? <Button variant="secondary" className="mini" onClick={() => downloadText(f.name, f.content)}>Download</Button> : null}
                  </span>
                  <span className="subtle upgrade-file-desc">{f.description}</span>
                </li>
              ))}
            </ul>
            <div className="actions"><Button variant="secondary" disabled={!artifacts.some((f) => f.content)} onClick={() => onPreviewArtifacts(artifacts)}>Preview all in the YAML drawer</Button></div>
            <p className="subtle">Files oc-mirror writes (ImageDigestMirrorSet, CatalogSource, signature ConfigMap, UpdateService) appear only after a stage&apos;s run produced them; Architect never invents them.</p>
          </>
        ) : <div className="loading" role="status">Loading files…</div>}
      </CollapsibleSection>
    </div>
  );
}
