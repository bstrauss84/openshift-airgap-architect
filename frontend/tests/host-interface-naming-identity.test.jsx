/**
 * The node editor must DISPLAY the interface name the generator WRITES.
 *
 * THE DEFECT. A VLAN on a bond generated `bond0.100` in NMState while the
 * editor's "VLAN Interface Name (auto)" field displayed `eno2.100` — a bond
 * MEMBER nic. The additional-interface field derived the name with
 * `vlan.baseIface || ethernet.name || bond.name`, checking ethernet BEFORE
 * bond; every row the UI creates is seeded with an `ethernet.name` regardless
 * of its type, and the Ethernet Interface Name input is not rendered for
 * `vlan-on-bond`, so that stale invisible value won. The primary-interface
 * derivation had the mirrored defect: it ignored `vlan.baseIface` entirely,
 * so an imported run rendered one name and generated another.
 *
 * WHAT THIS FILE ASSERTS. Every expectation comes from
 * shared/interfaceNaming.fixtures.js, the SAME table
 * backend/test/t7d-host-networking-naming-and-routes.test.js asserts the
 * generated NMState against. The identity claim is therefore pinned on both
 * sides by one set of literals: if the editor and the generator drift apart
 * again, one of the two suites fails on the same named row.
 *
 * The additional-interface field had no test at all before this file.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { AppContext } from "../src/store.jsx";
import HostInventoryV2Step from "../src/steps/HostInventoryV2Step.jsx";
import { INTERFACE_NAMING_CASES, VLAN_NAMING_CASES } from "../../shared/interfaceNaming.fixtures.js";

const MINOR = "4.22";

const withAdvanced = (iface, routes = []) => ({
  ...iface,
  advanced: {
    mtu: "1500",
    sriov: { enabled: false, totalVfs: "" },
    vrf: { enabled: false, name: "vrf0", tableId: "100", ports: "" },
    routes
  }
});

const baseState = (node, ipStackMode = "ipv4") => ({
  version: { selectedMinor: MINOR, selectedPatch: "4.22.16", selectedChannel: `stable-${MINOR}`, locked: true },
  release: { channel: MINOR, patchVersion: "4.22.16", confirmed: true },
  blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "ocp1" },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: { nodes: [node], ipStackMode },
  globalStrategy: { networking: { machineNetworkV4: "192.0.2.0/24" } },
  ui: { compareMode: false, scenarioAwareLayout: false }
});

/** A real, mutable store so edits behave the way they do in the product. */
function StatefulHarness({ initialState, onState }) {
  const [state, setState] = React.useState(initialState);
  onState.current = () => state;
  const value = {
    state,
    updateState: (patch) => setState((prev) => ({ ...prev, ...patch })),
    loading: false,
    startOver: vi.fn()
  };
  return (
    <AppContext.Provider value={value}>
      <HostInventoryV2Step />
    </AppContext.Provider>
  );
}

const nodeWithPrimary = (iface) => ({
  role: "master",
  hostname: "master-0",
  rootDevice: "",
  dnsServers: "",
  dnsSearch: "",
  bmc: { address: "", username: "", password: "", bootMACAddress: "" },
  primary: withAdvanced(iface),
  additionalInterfaces: []
});

const nodeWithAdditional = (iface, routes = []) => ({
  role: "master",
  hostname: "master-0",
  rootDevice: "",
  dnsServers: "",
  dnsSearch: "",
  bmc: { address: "", username: "", password: "", bootMACAddress: "" },
  primary: withAdvanced({
    type: "ethernet",
    mode: "dhcp",
    ethernet: { name: "ethernet0", macAddress: "00:00:5E:00:53:0A" },
    bond: { name: "bond9", mode: "active-backup", slaves: [] },
    vlan: { id: "", baseIface: "", name: "" }
  }),
  additionalInterfaces: [withAdvanced(iface, routes)]
});

function renderNode(node, ipStackMode = "ipv4") {
  const ref = { current: null };
  render(<StatefulHarness initialState={baseState(node, ipStackMode)} onState={ref} />);
  fireEvent.click(screen.getByText(/master-0/i));
  return ref;
}

const additionalSection = () => screen.getByText("Interface 1").closest("section");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("node editor: PRIMARY interface VLAN name matches the generated name", () => {
  for (const c of VLAN_NAMING_CASES) {
    it(`${c.id}: the field shows ${c.expectedName}`, () => {
      renderNode(nodeWithPrimary(c.iface));
      const field = screen.getByLabelText("VLAN name");
      expect(field.value).toBe(c.expectedName);
      if (c.mustNotEqual) expect(field.value).not.toBe(c.mustNotEqual);
    });

    it(`${c.id}: the base interface shown is ${c.expectedBase}`, () => {
      renderNode(nodeWithPrimary(c.iface));
      expect(screen.getByText(/VLAN base interface:/).textContent).toContain(c.expectedBase);
    });
  }
});

describe("node editor: ADDITIONAL interface VLAN name matches the generated name", () => {
  /* This field had no test of any kind. It is the one the human screenshotted
     showing `eno2.100` for a VLAN the generator named `bond0.100`. */
  for (const c of VLAN_NAMING_CASES) {
    it(`${c.id}: the field shows ${c.expectedName}`, () => {
      renderNode(nodeWithAdditional(c.iface));
      const field = within(additionalSection()).getByLabelText("VLAN Interface Name (auto)");
      expect(field.value).toBe(c.expectedName);
      if (c.mustNotEqual) expect(field.value).not.toBe(c.mustNotEqual);
    });

    it(`${c.id}: the base interface shown is ${c.expectedBase}`, () => {
      renderNode(nodeWithAdditional(c.iface));
      expect(within(additionalSection()).getByText(/VLAN base interface:/).textContent)
        .toContain(c.expectedBase);
    });
  }
});

describe("the displayed name tracks edits, for primary and additional alike", () => {
  const vlanOnBond = INTERFACE_NAMING_CASES.find((c) => c.id === "vlan-on-bond-ignores-the-seeded-ethernet-name").iface;

  it("primary: renaming the bond renames the VLAN", () => {
    renderNode(nodeWithPrimary(vlanOnBond));
    expect(screen.getByLabelText("VLAN name").value).toBe("bond0.100");
    fireEvent.change(screen.getByLabelText("Bond name"), { target: { value: "bond7" } });
    expect(screen.getByLabelText("VLAN name").value).toBe("bond7.100");
  });

  it("primary: renaming a bond MEMBER does not rename the VLAN", () => {
    renderNode(nodeWithPrimary(vlanOnBond));
    const members = screen.getAllByLabelText("Interface");
    fireEvent.change(members[0], { target: { value: "enp3s0f0" } });
    expect(screen.getByLabelText("VLAN name").value).toBe("bond0.100");
  });

  it("primary: changing the VLAN id renumbers the VLAN", () => {
    renderNode(nodeWithPrimary(vlanOnBond));
    fireEvent.change(screen.getByLabelText("VLAN ID"), { target: { value: "4000" } });
    expect(screen.getByLabelText("VLAN name").value).toBe("bond0.4000");
  });

  it("primary: switching type from VLAN-on-bond to VLAN-on-ethernet moves the base", () => {
    renderNode(nodeWithPrimary(vlanOnBond));
    fireEvent.change(screen.getByLabelText("Primary Interface Type"), { target: { value: "vlan-on-ethernet" } });
    expect(screen.getByLabelText("VLAN name").value).toBe("eno2.100");
  });

  it("additional: renaming the bond renames the VLAN", () => {
    renderNode(nodeWithAdditional(vlanOnBond));
    const section = () => additionalSection();
    expect(within(section()).getByLabelText("VLAN Interface Name (auto)").value).toBe("bond0.100");
    fireEvent.change(within(section()).getByLabelText("Bond Name"), { target: { value: "bond7" } });
    expect(within(section()).getByLabelText("VLAN Interface Name (auto)").value).toBe("bond7.100");
  });

  it("additional: renaming a bond MEMBER does not rename the VLAN", () => {
    renderNode(nodeWithAdditional(vlanOnBond));
    const members = within(additionalSection()).getAllByLabelText("Bond Member Interface");
    fireEvent.change(members[0], { target: { value: "enp3s0f0" } });
    expect(within(additionalSection()).getByLabelText("VLAN Interface Name (auto)").value).toBe("bond0.100");
  });

  it("additional: changing the VLAN id renumbers the VLAN", () => {
    renderNode(nodeWithAdditional(vlanOnBond));
    fireEvent.change(within(additionalSection()).getByLabelText("VLAN ID"), { target: { value: "4000" } });
    expect(within(additionalSection()).getByLabelText("VLAN Interface Name (auto)").value).toBe("bond0.4000");
  });

  it("additional: switching type to VLAN-on-ethernet moves the base off the bond", () => {
    renderNode(nodeWithAdditional(vlanOnBond));
    fireEvent.change(within(additionalSection()).getByLabelText("Type"), { target: { value: "vlan-on-ethernet" } });
    expect(within(additionalSection()).getByLabelText("VLAN Interface Name (auto)").value).toBe("eno2.100");
  });

  it("additional: an explicitly typed VLAN name is not overwritten by the derivation", () => {
    renderNode(nodeWithAdditional(vlanOnBond));
    const field = () => within(additionalSection()).getByLabelText("VLAN Interface Name (auto)");
    fireEvent.change(field(), { target: { value: "storage-net" } });
    expect(field().value).toBe("storage-net");
    fireEvent.change(within(additionalSection()).getByLabelText("Bond Name"), { target: { value: "bond7" } });
    expect(field().value).toBe("storage-net");
  });
});
