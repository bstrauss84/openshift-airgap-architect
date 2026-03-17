/**
 * Trust & Proxy replacement step (segmented flow). Proxy (http/https/noProxy), additional trust bundle policy,
 * mirror registry CA and proxy CA PEMs. State: globalStrategy.proxies, globalStrategy.proxyEnabled, trust.*.
 * Enable proxy = blue toggle; trust grouped with clear labels; red only on cards with actual errors.
 */
import React from "react";
import { useApp } from "../store.jsx";
import { getScenarioId, getParamMeta, getRequiredParamsForOutput } from "../catalogResolver.js";
import { getTrustBundlePolicies } from "../shared/versionPolicy.js";
import OptionRow from "../components/OptionRow.jsx";
import Switch from "../components/Switch.jsx";
import Banner from "../components/Banner.jsx";
import Button from "../components/Button.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";

const INSTALL_CONFIG = "install-config.yaml";

const trustBundleBlocks = (pem) =>
  (pem || "")
    .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)
    ?.map((block) => block.trim()) || [];

function PemField({ label, required, value, onChange, onFiles, error, placeholder }) {
  return (
    <div className="trust-pem-field">
      <label>
        {label}
        {required ? <span className="required-badge">required</span> : null}
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder={placeholder}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFiles(e.dataTransfer.files);
          }}
        />
        {error ? <div className="note warning">{error}</div> : null}
        <input
          type="file"
          accept=".pem,.crt,.cer"
          multiple
          onChange={(e) => onFiles(e.target.files || [])}
          className="trust-file-input"
        />
      </label>
    </div>
  );
}

export default function TrustProxyStep({ highlightErrors }) {
  const { state, updateState } = useApp();
  const scenarioId = getScenarioId(state);
  const strategy = state.globalStrategy || {};
  const proxies = strategy.proxies || {};
  const trust = state.trust || {};
  const selectedVersion = state.release?.patchVersion || state.version?.selectedVersion || "";
  const [proxyCaError, setProxyCaError] = React.useState("");
  const [mirrorCaError, setMirrorCaError] = React.useState("");

  const updateStrategy = (patch) => updateState({ globalStrategy: { ...strategy, ...patch } });
  const updateProxy = (field, value) =>
    updateStrategy({ proxies: { ...proxies, [field]: value } });
  const updateTrust = (patch) => updateState({ trust: { ...trust, ...patch } });

  const requiredPaths = getRequiredParamsForOutput(scenarioId, INSTALL_CONFIG) || [];
  const isRequired = (path) => requiredPaths.includes(path);

  const metaHttpProxy = getParamMeta(scenarioId, "proxy.httpProxy", INSTALL_CONFIG);
  const metaHttpsProxy = getParamMeta(scenarioId, "proxy.httpsProxy", INSTALL_CONFIG);
  const metaNoProxy = getParamMeta(scenarioId, "proxy.noProxy", INSTALL_CONFIG);
  const metaPolicy = getParamMeta(scenarioId, "additionalTrustBundlePolicy", INSTALL_CONFIG);

  const policyAllowed = Array.isArray(metaPolicy?.allowed)
    ? metaPolicy.allowed
    : metaPolicy?.allowed
      ? [metaPolicy.allowed]
      : [];
  const trustPolicyOptions = policyAllowed.length
    ? policyAllowed
    : getTrustBundlePolicies(selectedVersion);
  const policyDefault = metaPolicy?.default || "Proxyonly";

  const mirrorBlocks = trustBundleBlocks(trust.mirrorRegistryCaPem);
  const proxyBlocks = trustBundleBlocks(trust.proxyCaPem);
  const effectiveBundle = Array.from(new Set([...mirrorBlocks, ...proxyBlocks])).join("\n");
  const totalCerts = mirrorBlocks.length + proxyBlocks.length;

  const validatePemInput = (text, setError) => {
    if (!text) {
      setError("");
      return;
    }
    if (/BEGIN (RSA )?PRIVATE KEY/.test(text || "")) {
      setError("Private keys are not allowed in CA bundles.");
      return;
    }
    if (!trustBundleBlocks(text).length) {
      setError("Provide one or more PEM-encoded certificates.");
      return;
    }
    setError("");
  };

  const handleProxyCaText = (text) => {
    updateTrust({ proxyCaPem: text });
    validatePemInput(text, setProxyCaError);
  };

  const handleProxyCaFiles = async (files) => {
    const texts = await Promise.all(Array.from(files).map((file) => file.text()));
    handleProxyCaText(texts.join("\n"));
  };

  const handleMirrorCaText = (text) => {
    updateTrust({ mirrorRegistryCaPem: text });
    validatePemInput(text, setMirrorCaError);
  };

  const handleMirrorCaFiles = async (files) => {
    const texts = await Promise.all(Array.from(files).map((file) => file.text()));
    handleMirrorCaText(texts.join("\n"));
  };

  React.useEffect(() => {
    if (!effectiveBundle && trust.additionalTrustBundlePolicy) {
      updateTrust({ additionalTrustBundlePolicy: "" });
      return;
    }
    if (effectiveBundle && !trust.additionalTrustBundlePolicy && trustPolicyOptions.length) {
      const defaultPolicy = trust.mirrorRegistryCaPem ? "Always" : strategy.proxyEnabled ? "Proxyonly" : "Always";
      updateTrust({ additionalTrustBundlePolicy: defaultPolicy });
    }
  }, [effectiveBundle, selectedVersion, strategy.proxyEnabled]);

  const proxyErrors = {};
  if (strategy.proxyEnabled) {
    if (proxies.httpProxy && !proxies.httpProxy.startsWith("http://")) {
      proxyErrors.httpProxy = "HTTP proxy must start with http://";
    }
    if (proxies.httpsProxy && !proxies.httpsProxy.startsWith("http://") && !proxies.httpsProxy.startsWith("https://")) {
      proxyErrors.httpsProxy = "HTTPS proxy must start with http:// or https:// (use the scheme your proxy supports).";
    }
  }

  const proxyCardHasErrors = Boolean(proxyErrors.httpProxy || proxyErrors.httpsProxy);
  const trustCardHasErrors = Boolean(mirrorCaError || proxyCaError);

  return (
    <div className="step">
      <div className="step-header">
        <div className="step-header-main">
          <h2>Trust & Proxy</h2>
          <p className="subtle">Corporate proxy and CA trust bundles for install-config.</p>
        </div>
      </div>

      <div className="step-body">
        {state.reviewFlags?.["trust-proxy"] && state.ui?.visitedSteps?.["trust-proxy"] ? (
          <Banner variant="warning">
            Version or upstream selections changed. Review this page to ensure settings are still valid.
            <div className="actions">
              <Button variant="secondary" onClick={() => updateState({ reviewFlags: { ...state.reviewFlags, "trust-proxy": false } })}>
                Re-evaluate this page
              </Button>
            </div>
          </Banner>
        ) : null}
        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Corporate Proxy</h3>
              <p className="card-subtitle">Optional HTTP(S) egress configuration.</p>
            </div>
          </div>
          <div className="card-body">
            <OptionRow
              title="Enable proxy"
              description="Use when egress must flow through a corporate proxy."
            >
              <Switch
                checked={Boolean(strategy.proxyEnabled)}
                onChange={(checked) => updateStrategy({ proxyEnabled: checked })}
                aria-label="Enable proxy"
              />
            </OptionRow>
          </div>
          {strategy.proxyEnabled ? (
            <div className="card-body" style={{ paddingTop: 0 }}>
              <div className="field-grid proxy-fields-grid">
                <div className="proxy-field-cell">
                  <FieldLabelWithInfo
                    label={<>HTTP Proxy {metaHttpProxy?.required ? <span className="required-badge">required</span> : "(optional)"}</>}
                    hint="URL for HTTP traffic. Scheme must be http://."
                  >
                    <textarea
                      className={`proxy-field-input proxy-field-textarea${proxyErrors.httpProxy ? " input-error" : ""}`}
                      value={proxies.httpProxy || ""}
                      onChange={(e) => updateProxy("httpProxy", e.target.value.replace(/\n/g, " ").trim())}
                      placeholder="http://proxy.corp:8080"
                      rows={2}
                      spellCheck={false}
                    />
                  </FieldLabelWithInfo>
                  {proxyErrors.httpProxy ? <div className="note warning">{proxyErrors.httpProxy}</div> : null}
                </div>
                <div className="proxy-field-cell">
                  <FieldLabelWithInfo
                    label={<>HTTPS Proxy {metaHttpsProxy?.required ? <span className="required-badge">required</span> : "(optional)"}</>}
                    hint="For httpsProxy, use the scheme your proxy actually supports. Many environments use http:// here even for HTTPS traffic."
                  >
                    <textarea
                      className={`proxy-field-input proxy-field-textarea${proxyErrors.httpsProxy ? " input-error" : ""}`}
                      value={proxies.httpsProxy || ""}
                      onChange={(e) => updateProxy("httpsProxy", e.target.value.replace(/\n/g, " ").trim())}
                      placeholder="https://proxy.corp:8443 or http:// if proxy only supports HTTP"
                      rows={2}
                      spellCheck={false}
                    />
                  </FieldLabelWithInfo>
                  {proxyErrors.httpsProxy ? <div className="note warning">{proxyErrors.httpsProxy}</div> : null}
                </div>
                <div className="proxy-field-cell">
                  <FieldLabelWithInfo
                    label={<>No Proxy {isRequired("proxy.noProxy") ? <span className="required-badge">required</span> : "(optional)"}</>}
                    hint="Comma-separated destinations to exclude from proxying. Use . for subdomains; * to bypass for all."
                  >
                    <textarea
                      className="proxy-field-input proxy-field-textarea"
                      value={proxies.noProxy || ""}
                      onChange={(e) => updateProxy("noProxy", e.target.value.replace(/\n/g, " ").trim())}
                      placeholder=".cluster.local,.svc,10.128.0.0/14,127.0.0.1"
                      rows={2}
                      spellCheck={false}
                    />
                  </FieldLabelWithInfo>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="card trust-and-certificates-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Trust and certificates</h3>
              <p className="card-subtitle">CA bundles for mirror registry and proxy. PEM only; no private keys.</p>
            </div>
          </div>
          <div className="card-body">
            <p className="note">
              Paste or upload PEM-encoded CA certificates (one or more <code>-----BEGIN CERTIFICATE-----</code> blocks) for <code>additionalTrustBundle</code> and policy.
            </p>

            <OptionRow
              title="Mirror registry uses a private or self-signed CA"
              description="When enabled, the mirror registry CA bundle below is required; progress is blocked until you add it."
            >
              <Switch
                checked={trust.mirrorRegistryUsesPrivateCa || false}
                onChange={(checked) => updateTrust({ mirrorRegistryUsesPrivateCa: checked })}
                aria-label="Mirror registry uses private CA"
              />
            </OptionRow>

            <div className="trust-sections">
              <div className={`trust-section ${trust.mirrorRegistryUsesPrivateCa && !trust.mirrorRegistryCaPem ? "trust-section-required-incomplete" : ""}`}>
                <h4 className="trust-section-title">
                  Mirror registry CA
                  {trust.mirrorRegistryUsesPrivateCa ? <span className="required-badge" style={{ marginLeft: 8 }}>required</span> : null}
                </h4>
                <p className="trust-section-desc">For a private or self-signed mirror registry. {trust.mirrorRegistryUsesPrivateCa ? "You must add the CA certificate(s) here for installs to succeed." : ""}</p>
                <PemField
                  label="Mirror registry CA bundle"
                  required={trust.mirrorRegistryUsesPrivateCa}
                  value={trust.mirrorRegistryCaPem || ""}
                  onChange={handleMirrorCaText}
                  onFiles={handleMirrorCaFiles}
                  error={mirrorCaError}
                  placeholder="Paste or drop .pem/.crt here"
                />
                {trust.mirrorRegistryUsesPrivateCa && !trust.mirrorRegistryCaPem ? (
                  <Banner variant="warning">Mirror registry CA bundle is required when using a private or self-signed CA. Progress to Assets &amp; Guide is blocked until you add the certificate(s) above.</Banner>
                ) : null}
              </div>

              <div className="trust-section">
                <h4 className="trust-section-title">Proxy CA</h4>
                <p className="trust-section-desc">For an HTTPS proxy that uses a custom or corporate CA.</p>
                <PemField
                  label="Proxy CA bundle"
                  required={isRequired("additionalTrustBundle")}
                  value={trust.proxyCaPem || ""}
                  onChange={handleProxyCaText}
                  onFiles={handleProxyCaFiles}
                  error={proxyCaError}
                  placeholder="Paste or drop .pem/.crt here"
                />
              </div>
            </div>

            <div className="trust-policy-row">
              <label className="trust-policy-label-row">
                <span className="trust-policy-label-block">
                  <span className="trust-policy-label">Trust bundle policy</span>
                  {isRequired("additionalTrustBundlePolicy") ? <span className="required-badge">required</span> : null}
                </span>
                <select
                  value={trust.additionalTrustBundlePolicy || (trustPolicyOptions.length ? policyDefault : "")}
                  onChange={(e) => updateTrust({ additionalTrustBundlePolicy: e.target.value })}
                  disabled={!trustPolicyOptions.length}
                  className="trust-policy-select"
                >
                  <optgroup label="Policy">
                    {trustPolicyOptions.length
                      ? trustPolicyOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))
                      : <option value="" disabled>Not available</option>}
                  </optgroup>
                </select>
              </label>
              {!trustPolicyOptions.length ? (
                <Banner variant="warning">Selected version is not supported for trust bundle policy.</Banner>
              ) : (
                <dl className="trust-policy-explanations">
                  <dt>Proxyonly</dt>
                  <dd>Use the CA bundle only when the cluster is using an HTTP/HTTPS proxy. Nodes will trust the bundle only for connections that go through the proxy. Choose this if you added a CA mainly for your corporate proxy.</dd>
                  <dt>Always</dt>
                  <dd>Apply the CA bundle to all nodes for all TLS connections. Use this when your mirror registry or other services use a custom or self-signed CA that every node must trust, whether or not you use a proxy.</dd>
                </dl>
              )}
            </div>

            <div className="trust-bundle-preview">
              <div className="trust-bundle-preview-header">
                <span className="trust-bundle-preview-title">Combined trust bundle (preview)</span>
                {totalCerts > 0 ? (
                  <span className="trust-bundle-preview-badge">
                    {totalCerts} certificate{totalCerts !== 1 ? "s" : ""}
                    {mirrorBlocks.length > 0 && proxyBlocks.length > 0
                      ? ` (mirror: ${mirrorBlocks.length}, proxy: ${proxyBlocks.length})`
                      : mirrorBlocks.length > 0
                        ? " (mirror)"
                        : " (proxy)"}
                  </span>
                ) : null}
              </div>
              {effectiveBundle ? (
                <pre className="preview trust-bundle-preview-content">{effectiveBundle}</pre>
              ) : (
                <div className="trust-bundle-preview-empty">No CA bundles added yet. Add mirror and/or proxy CA above.</div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
