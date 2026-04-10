/**
 * Phase 4.3: Catalog-driven controls and validation (inventory-v2 only).
 * (a) Enum field renders as select when allowed list present
 * (d) Legacy inventory step validation unaffected when flags OFF
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor, within, cleanup } from "@testing-library/react";
import { getScenarioId } from "../src/hostInventoryV2Helpers.js";
import { validateStep } from "../src/validation.js";
import { AppContext } from "../src/store.jsx";
import HostInventoryV2Step from "../src/steps/HostInventoryV2Step.jsx";

const baseState = {
  blueprint: { platform: "Bare Metal" },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: {
    nodes: [
      {
        role: "master",
        hostname: "master-0",
        rootDevice: "",
        dnsServers: "",
        dnsSearch: "",
        bmc: { address: "", username: "", password: "", bootMACAddress: "" },
        primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: "52:54:00:aa:11:01" }, bond: {}, vlan: {}, advanced: {} }
      }
    ],
    apiVip: "192.168.1.5",
    ingressVip: "192.168.1.7",
    enableIpv6: false
  },
  globalStrategy: { networking: { machineNetworkV4: "192.168.1.0/24" } },
  ui: { compareMode: false, scenarioAwareLayout: false }
};

function MockAppProvider({ children, stateOverride }) {
  const state = stateOverride ? { ...baseState, ...stateOverride } : baseState;
  const value = {
    state,
    updateState: () => {},
    loading: false,
    startOver: vi.fn()
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

describe("Phase 4.3: enum field renders as select when allowed list present", () => {
  it("Role field is a select with options from catalog (master, worker, arbiter) for bare-metal-agent", () => {
    render(
      <MockAppProvider>
        <HostInventoryV2Step />
      </MockAppProvider>
    );
    const tile = screen.getByText(/master-0/i);
    expect(tile).toBeTruthy();
    fireEvent.click(tile);
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel).toBeTruthy();
    const select = roleLabel.parentElement?.querySelector("select");
    expect(select).toBeTruthy();
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(options).toContain("master");
    expect(options).toContain("worker");
    expect(options).toContain("arbiter");
    expect(options.length).toBeGreaterThanOrEqual(2);
  });

  it("Generate nodes with 2 control plane auto-adds one arbiter for bare-metal-agent", async () => {
    const updateState = vi.fn();
    const stateWithEmptyNodes = {
      ...baseState,
      hostInventory: {
        ...baseState.hostInventory,
        nodes: [],
        apiVip: "192.168.1.5",
        ingressVip: "192.168.1.7"
      }
    };
    const value = {
      state: stateWithEmptyNodes,
      updateState,
      loading: false,
      startOver: vi.fn()
    };
    const { container } = render(
      <AppContext.Provider value={value}>
        <HostInventoryV2Step />
      </AppContext.Provider>
    );
    const nodeCountsSection = document.querySelector('[data-section="nodeCounts"]');
    expect(nodeCountsSection).toBeTruthy();
    const inputs = nodeCountsSection.querySelectorAll('input[type="number"]');
    const cpInput = inputs[0];
    const workerInput = inputs[1];
    expect(cpInput).toBeTruthy();
    await act(async () => {
      fireEvent.change(cpInput, { target: { value: "2" } });
      fireEvent.change(workerInput, { target: { value: "0" } });
    });
    const generateBtn = nodeCountsSection.querySelector("button.primary");
    expect(generateBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(generateBtn);
    });
    expect(updateState).toHaveBeenCalled();
    const patch = updateState.mock.calls.map((c) => c[0]).find((p) => p.hostInventory?.nodes?.length);
    expect(patch).toBeTruthy();
    const nodes = patch.hostInventory.nodes;
    expect(nodes).toHaveLength(3);
    const masters = nodes.filter((n) => n.role === "master");
    const arbiters = nodes.filter((n) => n.role === "arbiter");
    expect(masters).toHaveLength(2);
    expect(arbiters).toHaveLength(1);
    expect(arbiters[0].hostname).toBe("arbiter-0");
  });

  it("arbiter drawer: hides Apply-settings button and skips Root device hint validation warning", async () => {
    const updateState = vi.fn();
    const arbiterNode = {
      role: "arbiter",
      hostname: "arbiter-0",
      rootDevice: "",
      dnsServers: "",
      dnsSearch: "",
      bmc: { address: "", username: "", password: "", bootMACAddress: "" },
      primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth1", macAddress: "52:54:00:aa:11:01" }, bond: {}, vlan: {}, advanced: {} }
    };

    const masterNode = {
      ...arbiterNode,
      role: "master",
      hostname: "master-0",
      primary: { ...arbiterNode.primary, ethernet: { ...arbiterNode.primary.ethernet, macAddress: "52:54:00:aa:11:02" } }
    };

    const value = {
      state: {
        ...baseState,
        hostInventory: {
          ...baseState.hostInventory,
          nodes: [masterNode, arbiterNode]
        }
      },
      updateState,
      loading: false,
      startOver: vi.fn()
    };

    const { container } = render(
      <AppContext.Provider value={value}>
        <HostInventoryV2Step />
      </AppContext.Provider>
    );

    const arbiterTile = screen.getByText(/arbiter-0/i);
    fireEvent.click(arbiterTile);

    // Apply settings button should not exist for arbiter nodes.
    expect(within(container).queryByRole("button", { name: /Apply settings to other nodes/i })).toBeNull();

    // Root device hint warning should be skipped for arbiter targets.
    expect(within(container).queryByText(/Root device hint is missing/i)).toBeNull();
  });

  it("vSphere Agent: arbiter drawer does not offer bulk Apply settings to other nodes", async () => {
    const nodes = [
      {
        role: "master",
        hostname: "master-0",
        rootDevice: "/dev/disk/by-id/a",
        dnsServers: "",
        dnsSearch: "",
        primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: "52:54:00:aa:11:01" }, bond: {}, vlan: {}, advanced: {} }
      },
      {
        role: "master",
        hostname: "master-1",
        rootDevice: "/dev/disk/by-id/b",
        dnsServers: "",
        dnsSearch: "",
        primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: "52:54:00:aa:11:02" }, bond: {}, vlan: {}, advanced: {} }
      },
      {
        role: "arbiter",
        hostname: "arbiter-0",
        rootDevice: "/dev/disk/by-id/c",
        dnsServers: "",
        dnsSearch: "",
        primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: "52:54:00:aa:11:03" }, bond: {}, vlan: {}, advanced: {} }
      }
    ];
    const state = {
      ...baseState,
      blueprint: { platform: "VMware vSphere" },
      methodology: { method: "Agent-Based Installer" },
      hostInventory: { ...baseState.hostInventory, nodes }
    };
    const { container } = render(
      <MockAppProvider stateOverride={state}>
        <HostInventoryV2Step />
      </MockAppProvider>
    );
    expect(screen.queryByText(/Host Inventory v2 is not supported for this scenario/i)).toBeNull();
    const arbTile = Array.from(container.querySelectorAll("button.host-inventory-v2-tile")).find((b) =>
      b.textContent?.includes("arbiter-0")
    );
    expect(arbTile).toBeTruthy();
    await act(async () => {
      fireEvent.click(arbTile);
    });
    const drawers = await waitFor(() => screen.getAllByRole("dialog", { name: /Edit node/i }));
    const drawer = drawers.find((d) => within(d).queryByRole("heading", { name: /Edit: arbiter-0/i }));
    expect(drawer).toBeTruthy();
    expect(within(drawer).queryByRole("button", { name: /Apply settings to other nodes/i })).toBeNull();
    expect(
      within(drawer).getByText(/Bulk .*Apply settings to other nodes.* is not available while editing an arbiter/i)
    ).toBeTruthy();
  });
});

describe("Phase 4.3: legacy inventory step unaffected when flags OFF", () => {
  it("validateStep('inventory') does not depend on catalog merge (same shape, no inventory-v2 path)", () => {
    const state = {
      ...baseState,
      hostInventory: { ...baseState.hostInventory, apiVip: "", ingressVip: "" }
    };
    const result = validateStep(state, "inventory");
    expect(result).toHaveProperty("errors");
    expect(result).toHaveProperty("warnings");
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(getScenarioId(state.blueprint?.platform, state.methodology?.method)).toBe("bare-metal-agent");
    // API/Ingress VIPs are validated on the Networking step (or Global Strategy), not on Hosts/inventory
    const errorsIncludeApiVip = result.errors.some((e) => /API VIP/i.test(e));
    expect(errorsIncludeApiVip).toBe(false);
  });

  it("validateStep('inventory-v2') merges catalog validation when scenarioId is set", () => {
    const state = {
      ...baseState,
      hostInventory: {
        nodes: [{ role: "master", hostname: "m-0", primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: "52:54:00:11:22:33" }, bond: {}, vlan: {}, advanced: {} } }],
        apiVip: "1.2.3.4",
        ingressVip: "1.2.3.5",
        enableIpv6: false
      }
    };
    const result = validateStep(state, "inventory-v2");
    expect(result).toHaveProperty("errors");
    expect(result).toHaveProperty("warnings");
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

describe("Host inventory placeholder controls hardening", () => {
  it("shows repeated-field placeholder controls in node drawer and mark-all applies tokens to all nodes", async () => {
    cleanup();
    const updateState = vi.fn();
    const ipiState = {
      ...baseState,
      blueprint: { platform: "Bare Metal" },
      methodology: { method: "IPI" },
      hostInventory: {
        ...baseState.hostInventory,
        nodes: [
          {
            role: "master",
            hostname: "master-0",
            rootDevice: "/dev/disk/by-path/pci-0000:00:17.0",
            dnsServers: "",
            dnsSearch: "",
            bmc: {
              address: "redfish+http://192.168.1.10/redfish/v1/Systems/1",
              username: "admin",
              password: "secret",
              bootMACAddress: "52:54:00:aa:11:01"
            },
            primary: {
              type: "ethernet",
              mode: "static",
              ipv4Cidr: "192.168.1.20/24",
              ipv4Gateway: "192.168.1.1",
              ethernet: { name: "eno1", macAddress: "52:54:00:aa:11:11" },
              bond: {},
              vlan: {},
              advanced: {}
            }
          },
          {
            role: "worker",
            hostname: "worker-0",
            rootDevice: "/dev/disk/by-path/pci-0000:00:18.0",
            dnsServers: "",
            dnsSearch: "",
            bmc: {
              address: "redfish+http://192.168.1.11/redfish/v1/Systems/1",
              username: "admin",
              password: "secret",
              bootMACAddress: "52:54:00:aa:11:02"
            },
            primary: {
              type: "ethernet",
              mode: "static",
              ipv4Cidr: "192.168.1.21/24",
              ipv4Gateway: "192.168.1.1",
              ethernet: { name: "eno1", macAddress: "52:54:00:aa:11:12" },
              bond: {},
              vlan: {},
              advanced: {}
            }
          }
        ]
      }
    };
    const value = {
      state: ipiState,
      updateState,
      loading: false,
      startOver: vi.fn()
    };

    const { container } = render(
      <AppContext.Provider value={value}>
        <HostInventoryV2Step />
      </AppContext.Provider>
    );

    const firstNodeTile = container.querySelector(".host-inventory-v2-tile");
    expect(firstNodeTile).toBeTruthy();
    fireEvent.click(firstNodeTile);
    expect(screen.getByRole("button", { name: /Mark this node identity\/network fields for later completion/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mark this node BMC fields for later completion/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mark this node bond\/VLAN identifiers for later completion/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bulk apply core identity\/network placeholders to all nodes/i })).toBeTruthy();
    expect(screen.getAllByText(/Mark for later completion/i).length).toBeGreaterThanOrEqual(4);

    fireEvent.click(screen.getByRole("button", { name: /Bulk apply core identity\/network placeholders to all nodes/i }));
    fireEvent.click(screen.getByRole("button", { name: /Mark this node BMC fields for later completion/i }));
    const hostInventoryPatches = updateState.mock.calls
      .map((call) => call[0])
      .filter((patch) => patch?.hostInventory?.nodes?.length);
    expect(hostInventoryPatches.length).toBeGreaterThan(0);
    const lastPatch = hostInventoryPatches[hostInventoryPatches.length - 1];

    const placeholderCount = lastPatch.hostInventory.nodes.reduce((count, node) => {
      const candidates = [
        node.rootDevice,
        node.bmc?.address,
        node.bmc?.bootMACAddress,
        node.primary?.ipv4Cidr,
        node.primary?.ipv4Gateway
      ];
      return count + candidates.filter((value) => String(value || "").includes("__AIRA_PLACEHOLDER__")).length;
    }, 0);
    expect(placeholderCount).toBeGreaterThan(0);
  });
});
