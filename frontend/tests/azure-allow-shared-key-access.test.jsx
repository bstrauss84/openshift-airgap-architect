import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
      method: "IPI",
      ...overrides.methodology,
    },
    credentials: {
      pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
      sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test",
    },
    version: {
      versionConfirmed: true,
      selectedMinor: "4.21",
      ...overrides.version,
    },
    release: {
      channel: "4.21",
      patchVersion: "4.21.3",
      confirmed: true,
      ...overrides.release,
    },
    platformConfig: {
      azure: {
        region: "usgovvirginia",
        baseDomainResourceGroupName: "dns-rg",
        ...(overrides.azure || {}),
      },
      ...(overrides.platformConfig || {}),
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

function findSharedKeySelect() {
  const label = screen.queryByText(/Azure Storage shared-key/);
  if (!label) return null;
  const wrapper = label.closest(".field-with-info-row");
  if (!wrapper) return null;
  return wrapper.querySelector("select");
}

describe("Azure allowSharedKeyAccess — visibility matrix", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("4.20 Azure Government IPI: hidden", () => {
    const state = makeAzureState({ version: { selectedMinor: "4.20" }, release: { channel: "4.20", patchVersion: "4.20.8" } });
    renderStep(state);
    expect(findSharedKeySelect()).toBeNull();
  });

  it("4.20 Azure Government UPI: hidden", () => {
    const state = makeAzureState({
      version: { selectedMinor: "4.20" },
      release: { channel: "4.20", patchVersion: "4.20.8" },
      methodology: { method: "UPI" },
    });
    renderStep(state);
    expect(findSharedKeySelect()).toBeNull();
  });

  it("4.21 Azure Government IPI: visible", () => {
    const state = makeAzureState();
    renderStep(state);
    expect(findSharedKeySelect()).not.toBeNull();
  });

  it("4.21 Azure Government UPI: visible", () => {
    const state = makeAzureState({ methodology: { method: "UPI" } });
    renderStep(state);
    expect(findSharedKeySelect()).not.toBeNull();
  });

  it("4.21 non-Azure: hidden", () => {
    const state = makeAzureState({ blueprint: { platform: "Bare Metal" } });
    state.methodology = { method: "Agent-Based Installer" };
    state.hostInventory = {
      nodes: [
        { role: "master", hostname: "m0", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:01" } },
        { role: "master", hostname: "m1", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:02" } },
        { role: "master", hostname: "m2", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:03" } },
      ],
      apiVip: "10.90.0.2",
      ingressVip: "10.90.0.3",
      machineNetworkCidr: "10.90.0.0/24",
      ipStackMode: "ipv4",
    };
    renderStep(state);
    expect(findSharedKeySelect()).toBeNull();
  });
});

describe("Azure allowSharedKeyAccess — mounted transitions", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("4.21 → 4.20 → 4.21: control hides and returns; explicit false is retained", () => {
    const state421 = makeAzureState({ azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", allowSharedKeyAccess: false } });
    const { rerender } = renderStep(state421);
    let sel = findSharedKeySelect();
    expect(sel).not.toBeNull();
    expect(sel.value).toBe("false");

    const state420 = makeAzureState({
      version: { selectedMinor: "4.20" },
      release: { channel: "4.20", patchVersion: "4.20.8" },
      azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", allowSharedKeyAccess: false },
    });
    const updateState2 = vi.fn();
    rerender(
      <AppContext.Provider value={{ state: state420, updateState: updateState2, loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <PlatformSpecificsStep />
      </AppContext.Provider>
    );
    expect(findSharedKeySelect()).toBeNull();

    const state421b = makeAzureState({ azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", allowSharedKeyAccess: false } });
    const updateState3 = vi.fn();
    rerender(
      <AppContext.Provider value={{ state: state421b, updateState: updateState3, loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <PlatformSpecificsStep />
      </AppContext.Provider>
    );
    sel = findSharedKeySelect();
    expect(sel).not.toBeNull();
    expect(sel.value).toBe("false");
  });

  it("Azure → non-Azure → Azure: control hides and returns; explicit false is retained", () => {
    const stateAzure = makeAzureState({ azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", allowSharedKeyAccess: false } });
    const { rerender } = renderStep(stateAzure);
    expect(findSharedKeySelect()).not.toBeNull();

    const stateNonAzure = makeAzureState({ blueprint: { platform: "AWS GovCloud" } });
    stateNonAzure.platformConfig = {
      ...stateNonAzure.platformConfig,
      azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", allowSharedKeyAccess: false },
    };
    const updateState2 = vi.fn();
    rerender(
      <AppContext.Provider value={{ state: stateNonAzure, updateState: updateState2, loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <PlatformSpecificsStep />
      </AppContext.Provider>
    );
    expect(findSharedKeySelect()).toBeNull();

    const stateAzure2 = makeAzureState({ azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", allowSharedKeyAccess: false } });
    const updateState3 = vi.fn();
    rerender(
      <AppContext.Provider value={{ state: stateAzure2, updateState: updateState3, loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <PlatformSpecificsStep />
      </AppContext.Provider>
    );
    const sel = findSharedKeySelect();
    expect(sel).not.toBeNull();
    expect(sel.value).toBe("false");
  });

  it("IPI → UPI: control remains applicable; value is retained", () => {
    const stateIpi = makeAzureState({ azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", allowSharedKeyAccess: true } });
    const { rerender } = renderStep(stateIpi);
    let sel = findSharedKeySelect();
    expect(sel).not.toBeNull();
    expect(sel.value).toBe("true");

    const stateUpi = makeAzureState({
      methodology: { method: "UPI" },
      azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", allowSharedKeyAccess: true },
    });
    const updateState2 = vi.fn();
    rerender(
      <AppContext.Provider value={{ state: stateUpi, updateState: updateState2, loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <PlatformSpecificsStep />
      </AppContext.Provider>
    );
    sel = findSharedKeySelect();
    expect(sel).not.toBeNull();
    expect(sel.value).toBe("true");
  });
});

describe("Azure allowSharedKeyAccess — optional semantics", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("untouched/default option: canonical state remains undefined", () => {
    const state = makeAzureState();
    const { updateState } = renderStep(state);
    const sel = findSharedKeySelect();
    expect(sel).not.toBeNull();
    expect(sel.value).toBe("");
    expect(state.platformConfig.azure.allowSharedKeyAccess).toBeUndefined();
  });

  it("Allowed: canonical state becomes true", () => {
    const state = makeAzureState();
    const { updateState } = renderStep(state);
    const sel = findSharedKeySelect();
    fireEvent.change(sel, { target: { value: "true" } });
    expect(updateState).toHaveBeenCalled();
    const call = updateState.mock.calls[0][0];
    const fn = typeof call === "function" ? call(state) : call;
    expect(fn.platformConfig.azure.allowSharedKeyAccess).toBe(true);
  });

  it("Disallowed: canonical state becomes false", () => {
    const state = makeAzureState();
    const { updateState } = renderStep(state);
    const sel = findSharedKeySelect();
    fireEvent.change(sel, { target: { value: "false" } });
    expect(updateState).toHaveBeenCalled();
    const call = updateState.mock.calls[0][0];
    const fn = typeof call === "function" ? call(state) : call;
    expect(fn.platformConfig.azure.allowSharedKeyAccess).toBe(false);
  });

  it("switching back to installer default: canonical state becomes undefined", () => {
    const state = makeAzureState({ azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", allowSharedKeyAccess: true } });
    const { updateState } = renderStep(state);
    const sel = findSharedKeySelect();
    expect(sel.value).toBe("true");
    fireEvent.change(sel, { target: { value: "" } });
    expect(updateState).toHaveBeenCalled();
    const call = updateState.mock.calls[0][0];
    const fn = typeof call === "function" ? call(state) : call;
    expect(fn.platformConfig.azure.allowSharedKeyAccess).toBeUndefined();
  });
});

describe("Azure allowSharedKeyAccess — frontend validation", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("invalid imported values are surfaced by production validation (IPI)", () => {
    const state = makeAzureState({ azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", allowSharedKeyAccess: "true" } });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors).toContain("Azure Storage shared-key access must be true, false, or omitted.");
  });

  it("invalid imported values are surfaced by production validation (UPI)", () => {
    const state = makeAzureState({
      methodology: { method: "UPI" },
      azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", allowSharedKeyAccess: 0 },
    });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors).toContain("Azure Storage shared-key access must be true, false, or omitted.");
  });

  it("valid boolean values pass validation", () => {
    const stateTrue = makeAzureState({ azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", allowSharedKeyAccess: true } });
    expect(validateStep(stateTrue, "platform-specifics").errors).toHaveLength(0);

    const stateFalse = makeAzureState({ azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", allowSharedKeyAccess: false } });
    expect(validateStep(stateFalse, "platform-specifics").errors).toHaveLength(0);

    const stateUndefined = makeAzureState();
    expect(validateStep(stateUndefined, "platform-specifics").errors).toHaveLength(0);
  });
});

describe("Azure allowSharedKeyAccess — RBAC warning", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("false selection displays the Azure RBAC informational warning", () => {
    const state = makeAzureState({ azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", allowSharedKeyAccess: false } });
    renderStep(state);
    expect(screen.getByText(/Storage Blob Data Contributor/i)).toBeInTheDocument();
  });

  it("true selection does not display the RBAC warning", () => {
    const state = makeAzureState({ azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", allowSharedKeyAccess: true } });
    renderStep(state);
    const sel = findSharedKeySelect();
    expect(sel).not.toBeNull();
    expect(screen.queryByText(/Storage Blob Data Contributor/i, { selector: ".note.warning" })).toBeNull();
  });

  it("false selection produces validation warning (not blocking error)", () => {
    const state = makeAzureState({ azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", allowSharedKeyAccess: false } });
    const result = validateStep(state, "platform-specifics");
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/RBAC/i);
  });
});
