import React, { useState, useCallback } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, act } from "@testing-library/react";
import BlueprintStep from "../src/steps/BlueprintStep.jsx";
import PlatformSpecificsStep from "../src/steps/PlatformSpecificsStep.jsx";
import { AppContext } from "../src/store.jsx";
import { apiFetch } from "../src/api.js";
import { validateStep } from "../src/validation.js";
import { getCatalogForScenario, getAvailableCatalogScenarios } from "../src/catalogPaths.js";
import { SUPPORTED_MINORS } from "../src/shared/versionPolicy.js";
import { compareVersions } from "../../shared/versionUtils.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

const VERSION_GATED_UI_FIELD_REGISTRY = [
  {
    scenario: "aws-govcloud-ipi",
    path: "controlPlane.platform.aws.rootVolume.throughput",
    platform: "AWS GovCloud",
    method: "IPI",
    introductionMinor: "4.21",
    controlQuery: /Root volume throughput/,
    owningStep: "PlatformSpecificsStep",
    supportContentQuery: /125.*2000.*gp3/,
  },
  {
    scenario: "aws-govcloud-ipi",
    path: "controlPlane.platform.aws.cpuOptions.confidentialCompute",
    platform: "AWS GovCloud",
    method: "IPI",
    introductionMinor: "4.21",
    controlQuery: /Confidential compute/,
    owningStep: "PlatformSpecificsStep",
  },
  {
    scenario: "azure-government-ipi",
    path: "platform.azure.allowSharedKeyAccess",
    platform: "Azure Government",
    method: "IPI",
    introductionMinor: "4.21",
    controlQuery: /Azure Storage shared-key/,
    owningStep: "PlatformSpecificsStep",
  },
  {
    scenario: "azure-government-upi",
    path: "platform.azure.allowSharedKeyAccess",
    platform: "Azure Government",
    method: "UPI",
    introductionMinor: "4.21",
    controlQuery: /Azure Storage shared-key/,
    owningStep: "PlatformSpecificsStep",
  },
  {
    scenario: "bare-metal-ipi",
    path: "platform.baremetal.bmcVerifyCA",
    platform: "Bare Metal",
    method: "IPI",
    introductionMinor: "4.21",
    controlQuery: /BMC verify CA/,
    owningStep: "PlatformSpecificsStep",
  },
  {
    scenario: "bare-metal-agent",
    path: "platform.baremetal.bmcVerifyCA",
    platform: "Bare Metal",
    method: "Agent-Based Installer",
    introductionMinor: "4.21",
    controlQuery: /BMC verify CA/,
    owningStep: "PlatformSpecificsStep",
  },
  {
    scenario: "azure-government-ipi",
    path: "platform.azure.subnets.name",
    platform: "Azure Government",
    method: "IPI",
    introductionMinor: "4.21",
    controlQuery: /Control plane subnet/,
    owningStep: "PlatformSpecificsStep",
    compositeOf: "platform.azure.vnetMode",
  },
  {
    scenario: "azure-government-upi",
    path: "platform.azure.subnets.name",
    platform: "Azure Government",
    method: "UPI",
    introductionMinor: "4.21",
    controlQuery: /Control plane subnet/,
    owningStep: "PlatformSpecificsStep",
    compositeOf: "platform.azure.vnetMode",
  },
];

function mockApis() {
  vi.mocked(apiFetch).mockImplementation((path, opts) => {
    if (path === "/api/cincinnati/channels")
      return Promise.resolve({ channels: ["4.20", "4.21"] });
    if (path === "/api/cincinnati/update" && opts?.method === "POST")
      return Promise.resolve({ channels: ["4.20", "4.21"] });
    if (String(path).startsWith("/api/cincinnati/patches?")) {
      const m = path.match(/channel=([^&]+)/);
      const ch = m ? decodeURIComponent(m[1]) : "4.20";
      return Promise.resolve({ versions: [`${ch}.8`, `${ch}.3`] });
    }
    if (path === "/api/secrets/rh-pull-secret")
      return Promise.resolve({ available: false });
    return Promise.resolve({});
  });
}

function makeState(platform, method, minor, patch) {
  return {
    blueprint: {
      platform,
      arch: "x86_64",
      clusterName: "test",
      baseDomain: "example.com",
      confirmed: false,
    },
    release: { channel: minor, patchVersion: patch, confirmed: true },
    version: {
      versionConfirmed: true,
      selectedMinor: minor,
      selectedPatch: patch,
      selectedChannel: `stable-${minor}`,
      selectedVersion: patch,
      locked: false,
    },
    methodology: { method },
    credentials: {
      pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
      sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test",
    },
    platformConfig: {
      aws: { region: "us-gov-west-1" },
      azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg" },
    },
    hostInventory: {
      nodes: [
        { role: "master", hostname: "m0", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:01" } },
        { role: "master", hostname: "m1", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:02" } },
        { role: "master", hostname: "m2", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:03" } },
      ],
      apiVip: "10.90.0.2",
      ingressVip: "10.90.0.3",
      machineNetworkCidr: "10.90.0.0/24",
      ipStackMode: "ipv4",
    },
    operators: {},
    ui: {
      segmentedFlowV1: true,
      activeStepId: "platform-specifics",
      visitedSteps: { "platform-specifics": true },
      completedSteps: {},
    },
  };
}

function renderPlatformStep(state) {
  const updateState = vi.fn();
  const value = { state, updateState, loading: false, startOver: vi.fn(), setState: vi.fn() };
  return render(
    <AppContext.Provider value={value}>
      <PlatformSpecificsStep />
    </AppContext.Provider>
  );
}

function findControlByQuery(query) {
  const label = screen.queryByText(query);
  if (!label) return null;
  const wrapper = label.closest(".field-with-info-row") || label.closest(".field-control-stack");
  if (!wrapper) return null;
  return wrapper.querySelector("select, input, textarea");
}

function renderBlueprintWithProductionMerge(initialState) {
  let latestState = initialState;
  const Wrapper = () => {
    const [state, setState] = useState(initialState);
    const updateState = useCallback((patch) => {
      setState((prev) => {
        const next = {
          ...prev,
          ...patch,
          version: patch.version
            ? { ...prev.version, ...patch.version }
            : prev.version,
        };
        latestState = next;
        return next;
      });
    }, []);
    return (
      <AppContext.Provider value={{ state, updateState, loading: false, startOver: vi.fn(), setState }}>
        <BlueprintStep />
      </AppContext.Provider>
    );
  };
  const result = render(<Wrapper />);
  return { ...result, getState: () => latestState };
}

describe("Version-gated field boundary — registry visibility", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  for (const entry of VERSION_GATED_UI_FIELD_REGISTRY) {
    if (entry.compositeOf) continue;
    it(`${entry.scenario}: visible at ${entry.introductionMinor}, hidden at previous minor`, () => {
      const introState = makeState(entry.platform, entry.method, entry.introductionMinor, `${entry.introductionMinor}.8`);
      renderPlatformStep(introState);
      expect(findControlByQuery(entry.controlQuery)).not.toBeNull();
      cleanup();

      const sorted = [...SUPPORTED_MINORS].sort((a, b) => compareVersions(a, b));
      const introIdx = sorted.indexOf(entry.introductionMinor);
      const prevMinor = introIdx > 0 ? sorted[introIdx - 1] : null;
      if (prevMinor) {
        const prevState = makeState(entry.platform, entry.method, prevMinor, `${prevMinor}.8`);
        renderPlatformStep(prevState);
        expect(findControlByQuery(entry.controlQuery)).toBeNull();
      }
    });

    it(`${entry.scenario}: hidden for non-applicable platform`, () => {
      const otherPlatform = entry.platform === "AWS GovCloud" ? "Azure Government" : "AWS GovCloud";
      const otherMethod = otherPlatform === "AWS GovCloud" ? "IPI" : entry.method;
      const state = makeState(otherPlatform, otherMethod, entry.introductionMinor, `${entry.introductionMinor}.8`);
      renderPlatformStep(state);
      expect(findControlByQuery(entry.controlQuery)).toBeNull();
    });
  }
});

describe("Version-gated field boundary — Blueprint-driven transitions", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("AWS throughput: 4.21 visible → 4.20 hidden → 4.21 visible (through real Blueprint)", async () => {
    mockApis();
    const initial = makeState("AWS GovCloud", "IPI", "4.21", "4.21.8");
    const { getState, unmount } = renderBlueprintWithProductionMerge(initial);

    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: /stable-4\.20/ }).length).toBeGreaterThan(0);
    });

    const channelSelect = screen.getAllByRole("combobox")[0];
    await act(async () => {
      fireEvent.change(channelSelect, { target: { value: "4.20" } });
    });
    await waitFor(() => expect(getState().version.selectedMinor).toBe("4.20"));
    unmount();

    const stateAt420 = getState();
    renderPlatformStep(stateAt420);
    expect(findControlByQuery(/Root volume throughput/)).toBeNull();
    cleanup();

    const { getState: getState2, unmount: unmount2 } = renderBlueprintWithProductionMerge(stateAt420);
    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: /stable-4\.21/ }).length).toBeGreaterThan(0);
    });
    const channelSelect2 = screen.getAllByRole("combobox")[0];
    await act(async () => {
      fireEvent.change(channelSelect2, { target: { value: "4.21" } });
    });
    await waitFor(() => expect(getState2().version.selectedMinor).toBe("4.21"));
    unmount2();

    renderPlatformStep(getState2());
    expect(findControlByQuery(/Root volume throughput/)).not.toBeNull();
  });

  it("Azure shared-key: 4.21 visible → 4.20 hidden → 4.21 visible (through real Blueprint)", async () => {
    mockApis();
    const initial = makeState("Azure Government", "IPI", "4.21", "4.21.8");
    const { getState, unmount } = renderBlueprintWithProductionMerge(initial);

    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: /stable-4\.20/ }).length).toBeGreaterThan(0);
    });

    const channelSelect = screen.getAllByRole("combobox")[0];
    await act(async () => {
      fireEvent.change(channelSelect, { target: { value: "4.20" } });
    });
    await waitFor(() => expect(getState().version.selectedMinor).toBe("4.20"));
    unmount();

    const stateAt420 = getState();
    renderPlatformStep(stateAt420);
    expect(findControlByQuery(/Azure Storage shared-key/)).toBeNull();
    cleanup();

    const { getState: getState2, unmount: unmount2 } = renderBlueprintWithProductionMerge(stateAt420);
    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: /stable-4\.21/ }).length).toBeGreaterThan(0);
    });
    const channelSelect2 = screen.getAllByRole("combobox")[0];
    await act(async () => {
      fireEvent.change(channelSelect2, { target: { value: "4.21" } });
    });
    await waitFor(() => expect(getState2().version.selectedMinor).toBe("4.21"));
    unmount2();

    renderPlatformStep(getState2());
    expect(findControlByQuery(/Azure Storage shared-key/)).not.toBeNull();
  });

  it("Confidential compute: 4.21 visible → 4.20 hidden → 4.21 visible (through real Blueprint)", async () => {
    mockApis();
    const initial = makeState("AWS GovCloud", "IPI", "4.21", "4.21.8");
    initial.platformConfig.aws = { ...initial.platformConfig.aws, cpuOptions: { confidentialCompute: "AMDEncryptedVirtualizationNestedPaging" } };
    const { getState, unmount } = renderBlueprintWithProductionMerge(initial);

    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: /stable-4\.20/ }).length).toBeGreaterThan(0);
    });

    const channelSelect = screen.getAllByRole("combobox")[0];
    await act(async () => {
      fireEvent.change(channelSelect, { target: { value: "4.20" } });
    });
    await waitFor(() => expect(getState().version.selectedMinor).toBe("4.20"));
    expect(getState().platformConfig.aws.cpuOptions.confidentialCompute).toBe("AMDEncryptedVirtualizationNestedPaging");
    unmount();

    const stateAt420 = getState();
    renderPlatformStep(stateAt420);
    expect(findControlByQuery(/Confidential compute/)).toBeNull();
    cleanup();

    const { getState: getState2, unmount: unmount2 } = renderBlueprintWithProductionMerge(stateAt420);
    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: /stable-4\.21/ }).length).toBeGreaterThan(0);
    });
    const channelSelect2 = screen.getAllByRole("combobox")[0];
    await act(async () => {
      fireEvent.change(channelSelect2, { target: { value: "4.21" } });
    });
    await waitFor(() => expect(getState2().version.selectedMinor).toBe("4.21"));
    unmount2();

    renderPlatformStep(getState2());
    expect(findControlByQuery(/Confidential compute/)).not.toBeNull();
    const ccSelect = findControlByQuery(/Confidential compute/);
    expect(ccSelect.value).toBe("AMDEncryptedVirtualizationNestedPaging");
  });

  it("Azure shared-key UPI: 4.21 visible → 4.20 hidden", async () => {
    mockApis();
    const initial = makeState("Azure Government", "UPI", "4.21", "4.21.8");
    const { getState, unmount } = renderBlueprintWithProductionMerge(initial);

    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: /stable-4\.20/ }).length).toBeGreaterThan(0);
    });

    const channelSelect = screen.getAllByRole("combobox")[0];
    await act(async () => {
      fireEvent.change(channelSelect, { target: { value: "4.20" } });
    });
    await waitFor(() => expect(getState().version.selectedMinor).toBe("4.20"));
    unmount();

    renderPlatformStep(getState());
    expect(findControlByQuery(/Azure Storage shared-key/)).toBeNull();
  });
});

describe("Version-gated field boundary — stale-state validation", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("stale allowSharedKeyAccess on 4.20 does not produce validation error", () => {
    const state = makeState("Azure Government", "IPI", "4.20", "4.20.8");
    state.platformConfig.azure.allowSharedKeyAccess = "not-a-boolean";
    const result = validateStep(state, "platform-specifics");
    expect(result.errors).not.toContain("Azure Storage shared-key access must be true, false, or omitted.");
  });

  it("stale allowSharedKeyAccess false on 4.20 does not produce RBAC warning", () => {
    const state = makeState("Azure Government", "IPI", "4.20", "4.20.8");
    state.platformConfig.azure.allowSharedKeyAccess = false;
    const result = validateStep(state, "platform-specifics");
    expect(result.warnings || []).toHaveLength(0);
  });

  it("invalid allowSharedKeyAccess on 4.21 produces validation error", () => {
    const state = makeState("Azure Government", "IPI", "4.21", "4.21.8");
    state.platformConfig.azure.allowSharedKeyAccess = "bad";
    const result = validateStep(state, "platform-specifics");
    expect(result.errors).toContain("Azure Storage shared-key access must be true, false, or omitted.");
  });
});

describe("Version-gated field boundary — DOM layout regression", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("throughput helper is inside field-control-support inside field-control-stack", () => {
    const state = makeState("AWS GovCloud", "IPI", "4.21", "4.21.8");
    const { container } = renderPlatformStep(state);
    const helperEl = container.querySelector(".field-helper");
    expect(helperEl).not.toBeNull();
    expect(helperEl.textContent).toMatch(/125.*2000.*gp3/);
    const support = helperEl.closest(".field-control-support");
    expect(support).not.toBeNull();
    const stack = support.closest(".field-control-stack");
    expect(stack).not.toBeNull();
    const fieldGrid = container.querySelector(".field-grid");
    expect(fieldGrid).not.toBeNull();
    expect(helperEl.parentElement).not.toBe(fieldGrid);
  });

  it("throughput input is inside FieldLabelWithInfo inside field-control-stack", () => {
    const state = makeState("AWS GovCloud", "IPI", "4.21", "4.21.8");
    const { container } = renderPlatformStep(state);
    const throughputLabel = screen.queryByText(/Root volume throughput/);
    expect(throughputLabel).not.toBeNull();
    const fieldWithInfo = throughputLabel.closest(".field-with-info-row");
    expect(fieldWithInfo).not.toBeNull();
    const input = fieldWithInfo.querySelector("input[type='number']");
    expect(input).not.toBeNull();
    const stack = fieldWithInfo.closest(".field-control-stack");
    expect(stack).not.toBeNull();
  });

  it("KMS field is the next independent grid item after throughput stack", () => {
    const state = makeState("AWS GovCloud", "IPI", "4.21", "4.21.8");
    const { container } = renderPlatformStep(state);
    const throughputStack = container.querySelector(".field-control-stack");
    expect(throughputStack).not.toBeNull();
    const kmsLabel = screen.queryByText(/KMS Key ARN/);
    expect(kmsLabel).not.toBeNull();
    const kmsFieldRow = kmsLabel.closest(".field-with-info-row");
    expect(kmsFieldRow).not.toBeNull();
    expect(kmsFieldRow.closest(".field-control-stack")).toBeNull();
  });

  it("Azure RBAC warning is inside field-control-support inside field-control-stack when false selected", () => {
    const state = makeState("Azure Government", "IPI", "4.21", "4.21.8");
    state.platformConfig.azure.allowSharedKeyAccess = false;
    const { container } = renderPlatformStep(state);
    const warning = screen.queryByText(/Storage Blob Data Contributor/i);
    expect(warning).not.toBeNull();
    const support = warning.closest(".field-control-support");
    expect(support).not.toBeNull();
    const stack = support.closest(".field-control-stack");
    expect(stack).not.toBeNull();
    const fieldGrid = container.querySelector(".field-grid");
    expect(warning.parentElement).not.toBe(fieldGrid);
  });

  it("Azure RBAC warning absent when true selected", () => {
    const state = makeState("Azure Government", "IPI", "4.21", "4.21.8");
    state.platformConfig.azure.allowSharedKeyAccess = true;
    renderPlatformStep(state);
    expect(screen.queryByText(/Storage Blob Data Contributor/i)).toBeNull();
  });

  it("Azure select label is associated with the real select", () => {
    const state = makeState("Azure Government", "IPI", "4.21", "4.21.8");
    const { container } = renderPlatformStep(state);
    const label = screen.queryByText(/Azure Storage shared-key/);
    expect(label).not.toBeNull();
    const stack = label.closest(".field-control-stack");
    expect(stack).not.toBeNull();
    const select = stack.querySelector("select");
    expect(select).not.toBeNull();
    expect(select.options.length).toBe(3);
  });

  it("Azure RBAC warning field-control-support is a direct child of field-control-stack, not field-grid", () => {
    const state = makeState("Azure Government", "IPI", "4.21", "4.21.8");
    state.platformConfig.azure.allowSharedKeyAccess = false;
    const { container } = renderPlatformStep(state);
    const support = container.querySelector(".field-control-support");
    expect(support).not.toBeNull();
    expect(support.parentElement.classList.contains("field-control-stack")).toBe(true);
    expect(support.parentElement.classList.contains("field-grid")).toBe(false);
  });

  it("throughput field-control-support is a direct child of field-control-stack, not field-grid", () => {
    const state = makeState("AWS GovCloud", "IPI", "4.21", "4.21.8");
    const { container } = renderPlatformStep(state);
    const support = container.querySelector(".field-control-support");
    expect(support).not.toBeNull();
    expect(support.parentElement.classList.contains("field-control-stack")).toBe(true);
    expect(support.parentElement.classList.contains("field-grid")).toBe(false);
  });

  it("Azure neighboring fields (Publish, Credentials mode) are independent grid items", () => {
    const state = makeState("Azure Government", "IPI", "4.21", "4.21.8");
    state.platformConfig.azure.allowSharedKeyAccess = false;
    const { container } = renderPlatformStep(state);
    const publishLabel = screen.queryByText(/^Publish/);
    expect(publishLabel).not.toBeNull();
    const publishField = publishLabel.closest(".field-with-info-row");
    expect(publishField).not.toBeNull();
    expect(publishField.closest(".field-control-stack")).toBeNull();
    const credLabel = screen.queryByText(/Credentials mode/);
    expect(credLabel).not.toBeNull();
    const credField = credLabel.closest(".field-with-info-row");
    expect(credField).not.toBeNull();
    expect(credField.closest(".field-control-stack")).toBeNull();
  });

  it("throughput field-with-info-row is inside field-control-stack and has label + input", () => {
    const state = makeState("AWS GovCloud", "IPI", "4.21", "4.21.8");
    const { container } = renderPlatformStep(state);
    const throughputLabel = screen.queryByText(/Root volume throughput/);
    expect(throughputLabel).not.toBeNull();
    const fieldWithInfo = throughputLabel.closest(".field-with-info-row");
    expect(fieldWithInfo).not.toBeNull();
    const stack = fieldWithInfo.closest(".field-control-stack");
    expect(stack).not.toBeNull();
    expect(fieldWithInfo.querySelector("input[type='number']")).not.toBeNull();
    expect(fieldWithInfo.querySelector(".field-title-line")).not.toBeNull();
  });

  it("throughput error and helper coexist inside field-control-support", () => {
    const state = makeState("AWS GovCloud", "IPI", "4.21", "4.21.8");
    const { container } = renderPlatformStep(state);

    const throughputLabel = screen.queryByText(/Root volume throughput/);
    expect(throughputLabel).not.toBeNull();
    const stack = throughputLabel.closest(".field-control-stack");
    expect(stack).not.toBeNull();
    expect(stack.closest(".field-grid")).not.toBeNull();
    const input = stack.querySelector("input[type='number']");
    expect(input).not.toBeNull();

    fireEvent.change(input, { target: { value: "2001" } });
    fireEvent.blur(input);

    const support = stack.querySelector(".field-control-support");
    expect(support).not.toBeNull();

    const error = support.querySelector(".field-error");
    expect(error).not.toBeNull();
    expect(error.textContent).toMatch(/2000/);

    const helper = support.querySelector(".field-helper");
    expect(helper).not.toBeNull();
    expect(helper.textContent).toMatch(/125.*2000.*gp3/);
  });

  it("Azure warning does not appear as a direct child of field-grid", () => {
    const state = makeState("Azure Government", "IPI", "4.21", "4.21.8");
    state.platformConfig.azure.allowSharedKeyAccess = false;
    const { container } = renderPlatformStep(state);
    const fieldGrid = container.querySelector(".field-grid");
    expect(fieldGrid).not.toBeNull();
    const directWarnings = Array.from(fieldGrid.children).filter(
      c => c.classList.contains("note") || c.classList.contains("field-control-support")
    );
    expect(directWarnings).toHaveLength(0);
  });

  it("Machine counts subsection follows the Azure field-grid in DOM order", () => {
    const state = makeState("Azure Government", "IPI", "4.21", "4.21.8");
    state.platformConfig.azure.allowSharedKeyAccess = false;
    const { container } = renderPlatformStep(state);
    const machineCountsHeading = screen.queryByText(/Machine counts/);
    expect(machineCountsHeading).not.toBeNull();
    const sharedKeyStack = screen.queryByText(/Azure Storage shared-key/).closest(".field-control-stack");
    expect(sharedKeyStack).not.toBeNull();
    const sharedKeyGrid = sharedKeyStack.closest(".field-grid");
    expect(sharedKeyGrid).not.toBeNull();
    expect(sharedKeyGrid.contains(sharedKeyStack)).toBe(true);
    expect(sharedKeyGrid.contains(machineCountsHeading)).toBe(false);
  });
});

describe("Version-gated field boundary — composite UI governance proof", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  const compositeEntries = VERSION_GATED_UI_FIELD_REGISTRY.filter(e => e.compositeOf);

  for (const entry of compositeEntries) {
    it(`${entry.scenario}: ${entry.path} visible at ${entry.introductionMinor} when composite parent is active`, () => {
      const state = makeState(entry.platform, entry.method, entry.introductionMinor, `${entry.introductionMinor}.8`);
      state.platformConfig.azure = {
        ...state.platformConfig.azure,
        vnetMode: "existing-vnet",
        virtualNetwork: "test-vnet",
        networkResourceGroupName: "net-rg",
        controlPlaneSubnet: "cp-subnet",
        nodeSubnets: ["worker-subnet"],
      };
      renderPlatformStep(state);
      expect(screen.queryByPlaceholderText("Subnet name for control plane nodes")).not.toBeNull();
      expect(screen.queryByText("Add node subnet")).not.toBeNull();
    });

    it(`${entry.scenario}: ${entry.path} hidden at ${entry.introductionMinor} when composite parent is inactive`, () => {
      const state = makeState(entry.platform, entry.method, entry.introductionMinor, `${entry.introductionMinor}.8`);
      state.platformConfig.azure = {
        ...state.platformConfig.azure,
        vnetMode: "installer-managed",
      };
      renderPlatformStep(state);
      expect(screen.queryByPlaceholderText("Subnet name for control plane nodes")).toBeNull();
      expect(screen.queryByText("Add node subnet")).toBeNull();
    });

    it(`${entry.scenario}: ${entry.path} multi-node capability hidden at previous minor even when composite parent is active`, () => {
      const sorted = [...SUPPORTED_MINORS].sort((a, b) => compareVersions(a, b));
      const introIdx = sorted.indexOf(entry.introductionMinor);
      const prevMinor = introIdx > 0 ? sorted[introIdx - 1] : null;
      if (prevMinor) {
        const state = makeState(entry.platform, entry.method, prevMinor, `${prevMinor}.8`);
        state.platformConfig.azure = {
          ...state.platformConfig.azure,
          vnetMode: "existing-vnet",
          virtualNetwork: "test-vnet",
          networkResourceGroupName: "net-rg",
          controlPlaneSubnet: "cp-subnet",
          nodeSubnets: ["worker-subnet"],
        };
        renderPlatformStep(state);
        expect(screen.queryByPlaceholderText("Subnet name for control plane nodes")).not.toBeNull();
        expect(screen.queryByText("Add node subnet")).toBeNull();
      }
    });
  }
});

describe("Version-gated field boundary — catalog cross-check", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  const sortedMinors = [...SUPPORTED_MINORS].sort((a, b) => compareVersions(a, b));
  const baselineMinor = sortedMinors[0];

  it("every supported-ui catalog entry with minVersion above baseline has a registry entry", () => {
    const unregistered = [];
    for (const minor of SUPPORTED_MINORS) {
      if (compareVersions(minor, baselineMinor) <= 0) continue;
      const scenarios = getAvailableCatalogScenarios(minor);
      for (const scenario of scenarios) {
        let params;
        try { params = getCatalogForScenario(scenario, minor); } catch { continue; }
        for (const entry of params) {
          if (entry.supportStatus !== "supported-ui") continue;
          if (!entry.minVersion || compareVersions(entry.minVersion, baselineMinor) <= 0) continue;
          const registered = VERSION_GATED_UI_FIELD_REGISTRY.some(
            r => r.path === entry.path && r.scenario === scenario
          );
          if (!registered) {
            unregistered.push(`${scenario}: ${entry.path} (minVersion=${entry.minVersion})`);
          }
        }
      }
    }
    expect(unregistered).toEqual([]);
  });

  it("every registry entry has a matching supported-ui catalog parameter", () => {
    const mismatches = [];
    for (const entry of VERSION_GATED_UI_FIELD_REGISTRY) {
      const params = getCatalogForScenario(entry.scenario, entry.introductionMinor);
      const catalogEntry = params.find(
        p => p.path === entry.path && p.supportStatus === "supported-ui"
      );
      if (!catalogEntry) {
        mismatches.push(`${entry.scenario}: ${entry.path} not found as supported-ui in catalog`);
      } else if (catalogEntry.minVersion !== entry.introductionMinor) {
        mismatches.push(
          `${entry.scenario}: ${entry.path} minVersion=${catalogEntry.minVersion} != registry introductionMinor=${entry.introductionMinor}`
        );
      }
    }
    expect(mismatches).toEqual([]);
  });
});
