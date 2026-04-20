import React from "react";
import { useApp } from "../store.jsx";
import { getTrustPolicyOptionsForScenario, withAutoTrustBundlePolicy, hasEffectiveTrustBundle } from "../shared/trustBundlePolicy.js";
import { getTrustBundlePolicySupport } from "../shared/versionPolicy.js";
import { getScenarioId } from "../catalogResolver.js";
import { apiFetch } from "../api.js";
import { isValidPullSecret, isValidSshPublicKey, ipv6CidrOverlaps } from "../validation.js";
import { formatIpv4Cidr, formatIpv6Cidr } from "../formatUtils.js";
import SecretInput from "../components/SecretInput.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";

const GlobalStrategyStep = ({ previewControls, previewEnabled, highlightErrors, fieldErrors = {} }) => {
  const { state, updateState } = useApp();
  const strategy = state.globalStrategy || {};
  const mirroring = {
    registryFqdn: "",
    sources: [],
    ...(strategy.mirroring || {})
  };
  const networking = strategy.networking || {};
  const platformConfig = state.platformConfig || {};
  const platform = state.blueprint?.platform;
  const method = state.methodology?.method;
  const showPublishCreds = (platform === "AWS GovCloud" || platform === "Azure Government") && method === "IPI";
  const versionConfirmed = state.version?.versionConfirmed ?? state.release?.confirmed;
  const arch = state.blueprint?.arch;
  const allowedConnectivity = ["fully-disconnected", "jumpbox"];
  const connectivity = allowedConnectivity.includes(state.docs?.connectivity)
    ? state.docs?.connectivity
    : "fully-disconnected";
  const proxyRequired = connectivity === "jumpbox";
  const trust = state.trust || {};
  const [trustErrors, setTrustErrors] = React.useState({ mirror: "", proxy: "" });
  const [awsRegions, setAwsRegions] = React.useState([]);
  const [amiLookup, setAmiLookup] = React.useState({ loading: false, error: "", key: "" });
  const [showKeygen, setShowKeygen] = React.useState(false);
  const [keygenLoading, setKeygenLoading] = React.useState(false);
  const [keygenError, setKeygenError] = React.useState("");
  const [keypair, setKeypair] = React.useState(null);
  const [useGeneratedKey, setUseGeneratedKey] = React.useState(false);
  const [keygenAlgorithm, setKeygenAlgorithm] = React.useState("ed25519");
  const [showPrivateKey, setShowPrivateKey] = React.useState(false);
  const [showMirrorSecretHelper, setShowMirrorSecretHelper] = React.useState(false);
  const [showAwsHelp, setShowAwsHelp] = React.useState(false);
  const [mirrorSecretBackup, setMirrorSecretBackup] = React.useState("");
  const [awsHelp, setAwsHelp] = React.useState({
    privateCluster: false,
    splitExposure: false,
    noAdminCreds: false,
    mustUseExistingCreds: false
  });
  const [mirrorHelper, setMirrorHelper] = React.useState({
    registry: mirroring.registryFqdn || "",
    username: "",
    password: "",
    email: ""
  });

  React.useEffect(() => {
    if (!allowedConnectivity.includes(state.docs?.connectivity || "")) {
      updateState({ docs: { ...state.docs, connectivity: "fully-disconnected" } });
    }
  }, []);

  React.useEffect(() => {
    if (!showPublishCreds && showAwsHelp) {
      setShowAwsHelp(false);
    }
  }, [showPublishCreds, showAwsHelp]);

  // vSphere: Internal publish not supported (BZ#1953035). Normalize to External when platform is vSphere.
  React.useEffect(() => {
    if (platform === "VMware vSphere" && (method === "IPI" || method === "UPI") && platformConfig.publish === "Internal") {
      updatePlatformConfig({ publish: "External" });
    }
  }, [platform, method, platformConfig.publish]);

  const proxyErrors = {};
  if (strategy.proxyEnabled) {
    if (strategy.proxies?.httpProxy && !strategy.proxies.httpProxy.startsWith("http://")) {
      proxyErrors.httpProxy = "HTTP proxy must start with http://";
    }
    if (strategy.proxies?.httpsProxy && !strategy.proxies.httpsProxy.startsWith("http://") && !strategy.proxies.httpsProxy.startsWith("https://")) {
      proxyErrors.httpsProxy = "HTTPS proxy must start with http:// or https:// (use the scheme your proxy supports).";
    }
    const portPattern = /:(\d+)(\/|$)/;
    const httpPort = strategy.proxies?.httpProxy?.match(portPattern)?.[1];
    const httpsPort = strategy.proxies?.httpsProxy?.match(portPattern)?.[1];
    if (httpPort && Number.isNaN(Number(httpPort))) {
      proxyErrors.httpProxy = "HTTP proxy port must be numeric";
    }
    if (httpsPort && Number.isNaN(Number(httpsPort))) {
      proxyErrors.httpsProxy = "HTTPS proxy port must be numeric";
    }
  }

  const updateStrategy = (patch) => updateState({ globalStrategy: { ...strategy, ...patch } });
  const updateMirroring = (patch) =>
    updateStrategy({ mirroring: { ...mirroring, ...patch } });

  const updateProxy = (field, value) =>
    updateStrategy({ proxies: { ...strategy.proxies, [field]: value } });
  const ntpServersArray = Array.isArray(strategy.ntpServers) ? strategy.ntpServers : (typeof strategy.ntpServers === "string" ? strategy.ntpServers.split(",").map((s) => s.trim()).filter(Boolean) : []);
  const [ntpInput, setNtpInput] = React.useState(() => ntpServersArray.join(", "));
  React.useEffect(() => {
    const nextStr = ntpServersArray.join(", ");
    const parsed = (typeof ntpInput === "string" ? ntpInput : "").split(",").map((s) => s.trim()).filter(Boolean);
    const same = parsed.length === ntpServersArray.length && parsed.every((s, i) => ntpServersArray[i] === s);
    if (!same) setNtpInput(nextStr);
  }, [strategy.ntpServers, ntpInput]);
  const updateNtpServers = (value) => {
    setNtpInput(value);
    updateStrategy({
      ntpServers: value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 4)
    });
  };
  const needsReview = state.reviewFlags?.global && state.ui?.visitedSteps?.global;

  const updatePlatformConfig = (patch) =>
    updateState({ platformConfig: { ...platformConfig, ...patch } });
  const updateAws = (patch) => updatePlatformConfig({ aws: { ...platformConfig.aws, ...patch } });
  const updateVsphere = (patch) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, ...patch } });
  const updateNutanix = (patch) => updatePlatformConfig({ nutanix: { ...platformConfig.nutanix, ...patch } });
  const updateAzure = (patch) => updatePlatformConfig({ azure: { ...platformConfig.azure, ...patch } });

  const selectedVersion = state.version?.selectedVersion || state.release?.patchVersion || "";
  const docsVersion = (selectedVersion || "4.0").split(".").slice(0, 2).join(".");
  const docsBase = `https://docs.redhat.com/en/documentation/openshift_container_platform/${docsVersion}`;
  const shouldLookupAmi =
    platform === "AWS GovCloud" &&
    method === "IPI" &&
    versionConfirmed &&
    Boolean(selectedVersion) &&
    Boolean(arch);

  React.useEffect(() => {
    if (!shouldLookupAmi) {
      setAwsRegions([]);
      return;
    }
    apiFetch(`/api/aws/regions?version=${encodeURIComponent(selectedVersion)}&arch=${encodeURIComponent(arch)}`)
      .then((data) => setAwsRegions(data.regions || []))
      .catch(() => setAwsRegions([]));
  }, [shouldLookupAmi, selectedVersion, arch]);

  const fetchAmiFromInstaller = async (region, force = false) => {
    if (!region) return;
    const key = `${selectedVersion}|${arch}|${region}`;
    setAmiLookup({ loading: true, error: "", key });
    try {
      const data = await apiFetch(
        `/api/aws/ami?version=${encodeURIComponent(selectedVersion)}&arch=${encodeURIComponent(arch)}&region=${encodeURIComponent(region)}${force ? "&force=true" : ""}`
      );
      updateAws({ amiId: data.ami, amiAutoFilled: true });
      setAmiLookup({ loading: false, error: "", key });
    } catch (error) {
      setAmiLookup({ loading: false, error: String(error?.message || error), key });
    }
  };

  React.useEffect(() => {
    if (!shouldLookupAmi) return;
    const region = platformConfig.aws?.region;
    if (!region) return;
    if (platformConfig.aws?.amiId && platformConfig.aws?.amiAutoFilled === false) return;
    const key = `${selectedVersion}|${arch}|${region}`;
    if (amiLookup.key === key && platformConfig.aws?.amiId) return;
    fetchAmiFromInstaller(region).catch(() => {});
  }, [
    shouldLookupAmi,
    platformConfig.aws?.region,
    platformConfig.aws?.amiId,
    platformConfig.aws?.amiAutoFilled,
    amiLookup.key,
    selectedVersion,
    arch
  ]);

  const pullSecretCheck = isValidPullSecret(state.credentials?.pullSecretPlaceholder || "");
  const sshKey = state.credentials?.sshPublicKey || "";
  const sshKeyInvalid = sshKey && !isValidSshPublicKey(sshKey);
  const mirrorPullSecret = state.credentials?.mirrorRegistryPullSecret || "";
  const mirrorUnauth = Boolean(state.credentials?.mirrorRegistryUnauthenticated);
  const mirrorPullSecretCheck = mirrorPullSecret ? isValidPullSecret(mirrorPullSecret) : { valid: false, error: "" };

  React.useEffect(() => {
    setMirrorHelper((prev) => ({ ...prev, registry: mirroring.registryFqdn || prev.registry }));
  }, [mirroring.registryFqdn]);

  const anyModalOpen = showKeygen || showMirrorSecretHelper || showAwsHelp;
  React.useEffect(() => {
    if (!anyModalOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setShowKeygen(false);
        setShowMirrorSecretHelper(false);
        setShowAwsHelp(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [anyModalOpen]);

  React.useEffect(() => {
    if (!mirrorUnauth) return;
    updateState({
      credentials: {
        ...state.credentials,
        mirrorRegistryPullSecret: buildUnauthMirrorSecret()
      }
    });
  }, [mirrorUnauth, mirroring.registryFqdn]);

  const buildUnauthMirrorSecret = () => {
    const registry = mirroring.registryFqdn || mirrorHelper.registry || "registry.local:5000";
    return JSON.stringify({ auths: { [registry]: { auth: "", email: "" } } });
  };

  const openKeygen = () => {
    setShowMirrorSecretHelper(false);
    setShowAwsHelp(false);
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

  const downloadKeypair = (publicKey, privateKey) => {
    const contents = `# OpenShift Airgap Architect SSH Keypair\n\n## Public Key\n${publicKey}\n\n## Private Key\n${privateKey}\n`;
    const blob = new Blob([contents], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "airgap-ssh-keypair.txt";
    a.click();
    URL.revokeObjectURL(url);
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

  const applyAwsHelp = () => {
    let publish = platformConfig.publish || "External";
    if (awsHelp.privateCluster) {
      publish = "Internal";
    } else if (platform === "Azure Government" && awsHelp.splitExposure) {
      publish = "Mixed";
    } else {
      publish = "External";
    }
    let credentialsMode = platformConfig.credentialsMode || "";
    if (awsHelp.noAdminCreds) {
      credentialsMode = "Manual";
    } else if (awsHelp.mustUseExistingCreds) {
      credentialsMode = "Passthrough";
    } else {
      credentialsMode = "";
    }
    updatePlatformConfig({ publish, credentialsMode });
    setShowAwsHelp(false);
  };

  const trustPolicyOptions = getTrustPolicyOptionsForScenario(getScenarioId(state), selectedVersion);
  const trustPolicyVersionSupport = getTrustBundlePolicySupport(selectedVersion);
  const forwardPolicyReleaseLabel = (selectedVersion || "").trim() || trustPolicyVersionSupport.minorVersion || "this release";
  const trustBundleBlocks = (pem) =>
    (pem || "")
      .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)
      ?.map((block) => block.trim()) || [];
  const mirrorBlocks = trustBundleBlocks(trust.mirrorRegistryCaPem);
  const proxyBlocks = trustBundleBlocks(trust.proxyCaPem);
  const effectiveBundle = Array.from(new Set([...mirrorBlocks, ...proxyBlocks])).join("\n");

  const cidrToRange = (cidr) => {
    if (!cidr || !cidr.includes("/")) return null;
    const [ip, prefix] = cidr.split("/");
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;
    const bits = Number(prefix);
    if (Number.isNaN(bits) || bits < 0 || bits > 32) return null;
    const toInt = (addr) => addr.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
    const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
    const base = toInt(ip) & mask;
    const size = 2 ** (32 - bits);
    return { start: base, end: base + size - 1 };
  };

  const cidrOverlaps = (cidrA, cidrB) => {
    const a = cidrToRange(cidrA);
    const b = cidrToRange(cidrB);
    if (!a || !b) return false;
    return a.start <= b.end && b.start <= a.end;
  };

  const overlapMessages = [];
  if (cidrOverlaps(networking.machineNetworkV4, networking.clusterNetworkCidr)) {
    overlapMessages.push("Machine network overlaps with cluster network CIDR.");
  }
  if (cidrOverlaps(networking.machineNetworkV4, networking.serviceNetworkCidr)) {
    overlapMessages.push("Machine network overlaps with service network CIDR.");
  }
  if (cidrOverlaps(networking.clusterNetworkCidr, networking.serviceNetworkCidr)) {
    overlapMessages.push("Cluster network overlaps with service network CIDR.");
  }
  const machineV6 = (networking.machineNetworkV6 || "").trim();
  const clusterV6 = (networking.clusterNetworkCidrV6 || "").trim();
  const serviceV6 = (networking.serviceNetworkCidrV6 || "").trim();
  if (machineV6 && clusterV6 && ipv6CidrOverlaps(machineV6, clusterV6)) {
    overlapMessages.push("Machine network (IPv6) overlaps with cluster network IPv6 CIDR.");
  }
  if (machineV6 && serviceV6 && ipv6CidrOverlaps(machineV6, serviceV6)) {
    overlapMessages.push("Machine network (IPv6) overlaps with service network IPv6 CIDR.");
  }
  if (clusterV6 && serviceV6 && ipv6CidrOverlaps(clusterV6, serviceV6)) {
    overlapMessages.push("Cluster network IPv6 CIDR overlaps with service network IPv6 CIDR.");
  }

  const validatePemInput = (text, target) => {
    if (!text) {
      setTrustErrors((prev) => ({ ...prev, [target]: "" }));
      return;
    }
    const hasPrivateKey = /BEGIN (RSA )?PRIVATE KEY/.test(text || "");
    const blocks = trustBundleBlocks(text);
    if (hasPrivateKey) {
      setTrustErrors((prev) => ({ ...prev, [target]: "Private keys are not allowed in CA bundles." }));
      return;
    }
    if (!blocks.length) {
      setTrustErrors((prev) => ({ ...prev, [target]: "Provide one or more PEM-encoded certificates." }));
      return;
    }
    setTrustErrors((prev) => ({ ...prev, [target]: "" }));
  };

  const handlePemText = (text, target) => {
    const field = target === "mirror" ? "mirrorRegistryCaPem" : "proxyCaPem";
    const nextTrust = withAutoTrustBundlePolicy({ ...trust, [field]: text }, strategy, getScenarioId(state), selectedVersion, trust);
    updateState({ trust: nextTrust });
    validatePemInput(text, target);
  };

  const handlePemFiles = async (files, target) => {
    const texts = await Promise.all(Array.from(files).map((file) => file.text()));
    const combined = texts.join("\n");
    handlePemText(combined, target);
  };

  const trustPolicySyncRef = React.useRef(null);
  React.useEffect(() => {
    const scenarioId = getScenarioId(state);
    const prev = trustPolicySyncRef.current;
    const nextTrust = withAutoTrustBundlePolicy(trust, strategy, scenarioId, selectedVersion, prev ?? undefined);
    const prevPolicy = trust.additionalTrustBundlePolicy || "";
    const nextPolicy = nextTrust.additionalTrustBundlePolicy || "";
    if (nextPolicy !== prevPolicy) {
      updateState({ trust: nextTrust });
    }
    trustPolicySyncRef.current = nextTrust;
  }, [
    effectiveBundle,
    selectedVersion,
    strategy.proxyEnabled,
    state.blueprint?.platform,
    state.methodology?.method,
    trust.additionalTrustBundlePolicy
  ]);

  return (
    <div className="step">
      <div className="step-header">
        <div className="step-header-main">
          <h2>Global Strategy</h2>
          <p className="subtle">Define security, proxy, and mirroring defaults for the deployment.</p>
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
        <section className={`card ${(fieldErrors.clusterName || fieldErrors.baseDomain) ? "highlight-errors" : ""}`}>
          <div className="card-header">
            <div>
              <h3 className="card-title">Cluster Identity</h3>
              <div className="card-subtitle">Cluster name and base domain for the install.</div>
            </div>
          </div>
          <div className="field-grid">
            <label>
              Cluster Name
              <input
                value={state.blueprint?.clusterName ?? ""}
                onChange={(e) => updateState({ blueprint: { ...state.blueprint, clusterName: e.target.value } })}
                placeholder="airgap-cluster"
              />
            </label>
            <label>
              Base Domain
              <input
                value={state.blueprint?.baseDomain ?? ""}
                onChange={(e) => updateState({ blueprint: { ...state.blueprint, baseDomain: e.target.value } })}
                placeholder="example.com"
              />
            </label>
          </div>
        </section>
        {needsReview ? (
          <div className="banner warning">
            Version or upstream selections changed. Review this page to ensure settings are still valid.
            <div className="actions">
              <button
                className="ghost"
                onClick={() => updateState({ reviewFlags: { ...state.reviewFlags, global: false } })}
              >
                Re-evaluate this page
              </button>
            </div>
          </div>
        ) : null}
        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Security Compliance</h3>
              <div className="card-subtitle">Enable hardened crypto settings when required.</div>
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={strategy.fips}
                onChange={(e) => updateStrategy({ fips: e.target.checked })}
              />
              <span>FIPS mode</span>
            </label>
          </div>
          {strategy.fips ? (
            <div className="note">
              The installer host must run RHEL 9 with FIPS enabled.{" "}
              <a
                href={`https://docs.redhat.com/en/documentation/openshift_container_platform/${(selectedVersion || "4.0").split(".").slice(0, 2).join(".")}/html/installing/installation-configuration#installation-special-config-fips_installing-customizations`}
                target="_blank"
                rel="noreferrer"
              >
                Official FIPS guidance (version-specific)
              </a>
            </div>
          ) : null}
        </section>

        <section className={`card ${fieldErrors.proxy ? "highlight-errors" : ""}`}>
          <div className="card-header">
            <div>
              <h3 className="card-title">Corporate Proxy</h3>
              <div className="card-subtitle">Optional HTTP(S) egress configuration.</div>
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={strategy.proxyEnabled}
                onChange={(e) => updateStrategy({ proxyEnabled: e.target.checked })}
              />
              <span>Enable proxy</span>
            </label>
          </div>
          {strategy.proxyEnabled ? (
            <div className="card-body">
              <div className="field-grid proxy-fields-grid">
                <label>
                  HTTP Proxy {proxyRequired ? "(required for jumpbox)" : "(optional)"}
                  <textarea
                    className="proxy-field-input proxy-field-textarea"
                    value={strategy.proxies.httpProxy}
                    onChange={(e) => updateProxy("httpProxy", e.target.value.replace(/\n/g, " ").trim())}
                    placeholder="http://proxy.corp:8080"
                    rows={2}
                    spellCheck={false}
                    required={proxyRequired}
                  />
                  {proxyErrors.httpProxy ? <div className="note warning">{proxyErrors.httpProxy}</div> : null}
                </label>
                <FieldLabelWithInfo
                  label={`HTTPS Proxy ${proxyRequired ? "(required for jumpbox)" : "(optional)"}`}
                  hint="For httpsProxy, use the scheme your proxy actually supports. Many environments use http:// here even for HTTPS traffic."
                >
                  <textarea
                    className="proxy-field-input proxy-field-textarea"
                    value={strategy.proxies.httpsProxy}
                    onChange={(e) => updateProxy("httpsProxy", e.target.value.replace(/\n/g, " ").trim())}
                    placeholder="https://proxy.corp:8443 or http:// if proxy only supports HTTP"
                    rows={2}
                    spellCheck={false}
                    required={proxyRequired}
                  />
                </FieldLabelWithInfo>
                {proxyErrors.httpsProxy ? <div className="note warning">{proxyErrors.httpsProxy}</div> : null}
                <label>
                  No Proxy
                  <textarea
                    className="proxy-field-input proxy-field-textarea"
                    value={strategy.proxies.noProxy}
                    onChange={(e) => updateProxy("noProxy", e.target.value.replace(/\n/g, " ").trim())}
                    placeholder=".cluster.local,.svc,10.128.0.0/14,127.0.0.1"
                    rows={2}
                    spellCheck={false}
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="note">Proxy is disabled. Enable it when egress must flow through a corporate proxy.</div>
          )}
        </section>

        <section className={`card ${fieldErrors.networking ? "highlight-errors" : ""}`}>
          <div className="card-header">
            <div>
              <h3 className="card-title">Cluster Networking</h3>
              <div className="card-subtitle">Address pools for nodes, pods, and services.</div>
            </div>
          </div>
          <div className="card-body">
            <label className="toggle-row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <input
                type="checkbox"
                checked={Boolean(state.hostInventory?.enableIpv6)}
                onChange={(e) =>
                  updateState({
                    hostInventory: { ...(state.hostInventory || {}), enableIpv6: e.target.checked }
                  })
                }
              />
              <FieldLabelWithInfo
                label="Enable IPv6 (cluster-wide)"
                hint="When enabled, IPv6 machine network and per-host IPv6 fields (on the Host Inventory tab when applicable) are shown and included in generated configs."
              />
            </label>
            {state.hostInventory?.enableIpv6 ? (
              <p className="note" style={{ marginTop: 8, marginBottom: 0 }}>
                IPv6 machine, cluster, and service fields show together when enabled (same behavior as the Networking step in the segmented flow). Install-config order is still IPv4 then IPv6 machine networks when both are set.
              </p>
            ) : null}
          </div>
          {overlapMessages.length ? (
            <div className="banner warning">
              {overlapMessages.join(" ")} Overlapping networks are not supported.
            </div>
          ) : null}
          <div className="card-body">
            <div className="field-grid">
              <FieldLabelWithInfo
                label="Machine Network (IPv4 CIDR)"
                hint="Node IPs live here; most installs only customize this CIDR."
              >
                <input
                  value={networking.machineNetworkV4 || ""}
                  onChange={(e) =>
                    updateStrategy({ networking: { ...networking, machineNetworkV4: formatIpv4Cidr(e.target.value) } })
                  }
                  placeholder="10.90.0.0/24"
                />
              </FieldLabelWithInfo>
              {cidrOverlaps(networking.machineNetworkV4, networking.clusterNetworkCidr)
                ? <div className="note warning">Overlaps with cluster network.</div>
                : null}
              {cidrOverlaps(networking.machineNetworkV4, networking.serviceNetworkCidr)
                ? <div className="note warning">Overlaps with service network.</div>
                : null}
              {state.hostInventory?.enableIpv6 ? (
                <FieldLabelWithInfo
                  label="Machine Network (IPv6 CIDR)"
                  hint="Only required for dual-stack deployments."
                >
                  <input
                    value={networking.machineNetworkV6 || ""}
                    onChange={(e) =>
                      updateStrategy({ networking: { ...networking, machineNetworkV6: formatIpv6Cidr(e.target.value) } })
                    }
                    placeholder="fd10:90::/64"
                  />
                </FieldLabelWithInfo>
              ) : null}
              <FieldLabelWithInfo
                label="Cluster Network CIDR"
                hint="Pod network; usually safe to keep default."
              >
                <input
                  value={networking.clusterNetworkCidr || ""}
                  onChange={(e) =>
                    updateStrategy({ networking: { ...networking, clusterNetworkCidr: formatIpv4Cidr(e.target.value) } })
                  }
                  placeholder="10.128.0.0/14"
                />
              </FieldLabelWithInfo>
              {cidrOverlaps(networking.clusterNetworkCidr, networking.serviceNetworkCidr)
                ? <div className="note warning">Overlaps with service network.</div>
                : null}
              {cidrOverlaps(networking.machineNetworkV4, networking.clusterNetworkCidr)
                ? <div className="note warning">Overlaps with machine network.</div>
                : null}
              <FieldLabelWithInfo
                label="Cluster Network Host Prefix"
                hint="Determines per-node pod CIDR size."
              >
                <input
                  type="number"
                  value={networking.clusterNetworkHostPrefix ?? 23}
                  onChange={(e) =>
                    updateStrategy({ networking: { ...networking, clusterNetworkHostPrefix: Number(e.target.value) } })
                  }
                  min="16"
                  max="28"
                />
              </FieldLabelWithInfo>
              {state.hostInventory?.enableIpv6 ? (
                <>
                  <FieldLabelWithInfo
                    label="Cluster Network IPv6 CIDR (optional)"
                    hint="Pod network IPv6 (dual-stack or IPv6 data plane). Default fd01::/48 if blank."
                  >
                    <input
                      value={networking.clusterNetworkCidrV6 || ""}
                      onChange={(e) =>
                        updateStrategy({
                          networking: {
                            ...networking,
                            clusterNetworkCidrV6: formatIpv6Cidr(e.target.value) || undefined
                          }
                        })
                      }
                      placeholder="fd01::/48"
                    />
                  </FieldLabelWithInfo>
                  <FieldLabelWithInfo
                    label="Cluster Network IPv6 Host Prefix (optional)"
                    hint="Default 64 if blank."
                  >
                    <input
                      type="number"
                      value={networking.clusterNetworkHostPrefixV6 ?? 64}
                      onChange={(e) =>
                        updateStrategy({
                          networking: {
                            ...networking,
                            clusterNetworkHostPrefixV6:
                              e.target.value === "" ? undefined : Number(e.target.value)
                          }
                        })
                      }
                      min={48}
                      max={128}
                      placeholder="64"
                    />
                  </FieldLabelWithInfo>
                </>
              ) : null}
              <FieldLabelWithInfo
                label="Service Network CIDR"
                hint="ClusterIP range; usually safe to keep default."
              >
                <input
                  value={networking.serviceNetworkCidr || ""}
                  onChange={(e) =>
                    updateStrategy({ networking: { ...networking, serviceNetworkCidr: formatIpv4Cidr(e.target.value) } })
                  }
                  placeholder="172.30.0.0/16"
                />
              </FieldLabelWithInfo>
              {cidrOverlaps(networking.machineNetworkV4, networking.serviceNetworkCidr)
                ? <div className="note warning">Overlaps with machine network.</div>
                : null}
              {cidrOverlaps(networking.clusterNetworkCidr, networking.serviceNetworkCidr)
                ? <div className="note warning">Overlaps with cluster network.</div>
                : null}
              {state.hostInventory?.enableIpv6 ? (
                <FieldLabelWithInfo
                  label="Service Network IPv6 CIDR (optional)"
                  hint="Service (ClusterIP) IPv6. Default fd02::/112 if blank."
                >
                  <input
                    value={networking.serviceNetworkCidrV6 || ""}
                    onChange={(e) =>
                      updateStrategy({
                        networking: {
                          ...networking,
                          serviceNetworkCidrV6: formatIpv6Cidr(e.target.value) || undefined
                        }
                      })
                    }
                    placeholder="fd02::/112"
                  />
                </FieldLabelWithInfo>
              ) : null}
            </div>
          </div>
        </section>

        {platform !== "AWS GovCloud" ? (
        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Time & NTP</h3>
              <div className="card-subtitle">Keep the installer and nodes time-synchronized.</div>
            </div>
          </div>
          <div className="card-body">
            <FieldLabelWithInfo
              label="NTP Servers (comma-separated)"
              hint="Use up to four reliable NTP sources. Time skew is a common install failure."
            >
              <input
                value={ntpInput}
                onChange={(e) => updateNtpServers(e.target.value)}
                placeholder="time.corp.local,10.90.0.10"
              />
            </FieldLabelWithInfo>
          </div>
        </section>
        ) : null}

        <section className={`card ${fieldErrors.mirrorSecret ? "highlight-errors" : ""}`}>
          <div className="card-header">
            <div>
              <h3 className="card-title">Mirroring Configuration</h3>
              <div className="card-subtitle">Define local registry and mirror mapping.</div>
            </div>
          </div>
          <div className="card-body">
            <FieldLabelWithInfo
              label="Local Registry FQDN"
              hint="imageDigestSources in install-config are prepopulated from this section. The authoritative values come from the IDMS manifest generated by oc-mirror v2."
            >
              <input
                value={mirroring.registryFqdn}
                onChange={(e) => {
                  const nextFqdn = e.target.value;
                  const prevFqdn = mirroring.registryFqdn;
                  const updatedSources = mirroring.sources.map((src) => ({
                    ...src,
                    mirrors: src.mirrors.map((mirror) =>
                      mirror.startsWith(prevFqdn) ? mirror.replace(prevFqdn, nextFqdn) : mirror
                    )
                  }));
                  updateMirroring({ registryFqdn: nextFqdn, sources: updatedSources });
                }}
                placeholder="registry.corp.local:5000"
              />
            </FieldLabelWithInfo>
            <div className="mirror-list">
              <div className="mirror-header">
                <span>Source registry</span>
                <span>Mirror registry (one or more)</span>
                <span>Actions</span>
              </div>
              {mirroring.sources.map((source, idx) => (
                <div key={idx} className="mirror-row">
                  <input
                    value={source.source}
                    onChange={(e) => {
                      const next = [...mirroring.sources];
                      next[idx] = { ...next[idx], source: e.target.value };
                      updateMirroring({ sources: next });
                    }}
                    placeholder="quay.io/openshift-release-dev/ocp-release"
                  />
                  <input
                    value={source.mirrors.join(",")}
                    onChange={(e) => {
                      const next = [...mirroring.sources];
                      next[idx] = { ...next[idx], mirrors: e.target.value.split(",").map((m) => m.trim()) };
                      updateMirroring({ sources: next });
                    }}
                    placeholder={`${mirroring.registryFqdn || "registry.local:5000"}/ocp-release`}
                  />
                  <button
                    className="ghost"
                    type="button"
                    disabled={mirroring.sources.length === 1 || idx < 2}
                    onClick={() => {
                      if (!window.confirm("Remove this mirror mapping?")) return;
                      const next = mirroring.sources.filter((_, index) => index !== idx);
                      updateMirroring({ sources: next });
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="ghost"
                onClick={() =>
                  updateMirroring({ sources: [...mirroring.sources, { source: "", mirrors: [""] }] })
                }
              >
                Add Mirror Path
              </button>
            </div>
            <div className="note">
              Remove any auto-added paths you do not plan to mirror.
            </div>
          </div>
        </section>

        <section className={`card ${fieldErrors.platform ? "highlight-errors" : ""}`}>
          <div className="card-header">
            <div>
              <h3 className="card-title">Platform Configuration</h3>
              <div className="card-subtitle">Fields shown here are scoped to the selected platform and install method.</div>
            </div>
          </div>
          <div className="card-body">
            {showPublishCreds ? (
              <div className="field-grid">
              <label>
                Publish Strategy
                <select
                  value={platformConfig.publish || "External"}
                  onChange={(e) => updatePlatformConfig({ publish: e.target.value })}
                >
                  <option value="External">External</option>
                  <option value="Internal">Internal</option>
                  {platform === "Azure Government" ? <option value="Mixed">Mixed</option> : null}
                </select>
                <div className="note">External exposes API/ingress publicly; Internal keeps them private.</div>
              </label>
              {showPublishCreds ? (
                <label>
                  Credentials Mode
                  <select
                    value={platformConfig.credentialsMode || ""}
                    onChange={(e) => updatePlatformConfig({ credentialsMode: e.target.value })}
                  >
                    <option value="">Auto (default)</option>
                    <option value="Mint">Mint</option>
                    <option value="Passthrough">Passthrough</option>
                    <option value="Manual">Manual</option>
                  </select>
                  <div className="note">Use Auto unless you have a policy requirement to manage credentials manually.</div>
                </label>
              ) : null}
              <div className="actions">
                <button className="ghost" type="button" onClick={() => { setShowKeygen(false); setShowMirrorSecretHelper(false); setShowAwsHelp(true); }}>
                  Help me decide
                </button>
                {platform === "AWS GovCloud" ? (
                  <a href={`${docsBase}/html/installing_on_aws`} target="_blank" rel="noreferrer">
                    AWS install docs
                  </a>
                ) : null}
                {platform === "Azure Government" ? (
                  <a href={`${docsBase}/html/installing_on_azure`} target="_blank" rel="noreferrer">
                    Azure install docs
                  </a>
                ) : null}
              </div>
            </div>
          ) : platform === "VMware vSphere" && method === "IPI" ? (
            <div className="field-grid">
              <label>
                Publish strategy
                <select
                  value={(platformConfig.publish || "External") === "Internal" ? "External" : (platformConfig.publish || "External")}
                  onChange={(e) => updatePlatformConfig({ publish: e.target.value })}
                  aria-label="Publish strategy (vSphere: External only)"
                >
                  <option value="External">External</option>
                </select>
                <div className="note">Internal is not supported on non-cloud platforms (vSphere). See BZ#1953035.</div>
              </label>
            </div>
          ) : (
            <div className="note">
              Publish strategy and credentials mode are only applicable for AWS/Azure IPI installs.
            </div>
          )}

          {platform === "AWS GovCloud" && (method === "IPI" || method === "UPI") ? (
            <div className="field-grid">
              {method === "UPI" ? (
                <div className="note">
                  UPI in GovCloud requires pre-provisioned infrastructure. GovCloud-specific guidance can vary by version.
                  Review the AWS install docs for your selected version before proceeding.
                  {" "}
                  <a href={`${docsBase}/html/installing_on_aws`} target="_blank" rel="noreferrer">
                    AWS install docs
                  </a>
                </div>
              ) : null}
              <label>
                AWS Region
                {awsRegions.length ? (
                  <select value={platformConfig.aws?.region || ""} onChange={(e) => updateAws({ region: e.target.value })}>
                    <option value="">Select a region</option>
                    {awsRegions.map((region) => (
                      <option key={region} value={region}>{region}</option>
                    ))}
                  </select>
                ) : (
                  <input value={platformConfig.aws?.region || ""} onChange={(e) => updateAws({ region: e.target.value })} placeholder="us-gov-west-1" />
                )}
                {!versionConfirmed ? (
                  <div className="note warning">Confirm the release version to unlock installer metadata and region lookups.</div>
                ) : null}
                {shouldLookupAmi && !awsRegions.length ? (
                  <div className="note warning">No AWS regions found for this architecture and release.</div>
                ) : null}
              </label>
              {method === "IPI" ? (
                <>
                  <label>
                    Control Plane Instance Type (optional)
                    <input
                      list="aws-instance-types"
                      value={platformConfig.aws?.controlPlaneInstanceType || ""}
                      onChange={(e) => updateAws({ controlPlaneInstanceType: e.target.value })}
                      placeholder="m6i.xlarge"
                    />
                    <div className="note">Leave blank to use installer defaults. Recommended: general purpose.</div>
                  </label>
                  <label>
                    Worker Instance Type (optional)
                    <input
                      list="aws-instance-types"
                      value={platformConfig.aws?.workerInstanceType || ""}
                      onChange={(e) => updateAws({ workerInstanceType: e.target.value })}
                      placeholder="m6i.xlarge"
                    />
                    <div className="note">Leave blank to use installer defaults. Match control plane for simplicity.</div>
                  </label>
                </>
              ) : null}
              <label>
                Custom RHCOS AMI ID (optional)
                <input
                  value={platformConfig.aws?.amiId || ""}
                  onChange={(e) => updateAws({ amiId: e.target.value, amiAutoFilled: false })}
                  placeholder="ami-0123456789abcdef0"
                />
                <div className="note">Only required for secret regions that do not publish RHCOS AMIs.</div>
                <div className="note">Use the installer stream metadata to locate region-specific AMIs for your version.</div>
                <div className="actions">
                  <button
                    className="ghost"
                    type="button"
                    disabled={!shouldLookupAmi || !platformConfig.aws?.region || amiLookup.loading}
                    onClick={() => fetchAmiFromInstaller(platformConfig.aws?.region, true)}
                  >
                    {amiLookup.loading ? "Looking up AMI…" : "Auto-populate from installer metadata"}
                  </button>
                </div>
                {amiLookup.error ? <div className="note warning">{amiLookup.error}</div> : null}
              </label>
              <datalist id="aws-instance-types">
                <option value="m6i.xlarge">m6i.xlarge (general purpose)</option>
                <option value="m6a.xlarge">m6a.xlarge (general purpose)</option>
                <option value="c6i.xlarge">c6i.xlarge (compute optimized)</option>
                <option value="r6i.xlarge">r6i.xlarge (memory optimized)</option>
                <option value="m5.xlarge">m5.xlarge (general purpose)</option>
                <option value="c5.xlarge">c5.xlarge (compute optimized)</option>
                <option value="r5.xlarge">r5.xlarge (memory optimized)</option>
              </datalist>
              <label>
                Subnets (comma-separated, optional)
                <input value={platformConfig.aws?.subnets || ""} onChange={(e) => updateAws({ subnets: e.target.value })} placeholder="subnet-abc,subnet-def" />
                <div className="note">Use for installs into an existing VPC or private clusters.</div>
              </label>
              <label>
                Hosted Zone (optional)
                <input value={platformConfig.aws?.hostedZone || ""} onChange={(e) => updateAws({ hostedZone: e.target.value })} placeholder="Z1234567890" />
                <div className="note">Leave blank if you are not using Route 53 and will manage DNS manually.</div>
              </label>
              <label>
                Hosted Zone Role ARN (optional)
                <input value={platformConfig.aws?.hostedZoneRole || ""} onChange={(e) => updateAws({ hostedZoneRole: e.target.value })} placeholder="arn:aws-us-gov:iam::123:role/HostedZoneRole" />
              </label>
              <label>
                Load Balancer Type (optional)
                <input value={platformConfig.aws?.lbType || ""} onChange={(e) => updateAws({ lbType: e.target.value })} placeholder="NLB" />
              </label>
              <div className="note">
                AWS scenario mapping: existing VPC uses platform.aws.vpc.subnets (see Platform Specifics in segmented flow); private cluster uses publish=Internal;
                government/secret regions require a custom RHCOS AMI; restricted networks use the mirrored content workflow.
              </div>
              {method === "IPI" ? (
                <div className="note">
                  For AWS IPI, these settings map directly into install-config. Review the official AWS install docs for your version.
                  {" "}
                  <a href={`${docsBase}/html/installing_on_aws`} target="_blank" rel="noreferrer">
                    AWS IPI docs
                  </a>
                </div>
              ) : null}
            </div>
          ) : null}

          {platform === "VMware vSphere" && method === "IPI" ? (
            <div className="field-grid">
              <label>
                vCenter
                <input value={platformConfig.vsphere?.vcenter || ""} onChange={(e) => updateVsphere({ vcenter: e.target.value })} placeholder="vcenter.example.com" />
              </label>
              <label>
                vCenter Username
                <input value={platformConfig.vsphere?.username || ""} onChange={(e) => updateVsphere({ username: e.target.value })} placeholder="administrator@vsphere.local" />
              </label>
              <label>
                vCenter Password
                <input type="password" autoComplete="new-password" value={platformConfig.vsphere?.password || ""} onChange={(e) => updateVsphere({ password: e.target.value })} />
              </label>
              <label>
                Datacenter
                <input value={platformConfig.vsphere?.datacenter || ""} onChange={(e) => updateVsphere({ datacenter: e.target.value })} />
              </label>
              <label>
                Cluster
                <input value={platformConfig.vsphere?.cluster || ""} onChange={(e) => updateVsphere({ cluster: e.target.value })} />
              </label>
              <label>
                Datastore
                <input value={platformConfig.vsphere?.datastore || ""} onChange={(e) => updateVsphere({ datastore: e.target.value })} />
              </label>
              <label>
                Network
                <input value={platformConfig.vsphere?.network || ""} onChange={(e) => updateVsphere({ network: e.target.value })} />
              </label>
              <label>
                Folder (optional)
                <input value={platformConfig.vsphere?.folder || ""} onChange={(e) => updateVsphere({ folder: e.target.value })} />
              </label>
              <label>
                Resource Pool (optional)
                <input value={platformConfig.vsphere?.resourcePool || ""} onChange={(e) => updateVsphere({ resourcePool: e.target.value })} />
              </label>
              <div className="note">
                vSphere scenario mapping: IPI uses vCenter, datacenter, cluster, datastore, network; disconnected uses mirrored content. UPI: provision VMs yourself.
              </div>
            </div>
          ) : null}

          {platform === "Nutanix" && method === "IPI" ? (
            <div className="field-grid">
              <label>
                Prism Central Endpoint
                <input value={platformConfig.nutanix?.endpoint || ""} onChange={(e) => updateNutanix({ endpoint: e.target.value })} placeholder="prism.example.com" />
              </label>
              <label>
                Prism Central Port
                <input value={platformConfig.nutanix?.port || ""} onChange={(e) => updateNutanix({ port: e.target.value })} placeholder="9440" />
              </label>
              <label>
                Prism Central Username
                <input value={platformConfig.nutanix?.username || ""} onChange={(e) => updateNutanix({ username: e.target.value })} />
              </label>
              <label>
                Prism Central Password
                <input type="password" autoComplete="new-password" value={platformConfig.nutanix?.password || ""} onChange={(e) => updateNutanix({ password: e.target.value })} />
              </label>
              <label>
                Cluster Name
                <input value={platformConfig.nutanix?.cluster || ""} onChange={(e) => updateNutanix({ cluster: e.target.value })} />
              </label>
              <label>
                Subnet UUID
                <input value={platformConfig.nutanix?.subnet || ""} onChange={(e) => updateNutanix({ subnet: e.target.value })} />
              </label>
              <div className="note">
                Nutanix scenario mapping: IPI uses Prism Central, subnet UUID(s), cluster name, and API/Ingress VIPs (set on the Networking step); disconnected install uses mirrored content.
              </div>
            </div>
          ) : null}

          {platform === "Azure Government" && method === "IPI" ? (
            <div className="field-grid">
              <label>
                Cloud Name
                <input value={platformConfig.azure?.cloudName || ""} onChange={(e) => updateAzure({ cloudName: e.target.value })} placeholder="AzureUSGovernmentCloud" />
              </label>
              <label>
                Region
                <input value={platformConfig.azure?.region || ""} onChange={(e) => updateAzure({ region: e.target.value })} placeholder="usgovvirginia" />
              </label>
              <label>
                Resource Group Name
                <input value={platformConfig.azure?.resourceGroupName || ""} onChange={(e) => updateAzure({ resourceGroupName: e.target.value })} />
              </label>
              <label>
                Base Domain Resource Group
                <input value={platformConfig.azure?.baseDomainResourceGroupName || ""} onChange={(e) => updateAzure({ baseDomainResourceGroupName: e.target.value })} />
              </label>
              <div className="note">
                Azure Government scenario mapping: set cloudName (e.g. AzureUSGovernmentCloud), region, resource groups; use publish/credentialsMode for private; restricted network uses mirrored content.
              </div>
            </div>
          ) : null}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Trust and Certificates</h3>
              <div className="card-subtitle">Provide CA bundles for registry and proxy trust.</div>
            </div>
          </div>
          <div className="card-body">
            <div className="note">
              Provide PEM-encoded CA certificates (one or more BEGIN CERTIFICATE blocks). Do not paste private keys.
            </div>
            <div className="note">
              Mirror registry CA is provided by the registry team. Proxy CA is provided by the proxy/security team.
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={trust.mirrorRegistryUsesPrivateCa || false}
                onChange={(e) => updateState({ trust: { ...trust, mirrorRegistryUsesPrivateCa: e.target.checked } })}
              />
              <span>Mirror registry uses a private/self-signed CA</span>
            </label>
            <div className="field-grid">
            <label>
              Mirror Registry CA Bundle
              <textarea
                value={trust.mirrorRegistryCaPem || ""}
                onChange={(e) => handlePemText(e.target.value, "mirror")}
                rows={4}
                placeholder="Type, copy/paste, or drag and drop PEM content here"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handlePemFiles(e.dataTransfer.files, "mirror");
                }}
              />
              {trustErrors.mirror ? <div className="note warning">{trustErrors.mirror}</div> : null}
              {trust.mirrorRegistryUsesPrivateCa && !trust.mirrorRegistryCaPem ? (
                <div className="note warning">Mirror registry CA bundle is required when using a private CA.</div>
              ) : null}
              <input
                type="file"
                accept=".pem,.crt,.cer"
                multiple
                onChange={(e) => handlePemFiles(e.target.files, "mirror")}
              />
            </label>
            <label>
              Proxy CA Bundle
              <textarea
                value={trust.proxyCaPem || ""}
                onChange={(e) => handlePemText(e.target.value, "proxy")}
                rows={4}
                placeholder="Type, copy/paste, or drag and drop PEM content here"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handlePemFiles(e.dataTransfer.files, "proxy");
                }}
              />
              {trustErrors.proxy ? <div className="note warning">{trustErrors.proxy}</div> : null}
              <input
                type="file"
                accept=".pem,.crt,.cer"
                multiple
                onChange={(e) => handlePemFiles(e.target.files, "proxy")}
              />
            </label>
          </div>
          {hasEffectiveTrustBundle(trust) ? (
            <>
              <label>
                additionalTrustBundlePolicy
                <select
                  value={trust.additionalTrustBundlePolicy || ""}
                  onChange={(e) => updateState({ trust: { ...trust, additionalTrustBundlePolicy: e.target.value } })}
                  disabled={!trustPolicyOptions.length}
                >
                  <option value="" disabled>Select policy</option>
                  {trustPolicyOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                {!trustPolicyOptions.length ? (
                  <div className="note warning">Could not resolve trust bundle policy options for this OpenShift version.</div>
                ) : null}
              </label>
              {trustPolicyOptions.length > 0 && trustPolicyVersionSupport.source === "forward" ? (
                <div className="note warning">
                  OpenShift <strong>{forwardPolicyReleaseLabel}</strong> is not yet fully reflected in this tool&apos;s version-scrubbed docs index and catalogs for that minor. Confirm <strong>Proxyonly</strong> and <strong>Always</strong> against official Red Hat documentation before production.
                </div>
              ) : null}
              <div className="note">
                <strong>Proxyonly</strong> applies the bundle in the proxy trust path when a cluster proxy is set (OpenShift 4.20 default for many proxy-only CA cases). <strong>Always</strong> distributes the bundle for cluster-wide trust—typical when a mirror registry CA is included.
              </div>
            </>
          ) : (
            <p className="note subtle">
              <code>additionalTrustBundlePolicy</code> is only meaningful with <code>additionalTrustBundle</code>. Add a valid mirror and/or proxy CA above to enable it; the app defaults to <strong>Always</strong> when mirror PEMs exist and <strong>Proxyonly</strong> when only proxy PEMs exist.
            </p>
          )}
          <div className="card">
            <h4>Effective Trust Bundle (PEM)</h4>
            <pre className="preview">{effectiveBundle || "No trust bundle configured."}</pre>
          </div>
            <div className="note warning">
              Why installs fail here: most disconnected failures are trust-chain problems. This section makes the trust chain explicit and reproducible.
            </div>
          </div>
        </section>

        <section className={`card ${fieldErrors.pullSecret ? "highlight-errors" : ""}`}>
          <div className="card-header">
            <div>
              <h3 className="card-title">Access Credentials</h3>
              <div className="card-subtitle">SSH access and mirror registry authentication.</div>
            </div>
          </div>
          <div className="card-body">
            <div className="field-grid">
          <label>
            SSH Public Key
            <textarea
              value={state.credentials.sshPublicKey}
              onChange={(e) => updateState({ credentials: { ...state.credentials, sshPublicKey: e.target.value } })}
              rows={3}
              placeholder="ssh-rsa AAAA..."
            />
            {sshKeyInvalid ? <div className="note warning">SSH public key format is invalid.</div> : null}
            <div className="actions">
              <button className="ghost" type="button" onClick={openKeygen}>
                Generate keypair
              </button>
            </div>
          </label>
          <div>
            <fieldset style={{ border: "none", margin: 0, padding: 0, marginBottom: 8 }}>
              <legend style={{ marginBottom: 6 }}>Mirror registry authentication</legend>
              <label className="toggle-row" style={{ display: "block", marginBottom: 6 }}>
                <input
                  type="radio"
                  name="mirror-auth-mode-global"
                  checked={mirrorUnauth}
                  onChange={() => {
                    setMirrorSecretBackup(mirrorPullSecret);
                    updateState({
                      credentials: {
                        ...state.credentials,
                        usingMirrorRegistry: true,
                        mirrorRegistryUnauthenticated: true,
                        mirrorRegistryPullSecret: buildUnauthMirrorSecret()
                      }
                    });
                  }}
                />
                <span>Anonymous pulls</span>
              </label>
              <label className="toggle-row" style={{ display: "block" }}>
                <input
                  type="radio"
                  name="mirror-auth-mode-global"
                  checked={!mirrorUnauth}
                  onChange={() => {
                    updateState({
                      credentials: {
                        ...state.credentials,
                        usingMirrorRegistry: true,
                        mirrorRegistryUnauthenticated: false,
                        mirrorRegistryPullSecret: mirrorSecretBackup || ""
                      }
                    });
                  }}
                />
                <span>Use mirror-registry credentials (paste or generate)</span>
              </label>
            </fieldset>
            {mirrorUnauth ? (
              <div className="note">
                Anonymous pulls selected. Select &quot;Use mirror-registry credentials&quot; above to paste or generate.
              </div>
            ) : (
              <>
                <SecretInput
                  value={mirrorPullSecret}
                  onChange={(v) =>
                    updateState({
                      credentials: {
                        ...state.credentials,
                        ...(mirrorUnauth ? { mirrorRegistryUnauthenticated: false } : {}),
                        mirrorRegistryPullSecret: v
                      }
                    })
                  }
                  label="Mirror registry pull secret (JSON)"
                  labelEmphasis="Mirror registry pull secret (JSON)"
                  errorMessage={mirrorPullSecret && !mirrorPullSecretCheck.valid ? mirrorPullSecretCheck.error : undefined}
                  notPersistedMessage="Use mirror registry credentials (not your Red Hat pull secret). Stored in the run state unless cleared."
                  placeholder='{"auths":{...}}'
                  rows={3}
                  aria-label="Mirror registry pull secret JSON"
                />
                <div className="actions">
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => {
                      setShowKeygen(false);
                      setShowAwsHelp(false);
                      if (!mirrorHelper.registry && mirroring.registryFqdn) {
                        setMirrorHelper({ ...mirrorHelper, registry: mirroring.registryFqdn });
                      }
                      setShowMirrorSecretHelper(true);
                    }}
                  >
                    Pull secret helper
                  </button>
                </div>
              </>
            )}
          </div>
            </div>
            {!sshKey || (!mirrorUnauth && !mirrorPullSecret) ? (
              <div className="note warning">
                SSH public key and mirror registry pull secret are required for disconnected installs.
              </div>
            ) : null}
          </div>
        </section>
        {showKeygen ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setShowKeygen(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>Generated SSH Keypair</h3>
              <div className="note warning">
                Save the private key now. It will not be stored and cannot be retrieved later.
              </div>
              <div className="field-grid">
                <label>
                  Key Type
                  <select
                    value={keygenAlgorithm}
                    onChange={(e) => setKeygenAlgorithm(e.target.value)}
                    disabled={keygenLoading}
                  >
                    <option value="ed25519">ed25519 (recommended)</option>
                    <option value="rsa">RSA 4096</option>
                    <option value="ecdsa">ECDSA P-521</option>
                  </select>
                </label>
                <div className="actions" style={{ alignItems: "flex-end" }}>
                  <button className="primary" onClick={generateKeypair} disabled={keygenLoading}>
                    {keygenLoading ? "Generating…" : "Confirm & Generate"}
                  </button>
                </div>
              </div>
              {keygenLoading ? <div className="loading">Generating keypair…</div> : null}
              {!keygenLoading && keypair ? (
                <>
                  <label>
                    Public Key
                    <textarea className="textarea" rows={3} value={keypair.publicKey} readOnly />
                  </label>
                  <label>
                    <div className="field-header">
                      <span>Private Key</span>
                      <button
                        className="ghost mini"
                        type="button"
                        title={showPrivateKey ? "Hide key" : "Show key"}
                        onClick={() => setShowPrivateKey((prev) => !prev)}
                      >
                        {showPrivateKey ? "Hide" : "Show"}
                      </button>
                    </div>
                    <textarea
                      className="textarea"
                      rows={6}
                      value={
                        showPrivateKey
                          ? keypair.privateKey
                          : "•".repeat(Math.min(keypair.privateKey.length, 1200))
                      }
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
                        if (checked) {
                          updateState({ credentials: { ...state.credentials, sshPublicKey: keypair.publicKey } });
                        }
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
                    <button
                      className="ghost"
                      onClick={() => navigator.clipboard.writeText(keypair.publicKey)}
                    >
                      Copy public key
                    </button>
                    <button
                      className="ghost"
                      onClick={() => navigator.clipboard.writeText(keypair.privateKey)}
                    >
                      Copy private key
                    </button>
                    <button
                      className="ghost"
                      onClick={() => downloadKeypair(keypair.publicKey, keypair.privateKey)}
                    >
                      Download keys
                    </button>
                  </>
                ) : null}
                <button className="ghost" onClick={() => setShowKeygen(false)}>Close</button>
              </div>
            </div>
          </div>
        ) : null}
        {showMirrorSecretHelper ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setShowMirrorSecretHelper(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>Mirror Registry Pull Secret Helper</h3>
              <div className="note">
                Credentials entered here are used only to generate the JSON locally. They are not stored or exported.
              </div>
              <div className="field-grid">
                <label>
                  Registry FQDN
                  <input
                    value={mirrorHelper.registry}
                    onChange={(e) => setMirrorHelper({ ...mirrorHelper, registry: e.target.value })}
                    placeholder="registry.corp.local:5000"
                  />
                </label>
                <label>
                  Username
                  <input
                    autoComplete="off"
                    value={mirrorHelper.username}
                    onChange={(e) => setMirrorHelper({ ...mirrorHelper, username: e.target.value })}
                    placeholder="mirror-user"
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={mirrorHelper.password}
                    onChange={(e) => setMirrorHelper({ ...mirrorHelper, password: e.target.value })}
                    placeholder="••••••••"
                  />
                </label>
                <label>
                  Email (optional)
                  <input
                    value={mirrorHelper.email}
                    onChange={(e) => setMirrorHelper({ ...mirrorHelper, email: e.target.value })}
                    placeholder="ops@example.com"
                  />
                </label>
              </div>
              <label>
                Generated pull secret
                <textarea className="textarea" rows={6} value={generateMirrorPullSecret()} readOnly />
              </label>
              <div className="actions">
                <button
                  className="ghost"
                  onClick={() => navigator.clipboard.writeText(generateMirrorPullSecret())}
                >
                  Copy generated secret
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    if (!mirrorHelper.registry && mirroring.registryFqdn) {
                      setMirrorHelper({ ...mirrorHelper, registry: mirroring.registryFqdn });
                    }
                    const generated = generateMirrorPullSecret();
                    if (generated) {
                      updateState({
                        credentials: {
                          ...state.credentials,
                          mirrorRegistryPullSecret: generated,
                          mirrorRegistryUnauthenticated: false
                        }
                      });
                    }
                    setShowMirrorSecretHelper(false);
                  }}
                >
                  Use generated secret
                </button>
                <button className="ghost" onClick={() => setShowMirrorSecretHelper(false)}>Close</button>
              </div>
            </div>
          </div>
        ) : null}
        {showAwsHelp ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setShowAwsHelp(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>Help me decide</h3>
              <div className="note">Answer these to set publish strategy and credentials mode conservatively.</div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={awsHelp.privateCluster}
                  onChange={(e) => setAwsHelp({ ...awsHelp, privateCluster: e.target.checked })}
                />
                <span>Cluster endpoints must not be publicly reachable</span>
              </label>
              {platform === "Azure Government" ? (
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={awsHelp.splitExposure}
                    onChange={(e) => setAwsHelp({ ...awsHelp, splitExposure: e.target.checked })}
                  />
                  <span>API and ingress require different exposure (Mixed)</span>
                </label>
              ) : null}
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={awsHelp.noAdminCreds}
                  onChange={(e) => setAwsHelp({ ...awsHelp, noAdminCreds: e.target.checked })}
                />
                <span>We cannot store admin-level cloud credentials in-cluster</span>
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={awsHelp.mustUseExistingCreds}
                  onChange={(e) => setAwsHelp({ ...awsHelp, mustUseExistingCreds: e.target.checked })}
                />
                <span>We must use existing credentials as-is (no minting)</span>
              </label>
              <div className="actions">
                <button className="primary" onClick={applyAwsHelp}>Apply recommendations</button>
                <button className="ghost" onClick={() => setShowAwsHelp(false)}>Close</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default GlobalStrategyStep;
