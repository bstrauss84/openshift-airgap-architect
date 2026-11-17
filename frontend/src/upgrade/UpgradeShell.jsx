/**
 * OpenShift Airgap Architect - Upgrade workspace (v2.3.0; UX correction).
 *
 * A standalone workflow beside Install and Mirroring, with the Mirroring workspace's shell
 * (header, Tools, YAML drawer, a plan list) and six steps that each answer one question:
 *   1 Route · 2 Content · 3 Readiness · 4 Mirror & transfer · 5 Update the cluster · 6 Handoff
 * A compact route strip stays visible under the steps (route, content and cluster progress).
 * Steps stay mounted where they hold work in progress, so going back never loses selections.
 * Each plan has ONE memory-only credential context (D-2), shared by its steps and nothing else.
 *
 * Planning and preparation only: nothing here contacts a cluster or triggers an update.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import Modal from "../components/Modal.jsx";
import ScopedConfirmModal from "../components/ScopedConfirmModal.jsx";
import ToolsDrawer from "../components/ToolsDrawer.jsx";
import YamlDrawer from "../components/YamlDrawer.jsx";
import { useThemePreference } from "../hooks/useThemePreference.js";
import PathTab, { JsonDocumentInput } from "./PathTab.jsx";
import ContentTab from "./ContentTab.jsx";
import MirrorTab from "./MirrorTab.jsx";
import InstructionsTab from "./InstructionsTab.jsx";
import ReadinessTab from "./ReadinessTab.jsx";
import ReviewTab from "./ReviewTab.jsx";
// Same sticky-tab mechanism as Mirroring: measured header height + reveal on deliberate tab change.
import { revealTabStart } from "../mirroring/ProfileWorkspace.jsx";
import { setActiveProfile, fetchMirroring } from "../mirroring/mirroringApi.js";
import { useProfilePreview } from "../mirroring/useProfilePreview.js";
import { planCredentialKey, forgetSourceCredential, forgetDestinationCredential } from "../mirroring/sourceCredentialSession.js";
import { fetchUpgrade, createPlan, setActivePlan, deletionPreview, deletePlan, importPackage, updatePlan } from "./upgradeApi.js";
import { readUpgradeReturn, clearUpgradeReturn, rememberUpgradeReturn } from "./upgradeReturn.js";

const TAB_KEY = "oaa.upgrade.step.v2";
export const STEPS = [
  ["route", "Route"],
  ["content", "Content"],
  ["readiness", "Readiness"],
  ["mirror", "Mirror & transfer"],
  ["update", "Update the cluster"],
  ["handoff", "Handoff"]
];
const readTab = () => { try { const t = sessionStorage.getItem(TAB_KEY); return STEPS.some(([k]) => k === t) ? t : "route"; } catch { return "route"; } };

/** Where each step stands, from the plan (no network): ✓ done · ● needs attention · ○ not started. */
export const stepState = (plan, key) => {
  if (!plan) return "todo";
  const views = plan.stageViews || [];
  switch (key) {
    case "route": return plan.path ? (plan.pathStatus === "graph-changed" || plan.pathStatus === "graph-missing" ? "attention" : "done") : "todo";
    case "content": return plan.stagesStale ? "attention" : plan.stages.length ? "done" : "todo";
    case "mirror": return !views.length ? "todo" : views.every((v) => v.content?.state === "registry-verified") ? "done" : views.some((v) => v.content?.state === "profile-missing" || v.content?.state === "in-registry-unverified") ? "attention" : views.some((v) => v.content?.state && v.content.state !== "planned") ? "progress" : "todo";
    case "update": return !plan.path ? "todo" : views.length && views.every((v) => v.clusterUpdated === "attested") ? "done" : views.some((v) => v.clusterUpdated === "attested") ? "progress" : "todo";
    default: return "none";
  }
};
const GLYPH = { done: ["✓", "done"], attention: ["●", "needs attention"], progress: ["◐", "in progress"], todo: ["○", "not started"], none: ["", ""] };

function RouteStrip({ plan }) {
  if (!plan?.path) return <p className="upgrade-route-strip subtle">No route yet · choose the cluster&apos;s release and a target on Route.</p>;
  const views = plan.stageViews || [];
  const inRegistry = views.filter((v) => v.content?.state === "registry-verified").length;
  const updated = views.filter((v) => v.clusterUpdated === "attested").length;
  return (
    <p className="upgrade-route-strip" aria-label="Plan summary">
      <span className="upgrade-route-strip-path">{plan.path.path.join(" → ")}</span>
      <span className="subtle">{plan.channelPolicy} · {plan.arch}</span>
      <span className="subtle">Content {views.length ? `${inRegistry}/${views.length} in registry` : "not prepared"}</span>
      <span className="subtle">Cluster {updated}/{plan.path.hops.length} updates recorded</span>
    </p>
  );
}

export default function UpgradeShell({ onExit, onOpenMirroring = null }) {
  const [theme, setTheme] = useThemePreference();
  const [status, setStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [slice, setSlice] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [tab, setTab] = useState(readTab);
  const [focusStage, setFocusStage] = useState(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  // YAML drawer: "stage" = the live, validated ImageSetConfiguration of one stage (the same
  // generator and route as its download and the Handoff package); "files" = named Handoff files.
  const [yamlOpen, setYamlOpen] = useState(false);
  const [yamlFiles, setYamlFiles] = useState(null);
  const [yamlStageId, setYamlStageId] = useState(null);
  const [profileCache, setProfileCache] = useState({});
  const [actionError, setActionError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteInfo, setDeleteInfo] = useState(null);
  const [removeStages, setRemoveStages] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const tabRefs = useRef({});
  const shellRef = useRef(null);
  const stepHeaderRef = useRef(null);
  const tabAnchorRef = useRef(null);
  const tabsRef = useRef(null);
  const [revealRequest, setRevealRequest] = useState(0);
  useEffect(() => {
    const header = stepHeaderRef.current;
    const shell = shellRef.current;
    if (!header || !shell) return undefined;
    const apply = () => shell.style.setProperty("--mirroring-header-h", `${Math.ceil(header.getBoundingClientRect().height)}px`);
    apply();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(apply);
    ro.observe(header);
    return () => ro.disconnect();
  }, [status]);
  // The route strip sticks right under the sticky step row: measure that row too.
  useEffect(() => {
    const tabs = tabsRef.current;
    const shell = shellRef.current;
    if (!tabs || !shell) return undefined;
    const apply = () => shell.style.setProperty("--upgrade-tabs-h", `${Math.ceil(tabs.getBoundingClientRect().height)}px`);
    apply();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(apply);
    ro.observe(tabs);
    return () => ro.disconnect();
  }, [status, activeId]);
  // Content's stage selector sticks right under the route strip: measure the strip as well.
  useEffect(() => {
    const shell = shellRef.current;
    const strip = shell?.querySelector(".upgrade-route-strip");
    if (!strip) return undefined;
    const apply = () => shell.style.setProperty("--upgrade-strip-h", `${Math.ceil(strip.getBoundingClientRect().height)}px`);
    apply();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(apply);
    ro.observe(strip);
    return () => ro.disconnect();
  }, [status, activeId, tab]);
  useLayoutEffect(() => { if (revealRequest) revealTabStart(tabAnchorRef.current); }, [revealRequest]);

  const showTab = (t) => {
    setTab(t);
    try { sessionStorage.setItem(TAB_KEY, t); } catch { /* not persisted */ }
  };
  const activateTab = (t) => { showTab(t); setRevealRequest((n) => n + 1); };

  const load = useCallback(async () => {
    try {
      const s = await fetchUpgrade();
      setSlice(s);
      // Coming back from a stage opened in Mirroring: the same plan, step and stage.
      const back = readUpgradeReturn();
      if (back && s.plans.some((p) => p.id === back.planId)) {
        clearUpgradeReturn();
        setActiveId(back.planId);
        showTab(back.step || "mirror");
        setFocusStage(back.stageId || null);
      } else {
        setActiveId((cur) => (s.plans.some((p) => p.id === cur) ? cur : s.activePlanId || s.plans[0]?.id || null));
      }
      setStatus("ready");
    } catch (err) {
      setLoadError(err.payload?.code === "UPGRADE_SCHEMA_UNKNOWN" ? err.message : `Could not load Upgrade plans: ${String(err.message || err)}`);
      setStatus("error");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const plan = slice?.plans.find((p) => p.id === activeId) || null;
  const credentialKey = plan ? planCredentialKey(plan.id) : null;
  /** Keep the newest copy of every stage profile the steps load or save (drives the live preview). */
  const profilesSeen = useCallback((list) => {
    setProfileCache((all) => {
      let changed = false;
      const next = { ...all };
      for (const p of list || []) {
        if (!p?.id) continue;
        const cur = next[p.id];
        if (!cur || (p.updatedAt || 0) >= (cur.updatedAt || 0)) { if (cur !== p) { next[p.id] = p; changed = true; } }
      }
      return changed ? next : all;
    });
  }, []);
  const stageViews = plan?.stageViews || [];
  const yamlStage = stageViews.find((v) => v.id === yamlStageId) || stageViews[0] || null;
  const yamlProfile = yamlStage?.linkedProfileId ? profileCache[yamlStage.linkedProfileId] || null : null;
  const stagePreviewOn = yamlOpen && !yamlFiles;
  const preview = useProfilePreview(stagePreviewOn ? yamlProfile : null);
  useEffect(() => {
    if (!stagePreviewOn || !yamlStage?.linkedProfileId || yamlProfile) return;
    fetchMirroring().then((m) => profilesSeen(m.profiles || [])).catch(() => {});
  }, [stagePreviewOn, yamlStage?.linkedProfileId, yamlProfile, profilesSeen]);
  const showStageYaml = useCallback((stageId) => { setYamlFiles(null); if (stageId) setYamlStageId(stageId); setYamlOpen(true); }, []);
  const stageShown = useCallback((stageId) => setYamlStageId(stageId), []);
  const showFiles = (files) => {
    const stageFile = files.length === 1 && files[0].stageId ? files[0] : null;
    if (stageFile) { showStageYaml(stageFile.stageId); return; }
    setYamlFiles(files);
    setYamlOpen(true);
  };
  const onPlanChanged = (next) => {
    if (!next) { load(); return; }
    setSlice((s) => (s ? { ...s, plans: s.plans.map((p) => (p.id === next.id ? next : p)) } : s));
  };
  const selectPlan = async (id) => {
    setActiveId(id);
    setYamlFiles(null);
    setYamlOpen(false);
    setYamlStageId(null);
    setFocusStage(null);
    try { await setActivePlan(id); } catch { /* navigation hint only */ }
  };
  const newPlan = async () => {
    setActionError("");
    try {
      const p = await createPlan();
      await load();
      setActiveId(p.id);
      activateTab("route");
    } catch (err) { setActionError(String(err.message || err)); }
  };
  const onTabKey = (e, i) => {
    const n = STEPS.length;
    let j = null;
    if (e.key === "ArrowRight") j = (i + 1) % n;
    if (e.key === "ArrowLeft") j = (i + n - 1) % n;
    if (e.key === "Home") j = 0;
    if (e.key === "End") j = n - 1;
    if (j != null) { e.preventDefault(); activateTab(STEPS[j][0]); tabRefs.current[STEPS[j][0]]?.focus(); }
  };
  const openDelete = async (p) => {
    setPendingDelete(p);
    setRemoveStages(false);
    setDeleteInfo(null);
    try { setDeleteInfo(await deletionPreview(p.id)); } catch (err) { setDeleteInfo({ error: String(err.message || err) }); }
  };
  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await deletePlan(pendingDelete.id, { removeStageProfiles: removeStages });
      forgetSourceCredential(planCredentialKey(pendingDelete.id));
      forgetDestinationCredential(planCredentialKey(pendingDelete.id));
      setPendingDelete(null);
      setActiveId(null);
      await load();
    } catch (err) {
      setDeleteInfo((d) => ({ ...(d || {}), error: String(err.message || err) }));
    } finally {
      setDeleting(false);
    }
  };
  const doImport = async () => {
    setActionError("");
    try {
      const r = await importPackage(importText);
      setImportOpen(false);
      setImportText("");
      await load();
      setActiveId(r.plan.id);
    } catch (err) { setActionError(String(err.message || err)); }
  };
  const saveName = async () => {
    const name = renaming.trim();
    setRenaming(null);
    if (!name || name === plan.name) return;
    try { onPlanChanged(await updatePlan(plan.id, { name })); } catch (err) { setActionError(String(err.message || err)); }
  };
  /** Open a stage (or one of its operations) in the full Mirroring workspace, with a way straight back. */
  const openInMirroring = useCallback(async (view, { jobId = null } = {}) => {
    if (!onOpenMirroring || !plan) return;
    try { if (view?.linkedProfileId) await setActiveProfile(view.linkedProfileId); } catch { /* Mirroring still opens */ }
    rememberUpgradeReturn({ planId: plan.id, planName: plan.name, stageId: view?.id || null, step: tab }, { jobId });
    onOpenMirroring();
  }, [onOpenMirroring, plan, tab]);
  const showOperation = useMemo(() => (onOpenMirroring ? (jobId) => openInMirroring(null, { jobId }) : null), [onOpenMirroring, openInMirroring]);

  const stageProfiles = deleteInfo?.stageProfiles || [];
  const running = stageProfiles.some((p) => p.running);
  return (
    <div className="app-shell mirroring-shell upgrade-shell" ref={shellRef}>
      <a href="#upgrade-main" className="skip-link">Skip to main content</a>
      <header className="app-header">
        <div className="brand"><img className="brand-banner" src="/airgap-architect-banner.png" alt="Red Hat OpenShift Airgap Architect" /></div>
        <div className="header-actions">
          {plan && (stageViews.length || yamlOpen) ? (
            <button type="button" className="ghost icon-button" onClick={() => { if (yamlOpen) { setYamlOpen(false); setYamlFiles(null); } else showStageYaml(null); }} aria-label={yamlOpen ? "Hide YAML" : "Show YAML"} title={yamlOpen ? "Hide YAML preview" : "Show each stage's ImageSetConfiguration"}>
              {yamlOpen ? "Hide YAML" : "Show YAML"}
            </button>
          ) : null}
          <button type="button" className="ghost icon-button" onClick={() => setToolsOpen((o) => !o)} title="Tools: Home, theme and about" aria-label="Open Tools">⚙ Tools</button>
        </div>
      </header>
      <div className="app">
        <div className="content">
          <div className="main-layout" style={{ display: "flex", flex: 1, overflow: "hidden" }}>
            <main className="main" id="upgrade-main" aria-label="Upgrade" tabIndex={-1} style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
              <div className="step">
                <div className="step-header" ref={stepHeaderRef}>
                  <div className="step-header-main">
                    <h2>Upgrade</h2>
                    <p className="subtle">Plan, prepare and hand off a disconnected OpenShift {slice?.supportedMinors?.join(" / ") || "4.20 / 4.21 / 4.22"} update. Architect never connects to or changes the cluster.</p>
                  </div>
                </div>
                <div className="step-body">
                  {actionError ? <Banner variant="error">{actionError}</Banner> : null}
                  {status === "loading" ? <div className="loading" role="status">Loading Upgrade plans…</div> : null}
                  {status === "error" ? (
                    <section className="card" role="alert">
                      <h3>Could not open Upgrade</h3>
                      <p>{loadError}</p>
                      <p className="subtle">Install and Mirroring are not affected.</p>
                      <div className="actions"><Button variant="primary" onClick={load}>Retry</Button></div>
                    </section>
                  ) : null}
                  {status === "ready" ? (
                    <div className="upgrade-layout">
                      <section className="card" aria-labelledby="upgrade-plans-heading">
                        <h3 id="upgrade-plans-heading">Plans</h3>
                        {slice.highSide ? <p className="note subtle">Disconnected side: graphs come only from imports (plan packages or your OpenShift Update Service).</p> : null}
                        {slice.plans.length ? (
                          <ul className="upgrade-plan-list">
                            {slice.plans.map((p) => (
                              <li key={p.id}>
                                <button type="button" className={`select-card${p.id === activeId ? " selected" : ""}`} aria-pressed={p.id === activeId} onClick={() => selectPlan(p.id)}>
                                  <span className="card-title">{p.name}</span>
                                  <span className="mirroring-profile-meta">{p.path ? p.path.path.join(" → ") : p.current ? `${p.current} → ${p.target || "?"}` : "No route yet"}{p.kind === "received" ? " · received" : ""}</span>
                                  <span className="select-card-check" aria-hidden="true">✓ Open</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : <p className="subtle">No plans yet. A plan is one cluster update: its route, the content to mirror for it, and its instructions.</p>}
                        <div className="actions">
                          <Button variant={slice.plans.length ? "secondary" : "primary"} onClick={newPlan}>New Upgrade plan</Button>
                          <Button variant="secondary" onClick={() => setImportOpen(true)}>Import plan…</Button>
                        </div>
                      </section>
                      <div>
                        {!plan ? (
                          <section className="card"><h3>Select or create a plan</h3><p className="subtle">Plans are independent: creating one never changes another, and Install and Mirroring are not affected.</p></section>
                        ) : (
                          <>
                            <section className="card upgrade-plan-header" aria-labelledby={`upgrade-plan-title-${plan.id}`}>
                              {renaming !== null ? (
                                <div className="upgrade-rename">
                                  <label htmlFor={`upgrade-rename-${plan.id}`} className="sr-only">Plan name</label>
                                  <input id={`upgrade-rename-${plan.id}`} type="text" value={renaming} maxLength={120} autoFocus onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setRenaming(null); }} />
                                  <Button variant="primary" className="mini" onClick={saveName}>Save</Button>
                                  <Button variant="secondary" className="mini" onClick={() => setRenaming(null)}>Cancel</Button>
                                </div>
                              ) : (
                                <h3 id={`upgrade-plan-title-${plan.id}`}>{plan.name}{plan.kind === "received" ? <span className="subtle"> · received (read-only)</span> : null}</h3>
                              )}
                              <div className="upgrade-plan-header-actions">
                                {plan.kind !== "received" && renaming === null ? <Button variant="secondary" className="mini" onClick={() => setRenaming(plan.name)}>Rename</Button> : null}
                                <Button variant="destructive" className="mini" onClick={() => openDelete(plan)}>Delete plan…</Button>
                              </div>
                            </section>
                            <div ref={tabAnchorRef} className="mirroring-tabs-anchor" aria-hidden="true" />
                            <div ref={tabsRef} className="mirroring-tabs upgrade-steps-nav" role="tablist" aria-label={`${plan.name}: steps`}>
                              {STEPS.map(([k, label], i) => {
                                const st = stepState(plan, k);
                                const [glyph, glyphText] = GLYPH[st];
                                return (
                                  <button key={k} ref={(el) => { tabRefs.current[k] = el; }} type="button" role="tab" id={`upgrade-tab-${k}`} aria-selected={tab === k} aria-controls={`upgrade-tabpanel-${k}`} tabIndex={tab === k ? 0 : -1} className={`mirroring-tab upgrade-step-tab${tab === k ? " active" : ""}`} data-state={st} onClick={() => activateTab(k)} onKeyDown={(e) => onTabKey(e, i)}>
                                    <span className="upgrade-step-num" aria-hidden="true">{i + 1}</span>
                                    <span>{label}</span>
                                    {glyph ? <span className="upgrade-step-glyph" aria-hidden="true">{glyph}</span> : null}
                                    {glyphText ? <span className="sr-only">, {glyphText}</span> : null}
                                  </button>
                                );
                              })}
                            </div>
                            <RouteStrip plan={plan} />
                            {STEPS.map(([k]) => (
                              <div key={k} role="tabpanel" id={`upgrade-tabpanel-${k}`} aria-labelledby={`upgrade-tab-${k}`} hidden={tab !== k} className="mirroring-tabpanel">
                                {k === "route" ? <PathTab key={plan.id} plan={plan} supportedMinors={slice.supportedMinors} highSide={slice.highSide} onPlanChanged={onPlanChanged} /> : null}
                                {k === "content" ? <ContentTab key={plan.id} plan={plan} onPlanChanged={onPlanChanged} onShowOperation={showOperation} credentialKey={credentialKey} onPreviewStage={showStageYaml} onStageShown={stageShown} onProfilesSeen={profilesSeen} onGoToStep={activateTab} /> : null}
                                {k === "readiness" && tab === k ? <ReadinessTab key={plan.id} plan={plan} onPlanChanged={onPlanChanged} credentialKey={credentialKey} onGoToStep={activateTab} /> : null}
                                {k === "mirror" ? <MirrorTab key={plan.id} plan={plan} highSide={slice.highSide} onPlanChanged={onPlanChanged} credentialKey={credentialKey} onShowOperation={showOperation} onOpenStageInMirroring={onOpenMirroring ? (view) => openInMirroring(view) : null} initialStageId={focusStage} onGoToStep={activateTab} onProfilesSeen={profilesSeen} /> : null}
                                {k === "update" && tab === k ? <InstructionsTab key={plan.id} plan={plan} onPlanChanged={onPlanChanged} onGoToStep={activateTab} /> : null}
                                {k === "handoff" && tab === k ? <ReviewTab key={plan.id} plan={plan} onPreviewArtifacts={showFiles} onGoToStep={activateTab} /> : null}
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </main>
            {yamlOpen && yamlFiles ? (
              <YamlDrawer
                isOpen
                onClose={() => { setYamlOpen(false); setYamlFiles(null); }}
                mode="files"
                sourceLabel={`Upgrade plan: ${plan?.name || ""}`}
                emptyMessage="No files yet."
                previewFiles={Object.fromEntries(yamlFiles.filter((f) => f.content).map((f) => [f.name, f.content]))}
                resetSizing={false}
                fetchExportFile={async (name) => yamlFiles.find((f) => f.name === name)?.content || ""}
              />
            ) : null}
            {yamlOpen && !yamlFiles && plan ? (
              <YamlDrawer
                isOpen
                onClose={() => setYamlOpen(false)}
                mode="imageset"
                sourceLabel={yamlStage ? `Stage ${yamlStage.id.slice(1)} · ${yamlStage.release}` : "No stage"}
                downloadName={yamlStage ? `stage-${yamlStage.id.slice(1)}-${yamlStage.release}-imageset-config.yaml` : null}
                headerExtras={stageViews.length ? (
                  <label className="yaml-stage-select">
                    <span>Stage shown</span>
                    <select value={yamlStage?.id || ""} onChange={(e) => setYamlStageId(e.target.value)}>
                      {stageViews.map((v) => <option key={v.id} value={v.id}>Stage {v.id.slice(1)} · {v.release}</option>)}
                    </select>
                  </label>
                ) : null}
                emptyMessage={!stageViews.length
                  ? "Prepare the stages (Content) to generate their ImageSetConfigurations."
                  : !yamlStage?.linkedProfileId
                  ? "This stage has no profile yet: prepare the stages again, or receive its transfer."
                  : preview.notReady.length
                  ? `This stage is not ready to generate yet: ${preview.notReady.join(" ")}`
                  : "Loading this stage's configuration…"}
                previewFiles={preview.yaml ? { "imageset-config.yaml": preview.yaml } : preview.draft?.yaml ? { "imageset-config.yaml": preview.draft.yaml } : {}}
                draftNotice={preview.draft ? (
                  <>
                    <strong>Draft — not downloadable.</strong> This stage is not ready to generate its ImageSetConfiguration yet.
                    <ul className="yaml-draft-blockers">{preview.draft.blockers.map((b) => <li key={`${b.path}:${b.code || ""}`}>{b.message}</li>)}</ul>
                    {preview.draft.error ? <div className="subtle">The draft could not be rendered: {preview.draft.error}</div> : null}
                  </>
                ) : null}
                statusNote={preview.yaml && preview.validation ? `${preview.validation.summary} The same file is in the Handoff package.` : null}
                loading={preview.loading || (Boolean(yamlStage?.linkedProfileId) && !yamlProfile)}
                error={preview.error}
                stale={preview.stale}
                resetSizing={false}
                fetchExportFile={preview.fetchForDownload}
              />
            ) : null}
          </div>
        </div>
      </div>
      <ToolsDrawer isOpen={toolsOpen} onClose={() => setToolsOpen(false)} theme={theme} setTheme={setTheme} onHome={onExit} workflowLabel="Upgrade" />
      <Modal isOpen={importOpen} onClose={() => setImportOpen(false)} ariaLabelledBy="upgrade-import-plan-title">
        <h3 id="upgrade-import-plan-title">Import an upgrade plan</h3>
        <p className="modal-copy subtle">Use oaa-upgrade-package.json from a plan package. Architect checks every recorded checksum before importing anything; a changed file is refused. The checksums show integrity, not who made the package. The plan is imported read-only, with its graph snapshots labelled as snapshots.</p>
        <JsonDocumentInput id="upgrade-import-plan-text" label="oaa-upgrade-package.json" value={importText} onChange={setImportText} />
        <div className="actions">
          <Button variant="secondary" onClick={() => setImportOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={!importText.trim()} onClick={doImport}>Import plan</Button>
        </div>
      </Modal>
      <ScopedConfirmModal
        isOpen={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        id="upgrade-delete"
        title={`Delete the plan “${pendingDelete?.name || ""}”?`}
        loading={!deleteInfo}
        error={deleteInfo?.error || (running ? "A stage of this plan is running. Stop it before deleting the plan." : null)}
        removed={["The plan record: route, stages list, imported evidence and attestations", ...(removeStages ? stageProfiles.map((p) => `Stage profile record “${p.name}”`) : [])]}
        kept={[
          ...(removeStages ? [] : stageProfiles.map((p) => `Stage profile “${p.name}” — kept as an ordinary Mirroring profile`)),
          ...stageProfiles.map((p) => `Mirrored data on disk: ${p.retainedPaths?.archivePath || "archives"}, ${p.retainedPaths?.workspacePath || "workspace"}, ${p.retainedPaths?.cachePath || "cache"}`),
          "Operation history of every stage run",
          "Every other plan, every Mirroring profile, and the Install workflow"
        ]}
        notes={["Architect never deletes mirrored data; remove those directories yourself when you no longer need them."]}
        confirmLabel={removeStages ? "Delete the plan and its stage profile records" : "Delete the plan"}
        confirmDisabled={running}
        busy={deleting}
        onConfirm={confirmDelete}
      >
        {stageProfiles.length ? (
          <label className="toggle-row">
            <input type="checkbox" checked={removeStages} onChange={(e) => setRemoveStages(e.target.checked)} />
            <span>Also remove the {stageProfiles.length} stage profile record(s) from Mirroring (mirrored data on disk is still kept)</span>
          </label>
        ) : null}
      </ScopedConfirmModal>
    </div>
  );
}
