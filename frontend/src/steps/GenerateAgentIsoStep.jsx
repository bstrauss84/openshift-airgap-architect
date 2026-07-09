/**
 * OpenShift Airgap Architect - Generate Agent ISO Step
 *
 * Manages agent ISO generation for agent-based installer deployments.
 * Executes `openshift-install agent create image` and provides:
 * - Real-time job progress and log streaming
 * - ISO download capability
 * - Kubeadmin credentials and kubeconfig display
 * - Re-generation with confirmation
 *
 * @author Joshua Mathianas
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useEffect, useState, useRef } from "react";
import { useApp } from "../store.jsx";
import { apiFetch } from "../api.js";
import Button from "../components/Button.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";

export default function GenerateAgentIsoStep() {
  const { state } = useApp();
  const [runningJobId, setRunningJobId] = useState(null);
  const [lastRunJob, setLastRunJob] = useState(null);
  const [showCompleteModal, setShowCompleteModal] = useState(null);
  const [generateError, setGenerateError] = useState(null);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showKubeconfig, setShowKubeconfig] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [copiedKubeconfig, setCopiedKubeconfig] = useState(false);
  const logPreRef = useRef(null);

  const isAgentBased = state?.methodology?.method === "Agent-Based Installer";
  const platform = state?.blueprint?.platform;
  const isSupported = platform === "Bare Metal" || platform === "VMware vSphere";

  // Poll job status while running
  useEffect(() => {
    if (!runningJobId) return;
    const interval = setInterval(() => {
      apiFetch(`/api/jobs/${runningJobId}`).then((job) => {
        setLastRunJob(job);
        if (["completed", "failed", "cancelled"].includes(job.status)) {
          setRunningJobId(null);
          clearInterval(interval);
          let meta = null;
          try {
            meta = job.metadata_json ? JSON.parse(job.metadata_json) : null;
          } catch {}
          setShowCompleteModal({ job, meta });
        }
      }).catch((err) => {
        console.error("Failed to poll job status:", err);
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [runningJobId]);

  // Auto-scroll logs to bottom
  useEffect(() => {
    const el = logPreRef.current;
    if (el && runningJobId && lastRunJob?.output) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lastRunJob?.output, runningJobId]);

  const generateIso = async () => {
    setGenerateError(null);
    setShowCompleteModal(null);
    setShowRegenerateConfirm(false);
    try {
      const { jobId } = await apiFetch("/api/agent-iso/generate", {
        method: "POST",
        body: JSON.stringify({})
      });
      setRunningJobId(jobId);
      setLastRunJob(null);
    } catch (err) {
      setGenerateError(err.message || "Failed to start ISO generation.");
    }
  };

  const downloadIso = () => {
    if (!lastRunJob?.metadata_json) return;
    try {
      const meta = typeof lastRunJob.metadata_json === "string"
        ? JSON.parse(lastRunJob.metadata_json)
        : lastRunJob.metadata_json;

      if (meta.isoPath) {
        const url = `/api/agent-iso/download/${lastRunJob.id}`;
        const a = document.createElement("a");
        a.href = url;
        a.download = meta.isoName || "agent.x86_64.iso";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 60000);
      }
    } catch (err) {
      console.error("Download failed:", err);
      setGenerateError("Failed to download ISO file.");
    }
  };

  const copyToClipboard = async (text, type) => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === "password") {
        setCopiedPassword(true);
        setTimeout(() => setCopiedPassword(false), 2000);
      } else if (type === "kubeconfig") {
        setCopiedKubeconfig(true);
        setTimeout(() => setCopiedKubeconfig(false), 2000);
      }
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  if (!isAgentBased || !isSupported) {
    return (
      <div className="step">
        <div className="step-header">
          <div className="step-header-main">
            <h2>Generate Agent ISO</h2>
          </div>
        </div>
        <div className="step-body">
          <div className="note">
            Agent ISO generation is only available for Agent-Based Installer deployments
            on Bare Metal or VMware vSphere platforms.
          </div>
        </div>
      </div>
    );
  }

  const isRunning = Boolean(runningJobId);
  const hasCompleted = lastRunJob?.status === "completed";
  const hasFailed = lastRunJob?.status === "failed";

  let meta = null;
  try {
    meta = lastRunJob?.metadata_json
      ? (typeof lastRunJob.metadata_json === "string"
        ? JSON.parse(lastRunJob.metadata_json)
        : lastRunJob.metadata_json)
      : null;
  } catch {}

  const isoSizeMB = meta?.isoSize ? Math.round(meta.isoSize / 1024 / 1024) : null;

  return (
    <div className="step">
      <div className="step-header">
        <div className="step-header-main">
          <h2>Generate Agent ISO</h2>
          <p className="subtle">
            Create a bootable ISO containing the OpenShift agent installer and your configuration.
          </p>
        </div>
      </div>

      <div className="step-body">
        <section className="card">
          <div className="card-header">
            <h3 className="card-title">ISO Generation</h3>
          </div>
          <div className="card-body">
            {generateError && (
              <div className="note warning" role="alert">{generateError}</div>
            )}

            <div className="actions" style={{ marginBottom: "1rem" }}>
              {!hasCompleted && !isRunning && (
                <Button
                  variant="primary"
                  onClick={generateIso}
                  disabled={isRunning}
                >
                  Generate Agent ISO
                </Button>
              )}

              {hasCompleted && (
                <>
                  <Button
                    variant="primary"
                    onClick={downloadIso}
                  >
                    💾 Download ISO {isoSizeMB ? `(${isoSizeMB}MB)` : ""}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setShowRegenerateConfirm(true)}
                  >
                    🔄 Regenerate ISO
                  </Button>
                </>
              )}
            </div>

            {/* Status display */}
            {lastRunJob && (
              <div style={{ marginBottom: "1rem" }}>
                <p>
                  <strong>Status:</strong>{" "}
                  <span
                    className="badge"
                    style={{
                      backgroundColor: hasCompleted
                        ? "#22c55e"
                        : hasFailed
                        ? "#ef4444"
                        : isRunning
                        ? "#3b82f6"
                        : "#6b7280",
                      color: "#ffffff",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontSize: "0.875rem"
                    }}
                  >
                    {lastRunJob.status}
                  </span>
                </p>
                {lastRunJob.message && (
                  <p style={{ marginTop: "0.5rem" }}>
                    <strong>Message:</strong> {lastRunJob.message}
                  </p>
                )}
                {lastRunJob.progress !== undefined && lastRunJob.progress !== null && (
                  <p style={{ marginTop: "0.5rem" }}>
                    <strong>Progress:</strong> {lastRunJob.progress}%
                  </p>
                )}
              </div>
            )}

            {/* Streaming logs */}
            {(isRunning || hasFailed) && lastRunJob?.output && (
              <div style={{ marginTop: "1rem" }}>
                <h4 style={{ marginBottom: "0.5rem" }}>
                  {isRunning ? "Live Output:" : "Output:"}
                </h4>
                <pre
                  ref={logPreRef}
                  style={{
                    backgroundColor: "#1e293b",
                    color: "#e2e8f0",
                    padding: "1rem",
                    borderRadius: "4px",
                    maxHeight: "400px",
                    overflow: "auto",
                    fontFamily: "monospace",
                    fontSize: "0.8125rem",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all"
                  }}
                >
                  {lastRunJob.output}
                </pre>
              </div>
            )}

            {/* Credentials display (after completion) */}
            {hasCompleted && meta?.kubeadminPassword && (
              <div style={{ marginTop: "2rem" }}>
                <div className="note warning" style={{ marginBottom: "1rem" }}>
                  ⚠️ Save these credentials - they cannot be regenerated later.
                </div>

                {/* Kubeadmin Password */}
                <div style={{ marginBottom: "1.5rem" }}>
                  <FieldLabelWithInfo
                    label="Kubeadmin Password"
                    hint="Initial cluster admin credentials. Use this password with username 'kubeadmin' to access the cluster."
                  />
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={meta.kubeadminPassword || ""}
                      readOnly
                      className="readonly-input"
                      style={{
                        flex: 1,
                        fontFamily: "monospace",
                        fontSize: "0.875rem",
                        padding: "0.5rem",
                        border: "1px solid #cbd5e1",
                        borderRadius: "4px",
                        backgroundColor: "#f8fafc"
                      }}
                    />
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      title={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? "🙈 Hide" : "👁️ Show"}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => copyToClipboard(meta.kubeadminPassword, "password")}
                      title="Copy to clipboard"
                    >
                      {copiedPassword ? "✅ Copied" : "📋 Copy"}
                    </button>
                  </div>
                </div>

                {/* Kubeconfig */}
                {meta?.kubeconfig && (
                  <div>
                    <FieldLabelWithInfo
                      label="Kubeconfig"
                      hint="Cluster access configuration. Save this file as ~/.kube/config or use with KUBECONFIG environment variable to access the cluster with kubectl/oc."
                    />
                    <details style={{ marginTop: "0.5rem" }}>
                      <summary style={{ cursor: "pointer", marginBottom: "0.5rem" }}>
                        <span>{showKubeconfig ? "Hide" : "Show"} kubeconfig</span>
                        <button
                          type="button"
                          className="ghost"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            copyToClipboard(meta.kubeconfig, "kubeconfig");
                          }}
                          style={{ marginLeft: "0.5rem" }}
                          title="Copy to clipboard"
                        >
                          {copiedKubeconfig ? "✅ Copied" : "📋 Copy"}
                        </button>
                      </summary>
                      <pre
                        style={{
                          backgroundColor: "#1e293b",
                          color: "#e2e8f0",
                          padding: "1rem",
                          borderRadius: "4px",
                          maxHeight: "400px",
                          overflow: "auto",
                          fontFamily: "monospace",
                          fontSize: "0.8125rem",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all"
                        }}
                      >
                        {meta.kubeconfig}
                      </pre>
                    </details>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Regenerate confirmation modal */}
      {showRegenerateConfirm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>⚠️ Regenerate Agent ISO?</h3>
            <p>This will create a new ISO with your current configuration.</p>
            <p>
              <strong>Important:</strong> Any unsaved credentials from the previous generation will be lost.
              Make sure you've saved the kubeadmin password and kubeconfig before proceeding.
            </p>
            <div className="actions">
              <Button
                variant="danger"
                onClick={generateIso}
              >
                Yes, Regenerate
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowRegenerateConfirm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Completion modal */}
      {showCompleteModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>
              {showCompleteModal.job.status === "completed"
                ? "✅ ISO Generation Complete"
                : "❌ ISO Generation Failed"}
            </h3>
            {showCompleteModal.job.status === "completed" && showCompleteModal.meta?.isoPath && (
              <div>
                <p>
                  <strong>ISO File:</strong> <code>{showCompleteModal.meta.isoName || "agent.x86_64.iso"}</code>
                </p>
                {showCompleteModal.meta.isoSize && (
                  <p>
                    <strong>Size:</strong> {Math.round(showCompleteModal.meta.isoSize / 1024 / 1024)}MB
                  </p>
                )}
                <p style={{ marginTop: "1rem" }}>
                  The ISO has been generated successfully. You can now download it and use it to boot your target nodes.
                </p>
              </div>
            )}
            {showCompleteModal.job.status === "failed" && (
              <div>
                <p className="note warning">
                  {showCompleteModal.job.message || "ISO generation failed. Check the logs for details."}
                </p>
              </div>
            )}
            <div className="actions">
              <Button variant="primary" onClick={() => setShowCompleteModal(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
