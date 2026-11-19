/**
 * OpenShift Airgap Architect - Upgrade › 2 Content (v2.3.0 UX correction).
 *
 * What will be mirrored for each release on the route. A stage is one release: its platform
 * release (fixed by the route) plus operators from THAT minor's catalog. Operator selection is
 * Mirroring's own experience, embedded per stage (Quick Picks, catalog scan, browse, selected
 * operators, version constraints, Live catalog check) — no second operator UI. The plan's single
 * credential context (D-2) supplies the Red Hat pull secret. "Import previous configuration"
 * suggests operators from earlier ImageSetConfigurations; it never proves what is installed.
 *
 * Mirroring the stages is a later step (Mirror & transfer); nothing here runs oc-mirror.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import Modal from "../components/Modal.jsx";
import CollapsibleSection from "../components/CollapsibleSection.jsx";
import OperatorsSection from "../mirroring/OperatorsSection.jsx";
import AdditionalImagesEditor from "../mirroring/AdditionalImagesEditor.jsx";
import { fetchMirroring, updateProfile, verifyCatalogs, fetchJob } from "../mirroring/mirroringApi.js";
import { useSourceCredential } from "../mirroring/sourceCredentialSession.js";
import { useProfilePreview } from "../mirroring/useProfilePreview.js";
import PresetImporter, { SOURCE_TO_KIND } from "./OperatorsTab.jsx";
import OperatorMatrix from "./OperatorMatrix.jsx";
import RouteCatalogScan from "./RouteCatalogScan.jsx";
import { buildScanPlan, scannedAt } from "./routeCatalogs.js";
import { prepareStages, saveOperatorIntent, copyStageOperators, fetchStageConfig, fetchCatalogStatus, fetchChannelEvidence } from "./upgradeApi.js";

export const checkTiming = { pollMs: 1500 };
export const downloadText = (name, text, type = "application/yaml") => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function ContentTab({ plan, onPlanChanged, onShowOperation = null, credentialKey = null, onPreviewFiles = null, onGoToStep = null, onPreviewStage = null, onStageShown = null, onProfilesSeen = null }) {
  const [profiles, setProfiles] = useState({});
  // Report every loaded or saved stage profile to the shell (live YAML preview), without re-running loads.
  const seenRef = useRef(onProfilesSeen);
  seenRef.current = onProfilesSeen;
  const loadEvidenceRef = useRef(null);
  const [selected, setSelected] = useState(plan.stages[0]?.id || null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [statusByMinor, setStatusByMinor] = useState({});
  const [statusLoaded, setStatusLoaded] = useState(() => new Set());
  const [channelEvidence, setChannelEvidence] = useState({});
  const [checkAll, setCheckAll] = useState(null);
  const checkCred = useSourceCredential(credentialKey, "check");
  const loadEvidence = useCallback(async () => {
    try {
      const r = await fetchChannelEvidence(plan.id);
      setChannelEvidence(Object.fromEntries((r.evidence || []).map((e) => [`${e.catalogImage}|${e.name}`, e])));
    } catch { /* evidence stays unknown */ }
  }, [plan.id]);
  const [scans, setScans] = useState({});
  const received = plan.kind === "received";
  const stageMinors = [...new Set((plan.stageViews || []).map((v) => v.minor).filter(Boolean))];
  const loadStatus = useCallback(async (minor) => {
    try { const st = await fetchCatalogStatus(minor); setStatusByMinor((all) => ({ ...all, [minor]: st })); } catch { /* shown as not scanned */ }
    setStatusLoaded((all) => (all.has(minor) ? all : new Set([...all, minor])));
  }, []);
  loadEvidenceRef.current = loadEvidence;
  const minorsKey = stageMinors.join(",");
  useEffect(() => { for (const m of stageMinors) loadStatus(m); }, [minorsKey, loadStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadProfiles = useCallback(async () => {
    try {
      const m = await fetchMirroring();
      setProfiles(Object.fromEntries((m.profiles || []).map((p) => [p.id, p])));
      seenRef.current?.(m.profiles || []);
      loadEvidenceRef.current?.();
    } catch (err) {
      setError(`Could not load the stage profiles: ${String(err.message || err)}`);
    }
  }, []);
  useEffect(() => { loadProfiles(); }, [loadProfiles, plan.stages.length]);
  useEffect(() => { if (selected && !plan.stages.some((s) => s.id === selected)) setSelected(plan.stages[0]?.id || null); }, [plan.stages, selected]);
  useEffect(() => { if (!selected && plan.stages[0]) setSelected(plan.stages[0].id); }, [plan.stages, selected]);
  // The live YAML preview follows the stage shown here.
  useEffect(() => { if (selected && onStageShown) onStageShown(selected); }, [selected, onStageShown]);

  /** Apply reviewed channel changes, per stage profile; returns the reverse changes (Undo). */
  const applyChannels = async (changes) => {
    setError("");
    const undo = [];
    const byProfile = new Map();
    for (const c of changes) { if (!byProfile.has(c.profileId)) byProfile.set(c.profileId, []); byProfile.get(c.profileId).push(c); }
    try {
      for (const [pid, list] of byProfile) {
        const p = profiles[pid];
        if (!p) continue;
        const selectedOps = p.operators.selected.map((o) => {
          const c = list.find((x) => x.name === o.name);
          if (!c || c.channel === o.defaultChannel) return o;
          undo.push({ profileId: pid, name: o.name, channel: o.defaultChannel || null });
          return { ...o, defaultChannel: c.channel };
        });
        replaceProfile(await updateProfile(pid, { operators: { selected: selectedOps } }));
      }
    } catch (err) { setError(String(err.message || err)); }
    loadEvidence();
    return undo;
  };
  /** The existing Live catalog check, run for every stage with operators, one stage at a time. */
  const checkEveryStage = async () => {
    if (!checkCred.usable) { setError("Enter the plan's Red Hat pull secret first (Catalogs for this route, below)."); return; }
    const targets = (plan.stageViews || []).filter((v) => profiles[v.linkedProfileId]?.content?.operators && profiles[v.linkedProfileId].operators.selected.length);
    setError("");
    for (const v of targets) {
      setCheckAll({ stage: v, message: `Checking stage ${v.id.slice(1)} (${v.release})…` });
      try {
        const { jobId } = await verifyCatalogs(v.linkedProfileId, checkCred.body);
        for (let i = 0; i < 2000; i += 1) {
          const j = await fetchJob(jobId);
          if (["completed", "completed_with_warnings", "failed", "cancelled"].includes(j.status)) break;
          await new Promise((r) => setTimeout(r, checkTiming.pollMs));
        }
      } catch (err) { setError(`Stage ${v.id.slice(1)}: ${String(err.message || err)}`); }
    }
    setCheckAll(null);
    await loadProfiles();
    loadEvidence();
  };
  const prepare = async () => {
    setBusy("prepare");
    setError("");
    try {
      const r = await prepareStages(plan.id);
      onPlanChanged(r.plan);
      await loadProfiles();
      const parts = [];
      if (r.created?.length) parts.push(`${r.created.length} new stage profile(s)`);
      if (r.reused?.length) parts.push(`${r.reused.length} kept with their operators and mirrored data`);
      if (r.released?.length) parts.push(`${r.released.length} left the route and stay in Mirroring as ordinary profiles`);
      for (const c of r.carried || []) parts.push(`stage ${c.stageId.slice(1)} (${c.release}) took ${c.operators} operator(s)${c.images ? ` and ${c.images} image(s)` : ""} from the ${c.from} stage it replaces — review them`);
      if (parts.length) setNotice(`Stages prepared: ${parts.join("; ")}.`);
      setSelected(r.plan.stages[0]?.id || null);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy("");
    }
  };
  const saveIntent = async (body) => {
    setError("");
    try { onPlanChanged((await saveOperatorIntent(plan.id, { ...body, replaceConfirmed: true })).plan); } catch (err) { setError(String(err.message || err)); throw err; }
  };
  const copyLater = async (stageId) => {
    setBusy("copy");
    setError("");
    try {
      const r = await copyStageOperators(plan.id, stageId);
      onPlanChanged(r.plan);
      await loadProfiles();
      const CHECK_TEXT = { "default-channel": "default channel there", "channel-not-checked": "channel not checked there", "not-in-catalog": "NOT in that catalog", "not-scanned": "catalog not scanned" };
      setNotice(`${r.report.map((x) => `Stage ${x.stageId.slice(1)}: ${x.added?.length || 0} added${x.kept?.length ? `, ${x.kept.length} already selected (unchanged)` : ""}${x.checks?.length ? ` — ${x.checks.map((c) => `${c.name}${c.channel ? ` ${c.channel}` : ""}: ${CHECK_TEXT[c.status] || c.status}`).join(", ")}` : ""}`).join("; ")}. Copied channels are your selection until each stage's catalog confirms them.`);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy("");
    }
  };
  const recordInstalled = async () => {
    const entries = (plan.inventory?.operators || [])
      .filter((o) => o.name && SOURCE_TO_KIND[o.source])
      .map((o) => ({ name: o.name, catalogKind: SOURCE_TO_KIND[o.source], channel: o.channel || null, category: "installed", confidence: "cluster-export", sources: [{ file: `cluster export ${plan.inventory.importedAt || ""}`.trim() }] }));
    setError("");
    try {
      onPlanChanged((await saveOperatorIntent(plan.id, { entries })).plan);
      setNotice(`${entries.length} installed operator(s) from the imported cluster export recorded as installed. Choose them for the stages that need them.`);
    } catch (err) { setError(String(err.message || err)); }
  };
  const stageConfig = async (profile, view, action) => {
    setError("");
    try {
      const r = await fetchStageConfig(profile.id);
      const name = `stage-${view.id.slice(1)}-${view.release}-imageset-config.yaml`;
      if (action === "download") downloadText(name, r.imagesetConfig);
      else if (onPreviewFiles) onPreviewFiles([{ name, content: r.imagesetConfig }]);
    } catch (err) {
      setError(`The configuration for stage ${view.id.slice(1)} is not ready yet: ${String(err.message || err)}`);
    }
  };

  // The shown stage's configuration, live (same hook and route as the YAML drawer and the Handoff
  // package): its Download is enabled only when a validated file exists (owner QA P7).
  const shownView = (plan.stageViews || []).find((v) => v.id === selected) || null;
  const shownProfile = shownView?.linkedProfileId ? profiles[shownView.linkedProfileId] || null : null;
  const stagePreview = useProfilePreview(plan.kind === "received" ? null : shownProfile);

  if (!plan.path) {
    return (
      <section className="card">
        <h3>Content</h3>
        <p className="subtle">Compute the update route first: each release on it becomes one stage of content.</p>
        {onGoToStep ? <div className="actions"><Button variant="primary" onClick={() => onGoToStep("route")}>Go to Route</Button></div> : null}
      </section>
    );
  }
  const views = plan.stageViews || [];
  const view = views.find((s) => s.id === selected) || null;
  const profile = view?.linkedProfileId ? profiles[view.linkedProfileId] : null;
  const replaceProfile = (p) => { setProfiles((all) => ({ ...all, [p.id]: p })); seenRef.current?.([p]); };
  const stageIndex = views.findIndex((v) => v.id === selected);

  return (
    <div className="upgrade-content">
      {error ? <Banner variant="error">{error}</Banner> : null}
      {notice ? <Banner variant="info">{notice}</Banner> : null}
      <section className="card" aria-labelledby={`upgrade-stages-${plan.id}`}>
        <h3 id={`upgrade-stages-${plan.id}`}>Content for each release on the route</h3>
        <p className="subtle">
          Each release the cluster passes through ({plan.path.path.slice(1).join(", ")}) is one stage: its platform release and the operators you need from that minor&apos;s catalog.
        </p>
        {plan.stagesStale ? (
          <Banner variant="warning">
            <strong>These stages were prepared for a different route.</strong>{" "}
            {plan.stagesMismatch?.reason === "route-cleared"
              ? "The route was cleared by a change on Route; compute it again, then prepare the stages."
              : <>Prepared: {plan.stagesMismatch?.have?.join(", ")}. The route now needs: {plan.stagesMismatch?.want?.join(", ")}{plan.stagesMismatch?.missing?.length ? ` (missing ${plan.stagesMismatch.missing.join(", ")})` : ""}{plan.stagesMismatch?.extra?.length ? ` (no longer needed: ${plan.stagesMismatch.extra.join(", ")})` : ""}.</>}
            {" "}Mirroring is blocked until you prepare them again. Stages that stay keep their operators and mirrored data; a stage leaving the route becomes an ordinary Mirroring profile (nothing is deleted), and its operators are carried into the new stage of the same minor.
          </Banner>
        ) : null}
        {(!plan.stages.length || plan.stagesStale) && !received ? (
          <div className="actions">
            <Button variant="primary" disabled={busy === "prepare"} onClick={prepare}>{busy === "prepare" ? "Preparing…" : plan.stages.length ? "Prepare the stages again" : `Prepare ${plan.path.path.length - 1} stage(s)`}</Button>
          </div>
        ) : null}
      </section>

      {views.length ? (
        <nav className="upgrade-stage-bar" aria-label="Stages">
          <div className="upgrade-stage-chips" role="group" aria-label="Stage shown below">
            {views.map((s) => (
              <button key={s.id} type="button" className={`upgrade-stage-chip${selected === s.id ? " selected" : ""}`} aria-pressed={selected === s.id} onClick={() => setSelected(s.id)}>
                Stage {s.id.slice(1)} · {s.release}{s.operatorsSelected ? <span className="subtle"> · {s.operatorsSelected} operator{s.operatorsSelected === 1 ? "" : "s"}</span> : null}
              </button>
            ))}
          </div>
          <div className="upgrade-stage-bar-tools">
            {!received ? (() => {
              const sp = buildScanPlan(views, profiles, statusByMinor, statusLoaded);
              const busyScan = Object.values(scans).some((x) => x.state === "running" || x.state === "queued");
              const done = sp.filter((e) => e.cached).length;
              return (
                <Button variant="secondary" className="mini" onClick={() => document.getElementById(`upgrade-route-scan-${plan.id}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
                  aria-label={`Catalogs: ${busyScan ? "scanning" : `${done} of ${sp.length} minors scanned`}. Go to the catalog scans.`}>
                  {busyScan ? "Catalogs: scanning…" : `Catalogs: ${done}/${sp.length} scanned`}
                </Button>
              );
            })() : null}
            {!received ? <Button variant="secondary" className="mini" onClick={() => setImportOpen(true)}>Import previous configuration…</Button> : null}
          </div>
        </nav>
      ) : null}

      {views.length && !received ? (
        <RouteCatalogScan plan={plan} scanPlan={buildScanPlan(views, profiles, statusByMinor, statusLoaded)} credentialKey={credentialKey} scans={scans} setScans={setScans} onScanned={loadStatus}
          onCheckChannels={checkEveryStage} checkStatus={checkAll} hasSelections={views.some((v) => profiles[v.linkedProfileId]?.operators?.selected?.length)} />
      ) : null}

      {views.length ? (
        <section className="card" aria-labelledby={`upgrade-matrix-${plan.id}`}>
          <h3 id={`upgrade-matrix-${plan.id}`}>Operators across the route</h3>
          <OperatorMatrix plan={plan} views={views} profiles={profiles} readOnly={received} onSaveIntent={saveIntent} statusByMinor={statusByMinor} scans={scans} detailsFor={(op) => channelEvidence[`${op.catalogImage}|${op.name}`] || null} onApplyChannels={applyChannels}
            onRecordInstalled={!received && plan.inventory?.operators?.length ? recordInstalled : null} clusterOperatorCount={plan.inventory?.operators?.length || 0} />
          {!received && stageIndex >= 0 && stageIndex < views.length - 1 ? (
            <div className="actions">
              <Button variant="secondary" disabled={busy === "copy" || !profile?.operators?.selected?.length} onClick={() => copyLater(view.id)}>Copy stage {view.id.slice(1)}&apos;s operators to later stages</Button>
            </div>
          ) : null}
          <details className="upgrade-op-sequencing">
            <summary>Do operators need updating at every minor?</summary>
            <p>No. Before each minor update, every installed operator must <em>allow</em> the next minor; the others may stay where they are. Plan an operator into a stage when:</p>
            <ul>
              <li>it declares a maximum OpenShift version below that stage&apos;s minor (OLM blocks the update — Readiness shows it from the evidence bundle);</li>
              <li>its channel is named after an OpenShift version (for example OpenShift Data Foundation <code>stable-4.y</code>);</li>
              <li>its vendor ties it to the platform minor (for example OpenShift Virtualization and OpenShift Data Foundation, updated right after each platform minor).</li>
            </ul>
            <p className="subtle">An operator without a declared maximum is not blocked, but that does not prove it is supported on the new minor — check its documentation. Mirrored catalogs contain channel heads only; if an installed version cannot reach the head in one update path, widen that operator&apos;s version range in the stage.</p>
          </details>
        </section>
      ) : null}

      {view ? (
        <section className="card" aria-labelledby={`upgrade-stage-detail-${plan.id}`}>
          <h3 id={`upgrade-stage-detail-${plan.id}`}>Stage {view.id.slice(1)} · {view.release} <span className="subtle">· operator catalog {view.minor}</span></h3>
          {!profile ? (
            <p className="subtle">{received ? "No transfer for this stage has been received on this server yet." : "Prepare the stages to create this stage's content."}</p>
          ) : (
            <>
              <div className="actions">
                <Button variant="secondary" onClick={() => (onPreviewStage ? onPreviewStage(view.id) : stageConfig(profile, view, "preview"))} disabled={!onPreviewStage && !onPreviewFiles}>Preview this stage&apos;s ImageSetConfiguration</Button>
                <Button variant="secondary" disabled={!stagePreview.yaml || stagePreview.loading} aria-describedby={`upgrade-stage-dl-${plan.id}`}
                  onClick={async () => { try { downloadText(`stage-${view.id.slice(1)}-${view.release}-imageset-config.yaml`, await stagePreview.fetchForDownload()); } catch (err) { setError(String(err.message || err)); } }}>Download it</Button>
                <span id={`upgrade-stage-dl-${plan.id}`} className="subtle upgrade-dl-status" role="status">
                  {stagePreview.loading ? "Checking this stage's configuration…"
                    : stagePreview.yaml ? "Ready: validated against the oc-mirror v2 schema (the same file as in the Handoff package)."
                    : stagePreview.notReady.length ? <>Not ready to download: {stagePreview.notReady.join(" ")} {!profile.content?.operators && !received ? "" : null}</>
                    : stagePreview.error ? `Not available: ${stagePreview.error}` : "Not ready to download yet."}
                </span>
              </div>
              {!received && !profile.content?.operators ? (
                <div className="actions">
                  <Button variant="primary" onClick={async () => replaceProfile(await updateProfile(profile.id, { content: { platform: true, operators: true, additionalImages: Boolean(profile.content?.additionalImages) } }))}>Choose operators for this stage ({view.minor} catalog)</Button>
                </div>
              ) : null}
              {!received && profile.content?.operators ? (
                <OperatorsSection key={`operators-${profile.id}-${scannedAt(statusByMinor[view.minor]) || "none"}`} profile={profile} onProfileChanged={replaceProfile} onProfilesChanged={loadProfiles} onShowOperation={onShowOperation} credentialKey={credentialKey}
                  catalogManagedBy={{ label: "Catalogs for this route", onOpen: () => document.getElementById(`upgrade-route-scan-${plan.id}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" }) }} />
              ) : null}
              {!received ? (
                <CollapsibleSection title="Additional images" subtitle={profile.additionalImages?.length ? `${profile.additionalImages.length} for this stage` : "None for this stage"} defaultCollapsed wrapInCard={false}>
                  {profile.content?.additionalImages ? (
                    <AdditionalImagesEditor key={`images-${profile.id}`} profile={profile} onProfileChanged={replaceProfile} />
                  ) : (
                    <div className="actions"><Button variant="secondary" onClick={async () => replaceProfile(await updateProfile(profile.id, { content: { ...profile.content, platform: true, additionalImages: true } }))}>Add additional images to this stage</Button></div>
                  )}
                </CollapsibleSection>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      <Modal isOpen={importOpen} onClose={() => setImportOpen(false)} ariaLabelledBy={`upgrade-import-config-${plan.id}`}>
        <h3 id={`upgrade-import-config-${plan.id}`}>Import previous configuration</h3>
        <PresetImporter plan={plan} onPlanChanged={(p) => { onPlanChanged(p); loadProfiles(); }} onClose={() => setImportOpen(false)} />
      </Modal>
    </div>
  );
}
