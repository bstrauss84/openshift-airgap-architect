/**
 * Run oc-mirror step (v1). Implementation contract: docs/OC_MIRROR_V2_RUN_TAB_RESEARCH_AND_PLAN.md §1–§9.
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

export default function RunOcMirrorStep() {
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
        if (["completed", "failed", "cancelled"].includes(job.status)) {
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
      setPreflightResult({ ok: false, blockers: [err.message || "Preflight failed."], warnings: [], checks: {} });
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
    updateState({ ui: { ...state.ui, activeStepId: "operations", highlightJobId: jobId || undefined } });
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
                <div key={group.label} style={{ marginBottom: 8 }}>
                  <div style={{
                    borderLeft: groupActive ? "3px solid #3b82f6" : "3px solid transparent",
                    paddingLeft: 10,
                    marginBottom: 6
                  }}>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{group.label}</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-subtle)", fontStyle: "italic" }}>{group.description}</div>
                  </div>
                  <div style={{ paddingLeft: 12 }}>
                    {group.modes.map((m) => (
                      <OptionRow
                        key={m.value}
                        title={m.label}
                        description={m.help}
                      >
                        <input
                          type="radio"
                          name="ocmirror-mode"
                          checked={mode === m.value}
                          onChange={() => updateMirrorWorkflow({ mode: m.value })}
                          aria-label={m.label}
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
            >
              <input
                type="radio"
                name="ocmirror-config-source"
                checked={configSourceType === "generated"}
                onChange={() => updateMirrorWorkflow({ configSourceType: "generated", configPath: "" })}
              />
            </OptionRow>
            <OptionRow
              title="External file"
              description="Path to an existing ImageSetConfiguration YAML file."
            >
              <input
                type="radio"
                name="ocmirror-config-source"
                checked={configSourceType === "external"}
                onChange={() => updateMirrorWorkflow({ configSourceType: "external" })}
              />
            </OptionRow>
            {configSourceType === "external" ? (
              <FieldLabelWithInfo label="Config file path" hint="Absolute or relative path to imageset-config YAML.">
                <input
                  type="text"
                  value={configPath}
                  onChange={(e) => updateMirrorWorkflow({ configPath: e.target.value })}
                  placeholder="/path/to/imageset-config.yaml"
                />
              </FieldLabelWithInfo>
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
              <FieldLabelWithInfo
                label={mode === "mirrorToDisk" ? "Archive directory (destination)" : "Archive directory (source)"}
                hint={mode === "mirrorToDisk"
                  ? "Destination directory for oc-mirror tar archives and working-dir. Container-internal path under /data. Typically 50–200+ GB for a full OCP + operator mirror. Should be empty (or contain only prior run archives) before the first mirror-to-disk run. Keep archives after a successful run — they are the input for disk-to-mirror."
                  : "Source directory containing tar archives from a previous mirror-to-disk run. Must contain the working-dir structure written by oc-mirror. Container-internal path under /data."}
              >
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    value={archivePath}
                    onChange={(e) => updateMirrorWorkflow({ archivePath: e.target.value })}
                    placeholder={DEFAULT_ARCHIVE_PATH}
                    style={{ flex: 1 }}
                  />
                  <Button variant="secondary" onClick={() => openBrowse("archive", archivePath || DEFAULT_ARCHIVE_PATH)} style={{ whiteSpace: "nowrap" }}>
                    Browse…
                  </Button>
                </div>
              </FieldLabelWithInfo>
            )}
            {mode === "mirrorToMirror" && (
              <FieldLabelWithInfo
                label="Workspace directory"
                hint="Required. Directory for oc-mirror metadata and cluster-resources output (creates a working-dir/ subdirectory here). Container-internal path under /data. Typically 1–5 GB."
              >
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    value={workspacePath}
                    onChange={(e) => updateMirrorWorkflow({ workspacePath: e.target.value })}
                    placeholder={DEFAULT_WORKSPACE_PATH}
                    style={{ flex: 1 }}
                  />
                  <Button variant="secondary" onClick={() => openBrowse("workspace", workspacePath || DEFAULT_WORKSPACE_PATH)} style={{ whiteSpace: "nowrap" }}>
                    Browse…
                  </Button>
                </div>
              </FieldLabelWithInfo>
            )}
            {mode !== "mirrorToMirror" && (
              <FieldLabelWithInfo
                label="Cache directory"
                hint="Persistent image layer cache. Significantly speeds up subsequent runs. Container-internal path under /data. Safe to delete — oc-mirror rebuilds it automatically. Typically 5–50+ GB. Not used in mirror-to-mirror mode."
              >
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    value={cachePath}
                    onChange={(e) => updateMirrorWorkflow({ cachePath: e.target.value })}
                    placeholder={DEFAULT_CACHE_PATH}
                    style={{ flex: 1 }}
                  />
                  <Button variant="secondary" onClick={() => openBrowse("cache", cachePath || DEFAULT_CACHE_PATH)} style={{ whiteSpace: "nowrap" }}>
                    Browse…
                  </Button>
                </div>
              </FieldLabelWithInfo>
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
                  <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: 6 }}>Red Hat source credentials</div>
                )}
                <div style={{ fontSize: "0.8rem", color: "var(--text-subtle)", marginBottom: 8 }}>
                  Red Hat pull secret authenticates to registry.redhat.io and quay.io.
                </div>
                {mountedRhAvailable && (
                  <OptionRow
                    title="Use mounted Red Hat pull secret"
                    description="Use the pull secret file detected in the container."
                  >
                    <input
                      type="radio"
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
                  >
                    <input
                      type="radio"
                      name="ocmirror-rh-auth"
                      checked={rhAuthSource === "retained"}
                      onChange={() => setRhAuthSource("retained")}
                    />
                  </OptionRow>
                )}
                <OptionRow
                  title="Paste Red Hat pull secret for this run"
                  description="Supply a Red Hat pull secret only for this run. Not saved."
                >
                  <input
                    type="radio"
                    name="ocmirror-rh-auth"
                    checked={rhAuthSource === "pasted"}
                    onChange={() => setRhAuthSource("pasted")}
                  />
                </OptionRow>
                {rhAuthSource === "pasted" && (
                  <SecretInput
                    label="Red Hat pull secret"
                    labelHint="Paste, drag-and-drop, or upload your Red Hat pull secret JSON from console.redhat.com. Used for this run only — not stored."
                    value={rhPullSecretPaste}
                    onChange={setRhPullSecretPaste}
                    placeholder="Paste, drag and drop, or upload Red Hat pull secret JSON"
                    rows={4}
                  />
                )}
              </div>
            )}

            {/* Divider between sections for mirrorToMirror */}
            {mode === "mirrorToMirror" && <div className="divider" />}

            {/* Mirror registry credentials — shown for diskToMirror and mirrorToMirror */}
            {(mode === "diskToMirror" || mode === "mirrorToMirror") && (
              <div>
                {mode === "mirrorToMirror" && (
                  <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: 6 }}>Mirror registry destination credentials</div>
                )}
                <div style={{ fontSize: "0.8rem", color: "var(--text-subtle)", marginBottom: 8 }}>
                  Mirror registry credentials authenticate pushes to your registry.
                </div>
                {hasMirrorSecret && (
                  <OptionRow
                    title="Use mirror registry credentials from Identity & Access"
                    description="Use the pull secret already configured in the Identity & Access step."
                  >
                    <input
                      type="radio"
                      name="ocmirror-mirror-auth"
                      checked={mirrorAuthSource === "reuse"}
                      onChange={() => setMirrorAuthSource("reuse")}
                    />
                  </OptionRow>
                )}
                <OptionRow
                  title="Paste mirror registry credentials for this run"
                  description="Supply credentials only for this run. Not saved."
                >
                  <input
                    type="radio"
                    name="ocmirror-mirror-auth"
                    checked={mirrorAuthSource === "pasted"}
                    onChange={() => setMirrorAuthSource("pasted")}
                  />
                </OptionRow>
                {mirrorAuthSource === "pasted" && (
                  <SecretInput
                    label="Mirror registry credentials"
                    labelHint="Paste, drag-and-drop, or upload mirror registry auth JSON. Used for this run only — not stored."
                    value={mirrorPullSecretPaste}
                    onChange={setMirrorPullSecretPaste}
                    placeholder="Paste, drag and drop, or upload mirror registry credentials JSON"
                    rows={4}
                  />
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
            <OptionRow title="Strict archive" description="Strict archive validation.">
              <Switch checked={strictArchive} onChange={(v) => updateMirrorWorkflow({ strictArchive: v })} />
            </OptionRow>
          )}
          {/* Compact 3-column grid for short-value fields */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px 16px", alignItems: "end" }}>
            <FieldLabelWithInfo label="Log level" hint="Log level: info or debug.">
              <select
                value={logLevel}
                onChange={(e) => updateMirrorWorkflow({ logLevel: e.target.value })}
              >
                <option value="info">info</option>
                <option value="debug">debug</option>
              </select>
            </FieldLabelWithInfo>
            <FieldLabelWithInfo label="Parallel images" hint="Max concurrent image pulls (1–32).">
              <input
                type="number"
                min={1}
                max={32}
                value={parallelImages}
                onChange={(e) => updateMirrorWorkflow({ parallelImages: Number(e.target.value) || 4 })}
              />
            </FieldLabelWithInfo>
            <FieldLabelWithInfo label="Parallel layers" hint="Max concurrent layer pulls (1–32).">
              <input
                type="number"
                min={1}
                max={32}
                value={parallelLayers}
                onChange={(e) => updateMirrorWorkflow({ parallelLayers: Number(e.target.value) || 5 })}
              />
            </FieldLabelWithInfo>
            <FieldLabelWithInfo label="Image timeout" hint="Timeout per image (e.g. 10m).">
              <input
                type="text"
                value={imageTimeout}
                onChange={(e) => updateMirrorWorkflow({ imageTimeout: e.target.value })}
                placeholder="10m"
              />
            </FieldLabelWithInfo>
            <FieldLabelWithInfo label="Retry times" hint="Number of retries on failure (0–10).">
              <input
                type="number"
                min={0}
                max={10}
                value={retryTimes}
                onChange={(e) => updateMirrorWorkflow({ retryTimes: Number(e.target.value) ?? 2 })}
              />
            </FieldLabelWithInfo>
            <FieldLabelWithInfo label="Retry delay" hint="Delay between retries (e.g. 1s).">
              <input
                type="text"
                value={retryDelay}
                onChange={(e) => updateMirrorWorkflow({ retryDelay: e.target.value })}
                placeholder="1s"
              />
            </FieldLabelWithInfo>
            {mode === "mirrorToDisk" && (
              <FieldLabelWithInfo label="Since (incremental)" hint="Only mirror images newer than this (ISO or digest). Optional.">
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

        {/* 7. Preflight */}
        <section className="card">
          <div className="card-header">
            <h3 className="card-title">Preflight</h3>
            <div className="card-subtitle">Check paths and config before running. Run must pass with no blockers.</div>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Button variant="secondary" onClick={runPreflight} disabled={preflightLoading} data-testid="run-preflight-btn">
                {preflightLoading ? "Running preflight…" : "Run preflight"}
              </Button>
            </div>
            {preflightResult ? (
              <>
                {preflightResult.blockers?.length > 0 ? (
                  <div className="note warning" style={{ marginTop: 12 }}>
                    <strong>Blockers:</strong>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                      {preflightResult.blockers.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {preflightResult.warnings?.length > 0 ? (
                  <div className="note" style={{ marginTop: 8 }}>
                    <strong>Warnings:</strong>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                      {preflightResult.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {preflightResult.ok ? (
                  <p className="note subtle" style={{ marginTop: 8 }}>Preflight passed. You can run oc-mirror.</p>
                ) : null}
              </>
            ) : null}
          </div>
        </section>

        {/* 8. Run status / last run */}
        <section className="card">
          <div className="card-header">
            <h3 className="card-title">Run oc-mirror</h3>
            <div className="card-subtitle">Start the run or stop a running job. View full logs in Operations.</div>
          </div>
          <div className="card-body">
            {runError ? (
              <div className="note warning" style={{ marginBottom: 12 }}>{runError}</div>
            ) : null}
            <div className="actions" style={{ flexWrap: "wrap", gap: 8 }}>
              <Button
                variant="primary"
                onClick={runOcMirror}
                disabled={!canRun || isRunning}
              >
                {isRunning ? "Running…" : "Run oc-mirror"}
              </Button>
              {isRunning ? (
                <Button variant="danger" onClick={stopRun}>Stop</Button>
              ) : null}
            </div>
            {lastRunJob ? (
              <div className="run-oc-mirror-summary" style={{ marginTop: 16 }}>
                <h4 className="card-subtitle">Last run</h4>
                <p><strong>Status:</strong> {lastRunJob.status}</p>
                {meta ? (
                  <>
                    <p><strong>Mode:</strong> {meta.mode}</p>
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
                      <div style={{ marginTop: 8 }}>
                        <strong>Command:</strong>
                        <pre style={{ marginTop: 4, padding: "6px 10px", background: "var(--code-bg)", color: "var(--code-color)", borderRadius: 4, fontSize: "0.78rem", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{meta.fullCommand}</pre>
                      </div>
                    ) : null}
                  </>
                ) : null}
                <p className="note subtle" style={{ marginTop: 8 }}>
                  To continue manually, use the paths above. Run oc-mirror from the command line with the same
                  workspace and cache for incremental runs.
                </p>
                <Button variant="ghost" onClick={() => goToOperations(lastRunJob?.id)} style={{ marginTop: 8 }}>
                  View full logs in Operations
                </Button>
              </div>
            ) : lastRunJobId && !lastRunJob ? (
              <p className="subtle" style={{ marginTop: 16 }}>Loading last run…</p>
            ) : null}
          </div>
        </section>
      </div>

      {/* oc-mirror completion modal */}
      {ocMirrorCompleteModal ? (() => {
        const { job, meta } = ocMirrorCompleteModal;
        const succeeded = job.status === "completed";
        const elapsed = meta?.startedAt && meta?.finishedAt
          ? Math.round((meta.finishedAt - meta.startedAt) / 1000)
          : null;
        const modeLabel = meta?.mode === "mirrorToDisk" ? "Mirror to disk"
          : meta?.mode === "diskToMirror" ? "Disk to mirror"
          : meta?.mode === "mirrorToMirror" ? "Mirror to mirror"
          : meta?.mode || "Unknown";
        return (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal">
              <h3 style={{ margin: "0 0 8px", color: succeeded ? undefined : "var(--color-danger)" }}>
                {succeeded ? "oc-mirror completed" : job.status === "cancelled" ? "oc-mirror cancelled" : "oc-mirror failed"}
              </h3>
              {succeeded ? (
                <>
                  <p className="modal-copy subtle">The mirror run finished successfully.</p>
                  {meta && (
                    <dl className="modal-summary">
                      <dt>Workflow</dt><dd>{modeLabel}</dd>
                      {elapsed != null && <><dt>Elapsed</dt><dd>{elapsed}s</dd></>}
                      {meta.archiveDir && <><dt>Archive directory</dt><dd><code>{meta.archiveDir}</code></dd></>}
                      {meta.workspaceDir && <><dt>Workspace directory</dt><dd><code>{meta.workspaceDir}</code></dd></>}
                    </dl>
                  )}
                  {meta?.mode === "mirrorToDisk" && meta?.archiveDir && (
                    <div className="note" style={{ marginTop: 12 }}>
                      <strong>Next steps:</strong> Transfer the contents of <code>{meta.archiveDir}</code> (tar archives and working-dir) across the air gap along with your other deliverables. You will need these files for the disk-to-mirror step on the disconnected side.
                    </div>
                  )}
                  {meta?.mode === "diskToMirror" && (
                    <div className="note" style={{ marginTop: 12 }}>
                      Images have been pushed to your mirror registry. Proceed to install or update your cluster.
                    </div>
                  )}
                  {meta?.mode === "mirrorToMirror" && (
                    <div className="note" style={{ marginTop: 12 }}>
                      Images have been mirrored directly to your registry. Proceed to install or update your cluster.
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
    </div>
  );
}
