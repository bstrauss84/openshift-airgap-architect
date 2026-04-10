import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, API_BASE } from "../api.js";
import { useApp, getStateForPersistence } from "../store.jsx";
import { validateStep } from "../validation.js";
import { getExportRunFilename } from "../exportRunFilename.js";
import { logAction } from "../logger.js";
import Switch from "../components/Switch.jsx";
import OptionRow from "../components/OptionRow.jsx";
import CollapsibleSection from "../components/CollapsibleSection.jsx";
import Banner from "../components/Banner.jsx";
import Button from "../components/Button.jsx";

const DEFAULT_PREVIEW_HEIGHT = 320;
const MIN_PREVIEW_HEIGHT = 120;
const MAX_PREVIEW_HEIGHT = 800;

const PULLSECRET_PLACEHOLDER_LINE = "pullSecret: '{\"auths\":{}}'";
const SENSITIVE_REDACTED = "*** REDACTED (click Show sensitive values to reveal) ***";
const DOWNLOAD_REVOKE_DELAY_MS = 60 * 60 * 1000;

function triggerBrowserDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, DOWNLOAD_REVOKE_DELAY_MS);
}

/** Masks or replaces pullSecret value in install-config YAML. For obscured preview use replacement; for placeholder use replacement. */
function replacePullSecretInYaml(yamlContent, replacementLine) {
  if (!yamlContent || typeof yamlContent !== "string") return yamlContent;
  const lines = yamlContent.split("\n");
  const i = lines.findIndex((line) => /^pullSecret:\s*/.test(line));
  if (i < 0) return yamlContent;
  let j = i + 1;
  while (j < lines.length && (lines[j].startsWith(" ") || lines[j].startsWith("\t") || lines[j].trim() === "")) j++;
  const before = lines.slice(0, i).join("\n");
  const after = (j < lines.length ? "\n" : "") + lines.slice(j).join("\n");
  return before + "\n" + replacementLine + after;
}

function maskPullSecretInYaml(yamlContent) {
  return replacePullSecretInYaml(yamlContent, `pullSecret: '${SENSITIVE_REDACTED}'`);
}

/** Redacts platform.vsphere.vcenters[].user and .password in install-config YAML for preview. */
function maskVsphereCredentialsInYaml(yamlContent) {
  if (!yamlContent || typeof yamlContent !== "string") return yamlContent;
  const lines = yamlContent.split("\n");
  let inVsphere = false;
  let inVcenters = false;
  const result = lines.map((line) => {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    if (/^\s*vsphere:\s*$/.test(line)) {
      inVsphere = true;
      inVcenters = false;
    } else if (inVsphere && indent <= 2) {
      inVsphere = false;
      inVcenters = false;
    } else if (inVsphere && /^\s*vcenters:\s*$/.test(line)) {
      inVcenters = true;
    } else if (inVsphere && inVcenters && indent <= 4 && trimmed && !trimmed.startsWith("-")) {
      inVcenters = false;
    }
    if (inVcenters && /^\s*(user|password):\s*.+/.test(line)) {
      return line.replace(/^(\s*(?:user|password):\s*).+$/, `$1'${SENSITIVE_REDACTED}'`);
    }
    return line;
  });
  return result.join("\n");
}

/** Masks pull secret and vCenter credentials in install-config for Assets preview when "Show sensitive values" is off. */
function maskSensitiveInInstallConfigYaml(yamlContent) {
  if (!yamlContent || typeof yamlContent !== "string") return yamlContent;
  let out = maskPullSecretInYaml(yamlContent);
  out = maskVsphereCredentialsInYaml(out);
  return out;
}

function ResizablePreviewPane({ id, content, placeholder = "Not generated yet.", className = "preview" }) {
  const [height, setHeight] = useState(() => DEFAULT_PREVIEW_HEIGHT);
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const hasContent = content && String(content).trim() && content !== placeholder;

  const onMouseDown = useCallback(
    (e) => {
      if (!hasContent) return;
      e.preventDefault();
      setDragging(true);
      startYRef.current = e.clientY;
      startHeightRef.current = height;
    },
    [hasContent, height]
  );

  useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (e) => {
      const dy = e.clientY - startYRef.current;
      const next = Math.min(MAX_PREVIEW_HEIGHT, Math.max(MIN_PREVIEW_HEIGHT, startHeightRef.current + dy));
      setHeight(next);
    };
    const onMouseUp = () => setDragging(false);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging]);

  if (!hasContent) {
    return <pre className={className}>{content || placeholder}</pre>;
  }

  return (
    <div className="review-preview-resizable" style={{ height: `${height}px` }}>
      <pre className={className} style={{ height: "100%", maxHeight: "none" }}>
        {content}
      </pre>
      <div
        role="separator"
        aria-label="Resize preview"
        className="review-preview-resize-handle"
        onMouseDown={onMouseDown}
      />
    </div>
  );
}

const triggerNativeDownload = (url) => {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => anchor.remove(), 1000);
};

const downloadZip = async (stateForBundle) => {
  const prep = await apiFetch("/api/bundle.prepare", {
    method: "POST",
    body: JSON.stringify({ state: stateForBundle || null })
  });
  if (!prep?.token) {
    throw new Error("Failed to prepare bundle download token.");
  }
  const downloadUrl = `${API_BASE}/api/bundle.zip?token=${encodeURIComponent(prep.token)}`;
  triggerNativeDownload(downloadUrl);
};

const ReviewStep = ({ incompleteStepLabels = [], onRequestStartOver, capabilities = {}, profileContract = {} }) => {
  const { state, updateState, setState } = useApp();
  const importRef = useRef(null);
  const exportOptions = state.exportOptions || {};
  const [files, setFiles] = useState({});
  const [loading, setLoading] = useState(false);
  const [docsUpdating, setDocsUpdating] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [generateError, setGenerateError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [showCredentialsConfirm, setShowCredentialsConfirm] = useState(false);
  const [credentialsConfirmedThisSession, setCredentialsConfirmedThisSession] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef(null);
  const needsReview = state.reviewFlags?.review && state.ui?.visitedSteps?.review;

  useEffect(() => {
    const close = (e) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target)) setActionsMenuOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const validation = validateStep(state, "review");
  const blocked = validation.errors?.length > 0;
  const hasWarnings = (validation.warnings || []).length > 0;

  useEffect(() => {
    const nextDraft = !blocked && hasWarnings;
    if (exportOptions.draftMode !== nextDraft) {
      updateState({ exportOptions: { ...exportOptions, draftMode: nextDraft } });
    }
  }, [blocked, hasWarnings]);

  const refresh = async () => {
    if (blocked) {
      setBlockReason("Outputs are blocked until version is confirmed and required fields are valid.");
      return;
    }
    setGenerateError("");
    setBlockReason("");
    setLoading(true);
    try {
      const includeCreds = exportOptions.includeCredentials;
      const data = includeCreds
        ? await apiFetch("/api/generate", { method: "POST", body: JSON.stringify({ state }) })
        : await apiFetch("/api/generate");
      logAction("generate_review", { stepId: "review" });
      setFiles(data.files || {});
    } catch (error) {
      const mismatch = error?.payload?.analysisHashMismatch;
      const hardLimit = error?.payload?.trustSelectionHardLimitExceeded;
      if (mismatch) {
        setGenerateError(`${String(error?.message || error)} Re-run trust analysis on Trust & Proxy, then explicitly choose original or reduced bundle.`);
      } else if (hardLimit) {
        setGenerateError(`${String(error?.message || error)} Go to Trust & Proxy and reduce selected certificates or switch to original bundle.`);
      } else {
        setGenerateError(String(error?.message || error));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!blocked) {
      refresh().catch(() => {});
    }
  }, [state.release?.patchVersion, state.operators?.selected?.length, blocked, exportOptions.includeCredentials]);

  const downloadAll = async () => {
    if (blocked) {
      setBlockReason("Outputs are blocked until version is confirmed and required fields are valid.");
      return;
    }
    setGenerateError("");
    setDownloading(true);
    try {
      await apiFetch("/api/state", {
        method: "POST",
        body: JSON.stringify(getStateForPersistence(state))
      });
      await downloadZip(state);
      logAction("download_bundle", { stepId: "review" });
      updateState({
        blueprint: { ...state.blueprint, blueprintPullSecretEphemeral: undefined },
        credentials: {
          ...state.credentials,
          pullSecretPlaceholder: "{\"auths\":{}}",
          mirrorRegistryPullSecret: ""
        }
      });
    } catch (error) {
      const mismatch = error?.payload?.analysisHashMismatch;
      const hardLimit = error?.payload?.trustSelectionHardLimitExceeded;
      if (mismatch) {
        setGenerateError(`${String(error?.message || error)} Re-run trust analysis on Trust & Proxy, then retry export.`);
      } else if (hardLimit) {
        setGenerateError(`${String(error?.message || error)} Reduced selection is above hard maximum; adjust selection first.`);
      } else {
        setGenerateError(String(error?.message || error));
      }
    } finally {
      setDownloading(false);
    }
  };

  const updateDocs = async () => {
    if (!canRefreshDocs) return;
    setDocsUpdating(true);
    await apiFetch("/api/docs/update", { method: "POST" });
    await refresh();
    setDocsUpdating(false);
  };

  const exportRun = async () => {
    const data = await apiFetch("/api/run/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    triggerBrowserDownload(blob, getExportRunFilename(state));
  };

  const importRun = async (file) => {
    if (!file) return;
    const text = await file.text();
    const payload = JSON.parse(text);
    const data = await apiFetch("/api/run/import", { method: "POST", body: JSON.stringify(payload) });
    setState(data.state);
  };

  const handleCredentialsToggle = (checked) => {
    if (checked && !credentialsConfirmedThisSession) {
      setShowCredentialsConfirm(true);
    } else {
      updateState({ exportOptions: { ...exportOptions, includeCredentials: checked } });
    }
  };

  const confirmCredentialsInclude = () => {
    setCredentialsConfirmedThisSession(true);
    setShowCredentialsConfirm(false);
    updateState({ exportOptions: { ...exportOptions, includeCredentials: true } });
  };

  const cancelCredentialsInclude = () => {
    setShowCredentialsConfirm(false);
  };

  const includeCredentials = exportOptions.includeCredentials || false;
  const includeCertificates = exportOptions.includeCertificates !== false;
  const canRefreshDocs = capabilities.docsRefreshAllowed !== false;
  const canDownloadBinaries = capabilities.binaryDownloadAllowed !== false;
  const installerTargetHostOsFamily = exportOptions.installerTargetHostOsFamily || "rhel9";
  const installerTargetArch = exportOptions.installerTargetArch || "x86_64";
  const installerTargetFipsRequired = Boolean(exportOptions.installerTargetFipsRequired);
  const [showPullSecretInPreview, setShowPullSecretInPreview] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState({ runtimeArch: null, localBinaryArch: null });

  useEffect(() => {
    if (!includeCredentials) setShowPullSecretInPreview(false);
  }, [includeCredentials]);

  useEffect(() => {
    apiFetch("/api/runtime-info")
      .then((data) => setRuntimeInfo({ runtimeArch: data.runtimeArch || null, localBinaryArch: data.localBinaryArch || null }))
      .catch(() => setRuntimeInfo({ runtimeArch: null, localBinaryArch: null }));
  }, []);

  const installConfigContent = files["install-config.yaml"];
  const trustSelectionSummary = state.trust?.reducedSelection?.selectionSummary || null;
  const trustMode = state.trust?.bundleSelectionMode === "reduced" ? "Reduced" : "Original";
  const trustModeDetail = state.trust?.bundleSelectionMode === "reduced"
    ? (state.trust?.reducedSelection?.userModified ? "Reduced + manual overrides" : "Reduced proposal only")
    : "Original input bundle";
  const installConfigDisplay = (() => {
    if (!installConfigContent) return installConfigContent;
    if (!includeCredentials) {
      return replacePullSecretInYaml(installConfigContent, PULLSECRET_PLACEHOLDER_LINE);
    }
    if (!showPullSecretInPreview) {
      return maskSensitiveInInstallConfigYaml(installConfigContent);
    }
    return installConfigContent;
  })();

  return (
    <div className="step">
      <div className="step-header">
        <div className="step-header-main">
          <h2>Architecture Assets</h2>
          <p className="subtle">Review and export your configuration bundle.</p>
          {downloading ? (
            <p className="review-downloading-notice" style={{ marginTop: 8, marginBottom: 0 }}>
              Generating and streaming your bundle. This can take 20–60 seconds when tools are included.
            </p>
          ) : null}
        </div>
        <div className="header-actions">
          <Button variant="primary" onClick={downloadAll} disabled={blocked || downloading}>
            {downloading ? "Preparing Bundle…" : "Download Bundle"}
          </Button>
          <div className="header-actions-dropdown" ref={actionsMenuRef}>
            <button
              type="button"
              className="ghost header-actions-dropdown-trigger"
              onClick={() => setActionsMenuOpen((o) => !o)}
              aria-expanded={actionsMenuOpen}
              aria-haspopup="true"
            >
              Actions
            </button>
            {actionsMenuOpen ? (
              <div className="header-actions-dropdown-menu">
                <button type="button" className="header-actions-dropdown-item" onClick={() => { refresh(); setActionsMenuOpen(false); }}>
                  Refresh Previews
                </button>
                <button type="button" className="header-actions-dropdown-item" onClick={() => { updateDocs(); setActionsMenuOpen(false); }} disabled={docsUpdating || !canRefreshDocs}>
                  {docsUpdating ? "Updating Docs…" : "Update Docs Links"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <input
        ref={importRef}
        type="file"
        accept=".json"
        style={{ display: "none" }}
        onChange={(e) => importRun(e.target.files?.[0])}
      />

      {showCredentialsConfirm ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="credentials-confirm-title">
          <div className="modal">
            <h3 id="credentials-confirm-title">Include credentials in export?</h3>
            <p className="subtle">
              This will embed pull secrets in generated files. Treat the bundle as sensitive and protect it like a credential.
            </p>
            <div className="actions">
              <Button type="button" variant="secondary" onClick={cancelCredentialsInclude}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={confirmCredentialsInclude}>
                Yes, include credentials
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="step-body">
        <div className="card">
          <h3>Export Options</h3>
          <OptionRow
            title="Include credentials in export"
            description="Embed pull secrets in generated files. Off by default."
            warning={includeCredentials ? (
              <span>This will embed pull secrets in generated files. Treat the bundle as sensitive.</span>
            ) : null}
          >
            <Switch
              checked={includeCredentials}
              onChange={handleCredentialsToggle}
              aria-label="Include credentials in export"
            />
          </OptionRow>
          <OptionRow
            title="Include certificates in export"
            description="Add trust bundles and PEMs to the bundle."
            note="Certificates can expose internal hostnames; treat exports as sensitive."
          >
            <Switch
              checked={includeCertificates}
              onChange={(checked) =>
                updateState({ exportOptions: { ...exportOptions, includeCertificates: checked } })
              }
              aria-label="Include certificates in export"
            />
          </OptionRow>
          <CollapsibleSection title="Advanced / Tools" defaultCollapsed={true}>
            <OptionRow
              title="Include oc and oc-mirror binaries"
              description="Add oc and oc-mirror to the bundle under tools/."
            >
              <Switch
                checked={exportOptions.includeClientTools || false}
                onChange={(checked) =>
                  updateState({ exportOptions: { ...exportOptions, includeClientTools: checked } })
                }
                disabled={!canDownloadBinaries}
                aria-label="Include oc and oc-mirror binaries"
              />
            </OptionRow>
            {exportOptions.includeClientTools ? (
              <OptionRow
                title="Target architecture for oc/oc-mirror"
                description={runtimeInfo.localBinaryArch ? `Backend default: ${runtimeInfo.localBinaryArch}. Choose another arch to download that variant for the bundle.` : "Choose which architecture binary to include."}
              >
                <select
                  value={exportOptions.exportBinaryArch ?? ""}
                  onChange={(e) =>
                    updateState({
                      exportOptions: {
                        ...exportOptions,
                        exportBinaryArch: e.target.value === "" ? null : e.target.value
                      }
                    })
                  }
                  aria-label="Target architecture for oc/oc-mirror"
                >
                  <option value="">Default (match backend)</option>
                  <option value="x86_64">x86_64</option>
                  <option value="aarch64">aarch64</option>
                  <option value="ppc64le">ppc64le</option>
                  <option value="s390x">s390x</option>
                </select>
              </OptionRow>
            ) : null}
            <OptionRow
              title="Include version-specific openshift-install"
              description="Download the installer for the confirmed release and add it under tools/openshift-install."
            >
              <Switch
                checked={exportOptions.includeInstaller || false}
                onChange={(checked) =>
                  updateState({ exportOptions: { ...exportOptions, includeInstaller: checked } })
                }
                disabled={!canDownloadBinaries}
                aria-label="Include version-specific openshift-install"
              />
            </OptionRow>
            {exportOptions.includeInstaller ? (
              <>
                <OptionRow
                  title="Installer target host OS family"
                  description="Validated input for installer packaging checks in this release (supported: RHEL 8/9)."
                >
                  <select
                    value={installerTargetHostOsFamily}
                    onChange={(e) =>
                      updateState({
                        exportOptions: {
                          ...exportOptions,
                          installerTargetHostOsFamily: e.target.value
                        }
                      })
                    }
                    aria-label="Installer target host OS family"
                  >
                    <option value="rhel8">RHEL 8</option>
                    <option value="rhel9">RHEL 9</option>
                  </select>
                </OptionRow>
                <OptionRow
                  title="Installer target host architecture"
                  description="Current verified packaging target is x86_64."
                >
                  <select
                    value={installerTargetArch}
                    onChange={(e) =>
                      updateState({
                        exportOptions: {
                          ...exportOptions,
                          installerTargetArch: e.target.value
                        }
                      })
                    }
                    aria-label="Installer target host architecture"
                  >
                    <option value="x86_64">x86_64</option>
                  </select>
                </OptionRow>
                <OptionRow
                  title="Target host requires FIPS mode"
                  description="Validated packaging input for readiness reporting. Artifact variant remains version+arch in this release; cluster FIPS remains controlled in Global settings."
                >
                  <Switch
                    checked={installerTargetFipsRequired}
                    onChange={(checked) =>
                      updateState({
                        exportOptions: {
                          ...exportOptions,
                          installerTargetFipsRequired: checked
                        }
                      })
                    }
                    aria-label="Target host requires FIPS mode"
                  />
                </OptionRow>
              </>
            ) : null}
            {!canDownloadBinaries ? (
              <div className="note warning">
                Binary downloads are disabled in profile {profileContract?.profile || "disconnected-execution"}.
              </div>
            ) : null}
          </CollapsibleSection>
        </div>
        {needsReview ? (
          <Banner variant="warning">
            Version or upstream selections changed. Review outputs before exporting.
            <div className="actions">
              <Button variant="secondary" onClick={() => updateState({ reviewFlags: { ...state.reviewFlags, review: false } })}>
                Re-evaluate this page
              </Button>
            </div>
          </Banner>
        ) : null}
        {blocked ? (
          <Banner variant="warning">
            {blockReason || "Outputs are blocked until version is confirmed and required fields are valid."}
            {incompleteStepLabels?.length > 0 ? (
              <div className="note" style={{ marginTop: 8 }}>
                Complete at least: {incompleteStepLabels.join(", ")}.
              </div>
            ) : null}
          </Banner>
        ) : null}
        {generateError ? (
          <Banner variant="error">
            Failed to generate assets. {generateError}
          </Banner>
        ) : null}
        {!canRefreshDocs ? (
          <Banner variant="warning">
            Docs link refresh is disabled in this profile. Cached links are still included in generated outputs.
          </Banner>
        ) : null}
        {!blocked && hasWarnings ? (
          <Banner variant="warning">
            Draft / Not validated: warnings were present at export time. Review before use.
          </Banner>
        ) : null}
        {loading ? <div className="loading">Generating assets…</div> : null}

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0 }}>install-config.yaml</h3>
            <span className="note">
              Trust source: {trustModeDetail}
            </span>
            {includeCredentials && installConfigContent ? (
              <button
                type="button"
                className="ghost"
                onClick={() => setShowPullSecretInPreview((v) => !v)}
                aria-pressed={showPullSecretInPreview}
              >
                {showPullSecretInPreview ? "Hide sensitive values" : "Show sensitive values"}
              </button>
            ) : null}
          </div>
          <ResizablePreviewPane
            id="install-config"
            content={installConfigDisplay}
            placeholder="Not generated yet."
          />
        </div>
        <div className="card">
          <h3>Trust selection summary</h3>
          <p className="note">
            Mode: <strong>{trustMode}</strong>.
            {trustSelectionSummary ? (
              <>
                {" "}Selected certs: <strong>{trustSelectionSummary.selectedCertCount}</strong>, excluded: <strong>{trustSelectionSummary.excludedCertCount}</strong>, bytes: <strong>{trustSelectionSummary.selectedBytes}</strong>, status: <strong>{trustSelectionSummary.thresholdBand}</strong>.
                <br />
                Sufficiency: mirror <strong>{trustSelectionSummary.sufficiency?.mirrorPath?.status || "unknown"}</strong>, proxy <strong>{trustSelectionSummary.sufficiency?.proxyPath?.status || "unknown"}</strong>, overall <strong>{trustSelectionSummary.sufficiency?.overallStatus || "unknown"}</strong>.
              </>
            ) : (
              " Reduced-mode selection summary appears after running trust analysis."
            )}
          </p>
        </div>

        {files["agent-config.yaml"] ? (
          <div className="card">
            <h3>agent-config.yaml</h3>
            <ResizablePreviewPane
              id="agent-config"
              content={files["agent-config.yaml"]}
              placeholder="Not generated yet."
            />
          </div>
        ) : null}

        <div id="imageset-config" className="card">
          <h3>imageset-config.yaml</h3>
          <ResizablePreviewPane
            id="imageset-config"
            content={files["imageset-config.yaml"]}
            placeholder="Not generated yet."
          />
        </div>

        <div className="card">
          <h3>Architect Field Manual</h3>
          <ResizablePreviewPane
            id="field-manual"
            content={files["FIELD_MANUAL.md"]}
            placeholder="Not generated yet."
          />
        </div>
      </div>
    </div>
  );
};

export default ReviewStep;
