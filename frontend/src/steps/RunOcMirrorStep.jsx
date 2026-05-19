/**
 * OpenShift Airgap Architect - oc-mirror Execution Step
 *
 * Manages oc-mirror workflow execution for mirroring OpenShift releases and operators.
 * Supports three modes: mirror-to-disk, disk-to-mirror, and direct mirror-to-mirror.
 * Provides job progress tracking, output streaming, and archive management.
 *
 * Implementation contract: docs/OC_MIRROR_V2_RUN_TAB_RESEARCH_AND_PLAN.md §1–§9.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useEffect, useCallback } from "react";
import { useApp } from "../store.jsx";
import { apiFetch, API_BASE } from "../api.js";
import Button from "../components/Button.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import CollapsibleSection from "../components/CollapsibleSection.jsx";
import OptionRow from "../components/OptionRow.jsx";
import Switch from "../components/Switch.jsx";
import SecretInput from "../components/SecretInput.jsx";
import RunConfirmationModal from "../components/RunConfirmationModal.jsx";

const DEFAULT_ARCHIVE_PATH = "/data/oc-mirror/archives";
const DEFAULT_WORKSPACE_PATH = "/data/oc-mirror/workspace";
const DEFAULT_CACHE_PATH = "/data/oc-mirror/cache";

const WORKFLOW_GROUPS = [
  {
    label: "Fully Disconnected — Multi-Step",
    description: "Use when the registry host has no internet access. Run each step separately, transferring archives across the air gap between them.",
    modes: [
      {
        value: "mirrorToDisk",
        label: "Step 1 — Mirror to disk",
        help: "Download release and operator images from the internet to a local archive directory. The archive path acts as both destination and workspace. Cache speeds up subsequent incremental runs."
      },
      {
        value: "diskToMirror",
        label: "Step 2 — Disk to mirror",
        help: "Publish images from a local archive (from a previous mirror-to-disk run) to your mirror registry. Requires source archive path and registry URL. Workspace and cache are optional."
      }
    ]
  },
  {
    label: "Directly Connected to Registry",
    description: "Use when the machine running oc-mirror has network access to both Red Hat registries and your mirror registry.",
    modes: [
      {
        value: "mirrorToMirror",
        label: "Mirror to mirror",
        help: "Stream images directly from source to your mirror registry. Use when you have direct connectivity to both Red Hat registries and your mirror. Requires workspace and registry URL."
      }
    ]
  }
];

const defaultRegistryUrl = (state) => {
  const fqdn = state?.globalStrategy?.mirroring?.registryFqdn?.trim();
  return fqdn ? `docker://${fqdn}` : "";
};

export default function RunOcMirrorStep({ onNavigateToOperations } = {}) {
  const { state, updateState } = useApp();
  const mw = state?.mirrorWorkflow || {};
  const mode = mw.mode || "mirrorToDisk";
  const configSourceType = mw.configSourceType || "generated";
  const configPath = mw.configPath || "";
  const archivePath = mw.archivePath || "";
  const workspacePath = mw.workspacePath || "";
  const cachePath = mw.cachePath || "";
  const registryUrl = mw.registryUrl || defaultRegistryUrl(state);
  const dryRun = Boolean(mw.dryRun);
  const logLevel = mw.logLevel || "info";
  const parallelImages = mw.parallelImages ?? 4;
  const parallelLayers = mw.parallelLayers ?? 5;
  const imageTimeout = mw.imageTimeout || "10m";
  const retryTimes = mw.retryTimes ?? 2;
  const retryDelay = mw.retryDelay || "1s";
  const since = mw.since || "";
  const strictArchive = Boolean(mw.strictArchive);
  const includeInExport = Boolean(mw.includeInExport);
  const lastRunJobId = mw.lastRunJobId || null;

  const [preflightResult, setPreflightResult] = React.useState(null);
  const [preflightLoading, setPreflightLoading] = React.useState(false);
  const [rhAuthSource, setRhAuthSource] = React.useState("retained");
  const [mirrorAuthSource, setMirrorAuthSource] = React.useState("reuse");
  const [mountedRhAvailable, setMountedRhAvailable] = React.useState(false);
  const [rhPullSecretPaste, setRhPullSecretPaste] = React.useState("");
  const [mirrorPullSecretPaste, setMirrorPullSecretPaste] = React.useState("");
  const [runningJobId, setRunningJobId] = React.useState(null);
  const [lastRunJob, setLastRunJob] = React.useState(null);
  const [ocMirrorCompleteModal, setOcMirrorCompleteModal] = React.useState(null);
  const [runError, setRunError] = React.useState(null);
  const [showRunConfirmation, setShowRunConfirmation] = React.useState(false);
  const [browseOpen, setBrowseOpen] = React.useState(false);
  const [browseTarget, setBrowseTarget] = React.useState(null);
  const [browsePath, setBrowsePath] = React.useState("/");
  const [browseEntries, setBrowseEntries] = React.useState([]);
  const [browseLoading, setBrowseLoading] = React.useState(false);
  const [browseError, setBrowseError] = React.useState(null);
  const [browseMissingNotice, setBrowseMissingNotice] = React.useState(null);
  const preflightResultsRef = React.useRef(null);

  // Local state for text inputs (onBlur pattern)
  const [localConfigPath, setLocalConfigPath] = React.useState(configPath);
  const [localArchivePath, setLocalArchivePath] = React.useState(archivePath);
  const [localWorkspacePath, setLocalWorkspacePath] = React.useState(workspacePath);
  const [localCachePath, setLocalCachePath] = React.useState(cachePath);
  const [localRegistryUrl, setLocalRegistryUrl] = React.useState(registryUrl);
  const [localParallelImages, setLocalParallelImages] = React.useState(String(parallelImages));
  const [localParallelLayers, setLocalParallelLayers] = React.useState(String(parallelLayers));
  const [localImageTimeout, setLocalImageTimeout] = React.useState(imageTimeout);
  const [localRetryTimes, setLocalRetryTimes] = React.useState(String(retryTimes));
  const [localRetryDelay, setLocalRetryDelay] = React.useState(retryDelay);
  const [localSince, setLocalSince] = React.useState(since);

  // Signature verification options (safe defaults: verify all signatures)
  const disableCertified = Boolean(mw.disableCertified);
  const disableCommunity = Boolean(mw.disableCommunity);
  const removeSignatures = Boolean(mw.removeSignatures);

  const updateMirrorWorkflow = useCallback(
    (patch) => updateState({ mirrorWorkflow: { ...mw, ...patch } }),
    [updateState, mw]
  );

  const resetPaths = () => {
    updateMirrorWorkflow({ archivePath: DEFAULT_ARCHIVE_PATH, workspacePath: DEFAULT_WORKSPACE_PATH, cachePath: DEFAULT_CACHE_PATH });
  };

  // Sync local state when store values change
  useEffect(() => { setLocalConfigPath(configPath); }, [configPath]);
  useEffect(() => { setLocalArchivePath(archivePath); }, [archivePath]);
  useEffect(() => { setLocalWorkspacePath(workspacePath); }, [workspacePath]);
  useEffect(() => { setLocalCachePath(cachePath); }, [cachePath]);
  useEffect(() => { setLocalRegistryUrl(registryUrl); }, [registryUrl]);
  useEffect(() => { setLocalParallelImages(String(parallelImages)); }, [parallelImages]);
  useEffect(() => { setLocalParallelLayers(String(parallelLayers)); }, [parallelLayers]);
  useEffect(() => { setLocalImageTimeout(imageTimeout); }, [imageTimeout]);
  useEffect(() => { setLocalRetryTimes(String(retryTimes)); }, [retryTimes]);
  useEffect(() => { setLocalRetryDelay(retryDelay); }, [retryDelay]);
  useEffect(() => { setLocalSince(since); }, [since]);

  const openBrowse = async (target, currentPath) => {
    const startPath = currentPath || "/";
    setBrowseTarget(target);
    setBrowsePath(startPath);
    setBrowseOpen(true);
    setBrowseError(null);
    setBrowseMissingNotice(null);
    setBrowseLoading(true);
    try {
      const result = await apiFetch(`/api/fs/ls?path=${encodeURIComponent(startPath)}`);
      setBrowseEntries(result.entries || []);
      setBrowsePath(result.path);
      if (result.requestedMissing) {
        setBrowseMissingNotice(`"${result.requestedPath}" doesn't exist yet — showing nearest parent. You can still select any path or navigate here and use "Select this directory" to set it.`);
      }
    } catch (err) {
      setBrowseError(err.message || "Could not list directory.");
      setBrowseEntries([]);
    } finally {
      setBrowseLoading(false);
    }
  };

  const navigateBrowse = async (newPath) => {
    setBrowseError(null);
    setBrowseMissingNotice(null);
    setBrowseLoading(true);
    try {
      const result = await apiFetch(`/api/fs/ls?path=${encodeURIComponent(newPath)}`);
      setBrowseEntries(result.entries || []);
      setBrowsePath(result.path);
    } catch (err) {
      setBrowseError(err.message || "Could not list directory.");
      setBrowseEntries([]);
    } finally {
      setBrowseLoading(false);
    }
  };

  const selectBrowsePath = () => {
    if (browseTarget === "archive") updateMirrorWorkflow({ archivePath: browsePath });
    else if (browseTarget === "workspace") updateMirrorWorkflow({ workspacePath: browsePath });
    else if (browseTarget === "cache") updateMirrorWorkflow({ cachePath: browsePath });
    else if (browseTarget === "imageset-config") updateMirrorWorkflow({ configPath: browsePath });
    setBrowseOpen(false);
  };

  useEffect(() => {
    if (!lastRunJobId) return;
    apiFetch(`/api/jobs/${lastRunJobId}`)
      .then((job) => setLastRunJob(job))
      .catch(() => setLastRunJob(null));
  }, [lastRunJobId]);

  useEffect(() => {
    if (!runningJobId) return;
    const interval = setInterval(() => {
      apiFetch(`/api/jobs/${runningJobId}`).then((job) => {
        setLastRunJob(job);
        if (["completed", "completed_with_warnings", "failed", "cancelled"].includes(job.status)) {
          setRunningJobId(null);
          updateMirrorWorkflow({ lastRunJobId: job.id });
          let completeMeta = null;
          try { completeMeta = job.metadata_json ? JSON.parse(job.metadata_json) : null; } catch {}
          setOcMirrorCompleteModal({ job, meta: completeMeta });
        }
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [runningJobId, updateMirrorWorkflow]);

  const hasRetainedRhSecret = Boolean(state?.blueprint?.blueprintRetainPullSecret && state?.blueprint?.blueprintPullSecretEphemeral);
  const hasMirrorSecret = Boolean(state?.credentials?.mirrorRegistryPullSecret);

  useEffect(() => {
    apiFetch("/api/secrets/rh-pull-secret")
      .then((d) => setMountedRhAvailable(Boolean(d.available)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!hasRetainedRhSecret && rhAuthSource === "retained") setRhAuthSource("pasted");
  }, [hasRetainedRhSecret, rhAuthSource]);

  useEffect(() => {
    if (rhAuthSource === "mounted" && !mountedRhAvailable) setRhAuthSource("pasted");
  }, [mountedRhAvailable, rhAuthSource]);

  useEffect(() => {
    if (!hasMirrorSecret && mirrorAuthSource === "reuse") setMirrorAuthSource("pasted");
  }, [hasMirrorSecret, mirrorAuthSource]);

  // Scroll to preflight results when they appear (prevents scroll reset to top)
  useEffect(() => {
    if (preflightResult && preflightResultsRef.current) {
      // Small delay to ensure DOM has updated
      setTimeout(() => {
        preflightResultsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
      }, 100);
    }
  }, [preflightResult]);

  if (!state) return <div className="step"><div className="loading">Loading…</div></div>;

  const runPreflight = async () => {
    setPreflightLoading(true);
    setPreflightResult(null);
    try {
      // Map frontend auth source values to backend schema values
      // Frontend: "retained" or "pasted" → Backend: "inline" (pull secret in body)
      // Frontend: "mounted" → Backend: "mounted" (pull secret from file)
      const mappedRhAuthSource = rhAuthSource === "mounted" ? "mounted" : "inline";
      const mappedMirrorAuthSource = mirrorAuthSource === "reuse" ? "reuse" : "inline";

      const body = {
        mode,
        archivePath: mode !== "mirrorToMirror" ? archivePath : undefined,
        workspacePath: mode === "mirrorToMirror" ? workspacePath : undefined,
        cachePath: mode !== "mirrorToMirror" ? cachePath : undefined,
        registryUrl: mode !== "mirrorToDisk" ? registryUrl : undefined,
        configSourceType,
        configPath: configSourceType === "external" ? configPath : undefined,
        rhAuthSource: mode !== "diskToMirror" ? mappedRhAuthSource : undefined,
        rhPullSecret: mode !== "diskToMirror" && rhAuthSource !== "mounted"
          ? (rhAuthSource === "retained" ? state?.blueprint?.blueprintPullSecretEphemeral : rhPullSecretPaste) || undefined
          : undefined,
        mirrorAuthSource: mode !== "mirrorToDisk" ? mappedMirrorAuthSource : undefined,
        mirrorPullSecret: mode !== "mirrorToDisk" && mirrorAuthSource === "pasted" ? mirrorPullSecretPaste || undefined : undefined,
        advanced: {
          logLevel,
          parallelImages,
          parallelLayers,
          imageTimeout,
          retryTimes,
          retryDelay,
          since: since || undefined,
          strictArchive,
          signatureOptions: {
            disableCertified,
            disableCommunity
          },
          removeSignatures
        }
      };
      const result = await apiFetch("/api/ocmirror/preflight", { method: "POST", body: JSON.stringify(body) });
      setPreflightResult(result);
    } catch (err) {
      // Extract and translate validation errors to human-readable messages
      const blockers = [];
      const fieldErrors = {};

      if (err.payload?.details && Array.isArray(err.payload.details)) {
        // Schema validation errors from validateBody middleware
        err.payload.details.forEach(detail => {
          const humanMsg = translateValidationError(detail.path, detail.message);
          blockers.push(humanMsg);
          // Also map to fieldErrors for inline display
          if (detail.path) {
            fieldErrors[detail.path] = {
              severity: "blocker",
              message: humanMsg
            };
          }
        });
      } else {
        blockers.push(err.message || "Preflight failed.");
      }

      setPreflightResult({ ok: false, blockers, warnings: [], checks: {}, fieldErrors });
    } finally {
      setPreflightLoading(false);
    }
  };

  // Translate technical schema validation errors to human-readable messages
  const translateValidationError = (path, message) => {
    // Field name mappings
    const fieldLabels = {
      archivePath: "Archive directory",
      workspacePath: "Workspace directory",
      cachePath: "Cache directory",
      registryUrl: "Registry URL",
      configPath: "Config file path",
      rhAuthSource: "Red Hat authentication source",
      rhPullSecret: "Red Hat pull secret",
      mirrorAuthSource: "Mirror registry authentication source",
      mirrorPullSecret: "Mirror registry pull secret",
      configSourceType: "Config source type"
    };

    const fieldLabel = fieldLabels[path] || path;

    // Common validation error translations
    if (message.includes("Required")) {
      return `${fieldLabel} is required for this workflow mode.`;
    }
    if (message.includes("Invalid enum value")) {
      return `${fieldLabel} has an invalid value. Please refresh the page and try again.`;
    }
    if (message.includes("Pull secret must be valid JSON")) {
      return `${fieldLabel} must be valid JSON with an "auths" object. Check the format and try again.`;
    }
    if (message.includes("String must contain at least")) {
      return `${fieldLabel} cannot be empty.`;
    }
    if (message.includes("at most") || message.includes("too long")) {
      return `${fieldLabel} is too long. Maximum allowed length is 2048 characters.`;
    }

    // Default: return translated field name with original message
    return `${fieldLabel}: ${message}`;
  };

  const runOcMirror = async () => {
    setRunError(null);

    // Map frontend auth source values to backend schema values
    const mappedRhAuthSource = rhAuthSource === "mounted" ? "mounted" : "inline";
    const mappedMirrorAuthSource = mirrorAuthSource === "reuse" ? "reuse" : "inline";

    const body = {
      mode,
      dryRun,
      archivePath: mode !== "mirrorToMirror" ? archivePath : undefined,
      workspacePath: mode === "mirrorToMirror" ? workspacePath : undefined,
      cachePath: mode !== "mirrorToMirror" ? cachePath : undefined,
      registryUrl: mode !== "mirrorToDisk" ? registryUrl : undefined,
      configSourceType,
      configPath: configSourceType === "external" ? configPath : undefined,
      rhAuthSource: mode !== "diskToMirror" ? mappedRhAuthSource : undefined,
      rhPullSecret: mode !== "diskToMirror" && rhAuthSource !== "mounted"
        ? (rhAuthSource === "retained" ? state?.blueprint?.blueprintPullSecretEphemeral : rhPullSecretPaste) || undefined
        : undefined,
      mirrorAuthSource: mode !== "mirrorToDisk" ? mappedMirrorAuthSource : undefined,
      mirrorPullSecret: mode !== "mirrorToDisk" && mirrorAuthSource === "pasted" ? mirrorPullSecretPaste || undefined : undefined,
      advanced: {
        logLevel,
        parallelImages,
        parallelLayers,
        imageTimeout,
        retryTimes,
        retryDelay,
        since: since || undefined,
        strictArchive,
        signatureOptions: {
          disableCertified,
          disableCommunity
        },
        removeSignatures
      }
    };
    try {
      const { jobId } = await apiFetch("/api/ocmirror/run", { method: "POST", body: JSON.stringify(body) });
      setRunningJobId(jobId);
      updateMirrorWorkflow({ lastRunJobId: jobId });
    } catch (err) {
      setRunError(err.message || "Run failed.");
    }
  };

  const confirmAndRun = () => {
    setShowRunConfirmation(false);
    runOcMirror();
  };

  const stopRun = async () => {
    if (!runningJobId) return;
    try {
      await apiFetch(`/api/jobs/${runningJobId}/stop`, { method: "POST" });
      setRunningJobId(null);
    } catch (err) {
      console.error(err);
    }
  };

  const goToOperations = (jobId) => {
    if (onNavigateToOperations) {
      onNavigateToOperations(jobId);
    } else {
      updateState({ ui: { ...state.ui, activeStepId: "operations", highlightJobId: jobId || undefined } });
    }
  };

  const hasBlockers = preflightResult && Array.isArray(preflightResult.blockers) && preflightResult.blockers.length > 0;
  const canRun = preflightResult && !hasBlockers;
  const isRunning = Boolean(runningJobId);
  let meta = null;
  if (lastRunJob?.metadata_json) {
    try {
      meta = typeof lastRunJob.metadata_json === "string"
        ? JSON.parse(lastRunJob.metadata_json)
        : lastRunJob.metadata_json;
    } catch {
      meta = null;
    }
  }

  const renderFieldError = (fieldName) => {
    if (!preflightResult || !preflightResult.fieldErrors) return null;
    const error = preflightResult.fieldErrors[fieldName];
    if (!error) return null;

    const isBlocker = error.severity === "blocker";
    return (
      <div
        style={{
          marginTop: 4,
          padding: "4px 8px",
          borderRadius: 4,
          fontSize: "0.8125rem",
          lineHeight: 1.4,
          background: isBlocker ? "var(--color-danger-bg, rgba(220, 38, 38, 0.1))" : "var(--color-warning-bg, rgba(245, 158, 11, 0.1))",
          color: isBlocker ? "var(--color-danger, #dc2626)" : "var(--color-warning, #b87800)",
          border: `1px solid ${isBlocker ? "var(--color-danger, #dc2626)" : "var(--color-warning, #b87800)"}`
        }}
      >
        {isBlocker ? "⚠️ " : "⚠ "}{error.message}
      </div>
    );
  };

  return (
    <div className="step">
      <div className="step-header">
        <div className="step-header-main">
          <h2>Run oc-mirror</h2>
          <p className="subtle">
            Run oc-mirror on this machine using your generated or external imageset-config. Paths and credentials are
            used only for this run and not stored.
          </p>
        </div>
      </div>
      <div className="step-body">
        <p className="note subtle">
          Delete and reset workspace are not available in this version. Use the paths below to continue manually
          outside the app if needed.
        </p>

        {/* 1. Mode */}
        <section className="card">
          <div className="card-header">
            <h3 className="card-title">Choose workflow</h3>
          </div>
          <div className="card-body">
            {WORKFLOW_GROUPS.map((group) => {
              const groupActive = group.modes.some((m) => m.value === mode);
              return (
                <div key={group.label} className={`workflow-group ${groupActive ? "workflow-group-active" : ""}`}>
                  <div className="workflow-group-header">
                    <div className="workflow-group-title">{group.label}</div>
                    <div className="workflow-group-description">{group.description}</div>
                  </div>
                  <div className="workflow-group-modes">
                    {group.modes.map((m) => (
                      <OptionRow
                        key={m.value}
                        title={m.label}
                        description={m.help}
                        htmlFor={`ocmirror-mode-${m.value}`}
                      >
                        <input
                          type="radio"
                          id={`ocmirror-mode-${m.value}`}
                          name="ocmirror-mode"
                          checked={mode === m.value}
                          onChange={() => updateMirrorWorkflow({ mode: m.value })}
                        />
                      </OptionRow>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 2. Config source */}
        <section className="card">
          <div className="card-header">
            <h3 className="card-title">Image set config</h3>
            <div className="card-subtitle">Use generated config from this app or an external file.</div>
          </div>
          <div className="card-body">
            <OptionRow
              title="Use generated imageset-config"
              description="Build config from current Blueprint and Connectivity & Mirroring settings."
              htmlFor="ocmirror-config-generated"
            >
              <input
                type="radio"
                id="ocmirror-config-generated"
                name="ocmirror-config-source"
                checked={configSourceType === "generated"}
                onChange={() => updateMirrorWorkflow({ configSourceType: "generated", configPath: "" })}
              />
            </OptionRow>
            <OptionRow
              title="External file"
              description="Path to an existing ImageSetConfiguration YAML file."
              htmlFor="ocmirror-config-external"
            >
              <input
                type="radio"
                id="ocmirror-config-external"
                name="ocmirror-config-source"
                checked={configSourceType === "external"}
                onChange={() => updateMirrorWorkflow({ configSourceType: "external" })}
              />
            </OptionRow>
            {configSourceType === "external" ? (
              <div>
                <FieldLabelWithInfo label="Config file path" hint={`Container-internal path to your ImageSetConfiguration YAML file - the config that defines which images to mirror (OpenShift releases, operators, additional images).

**What is this:**
The ImageSetConfiguration YAML is the master list of what to mirror: OpenShift version(s), operator catalogs, Helm charts, and any additional container images you need.

**File location:**
Must be a path inside the backend container's filesystem. Since the backend mounts your host's directory to /data, place your config YAML in that mounted directory. Example: if you mounted ~/ocp-mirror to /data, and your config is ~/ocp-mirror/imageset-config.yaml, then enter /data/imageset-config.yaml here.

**Use the Browse button:**
Opens a file browser showing files in /data - easier than typing paths manually.

**Example:**
/data/my-imageset-config.yaml`}>
                  <div className="path-input-row">
                    <input
                      type="text"
                      value={localConfigPath}
                      onChange={(e) => setLocalConfigPath(e.target.value)}
                      onBlur={(e) => updateMirrorWorkflow({ configPath: e.target.value })}
                      placeholder="/data/my-imageset-config.yaml"
                    />
                    <Button variant="secondary" onClick={() => openBrowse("imageset-config", configPath || "/data/")}>
                      Browse…
                    </Button>
                  </div>
                </FieldLabelWithInfo>
                {renderFieldError("configPath")}
              </div>
            ) : null}
          </div>
        </section>

        {/* 3. Paths */}
        <section className="card">
          <div className="card-header">
            <h3 className="card-title">Paths</h3>
            <div className="card-subtitle" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span>
                {mode === "mirrorToDisk" && "Archive = destination for tar archives. Cache speeds up subsequent incremental runs. No workspace needed — the archive path serves that role."}
                {mode === "diskToMirror" && "Archive = source from a previous mirror-to-disk run. Cache is optional. Cluster-resources output is written inside the archive directory."}
                {mode === "mirrorToMirror" && "Workspace is required (cluster-resources output). No archive or cache needed."}
              </span>
              <button
                type="button"
                className="ghost"
                style={{ fontSize: "0.78rem", padding: "2px 8px", marginLeft: "auto", whiteSpace: "nowrap" }}
                onClick={resetPaths}
              >
                Reset to defaults
              </button>
            </div>
          </div>
          <div className="card-body">
            <CollapsibleSection title="Container paths & storage setup" defaultCollapsed={true}>
              <div style={{ fontSize: "0.875rem", lineHeight: 1.6 }}>
                <p style={{ margin: "0 0 8px" }}>
                  These paths are <strong>inside the backend container</strong>, backed by the <code>backend-data</code> Docker volume.
                  oc-mirror runs as a container process — paths here are container-internal, not host paths.
                </p>
                <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                      <th style={{ textAlign: "left", padding: "4px 8px 4px 0", fontWeight: 600 }}>Path</th>
                      <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>Size guidance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: "4px 8px 4px 0", verticalAlign: "top" }}><strong>Archive</strong></td>
                      <td style={{ padding: "4px 8px", verticalAlign: "top" }}>50–200+ GB per OCP release + operators. Empty dir for first run. Keep archives after a successful run for disk-to-mirror.</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 8px 4px 0", verticalAlign: "top" }}><strong>Workspace</strong></td>
                      <td style={{ padding: "4px 8px", verticalAlign: "top" }}>1–5 GB. Contains cluster-resources and metadata. Keep between runs to enable incremental mirroring (--since).</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 8px 4px 0", verticalAlign: "top" }}><strong>Cache</strong></td>
                      <td style={{ padding: "4px 8px", verticalAlign: "top" }}>5–50+ GB. Image layer cache — safe to delete (rebuilds automatically), but keeping it saves significant time on subsequent runs. Not used in mirror-to-mirror mode.</td>
                    </tr>
                  </tbody>
                </table>
                <p style={{ margin: "0 0 4px", fontWeight: 600 }}>Mounting external storage (large mirrors):</p>
                <p style={{ margin: "0 0 4px" }}>Create a <code>compose.override.yml</code> in the same directory as <code>docker-compose.yml</code>:</p>
                <pre style={{ background: "var(--code-bg)", color: "var(--code-color)", padding: "8px 12px", borderRadius: 4, overflowX: "auto", margin: "0 0 12px", fontSize: "0.8rem" }}>{`services:
  backend:
    volumes:
      - /path/to/large-drive/oc-mirror:/data/oc-mirror`}</pre>
                <p style={{ margin: "0 0 4px" }}>Then restart:</p>
                <pre style={{ background: "var(--code-bg)", color: "var(--code-color)", padding: "8px 12px", borderRadius: 4, overflowX: "auto", margin: "0 0 12px", fontSize: "0.8rem" }}>{`podman compose down --remove-orphans && podman compose up --build -d`}</pre>
                <p style={{ margin: "0 0 4px", fontWeight: 600 }}>Container management commands:</p>
                <p style={{ margin: "0 0 2px" }}>Rebuild &amp; restart (data preserved):</p>
                <pre style={{ background: "var(--code-bg)", color: "var(--code-color)", padding: "8px 12px", borderRadius: 4, overflowX: "auto", margin: "0 0 6px", fontSize: "0.8rem" }}>{`podman compose down --remove-orphans && podman image prune -f && podman compose up --build -d
docker compose down --remove-orphans && docker image prune -f && docker compose up --build -d`}</pre>
                <p style={{ margin: "0 0 2px" }}>Full reset — <strong>DESTROYS all mirrored data in named volume</strong>:</p>
                <pre style={{ background: "var(--code-bg)", color: "var(--code-color)", padding: "8px 12px", borderRadius: 4, overflowX: "auto", margin: "0 0 0", fontSize: "0.8rem" }}>{`podman compose down -v --remove-orphans && podman image prune -f && podman compose up --build -d
docker compose down -v --remove-orphans && docker image prune -f && docker compose up --build -d`}</pre>
              </div>
            </CollapsibleSection>

            {(mode === "mirrorToDisk" || mode === "diskToMirror") && (
              <div>
                <FieldLabelWithInfo
                  label={mode === "mirrorToDisk" ? "Archive directory (destination)" : "Archive directory (source)"}
                  hint={mode === "mirrorToDisk"
                    ? `Destination directory for oc-mirror tar archives and working-dir. Container-internal path under /data.

**Storage requirements:**
Typically 50-200+ GB for a full OCP + operator mirror

**Important:**
Should be empty (or contain only prior run archives) before the first mirror-to-disk run

**Keep archives:**
Keep archives after a successful run — they are the input for disk-to-mirror

**Example:**
/data/archive`
                    : `Source directory containing tar archives from a previous mirror-to-disk run. Must contain the working-dir structure written by oc-mirror. Container-internal path under /data.

**Example:**
/data/archive`}
                >
                  <div className="path-input-row">
                    <input
                      type="text"
                      value={localArchivePath}
                      onChange={(e) => setLocalArchivePath(e.target.value)}
                      onBlur={(e) => updateMirrorWorkflow({ archivePath: e.target.value })}
                      placeholder={DEFAULT_ARCHIVE_PATH}
                    />
                    <Button variant="secondary" onClick={() => openBrowse("archive", archivePath || DEFAULT_ARCHIVE_PATH)}>
                      Browse…
                    </Button>
                  </div>
                </FieldLabelWithInfo>
                {renderFieldError("archivePath")}
              </div>
            )}
            {mode === "mirrorToMirror" && (
              <div>
                <FieldLabelWithInfo
                  label="Workspace directory"
                  hint={`Required directory where oc-mirror stores metadata and generates cluster-resources output. Container-internal path under /data.

**Storage requirements:**
Typically 1-5 GB

**What is this:**
oc-mirror creates a working-dir/ subdirectory here containing:
• Mirror metadata (what was mirrored, when, versions)
• Cluster-resources/ directory with YAML manifests for ImageContentSourcePolicy/CatalogSource
• Metadata for incremental mirror tracking

**Why it matters:**
The metadata is essential for:
1. Incremental mirrors (oc-mirror uses it to determine what's new/changed since last run)
2. Installing OpenShift (cluster-resources/ contains ICSP/CatalogSource manifests you apply to the cluster)
3. Troubleshooting (logs and state for diagnosing mirror issues)

**Keep this directory:**
Do not delete the workspace between mirror runs if you want incremental mirroring. The working-dir/ metadata accumulates over time (1-5 GB).

**Example:**
/data/workspace (oc-mirror creates /data/workspace/working-dir/ inside)`}
                >
                  <div className="path-input-row">
                    <input
                      type="text"
                      value={localWorkspacePath}
                      onChange={(e) => setLocalWorkspacePath(e.target.value)}
                      onBlur={(e) => updateMirrorWorkflow({ workspacePath: e.target.value })}
                      placeholder={DEFAULT_WORKSPACE_PATH}
                    />
                    <Button variant="secondary" onClick={() => openBrowse("workspace", workspacePath || DEFAULT_WORKSPACE_PATH)}>
                      Browse…
                    </Button>
                  </div>
                </FieldLabelWithInfo>
                {renderFieldError("workspacePath")}
              </div>
            )}
            {mode !== "mirrorToMirror" && (
              <div>
                <FieldLabelWithInfo
                  label="Cache directory"
                  hint={`Persistent image layer cache directory. Significantly speeds up subsequent mirror runs by caching downloaded image layers. Container-internal path under /data.

**Storage requirements:**
Typically 5-50+ GB depending on how many images you mirror

**What is this:**
When oc-mirror downloads images, it caches the individual layers (filesystem chunks) in this directory. On subsequent runs, if an image layer already exists in cache, oc-mirror skips re-downloading it, saving time and bandwidth.

**Why it matters:**
Without cache, every mirror run downloads all layers from scratch - wasteful for large mirrors. With cache, subsequent runs (re-syncing catalogs, mirroring new OpenShift versions, incremental updates) are MUCH faster. The first run populates the cache; later runs benefit.

**Safe to delete:**
If you delete the cache directory, oc-mirror automatically recreates it on the next run. You'll lose the speed benefit for that run, but no data loss. Deleting cache is useful if you're low on disk space and willing to re-download layers.

**Not used in mirror-to-mirror mode:**
In mirror-to-mirror, oc-mirror pulls directly from source registry and pushes to destination registry without creating tar archives, so there's no layer caching step.

**Example:**
/data/cache (grows to 10-50GB+ over time)`}
                >
                  <div className="path-input-row">
                    <input
                      type="text"
                      value={localCachePath}
                      onChange={(e) => setLocalCachePath(e.target.value)}
                      onBlur={(e) => updateMirrorWorkflow({ cachePath: e.target.value })}
                      placeholder={DEFAULT_CACHE_PATH}
                    />
                    <Button variant="secondary" onClick={() => openBrowse("cache", cachePath || DEFAULT_CACHE_PATH)}>
                      Browse…
                    </Button>
                  </div>
                </FieldLabelWithInfo>
                {renderFieldError("cachePath")}
              </div>
            )}
          </div>
        </section>

        {/* 4. Destination / registry */}
        {(mode === "diskToMirror" || mode === "mirrorToMirror") ? (
          <section className="card">
            <div className="card-header">
              <h3 className="card-title">Mirror registry</h3>
              <div className="card-subtitle">Destination registry (e.g. docker://registry.local:5000).</div>
            </div>
            <div className="card-body">
              <div>
                <FieldLabelWithInfo
                  label="Registry URL"
                  hint={`Destination mirror registry URL where oc-mirror will push images. Must use docker:// prefix and be network-reachable from the machine running this backend container.

**Format:**
docker://registry.example.com:5000
docker://10.90.10.50:5000

**What is this:**
The container registry (Harbor, Red Hat Quay, Docker Registry, etc.) in your airgap environment where mirrored images will be stored. This registry serves images to your OpenShift cluster during installation and ongoing operations.

**Requirements:**
1. **Network reachability:** The backend container must be able to reach this registry's IP/hostname and port. Test with 'curl' or 'podman login' from the host before mirroring.
2. **Authentication:** If the registry requires login (most production registries do), you must provide credentials in the 'Identity & Access' tab under 'Mirror registry pull secret'.
3. **Sufficient storage:** The registry needs storage for all mirrored images - typically 50-200+ GB for a full OpenShift + operators mirror.
4. **TLS/HTTPS:** For production, use TLS certificates. For testing, you can use insecure registries (requires podman/docker config changes).

**Port:**
Typically 5000 for Docker Registry, 443 for Harbor/Quay with TLS, or custom ports.

**Example:**
docker://registry.internal.corp:5000`}
                >
                  <input
                    type="text"
                    value={localRegistryUrl}
                    onChange={(e) => setLocalRegistryUrl(e.target.value)}
                    onBlur={(e) => updateMirrorWorkflow({ registryUrl: e.target.value })}
                    placeholder="docker://registry.local:5000"
                  />
                </FieldLabelWithInfo>
                {renderFieldError("registryUrl")}
              </div>
            </div>
          </section>
        ) : null}

        {/* 5. Auth */}
        <section className="card">
          <div className="card-header">
            <h3 className="card-title">Authentication</h3>
            <div className="card-subtitle">Credentials are used for this run only and are not stored.</div>
          </div>
          <div className="card-body">
            {/* Red Hat credentials — shown for mirrorToDisk and mirrorToMirror */}
            {(mode === "mirrorToDisk" || mode === "mirrorToMirror") && (
              <div>
                {mode === "mirrorToMirror" && (
                  <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.5rem" }}>Red Hat source credentials</div>
                )}
                <div style={{ fontSize: "0.8rem", color: "var(--text-subtle)", marginBottom: "0.75rem" }}>
                  Red Hat pull secret authenticates to registry.redhat.io and quay.io.
                </div>
                {(mountedRhAvailable || hasRetainedRhSecret) ? (
                  <>
                    {mountedRhAvailable && (
                      <OptionRow
                        title="Use mounted Red Hat pull secret"
                        description="Use the pull secret file detected in the container."
                        htmlFor="ocmirror-rh-auth-mounted"
                      >
                        <input
                          type="radio"
                          id="ocmirror-rh-auth-mounted"
                          name="ocmirror-rh-auth"
                          checked={rhAuthSource === "mounted"}
                          onChange={() => setRhAuthSource("mounted")}
                        />
                      </OptionRow>
                    )}
                    {hasRetainedRhSecret && (
                      <OptionRow
                        title="Use retained Red Hat pull secret from Blueprint"
                        description="The pull secret retained in the Blueprint step will be used."
                        htmlFor="ocmirror-rh-auth-retained"
                      >
                        <input
                          type="radio"
                          id="ocmirror-rh-auth-retained"
                          name="ocmirror-rh-auth"
                          checked={rhAuthSource === "retained"}
                          onChange={() => setRhAuthSource("retained")}
                        />
                      </OptionRow>
                    )}
                    <OptionRow
                      title="Paste Red Hat pull secret for this run"
                      description="Supply a Red Hat pull secret only for this run. Not saved."
                      htmlFor="ocmirror-rh-auth-pasted"
                    >
                      <input
                        type="radio"
                        id="ocmirror-rh-auth-pasted"
                        name="ocmirror-rh-auth"
                        checked={rhAuthSource === "pasted"}
                        onChange={() => setRhAuthSource("pasted")}
                      />
                    </OptionRow>
                    {rhAuthSource === "pasted" && (
                      <div className="credentials-field-constrained">
                        <SecretInput
                          label="Red Hat pull secret"
                          hint={`Red Hat pull secret for this oc-mirror run (not stored).

**What is this:**
Authentication credentials for pulling OpenShift and operator images from Red Hat registries (registry.redhat.io and quay.io) during this oc-mirror run.

**When needed:**
Required for oc-mirror to authenticate when mirroring content from Red Hat:
• **diskToMirror mode:** Not needed (reading from local disk)
• **mirrorToMirror mode:** Required to pull from Red Hat registries
• **All modes with operators:** Required to mirror operator bundles

**Where to get it:**
Download from OpenShift Cluster Manager at console.redhat.com:
1. Log in with your Red Hat account
2. Navigate to OpenShift → Downloads
3. Click "Download pull secret"

**How it's used:**
Passed to oc-mirror via the \`--config\` imageset-config.yaml or as inline auth. oc-mirror uses it to authenticate when pulling images from Red Hat registries during the mirroring process.

**Alternative sources (above):**
• **Mounted:** Pull secret detected in container filesystem
• **Retained from Blueprint:** Pull secret saved from Blueprint tab

**Security:**
⚠️ **Used for this run only - not stored:**
• Ephemeral - discarded after this oc-mirror run completes
• Not saved to browser storage or state files
• Not exported in bundles
• Provide again for future runs

**Format:**
Standard Red Hat pull secret JSON:
\`\`\`json
{
  "auths": {
    "cloud.openshift.com": {"auth": "...", "email": "..."},
    "quay.io": {"auth": "...", "email": "..."},
    "registry.redhat.io": {"auth": "...", "email": "..."}
  }
}
\`\`\`

**Important:**
• Requires active Red Hat subscription or trial
• Separate from install-config pull secret (Identity & Access tab)
• Only used for oc-mirror mirroring operations`}
                          value={rhPullSecretPaste}
                          onChange={setRhPullSecretPaste}
                          placeholder="Paste, drag and drop, or upload Red Hat pull secret JSON"
                          rows={4}
                        />
                        {renderFieldError("rhPullSecret")}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="credentials-field-constrained">
                    <SecretInput
                      label="Red Hat pull secret"
                      hint={`Red Hat pull secret for this oc-mirror run (not stored).

**What is this:**
Authentication credentials for pulling OpenShift and operator images from Red Hat registries (registry.redhat.io and quay.io) during this oc-mirror run.

**When needed:**
Required for oc-mirror to authenticate when mirroring content from Red Hat:
• **diskToMirror mode:** Not needed (reading from local disk)
• **mirrorToMirror mode:** Required to pull from Red Hat registries
• **All modes with operators:** Required to mirror operator bundles

**Where to get it:**
Download from OpenShift Cluster Manager at console.redhat.com:
1. Log in with your Red Hat account
2. Navigate to OpenShift → Downloads
3. Click "Download pull secret"

**How it's used:**
Passed to oc-mirror via the \`--config\` imageset-config.yaml or as inline auth. oc-mirror uses it to authenticate when pulling images from Red Hat registries during the mirroring process.

**Security:**
⚠️ **Used for this run only - not stored:**
• Ephemeral - discarded after this oc-mirror run completes
• Not saved to browser storage or state files
• Not exported in bundles
• Provide again for future runs

**Format:**
Standard Red Hat pull secret JSON:
\`\`\`json
{
  "auths": {
    "cloud.openshift.com": {"auth": "...", "email": "..."},
    "quay.io": {"auth": "...", "email": "..."},
    "registry.redhat.io": {"auth": "...", "email": "..."}
  }
}
\`\`\`

**Important:**
• Requires active Red Hat subscription or trial
• Separate from install-config pull secret (Identity & Access tab)
• Only used for oc-mirror mirroring operations`}
                      value={rhPullSecretPaste}
                      onChange={setRhPullSecretPaste}
                      placeholder="Paste, drag and drop, or upload Red Hat pull secret JSON"
                      rows={4}
                    />
                    {renderFieldError("rhPullSecret")}
                  </div>
                )}
              </div>
            )}

            {/* Divider between sections for mirrorToMirror */}
            {mode === "mirrorToMirror" && <div className="divider" />}

            {/* Mirror registry credentials — shown for diskToMirror and mirrorToMirror */}
            {(mode === "diskToMirror" || mode === "mirrorToMirror") && (
              <div>
                {mode === "mirrorToMirror" && (
                  <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.5rem" }}>Mirror registry destination credentials</div>
                )}
                <div style={{ fontSize: "0.8rem", color: "var(--text-subtle)", marginBottom: "0.75rem" }}>
                  Mirror registry pull secret (same format as Red Hat pull secret) for authenticating to your local/disconnected registry.
                </div>
                {hasMirrorSecret ? (
                  <>
                    <OptionRow
                      title="Use mirror registry credentials from Identity & Access"
                      description="Use the pull secret already configured in the Identity & Access step."
                      htmlFor="ocmirror-mirror-auth-reuse"
                    >
                      <input
                        type="radio"
                        id="ocmirror-mirror-auth-reuse"
                        name="ocmirror-mirror-auth"
                        checked={mirrorAuthSource === "reuse"}
                        onChange={() => setMirrorAuthSource("reuse")}
                      />
                    </OptionRow>
                    <OptionRow
                      title="Paste mirror registry credentials for this run"
                      description="Supply credentials only for this run. Not saved."
                      htmlFor="ocmirror-mirror-auth-pasted"
                    >
                      <input
                        type="radio"
                        id="ocmirror-mirror-auth-pasted"
                        name="ocmirror-mirror-auth"
                        checked={mirrorAuthSource === "pasted"}
                        onChange={() => setMirrorAuthSource("pasted")}
                      />
                    </OptionRow>
                    {mirrorAuthSource === "pasted" && (
                      <div className="credentials-field-constrained">
                        <SecretInput
                          label="Mirror registry credentials"
                          hint={`Mirror registry pull secret for pushing images during this oc-mirror run (not stored).

**What is this:**
Authentication credentials for your local mirror registry where oc-mirror will push (upload) mirrored OpenShift images.

**When needed:**
Required for oc-mirror to authenticate when pushing to your mirror registry:
• **diskToMirror mode:** Required - pushing from disk to mirror registry
• **mirrorToMirror mode:** Required - pushing to destination mirror registry
• **All modes:** Required unless mirror registry allows anonymous pushes (not recommended)

**Format:**
Same JSON structure as Red Hat pull secret, but with your mirror registry hostname:
\`\`\`json
{
  "auths": {
    "registry.corp.local:5000": {
      "auth": "base64EncodedUsername:Password",
      "email": "optional@example.com"
    }
  }
}
\`\`\`

**How to create:**

**Option 1: Use podman/docker login**
\`\`\`bash
podman login registry.corp.local:5000
cat ~/.docker/config.json
# or
cat \${XDG_RUNTIME_DIR}/containers/auth.json
\`\`\`

**Option 2: Manual base64 encoding**
\`\`\`bash
echo -n 'username:password' | base64
# Use output in auth field
\`\`\`

**How it's used:**
oc-mirror uses these credentials to authenticate when pushing mirrored images to your registry. Combined with Red Hat pull secret (above) in mirrorToMirror mode.

**Alternative sources (above):**
• **Mounted:** Credentials detected in container filesystem
• **Retained from Identity & Access:** Credentials from install-config configuration

**Security:**
⚠️ **Used for this run only - not stored:**
• Ephemeral - discarded after oc-mirror run completes
• Not saved to browser storage or state files
• Not exported in bundles
• Provide again for future runs

**Important:**
• Credentials must match what's configured on your mirror registry
• Test with \`podman login\` before running oc-mirror
• Mirror registry must be accessible from where oc-mirror runs
• Same credentials used in install-config (Identity & Access tab) for cluster installations`}
                          value={mirrorPullSecretPaste}
                          onChange={setMirrorPullSecretPaste}
                          placeholder="Paste, drag and drop, or upload mirror registry credentials JSON"
                          rows={4}
                        />
                        {renderFieldError("mirrorPullSecret")}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="credentials-field-constrained">
                    <SecretInput
                      label="Mirror registry credentials"
                      hint={`Mirror registry pull secret for pushing images during this oc-mirror run (not stored).

**What is this:**
Authentication credentials for your local mirror registry where oc-mirror will push (upload) mirrored OpenShift images.

**When needed:**
Required for oc-mirror to authenticate when pushing to your mirror registry:
• **diskToMirror mode:** Required - pushing from disk to mirror registry
• **mirrorToMirror mode:** Required - pushing to destination mirror registry
• **All modes:** Required unless mirror registry allows anonymous pushes (not recommended)

**Format:**
Same JSON structure as Red Hat pull secret, but with your mirror registry hostname:
\`\`\`json
{
  "auths": {
    "registry.corp.local:5000": {
      "auth": "base64EncodedUsername:Password",
      "email": "optional@example.com"
    }
  }
}
\`\`\`

**How to create:**

**Option 1: Use podman/docker login**
\`\`\`bash
podman login registry.corp.local:5000
cat ~/.docker/config.json
# or
cat \${XDG_RUNTIME_DIR}/containers/auth.json
\`\`\`

**Option 2: Manual base64 encoding**
\`\`\`bash
echo -n 'username:password' | base64
# Use output in auth field
\`\`\`

**How it's used:**
oc-mirror uses these credentials to authenticate when pushing mirrored images to your registry. Combined with Red Hat pull secret (above) in mirrorToMirror mode.

**Security:**
⚠️ **Used for this run only - not stored:**
• Ephemeral - discarded after oc-mirror run completes
• Not saved to browser storage or state files
• Not exported in bundles
• Provide again for future runs

**Important:**
• Credentials must match what's configured on your mirror registry
• Test with \`podman login\` before running oc-mirror
• Mirror registry must be accessible from where oc-mirror runs
• Same credentials used in install-config (Identity & Access tab) for cluster installations

**Example:**
{"auths":{"mirror.example.com":{"auth":"dXNlcm5hbWU6cGFzc3dvcmQ="}}}`}
                      value={mirrorPullSecretPaste}
                      onChange={setMirrorPullSecretPaste}
                      placeholder='{"auths":{"mirror.example.com":{"auth":"..."}}}'
                      rows={4}
                    />
                    {renderFieldError("mirrorPullSecret")}
                  </div>
                )}
              </div>
            )}

            {mode === "mirrorToMirror" && (
              <div className="note" style={{ marginTop: 8 }}>
                Both credentials are combined into a single auth file for this run.
              </div>
            )}
          </div>
        </section>

        {/* 6. Signature Verification */}
        <CollapsibleSection title="Signature Verification" defaultCollapsed={true}>
          <div className="note" style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
            <strong>Background:</strong> Some certified and community operators have missing signature files (.sig) in their registries,
            causing oc-mirror to fail even though the images themselves are valid. This section lets you selectively disable
            signature verification for problematic registries while keeping it enabled for Red Hat operators (where signatures are consistently available).
          </div>

          <OptionRow
            title="Disable signature verification for certified operators"
            description="registry.connect.redhat.com — Recommended for certified operators like NetApp Trident that have missing signature files. Preserves Red Hat operator signatures."
          >
            <Switch
              checked={disableCertified}
              onChange={(v) => updateMirrorWorkflow({ disableCertified: v })}
              aria-label="Disable signature verification for certified operators"
            />
          </OptionRow>

          <OptionRow
            title="Disable signature verification for community operators"
            description="quay.io/operatorhubio — Recommended as community operators rarely provide signatures. Preserves Red Hat operator signatures."
          >
            <Switch
              checked={disableCommunity}
              onChange={(v) => updateMirrorWorkflow({ disableCommunity: v })}
              aria-label="Disable signature verification for community operators"
            />
          </OptionRow>

          <div className="divider" style={{ margin: "1rem 0" }} />

          <OptionRow
            title="Remove ALL signatures (emergency fallback)"
            description="Passes --remove-signatures flag to oc-mirror. Disables signature verification for ALL registries including Red Hat operators. Only use if registries.d approach above fails."
            warning={removeSignatures ? "⚠️ This disables signature verification for ALL operators including Red Hat operators. Use selective options above instead when possible." : null}
          >
            <Switch
              checked={removeSignatures}
              onChange={(v) => updateMirrorWorkflow({ removeSignatures: v })}
              aria-label="Remove all signatures (emergency fallback)"
            />
          </OptionRow>

          {!removeSignatures && !disableCertified && !disableCommunity && (
            <div className="note subtle" style={{ marginTop: "1rem", fontSize: "0.8125rem" }}>
              ℹ️ Signature verification enabled for all registries. If you encounter signature errors with certified or community operators,
              enable the options above to selectively disable verification for those registry types.
            </div>
          )}
        </CollapsibleSection>

        {/* 7. Advanced */}
        <CollapsibleSection title="Advanced options" defaultCollapsed={true}>
          {/* Toggle rows span full width */}
          <OptionRow
            title="Dry run (no mirror)"
            description="Print actions without actually mirroring images. Validates config and produces mapping.txt / missing.txt where applicable."
          >
            <Switch checked={dryRun} onChange={(v) => updateMirrorWorkflow({ dryRun: v })} />
          </OptionRow>
          {mode === "diskToMirror" && (
            <OptionRow
              title="Strict archive"
              description="Verify that all image layers referenced in the working-dir metadata are present in the archive before mirroring. Recommended when using archives created on different systems or transferred via unreliable methods (USB, network). Prevents partial mirrors by failing early if the archive is incomplete or corrupted. Adds validation overhead (~1-2 minutes for large archives), but ensures mirror integrity."
            >
              <Switch checked={strictArchive} onChange={(v) => updateMirrorWorkflow({ strictArchive: v })} />
            </OptionRow>
          )}
          {/* Advanced options grid with better organization */}
          <div className="ocmirror-advanced-options" style={{ marginTop: 16 }}>
            <h4 style={{ marginTop: 0, marginBottom: 12, fontSize: "0.9375rem", fontWeight: 600 }}>Performance & Parallelization</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem", marginBottom: 20 }}>
              <FieldLabelWithInfo
                label="Parallel images"
                hint={`Maximum number of container images to download/mirror simultaneously (1-32).

**Default:**
4 concurrent images

**Why it matters:**
Higher values speed up mirroring but consume more network bandwidth, memory, and registry connections

**When to increase:**
For fast networks (10Gbps+) with powerful systems, you can increase to 8-16

**When to decrease:**
For slow/unstable connections or limited bandwidth, reduce to 2-4

**Resource usage:**
Each concurrent image can use 100-500MB of RAM, so monitor memory usage on large mirrors

**Troubleshooting:**
If you see out-of-memory errors or registry throttling, reduce this value

**Example:**
Set to 8 for fast networks, 2 for slow connections`}
              >
                <input
                  type="number"
                  min={1}
                  max={32}
                  value={localParallelImages}
                  onChange={(e) => setLocalParallelImages(e.target.value)}
                  onBlur={(e) => updateMirrorWorkflow({ parallelImages: Number(e.target.value) || 4 })}
                />
              </FieldLabelWithInfo>
              <FieldLabelWithInfo
                label="Parallel layers"
                hint={`Maximum number of image layers to download concurrently (1-32).

**Default:**
5 concurrent layers

**What are layers:**
Layers are the individual filesystem chunks that make up container images

**Why it matters:**
Higher values can speed up mirroring for images with many layers, but also consume more network bandwidth and memory

**Recommendation:**
For most installations, the default (5) is sufficient. Only increase this if you have very fast networks (10Gbps+) AND you're mirroring images with many layers (20+ layers per image)

**Risk:**
Too high can cause memory exhaustion or registry throttling

**Works with Parallel images:**
Both settings affect overall mirror performance - tune them together

**Example:**
Set to 8 for very fast networks with large images, keep at 5 for most cases`}
              >
                <input
                  type="number"
                  min={1}
                  max={32}
                  value={localParallelLayers}
                  onChange={(e) => setLocalParallelLayers(e.target.value)}
                  onBlur={(e) => updateMirrorWorkflow({ parallelLayers: Number(e.target.value) || 5 })}
                />
              </FieldLabelWithInfo>
            </div>

            <h4 style={{ marginTop: 0, marginBottom: 12, fontSize: "0.9375rem", fontWeight: 600 }}>Timeouts & Retries</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: 20 }}>
              <FieldLabelWithInfo
                label="Image timeout"
                hint={`Maximum time allowed to download a single container image before timing out.

**Default:**
10m (10 minutes)

**Format:**
Go duration format: 5m, 10m, 30m, 1h

**When to increase:**
Large images (2GB+ for databases, AI/ML workloads) on slow connections may need longer timeouts - increase to 30m or 1h

**When to decrease:**
For fast networks (1Gbps+), 5m is usually sufficient

**Trade-offs:**
Setting too short causes unnecessary timeout failures on large images; too long wastes time on stalled downloads

**Important:**
This timeout is per-image, not total mirror time

**Example:**
'5m' for fast networks, '30m' for slow connections or large images`}
              >
                <input
                  type="text"
                  value={localImageTimeout}
                  onChange={(e) => setLocalImageTimeout(e.target.value)}
                  onBlur={(e) => updateMirrorWorkflow({ imageTimeout: e.target.value })}
                  placeholder="10m"
                />
              </FieldLabelWithInfo>
              <FieldLabelWithInfo
                label="Retry times"
                hint={`Number of automatic retry attempts when an image pull/push fails (0-10).

**Default:**
2 retries

**Why retries help:**
Mirroring often encounters transient network errors, registry throttling, or temporary connection issues - retries help complete the mirror successfully without manual intervention

**When to increase:**
For unstable networks or busy registries, increase to 4-5

**When to keep low:**
For reliable high-speed connections, 2 is usually sufficient

**Not recommended:**
Set to 0 to fail immediately on any error (not recommended for production mirroring)

**Works with Retry delay:**
Each retry waits according to the 'Retry delay' setting below

**Example:**
Set to 4 for unstable networks, keep at 2 for stable connections`}
              >
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={localRetryTimes}
                  onChange={(e) => setLocalRetryTimes(e.target.value)}
                  onBlur={(e) => updateMirrorWorkflow({ retryTimes: Number(e.target.value) ?? 2 })}
                />
              </FieldLabelWithInfo>
              <FieldLabelWithInfo
                label="Retry delay"
                hint={`Time to wait between retry attempts.

**Default:**
1s (1 second)

**Format:**
Go duration format: 1s, 5s, 30s, 1m

**Why it matters:**
This delay gives transient errors time to resolve - for example, waiting for a registry rate limit to reset or a network connection to stabilize

**When to increase:**
For high-volume mirroring or registries with strict rate limits, increase to 5s-10s to avoid hammering the registry with repeated requests

**When to keep low:**
For fast, reliable networks, 1s is sufficient

**Trade-offs:**
Too short (less than 1s) might trigger rate limiting; too long (minutes) wastes time on permanent failures

**Example:**
Set to '10s' for registries with rate limits, keep at '1s' for fast networks`}
              >
                <input
                  type="text"
                  value={localRetryDelay}
                  onChange={(e) => setLocalRetryDelay(e.target.value)}
                  onBlur={(e) => updateMirrorWorkflow({ retryDelay: e.target.value })}
                  placeholder="1s"
                />
              </FieldLabelWithInfo>
            </div>

            <h4 style={{ marginTop: 0, marginBottom: 12, fontSize: "0.9375rem", fontWeight: 600 }}>General Settings</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem" }}>
              <FieldLabelWithInfo
                label="Log level"
                hint={`Verbosity level for oc-mirror command output.

**Default:**
'info' shows progress and important messages - good for normal operation

**Debug mode:**
'debug' shows detailed diagnostic information including HTTP requests, registry operations, and internal state - useful when troubleshooting mirror failures or investigating unexpected behavior

**Important:**
Debug logs can be very verbose (100s of MB for large mirrors), so use it only when diagnosing issues. Logs are saved to the Operations tab regardless of level.

**Example:**
Set to 'debug' when troubleshooting mirror failures or connection issues`}
            >
              <select
                value={logLevel}
                onChange={(e) => updateMirrorWorkflow({ logLevel: e.target.value })}
              >
                <option value="info">info</option>
                <option value="debug">debug</option>
              </select>
            </FieldLabelWithInfo>
            {mode === "mirrorToDisk" && (
              <FieldLabelWithInfo
                label="Since (incremental)"
                hint={`Timestamp or digest for incremental mirroring - only mirror images published after this point. Optional.

**What is this:**
Useful for reducing mirror time and bandwidth when you've already mirrored a base set of images and only want to sync newer content

**Format:**
• ISO 8601 timestamp: '2024-01-15T10:00:00Z'
• Image digest: 'sha256:abc123...'

**Use case:**
First mirror (full): Leave blank to mirror all images
Subsequent mirrors (incremental): Set to timestamp/digest from previous mirror to only pull new/updated images

**Important:**
This only works in mirror-to-disk mode (not mirror-to-mirror). The 'since' value is saved in oc-mirror's metadata after each run, so you can reference it for the next incremental mirror. Incremental mirroring significantly reduces bandwidth and time for regular sync operations.

**Example:**
'2024-06-01T00:00:00Z' to mirror only images published after June 1, 2024`}
              >
                <input
                  type="text"
                  value={localSince}
                  onChange={(e) => setLocalSince(e.target.value)}
                  onBlur={(e) => updateMirrorWorkflow({ since: e.target.value })}
                  placeholder=""
                />
              </FieldLabelWithInfo>
            )}
          </div>
          </div>
        </CollapsibleSection>

        {/* 7. Preflight and Run - Consolidated Actions */}
        <section className="card ocmirror-actions-section">
          <div className="card-header">
            <h3 className="card-title">Preflight & Run</h3>
            <div className="card-subtitle">Check configuration and paths, then start mirroring. View full logs in Operations tab.</div>
          </div>
          <div className="card-body">
            {runError ? (
              <div className="note warning" style={{ marginBottom: "1rem" }}>{runError}</div>
            ) : null}

            {/* Unified action buttons */}
            <div className="ocmirror-actions-row">
              <Button variant="secondary" onClick={runPreflight} disabled={preflightLoading} data-testid="run-preflight-btn">
                {preflightLoading ? "Running preflight…" : "Run preflight"}
              </Button>
              <Button
                variant="primary"
                onClick={() => setShowRunConfirmation(true)}
                disabled={!canRun || isRunning}
              >
                {isRunning ? "Running…" : "Run oc-mirror"}
              </Button>
              {isRunning ? (
                <Button variant="danger" onClick={stopRun}>Stop</Button>
              ) : null}
            </div>

            {/* Preflight results */}
            {preflightResult ? (
              <div ref={preflightResultsRef}>
                {preflightResult.blockers?.length > 0 ? (
                  <div className="note warning" style={{ marginTop: "1rem" }}>
                    <strong>Preflight blockers:</strong>
                    <ul style={{ margin: "0.5rem 0 0", paddingLeft: 20 }}>
                      {preflightResult.blockers.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {preflightResult.warnings?.length > 0 ? (
                  <div className="note" style={{ marginTop: "0.75rem" }}>
                    <strong>Preflight warnings:</strong>
                    <ul style={{ margin: "0.5rem 0 0", paddingLeft: 20 }}>
                      {preflightResult.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {preflightResult.ok && (!preflightResult.warnings || preflightResult.warnings.length === 0) ? (
                  <p className="note subtle" style={{ marginTop: "0.75rem" }}>✓ Preflight passed. Ready to run oc-mirror.</p>
                ) : null}
                {preflightResult.ok && preflightResult.warnings?.length > 0 ? (
                  <p className="note" style={{ marginTop: "0.75rem", color: "var(--color-warning, #b87800)" }}>
                    ⚠ Preflight passed with warnings. Review warnings above before proceeding.
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Last run summary */}
            {lastRunJob ? (
              <div className="run-oc-mirror-summary" style={{ marginTop: "1.5rem" }}>
                <h4 className="card-subtitle">Last run</h4>
                <p>
                  <strong>Status:</strong>{" "}
                  {lastRunJob.status === "completed_with_warnings" ? (
                    <span style={{ color: "var(--color-warning, #b87800)" }}>completed with warnings</span>
                  ) : lastRunJob.status}
                </p>
                {meta ? (
                  <>
                    <p><strong>Mode:</strong> {meta.mode}</p>
                    {meta.releaseResult ? (
                      <p><strong>Release images:</strong> {meta.releaseResult.succeeded} / {meta.releaseResult.total}</p>
                    ) : null}
                    {meta.operatorResult ? (
                      <p>
                        <strong>Operator images:</strong>{" "}
                        <span style={{ color: meta.operatorResult.succeeded < meta.operatorResult.total ? "var(--color-warning, #b87800)" : undefined }}>
                          {meta.operatorResult.succeeded} / {meta.operatorResult.total}
                        </span>
                        {meta.operatorResult.succeeded < meta.operatorResult.total ? " — re-run to retry" : ""}
                      </p>
                    ) : null}
                    {meta.archiveDir ? <p><strong>Archive dir:</strong> <code>{meta.archiveDir}</code></p> : null}
                    {meta.workspaceDir ? <p><strong>Workspace dir:</strong> <code>{meta.workspaceDir}</code></p> : null}
                    {meta.cacheDir ? <p><strong>Cache dir:</strong> <code>{meta.cacheDir}</code></p> : null}
                    {meta.clusterResourcesPath ? (
                      <p><strong>Cluster-resources:</strong> <code>{meta.clusterResourcesPath}</code></p>
                    ) : null}
                    {meta.dryRunMappingPath ? (
                      <p><strong>Dry-run mapping:</strong> <code>{meta.dryRunMappingPath}</code></p>
                    ) : null}
                    {meta.dryRunMissingPath ? (
                      <p><strong>Dry-run missing:</strong> <code>{meta.dryRunMissingPath}</code></p>
                    ) : null}
                    {meta.startedAt && meta.finishedAt ? (
                      <p><strong>Elapsed:</strong> {Math.round((meta.finishedAt - meta.startedAt) / 1000)}s</p>
                    ) : null}
                    {meta.fullCommand ? (
                      <div style={{ marginTop: "0.75rem" }}>
                        <strong>Command:</strong>
                        <pre style={{ marginTop: "0.5rem", padding: "6px 10px", background: "var(--code-bg)", color: "var(--code-color)", borderRadius: 4, fontSize: "0.78rem", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{meta.fullCommand}</pre>
                      </div>
                    ) : null}
                  </>
                ) : null}
                <p className="note subtle" style={{ marginTop: "0.75rem" }}>
                  To continue manually, use the paths above. Run oc-mirror from the command line with the same
                  workspace and cache for incremental runs.
                </p>
                <Button variant="ghost" onClick={() => goToOperations(lastRunJob?.id)} style={{ marginTop: "0.75rem" }}>
                  View full logs in Operations
                </Button>
              </div>
            ) : lastRunJobId && !lastRunJob ? (
              <p className="subtle" style={{ marginTop: "1.5rem" }}>Loading last run…</p>
            ) : null}
          </div>
        </section>
      </div>

      {/* oc-mirror completion modal */}
      {ocMirrorCompleteModal ? (() => {
        const { job, meta } = ocMirrorCompleteModal;
        const succeeded = job.status === "completed";
        const partial = job.status === "completed_with_warnings";
        const elapsed = meta?.startedAt && meta?.finishedAt
          ? Math.round((meta.finishedAt - meta.startedAt) / 1000)
          : null;
        const modeLabel = meta?.mode === "mirrorToDisk" ? "Mirror to disk"
          : meta?.mode === "diskToMirror" ? "Disk to mirror"
          : meta?.mode === "mirrorToMirror" ? "Mirror to mirror"
          : meta?.mode || "Unknown";
        const titleColor = succeeded ? undefined : partial ? "var(--color-warning, #b87800)" : "var(--color-danger)";
        const titleText = succeeded ? "oc-mirror completed"
          : partial ? "oc-mirror completed with warnings"
          : job.status === "cancelled" ? "oc-mirror cancelled"
          : "oc-mirror failed";
        return (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal">
              <h3 style={{ margin: "0 0 8px", color: titleColor }}>
                {titleText}
              </h3>
              {(succeeded || partial) ? (
                <>
                  <p className="modal-copy subtle">
                    {succeeded ? "The mirror run finished successfully." : "Release images mirrored successfully; some operator images failed."}
                  </p>
                  {meta && (
                    <dl className="modal-summary">
                      <dt>Workflow</dt><dd>{modeLabel}</dd>
                      {elapsed != null && <><dt>Elapsed</dt><dd>{elapsed}s</dd></>}
                      {meta.releaseResult && (
                        <><dt>Release images</dt><dd>{meta.releaseResult.succeeded} / {meta.releaseResult.total}</dd></>
                      )}
                      {meta.operatorResult && (
                        <><dt>Operator images</dt><dd style={{ color: meta.operatorResult.succeeded < meta.operatorResult.total ? "var(--color-warning, #b87800)" : undefined }}>{meta.operatorResult.succeeded} / {meta.operatorResult.total}</dd></>
                      )}
                      {meta.archiveDir && <><dt>Archive directory</dt><dd><code>{meta.archiveDir}</code></dd></>}
                      {meta.workspaceDir && <><dt>Workspace directory</dt><dd><code>{meta.workspaceDir}</code></dd></>}
                    </dl>
                  )}
                  {partial && meta?.failedImages?.length > 0 && (
                    <div className="note warning" style={{ marginTop: 12, fontSize: "0.82rem" }}>
                      <strong>Failed images:</strong>
                      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                        {meta.failedImages.map((img) => <li key={img}><code>{img}</code></li>)}
                      </ul>
                      <p style={{ marginTop: 6, marginBottom: 0 }}>These operators will be missing from your mirror. Re-run to retry, increase Image timeout in Advanced options, or remove them from your imageset config.</p>
                    </div>
                  )}
                  {partial && meta?.signatureFailures?.length > 0 && (
                    <div className="note warning" style={{ marginTop: 12, fontSize: "0.82rem" }}>
                      <strong>Signature Verification Failures Detected</strong>
                      <p style={{ marginTop: 4, marginBottom: 4 }}>
                        {meta.signatureFailures.length} image(s) failed signature verification due to missing .sig files:
                      </p>
                      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                        {meta.signatureFailures.map((path, idx) => (
                          <li key={idx}><code>{path}</code></li>
                        ))}
                      </ul>
                      {meta.retriedAs ? (
                        <div style={{ marginTop: 8, padding: 8, background: "#e8f4f8", borderRadius: 4, color: "#047857" }}>
                          ✅ Auto-retry launched with per-image signature disabling (Job #{meta.retriedAs})
                        </div>
                      ) : (
                        <p style={{ marginTop: 6, marginBottom: 0 }}>
                          ℹ️ Smart retry recommended: Re-run with per-image signature disabling for these paths only.
                        </p>
                      )}
                    </div>
                  )}
                  {!partial && meta?.mode === "mirrorToDisk" && meta?.archiveDir && (
                    <div className="note" style={{ marginTop: 12 }}>
                      <strong>Next steps:</strong> Transfer the contents of <code>{meta.archiveDir}</code> (tar archives and working-dir) across the air gap along with your other deliverables. You will need these files for the disk-to-mirror step on the disconnected side.
                    </div>
                  )}
                  {!partial && meta?.mode === "diskToMirror" && (
                    <div className="note" style={{ marginTop: 12 }}>
                      Images have been pushed to your mirror registry. Proceed to install or update your cluster.
                    </div>
                  )}
                  {!partial && meta?.mode === "mirrorToMirror" && (
                    <div className="note" style={{ marginTop: 12 }}>
                      Images have been mirrored directly to your registry. Proceed to install or update your cluster.
                    </div>
                  )}
                  {partial && meta?.mode === "mirrorToMirror" && (
                    <div className="note" style={{ marginTop: 12 }}>
                      Successfully mirrored release images are available in your registry. Re-run to retry failed operators.
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="modal-copy subtle">
                    {job.status === "cancelled" ? "The run was stopped." : "The run did not complete successfully."}
                  </p>
                  {job.message && (
                    <div className="note warning" style={{ marginBottom: 12 }}>{job.message}</div>
                  )}
                  <p style={{ fontSize: "0.875rem", color: "var(--text-subtle)" }}>
                    Open the Operations tab to view the full log output for this run.
                  </p>
                </>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                <Button variant="ghost" onClick={() => { setOcMirrorCompleteModal(null); goToOperations(job.id); }}>View logs in Operations</Button>
                <Button variant="primary" onClick={() => setOcMirrorCompleteModal(null)}>Dismiss</Button>
              </div>
            </div>
          </div>
        );
      })() : null}

      {/* Browse modal */}
      {browseOpen ? (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center"
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setBrowseOpen(false); }}
        >
          <div style={{
            background: "var(--card-bg)", borderRadius: 8, padding: 24, minWidth: 400, maxWidth: 560,
            maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 4px 32px rgba(0,0,0,0.18)"
          }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12, gap: 8 }}>
              <strong style={{ flex: 1, fontSize: "0.95rem", color: "inherit" }}>Browse directory</strong>
              <button type="button" onClick={() => setBrowseOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", color: "inherit", lineHeight: 1 }}>✕</button>
            </div>
            {browseMissingNotice && (
              <div style={{ marginBottom: 8, padding: "6px 10px", background: "var(--card-bg-subtle)", border: "1px solid var(--border-color)", borderRadius: 4, fontSize: "0.8rem", color: "var(--text-subtle)" }}>
                ℹ️ {browseMissingNotice}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <button
                type="button"
                className="ghost"
                style={{ fontSize: "0.78rem", padding: "2px 8px" }}
                onClick={() => {
                  const parent = browsePath.replace(/\/[^/]+$/, "") || "/";
                  if (parent !== browsePath) navigateBrowse(parent);
                }}
                disabled={browsePath === "/"}
              >
                ↑ Up
              </button>
              <code style={{ fontSize: "0.82rem", background: "var(--code-bg)", color: "var(--code-color)", padding: "2px 8px", borderRadius: 4, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {browsePath}
              </code>
            </div>
            <div style={{ flex: 1, overflowY: "auto", border: "1px solid var(--border-color)", borderRadius: 4, minHeight: 160 }}>
              {browseLoading ? (
                <div style={{ padding: 16, color: "var(--text-subtle)" }}>Loading…</div>
              ) : browseError ? (
                <div style={{ padding: 12 }}>
                  {/EACCES|EPERM|permission denied/i.test(browseError) ? (
                    <div className="note warning" style={{ fontSize: "0.82rem" }}>
                      <strong>Permission denied.</strong> The container cannot read this directory. Fix one or more of the following:
                      <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
                        <li><strong>SELinux (Fedora/RHEL/CentOS):</strong> Add <code>:Z</code> to the volume mount in <code>compose.override.yml</code>, then rebuild (<code>podman compose down --remove-orphans &amp;&amp; podman compose up --build -d</code>).</li>
                        <li><strong>Directory created with sudo:</strong> On your host, run <code>sudo chown $USER /path/to/oc-mirror</code> so the user running podman owns it.</li>
                        <li><strong>Wrong permissions:</strong> On your host, run <code>chmod 755 /path/to/oc-mirror</code>.</li>
                      </ul>
                      <div style={{ marginTop: 8, color: "var(--text-subtle)" }}>{browseError}</div>
                    </div>
                  ) : (
                    <div style={{ color: "var(--color-danger)", fontSize: "0.875rem" }}>{browseError}</div>
                  )}
                </div>
              ) : browseEntries.length === 0 ? (
                <div style={{ padding: 16, color: "var(--text-subtle)" }}>Empty directory</div>
              ) : browseEntries.map((entry) => {
                const isFileMode = browseTarget === "imageset-config";
                const isClickable = isFileMode ? entry.type === "file" : entry.type === "dir";
                const isHighlighted = isFileMode && entry.type === "file" && browsePath.endsWith("/" + entry.name);
                return (
                  <div
                    key={entry.name}
                    style={{
                      padding: "6px 12px",
                      cursor: isClickable || entry.type === "dir" ? "pointer" : "default",
                      color: isClickable ? "inherit" : "var(--text-subtle)",
                      display: "flex", alignItems: "center", gap: 8,
                      borderBottom: "1px solid var(--border-color)",
                      backgroundColor: isHighlighted ? "var(--bg-highlight)" : "transparent"
                    }}
                    onClick={() => {
                      if (entry.type === "dir") {
                        navigateBrowse(browsePath.replace(/\/$/, "") + "/" + entry.name);
                      } else if (isFileMode && entry.type === "file") {
                        // File mode: set browsePath to the file path
                        setBrowsePath(browsePath.replace(/\/$/, "") + "/" + entry.name);
                      }
                    }}
                  >
                    <span style={{ fontSize: "0.9rem" }}>{entry.type === "dir" ? "📁" : "📄"}</span>
                    <span style={{ flex: 1 }}>{entry.name}</span>
                    {entry.type === "file" && entry.size != null ? (
                      <span style={{ fontSize: "0.78rem", color: "var(--text-subtle)" }}>
                        {entry.size > 1073741824 ? `${(entry.size / 1073741824).toFixed(1)} GB`
                          : entry.size > 1048576 ? `${(entry.size / 1048576).toFixed(1)} MB`
                          : entry.size > 1024 ? `${(entry.size / 1024).toFixed(1)} KB`
                          : `${entry.size} B`}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => setBrowseOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={selectBrowsePath}>
                {browseTarget === "imageset-config" ? "Select" : "Select this directory"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Run confirmation modal */}
      <RunConfirmationModal
        isOpen={showRunConfirmation}
        onClose={() => setShowRunConfirmation(false)}
        onConfirm={confirmAndRun}
        config={{
          mode,
          dryRun,
          archivePath: mode !== "mirrorToMirror" ? archivePath : undefined,
          workspacePath: mode === "mirrorToMirror" ? workspacePath : undefined,
          cachePath: mode !== "mirrorToMirror" ? cachePath : undefined,
          registryUrl: mode !== "mirrorToDisk" ? registryUrl : undefined,
          configSourceType,
          advanced: {
            logLevel,
            parallelImages,
            parallelLayers,
            imageTimeout,
            retryTimes,
            retryDelay,
            since,
            strictArchive
          }
        }}
      />
    </div>
  );
}
