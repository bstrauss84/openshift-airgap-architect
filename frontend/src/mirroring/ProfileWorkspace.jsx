/**
 * OpenShift Airgap Architect - Mirroring profile workspace (v2.2.0 M2)
 *
 * The open profile: what it contains, the platform release when platform
 * content is selected, and where its data lives on the server. Sections that
 * later tranches deliver say so plainly instead of rendering controls that do
 * nothing.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import PlatformReleaseSection from "./PlatformReleaseSection.jsx";
import OperatorsSection from "./OperatorsSection.jsx";
import AdditionalImagesEditor from "./AdditionalImagesEditor.jsx";
import ImportedFilesCard from "./ImportedFilesCard.jsx";
import { contentLabel } from "./mirroringCopy.js";
import { fetchOperations } from "./mirroringApi.js";

// Run controls (M5) load on demand: they are only needed once a profile is open.
const MirroringRunPanel = React.lazy(() => import("./MirroringRunPanel.jsx"));

/**
 * Where the profile stands (M4, M5), in the order a user must act:
 * needs review -> not ready -> structure valid, catalogs not verified ->
 * ready to mirror to disk. Structural validity is never shown as proof that
 * packages or channels exist.
 */
export const profileStatus = (profile) => {
  const readiness = profile.readiness || [];
  if (profile.kind === "received") {
    return profile.received?.length
      ? { key: "ready", label: "Received — ready for disk to mirror", detail: "Load the received transfer into your registry below. Its content is the transfer's and is not edited here." }
      : { key: "not-ready", label: "Waiting for a transfer", detail: "Receive a transfer from the low side below." };
  }
  if (readiness.some((r) => r.code === "IMPORT_REVIEW_REQUIRED" || r.code === "CATALOG_PLATFORM_MINOR_CONFLICT")) {
    return { key: "review", label: "Needs review", detail: "Resolve the items marked below before this profile can be generated." };
  }
  if (readiness.length) return { key: "not-ready", label: "Not ready", detail: "Complete the items listed below." };
  const ops = profile.content.operators ? profile.operators.selected.filter((op) => op.catalogImage && op.defaultChannel) : [];
  const missing = ops.filter((op) => op.verification && ["package-not-found", "channel-not-found"].includes(op.verification.status));
  if (missing.length) {
    return {
      key: "review",
      label: "Needs review — not in the live catalogs",
      detail: `${missing.length} operator(s) were not found with their channel in the live catalogs at the last check. Change the selection or check again; mirroring is blocked until then.`
    };
  }
  const unverified = ops.filter((op) => op.verifiedMinor !== profile.operators.catalogMinor);
  if (unverified.length) {
    return {
      key: "awaiting-verification",
      label: "Structure valid — catalogs not verified",
      detail: `${unverified.length} operator(s) have not been seen in the OpenShift ${profile.operators.catalogMinor} catalogs yet. Use Check catalogs below; on a machine without internet access this cannot be checked here, so verify on a connected machine before mirroring.`
    };
  }
  return { key: "ready", label: "Structure valid — ready to mirror to disk", detail: "Run the preflight below, then mirror to disk." };
};

/** What the generated file will contain, per content type (selected / not selected / unresolved). */
const contentRows = (profile) => {
  const c = profile.content;
  const ops = profile.operators?.selected || [];
  const resolved = ops.filter((op) => op.catalogImage && op.defaultChannel).length;
  return [
    ["OpenShift platform", c.platform
      ? (profile.platform.release.patchVersion
        ? `Included: release ${profile.platform.release.patchVersion}${profile.platform.version.locked ? " (locked)" : " (not locked yet)"}`
        : "Selected: no release chosen yet")
      : "Not selected"],
    ["Operators", c.operators
      ? `Catalog ${profile.operators.catalogMinor || "not chosen"}: ${resolved} included${ops.length - resolved ? `, ${ops.length - resolved} not resolved (left out)` : ""}`
      : "Not selected"],
    ["Additional images", c.additionalImages ? `${profile.additionalImages.length} included` : "Not selected"],
    ...(profile.options?.archiveSize ? [["Archive size", `${profile.options.archiveSize} GiB per archive file`]] : [])
  ];
};

/** A profile created from a low-side transfer (M6): where it came from; nothing to edit. */
const ReceivedOrigin = ({ profile }) => {
  const o = profile.origin;
  const latest = profile.received?.at(-1);
  return (
    <dl className="mirroring-paths mirroring-content-summary" aria-label="Received from">
      <dt>Low-side profile</dt><dd>{o.profileName || o.profileId} ({o.profileId})</dd>
      <dt>First plan</dt><dd>{o.planId}</dd>
      {latest ? <><dt>Latest transfer</dt><dd>{latest.planId}: {latest.summary || "content as recorded"}</dd></> : null}
      {latest?.toolVersion ? <><dt>Made with</dt><dd>oc-mirror {latest.toolVersion}</dd></> : null}
    </dl>
  );
};

const STATUS_WORDS = { queued: "Queued", running: "Running", completed: "Completed", completed_with_warnings: "Completed with warnings", failed: "Failed", cancelled: "Stopped" };

/** The selected tab per profile, for this page (switching profiles and back keeps it). */
const tabMemory = new Map();

/**
 * The workspace's tabs (R-UX01): one per selected content type plus Run &
 * transfers; a single-content profile gets Content | Run & transfers; a
 * received profile has nothing to edit, so no tabs.
 */
export const workspaceTabs = (profile) => {
  if (profile.kind === "received") return [];
  const c = profile.content;
  const ops = profile.operators?.selected?.length || 0;
  const imgs = profile.additionalImages?.length || 0;
  const content = [
    c.platform ? { id: "platform", label: "Platform" } : null,
    c.operators ? { id: "operators", label: `Operators · ${ops}` } : null,
    c.additionalImages ? { id: "additionalImages", label: `Additional images · ${imgs}` } : null
  ].filter(Boolean);
  const run = { id: "run", label: "Run & transfers" };
  if (content.length <= 1) return [{ id: "content", label: "Content", single: content[0]?.id || null }, run];
  return [...content, run];
};

/** Which tab (and element) a readiness item belongs to. */
export const readinessTarget = (profile, item) => {
  const tabs = workspaceTabs(profile);
  const tabFor = (contentId) => (tabs.some((t) => t.id === contentId) ? contentId : tabs.some((t) => t.single === contentId) ? "content" : null);
  const p = String(item.path || "");
  if (p === "platform.version.locked") return { tab: tabFor("platform"), target: `mirroring-lock-${profile.id}`, fallback: `mirroring-release-${profile.id}`, label: "Go to release lock" };
  if (p.startsWith("platform")) return { tab: tabFor("platform"), target: `mirroring-release-${profile.id}`, label: "Go to the release" };
  if (p.startsWith("operators")) return { tab: tabFor("operators"), target: `mirroring-operators-heading-${profile.id}`, label: "Go to operators" };
  if (p.startsWith("additionalImages")) return { tab: tabFor("additionalImages"), target: `mirroring-images-${profile.id}`, label: "Go to additional images" };
  if (p.startsWith("imports.")) return { tab: null, target: `mirroring-imports-${profile.id}`, label: "Go to the imported file" };
  return null;
};

/** Problems per tab, for the badge (visible blockers survive the tabs). */
const blockersPerTab = (profile) => {
  const out = {};
  for (const r of profile.readiness || []) {
    const t = readinessTarget(profile, r)?.tab;
    if (t) out[t] = (out[t] || 0) + 1;
  }
  return out;
};

/** The element that scrolls the page around `el` (Mirroring: #mirroring-main), or null. */
const scrollParentOf = (el) => {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    if (n.id === "mirroring-main") return n;
    const oy = typeof window !== "undefined" ? window.getComputedStyle(n).overflowY : "";
    if (/(auto|scroll)/.test(oy) && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
};

/**
 * After a deliberate tab switch (owner, 2026-11-03): if the reader had scrolled
 * past the tab row, bring the row back to its natural place right under the
 * sticky header, so the new panel starts directly beneath it — a short panel
 * no longer leaves an empty screen. Near the top nothing moves. `anchor` is a
 * zero-height marker just above the (sticky) tab row, so it shows where the
 * row sits in the flow. Instant: no animation to reduce or wait for.
 * @returns {boolean} whether it scrolled
 */
export function revealTabStart(anchor) {
  const main = scrollParentOf(anchor);
  if (!anchor || !main) return false;
  const headerH = parseFloat(window.getComputedStyle(anchor).getPropertyValue("--mirroring-header-h")) || 0;
  const offset = anchor.getBoundingClientRect().top - (main.getBoundingClientRect().top + headerH);
  if (offset >= -1) return false; // the row is still in its own place: keep the reader's position
  main.scrollTop = Math.max(0, main.scrollTop + offset);
  return true;
}

/** One line about this profile's newest operation; the full history is in Operations (R-UX08). */
function LatestActivity({ profileId, onShowOperation }) {
  const [latest, setLatest] = useState(undefined);
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const load = async () => {
      try {
        const data = await fetchOperations();
        if (cancelled) return;
        const mine = (data.operations || []).filter((o) => o.profileId === profileId);
        const newest = mine[0] || null;
        setLatest(newest);
        timer = setTimeout(load, newest && ["queued", "running"].includes(newest.status) ? 4000 : 15000);
      } catch {
        if (!cancelled) setLatest((cur) => (cur === undefined ? null : cur));
      }
    };
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [profileId]);
  if (latest === undefined) return null;
  return (
    <p className="subtle mirroring-latest-activity" role="status">
      {latest
        ? <><strong>Latest activity:</strong> {latest.title || latest.kind} · {STATUS_WORDS[latest.status] || latest.status} · {new Date(Number(latest.startedAt || latest.createdAt)).toLocaleString()}{" "}</>
        : <>No activity yet. Scans, catalog checks, runs and transfers of this profile are listed in Operations.{" "}</>}
      {latest && onShowOperation ? <Button variant="secondary" className="mini" onClick={() => onShowOperation(latest.jobId)}>View in Operations</Button> : null}
    </p>
  );
}

const ProfileWorkspace = ({ profile, onEditContent, onDelete, onProfileChanged, onProfilesChanged = null, onShowOperation = null, focusRequest = null }) => {
  const c = profile.content;
  const status = profileStatus(profile);
  const received = profile.kind === "received";
  const tabs = workspaceTabs(profile);
  const [tab, setTabState] = useState(() => {
    const remembered = tabMemory.get(profile.id);
    return tabs.some((t) => t.id === remembered) ? remembered : tabs[0]?.id || null;
  });
  // Content changed (e.g. a type removed): fall back to the first tab.
  const activeTab = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id || null;
  const setTab = useCallback((id) => { tabMemory.set(profile.id, id); setTabState(id); }, [profile.id]);
  // Deliberate tab activations (click, keyboard) reveal the new panel's start; programmatic
  // switches (Go to, focus requests) scroll to their own target instead.
  const tabAnchorRef = useRef(null);
  const [revealRequest, setRevealRequest] = useState(0);
  const activateTab = useCallback((id) => { setTab(id); setRevealRequest((n) => n + 1); }, [setTab]);
  useLayoutEffect(() => { if (revealRequest) revealTabStart(tabAnchorRef.current); }, [revealRequest]);
  const tabRefs = useRef({});
  const blockers = blockersPerTab(profile);

  /** Open the tab that holds `target`, then bring it into view and focus it. */
  const goTo = useCallback((where) => {
    if (!where) return;
    if (where.tab) setTab(where.tab);
    setTimeout(() => {
      // A disabled or not-yet-rendered control cannot take focus: use its section instead.
      let el = where.target ? document.getElementById(where.target) : null;
      if ((!el || el.disabled) && where.fallback) el = document.getElementById(where.fallback);
      if (!el) return;
      el.scrollIntoView?.({ block: "center" });
      if (typeof el.focus === "function") el.focus({ preventScroll: true });
    }, 0);
  }, [setTab]);

  // A request from outside (the YAML drawer's "Go to release lock").
  useEffect(() => {
    if (focusRequest?.profileId === profile.id) goTo(focusRequest);
  }, [focusRequest, profile.id, goTo]);

  const onTabKey = (e, index) => {
    const keys = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const next = tabs[(keys[e.key] + tabs.length) % tabs.length];
    activateTab(next.id);
    tabRefs.current[next.id]?.focus({ preventScroll: true });
  };

  const contentPanel = (id) => {
    if (id === "platform") return <div id={`mirroring-release-${profile.id}`} tabIndex={-1}><PlatformReleaseSection profile={profile} onProfileChanged={onProfileChanged} /></div>;
    if (id === "operators") return <OperatorsSection profile={profile} onProfileChanged={onProfileChanged} onProfilesChanged={onProfilesChanged} onShowOperations={onShowOperation ? () => onShowOperation(null) : null} onShowOperation={onShowOperation} />;
    if (id === "additionalImages") return <div id={`mirroring-images-${profile.id}`} tabIndex={-1}><AdditionalImagesEditor profile={profile} onProfileChanged={onProfileChanged} /></div>;
    return null;
  };
  const runPanel = (
    <Suspense fallback={<section className="card"><p className="loading" role="status">Loading run controls…</p></section>}>
      <MirroringRunPanel profile={profile} onProfileChanged={onProfileChanged} onProfilesChanged={onProfilesChanged} onShowOperation={onShowOperation} />
    </Suspense>
  );

  return (
    <>
      <section className="card" aria-labelledby="mirroring-profile-heading">
        <h3 id="mirroring-profile-heading">{profile.name}</h3>
        <p className="card-subtitle mirroring-card-subtitle">{contentLabel(c)}</p>
        <div className="card-body">
          <p className={`mirroring-status mirroring-status-${status.key}`} role="status">
            <strong>Status: {status.label}.</strong> {status.detail}
          </p>
          {received ? <ReceivedOrigin profile={profile} /> : (
            <dl className="mirroring-paths mirroring-content-summary" aria-label="Generated content">
              {contentRows(profile).map(([k, v]) => (
                <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>
              ))}
            </dl>
          )}
          {profile.readiness?.length && !received ? (
            <div className="note" role="status">
              <strong>Before this profile&apos;s ImageSetConfiguration can be generated:</strong>
              <ul className="mirroring-readiness-list">
                {profile.readiness.map((r) => {
                  const where = readinessTarget(profile, r);
                  return (
                    <li key={`${r.path}:${r.code || ""}`}>
                      {r.message}{" "}
                      {where ? <Button variant="secondary" className="mini" onClick={() => goTo(where)}>{where.label}</Button> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <LatestActivity profileId={profile.id} onShowOperation={onShowOperation} />
          <div className="actions">
            {!received ? <Button variant="secondary" onClick={onEditContent}>Change name or content</Button> : null}
            <Button variant="destructive" onClick={onDelete}>Delete profile</Button>
          </div>
        </div>
      </section>

      {!received ? <div id={`mirroring-imports-${profile.id}`} tabIndex={-1}><ImportedFilesCard profile={profile} onProfileChanged={onProfileChanged} /></div> : null}

      {tabs.length ? (
        <>
          <div ref={tabAnchorRef} className="mirroring-tabs-anchor" aria-hidden="true" />
          <div className="mirroring-tabs" role="tablist" aria-label={`${profile.name}: sections`}>
            {tabs.map((t, index) => (
              <button
                key={t.id}
                ref={(el) => { tabRefs.current[t.id] = el; }}
                type="button"
                role="tab"
                id={`mirroring-tab-${profile.id}-${t.id}`}
                aria-selected={activeTab === t.id}
                aria-controls={`mirroring-tabpanel-${profile.id}-${t.id}`}
                tabIndex={activeTab === t.id ? 0 : -1}
                className={`mirroring-tab${activeTab === t.id ? " active" : ""}`}
                onClick={() => activateTab(t.id)}
                onKeyDown={(e) => onTabKey(e, index)}
              >
                {t.label}
                {blockers[t.id] ? <span className="mirroring-tab-badge"> · {blockers[t.id]} to fix</span> : null}
              </button>
            ))}
          </div>
          {tabs.map((t) => (
            // Every panel stays mounted (hidden, not removed): switching tabs keeps
            // typed values, running scans, checks and runs, and their polling.
            <div
              key={t.id}
              role="tabpanel"
              id={`mirroring-tabpanel-${profile.id}-${t.id}`}
              aria-labelledby={`mirroring-tab-${profile.id}-${t.id}`}
              hidden={activeTab !== t.id}
              className="mirroring-tabpanel"
            >
              {t.id === "run" ? runPanel : t.id === "content" ? contentPanel(t.single) : contentPanel(t.id)}
            </div>
          ))}
        </>
      ) : runPanel}
    </>
  );
};

export default ProfileWorkspace;
