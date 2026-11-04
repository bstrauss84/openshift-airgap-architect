import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api.js";
import { useApp } from "../store.jsx";
import { getVersionLocked } from "../shared/versionHelpers.js";
import { validateBlueprintPullSecretOptional } from "../validation.js";
import SecretInput from "../components/SecretInput.jsx";
import Button from "../components/Button.jsx";
import ReleaseSelector from "../components/ReleaseSelector.jsx";
import { useOpenShiftRelease } from "../hooks/useOpenShiftRelease.js";
import { listArchSupportForBlueprint, renderableArchitectures } from "../archSupportResolver.js";
import { reconcileMethodForPlatform } from "../../../shared/installMethods.js";

const archOptions = [
  { value: "x86_64", label: "x86_64", sub: "Intel/AMD" },
  { value: "aarch64", label: "aarch64", sub: "ARM64" },
  { value: "ppc64le", label: "ppc64le", sub: "IBM Power" },
  { value: "s390x", label: "s390x", sub: "IBM Z" }
];

/**
 * Target-cluster architecture support is resolved from the canonical D3 matrix
 * (`data/arch-support/<minor>.json`) via `archSupportResolver`. It is keyed by
 * OpenShift minor AND install method, and every cell carries a reason.
 *
 * This replaced a platform-keyed `PLATFORM_ARCH_SUPPORT` constant that had no
 * minor, no install method and no citation, and whose
 * `|| archOptions.map(...)` fallback opened all four architectures for any
 * unrecognised platform. See DOC-156.
 *
 * This is the TARGET-CLUSTER axis only. The `openshift-install` / `oc` /
 * `oc-mirror` download architecture on the Review step is a different axis and
 * is not governed by this matrix.
 *
 * WHICH CARDS EXIST, VERSUS WHICH ARE ENABLED (DOC-215)
 *
 * `archOptions` is the full set of architectures the product models. Two
 * separate questions are asked about it, and they must not be collapsed:
 *
 *   - ENABLED: does the CURRENTLY selected platform x method x minor offer it?
 *     `archSupportByValue` answers per card. A closed card still renders,
 *     disabled, carrying the matrix's own reason — e.g. aarch64 on vSphere,
 *     which the user can reach by switching to bare metal.
 *   - RENDERED AT ALL: is there ANY currently supported scenario, on any
 *     modelled platform x method pair at any supported minor, that offers it?
 *     `renderableArchitectures()` answers this from the same canonical matrix.
 *     An architecture with no such scenario can never be enabled by anything
 *     the user does, so a permanently dead control is misleading noise.
 *
 * Today that hides ppc64le (IBM Power) and s390x (IBM Z), because OAA models
 * no IBM Power or IBM Z platform. It is NOT a claim that OpenShift lacks
 * support for them — the matrix's `upstreamSupport` evidence is untouched, and
 * nothing here names an architecture. Onboard an IBM platform and mark a cell
 * `supported` and the card returns with no change to this file.
 */

const platformOptions = [
  { value: "Bare Metal", label: "Bare Metal", rec: "Rec: Agent" },
  { value: "VMware vSphere", label: "VMware vSphere", rec: "Rec: IPI" },
  { value: "Nutanix", label: "Nutanix", rec: "Rec: IPI" },
  { value: "AWS GovCloud", label: "AWS GovCloud", rec: "Rec: IPI" },
  { value: "Azure Government", label: "Azure Government", rec: "Rec: IPI" },
  { value: "IBM Cloud", label: "IBM Cloud", rec: "Rec: IPI" }
];

const BlueprintStep = ({ onRequestChangeRelease }) => {
  const { state, updateState } = useApp();
  const blueprint = state.blueprint;
  const release = state.release;
  const version = state.version || {};
  const locked = blueprint?.confirmed;
  const releaseLocked = getVersionLocked(state);

  // Release selection is shared with Mirroring (useOpenShiftRelease). This
  // adapter reproduces Blueprint's previous writes exactly, including the
  // install-domain side effect that marks operator selections stale whenever
  // the release changes. MUST stay the first hook with effects in this
  // component: its mount/abort effect is the lifecycle guard every later
  // effect here relies on (see useOpenShiftRelease).
  const releaseSelection = useOpenShiftRelease({
    release,
    version,
    locked: releaseLocked,
    writeRelease: (nextRelease, { manual } = {}) =>
      updateState(manual
        ? { release: nextRelease, operators: { ...state.operators, stale: true } }
        : { release: nextRelease }),
    writeVersion: (nextVersion) =>
      updateState({ version: nextVersion, operators: { ...state.operators, stale: true } }),
    onRefreshJobFailed: (jobId) => updateState({ ui: { ...(state.ui || {}), highlightJobId: jobId } })
  });
  const { mountedRef, abortRef } = releaseSelection;
  const [mountedSecretBadge, setMountedSecretBadge] = useState(false);

  const blueprintPullSecretRaw = state.blueprint?.blueprintPullSecretEphemeral ?? "";
  const blueprintPullSecretTrimmed = blueprintPullSecretRaw.trim();
  const blueprintPullSecretError = useMemo(() => {
    if (!blueprintPullSecretTrimmed) return "";
    const r = validateBlueprintPullSecretOptional(blueprintPullSecretTrimmed);
    return r.valid ? "" : r.error;
  }, [blueprintPullSecretTrimmed]);

  // Keyed by PLATFORM, not by the methodology in state. Methodology is a later
  // step, so on Blueprint `state.methodology.method` is the shipped default or
  // a stale choice from a previous platform. Keying on it made
  // `getScenarioId` return null for every platform that does not offer that
  // method — Nutanix, AWS GovCloud, Azure Government and IBM Cloud — and a null
  // scenario resolves to "no answer", which renders as every architecture
  // greyed out, x86_64 included. See listArchSupportForBlueprint.
  const archSupport = useMemo(
    () => listArchSupportForBlueprint(state),
    // Only the inputs the matrix is keyed by. Re-resolving on every state change
    // would rebuild the cells on each keystroke elsewhere in the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blueprint?.platform, state.methodology?.method, version?.selectedMinor, version?.selectedVersion, release?.channel, release?.patchVersion]
  );
  const archSupportByValue = useMemo(
    () => new Map(archSupport.cells.map((c, i) => [c.architecture ?? archOptions[i].value, c])),
    [archSupport]
  );
  const allowedArchs = archSupport.cells.filter((c) => c.offered).map((c, i) => c.architecture ?? archOptions[i].value);

  // Cards to render at all. Derived from the canonical matrix, not from a list
  // of architecture names here: an architecture no supported minor offers on
  // any modelled scenario cannot be enabled by any user action, so it is not
  // drawn. Independent of the current platform — see the header comment.
  const visibleArchOptions = useMemo(() => {
    const renderable = new Set(renderableArchitectures());
    return archOptions.filter((option) => renderable.has(option.value));
  }, []);

  /**
   * Selecting a platform also reconciles the installation method.
   *
   * Without this, state can hold a (platform, method) pair the product does not
   * model — e.g. Nutanix + Agent-Based Installer, reachable in one click from
   * the shipped defaults. That pair has no scenarioId, so the architecture
   * matrix, the step's own validation and the generator each have to invent an
   * answer for it. Reconciling at the point of change keeps the three layers
   * looking at the same scenario. The user's method is preserved whenever it is
   * still valid for the new platform; `MethodologyStep` applies the identical
   * rule from the same table.
   */
  const selectPlatform = (platform) => {
    const method = reconcileMethodForPlatform(platform, state.methodology?.method);
    // Same blueprint patch `updateBlueprint` applies, including clearing the
    // confirmation — changing the platform must re-open the lock-in.
    const patch = {
      blueprint: { ...blueprint, platform, confirmed: false, confirmationTimestamp: null },
    };
    if (method && method !== state.methodology?.method) {
      patch.methodology = { ...(state.methodology || {}), method };
    }
    updateState(patch);
  };

  const updateBlueprint = (patch) => {
    if (locked) return;
    updateState({ blueprint: { ...blueprint, ...patch, confirmed: false, confirmationTimestamp: null } });
  };

  // If the selected architecture stops being offered — because the platform, the
  // install method or the OpenShift minor changed — fall back to the first
  // architecture that IS offered rather than assuming x86_64 is always valid.
  // Nothing is reset while no architecture can be resolved: that state means
  // "not decidable yet", not "unsupported".
  useEffect(() => {
    if (locked) return;
    if (allowedArchs.length === 0) return;
    if (blueprint?.arch && !allowedArchs.includes(blueprint.arch)) {
      const next = allowedArchs.includes("x86_64") ? "x86_64" : allowedArchs[0];
      updateState({ blueprint: { ...blueprint, arch: next, confirmed: false, confirmationTimestamp: null } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedArchs.join(","), locked]);

  // Report whether a mounted Red Hat pull secret exists on the server.
  //
  // This used to follow up with /api/secrets/rh-pull-secret/content and
  // pre-fill the textarea below with the raw credential. That endpoint is
  // withdrawn: the backend has no authentication, so it handed the operator's
  // pull secret to anyone who could reach the API. The secret no longer
  // enters the browser at all.
  //
  // Only the boolean is fetched now, and it drives an informational badge.
  // The field is deliberately left empty — a mounted secret being present is
  // not the same as the operator having chosen to use it here.
  useEffect(() => {
    if (locked) return;
    const signal = abortRef.current?.signal;
    apiFetch("/api/secrets/rh-pull-secret", { signal })
      .then((d) => {
        if (!mountedRef.current) return;
        setMountedSecretBadge(Boolean(d.available));
      })
      .catch(() => {});
  }, []);

  return (
    <div className="step">
      <div className="step-header">
        <div className="step-header-main">
          <h2>Foundational selections</h2>
          <p className="subtle">Set target platform, architecture, and OpenShift release. These choices drive downstream steps.</p>
        </div>
      </div>

      <div className="step-body">
        {locked ? (
          <div className="note warning" style={{ marginBottom: 16 }}>
            {releaseLocked
              ? "Foundational selections are locked."
              : "Platform and architecture are locked. Edit the release below and confirm to proceed."}
          </div>
        ) : null}
        {/* PHX-033/035: the post-import follow-up notice now lives in App.jsx
            (ImportFollowUpNotice), above every step, and lists only what the
            imported run actually needs. */}
        <section className="card">
          <h3>Target Platform</h3>
          <div className="grid">
            {platformOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`select-card ${blueprint?.platform === option.value ? "selected" : ""}`}
                aria-pressed={blueprint?.platform === option.value}
                disabled={locked}
                onClick={() => selectPlatform(option.value)}
              >
                <div className="card-title">{option.label}</div>
                <div className="card-sub">{option.rec}</div>
                <span className="select-card-check" aria-hidden="true">✓ Selected</span>
              </button>
            ))}
          </div>
        </section>

        <section className="card">
          <h3>CPU Architecture</h3>
          <p className="card-subtitle" style={{ marginTop: 4, marginBottom: 12 }}>
            Target cluster host/node architecture (the machines that will run OpenShift). Not your local workstation or browser machine.
          </p>
          <div className="grid">
            {visibleArchOptions.map((option) => {
              const cell = archSupportByValue.get(option.value);
              const isSupported = Boolean(cell?.offered);
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`select-card ${blueprint?.arch === option.value ? "selected" : ""}`}
                  aria-pressed={blueprint?.arch === option.value}
                  disabled={locked || !isSupported}
                  // The matrix carries a reason for every closed cell, so the
                  // tooltip can name the OpenShift minor and the documentation
                  // instead of the old version-blind "Not supported on <platform>".
                  title={!isSupported ? cell?.summary || "Not available for this platform and installation method." : undefined}
                  onClick={() => updateBlueprint({ arch: option.value })}
                >
                  <div className="card-title">{option.label}</div>
                  <div className="card-sub">{option.sub}</div>
                  <span className="select-card-check" aria-hidden="true">✓ Selected</span>
                </button>
              );
            })}
          </div>
        </section>

        <ReleaseSelector
          selection={releaseSelection}
          release={release}
          idPrefix="blueprint"
          headerActions={locked && releaseLocked && onRequestChangeRelease ? (
            <Button variant="secondary" onClick={onRequestChangeRelease}>
              Change release
            </Button>
          ) : null}
          footer={(
            <p className="note note-prominent">
              Operator scans are blocked until you lock these selections.
              {releaseLocked ? " Release is locked." : ""}
            </p>
          )}
        />

        <section className="card pull-secret-section">
          <h3>Red Hat pull secret</h3>
          {mountedSecretBadge && !blueprintPullSecretTrimmed && (
            <div style={{
              display: "inline-block",
              marginBottom: 10,
              padding: "4px 10px",
              borderRadius: 4,
              fontSize: "0.8rem",
              background: "var(--card-bg-subtle, var(--card-bg))",
              border: "1px solid var(--border-color)",
              color: "var(--text-subtle)"
            }}>
              A mounted pull secret was detected on the server. Its contents are
              never sent to the browser. The mirror steps can authenticate with it
              directly — choose &ldquo;mounted&rdquo; there. Paste one here only to use a
              different secret.
            </div>
          )}
          <div className="pull-secret-layout">
            <div className="pull-secret-left">
              <SecretInput
                value={blueprintPullSecretRaw}
                onChange={(v) => {
                  // The badge now reports a server-side fact — whether a
                  // mounted secret exists — so it is no longer cleared by
                  // editing this field. Its visibility is driven by whether
                  // the field is empty, at the render site above.
                  updateBlueprint({ blueprintPullSecretEphemeral: v });
                }}
                label="Pull secret (JSON)"
                labelEmphasis="Pull secret (JSON)"
                labelHint="Not stored or exported. Optional; required only if you plan to include Operators in your mirror."
                getPullSecretUrl="https://console.redhat.com/openshift/downloads#tool-pull-secret"
                errorMessage={blueprintPullSecretError || undefined}
                disabled={locked}
                placeholder="Paste, drag and drop, or upload a Red Hat pull secret"
                rows={8}
                aria-label="Red Hat pull secret JSON"
              />
            </div>
            <div className="pull-secret-right">
              <p className="note note-prominent pull-secret-helper">
                Optional. Only required if you plan to include Operators in your mirror. Used only to fetch the latest Operator catalog metadata from Red Hat. Not stored or transmitted anywhere except to authenticate those requests.
              </p>
              {blueprintPullSecretTrimmed ? (
                <div className="blueprint-retain-row" style={{ marginTop: 16, width: "max-content", maxWidth: "100%" }}>
                  <span className="credentials-mirror-label" style={{ display: "block", marginBottom: 6 }}>
                    Retain pull secret for use on subsequent pages (kept in memory only; never saved or exported).
                  </span>
                  <label className="toggle-row" style={{ display: "flex", justifyContent: "flex-start", width: "100%" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(blueprint?.blueprintRetainPullSecret)}
                      onChange={(e) => updateBlueprint({ blueprintRetainPullSecret: e.target.checked })}
                      disabled={locked}
                      aria-describedby="retain-pull-secret-desc"
                    />
                    <span id="retain-pull-secret-desc" aria-hidden="true" />
                  </label>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default BlueprintStep;
