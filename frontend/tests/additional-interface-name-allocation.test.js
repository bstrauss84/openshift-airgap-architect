/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * A new Additional Interface must not default to a name already in use.
 *
 * Human QA B1 (7C.4B): a host whose PRIMARY was a bond (`bond0`, members
 * `eno0`/`eno1`) produced `Duplicate NMState interface name "eno0"` as soon as
 * a second interface was added and switched to Bond.
 *
 * Root cause: only the new row's ETHERNET name was allocated. `createInterfaceConfig`
 * seeds a complete bond block on every row regardless of type — `bond0` with
 * members `eno0` and `eno1` — and those literals became live the moment the
 * user changed the row's type. The old `getNextEnoName` also skipped the
 * primary's ethernet name unless the primary was an ethernet/VLAN-on-ethernet
 * row, so a name visible on screen could still be handed out again.
 *
 * Fix: allocate EVERY default name on the new row up front, against an
 * exhaustive type-agnostic scan of the node. Switching the row's type then
 * only reveals values that were already unique, so nothing the user typed is
 * ever renamed afterwards.
 *
 * The decisive assertions below are on the GENERATED NMState, not on state
 * shape: duplicates are only a defect because they make the document invalid.
 */
import { describe, it, expect } from "vitest";
import yaml from "../../backend/node_modules/js-yaml/index.js";
import {
  createInterfaceConfig,
  createAdditionalInterfaceConfig,
  collectUsedInterfaceNames,
  allocateInterfaceName
} from "../src/hostInventoryV2Helpers.js";
import { buildAgentConfig } from "../../backend/src/generate.js";
import { bareMetalAgent } from "../../e2e/fixtures/scenarios.js";

/** A node whose primary is a bond — the shape that reproduced the defect. */
function bondPrimaryNode() {
  return {
    name: "master-0",
    hostname: "master-0",
    role: "master",
    bmc: {},
    primary: createInterfaceConfig({
      type: "bond",
      mode: "static",
      ipv4Cidr: "192.168.111.80/24",
      ipv4Gateway: "192.168.111.1",
      bond: {
        name: "bond0",
        mode: "active-backup",
        slaves: [
          { name: "eno0", macAddress: "52:54:00:00:00:00" },
          { name: "eno1", macAddress: "52:54:00:00:00:01" }
        ]
      }
    }),
    additionalInterfaces: []
  };
}

/** Add n additional interfaces the way the UI does. */
function withAdditional(node, count) {
  let next = node;
  for (let i = 0; i < count; i++) {
    next = {
      ...next,
      additionalInterfaces: [...(next.additionalInterfaces || []), createAdditionalInterfaceConfig(next)]
    };
  }
  return next;
}

/** Every name one row could contribute to the generated document, whatever its type. */
function namesOf(iface) {
  if (!iface) return [];
  return [
    iface.ethernet?.name,
    iface.bond?.name,
    ...(iface.bond?.slaves || []).map((s) => s?.name)
  ].filter(Boolean);
}

/**
 * Names contributed by the ADDED rows only.
 *
 * Deliberately excludes the primary's own set. The bond-primary fixture
 * carries a stale `ethernet.name` of `eno0` that is also its first bond
 * member — a pre-existing quirk of `createInterfaceConfig` seeding an ethernet
 * block on every row, not something the allocator produced. Counting raw
 * entries across the whole node would fail on that fixture artifact and say
 * nothing about allocation. Collision against the primary is asserted
 * separately and explicitly.
 */
function addedNames(node) {
  return (node.additionalInterfaces || []).flatMap(namesOf);
}

/** Generate agent-config for a node and return its NMState interface names. */
function generatedInterfaceNames(node) {
  const state = bareMetalAgent();
  state.release = { channel: "4.22", patchVersion: "4.22.16" };
  state.version = {
    selectedMinor: "4.22",
    selectedPatch: "4.22.16",
    selectedChannel: "stable-4.22",
    locked: true
  };
  state.hostInventory = { ...(state.hostInventory || {}), ipStackMode: "ipv4", nodes: [node] };
  const doc = yaml.load(buildAgentConfig(state));
  return doc.hosts[0].networkConfig.interfaces.map((i) => i.name);
}

describe("the allocator sees every name already in use", () => {
  it("collects the primary's names whatever its type", () => {
    const used = collectUsedInterfaceNames(bondPrimaryNode());
    expect(used.has("bond0")).toBe(true);
    expect(used.has("eno0")).toBe(true);
    expect(used.has("eno1")).toBe(true);
  });

  it("collects a row's ethernet name even when that row is a bond", () => {
    // The old scan skipped this, so a name on screen could be handed out again.
    const node = bondPrimaryNode();
    node.primary.ethernet = { name: "eno7", macAddress: "" };
    expect(collectUsedInterfaceNames(node).has("eno7")).toBe(true);
  });

  it("allocates the lowest free suffix and never repeats within one call", () => {
    const used = new Set(["eno0", "eno1", "eno3"]);
    expect(allocateInterfaceName(used, "eno")).toBe("eno2");
    expect(allocateInterfaceName(used, "eno")).toBe("eno4");
  });
});

describe("a new additional interface never defaults to a used name", () => {
  it("primary eno0: the new row's ethernet name is not eno0", () => {
    const node = {
      ...bondPrimaryNode(),
      primary: createInterfaceConfig({ type: "ethernet", ethernet: { name: "eno0", macAddress: "" } })
    };
    const added = createAdditionalInterfaceConfig(node);
    expect(added.ethernet.name).not.toBe("eno0");
  });

  it("eno1 already used as a bond member: the new row skips it", () => {
    const added = createAdditionalInterfaceConfig(bondPrimaryNode());
    expect(["eno0", "eno1"]).not.toContain(added.ethernet.name);
  });

  it("THE REPORTED DEFECT: the new row's bond defaults do not collide either", () => {
    const added = createAdditionalInterfaceConfig(bondPrimaryNode());
    expect(added.bond.name).not.toBe("bond0");
    for (const slave of added.bond.slaves) {
      expect(["eno0", "eno1"]).not.toContain(slave.name);
    }
  });

  it("the VRF default name does not collide either", () => {
    const node = bondPrimaryNode();
    node.primary.advanced = { ...node.primary.advanced, vrf: { enabled: true, name: "vrf0", tableId: "100", ports: "" } };
    expect(createAdditionalInterfaceConfig(node).advanced.vrf.name).not.toBe("vrf0");
  });

  it("every suggested name is unique across several additions", () => {
    const node = withAdditional(bondPrimaryNode(), 4);
    const added = addedNames(node);
    expect(added.length).toBe(16); // 4 rows x (ethernet + bond + 2 members)
    expect(new Set(added).size, "the allocator handed out a name twice").toBe(added.length);
    const primaryNames = new Set(namesOf(node.primary));
    for (const name of added) expect(primaryNames.has(name)).toBe(false);
  });

  it("remove then re-add is deterministic and still non-colliding", () => {
    const four = withAdditional(bondPrimaryNode(), 4);
    const pruned = { ...four, additionalInterfaces: four.additionalInterfaces.slice(0, 2) };
    const readded = withAdditional(pruned, 2);
    const names = addedNames(readded);
    expect(new Set(names).size).toBe(names.length);
    const primaryNames = new Set(namesOf(readded.primary));
    for (const name of names) expect(primaryNames.has(name)).toBe(false);
    // Deterministic: the same starting point yields the same allocation.
    expect(addedNames(withAdditional(pruned, 2))).toEqual(names);
  });

  it("an imported node with nonsequential names gets a genuinely unused name", () => {
    const node = bondPrimaryNode();
    node.primary.bond.slaves = [
      { name: "eno0", macAddress: "" },
      { name: "eno2", macAddress: "" }
    ];
    node.additionalInterfaces = [
      createInterfaceConfig({ type: "ethernet", ethernet: { name: "eno1", macAddress: "" } })
    ];
    const added = createAdditionalInterfaceConfig(node);
    expect(["eno0", "eno1", "eno2"]).not.toContain(added.ethernet.name);
    expect(added.ethernet.name).toBe("eno3");
  });
});

describe("generated NMState carries no duplicate caused by a default suggestion", () => {
  it("bond primary + an added ethernet row generates cleanly", () => {
    const node = withAdditional(bondPrimaryNode(), 1);
    const names = generatedInterfaceNames(node);
    expect(new Set(names).size).toBe(names.length);
  });

  it("bond primary + an added row SWITCHED TO BOND generates cleanly", () => {
    /* The exact reproduction. Switching the row's type makes its bond block
       live; before the fix that block was `bond0` with members eno0/eno1 and
       generation threw Duplicate NMState interface name "eno0". */
    const node = withAdditional(bondPrimaryNode(), 1);
    node.additionalInterfaces[0].type = "bond";
    expect(() => generatedInterfaceNames(node)).not.toThrow();
    const names = generatedInterfaceNames(node);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every row type generates cleanly after being switched", () => {
    for (const type of ["ethernet", "bond", "vlan-on-ethernet", "vlan-on-bond"]) {
      const node = withAdditional(bondPrimaryNode(), 1);
      node.additionalInterfaces[0].type = type;
      node.additionalInterfaces[0].vlan = { id: "400", baseIface: "", name: "" };
      const names = generatedInterfaceNames(node);
      expect(new Set(names).size, `${type} produced a duplicate`).toBe(names.length);
    }
  });

  it("three added rows all switched to bond still generate cleanly", () => {
    const node = withAdditional(bondPrimaryNode(), 3);
    node.additionalInterfaces.forEach((iface) => { iface.type = "bond"; });
    const names = generatedInterfaceNames(node);
    expect(new Set(names).size).toBe(names.length);
  });
});
