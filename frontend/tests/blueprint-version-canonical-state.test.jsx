import React, { useState, useCallback } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, act } from "@testing-library/react";
import BlueprintStep from "../src/steps/BlueprintStep.jsx";
import { AppContext } from "../src/store.jsx";
import { apiFetch } from "../src/api.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

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

function renderWithProductionMerge(initialState) {
  let latestState = initialState;
  const stateSnapshots = [];

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
        stateSnapshots.push(next);
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
  return { ...result, getState: () => latestState, snapshots: stateSnapshots };
}

function baseState(overrides = {}) {
  return {
    blueprint: {
      platform: "AWS GovCloud",
      arch: "x86_64",
      clusterName: "test",
      baseDomain: "example.com",
      confirmed: false,
      ...overrides.blueprint,
    },
    release: {
      channel: "4.21",
      patchVersion: "4.21.3",
      confirmed: false,
      ...overrides.release,
    },
    version: {
      selectedMinor: "4.21",
      selectedPatch: "4.21.3",
      selectedChannel: "stable-4.21",
      selectedVersion: "4.21.3",
      locked: false,
      ...overrides.version,
    },
    methodology: { method: "IPI" },
    credentials: {},
    platformConfig: {},
    operators: {},
    ui: { segmentedFlowV1: true, activeStepId: "blueprint", visitedSteps: {}, completedSteps: {} },
  };
}

describe("Blueprint version-selection canonical state", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("channel change from 4.21 to 4.20 atomically updates selectedMinor", async () => {
    mockApis();
    const { getState } = renderWithProductionMerge(baseState());

    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: /stable-4\.20/ }).length).toBeGreaterThan(0);
    });

    const channelSelect = screen.getAllByRole("combobox")[0];
    await act(async () => {
      fireEvent.change(channelSelect, { target: { value: "4.20" } });
    });

    await waitFor(() => {
      const s = getState();
      expect(s.release.channel).toBe("4.20");
    });

    const state = getState();
    expect(state.version.selectedMinor).toBe("4.20");
    expect(state.release.channel).toBe("4.20");
  });

  it("channel change replaces stale selectedPatch with new version's patch", async () => {
    mockApis();
    const { getState } = renderWithProductionMerge(baseState());

    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: /stable-4\.20/ }).length).toBeGreaterThan(0);
    });

    const channelSelect = screen.getAllByRole("combobox")[0];
    await act(async () => {
      fireEvent.change(channelSelect, { target: { value: "4.20" } });
    });

    await waitFor(() => {
      const s = getState();
      expect(s.version.selectedMinor).toBe("4.20");
    });

    await waitFor(() => {
      const s = getState();
      expect(s.version.selectedPatch).toMatch(/^4\.20\./);
    });

    const state = getState();
    expect(state.version.selectedMinor).toBe("4.20");
    expect(state.version.selectedPatch).toBe("4.20.8");
    expect(state.release.channel).toBe("4.20");
    expect(state.release.patchVersion).toBe("4.20.8");
    expect(state.version.selectedPatch).not.toMatch(/^4\.21/);
  });

  it("round-trip 4.21 → 4.20 → 4.21 restores correct canonical fields", async () => {
    mockApis();
    const { getState } = renderWithProductionMerge(baseState());

    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: /stable-4\.20/ }).length).toBeGreaterThan(0);
    });

    const channelSelect = screen.getAllByRole("combobox")[0];

    await act(async () => {
      fireEvent.change(channelSelect, { target: { value: "4.20" } });
    });

    await waitFor(() => {
      expect(getState().version.selectedMinor).toBe("4.20");
    });

    await waitFor(() => {
      expect(getState().version.selectedPatch).not.toBeNull();
    });

    const at420 = getState();
    expect(at420.version.selectedMinor).toBe("4.20");
    expect(at420.release.channel).toBe("4.20");

    await act(async () => {
      fireEvent.change(channelSelect, { target: { value: "4.21" } });
    });

    await waitFor(() => {
      expect(getState().version.selectedMinor).toBe("4.21");
    });

    await waitFor(() => {
      expect(getState().version.selectedPatch).not.toBeNull();
    });

    const at421 = getState();
    expect(at421.version.selectedMinor).toBe("4.21");
    expect(at421.version.selectedPatch).toBe("4.21.8");
    expect(at421.release.channel).toBe("4.21");
    expect(at421.release.patchVersion).toBe("4.21.8");
  });

  it("contradictory state (selectedMinor=4.21, channel=4.20) reconciles on channel change to 4.20", async () => {
    mockApis();
    const { getState } = renderWithProductionMerge(baseState({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.3", selectedChannel: "stable-4.21", selectedVersion: "4.21.3" },
      release: { channel: "4.20", patchVersion: "4.20.8" },
    }));

    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: /stable-4\.20/ }).length).toBeGreaterThan(0);
    });

    const channelSelect = screen.getAllByRole("combobox")[0];
    await act(async () => {
      fireEvent.change(channelSelect, { target: { value: "4.20" } });
    });

    await waitFor(() => {
      expect(getState().version.selectedMinor).toBe("4.20");
    });

    const state = getState();
    expect(state.version.selectedMinor).toBe("4.20");
    expect(state.release.channel).toBe("4.20");
  });

  it("inverse contradiction (selectedMinor=4.20, channel=4.21) reconciles on channel change to 4.21", async () => {
    mockApis();
    const { getState } = renderWithProductionMerge(baseState({
      version: { selectedMinor: "4.20", selectedPatch: "4.20.8", selectedChannel: "stable-4.20", selectedVersion: "4.20.8" },
      release: { channel: "4.21", patchVersion: "4.21.3" },
    }));

    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: /stable-4\.21/ }).length).toBeGreaterThan(0);
    });

    const channelSelect = screen.getAllByRole("combobox")[0];
    await act(async () => {
      fireEvent.change(channelSelect, { target: { value: "4.21" } });
    });

    await waitFor(() => {
      expect(getState().version.selectedMinor).toBe("4.21");
    });

    const state = getState();
    expect(state.version.selectedMinor).toBe("4.21");
    expect(state.release.channel).toBe("4.21");
  });

  it("patch selection updates selectedPatch without losing selectedMinor", async () => {
    mockApis();
    const { getState } = renderWithProductionMerge(baseState());

    await waitFor(() => {
      const s = getState();
      return s.version.selectedPatch !== null;
    });

    await waitFor(() => {
      const patchOptions = screen.getAllByRole("option").filter(o => /4\.21\.\d+/.test(o.textContent));
      expect(patchOptions.length).toBeGreaterThan(0);
    });

    const comboboxes = screen.getAllByRole("combobox");
    const patchSelect = comboboxes[1];

    await act(async () => {
      fireEvent.change(patchSelect, { target: { value: "4.21.3" } });
    });

    await waitFor(() => {
      expect(getState().version.selectedPatch).toBe("4.21.3");
    });

    const state = getState();
    expect(state.version.selectedMinor).toBe("4.21");
    expect(state.version.selectedPatch).toBe("4.21.3");
    expect(state.release.patchVersion).toBe("4.21.3");
  });
});
