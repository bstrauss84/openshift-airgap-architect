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

describe("DOC-102 Slice 5H Host Inventory H5 Root Device Hints visibility", () => {
  const AC = "agent-config.yaml";
  const HOSTNAME_PLACEHOLDER = "e.g. master-0, arbiter-0";
  const RDH_HEADING = "Root Device Hints";
  const RDH_INPUT_PLACEHOLDERS = [
    "/dev/disk/by-path/... or /dev/sda",
    "0:0:0:0",
    "INTEL SSDPE...",
    "ATA, NVMe, Samsung...",
    "S3Z9...",
    "0x5000...",
    "e.g. 100",
  ];
  const RDH_ROTATIONAL_OPTION = "false (SSD/NVMe)";

  const SYNTHETIC_CATALOG_RDH = [
    { path: "bootArtifactsBaseURL", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].role", outputFile: AC, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null, type: "string", allowed: ["master", "worker", "arbiter"] },
    { path: "hosts[].hostname", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].networkConfig", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].networkConfig.dns-resolver", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].rootDeviceHints", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
  ];

  function expectRdhPresent() {
    expect(screen.getByText(RDH_HEADING)).toBeInTheDocument();
    for (const ph of RDH_INPUT_PLACEHOLDERS) {
      expect(screen.getByPlaceholderText(ph)).toBeInTheDocument();
    }
    expect(screen.getByText(RDH_ROTATIONAL_OPTION)).toBeInTheDocument();
  }

  function expectRdhAbsent() {
    expect(screen.queryByText(RDH_HEADING)).not.toBeInTheDocument();
    for (const ph of RDH_INPUT_PLACEHOLDERS) {
      expect(screen.queryByPlaceholderText(ph)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(RDH_ROTATIONAL_OPTION)).not.toBeInTheDocument();
  }

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

  it("supported parent renders the complete workflow", () => {
    renderWithCatalog(SYNTHETIC_CATALOG_RDH, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expectRdhPresent();
  });

  it("non-renderable parent hides the complete workflow", () => {
    const catalog = SYNTHETIC_CATALOG_RDH.map(e =>
      e.path === "hosts[].rootDeviceHints" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expectRdhAbsent();
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel.parentElement?.querySelector("select")).toBeTruthy();
    expect(screen.getByPlaceholderText(HOSTNAME_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByText("DNS Configuration")).toBeInTheDocument();
  });

  it("missing parent hides the complete workflow", () => {
    const catalog = SYNTHETIC_CATALOG_RDH.filter(e => e.path !== "hosts[].rootDeviceHints");
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expectRdhAbsent();
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel.parentElement?.querySelector("select")).toBeTruthy();
    expect(screen.getByText("Primary Network")).toBeInTheDocument();
  });

  it("version eligibility: hidden at 4.20 when parent minVersion is 4.21", () => {
    const catalog = SYNTHETIC_CATALOG_RDH.map(e =>
      e.path === "hosts[].rootDeviceHints" ? { ...e, minVersion: "4.21" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expectRdhAbsent();
  });

  it("version eligibility: visible at 4.21 when parent minVersion is 4.21", () => {
    const catalog = SYNTHETIC_CATALOG_RDH.map(e =>
      e.path === "hosts[].rootDeviceHints" ? { ...e, minVersion: "4.21" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.21" } });
    openDrawer();
    expectRdhPresent();
  });

  it("mounted version transition: workflow appears when version changes from 4.20 to 4.21", () => {
    const catalog = SYNTHETIC_CATALOG_RDH.map(e =>
      e.path === "hosts[].rootDeviceHints" ? { ...e, minVersion: "4.21" } : e
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
    expectRdhAbsent();
    act(() => {
      setCurrentFn(prev => ({ ...prev, version: { selectedMinor: "4.21" } }));
    });
    expectRdhPresent();
    const calls = spy.mock.calls.filter(c => c[0] === "bare-metal-agent");
    const versions = calls.map(c => c[1]);
    expect(versions).toContain("4.20");
    expect(versions).toContain("4.21");
  });

  it("state preservation: values remain while hidden and reappear when eligible", () => {
    const catalog = SYNTHETIC_CATALOG_RDH.map(e =>
      e.path === "hosts[].rootDeviceHints" ? { ...e, minVersion: "4.21" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const nodeWithValues = {
      ...baseState.hostInventory.nodes[0],
      rootDevice: "/dev/disk/by-path/pci-0000:00:1f.2-ata-1",
      rootDeviceHintHctl: "1:0:0:0",
      rootDeviceHintModel: "INTEL SSDPE",
      rootDeviceHintVendor: "ATA",
      rootDeviceHintSerialNumber: "S3Z9NX0M123456",
      rootDeviceHintWwn: "0x5000c500a1b2c3d4",
      rootDeviceHintMinSizeGb: "100",
      rootDeviceHintRotational: "false",
    };
    const initialState = {
      ...baseState,
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, nodes: [nodeWithValues] }
    };
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
    expectRdhAbsent();
    expect(initialState.hostInventory.nodes[0].rootDevice).toBe("/dev/disk/by-path/pci-0000:00:1f.2-ata-1");
    expect(initialState.hostInventory.nodes[0].rootDeviceHintHctl).toBe("1:0:0:0");
    expect(initialState.hostInventory.nodes[0].rootDeviceHintModel).toBe("INTEL SSDPE");
    expect(initialState.hostInventory.nodes[0].rootDeviceHintVendor).toBe("ATA");
    expect(initialState.hostInventory.nodes[0].rootDeviceHintSerialNumber).toBe("S3Z9NX0M123456");
    expect(initialState.hostInventory.nodes[0].rootDeviceHintWwn).toBe("0x5000c500a1b2c3d4");
    expect(initialState.hostInventory.nodes[0].rootDeviceHintMinSizeGb).toBe("100");
    expect(initialState.hostInventory.nodes[0].rootDeviceHintRotational).toBe("false");
    act(() => {
      setCurrentFn(prev => ({ ...prev, version: { selectedMinor: "4.21" } }));
    });
    expectRdhPresent();
    expect(screen.getByPlaceholderText("/dev/disk/by-path/... or /dev/sda").value).toBe("/dev/disk/by-path/pci-0000:00:1f.2-ata-1");
    expect(screen.getByPlaceholderText("0:0:0:0").value).toBe("1:0:0:0");
    expect(screen.getByPlaceholderText("INTEL SSDPE...").value).toBe("INTEL SSDPE");
    expect(screen.getByPlaceholderText("ATA, NVMe, Samsung...").value).toBe("ATA");
    expect(screen.getByPlaceholderText("S3Z9...").value).toBe("S3Z9NX0M123456");
    expect(screen.getByPlaceholderText("0x5000...").value).toBe("0x5000c500a1b2c3d4");
    expect(screen.getByPlaceholderText("e.g. 100").value).toBe("100");
  });

  it("atomicity: under every metadata condition, either all eight controls render or none", () => {
    const conditions = [
      { label: "supported", catalog: SYNTHETIC_CATALOG_RDH, expectVisible: true },
      { label: "backend-only", catalog: SYNTHETIC_CATALOG_RDH.map(e =>
        e.path === "hosts[].rootDeviceHints" ? { ...e, supportStatus: "supported-backend-only" } : e
      ), expectVisible: false },
      { label: "missing", catalog: SYNTHETIC_CATALOG_RDH.filter(e =>
        e.path !== "hosts[].rootDeviceHints"
      ), expectVisible: false },
      { label: "version-ineligible", catalog: SYNTHETIC_CATALOG_RDH.map(e =>
        e.path === "hosts[].rootDeviceHints" ? { ...e, minVersion: "4.21" } : e
      ), expectVisible: false },
    ];
    for (const { label, catalog, expectVisible } of conditions) {
      cleanup();
      vi.restoreAllMocks();
      renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
      openDrawer();
      const headingPresent = !!screen.queryByText(RDH_HEADING);
      const allInputsPresent = RDH_INPUT_PLACEHOLDERS.every(ph => !!screen.queryByPlaceholderText(ph));
      const noInputsPresent = RDH_INPUT_PLACEHOLDERS.every(ph => !screen.queryByPlaceholderText(ph));
      const rotationalPresent = !!screen.queryByText(RDH_ROTATIONAL_OPTION);
      expect(headingPresent).toBe(expectVisible);
      expect(rotationalPresent).toBe(expectVisible);
      if (expectVisible) {
        expect(allInputsPresent).toBe(true);
      } else {
        expect(noInputsPresent).toBe(true);
      }
    }
  });

  it("no child-leaf dependency: parent supported with no child entries, all eight controls render", () => {
    renderWithCatalog(SYNTHETIC_CATALOG_RDH, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expectRdhPresent();
  });

  it("arbiter exclusion preserved: supported parent, arbiter node hides workflow", () => {
    const arbiterNode = {
      role: "arbiter",
      hostname: "arbiter-0",
      rootDevice: "",
      dnsServers: "",
      dnsSearch: "",
      bmc: { address: "", username: "", password: "", bootMACAddress: "" },
      primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: "52:54:00:aa:11:02" }, bond: {}, vlan: {}, advanced: {} }
    };
    const stateOverride = {
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, nodes: [{ ...baseState.hostInventory.nodes[0] }, arbiterNode] }
    };
    renderWithCatalog(SYNTHETIC_CATALOG_RDH, stateOverride);
    fireEvent.click(screen.getByText(/arbiter-0/i));
    expectRdhAbsent();
  });

  it("arbiter-to-non-arbiter transition: workflow appears when role changes", () => {
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(SYNTHETIC_CATALOG_RDH);
    const arbiterNode = {
      role: "arbiter",
      hostname: "arbiter-0",
      rootDevice: "/dev/sda",
      rootDeviceHintHctl: "0:0:0:0",
      rootDeviceHintModel: "",
      rootDeviceHintVendor: "",
      rootDeviceHintSerialNumber: "",
      rootDeviceHintWwn: "",
      rootDeviceHintMinSizeGb: "",
      rootDeviceHintRotational: "",
      dnsServers: "",
      dnsSearch: "",
      bmc: { address: "", username: "", password: "", bootMACAddress: "" },
      primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: "52:54:00:aa:11:01" }, bond: {}, vlan: {}, advanced: {} }
    };
    const masterNode = {
      ...baseState.hostInventory.nodes[0],
      primary: { ...baseState.hostInventory.nodes[0].primary, ethernet: { ...baseState.hostInventory.nodes[0].primary.ethernet, macAddress: "52:54:00:aa:11:02" } }
    };
    const initialState = {
      ...baseState,
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, nodes: [masterNode, arbiterNode] }
    };
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
    fireEvent.click(screen.getByText(/arbiter-0/i));
    expectRdhAbsent();
    act(() => {
      setCurrentFn(prev => ({
        ...prev,
        hostInventory: {
          ...prev.hostInventory,
          nodes: [
            prev.hostInventory.nodes[0],
            { ...prev.hostInventory.nodes[1], role: "worker" }
          ]
        }
      }));
    });
    expectRdhPresent();
    expect(screen.getByPlaceholderText("/dev/disk/by-path/... or /dev/sda").value).toBe("/dev/sda");
    expect(screen.getByPlaceholderText("0:0:0:0").value).toBe("0:0:0:0");
  });

  it("metadata cannot override structural exclusion: arbiter hidden with supported parent and eligible version", () => {
    const arbiterNode = {
      role: "arbiter",
      hostname: "arbiter-0",
      rootDevice: "",
      dnsServers: "",
      dnsSearch: "",
      bmc: { address: "", username: "", password: "", bootMACAddress: "" },
      primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: "52:54:00:aa:11:02" }, bond: {}, vlan: {}, advanced: {} }
    };
    const stateOverride = {
      version: { selectedMinor: "4.21" },
      hostInventory: { ...baseState.hostInventory, nodes: [{ ...baseState.hostInventory.nodes[0] }, arbiterNode] }
    };
    renderWithCatalog(SYNTHETIC_CATALOG_RDH, stateOverride);
    fireEvent.click(screen.getByText(/arbiter-0/i));
    expectRdhAbsent();
  });

  it.each([
    ["bare-metal-agent", "Bare Metal", "4.20"],
    ["bare-metal-agent", "Bare Metal", "4.21"],
    ["vsphere-agent", "VMware vSphere", "4.20"],
    ["vsphere-agent", "VMware vSphere", "4.21"],
  ])("real catalog %s %s: Root Device Hints renders for non-arbiter", (scenarioLabel, platform, version) => {
    const stateOverride = {
      blueprint: { platform },
      methodology: { method: "Agent-Based Installer" },
      version: { selectedMinor: version },
    };
    renderWithCatalog(null, stateOverride);
    openDrawer();
    expectRdhPresent();
  });

  it("real catalog: arbiter node does not render Root Device Hints workflow", () => {
    const arbiterNode = {
      role: "arbiter",
      hostname: "arbiter-0",
      rootDevice: "",
      dnsServers: "",
      dnsSearch: "",
      bmc: { address: "", username: "", password: "", bootMACAddress: "" },
      primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: "52:54:00:aa:11:02" }, bond: {}, vlan: {}, advanced: {} }
    };
    const stateOverride = {
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, nodes: [{ ...baseState.hostInventory.nodes[0] }, arbiterNode] }
    };
    renderWithCatalog(null, stateOverride);
    fireEvent.click(screen.getByText(/arbiter-0/i));
    expectRdhAbsent();
  });

  it("scope containment: Role, Hostname, DNS, and Primary Network not newly gated", () => {
    renderWithCatalog(SYNTHETIC_CATALOG_RDH, { version: { selectedMinor: "4.20" } });
    openDrawer();
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel.parentElement?.querySelector("select")).toBeTruthy();
    expect(screen.getByPlaceholderText(HOSTNAME_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByText("DNS Configuration")).toBeInTheDocument();
    expect(screen.getByText("Primary Network")).toBeInTheDocument();
  });
});

describe("DOC-102 Slice 5H Host Inventory H2 BMC workflow visibility", () => {
  const AC = "agent-config.yaml";
  const IC = "install-config.yaml";
  const BMC_WRAPPER = "BMC Configuration (Day-2 Seed)";
  const BMC_ADDR_PH = "redfish+http://192.168.1.1/...";
  const BOOT_MAC_PH = "52:54:00:aa:bb:cc";
  const HOSTNAME_PLACEHOLDER = "e.g. master-0, arbiter-0";

  const bmcNode = (hostname, mac) => ({
    role: "master",
    hostname,
    rootDevice: "",
    dnsServers: "",
    dnsSearch: "",
    bmc: { address: "", username: "", password: "", bootMACAddress: "", disableCertificateVerification: false },
    primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: mac }, bond: {}, vlan: {}, advanced: {} }
  });

  const BMC_NODES = [
    bmcNode("master-0", "52:54:00:aa:11:01"),
    bmcNode("master-1", "52:54:00:aa:11:02"),
    bmcNode("master-2", "52:54:00:aa:11:03"),
  ];

  const BMC_ELIGIBLE_OVERRIDE = {
    hostInventory: {
      ...baseState.hostInventory,
      nodes: BMC_NODES,
      includeBareMetalDay2InInstallConfig: true,
    },
  };

  const SYNTHETIC_CATALOG_BMC = [
    { path: "bootArtifactsBaseURL", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].role", outputFile: AC, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null, type: "string", allowed: ["master", "worker", "arbiter"] },
    { path: "hosts[].hostname", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].networkConfig", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].networkConfig.dns-resolver", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].rootDeviceHints", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "platform.baremetal.hosts[].bmc", outputFile: IC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "platform.baremetal.hosts[].bootMACAddress", outputFile: IC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
  ];

  function renderWithCatalog(catalog, stateOverride) {
    if (catalog) {
      vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    }
    return render(
      <MockAppProvider stateOverride={{ ...BMC_ELIGIBLE_OVERRIDE, ...stateOverride }}>
        <HostInventoryV2Step />
      </MockAppProvider>
    );
  }

  function openDrawer() {
    fireEvent.click(screen.getByText(/master-0/i));
  }

  function expectBmcCorePresent() {
    expect(screen.getByPlaceholderText(BMC_ADDR_PH)).toBeInTheDocument();
    expect(screen.getByLabelText(/BMC username/)).toBeInTheDocument();
    expect(screen.getByLabelText(/BMC password/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Disable BMC certificate verification/)).toBeInTheDocument();
  }

  function expectBmcCoreAbsent() {
    expect(screen.queryByPlaceholderText(BMC_ADDR_PH)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/BMC username/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/BMC password/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Disable BMC certificate verification/)).not.toBeInTheDocument();
  }

  function expectBootMacPresent() {
    expect(screen.getByPlaceholderText(BOOT_MAC_PH)).toBeInTheDocument();
  }

  function expectBootMacAbsent() {
    expect(screen.queryByPlaceholderText(BOOT_MAC_PH)).not.toBeInTheDocument();
  }

  function expectWrapperPresent() {
    expect(screen.getByText(BMC_WRAPPER)).toBeInTheDocument();
  }

  function expectWrapperAbsent() {
    expect(screen.queryByText(BMC_WRAPPER)).not.toBeInTheDocument();
  }

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("core visible + Boot MAC visible: wrapper and all five controls render", () => {
    renderWithCatalog(SYNTHETIC_CATALOG_BMC, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expectWrapperPresent();
    expectBmcCorePresent();
    expectBootMacPresent();
  });

  it("core visible + Boot MAC hidden (supported-backend-only): wrapper and four BMC core, no Boot MAC", () => {
    const catalog = SYNTHETIC_CATALOG_BMC.map(e =>
      e.path === "platform.baremetal.hosts[].bootMACAddress" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expectWrapperPresent();
    expectBmcCorePresent();
    expectBootMacAbsent();
  });

  it("core visible + Boot MAC hidden (missing entry): wrapper and four BMC core, no Boot MAC", () => {
    const catalog = SYNTHETIC_CATALOG_BMC.filter(e => e.path !== "platform.baremetal.hosts[].bootMACAddress");
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expectWrapperPresent();
    expectBmcCorePresent();
    expectBootMacAbsent();
  });

  it("core hidden (supported-backend-only) + Boot MAC visible: wrapper and Boot MAC only", () => {
    const catalog = SYNTHETIC_CATALOG_BMC.map(e =>
      e.path === "platform.baremetal.hosts[].bmc" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expectWrapperPresent();
    expectBmcCoreAbsent();
    expectBootMacPresent();
  });

  it("core hidden (missing entry) + Boot MAC visible: wrapper and Boot MAC only", () => {
    const catalog = SYNTHETIC_CATALOG_BMC.filter(e => e.path !== "platform.baremetal.hosts[].bmc");
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expectWrapperPresent();
    expectBmcCoreAbsent();
    expectBootMacPresent();
  });

  it("both hidden (supported-backend-only): no wrapper, all five absent", () => {
    const catalog = SYNTHETIC_CATALOG_BMC.map(e => {
      if (e.path === "platform.baremetal.hosts[].bmc") return { ...e, supportStatus: "supported-backend-only" };
      if (e.path === "platform.baremetal.hosts[].bootMACAddress") return { ...e, supportStatus: "supported-backend-only" };
      return e;
    });
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expectWrapperAbsent();
    expectBmcCoreAbsent();
    expectBootMacAbsent();
  });

  it("both hidden (missing entries): no wrapper, all five absent", () => {
    const catalog = SYNTHETIC_CATALOG_BMC.filter(e =>
      e.path !== "platform.baremetal.hosts[].bmc" && e.path !== "platform.baremetal.hosts[].bootMACAddress"
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expectWrapperAbsent();
    expectBmcCoreAbsent();
    expectBootMacAbsent();
  });

  it("credential-pair atomicity: username present == password present under every metadata condition", () => {
    const conditions = [
      { label: "both visible", catalog: SYNTHETIC_CATALOG_BMC },
      { label: "core visible, boot mac hidden", catalog: SYNTHETIC_CATALOG_BMC.filter(e => e.path !== "platform.baremetal.hosts[].bootMACAddress") },
      { label: "core hidden, boot mac visible", catalog: SYNTHETIC_CATALOG_BMC.map(e =>
        e.path === "platform.baremetal.hosts[].bmc" ? { ...e, supportStatus: "supported-backend-only" } : e
      ) },
      { label: "both hidden", catalog: SYNTHETIC_CATALOG_BMC.filter(e =>
        e.path !== "platform.baremetal.hosts[].bmc" && e.path !== "platform.baremetal.hosts[].bootMACAddress"
      ) },
    ];
    for (const { label, catalog } of conditions) {
      cleanup();
      vi.restoreAllMocks();
      renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
      openDrawer();
      const usernamePresent = !!screen.queryByLabelText(/BMC username/);
      const passwordPresent = !!screen.queryByLabelText(/BMC password/);
      expect(usernamePresent).toBe(passwordPresent);
    }
  });

  it("independent version eligibility: BMC core 4.20, Boot MAC 4.21 — at 4.20 only BMC core renders", () => {
    const catalog = SYNTHETIC_CATALOG_BMC.map(e => {
      if (e.path === "platform.baremetal.hosts[].bmc") return { ...e, minVersion: "4.20" };
      if (e.path === "platform.baremetal.hosts[].bootMACAddress") return { ...e, minVersion: "4.21" };
      return e;
    });
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expectWrapperPresent();
    expectBmcCorePresent();
    expectBootMacAbsent();
  });

  it("independent version eligibility: BMC core 4.20, Boot MAC 4.21 — at 4.21 both render", () => {
    const catalog = SYNTHETIC_CATALOG_BMC.map(e => {
      if (e.path === "platform.baremetal.hosts[].bmc") return { ...e, minVersion: "4.20" };
      if (e.path === "platform.baremetal.hosts[].bootMACAddress") return { ...e, minVersion: "4.21" };
      return e;
    });
    renderWithCatalog(catalog, { version: { selectedMinor: "4.21" } });
    openDrawer();
    expectWrapperPresent();
    expectBmcCorePresent();
    expectBootMacPresent();
  });

  it("independent version eligibility reversed: Boot MAC 4.20, BMC core 4.21 — at 4.20 only Boot MAC renders", () => {
    const catalog = SYNTHETIC_CATALOG_BMC.map(e => {
      if (e.path === "platform.baremetal.hosts[].bmc") return { ...e, minVersion: "4.21" };
      if (e.path === "platform.baremetal.hosts[].bootMACAddress") return { ...e, minVersion: "4.20" };
      return e;
    });
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expectWrapperPresent();
    expectBmcCoreAbsent();
    expectBootMacPresent();
  });

  it("independent version eligibility reversed: Boot MAC 4.20, BMC core 4.21 — at 4.21 both render", () => {
    const catalog = SYNTHETIC_CATALOG_BMC.map(e => {
      if (e.path === "platform.baremetal.hosts[].bmc") return { ...e, minVersion: "4.21" };
      if (e.path === "platform.baremetal.hosts[].bootMACAddress") return { ...e, minVersion: "4.20" };
      return e;
    });
    renderWithCatalog(catalog, { version: { selectedMinor: "4.21" } });
    openDrawer();
    expectWrapperPresent();
    expectBmcCorePresent();
    expectBootMacPresent();
  });

  it("mounted version transition: partially eligible at 4.20, fully eligible at 4.21", () => {
    const catalog = SYNTHETIC_CATALOG_BMC.map(e => {
      if (e.path === "platform.baremetal.hosts[].bmc") return { ...e, minVersion: "4.20" };
      if (e.path === "platform.baremetal.hosts[].bootMACAddress") return { ...e, minVersion: "4.21" };
      return e;
    });
    const spy = vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const initialState = { ...baseState, ...BMC_ELIGIBLE_OVERRIDE, version: { selectedMinor: "4.20" } };
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
    expectWrapperPresent();
    expectBmcCorePresent();
    expectBootMacAbsent();
    act(() => {
      setCurrentFn(prev => ({ ...prev, version: { selectedMinor: "4.21" } }));
    });
    expectWrapperPresent();
    expectBmcCorePresent();
    expectBootMacPresent();
    const calls = spy.mock.calls.filter(c => c[0] === "bare-metal-agent");
    const versions = calls.map(c => c[1]);
    expect(versions).toContain("4.20");
    expect(versions).toContain("4.21");
  });

  it("structural: scenario not bare-metal-agent hides wrapper even with both metadata visible", () => {
    const stateOverride = {
      blueprint: { platform: "VMware vSphere" },
      methodology: { method: "Agent-Based Installer" },
      version: { selectedMinor: "4.20" },
      hostInventory: {
        ...baseState.hostInventory,
        nodes: BMC_NODES,
        includeBareMetalDay2InInstallConfig: true,
      },
    };
    renderWithCatalog(SYNTHETIC_CATALOG_BMC, stateOverride);
    openDrawer();
    expectWrapperAbsent();
    expectBmcCoreAbsent();
    expectBootMacAbsent();
  });

  it("structural: SNO topology hides wrapper even with both metadata visible", () => {
    const snoNodes = [bmcNode("master-0", "52:54:00:aa:11:01")];
    const stateOverride = {
      version: { selectedMinor: "4.20" },
      hostInventory: {
        ...baseState.hostInventory,
        nodes: snoNodes,
        includeBareMetalDay2InInstallConfig: true,
      },
    };
    renderWithCatalog(SYNTHETIC_CATALOG_BMC, stateOverride);
    openDrawer();
    expectWrapperAbsent();
    expectBmcCoreAbsent();
    expectBootMacAbsent();
  });

  it("structural: includeBareMetalDay2InInstallConfig false hides wrapper even with both metadata visible", () => {
    const stateOverride = {
      version: { selectedMinor: "4.20" },
      hostInventory: {
        ...baseState.hostInventory,
        nodes: BMC_NODES,
        includeBareMetalDay2InInstallConfig: false,
      },
    };
    renderWithCatalog(SYNTHETIC_CATALOG_BMC, stateOverride);
    openDrawer();
    expectWrapperAbsent();
    expectBmcCoreAbsent();
    expectBootMacAbsent();
  });

  it("structural: all prerequisites true with both metadata visible renders wrapper", () => {
    renderWithCatalog(SYNTHETIC_CATALOG_BMC, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expectWrapperPresent();
    expectBmcCorePresent();
    expectBootMacPresent();
  });

  it("state preservation: BMC and Boot MAC values remain while hidden and reappear", () => {
    const catalog = SYNTHETIC_CATALOG_BMC.map(e => {
      if (e.path === "platform.baremetal.hosts[].bmc") return { ...e, minVersion: "4.21" };
      if (e.path === "platform.baremetal.hosts[].bootMACAddress") return { ...e, minVersion: "4.21" };
      return e;
    });
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const nodeWithValues = {
      ...BMC_NODES[0],
      bmc: {
        address: "redfish+https://10.0.0.1/redfish/v1/Systems/1",
        username: "test-admin",
        password: "test-secret-42",
        bootMACAddress: "aa:bb:cc:dd:ee:ff",
        disableCertificateVerification: true,
      },
    };
    const initialState = {
      ...baseState,
      ...BMC_ELIGIBLE_OVERRIDE,
      version: { selectedMinor: "4.20" },
      hostInventory: {
        ...BMC_ELIGIBLE_OVERRIDE.hostInventory,
        nodes: [nodeWithValues, BMC_NODES[1], BMC_NODES[2]],
      },
    };
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
    expectWrapperAbsent();
    expectBmcCoreAbsent();
    expectBootMacAbsent();
    expect(initialState.hostInventory.nodes[0].bmc.address).toBe("redfish+https://10.0.0.1/redfish/v1/Systems/1");
    expect(initialState.hostInventory.nodes[0].bmc.username).toBe("test-admin");
    expect(initialState.hostInventory.nodes[0].bmc.password).toBe("test-secret-42");
    expect(initialState.hostInventory.nodes[0].bmc.bootMACAddress).toBe("aa:bb:cc:dd:ee:ff");
    expect(initialState.hostInventory.nodes[0].bmc.disableCertificateVerification).toBe(true);
    act(() => {
      setCurrentFn(prev => ({ ...prev, version: { selectedMinor: "4.21" } }));
    });
    expectWrapperPresent();
    expectBmcCorePresent();
    expectBootMacPresent();
    expect(screen.getByPlaceholderText(BMC_ADDR_PH).value).toBe("redfish+https://10.0.0.1/redfish/v1/Systems/1");
    expect(screen.getByLabelText(/BMC username/).value).toBe("test-admin");
    expect(screen.getByPlaceholderText(BOOT_MAC_PH).value).toBe("aa:bb:cc:dd:ee:ff");
  });

  it("state preservation: hide BMC core while Boot MAC visible, core values unchanged", () => {
    const catalog = SYNTHETIC_CATALOG_BMC.map(e =>
      e.path === "platform.baremetal.hosts[].bmc" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    const nodeWithValues = {
      ...BMC_NODES[0],
      bmc: {
        address: "redfish+https://10.0.0.2/redfish/v1/Systems/1",
        username: "bmc-user-test",
        password: "bmc-pass-test",
        bootMACAddress: "11:22:33:44:55:66",
        disableCertificateVerification: true,
      },
    };
    const stateOverride = {
      version: { selectedMinor: "4.20" },
      hostInventory: {
        ...BMC_ELIGIBLE_OVERRIDE.hostInventory,
        nodes: [nodeWithValues, BMC_NODES[1], BMC_NODES[2]],
      },
    };
    renderWithCatalog(catalog, stateOverride);
    openDrawer();
    expectWrapperPresent();
    expectBmcCoreAbsent();
    expectBootMacPresent();
    expect(stateOverride.hostInventory.nodes[0].bmc.address).toBe("redfish+https://10.0.0.2/redfish/v1/Systems/1");
    expect(stateOverride.hostInventory.nodes[0].bmc.username).toBe("bmc-user-test");
    expect(stateOverride.hostInventory.nodes[0].bmc.password).toBe("bmc-pass-test");
    expect(stateOverride.hostInventory.nodes[0].bmc.disableCertificateVerification).toBe(true);
  });

  it("state preservation: hide Boot MAC while BMC core visible, Boot MAC value unchanged", () => {
    const catalog = SYNTHETIC_CATALOG_BMC.map(e =>
      e.path === "platform.baremetal.hosts[].bootMACAddress" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    const nodeWithValues = {
      ...BMC_NODES[0],
      bmc: {
        address: "redfish+https://10.0.0.3/redfish/v1/Systems/1",
        username: "admin-test",
        password: "pass-test",
        bootMACAddress: "aa:bb:cc:11:22:33",
        disableCertificateVerification: false,
      },
    };
    const stateOverride = {
      version: { selectedMinor: "4.20" },
      hostInventory: {
        ...BMC_ELIGIBLE_OVERRIDE.hostInventory,
        nodes: [nodeWithValues, BMC_NODES[1], BMC_NODES[2]],
      },
    };
    renderWithCatalog(catalog, stateOverride);
    openDrawer();
    expectWrapperPresent();
    expectBmcCorePresent();
    expectBootMacAbsent();
    expect(stateOverride.hostInventory.nodes[0].bmc.bootMACAddress).toBe("aa:bb:cc:11:22:33");
  });

  it("no child-leaf dependency: parent BMC and Boot MAC entries only, no child paths, all render", () => {
    renderWithCatalog(SYNTHETIC_CATALOG_BMC, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expectWrapperPresent();
    expectBmcCorePresent();
    expectBootMacPresent();
  });

  it.each(["4.20", "4.21"])("real catalog bare-metal-agent %s: BMC workflow renders with structural eligibility", (version) => {
    renderWithCatalog(null, { version: { selectedMinor: version } });
    openDrawer();
    expectWrapperPresent();
    expectBmcCorePresent();
    expectBootMacPresent();
  });

  it("real catalog: SNO hides BMC workflow", () => {
    const snoNodes = [bmcNode("master-0", "52:54:00:aa:11:01")];
    const stateOverride = {
      version: { selectedMinor: "4.20" },
      hostInventory: {
        ...baseState.hostInventory,
        nodes: snoNodes,
        includeBareMetalDay2InInstallConfig: true,
      },
    };
    renderWithCatalog(null, stateOverride);
    openDrawer();
    expectWrapperAbsent();
  });

  it("real catalog: non-bare-metal-agent scenario hides BMC workflow", () => {
    const stateOverride = {
      blueprint: { platform: "VMware vSphere" },
      methodology: { method: "Agent-Based Installer" },
      version: { selectedMinor: "4.20" },
      hostInventory: {
        ...baseState.hostInventory,
        nodes: BMC_NODES,
        includeBareMetalDay2InInstallConfig: true,
      },
    };
    renderWithCatalog(null, stateOverride);
    openDrawer();
    expectWrapperAbsent();
  });

  it("scope containment: H2-V does not newly gate Role, Hostname, DNS, Root Device Hints, or Primary Network", () => {
    renderWithCatalog(SYNTHETIC_CATALOG_BMC, { version: { selectedMinor: "4.20" } });
    openDrawer();
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel.parentElement?.querySelector("select")).toBeTruthy();
    expect(screen.getByPlaceholderText(HOSTNAME_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByText("DNS Configuration")).toBeInTheDocument();
    expect(screen.getByText("Root Device Hints")).toBeInTheDocument();
    expect(screen.getByText("Primary Network")).toBeInTheDocument();
  });
});

describe("DOC-102 Slice 5H H3 H7 H8 Primary Networking visibility", () => {
  const AC = "agent-config.yaml";
  const IC = "install-config.yaml";
  const HOSTNAME_PLACEHOLDER = "e.g. master-0, arbiter-0";

  const SYNTHETIC_CATALOG_NET = [
    { path: "bootArtifactsBaseURL", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].role", outputFile: AC, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null, type: "string", allowed: ["master", "worker", "arbiter"] },
    { path: "hosts[].hostname", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].networkConfig", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].networkConfig.dns-resolver", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].rootDeviceHints", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].networkConfig.interfaces", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
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

  // --- Visibility ---

  it("supported parent renders the Primary Network heading and baseline controls", () => {
    renderWithCatalog(SYNTHETIC_CATALOG_NET, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.getByText("Primary Network")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Single NIC ethernet")).toBeInTheDocument();
    expect(screen.getByDisplayValue("DHCP")).toBeInTheDocument();
  });

  it("supported-backend-only parent hides the entire main Primary Network editor", () => {
    const catalog = SYNTHETIC_CATALOG_NET.map(e =>
      e.path === "hosts[].networkConfig" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.queryByText("Primary Network")).not.toBeInTheDocument();
    expect(screen.queryByText("Primary Interface Type")).not.toBeInTheDocument();
    expect(screen.queryByText("IP assignment")).not.toBeInTheDocument();
  });

  it("missing parent hides the entire main Primary Network editor", () => {
    const catalog = SYNTHETIC_CATALOG_NET.filter(e => e.path !== "hosts[].networkConfig");
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.queryByText("Primary Network")).not.toBeInTheDocument();
    expect(screen.queryByText("Primary Interface Type")).not.toBeInTheDocument();
  });

  it("version eligibility: hidden at 4.20 when parent minVersion is 4.21", () => {
    const catalog = SYNTHETIC_CATALOG_NET.map(e =>
      e.path === "hosts[].networkConfig" ? { ...e, minVersion: "4.21" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.queryByText("Primary Network")).not.toBeInTheDocument();
  });

  it("version eligibility: visible at 4.21 when parent minVersion is 4.21", () => {
    const catalog = SYNTHETIC_CATALOG_NET.map(e =>
      e.path === "hosts[].networkConfig" ? { ...e, minVersion: "4.21" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.21" } });
    openDrawer();
    expect(screen.getByText("Primary Network")).toBeInTheDocument();
  });

  it("mounted transition from 4.20 to 4.21 updates visibility and resolver receives both versions", () => {
    const catalog = SYNTHETIC_CATALOG_NET.map(e =>
      e.path === "hosts[].networkConfig" ? { ...e, minVersion: "4.21" } : e
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
    expect(screen.queryByText("Primary Network")).not.toBeInTheDocument();
    act(() => {
      setCurrentFn(prev => ({ ...prev, version: { selectedMinor: "4.21" } }));
    });
    expect(screen.getByText("Primary Network")).toBeInTheDocument();
    const calls = spy.mock.calls.filter(c => c[0] === "bare-metal-agent");
    const versions = calls.map(c => c[1]);
    expect(versions).toContain("4.20");
    expect(versions).toContain("4.21");
  });

  it("no networking child metadata entries are required", () => {
    const catalog = SYNTHETIC_CATALOG_NET.filter(e =>
      !e.path.startsWith("hosts[].networkConfig.")
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.getByText("Primary Network")).toBeInTheDocument();
  });

  it("unsupported 4.22 remains rejected deterministically", () => {
    const assert422Rejected = () => {
      let error;
      try {
        catalogPathsModule.getCatalogForScenario("bare-metal-agent", "4.22");
        throw new Error("Expected UnsupportedVersionError but call succeeded");
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(catalogPathsModule.UnsupportedVersionError);
      expect(error.requestedVersion).toBe("4.22");
      expect(error.supportedVersions).toEqual(["4.20", "4.21"]);
      expect(error.message).toContain("4.20");
      expect(error.message).toContain("4.21");
      expect(error.message).toContain("not supported");
    };
    assert422Rejected();
    assert422Rejected();
  });

  // --- Mode coverage ---

  it("ethernet mode: renders interface name and MAC", () => {
    renderWithCatalog(SYNTHETIC_CATALOG_NET, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.getByPlaceholderText("eno0")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("52:54:00:aa:11:01")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("eno0").value).toBe("eth0");
    expect(screen.getByPlaceholderText("52:54:00:aa:11:01").value).toBe("52:54:00:aa:11:01");
  });

  it("bond mode: renders bond name, mode, member name, and member MAC", () => {
    const bondNode = {
      ...baseState.hostInventory.nodes[0],
      primary: {
        type: "bond", mode: "dhcp",
        ethernet: { name: "eno1", macAddress: "" },
        bond: { name: "bond0", mode: "802.3ad", slaves: [
          { name: "eth0", macAddress: "52:54:00:bb:22:01" },
          { name: "eth1", macAddress: "52:54:00:bb:22:02" }
        ]},
        vlan: {}, advanced: {}
      }
    };
    renderWithCatalog(SYNTHETIC_CATALOG_NET, {
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, nodes: [bondNode] }
    });
    openDrawer();
    expect(screen.getByPlaceholderText("bond0")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("bond0").value).toBe("bond0");
    const bondModeSelect = document.querySelector(".bond-mode-select");
    expect(bondModeSelect).toBeTruthy();
    expect(bondModeSelect.value).toBe("802.3ad");
    expect(screen.getByText("Bond member 1")).toBeInTheDocument();
    expect(screen.getByText("Bond member 2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("52:54:00:bb:22:01")).toBeInTheDocument();
    expect(screen.getByDisplayValue("52:54:00:bb:22:02")).toBeInTheDocument();
  });

  it("vlan-on-ethernet mode: renders VLAN ID, VLAN name, and ethernet controls", () => {
    const vlanEthNode = {
      ...baseState.hostInventory.nodes[0],
      primary: {
        type: "vlan-on-ethernet", mode: "dhcp",
        ethernet: { name: "eno1", macAddress: "52:54:00:aa:11:01" },
        bond: {}, vlan: { id: "100", name: "" }, advanced: {}
      }
    };
    renderWithCatalog(SYNTHETIC_CATALOG_NET, {
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, nodes: [vlanEthNode] }
    });
    openDrawer();
    expect(screen.getByPlaceholderText("eno0")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("eno0").value).toBe("eno1");
    expect(screen.getByPlaceholderText("52:54:00:aa:11:01")).toBeInTheDocument();
    const vlanIdInput = screen.getByPlaceholderText("100");
    expect(vlanIdInput).toBeInTheDocument();
    expect(vlanIdInput.value).toBe("100");
    const vlanNameInput = screen.getByLabelText(/VLAN name/);
    expect(vlanNameInput).toBeInTheDocument();
    expect(vlanNameInput.value).toBe("eno1.100");
  });

  it("vlan-on-bond mode: renders VLAN ID, VLAN name, and bond controls", () => {
    const vlanBondNode = {
      ...baseState.hostInventory.nodes[0],
      primary: {
        type: "vlan-on-bond", mode: "dhcp",
        ethernet: { name: "eno1", macAddress: "" },
        bond: { name: "bond0", mode: "active-backup", slaves: [
          { name: "eth0", macAddress: "52:54:00:cc:33:01" },
          { name: "eth1", macAddress: "52:54:00:cc:33:02" }
        ]},
        vlan: { id: "200", name: "" }, advanced: {}
      }
    };
    renderWithCatalog(SYNTHETIC_CATALOG_NET, {
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, nodes: [vlanBondNode] }
    });
    openDrawer();
    expect(screen.getByPlaceholderText("bond0")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("bond0").value).toBe("bond0");
    const bondModeSelect = document.querySelector(".bond-mode-select");
    expect(bondModeSelect).toBeTruthy();
    expect(bondModeSelect.value).toBe("active-backup");
    const vlanIdInput = screen.getByPlaceholderText("100");
    expect(vlanIdInput).toBeInTheDocument();
    expect(vlanIdInput.value).toBe("200");
    const vlanNameInput = screen.getByLabelText(/VLAN name/);
    expect(vlanNameInput).toBeInTheDocument();
    expect(vlanNameInput.value).toBe("bond0.200");
  });

  it("static mode: renders IPv4 CIDR, IPv4 gateway, IPv6 CIDR, and IPv6 gateway", () => {
    const staticNode = {
      ...baseState.hostInventory.nodes[0],
      primary: {
        type: "ethernet", mode: "static",
        ethernet: { name: "eno1", macAddress: "52:54:00:aa:11:01" },
        bond: {}, vlan: {},
        ipv4Cidr: "", ipv4Gateway: "", ipv6Cidr: "", ipv6Gateway: "",
        advanced: {}
      }
    };
    renderWithCatalog(SYNTHETIC_CATALOG_NET, {
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, ipStackMode: "dual-stack", nodes: [staticNode] }
    });
    openDrawer();
    expect(screen.getByPlaceholderText("192.168.1.20/24")).toBeInTheDocument();
    expect(screen.getByLabelText(/IPv4 gateway/)).toBeInTheDocument();
    expect(screen.getByLabelText(/IPv6 CIDR/)).toBeInTheDocument();
    expect(screen.getByLabelText(/IPv6 gateway/)).toBeInTheDocument();
  });

  // --- Primary advanced coverage ---

  it("showPrimaryNetwork controls primary MTU, routes, route fields", () => {
    const nodeWithRoutes = {
      ...baseState.hostInventory.nodes[0],
      primary: {
        ...baseState.hostInventory.nodes[0].primary,
        advanced: {
          mtu: "9000",
          routes: [{ destination: "10.0.0.0/24", nextHopAddress: "192.168.1.254", nextHopInterface: "bond0" }]
        }
      }
    };
    renderWithCatalog(SYNTHETIC_CATALOG_NET, {
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, nodes: [nodeWithRoutes] }
    });
    openDrawer();
    fireEvent.click(screen.getByLabelText("Expand Advanced"));
    expect(screen.getByPlaceholderText("1500")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("1500").value).toBe("9000");
    expect(screen.getByDisplayValue("10.0.0.0/24")).toBeInTheDocument();
    expect(screen.getByDisplayValue("192.168.1.254")).toBeInTheDocument();
    expect(screen.getByDisplayValue("bond0")).toBeInTheDocument();
  });

  it("when hidden: primary advanced absent, Additional Interfaces present, additional controls not newly gated", async () => {
    const catalog = SYNTHETIC_CATALOG_NET.map(e =>
      e.path === "hosts[].networkConfig" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const initialState = { ...baseState, version: { selectedMinor: "4.20" } };
    function StatefulProvider({ children }) {
      const [current, setCurrent] = React.useState(initialState);
      const value = {
        state: current,
        updateState: (patch) => setCurrent(prev => ({ ...prev, ...patch })),
        loading: false,
        startOver: vi.fn()
      };
      return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
    }
    render(
      <StatefulProvider>
        <HostInventoryV2Step />
      </StatefulProvider>
    );
    openDrawer();
    expect(screen.queryByText("Primary Network")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Expand Advanced")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("1500")).not.toBeInTheDocument();
    expect(screen.queryByText("Additional Routes")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText("Add Interface"));
    });
    expect(screen.getByText("Interface 1")).toBeInTheDocument();
    const ifaceSection = screen.getByText("Interface 1").closest("section");
    expect(ifaceSection).toBeTruthy();
    const typeLabel = within(ifaceSection).getByText("Type");
    expect(typeLabel).toBeInTheDocument();
    const typeSelect = typeLabel.closest("label").querySelector("select");
    expect(typeSelect).toBeTruthy();
    expect(typeSelect.value).toBe("ethernet");
    expect(within(ifaceSection).getByText("IP Assignment")).toBeInTheDocument();
    expect(within(ifaceSection).getByPlaceholderText("eth2")).toBeInTheDocument();
    expect(within(ifaceSection).getByPlaceholderText("52:54:00:aa:11:03")).toBeInTheDocument();
    expect(screen.queryByText("Primary Network")).not.toBeInTheDocument();
  });

  // --- State preservation ---

  it("state preservation: values remain while hidden and reappear when eligible", () => {
    const catalog = SYNTHETIC_CATALOG_NET.map(e =>
      e.path === "hosts[].networkConfig" ? { ...e, minVersion: "4.21" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const fullNode = {
      role: "master",
      hostname: "master-0",
      rootDevice: "",
      dnsServers: "",
      dnsSearch: "",
      bmc: { address: "", username: "", password: "", bootMACAddress: "" },
      primary: {
        type: "bond", mode: "static",
        ethernet: { name: "eno1", macAddress: "52:54:00:aa:11:01" },
        bond: { name: "bond0", mode: "802.3ad", slaves: [
          { name: "eth0", macAddress: "52:54:00:bb:22:01" },
          { name: "eth1", macAddress: "52:54:00:bb:22:02" }
        ]},
        vlan: { id: "100", name: "bond0.100" },
        ipv4Cidr: "192.168.1.20/24",
        ipv4Gateway: "192.168.1.1",
        ipv6Cidr: "fd00::14/64",
        ipv6Gateway: "fd00::1",
        advanced: {
          mtu: "9000",
          routes: [{ destination: "10.0.0.0/24", nextHopAddress: "192.168.1.254", nextHopInterface: "bond0" }]
        }
      }
    };
    const initialState = {
      ...baseState,
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, ipStackMode: "dual-stack", nodes: [fullNode] }
    };
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
    expect(screen.queryByText("Primary Network")).not.toBeInTheDocument();
    expect(initialState.hostInventory.nodes[0].primary.type).toBe("bond");
    expect(initialState.hostInventory.nodes[0].primary.mode).toBe("static");
    expect(initialState.hostInventory.nodes[0].primary.ethernet.name).toBe("eno1");
    expect(initialState.hostInventory.nodes[0].primary.ethernet.macAddress).toBe("52:54:00:aa:11:01");
    expect(initialState.hostInventory.nodes[0].primary.bond.name).toBe("bond0");
    expect(initialState.hostInventory.nodes[0].primary.bond.mode).toBe("802.3ad");
    expect(initialState.hostInventory.nodes[0].primary.bond.slaves).toHaveLength(2);
    expect(initialState.hostInventory.nodes[0].primary.bond.slaves[0].name).toBe("eth0");
    expect(initialState.hostInventory.nodes[0].primary.bond.slaves[0].macAddress).toBe("52:54:00:bb:22:01");
    expect(initialState.hostInventory.nodes[0].primary.vlan.id).toBe("100");
    expect(initialState.hostInventory.nodes[0].primary.vlan.name).toBe("bond0.100");
    expect(initialState.hostInventory.nodes[0].primary.ipv4Cidr).toBe("192.168.1.20/24");
    expect(initialState.hostInventory.nodes[0].primary.ipv4Gateway).toBe("192.168.1.1");
    expect(initialState.hostInventory.nodes[0].primary.ipv6Cidr).toBe("fd00::14/64");
    expect(initialState.hostInventory.nodes[0].primary.ipv6Gateway).toBe("fd00::1");
    expect(initialState.hostInventory.nodes[0].primary.advanced.mtu).toBe("9000");
    expect(initialState.hostInventory.nodes[0].primary.advanced.routes[0].destination).toBe("10.0.0.0/24");
    act(() => {
      setCurrentFn(prev => ({ ...prev, version: { selectedMinor: "4.21" } }));
    });
    expect(screen.getByText("Primary Network")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("bond0")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("bond0").value).toBe("bond0");
    const bondModeSelect = document.querySelector(".bond-mode-select");
    expect(bondModeSelect).toBeTruthy();
    expect(bondModeSelect.value).toBe("802.3ad");
    expect(screen.getByText("Bond member 1")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("192.168.1.20/24").value).toBe("192.168.1.20/24");
    expect(screen.getByLabelText(/IPv4 gateway/).value).toBe("192.168.1.1");
    expect(screen.getByLabelText(/IPv6 CIDR/).value).toBe("fd00::14/64");
    expect(screen.getByLabelText(/IPv6 gateway/).value).toBe("fd00::1");
    fireEvent.click(screen.getByLabelText("Expand Advanced"));
    expect(screen.getByPlaceholderText("1500").value).toBe("9000");
    expect(screen.getByDisplayValue("10.0.0.0/24")).toBeInTheDocument();
    expect(screen.getByDisplayValue("192.168.1.254")).toBeInTheDocument();
  });

  // --- Scope containment ---

  it("when hidden: Role, Hostname, DNS, Root Device Hints, and Additional Interfaces remain", () => {
    const catalog = SYNTHETIC_CATALOG_NET.map(e =>
      e.path === "hosts[].networkConfig" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.queryByText("Primary Network")).not.toBeInTheDocument();
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel.parentElement?.querySelector("select")).toBeTruthy();
    expect(screen.getByPlaceholderText(HOSTNAME_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByText("DNS Configuration")).toBeInTheDocument();
    expect(screen.getByText("Root Device Hints")).toBeInTheDocument();
    expect(screen.getByText("Add Interface")).toBeInTheDocument();
  });

  it("when hidden: BMC remains when structurally eligible", () => {
    const bmcMkNode = (hostname, mac) => ({
      role: "master", hostname,
      rootDevice: "", dnsServers: "", dnsSearch: "",
      bmc: { address: "", username: "", password: "", bootMACAddress: "", disableCertificateVerification: false },
      primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: mac }, bond: {}, vlan: {}, advanced: {} }
    });
    const catalog = [
      ...SYNTHETIC_CATALOG_NET.map(e =>
        e.path === "hosts[].networkConfig" ? { ...e, supportStatus: "supported-backend-only" } : e
      ),
      { path: "platform.baremetal.hosts[].bmc", outputFile: IC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
      { path: "platform.baremetal.hosts[].bootMACAddress", outputFile: IC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    ];
    const nodes = [bmcMkNode("master-0", "52:54:00:aa:11:01"), bmcMkNode("master-1", "52:54:00:aa:11:02"), bmcMkNode("master-2", "52:54:00:aa:11:03")];
    renderWithCatalog(catalog, {
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, nodes, includeBareMetalDay2InInstallConfig: true }
    });
    openDrawer();
    expect(screen.queryByText("Primary Network")).not.toBeInTheDocument();
    expect(screen.getByText("BMC Configuration (Day-2 Seed)")).toBeInTheDocument();
  });

  // --- Real-catalog tests ---

  it.each([
    ["bare-metal-agent", "Bare Metal", "4.20"],
    ["bare-metal-agent", "Bare Metal", "4.21"],
    ["vsphere-agent", "VMware vSphere", "4.20"],
    ["vsphere-agent", "VMware vSphere", "4.21"],
  ])("real catalog %s %s: Primary Network, Advanced, and Additional Interfaces render", (scenarioLabel, platform, version) => {
    const stateOverride = {
      blueprint: { platform },
      methodology: { method: "Agent-Based Installer" },
      version: { selectedMinor: version },
    };
    renderWithCatalog(null, stateOverride);
    openDrawer();
    expect(screen.getByText("Primary Network")).toBeInTheDocument();
    expect(screen.getByLabelText("Expand Advanced")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Expand Advanced"));
    expect(screen.getByPlaceholderText("1500")).toBeInTheDocument();
    expect(screen.getByText("Add Interface")).toBeInTheDocument();
  });
});

describe("DOC-102 Slice 5H H6/H7/H8-V Additional Interfaces visibility", () => {
  const AC = "agent-config.yaml";
  const IC = "install-config.yaml";
  const HOSTNAME_PLACEHOLDER = "e.g. master-0, arbiter-0";

  const SYNTHETIC_CATALOG_AI = [
    { path: "bootArtifactsBaseURL", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].role", outputFile: AC, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null, type: "string", allowed: ["master", "worker", "arbiter"] },
    { path: "hosts[].hostname", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].networkConfig", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].networkConfig.dns-resolver", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].rootDeviceHints", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].networkConfig.interfaces", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "platform.baremetal.hosts[].bmc", outputFile: IC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "platform.baremetal.hosts[].bootMACAddress", outputFile: IC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
  ];

  const fullAdditionalInterface = {
    type: "ethernet",
    mode: "static",
    ipv4Cidr: "10.10.10.5/24",
    ipv4Gateway: "10.10.10.1",
    ipv6Cidr: "fd01::5/64",
    ipv6Gateway: "fd01::1",
    ethernet: { name: "eno99", macAddress: "52:54:00:ff:ee:dd" },
    bond: {
      name: "bond7",
      mode: "802.3ad",
      slaves: [
        { name: "eth10", macAddress: "52:54:00:dd:cc:bb" },
        { name: "eth11", macAddress: "52:54:00:dd:cc:cc" }
      ]
    },
    vlan: { id: "777", baseIface: "eno99", name: "eno99.777" },
    advanced: {
      mtu: "9216",
      sriov: { enabled: true, totalVfs: "16" },
      vrf: { enabled: true, name: "vrf-test", tableId: "200", ports: "eno99,bond7" },
      routes: [{ destination: "172.16.0.0/12", nextHopAddress: "10.10.10.254", nextHopInterface: "eno99" }]
    }
  };

  const nodeWithFullAdditional = {
    role: "master",
    hostname: "master-0",
    rootDevice: "",
    dnsServers: "",
    dnsSearch: "",
    bmc: { address: "", username: "", password: "", bootMACAddress: "" },
    primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: "52:54:00:aa:11:01" }, bond: {}, vlan: {}, advanced: {} },
    additionalInterfaces: [fullAdditionalInterface]
  };

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

  // --- A. Visibility decision tests ---

  it("A1: supported-ui, minVersion 4.20, no maxVersion — visible at 4.20", () => {
    renderWithCatalog(SYNTHETIC_CATALOG_AI, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.getByText("Add Interface")).toBeInTheDocument();
  });

  it("A1: supported-ui, minVersion 4.20, no maxVersion — visible at 4.21", () => {
    renderWithCatalog(SYNTHETIC_CATALOG_AI, { version: { selectedMinor: "4.21" } });
    openDrawer();
    expect(screen.getByText("Add Interface")).toBeInTheDocument();
  });

  it("A2: supported-backend-only — hidden", () => {
    const catalog = SYNTHETIC_CATALOG_AI.map(e =>
      e.path === "hosts[].networkConfig.interfaces" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.queryByText("Add Interface")).not.toBeInTheDocument();
  });

  it("A3: missing exact parent entry — hidden", () => {
    const catalog = SYNTHETIC_CATALOG_AI.filter(e => e.path !== "hosts[].networkConfig.interfaces");
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.queryByText("Add Interface")).not.toBeInTheDocument();
  });

  it("A4: minVersion 4.21 — hidden at 4.20", () => {
    const catalog = SYNTHETIC_CATALOG_AI.map(e =>
      e.path === "hosts[].networkConfig.interfaces" ? { ...e, minVersion: "4.21" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.queryByText("Add Interface")).not.toBeInTheDocument();
  });

  it("A4: minVersion 4.21 — visible at 4.21", () => {
    const catalog = SYNTHETIC_CATALOG_AI.map(e =>
      e.path === "hosts[].networkConfig.interfaces" ? { ...e, minVersion: "4.21" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.21" } });
    openDrawer();
    expect(screen.getByText("Add Interface")).toBeInTheDocument();
  });

  it("A5: maxVersion 4.20 — visible at 4.20", () => {
    const catalog = SYNTHETIC_CATALOG_AI.map(e =>
      e.path === "hosts[].networkConfig.interfaces" ? { ...e, maxVersion: "4.20" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.20" } });
    openDrawer();
    expect(screen.getByText("Add Interface")).toBeInTheDocument();
  });

  it("A5: maxVersion 4.20 — hidden at 4.21", () => {
    const catalog = SYNTHETIC_CATALOG_AI.map(e =>
      e.path === "hosts[].networkConfig.interfaces" ? { ...e, maxVersion: "4.20" } : e
    );
    renderWithCatalog(catalog, { version: { selectedMinor: "4.21" } });
    openDrawer();
    expect(screen.queryByText("Add Interface")).not.toBeInTheDocument();
  });

  // --- B. Independent Primary and Additional gates ---

  it("B1: Primary visible, Additional hidden — Primary Network visible, Additional absent", () => {
    const catalog = SYNTHETIC_CATALOG_AI.map(e => {
      if (e.path === "hosts[].networkConfig") return { ...e, supportStatus: "supported-ui" };
      if (e.path === "hosts[].networkConfig.interfaces") return { ...e, supportStatus: "supported-backend-only" };
      return e;
    });
    const stateOverride = {
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, nodes: [nodeWithFullAdditional] }
    };
    renderWithCatalog(catalog, stateOverride);
    openDrawer();
    expect(screen.getByText("Primary Network")).toBeInTheDocument();
    expect(screen.getByLabelText("Expand Advanced")).toBeInTheDocument();
    expect(screen.queryByText("Add Interface")).not.toBeInTheDocument();
    expect(screen.queryByText("Interface 1")).not.toBeInTheDocument();
  });

  it("B2: Primary hidden, Additional visible — Primary absent, Additional present and functional", async () => {
    const catalog = SYNTHETIC_CATALOG_AI.map(e => {
      if (e.path === "hosts[].networkConfig") return { ...e, supportStatus: "supported-backend-only" };
      if (e.path === "hosts[].networkConfig.interfaces") return { ...e, supportStatus: "supported-ui" };
      return e;
    });
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const initialState = { ...baseState, version: { selectedMinor: "4.20" } };
    function StatefulProvider({ children }) {
      const [current, setCurrent] = React.useState(initialState);
      const value = {
        state: current,
        updateState: (patch) => setCurrent(prev => ({ ...prev, ...patch })),
        loading: false,
        startOver: vi.fn()
      };
      return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
    }
    render(
      <StatefulProvider>
        <HostInventoryV2Step />
      </StatefulProvider>
    );
    openDrawer();
    expect(screen.queryByText("Primary Network")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Expand Advanced")).not.toBeInTheDocument();
    expect(screen.getByText("Add Interface")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText("Add Interface"));
    });
    expect(screen.getByText("Interface 1")).toBeInTheDocument();
    const ifaceSection = screen.getByText("Interface 1").closest("section");
    expect(ifaceSection).toBeTruthy();
    const typeLabel = within(ifaceSection).getByText("Type");
    expect(typeLabel).toBeInTheDocument();
    expect(within(ifaceSection).getByText("IP Assignment")).toBeInTheDocument();
  });

  // --- C. All 19 controls are inside the gate ---

  it("C1: Ethernet DHCP — HI-037 type, HI-038 IP assignment, HI-039 Ethernet name, HI-040 Ethernet MAC", async () => {
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(SYNTHETIC_CATALOG_AI);
    const initialState = { ...baseState, version: { selectedMinor: "4.20" } };
    function StatefulProvider({ children }) {
      const [current, setCurrent] = React.useState(initialState);
      const value = {
        state: current,
        updateState: (patch) => setCurrent(prev => ({ ...prev, ...patch })),
        loading: false,
        startOver: vi.fn()
      };
      return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
    }
    render(
      <StatefulProvider>
        <HostInventoryV2Step />
      </StatefulProvider>
    );
    openDrawer();
    await act(async () => {
      fireEvent.click(screen.getByText("Add Interface"));
    });
    const ifaceSection = screen.getByText("Interface 1").closest("section");
    expect(ifaceSection).toBeTruthy();
    const typeLabel = within(ifaceSection).getByText("Type");
    const typeSelect = typeLabel.closest("label").querySelector("select");
    expect(typeSelect).toBeTruthy();
    expect(typeSelect.value).toBe("ethernet");
    expect(within(ifaceSection).getByText("IP Assignment")).toBeInTheDocument();
    expect(within(ifaceSection).getByText("Ethernet Interface Name")).toBeInTheDocument();
    expect(within(ifaceSection).getByText("Ethernet MAC Address")).toBeInTheDocument();
  });

  it("C2: Bond — HI-041 Bond name, HI-042 Bond mode, HI-043 member name, HI-044 member MAC", async () => {
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(SYNTHETIC_CATALOG_AI);
    const bondIface = {
      type: "bond",
      mode: "dhcp",
      ipv4Cidr: "", ipv4Gateway: "", ipv6Cidr: "", ipv6Gateway: "",
      ethernet: { name: "eno0", macAddress: "" },
      bond: {
        name: "bond1",
        mode: "802.3ad",
        slaves: [
          { name: "eth5", macAddress: "52:54:00:c1:c2:c3" },
          { name: "eth6", macAddress: "52:54:00:c4:c5:c6" }
        ]
      },
      vlan: { id: "", baseIface: "", name: "" },
      advanced: { mtu: "1500", sriov: { enabled: false, totalVfs: "" }, vrf: { enabled: false, name: "vrf0", tableId: "100", ports: "" }, routes: [] }
    };
    const nodeWithBond = {
      ...baseState.hostInventory.nodes[0],
      additionalInterfaces: [bondIface]
    };
    renderWithCatalog(SYNTHETIC_CATALOG_AI, {
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, nodes: [nodeWithBond] }
    });
    openDrawer();
    const ifaceSection = screen.getByText("Interface 1").closest("section");
    expect(ifaceSection).toBeTruthy();
    expect(within(ifaceSection).getByText("Bond Name")).toBeInTheDocument();
    expect(within(ifaceSection).getByText("Bond Mode")).toBeInTheDocument();
    const memberIfaceLabels = within(ifaceSection).getAllByText("Bond Member Interface");
    expect(memberIfaceLabels.length).toBeGreaterThanOrEqual(1);
    const memberMacLabels = within(ifaceSection).getAllByText("Bond Member MAC");
    expect(memberMacLabels.length).toBeGreaterThanOrEqual(1);
    expect(within(ifaceSection).getByDisplayValue("bond1")).toBeInTheDocument();
    expect(within(ifaceSection).getByDisplayValue("52:54:00:c1:c2:c3")).toBeInTheDocument();
    expect(within(ifaceSection).getByDisplayValue("52:54:00:c4:c5:c6")).toBeInTheDocument();
  });

  it("C3: VLAN — HI-045 VLAN ID, HI-046 VLAN name", () => {
    const vlanIface = {
      type: "vlan-on-ethernet",
      mode: "dhcp",
      ipv4Cidr: "", ipv4Gateway: "", ipv6Cidr: "", ipv6Gateway: "",
      ethernet: { name: "eno5", macAddress: "52:54:00:d1:d2:d3" },
      bond: { name: "bond0", mode: "active-backup", slaves: [{ name: "eno0", macAddress: "" }, { name: "eno1", macAddress: "" }] },
      vlan: { id: "300", baseIface: "", name: "eno5.300" },
      advanced: { mtu: "1500", sriov: { enabled: false, totalVfs: "" }, vrf: { enabled: false, name: "vrf0", tableId: "100", ports: "" }, routes: [] }
    };
    const nodeWithVlan = {
      ...baseState.hostInventory.nodes[0],
      additionalInterfaces: [vlanIface]
    };
    renderWithCatalog(SYNTHETIC_CATALOG_AI, {
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, nodes: [nodeWithVlan] }
    });
    openDrawer();
    const ifaceSection = screen.getByText("Interface 1").closest("section");
    expect(ifaceSection).toBeTruthy();
    expect(within(ifaceSection).getByDisplayValue("300")).toBeInTheDocument();
    expect(within(ifaceSection).getByDisplayValue("eno5.300")).toBeInTheDocument();
  });

  it("C4: Static addressing — HI-047 IPv4 CIDR, HI-048 IPv6 CIDR", () => {
    const staticIface = {
      type: "ethernet",
      mode: "static",
      ipv4Cidr: "10.20.30.40/24",
      ipv4Gateway: "",
      ipv6Cidr: "fd02::40/64",
      ipv6Gateway: "",
      ethernet: { name: "eno7", macAddress: "52:54:00:e1:e2:e3" },
      bond: { name: "bond0", mode: "active-backup", slaves: [] },
      vlan: { id: "", baseIface: "", name: "" },
      advanced: { mtu: "1500", sriov: { enabled: false, totalVfs: "" }, vrf: { enabled: false, name: "vrf0", tableId: "100", ports: "" }, routes: [] }
    };
    const nodeWithStatic = {
      ...baseState.hostInventory.nodes[0],
      additionalInterfaces: [staticIface]
    };
    renderWithCatalog(SYNTHETIC_CATALOG_AI, {
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, ipStackMode: "dual-stack", nodes: [nodeWithStatic] }
    });
    openDrawer();
    const ifaceSection = screen.getByText("Interface 1").closest("section");
    expect(ifaceSection).toBeTruthy();
    expect(within(ifaceSection).getByDisplayValue("10.20.30.40/24")).toBeInTheDocument();
    expect(within(ifaceSection).getByDisplayValue("fd02::40/64")).toBeInTheDocument();
  });

  it("C5: Advanced — HI-049 MTU, HI-050 SR-IOV, HI-051 Total VFs, HI-052 VRF, HI-053 VRF Name, HI-054 VRF Table ID, HI-055 VRF Ports", () => {
    const advIface = {
      type: "ethernet",
      mode: "dhcp",
      ipv4Cidr: "", ipv4Gateway: "", ipv6Cidr: "", ipv6Gateway: "",
      ethernet: { name: "eno8", macAddress: "52:54:00:f1:f2:f3" },
      bond: { name: "bond0", mode: "active-backup", slaves: [] },
      vlan: { id: "", baseIface: "", name: "" },
      advanced: {
        mtu: "9000",
        sriov: { enabled: true, totalVfs: "32" },
        vrf: { enabled: true, name: "vrf-adv", tableId: "500", ports: "eno8,bond0" },
        routes: []
      }
    };
    const nodeWithAdv = {
      ...baseState.hostInventory.nodes[0],
      additionalInterfaces: [advIface]
    };
    renderWithCatalog(SYNTHETIC_CATALOG_AI, {
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, nodes: [nodeWithAdv] }
    });
    openDrawer();
    const ifaceSection = screen.getByText("Interface 1").closest("section");
    expect(ifaceSection).toBeTruthy();
    fireEvent.click(within(ifaceSection).getByLabelText("Expand Advanced Networking"));
    expect(within(ifaceSection).getByDisplayValue("9000")).toBeInTheDocument();
    const sriovCheckboxes = within(ifaceSection).getAllByRole("checkbox");
    const sriovCheckbox = sriovCheckboxes.find(cb => cb.closest("label")?.textContent?.includes("SR-IOV"));
    expect(sriovCheckbox).toBeTruthy();
    expect(sriovCheckbox.checked).toBe(true);
    expect(within(ifaceSection).getByDisplayValue("32")).toBeInTheDocument();
    const vrfCheckbox = sriovCheckboxes.find(cb => cb.closest("label")?.textContent?.includes("VRF"));
    expect(vrfCheckbox).toBeTruthy();
    expect(vrfCheckbox.checked).toBe(true);
    expect(within(ifaceSection).getByDisplayValue("vrf-adv")).toBeInTheDocument();
    expect(within(ifaceSection).getByDisplayValue("500")).toBeInTheDocument();
    expect(within(ifaceSection).getByDisplayValue("eno8,bond0")).toBeInTheDocument();
  });

  // --- D. Hidden workflow containment ---

  it("D: pre-seeded full interface hidden — no Additional controls render, Primary remains", () => {
    const catalog = SYNTHETIC_CATALOG_AI.map(e => {
      if (e.path === "hosts[].networkConfig.interfaces") return { ...e, supportStatus: "supported-backend-only" };
      return e;
    });
    renderWithCatalog(catalog, {
      version: { selectedMinor: "4.20" },
      hostInventory: { ...baseState.hostInventory, nodes: [nodeWithFullAdditional] }
    });
    openDrawer();
    expect(screen.queryByText("Add Interface")).not.toBeInTheDocument();
    expect(screen.queryByText("Interface 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Ethernet Interface Name")).not.toBeInTheDocument();
    expect(screen.queryByText("Ethernet MAC Address")).not.toBeInTheDocument();
    expect(screen.queryByText("Bond Name")).not.toBeInTheDocument();
    expect(screen.queryByText("Bond Mode")).not.toBeInTheDocument();
    expect(screen.queryByText("Bond Member Interface")).not.toBeInTheDocument();
    expect(screen.queryByText("Bond Member MAC")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("777")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("eno99.777")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("10.10.10.5/24")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("fd01::5/64")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("9216")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("16")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("vrf-test")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("200")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("eno99,bond7")).not.toBeInTheDocument();
    expect(screen.queryByText("Advanced Networking")).not.toBeInTheDocument();
    expect(screen.queryByText("Remove")).not.toBeInTheDocument();
    expect(screen.getByText("Primary Network")).toBeInTheDocument();
  });

  // --- E. State preservation across visibility change ---

  it("E: values preserved across hide/show cycle, no update callback triggered by hiding", () => {
    const catalog = SYNTHETIC_CATALOG_AI.map(e =>
      e.path === "hosts[].networkConfig.interfaces" ? { ...e, minVersion: "4.21" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const updateState = vi.fn();
    const initialState = {
      ...baseState,
      version: { selectedMinor: "4.21" },
      hostInventory: {
        ...baseState.hostInventory,
        ipStackMode: "dual-stack",
        nodes: [nodeWithFullAdditional]
      }
    };
    let setCurrentFn;
    function CapturingProvider({ children }) {
      const [current, setCurrent] = React.useState(initialState);
      setCurrentFn = setCurrent;
      const value = {
        state: current,
        updateState: updateState,
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
    expect(screen.getByText("Interface 1")).toBeInTheDocument();
    const ifaceSection = screen.getByText("Interface 1").closest("section");
    expect(within(ifaceSection).getByDisplayValue("eno99")).toBeInTheDocument();
    expect(within(ifaceSection).getByDisplayValue("52:54:00:ff:ee:dd")).toBeInTheDocument();
    expect(within(ifaceSection).getByDisplayValue("10.10.10.5/24")).toBeInTheDocument();
    expect(within(ifaceSection).getByDisplayValue("fd01::5/64")).toBeInTheDocument();
    fireEvent.click(within(ifaceSection).getByLabelText("Expand Advanced Networking"));
    expect(within(ifaceSection).getByDisplayValue("9216")).toBeInTheDocument();
    expect(within(ifaceSection).getByDisplayValue("16")).toBeInTheDocument();
    expect(within(ifaceSection).getByDisplayValue("vrf-test")).toBeInTheDocument();
    expect(within(ifaceSection).getByDisplayValue("200")).toBeInTheDocument();
    expect(within(ifaceSection).getByDisplayValue("eno99,bond7")).toBeInTheDocument();

    updateState.mockClear();
    act(() => {
      setCurrentFn(prev => ({ ...prev, version: { selectedMinor: "4.20" } }));
    });
    expect(screen.queryByText("Interface 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Add Interface")).not.toBeInTheDocument();
    expect(updateState).not.toHaveBeenCalled();

    act(() => {
      setCurrentFn(prev => ({ ...prev, version: { selectedMinor: "4.21" } }));
    });
    expect(screen.getByText("Interface 1")).toBeInTheDocument();
    const restored = screen.getByText("Interface 1").closest("section");
    expect(restored).toBeTruthy();

    const typeLabel = within(restored).getByText("Type");
    const typeSelect = typeLabel.closest("label").querySelector("select");
    expect(typeSelect.value).toBe("ethernet");

    expect(within(restored).getByDisplayValue("eno99")).toBeInTheDocument();
    expect(within(restored).getByDisplayValue("10.10.10.5/24")).toBeInTheDocument();
    expect(within(restored).getByDisplayValue("fd01::5/64")).toBeInTheDocument();
    const advBtn = within(restored).queryByLabelText("Expand Advanced Networking") || within(restored).queryByLabelText("Collapse Advanced Networking");
    if (advBtn && advBtn.getAttribute("aria-expanded") !== "true") fireEvent.click(advBtn);
    expect(within(restored).getByDisplayValue("9216")).toBeInTheDocument();
    expect(within(restored).getByDisplayValue("16")).toBeInTheDocument();
    expect(within(restored).getByDisplayValue("vrf-test")).toBeInTheDocument();
    expect(within(restored).getByDisplayValue("200")).toBeInTheDocument();
    expect(within(restored).getByDisplayValue("eno99,bond7")).toBeInTheDocument();
  });

  // --- F. Real catalogs ---

  it.each([
    ["bare-metal-agent", "Bare Metal", "4.20"],
    ["bare-metal-agent", "Bare Metal", "4.21"],
    ["vsphere-agent", "VMware vSphere", "4.20"],
    ["vsphere-agent", "VMware vSphere", "4.21"],
  ])("F: real catalog %s %s: Additional Interfaces heading, Add Interface, and baseline controls render", async (scenarioLabel, platform, version) => {
    const stateOverride = {
      blueprint: { platform },
      methodology: { method: "Agent-Based Installer" },
      version: { selectedMinor: version },
    };
    function StatefulProvider({ children }) {
      const [current, setCurrent] = React.useState({ ...baseState, ...stateOverride });
      const value = {
        state: current,
        updateState: (patch) => setCurrent(prev => ({ ...prev, ...patch })),
        loading: false,
        startOver: vi.fn()
      };
      return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
    }
    render(
      <StatefulProvider>
        <HostInventoryV2Step />
      </StatefulProvider>
    );
    openDrawer();
    expect(screen.getByText("Add Interface")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText("Add Interface"));
    });
    const ifaceSection = screen.getByText("Interface 1").closest("section");
    expect(ifaceSection).toBeTruthy();
    const typeLabel = within(ifaceSection).getByText("Type");
    const typeSelect = typeLabel.closest("label").querySelector("select");
    expect(typeSelect).toBeTruthy();
    expect(typeSelect.value).toBe("ethernet");
    expect(within(ifaceSection).getByText("IP Assignment")).toBeInTheDocument();
  });

  // --- G. Unsupported version regression: 4.22 test runs unchanged ---
  // (The existing deterministic 4.22 test in the Primary Networking block serves this purpose.)

  // --- Regression boundaries ---

  it("scope containment: Role, Hostname, DNS, Root Device Hints, Primary Network not newly gated", () => {
    renderWithCatalog(SYNTHETIC_CATALOG_AI, { version: { selectedMinor: "4.20" } });
    openDrawer();
    const roleLabel = screen.getByText(/^Role/);
    expect(roleLabel.parentElement?.querySelector("select")).toBeTruthy();
    expect(screen.getByPlaceholderText(HOSTNAME_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByText("DNS Configuration")).toBeInTheDocument();
    expect(screen.getByText("Root Device Hints")).toBeInTheDocument();
    expect(screen.getByText("Primary Network")).toBeInTheDocument();
    expect(screen.getByText("Add Interface")).toBeInTheDocument();
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

describe("HB-004 replication modal presentation boundary", () => {
  const AC = "agent-config.yaml";
  const IC = "install-config.yaml";

  const FULL_CATALOG = [
    { path: "bootArtifactsBaseURL", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, type: "string", required: false },
    { path: "hosts[].role", outputFile: AC, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null, type: "string", allowed: ["master", "worker"], required: false },
    { path: "hosts[].hostname", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, type: "string", required: false },
    { path: "hosts[].networkConfig.dns-resolver", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].rootDeviceHints", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].networkConfig", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "hosts[].networkConfig.interfaces", outputFile: AC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "platform.baremetal.hosts[].bmc", outputFile: IC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "platform.baremetal.hosts[].bootMACAddress", outputFile: IC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
  ];

  const twoNodeState = (overrides = {}) => ({
    ...baseState,
    blueprint: { platform: "Bare Metal" },
    methodology: { method: "Agent-Based Installer" },
    hostInventory: {
      ...baseState.hostInventory,
      nodes: [
        { role: "master", hostname: "master-0", rootDevice: "", dnsServers: "", dnsSearch: "", bmc: { address: "", username: "", password: "", bootMACAddress: "" }, primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: "52:54:00:aa:11:01" }, bond: {}, vlan: {}, advanced: {} } },
        { role: "worker", hostname: "worker-0", rootDevice: "", dnsServers: "", dnsSearch: "", bmc: { address: "", username: "", password: "", bootMACAddress: "" }, primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: "52:54:00:aa:11:02" }, bond: {}, vlan: {}, advanced: {} } },
      ],
      includeBareMetalDay2InInstallConfig: true,
    },
    ...overrides,
  });

  function openReplicateModal(container) {
    const masterTile = Array.from(container.querySelectorAll("button.host-inventory-v2-tile")).find(
      (b) => b.textContent?.includes("master-0")
    );
    fireEvent.click(masterTile);
    const applyBtn = screen.getByRole("button", { name: /Apply settings to other nodes/i });
    fireEvent.click(applyBtn);
    const dialogs = screen.getAllByRole("dialog");
    const modal = dialogs.find((d) => d.getAttribute("aria-modal") === "true");
    return modal;
  }

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("visible hostname option is rendered as a checkbox", () => {
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(FULL_CATALOG);
    vi.spyOn(catalogPathsModule, "getCatalogForScenario").mockReturnValue(FULL_CATALOG);
    vi.spyOn(catalogPathsModule, "getCatalogPaths").mockReturnValue(new Set(FULL_CATALOG.map((e) => e.path)));
    const { container } = render(<MockAppProvider stateOverride={twoNodeState()}><HostInventoryV2Step /></MockAppProvider>);
    const modal = openReplicateModal(container);
    const hostnameCheckbox = within(modal).getByLabelText(/Hostname \(usually leave unchecked\)/i);
    expect(hostnameCheckbox).toBeInTheDocument();
    expect(hostnameCheckbox.type).toBe("checkbox");
  });

  it("hidden DNS options are absent when showAgentDns is false", () => {
    const catalog = FULL_CATALOG.filter((e) => e.path !== "hosts[].networkConfig.dns-resolver");
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    vi.spyOn(catalogPathsModule, "getCatalogForScenario").mockReturnValue(catalog);
    vi.spyOn(catalogPathsModule, "getCatalogPaths").mockReturnValue(new Set(catalog.map((e) => e.path)));
    const { container } = render(<MockAppProvider stateOverride={twoNodeState()}><HostInventoryV2Step /></MockAppProvider>);
    const modal = openReplicateModal(container);
    expect(within(modal).queryByLabelText(/DNS servers/i)).not.toBeInTheDocument();
    expect(within(modal).queryByLabelText(/DNS search domains/i)).not.toBeInTheDocument();
    expect(within(modal).getByLabelText(/Hostname \(usually leave unchecked\)/i)).toBeInTheDocument();
  });

  it("hidden Primary Networking options are absent when showAgentPrimaryNetwork is false", () => {
    const catalog = FULL_CATALOG.filter((e) => e.path !== "hosts[].networkConfig");
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    vi.spyOn(catalogPathsModule, "getCatalogForScenario").mockReturnValue(catalog);
    vi.spyOn(catalogPathsModule, "getCatalogPaths").mockReturnValue(new Set(catalog.map((e) => e.path)));
    const { container } = render(<MockAppProvider stateOverride={twoNodeState()}><HostInventoryV2Step /></MockAppProvider>);
    const modal = openReplicateModal(container);
    expect(within(modal).queryByLabelText(/Primary interface type/i)).not.toBeInTheDocument();
    expect(within(modal).queryByLabelText(/IP assignment/i)).not.toBeInTheDocument();
    expect(within(modal).queryByLabelText(/IPv4 CIDR/i)).not.toBeInTheDocument();
    expect(within(modal).queryByLabelText(/VLAN settings/i)).not.toBeInTheDocument();
    expect(within(modal).queryByLabelText(/Bond mode/i)).not.toBeInTheDocument();
    expect(within(modal).queryByLabelText(/MTU, routes/i)).not.toBeInTheDocument();
    expect(within(modal).getByLabelText(/Hostname \(usually leave unchecked\)/i)).toBeInTheDocument();
    expect(within(modal).getByLabelText(/DNS servers/i)).toBeInTheDocument();
  });

  it("BMC visible with Boot MAC hidden renders BMC but not Boot MAC", () => {
    const catalog = FULL_CATALOG.filter((e) => e.path !== "platform.baremetal.hosts[].bootMACAddress");
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    vi.spyOn(catalogPathsModule, "getCatalogForScenario").mockReturnValue(catalog);
    vi.spyOn(catalogPathsModule, "getCatalogPaths").mockReturnValue(new Set(catalog.map((e) => e.path)));
    const { container } = render(<MockAppProvider stateOverride={twoNodeState()}><HostInventoryV2Step /></MockAppProvider>);
    const modal = openReplicateModal(container);
    expect(within(modal).getByLabelText(/BMC credentials/i)).toBeInTheDocument();
    expect(within(modal).queryByLabelText(/Boot MAC address/i)).not.toBeInTheDocument();
  });

  it("Boot MAC visible with BMC hidden renders Boot MAC but not BMC", () => {
    const catalog = FULL_CATALOG.filter((e) => e.path !== "platform.baremetal.hosts[].bmc");
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    vi.spyOn(catalogPathsModule, "getCatalogForScenario").mockReturnValue(catalog);
    vi.spyOn(catalogPathsModule, "getCatalogPaths").mockReturnValue(new Set(catalog.map((e) => e.path)));
    const { container } = render(<MockAppProvider stateOverride={twoNodeState()}><HostInventoryV2Step /></MockAppProvider>);
    const modal = openReplicateModal(container);
    expect(within(modal).getByLabelText(/Boot MAC address/i)).toBeInTheDocument();
    expect(within(modal).queryByLabelText(/BMC credentials/i)).not.toBeInTheDocument();
  });

  it("unavailable options are absent (not disabled)", () => {
    const catalog = FULL_CATALOG.filter((e) =>
      e.path !== "hosts[].networkConfig.dns-resolver" && e.path !== "hosts[].rootDeviceHints"
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    vi.spyOn(catalogPathsModule, "getCatalogForScenario").mockReturnValue(catalog);
    vi.spyOn(catalogPathsModule, "getCatalogPaths").mockReturnValue(new Set(catalog.map((e) => e.path)));
    const { container } = render(<MockAppProvider stateOverride={twoNodeState()}><HostInventoryV2Step /></MockAppProvider>);
    const modal = openReplicateModal(container);
    expect(within(modal).queryByLabelText(/DNS servers/i)).toBeNull();
    expect(within(modal).queryByLabelText(/Root device hints/i)).toBeNull();
    const checkboxes = modal.querySelectorAll('[id^="replicate-field-"]');
    checkboxes.forEach((cb) => {
      if (cb.id === "replicate-field-dnsServers" || cb.id === "replicate-field-rootDevice") {
        throw new Error(`Found disabled checkbox for ${cb.id} — should be absent`);
      }
    });
  });

  it("same-mount rerender with visibility restored makes checkbox reappear", () => {
    const catalogWithoutDns = FULL_CATALOG.filter((e) => e.path !== "hosts[].networkConfig.dns-resolver");
    const catalogSpy = vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalogWithoutDns);
    const catalogPathsSpy = vi.spyOn(catalogPathsModule, "getCatalogForScenario").mockReturnValue(catalogWithoutDns);
    const pathsSpy = vi.spyOn(catalogPathsModule, "getCatalogPaths").mockReturnValue(new Set(catalogWithoutDns.map((e) => e.path)));

    const initState = twoNodeState();
    function RerendererWrapper({ children }) {
      const [current, setCurrent] = React.useState(initState);
      const ref = React.useRef(setCurrent);
      ref.current = setCurrent;
      React.useEffect(() => { window.__testSetState = ref.current; return () => { delete window.__testSetState; }; }, []);
      const value = { state: current, updateState: () => {}, loading: false, startOver: vi.fn() };
      return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
    }
    const { container } = render(<RerendererWrapper><HostInventoryV2Step /></RerendererWrapper>);
    const modal1 = openReplicateModal(container);
    expect(within(modal1).queryByLabelText(/DNS servers/i)).not.toBeInTheDocument();

    catalogSpy.mockReturnValue(FULL_CATALOG);
    catalogPathsSpy.mockReturnValue(FULL_CATALOG);
    pathsSpy.mockReturnValue(new Set(FULL_CATALOG.map((e) => e.path)));
    act(() => {
      window.__testSetState((prev) => ({ ...prev, version: { selectedMinor: "4.21" } }));
    });
    const dialogs2 = screen.getAllByRole("dialog");
    const modal2 = dialogs2.find((d) => d.getAttribute("aria-modal") === "true");
    expect(within(modal2).getByLabelText(/DNS servers/i)).toBeInTheDocument();
  });

  it("visibility change within same mount does not call updateInventory", () => {
    const updateInventoryCalls = [];
    const catalogWithoutDns = FULL_CATALOG.filter((e) => e.path !== "hosts[].networkConfig.dns-resolver");
    const catalogSpy = vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalogWithoutDns);
    const catalogPathsSpy = vi.spyOn(catalogPathsModule, "getCatalogForScenario").mockReturnValue(catalogWithoutDns);
    const pathsSpy = vi.spyOn(catalogPathsModule, "getCatalogPaths").mockReturnValue(new Set(catalogWithoutDns.map((e) => e.path)));

    const initState = twoNodeState();
    function TrackingWrapper({ children }) {
      const [current, setCurrent] = React.useState(initState);
      const ref = React.useRef(setCurrent);
      ref.current = setCurrent;
      React.useEffect(() => { window.__testSetState2 = ref.current; return () => { delete window.__testSetState2; }; }, []);
      const value = {
        state: current,
        updateState: (patch) => { updateInventoryCalls.push(patch); },
        loading: false,
        startOver: vi.fn(),
      };
      return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
    }
    render(<TrackingWrapper><HostInventoryV2Step /></TrackingWrapper>);
    expect(updateInventoryCalls.length).toBe(0);

    catalogSpy.mockReturnValue(FULL_CATALOG);
    catalogPathsSpy.mockReturnValue(FULL_CATALOG);
    pathsSpy.mockReturnValue(new Set(FULL_CATALOG.map((e) => e.path)));
    act(() => {
      window.__testSetState2((prev) => ({ ...prev, version: { selectedMinor: "4.21" } }));
    });
    expect(updateInventoryCalls.length).toBe(0);
  });

  it("ethernet + DHCP source: modal shows ethernet MAC but not bond/vlan/ipv4Cidr", () => {
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(FULL_CATALOG);
    vi.spyOn(catalogPathsModule, "getCatalogForScenario").mockReturnValue(FULL_CATALOG);
    vi.spyOn(catalogPathsModule, "getCatalogPaths").mockReturnValue(new Set(FULL_CATALOG.map((e) => e.path)));
    const state = twoNodeState();
    state.hostInventory.nodes[0].primary = { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: "" }, bond: {}, vlan: {}, advanced: {} };
    const { container } = render(<MockAppProvider stateOverride={state}><HostInventoryV2Step /></MockAppProvider>);
    const modal = openReplicateModal(container);
    expect(within(modal).getByLabelText(/Primary interface type/i)).toBeInTheDocument();
    expect(within(modal).getByLabelText(/IP assignment/i)).toBeInTheDocument();
    expect(within(modal).getByLabelText(/Primary ethernet MAC/i)).toBeInTheDocument();
    expect(within(modal).queryByLabelText(/Bond mode/i)).not.toBeInTheDocument();
    expect(within(modal).queryByLabelText(/Bond member MACs/i)).not.toBeInTheDocument();
    expect(within(modal).queryByLabelText(/VLAN settings/i)).not.toBeInTheDocument();
    expect(within(modal).queryByLabelText(/IPv4 CIDR/i)).not.toBeInTheDocument();
    expect(within(modal).queryByLabelText(/IPv6 CIDR/i)).not.toBeInTheDocument();
  });

  it("bond + DHCP source: modal shows bond fields but not ethernet MAC/vlan/ipv4Cidr", () => {
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(FULL_CATALOG);
    vi.spyOn(catalogPathsModule, "getCatalogForScenario").mockReturnValue(FULL_CATALOG);
    vi.spyOn(catalogPathsModule, "getCatalogPaths").mockReturnValue(new Set(FULL_CATALOG.map((e) => e.path)));
    const state = twoNodeState();
    state.hostInventory.nodes[0].primary = { type: "bond", mode: "dhcp", ethernet: { name: "eth0", macAddress: "" }, bond: { name: "bond0", mode: "active-backup", slaves: [] }, vlan: {}, advanced: {} };
    const { container } = render(<MockAppProvider stateOverride={state}><HostInventoryV2Step /></MockAppProvider>);
    const modal = openReplicateModal(container);
    expect(within(modal).getByLabelText(/Primary interface type/i)).toBeInTheDocument();
    expect(within(modal).getByLabelText(/Bond mode/i)).toBeInTheDocument();
    expect(within(modal).getByLabelText(/Bond member MACs/i)).toBeInTheDocument();
    expect(within(modal).queryByLabelText(/Primary ethernet MAC/i)).not.toBeInTheDocument();
    expect(within(modal).queryByLabelText(/VLAN settings/i)).not.toBeInTheDocument();
    expect(within(modal).queryByLabelText(/IPv4 CIDR/i)).not.toBeInTheDocument();
  });

  it("vlan-on-ethernet + static + IPv4: modal shows ethernet MAC + vlan + ipv4; no bond/ipv6", () => {
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(FULL_CATALOG);
    vi.spyOn(catalogPathsModule, "getCatalogForScenario").mockReturnValue(FULL_CATALOG);
    vi.spyOn(catalogPathsModule, "getCatalogPaths").mockReturnValue(new Set(FULL_CATALOG.map((e) => e.path)));
    const state = twoNodeState();
    state.hostInventory.nodes[0].primary = { type: "vlan-on-ethernet", mode: "static", ethernet: { name: "eth0", macAddress: "" }, bond: {}, vlan: { id: "100" }, advanced: {} };
    state.hostInventory.ipStackMode = "ipv4";
    const { container } = render(<MockAppProvider stateOverride={state}><HostInventoryV2Step /></MockAppProvider>);
    const modal = openReplicateModal(container);
    expect(within(modal).getByLabelText(/Primary ethernet MAC/i)).toBeInTheDocument();
    expect(within(modal).getByLabelText(/VLAN settings/i)).toBeInTheDocument();
    expect(within(modal).getByLabelText(/IPv4 CIDR/i)).toBeInTheDocument();
    expect(within(modal).getByLabelText(/IPv4 gateway/i)).toBeInTheDocument();
    expect(within(modal).queryByLabelText(/Bond mode/i)).not.toBeInTheDocument();
    expect(within(modal).queryByLabelText(/IPv6 CIDR/i)).not.toBeInTheDocument();
    expect(within(modal).queryByLabelText(/IPv6 gateway/i)).not.toBeInTheDocument();
  });

  it("vlan-on-bond + static + dual-stack: modal shows bond + vlan + ipv4 + ipv6; no ethernet MAC", () => {
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(FULL_CATALOG);
    vi.spyOn(catalogPathsModule, "getCatalogForScenario").mockReturnValue(FULL_CATALOG);
    vi.spyOn(catalogPathsModule, "getCatalogPaths").mockReturnValue(new Set(FULL_CATALOG.map((e) => e.path)));
    const state = twoNodeState();
    state.hostInventory.nodes[0].primary = { type: "vlan-on-bond", mode: "static", ethernet: {}, bond: { name: "bond0", mode: "active-backup", slaves: [] }, vlan: { id: "200" }, advanced: {} };
    state.hostInventory.ipStackMode = "dual-stack";
    const { container } = render(<MockAppProvider stateOverride={state}><HostInventoryV2Step /></MockAppProvider>);
    const modal = openReplicateModal(container);
    expect(within(modal).getByLabelText(/Bond mode/i)).toBeInTheDocument();
    expect(within(modal).getByLabelText(/Bond member MACs/i)).toBeInTheDocument();
    expect(within(modal).getByLabelText(/VLAN settings/i)).toBeInTheDocument();
    expect(within(modal).getByLabelText(/IPv4 CIDR/i)).toBeInTheDocument();
    expect(within(modal).getByLabelText(/IPv4 gateway/i)).toBeInTheDocument();
    expect(within(modal).getByLabelText(/IPv6 CIDR/i)).toBeInTheDocument();
    expect(within(modal).getByLabelText(/IPv6 gateway/i)).toBeInTheDocument();
    expect(within(modal).queryByLabelText(/Primary ethernet MAC/i)).not.toBeInTheDocument();
  });
});

describe("Agent topology validateStep — 4 and 5 control plane (DOC-102 Slice 5J)", () => {
  const minNode = (role, i) => ({
    role,
    hostname: `${role}-${i}`,
    rootDevice: "",
    dnsServers: "",
    dnsSearch: "",
    bmc: { address: "", username: "", password: "", bootMACAddress: "" },
    primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: `52:54:00:aa:${String(i).padStart(2, "0")}:01` }, bond: {}, vlan: {}, advanced: {} }
  });

  const agentState = (nodes) => ({
    ...baseState,
    blueprint: { platform: "Bare Metal" },
    methodology: { method: "Agent-Based Installer" },
    hostInventory: {
      ...baseState.hostInventory,
      nodes
    }
  });

  const ipiState = (nodes) => ({
    ...baseState,
    blueprint: { platform: "Bare Metal" },
    methodology: { method: "IPI" },
    hostInventory: {
      ...baseState.hostInventory,
      nodes
    }
  });

  it("4 control-plane nodes pass the topology gate", () => {
    const nodes = Array.from({ length: 4 }, (_, i) => minNode("master", i));
    const result = validateStep(agentState(nodes), "inventory-v2");
    const topoErrors = result.errors.filter((e) => /control plane|topology|SNO|arbiter/i.test(e));
    expect(topoErrors).toEqual([]);
  });

  it("5 control-plane nodes pass the topology gate", () => {
    const nodes = Array.from({ length: 5 }, (_, i) => minNode("master", i));
    const result = validateStep(agentState(nodes), "inventory-v2");
    const topoErrors = result.errors.filter((e) => /control plane|topology|SNO|arbiter/i.test(e));
    expect(topoErrors).toEqual([]);
  });

  it("4 control-plane nodes plus an arbiter fail", () => {
    const nodes = [
      ...Array.from({ length: 4 }, (_, i) => minNode("master", i)),
      minNode("arbiter", 0)
    ];
    const result = validateStep(agentState(nodes), "inventory-v2");
    expect(result.errors.some((e) => /4 control plane nodes must not include arbiter/i.test(e))).toBe(true);
  });

  it("5 control-plane nodes plus an arbiter fail", () => {
    const nodes = [
      ...Array.from({ length: 5 }, (_, i) => minNode("master", i)),
      minNode("arbiter", 0)
    ];
    const result = validateStep(agentState(nodes), "inventory-v2");
    expect(result.errors.some((e) => /5 control plane nodes must not include arbiter/i.test(e))).toBe(true);
  });

  it("6 control-plane nodes fail with updated supported-topologies message", () => {
    const nodes = Array.from({ length: 6 }, (_, i) => minNode("master", i));
    const result = validateStep(agentState(nodes), "inventory-v2");
    expect(result.errors.some((e) => /3, 4, or 5/.test(e))).toBe(true);
  });

  it("SNO remains valid with zero workers and zero arbiters", () => {
    const nodes = [minNode("master", 0)];
    const result = validateStep(agentState(nodes), "inventory-v2");
    const topoErrors = result.errors.filter((e) => /control plane|topology|SNO|arbiter|worker/i.test(e));
    expect(topoErrors).toEqual([]);
  });

  it("2 control-plane remains valid with exactly one arbiter", () => {
    const nodes = [minNode("master", 0), minNode("master", 1), minNode("arbiter", 0)];
    const result = validateStep(agentState(nodes), "inventory-v2");
    const topoErrors = result.errors.filter((e) => /control plane|topology|SNO|arbiter/i.test(e));
    expect(topoErrors).toEqual([]);
  });

  it("3 control-plane remains valid without an arbiter", () => {
    const nodes = Array.from({ length: 3 }, (_, i) => minNode("master", i));
    const result = validateStep(agentState(nodes), "inventory-v2");
    const topoErrors = result.errors.filter((e) => /control plane|topology|SNO|arbiter/i.test(e));
    expect(topoErrors).toEqual([]);
  });

  it("Bare Metal IPI remains restricted to exactly 3 control-plane nodes", () => {
    const nodes4 = Array.from({ length: 4 }, (_, i) => minNode("master", i));
    const result4 = validateStep(ipiState(nodes4), "inventory-v2");
    expect(result4.errors.some((e) => /only 3 control plane/i.test(e))).toBe(true);

    const nodes3 = Array.from({ length: 3 }, (_, i) => minNode("master", i));
    const result3 = validateStep(ipiState(nodes3), "inventory-v2");
    const ipiTopoErrors = result3.errors.filter((e) => /control plane/i.test(e));
    expect(ipiTopoErrors).toEqual([]);
  });
});
