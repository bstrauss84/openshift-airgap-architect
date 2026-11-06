/**
 * OpenShift Airgap Architect - Upgrade › Path (v2.3.0, RFC §5.3, §6).
 *
 * Dependent selection: architecture and channel policy → current channel
 * (its graph loaded) → current release → reachable targets → route. Each
 * disabled field says why. Recommended targets are offered by default;
 * targets reachable only through conditional updates appear only inside the
 * deliberate conditional review. The route shows where its graph came from
 * and how old it is; an old or imported graph is "as of", never current.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import CollapsibleSection from "../components/CollapsibleSection.jsx";
import Switch from "../components/Switch.jsx";
import UpgradeTimeline, { HopDetail } from "./UpgradeTimeline.jsx";
import UpgradeGraphView from "./UpgradeGraphView.jsx";
import { ARCH_HINT, POLICY_HINT, SOURCE_HINT, CURRENT_CHANNEL_HINT, CURRENT_RELEASE_HINT, TARGET_HINT, CHANNEL_STRATEGY_HINT, IMPORT_CHANNEL_HINT, IMPORT_ORIGIN_HINT, JSON_INPUT_HINT } from "./upgradeCopy.js";
import { fetchGraph, refreshGraph, importGraph, fetchTargets, updatePlan, solvePlan } from "./upgradeApi.js";

const ARCHES = [["amd64", "x86_64"], ["arm64", "aarch64 (arm64)"], ["s390x", "s390x"], ["ppc64le", "ppc64le"], ["multi", "multi (heterogeneous)"]];
const ago = (iso) => {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown time";
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export function Freshness({ graph, label = "Graph" }) {
  if (!graph) return null;
  const origin = graph.origin === "public-api" ? "fetched by Architect from api.openshift.com" : graph.origin === "customer-osus" ? "imported by you from your OpenShift Update Service (not fetched by Architect)" : "imported snapshot (not fetched by Architect)";
  return (
    <p className="upgrade-freshness" data-stale={graph.stale ? "true" : "false"} role="note">
      <strong>{label}:</strong> {graph.channel} · {graph.arch} · {origin} · {graph.source === "public" ? "fetched" : graph.capturedAtKnown ? "captured" : "imported"} {new Date(graph.fetchedAt).toISOString().replace(".000Z", "Z")} ({ago(graph.fetchedAt)})
      {graph.stale ? " — recommendations are “as of” this time; confirm before each update." : ""}
      <br /><span className="subtle">SHA-256 {graph.bodySha256.slice(0, 16)}… — integrity of this copy only; the graph is not signed, so its authenticity is not verified.</span>
    </p>
  );
}

export default function PathTab({ plan, supportedMinors, highSide, onPlanChanged }) {
  const [graphs, setGraphs] = useState({});
  const [targets, setTargets] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [selectedHop, setSelectedHop] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importOrigin, setImportOrigin] = useState("customer-osus");
  const [importChannel, setImportChannel] = useState("");
  const readOnly = plan.kind === "received";

  const prefix = plan.channelPolicy || "stable";
  const channelMinors = prefix === "eus" ? supportedMinors.filter((m) => Number(m.split(".")[1]) % 2 === 0) : supportedMinors;
  const channels = channelMinors.map((m) => `${prefix}-${m}`);
  const newest = `${prefix}-${channelMinors[channelMinors.length - 1]}`;
  const source = plan.graphSource;
  const key = (ch) => `${source}:${ch}:${plan.arch}`;

  const loadCached = useCallback(async (ch) => {
    if (!ch) return null;
    try {
      const r = await fetchGraph(ch, plan.arch, source);
      setGraphs((g) => ({ ...g, [key(ch)]: r }));
      return r;
    } catch {
      setGraphs((g) => ({ ...g, [key(ch)]: null }));
      return null;
    }
  }, [plan.arch, source]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (plan.currentChannel) loadCached(plan.currentChannel); }, [plan.currentChannel, loadCached]);
  useEffect(() => { loadCached(newest); }, [newest, loadCached]);
  useEffect(() => { if (plan.planningChannel) loadCached(plan.planningChannel); }, [plan.planningChannel, loadCached]);

  const currentGraph = plan.currentChannel ? graphs[key(plan.currentChannel)] : null;
  const targetGraph = graphs[key(newest)];

  useEffect(() => {
    let cancelled = false;
    setTargets(null);
    if (!plan.current || !targetGraph) return undefined;
    fetchTargets(plan.id, newest).then((r) => { if (!cancelled) setTargets(r.targets); }).catch(() => { if (!cancelled) setTargets([]); });
    return () => { cancelled = true; };
  }, [plan.id, plan.current, newest, targetGraph]);

  const save = async (patch) => {
    setError("");
    try {
      const next = await updatePlan(plan.id, patch);
      setResult(null);
      onPlanChanged(next);
    } catch (err) {
      setError(err.payload?.code === "UNSUPPORTED_VERSION" ? `${err.message} Choose a release in ${supportedMinors.join(", ")}.` : String(err.message || err));
    }
  };

  const refresh = async (ch) => {
    setBusy(`refresh:${ch}`);
    setError("");
    try {
      await refreshGraph(ch, plan.arch);
      await loadCached(ch);
    } catch (err) {
      setError(`${err.message}${err.payload?.code === "GRAPH_UNREACHABLE" || err.payload?.code === "GRAPH_OFFLINE_SIDE" ? " Use “Import graph” instead." : ""}`);
    } finally {
      setBusy("");
    }
  };

  const doImport = async () => {
    setBusy("import");
    setError("");
    try {
      await importGraph({ channel: importChannel || plan.currentChannel || newest, arch: plan.arch, origin: importOrigin, text: importText });
      if (plan.graphSource !== "imported") await save({ graphSource: "imported" });
      await loadCached(importChannel || plan.currentChannel || newest);
      setImportOpen(false);
      setImportText("");
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy("");
    }
  };

  const solve = async (route) => {
    setBusy("solve");
    setError("");
    try {
      const r = await solvePlan(plan.id, route);
      setResult(r);
      setSelectedHop(null);
      onPlanChanged(r.plan);
    } catch (err) {
      const conditionalHint = err.payload?.conditionalAvailable ? " A route exists only through conditional updates; open “Review conditional updates” to see it." : "";
      setError(`${err.message}${conditionalHint}`);
    } finally {
      setBusy("");
    }
  };

  const currentVersions = currentGraph?.normalized?.versions || [];
  const recommendedTargets = (targets || []).filter((t) => t.status === "recommended");
  const conditionalTargets = (targets || []).filter((t) => t.status === "conditional-only");
  const unreachable = (targets || []).filter((t) => t.status === "unreachable");
  const cpoEligible = prefix === "eus" && plan.current?.startsWith("4.20.") && plan.target?.startsWith("4.22.");
  const conditionalRisks = useMemo(() => [...new Map((plan.path?.hops || []).flatMap((h) => h.risks || []).map((r) => [r.name, r])).values()], [plan.path]);
  const acked = new Set((plan.conditionalReview?.acknowledgedRisks || []).map((a) => a.name));
  const OSUS_CURL = `curl -sS --fail -H 'Accept: application/json' "https://<your-osus-route>/api/upgrades_info/v1/graph?channel=${plan.currentChannel || newest}&arch=${plan.arch}" -o graph.json`;

  return (
    <div className="upgrade-path">
      {readOnly ? <Banner variant="info">This plan was received from the connected side and is read-only. Its route and graph are the snapshot it was planned with (“as of” that time).</Banner> : null}
      {error ? <Banner variant="error">{error}</Banner> : null}
      <section className="card" aria-labelledby={`upgrade-select-${plan.id}`}>
        <h3 id={`upgrade-select-${plan.id}`}>Current and target release</h3>
        <div className="field-grid">
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Architecture" hint={ARCH_HINT}>
              <select id={`upgrade-arch-${plan.id}`} className="control-enum" value={plan.arch} disabled={readOnly} onChange={(e) => save({ arch: e.target.value })}>
                {ARCHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </FieldLabelWithInfo>
            <div className="field-control-support" />
          </div>
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Channel policy" hint={POLICY_HINT}>
              <select id={`upgrade-policy-${plan.id}`} className="control-enum" value={prefix} disabled={readOnly} onChange={(e) => save({ channelPolicy: e.target.value, currentChannel: null, current: null, target: null, strategy: "standard" })}>
                <option value="stable">Stable (guided default)</option>
                <option value="eus">EUS (even minors)</option>
                <option value="fast">Fast (advanced)</option>
              </select>
            </FieldLabelWithInfo>
            <div className="field-control-support">
              {prefix === "fast" ? <span className="field-helper"><span className="upgrade-badge" data-state="WARNING">⚠ fast</span> Fast-channel releases are supported, but newer to the field than stable; mirroring stages pin stable releases, so a fast-only release cannot be staged until it reaches stable.</span> : null}
            </div>
          </div>
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Graph source" hint={SOURCE_HINT}>
              <select id={`upgrade-source-${plan.id}`} className="control-enum" value={source} disabled={readOnly} onChange={(e) => save({ graphSource: e.target.value })}>
                {!highSide ? <option value="public">Public update graph (api.openshift.com)</option> : null}
                <option value="imported">Imported graph (snapshot or your OSUS)</option>
              </select>
            </FieldLabelWithInfo>
            <div className="field-control-support" />
          </div>
        </div>
        <div className="field-grid">
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Current channel" hint={CURRENT_CHANNEL_HINT}>
              <select id={`upgrade-current-channel-${plan.id}`} className="control-enum" value={plan.currentChannel || ""} disabled={readOnly} onChange={(e) => save({ currentChannel: e.target.value || null, current: null, target: null })}>
                <option value="">Select the current channel</option>
                {channels.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </FieldLabelWithInfo>
            <div className="field-control-support">
              {plan.currentChannel && !currentGraph ? (
                <span className="field-helper">
                  The {plan.currentChannel} graph is not loaded.{" "}
                  {source === "public" && !highSide ? <Button variant="secondary" onClick={() => refresh(plan.currentChannel)} disabled={Boolean(busy)}>{busy === `refresh:${plan.currentChannel}` ? "Loading…" : "Load from the update service"}</Button> : <Button variant="secondary" onClick={() => { setImportChannel(plan.currentChannel); setImportOpen(true); }}>Import graph…</Button>}
                </span>
              ) : null}
            </div>
          </div>
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Current release" hint={CURRENT_RELEASE_HINT}>
              <select id={`upgrade-current-${plan.id}`} className="control-enum" value={plan.current || ""} disabled={readOnly || !currentGraph} onChange={(e) => save({ current: e.target.value || null, target: null })}>
                <option value="">{currentGraph ? "Select the current release" : "Load the current channel's graph first"}</option>
                {currentVersions.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </FieldLabelWithInfo>
            <div className="field-control-support">
              {!plan.currentChannel ? <span className="field-helper">Choose the current channel first.</span> : null}
              {currentGraph?.graph?.counts?.excludedUnsupported ? <span className="field-helper">{currentGraph.graph.counts.excludedUnsupported} release(s) of unsupported minors in this channel are not offered.</span> : null}
            </div>
          </div>
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Target release" hint={TARGET_HINT(newest)}>
              <select id={`upgrade-target-${plan.id}`} className="control-enum" value={plan.target || ""} disabled={readOnly || !plan.current || !targets} onChange={(e) => save({ target: e.target.value || null })}>
                <option value="">{!plan.current ? "Select the current release first" : !targetGraph ? `Load the ${newest} graph first` : !targets ? "Checking reachable releases…" : "Select the target release"}</option>
                <optgroup label="Recommended">
                  {recommendedTargets.map((t) => <option key={t.version} value={t.version}>{t.version} ({t.hops} update{t.hops === 1 ? "" : "s"})</option>)}
                </optgroup>
                {plan.conditionalReview?.enabled ? (
                  <optgroup label="Only through conditional updates">
                    {conditionalTargets.map((t) => <option key={t.version} value={t.version}>{t.version} (conditional)</option>)}
                  </optgroup>
                ) : null}
              </select>
            </FieldLabelWithInfo>
            <div className="field-control-support">
              {plan.current && !targetGraph ? (
                source === "public" && !highSide
                  ? <span className="field-helper">Targets are computed in {newest}. <Button variant="secondary" onClick={() => refresh(newest)} disabled={Boolean(busy)}>{busy === `refresh:${newest}` ? "Loading…" : `Load ${newest}`}</Button></span>
                  : <span className="field-helper">Import the {newest} graph to list targets. <Button variant="secondary" onClick={() => { setImportChannel(newest); setImportOpen(true); }}>Import graph…</Button></span>
              ) : null}
              {targets && conditionalTargets.length && !plan.conditionalReview?.enabled ? <span className="field-helper">{conditionalTargets.length} more release(s) are reachable only through conditional updates.</span> : null}
              {targets && unreachable.length ? <span className="field-helper">{unreachable.length} newer release(s) are not reachable from {plan.current} in this graph.</span> : null}
            </div>
          </div>
        </div>
        {cpoEligible ? (
          <div className="field-control-stack">
            <label className="switch-row">
              <Switch id={`upgrade-cpo-${plan.id}`} checked={plan.strategy === "cpo"} disabled={readOnly} onChange={(on) => save({ strategy: on ? "cpo" : "standard" })} aria-label="Control Plane Only update" />
              <span>Control Plane Only update (4.20 → 4.22 through 4.21; worker pools stay paused until the end). Its steps are generated only once its documented prerequisites are verified or attested on the Readiness tab.</span>
            </label>
          </div>
        ) : null}
        <CollapsibleSection title="Advanced" subtitle="Channel strategy and conditional updates" wrapInCard={false}>
          <div className="field-grid">
            <div className="field-control-stack">
              <FieldLabelWithInfo label="Channel strategy" hint={CHANNEL_STRATEGY_HINT}>
                <select id={`upgrade-chstrategy-${plan.id}`} className="control-enum" value={plan.channelStrategy} disabled={readOnly || prefix === "eus"} onChange={(e) => save({ channelStrategy: e.target.value })}>
                  <option value="per-minor">Per minor (guided)</option>
                  <option value="single">Single target channel</option>
                </select>
              </FieldLabelWithInfo>
              <div className="field-control-support">{prefix === "eus" ? <span className="field-helper">EUS routes stay on the EUS target channel.</span> : null}</div>
            </div>
          </div>
          <label className="switch-row">
            <Switch id={`upgrade-cond-${plan.id}`} checked={Boolean(plan.conditionalReview?.enabled)} disabled={readOnly} onChange={(on) => save({ conditionalReview: { enabled: on, acknowledgedRisks: [] } })} aria-label="Review conditional updates" />
            <span>Review conditional updates — updates the graph lists with known risks. Architect shows the risks and records your judgment; it never generates a command to apply a conditional update.</span>
          </label>
        </CollapsibleSection>
        <div className="actions">
          <Button variant="primary" disabled={readOnly || !plan.current || !plan.target || busy === "solve"} onClick={() => solve()}>{busy === "solve" ? "Computing…" : plan.path ? "Compute the route again" : "Compute the update route"}</Button>
          <Button variant="secondary" onClick={() => { setImportChannel(plan.currentChannel || newest); setImportOpen(true); }} disabled={readOnly}>Import graph…</Button>
        </div>
      </section>

      {importOpen ? (
        <section className="card" aria-labelledby={`upgrade-import-${plan.id}`}>
          <h3 id={`upgrade-import-${plan.id}`}>Import an update graph</h3>
          <p className="subtle">Architect never contacts your OpenShift Update Service. Where it is reachable, run this read-only command and paste or upload graph.json:</p>
          <div className="upgrade-command"><pre>{OSUS_CURL}</pre></div>
          <div className="field-grid">
            <div className="field-control-stack">
              <FieldLabelWithInfo label="Channel of this graph" hint={IMPORT_CHANNEL_HINT}>
                <select id={`upgrade-import-ch-${plan.id}`} className="control-enum" value={importChannel} onChange={(e) => setImportChannel(e.target.value)}>
                  {[...new Set([...channels, `stable-${supportedMinors[supportedMinors.length - 1]}`])].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </FieldLabelWithInfo>
              <div className="field-control-support" />
            </div>
            <div className="field-control-stack">
              <FieldLabelWithInfo label="Origin" hint={IMPORT_ORIGIN_HINT}>
                <select id={`upgrade-import-origin-${plan.id}`} className="control-enum" value={importOrigin} onChange={(e) => setImportOrigin(e.target.value)}>
                  <option value="customer-osus">From my OpenShift Update Service</option>
                  <option value="snapshot">A saved snapshot</option>
                </select>
              </FieldLabelWithInfo>
              <div className="field-control-support" />
            </div>
          </div>
          <JsonDocumentInput id={`upgrade-import-text-${plan.id}`} label="Graph JSON" value={importText} onChange={setImportText} />
          <div className="actions">
            <Button variant="primary" disabled={!importText.trim() || busy === "import"} onClick={doImport}>{busy === "import" ? "Importing…" : "Import"}</Button>
            <Button variant="secondary" onClick={() => setImportOpen(false)}>Cancel</Button>
          </div>
        </section>
      ) : null}

      {plan.path ? (
        <section className="card" aria-labelledby={`upgrade-route-${plan.id}`}>
          <h3 id={`upgrade-route-${plan.id}`}>
            {plan.pathStatus === "current" ? "Recommended route" : plan.pathStatus === "graph-changed" ? "Route (the graph has changed since — compute it again)" : "Recommended route (as of its graph)"}
          </h3>
          {plan.path.conditional ? <Banner variant="warning">This route uses conditional updates. See the risks below and on the Readiness tab.</Banner> : null}
          <UpgradeTimeline path={plan.path} selectedIndex={selectedHop} onSelect={setSelectedHop} />
          {selectedHop != null ? <HopDetail hop={plan.path.hops[selectedHop]} index={selectedHop} /> : null}
          {plan.graph ? <Freshness graph={plan.graph} label="Planning graph" /> : null}
          {plan.path.reasons?.length ? <ul>{plan.path.reasons.map((r) => <li key={r.code + r.message}>{r.message}</li>)}</ul> : null}
          <p className="subtle">
            {plan.path.selectedBy === "user" ? "You chose this route." : "Among equally short recommended routes, the one with the highest release at each step is shown by convention. That is not a safety ranking; you may choose another."}
          </p>
          {result?.alternatives?.length ? (
            <CollapsibleSection title={`Other equally short routes (${result.alternativesTotal})`} wrapInCard={false}>
              <ul>
                {result.alternatives.map((alt) => (
                  <li key={alt.join(">")}>
                    {alt.join(" → ")}{" "}
                    <Button variant="secondary" disabled={readOnly} onClick={() => solve(alt)}>Use this route</Button>
                  </li>
                ))}
              </ul>
            </CollapsibleSection>
          ) : null}
          {plan.path.conditional && plan.conditionalReview?.enabled ? (
            <section aria-labelledby={`upgrade-risks-${plan.id}`}>
              <h4 id={`upgrade-risks-${plan.id}`}>Conditional-update risks</h4>
              <p className="subtle">Acknowledging records your judgment as administrator. It is not proof the update is safe for your cluster; evaluate each risk on the cluster (oc adm upgrade recommend --version …).</p>
              <ul className="upgrade-check-list">
                {conditionalRisks.map((r) => (
                  <li key={r.name} className="upgrade-check">
                    <label className="switch-row">
                      <input type="checkbox" checked={acked.has(r.name)} disabled={readOnly} onChange={(e) => {
                        const names = new Set(acked);
                        if (e.target.checked) names.add(r.name); else names.delete(r.name);
                        save({ conditionalReview: { enabled: true, acknowledgedRisks: [...names] } });
                      }} />
                      <span><strong>{r.name}</strong>{r.ruleTypes?.length ? ` (${r.ruleTypes.join(", ")})` : ""}: {r.message} {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">details</a> : null}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </section>
      ) : null}

      {plan.planningChannel && graphs[key(plan.planningChannel)]?.normalized ? (
        <CollapsibleSection title="Channel graph" subtitle={`${plan.planningChannel} · releases in the supported minors`}>
          <UpgradeGraphView graph={graphs[key(plan.planningChannel)].normalized} path={plan.path} supportedMinors={supportedMinors} />
        </CollapsibleSection>
      ) : null}
    </div>
  );
}

/** Paste, upload or drop a JSON document (non-secret; nothing is masked or stored in the browser). */
export function JsonDocumentInput({ id, label, value, onChange, hint = JSON_INPUT_HINT }) {
  const onFile = async (file) => { if (file) onChange(await file.text()); };
  return (
    <div className="field-control-stack">
      <FieldLabelWithInfo label={label} hint={hint}>
        <textarea
          id={id}
          rows={6}
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
          onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
        />
      </FieldLabelWithInfo>
      <div className="field-control-support">
        <label className="field-helper">
          Or upload a file: <input type="file" accept=".json,application/json,text/plain" onChange={(e) => onFile(e.target.files?.[0])} aria-label={`${label}: upload a file`} />
        </label>
      </div>
    </div>
  );
}
