/**
 * OpenShift Airgap Architect - About Modal Component
 *
 * Application information modal showing developer attribution, version,
 * license, and AI collaboration acknowledgment.
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

function AboutModal({ isOpen, onClose, appVersion, gitSha, buildTime }) {
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

  const version = appVersion || "1.7.0-dev";
  const sha = gitSha && gitSha !== "unknown" ? gitSha.slice(0, 7) : "dev";
  const buildDate = buildTime && buildTime !== "unknown" ? new Date(buildTime).toLocaleDateString() : "dev build";

  return createPortal(
    <>
      <div
        className="about-modal-backdrop"
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
        aria-labelledby="about-modal-title"
        className="about-modal"
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: MODAL_Z + 1,
            maxWidth: "560px",
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
          <div className="about-modal-header" style={{ marginBottom: "20px" }}>
            <h2 id="about-modal-title" style={{ margin: 0, fontSize: "24px", fontWeight: 600 }}>
              OpenShift Airgap Architect
            </h2>
            <p style={{ margin: "8px 0 0", color: "var(--text-secondary)", fontSize: "14px" }}>
              Version {version} ({sha}) • Built {buildDate}
            </p>
          </div>

          <div className="about-modal-content" style={{ marginBottom: "24px" }}>
            <section style={{ marginBottom: "20px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>About</h3>
              <p style={{ margin: 0, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                A comprehensive wizard for planning and executing disconnected OpenShift Container Platform
                installations across multiple platforms and installation methods.
              </p>
            </section>

            <section style={{ marginBottom: "20px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>Developer</h3>
              <p style={{ margin: 0, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                <strong>Bill Strauss</strong>
              </p>
              <p style={{ margin: "4px 0 0", fontSize: "14px", color: "var(--text-muted)" }}>
                Developed with AI assistance from <strong>Claude (Anthropic)</strong> and <strong>Cursor AI</strong>
              </p>
            </section>

            <section style={{ marginBottom: "20px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>License</h3>
              <p style={{ margin: 0, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                MIT License • Copyright © 2025 Bill Strauss
              </p>
            </section>

            <section style={{ marginBottom: "20px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>Resources</h3>
              <ul style={{ margin: 0, paddingLeft: "20px", lineHeight: 1.8 }}>
                <li>
                  <a
                    href="https://github.com/billstrauss/openshift-airgap-architect"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--link-color)" }}
                  >
                    GitHub Repository
                  </a>
                </li>
                <li>
                  <a
                    href="https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing/index"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--link-color)" }}
                  >
                    OpenShift Documentation
                  </a>
                </li>
              </ul>
            </section>

            <section>
              <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>Disclaimer</h3>
              <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: "var(--text-muted)" }}>
                This tool generates installation configuration files based on user input. Always validate
                generated configurations against official Red Hat OpenShift Container Platform documentation
                before use in production environments.
              </p>
            </section>
          </div>

          <div className="about-modal-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
    </>,
    document.body
  );
}

export default AboutModal;
