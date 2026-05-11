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
    'networking',
    'connectivity-mirroring',
    'trust-proxy',
    'platform-specifics',
    'host-inventory',
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
 */
function getPullSecretSource(state) {
  const hasRedHat = Boolean(state.blueprint?.blueprintPullSecretEphemeral || state.credentials?.pullSecretPlaceholder);
  const hasMirror = Boolean(state.credentials?.mirrorRegistryPullSecret);

  if (hasRedHat && hasMirror) return 'Red Hat + Mirror registry';
  if (hasRedHat) return 'Red Hat';
  if (hasMirror) return 'Mirror registry';
  return null;
}

/**
 * Build Networking summary section.
 * Only call if networking tab is confirmed.
 */
export function buildNetworkingSummary(state) {
  if (!state?.networking) return null;

  const items = [];

  // Network topology
  const topology = getNetworkTopology(state);
  if (topology) {
    items.push(`Topology: ${topology}`);
  }

  // Cluster network CIDR
  if (state.networking.clusterNetwork) {
    items.push(`Cluster network: ${state.networking.clusterNetwork}`);
  }

  // Service network CIDR
  if (state.networking.serviceNetwork) {
    items.push(`Service network: ${state.networking.serviceNetwork}`);
  }

  // Machine network CIDR (if specified)
  if (state.networking.machineNetwork) {
    items.push(`Machine network: ${state.networking.machineNetwork}`);
  }

  // API VIP
  if (state.networking.apiVip) {
    items.push(`API VIP: ${state.networking.apiVip}`);
  }

  // Ingress VIP
  if (state.networking.ingressVip) {
    items.push(`Ingress VIP: ${state.networking.ingressVip}`);
  }

  return items.length > 0 ? items : null;
}

/**
 * Determine network topology (Single-stack IPv4, Dual-stack, etc.).
 */
function getNetworkTopology(state) {
  const net = state?.networking;
  if (!net) return null;

  const hasV4 = Boolean(net.clusterNetwork || net.machineNetwork);
  const hasV6 = Boolean(net.clusterNetworkV6 || net.machineNetworkV6);

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
    if (state.platformSpecifics?.region) {
      items.push(`Region: ${state.platformSpecifics.region}`);
    }
    if (state.platformSpecifics?.instanceType) {
      items.push(`Instance type: ${state.platformSpecifics.instanceType}`);
    }
  }

  // Azure
  if (platform === 'Azure' || platform === 'Azure Government') {
    if (state.platformSpecifics?.region) {
      items.push(`Region: ${state.platformSpecifics.region}`);
    }
    if (state.platformSpecifics?.resourceGroupName) {
      items.push(`Resource group: ${state.platformSpecifics.resourceGroupName}`);
    }
  }

  // IBM Cloud
  if (platform === 'IBM Cloud') {
    if (state.platformSpecifics?.region) {
      items.push(`Region: ${state.platformSpecifics.region}`);
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
 * Build Host Inventory summary section.
 * Only call if host-inventory tab is confirmed.
 */
export function buildHostInventorySummary(state) {
  const inventory = state.inventory;
  if (!inventory?.nodes || inventory.nodes.length === 0) return null;

  const items = [];

  const total = inventory.nodes.length;
  const controlPlane = inventory.nodes.filter(n => n.role === 'master').length;
  const workers = inventory.nodes.filter(n => n.role === 'worker').length;

  items.push(`Total nodes: ${total} (${controlPlane} control plane, ${workers} workers)`);

  return items.length > 0 ? items : null;
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

  if (confirmedTabs.includes('networking')) {
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
 */
function isDualStack(state) {
  const net = state?.networking;
  if (!net) return false;

  const hasV4 = Boolean(net.clusterNetwork || net.machineNetwork);
  const hasV6 = Boolean(net.clusterNetworkV6 || net.machineNetworkV6);

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
