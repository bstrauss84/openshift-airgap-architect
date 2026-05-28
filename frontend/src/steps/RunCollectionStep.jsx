/**
 * OpenShift Airgap Architect - Run Collection Step (Connected Mode)
 *
 * Creates a CollectionPipeline CR on the OpenShift cluster to trigger
 * the mirror-operator collection process using the generated imageset-config.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useState, useEffect } from "react";
import { useApp } from "../store.jsx";
import { apiFetch } from "../api.js";

const RunCollectionStep = () => {
  const { state } = useApp();
  const [collectionName, setCollectionName] = useState("");
  const [pvcName, setPvcName] = useState("collection-storage");
  const [triggerType, setTriggerType] = useState("manual");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState("");
  const [pipelineInfo, setPipelineInfo] = useState(null);
  const [previewConfig, setPreviewConfig] = useState("");

  // Generate preview on mount
  useEffect(() => {
    apiFetch("/api/generate", {
      method: "POST",
      body: JSON.stringify({ state })
    })
      .then((data) => {
        setPreviewConfig(data.files?.["imageset-config.yaml"] || "");
      })
      .catch((err) => {
        console.error("Failed to generate preview:", err);
      });
  }, []);

  const handleCreate = async () => {
    if (!collectionName.trim() || !pvcName.trim()) {
      setError("Collection name and PVC name are required");
      return;
    }

    // Validate collection name (DNS-1123 subdomain)
    const dnsRegex = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
    if (!dnsRegex.test(collectionName)) {
      setError("Collection name must be a valid DNS name (lowercase letters, numbers, hyphens)");
      return;
    }

    setCreating(true);
    setError("");

    try {
      const response = await apiFetch("/api/collection-pipeline/create", {
        method: "POST",
        body: JSON.stringify({
          name: collectionName,
          imageSetConfig: previewConfig,
          pvc: pvcName,
          triggerType
        })
      });

      if (response.success) {
        setCreated(true);
        setPipelineInfo(response.pipeline);
      } else {
        // Handle 409 conflict error with helpful message
        if (response.existingName) {
          setError(`A CollectionPipeline named "${response.existingName}" already exists. Please choose a different name.`);
        } else {
          setError(response.error || "Failed to create CollectionPipeline");
        }
      }
    } catch (err) {
      setError(err.message || "Failed to create CollectionPipeline");
    } finally {
      setCreating(false);
    }
  };

  if (created && pipelineInfo) {
    return (
      <div className="step-content">
        <div className="step-body">
          <section className="card">
            <h2>✅ Collection Pipeline Created</h2>
            <p className="note">
              Your CollectionPipeline has been created successfully on the cluster.
              The mirror-operator will begin collecting operators and images.
            </p>

            <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.5rem 1rem", marginTop: "1.5rem" }}>
              <dt style={{ fontWeight: 600 }}>Pipeline Name:</dt>
              <dd><code>{pipelineInfo.name}</code></dd>

              <dt style={{ fontWeight: 600 }}>Namespace:</dt>
              <dd><code>{pipelineInfo.namespace}</code></dd>

              <dt style={{ fontWeight: 600 }}>UID:</dt>
              <dd><code style={{ fontSize: "0.85rem" }}>{pipelineInfo.uid}</code></dd>

              <dt style={{ fontWeight: 600 }}>Created:</dt>
              <dd>{new Date(pipelineInfo.creationTimestamp).toLocaleString()}</dd>
            </dl>
          </section>

          <section className="card">
            <h3>Next Steps</h3>
            <ol style={{ lineHeight: "1.8", paddingLeft: "1.5rem" }}>
              <li>Monitor the CollectionPipeline status:
                <pre style={{ background: "var(--code-bg)", padding: "0.75rem", margin: "0.5rem 0", borderRadius: "4px" }}>
                  oc get collectionpipeline {pipelineInfo.name} -o yaml
                </pre>
              </li>
              <li>Check mirror-operator logs for progress:
                <pre style={{ background: "var(--code-bg)", padding: "0.75rem", margin: "0.5rem 0", borderRadius: "4px" }}>
                  oc logs -l app=mirror-operator -f
                </pre>
              </li>
              <li>Once collection completes, the mirrored content will be available in PVC: <code>{pvcName}</code></li>
              <li>Use the mirrored content to deploy to your airgapped cluster</li>
            </ol>
          </section>

          <div style={{ marginTop: "2rem" }}>
            <button
              onClick={() => {
                setCreated(false);
                setPipelineInfo(null);
                setCollectionName("");
              }}
              className="button"
            >
              Create Another Pipeline
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="step-content">
      <div className="step-body">
        <section className="card">
          <h2>Create Collection Pipeline</h2>
          <p className="note">
            Create a CollectionPipeline custom resource on this OpenShift cluster.
            The mirror-operator will use your imageset-config to collect operators and images.
          </p>

          <div style={{ marginTop: "2rem" }}>
            <label htmlFor="collection-name" style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              Collection Name *
            </label>
            <input
              id="collection-name"
              type="text"
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
              placeholder="my-collection"
              style={{ width: "100%", maxWidth: "400px" }}
              disabled={creating}
            />
            <p className="note" style={{ marginTop: "0.5rem" }}>
              Must be a valid DNS name (lowercase letters, numbers, hyphens only)
            </p>
          </div>

          <div style={{ marginTop: "1.5rem" }}>
            <label htmlFor="pvc-name" style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              PVC Name *
            </label>
            <input
              id="pvc-name"
              type="text"
              value={pvcName}
              onChange={(e) => setPvcName(e.target.value)}
              placeholder="collection-storage"
              style={{ width: "100%", maxWidth: "400px" }}
              disabled={creating}
            />
            <p className="note" style={{ marginTop: "0.5rem" }}>
              Persistent Volume Claim for storing collected images. Must exist in the same namespace.
            </p>
          </div>

          <div style={{ marginTop: "1.5rem" }}>
            <label htmlFor="trigger-type" style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              Trigger Type
            </label>
            <select
              id="trigger-type"
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value)}
              style={{ width: "100%", maxWidth: "400px" }}
              disabled={creating}
            >
              <option value="manual">Manual</option>
              <option value="event">Event</option>
              <option value="scheduled">Scheduled</option>
            </select>
            <p className="note" style={{ marginTop: "0.5rem" }}>
              Manual: trigger manually via CR updates. Event/Scheduled: automatic triggers (see mirror-operator docs).
            </p>
          </div>

          {error && (
            <div className="note warning" style={{ marginTop: "1.5rem", padding: "1rem", background: "var(--warning-bg)", borderRadius: "4px" }}>
              {error}
            </div>
          )}

          <div style={{ marginTop: "2rem" }}>
            <button
              onClick={handleCreate}
              disabled={!collectionName.trim() || !pvcName.trim() || creating}
              className="button-primary"
            >
              {creating ? "Creating Pipeline..." : "Create Collection Pipeline"}
            </button>
          </div>
        </section>

        <section className="card">
          <h3>ImageSet Configuration Preview</h3>
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
            {previewConfig || "# Loading preview..."}
          </pre>
        </section>
      </div>
    </div>
  );
};

export default RunCollectionStep;
