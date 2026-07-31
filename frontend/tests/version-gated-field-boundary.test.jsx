import React, { useState, useCallback } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, act } from "@testing-library/react";
import BlueprintStep from "../src/steps/BlueprintStep.jsx";
import PlatformSpecificsStep from "../src/steps/PlatformSpecificsStep.jsx";
import { AppContext } from "../src/store.jsx";
import { apiFetch } from "../src/api.js";
import { validateStep } from "../src/validation.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

const SUPPORTED_UI_421_REGISTRY = [
  {
    scenario: "aws-govcloud-ipi",
    path: "controlPlane.platform.aws.rootVolume.throughput",
    platform: "AWS GovCloud",
    method: "IPI",
    controlQuery: /Root volume throughput/,
    owningStep: "PlatformSpecificsStep",
  },
  {
    scenario: "azure-government-ipi",
    path: "platform.azure.allowSharedKeyAccess",
    platform: "Azure Government",
    method: "IPI",
    controlQuery: /Azure Storage shared-key/,
    owningStep: "PlatformSpecificsStep",
  },
  {
    scenario: "azure-government-upi",
    path: "platform.azure.allowSharedKeyAccess",
    platform: "Azure Government",
    method: "UPI",
    controlQuery: /Azure Storage shared-key/,
    owningStep: "PlatformSpecificsStep",
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
  return wrapper.querySelector("select, input");
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

describe("Version-gated field boundary — supported-ui 4.21 registry", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  for (const entry of SUPPORTED_UI_421_REGISTRY) {
    it(`${entry.scenario}: visible at 4.21, hidden at 4.20`, () => {
      const state421 = makeState(entry.platform, entry.method, "4.21", "4.21.8");
      renderPlatformStep(state421);
      expect(findControlByQuery(entry.controlQuery)).not.toBeNull();
      cleanup();

      const state420 = makeState(entry.platform, entry.method, "4.20", "4.20.8");
      renderPlatformStep(state420);
      expect(findControlByQuery(entry.controlQuery)).toBeNull();
    });

    it(`${entry.scenario}: hidden for non-applicable platform`, () => {
      const otherPlatform = entry.platform === "AWS GovCloud" ? "Azure Government" : "AWS GovCloud";
      const otherMethod = otherPlatform === "AWS GovCloud" ? "IPI" : entry.method;
      const state = makeState(otherPlatform, otherMethod, "4.21", "4.21.8");
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
});
