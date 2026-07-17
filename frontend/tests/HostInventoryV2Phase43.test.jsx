/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Phase 4.3: Catalog-driven controls and validation (inventory-v2 only).
 * (a) Enum field renders as select when allowed list present
 * (d) Legacy inventory step validation unaffected when flags OFF
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within, cleanup } from "@testing-library/react";
import { getScenarioId } from "../src/hostInventoryV2Helpers.js";
import { validateStep } from "../src/validation.js";
import { AppContext } from "../src/store.jsx";
import HostInventoryV2Step from "../src/steps/HostInventoryV2Step.jsx";
import * as catalogPathsModule from "../src/catalogPaths.js";
import * as catalogResolver from "../src/catalogResolver.js";

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

describe("Phase 4.3: HostInventoryV2 metadata-based field visibility (DOC-102 Slice 5H Chunk 7)", () => {
  const AC = "agent-config.yaml";
  const BOOT_URL_PLACEHOLDER = "https://example.com/agent-artifacts or leave empty";
  const AGENT_OPTIONS_HEADING = "Agent options";
  const AGENT_OPTIONS_SECTION = "agentOptions";

  const SYNTHETIC_CATALOG = [
    { path: "bootArtifactsBaseURL", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, type: "string", required: false },
    { path: "hosts[].role", outputFile: AC, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null, type: "string", allowed: ["master", "worker", "arbiter"], required: false },
    { path: "hosts[].hostname", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, type: "string", required: false },
    { path: "hosts[].networkConfig.dns-resolver", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
  ];

  function renderInventoryV2(stateOverride) {
    return render(
      <MockAppProvider stateOverride={stateOverride}>
        <HostInventoryV2Step />
      </MockAppProvider>
    );
  }

  function RerendererProvider({ children, initialState }) {
    const [current, setCurrent] = React.useState(initialState);
    const value = {
      state: current,
      updateState: () => {},
      loading: false,
      startOver: vi.fn(),
      __setCurrent: setCurrent
    };
    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
  }

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("requests raw catalog with '4.20' when state has selectedMinor 4.20", () => {
    const spy = vi.spyOn(catalogResolver, "getCatalogForScenario");
    renderInventoryV2({ version: { selectedMinor: "4.20" } });
    const call = spy.mock.calls.find((c) => c[0] === "bare-metal-agent");
    expect(call).toBeTruthy();
    expect(call[1]).toBe("4.20");
  });

  it("requests raw catalog with '4.21' when state has selectedMinor 4.21", () => {
    const spy = vi.spyOn(catalogResolver, "getCatalogForScenario");
    renderInventoryV2({ version: { selectedMinor: "4.21" } });
    const call = spy.mock.calls.find((c) => c[0] === "bare-metal-agent");
    expect(call).toBeTruthy();
    expect(call[1]).toBe("4.21");
  });

  it("passes explicit 4.22 to getCatalogForScenario without downgrading", () => {
    const catalogSpy = vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue([]);
    vi.spyOn(catalogPathsModule, "getCatalogForScenario").mockReturnValue([]);
    vi.spyOn(catalogPathsModule, "getCatalogPaths").mockReturnValue(new Set());
    renderInventoryV2({ version: { selectedMinor: "4.22" } });
    const call = catalogSpy.mock.calls.find((c) => c[0] === "bare-metal-agent");
    expect(call).toBeTruthy();
    expect(call[1]).toBe("4.22");
    expect(call[1]).not.toBe("4.20");
    expect(call[1]).not.toBe("4.21");
  });

  it("bootArtifactsBaseURL with minVersion 4.21: input and Agent Options section absent at 4.20", () => {
    const catalog = SYNTHETIC_CATALOG.map((e) =>
      e.path === "bootArtifactsBaseURL" ? { ...e, minVersion: "4.21" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const { container } = renderInventoryV2({ version: { selectedMinor: "4.20" } });
    expect(screen.queryByPlaceholderText(BOOT_URL_PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.queryByText(AGENT_OPTIONS_HEADING)).not.toBeInTheDocument();
    expect(container.querySelector(`[data-section="${AGENT_OPTIONS_SECTION}"]`)).toBeNull();
    expect(container.querySelector('[data-section="nodeGrid"]')).toBeTruthy();
  });

  it("bootArtifactsBaseURL with minVersion 4.21: input and Agent Options section present at 4.21", () => {
    const catalog = SYNTHETIC_CATALOG.map((e) =>
      e.path === "bootArtifactsBaseURL" ? { ...e, minVersion: "4.21" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const { container } = renderInventoryV2({ version: { selectedMinor: "4.21" } });
    expect(screen.getByPlaceholderText(BOOT_URL_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByText(AGENT_OPTIONS_HEADING)).toBeInTheDocument();
    expect(container.querySelector(`[data-section="${AGENT_OPTIONS_SECTION}"]`)).toBeTruthy();
  });

  it("Role selector and hostname input remain visible when bootArtifactsBaseURL is version-gated and section hidden", () => {
    const catalog = SYNTHETIC_CATALOG.map((e) =>
      e.path === "bootArtifactsBaseURL" ? { ...e, minVersion: "4.21" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const { container } = renderInventoryV2({ version: { selectedMinor: "4.20" } });
    expect(screen.queryByPlaceholderText(BOOT_URL_PLACEHOLDER)).not.toBeInTheDocument();
    expect(container.querySelector(`[data-section="${AGENT_OPTIONS_SECTION}"]`)).toBeNull();
    const tile = screen.getByText(/master-0/i);
    fireEvent.click(tile);
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel).toBeTruthy();
    expect(roleLabel.parentElement?.querySelector("select")).toBeTruthy();
    expect(screen.getByPlaceholderText("e.g. master-0, arbiter-0")).toBeInTheDocument();
  });

  it("bootArtifactsBaseURL with supported-backend-only: input and section absent, Role visible", () => {
    const catalog = SYNTHETIC_CATALOG.map((e) =>
      e.path === "bootArtifactsBaseURL" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const { container } = renderInventoryV2({ version: { selectedMinor: "4.20" } });
    expect(screen.queryByPlaceholderText(BOOT_URL_PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.queryByText(AGENT_OPTIONS_HEADING)).not.toBeInTheDocument();
    expect(container.querySelector(`[data-section="${AGENT_OPTIONS_SECTION}"]`)).toBeNull();
    expect(container.querySelector('[data-section="nodeGrid"]')).toBeTruthy();
    const tile = screen.getByText(/master-0/i);
    fireEvent.click(tile);
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel).toBeTruthy();
    expect(roleLabel.parentElement?.querySelector("select")).toBeTruthy();
  });

  it("missing bootArtifactsBaseURL entry: input and section absent, node grid visible", () => {
    const catalog = SYNTHETIC_CATALOG.filter((e) => e.path !== "bootArtifactsBaseURL");
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const { container } = renderInventoryV2({ version: { selectedMinor: "4.20" } });
    expect(screen.queryByPlaceholderText(BOOT_URL_PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.queryByText(AGENT_OPTIONS_HEADING)).not.toBeInTheDocument();
    expect(container.querySelector(`[data-section="${AGENT_OPTIONS_SECTION}"]`)).toBeNull();
    expect(container.querySelector('[data-section="nodeGrid"]')).toBeTruthy();
  });

  it("existing bootArtifactsBaseURL value unchanged when section hidden, section absent", () => {
    const catalog = SYNTHETIC_CATALOG.map((e) =>
      e.path === "bootArtifactsBaseURL" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = {
      version: { selectedMinor: "4.20" },
      hostInventory: {
        ...baseState.hostInventory,
        bootArtifactsBaseURL: "https://my-custom-url.example.com/artifacts"
      }
    };
    const { container } = renderInventoryV2(state);
    expect(screen.queryByPlaceholderText(BOOT_URL_PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.queryByText(AGENT_OPTIONS_HEADING)).not.toBeInTheDocument();
    expect(container.querySelector(`[data-section="${AGENT_OPTIONS_SECTION}"]`)).toBeNull();
    expect(state.hostInventory.bootArtifactsBaseURL).toBe("https://my-custom-url.example.com/artifacts");
  });

  it.each(["4.20", "4.21"])("real catalog %s: Role selector remains visible (exception preserved)", (version) => {
    renderInventoryV2({ version: { selectedMinor: version } });
    const tile = screen.getByText(/master-0/i);
    fireEvent.click(tile);
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel).toBeTruthy();
    const select = roleLabel.parentElement?.querySelector("select");
    expect(select).toBeTruthy();
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(options).toContain("master");
    expect(options).toContain("worker");
  });

  it("Role selector remains visible while Agent Options section is hidden", () => {
    const catalog = SYNTHETIC_CATALOG.map((e) =>
      e.path === "bootArtifactsBaseURL" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const { container } = renderInventoryV2({ version: { selectedMinor: "4.20" } });
    expect(screen.queryByPlaceholderText(BOOT_URL_PLACEHOLDER)).not.toBeInTheDocument();
    expect(container.querySelector(`[data-section="${AGENT_OPTIONS_SECTION}"]`)).toBeNull();
    const tile = screen.getByText(/master-0/i);
    fireEvent.click(tile);
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel).toBeTruthy();
    expect(roleLabel.parentElement?.querySelector("select")).toBeTruthy();
  });

  it.each(["4.20", "4.21"])("real catalog %s: Agent Options section and bootArtifactsBaseURL present", (version) => {
    const { container } = renderInventoryV2({ version: { selectedMinor: version } });
    expect(screen.getByPlaceholderText(BOOT_URL_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByText(AGENT_OPTIONS_HEADING)).toBeInTheDocument();
    expect(container.querySelector(`[data-section="${AGENT_OPTIONS_SECTION}"]`)).toBeTruthy();
  });

  it("unrelated node grid control still behaves as before when Agent Options section is hidden", () => {
    const catalog = SYNTHETIC_CATALOG.map((e) =>
      e.path === "bootArtifactsBaseURL" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const { container } = renderInventoryV2({ version: { selectedMinor: "4.20" } });
    expect(screen.queryByPlaceholderText(BOOT_URL_PLACEHOLDER)).not.toBeInTheDocument();
    expect(container.querySelector(`[data-section="${AGENT_OPTIONS_SECTION}"]`)).toBeNull();
    const tile = screen.getByText(/master-0/i);
    expect(tile).toBeTruthy();
    fireEvent.click(tile);
    const hostnameInput = screen.getByPlaceholderText("e.g. master-0, arbiter-0");
    expect(hostnameInput).toBeInTheDocument();
    expect(hostnameInput.value).toBe("master-0");
  });

  it("mounted version change: section appears when selectedMinor changes from 4.20 to 4.21", () => {
    const catalog421 = SYNTHETIC_CATALOG.map((e) =>
      e.path === "bootArtifactsBaseURL" ? { ...e, minVersion: "4.21" } : e
    );
    const spy = vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog421);
    const initialState = { ...baseState, version: { selectedMinor: "4.20" } };
    let setCurrentFn;
    function CapturingProvider({ children }) {
      const [current, setCurrent] = React.useState(initialState);
      setCurrentFn = setCurrent;
      const value = {
        state: current,
        updateState: () => {},
        loading: false,
        startOver: vi.fn()
      };
      return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
    }
    const { container } = render(
      <CapturingProvider>
        <HostInventoryV2Step />
      </CapturingProvider>
    );
    expect(screen.queryByPlaceholderText(BOOT_URL_PLACEHOLDER)).not.toBeInTheDocument();
    expect(container.querySelector(`[data-section="${AGENT_OPTIONS_SECTION}"]`)).toBeNull();
    act(() => {
      setCurrentFn((prev) => ({ ...prev, version: { selectedMinor: "4.21" } }));
    });
    expect(screen.getByPlaceholderText(BOOT_URL_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByText(AGENT_OPTIONS_HEADING)).toBeInTheDocument();
    expect(container.querySelector(`[data-section="${AGENT_OPTIONS_SECTION}"]`)).toBeTruthy();
    const calls = spy.mock.calls.filter((c) => c[0] === "bare-metal-agent");
    const versions = calls.map((c) => c[1]);
    expect(versions).toContain("4.20");
    expect(versions).toContain("4.21");
  });
});

describe("Phase 4.3: HostInventoryV2 hostname visibility (DOC-102 Slice 5H Chunk 8)", () => {
  const AC = "agent-config.yaml";
  const HOSTNAME_PLACEHOLDER = "e.g. master-0, arbiter-0";
  const FQDN_ARIA = "Use FQDN for hostname";
  const DNS_PLACEHOLDER = "192.168.1.10,192.168.1.11";

  const SYNTHETIC_CATALOG_BASE = [
    { path: "bootArtifactsBaseURL", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, type: "string", required: false },
    { path: "hosts[].role", outputFile: AC, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null, type: "string", allowed: ["master", "worker", "arbiter"], required: false },
    { path: "hosts[].hostname", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, type: "string", required: false },
    { path: "hosts[].networkConfig.dns-resolver", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
  ];

  function renderInventoryV2(stateOverride) {
    return render(
      <MockAppProvider stateOverride={stateOverride}>
        <HostInventoryV2Step />
      </MockAppProvider>
    );
  }

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // --- 1. minVersion visibility ---
  it("hostname absent at 4.20 when synthetic minVersion is 4.21", () => {
    const catalog = SYNTHETIC_CATALOG_BASE.map((e) =>
      e.path === "hosts[].hostname" ? { ...e, minVersion: "4.21" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    renderInventoryV2({ version: { selectedMinor: "4.20" } });
    const tile = screen.getByText(/master-0/i);
    fireEvent.click(tile);
    expect(screen.queryByPlaceholderText(HOSTNAME_PLACEHOLDER)).not.toBeInTheDocument();
  });

  it("hostname present at 4.21 when synthetic minVersion is 4.21", () => {
    const catalog = SYNTHETIC_CATALOG_BASE.map((e) =>
      e.path === "hosts[].hostname" ? { ...e, minVersion: "4.21" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    renderInventoryV2({ version: { selectedMinor: "4.21" } });
    const tile = screen.getByText(/master-0/i);
    fireEvent.click(tile);
    expect(screen.getByPlaceholderText(HOSTNAME_PLACEHOLDER)).toBeInTheDocument();
  });

  it("Role select present at both 4.20 and 4.21 when hostname has minVersion 4.21", () => {
    const catalog = SYNTHETIC_CATALOG_BASE.map((e) =>
      e.path === "hosts[].hostname" ? { ...e, minVersion: "4.21" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);

    renderInventoryV2({ version: { selectedMinor: "4.20" } });
    fireEvent.click(screen.getByText(/master-0/i));
    const roleLabel420 = screen.getByText(/^Role/);
    expect(roleLabel420.parentElement?.querySelector("select")).toBeTruthy();
    cleanup();

    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    renderInventoryV2({ version: { selectedMinor: "4.21" } });
    fireEvent.click(screen.getByText(/master-0/i));
    const roleLabel421 = screen.getByText(/^Role/);
    expect(roleLabel421.parentElement?.querySelector("select")).toBeTruthy();
  });

  // --- 2. Non-renderable status ---
  it("hostname absent when supportStatus is supported-backend-only; Role and DNS remain", () => {
    const catalog = SYNTHETIC_CATALOG_BASE.map((e) =>
      e.path === "hosts[].hostname" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    renderInventoryV2({ version: { selectedMinor: "4.20" } });
    fireEvent.click(screen.getByText(/master-0/i));
    expect(screen.queryByPlaceholderText(HOSTNAME_PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(FQDN_ARIA)).not.toBeInTheDocument();
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel.parentElement?.querySelector("select")).toBeTruthy();
    expect(screen.getByPlaceholderText(DNS_PLACEHOLDER)).toBeInTheDocument();
  });

  // --- 3. Missing entry ---
  it("hostname absent when hosts[].hostname omitted from catalog; Role remains", () => {
    const catalog = SYNTHETIC_CATALOG_BASE.filter((e) => e.path !== "hosts[].hostname");
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    renderInventoryV2({ version: { selectedMinor: "4.20" } });
    fireEvent.click(screen.getByText(/master-0/i));
    expect(screen.queryByPlaceholderText(HOSTNAME_PLACEHOLDER)).not.toBeInTheDocument();
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel.parentElement?.querySelector("select")).toBeTruthy();
  });

  // --- 4. State preservation ---
  it("stored hostname unchanged when field is hidden via metadata", () => {
    const catalog = SYNTHETIC_CATALOG_BASE.map((e) =>
      e.path === "hosts[].hostname" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = {
      version: { selectedMinor: "4.20" },
      hostInventory: {
        ...baseState.hostInventory,
        nodes: [
          { ...baseState.hostInventory.nodes[0], hostname: "my-custom-host" }
        ]
      }
    };
    renderInventoryV2(state);
    fireEvent.click(screen.getByText(/my-custom-host/i));
    expect(screen.queryByPlaceholderText(HOSTNAME_PLACEHOLDER)).not.toBeInTheDocument();
    expect(state.hostInventory.nodes[0].hostname).toBe("my-custom-host");
  });

  // --- 5. Mounted version change ---
  it("hostname appears on mounted version change 4.20→4.21 without remount", () => {
    const catalog = SYNTHETIC_CATALOG_BASE.map((e) =>
      e.path === "hosts[].hostname" ? { ...e, minVersion: "4.21" } : e
    );
    const spy = vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const initialState = { ...baseState, version: { selectedMinor: "4.20" } };
    let setCurrentFn;
    function CapturingProvider({ children }) {
      const [current, setCurrent] = React.useState(initialState);
      setCurrentFn = setCurrent;
      const value = {
        state: current,
        updateState: () => {},
        loading: false,
        startOver: vi.fn()
      };
      return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
    }
    render(
      <CapturingProvider>
        <HostInventoryV2Step />
      </CapturingProvider>
    );
    fireEvent.click(screen.getByText(/master-0/i));
    expect(screen.queryByPlaceholderText(HOSTNAME_PLACEHOLDER)).not.toBeInTheDocument();
    act(() => {
      setCurrentFn((prev) => ({ ...prev, version: { selectedMinor: "4.21" } }));
    });
    expect(screen.getByPlaceholderText(HOSTNAME_PLACEHOLDER)).toBeInTheDocument();
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel.parentElement?.querySelector("select")).toBeTruthy();
    const calls = spy.mock.calls.filter((c) => c[0] === "bare-metal-agent");
    const versions = calls.map((c) => c[1]);
    expect(versions).toContain("4.20");
    expect(versions).toContain("4.21");
  });

  // --- 6. Real-catalog regression ---
  it.each(["4.20", "4.21"])("real catalog bare-metal-agent %s: hostname input renders", (version) => {
    renderInventoryV2({ version: { selectedMinor: version } });
    fireEvent.click(screen.getByText(/master-0/i));
    expect(screen.getByPlaceholderText(HOSTNAME_PLACEHOLDER)).toBeInTheDocument();
  });

  it("real catalog vsphere-agent 4.20: hostname input renders", () => {
    const vsphereState = {
      blueprint: { platform: "VMware vSphere" },
      methodology: { method: "Agent-Based Installer" },
      version: { selectedMinor: "4.20" },
      hostInventory: {
        ...baseState.hostInventory,
        nodes: [
          {
            ...baseState.hostInventory.nodes[0],
            hostname: "vsphere-master-0"
          }
        ]
      }
    };
    renderInventoryV2(vsphereState);
    fireEvent.click(screen.getByText(/vsphere-master-0/i));
    expect(screen.getByPlaceholderText(HOSTNAME_PLACEHOLDER)).toBeInTheDocument();
  });

  it("real catalog vsphere-agent 4.21: hostname input renders", () => {
    const vsphereState = {
      blueprint: { platform: "VMware vSphere" },
      methodology: { method: "Agent-Based Installer" },
      version: { selectedMinor: "4.21" },
      hostInventory: {
        ...baseState.hostInventory,
        nodes: [
          {
            ...baseState.hostInventory.nodes[0],
            hostname: "vsphere-master-0"
          }
        ]
      }
    };
    renderInventoryV2(vsphereState);
    fireEvent.click(screen.getByText(/vsphere-master-0/i));
    expect(screen.getByPlaceholderText(HOSTNAME_PLACEHOLDER)).toBeInTheDocument();
  });

  // --- 7. Chunk 7 and scope containment ---
  it("Role, bootArtifactsBaseURL, and DNS controls remain; no other field received new gating", () => {
    renderInventoryV2({ version: { selectedMinor: "4.20" } });
    fireEvent.click(screen.getByText(/master-0/i));
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel.parentElement?.querySelector("select")).toBeTruthy();
    expect(screen.getByPlaceholderText("https://example.com/agent-artifacts or leave empty")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(DNS_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(HOSTNAME_PLACEHOLDER)).toBeInTheDocument();
  });
});

describe("DOC-102 Slice 5H Host Inventory H4 DNS visibility", () => {
  const AC = "agent-config.yaml";
  const DNS_SERVERS_PLACEHOLDER = "192.168.1.10,192.168.1.11";
  const HOSTNAME_PLACEHOLDER = "e.g. master-0, arbiter-0";

  const SYNTHETIC_CATALOG_DNS = [
    { path: "bootArtifactsBaseURL", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].role", outputFile: AC, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null, type: "string", allowed: ["master", "worker", "arbiter"] },
    { path: "hosts[].hostname", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].networkConfig.dns-resolver", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
  ];

  function renderWithCatalog(catalog, stateOverride) {
    if (catalog) {
      vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    }
    return render(
      <MockAppProvider stateOverride={stateOverride}>
        <HostInventoryV2Step />
      </MockAppProvider>
    );
  }

  function openDrawer() {
    fireEvent.click(screen.getByText(/master-0/i));
  }

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("supported parent renders the complete DNS group", () => {
    renderWithCatalog(SYNTHETIC_CATALOG_DNS, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.getByText("DNS Configuration")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(DNS_SERVERS_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByLabelText(/DNS search/)).toBeInTheDocument();
  });

  it("non-renderable parent hides the complete DNS group", () => {
    const catalog = SYNTHETIC_CATALOG_DNS.map(e =>
      e.path === "hosts[].networkConfig.dns-resolver" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.queryByText("DNS Configuration")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(DNS_SERVERS_PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/DNS search/)).not.toBeInTheDocument();
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel.parentElement?.querySelector("select")).toBeTruthy();
    expect(screen.getByPlaceholderText(HOSTNAME_PLACEHOLDER)).toBeInTheDocument();
  });

  it("missing parent hides the complete DNS group", () => {
    const catalog = SYNTHETIC_CATALOG_DNS.filter(e => e.path !== "hosts[].networkConfig.dns-resolver");
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.queryByText("DNS Configuration")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(DNS_SERVERS_PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/DNS search/)).not.toBeInTheDocument();
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel.parentElement?.querySelector("select")).toBeTruthy();
  });

  it("version eligibility: hidden at 4.20 when parent minVersion is 4.21", () => {
    const catalog = SYNTHETIC_CATALOG_DNS.map(e =>
      e.path === "hosts[].networkConfig.dns-resolver" ? { ...e, minVersion: "4.21" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.queryByText("DNS Configuration")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(DNS_SERVERS_PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/DNS search/)).not.toBeInTheDocument();
  });

  it("version eligibility: visible at 4.21 when parent minVersion is 4.21", () => {
    const catalog = SYNTHETIC_CATALOG_DNS.map(e =>
      e.path === "hosts[].networkConfig.dns-resolver" ? { ...e, minVersion: "4.21" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.21" } });
    openDrawer();
    expect(screen.getByText("DNS Configuration")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(DNS_SERVERS_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByLabelText(/DNS search/)).toBeInTheDocument();
  });

  it("mounted version transition: DNS group appears when version changes from 4.20 to 4.21", () => {
    const catalog = SYNTHETIC_CATALOG_DNS.map(e =>
      e.path === "hosts[].networkConfig.dns-resolver" ? { ...e, minVersion: "4.21" } : e
    );
    const spy = vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const initialState = { ...baseState, version: { selectedMinor: "4.20" } };
    let setCurrentFn;
    function CapturingProvider({ children }) {
      const [current, setCurrent] = React.useState(initialState);
      setCurrentFn = setCurrent;
      const value = {
        state: current,
        updateState: () => {},
        loading: false,
        startOver: vi.fn()
      };
      return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
    }
    render(
      <CapturingProvider>
        <HostInventoryV2Step />
      </CapturingProvider>
    );
    openDrawer();
    expect(screen.queryByText("DNS Configuration")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(DNS_SERVERS_PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/DNS search/)).not.toBeInTheDocument();
    act(() => {
      setCurrentFn(prev => ({ ...prev, version: { selectedMinor: "4.21" } }));
    });
    expect(screen.getByText("DNS Configuration")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(DNS_SERVERS_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByLabelText(/DNS search/)).toBeInTheDocument();
    const calls = spy.mock.calls.filter(c => c[0] === "bare-metal-agent");
    const versions = calls.map(c => c[1]);
    expect(versions).toContain("4.20");
    expect(versions).toContain("4.21");
  });

  it("state preservation: DNS values remain in state while UI is hidden", () => {
    const catalog = SYNTHETIC_CATALOG_DNS.map(e =>
      e.path === "hosts[].networkConfig.dns-resolver" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    const stateWithDns = {
      version: { selectedMinor: "4.20" },
      hostInventory: {
        ...baseState.hostInventory,
        nodes: [
          { ...baseState.hostInventory.nodes[0], dnsServers: "10.0.0.1,10.0.0.2", dnsSearch: "example.com,test.local" }
        ]
      }
    };
    renderWithCatalog(catalog, stateWithDns);
    openDrawer();
    expect(screen.queryByText("DNS Configuration")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(DNS_SERVERS_PLACEHOLDER)).not.toBeInTheDocument();
    expect(stateWithDns.hostInventory.nodes[0].dnsServers).toBe("10.0.0.1,10.0.0.2");
    expect(stateWithDns.hostInventory.nodes[0].dnsSearch).toBe("example.com,test.local");
  });

  it("atomicity: no metadata condition renders one DNS child without the other", () => {
    const conditions = [
      { label: "supported", catalog: SYNTHETIC_CATALOG_DNS, expectVisible: true },
      { label: "backend-only", catalog: SYNTHETIC_CATALOG_DNS.map(e =>
        e.path === "hosts[].networkConfig.dns-resolver" ? { ...e, supportStatus: "supported-backend-only" } : e
      ), expectVisible: false },
      { label: "missing", catalog: SYNTHETIC_CATALOG_DNS.filter(e =>
        e.path !== "hosts[].networkConfig.dns-resolver"
      ), expectVisible: false },
      { label: "version-ineligible", catalog: SYNTHETIC_CATALOG_DNS.map(e =>
        e.path === "hosts[].networkConfig.dns-resolver" ? { ...e, minVersion: "4.21" } : e
      ), expectVisible: false },
    ];
    for (const { label, catalog, expectVisible } of conditions) {
      cleanup();
      vi.restoreAllMocks();
      renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
      openDrawer();
      const headingPresent = !!screen.queryByText("DNS Configuration");
      const serversPresent = !!screen.queryByPlaceholderText(DNS_SERVERS_PLACEHOLDER);
      const searchPresent = !!screen.queryByLabelText(/DNS search/);
      expect(headingPresent).toBe(expectVisible);
      expect(serversPresent).toBe(expectVisible);
      expect(searchPresent).toBe(expectVisible);
      expect(serversPresent).toBe(searchPresent);
    }
  });

  it("no child-leaf dependency: parent visible even when child entries are absent", () => {
    const catalogWithoutChildren = SYNTHETIC_CATALOG_DNS.filter(e =>
      e.path !== "hosts[].networkConfig.dns-resolver.config.server" &&
      e.path !== "hosts[].networkConfig.dns-resolver.config.search"
    );
    renderWithCatalog(catalogWithoutChildren, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.getByText("DNS Configuration")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(DNS_SERVERS_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByLabelText(/DNS search/)).toBeInTheDocument();
  });

  it.each([
    ["bare-metal-agent", "Bare Metal", "4.20"],
    ["bare-metal-agent", "Bare Metal", "4.21"],
    ["vsphere-agent", "VMware vSphere", "4.20"],
    ["vsphere-agent", "VMware vSphere", "4.21"],
  ])("real catalog %s %s: DNS Configuration renders", (scenarioLabel, platform, version) => {
    const stateOverride = {
      blueprint: { platform },
      methodology: { method: "Agent-Based Installer" },
      version: { selectedMinor: version },
    };
    renderWithCatalog(null, stateOverride);
    openDrawer();
    expect(screen.getByText("DNS Configuration")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(DNS_SERVERS_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByLabelText(/DNS search/)).toBeInTheDocument();
  });

  it("scope containment: Role, Hostname, Root Device Hints, and primary networking not newly gated", () => {
    renderWithCatalog(null, { version: { selectedMinor: "4.20" } });
    openDrawer();
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel.parentElement?.querySelector("select")).toBeTruthy();
    expect(screen.getByPlaceholderText(HOSTNAME_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByText("Root Device Hints")).toBeInTheDocument();
    expect(screen.getByText("Primary Network")).toBeInTheDocument();
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
