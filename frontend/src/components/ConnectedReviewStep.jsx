/**
 * OpenShift Airgap Architect - Connected Review Step
 *
 * Simplified review for connected mode showing only imageset-config.yaml.
 * Provides download/copy actions and next steps instructions.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useState, useEffect } from "react";
import { useApp } from "../store.jsx";
import { apiFetch } from "../api.js";

const ConnectedReviewStep = () => {
  const { state } = useApp();
  const [previewFiles, setPreviewFiles] = useState({});
  const [loading, setLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const operators = state.operators?.selected || [];
  const version = state.release?.patchVersion || state.version?.selectedVersion || "unknown";
  const additionalImages = (state.imagesetConfig?.additionalImages || "").split("\n").filter(Boolean);

  // Fetch preview on mount
  useEffect(() => {
    setLoading(true);
    apiFetch("/api/generate", {
      method: "POST",
      body: JSON.stringify({ state })
    })
      .then((data) => {
        setPreviewFiles(data.files || {});
      })
      .catch((err) => {
        console.error("Failed to generate files:", err);
      })
      .finally(() => setLoading(false));
  }, []);

  const downloadImageSetConfig = () => {
    const yaml = previewFiles["imageset-config.yaml"];
    if (!yaml) return;

    const blob = new Blob([yaml], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "imageset-config.yaml";
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = async () => {
    const yaml = previewFiles["imageset-config.yaml"];
    if (!yaml) return;

    try {
      await navigator.clipboard.writeText(yaml);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="step-content">
      <div className="step-body">
        <section className="card">
          <h2>ImageSet Configuration Ready</h2>
          <p className="note">
            Your imageset-config.yaml is ready for download. Transfer this file to your
            disconnected environment to begin mirroring operators and images.
          </p>
        </section>

        <section className="card">
          <h3>Configuration Summary</h3>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.5rem 1rem" }}>
            <dt style={{ fontWeight: 600 }}>OpenShift Version:</dt>
            <dd>{version}</dd>

            <dt style={{ fontWeight: 600 }}>Selected Operators:</dt>
            <dd>{operators.length} operator{operators.length !== 1 ? "s" : ""}</dd>

            {additionalImages.length > 0 && (
              <>
                <dt style={{ fontWeight: 600 }}>Additional Images:</dt>
                <dd>{additionalImages.length} custom image{additionalImages.length !== 1 ? "s" : ""}</dd>
              </>
            )}

            <dt style={{ fontWeight: 600 }}>Update Graph:</dt>
            <dd>{state.imagesetConfig?.graph !== false ? "Included" : "Excluded"}</dd>

            {state.imagesetConfig?.archiveSize && (
              <>
                <dt style={{ fontWeight: 600 }}>Archive Size Limit:</dt>
                <dd>{state.imagesetConfig.archiveSize} GiB</dd>
              </>
            )}
          </dl>
        </section>

        <section className="card">
          <h3>imageset-config.yaml</h3>
          {loading ? (
            <p className="note">Loading preview...</p>
          ) : (
            <pre
              style={{
                background: "var(--code-bg)",
                padding: "1rem",
                borderRadius: "4px",
                overflow: "auto",
                maxHeight: "500px",
                fontSize: "0.85rem",
                lineHeight: "1.4",
                whiteSpace: "pre-wrap"
              }}
            >
              {previewFiles["imageset-config.yaml"] || "# No preview available"}
            </pre>
          )}

          <div style={{ marginTop: "1.5rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <button onClick={downloadImageSetConfig} className="button-primary">
              Download imageset-config.yaml
            </button>

            <button onClick={copyToClipboard} className="button">
              {copySuccess ? "✓ Copied!" : "Copy to Clipboard"}
            </button>
          </div>
        </section>

        <section className="card">
          <h3>Next Steps</h3>
          <ol style={{ lineHeight: "1.8", paddingLeft: "1.5rem" }}>
            <li>Download the imageset-config.yaml file using the button above</li>
            <li>Transfer the file to your disconnected environment along with the oc-mirror binary</li>
            <li>On the high side (connected), run:
              <pre style={{ background: "var(--code-bg)", padding: "0.75rem", margin: "0.5rem 0", borderRadius: "4px" }}>
                oc-mirror --config imageset-config.yaml file://archives
              </pre>
              This creates a directory called <code>archives/</code> containing all operator images.
            </li>
            <li>Transfer the <code>archives/</code> directory to your airgapped cluster using approved methods:
              <ul style={{ marginTop: "0.5rem", listStyleType: "disc", paddingLeft: "1.5rem" }}>
                <li>Physical media (USB drives, external hard drives)</li>
                <li>Secure file transfer within controlled networks</li>
                <li>Other approved methods per your security policy</li>
              </ul>
            </li>
            <li>On the disconnected side, push images to your mirror registry:
              <pre style={{ background: "var(--code-bg)", padding: "0.75rem", margin: "0.5rem 0", borderRadius: "4px" }}>
                oc-mirror --from file://archives docker://registry.local:5000
              </pre>
              Replace <code>registry.local:5000</code> with your actual mirror registry URL.
            </li>
            <li>Apply the generated ImageContentSourcePolicy to your cluster:
              <pre style={{ background: "var(--code-bg)", padding: "0.75rem", margin: "0.5rem 0", borderRadius: "4px" }}>
                oc apply -f oc-mirror-workspace/results-*/imageContentSourcePolicy.yaml
              </pre>
            </li>
          </ol>
        </section>

        {operators.length > 0 && (
          <section className="card">
            <h3>Selected Operators</h3>
            <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {operators.slice(0, 10).map((op, i) => (
                <li key={i} style={{ padding: "0.5rem", background: "var(--card-bg-subtle)", borderRadius: "4px" }}>
                  <strong>{op.displayName || op.name}</strong>
                  <div style={{ fontSize: "0.85rem", color: "var(--text-subtle)", marginTop: "0.25rem" }}>
                    {op.catalog} • {op.defaultChannel}
                  </div>
                </li>
              ))}
              {operators.length > 10 && (
                <li className="note">...and {operators.length - 10} more operator{operators.length - 10 !== 1 ? "s" : ""}</li>
              )}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
};

export default ConnectedReviewStep;
