import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { AppContext } from "../src/store.jsx";
import PlatformSpecificsStep from "../src/steps/PlatformSpecificsStep.jsx";
import { validateStep } from "../src/validation.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(() => Promise.resolve({})) }));

function makeAzureState(overrides = {}) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    blueprint: {
      ...base.blueprint,
      platform: "Azure Government",
      ...overrides.blueprint,
    },
    methodology: {
      method: overrides.method || "IPI",
    },
    credentials: {
      pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
      sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test",
    },
    version: {
      versionConfirmed: true,
      selectedMinor: overrides.minor || "4.21",
    },
    release: {
      channel: overrides.minor || "4.21",
      patchVersion: overrides.patch || `${overrides.minor || "4.21"}.3`,
      confirmed: true,
    },
    platformConfig: {
      azure: {
        region: "usgovvirginia",
        baseDomainResourceGroupName: "dns-rg",
        ...(overrides.azure || {}),
      },
    },
    ui: {
      ...base.ui,
      segmentedFlowV1: true,
      activeStepId: "platform-specifics",
      visitedSteps: { ...base.ui?.visitedSteps, "platform-specifics": true },
      completedSteps: { ...base.ui?.completedSteps },
    },
  };
}

function renderStep(state) {
  const updateState = vi.fn();
  const value = { state, updateState, loading: false, startOver: vi.fn(), setState: vi.fn() };
  const result = render(
    <AppContext.Provider value={value}>
      <PlatformSpecificsStep />
    </AppContext.Provider>
  );
  return { ...result, updateState };
}

function findVnetModeSelect(container) {
  const selects = container.querySelectorAll("select");
  for (const sel of selects) {
    const opts = Array.from(sel.querySelectorAll("option")).map(o => o.value);
    if (opts.includes("installer-managed") && opts.includes("existing-vnet")) return sel;
  }
  return null;
}

function findInputByPlaceholder(placeholder) {
  return screen.queryByPlaceholderText(placeholder);
}

function findAddNodeSubnetButton() {
  return screen.queryByText("Add node subnet");
}

function findRemoveButtons() {
  return screen.queryAllByLabelText("Remove node subnet");
}

describe("Azure BYO VNet — installer-managed default", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("installer-managed is the default VNet mode", () => {
    const state = makeAzureState();
    const { container } = renderStep(state);
    const sel = findVnetModeSelect(container);
    expect(sel).not.toBeNull();
    expect(sel.value).toBe("installer-managed");
  });

  it("installer-managed mode does not render BYO VNet inputs", () => {
    const state = makeAzureState();
    renderStep(state);
    expect(findInputByPlaceholder("Existing VNet name")).toBeNull();
    expect(findInputByPlaceholder("Resource group containing the VNet")).toBeNull();
    expect(findInputByPlaceholder("Subnet name for control plane nodes")).toBeNull();
  });

  it("installer-managed mode passes validation with no BYO VNet fields", () => {
    const state = makeAzureState();
    const result = validateStep(state, "platform-specifics");
    const byoErrors = result.errors.filter(e => /VNet|subnet|virtual network/i.test(e));
    expect(byoErrors).toHaveLength(0);
  });
});

describe("Azure BYO VNet — existing VNet controls", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("selecting existing-vnet renders all BYO VNet fields", () => {
    const state = makeAzureState({ azure: { vnetMode: "existing-vnet", nodeSubnets: ["worker-subnet"] } });
    renderStep(state);
    expect(findInputByPlaceholder("Existing VNet name")).not.toBeNull();
    expect(findInputByPlaceholder("Resource group containing the VNet")).not.toBeNull();
    expect(findInputByPlaceholder("Subnet name for control plane nodes")).not.toBeNull();
  });

  it("VNet mode select contains installer-managed and existing-vnet options", () => {
    const state = makeAzureState();
    const { container } = renderStep(state);
    const sel = findVnetModeSelect(container);
    expect(sel).not.toBeNull();
    const values = Array.from(sel.querySelectorAll("option")).map(o => o.value);
    expect(values).toContain("installer-managed");
    expect(values).toContain("existing-vnet");
  });

  it("existing-vnet with populated fields shows correct input values", () => {
    const state = makeAzureState({
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker-subnet"],
      },
    });
    renderStep(state);
    expect(findInputByPlaceholder("Existing VNet name").value).toBe("my-vnet");
    expect(findInputByPlaceholder("Resource group containing the VNet").value).toBe("net-rg");
    expect(findInputByPlaceholder("Subnet name for control plane nodes").value).toBe("cp-subnet");
  });

  it("VNet input blur triggers updateState with exact virtualNetwork value", () => {
    const state = makeAzureState({ azure: { vnetMode: "existing-vnet", nodeSubnets: ["w"] } });
    const { updateState } = renderStep(state);
    const input = findInputByPlaceholder("Existing VNet name");
    fireEvent.change(input, { target: { value: "new-vnet" } });
    fireEvent.blur(input);
    expect(updateState).toHaveBeenCalled();
    const patch = updateState.mock.calls[0][0];
    expect(patch.platformConfig.azure.virtualNetwork).toBe("new-vnet");
  });

  it("network RG input blur triggers updateState with exact networkResourceGroupName value", () => {
    const state = makeAzureState({ azure: { vnetMode: "existing-vnet", nodeSubnets: ["w"] } });
    const { updateState } = renderStep(state);
    const input = findInputByPlaceholder("Resource group containing the VNet");
    fireEvent.change(input, { target: { value: "new-rg" } });
    fireEvent.blur(input);
    expect(updateState).toHaveBeenCalled();
    const patch = updateState.mock.calls[0][0];
    expect(patch.platformConfig.azure.networkResourceGroupName).toBe("new-rg");
  });

  it("control plane subnet input blur triggers updateState with exact controlPlaneSubnet value", () => {
    const state = makeAzureState({ azure: { vnetMode: "existing-vnet", nodeSubnets: ["w"] } });
    const { updateState } = renderStep(state);
    const input = findInputByPlaceholder("Subnet name for control plane nodes");
    fireEvent.change(input, { target: { value: "new-cp" } });
    fireEvent.blur(input);
    expect(updateState).toHaveBeenCalled();
    const patch = updateState.mock.calls[0][0];
    expect(patch.platformConfig.azure.controlPlaneSubnet).toBe("new-cp");
  });
});

describe("Azure BYO VNet — first-row regression", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("first node subnet input renders even when nodeSubnets is empty", () => {
    const state = makeAzureState({ azure: { vnetMode: "existing-vnet", nodeSubnets: [] } });
    renderStep(state);
    const nodeInput = screen.queryByPlaceholderText(/Node subnet name/);
    expect(nodeInput).not.toBeNull();
  });

  it("first node subnet input renders when nodeSubnets is undefined", () => {
    const state = makeAzureState({ azure: { vnetMode: "existing-vnet" } });
    renderStep(state);
    const nodeInput = screen.queryByPlaceholderText(/Node subnet name/);
    expect(nodeInput).not.toBeNull();
  });

  it("typing into first node subnet when array is empty triggers updateState", () => {
    const state = makeAzureState({ azure: { vnetMode: "existing-vnet", nodeSubnets: [] } });
    const { updateState } = renderStep(state);
    const nodeInput = screen.queryByPlaceholderText(/Node subnet name/);
    fireEvent.change(nodeInput, { target: { value: "worker-1" } });
    fireEvent.blur(nodeInput);
    expect(updateState).toHaveBeenCalled();
  });
});

describe("Azure BYO VNet — 4.20 single node subnet", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("4.20 does not show Add node subnet button", () => {
    const state = makeAzureState({
      minor: "4.20",
      patch: "4.20.8",
      azure: { vnetMode: "existing-vnet", nodeSubnets: ["worker-subnet"] },
    });
    renderStep(state);
    expect(findAddNodeSubnetButton()).toBeNull();
  });

  it("4.20 single node subnet input uses singular placeholder", () => {
    const state = makeAzureState({
      minor: "4.20",
      patch: "4.20.8",
      azure: { vnetMode: "existing-vnet", nodeSubnets: ["worker-subnet"] },
    });
    renderStep(state);
    expect(screen.queryByPlaceholderText("Node subnet name")).not.toBeNull();
    expect(screen.queryByPlaceholderText("Node subnet name 1")).toBeNull();
  });

  it("4.20 with multiple nodeSubnets shows compatibility warning", () => {
    const state = makeAzureState({
      minor: "4.20",
      patch: "4.20.8",
      azure: { vnetMode: "existing-vnet", nodeSubnets: ["worker-a", "worker-b"] },
    });
    renderStep(state);
    expect(screen.queryByText(/supports only one node subnet/)).not.toBeNull();
  });

  it("4.20 with multiple nodeSubnets fails validation", () => {
    const state = makeAzureState({
      minor: "4.20",
      patch: "4.20.8",
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker-a", "worker-b"],
      },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors.some(e => /supports only one node subnet/i.test(e))).toBe(true);
  });
});

describe("Azure BYO VNet — 4.21 multi-node subnet", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("4.21 shows Add node subnet button", () => {
    const state = makeAzureState({
      azure: { vnetMode: "existing-vnet", nodeSubnets: ["worker-subnet"] },
    });
    renderStep(state);
    expect(findAddNodeSubnetButton()).not.toBeNull();
  });

  it("4.21 uses numbered node subnet placeholder", () => {
    const state = makeAzureState({
      azure: { vnetMode: "existing-vnet", nodeSubnets: ["worker-subnet"] },
    });
    renderStep(state);
    expect(screen.queryByPlaceholderText("Node subnet name 1")).not.toBeNull();
  });

  it("4.21 with multiple nodeSubnets does not show compatibility warning", () => {
    const state = makeAzureState({
      azure: { vnetMode: "existing-vnet", nodeSubnets: ["worker-a", "worker-b"] },
    });
    renderStep(state);
    expect(screen.queryByText(/supports only one node subnet/)).toBeNull();
  });

  it("4.21 with multiple nodeSubnets passes validation", () => {
    const state = makeAzureState({
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker-a", "worker-b"],
      },
    });
    const result = validateStep(state, "platform-specifics");
    const byoErrors = result.errors.filter(e => /supports only one node subnet/i.test(e));
    expect(byoErrors).toHaveLength(0);
  });
});

describe("Azure BYO VNet — Add and Remove actions", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("4.21 Add node subnet click triggers updateState with second entry", () => {
    const state = makeAzureState({
      azure: { vnetMode: "existing-vnet", nodeSubnets: ["worker-a"] },
    });
    const { updateState } = renderStep(state);
    const addBtn = findAddNodeSubnetButton();
    expect(addBtn).not.toBeNull();
    fireEvent.click(addBtn);
    expect(updateState).toHaveBeenCalled();
    const call = updateState.mock.calls[0][0];
    const patch = typeof call === "function" ? call(state) : call;
    expect(patch.platformConfig.azure.nodeSubnets).toEqual(["worker-a", ""]);
  });

  it("Remove click triggers updateState removing that entry", () => {
    const state = makeAzureState({
      azure: { vnetMode: "existing-vnet", nodeSubnets: ["worker-a", "worker-b"] },
    });
    const { updateState } = renderStep(state);
    const removeButtons = findRemoveButtons();
    expect(removeButtons.length).toBeGreaterThan(0);
    fireEvent.click(removeButtons[0]);
    expect(updateState).toHaveBeenCalled();
    const call = updateState.mock.calls[0][0];
    const patch = typeof call === "function" ? call(state) : call;
    expect(patch.platformConfig.azure.nodeSubnets).toEqual(["worker-b"]);
  });

  it("4.20 with two nodes: Remove available, Add absent", () => {
    const state = makeAzureState({
      minor: "4.20",
      patch: "4.20.8",
      azure: { vnetMode: "existing-vnet", nodeSubnets: ["worker-a", "worker-b"] },
    });
    renderStep(state);
    expect(findAddNodeSubnetButton()).toBeNull();
    expect(findRemoveButtons().length).toBeGreaterThan(0);
  });

  it("4.20 explicit removal to one node clears validation error", () => {
    const state420Multi = makeAzureState({
      minor: "4.20",
      patch: "4.20.8",
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker-a", "worker-b"],
      },
    });
    const result = validateStep(state420Multi, "platform-specifics");
    expect(result.errors.some(e => /supports only one node subnet/i.test(e))).toBe(true);

    const state420Single = makeAzureState({
      minor: "4.20",
      patch: "4.20.8",
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker-a"],
      },
    });
    const result2 = validateStep(state420Single, "platform-specifics");
    expect(result2.errors).toHaveLength(0);
  });
});

describe("Azure BYO VNet — 4.21 -> 4.20 -> 4.21 round-trip", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("node list survives 4.21 -> 4.20 -> 4.21 unchanged and in order", () => {
    const originalNodes = ["worker-a", "worker-b", "worker-c"];

    const state421 = makeAzureState({
      azure: { vnetMode: "existing-vnet", nodeSubnets: originalNodes },
    });
    const { rerender } = renderStep(state421);
    expect(screen.queryAllByPlaceholderText(/Node subnet name/).length).toBe(3);

    const state420 = makeAzureState({
      minor: "4.20",
      patch: "4.20.8",
      azure: { vnetMode: "existing-vnet", nodeSubnets: originalNodes },
    });
    const updateState2 = vi.fn();
    rerender(
      <AppContext.Provider value={{ state: state420, updateState: updateState2, loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <PlatformSpecificsStep />
      </AppContext.Provider>
    );
    expect(screen.queryAllByPlaceholderText(/Node subnet name/).length).toBe(3);

    const state421b = makeAzureState({
      azure: { vnetMode: "existing-vnet", nodeSubnets: originalNodes },
    });
    const updateState3 = vi.fn();
    rerender(
      <AppContext.Provider value={{ state: state421b, updateState: updateState3, loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <PlatformSpecificsStep />
      </AppContext.Provider>
    );
    const inputs = screen.queryAllByPlaceholderText(/Node subnet name/);
    expect(inputs.length).toBe(3);
    expect(inputs[0].value).toBe("worker-a");
    expect(inputs[1].value).toBe("worker-b");
    expect(inputs[2].value).toBe("worker-c");
  });
});

describe("Azure BYO VNet — downgrade preservation", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("4.21→4.20 rerender preserves nodeSubnets in state, shows warning", () => {
    const state421 = makeAzureState({
      azure: { vnetMode: "existing-vnet", nodeSubnets: ["worker-a", "worker-b", "worker-c"] },
    });
    const { rerender } = renderStep(state421);
    expect(screen.queryByText(/supports only one node subnet/)).toBeNull();
    expect(findAddNodeSubnetButton()).not.toBeNull();

    const state420 = makeAzureState({
      minor: "4.20",
      patch: "4.20.8",
      azure: { vnetMode: "existing-vnet", nodeSubnets: ["worker-a", "worker-b", "worker-c"] },
    });
    const updateState2 = vi.fn();
    rerender(
      <AppContext.Provider value={{ state: state420, updateState: updateState2, loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <PlatformSpecificsStep />
      </AppContext.Provider>
    );
    expect(screen.queryByText(/supports only one node subnet/)).not.toBeNull();
    expect(findAddNodeSubnetButton()).toBeNull();

    const nodeInputs = screen.queryAllByPlaceholderText(/Node subnet name/);
    expect(nodeInputs.length).toBe(3);
  });
});

describe("Azure BYO VNet — explicit removal", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("Remove button appears only when more than one node subnet exists", () => {
    const stateSingle = makeAzureState({
      azure: { vnetMode: "existing-vnet", nodeSubnets: ["worker-subnet"] },
    });
    renderStep(stateSingle);
    expect(findRemoveButtons()).toHaveLength(0);
    cleanup();

    const stateMulti = makeAzureState({
      azure: { vnetMode: "existing-vnet", nodeSubnets: ["worker-a", "worker-b"] },
    });
    renderStep(stateMulti);
    expect(findRemoveButtons().length).toBeGreaterThan(0);
  });
});

describe("Azure BYO VNet — round-trip validation", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("complete BYO VNet state passes validation for 4.21 IPI", () => {
    const state = makeAzureState({
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker-subnet"],
      },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors).toHaveLength(0);
  });

  it("complete BYO VNet state passes validation for 4.20 IPI", () => {
    const state = makeAzureState({
      minor: "4.20",
      patch: "4.20.8",
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker-subnet"],
      },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors).toHaveLength(0);
  });
});

describe("Azure BYO VNet — blank entry validation", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("blank node subnet triggers validation error", () => {
    const state = makeAzureState({
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: [""],
      },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors.some(e => /blank/i.test(e))).toBe(true);
  });

  it("missing virtualNetwork triggers validation error", () => {
    const state = makeAzureState({
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker-subnet"],
      },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors.some(e => /virtual network/i.test(e))).toBe(true);
  });

  it("missing controlPlaneSubnet triggers validation error", () => {
    const state = makeAzureState({
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "",
        nodeSubnets: ["worker-subnet"],
      },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors.some(e => /control plane subnet/i.test(e))).toBe(true);
  });

  it("empty nodeSubnets array triggers validation error", () => {
    const state = makeAzureState({
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: [],
      },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors.some(e => /at least one node subnet/i.test(e))).toBe(true);
  });
});

describe("Azure BYO VNet — duplicate subnet names", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("duplicate control plane + node subnet name triggers validation error", () => {
    const state = makeAzureState({
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "shared-subnet",
        nodeSubnets: ["shared-subnet"],
      },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors.some(e => /duplicate subnet name/i.test(e))).toBe(true);
  });

  it("duplicate node + node subnet name triggers validation error", () => {
    const state = makeAzureState({
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker-a", "worker-a"],
      },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors.some(e => /duplicate subnet name/i.test(e))).toBe(true);
  });
});

describe("Azure BYO VNet — malformed nodeSubnets type rejection", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("nodeSubnets as string: validation rejects", () => {
    const state = makeAzureState({
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: "worker-a",
      },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors.some(e => /array/i.test(e))).toBe(true);
  });

  it("nodeSubnets as object: validation rejects", () => {
    const state = makeAzureState({
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: {},
      },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors.some(e => /array/i.test(e))).toBe(true);
  });

  it("nodeSubnets as null: validation rejects (no node subnets)", () => {
    const state = makeAzureState({
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: null,
      },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors.some(e => /at least one node subnet/i.test(e))).toBe(true);
  });
});

describe("Azure BYO VNet — installer-managed suppression", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("switching to installer-managed hides BYO VNet fields", () => {
    const stateExisting = makeAzureState({
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker-subnet"],
      },
    });
    const { rerender } = renderStep(stateExisting);
    expect(findInputByPlaceholder("Existing VNet name")).not.toBeNull();

    const stateManaged = makeAzureState({ azure: { vnetMode: "installer-managed" } });
    const updateState2 = vi.fn();
    rerender(
      <AppContext.Provider value={{ state: stateManaged, updateState: updateState2, loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <PlatformSpecificsStep />
      </AppContext.Provider>
    );
    expect(findInputByPlaceholder("Existing VNet name")).toBeNull();
  });

  it("installer-managed mode ignores leftover BYO fields in validation", () => {
    const state = makeAzureState({
      azure: {
        vnetMode: "installer-managed",
        virtualNetwork: "leftover-vnet",
        controlPlaneSubnet: "leftover-cp",
        nodeSubnets: ["leftover-worker"],
      },
    });
    const result = validateStep(state, "platform-specifics");
    const byoErrors = result.errors.filter(e => /VNet|subnet|virtual network/i.test(e));
    expect(byoErrors).toHaveLength(0);
  });
});

describe("Azure BYO VNet — UPI parity", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("UPI 4.21 existing-vnet renders all BYO VNet fields", () => {
    const state = makeAzureState({
      method: "UPI",
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker-subnet"],
      },
    });
    renderStep(state);
    expect(findInputByPlaceholder("Existing VNet name")).not.toBeNull();
    expect(findInputByPlaceholder("Resource group containing the VNet")).not.toBeNull();
    expect(findInputByPlaceholder("Subnet name for control plane nodes")).not.toBeNull();
  });

  it("UPI 4.21 existing-vnet passes validation", () => {
    const state = makeAzureState({
      method: "UPI",
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker-subnet"],
      },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors).toHaveLength(0);
  });

  it("UPI 4.21 shows Add node subnet button", () => {
    const state = makeAzureState({
      method: "UPI",
      azure: { vnetMode: "existing-vnet", nodeSubnets: ["worker-subnet"] },
    });
    renderStep(state);
    expect(findAddNodeSubnetButton()).not.toBeNull();
  });
});

describe("Azure BYO VNet — preview generation guard", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("incomplete existing-vnet state blocks preview (validateStep has errors)", () => {
    const state = makeAzureState({
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
      },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("complete existing-vnet state allows preview (validateStep passes)", () => {
    const state = makeAzureState({
      azure: {
        vnetMode: "existing-vnet",
        virtualNetwork: "my-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker-subnet"],
      },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors).toHaveLength(0);
  });

  it("installer-managed state allows preview (no BYO VNet validation)", () => {
    const state = makeAzureState({
      azure: { vnetMode: "installer-managed" },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors).toHaveLength(0);
  });
});

// ===================================================================
// App-level preview effect regression test
// ===================================================================
// Exercises the PRODUCTION preview useEffect in App.jsx (lines 655-768)
// to prove validateStep(state, "platform-specifics") guard behavior.

vi.mock("../src/api.js", async () => {
  return { apiFetch: vi.fn(() => Promise.resolve({})) };
});

const { apiFetch } = await import("../src/api.js");
const { default: App } = await import("../src/App.jsx");

function makeAppMock(stateOverride) {
  let currentState = stateOverride;
  vi.mocked(apiFetch).mockImplementation((path, options) => {
    if (path === "/api/state") {
      if (options?.method === "POST") {
        currentState = JSON.parse(options.body);
        return Promise.resolve(currentState);
      }
      return Promise.resolve(currentState);
    }
    if (path === "/api/schema/stepMap") return Promise.resolve({});
    if (path === "/api/build-info") return Promise.resolve({
      gitSha: "test", buildTime: "2026-01-01T00:00:00Z", repo: "test/repo", branch: "develop"
    });
    if (path === "/api/update-info") return Promise.resolve({ enabled: false });
    if (path === "/api/feedback/config") return Promise.resolve({ mode: "disabled" });
    if (path === "/api/generate") {
      return Promise.resolve({ files: { "install-config.yaml": "apiVersion: v1\nmetadata:\n  name: test\n" } });
    }
    return Promise.resolve({});
  });
}

function makeLockedAzureAppState(azureOverrides) {
  return {
    blueprint: {
      arch: "x86_64", platform: "Azure Government",
      clusterName: "test-cluster", baseDomain: "example.com", confirmed: true,
    },
    release: { channel: "4.21", patchVersion: "4.21.3", confirmed: true },
    version: { versionConfirmed: true, selectedMinor: "4.21" },
    methodology: { method: "IPI" },
    globalStrategy: { networking: {}, mirroring: { registryFqdn: "registry.local:5000", sources: [] } },
    platformConfig: {
      azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", ...azureOverrides },
    },
    hostInventory: { nodes: [], schemaVersion: 2 },
    operators: { selected: [] },
    credentials: { pullSecretPlaceholder: '{"auths":{"quay.io":{}}}', sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test" },
    trust: {},
    ui: { segmentedFlowV1: true, showLanding: false, activeStepId: "platform-specifics",
          visitedSteps: { blueprint: true }, completedSteps: { blueprint: true } },
  };
}

describe("Azure BYO VNet — App-level preview effect", () => {
  beforeEach(() => { localStorage.clear(); vi.mocked(apiFetch).mockReset(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("incomplete Azure BYO VNet state blocks /api/generate call", async () => {
    const incompleteState = makeLockedAzureAppState({
      vnetMode: "existing-vnet",
      virtualNetwork: "my-vnet",
    });
    makeAppMock(incompleteState);
    render(<App />);
    await waitFor(() => { expect(apiFetch).toHaveBeenCalledWith("/api/state", expect.anything()); });
    await new Promise(r => setTimeout(r, 500));
    const generateCalls = vi.mocked(apiFetch).mock.calls.filter(c => c[0] === "/api/generate");
    expect(generateCalls).toHaveLength(0);
  });

  it("complete Azure BYO VNet state permits /api/generate call", async () => {
    const completeState = makeLockedAzureAppState({
      vnetMode: "existing-vnet",
      virtualNetwork: "my-vnet",
      networkResourceGroupName: "net-rg",
      controlPlaneSubnet: "cp-subnet",
      nodeSubnets: ["worker-subnet"],
    });
    makeAppMock(completeState);
    render(<App />);
    await waitFor(() => {
      const genCalls = vi.mocked(apiFetch).mock.calls.filter(c => c[0] === "/api/generate");
      expect(genCalls.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });
  });

  it("non-Azure valid state permits /api/generate call (guard is transparent)", async () => {
    const bareMetalState = {
      blueprint: {
        arch: "x86_64", platform: "Bare Metal",
        clusterName: "test-cluster", baseDomain: "example.com", confirmed: true,
      },
      release: { channel: "4.20", patchVersion: "4.20.0", confirmed: true },
      version: { versionConfirmed: true, selectedMinor: "4.20" },
      methodology: { method: "Agent-Based Installer" },
      globalStrategy: { networking: {}, mirroring: { registryFqdn: "registry.local:5000", sources: [] } },
      platformConfig: {},
      hostInventory: { nodes: [], schemaVersion: 2 },
      operators: { selected: [] },
      credentials: { pullSecretPlaceholder: '{"auths":{"quay.io":{}}}', sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test" },
      trust: {},
      ui: { segmentedFlowV1: true, showLanding: false, activeStepId: "platform-specifics",
            visitedSteps: { blueprint: true }, completedSteps: { blueprint: true } },
    };
    makeAppMock(bareMetalState);
    render(<App />);
    await waitFor(() => {
      const genCalls = vi.mocked(apiFetch).mock.calls.filter(c => c[0] === "/api/generate");
      expect(genCalls.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });
  });
});
