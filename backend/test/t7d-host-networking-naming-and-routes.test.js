/**
 * Tranche 7D — host-networking interface naming, and static routes.
 *
 * THREE DEFECTS ARE PINNED HERE.
 *
 * 1. VLAN NAME DRIFT. The interface name a row produces was derived in six
 *    independent places — two in the generator, three in the node editor, one
 *    in validation — and they disagreed. The additional-interface editor field
 *    checked `ethernet.name` before `bond.name`, and because every row created
 *    in the UI is seeded with an `ethernet.name` regardless of its type, a VLAN
 *    on a bond was DISPLAYED as `eno2.100` (a bond MEMBER nic) while the
 *    generator correctly wrote `bond0.100`. Mirrored defect: the editor ignored
 *    `vlan.baseIface`, so an imported run rendered one name and generated
 *    another. All six now call shared/interfaceNaming.js, and the expectations
 *    below come from shared/interfaceNaming.fixtures.js — the same table the
 *    frontend editor test asserts against, so the two cannot drift apart
 *    silently again.
 *
 * 2. ROUTE NEXT-HOP DRIFT. `getPrimaryInterfaceName` had its own third
 *    derivation, used for every route's `next-hop-interface`. For a
 *    `vlan-on-bond` primary with a blank bond name it fell back to `eth0`,
 *    naming an interface the generated document does not contain.
 *
 * 3. SILENTLY DISCARDED ROUTES. `additionalInterfaces[].advanced.routes` was
 *    seeded into state by the UI's createInterfaceConfig, written by no editor
 *    and read by no generator. Anything an imported run carried there vanished
 *    at generation without a word.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";

import { buildAgentConfig } from "../src/generate.js";
import { bareMetalAgent } from "./fixtures/base-states.js";
import { INTERFACE_NAMING_CASES } from "../../shared/interfaceNaming.fixtures.js";
import {
  PRIMARY_NAME_FALLBACKS,
  resolveEffectiveInterfaceName,
  resolveVlanInterfaceName,
  resolveBaseInterfaceName
} from "../../shared/interfaceNaming.js";

const MINOR = "4.22";
const PATCH = "4.22.16";

const ETH = { name: "ethernet0", macAddress: "00:00:5E:00:53:0A" };

const withAdvanced = (iface, advanced = {}) => ({
  ...iface,
  advanced: {
    mtu: "1500",
    sriov: { enabled: false, totalVfs: "" },
    vrf: { enabled: false, name: "vrf0", tableId: "100", ports: "" },
    routes: [],
    ...advanced
  }
});

/** A three-node agent state whose nodes all carry the given primary row. */
const stateWithPrimary = (primary, { ipStackMode = "ipv4" } = {}) => {
  const node = (hostname) => ({
    hostname,
    role: "master",
    rootDevice: "",
    bmc: {},
    dnsServers: "",
    dnsSearch: "",
    primary: withAdvanced(primary),
    additionalInterfaces: []
  });
  return bareMetalAgent({
    version: { selectedMinor: MINOR, selectedPatch: PATCH, selectedChannel: `stable-${MINOR}`, locked: true },
    release: { channel: MINOR, patchVersion: PATCH, confirmed: true },
    hostInventory: { nodes: [node("m0"), node("m1"), node("m2")], ipStackMode }
  });
};

/** The same, but the row under test is an ADDITIONAL interface. */
const stateWithAdditional = (iface, { ipStackMode = "ipv4", routes = [] } = {}) => {
  const node = (hostname) => ({
    hostname,
    role: "master",
    rootDevice: "",
    bmc: {},
    dnsServers: "",
    dnsSearch: "",
    primary: withAdvanced({
      type: "ethernet",
      mode: "static",
      ipv4Cidr: "192.0.2.10/24",
      ipv4Gateway: "192.0.2.1",
      ipv6Cidr: "2001:db8::10/64",
      ipv6Gateway: "2001:db8::1",
      ethernet: { ...ETH },
      bond: { name: "bond9", mode: "active-backup", slaves: [] },
      vlan: { id: "", baseIface: "", name: "" }
    }),
    additionalInterfaces: [withAdvanced(iface, { routes })]
  });
  return bareMetalAgent({
    version: { selectedMinor: MINOR, selectedPatch: PATCH, selectedChannel: `stable-${MINOR}`, locked: true },
    release: { channel: MINOR, patchVersion: PATCH, confirmed: true },
    hostInventory: { nodes: [node("m0"), node("m1"), node("m2")], ipStackMode }
  });
};

const netConfig = (state) => yaml.load(buildAgentConfig(state)).hosts[0].networkConfig;

/* ------------------------------------------------------------------ */
/* 1. The shared contract itself                                        */
/* ------------------------------------------------------------------ */

describe("T7D — shared interface-naming contract", () => {
  for (const c of INTERFACE_NAMING_CASES) {
    it(`${c.id}: resolves to ${c.expectedName}`, () => {
      assert.equal(resolveEffectiveInterfaceName(c.iface), c.expectedName);
      if (c.mustNotEqual) {
        assert.notEqual(resolveEffectiveInterfaceName(c.iface), c.mustNotEqual);
      }
    });
    if (c.expectedBase !== null) {
      it(`${c.id}: base interface is ${c.expectedBase}`, () => {
        assert.equal(resolveBaseInterfaceName(c.iface), c.expectedBase);
      });
    }
  }

  it("an incomplete VLAN row has no name, rather than a half-formed one", () => {
    const iface = { type: "vlan-on-bond", bond: { name: "bond0" }, vlan: { id: "", baseIface: "", name: "" } };
    assert.equal(resolveVlanInterfaceName(iface), "");
  });

  it("a VLAN row with a base but no id degrades to the base, so a next hop is never blank", () => {
    const iface = { type: "vlan-on-bond", bond: { name: "bond0" }, vlan: { id: "", baseIface: "", name: "" } };
    assert.equal(resolveEffectiveInterfaceName(iface), "bond0");
  });

  it("primary fallbacks match what buildNmState substitutes for a blank name", () => {
    assert.equal(
      resolveEffectiveInterfaceName({ type: "ethernet", ethernet: { name: "" } }, PRIMARY_NAME_FALLBACKS),
      "eth0"
    );
    assert.equal(
      resolveEffectiveInterfaceName({ type: "bond", bond: { name: "" } }, PRIMARY_NAME_FALLBACKS),
      "bond0"
    );
  });

  it("an additional interface gets NO fallback — the generator skips an unnamed row", () => {
    assert.equal(resolveEffectiveInterfaceName({ type: "ethernet", ethernet: { name: "" } }), "");
  });
});

/* ------------------------------------------------------------------ */
/* 2. The generator agrees with the contract, primary and additional    */
/* ------------------------------------------------------------------ */

describe("T7D — generated NMState names match the shared contract", () => {
  for (const c of INTERFACE_NAMING_CASES) {
    it(`primary ${c.id} → interfaces[] contains ${c.expectedName}`, () => {
      const nc = netConfig(stateWithPrimary(c.iface));
      const names = nc.interfaces.map((i) => i.name);
      assert.ok(names.includes(c.expectedName), `expected ${c.expectedName} in ${JSON.stringify(names)}`);
      if (c.mustNotEqual) {
        assert.ok(!names.includes(c.mustNotEqual), `${c.mustNotEqual} must not be generated`);
      }
    });

    it(`additional ${c.id} → interfaces[] contains ${c.expectedName}`, () => {
      const nc = netConfig(stateWithAdditional(c.iface));
      const names = nc.interfaces.map((i) => i.name);
      assert.ok(names.includes(c.expectedName), `expected ${c.expectedName} in ${JSON.stringify(names)}`);
      if (c.mustNotEqual) {
        assert.ok(!names.includes(c.mustNotEqual), `${c.mustNotEqual} must not be generated`);
      }
    });

    if (c.expectedBase !== null) {
      it(`primary ${c.id} → vlan.base-iface is ${c.expectedBase}`, () => {
        const nc = netConfig(stateWithPrimary(c.iface));
        const vlan = nc.interfaces.find((i) => i.type === "vlan");
        assert.ok(vlan, "no vlan interface generated");
        assert.equal(vlan.vlan["base-iface"], c.expectedBase);
      });
    }
  }

  it("the default route's next-hop-interface is the primary's effective name", () => {
    const primary = {
      type: "vlan-on-bond",
      mode: "static",
      ipv4Cidr: "192.0.2.10/24",
      ipv4Gateway: "192.0.2.1",
      ethernet: { name: "eno2", macAddress: "00:00:5E:00:53:03" },
      bond: {
        name: "bond0",
        mode: "active-backup",
        slaves: [
          { name: "eno1", macAddress: "00:00:5E:00:53:01" },
          { name: "eno2", macAddress: "00:00:5E:00:53:02" }
        ]
      },
      vlan: { id: "100", baseIface: "", name: "" }
    };
    const nc = netConfig(stateWithPrimary(primary));
    const def = nc.routes.config.find((r) => r.destination === "0.0.0.0/0");
    assert.ok(def, "no default route generated");
    assert.equal(def["next-hop-interface"], "bond0.100");
    assert.ok(
      nc.interfaces.some((i) => i.name === def["next-hop-interface"]),
      "the default route names an interface the document does not contain"
    );
  });

  it("a vlan-on-bond primary with a blank bond name routes via bond0, not a non-existent eth0", () => {
    /* getPrimaryInterfaceName used to fall back to eth0 here while
       buildNmState emitted the bond as bond0. */
    const primary = {
      type: "vlan-on-bond",
      mode: "static",
      ipv4Cidr: "192.0.2.10/24",
      ipv4Gateway: "192.0.2.1",
      ethernet: { name: "", macAddress: "" },
      bond: {
        name: "",
        mode: "active-backup",
        slaves: [
          { name: "eno1", macAddress: "00:00:5E:00:53:01" },
          { name: "eno2", macAddress: "00:00:5E:00:53:02" }
        ]
      },
      vlan: { id: "100", baseIface: "", name: "" }
    };
    const nc = netConfig(stateWithPrimary(primary));
    const def = nc.routes.config.find((r) => r.destination === "0.0.0.0/0");
    assert.equal(def["next-hop-interface"], "bond0.100");
    assert.ok(nc.interfaces.some((i) => i.name === "bond0.100"));
    assert.ok(!nc.interfaces.some((i) => i.name === "eth0"));
  });
});

/* ------------------------------------------------------------------ */
/* 3. Static routes: additional interfaces, and address families        */
/* ------------------------------------------------------------------ */

describe("T7D — additional-interface routes are generated, not discarded", () => {
  const ethIface = {
    type: "ethernet",
    mode: "static",
    ipv4Cidr: "198.51.100.20/24",
    ethernet: { name: "eno7", macAddress: "00:00:5E:00:53:07" },
    bond: { name: "bond8", mode: "active-backup", slaves: [] },
    vlan: { id: "", baseIface: "", name: "" }
  };

  it("emits a route authored on an additional interface", () => {
    const nc = netConfig(
      stateWithAdditional(ethIface, {
        routes: [{ destination: "203.0.113.0/24", nextHopAddress: "198.51.100.254", nextHopInterface: "" }]
      })
    );
    const route = nc.routes.config.find((r) => r.destination === "203.0.113.0/24");
    assert.ok(route, "the additional interface's route was dropped");
    assert.equal(route["next-hop-address"], "198.51.100.254");
    assert.equal(route["table-id"], 254);
  });

  it("defaults the next hop to the additional interface's own name, not the primary's", () => {
    const nc = netConfig(
      stateWithAdditional(ethIface, {
        routes: [{ destination: "203.0.113.0/24", nextHopAddress: "198.51.100.254", nextHopInterface: "" }]
      })
    );
    const route = nc.routes.config.find((r) => r.destination === "203.0.113.0/24");
    assert.equal(route["next-hop-interface"], "eno7");
    assert.notEqual(route["next-hop-interface"], ETH.name);
  });

  it("uses the VLAN device when the additional interface is a VLAN on a bond", () => {
    const vlanOnBond = {
      type: "vlan-on-bond",
      mode: "static",
      ipv4Cidr: "198.51.100.20/24",
      ethernet: { name: "eno2", macAddress: "00:00:5E:00:53:03" },
      bond: {
        name: "bond1",
        mode: "active-backup",
        slaves: [
          { name: "eno3", macAddress: "00:00:5E:00:53:04" },
          { name: "eno4", macAddress: "00:00:5E:00:53:05" }
        ]
      },
      vlan: { id: "200", baseIface: "", name: "" }
    };
    const nc = netConfig(
      stateWithAdditional(vlanOnBond, {
        routes: [{ destination: "203.0.113.0/24", nextHopAddress: "198.51.100.254", nextHopInterface: "" }]
      })
    );
    const route = nc.routes.config.find((r) => r.destination === "203.0.113.0/24");
    assert.equal(route["next-hop-interface"], "bond1.200");
  });

  it("an explicit next-hop interface is honoured", () => {
    const nc = netConfig(
      stateWithAdditional(ethIface, {
        routes: [{ destination: "203.0.113.0/24", nextHopAddress: "198.51.100.254", nextHopInterface: "eno7" }]
      })
    );
    const route = nc.routes.config.find((r) => r.destination === "203.0.113.0/24");
    assert.equal(route["next-hop-interface"], "eno7");
  });

  it("an incomplete route row is skipped rather than emitted half-formed", () => {
    const nc = netConfig(
      stateWithAdditional(ethIface, {
        routes: [{ destination: "", nextHopAddress: "", nextHopInterface: "" }]
      })
    );
    assert.ok(!nc.routes.config.some((r) => !r.destination || !r["next-hop-address"]));
  });

  it("every emitted route names an interface that exists in the document", () => {
    const nc = netConfig(
      stateWithAdditional(ethIface, {
        routes: [{ destination: "203.0.113.0/24", nextHopAddress: "198.51.100.254", nextHopInterface: "" }]
      })
    );
    const names = new Set(nc.interfaces.map((i) => i.name));
    for (const r of nc.routes.config) {
      assert.ok(names.has(r["next-hop-interface"]), `route next hop ${r["next-hop-interface"]} is not an interface`);
    }
  });
});

describe("T7D — extra routes respect the cluster IP stack mode", () => {
  const primaryV6 = {
    type: "ethernet",
    mode: "static",
    ipv4Cidr: "192.0.2.10/24",
    ipv4Gateway: "192.0.2.1",
    ipv6Cidr: "2001:db8::10/64",
    ipv6Gateway: "2001:db8::1",
    ethernet: { ...ETH },
    bond: { name: "bond0", mode: "active-backup", slaves: [] },
    vlan: { id: "", baseIface: "", name: "" }
  };

  const routes = [
    { destination: "203.0.113.0/24", nextHopAddress: "192.0.2.254", nextHopInterface: "" },
    { destination: "2001:db8:2::/64", nextHopAddress: "2001:db8::254", nextHopInterface: "" }
  ];

  const primaryWithRoutes = () => ({ ...primaryV6 });

  const generate = (ipStackMode) => {
    const state = stateWithPrimary(primaryWithRoutes(), { ipStackMode });
    state.hostInventory.nodes.forEach((n) => { n.primary.advanced.routes = routes.map((r) => ({ ...r })); });
    return netConfig(state);
  };

  it("ipv4-only: the IPv4 extra route is emitted and the IPv6 one is not", () => {
    const nc = generate("ipv4");
    assert.ok(nc.routes.config.some((r) => r.destination === "203.0.113.0/24"));
    assert.ok(!nc.routes.config.some((r) => r.destination === "2001:db8:2::/64"));
  });

  it("ipv6-only: the IPv6 extra route is emitted and the IPv4 one is not", () => {
    const nc = generate("ipv6");
    assert.ok(nc.routes.config.some((r) => r.destination === "2001:db8:2::/64"));
    assert.ok(!nc.routes.config.some((r) => r.destination === "203.0.113.0/24"));
  });

  it("dual-stack: both extra routes are emitted", () => {
    const nc = generate("dual-stack");
    assert.ok(nc.routes.config.some((r) => r.destination === "203.0.113.0/24"));
    assert.ok(nc.routes.config.some((r) => r.destination === "2001:db8:2::/64"));
  });

  it("ipv6-only disables IPv4 on every interface, which is why an IPv4 route cannot ride it", () => {
    const nc = generate("ipv6");
    for (const i of nc.interfaces) {
      assert.equal(i.ipv4?.enabled, false, `${i.name} has IPv4 enabled in an IPv6-only cluster`);
    }
  });

  it("a static route on a DHCP primary is still emitted — DHCP is not a reason to drop it", () => {
    const state = stateWithPrimary({ ...primaryV6, mode: "dhcp" }, { ipStackMode: "ipv4" });
    state.hostInventory.nodes.forEach((n) => {
      n.primary.advanced.routes = [{ destination: "203.0.113.0/24", nextHopAddress: "192.0.2.254", nextHopInterface: "" }];
    });
    const nc = netConfig(state);
    assert.ok(nc.routes.config.some((r) => r.destination === "203.0.113.0/24"));
    // ...but there is no default route, because DHCP supplies it.
    assert.ok(!nc.routes.config.some((r) => r.destination === "0.0.0.0/0"));
  });
});

/* ------------------------------------------------------------------ */
/* 4. Import round trip                                                 */
/* ------------------------------------------------------------------ */

describe("T7D — an imported run's routes survive regeneration", () => {
  /* A saved run from before additional-interface routes were generated. Its
     values must come back out of the generator unchanged, which is the proof
     that importing it no longer loses data. */
  const importedAdditional = {
    type: "vlan-on-bond",
    mode: "static",
    ipv4Cidr: "198.51.100.20/24",
    ethernet: { name: "eno2", macAddress: "00:00:5E:00:53:03" },
    bond: {
      name: "bond1",
      mode: "802.3ad",
      slaves: [
        { name: "eno3", macAddress: "00:00:5E:00:53:04" },
        { name: "eno4", macAddress: "00:00:5E:00:53:05" }
      ]
    },
    vlan: { id: "200", baseIface: "mgmt0", name: "" }
  };

  const imported = () =>
    stateWithAdditional(importedAdditional, {
      routes: [
        { destination: "203.0.113.0/24", nextHopAddress: "198.51.100.254", nextHopInterface: "" },
        { destination: "198.18.0.0/15", nextHopAddress: "198.51.100.253", nextHopInterface: "mgmt0.200" }
      ]
    });

  it("regenerates both imported routes", () => {
    const nc = netConfig(imported());
    assert.ok(nc.routes.config.some((r) => r.destination === "203.0.113.0/24"));
    assert.ok(nc.routes.config.some((r) => r.destination === "198.18.0.0/15"));
  });

  it("honours the imported explicit vlan.baseIface for the interface name and the route", () => {
    const nc = netConfig(imported());
    assert.ok(nc.interfaces.some((i) => i.name === "mgmt0.200"));
    const r = nc.routes.config.find((x) => x.destination === "203.0.113.0/24");
    assert.equal(r["next-hop-interface"], "mgmt0.200");
  });

  it("is stable across two generations of the same state (round trip)", () => {
    const a = netConfig(imported());
    const b = netConfig(imported());
    assert.deepEqual(a.routes.config, b.routes.config);
    assert.deepEqual(a.interfaces.map((i) => i.name), b.interfaces.map((i) => i.name));
  });
});
