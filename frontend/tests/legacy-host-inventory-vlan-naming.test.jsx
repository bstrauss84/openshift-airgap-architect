/**
 * The LEGACY (v1) Host Inventory step carried the same interface-naming
 * defects as the v2 node editor, and is still wired into the app
 * (App.jsx COMPONENT_MAP "inventory" and the fallback step list), so fixing
 * only v2 would have left a second surface disagreeing with the generator.
 *
 * Three defects are pinned here:
 *
 *  1. The additional-interface VLAN name was derived as
 *     `vlan.baseIface || ethernet.name || bond.name` — ethernet before bond —
 *     so a VLAN on a bond displayed a bond MEMBER's nic.
 *  2. The primary derivation ignored `vlan.baseIface` entirely, so an imported
 *     run rendered a name the generator would not write.
 *  3. The local display mirror seeded `vlan.name` to "" and the field read it
 *     with `??`, which only falls through on `undefined` — so the derived name
 *     never reached the field at all once the mirror had synced.
 *
 * The mirror also dropped `vlan.baseIface`, which is restored here.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { AppContext } from "../src/store.jsx";
import HostInventoryStep from "../src/steps/HostInventoryStep.jsx";
import { VLAN_NAMING_CASES } from "../../shared/interfaceNaming.fixtures.js";

const advanced = () => ({
  mtu: "1500",
  sriov: { enabled: false, totalVfs: "" },
  vrf: { enabled: false, name: "vrf0", tableId: "100", ports: "" },
  routes: []
});

const node = ({ primary, additional }) => ({
  role: "master",
  hostname: "master-0",
  rootDevice: "",
  dnsServers: "",
  dnsSearch: "",
  bmc: { address: "", username: "", password: "", bootMACAddress: "" },
  primary: { ...primary, advanced: advanced() },
  additionalInterfaces: additional ? [{ ...additional, advanced: advanced() }] : []
});

const stateWith = (n) => ({
  version: { selectedMinor: "4.22", selectedPatch: "4.22.16", selectedChannel: "stable-4.22", locked: true },
  release: { channel: "4.22", patchVersion: "4.22.16", confirmed: true },
  blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "ocp1" },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: { schemaVersion: 3, nodes: [n], ipStackMode: "ipv4" },
  globalStrategy: { networking: { machineNetworkV4: "192.0.2.0/24" } },
  ui: {}
});

function Harness({ initialState }) {
  const [state, setState] = React.useState(initialState);
  const value = {
    state,
    updateState: (patch) => setState((prev) => ({ ...prev, ...patch })),
    loading: false,
    startOver: vi.fn()
  };
  return (
    <AppContext.Provider value={value}>
      <HostInventoryStep />
    </AppContext.Provider>
  );
}

const renderStep = (n) => render(<Harness initialState={stateWith(n)} />);

/** The v1 step renders every node inline; find the "(auto)" VLAN name inputs. */
const vlanNameInputs = () =>
  screen.getAllByText("VLAN Interface Name (auto)").map((label) => label.querySelector("input"));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("legacy v1 host inventory: primary VLAN name matches the generator", () => {
  for (const c of VLAN_NAMING_CASES) {
    it(`${c.id}: shows ${c.expectedName}`, () => {
      renderStep(node({ primary: c.iface }));
      const inputs = vlanNameInputs();
      expect(inputs.length).toBeGreaterThanOrEqual(1);
      expect(inputs[0].value).toBe(c.expectedName);
      if (c.mustNotEqual) expect(inputs[0].value).not.toBe(c.mustNotEqual);
    });
  }

  it("names the derived base interface in the inline note", () => {
    const c = VLAN_NAMING_CASES.find((x) => x.id === "vlan-on-bond-ignores-the-seeded-ethernet-name");
    renderStep(node({ primary: c.iface }));
    expect(screen.getByText(/VLAN base interface is derived/).textContent).toContain("bond0");
  });
});

describe("legacy v1 host inventory: additional VLAN name matches the generator", () => {
  const plainPrimary = {
    type: "ethernet",
    mode: "dhcp",
    ipv4Cidr: "",
    ipv4Gateway: "",
    ipv6Cidr: "",
    ipv6Gateway: "",
    ethernet: { name: "eno0", macAddress: "00:00:5E:00:53:0A" },
    bond: { name: "bond9", mode: "active-backup", slaves: [] },
    vlan: { id: "", baseIface: "", name: "" }
  };

  for (const c of VLAN_NAMING_CASES) {
    it(`${c.id}: shows ${c.expectedName}`, () => {
      renderStep(node({ primary: plainPrimary, additional: c.iface }));
      // The primary is a plain ethernet, so the only VLAN name field on the
      // page belongs to the additional interface.
      const inputs = vlanNameInputs();
      expect(inputs).toHaveLength(1);
      expect(inputs[0].value).toBe(c.expectedName);
      if (c.mustNotEqual) expect(inputs[0].value).not.toBe(c.mustNotEqual);
    });
  }
});
