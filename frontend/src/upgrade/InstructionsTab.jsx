/**
 * OpenShift Airgap Architect - Upgrade › 5 Update the cluster (v2.3.0 UX correction).
 *
 * Version-specific instructions for an ADMINISTRATOR to run — Architect never connects to,
 * changes or updates the cluster. OpenShift Update Service (recommended), CLI without OSUS, or
 * the web console, grouped by update, each citing the documentation of the minor it updates into.
 * The registry comes from the plan (entered once on Mirror & transfer); nothing is asked again.
 * Conditional updates get no executable update command.
 *
 * Three different things are never shown as one another, per update:
 *  - content verified: the stage's release is in the registry (evidence from runs/checks);
 *  - your statement: "I have completed this update" (recorded as yours, never inferred);
 *  - cluster state: only what an imported ClusterVersion shows.
 * The instructions can be downloaded at any time — before any update is done.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useEffect, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import { fetchInstructions, setClusterProgress } from "./upgradeApi.js";
import { contentStateText } from "./stageStatus.jsx";
import { downloadText } from "./ContentTab.jsx";

const METHOD_LABEL = { osus: "OpenShift Update Service (recommended)", cli: "CLI without OSUS", web: "Web console" };
const METHOD_KEYS = ["osus", "cli", "web"];

function Command({ cmd }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(cmd.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };
  return (
    <div className="upgrade-command">
      <div className="upgrade-command-head"><span>{cmd.label}</span><Button variant="secondary" className="mini" onClick={copy} aria-label={`Copy: ${cmd.label}`}>{copied ? "Copied" : "Copy"}</Button></div>
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

/** Plain-text (Markdown) rendering of the chosen method, for download. */
export const instructionsMarkdown = (data, method, onlyHop = null) => {
  const m = data.methods[method];
  const lines = [`# Update ${data.route.join(" → ")} — ${METHOD_LABEL[method]}`, "", "Instructions for an administrator to run. Architect never connects to, changes or updates the cluster.", "", data.status.message, ""];
  const step = (s) => {
    lines.push(`- **${s.title}**${s.kind === "template" ? " (template)" : ""}`);
    if (s.body) lines.push(`  ${s.body}`);
    if (s.requires?.length) lines.push(`  Run only after: ${s.requires.join(", ")}.`);
    for (const c of s.commands || []) lines.push("", `  ${c.label}:`, "", "  ```", ...c.text.split("\n").map((l) => `  ${l}`), "  ```");
    if (s.doc) lines.push(`  Documentation: ${s.doc.url}`);
  };
  if (onlyHop === null) {
    lines.push("## Before the first update", "");
    [...m.setup, ...m.before].forEach(step);
  }
  for (const hop of m.hops) {
    if (onlyHop !== null && hop.index !== onlyHop) continue;
    lines.push("", `## Update ${hop.index + 1}: ${hop.from} → ${hop.to} (channel ${hop.channel})`, "");
    hop.steps.forEach(step);
  }
  if (onlyHop === null && m.after.length) { lines.push("", "## After the last update", ""); m.after.forEach(step); }
  lines.push("", `Never used: ${data.never.join(", ")}.`);
  return lines.join("\n");
};

export default function InstructionsTab({ plan, onPlanChanged = () => {}, onGoToStep = null }) {
  const [method, setMethod] = useState(plan.method || "osus");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!plan.path) return undefined;
    setError("");
    fetchInstructions(plan.id).then((r) => { if (!cancelled) setData(r); }).catch((err) => { if (!cancelled) setError(String(err.message || err)); });
    return () => { cancelled = true; };
  }, [plan.id, plan.updatedAt, plan.mirror?.registryUrl]);

  const note = (
    <div className="note upgrade-admin-note" role="note">
      <strong>These are instructions for an administrator to run.</strong> Architect never connects to, changes or updates your cluster. You can download them now, before any update.
    </div>
  );
  if (!plan.path) return <section className="card"><h3>Update the cluster</h3>{note}<p className="subtle">Compute the update route first.</p></section>;
  if (error) return <Banner variant="error">{error}</Banner>;
  if (!data) return <div className="loading" role="status">Loading instructions…</div>;
  const m = data.methods[method];
  const stageFor = (release) => (plan.stageViews || []).find((s) => s.release === release) || null;
  const clusterVersion = plan.inventory?.clusterVersion?.version || null;
  const registry = plan.mirror?.registryUrl || null;
  const fileBase = `upgrade-${data.route[0]}-to-${data.route[data.route.length - 1]}-${method}`;
  return (
    <div className="upgrade-instructions">
      <section className="card" aria-labelledby={`upgrade-ins-${plan.id}`}>
        <h3 id={`upgrade-ins-${plan.id}`}>Update {data.route.join(" → ")}</h3>
        {note}
        <Banner variant={data.status.state === "ready-to-proceed" ? "info" : "warning"}>{data.status.message}</Banner>
        <p className="subtle">
          Mirror registry in these commands: {registry ? <code>{registry}</code> : <em>not set — commands show a placeholder</em>}
          {onGoToStep ? <> <Button variant="secondary" className="mini" onClick={() => onGoToStep("mirror")}>{registry ? "Change" : "Set it"}</Button></> : null}
        </p>
        <div className="mirroring-tabs upgrade-method-tabs" role="tablist" aria-label="Update method">
          {METHOD_KEYS.map((k) => (
            <button key={k} type="button" role="tab" id={`upgrade-method-${plan.id}-${k}`} aria-selected={method === k} aria-controls={`upgrade-method-panel-${plan.id}`} tabIndex={method === k ? 0 : -1} className={`mirroring-tab${method === k ? " active" : ""}`} onClick={() => setMethod(k)}
              onKeyDown={(e) => { const i = METHOD_KEYS.indexOf(method); if (e.key === "ArrowRight") setMethod(METHOD_KEYS[(i + 1) % 3]); if (e.key === "ArrowLeft") setMethod(METHOD_KEYS[(i + 2) % 3]); }}>
              {METHOD_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="actions">
          <Button variant="secondary" onClick={() => downloadText(`${fileBase}.md`, instructionsMarkdown(data, method), "text/markdown")}>Download these instructions</Button>
        </div>
      </section>
      <div role="tabpanel" id={`upgrade-method-panel-${plan.id}`} aria-labelledby={`upgrade-method-${plan.id}-${method}`}>
        <section className="card">
          <h4>Before the first update{method === "osus" ? " (including one-time OpenShift Update Service setup)" : ""}</h4>
          <p className="subtle">{m.note}</p>
          {m.cpo ? <Banner variant={m.cpo.state === "included" ? "info" : "warning"}>{m.cpo.message}</Banner> : null}
          <ol className="upgrade-steps">{m.setup.map((s) => <Step key={s.title} step={s} />)}{m.before.map((s) => <Step key={s.title} step={s} />)}</ol>
        </section>
        {m.hops.map((hop) => {
          const stage = stageFor(hop.to);
          const [cstate, ctext] = contentStateText(stage?.content?.state);
          return (
            <section className="card upgrade-update" key={`${hop.from}-${hop.to}`} aria-labelledby={`upgrade-ins-hop-${plan.id}-${hop.index}`}>
              <h4 id={`upgrade-ins-hop-${plan.id}-${hop.index}`}>Update {hop.index + 1} · {hop.from} → {hop.to} <span className="subtle">(channel {hop.channel})</span> {hop.conditional ? <span className="upgrade-badge" data-state="WARNING">⚠ conditional</span> : null}</h4>
              <dl className="upgrade-update-states">
                <dt>Content for {hop.to}</dt>
                <dd><span className="upgrade-badge" data-state={cstate}>{stage ? ctext : "no stage"}</span></dd>
                <dt>Cluster evidence</dt>
                <dd>{clusterVersion ? `Imported ClusterVersion shows ${clusterVersion}.` : "None imported."}</dd>
              </dl>
              <ol className="upgrade-steps">{hop.steps.map((s) => <Step key={s.title} step={s} />)}</ol>
              <div className="actions">
                <Button variant="secondary" className="mini" onClick={() => downloadText(`${fileBase}-update-${hop.index + 1}.md`, instructionsMarkdown(data, method, hop.index), "text/markdown")}>Download this update&apos;s steps</Button>
              </div>
              {stage && plan.kind !== "received" ? (
                <label className="toggle-row upgrade-attest">
                  <input type="checkbox" checked={stage.clusterUpdated === "attested"} onChange={async (e) => onPlanChanged(await setClusterProgress(plan.id, stage.id, e.target.checked ? "attested" : "none"))} />
                  <span>I have completed this update to {hop.to}. <em className="subtle">(Your statement — Architect never infers it from mirroring and never checks the cluster.)</em></span>
                </label>
              ) : null}
            </section>
          );
        })}
        {m.after.length ? <section className="card"><h4>After the last update</h4><ol className="upgrade-steps">{m.after.map((s) => <Step key={s.title} step={s} />)}</ol></section> : null}
        <p className="subtle">Never used by these instructions: {data.never.join(", ")}.</p>
      </div>
    </div>
  );
}
