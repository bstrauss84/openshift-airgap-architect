/**
 * OpenShift Airgap Architect - Platform-Specific Configuration Step
 *
 * Platform-specific settings by scenario: AWS GovCloud (region, AMI, instance types),
 * vSphere (vCenter, failure domains), Azure Government, Nutanix (Prism credentials),
 * Bare Metal Agent (boot artifacts). Catalog-driven field visibility and validation.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
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

/** Allowed subnet roles for AWS GovCloud platform configurations. */
const AWS_SUBNET_ROLES_ALLOWED = ["ClusterNode", "BootstrapNode", "IngressControllerLB", "ControlPlaneExternalLB", "ControlPlaneInternalLB"];

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
  const setIbmDedicatedHostsProfile = (value) => {
    const next = (value || "").trim();
    updateIbmCloud({
      dedicatedHostsProfile: value,
      ...(next ? { dedicatedHostsName: "" } : {})
    });
  };
  const setIbmDedicatedHostsName = (value) => {
    const next = (value || "").trim();
    updateIbmCloud({
      dedicatedHostsName: value,
      ...(next ? { dedicatedHostsProfile: "" } : {})
    });
  };

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
                    hint={`AWS GovCloud region where the OpenShift cluster will be deployed.

**Important:** AWS GovCloud is a SEPARATE cloud partition from AWS Commercial - it has physically and logically isolated infrastructure, different API endpoints, separate account system, and stricter compliance controls (FedRAMP High, DoD IL2-5, ITAR, CJIS). You MUST have an AWS GovCloud account to use these regions - commercial AWS accounts cannot access GovCloud regions.

**Why it matters:** GovCloud regions are designed for US federal, state, local, and tribal government customers, plus contractors handling controlled unclassified information (CUI) or export-controlled data. All GovCloud datacenters are on US soil, staffed by US citizens, with enhanced audit/compliance capabilities. Common GovCloud regions: 'us-gov-west-1' (US West - Oregon/California), 'us-gov-east-1' (US East - Ohio).

**Critical:** Once you choose a region, the cluster is permanently tied to it - you cannot migrate to a different region without rebuilding. Region choice impacts latency to end users, disaster recovery planning (each region is independent with separate AZs), and compliance (some regulations mandate specific geographic locations). For multi-AZ high availability, the installer automatically spreads nodes across availability zones within the selected region (most GovCloud regions have 3 AZs).

**Network connectivity:** Ensure your network can reach the selected region's API endpoints and that your mirror registry (if disconnected) is accessible from that region.

**Example:** 'us-gov-west-1' for West Coast federal agencies, 'us-gov-east-1' for East Coast deployments.`}
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
                    hint={'Amazon Machine Image (AMI) ID for Red Hat CoreOS (RHCOS) in the selected AWS GovCloud region. RHCOS is the operating system that runs on all OpenShift cluster nodes. Leave blank to let the installer auto-discover the correct AMI (recommended for most installations). Click "Refresh from installer" button to fetch the recommended AMI ID for your selected region and OpenShift version from official Red Hat metadata. WHEN TO SET MANUALLY: (1) Disconnected/airgap installations where the installer cannot reach Red Hat metadata servers - you must pre-upload the RHCOS AMI to your AWS account and enter its ID here. (2) AWS Secret or Top Secret regions that are not in public Red Hat metadata. (3) When you need to use a specific RHCOS version for testing or compatibility. (4) Custom RHCOS images with site-specific modifications (advanced use case). WHAT IS AN AMI: An AMI is a pre-configured virtual machine image containing an operating system and software. AWS uses AMIs as templates to launch EC2 instances. Each AWS region has separate AMI IDs - an AMI in us-gov-west-1 has a different ID than the same image in us-gov-east-1. RHCOS AMI IDs follow the format "ami-xxxxxxxxxxxxxxxxx" (17 characters after "ami-"). IMPORTANT: The AMI ID must match: (1) Your selected region. (2) Your selected OpenShift version (RHCOS versions are tied to OpenShift releases - 4.14 uses different RHCOS than 4.15). (3) The architecture (x86_64 for most installs, arm64 for Graviton instances). Using the wrong AMI will cause installation to fail or produce unstable clusters. The "Auto-filled" badge indicates the installer metadata populated this field automatically. For connected installs, leave blank or use the Refresh button - the installer handles AMI discovery automatically. Example: "ami-0a1b2c3d4e5f6g7h8" (but use Refresh button instead of guessing).'}
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
                  <FieldLabelWithInfo
                    label="VPC mode"
                    hint={`Choose whether the OpenShift installer creates a new VPC and subnets (installer-managed, the default) or you provide existing subnet IDs (existing subnets, common for production/regulated environments).

**What is a VPC:** A Virtual Private Cloud (VPC) is an isolated virtual network in AWS where you launch resources (EC2 instances, load balancers, databases). It has its own IP address range (CIDR), subnets across availability zones, route tables, internet gateways, and security groups.

**Installer-managed VPC (default):** The installer creates a new VPC, subnets (public and private subnets across multiple AZs), internet gateway, NAT gateways, route tables, and security groups automatically. This is the simplest option - no pre-configuration needed, good for development/testing or when you have no existing network infrastructure. The installer cleans up the VPC if installation fails.

**Existing subnets:** You provide pre-created subnet IDs, and the installer uses them for cluster nodes. Choose this when: (1) Your organization has centralized network teams managing VPCs (common in enterprises). (2) Compliance requires specific network topologies (e.g., no internet gateways, private-only subnets, custom routing). (3) You need to integrate with existing on-premises networks via VPN/Direct Connect. (4) You want to share a VPC across multiple clusters or applications. (5) Disconnected/airgap installs (no public subnets or internet access).

**Important:** When using existing subnets, you must provide subnet IDs in the 'Subnets' field below - typically 3+ subnet IDs spread across different availability zones for high availability (one subnet per AZ). The subnets must have sufficient IP addresses available (at least 20-30 IPs per subnet for a small cluster), correct routing (public subnets need internet gateway route, private subnets need NAT gateway or proxy for outbound), and proper security group rules (allow cluster traffic).

**Networking tab vs VPC subnets:** The Networking tab's Machine/Cluster/Service CIDRs are for internal Kubernetes networking (pod IPs, service IPs) - they are separate from the AWS VPC subnet CIDRs (where EC2 instances get IPs).

**Example:** Choose 'Installer-managed' for quick dev clusters, 'Existing subnets' for production with pre-configured networking.`}
                  >
                    <select
                      value={awsVpcMode}
                      onChange={(e) => updateAws({ vpcMode: e.target.value })}
                    >
                      <option value="installer-managed">Installer-managed VPC (default)</option>
                      <option value="existing">Existing VPC/subnets</option>
                    </select>
                  </FieldLabelWithInfo>
                </div>
                {awsVpcMode === "existing" && (
                  <div className="field-grid field-grid--no-paired-layout">
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
                                hint={`Subnet roles define which OpenShift infrastructure components can use each subnet in existing VPC deployments (OpenShift 4.20+). Leave unassigned to let the installer auto-assign roles, or explicitly assign roles for fine-grained control.

**What are roles:** When you provide existing subnets, OpenShift needs to know which subnets to use for which purposes (cluster nodes, bootstrap, load balancers). Roles tag subnets with their intended use.

**Available roles:** 'ClusterNode' (control plane and worker node VMs land here - required), 'BootstrapNode' (temporary bootstrap VM - required for install), 'IngressControllerLB' (load balancer for ingress/apps traffic - *.apps.<cluster>.<domain>), 'ControlPlaneExternalLB' (load balancer for external API access - api.<cluster>.<domain> - skip this if publish=Internal), 'ControlPlaneInternalLB' (load balancer for internal API access).

**How to assign:** Multi-select one or more roles per subnet. For example, a public subnet might have roles: ClusterNode, BootstrapNode, IngressControllerLB, ControlPlaneExternalLB. A private subnet might have: ClusterNode, ControlPlaneInternalLB.

**Important rules:** (1) If you assign ANY role to ANY subnet, you MUST assign at least one role to EVERY subnet (no mix of auto-assigned and manually-assigned). (2) All required roles must be covered across your subnets - you cannot omit ClusterNode or BootstrapNode. (3) For External publish mode, include ControlPlaneExternalLB on at least one subnet. (4) Subnets can have multiple roles - a single subnet can be used for nodes AND load balancers.

**When to leave blank:** Leave roles unassigned for simpler deployments - the installer will auto-assign roles based on subnet types (public vs private) and tags.

**When to set explicitly:** Set roles when you have specific subnet isolation requirements (e.g., load balancers only in public subnets, nodes only in private subnets), or when the auto-assignment doesn't match your network architecture.

**Example:** Public subnet gets ClusterNode + BootstrapNode + IngressControllerLB + ControlPlaneExternalLB, Private subnet gets ClusterNode + ControlPlaneInternalLB.`}
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
                    hint={`AWS Route 53 hosted zone ID for your base domain (the parent domain under which the OpenShift cluster DNS records will be created). Leave blank UNLESS you are using existing subnets (VPC mode = Existing subnets) AND you have a pre-existing Route 53 hosted zone for your base domain.

**What is Route 53 hosted zone:** Route 53 is AWS's managed DNS service. A hosted zone is a container for DNS records for a specific domain (e.g., 'example.com'). It contains records like A, CNAME, NS that route traffic to your infrastructure. When you create a hosted zone, AWS assigns it a unique ID like 'Z1234567890ABC'.

**Why you might set this:** When using existing VPC/subnets, you often have an existing Route 53 hosted zone for your corporate domain. The OpenShift installer needs to create DNS records for the cluster (api.<cluster>.<domain>, *.apps.<cluster>.<domain>, etcd records, etc.). By providing the hosted zone ID, you tell the installer where to create those records.

**When to leave blank:** (1) Installer-managed VPC mode - the installer creates a new hosted zone automatically. (2) You're not using Route 53 for DNS (e.g., using external DNS servers, bind, corporate DNS). (3) You'll manage DNS records manually or via automation outside the installer.

**Important:** The hosted zone must exist BEFORE installation and must be for your base domain (set in Identity & Access step). For example, if base domain is 'openshift.example.com', you need a hosted zone for 'openshift.example.com' (or 'example.com' if you're creating a subdomain). The zone must be in the same AWS account (unless using shared VPC with cross-account access, see 'Hosted zone role ARN' below).

**Finding the hosted zone ID:** In AWS Console → Route 53 → Hosted zones → click your domain → copy the 'Hosted zone ID' (starts with Z, ~13-14 characters). Or via AWS CLI: 'aws route53 list-hosted-zones-by-name --dns-name example.com'.

**Example:** 'Z1234567890ABC' (but use your actual hosted zone ID). Most installer-managed VPC installs should leave this blank.`}
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
                      hint={`Amazon Resource Name (ARN) of an IAM role in the AWS account that owns the Route 53 hosted zone, used for cross-account DNS record creation in shared VPC scenarios. REQUIRED ONLY when 'Hosted zone is in another account (shared VPC)' checkbox is enabled.

**What is this:** In enterprise AWS environments, you often have separate AWS accounts - e.g., a central 'networking' account owns VPCs and DNS (Route 53 hosted zones), while application teams have separate accounts for running workloads. When you install OpenShift in account A but the Route 53 hosted zone lives in account B, the installer needs permission to create DNS records in account B's hosted zone. You grant this permission via a cross-account IAM role.

**How it works:** (1) In the account that owns the Route 53 hosted zone (account B), create an IAM role with Route 53 permissions (route53:ChangeResourceRecordSets, route53:ListHostedZones, route53:GetChange on the hosted zone). (2) Configure the role's trust policy to allow the installation account (account A) to assume the role. (3) Copy the role's ARN and enter it here. (4) The installer uses STS AssumeRole to temporarily assume this role when creating DNS records.

**ARN format:** 'arn:aws-us-gov:iam::<account-id>:role/<role-name>' for AWS GovCloud (note 'aws-us-gov' partition, not 'aws'). Example: 'arn:aws-us-gov:iam::123456789012:role/OpenShiftDNSAccess'.

**Important:** The role must have permissions on the specific hosted zone you specified in 'Hosted zone ID' above. The trust policy must allow the AWS account where you're installing OpenShift to assume the role (typically via the IAM user or role credentials you use for installation).

**When to use:** Only for shared VPC + cross-account Route 53 scenarios. If your hosted zone and cluster are in the same AWS account, DO NOT set this - leave the checkbox unchecked. Common in large enterprises with centralized networking teams. You can verify the role ARN in AWS Console → IAM → Roles → <role-name> → ARN, or via CLI: 'aws iam get-role --role-name OpenShiftDNSAccess'.

**Example:** 'arn:aws-us-gov:iam::999888777666:role/SharedVPC-Route53-Role'.`}
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
                    hint={`AWS load balancer type to use for cluster API and default ingress router endpoints. Leave blank to use AWS/OpenShift defaults (typically Classic for older regions, NLB for newer).

**What are these:** AWS offers multiple load balancer types - Classic ELB (Elastic Load Balancer, the original), NLB (Network Load Balancer, Layer 4 TCP/UDP), and ALB (Application Load Balancer, Layer 7 HTTP/HTTPS - not used by OpenShift for API/ingress).

**Options:** 'Classic' (legacy Elastic Load Balancer, Layer 7 for HTTP/HTTPS and Layer 4 for TCP) - older technology, still works but being phased out by AWS. 'NLB' (Network Load Balancer, Layer 4 TCP/UDP with optional TLS termination) - recommended for most installations, better performance, lower latency, static IP support, more efficient health checks.

**Recommendation:** Use NLB unless you have a specific compatibility requirement for Classic ELB. NLB is the modern choice with better performance characteristics.

**Why NLB is better:** (1) Lower latency (Layer 4 forwarding vs Layer 7 proxy). (2) Can handle millions of requests per second. (3) Static IP addresses (useful for firewall rules, IP whitelisting). (4) Preserves source IP by default (better for audit logs, access control). (5) More cost-effective at scale. (6) Better TLS termination options.

**When to use Classic:** (1) Legacy environments with existing Classic ELB dependencies. (2) Very specific Layer 7 features needed (rare for OpenShift). (3) Compatibility with older AWS SDK/tooling that doesn't support NLB.

**Important:** This setting affects BOTH the API load balancer (for accessing the Kubernetes API at api.<cluster>.<domain>) and the default ingress controller load balancer (for routing app traffic to *.apps.<cluster>.<domain>). You can change the ingress load balancer type post-install via IngressController resource, but the API load balancer type is set at install time. For most GovCloud installations, NLB is the right choice.

**Example:** Choose 'NLB' for new installations unless you have a specific reason not to.`}
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
                        hint={`AWS EC2 instance type to use for control plane (master) nodes. Leave blank to use OpenShift installer defaults (typically m5.xlarge - 4 vCPUs, 16 GB RAM). Control plane nodes run etcd (cluster database), Kubernetes API server, scheduler, and controller manager - all CPU and memory intensive services.

**Sizing guidance:** Minimum for production: 4 vCPUs, 16 GB RAM (e.g., m5.xlarge). Recommended for production: 8 vCPUs, 32 GB RAM (e.g., m5.2xlarge) for clusters with 100+ nodes or many operators/CRDs. For large clusters (500+ nodes): 16+ vCPUs, 64+ GB RAM (e.g., m5.4xlarge).

**Instance type families:** 'm5' (General Purpose, balanced CPU/memory, recommended for most clusters), 'm6i' (newer generation, slightly better price/performance than m5), 'c5' (Compute Optimized, higher CPU:memory ratio, use if control plane is CPU-bound but not memory-constrained), 'r5' (Memory Optimized, higher memory:CPU ratio, rarely needed for control plane unless running many stateful operators).

**Why it matters:** Control plane performance directly impacts cluster responsiveness. etcd is especially sensitive to CPU latency and disk I/O (use instance types with EBS-optimized networking). Undersized control plane causes API slowness, failed deployments, and cluster instability. Oversized control plane wastes money - for most clusters under 100 nodes, m5.xlarge is sufficient.

**Important:** (1) All control plane nodes use the same instance type (you cannot mix types in install-config). (2) Choose instance types available in your selected AWS GovCloud region - not all types are available in all regions. (3) Consider AWS costs - larger instances are more expensive per hour. (4) Control plane nodes require EBS volumes (root volume) - instance types with EBS optimization are preferred (most m5/m6i/c5/r5 include this).

**Cannot be changed** after installation without rebuilding control plane nodes (complex, risky).

**Example:** 'm5.xlarge' for small/medium clusters (up to 100 nodes), 'm5.2xlarge' for large clusters (100-500 nodes), 'm5.4xlarge' for very large clusters (500+ nodes).`}
                      >
                        <input
                          value={platformConfig.aws?.controlPlaneInstanceType || ""}
                          onChange={(e) => updateAws({ controlPlaneInstanceType: e.target.value })}
                          placeholder="e.g. m5.xlarge"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Worker instance type (optional)"
                        hint={`AWS EC2 instance type to use for worker (compute) nodes. Leave blank to use OpenShift installer defaults (typically m5.large - 2 vCPUs, 8 GB RAM). Worker nodes run your application workloads (pods, containers) - they do NOT run control plane services.

**Sizing guidance:** The right instance type depends entirely on your workload characteristics. General-purpose apps (web services, microservices, CI/CD): m5.large (2 vCPUs, 8 GB) or m5.xlarge (4 vCPUs, 16 GB). CPU-intensive workloads (video encoding, scientific computing, batch processing): c5.xlarge or larger (higher CPU:memory ratio). Memory-intensive workloads (databases, caching, in-memory analytics): r5.xlarge or larger (higher memory:CPU ratio). Mixed workloads or unknown requirements: Start with m5.xlarge (balanced) and adjust based on observed utilization.

**Instance type families:** 'm5' (General Purpose, balanced, most common choice), 'm6i' (newer gen, better price/performance), 'c5/c6i' (Compute Optimized, 2:1 CPU:memory vs m5's 1:4), 'r5/r6i' (Memory Optimized, 1:8 CPU:memory), 't3' (Burstable, cheap but unpredictable performance - NOT recommended for production), 'm5n/c5n' (Enhanced networking for high-throughput apps).

**Important:** (1) This sets the DEFAULT worker instance type - you can override per-MachineSet post-install if you need different worker types for different workloads (e.g., m5.large for general workers, r5.2xlarge for database-specific workers). (2) Verify instance type availability in your selected AWS GovCloud region. (3) Consider costs - workers are the bulk of your cluster cost. Start small and scale up or change types post-install based on workload metrics. (4) More smaller workers often better than fewer large workers (improves pod distribution, failure isolation, and bin-packing efficiency). Unlike control plane, you CAN change worker instance types post-install by editing MachineSets (though existing workers keep their old type until replaced).

**Example:** 'm5.large' for light workloads, 'm5.xlarge' for general production, 'c5.2xlarge' for compute-heavy batch jobs, 'r5.2xlarge' for databases/caching.`}
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
                        hint={`Size in gibibytes (GiB) for the root EBS volume attached to each EC2 instance (both control plane and worker nodes). The root volume contains the operating system (RHCOS - Red Hat CoreOS), container runtime, etcd data (on control plane), and local ephemeral storage. Leave blank to use AWS/OpenShift defaults (typically 120 GiB for control plane, 120 GiB for workers).

**Important:** This is GiB (gibibytes), not GB - 1 GiB = 1.074 GB. Common values: 100-300 GiB. For production control plane nodes, 200+ GiB is recommended to handle etcd growth and log accumulation. For workers, size depends on workload - minimal workers can use 120 GiB, but workloads with heavy local storage needs (databases, caching) should use 300+ GiB.

**Critical:** EBS volumes cannot be shrunk after creation, only expanded - plan for growth upfront. You can expand volumes post-install but it requires node draining and manual steps. Setting this value applies the same size to ALL nodes (control plane and compute); you cannot set different sizes per pool in install-config (that requires post-install customization via MachineSet). Cost consideration: larger volumes cost more per month - balance capacity needs against AWS EBS pricing.

**Example:** 200 for control plane with room to grow, 150 for general workers, 500 for workers with local databases.`}
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
                        hint={`AWS EBS volume type for root volumes on all cluster nodes (control plane and workers). Leave blank to use the AWS default (typically gp3 - General Purpose SSD version 3, the latest and most cost-effective option).

**Common types:** gp3 (General Purpose SSD v3, recommended for most workloads - better price/performance than gp2, up to 16,000 IOPS, 1,000 MB/s throughput), gp2 (General Purpose SSD v2, older generation, still works but gp3 is better), io1/io2 (Provisioned IOPS SSD, for I/O-intensive workloads requiring guaranteed high IOPS - expensive, typically only for control plane in very large clusters where etcd performance is critical), st1 (Throughput Optimized HDD, cheap but low performance - NOT recommended for OpenShift), sc1 (Cold HDD, very cheap but very slow - NOT recommended).

**Recommendation:** Use gp3 for most installations (best balance of cost and performance). Only use io1/io2 if you have specific IOPS requirements (e.g., etcd in 500+ node clusters, or workers running high-IOPS databases).

**Why it matters:** EBS volume type affects both performance (IOPS, throughput) and cost. gp3 volumes can deliver up to 16,000 IOPS which is sufficient for almost all OpenShift workloads. io1/io2 costs significantly more but provides guaranteed IOPS above 16k. For control plane nodes, adequate IOPS is critical for etcd health - but gp3 handles this well for clusters under 500 nodes. Setting this value applies to ALL nodes in the cluster (both control plane and compute).`}
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
                        hint={`Number of control plane nodes (master nodes) to create during installation. REQUIRED: Must be an odd number for etcd quorum. Standard value is 3 (minimum for production high-availability). WHY ODD NUMBERS: etcd (the cluster's key-value store) requires a quorum (majority) to function - with 3 nodes, the cluster can survive 1 node failure (2 of 3 remaining = quorum). With 5 nodes, you can survive 2 failures (3 of 5 remaining = quorum). IMPORTANT: More control plane nodes does NOT always mean better availability. 3 nodes is the sweet spot for most deployments - it provides HA at reasonable cost. 5 nodes is only needed for very large clusters (500+ nodes) or when you need to survive 2 simultaneous control plane failures. NEVER use even numbers (2, 4, 6) - with 2 nodes, losing 1 means no quorum and the cluster stops functioning; with 4 nodes, losing 2 means no quorum, so you're paying for 4 but can only survive 1 failure (same as 3 nodes). Each control plane node runs etcd, the Kubernetes API server, controller manager, and scheduler - these are CPU/memory intensive. For AWS GovCloud, control plane nodes are EC2 instances (you pay for them). Default: 3. Use 5 only for very large or mission-critical clusters. CANNOT be changed after installation without rebuilding the cluster.`}
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
                        hint={`Number of worker nodes (also called compute nodes) to create during installation. Workers run your application workloads (pods, containers). Unlike control plane, you CAN scale workers up or down after installation via MachineSets. Minimum recommended: 2 workers for production (allows workload redundancy and rolling updates). You can set 0 for a control-plane-only cluster (sometimes called a 'compact cluster') where control plane nodes also run workloads - this is supported but NOT recommended for production (reduces isolation, risks resource contention with etcd/API server). SIZING GUIDANCE: For development/testing: 2-3 workers is fine. For production: Start with 3+ workers. For high availability, spread workers across multiple AWS availability zones (the installer does this automatically in IPI mode). Each worker is an EC2 instance - more workers = higher AWS cost, but also more capacity for workloads. You can start small (3 workers) and scale up post-install as workload demands grow by editing MachineSets. BEST PRACTICE: Use at least 2 workers to ensure workload pods can be rescheduled if a worker fails. If running stateful workloads or databases, consider 5+ workers for better resilience. Default: 0 (you must explicitly set a count for UPI, IPI often defaults to 3). Example: 3 for small production, 5 for medium, 10+ for large workloads or multi-AZ redundancy.`}
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
                    hint={`External (default): API and ingress published to public DNS/load balancer. Use for clusters reachable from the internet or external networks. Required when apps/API must be accessed without VPN. Internal: All cluster endpoints are private-network only. DNS must resolve internally. Required by some compliance regimes. Note: console.redhat.com cluster management and direct Red Hat update checks will not reach the cluster without additional network routing. Recommendation: External for most installs. Internal only when external exposure is explicitly prohibited.`}
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
                    hint={`Mint (recommended for IPI): CCO creates scoped cloud credentials for each cluster component from your admin credential. Each component gets minimal permissions. Requires IAM rights to create new users/roles. Best choice when you have full IAM admin access. Passthrough: CCO passes your install-time admin credential to all components — no new IAM identities created. Use when your org prohibits new IAM account creation. All components share the broad admin credential. Manual: You provision credentials yourself before install (e.g. via ccoctl for STS/Workload Identity). Required for air-gapped AWS STS installs, highly regulated environments. Most secure, most complex. Must run ccoctl before openshift-install. Nutanix IPI always requires Manual — enforced automatically.`}
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
                description="When enabled, install-config can include §9.1.4 optional platform.baremetal provisioning* (when set) and hosts[] with name, bootMACAddress, and bmc only (per 4.20 doc; not used during initial provisioning). role and rootDeviceHints stay in agent-config only. When disabled, install-config stays minimal (apiVIPs/ingressVIPs) and agent-config carries install-time host fields."
              >
                <Switch
                  checked={!!inventory.includeBareMetalDay2InInstallConfig}
                  onChange={(checked) => updateInventory({ includeBareMetalDay2InInstallConfig: checked })}
                  aria-label="Include optional Day-2 bare metal in install-config"
                />
              </OptionRow>
              <p className="note subtle" style={{ marginTop: 8, marginBottom: 0 }}>
                Enabled: optional <code>platform.baremetal.provisioningNetwork</code> (Managed or Disabled), related provisioning* keys when set, and <code>hosts[]</code> with <code>name</code>, <code>bootMACAddress</code>, <code>bmc.*</code> only (§9.1.4; not used during initial provisioning). <code>role</code> and <code>rootDeviceHints</code> are not in install-config—use Host Inventory for agent-config. Disabled: <code>apiVIPs</code>/<code>ingressVIPs</code> only on <code>platform.baremetal</code>.
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
                  hint={`Azure cloud environment name for Azure Government deployments. For Azure Government (US federal/state/local government customers), this must be set to 'AzureUSGovernmentCloud' - this is the sovereign cloud instance physically and logically isolated from Azure Commercial (public cloud).

**Important:** This is NOT the same as Azure Commercial (AzurePublicCloud) - Azure Government runs on separate datacenters with restricted access, US-only data residency, and FedRAMP High/DoD IL2-5 compliance.

**Why it matters:** Setting the correct cloud name determines which Azure endpoints the installer and cluster components contact - using AzurePublicCloud endpoints from a Government subscription (or vice versa) will fail authentication. Azure Government has different API endpoints (management.usgovcloudapi.net vs management.azure.com), different portal (portal.azure.us vs portal.azure.com), and geographically separate regions (USGov Virginia, USGov Texas, etc.).

**When to use:** For commercial Azure deployments, use the regular Azure IPI scenario instead - this Azure Government scenario is specifically for sovereign cloud customers with Azure Government subscriptions. The dropdown typically shows only AzureUSGovernmentCloud because that's the only supported value for Government deployments in this context. If you need Azure China (AzureChinaCloud) or other sovereign clouds, consult OpenShift documentation for supported configurations.`}
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
                  hint={`Azure Government region where the cluster will be deployed. This determines the physical datacenter location for all cluster resources (VMs, storage, networking).

**Common regions:**
• usgovvirginia (US Gov Virginia - primary region, most services)
• usgovtexas (US Gov Texas - secondary region)
• usgovarizona (US Gov Arizona)
• usdodeast (US DoD East - DoD IL5)
• usdodcentral (US DoD Central - DoD IL5)

**Important:** Not all Azure Government regions support all VM types or OpenShift features - usgovvirginia and usgovtexas are the most complete. Check Azure Government region availability for the VM sizes you need.

**Why it matters:** The region affects latency (choose closest to your users), compliance (DoD regions for DoD IL5 workloads), and pricing (some regions cost more). All cluster resources (VMs, managed disks, load balancers, NSGs) must be in the same region - you cannot spread a cluster across regions. For high availability across regions, you must deploy separate clusters per region.

**Data residency:** Azure Government guarantees all data stays within the selected US region - critical for compliance requirements.

**Example:** Enter 'usgovvirginia' (no quotes) for US Gov Virginia region. The exact region name must match Azure's region identifier (lowercase, no spaces). You can find region names in the Azure Government portal under Resource Groups → Create → Region dropdown, or via 'az account list-locations --output table' from Azure CLI.`}
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
                  hint={`Name of the Azure resource group where the installer will create all cluster resources (VMs, disks, NSGs, load balancers, public IPs, availability sets, etc.). This resource group must ALREADY EXIST before installation - the installer will not create it.

**Why a resource group:** In Azure, a resource group is a container that holds related resources for an Azure solution. All cluster infrastructure goes into this one resource group for easier management, billing tracking, and cleanup (delete the entire cluster by deleting the resource group).

**Important:** Use a dedicated resource group for the OpenShift cluster - do not share it with other applications or infrastructure. The installer needs extensive permissions on this resource group (create VMs, networks, storage, etc.). After installation, the cluster's cloud-provider integration continues using this resource group to create resources like persistent volumes (managed disks) and load balancers for services.

**Naming:** Choose a descriptive name that clearly identifies this cluster (e.g., 'ocp-prod-cluster-rg' or 'openshift-dev-usgovva'). Resource group names are case-insensitive, can contain letters, numbers, hyphens, underscores, periods, and parentheses, and must not end with a period.

**Create it first:** Before running openshift-install, create this resource group in Azure Government portal or via Azure CLI: 'az group create --name <your-rg-name> --location usgovvirginia'. The resource group's region should match the region you specified above. You can find existing resource groups in Azure portal → Resource groups, or list them via 'az group list --output table'. This is DIFFERENT from baseDomainResourceGroupName (which holds the DNS zone) - you can use the same resource group for both if desired, but separating them is common.`}
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
                  hint={`Name of the Azure resource group that contains the DNS zone for your base domain (the parent domain under which the cluster will be created). This resource group must ALREADY EXIST and must contain a properly configured Azure DNS zone matching your base domain.

**What is this:** When you set a base domain like 'example.com' in Identity & Access, OpenShift needs to create DNS records for the cluster (e.g., api.my-cluster.example.com, *.apps.my-cluster.example.com). In Azure, DNS zones are managed resources that live in a resource group - this field tells the installer which resource group holds the DNS zone for your domain.

**Example:** If your base domain is 'example.com' and you have an Azure DNS zone for 'example.com' in resource group 'dns-zones-rg', enter 'dns-zones-rg' here. The installer will then create DNS records in that zone for your cluster.

**Can it be the same as cluster resource group?** Yes, you can use the same resource group name as 'Resource group name' above if your DNS zone lives in the same resource group where cluster resources will be created. Alternatively, you might have a centralized 'dns-rg' that holds DNS zones for multiple clusters/applications - that's fine too.

**Critical requirement:** The Azure service principal or managed identity used for installation must have 'DNS Zone Contributor' role (or equivalent permissions) on this resource group and the DNS zone inside it. Without DNS permissions, the installer cannot create required DNS records and installation will fail.

**Prerequisites before install:**
1. Create the resource group if it doesn't exist
2. Create an Azure DNS zone for your base domain in that resource group
3. Delegate your domain to Azure's nameservers (get NS records from the Azure DNS zone, add them to your domain registrar)
4. Verify delegation works: 'dig NS example.com' should return Azure nameservers

You can find DNS zones in Azure portal → DNS zones, or list them via 'az network dns zone list --output table'.`}
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
                  hint={`External (default): API and ingress published to public DNS/load balancer. Use for clusters reachable from the internet or external networks. Required when apps/API must be accessed without VPN. Internal: All cluster endpoints are private-network only. DNS must resolve internally. Required by some compliance regimes. Note: console.redhat.com cluster management and direct Red Hat update checks will not reach the cluster without additional network routing. Recommendation: External for most installs. Internal only when external exposure is explicitly prohibited.`}
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
                  hint={`Mint (recommended for IPI): CCO creates scoped cloud credentials for each cluster component from your admin credential. Each component gets minimal permissions. Requires IAM rights to create new users/roles. Best choice when you have full IAM admin access. Passthrough: CCO passes your install-time admin credential to all components — no new IAM identities created. Use when your org prohibits new IAM account creation. All components share the broad admin credential. Manual: You provision credentials yourself before install (e.g. via ccoctl for STS/Workload Identity). Required for air-gapped AWS STS installs, highly regulated environments. Most secure, most complex. Must run ccoctl before openshift-install. Nutanix IPI always requires Manual — enforced automatically.`}
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
                  hint={`${metaIbmRegion?.description ? `${metaIbmRegion.description} ` : ""}IBM Cloud region where the OpenShift cluster will be deployed. This determines which IBM Cloud datacenters host your cluster infrastructure (VMs, storage, load balancers, networks).

**Important:** The region you choose must match the location of your existing VPC and subnets (if using existing VPC mode), and must contain sufficient capacity for your chosen instance types.

**Common regions:**
• 'us-east' (Washington DC)
• 'us-south' (Dallas)
• 'eu-de' (Frankfurt)
• 'eu-gb' (London)
• 'jp-tok' (Tokyo)
• 'au-syd' (Sydney)
• 'ca-tor' (Toronto)
• 'jp-osa' (Osaka)
• 'br-sao' (Sao Paulo)

Each region is completely independent with separate API endpoints, resource namespaces, and billing.

**Why it matters:** Region choice impacts latency to end users, data residency compliance (GDPR, data sovereignty), disaster recovery planning, and cost (some regions have different pricing). For disconnected/airgap installations, the region must have network connectivity to your mirror registry and any required external services. The region also determines which availability zones (AZs) are available for multi-zone high-availability deployments - most IBM Cloud regions have 2-3 AZs.

**Cannot be changed:** The region is permanently set at installation time - you cannot migrate a cluster to a different region without rebuilding it entirely.

**Example:** 'us-east' for a US East Coast deployment. You can find available regions and their status via IBM Cloud CLI: 'ibmcloud regions' or in the IBM Cloud console → Locations.`}
                  required={metaIbmRegion?.required || isRequiredInstall("platform.ibmcloud.region")}
                  className="platform-specifics-field-short"
                >
                  <input
                    value={platformConfig.ibmcloud?.region || ""}
                    onChange={(e) => updateIbmCloud({ region: e.target.value })}
                    placeholder="e.g. us-east"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Resource group name (optional)"
                  hint={`${metaIbmResourceGroupName?.description ? `${metaIbmResourceGroupName.description} ` : ""}Name of the IBM Cloud resource group where cluster-managed infrastructure will be created (VMs, load balancers, security groups, public IPs, etc.). Leave blank to use your IBM Cloud account's default resource group.

**What is a resource group:** In IBM Cloud, resource groups are logical containers for organizing and managing related resources. They control access (IAM policies), billing (cost tracking by group), and quota management.

**Why specify one:** Using a dedicated resource group for your OpenShift cluster makes it easier to track costs (all cluster expenses in one group), apply consistent IAM permissions (grant team access to the group), and manage lifecycle (delete the entire cluster by removing the resource group).

**Important:** This is DIFFERENT from 'Network resource group name' (which holds existing VPC/subnets in Existing VPC mode). If both fields are set to the same value, it means your VPC and cluster resources live in the same resource group - this is fine for smaller setups. Larger organizations often separate network resources (VPCs, subnets, transit gateways) into a centralized 'network-rg' and individual cluster resources into per-cluster groups like 'ocp-prod-cluster-rg'.

**Permissions:** The IBM Cloud API key or service ID used for installation must have Editor or Administrator role on this resource group to create cluster infrastructure.

**Example:** 'ocp-prod-cluster-rg' or 'openshift-dev-useast'. If left blank, the installer uses the account's default resource group (typically named 'Default'). You can find existing resource groups via IBM Cloud CLI: 'ibmcloud resource groups' or in the console → Manage → Account → Resource groups.`}
                  className="platform-specifics-field-medium"
                >
                  <input
                    value={platformConfig.ibmcloud?.resourceGroupName || ""}
                    onChange={(e) => updateIbmCloud({ resourceGroupName: e.target.value })}
                    placeholder="cluster-resource-group"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Instance type (optional)"
                  hint={`${metaIbmType?.description ? `${metaIbmType.description} ` : ""}IBM Cloud Virtual Server Instance (VSI) profile to use for cluster nodes (both control plane and compute unless overridden in Machine Pools). A VSI profile defines the CPU/memory configuration for each VM. Leave blank to use OpenShift installer defaults (typically bx2-4x16 for control plane, bx2-4x16 for workers).

**Profile format:** Profiles follow the pattern <family>-<vcpu>x<memory_gb>. Examples: 'bx2-4x16' (Balanced 2nd gen, 4 vCPUs, 16GB RAM), 'bx2-8x32' (8 vCPUs, 32GB RAM), 'cx2-4x8' (Compute 2nd gen, 4 vCPUs, 8GB RAM - higher CPU:memory ratio), 'mx2-8x64' (Memory 2nd gen, 8 vCPUs, 64GB RAM - memory-optimized).

**Important:** For production control plane nodes, use at least 4 vCPUs and 16GB RAM - etcd, API server, and controllers are CPU/memory intensive. 'bx2-8x32' or larger recommended for clusters with 100+ nodes or many operators. For worker nodes, size based on workload - 'bx2-4x16' for general apps, 'cx2-8x16' for compute-heavy workloads, 'mx2-8x64' for memory-intensive apps (databases, caching).

**Cost:** Larger profiles cost more per hour - balance capacity needs against IBM Cloud pricing.

**Availability:** Not all profiles are available in all regions/zones - verify availability via 'ibmcloud is instance-profiles' CLI command or IBM Cloud console. The installer validates profile availability during preflight.

**Example:** 'bx2-8x32' for production control plane. You can override this default per-pool in the Machine Pools section if different node types need different sizing.`}
                  className="platform-specifics-field-short"
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
                  hint={`Determines whether the OpenShift installer creates a new IBM Cloud Virtual Private Cloud (VPC) and subnets automatically, or uses your pre-existing VPC infrastructure.

**What is an IBM Cloud VPC:**
A Virtual Private Cloud is an isolated virtual network in IBM Cloud where you deploy resources (virtual servers, load balancers, subnets). It provides network isolation, security groups, access control lists (ACLs), and connectivity options (public gateways, VPN, Direct Link).

**Deployment modes:**

**Installer-managed VPC:**
• The installer creates a new VPC, subnets (across multiple availability zones), public gateways, security groups, and load balancers automatically
• Simplest option - no pre-configuration required
• Good for development, testing, or when you have no existing network infrastructure
• The installer cleans up VPC resources if installation fails

**Existing VPC and subnets:**
• You provide pre-created VPC and subnet names, and the installer uses them for cluster nodes
• Choose this when:
  - Your organization has centralized network teams managing VPCs (common in enterprises)
  - Compliance requires specific network topologies (e.g., private-only subnets, custom routing, no public gateways)
  - You need to integrate with existing on-premises networks via VPN or Direct Link
  - You want to share a VPC across multiple clusters or applications
  - Disconnected/airgap installations (no public subnets or internet access)

**When using existing VPC:**
• You must provide VPC name and subnet names in the 'Network resource group name', 'VPC name', 'Control plane subnets', and 'Compute subnets' fields below
• The VPC must have subnets across multiple availability zones for high availability (typically 3 zones)
• Subnets must have sufficient IP addresses available (at least 20-30 IPs per subnet for a small cluster)
• For connected installs: Public gateway or floating IPs required for outbound internet access
• For disconnected: Proper routing to mirror registry and required services

**Important notes:**
• This choice controls which VPC-related fields are shown in the UI and which fields are emitted to install-config.yaml
• Installer-managed VPC is simpler but gives you less control over network topology
• Existing VPC requires more upfront setup but provides full control and integration with enterprise networking

**Example:**
Choose 'Installer-managed VPC' for quick dev clusters or proof-of-concepts. Choose 'Existing VPC and subnets' for production deployments with pre-configured enterprise networking.`}
                  className="platform-specifics-field-medium"
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
                  hint={`${metaIbmNetworkResourceGroupName?.description ? `${metaIbmNetworkResourceGroupName.description} ` : ""}Name of the IBM Cloud resource group that contains your existing VPC, subnets, and related network resources (security groups, public gateways, etc.). REQUIRED when using 'Existing VPC and subnets' mode.

**What this does:** The installer needs to know where to find your pre-created VPC and subnets so it can attach cluster VMs to the correct networks. In IBM Cloud, resources belong to resource groups - this field tells the installer which group holds your networking infrastructure.

**Important:** This is typically DIFFERENT from 'Resource group name' (which holds cluster-managed resources like VMs and load balancers). Many organizations use a centralized 'network-rg' for VPCs shared across multiple clusters, and separate per-cluster resource groups like 'ocp-prod-rg' for cluster-specific infrastructure. However, you CAN use the same resource group for both if your network and compute resources are co-located.

**Prerequisites:**
1. The resource group must already exist
2. The VPC and subnets specified in the fields below must exist within this resource group in the selected region
3. The IBM Cloud API key or service ID used for installation must have Viewer or Editor role on this resource group to read VPC/subnet details and attach VMs

**Example:** 'shared-network-rg' if you have a centralized network team, or 'ocp-prod-rg' if network and cluster resources are in the same group. You can find existing resource groups and their contents via 'ibmcloud resource groups' and 'ibmcloud is vpcs --resource-group-name <name>'.`}
                  required={true}
                  className="platform-specifics-field-medium"
                >
                  <input
                    value={platformConfig.ibmcloud?.networkResourceGroupName || ""}
                    onChange={(e) => updateIbmCloud({ networkResourceGroupName: e.target.value })}
                    placeholder="existing-network-rg"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="VPC name"
                  hint={`${metaIbmVpcName?.description ? `${metaIbmVpcName.description} ` : ""}Name of the existing IBM Cloud VPC (Virtual Private Cloud) where cluster nodes will be deployed. REQUIRED when using 'Existing VPC and subnets' mode.

**What is a VPC:** A VPC is an isolated private network within IBM Cloud where you create subnets, VMs, load balancers, and security groups. It provides network isolation (resources in one VPC cannot communicate with another VPC unless explicitly connected via transit gateways or VPN).

**Important:** The VPC must ALREADY EXIST in the selected region within the 'Network resource group name' you specified above. The installer will NOT create the VPC - it only reads VPC details to attach cluster VMs to the correct subnets.

**Prerequisites before install:**
1. VPC created in the same region as your cluster
2. VPC must have subnets with available IP addresses (one subnet per availability zone minimum - typically 3 subnets for HA)
3. VPC must have DNS resolution enabled (default)
4. For External publish mode, VPC needs a public gateway attached to subnets for outbound internet access (downloading images, reaching Red Hat registries in connected mode)
5. For disconnected/airgap, VPC subnets must have routes to your mirror registry and any required internal services

**Networking:** The VPC's IP address range (CIDR) is independent of the Networking tab's Machine/Service/Cluster CIDRs - those are for internal OpenShift networking (pod/service IPs). The VPC subnets you specify in 'Control plane subnets' and 'Compute subnets' fields below are where the VMs' primary interfaces get IPs.

**Example:** 'prod-vpc-us-east' or 'openshift-network-vpc'. You can find existing VPCs via 'ibmcloud is vpcs --resource-group-name <rg-name>' or in the IBM Cloud console → VPC Infrastructure → VPCs.`}
                  required={true}
                  className="platform-specifics-field-medium"
                >
                  <input
                    value={platformConfig.ibmcloud?.vpcName || ""}
                    onChange={(e) => updateIbmCloud({ vpcName: e.target.value })}
                    placeholder="existing-vpc-name"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Control plane subnets"
                  hint={`${metaIbmControlPlaneSubnets?.description ? `${metaIbmControlPlaneSubnets.description} ` : ""}Comma-separated list of existing subnet names within the VPC where control plane nodes (master nodes) will be deployed. REQUIRED when using 'Existing VPC and subnets' mode.

**What this does:** Each control plane node gets a primary network interface attached to one of these subnets - the VM's IP address comes from the subnet's CIDR range.

**High availability:** For production clusters, specify multiple subnets across different availability zones (AZs) to ensure control plane survives AZ failures. Example: 'cp-subnet-zone1,cp-subnet-zone2,cp-subnet-zone3' for 3-zone HA (each control plane node lands in a different zone/subnet).

**Important:** These subnet names must be exact matches (case-sensitive) to subnet names that ALREADY EXIST in the VPC you specified above. You can list existing subnets via 'ibmcloud is subnets --vpc-name <vpc-name>' or in IBM Cloud console → VPC Infrastructure → Subnets.

**Requirements:**
1. Subnets must exist in the same VPC and region
2. Subnets should have available IP addresses (at least 1 IP per control plane node - typically 3 IPs total for a 3-node HA cluster, but plan for 5-10 IPs to account for upgrades/replacements)
3. Subnets must allow inbound traffic on ports 6443 (API server), 2379-2380 (etcd), 10250-10259 (kubelet/controllers) from worker subnets
4. For External publish mode, control plane subnets need outbound internet access via public gateway or NAT (for downloading images, reaching Red Hat in connected mode)
5. For disconnected/airgap, subnets must route to mirror registry and required internal services

**Format:** Subnet names separated by commas with no spaces. These are IBM Cloud subnet resource names, NOT CIDR ranges (CIDRs are defined when you created the subnets).

**Example:** 'ocp-cp-us-east-1,ocp-cp-us-east-2,ocp-cp-us-east-3'`}
                  required={true}
                  className="platform-specifics-field-long"
                >
                  <input
                    value={platformConfig.ibmcloud?.controlPlaneSubnets || ""}
                    onChange={(e) => updateIbmCloud({ controlPlaneSubnets: e.target.value })}
                    placeholder="cp-subnet-a,cp-subnet-b,cp-subnet-c"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Compute subnets"
                  hint={`${metaIbmComputeSubnets?.description ? `${metaIbmComputeSubnets.description} ` : ""}Comma-separated list of existing subnet names within the VPC where worker nodes (compute nodes) will be deployed. REQUIRED when using 'Existing VPC and subnets' mode.

**What this does:** Each worker node gets a primary network interface attached to one of these subnets - the VM's IP address comes from the subnet's CIDR range. Worker nodes run your application pods and handle ingress traffic.

**High availability:** For production clusters, specify multiple subnets across different availability zones (AZs) to ensure workloads survive AZ failures. Example: 'worker-subnet-zone1,worker-subnet-zone2,worker-subnet-zone3' for 3-zone HA. As the cluster scales (adding more workers), new nodes are distributed across these subnets.

**Important:** These subnet names must be exact matches (case-sensitive) to subnet names that ALREADY EXIST in the VPC you specified above. You can list existing subnets via 'ibmcloud is subnets --vpc-name <vpc-name>' or in IBM Cloud console → VPC Infrastructure → Subnets.

**Requirements:**
1. Subnets must exist in the same VPC and region
2. Subnets should have MORE available IP addresses than control plane subnets - plan for growth (50-100+ IPs per subnet for clusters that will scale to 50+ workers)
3. Subnets must allow inbound traffic on port 10250 (kubelet) from control plane, and application-specific ports for ingress
4. Subnets must have outbound connectivity to control plane subnets (ports 6443, 2379-2380, 10250-10259)
5. For External publish mode with LoadBalancer services, subnets need internet connectivity via public gateway
6. For disconnected/airgap, subnets must route to mirror registry and internal services

**Can they be the same as control plane subnets?** Yes, you can use the same subnet names for both control plane and compute if you want all nodes on the same subnets - this simplifies networking but reduces isolation between control plane and workload traffic. Many setups separate them for security/performance isolation.

**Format:** Subnet names separated by commas with no spaces. These are IBM Cloud subnet resource names, NOT CIDR ranges.

**Example:** 'ocp-worker-us-east-1,ocp-worker-us-east-2,ocp-worker-us-east-3'`}
                  required={true}
                  className="platform-specifics-field-long"
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
              <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                Choose one path: set a dedicated host profile to create/use a profile-based host, or set an existing dedicated host name. Do not set both.
              </p>
              <div className="field-grid" style={{ marginTop: 8, marginBottom: 16 }}>
                <FieldLabelWithInfo
                  label="Dedicated host profile (optional)"
                  hint={`${metaIbmDedicatedHostsProfile?.description ? `${metaIbmDedicatedHostsProfile.description} ` : ""}IBM Cloud dedicated host profile to use when cluster VMs must run on single-tenant physical servers instead of shared multi-tenant infrastructure. Leave blank to use standard shared virtual servers (default, most common).

**What is a dedicated host:** A dedicated host is a single-tenant physical server in IBM Cloud where only your VMs run - no other customers' workloads share the hardware. Dedicated hosts provide physical isolation for compliance, licensing, or performance reasons.

**Why use dedicated hosts:**
1. Compliance requirements mandate physical isolation (e.g., PCI-DSS Level 1, HIPAA, government regulations)
2. Software licensing is per-physical-host rather than per-VM (e.g., some database licenses - running on dedicated hosts can reduce costs)
3. Performance isolation - no 'noisy neighbor' effect from other tenants
4. Security requirements prohibit multi-tenancy

**Profile format:** Dedicated host profiles define the physical server specs (CPU family, core count, memory). Examples: 'cx2-host-152x304' (152 vCPUs, 304 GB RAM, Compute family), 'bx2-host-100x200' (100 vCPUs, 200 GB RAM, Balanced family), 'mx2-host-100x800' (100 vCPUs, 800 GB RAM, Memory family). The profile determines how many VMs you can fit on the host.

**How it works:**
1. Specify a profile here - IBM Cloud creates or assigns a dedicated host with that profile
2. All cluster VMs (control plane + workers) are placed on dedicated hosts with this profile
3. The installer automatically provisions hosts as needed for your cluster size

**Important:** Dedicated hosts are SIGNIFICANTLY more expensive than shared VMs - you pay for the entire physical server even if you only use a portion of its capacity. Only use dedicated hosts when you have specific compliance, licensing, or isolation requirements. You cannot mix dedicated hosts and shared VMs in the same cluster via install-config (requires post-install MachineSet customization).

**Choose one:** Set either 'Dedicated host profile' (to create new dedicated hosts) OR 'Dedicated host name' (to use a specific pre-existing dedicated host), NOT both.

**Example:** 'bx2-host-100x200' for balanced workloads, 'cx2-host-152x304' for compute-intensive clusters. Available profiles vary by region - verify via 'ibmcloud is dedicated-host-profiles' CLI command or IBM Cloud console.`}
                  className="platform-specifics-field-medium"
                >
                  <input
                    value={platformConfig.ibmcloud?.dedicatedHostsProfile || ""}
                    onChange={(e) => setIbmDedicatedHostsProfile(e.target.value)}
                    placeholder="e.g. cx2-host-152x304"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Dedicated host name (optional)"
                  hint={`${metaIbmDedicatedHostsName?.description ? `${metaIbmDedicatedHostsName.description} ` : ""}Name of a specific pre-existing IBM Cloud dedicated host where cluster VMs should be placed. Leave blank to let the installer create new dedicated hosts automatically (via 'Dedicated host profile' above) or to use standard shared virtual servers.

**What is this:** If you already have a dedicated host provisioned in IBM Cloud and want to place OpenShift cluster VMs on that specific host, enter its name here. This is useful when you want to maximize utilization of existing dedicated host capacity or when you have pre-allocated dedicated hosts for specific projects.

**When to use:**
1. You have an existing dedicated host with available capacity (unused vCPUs and memory) that you want to use for OpenShift
2. Your organization has pre-provisioned dedicated hosts for compliance/licensing and you want to place this cluster on a specific one
3. You want precise control over which physical server hosts your cluster (vs letting the installer auto-provision)

**How to find the host name:** In IBM Cloud console → VPC Infrastructure → Dedicated hosts → select your host → copy the 'Name' field. Or via CLI: 'ibmcloud is dedicated-hosts' to list all dedicated hosts in your account. Example names: 'my-dedicated-host-1', 'prod-ocp-host', 'dedicated-host-useast'.

**Important requirements:**
1. The dedicated host must ALREADY EXIST in the same VPC region as your cluster
2. The host must have SUFFICIENT REMAINING CAPACITY for all cluster VMs (control plane + workers). Check the host's used vs available vCPUs and memory before installation
3. All cluster VMs will attempt to fit on this single host - if capacity is exceeded, installation will fail. For multi-host deployments or auto-provisioning, use 'Dedicated host profile' instead
4. The dedicated host must be in the same resource group as your cluster (or you need cross-resource-group permissions)

**Choose one:** Set either 'Dedicated host name' (to use a specific pre-existing host) OR 'Dedicated host profile' (to create new hosts), NOT both. If you set a dedicated host name, the installer places ALL cluster VMs on that one host (assuming capacity allows).

**Example:** 'my-existing-dedicated-host' (must match exact name in IBM Cloud).`}
                  className="platform-specifics-field-medium"
                >
                  <input
                    value={platformConfig.ibmcloud?.dedicatedHostsName || ""}
                    onChange={(e) => setIbmDedicatedHostsName(e.target.value)}
                    placeholder="existing-dedicated-host"
                  />
                </FieldLabelWithInfo>
              </div>

              <h4 className="platform-specifics-subsection">Service endpoint overrides (optional)</h4>
              <div className="field-grid" style={{ marginTop: 8, marginBottom: 16 }}>
                <FieldLabelWithInfo
                  label="Service endpoints (optional)"
                  hint={`${metaIbmServiceEndpoints?.description ? `${metaIbmServiceEndpoints.description} ` : ""}Override IBM Cloud service API endpoints when the default public endpoints are unreachable from your cluster network (e.g., for private/disconnected/restricted clusters). Leave blank to use IBM Cloud's default public endpoints.

**When to use:** Set custom endpoints when:
1. Your cluster has no outbound internet access (disconnected/airgap)
2. Your VPC uses private service endpoints only (no public connectivity)
3. Corporate policies require routing cloud API calls through specific proxy/gateway URLs
4. You are using IBM Cloud Direct Link or VPN and must access IBM services via private network paths

**Format:** One NAME=URL pair per line, where NAME is the IBM Cloud service name (uppercase) and URL is the service endpoint. Common services that may need overrides: IAM (identity/authentication), VPC (networking), Resource Controller (resource management), COS (object storage), CIS (cloud internet services).

**Example overrides for private endpoints in us-east region:**
• IAM=https://private.us-east.iam.cloud.ibm.com
• VPC=https://us-east.private.iaas.cloud.ibm.com/v1
• ResourceController=https://private.us-east.resource-controller.cloud.ibm.com

**Important:** The URLs must be reachable from your cluster nodes - verify network connectivity before installation. For disconnected clusters, you may need to configure DNS resolution and routing for these private endpoints. The installer and cluster operators use these endpoints for API calls during and after installation. If endpoints are misconfigured, installation will fail or post-install operations (creating load balancers, persistent volumes) will break. You can find service endpoint URLs in IBM Cloud documentation or via 'ibmcloud catalog service <service-name>' CLI command. Only override endpoints you actually need - unnecessary overrides can complicate troubleshooting. Most connected clusters should leave this blank.`}
                  className="platform-specifics-field-full"
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
                  hint={`${metaIbmDefaultMachineBootVolumeKey?.description ? `${metaIbmDefaultMachineBootVolumeKey.description} ` : ""}IBM Key Protect or Hyper Protect Crypto Services root key CRN (Cloud Resource Name) to use for encrypting boot volumes (OS disks) of ALL cluster nodes (both control plane and compute) with a single cluster-wide key. Leave blank to use default IBM Cloud encryption (volumes are still encrypted, but with IBM-managed keys, not customer-managed).

**Why use customer-managed keys:** Many compliance frameworks (PCI-DSS, HIPAA, FedRAMP) require customer-controlled encryption keys with audit trails. Key Protect/HPCS give you full control over key lifecycle (rotation, revocation, access policies) and provide cryptographic proof of data protection.

**What is a root key:** A root key is a master encryption key stored in Key Protect or HPCS that wraps (encrypts) the actual data encryption keys used by boot volumes. You create root keys in Key Protect/HPCS, grant IBM Cloud Block Storage service authorization to use them, then reference them here via CRN.

**CRN format:** Starts with 'crn:v1:bluemix:public:' followed by service (kms for Key Protect, hs-crypto for HPCS), region, account ID, and key ID.

**Important requirements:**
1. The root key must ALREADY EXIST in Key Protect/HPCS before installation
2. The key must be in the same region as your cluster
3. You must grant 'Reader' service-to-service authorization from IBM Cloud Block Storage to your Key Protect/HPCS instance
4. If the key is later deleted or access revoked, nodes cannot boot - plan key lifecycle carefully

**Precedence:** This is a cluster-wide default that applies to all machine pools UNLESS you override it with per-pool keys in 'Boot volume encryption key (control plane)' or 'Boot volume encryption key (compute)' below.

**Example:** 'crn:v1:bluemix:public:kms:us-east:a/1234567890abcdef:key-instance-id:key-id'. You can find root key CRNs in IBM Cloud console → Key Protect/HPCS → Keys → Actions → Show CRN, or via CLI: 'ibmcloud kp keys'.`}
                  className="platform-specifics-field-long"
                >
                  <input
                    value={platformConfig.ibmcloud?.defaultMachineBootVolumeEncryptionKey || ""}
                    onChange={(e) => updateIbmCloud({ defaultMachineBootVolumeEncryptionKey: e.target.value })}
                    placeholder="crn:v1:bluemix:public:kms:..."
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Boot volume encryption key (control plane, optional)"
                  hint={`${metaIbmControlPlaneBootVolumeKey?.description ? `${metaIbmControlPlaneBootVolumeKey.description} ` : ""}Optional IBM Key Protect or HPCS root key CRN to use specifically for control plane (master) node boot volumes, overriding the cluster-wide default set above. Leave blank to use the cluster-wide default key (or IBM-managed encryption if no default is set).

**When to use:** Set a separate control plane key when:
1. Compliance requires different key access policies for control plane vs. workload infrastructure
2. You want to isolate key permissions (e.g., platform team manages control plane keys, app teams manage worker keys)
3. Regulatory separation mandates control plane data be encrypted with keys from a different HPCS instance or region
4. You need independent key rotation schedules for control plane vs. compute

**Important:** The root key must meet the same requirements as the cluster-wide default: exist before installation, be in the same region, have Block Storage authorization, and follow the CRN format 'crn:v1:bluemix:public:kms:region:account:instance:key-id'.

**Precedence:** This field takes priority over 'Boot volume encryption key (all machine pools)' for control plane nodes only. If both are set, control plane uses this key, workers use the cluster-wide default (unless 'Boot volume encryption key (compute)' is also set). If this is blank, control plane falls back to the cluster-wide default.

**Example use case:** High-security cluster where control plane uses HPCS (higher security/compliance tier) while workers use standard Key Protect (cost-effective for less-sensitive workload nodes).`}
                  className="platform-specifics-field-long"
                >
                  <input
                    value={platformConfig.ibmcloud?.controlPlaneBootVolumeEncryptionKey || ""}
                    onChange={(e) => updateIbmCloud({ controlPlaneBootVolumeEncryptionKey: e.target.value })}
                    placeholder="crn:v1:bluemix:public:kms:..."
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Boot volume encryption key (compute, optional)"
                  hint={`${metaIbmComputeBootVolumeKey?.description ? `${metaIbmComputeBootVolumeKey.description} ` : ""}Optional IBM Key Protect or HPCS root key CRN to use specifically for compute (worker) node boot volumes, overriding the cluster-wide default set above. Leave blank to use the cluster-wide default key (or IBM-managed encryption if no default is set).

**When to use:** Set a separate compute key when:
1. Workload compliance requirements differ from infrastructure compliance (e.g., PCI workloads need dedicated encryption keys)
2. You want to delegate worker key management to application teams while platform team controls control plane keys
3. Cost optimization - use lower-cost Key Protect for workers while control plane uses premium HPCS
4. Multi-tenancy isolation - different worker pools for different tenants/apps might need separate keys (though this field sets a default for ALL workers - per-pool keys require post-install MachineSet customization)

**Important:** The root key must meet the same requirements as the cluster-wide default: exist before installation, be in the same region, have Block Storage authorization, and follow the CRN format 'crn:v1:bluemix:public:kms:region:account:instance:key-id'.

**Precedence:** This field takes priority over 'Boot volume encryption key (all machine pools)' for worker nodes only. If all three fields are set, control plane uses the control plane key, workers use this compute key, and the cluster-wide default is unused (but still a good fallback). If this is blank, workers fall back to the cluster-wide default.

**Example use case:** General-purpose cluster where compute nodes use standard Key Protect (cost-effective for ephemeral worker VMs) while control plane uses HPCS (critical infrastructure with higher security/auditability requirements).`}
                  className="platform-specifics-field-long"
                >
                  <input
                    value={platformConfig.ibmcloud?.computeBootVolumeEncryptionKey || ""}
                    onChange={(e) => updateIbmCloud({ computeBootVolumeEncryptionKey: e.target.value })}
                    placeholder="crn:v1:bluemix:public:kms:..."
                  />
                </FieldLabelWithInfo>
              </div>

              <h4 className="platform-specifics-subsection">Publishing and credentials</h4>
              <div className="field-grid">
                <FieldLabelWithInfo
                  label="Publish (optional)"
                  hint={`${metaPublish?.description ? `${metaPublish.description} ` : ""}External exposes API/apps via public endpoints. Internal keeps endpoints private to your network/VPC path and is typical for private-cluster designs.`}
                  className="platform-specifics-field-short"
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
                  hint={"Fully qualified domain name (FQDN) or IP address of your Nutanix Prism Central instance. Prism Central is the centralized management interface for Nutanix clusters that the OpenShift installer uses to provision VMs, configure networking, and manage cluster infrastructure.\n\n**What is Prism Central:** Prism Central (PC) is Nutanix's multi-cluster management platform that sits above one or more Prism Element (PE) clusters. It provides unified management, monitoring, and automation across your Nutanix infrastructure. The installer communicates with Prism Central's REST API to create and configure OpenShift VMs.\n\n**FQDN vs IP:** You can use either a fully qualified domain name (e.g., 'prism.example.com', 'pc.nutanix.internal') or an IPv4 address (e.g., '192.168.1.50'). FQDN is recommended for production - it's more maintainable if the IP changes, and supports TLS certificate validation better.\n\n**Requirements:**\n1. The endpoint must be reachable from the network where you run openshift-install (for disconnected installs, this means routable within your private network)\n2. The Prism Central instance must be running and accessible on the API port (default 9440, see 'Port' field below)\n3. For TLS/HTTPS (default), ensure the TLS certificate is valid or you have proper certificate trust configured (Prism Central uses self-signed certs by default - you may need to import the CA cert into your trust store)\n4. The credentials you provide below must have admin-level permissions in Prism Central to create VMs, networks, and storage\n\n**Version compatibility:** Ensure your Prism Central version is compatible with the OpenShift version you're installing - consult OpenShift documentation for the support matrix. Typically Prism Central 2020.9+ is required for OpenShift 4.9+, and newer OpenShift versions may require newer PC versions.\n\n**Example:** 'prism-central.example.com' or '10.50.100.20'."}
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
                  hint={"TCP port number for the Prism Central REST API. Leave blank to use the default port 9440 (standard Prism Central HTTPS port).\n\n**What is this:** Prism Central's management API listens on a specific TCP port for HTTPS connections. The OpenShift installer connects to this port to execute API calls for VM provisioning, network configuration, and cluster management. Port 9440 is the Nutanix default for Prism Central.\n\n**Why you might change it:**\n1. Your organization uses non-standard ports for security policy compliance\n2. Prism Central is behind a reverse proxy or load balancer that uses a different port\n3. Network address translation (NAT) or port forwarding routes traffic to a different external port\n4. Multiple Prism Central instances on the same network with port separation\n\n**Important:** The port must match whatever is actually configured on your Prism Central instance. If you specify the wrong port, the installer will fail to connect with timeout or connection refused errors. The port must allow HTTPS/TLS traffic (Prism Central uses HTTPS by default, not plain HTTP). For most installations, leaving this field blank (using default 9440) is correct.\n\n**Example:** Leave blank for standard setups, or enter '443' if PC is behind a reverse proxy on standard HTTPS port, or '8443' if using a custom port."}
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
                  hint={"Username for authenticating to Prism Central with administrative privileges. The OpenShift installer uses these credentials to provision VMs, configure networking, and manage cluster infrastructure via the Prism Central API.\n\n**Required permissions:** The user must have admin-level permissions in Prism Central, specifically:\n1. Ability to create and manage VMs (including power operations, configuration changes, disk management)\n2. Ability to create and configure virtual networks/VLANs\n3. Ability to allocate and manage storage (create volumes, attach disks)\n4. Read access to cluster configuration and resources\n\nTypically, the built-in 'admin' user has all required permissions. For production environments, you may want to create a dedicated service account with specific OpenShift-related permissions instead of using the default admin account (consult Nutanix documentation for role-based access control / RBAC setup).\n\n**Authentication methods:** Prism Central supports local users (managed in Prism Central itself) and directory-integrated users (Active Directory, LDAP). Either can be used as long as the user has the required permissions. The username format depends on your authentication source - local users are typically simple usernames like 'admin' or 'openshift-svc', while directory users might be formatted like 'DOMAIN\\\\username' or 'user@domain.com'.\n\n**Important:** The credentials are stored in plain text in the install-config.yaml file unless you choose to exclude them at export. After installation, you can remove credentials from the config file if needed. Never store install-config.yaml with credentials in version control or shared storage.\n\n**Example:** 'admin' for local admin user, or 'openshift-installer@corp.example.com' for a dedicated directory service account."}
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
                  hint={"Password for the Prism Central username specified above. This credential is used during OpenShift installation to authenticate API calls for provisioning VMs, configuring networks, and managing cluster infrastructure. The installer stores this password in plain text in the install-config.yaml file (unless you choose to exclude credentials at export time), so treat the install-config with appropriate security controls.\n\n**Important security notes:**\n1. DO NOT allow your browser to save this password - it will be embedded in plain text in the generated config file. Use your browser's password manager ignore features if prompted\n2. After installation completes, you can remove the credentials from install-config.yaml if you no longer need them (though some day-2 operations may require them)\n3. Store install-config.yaml securely - never commit it to version control or place it in shared/public storage with credentials included\n4. Consider using a dedicated service account with limited permissions instead of the main admin account for better security and auditability\n5. Rotate credentials periodically and update any stored install-config files accordingly\n\n**Credential inclusion:** When you export/generate the install-config, you'll have an option to include or exclude credentials. If excluded, you must provide credentials separately when running openshift-install (via prompts or environment variables). If included, the install-config is self-contained but more sensitive. For production deployments, many organizations use temporary credentials that are rotated or revoked after installation, or use secrets management tools (HashiCorp Vault, AWS Secrets Manager) instead of plain text storage."}
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
                  hint={`UUID or name of the Nutanix subnet (network segment/VLAN) where the OpenShift installer creates cluster VMs. This is a Nutanix infrastructure identifier, NOT an IP address range.

**What is a Nutanix Subnet:**
A subnet in Nutanix is a Layer 2 network segment (VLAN) configured in Prism Central/Element that VMs attach to for network connectivity. It's similar to a port group in vSphere.

**Important Notes:**
• This field expects a UUID (universally unique identifier) or the subnet name as shown in Prism Central
• IP address ranges (Machine/Cluster/Service CIDRs) are configured separately in the Networking tab
• All cluster VMs (control plane, workers, bootstrap) will attach to this subnet
• The subnet must have sufficient available IP addresses for all nodes

**Requirements:**
1. Subnet must exist in Prism Central before installation
2. Must be associated with the Prism Element cluster where VMs will run
3. Needs connectivity to any external services (internet, mirror registry, NTP, DNS)
4. DNS server reachable from this subnet must resolve cluster domain names
5. API and Ingress VIP addresses must be routable on this subnet

**Finding the Subnet UUID:**
In Prism Central → Network Configuration → Subnets → select your subnet → copy the UUID from the details panel. UUIDs are typically formatted like: 12345678-1234-1234-1234-123456789abc

**Multiple Subnets:**
For multi-subnet deployments, provide comma-separated UUIDs: uuid1,uuid2,uuid3

**Example:**
12345678-abcd-1234-5678-abcdef123456 or 'Production-VLAN100' or 'OCP-Network'`}
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
                  hint={"Name of the Nutanix Prism Element (PE) cluster where OpenShift virtual machines will be deployed. Leave blank to let the installer choose automatically (most common).\n\n**What is this:** Nutanix uses a two-tier management model - Prism Central (PC) manages multiple Prism Element clusters. Each PE cluster is a group of Nutanix nodes (hyperconverged servers) that form a storage/compute pool. This field specifies which PE cluster hosts your OpenShift VMs.\n\n**Why specify one:** Set a cluster name when you have multiple PE clusters managed by your Prism Central and want to pin OpenShift to a specific cluster (e.g., for capacity isolation, SLA tiers, or licensing/billing separation). If left blank, the installer selects a PE cluster automatically based on available resources.\n\n**Important:** This field expects the CLUSTER NAME (human-readable string like 'Production-Cluster-01'), NOT the cluster UUID. You can find cluster names in Prism Central → Compute & Storage → Clusters. The cluster must be registered with the Prism Central endpoint you specified above, and must have sufficient resources (CPU, memory, storage) for your control plane and worker node requirements. The cluster must also be running compatible Nutanix AOS/AHV versions (consult OpenShift documentation for version compatibility matrix).\n\n**Example:** 'Production-Cluster-01' or 'NX-3060-Cluster'. Most single-cluster Nutanix deployments leave this blank."}
                >
                  <input
                    value={platformConfig.nutanix?.cluster || ""}
                    onChange={(e) => updateNutanix({ cluster: e.target.value })}
                    placeholder="my-nutanix-cluster"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Storage container (optional)"
                  hint={`Nutanix storage container name where the cluster's persistent volumes (PVs) and VM disks will be stored. A storage container in Nutanix is similar to a datastore in vSphere - it's a logical storage pool that spans multiple physical disks and provides data services like compression, deduplication, and redundancy. Leave blank to use the cluster's default storage container (most common choice). Only specify a container name if you want OpenShift volumes to land in a dedicated storage container separate from other workloads. WHY YOU MIGHT SET THIS: Capacity isolation (dedicate a container with specific capacity for OpenShift), Performance isolation (use SSD-backed container for OpenShift while other workloads use HDD), Billing/chargeback (separate storage consumption tracking), Compliance (data residency or encryption requirements that differ from default container). The container must exist before installation and must be accessible from the Nutanix cluster you specified above. You can find container names in Prism Central → Storage → Storage Containers. IMPORTANT: This setting affects persistent volumes created by OpenShift storage classes - VM disks for nodes themselves use the cluster's default, this is specifically for workload storage (PVCs). For most deployments, leaving this blank (use default) is fine unless you have specific storage management requirements. Example: 'openshift-storage' or 'ssd-container'.`}
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
                    hint={`Number of worker nodes (compute nodes) to create during installation for High Availability topology. Workers run your application workloads - they do NOT run control plane services (API, etcd, schedulers). Minimum: 2 workers required for HA topology (allows workload redundancy and rolling updates). Unlike control plane nodes, you CAN scale workers up or down after installation. SIZING GUIDANCE: For development/testing: 2-3 workers is sufficient. For production: Start with 3-5 workers to ensure adequate capacity and resilience. Each worker is a Nutanix VM that consumes cluster resources (CPU, RAM, storage). WHY MINIMUM 2: With only 1 worker, you have no redundancy - if that worker fails or needs maintenance, workloads have nowhere to run. With 2+ workers, workloads can be rescheduled to surviving nodes during failures or updates. BEST PRACTICE: Plan worker count based on expected workload - more workers provide more total capacity and better failure resilience, but consume more Nutanix resources. You can start with 3 workers and scale up post-install by editing MachineSets if workload demands grow. For mission-critical applications or large workloads, consider 5+ workers. Default: 3 (good starting point for most production clusters). Example: 3 for small production workloads, 5 for medium-sized clusters, 10+ for large-scale deployments with heavy compute/memory needs.`}
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
                  hint={`Mint (recommended for IPI): CCO creates scoped cloud credentials for each cluster component from your admin credential. Each component gets minimal permissions. Requires IAM rights to create new users/roles. Best choice when you have full IAM admin access. Passthrough: CCO passes your install-time admin credential to all components — no new IAM identities created. Use when your org prohibits new IAM account creation. All components share the broad admin credential. Manual: You provision credentials yourself before install (e.g. via ccoctl for STS/Workload Identity). Required for air-gapped AWS STS installs, highly regulated environments. Most secure, most complex. Must run ccoctl before openshift-install. Nutanix IPI always requires Manual — enforced automatically.`}
                >
                  <input readOnly value="Manual" aria-label="Credentials mode (Manual, required for Nutanix IPI)" />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Publish"
                  hint={`External (default): API and ingress published to public DNS/load balancer. Use for clusters reachable from the internet or external networks. Required when apps/API must be accessed without VPN. Internal: All cluster endpoints are private-network only. DNS must resolve internally. Required by some compliance regimes. Note: console.redhat.com cluster management and direct Red Hat update checks will not reach the cluster without additional network routing. Recommendation: External for most installs. Internal only when external exposure is explicitly prohibited. Note: Nutanix IPI forces External in the generated install-config.`}
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
                  hint={`Username for authenticating to vCenter Server. This account must have Administrator privileges or at minimum these permissions: Datastore (Allocate space, Browse), Folder (Create, Delete), Host.Local operations (Create VM), Network (Assign network), Resource (Assign VM to pool), and Virtual machine.Configuration (all). Typically formatted as administrator@vsphere.local or DOMAIN\\username. Required for IPI installations to automate infrastructure provisioning (VM creation, storage allocation, networking). For UPI, credentials are optional but help with validation. Included in install-config only when you choose to include credentials in export.`}
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
                <FieldLabelWithInfo
                  label="vCenter password (optional)"
                  hint={`Password for the vCenter username specified above. This credential is used during installation to provision infrastructure resources (VMs, networks, storage) for IPI, or for validation in UPI workflows. The password is included in the generated install-config.yaml only when you choose to include credentials in the export. IMPORTANT: Do not allow your browser to save this password - it will be embedded in plain text in the install-config. After installation, you can remove credentials from the file if needed.`}
                >
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
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
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setShowVspherePassword((s) => !s)}
                      aria-label={showVspherePassword ? "Hide password" : "Show password"}
                      style={{ flexShrink: 0, padding: "0.5rem 0.75rem", fontSize: "0.8125rem" }}
                    >
                      <span aria-hidden>{showVspherePassword ? " " : "\u{1F441}"}</span>
                      {showVspherePassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </FieldLabelWithInfo>
              </div>

              <h4 className="platform-specifics-subsection">Placement</h4>
              <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                Choose failure domains (recommended for 4.20) or legacy single placement. Only the selected path is used in the generated install-config.
              </p>
              <div className="field-grid field-grid--no-paired-layout" style={{ marginTop: 8, marginBottom: 12 }}>
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
                    hint={metaVsphereVcenter?.description || "Fully qualified domain name (FQDN) or IP address of your vCenter Server. This is the management endpoint for your vSphere environment. Example: vcenter.example.com or 192.168.1.10. Port defaults to 443 (HTTPS). The installer uses this address with the credentials provided above to provision VMs, configure networking, and manage cluster infrastructure. Required for both IPI (automated provisioning) and UPI (validation and placement guidance) workflows."}
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
                    hint={metaVsphereDatacenter?.description || "vSphere datacenter name where the cluster will be deployed. A datacenter in vSphere is a logical container that organizes compute resources, networks, and storage. Example: DC1 or Datacenter-Production. This must match the exact name as shown in vCenter (case-sensitive). The datacenter contains the clusters, datastores, and networks you'll specify in the fields below. You can find your datacenter names in vCenter by navigating to Inventory → Datacenters."}
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
                    hint={metaVsphereDefaultDatastore?.description || "vSphere datastore name for cluster VM disks and volumes. A datastore is a storage container (VMFS, NFS, vSAN, vVols) where VM disk files are stored. Example: datastore1 or Production-SAN-01. This must match the exact name in vCenter (case-sensitive). The datastore must have sufficient free space for all cluster VMs - typically 800GB minimum for a basic cluster (3 control plane + 3 workers with 120GB disks each). For production, ensure the datastore has good performance (SSD recommended) and adequate IOPS to support etcd and workload requirements."}
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
                    hint={`vSphere cluster where worker (compute) nodes will be provisioned. This cluster must have sufficient CPU, memory, and storage resources for your worker node count and sizing. The cluster should have DRS (Distributed Resource Scheduler) enabled for automatic VM placement and load balancing. Example: Cluster-Production-01. You can use the same cluster for both control plane and compute nodes, or separate them for workload isolation. For legacy single placement only; failure domains specify cluster per domain.`}
                  >
                    <input
                      value={platformConfig.vsphere?.cluster || ""}
                      onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, cluster: e.target.value } })}
                      placeholder="e.g. Cluster1"
                    />
                  </FieldLabelWithInfo>
                  <FieldLabelWithInfo
                    label="VM network (required for legacy path)"
                    hint={`vSphere network name (Standard Port Group or Distributed Port Group) where the installer attaches virtual network interfaces (vNICs) for all OpenShift cluster VMs (control plane, workers, bootstrap). This must match the exact network name as shown in vCenter (case-sensitive). WHAT IS THIS: In vSphere, VMs connect to networks via port groups - either Standard Port Groups (on Standard vSwitches) or Distributed Port Groups (DPGs, on Distributed vSwitches). This field tells the installer which network to use for all cluster communication. Example: 'VM Network' (default), 'Production-Network', or 'DPG-OpenShift-Prod'. CRITICAL REQUIREMENTS: The network must satisfy ALL of these: (1) Contains the API and Ingress VIP addresses you specified in the Networking tab (these IPs must be routable/reachable on this network). (2) DNS server on this network can resolve the cluster domain names (api.<cluster>.<domain>, *.apps.<cluster>.<domain>, etc.). (3) All cluster nodes can reach each other on this network (no isolation/ACLs between nodes). (4) Network has connectivity to any external services the cluster needs (internet for connected installs, mirror registry for disconnected, NTP servers, etc.). (5) Has sufficient available IP addresses - one per VM (typically 3 control plane + N workers + 1 bootstrap = 4+N IPs minimum). IMPORTANT: This is a vSphere network OBJECT NAME, NOT an IP range or CIDR. The IP address ranges (Machine network CIDR, Cluster network CIDR, Service network CIDR) are configured separately in the Networking tab. The network you specify here must have IP addresses available within the Machine network CIDR you configured. FOR MULTI-NETWORK SETUPS: If you have multiple VLANs or networks, ensure this network is the one where nodes communicate and where your VIPs are allocated. The installer does not support multi-homed VMs in install-config (that requires post-install customization). You can find network names in vCenter by navigating to Networking → select switch → Port groups. Example: 'VM Network' (simple deployments), 'OCP-Production-VLAN100' (VLAN-backed network), 'DPG-Cluster-Network' (distributed port group).`}
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
                      <div className="field-grid">
                        <FieldLabelWithInfo
                          label="Name"
                          hint={`Unique identifier for this failure domain used in install-config.yaml and zone placement. This name must be unique across all failure domains in your cluster. Example: fd-0, fd-1, or zone-east-1. Keep it short and descriptive (lowercase alphanumeric and hyphens recommended). This name is referenced by the computeZones and controlPlaneZones fields if you want to explicitly control which nodes land in which failure domain. OpenShift uses this name internally to track which resources belong to which zone for high-availability placement and scheduling.`}
                        >
                          <input value={fd.name || ""} onChange={(e) => updateFailureDomain(index, { name: e.target.value })} placeholder="fd-0" />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo
                          label="Region"
                          hint={`Logical region identifier for grouping failure domains. In vSphere, a region typically represents a single vCenter or datacenter. For a single-datacenter deployment, use a simple name like 'datacenter' or 'region1'. For multi-datacenter setups, this should match the openshift-region tag value you apply to vSphere resources so the installer can group nodes by region. Region + Zone together define the complete failure domain topology. Example: if you have one vCenter serving multiple clusters, use 'datacenter' for all failure domains. If you have multiple vCenters, use 'east', 'west', or datacenter-specific names. This helps OpenShift understand your infrastructure layout for scheduling and availability decisions.`}
                        >
                          <input value={fd.region || ""} onChange={(e) => updateFailureDomain(index, { region: e.target.value })} placeholder="datacenter" />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo
                          label="Zone"
                          hint={`Logical zone identifier within the region, typically matching your vSphere compute cluster name. For a single-cluster deployment, use the cluster name (e.g., Cluster1). For multi-cluster/multi-zone setups, this should match the openshift-zone tag value you apply to vSphere resources so the installer can spread nodes across zones for high availability. Zone is the granular level of failure domain separation - nodes in different zones should ideally be on different compute clusters or racks to survive hardware failures. Example: if you have three compute clusters (Cluster1, Cluster2, Cluster3), create three failure domains with zones cluster1, cluster2, cluster3. OpenShift will then distribute control plane and worker nodes across these zones to maximize availability.`}
                        >
                          <input value={fd.zone || ""} onChange={(e) => updateFailureDomain(index, { zone: e.target.value })} placeholder="cluster-01" />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo
                          label="Server (vCenter FQDN or IP)"
                          hint={`Fully qualified domain name (FQDN) or IP address of the vCenter Server managing this failure domain. Each failure domain can point to the same vCenter (common for single-datacenter multi-cluster setups) or different vCenter instances (for multi-datacenter deployments). Example: vcenter.example.com or 192.168.1.10. The installer uses this address with your provided credentials to provision VMs in this specific failure domain. For high availability across datacenters, you might have vcenter-east.example.com for one failure domain and vcenter-west.example.com for another. This allows OpenShift to span multiple vCenter instances in a single cluster deployment.`}
                        >
                          <input value={fd.server || ""} onChange={(e) => updateFailureDomain(index, { server: e.target.value })} placeholder="vcenter.example.com" />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo
                          label="Topology: Datacenter"
                          hint={`vSphere datacenter name where resources for this failure domain are located. This must match the exact datacenter name as shown in vCenter (case-sensitive). A datacenter in vSphere is a top-level container that organizes compute clusters, hosts, datastores, and networks. Example: Datacenter1 or Production-DC. For single-datacenter deployments, all failure domains typically reference the same datacenter name. For multi-datacenter setups, each failure domain points to its respective datacenter (e.g., East-DC, West-DC). The installer uses this to locate the other topology resources (cluster, datastore, networks) within the correct vSphere inventory structure. You can find your datacenter names in vCenter by navigating to Inventory → Datacenters.`}
                        >
                          <input value={fd.topology?.datacenter || ""} onChange={(e) => updateFailureDomainTopology(index, { datacenter: e.target.value })} placeholder="Datacenter1" />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo
                          label="Topology: Compute cluster"
                          hint={`vSphere compute cluster name where VMs for this failure domain will be provisioned. This must match the exact cluster name in vCenter (case-sensitive). A compute cluster in vSphere is a collection of ESXi hosts that share resources and provide high availability features like DRS (Distributed Resource Scheduler) and HA (High Availability). Example: Cluster1, Production-Cluster, or Compute-Zone-A. The cluster must have sufficient CPU, memory, and storage resources for the nodes you plan to deploy in this failure domain. DRS should be enabled for automatic VM placement and load balancing. Each failure domain can target a different cluster - this is how you achieve true zone separation in vSphere (nodes in different clusters can survive cluster-level failures). The installer will provision VMs into this cluster according to your node distribution settings.`}
                        >
                          <input value={fd.topology?.computeCluster || ""} onChange={(e) => updateFailureDomainTopology(index, { computeCluster: e.target.value })} placeholder="Cluster1" />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo
                          label="Topology: Datastore"
                          hint={`Absolute datastore path in vSphere inventory for VM disks in this failure domain. Format: /datacenter-name/datastore/datastore-name (e.g., /Datacenter1/datastore/Production-SAN-01 or /Datacenter1/datastore/vsanDatastore). This must match the exact path as shown in vCenter. A datastore is a storage container (VMFS, NFS, vSAN, or vVols) where VM disk files (VMDK) are stored. The datastore must have sufficient free space for all VMs in this failure domain - typically 300GB minimum per control plane node and 120GB per worker node, plus overhead. For high availability, use different datastores for different failure domains if possible (avoids single storage point of failure). For production workloads, ensure the datastore has good performance (SSD-backed or high-performance SAN) and adequate IOPS to support etcd and application workloads. You can find datastore paths in vCenter by navigating to Storage → select datastore → Summary tab.`}
                        >
                          <input value={fd.topology?.datastore || ""} onChange={(e) => updateFailureDomainTopology(index, { datastore: e.target.value })} placeholder="/datacenter/datastore/ds1" />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo
                          label="Topology: Networks (comma delimited)"
                          hint={`One or more vSphere network names where OpenShift VMs in this failure domain will be connected and where cluster API/Ingress VIPs and DNS records will be assigned.

**What are vSphere networks:**
In vSphere, a "network" is a port group (standard switch) or Distributed Port Group (DPG - distributed switch) that represents a virtual network segment VMs can attach to. This field asks for the **network object name** (e.g., "VM Network", "DPG-OCP-Prod"), NOT IP address ranges or CIDRs. The IP addresses and subnet ranges for your OpenShift cluster are configured separately in the Networking tab (Machine/Cluster/Service network CIDRs). Think of this field as "which vSphere network label should VM NICs connect to" - like plugging a physical network cable into a specific switch port.

**Why this field is critical:**
OpenShift needs to know which vSphere network(s) contain the IP addresses you've allocated for the cluster's Virtual IP addresses (VIPs) - specifically the API VIP (for api.<cluster-name>.<base-domain>) and the Ingress VIP (for *.apps.<cluster-name>.<base-domain>). The installer will place DNS records and assign these VIPs on the networks you specify here. If you specify the wrong network name, the installer cannot reach your VIPs and the installation will fail during bootstrap.

**When to use multiple networks:**
- **Single network (most common):** Enter one network name (e.g., "VM Network"). All cluster VMs, VIPs, and DNS records will use this network. Use this approach when all your OpenShift traffic (management, workload, storage) shares one network segment.
- **Multiple networks (advanced):** Enter comma-separated names (e.g., "VM Network, DPG-Storage"). Multiple networks are needed when your vSphere environment separates traffic types across VLANs/port groups - for example, management traffic on one network and application traffic on another. OpenShift will attach VM NICs to all specified networks, but VIPs are typically assigned to the first network listed.

**Requirements:**
1. Network name must match **exactly** as shown in vCenter (case-sensitive, spaces included).
2. Network must exist in the same vCenter datacenter specified in this failure domain.
3. Network must contain sufficient routable IP addresses for VMs and VIPs.
4. Network must allow communication between VMs (control plane nodes, worker nodes, bootstrap) and from external clients to VIPs.
5. If using multiple failure domains, each can use different networks OR the same network - depends on your vSphere network design.

**How to find network names in vCenter:**
1. Log into vSphere Client → Select Datacenter → Select Hosts and Clusters.
2. Expand cluster → Select a host → Click "Configure" tab → "Networking" → "Virtual switches".
3. For **standard switch:** Look under "Port groups" - the "Name" column shows port group names (e.g., "VM Network").
4. For **distributed switch:** Navigate to Networking view → Select Distributed Switch → "Networks" tab shows DPG names (e.g., "DPG-OCP-Prod").
5. Copy the name exactly as shown - this is what you enter here.

**Important notes:**
• Do NOT enter IP addresses, CIDRs, or subnet masks here - this field is for vSphere network object names only.
• The network you specify must be routable to/from the network where you'll run the installer (bootstrap VM needs connectivity).
• For disconnected/airgap environments, ensure the network has access to your internal mirror registry and DNS server.
• If you're unsure which network to use, check with your vSphere admin or look at where existing VMs in vCenter are connected.

**Examples:**
• Single standard port group: \`VM Network\`
• Single distributed port group: \`DPG-OCP-Production\`
• Multiple networks: \`DPG-Management, DPG-Storage\` (comma-separated, no quotes)
• Space in name: \`OCP Prod Network\` (include spaces exactly as shown in vCenter)`}
                        >
                          <input
                            value={Array.isArray(fd.topology?.networks) ? fd.topology.networks.join(", ") : (fd.topology?.networks || "")}
                            onChange={(e) => updateFailureDomainTopology(index, { networks: e.target.value.split(",").map((s) => s.trim()) })}
                            placeholder="e.g. VM Network or VM Network, DPG-1"
                          />
                        </FieldLabelWithInfo>
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <CollapsibleSection title="Advanced (template, folder, resource pool)" defaultCollapsed={true}>
                          <div className="field-grid" style={{ marginTop: 4 }}>
                          {scenarioId === "vsphere-ipi" && (
                            <FieldLabelWithInfo
                              label="Topology: RHCOS template (optional, IPI only)"
                              hint={`Absolute path to a pre-deployed RHCOS (Red Hat CoreOS) OVA template in vSphere inventory that the installer will clone to create cluster VMs. Format: /datacenter-name/vm/folder-name/template-name (e.g., /Datacenter1/vm/Templates/rhcos-4.14.0). Leave blank to use 'clusterOSImage' URL strategy (Machine pool advanced section). IMPORTANT: Use ONE image strategy - either set 'Topology: RHCOS template' per failure domain (useful when each zone needs a different template), OR set 'clusterOSImage' URL once for the whole cluster. Do not set both. HOW TO SET UP: (1) Download the RHCOS OVA for your OpenShift version from Red Hat (e.g., rhcos-4.14.0-x86_64-vmware.x86_64.ova). (2) In vCenter, right-click folder → Deploy OVF Template → select downloaded OVA → complete wizard WITHOUT customizing guest OS settings. (3) After deploy completes, note the template's full inventory path (Hosts and Clusters view → VM → Summary tab shows path). (4) Enter that path here. WHY PRE-DEPLOY TEMPLATES: For disconnected/airgap environments where the installer cannot download images directly. When you need tight control over image provenance. For multi-zone deployments where each zone needs images on local storage. MULTIPLE FAILURE DOMAINS: If you have 3 failure domains, you can set a different RHCOS template path for each one (useful if templates are on different datastores per zone for locality). Or use one template accessible across all zones. IMPORTANT: The template must match your selected OpenShift version - using RHCOS 4.14 template for OpenShift 4.15 will cause failures. After deployment, do NOT power on or customize the template - the installer expects it in the pristine post-OVF-deploy state. Example: /Datacenter1/vm/rhcos-templates/rhcos-4.14.0-vmware. You can find the full path in vCenter by selecting the VM → Summary tab → VM Path field.`}
                            >
                              <div>
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
                              </div>
                            </FieldLabelWithInfo>
                          )}
                          <FieldLabelWithInfo
                            label="Topology: Folder (optional)"
                            hint={`Absolute VM folder path in vSphere inventory where the installer places OpenShift VMs for this failure domain. Format: /datacenter-name/vm/folder-name or /datacenter-name/vm/parent-folder/child-folder (e.g., /Datacenter1/vm/OpenShift or /Datacenter1/vm/Production/OCP-Cluster). Leave blank to use the default VM folder at the datacenter root. VM folders in vSphere are organizational containers that group VMs for easier management and permission control - they don't affect VM function, just inventory organization. The installer creates all cluster VMs (control plane, workers, bootstrap) in this folder. For production environments, using a dedicated folder helps separate OpenShift VMs from other workloads. You can create folders in vCenter by navigating to VMs and Templates → right-click datacenter → New Folder. The path must exist before installation (the installer will not create it). This is purely for organization and has no impact on networking, storage, or compute placement.`}
                          >
                            <input value={fd.topology?.folder || ""} onChange={(e) => updateFailureDomainTopology(index, { folder: e.target.value })} placeholder="/datacenter/vm/folder" />
                          </FieldLabelWithInfo>
                          <FieldLabelWithInfo
                            label="Topology: Resource pool (optional)"
                            hint={`Absolute resource pool path in vSphere inventory for CPU/memory resource management of VMs in this failure domain. Format: /datacenter-name/host/cluster-name/Resources/pool-name (e.g., /Datacenter1/host/Cluster1/Resources/OpenShift-Pool). Leave blank to use the cluster's root Resources pool (default). Resource pools in vSphere allow you to partition and allocate CPU and memory resources with reservations, limits, and shares - useful for ensuring OpenShift VMs get guaranteed resources separate from other workloads. The pool must exist before installation. If you're sharing compute clusters with other applications, a dedicated resource pool prevents resource contention. You can create resource pools in vCenter by navigating to Hosts and Clusters → select cluster → right-click Resources → New Resource Pool. For most installations, the default root Resources pool is sufficient unless you need specific resource guarantees or limits. This setting does NOT affect storage (datastore) or network placement.`}
                          >
                            <input value={fd.topology?.resourcePool || ""} onChange={(e) => updateFailureDomainTopology(index, { resourcePool: e.target.value })} placeholder="/datacenter/host/cluster/Resources/pool" />
                          </FieldLabelWithInfo>
                        </div>
                      </CollapsibleSection>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* vSphere IPI API/Ingress VIPs are on the Networking step (shared section with scenario gating). */}

              <h4 className="platform-specifics-subsection">Storage</h4>
              <div className="field-grid field-grid-single" style={{ marginTop: 8, marginBottom: 20 }}>
                <FieldLabelWithInfo
                  label="Disk type (optional)"
                  hint={`vSphere disk provisioning format for VM disk files (VMDKs). This controls how storage space is allocated on the datastore for cluster node disks. Leave as 'Not set' to use the datastore's default provisioning policy (recommended for most installations). WHAT ARE THESE FORMATS: vSphere supports multiple disk formats that trade off between performance, space efficiency, and provisioning speed. OPTIONS: 'thin' (Thin Provisioning) - allocates storage space on-demand as data is written. A 120GB thin disk might only consume 20GB on the datastore initially, growing as the VM writes data. Fast to create, space-efficient, good for most OpenShift installs. 'thick' (Thick Provision Lazy Zeroed) - allocates the full disk size immediately (120GB disk = 120GB consumed on datastore), but doesn't zero out blocks until first write. Faster to create than eagerZeroedThick, more predictable I/O performance than thin. 'eagerZeroedThick' (Thick Provision Eager Zeroed) - allocates full disk size AND zeros out all blocks at creation time. Slowest to create (can take minutes for large disks), but provides most consistent I/O performance and is REQUIRED for vSphere features like Fault Tolerance. RECOMMENDATION: Use 'thin' for most OpenShift installations - it's space-efficient and performs well for typical workloads. Use 'thick' or 'eagerZeroedThick' only when: (1) You need guaranteed storage capacity upfront (avoiding over-subscription). (2) Predictable I/O performance is critical (e.g., etcd on control plane nodes in high-transaction clusters). (3) Your storage team mandates thick provisioning policies. (4) You're enabling vSphere Fault Tolerance (requires eagerZeroedThick). IMPORTANT: Thin provisioning requires monitoring datastore space - if the datastore fills up, thin disk expansion can fail and VMs can pause. Ensure adequate datastore capacity and alerts. This setting applies to ALL cluster nodes (control plane and workers). For production etcd performance, some organizations prefer thick or eagerZeroedThick for control plane nodes, but this requires post-install MachineConfig customization (install-config applies one type to all nodes). Example: Leave 'Not set' for most installs (uses datastore default, usually thin). Set 'eagerZeroedThick' only if mandated by storage team or for Fault Tolerance requirements.`}
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
                      hint={`Comma-separated list of failure domain names where worker (compute) nodes should be deployed. Each name must EXACTLY match a 'Name' field from the failure domains you defined above (case-sensitive). Example: if you created failure domains named 'fd-0', 'fd-1', and 'fd-2', enter 'fd-0, fd-1, fd-2' here (or a subset like 'fd-0, fd-1' if you want workers only in those two zones). WHY SET THIS: By specifying compute zones, you control which failure domains host worker nodes for high availability. If left blank, the installer defaults to spreading workers across ALL defined failure domains automatically. WHEN TO SET IT: (1) You want workers in only a subset of failure domains (e.g., you have 4 zones but want workers in only 3 of them). (2) You want asymmetric placement (e.g., control plane in zones A/B/C, but workers only in zones A/B). (3) You want to explicitly document zone placement in install-config. HOW IT WORKS: The installer distributes worker replicas evenly across the specified zones. For example, if you have 6 workers and specify 3 zones, each zone gets 2 workers. If worker count doesn't divide evenly, some zones get one extra worker. IMPORTANT: The zone names here are just identifiers - they don't create new failure domains. You must first define failure domains in the 'Failure domains' section above with datacenter, cluster, datastore, and network details. This field simply references those pre-defined failure domains by name. Format: Comma-separated names, spaces allowed, no quotes needed. Example: 'fd-0, fd-1, fd-2' or 'zone-east, zone-west' (matching your failure domain names).`}
                    >
                      <input
                        value={Array.isArray(platformConfig.vsphere?.computeZones) ? platformConfig.vsphere.computeZones.join(", ") : ""}
                        onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, computeZones: e.target.value.split(",").map((z) => z.trim()).filter(Boolean) } })}
                        placeholder="e.g. fd-0, fd-1"
                      />
                    </FieldLabelWithInfo>
                    <FieldLabelWithInfo
                      label="Control plane zones"
                      hint={`Comma-separated list of failure domain names where control plane (master) nodes should be deployed. Each name must EXACTLY match a 'Name' field from the failure domains you defined above (case-sensitive). Example: if you created failure domains named 'fd-0', 'fd-1', and 'fd-2', enter 'fd-0, fd-1, fd-2' here for full high availability. WHY SET THIS: Control plane zone placement is CRITICAL for cluster availability. You should spread control plane nodes across multiple failure domains (typically 3) to survive zone-level failures. If left blank, the installer defaults to spreading control plane across ALL defined failure domains (which is usually what you want). WHEN TO SET IT: (1) You want control plane in only a subset of failure domains (e.g., you have 4 zones but want control plane in only the first 3). (2) You want asymmetric placement (e.g., control plane in zones A/B/C, but workers in zones C/D/E). (3) You want to explicitly document control plane placement in install-config for compliance/architecture records. HOW IT WORKS: OpenShift always uses 3 or 5 control plane nodes (odd number for etcd quorum). If you specify 3 zones, one control plane node goes in each zone. If you specify fewer zones than control plane nodes, some zones will host multiple control plane nodes (reduces availability). If you specify more zones than control plane nodes, only a subset of zones will get control plane nodes. IMPORTANT: For production high availability, you should have AT LEAST 3 zones specified here (one control plane node per zone). This ensures the cluster survives a zone failure - if one zone goes down, you still have 2/3 control plane nodes for etcd quorum. Never put all control plane nodes in the same zone (defeats the purpose of failure domains). Format: Comma-separated names, spaces allowed, no quotes needed. Example: 'fd-0, fd-1, fd-2' or 'zone-east, zone-central, zone-west' (matching your failure domain names).`}
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
                      hint={`HTTP/HTTPS URL to a custom RHCOS (Red Hat CoreOS) OVA image for cluster nodes. Leave blank to use the default RHCOS image for your OpenShift version.

**What is this:**
URL pointing to a Red Hat CoreOS OVA file that the installer will download and import into vSphere as a template, then clone to create cluster VMs.

**When to use:**
• Disconnected/airgap installations where you've hosted RHCOS images on an internal web server
• Custom RHCOS images with site-specific modifications
• Testing specific RHCOS versions
• When you cannot use per-failure-domain template paths

**Image Strategy - Choose ONE:**
⚠️ Use EITHER clusterOSImage (this field) OR Topology: RHCOS template per failure domain. Do NOT set both.
• clusterOSImage: Single URL for the entire cluster
• topology.template: Per-failure-domain template paths in vSphere inventory

**Requirements:**
1. URL must be reachable from where you run openshift-install
2. Must be HTTPS or HTTP (HTTPS recommended for security)
3. Image must match your selected OpenShift release version exactly
4. Format must be OVA (Open Virtualization Archive)

**Example:**
https://mirror.example.com/rhcos-4.14.0-x86_64-vmware.ova
http://192.168.1.100/images/rhcos-vmware.ova`}
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
                  <div className="field-grid">
                    <FieldLabelWithInfo
                      label="osDisk.diskSizeGB (optional)"
                      hint={`Root disk size in gigabytes (GB) for each VM's operating system disk. Leave blank to use defaults (120GB).

**What's stored on this disk:**
• RHCOS operating system
• Container runtime (CRI-O)
• etcd data (control plane nodes only)
• Local ephemeral storage
• System logs and temporary files

**Recommended sizes:**
• **Control plane:** 120GB minimum, 200GB+ for production (etcd grows over time)
• **Workers (light):** 60-120GB for basic workloads
• **Workers (general):** 120-200GB for typical applications
• **Workers (heavy):** 200-500GB+ for local databases, caching, or high pod density

**Important considerations:**
⚠️ Cannot be easily shrunk after installation - plan for growth upfront
⚠️ Thin-provisioned by default (see diskType setting) - only consumes actual used space initially
⚠️ Applies cluster-wide to all machine pools in install-config (per-pool sizing requires post-install MachineSet customization)

**Expansion:**
Volumes CAN be expanded post-install, but it requires node draining and manual procedures. Better to oversize initially.

**Example values:**
• 120 - Minimum for production control plane
• 200 - Control plane with room to grow
• 150 - General workers
• 500 - Workers with local storage needs`}
                    >
                      <input
                        type="number"
                        min={1}
                        value={platformConfig.vsphere?.osDiskDiskSizeGB ?? ""}
                        onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, osDiskDiskSizeGB: e.target.value === "" ? undefined : Number(e.target.value) } })}
                        placeholder="Leave empty for default"
                      />
                    </FieldLabelWithInfo>
                    <FieldLabelWithInfo
                      label="cpus (optional)"
                      hint={`Number of virtual CPUs (vCPUs) to assign to each VM. Leave blank for defaults (4 vCPUs control plane, 2 vCPUs workers).

**What this controls:**
Total CPU resources available to the VM's operating system. More vCPUs = more parallel processing capacity.

**Recommended sizing:**

**Control Plane:**
• 4 vCPUs - Minimum for small clusters (<50 nodes)
• 8 vCPUs - Production clusters (50-200 nodes)
• 16+ vCPUs - Large clusters (200+ nodes) or many operators/CRDs

**Workers:**
• 2-4 vCPUs - Light workloads (web services, simple apps)
• 4-8 vCPUs - General purpose (microservices, moderate load)
• 8-16 vCPUs - Compute-intensive (batch jobs, CI/CD)
• 16+ vCPUs - Heavy workloads (databases, ML, video encoding)

**Physical resource planning:**
⚠️ vCPUs are scheduled against physical cores on ESXi hosts
⚠️ Ensure sufficient physical cores: Total vCPUs across all VMs ≤ (Physical cores × overcommit ratio)
⚠️ Typical overcommit: 2:1 for general workloads, 1:1 for latency-sensitive (etcd)
⚠️ Over-provisioning too much degrades performance

**Combined with coresPerSocket:**
cpus + coresPerSocket determine VM's virtual topology (sockets × cores). See coresPerSocket field for details.

**Example values:**
• 4 - Control plane for small clusters
• 8 - Production control plane
• 4 - General workers
• 16 - Database/compute workers`}
                    >
                      <input
                        type="number"
                        min={1}
                        value={platformConfig.vsphere?.cpus ?? ""}
                        onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, cpus: e.target.value === "" ? undefined : Number(e.target.value) } })}
                        placeholder="Leave empty for default"
                      />
                    </FieldLabelWithInfo>
                    <FieldLabelWithInfo
                      label="coresPerSocket (optional)"
                      hint={`Number of CPU cores per virtual socket. Leave blank for defaults (all cores in one socket).

**What this controls:**
How vCPUs are presented to the guest OS as sockets and cores. Does NOT change total vCPUs.

**Formula:**
Sockets = cpus ÷ coresPerSocket

**Examples:**
• cpus=8, coresPerSocket=4 → 2 sockets × 4 cores
• cpus=8, coresPerSocket=2 → 4 sockets × 2 cores
• cpus=8, coresPerSocket=8 → 1 socket × 8 cores

**Why it matters:**

**Licensing:**
Some software licenses charge per socket (not per core). Higher coresPerSocket = fewer sockets = lower license cost.
Not relevant for OpenShift/RHCOS.

**NUMA (Non-Uniform Memory Access):**
Affects memory access patterns on large VMs (32+ vCPUs). Misaligned NUMA topology can degrade performance.

**When to set:**
• Leave blank for typical OpenShift nodes (≤16 vCPUs) - single socket is fine
• Set for very large VMs (32+ vCPUs) - consult vSphere NUMA best practices
• Set if you have specific performance tuning requirements

**Recommendation:**
⚠️ Leave blank unless you have specific reasons. Default is optimal for most deployments.

**Example:**
8 (for an 8-vCPU VM presented as 1 socket × 8 cores)`}
                    >
                      <input
                        type="number"
                        min={1}
                        value={platformConfig.vsphere?.coresPerSocket ?? ""}
                        onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, coresPerSocket: e.target.value === "" ? undefined : Number(e.target.value) } })}
                        placeholder="Leave empty for default"
                      />
                    </FieldLabelWithInfo>
                    <FieldLabelWithInfo
                      label="memoryMB (optional)"
                      hint={`Memory (RAM) in megabytes (MB) to assign to each VM. Leave blank to use installer defaults (16384MB = 16GB for control plane, 8192MB = 8GB for workers). For control plane nodes, 16GB minimum is required for production (etcd, API server, controllers are memory-intensive). 32GB+ recommended for large clusters (100+ nodes) or if running many operators. For worker nodes, size based on workload - 8GB minimum for light workloads, 16-32GB for general apps, 64GB+ for memory-intensive workloads (databases, big data, ML). Example: 16384 (16GB) for basic control plane, 32768 (32GB) for busy control plane, 16384 for general workers, 65536 (64GB) for database workers. IMPORTANT: The host must have sufficient physical RAM. vSphere memory over-commitment (more virtual RAM allocated than physical) can severely impact OpenShift performance, especially for etcd. Always ensure adequate physical RAM is available. Memory in MB = value you enter (e.g., 16384 = 16GB). Use multiples of 1024 for clean GB values (8192 = 8GB, 16384 = 16GB, 32768 = 32GB, etc.).`}
                    >
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
                  <FieldLabelWithInfo
                    className="field-grid-span-full"
                    label="Provisioning network"
                    hint={`Managed (default): The installer runs DHCP and TFTP on the provisioning network; no other DHCP on that network. Choose when you have a dedicated provisioning NIC and can give the installer full control. Unmanaged: Provisioning network exists but you run DHCP yourself; virtual media is recommended, PXE still possible. Choose when you must use existing DHCP or share the network. Disabled: No provisioning network; use virtual media or Assisted Installer only. BMCs must be reachable on the bare-metal network; reserve two IPs on that network for provisioning services. Choose for fully static or disconnected flows.`}
                    required={metaProvisioningNetwork?.required}
                  >
                    <select
                      value={provisioningMode}
                      onChange={(e) => updateInventory({ provisioningNetwork: e.target.value })}
                      style={{ maxWidth: "100%", width: "100%", boxSizing: "border-box" }}
                    >
                      <option value="Managed">Managed — installer runs DHCP/TFTP</option>
                      <option value="Unmanaged">Unmanaged — you provide DHCP</option>
                      <option value="Disabled">Disabled — virtual media / no provisioning net</option>
                    </select>
                  </FieldLabelWithInfo>
                  <FieldLabelWithInfo
                    label="Provisioning network CIDR (optional)"
                    hint={provisioningMode === "Disabled"
                      ? "When Disabled, provisioning services use the bare-metal network; omit or use bare-metal CIDR if needed."
                      : "CIDR (Classless Inter-Domain Routing) notation for the provisioning network's IP address range. Defines the subnet where the OpenShift installer runs provisioning services and assigns temporary IPs to nodes during bootstrap.\n\n**What is this:**\nIPv4 or IPv6 network range in CIDR format (e.g., 172.22.0.0/24) that defines the provisioning network's address space. The installer uses this subnet for DHCP assignments, bootstrap services, and node imaging.\n\n**Format:**\nNetwork address / prefix length\n• IPv4 example: 172.22.0.0/24 (256 addresses)\n• IPv6 example: fd00::/64\n\n**When to set:**\n• **Managed mode:** Optional but recommended - defines the provisioning subnet for DHCP and services\n• **Unmanaged mode:** Optional - documents your existing provisioning network CIDR\n• **Disabled mode:** Omit, or set to bare-metal network CIDR if provisioning services run on that network\n\n**Default behavior:**\nIf omitted in Managed mode, installer may use a default range (consult OpenShift docs for version-specific defaults)\n\n**Sizing guidelines:**\n• /24 (256 addresses) - Standard for small-medium clusters (up to 50 nodes)\n• /23 (512 addresses) - Large clusters or future expansion\n• /25 (128 addresses) - Small clusters (under 20 nodes)\n\n**Requirements:**\n• Must not overlap with Machine network, Cluster network, or Service network CIDRs (from Networking tab)\n• Must be routable only on the provisioning network segment (isolated from production traffic)\n• Enough addresses for all nodes + bootstrap + DHCP overhead (nodes × 2 recommended)\n\n**Relationship to other fields:**\n• **provisioningDHCPRange:** DHCP range must be within this CIDR\n• **clusterProvisioningIP:** Provisioning services IP must be within this CIDR\n\n**Example:**\n172.22.0.0/24 (common choice for isolated provisioning network)"}
                  >
                    <input
                      value={inventory.provisioningNetworkCIDR || ""}
                      onChange={(e) => updateInventory({ provisioningNetworkCIDR: e.target.value.trim() })}
                      placeholder={provisioningMode === "Disabled" ? "omit or bare-metal CIDR" : "e.g. 172.22.0.0/24"}
                    />
                  </FieldLabelWithInfo>
                  <FieldLabelWithInfo
                    label="Provisioning network interface (optional)"
                    hint={provisioningMode === "Disabled"
                      ? "When Disabled, there is no provisioning network; omit unless your setup requires it."
                      : "Name of the network interface on the bootstrap/provisioning host that connects to the provisioning network. Identifies which NIC the installer binds provisioning services (DHCP, TFTP, HTTP) to.\n\n**What is this:**\nLinux network interface name (e.g., 'eth0', 'ens192', 'enp1s0') on the machine where you run openshift-install. The installer uses this interface to communicate with bare metal nodes during provisioning.\n\n**When to set:**\n• **Required when:** Bootstrap host has multiple network interfaces and you need to specify which one faces the provisioning network\n• **Optional when:** Single NIC system - installer auto-detects\n• **Not used when:** provisioningNetwork = 'Disabled'\n\n**How to find interface name:**\nOn the host where you'll run openshift-install:\n• Linux: `ip link show` or `ip addr show` (lists all interfaces)\n• Look for the interface connected to your provisioning VLAN/network\n\n**Common interface naming:**\n• **Predictable naming (systemd):** ens192, eno1, enp1s0\n• **Traditional naming:** eth0, eth1, eth2\n• **Bond interfaces:** bond0, bond1\n• **VLAN interfaces:** eth0.100, ens192.200\n\n**Requirements:**\n• Interface must be UP (enabled) before running openshift-install\n• Interface should have an IP address in the provisioning network CIDR\n• Interface must be physically connected to the same network segment as bare metal node BMCs and provisioning NICs\n\n**Relationship to provisioningMACAddress:**\nYou can specify interface by name (this field) OR by MAC address (provisioningMACAddress field) - either works, name is more human-readable\n\n**Example:**\neth1 (second NIC on traditional naming)\nens192 (typical VMware VM interface)\nenp2s0 (PCIe slot 2, port 0)"}
                  >
                    <input
                      value={inventory.provisioningNetworkInterface || ""}
                      onChange={(e) => updateInventory({ provisioningNetworkInterface: e.target.value })}
                      placeholder={provisioningMode === "Disabled" ? "omit" : "e.g. eth1"}
                    />
                  </FieldLabelWithInfo>
                  {showDhcpRange ? (
                    <FieldLabelWithInfo
                      label="Provisioning DHCP range (optional)"
                      hint={`IP address range for DHCP assignments on the provisioning network during bare metal node bootstrapping. Specifies the pool of IP addresses the installer's DHCP server uses when provisioning nodes.

**What this controls:**
When provisioning network mode is Managed, the OpenShift installer runs a DHCP server on the provisioning network that assigns temporary IP addresses to bare metal nodes during the imaging/bootstrap process.

**Format:**
Start IP, end IP (comma-separated, no spaces after comma)

**Requirements:**
• Both IPs must be within the provisioningNetworkCIDR subnet
• Range must have enough addresses for all nodes simultaneously booting (typically: control plane + workers + 1 bootstrap = 7+ addresses minimum for small cluster)
• Must not overlap with clusterProvisioningIP or any static IP assignments
• Must not conflict with other DHCP servers on the network

**When needed:**
• Required when provisioningNetwork = 'Managed' (installer runs DHCP)
• Not used when provisioningNetwork = 'Unmanaged' (you run DHCP) or 'Disabled' (no provisioning network)

**Provisioning network modes:**
• **Managed:** Installer runs DHCP/TFTP, requires this range
• **Unmanaged:** You provide DHCP, omit this field
• **Disabled:** No provisioning network, omit this field

**Recommendations:**
• Leave 10-20 address buffer above your expected node count (allows for retries, failed boots)
• Avoid using the very first IP in subnet (.1) or broadcast address - mid-range IPs are safer
• For a typical 3-control + 3-worker cluster: 10-address range is sufficient

**Example:**
172.22.0.10,172.22.0.254 (245 addresses for large deployments)
172.22.0.50,172.22.0.80 (31 addresses for smaller clusters)`}
                    >
                      <input
                        value={inventory.provisioningDHCPRange || ""}
                        onChange={(e) => updateInventory({ provisioningDHCPRange: e.target.value })}
                        placeholder="e.g. 172.22.0.10,172.22.0.254"
                      />
                    </FieldLabelWithInfo>
                  ) : null}
                  <FieldLabelWithInfo
                    label="Cluster provisioning IP (optional)"
                    hint={provisioningMode === "Disabled"
                      ? "When Disabled, one of two IPs on the bare-metal network for provisioning services (installer needs two IPs on bare-metal network when no dedicated provisioning network exists)."
                      : "IPv4 or IPv6 address assigned to the provisioning host's interface where OpenShift installer provisioning services (DHCP, TFTP, HTTP) listen. This is the IP nodes contact to fetch boot images and configuration during installation.\n\n**What is this:**\nStatic IP address on the provisioning network that the installer binds its services to. Bare metal nodes PXE boot and download images from this IP during the bootstrap process.\n\n**Default behavior:**\nIf omitted, the installer typically uses the **third IP** of the provisioning subnet (catalog default). For example, if provisioningNetworkCIDR is 172.22.0.0/24, default might be 172.22.0.3.\n\n**When to set explicitly:**\n• When you need a specific IP for firewall rules or DNS entries\n• When the third IP of the subnet is already in use\n• When integrating with existing provisioning infrastructure that expects a particular IP\n\n**Requirements:**\n• **Managed/Unmanaged modes:** Must be within provisioningNetworkCIDR\n• **Disabled mode:** Must be on the bare-metal network (Machine network CIDR)\n• Must NOT conflict with provisioningDHCPRange\n• Must be statically assigned (not in DHCP dynamic range)\n• Must be reachable from bare metal node BMCs and boot interfaces\n\n**Provisioning mode specifics:**\n\n**Managed:** \nInstaller runs DHCP/TFTP on this IP on the provisioning network. Nodes receive this IP via DHCP options as their boot server.\n\n**Unmanaged:**\nYou run DHCP elsewhere, but installer HTTP/image services still bind to this IP. Configure your DHCP server to point nodes to this IP for image downloads.\n\n**Disabled:**\nNo dedicated provisioning network - installer services run on the bare-metal network. This IP is one of two IPs needed on the bare-metal network for provisioning (the other for bootstrap services).\n\n**How nodes use this IP:**\n• PXE boot: Fetch kernel/initrd via TFTP from this IP\n• Image download: Pull RHCOS images via HTTP from this IP\n• Ignition config: Retrieve bootstrap configuration from this IP\n\n**Example:**\n172.22.0.10 (Managed mode, within 172.22.0.0/24)\n10.0.0.100 (Disabled mode, on bare-metal network 10.0.0.0/24)"}
                  >
                    <input
                      value={inventory.clusterProvisioningIP || ""}
                      onChange={(e) => updateInventory({ clusterProvisioningIP: e.target.value.trim() })}
                      placeholder={provisioningMode === "Disabled" ? "IP on bare-metal network" : "IP within provisioning subnet"}
                    />
                  </FieldLabelWithInfo>
                  <FieldLabelWithInfo
                    label="Provisioning MAC address (optional)"
                    hint={`MAC (hardware) address of the network interface on the bootstrap/provisioning host where the OpenShift installer runs provisioning services (DHCP, TFTP, HTTP) during bare metal installation.

**What is this:**
During bare metal IPI installation, the installer needs to serve boot images and configuration files to the nodes being provisioned. It binds these services to a specific network interface on the host where openshift-install runs. This field identifies that interface by its MAC address.

**Format:**
Six colon-separated or hyphen-separated hex octets
• Colon format: AA:BB:CC:DD:EE:FF
• Hyphen format: AA-BB-CC-DD-EE-FF

**When to set:**
• When you have multiple network interfaces and need to specify which one faces the provisioning network
• When provisioningNetwork = 'Managed' or 'Unmanaged' (ignored for 'Disabled')
• Leave blank to let the installer auto-detect based on provisioningNetworkInterface name

**How to find MAC address:**
On the host where you'll run openshift-install:
• Linux: \`ip link show <interface>\` or \`ip addr show <interface>\` (look for \\"link/ether\\")
• Example output: \`link/ether 52:54:00:12:34:56\`

**Relationship to other fields:**
• **provisioningNetworkInterface:** The interface name (e.g., 'eth1') - this field is its MAC address
• **clusterProvisioningIP:** The IP assigned to this interface on the provisioning network

**When to leave blank:**
• Single network interface system - installer auto-detects
• Using provisioningNetworkInterface to specify interface by name instead
• provisioningNetwork = 'Disabled'

**Example:**
52:54:00:ab:cd:ef (typical virtual machine MAC)
00:1a:2b:3c:4d:5e (physical NIC MAC)`}
                  >
                    <input
                      value={inventory.provisioningMACAddress || ""}
                      onChange={(e) => updateInventory({ provisioningMACAddress: formatMACAsYouType(e.target.value) })}
                      placeholder="MAC where provisioning services run"
                    />
                  </FieldLabelWithInfo>
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
                      <FieldLabelWithInfo label="vSphere folder (optional, legacy)" hint={`⚠️ **DEPRECATED:** Use Topology: Folder per failure domain instead. This legacy field only applies when using legacy single placement mode (not recommended for OpenShift 4.20+).

**What this is:**
Absolute VM folder path in vSphere inventory where the installer places OpenShift VMs when using legacy placement (without failure domains).

**Deprecation notice:**
OpenShift 4.20 documentation (§9.1.5) deprecates global folder/resource pool fields. Modern deployments should use failure domains with per-domain topology settings.

**Legacy behavior (if you must use it):**
• Format: \`/datacenter-name/vm/folder-name\` or \`/datacenter-name/vm/parent/child\`
• Example: \`/Datacenter1/vm/OpenShift\` or \`/DC1/vm/Production/OCP\`
• Leave blank to use datacenter root VM folder

**Why failure domains are better:**
• Multi-zone placement for high availability
• Per-zone folder organization
• Clearer separation of infrastructure by availability zone
• Future-proof for multi-datacenter deployments

**Migration path:**
Switch to 'Use failure domains (recommended)' radio button above and set Topology: Folder for each failure domain instead of using this global field.

**When to use legacy mode:**
Only when you cannot use failure domains (e.g., single cluster deployment with no zone separation needs).`}>
                        <input
                          value={platformConfig.vsphere?.folder || ""}
                          onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, folder: e.target.value } })}
                          placeholder="VM folder path"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo label="vSphere resource pool (optional, legacy)" hint={`⚠️ **DEPRECATED:** Use Topology: Resource pool per failure domain instead. This legacy field only applies when using legacy single placement mode (not recommended for OpenShift 4.20+).

**What this is:**
Absolute resource pool path in vSphere inventory for CPU/memory resource management of VMs when using legacy placement (without failure domains).

**Deprecation notice:**
OpenShift 4.20 documentation (§9.1.5) deprecates global folder/resource pool fields. Modern deployments should use failure domains with per-domain topology settings.

**Legacy behavior (if you must use it):**
• Format: \`/datacenter-name/host/cluster-name/Resources/pool-name\`
• Example: \`/Datacenter1/host/Cluster1/Resources/OpenShift-Pool\`
• Leave blank to use cluster's root Resources pool (default)

**What are resource pools:**
vSphere resource pools partition CPU and memory with reservations, limits, and shares. Useful for:
• Guaranteeing resources to OpenShift separate from other workloads
• Preventing resource contention on shared compute clusters
• Enforcing resource quotas or SLAs

**Why failure domains are better:**
• Different resource pools per availability zone
• Independent resource allocation across zones
• Clearer separation for multi-cluster/multi-tenant environments
• Future-proof for complex infrastructure topologies

**Migration path:**
Switch to 'Use failure domains (recommended)' radio button above and set Topology: Resource pool for each failure domain instead of using this global field.

**When to use legacy mode:**
Only when you cannot use failure domains and need basic resource pool assignment for all cluster VMs in a single pool.`}>
                        <input
                          value={platformConfig.vsphere?.resourcePool || ""}
                          onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, resourcePool: e.target.value } })}
                          placeholder="Resource pool path"
                        />
                      </FieldLabelWithInfo>
                    </>
                  )}
                  {showAgentOptionsSection && (
                    <FieldLabelWithInfo
                      label="Boot artifacts base URL"
                      hint={metaBootArtifacts?.description || "Base URL where Agent-based installer boot artifacts (kernel, initramfs, rootfs) are hosted for network-based installation. REQUIRED for Agent-based installs using network boot (PXE/iPXE) instead of full ISO. WHAT IS THIS: When using Agent-based installation with minimal ISO or network boot, the installer needs to download OS boot artifacts (RHCOS kernel, initramfs, and root filesystem images) from an HTTP/HTTPS server. This URL points to the directory containing those artifacts. WHY YOU NEED IT: Full ISOs embed all boot artifacts (~1GB+), making them large and slow to distribute. Minimal ISOs (~100MB) or network boot (PXE) are faster but require boot artifacts to be served from a web server. In disconnected/airgap environments, you host these artifacts on an internal HTTP server. FORMAT: Must be a complete HTTP or HTTPS URL ending at the directory containing the artifacts, NOT including the artifact filenames themselves. Example: 'https://mirror.example.com/openshift/agent-artifacts' or 'http://192.168.1.100/rhcos-boot'. The installer appends filenames like 'agent.x86_64-initrd.img', 'agent.x86_64-vmlinuz', and 'agent.x86_64-rootfs.img' to this base URL. CRITICAL SETUP: (1) Download agent boot artifacts from Red Hat (or mirror them from official sources) matching your OpenShift version. (2) Place them in a web-accessible directory on your HTTP server. (3) Verify artifacts are downloadable: 'curl <base-url>/agent.x86_64-vmlinuz' should succeed. (4) Ensure the web server is reachable from the network where your bare metal nodes will boot (same subnet or routable). LEAVE BLANK when using full ISO (not minimal ISO or network boot). Example: 'https://mirror.internal.example.com/ocp-4.14/agent-boot'."}
                      required={metaBootArtifacts?.required || isRequiredAgent("bootArtifactsBaseURL")}
                    >
                      <input
                        value={inventory.bootArtifactsBaseURL || ""}
                        onChange={(e) => updateInventory({ bootArtifactsBaseURL: e.target.value })}
                        placeholder="https://example.com/agent-artifacts or leave empty"
                      />
                    </FieldLabelWithInfo>
                  )}
                  {showComputeHyperthreading && (
                    <FieldLabelWithInfo
                      label="Compute hyperthreading (optional)"
                      hint={metaComputeHyperthreading?.description || "Enable or disable CPU hyperthreading (simultaneous multithreading / SMT) on worker (compute) nodes. Leave as 'Not set' to use platform defaults (hyperthreading enabled on most platforms). WHAT IS HYPERTHREADING: Hyperthreading (Intel) or SMT (AMD) allows a single physical CPU core to run two threads simultaneously, doubling the logical CPU count seen by the operating system. A 16-core server with hyperthreading shows 32 vCPUs to OpenShift. This improves CPU utilization for many workloads but can introduce performance variability. WHY DISABLE IT: Some workloads benefit from disabling hyperthreading: (1) Latency-sensitive real-time applications (telecom, industrial control) require predictable CPU scheduling. (2) High-performance computing (HPC) workloads with tight CPU affinity. (3) Security-conscious environments mitigating speculative execution vulnerabilities (Spectre, Meltdown - hyperthreading can increase attack surface). (4) Licensing constraints (some software is licensed per logical CPU - disabling hyperthreading halves the count). WHY KEEP IT ENABLED (default): Most general-purpose workloads (web apps, databases, microservices) benefit from hyperthreading - higher throughput, better CPU utilization. Disabling it reduces available CPU capacity by ~30-40% (you lose half your vCPUs). OPTIONS: 'Enabled' (default) - hyperthreading on, 'Disabled' - hyperthreading off. IMPORTANT: This setting applies to ALL worker nodes at install time. You cannot selectively disable it per-node or per-MachineSet in install-config (that requires post-install tuning via MachineConfig and kubelet settings). Example: Set 'Disabled' for low-latency telco workloads, leave 'Not set' (enabled) for general clusters."}
                    >
                      <select
                        value={platformConfig.computeHyperthreading || ""}
                        onChange={(e) => updatePlatformConfig({ computeHyperthreading: e.target.value || undefined })}
                      >
                        <option value="" disabled>Not set</option>
                        {hyperthreadingOptions.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </FieldLabelWithInfo>
                  )}
                  {showControlPlaneHyperthreading && (
                    <FieldLabelWithInfo
                      label="Control plane hyperthreading (optional)"
                      hint={metaControlPlaneHyperthreading?.description || "Enable or disable CPU hyperthreading (simultaneous multithreading / SMT) on control plane (master) nodes. Leave as 'Not set' to use platform defaults (hyperthreading enabled on most platforms). WHAT IS HYPERTHREADING: Hyperthreading (Intel) or SMT (AMD) allows a single physical CPU core to run two threads simultaneously, doubling the logical CPU count. Control plane nodes run etcd (distributed database), Kubernetes API server, scheduler, and controllers - all CPU-intensive services. IMPORTANT: Control plane nodes are generally MORE sensitive to CPU performance than workers because etcd requires consistent low-latency CPU scheduling. Disabling hyperthreading can IMPROVE control plane stability for latency-critical clusters by reducing CPU scheduling variability. WHY DISABLE IT ON CONTROL PLANE: (1) etcd performance - etcd is extremely sensitive to CPU latency jitter. Hyperthreading can introduce unpredictable scheduling delays when both threads on a core are busy. Disabling hyperthreading gives etcd exclusive access to physical cores for more consistent latency. (2) Security - control plane runs privileged infrastructure components. Disabling hyperthreading mitigates speculative execution attacks (Spectre/Meltdown) that can leak secrets between threads on the same core. (3) Real-time Kubernetes (telco, edge) - telco clusters often disable hyperthreading on control plane for 5G/MEC latency guarantees. WHY KEEP IT ENABLED (default): For most clusters, the throughput benefit of hyperthreading outweighs the latency penalty. Control plane nodes typically have 8+ physical cores, providing adequate performance even with hyperthreading variability. OPTIONS: 'Enabled' (default) - hyperthreading on, 'Disabled' - hyperthreading off. CAN YOU MIX? Yes - you can disable hyperthreading on control plane while keeping it enabled on workers (common for telco/edge clusters). Example: Set 'Disabled' for telco/edge clusters with strict latency SLAs, leave 'Not set' (enabled) for general-purpose clusters."}
                    >
                      <select
                        value={platformConfig.controlPlaneHyperthreading || ""}
                        onChange={(e) => updatePlatformConfig({ controlPlaneHyperthreading: e.target.value || undefined })}
                      >
                        <option value="" disabled>Not set</option>
                        {hyperthreadingOptions.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </FieldLabelWithInfo>
                  )}
                  {showCapabilities && (
                    <>
                      <FieldLabelWithInfo
                        label="Baseline capability set (optional)"
                        hint={metaBaselineCapability?.description || "Defines the baseline set of OpenShift capabilities (cluster features) to enable at installation time. Capabilities control which optional components are deployed (monitoring, console, marketplace, etc.). Leave as 'Not set' to use the default 'vCurrent' (all current-version capabilities enabled). WHAT ARE CAPABILITIES: OpenShift 4.11+ uses a modular capability system to let you install minimal clusters (reduced footprint) by excluding optional components. Each capability represents a cluster feature - e.g., 'Console' (web UI), 'Insights' (telemetry), 'Marketplace' (operator hub), 'NodeTuning' (performance tuning). Disabling capabilities reduces resource consumption (control plane CPU/memory) and can simplify airgap scenarios (fewer images to mirror). OPTIONS: 'vCurrent' (default) - enables all capabilities for your OpenShift version (full-featured cluster). 'v4.11' / 'v4.12' / etc. - freezes capability set to a specific version (use for version-pinned deployments). 'None' - minimal cluster with ONLY core Kubernetes and OpenShift infrastructure (no console, no monitoring, no marketplace) - use for ultra-lightweight edge nodes or when you add capabilities manually post-install. WHEN TO USE MINIMAL: (1) Edge deployments with severe resource constraints (single-node OpenShift on small hardware). (2) Airgap environments where mirroring all images is impractical. (3) Security-hardened clusters where you want explicit control over every component. (4) Development/testing where full features aren't needed. IMPORTANT: Starting with a minimal set ('None') means features like the web console and monitoring won't be available until you enable those capabilities post-install (requires editing ClusterVersion object and mirroring additional images). Most users should leave this as 'Not set' (vCurrent) unless they have specific minimal-cluster requirements. You can add individual capabilities via 'Additional enabled capabilities' field below. Example: Set 'None' for minimal edge nodes, leave 'Not set' for normal clusters."}
                      >
                        <select
                          value={platformConfig.baselineCapabilitySet || (metaBaselineCapability?.default ?? "")}
                          onChange={(e) => updatePlatformConfig({ baselineCapabilitySet: e.target.value || undefined })}
                        >
                          <option value="" disabled>Not set</option>
                          {baselineCapabilityOptions.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Additional enabled capabilities (optional, comma-separated)"
                        hint={`List of specific OpenShift capabilities to enable beyond the baseline capability set, allowing fine-grained control over which optional cluster features are installed.

**What are capabilities:**
OpenShift 4.11+ uses a modular capability system where optional components (console, monitoring, marketplace, etc.) can be individually enabled or disabled to reduce cluster footprint and complexity.

**How this works with baseline:**
• **Baseline capability set** defines the starting point (e.g., 'vCurrent' = all capabilities, 'None' = minimal)
• **Additional enabled capabilities** (this field) adds specific capabilities ON TOP of the baseline

**Use cases:**

**Minimal cluster with selective features:**
Set baselineCapabilitySet = 'None', then add only what you need:
• additionalEnabledCapabilities: 'Console, Ingress' (minimal cluster with web UI and ingress routing, but no monitoring/marketplace/etc.)

**Standard cluster minus one feature:**
Set baselineCapabilitySet = 'vCurrent', then use \`capabilities.baselineCapabilitySet: vCurrent\` would enable everything, so this field is typically used WITH minimal baselines.

**Common capability names:**
• **Console** - Web UI dashboard
• **Insights** - Red Hat telemetry and health recommendations
• **Marketplace** - OperatorHub marketplace UI
• **NodeTuning** - Node tuning operator
• **Ingress** - Ingress controller
• **CSISnapshot** - CSI volume snapshotting
• **Storage** - Storage operator
• **Build** - Build controller
• **DeploymentConfig** - DeploymentConfig resources

**Format:**
Comma-separated capability names (case-sensitive): \`Console, Marketplace, Insights\`

**When to use:**
• Edge deployments starting from minimal baseline + specific needs
• Airgap where you want to mirror only specific operator images
• Security-hardened clusters where each capability must be explicitly justified

**When to leave blank:**
• When baselineCapabilitySet = 'vCurrent' (already enables all capabilities)
• When you want exactly the baseline with no additions

**Example:**
Console, Ingress (minimal cluster with UI and routing)
Console, Marketplace, Insights (minimal + marketplace)`}
                      >
                        <input
                          value={Array.isArray(platformConfig.additionalEnabledCapabilities) ? platformConfig.additionalEnabledCapabilities.join(", ") : (typeof platformConfig.additionalEnabledCapabilities === "string" ? platformConfig.additionalEnabledCapabilities : "")}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            const arr = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
                            updatePlatformConfig({ additionalEnabledCapabilities: arr });
                          }}
                          placeholder="e.g. baremetal, marketplace"
                        />
                      </FieldLabelWithInfo>
                    </>
                  )}
                  {showCpuPartitioningMode && (
                    <FieldLabelWithInfo
                      label="CPU partitioning mode (optional)"
                      hint={metaCpuPartitioningMode?.description || "Configures CPU partitioning to isolate cluster infrastructure workloads from application workloads on the same nodes (single-node or performance-tuned clusters). Leave as 'Not set' or 'None' for standard clusters. Set to 'AllNodes' for low-latency, real-time, or telco edge deployments. WHAT IS CPU PARTITIONING: CPU partitioning reserves a dedicated set of CPU cores for OpenShift infrastructure pods (kubelet, CRI-O, system services) while isolating application pods to a separate set of cores. This prevents infrastructure overhead from interfering with latency-sensitive workloads. WHY USE IT: Required for real-time workloads (5G/MEC, industrial automation, robotics) that demand guaranteed CPU access without interference from cluster overhead. Common in telco edge Single-Node OpenShift (SNO) deployments where infrastructure and apps share the same physical host. OPTIONS: 'None' (default) - no CPU partitioning, all workloads share CPUs dynamically (standard behavior). 'AllNodes' - enable CPU partitioning on all nodes (or on SNO) - you must also configure CPU manager policies and workload partitioning via Performance Add-on Operator or MachineConfig post-install. HOW IT WORKS: When 'AllNodes' is set, OpenShift reserves CPUs for infrastructure (typically cores 0-1 on a small node, or cores 0-3 on larger nodes) and schedules app pods only on the remaining 'isolated' cores using cgroups and CPU affinity. You configure the exact core split via Performance Profile or PerformanceAddon Operator after installation. PREREQUISITES: (1) Nodes must have sufficient cores (minimum 4 cores for SNO with partitioning - 2 for infra, 2 for apps; more cores recommended). (2) Hyperthreading often disabled (see hyperthreading fields) for predictable latency. (3) You must configure workload partitioning annotations and CPU manager policies post-install. IMPORTANT: Setting this alone doesn't partition CPUs - it signals intent in install-config. Actual partitioning requires post-install MachineConfig, Performance Add-on, and workload annotations. This is ADVANCED configuration for telco/edge/real-time use cases - do not set unless you understand workload partitioning and have a specific low-latency requirement. Example: Set 'AllNodes' for telco vRAN Single-Node OpenShift, leave 'None' for general clusters."}
                    >
                      <select
                        value={platformConfig.cpuPartitioningMode || (metaCpuPartitioningMode?.default ?? "None")}
                        onChange={(e) => updatePlatformConfig({ cpuPartitioningMode: e.target.value || undefined })}
                      >
                        <option value="" disabled>Not set</option>
                        {cpuPartitioningOptions.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </FieldLabelWithInfo>
                  )}
                </div>
                {showMinimalISO && (
                  <div className="platform-specifics-advanced-option-row">
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
                  </div>
                )}
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
