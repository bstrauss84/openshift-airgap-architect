/**
 * Builds install-config.yaml and agent-config.yaml from app state. Platform blocks: bare metal (IPI/UPI/agent), vSphere (IPI/UPI/agent), AWS GovCloud, Azure Government, Nutanix.
 * State keys follow camelCase (blueprint, globalStrategy, hostInventory, platformConfig, etc.). A2: bare-metal UPI emits platform = none for controlPlane/compute.
 */
import yaml from "js-yaml";
import { getTrustBundlePolicies } from "./versionPolicy.js";
import { buildFieldGuide } from "./fieldGuide/index.js";
import { resolveReducedBundleOrThrow } from "./trustAnalysis/index.js";
import { resolveSecretInclusion } from "./exportInclusion.js";

const normalizePullSecretString = (input) => {
  if (!input) return "{\"auths\":{}}";
  const raw = typeof input === "string" ? input : JSON.stringify(input);
  try {
    const parsed = JSON.parse(raw);
    const withAuths = parsed.auths ? parsed : { auths: parsed };
    return JSON.stringify(withAuths);
  } catch {
    return raw.trim();
  }
};

const buildRootDeviceHints = (node) => {
  const hints = {};
  if ((node.rootDevice || "").trim()) hints.deviceName = node.rootDevice.trim();
  if ((node.rootDeviceHintHctl || "").trim()) hints.hctl = node.rootDeviceHintHctl.trim();
  if ((node.rootDeviceHintModel || "").trim()) hints.model = node.rootDeviceHintModel.trim();
  if ((node.rootDeviceHintVendor || "").trim()) hints.vendor = node.rootDeviceHintVendor.trim();
  if ((node.rootDeviceHintSerialNumber || "").trim()) hints.serialNumber = node.rootDeviceHintSerialNumber.trim();
  if ((node.rootDeviceHintWwn || "").trim()) hints.wwn = node.rootDeviceHintWwn.trim();
  if (node.rootDeviceHintMinSizeGb != null && String(node.rootDeviceHintMinSizeGb).trim() !== "") {
    const minSize = Number(node.rootDeviceHintMinSizeGb);
    if (Number.isFinite(minSize)) hints.minSizeGigabytes = minSize;
  }
  if (node.rootDeviceHintRotational === true || node.rootDeviceHintRotational === false) {
    hints.rotational = node.rootDeviceHintRotational;
  } else if (typeof node.rootDeviceHintRotational === "string" && node.rootDeviceHintRotational.trim() !== "") {
    const normalized = node.rootDeviceHintRotational.trim().toLowerCase();
    if (normalized === "true" || normalized === "false") hints.rotational = normalized === "true";
  }
  return Object.keys(hints).length > 0 ? hints : undefined;
};

/** Dual-stack: clusterNetwork must have IPv4 then IPv6 entries when machineNetworkV6 is set (4.20 doc). */
const buildClusterNetwork = (networkingState, dualStack) => {
  if (!dualStack) {
    if (!networkingState.clusterNetworkCidr) return null;
    return [{ cidr: networkingState.clusterNetworkCidr, hostPrefix: Number(networkingState.clusterNetworkHostPrefix || 23) }];
  }
  const ipv4Cidr = networkingState.clusterNetworkCidr || "10.128.0.0/14";
  const ipv4Prefix = Number(networkingState.clusterNetworkHostPrefix || 23);
  const ipv6Cidr = networkingState.clusterNetworkCidrV6 || "fd01::/48";
  const ipv6Prefix = Number(networkingState.clusterNetworkHostPrefixV6 ?? 64);
  return [
    { cidr: ipv4Cidr, hostPrefix: ipv4Prefix },
    { cidr: ipv6Cidr, hostPrefix: ipv6Prefix }
  ];
};

/** Dual-stack: serviceNetwork must have IPv4 then IPv6 entries when machineNetworkV6 is set (4.20 doc). */
const buildServiceNetwork = (networkingState, dualStack) => {
  if (!dualStack) {
    return networkingState.serviceNetworkCidr ? [networkingState.serviceNetworkCidr] : null;
  }
  const ipv4 = networkingState.serviceNetworkCidr || "172.30.0.0/16";
  const ipv6 = networkingState.serviceNetworkCidrV6 || "fd02::/112";
  return [ipv4, ipv6];
};

const effectiveHostname = (node, baseDomain) => {
  let short = (node?.hostname || "").trim();
  if (!short) return short;
  const base = (baseDomain || "").trim();
  if (node?.hostnameUseFqdn && base) {
    // Avoid doubled baseDomain: if user typed FQDN (shortname.baseDomain), strip the suffix before appending
    const suffix = `.${base}`;
    if (short.endsWith(suffix)) short = short.slice(0, -suffix.length).trim() || short;
    return `${short}.${base}`;
  }
  return short;
};

// Deferred items are tracked in docs/BACKLOG_STATUS.md: featureSet, arbiter.*, credentialsMode/publish for bare metal (cloud-only in generate).
const buildInstallConfig = (state) => {
  const mirror = state.globalStrategy?.mirroring || {};
  const imageDigestSources = mirror.sources?.map((s) => ({
    source: s.source,
    mirrors: s.mirrors
  }));

  const nodes = (state.hostInventory?.nodes || []).slice();
  const sortedNodes = sortNodes(nodes);
  let masters = sortedNodes.filter((node) => node.role === "master").length || 0;
  let workers = sortedNodes.filter((node) => node.role === "worker").length || 0;
  const arbiters = sortedNodes.filter((node) => node.role === "arbiter").length || 0;
  const platformConfig = state.platformConfig || {};
  const isAwsNoHostInventory = state.blueprint?.platform === "AWS GovCloud" && ["IPI", "UPI"].includes(state.methodology?.method);
  const isNutanixIpi = state.blueprint?.platform === "Nutanix" && state.methodology?.method === "IPI";
  if (isAwsNoHostInventory) {
    const cp = Number(platformConfig.controlPlaneReplicas);
    const comp = Number(platformConfig.computeReplicas);
    if (Number.isInteger(cp) && cp >= 0) masters = cp;
    else if (masters === 0) masters = 3;
    if (Number.isInteger(comp) && comp >= 0) workers = comp;
  } else if (isNutanixIpi) {
    // Nutanix IPI has no host inventory; replicas come from Platform Specifics topology selection.
    const topology = platformConfig.nutanixTopology;
    if (topology === "sno") {
      masters = 1;
      workers = 0;
    } else if (topology === "compact") {
      masters = 3;
      workers = 0;
    } else if (topology === "ha") {
      masters = 3;
      workers = Number(platformConfig.computeReplicas) || 3;
    } else {
      // backward compat: fall back to explicit replica fields
      const cp = Number(platformConfig.controlPlaneReplicas);
      const comp = Number(platformConfig.computeReplicas);
      if (Number.isInteger(cp) && cp > 0) masters = cp;
      else masters = 3;
      if (Number.isInteger(comp) && comp >= 0) workers = comp;
      else workers = 3;
    }
  }
  const rendezvousIP = sortedNodes.find((node) => node.role === "master")?.primary?.ipv4Cidr?.split("/")?.[0] || "192.168.1.10";

  const networkingState = state.globalStrategy?.networking || {};
  const isAwsGovCloud = state.blueprint?.platform === "AWS GovCloud" && ["IPI", "UPI"].includes(state.methodology?.method);
  const isIbmCloudIpi = state.blueprint?.platform === "IBM Cloud" && state.methodology?.method === "IPI";
  /** AWS install-config supports IPv4 only (4.20); do not emit dual-stack for AWS. */
  const dualStack = !isAwsGovCloud && !isIbmCloudIpi && Boolean(networkingState.machineNetworkV6);
  const machineNetworks = dualStack
    ? [networkingState.machineNetworkV4, networkingState.machineNetworkV6].filter(Boolean).map((cidr) => ({ cidr }))
    : [networkingState.machineNetworkV4].filter(Boolean).map((cidr) => ({ cidr }));

  const inclusion = resolveSecretInclusion(state.exportOptions || {});
  const includePullSecret = Boolean(inclusion.pullSecret);
  const includePlatformCredentials = Boolean(inclusion.platformCredentials);
  const includeMirrorRegistryCredentials = Boolean(inclusion.mirrorRegistryCredentials);
  const includeBmcCredentials = Boolean(inclusion.bmcCredentials);
  const includeTrustBundleAndCertificates = Boolean(inclusion.trustBundleAndCertificates);
  const includeSshPublicKey = Boolean(inclusion.sshPublicKey);
  const includeProxyValues = Boolean(inclusion.proxyValues);
  const creds = state.credentials || {};
  const useAnonymousPullSecret = Boolean(
    creds.usingMirrorRegistry && creds.mirrorRegistryUnauthenticated
  );
  const registryFqdn = state.globalStrategy?.mirroring?.registryFqdn || "registry.local:5000";
  // "aWQ6cGFzcwo=" is base64 for "id:pass\n" — a placeholder credential for mirror registries
  // configured with anonymous/unauthenticated access. The registry accepts any auth value.
  const anonymousPullSecretPayload = JSON.stringify({
    auths: { [registryFqdn]: { auth: "aWQ6cGFzcwo=", email: "" } }
  });
  const mirrorHasContent = (creds.mirrorRegistryPullSecret || "").trim() && (creds.mirrorRegistryPullSecret || "").trim() !== "{\"auths\":{}}";
  const redHatHasContent = (creds.pullSecretPlaceholder || "").trim() && (creds.pullSecretPlaceholder || "").trim() !== "{\"auths\":{}}";
  const useMirrorPath = creds.usingMirrorRegistry || (!redHatHasContent && mirrorHasContent);
  const rawPullSecret = includePullSecret
    ? useAnonymousPullSecret
      ? anonymousPullSecretPayload
      : useMirrorPath
        ? (includeMirrorRegistryCredentials ? (creds.mirrorRegistryPullSecret || "{\"auths\":{}}") : "{\"auths\":{}}")
        : (creds.pullSecretPlaceholder || "{\"auths\":{}}")
    : "{\"auths\":{}}";
  const pullSecret = normalizePullSecretString(rawPullSecret);

  // Blueprint carry-over: architecture (x86_64→amd64, aarch64→arm64) and platform (Bare Metal→baremetal, etc.)
  const archForInstallConfig = (arch) => {
    if (!arch) return undefined;
    if (arch === "x86_64") return "amd64";
    if (arch === "aarch64") return "arm64";
    return arch; // ppc64le, s390x pass through
  };
  const platformKey = normalizePlatformKey(state.blueprint?.platform);

  const clusterNetwork = buildClusterNetwork(networkingState, dualStack);
  const serviceNetwork = buildServiceNetwork(networkingState, dualStack);

  // K follow-up: controlPlane.platform and compute[].platform are optional per 4.20 params. Emit only when
  // required: (1) bare-metal UPI → "none"; (2) AWS GovCloud IPI → object with aws.type when instance types set.
  const installConfig = {
    apiVersion: "v1",
    baseDomain: state.blueprint?.baseDomain || "example.com",
    metadata: { name: state.blueprint?.clusterName || "airgap-cluster" },
    compute: [
      {
        name: "worker",
        replicas: workers,
        ...(archForInstallConfig(state.blueprint?.arch) ? { architecture: archForInstallConfig(state.blueprint.arch) } : {})
      }
    ],
    controlPlane: {
      name: "master",
      replicas: masters || 3,
      ...(archForInstallConfig(state.blueprint?.arch) ? { architecture: archForInstallConfig(state.blueprint.arch) } : {})
    },
    networking: {
      networkType: networkingState.networkType || "OVNKubernetes",
      ...(machineNetworks.length ? { machineNetwork: machineNetworks } : {}),
      ...(clusterNetwork ? { clusterNetwork } : {}),
      ...(serviceNetwork ? { serviceNetwork } : {}),
      ...(networkingState.ovnInternalJoinSubnet
        ? { ovnKubernetesConfig: { ipv4: { internalJoinSubnet: networkingState.ovnInternalJoinSubnet } } }
        : {})
    },
    platform: {
      [normalizePlatformKey(state.blueprint?.platform)]: {}
    },
    pullSecret,
    sshKey: includeSshPublicKey ? (state.credentials?.sshPublicKey || "") : ""
  };

  if (state.blueprint?.platform === "Bare Metal") {
    const isUPI = state.methodology?.method === "UPI";
    const isAgentBased = state.methodology?.method === "Agent-Based Installer";
    const isSNO = masters === 1 && workers === 0;
    // 4.20 doc: "You must set the platform to none for a single-node cluster." Agent-based SNO → platform.none only.
    if (isUPI || (isAgentBased && isSNO)) {
      installConfig.platform = { none: {} };
      delete installConfig.controlPlane.platform;
      delete installConfig.compute[0].platform;
    } else if (isAgentBased) {
      // Bare Metal Agent-based multi-node: install-config has apiVIPs/ingressVIPs. Optional Day-2 hosts/provisioning
      // only when user enables includeBareMetalDay2InInstallConfig (doc: not used during initial provisioning).
      const hi = state.hostInventory || {};
      const parseVipList = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
      const useDualStackVips = Boolean(hi.enableIpv6);
      const apiVips = useDualStackVips
        ? [hi.apiVip, hi.apiVipV6].map((s) => (s || "").trim()).filter(Boolean)
        : parseVipList(hi.apiVip);
      const ingressVips = useDualStackVips
        ? [hi.ingressVip, hi.ingressVipV6].map((s) => (s || "").trim()).filter(Boolean)
        : parseVipList(hi.ingressVip);
      const baremetal = {};
      if (apiVips.length) baremetal.apiVIPs = apiVips;
      if (ingressVips.length) baremetal.ingressVIPs = ingressVips;
      const includeDay2 = Boolean(hi.includeBareMetalDay2InInstallConfig);
      if (includeDay2) {
        if (hi.provisioningNetwork && ["Managed", "Unmanaged", "Disabled"].includes(hi.provisioningNetwork)) {
          baremetal.provisioningNetwork = hi.provisioningNetwork;
        }
        if (hi.provisioningNetworkCIDR) baremetal.provisioningNetworkCIDR = hi.provisioningNetworkCIDR;
        if (hi.provisioningNetworkInterface) baremetal.provisioningNetworkInterface = hi.provisioningNetworkInterface;
        if (hi.provisioningDHCPRange) baremetal.provisioningDHCPRange = hi.provisioningDHCPRange;
        if (hi.clusterProvisioningIP) baremetal.clusterProvisioningIP = hi.clusterProvisioningIP;
        if (hi.provisioningMACAddress) baremetal.provisioningMACAddress = hi.provisioningMACAddress;
        const baremetalBaseDomain = state.blueprint?.baseDomain;
        const hosts = (hi.nodes || []).map((node) => {
          const host = {
            name: effectiveHostname(node, baremetalBaseDomain),
            role: node.role
          };
          const bmcAddr = (node.bmc?.address || "").trim();
          if (bmcAddr) {
            host.bmc = {
              address: bmcAddr,
              ...(includeBmcCredentials && node.bmc?.username ? { username: node.bmc.username } : {}),
              ...(includeBmcCredentials && node.bmc?.password ? { password: node.bmc.password } : {}),
              ...(node.bmc?.disableCertificateVerification === true ? { disableCertificateVerification: true } : {})
            };
          }
          if ((node.bmc?.bootMACAddress || "").trim()) host.bootMACAddress = (node.bmc.bootMACAddress || "").trim();
          const rdh217 = buildRootDeviceHints(node);
          if (rdh217) host.rootDeviceHints = rdh217;
          return host;
        });
        baremetal.hosts = hosts;
      }
      installConfig.platform.baremetal = baremetal;
    } else {
      // Bare Metal IPI: full platform.baremetal with apiVIPs, ingressVIPs, hosts, provisioning*.
      const parseVipList = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
      const apiVips = parseVipList(state.hostInventory?.apiVip);
      const ingressVips = parseVipList(state.hostInventory?.ingressVip);
      const baremetal = {};
      if (apiVips.length) baremetal.apiVIPs = apiVips;
      if (ingressVips.length) baremetal.ingressVIPs = ingressVips;
      const hi = state.hostInventory || {};
      if (hi.provisioningNetwork && ["Managed", "Unmanaged", "Disabled"].includes(hi.provisioningNetwork)) {
        baremetal.provisioningNetwork = hi.provisioningNetwork;
      }
      if (hi.provisioningNetworkCIDR) baremetal.provisioningNetworkCIDR = hi.provisioningNetworkCIDR;
      if (hi.provisioningNetworkInterface) baremetal.provisioningNetworkInterface = hi.provisioningNetworkInterface;
      if (hi.provisioningDHCPRange) baremetal.provisioningDHCPRange = hi.provisioningDHCPRange;
      if (hi.clusterProvisioningIP) baremetal.clusterProvisioningIP = hi.clusterProvisioningIP;
      if (hi.provisioningMACAddress) baremetal.provisioningMACAddress = hi.provisioningMACAddress;
      const baremetalBaseDomain = state.blueprint?.baseDomain;
      const hosts = (hi.nodes || []).map((node) => {
        const host = {
          name: effectiveHostname(node, baremetalBaseDomain),
          role: node.role
        };
        const bmcAddr = (node.bmc?.address || "").trim();
        if (bmcAddr) {
          host.bmc = {
            address: bmcAddr,
            ...(includeBmcCredentials && node.bmc?.username ? { username: node.bmc.username } : {}),
            ...(includeBmcCredentials && node.bmc?.password ? { password: node.bmc.password } : {}),
            ...(node.bmc?.disableCertificateVerification === true ? { disableCertificateVerification: true } : {})
          };
        }
        if ((node.bmc?.bootMACAddress || "").trim()) host.bootMACAddress = (node.bmc.bootMACAddress || "").trim();
        const rdh256 = buildRootDeviceHints(node);
        if (rdh256) host.rootDeviceHints = rdh256;
        return host;
      });
      baremetal.hosts = hosts;
      installConfig.platform.baremetal = baremetal;
    }
  }

  // VMware vSphere Agent-based SNO: platform.none (4.20 Agent doc — sample install-config note 11; validation §1.11).
  if (state.blueprint?.platform === "VMware vSphere" && state.methodology?.method === "Agent-Based Installer" && masters === 1 && workers === 0) {
    installConfig.platform = { none: {} };
    delete installConfig.controlPlane.platform;
    delete installConfig.compute[0].platform;
  }

  if (state.globalStrategy?.fips) {
    installConfig.fips = true;
  }

  // Gap remediation (Advanced): hyperthreading, capabilities, cpuPartitioningMode when state has them
  if (platformConfig.computeHyperthreading === "Enabled" || platformConfig.computeHyperthreading === "Disabled") {
    installConfig.compute[0].hyperthreading = platformConfig.computeHyperthreading;
  }
  if (platformConfig.controlPlaneHyperthreading === "Enabled" || platformConfig.controlPlaneHyperthreading === "Disabled") {
    installConfig.controlPlane.hyperthreading = platformConfig.controlPlaneHyperthreading;
  }
  if (platformConfig.baselineCapabilitySet || (Array.isArray(platformConfig.additionalEnabledCapabilities) && platformConfig.additionalEnabledCapabilities.length > 0)) {
    installConfig.capabilities = {};
    if (platformConfig.baselineCapabilitySet) installConfig.capabilities.baselineCapabilitySet = platformConfig.baselineCapabilitySet;
    if (Array.isArray(platformConfig.additionalEnabledCapabilities) && platformConfig.additionalEnabledCapabilities.length > 0) {
      installConfig.capabilities.additionalEnabledCapabilities = platformConfig.additionalEnabledCapabilities;
    }
  }
  if (platformConfig.cpuPartitioningMode === "None" || platformConfig.cpuPartitioningMode === "AllNodes") {
    installConfig.cpuPartitioningMode = platformConfig.cpuPartitioningMode;
  }

  // Agent-based 2 control plane + 1 arbiter (4.20 doc): controlPlane.replicas: 2, arbiter: { name: "arbiter", replicas: 1 }
  const isAgentBased = state.methodology?.method === "Agent-Based Installer";
  if (isAgentBased && (state.blueprint?.platform === "Bare Metal" || state.blueprint?.platform === "VMware vSphere") && masters === 2 && arbiters === 1) {
    installConfig.controlPlane.replicas = 2;
    installConfig.arbiter = { name: "arbiter", replicas: 1 };
  }

  if (state.globalStrategy?.proxyEnabled) {
    installConfig.proxy = {
      httpProxy: includeProxyValues ? state.globalStrategy?.proxies?.httpProxy : "",
      httpsProxy: includeProxyValues ? state.globalStrategy?.proxies?.httpsProxy : "",
      noProxy: includeProxyValues ? state.globalStrategy?.proxies?.noProxy : ""
    };
  }

  // Mirror-source key pivot: 4.14+ uses imageDigestSources; 4.13 and below use imageContentSources.
  const parsedVersion = String(state.blueprint?.version || "").match(/^(\d+)\.(\d+)/);
  const major = parsedVersion ? Number(parsedVersion[1]) : NaN;
  const minor = parsedVersion ? Number(parsedVersion[2]) : NaN;
  const useImageDigestSources = !Number.isFinite(major)
    ? true
    : (major > 4 || (major === 4 && Number.isFinite(minor) && minor >= 14));

  // Only emit mirror mapping into install-config when mirror registry is actually in use.
  if (useMirrorPath && Array.isArray(imageDigestSources) && imageDigestSources.length > 0) {
    if (useImageDigestSources) {
      installConfig.imageDigestSources = imageDigestSources;
    } else {
      installConfig.imageContentSources = imageDigestSources;
    }
  }

  if (state.blueprint?.platform === "AWS GovCloud" || state.blueprint?.platform === "Azure Government") {
    if (platformConfig.publish) {
      installConfig.publish = platformConfig.publish;
    }
    if (platformConfig.credentialsMode) {
      installConfig.credentialsMode = platformConfig.credentialsMode;
    }
  }
  // vSphere: Internal publish not supported (BZ#1953035). Emit External only.
  if (state.blueprint?.platform === "VMware vSphere" && ["IPI", "UPI", "Agent-Based Installer"].includes(state.methodology?.method)) {
    installConfig.publish = platformConfig.publish === "Internal" ? "External" : (platformConfig.publish || "External");
  }

  if (state.blueprint?.platform === "AWS GovCloud" && ["IPI", "UPI"].includes(state.methodology?.method)) {
    const aws = {};
    if (platformConfig.aws?.region) aws.region = platformConfig.aws.region;
    if (platformConfig.aws?.hostedZone) aws.hostedZone = platformConfig.aws.hostedZone;
    // hostedZoneRole: only when shared VPC (hosted zone in another account). Doc: "Use this parameter only when you are installing a cluster into a shared VPC."
    if (platformConfig.aws?.hostedZone && platformConfig.aws?.hostedZoneSharedVpc === true && (platformConfig.aws?.hostedZoneRole || "").trim()) {
      aws.hostedZoneRole = (platformConfig.aws.hostedZoneRole || "").trim();
    }
    if (platformConfig.aws?.lbType) aws.lbType = platformConfig.aws.lbType;
    // Official 4.20: platform.aws.vpc.subnets[] with id and optional roles[].type. Omit for installer-managed VPC.
    const awsSubnetEntries = platformConfig.aws?.subnetEntries;
    const awsSubnetsLegacy = platformConfig.aws?.subnets;
    if (platformConfig.aws?.vpcMode === "existing") {
      const list = Array.isArray(awsSubnetEntries) && awsSubnetEntries.length > 0
        ? awsSubnetEntries.filter((e) => (e?.id || "").trim())
        : (awsSubnetsLegacy || "").split(",").map((s) => ({ id: s.trim(), roles: [] })).filter((e) => e.id);
      if (list.length) {
        aws.vpc = {
          subnets: list.map((e) => {
            const id = (e?.id || e).toString().trim();
            const roles = Array.isArray(e?.roles) && e.roles.length > 0 ? e.roles : null;
            const out = { id };
            if (roles && roles.length > 0) out.roles = roles.map((r) => ({ type: r }));
            return out;
          })
        };
      }
    }
    if (platformConfig.aws?.amiId) aws.amiID = platformConfig.aws.amiId;
    if (Object.keys(aws).length) {
      installConfig.platform.aws = aws;
    }
    if (state.methodology?.method === "IPI" && (platformConfig.aws?.controlPlaneInstanceType || platformConfig.aws?.rootVolumeSize || platformConfig.aws?.rootVolumeType)) {
      const cpPlatform = typeof installConfig.controlPlane.platform === "object" && installConfig.controlPlane.platform !== null
        ? { ...installConfig.controlPlane.platform } : {};
      cpPlatform.aws = { ...(cpPlatform.aws || {}) };
      if (platformConfig.aws.controlPlaneInstanceType) cpPlatform.aws.type = platformConfig.aws.controlPlaneInstanceType;
      if (platformConfig.aws.rootVolumeSize != null || platformConfig.aws.rootVolumeType) {
        cpPlatform.aws.rootVolume = {};
        if (platformConfig.aws.rootVolumeSize != null && Number(platformConfig.aws.rootVolumeSize) > 0) cpPlatform.aws.rootVolume.size = Number(platformConfig.aws.rootVolumeSize);
        if ((platformConfig.aws.rootVolumeType || "").trim()) cpPlatform.aws.rootVolume.type = (platformConfig.aws.rootVolumeType || "").trim();
        if (Object.keys(cpPlatform.aws.rootVolume).length === 0) delete cpPlatform.aws.rootVolume;
      }
      installConfig.controlPlane.platform = cpPlatform;
    }
    if (state.methodology?.method === "IPI" && (platformConfig.aws?.workerInstanceType || platformConfig.aws?.rootVolumeSize || platformConfig.aws?.rootVolumeType)) {
      const compPlatform = typeof installConfig.compute[0].platform === "object" && installConfig.compute[0].platform !== null
        ? { ...installConfig.compute[0].platform } : {};
      compPlatform.aws = { ...(compPlatform.aws || {}) };
      if (platformConfig.aws.workerInstanceType) compPlatform.aws.type = platformConfig.aws.workerInstanceType;
      if (platformConfig.aws.rootVolumeSize != null || platformConfig.aws.rootVolumeType) {
        compPlatform.aws.rootVolume = {};
        if (platformConfig.aws.rootVolumeSize != null && Number(platformConfig.aws.rootVolumeSize) > 0) compPlatform.aws.rootVolume.size = Number(platformConfig.aws.rootVolumeSize);
        if ((platformConfig.aws.rootVolumeType || "").trim()) compPlatform.aws.rootVolume.type = (platformConfig.aws.rootVolumeType || "").trim();
        if (Object.keys(compPlatform.aws.rootVolume).length === 0) delete compPlatform.aws.rootVolume;
      }
      installConfig.compute[0].platform = compPlatform;
    }
  }

  // vSphere (IPI, UPI, Agent-based multi-node): (1) legacy path: flat vcenter/datacenter/... only → vcenters + one failureDomains entry; (2) failure-domains path: only vs.failureDomains (and optional vs.vcenters). Selected path only; no mixing.
  // vcenters[].port: 4.20 doc default 443 (installation-config-parameters-vsphere 9.1.4); emit 443 when not specified.
  // Agent-based SNO uses platform.none above; this block is skipped when masters===1 && workers===0 on vSphere Agent.
  const isVsphereAgentMultiNode =
    state.blueprint?.platform === "VMware vSphere" &&
    state.methodology?.method === "Agent-Based Installer" &&
    !(masters === 1 && workers === 0);
  if (
    state.blueprint?.platform === "VMware vSphere" &&
    (state.methodology?.method === "IPI" || state.methodology?.method === "UPI" || isVsphereAgentMultiNode)
  ) {
    const vsphere = {};
    const vs = platformConfig.vsphere || {};
    const isVsphereIpi = state.methodology?.method === "IPI";
    const isVsphereAgent = state.methodology?.method === "Agent-Based Installer";
    const useLegacyPlacement = vs.placementMode === "legacy";
    const explicitFailureDomains = !useLegacyPlacement && Array.isArray(vs.failureDomains) && vs.failureDomains.length > 0;
    const explicitVcenters = Array.isArray(vs.vcenters) && vs.vcenters.length > 0;

    if (useLegacyPlacement) {
      // Legacy path only: use flat fields; never read vs.failureDomains.
      const server = vs.vcenter;
      const datacenter = vs.datacenter;
      const cluster = vs.cluster;
      const datastore = vs.datastore;
      const network = vs.network;
      if (server && datacenter) {
        vsphere.vcenters = [
          {
            server,
            user: includePlatformCredentials ? vs.username || "" : "",
            password: includePlatformCredentials ? vs.password || "" : "",
            datacenters: [datacenter],
            port: 443
          }
        ];
      }
      if (server && datacenter && cluster && datastore && network) {
        vsphere.failureDomains = [
          {
            name: "fd-0",
            region: datacenter,
            zone: cluster,
            server,
            topology: {
              datacenter,
              computeCluster: cluster,
              datastore,
              networks: [network],
              ...(vs.folder ? { folder: vs.folder } : {}),
              ...(vs.resourcePool ? { resourcePool: vs.resourcePool } : {})
            }
          }
        ];
      }
    } else {
      // Failure-domains path only: use vs.failureDomains and/or vs.vcenters; never build from flat.
      if (explicitFailureDomains) {
        vsphere.failureDomains = vs.failureDomains.map((fd, i) => {
          const top = fd.topology || {};
          const networks = top.networks;
          const networksArray = (Array.isArray(networks) ? networks : (networks ? [networks] : [])).filter((n) => n != null && String(n).trim() !== "");
          const topology = {
            ...(top.datacenter != null && top.datacenter !== "" ? { datacenter: top.datacenter } : {}),
            ...(top.computeCluster != null && top.computeCluster !== "" ? { computeCluster: top.computeCluster } : {}),
            ...(top.datastore != null && top.datastore !== "" ? { datastore: top.datastore } : {}),
            ...(networksArray.length ? { networks: networksArray } : {}),
            ...(top.folder != null && top.folder !== "" ? { folder: top.folder } : {}),
            ...(top.resourcePool != null && top.resourcePool !== "" ? { resourcePool: top.resourcePool } : {}),
            ...(isVsphereIpi && top.template != null && String(top.template).trim() !== "" && !(vs.clusterOSImage && String(vs.clusterOSImage).trim() !== "") ? { template: String(top.template).trim() } : {})
          };
          return {
            name: fd.name != null && fd.name !== "" ? fd.name : `fd-${i}`,
            region: fd.region != null && fd.region !== "" ? fd.region : (top.datacenter || "datacenter"),
            zone: fd.zone != null && fd.zone !== "" ? fd.zone : (top.computeCluster || "cluster"),
            server: fd.server != null && fd.server !== "" ? fd.server : "",
            ...(Object.keys(topology).length ? { topology } : {})
          };
        }).filter((fd) => fd.server);

        if (explicitVcenters) {
          vsphere.vcenters = vs.vcenters.map((vc) => ({
            server: vc.server || "",
            user: includePlatformCredentials ? (vc.user || "") : "",
            password: includePlatformCredentials ? (vc.password || "") : "",
            datacenters: Array.isArray(vc.datacenters) ? vc.datacenters : (vc.datacenter != null ? [vc.datacenter] : []),
            port: Number(vc.port) || 443
          })).filter((vc) => vc.server && vc.datacenters.length > 0);
        } else {
          const serversSeen = new Set();
          const vcentersFromFd = [];
          for (const fd of vsphere.failureDomains) {
            if (fd.server && !serversSeen.has(fd.server)) {
              serversSeen.add(fd.server);
              const datacenter = fd.topology?.datacenter;
              vcentersFromFd.push({
                server: fd.server,
                user: includePlatformCredentials ? (vs.username || "") : "",
                password: includePlatformCredentials ? (vs.password || "") : "",
                datacenters: datacenter ? [datacenter] : [],
                port: 443
              });
            }
          }
          vsphere.vcenters = vcentersFromFd.filter((vc) => vc.datacenters.length > 0);
        }
      } else if (explicitVcenters) {
        // FD mode but no failure domains: emit only explicit vcenters (e.g. user will add FDs later or validation blocks).
        vsphere.vcenters = vs.vcenters.map((vc) => ({
          server: vc.server || "",
          user: includePlatformCredentials ? (vc.user || "") : "",
          password: includePlatformCredentials ? (vc.password || "") : "",
          datacenters: Array.isArray(vc.datacenters) ? vc.datacenters : (vc.datacenter != null ? [vc.datacenter] : []),
          port: Number(vc.port) || 443
        })).filter((vc) => vc.server && vc.datacenters.length > 0);
      }
    }

    if (vs.diskType && (vs.diskType === "thin" || vs.diskType === "thick" || vs.diskType === "eagerZeroedThick")) {
      vsphere.diskType = vs.diskType;
    }
    // clusterOSImage vs topology.template: mutually exclusive. When clusterOSImage is set, emit it and suppress template in FDs (already done in mapping above).
    if (isVsphereIpi && vs.clusterOSImage && String(vs.clusterOSImage).trim() !== "") {
      vsphere.clusterOSImage = String(vs.clusterOSImage).trim();
    }
    // Machine-pool (platform.vsphere): emit only when provided.
    if (vs.osDiskDiskSizeGB != null && Number.isFinite(Number(vs.osDiskDiskSizeGB))) {
      const gb = Number(vs.osDiskDiskSizeGB);
      if (gb > 0) {
        vsphere.osDisk = vsphere.osDisk || {};
        vsphere.osDisk.diskSizeGB = gb;
      }
    }
    if (vs.cpus != null && Number.isFinite(Number(vs.cpus)) && Number(vs.cpus) > 0) {
      vsphere.cpus = Number(vs.cpus);
    }
    if (vs.coresPerSocket != null && Number.isFinite(Number(vs.coresPerSocket)) && Number(vs.coresPerSocket) > 0) {
      vsphere.coresPerSocket = Number(vs.coresPerSocket);
    }
    if (vs.memoryMB != null && Number.isFinite(Number(vs.memoryMB)) && Number(vs.memoryMB) > 0) {
      vsphere.memoryMB = Number(vs.memoryMB);
    }
    if (isVsphereAgent) {
      const hi = state.hostInventory || {};
      const parseVipListVs = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
      const useDualStackVipsVs = Boolean(hi.enableIpv6);
      const apiFromHi = useDualStackVipsVs
        ? [hi.apiVip, hi.apiVipV6].map((s) => (s || "").trim()).filter(Boolean)
        : parseVipListVs(hi.apiVip);
      const ingressFromHi = useDualStackVipsVs
        ? [hi.ingressVip, hi.ingressVipV6].map((s) => (s || "").trim()).filter(Boolean)
        : parseVipListVs(hi.ingressVip);
      if (apiFromHi.length) vsphere.apiVIPs = apiFromHi;
      if (ingressFromHi.length) vsphere.ingressVIPs = ingressFromHi;
    } else if (isVsphereIpi) {
      if (Array.isArray(vs.apiVIPs) && vs.apiVIPs.length > 0) {
        vsphere.apiVIPs = vs.apiVIPs.filter((ip) => ip && String(ip).trim() !== "");
      }
      if (Array.isArray(vs.ingressVIPs) && vs.ingressVIPs.length > 0) {
        vsphere.ingressVIPs = vs.ingressVIPs.filter((ip) => ip && String(ip).trim() !== "");
      }
    }

    if (Object.keys(vsphere).length) {
      installConfig.platform.vsphere = vsphere;
    }

    // compute[0].platform.vsphere.zones and controlPlane.platform.vsphere.zones: only when ≥2 FDs and provided.
    const fdCount = vsphere.failureDomains?.length ?? 0;
    if (isVsphereIpi && fdCount >= 2) {
      if (Array.isArray(vs.computeZones) && vs.computeZones.length > 0) {
        const compPlatform = typeof installConfig.compute[0].platform === "object" && installConfig.compute[0].platform !== null ? { ...installConfig.compute[0].platform } : {};
        compPlatform.vsphere = compPlatform.vsphere || {};
        compPlatform.vsphere.zones = vs.computeZones.filter((z) => z != null && String(z).trim() !== "");
        if (compPlatform.vsphere.zones.length > 0) installConfig.compute[0].platform = compPlatform;
      }
      if (Array.isArray(vs.controlPlaneZones) && vs.controlPlaneZones.length > 0) {
        const cpPlatform = typeof installConfig.controlPlane.platform === "object" && installConfig.controlPlane.platform !== null ? { ...installConfig.controlPlane.platform } : {};
        cpPlatform.vsphere = cpPlatform.vsphere || {};
        cpPlatform.vsphere.zones = vs.controlPlaneZones.filter((z) => z != null && String(z).trim() !== "");
        if (cpPlatform.vsphere.zones.length > 0) installConfig.controlPlane.platform = cpPlatform;
      }
    }
  }

  if (state.blueprint?.platform === "Nutanix" && state.methodology?.method === "IPI") {
    installConfig.controlPlane.platform = { nutanix: {} };
    installConfig.compute[0].platform = { nutanix: {} };

    const nx = platformConfig.nutanix || {};
    const nutanix = {};
    const endpointAddr = (nx.endpoint || "").trim();
    if (endpointAddr) {
      const portNum = Number(nx.port != null && nx.port !== "" ? nx.port : 9440);
      nutanix.prismCentral = {
        endpoint: {
          address: endpointAddr,
          port: Number.isFinite(portNum) ? portNum : 9440
        },
        username: includePlatformCredentials ? nx.username || "" : "",
        password: includePlatformCredentials ? nx.password || "" : ""
      };
    }
    // subnetUUIDs: accept comma-separated list or single value (OCP 4.20 Nutanix params: plural array field).
    if (nx.subnet?.trim()) {
      nutanix.subnetUUIDs = nx.subnet.trim().split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (nx.cluster?.trim()) {
      nutanix.clusterName = nx.cluster.trim();
    }
    if (nx.storageContainer?.trim()) {
      nutanix.storageContainer = nx.storageContainer.trim();
    }
    const v4Api = (nx.apiVIP || "").trim();
    const v6Api = (nx.apiVIPV6 || "").trim();
    const v4Ing = (nx.ingressVIP || "").trim();
    const v6Ing = (nx.ingressVIPV6 || "").trim();
    const machineV6 = (networkingState.machineNetworkV6 || "").trim();
    const useDualStackVipLists = Boolean(machineV6) && (Boolean(v6Api) || Boolean(v6Ing));
    if (useDualStackVipLists) {
      const apiList = [v4Api, v6Api].filter(Boolean);
      const ingList = [v4Ing, v6Ing].filter(Boolean);
      if (apiList.length) nutanix.apiVIPs = apiList;
      if (ingList.length) nutanix.ingressVIPs = ingList;
    } else {
      if (v4Api) nutanix.apiVIP = v4Api;
      if (v4Ing) nutanix.ingressVIP = v4Ing;
    }
    if (Object.keys(nutanix).length) {
      installConfig.platform.nutanix = nutanix;
    }
    // Installing on Nutanix §1.4: CCO must run in Manual mode (always emit; do not use Mint/Passthrough for this platform).
    installConfig.publish = platformConfig.publish === "Internal" ? "External" : (platformConfig.publish || "External");
    installConfig.credentialsMode = "Manual";
  }

  if (state.blueprint?.platform === "Azure Government" && (state.methodology?.method === "IPI" || state.methodology?.method === "UPI")) {
    const azure = {};
    if (platformConfig.azure?.cloudName) azure.cloudName = platformConfig.azure.cloudName;
    if (platformConfig.azure?.region) azure.region = platformConfig.azure.region;
    if (platformConfig.azure?.resourceGroupName) azure.resourceGroupName = platformConfig.azure.resourceGroupName;
    if (platformConfig.azure?.baseDomainResourceGroupName) {
      azure.baseDomainResourceGroupName = platformConfig.azure.baseDomainResourceGroupName;
    }
    if (Object.keys(azure).length) {
      installConfig.platform.azure = azure;
    }
  }

  if (state.blueprint?.platform === "IBM Cloud" && state.methodology?.method === "IPI") {
    const ibmRaw = platformConfig.ibmcloud || {};
    const splitCsv = (value) => (value || "").split(",").map((s) => s.trim()).filter(Boolean);
    const ibm = {};
    const vpcMode = ibmRaw.vpcMode || "existing-vpc";
    if ((ibmRaw.region || "").trim()) ibm.region = ibmRaw.region.trim();
    if ((ibmRaw.resourceGroupName || "").trim()) ibm.resourceGroupName = ibmRaw.resourceGroupName.trim();
    if (vpcMode === "existing-vpc") {
      if ((ibmRaw.networkResourceGroupName || "").trim()) ibm.networkResourceGroupName = ibmRaw.networkResourceGroupName.trim();
      if ((ibmRaw.vpcName || "").trim()) ibm.vpcName = ibmRaw.vpcName.trim();
    }
    if ((ibmRaw.type || "").trim()) ibm.type = ibmRaw.type.trim();
    if (vpcMode === "existing-vpc") {
      const controlPlaneSubnets = splitCsv(ibmRaw.controlPlaneSubnets);
      if (controlPlaneSubnets.length) ibm.controlPlaneSubnets = controlPlaneSubnets;
      const computeSubnets = splitCsv(ibmRaw.computeSubnets);
      if (computeSubnets.length) ibm.computeSubnets = computeSubnets;
    }
    const dedicatedHostsProfile = (ibmRaw.dedicatedHostsProfile || "").trim();
    const dedicatedHostsName = (ibmRaw.dedicatedHostsName || "").trim();
    if (dedicatedHostsProfile || dedicatedHostsName) {
      ibm.dedicatedHosts = {};
      // Docs model dedicatedHosts.profile and dedicatedHosts.name as alternative paths.
      if (dedicatedHostsName) {
        ibm.dedicatedHosts.name = dedicatedHostsName;
      } else if (dedicatedHostsProfile) {
        ibm.dedicatedHosts.profile = dedicatedHostsProfile;
      }
    }
    if ((ibmRaw.defaultMachineBootVolumeEncryptionKey || "").trim()) {
      ibm.defaultMachinePlatform = {
        bootVolume: { encryptionKey: ibmRaw.defaultMachineBootVolumeEncryptionKey.trim() }
      };
    }
    if (Array.isArray(ibmRaw.serviceEndpoints)) {
      const endpoints = ibmRaw.serviceEndpoints
        .filter((ep) => (ep?.name || "").trim() && (ep?.url || "").trim())
        .map((ep) => ({ name: ep.name.trim(), url: ep.url.trim() }));
      if (endpoints.length) ibm.serviceEndpoints = endpoints;
    } else if (typeof ibmRaw.serviceEndpoints === "string" && ibmRaw.serviceEndpoints.trim()) {
      const endpoints = ibmRaw.serviceEndpoints
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const idx = line.indexOf("=");
          if (idx <= 0) return null;
          return { name: line.slice(0, idx).trim(), url: line.slice(idx + 1).trim() };
        })
        .filter((ep) => ep && ep.name && ep.url);
      if (endpoints.length) ibm.serviceEndpoints = endpoints;
    }
    installConfig.platform.ibmcloud = ibm;
    if ((ibmRaw.controlPlaneBootVolumeEncryptionKey || "").trim()) {
      installConfig.controlPlane.platform = installConfig.controlPlane.platform || {};
      installConfig.controlPlane.platform.ibmcloud = {
        bootVolume: { encryptionKey: ibmRaw.controlPlaneBootVolumeEncryptionKey.trim() }
      };
    }
    if ((ibmRaw.computeBootVolumeEncryptionKey || "").trim()) {
      installConfig.compute[0].platform = installConfig.compute[0].platform || {};
      installConfig.compute[0].platform.ibmcloud = {
        bootVolume: { encryptionKey: ibmRaw.computeBootVolumeEncryptionKey.trim() }
      };
    }
    installConfig.publish = platformConfig.publish || "External";
    // IBM Cloud install docs require CCO manual mode for installer-provisioned installs.
    installConfig.credentialsMode = "Manual";
  }

  const trust = state.trust || {};
  const trustBundle = resolveTrustBundleForGeneration(state);
  if (trustBundle && includeTrustBundleAndCertificates) {
    installConfig.additionalTrustBundle = trustBundle;
    const allowedPolicies = getTrustBundlePolicies(state.release?.patchVersion || "");
    const requested = trust.additionalTrustBundlePolicy;
    if (requested && allowedPolicies.includes(requested)) {
      installConfig.additionalTrustBundlePolicy = requested;
    } else if (allowedPolicies.length) {
      const defaultPolicy = trust.mirrorRegistryCaPem
        ? "Always"
        : state.globalStrategy?.proxyEnabled
          ? "Proxyonly"
          : "Always";
      installConfig.additionalTrustBundlePolicy = defaultPolicy;
    }
  }

  let out = yaml.dump(installConfig, { lineWidth: 120 });
  if (trustBundle && includeTrustBundleAndCertificates) {
    out = rewriteAdditionalTrustBundleToLiteralBlock(out, trustBundle);
  }
  return out;
};

const normalizePlatformKey = (platform) => {
  switch (platform) {
    case "Bare Metal":
      return "baremetal";
    case "VMware vSphere":
      return "vsphere";
    case "Nutanix":
      return "nutanix";
    case "AWS GovCloud":
      return "aws";
    case "Azure Government":
      return "azure";
    case "IBM Cloud":
      return "ibmcloud";
    default:
      return "none";
  }
};

const buildAgentConfig = (state) => {
  const baseDomain = state.blueprint?.baseDomain;
  const sortedNodes = sortNodes(state.hostInventory?.nodes || []);
  const rendezvousIP = sortedNodes.find((node) => node.role === "master")?.primary?.ipv4Cidr?.split("/")?.[0] || "192.168.1.10";
  const hosts = sortedNodes.map((node) => {
    const nmState = buildNmState({ ...node, inventoryEnableIpv6: state.hostInventory?.enableIpv6 });
    const interfaces = collectPhysicalInterfaces(node);
    return {
      hostname: effectiveHostname(node, baseDomain),
      role: node.role,
      interfaces,
      rootDeviceHints: buildRootDeviceHints(node),
      networkConfig: nmState
    };
  });

  const additionalNTPSources = normalizeNtpServers(state.globalStrategy?.ntpServers);
  const bootArtifactsBaseURL = (state.hostInventory?.bootArtifactsBaseURL || "").trim();

  const minimalISO = state.hostInventory?.minimalISO === true;
  const agentConfig = {
    apiVersion: "v1beta1",
    kind: "AgentConfig",
    metadata: { name: state.blueprint?.clusterName || "agent-cluster" },
    rendezvousIP,
    ...(additionalNTPSources.length > 0 ? { additionalNTPSources } : {}),
    ...(bootArtifactsBaseURL ? { bootArtifactsBaseURL } : {}),
    ...(minimalISO ? { minimalISO: true } : {}),
    hosts
  };

  return yaml.dump(agentConfig, { lineWidth: 120 });
};

const buildChronyConfig = (servers) => {
  const lines = [
    "# Managed by OpenShift Airgap Architect",
    "# Chrony configuration generated from Global Strategy NTP settings"
  ];
  servers.forEach((server) => {
    lines.push(`server ${server} iburst`);
  });
  lines.push("driftfile /var/lib/chrony/drift");
  lines.push("makestep 1.0 3");
  lines.push("rtcsync");
  lines.push("logdir /var/log/chrony");
  return `${lines.join("\n")}\n`;
};

const buildNtpMachineConfig = (servers, role) => {
  const chrony = buildChronyConfig(servers);
  const source = `data:text/plain;charset=utf-8,${encodeURIComponent(chrony)}`;
  return {
    apiVersion: "machineconfiguration.openshift.io/v1",
    kind: "MachineConfig",
    metadata: {
      name: `99-chrony-ntp-${role}`,
      labels: {
        "machineconfiguration.openshift.io/role": role
      }
    },
    spec: {
      config: {
        ignition: { version: "3.2.0" },
        storage: {
          files: [
            {
              path: "/etc/chrony.conf",
              mode: 420,
              overwrite: true,
              contents: { source }
            }
          ]
        }
      }
    }
  };
};

const normalizeNtpServers = (ntpServers) => {
  if (Array.isArray(ntpServers)) return ntpServers.map((s) => String(s).trim()).filter(Boolean);
  if (typeof ntpServers === "string") return ntpServers.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
};

const buildNtpMachineConfigs = (state) => {
  const servers = normalizeNtpServers(state.globalStrategy?.ntpServers);
  if (!servers.length) return {};
  return {
    "99-chrony-ntp-master.yaml": yaml.dump(buildNtpMachineConfig(servers, "master"), { lineWidth: 120 }),
    "99-chrony-ntp-worker.yaml": yaml.dump(buildNtpMachineConfig(servers, "worker"), { lineWidth: 120 })
  };
};

const extractPemBlocks = (pem) => {
  if (!pem) return [];
  const normalized = (typeof pem === "string" ? pem : "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const matches = normalized.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (!matches) return [];
  return matches.map((block) => block.trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
};

const buildEffectiveTrustBundle = (trust) => {
  const mirrorBlocks = extractPemBlocks(trust.mirrorRegistryCaPem);
  const proxyBlocks = extractPemBlocks(trust.proxyCaPem);
  if (!mirrorBlocks.length && !proxyBlocks.length) return "";
  const merged = Array.from(new Set([...mirrorBlocks, ...proxyBlocks]));
  return merged.join("\n\n");
};

const resolveTrustBundleForGeneration = (state) => {
  const trust = state.trust || {};
  const mode = trust.bundleSelectionMode || "original";
  if (mode !== "reduced") {
    return buildEffectiveTrustBundle(trust);
  }
  const reduced = resolveReducedBundleOrThrow(state);
  return reduced.bundle;
};

/**
 * Rewrite additionalTrustBundle in dumped install-config YAML to use literal block scalar (|)
 * so PEM certs render as readable multi-line blocks instead of folded single-line output.
 * js-yaml dump() uses folded style (>-) for long multi-line strings, which collapses newlines.
 * @param {string} yamlString - Full install-config YAML from yaml.dump()
 * @param {string} trustBundle - Raw PEM bundle string (with \n between certs)
 * @returns {string} YAML with additionalTrustBundle as literal block
 */
function rewriteAdditionalTrustBundleToLiteralBlock(yamlString, trustBundle) {
  const lines = yamlString.split("\n");
  const keyPattern = /^additionalTrustBundle\s*:/;
  const idx = lines.findIndex((line) => keyPattern.test(line));
  if (idx === -1) return yamlString;
  let endIdx = idx + 1;
  while (endIdx < lines.length && (lines[endIdx].startsWith(" ") || lines[endIdx].startsWith("\t") || lines[endIdx].trim() === "")) {
    endIdx++;
  }
  const literalContent = trustBundle
    .split("\n")
    .map((line) => (line.length ? `  ${line}` : "  "))
    .join("\n");
  const before = lines.slice(0, idx).join("\n");
  const after = endIdx < lines.length ? lines.slice(endIdx).join("\n") : "";
  const middle = `additionalTrustBundle: |\n${literalContent}`;
  return [before, middle, after].filter(Boolean).join("\n");
}

const buildNmState = (node) => {
  const enableIpv6 = Boolean(node?.enableIpv6 || node?.inventoryEnableIpv6);
  const config = {
    interfaces: [],
    routes: { config: [] },
    "dns-resolver": { config: { server: [], search: [] } }
  };
  const dnsServers = (node.dnsServers || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (dnsServers.length) {
    config["dns-resolver"].config.server = dnsServers;
  }
  if (node.dnsSearch) {
    config["dns-resolver"].config.search = node.dnsSearch
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  const toNumber = (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const next = Number(value);
    return Number.isNaN(next) ? undefined : next;
  };

  const addIpConfig = (iface, mode, addrV4, prefixV4, addrV6, prefixV6) => {
    if (mode === "dhcp") {
      iface.ipv4 = { enabled: true, dhcp: true };
    } else if (addrV4) {
      iface.ipv4 = { enabled: true, dhcp: false, address: [{ ip: addrV4, prefixLength: prefixV4 }] };
    } else {
      iface.ipv4 = { enabled: false };
    }
    if (enableIpv6 && addrV6) {
      iface.ipv6 = { enabled: true, dhcp: false, address: [{ ip: addrV6, prefixLength: prefixV6 }] };
    } else {
      iface.ipv6 = { enabled: false };
    }
  };

  const primary = node.primary || {};
  const primaryIfaceName = getPrimaryInterfaceName(primary);
  const primaryIpv4 = primary.ipv4Cidr?.split("/")?.[0];
  const primaryIpv4Prefix = Number(primary.ipv4Cidr?.split("/")?.[1] || 24);
  const primaryIpv6 = primary.ipv6Cidr?.split("/")?.[0];
  const primaryIpv6Prefix = Number(primary.ipv6Cidr?.split("/")?.[1] || 64);

  if (primary.mode === "static" && primary.ipv4Gateway) {
    config.routes.config.push({
      destination: "0.0.0.0/0",
      "next-hop-address": primary.ipv4Gateway,
      "next-hop-interface": primaryIfaceName,
      "table-id": 254
    });
  }
  if (enableIpv6 && primary.mode === "static" && primary.ipv6Gateway) {
    config.routes.config.push({
      destination: "::/0",
      "next-hop-address": primary.ipv6Gateway,
      "next-hop-interface": primaryIfaceName,
      "table-id": 254
    });
  }

  const extraRoutes = primary.advanced?.routes || [];
  extraRoutes.forEach((route) => {
    if (!route?.destination || !route?.nextHopAddress) return;
    config.routes.config.push({
      destination: route.destination,
      "next-hop-address": route.nextHopAddress,
      "next-hop-interface": route.nextHopInterface || primaryIfaceName,
      "table-id": 254
    });
  });

  const addEthernet = (name, mtu, sriov) => {
    const entry = { name, type: "ethernet", state: "up" };
    if (mtu) entry.mtu = mtu;
    if (sriov) entry.sriov = sriov;
    config.interfaces.push(entry);
    return entry;
  };

  const addBond = (bond, mtu) => {
    const entry = {
      name: bond.name || "bond0",
      type: "bond",
      state: "up",
      linkAggregation: {
        mode: bond.mode || "active-backup",
        options: { miimon: "100" },
        port: (bond.slaves || []).map((slave) => slave.name).filter(Boolean)
      },
      ipv4: { enabled: false },
      ipv6: { enabled: false }
    };
    if (mtu) entry.mtu = mtu;
    config.interfaces.push(entry);
    return entry;
  };

  const addVlan = (vlan, mtu) => {
    const baseIface = vlan.baseIface;
    const id = Number(vlan.id);
    const name = vlan.name || (baseIface && vlan.id ? `${baseIface}.${vlan.id}` : "");
    const entry = {
      name,
      type: "vlan",
      state: "up",
      vlan: { baseIface, id }
    };
    if (mtu) entry.mtu = mtu;
    config.interfaces.push(entry);
    return entry;
  };

  const baseMtu = toNumber(primary.advanced?.mtu);
  const vlanMtu = toNumber(primary.advanced?.vlanMtu);
  const sriovEnabled = primary.advanced?.sriov?.enabled && toNumber(primary.advanced?.sriov?.totalVfs);
  const sriovConfig = sriovEnabled ? { "total-vfs": toNumber(primary.advanced?.sriov?.totalVfs) } : null;

  if (primary.type === "ethernet") {
    const eth = addEthernet(primary.ethernet?.name || "eth0", baseMtu, sriovConfig);
    addIpConfig(eth, primary.mode, primaryIpv4, primaryIpv4Prefix, primaryIpv6, primaryIpv6Prefix);
  }

  if (primary.type === "bond") {
    (primary.bond?.slaves || []).forEach((slave) => {
      addEthernet(slave.name, baseMtu, sriovConfig);
    });
    const bond = addBond(primary.bond || {}, baseMtu);
    addIpConfig(bond, primary.mode, primaryIpv4, primaryIpv4Prefix, primaryIpv6, primaryIpv6Prefix);
  }

  if (primary.type === "vlan-on-ethernet") {
    const eth = addEthernet(primary.ethernet?.name || "eth0", baseMtu, sriovConfig);
    const vlan = addVlan(
      { ...primary.vlan, baseIface: primary.vlan.baseIface || eth.name },
      vlanMtu
    );
    addIpConfig(vlan, primary.mode, primaryIpv4, primaryIpv4Prefix, primaryIpv6, primaryIpv6Prefix);
  }

  if (primary.type === "vlan-on-bond") {
    (primary.bond?.slaves || []).forEach((slave) => {
      addEthernet(slave.name, baseMtu, sriovConfig);
    });
    const bond = addBond(primary.bond || {}, baseMtu);
    const vlan = addVlan(
      { ...primary.vlan, baseIface: primary.vlan.baseIface || bond.name },
      vlanMtu
    );
    addIpConfig(vlan, primary.mode, primaryIpv4, primaryIpv4Prefix, primaryIpv6, primaryIpv6Prefix);
  }

  const vrfEnabled = primary.advanced?.vrf?.enabled;
  if (vrfEnabled) {
    const ports = (primary.advanced?.vrf?.ports || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const vrfPorts = ports.length ? ports : [primaryIfaceName];
    config.interfaces.push({
      name: primary.advanced?.vrf?.name || "vrf0",
      type: "vrf",
      state: "up",
      vrf: {
        "route-table-id": toNumber(primary.advanced?.vrf?.tableId) || 100,
        port: vrfPorts
      }
    });
  }

  const extraIfaces = node.additionalInterfaces || [];
  extraIfaces.forEach((iface) => {
    const mode = iface.mode || "dhcp";
    const ipv4Addr = iface.ipv4Cidr?.split("/")?.[0];
    const ipv4Prefix = Number(iface.ipv4Cidr?.split("/")?.[1] || 24);
    const ipv6Addr = iface.ipv6Cidr?.split("/")?.[0];
    const ipv6Prefix = Number(iface.ipv6Cidr?.split("/")?.[1] || 64);
    const baseMtu = toNumber(iface.advanced?.mtu);
    const vlanMtu = toNumber(iface.advanced?.vlanMtu);
    const sriovEnabled = iface.advanced?.sriov?.enabled && toNumber(iface.advanced?.sriov?.totalVfs);
    const sriovConfig = sriovEnabled ? { "total-vfs": toNumber(iface.advanced?.sriov?.totalVfs) } : null;

    if (iface.type === "ethernet") {
      const eth = addEthernet(iface.ethernet?.name, baseMtu, sriovConfig);
      addIpConfig(eth, mode, ipv4Addr, ipv4Prefix, ipv6Addr, ipv6Prefix);
    }
    if (iface.type === "bond") {
      (iface.bond?.slaves || []).forEach((slave) => addEthernet(slave.name, baseMtu, sriovConfig));
      const bond = addBond(iface.bond || {}, baseMtu);
      addIpConfig(bond, mode, ipv4Addr, ipv4Prefix, ipv6Addr, ipv6Prefix);
    }
    if (iface.type === "vlan-on-ethernet") {
      const eth = addEthernet(iface.ethernet?.name, baseMtu, sriovConfig);
      const vlan = addVlan(
        { ...iface.vlan, baseIface: iface.vlan.baseIface || eth.name },
        vlanMtu
      );
      addIpConfig(vlan, mode, ipv4Addr, ipv4Prefix, ipv6Addr, ipv6Prefix);
    }
    if (iface.type === "vlan-on-bond") {
      (iface.bond?.slaves || []).forEach((slave) => addEthernet(slave.name, baseMtu, sriovConfig));
      const bond = addBond(iface.bond || {}, baseMtu);
      const vlan = addVlan(
        { ...iface.vlan, baseIface: iface.vlan.baseIface || bond.name },
        vlanMtu
      );
      addIpConfig(vlan, mode, ipv4Addr, ipv4Prefix, ipv6Addr, ipv6Prefix);
    }
  });

  return config;
};

const getPrimaryInterfaceName = (primary) => {
  if (!primary) return "eth0";
  if (primary.type === "vlan-on-ethernet" || primary.type === "vlan-on-bond") {
    const base = primary.vlan?.baseIface
      || (primary.type === "vlan-on-bond" ? primary.bond?.name : primary.ethernet?.name)
      || "eth0";
    return primary.vlan?.name || (primary.vlan?.id ? `${base}.${primary.vlan.id}` : base);
  }
  if (primary.type === "bond") return primary.bond?.name || "bond0";
  return primary.ethernet?.name || "eth0";
};

const collectPhysicalInterfaces = (node) => {
  const interfaces = [];
  const primary = node.primary || {};
  if (primary.type === "bond" || primary.type === "vlan-on-bond") {
    (primary.bond?.slaves || []).forEach((slave) => {
      if (slave.name && slave.macAddress) {
        interfaces.push({ name: slave.name, macAddress: slave.macAddress });
      }
    });
  } else {
    if (primary.ethernet?.name && primary.ethernet?.macAddress) {
      interfaces.push({ name: primary.ethernet.name, macAddress: primary.ethernet.macAddress });
    }
  }
  const extraIfaces = node.additionalInterfaces || [];
  extraIfaces.forEach((iface) => {
    if (iface.type === "bond" || iface.type === "vlan-on-bond") {
      (iface.bond?.slaves || []).forEach((slave) => {
        if (slave.name && slave.macAddress) {
          interfaces.push({ name: slave.name, macAddress: slave.macAddress });
        }
      });
    } else if (iface.ethernet?.name && iface.ethernet?.macAddress) {
      interfaces.push({ name: iface.ethernet.name, macAddress: iface.ethernet.macAddress });
    }
  });
  return interfaces;
};

const ROLE_ORDER = { master: 0, arbiter: 1, worker: 2 };
const sortNodes = (nodes) => {
  return nodes.slice().sort((a, b) => {
    const orderA = ROLE_ORDER[a.role] ?? 3;
    const orderB = ROLE_ORDER[b.role] ?? 3;
    if (orderA !== orderB) return orderA - orderB;
    const aMatch = a.hostname?.match(/-(\d+)$/);
    const bMatch = b.hostname?.match(/-(\d+)$/);
    if (aMatch && bMatch) return Number(aMatch[1]) - Number(bMatch[1]);
    return (a.hostname || "").localeCompare(b.hostname || "");
  });
};

const buildImageSetConfig = (state) => {
  const version = state.release?.patchVersion;
  const operators = state.operators?.selected || [];
  const cfg = state.imagesetConfig || {};
  const includeGraph = cfg.graph !== false;
  const additionalImages = (cfg.additionalImages || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const archiveSize = cfg.archiveSize ? Number(cfg.archiveSize) : null;

  const images = {
    apiVersion: "mirror.openshift.io/v2alpha1",
    kind: "ImageSetConfiguration",
    ...(archiveSize ? { archiveSize } : {}),
    mirror: {
      platform: {
        channels: [
          {
            name: `stable-${state.release?.channel}`,
            minVersion: version,
            maxVersion: version
          }
        ],
        ...(includeGraph ? { graph: true } : {})
      },
      operators: [],
      ...(additionalImages.length ? { additionalImages: additionalImages.map((name) => ({ name })) } : {})
    }
  };
  const byCatalog = new Map();
  for (const op of operators) {
    if (!byCatalog.has(op.catalogImage)) {
      byCatalog.set(op.catalogImage, []);
    }
    byCatalog.get(op.catalogImage).push({
      name: op.name,
      channels: [{ name: op.defaultChannel }]
    });
  }
  for (const [catalog, packages] of byCatalog.entries()) {
    images.mirror.operators.push({ catalog, packages });
  }
  return yaml.dump(images, { lineWidth: 120 });
};

const buildFieldManual = (state, docsLinks) => buildFieldGuide(state, docsLinks);

const _buildFieldManualLegacy = (state, docsLinks) => {
  const lines = [];
  const version = state.release?.patchVersion || "unknown";
  const channel = state.release?.channel ? `stable-${state.release.channel}` : "unknown";
  const connectivity = state.docs?.connectivity === "jumpbox" ? "Disconnected with Jumpbox" : "Fully Disconnected";
  const platformConfig = state.platformConfig || {};
  const trustBundle = buildEffectiveTrustBundle(state.trust || {});
  const trustStatus = trustBundle
    ? state.trust?.mirrorRegistryCaPem && state.trust?.proxyCaPem
      ? "Both"
      : state.trust?.mirrorRegistryCaPem
        ? "Registry CA only"
        : "Proxy CA only"
    : "None";
  const creds = state.credentials || {};
  const pullSecretPlaceholder = creds.pullSecretPlaceholder || "";
  const mirrorRegistryPullSecret = creds.mirrorRegistryPullSecret || "";
  const redHatHasContent = pullSecretPlaceholder.trim() && pullSecretPlaceholder.trim() !== "{\"auths\":{}}";
  const mirrorHasContent = mirrorRegistryPullSecret.trim() && mirrorRegistryPullSecret.trim() !== "{\"auths\":{}}";
  // Match backend gating for when mirror mapping is actually in use.
  const useMirrorPathForManual = Boolean(creds.usingMirrorRegistry) || (!redHatHasContent && mirrorHasContent);

  const mirrorRegistry = useMirrorPathForManual ? (state.globalStrategy?.mirroring?.registryFqdn || "unknown") : null;
  const mirrorPrivate = state.trust?.mirrorRegistryUsesPrivateCa ? "Yes" : "No";
  const proxyEnabled = state.globalStrategy?.proxyEnabled ? "Enabled" : "Disabled";
  const ntpServers = normalizeNtpServers(state.globalStrategy?.ntpServers);
  const outputPath = state.mirrorWorkflow?.archivePath || state.mirrorWorkflow?.outputPath || "/data/oc-mirror/archives";
  const workspacePath = state.mirrorWorkflow?.workspacePath || "/data/oc-mirror/workspace";
  const operators = state.operators?.selected || [];
  const operatorList = operators.length
    ? operators.map((op) => `${op.name} (${op.defaultChannel || "unknown"})`).join(", ")
    : "None";
  const catalogs = Array.from(new Set(operators.map((op) => op.catalogImage || op.catalog))).filter(Boolean);
  const clusterName = state.blueprint?.clusterName || "airgap-cluster";
  const baseDomain = state.blueprint?.baseDomain || "example.com";
  const apiVipRaw = (state.hostInventory?.apiVip || "").trim();
  const ingressVipRaw = (state.hostInventory?.ingressVip || "").trim();
  const apiVip = apiVipRaw ? apiVipRaw.split(",").map((x) => x.trim()).filter(Boolean)[0] : "<api-vip>";
  const ingressVip = ingressVipRaw ? ingressVipRaw.split(",").map((x) => x.trim()).filter(Boolean)[0] : "<ingress-vip>";
  const installDir = "./install-assets";
  const imageSetName = "imageset-config.yaml";

  lines.push(`# OpenShift Airgap Architect Field Manual`);
  if (state.exportOptions?.draftMode) {
    lines.push(``);
    lines.push(`> DRAFT / NOT VALIDATED: Warnings were present at export time. Review before use.`);
  }
  lines.push(``);
  lines.push(`## Assumptions (auto-generated from this run)`);
  lines.push(`- OpenShift version: ${version} (channel: ${channel})`);
  lines.push(`- Platform: ${state.blueprint?.platform || "unknown"}`);
  lines.push(`- Install method: ${state.methodology?.method || "unknown"}`);
  lines.push(`- Connectivity scenario: ${connectivity}`);
  lines.push(`- FIPS mode: ${state.globalStrategy?.fips ? "Enabled" : "Disabled"}`);
  lines.push(`- Proxy: ${proxyEnabled}`);
  if (state.globalStrategy?.proxyEnabled) {
    lines.push(`- HTTP proxy: ${state.globalStrategy?.proxies?.httpProxy || "not set"}`);
    lines.push(`- HTTPS proxy: ${state.globalStrategy?.proxies?.httpsProxy || "not set"}`);
    lines.push(`- No proxy: ${state.globalStrategy?.proxies?.noProxy || "not set"}`);
  }
  lines.push(
    useMirrorPathForManual
      ? `- Mirror registry: ${mirrorRegistry} (private CA: ${mirrorPrivate})`
      : `- Mirror registry: not used`
  );
  lines.push(`- Trust bundle configured: ${trustStatus}`);
  lines.push(`- NTP servers: ${ntpServers.length ? ntpServers.join(", ") : "Not configured"}`);
  lines.push(`- Chosen catalogs: ${catalogs.length ? catalogs.join(", ") : "None"}`);
  lines.push(`- Operator strategy: ${operatorList}`);
  lines.push(``);
  lines.push(`## Overview`);
  lines.push(`This runbook is tailored to your selected platform, methodology, and release. It assumes a disconnected workflow with oc-mirror v2 and a user-managed mirror registry.`);
  lines.push(``);
  lines.push(`## [HIGH SIDE] Prerequisites and validation`);
  lines.push(`Run these checks before starting the install. If DNS records do not exist yet (e.g. you will create them later), the installer may stop at 97–98% and wait; creating the records within the allowed time will allow it to complete.`);
  lines.push(``);
  lines.push(`1. DNS checks (verify resolution):`);
  lines.push(`   - dig +short api.${clusterName}.${baseDomain}  # expect ${apiVip}`);
  lines.push(`   - dig +short api-int.${clusterName}.${baseDomain}  # expect ${apiVip}`);
  lines.push(`   - dig +short test.apps.${clusterName}.${baseDomain}  # expect ${ingressVip} (wildcard *.apps)`);
  lines.push(`2. VIP reachability (bare metal; ensure load balancer or DNS points here):`);
  lines.push(`   - ping -c3 ${apiVip}`);
  lines.push(`   - ping -c3 ${ingressVip}`);
  lines.push(`3. Time sync (all nodes and installer host must be in sync):`);
  lines.push(`   - timedatectl status`);
  lines.push(`   - chronyc sources -v`);
  if (state.globalStrategy?.fips) {
    lines.push(`4. FIPS prerequisites (FIPS is enabled for this run):`);
    lines.push(`   - On each node that will join the cluster, run: fips-mode-setup --check`);
    lines.push(`   - FIPS mode must be enabled before installation. See OpenShift docs for enabling FIPS on RHEL.`);
  }
  if (state.blueprint?.platform === "Bare Metal") {
    lines.push(`${state.globalStrategy?.fips ? "5" : "4"}. Bare metal / DHCP (if using DHCP for node addressing):`);
    lines.push(`   - Ensure DHCP reservations or static DHCP entries exist for each control plane and worker so hostnames and IPs are stable.`);
  }
  if (ntpServers.length) {
    const ntpNum = state.globalStrategy?.fips ? (state.blueprint?.platform === "Bare Metal" ? "6" : "5") : (state.blueprint?.platform === "Bare Metal" ? "5" : "4");
    lines.push(`${ntpNum}. Configure NTP (RHEL 9+):`);
    lines.push(`   - sudo sed -i 's/^pool/#pool/' /etc/chrony.conf`);
    ntpServers.forEach((server) => {
      lines.push(`   - echo "server ${server} iburst" | sudo tee -a /etc/chrony.conf`);
    });
    lines.push(`   - sudo systemctl restart chronyd`);
    lines.push(`   - Optional: apply generated MachineConfigs after install:`);
    lines.push(`     - oc create -f 99-chrony-ntp-master.yaml`);
    lines.push(`     - oc create -f 99-chrony-ntp-worker.yaml`);
  }
  lines.push(``);
  if (proxyEnabled === "Enabled") {
    lines.push(`## [LOW SIDE] Proxy environment (if required)`);
    lines.push(`export http_proxy=${state.globalStrategy?.proxies?.httpProxy || ""}`);
    lines.push(`export https_proxy=${state.globalStrategy?.proxies?.httpsProxy || ""}`);
    lines.push(`export no_proxy=${state.globalStrategy?.proxies?.noProxy || ""}`);
    lines.push(``);
  }
  lines.push(`## [LOW SIDE] Obtain tools and set credentials`);
  lines.push(`1. Download oc, oc-mirror, and openshift-install for ${version}.`);
  lines.push(`2. Verify checksums and place binaries on a host with access to upstream registries.`);
  lines.push(`3. Confirm tool versions match the selected release: oc version --client; oc-mirror version; openshift-install version`);
  lines.push(`4. Export your Red Hat pull secret:`);
  lines.push(`   - export REGISTRY_AUTH_FILE=</path/to/pull-secret.json>`);
  lines.push(``);
  lines.push(`## [LOW SIDE] Create oc-mirror archive`);
  lines.push(`1. Place ${imageSetName} in a working directory.`);
  lines.push(`2. Run oc-mirror v2 (mirror-to-disk):`);
  lines.push(`   - oc-mirror --config ${imageSetName} file://${outputPath} --v2`);
  lines.push(`3. Create checksums for transfer:`);
  lines.push(`   - cd ${outputPath} && find . -type f -maxdepth 2 -print0 | xargs -0 sha256sum > SHA256SUMS.txt`);
  lines.push(``);
  if (connectivity === "Disconnected with Jumpbox") {
    lines.push(`## [JUMPBOX] Transfer and verify artifacts`);
    lines.push(`1. Transfer ${outputPath} and SHA256SUMS.txt to the jumpbox.`);
    lines.push(`2. Verify checksums:`);
    lines.push(`   - (cd ${outputPath} && sha256sum -c SHA256SUMS.txt)`);
    lines.push(`3. Transfer the archive and checksums to the high side.`);
    lines.push(``);
  } else {
    lines.push(`## [LOW SIDE] Transfer across the air gap`);
    lines.push(`1. Transfer ${outputPath} and SHA256SUMS.txt using approved media.`);
    lines.push(`2. Verify checksums on the high side.`);
    lines.push(``);
  }
  if (useMirrorPathForManual) {
    lines.push(`## [HIGH SIDE] Mirror registry`);
    lines.push(`1. Install and run a local registry (mirror-registry or your approved registry procedure).`);
    lines.push(`2. Ensure the registry DNS name matches: ${mirrorRegistry}`);
    lines.push(`3. Ensure registry credentials are available to oc-mirror on the high side.`);
    lines.push(``);
    lines.push(`## [HIGH SIDE] oc-mirror v2 workflow`);
    lines.push(`1. Push mirrored content into the registry (disk-to-mirror):`);
    lines.push(`   - oc-mirror --config ${imageSetName} --from ${outputPath} docker://${mirrorRegistry} --v2`);
    lines.push(`2. Apply the generated cluster-resources manifests after install:`);
    lines.push(`   - oc apply -f ${workspacePath}/working-dir/cluster-resources`);
    lines.push(``);
  } else {
    lines.push(`## [HIGH SIDE] Mirror registry`);
    lines.push(`Mirror registry is not used for this run (mirroring configuration is omitted).`);
    lines.push(``);
  }
  lines.push(`## [HIGH SIDE] Trust and certificates`);
  if (trustBundle) {
    lines.push(`1. Install the trust bundle on all hosts that access the registry/proxy:`);
    lines.push(`   - sudo cp ca-bundle.pem /etc/pki/ca-trust/source/anchors/`);
    lines.push(`   - sudo update-ca-trust`);
  } else {
    lines.push(`No additional trust bundle configured. Self-signed registries or intercepting proxies will fail unless trust is added.`);
  }
  lines.push(``);
  lines.push(`## [HIGH SIDE] Installer workflow`);
  lines.push(`1. Place install-config.yaml in ${installDir}.`);
  if (state.methodology?.method === "Agent-Based Installer") {
    lines.push(`2. Place agent-config.yaml in ${installDir}.`);
    lines.push(`3. Create the agent ISO:`);
    lines.push(`   - openshift-install agent create image --dir ${installDir}`);
    lines.push(`4. Boot nodes from the ISO and monitor the cluster creation:`);
    lines.push(`   - openshift-install agent wait-for install-complete --dir ${installDir}`);
  } else {
    lines.push(`2. Create the cluster (IPI/UPI):`);
    lines.push(`   - openshift-install create cluster --dir ${installDir}`);
    lines.push(`3. Monitor progress:`);
    lines.push(`   - openshift-install wait-for install-complete --dir ${installDir}`);
  }
  lines.push(`4. Post-install sanity checks:`);
  lines.push(`   - oc whoami`);
  lines.push(`   - oc get nodes -o wide`);
  lines.push(`   - oc get clusterversion`);
  lines.push(`   - oc get co  # cluster operators; ensure critical ones are Available`);
  lines.push(`   - oc get pods -A | head -20  # optional: spot-check pod status`);
  lines.push(``);
  if (state.blueprint?.platform === "Bare Metal") {
    lines.push(`## [HIGH SIDE] Bare metal prerequisites`);
    lines.push(`Ensure DNS, NTP, and DHCP (or static addressing) are configured for all nodes.`);
    lines.push(`Validate MAC addresses, root device hints, and layer-2 reachability before booting agents.`);
    if (state.methodology?.method === "IPI") {
      lines.push(`For IPI bare metal, ensure BMC addresses and boot MACs are correct for each host.`);
    }
    lines.push(`Bare metal scenario mapping:`);
    lines.push(`- IPI: set provisioningNetwork (Managed/Unmanaged/Disabled), BMCs, and boot MACs in install-config; use mirrored content for disconnected.`);
    lines.push(`- UPI: provision nodes, DNS, and load balancers yourself; use agent-config or install-config as applicable.`);
    lines.push(`- Agent-based: host inventory (NMState, root device), agent ISO; disconnected requires mirrored registry.`);
  }
  if (state.blueprint?.platform === "VMware vSphere") {
    lines.push(`## [HIGH SIDE] vSphere prerequisites`);
    lines.push(`Ensure vCenter connectivity, required permissions, and resource pools are prepared.`);
    if (state.methodology?.method === "IPI") {
      lines.push(`Confirm vCenter server, datacenter, cluster, datastore, and network values match the install-config.`);
    }
    lines.push(`vSphere scenario mapping:`);
    lines.push(`- IPI: vCenter, datacenter, cluster, datastore, network (and optional folder/resourcePool); disconnected uses mirrored content.`);
    lines.push(`- UPI: provision VMs and infrastructure yourself; follow platform-agnostic UPI and vSphere UPI docs.`);
    if (state.methodology?.method === "Agent-Based Installer") {
      lines.push(`- Agent-based: you provide VMs; install-config uses platform.vsphere (placement, apiVIPs/ingressVIPs for multi-node; platform none for single-node) plus agent-config for hosts/NMState; boot the agent ISO per the Agent-based Installer guide.`);
    }
  }
  if (state.blueprint?.platform === "Nutanix") {
    lines.push(`## [HIGH SIDE] Nutanix prerequisites`);
    lines.push(`Ensure Prism Central access, subnet configuration, and required image storage are available.`);
    if (state.methodology?.method === "IPI") {
      lines.push(`Confirm Prism Central endpoint, credentials, and subnet UUIDs are correct.`);
    }
    lines.push(`Nutanix scenario mapping:`);
    lines.push(`- IPI: Prism Central endpoint, subnet UUID(s), cluster name; disconnected install uses mirrored content.`);
    lines.push(`- Review Nutanix install-config parameters and disconnected installation docs for your version.`);
  }
  if (state.blueprint?.platform === "AWS GovCloud") {
    lines.push(`## [HIGH SIDE] AWS GovCloud prerequisites`);
    lines.push(`Validate IAM roles, VPC networking, and service endpoints for restricted access.`);
    if (state.methodology?.method === "IPI") {
      lines.push(`Confirm AWS region, hosted zone, and load balancer settings in the install-config.`);
      if (platformConfig.aws?.controlPlaneInstanceType || platformConfig.aws?.workerInstanceType) {
        lines.push(`Confirm control plane and worker instance types align with capacity requirements.`);
      }
      if (platformConfig.aws?.amiId) {
        lines.push(`A custom RHCOS AMI ID is set; verify it matches the selected OpenShift version and region.`);
      } else {
        lines.push(`If installing in a secret region, specify a custom RHCOS AMI ID before installation.`);
      }
    }
    lines.push(`AWS scenario mapping:`);
    lines.push(`- Existing VPC: provide target subnets (platform.aws.vpc.subnets[].id; optional roles per 4.20).`);
    lines.push(`- Private cluster: set publish=Internal and ensure private DNS for api/apps.`);
    lines.push(`- Government/secret region: set a custom RHCOS AMI ID (platform.aws.amiID).`);
    lines.push(`- No Route 53: leave hostedZone empty and manage DNS records manually.`);
    lines.push(`- Restricted network: use mirrored content, a reachable registry, and the disconnected workflow.`);
  }
  if (state.blueprint?.platform === "Azure Government") {
    lines.push(`## [HIGH SIDE] Azure Government prerequisites`);
    lines.push(`Validate the subscription, service principals, and network policies for Government clouds.`);
    if (state.methodology?.method === "IPI") {
      lines.push(`Confirm cloudName, region, and resource group names in the install-config.`);
    }
    lines.push(`Azure Government scenario mapping:`);
    lines.push(`- IPI: cloudName (e.g. AzureUSGovernmentCloud), region, resourceGroupName, baseDomainResourceGroupName; publish/credentialsMode for private.`);
    lines.push(`- UPI: provision VMs and networking yourself; use Azure install-config parameters for platform.azure.`);
    lines.push(`- Restricted network: use mirrored content and a reachable registry; follow disconnected workflow.`);
  }
  if (state.methodology?.method === "Agent-Based Installer") {
    lines.push(``);
    lines.push(`## [HIGH SIDE] Agent-based installer guidance`);
    lines.push(`Use the generated agent-config.yaml and ensure NMState matches your host networking.`);
  }
  if (state.methodology?.method === "UPI") {
    lines.push(``);
    lines.push(`## [HIGH SIDE] UPI guidance`);
    lines.push(`Provision infrastructure, DNS, and load balancers before running the installer.`);
  }
  lines.push(``);
  lines.push(`## Relevant Official Documentation`);
  if (!docsLinks || docsLinks.length === 0) {
    lines.push(`- Documentation links could not be validated. Use the "Update Docs Links" action to refresh.`);
  } else {
    const unverified = docsLinks.filter((link) => link.validated === false);
    if (unverified.length) {
      lines.push(`- Some links could not be validated automatically. Please verify before use.`);
    }
    docsLinks.forEach((link) => {
      const suffix = link.validated === false ? " (unverified)" : "";
      lines.push(`- [${link.label}](${link.url})${suffix}`);
    });
  }
  lines.push(``);
  return lines.join("\n");
};

export { buildInstallConfig, buildAgentConfig, buildImageSetConfig, buildFieldManual, buildNtpMachineConfigs };
