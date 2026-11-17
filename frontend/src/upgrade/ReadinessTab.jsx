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
import FileDropZone from "../components/FileDropZone.jsx";
import { guideFor } from "./readinessGuide.js";
import { fetchReadiness, importInventory, importBundle, clearInventory, attest, collectorScriptUrl } from "./upgradeApi.js";

export const STATE_TEXT = { VERIFIED: "✓ Verified", BLOCKED: "✕ Blocked", WARNING: "⚠ Warning", ATTESTED: "✎ Your statement", NOT_CHECKED: "? Not checked", PENDING: "○ To do" };
const KIND_LABEL = { clusterversion: "ClusterVersion", subscription: "Operator subscriptions", csv: "Operator versions (CSV)", mcp: "Machine config pools" };
const STEP_LABEL = { route: "Route", content: "Content", mirror: "Mirror & transfer" };
const SECTION_LABEL = { clusterversion: "ClusterVersion", clusteroperators: "Cluster operators", mcp: "Machine config pools", subscriptions: "Operator subscriptions", csv: "Operator versions", apirequestcounts: "API usage", admingates: "Acknowledgement gates", adminacks: "Acknowledgements given" };
const SECTION_TEXT = { imported: "✓", unavailable: "not readable", missing: "missing", invalid: "invalid" };
/** What the collector runs — all read-only `oc get` (shown before anyone downloads it). */
const COLLECTOR_READS = [
  "oc get clusterversion version", "oc get clusteroperators", "oc get machineconfigpools",
  "oc get subscriptions.operators.coreos.com -A", "oc get clusterserviceversions.operators.coreos.com -A",
  "oc get apirequestcounts.apiserver.openshift.io",
  "oc get configmap admin-gates -n openshift-config-managed", "oc get configmap admin-acks -n openshift-config"
];

function CheckGuide({ g }) {
  return (
    <dl className="upgrade-guide">
      <dt>What it is</dt><dd>{g.what}</dd>
      <dt>Why it matters</dt><dd>{g.why}</dd>
      <dt>How to check</dt>
      <dd>
        {g.bundle ? <p>Included in the readiness bundle: run the collector and upload its file (top of this section). Or check by hand:</p> : <p>Architect cannot check this. Do it yourself, then record your statement below:</p>}
        {g.commands.map((c) => (
          <div key={c.cmd} className="upgrade-command"><pre>{c.cmd}</pre>{c.note ? <span className="subtle">{c.note}</span> : null}</div>
        ))}
        {g.note ? <p className="subtle">{g.note}</p> : null}
      </dd>
      <dt>Success looks like</dt><dd>{g.success}</dd>
      <dt>If it fails</dt><dd>{g.failure}</dd>
      {g.caution ? <><dt>Important</dt><dd>{g.caution}</dd></> : null}
      {g.docs.length ? (
        <>
          <dt>Red Hat documentation</dt>
          <dd><ul>{g.docs.map((d) => <li key={d.label}><a href={d.url} target="_blank" rel="noopener noreferrer">{d.label}</a></li>)}</ul></dd>
        </>
      ) : null}
    </dl>
  );
}

function CheckRow({ c, onAction, onAttest, attestText, readOnly, plan }) {
  const [open, setOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const hasDetails = Boolean(c.layers || c.url);
  const guide = plan ? guideFor(c.id, plan) : null;
  return (
    <li className="upgrade-check" data-state={c.state}>
      <div className="upgrade-check-head">
        <span className="upgrade-badge" data-state={c.state}>{STATE_TEXT[c.state] || c.state}</span>
        <strong>{c.title}</strong>
        <span className="upgrade-check-actions">
          {c.action?.kind === "import" ? <Button variant="secondary" className="mini" onClick={() => onAction(c.action)} disabled={readOnly}>{c.action.inventoryKind === "bundle" || guide?.bundle ? "Upload the readiness bundle" : "Import cluster evidence"}</Button> : null}
          {c.action?.kind === "step" ? <Button variant="secondary" className="mini" onClick={() => onAction(c.action)}>Go to {STEP_LABEL[c.action.step] || c.action.step}</Button> : null}
          {hasDetails ? <Button variant="secondary" className="mini" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Hide details" : "Details"}</Button> : null}
          {guide ? <Button variant="secondary" className="mini" aria-expanded={guideOpen} onClick={() => setGuideOpen((v) => !v)} aria-label={`${guideOpen ? "Hide" : "How to check"}: ${c.title}`}>{guideOpen ? "Hide guide" : "How to check"}</Button> : null}
        </span>
      </div>
      <p className="upgrade-check-detail">{c.detail}</p>
      {guideOpen && guide ? <CheckGuide g={guide} /> : null}
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
  const [bundleResult, setBundleResult] = useState(null);
  const bundleRef = React.useRef(null);
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
  const uploadBundle = async (files) => {
    const file = files[0];
    if (!file) return;
    setBusy(true);
    setError("");
    setBundleResult(null);
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("The file is larger than 20 MiB. Upload the file the collector script wrote.");
      const text = typeof file.text === "function" ? await file.text() : await new Promise((ok, fail) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = () => fail(fr.error); fr.readAsText(file); });
      const r = await importBundle(plan.id, text);
      setBundleResult({ fileName: file.name, sections: r.sections, collectedAt: r.inventory?.collectedAt });
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
    // Every cluster check is covered by the one bundle; individual imports stay under Advanced.
    if (a.kind === "import") {
      bundleRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      bundleRef.current?.querySelector("button")?.focus();
    }
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
          {[...local, ...routeChecks].map((c) => <CheckRow key={c.id} c={c} plan={plan} onAction={onAction} onAttest={toggle} attestText={data.attestable?.[c.id]} readOnly={readOnly} />)}
        </ul>
      </section>
      <section className="card" aria-labelledby={`upgrade-ready-cluster-${plan.id}`}>
        <h3 id={`upgrade-ready-cluster-${plan.id}`}>Before updating the cluster</h3>
        <p className="subtle" role="status">
          {[s.blocked ? `${s.blocked} blocked` : null, s.pending ? `${s.pending} to do in Architect` : null, s.warnings ? `${s.warnings} warning(s)` : null, s.notChecked ? `${s.notChecked} not checked (no evidence yet)` : null, s.attested ? `${s.attested} your statement(s)` : null].filter(Boolean).join(" · ") || "Every check is verified or attested."}
          {" "}Cluster readiness: {s.clusterReadiness}.
        </p>
        {data.cpo ? <Banner variant={data.cpo.eligible ? "info" : "warning"}>{data.cpo.eligible ? "Control Plane Only prerequisites are verified or attested." : `Control Plane Only steps stay withheld until these are verified or attested: ${data.cpo.missing.join(", ")}.`}</Banner> : null}
        <div className="upgrade-bundle" ref={bundleRef} aria-labelledby={`upgrade-bundle-${plan.id}`} role="group">
          <h4 id={`upgrade-bundle-${plan.id}`}>Check my cluster&apos;s readiness</h4>
          <p className="subtle">Architect never connects to your cluster. Instead, one read-only script collects what these checks need, and you upload the single file it writes.</p>
          <ol className="upgrade-bundle-steps">
            <li>
              <strong>Download the collector</strong>
              <p><Button variant="secondary" onClick={() => { const a = document.createElement("a"); a.href = collectorScriptUrl(); a.download = "oaa-readiness-collector.sh"; document.body.appendChild(a); a.click(); a.remove(); }}>Download oaa-readiness-collector.sh</Button></p>
              <details>
                <summary>What it reads, and what it never does</summary>
                <p className="subtle">Only these read-only commands, keeping names, versions, channels, phases, conditions and counts:</p>
                <ul>{COLLECTOR_READS.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
                <p className="subtle">It never changes the cluster, never reads Secrets, pull secrets, tokens or your kubeconfig, never records your user name, the cluster ID or server URLs, masks credential-like text in condition messages, and sends nothing anywhere. It is plain bash — read it before you run it.</p>
              </details>
            </li>
            <li>
              <strong>Run it where <code>oc</code> is logged in to the cluster</strong>
              <div className="upgrade-command"><pre>bash oaa-readiness-collector.sh</pre></div>
              <p className="subtle">Needs <code>oc</code> (the cluster-reader role is enough) and <code>jq</code>. It writes <code>oaa-readiness-&lt;time&gt;.json</code>, readable only by you. Run it again right before each update.</p>
            </li>
            <li>
              <strong>Upload the file</strong>
              <FileDropZone id={`upgrade-bundle-file-${plan.id}`} label="Readiness bundle (.json)" accept=".json,application/json" disabled={readOnly || busy} onFiles={uploadBundle}
                help="Uploading replaces any evidence imported before, so every check reads one collection with one time. Nothing that is not used by a check is kept." />
            </li>
          </ol>
          {busy ? <div className="loading" role="status">Reading the bundle…</div> : null}
          {plan.inventory ? (
            <div role="status">
              <p className="subtle">
                {plan.inventory.source === "bundle"
                  ? <>Evidence collected <strong>{plan.inventory.collectedAt}</strong>{bundleResult?.fileName ? ` (${bundleResult.fileName})` : ""}, uploaded {plan.inventory.importedAt}.</>
                  : <>Imported {plan.inventory.importedAt} from individual exports: {plan.inventory.clusterVersion ? `ClusterVersion ${plan.inventory.clusterVersion.version || "?"}` : "no ClusterVersion"}, {plan.inventory.operators?.length || 0} operator(s), {plan.inventory.machineConfigPools?.length || 0} pool(s).</>}
              </p>
              {plan.inventory.sections ? (
                <ul className="upgrade-bundle-sections" aria-label="What the bundle contained">
                  {Object.entries(plan.inventory.sections).map(([k, v]) => (
                    <li key={k}><span className="upgrade-badge" data-state={v.state === "imported" ? "VERIFIED" : "NOT_CHECKED"}>{SECTION_LABEL[k] || k}: {SECTION_TEXT[v.state] || v.state}{v.reason && v.state !== "imported" ? ` (${v.reason})` : ""}</span></li>
                  ))}
                </ul>
              ) : null}
              {plan.inventory.sections && Object.values(plan.inventory.sections).some((v) => v.state !== "imported") ? <p className="subtle">Checks that need a section the collector could not read stay “Not checked”. A “forbidden” section usually means the logged-in user lacks read access to it.</p> : null}
              <div className="actions"><Button variant="secondary" onClick={async () => { await clearInventory(plan.id); setBundleResult(null); onPlanChanged(null); load(); }}>Remove the uploaded evidence</Button></div>
            </div>
          ) : null}
          <details className="upgrade-advanced">
            <summary>Advanced: import one command&apos;s output instead</summary>
            <p className="subtle">For when the script cannot run. Paste or upload the JSON output of one read-only command at a time (ClusterVersion, subscriptions, operator versions, machine config pools). Exports imported this way are combined with each other, but not with an uploaded bundle.</p>
            <Button variant="secondary" onClick={() => setImportKind("clusterversion")} disabled={readOnly}>Import one command&apos;s output…</Button>
          </details>
        </div>
        <ul className="upgrade-check-list">
          {clusterChecks.map((c) => <CheckRow key={c.id} c={c} plan={plan} onAction={onAction} onAttest={toggle} attestText={data.attestable?.[c.id]} readOnly={readOnly} />)}
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
