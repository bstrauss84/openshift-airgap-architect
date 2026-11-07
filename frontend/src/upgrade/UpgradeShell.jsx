/**
 * OpenShift Airgap Architect - Upgrade workspace (v2.3.0, RFC §5).
 *
 * A standalone workflow beside Install and Mirroring, with the Mirroring
 * workspace's shell: header (YAML and Tools), a plan list, and one plan's
 * tabs — Path, Content & runs, Instructions, Readiness, Review & export.
 * Panels stay mounted when switching tabs. Home is navigation only. New plans
 * never touch existing ones; deleting a plan asks separately about its stage
 * profiles and never deletes mirrored data.
 *
 * Planning only: nothing here contacts a cluster or triggers an update.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import Modal from "../components/Modal.jsx";
import ScopedConfirmModal from "../components/ScopedConfirmModal.jsx";
import ToolsDrawer from "../components/ToolsDrawer.jsx";
import YamlDrawer from "../components/YamlDrawer.jsx";
import { useThemePreference } from "../hooks/useThemePreference.js";
import PathTab, { JsonDocumentInput } from "./PathTab.jsx";
import ContentTab from "./ContentTab.jsx";
import InstructionsTab from "./InstructionsTab.jsx";
import ReadinessTab from "./ReadinessTab.jsx";
import ReviewTab from "./ReviewTab.jsx";
import OperatorsTab from "./OperatorsTab.jsx";
// Same sticky-tab mechanism as Mirroring (owner C): measured header height + reveal on deliberate tab change.
import { revealTabStart } from "../mirroring/ProfileWorkspace.jsx";
import { fetchUpgrade, createPlan, setActivePlan, deletionPreview, deletePlan, importPackage } from "./upgradeApi.js";

const TAB_KEY = "oaa.upgrade.tab.v1";
const TABS = [["path", "Path"], ["operators", "Operators"], ["content", "Content & runs"], ["instructions", "Instructions"], ["readiness", "Readiness"], ["review", "Review & export"]];
const readTab = () => { try { const t = sessionStorage.getItem(TAB_KEY); return TABS.some(([k]) => k === t) ? t : "path"; } catch { return "path"; } };

export default function UpgradeShell({ onExit, onOpenMirroring = null }) {
  const [theme, setTheme] = useThemePreference();
  const [status, setStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [slice, setSlice] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [tab, setTab] = useState(readTab);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [yamlFiles, setYamlFiles] = useState(null);
  const [actionError, setActionError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteInfo, setDeleteInfo] = useState(null);
  const [removeStages, setRemoveStages] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const tabRefs = useRef({});
  // Sticky tabs: the tab row sticks under the sticky step header, whose measured height is
  // --mirroring-header-h (exactly as in Mirroring). A deliberate tab change brings the new panel's start
  // into view; programmatic changes do not move the page.
  const shellRef = useRef(null);
  const stepHeaderRef = useRef(null);
  const tabAnchorRef = useRef(null);
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
  useLayoutEffect(() => { if (revealRequest) revealTabStart(tabAnchorRef.current); }, [revealRequest]);

  const load = useCallback(async () => {
    try {
      const s = await fetchUpgrade();
      setSlice(s);
      setActiveId((cur) => (s.plans.some((p) => p.id === cur) ? cur : s.activePlanId || s.plans[0]?.id || null));
      setStatus("ready");
    } catch (err) {
      setLoadError(err.payload?.code === "UPGRADE_SCHEMA_UNKNOWN" ? err.message : `Could not load Upgrade plans: ${String(err.message || err)}`);
      setStatus("error");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const plan = slice?.plans.find((p) => p.id === activeId) || null;
  const onPlanChanged = (next) => {
    if (!next) { load(); return; }
    setSlice((s) => (s ? { ...s, plans: s.plans.map((p) => (p.id === next.id ? next : p)) } : s));
  };
  const selectPlan = async (id) => {
    setActiveId(id);
    setYamlFiles(null);
    try { await setActivePlan(id); } catch { /* navigation hint only */ }
  };
  const newPlan = async () => {
    setActionError("");
    try {
      const p = await createPlan();
      await load();
      setActiveId(p.id);
      showTab("path");
    } catch (err) { setActionError(String(err.message || err)); }
  };
  const showTab = (t) => {
    setTab(t);
    try { sessionStorage.setItem(TAB_KEY, t); } catch { /* not persisted */ }
  };
  const activateTab = (t) => { showTab(t); setRevealRequest((n) => n + 1); };
  const onTabKey = (e, i) => {
    const n = TABS.length;
    let j = null;
    if (e.key === "ArrowRight") j = (i + 1) % n;
    if (e.key === "ArrowLeft") j = (i + n - 1) % n;
    if (e.key === "Home") j = 0;
    if (e.key === "End") j = n - 1;
    if (j != null) { e.preventDefault(); activateTab(TABS[j][0]); tabRefs.current[TABS[j][0]]?.focus(); }
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

  const stageProfiles = deleteInfo?.stageProfiles || [];
  const running = stageProfiles.some((p) => p.running);
  return (
    <div className="app-shell mirroring-shell upgrade-shell" ref={shellRef}>
      <a href="#upgrade-main" className="skip-link">Skip to main content</a>
      <header className="app-header">
        <div className="brand"><img className="brand-banner" src="/airgap-architect-banner.png" alt="Red Hat OpenShift Airgap Architect" /></div>
        <div className="header-actions">
          {yamlFiles ? <button type="button" className="ghost icon-button" onClick={() => setYamlFiles(null)} aria-label="Hide YAML">Hide YAML</button> : null}
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
                    <p className="subtle">Plan a supported disconnected update of an OpenShift {slice?.supportedMinors?.join(" / ") || "4.20 / 4.21 / 4.22"} cluster: the route from the update graph, the content to mirror per release, and the OSUS, CLI or web console steps. Architect never connects to or changes the cluster.</p>
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
                          {onOpenMirroring ? <Button variant="secondary" onClick={onOpenMirroring}>Open Mirroring</Button> : null}
                        </div>
                      </section>
                      <div>
                        {!plan ? (
                          <section className="card"><h3>Select or create a plan</h3><p className="subtle">Plans are independent: creating one never changes another, and Install and Mirroring are not affected.</p></section>
                        ) : (
                          <>
                            <div ref={tabAnchorRef} className="mirroring-tabs-anchor" aria-hidden="true" />
                            <div className="mirroring-tabs" role="tablist" aria-label={`${plan.name}: sections`}>
                              {TABS.map(([k, label], i) => (
                                <button key={k} ref={(el) => { tabRefs.current[k] = el; }} type="button" role="tab" id={`upgrade-tab-${k}`} aria-selected={tab === k} aria-controls={`upgrade-tabpanel-${k}`} tabIndex={tab === k ? 0 : -1} className={`mirroring-tab${tab === k ? " active" : ""}`} onClick={() => activateTab(k)} onKeyDown={(e) => onTabKey(e, i)}>{label}</button>
                              ))}
                            </div>
                            {TABS.map(([k]) => (
                              <div key={k} role="tabpanel" id={`upgrade-tabpanel-${k}`} aria-labelledby={`upgrade-tab-${k}`} hidden={tab !== k} className="mirroring-tabpanel">
                                {k === "path" ? <PathTab key={plan.id} plan={plan} supportedMinors={slice.supportedMinors} highSide={slice.highSide} onPlanChanged={onPlanChanged} /> : null}
                                {k === "operators" ? <OperatorsTab key={plan.id} plan={plan} onPlanChanged={onPlanChanged} /> : null}
                                {k === "content" ? <ContentTab key={plan.id} plan={plan} highSide={slice.highSide} onPlanChanged={onPlanChanged} /> : null}
                                {k === "instructions" && tab === k ? <InstructionsTab key={plan.id} plan={plan} /> : null}
                                {k === "readiness" && tab === k ? <ReadinessTab key={plan.id} plan={plan} onPlanChanged={onPlanChanged} /> : null}
                                {k === "review" && tab === k ? <ReviewTab key={plan.id} plan={plan} onPreviewArtifacts={(files) => setYamlFiles(files)} onDelete={() => openDelete(plan)} /> : null}
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
            {yamlFiles ? (
              <YamlDrawer
                isOpen
                onClose={() => setYamlFiles(null)}
                mode="imageset"
                sourceLabel={`Upgrade plan: ${plan?.name || ""}`}
                emptyMessage="No artifacts yet."
                previewFiles={Object.fromEntries(yamlFiles.filter((f) => f.content).map((f) => [f.name, f.content]))}
                statusNote="Labels are on the Review tab: validated configuration, template (fill in), or produced by a completed run."
                resetSizing={false}
                fetchExportFile={async (name) => yamlFiles.find((f) => f.name === name)?.content || ""}
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
          <label className="switch-row">
            <input type="checkbox" checked={removeStages} onChange={(e) => setRemoveStages(e.target.checked)} />
            <span>Also remove the {stageProfiles.length} stage profile record(s) from Mirroring (mirrored data on disk is still kept)</span>
          </label>
        ) : null}
      </ScopedConfirmModal>
    </div>
  );
}
