import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../store.jsx";
import { getScenarioId } from "../hostInventoryV2Helpers.js";
import { getFieldMeta } from "../catalogFieldMeta.js";
import { isValidPullSecret, isValidSshPublicKey } from "../validation.js";
import { apiFetch } from "../api.js";
import SecretInput from "../components/SecretInput.jsx";

/**
 * Identity & Access replacement tab (Phase 5 segmented flow, Prompt E).
 * Pull secret gated by "Using a mirror registry?"; SSH key with generate + download (.pub / .pem).
 * Same state paths as legacy; pull/mirror secrets not persisted (store strips them).
 */
export default function IdentityAccessStep({ previewControls, previewEnabled, highlightErrors, fieldErrors = {} }) {
  const { state, updateState } = useApp();
  const platform = state.blueprint?.platform;
  const method = state.methodology?.method;
  const scenarioId = getScenarioId(platform, method);
  const strategy = state.globalStrategy || {};
  const mirroring = strategy.mirroring || {};

  const usingMirrorRegistry = state.credentials?.usingMirrorRegistry ?? false;
  const pullSecretPlaceholder = state.credentials?.pullSecretPlaceholder ?? "";
  const mirrorRegistryPullSecret = state.credentials?.mirrorRegistryPullSecret ?? "";
  const mirrorRegistryUnauthenticated = state.credentials?.mirrorRegistryUnauthenticated ?? false;

  const clusterName = state.blueprint?.clusterName ?? "";
  const baseDomain = state.blueprint?.baseDomain ?? "";
  const sshPublicKey = state.credentials?.sshPublicKey ?? "";
  const fips = state.globalStrategy?.fips ?? false;

  const [showKeygen, setShowKeygen] = useState(false);
  const [keypair, setKeypair] = useState(null);
  const [useGeneratedKey, setUseGeneratedKey] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [keygenAlgorithm, setKeygenAlgorithm] = useState("ed25519");
  const [keygenLoading, setKeygenLoading] = useState(false);
  const [keygenError, setKeygenError] = useState("");
  const [showMirrorSecretHelper, setShowMirrorSecretHelper] = useState(false);
  const [mirrorSecretBackup, setMirrorSecretBackup] = useState("");
  const [mirrorHelper, setMirrorHelper] = useState({
    registry: mirroring.registryFqdn || "",
    username: "",
    password: "",
    email: ""
  });

  const anyModalOpen = showKeygen || showMirrorSecretHelper;
  useEffect(() => {
    if (!anyModalOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setShowKeygen(false);
        setShowMirrorSecretHelper(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [anyModalOpen]);

  const installConfig = "install-config.yaml";
  const metaName = getFieldMeta(scenarioId, installConfig, "metadata.name");
  const metaBaseDomain = getFieldMeta(scenarioId, installConfig, "baseDomain");
  const metaPullSecret = getFieldMeta(scenarioId, installConfig, "pullSecret");
  const metaSshKey = getFieldMeta(scenarioId, installConfig, "sshKey");

  const activePullSecret = usingMirrorRegistry ? mirrorRegistryPullSecret : pullSecretPlaceholder;
  const pullSecretCheck = isValidPullSecret(activePullSecret);
  const sshKeyInvalid = sshPublicKey && !isValidSshPublicKey(sshPublicKey);

  const updateBlueprint = (patch) =>
    updateState({ blueprint: { ...state.blueprint, ...patch } });
  const updateCredentials = (patch) => {
    const next = { ...state.credentials, ...patch };
    updateState({ credentials: next });
  };
  const updateStrategy = (patch) =>
    updateState({ globalStrategy: { ...state.globalStrategy, ...patch } });

  const isRequired = (meta) => meta && meta.required === true;
  const requiredName = isRequired(metaName);
  const requiredBaseDomain = isRequired(metaBaseDomain);
  const requiredPullSecret = isRequired(metaPullSecret);

  const defaultClusterName =
    metaName?.default != null && typeof metaName.default === "string" && metaName.default.includes("agent-cluster")
      ? "agent-cluster"
      : metaName?.default != null && typeof metaName.default === "string"
        ? metaName.default
        : "agent-cluster";

  /** OKD/installer dummy auth for unauthenticated registry: per https://github.com/orgs/okd-project/discussions/1930 */
  const buildUnauthMirrorSecret = () => {
    const registry = mirrorHelper.registry || mirroring.registryFqdn || "registry.local:5000";
    return JSON.stringify({ auths: { [registry]: { auth: "aWQ6cGFzcwo=", email: "" } } });
  };

  const generateMirrorPullSecret = () => {
    const registry = mirrorHelper.registry || mirroring.registryFqdn || "";
    if (!registry) return "";
    const auth = window.btoa(`${mirrorHelper.username}:${mirrorHelper.password}`);
    return JSON.stringify({
      auths: {
        [registry]: {
          auth,
          email: mirrorHelper.email || undefined
        }
      }
    });
  };

  const openKeygen = () => {
    setShowMirrorSecretHelper(false);
    setShowKeygen(true);
    setKeygenError("");
    setKeypair(null);
    setUseGeneratedKey(false);
    setShowPrivateKey(false);
  };

  const generateKeypair = async () => {
    setKeygenLoading(true);
    setKeygenError("");
    setKeypair(null);
    setUseGeneratedKey(false);
    setShowPrivateKey(false);
    try {
      const data = await apiFetch("/api/ssh/keypair", {
        method: "POST",
        body: JSON.stringify({ algorithm: keygenAlgorithm })
      });
      setKeypair(data);
    } catch (error) {
      setKeygenError(String(error?.message || error));
    } finally {
      setKeygenLoading(false);
    }
  };

  const downloadKeypairSeparate = (publicKey, privateKey) => {
    const ext = keygenAlgorithm === "ed25519" ? "ed25519" : keygenAlgorithm === "rsa" ? "rsa" : "ecdsa";
    const pubBlob = new Blob([publicKey], { type: "text/plain" });
    const pubUrl = URL.createObjectURL(pubBlob);
    const pubA = document.createElement("a");
    pubA.href = pubUrl;
    pubA.download = `id_${ext}.pub`;
    pubA.click();
    URL.revokeObjectURL(pubUrl);

    const privBlob = new Blob([privateKey], { type: "text/plain" });
    const privUrl = URL.createObjectURL(privBlob);
    const privA = document.createElement("a");
    privA.href = privUrl;
    privA.download = `id_${ext}.pem`;
    privA.click();
    URL.revokeObjectURL(privUrl);
  };

  return (
    <div className="step">
      <div className="step-header">
        <div className="step-header-main">
          <h2>Identity & Access</h2>
          <p className="subtle">Cluster identity and access credentials for the install.</p>
        </div>
        {previewEnabled ? (
          <div className="header-actions">
            <button className="ghost" onClick={() => previewControls?.setShowPreview((prev) => !prev)}>
              {previewControls?.showPreview ? "Hide YAML" : "Show YAML"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="step-body">
        {state.reviewFlags?.["identity-access"] && state.ui?.visitedSteps?.["identity-access"] ? (
          <div className="banner warning">
            Version or upstream selections changed. Review this page to ensure settings are still valid.
            <div className="actions">
              <button
                className="ghost"
                onClick={() => updateState({ reviewFlags: { ...state.reviewFlags, "identity-access": false } })}
              >
                Re-evaluate this page
              </button>
            </div>
          </div>
        ) : null}
        <section className={`card ${highlightErrors ? "highlight-errors" : ""}`}>
          <div className="card-header">
            <div>
              <h3 className="card-title">Cluster Identity</h3>
              <div className="card-subtitle">Cluster name and base domain for the install.</div>
            </div>
          </div>
          <div className="cluster-identity-fields">
            <label className={fieldErrors.clusterName ? "input-error" : ""}>
              Cluster Name <span className="required-indicator">(required)</span>
              <input
                value={clusterName}
                onChange={(e) => updateBlueprint({ clusterName: e.target.value })}
                placeholder={defaultClusterName}
                className={fieldErrors.clusterName ? "input-error" : ""}
              />
            </label>
            <label className={fieldErrors.baseDomain ? "input-error" : ""}>
              Base Domain {requiredBaseDomain ? <span className="required-indicator">(required)</span> : null}
              <input
                value={baseDomain}
                onChange={(e) => updateBlueprint({ baseDomain: e.target.value })}
                placeholder="example.com"
                className={fieldErrors.baseDomain ? "input-error" : ""}
              />
            </label>
          </div>
        </section>

        <section className={`card ${(highlightErrors || fieldErrors.pullSecret) ? "highlight-errors" : ""}`}>
          <div className="card-header">
            <div>
              <h3 className="card-title">Access Credentials</h3>
              <div className="card-subtitle">Pull secret and SSH key for cluster machines. Not stored persistently.</div>
            </div>
          </div>
          <div className="card-body">
            <div
              className="credentials-mirror-checkbox-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "24px 32px",
                alignItems: "start",
                marginBottom: 16
              }}
            >
              <div className="credentials-mirror-cell" style={{ minWidth: 0 }}>
                <label className="credentials-mirror-title-row" style={{ display: "inline", marginBottom: 0 }}>
                  <span className="credentials-mirror-label">Using a mirror registry?</span>
                  {" "}
                  <input
                    type="checkbox"
                    checked={usingMirrorRegistry}
                    onChange={(e) => {
                      const on = e.target.checked;
                      updateCredentials({ usingMirrorRegistry: on });
                    }}
                    aria-describedby="credentials-mirror-helper"
                  />
                </label>
                {usingMirrorRegistry ? (
                  <p id="credentials-mirror-helper" className="note credentials-mirror-helper" style={{ marginTop: 8, marginBottom: 0, textAlign: "left" }}>
                    For disconnected/mirrored installs the cluster pulls images from your mirror registry. Choose how the mirror registry is accessed. Not persisted.
                  </p>
                ) : null}
              </div>
              {usingMirrorRegistry ? (
                <div className="credentials-mirror-auth-mode" style={{ gridColumn: "1 / -1", marginTop: 8 }}>
                  <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
                    <legend className="credentials-mirror-label" style={{ marginBottom: 6 }}>Mirror registry authentication</legend>
                    <label className="toggle-row" style={{ display: "block", marginBottom: 6 }}>
                      <input
                        type="radio"
                        name="mirror-auth-mode"
                        checked={mirrorRegistryUnauthenticated}
                        onChange={() => {
                          setMirrorSecretBackup(mirrorRegistryPullSecret);
                          updateCredentials({ mirrorRegistryUnauthenticated: true, mirrorRegistryPullSecret: buildUnauthMirrorSecret() });
                        }}
                        aria-describedby="credentials-mirror-okd-warning"
                      />
                      <span>Anonymous pulls</span>
                    </label>
                    {mirrorRegistryUnauthenticated ? (
                      <div id="credentials-mirror-okd-warning" className="note warning credentials-mirror-okd-warning" style={{ marginTop: 4, marginBottom: 8, marginLeft: 24, textAlign: "left" }}>
                        Uses the <a href="https://github.com/orgs/okd-project/discussions/1930" target="_blank" rel="noopener noreferrer">OKD-documented dummy pull secret</a> for unauthenticated registries. Install-config will emit this value when credentials are included.
                      </div>
                    ) : null}
                    <label className="toggle-row" style={{ display: "block" }}>
                      <input
                        type="radio"
                        name="mirror-auth-mode"
                        checked={!mirrorRegistryUnauthenticated}
                        onChange={() => {
                          updateCredentials({ mirrorRegistryUnauthenticated: false, mirrorRegistryPullSecret: mirrorSecretBackup || "" });
                        }}
                      />
                      <span>Use mirror-registry credentials (paste, upload, or generate)</span>
                    </label>
                  </fieldset>
                </div>
              ) : null}
            </div>

            {(() => {
              const pullSecretError = fieldErrors.pullSecret || (!pullSecretCheck.valid ? pullSecretCheck.error : null);
              return (
                <>
                  {pullSecretError ? (
                    <div className="note warning" style={{ marginBottom: 8 }}>
                      {pullSecretError}
                    </div>
                  ) : null}
                  {!usingMirrorRegistry ? (
                    <SecretInput
                      value={pullSecretPlaceholder}
                      onChange={(v) => updateCredentials({ pullSecretPlaceholder: v })}
                      label="Pull secret (Red Hat)"
                      labelEmphasis="Paste, drag and drop, or upload a Red Hat pull secret (JSON)"
                      labelHint="For clusters that access Red Hat registries directly or through allowed egress. From OpenShift Cluster Manager. Used in install-config when not using a mirror registry. Not persisted."
                      getPullSecretUrl="https://console.redhat.com/openshift/downloads#tool-pull-secret"
                      required={requiredPullSecret}
                      placeholder='{"auths":{...}}'
                      rows={5}
                      aria-label="Red Hat pull secret JSON"
                    />
                  ) : (
                    <>
                      {mirrorRegistryUnauthenticated ? (
                        <p className="note" style={{ marginTop: 0 }}>
                          Anonymous pulls selected. Choose &quot;Use mirror-registry credentials&quot; above to paste, upload, or generate credentials.
                        </p>
                      ) : (
                        <>
                          <SecretInput
                            value={mirrorRegistryPullSecret}
                            onChange={(v) => {
                              if (mirrorRegistryUnauthenticated) {
                                updateCredentials({ mirrorRegistryUnauthenticated: false, mirrorRegistryPullSecret: v });
                              } else {
                                updateCredentials({ mirrorRegistryPullSecret: v });
                              }
                            }}
                            label="Pull secret (Mirror registry)"
                            labelEmphasis="Paste, drag and drop, or upload mirror registry pull secret (JSON)"
                            required={requiredPullSecret}
                            placeholder='{"auths":{...}}'
                            rows={5}
                            aria-label="Mirror registry pull secret JSON"
                          />
                          <div className="actions">
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => {
                                setShowKeygen(false);
                                if (mirrorRegistryUnauthenticated) {
                                  updateCredentials({ mirrorRegistryUnauthenticated: false, mirrorRegistryPullSecret: "" });
                                }
                                setMirrorHelper((h) => ({ ...h, registry: mirroring.registryFqdn || h.registry }));
                                setShowMirrorSecretHelper(true);
                              }}
                            >
                              Help me generate
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </>
              );
            })()}

            <label>
              SSH Public Key {metaSshKey?.required ? <span className="required-indicator">(required)</span> : null}
            </label>
            <div className="note">Paste, drag and drop, or upload; or generate a keypair below.</div>
            <textarea
              value={sshPublicKey}
              onChange={(e) => updateCredentials({ sshPublicKey: e.target.value })}
              rows={3}
              placeholder="ssh-rsa AAAA..."
            />
            {sshKeyInvalid ? <div className="note warning">SSH public key format is invalid.</div> : null}
            <div className="actions">
              <button type="button" className="ghost" onClick={openKeygen}>
                Generate keypair
              </button>
            </div>
          </div>
        </section>

        <section className={`card ${highlightErrors ? "highlight-errors" : ""}`}>
          <div className="card-header">
            <div>
              <h3 className="card-title">Security Compliance</h3>
              <div className="card-subtitle">Enable hardened crypto settings when required.</div>
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={fips}
                onChange={(e) => updateStrategy({ fips: e.target.checked })}
              />
              <span>FIPS mode</span>
            </label>
          </div>
          {fips ? (
            <div className="note">
              The installer host must run RHEL 9 with FIPS enabled.
            </div>
          ) : null}
        </section>
      </div>

      {showKeygen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setShowKeygen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Generate SSH keypair</h3>
            <div className="note warning">
              Save the private key now. It will not be stored and cannot be retrieved later.
            </div>
            <div className="field-grid">
              <label>
                Key type
                <select value={keygenAlgorithm} onChange={(e) => setKeygenAlgorithm(e.target.value)} disabled={keygenLoading}>
                  <option value="ed25519">ed25519 (recommended)</option>
                  <option value="rsa">RSA 4096</option>
                  <option value="ecdsa">ECDSA P-521</option>
                </select>
              </label>
              <div className="actions" style={{ alignItems: "flex-end" }}>
                <button className="primary" onClick={generateKeypair} disabled={keygenLoading}>
                  {keygenLoading ? "Generating…" : "Generate"}
                </button>
              </div>
            </div>
            {keygenLoading ? <div className="loading">Generating keypair…</div> : null}
            {!keygenLoading && keypair ? (
              <>
                <label>
                  Public key
                  <textarea className="textarea" rows={3} value={keypair.publicKey} readOnly />
                </label>
                <label>
                  <div className="field-header">
                    <span>Private key</span>
                    <button type="button" className="ghost mini" title={showPrivateKey ? "Hide key" : "Show key"} onClick={() => setShowPrivateKey((p) => !p)}>
                      {showPrivateKey ? "Hide" : "Show"}
                    </button>
                  </div>
                  <textarea
                    className="textarea"
                    rows={6}
                    value={showPrivateKey ? keypair.privateKey : "•".repeat(Math.min(keypair.privateKey.length, 1200))}
                    readOnly
                  />
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={useGeneratedKey}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setUseGeneratedKey(checked);
                      if (checked) updateCredentials({ sshPublicKey: keypair.publicKey });
                    }}
                  />
                  <span>Use generated public key for this run</span>
                </label>
              </>
            ) : null}
            {keygenError ? <div className="note warning">{keygenError}</div> : null}
            <div className="actions">
              {!keygenLoading && keypair ? (
                <>
                  <button type="button" className="ghost" onClick={() => navigator.clipboard.writeText(keypair.publicKey)}>Copy public key</button>
                  <button type="button" className="ghost" onClick={() => navigator.clipboard.writeText(keypair.privateKey)}>Copy private key</button>
                  <button type="button" className="ghost" onClick={() => downloadKeypairSeparate(keypair.publicKey, keypair.privateKey)}>Download keys (.pub and .pem)</button>
                </>
              ) : null}
              <button type="button" className="ghost" onClick={() => setShowKeygen(false)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {showMirrorSecretHelper ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setShowMirrorSecretHelper(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Mirror registry pull secret helper</h3>
            <div className="note">
              Credentials entered here are used only to generate the JSON locally. They are not stored or exported.
            </div>
            <div className="field-grid">
              <label>
                Registry FQDN
                <input value={mirrorHelper.registry} onChange={(e) => setMirrorHelper((h) => ({ ...h, registry: e.target.value }))} placeholder="registry.corp.local:5000" />
              </label>
              <label>
                Username
                <input autoComplete="off" value={mirrorHelper.username} onChange={(e) => setMirrorHelper((h) => ({ ...h, username: e.target.value }))} placeholder="mirror-user" />
              </label>
              <label>
                Password
                <input type="password" autoComplete="new-password" value={mirrorHelper.password} onChange={(e) => setMirrorHelper((h) => ({ ...h, password: e.target.value }))} placeholder="••••••••" />
              </label>
              <label>
                Email (optional)
                <input value={mirrorHelper.email} onChange={(e) => setMirrorHelper((h) => ({ ...h, email: e.target.value }))} placeholder="ops@example.com" />
              </label>
            </div>
            <label>
              Generated pull secret
              <textarea className="textarea" rows={6} value={generateMirrorPullSecret()} readOnly />
            </label>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => navigator.clipboard.writeText(generateMirrorPullSecret())}>Copy generated secret</button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const generated = generateMirrorPullSecret();
                  if (generated) {
                    updateCredentials({ mirrorRegistryPullSecret: generated, mirrorRegistryUnauthenticated: false });
                  }
                  setShowMirrorSecretHelper(false);
                }}
              >
                Use generated secret
              </button>
              <button type="button" className="ghost" onClick={() => setShowMirrorSecretHelper(false)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
