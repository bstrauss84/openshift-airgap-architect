/**
 * OpenShift Airgap Architect - Upgrade › Readiness (v2.3.0, RFC §8.7).
 *
 * Every check is VERIFIED, BLOCKED, WARNING, ATTESTED or NOT CHECKED, always
 * with words and an icon. Only evidence (an imported read-only cluster export,
 * a verified registry check, the graph) verifies anything; an attestation is
 * the administrator's statement and is labelled as such. Without cluster
 * evidence, cluster readiness is "not verified".
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import { JsonDocumentInput } from "./PathTab.jsx";
import { INVENTORY_KIND_HINT } from "./upgradeCopy.js";
import { fetchReadiness, importInventory, clearInventory, attest } from "./upgradeApi.js";

export const STATE_TEXT = { VERIFIED: "✓ Verified", BLOCKED: "✕ Blocked", WARNING: "⚠ Warning", ATTESTED: "✎ Attested", NOT_CHECKED: "? Not checked" };

export default function ReadinessTab({ plan, onPlanChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("clusterversion");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await fetchReadiness(plan.id)); setError(""); } catch (err) { setError(String(err.message || err)); }
  }, [plan.id]);
  useEffect(() => { load(); }, [load, plan.updatedAt]);

  const doImport = async () => {
    setBusy(true);
    setError("");
    try {
      await importInventory(plan.id, kind, text);
      setText("");
      onPlanChanged(null);
      await load();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (checkId, on) => {
    try { setData({ ...(await attest(plan.id, checkId, on)), attestable: data.attestable, inventoryCommands: data.inventoryCommands }); onPlanChanged(null); } catch (err) { setError(String(err.message || err)); }
  };

  if (!data) return error ? <Banner variant="error">{error}</Banner> : <div className="loading" role="status">Checking readiness…</div>;
  const s = data.summary;
  return (
    <div className="upgrade-readiness">
      {error ? <Banner variant="error">{error}</Banner> : null}
      <section className="card" aria-labelledby={`upgrade-ready-${plan.id}`}>
        <h3 id={`upgrade-ready-${plan.id}`}>Readiness</h3>
        <p role="status">
          <strong>{s.state === "ready-to-proceed" ? "Every check is verified or attested." : s.state === "blocked" ? `${s.blocked} check(s) block the update.` : `${s.notChecked} check(s) are not checked yet.`}</strong>{" "}
          {s.warnings ? `${s.warnings} warning(s). ` : ""}{s.attested ? `${s.attested} attested by you. ` : ""}Cluster readiness: {s.clusterReadiness}.
        </p>
        {data.cpo ? <Banner variant={data.cpo.eligible ? "info" : "warning"}>{data.cpo.eligible ? "Control Plane Only prerequisites are verified or attested." : `Control Plane Only steps stay withheld until these are verified or attested: ${data.cpo.missing.join(", ")}.`}</Banner> : null}
        <ul className="upgrade-check-list">
          {data.checks.map((c) => (
            <li key={c.id} className="upgrade-check">
              <div className="upgrade-check-head">
                <span className="upgrade-badge" data-state={c.state}>{STATE_TEXT[c.state]}</span>
                <strong>{c.title}</strong>
              </div>
              <p>{c.detail}</p>
              {c.layers ? (
                <dl className="modal-summary">
                  <dt>Update graph says</dt><dd>{c.layers.graph}</dd>
                  <dt>Cluster evidence</dt><dd>{c.layers.clusterEvidence}</dd>
                  <dt>Administrator judgment</dt><dd>{c.layers.administratorJudgment}</dd>
                </dl>
              ) : null}
              {c.url ? <p><a href={c.url} target="_blank" rel="noopener noreferrer">Risk details</a></p> : null}
              {c.attestable ? (
                <label className="switch-row">
                  <input type="checkbox" checked={c.state === "ATTESTED"} onChange={(e) => toggle(c.id, e.target.checked)} disabled={plan.kind === "received"} />
                  <span>{data.attestable[c.id]} <em>(Your statement; shown as attested, never as verified.)</em></span>
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="card" aria-labelledby={`upgrade-inv-${plan.id}`}>
        <h3 id={`upgrade-inv-${plan.id}`}>Import cluster evidence (optional, read-only)</h3>
        <p className="subtle">Architect never connects to a cluster. Run a read-only command where the cluster is reachable and paste the output. Only names, versions, channels, phases and conditions are kept; the cluster ID, annotations and anything credential-like are discarded. Kubeconfigs and Secrets are refused.</p>
        <div className="field-grid">
          <div className="field-control-stack">
            <FieldLabelWithInfo label="What you are importing" hint={INVENTORY_KIND_HINT}>
              <select id={`upgrade-inv-kind-${plan.id}`} className="control-enum" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="clusterversion">ClusterVersion</option>
                <option value="subscription">Operator subscriptions</option>
                <option value="csv">Operator versions (CSV)</option>
                <option value="mcp">Machine config pools</option>
              </select>
            </FieldLabelWithInfo>
            <div className="field-control-support"><code>{data.inventoryCommands[kind]}</code></div>
          </div>
        </div>
        <JsonDocumentInput id={`upgrade-inv-text-${plan.id}`} label="Command output (JSON)" value={text} onChange={setText} />
        <div className="actions">
          <Button variant="primary" disabled={!text.trim() || busy || plan.kind === "received"} onClick={doImport}>{busy ? "Importing…" : "Import"}</Button>
          {plan.inventory ? <Button variant="secondary" onClick={async () => { await clearInventory(plan.id); onPlanChanged(null); load(); }}>Remove imported evidence</Button> : null}
        </div>
        {plan.inventory ? <p className="subtle">Imported {plan.inventory.importedAt}: {plan.inventory.clusterVersion ? `ClusterVersion ${plan.inventory.clusterVersion.version || "?"}` : "no ClusterVersion"}, {plan.inventory.operators?.length || 0} operator(s), {plan.inventory.machineConfigPools?.length || 0} pool(s).</p> : null}
      </section>
    </div>
  );
}
