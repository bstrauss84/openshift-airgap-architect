/**
 * Platform-specifics replacement step (segmented flow). Renders sections by scenario: AWS GovCloud (region, AMI, instance types),
 * vSphere (vcenter, failure domains), Azure Government, Nutanix, bare-metal agent options (boot artifacts). Catalog-driven visibility.
 */
import React, { useState, useEffect, useCallback } from "react";
import { useApp } from "../store.jsx";
import { getScenarioId, getParamMeta, getRequiredParamsForOutput, getCatalogForScenario } from "../catalogResolver.js";
import { formatMACAsYouType } from "../formatUtils.js";
import { apiFetch } from "../api.js";
import OptionRow from "../components/OptionRow.jsx";
import Switch from "../components/Switch.jsx";
import Banner from "../components/Banner.jsx";
import Button from "../components/Button.jsx";
import CollapsibleSection from "../components/CollapsibleSection.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";

const AGENT_CONFIG = "agent-config.yaml";
const INSTALL_CONFIG = "install-config.yaml";

/** Archived AWS GovCloud regions when installer metadata is not yet available. */
const AWS_GOVCLOUD_ARCHIVED_REGIONS = ["us-gov-east-1", "us-gov-west-1"];

const hasParam = (catalogParams, path, outputFile) =>
  catalogParams.some((p) => p.path === path && p.outputFile === outputFile);

export default function PlatformSpecificsStep({ highlightErrors }) {
  const { state, updateState } = useApp();
  const scenarioId = getScenarioId(state);
  const inventory = state.hostInventory || {};
  const platformConfig = state.platformConfig || {};
  const platform = state.blueprint?.platform;
  const method = state.methodology?.method;
  const selectedVersion = state.version?.selectedVersion || state.release?.patchVersion || "";
  const arch = state.blueprint?.arch || "x86_64";
  const versionConfirmed = state.version?.versionConfirmed ?? state.release?.confirmed;
  const catalogParams = getCatalogForScenario(scenarioId) || [];
  const showAwsGovcloudSection = catalogParams.some(
    (p) => p.path === "platform.aws.region" && p.outputFile === INSTALL_CONFIG
  );

  const [awsRegions, setAwsRegions] = useState([]);
  const [amiLookup, setAmiLookup] = useState({ loading: false, error: "", key: "" });

  const showAwsAmiLookup =
    showAwsGovcloudSection &&
    Boolean(versionConfirmed) &&
    Boolean(selectedVersion) &&
    Boolean(arch);

  useEffect(() => {
    if (!showAwsAmiLookup) {
      setAwsRegions([]);
      return;
    }
    apiFetch(
      `/api/aws/regions?version=${encodeURIComponent(selectedVersion)}&arch=${encodeURIComponent(arch)}`
    )
      .then((data) => setAwsRegions(data.regions || []))
      .catch(() => setAwsRegions([]));
  }, [showAwsAmiLookup, selectedVersion, arch]);

  const updateInventory = (patch) => updateState({ hostInventory: { ...inventory, ...patch } });
  const updatePlatformConfig = (patch) => updateState({ platformConfig: { ...platformConfig, ...patch } });
  const updateAws = (patch) => updatePlatformConfig({ aws: { ...(platformConfig.aws || {}), ...patch } });
  const updateAzure = (patch) => updatePlatformConfig({ azure: { ...(platformConfig.azure || {}), ...patch } });

  const fetchAmiFromInstaller = useCallback(
    async (region, force = false) => {
      if (!region) return;
      const key = `${selectedVersion}|${arch}|${region}`;
      setAmiLookup((prev) => ({ ...prev, loading: true, error: "", key }));
      try {
        const data = await apiFetch(
          `/api/aws/ami?version=${encodeURIComponent(selectedVersion)}&arch=${encodeURIComponent(arch)}&region=${encodeURIComponent(region)}${force ? "&force=true" : ""}`
        );
        updateAws({ amiId: data.ami, amiAutoFilled: true });
        setAmiLookup((prev) => ({ ...prev, loading: false, error: "", key }));
      } catch (err) {
        setAmiLookup((prev) => ({
          ...prev,
          loading: false,
          error: String(err?.message || err),
          key
        }));
      }
    },
    [selectedVersion, arch, updateAws]
  );

  /** Agent options (boot artifacts etc.) only for bare-metal-agent. */
  const showAgentOptionsSection = scenarioId === "bare-metal-agent" && catalogParams.some(
    (p) => p.path === "bootArtifactsBaseURL" && p.outputFile === AGENT_CONFIG
  );
  const metaBootArtifacts = getParamMeta(scenarioId, "bootArtifactsBaseURL", AGENT_CONFIG);
  const requiredPathsAgent = getRequiredParamsForOutput(scenarioId, AGENT_CONFIG) || [];
  const isRequiredAgent = (path) => requiredPathsAgent.includes(path);
  const metaAwsRegion = getParamMeta(scenarioId, "platform.aws.region", INSTALL_CONFIG);
  const metaAwsHostedZone = getParamMeta(scenarioId, "platform.aws.hostedZone", INSTALL_CONFIG);
  const metaAwsHostedZoneRole = getParamMeta(scenarioId, "platform.aws.hostedZoneRole", INSTALL_CONFIG);
  const metaAwsLbType = getParamMeta(scenarioId, "platform.aws.lbType", INSTALL_CONFIG);
  const metaAwsSubnets = getParamMeta(scenarioId, "platform.aws.subnets", INSTALL_CONFIG);
  const metaAwsAmiID = getParamMeta(scenarioId, "platform.aws.amiID", INSTALL_CONFIG);
  const metaControlPlaneAwsType = getParamMeta(scenarioId, "controlPlane.platform.aws.type", INSTALL_CONFIG);
  const metaComputeAwsType = getParamMeta(scenarioId, "compute[].platform.aws.type", INSTALL_CONFIG);
  const metaPublish = getParamMeta(scenarioId, "publish", INSTALL_CONFIG);
  const metaCredentialsMode = getParamMeta(scenarioId, "credentialsMode", INSTALL_CONFIG);

  /** Azure Government IPI: show when catalog has platform.azure.cloudName. */
  const showAzureGovSection = catalogParams.some(
    (p) => p.path === "platform.azure.cloudName" && p.outputFile === INSTALL_CONFIG
  );
  const metaAzureCloudName = getParamMeta(scenarioId, "platform.azure.cloudName", INSTALL_CONFIG);
  const metaAzureRegion = getParamMeta(scenarioId, "platform.azure.region", INSTALL_CONFIG);
  const metaAzureResourceGroupName = getParamMeta(scenarioId, "platform.azure.resourceGroupName", INSTALL_CONFIG);
  const metaAzureBaseDomainResourceGroupName = getParamMeta(scenarioId, "platform.azure.baseDomainResourceGroupName", INSTALL_CONFIG);

  /** Nutanix IPI: show when catalog has platform.nutanix params. */
  const showNutanixIpiSection = catalogParams.some(
    (p) => (p.path === "platform.nutanix.prismCentral" || p.path === "platform.nutanix.subnet") && p.outputFile === INSTALL_CONFIG
  );
  const updateNutanix = (patch) => updatePlatformConfig({ nutanix: { ...(platformConfig.nutanix || {}), ...patch } });
  const metaNutanixEndpoint = getParamMeta(scenarioId, "platform.nutanix.prismCentral.endpoint", INSTALL_CONFIG);
  const metaNutanixPort = getParamMeta(scenarioId, "platform.nutanix.prismCentral.port", INSTALL_CONFIG);
  const metaNutanixUsername = getParamMeta(scenarioId, "platform.nutanix.prismCentral.username", INSTALL_CONFIG);
  const metaNutanixPassword = getParamMeta(scenarioId, "platform.nutanix.prismCentral.password", INSTALL_CONFIG);
  const metaNutanixSubnet = getParamMeta(scenarioId, "platform.nutanix.subnet", INSTALL_CONFIG);
  const metaNutanixClusterName = getParamMeta(scenarioId, "platform.nutanix.clusterName", INSTALL_CONFIG);

  /** vSphere IPI/UPI: show when catalog has platform.vsphere params. */
  const showVsphereIpiSection = catalogParams.some(
    (p) => p.path === "platform.vsphere.vcenter" && p.outputFile === INSTALL_CONFIG
  );
  const showFailureDomainsSection = showVsphereIpiSection && catalogParams.some(
    (p) => p.path === "platform.vsphere.failureDomains" && p.outputFile === INSTALL_CONFIG
  );
  const metaVsphereVcenter = getParamMeta(scenarioId, "platform.vsphere.vcenter", INSTALL_CONFIG);
  const metaVsphereDatacenter = getParamMeta(scenarioId, "platform.vsphere.datacenter", INSTALL_CONFIG);
  const metaVsphereDefaultDatastore = getParamMeta(scenarioId, "platform.vsphere.defaultDatastore", INSTALL_CONFIG);
  const requiredPathsInstall = getRequiredParamsForOutput(scenarioId, INSTALL_CONFIG) || [];
  const isRequiredInstall = (path) => requiredPathsInstall.includes(path);

  const failureDomains = Array.isArray(platformConfig.vsphere?.failureDomains) ? platformConfig.vsphere.failureDomains : [];
  const setFailureDomains = (next) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, failureDomains: next } });
  const addFailureDomain = () => setFailureDomains([...failureDomains, { name: `fd-${failureDomains.length}`, region: "", zone: "", server: "", topology: { computeCluster: "", datacenter: "", datastore: "", networks: [], folder: "", resourcePool: "" } }]);
  const removeFailureDomain = (index) => setFailureDomains(failureDomains.filter((_, i) => i !== index));
  const updateFailureDomain = (index, patch) => setFailureDomains(failureDomains.map((fd, i) => (i === index ? { ...fd, ...patch } : fd)));
  const updateFailureDomainTopology = (index, topPatch) => setFailureDomains(failureDomains.map((fd, i) => (i === index ? { ...fd, topology: { ...(fd.topology || {}), ...topPatch } } : fd)));

  /** Provisioning network section is IPI-only (installer-provisioned). UPI does not use installer-managed provisioning network; do not show for bare-metal-upi or bare-metal-agent. */
  const showProvisioningNetworkSection = scenarioId === "bare-metal-ipi" && catalogParams.some(
    (p) => p.path === "platform.baremetal.provisioningNetwork" && p.outputFile === INSTALL_CONFIG
  );
  const metaProvisioningNetwork = getParamMeta(scenarioId, "platform.baremetal.provisioningNetwork", INSTALL_CONFIG);
  const metaProvisioningCIDR = getParamMeta(scenarioId, "platform.baremetal.provisioningNetworkCIDR", INSTALL_CONFIG);
  const metaProvisioningInterface = getParamMeta(scenarioId, "platform.baremetal.provisioningNetworkInterface", INSTALL_CONFIG);
  const metaProvisioningDHCPRange = getParamMeta(scenarioId, "platform.baremetal.provisioningDHCPRange", INSTALL_CONFIG);
  const metaClusterProvisioningIP = getParamMeta(scenarioId, "platform.baremetal.clusterProvisioningIP", INSTALL_CONFIG);
  const metaProvisioningMAC = getParamMeta(scenarioId, "platform.baremetal.provisioningMACAddress", INSTALL_CONFIG);

  const provisioningNetworkOptions = Array.isArray(metaProvisioningNetwork?.allowed)
    ? metaProvisioningNetwork.allowed
    : ["Managed", "Unmanaged", "Disabled"];

  /** Advanced (gap remediation): show only when catalog has any of these params for this scenario. */
  const showComputeHyperthreading = hasParam(catalogParams, "compute[].hyperthreading", INSTALL_CONFIG);
  const showControlPlaneHyperthreading = hasParam(catalogParams, "controlPlane[].hyperthreading", INSTALL_CONFIG);
  const showCapabilities = hasParam(catalogParams, "capabilities.baselineCapabilitySet", INSTALL_CONFIG) || hasParam(catalogParams, "capabilities.additionalEnabledCapabilities", INSTALL_CONFIG);
  const showCpuPartitioningMode = hasParam(catalogParams, "cpuPartitioningMode", INSTALL_CONFIG);
  const showMinimalISO = scenarioId === "bare-metal-agent" && hasParam(catalogParams, "minimalISO", AGENT_CONFIG);
  const showAdvancedSection = showComputeHyperthreading || showControlPlaneHyperthreading || showCapabilities || showCpuPartitioningMode || showMinimalISO || showAgentOptionsSection;

  const metaComputeHyperthreading = getParamMeta(scenarioId, "compute[].hyperthreading", INSTALL_CONFIG);
  const metaControlPlaneHyperthreading = getParamMeta(scenarioId, "controlPlane[].hyperthreading", INSTALL_CONFIG);
  const metaBaselineCapability = getParamMeta(scenarioId, "capabilities.baselineCapabilitySet", INSTALL_CONFIG);
  const metaAdditionalCapabilities = getParamMeta(scenarioId, "capabilities.additionalEnabledCapabilities", INSTALL_CONFIG);
  const metaCpuPartitioningMode = getParamMeta(scenarioId, "cpuPartitioningMode", INSTALL_CONFIG);
  const metaMinimalISO = getParamMeta(scenarioId, "minimalISO", AGENT_CONFIG);

  const hyperthreadingOptions = ["Enabled", "Disabled"];
  const baselineCapabilityOptions = Array.isArray(metaBaselineCapability?.allowed) ? metaBaselineCapability.allowed : ["None", "v4.11", "v4.12", "vCurrent"];
  const cpuPartitioningOptions = Array.isArray(metaCpuPartitioningMode?.allowed) ? metaCpuPartitioningMode.allowed : ["None", "AllNodes"];

  return (
    <div className="step platform-specifics">
      <div className="step-header sticky">
        <div className="step-header-main">
          <h2>Platform Specifics</h2>
          <p className="subtle">Cluster-level platform and agent options for this scenario.</p>
        </div>
      </div>

      <div className="step-body">
        {state.reviewFlags?.["platform-specifics"] && state.ui?.visitedSteps?.["platform-specifics"] ? (
          <Banner variant="warning">
            Version or upstream selections changed. Review this page to ensure settings are still valid.
            <div className="actions">
              <Button variant="secondary" onClick={() => updateState({ reviewFlags: { ...state.reviewFlags, "platform-specifics": false } })}>
                Re-evaluate this page
              </Button>
            </div>
          </Banner>
        ) : null}
        {showAwsGovcloudSection && (
          <section className="card">
            <div className="card-header">
              <h3 className="card-title">AWS GovCloud {scenarioId === "aws-govcloud-upi" ? "UPI" : "IPI"}</h3>
              <div className="card-subtitle">Region, optional Route 53, VPC/subnets, instance types, and cluster publish/credentials options.</div>
            </div>
            <div className="card-body">
              {!versionConfirmed && (
                <div className="note warning platform-specifics-ami-hint">
                  Confirm the release version in Blueprint to unlock region list and RHCOS AMI auto-discovery.
                </div>
              )}
              <div className="field-grid" style={{ marginTop: 12 }}>
                <FieldLabelWithInfo
                  label="AWS GovCloud region"
                  hint={metaAwsRegion?.description}
                  required={metaAwsRegion?.required || isRequiredInstall("platform.aws.region")}
                >
                  {(() => {
                    const regionsForDropdown = awsRegions.length > 0 ? awsRegions : AWS_GOVCLOUD_ARCHIVED_REGIONS;
                    return (
                      <select
                        value={platformConfig.aws?.region || ""}
                        onChange={(e) => updateAws({ region: e.target.value })}
                      >
                        <option value="">Select a region</option>
                        {regionsForDropdown.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    );
                  })()}
                </FieldLabelWithInfo>
                {showAwsAmiLookup && awsRegions.length === 0 && (
                  <div className="note subtle">Using archived region list. Installer metadata will replace this when the background download completes.</div>
                )}
                {showAwsAmiLookup && awsRegions.length > 0 && (
                  <div className="note subtle">Regions from installer stream metadata.</div>
                )}
                <FieldLabelWithInfo
                  label="Hosted zone ID (optional; omit if not using Route 53)"
                  hint={metaAwsHostedZone?.description || "Route 53 hosted zone for base domain."}
                >
                  <input
                    value={platformConfig.aws?.hostedZone || ""}
                    onChange={(e) => updateAws({ hostedZone: e.target.value })}
                    placeholder="Z1234567890"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Hosted zone role ARN (optional; cross-account)"
                  hint={metaAwsHostedZoneRole?.description || "IAM role for hosted zone in another account."}
                >
                  <input
                    value={platformConfig.aws?.hostedZoneRole || ""}
                    onChange={(e) => updateAws({ hostedZoneRole: e.target.value })}
                    placeholder="arn:aws-us-gov:iam::123:role/HostedZoneRole"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Load balancer type (optional)"
                  hint={metaAwsLbType?.description || "AWS load balancer type for default ingress and API."}
                >
                  <select
                    value={platformConfig.aws?.lbType || ""}
                    onChange={(e) => updateAws({ lbType: e.target.value })}
                  >
                    <option value="" disabled>Not set</option>
                    <option value="Classic">Classic</option>
                    <option value="NLB">NLB</option>
                  </select>
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Subnets (optional; comma-separated for existing VPC)"
                  hint={metaAwsSubnets?.description || "Existing VPC subnet IDs when not using installer-provisioned VPC."}
                >
                  <input
                    value={platformConfig.aws?.subnets || ""}
                    onChange={(e) => updateAws({ subnets: e.target.value })}
                    placeholder="subnet-abc,subnet-def"
                  />
                </FieldLabelWithInfo>
                <div className="platform-specifics-ami-row">
                  <label className="platform-specifics-ami-label">
                    <FieldLabelWithInfo
                      label="RHCOS AMI ID (optional; gov/secret regions)"
                      hint={metaAwsAmiID?.description || 'Click "Refresh from installer" to fetch the recommended AMI for the selected region. Your value is never overwritten unless you click Refresh.'}
                    />
                  </label>
                  <div className="platform-specifics-ami-input-wrap">
                    <input
                      className="platform-specifics-ami-input"
                      value={platformConfig.aws?.amiId || ""}
                      onChange={(e) => updateAws({ amiId: e.target.value, amiAutoFilled: false })}
                      placeholder={platformConfig.aws?.region ? "ami-xxxxxxxx" : "Select region first"}
                      disabled={amiLookup.loading}
                    />
                    {platformConfig.aws?.amiAutoFilled && platformConfig.aws?.amiId && !amiLookup.loading && (
                      <span className="platform-specifics-ami-badge" title="Filled from installer stream metadata">Auto-filled</span>
                    )}
                    {amiLookup.loading && (
                      <span className="platform-specifics-ami-loading" aria-hidden>Loading…</span>
                    )}
                    <button
                      type="button"
                      className="ghost platform-specifics-ami-refresh"
                      disabled={!showAwsAmiLookup || !platformConfig.aws?.region || amiLookup.loading}
                      onClick={() => fetchAmiFromInstaller(platformConfig.aws?.region, true)}
                      title="Fetch recommended AMI from installer metadata"
                    >
                      {amiLookup.loading ? "Looking up…" : "Refresh from installer"}
                    </button>
                  </div>
                  {amiLookup.error ? (
                    <div className="note warning platform-specifics-ami-error">{amiLookup.error}</div>
                  ) : null}
                </div>
                {scenarioId === "aws-govcloud-ipi" && (
                  <>
                    <FieldLabelWithInfo
                      label="Control plane instance type (optional; IPI)"
                      hint={metaControlPlaneAwsType?.description || "EC2 instance type for control plane."}
                    >
                      <input
                        value={platformConfig.aws?.controlPlaneInstanceType || ""}
                        onChange={(e) => updateAws({ controlPlaneInstanceType: e.target.value })}
                        placeholder="e.g. m5.xlarge"
                      />
                    </FieldLabelWithInfo>
                    <FieldLabelWithInfo
                      label="Worker instance type (optional; IPI)"
                      hint={metaComputeAwsType?.description || "EC2 instance type for compute."}
                    >
                      <input
                        value={platformConfig.aws?.workerInstanceType || ""}
                        onChange={(e) => updateAws({ workerInstanceType: e.target.value })}
                        placeholder="e.g. m5.large"
                      />
                    </FieldLabelWithInfo>
                  </>
                )}
                <FieldLabelWithInfo
                  label="Publish (optional)"
                  hint={metaPublish?.description || "How to publish API and ingress endpoints."}
                >
                  <select
                    value={platformConfig.publish || metaPublish?.default || "External"}
                    onChange={(e) => updatePlatformConfig({ publish: e.target.value })}
                  >
                    <option value="External">External</option>
                    <option value="Internal">Internal</option>
                  </select>
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Credentials mode (optional)"
                  hint={metaCredentialsMode?.description || "Cloud Credential Operator mode."}
                >
                  <select
                    value={platformConfig.credentialsMode || ""}
                    onChange={(e) => updatePlatformConfig({ credentialsMode: e.target.value })}
                  >
                    <option value="" disabled>Not set</option>
                    <option value="Mint">Mint</option>
                    <option value="Passthrough">Passthrough</option>
                    <option value="Manual">Manual</option>
                  </select>
                </FieldLabelWithInfo>
              </div>
            </div>
          </section>
        )}

        {showAzureGovSection && (
          <section className="card">
            <div className="card-header">
              <h3 className="card-title">Azure Government IPI</h3>
              <div className="card-subtitle">Cloud name, region, resource groups, and cluster publish/credentials options for Azure Government.</div>
            </div>
            <div className="card-body">
              <div className="field-grid" style={{ marginTop: 12 }}>
                <FieldLabelWithInfo
                  label="Cloud name"
                  hint={metaAzureCloudName?.description}
                  required={metaAzureCloudName?.required || isRequiredInstall("platform.azure.cloudName")}
                >
                  <select
                    value={platformConfig.azure?.cloudName || metaAzureCloudName?.default || "AzureUSGovernmentCloud"}
                    onChange={(e) => updateAzure({ cloudName: e.target.value })}
                  >
                    {Array.isArray(metaAzureCloudName?.allowed)
                      ? metaAzureCloudName.allowed.map((v) => <option key={v} value={v}>{v}</option>)
                      : <option value="AzureUSGovernmentCloud">AzureUSGovernmentCloud</option>}
                  </select>
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Region"
                  hint={metaAzureRegion?.description}
                  required={metaAzureRegion?.required || isRequiredInstall("platform.azure.region")}
                >
                  <input
                    value={platformConfig.azure?.region || ""}
                    onChange={(e) => updateAzure({ region: e.target.value })}
                    placeholder="e.g. usgovvirginia"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Resource group name"
                  hint={metaAzureResourceGroupName?.description}
                  required={metaAzureResourceGroupName?.required || isRequiredInstall("platform.azure.resourceGroupName")}
                >
                  <input
                    value={platformConfig.azure?.resourceGroupName || ""}
                    onChange={(e) => updateAzure({ resourceGroupName: e.target.value })}
                    placeholder="Existing resource group for cluster"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Base domain resource group"
                  hint={metaAzureBaseDomainResourceGroupName?.description}
                  required={metaAzureBaseDomainResourceGroupName?.required || isRequiredInstall("platform.azure.baseDomainResourceGroupName")}
                >
                  <input
                    value={platformConfig.azure?.baseDomainResourceGroupName || ""}
                    onChange={(e) => updateAzure({ baseDomainResourceGroupName: e.target.value })}
                    placeholder="Resource group containing DNS zone for base domain"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Publish (optional)"
                  hint={metaPublish?.description || "How to publish API and ingress endpoints."}
                >
                  <select
                    value={platformConfig.publish || metaPublish?.default || "External"}
                    onChange={(e) => updatePlatformConfig({ publish: e.target.value })}
                  >
                    <option value="External">External</option>
                    <option value="Internal">Internal</option>
                  </select>
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Credentials mode (optional)"
                  hint={metaCredentialsMode?.description || "Cloud Credential Operator mode."}
                >
                  <select
                    value={platformConfig.credentialsMode || ""}
                    onChange={(e) => updatePlatformConfig({ credentialsMode: e.target.value })}
                  >
                    <option value="" disabled>Not set</option>
                    <option value="Mint">Mint</option>
                    <option value="Passthrough">Passthrough</option>
                    <option value="Manual">Manual</option>
                  </select>
                </FieldLabelWithInfo>
              </div>
            </div>
          </section>
        )}

        {showNutanixIpiSection && (
          <section className="card">
            <div className="card-header">
              <h3 className="card-title">Nutanix IPI</h3>
              <div className="card-subtitle">Prism Central endpoint, subnet, and optional cluster name for installer-provisioned infrastructure.</div>
            </div>
            <div className="card-body">
              <div className="field-grid" style={{ marginTop: 12 }}>
                <FieldLabelWithInfo
                  label="Prism Central endpoint"
                  hint={metaNutanixEndpoint?.description}
                  required={metaNutanixEndpoint?.required || isRequiredInstall("platform.nutanix.prismCentral.endpoint")}
                >
                  <input
                    value={platformConfig.nutanix?.endpoint || ""}
                    onChange={(e) => updateNutanix({ endpoint: e.target.value })}
                    placeholder="prism.example.com"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Prism Central port (optional; default 9440)"
                  hint={metaNutanixPort?.description || "API port."}
                >
                  <input
                    type="number"
                    value={platformConfig.nutanix?.port ?? ""}
                    onChange={(e) => updateNutanix({ port: e.target.value || undefined })}
                    placeholder="9440"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Prism Central username (optional; emitted when including credentials)"
                  hint={metaNutanixUsername?.description}
                >
                  <input
                    value={platformConfig.nutanix?.username || ""}
                    onChange={(e) => updateNutanix({ username: e.target.value })}
                    placeholder="admin"
                  />
                </FieldLabelWithInfo>
                <label>
                  <span>Prism Central password <span className="subtle">(optional; emitted when including credentials)</span></span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={platformConfig.nutanix?.password || ""}
                    onChange={(e) => updateNutanix({ password: e.target.value })}
                    placeholder="••••••••"
                  />
                </label>
                <FieldLabelWithInfo
                  label="Subnet UUID or name"
                  hint={metaNutanixSubnet?.description}
                  required={metaNutanixSubnet?.required || isRequiredInstall("platform.nutanix.subnet")}
                >
                  <input
                    value={platformConfig.nutanix?.subnet || ""}
                    onChange={(e) => updateNutanix({ subnet: e.target.value })}
                    placeholder="Subnet UUID or name"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Cluster name (optional; Prism Element for VM placement)"
                  hint={metaNutanixClusterName?.description || "Optional Nutanix cluster name."}
                >
                  <input
                    value={platformConfig.nutanix?.cluster || ""}
                    onChange={(e) => updateNutanix({ cluster: e.target.value })}
                    placeholder="Optional cluster name"
                  />
                </FieldLabelWithInfo>
              </div>
            </div>
          </section>
        )}

        {showVsphereIpiSection && (
          <section className="card">
            <div className="card-header">
              <h3 className="card-title">vSphere {scenarioId === "vsphere-upi" ? "UPI" : "IPI"}</h3>
              <div className="card-subtitle">vCenter and datacenter settings for vSphere (installer-provisioned or user-provisioned).</div>
            </div>
            <div className="card-body">
              <div className="field-grid" style={{ marginTop: 12 }}>
                <FieldLabelWithInfo
                  label="vCenter server"
                  hint={metaVsphereVcenter?.description}
                  required={metaVsphereVcenter?.required || isRequiredInstall("platform.vsphere.vcenter")}
                >
                  <input
                    value={platformConfig.vsphere?.vcenter || ""}
                    onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, vcenter: e.target.value } })}
                    placeholder="vcenter.example.com"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Datacenter"
                  hint={metaVsphereDatacenter?.description}
                  required={metaVsphereDatacenter?.required || isRequiredInstall("platform.vsphere.datacenter")}
                >
                  <input
                    value={platformConfig.vsphere?.datacenter || ""}
                    onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, datacenter: e.target.value } })}
                    placeholder="Datacenter name"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Default datastore"
                  hint={metaVsphereDefaultDatastore?.description}
                  required={metaVsphereDefaultDatastore?.required || isRequiredInstall("platform.vsphere.defaultDatastore")}
                >
                  <input
                    value={platformConfig.vsphere?.datastore || ""}
                    onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, datastore: e.target.value } })}
                    placeholder="Datastore name"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Compute cluster (optional; required for failureDomains)"
                  hint="vSphere compute cluster name; used in failureDomains topology."
                >
                  <input
                    value={platformConfig.vsphere?.cluster || ""}
                    onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, cluster: e.target.value } })}
                    placeholder="e.g. Cluster1"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="VM network (optional; required for failureDomains)"
                  hint="VM network name; used in failureDomains topology.networks."
                >
                  <input
                    value={platformConfig.vsphere?.network || ""}
                    onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, network: e.target.value } })}
                    placeholder="e.g. VM Network"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Folder (optional)"
                  hint="vSphere VM folder path for cluster VMs."
                >
                  <input
                    value={platformConfig.vsphere?.folder || ""}
                    onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, folder: e.target.value } })}
                    placeholder="VM folder path"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Resource pool (optional)"
                  hint="vSphere resource pool path for cluster VMs."
                >
                  <input
                    value={platformConfig.vsphere?.resourcePool || ""}
                    onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, resourcePool: e.target.value } })}
                    placeholder="Resource pool path"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="vCenter username (optional)"
                  hint="Only included in generated install-config when storing credentials."
                >
                  <input
                    value={platformConfig.vsphere?.username || ""}
                    onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, username: e.target.value } })}
                    placeholder="administrator@vsphere.local"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="vCenter password (optional)"
                  hint="Only included in generated install-config when storing credentials."
                >
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={platformConfig.vsphere?.password || ""}
                    onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, password: e.target.value } })}
                    placeholder="••••••••"
                  />
                </FieldLabelWithInfo>
              </div>

              {showFailureDomainsSection && (
                <div style={{ marginTop: 24 }}>
                  <h4 className="card-title" style={{ marginBottom: 8 }}>Failure domains</h4>
                  <p className="note subtle">Optionally define multiple failure domains. If you add any, they are used for install-config instead of the single vCenter/datacenter fields above.</p>
                  <button type="button" className="ghost" onClick={addFailureDomain} style={{ marginBottom: 12 }}>Add failure domain</button>
                  {failureDomains.map((fd, index) => (
                    <div key={index} className="card" style={{ marginBottom: 16, padding: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <strong>Failure domain {index + 1}</strong>
                        <button type="button" className="ghost" onClick={() => removeFailureDomain(index)} aria-label={`Remove failure domain ${index + 1}`}>Remove</button>
                      </div>
                      <div className="field-grid" style={{ marginTop: 8 }}>
                        <label>
                          <FieldLabelWithInfo label="Name" hint="Failure domain name (e.g. fd-0)." />
                          <input value={fd.name || ""} onChange={(e) => updateFailureDomain(index, { name: e.target.value })} placeholder="e.g. fd-0" />
                        </label>
                        <label>
                          <FieldLabelWithInfo label="Region" hint="Region (e.g. datacenter or openshift-region tag)." />
                          <input value={fd.region || ""} onChange={(e) => updateFailureDomain(index, { region: e.target.value })} placeholder="e.g. datacenter or openshift-region tag" />
                        </label>
                        <label>
                          <FieldLabelWithInfo label="Zone" hint="Zone (e.g. cluster or openshift-zone tag)." />
                          <input value={fd.zone || ""} onChange={(e) => updateFailureDomain(index, { zone: e.target.value })} placeholder="e.g. cluster or openshift-zone tag" />
                        </label>
                        <label>
                          <FieldLabelWithInfo label="Server (vCenter FQDN or IP)" hint="vCenter server for this failure domain." />
                          <input value={fd.server || ""} onChange={(e) => updateFailureDomain(index, { server: e.target.value })} placeholder="vcenter.example.com" />
                        </label>
                        <label>
                          <FieldLabelWithInfo label="Topology: Datacenter" hint="Datacenter name in failure domain topology." />
                          <input value={fd.topology?.datacenter || ""} onChange={(e) => updateFailureDomainTopology(index, { datacenter: e.target.value })} placeholder="Datacenter name" />
                        </label>
                        <label>
                          <FieldLabelWithInfo label="Topology: Compute cluster" hint="Compute cluster name in failure domain topology." />
                          <input value={fd.topology?.computeCluster || ""} onChange={(e) => updateFailureDomainTopology(index, { computeCluster: e.target.value })} placeholder="e.g. Cluster1" />
                        </label>
                        <label>
                          <FieldLabelWithInfo label="Topology: Datastore" hint="Datastore path in failure domain topology." />
                          <input value={fd.topology?.datastore || ""} onChange={(e) => updateFailureDomainTopology(index, { datastore: e.target.value })} placeholder="Datastore path" />
                        </label>
                        <label>
                          <FieldLabelWithInfo label="Topology: Networks (comma-separated)" hint="VM network names used in this failure domain." />
                          <input value={Array.isArray(fd.topology?.networks) ? fd.topology.networks.join(", ") : (fd.topology?.networks || "")} onChange={(e) => updateFailureDomainTopology(index, { networks: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="e.g. VM Network, DPG-1" />
                        </label>
                        <label>
                          <FieldLabelWithInfo label="Topology: Folder (optional)" hint="VM folder path in failure domain topology." />
                          <input value={fd.topology?.folder || ""} onChange={(e) => updateFailureDomainTopology(index, { folder: e.target.value })} placeholder="/datacenter/vm/folder" />
                        </label>
                        <label>
                          <FieldLabelWithInfo label="Topology: Resource pool (optional)" hint="Resource pool path in failure domain topology." />
                          <input value={fd.topology?.resourcePool || ""} onChange={(e) => updateFailureDomainTopology(index, { resourcePool: e.target.value })} placeholder="/datacenter/host/cluster/Resources/pool" />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {showProvisioningNetworkSection && (
          <section className="card">
            <div className="card-header">
              <h3 className="card-title">Bare metal IPI — Provisioning network</h3>
              <div className="card-subtitle">Provisioning network mode and options for installer-provisioned bare metal.</div>
            </div>
            <div className="card-body">
              <p className="note subtle">Configure how the provisioning network is used during installation. Hosts (BMC, boot MAC) are configured on the Hosts / Inventory step.</p>
              <div className="field-grid" style={{ marginTop: 12 }}>
                <label>
                  <FieldLabelWithInfo
                    label="Provisioning network"
                    hint={metaProvisioningNetwork?.description}
                    required={metaProvisioningNetwork?.required}
                  />
                  <select
                    value={inventory.provisioningNetwork || (metaProvisioningNetwork?.default ?? "Managed")}
                    onChange={(e) => updateInventory({ provisioningNetwork: e.target.value })}
                  >
                    {provisioningNetworkOptions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <FieldLabelWithInfo
                    label="Provisioning network CIDR (optional)"
                    hint={metaProvisioningCIDR?.description}
                  />
                  <input
                    value={inventory.provisioningNetworkCIDR || ""}
                    onChange={(e) => updateInventory({ provisioningNetworkCIDR: e.target.value.trim() })}
                    placeholder="e.g. 172.22.0.0/24"
                  />
                </label>
                <label>
                  <FieldLabelWithInfo
                    label="Provisioning network interface (optional)"
                    hint={metaProvisioningInterface?.description}
                  />
                  <input
                    value={inventory.provisioningNetworkInterface || ""}
                    onChange={(e) => updateInventory({ provisioningNetworkInterface: e.target.value })}
                    placeholder="e.g. eth1"
                  />
                </label>
                <label>
                  <FieldLabelWithInfo
                    label="Provisioning DHCP range (optional)"
                    hint={metaProvisioningDHCPRange?.description}
                  />
                  <input
                    value={inventory.provisioningDHCPRange || ""}
                    onChange={(e) => updateInventory({ provisioningDHCPRange: e.target.value })}
                    placeholder="e.g. 172.22.0.10,172.22.0.254"
                  />
                </label>
                <label>
                  <FieldLabelWithInfo
                    label="Cluster provisioning IP (optional)"
                    hint={metaClusterProvisioningIP?.description}
                  />
                  <input
                    value={inventory.clusterProvisioningIP || ""}
                    onChange={(e) => updateInventory({ clusterProvisioningIP: e.target.value.trim() })}
                    placeholder="IP within provisioning subnet"
                  />
                </label>
                <label>
                  <FieldLabelWithInfo
                    label="Provisioning MAC address (optional)"
                    hint={metaProvisioningMAC?.description}
                  />
                  <input
                    value={inventory.provisioningMACAddress || ""}
                    onChange={(e) => updateInventory({ provisioningMACAddress: formatMACAsYouType(e.target.value) })}
                    placeholder="MAC where provisioning services run"
                  />
                </label>
              </div>
            </div>
          </section>
        )}

        {showAdvancedSection && (
          <CollapsibleSection
            title="Advanced"
            subtitle={`${showAgentOptionsSection ? "Agent boot artifacts, " : ""}Hyperthreading, capabilities, CPU partitioning, minimal ISO (catalog-driven).`}
            defaultCollapsed={true}
          >
                <div className="field-grid" style={{ marginTop: 12 }}>
                  {showAgentOptionsSection && (
                    <label>
                      <FieldLabelWithInfo
                        label="Boot artifacts base URL"
                        hint={metaBootArtifacts?.description}
                        required={metaBootArtifacts?.required || isRequiredAgent("bootArtifactsBaseURL")}
                      />
                      <input
                        value={inventory.bootArtifactsBaseURL || ""}
                        onChange={(e) => updateInventory({ bootArtifactsBaseURL: e.target.value })}
                        placeholder="https://example.com/agent-artifacts or leave empty"
                      />
                    </label>
                  )}
                  {showComputeHyperthreading && (
                    <label>
                      <FieldLabelWithInfo
                        label="Compute hyperthreading (optional)"
                        hint={metaComputeHyperthreading?.description}
                      />
                      <select
                        value={platformConfig.computeHyperthreading || ""}
                        onChange={(e) => updatePlatformConfig({ computeHyperthreading: e.target.value || undefined })}
                      >
                        <option value="" disabled>Not set</option>
                        {hyperthreadingOptions.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {showControlPlaneHyperthreading && (
                    <label>
                      <FieldLabelWithInfo
                        label="Control plane hyperthreading (optional)"
                        hint={metaControlPlaneHyperthreading?.description}
                      />
                      <select
                        value={platformConfig.controlPlaneHyperthreading || ""}
                        onChange={(e) => updatePlatformConfig({ controlPlaneHyperthreading: e.target.value || undefined })}
                      >
                        <option value="" disabled>Not set</option>
                        {hyperthreadingOptions.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {showCapabilities && (
                    <>
                      <label>
                        <FieldLabelWithInfo
                          label="Baseline capability set (optional)"
                          hint={metaBaselineCapability?.description}
                        />
                        <select
                          value={platformConfig.baselineCapabilitySet || (metaBaselineCapability?.default ?? "")}
                          onChange={(e) => updatePlatformConfig({ baselineCapabilitySet: e.target.value || undefined })}
                        >
                          <option value="" disabled>Not set</option>
                          {baselineCapabilityOptions.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <FieldLabelWithInfo
                          label="Additional enabled capabilities (optional, comma-separated)"
                          hint={metaAdditionalCapabilities?.description}
                        />
                        <input
                          value={Array.isArray(platformConfig.additionalEnabledCapabilities) ? platformConfig.additionalEnabledCapabilities.join(", ") : (typeof platformConfig.additionalEnabledCapabilities === "string" ? platformConfig.additionalEnabledCapabilities : "")}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            const arr = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
                            updatePlatformConfig({ additionalEnabledCapabilities: arr });
                          }}
                          placeholder="e.g. baremetal, marketplace"
                        />
                      </label>
                    </>
                  )}
                  {showCpuPartitioningMode && (
                    <label>
                      <FieldLabelWithInfo
                        label="CPU partitioning mode (optional)"
                        hint={metaCpuPartitioningMode?.description}
                      />
                      <select
                        value={platformConfig.cpuPartitioningMode || (metaCpuPartitioningMode?.default ?? "None")}
                        onChange={(e) => updatePlatformConfig({ cpuPartitioningMode: e.target.value || undefined })}
                      >
                        <option value="" disabled>Not set</option>
                        {cpuPartitioningOptions.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {showMinimalISO && (
                    <OptionRow
                      title="Use minimal ISO"
                      description="No rootfs; pull from boot artifacts URL. Optional for agent-based install."
                      note={metaMinimalISO?.description ? undefined : undefined}
                    >
                      <Switch
                        checked={inventory.minimalISO === true}
                        onChange={(checked) => updateInventory({ minimalISO: checked })}
                        aria-label="Use minimal ISO"
                      />
                    </OptionRow>
                  )}
                </div>
          </CollapsibleSection>
        )}

        {scenarioId && !showAgentOptionsSection && !showProvisioningNetworkSection && !showAdvancedSection && !showVsphereIpiSection && (
          <section className="card">
            <div className="card-body">
              <p className="note">
                {scenarioId === "bare-metal-upi"
                  ? "Bare metal UPI: API and Ingress VIPs are configured on the Networking step. No installer-managed provisioning network or host list for this methodology."
                  : "No platform-specific options for this scenario yet."}
              </p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
