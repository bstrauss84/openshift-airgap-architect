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

  const updateMirrorWorkflow = useCallback(
    (patch) => updateState({ mirrorWorkflow: { ...mw, ...patch } }),
    [updateState, mw]
  );

  const resetPaths = () => {
    updateMirrorWorkflow({ archivePath: DEFAULT_ARCHIVE_PATH, workspacePath: DEFAULT_WORKSPACE_PATH, cachePath: DEFAULT_CACHE_PATH });
  };

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

  if (!state) return <div className="step"><div className="loading">Loading…</div></div>;

  const runPreflight = async () => {
    setPreflightLoading(true);
    setPreflightResult(null);
    try {
      const body = {
        mode,
        archivePath: mode !== "mirrorToMirror" ? archivePath : undefined,
        workspacePath: mode === "mirrorToMirror" ? workspacePath : undefined,
        cachePath: mode !== "mirrorToMirror" ? cachePath : undefined,
        registryUrl: mode !== "mirrorToDisk" ? registryUrl : undefined,
        configSourceType,
        configPath: configSourceType === "external" ? configPath : undefined,
        rhAuthSource: mode !== "diskToMirror" ? rhAuthSource : undefined,
        rhPullSecret: mode !== "diskToMirror" && rhAuthSource !== "mounted"
          ? (rhAuthSource === "retained" ? state?.blueprint?.blueprintPullSecretEphemeral : rhPullSecretPaste) || undefined
          : undefined,
        mirrorAuthSource: mode !== "mirrorToDisk" ? mirrorAuthSource : undefined,
        mirrorPullSecret: mode !== "mirrorToDisk" && mirrorAuthSource === "pasted" ? mirrorPullSecretPaste || undefined : undefined
      };
      const result = await apiFetch("/api/ocmirror/preflight", { method: "POST", body: JSON.stringify(body) });
      setPreflightResult(result);
    } catch (err) {
      // Extract validation details if available from schema validation errors
      const blockers = [];
      const fieldErrors = {};

      if (err.payload?.details && Array.isArray(err.payload.details)) {
        // Schema validation errors from validateBody middleware
        err.payload.details.forEach(detail => {
          const msg = `${detail.path}: ${detail.message}`;
          blockers.push(msg);
          // Also map to fieldErrors for inline display
          if (detail.path) {
            fieldErrors[detail.path] = {
              severity: "blocker",
              message: detail.message
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

  const runOcMirror = async () => {
    setRunError(null);
    const body = {
      mode,
      dryRun,
      archivePath: mode !== "mirrorToMirror" ? archivePath : undefined,
      workspacePath: mode === "mirrorToMirror" ? workspacePath : undefined,
      cachePath: mode !== "mirrorToMirror" ? cachePath : undefined,
      registryUrl: mode !== "mirrorToDisk" ? registryUrl : undefined,
      configSourceType,
      configPath: configSourceType === "external" ? configPath : undefined,
      rhAuthSource: mode !== "diskToMirror" ? rhAuthSource : undefined,
      rhPullSecret: mode !== "diskToMirror" && rhAuthSource !== "mounted"
        ? (rhAuthSource === "retained" ? state?.blueprint?.blueprintPullSecretEphemeral : rhPullSecretPaste) || undefined
        : undefined,
      mirrorAuthSource: mode !== "mirrorToDisk" ? mirrorAuthSource : undefined,
      mirrorPullSecret: mode !== "mirrorToDisk" && mirrorAuthSource === "pasted" ? mirrorPullSecretPaste || undefined : undefined,
      advanced: {
        logLevel,
        parallelImages,
        parallelLayers,
        imageTimeout,
        retryTimes,
        retryDelay,
        since: since || undefined,
        strictArchive
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
                <FieldLabelWithInfo label="Config file path" hint="Container-internal path to your ImageSetConfiguration YAML file. Must be accessible from within the backend container (typically under /data).">
                  <div className="path-input-row">
                    <input
                      type="text"
                      value={configPath}
                      onChange={(e) => updateMirrorWorkflow({ configPath: e.target.value })}
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
                    ? "Destination directory for oc-mirror tar archives and working-dir. Container-internal path under /data. Typically 50–200+ GB for a full OCP + operator mirror. Should be empty (or contain only prior run archives) before the first mirror-to-disk run. Keep archives after a successful run — they are the input for disk-to-mirror."
                    : "Source directory containing tar archives from a previous mirror-to-disk run. Must contain the working-dir structure written by oc-mirror. Container-internal path under /data."}
                >
                  <div className="path-input-row">
                    <input
                      type="text"
                      value={archivePath}
                      onChange={(e) => updateMirrorWorkflow({ archivePath: e.target.value })}
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
                  hint="Required. Directory for oc-mirror metadata and cluster-resources output (creates a working-dir/ subdirectory here). Container-internal path under /data. Typically 1–5 GB."
                >
                  <div className="path-input-row">
                    <input
                      type="text"
                      value={workspacePath}
                      onChange={(e) => updateMirrorWorkflow({ workspacePath: e.target.value })}
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
                  hint="Persistent image layer cache. Significantly speeds up subsequent runs. Container-internal path under /data. Safe to delete — oc-mirror rebuilds it automatically. Typically 5–50+ GB. Not used in mirror-to-mirror mode."
                >
                  <div className="path-input-row">
                    <input
                      type="text"
                      value={cachePath}
                      onChange={(e) => updateMirrorWorkflow({ cachePath: e.target.value })}
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
                  hint="Use docker:// prefix. Must be reachable from the machine running the backend."
                >
                  <input
                    type="text"
                    value={registryUrl}
                    onChange={(e) => updateMirrorWorkflow({ registryUrl: e.target.value })}
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
                      <div>
                        <SecretInput
                          label="Red Hat pull secret"
                          labelHint="Paste, drag-and-drop, or upload your Red Hat pull secret JSON from console.redhat.com. Used for this run only — not stored."
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
                  <div>
                    <SecretInput
                      label="Red Hat pull secret"
                      labelHint="Paste, drag-and-drop, or upload your Red Hat pull secret JSON from console.redhat.com. Used for this run only — not stored."
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
                      <div>
                        <SecretInput
                          label="Mirror registry credentials"
                          labelHint="Paste, drag-and-drop, or upload mirror registry auth JSON. Used for this run only — not stored."
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
                  <div>
                    <SecretInput
                      label="Mirror registry credentials"
                      labelHint='Paste, drag-and-drop, or upload mirror registry auth JSON. Used for this run only — not stored. Example: {"auths":{"mirror.example.com":{"auth":"base64string"}}}'
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

        {/* 6. Advanced */}
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
          {/* Advanced options grid with responsive layout */}
          <div className="advanced-options-grid">
            <FieldLabelWithInfo
              label="Log level"
              hint="Verbosity level for oc-mirror command output. 'info' (default) shows progress and important messages - good for normal operation. 'debug' shows detailed diagnostic information including HTTP requests, registry operations, and internal state - useful when troubleshooting mirror failures or investigating unexpected behavior. Debug logs can be very verbose (100s of MB for large mirrors), so use it only when diagnosing issues. Logs are saved to the Operations tab regardless of level."
              className="field-short"
            >
              <select
                value={logLevel}
                onChange={(e) => updateMirrorWorkflow({ logLevel: e.target.value })}
              >
                <option value="info">info</option>
                <option value="debug">debug</option>
              </select>
            </FieldLabelWithInfo>
            <FieldLabelWithInfo
              label="Parallel images"
              hint="Maximum number of container images to download/mirror simultaneously (1-32). Default is 4. Higher values speed up mirroring but consume more network bandwidth, memory, and registry connections. For fast networks (10Gbps+) with powerful systems, you can increase to 8-16. For slow/unstable connections or limited bandwidth, reduce to 2-4. Each concurrent image can use 100-500MB of RAM, so monitor memory usage on large mirrors. If you see out-of-memory errors or registry throttling, reduce this value."
              className="field-short"
            >
              <input
                type="number"
                min={1}
                max={32}
                value={parallelImages}
                onChange={(e) => updateMirrorWorkflow({ parallelImages: Number(e.target.value) || 4 })}
              />
            </FieldLabelWithInfo>
            <FieldLabelWithInfo
              label="Parallel layers"
              hint="Max concurrent layer pulls (1–32)."
              className="field-short"
            >
              <input
                type="number"
                min={1}
                max={32}
                value={parallelLayers}
                onChange={(e) => updateMirrorWorkflow({ parallelLayers: Number(e.target.value) || 5 })}
              />
            </FieldLabelWithInfo>
            <FieldLabelWithInfo
              label="Image timeout"
              hint="Timeout per image (e.g. 10m)."
              className="field-medium"
            >
              <input
                type="text"
                value={imageTimeout}
                onChange={(e) => updateMirrorWorkflow({ imageTimeout: e.target.value })}
                placeholder="10m"
              />
            </FieldLabelWithInfo>
            <FieldLabelWithInfo
              label="Retry times"
              hint="Number of automatic retry attempts when an image pull/push fails (0-10). Default is 2. Mirroring often encounters transient network errors, registry throttling, or temporary connection issues - retries help complete the mirror successfully without manual intervention. For unstable networks or busy registries, increase to 4-5. For reliable high-speed connections, 2 is usually sufficient. Set to 0 to fail immediately on any error (not recommended for production mirroring). Each retry waits according to the 'Retry delay' setting below."
              className="field-short"
            >
              <input
                type="number"
                min={0}
                max={10}
                value={retryTimes}
                onChange={(e) => updateMirrorWorkflow({ retryTimes: Number(e.target.value) ?? 2 })}
              />
            </FieldLabelWithInfo>
            <FieldLabelWithInfo
              label="Retry delay"
              hint="Time to wait between retry attempts (Go duration format: 1s, 5s, 30s, 1m). Default is 1s (1 second). This delay gives transient errors time to resolve - for example, waiting for a registry rate limit to reset or a network connection to stabilize. For high-volume mirroring or registries with strict rate limits, increase to 5s-10s to avoid hammering the registry with repeated requests. For fast, reliable networks, 1s is sufficient. Too short (less than 1s) might trigger rate limiting; too long (minutes) wastes time on permanent failures."
              className="field-medium"
            >
              <input
                type="text"
                value={retryDelay}
                onChange={(e) => updateMirrorWorkflow({ retryDelay: e.target.value })}
                placeholder="1s"
              />
            </FieldLabelWithInfo>
            {mode === "mirrorToDisk" && (
              <FieldLabelWithInfo
                label="Since (incremental)"
                hint="Only mirror images newer than this (ISO or digest). Optional."
                className="field-medium"
              >
                <input
                  type="text"
                  value={since}
                  onChange={(e) => updateMirrorWorkflow({ since: e.target.value })}
                  placeholder=""
                />
              </FieldLabelWithInfo>
            )}
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
              <>
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
                {preflightResult.ok ? (
                  <p className="note subtle" style={{ marginTop: "0.75rem" }}>✓ Preflight passed. Ready to run oc-mirror.</p>
                ) : null}
              </>
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
              ) : browseEntries.map((entry) => (
                <div
                  key={entry.name}
                  style={{
                    padding: "6px 12px", cursor: entry.type === "dir" ? "pointer" : "default",
                    color: entry.type === "dir" ? "inherit" : "var(--text-subtle)",
                    display: "flex", alignItems: "center", gap: 8,
                    borderBottom: "1px solid var(--border-color)"
                  }}
                  onClick={() => { if (entry.type === "dir") navigateBrowse(browsePath.replace(/\/$/, "") + "/" + entry.name); }}
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
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => setBrowseOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={selectBrowsePath}>Select this directory</Button>
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
