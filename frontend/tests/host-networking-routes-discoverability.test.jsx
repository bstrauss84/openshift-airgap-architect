/**
 * Host routes and the default gateway: discoverability, and the end of the
 * silent data loss on additional interfaces.
 *
 * NOT A REGRESSION. The primary-interface gateway and the "Additional Routes"
 * list have existed continuously since the initial public release; commit
 * 88b9f27 moved them into a collapsed "Advanced" accordion. The problem is
 * that they could not be FOUND, and — for additional interfaces — that routes
 * could be imported into state and were then read by nothing.
 *
 * WHAT CHANGED, AND WHAT THIS FILE PINS
 *
 *  - The Advanced group now carries a description that names "Additional
 *    Routes" and is visible WHILE COLLAPSED, so the collapsed-by-default
 *    layout is preserved without hiding what is inside it.
 *  - A node that already HAS routes opens with Advanced expanded, so an
 *    imported run never hides its own data behind a closed panel.
 *  - Static IP Configuration states that the gateway field IS the default
 *    route, and points at Additional Routes for anything else.
 *  - DHCP mode explains why there is no gateway field, which is what reads as
 *    "the gateway setting disappeared".
 *  - `additionalInterfaces[].advanced.routes` now has an editor (and a
 *    generator — see backend/test/t7d-host-networking-naming-and-routes.test.js).
 *    It previously had neither.
 *
 * NOT changed: a default route is NOT made mandatory. A static host whose
 * destinations are all on-link is a legitimate configuration.
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
import { validateNode } from "../src/validation.js";

const MINOR = "4.22";

const advanced = (routes = []) => ({
  mtu: "1500",
  sriov: { enabled: false, totalVfs: "" },
  vrf: { enabled: false, name: "vrf0", tableId: "100", ports: "" },
  routes
});

const makeNode = ({ mode = "static", primaryRoutes = [], additional = null } = {}) => ({
  role: "master",
  hostname: "master-0",
  rootDevice: "",
  dnsServers: "",
  dnsSearch: "",
  bmc: { address: "", username: "", password: "", bootMACAddress: "" },
  primary: {
    type: "ethernet",
    mode,
    ipv4Cidr: "192.0.2.10/24",
    ipv4Gateway: "192.0.2.1",
    ipv6Cidr: "",
    ipv6Gateway: "",
    ethernet: { name: "eno5", macAddress: "00:00:5E:00:53:05" },
    bond: { name: "bond0", mode: "active-backup", slaves: [] },
    vlan: { id: "", baseIface: "", name: "" },
    advanced: advanced(primaryRoutes)
  },
  additionalInterfaces: additional ? [additional] : []
});

const additionalEthernet = (routes = []) => ({
  type: "ethernet",
  mode: "static",
  ipv4Cidr: "198.51.100.20/24",
  ipv6Cidr: "",
  ethernet: { name: "eno7", macAddress: "00:00:5E:00:53:07" },
  bond: { name: "bond1", mode: "active-backup", slaves: [] },
  vlan: { id: "", baseIface: "", name: "" },
  advanced: advanced(routes)
});

const stateWith = (node) => ({
  version: { selectedMinor: MINOR, selectedPatch: "4.22.16", selectedChannel: `stable-${MINOR}`, locked: true },
  release: { channel: MINOR, patchVersion: "4.22.16", confirmed: true },
  blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "ocp1" },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: { nodes: [node], ipStackMode: "ipv4" },
  globalStrategy: { networking: { machineNetworkV4: "192.0.2.0/24" } },
  ui: { compareMode: false, scenarioAwareLayout: false }
});

function Harness({ initialState, snapshot }) {
  const [state, setState] = React.useState(initialState);
  snapshot.current = () => state;
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

function openEditor(node) {
  const snapshot = { current: null };
  render(<Harness initialState={stateWith(node)} snapshot={snapshot} />);
  fireEvent.click(screen.getByText(/master-0/i));
  return {
    primaryRoutes: () => snapshot.current().hostInventory.nodes[0].primary.advanced.routes,
    additionalRoutes: () => snapshot.current().hostInventory.nodes[0].additionalInterfaces[0].advanced.routes
  };
}

const additionalSection = () => screen.getByText("Interface 1").closest("section");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("discoverability: routes and the default gateway can be found", () => {
  it("the collapsed Advanced group names Additional Routes without being expanded", () => {
    openEditor(makeNode());
    // Collapsed: the route inputs are absent...
    expect(screen.queryByLabelText("Destination")).toBeNull();
    // ...but the summary that names them is visible.
    const summaries = screen.getAllByText(/Additional Routes/);
    expect(summaries.length).toBeGreaterThanOrEqual(1);
  });

  it("the Static IP block states that the gateway field IS the default route", () => {
    openEditor(makeNode({ mode: "static" }));
    expect(screen.getByText(/this node's default gateway/i)).toBeTruthy();
    expect(screen.getByText(/For routes to networks the/i)).toBeTruthy();
  });

  it("DHCP mode explains why there is no gateway field, instead of just omitting it", () => {
    openEditor(makeNode({ mode: "dhcp" }));
    expect(screen.queryByLabelText("IPv4 gateway")).toBeNull();
    expect(screen.getByText(/come from the DHCP server/i)).toBeTruthy();
  });

  it("a node that already has routes opens with Advanced expanded", () => {
    openEditor(makeNode({
      primaryRoutes: [{ destination: "203.0.113.0/24", nextHopAddress: "192.0.2.254", nextHopInterface: "" }]
    }));
    expect(screen.getByLabelText("Destination").value).toBe("203.0.113.0/24");
  });

  it("a node with no routes still opens collapsed — the accepted default is kept", () => {
    openEditor(makeNode());
    expect(screen.queryByLabelText("Destination")).toBeNull();
    expect(screen.getByLabelText("Expand Advanced")).toBeTruthy();
  });

  it("a default route is NOT made mandatory for a static host", () => {
    const n = makeNode({ mode: "static" });
    n.primary.ipv4Gateway = "192.0.2.1";
    const r = validateNode({
      node: n, enableIpv4: true, enableIpv6: false,
      platform: "Bare Metal", method: "Agent-Based Installer"
    });
    expect(r.errors.join(" | ")).not.toMatch(/route is required/i);
  });
});

describe("additional-interface routes: the dead field now round-trips", () => {
  const importedRoute = { destination: "203.0.113.0/24", nextHopAddress: "198.51.100.254", nextHopInterface: "eno7" };

  it("an imported route is VISIBLE — it used to be in state and rendered nowhere", () => {
    openEditor(makeNode({ additional: additionalEthernet([importedRoute]) }));
    const s = additionalSection();
    expect(within(s).getByLabelText("Destination").value).toBe("203.0.113.0/24");
    expect(within(s).getByLabelText("Next Hop Address").value).toBe("198.51.100.254");
    expect(within(s).getByLabelText("Next Hop Interface (optional)").value).toBe("eno7");
  });

  it("an imported route is EDITABLE and the edit lands in canonical state", () => {
    const h = openEditor(makeNode({ additional: additionalEthernet([importedRoute]) }));
    fireEvent.change(within(additionalSection()).getByLabelText("Destination"), {
      target: { value: "198.18.0.0/15" }
    });
    expect(h.additionalRoutes()[0].destination).toBe("198.18.0.0/15");
    // The rest of the row is untouched by the edit.
    expect(h.additionalRoutes()[0].nextHopAddress).toBe("198.51.100.254");
    expect(h.additionalRoutes()[0].nextHopInterface).toBe("eno7");
  });

  it("a route can be added to an additional interface that had none", () => {
    const h = openEditor(makeNode({ additional: additionalEthernet([]) }));
    const s = () => additionalSection();
    fireEvent.click(within(s()).getByLabelText("Expand Advanced Networking"));
    expect(h.additionalRoutes()).toHaveLength(0);
    fireEvent.click(within(s()).getByRole("button", { name: /^Add Route$/ }));
    expect(h.additionalRoutes()).toHaveLength(1);
    fireEvent.change(within(s()).getByLabelText("Destination"), { target: { value: "203.0.113.0/24" } });
    fireEvent.change(within(s()).getByLabelText("Next Hop Address"), { target: { value: "198.51.100.254" } });
    expect(h.additionalRoutes()[0]).toMatchObject({
      destination: "203.0.113.0/24",
      nextHopAddress: "198.51.100.254"
    });
  });

  it("removing a route removes the right row and leaves the others in order", () => {
    const h = openEditor(makeNode({
      additional: additionalEthernet([
        { destination: "203.0.113.0/24", nextHopAddress: "198.51.100.254", nextHopInterface: "" },
        { destination: "198.18.0.0/15", nextHopAddress: "198.51.100.253", nextHopInterface: "" }
      ])
    }));
    expect(h.additionalRoutes()).toHaveLength(2);
    const removeButtons = within(additionalSection()).getAllByText("Remove Route");
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]);
    expect(h.additionalRoutes().map((r) => r.destination)).toEqual(["198.18.0.0/15"]);
  });

  it("editing an additional route does not touch the primary's routes", () => {
    const h = openEditor(makeNode({
      primaryRoutes: [{ destination: "10.0.0.0/8", nextHopAddress: "192.0.2.254", nextHopInterface: "" }],
      additional: additionalEthernet([importedRoute])
    }));
    fireEvent.change(within(additionalSection()).getByLabelText("Destination"), {
      target: { value: "198.18.0.0/15" }
    });
    expect(h.primaryRoutes()[0].destination).toBe("10.0.0.0/8");
  });

  it("an additional interface carrying routes opens with its Advanced panel expanded", () => {
    openEditor(makeNode({ additional: additionalEthernet([importedRoute]) }));
    expect(within(additionalSection()).getByLabelText("Collapse Advanced Networking")).toBeTruthy();
  });
});

describe("static routes are validated — previously they were not validated at all", () => {
  const nodeWithRoute = (route) => makeNode({ primaryRoutes: [route] });
  const run = (node) =>
    validateNode({ node, enableIpv4: true, enableIpv6: true, platform: "Bare Metal", method: "Agent-Based Installer" });

  it("rejects a destination that is not a CIDR", () => {
    const r = run(nodeWithRoute({ destination: "203.0.113.5", nextHopAddress: "192.0.2.254", nextHopInterface: "" }));
    expect(r.errors.join(" | ")).toMatch(/destination must be a CIDR/);
  });

  it("rejects a next hop that is not an IP address", () => {
    const r = run(nodeWithRoute({ destination: "203.0.113.0/24", nextHopAddress: "gateway.example.com", nextHopInterface: "" }));
    expect(r.errors.join(" | ")).toMatch(/next hop must be a valid IP address/);
  });

  it("rejects a destination and next hop in different address families", () => {
    const r = run(nodeWithRoute({ destination: "203.0.113.0/24", nextHopAddress: "2001:db8::1", nextHopInterface: "" }));
    expect(r.errors.join(" | ")).toMatch(/same address family/);
  });

  it("rejects a next-hop interface that is not one of this host's interfaces", () => {
    const r = run(nodeWithRoute({ destination: "203.0.113.0/24", nextHopAddress: "192.0.2.254", nextHopInterface: "eno99" }));
    expect(r.errors.join(" | ")).toMatch(/is not one of this host's interfaces/);
  });

  it("accepts a well-formed route pinned to a real interface", () => {
    const r = run(nodeWithRoute({ destination: "203.0.113.0/24", nextHopAddress: "192.0.2.254", nextHopInterface: "eno5" }));
    expect(r.errors.join(" | ")).not.toMatch(/route 1/);
  });

  it("leaves a wholly blank route row alone — it is an unfinished row, not an error", () => {
    const r = run(nodeWithRoute({ destination: "", nextHopAddress: "", nextHopInterface: "" }));
    expect(r.errors.join(" | ")).not.toMatch(/route 1/);
  });

  it("validates routes on additional interfaces too", () => {
    const n = makeNode({
      additional: additionalEthernet([{ destination: "nonsense", nextHopAddress: "198.51.100.254", nextHopInterface: "" }])
    });
    const r = run(n);
    expect(r.errors.join(" | ")).toMatch(/Additional interface 1 route 1: destination must be a CIDR/);
  });
});
