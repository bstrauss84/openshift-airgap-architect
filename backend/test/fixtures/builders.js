/**
 * Fixture composition utilities
 *
 * These functions modify base states to add specific features (FIPS, proxy,
 * dual-stack, mirroring, etc.) without duplicating the full state object.
 *
 * Usage:
 *   import { bareMetalAgent } from './base-states.js';
 *   import { withFips, withProxy, withDualStack } from './builders.js';
 *
 *   const state = withFips(bareMetalAgent());
 *   const complexState = withProxy(withDualStack(withFips(vsphereIpi())));
 */

/**
 * Enable FIPS mode
 */
export const withFips = (state) => ({
  ...state,
  globalStrategy: {
    ...state.globalStrategy,
    fips: true
  }
});

/**
 * Add proxy configuration
 */
export const withProxy = (state, config = {}) => ({
  ...state,
  globalStrategy: {
    ...state.globalStrategy,
    proxyEnabled: true,
    proxies: {
      httpProxy: config.httpProxy || "http://proxy.corp.local:3128",
      httpsProxy: config.httpsProxy || "http://proxy.corp.local:3128",
      noProxy: config.noProxy || "localhost,127.0.0.1,.cluster.local"
    }
  }
});

/**
 * Enable dual-stack networking (IPv4 + IPv6)
 */
export const withDualStack = (state) => ({
  ...state,
  hostInventory: {
    ...state.hostInventory,
    ipStackMode: 'dual-stack',
    machineNetworkV6Cidr: "fd00::/48",
    apiVipV6: "fd00::10",
    ingressVipV6: "fd00::11"
  },
  globalStrategy: {
    ...state.globalStrategy,
    networking: {
      ...state.globalStrategy?.networking,
      clusterNetwork: "10.128.0.0/14",
      clusterNetworkV6: "fd01::/48",
      serviceNetwork: "172.30.0.0/16",
      serviceNetworkV6: "fd02::/112"
    }
  }
});

/**
 * Add custom trust bundle
 */
export const withTrustBundle = (state, bundle) => ({
  ...state,
  trust: {
    ...state.trust,
    additionalTrustBundle: bundle || "-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----"
  }
});

/**
 * Enable mirroring configuration
 */
export const withMirroring = (state, config = {}) => ({
  ...state,
  globalStrategy: {
    ...state.globalStrategy,
    mirroring: {
      registryFqdn: config.registryFqdn || "mirror.local:5000",
      sources: config.sources || [
        {
          source: "quay.io/openshift-release-dev/ocp-release",
          mirrors: ["mirror.local:5000/ocp-release"]
        }
      ]
    }
  },
  credentials: {
    ...state.credentials,
    usingMirrorRegistry: true,
    mirrorRegistryPullSecret: config.pullSecret || '{"auths":{"mirror.local:5000":{"auth":"dXNlcjpwYXNz"}}}',
    mirrorRegistryUnauthenticated: config.unauthenticated || false
  }
});

/**
 * Add specific number of nodes
 */
export const withNodes = (state, count, nodeTemplate = {}) => {
  const nodes = [];
  const isMaster = count <= 3;

  for (let i = 0; i < count; i++) {
    nodes.push({
      role: isMaster ? "master" : (i < 3 ? "master" : "worker"),
      hostname: `${isMaster ? "master" : (i < 3 ? "master" : "worker")}-${i}`,
      primary: {
        type: "ethernet",
        name: "eno1",
        macAddress: `52:54:00:aa:bb:${String(i).padStart(2, "0")}`,
        ...nodeTemplate.primary
      },
      bmc: state.methodology?.method === "IPI" ? {
        address: `redfish+http://192.168.1.${10 + i}`,
        username: "admin",
        password: "password",
        disableCertificateVerification: false,
        ...nodeTemplate.bmc
      } : undefined,
      ...nodeTemplate
    });
  }

  return {
    ...state,
    hostInventory: {
      ...state.hostInventory,
      nodes
    }
  };
};

/**
 * Enable hyperthreading
 */
export const withHyperthreading = (state, enabled = true) => ({
  ...state,
  hostInventory: {
    ...state.hostInventory,
    computeHyperthreading: enabled ? "Enabled" : "Disabled",
    controlPlaneHyperthreading: enabled ? "Enabled" : "Disabled"
  }
});

/**
 * Add advanced CPU partitioning
 */
export const withCpuPartitioning = (state, mode = "AllNodes") => ({
  ...state,
  globalStrategy: {
    ...state.globalStrategy,
    baselineCapabilitySet: "None",
    cpuPartitioningMode: mode
  }
});

/**
 * Add NTP servers
 */
export const withNtpServers = (state, servers = ["0.pool.ntp.org", "1.pool.ntp.org"]) => ({
  ...state,
  globalStrategy: {
    ...state.globalStrategy,
    ntpServers: servers
  }
});

/**
 * Set connectivity mode (connected/disconnected)
 */
export const withConnectivity = (state, connectivity = "disconnected") => ({
  ...state,
  globalStrategy: {
    ...state.globalStrategy,
    connectivity
  }
});

/**
 * Add bond networking to a node
 */
export const withBondNode = (state, nodeIndex = 0, config = {}) => {
  const nodes = [...(state.hostInventory?.nodes || [])];
  if (!nodes[nodeIndex]) return state;

  nodes[nodeIndex] = {
    ...nodes[nodeIndex],
    primary: {
      type: "bond",
      bond: {
        name: config.name || "bond0",
        mode: config.mode || "802.3ad",
        slaves: config.slaves || [
          { name: "eno1", macAddress: "52:54:00:aa:bb:01" },
          { name: "eno2", macAddress: "52:54:00:aa:bb:02" }
        ]
      },
      mode: config.ipv4?.mode || config.ipv6?.mode || "static",
      ipv4Cidr: config.ipv4?.cidr,
      ipv4Gateway: config.ipv4?.gateway,
      ipv6Cidr: config.ipv6?.cidr,
      ipv6Gateway: config.ipv6?.gateway,
      advanced: config.mtu ? { mtu: config.mtu } : undefined
    }
  };

  return {
    ...state,
    hostInventory: {
      ...state.hostInventory,
      nodes
    }
  };
};

/**
 * Add VLAN to a node
 */
export const withVlanNode = (state, nodeIndex = 0, config = {}) => {
  const nodes = [...(state.hostInventory?.nodes || [])];
  if (!nodes[nodeIndex]) return state;

  const vlanType = config.onBond ? "vlan-on-bond" : "vlan-on-ethernet";
  const baseIface = config.onBond ?
    { name: "bond0", mode: "802.3ad", slaves: config.bondSlaves || [] } :
    { name: "eno1", macAddress: "52:54:00:aa:bb:01" };

  nodes[nodeIndex] = {
    ...nodes[nodeIndex],
    primary: {
      type: vlanType,
      vlan: {
        id: config.vlanId || 100,
        name: config.vlanName || "vlan100"
      },
      [config.onBond ? "bond" : "ethernet"]: baseIface,
      mode: config.ipv4?.mode || config.ipv6?.mode || "static",
      ipv4Cidr: config.ipv4?.cidr,
      ipv4Gateway: config.ipv4?.gateway,
      ipv6Cidr: config.ipv6?.cidr,
      ipv6Gateway: config.ipv6?.gateway
    }
  };

  return {
    ...state,
    hostInventory: {
      ...state.hostInventory,
      nodes
    }
  };
};
