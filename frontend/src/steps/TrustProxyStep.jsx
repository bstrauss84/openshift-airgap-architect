/**
 * Trust & Proxy replacement step (segmented flow). Proxy (http/https/noProxy), additional trust bundle policy,
 * mirror registry CA and proxy CA PEMs. State: globalStrategy.proxies, globalStrategy.proxyEnabled, trust.*.
 * Enable proxy = blue toggle; trust grouped with clear labels; red only on cards with actual errors.
 */
import React from "react";
import { useApp } from "../store.jsx";
import { getScenarioId, getParamMeta, getRequiredParamsForOutput } from "../catalogResolver.js";
import { getTrustPolicyOptionsForScenario, withAutoTrustBundlePolicy, hasEffectiveTrustBundle } from "../shared/trustBundlePolicy.js";
import { apiFetch } from "../api.js";
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

const DEFAULT_ANALYSIS_TRIGGER = {
  explicitAnalyzeBytesThreshold: 128 * 1024,
  explicitAnalyzeCertsThreshold: 40,
  debounceMs: 1000
};

const CERT_FILTERS = [
  { id: "all", label: "All" },
  { id: "selected", label: "Selected" },
  { id: "excluded", label: "Excluded" },
  { id: "likely_required", label: "Likely required" },
  { id: "likely_optional", label: "Likely optional" },
  { id: "kept_due_to_ambiguity", label: "Ambiguous" },
  { id: "flagged_risky_or_problematic", label: "Risky/problematic" },
  { id: "mirror_related", label: "Mirror-related" },
  { id: "proxy_related", label: "Proxy-related" }
];

const classifyStatusTone = (band) => {
  if (band === "hard_max_exceeded") return "warning";
  if (band === "caution_exceeded") return "warning";
  return "";
};

const summarizeReason = (code) => {
  switch (code) {
    case "root_anchor_candidate":
      return "Selected as likely root anchor";
    case "intermediate_candidate":
      return "Selected as likely intermediate";
    case "issuer_chain_parent":
      return "Selected as likely issuer-chain parent";
    case "endpoint_linked":
      return "Endpoint-linked signal found";
    case "excluded_leaf_default":
      return "Excluded as likely leaf/server cert";
    default:
      return code.replaceAll("_", " ");
  }
};

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
  const mirroring = strategy.mirroring || {};
  const proxies = strategy.proxies || {};
  const trust = state.trust || {};
  const selectedVersion = state.release?.patchVersion || state.version?.selectedVersion || "";
  const [proxyCaError, setProxyCaError] = React.useState("");
  const [mirrorCaError, setMirrorCaError] = React.useState("");
  const [analysis, setAnalysis] = React.useState(null);
  const [analysisError, setAnalysisError] = React.useState("");
  const [analysisLoading, setAnalysisLoading] = React.useState(false);
  const [triggerDefaults, setTriggerDefaults] = React.useState(DEFAULT_ANALYSIS_TRIGGER);
  const [selectionInvalidated, setSelectionInvalidated] = React.useState(false);
  const [certSearch, setCertSearch] = React.useState("");
  const [certFilter, setCertFilter] = React.useState("selected");
  const previousInvalidationKeyRef = React.useRef(null);

  const updateStrategy = (patch) => updateState({ globalStrategy: { ...strategy, ...patch } });
  const updateProxy = (field, value) =>
    updateStrategy({ proxies: { ...proxies, [field]: value } });
  const updateTrust = (patch) => {
    let nextTrust = { ...trust, ...patch };
    const touchesPem = Object.prototype.hasOwnProperty.call(patch, "mirrorRegistryCaPem")
      || Object.prototype.hasOwnProperty.call(patch, "proxyCaPem");
    if (touchesPem && nextTrust.bundleSelectionMode === "reduced") {
      nextTrust.bundleSelectionMode = "original";
      nextTrust.reducedSelection = null;
      setSelectionInvalidated(true);
    }
    if (touchesPem) {
      nextTrust = withAutoTrustBundlePolicy(nextTrust, strategy, scenarioId, selectedVersion, trust);
    }
    updateState({ trust: nextTrust });
  };

  const requiredPaths = getRequiredParamsForOutput(scenarioId, INSTALL_CONFIG) || [];
  const isRequired = (path) => requiredPaths.includes(path);

  const metaHttpProxy = getParamMeta(scenarioId, "proxy.httpProxy", INSTALL_CONFIG);
  const metaHttpsProxy = getParamMeta(scenarioId, "proxy.httpsProxy", INSTALL_CONFIG);
  const metaNoProxy = getParamMeta(scenarioId, "proxy.noProxy", INSTALL_CONFIG);
  const metaPolicy = getParamMeta(scenarioId, "additionalTrustBundlePolicy", INSTALL_CONFIG);

  const trustPolicyOptions = getTrustPolicyOptionsForScenario(scenarioId, selectedVersion);
  const policyDefault = metaPolicy?.default || "Proxyonly";

  const mirrorBlocks = trustBundleBlocks(trust.mirrorRegistryCaPem);
  const proxyBlocks = trustBundleBlocks(trust.proxyCaPem);
  const effectiveBundle = Array.from(new Set([...mirrorBlocks, ...proxyBlocks])).join("\n");
  const totalCerts = mirrorBlocks.length + proxyBlocks.length;
  const showTrustBundlePolicyUi = hasEffectiveTrustBundle(trust);
  const bundleBytes = new TextEncoder().encode(effectiveBundle || "").length;
  const needsExplicitAnalyze = bundleBytes >= (triggerDefaults.explicitAnalyzeBytesThreshold || DEFAULT_ANALYSIS_TRIGGER.explicitAnalyzeBytesThreshold)
    || totalCerts >= (triggerDefaults.explicitAnalyzeCertsThreshold || DEFAULT_ANALYSIS_TRIGGER.explicitAnalyzeCertsThreshold);

  const runTrustAnalysis = React.useCallback(async () => {
    if (!effectiveBundle.trim()) {
      setAnalysis(null);
      setAnalysisError("");
      return;
    }
    setAnalysisLoading(true);
    setAnalysisError("");
    try {
      const response = await apiFetch("/api/trust/analyze", {
        method: "POST",
        body: JSON.stringify({ state })
      });
      setAnalysis(response.analysis || null);
      if (response.triggerDefaults) setTriggerDefaults(response.triggerDefaults);
      const nextSummary = response.analysis?.currentSelectionSummary || null;
      const currentSummary = trust.reducedSelection?.selectionSummary || null;
      if (
        trust.bundleSelectionMode === "reduced"
        && trust.reducedSelection
        && nextSummary
        && JSON.stringify(nextSummary) !== JSON.stringify(currentSummary)
      ) {
        updateState({
          trust: {
            ...trust,
            reducedSelection: {
              ...trust.reducedSelection,
              selectionSummary: nextSummary
            }
          }
        });
      }
    } catch (error) {
      setAnalysisError(String(error?.message || error));
    } finally {
      setAnalysisLoading(false);
    }
  }, [effectiveBundle, state, trust, updateState]);

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

  const trustPolicySyncRef = React.useRef(null);
  React.useEffect(() => {
    const prev = trustPolicySyncRef.current;
    const nextTrust = withAutoTrustBundlePolicy(trust, strategy, scenarioId, selectedVersion, prev ?? undefined);
    const prevPolicy = trust.additionalTrustBundlePolicy || "";
    const nextPolicy = nextTrust.additionalTrustBundlePolicy || "";
    if (nextPolicy !== prevPolicy) {
      updateState({ trust: nextTrust });
    }
    trustPolicySyncRef.current = nextTrust;
  }, [effectiveBundle, selectedVersion, strategy.proxyEnabled, scenarioId, trust.additionalTrustBundlePolicy]);

  React.useEffect(() => {
    const invalidationKey = JSON.stringify({
      mirrorPem: trust.mirrorRegistryCaPem || "",
      proxyPem: trust.proxyCaPem || "",
      httpProxy: proxies.httpProxy || "",
      httpsProxy: proxies.httpsProxy || "",
      registryFqdn: mirroring.registryFqdn || "",
      mirrorTargets: (mirroring.sources || []).flatMap((row) => row?.mirrors || []),
      fips: Boolean(strategy.fips)
    });
    if (previousInvalidationKeyRef.current == null) {
      previousInvalidationKeyRef.current = invalidationKey;
      return;
    }
    if (previousInvalidationKeyRef.current !== invalidationKey && trust.bundleSelectionMode === "reduced") {
      updateState({
        trust: {
          ...trust,
          bundleSelectionMode: "original",
          reducedSelection: null
        }
      });
      setSelectionInvalidated(true);
    }
    previousInvalidationKeyRef.current = invalidationKey;
  }, [
    trust.mirrorRegistryCaPem,
    trust.proxyCaPem,
    trust.bundleSelectionMode,
    proxies.httpProxy,
    proxies.httpsProxy,
    mirroring.registryFqdn,
    JSON.stringify((mirroring.sources || []).flatMap((row) => row?.mirrors || [])),
    strategy.fips
  ]);

  React.useEffect(() => {
    if (!effectiveBundle.trim()) return;
    if (needsExplicitAnalyze) return;
    const timeout = setTimeout(() => {
      runTrustAnalysis().catch(() => {});
    }, triggerDefaults.debounceMs || DEFAULT_ANALYSIS_TRIGGER.debounceMs);
    return () => clearTimeout(timeout);
  }, [effectiveBundle, needsExplicitAnalyze, runTrustAnalysis, triggerDefaults.debounceMs]);

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
  const reducedAvailable = Boolean(analysis?.proposal?.available);
  const reducedConfidence = analysis?.proposal?.confidence || "unable_to_classify";
  const analysisHash = analysis?.analysisHash || "";
  const reducedSelection = trust.reducedSelection || null;
  const selectedFingerprints = trust.bundleSelectionMode === "reduced"
    ? (reducedSelection?.selectedCertFingerprints || [])
    : (analysis?.proposal?.selectedCertFingerprints || []);
  const certs = analysis?.certs || [];
  const selectedSet = new Set(selectedFingerprints);
  const selectedSummary = analysis?.currentSelectionSummary || reducedSelection?.selectionSummary || null;
  const hardMaxExceeded = selectedSummary?.thresholdBand === "hard_max_exceeded";
  const cautionExceeded = selectedSummary?.thresholdBand === "caution_exceeded";
  const cautionAcknowledged = Boolean(reducedSelection?.cautionAcknowledged);
  const userModified = Boolean(reducedSelection?.userModified);

  const filteredCerts = certs.filter((cert) => {
    const haystack = [
      cert.subject || "",
      cert.issuer || "",
      cert.fingerprintSha256 || "",
      ...(cert.sanDns || [])
    ].join(" ").toLowerCase();
    const searchMatch = !certSearch.trim() || haystack.includes(certSearch.trim().toLowerCase());
    if (!searchMatch) return false;
    const selected = selectedSet.has(cert.fingerprintSha256);
    if (certFilter === "all") return true;
    if (certFilter === "selected") return selected;
    if (certFilter === "excluded") return !selected;
    if (certFilter === "mirror_related") return cert.mirrorRelated;
    if (certFilter === "proxy_related") return cert.proxyRelated;
    return cert.classification === certFilter;
  });

  const pushReducedSelection = (nextFingerprints, options = {}) => {
    const sorted = Array.from(new Set(nextFingerprints || [])).sort();
    updateState({
      trust: {
        ...trust,
        bundleSelectionMode: "reduced",
        reducedSelection: {
          analysisHash: analysisHash,
          selectedCertFingerprints: sorted,
          baseProposalFingerprints: analysis?.proposal?.selectedCertFingerprints || [],
          userModified: Boolean(options.userModified),
          cautionAcknowledged: Boolean(options.cautionAcknowledged),
          selectionSummary: analysis?.currentSelectionSummary || null
        }
      }
    });
    setSelectionInvalidated(false);
  };

  const selectReducedProposal = () => {
    if (!analysis?.proposal?.available) return;
    pushReducedSelection(analysis.proposal.selectedCertFingerprints || [], {
      userModified: false,
      cautionAcknowledged: false
    });
  };

  const selectOriginalBundle = () => {
    updateState({
      trust: {
        ...trust,
        bundleSelectionMode: "original",
        reducedSelection: null
      }
    });
  };

  const toggleCertSelection = (fingerprint, checked) => {
    const next = new Set(selectedFingerprints || []);
    if (checked) next.add(fingerprint);
    else next.delete(fingerprint);
    pushReducedSelection(Array.from(next), {
      userModified: true,
      cautionAcknowledged: false
    });
  };

  const resetToProposal = () => {
    if (!analysis?.proposal?.available) return;
    pushReducedSelection(analysis.proposal.selectedCertFingerprints || [], {
      userModified: false,
      cautionAcknowledged: false
    });
  };

  React.useEffect(() => {
    if (trust.bundleSelectionMode !== "reduced") return;
    if (!analysis) return;
    const timeout = setTimeout(() => {
      runTrustAnalysis().catch(() => {});
    }, 250);
    return () => clearTimeout(timeout);
  }, [trust.bundleSelectionMode, JSON.stringify(selectedFingerprints), analysisHash]);

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
              Paste or upload PEM-encoded CA certificates (one or more <code>-----BEGIN CERTIFICATE-----</code> blocks). Valid certificates are merged into install-config{" "}
              <code>additionalTrustBundle</code> when you export or preview YAML.
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

            {showTrustBundlePolicyUi ? (
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
                    <dd>
                      Maps to install-config <code>additionalTrustBundlePolicy: Proxyonly</code>. OpenShift applies the bundle in the proxy trust path when an HTTP/HTTPS proxy is configured—typical default when only a Proxy CA is present.
                    </dd>
                    <dt>Always</dt>
                    <dd>
                      Maps to <code>additionalTrustBundlePolicy: Always</code>. The installer distributes the bundle for broad node trust—recommended when a Mirror registry CA is included so pulls and registry TLS succeed everywhere.
                    </dd>
                  </dl>
                )}
              </div>
            ) : (
              <p className="note subtle">
                <code>additionalTrustBundlePolicy</code> is only used together with <code>additionalTrustBundle</code> (OpenShift 4.20). Add at least one valid certificate above to choose{" "}
                <strong>Proxyonly</strong> or <strong>Always</strong>; defaults favor <strong>Always</strong> when a mirror registry CA is present and <strong>Proxyonly</strong> when only a proxy CA is present.
              </p>
            )}

            {selectionInvalidated ? (
              <Banner variant="warning">
                Reduced trust selection was invalidated due to trust/proxy input changes. Re-run analysis and explicitly reselect reduced mode if desired.
                <div className="actions">
                  <Button variant="secondary" onClick={() => setSelectionInvalidated(false)}>
                    Dismiss
                  </Button>
                </div>
              </Banner>
            ) : null}

            <div className="trust-analysis card" style={{ marginTop: 12 }}>
              <div className="card-header">
                <div>
                  <h4 className="card-title">Trust analysis</h4>
                  <p className="card-subtitle">Warn-only analysis with explicit reduced-bundle opt-in.</p>
                </div>
                <div className="actions">
                  <Button
                    variant="secondary"
                    onClick={() => runTrustAnalysis().catch(() => {})}
                    disabled={analysisLoading || !effectiveBundle.trim()}
                  >
                    {analysisLoading ? "Analyzing..." : "Analyze trust bundle"}
                  </Button>
                </div>
              </div>
              <div className="card-body">
                {needsExplicitAnalyze ? (
                  <p className="note">
                    Large bundle detected. Explicit analysis mode is enabled to avoid expensive background parsing.
                  </p>
                ) : null}
                {analysisError ? <Banner variant="error">Trust analysis failed: {analysisError}</Banner> : null}
                {!analysis && !analysisLoading ? (
                  <div className="note">Run analysis to view risk, confidence, and reduced-bundle eligibility.</div>
                ) : null}
                {analysis ? (
                  <div className="trust-analysis-results">
                    <p className="note">
                      Risk band: <strong>{analysis.risk?.band || "unknown"}</strong> (score {analysis.risk?.score ?? "n/a"}) | Confidence: <strong>{reducedConfidence}</strong>
                    </p>
                    <p className="note">
                      Valid certs: {analysis.inventory?.validCertificates ?? 0}, malformed: {analysis.inventory?.malformedBlocks ?? 0}, duplicate noise: {analysis.inventory?.duplicateNoiseCount ?? 0}
                    </p>
                    <p className="note">Analysis hash: <code>{analysisHash || "n/a"}</code></p>
                    <p className="note">
                      FIPS findings: {(analysis.fips?.findings || []).length} total (
                      cryptographic weakness: {(analysis.fips?.findings || []).filter((f) => f.category === "cryptographic_weakness").length},
                      hygiene/validity: {(analysis.fips?.findings || []).filter((f) => f.category === "certificate_hygiene_validity").length},
                      chain/issuer misuse: {(analysis.fips?.findings || []).filter((f) => f.category === "chain_or_issuer_misuse").length},
                      unknown/ambiguous: {(analysis.fips?.findings || []).filter((f) => f.category === "unknown_or_ambiguous").length}
                      )
                    </p>
                    {reducedAvailable ? (
                      <div className="actions" style={{ gap: 8, flexWrap: "wrap" }}>
                        <Button
                          variant={trust.bundleSelectionMode === "reduced" ? "primary" : "secondary"}
                          onClick={selectReducedProposal}
                        >
                          Use reduced proposal ({analysis.proposal?.selectedCertFingerprints?.length || 0} certs)
                        </Button>
                        <Button
                          variant={trust.bundleSelectionMode !== "reduced" ? "primary" : "secondary"}
                          onClick={selectOriginalBundle}
                        >
                          Use original bundle
                        </Button>
                        {trust.bundleSelectionMode === "reduced" ? (
                          <Button variant="secondary" onClick={resetToProposal}>
                            Reset to backend proposal
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <Banner variant="warning">
                        Reduced proposal is unavailable for these inputs ({reducedConfidence}). Keep original bundle and resolve warnings.
                      </Banner>
                    )}
                    {trust.bundleSelectionMode === "reduced" ? (
                      <div className="note" style={{ marginTop: 10 }}>
                        Reduced mode: {userModified ? "Reduced + manual overrides" : "Backend proposal only"}.
                      </div>
                    ) : null}
                    {selectedSummary ? (
                      <div className="note" style={{ marginTop: 10 }}>
                        Selected set: {selectedSummary.selectedCertCount} certs, {selectedSummary.selectedBytes} bytes, {selectedSummary.selectedLineCount} lines. Status: <strong>{selectedSummary.thresholdBand}</strong>.
                        <br />
                        Mirror trust path: <strong>{selectedSummary.sufficiency?.mirrorPath?.status || "unknown"}</strong> ({selectedSummary.sufficiency?.mirrorPath?.confidence || "unknown"}). Proxy trust path: <strong>{selectedSummary.sufficiency?.proxyPath?.status || "unknown"}</strong> ({selectedSummary.sufficiency?.proxyPath?.confidence || "unknown"}).
                      </div>
                    ) : null}
                    {cautionExceeded && trust.bundleSelectionMode === "reduced" ? (
                      <Banner variant="warning">
                        Selected reduced bundle exceeds caution thresholds. Review and trim if possible.
                        <label style={{ display: "block", marginTop: 8 }}>
                          <input
                            type="checkbox"
                            checked={cautionAcknowledged}
                            onChange={(e) => {
                              pushReducedSelection(selectedFingerprints, {
                                userModified,
                                cautionAcknowledged: e.target.checked
                              });
                            }}
                          />
                          <span style={{ marginLeft: 8 }}>I acknowledge this caution and want to proceed with reduced mode.</span>
                        </label>
                      </Banner>
                    ) : null}
                    {hardMaxExceeded && trust.bundleSelectionMode === "reduced" ? (
                      <Banner variant="error">
                        Selected reduced bundle exceeds hard maximum thresholds and cannot be exported in reduced mode. Deselect certificates or switch back to original bundle mode.
                      </Banner>
                    ) : null}
                    {trust.bundleSelectionMode === "reduced" && certs.length ? (
                      <div style={{ marginTop: 12 }}>
                        <h4 style={{ marginBottom: 8 }}>Reduced bundle manual cert review</h4>
                        <div className="trust-cert-toolbar">
                          <input
                            className="proxy-field-input"
                            value={certSearch}
                            onChange={(e) => setCertSearch(e.target.value)}
                            placeholder="Search subject, issuer, SAN, fingerprint"
                          />
                          <select
                            className="trust-policy-select"
                            value={certFilter}
                            onChange={(e) => setCertFilter(e.target.value)}
                          >
                            {CERT_FILTERS.map((f) => (
                              <option key={f.id} value={f.id}>{f.label}</option>
                            ))}
                          </select>
                          <span className={`badge ${classifyStatusTone(selectedSummary?.thresholdBand) || ""}`}>
                            Showing {filteredCerts.length} of {certs.length}
                          </span>
                        </div>
                        <div className="trust-cert-list">
                          {filteredCerts.map((cert) => {
                            const selected = selectedSet.has(cert.fingerprintSha256);
                            return (
                              <details key={cert.fingerprintSha256} className="trust-cert-row">
                                <summary>
                                  <label className="trust-cert-summary">
                                    <input
                                      type="checkbox"
                                      checked={selected}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        toggleCertSelection(cert.fingerprintSha256, e.target.checked);
                                      }}
                                    />
                                    <span className="trust-cert-primary">
                                      {cert.subject || cert.fingerprintSha256}
                                    </span>
                                    <span className="trust-cert-pill">{cert.classification}</span>
                                  </label>
                                </summary>
                                <div className="note" style={{ marginTop: 8 }}>
                                  Issuer: {cert.issuer || "n/a"}
                                  <br />
                                  Fingerprint: <code>{cert.fingerprintSha256}</code>
                                  <br />
                                  Type: {cert.isCa ? "CA" : "Leaf/unknown"}; key: {cert.keyType}{cert.keySize ? `/${cert.keySize}` : ""}
                                  <br />
                                  Reasons: {(cert.reasonCodes || []).length ? cert.reasonCodes.map((r) => summarizeReason(r)).join(", ") : "None"}
                                </div>
                              </details>
                            );
                          })}
                          {!filteredCerts.length ? (
                            <div className="note">No certificates match this filter/search.</div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="trust-bundle-preview">
              <div className="trust-bundle-preview-header">
                <span className="trust-bundle-preview-title">Combined trust bundle input (preview)</span>
                <span className="note" style={{ marginLeft: 8 }}>
                  This preview shows raw mirror/proxy input PEMs. Reduced/manual output is enforced during generation/export.
                </span>
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
