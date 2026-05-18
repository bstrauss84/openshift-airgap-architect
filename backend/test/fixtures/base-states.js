/**
 * Base state fixtures for backend tests
 *
 * These provide common starting states for test scenarios, reducing
 * duplication across 21 test files.
 *
 * Usage:
 *   import { minimal, bareMetalAgent, vsphereIpi } from './fixtures/base-states.js';
 *
 *   const state = bareMetalAgent();
 *   const customState = vsphereIpi({ fips: true });
 */

/**
 * Minimal state - bare minimum for buildInstallConfig
 */
export const minimal = (overrides = {}) => ({
  blueprint: {
    platform: "Bare Metal",
    baseDomain: "example.com",
    clusterName: "test-cluster",
    ...overrides.blueprint
  },
  methodology: {
    method: "Agent-Based Installer",
    ...overrides.methodology
  },
  globalStrategy: {
    networking: {},
    ...overrides.globalStrategy
  },
  credentials: {
    ...overrides.credentials
  },
  hostInventory: {
    nodes: [],
    ...overrides.hostInventory
  },
  ...overrides
});

/**
 * Bare Metal Agent-Based Installer
 * Standard 3-node cluster with DHCP networking
 */
export const bareMetalAgent = (overrides = {}) => ({
  ...minimal(overrides),
  blueprint: {
    platform: "Bare Metal",
    baseDomain: "example.com",
    clusterName: "agent-cluster",
    ...overrides.blueprint
  },
  methodology: {
    method: "Agent-Based Installer",
    ...overrides.methodology
  },
  hostInventory: {
    nodes: [
      {
        role: "master",
        hostname: "master-0",
        primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:01" }
      },
      {
        role: "master",
        hostname: "master-1",
        primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:02" }
      },
      {
        role: "master",
        hostname: "master-2",
        primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:03" }
      }
    ],
    apiVip: "10.90.0.2",
    ingressVip: "10.90.0.3",
    machineNetworkCidr: "10.90.0.0/24",
    ipStackMode: 'ipv4',
    ...overrides.hostInventory
  }
});

/**
 * Bare Metal IPI
 * Includes BMC configuration and provisioning network
 */
export const bareMetalIpi = (overrides = {}) => ({
  ...minimal(overrides),
  blueprint: {
    platform: "Bare Metal",
    baseDomain: "example.com",
    clusterName: "ipi-cluster",
    ...overrides.blueprint
  },
  methodology: {
    method: "IPI",
    ...overrides.methodology
  },
  hostInventory: {
    nodes: [
      {
        role: "master",
        hostname: "master-0",
        bmc: {
          address: "redfish+http://192.168.1.10",
          username: "admin",
          password: "password",
          disableCertificateVerification: false
        },
        primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:01" }
      },
      {
        role: "master",
        hostname: "master-1",
        bmc: {
          address: "redfish+http://192.168.1.11",
          username: "admin",
          password: "password",
          disableCertificateVerification: false
        },
        primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:02" }
      },
      {
        role: "master",
        hostname: "master-2",
        bmc: {
          address: "redfish+http://192.168.1.12",
          username: "admin",
          password: "password",
          disableCertificateVerification: false
        },
        primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:03" }
      }
    ],
    provisioningNetwork: "Managed",
    provisioningNetworkCIDR: "172.22.0.0/24",
    provisioningNetworkInterface: "eth1",
    provisioningDHCPRange: "172.22.0.10,172.22.0.254",
    clusterProvisioningIP: "172.22.0.3",
    bootstrapOSImage: "http://192.168.1.100/rhcos-bootstrap.iso",
    ...overrides.hostInventory
  }
});

/**
 * vSphere IPI
 * Standard vSphere deployment with datacenter, cluster, network
 */
export const vsphereIpi = (overrides = {}) => ({
  ...minimal(overrides),
  blueprint: {
    platform: "VMware vSphere",
    baseDomain: "vsphere.example.com",
    clusterName: "vsphere-cluster",
    ...overrides.blueprint
  },
  methodology: {
    method: "IPI",
    ...overrides.methodology
  },
  platformConfig: {
    vCenter: "vcenter.corp.local",
    username: "administrator@vsphere.local",
    password: "password",
    datacenter: "DC1",
    defaultDatastore: "/DC1/datastore/DS1",
    cluster: "/DC1/host/Cluster1",
    network: "VM Network",
    apiVip: "10.0.0.10",
    ingressVip: "10.0.0.11",
    ...overrides.platformConfig
  },
  globalStrategy: {
    networking: {
      machineNetwork: "10.0.0.0/24"
    },
    ...overrides.globalStrategy
  }
});

/**
 * vSphere Agent-Based Installer
 */
export const vsphereAgent = (overrides = {}) => ({
  ...vsphereIpi(overrides),
  methodology: {
    method: "Agent-Based Installer",
    ...overrides.methodology
  },
  hostInventory: {
    nodes: [
      {
        role: "master",
        hostname: "vsphere-master-0",
        primary: { type: "ethernet", name: "ens192", macAddress: "00:50:56:aa:bb:01" }
      },
      {
        role: "master",
        hostname: "vsphere-master-1",
        primary: { type: "ethernet", name: "ens192", macAddress: "00:50:56:aa:bb:02" }
      },
      {
        role: "master",
        hostname: "vsphere-master-2",
        primary: { type: "ethernet", name: "ens192", macAddress: "00:50:56:aa:bb:03" }
      }
    ],
    apiVip: "10.0.0.10",
    ingressVip: "10.0.0.11",
    machineNetworkCidr: "10.0.0.0/24",
    ipStackMode: 'ipv4',
    ...overrides.hostInventory
  }
});

/**
 * AWS GovCloud IPI
 */
export const awsGovcloudIpi = (overrides = {}) => ({
  ...minimal(overrides),
  blueprint: {
    platform: "AWS GovCloud",
    baseDomain: "aws.example.com",
    clusterName: "aws-cluster",
    ...overrides.blueprint
  },
  methodology: {
    method: "IPI",
    ...overrides.methodology
  },
  platformConfig: {
    region: "us-gov-west-1",
    ...overrides.platformConfig
  },
  credentials: {
    awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
    awsSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    ...overrides.credentials
  }
});

/**
 * Azure Government IPI
 */
export const azureGovernmentIpi = (overrides = {}) => ({
  ...minimal(overrides),
  blueprint: {
    platform: "Azure Government",
    baseDomain: "azure.example.com",
    clusterName: "azure-cluster",
    ...overrides.blueprint
  },
  methodology: {
    method: "IPI",
    ...overrides.methodology
  },
  platformConfig: {
    region: "usgovvirginia",
    ...overrides.platformConfig
  },
  credentials: {
    azureSubscriptionId: "12345678-1234-1234-1234-123456789012",
    azureTenantId: "87654321-4321-4321-4321-210987654321",
    azureClientId: "abcdef12-3456-7890-abcd-ef1234567890",
    azureClientSecret: "secret",
    ...overrides.credentials
  }
});

/**
 * Nutanix IPI
 */
export const nutanixIpi = (overrides = {}) => ({
  ...minimal(overrides),
  blueprint: {
    platform: "Nutanix",
    baseDomain: "nutanix.example.com",
    clusterName: "nutanix-cluster",
    ...overrides.blueprint
  },
  methodology: {
    method: "IPI",
    ...overrides.methodology
  },
  platformConfig: {
    prismCentralFqdn: "prism.corp.local",
    prismCentralPort: "9440",
    username: "admin",
    password: "password",
    prismElementUuid: "12345678-1234-1234-1234-123456789012",
    subnetUuid: "87654321-4321-4321-4321-210987654321",
    apiVip: "10.0.0.10",
    ingressVip: "10.0.0.11",
    ...overrides.platformConfig
  }
});
