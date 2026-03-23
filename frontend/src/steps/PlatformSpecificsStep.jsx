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
import { AWS_SUBNET_ROLES_ALLOWED } from "../validation.js";

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
  const [showVspherePassword, setShowVspherePassword] = useState(false);
  const [showNutanixPassword, setShowNutanixPassword] = useState(false);

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
  const updateIbmCloud = (patch) => updatePlatformConfig({ ibmcloud: { ...(platformConfig.ibmcloud || {}), ...patch } });

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

  /** Agent options (boot artifacts etc.) for agent-based scenarios that expose agent-config params in catalog. */
  const showAgentOptionsSection = (scenarioId === "bare-metal-agent" || scenarioId === "vsphere-agent") && catalogParams.some(
    (p) => p.path === "bootArtifactsBaseURL" && p.outputFile === AGENT_CONFIG
  );
  const metaBootArtifacts = getParamMeta(scenarioId, "bootArtifactsBaseURL", AGENT_CONFIG);
  const requiredPathsAgent = getRequiredParamsForOutput(scenarioId, AGENT_CONFIG) || [];
  const isRequiredAgent = (path) => requiredPathsAgent.includes(path);
  const metaAwsRegion = getParamMeta(scenarioId, "platform.aws.region", INSTALL_CONFIG);
  const metaAwsHostedZone = getParamMeta(scenarioId, "platform.aws.hostedZone", INSTALL_CONFIG);
  const metaAwsHostedZoneRole = getParamMeta(scenarioId, "platform.aws.hostedZoneRole", INSTALL_CONFIG);
  const metaAwsLbType = getParamMeta(scenarioId, "platform.aws.lbType", INSTALL_CONFIG);
  const metaAwsSubnets = getParamMeta(scenarioId, "platform.aws.vpc.subnets", INSTALL_CONFIG);
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

  /** IBM Cloud IPI: show when catalog has platform.ibmcloud.region. */
  const showIbmCloudSection = catalogParams.some(
    (p) => p.path === "platform.ibmcloud.region" && p.outputFile === INSTALL_CONFIG
  );
  const metaIbmRegion = getParamMeta(scenarioId, "platform.ibmcloud.region", INSTALL_CONFIG);
  const metaIbmResourceGroupName = getParamMeta(scenarioId, "platform.ibmcloud.resourceGroupName", INSTALL_CONFIG);
  const metaIbmNetworkResourceGroupName = getParamMeta(scenarioId, "platform.ibmcloud.networkResourceGroupName", INSTALL_CONFIG);
  const metaIbmVpcName = getParamMeta(scenarioId, "platform.ibmcloud.vpcName", INSTALL_CONFIG);
  const metaIbmControlPlaneSubnets = getParamMeta(scenarioId, "platform.ibmcloud.controlPlaneSubnets", INSTALL_CONFIG);
  const metaIbmComputeSubnets = getParamMeta(scenarioId, "platform.ibmcloud.computeSubnets", INSTALL_CONFIG);
  const metaIbmServiceEndpoints = getParamMeta(scenarioId, "platform.ibmcloud.serviceEndpoints", INSTALL_CONFIG);
  const metaIbmType = getParamMeta(scenarioId, "platform.ibmcloud.type", INSTALL_CONFIG);
  const metaIbmDedicatedHostsProfile = getParamMeta(scenarioId, "platform.ibmcloud.dedicatedHosts.profile", INSTALL_CONFIG);
  const metaIbmDedicatedHostsName = getParamMeta(scenarioId, "platform.ibmcloud.dedicatedHosts.name", INSTALL_CONFIG);
  const metaIbmDefaultMachineBootVolumeKey = getParamMeta(
    scenarioId,
    "platform.ibmcloud.defaultMachinePlatform.bootVolume.encryptionKey",
    INSTALL_CONFIG
  );
  const metaIbmControlPlaneBootVolumeKey = getParamMeta(
    scenarioId,
    "controlPlane.platform.ibmcloud.bootVolume.encryptionKey",
    INSTALL_CONFIG
  );
  const metaIbmComputeBootVolumeKey = getParamMeta(
    scenarioId,
    "compute[].platform.ibmcloud.bootVolume.encryptionKey",
    INSTALL_CONFIG
  );
  const ibmVpcMode = platformConfig.ibmcloud?.vpcMode || "existing-vpc";
  const isIbmExistingVpcMode = ibmVpcMode === "existing-vpc";

  /** Nutanix IPI: show when catalog has platform.nutanix params. */
  const showNutanixIpiSection = catalogParams.some(
    (p) => (p.path === "platform.nutanix.prismCentral" || p.path === "platform.nutanix.subnet") && p.outputFile === INSTALL_CONFIG
  );
  const updateNutanix = (patch) => updatePlatformConfig({ nutanix: { ...(platformConfig.nutanix || {}), ...patch } });
  const metaNutanixEndpoint = getParamMeta(scenarioId, "platform.nutanix.prismCentral.endpoint.address", INSTALL_CONFIG);
  const metaNutanixPort = getParamMeta(scenarioId, "platform.nutanix.prismCentral.endpoint.port", INSTALL_CONFIG);
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
  const metaVsphereDiskType = getParamMeta(scenarioId, "platform.vsphere.diskType", INSTALL_CONFIG);
  const requiredPathsInstall = getRequiredParamsForOutput(scenarioId, INSTALL_CONFIG) || [];
  const isRequiredInstall = (path) => requiredPathsInstall.includes(path);

  const failureDomains = Array.isArray(platformConfig.vsphere?.failureDomains) ? platformConfig.vsphere.failureDomains : [];
  const setFailureDomains = (next) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, failureDomains: next } });
  const addFailureDomain = () => setFailureDomains([...failureDomains, { name: `fd-${failureDomains.length}`, region: "", zone: "", server: "", topology: { computeCluster: "", datacenter: "", datastore: "", networks: [], folder: "", resourcePool: "", template: "" } }]);
  const removeFailureDomain = (index) => setFailureDomains(failureDomains.filter((_, i) => i !== index));
  const updateFailureDomain = (index, patch) => setFailureDomains(failureDomains.map((fd, i) => (i === index ? { ...fd, ...patch } : fd)));
  const updateFailureDomainTopology = (index, topPatch) => setFailureDomains(failureDomains.map((fd, i) => (i === index ? { ...fd, topology: { ...(fd.topology || {}), ...topPatch } } : fd)));

  /** When failure-domains mode is selected and none exist, render one empty FD by default (4.20 recommended path). */
  useEffect(() => {
    if (!showVsphereIpiSection) return;
    const mode = platformConfig.vsphere?.placementMode || "failureDomains";
    const fds = platformConfig.vsphere?.failureDomains;
    if (mode === "failureDomains" && (!fds || fds.length === 0)) {
      updatePlatformConfig({
        vsphere: {
          ...platformConfig.vsphere,
          failureDomains: [{ name: "fd-0", region: "", zone: "", server: "", topology: { computeCluster: "", datacenter: "", datastore: "", networks: [], folder: "", resourcePool: "", template: "" } }]
        }
      });
    }
  }, [showVsphereIpiSection, platformConfig.vsphere?.placementMode, platformConfig.vsphere?.failureDomains?.length]);

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
  const showMinimalISO = (scenarioId === "bare-metal-agent" || scenarioId === "vsphere-agent") && hasParam(catalogParams, "minimalISO", AGENT_CONFIG);
  /** Global folder/resource pool are deprecated (9.1.5); replacement is failureDomains[].topology.folder/resourcePool. Backend only uses vs.folder/vs.resourcePool for legacy path. */
  const showVsphereLegacyFolderResourcePool = showVsphereIpiSection && (platformConfig.vsphere?.placementMode === "legacy");
  const showAdvancedSection = showComputeHyperthreading || showControlPlaneHyperthreading || showCapabilities || showCpuPartitioningMode || showMinimalISO || showAgentOptionsSection || showVsphereIpiSection;

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
        {showAwsGovcloudSection && (() => {
          const awsVpcMode = platformConfig.aws?.vpcMode || "installer-managed";
          const rawEntries = platformConfig.aws?.subnetEntries;
          const awsSubnetList = Array.isArray(rawEntries) && rawEntries.length > 0
            ? rawEntries
            : (platformConfig.aws?.subnets || "").split(",").map((s) => ({ id: s.trim(), roles: [] })).filter((e) => e.id).length > 0
              ? (platformConfig.aws?.subnets || "").split(",").map((s) => ({ id: s.trim(), roles: [] })).filter((e) => e.id)
              : [{ id: "", roles: [] }];
          const setAwsSubnetEntries = (entries) => updateAws({ subnetEntries: entries });
          const addAwsSubnet = () => setAwsSubnetEntries([...awsSubnetList, { id: "", roles: [] }]);
          const updateAwsSubnetAt = (index, patch) => {
            const next = awsSubnetList.map((e, i) => i === index ? { ...e, ...patch } : e);
            setAwsSubnetEntries(next);
          };
          const removeAwsSubnetAt = (index) => setAwsSubnetEntries(awsSubnetList.filter((_, i) => i !== index));
          return (
            <section className="card">
              <div className="card-header">
                <h3 className="card-title">AWS GovCloud {scenarioId === "aws-govcloud-upi" ? "UPI" : "IPI"}</h3>
                <div className="card-subtitle">Region, VPC mode, optional Route 53, instance types, and publish/credentials. Grouped for clarity.</div>
              </div>
              <div className="card-body">
                {!versionConfirmed && (
                  <div className="note warning platform-specifics-ami-hint">
                    Confirm the release version in Blueprint to unlock region list and RHCOS AMI auto-discovery.
                  </div>
                )}

                <h4 className="platform-specifics-subsection">Region &amp; AMI</h4>
                {showAwsAmiLookup && awsRegions.length > 0 && (
                  <p className="note subtle platform-specifics-region-note">Regions from installer stream metadata.</p>
                )}
                {showAwsAmiLookup && awsRegions.length === 0 && (
                  <p className="note subtle platform-specifics-region-note">Using archived region list. Installer metadata will replace this when the background download completes.</p>
                )}
                <div className="field-grid">
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
                          <option value="" disabled>Select a region</option>
                          {regionsForDropdown.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      );
                    })()}
                  </FieldLabelWithInfo>
                  <FieldLabelWithInfo
                    label="RHCOS AMI ID (optional; gov/secret regions)"
                    hint={metaAwsAmiID?.description || 'Click "Refresh from installer" to fetch the recommended AMI for the selected region. Your value is never overwritten unless you click Refresh.'}
                  >
                    <div className="platform-specifics-ami-inline">
                      <input
                        className="platform-specifics-ami-input-wide"
                        value={platformConfig.aws?.amiId || ""}
                        onChange={(e) => updateAws({ amiId: e.target.value, amiAutoFilled: false })}
                        placeholder={platformConfig.aws?.region ? "ami-xxxxxxxx" : "Select region first"}
                        disabled={amiLookup.loading}
                      />
                      {platformConfig.aws?.amiAutoFilled && platformConfig.aws?.amiId && !amiLookup.loading && (
                        <span className="platform-specifics-ami-badge" title="Filled from installer stream metadata">Auto-filled</span>
                      )}
                      {amiLookup.loading && <span className="platform-specifics-ami-loading" aria-hidden>Loading…</span>}
                      <button
                        type="button"
                        className="ghost"
                        disabled={!showAwsAmiLookup || !platformConfig.aws?.region || amiLookup.loading}
                        onClick={() => fetchAmiFromInstaller(platformConfig.aws?.region, true)}
                        title="Fetch recommended AMI from installer metadata"
                      >
                        Refresh from installer
                      </button>
                    </div>
                  </FieldLabelWithInfo>
                  {amiLookup.error ? (
                    <div className="note warning" style={{ gridColumn: "1 / -1" }}>{amiLookup.error}</div>
                  ) : null}
                </div>

                <h4 className="platform-specifics-subsection">VPC &amp; subnets</h4>
                <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                  Choose whether the installer creates a new VPC and subnets (default) or you provide existing subnet IDs. Subnet IDs here are for AWS VPC only; they are not derived from the Networking tab (machine/cluster/service CIDRs).
                </p>
                <div className="field-grid">
                  <label>
                    <span className="field-label-with-info">VPC mode</span>
                    <select
                      value={awsVpcMode}
                      onChange={(e) => updateAws({ vpcMode: e.target.value })}
                    >
                      <option value="installer-managed">Installer-managed VPC (default)</option>
                      <option value="existing">Existing VPC/subnets</option>
                    </select>
                  </label>
                </div>
                {awsVpcMode === "existing" && (
                  <div className="field-grid" style={{ marginTop: 8 }}>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <FieldLabelWithInfo
                        label="Subnet IDs (required for existing VPC)"
                        hint={metaAwsSubnets?.description || "One or more subnet IDs. Optionally assign roles per subnet (4.20: if any role is set, every subnet must have at least one role and required roles must be covered)."}
                        required
                      />
                      <div className="list" style={{ marginTop: 6 }}>
                        {(awsSubnetList.length ? awsSubnetList : [{ id: "", roles: [] }]).map((entry, idx) => {
                          const idVal = entry?.id ?? "";
                          const rolesVal = Array.isArray(entry?.roles) ? entry.roles : [];
                          return (
                            <div key={idx} className="list-item platform-specifics-aws-subnet-row">
                              <input
                                value={idVal}
                                onChange={(e) => updateAwsSubnetAt(idx, { id: e.target.value, roles: rolesVal })}
                                placeholder="subnet-xxxxxxxxx"
                                style={{ flex: "1 1 140px", minWidth: 120 }}
                              />
                              <FieldLabelWithInfo
                                label="Roles (optional)"
                                hint="4.20: ClusterNode, BootstrapNode, IngressControllerLB, ControlPlaneExternalLB (omit if publish=Internal), ControlPlaneInternalLB. If you set any role, every subnet must have ≥1 role and all required roles must be covered."
                              >
                                <select
                                  multiple
                                  value={rolesVal}
                                  onChange={(e) => updateAwsSubnetAt(idx, { id: idVal, roles: [...e.target.selectedOptions].map((o) => o.value) })}
                                  size={3}
                                  style={{ minWidth: 180 }}
                                  aria-label="Subnet roles"
                                >
                                  {AWS_SUBNET_ROLES_ALLOWED.map((r) => (
                                    <option key={r} value={r}>{r}</option>
                                  ))}
                                </select>
                              </FieldLabelWithInfo>
                              <button type="button" className="ghost" onClick={() => removeAwsSubnetAt(idx)} aria-label="Remove subnet">Remove</button>
                            </div>
                          );
                        })}
                        <button type="button" className="ghost" onClick={addAwsSubnet} style={{ marginTop: 4 }}>Add subnet</button>
                      </div>
                    </div>
                  </div>
                )}

                <h4 className="platform-specifics-subsection">Route 53 (optional)</h4>
                <div className="field-grid">
                  <FieldLabelWithInfo
                    label="Hosted zone ID (omit if not using Route 53)"
                    hint={metaAwsHostedZone?.description || "Route 53 hosted zone for base domain. Only use a pre-existing hosted zone when supplying your own VPC."}
                  >
                    <input
                      value={platformConfig.aws?.hostedZone || ""}
                      onChange={(e) => updateAws({ hostedZone: e.target.value })}
                      placeholder="Z1234567890"
                    />
                  </FieldLabelWithInfo>
                  <label className="host-inventory-v2-checkbox-label" style={{ gridColumn: "1 / -1" }}>
                    <input
                      type="checkbox"
                      checked={!!platformConfig.aws?.hostedZoneSharedVpc}
                      onChange={(e) => updateAws({ hostedZoneSharedVpc: e.target.checked })}
                      aria-label="Hosted zone in another account (shared VPC)"
                    />
                    {" "}Hosted zone is in another account (shared VPC)
                  </label>
                  {platformConfig.aws?.hostedZoneSharedVpc ? (
                    <FieldLabelWithInfo
                      label="Hosted zone role ARN (required for shared VPC)"
                      hint="IAM role ARN in the account that contains the hosted zone. Emitted only when the checkbox above is set; official docs: use only when installing into a shared VPC."
                    >
                      <input
                        value={platformConfig.aws?.hostedZoneRole || ""}
                        onChange={(e) => updateAws({ hostedZoneRole: e.target.value })}
                        placeholder="arn:aws-us-gov:iam::123:role/HostedZoneRole"
                      />
                    </FieldLabelWithInfo>
                  ) : null}
                </div>

                <h4 className="platform-specifics-subsection">Load balancer</h4>
                <div className="field-grid">
                  <FieldLabelWithInfo
                    label="Load balancer type (optional)"
                    hint="Classic: legacy ELB for API and default ingress. NLB: Network Load Balancer (recommended for most installs; better performance and TLS termination). Choose NLB unless you have a specific reason to use Classic. Omit to use the platform default."
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
                </div>

                {scenarioId === "aws-govcloud-ipi" && (
                  <>
                    <h4 className="platform-specifics-subsection">Instance types (IPI)</h4>
                    <div className="field-grid">
                      <FieldLabelWithInfo
                        label="Control plane instance type (optional)"
                        hint={metaControlPlaneAwsType?.description || "EC2 instance type for control plane."}
                      >
                        <input
                          value={platformConfig.aws?.controlPlaneInstanceType || ""}
                          onChange={(e) => updateAws({ controlPlaneInstanceType: e.target.value })}
                          placeholder="e.g. m5.xlarge"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Worker instance type (optional)"
                        hint={metaComputeAwsType?.description || "EC2 instance type for compute."}
                      >
                        <input
                          value={platformConfig.aws?.workerInstanceType || ""}
                          onChange={(e) => updateAws({ workerInstanceType: e.target.value })}
                          placeholder="e.g. m5.large"
                        />
                      </FieldLabelWithInfo>
                    </div>
                    <h4 className="platform-specifics-subsection">Root volume (optional)</h4>
                    <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                      Size and type for control plane and compute root volumes (4.20 doc: compute.platform.aws.rootVolume, controlPlane.platform.aws.rootVolume). Emitted only when set.
                    </p>
                    <div className="field-grid">
                      <FieldLabelWithInfo
                        label="Root volume size (GiB)"
                        hint="Leave empty to omit. Integer, e.g. 100."
                      >
                        <input
                          type="number"
                          min={1}
                          max={9999}
                          value={platformConfig.aws?.rootVolumeSize ?? ""}
                          onChange={(e) => updateAws({ rootVolumeSize: e.target.value === "" ? undefined : Number(e.target.value) })}
                          placeholder="omit"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Root volume type"
                        hint="EBS volume type, e.g. gp3, io1. Leave empty to omit."
                      >
                        <input
                          value={platformConfig.aws?.rootVolumeType || ""}
                          onChange={(e) => updateAws({ rootVolumeType: e.target.value || undefined })}
                          placeholder="e.g. gp3"
                        />
                      </FieldLabelWithInfo>
                    </div>
                  </>
                )}

                {(scenarioId === "aws-govcloud-ipi" || scenarioId === "aws-govcloud-upi") ? (
                  <>
                    <h4 className="platform-specifics-subsection">Machine counts</h4>
                    <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                      Control plane and worker replica counts for install-config. AWS does not use host inventory; set counts here.
                    </p>
                    <div className="field-grid">
                      <FieldLabelWithInfo
                        label="Control plane replicas"
                        hint="Number of control plane nodes (typically 3)."
                      >
                        <input
                          type="number"
                          min={1}
                          max={9}
                          value={platformConfig.controlPlaneReplicas ?? 3}
                          onChange={(e) => {
                            const v = e.target.value === "" ? undefined : Number(e.target.value);
                            updatePlatformConfig({ controlPlaneReplicas: v });
                          }}
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Compute (worker) replicas"
                        hint="Number of worker nodes (0 for control-plane-only)."
                      >
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={platformConfig.computeReplicas ?? 0}
                          onChange={(e) => {
                            const v = e.target.value === "" ? undefined : Number(e.target.value);
                            updatePlatformConfig({ computeReplicas: v });
                          }}
                        />
                      </FieldLabelWithInfo>
                    </div>
                  </>
                ) : null}

                <h4 className="platform-specifics-subsection">Publish &amp; credentials</h4>
                <div className="field-grid">
                  <FieldLabelWithInfo
                    label="Publish (optional)"
                    hint="External (default): API and ingress published to public DNS/load balancer. Use for clusters reachable from the internet or external networks. Required when apps/API must be accessed without VPN. Internal: All cluster endpoints are private-network only. DNS must resolve internally. Required by some compliance regimes. Note: console.redhat.com cluster management and direct Red Hat update checks will not reach the cluster without additional network routing. Recommendation: External for most installs. Internal only when external exposure is explicitly prohibited."
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
                    hint="Mint (recommended for IPI): CCO creates scoped cloud credentials for each cluster component from your admin credential. Each component gets minimal permissions. Requires IAM rights to create new users/roles. Best choice when you have full IAM admin access. Passthrough: CCO passes your install-time admin credential to all components — no new IAM identities created. Use when your org prohibits new IAM account creation. All components share the broad admin credential. Manual: You provision credentials yourself before install (e.g. via ccoctl for STS/Workload Identity). Required for air-gapped AWS STS installs, highly regulated environments. Most secure, most complex. Must run ccoctl before openshift-install. Nutanix IPI always requires Manual — enforced automatically."
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
          );
        })()}

        {scenarioId === "bare-metal-agent" && (
          <section className="card">
            <div className="card-header">
              <h3 className="card-title">Bare Metal Agent — install-config options</h3>
              <p className="card-subtitle">Optional Day-2 bare metal content in install-config (not used during initial provisioning).</p>
            </div>
            <div className="card-body">
              <OptionRow
                title="Include optional Day-2 bare metal fields in install-config"
                description="When enabled, install-config includes optional host and provisioning network fields that can simplify later Day-2 operations. When disabled, install-config stays minimal and agent-config is used for install-time needs."
              >
                <Switch
                  checked={!!inventory.includeBareMetalDay2InInstallConfig}
                  onChange={(checked) => updateInventory({ includeBareMetalDay2InInstallConfig: checked })}
                  aria-label="Include optional Day-2 bare metal in install-config"
                />
              </OptionRow>
              <p className="note subtle" style={{ marginTop: 8, marginBottom: 0 }}>
                Enabled: emit optional <code>platform.baremetal</code> hosts and provisioning* (per 4.20 doc; not used during initial provisioning). Disabled: minimal install-config with apiVIPs/ingressVIPs only; rely on agent-config for install-time host and provisioning needs.
              </p>
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
                  hint="External (default): API and ingress published to public DNS/load balancer. Use for clusters reachable from the internet or external networks. Required when apps/API must be accessed without VPN. Internal: All cluster endpoints are private-network only. DNS must resolve internally. Required by some compliance regimes. Note: console.redhat.com cluster management and direct Red Hat update checks will not reach the cluster without additional network routing. Recommendation: External for most installs. Internal only when external exposure is explicitly prohibited."
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
                  hint="Mint (recommended for IPI): CCO creates scoped cloud credentials for each cluster component from your admin credential. Each component gets minimal permissions. Requires IAM rights to create new users/roles. Best choice when you have full IAM admin access. Passthrough: CCO passes your install-time admin credential to all components — no new IAM identities created. Use when your org prohibits new IAM account creation. All components share the broad admin credential. Manual: You provision credentials yourself before install (e.g. via ccoctl for STS/Workload Identity). Required for air-gapped AWS STS installs, highly regulated environments. Most secure, most complex. Must run ccoctl before openshift-install. Nutanix IPI always requires Manual — enforced automatically."
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

        {showIbmCloudSection && (
          <section className="card">
            <div className="card-header">
              <h3 className="card-title">IBM Cloud IPI</h3>
              <div className="card-subtitle">Placement, VPC path, endpoint overrides, and encryption settings for IBM Cloud installer-provisioned infrastructure.</div>
            </div>
            <div className="card-body">
              <h4 className="platform-specifics-subsection">Placement</h4>
              <div className="field-grid" style={{ marginTop: 8, marginBottom: 16 }}>
                <FieldLabelWithInfo
                  label="Region"
                  hint={`${metaIbmRegion?.description ? `${metaIbmRegion.description} ` : ""}Choose the region where the cluster will run (for example, us-east). It must match the location of your target VPC/subnets and satisfy latency/compliance requirements.`}
                  required={metaIbmRegion?.required || isRequiredInstall("platform.ibmcloud.region")}
                >
                  <input
                    value={platformConfig.ibmcloud?.region || ""}
                    onChange={(e) => updateIbmCloud({ region: e.target.value })}
                    placeholder="e.g. us-east"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Resource group name (optional)"
                  hint={`${metaIbmResourceGroupName?.description ? `${metaIbmResourceGroupName.description} ` : ""}Use the resource group for cluster-managed artifacts. Leave blank to use the account default. This is distinct from the network resource group unless both intentionally match.`}
                >
                  <input
                    value={platformConfig.ibmcloud?.resourceGroupName || ""}
                    onChange={(e) => updateIbmCloud({ resourceGroupName: e.target.value })}
                    placeholder="cluster-resource-group"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Instance type (optional)"
                  hint={`${metaIbmType?.description ? `${metaIbmType.description} ` : ""}Enter a default IBM Cloud VSI profile (for example, bx2-8x32) when you need explicit CPU/memory sizing. Leave blank to use installer defaults.`}
                >
                  <input
                    value={platformConfig.ibmcloud?.type || ""}
                    onChange={(e) => updateIbmCloud({ type: e.target.value })}
                    placeholder="e.g. bx2-8x32"
                  />
                </FieldLabelWithInfo>
              </div>

              <h4 className="platform-specifics-subsection">VPC path</h4>
              <div className="field-grid" style={{ marginTop: 8, marginBottom: 12 }}>
                <FieldLabelWithInfo
                  label="VPC deployment mode"
                  hint="Choose whether you provide existing VPC resources or let the installer create them. For disconnected/restricted environments, existing VPC/subnets are the common path. This choice controls which VPC fields are shown and emitted."
                >
                  <select
                    value={ibmVpcMode}
                    onChange={(e) => updateIbmCloud({ vpcMode: e.target.value })}
                  >
                    <option value="existing-vpc">Existing VPC and subnets</option>
                    <option value="installer-managed">Installer-managed VPC</option>
                  </select>
                </FieldLabelWithInfo>
              </div>
              <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                VPC fields below expect IBM Cloud resource names in the selected region. They are not CIDR values from the Networking tab.
              </p>
              {isIbmExistingVpcMode ? (
                <div className="field-grid" style={{ marginBottom: 16 }}>
                <FieldLabelWithInfo
                  label="Network resource group name"
                  hint={`${metaIbmNetworkResourceGroupName?.description ? `${metaIbmNetworkResourceGroupName.description} ` : ""}Required in Existing VPC mode. Enter the resource group that already contains the VPC and subnet resources for this cluster.`}
                  required={true}
                >
                  <input
                    value={platformConfig.ibmcloud?.networkResourceGroupName || ""}
                    onChange={(e) => updateIbmCloud({ networkResourceGroupName: e.target.value })}
                    placeholder="existing-network-rg"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="VPC name"
                  hint={`${metaIbmVpcName?.description ? `${metaIbmVpcName.description} ` : ""}Required in Existing VPC mode. Enter the existing VPC name in the selected region where cluster nodes are placed.`}
                  required={true}
                >
                  <input
                    value={platformConfig.ibmcloud?.vpcName || ""}
                    onChange={(e) => updateIbmCloud({ vpcName: e.target.value })}
                    placeholder="existing-vpc-name"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Control plane subnets"
                  hint={`${metaIbmControlPlaneSubnets?.description ? `${metaIbmControlPlaneSubnets.description} ` : ""}Required in Existing VPC mode. Provide comma-separated existing subnet names for control plane nodes (typically one per AZ) with API/control-plane connectivity.`}
                  required={true}
                >
                  <input
                    value={platformConfig.ibmcloud?.controlPlaneSubnets || ""}
                    onChange={(e) => updateIbmCloud({ controlPlaneSubnets: e.target.value })}
                    placeholder="cp-subnet-a,cp-subnet-b,cp-subnet-c"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Compute subnets"
                  hint={`${metaIbmComputeSubnets?.description ? `${metaIbmComputeSubnets.description} ` : ""}Required in Existing VPC mode. Provide comma-separated existing subnet names for worker nodes in the same VPC/region with required workload connectivity.`}
                  required={true}
                >
                  <input
                    value={platformConfig.ibmcloud?.computeSubnets || ""}
                    onChange={(e) => updateIbmCloud({ computeSubnets: e.target.value })}
                    placeholder="compute-subnet-a,compute-subnet-b,compute-subnet-c"
                  />
                </FieldLabelWithInfo>
                </div>
              ) : (
                <p className="note subtle" style={{ marginTop: 0, marginBottom: 16 }}>
                  Installer-managed VPC selected. Existing-VPC-only fields are hidden and omitted from generated output.
                </p>
              )}

              <h4 className="platform-specifics-subsection">Dedicated hosts (optional)</h4>
              <div className="field-grid" style={{ marginTop: 8, marginBottom: 16 }}>
                <FieldLabelWithInfo
                  label="Dedicated host profile (optional)"
                  hint={`${metaIbmDedicatedHostsProfile?.description ? `${metaIbmDedicatedHostsProfile.description} ` : ""}Set when machines must run on dedicated hosts. Use a valid dedicated-host profile (for example, cx2-host-*).`}
                >
                  <input
                    value={platformConfig.ibmcloud?.dedicatedHostsProfile || ""}
                    onChange={(e) => updateIbmCloud({ dedicatedHostsProfile: e.target.value })}
                    placeholder="e.g. cx2-host-152x304"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Dedicated host name (optional)"
                  hint={`${metaIbmDedicatedHostsName?.description ? `${metaIbmDedicatedHostsName.description} ` : ""}Use when placing nodes on a pre-created dedicated host. Enter the existing host name with sufficient remaining capacity.`}
                >
                  <input
                    value={platformConfig.ibmcloud?.dedicatedHostsName || ""}
                    onChange={(e) => updateIbmCloud({ dedicatedHostsName: e.target.value })}
                    placeholder="existing-dedicated-host"
                  />
                </FieldLabelWithInfo>
              </div>

              <h4 className="platform-specifics-subsection">Service endpoint overrides (optional)</h4>
              <div className="field-grid" style={{ marginTop: 8, marginBottom: 16 }}>
                <FieldLabelWithInfo
                  label="Service endpoints (optional)"
                  hint={`${metaIbmServiceEndpoints?.description ? `${metaIbmServiceEndpoints.description} ` : ""}Override endpoints only when default public IBM endpoints are unreachable (private/restricted routing). Enter one NAME=URL pair per line, such as IAM=... or VPC=....`}
                >
                  <textarea
                    value={platformConfig.ibmcloud?.serviceEndpoints || ""}
                    onChange={(e) => updateIbmCloud({ serviceEndpoints: e.target.value })}
                    rows={5}
                    placeholder={"IAM=https://private.us-east.iam.cloud.ibm.com\nVPC=https://us-east.private.iaas.cloud.ibm.com/v1"}
                  />
                </FieldLabelWithInfo>
              </div>

              <h4 className="platform-specifics-subsection">Boot volume encryption (optional)</h4>
              <div className="field-grid" style={{ marginTop: 8, marginBottom: 16 }}>
                <FieldLabelWithInfo
                  label="Boot volume encryption key (all machine pools, optional)"
                  hint={`${metaIbmDefaultMachineBootVolumeKey?.description ? `${metaIbmDefaultMachineBootVolumeKey.description} ` : ""}Set a Key Protect root key CRN to apply one cluster-wide default boot-volume key to all machine pools.`}
                >
                  <input
                    value={platformConfig.ibmcloud?.defaultMachineBootVolumeEncryptionKey || ""}
                    onChange={(e) => updateIbmCloud({ defaultMachineBootVolumeEncryptionKey: e.target.value })}
                    placeholder="crn:v1:bluemix:public:kms:..."
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Boot volume encryption key (control plane, optional)"
                  hint={`${metaIbmControlPlaneBootVolumeKey?.description ? `${metaIbmControlPlaneBootVolumeKey.description} ` : ""}Optional override for control plane boot volumes when masters must use a different key than the cluster-wide default.`}
                >
                  <input
                    value={platformConfig.ibmcloud?.controlPlaneBootVolumeEncryptionKey || ""}
                    onChange={(e) => updateIbmCloud({ controlPlaneBootVolumeEncryptionKey: e.target.value })}
                    placeholder="crn:v1:bluemix:public:kms:..."
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Boot volume encryption key (compute, optional)"
                  hint={`${metaIbmComputeBootVolumeKey?.description ? `${metaIbmComputeBootVolumeKey.description} ` : ""}Optional override for worker boot volumes when compute nodes require a different key from control plane or the cluster default.`}
                >
                  <input
                    value={platformConfig.ibmcloud?.computeBootVolumeEncryptionKey || ""}
                    onChange={(e) => updateIbmCloud({ computeBootVolumeEncryptionKey: e.target.value })}
                    placeholder="crn:v1:bluemix:public:kms:..."
                  />
                </FieldLabelWithInfo>
              </div>

              <h4 className="platform-specifics-subsection">Publishing and credentials</h4>
              <div className="field-grid" style={{ marginTop: 8 }}>
                <FieldLabelWithInfo
                  label="Publish (optional)"
                  hint={`${metaPublish?.description ? `${metaPublish.description} ` : ""}External exposes API/apps via public endpoints. Internal keeps endpoints private to your network/VPC path and is typical for private-cluster designs.`}
                >
                  <select
                    value={platformConfig.publish || metaPublish?.default || "External"}
                    onChange={(e) => updatePlatformConfig({ publish: e.target.value })}
                  >
                    <option value="External">External</option>
                    <option value="Internal">Internal</option>
                  </select>
                </FieldLabelWithInfo>
              </div>
              <p className="note subtle" style={{ marginTop: 8, marginBottom: 0 }}>
                Credentials mode is fixed to <code>Manual</code> for IBM Cloud IPI and is emitted automatically in generated assets.
              </p>
            </div>
          </section>
        )}

        {showNutanixIpiSection && (
          <section className="card">
            <div className="card-header">
              <h3 className="card-title">Nutanix IPI</h3>
              <div className="card-subtitle">Prism Central connection, credentials, infrastructure, and cluster topology for installer-provisioned infrastructure.</div>
            </div>
            <div className="card-body">
              {/* Group A — Prism Central connection */}
              <h4 className="platform-specifics-subsection">Prism Central connection</h4>
              <div className="field-grid" style={{ marginTop: 8, marginBottom: 16 }}>
                <FieldLabelWithInfo
                  label="Endpoint (FQDN or IP)"
                  hint={metaNutanixEndpoint?.description || "Prism Central hostname or IP address."}
                  required={metaNutanixEndpoint?.required || isRequiredInstall("platform.nutanix.prismCentral.endpoint.address")}
                >
                  <input
                    value={platformConfig.nutanix?.endpoint || ""}
                    onChange={(e) => updateNutanix({ endpoint: e.target.value })}
                    placeholder="prism.example.com"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Port (optional; default 9440)"
                  hint={metaNutanixPort?.description || "Prism Central API port."}
                >
                  <input
                    type="number"
                    value={platformConfig.nutanix?.port ?? ""}
                    onChange={(e) => updateNutanix({ port: e.target.value || undefined })}
                    placeholder="9440"
                    style={{ maxWidth: 120 }}
                  />
                </FieldLabelWithInfo>
              </div>

              {/* Group B — Credentials */}
              <h4 className="platform-specifics-subsection">Credentials</h4>
              <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>Emitted only when &ldquo;Include credentials&rdquo; is checked at export.</p>
              <div className="field-grid" style={{ marginBottom: 16 }}>
                <FieldLabelWithInfo
                  label="Username"
                  hint={metaNutanixUsername?.description || "Prism Central admin username."}
                >
                  <input
                    value={platformConfig.nutanix?.username || ""}
                    onChange={(e) => updateNutanix({ username: e.target.value })}
                    placeholder="admin"
                    autoComplete="username"
                    data-form-type="other"
                    data-lpignore="true"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Password"
                  hint={metaNutanixPassword?.description || "Prism Central password. Included in install-config only when you choose to include credentials in export. Do not save in browser."}
                >
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type={showNutanixPassword ? "text" : "password"}
                      autoComplete="new-password"
                      data-form-type="other"
                      data-lpignore="true"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      value={platformConfig.nutanix?.password || ""}
                      onChange={(e) => updateNutanix({ password: e.target.value })}
                      placeholder="••••••••"
                      style={{ flex: "1 1 auto", minWidth: 0 }}
                    />
                    <button
                      type="button"
                      className="ghost"
                      style={{ padding: "2px 8px", fontSize: "0.75rem", flexShrink: 0 }}
                      onClick={() => setShowNutanixPassword((s) => !s)}
                      aria-label={showNutanixPassword ? "Hide password" : "Show password"}
                    >
                      {showNutanixPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </FieldLabelWithInfo>
              </div>

              {/* Group C — Infrastructure */}
              <h4 className="platform-specifics-subsection">Infrastructure</h4>
              <div className="field-grid" style={{ marginBottom: 16 }}>
                <FieldLabelWithInfo
                  label="Subnet UUID(s)"
                  hint="UUID or name of the Nutanix subnet (network segment/VLAN) where the installer creates OpenShift VMs. This is a Nutanix infrastructure identifier, not an IP range — IP address ranges are configured as Machine/Cluster/Service network CIDRs in the Networking step. Comma-separate multiple UUIDs for multi-subnet environments."
                  required={metaNutanixSubnet?.required || isRequiredInstall("platform.nutanix.subnet")}
                >
                  <input
                    value={platformConfig.nutanix?.subnet || ""}
                    onChange={(e) => updateNutanix({ subnet: e.target.value })}
                    placeholder="subnet-uuid or uuid1,uuid2"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Prism Element cluster name (optional)"
                  hint={metaNutanixClusterName?.description || "Nutanix Prism Element cluster name for VM placement. Leave blank if not needed. Accepts a name string (not UUID)."}
                >
                  <input
                    value={platformConfig.nutanix?.cluster || ""}
                    onChange={(e) => updateNutanix({ cluster: e.target.value })}
                    placeholder="my-nutanix-cluster"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Storage container (optional)"
                  hint="Nutanix storage container for the cluster's volumes. Leave blank to use the default storage container."
                >
                  <input
                    value={platformConfig.nutanix?.storageContainer || ""}
                    onChange={(e) => updateNutanix({ storageContainer: e.target.value })}
                    placeholder="default-container"
                  />
                </FieldLabelWithInfo>
              </div>

              {/* Group D — Cluster topology */}
              <h4 className="platform-specifics-subsection">Cluster topology</h4>
              <p className="note subtle" style={{ marginTop: 0, marginBottom: 10 }}>
                Nutanix IPI has no host inventory in this app. Select a topology to set control plane and worker counts.
              </p>
              <div className="grid" style={{ marginBottom: 12 }}>
                {[
                  { value: "sno", label: "Single Node (SNO)", sub: "1 CP · 0 workers" },
                  { value: "compact", label: "Compact three-node", sub: "3 CP · 0 workers" },
                  { value: "ha", label: "High Availability", sub: "3 CP · N workers" }
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`select-card ${(platformConfig.nutanixTopology || "ha") === opt.value ? "selected" : ""}`}
                    onClick={() => updatePlatformConfig({ nutanixTopology: opt.value })}
                  >
                    <div className="card-title">{opt.label}</div>
                    <div className="card-sub">{opt.sub}</div>
                  </button>
                ))}
              </div>
              {(platformConfig.nutanixTopology || "ha") === "ha" && (
                <div className="field-grid" style={{ marginBottom: 16 }}>
                  <FieldLabelWithInfo
                    label="Worker count"
                    hint="Number of compute (worker) nodes. Minimum 2 for high-availability clusters."
                  >
                    <input
                      type="number"
                      min={2}
                      max={100}
                      value={platformConfig.computeReplicas ?? 3}
                      onChange={(e) => {
                        const v = e.target.value === "" ? undefined : Number(e.target.value);
                        updatePlatformConfig({ computeReplicas: v });
                      }}
                      style={{ maxWidth: 120 }}
                    />
                  </FieldLabelWithInfo>
                </div>
              )}

              {/* Group E — Access */}
              <h4 className="platform-specifics-subsection">Access</h4>
              <div className="field-grid">
                <FieldLabelWithInfo
                  label="Credentials mode"
                  hint="Mint (recommended for IPI): CCO creates scoped cloud credentials for each cluster component from your admin credential. Each component gets minimal permissions. Requires IAM rights to create new users/roles. Best choice when you have full IAM admin access. Passthrough: CCO passes your install-time admin credential to all components — no new IAM identities created. Use when your org prohibits new IAM account creation. All components share the broad admin credential. Manual: You provision credentials yourself before install (e.g. via ccoctl for STS/Workload Identity). Required for air-gapped AWS STS installs, highly regulated environments. Most secure, most complex. Must run ccoctl before openshift-install. Nutanix IPI always requires Manual — enforced automatically."
                >
                  <input readOnly value="Manual" aria-label="Credentials mode (Manual, required for Nutanix IPI)" />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Publish"
                  hint="External (default): API and ingress published to public DNS/load balancer. Use for clusters reachable from the internet or external networks. Required when apps/API must be accessed without VPN. Internal: All cluster endpoints are private-network only. DNS must resolve internally. Required by some compliance regimes. Note: console.redhat.com cluster management and direct Red Hat update checks will not reach the cluster without additional network routing. Recommendation: External for most installs. Internal only when external exposure is explicitly prohibited. Note: Nutanix IPI forces External in the generated install-config."
                >
                  <input readOnly value="External (required for Nutanix IPI)" aria-label="Publish (External, required for Nutanix IPI)" />
                </FieldLabelWithInfo>
              </div>
            </div>
          </section>
        )}

        {showVsphereIpiSection && (
          <section className="card">
            <div className="card-header">
              <h3 className="card-title">
                vSphere{" "}
                {scenarioId === "vsphere-upi" ? "UPI" : scenarioId === "vsphere-agent" ? "Agent-based" : "IPI"}
              </h3>
              <div className="card-subtitle">
                {scenarioId === "vsphere-agent"
                  ? "vCenter placement for Agent-based installs (you provide VMs; install-config uses platform.vsphere with apiVIPs/ingressVIPs from Networking). IPI-only items (RHCOS template URL, topology.template, optional machine pool sizing) are hidden."
                  : "vCenter credentials, placement, and storage for vSphere (installer-provisioned or user-provisioned)."}
              </div>
            </div>
            <div className="card-body">
              <h4 className="platform-specifics-subsection">Credentials</h4>
              <div className="field-grid" style={{ marginTop: 8, marginBottom: 20 }}>
                <FieldLabelWithInfo
                  label="vCenter username (optional)"
                  hint="Included in install-config only when you choose to include credentials in export."
                >
                  <input
                    value={platformConfig.vsphere?.username || ""}
                    onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, username: e.target.value } })}
                    placeholder="administrator@vsphere.local"
                    autoComplete="username"
                    data-form-type="other"
                    data-lpignore="true"
                  />
                </FieldLabelWithInfo>
                <div className="pull-secret-section-inline" style={{ minWidth: 0 }}>
                  <div className="pull-secret-label-row">
                    <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                      <FieldLabelWithInfo
                        label="vCenter password (optional)"
                        hint="Included in install-config only when you choose to include credentials in export. Do not save in browser."
                      />
                    </div>
                    <button
                      type="button"
                      className="ghost pull-secret-toggle"
                      style={{ padding: "2px 8px", fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}
                      onClick={() => setShowVspherePassword((s) => !s)}
                      aria-label={showVspherePassword ? "Hide password" : "Show password"}
                    >
                      <span aria-hidden>{showVspherePassword ? "\u2007" : "\u{1F441}"}</span>
                      {showVspherePassword ? "Hide" : "Show"}
                    </button>
                  </div>
                  <input
                    type={showVspherePassword ? "text" : "password"}
                    autoComplete="new-password"
                    data-form-type="other"
                    data-lpignore="true"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    value={platformConfig.vsphere?.password || ""}
                    onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, password: e.target.value } })}
                    placeholder="••••••••"
                    aria-label="vCenter password (optional)"
                    style={{ width: "100%", minWidth: 0 }}
                  />
                </div>
              </div>

              <h4 className="platform-specifics-subsection">Placement</h4>
              <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                Choose failure domains (recommended for 4.20) or legacy single placement. Only the selected path is used in the generated install-config.
              </p>
              <div className="field-grid" style={{ marginTop: 8, marginBottom: 12 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label className="platform-specifics-radio-label">
                    <input
                      type="radio"
                      name="vsphere-placement-mode"
                      checked={(platformConfig.vsphere?.placementMode || "failureDomains") === "failureDomains"}
                      onChange={() => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, placementMode: "failureDomains" } })}
                      aria-label="Use failure domains (recommended)"
                    />
                    {" "}Use failure domains (recommended)
                  </label>
                  <label className="platform-specifics-radio-label">
                    <input
                      type="radio"
                      name="vsphere-placement-mode"
                      checked={platformConfig.vsphere?.placementMode === "legacy"}
                      onChange={() => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, placementMode: "legacy" } })}
                      aria-label="Use legacy single placement (deprecated)"
                    />
                    {" "}Use legacy single placement (deprecated)
                  </label>
                </div>
              </div>

              {(platformConfig.vsphere?.placementMode || "failureDomains") === "legacy" && (
                <div className="field-grid" style={{ marginTop: 8, marginBottom: 16 }}>
                  <FieldLabelWithInfo
                    label="vCenter server"
                    hint={metaVsphereVcenter?.description}
                    required={true}
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
                    required={true}
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
                    label="Compute cluster (required for legacy path)"
                    hint="vSphere compute cluster name for single placement."
                  >
                    <input
                      value={platformConfig.vsphere?.cluster || ""}
                      onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, cluster: e.target.value } })}
                      placeholder="e.g. Cluster1"
                    />
                  </FieldLabelWithInfo>
                  <FieldLabelWithInfo
                    label="VM network (required for legacy path)"
                    hint="vCenter network (port group or DPG) name where the installer attaches VM NICs. Must contain the virtual IPs and DNS records. Not an IP range — IP address ranges are set in the Networking step."
                  >
                    <input
                      value={platformConfig.vsphere?.network || ""}
                      onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, network: e.target.value } })}
                      placeholder="e.g. VM Network"
                    />
                  </FieldLabelWithInfo>
                </div>
              )}

              {showFailureDomainsSection && (platformConfig.vsphere?.placementMode || "failureDomains") === "failureDomains" && (
                <div style={{ marginBottom: 20 }}>
                  <h4 className="card-title" style={{ marginBottom: 4, fontSize: "1rem" }}>Failure domains</h4>
                  <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                    For vSphere IPI at least one failure domain is required (4.20 recommended path). Add more for multi-zone placement. Only the selected path is emitted; legacy fields above are ignored when using failure domains.
                  </p>
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
                          <FieldLabelWithInfo label="Region" hint="Logical region for this failure domain. For a single datacenter use a short name (e.g. datacenter). For multiple failure domains, use the openshift-region tag value so the installer can group nodes." />
                          <input value={fd.region || ""} onChange={(e) => updateFailureDomain(index, { region: e.target.value })} placeholder="e.g. datacenter or openshift-region tag" />
                        </label>
                        <label>
                          <FieldLabelWithInfo label="Zone" hint="Logical zone within the region (e.g. compute cluster name). For a single cluster use its name. For multiple zones use the openshift-zone tag value so the installer can spread nodes." />
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
                          <FieldLabelWithInfo label="Topology: Networks (comma delimited)" hint="One or more vCenter port group or Distributed Port Group (DPG) names that the installer connects OpenShift VM NICs to. These are vSphere network object names (e.g. 'VM Network', 'DPG-OCP'), not IP ranges — IP address ranges are configured as Machine/Cluster/Service network CIDRs in the Networking step. Comma-separate multiple names." />
                          <input value={Array.isArray(fd.topology?.networks) ? fd.topology.networks.join(", ") : (fd.topology?.networks || "")} onChange={(e) => updateFailureDomainTopology(index, { networks: e.target.value.split(",").map((s) => s.trim()) })} placeholder="e.g. VM Network or VM Network, DPG-1" />
                        </label>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <CollapsibleSection title="Advanced (template, folder, resource pool)" defaultCollapsed={true}>
                            {scenarioId === "vsphere-ipi" && (
                            <label>
                              <FieldLabelWithInfo label="Topology: RHCOS template (optional, IPI only)" hint="Absolute path to a pre-existing RHCOS image template or VM in vSphere. A value here disables the clusterOSImage field in Machine pool (advanced); use one strategy only. Doc: download OVA → Deploy OVF Template in vSphere Client → do not customize → set this path." />
                              <input
                                value={fd.topology?.template || ""}
                                onChange={(e) => updateFailureDomainTopology(index, { template: e.target.value })}
                                placeholder="/datacenter/vm/rhcos-template"
                                disabled={Boolean(platformConfig.vsphere?.clusterOSImage && String(platformConfig.vsphere.clusterOSImage).trim() !== "")}
                                aria-describedby={platformConfig.vsphere?.clusterOSImage && String(platformConfig.vsphere.clusterOSImage).trim() !== "" ? `fd-template-disabled-${index}` : undefined}
                              />
                              {platformConfig.vsphere?.clusterOSImage && String(platformConfig.vsphere.clusterOSImage).trim() !== "" && (
                                <p className="note subtle" style={{ marginTop: 4 }} id={`fd-template-disabled-${index}`}>Disabled: clusterOSImage is set (choose one strategy only).</p>
                              )}
                            </label>
                          )}
                          <label>
                            <FieldLabelWithInfo label="Topology: Folder (optional)" hint="VM folder path in failure domain topology." />
                            <input value={fd.topology?.folder || ""} onChange={(e) => updateFailureDomainTopology(index, { folder: e.target.value })} placeholder="/datacenter/vm/folder" />
                          </label>
                          <label>
                            <FieldLabelWithInfo label="Topology: Resource pool (optional)" hint="Resource pool path in failure domain topology." />
                            <input value={fd.topology?.resourcePool || ""} onChange={(e) => updateFailureDomainTopology(index, { resourcePool: e.target.value })} placeholder="/datacenter/host/cluster/Resources/pool" />
                          </label>
                          </CollapsibleSection>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* vSphere IPI API/Ingress VIPs are on the Networking step (shared section with scenario gating). */}

              <h4 className="platform-specifics-subsection">Storage</h4>
              <div className="field-grid" style={{ marginTop: 8, marginBottom: 20 }}>
                <FieldLabelWithInfo
                  label="Disk type (optional)"
                  hint="How vSphere provisions VM disks. thin: allocates on demand (faster, good for most installs). thick: allocates full size at create (more predictable I/O). eagerZeroedThick: same as thick but zeroes blocks first (slowest create, required for some storage). Leave Not set to use the datastore default."
                >
                  <select
                    className="platform-specifics-disk-type-select"
                    value={platformConfig.vsphere?.diskType || ""}
                    onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, diskType: e.target.value || undefined } })}
                    aria-label="Disk provisioning method"
                  >
                    <option value="" disabled>Not set</option>
                    <option value="thin">thin</option>
                    <option value="thick">thick</option>
                    <option value="eagerZeroedThick">eagerZeroedThick</option>
                  </select>
                </FieldLabelWithInfo>
              </div>

              {scenarioId === "vsphere-ipi" && (platformConfig.vsphere?.placementMode || "failureDomains") === "failureDomains" && failureDomains.length >= 2 && (
                <>
                  <h4 className="platform-specifics-subsection">Zone placement (optional)</h4>
                  <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                    Zone names must match failure domain names. Only shown when you have 2 or more failure domains.
                  </p>
                  <div className="field-grid" style={{ marginTop: 8, marginBottom: 20 }}>
                    <FieldLabelWithInfo
                      label="Compute zones"
                      hint="Comma-separated zone names for worker placement (e.g. fd-0, fd-1). Must match failureDomains[].name."
                    >
                      <input
                        value={Array.isArray(platformConfig.vsphere?.computeZones) ? platformConfig.vsphere.computeZones.join(", ") : ""}
                        onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, computeZones: e.target.value.split(",").map((z) => z.trim()).filter(Boolean) } })}
                        placeholder="e.g. fd-0, fd-1"
                      />
                    </FieldLabelWithInfo>
                    <FieldLabelWithInfo
                      label="Control plane zones"
                      hint="Comma-separated zone names for control plane placement. Must match failureDomains[].name."
                    >
                      <input
                        value={Array.isArray(platformConfig.vsphere?.controlPlaneZones) ? platformConfig.vsphere.controlPlaneZones.join(", ") : ""}
                        onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, controlPlaneZones: e.target.value.split(",").map((z) => z.trim()).filter(Boolean) } })}
                        placeholder="e.g. fd-0, fd-1"
                      />
                    </FieldLabelWithInfo>
                  </div>
                </>
              )}

              {scenarioId === "vsphere-ipi" && (
                <CollapsibleSection title="Machine pool (advanced)" defaultCollapsed={true} style={{ marginBottom: 20 }}>
                  <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                    Choose one RHCOS image strategy: clusterOSImage URL or topology.template per failure domain. Do not set both.
                  </p>
                  <div className="field-grid" style={{ marginTop: 8, marginBottom: 12 }}>
                    <FieldLabelWithInfo
                      label="clusterOSImage (optional)"
                      hint="URL for RHCOS image. A value here disables Topology: RHCOS template in each failure domain; use one strategy only."
                    >
                      <input
                        value={platformConfig.vsphere?.clusterOSImage || ""}
                        onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, clusterOSImage: e.target.value } })}
                        placeholder="https://mirror.example.com/rhcos.ova"
                        disabled={failureDomains.some((fd) => fd.topology?.template && String(fd.topology.template).trim() !== "")}
                        aria-describedby={failureDomains.some((fd) => fd.topology?.template && String(fd.topology.template).trim() !== "") ? "cluster-os-image-disabled-note" : undefined}
                      />
                    </FieldLabelWithInfo>
                  </div>
                  {failureDomains.some((fd) => fd.topology?.template && String(fd.topology.template).trim() !== "") && (
                    <p className="note subtle" style={{ marginBottom: 8 }} id="cluster-os-image-disabled-note">Disabled: a failure domain has Topology: RHCOS template set (choose one strategy only).</p>
                  )}
                  <div className="field-grid" style={{ marginTop: 8 }}>
                    <FieldLabelWithInfo label="osDisk.diskSizeGB (optional)" hint="Root disk size in GB for platform.vsphere.">
                      <input
                        type="number"
                        min={1}
                        value={platformConfig.vsphere?.osDiskDiskSizeGB ?? ""}
                        onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, osDiskDiskSizeGB: e.target.value === "" ? undefined : Number(e.target.value) } })}
                        placeholder="Leave empty for default"
                      />
                    </FieldLabelWithInfo>
                    <FieldLabelWithInfo label="cpus (optional)" hint="Number of vCPUs for platform.vsphere.">
                      <input
                        type="number"
                        min={1}
                        value={platformConfig.vsphere?.cpus ?? ""}
                        onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, cpus: e.target.value === "" ? undefined : Number(e.target.value) } })}
                        placeholder="Leave empty for default"
                      />
                    </FieldLabelWithInfo>
                    <FieldLabelWithInfo label="coresPerSocket (optional)" hint="Cores per socket for platform.vsphere.">
                      <input
                        type="number"
                        min={1}
                        value={platformConfig.vsphere?.coresPerSocket ?? ""}
                        onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, coresPerSocket: e.target.value === "" ? undefined : Number(e.target.value) } })}
                        placeholder="Leave empty for default"
                      />
                    </FieldLabelWithInfo>
                    <FieldLabelWithInfo label="memoryMB (optional)" hint="Memory in MB for platform.vsphere.">
                      <input
                        type="number"
                        min={1}
                        value={platformConfig.vsphere?.memoryMB ?? ""}
                        onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, memoryMB: e.target.value === "" ? undefined : Number(e.target.value) } })}
                        placeholder="Leave empty for default"
                      />
                    </FieldLabelWithInfo>
                  </div>
                </CollapsibleSection>
              )}

              </div>
          </section>
        )}

        {showProvisioningNetworkSection && (() => {
          const provisioningMode = inventory.provisioningNetwork || (metaProvisioningNetwork?.default ?? "Managed");
          const showDhcpRange = provisioningMode !== "Disabled";
          return (
            <section className="card">
              <div className="card-header">
                <h3 className="card-title">Bare metal IPI — Provisioning network</h3>
                <div className="card-subtitle">Provisioning network mode and options for installer-provisioned bare metal.</div>
              </div>
              <div className="card-body">
                <p className="note subtle">Configure how the provisioning network is used during installation. Hosts (BMC, boot MAC) are configured on the Hosts / Inventory step.</p>
                <div className="field-grid" style={{ marginTop: 12 }}>
                  <label style={{ gridColumn: "1 / -1" }}>
                    <FieldLabelWithInfo
                      label="Provisioning network"
                      hint="Managed (default): The installer runs DHCP and TFTP on the provisioning network; no other DHCP on that network. Choose when you have a dedicated provisioning NIC and can give the installer full control. Unmanaged: Provisioning network exists but you run DHCP yourself; virtual media is recommended, PXE still possible. Choose when you must use existing DHCP or share the network. Disabled: No provisioning network; use virtual media or Assisted Installer only. BMCs must be reachable on the bare-metal network; reserve two IPs on that network for provisioning services. Choose for fully static or disconnected flows."
                      required={metaProvisioningNetwork?.required}
                    />
                    <select
                      value={provisioningMode}
                      onChange={(e) => updateInventory({ provisioningNetwork: e.target.value })}
                      style={{ maxWidth: "100%", width: "100%", boxSizing: "border-box" }}
                    >
                      <option value="Managed">Managed — installer runs DHCP/TFTP</option>
                      <option value="Unmanaged">Unmanaged — you provide DHCP</option>
                      <option value="Disabled">Disabled — virtual media / no provisioning net</option>
                    </select>
                  </label>
                  <label>
                    <FieldLabelWithInfo
                      label="Provisioning network CIDR (optional)"
                      hint={provisioningMode === "Disabled" ? "When Disabled, provisioning services use the bare-metal network; omit or use bare-metal CIDR if needed." : metaProvisioningCIDR?.description}
                    />
                    <input
                      value={inventory.provisioningNetworkCIDR || ""}
                      onChange={(e) => updateInventory({ provisioningNetworkCIDR: e.target.value.trim() })}
                      placeholder={provisioningMode === "Disabled" ? "omit or bare-metal CIDR" : "e.g. 172.22.0.0/24"}
                    />
                  </label>
                  <label>
                    <FieldLabelWithInfo
                      label="Provisioning network interface (optional)"
                      hint={provisioningMode === "Disabled" ? "When Disabled, there is no provisioning network; omit unless your setup requires it." : metaProvisioningInterface?.description}
                    />
                    <input
                      value={inventory.provisioningNetworkInterface || ""}
                      onChange={(e) => updateInventory({ provisioningNetworkInterface: e.target.value })}
                      placeholder={provisioningMode === "Disabled" ? "omit" : "e.g. eth1"}
                    />
                  </label>
                  {showDhcpRange ? (
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
                  ) : null}
                  <label>
                    <FieldLabelWithInfo
                      label="Cluster provisioning IP (optional)"
                      hint={provisioningMode === "Disabled" ? "When Disabled, one of two IPs on the bare-metal network for provisioning services." : metaClusterProvisioningIP?.description}
                    />
                    <input
                      value={inventory.clusterProvisioningIP || ""}
                      onChange={(e) => updateInventory({ clusterProvisioningIP: e.target.value.trim() })}
                      placeholder={provisioningMode === "Disabled" ? "IP on bare-metal network" : "IP within provisioning subnet"}
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
                {provisioningMode === "Disabled" && (
                  <p className="note subtle" style={{ marginTop: 12, marginBottom: 0 }}>
                    When Disabled, reserve two IPs on the bare-metal network for provisioning services; BMCs must be reachable on that network.
                  </p>
                )}
              </div>
            </section>
          );
        })()}

        {showAdvancedSection && (
          <CollapsibleSection
            title="Advanced"
            subtitle={`${showVsphereLegacyFolderResourcePool ? "vSphere folder/resource pool (legacy placement only), " : ""}${showAgentOptionsSection ? "Agent boot artifacts, " : ""}Hyperthreading, capabilities, CPU partitioning, minimal ISO (catalog-driven).`}
            defaultCollapsed={true}
          >
                <div className="field-grid" style={{ marginTop: 12 }}>
                  {showVsphereLegacyFolderResourcePool && (
                    <>
                      <FieldLabelWithInfo label="vSphere folder (optional, legacy)" hint="VM folder path for cluster VMs (legacy placement only). Doc 9.1.5: deprecated; with failure domains use Topology: Folder per failure domain. Omit to use installer default.">
                        <input
                          value={platformConfig.vsphere?.folder || ""}
                          onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, folder: e.target.value } })}
                          placeholder="VM folder path"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo label="vSphere resource pool (optional, legacy)" hint="Resource pool path for cluster VMs (legacy placement only). Doc 9.1.5: deprecated; with failure domains use Topology: Resource pool per failure domain. Omit to use cluster root Resources.">
                        <input
                          value={platformConfig.vsphere?.resourcePool || ""}
                          onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, resourcePool: e.target.value } })}
                          placeholder="Resource pool path"
                        />
                      </FieldLabelWithInfo>
                    </>
                  )}
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
                  ? "Bare metal UPI: No installer-managed provisioning network or host list. Configure API and Ingress via your load balancer and DNS (see docs)."
                  : "No platform-specific options for this scenario yet."}
              </p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
