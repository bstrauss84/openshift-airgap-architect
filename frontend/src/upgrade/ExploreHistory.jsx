/**
 * OpenShift Airgap Architect - Upgrade › Route › Explore older releases (v2.3.0, owner decision D-1).
 *
 * Exploration only — outside Architect's planning range. Any source and target from 4.1 up to the
 * newest supported minor can be explored (for example 4.12 → 4.18), using only REAL recommended
 * edges from each step's own stable-4.N channel graph, fetched from api.openshift.com (the same
 * allowlisted host) into a cache that planning never reads. The result is shown "as Red Hat's
 * update graph lists it today" (an old graph reflects today's recommendations, not those of the
 * past). Architect produces NO stages, ImageSetConfigurations, commands or runs for releases before
 * the planning range; where a route reaches it, the supported part can be planned normally.
 * When no route can be established, the exact reason and a safe next step are shown.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import CollapsibleSection from "../components/CollapsibleSection.jsx";
import UpgradeTimeline from "./UpgradeTimeline.jsx";
import { EXPLORE_SOURCE_HINT, EXPLORE_TARGET_HINT } from "./upgradeCopy.js";
import { exploreRoute } from "./upgradeApi.js";
import { getMinorVersion } from "../../../shared/versionUtils.js";

const minorOf = (v) => { try { return getMinorVersion(v) || ""; } catch { return ""; } };

export default function ExploreHistory({ plan, supportedMinors, highSide, onPlanSupportedPart }) {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const newest = supportedMinors[supportedMinors.length - 1];
  const first = supportedMinors[0];

  const run = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await exploreRoute({ arch: plan.arch, source: source.trim(), target: target.trim() }));
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  };

  const route = result?.ok ? { path: result.path, hops: result.hops } : null;
  const firstSupported = result?.firstSupported || null;
  const targetSupported = result?.ok && supportedMinors.includes(minorOf(result.path[result.path.length - 1]));
  return (
    <CollapsibleSection title="Explore older releases" subtitle={`Any release from 4.1 to ${newest} — exploration only, outside Architect's planning range`} defaultCollapsed>
      <p className="subtle">
        See how a cluster on an older release reaches a later one, using only the recommended updates in Red Hat&apos;s update graph today.
        Architect prepares configurations, commands and mirroring only from {first} on; for earlier releases it shows the route and the
        documentation to follow.
      </p>
      {highSide ? <Banner variant="info">Exploration needs the public update graph (api.openshift.com), which this disconnected side does not reach.</Banner> : null}
      {error ? <Banner variant="error">{error}</Banner> : null}
      <div className="field-grid upgrade-fields">
        <div className="field-control-stack">
          <FieldLabelWithInfo label="Release the cluster runs" hint={EXPLORE_SOURCE_HINT}>
            <input id={`upgrade-explore-source-${plan.id}`} type="text" inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="4.12.30" value={source} onChange={(e) => setSource(e.target.value)} />
          </FieldLabelWithInfo>
          <div className="field-control-support" />
        </div>
        <div className="field-control-stack">
          <FieldLabelWithInfo label="Release to explore up to" hint={EXPLORE_TARGET_HINT(newest)}>
            <input id={`upgrade-explore-target-${plan.id}`} type="text" inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="4.18.10" value={target} onChange={(e) => setTarget(e.target.value)} />
          </FieldLabelWithInfo>
          <div className="field-control-support" />
        </div>
      </div>
      <div className="actions">
        <Button variant="secondary" disabled={busy || highSide || !source.trim() || !target.trim()} onClick={run}>{busy ? "Reading the update graphs…" : "Explore the route"}</Button>
      </div>
      {result && !result.ok ? (
        <div className="note warning upgrade-explore-missing" role="status">
          <strong>No complete recommended route can be shown.</strong>
          <ul>{(result.reasons || []).map((r) => <li key={r.code + r.message}>{r.message}</li>)}</ul>
          {result.nextStep ? <p>{result.nextStep}</p> : null}
        </div>
      ) : null}
      {route ? (
        <div className="upgrade-explore-result" aria-live="polite">
          <p className="upgrade-explore-label"><span className="upgrade-badge" data-state="NOT_CHECKED">Exploration</span> Shown as Red Hat&apos;s update graph lists it today ({result.graphSources.map((g) => g.channel).join(", ")}, {plan.arch}). Not a plan: nothing is generated for releases before {first}.</p>
          <UpgradeTimeline path={route} nodeInfo={result.nodeInfo} exploreBefore={first} />
          {result.docs?.length ? (
            <p className="subtle">Follow Red Hat&apos;s documentation for the steps before {first}: {result.docs.map((d, i) => <React.Fragment key={d.minor}>{i ? ", " : ""}<a href={d.url} target="_blank" rel="noopener noreferrer">OpenShift {d.minor}</a></React.Fragment>)} <em>(links not yet confirmed by a person)</em>.</p>
          ) : null}
          {firstSupported && targetSupported && onPlanSupportedPart ? (
            <div className="actions">
              <Button variant="primary" disabled={plan.kind === "received"} onClick={() => onPlanSupportedPart(firstSupported, result.path[result.path.length - 1])}>Plan the supported part: {firstSupported} → {result.path[result.path.length - 1]}</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </CollapsibleSection>
  );
}
