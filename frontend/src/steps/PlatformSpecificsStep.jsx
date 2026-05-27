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

/** Common AWS EC2 instance types for autocomplete suggestions. */
const AWS_INSTANCE_TYPES = [
  { value: "m5.large", label: "m5.large (General Purpose, 2 vCPU, 8 GB)" },
  { value: "m5.xlarge", label: "m5.xlarge (General Purpose, 4 vCPU, 16 GB)" },
  { value: "m5.2xlarge", label: "m5.2xlarge (General Purpose, 8 vCPU, 32 GB)" },
  { value: "m5.4xlarge", label: "m5.4xlarge (General Purpose, 16 vCPU, 64 GB)" },
  { value: "m6i.large", label: "m6i.large (General Purpose, 2 vCPU, 8 GB)" },
  { value: "m6i.xlarge", label: "m6i.xlarge (General Purpose, 4 vCPU, 16 GB)" },
  { value: "m6i.2xlarge", label: "m6i.2xlarge (General Purpose, 8 vCPU, 32 GB)" },
  { value: "m6i.4xlarge", label: "m6i.4xlarge (General Purpose, 16 vCPU, 64 GB)" },
  { value: "m6a.xlarge", label: "m6a.xlarge (General Purpose AMD, 4 vCPU, 16 GB)" },
  { value: "c5.large", label: "c5.large (Compute Optimized, 2 vCPU, 4 GB)" },
  { value: "c5.xlarge", label: "c5.xlarge (Compute Optimized, 4 vCPU, 8 GB)" },
  { value: "c5.2xlarge", label: "c5.2xlarge (Compute Optimized, 8 vCPU, 16 GB)" },
  { value: "c6i.xlarge", label: "c6i.xlarge (Compute Optimized, 4 vCPU, 8 GB)" },
  { value: "c6i.2xlarge", label: "c6i.2xlarge (Compute Optimized, 8 vCPU, 16 GB)" },
  { value: "r5.large", label: "r5.large (Memory Optimized, 2 vCPU, 16 GB)" },
  { value: "r5.xlarge", label: "r5.xlarge (Memory Optimized, 4 vCPU, 32 GB)" },
  { value: "r5.2xlarge", label: "r5.2xlarge (Memory Optimized, 8 vCPU, 64 GB)" },
  { value: "r6i.xlarge", label: "r6i.xlarge (Memory Optimized, 4 vCPU, 32 GB)" },
  { value: "r6i.2xlarge", label: "r6i.2xlarge (Memory Optimized, 8 vCPU, 64 GB)" },
  { value: "t3.medium", label: "t3.medium (Burstable, 2 vCPU, 4 GB - not for prod)" },
  { value: "t3.large", label: "t3.large (Burstable, 2 vCPU, 8 GB - not for prod)" },
  { value: "t3.xlarge", label: "t3.xlarge (Burstable, 4 vCPU, 16 GB - not for prod)" },
  { value: "m5n.xlarge", label: "m5n.xlarge (Network Optimized, 4 vCPU, 16 GB)" },
  { value: "c5n.xlarge", label: "c5n.xlarge (Network Optimized, 4 vCPU, 10.5 GB)" },
];

const hasParam = (catalogParams, path, outputFile) =>
  catalogParams.some((p) => p.path === path && p.outputFile === outputFile);

export default function PlatformSpecificsStep({ highlightErrors, fieldErrors = {} }) {
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

  // Local state for text inputs (onBlur pattern) - AWS
  const [localAwsAmiId, setLocalAwsAmiId] = useState(platformConfig.aws?.amiId || "");
  const [localAwsHostedZone, setLocalAwsHostedZone] = useState(platformConfig.aws?.hostedZone || "");
  const [localAwsHostedZoneRole, setLocalAwsHostedZoneRole] = useState(platformConfig.aws?.hostedZoneRole || "");
  const [localAwsControlPlaneInstanceType, setLocalAwsControlPlaneInstanceType] = useState(platformConfig.aws?.controlPlaneInstanceType || "");
  const [localAwsWorkerInstanceType, setLocalAwsWorkerInstanceType] = useState(platformConfig.aws?.workerInstanceType || "");
  const [localAwsRootVolumeSize, setLocalAwsRootVolumeSize] = useState(platformConfig.aws?.rootVolumeSize || "");
  const [localAwsRootVolumeType, setLocalAwsRootVolumeType] = useState(platformConfig.aws?.rootVolumeType || "");
  const [localAwsRootVolumeIops, setLocalAwsRootVolumeIops] = useState(platformConfig.aws?.rootVolumeIops || "");
  const [localAwsRootVolumeKmsKeyArn, setLocalAwsRootVolumeKmsKeyArn] = useState(platformConfig.aws?.rootVolumeKmsKeyArn || "");

  // Local state for text inputs (onBlur pattern) - Azure
  const [localAzureRegion, setLocalAzureRegion] = useState(platformConfig.azure?.region || "");
  const [localAzureResourceGroupName, setLocalAzureResourceGroupName] = useState(platformConfig.azure?.resourceGroupName || "");
  const [localAzureBaseDomainResourceGroupName, setLocalAzureBaseDomainResourceGroupName] = useState(platformConfig.azure?.baseDomainResourceGroupName || "");

  // Local state for text inputs (onBlur pattern) - IBM Cloud
  const [localIbmRegion, setLocalIbmRegion] = useState(platformConfig.ibmcloud?.region || "");
  const [localIbmResourceGroupName, setLocalIbmResourceGroupName] = useState(platformConfig.ibmcloud?.resourceGroupName || "");
  const [localIbmType, setLocalIbmType] = useState(platformConfig.ibmcloud?.type || "");
  const [localIbmNetworkResourceGroupName, setLocalIbmNetworkResourceGroupName] = useState(platformConfig.ibmcloud?.networkResourceGroupName || "");
  const [localIbmVpcName, setLocalIbmVpcName] = useState(platformConfig.ibmcloud?.vpcName || "");
  const [localIbmControlPlaneSubnets, setLocalIbmControlPlaneSubnets] = useState(platformConfig.ibmcloud?.controlPlaneSubnets || "");
  const [localIbmComputeSubnets, setLocalIbmComputeSubnets] = useState(platformConfig.ibmcloud?.computeSubnets || "");
  const [localIbmDedicatedHostsProfile, setLocalIbmDedicatedHostsProfile] = useState(platformConfig.ibmcloud?.dedicatedHostsProfile || "");
  const [localIbmDedicatedHostsName, setLocalIbmDedicatedHostsName] = useState(platformConfig.ibmcloud?.dedicatedHostsName || "");
  const [localIbmServiceEndpoints, setLocalIbmServiceEndpoints] = useState(platformConfig.ibmcloud?.serviceEndpoints || "");
  const [localIbmDefaultMachineBootVolumeEncryptionKey, setLocalIbmDefaultMachineBootVolumeEncryptionKey] = useState(platformConfig.ibmcloud?.defaultMachineBootVolumeEncryptionKey || "");
  const [localIbmControlPlaneBootVolumeEncryptionKey, setLocalIbmControlPlaneBootVolumeEncryptionKey] = useState(platformConfig.ibmcloud?.controlPlaneBootVolumeEncryptionKey || "");
  const [localIbmComputeBootVolumeEncryptionKey, setLocalIbmComputeBootVolumeEncryptionKey] = useState(platformConfig.ibmcloud?.computeBootVolumeEncryptionKey || "");

  // Local state for text inputs (onBlur pattern) - Nutanix
  const [localNutanixEndpoint, setLocalNutanixEndpoint] = useState(platformConfig.nutanix?.endpoint || "");
  const [localNutanixPort, setLocalNutanixPort] = useState(platformConfig.nutanix?.port || "");
  const [localNutanixUsername, setLocalNutanixUsername] = useState(platformConfig.nutanix?.username || "");
  const [localNutanixPassword, setLocalNutanixPassword] = useState(platformConfig.nutanix?.password || "");
  const [localNutanixSubnet, setLocalNutanixSubnet] = useState(platformConfig.nutanix?.subnet || "");
  const [localNutanixCluster, setLocalNutanixCluster] = useState(platformConfig.nutanix?.cluster || "");
  const [localNutanixStorageContainer, setLocalNutanixStorageContainer] = useState(platformConfig.nutanix?.storageContainer || "");

  // Local state for text inputs (onBlur pattern) - vSphere
  const [localVsphereVcenter, setLocalVsphereVcenter] = useState(platformConfig.vsphere?.vcenter || "");
  const [localVsphereUsername, setLocalVsphereUsername] = useState(platformConfig.vsphere?.username || "");
  const [localVspherePassword, setLocalVspherePassword] = useState(platformConfig.vsphere?.password || "");
  const [localVsphereDatacenter, setLocalVsphereDatacenter] = useState(platformConfig.vsphere?.datacenter || "");
  const [localVsphereDefaultDatastore, setLocalVsphereDefaultDatastore] = useState(platformConfig.vsphere?.defaultDatastore || "");
  const [localVsphereFolder, setLocalVsphereFolder] = useState(platformConfig.vsphere?.folder || "");
  const [localVsphereResourcePool, setLocalVsphereResourcePool] = useState(platformConfig.vsphere?.resourcePool || "");
  const [localVsphereCluster, setLocalVsphereCluster] = useState(platformConfig.vsphere?.cluster || "");

  // Local state for text inputs (onBlur pattern) - Bare Metal Provisioning Network
  const [localProvisioningNetworkCIDR, setLocalProvisioningNetworkCIDR] = useState(inventory.provisioningNetworkCIDR || "");
  const [localProvisioningNetworkInterface, setLocalProvisioningNetworkInterface] = useState(inventory.provisioningNetworkInterface || "");
  const [localProvisioningDHCPRange, setLocalProvisioningDHCPRange] = useState(inventory.provisioningDHCPRange || "");
  const [localClusterProvisioningIP, setLocalClusterProvisioningIP] = useState(inventory.clusterProvisioningIP || "");
  const [localProvisioningMACAddress, setLocalProvisioningMACAddress] = useState(inventory.provisioningMACAddress || "");

  // Local state for text inputs (onBlur pattern) - Agent Options
  const [localBootArtifactsBaseURL, setLocalBootArtifactsBaseURL] = useState(inventory.bootArtifactsBaseURL || "");
  const [localAdditionalEnabledCapabilities, setLocalAdditionalEnabledCapabilities] = useState(
    Array.isArray(platformConfig.additionalEnabledCapabilities) ? platformConfig.additionalEnabledCapabilities.join(", ") : ""
  );

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

  // Sync local state when store values change (for imports/loads) - AWS
  useEffect(() => { setLocalAwsAmiId(platformConfig.aws?.amiId || ""); }, [platformConfig.aws?.amiId]);
  useEffect(() => { setLocalAwsHostedZone(platformConfig.aws?.hostedZone || ""); }, [platformConfig.aws?.hostedZone]);
  useEffect(() => { setLocalAwsHostedZoneRole(platformConfig.aws?.hostedZoneRole || ""); }, [platformConfig.aws?.hostedZoneRole]);
  useEffect(() => { setLocalAwsControlPlaneInstanceType(platformConfig.aws?.controlPlaneInstanceType || ""); }, [platformConfig.aws?.controlPlaneInstanceType]);
  useEffect(() => { setLocalAwsWorkerInstanceType(platformConfig.aws?.workerInstanceType || ""); }, [platformConfig.aws?.workerInstanceType]);
  useEffect(() => { setLocalAwsRootVolumeSize(platformConfig.aws?.rootVolumeSize || ""); }, [platformConfig.aws?.rootVolumeSize]);
  useEffect(() => { setLocalAwsRootVolumeType(platformConfig.aws?.rootVolumeType || ""); }, [platformConfig.aws?.rootVolumeType]);
  useEffect(() => { setLocalAwsRootVolumeIops(platformConfig.aws?.rootVolumeIops || ""); }, [platformConfig.aws?.rootVolumeIops]);
  useEffect(() => { setLocalAwsRootVolumeKmsKeyArn(platformConfig.aws?.rootVolumeKmsKeyArn || ""); }, [platformConfig.aws?.rootVolumeKmsKeyArn]);

  // Sync local state when store values change (for imports/loads) - Azure
  useEffect(() => { setLocalAzureRegion(platformConfig.azure?.region || ""); }, [platformConfig.azure?.region]);
  useEffect(() => { setLocalAzureResourceGroupName(platformConfig.azure?.resourceGroupName || ""); }, [platformConfig.azure?.resourceGroupName]);
  useEffect(() => { setLocalAzureBaseDomainResourceGroupName(platformConfig.azure?.baseDomainResourceGroupName || ""); }, [platformConfig.azure?.baseDomainResourceGroupName]);

  // Sync local state when store values change (for imports/loads) - IBM Cloud
  useEffect(() => { setLocalIbmRegion(platformConfig.ibmcloud?.region || ""); }, [platformConfig.ibmcloud?.region]);
  useEffect(() => { setLocalIbmResourceGroupName(platformConfig.ibmcloud?.resourceGroupName || ""); }, [platformConfig.ibmcloud?.resourceGroupName]);
  useEffect(() => { setLocalIbmType(platformConfig.ibmcloud?.type || ""); }, [platformConfig.ibmcloud?.type]);
  useEffect(() => { setLocalIbmNetworkResourceGroupName(platformConfig.ibmcloud?.networkResourceGroupName || ""); }, [platformConfig.ibmcloud?.networkResourceGroupName]);
  useEffect(() => { setLocalIbmVpcName(platformConfig.ibmcloud?.vpcName || ""); }, [platformConfig.ibmcloud?.vpcName]);
  useEffect(() => { setLocalIbmControlPlaneSubnets(platformConfig.ibmcloud?.controlPlaneSubnets || ""); }, [platformConfig.ibmcloud?.controlPlaneSubnets]);
  useEffect(() => { setLocalIbmComputeSubnets(platformConfig.ibmcloud?.computeSubnets || ""); }, [platformConfig.ibmcloud?.computeSubnets]);
  useEffect(() => { setLocalIbmDedicatedHostsProfile(platformConfig.ibmcloud?.dedicatedHostsProfile || ""); }, [platformConfig.ibmcloud?.dedicatedHostsProfile]);
  useEffect(() => { setLocalIbmDedicatedHostsName(platformConfig.ibmcloud?.dedicatedHostsName || ""); }, [platformConfig.ibmcloud?.dedicatedHostsName]);
  useEffect(() => { setLocalIbmServiceEndpoints(platformConfig.ibmcloud?.serviceEndpoints || ""); }, [platformConfig.ibmcloud?.serviceEndpoints]);
  useEffect(() => { setLocalIbmDefaultMachineBootVolumeEncryptionKey(platformConfig.ibmcloud?.defaultMachineBootVolumeEncryptionKey || ""); }, [platformConfig.ibmcloud?.defaultMachineBootVolumeEncryptionKey]);
  useEffect(() => { setLocalIbmControlPlaneBootVolumeEncryptionKey(platformConfig.ibmcloud?.controlPlaneBootVolumeEncryptionKey || ""); }, [platformConfig.ibmcloud?.controlPlaneBootVolumeEncryptionKey]);
  useEffect(() => { setLocalIbmComputeBootVolumeEncryptionKey(platformConfig.ibmcloud?.computeBootVolumeEncryptionKey || ""); }, [platformConfig.ibmcloud?.computeBootVolumeEncryptionKey]);

  // Sync local state when store values change (for imports/loads) - Nutanix
  useEffect(() => { setLocalNutanixEndpoint(platformConfig.nutanix?.endpoint || ""); }, [platformConfig.nutanix?.endpoint]);
  useEffect(() => { setLocalNutanixPort(platformConfig.nutanix?.port || ""); }, [platformConfig.nutanix?.port]);
  useEffect(() => { setLocalNutanixUsername(platformConfig.nutanix?.username || ""); }, [platformConfig.nutanix?.username]);
  useEffect(() => { setLocalNutanixPassword(platformConfig.nutanix?.password || ""); }, [platformConfig.nutanix?.password]);
  useEffect(() => { setLocalNutanixSubnet(platformConfig.nutanix?.subnet || ""); }, [platformConfig.nutanix?.subnet]);
  useEffect(() => { setLocalNutanixCluster(platformConfig.nutanix?.cluster || ""); }, [platformConfig.nutanix?.cluster]);
  useEffect(() => { setLocalNutanixStorageContainer(platformConfig.nutanix?.storageContainer || ""); }, [platformConfig.nutanix?.storageContainer]);

  // Sync local state when store values change (for imports/loads) - vSphere
  useEffect(() => { setLocalVsphereVcenter(platformConfig.vsphere?.vcenter || ""); }, [platformConfig.vsphere?.vcenter]);
  useEffect(() => { setLocalVsphereUsername(platformConfig.vsphere?.username || ""); }, [platformConfig.vsphere?.username]);
  useEffect(() => { setLocalVspherePassword(platformConfig.vsphere?.password || ""); }, [platformConfig.vsphere?.password]);
  useEffect(() => { setLocalVsphereDatacenter(platformConfig.vsphere?.datacenter || ""); }, [platformConfig.vsphere?.datacenter]);
  useEffect(() => { setLocalVsphereDefaultDatastore(platformConfig.vsphere?.defaultDatastore || ""); }, [platformConfig.vsphere?.defaultDatastore]);
  useEffect(() => { setLocalVsphereFolder(platformConfig.vsphere?.folder || ""); }, [platformConfig.vsphere?.folder]);
  useEffect(() => { setLocalVsphereResourcePool(platformConfig.vsphere?.resourcePool || ""); }, [platformConfig.vsphere?.resourcePool]);
  useEffect(() => { setLocalVsphereCluster(platformConfig.vsphere?.cluster || ""); }, [platformConfig.vsphere?.cluster]);

  // Sync local state when store values change (for imports/loads) - Bare Metal Provisioning Network
  useEffect(() => { setLocalProvisioningNetworkCIDR(inventory.provisioningNetworkCIDR || ""); }, [inventory.provisioningNetworkCIDR]);
  useEffect(() => { setLocalProvisioningNetworkInterface(inventory.provisioningNetworkInterface || ""); }, [inventory.provisioningNetworkInterface]);
  useEffect(() => { setLocalProvisioningDHCPRange(inventory.provisioningDHCPRange || ""); }, [inventory.provisioningDHCPRange]);
  useEffect(() => { setLocalClusterProvisioningIP(inventory.clusterProvisioningIP || ""); }, [inventory.clusterProvisioningIP]);
  useEffect(() => { setLocalProvisioningMACAddress(inventory.provisioningMACAddress || ""); }, [inventory.provisioningMACAddress]);

  // Sync local state when store values change (for imports/loads) - Agent Options
  useEffect(() => { setLocalBootArtifactsBaseURL(inventory.bootArtifactsBaseURL || ""); }, [inventory.bootArtifactsBaseURL]);
  useEffect(() => {
    setLocalAdditionalEnabledCapabilities(
      Array.isArray(platformConfig.additionalEnabledCapabilities) ? platformConfig.additionalEnabledCapabilities.join(", ") : ""
    );
  }, [platformConfig.additionalEnabledCapabilities]);

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
  const handleIbmDedicatedHostsProfileBlur = () => {
    const next = (localIbmDedicatedHostsProfile || "").trim();
    updateIbmCloud({
      dedicatedHostsProfile: localIbmDedicatedHostsProfile,
      ...(next ? { dedicatedHostsName: "" } : {})
    });
    if (next) {
      setLocalIbmDedicatedHostsName("");
    }
  };
  const handleIbmDedicatedHostsNameBlur = () => {
    const next = (localIbmDedicatedHostsName || "").trim();
    updateIbmCloud({
      dedicatedHostsName: localIbmDedicatedHostsName,
      ...(next ? { dedicatedHostsProfile: "" } : {})
    });
    if (next) {
      setLocalIbmDedicatedHostsProfile("");
    }
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
  // Failure domains are IPI-only (not valid for UPI or Agent-based)
  const showFailureDomainsSection = scenarioId === "vsphere-ipi" && catalogParams.some(
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
  const showFeatureSet = hasParam(catalogParams, "featureSet", INSTALL_CONFIG);
  const showMinimalISO = (scenarioId === "bare-metal-agent" || scenarioId === "vsphere-agent") && hasParam(catalogParams, "minimalISO", AGENT_CONFIG);
  /** Global folder/resource pool are deprecated (9.1.5); replacement is failureDomains[].topology.folder/resourcePool. Backend only uses vs.folder/vs.resourcePool for legacy path. */
  const showVsphereLegacyFolderResourcePool = showVsphereIpiSection && (platformConfig.vsphere?.placementMode === "legacy");
  const showAdvancedSection = showComputeHyperthreading || showControlPlaneHyperthreading || showCapabilities || showCpuPartitioningMode || showFeatureSet || showMinimalISO || showAgentOptionsSection || showVsphereIpiSection;

  const metaComputeHyperthreading = getParamMeta(scenarioId, "compute[].hyperthreading", INSTALL_CONFIG);
  const metaControlPlaneHyperthreading = getParamMeta(scenarioId, "controlPlane[].hyperthreading", INSTALL_CONFIG);
  const metaBaselineCapability = getParamMeta(scenarioId, "capabilities.baselineCapabilitySet", INSTALL_CONFIG);
  const metaAdditionalCapabilities = getParamMeta(scenarioId, "capabilities.additionalEnabledCapabilities", INSTALL_CONFIG);
  const metaCpuPartitioningMode = getParamMeta(scenarioId, "cpuPartitioningMode", INSTALL_CONFIG);
  const metaFeatureSet = getParamMeta(scenarioId, "featureSet", INSTALL_CONFIG);
  const metaFeatureGates = getParamMeta(scenarioId, "featureGates", INSTALL_CONFIG);
  const metaMinimalISO = getParamMeta(scenarioId, "minimalISO", AGENT_CONFIG);

  const hyperthreadingOptions = ["Enabled", "Disabled"];
  const featureSetOptions = ["TechPreviewNoUpgrade", "CustomNoUpgrade", "LatencyMitigating"];
  const baselineCapabilityOptions = Array.isArray(metaBaselineCapability?.allowed) ? metaBaselineCapability.allowed : ["None", "v4.11", "v4.12", "v4.20", "vCurrent"];
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

          // Service endpoints state and helpers
          const awsServiceEndpoints = Array.isArray(platformConfig.aws?.serviceEndpoints)
            ? platformConfig.aws.serviceEndpoints
            : [];
          const setAwsServiceEndpoints = (endpoints) => updateAws({ serviceEndpoints: endpoints });
          const addAwsServiceEndpoint = () => setAwsServiceEndpoints([...awsServiceEndpoints, { name: "", url: "" }]);
          const updateAwsServiceEndpointAt = (index, patch) => {
            const next = awsServiceEndpoints.map((e, i) => i === index ? { ...e, ...patch } : e);
            setAwsServiceEndpoints(next);
          };
          const removeAwsServiceEndpointAt = (index) => setAwsServiceEndpoints(awsServiceEndpoints.filter((_, i) => i !== index));

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
                          style={{ maxWidth: "280px" }}
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
                    hint={`Amazon Machine Image (AMI) ID for Red Hat CoreOS (RHCOS) in the selected AWS GovCloud region.

**What is RHCOS:**
Red Hat CoreOS is the operating system that runs on all OpenShift cluster nodes

**Default behavior (recommended):**
Leave blank to let the installer auto-discover the correct AMI. Click "Refresh from installer" button to fetch the recommended AMI ID for your selected region and OpenShift version from official Red Hat metadata.

**When to set manually:**
1. **Disconnected/airgap installations** - Installer cannot reach Red Hat metadata servers; you must pre-upload the RHCOS AMI to your AWS account and enter its ID here
2. **AWS Secret or Top Secret regions** - Not in public Red Hat metadata
3. **Specific RHCOS version** - Testing or compatibility requirements
4. **Custom RHCOS images** - Site-specific modifications (advanced use case)

**What is an AMI:**
A pre-configured virtual machine image containing an operating system and software. AWS uses AMIs as templates to launch EC2 instances. Each AWS region has separate AMI IDs - an AMI in us-gov-west-1 has a different ID than the same image in us-gov-east-1.

**AMI ID format:**
ami-xxxxxxxxxxxxxxxxx (17 characters after "ami-")

**Critical requirements - AMI must match:**
⚠️ **Your selected region**
⚠️ **Your selected OpenShift version** - RHCOS versions are tied to OpenShift releases (4.14 uses different RHCOS than 4.15)
⚠️ **The architecture** - x86_64 for most installs, arm64 for Graviton instances

**Important:**
Using the wrong AMI will cause installation to fail or produce unstable clusters

**Auto-filled badge:**
Indicates the installer metadata populated this field automatically

**For connected installs:**
Leave blank or use the Refresh button - the installer handles AMI discovery automatically

**Example:**
ami-0a1b2c3d4e5f6g7h8 (but use Refresh button instead of guessing)`}
                  >
                    <div className="platform-specifics-ami-inline">
                      <input
                        className="platform-specifics-ami-input-wide"
                        value={localAwsAmiId}
                        onChange={(e) => setLocalAwsAmiId(e.target.value)}
                        onBlur={() => updateAws({ amiId: localAwsAmiId, amiAutoFilled: false })}
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
                      style={{ maxWidth: "320px" }}
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
                        hint={`One or more AWS subnet IDs for the existing VPC.

**What are subnets:**
Subnets are network segments within your VPC where OpenShift VMs will be deployed. Each subnet has a CIDR block and resides in a specific availability zone.

**Required for:**
When using an existing VPC (not creating a new one), you must provide subnet IDs for the installer to place cluster nodes.

**Subnet roles (OpenShift 4.20+):**
Optionally assign roles to subnets:
• **control-plane:** Subnets for master nodes
• **compute:** Subnets for worker nodes
• **edge:** Subnets for edge compute nodes

**Important:**
If you assign roles to any subnet, ALL subnets must have at least one role, and all required roles must be covered.

**Format:**
subnet-abc123 (AWS subnet ID format)

**Example:**
subnet-0abc123def456 (us-east-1a)
subnet-0def456abc789 (us-east-1b)`}
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
                      value={localAwsHostedZone}
                      onChange={(e) => setLocalAwsHostedZone(e.target.value)}
                      onBlur={() => updateAws({ hostedZone: localAwsHostedZone })}
                      placeholder="Z1234567890"
                      style={{ maxWidth: "280px" }}
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
                        value={localAwsHostedZoneRole}
                        onChange={(e) => setLocalAwsHostedZoneRole(e.target.value)}
                        onBlur={() => updateAws({ hostedZoneRole: localAwsHostedZoneRole })}
                        placeholder="arn:aws-us-gov:iam::123:role/HostedZoneRole"
                        style={{ maxWidth: "400px" }}
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
                      style={{ maxWidth: "280px" }}
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
                          value={localAwsControlPlaneInstanceType}
                          onChange={(e) => setLocalAwsControlPlaneInstanceType(e.target.value)}
                          onBlur={() => updateAws({ controlPlaneInstanceType: localAwsControlPlaneInstanceType })}
                          list="aws-govcloud-instance-types"
                          placeholder="e.g. m5.xlarge"
                          style={{ maxWidth: "280px" }}
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
                          value={localAwsWorkerInstanceType}
                          onChange={(e) => setLocalAwsWorkerInstanceType(e.target.value)}
                          onBlur={() => updateAws({ workerInstanceType: localAwsWorkerInstanceType })}
                          list="aws-govcloud-instance-types"
                          placeholder="e.g. m5.large"
                          style={{ maxWidth: "280px" }}
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
                        className="field-short"
                      >
                        <input
                          type="number"
                          min={1}
                          max={9999}
                          value={localAwsRootVolumeSize}
                          onChange={(e) => setLocalAwsRootVolumeSize(e.target.value)}
                          onBlur={() => updateAws({ rootVolumeSize: localAwsRootVolumeSize === "" ? undefined : Number(localAwsRootVolumeSize) })}
                          placeholder="omit"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Root volume type"
                        hint={`AWS EBS volume type for root volumes on all cluster nodes (control plane and workers). Leave blank to use the AWS default (typically gp3 - General Purpose SSD version 3, the latest and most cost-effective option).

**Common types:** gp3 (General Purpose SSD v3, recommended for most workloads - better price/performance than gp2, up to 16,000 IOPS, 1,000 MB/s throughput), gp2 (General Purpose SSD v2, older generation, still works but gp3 is better), io1/io2 (Provisioned IOPS SSD, for I/O-intensive workloads requiring guaranteed high IOPS - expensive, typically only for control plane in very large clusters where etcd performance is critical), st1 (Throughput Optimized HDD, cheap but low performance - NOT recommended for OpenShift), sc1 (Cold HDD, very cheap but very slow - NOT recommended).

**Recommendation:** Use gp3 for most installations (best balance of cost and performance). Only use io1/io2 if you have specific IOPS requirements (e.g., etcd in 500+ node clusters, or workers running high-IOPS databases).

**Why it matters:** EBS volume type affects both performance (IOPS, throughput) and cost. gp3 volumes can deliver up to 16,000 IOPS which is sufficient for almost all OpenShift workloads. io1/io2 costs significantly more but provides guaranteed IOPS above 16k. For control plane nodes, adequate IOPS is critical for etcd health - but gp3 handles this well for clusters under 500 nodes. Setting this value applies to ALL nodes in the cluster (both control plane and compute).`}
                        className="field-medium"
                      >
                        <input
                          value={localAwsRootVolumeType}
                          onChange={(e) => setLocalAwsRootVolumeType(e.target.value)}
                          onBlur={() => updateAws({ rootVolumeType: localAwsRootVolumeType || undefined })}
                          placeholder="e.g. gp3"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Root volume IOPS (optional)"
                        hint={`Provisioned IOPS (Input/Output Operations Per Second) for EBS root volumes. Only applicable to certain volume types - leave blank for most installations.

**What is this:**
IOPS defines the maximum number of I/O operations per second the EBS volume can sustain. Higher IOPS = better disk performance for I/O-intensive workloads (etcd, databases).

**When needed:**
• **io1/io2 volume types:** IOPS is REQUIRED when using io1 or io2. You must specify between 100-64,000 IOPS for io1, or 100-256,000 IOPS for io2.
• **gp3 volumes:** IOPS is optional. Default is 3,000 IOPS (sufficient for most workloads). You can provision up to 16,000 IOPS if needed.
• **gp2, st1, sc1:** Custom IOPS is NOT supported - these types have IOPS based on volume size. Leave this field blank.

**Format:**
Number between 100 and 256,000. Higher values = higher AWS costs.

**How it's used:**
Emitted to \`controlPlane.platform.aws.rootVolume.iops\` and \`compute[].platform.aws.rootVolume.iops\` in install-config.yaml. Applied to all cluster nodes (control plane and workers).

**Important:**
⚠️ **Cost impact:** Higher IOPS significantly increases EBS costs. Only provision IOPS beyond gp3 defaults when you have specific performance requirements.
⚠️ **Control plane etcd:** For very large clusters (500+ nodes), high IOPS (10,000+) on io2 volumes can improve etcd performance, but gp3 is sufficient for most clusters.
⚠️ **Type compatibility:** Verify your volume type supports custom IOPS before setting this value.

**Example:**
5000 for tuned gp3 (better than default 3,000), 10000 for io2 control plane in large clusters, 15000 for io2 workers running high-IOPS databases.`}
                        className="field-short"
                      >
                        <input
                          type="number"
                          min={100}
                          max={256000}
                          value={localAwsRootVolumeIops}
                          onChange={(e) => setLocalAwsRootVolumeIops(e.target.value)}
                          onBlur={() => updateAws({ rootVolumeIops: localAwsRootVolumeIops === "" ? undefined : Number(localAwsRootVolumeIops) })}
                          placeholder="omit"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Root volume KMS Key ARN (optional)"
                        hint={`AWS KMS (Key Management Service) Customer Master Key ARN for encrypting EBS root volumes. Leave blank to use AWS-managed default encryption.

**What is this:**
KMS encryption allows you to use customer-managed encryption keys instead of AWS-managed keys for EBS volume encryption. This provides additional control over encryption keys, key policies, and audit trails.

**When needed:**
• **Compliance requirements:** FedRAMP, HIPAA, DoD Impact Level 4+, or other regulations requiring customer-managed encryption keys
• **Cross-account access:** When cluster nodes are in a different AWS account than the KMS key (requires key policy configuration)
• **Custom key policies:** When you need fine-grained IAM permissions for who can encrypt/decrypt volumes
• **Audit requirements:** When you need CloudTrail logs of all encryption key usage for compliance auditing

**Format:**
Full ARN of the KMS key. For AWS GovCloud: \`arn:aws-us-gov:kms:REGION:ACCOUNT-ID:key/KEY-ID\`
For standard AWS: \`arn:aws:kms:REGION:ACCOUNT-ID:key/KEY-ID\`

**How it's used:**
Emitted to \`controlPlane.platform.aws.rootVolume.kmsKeyARN\` and \`compute[].platform.aws.rootVolume.kmsKeyARN\` in install-config.yaml. Applied to all cluster nodes (control plane and workers).

**Important:**
⚠️ **Required IAM permissions:** The AWS credentials used for installation must have \`kms:Encrypt\`, \`kms:Decrypt\`, \`kms:CreateGrant\`, and \`kms:GenerateDataKey\` permissions on the specified KMS key. Installation will FAIL if permissions are missing.
⚠️ **Key policy:** The KMS key policy must allow the AWS account/role creating the cluster to use the key. Cross-account usage requires explicit key policy grants.
⚠️ **Cost:** Customer-managed KMS keys cost approximately $1/month per key, plus ~$0.03 per 10,000 encryption/decryption requests.
⚠️ **Cannot be changed** after installation without recreating all EBS volumes (complex, requires node replacement).

**Example:**
arn:aws-us-gov:kms:us-gov-west-1:123456789012:key/12345678-1234-1234-1234-123456789012`}
                        className="field-long"
                      >
                        <input
                          value={localAwsRootVolumeKmsKeyArn}
                          onChange={(e) => setLocalAwsRootVolumeKmsKeyArn(e.target.value)}
                          onBlur={() => updateAws({ rootVolumeKmsKeyArn: localAwsRootVolumeKmsKeyArn || undefined })}
                          placeholder="arn:aws-us-gov:kms:region:account:key/key-id"
                          style={{ maxWidth: "500px" }}
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
                        hint={`Number of control plane nodes (master nodes) to create during installation.

**Required:**
Must be an **odd number** for etcd quorum

**Standard value:**
3 (minimum for production high-availability)

**Why odd numbers:**
etcd (the cluster's key-value store) requires a quorum (majority) to function:
• **3 nodes:** Can survive 1 node failure (2 of 3 remaining = quorum)
• **5 nodes:** Can survive 2 failures (3 of 5 remaining = quorum)

**The sweet spot:**
3 nodes is optimal for most deployments - provides HA at reasonable cost

**When to use 5 nodes:**
• Very large clusters (500+ nodes)
• Need to survive 2 simultaneous control plane failures

**Never use even numbers:**
• **2 nodes:** Losing 1 = no quorum, cluster stops
• **4 nodes:** Losing 2 = no quorum, so you pay for 4 but can only survive 1 failure (same as 3 nodes)

**What runs on control plane:**
Each node runs etcd, Kubernetes API server, controller manager, and scheduler (CPU/memory intensive)

**Cloud cost:**
Control plane nodes are EC2 instances (you pay for them)

**Important:**
⚠️ **CANNOT be changed** after installation without rebuilding the cluster

**Default:** 3

**Recommendation:**
Use 5 only for very large or mission-critical clusters`}
                        className="field-short"
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
                        hint={`Number of worker nodes (compute nodes) to create during installation.

**What workers do:**
Run your application workloads (pods, containers)

**Scalability:**
Unlike control plane, you **CAN scale workers** up or down after installation via MachineSets

**Minimum recommended:**
**2 workers** for production (allows workload redundancy and rolling updates)

**Compact cluster (0 workers):**
You can set 0 for a control-plane-only cluster (sometimes called 'compact cluster') where control plane nodes also run workloads - this is **supported but NOT recommended** for production (reduces isolation, risks resource contention with etcd/API server)

**Sizing guidance:**

• **Development/testing:** 2-3 workers
• **Production:** Start with 3+ workers
• **High availability:** Spread workers across multiple availability zones (installer does this automatically in IPI mode)
• **Stateful workloads/databases:** Consider 5+ workers for better resilience

**Cloud cost:**
Each worker is an EC2 instance - more workers = higher cost, but also more capacity

**Scaling strategy:**
Start small (3 workers) and scale up post-install as workload demands grow by editing MachineSets

**Best practice:**
Use at least **2 workers** to ensure workload pods can be rescheduled if a worker fails

**Default:** 0 (you must explicitly set a count for UPI, IPI often defaults to 3)

**Example:**
3 for small production
5 for medium
10+ for large workloads or multi-AZ redundancy`}
                        className="field-short"
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

                    <h4 className="platform-specifics-subsection">Default machine platform (optional)</h4>
                    <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                      Default platform-specific configuration applied to all machine pools unless overridden.
                    </p>
                    <div className="field-grid">
                      <FieldLabelWithInfo
                        label="Default IAM instance profile (optional)"
                        hint={`IAM instance profile ARN to use for all machines by default.

**What is this:**
IAM instance profile that gets attached to EC2 instances for all control plane and worker nodes. Provides AWS API permissions to instances without embedding credentials.

**When needed:**
• Custom IAM policies for machine access (S3, Secrets Manager, etc.)
• Least privilege security posture (replace broad installer credential)
• Organizational compliance requiring specific IAM roles

**Format:**
Full ARN: arn:aws-us-gov:iam::123456789012:instance-profile/MyProfile

**How it's used:**
Written to install-config.yaml platform.aws.defaultMachinePlatform.iamProfile. Installer attaches this profile to all EC2 instances during provisioning.

**Important:**
⚠️ Profile must exist before installation starts (create via AWS IAM console or CLI)
⚠️ Must have minimum permissions for cluster operation (consult OCP docs)
⚠️ Applied to all machine pools (control plane + compute) unless overridden per-pool

**Example:**
arn:aws-us-gov:iam::123456789012:instance-profile/openshift-node-profile`}
                      >
                        <input
                          value={platformConfig.aws?.defaultMachinePlatformIamProfile || ""}
                          onChange={(e) => updateAws({ defaultMachinePlatformIamProfile: e.target.value || undefined })}
                          placeholder="arn:aws-us-gov:iam::account:instance-profile/name"
                          style={{ maxWidth: "500px" }}
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Default availability zones (optional)"
                        hint={`Comma-separated list of AWS availability zones for machine placement.

**What is this:**
Default AZs where the installer places machines. Overrides automatic AZ selection for high availability.

**When needed:**
• Control exact AZ placement (subnet alignment, cost optimization)
• Limit deployment to specific AZs (network/compliance requirements)
• Override installer's automatic multi-AZ spread

**Format:**
Comma-separated zone names: us-gov-west-1a,us-gov-west-1b,us-gov-west-1c

**How it's used:**
Written to install-config.yaml platform.aws.defaultMachinePlatform.zones as array. Installer distributes machines across listed zones.

**Important:**
⚠️ Zones must exist in selected region (AWS GovCloud regions typically have 3 AZs)
⚠️ For HA, specify at least 3 zones (installer spreads control plane across zones)
⚠️ Zone names are region-specific (us-gov-west-1a only exists in us-gov-west-1)
⚠️ Empty = installer auto-selects all available zones (recommended for most deployments)

**Example:**
us-gov-west-1a,us-gov-west-1b,us-gov-west-1c`}
                      >
                        <input
                          value={(platformConfig.aws?.defaultMachinePlatformZones || []).join(",")}
                          onChange={(e) => {
                            const zones = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                            updateAws({ defaultMachinePlatformZones: zones.length > 0 ? zones : undefined });
                          }}
                          placeholder="e.g. us-gov-west-1a,us-gov-west-1b,us-gov-west-1c"
                          style={{ maxWidth: "500px" }}
                        />
                      </FieldLabelWithInfo>
                    </div>
                  </>
                ) : null}

                {/* Datalist for instance type autocomplete */}
                <datalist id="aws-govcloud-instance-types">
                  {AWS_INSTANCE_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </datalist>

                <h4 className="platform-specifics-subsection">Publish &amp; credentials</h4>
                <div className="field-grid">
                  <FieldLabelWithInfo
                    label="Publish (optional)"
                    hint={`Controls whether cluster endpoints are publicly accessible or private-network only.

**External (default):**
• API and ingress published to public DNS/load balancer
• Use for clusters reachable from internet or external networks
• **Required when:** Apps/API must be accessed without VPN

**Internal:**
• All cluster endpoints are private-network only
• DNS must resolve internally
• **Required by:** Some compliance regimes

**Important:**
With Internal publishing, console.redhat.com cluster management and direct Red Hat update checks will **not reach the cluster** without additional network routing

**Recommendation:**
• **External** for most installs
• **Internal** only when external exposure is explicitly prohibited`}
                  >
                    <select
                      value={platformConfig.publish || metaPublish?.default || "External"}
                      onChange={(e) => updatePlatformConfig({ publish: e.target.value })}
                      style={{ maxWidth: "280px" }}
                    >
                      <option value="External">External</option>
                      <option value="Internal">Internal</option>
                    </select>
                  </FieldLabelWithInfo>
                  <FieldLabelWithInfo
                    label="Credentials mode (optional)"
                    hint={`Controls how OpenShift Cloud Credential Operator (CCO) manages cloud provider credentials.

**Mint (recommended for IPI):**
• CCO creates scoped cloud credentials for each cluster component from your admin credential
• Each component gets minimal permissions (least privilege)
• **Requires:** IAM rights to create new users/roles
• **Best for:** When you have full IAM admin access

**Passthrough:**
• CCO passes your install-time admin credential to all components — no new IAM identities created
• All components share the broad admin credential
• **Use when:** Your org prohibits new IAM account creation

**Manual:**
• You provision credentials yourself before install (e.g., via ccoctl for STS/Workload Identity)
• **Required for:** Airgapped AWS STS installs, highly regulated environments
• **Security:** Most secure, most complex
• **Important:** Must run ccoctl before openshift-install

**Platform-specific:**
⚠️ Nutanix IPI always requires Manual mode (enforced automatically)`}
                  >
                    <select
                      value={platformConfig.credentialsMode || ""}
                      onChange={(e) => updatePlatformConfig({ credentialsMode: e.target.value })}
                      style={{ maxWidth: "280px" }}
                    >
                      <option value="" disabled>Not set</option>
                      <option value="Mint">Mint</option>
                      <option value="Passthrough">Passthrough</option>
                      <option value="Manual">Manual</option>
                    </select>
                  </FieldLabelWithInfo>
                </div>

                <h4 className="platform-specifics-subsection">Service endpoints (optional)</h4>
                <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                  Custom VPC endpoint URLs for AWS services when public AWS API endpoints are not reachable (airgap, restricted regions, PrivateLink-only access). Leave empty for standard AWS API connectivity.
                </p>
                <div style={{ marginTop: 12 }}>
                  <FieldLabelWithInfo
                    label="Custom service endpoints"
                    hint={`Custom VPC endpoint URLs for AWS services when public AWS API endpoints are not reachable. Use when deploying in restricted AWS regions (secret/top-secret partitions), fully disconnected VPCs, or PrivateLink-only environments.

**What is this:**
Service endpoints define custom URLs for AWS API services (EC2, ELB, S3, etc.) instead of the public AWS endpoint URLs. This is required when deploying in AWS VPCs that do not have internet access or are in restricted AWS partitions where standard AWS endpoints are not available.

**When needed:**
• **Airgap/disconnected deployments:** When your VPC has no internet gateway and cannot reach public AWS APIs (*.amazonaws.com)
• **AWS GovCloud Secret/Top Secret regions:** Restricted partitions with different endpoint URLs
• **PrivateLink-only access:** When all AWS service access must go through VPC endpoints (compliance requirement)
• **Custom AWS installations:** When using AWS Outposts, AWS Local Zones, or custom AWS regions with non-standard endpoints

**Format:**
Each endpoint has a service name (e.g., "ec2", "elasticloadbalancing", "s3") and a custom URL. URL format is typically \`https://SERVICE.REGION.vpce.amazonaws.com\` for VPC endpoints, or custom endpoint FQDNs for restricted regions.

**Common service names:**
• **ec2:** EC2 instance management (required for IPI instance creation)
• **elasticloadbalancing:** ELB/ALB/NLB management (required for load balancer creation)
• **s3:** S3 storage access (required for ignition configs, image registry)
• **sts:** Security Token Service (required for STS credential mode)
• **route53:** DNS management (if using Route 53)
• **tagging:** Resource tagging (for cost allocation, compliance)

**How it's used:**
Emitted to \`platform.aws.serviceEndpoints[]\` in install-config.yaml. Each entry has \`name\` (service) and \`url\` (custom endpoint). The installer uses these URLs instead of public AWS endpoints during cluster provisioning.

**Important:**
⚠️ **Only needed when public AWS endpoints are NOT reachable** - most installations should leave this empty
⚠️ **VPC endpoint prerequisites:** VPC endpoints must be created BEFORE installation and must allow traffic from cluster subnets
⚠️ **DNS resolution:** Custom endpoint URLs must be resolvable from cluster nodes (either via VPC DNS or custom DNS configuration)
⚠️ **Permissions:** IAM credentials must have permissions on the custom endpoints, not just the public AWS APIs

**Example:**
Service name: ec2, URL: https://ec2.us-gov-west-1.vpce.amazonaws.com
Service name: s3, URL: https://s3.us-gov-west-1.vpce.amazonaws.com`}
                  />
                  <div className="list" style={{ marginTop: 6 }}>
                    {(awsServiceEndpoints.length ? awsServiceEndpoints : [{ name: "", url: "" }]).map((entry, idx) => {
                      const nameVal = entry?.name ?? "";
                      const urlVal = entry?.url ?? "";
                      return (
                        <div key={idx} className="list-item" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <input
                            value={nameVal}
                            onChange={(e) => updateAwsServiceEndpointAt(idx, { name: e.target.value, url: urlVal })}
                            placeholder="e.g. ec2"
                            style={{ flex: "0 1 200px", minWidth: 120 }}
                            aria-label="Service name"
                          />
                          <input
                            value={urlVal}
                            onChange={(e) => updateAwsServiceEndpointAt(idx, { name: nameVal, url: e.target.value })}
                            placeholder="https://service.region.vpce.amazonaws.com"
                            style={{ flex: "1 1 400px", minWidth: 200 }}
                            aria-label="Service endpoint URL"
                          />
                          <button type="button" className="ghost" onClick={() => removeAwsServiceEndpointAt(idx)} aria-label="Remove endpoint">Remove</button>
                        </div>
                      );
                    })}
                    <button type="button" className="ghost" onClick={addAwsServiceEndpoint} style={{ marginTop: 4 }}>Add endpoint</button>
                  </div>
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
                    value={localAzureRegion}
                    onChange={(e) => setLocalAzureRegion(e.target.value)}
                    onBlur={() => updateAzure({ region: localAzureRegion })}
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
                    value={localAzureResourceGroupName}
                    onChange={(e) => setLocalAzureResourceGroupName(e.target.value)}
                    onBlur={() => updateAzure({ resourceGroupName: localAzureResourceGroupName })}
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
                    value={localAzureBaseDomainResourceGroupName}
                    onChange={(e) => setLocalAzureBaseDomainResourceGroupName(e.target.value)}
                    onBlur={() => updateAzure({ baseDomainResourceGroupName: localAzureBaseDomainResourceGroupName })}
                    placeholder="Resource group containing DNS zone for base domain"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Publish (optional)"
                  hint={`Controls whether cluster endpoints are publicly accessible or private-network only.

**External (default):**
• API and ingress published to public DNS/load balancer
• Use for clusters reachable from internet or external networks
• **Required when:** Apps/API must be accessed without VPN

**Internal:**
• All cluster endpoints are private-network only
• DNS must resolve internally
• **Required by:** Some compliance regimes

**Important:**
With Internal publishing, console.redhat.com cluster management and direct Red Hat update checks will **not reach the cluster** without additional network routing

**Recommendation:**
• **External** for most installs
• **Internal** only when external exposure is explicitly prohibited`}
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
                  hint={`Controls how OpenShift Cloud Credential Operator (CCO) manages cloud provider credentials.

**Mint (recommended for IPI):**
• CCO creates scoped cloud credentials for each cluster component from your admin credential
• Each component gets minimal permissions (least privilege)
• **Requires:** IAM rights to create new users/roles
• **Best for:** When you have full IAM admin access

**Passthrough:**
• CCO passes your install-time admin credential to all components — no new IAM identities created
• All components share the broad admin credential
• **Use when:** Your org prohibits new IAM account creation

**Manual:**
• You provision credentials yourself before install (e.g., via ccoctl for STS/Workload Identity)
• **Required for:** Airgapped AWS STS installs, highly regulated environments
• **Security:** Most secure, most complex
• **Important:** Must run ccoctl before openshift-install

**Platform-specific:**
⚠️ Nutanix IPI always requires Manual mode (enforced automatically)`}
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

              <h4 className="platform-specifics-subsection">Machine counts</h4>
              <p className="note subtle" style={{ marginTop: 8, marginBottom: 8 }}>
                Control plane and worker node counts for Azure Government IPI. Azure IPI does not use host inventory; set counts here.
              </p>
              <div className="field-grid">
                <FieldLabelWithInfo
                  label="Control plane replicas"
                  hint={`Number of control plane nodes (master nodes) to create during installation.

**Required:**
Must be an **odd number** for etcd quorum

**Standard value:**
3 (minimum for production high-availability)

**Why odd numbers:**
etcd (the cluster's key-value store) requires a quorum (majority) to function:
• **3 nodes:** Can survive 1 node failure (2 of 3 remaining = quorum)
• **5 nodes:** Can survive 2 failures (3 of 5 remaining = quorum)

**The sweet spot:**
3 nodes is optimal for most deployments - provides HA at reasonable cost

**When to use 5 nodes:**
• Very large clusters (500+ nodes)
• Need to survive 2 simultaneous control plane failures

**Never use even numbers:**
• **2 nodes:** Losing 1 = no quorum, cluster stops
• **4 nodes:** Losing 2 = no quorum, so you pay for 4 but can only survive 1 failure (same as 3 nodes)

**What runs on control plane:**
Each node runs etcd, Kubernetes API server, controller manager, and scheduler (CPU/memory intensive)

**Azure resources:**
Control plane nodes are VMs (you pay for them)

**Important:**
⚠️ **CANNOT be changed** after installation without rebuilding the cluster

**Default:** 3

**Recommendation:**
Use 5 only for very large or mission-critical clusters`}
                  className="field-short"
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
                  hint={`Number of worker nodes (compute nodes) to create during installation.

**What workers do:**
Run your application workloads (pods, containers)

**Scalability:**
Unlike control plane, you **CAN scale workers** up or down after installation via MachineSets

**Minimum recommended:**
**2 workers** for production (allows workload redundancy and rolling updates)

**Compact cluster (0 workers):**
You can set 0 for a control-plane-only cluster (sometimes called 'compact cluster') where control plane nodes also run workloads - this is **supported but NOT recommended** for production (reduces isolation, risks resource contention with etcd/API server)

**Sizing guidance:**

• **Development/testing:** 2-3 workers
• **Production:** Start with 3+ workers
• **High availability:** Azure IPI distributes nodes across availability zones automatically (when available in the region)
• **Stateful workloads/databases:** Consider 5+ workers for better resilience

**Azure cost:**
Each worker is an Azure VM - more workers = higher cost, but also more capacity

**Scaling strategy:**
Start small (3 workers) and scale up post-install as workload demands grow by editing MachineSets

**Best practice:**
Use at least **2 workers** to ensure workload pods can be rescheduled if a worker fails

**Default:** 3

**Example:**
3 for small production
5 for medium
10+ for large workloads or multi-AZ redundancy`}
                  className="field-short"
                >
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={platformConfig.computeReplicas ?? 3}
                    onChange={(e) => {
                      const v = e.target.value === "" ? undefined : Number(e.target.value);
                      updatePlatformConfig({ computeReplicas: v });
                    }}
                  />
                </FieldLabelWithInfo>
              </div>

              <h4 className="platform-specifics-subsection">Default machine platform (optional)</h4>
              <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                Default platform-specific configuration applied to all machine pools unless overridden.
              </p>
              <div className="field-grid">
                <FieldLabelWithInfo
                  label="Default availability zones (optional)"
                  hint={`Comma-separated list of Azure availability zones for machine placement.

**What is this:**
Default availability zones where the installer places VMs. Zones are physically separated datacenters within a region for fault isolation.

**When needed:**
• Control exact zone placement (align with existing infrastructure)
• Limit deployment to specific zones (regulatory/compliance requirements)
• Override installer's automatic zone selection

**Format:**
Comma-separated zone numbers: 1,2,3

**How it's used:**
Written to install-config.yaml platform.azure.defaultMachinePlatform.zones as array. Installer distributes machines across listed zones.

**Important:**
⚠️ Not all Azure Government regions support availability zones (check Azure docs for region capabilities)
⚠️ For HA, specify all available zones in the region (typically 3 zones)
⚠️ Zone numbers are region-specific (zone 1 in usgovvirginia ≠ zone 1 in usgovtexas)
⚠️ Empty = installer uses region default (may or may not use zones depending on region capabilities)

**Example:**
1,2,3 (for regions with 3 availability zones)`}
                >
                  <input
                    value={(platformConfig.azure?.defaultMachinePlatformZones || []).join(",")}
                    onChange={(e) => {
                      const zones = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                      updateAzure({ defaultMachinePlatformZones: zones.length > 0 ? zones : undefined });
                    }}
                    placeholder="e.g. 1,2,3"
                    style={{ maxWidth: "200px" }}
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Default OS disk size (GB, optional)"
                  hint={`Default OS disk size in GB for all Azure VMs.

**What is this:**
Size of the OS disk (managed disk) attached to each VM for the operating system and container runtime storage.

**When needed:**
• Override default 128GB OS disk size
• Larger disk for container images, logs, or local storage
• Cost optimization (smaller disk if adequate for workload)

**Format:**
Integer number of gigabytes (minimum 16 GB, Azure requirement)

**How it's used:**
Written to install-config.yaml platform.azure.defaultMachinePlatform.osDisk.diskSizeGB. Installer creates all VM OS disks at this size.

**Important:**
⚠️ Minimum 16 GB (Azure enforced)
⚠️ Default 128 GB is adequate for most deployments
⚠️ Larger disk = higher Azure storage costs
⚠️ Cannot be changed after installation without node replacement
⚠️ Applied to all machine pools (control plane + workers) unless overridden per-pool

**Default:** 128 GB

**Example:**
256 (for clusters with large container images or extensive local logging)`}
                  className="field-short"
                >
                  <input
                    type="number"
                    min={16}
                    max={4095}
                    value={platformConfig.azure?.defaultMachinePlatformOsDiskSizeGB || ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? undefined : Number(e.target.value);
                      updateAzure({ defaultMachinePlatformOsDiskSizeGB: v });
                    }}
                    placeholder="Default: 128"
                  />
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
                >
                  <input
                    value={localIbmRegion}
                    onChange={(e) => setLocalIbmRegion(e.target.value)}
                    onBlur={() => updateIbmCloud({ region: localIbmRegion })}
                    placeholder="e.g. us-east"
                    style={{ maxWidth: "280px" }}
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
                >
                  <input
                    value={localIbmResourceGroupName}
                    onChange={(e) => setLocalIbmResourceGroupName(e.target.value)}
                    onBlur={() => updateIbmCloud({ resourceGroupName: localIbmResourceGroupName })}
                    placeholder="cluster-resource-group"
                    style={{ maxWidth: "400px" }}
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
                >
                  <input
                    value={localIbmType}
                    onChange={(e) => setLocalIbmType(e.target.value)}
                    onBlur={() => updateIbmCloud({ type: localIbmType })}
                    placeholder="e.g. bx2-8x32"
                    style={{ maxWidth: "280px" }}
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
                >
                  <select
                    value={ibmVpcMode}
                    onChange={(e) => updateIbmCloud({ vpcMode: e.target.value })}
                    style={{ maxWidth: "320px" }}
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
                >
                  <input
                    value={localIbmNetworkResourceGroupName}
                    onChange={(e) => setLocalIbmNetworkResourceGroupName(e.target.value)}
                    onBlur={() => updateIbmCloud({ networkResourceGroupName: localIbmNetworkResourceGroupName })}
                    placeholder="existing-network-rg"
                    style={{ maxWidth: "400px" }}
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
                >
                  <input
                    value={localIbmVpcName}
                    onChange={(e) => setLocalIbmVpcName(e.target.value)}
                    onBlur={() => updateIbmCloud({ vpcName: localIbmVpcName })}
                    placeholder="existing-vpc-name"
                    style={{ maxWidth: "400px" }}
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
                >
                  <input
                    value={localIbmControlPlaneSubnets}
                    onChange={(e) => setLocalIbmControlPlaneSubnets(e.target.value)}
                    onBlur={() => updateIbmCloud({ controlPlaneSubnets: localIbmControlPlaneSubnets })}
                    placeholder="cp-subnet-a,cp-subnet-b,cp-subnet-c"
                    style={{ maxWidth: "400px" }}
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
                >
                  <input
                    value={localIbmComputeSubnets}
                    onChange={(e) => setLocalIbmComputeSubnets(e.target.value)}
                    onBlur={() => updateIbmCloud({ computeSubnets: localIbmComputeSubnets })}
                    placeholder="compute-subnet-a,compute-subnet-b,compute-subnet-c"
                    style={{ maxWidth: "400px" }}
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
                >
                  <input
                    value={localIbmDedicatedHostsProfile}
                    onChange={(e) => setLocalIbmDedicatedHostsProfile(e.target.value)}
                    onBlur={handleIbmDedicatedHostsProfileBlur}
                    placeholder="e.g. cx2-host-152x304"
                    style={{ maxWidth: "280px" }}
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
                >
                  <input
                    value={localIbmDedicatedHostsName}
                    onChange={(e) => setLocalIbmDedicatedHostsName(e.target.value)}
                    onBlur={handleIbmDedicatedHostsNameBlur}
                    placeholder="existing-dedicated-host"
                    style={{ maxWidth: "400px" }}
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
                    value={localIbmServiceEndpoints}
                    onChange={(e) => setLocalIbmServiceEndpoints(e.target.value)}
                    onBlur={() => updateIbmCloud({ serviceEndpoints: localIbmServiceEndpoints })}
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
                >
                  <input
                    value={localIbmDefaultMachineBootVolumeEncryptionKey}
                    onChange={(e) => setLocalIbmDefaultMachineBootVolumeEncryptionKey(e.target.value)}
                    onBlur={() => updateIbmCloud({ defaultMachineBootVolumeEncryptionKey: localIbmDefaultMachineBootVolumeEncryptionKey })}
                    placeholder="crn:v1:bluemix:public:kms:..."
                    style={{ maxWidth: "400px" }}
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
                >
                  <input
                    value={localIbmControlPlaneBootVolumeEncryptionKey}
                    onChange={(e) => setLocalIbmControlPlaneBootVolumeEncryptionKey(e.target.value)}
                    onBlur={() => updateIbmCloud({ controlPlaneBootVolumeEncryptionKey: localIbmControlPlaneBootVolumeEncryptionKey })}
                    placeholder="crn:v1:bluemix:public:kms:..."
                    style={{ maxWidth: "400px" }}
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
                >
                  <input
                    value={localIbmComputeBootVolumeEncryptionKey}
                    onChange={(e) => setLocalIbmComputeBootVolumeEncryptionKey(e.target.value)}
                    onBlur={() => updateIbmCloud({ computeBootVolumeEncryptionKey: localIbmComputeBootVolumeEncryptionKey })}
                    placeholder="crn:v1:bluemix:public:kms:..."
                    style={{ maxWidth: "400px" }}
                  />
                </FieldLabelWithInfo>
              </div>

              <h4 className="platform-specifics-subsection">Publishing and credentials</h4>
              <div className="field-grid">
                <FieldLabelWithInfo
                  label="Publish (optional)"
                  hint={`Controls whether cluster endpoints are publicly accessible or private-network only.

**External:**
Exposes API/apps via public endpoints

**Internal:**
Keeps endpoints private to your network/VPC - typical for private-cluster designs`}
                >
                  <select
                    value={platformConfig.publish || metaPublish?.default || "External"}
                    onChange={(e) => updatePlatformConfig({ publish: e.target.value })}
                    style={{ maxWidth: "280px" }}
                  >
                    <option value="External">External</option>
                    <option value="Internal">Internal</option>
                  </select>
                </FieldLabelWithInfo>
              </div>

              <h4 className="platform-specifics-subsection">Machine counts</h4>
              <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                Control plane and worker node counts for IBM Cloud IPI. IBM Cloud IPI does not use host inventory; set counts here.
              </p>
              <div className="field-grid">
                <FieldLabelWithInfo
                  label="Control plane replicas"
                  hint={`Number of control plane nodes (master nodes) to create during installation.

**Required:**
Must be an **odd number** for etcd quorum

**Standard value:**
3 (minimum for production high-availability)

**Why odd numbers:**
etcd (the cluster's key-value store) requires a quorum (majority) to function:
• **3 nodes:** Can survive 1 node failure (2 of 3 remaining = quorum)
• **5 nodes:** Can survive 2 failures (3 of 5 remaining = quorum)

**The sweet spot:**
3 nodes is optimal for most deployments - provides HA at reasonable cost

**When to use 5 nodes:**
• Very large clusters (500+ nodes)
• Need to survive 2 simultaneous control plane failures

**Never use even numbers:**
• **2 nodes:** Losing 1 = no quorum, cluster stops
• **4 nodes:** Losing 2 = no quorum, so you pay for 4 but can only survive 1 failure (same as 3 nodes)

**What runs on control plane:**
Each node runs etcd, Kubernetes API server, controller manager, and scheduler (CPU/memory intensive)

**IBM Cloud resources:**
Control plane nodes are virtual server instances (VSIs) - you pay for them

**Important:**
⚠️ **CANNOT be changed** after installation without rebuilding the cluster

**Default:** 3

**Recommendation:**
Use 5 only for very large or mission-critical clusters`}
                  className="field-short"
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
                  hint={`Number of worker nodes (compute nodes) to create during installation.

**What workers do:**
Run your application workloads (pods, containers)

**Scalability:**
Unlike control plane, you **CAN scale workers** up or down after installation via MachineSets

**Minimum recommended:**
**2 workers** for production (allows workload redundancy and rolling updates)

**Compact cluster (0 workers):**
You can set 0 for a control-plane-only cluster (sometimes called 'compact cluster') where control plane nodes also run workloads - this is **supported but NOT recommended** for production (reduces isolation, risks resource contention with etcd/API server)

**Sizing guidance:**

• **Development/testing:** 2-3 workers
• **Production:** Start with 3+ workers
• **High availability:** IBM Cloud IPI distributes workers across availability zones automatically (when multiple zones available in region)
• **Stateful workloads/databases:** Consider 5+ workers for better resilience

**IBM Cloud cost:**
Each worker is a VSI (virtual server instance) - more workers = higher cost, but also more capacity

**Scaling strategy:**
Start small (3 workers) and scale up post-install as workload demands grow by editing MachineSets

**Best practice:**
Use at least **2 workers** to ensure workload pods can be rescheduled if a worker fails

**Default:** 3

**Example:**
3 for small production
5 for medium
10+ for large workloads or multi-zone redundancy`}
                  className="field-short"
                >
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={platformConfig.computeReplicas ?? 3}
                    onChange={(e) => {
                      const v = e.target.value === "" ? undefined : Number(e.target.value);
                      updatePlatformConfig({ computeReplicas: v });
                    }}
                  />
                </FieldLabelWithInfo>
              </div>

              <h4 className="platform-specifics-subsection">Default machine platform (optional)</h4>
              <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                Default platform-specific configuration applied to all machine pools unless overridden.
              </p>
              <div className="field-grid">
                <FieldLabelWithInfo
                  label="Default instance profile (optional)"
                  hint={`Default IBM Cloud VSI profile for all machine pools.

**What is this:**
IBM Cloud Virtual Server Instance profile defining CPU/memory configuration for all nodes unless overridden per-pool.

**When needed:**
• Set default sizing for both control plane and workers
• Override installer defaults (simplifies configuration)
• Standardize VM sizing across the cluster

**Format:**
Profile naming: <family>-<vcpu>x<memory_gb>
• bx2-4x16 (Balanced 2nd gen, 4 vCPU, 16GB)
• bx2-8x32 (8 vCPU, 32GB)
• cx2-4x8 (Compute optimized)
• mx2-8x64 (Memory optimized)

**How it's used:**
Written to install-config.yaml platform.ibmcloud.defaultMachinePlatform.profile. Installer applies this to all machine pools unless per-pool override specified.

**Important:**
⚠️ Minimum 4 vCPU, 16GB RAM for control plane (etcd/API intensive)
⚠️ Profile must be available in selected region and zones
⚠️ Larger profiles = higher hourly cost
⚠️ Can be overridden per machine pool for heterogeneous sizing

**Example:**
bx2-8x32 (production standard)
bx2-4x16 (development/test)`}
                >
                  <input
                    value={platformConfig.ibmcloud?.defaultMachinePlatformProfile || ""}
                    onChange={(e) => updateIbmCloud({ defaultMachinePlatformProfile: e.target.value || undefined })}
                    placeholder="e.g. bx2-8x32"
                    style={{ maxWidth: "250px" }}
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Default availability zones (optional)"
                  hint={`Comma-separated list of IBM Cloud availability zones for machine placement.

**What is this:**
Default zones where the installer places VMs. Zones are physically separated datacenters within a region for fault isolation.

**When needed:**
• Control exact zone placement
• Limit deployment to specific zones (capacity/compliance)
• Override installer's automatic multi-zone distribution

**Format:**
Comma-separated zone names: us-east-1,us-east-2,us-east-3

**How it's used:**
Written to install-config.yaml platform.ibmcloud.defaultMachinePlatform.zones as array. Installer distributes machines across listed zones.

**Important:**
⚠️ Most IBM Cloud regions have 2-3 availability zones
⚠️ For HA, specify all available zones (installer spreads control plane)
⚠️ Zone names are region-specific (us-east-1 only in us-east region)
⚠️ Empty = installer auto-selects all zones in region (recommended)
⚠️ Zones must have capacity for selected instance profiles

**Example:**
us-east-1,us-east-2,us-east-3 (for us-east region with 3 zones)
us-south-1,us-south-2 (for us-south region with 2 zones)`}
                >
                  <input
                    value={(platformConfig.ibmcloud?.defaultMachinePlatformZones || []).join(",")}
                    onChange={(e) => {
                      const zones = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                      updateIbmCloud({ defaultMachinePlatformZones: zones.length > 0 ? zones : undefined });
                    }}
                    placeholder="e.g. us-east-1,us-east-2,us-east-3"
                    style={{ maxWidth: "400px" }}
                  />
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
                  style={{ maxWidth: "400px" }}
                >
                  <input
                    value={localNutanixEndpoint}
                    onChange={(e) => setLocalNutanixEndpoint(e.target.value)}
                    onBlur={() => updateNutanix({ endpoint: localNutanixEndpoint })}
                    placeholder="prism.example.com"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Port (optional; default 9440)"
                  hint={"TCP port number for the Prism Central REST API. Leave blank to use the default port 9440 (standard Prism Central HTTPS port).\n\n**What is this:** Prism Central's management API listens on a specific TCP port for HTTPS connections. The OpenShift installer connects to this port to execute API calls for VM provisioning, network configuration, and cluster management. Port 9440 is the Nutanix default for Prism Central.\n\n**Why you might change it:**\n1. Your organization uses non-standard ports for security policy compliance\n2. Prism Central is behind a reverse proxy or load balancer that uses a different port\n3. Network address translation (NAT) or port forwarding routes traffic to a different external port\n4. Multiple Prism Central instances on the same network with port separation\n\n**Important:** The port must match whatever is actually configured on your Prism Central instance. If you specify the wrong port, the installer will fail to connect with timeout or connection refused errors. The port must allow HTTPS/TLS traffic (Prism Central uses HTTPS by default, not plain HTTP). For most installations, leaving this field blank (using default 9440) is correct.\n\n**Example:** Leave blank for standard setups, or enter '443' if PC is behind a reverse proxy on standard HTTPS port, or '8443' if using a custom port."}
                >
                  <input
                    type="number"
                    value={localNutanixPort}
                    onChange={(e) => setLocalNutanixPort(e.target.value)}
                    onBlur={() => updateNutanix({ port: localNutanixPort || undefined })}
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
                  className="field-medium"
                >
                  <input
                    value={localNutanixUsername}
                    onChange={(e) => setLocalNutanixUsername(e.target.value)}
                    onBlur={() => updateNutanix({ username: localNutanixUsername })}
                    placeholder="admin"
                    autoComplete="username"
                    data-form-type="other"
                    data-lpignore="true"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Password"
                  hint={"Password for the Prism Central username specified above. This credential is used during OpenShift installation to authenticate API calls for provisioning VMs, configuring networks, and managing cluster infrastructure. The installer stores this password in plain text in the install-config.yaml file (unless you choose to exclude credentials at export time), so treat the install-config with appropriate security controls.\n\n**Important security notes:**\n1. DO NOT allow your browser to save this password - it will be embedded in plain text in the generated config file. Use your browser's password manager ignore features if prompted\n2. After installation completes, you can remove the credentials from install-config.yaml if you no longer need them (though some day-2 operations may require them)\n3. Store install-config.yaml securely - never commit it to version control or place it in shared/public storage with credentials included\n4. Consider using a dedicated service account with limited permissions instead of the main admin account for better security and auditability\n5. Rotate credentials periodically and update any stored install-config files accordingly\n\n**Credential inclusion:** When you export/generate the install-config, you'll have an option to include or exclude credentials. If excluded, you must provide credentials separately when running openshift-install (via prompts or environment variables). If included, the install-config is self-contained but more sensitive. For production deployments, many organizations use temporary credentials that are rotated or revoked after installation, or use secrets management tools (HashiCorp Vault, AWS Secrets Manager) instead of plain text storage."}
                  className="field-medium"
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
                      value={localNutanixPassword}
                      onChange={(e) => setLocalNutanixPassword(e.target.value)}
                      onBlur={() => updateNutanix({ password: localNutanixPassword })}
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
                    value={localNutanixSubnet}
                    onChange={(e) => setLocalNutanixSubnet(e.target.value)}
                    onBlur={() => updateNutanix({ subnet: localNutanixSubnet })}
                    placeholder="subnet-uuid or uuid1,uuid2"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Prism Element cluster name (optional)"
                  hint={"Name of the Nutanix Prism Element (PE) cluster where OpenShift virtual machines will be deployed. Leave blank to let the installer choose automatically (most common).\n\n**What is this:** Nutanix uses a two-tier management model - Prism Central (PC) manages multiple Prism Element clusters. Each PE cluster is a group of Nutanix nodes (hyperconverged servers) that form a storage/compute pool. This field specifies which PE cluster hosts your OpenShift VMs.\n\n**Why specify one:** Set a cluster name when you have multiple PE clusters managed by your Prism Central and want to pin OpenShift to a specific cluster (e.g., for capacity isolation, SLA tiers, or licensing/billing separation). If left blank, the installer selects a PE cluster automatically based on available resources.\n\n**Important:** This field expects the CLUSTER NAME (human-readable string like 'Production-Cluster-01'), NOT the cluster UUID. You can find cluster names in Prism Central → Compute & Storage → Clusters. The cluster must be registered with the Prism Central endpoint you specified above, and must have sufficient resources (CPU, memory, storage) for your control plane and worker node requirements. The cluster must also be running compatible Nutanix AOS/AHV versions (consult OpenShift documentation for version compatibility matrix).\n\n**Example:** 'Production-Cluster-01' or 'NX-3060-Cluster'. Most single-cluster Nutanix deployments leave this blank."}
                >
                  <input
                    value={localNutanixCluster}
                    onChange={(e) => setLocalNutanixCluster(e.target.value)}
                    onBlur={() => updateNutanix({ cluster: localNutanixCluster })}
                    placeholder="my-nutanix-cluster"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Storage container (optional)"
                  hint={`Nutanix storage container name where cluster persistent volumes (PVs) and VM disks will be stored.

**What is a storage container:**
Similar to a datastore in vSphere - a logical storage pool spanning multiple physical disks, providing data services like compression, deduplication, and redundancy.

**Default behavior:**
Leave blank to use the cluster's default storage container (most common choice)

**When to specify a container:**
Only set this if you want OpenShift volumes in a dedicated storage container separate from other workloads

**Reasons to use dedicated container:**
• **Capacity isolation:** Dedicate container with specific capacity for OpenShift
• **Performance isolation:** Use SSD-backed container for OpenShift while other workloads use HDD
• **Billing/chargeback:** Separate storage consumption tracking
• **Compliance:** Data residency or encryption requirements that differ from default

**Requirements:**
• Container must exist before installation
• Must be accessible from the Nutanix cluster specified above
• Find container names: Prism Central → Storage → Storage Containers

**Important:**
This setting affects **persistent volumes** created by OpenShift storage classes (PVCs). VM disks for nodes themselves use the cluster's default - this is specifically for workload storage.

**Recommendation:**
For most deployments, leave blank (use default) unless you have specific storage management requirements

**Example:**
openshift-storage
ssd-container`}
                >
                  <input
                    value={localNutanixStorageContainer}
                    onChange={(e) => setLocalNutanixStorageContainer(e.target.value)}
                    onBlur={() => updateNutanix({ storageContainer: localNutanixStorageContainer })}
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
                    hint={`Number of worker nodes (compute nodes) to create during installation for High Availability topology.

**What workers do:**
Run your application workloads - they do **NOT** run control plane services (API, etcd, schedulers)

**Minimum required:**
**2 workers** required for HA topology (allows workload redundancy and rolling updates)

**Scalability:**
Unlike control plane nodes, you **CAN** scale workers up or down after installation

**Sizing guidance:**
• **Development/testing:** 2-3 workers
• **Production:** Start with 3-5 workers for adequate capacity and resilience
• **Mission-critical:** Consider 5+ workers for large workloads

**Resource consumption:**
Each worker is a Nutanix VM that consumes cluster resources (CPU, RAM, storage)

**Why minimum 2:**
• **1 worker:** No redundancy - if it fails or needs maintenance, workloads have nowhere to run
• **2+ workers:** Workloads can be rescheduled to surviving nodes during failures or updates

**Best practice:**
Plan worker count based on expected workload - more workers provide more total capacity and better failure resilience, but consume more Nutanix resources

**Scaling strategy:**
Start with 3 workers and scale up post-install by editing MachineSets if workload demands grow

**Default:** 3 (good starting point for most production clusters)

**Example:**
3 for small production workloads
5 for medium-sized clusters
10+ for large-scale deployments with heavy compute/memory needs`}
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
                  hint={`Controls how OpenShift Cloud Credential Operator (CCO) manages cloud provider credentials.

**Mint (recommended for IPI):**
• CCO creates scoped cloud credentials for each cluster component from your admin credential
• Each component gets minimal permissions (least privilege)
• **Requires:** IAM rights to create new users/roles
• **Best for:** When you have full IAM admin access

**Passthrough:**
• CCO passes your install-time admin credential to all components — no new IAM identities created
• All components share the broad admin credential
• **Use when:** Your org prohibits new IAM account creation

**Manual:**
• You provision credentials yourself before install (e.g., via ccoctl for STS/Workload Identity)
• **Required for:** Airgapped AWS STS installs, highly regulated environments
• **Security:** Most secure, most complex
• **Important:** Must run ccoctl before openshift-install

**Platform-specific:**
⚠️ Nutanix IPI always requires Manual mode (enforced automatically)`}
                  style={{ maxWidth: "280px" }}
                >
                  <input readOnly value="Manual" aria-label="Credentials mode (Manual, required for Nutanix IPI)" />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Publish"
                  hint={`Controls whether cluster endpoints are publicly accessible or private-network only.

**External (default):**
• API and ingress published to public DNS/load balancer
• Use for clusters reachable from internet or external networks
• **Required when:** Apps/API must be accessed without VPN

**Internal:**
• All cluster endpoints are private-network only
• DNS must resolve internally
• **Required by:** Some compliance regimes

**Important:**
With Internal publishing, console.redhat.com cluster management and direct Red Hat update checks will **not reach the cluster** without additional network routing

**Recommendation:**
• **External** for most installs
• **Internal** only when external exposure is explicitly prohibited

**Platform-specific:**
⚠️ Nutanix IPI forces External in the generated install-config`}
                  style={{ maxWidth: "320px" }}
                >
                  <input readOnly value="External (required for Nutanix IPI)" aria-label="Publish (External, required for Nutanix IPI)" />
                </FieldLabelWithInfo>
              </div>

              <h4 className="platform-specifics-subsection">Default machine platform (optional)</h4>
              <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                Default platform-specific configuration applied to all machine pools unless overridden.
              </p>
              <div className="field-grid">
                <FieldLabelWithInfo
                  label="Default boot type (optional)"
                  hint={`Boot firmware type for Nutanix VMs.

**What is this:**
Boot firmware mode that determines how VMs initialize: Legacy BIOS, UEFI, or SecureBoot.

**When needed:**
• Match hardware requirements (newer systems require UEFI)
• Enable SecureBoot for compliance/security requirements
• Compatibility with specific OS/kernel versions

**Format:**
Select from dropdown: Legacy, UEFI, or SecureBoot

**How it's used:**
Written to install-config.yaml platform.nutanix.defaultMachinePlatform.bootType. Installer configures all VMs with this boot mode.

**Important:**
⚠️ Legacy (BIOS) works with all hardware but is deprecated
⚠️ UEFI recommended for modern deployments (better performance, GPT support)
⚠️ SecureBoot requires UEFI + signed bootloaders (added security, some compatibility restrictions)
⚠️ Cannot be changed after VM creation without recreating VMs

**Default:** Legacy (for backward compatibility)

**Recommendation:**
Use UEFI for new deployments, SecureBoot for high-security environments`}
                >
                  <select
                    value={platformConfig.nutanix?.defaultMachinePlatformBootType || ""}
                    onChange={(e) => updateNutanix({ defaultMachinePlatformBootType: e.target.value || undefined })}
                    style={{ maxWidth: "200px" }}
                  >
                    <option value="">Not set (default: Legacy)</option>
                    <option value="Legacy">Legacy</option>
                    <option value="UEFI">UEFI</option>
                    <option value="SecureBoot">SecureBoot</option>
                  </select>
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
                  hint={`Username for authenticating to vCenter Server.

**Required permissions:**
This account must have **Administrator** privileges or at minimum these permissions:
• **Datastore:** Allocate space, Browse
• **Folder:** Create, Delete
• **Host.Local operations:** Create VM
• **Network:** Assign network
• **Resource:** Assign VM to pool
• **Virtual machine.Configuration:** All

**Format:**
• administrator@vsphere.local
• DOMAIN\\username

**When required:**
• **IPI:** Required to automate infrastructure provisioning (VM creation, storage allocation, networking)
• **UPI:** Optional but helpful for validation

**Important:**
Included in install-config only when you choose to include credentials in export`}
                >
                  <input
                    value={localVsphereUsername}
                    onChange={(e) => setLocalVsphereUsername(e.target.value)}
                    onBlur={() => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, username: localVsphereUsername } })}
                    placeholder="administrator@vsphere.local"
                    autoComplete="username"
                    data-form-type="other"
                    data-lpignore="true"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="vCenter password (optional)"
                  hint={`Password for the vCenter username specified above.

**How it's used:**
• **IPI:** Provisions infrastructure resources (VMs, networks, storage) during installation
• **UPI:** Used for validation workflows

**Credential handling:**
The password is included in generated install-config.yaml **only when** you choose to include credentials in export

**Important:**
⚠️ **Do not allow your browser to save this password** - it will be embedded in **plain text** in the install-config
⚠️ After installation, you can remove credentials from the file if needed`}
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
                      value={localVspherePassword}
                      onChange={(e) => setLocalVspherePassword(e.target.value)}
                      onBlur={() => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, password: localVspherePassword } })}
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
                    hint={`Fully qualified domain name (FQDN) or IP address of your vCenter Server.

**What is this:**
The management endpoint for your vSphere environment. The installer connects to this address to provision VMs, configure networking, and manage cluster infrastructure.

**Format:**
• FQDN: vcenter.example.com
• IP address: 192.168.1.10
• Port: Defaults to 443 (HTTPS)

**Required for:**
• **IPI:** Automated provisioning - installer creates all infrastructure
• **UPI:** Validation and placement guidance

**How it's used:**
The installer authenticates using the credentials provided above and uses this endpoint to create cluster VMs, attach networks, allocate storage, and configure compute resources.

**Example:**
vcenter.example.com (production)
192.168.1.10 (lab environment)`}
                    required={true}
                  >
                    <input
                      value={localVsphereVcenter}
                      onChange={(e) => setLocalVsphereVcenter(e.target.value)}
                      onBlur={() => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, vcenter: localVsphereVcenter } })}
                      placeholder="vcenter.example.com"
                    />
                  </FieldLabelWithInfo>
                  <FieldLabelWithInfo
                    label="Datacenter"
                    hint={`vSphere datacenter name where the OpenShift cluster will be deployed.

**What is a datacenter:**
In vSphere, a datacenter is a top-level logical container that organizes compute resources (clusters, hosts), networks, and storage (datastores).

**Requirements:**
• Must match the **exact** name shown in vCenter (case-sensitive)
• Contains the clusters, datastores, and networks you'll specify below
• Must exist before installation (installer does not create datacenters)

**How to find datacenter names:**
vCenter → Inventory → Datacenters (lists all available datacenters)

**Example:**
DC1 (simple naming)
Datacenter-Production (descriptive naming)`}
                    required={true}
                  >
                    <input
                      value={localVsphereDatacenter}
                      onChange={(e) => setLocalVsphereDatacenter(e.target.value)}
                      onBlur={() => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, datacenter: localVsphereDatacenter } })}
                      placeholder="Datacenter name"
                    />
                  </FieldLabelWithInfo>
                  <FieldLabelWithInfo
                    label="Default datastore"
                    hint={`vSphere datastore name for cluster VM disks and volumes.

**What is a datastore:**
A storage container (VMFS, NFS, vSAN, or vVols) where VM disk files (VMDK) are stored.

**Requirements:**
• Must match the **exact** name in vCenter (case-sensitive)
• Sufficient free space: **800GB minimum** for basic cluster (3 control plane + 3 workers with 120GB disks each)
• Good performance: **SSD recommended** for production
• Adequate IOPS to support etcd and workload requirements

**Storage calculation:**
• Control plane nodes: ~300GB each (etcd, OS, containers)
• Worker nodes: ~120GB each (OS, containers, ephemeral storage)
• Bootstrap (temporary): ~120GB
• Overhead: ~15-20%

**Example:**
datastore1 (default naming)
Production-SAN-01 (descriptive naming)`}
                    required={metaVsphereDefaultDatastore?.required || isRequiredInstall("platform.vsphere.defaultDatastore")}
                  >
                    <input
                      value={localVsphereDefaultDatastore}
                      onChange={(e) => setLocalVsphereDefaultDatastore(e.target.value)}
                      onBlur={() => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, datastore: localVsphereDefaultDatastore } })}
                      placeholder="Datastore name"
                    />
                  </FieldLabelWithInfo>
                  <FieldLabelWithInfo
                    label="Compute cluster (required for legacy path)"
                    hint={`vSphere compute cluster where worker nodes will be provisioned.

**What is this:**
A vSphere compute cluster is a collection of ESXi hosts that share resources and provide features like DRS (Distributed Resource Scheduler) and HA (High Availability).

**Requirements:**
• Sufficient CPU, memory, and storage for your worker node count and sizing
• **DRS enabled** recommended for automatic VM placement and load balancing
• Must match exact cluster name in vCenter (case-sensitive)

**Placement options:**
• **Same cluster:** Use same cluster for control plane and compute (simpler, fewer resources)
• **Separate clusters:** Dedicate clusters for workload isolation (production pattern)

**Important:**
This field is for **legacy single placement mode only**. When using failure domains (OpenShift 4.20+ recommended path), each failure domain specifies its own cluster.

**Example:**
Cluster-Production-01
Compute-Zone-A`}
                  >
                    <input
                      value={localVsphereCluster}
                      onChange={(e) => setLocalVsphereCluster(e.target.value)}
                      onBlur={() => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, cluster: localVsphereCluster } })}
                      placeholder="e.g. Cluster1"
                    />
                  </FieldLabelWithInfo>
                  <FieldLabelWithInfo
                    label="VM network (required for legacy path)"
                    hint={`vSphere network name where OpenShift cluster VMs connect.

**What is this:**
vSphere network object name (Standard Port Group or Distributed Port Group) where the installer attaches virtual network interfaces (vNICs) for all cluster VMs (control plane, workers, bootstrap).

**Important distinction:**
This is a vSphere **network object name**, NOT an IP range or CIDR. The IP address ranges (Machine/Cluster/Service CIDRs) are configured separately in the Networking tab.

**Network types:**
• **Standard Port Group:** On Standard vSwitches
• **Distributed Port Group (DPG):** On Distributed vSwitches

**Critical requirements (ALL must be met):**
1. Contains the API and Ingress VIP addresses from Networking tab (IPs must be routable on this network)
2. DNS server on this network can resolve cluster domains (api.<cluster>.<domain>, *.apps.<cluster>.<domain>)
3. All cluster nodes can reach each other (no isolation/ACLs between nodes)
4. Network has connectivity to external services (internet for connected, mirror registry for disconnected, NTP)
5. Sufficient available IPs: one per VM (typically 3 control plane + N workers + 1 bootstrap = 4+N minimum)

**Networking requirements:**
The network must have available IPs within the Machine network CIDR you configured in the Networking tab.

**Multi-network setups:**
If you have multiple VLANs/networks, ensure this is the network where:
• Nodes communicate with each other
• VIPs are allocated
The installer does not support multi-homed VMs in install-config (requires post-install customization).

**How to find network names:**
vCenter → Networking → select switch → Port groups (copy exact name shown)

**Legacy path notice:**
This field is for **legacy single placement mode only**. When using failure domains (OpenShift 4.20+ recommended), each failure domain specifies its own network(s).

**Example:**
VM Network (default, simple deployments)
Production-Network (descriptive naming)
DPG-OpenShift-Prod (distributed port group)
OCP-Production-VLAN100 (VLAN-backed network)`}
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
                    For vSphere IPI, at least one failure domain is required (4.20+ recommended path). Add more for multi-zone placement. Only the selected path is emitted; legacy fields above are ignored when using failure domains.
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
                          hint={`Unique identifier for this failure domain.

**Purpose:**
Used in install-config.yaml and zone placement for referencing this failure domain

**Requirements:**
• Must be **unique** across all failure domains in your cluster
• Keep it short and descriptive
• **Format:** Lowercase alphanumeric and hyphens recommended

**How it's used:**
• Referenced by computeZones and controlPlaneZones fields for explicit node placement control
• OpenShift tracks which resources belong to which zone for high-availability placement and scheduling

**Example:**
fd-0, fd-1
zone-east-1, zone-west-1`}
                        >
                          <input value={fd.name || ""} onChange={(e) => updateFailureDomain(index, { name: e.target.value })} placeholder="fd-0" />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo
                          label="Region"
                          hint={`Logical region identifier for grouping failure domains.

**What is a region in vSphere:**
Typically represents a single vCenter or datacenter

**Single-datacenter deployment:**
Use a simple name like 'datacenter' or 'region1'

**Multi-datacenter setups:**
Should match the openshift-region tag value you apply to vSphere resources so the installer can group nodes by region

**Topology:**
Region + Zone together define the complete failure domain topology

**Examples:**

**Single vCenter serving multiple clusters:**
Use 'datacenter' for all failure domains

**Multiple vCenters:**
Use 'east', 'west', or datacenter-specific names

**Purpose:**
Helps OpenShift understand your infrastructure layout for scheduling and availability decisions`}
                        >
                          <input value={fd.region || ""} onChange={(e) => updateFailureDomain(index, { region: e.target.value })} placeholder="datacenter" />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo
                          label="Zone"
                          hint={`Logical zone identifier within the region.

**Typically:**
Matches your vSphere compute cluster name

**Single-cluster deployment:**
Use the cluster name (e.g., Cluster1)

**Multi-cluster/multi-zone setups:**
Should match the openshift-zone tag value you apply to vSphere resources so the installer can spread nodes across zones for high availability

**Failure domain separation:**
Zone is the granular level of failure domain separation - nodes in different zones should ideally be on different compute clusters or racks to survive hardware failures

**Example:**
If you have three compute clusters (Cluster1, Cluster2, Cluster3):
1. Create three failure domains
2. Set zones: cluster1, cluster2, cluster3
3. OpenShift distributes control plane and worker nodes across these zones to maximize availability`}
                        >
                          <input value={fd.zone || ""} onChange={(e) => updateFailureDomain(index, { zone: e.target.value })} placeholder="cluster-01" />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo
                          label="Server (vCenter FQDN or IP)"
                          hint={`Fully qualified domain name (FQDN) or IP address of the vCenter Server managing this failure domain.

**Deployment patterns:**

**Same vCenter (common):**
Each failure domain points to the same vCenter - typical for single-datacenter multi-cluster setups

**Different vCenter instances:**
Different failure domains point to different vCenter instances - for multi-datacenter deployments

**How it's used:**
The installer uses this address with your provided credentials to provision VMs in this specific failure domain

**High availability across datacenters:**
• vcenter-east.example.com for one failure domain
• vcenter-west.example.com for another

This allows OpenShift to span multiple vCenter instances in a single cluster deployment

**Example:**
vcenter.example.com
192.168.1.10`}
                        >
                          <input value={fd.server || ""} onChange={(e) => updateFailureDomain(index, { server: e.target.value })} placeholder="vcenter.example.com" />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo
                          label="Topology: Datacenter"
                          hint={`vSphere datacenter name where resources for this failure domain are located.

**Requirements:**
• Must match the **exact** datacenter name shown in vCenter (**case-sensitive**)

**What is a datacenter:**
Top-level container that organizes compute clusters, hosts, datastores, and networks

**Deployment patterns:**

**Single-datacenter:**
All failure domains typically reference the same datacenter name

**Multi-datacenter:**
Each failure domain points to its respective datacenter (e.g., East-DC, West-DC)

**How it's used:**
The installer uses this to locate other topology resources (cluster, datastore, networks) within the correct vSphere inventory structure

**How to find datacenter names:**
vCenter → Inventory → Datacenters

**Example:**
Datacenter1
Production-DC`}
                        >
                          <input value={fd.topology?.datacenter || ""} onChange={(e) => updateFailureDomainTopology(index, { datacenter: e.target.value })} placeholder="Datacenter1" />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo
                          label="Topology: Compute cluster"
                          hint={`vSphere compute cluster name where VMs for this failure domain will be provisioned.

**Requirements:**
• Must match the **exact** cluster name in vCenter (**case-sensitive**)
• Sufficient CPU, memory, and storage resources for nodes in this failure domain
• **DRS enabled** recommended for automatic VM placement and load balancing

**What is a compute cluster:**
Collection of ESXi hosts that share resources and provide high availability features like DRS (Distributed Resource Scheduler) and HA (High Availability)

**Zone separation:**
Each failure domain can target a different cluster - this is how you achieve **true zone separation** in vSphere (nodes in different clusters can survive cluster-level failures)

**How it's used:**
The installer provisions VMs into this cluster according to your node distribution settings

**Example:**
Cluster1
Production-Cluster
Compute-Zone-A`}
                        >
                          <input value={fd.topology?.computeCluster || ""} onChange={(e) => updateFailureDomainTopology(index, { computeCluster: e.target.value })} placeholder="Cluster1" />
                        </FieldLabelWithInfo>
                        <FieldLabelWithInfo
                          label="Topology: Datastore"
                          hint={`Absolute datastore path in vSphere inventory for VM disks in this failure domain.

**Format:**
/datacenter-name/datastore/datastore-name

**Requirements:**
• Must match the **exact** path as shown in vCenter

**What is a datastore:**
Storage container (VMFS, NFS, vSAN, or vVols) where VM disk files (VMDK) are stored

**Capacity requirements:**
The datastore must have sufficient free space for all VMs in this failure domain:
• **Control plane:** ~300GB minimum per node
• **Worker:** ~120GB minimum per node
• **Plus overhead:** 15-20%

**High availability:**
Use different datastores for different failure domains if possible (avoids single storage point of failure)

**Performance requirements:**
For production workloads, ensure:
• Good performance (SSD-backed or high-performance SAN)
• Adequate IOPS to support etcd and application workloads

**How to find datastore paths:**
vCenter → Storage → select datastore → Summary tab

**Example:**
/Datacenter1/datastore/Production-SAN-01
/Datacenter1/datastore/vsanDatastore`}
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
                              hint={`Absolute path to a pre-deployed RHCOS (Red Hat CoreOS) OVA template in vSphere inventory that the installer will clone to create cluster VMs.

**Format:**
/datacenter-name/vm/folder-name/template-name

**Default behavior:**
Leave blank to use 'clusterOSImage' URL strategy (Machine pool advanced section)

**Important - Choose ONE image strategy:**
⚠️ Either set 'Topology: RHCOS template' per failure domain (useful when each zone needs a different template), OR set 'clusterOSImage' URL once for the whole cluster
⚠️ Do not set both

**How to set up:**
1. Download the RHCOS OVA for your OpenShift version from Red Hat (e.g., rhcos-4.14.0-x86_64-vmware.x86_64.ova)
2. In vCenter, right-click folder → Deploy OVF Template → select downloaded OVA → complete wizard **WITHOUT** customizing guest OS settings
3. After deploy completes, note the template's full inventory path (Hosts and Clusters view → VM → Summary tab shows path)
4. Enter that path here

**Why pre-deploy templates:**
• Disconnected/airgap environments where the installer cannot download images directly
• When you need tight control over image provenance
• For multi-zone deployments where each zone needs images on local storage

**Multiple failure domains:**
If you have 3 failure domains, you can set a different RHCOS template path for each one (useful if templates are on different datastores per zone for locality). Or use one template accessible across all zones.

**Critical requirements:**
⚠️ The template must match your selected OpenShift version - using RHCOS 4.14 template for OpenShift 4.15 will cause failures
⚠️ After deployment, do NOT power on or customize the template - the installer expects it in the pristine post-OVF-deploy state

**How to find the full path:**
vCenter → select the VM → Summary tab → VM Path field

**Example:**
/Datacenter1/vm/rhcos-templates/rhcos-4.14.0-vmware`}
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
                            hint={`Absolute VM folder path in vSphere inventory where the installer places OpenShift VMs for this failure domain.

**Format:**
/datacenter-name/vm/folder-name
/datacenter-name/vm/parent-folder/child-folder

**Default behavior:**
Leave blank to use the default VM folder at the datacenter root

**What are VM folders:**
Organizational containers that group VMs for easier management and permission control - they **don't affect VM function**, just inventory organization

**How it's used:**
The installer creates all cluster VMs (control plane, workers, bootstrap) in this folder

**When to use:**
For production environments, using a dedicated folder helps separate OpenShift VMs from other workloads

**How to create folders:**
vCenter → VMs and Templates → right-click datacenter → New Folder

**Important:**
• The path must exist **before installation** (the installer will not create it)
• This is purely for organization and has **no impact** on networking, storage, or compute placement

**Example:**
/Datacenter1/vm/OpenShift
/Datacenter1/vm/Production/OCP-Cluster`}
                          >
                            <input value={fd.topology?.folder || ""} onChange={(e) => updateFailureDomainTopology(index, { folder: e.target.value })} placeholder="/datacenter/vm/folder" />
                          </FieldLabelWithInfo>
                          <FieldLabelWithInfo
                            label="Topology: Resource pool (optional)"
                            hint={`Absolute resource pool path in vSphere inventory for CPU/memory resource management of VMs in this failure domain.

**Format:**
/datacenter-name/host/cluster-name/Resources/pool-name

**Default behavior:**
Leave blank to use the cluster's root Resources pool (default)

**What are resource pools:**
Allow you to partition and allocate CPU and memory resources with reservations, limits, and shares - useful for ensuring OpenShift VMs get guaranteed resources separate from other workloads

**When to use:**
If you're sharing compute clusters with other applications, a dedicated resource pool prevents resource contention

**Requirements:**
The pool must exist before installation

**How to create resource pools:**
vCenter → Hosts and Clusters → select cluster → right-click Resources → New Resource Pool

**Recommendation:**
For most installations, the default root Resources pool is sufficient unless you need specific resource guarantees or limits

**Important:**
This setting does **NOT** affect storage (datastore) or network placement

**Example:**
/Datacenter1/host/Cluster1/Resources/OpenShift-Pool`}
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
                  hint={`vSphere disk provisioning format for VM disk files (VMDKs).

**What this controls:**
How storage space is allocated on the datastore for cluster node disks

**Default:**
Leave as 'Not set' to use the datastore's default provisioning policy (recommended for most installations)

**Options:**

**thin (Thin Provisioning):**
• Allocates storage space on-demand as data is written
• A 120GB thin disk might only consume 20GB initially, growing as VM writes data
• Fast to create, space-efficient, good for most OpenShift installs

**thick (Thick Provision Lazy Zeroed):**
• Allocates full disk size immediately (120GB disk = 120GB consumed on datastore)
• Doesn't zero out blocks until first write
• Faster to create than eagerZeroedThick, more predictable I/O performance than thin

**eagerZeroedThick (Thick Provision Eager Zeroed):**
• Allocates full disk size AND zeros out all blocks at creation time
• Slowest to create (can take minutes for large disks)
• Most consistent I/O performance
• **REQUIRED** for vSphere features like Fault Tolerance

**Recommendation:**
Use 'thin' for most OpenShift installations - it's space-efficient and performs well for typical workloads

**When to use thick/eagerZeroedThick:**
1. You need guaranteed storage capacity upfront (avoiding over-subscription)
2. Predictable I/O performance is critical (e.g., etcd on control plane nodes in high-transaction clusters)
3. Your storage team mandates thick provisioning policies
4. You're enabling vSphere Fault Tolerance (requires eagerZeroedThick)

**Important - Thin provisioning:**
⚠️ Requires monitoring datastore space - if the datastore fills up, thin disk expansion can fail and VMs can pause
⚠️ Ensure adequate datastore capacity and alerts

**Scope:**
This setting applies to **ALL** cluster nodes (control plane and workers)

**Note:**
For production etcd performance, some organizations prefer thick or eagerZeroedThick for control plane nodes, but this requires post-install MachineConfig customization (install-config applies one type to all nodes)

**Example:**
Leave 'Not set' for most installs (uses datastore default, usually thin)
Set 'eagerZeroedThick' only if mandated by storage team or for Fault Tolerance requirements`}
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
                      hint={`Comma-separated list of failure domain names where worker (compute) nodes should be deployed.

**Requirements:**
Each name must **EXACTLY** match a 'Name' field from the failure domains you defined above (case-sensitive)

**Default behavior:**
If left blank, the installer defaults to spreading workers across **ALL** defined failure domains automatically

**Why set this:**
By specifying compute zones, you control which failure domains host worker nodes for high availability

**When to set it:**
1. You want workers in only a subset of failure domains (e.g., you have 4 zones but want workers in only 3)
2. You want asymmetric placement (e.g., control plane in zones A/B/C, but workers only in zones A/B)
3. You want to explicitly document zone placement in install-config

**How it works:**
The installer distributes worker replicas evenly across the specified zones. For example:
• 6 workers + 3 zones = 2 workers per zone
• If worker count doesn't divide evenly, some zones get one extra worker

**Important:**
⚠️ The zone names here are just identifiers - they **don't create** new failure domains
⚠️ You must first define failure domains in the 'Failure domains' section above with datacenter, cluster, datastore, and network details
⚠️ This field simply references those pre-defined failure domains by name

**Format:**
Comma-separated names, spaces allowed, no quotes needed

**Example:**
fd-0, fd-1, fd-2
zone-east, zone-west (matching your failure domain names)`}
                    >
                      <input
                        value={Array.isArray(platformConfig.vsphere?.computeZones) ? platformConfig.vsphere.computeZones.join(", ") : ""}
                        onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, computeZones: e.target.value.split(",").map((z) => z.trim()).filter(Boolean) } })}
                        placeholder="e.g. fd-0, fd-1"
                      />
                    </FieldLabelWithInfo>
                    <FieldLabelWithInfo
                      label="Control plane zones"
                      hint={`Comma-separated list of failure domain names where control plane (master) nodes should be deployed.

**Requirements:**
Each name must **EXACTLY** match a 'Name' field from the failure domains you defined above (case-sensitive)

**Default behavior:**
If left blank, the installer defaults to spreading control plane across **ALL** defined failure domains (usually what you want)

**Why set this:**
Control plane zone placement is **CRITICAL** for cluster availability. You should spread control plane nodes across multiple failure domains (typically 3) to survive zone-level failures.

**When to set it:**
1. You want control plane in only a subset of failure domains (e.g., you have 4 zones but want control plane in only the first 3)
2. You want asymmetric placement (e.g., control plane in zones A/B/C, but workers in zones C/D/E)
3. You want to explicitly document control plane placement in install-config for compliance/architecture records

**How it works:**
OpenShift always uses 3 or 5 control plane nodes (odd number for etcd quorum):
• **3 zones specified:** One control plane node per zone
• **Fewer zones than nodes:** Some zones host multiple control plane nodes (reduces availability)
• **More zones than nodes:** Only a subset of zones get control plane nodes

**Critical for production HA:**
⚠️ You should have **AT LEAST 3 zones** specified here (one control plane node per zone)
⚠️ This ensures the cluster survives a zone failure - if one zone goes down, you still have 2/3 control plane nodes for etcd quorum
⚠️ **Never** put all control plane nodes in the same zone (defeats the purpose of failure domains)

**Format:**
Comma-separated names, spaces allowed, no quotes needed

**Example:**
fd-0, fd-1, fd-2
zone-east, zone-central, zone-west (matching your failure domain names)`}
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
                <>
                  <h4 className="platform-specifics-subsection">Machine counts</h4>
                  <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                    Control plane and worker node counts for vSphere IPI. vSphere IPI does not use host inventory; set counts here.
                  </p>
                  <div className="field-grid">
                    <FieldLabelWithInfo
                      label="Control plane replicas"
                      hint={`Number of control plane nodes (master nodes) to create during installation.

**Required:**
Must be an **odd number** for etcd quorum

**Standard value:**
3 (minimum for production high-availability)

**Why odd numbers:**
etcd (the cluster's key-value store) requires a quorum (majority) to function:
• **3 nodes:** Can survive 1 node failure (2 of 3 remaining = quorum)
• **5 nodes:** Can survive 2 failures (3 of 5 remaining = quorum)

**The sweet spot:**
3 nodes is optimal for most deployments - provides HA at reasonable cost

**When to use 5 nodes:**
• Very large clusters (500+ nodes)
• Need to survive 2 simultaneous control plane failures

**Never use even numbers:**
• **2 nodes:** Losing 1 = no quorum, cluster stops
• **4 nodes:** Losing 2 = no quorum, so you pay for 4 but can only survive 1 failure (same as 3 nodes)

**What runs on control plane:**
Each node runs etcd, Kubernetes API server, controller manager, and scheduler (CPU/memory intensive)

**vSphere resources:**
Control plane nodes are VMs (consume vCPU, RAM, storage)

**Important:**
⚠️ **CANNOT be changed** after installation without rebuilding the cluster

**Default:** 3

**Recommendation:**
Use 5 only for very large or mission-critical clusters`}
                      className="field-short"
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
                      hint={`Number of worker nodes (compute nodes) to create during installation.

**What workers do:**
Run your application workloads (pods, containers)

**Scalability:**
Unlike control plane, you **CAN scale workers** up or down after installation via MachineSets

**Minimum recommended:**
**2 workers** for production (allows workload redundancy and rolling updates)

**Compact cluster (0 workers):**
You can set 0 for a control-plane-only cluster (sometimes called 'compact cluster') where control plane nodes also run workloads - this is **supported but NOT recommended** for production (reduces isolation, risks resource contention with etcd/API server)

**Sizing guidance:**

• **Development/testing:** 2-3 workers
• **Production:** Start with 3+ workers
• **High availability:** Spread workers across multiple failure domains if using failure domain topology
• **Stateful workloads/databases:** Consider 5+ workers for better resilience

**vSphere resources:**
Each worker is a VM - more workers = more vCPU/RAM/storage consumption

**Scaling strategy:**
Start small (3 workers) and scale up post-install as workload demands grow by editing MachineSets

**Best practice:**
Use at least **2 workers** to ensure workload pods can be rescheduled if a worker fails

**Default:** 3

**Example:**
3 for small production
5 for medium
10+ for large workloads or multi-failure-domain redundancy`}
                      className="field-short"
                    >
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={platformConfig.computeReplicas ?? 3}
                        onChange={(e) => {
                          const v = e.target.value === "" ? undefined : Number(e.target.value);
                          updatePlatformConfig({ computeReplicas: v });
                        }}
                      />
                    </FieldLabelWithInfo>
                  </div>
                </>
              )}

              {(scenarioId === "vsphere-ipi" || scenarioId === "vsphere-upi") && (
                <CollapsibleSection title="Machine pool (advanced)" defaultCollapsed={true} style={{ marginBottom: 20 }}>
                  {scenarioId === "vsphere-ipi" && (
                    <p className="note subtle" style={{ marginTop: 0, marginBottom: 8 }}>
                      Choose one RHCOS image strategy: clusterOSImage URL or topology.template per failure domain. Do not set both.
                    </p>
                  )}
                  <div className="field-grid" style={{ marginTop: 8, marginBottom: 12 }}>
                    <FieldLabelWithInfo
                      label="clusterOSImage (optional)"
                      hint={scenarioId === "vsphere-ipi"
                        ? `HTTP/HTTPS URL to a custom RHCOS (Red Hat CoreOS) OVA image for cluster nodes. Leave blank to use the default RHCOS image for your OpenShift version.

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
http://192.168.1.100/images/rhcos-vmware.ova`
                        : `HTTP/HTTPS URL to a custom RHCOS (Red Hat CoreOS) OVA image for cluster nodes. Leave blank to use the default RHCOS image for your OpenShift version.

**What is this:**
URL pointing to a Red Hat CoreOS OVA file that the installer will download and import into vSphere as a template, then clone to create cluster VMs.

**When to use:**
• Disconnected/airgap installations where you've hosted RHCOS images on an internal web server
• Custom RHCOS images with site-specific modifications
• Testing specific RHCOS versions

**Applies to:**
Both IPI and UPI (4.20 doc 9.1.6: Optional VMware vSphere machine pool configuration parameters)

**Requirements:**
1. URL must be reachable from where you run openshift-install
2. Must be HTTPS or HTTP (HTTPS recommended for security)
3. Image must match your selected OpenShift release version exactly
4. Format must be OVA (Open Virtualization Archive)

**Example:**
https://mirror.example.com/rhcos-4.14.0-x86_64-vmware.ova
http://192.168.1.100/images/rhcos-vmware.ova`
                      }
                    >
                      <input
                        value={platformConfig.vsphere?.clusterOSImage || ""}
                        onChange={(e) => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, clusterOSImage: e.target.value } })}
                        placeholder="https://mirror.example.com/rhcos.ova"
                        disabled={scenarioId === "vsphere-ipi" && failureDomains.some((fd) => fd.topology?.template && String(fd.topology.template).trim() !== "")}
                        aria-describedby={scenarioId === "vsphere-ipi" && failureDomains.some((fd) => fd.topology?.template && String(fd.topology.template).trim() !== "") ? "cluster-os-image-disabled-note" : undefined}
                      />
                    </FieldLabelWithInfo>
                  </div>
                  {scenarioId === "vsphere-ipi" && failureDomains.some((fd) => fd.topology?.template && String(fd.topology.template).trim() !== "") && (
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
                      hint={`Memory (RAM) in megabytes (MB) to assign to each VM.

**Default behavior:**
Leave blank to use installer defaults:
• Control plane: 16384MB (16GB)
• Workers: 8192MB (8GB)

**Control plane sizing:**
• **16GB minimum** required for production (etcd, API server, controllers are memory-intensive)
• **32GB+** recommended for large clusters (100+ nodes) or many operators

**Worker sizing:**
Size based on workload requirements:
• **8GB minimum:** Light workloads
• **16-32GB:** General applications
• **64GB+:** Memory-intensive workloads (databases, big data, ML)

**Important - Physical RAM:**
⚠️ The host must have sufficient physical RAM
⚠️ vSphere memory over-commitment (more virtual RAM than physical) can **severely impact** OpenShift performance, especially for etcd
⚠️ Always ensure adequate physical RAM is available

**Format:**
Value in MB (use multiples of 1024 for clean GB values):
• 8192 = 8GB
• 16384 = 16GB
• 32768 = 32GB
• 65536 = 64GB

**Example:**
16384 (16GB for basic control plane)
32768 (32GB for busy control plane)
16384 (16GB for general workers)
65536 (64GB for database workers)`}
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
                    hint={`Configure how the provisioning network is used during bare metal installation.

**Managed (default):**
• The installer runs DHCP and TFTP on the provisioning network
• No other DHCP allowed on that network
• **Choose when:** You have a dedicated provisioning NIC and can give the installer full control

**Unmanaged:**
• Provisioning network exists but you run DHCP yourself
• Virtual media is recommended, PXE still possible
• **Choose when:** You must use existing DHCP or share the network

**Disabled:**
• No provisioning network; use virtual media or Assisted Installer only
• BMCs must be reachable on the bare-metal network
• Reserve two IPs on that network for provisioning services
• **Choose for:** Fully static or disconnected flows`}
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
                      className={fieldErrors.provisioningNetworkCIDR ? "input-error" : ""}
                      title={fieldErrors.provisioningNetworkCIDR || ""}
                      value={localProvisioningNetworkCIDR}
                      onChange={(e) => setLocalProvisioningNetworkCIDR(e.target.value)}
                      onBlur={() => updateInventory({ provisioningNetworkCIDR: localProvisioningNetworkCIDR.trim() })}
                      placeholder={provisioningMode === "Disabled" ? "omit or bare-metal CIDR" : "e.g. 172.22.0.0/24"}
                    />
                  </FieldLabelWithInfo>
                  {fieldErrors.provisioningNetworkCIDR && <span className="note warning inline">{fieldErrors.provisioningNetworkCIDR}</span>}
                  <FieldLabelWithInfo
                    label="Provisioning network interface (optional)"
                    hint={provisioningMode === "Disabled"
                      ? "When Disabled, there is no provisioning network; omit unless your setup requires it."
                      : "Name of the network interface on the bootstrap/provisioning host that connects to the provisioning network. Identifies which NIC the installer binds provisioning services (DHCP, TFTP, HTTP) to.\n\n**What is this:**\nLinux network interface name (e.g., 'eth0', 'ens192', 'enp1s0') on the machine where you run openshift-install. The installer uses this interface to communicate with bare metal nodes during provisioning.\n\n**When to set:**\n• **Required when:** Bootstrap host has multiple network interfaces and you need to specify which one faces the provisioning network\n• **Optional when:** Single NIC system - installer auto-detects\n• **Not used when:** provisioningNetwork = 'Disabled'\n\n**How to find interface name:**\nOn the host where you'll run openshift-install:\n• Linux: `ip link show` or `ip addr show` (lists all interfaces)\n• Look for the interface connected to your provisioning VLAN/network\n\n**Common interface naming:**\n• **Predictable naming (systemd):** ens192, eno1, enp1s0\n• **Traditional naming:** eth0, eth1, eth2\n• **Bond interfaces:** bond0, bond1\n• **VLAN interfaces:** eth0.100, ens192.200\n\n**Requirements:**\n• Interface must be UP (enabled) before running openshift-install\n• Interface should have an IP address in the provisioning network CIDR\n• Interface must be physically connected to the same network segment as bare metal node BMCs and provisioning NICs\n\n**Relationship to provisioningMACAddress:**\nYou can specify interface by name (this field) OR by MAC address (provisioningMACAddress field) - either works, name is more human-readable\n\n**Example:**\neth1 (second NIC on traditional naming)\nens192 (typical VMware VM interface)\nenp2s0 (PCIe slot 2, port 0)"}
                  >
                    <input
                      value={localProvisioningNetworkInterface}
                      onChange={(e) => setLocalProvisioningNetworkInterface(e.target.value)}
                      onBlur={() => updateInventory({ provisioningNetworkInterface: localProvisioningNetworkInterface })}
                      placeholder={provisioningMode === "Disabled" ? "omit" : "e.g. eth1"}
                    />
                  </FieldLabelWithInfo>
                  {showDhcpRange ? (
                    <>
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
                          className={fieldErrors.provisioningDHCPRange ? "input-error" : ""}
                          title={fieldErrors.provisioningDHCPRange || ""}
                          value={localProvisioningDHCPRange}
                          onChange={(e) => setLocalProvisioningDHCPRange(e.target.value)}
                          onBlur={() => updateInventory({ provisioningDHCPRange: localProvisioningDHCPRange })}
                          placeholder="e.g. 172.22.0.10,172.22.0.254"
                        />
                      </FieldLabelWithInfo>
                      {fieldErrors.provisioningDHCPRange && <span className="note warning inline">{fieldErrors.provisioningDHCPRange}</span>}
                    </>
                  ) : null}
                  <FieldLabelWithInfo
                    label="Cluster provisioning IP (optional)"
                    hint={provisioningMode === "Disabled"
                      ? "When Disabled, one of two IPs on the bare-metal network for provisioning services (installer needs two IPs on bare-metal network when no dedicated provisioning network exists)."
                      : "IPv4 or IPv6 address assigned to the provisioning host's interface where OpenShift installer provisioning services (DHCP, TFTP, HTTP) listen. This is the IP nodes contact to fetch boot images and configuration during installation.\n\n**What is this:**\nStatic IP address on the provisioning network that the installer binds its services to. Bare metal nodes PXE boot and download images from this IP during the bootstrap process.\n\n**Default behavior:**\nIf omitted, the installer typically uses the **third IP** of the provisioning subnet (catalog default). For example, if provisioningNetworkCIDR is 172.22.0.0/24, default might be 172.22.0.3.\n\n**When to set explicitly:**\n• When you need a specific IP for firewall rules or DNS entries\n• When the third IP of the subnet is already in use\n• When integrating with existing provisioning infrastructure that expects a particular IP\n\n**Requirements:**\n• **Managed/Unmanaged modes:** Must be within provisioningNetworkCIDR\n• **Disabled mode:** Must be on the bare-metal network (Machine network CIDR)\n• Must NOT conflict with provisioningDHCPRange\n• Must be statically assigned (not in DHCP dynamic range)\n• Must be reachable from bare metal node BMCs and boot interfaces\n\n**Provisioning mode specifics:**\n\n**Managed:** \nInstaller runs DHCP/TFTP on this IP on the provisioning network. Nodes receive this IP via DHCP options as their boot server.\n\n**Unmanaged:**\nYou run DHCP elsewhere, but installer HTTP/image services still bind to this IP. Configure your DHCP server to point nodes to this IP for image downloads.\n\n**Disabled:**\nNo dedicated provisioning network - installer services run on the bare-metal network. This IP is one of two IPs needed on the bare-metal network for provisioning (the other for bootstrap services).\n\n**How nodes use this IP:**\n• PXE boot: Fetch kernel/initrd via TFTP from this IP\n• Image download: Pull RHCOS images via HTTP from this IP\n• Ignition config: Retrieve bootstrap configuration from this IP\n\n**Example:**\n172.22.0.10 (Managed mode, within 172.22.0.0/24)\n10.0.0.100 (Disabled mode, on bare-metal network 10.0.0.0/24)"}
                  >
                    <input
                      className={fieldErrors.clusterProvisioningIP ? "input-error" : ""}
                      title={fieldErrors.clusterProvisioningIP || ""}
                      value={localClusterProvisioningIP}
                      onChange={(e) => setLocalClusterProvisioningIP(e.target.value)}
                      onBlur={() => updateInventory({ clusterProvisioningIP: localClusterProvisioningIP.trim() })}
                      placeholder={provisioningMode === "Disabled" ? "IP on bare-metal network" : "IP within provisioning subnet"}
                    />
                  </FieldLabelWithInfo>
                  {fieldErrors.clusterProvisioningIP && <span className="note warning inline">{fieldErrors.clusterProvisioningIP}</span>}
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
                      value={localProvisioningMACAddress}
                      onChange={(e) => setLocalProvisioningMACAddress(formatMACAsYouType(e.target.value))}
                      onBlur={() => updateInventory({ provisioningMACAddress: localProvisioningMACAddress })}
                      placeholder="MAC where provisioning services run"
                    />
                  </FieldLabelWithInfo>
                </div>
                {provisioningMode === "Disabled" && (
                  <p className="note subtle" style={{ marginTop: 12, marginBottom: 0 }}>
                    When Disabled, reserve two IPs on the bare-metal network for provisioning services; BMCs must be reachable on that network.
                  </p>
                )}

                <h4 className="platform-specifics-subsection">Advanced bare metal options (optional)</h4>
                <div className="field-grid" style={{ marginTop: 8 }}>
                  <FieldLabelWithInfo
                    label="Libvirt URI (optional)"
                    hint={`Libvirt connection URI for the bare metal provisioning host.

**What is this:**
Connection string for the libvirt virtualization API on the host where openshift-install runs. Used for managing the bootstrap VM during IPI installation.

**When needed:**
• Remote provisioning host (libvirt running on different machine than openshift-install)
• Non-standard libvirt socket path
• Custom libvirt authentication/TLS

**Format:**
Standard libvirt URI syntax:
• qemu:///system (default local system connection)
• qemu+ssh://user@host/system (remote over SSH)
• qemu+tcp://host/system (remote over TCP)

**How it's used:**
Written to install-config.yaml platform.baremetal.libvirtURI. Installer connects to libvirt to create/manage the bootstrap VM.

**Important:**
⚠️ Default qemu:///system works for most deployments (omit this field)
⚠️ Remote URIs require SSH keys or authentication setup before installation
⚠️ Bootstrap VM is temporary (deleted after cluster bootstraps)

**Default:** qemu:///system (local connection)

**Example:**
qemu+ssh://root@provisioner.example.com/system`}
                  >
                    <input
                      value={inventory.libvirtURI || ""}
                      onChange={(e) => updateInventory({ libvirtURI: e.target.value || undefined })}
                      placeholder="qemu:///system (default)"
                      style={{ maxWidth: "400px" }}
                    />
                  </FieldLabelWithInfo>
                  <FieldLabelWithInfo
                    label="External bridge (optional)"
                    hint={`External network bridge name for the baremetal network.

**What is this:**
Linux bridge interface name on the provisioning host that connects to the bare-metal network (where cluster nodes communicate).

**When needed:**
• Non-standard bridge name (not baremetal or virbr0)
• Custom network topology with specific bridge naming
• Multiple bridges on provisioning host

**Format:**
Linux bridge interface name (e.g., br0, baremetal, external-br)

**How it's used:**
Written to install-config.yaml platform.baremetal.externalBridge. Installer attaches bootstrap VM to this bridge for bare-metal network access.

**Important:**
⚠️ Bridge must exist on provisioning host before installation
⚠️ Bridge must be connected to the bare-metal network (where API VIP, Ingress VIP reside)
⚠️ Default bridge name is typically 'baremetal' or 'virbr0' - only set if different

**Example:**
br0 (common custom bridge name)
baremetal (typical default)
external-br (descriptive name)`}
                  >
                    <input
                      value={inventory.externalBridge || ""}
                      onChange={(e) => updateInventory({ externalBridge: e.target.value || undefined })}
                      placeholder="e.g. baremetal"
                      style={{ maxWidth: "250px" }}
                    />
                  </FieldLabelWithInfo>
                </div>
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
                          value={localVsphereFolder}
                          onChange={(e) => setLocalVsphereFolder(e.target.value)}
                          onBlur={() => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, folder: localVsphereFolder } })}
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
                          value={localVsphereResourcePool}
                          onChange={(e) => setLocalVsphereResourcePool(e.target.value)}
                          onBlur={() => updatePlatformConfig({ vsphere: { ...platformConfig.vsphere, resourcePool: localVsphereResourcePool } })}
                          placeholder="Resource pool path"
                        />
                      </FieldLabelWithInfo>
                    </>
                  )}
                  {showAgentOptionsSection && (
                    <FieldLabelWithInfo
                      label="Boot artifacts base URL"
                      hint={`Base URL where Agent-based installer boot artifacts are hosted for network boot installation.

**What is this:**
HTTP/HTTPS URL pointing to a directory containing RHCOS boot artifacts (kernel, initramfs, rootfs) that the installer downloads during network-based installation.

**When required:**
• Agent-based installation with **minimal ISO** (not full ISO)
• Network boot (PXE/iPXE) instead of ISO media
• Disconnected/airgap environments hosting artifacts on internal web server

**Why use minimal ISO/network boot:**
• Full ISOs embed all artifacts (~1GB+) - large and slow to distribute
• Minimal ISOs (~100MB) or network boot (PXE) are faster
• Network boot allows centralized artifact management

**Format:**
Complete HTTP or HTTPS URL ending at the directory containing artifacts (do NOT include filenames):
• https://mirror.example.com/openshift/agent-artifacts
• http://192.168.1.100/rhcos-boot

The installer appends filenames:
• agent.x86_64-vmlinuz (kernel)
• agent.x86_64-initrd.img (initramfs)
• agent.x86_64-rootfs.img (root filesystem)

**Setup steps:**
1. Download agent boot artifacts from Red Hat matching your OpenShift version
2. Place artifacts in web-accessible directory on your HTTP server
3. Verify artifacts are downloadable: 'curl <base-url>/agent.x86_64-vmlinuz' should succeed
4. Ensure web server is reachable from network where nodes boot (same subnet or routable)

**When to leave blank:**
When using full ISO (not minimal ISO or network boot)

**Example:**
https://mirror.internal.example.com/ocp-4.14/agent-boot`}
                      required={metaBootArtifacts?.required || isRequiredAgent("bootArtifactsBaseURL")}
                    >
                      <input
                        value={localBootArtifactsBaseURL}
                        onChange={(e) => setLocalBootArtifactsBaseURL(e.target.value)}
                        onBlur={() => updateInventory({ bootArtifactsBaseURL: localBootArtifactsBaseURL })}
                        placeholder="https://example.com/agent-artifacts or leave empty"
                      />
                    </FieldLabelWithInfo>
                  )}
                  {showComputeHyperthreading && (
                    <FieldLabelWithInfo
                      label="Compute hyperthreading (optional)"
                      hint={`Enable or disable CPU hyperthreading (simultaneous multithreading / SMT) on worker nodes.

**Default:**
Leave as 'Not set' to use platform defaults (hyperthreading **enabled** on most platforms)

**What is hyperthreading:**
Hyperthreading (Intel) or SMT (AMD) allows a single physical CPU core to run two threads simultaneously, doubling the logical CPU count. A 16-core server with hyperthreading shows 32 vCPUs to OpenShift.

**Benefits (enabled - default):**
• Higher throughput and better CPU utilization
• Most workloads (web apps, databases, microservices) benefit
• ~30-40% more CPU capacity vs disabled

**When to disable:**
1. **Latency-sensitive applications:** Telecom, industrial control, real-time workloads requiring predictable CPU scheduling
2. **High-performance computing (HPC):** Workloads with tight CPU affinity
3. **Security:** Mitigating speculative execution vulnerabilities (Spectre, Meltdown)
4. **Licensing:** Software licensed per logical CPU (disabling halves the count)

**Trade-off:**
Disabling reduces available CPU capacity by ~30-40% (lose half your vCPUs)

**Options:**
• **Enabled** (default): Hyperthreading on
• **Disabled**: Hyperthreading off

**Important:**
Applies to **ALL worker nodes** at install time. Cannot selectively disable per-node in install-config (requires post-install MachineConfig tuning).

**Example:**
Set 'Disabled' for low-latency telco workloads
Leave 'Not set' (enabled) for general clusters`}
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
                      hint={`Enable or disable CPU hyperthreading (simultaneous multithreading / SMT) on control plane nodes.

**Default:**
Leave as 'Not set' to use platform defaults (hyperthreading **enabled** on most platforms)

**What is hyperthreading:**
Hyperthreading (Intel) or SMT (AMD) allows a single physical CPU core to run two threads simultaneously, doubling logical CPU count.

**Control plane workloads:**
Control plane runs etcd (distributed database), Kubernetes API server, scheduler, and controllers - all CPU-intensive services.

**Critical distinction:**
Control plane nodes are **MORE sensitive** to CPU performance than workers because etcd requires consistent low-latency CPU scheduling.

**Why disable on control plane:**

**1. etcd performance:**
etcd is extremely sensitive to CPU latency jitter. Hyperthreading can introduce unpredictable scheduling delays when both threads on a core are busy. Disabling gives etcd exclusive access to physical cores for more consistent latency.

**2. Security:**
Control plane runs privileged infrastructure components. Disabling hyperthreading mitigates speculative execution attacks (Spectre/Meltdown) that can leak secrets between threads on the same core.

**3. Real-time Kubernetes (telco/edge):**
Telco clusters often disable hyperthreading on control plane for 5G/MEC latency guarantees.

**Why keep enabled (default):**
For most clusters, the throughput benefit outweighs the latency penalty. Control plane nodes typically have 8+ physical cores, providing adequate performance even with hyperthreading variability.

**Options:**
• **Enabled** (default): Hyperthreading on
• **Disabled**: Hyperthreading off

**Can you mix?**
Yes - you can disable hyperthreading on control plane while keeping it enabled on workers (common for telco/edge clusters).

**Example:**
Set 'Disabled' for telco/edge with strict latency SLAs
Leave 'Not set' (enabled) for general-purpose clusters`}
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
                        hint={`Defines the baseline set of OpenShift capabilities (cluster features) enabled at installation time.

**Default:**
Leave as 'Not set' to use 'vCurrent' (all current-version capabilities enabled)

**What are capabilities:**
OpenShift 4.11+ uses a modular capability system to install minimal clusters (reduced footprint) by excluding optional components. Each capability represents a cluster feature: Console (web UI), Insights (telemetry), Marketplace (OperatorHub), NodeTuning (performance tuning).

**Options:**

**vCurrent (default):**
Enables all capabilities for your OpenShift version (full-featured cluster)

**v4.11 / v4.12 / etc.:**
Freezes capability set to a specific version (version-pinned deployments)

**None:**
Minimal cluster with ONLY core Kubernetes and OpenShift infrastructure (no console, no monitoring, no marketplace)

**When to use minimal (None):**
1. Edge deployments with severe resource constraints (single-node OpenShift on small hardware)
2. Airgap environments where mirroring all images is impractical
3. Security-hardened clusters requiring explicit control over every component
4. Development/testing where full features aren't needed

**Important:**
Starting with 'None' means features like web console and monitoring won't be available until you enable capabilities post-install (requires editing ClusterVersion object and mirroring additional images).

**Benefits of disabling:**
Reduces resource consumption (control plane CPU/memory) and simplifies airgap scenarios (fewer images to mirror).

**Adding individual capabilities:**
Use 'Additional enabled capabilities' field below to add specific capabilities on top of baseline.

**Recommendation:**
Most users should leave 'Not set' (vCurrent) unless you have specific minimal-cluster requirements.

**Example:**
Set 'None' for minimal edge nodes
Leave 'Not set' for normal clusters`}
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
                          value={localAdditionalEnabledCapabilities}
                          onChange={(e) => setLocalAdditionalEnabledCapabilities(e.target.value)}
                          onBlur={() => {
                            const raw = localAdditionalEnabledCapabilities.trim();
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
                      hint={`Configures CPU partitioning to isolate cluster infrastructure from application workloads.

**Default:**
Leave as 'Not set' or 'None' for standard clusters

**What is CPU partitioning:**
Reserves a dedicated set of CPU cores for OpenShift infrastructure pods (kubelet, CRI-O, system services) while isolating application pods to separate cores. Prevents infrastructure overhead from interfering with latency-sensitive workloads.

**When to use:**
Required for **real-time workloads** demanding guaranteed CPU access:
• 5G/MEC (mobile edge computing)
• Industrial automation, robotics
• Telco edge Single-Node OpenShift (SNO) where infrastructure and apps share same host

**Options:**

**None (default):**
No CPU partitioning - all workloads share CPUs dynamically (standard behavior)

**AllNodes:**
Enable CPU partitioning on all nodes (or on SNO). Must also configure CPU manager policies and workload partitioning via Performance Add-on Operator post-install.

**How it works:**
When 'AllNodes' is set:
• OpenShift reserves CPUs for infrastructure (typically cores 0-1 on small nodes, 0-3 on larger nodes)
• App pods scheduled only on remaining 'isolated' cores using cgroups and CPU affinity
• You configure exact core split via Performance Profile or PerformanceAddon Operator after installation

**Prerequisites:**
1. **Sufficient cores:** Minimum 4 cores for SNO with partitioning (2 for infra, 2 for apps; more recommended)
2. **Hyperthreading:** Often disabled for predictable latency (see hyperthreading fields)
3. **Post-install config:** Must configure workload partitioning annotations and CPU manager policies

**Critical:**
⚠️ Setting this alone doesn't partition CPUs - it signals intent in install-config
⚠️ Actual partitioning requires post-install MachineConfig, Performance Add-on, and workload annotations
⚠️ This is **ADVANCED** configuration for telco/edge/real-time use cases

**Recommendation:**
Do not set unless you understand workload partitioning and have specific low-latency requirements.

**Example:**
Set 'AllNodes' for telco vRAN Single-Node OpenShift
Leave 'None' for general clusters`}
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
                  {showFeatureSet && (
                    <FieldLabelWithInfo
                      label="Feature set (optional)"
                      hint={`Enables pre-packaged feature gate sets for tech preview or latency-sensitive workloads.

**Default:**
Leave as 'Not set' for standard production clusters

**What is a feature set:**
OpenShift feature gates control access to features not enabled by default. Feature sets bundle multiple related feature gates for specific use cases without manually configuring each gate.

**When needed:**
• **Technology previews:** Test upcoming features in non-production environments
• **Custom features:** Enable/disable specific gates for specialized use cases
• **Latency mitigation:** Optimize for real-time workloads (telco, 5G, industrial)

**Options:**

**TechPreviewNoUpgrade:**
Enables all Technology Preview features. Useful for testing new capabilities before general availability.
⚠️ Cannot upgrade clusters with this set - requires clean reinstall when upgrading OpenShift
⚠️ Not supported in production

**CustomNoUpgrade:**
Allows manual selection of individual feature gates via 'featureGates' field (shows below when selected).
Use for enabling/disabling specific experimental or deprecated features.
⚠️ Cannot upgrade clusters with custom gates - requires clean reinstall

**LatencyMitigating:**
Optimizes cluster for low-latency workloads by reducing kubelet update frequency and API server coordination overhead.
Designed for telco/edge deployments (5G RAN, MEC) where consistent sub-millisecond latency matters.
✅ Supports cluster upgrades (unlike tech preview/custom sets)

**How it's used:**
Written to install-config.yaml as 'featureSet: TechPreviewNoUpgrade'. Controls which feature gates are enabled cluster-wide at installation time.

**Important:**
⚠️ TechPreview and Custom feature sets prevent upgrades - cluster must be reinstalled to upgrade OpenShift
⚠️ Tech preview features may be unstable, incomplete, or removed in future releases
⚠️ LatencyMitigating is production-supported but only needed for latency-critical use cases

**Example:**
Set 'TechPreviewNoUpgrade' to test upcoming features in lab environment
Set 'LatencyMitigating' for telco vRAN Single-Node OpenShift with real-time workloads
Leave 'Not set' for standard production clusters`}
                    >
                      <select
                        value={platformConfig.featureSet || ""}
                        onChange={(e) => updatePlatformConfig({ featureSet: e.target.value || undefined })}
                      >
                        <option value="">Not set</option>
                        {featureSetOptions.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </FieldLabelWithInfo>
                  )}
                  {showFeatureSet && platformConfig.featureSet === "CustomNoUpgrade" && (
                    <FieldLabelWithInfo
                      label="Feature gates (required when CustomNoUpgrade)"
                      hint={`Individual feature gate overrides when using CustomNoUpgrade feature set.

**What are feature gates:**
Feature gates are boolean flags that enable or disable specific OpenShift features at the cluster level. Gates control access to experimental, deprecated, or opt-in features not enabled by default.

**When needed:**
ONLY when featureSet is 'CustomNoUpgrade'. Specifies which gates to enable (true) or disable (false).

**Format:**
One per line in format: FeatureGateName=true or FeatureGateName=false

**How it's used:**
Written to install-config.yaml as array:
featureGates:
  - ExperimentalFeature=true
  - DeprecatedFeature=false

Controls cluster-wide feature availability at installation time.

**Important:**
⚠️ Clusters with custom feature gates CANNOT upgrade - requires clean reinstall to change OpenShift version
⚠️ Incorrect gate names are silently ignored - verify against OpenShift documentation
⚠️ Enabling experimental gates may cause instability
⚠️ This is ADVANCED configuration - only use if you understand specific gates needed

**Common feature gates:**
• **ExternalCloudProvider=true** - Use out-of-tree cloud provider (required for some platforms in 4.13+)
• **RotateKubeletServerCertificate=true** - Enable kubelet cert rotation
• **CSIMigration<Provider>=true** - Migrate volumes from in-tree to CSI drivers

**Example:**
ExternalCloudProvider=true
CSIMigrationAWS=true
TechPreviewFeature=false

**Reference:**
See OpenShift 4.20 documentation for full list of available feature gates and their effects.`}
                      required={platformConfig.featureSet === "CustomNoUpgrade"}
                    >
                      <textarea
                        value={platformConfig.featureGates || ""}
                        onChange={(e) => updatePlatformConfig({ featureGates: e.target.value || undefined })}
                        placeholder="ExternalCloudProvider=true&#10;CSIMigrationAWS=true"
                        rows="4"
                        style={{ width: "100%", fontFamily: "monospace", fontSize: "0.9rem" }}
                      />
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
