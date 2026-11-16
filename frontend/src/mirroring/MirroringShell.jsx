/**
 * OpenShift Airgap Architect - Mirroring workspace shell (v2.2.0 M2)
 *
 * The standalone Mirroring workflow. It renders OUTSIDE the Install wizard and
 * outside the Install VersionSupportGate: Mirroring does not need an Install
 * release, never loads Install catalogs, and an unsupported Install state
 * cannot lock the user out of it. Its own version boundary is per profile
 * (PlatformReleaseSection) and on the server (422 at every write).
 *
 * Profiles come from the server-owned /api/mirroring routes; nothing here is
 * persisted in browser storage except which view is open.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import Modal from "../components/Modal.jsx";
import ToolsDrawer from "../components/ToolsDrawer.jsx";
import YamlDrawer from "../components/YamlDrawer.jsx";
import ContentSelection from "./ContentSelection.jsx";
import ProfileWorkspace, { readinessTarget } from "./ProfileWorkspace.jsx";
import ImportDialog from "./ImportDialog.jsx";
import MirroringOperations from "./MirroringOperations.jsx";
import { ReceiveTransferForm } from "./HighSideControls.jsx";
import { contentLabel } from "./mirroringCopy.js";
import { useThemePreference } from "../hooks/useThemePreference.js";
import { apiFetch } from "../api.js";
import { UPDATE_STATUS } from "../../../shared/updateStatus.js";
import { useProfilePreview } from "./useProfilePreview.js";
import { forgetSourceCredential } from "./sourceCredentialSession.js";
import {
  fetchMirroring,
  createProfile,
  updateProfile,
  deleteProfile,
  setActiveProfile
} from "./mirroringApi.js";

// Which view is open (and which operation), kept for this browser tab only so a
// reload returns to the same place. No profile data or credential is stored.
const VIEW_KEY = "oaa.mirroring.view.v1";
const readView = () => {
  try {
    const v = JSON.parse(sessionStorage.getItem(VIEW_KEY) || "{}");
    return { view: v.view === "operations" ? "operations" : "profiles", jobId: typeof v.jobId === "string" ? v.jobId.slice(0, 64) : null };
  } catch {
    return { view: "profiles", jobId: null };
  }
};

const hasContent = (profile) => Boolean(profile && Object.values(profile.content || {}).some(Boolean));

const profileMeta = (profile) => {
  if (profile.kind === "received") return `Received from ${profile.origin?.profileName || profile.origin?.profileId} — disk to mirror`;
  const parts = [contentLabel(profile.content)];
  const patch = profile.platform?.release?.patchVersion;
  if (profile.content?.platform && patch) {
    parts.push(profile.platform.version?.locked ? `Release ${patch} (locked)` : `Release ${patch}`);
  }
  return parts.join(" — ");
};

const MirroringShell = ({ onExit }) => {
  const [theme, setTheme] = useThemePreference();
  const [status, setStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingContentFor, setEditingContentFor] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [yamlOpen, setYamlOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [buildInfo, setBuildInfo] = useState(null);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [viewState, setViewState] = useState(readView);
  const showView = useCallback((view, jobId = null) => {
    const next = { view, jobId };
    setViewState(next);
    try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(next)); } catch { /* storage unavailable: the view just is not remembered */ }
  }, []);

  // Same About data the Install shell shows in the shared Tools drawer.
  useEffect(() => {
    apiFetch("/api/build-info").then(setBuildInfo).catch(() => setBuildInfo({ gitSha: "unknown", buildTime: "unknown", repo: "", branch: "" }));
    apiFetch("/api/update-info").then(setUpdateInfo).catch(() => setUpdateInfo({ enabled: true, error: "Unavailable", updateStatus: UPDATE_STATUS.OFFLINE }));
  }, []);

  const applySlice = (slice) => {
    setProfiles(slice.profiles || []);
    setActiveId(slice.activeProfileId || null);
  };

  const load = useCallback(async (signal) => {
    setStatus("loading");
    setLoadError("");
    try {
      applySlice(await fetchMirroring({ signal }));
      setStatus("ready");
    } catch (e) {
      if (signal?.aborted) return;
      setLoadError(e.message || String(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /** Re-read the slice without a loading state (e.g. a profile was split off). */
  const refresh = useCallback(async () => {
    applySlice(await fetchMirroring());
  }, []);

  const active = profiles.find((p) => p.id === activeId) || null;
  const replaceProfile = useCallback((updated) => {
    setProfiles((list) => list.map((p) => (p.id === updated.id ? updated : p)));
  }, []);

  const run = async (fn) => {
    setActionError("");
    try {
      return await fn();
    } catch (e) {
      setActionError(e.message || String(e));
      return null;
    }
  };

  const newProfile = () => run(async () => {
    const created = await createProfile({ name: `Mirroring profile ${profiles.length + 1}` });
    setProfiles((list) => [...list, created]);
    setActiveId(created.id);
    setEditingContentFor(created.id);
  });

  const selectProfile = (id) => run(async () => {
    if (id === activeId) return;
    applySlice(await setActiveProfile(id));
    setEditingContentFor(null);
  });

  const submitContent = (profile, body) => run(async () => {
    setSaving(true);
    try {
      replaceProfile(await updateProfile(profile.id, body));
      setEditingContentFor(null);
    } finally {
      setSaving(false);
    }
  });

  const confirmDelete = () => run(async () => {
    const id = pendingDelete.id;
    setPendingDelete(null);
    await deleteProfile(id);
    // Its transient source credential goes with it (never kept for another profile).
    forgetSourceCredential(id);
    await load();
  });

  const showChooser = active && active.kind !== "received" && (editingContentFor === active.id || !hasContent(active));
  const previewProfile = active && !showChooser ? active : null;
  const preview = useProfilePreview(yamlOpen ? previewProfile : null);
  // The sticky step header's real height (it wraps on narrow screens and at high zoom): the
  // profile's content tabs stick right under it (owner C, 2026-11-03).
  const shellRef = useRef(null);
  const stepHeaderRef = useRef(null);
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
  }, []);
  // "Go to release lock" (and other blockers) from the YAML drawer opens the right tab in the workspace.
  const [focusRequest, setFocusRequest] = useState(null);
  const goToBlocker = (blocker) => {
    if (!previewProfile) return;
    const where = readinessTarget(previewProfile, blocker);
    if (where) setFocusRequest({ ...where, profileId: previewProfile.id, nonce: Date.now() });
  };
  const draftNotice = preview.draft ? (
    <>
      <strong>Draft — not runnable, not downloadable.</strong> This profile is not ready to generate its ImageSetConfiguration yet.
      {preview.draft.yaml ? " Shown below is what your current selection gives so far." : " Nothing can be shown yet."}
      <ul className="yaml-draft-blockers">
        {preview.draft.blockers.map((b) => {
          const where = previewProfile ? readinessTarget(previewProfile, b) : null;
          return (
            <li key={`${b.path}:${b.code || ""}`}>
              {b.message}{" "}
              {where ? <button type="button" className="ghost small" onClick={() => goToBlocker(b)}>{where.label}</button> : null}
            </li>
          );
        })}
        {preview.draft.omitted.map((o) => <li key={`omitted-${o.group}`} className="subtle">Not shown: {o.group === "additionalImages" ? "additional images" : o.group} ({o.reason}).</li>)}
      </ul>
      {preview.draft.error ? <div className="subtle">The draft could not be rendered: {preview.draft.error}</div> : null}
    </>
  ) : null;

  return (
    <div className="app-shell mirroring-shell" ref={shellRef}>
      <a href="#mirroring-main" className="skip-link">Skip to main content</a>
      <header className="app-header">
        <div className="brand">
          <img className="brand-banner" src="/airgap-architect-banner.png" alt="Red Hat OpenShift Airgap Architect" />
        </div>
        <div className="header-actions">
          {previewProfile ? (
            <button
              type="button"
              className="ghost icon-button"
              onClick={() => setYamlOpen((open) => !open)}
              title={yamlOpen ? "Hide YAML preview" : "Show YAML preview"}
              aria-label={yamlOpen ? "Hide YAML" : "Show YAML"}
            >
              {yamlOpen ? "Hide YAML" : "Show YAML"}
            </button>
          ) : null}
          <button
            type="button"
            className="ghost icon-button"
            onClick={() => setToolsOpen((open) => !open)}
            title="Tools: Home, theme and about"
            aria-label="Open Tools"
          >
            ⚙ Tools
          </button>
        </div>
      </header>
      <div className="app">
        <div className="content">
          <div className="main-layout" style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <main className="main" id="mirroring-main" aria-label="Mirroring" tabIndex={-1} style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
            <div className="step">
              <div className="step-header" ref={stepHeaderRef}>
                <div className="step-header-main">
                  <h2>Mirroring</h2>
                  <p className="subtle">
                    Plan oc-mirror v2 content in independent profiles. Each profile has its own content, OpenShift
                    release and server storage, separate from the Install workflow.
                  </p>
                </div>
                {status === "ready" ? (
                  <div className="mirroring-view-switch" role="group" aria-label="Mirroring view">
                    <Button variant="secondary" aria-pressed={viewState.view === "profiles"} onClick={() => showView("profiles")}>Profiles</Button>
                    <Button variant="secondary" aria-pressed={viewState.view === "operations"} onClick={() => showView("operations", viewState.jobId)}>Operations</Button>
                  </div>
                ) : null}
              </div>
              <div className="step-body">
                {actionError ? <Banner variant="error">{actionError}</Banner> : null}
                {status === "loading" ? (
                  <div className="loading" role="status">Loading mirroring profiles…</div>
                ) : null}
                {status === "error" ? (
                  <section className="card" role="alert">
                    <h3>Could not load mirroring profiles</h3>
                    <p>{loadError}</p>
                    <div className="actions">
                      <Button variant="primary" onClick={() => load()}>Retry</Button>
                    </div>
                  </section>
                ) : null}
                {status === "ready" && viewState.view === "operations" ? (
                  <MirroringOperations
                    profiles={profiles}
                    selectedJobId={viewState.jobId}
                    onSelect={(jobId) => showView("operations", jobId)}
                    onOpenProfile={(id) => { showView("profiles"); selectProfile(id); }}
                  />
                ) : null}
                {status === "ready" && viewState.view === "profiles" && profiles.length === 0 ? (
                  <section className="card" aria-labelledby="mirroring-empty-heading">
                    <h3 id="mirroring-empty-heading">No mirroring profiles yet</h3>
                    <p className="subtle">
                      A profile is one mirroring plan: the OpenShift platform release, operators and additional images
                      you want on the disconnected side. Create one to get started; you can keep several side by side.
                    </p>
                    <div className="actions">
                      <Button variant="primary" onClick={newProfile}>New profile</Button>
                      <Button variant="secondary" onClick={() => setImportOpen(true)}>Import YAML…</Button>
                      <Button variant="secondary" onClick={() => setReceiveOpen(true)}>Receive transfer…</Button>
                    </div>
                  </section>
                ) : null}
                {status === "ready" && viewState.view === "profiles" && profiles.length > 0 ? (
                  <div className="mirroring-layout">
                    <section className="card" aria-labelledby="mirroring-profiles-heading">
                      <h3 id="mirroring-profiles-heading">Profiles</h3>
                      <ul className="mirroring-profile-list">
                        {profiles.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              className={`select-card ${p.id === activeId ? "selected" : ""}`}
                              aria-pressed={p.id === activeId}
                              aria-describedby={`mirroring-profile-meta-${p.id}`}
                              onClick={() => selectProfile(p.id)}
                            >
                              <span className="card-title">{p.name}</span>
                              <span className="mirroring-profile-meta" id={`mirroring-profile-meta-${p.id}`}>{profileMeta(p)}</span>
                              <span className="select-card-check" aria-hidden="true">✓ Open</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="actions">
                        <Button variant="secondary" onClick={newProfile}>New profile</Button>
                        <Button variant="secondary" onClick={() => setImportOpen(true)}>Import YAML…</Button>
                        <Button variant="secondary" onClick={() => setReceiveOpen(true)}>Receive transfer…</Button>
                      </div>
                    </section>
                    <div className="mirroring-detail">
                      {!active ? (
                        <section className="card">
                          <h3>Select a profile</h3>
                          <p className="subtle">Choose a profile from the list to view or change it, or create a new one.</p>
                        </section>
                      ) : showChooser ? (
                        <ContentSelection
                          key={active.id}
                          profile={active}
                          saving={saving}
                          onSubmit={(body) => submitContent(active, body)}
                          onCancel={hasContent(active) ? () => setEditingContentFor(null) : null}
                        />
                      ) : (
                        <ProfileWorkspace
                          key={active.id}
                          profile={active}
                          onEditContent={() => setEditingContentFor(active.id)}
                          onDelete={() => setPendingDelete(active)}
                          onProfileChanged={replaceProfile}
                          onProfilesChanged={refresh}
                          onShowOperation={(jobId) => showView("operations", jobId)}
                          focusRequest={focusRequest}
                        />
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </main>
          {yamlOpen && previewProfile ? (
            <YamlDrawer
              isOpen={yamlOpen}
              onClose={() => setYamlOpen(false)}
              mode="imageset"
              sourceLabel={`Profile: ${previewProfile.name}`}
              emptyMessage={preview.draft
                ? "Nothing to preview yet: the content selected so far cannot be rendered. Resolve the items above."
                : preview.notReady.length
                ? `This profile is not ready to generate yet: ${preview.notReady.join(" ")}`
                : "Select content for this profile to generate its ImageSetConfiguration."}
              previewFiles={preview.yaml ? { "imageset-config.yaml": preview.yaml } : preview.draft?.yaml ? { "imageset-config.yaml": preview.draft.yaml } : {}}
              draftNotice={draftNotice}
              statusNote={preview.yaml && preview.validation ? preview.validation.summary : null}
              loading={preview.loading}
              error={preview.error}
              stale={preview.stale}
              resetSizing={false}
              fetchExportFile={preview.fetchForDownload}
            />
          ) : null}
          </div>
        </div>
      </div>
      <ImportDialog
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        activeProfile={active && hasContent(active) ? active : null}
        onImported={(result) => {
          applySlice(result);
          setEditingContentFor(null);
        }}
      />
      <ToolsDrawer
        isOpen={toolsOpen}
        onClose={() => setToolsOpen(false)}
        theme={theme}
        setTheme={setTheme}
        onHome={onExit}
        workflowLabel="Mirroring"
        buildInfo={buildInfo}
        updateInfo={updateInfo}
      />
      <Modal isOpen={receiveOpen} onClose={() => setReceiveOpen(false)} ariaLabelledBy="mirroring-receive-title">
        <h3 id="mirroring-receive-title">Receive a transfer</h3>
        <p className="modal-copy">
          Use this on the disconnected side. A <strong>transfer</strong> is the set of files made on the connected side by
          Mirror to disk and Prepare transfer — the mirror_*.tar archives, SHA256SUMS and the oaa-transfer folder — that you
          carried across the air gap on a drive or share.
        </p>
        <p className="modal-copy subtle">
          Name the folder on this server where you copied those files. Architect checks that every file arrived complete and
          unchanged, then makes the transfer available to Disk to mirror, which uploads the verified archive contents into your registry. The transfer goes
          into the profile it came from if this server has it, otherwise into a new profile named "Received: …".
        </p>
        <ReceiveTransferForm
          idPrefix="mirroring-receive-modal"
          currentProfileId={activeId}
          onReceived={() => refresh()}
          onOpenProfile={(meta) => { setReceiveOpen(false); selectProfile(meta.profileId); }}
        />
        <div className="actions">
          <Button variant="secondary" onClick={() => setReceiveOpen(false)}>Close</Button>
        </div>
      </Modal>
      <Modal isOpen={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)} ariaLabelledBy="mirroring-delete-title">
        <h3 id="mirroring-delete-title">Delete profile</h3>
        <p className="modal-copy subtle">
          Delete &ldquo;{pendingDelete?.name}&rdquo;? Its selections are removed. Mirrored data already written to its
          archive, workspace and cache directories on the server is not deleted.
        </p>
        <div className="actions">
          <Button variant="secondary" onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button variant="destructive" onClick={confirmDelete}>Delete profile</Button>
        </div>
      </Modal>
    </div>
  );
};

export default MirroringShell;
