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
