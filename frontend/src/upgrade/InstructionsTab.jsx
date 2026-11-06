/**
 * OpenShift Airgap Architect - Upgrade › Instructions (v2.3.0, RFC §9.1).
 *
 * OpenShift Update Service (recommended), CLI without OSUS, and the web
 * console, step by step for every update on the route, each citing the
 * documentation of the minor it updates into. Commands list the readiness
 * checks still open; conditional updates get no executable update command.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useEffect, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import { fetchInstructions } from "./upgradeApi.js";
import { INSTRUCTIONS_REGISTRY_HINT } from "./upgradeCopy.js";

const METHOD_LABEL = { osus: "OpenShift Update Service (recommended)", cli: "CLI without OSUS", web: "Web console" };

function Command({ cmd }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(cmd.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };
  return (
    <div className="upgrade-command">
      <div className="upgrade-command-head"><span>{cmd.label}</span><Button variant="secondary" onClick={copy} aria-label={`Copy: ${cmd.label}`}>{copied ? "Copied" : "Copy"}</Button></div>
      <pre>{cmd.text}</pre>
    </div>
  );
}

function Step({ step }) {
  return (
    <li>
      <strong>{step.title}</strong>
      {step.kind === "template" ? <span className="upgrade-badge" data-state="NOT_CHECKED"> template</span> : null}
      {step.kind === "risk" ? <span className="upgrade-badge" data-state="WARNING">⚠ conditional</span> : null}
      {step.body ? <p>{step.body}</p> : null}
      {step.requires?.length ? <p className="note subtle">Run only after these readiness checks are confirmed: {step.requires.join(", ")}.</p> : null}
      {step.risks?.length ? <ul>{step.risks.map((r) => <li key={r.name}><strong>{r.name}</strong>: {r.message} {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">details</a> : null}</li>)}</ul> : null}
      {(step.commands || []).map((c) => <Command key={c.label + c.text} cmd={c} />)}
      {step.doc ? <p className="subtle">Documentation: <a href={step.doc.url} target="_blank" rel="noopener noreferrer">{step.doc.title}</a>{step.doc.humanVerified ? "" : " (link not yet confirmed by a person)"}</p> : null}
    </li>
  );
}

export default function InstructionsTab({ plan }) {
  const [method, setMethod] = useState(plan.method || "osus");
  const [registry, setRegistry] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!plan.path) return undefined;
    setError("");
    fetchInstructions(plan.id, registry.trim() || undefined).then((r) => { if (!cancelled) setData(r); }).catch((err) => { if (!cancelled) setError(String(err.message || err)); });
    return () => { cancelled = true; };
  }, [plan.id, plan.updatedAt, registry]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plan.path) return <section className="card"><h3>Instructions</h3><p className="subtle">Compute the update route first.</p></section>;
  if (error) return <Banner variant="error">{error}</Banner>;
  if (!data) return <div className="loading" role="status">Loading instructions…</div>;
  const m = data.methods[method];
  return (
    <div className="upgrade-instructions">
      <section className="card" aria-labelledby={`upgrade-ins-${plan.id}`}>
        <h3 id={`upgrade-ins-${plan.id}`}>Update {data.route.join(" → ")}</h3>
        <Banner variant={data.status.state === "ready-to-proceed" ? "info" : "warning"}>{data.status.message} Cluster readiness: {data.status.clusterReadiness}.</Banner>
        <p className="subtle">The cluster&apos;s Cluster Version Operator performs each update; Architect never runs these commands. {data.tieBreakNote}</p>
        <div className="field-grid">
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Mirror registry (for commands)" hint={INSTRUCTIONS_REGISTRY_HINT}>
              <input id={`upgrade-ins-registry-${plan.id}`} type="text" autoComplete="off" value={registry} placeholder="mirror.example.com:8443/ocp" onChange={(e) => setRegistry(e.target.value)} />
            </FieldLabelWithInfo>
            <div className="field-control-support" />
          </div>
        </div>
        <div className="mirroring-tabs" role="tablist" aria-label="Update method">
          {["osus", "cli", "web"].map((k) => (
            <button key={k} type="button" role="tab" id={`upgrade-method-${plan.id}-${k}`} aria-selected={method === k} aria-controls={`upgrade-method-panel-${plan.id}`} tabIndex={method === k ? 0 : -1} className={`mirroring-tab${method === k ? " active" : ""}`} onClick={() => setMethod(k)}
              onKeyDown={(e) => { const keys = ["osus", "cli", "web"]; const i = keys.indexOf(method); if (e.key === "ArrowRight") setMethod(keys[(i + 1) % 3]); if (e.key === "ArrowLeft") setMethod(keys[(i + 2) % 3]); }}>
              {METHOD_LABEL[k]}
            </button>
          ))}
        </div>
      </section>
      <div role="tabpanel" id={`upgrade-method-panel-${plan.id}`} aria-labelledby={`upgrade-method-${plan.id}-${method}`}>
        <section className="card">
          <p>{m.note}</p>
          {m.cpo ? <Banner variant={m.cpo.state === "included" ? "info" : "warning"}>{m.cpo.message}</Banner> : null}
          <h4>Before the first update</h4>
          <ol className="upgrade-steps">{m.setup.map((s) => <Step key={s.title} step={s} />)}{m.before.map((s) => <Step key={s.title} step={s} />)}</ol>
        </section>
        {m.hops.map((hop) => (
          <section className="card" key={`${hop.from}-${hop.to}`} aria-labelledby={`upgrade-ins-hop-${plan.id}-${hop.index}`}>
            <h4 id={`upgrade-ins-hop-${plan.id}-${hop.index}`}>Step {hop.index + 1}: {hop.from} → {hop.to} <span className="subtle">(channel {hop.channel})</span> {hop.conditional ? <span className="upgrade-badge" data-state="WARNING">⚠ conditional</span> : null}</h4>
            <ol className="upgrade-steps">{hop.steps.map((s) => <Step key={s.title} step={s} />)}</ol>
          </section>
        ))}
        {m.after.length ? <section className="card"><h4>After the last update</h4><ol className="upgrade-steps">{m.after.map((s) => <Step key={s.title} step={s} />)}</ol></section> : null}
        <p className="subtle">Never used by these instructions: {data.never.join(", ")}.</p>
      </div>
    </div>
  );
}
