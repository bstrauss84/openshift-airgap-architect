/**
 * OpenShift Airgap Architect - Scenario Summary Helpers
 *
 * Helpers for building live-updating scenario summary dropdown content.
 * Only includes information from tabs the user has explicitly confirmed
 * (clicked Proceed) AND that are not flagged "needs review."
 *
 * Security: NEVER includes sensitive data (pull secrets, credentials, SSH keys, certificates).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { validateStep } from "./validation.js";
import { getScenarioId } from "./hostInventoryV2Helpers.js";

/**
 * Check if a tab is confirmed and clean (safe to include in summary).
 * A tab is confirmed if:
 * 1. User has visited it (state.ui?.visitedSteps?.[tabId])
 * 2. Tab is not flagged for review (state.reviewFlags?.[tabId] !== true)
 * 3. Validation passes (no blocking errors for that step)
 */
export function isTabConfirmed(state, tabId) {
  if (!state) return false;

  // Check if visited
  const visited = state.ui?.visitedSteps?.[tabId];
  if (!visited) return false;

  // Check if flagged for review
  const needsReview = state.reviewFlags?.[tabId];
  if (needsReview) return false;

  // Check validation
  const validation = validateStep(state, tabId);
  if (validation?.errors?.length > 0) return false;

  return true;
}

/**
 * Get list of all confirmed tab IDs.
 * Returns array of tab IDs that are visited, not flagged, and validation passes.
 */
export function getConfirmedTabs(state) {
  const tabs = [
    'blueprint',
    'methodology',
    'identity-access',
    'networking-v2',
    'connectivity-mirroring',
    'trust-proxy',
    'platform-specifics',
    'hosts-inventory',
    'operators'
  ];

  return tabs.filter(tabId => isTabConfirmed(state, tabId));
}

/**
 * Build Identity & Security summary section.
 * Only call if identity-access tab is confirmed.
 */
export function buildIdentitySummary(state) {
  if (!state) return null;

  const items = [];

  // FIPS mode (from globalStrategy, NOT credentials)
  const fipsEnabled = Boolean(state.globalStrategy?.fips);
  items.push(`FIPS mode: ${fipsEnabled ? 'Enabled' : 'Disabled'}`);

  // SSH key (presence only, not the actual key)
  const sshConfigured = Boolean(state.credentials?.sshPublicKey);
  items.push(`SSH key: ${sshConfigured ? 'Configured' : 'Not configured'}`);

  // Pull secret source (but never the actual secret)
  const pullSecretSource = getPullSecretSource(state);
  if (pullSecretSource) {
    items.push(`Pull secret source: ${pullSecretSource}`);
  }

  return items.length > 0 ? items : null;
}

/**
 * Determine pull secret source (Red Hat, Mirror registry, or both).
 * NEVER includes actual pull secret content.
 * Respects credentials.usingMirrorRegistry flag to determine primary source.
 */
function getPullSecretSource(state) {
  const usingMirror = Boolean(state.credentials?.usingMirrorRegistry);
  const hasRedHat = Boolean(state.blueprint?.blueprintPullSecretEphemeral || state.credentials?.pullSecretPlaceholder);
  const hasMirror = Boolean(state.credentials?.mirrorRegistryPullSecret);

  // If explicitly using mirror registry, show that as primary
  if (usingMirror && hasMirror) {
    return hasRedHat ? 'Mirror registry + Red Hat' : 'Mirror registry';
  }

  // Otherwise, traditional logic
  if (hasRedHat && hasMirror) return 'Red Hat + Mirror registry';
  if (hasRedHat) return 'Red Hat';
  if (hasMirror) return 'Mirror registry';
  return null;
}

/**
 * Build Networking summary section.
 * Only call if networking tab is confirmed.
 * Networking data is in globalStrategy.networking, NOT state.networking!
 */
export function buildNetworkingSummary(state) {
  const networking = state?.globalStrategy?.networking;
  const hostInventory = state?.hostInventory;

  if (!networking && !hostInventory) return null;

  const items = [];

  // Network topology
  const topology = getNetworkTopology(state);
  if (topology) {
    items.push(`Topology: ${topology}`);
  }

  // Machine network CIDR (V4)
  if (networking?.machineNetworkV4) {
    items.push(`Machine network: ${networking.machineNetworkV4}`);
  }

  // Cluster network CIDR (V4)
  if (networking?.clusterNetworkCidr) {
    items.push(`Cluster network: ${networking.clusterNetworkCidr}`);
  }

  // Service network CIDR (V4)
  if (networking?.serviceNetworkCidr) {
    items.push(`Service network: ${networking.serviceNetworkCidr}`);
  }

  // Machine network V6 (if dual-stack)
  if (networking?.machineNetworkV6) {
    items.push(`Machine network (IPv6): ${networking.machineNetworkV6}`);
  }

  // API VIP (from hostInventory, not networking)
  const apiVip = hostInventory?.apiVip;
  if (apiVip) {
    items.push(`API VIP: ${apiVip}`);
  }

  // Ingress VIP (from hostInventory, not networking)
  const ingressVip = hostInventory?.ingressVip;
  if (ingressVip) {
    items.push(`Ingress VIP: ${ingressVip}`);
  }

  return items.length > 0 ? items : null;
}

/**
 * Determine network topology (Single-stack IPv4, Dual-stack, etc.).
 * Read from globalStrategy.networking, NOT state.networking!
 */
function getNetworkTopology(state) {
  const net = state?.globalStrategy?.networking;
  if (!net) return null;

  const hasV4 = Boolean(net.clusterNetworkCidr || net.machineNetworkV4);
  const hasV6 = Boolean(net.clusterNetworkCidrV6 || net.machineNetworkV6);

  if (hasV4 && hasV6) return 'Dual-stack (IPv4 + IPv6)';
  if (hasV6) return 'Single-stack IPv6';
  if (hasV4) return 'Single-stack IPv4';

  return null;
}

/**
 * Build Connectivity & Mirroring summary section.
 * Only call if connectivity-mirroring tab is confirmed.
 */
export function buildConnectivitySummary(state) {
  const items = [];

  // NTP servers count (from globalStrategy.ntpServers, not connectivity)
  const ntpServers = state.globalStrategy?.ntpServers;
  let ntpCount = 0;
  if (ntpServers) {
    if (Array.isArray(ntpServers)) {
      ntpCount = ntpServers.filter(s => String(s).trim()).length;
    } else if (typeof ntpServers === 'string') {
      ntpCount = ntpServers.split(',').filter(s => s.trim()).length;
    }
  }
  if (ntpCount > 0) {
    items.push(`NTP servers: ${ntpCount} configured`);
  }

  // Mirror registry (FQDN from globalStrategy.mirroring, never credentials)
  const registryFqdn = state.globalStrategy?.mirroring?.registryFqdn?.trim();
  const usingMirror = Boolean(state.credentials?.usingMirrorRegistry);
  if (usingMirror && registryFqdn) {
    const auth = state.credentials?.mirrorRegistryUnauthenticated ? 'anonymous' : 'authenticated';
    items.push(`Mirror registry: ${registryFqdn} (${auth})`);
  }

  return items.length > 0 ? items : null;
}

/**
 * Build Trust & Proxy summary section.
 * Only call if trust-proxy tab is confirmed.
 */
export function buildTrustProxySummary(state) {
  const items = [];

  // Proxy enabled (from globalStrategy, NOT strategy)
  const proxyEnabled = Boolean(state.globalStrategy?.proxyEnabled);
  if (proxyEnabled) {
    const proxyType = getProxyType(state);
    items.push(`Corporate proxy: Enabled${proxyType ? ` (${proxyType})` : ''}`);
  }

  // Trust bundle policy
  if (state.trust?.additionalTrustBundlePolicy) {
    items.push(`Trust bundle policy: ${state.trust.additionalTrustBundlePolicy}`);
  }

  // CA bundle counts (not the actual certificates)
  const bundleCounts = getCaBundleCounts(state);
  if (bundleCounts) {
    items.push(`CA bundles: ${bundleCounts}`);
  }

  return items.length > 0 ? items : null;
}

/**
 * Determine proxy type (HTTP, HTTPS, or both).
 * Read from globalStrategy.proxies, NOT strategy.
 */
function getProxyType(state) {
  const proxies = state.globalStrategy?.proxies || {};
  const hasHttp = Boolean(proxies.httpProxy);
  const hasHttps = Boolean(proxies.httpsProxy);

  if (hasHttp && hasHttps) return 'HTTP + HTTPS';
  if (hasHttps) return 'HTTPS';
  if (hasHttp) return 'HTTP';
  return null;
}

/**
 * Get CA bundle counts with sources.
 * NEVER includes actual certificate contents.
 * Matches Field Guide logic: trust.mirrorRegistryCaPem and trust.proxyCaPem
 */
function getCaBundleCounts(state) {
  const sources = [];

  // Mirror registry CA (from trust.mirrorRegistryCaPem, NOT credentials.mirrorRegistryCert)
  if (state.trust?.mirrorRegistryCaPem) {
    sources.push('mirror');
  }

  // Proxy CA (from trust.proxyCaPem or trust.additionalTrustBundle)
  if (state.trust?.proxyCaPem || state.trust?.additionalTrustBundle) {
    sources.push('proxy');
  }

  if (sources.length === 0) return null;

  const count = sources.length;
  const sourceList = sources.join(' + ');
  return `${count} configured (${sourceList})`;
}

/**
 * Build Platform Specifics summary section.
 * Only call if platform-specifics tab is confirmed.
 * Platform-dependent content.
 */
export function buildPlatformSummary(state) {
  const platform = state.blueprint?.platform;
  if (!platform) return null;

  const items = [];

  // vSphere
  if (platform === 'VMware vSphere') {
    if (state.platformSpecifics?.vcenter) {
      items.push(`vCenter: ${state.platformSpecifics.vcenter}`);
    }
    if (state.platformSpecifics?.datacenter) {
      items.push(`Datacenter: ${state.platformSpecifics.datacenter}`);
    }
    if (state.platformSpecifics?.cluster) {
      items.push(`Cluster: ${state.platformSpecifics.cluster}`);
    }
    if (state.platformSpecifics?.datastore) {
      items.push(`Datastore: ${state.platformSpecifics.datastore}`);
    }
  }

  // AWS
  if (platform === 'AWS' || platform === 'AWS GovCloud') {
    const awsConfig = state.platformConfig?.aws;
    if (awsConfig?.region) {
      items.push(`Region: ${awsConfig.region}`);
    }

    // Instance types (show if specified)
    if (awsConfig?.controlPlaneInstanceType) {
      items.push(`Control plane instance type: ${awsConfig.controlPlaneInstanceType}`);
    }
    if (awsConfig?.workerInstanceType) {
      items.push(`Worker instance type: ${awsConfig.workerInstanceType}`);
    }

    // Availability zones (if specified via subnets or zones)
    const zones = awsConfig?.zones;
    if (zones && zones.length > 0) {
      items.push(`Availability zones: ${zones.join(', ')}`);
    }

    // VPC mode
    const vpcMode = awsConfig?.vpcMode || 'installer-managed';
    if (vpcMode === 'existing') {
      items.push(`VPC mode: Existing VPC/subnets`);
    }
  }

  // Azure
  if (platform === 'Azure' || platform === 'Azure Government') {
    const platformConfig = state.platformConfig?.azure || state.platformConfig;
    if (platformConfig?.cloudName) {
      items.push(`Cloud: ${platformConfig.cloudName}`);
    }
    if (platformConfig?.region) {
      items.push(`Region: ${platformConfig.region}`);
    }
    if (platformConfig?.resourceGroupName) {
      items.push(`Resource group: ${platformConfig.resourceGroupName}`);
    }
    if (platformConfig?.baseDomainResourceGroupName) {
      items.push(`Base domain RG: ${platformConfig.baseDomainResourceGroupName}`);
    }
  }

  // IBM Cloud
  if (platform === 'IBM Cloud') {
    const ibmConfig = state.platformConfig?.ibmcloud;
    if (ibmConfig?.region) {
      items.push(`Region: ${ibmConfig.region}`);
    }
    if (ibmConfig?.resourceGroupName) {
      items.push(`Resource group: ${ibmConfig.resourceGroupName}`);
    }
    if (ibmConfig?.vpcName) {
      items.push(`VPC: ${ibmConfig.vpcName}`);
    }
    if (ibmConfig?.type) {
      items.push(`Instance type: ${ibmConfig.type}`);
    }
  }

  // Nutanix
  if (platform === 'Nutanix') {
    if (state.platformSpecifics?.prismCentral) {
      items.push(`Prism Central: ${state.platformSpecifics.prismCentral}`);
    }
    if (state.platformSpecifics?.prismElement) {
      items.push(`Prism Element: ${state.platformSpecifics.prismElement}`);
    }
  }

  return items.length > 0 ? items : null;
}

/**
 * Build Host Inventory / Node Count summary section.
 * Handles both host inventory (Agent-based) and platform config replicas (IPI).
 * Only call if host-inventory or platform-specifics tab is confirmed.
 */
export function buildHostInventorySummary(state) {
  const items = [];

  // Check for agent-based inventory (bare metal, vsphere agent)
  const hostInventory = state.hostInventory;
  if (hostInventory?.nodes && hostInventory.nodes.length > 0) {
    const total = hostInventory.nodes.length;
    const controlPlane = hostInventory.nodes.filter(n => n.role === 'master').length;
    const workers = hostInventory.nodes.filter(n => n.role === 'worker').length;

    items.push(`Total nodes: ${total} (${controlPlane} control plane, ${workers} worker${workers !== 1 ? 's' : ''})`);
    return items.length > 0 ? items : null;
  }

  // Check for IPI-style replica counts (AWS, Azure, etc.)
  const platformConfig = state.platformConfig;
  if (platformConfig) {
    const controlPlaneReplicas = platformConfig.controlPlaneReplicas;
    const computeReplicas = platformConfig.computeReplicas;

    if (controlPlaneReplicas !== undefined || computeReplicas !== undefined) {
      const cp = controlPlaneReplicas ?? 3;
      const workers = computeReplicas ?? 0;
      const total = cp + workers;

      items.push(`Total nodes: ${total} (${cp} control plane, ${workers} worker${workers !== 1 ? 's' : ''})`);
      return items.length > 0 ? items : null;
    }
  }

  return null;
}

/**
 * Build Operators summary section.
 * Only call if operators tab is confirmed.
 */
export function buildOperatorsSummary(state) {
  const operators = state.operators?.selected;
  if (!operators || operators.length === 0) return null;

  const items = [];

  items.push(`${operators.length} operators selected`);

  // Catalog breakdown
  const breakdown = getCatalogBreakdown(operators);
  if (breakdown) {
    items.push(`Catalogs: ${breakdown}`);
  }

  return items.length > 0 ? items : null;
}

/**
 * Get catalog breakdown (e.g., "Red Hat (8), Certified (3), Community (1)").
 */
function getCatalogBreakdown(operators) {
  const counts = {};

  operators.forEach(op => {
    const catalog = op.catalog || 'Unknown';
    counts[catalog] = (counts[catalog] || 0) + 1;
  });

  const parts = Object.entries(counts).map(([catalog, count]) => `${catalog} (${count})`);
  return parts.join(', ');
}

/**
 * Build documentation sources list based on confirmed configuration.
 * Dynamically adds docs based on what's actually configured.
 * Deduplicates by URL.
 */
export function buildDocumentationSources(state, confirmedTabs, docsIndex) {
  const docs = [];

  // Base scenario docs (always include)
  const platform = state.blueprint?.platform;
  const method = state.methodology?.method;
  const scenarioId = getScenarioId(platform, method);
  if (scenarioId && docsIndex?.scenarios?.[scenarioId]?.docs) {
    docs.push(...docsIndex.scenarios[scenarioId].docs);
  }

  // Conditional docs based on confirmed configuration

  if (confirmedTabs.includes('identity-access')) {
    // FIPS mode (from globalStrategy, NOT credentials)
    if (state.globalStrategy?.fips) {
      docs.push({
        title: 'Enabling FIPS mode',
        url: 'https://docs.openshift.com/container-platform/4.20/installing/installing-fips.html'
      });
    }
  }

  if (confirmedTabs.includes('networking') || confirmedTabs.includes('networking-v2')) {
    // Dual-stack networking
    if (isDualStack(state)) {
      docs.push({
        title: 'Configuring dual-stack networking',
        url: 'https://docs.openshift.com/container-platform/4.20/installing/installing_bare_metal_ipi/ipi-install-installation-workflow.html#configuring-dual-stack-networking_ipi-install-installation-workflow'
      });
    }
  }

  if (confirmedTabs.includes('connectivity-mirroring')) {
    // Mirror registry (check credentials.usingMirrorRegistry, not mirroring.useMirrorRegistry)
    if (state.credentials?.usingMirrorRegistry) {
      docs.push({
        title: 'Mirroring images for a disconnected installation',
        url: 'https://docs.openshift.com/container-platform/4.20/installing/disconnected_install/installing-mirroring-installation-images.html'
      });
    }

    // NTP servers (from globalStrategy.ntpServers, NOT connectivity.ntpServers)
    const ntpServers = state.globalStrategy?.ntpServers;
    let hasNtp = false;
    if (ntpServers) {
      if (Array.isArray(ntpServers)) {
        hasNtp = ntpServers.filter(s => String(s).trim()).length > 0;
      } else if (typeof ntpServers === 'string') {
        hasNtp = ntpServers.trim().length > 0;
      }
    }
    if (hasNtp) {
      docs.push({
        title: 'Configuring NTP servers for disconnected clusters',
        url: 'https://docs.openshift.com/container-platform/4.20/installing/install_config/installing-customizing.html'
      });
    }
  }

  if (confirmedTabs.includes('trust-proxy')) {
    // Proxy (from globalStrategy, NOT strategy)
    if (state.globalStrategy?.proxyEnabled) {
      docs.push({
        title: 'Configuring corporate proxy for disconnected clusters',
        url: 'https://docs.openshift.com/container-platform/4.20/installing/install_config/configuring-firewall.html'
      });
    }

    // Additional trust bundle (from trust.mirrorRegistryCaPem or trust.proxyCaPem)
    if (state.trust?.mirrorRegistryCaPem || state.trust?.proxyCaPem || state.trust?.additionalTrustBundle) {
      docs.push({
        title: 'Configuring additional trust bundles',
        url: 'https://docs.openshift.com/container-platform/4.20/networking/configuring-a-custom-pki.html'
      });
    }
  }

  if (confirmedTabs.includes('operators')) {
    // Operators in disconnected environment
    if (state.operators?.selected?.length > 0) {
      docs.push({
        title: 'Installing Operators in disconnected environments',
        url: 'https://docs.openshift.com/container-platform/4.20/operators/admin/olm-restricted-networks.html'
      });
    }
  }

  // Deduplicate by URL
  return deduplicateByUrl(docs);
}

/**
 * Check if dual-stack networking is configured.
 * Read from globalStrategy.networking!
 */
function isDualStack(state) {
  const net = state?.globalStrategy?.networking;
  if (!net) return false;

  const hasV4 = Boolean(net.clusterNetworkCidr || net.machineNetworkV4);
  const hasV6 = Boolean(net.clusterNetworkCidrV6 || net.machineNetworkV6);

  return hasV4 && hasV6;
}

/**
 * Deduplicate docs by URL.
 */
function deduplicateByUrl(docs) {
  const seen = new Set();
  return docs.filter(doc => {
    if (seen.has(doc.url)) return false;
    seen.add(doc.url);
    return true;
  });
}
