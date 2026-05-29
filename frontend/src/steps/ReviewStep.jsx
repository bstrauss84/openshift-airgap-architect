/**
 * OpenShift Airgap Architect - Review & Export Step
 *
 * Final review of generated OpenShift configurations (install-config.yaml,
 * agent-config.yaml) with preview, redaction controls, and export options.
 * Supports exporting individual files, run files, and complete deployment bundles.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
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
import { canonicalizeExportOptions, resolveSecretInclusion } from "../exportInclusion.js";

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

const ReviewStep = ({ incompleteStepLabels = [], onRequestStartOver }) => {
  const { state, updateState, setState } = useApp();
  const importRef = useRef(null);

  // BUG FIX #2: Track request IDs to prevent race conditions
  // When multiple refresh() calls happen rapidly (e.g., during import or rapid state changes),
  // responses can arrive out of order. Without this, the last response wins even if stale.
  // This matches the pattern used in App.jsx for YamlDrawer (line 197)
  const refreshRequestIdRef = useRef(0);

  const exportOptions = canonicalizeExportOptions(state.exportOptions || {});
  const inclusion = resolveSecretInclusion(exportOptions);
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

  const updateExportOptions = (nextExportOptions) => {
    updateState({ exportOptions: canonicalizeExportOptions(nextExportOptions || {}) });
  };

  useEffect(() => {
    const nextDraft = !blocked && hasWarnings;
    if (exportOptions.draftMode !== nextDraft) {
      updateExportOptions({ ...exportOptions, draftMode: nextDraft });
    }
  }, [blocked, hasWarnings]);

  const refresh = async (signal) => {
    // BUG FIX (2026-05-13): Race condition protection
    // Track request IDs to discard stale responses when multiple refresh() calls happen rapidly
    refreshRequestIdRef.current += 1;
    const currentRequestId = refreshRequestIdRef.current;

    // Set block reason if validation errors exist, but continue generating preview
    if (blocked) {
      setBlockReason("⚠️ Configuration incomplete: Review validation errors and complete required fields before exporting.");
    } else {
      setBlockReason("");
    }
    setGenerateError("");
    setLoading(true);
    try {
      // ALWAYS use POST with current state (don't use GET endpoint)
      // GET endpoint reads from backend state store which is 600ms behind frontend

      const data = await apiFetch("/api/generate", {
        method: "POST",
        body: JSON.stringify({ state }),
        signal: signal
      });

      // Only apply response if this is still the latest request
      if (currentRequestId === refreshRequestIdRef.current) {
        logAction("generate_review", { stepId: "review" });
        setFiles(data.files || {});
      }
    } catch (error) {
      // Ignore aborted requests (cancelled by cleanup)
      if (error.name === 'AbortError') return;

      // Only set error state if this is still the latest request
      if (currentRequestId === refreshRequestIdRef.current) {
        const mismatch = error?.payload?.analysisHashMismatch;
        const hardLimit = error?.payload?.trustSelectionHardLimitExceeded;
        if (mismatch) {
          setGenerateError(`${String(error?.message || error)} Re-run trust analysis on Trust & Proxy, then explicitly choose original or reduced bundle.`);
        } else if (hardLimit) {
          setGenerateError(`${String(error?.message || error)} Go to Trust & Proxy and reduce selected certificates or switch to original bundle.`);
        } else {
          setGenerateError(String(error?.message || error));
        }
      }
    } finally {
      // Only clear loading if this is still the latest request
      if (currentRequestId === refreshRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    // BUG FIX (2026-05-13): AbortController to cancel in-flight requests on cleanup
    const controller = new AbortController();

    // Add small delay to allow React to finish batching state updates
    // This is especially important after imports which change multiple state fields simultaneously
    const timer = setTimeout(() => {
      // Always refresh, even when blocked - show incomplete preview with warnings
      refresh(controller.signal).catch(() => {});
    }, 100);  // 100ms delay to let React settle

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [state.release?.patchVersion, state.operators?.selected?.length, blocked, inclusion.pullSecret, inclusion.mirrorRegistryCredentials, inclusion.platformCredentials, inclusion.bmcCredentials]);

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

  const includeHighSideRuntimePackage = Boolean(exportOptions.includeHighSideRuntimePackage);
  const [showPullSecretInPreview, setShowPullSecretInPreview] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState({ runtimeArch: null, localBinaryArch: null });

  useEffect(() => {
    if (!inclusion.pullSecret) setShowPullSecretInPreview(false);
  }, [inclusion.pullSecret]);

  useEffect(() => {
    apiFetch("/api/runtime-info")
      .then((data) => setRuntimeInfo({ runtimeArch: data.runtimeArch || null, localBinaryArch: data.localBinaryArch || null }))
      .catch(() => setRuntimeInfo({ runtimeArch: null, localBinaryArch: null }));
  }, []);

  // Auto-sync FIPS installer toggle with Identity & Access FIPS mode
  useEffect(() => {
    const fipsEnabled = state.globalStrategy?.fips ?? false;
    if (fipsEnabled && !exportOptions.installerUseFips) {
      updateState({ exportOptions: { ...exportOptions, installerUseFips: true } });
    }
  }, [state.globalStrategy?.fips]);

  const installConfigContent = files["install-config.yaml"];
  const installConfigDisplay = (() => {
    if (!installConfigContent) return installConfigContent;
    if (!inclusion.pullSecret) {
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
                <button type="button" className="header-actions-dropdown-item" onClick={() => { updateDocs(); setActionsMenuOpen(false); }} disabled={docsUpdating}>
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
          <CollapsibleSection title="Per-class inclusion controls" defaultCollapsed={false}>
            <OptionRow
              title="Pull secret"
              description="Include install-config pullSecret."
              warning={inclusion.pullSecret ? (
                <span>This will embed pull secrets in generated files. Treat the bundle as sensitive.</span>
              ) : null}
            >
              <Switch
                checked={inclusion.pullSecret}
                onChange={(checked) =>
                  updateExportOptions({ ...exportOptions, inclusion: { ...inclusion, pullSecret: checked } })
                }
                aria-label="Include pull secret"
              />
            </OptionRow>
            <OptionRow title="Platform credentials" description="Include vSphere/Nutanix platform credentials if set.">
              <Switch
                checked={inclusion.platformCredentials}
                onChange={(checked) =>
                  updateExportOptions({ ...exportOptions, inclusion: { ...inclusion, platformCredentials: checked } })
                }
                aria-label="Include platform credentials"
              />
            </OptionRow>
            <OptionRow title="Mirror registry credentials" description="Include mirror-registry pull secret JSON.">
              <Switch
                checked={inclusion.mirrorRegistryCredentials}
                onChange={(checked) =>
                  updateExportOptions({ ...exportOptions, inclusion: { ...inclusion, mirrorRegistryCredentials: checked } })
                }
                aria-label="Include mirror registry credentials"
              />
            </OptionRow>
            <OptionRow title="BMC credentials" description="Include BMC usernames/passwords in generated host specs.">
              <Switch
                checked={inclusion.bmcCredentials}
                onChange={(checked) =>
                  updateExportOptions({ ...exportOptions, inclusion: { ...inclusion, bmcCredentials: checked } })
                }
                aria-label="Include BMC credentials"
              />
            </OptionRow>
            <OptionRow title="Trust bundles / cert material" description="Include trust bundle PEM content and policy.">
              <Switch
                checked={inclusion.trustBundleAndCertificates}
                onChange={(checked) =>
                  updateExportOptions({ ...exportOptions, inclusion: { ...inclusion, trustBundleAndCertificates: checked } })
                }
                aria-label="Include trust bundle and certificates"
              />
            </OptionRow>
            <OptionRow title="SSH public key" description="Include install-config sshKey.">
              <Switch
                checked={inclusion.sshPublicKey}
                onChange={(checked) =>
                  updateExportOptions({ ...exportOptions, inclusion: { ...inclusion, sshPublicKey: checked } })
                }
                aria-label="Include SSH public key"
              />
            </OptionRow>
            <OptionRow title="Proxy values" description="Include proxy endpoints in generated files/guides.">
              <Switch
                checked={inclusion.proxyValues}
                onChange={(checked) =>
                  updateExportOptions({ ...exportOptions, inclusion: { ...inclusion, proxyValues: checked } })
                }
                aria-label="Include proxy values"
              />
            </OptionRow>
          </CollapsibleSection>
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
                aria-label="Include version-specific openshift-install"
              />
            </OptionRow>
            {exportOptions.includeInstaller ? (
              <div className="option-subgroup">
                <OptionRow
                  title="Include FIPS-enabled (RHEL 9) installer"
                  description={`Use the FIPS-validated RHEL 9 version of openshift-install. Required when FIPS mode is enabled.${state.globalStrategy?.fips ? ' (Auto-enabled based on FIPS mode)' : ''}`}
                >
                  <Switch
                    checked={exportOptions.installerUseFips || false}
                    onChange={(checked) =>
                      updateState({ exportOptions: { ...exportOptions, installerUseFips: checked } })
                    }
                    aria-label="Include FIPS-enabled installer"
                  />
                </OptionRow>
                <OptionRow
                  title="Target platform/architecture for openshift-install"
                  description={`Backend default: ${runtimeInfo.detectedInstallerVariant ? runtimeInfo.detectedInstallerVariant.replace('-', ' ').toUpperCase().replace('MAC', 'macOS').replace('LINUX', 'Linux') : 'detecting...'}. Choose another to download that variant for the bundle.${exportOptions.installerUseFips ? ' (FIPS RHEL 9 only available on Linux)' : ''}`}
                >
                  <select
                    value={exportOptions.installerPlatformArch || ""}
                    onChange={(e) =>
                      updateState({ exportOptions: { ...exportOptions, installerPlatformArch: e.target.value } })
                    }
                    style={{ maxWidth: "280px" }}
                    aria-label="Target platform/architecture for openshift-install"
                  >
                    <option value="">Default (match backend)</option>
                    {exportOptions.installerUseFips ? (
                      // FIPS variants (Linux RHEL 9 only)
                      <>
                        <option value="linux-amd64">Linux x86_64 (RHEL 9 FIPS)</option>
                        <option value="linux-arm64">Linux ARM64 (RHEL 9 FIPS)</option>
                        <option value="linux-ppc64le">Linux PPC64LE (RHEL 9 FIPS)</option>
                        <option value="linux-s390x">Linux s390x (RHEL 9 FIPS)</option>
                      </>
                    ) : (
                      // Standard variants (Linux + macOS)
                      <>
                        <option value="linux-amd64">Linux x86_64</option>
                        <option value="linux-arm64">Linux ARM64</option>
                        <option value="linux-ppc64le">Linux PPC64LE</option>
                        <option value="linux-s390x">Linux s390x</option>
                        <option value="mac-amd64">macOS Intel (x86_64)</option>
                        <option value="mac-arm64">macOS ARM64 (Apple Silicon)</option>
                      </>
                    )}
                  </select>
                </OptionRow>
              </div>
            ) : null}
            <OptionRow
              title="Include mirror-registry binary"
              description="Add latest mirror-registry to the bundle under tools/. Download from mirror.openshift.com at export time."
            >
              <Switch
                checked={exportOptions.includeMirrorRegistry || false}
                onChange={(checked) =>
                  updateState({ exportOptions: { ...exportOptions, includeMirrorRegistry: checked } })
                }
                aria-label="Include mirror-registry binary"
              />
            </OptionRow>
            {exportOptions.includeMirrorRegistry ? (
              <OptionRow
                title="Target architecture for mirror-registry"
                description="Choose which architecture binary to include for mirror-registry."
              >
                <select
                  value={exportOptions.mirrorRegistryArch ?? "amd64"}
                  onChange={(e) =>
                    updateState({
                      exportOptions: {
                        ...exportOptions,
                        mirrorRegistryArch: e.target.value
                      }
                    })
                  }
                  aria-label="Target architecture for mirror-registry"
                >
                  <option value="amd64">amd64</option>
                  <option value="ppc64le">ppc64le</option>
                  <option value="s390x">s390x</option>
                </select>
              </OptionRow>
            ) : null}
            {/* High-side runtime package toggle hidden until fully functional and tested
            <OptionRow
              title="Include high-side runtime package artifacts"
              description="Bundle OCI-archive container images and docker-compose for disconnected deployment."
            >
              <Switch
                checked={includeHighSideRuntimePackage}
                onChange={(checked) =>
                  updateExportOptions({ ...exportOptions, includeHighSideRuntimePackage: checked })
                }
                aria-label="Include high-side runtime package artifacts"
              />
            </OptionRow>
            */}
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
        {!blocked && hasWarnings ? (
          <Banner variant="warning">
            <strong>Draft / not fully validated.</strong>
            {" "}
            {"Assets & Guide re-checks the whole wizard (version, networking, credentials, inventory, trust, and operators). "}
            The items below are current warnings from that combined check; fix them on the listed steps before treating
            exports as final.
            <ul style={{ margin: "10px 0 0 18px", padding: 0 }}>
              {(validation.warnings || []).slice(0, 20).map((w, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {w}
                </li>
              ))}
            </ul>
            {(validation.warnings || []).length > 20 ? (
              <div className="note subtle" style={{ marginTop: 6 }}>
                {(validation.warnings || []).length - 20} more warning(s) not shown.
              </div>
            ) : null}
          </Banner>
        ) : null}
        {loading ? <div className="loading">Generating assets…</div> : null}

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0 }}>install-config.yaml</h3>
            {inclusion.pullSecret && installConfigContent ? (
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
