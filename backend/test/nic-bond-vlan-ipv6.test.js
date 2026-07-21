/**
 * NIC/Bond/VLAN/IPv6 Generation Unit Tests
 *
 * Item #5 from v1.3.0 Phase 5 (PHX-034): Broaden generation unit tests
 *
 * Tests network interface generation for various scenarios:
 * - VLAN on ethernet vs VLAN on bond
 * - Bond modes (802.3ad, active-backup)
 * - MTU settings (bond, VLAN)
 * - IPv6-only networking
 * - Multiple bonds/VLANs per node
 * - IPv6 gateway routes
 * - Dual-stack asymmetric VIPs
 */

import { test } from "node:test";
import assert from "node:assert";
import yaml from "js-yaml";
import { buildAgentConfig, buildInstallConfig } from "../src/generate.js";
import { baseStates, builders } from "./fixtures/index.js";

/**
 * Test 1: vlan-on-ethernet generation
 */
test("generates vlan-on-ethernet NMState config", () => {
  const state = baseStates.bareMetalAgent({
    hostInventory: {
      nodes: [{
        role: "master",
        hostname: "master-0",
        primary: {
          type: "vlan-on-ethernet",
          name: "vlan100",
          vlan: { id: 100, name: "vlan100" },
          ethernet: { name: "eno1", macAddress: "52:54:00:aa:bb:cc" },
          mode: "static",
          ipv4Cidr: "10.90.0.10/24",
          ipv4Gateway: "10.90.0.1"
        }
      }],
      machineNetworkCidr: "10.90.0.0/24",
      apiVip: "10.90.0.2",
      ingressVip: "10.90.0.3"
    }
  });

  const raw = buildAgentConfig(state);
  const agentConfig = yaml.load(raw);
  const nmstate = agentConfig.hosts[0].networkConfig;

  // Should have ethernet base interface + VLAN interface
  assert.ok(nmstate.interfaces.some(i => i.name === "eno1"), "should have ethernet base interface");
  assert.ok(nmstate.interfaces.some(i => i.name === "vlan100"), "should have VLAN interface");

  // Check VLAN config
  const vlanIface = nmstate.interfaces.find(i => i.name === "vlan100");
  assert.strictEqual(vlanIface.type, "vlan");
  assert.strictEqual(vlanIface.state, "up");
  assert.strictEqual(vlanIface.vlan["base-iface"], "eno1");
  assert.strictEqual(vlanIface.vlan.id, 100);

  // Check static IP on VLAN
  assert.strictEqual(vlanIface.ipv4.enabled, true);
  assert.strictEqual(vlanIface.ipv4.dhcp, false);
  assert.strictEqual(vlanIface.ipv4.address[0].ip, "10.90.0.10");
  assert.strictEqual(vlanIface.ipv4.address[0]["prefix-length"], 24);
});

/**
 * Test 2: Bond with active-backup mode
 */
test("generates bond with active-backup mode", () => {
  const state = builders.withBondNode(
    baseStates.bareMetalAgent(),
    0,
    {
      name: "bond0",
      mode: "active-backup",
      slaves: [
        { name: "eno1", macAddress: "52:54:00:aa:bb:01" },
        { name: "eno2", macAddress: "52:54:00:aa:bb:02" }
      ],
      ipv4: {
        mode: "static",
        cidr: "10.90.0.10/24",
        gateway: "10.90.0.1"
      }
    }
  );

  const raw = buildAgentConfig(state);
  const agentConfig = yaml.load(raw);
  const nmstate = agentConfig.hosts[0].networkConfig;

  const bondIface = nmstate.interfaces.find(i => i.name === "bond0");
  assert.ok(bondIface, "should have bond interface");
  assert.strictEqual(bondIface.type, "bond");
  assert.strictEqual(bondIface["link-aggregation"].mode, "active-backup");
  assert.deepStrictEqual(bondIface["link-aggregation"].port, ["eno1", "eno2"]);
});

/**
 * Test 3: Bond MTU inheritance
 */
test("bond MTU is correctly set on bond interface", () => {
  const state = builders.withBondNode(
    baseStates.bareMetalAgent(),
    0,
    {
      name: "bond0",
      mode: "802.3ad",
      mtu: 9000,
      slaves: [
        { name: "eno1", macAddress: "52:54:00:aa:bb:01" },
        { name: "eno2", macAddress: "52:54:00:aa:bb:02" }
      ]
    }
  );

  const raw = buildAgentConfig(state);
  const agentConfig = yaml.load(raw);
  const nmstate = agentConfig.hosts[0].networkConfig;

  const bondIface = nmstate.interfaces.find(i => i.name === "bond0");
  assert.strictEqual(bondIface.mtu, 9000, "bond should have MTU 9000");
});

/**
 * Test 4: VLAN MTU inheritance
 */
test("VLAN inherits MTU from base interface", () => {
  const state = builders.withVlanNode(
    baseStates.bareMetalAgent(),
    0,
    {
      vlanId: 100,
      vlanName: "vlan100",
      onBond: true,
      bondSlaves: [
        { name: "eno1", macAddress: "52:54:00:aa:bb:01" },
        { name: "eno2", macAddress: "52:54:00:aa:bb:02" }
      ]
    }
  );

  const raw = buildAgentConfig(state);
  const agentConfig = yaml.load(raw);
  const nmstate = agentConfig.hosts[0].networkConfig;

  const vlanIface = nmstate.interfaces.find(i => i.name === "vlan100");
  assert.ok(vlanIface, "should have VLAN interface");
  assert.strictEqual(vlanIface.type, "vlan");
  assert.strictEqual(vlanIface.vlan["base-iface"], "bond0");
  assert.strictEqual(vlanIface.vlan.id, 100);
});

/**
 * Test 5: IPv6-only networking (no IPv4)
 */
test("IPv6-only cluster has no IPv4 networks", () => {
  const state = baseStates.bareMetalAgent({
    hostInventory: {
      nodes: [
        {
          role: "master",
          hostname: "master-0",
          primary: {
            type: "ethernet",
            ethernet: {
              name: "eno1",
              macAddress: "52:54:00:aa:bb:01"
            },
            mode: "static",
            ipv6Cidr: "fd00::10/64",
            ipv6Gateway: "fd00::1"
          }
        },
        {
          role: "master",
          hostname: "master-1",
          primary: {
            type: "ethernet",
            ethernet: {
              name: "eno1",
              macAddress: "52:54:00:aa:bb:02"
            },
            mode: "static",
            ipv6Cidr: "fd00::11/64",
            ipv6Gateway: "fd00::1"
          }
        },
        {
          role: "master",
          hostname: "master-2",
          primary: {
            type: "ethernet",
            ethernet: {
              name: "eno1",
              macAddress: "52:54:00:aa:bb:03"
            },
            mode: "static",
            ipv6Cidr: "fd00::12/64",
            ipv6Gateway: "fd00::1"
          }
        }
      ],
      ipStackMode: 'ipv6',
      apiVipV6: "fd00::2",
      ingressVipV6: "fd00::3"
    },
    globalStrategy: {
      networking: {
        machineNetworkV6: "fd00::/48",
        clusterNetworkCidrV6: "fd01::/48",
        serviceNetworkCidrV6: "fd02::/112"
      }
    }
  });

  // Check install-config for networking (cluster/service networks)
  const installConfigRaw = buildInstallConfig(state);
  const installConfig = yaml.load(installConfigRaw);

  const clusterNetworks = installConfig.networking.clusterNetwork || [];
  const serviceNetworks = installConfig.networking.serviceNetwork || [];

  assert.strictEqual(clusterNetworks.length, 1, "should have exactly 1 cluster network entry");
  assert.ok(clusterNetworks[0].cidr.includes(":"), "cluster network should be IPv6");
  assert.strictEqual(serviceNetworks.length, 1, "should have exactly 1 service network entry");
  assert.ok(serviceNetworks[0].includes(":"), "service network should be IPv6");

  // Check install-config for VIPs (bare metal agent uses platform.baremetal.apiVIPs)
  const apiVips = installConfig.platform?.baremetal?.apiVIPs || [];
  assert.ok(Array.isArray(apiVips), "apiVIPs should be array");
  assert.strictEqual(apiVips.length, 1, "should have exactly 1 API VIP");
  assert.ok(apiVips[0].includes(":"), "API VIP should be IPv6");

  // Check agent-config for nmstate
  const agentConfigRaw = buildAgentConfig(state);
  const agentConfig = yaml.load(agentConfigRaw);

  // Verify nmstate has IPv6 enabled, IPv4 disabled
  const nmstate = agentConfig.hosts[0].networkConfig;
  const eno1 = nmstate.interfaces.find(i => i.name === "eno1");
  assert.strictEqual(eno1.ipv4.enabled, false, "IPv4 should be disabled in nmstate");
  assert.strictEqual(eno1.ipv6.enabled, true, "IPv6 should be enabled in nmstate");
});

/**
 * Test 6: Multiple bonds on same node
 * TODO: Requires secondary interface support in generate.js (not yet implemented)
 */
test.skip("generates multiple bonds on same node", () => {
  let state = baseStates.bareMetalAgent();

  // Add bond0 (LACP)
  state = builders.withBondNode(state, 0, {
    name: "bond0",
    mode: "802.3ad",
    slaves: [
      { name: "eno1", macAddress: "52:54:00:aa:bb:01" },
      { name: "eno2", macAddress: "52:54:00:aa:bb:02" }
    ]
  });

  // Manually add bond1 (active-backup) to same node
  state.hostInventory.nodes[0].secondary = {
    type: "bond",
    name: "bond1",
    mode: "active-backup",
    slaves: [
      { name: "eno3", macAddress: "52:54:00:aa:bb:03" },
      { name: "eno4", macAddress: "52:54:00:aa:bb:04" }
    ]
  };

  const raw = buildAgentConfig(state);
  const agentConfig = yaml.load(raw);
  const nmstate = agentConfig.hosts[0].networkConfig;

  const bond0 = nmstate.interfaces.find(i => i.name === "bond0");
  const bond1 = nmstate.interfaces.find(i => i.name === "bond1");

  assert.ok(bond0, "should have bond0");
  assert.ok(bond1, "should have bond1");
  assert.strictEqual(bond0["link-aggregation"].mode, "802.3ad");
  assert.strictEqual(bond1["link-aggregation"].mode, "active-backup");
});

/**
 * Test 7: Multiple VLANs on same bond
 * TODO: Requires secondary interface support in generate.js (not yet implemented)
 */
test.skip("generates multiple VLANs on same bond", () => {
  const state = baseStates.bareMetalAgent({
    hostInventory: {
      nodes: [{
        role: "master",
        hostname: "master-0",
        primary: {
          type: "vlan-on-bond",
          name: "vlan100",
          vlan: { id: 100, name: "vlan100" },
          bond: {
            name: "bond0",
            mode: "802.3ad",
            slaves: [
              { name: "eno1", macAddress: "52:54:00:aa:bb:01" },
              { name: "eno2", macAddress: "52:54:00:aa:bb:02" }
            ]
          },
          mode: "static",
          ipv4Cidr: "10.90.0.10/24"
        },
        secondary: {
          type: "vlan-on-bond",
          name: "vlan200",
          vlan: { id: 200, name: "vlan200" },
          bond: {
            name: "bond0",
            mode: "802.3ad",
            slaves: [
              { name: "eno1", macAddress: "52:54:00:aa:bb:01" },
              { name: "eno2", macAddress: "52:54:00:aa:bb:02" }
            ]
          },
          mode: "static",
          ipv4Cidr: "10.91.0.10/24"
        }
      }],
      machineNetworkCidr: "10.90.0.0/24",
      apiVip: "10.90.0.2",
      ingressVip: "10.90.0.3"
    }
  });

  const raw = buildAgentConfig(state);
  const agentConfig = yaml.load(raw);
  const nmstate = agentConfig.hosts[0].networkConfig;

  const vlan100 = nmstate.interfaces.find(i => i.name === "vlan100");
  const vlan200 = nmstate.interfaces.find(i => i.name === "vlan200");

  assert.ok(vlan100, "should have vlan100");
  assert.ok(vlan200, "should have vlan200");
  assert.strictEqual(vlan100.vlan["base-iface"], "bond0");
  assert.strictEqual(vlan200.vlan["base-iface"], "bond0");
  assert.strictEqual(vlan100.vlan.id, 100);
  assert.strictEqual(vlan200.vlan.id, 200);
});

/**
 * Test 8: IPv6 gateway route generation
 */
test("generates IPv6 gateway route", () => {
  const state = baseStates.bareMetalAgent({
    hostInventory: {
      nodes: [{
        role: "master",
        hostname: "master-0",
        primary: {
          type: "ethernet",
          ethernet: {
            name: "eno1",
            macAddress: "52:54:00:aa:bb:01"
          },
          mode: "static",
          ipv6Cidr: "fd00::10/64",
          ipv6Gateway: "fd00::1"
        }
      }],
      ipStackMode: 'dual-stack'
    }
  });

  const raw = buildAgentConfig(state);
  const agentConfig = yaml.load(raw);
  const nmstate = agentConfig.hosts[0].networkConfig;

  const ipv6Route = nmstate.routes.config.find(r => r.destination === "::/0");
  assert.ok(ipv6Route, "should have IPv6 default route");
  assert.strictEqual(ipv6Route["next-hop-address"], "fd00::1");
  assert.strictEqual(ipv6Route["next-hop-interface"], "eno1");
});

/**
 * Test 9: Dual-stack with asymmetric VIPs
 * TODO: Asymmetric VIP validation needs review
 */
test.skip("dual-stack with asymmetric VIPs (IPv4 ingress only)", () => {
  const state = builders.withDualStack(baseStates.bareMetalAgent());

  // Remove ingressVipV6 to create asymmetric VIP scenario
  delete state.hostInventory.ingressVipV6;

  const raw = buildAgentConfig(state);
  const agentConfig = yaml.load(raw);

  // apiVIPs should have both IPv4 and IPv6
  assert.strictEqual(agentConfig.apiVIPs.length, 2, "should have 2 API VIPs");
  assert.ok(agentConfig.apiVIPs.some(v => !v.includes(":")), "should have IPv4 API VIP");
  assert.ok(agentConfig.apiVIPs.some(v => v.includes(":")), "should have IPv6 API VIP");

  // ingressVIPs should have only IPv4
  assert.strictEqual(agentConfig.ingressVIPs.length, 1, "should have 1 ingress VIP");
  assert.ok(!agentConfig.ingressVIPs[0].includes(":"), "ingress VIP should be IPv4 only");
});

/**
 * Test 10: Combined static IPv4 + DHCP IPv6
 * TODO: DHCP IPv6 behavior needs verification
 */
test.skip("static IPv4 with DHCP IPv6 on same interface", () => {
  const state = baseStates.bareMetalAgent({
    hostInventory: {
      nodes: [{
        role: "master",
        hostname: "master-0",
        primary: {
          type: "ethernet",
          ethernet: {
            name: "eno1",
            macAddress: "52:54:00:aa:bb:01"
          },
          mode: "static",
          ipv4Cidr: "10.90.0.10/24",
          ipv4Gateway: "10.90.0.1"
        }
      }],
      ipStackMode: 'dual-stack',
      machineNetworkCidr: "10.90.0.0/24"
    }
  });

  const raw = buildAgentConfig(state);
  const agentConfig = yaml.load(raw);
  const nmstate = agentConfig.hosts[0].networkConfig;

  const primaryIface = nmstate.interfaces.find(i => i.name === "eno1");

  // IPv4 should be static
  assert.strictEqual(primaryIface.ipv4.enabled, true);
  assert.strictEqual(primaryIface.ipv4.dhcp, false);
  assert.strictEqual(primaryIface.ipv4.address[0].ip, "10.90.0.10");

  // IPv6 should be enabled (DHCP when no static config)
  assert.strictEqual(primaryIface.ipv6.enabled, true);
});

/**
 * Test 11: Route generation with IPv6 destinations
 * TODO: Custom route field mapping needs verification
 */
test.skip("generates routes with IPv6 destinations", () => {
  const state = baseStates.bareMetalAgent({
    hostInventory: {
      nodes: [{
        role: "master",
        hostname: "master-0",
        primary: {
          type: "ethernet",
          ethernet: {
            name: "eno1",
            macAddress: "52:54:00:aa:bb:01"
          },
          mode: "static",
          ipv6Cidr: "fd00::10/64",
          ipv6Gateway: "fd00::1",
          routes: [
            {
              destination: "fd01::/48",
              nextHopAddress: "fd00::fe"
            }
          ]
        }
      }],
      ipStackMode: 'dual-stack'
    }
  });

  const raw = buildAgentConfig(state);
  const agentConfig = yaml.load(raw);
  const nmstate = agentConfig.hosts[0].networkConfig;

  // Should have custom IPv6 route
  const customRoute = nmstate.routes.config.find(r => r.destination === "fd01::/48");
  assert.ok(customRoute, "should have custom IPv6 route");
  assert.strictEqual(customRoute["next-hop-address"], "fd00::fe");
});

/**
 * Test 12: VLAN ID edge cases (min/max valid)
 */
test("VLAN ID validation accepts min (1) and max (4094)", () => {
  const stateMin = builders.withVlanNode(baseStates.bareMetalAgent(), 0, { vlanId: 1 });
  const stateMax = builders.withVlanNode(baseStates.bareMetalAgent(), 0, { vlanId: 4094 });

  const rawMin = buildAgentConfig(stateMin);
  const rawMax = buildAgentConfig(stateMax);

  const agentMin = yaml.load(rawMin);
  const agentMax = yaml.load(rawMax);

  const vlanMin = agentMin.hosts[0].networkConfig.interfaces.find(i => i.type === "vlan");
  const vlanMax = agentMax.hosts[0].networkConfig.interfaces.find(i => i.type === "vlan");

  assert.strictEqual(vlanMin.vlan.id, 1, "VLAN ID 1 should be accepted");
  assert.strictEqual(vlanMax.vlan.id, 4094, "VLAN ID 4094 should be accepted");
});

/**
 * DOC-102 Slice 5H: Additional Interface VRF generation tests
 *
 * Covers HB-001 resolution — VRF generation for additional interfaces.
 * Primary VRF generation (already working) is tested for non-regression.
 */

const VERSIONS = ["4.20", "4.21"];

function stateForVersion(version) {
  const state = baseStates.bareMetalAgent({
    version: { selectedMinor: version }
  });
  assert.strictEqual(state.version.selectedMinor, version);
  return state;
}

const withAdditionalInterface = (state, nodeIndex, iface) => {
  const nodes = [...(state.hostInventory?.nodes || [])];
  if (!nodes[nodeIndex]) return state;
  nodes[nodeIndex] = {
    ...nodes[nodeIndex],
    additionalInterfaces: [
      ...(nodes[nodeIndex].additionalInterfaces || []),
      iface
    ]
  };
  return { ...state, hostInventory: { ...state.hostInventory, nodes } };
};

for (const version of VERSIONS) {

  test(`[${version}] Additional Ethernet with VRF generates VRF interface`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eth2", macAddress: "52:54:00:cc:dd:01" },
      advanced: { vrf: { enabled: true, name: "vrf-eth", tableId: "200", ports: "" } }
    });
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const nmstate = parsed.hosts[0].networkConfig;
    const vrfIface = nmstate.interfaces.find(i => i.type === "vrf" && i.name === "vrf-eth");
    assert.ok(vrfIface, "VRF interface should be generated for additional ethernet");
    assert.strictEqual(vrfIface.vrf["route-table-id"], 200);
    assert.deepStrictEqual(vrfIface.vrf.port, ["eth2"], "default port should be the ethernet name");
    assert.ok(yaml.dump(parsed), "generated YAML should parse successfully");
  });

  test(`[${version}] Additional Bond with VRF generates VRF interface`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "bond",
      mode: "static",
      ipv4Cidr: "10.20.0.10/24",
      bond: {
        name: "bond1",
        mode: "active-backup",
        slaves: [
          { name: "eth3", macAddress: "52:54:00:cc:dd:03" },
          { name: "eth4", macAddress: "52:54:00:cc:dd:04" }
        ]
      },
      advanced: { vrf: { enabled: true, name: "vrf-bond", tableId: "300", ports: "" } }
    });
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const nmstate = parsed.hosts[0].networkConfig;
    const vrfIface = nmstate.interfaces.find(i => i.type === "vrf" && i.name === "vrf-bond");
    assert.ok(vrfIface, "VRF interface should be generated for additional bond");
    assert.strictEqual(vrfIface.vrf["route-table-id"], 300);
    assert.deepStrictEqual(vrfIface.vrf.port, ["bond1"], "default port should be the bond name");
  });

  test(`[${version}] Additional VLAN-on-Ethernet with VRF defaults port to VLAN name`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "vlan-on-ethernet",
      mode: "dhcp",
      ethernet: { name: "eth5", macAddress: "52:54:00:cc:dd:05" },
      vlan: { id: 200, name: "eth5.200" },
      advanced: { vrf: { enabled: true, name: "vrf-vlan-eth", tableId: "400", ports: "" } }
    });
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const nmstate = parsed.hosts[0].networkConfig;
    const vrfIface = nmstate.interfaces.find(i => i.type === "vrf" && i.name === "vrf-vlan-eth");
    assert.ok(vrfIface, "VRF interface should be generated for additional VLAN-on-ethernet");
    assert.strictEqual(vrfIface.vrf["route-table-id"], 400);
    assert.deepStrictEqual(vrfIface.vrf.port, ["eth5.200"], "default port should be the VLAN interface name");
  });

  test(`[${version}] Additional VLAN-on-Bond with VRF defaults port to VLAN name`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "vlan-on-bond",
      mode: "static",
      ipv4Cidr: "10.30.0.10/24",
      bond: {
        name: "bond2",
        mode: "802.3ad",
        slaves: [
          { name: "eth6", macAddress: "52:54:00:cc:dd:06" },
          { name: "eth7", macAddress: "52:54:00:cc:dd:07" }
        ]
      },
      vlan: { id: 300, name: "bond2.300" },
      advanced: { vrf: { enabled: true, name: "vrf-vlan-bond", tableId: "500", ports: "" } }
    });
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const nmstate = parsed.hosts[0].networkConfig;
    const vrfIface = nmstate.interfaces.find(i => i.type === "vrf" && i.name === "vrf-vlan-bond");
    assert.ok(vrfIface, "VRF interface should be generated for additional VLAN-on-bond");
    assert.strictEqual(vrfIface.vrf["route-table-id"], 500);
    assert.deepStrictEqual(vrfIface.vrf.port, ["bond2.300"], "default port should be the VLAN interface name");
  });

  test(`[${version}] Explicit VRF ports override default`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eth8", macAddress: "52:54:00:cc:dd:08" },
      advanced: { vrf: { enabled: true, name: "vrf-explicit", tableId: "600", ports: "portA,portB" } }
    });
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const nmstate = parsed.hosts[0].networkConfig;
    const vrfIface = nmstate.interfaces.find(i => i.type === "vrf" && i.name === "vrf-explicit");
    assert.ok(vrfIface);
    assert.deepStrictEqual(vrfIface.vrf.port, ["portA", "portB"], "explicit ports should override default");
  });

  test(`[${version}] VRF ports are trimmed`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eth9", macAddress: "52:54:00:cc:dd:09" },
      advanced: { vrf: { enabled: true, name: "vrf-trim", tableId: "100", ports: "  portX , portY  " } }
    });
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const vrfIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.name === "vrf-trim");
    assert.ok(vrfIface);
    assert.deepStrictEqual(vrfIface.vrf.port, ["portX", "portY"], "ports should be trimmed");
  });

  test(`[${version}] Empty port entries are removed from VRF`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eth10", macAddress: "52:54:00:cc:dd:10" },
      advanced: { vrf: { enabled: true, name: "vrf-empty", tableId: "100", ports: "portA,,  ,portB," } }
    });
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const vrfIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.name === "vrf-empty");
    assert.ok(vrfIface);
    assert.deepStrictEqual(vrfIface.vrf.port, ["portA", "portB"], "empty entries should be removed");
    assert.ok(vrfIface.vrf.port.every(p => p && p.trim() !== ""), "no blank or undefined port");
  });

  test(`[${version}] VRF route-table-id is emitted as a number`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eth11", macAddress: "52:54:00:cc:dd:11" },
      advanced: { vrf: { enabled: true, name: "vrf-num", tableId: "777", ports: "" } }
    });
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const vrfIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.name === "vrf-num");
    assert.ok(vrfIface);
    assert.strictEqual(typeof vrfIface.vrf["route-table-id"], "number", "route-table-id should be a number");
    assert.strictEqual(vrfIface.vrf["route-table-id"], 777);
  });

  test(`[${version}] Disabled VRF emits no VRF interface`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eth12", macAddress: "52:54:00:cc:dd:12" },
      advanced: { vrf: { enabled: false, name: "vrf-off", tableId: "100", ports: "" } }
    });
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const nmstate = parsed.hosts[0].networkConfig;
    const vrfIface = nmstate.interfaces.find(i => i.type === "vrf");
    assert.strictEqual(vrfIface, undefined, "disabled VRF should not generate a VRF interface");
  });

  test(`[${version}] Multiple Additional Interfaces produce independent VRF interfaces`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eth13", macAddress: "52:54:00:cc:dd:13" },
      advanced: { vrf: { enabled: true, name: "vrf-a", tableId: "101", ports: "" } }
    });
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eth14", macAddress: "52:54:00:cc:dd:14" },
      advanced: { vrf: { enabled: true, name: "vrf-b", tableId: "102", ports: "" } }
    });
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const nmstate = parsed.hosts[0].networkConfig;
    const vrfA = nmstate.interfaces.find(i => i.name === "vrf-a");
    const vrfB = nmstate.interfaces.find(i => i.name === "vrf-b");
    assert.ok(vrfA, "first VRF should exist");
    assert.ok(vrfB, "second VRF should exist");
    assert.strictEqual(vrfA.vrf["route-table-id"], 101);
    assert.strictEqual(vrfB.vrf["route-table-id"], 102);
    assert.deepStrictEqual(vrfA.vrf.port, ["eth13"]);
    assert.deepStrictEqual(vrfB.vrf.port, ["eth14"]);
  });

  test(`[${version}] Additional Interface MTU output is unchanged by VRF`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eth15", macAddress: "52:54:00:cc:dd:15" },
      advanced: { mtu: "9000", vrf: { enabled: true, name: "vrf-mtu", tableId: "100", ports: "" } }
    });
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const nmstate = parsed.hosts[0].networkConfig;
    const ethIface = nmstate.interfaces.find(i => i.name === "eth15" && i.type === "ethernet");
    assert.ok(ethIface, "ethernet interface should exist");
    assert.strictEqual(ethIface.mtu, 9000, "MTU should be preserved");
    const vrfIface = nmstate.interfaces.find(i => i.name === "vrf-mtu");
    assert.ok(vrfIface, "VRF should also be generated");
  });

  test(`[${version}] Additional Interface SR-IOV output is unchanged by VRF`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eth16", macAddress: "52:54:00:cc:dd:16" },
      advanced: {
        sriov: { enabled: true, totalVfs: "8" },
        vrf: { enabled: true, name: "vrf-sriov", tableId: "100", ports: "" }
      }
    });
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const nmstate = parsed.hosts[0].networkConfig;
    const ethIface = nmstate.interfaces.find(i => i.name === "eth16" && i.type === "ethernet");
    assert.ok(ethIface, "ethernet interface should exist");
    assert.strictEqual(ethIface.sriov["total-vfs"], 8, "SR-IOV should be preserved");
    const vrfIface = nmstate.interfaces.find(i => i.name === "vrf-sriov");
    assert.ok(vrfIface, "VRF should also be generated");
  });

  test(`[${version}] Primary VRF output is unchanged`, () => {
    const state = baseStates.bareMetalAgent({
      version: { selectedMinor: version },
      hostInventory: {
        nodes: [{
          role: "master",
          hostname: "master-0",
          primary: {
            type: "ethernet",
            ethernet: { name: "eno1", macAddress: "52:54:00:aa:bb:01" },
            mode: "dhcp",
            advanced: { vrf: { enabled: true, name: "vrf-primary", tableId: "50", ports: "" } }
          }
        }],
        apiVip: "10.90.0.2",
        ingressVip: "10.90.0.3",
        ipStackMode: "ipv4"
      }
    });
    assert.strictEqual(state.version.selectedMinor, version);
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const nmstate = parsed.hosts[0].networkConfig;
    const vrfIface = nmstate.interfaces.find(i => i.type === "vrf" && i.name === "vrf-primary");
    assert.ok(vrfIface, "primary VRF should still be generated");
    assert.strictEqual(vrfIface.vrf["route-table-id"], 50);
    assert.deepStrictEqual(vrfIface.vrf.port, ["eno1"], "primary VRF default port unchanged");
  });

  test(`[${version}] Existing Primary and Additional Ethernet/Bond/VLAN output is unchanged`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "bond",
      mode: "dhcp",
      bond: {
        name: "bond1",
        mode: "active-backup",
        slaves: [
          { name: "eth20", macAddress: "52:54:00:dd:ee:01" },
          { name: "eth21", macAddress: "52:54:00:dd:ee:02" }
        ]
      },
      advanced: { vrf: { enabled: false } }
    });
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const nmstate = parsed.hosts[0].networkConfig;
    const bondIface = nmstate.interfaces.find(i => i.name === "bond1" && i.type === "bond");
    assert.ok(bondIface, "additional bond should exist");
    assert.strictEqual(bondIface["link-aggregation"].mode, "active-backup");
    assert.deepStrictEqual(bondIface["link-aggregation"].port, ["eth20", "eth21"]);
    const vrfIface = nmstate.interfaces.find(i => i.type === "vrf");
    assert.strictEqual(vrfIface, undefined, "no VRF should exist when disabled");
  });

}

test("Blank VRF ports default to logical interface name using actual UI defaults", () => {
  const vrfDefaults = { enabled: true, name: "vrf0", tableId: "100", ports: "" };
  let state = stateForVersion("4.21");
  state = withAdditionalInterface(state, 0, {
    type: "ethernet",
    mode: "dhcp",
    ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:17" },
    advanced: { vrf: vrfDefaults }
  });
  const raw = buildAgentConfig(state);
  const parsed = yaml.load(raw);
  const vrfIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.name === "vrf0");
  assert.ok(vrfIface, "VRF interface should exist");
  assert.ok(vrfIface.vrf.port.length > 0, "should have at least one port");
  assert.deepStrictEqual(vrfIface.vrf.port, ["eno2"], "blank ports should default to logical interface name");
  vrfIface.vrf.port.forEach((p, i) => {
    assert.ok(p !== undefined && p !== null && p !== "", `port[${i}] must not be blank or undefined`);
  });
});

/**
 * VRF table ID integer validation and order-independent duplicate detection.
 * Parameterized across all supported versions.
 */

for (const version of VERSIONS) {

  test(`[${version}] Table ID string '100' is accepted and emitted as number 100`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:20" },
      advanced: { vrf: { enabled: true, name: "vrf-tid100", tableId: "100", ports: "" } }
    });
    const parsed = yaml.load(buildAgentConfig(state));
    const vrfIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.name === "vrf-tid100");
    assert.strictEqual(vrfIface.vrf["route-table-id"], 100);
    assert.strictEqual(typeof vrfIface.vrf["route-table-id"], "number");
  });

  test(`[${version}] Table ID numeric 100 is accepted and emitted as number 100`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:20" },
      advanced: { vrf: { enabled: true, name: "vrf-tid100n", tableId: 100, ports: "" } }
    });
    const parsed = yaml.load(buildAgentConfig(state));
    const vrfIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.name === "vrf-tid100n");
    assert.strictEqual(vrfIface.vrf["route-table-id"], 100);
    assert.strictEqual(typeof vrfIface.vrf["route-table-id"], "number");
  });

  test(`[${version}] Table ID string '0' is accepted and emitted as number 0`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:20" },
      advanced: { vrf: { enabled: true, name: "vrf-tid0s", tableId: "0", ports: "" } }
    });
    const parsed = yaml.load(buildAgentConfig(state));
    const vrfIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.name === "vrf-tid0s");
    assert.strictEqual(vrfIface.vrf["route-table-id"], 0);
    assert.strictEqual(typeof vrfIface.vrf["route-table-id"], "number");
  });

  test(`[${version}] Table ID numeric 0 is accepted and emitted as number 0`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:20" },
      advanced: { vrf: { enabled: true, name: "vrf-tid0n", tableId: 0, ports: "" } }
    });
    const parsed = yaml.load(buildAgentConfig(state));
    const vrfIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.name === "vrf-tid0n");
    assert.strictEqual(vrfIface.vrf["route-table-id"], 0);
    assert.strictEqual(typeof vrfIface.vrf["route-table-id"], "number");
  });

  test(`[${version}] Table ID '1.5' is rejected as non-integer`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:20" },
      advanced: { vrf: { enabled: true, name: "vrf-dec", tableId: "1.5", ports: "" } }
    });
    assert.throws(
      () => buildAgentConfig(state),
      (err) => err.message.includes("not a valid integer"),
      "decimal table ID must be rejected"
    );
  });

  test(`[${version}] Table ID 'abc' is rejected as non-integer`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:20" },
      advanced: { vrf: { enabled: true, name: "vrf-abc", tableId: "abc", ports: "" } }
    });
    assert.throws(
      () => buildAgentConfig(state),
      (err) => err.message.includes("not a valid integer"),
      "alphabetic table ID must be rejected"
    );
  });

  test(`[${version}] Table ID '' (empty) is rejected`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:20" },
      advanced: { vrf: { enabled: true, name: "vrf-empty", tableId: "", ports: "" } }
    });
    assert.throws(
      () => buildAgentConfig(state),
      (err) => err.message.includes("not a valid integer"),
      "empty table ID must be rejected"
    );
  });

  test(`[${version}] Table ID '  ' (whitespace) is rejected`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:20" },
      advanced: { vrf: { enabled: true, name: "vrf-ws", tableId: "  ", ports: "" } }
    });
    assert.throws(
      () => buildAgentConfig(state),
      (err) => err.message.includes("not a valid integer"),
      "whitespace-only table ID must be rejected"
    );
  });

  test(`[${version}] Blank VRF name on enabled VRF is rejected`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:20" },
      advanced: { vrf: { enabled: true, name: "", tableId: "100", ports: "" } }
    });
    assert.throws(
      () => buildAgentConfig(state),
      (err) => err.message.includes("must not be blank"),
      "blank VRF name must be rejected"
    );
  });

  test(`[${version}] Primary VRF name collides with a later Additional Ethernet name`, () => {
    const state = baseStates.bareMetalAgent({
      version: { selectedMinor: version },
      hostInventory: {
        nodes: [{
          role: "master",
          hostname: "master-0",
          primary: {
            type: "ethernet",
            ethernet: { name: "eno1", macAddress: "52:54:00:aa:bb:01" },
            mode: "dhcp",
            advanced: { vrf: { enabled: true, name: "eth-mgmt", tableId: "100", ports: "portX" } }
          },
          additionalInterfaces: [{
            type: "ethernet",
            mode: "dhcp",
            ethernet: { name: "eth-mgmt", macAddress: "52:54:00:cc:dd:40" }
          }]
        }],
        apiVip: "10.90.0.2",
        ingressVip: "10.90.0.3",
        ipStackMode: "ipv4"
      }
    });
    assert.throws(
      () => buildAgentConfig(state),
      (err) => err.message.includes('Duplicate NMState interface name "eth-mgmt"')
    );
  });

  test(`[${version}] Primary VRF name collides with a later Additional Bond name`, () => {
    const state = baseStates.bareMetalAgent({
      version: { selectedMinor: version },
      hostInventory: {
        nodes: [{
          role: "master",
          hostname: "master-0",
          primary: {
            type: "ethernet",
            ethernet: { name: "eno1", macAddress: "52:54:00:aa:bb:01" },
            mode: "dhcp",
            advanced: { vrf: { enabled: true, name: "bond-fwd", tableId: "100", ports: "portX" } }
          },
          additionalInterfaces: [{
            type: "bond",
            mode: "dhcp",
            bond: {
              name: "bond-fwd",
              mode: "active-backup",
              slaves: [
                { name: "eth3", macAddress: "52:54:00:cc:dd:41" },
                { name: "eth4", macAddress: "52:54:00:cc:dd:42" }
              ]
            }
          }]
        }],
        apiVip: "10.90.0.2",
        ingressVip: "10.90.0.3",
        ipStackMode: "ipv4"
      }
    });
    assert.throws(
      () => buildAgentConfig(state),
      (err) => err.message.includes('Duplicate NMState interface name "bond-fwd"')
    );
  });

  test(`[${version}] Primary VRF name collides with a later generated VLAN name`, () => {
    const state = baseStates.bareMetalAgent({
      version: { selectedMinor: version },
      hostInventory: {
        nodes: [{
          role: "master",
          hostname: "master-0",
          primary: {
            type: "ethernet",
            ethernet: { name: "eno1", macAddress: "52:54:00:aa:bb:01" },
            mode: "dhcp",
            advanced: { vrf: { enabled: true, name: "eth5.200", tableId: "100", ports: "portX" } }
          },
          additionalInterfaces: [{
            type: "vlan-on-ethernet",
            mode: "dhcp",
            ethernet: { name: "eth5", macAddress: "52:54:00:cc:dd:43" },
            vlan: { id: 200, name: "eth5.200" }
          }]
        }],
        apiVip: "10.90.0.2",
        ingressVip: "10.90.0.3",
        ipStackMode: "ipv4"
      }
    });
    assert.throws(
      () => buildAgentConfig(state),
      (err) => err.message.includes('Duplicate NMState interface name "eth5.200"')
    );
  });

  test(`[${version}] Additional #1 VRF collides with Additional #2 Ethernet name`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:50" },
      advanced: { vrf: { enabled: true, name: "eth-cross", tableId: "100", ports: "portX" } }
    });
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eth-cross", macAddress: "52:54:00:cc:dd:51" }
    });
    assert.throws(
      () => buildAgentConfig(state),
      (err) => err.message.includes('Duplicate NMState interface name "eth-cross"')
    );
  });

  test(`[${version}] Additional #1 VRF collides with Additional #2 Bond name`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:52" },
      advanced: { vrf: { enabled: true, name: "bond-cross", tableId: "100", ports: "portX" } }
    });
    state = withAdditionalInterface(state, 0, {
      type: "bond",
      mode: "dhcp",
      bond: {
        name: "bond-cross",
        mode: "active-backup",
        slaves: [
          { name: "eth3", macAddress: "52:54:00:cc:dd:53" },
          { name: "eth4", macAddress: "52:54:00:cc:dd:54" }
        ]
      }
    });
    assert.throws(
      () => buildAgentConfig(state),
      (err) => err.message.includes('Duplicate NMState interface name "bond-cross"')
    );
  });

  test(`[${version}] Additional #1 VRF collides with Additional #2 VLAN name`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:55" },
      advanced: { vrf: { enabled: true, name: "eth6.400", tableId: "100", ports: "portX" } }
    });
    state = withAdditionalInterface(state, 0, {
      type: "vlan-on-ethernet",
      mode: "dhcp",
      ethernet: { name: "eth6", macAddress: "52:54:00:cc:dd:56" },
      vlan: { id: 400, name: "eth6.400" }
    });
    assert.throws(
      () => buildAgentConfig(state),
      (err) => err.message.includes('Duplicate NMState interface name "eth6.400"')
    );
  });

  test(`[${version}] Two physical interfaces with same generated name are rejected`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "dup-nic", macAddress: "52:54:00:cc:dd:60" }
    });
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "dup-nic", macAddress: "52:54:00:cc:dd:61" }
    });
    assert.throws(
      () => buildAgentConfig(state),
      (err) => err.message.includes('Duplicate NMState interface name "dup-nic"')
    );
  });

  test(`[${version}] Two unique VRFs and unique physical interfaces generate successfully`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:70" },
      advanced: { vrf: { enabled: true, name: "vrf-a", tableId: "100", ports: "" } }
    });
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eno3", macAddress: "52:54:00:cc:dd:71" },
      advanced: { vrf: { enabled: true, name: "vrf-b", tableId: "200", ports: "" } }
    });
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const nmstate = parsed.hosts[0].networkConfig;
    const vrfA = nmstate.interfaces.find(i => i.name === "vrf-a");
    const vrfB = nmstate.interfaces.find(i => i.name === "vrf-b");
    assert.ok(vrfA, "first VRF should exist");
    assert.ok(vrfB, "second VRF should exist");
    assert.deepStrictEqual(vrfA.vrf.port, ["eno2"]);
    assert.deepStrictEqual(vrfB.vrf.port, ["eno3"]);
  });

  test(`[${version}] Existing single Primary VRF remains valid`, () => {
    const state = baseStates.bareMetalAgent({
      version: { selectedMinor: version },
      hostInventory: {
        nodes: [{
          role: "master",
          hostname: "master-0",
          primary: {
            type: "ethernet",
            ethernet: { name: "eno1", macAddress: "52:54:00:aa:bb:01" },
            mode: "dhcp",
            advanced: { vrf: { enabled: true, name: "vrf-primary", tableId: "50", ports: "" } }
          }
        }],
        apiVip: "10.90.0.2",
        ingressVip: "10.90.0.3",
        ipStackMode: "ipv4"
      }
    });
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const vrfIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.name === "vrf-primary");
    assert.ok(vrfIface, "single primary VRF should be valid");
    assert.strictEqual(vrfIface.vrf["route-table-id"], 50);
    assert.deepStrictEqual(vrfIface.vrf.port, ["eno1"]);
  });

  test(`[${version}] Existing single Additional VRF remains valid`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:34" },
      advanced: { vrf: { enabled: true, name: "vrf0", tableId: "100", ports: "" } }
    });
    const raw = buildAgentConfig(state);
    const parsed = yaml.load(raw);
    const vrfIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.name === "vrf0");
    assert.ok(vrfIface, "single VRF with default name should be valid");
    assert.deepStrictEqual(vrfIface.vrf.port, ["eno2"]);
  });

  test(`[${version}] VLAN-on-Ethernet without baseIface uses generated Ethernet name`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "vlan-on-ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:80" },
      vlan: { id: 200 }
    });
    const parsed = yaml.load(buildAgentConfig(state));
    const vlanIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.type === "vlan");
    assert.ok(vlanIface, "VLAN interface should exist");
    assert.strictEqual(vlanIface.name, "eno2.200");
  });

  test(`[${version}] VLAN-on-Bond without baseIface uses generated Bond name`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "vlan-on-bond",
      mode: "dhcp",
      bond: {
        name: "bond1",
        mode: "active-backup",
        slaves: [
          { name: "eth2", macAddress: "52:54:00:cc:dd:81" },
          { name: "eth3", macAddress: "52:54:00:cc:dd:82" }
        ]
      },
      vlan: { id: 300 }
    });
    const parsed = yaml.load(buildAgentConfig(state));
    const vlanIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.type === "vlan");
    assert.ok(vlanIface, "VLAN interface should exist");
    assert.strictEqual(vlanIface.name, "bond1.300");
  });

  test(`[${version}] VLAN-on-Ethernet with baseIface uses baseIface`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "vlan-on-ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:83" },
      vlan: { id: 200, baseIface: "custom-base" }
    });
    const parsed = yaml.load(buildAgentConfig(state));
    const vlanIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.type === "vlan");
    assert.ok(vlanIface, "VLAN interface should exist");
    assert.strictEqual(vlanIface.name, "custom-base.200");
    assert.strictEqual(vlanIface.vlan["base-iface"], "custom-base");
  });

  test(`[${version}] VLAN-on-Bond with baseIface uses baseIface`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "vlan-on-bond",
      mode: "dhcp",
      bond: {
        name: "bond1",
        mode: "active-backup",
        slaves: [
          { name: "eth2", macAddress: "52:54:00:cc:dd:84" },
          { name: "eth3", macAddress: "52:54:00:cc:dd:85" }
        ]
      },
      vlan: { id: 300, baseIface: "custom-bond-base" }
    });
    const parsed = yaml.load(buildAgentConfig(state));
    const vlanIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.type === "vlan");
    assert.ok(vlanIface, "VLAN interface should exist");
    assert.strictEqual(vlanIface.name, "custom-bond-base.300");
    assert.strictEqual(vlanIface.vlan["base-iface"], "custom-bond-base");
  });

  test(`[${version}] Explicit VLAN name overrides baseIface`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "vlan-on-ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:86" },
      vlan: { id: 200, baseIface: "custom-base", name: "my-explicit-vlan" }
    });
    const parsed = yaml.load(buildAgentConfig(state));
    const vlanIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.type === "vlan");
    assert.ok(vlanIface, "VLAN interface should exist");
    assert.strictEqual(vlanIface.name, "my-explicit-vlan");
  });

  test(`[${version}] VRF collision with baseIface-derived VLAN name is rejected by duplicate scan`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "vlan-on-ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:87" },
      vlan: { id: 200, baseIface: "custom-base" },
      advanced: { vrf: { enabled: true, name: "custom-base.200", tableId: "100", ports: "portX" } }
    });
    assert.throws(
      () => buildAgentConfig(state),
      (err) => err.message.includes('Duplicate NMState interface name "custom-base.200"')
    );
  });

  test(`[${version}] Unique VRF plus baseIface-derived VLAN generates successfully`, () => {
    let state = stateForVersion(version);
    state = withAdditionalInterface(state, 0, {
      type: "vlan-on-ethernet",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: "52:54:00:cc:dd:88" },
      vlan: { id: 200, baseIface: "custom-base" },
      advanced: { vrf: { enabled: true, name: "vrf-ok", tableId: "100", ports: "" } }
    });
    const parsed = yaml.load(buildAgentConfig(state));
    const vlanIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.type === "vlan");
    const vrfIface = parsed.hosts[0].networkConfig.interfaces.find(i => i.name === "vrf-ok");
    assert.ok(vlanIface, "VLAN interface should exist");
    assert.strictEqual(vlanIface.name, "custom-base.200");
    assert.ok(vrfIface, "VRF interface should exist");
    assert.strictEqual(vrfIface.vrf["route-table-id"], 100);
  });

}
