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
import OptionRow from "../components/OptionRow.jsx";
import UpgradeTimeline, { HopDetail } from "./UpgradeTimeline.jsx";
import UpgradeGraphView from "./UpgradeGraphView.jsx";
import ExploreHistory from "./ExploreHistory.jsx";
import { getMinorVersion } from "../../../shared/versionUtils.js";
import { ARCH_HINT, POLICY_HINT, SOURCE_HINT, CURRENT_CHANNEL_HINT, CURRENT_RELEASE_HINT, TARGET_HINT, CHANNEL_STRATEGY_HINT, IMPORT_CHANNEL_HINT, IMPORT_ORIGIN_HINT, JSON_INPUT_HINT } from "./upgradeCopy.js";
import { fetchGraph, refreshGraph, importGraph, updatePlan, solvePlan } from "./upgradeApi.js";
import { classifyTargets, minorGates } from "../../../shared/upgradePath.js";

const ARCHES = [["amd64", "x86_64"], ["arm64", "aarch64 (arm64)"], ["s390x", "s390x"], ["ppc64le", "ppc64le"], ["multi", "multi (heterogeneous)"]];
const ago = (iso) => {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown time";
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export function Freshness({ graph, label = "Graph", compact = false }) {
  const [open, setOpen] = useState(false);
  if (!graph) return null;
  const host = graph.origin === "public-api" ? "api.openshift.com" : graph.origin === "customer-osus" ? "your OpenShift Update Service (imported by you)" : "an imported snapshot";
  const origin = graph.origin === "public-api" ? "fetched by Architect from api.openshift.com" : graph.origin === "customer-osus" ? "imported by you from your OpenShift Update Service (not fetched by Architect)" : "imported snapshot (not fetched by Architect)";
  const when = `${new Date(graph.fetchedAt).toISOString().replace(".000Z", "Z")}`;
  const details = <span className="subtle">{graph.channel} · {graph.arch} · {origin} · {graph.source === "public" ? "fetched" : graph.capturedAtKnown ? "captured" : "imported"} {when}. SHA-256 {graph.bodySha256.slice(0, 16)}… — integrity of this copy only; the graph is not signed, so its authenticity is not verified.</span>;
  if (compact) {
    return (
      <div className="upgrade-freshness compact" data-stale={graph.stale ? "true" : "false"} role="note">
        <span><strong>{label}:</strong> {host} · {graph.channel} · {ago(graph.fetchedAt)}{graph.stale ? " — “as of” this time; confirm before each update" : ""}</span>
        <Button variant="secondary" className="mini" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Hide details" : "Details"}</Button>
        {open ? <p>{details}</p> : null}
      </div>
    );
  }
  return (
    <p className="upgrade-freshness" data-stale={graph.stale ? "true" : "false"} role="note">
      <strong>{label}:</strong> {graph.channel} · {graph.arch} · {origin} · {graph.source === "public" ? "fetched" : graph.capturedAtKnown ? "captured" : "imported"} {when} ({ago(graph.fetchedAt)})
      {graph.stale ? " — recommendations are “as of” this time; confirm before each update." : ""}
      <br /><span className="subtle">SHA-256 {graph.bodySha256.slice(0, 16)}… — integrity of this copy only; the graph is not signed, so its authenticity is not verified.</span>
    </p>
  );
}

export default function PathTab({ plan, supportedMinors, highSide, onPlanChanged }) {
  const [graphs, setGraphs] = useState({});
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
      const value = r && r.loaded !== false ? r : null;
      setGraphs((g) => ({ ...g, [key(ch)]: value }));
      return value;
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

  // Reachable targets, computed from the graph already loaded here with the shared, pure solver
  // function the server uses (the server stays authoritative when the route is computed).
  // v2.3.0 UX fix (reproduced in Chrome 157): fetching them after every change left the Target
  // select DISABLED for the round trip and then REPLACED its options, which closes a popup the
  // user had just opened — so the first click looked ignored and only a second one (often on the
  // arrow) worked. Computing them in the same render removes that window.
  const targets = useMemo(() => {
    const g = targetGraph?.normalized;
    if (!plan.current || !g) return null;
    if (!g.nodes?.[plan.current]) return [];
    return classifyTargets(g, plan.current, { supportedMinors });
  }, [plan.current, targetGraph, supportedMinors]);

  const gates = useMemo(() => {
    const g = targetGraph?.normalized;
    if (!plan.current || !g?.nodes?.[plan.current]) return [];
    return minorGates(g, plan.current, { supportedMinors });
  }, [plan.current, targetGraph, supportedMinors]);

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
        <h3 id={`upgrade-select-${plan.id}`}>Cluster today</h3>
        <div className="field-grid upgrade-fields">
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Architecture" hint={ARCH_HINT}>
              <select id={`upgrade-arch-${plan.id}`} className="control-enum" value={plan.arch} disabled={readOnly} onChange={(e) => save({ arch: e.target.value })}>
                {ARCHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </FieldLabelWithInfo>
            <div className="field-control-support" />
          </div>
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
        </div>
        <h3 className="upgrade-subhead">Update to</h3>
        <div className="field-grid upgrade-fields">
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Target release" hint={TARGET_HINT(newest)}>
              <select id={`upgrade-target-${plan.id}`} className="control-enum" value={plan.target || ""} disabled={readOnly || !plan.current || !targets} onChange={(e) => save({ target: e.target.value || null })}>
                <option value="">{!plan.current ? "Select the current release first" : !targetGraph ? `Load the ${newest} graph first` : !targets?.length ? "No newer release in this graph" : "Select the target release"}</option>
                <optgroup label="Recommended">
                  {recommendedTargets.map((t) => <option key={t.version} value={t.version}>{t.version} ({t.hops} update{t.hops === 1 ? "" : "s"})</option>)}
                </optgroup>
                {plan.conditionalReview?.enabled ? (
                  <optgroup label="Only through conditional updates">
                    {conditionalTargets.map((t) => <option key={t.version} value={t.version}>{t.version} — via a conditional update ({t.alwaysRisk ? "a risk applies to every cluster" : "risk applies only to some clusters"})</option>)}
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
              {targets && unreachable.length ? <span className="field-helper">{unreachable.length} newer release(s) are not reachable from {plan.current} in this graph.</span> : null}
            </div>
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
        </div>
        {targets && conditionalTargets.length ? <ConditionalTargetsNote current={plan.current} targets={conditionalTargets} gates={gates} reviewOn={Boolean(plan.conditionalReview?.enabled)} /> : null}
        <CollapsibleSection title="Advanced" subtitle={cpoEligible ? "Control Plane Only, channel strategy, conditional updates" : "Channel strategy and conditional updates"} wrapInCard={false}>
          {cpoEligible ? (
            <OptionRow title="Control Plane Only update" description="4.20 → 4.22 through 4.21 on eus-4.22; worker pools stay paused until the end. Its steps are generated only once the documented prerequisites are verified or attested on the Readiness step.">
              <Switch id={`upgrade-cpo-${plan.id}`} checked={plan.strategy === "cpo"} disabled={readOnly} onChange={(on) => save({ strategy: on ? "cpo" : "standard" })} aria-label="Control Plane Only update" />
            </OptionRow>
          ) : null}
          <div className="field-grid upgrade-fields">
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
          <OptionRow title="Review conditional updates" description="Updates the graph lists with known risks. Architect shows the risks and records your judgment; it never generates a command to apply a conditional update.">
            <Switch id={`upgrade-cond-${plan.id}`} checked={Boolean(plan.conditionalReview?.enabled)} disabled={readOnly} onChange={(on) => save({ conditionalReview: { enabled: on, acknowledgedRisks: [] } })} aria-label="Review conditional updates" />
          </OptionRow>
        </CollapsibleSection>
        <div className="actions">
          <Button variant="primary" disabled={readOnly || !plan.current || !plan.target || busy === "solve"} onClick={() => solve()}>{busy === "solve" ? "Computing…" : plan.path ? "Compute the route again" : "Compute the update route"}</Button>
        </div>
        <div className="upgrade-graph-source" role="group" aria-label="Graph source">
          <span className="subtle">Graph source: <strong>{source === "public" ? "Public update graph (api.openshift.com)" : "Imported graph (snapshot or your OSUS)"}</strong></span>
          <Button variant="secondary" className="mini" aria-expanded={importOpen} aria-controls={`upgrade-import-panel-${plan.id}`} disabled={readOnly} onClick={() => { if (!importOpen) setImportChannel(plan.currentChannel || newest); setImportOpen((o) => !o); }}>{importOpen ? "Close graph source options" : "Change source or import a graph…"}</Button>
        </div>
        {importOpen ? (
          <div className="upgrade-import-panel" id={`upgrade-import-panel-${plan.id}`}>
            <div className="field-grid upgrade-fields">
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Graph source" hint={SOURCE_HINT}>
              <select id={`upgrade-source-${plan.id}`} value={source} disabled={readOnly} onChange={(e) => save({ graphSource: e.target.value })}>
                {!highSide ? <option value="public">Public update graph (api.openshift.com)</option> : null}
                <option value="imported">Imported graph (snapshot or your OSUS)</option>
              </select>
            </FieldLabelWithInfo>
            <div className="field-control-support" />
          </div>
            </div>
            <h4>Import an update graph</h4>
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
                <select id={`upgrade-import-origin-${plan.id}`} value={importOrigin} onChange={(e) => setImportOrigin(e.target.value)}>
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
            <Button variant="secondary" onClick={() => setImportOpen(false)}>Close</Button>
          </div>
          </div>
        ) : null}
      </section>

      {plan.path ? (
        <section className="card" aria-labelledby={`upgrade-route-${plan.id}`}>
          <h3 id={`upgrade-route-${plan.id}`}>
            {plan.pathStatus === "current" ? "Recommended route" : plan.pathStatus === "graph-changed" ? "Route (the graph has changed since — compute it again)" : "Recommended route (as of its graph)"}
          </h3>
          {plan.path.conditional ? <Banner variant="warning">This route uses conditional updates. See the risks below and on the Readiness tab.</Banner> : null}
          <UpgradeTimeline path={plan.path} selectedIndex={selectedHop} onSelect={setSelectedHop} nodeInfo={plan.planningChannel ? graphs[key(plan.planningChannel)]?.normalized?.nodes : null} />
          {selectedHop != null ? <HopDetail hop={plan.path.hops[selectedHop]} index={selectedHop} /> : null}
          {plan.graph ? <Freshness graph={plan.graph} label="Graph" compact /> : null}
          {plan.path.reasons?.length ? <ul>{plan.path.reasons.map((r) => <li key={r.code + r.message}>{r.message}</li>)}</ul> : null}
          <p className="subtle">
            {plan.path.selectedBy === "user" ? "You chose this route." : "Shown by convention: the highest release at each step among equally short recommended routes — not a safety ranking."}
          </p>
          {result?.alternatives?.length ? (
            <CollapsibleSection title={`Other equally short routes (${result.alternativesTotal})`} wrapInCard={false}>
              <ul>
                {result.alternatives.map((alt) => {
                  // Recommended vs conditional, per update, from the planning graph itself.
                  const g = plan.planningChannel ? graphs[key(plan.planningChannel)]?.normalized : null;
                  const condHops = g ? alt.slice(1).map((to, i) => ({ from: alt[i], to })).filter(({ from, to }) => !g.edges.some(([a, b]) => a === from && b === to) && g.conditional.some((c) => c.from === from && c.to === to)) : [];
                  return (
                    <li key={alt.join(">")} className="upgrade-alt-route">
                      {alt.join(" → ")}{" "}
                      {condHops.length
                        ? <span className="upgrade-badge" data-state="WARNING">⚠ conditional: {condHops.map((h) => `${h.from} → ${h.to} (${g.conditional.find((c) => c.from === h.from && c.to === h.to).risks.map((r) => r.name).join(", ")})`).join("; ")}</span>
                        : g ? <span className="upgrade-badge" data-state="VERIFIED">recommended updates only</span> : null}{" "}
                      <Button variant="secondary" className="mini" disabled={readOnly} onClick={() => solve(alt)}>Use this route</Button>
                    </li>
                  );
                })}
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
                    <label className="toggle-row">
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

      <ExploreHistory
        plan={plan}
        supportedMinors={supportedMinors}
        highSide={highSide}
        onPlanSupportedPart={(from, to) => save({ channelPolicy: "stable", currentChannel: `stable-${getMinorVersion(from)}`, current: from, target: to, strategy: "standard" })}
      />

      {plan.planningChannel && graphs[key(plan.planningChannel)]?.normalized ? (
        <CollapsibleSection title="Channel graph" subtitle={`${plan.planningChannel} · releases in the supported minors`}>
          <UpgradeGraphView graph={graphs[key(plan.planningChannel)].normalized} path={plan.path} supportedMinors={supportedMinors} />
        </CollapsibleSection>
      ) : null}
    </div>
  );
}

/** Paste, upload or drop a JSON document (non-secret; nothing is masked or stored in the browser). */
/** "4.21.39, 4.21.40, 4.21.41" → "4.21.39–4.21.41" (consecutive z-streams compressed). */
export const versionRanges = (list) => {
  const out = [];
  for (const v of list) {
    const [mj, mn, z] = v.split(".").map(Number);
    const last = out[out.length - 1];
    if (last && last.mj === mj && last.mn === mn && last.z2 + 1 === z) last.z2 = z;
    else out.push({ mj, mn, z1: z, z2: z });
  }
  return out.map((r) => (r.z1 === r.z2 ? `${r.mj}.${r.mn}.${r.z1}` : `${r.mj}.${r.mn}.${r.z1}–${r.mj}.${r.mn}.${r.z2}`)).join(", ");
};

/**
 * Owner QA 4: "every 4.22 target is conditional" — true in the live graph (2026-11-19), but the
 * label hid why. A target is not conditional itself: every route to it passes at least one
 * conditional update. Say where the recommended routes stop, which risks the least-risk routes
 * carry, and whether each applies to every cluster ("Always") or only to matching clusters.
 */
export function ConditionalTargetsNote({ current, targets, gates, reviewOn }) {
  const byMinor = new Map();
  for (const t of targets) { const m = getMinorVersion(t.version); byMinor.set(m, (byMinor.get(m) || 0) + 1); }
  const blocked = (gates || []).find((g) => g.reachableRecommended.length === 0);
  // Per individual risk: how many targets' least-risk route passes it; every-cluster risks first.
  const byRisk = new Map();
  for (const t of targets) {
    for (const r of new Map((t.via || []).flatMap((h) => h.risks).map((x) => [x.name, x])).values()) {
      if (!byRisk.has(r.name)) byRisk.set(r.name, { ...r, count: 0 });
      byRisk.get(r.name).count += 1;
    }
  }
  const risks = [...byRisk.values()].sort((a, b) => Number(b.always) - Number(a.always) || b.count - a.count || a.name.localeCompare(b.name));
  return (
    <div className="upgrade-cond-note" role="note" aria-label="Why some targets need a conditional update">
      <p>
        <strong>{targets.length} release{targets.length === 1 ? "" : "s"}</strong> ({[...byMinor].map(([m, n]) => `${n} in ${m}`).join(", ")}) can be reached from {current} only through a <strong>conditional update</strong> — an update Red Hat lists with a known risk.
        {blocked ? (blocked.recommendedFrom.length
          ? <> Red Hat recommends updating from {blocked.from} to {blocked.to} only from {versionRanges(blocked.recommendedFrom)}, and {current} reaches {blocked.recommendedFrom.length === 1 ? "that release" : "those releases"} only through a conditional update.</>
          : <> The graph has no recommended update from {blocked.from} into {blocked.to} at all.</>) : null}
      </p>
      <details>
        <summary>Which risks, and do they apply to my cluster?</summary>
        <table className="upgrade-cond-risks">
          <thead><tr><th scope="col">Risk on the least-risk route</th><th scope="col">Applies to</th><th scope="col">Targets</th></tr></thead>
          <tbody>
            {risks.map((r) => (
              <tr key={r.name}>
                <th scope="row">{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.name}</a> : r.name}</th>
                <td>{r.always ? <span className="upgrade-badge" data-state="BLOCKED">every cluster</span> : <span className="upgrade-badge" data-state="WARNING">only matching clusters</span>}</td>
                <td>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>A risk that applies only to matching clusters is evaluated by the cluster itself: <code>oc adm upgrade</code> shows whether the update is recommended for it. Upload the readiness bundle on Readiness (Check my cluster&apos;s readiness) to see that evaluation here. Acknowledging a risk records your judgment; it never makes the update safe, and Architect never generates a command that forces a conditional update.</p>
      </details>
      {!reviewOn ? <p>To choose one of them, turn on <strong>Review conditional updates</strong> under Advanced below.</p> : null}
    </div>
  );
}

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
