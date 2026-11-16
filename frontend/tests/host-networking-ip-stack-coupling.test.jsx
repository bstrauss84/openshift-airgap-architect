/**
 * Cluster IP stack mode ↔ host networking field coupling.
 *
 * THE DEFECT. With Networking → IP Stack Mode = IPv6, the host editor still
 * offered "IPv4 Address/CIDR" on the primary interface and on every additional
 * interface. `buildNmState` derives `enableIpv4` / `enableIpv6` from
 * `node.ipStackMode || node.inventoryIpStackMode || 'ipv4'` and, when a family
 * is off, writes `{ enabled: false }` for it and DISCARDS the address. The UI
 * was therefore inviting input the generator silently threw away. Worse, the
 * frontend validator REQUIRED an IPv4 address in static mode regardless of
 * stack mode, so an IPv6-only cluster could not be completed without entering
 * a value that would be discarded.
 *
 * THE RULE APPLIED HERE. Hide only what the generator/NMState semantics
 * actually require, and say so for everything else. The semantic matrix below
 * is the executable form of that classification:
 *
 *   CLUSTER-STACK-COUPLED (hidden when the family is off)
 *     primary.ipv4Cidr, primary.ipv4Gateway, primary.ipv6Cidr,
 *     primary.ipv6Gateway, additionalInterfaces[].ipv4Cidr,
 *     additionalInterfaces[].ipv6Cidr
 *     — evidence: addIpConfig() in backend/src/generate.js gates all of them
 *       on enableIpv4/enableIpv6, and the default-route emission is gated on
 *       the same two booleans.
 *
 *   INDEPENDENT (always shown; family is a per-value property, not a cluster
 *   property, and the generator writes the value through unchanged)
 *     dnsServers, dnsSearch        — emitted verbatim as dns-resolver.config
 *     advanced.routes              — each route carries its own family; the
 *                                    generator filters per route, the field
 *                                    itself serves both families
 *     every L2 field               — interface type, IP assignment, names,
 *                                    MACs, bond mode/members, VLAN id/name,
 *                                    MTU, SR-IOV, VRF
 *
 * Bond and VLAN L3 addressing is NOT a separate surface: one pair of address
 * fields serves whichever interface the row makes the L3 carrier, so the
 * matrix is asserted for ethernet, bond and vlan-on-bond alike.
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

const BOND = {
  name: "bond0",
  mode: "active-backup",
  slaves: [
    { name: "eno1", macAddress: "00:00:5E:00:53:01" },
    { name: "eno2", macAddress: "00:00:5E:00:53:02" }
  ]
};

const primaryOf = (type) => ({
  type,
  mode: "static",
  ipv4Cidr: "192.0.2.10/24",
  ipv4Gateway: "192.0.2.1",
  ipv6Cidr: "2001:db8::10/64",
  ipv6Gateway: "2001:db8::1",
  ethernet: { name: "eno5", macAddress: "00:00:5E:00:53:05" },
  bond: BOND,
  vlan: { id: "100", baseIface: "", name: "" },
  advanced: advanced()
});

const additionalOf = (type) => ({
  type,
  mode: "static",
  ipv4Cidr: "198.51.100.20/24",
  ipv6Cidr: "2001:db8:10::20/64",
  ethernet: { name: "eno7", macAddress: "00:00:5E:00:53:07" },
  bond: { ...BOND, name: "bond1" },
  vlan: { id: "200", baseIface: "", name: "" },
  advanced: advanced()
});

const node = (type) => ({
  role: "master",
  hostname: "master-0",
  rootDevice: "",
  dnsServers: "192.0.2.53",
  dnsSearch: "example.com",
  bmc: { address: "", username: "", password: "", bootMACAddress: "" },
  primary: primaryOf(type),
  additionalInterfaces: [additionalOf(type)]
});

const stateFor = (type, ipStackMode) => ({
  version: { selectedMinor: MINOR, selectedPatch: "4.22.16", selectedChannel: `stable-${MINOR}`, locked: true },
  release: { channel: MINOR, patchVersion: "4.22.16", confirmed: true },
  blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "ocp1" },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: { nodes: [node(type)], ipStackMode },
  globalStrategy: { networking: { machineNetworkV4: "192.0.2.0/24" } },
  ui: { compareMode: false, scenarioAwareLayout: false }
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
      <HostInventoryV2Step />
    </AppContext.Provider>
  );
}

function openEditor(type, ipStackMode) {
  render(<Harness initialState={stateFor(type, ipStackMode)} />);
  fireEvent.click(screen.getByText(/master-0/i));
}

const additionalSection = () => screen.getByText("Interface 1").closest("section");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const STACK_MODES = [
  { mode: "ipv4", ipv4: true, ipv6: false },
  { mode: "ipv6", ipv4: false, ipv6: true },
  { mode: "dual-stack", ipv4: true, ipv6: true }
];

const L3_CARRIER_TYPES = ["ethernet", "bond", "vlan-on-bond"];

describe("CLUSTER-STACK-COUPLED: primary interface addressing", () => {
  for (const { mode, ipv4, ipv6 } of STACK_MODES) {
    for (const type of L3_CARRIER_TYPES) {
      it(`${mode} / ${type}: IPv4 CIDR ${ipv4 ? "shown" : "hidden"}`, () => {
        openEditor(type, mode);
        expect(Boolean(screen.queryByLabelText("IPv4 CIDR"))).toBe(ipv4);
      });
      it(`${mode} / ${type}: IPv4 gateway ${ipv4 ? "shown" : "hidden"}`, () => {
        openEditor(type, mode);
        expect(Boolean(screen.queryByLabelText("IPv4 gateway"))).toBe(ipv4);
      });
      it(`${mode} / ${type}: IPv6 CIDR ${ipv6 ? "shown" : "hidden"}`, () => {
        openEditor(type, mode);
        expect(Boolean(screen.queryByLabelText("IPv6 CIDR"))).toBe(ipv6);
      });
      it(`${mode} / ${type}: IPv6 gateway ${ipv6 ? "shown" : "hidden"}`, () => {
        openEditor(type, mode);
        expect(Boolean(screen.queryByLabelText("IPv6 gateway"))).toBe(ipv6);
      });
    }
  }
});

describe("INDEPENDENT: additional interface addressing is NOT cluster-stack-coupled", () => {
  /* CORRECTED IN TRANCHE 7C.4A. This block previously asserted that a
     secondary interface's IPv4/IPv6 controls follow the cluster IP stack mode,
     exactly like the primary's. That was wrong, and the justification was
     circular: it was derived from the tool's own `addIpConfig`, which closed
     over the cluster-derived flags for every interface, rather than from any
     Red Hat or NMState rule.

     The authority says otherwise. Red Hat delegates `hosts[].networkConfig`
     wholesale to the NMState Declarative Network API (Agent-based Installer
     4.20/4.21/4.22 §9.2.2, Table 9.8), where `interfaces[].ipv4` and
     `interfaces[].ipv6` are independent per-interface sub-objects. Neither
     openshift/installer nor assisted-service validates a host interface's
     family against the cluster stack — the installer passes `NetworkConfig.Raw`
     through verbatim and only runs `nmstatectl gc`. Red Hat itself requires a
     SEPARATE storage network for iSCSI boot (§7.1) with no family constraint.
     An IPv4 primary with an IPv6-only secondary ethernet and VLAN was verified
     to pass `nmstatectl gc`, the same binary the installer shells out to.

     So hiding these controls removed a supported capability. They are shown in
     every stack mode; what the user configures on the interface is what the
     interface gets. The PRIMARY path remains coupled — see the block above. */
  for (const { mode } of STACK_MODES) {
    for (const type of L3_CARRIER_TYPES) {
      it(`${mode} / ${type}: IPv4 Address/CIDR is shown`, () => {
        openEditor(type, mode);
        expect(within(additionalSection()).queryByLabelText("IPv4 Address/CIDR")).toBeTruthy();
      });
      it(`${mode} / ${type}: IPv6 Address/CIDR is shown`, () => {
        openEditor(type, mode);
        expect(within(additionalSection()).queryByLabelText("IPv6 Address/CIDR")).toBeTruthy();
      });
    }
  }
});

describe("INDEPENDENT: fields the generator does not family-gate stay visible in every stack mode", () => {
  /* These are NOT hidden. Their helper text explains why a value of either
     family is legitimate; hiding them would remove function the generator
     still honours. */
  const alwaysPresent = [
    "Primary Interface Type",
    "IP assignment",
    "DNS servers",
    "DNS search"
  ];
  for (const { mode } of STACK_MODES) {
    for (const label of alwaysPresent) {
      it(`${mode}: "${label}" is shown`, () => {
        openEditor("ethernet", mode);
        expect(screen.getByLabelText(label)).toBeTruthy();
      });
    }
    it(`${mode}: the bond L2 controls are shown for a bond row`, () => {
      openEditor("bond", mode);
      expect(screen.getByLabelText("Bond name")).toBeTruthy();
      expect(screen.getByLabelText("Bond mode")).toBeTruthy();
      expect(screen.getAllByLabelText("Interface").length).toBeGreaterThanOrEqual(2);
    });
    it(`${mode}: the VLAN L2 controls are shown for a VLAN row`, () => {
      openEditor("vlan-on-bond", mode);
      // "VLAN ID" also labels the additional interface's control, so assert
      // presence rather than uniqueness.
      expect(screen.getAllByLabelText("VLAN ID").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByLabelText("VLAN name")).toBeTruthy();
    });
    it(`${mode}: the Additional Routes affordance is shown`, () => {
      openEditor("ethernet", mode);
      expect(screen.getAllByText("Additional Routes").length).toBeGreaterThanOrEqual(1);
    });
    it(`${mode}: the additional interface's L2 and advanced controls are shown`, () => {
      openEditor("ethernet", mode);
      const s = additionalSection();
      expect(within(s).getByLabelText("Type")).toBeTruthy();
      expect(within(s).getByLabelText("IP Assignment")).toBeTruthy();
      expect(within(s).getByLabelText("Ethernet Interface Name")).toBeTruthy();
      expect(within(s).getByLabelText("Ethernet MAC Address")).toBeTruthy();
    });
  }

  it("DNS helper text states explicitly that resolvers are not stack-gated", () => {
    openEditor("ethernet", "ipv6");
    // The word "not" is wrapped in <strong>, so match the contiguous tail.
    expect(screen.getByText(/tied to the cluster IP stack mode/i)).toBeTruthy();
  });
});

describe("the UI tells the user which stack mode is in force", () => {
  it("names IPv6-only in the Static IP Configuration description", () => {
    openEditor("ethernet", "ipv6");
    // Scoped to the description: this fixture also carries IPv4 values, so the
    // DOC-219 unused-family notice legitimately says "IPv6-only" as well.
    const description = screen.getByText("Static IP Configuration").closest(".workflow-group-header");
    expect(within(description).getByText(/IPv6-only/)).toBeTruthy();
  });
  it("names dual-stack in the Static IP Configuration description", () => {
    openEditor("ethernet", "dual-stack");
    expect(screen.getByText(/dual-stack/)).toBeTruthy();
  });
});

describe("validation follows the same per-surface contract as the generator", () => {
  const staticNode = (overrides = {}) => ({
    role: "master",
    hostname: "master-0",
    rootDevice: "/dev/sda",
    bmc: {},
    primary: {
      type: "ethernet",
      mode: "static",
      ethernet: { name: "eno5", macAddress: "00:00:5E:00:53:05" },
      bond: {},
      vlan: {},
      advanced: advanced(),
      ...overrides
    },
    additionalInterfaces: []
  });

  const run = (node, enableIpv4, enableIpv6) =>
    validateNode({ node, enableIpv4, enableIpv6, platform: "Bare Metal", method: "Agent-Based Installer" });

  it("IPv6-only: an IPv4 address is NOT demanded (the generator would discard it)", () => {
    const r = run(staticNode({ ipv6Cidr: "2001:db8::10/64", ipv6Gateway: "2001:db8::1" }), false, true);
    expect(r.errors.join(" | ")).not.toMatch(/IPv4 address\/CIDR is required/);
    expect(r.errors.join(" | ")).not.toMatch(/IPv4 default gateway is required/);
  });

  it("IPv6-only: an IPv6 address IS demanded — otherwise the node has no address at all", () => {
    const r = run(staticNode({}), false, true);
    expect(r.errors.join(" | ")).toMatch(/IPv6 address\/CIDR is required for static mode in an IPv6-only cluster/);
  });

  it("IPv4-only: the IPv4 requirements are unchanged", () => {
    const r = run(staticNode({}), true, false);
    expect(r.errors.join(" | ")).toMatch(/IPv4 address\/CIDR is required/);
    expect(r.errors.join(" | ")).toMatch(/IPv4 default gateway is required/);
  });

  it("dual-stack: IPv4 is required and IPv6 is optional", () => {
    const r = run(staticNode({ ipv4Cidr: "192.0.2.10/24", ipv4Gateway: "192.0.2.1" }), true, true);
    expect(r.errors.join(" | ")).not.toMatch(/IPv6 address\/CIDR is required/);
    expect(r.errors.join(" | ")).not.toMatch(/IPv4 address\/CIDR is required/);
  });

  it("an out-of-family static route is reported, not dropped without comment", () => {
    const n = staticNode({
      ipv6Cidr: "2001:db8::10/64",
      ipv6Gateway: "2001:db8::1",
      advanced: advanced([{ destination: "203.0.113.0/24", nextHopAddress: "192.0.2.254", nextHopInterface: "" }])
    });
    const r = run(n, false, true);
    /* 7C.4A: the message now names the INTERFACE, not the cluster. nmstate
       rejects a route only when its family is disabled on the route's own
       next-hop interface ("The next hop interface of desired Route ... has
       been marked as IPv6 disabled"), so that is what the user must change.
       Here the route falls back to the primary, which is IPv6-only, so the
       route is still correctly refused — for the right reason. */
    expect(r.errors.join(" | ")).toMatch(/IPv4 is not enabled on "[^"]+"/);
    expect(r.errors.join(" | ")).toMatch(/point the route at an interface that has one/);
  });

  it("B4: the complete IPv6-primary + IPv4-secondary host validates with NO errors", () => {
    /* Tranche 7C.4B. Human QA B4 reported two errors after switching the
       cluster to IPv6-only while exercising IPv4 secondary networking, and it
       was unclear whether the 7C.4A secondary-network fix had failed. It had
       not. This is the isolated, fully-specified version of that scenario: a
       primary that genuinely satisfies the IPv6-only requirement, plus a
       secondary carrying IPv4 and a route out of that same secondary. It must
       be completely clean — in particular, no IPv6 requirement may be attached
       to the IPv4 secondary interface. */
    const n = staticNode({ ipv6Cidr: "2001:db8:1::10/64", ipv6Gateway: "2001:db8:1::1" });
    n.additionalInterfaces = [
      {
        type: "ethernet",
        mode: "static",
        ethernet: { name: "eno9", macAddress: "00:00:5E:00:53:09" },
        ipv4Cidr: "10.10.5.10/24",
        advanced: {
          routes: [
            { destination: "10.0.0.0/24", nextHopAddress: "10.10.5.1", nextHopInterface: "eno9" }
          ]
        }
      }
    ];
    expect(run(n, false, true).errors).toEqual([]);
  });

  it("B4: the two messages the human saw were correct validation of leftover state", () => {
    /* Defect 1 — the primary kept its IPv4 config after the cluster became
       IPv6-only, so it had no address of the cluster's family.
       Defect 2 — a pre-existing route pointed at the primary, which no longer
       has IPv4. Both messages are correct; neither is about the secondary. */
    const n = staticNode({
      ipv4Cidr: "192.168.1.10/24",
      ipv4Gateway: "192.168.1.1",
      advanced: {
        routes: [
          { destination: "10.0.0.0/24", nextHopAddress: "192.168.1.254", nextHopInterface: "" }
        ]
      }
    });
    const text = run(n, false, true).errors.join(" | ");
    expect(text).toMatch(/IPv6 address\/CIDR is required for static mode in an IPv6-only cluster/);
    expect(text).toMatch(/IPv4 is not enabled on "[^"]+"/);
    // And neither message is attributed to a secondary interface.
    expect(text).not.toMatch(/Additional interface/);
  });

  it("an IPv4 route out of an IPv4 SECONDARY interface is allowed in an IPv6-only cluster", () => {
    /* The capability the old contract refused. The secondary interface
       genuinely carries IPv4, so a route out of it is valid NMState. */
    const n = staticNode({
      ipv6Cidr: "2001:db8::10/64",
      ipv6Gateway: "2001:db8::1"
    });
    n.additionalInterfaces = [
      {
        type: "ethernet",
        mode: "static",
        ethernet: { name: "eno9" },
        ipv4Cidr: "10.10.5.10/24",
        advanced: {
          routes: [
            { destination: "203.0.113.0/24", nextHopAddress: "10.10.5.1", nextHopInterface: "eno9" }
          ]
        }
      }
    ];
    const r = run(n, false, true);
    const text = r.errors.join(" | ");
    expect(text).not.toMatch(/IPv4 is not enabled on "eno9"/);
    expect(text).not.toMatch(/IPv6-only, so an IPv4 route cannot be applied/);
  });
});
