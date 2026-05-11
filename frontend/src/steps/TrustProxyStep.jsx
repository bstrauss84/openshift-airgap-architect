/**
 * OpenShift Airgap Architect - Trust & Proxy Configuration Step
 *
 * Corporate proxy configuration (HTTP/HTTPS/NO_PROXY) and additional trust bundle
 * management (mirror registry CA, proxy CA certificates). Supports PEM upload/paste
 * with automatic trust bundle policy selection.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";
import { useApp } from "../store.jsx";
import { getScenarioId, getParamMeta, getRequiredParamsForOutput } from "../catalogResolver.js";
import { getTrustPolicyOptionsForScenario, withAutoTrustBundlePolicy, hasEffectiveTrustBundle } from "../shared/trustBundlePolicy.js";
import { getForwardOpenShiftMinorDocNotice } from "../shared/versionPolicy.js";
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

function PemField({ label, required, value, onChange, onFiles, error, placeholder, hint }) {
  if (hint) {
    // Use FieldLabelWithInfo when hint is provided
    return (
      <div className="trust-pem-field">
        <FieldLabelWithInfo label={label} required={required} hint={hint}>
          <div>
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
          </div>
        </FieldLabelWithInfo>
      </div>
    );
  }

  // Fallback to original implementation without hint
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
  const forwardDocNotice = getForwardOpenShiftMinorDocNotice(selectedVersion);
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
    if (proxies.httpProxy && !proxies.httpProxy.startsWith("http://") && !proxies.httpProxy.startsWith("https://")) {
      proxyErrors.httpProxy = "HTTP proxy must start with http:// or https://";
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

  // Build fingerprint-to-rawPem lookup from analysis.rawCertificates
  const rawPemByFingerprint = React.useMemo(() => {
    const map = new Map();
    const rawCerts = analysis?.rawCertificates || [];
    for (const cert of rawCerts) {
      if (cert.fingerprintSha256 && cert.rawPem) {
        map.set(cert.fingerprintSha256, cert.rawPem);
      }
    }
    return map;
  }, [analysis?.rawCertificates]);

  // Chain integrity validation: detect missing issuers in selected set
  const chainIntegrityIssues = React.useMemo(() => {
    if (trust.bundleSelectionMode !== "reduced" || !analysis?.graph) return [];
    const issues = [];
    const parentMap = analysis.graph.parentsByChild || {};
    const certMap = new Map(certs.map(c => [c.fingerprintSha256, c]));

    for (const fp of selectedFingerprints) {
      const cert = certMap.get(fp);
      if (!cert || cert.isSelfSigned) continue;

      const parents = parentMap[fp] || [];
      const selectedParents = parents.filter(pFp => selectedSet.has(pFp));

      if (parents.length > 0 && selectedParents.length === 0) {
        const parentCerts = parents.map(pFp => certMap.get(pFp)).filter(Boolean);
        issues.push({
          certFingerprint: fp,
          certSubject: cert.subject,
          missingIssuers: parentCerts.map(p => ({ fingerprint: p.fingerprintSha256, subject: p.subject }))
        });
      }
    }
    return issues;
  }, [trust.bundleSelectionMode, selectedFingerprints, analysis?.graph, certs, selectedSet]);

  // Filter for categorized view: always show all certs, only apply search filter
  const certsForCategories = certs.filter((cert) => {
    const haystack = [
      cert.subject || "",
      cert.issuer || "",
      cert.fingerprintSha256 || "",
      ...(cert.sanDns || [])
    ].join(" ").toLowerCase();
    return !certSearch.trim() || haystack.includes(certSearch.trim().toLowerCase());
  });

  // Legacy filter for non-categorized views (if needed)
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

  const toggleCategorySelection = (categoryId, checked) => {
    const categoryCerts = certs.filter(c => c.classification === categoryId);
    const next = new Set(selectedFingerprints || []);
    categoryCerts.forEach(cert => {
      if (checked) next.add(cert.fingerprintSha256);
      else next.delete(cert.fingerprintSha256);
    });
    pushReducedSelection(Array.from(next), {
      userModified: true,
      cautionAcknowledged: false
    });
  };

  const keepOnlyRequired = () => {
    const requiredCerts = certs.filter(c => c.classification === "likely_required");
    pushReducedSelection(requiredCerts.map(c => c.fingerprintSha256), {
      userModified: true,
      cautionAcknowledged: false
    });
  };

  const removeAllOptional = () => {
    const next = new Set(selectedFingerprints || []);
    const optionalCerts = certs.filter(c => c.classification === "likely_optional");
    optionalCerts.forEach(cert => next.delete(cert.fingerprintSha256));
    pushReducedSelection(Array.from(next), {
      userModified: true,
      cautionAcknowledged: false
    });
  };

  const smartTrim = () => {
    // Start with required, then add ambiguous until we hit 256KB caution threshold
    const requiredCerts = certs.filter(c => c.classification === "likely_required");
    const ambiguousCerts = certs.filter(c => c.classification === "kept_due_to_ambiguity");
    const selected = new Set(requiredCerts.map(c => c.fingerprintSha256));

    // Estimate size: each cert ~2KB average
    let estimatedSize = requiredCerts.length * 2048;
    const targetSize = 256 * 1024; // 256KB caution threshold

    for (const cert of ambiguousCerts) {
      if (estimatedSize >= targetSize) break;
      selected.add(cert.fingerprintSha256);
      estimatedSize += 2048;
    }

    pushReducedSelection(Array.from(selected), {
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
                    label={`HTTP Proxy ${metaHttpProxy?.required ? "" : "(optional)"}`}
                    hint={`URL endpoint for proxying HTTP traffic.

**What is this:**
The corporate proxy server that handles HTTP (port 80) egress

**Scheme requirement:**
Must start with http:// (even though it's proxying HTTP traffic)

**Format:**
http://hostname:port or http://ip:port

**Example:**
http://proxy.corp:8080`}
                    required={metaHttpProxy?.required}
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
                    label={`HTTPS Proxy ${metaHttpsProxy?.required ? "" : "(optional)"}`}
                    hint={`URL endpoint for proxying HTTPS traffic.

**Important:**
Use the **scheme your proxy actually supports**, NOT the traffic type

**Common pattern:**
Many corporate proxies use http:// even for HTTPS traffic

**Format:**
http://hostname:port OR https://hostname:port (match your proxy's capabilities)

**Example:**
http://proxy.corp:8443
https://proxy.corp:8443 (if your proxy supports TLS)`}
                    required={metaHttpsProxy?.required}
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
                    label={`No Proxy ${isRequired("proxy.noProxy") ? "" : "(optional)"}`}
                    hint={`Comma-separated destinations to bypass the proxy.

**What is this:**
Traffic to these destinations goes direct, NOT through your proxy

**Format:**
Comma-separated hostnames, IPs, CIDRs, or domain patterns

**Special patterns:**
• Start with . for subdomain matching (.cluster.local)
• Use * to bypass proxy for all traffic

**Typical entries:**
Internal cluster networks, service CIDRs, localhost

**Example:**
.cluster.local,.svc,10.128.0.0/14,127.0.0.1`}
                    required={isRequired("proxy.noProxy")}
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
            {forwardDocNotice ? (
              <Banner variant="warning" className="trust-version-doc-notice">{forwardDocNotice}</Banner>
            ) : null}
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
                  hint={`CA certificate(s) for authenticating to a private or self-signed mirror registry.

**What is this:**
The Certificate Authority (CA) certificate that signed your mirror registry's TLS certificate. This is required when your mirror registry uses a private CA or self-signed certificate instead of a publicly-trusted CA.

**When required:**
• **Private CA:** Your organization has its own internal CA
• **Self-signed:** Your mirror registry uses a self-signed certificate
• **Not needed:** Your mirror registry uses certificates from a public CA (like Let's Encrypt, DigiCert, etc.)

**Format:**
PEM-encoded X.509 certificate(s). Each certificate block starts with \`-----BEGIN CERTIFICATE-----\` and ends with \`-----END CERTIFICATE-----\`

**Multiple certificates:**
You can paste multiple certificate blocks in this field if your trust chain includes intermediate CAs. Include the entire chain from your mirror registry's CA up to (but not including) your registry's server certificate.

**How to provide:**
• **Paste:** Copy the PEM text directly into the field
• **Drag and drop:** Drop .pem or .crt files into the field
• **Upload:** Click to browse and select certificate files

**How it's used:**
This CA bundle is added to install-config.yaml as \`additionalTrustBundle\`. The installer distributes it to all cluster nodes so they trust TLS connections to your mirror registry during installation and operation.

**Trust bundle policy:**
When this field is populated, the trust bundle policy below automatically defaults to "Always" to ensure the certificate is trusted cluster-wide for registry pulls.

**Important:**
⚠️ Without the correct CA certificate, the installer and cluster nodes will reject TLS connections to your mirror registry, causing installation to fail.

**Example certificate:**
-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAKL0UG+mRKfzMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV
...
-----END CERTIFICATE-----`}
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
                  hint={`CA certificate(s) for authenticating to an HTTPS proxy with a custom or corporate CA.

**What is this:**
The Certificate Authority (CA) certificate that signed your HTTPS proxy's TLS certificate. This is needed when your proxy uses a certificate from a private/corporate CA rather than a publicly-trusted CA.

**When needed:**
• **Corporate proxy:** Your organization's proxy uses an internal CA
• **HTTPS inspection:** The proxy performs SSL/TLS inspection with a custom CA
• **HTTP proxy:** Not needed - only HTTPS proxies require CA certificates
• **Public CA proxy:** Not needed if your proxy uses publicly-trusted certificates

**Format:**
PEM-encoded X.509 certificate(s). Each certificate block starts with \`-----BEGIN CERTIFICATE-----\` and ends with \`-----END CERTIFICATE-----\`

**Multiple certificates:**
Include the full trust chain if your proxy's CA has intermediate certificates. Paste all certificates from your proxy's CA up to (but not including) the proxy's server certificate.

**How to provide:**
• **Paste:** Copy the PEM text directly into the field
• **Drag and drop:** Drop .pem or .crt files into the field
• **Upload:** Click to browse and select certificate files

**How it's used:**
This CA bundle is added to install-config.yaml as \`additionalTrustBundle\`. During installation and cluster operation, nodes trust this CA when making outbound connections through the HTTPS proxy.

**Trust bundle policy:**
When only Proxy CA is provided (no Mirror registry CA), the trust bundle policy below automatically defaults to "Proxyonly" - the CA is only used for proxy connections.

**Common scenarios:**
• **Corporate network:** Internal proxy at proxy.corp.local:3128 uses corporate CA
• **SSL inspection:** Security appliance decrypts/re-encrypts traffic with custom CA
• **Cloud environments:** Some cloud providers inject proxy CAs for egress inspection

**Example certificate:**
-----BEGIN CERTIFICATE-----
MIIDQTCCAimgAwIBAgITBmyfz5m/jAo54vB4ikPmljZbyjANBgkqhkiG9w0BAQsF
...
-----END CERTIFICATE-----`}
                />
              </div>
            </div>

            {showTrustBundlePolicyUi ? (
              <>
                <div className="trust-policy-row">
                  <FieldLabelWithInfo
                    label="Trust bundle policy"
                    required={isRequired("additionalTrustBundlePolicy")}
                    hint={`Controls how OpenShift distributes the additional trust bundle to cluster nodes.

**What is this:**
The \`additionalTrustBundlePolicy\` field in install-config.yaml determines how the CA certificates you provide above are made available to cluster nodes and workloads.

**Available policies:**

**Proxyonly:**
• The trust bundle is ONLY used for proxy connections
• Recommended when you have only Proxy CA (no Mirror registry CA)
• The bundle is injected into the proxy trust chain
• Registry pulls and other operations use the default system trust store

**Always:**
• The trust bundle is distributed to ALL cluster nodes
• Recommended when you have a Mirror registry CA
• The bundle is added to the system-wide trust store on all nodes
• Both proxy connections AND registry pulls can use these certificates
• Ensures mirror registry TLS connections succeed everywhere

**Automatic selection:**
This field is automatically set based on which CA certificates you provide:
• **Mirror registry CA present:** Defaults to "Always"
• **Only Proxy CA present:** Defaults to "Proxyonly"
• **Both present:** Defaults to "Always" (covers both use cases)

**When to change the default:**
Most users should keep the automatic default. Advanced use cases where you might override:
• You have a Mirror registry CA but want to limit trust distribution scope
• You have specific security requirements about where certificates are trusted

**Important:**
⚠️ If you have a Mirror registry CA and select "Proxyonly", registry pulls will fail because nodes won't trust your mirror registry's certificates.

**How it's used in install-config:**
\`\`\`yaml
additionalTrustBundle: |
  -----BEGIN CERTIFICATE-----
  ...your CA certificates...
  -----END CERTIFICATE-----
additionalTrustBundlePolicy: Always
\`\`\`

**Example decision tree:**
• Mirror registry with private CA → **Always**
• HTTPS proxy with corporate CA, no mirror → **Proxyonly**
• Both mirror registry and proxy with custom CAs → **Always**`}
                  >
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
                  </FieldLabelWithInfo>
                  {!trustPolicyOptions.length ? (
                    <Banner variant="warning">
                      Could not resolve trust bundle policy options for this OpenShift version (release is unknown or not supported here).
                    </Banner>
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
              </>
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
                    {/* Compact status bar showing ConfigMap limit compliance */}
                    <div className="trust-limit-status">
                      <div className="status-row">
                        <span className="status-label">Bundle Size:</span>
                        <span className="status-value">
                          {selectedSummary?.selectedBytes ? `${Math.round(selectedSummary.selectedBytes / 1024)}KB` : "—"}
                          {" / "}
                          <span className="status-max">650KB safe max</span>
                        </span>
                        <span className={`status-badge ${
                          selectedSummary?.thresholdBand === "hard_max_exceeded" ? "error" :
                          selectedSummary?.thresholdBand === "caution_exceeded" ? "warning" : "success"
                        }`}>
                          {selectedSummary?.thresholdBand === "hard_max_exceeded" ? "⚠️ Over limit" :
                           selectedSummary?.thresholdBand === "caution_exceeded" ? "⚠️ Close to limit" : "✓ Within limits"}
                        </span>
                      </div>
                      {selectedSummary?.selectedBytes && (
                        <div className="size-bar">
                          <div
                            className={`size-fill ${
                              selectedSummary.thresholdBand === "hard_max_exceeded" ? "error" :
                              selectedSummary.thresholdBand === "caution_exceeded" ? "warning" : "success"
                            }`}
                            style={{
                              width: `${Math.min(100, (selectedSummary.selectedBytes / (650 * 1024)) * 100)}%`
                            }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Simplified key metrics */}
                    <div className="trust-status-grid">
                      <div className="trust-metric">
                        <span className="metric-value">{analysis.inventory?.validCertificates ?? 0}</span>
                        <span className="metric-label">Valid Certificates</span>
                      </div>
                      <div className="trust-metric">
                        <span className="metric-value">{selectedSummary?.selectedBytes ? `${Math.round(selectedSummary.selectedBytes / 1024)}KB` : "—"}</span>
                        <span className="metric-label">Bundle Size</span>
                      </div>
                      <div className="trust-metric">
                        <span className={`metric-value ${analysis.risk?.band === "dangerous" ? "warning" : ""}`}>
                          {analysis.risk?.band || "unknown"}
                        </span>
                        <span className="metric-label">Risk Level</span>
                      </div>
                    </div>

                    {/* Technical details collapsed by default */}
                    <details className="trust-technical-details">
                      <summary>Technical Details</summary>
                      <div className="technical-details-content">
                        <p className="note">
                          Risk score: {analysis.risk?.score ?? "n/a"} | Confidence: <strong>{reducedConfidence}</strong>
                        </p>
                        <p className="note">
                          Malformed blocks: {analysis.inventory?.malformedBlocks ?? 0}, Duplicate noise: {analysis.inventory?.duplicateNoiseCount ?? 0}
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
                      </div>
                    </details>
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
                    {chainIntegrityIssues.length > 0 && trust.bundleSelectionMode === "reduced" ? (
                      <Banner variant="warning">
                        <div style={{ marginBottom: 8 }}>
                          <strong>⚠️ Chain integrity issues detected:</strong> {chainIntegrityIssues.length} certificate{chainIntegrityIssues.length !== 1 ? "s" : ""} missing required issuer CA{chainIntegrityIssues.length !== 1 ? "s" : ""}.
                        </div>
                        <details className="chain-integrity-details">
                          <summary style={{ cursor: "pointer", marginBottom: 8 }}>View missing issuers</summary>
                          <ul style={{ margin: "8px 0 0 0", padding: "0 0 0 20px" }}>
                            {chainIntegrityIssues.map((issue, idx) => (
                              <li key={idx} style={{ marginBottom: 8 }}>
                                <div style={{ fontWeight: 600, fontSize: "13px" }}>{issue.certSubject}</div>
                                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: 4 }}>
                                  Missing issuer{issue.missingIssuers.length !== 1 ? "s" : ""}: {issue.missingIssuers.map(issuer => issuer.subject).join(", ")}
                                </div>
                                <button
                                  type="button"
                                  className="button-link"
                                  style={{ fontSize: "12px", marginTop: 4 }}
                                  onClick={() => {
                                    const next = new Set(selectedFingerprints);
                                    issue.missingIssuers.forEach(issuer => next.add(issuer.fingerprint));
                                    pushReducedSelection(Array.from(next), { userModified: true, cautionAcknowledged: false });
                                  }}
                                >
                                  Add missing issuer{issue.missingIssuers.length !== 1 ? "s" : ""}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </Banner>
                    ) : null}
                    {trust.bundleSelectionMode === "reduced" && certs.length ? (
                      <div style={{ marginTop: 12 }}>
                        <h4 style={{ marginBottom: 8 }}>Reduced bundle manual cert review</h4>

                        {/* Quick Actions */}
                        <div className="trust-quick-actions">
                          <Button variant="secondary" onClick={keepOnlyRequired}>
                            Keep Only Required
                          </Button>
                          <Button variant="secondary" onClick={removeAllOptional}>
                            Remove All Optional
                          </Button>
                          <Button variant="secondary" onClick={smartTrim}>
                            Smart Trim to 256KB
                          </Button>
                        </div>

                        <div className="trust-cert-toolbar">
                          <input
                            className="proxy-field-input"
                            value={certSearch}
                            onChange={(e) => setCertSearch(e.target.value)}
                            placeholder="Search subject, issuer, SAN, fingerprint"
                          />
                          <span className={`badge ${classifyStatusTone(selectedSummary?.thresholdBand) || ""}`}>
                            Showing {certsForCategories.length} of {certs.length} certificates
                          </span>
                        </div>

                        {/* Categorized cert list */}
                        <div className="trust-cert-categories">
                          {(() => {
                            const categories = [
                              {
                                id: "likely_optional",
                                label: "Safe to Remove",
                                help: "Leaf/endpoint certs typically not needed for trust chains",
                                className: "safe-to-remove"
                              },
                              {
                                id: "likely_required",
                                label: "Likely Required",
                                help: "Root and intermediate CAs for your mirror/proxy",
                                className: "keep-recommended"
                              },
                              {
                                id: "kept_due_to_ambiguity",
                                label: "Unclear (Manual Review)",
                                help: "Classification ambiguous - review recommended",
                                className: "ambiguous"
                              },
                              {
                                id: "flagged_risky_or_problematic",
                                label: "Risky / Problematic",
                                help: "Flagged for potential issues",
                                className: "risky"
                              }
                            ];

                            return categories.map(category => {
                              const categoryCerts = certsForCategories.filter(c => c.classification === category.id);
                              if (!categoryCerts.length) return null;

                              const categorySelected = categoryCerts.filter(c => selectedSet.has(c.fingerprintSha256));
                              const allSelected = categoryCerts.length > 0 && categorySelected.length === categoryCerts.length;
                              const someSelected = categorySelected.length > 0 && categorySelected.length < categoryCerts.length;

                              // Estimate size: avg ~2KB per cert
                              const categorySize = Math.round((categoryCerts.length * 2048) / 1024);

                              return (
                                <section key={category.id} className={`cert-category ${category.className}`}>
                                  <div className="category-header">
                                    <label className="category-checkbox-label">
                                      <input
                                        type="checkbox"
                                        checked={allSelected}
                                        ref={el => el && (el.indeterminate = someSelected)}
                                        onChange={(e) => toggleCategorySelection(category.id, e.target.checked)}
                                        title="Select/deselect all certificates in this category"
                                      />
                                      <span className="category-title-line">
                                        <span className="category-title">{category.label}</span>
                                        <span className="category-count">({categoryCerts.length} certs, ~{categorySize}KB)</span>
                                      </span>
                                    </label>
                                    <span className="category-help">{category.help}</span>
                                  </div>
                                  {categoryCerts.length > 0 ? (
                                    <div className="category-cert-list">
                                      {categoryCerts.map((cert) => {
                                        const selected = selectedSet.has(cert.fingerprintSha256);
                                        return (
                                          <div key={cert.fingerprintSha256} className="cert-card">
                                            <div className="cert-card-header">
                                              <label className="cert-checkbox-label">
                                                <input
                                                  type="checkbox"
                                                  checked={selected}
                                                  onChange={(e) => toggleCertSelection(cert.fingerprintSha256, e.target.checked)}
                                                />
                                                <div className="cert-main-info">
                                                  <div className="cert-subject">{cert.subject || cert.fingerprintSha256}</div>
                                                  <div className="cert-meta">
                                                    <span className={`cert-type-badge ${cert.isCa ? "ca-badge" : "leaf-badge"}`}>
                                                      {cert.isCa ? "CA Certificate" : "Leaf/Endpoint"}
                                                    </span>
                                                    <span className="cert-key-info">
                                                      {cert.keyType}{cert.keySize ? ` ${cert.keySize}-bit` : ""}
                                                    </span>
                                                    {cert.mirrorRelated && <span className="cert-context-badge mirror">Mirror</span>}
                                                    {cert.proxyRelated && <span className="cert-context-badge proxy">Proxy</span>}
                                                  </div>
                                                </div>
                                              </label>
                                            </div>
                                            <details className="cert-details">
                                              <summary className="cert-details-toggle">Technical details</summary>
                                              <div className="cert-details-content">
                                                <dl className="cert-properties">
                                                  <dt>Issuer</dt>
                                                  <dd>{cert.issuer || "Self-signed or unknown"}</dd>

                                                  <dt>Fingerprint (SHA-256)</dt>
                                                  <dd><code className="cert-fingerprint">{cert.fingerprintSha256}</code></dd>

                                                  {(cert.sanDns || []).length > 0 && (
                                                    <>
                                                      <dt>Subject Alternative Names</dt>
                                                      <dd>
                                                        <ul className="cert-san-list">
                                                          {cert.sanDns.slice(0, 5).map((san, i) => (
                                                            <li key={i}><code>{san}</code></li>
                                                          ))}
                                                          {cert.sanDns.length > 5 && (
                                                            <li className="cert-san-more">+ {cert.sanDns.length - 5} more</li>
                                                          )}
                                                        </ul>
                                                      </dd>
                                                    </>
                                                  )}

                                                  {(cert.reasonCodes || []).length > 0 && (
                                                    <>
                                                      <dt>Classification Reasons</dt>
                                                      <dd>
                                                        <ul className="cert-reasons-list">
                                                          {cert.reasonCodes.map((r, i) => (
                                                            <li key={i}>{summarizeReason(r)}</li>
                                                          ))}
                                                        </ul>
                                                      </dd>
                                                    </>
                                                  )}
                                                </dl>
                                              </div>
                                            </details>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <div className="note">No certificates in this category match your search.</div>
                                  )}
                                </section>
                              );
                            });
                          })()}
                        </div>

                        {/* Live selection preview with progress bar */}
                        <div className="trust-selection-preview">
                          <div className="preview-stats-row">
                            <div className="preview-stat">
                              <span className="stat-label">Selected:</span>
                              <span className="stat-value">{selectedFingerprints.length} certs</span>
                            </div>
                            <div className="preview-stat">
                              <span className="stat-label">Size:</span>
                              <span className="stat-value">
                                {selectedSummary?.selectedBytes ? `${Math.round(selectedSummary.selectedBytes / 1024)}KB` : "—"}
                                {" / "}
                                {Math.round((650 * 1024) / 1024)}KB
                              </span>
                            </div>
                          </div>
                          <div className="size-bar">
                            <div
                              className={`size-fill ${
                                hardMaxExceeded ? "error" :
                                cautionExceeded ? "warning" : "success"
                              }`}
                              style={{
                                width: selectedSummary?.selectedBytes
                                  ? `${Math.min(100, (selectedSummary.selectedBytes / (650 * 1024)) * 100)}%`
                                  : "0%"
                              }}
                            />
                          </div>
                          {hardMaxExceeded && selectedSummary?.selectedBytes ? (
                            <div className="preview-warning error">
                              ⚠️ Over limit! Remove {Math.ceil((selectedSummary.selectedBytes - (650 * 1024)) / 1024)}KB more to proceed.
                            </div>
                          ) : cautionExceeded ? (
                            <div className="preview-warning warning">
                              ⚠️ Approaching limit. Consider removing additional certificates.
                            </div>
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
                <span className="trust-bundle-preview-title">
                  {trust.bundleSelectionMode === "reduced" ? "Bundle Preview" : "Bundle Input (preview)"}
                </span>
                {trust.bundleSelectionMode === "reduced" ? (
                  <span className="trust-bundle-preview-badge">
                    {selectedFingerprints.length} certificate{selectedFingerprints.length !== 1 ? "s" : ""}
                  </span>
                ) : totalCerts > 0 ? (
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
              {(() => {
                if (trust.bundleSelectionMode === "reduced" && selectedFingerprints.length > 0) {
                  const selectedPemBlocks = selectedFingerprints
                    .map(fp => rawPemByFingerprint.get(fp))
                    .filter(Boolean);
                  if (selectedPemBlocks.length === 0) {
                    return <div className="trust-bundle-preview-empty">No certificates selected. Select at least one certificate above.</div>;
                  }
                  const selectedBundle = selectedPemBlocks.join("\n");
                  return <pre className="preview trust-bundle-preview-content">{selectedBundle}</pre>;
                }
                if (effectiveBundle) {
                  return <pre className="preview trust-bundle-preview-content">{effectiveBundle}</pre>;
                }
                return <div className="trust-bundle-preview-empty">No CA bundles added yet. Add mirror and/or proxy CA above.</div>;
              })()}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
