import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, API_BASE } from "../api.js";
import { useApp, getStateForPersistence } from "../store.jsx";
import { validateStep } from "../validation.js";
import { logAction } from "../logger.js";
import Switch from "../components/Switch.jsx";
import OptionRow from "../components/OptionRow.jsx";
import WarningCallout from "../components/WarningCallout.jsx";
import CollapsibleSection from "../components/CollapsibleSection.jsx";
import Banner from "../components/Banner.jsx";
import Button from "../components/Button.jsx";

const DEFAULT_PREVIEW_HEIGHT = 320;
const MIN_PREVIEW_HEIGHT = 120;
const MAX_PREVIEW_HEIGHT = 800;

/** Export bundle binary architecture options (mirror path pattern). */
const EXPORT_BINARY_ARCH_OPTIONS = [
  { value: "x86_64", label: "x86_64" },
  { value: "amd64", label: "amd64" },
  { value: "aarch64", label: "aarch64" },
  { value: "arm64", label: "arm64" },
  { value: "ppc64le", label: "ppc64le" },
  { value: "s390x", label: "s390x" }
];

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

const downloadZip = async () => {
  const res = await fetch(`${API_BASE}/api/bundle.zip`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Failed to download bundle (HTTP ${res.status})`);
  }
  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename=([^;]+)/i);
  const filename = match ? match[1].replace(/"/g, "") : "airgap-install-configs-bundle.zip";
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const ReviewStep = ({ incompleteStepLabels = [], onRequestStartOver }) => {
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
  const [runtimeInfo, setRuntimeInfo] = useState(null);
  const needsReview = state.reviewFlags?.review && state.ui?.visitedSteps?.review;

  useEffect(() => {
    if (exportOptions.includeClientTools) {
      apiFetch("/api/runtime-info")
        .then((info) => setRuntimeInfo(info))
        .catch(() => setRuntimeInfo(null));
    }
  }, [exportOptions.includeClientTools]);

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
      const data = await apiFetch("/api/generate");
      logAction("generate_review", { stepId: "review" });
      setFiles(data.files || {});
    } catch (error) {
      setGenerateError(String(error?.message || error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!blocked) {
      refresh().catch(() => {});
    }
  }, [state.release?.patchVersion, state.operators?.selected?.length, blocked]);

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
      await downloadZip();
      logAction("download_bundle", { stepId: "review" });
    } catch (error) {
      setGenerateError(String(error?.message || error));
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `airgap-run-${data.runId || "bundle"}.json`;
    a.click();
    URL.revokeObjectURL(url);
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

  return (
    <div className="step">
      <div className="step-header">
        <div className="step-header-main">
          <h2>Architecture Assets</h2>
          <p className="subtle">Review and export your configuration bundle.</p>
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
          <OptionRow
            title="Include credentials in export"
            description="Embed pull secrets in generated files. Off by default."
            warning={includeCredentials ? (
              <WarningCallout>
                This will embed pull secrets in generated files. Treat the bundle as sensitive.
              </WarningCallout>
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
                  updateState({
                    exportOptions: {
                      ...exportOptions,
                      includeClientTools: checked,
                      exportBinaryArch: checked
                        ? (exportOptions.exportBinaryArch || runtimeInfo?.localBinaryArch || "x86_64")
                        : exportOptions.exportBinaryArch
                    }
                  })
                }
                aria-label="Include oc and oc-mirror binaries"
              />
            </OptionRow>
            {exportOptions.includeClientTools ? (
              <OptionRow
                title="Export bundle binary architecture"
                description="Which architecture of oc/oc-mirror to include in the downloaded bundle. This does not change the backend's Operators scan binary (that follows the container runtime). By default, the app reuses already-downloaded local binaries when the selected architecture matches. Choosing a different architecture fetches those versions for the bundle."
              >
                <select
                  value={exportOptions.exportBinaryArch || runtimeInfo?.localBinaryArch || ""}
                  onChange={(e) =>
                    updateState({
                      exportOptions: {
                        ...exportOptions,
                        exportBinaryArch: e.target.value || null
                      }
                    })
                  }
                  aria-label="Export bundle binary architecture"
                >
                  <option value="">Use local ({runtimeInfo?.localBinaryArch || "detecting…"})</option>
                  {EXPORT_BINARY_ARCH_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
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
        {downloading ? (
          <Banner variant="info">
            Generating and streaming your bundle. This can take 20–60 seconds when tools are included.
          </Banner>
        ) : null}
        {generateError ? (
          <Banner variant="error">
            Failed to generate assets. {generateError}
          </Banner>
        ) : null}
        {!blocked && hasWarnings ? (
          <Banner variant="warning">
            Draft / Not validated: warnings were present at export time. Review before use.
          </Banner>
        ) : null}
        {loading ? <div className="loading">Generating assets…</div> : null}

        <div className="card">
          <h3>install-config.yaml</h3>
          <ResizablePreviewPane
            id="install-config"
            content={files["install-config.yaml"]}
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
