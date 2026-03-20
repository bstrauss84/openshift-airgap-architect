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

const MODES = [
  {
    value: "mirrorToDisk",
    label: "Mirror to disk",
    help:
      "Download release and operator images from the internet to a local directory (archives and working-dir). Use this first in a disconnected workflow. Requires archive (destination), workspace, and cache paths."
  },
  {
    value: "diskToMirror",
    label: "Disk to mirror",
    help:
      "Publish images from a local archive (from a previous mirror-to-disk run) to your mirror registry. Requires source archive path, workspace, cache, and registry URL."
  },
  {
    value: "mirrorToMirror",
    label: "Mirror to mirror",
    help:
      "Stream images directly from source to your mirror registry without a local cache. Use when you have direct connectivity. Requires workspace and registry URL only."
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
  const [authSource, setAuthSource] = React.useState("reuse");
  const [pullSecretPaste, setPullSecretPaste] = React.useState("");
  const [runningJobId, setRunningJobId] = React.useState(null);
  const [lastRunJob, setLastRunJob] = React.useState(null);
  const [runError, setRunError] = React.useState(null);

  const updateMirrorWorkflow = useCallback(
    (patch) => updateState({ mirrorWorkflow: { ...mw, ...patch } }),
    [updateState, mw]
  );

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
        }
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [runningJobId, updateMirrorWorkflow]);

  if (!state) return <div className="step"><div className="loading">Loading…</div></div>;

  const runPreflight = async () => {
    setPreflightLoading(true);
    setPreflightResult(null);
    try {
      const body = {
        mode,
        archivePath: mode !== "mirrorToMirror" ? archivePath : undefined,
        workspacePath,
        cachePath: mode !== "mirrorToMirror" ? cachePath : undefined,
        registryUrl: mode !== "mirrorToDisk" ? registryUrl : undefined,
        configSourceType,
        configPath: configSourceType === "external" ? configPath : undefined,
        authSource
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
      dryRun: mode === "mirrorToDisk" ? dryRun : false,
      archivePath: mode !== "mirrorToMirror" ? archivePath : undefined,
      workspacePath,
      cachePath: mode !== "mirrorToMirror" ? cachePath : undefined,
      registryUrl: mode !== "mirrorToDisk" ? registryUrl : undefined,
      configSourceType,
      configPath: configSourceType === "external" ? configPath : undefined,
      authSource,
      pullSecret: authSource === "pasted" && pullSecretPaste ? pullSecretPaste : undefined,
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

  const goToOperations = () => {
    updateState({ ui: { ...state.ui, activeStepId: "operations" } });
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
            {MODES.map((m) => (
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
            <div className="card-subtitle">
              {mode === "mirrorToDisk" && "Archive = destination for tar and working-dir. Workspace and cache enable incremental runs."}
              {mode === "diskToMirror" && "Archive = source from a previous mirror-to-disk. Workspace and cache should match that run."}
              {mode === "mirrorToMirror" && "Only workspace is used (no local cache)."}
            </div>
          </div>
          <div className="card-body">
            {(mode === "mirrorToDisk" || mode === "diskToMirror") && (
              <FieldLabelWithInfo
                label={mode === "mirrorToDisk" ? "Archive directory (destination)" : "Archive directory (source)"}
                hint={mode === "mirrorToDisk" ? "Directory where oc-mirror will write tar archives and working-dir." : "Directory containing tar archives and working-dir from a previous mirror-to-disk run."}
              >
                <input
                  type="text"
                  value={archivePath}
                  onChange={(e) => updateMirrorWorkflow({ archivePath: e.target.value })}
                  placeholder="/path/to/archive"
                />
              </FieldLabelWithInfo>
            )}
            <FieldLabelWithInfo
              label="Workspace directory"
              hint="Working directory for cluster-resources, logs, and metadata. Required for all modes."
            >
              <input
                type="text"
                value={workspacePath}
                onChange={(e) => updateMirrorWorkflow({ workspacePath: e.target.value })}
                placeholder="/path/to/workspace"
              />
            </FieldLabelWithInfo>
            {mode !== "mirrorToMirror" && (
              <FieldLabelWithInfo
                label="Cache directory"
                hint="Persistent cache for image layers; enables incremental and --since. Back up after successful runs."
              >
                <input
                  type="text"
                  value={cachePath}
                  onChange={(e) => updateMirrorWorkflow({ cachePath: e.target.value })}
                  placeholder="/path/to/cache"
                />
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
            <OptionRow
              title="Use mirror-registry credentials from Identity & Access"
              description="Use the pull secret already configured in the Identity & Access step."
            >
              <input
                type="radio"
                name="ocmirror-auth"
                checked={authSource === "reuse"}
                onChange={() => setAuthSource("reuse")}
              />
            </OptionRow>
            <OptionRow
              title="Paste or upload pull secret for this run"
              description="Supply credentials only for this run. Not saved."
            >
              <input
                type="radio"
                name="ocmirror-auth"
                checked={authSource === "pasted"}
                onChange={() => setAuthSource("pasted")}
              />
            </OptionRow>
            {authSource === "pasted" ? (
              <FieldLabelWithInfo label="Pull secret (JSON)" hint="Paste registry auth JSON. Used once and not stored.">
                <textarea
                  value={pullSecretPaste}
                  onChange={(e) => setPullSecretPaste(e.target.value)}
                  placeholder='{"auths":{"registry.example.com":{...}}}'
                  rows={3}
                />
              </FieldLabelWithInfo>
            ) : null}
          </div>
        </section>

        {/* 6. Advanced */}
        <CollapsibleSection title="Advanced options" defaultCollapsed={true}>
          {mode === "mirrorToDisk" && (
            <OptionRow
              title="Dry run (no mirror)"
              description="Only validate config and produce mapping.txt / missing.txt; do not download images."
            >
              <Switch checked={dryRun} onChange={(v) => updateMirrorWorkflow({ dryRun: v })} />
            </OptionRow>
          )}
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
          <FieldLabelWithInfo label="Since (incremental)" hint="Only mirror images newer than this (ISO or digest). Optional.">
            <input
              type="text"
              value={since}
              onChange={(e) => updateMirrorWorkflow({ since: e.target.value })}
              placeholder=""
            />
          </FieldLabelWithInfo>
          <OptionRow title="Strict archive" description="Strict archive validation.">
            <Switch checked={strictArchive} onChange={(v) => updateMirrorWorkflow({ strictArchive: v })} />
          </OptionRow>
        </CollapsibleSection>

        <OptionRow
          title="Include mirror output in export bundle"
          description="Add the archive directory to the downloadable ZIP. May greatly increase bundle size."
          warning={includeInExport ? "Enabling this can make the export bundle very large." : null}
        >
          <Switch checked={includeInExport} onChange={(v) => updateMirrorWorkflow({ includeInExport: v })} />
        </OptionRow>

        {/* 7. Preflight */}
        <section className="card">
          <div className="card-header">
            <h3 className="card-title">Preflight</h3>
            <div className="card-subtitle">Check paths and config before running. Run must pass with no blockers.</div>
          </div>
          <div className="card-body">
            <Button variant="secondary" onClick={runPreflight} disabled={preflightLoading} data-testid="run-preflight-btn">
              {preflightLoading ? "Running preflight…" : "Run preflight"}
            </Button>
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
                  </>
                ) : null}
                <p className="note subtle" style={{ marginTop: 8 }}>
                  To continue manually, use the paths above. Run oc-mirror from the command line with the same
                  workspace and cache for incremental runs.
                </p>
                <Button variant="ghost" onClick={goToOperations} style={{ marginTop: 8 }}>
                  View full logs in Operations
                </Button>
              </div>
            ) : lastRunJobId && !lastRunJob ? (
              <p className="subtle" style={{ marginTop: 16 }}>Loading last run…</p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
