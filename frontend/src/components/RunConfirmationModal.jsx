/**
 * OpenShift Airgap Architect - Run oc-mirror Confirmation Modal
 *
 * Confirmation dialog shown before running oc-mirror to review configuration
 * and prevent accidental runs.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import Button from "./Button.jsx";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

const MODAL_Z = 10080;

function RunConfirmationModal({ isOpen, onClose, onConfirm, config }) {
  const trapRef = useFocusTrap(isOpen);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const { mode, dryRun, archivePath, workspacePath, cachePath, registryUrl, configSourceType, advanced } = config;

  const getModeLabel = () => {
    switch (mode) {
      case "mirrorToDisk": return "Mirror to Disk";
      case "diskToMirror": return "Disk to Mirror";
      case "mirrorToMirror": return "Mirror to Mirror";
      default: return mode;
    }
  };

  const hasNonDefaultAdvanced = advanced && (
    (advanced.logLevel && advanced.logLevel !== "info") ||
    (advanced.parallelImages != null && advanced.parallelImages !== 4) ||
    (advanced.parallelLayers != null && advanced.parallelLayers !== 3) ||
    advanced.imageTimeout ||
    (advanced.retryTimes != null && advanced.retryTimes !== 3) ||
    advanced.retryDelay ||
    advanced.since ||
    advanced.strictArchive
  );

  return createPortal(
    <>
      <div
        className="run-confirmation-modal-backdrop"
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          zIndex: MODAL_Z,
        }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-confirmation-modal-title"
        className="run-confirmation-modal"
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: MODAL_Z + 1,
            maxWidth: "600px",
            width: "90%",
            maxHeight: "90vh",
            overflow: "auto",
            backgroundColor: "var(--bg-primary)",
            border: "1px solid var(--border-primary)",
            borderRadius: "8px",
            padding: "24px",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div className="run-confirmation-modal-header" style={{ marginBottom: "20px" }}>
            <h2 id="run-confirmation-modal-title" style={{ margin: 0, fontSize: "22px", fontWeight: 600 }}>
              Confirm oc-mirror Run
            </h2>
            {dryRun && (
              <p style={{ margin: "8px 0 0", color: "var(--color-info, #3b82f6)", fontSize: "14px", fontWeight: 500 }}>
                🔍 Dry run mode — no images will be transferred
              </p>
            )}
          </div>

          <div className="run-confirmation-modal-content" style={{ marginBottom: "24px" }}>
            <section style={{ marginBottom: "16px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: 600, marginBottom: "8px", color: "var(--text-primary)" }}>
                Mode
              </h3>
              <p style={{ margin: 0, fontSize: "14px", color: "var(--text-secondary)" }}>
                {getModeLabel()}
              </p>
            </section>

            <section style={{ marginBottom: "16px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: 600, marginBottom: "8px", color: "var(--text-primary)" }}>
                Paths
              </h3>
              <dl style={{ margin: 0, fontSize: "14px", lineHeight: 1.6 }}>
                {archivePath && (
                  <>
                    <dt style={{ fontWeight: 500, color: "var(--text-primary)" }}>Archive:</dt>
                    <dd style={{ margin: "0 0 8px 16px", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                      {archivePath}
                    </dd>
                  </>
                )}
                {workspacePath && (
                  <>
                    <dt style={{ fontWeight: 500, color: "var(--text-primary)" }}>Workspace:</dt>
                    <dd style={{ margin: "0 0 8px 16px", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                      {workspacePath}
                    </dd>
                  </>
                )}
                {cachePath && (
                  <>
                    <dt style={{ fontWeight: 500, color: "var(--text-primary)" }}>Cache:</dt>
                    <dd style={{ margin: "0 0 8px 16px", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                      {cachePath}
                    </dd>
                  </>
                )}
              </dl>
            </section>

            {registryUrl && (
              <section style={{ marginBottom: "16px" }}>
                <h3 style={{ fontSize: "15px", fontWeight: 600, marginBottom: "8px", color: "var(--text-primary)" }}>
                  Registry URL
                </h3>
                <p style={{ margin: 0, fontSize: "14px", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                  {registryUrl}
                </p>
              </section>
            )}

            <section style={{ marginBottom: "16px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: 600, marginBottom: "8px", color: "var(--text-primary)" }}>
                Configuration Source
              </h3>
              <p style={{ margin: 0, fontSize: "14px", color: "var(--text-secondary)" }}>
                {configSourceType === "generated" ? "Generated from wizard selections" : "External file"}
              </p>
            </section>

            {hasNonDefaultAdvanced && (
              <section style={{ marginBottom: "16px" }}>
                <h3 style={{ fontSize: "15px", fontWeight: 600, marginBottom: "8px", color: "var(--text-primary)" }}>
                  Advanced Options
                </h3>
                <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "14px", lineHeight: 1.6 }}>
                  {advanced.logLevel && advanced.logLevel !== "info" && (
                    <li>Log level: {advanced.logLevel}</li>
                  )}
                  {advanced.parallelImages != null && advanced.parallelImages !== 4 && (
                    <li>Parallel images: {advanced.parallelImages}</li>
                  )}
                  {advanced.parallelLayers != null && advanced.parallelLayers !== 3 && (
                    <li>Parallel layers: {advanced.parallelLayers}</li>
                  )}
                  {advanced.imageTimeout && (
                    <li>Image timeout: {advanced.imageTimeout}</li>
                  )}
                  {advanced.retryTimes != null && advanced.retryTimes !== 3 && (
                    <li>Retry times: {advanced.retryTimes}</li>
                  )}
                  {advanced.retryDelay && (
                    <li>Retry delay: {advanced.retryDelay}</li>
                  )}
                  {advanced.since && (
                    <li>Since (incremental): {advanced.since}</li>
                  )}
                  {advanced.strictArchive && (
                    <li>Strict archive mode enabled</li>
                  )}
                </ul>
              </section>
            )}

            {!dryRun && (
              <div
                style={{
                  marginTop: "20px",
                  padding: "12px 16px",
                  background: "var(--color-warning-bg, rgba(245, 158, 11, 0.1))",
                  border: "1px solid var(--color-warning, #b87800)",
                  borderRadius: "6px",
                  fontSize: "14px",
                  lineHeight: 1.6,
                }}
              >
                <strong>⚠️ Warning:</strong> This will begin downloading and mirroring images. Depending on your
                selections, this may transfer tens or hundreds of gigabytes. Ensure you have sufficient disk space
                and bandwidth.
              </div>
            )}
          </div>

          <div className="run-confirmation-modal-footer" style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onConfirm}>
              {dryRun ? "Run Dry Run" : "Confirm & Run"}
            </Button>
          </div>
        </div>
    </>,
    document.body
  );
}

export default RunConfirmationModal;
