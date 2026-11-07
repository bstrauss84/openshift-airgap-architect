/**
 * OpenShift Airgap Architect - Upgrade › 3 Readiness (v2.3.0 UX correction).
 *
 * Two questions, kept apart:
 *  1. Before mirroring — can Architect prepare and move the content? (route, stages, registry,
 *     the plan's credentials in this tab). Derived here from the plan; each says where to fix it.
 *  2. Before updating the cluster — is it safe to start the updates? (content in the registry,
 *     release signatures, cluster health from imported evidence, administrator statements).
 *
 * States are evidence, never assumed: Verified (evidence) · Your statement (attested, never shown
 * as verified) · Warning · Blocked (evidence of a problem) · To do (work still to do in Architect)
 * · Not checked (no evidence yet — missing optional evidence is not a failure). Every row names
 * its next action: import that evidence, go to the step that does it, or record your statement.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import Modal from "../components/Modal.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import { useSourceCredential, useDestinationCredential } from "../mirroring/sourceCredentialSession.js";
import { JsonDocumentInput } from "./PathTab.jsx";
import { INVENTORY_KIND_HINT } from "./upgradeCopy.js";
import { fetchReadiness, importInventory, clearInventory, attest } from "./upgradeApi.js";

export const STATE_TEXT = { VERIFIED: "✓ Verified", BLOCKED: "✕ Blocked", WARNING: "⚠ Warning", ATTESTED: "✎ Your statement", NOT_CHECKED: "? Not checked", PENDING: "○ To do" };
const KIND_LABEL = { clusterversion: "ClusterVersion", subscription: "Operator subscriptions", csv: "Operator versions (CSV)", mcp: "Machine config pools" };
const STEP_LABEL = { route: "Route", content: "Content", mirror: "Mirror & transfer" };

function CheckRow({ c, onAction, onAttest, attestText, readOnly }) {
  const [open, setOpen] = useState(false);
  const hasDetails = Boolean(c.layers || c.url);
  return (
    <li className="upgrade-check" data-state={c.state}>
      <div className="upgrade-check-head">
        <span className="upgrade-badge" data-state={c.state}>{STATE_TEXT[c.state] || c.state}</span>
        <strong>{c.title}</strong>
        <span className="upgrade-check-actions">
          {c.action?.kind === "import" ? <Button variant="secondary" className="mini" onClick={() => onAction(c.action)} disabled={readOnly}>Import cluster evidence</Button> : null}
          {c.action?.kind === "step" ? <Button variant="secondary" className="mini" onClick={() => onAction(c.action)}>Go to {STEP_LABEL[c.action.step] || c.action.step}</Button> : null}
          {hasDetails ? <Button variant="secondary" className="mini" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Hide details" : "Details"}</Button> : null}
        </span>
      </div>
      <p className="upgrade-check-detail">{c.detail}</p>
      {open && c.layers ? (
        <dl className="modal-summary">
          <dt>Update graph says</dt><dd>{c.layers.graph}</dd>
          <dt>Cluster evidence</dt><dd>{c.layers.clusterEvidence}</dd>
          <dt>Administrator judgment</dt><dd>{c.layers.administratorJudgment}</dd>
        </dl>
      ) : null}
      {open && c.url ? <p><a href={c.url} target="_blank" rel="noopener noreferrer">Risk details</a></p> : null}
      {c.attestable ? (
        <label className="toggle-row upgrade-attest">
          <input type="checkbox" checked={c.state === "ATTESTED"} onChange={(e) => onAttest(c.id, e.target.checked)} disabled={readOnly} />
          <span>{attestText} <em className="subtle">(Your statement — shown as such, never as verified.)</em></span>
        </label>
      ) : null}
    </li>
  );
}

export default function ReadinessTab({ plan, onPlanChanged, credentialKey = null, onGoToStep = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [importKind, setImportKind] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const sourceCred = useSourceCredential(credentialKey, "run");
  const destCred = useDestinationCredential(credentialKey);
  const readOnly = plan.kind === "received";
  const load = useCallback(async () => {
    try { setData(await fetchReadiness(plan.id)); setError(""); } catch (err) { setError(String(err.message || err)); }
  }, [plan.id]);
  useEffect(() => { load(); }, [load, plan.updatedAt]);

  const doImport = async () => {
    setBusy(true);
    setError("");
    try {
      await importInventory(plan.id, importKind, text);
      setText("");
      setImportKind(null);
      onPlanChanged(null);
      await load();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (checkId, on) => {
    try {
      const next = await attest(plan.id, checkId, on);
      setData((d) => ({ ...d, ...next, attestable: next.attestable || d.attestable, inventoryCommands: next.inventoryCommands || d.inventoryCommands }));
      onPlanChanged(null);
    } catch (err) { setError(String(err.message || err)); }
  };
  const onAction = (a) => {
    if (a.kind === "import") setImportKind(a.inventoryKind);
    else if (a.kind === "step" && onGoToStep) onGoToStep(a.step);
  };

  if (!data) return error ? <Banner variant="error">{error}</Banner> : <div className="loading" role="status">Checking readiness…</div>;
  const method = plan.mirror?.method || "mirrorToDisk";
  const local = [
    plan.stages.length && !plan.stagesStale
      ? { id: "x-stages", state: "VERIFIED", title: "Stages", detail: `${plan.stages.length} stage(s) prepared, one per release on the route.` }
      : { id: "x-stages", state: "PENDING", title: "Stages", detail: plan.stagesStale ? "To do: the route changed; prepare the stages again." : "To do: prepare the stages.", action: { kind: "step", step: "content" } },
    plan.mirror?.registryUrl
      ? { id: "x-registry", state: "VERIFIED", title: "Mirror registry", detail: `${plan.mirror.registryUrl} — entered once; used by every stage, the instructions and templates.` }
      : method === "mirrorToDisk"
        ? { id: "x-registry", state: "NOT_CHECKED", title: "Mirror registry", detail: "Not needed to mirror to disk. The update instructions use it, so set it before you hand them over.", action: { kind: "step", step: "mirror" } }
        : { id: "x-registry", state: "PENDING", title: "Mirror registry", detail: "To do: set the mirror registry.", action: { kind: "step", step: "mirror" } },
    method === "diskToMirror" ? null : sourceCred.usable
      ? { id: "x-source", state: "VERIFIED", title: "Red Hat pull secret", detail: "Entered for this plan in this browser tab (never saved)." }
      : { id: "x-source", state: "PENDING", title: "Red Hat pull secret", detail: "To do: enter it once for this plan. It is kept in this tab only and is gone after a reload.", action: { kind: "step", step: "mirror" } },
    method === "mirrorToDisk" ? null : destCred.ready
      ? { id: "x-dest", state: "VERIFIED", title: "Registry credentials", detail: destCred.anonymous ? "Anonymous access, as you chose." : "Entered for this plan in this browser tab (never saved)." }
      : { id: "x-dest", state: "PENDING", title: "Registry credentials", detail: "To do: enter them once for this plan, or choose anonymous access.", action: { kind: "step", step: "mirror" } }
  ].filter(Boolean);
  const routeChecks = data.checks.filter((c) => c.group === "route");
  const clusterChecks = data.checks.filter((c) => c.group !== "route");
  const todo = local.filter((c) => c.state === "PENDING").length + routeChecks.filter((c) => c.state === "BLOCKED" || c.state === "PENDING").length;
  const s = data.summary;
  return (
    <div className="upgrade-readiness">
      {error ? <Banner variant="error">{error}</Banner> : null}
      <section className="card" aria-labelledby={`upgrade-ready-mirror-${plan.id}`}>
        <h3 id={`upgrade-ready-mirror-${plan.id}`}>Before mirroring</h3>
        <p className="subtle" role="status">{todo ? `${todo} thing(s) to do before the stages can be mirrored.` : "Ready to mirror. Each job still runs its own preflight (storage, tools, registry trust) right before it starts."}</p>
        <ul className="upgrade-check-list">
          {[...local, ...routeChecks].map((c) => <CheckRow key={c.id} c={c} onAction={onAction} onAttest={toggle} attestText={data.attestable?.[c.id]} readOnly={readOnly} />)}
        </ul>
      </section>
      <section className="card" aria-labelledby={`upgrade-ready-cluster-${plan.id}`}>
        <h3 id={`upgrade-ready-cluster-${plan.id}`}>Before updating the cluster</h3>
        <p className="subtle" role="status">
          {[s.blocked ? `${s.blocked} blocked` : null, s.pending ? `${s.pending} to do in Architect` : null, s.warnings ? `${s.warnings} warning(s)` : null, s.notChecked ? `${s.notChecked} not checked (no evidence yet)` : null, s.attested ? `${s.attested} your statement(s)` : null].filter(Boolean).join(" · ") || "Every check is verified or attested."}
          {" "}Cluster readiness: {s.clusterReadiness}.
        </p>
        {data.cpo ? <Banner variant={data.cpo.eligible ? "info" : "warning"}>{data.cpo.eligible ? "Control Plane Only prerequisites are verified or attested." : `Control Plane Only steps stay withheld until these are verified or attested: ${data.cpo.missing.join(", ")}.`}</Banner> : null}
        <div className="actions">
          <Button variant="secondary" onClick={() => setImportKind("clusterversion")} disabled={readOnly}>Import cluster evidence…</Button>
          {plan.inventory ? <Button variant="secondary" onClick={async () => { await clearInventory(plan.id); onPlanChanged(null); load(); }}>Remove imported evidence</Button> : null}
        </div>
        {plan.inventory ? <p className="subtle">Imported {plan.inventory.importedAt}: {plan.inventory.clusterVersion ? `ClusterVersion ${plan.inventory.clusterVersion.version || "?"}` : "no ClusterVersion"}, {plan.inventory.operators?.length || 0} operator(s), {plan.inventory.machineConfigPools?.length || 0} pool(s).</p> : null}
        <ul className="upgrade-check-list">
          {clusterChecks.map((c) => <CheckRow key={c.id} c={c} onAction={onAction} onAttest={toggle} attestText={data.attestable?.[c.id]} readOnly={readOnly} />)}
        </ul>
      </section>

      <Modal isOpen={Boolean(importKind)} onClose={() => setImportKind(null)} ariaLabelledBy={`upgrade-inv-${plan.id}`}>
        <h3 id={`upgrade-inv-${plan.id}`}>Import cluster evidence</h3>
        <p className="modal-copy subtle">Architect never connects to a cluster. Run this read-only command where the cluster is reachable and paste or upload its output. Only names, versions, channels, phases and conditions are kept; the cluster ID, annotations and anything credential-like are discarded. Kubeconfigs and Secrets are refused.</p>
        <div className="field-grid upgrade-fields">
          <div className="field-control-stack">
            <FieldLabelWithInfo label="What you are importing" hint={INVENTORY_KIND_HINT}>
              <select id={`upgrade-inv-kind-${plan.id}`} className="control-enum" value={importKind || "clusterversion"} onChange={(e) => setImportKind(e.target.value)}>
                {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </FieldLabelWithInfo>
            <div className="field-control-support" />
          </div>
        </div>
        {importKind ? <div className="upgrade-command"><pre>{data.inventoryCommands[importKind]}</pre></div> : null}
        <JsonDocumentInput id={`upgrade-inv-text-${plan.id}`} label="Command output (JSON)" value={text} onChange={setText} />
        <div className="actions">
          <Button variant="secondary" onClick={() => setImportKind(null)}>Cancel</Button>
          <Button variant="primary" disabled={!text.trim() || busy || readOnly} onClick={doImport}>{busy ? "Importing…" : "Import"}</Button>
        </div>
      </Modal>
    </div>
  );
}
