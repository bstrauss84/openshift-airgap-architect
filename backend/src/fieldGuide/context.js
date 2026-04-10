/**
 * buildContext(state) → flat template variable map
 * Extracts and normalizes all values needed for compartment rendering.
 */

const normalizeNtpServers = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
};

const buildContext = (state) => {
  const blueprint = state.blueprint || {};
  const release = state.release || {};
  const methodology = state.methodology || {};
  const globalStrategy = state.globalStrategy || {};
  const proxies = globalStrategy.proxies || {};
  const mirroring = globalStrategy.mirroring || {};
  const hostInventory = state.hostInventory || {};
  const operators = state.operators || {};
  const trust = state.trust || {};
  const mirrorWorkflow = state.mirrorWorkflow || {};
  const credentials = state.credentials || {};
  const platformConfig = state.platformConfig || {};
  const docs = state.docs || {};
  const statusModel = state.statusModel || {};
  const inclusion = state.exportOptions?.inclusion || {};

  const version = release.patchVersion || "4.20.0";
  const versionParts = version.split(".");
  const versionMajorMinor = versionParts.length >= 2 ? `${versionParts[0]}.${versionParts[1]}` : "4.20";
  const channel = release.channel ? `stable-${release.channel}` : `stable-${versionMajorMinor}`;

  const clusterName = blueprint.clusterName || "airgap-cluster";
  const baseDomain = blueprint.baseDomain || "example.com";
  const clusterFqdn = `${clusterName}.${baseDomain}`;

  const platform = blueprint.platform || "Bare Metal";
  const methodName = methodology.method || "Agent-Based Installer";

  const connectivityRaw = docs.connectivity || "fully-disconnected";
  const connectivity = connectivityRaw === "jumpbox" ? "jumpbox" : "fully-disconnected";
  const connectivityLabel = connectivity === "jumpbox" ? "Disconnected with Jumpbox" : "Fully Disconnected";

  const apiVipRaw = (hostInventory.apiVip || "").trim();
  const ingressVipRaw = (hostInventory.ingressVip || "").trim();
  const apiVip = apiVipRaw ? apiVipRaw.split(",").map((x) => x.trim()).filter(Boolean)[0] : "<api-vip>";
  const ingressVip = ingressVipRaw ? ingressVipRaw.split(",").map((x) => x.trim()).filter(Boolean)[0] : "<ingress-vip>";

  const pullSecretPlaceholder = credentials.pullSecretPlaceholder || "";
  const mirrorRegistryPullSecret = credentials.mirrorRegistryPullSecret || "";
  const redHatHasContent = pullSecretPlaceholder.trim() && pullSecretPlaceholder.trim() !== '{"auths":{}}';
  const mirrorHasContent = mirrorRegistryPullSecret.trim() && mirrorRegistryPullSecret.trim() !== '{"auths":{}}';
  const usingMirrorRegistry = Boolean(credentials.usingMirrorRegistry) || (!redHatHasContent && mirrorHasContent);

  const registryFqdn = mirroring.registryFqdn || "registry.local:5000";
  const archivePath = mirrorWorkflow.archivePath || mirrorWorkflow.outputPath || "/data/oc-mirror/archives";
  const workspacePath = mirrorWorkflow.workspacePath || "/data/oc-mirror/workspace";

  const proxyEnabled = Boolean(globalStrategy.proxyEnabled);
  const httpProxy = proxies.httpProxy || "";
  const httpsProxy = proxies.httpsProxy || "";
  const noProxy = proxies.noProxy || "";

  const fips = Boolean(globalStrategy.fips);

  const trustBundle = Boolean(trust.mirrorRegistryCaPem || trust.proxyCaPem);
  const placeholderCount = Object.keys(state.placeholders?.entries || {}).length;
  const reviewNeeded = Boolean(statusModel.reviewNeeded) || placeholderCount > 0;
  const finalizable = statusModel.finalizable !== false && !reviewNeeded;

  const ntpServersList = normalizeNtpServers(globalStrategy.ntpServers);
  const ntpServers = ntpServersList.join(", ");

  // vSphere
  const vsphereConfig = platformConfig.vsphere || platformConfig.vSphere || {};
  const vcenter = vsphereConfig.vcenter || vsphereConfig.vCenter || "<vcenter-fqdn>";
  const datacenter = vsphereConfig.datacenter || "<datacenter>";
  const vsphereCluster = vsphereConfig.cluster || "<vsphere-cluster>";
  const datastore = vsphereConfig.datastore || "<datastore>";
  const vsphereNetwork = vsphereConfig.network || vsphereConfig.defaultNetwork || "<vm-network>";

  // Nutanix
  const nutanixConfig = platformConfig.nutanix || {};
  const nutanixEndpoint = nutanixConfig.endpoint || nutanixConfig.prismCentral || "<prism-central-fqdn>";
  const nutanixCluster = nutanixConfig.cluster || nutanixConfig.clusterName || "<nutanix-cluster>";
  const nutanixSubnet = nutanixConfig.subnet || nutanixConfig.subnetUUID || "<subnet-uuid>";

  // AWS
  const awsConfig = platformConfig.aws || {};
  const awsRegion = awsConfig.region || blueprint.awsRegion || "us-gov-east-1";

  // Azure
  const azureConfig = platformConfig.azure || {};
  const azureCloudName = azureConfig.cloudName || "AzureUSGovernmentCloud";
  const azureRegion = azureConfig.region || "usgovvirginia";

  const selectedOperators = operators.selected || [];
  const hasOperators = selectedOperators.length > 0;
  const operatorList = hasOperators
    ? selectedOperators.map((op) => `${op.name} (${op.defaultChannel || "unknown"})`).join(", ")
    : "None";

  const installDir = "./install-assets";
  const imageSetConfig = "imageset-config.yaml";
  const inclusionSummary = {
    pullSecret: inclusion.pullSecret === true ? "included" : "omitted",
    platformCredentials: inclusion.platformCredentials === true ? "included" : "omitted",
    mirrorRegistryCredentials: inclusion.mirrorRegistryCredentials === true ? "included" : "omitted",
    bmcCredentials: inclusion.bmcCredentials === true ? "included" : "omitted",
    trustBundleAndCertificates: inclusion.trustBundleAndCertificates !== false ? "included" : "omitted",
    sshPublicKey: inclusion.sshPublicKey !== false ? "included" : "omitted",
    proxyValues: inclusion.proxyValues !== false ? "included" : "omitted"
  };

  // Derive a simple scenario ID
  const platformSlug = {
    "VMware vSphere": "vsphere",
    "Bare Metal": "baremetal",
    Nutanix: "nutanix",
    "AWS GovCloud": "aws-govcloud",
    "Azure Government": "azure-gov",
  }[platform] || "baremetal";

  const methodSlug = {
    IPI: "ipi",
    UPI: "upi",
    "Agent-Based Installer": "agent",
  }[methodName] || "agent";

  const scenarioId = `${platformSlug}-${methodSlug}`;

  return {
    version,
    versionMajorMinor,
    channel,
    clusterName,
    baseDomain,
    clusterFqdn,
    platform,
    methodology: methodName,
    connectivity,
    connectivityLabel,
    scenarioId,
    apiVip,
    ingressVip,
    usingMirrorRegistry,
    registryFqdn,
    archivePath,
    workspacePath,
    imageSetConfig,
    proxyEnabled,
    httpProxy,
    httpsProxy,
    noProxy,
    fips,
    trustBundleConfigured: trustBundle,
    ntpServers,
    ntpServersList,
    vcenter,
    datacenter,
    vsphereCluster,
    datastore,
    vsphereNetwork,
    nutanixEndpoint,
    nutanixCluster,
    nutanixSubnet,
    awsRegion,
    azureCloudName,
    azureRegion,
    hasOperators,
    operatorList,
    installDir,
    draftMode: Boolean(state.exportOptions?.draftMode),
    placeholderCount,
    reviewNeeded,
    finalizable,
    inclusionSummary
  };
};

export { buildContext };
