/**
 * OpenShift Airgap Architect - Mirroring profile operators (v2.2.0 M3)
 *
 * Operator catalog minor, catalog discovery, search/selection and per-operator
 * version constraints for ONE profile, built from the shared pieces the
 * Install Operators step uses (OperatorCatalogBrowser, SelectedOperatorCard,
 * OperatorVersionConstraints, operatorMinorReconciliation, the existing scan
 * engine) — not a second implementation.
 *
 * Catalog minor rules (revised at M3 acceptance, 2026-10-26):
 *  - Platform + operators: there is no selector. The server derives the
 *    catalog minor from the platform release minor; this section shows it and
 *    follows it. A platform-minor change during a scan makes that scan stale
 *    (its results are never applied) and offers to stop it.
 *  - Operators without platform: the user chooses a catalog minor; no default
 *    is invented.
 *  - A preserved conflict (an override saved before the revision, or an
 *    imported cross-minor configuration) is shown with an explicit choice:
 *    align the catalogs to the platform minor, or move the operators into
 *    their own profile. Nothing is rewritten until the user chooses.
 *  - Changing the minor turns resolved selections back into intent (package
 *    names), re-resolved from the new minor's catalogs when they load — the
 *    Install reconciliation semantics. Nothing is fabricated in between.
 *
 * Pull secrets typed here are kept in component memory for the scan request
 * only; they are never written to the profile.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Banner from "../components/Banner.jsx";
import Button from "../components/Button.jsx";
import Modal from "../components/Modal.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import SourceCredentialField from "./SourceCredentialField.jsx";
import { useSourceCredential } from "./sourceCredentialSession.js";
import CollapsibleSection from "../components/CollapsibleSection.jsx";
import OperatorCatalogBrowser from "../components/operators/OperatorCatalogBrowser.jsx";
import SelectedOperatorsPanel from "./SelectedOperatorsPanel.jsx";
import ScenarioQuickPicks from "../components/operators/ScenarioQuickPicks.jsx";
import { scenarios as QUICK_PICKS, applyScenarioPicks, removeScenarioPicks } from "../shared/operatorQuickPicks.js";
import OperatorVersionConstraints from "../components/operators/OperatorVersionConstraints.jsx";
import { SUPPORTED_MINORS } from "../shared/versionPolicy.js";
import { getOpenShiftMinorFromSources } from "../shared/openShiftMinor.js";
import {
  catalogImagesForMinor,
  buildInvalidatedOperatorState,
  reconcileOperatorsForMinor,
  isOperatorResolved
} from "../shared/operatorMinorReconciliation.js";
import { OPERATOR_CATALOG_IDS, OPERATOR_CATALOG_LABELS } from "../shared/operatorSearch.js";
import { useProfileCatalogs, scanFailureReason } from "./useProfileCatalogs.js";
import { updateProfile, reconcileCatalog } from "./mirroringApi.js";
import { CATALOG_MINOR_HINT, OPERATOR_SCAN_PULL_SECRET_HINT, CATALOGS_FOLLOW_PLATFORM } from "./mirroringCopy.js";

const SAVE_DEBOUNCE_MS = 300;

const toIntent = (selected) => buildInvalidatedOperatorState({ selected }).selected;

const isImported = (op) => (op.sources || []).some((src) => String(src).startsWith("import:"));

/**
 * An imported package names its catalog (Red Hat, certified or community).
 * When the file gave it no channel, resolve it ONLY within that catalog — the
 * shared name-based reconciliation would otherwise pick the first catalog
 * that has a package of that name. Returns the new list or null.
 */
const resolveImportedWithinCatalog = (selected, catalogs, minor) => {
  const images = catalogImagesForMinor(minor);
  let changed = false;
  const next = selected.map((op) => {
    if (isOperatorResolved(op) || !op.catalog || !isImported(op)) return op;
    const hit = (catalogs?.[op.catalog] || []).find((e) => String(e.name || "").toLowerCase() === String(op.name).toLowerCase());
    if (!hit?.defaultChannel) return op;
    changed = true;
    return { ...op, displayName: hit.displayName || op.displayName || null, defaultChannel: hit.defaultChannel, catalogImage: images[op.catalog] };
  });
  return changed ? next : null;
};

/** Mark selections found in the loaded catalogs for `minor` as verified there. */
const markVerified = (selected, catalogs, minor) => {
  const names = new Set(OPERATOR_CATALOG_IDS.flatMap((id) => (catalogs?.[id] || []).map((e) => String(e.name || "").toLowerCase())));
  let changed = false;
  const next = selected.map((op) => {
    const hit = names.has(String(op.name || "").toLowerCase());
    if (hit && isOperatorResolved(op) && op.verifiedMinor !== minor) {
      changed = true;
      return { ...op, verifiedMinor: minor };
    }
    return op;
  });
  return changed ? next : null;
};

/** True on narrow screens, where Browse and Selected share one column (R-UX06). */
const useNarrow = (query = "(max-width: 900px)") => {
  const get = () => typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches);
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    const mq = typeof window !== "undefined" ? window.matchMedia?.(query) : null;
    if (!mq) return undefined;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [query]);
  return narrow;
};

const OperatorsSection = ({ profile, onProfileChanged, onProfilesChanged = null, onShowOperations = null, onShowOperation = null }) => {
  const followsPlatform = profile.content.platform === true;
  const platformMinor = followsPlatform
    ? getOpenShiftMinorFromSources(profile.platform.release, profile.platform.version)
    : null;
  const reconciliation = profile.catalogReconciliation || null;
  const conflict = Boolean(reconciliation?.conflict);
  const [selected, setSelected] = useState(profile.operators.selected);
  // Operators-only: the user's choice, held locally so a scan dialog can defer it.
  // Platform + operators: always the server-derived value from the profile.
  const [localMinor, setLocalMinor] = useState(profile.operators.catalogMinor);
  const catalogMinor = followsPlatform ? profile.operators.catalogMinor : localMinor;
  // The profile's Red Hat source credential for this session (R-UX02): explicit
  // here, reusable for the catalog check and runs only where accepted.
  const scanCred = useSourceCredential(profile.id, "scan");
  const [saveError, setSaveError] = useState("");
  const [pendingMinor, setPendingMinor] = useState(null);
  const [reconciling, setReconciling] = useState(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const timerRef = useRef(null);
  const dirtyRef = useRef(null);
  const narrow = useNarrow();
  const [pane, setPane] = useState("browse");
  const [announce, setAnnounce] = useState("");

  const save = useCallback(async (body) => {
    try {
      const updated = await updateProfile(profile.id, { operators: body });
      setSaveError("");
      onProfileChanged(updated);
    } catch (e) {
      setSaveError(e.message || String(e));
    }
  }, [profile.id, onProfileChanged]);

  /** Debounced save of the selection list; minor changes save immediately. */
  const scheduleSelectedSave = (nextSelected) => {
    dirtyRef.current = nextSelected;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const body = { selected: dirtyRef.current };
      dirtyRef.current = null;
      save(body);
    }, SAVE_DEBOUNCE_MS);
  };
  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (dirtyRef.current) updateProfile(profile.id, { operators: { selected: dirtyRef.current } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const updateSelected = (next) => {
    setSelected(next);
    scheduleSelectedSave(next);
  };

  // The server derived a new catalog minor (platform release changed) or
  // reconciled a conflict: take its selection, which it already returned to
  // intent where the old minor no longer applies.
  const serverMinor = profile.operators.catalogMinor;
  const lastServerMinorRef = useRef(serverMinor);
  useEffect(() => {
    if (lastServerMinorRef.current === serverMinor) return;
    lastServerMinorRef.current = serverMinor;
    clearTimeout(timerRef.current);
    dirtyRef.current = null;
    setSelected(profile.operators.selected);
    if (!followsPlatform) setLocalMinor(serverMinor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverMinor]);

  // Catalogs for the CURRENT minor arrived: re-resolve preserved intent and
  // record which selections the live catalogs were seen to contain.
  const onCatalogsLoaded = useCallback((catalogs, minor) => {
    const pinned = resolveImportedWithinCatalog(selectedRef.current, catalogs, minor);
    const afterPinned = pinned || selectedRef.current;
    // Imported packages keep their own catalog: leave any still unresolved out
    // of the name-based pass rather than let it move them to another catalog.
    const held = afterPinned.filter((op) => !isOperatorResolved(op) && op.catalog && isImported(op));
    const rest = afterPinned.filter((op) => !held.includes(op));
    const reconciledRest = reconcileOperatorsForMinor({ selected: rest }, catalogs, minor);
    const reconciled = pinned || reconciledRest?.selected
      ? { selected: afterPinned.map((op) => (held.includes(op) ? op : (reconciledRest?.selected || rest)[rest.indexOf(op)])) }
      : null;
    const base = reconciled?.selected || selectedRef.current;
    const verified = markVerified(base, catalogs, minor);
    const next = verified || (reconciled?.selected ? base : null);
    if (next) {
      setSelected(next);
      clearTimeout(timerRef.current);
      dirtyRef.current = null;
      save({ selected: next });
    }
  }, [save]);

  // A conflict is not scanned or browsed until the user reconciles it.
  const cat = useProfileCatalogs({ profileId: profile.id, catalogMinor: conflict ? null : catalogMinor, onCatalogsLoaded });

  /** Operators-only: the user picks a catalog minor. */
  const applyMinor = useCallback(async (minor) => {
    const nextSelected = toIntent(selectedRef.current);
    clearTimeout(timerRef.current);
    dirtyRef.current = null;
    setLocalMinor(minor);
    lastServerMinorRef.current = minor;
    setSelected(nextSelected);
    await save({ catalogMinor: minor, catalogMinorSource: "user", selected: nextSelected });
  }, [save]);

  const requestMinor = (minor) => {
    if (!minor || minor === catalogMinor) return;
    if (cat.scanning) {
      setPendingMinor(minor);
      return;
    }
    applyMinor(minor);
  };

  const confirmPendingMinor = async (stopFirst) => {
    const minor = pendingMinor;
    setPendingMinor(null);
    if (stopFirst) await cat.stopScan();
    applyMinor(minor);
  };

  const reconcile = async (action) => {
    setReconciling(true);
    try {
      if (cat.scanning) await cat.stopScan();
      const result = await reconcileCatalog(profile.id, action);
      setSaveError("");
      if (result.newProfile && onProfilesChanged) await onProfilesChanged();
      onProfileChanged(result.profile);
    } catch (e) {
      setSaveError(e.message || String(e));
    } finally {
      setReconciling(false);
    }
  };

  const selectedIds = useMemo(() => new Set(selected.map((op) => op.id)), [selected]);

  const selectOperator = (op) => {
    if (selectedIds.has(op.id) || !catalogMinor) return;
    const images = catalogImagesForMinor(cat.catalogsMinor || catalogMinor);
    updateSelected([...selected, { ...op, catalogImage: images[op.catalog], sources: ["manual"] }]);
    setAnnounce(`Added ${op.displayName || op.name}. Selected: ${selected.length + 1}.`);
  };
  const removeOperator = (id) => {
    const gone = selected.find((op) => op.id === id);
    updateSelected(selected.filter((op) => op.id !== id));
    if (gone) setAnnounce(`Removed ${gone.displayName || gone.name}. Selected: ${selected.length - 1}.`);
  };
  const updateConstraint = (id, patch) => updateSelected(selected.map((op) => (op.id === id ? { ...op, ...patch } : op)));

  // Scenario Quick Picks (R-UX07): Install's definitions and selection logic,
  // applied to this profile's catalog minor and its SCANNED catalogs only.
  const [pickNotice, setPickNotice] = useState("");
  const picksReady = Boolean(catalogMinor && !conflict && cat.catalogs && cat.catalogsMinor === catalogMinor && OPERATOR_CATALOG_IDS.some((id) => cat.catalogs[id].length));
  const pickMatches = (item, found) => item.id === found.id
    || (String(item.name || "").toLowerCase() === String(found.name || "").toLowerCase() && (!item.catalog || item.catalog === found.catalog));
  const pickActive = (id) => selected.some((op) => (op.sources || []).includes(id) && isOperatorResolved(op));
  const pickPending = (id) => selected.some((op) => (op.sources || []).includes(id)) && !pickActive(id);
  const togglePick = (scenario) => {
    setPickNotice("");
    if (pickActive(scenario.id)) {
      const r = removeScenarioPicks({ selected, scenarioId: scenario.id });
      updateSelected(r.selected);
      setAnnounce(`Quick Pick ${scenario.label} removed. Operators you also chose yourself or through another source stay. Selected: ${r.selected.length}.`);
      return;
    }
    const r = applyScenarioPicks({ selected, scenario, minor: catalogMinor, catalogs: cat.catalogs || {}, catalogImages: catalogImagesForMinor(catalogMinor), matches: pickMatches });
    if (!r) { setPickNotice(`Quick Pick "${scenario.label}" is not defined for OpenShift ${catalogMinor}.`); return; }
    updateSelected(r.selected);
    setAnnounce(`Quick Pick ${scenario.label}: ${r.added.length} added. Selected: ${r.selected.length}.`);
    if (r.missing.length) setPickNotice(`${scenario.label}: ${r.missing.join(", ")} ${r.missing.length === 1 ? "is" : "are"} not in the scanned OpenShift ${catalogMinor} catalogs, so ${r.missing.length === 1 ? "it was" : "they were"} not added.`);
  };

  const unresolved = selected.filter((op) => !isOperatorResolved(op));
  const staleScan = cat.scanning && cat.scan?.minor && cat.scan.minor !== catalogMinor;
  const minorHelper = !catalogMinor
    ? "Choose the OpenShift minor whose operator catalogs you want."
    : `Operator catalogs for OpenShift ${catalogMinor} (index images tagged v${catalogMinor}).`;
  const scanStatusText = (catalogId) => {
    const s = cat.statuses[catalogId];
    if (!s) return cat.scanning ? "Waiting to start" : "Not scanned in this session";
    return `${s.status}${typeof s.progress === "number" ? ` • ${s.progress}%` : ""}`;
  };
  const hasCatalogs = cat.catalogs && OPERATOR_CATALOG_IDS.some((id) => cat.catalogs[id].length);
  // One shared reason is already in the scan banner; differing reasons are shown per catalog.
  const perCatalogReasons = new Set(OPERATOR_CATALOG_IDS.filter((id) => ["failed", "cancelled"].includes(cat.statuses[id]?.status)).map((id) => scanFailureReason(cat.statuses[id]))).size > 1;

  return (
    <section className="card" aria-labelledby={`mirroring-operators-heading-${profile.id}`}>
      <h3 id={`mirroring-operators-heading-${profile.id}`}>Operators</h3>
      {followsPlatform ? (
        <p className="card-subtitle mirroring-card-subtitle" id={`mirroring-catalogs-follow-${profile.id}`}>
          ℹ️ {CATALOGS_FOLLOW_PLATFORM}{" "}
          {conflict ? null : platformMinor
            ? <span>Catalog minor: <strong>OpenShift {catalogMinor || platformMinor}</strong>.</span>
            : <span>Select the platform release first.</span>}
        </p>
      ) : (
        <p className="card-subtitle mirroring-card-subtitle">
          Packages from the Red Hat, certified and community catalogs for the catalog minor below.
        </p>
      )}
      {saveError ? <Banner variant="error">Could not save operators for this profile: {saveError}</Banner> : null}

      {conflict ? (
        <Banner variant="warning">
          <div role="status">
            <strong>Operator catalogs and platform release differ.</strong> This profile&apos;s operators use the OpenShift{" "}
            {reconciliation.catalogMinor} catalogs ({reconciliation.source === "import" ? "from an imported file" : "chosen before catalogs followed the platform"}),
            but its platform release is OpenShift {reconciliation.platformMinor}. Nothing has been changed. This tool has not checked
            whether these operators run on either minor; choose how to continue:
          </div>
          <div className="actions">
            <Button variant="primary" disabled={reconciling} onClick={() => reconcile("align")}>
              Use the OpenShift {reconciliation.platformMinor} catalogs
            </Button>
            <Button variant="secondary" disabled={reconciling} onClick={() => reconcile("split")}>
              Move these operators to a new {reconciliation.catalogMinor} profile
            </Button>
          </div>
          <div className="subtle">
            Using the {reconciliation.platformMinor} catalogs keeps your operator names and resolves them again from those catalogs; channels
            and versions found only in {reconciliation.catalogMinor} are not carried over. Moving them keeps everything as it is, in its own
            operators-only profile.
          </div>
        </Banner>
      ) : null}

      {!followsPlatform ? (
        <div className="field-grid mirroring-name-grid">
          <div className="field-control-stack">
            <FieldLabelWithInfo label="Operator catalog minor" hint={CATALOG_MINOR_HINT} required className="label-emphasis">
              <select
                id={`mirroring-catalog-minor-${profile.id}`}
                className="control-enum"
                value={catalogMinor || ""}
                onChange={(e) => requestMinor(e.target.value)}
                aria-describedby={`mirroring-catalog-minor-help-${profile.id}`}
              >
                <option value="" disabled>Select a catalog minor</option>
                {SUPPORTED_MINORS.slice().reverse().map((m) => (
                  <option key={m} value={m}>OpenShift {m}</option>
                ))}
              </select>
            </FieldLabelWithInfo>
            <div className="field-control-support">
              <div className="field-helper" id={`mirroring-catalog-minor-help-${profile.id}`}>{minorHelper}</div>
            </div>
          </div>
        </div>
      ) : null}

      {staleScan ? (
        <Banner variant="warning">
          <span role="status">
            The catalog minor changed to OpenShift {catalogMinor || "(none)"} while catalogs for OpenShift {cat.scan.minor} were being
            scanned. That scan&apos;s results will not be applied to this profile.
          </span>{" "}
          <Button variant="secondary" className="mini" onClick={() => cat.stopScan()}>Stop the {cat.scan.minor} scan</Button>
        </Banner>
      ) : null}
      {cat.notice ? (
        <Banner variant="warning">
          {cat.notice}{" "}
          <Button variant="secondary" className="mini" onClick={cat.dismissNotice}>Dismiss</Button>
        </Banner>
      ) : null}
      {unresolved.length && !conflict ? (
        <div className="note warning" role="status">
          {unresolved.length} selected operator(s) are not resolved for catalog {catalogMinor || "(none)"}:{" "}
          {unresolved.map((op) => op.displayName || op.name).join(", ")}. They stay selected and are left out of the
          ImageSetConfiguration until the {catalogMinor || "selected"} catalogs are loaded and contain them.
        </div>
      ) : null}

      {catalogMinor && !conflict ? (
        <CollapsibleSection title="Catalog discovery" defaultCollapsed={Boolean(hasCatalogs)} wrapInCard={false}>
          <p className="subtle" style={{ marginTop: 0 }}>
            {hasCatalogs
              ? `Catalogs for OpenShift ${cat.catalogsMinor} are loaded${cat.cachedAt ? ` (scanned ${new Date(cat.cachedAt).toLocaleString()})` : ""}. Scan again only to refresh them.`
              : cat.loadingCached
                ? "Checking for previously scanned catalogs…"
                : `No scanned catalogs for OpenShift ${catalogMinor} yet. A scan reads the three catalog index images from Red Hat registries and takes several minutes. On a machine without internet access, scan on a connected machine instead.`}
          </p>
          <SourceCredentialField
            profileId={profile.id}
            site="scan"
            idPrefix={`mirroring-scan-${profile.id}`}
            label="Red Hat pull secret for this scan"
            hint={OPERATOR_SCAN_PULL_SECRET_HINT}
            mountedAvailable={cat.authAvailable}
            ariaLabel="Red Hat pull secret JSON for operator discovery"
          />
          {cat.scanError ? <Banner variant="warning">{cat.scanError}</Banner> : null}
          <div className="actions">
            <Button
              variant="primary"
              onClick={() => cat.startScan(scanCred.secret || undefined, { useMounted: cat.authAvailable && scanCred.mounted })}
              disabled={cat.scanning || !((cat.authAvailable && scanCred.mounted) || scanCred.secret)}
            >
              {cat.scanning ? `Scanning OpenShift ${cat.scan?.minor} catalogs…` : hasCatalogs ? "Scan again" : "Scan catalogs (several minutes)"}
            </Button>
            {cat.scanning ? <Button variant="secondary" onClick={() => cat.stopScan()}>Stop scan</Button> : null}
            {onShowOperations && (cat.scanning || Object.keys(cat.statuses).length) ? (
              <Button variant="secondary" onClick={() => onShowOperations()}>View in Operations</Button>
            ) : null}
          </div>
          {cat.scanning || Object.keys(cat.statuses).length ? (
            <div className="scan-status-list" role="status" aria-live="polite">
              {cat.reattached ? <p className="subtle" style={{ margin: 0 }}>Reconnected to the scan that was running before the page reloaded.</p> : null}
              {OPERATOR_CATALOG_IDS.map((id) => (
                <div key={id} className="scan-status-card">
                  <div className="scan-status-card-main">
                    <strong>{OPERATOR_CATALOG_LABELS[id]}</strong>
                    <span className="subtle scan-status-progress">{scanStatusText(id)}</span>
                  </div>
                  {perCatalogReasons && ["failed", "cancelled"].includes(cat.statuses[id]?.status) ? (
                    <div className="subtle scan-status-card-detail">{scanFailureReason(cat.statuses[id])}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </CollapsibleSection>
      ) : null}

      {catalogMinor && !conflict ? (
        <div className="mirroring-quick-picks" role="group" aria-labelledby={`mirroring-picks-heading-${profile.id}`}>
          <h4 id={`mirroring-picks-heading-${profile.id}`} className="mirroring-quick-picks-heading">Scenario Quick Picks</h4>
          <p className="subtle mirroring-quick-picks-subtitle">
            One-click presets for common operator sets, the same as in Install, for OpenShift {catalogMinor}. A pick adds only operators the scanned catalogs contain; removing it keeps operators you also chose yourself.
          </p>
          <ScenarioQuickPicks
            scenarios={QUICK_PICKS}
            version={catalogMinor}
            ready={picksReady}
            isActive={pickActive}
            isPending={pickPending}
            onToggle={togglePick}
            notReadyTitle={`Scan the OpenShift ${catalogMinor} catalogs first`}
          />
          {!picksReady ? <p className="note subtle">Quick Picks become available once the OpenShift {catalogMinor} catalogs are scanned (Catalog discovery above).</p> : null}
          {pickNotice ? <p className="note warning" role="status">{pickNotice}</p> : null}
        </div>
      ) : null}

      <div className={`mirroring-operator-workspace${narrow ? " is-narrow" : ""}`}>
        {narrow ? (
          <div className="mirroring-pane-switch" role="group" aria-label="Operators view">
            <Button variant="secondary" aria-pressed={pane === "browse"} onClick={() => setPane("browse")}>Browse</Button>
            <Button variant="secondary" aria-pressed={pane === "selected"} onClick={() => setPane("selected")}>Selected ({selected.length})</Button>
          </div>
        ) : null}
        <div className="mirroring-operator-browse" hidden={narrow && pane !== "browse"}>
          {catalogMinor && !conflict && (hasCatalogs || cat.loadingCached) ? (
            <OperatorCatalogBrowser
              catalogs={cat.catalogs || { redhat: [], certified: [], community: [] }}
              selectedIds={selectedIds}
              onSelect={selectOperator}
              loading={cat.loadingCached}
              idPrefix={`mirroring-${profile.id}`}
              title={`Available operators (OpenShift ${cat.catalogsMinor || catalogMinor})`}
            />
          ) : (
            <p className="note subtle">{conflict ? "Resolve the catalog minor above first." : catalogMinor ? "Scan the catalogs (Catalog discovery above) to browse the operators they contain." : "Choose the catalog minor first."}</p>
          )}
        </div>
        <div className="mirroring-operator-selected" hidden={narrow && pane !== "selected"}>
          <SelectedOperatorsPanel
            id={`mirroring-selected-${profile.id}`}
            profile={profile}
            selected={selected}
            onRemove={removeOperator}
            mountedAvailable={cat.authAvailable}
            onProfilesChanged={onProfilesChanged}
            onShowOperation={onShowOperation}
            catalogMinor={catalogMinor}
          />
        </div>
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      </div>

      {selected.some(isOperatorResolved) && !conflict ? (
        <CollapsibleSection title="Advanced: version constraints (optional)" defaultCollapsed={true} wrapInCard={false}>
          <p className="note">Limit the operator versions mirrored from each default channel. Leave blank to mirror the channel as published.</p>
          <OperatorVersionConstraints selected={selected.filter(isOperatorResolved)} onChange={updateConstraint} />
        </CollapsibleSection>
      ) : null}

      <Modal isOpen={Boolean(pendingMinor)} onClose={() => setPendingMinor(null)} ariaLabelledBy={`mirroring-minor-change-title-${profile.id}`}>
        <h3 id={`mirroring-minor-change-title-${profile.id}`}>Change the catalog minor during a scan?</h3>
        <p className="modal-copy subtle">
          A catalog scan for OpenShift {cat.scan?.minor} is still running. If you change the catalog minor to OpenShift{" "}
          {pendingMinor}, that scan&apos;s results become stale and will not be applied to this profile. Selected operators are
          kept and re-resolved from the OpenShift {pendingMinor} catalogs.
        </p>
        <div className="actions">
          <Button variant="primary" onClick={() => confirmPendingMinor(true)}>Stop the scan and change</Button>
          <Button variant="secondary" onClick={() => confirmPendingMinor(false)}>Change and let it finish in the background</Button>
          <Button variant="secondary" onClick={() => setPendingMinor(null)}>Keep OpenShift {catalogMinor}</Button>
        </div>
      </Modal>
    </section>
  );
};

export default OperatorsSection;
