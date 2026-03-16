import { test } from "node:test";
import assert from "node:assert";
import yaml from "js-yaml";
import { buildInstallConfig, buildAgentConfig } from "../src/generate.js";

test("buildInstallConfig returns install config shape", () => {
  const state = {
    blueprint: { baseDomain: "example.com", clusterName: "test-cluster" },
    globalStrategy: { networking: {} },
    credentials: {},
    hostInventory: { nodes: [] }
  };
  const raw = buildInstallConfig(state);
  assert.strictEqual(typeof raw, "string");
  const out = yaml.load(raw);
  assert.strictEqual(out.baseDomain, "example.com");
  assert.strictEqual(out.metadata.name, "test-cluster");
  assert.ok(out.pullSecret);
});

test("buildInstallConfig handles minimal state", () => {
  const raw = buildInstallConfig({});
  assert.strictEqual(typeof raw, "string");
  const out = yaml.load(raw);
  assert.ok(out.apiVersion);
  assert.ok(out.metadata);
});

test("buildInstallConfig emits BMC disableCertificateVerification when true (Phase 4.4)", () => {
  const state = {
    blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "test-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    hostInventory: {
      nodes: [
        {
          hostname: "master-0",
          role: "master",
          bmc: { address: "redfish+http://192.168.1.1", disableCertificateVerification: true }
        }
      ]
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.platform?.baremetal?.hosts?.length === 1);
  assert.strictEqual(out.platform.baremetal.hosts[0].bmc?.disableCertificateVerification, true);
});

test("buildInstallConfig for bare-metal-ipi emits provisioning network params when set (Prompt J)", () => {
  const state = {
    blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "test-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    hostInventory: {
      nodes: [{ hostname: "master-0", role: "master", bmc: {} }],
      provisioningNetwork: "Unmanaged",
      provisioningNetworkCIDR: "172.22.0.0/24",
      provisioningNetworkInterface: "eth1",
      provisioningDHCPRange: "172.22.0.10,172.22.0.254",
      clusterProvisioningIP: "172.22.0.3",
      provisioningMACAddress: "52:54:00:00:00:01"
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.platform?.baremetal?.provisioningNetwork, "Unmanaged");
  assert.strictEqual(out.platform?.baremetal?.provisioningNetworkCIDR, "172.22.0.0/24");
  assert.strictEqual(out.platform?.baremetal?.provisioningNetworkInterface, "eth1");
  assert.strictEqual(out.platform?.baremetal?.provisioningDHCPRange, "172.22.0.10,172.22.0.254");
  assert.strictEqual(out.platform?.baremetal?.clusterProvisioningIP, "172.22.0.3");
  assert.strictEqual(out.platform?.baremetal?.provisioningMACAddress, "52:54:00:00:00:01");
});

test("buildInstallConfig for bare-metal-ipi emits apiVIPs/ingressVIPs (list format per 4.12+)", () => {
  const state = {
    blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "test-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    hostInventory: {
      nodes: [{ hostname: "master-0", role: "master", bmc: { address: "redfish+http://192.168.1.1" } }],
      apiVip: "10.90.0.1",
      ingressVip: "10.90.0.2"
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.deepStrictEqual(out.platform?.baremetal?.apiVIPs, ["10.90.0.1"]);
  assert.deepStrictEqual(out.platform?.baremetal?.ingressVIPs, ["10.90.0.2"]);
});

test("buildInstallConfig for bare-metal-ipi host name: hostnameUseFqdn avoids doubled baseDomain", () => {
  const state = {
    blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "test-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    hostInventory: {
      nodes: [
        { hostname: "master-0.example.com", hostnameUseFqdn: true, role: "master", bmc: { address: "redfish+http://192.168.1.1" } }
      ]
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.platform?.baremetal?.hosts?.[0]?.name, "master-0.example.com", "should strip trailing baseDomain before appending to avoid master-0.example.com.example.com");
});

test("buildInstallConfig for bare-metal-upi emits apiVIPs/ingressVIPs (list format per 4.12+) and no hosts (Prompt J)", () => {
  const state = {
    blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "upi-cluster" },
    methodology: { method: "UPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    hostInventory: {
      nodes: [],
      apiVip: "192.168.1.100",
      ingressVip: "192.168.1.101"
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.deepStrictEqual(out.platform?.baremetal?.apiVIPs, ["192.168.1.100"]);
  assert.deepStrictEqual(out.platform?.baremetal?.ingressVIPs, ["192.168.1.101"]);
  assert.ok(!out.platform?.baremetal?.hosts || out.platform.baremetal.hosts.length === 0);
  assert.strictEqual(out.baseDomain, "example.com");
  assert.strictEqual(out.metadata?.name, "upi-cluster");
});

test("buildInstallConfig for bare-metal-upi emits controlPlane and compute platform none (A2)", () => {
  const state = {
    blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "upi-cluster" },
    methodology: { method: "UPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    hostInventory: { nodes: [] }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.controlPlane?.platform, "none", "bare-metal UPI must emit controlPlane.platform none");
  assert.strictEqual(out.compute?.[0]?.platform, "none", "bare-metal UPI must emit compute[0].platform none");
  assert.ok(out.platform?.baremetal !== undefined, "top-level platform.baremetal still required for apiVIP/ingressVIP");
});

test("buildInstallConfig for bare-metal-upi includes all required catalog params (Phase 4 completeness)", () => {
  const state = {
    blueprint: { platform: "Bare Metal", baseDomain: "upiexample.com", clusterName: "upi-cluster" },
    methodology: { method: "UPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    hostInventory: { nodes: [] }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.apiVersion, "apiVersion required by catalog");
  assert.ok(out.baseDomain, "baseDomain required by catalog");
  assert.ok(out.metadata && out.metadata.name, "metadata.name required by catalog");
  assert.ok(out.platform && out.platform.baremetal !== undefined, "platform required by catalog");
  assert.ok(typeof out.pullSecret === "string", "pullSecret required by catalog");
});

test("buildInstallConfig for bare-metal-upi must NOT emit IPI-only params (scenario-consistency)", () => {
  const state = {
    blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "upi-cluster" },
    methodology: { method: "UPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    hostInventory: {
      nodes: [{ hostname: "master-0", role: "master", bmc: { address: "redfish+http://x" } }],
      provisioningNetwork: "Managed",
      provisioningNetworkCIDR: "172.22.0.0/24",
      apiVip: "192.168.1.100",
      ingressVip: "192.168.1.101"
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  const bm = out.platform?.baremetal || {};
  assert.deepStrictEqual(bm.apiVIPs, ["192.168.1.100"]);
  assert.deepStrictEqual(bm.ingressVIPs, ["192.168.1.101"]);
  assert.strictEqual(bm.provisioningNetwork, undefined, "UPI must not emit IPI-only provisioningNetwork");
  assert.strictEqual(bm.provisioningNetworkCIDR, undefined, "UPI must not emit IPI-only provisioningNetworkCIDR");
  assert.strictEqual(bm.provisioningNetworkInterface, undefined, "UPI must not emit IPI-only provisioningNetworkInterface");
  assert.strictEqual(bm.provisioningDHCPRange, undefined, "UPI must not emit IPI-only provisioningDHCPRange");
  assert.strictEqual(bm.clusterProvisioningIP, undefined, "UPI must not emit IPI-only clusterProvisioningIP");
  assert.strictEqual(bm.provisioningMACAddress, undefined, "UPI must not emit IPI-only provisioningMACAddress");
  assert.ok(!bm.hosts || bm.hosts.length === 0, "UPI must not emit IPI-only hosts array");
});

test("buildAgentConfig emits additionalNTPSources and bootArtifactsBaseURL when set (Phase 4.4)", () => {
  const state = {
    blueprint: { platform: "Bare Metal", clusterName: "test-cluster" },
    methodology: { method: "Agent-Based Installer" },
    globalStrategy: { ntpServers: ["192.168.1.1", "pool.ntp.org"] },
    hostInventory: { nodes: [], bootArtifactsBaseURL: "https://artifacts.example.com/agent" }
  };
  const raw = buildAgentConfig(state);
  const out = yaml.load(raw);
  assert.deepStrictEqual(out.additionalNTPSources, ["192.168.1.1", "pool.ntp.org"]);
  assert.strictEqual(out.bootArtifactsBaseURL, "https://artifacts.example.com/agent");
});

test("buildInstallConfig Blueprint carry-over: architecture x86_64→amd64, aarch64→arm64 (Prompt K)", () => {
  const stateX86 = {
    blueprint: { platform: "Bare Metal", arch: "x86_64", baseDomain: "example.com", clusterName: "test" },
    methodology: { method: "Agent-Based Installer" },
    globalStrategy: { networking: {} },
    credentials: {},
    hostInventory: { nodes: [] }
  };
  const rawX86 = buildInstallConfig(stateX86);
  const outX86 = yaml.load(rawX86);
  assert.strictEqual(outX86.compute[0].architecture, "amd64");
  assert.strictEqual(outX86.controlPlane.architecture, "amd64");

  const stateArm = {
    blueprint: { platform: "Bare Metal", arch: "aarch64", baseDomain: "example.com", clusterName: "test" },
    methodology: { method: "Agent-Based Installer" },
    globalStrategy: { networking: {} },
    credentials: {},
    hostInventory: { nodes: [] }
  };
  const rawArm = buildInstallConfig(stateArm);
  const outArm = yaml.load(rawArm);
  assert.strictEqual(outArm.compute[0].architecture, "arm64");
  assert.strictEqual(outArm.controlPlane.architecture, "arm64");
});

test("buildInstallConfig K follow-up: compute/controlPlane.platform omitted unless required (bare-metal UPI none or AWS instance type)", () => {
  const state = {
    blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "test" },
    methodology: { method: "Agent-Based Installer" },
    globalStrategy: { networking: {} },
    credentials: {},
    hostInventory: { nodes: [] }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.compute[0].platform, undefined, "4.20 params: optional; top-level platform suffices");
  assert.strictEqual(out.controlPlane.platform, undefined, "4.20 params: optional; top-level platform suffices");
  assert.ok(out.platform?.baremetal !== undefined, "top-level platform.baremetal present");
});

test("buildInstallConfig emits hyperthreading, capabilities, cpuPartitioningMode, ovnInternalJoinSubnet when set (Prompt K)", () => {
  const state = {
    blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "test" },
    methodology: { method: "Agent-Based Installer" },
    globalStrategy: {
      networking: {
        clusterNetworkCidr: "10.128.0.0/14",
        clusterNetworkHostPrefix: 23,
        serviceNetworkCidr: "172.30.0.0/16",
        ovnInternalJoinSubnet: "100.65.0.0/16"
      }
    },
    platformConfig: {
      computeHyperthreading: "Disabled",
      controlPlaneHyperthreading: "Disabled",
      baselineCapabilitySet: "vCurrent",
      additionalEnabledCapabilities: ["baremetal"],
      cpuPartitioningMode: "None"
    },
    credentials: {},
    hostInventory: { nodes: [] }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.compute[0].hyperthreading, "Disabled");
  assert.strictEqual(out.controlPlane.hyperthreading, "Disabled");
  assert.strictEqual(out.capabilities?.baselineCapabilitySet, "vCurrent");
  assert.deepStrictEqual(out.capabilities?.additionalEnabledCapabilities, ["baremetal"]);
  assert.strictEqual(out.cpuPartitioningMode, "None");
  assert.strictEqual(out.networking?.ovnKubernetesConfig?.ipv4?.internalJoinSubnet, "100.65.0.0/16");
});

test("buildInstallConfig dual-stack: clusterNetwork and serviceNetwork each have two entries (IPv4 then IPv6) (E2E B-1)", () => {
  const state = {
    blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "agent-cluster" },
    methodology: { method: "Agent-Based Installer" },
    globalStrategy: {
      networking: {
        machineNetworkV4: "10.0.0.0/16",
        machineNetworkV6: "fd00::/48",
        clusterNetworkCidr: "10.128.0.0/14",
        clusterNetworkHostPrefix: 23,
        serviceNetworkCidr: "172.30.0.0/16",
        clusterNetworkCidrV6: "fd01::/48",
        clusterNetworkHostPrefixV6: 64,
        serviceNetworkCidrV6: "fd02::/112"
      }
    },
    credentials: {},
    hostInventory: { nodes: [] }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(Array.isArray(out.networking?.machineNetwork), "machineNetwork is array");
  assert.strictEqual(out.networking.machineNetwork.length, 2);
  assert.strictEqual(out.networking.machineNetwork[0].cidr, "10.0.0.0/16");
  assert.strictEqual(out.networking.machineNetwork[1].cidr, "fd00::/48");
  assert.ok(Array.isArray(out.networking?.clusterNetwork), "clusterNetwork is array");
  assert.strictEqual(out.networking.clusterNetwork.length, 2);
  assert.strictEqual(out.networking.clusterNetwork[0].cidr, "10.128.0.0/14");
  assert.strictEqual(out.networking.clusterNetwork[0].hostPrefix, 23);
  assert.strictEqual(out.networking.clusterNetwork[1].cidr, "fd01::/48");
  assert.strictEqual(out.networking.clusterNetwork[1].hostPrefix, 64);
  assert.ok(Array.isArray(out.networking?.serviceNetwork), "serviceNetwork is array");
  assert.strictEqual(out.networking.serviceNetwork.length, 2);
  assert.strictEqual(out.networking.serviceNetwork[0], "172.30.0.0/16");
  assert.strictEqual(out.networking.serviceNetwork[1], "fd02::/112");
});

test("buildInstallConfig dual-stack with no V6 cluster/service state uses doc defaults (E2E B-1)", () => {
  const state = {
    blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "agent-cluster" },
    methodology: { method: "Agent-Based Installer" },
    globalStrategy: {
      networking: {
        machineNetworkV4: "10.0.0.0/16",
        machineNetworkV6: "fd00::/48",
        clusterNetworkCidr: "10.128.0.0/14",
        clusterNetworkHostPrefix: 23,
        serviceNetworkCidr: "172.30.0.0/16"
      }
    },
    credentials: {},
    hostInventory: { nodes: [] }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.networking.clusterNetwork.length, 2);
  assert.strictEqual(out.networking.clusterNetwork[1].cidr, "fd01::/48");
  assert.strictEqual(out.networking.clusterNetwork[1].hostPrefix, 64);
  assert.strictEqual(out.networking.serviceNetwork.length, 2);
  assert.strictEqual(out.networking.serviceNetwork[1], "fd02::/112");
});

test("buildAgentConfig emits minimalISO when true (Prompt K)", () => {
  const state = {
    blueprint: { platform: "Bare Metal", clusterName: "test-cluster" },
    methodology: { method: "Agent-Based Installer" },
    hostInventory: { nodes: [{ hostname: "master-0", role: "master" }], minimalISO: true }
  };
  const raw = buildAgentConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.minimalISO, true);
});

test("buildInstallConfig for vsphere-ipi emits platform.vsphere with vcenters when vcenter and datacenter set (Prompt J)", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: {
        placementMode: "legacy",
        vcenter: "vcenter.example.com",
        datacenter: "DC1",
        datastore: "datastore1"
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.platform?.vsphere, "platform.vsphere must be present for vSphere IPI");
  assert.ok(Array.isArray(out.platform.vsphere.vcenters) && out.platform.vsphere.vcenters.length === 1);
  assert.strictEqual(out.platform.vsphere.vcenters[0].server, "vcenter.example.com");
  assert.deepStrictEqual(out.platform.vsphere.vcenters[0].datacenters, ["DC1"]);
  assert.strictEqual(out.metadata?.name, "vsphere-cluster");
  assert.strictEqual(out.baseDomain, "example.com");
});

test("buildInstallConfig for vsphere-ipi emits failureDomains when cluster and network also set (Prompt J)", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: {
        placementMode: "legacy",
        vcenter: "vcenter.example.com",
        datacenter: "DC1",
        datastore: "datastore1",
        cluster: "Cluster1",
        network: "VM Network"
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(Array.isArray(out.platform?.vsphere?.failureDomains) && out.platform.vsphere.failureDomains.length === 1);
  assert.strictEqual(out.platform.vsphere.failureDomains[0].topology.datacenter, "DC1");
  assert.strictEqual(out.platform.vsphere.failureDomains[0].topology.computeCluster, "Cluster1");
  assert.strictEqual(out.platform.vsphere.failureDomains[0].topology.datastore, "datastore1");
  assert.deepStrictEqual(out.platform.vsphere.failureDomains[0].topology.networks, ["VM Network"]);
});

test("buildInstallConfig for vsphere-ipi includes required catalog params (Prompt J Phase 3)", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "vsphere.example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: { placementMode: "legacy", vcenter: "vc.example.com", datacenter: "DC1", datastore: "ds1", cluster: "C1", network: "VM Network" }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.apiVersion, "apiVersion required by catalog");
  assert.ok(out.baseDomain, "baseDomain required by catalog");
  assert.ok(out.metadata && out.metadata.name, "metadata.name required by catalog");
  assert.ok(out.platform && out.platform.vsphere !== undefined, "platform.vsphere required by catalog");
  assert.ok(typeof out.pullSecret === "string", "pullSecret required by catalog");
  assert.strictEqual(out.compute[0].platform, undefined, "K follow-up: compute.platform omitted unless required");
  assert.strictEqual(out.controlPlane.platform, undefined, "K follow-up: controlPlane.platform omitted unless required");
});

test("buildInstallConfig for vsphere-ipi must NOT emit bare-metal-only params (scenario-consistency)", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    hostInventory: { nodes: [{ hostname: "master-0", role: "master", bmc: { address: "redfish+http://x" } }], apiVip: "192.168.1.1", ingressVip: "192.168.1.2" },
    platformConfig: { vsphere: { placementMode: "legacy", vcenter: "vc.example.com", datacenter: "DC1", datastore: "ds1", cluster: "C1", network: "VM Network" } }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.platform?.baremetal, undefined, "vsphere-ipi must not emit platform.baremetal");
  assert.ok(!out.platform?.vsphere?.hosts, "vsphere-ipi has no hosts in install-config");
  assert.strictEqual(out.platform?.vsphere?.vcenters?.length, 1, "vsphere vcenters must be present");
});

test("buildInstallConfig for vsphere-upi emits platform.vsphere with vcenters (Prompt J)", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-upi-cluster" },
    methodology: { method: "UPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: { placementMode: "legacy", vcenter: "vcenter.example.com", datacenter: "DC1", datastore: "datastore1", cluster: "C1", network: "VM Network" }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.platform?.vsphere, "platform.vsphere must be present for vSphere UPI");
  assert.ok(Array.isArray(out.platform.vsphere.vcenters) && out.platform.vsphere.vcenters.length === 1);
  assert.strictEqual(out.platform.vsphere.vcenters[0].server, "vcenter.example.com");
  assert.strictEqual(out.metadata?.name, "vsphere-upi-cluster");
});

test("buildInstallConfig for vsphere-upi includes required catalog params and must NOT emit bare-metal (scenario-consistency)", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "vsphere-upi.example.com", clusterName: "vsphere-upi-cluster" },
    methodology: { method: "UPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: { vsphere: { placementMode: "legacy", vcenter: "vc.example.com", datacenter: "DC1", datastore: "ds1", cluster: "C1", network: "VM Network" } }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.apiVersion);
  assert.ok(out.baseDomain);
  assert.ok(out.metadata?.name);
  assert.ok(out.platform?.vsphere !== undefined);
  assert.strictEqual(out.platform?.baremetal, undefined, "vsphere-upi must not emit platform.baremetal");
});

test("buildInstallConfig for vSphere emits multiple failure domains and vcenters when explicit arrays provided", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: {
        failureDomains: [
          { name: "fd-0", region: "DC1", zone: "Cluster1", server: "vcenter.example.com", topology: { datacenter: "DC1", computeCluster: "Cluster1", datastore: "ds1", networks: ["VM Network"], folder: "/DC1/vm/fd0", resourcePool: "/DC1/host/Cluster1/Resources" } },
          { name: "fd-1", region: "DC1", zone: "Cluster2", server: "vcenter.example.com", topology: { datacenter: "DC1", computeCluster: "Cluster2", datastore: "ds2", networks: ["VM Network"] } }
        ]
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(Array.isArray(out.platform?.vsphere?.failureDomains) && out.platform.vsphere.failureDomains.length === 2);
  assert.strictEqual(out.platform.vsphere.failureDomains[0].name, "fd-0");
  assert.strictEqual(out.platform.vsphere.failureDomains[0].region, "DC1");
  assert.strictEqual(out.platform.vsphere.failureDomains[0].zone, "Cluster1");
  assert.strictEqual(out.platform.vsphere.failureDomains[0].server, "vcenter.example.com");
  assert.strictEqual(out.platform.vsphere.failureDomains[0].topology.datacenter, "DC1");
  assert.strictEqual(out.platform.vsphere.failureDomains[0].topology.computeCluster, "Cluster1");
  assert.strictEqual(out.platform.vsphere.failureDomains[0].topology.datastore, "ds1");
  assert.deepStrictEqual(out.platform.vsphere.failureDomains[0].topology.networks, ["VM Network"]);
  assert.strictEqual(out.platform.vsphere.failureDomains[0].topology.folder, "/DC1/vm/fd0");
  assert.strictEqual(out.platform.vsphere.failureDomains[0].topology.resourcePool, "/DC1/host/Cluster1/Resources");
  assert.strictEqual(out.platform.vsphere.failureDomains[1].name, "fd-1");
  assert.strictEqual(out.platform.vsphere.failureDomains[1].topology.datastore, "ds2");
  assert.ok(Array.isArray(out.platform.vsphere.vcenters) && out.platform.vsphere.vcenters.length >= 1);
  assert.strictEqual(out.platform.vsphere.vcenters[0].server, "vcenter.example.com");
});

test("buildInstallConfig for vsphere FD mode emits multiple networks per failure domain (comma-separated UI → array)", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: {
        placementMode: "failureDomains",
        failureDomains: [
          { name: "fd-0", server: "vc.example.com", region: "DC1", zone: "C1", topology: { datacenter: "DC1", computeCluster: "C1", datastore: "ds1", networks: ["VM Network", "DPG-1"] } }
        ]
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.deepStrictEqual(out.platform?.vsphere?.failureDomains?.[0]?.topology?.networks, ["VM Network", "DPG-1"], "FD topology.networks must support multiple entries");
});

test("buildInstallConfig for vsphere-ipi emits diskType when set", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: { vcenter: "vc.example.com", datacenter: "DC1", datastore: "ds1", diskType: "thin" }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.platform?.vsphere?.diskType, "thin");
});

test("buildInstallConfig for vsphere-ipi emits apiVIPs and ingressVIPs when set (IPI only)", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: {
        vcenter: "vc.example.com",
        datacenter: "DC1",
        datastore: "ds1",
        apiVIPs: ["192.168.1.10"],
        ingressVIPs: ["192.168.1.11"]
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.deepStrictEqual(out.platform?.vsphere?.apiVIPs, ["192.168.1.10"]);
  assert.deepStrictEqual(out.platform?.vsphere?.ingressVIPs, ["192.168.1.11"]);
});

test("buildInstallConfig for vsphere-upi must NOT emit apiVIPs or ingressVIPs (regression)", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-upi-cluster" },
    methodology: { method: "UPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: {
        vcenter: "vcenter.example.com",
        datacenter: "DC1",
        datastore: "ds1",
        apiVIPs: ["192.168.1.10"],
        ingressVIPs: ["192.168.1.11"]
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.platform?.vsphere, "vsphere block present");
  assert.strictEqual(out.platform.vsphere.apiVIPs, undefined, "UPI must not emit apiVIPs");
  assert.strictEqual(out.platform.vsphere.ingressVIPs, undefined, "UPI must not emit ingressVIPs");
});

test("buildInstallConfig for vsphere-ipi emits template in failure domain topology when set (and no clusterOSImage)", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: {
        failureDomains: [
          { name: "fd-0", region: "DC1", zone: "Cluster1", server: "vc.example.com", topology: { datacenter: "DC1", computeCluster: "Cluster1", datastore: "ds1", networks: ["VM Network"], template: "/DC1/vm/rhcos-template" } }
        ]
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.platform?.vsphere?.failureDomains?.[0]?.topology?.template, "/DC1/vm/rhcos-template");
  assert.strictEqual(out.platform?.vsphere?.clusterOSImage, undefined, "clusterOSImage must not be emitted when template is set");
});

test("buildInstallConfig for vsphere-ipi emits clusterOSImage when set and no template in any FD (mutual exclusivity)", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: {
        clusterOSImage: "https://mirror.example.com/rhcos.ova",
        failureDomains: [
          { name: "fd-0", region: "DC1", zone: "Cluster1", server: "vc.example.com", topology: { datacenter: "DC1", computeCluster: "Cluster1", datastore: "ds1", networks: ["VM Network"] } }
        ]
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.platform?.vsphere?.clusterOSImage, "https://mirror.example.com/rhcos.ova");
  assert.strictEqual(out.platform?.vsphere?.failureDomains?.[0]?.topology?.template, undefined, "template must not be emitted when clusterOSImage is set");
});

test("buildInstallConfig for vsphere-ipi suppresses template in FD when clusterOSImage is set (mutual exclusivity)", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: {
        clusterOSImage: "https://mirror.example.com/rhcos.ova",
        failureDomains: [
          { name: "fd-0", region: "DC1", zone: "Cluster1", server: "vc.example.com", topology: { datacenter: "DC1", computeCluster: "Cluster1", datastore: "ds1", networks: ["VM Network"], template: "/DC1/vm/rhcos-template" } }
        ]
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.platform?.vsphere?.clusterOSImage, "https://mirror.example.com/rhcos.ova");
  assert.strictEqual(out.platform?.vsphere?.failureDomains?.[0]?.topology?.template, undefined, "template must be suppressed when clusterOSImage is set");
});

test("buildInstallConfig for vsphere-ipi emits machine-pool fields when provided", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: {
        placementMode: "legacy",
        vcenter: "vc.example.com",
        datacenter: "DC1",
        datastore: "ds1",
        cluster: "C1",
        network: "VM Network",
        osDiskDiskSizeGB: 120,
        cpus: 4,
        coresPerSocket: 2,
        memoryMB: 16384
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.platform?.vsphere?.osDisk?.diskSizeGB, 120);
  assert.strictEqual(out.platform?.vsphere?.cpus, 4);
  assert.strictEqual(out.platform?.vsphere?.coresPerSocket, 2);
  assert.strictEqual(out.platform?.vsphere?.memoryMB, 16384);
});

test("buildInstallConfig for vsphere-ipi emits compute and controlPlane platform.vsphere.zones when ≥2 FDs and provided", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: {
        failureDomains: [
          { name: "fd-0", region: "DC1", zone: "Cluster1", server: "vc.example.com", topology: { datacenter: "DC1", computeCluster: "Cluster1", datastore: "ds1", networks: ["VM Network"] } },
          { name: "fd-1", region: "DC1", zone: "Cluster2", server: "vc.example.com", topology: { datacenter: "DC1", computeCluster: "Cluster2", datastore: "ds1", networks: ["VM Network"] } }
        ],
        computeZones: ["fd-0", "fd-1"],
        controlPlaneZones: ["fd-0", "fd-1"]
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.deepStrictEqual(out.compute?.[0]?.platform?.vsphere?.zones, ["fd-0", "fd-1"]);
  assert.deepStrictEqual(out.controlPlane?.platform?.vsphere?.zones, ["fd-0", "fd-1"]);
});

test("buildInstallConfig for vSphere emits publish External when platformConfig.publish is Internal (vSphere does not support Internal)", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      publish: "Internal",
      vsphere: { placementMode: "legacy", vcenter: "vc.example.com", datacenter: "DC1", datastore: "ds1", cluster: "C1", network: "VM Network" }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.publish, "External", "vSphere must emit External only; Internal not supported (BZ#1953035)");
});

test("buildInstallConfig for vsphere-ipi omits credentials when includeCredentials false", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    exportOptions: { includeCredentials: false },
    platformConfig: {
      vsphere: { placementMode: "legacy", vcenter: "vc.example.com", datacenter: "DC1", datastore: "ds1", cluster: "C1", network: "VM Network", username: "admin", password: "secret" }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.platform?.vsphere?.vcenters?.[0]?.user, "", "user must be omitted/empty");
  assert.strictEqual(out.platform?.vsphere?.vcenters?.[0]?.password, "", "password must be omitted/empty");
});

test("buildInstallConfig for vsphere respects placementMode legacy: emits only flat path, ignores failureDomains array", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: {
        placementMode: "legacy",
        vcenter: "vc.example.com",
        datacenter: "DC1",
        datastore: "ds1",
        cluster: "Cluster1",
        network: "VM Network",
        failureDomains: [
          { name: "fd-custom", server: "other.example.com", region: "R1", zone: "Z1", topology: { datacenter: "DC2", computeCluster: "C2", datastore: "ds2", networks: ["Other"] } }
        ]
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.platform?.vsphere?.failureDomains?.length === 1, "must emit exactly one failure domain from flat path");
  assert.strictEqual(out.platform.vsphere.failureDomains[0].name, "fd-0", "legacy path must use fd-0, not state failureDomains");
  assert.strictEqual(out.platform.vsphere.failureDomains[0].server, "vc.example.com");
  assert.strictEqual(out.platform.vsphere.failureDomains[0].topology.datacenter, "DC1");
});

test("buildInstallConfig for vsphere FD mode: emits only failureDomains from state, never legacy flat", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: {
        placementMode: "failureDomains",
        vcenter: "legacy-vc.example.com",
        datacenter: "LegacyDC",
        datastore: "legacy-ds",
        cluster: "LegacyCluster",
        network: "Legacy Network",
        failureDomains: [
          { name: "fd-a", server: "fd-vc.example.com", region: "R1", zone: "Z1", topology: { datacenter: "DC1", computeCluster: "C1", datastore: "ds1", networks: ["Net1"] } }
        ]
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.platform?.vsphere?.failureDomains?.length, 1, "must emit exactly one FD from state array");
  assert.strictEqual(out.platform.vsphere.failureDomains[0].name, "fd-a");
  assert.strictEqual(out.platform.vsphere.failureDomains[0].server, "fd-vc.example.com");
  assert.strictEqual(out.platform.vsphere.failureDomains[0].topology.datacenter, "DC1");
  assert.strictEqual(out.platform.vsphere.vcenters?.[0]?.server, "fd-vc.example.com", "vcenters must come from FD, not flat legacy-vc.example.com");
});

test("buildInstallConfig for vsphere FD mode with no FDs: does not emit legacy-derived failureDomains", () => {
  const state = {
    blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "vsphere-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      vsphere: {
        placementMode: "failureDomains",
        failureDomains: [],
        vcenter: "vc.example.com",
        datacenter: "DC1",
        datastore: "ds1",
        cluster: "C1",
        network: "VM Network"
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.platform?.vsphere?.failureDomains, undefined, "must not emit failureDomains from flat when FD mode and no FDs");
});

test("buildInstallConfig for aws-govcloud-ipi emits platform.aws with region and optional fields (Prompt J)", () => {
  const state = {
    blueprint: { platform: "AWS GovCloud", baseDomain: "gov.example.com", clusterName: "gov-cluster" },
    methodology: { method: "IPI" },
    platformConfig: {
      aws: {
        region: "us-gov-west-1",
        vpcMode: "existing",
        hostedZone: "Z123",
        hostedZoneSharedVpc: true,
        hostedZoneRole: "arn:aws-us-gov:iam::123:role/HzRole",
        lbType: "NLB",
        subnets: "subnet-a, subnet-b",
        amiId: "ami-custom123",
        controlPlaneInstanceType: "m5.xlarge",
        workerInstanceType: "m5.large"
      },
      publish: "Internal",
      credentialsMode: "Mint"
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.platform?.aws, "platform.aws must be present for AWS GovCloud IPI");
  assert.strictEqual(out.platform.aws.region, "us-gov-west-1");
  assert.strictEqual(out.platform.aws.hostedZone, "Z123");
  assert.strictEqual(out.platform.aws.hostedZoneRole, "arn:aws-us-gov:iam::123:role/HzRole");
  assert.strictEqual(out.platform.aws.lbType, "NLB");
  assert.ok(out.platform.aws.vpc?.subnets, "vpc.subnets present for existing VPC");
  assert.deepStrictEqual(out.platform.aws.vpc.subnets, [{ id: "subnet-a" }, { id: "subnet-b" }], "4.20 doc: platform.aws.vpc.subnets[].id");
  assert.strictEqual(out.platform.aws.subnets, undefined, "legacy platform.aws.subnets not used");
  assert.strictEqual(out.platform.aws.amiID, "ami-custom123");
  assert.strictEqual(out.publish, "Internal");
  assert.strictEqual(out.credentialsMode, "Mint");
  assert.ok(out.controlPlane?.platform?.aws?.type === "m5.xlarge");
  assert.ok(out.compute?.[0]?.platform?.aws?.type === "m5.large");
  assert.strictEqual(out.metadata?.name, "gov-cluster");
});

test("buildInstallConfig for aws-govcloud-ipi emits vpc.subnets with optional roles when subnetEntries and roles set", () => {
  const state = {
    blueprint: { platform: "AWS GovCloud", baseDomain: "gov.example.com", clusterName: "gov-cluster" },
    methodology: { method: "IPI" },
    platformConfig: {
      aws: {
        region: "us-gov-west-1",
        vpcMode: "existing",
        subnetEntries: [
          { id: "subnet-a", roles: ["ClusterNode", "BootstrapNode"] },
          { id: "subnet-b", roles: ["IngressControllerLB", "ControlPlaneExternalLB", "ControlPlaneInternalLB"] }
        ]
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.platform?.aws?.vpc?.subnets);
  assert.strictEqual(out.platform.aws.vpc.subnets.length, 2);
  assert.deepStrictEqual(out.platform.aws.vpc.subnets[0], { id: "subnet-a", roles: [{ type: "ClusterNode" }, { type: "BootstrapNode" }] });
  assert.deepStrictEqual(out.platform.aws.vpc.subnets[1], { id: "subnet-b", roles: [{ type: "IngressControllerLB" }, { type: "ControlPlaneExternalLB" }, { type: "ControlPlaneInternalLB" }] });
});

test("buildInstallConfig for aws-govcloud-ipi omits subnets when vpcMode is installer-managed (#41)", () => {
  const state = {
    blueprint: { platform: "AWS GovCloud", baseDomain: "gov.example.com", clusterName: "gov-cluster" },
    methodology: { method: "IPI" },
    platformConfig: { aws: { region: "us-gov-west-1", subnets: "subnet-a, subnet-b" } }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.platform?.aws, "platform.aws present");
  assert.strictEqual(out.platform.aws.vpc, undefined, "vpc/subnets must be omitted when vpcMode is not existing");
});

test("buildInstallConfig for aws-govcloud-ipi includes required catalog params (Prompt J Phase 3)", () => {
  const state = {
    blueprint: { platform: "AWS GovCloud", baseDomain: "gov.example.com", clusterName: "gov-cluster" },
    methodology: { method: "IPI" },
    platformConfig: { aws: { region: "us-gov-east-1" } }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.platform?.aws, "platform.aws required by catalog");
  assert.strictEqual(out.platform.aws.region, "us-gov-east-1");
  assert.strictEqual(out.compute[0].platform, undefined, "K follow-up: no instance type so compute.platform omitted");
  assert.strictEqual(out.controlPlane.platform, undefined, "K follow-up: no instance type so controlPlane.platform omitted");
});

test("buildInstallConfig for aws-govcloud-ipi must NOT emit bare-metal or vsphere-only params (scenario-consistency)", () => {
  const state = {
    blueprint: { platform: "AWS GovCloud", baseDomain: "gov.example.com", clusterName: "gov-cluster" },
    methodology: { method: "IPI" },
    platformConfig: { aws: { region: "us-gov-west-1" } }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.platform?.baremetal, undefined, "aws-govcloud-ipi must not emit platform.baremetal");
  assert.strictEqual(out.platform?.vsphere, undefined, "aws-govcloud-ipi must not emit platform.vsphere");
  assert.ok(out.platform?.aws?.region === "us-gov-west-1");
});

test("buildInstallConfig for aws-govcloud-upi emits platform.aws with region and optional fields; no IPI-only instance types (Prompt J)", () => {
  const state = {
    blueprint: { platform: "AWS GovCloud", baseDomain: "gov.example.com", clusterName: "upi-gov-cluster" },
    methodology: { method: "UPI" },
    platformConfig: {
      aws: {
        region: "us-gov-east-1",
        vpcMode: "existing",
        hostedZone: "Z456",
        subnets: "subnet-x, subnet-y",
        amiId: "ami-upi123"
      },
      publish: "Internal",
      credentialsMode: "Passthrough"
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.platform?.aws, "platform.aws must be present for AWS GovCloud UPI");
  assert.strictEqual(out.platform.aws.region, "us-gov-east-1");
  assert.strictEqual(out.platform.aws.hostedZone, "Z456");
  assert.ok(out.platform.aws.vpc?.subnets);
  assert.deepStrictEqual(out.platform.aws.vpc.subnets, [{ id: "subnet-x" }, { id: "subnet-y" }]);
  assert.strictEqual(out.platform.aws.amiID, "ami-upi123");
  assert.strictEqual(out.publish, "Internal");
  assert.strictEqual(out.credentialsMode, "Passthrough");
  assert.strictEqual(out.metadata?.name, "upi-gov-cluster");
  assert.strictEqual(out.controlPlane?.platform, undefined, "K follow-up: UPI without instance types omits controlPlane.platform");
  assert.strictEqual(out.compute?.[0]?.platform, undefined, "K follow-up: UPI without instance types omits compute.platform");
  assert.strictEqual(out.controlPlane?.platform?.aws, undefined, "aws-govcloud-upi must NOT emit controlPlane.platform.aws (IPI-only)");
  assert.strictEqual(out.compute?.[0]?.platform?.aws, undefined, "aws-govcloud-upi must NOT emit compute.platform.aws (IPI-only)");
});

test("buildInstallConfig for aws-govcloud-upi must NOT emit IPI-only or other-scenario params (scenario-consistency)", () => {
  const state = {
    blueprint: { platform: "AWS GovCloud", baseDomain: "gov.example.com", clusterName: "gov-upi" },
    methodology: { method: "UPI" },
    platformConfig: { aws: { region: "us-gov-west-1" } }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.platform?.baremetal, undefined, "aws-govcloud-upi must not emit platform.baremetal");
  assert.strictEqual(out.platform?.vsphere, undefined, "aws-govcloud-upi must not emit platform.vsphere");
  assert.ok(out.platform?.aws?.region === "us-gov-west-1");
  assert.strictEqual(out.platform?.baremetal?.hosts, undefined, "aws-govcloud-upi must not emit platform.baremetal.hosts");
  assert.strictEqual(out.platform?.baremetal?.provisioningNetwork, undefined, "aws-govcloud-upi must not emit provisioningNetwork");
});

test("buildInstallConfig for aws-govcloud-ipi uses platformConfig controlPlaneReplicas and computeReplicas when set", () => {
  const state = {
    blueprint: { platform: "AWS GovCloud", baseDomain: "gov.example.com", clusterName: "gov-cluster" },
    methodology: { method: "IPI" },
    platformConfig: {
      aws: { region: "us-gov-west-1" },
      controlPlaneReplicas: 3,
      computeReplicas: 2
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.controlPlane.replicas, 3, "controlPlane.replicas from platformConfig");
  assert.strictEqual(out.compute[0].replicas, 2, "compute.replicas from platformConfig");
});

test("buildInstallConfig for AWS GovCloud emits IPv4-only networking (4.20 doc: AWS IPv4 only)", () => {
  const state = {
    blueprint: { platform: "AWS GovCloud", baseDomain: "gov.example.com", clusterName: "gov-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: {
      networking: {
        machineNetworkV4: "10.90.0.0/24",
        machineNetworkV6: "fd10:90::/64",
        clusterNetworkCidr: "10.128.0.0/14",
        serviceNetworkCidr: "172.30.0.0/16"
      }
    },
    platformConfig: { aws: { region: "us-gov-west-1" } }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(Array.isArray(out.networking?.machineNetwork), "machineNetwork present");
  assert.strictEqual(out.networking.machineNetwork.length, 1, "AWS must emit single-stack IPv4 only");
  assert.strictEqual(out.networking.machineNetwork[0].cidr, "10.90.0.0/24");
  assert.ok(Array.isArray(out.networking?.clusterNetwork) && out.networking.clusterNetwork.length === 1, "clusterNetwork single entry");
  assert.ok(Array.isArray(out.networking?.serviceNetwork) && out.networking.serviceNetwork.length === 1, "serviceNetwork single entry");
});

test("buildInstallConfig for aws-govcloud-ipi emits hostedZoneRole only when hostedZone and shared VPC are set", () => {
  const stateNoZone = {
    blueprint: { platform: "AWS GovCloud", baseDomain: "gov.example.com", clusterName: "gov-cluster" },
    methodology: { method: "IPI" },
    platformConfig: { aws: { region: "us-gov-west-1", hostedZoneRole: "arn:aws-us-gov:iam::123:role/HzRole" } }
  };
  const raw1 = buildInstallConfig(stateNoZone);
  const out1 = yaml.load(raw1);
  assert.strictEqual(out1.platform?.aws?.hostedZoneRole, undefined, "hostedZoneRole omitted when hostedZone not set");

  const stateWithZoneNoShared = {
    blueprint: { platform: "AWS GovCloud", baseDomain: "gov.example.com", clusterName: "gov-cluster" },
    methodology: { method: "IPI" },
    platformConfig: { aws: { region: "us-gov-west-1", hostedZone: "Z123", hostedZoneRole: "arn:aws-us-gov:iam::123:role/HzRole" } }
  };
  const raw2 = buildInstallConfig(stateWithZoneNoShared);
  const out2 = yaml.load(raw2);
  assert.strictEqual(out2.platform?.aws?.hostedZone, "Z123");
  assert.strictEqual(out2.platform?.aws?.hostedZoneRole, undefined, "hostedZoneRole omitted unless shared VPC (hostedZoneSharedVpc)");

  const stateWithZoneAndSharedVpc = {
    blueprint: { platform: "AWS GovCloud", baseDomain: "gov.example.com", clusterName: "gov-cluster" },
    methodology: { method: "IPI" },
    platformConfig: { aws: { region: "us-gov-west-1", hostedZone: "Z123", hostedZoneSharedVpc: true, hostedZoneRole: "arn:aws-us-gov:iam::123:role/HzRole" } }
  };
  const raw3 = buildInstallConfig(stateWithZoneAndSharedVpc);
  const out3 = yaml.load(raw3);
  assert.strictEqual(out3.platform?.aws?.hostedZone, "Z123");
  assert.strictEqual(out3.platform?.aws?.hostedZoneRole, "arn:aws-us-gov:iam::123:role/HzRole", "hostedZoneRole emitted when hostedZone + hostedZoneSharedVpc set");
});

test("buildInstallConfig for aws-govcloud-ipi emits rootVolume when rootVolumeSize/rootVolumeType set", () => {
  const state = {
    blueprint: { platform: "AWS GovCloud", baseDomain: "gov.example.com", clusterName: "gov-cluster" },
    methodology: { method: "IPI" },
    platformConfig: {
      aws: {
        region: "us-gov-west-1",
        controlPlaneInstanceType: "m5.xlarge",
        workerInstanceType: "m5.large",
        rootVolumeSize: 100,
        rootVolumeType: "gp3"
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.controlPlane?.platform?.aws?.type, "m5.xlarge");
  assert.deepStrictEqual(out.controlPlane?.platform?.aws?.rootVolume, { size: 100, type: "gp3" });
  assert.strictEqual(out.compute?.[0]?.platform?.aws?.type, "m5.large");
  assert.deepStrictEqual(out.compute?.[0]?.platform?.aws?.rootVolume, { size: 100, type: "gp3" });
});

test("buildInstallConfig for azure-government-ipi emits platform.azure with cloudName, region, resourceGroupName, baseDomainResourceGroupName (Prompt J)", () => {
  const state = {
    blueprint: { platform: "Azure Government", baseDomain: "gov.example.com", clusterName: "az-gov-cluster" },
    methodology: { method: "IPI" },
    platformConfig: {
      azure: {
        cloudName: "AzureUSGovernmentCloud",
        region: "usgovvirginia",
        resourceGroupName: "my-cluster-rg",
        baseDomainResourceGroupName: "base-domain-rg"
      },
      publish: "Internal",
      credentialsMode: "Mint"
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.platform?.azure, "platform.azure must be present for Azure Government IPI");
  assert.strictEqual(out.platform.azure.cloudName, "AzureUSGovernmentCloud");
  assert.strictEqual(out.platform.azure.region, "usgovvirginia");
  assert.strictEqual(out.platform.azure.resourceGroupName, "my-cluster-rg");
  assert.strictEqual(out.platform.azure.baseDomainResourceGroupName, "base-domain-rg");
  assert.strictEqual(out.publish, "Internal");
  assert.strictEqual(out.credentialsMode, "Mint");
  assert.strictEqual(out.metadata?.name, "az-gov-cluster");
});

test("buildInstallConfig for azure-government-ipi includes required catalog params (Prompt J Phase 3)", () => {
  const state = {
    blueprint: { platform: "Azure Government", baseDomain: "gov.example.com", clusterName: "az-gov" },
    methodology: { method: "IPI" },
    platformConfig: {
      azure: {
        cloudName: "AzureUSGovernmentCloud",
        region: "usgovvirginia",
        resourceGroupName: "cluster-rg",
        baseDomainResourceGroupName: "dns-rg"
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.platform?.azure, "platform.azure required by catalog");
  assert.strictEqual(out.platform.azure.cloudName, "AzureUSGovernmentCloud");
  assert.strictEqual(out.platform.azure.region, "usgovvirginia");
  assert.strictEqual(out.platform.azure.resourceGroupName, "cluster-rg");
  assert.strictEqual(out.platform.azure.baseDomainResourceGroupName, "dns-rg");
  assert.strictEqual(out.compute[0].platform, undefined, "K follow-up: compute.platform omitted unless required");
  assert.strictEqual(out.controlPlane.platform, undefined, "K follow-up: controlPlane.platform omitted unless required");
});

test("buildInstallConfig for azure-government-ipi must NOT emit bare-metal or vsphere or aws (scenario-consistency)", () => {
  const state = {
    blueprint: { platform: "Azure Government", baseDomain: "gov.example.com", clusterName: "az-gov" },
    methodology: { method: "IPI" },
    platformConfig: {
      azure: {
        cloudName: "AzureUSGovernmentCloud",
        region: "usgovvirginia",
        resourceGroupName: "rg",
        baseDomainResourceGroupName: "dns-rg"
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.platform?.baremetal, undefined, "azure-government-ipi must not emit platform.baremetal");
  assert.strictEqual(out.platform?.vsphere, undefined, "azure-government-ipi must not emit platform.vsphere");
  assert.strictEqual(out.platform?.aws, undefined, "azure-government-ipi must not emit platform.aws");
  assert.ok(out.platform?.azure?.region === "usgovvirginia");
});

test("buildInstallConfig for nutanix-ipi emits platform.nutanix with prismCentral, subnetUUIDs, optional clusterName (Prompt J)", () => {
  const state = {
    blueprint: { platform: "Nutanix", baseDomain: "nutanix.example.com", clusterName: "nutanix-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      nutanix: {
        endpoint: "prism.example.com",
        port: 9440,
        username: "admin",
        password: "secret",
        subnet: "subnet-uuid-123",
        cluster: "my-cluster"
      }
    },
    exportOptions: { includeCredentials: true }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.platform?.nutanix, "platform.nutanix must be present for Nutanix IPI");
  assert.strictEqual(out.platform.nutanix.prismCentral?.endpoint, "prism.example.com");
  assert.strictEqual(out.platform.nutanix.prismCentral?.port, 9440);
  assert.strictEqual(out.platform.nutanix.prismCentral?.username, "admin");
  assert.strictEqual(out.platform.nutanix.prismCentral?.password, "secret");
  assert.deepStrictEqual(out.platform.nutanix.subnetUUIDs, ["subnet-uuid-123"]);
  assert.strictEqual(out.platform.nutanix.clusterName, "my-cluster");
  assert.strictEqual(out.compute[0].platform, undefined, "K follow-up: compute.platform omitted unless required");
  assert.strictEqual(out.controlPlane.platform, undefined, "K follow-up: controlPlane.platform omitted unless required");
});

test("buildInstallConfig for nutanix-ipi includes required catalog params (Prompt J Phase 3)", () => {
  const state = {
    blueprint: { platform: "Nutanix", baseDomain: "nutanix.example.com", clusterName: "nutanix-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      nutanix: {
        endpoint: "pc.local",
        subnet: "subnet-uuid-456"
      }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.ok(out.platform?.nutanix?.prismCentral?.endpoint === "pc.local");
  assert.deepStrictEqual(out.platform.nutanix.subnetUUIDs, ["subnet-uuid-456"]);
  assert.strictEqual(out.compute[0].platform, undefined, "K follow-up: compute.platform omitted unless required");
  assert.strictEqual(out.controlPlane.platform, undefined, "K follow-up: controlPlane.platform omitted unless required");
});

test("buildInstallConfig for nutanix-ipi must NOT emit bare-metal or vsphere (scenario-consistency)", () => {
  const state = {
    blueprint: { platform: "Nutanix", baseDomain: "nutanix.example.com", clusterName: "nutanix-cluster" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {} },
    credentials: {},
    platformConfig: {
      nutanix: { endpoint: "pc.local", subnet: "subnet-uuid" }
    }
  };
  const raw = buildInstallConfig(state);
  const out = yaml.load(raw);
  assert.strictEqual(out.platform?.baremetal, undefined, "nutanix-ipi must not emit platform.baremetal");
  assert.strictEqual(out.platform?.vsphere, undefined, "nutanix-ipi must not emit platform.vsphere");
  assert.ok(out.platform?.nutanix?.prismCentral?.endpoint === "pc.local");
});

test("buildInstallConfig emits additionalTrustBundle as literal block (|) for readable PEM (#15)", () => {
  const pem1 = `-----BEGIN CERTIFICATE-----
MIIDdzCCAl+gAwIBAgIUFakeMirrorRegistryCA
-----END CERTIFICATE-----`;
  const pem2 = `-----BEGIN CERTIFICATE-----
MIIDdzCCAI+gAwIBAgIUFakeProxyCA
-----END CERTIFICATE-----`;
  const state = {
    blueprint: { baseDomain: "example.com", clusterName: "test-cluster" },
    globalStrategy: { networking: {} },
    credentials: {},
    trust: {
      mirrorRegistryCaPem: pem1,
      proxyCaPem: pem2,
      additionalTrustBundlePolicy: "Always"
    }
  };
  const raw = buildInstallConfig(state);
  assert.ok(raw.includes("additionalTrustBundle: |"), "must use literal block scalar (|) not folded (>-)");
  assert.ok(!raw.includes("additionalTrustBundle: >-"), "must not use folded block scalar");
  assert.ok(raw.includes("-----BEGIN CERTIFICATE-----") && raw.includes("-----END CERTIFICATE-----"), "PEM markers present");
  const out = yaml.load(raw);
  assert.strictEqual(typeof out.additionalTrustBundle, "string");
  assert.ok(out.additionalTrustBundle.includes("-----BEGIN CERTIFICATE-----"));
  assert.ok(out.additionalTrustBundle.includes("FakeMirrorRegistryCA"));
  assert.ok(out.additionalTrustBundle.includes("FakeProxyCA"));
});
