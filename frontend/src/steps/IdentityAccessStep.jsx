/**
 * OpenShift Airgap Architect - Identity & Access Configuration Step
 *
 * Cluster identity (name, domain), SSH public key, pull secrets, and mirror
 * registry credentials configuration for segmented flow.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../store.jsx";
import { getScenarioId } from "../hostInventoryV2Helpers.js";
import { getFieldMeta } from "../catalogFieldMeta.js";
import { isValidPullSecret, isValidSshPublicKey } from "../validation.js";
import { apiFetch } from "../api.js";
import SecretInput from "../components/SecretInput.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";
import Switch from "../components/Switch.jsx";

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
        <section className={`card ${(fieldErrors.clusterName || fieldErrors.baseDomain) ? "highlight-errors" : ""}`}>
          <div className="card-header">
            <div>
              <h3 className="card-title">Cluster Identity</h3>
              <div className="card-subtitle">Cluster name and base domain for the install.</div>
            </div>
          </div>
          <div className="cluster-identity-fields">
            <FieldLabelWithInfo
              label="Cluster Name"
              hint={`Short identifier for this cluster.

**Format requirements:**
• Lowercase alphanumeric and hyphens only
• No underscores or special characters
• Keep it short (under 15 characters recommended)

**What this becomes:**
This becomes part of your cluster's URLs and DNS records. The full cluster domain will be <cluster-name>.<base-domain>

**DNS records created:**
• **Full domain:** prod-cluster.example.com
• **API endpoint:** api.prod-cluster.example.com
• **Applications:** *.apps.prod-cluster.example.com

**Important:**
⚠️ This **cannot be changed** after installation

**Example:**
prod-cluster
dev-ocp`}
              required
              className={fieldErrors.clusterName ? "input-error" : ""}
            >
              <input
                value={clusterName}
                onChange={(e) => updateBlueprint({ clusterName: e.target.value })}
                placeholder={defaultClusterName}
                className={fieldErrors.clusterName ? "input-error" : ""}
                aria-required="true"
                aria-invalid={fieldErrors.clusterName ? "true" : "false"}
              />
            </FieldLabelWithInfo>
            <FieldLabelWithInfo
              label="Base Domain"
              hint={`DNS domain suffix for your cluster.

**What is this:**
The parent domain under which all cluster DNS records are created

**How it's used:**
Your cluster's full domain becomes <cluster-name>.<base-domain>

**Requirements:**
• You must **own/control** this domain
• You must be able to **create DNS records** in it (api, *.apps, etc.)

**Common patterns:**

**On-premises:**
Often a subdomain of your corporate domain (e.g., ocp.company.com)

**Cloud:**
• **AWS:** Route 53 hosted zone
• **Azure:** Azure DNS zone

**Platform-specific:**
Some platforms (like AWS with pre-existing VPC) require you to provide DNS zones - check your platform's requirements

**Important:**
⚠️ **Cannot be changed** after installation

**Example:**
example.com
ocp.company.com`}
              required={requiredBaseDomain}
              className={fieldErrors.baseDomain ? "input-error" : ""}
            >
              <input
                value={baseDomain}
                onChange={(e) => updateBlueprint({ baseDomain: e.target.value })}
                placeholder="example.com"
                className={fieldErrors.baseDomain ? "input-error" : ""}
                aria-required={requiredBaseDomain ? "true" : "false"}
                aria-invalid={fieldErrors.baseDomain ? "true" : "false"}
              />
            </FieldLabelWithInfo>
          </div>
        </section>

        <section className={`card ${fieldErrors.pullSecret ? "highlight-errors" : ""}`}>
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
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: usingMirrorRegistry ? 8 : 0 }}>
                  <span className="credentials-mirror-label">Using a mirror registry?</span>
                  <Switch
                    checked={usingMirrorRegistry}
                    onChange={(checked) => updateCredentials({ usingMirrorRegistry: checked })}
                    aria-describedby="credentials-mirror-helper"
                  />
                </div>
                {usingMirrorRegistry ? (
                  <p id="credentials-mirror-helper" className="note credentials-mirror-helper" style={{ marginTop: 0, marginBottom: 0, textAlign: "left" }}>
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

            <div className="credentials-field-constrained">
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
                        hint={`Authentication credentials for accessing Red Hat container registries.

**What is this:**
A JSON file containing authentication tokens for pulling OpenShift container images from Red Hat's public registries (registry.redhat.io and quay.io). This is your proof of entitlement to download Red Hat software.

**Where to get it:**
Download from OpenShift Cluster Manager at console.redhat.com:
1. Log in with your Red Hat account
2. Navigate to OpenShift → Downloads
3. Click "Download pull secret" or "Copy pull secret"

**When needed:**
Required for clusters that access Red Hat registries **directly** or through **allowed egress**:
• **Connected installations:** Direct internet access to Red Hat registries
• **Proxy with egress:** Outbound traffic allowed through corporate proxy
• **NOT needed:** Fully disconnected/airgap installations using a mirror registry

**How it's used:**
Added to install-config.yaml as the \`pullSecret\` field. During installation, the cluster uses these credentials to authenticate when pulling OpenShift and RHCOS images from Red Hat.

**Format:**
JSON object with an \`auths\` key containing registry credentials:
\`\`\`json
{
  "auths": {
    "cloud.openshift.com": {"auth": "...", "email": "..."},
    "quay.io": {"auth": "...", "email": "..."},
    "registry.redhat.io": {"auth": "...", "email": "..."}
  }
}
\`\`\`

**Security:**
⚠️ **Not persisted** - This secret is used only for generating install-config.yaml and is not stored in browser storage or exported in state files. You must provide it again if you start a new session.

**Mirror registry mode:**
If you toggle "Using a mirror registry?" above, this field is replaced with the mirror registry pull secret field.

**Important:**
• Requires an active Red Hat subscription or trial
• Pull secret expires/rotates periodically - download a fresh one if issues occur
• Keep pull secrets confidential - they prove your entitlement`}
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
                              hint={`Authentication credentials for your local mirror registry in disconnected environments.

**What is this:**
A JSON file containing authentication tokens for pulling container images from your organization's local/disconnected mirror registry instead of Red Hat's public registries.

**When needed:**
Required for **disconnected/airgap installations** where the cluster cannot access Red Hat registries directly:
• Fully airgapped environments with no internet access
• Restricted networks with no egress to Red Hat
• Installations using oc-mirror or other mirroring tools
• Private container registries

**Format:**
Same JSON structure as Red Hat pull secret, but with your mirror registry's hostname:
\`\`\`json
{
  "auths": {
    "registry.corp.local:5000": {
      "auth": "base64EncodedUsername:Password",
      "email": "optional@example.com"
    }
  }
}
\`\`\`

**How to create:**

**Option 1: Use the "Help me generate" button**
Click the button below to open a helper that creates the pull secret JSON from:
• Mirror registry hostname (e.g., registry.corp.local:5000)
• Username
• Password
• Email (optional)

**Option 2: Use podman/docker CLI**
\`\`\`bash
podman login registry.corp.local:5000
cat ~/.docker/config.json
# or
cat \${XDG_RUNTIME_DIR}/containers/auth.json
\`\`\`

**Option 3: Manual base64 encoding**
\`\`\`bash
echo -n 'username:password' | base64
# Use the output in the auth field
\`\`\`

**How it's used:**
Added to install-config.yaml as the \`pullSecret\` field (when using a mirror registry). The cluster uses these credentials to authenticate when pulling OpenShift images from your local mirror.

**Anonymous pulls:**
If you selected "Anonymous pulls" above, this field is auto-filled with an OKD-documented dummy pull secret for unauthenticated registries. Switch to "Use mirror-registry credentials" to provide real authentication.

**Security:**
⚠️ **Not persisted** - This secret is used only for generating install-config.yaml and is not stored or exported. Provide it again in future sessions.

**Important:**
• Credentials must match what's configured on your mirror registry
• Test with \`podman login\` before installation
• Mirror registry must be accessible from installer host and cluster nodes`}
                              required={requiredPullSecret}
                              placeholder='{"auths":{...}}'
                              rows={5}
                              aria-label="Mirror registry pull secret JSON"
                              additionalButtons={
                                <button
                                  type="button"
                                  className="ghost pull-secret-upload"
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
                              }
                            />
                          </>
                        )}
                      </>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="credentials-field-constrained">
              <FieldLabelWithInfo
                label="SSH Public Key"
                hint={`SSH public key for remote access to cluster machines.

**What is this:**
The public half of an SSH keypair that will be added to all cluster nodes. This allows you to SSH into nodes for debugging, troubleshooting, and day-2 operations.

**Format:**
Standard SSH public key formats are supported:
• **ssh-rsa** (RSA, 2048+ bits)
• **ssh-ed25519** (EdDSA, recommended for modern systems)
• **ecdsa-sha2-nistp256/384/521** (ECDSA)

**How to provide:**
• **Paste** an existing public key from ~/.ssh/id_*.pub
• **Drag and drop** or **upload** a .pub file
• **Generate keypair** using the button below (saves both .pub and .pem files)

**Generate keypair button:**
Click "Generate keypair" to create a new SSH keypair using secure algorithms. The modal will show both the public and private keys. You MUST download and save the private key (.pem) immediately - it cannot be retrieved later.

**Why this matters:**
Without SSH access, you cannot directly access cluster nodes for troubleshooting. This is critical for:
• Debugging node issues
• Collecting logs and diagnostics
• Day-2 operations and maintenance
• Emergency recovery scenarios

**Security:**
⚠️ Keep the private key secure - anyone with access to it can SSH into your cluster nodes. Never share the private key or commit it to version control.

**Example public key:**
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQC... user@hostname
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJqfh... user@hostname`}
                required={metaSshKey?.required}
              >
                <textarea
                  value={sshPublicKey}
                  onChange={(e) => updateCredentials({ sshPublicKey: e.target.value })}
                  rows={3}
                  placeholder="ssh-rsa AAAA..."
                  aria-required="true"
                  aria-invalid={sshKeyInvalid ? "true" : "false"}
                  aria-describedby={sshKeyInvalid ? "ssh-key-error" : undefined}
                />
              </FieldLabelWithInfo>
              {sshKeyInvalid ? <div id="ssh-key-error" className="note warning" role="alert">SSH public key format is invalid.</div> : null}
              <div className="actions" style={{ marginTop: 8, marginBottom: 0 }}>
                <button type="button" className="ghost" style={{ padding: "8px 14px", fontSize: "0.875rem", fontWeight: 500 }} onClick={openKeygen}>
                  Generate keypair
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Security Compliance</h3>
              <div className="card-subtitle">Enable hardened crypto settings when required.</div>
            </div>
            <FieldLabelWithInfo
              label="FIPS mode"
              hint={`Federal Information Processing Standards (FIPS) 140-2 compliant cryptography.

**What is FIPS:**
FIPS 140-2 is a U.S. government computer security standard used to validate cryptographic modules. When enabled, OpenShift uses only FIPS-validated cryptography libraries and algorithms.

**Who needs this:**
Organizations with strict compliance requirements:
• **Government:** Federal, state, and local government agencies
• **Defense contractors:** Companies working on government contracts
• **Regulated industries:** Finance, healthcare, critical infrastructure
• **International compliance:** Some international regulations require FIPS

**Requirements:**
⚠️ **Critical:** The installer host (where you run openshift-install) MUST run RHEL 9 with FIPS mode already enabled at the OS level. The installation will fail if the installer host does not have FIPS enabled.

**What happens when enabled:**
• All cluster nodes boot with FIPS-compliant kernel settings
• Only FIPS-validated cryptographic modules are used
• Some features may be limited or unavailable
• Stricter algorithm and key length requirements
• Cannot be changed after installation

**Impact on cluster:**
• **Performance:** Slight performance impact due to stricter crypto validation
• **Compatibility:** Some third-party software may not support FIPS
• **Upgrades:** FIPS setting persists through cluster upgrades
• **Immutable:** Cannot disable FIPS after installation without rebuilding cluster

**Important:**
⚠️ This setting **cannot be changed** after cluster installation. You must rebuild the cluster to change FIPS mode.

**When NOT to enable:**
If you don't have specific compliance requirements that mandate FIPS, leave this disabled. Enabling FIPS adds complexity and may limit functionality without providing security benefits for non-regulated environments.

**Example use case:**
A federal agency deploying OpenShift must enable FIPS to comply with NIST 800-53 security controls and federal information security requirements.`}
              style={{ marginBottom: 0 }}
            >
              <Switch
                checked={fips}
                onChange={(checked) => updateStrategy({ fips: checked })}
              />
            </FieldLabelWithInfo>
          </div>
          <div
            className="note"
            style={{ visibility: fips ? "visible" : "hidden" }}
            aria-hidden={fips ? undefined : "true"}
          >
            The installer host must run RHEL 9 with FIPS enabled.
          </div>
        </section>
      </div>

      {showKeygen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setShowKeygen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Generate SSH keypair</h3>
            <div className="note warning">
              Save the private key now. It will not be stored and cannot be retrieved later.
            </div>

            <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end", marginTop: "1.5rem", marginBottom: keygenLoading || keypair ? "1.5rem" : "0" }}>
              <label style={{ flex: 1 }}>
                Key type
                <select value={keygenAlgorithm} onChange={(e) => setKeygenAlgorithm(e.target.value)} disabled={keygenLoading} style={{ width: "100%" }}>
                  <option value="ed25519">ed25519 (recommended)</option>
                  <option value="rsa">RSA 4096</option>
                  <option value="ecdsa">ECDSA P-521</option>
                </select>
              </label>
              <button className="primary" onClick={generateKeypair} disabled={keygenLoading} style={{ flexShrink: 0 }}>
                {keygenLoading ? "Generating…" : "Generate"}
              </button>
            </div>

            {keygenLoading ? <div className="loading">Generating keypair…</div> : null}
            {!keygenLoading && keypair ? (
              <>
                <h4 style={{ marginTop: "1.5rem", marginBottom: "0.75rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary)" }}>Generated keypair</h4>

                <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "var(--surface-raised)", borderRadius: "6px", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    id="use-generated-key"
                    checked={useGeneratedKey}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setUseGeneratedKey(checked);
                      if (checked) updateCredentials({ sshPublicKey: keypair.publicKey });
                    }}
                    style={{ margin: 0, cursor: "pointer" }}
                  />
                  <label htmlFor="use-generated-key" style={{ margin: 0, cursor: "pointer", fontSize: "0.875rem", fontWeight: 500 }}>
                    Use generated public key for this run
                  </label>
                </div>

                <label style={{ display: "block", marginBottom: "1rem" }}>
                  Public key
                  <textarea className="textarea" rows={3} value={keypair.publicKey} readOnly style={{ fontFamily: "monospace", fontSize: "0.8125rem", width: "100%", marginTop: "0.5rem" }} />
                </label>

                <label style={{ display: "block", marginBottom: "1.5rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
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
                    style={{ fontFamily: "monospace", fontSize: "0.8125rem", width: "100%" }}
                  />
                </label>
              </>
            ) : null}
            {keygenError ? <div className="note warning" style={{ marginTop: "1rem" }}>{keygenError}</div> : null}

            <div className="actions" style={{ marginTop: "1.5rem" }}>
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
            <div className="note warning">
              Credentials entered here are used only to generate the JSON locally. They are not stored or exported.
            </div>

            <h4 style={{ marginTop: "1.5rem", marginBottom: "0.75rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary)" }}>Registry credentials</h4>

            <label style={{ display: "block", marginBottom: "1rem" }}>
              Registry FQDN
              <input value={mirrorHelper.registry} onChange={(e) => setMirrorHelper((h) => ({ ...h, registry: e.target.value }))} placeholder="registry.corp.local:5000" style={{ width: "100%" }} />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
              <label>
                Username
                <input autoComplete="off" value={mirrorHelper.username} onChange={(e) => setMirrorHelper((h) => ({ ...h, username: e.target.value }))} placeholder="mirror-user" style={{ width: "100%" }} />
              </label>
              <label>
                Password
                <input type="password" autoComplete="new-password" value={mirrorHelper.password} onChange={(e) => setMirrorHelper((h) => ({ ...h, password: e.target.value }))} placeholder="••••••••" style={{ width: "100%" }} />
              </label>
            </div>

            <label style={{ display: "block", marginBottom: "1.5rem" }}>
              Email (optional)
              <input value={mirrorHelper.email} onChange={(e) => setMirrorHelper((h) => ({ ...h, email: e.target.value }))} placeholder="ops@example.com" style={{ width: "100%" }} />
            </label>

            <h4 style={{ marginTop: "1.5rem", marginBottom: "0.75rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary)" }}>Generated pull secret</h4>
            <label>
              <textarea className="textarea" rows={6} value={generateMirrorPullSecret()} readOnly style={{ fontFamily: "monospace", fontSize: "0.8125rem" }} />
            </label>

            <div className="actions" style={{ marginTop: "1.5rem" }}>
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
              <button type="button" className="ghost" onClick={() => navigator.clipboard.writeText(generateMirrorPullSecret())}>Copy generated secret</button>
              <button type="button" className="ghost" onClick={() => setShowMirrorSecretHelper(false)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
