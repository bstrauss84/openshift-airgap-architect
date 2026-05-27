/**
 * OpenShift Airgap Architect - ImageSet Configuration Step (Connected Mode)
 *
 * Dedicated step for imageset-config-specific settings: update graph, additional
 * images, and archive chunking. Shows live YAML preview.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useState, useEffect } from "react";
import { useApp } from "../store.jsx";
import { apiFetch } from "../api.js";

const ImageSetConfigStep = () => {
  const { state, updateState } = useApp();
  const imagesetConfig = state.imagesetConfig || {};
  const [preview, setPreview] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  const updateImageSetConfig = (patch) => {
    updateState({
      imagesetConfig: {
        ...imagesetConfig,
        ...patch
      }
    });
  };

  // Generate preview whenever config changes
  useEffect(() => {
    setPreviewLoading(true);
    apiFetch("/api/generate", {
      method: "POST",
      body: JSON.stringify({ state })
    })
      .then((data) => {
        const yaml = data.files?.["imageset-config.yaml"] || "";
        setPreview(yaml);
      })
      .catch((err) => {
        console.error("Failed to generate preview:", err);
        setPreview("# Error generating preview");
      })
      .finally(() => setPreviewLoading(false));
  }, [state.imagesetConfig, state.operators, state.release]);

  const includeGraph = imagesetConfig.graph !== false;
  const additionalImages = imagesetConfig.additionalImages || "";
  const archiveSize = imagesetConfig.archiveSize || "";

  return (
    <div className="step-content">
      <div className="step-body">
        <section className="card">
          <h3>ImageSet Configuration Options</h3>
          <p className="note">
            Configure optional settings for your imageset-config.yaml.
            These settings control how oc-mirror packages and mirrors your selected operators.
          </p>

          <div style={{ marginTop: "2rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={includeGraph}
                onChange={(e) => updateImageSetConfig({ graph: e.target.checked })}
              />
              <span style={{ fontWeight: 500 }}>Include OpenShift update graph</span>
            </label>
            <p className="note" style={{ marginLeft: "2rem", marginTop: "0.5rem" }}>
              Recommended. Includes metadata for cluster upgrades. Disable only if mirroring
              a single version with no upgrade path needed.
            </p>
          </div>

          <div style={{ marginTop: "2rem" }}>
            <label htmlFor="additional-images" style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              Additional Container Images (Optional)
            </label>
            <textarea
              id="additional-images"
              value={additionalImages}
              onChange={(e) => updateImageSetConfig({ additionalImages: e.target.value })}
              placeholder="registry.example.com/namespace/image:tag&#10;quay.io/org/app:v1.2.3"
              rows={6}
              style={{ width: "100%", fontFamily: "monospace", fontSize: "0.9rem" }}
            />
            <p className="note" style={{ marginTop: "0.5rem" }}>
              One image per line. Include custom images not in operator catalogs
              (monitoring agents, security scanners, sidecar containers, etc.).
            </p>
          </div>

          <div style={{ marginTop: "2rem" }}>
            <label htmlFor="archive-size" style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              Archive Size Limit (GiB, Optional)
            </label>
            <input
              id="archive-size"
              type="number"
              value={archiveSize}
              onChange={(e) => updateImageSetConfig({ archiveSize: e.target.value })}
              placeholder="Leave blank for no limit"
              min={1}
              style={{ width: "200px" }}
            />
            <p className="note" style={{ marginTop: "0.5rem" }}>
              Split mirror archive into chunks (useful for transfer size limits).
              Example: 50 GiB chunks for USB drives or file transfer limits.
            </p>
          </div>
        </section>

        <section className="card">
          <h3>ImageSet Configuration Preview</h3>
          {previewLoading ? (
            <p className="note">Generating preview...</p>
          ) : (
            <pre
              style={{
                background: "var(--code-bg)",
                padding: "1rem",
                borderRadius: "4px",
                overflow: "auto",
                maxHeight: "400px",
                fontSize: "0.85rem",
                lineHeight: "1.4"
              }}
            >
              {preview || "# No preview available"}
            </pre>
          )}
        </section>
      </div>
    </div>
  );
};

export default ImageSetConfigStep;
