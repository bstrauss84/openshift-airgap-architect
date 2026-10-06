/**
 * Focused tests for AMI auto-population behavior:
 * - region selection triggers automatic AMI lookup
 * - region change updates auto-derived AMI
 * - manual AMI override is preserved
 * - explicit Refresh replaces installer-derived value
 * - no infinite lookup loops
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import { AppContext } from "../src/store.jsx";
import PlatformSpecificsStep from "../src/steps/PlatformSpecificsStep.jsx";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

function makeAwsState(minor, platformOverrides = {}) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    blueprint: { ...base.blueprint, platform: "AWS GovCloud", confirmed: true },
    methodology: { method: "IPI" },
    version: { ...base.version, _schemaVersion: 3, selectedMinor: minor, selectedPatch: `${minor}.8`, locked: true },
    release: { channel: minor, patchVersion: `${minor}.8`, confirmed: true },
    credentials: {
      pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
      sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test"
    },
    platformConfig: { aws: {}, ...platformOverrides },
    ui: {
      ...base.ui,
      segmentedFlowV1: true,
      activeStepId: "platform-specifics",
      visitedSteps: { blueprint: true, methodology: true, "platform-specifics": true },
      completedSteps: { blueprint: true, methodology: true }
    }
  };
}

function renderWithState(state) {
  const updateState = vi.fn();
  const value = {
    state,
    updateState,
    loading: false,
    startOver: vi.fn(),
    setState: vi.fn()
  };
  const result = render(
    <AppContext.Provider value={value}>
      <PlatformSpecificsStep />
    </AppContext.Provider>
  );
  return { result, updateState };
}

describe("AMI auto-population behavior", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path.startsWith("/api/aws/regions")) {
        return Promise.resolve({ regions: ["us-gov-east-1", "us-gov-west-1"] });
      }
      if (path.startsWith("/api/aws/ami")) {
        const url = new URL(path, "http://localhost");
        const region = url.searchParams.get("region");
        return Promise.resolve({ ami: `ami-auto-${region}` });
      }
      return Promise.resolve({});
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("selecting a region with empty AMI triggers auto-lookup", async () => {
    const state = makeAwsState("4.21", { aws: { region: "us-gov-west-1" } });
    renderWithState(state);

    await waitFor(() => {
      const amiCalls = vi.mocked(apiFetch).mock.calls.filter(c => c[0].startsWith("/api/aws/ami"));
      expect(amiCalls.length).toBeGreaterThanOrEqual(1);
    });

    const amiCall = vi.mocked(apiFetch).mock.calls.find(c => c[0].startsWith("/api/aws/ami"));
    expect(amiCall[0]).toContain("region=us-gov-west-1");
  });

  it("changing region updates auto-derived AMI to new region", async () => {
    const state1 = makeAwsState("4.21", { aws: { region: "us-gov-east-1", amiAutoFilled: true } });
    const { result, updateState } = renderWithState(state1);

    await waitFor(() => {
      const amiCalls = vi.mocked(apiFetch).mock.calls.filter(c => c[0].startsWith("/api/aws/ami"));
      expect(amiCalls.length).toBeGreaterThanOrEqual(1);
    });

    const firstAmiCall = vi.mocked(apiFetch).mock.calls.find(c => c[0].startsWith("/api/aws/ami"));
    expect(firstAmiCall[0]).toContain("region=us-gov-east-1");

    vi.mocked(apiFetch).mockClear();
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path.startsWith("/api/aws/regions")) {
        return Promise.resolve({ regions: ["us-gov-east-1", "us-gov-west-1"] });
      }
      if (path.startsWith("/api/aws/ami")) {
        return Promise.resolve({ ami: "ami-auto-us-gov-west-1" });
      }
      return Promise.resolve({});
    });

    const state2 = makeAwsState("4.21", { aws: { region: "us-gov-west-1", amiAutoFilled: true } });
    result.rerender(
      <AppContext.Provider value={{ state: state2, updateState, loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <PlatformSpecificsStep />
      </AppContext.Provider>
    );

    await waitFor(() => {
      const amiCalls = vi.mocked(apiFetch).mock.calls.filter(c => c[0].startsWith("/api/aws/ami"));
      expect(amiCalls.length).toBeGreaterThanOrEqual(1);
      expect(amiCalls[0][0]).toContain("region=us-gov-west-1");
    });
  });

  it("manual AMI override is NOT overwritten by auto-lookup", async () => {
    const state = makeAwsState("4.21", {
      aws: { region: "us-gov-west-1", amiId: "ami-manual-custom", amiAutoFilled: false }
    });
    renderWithState(state);

    await new Promise(r => setTimeout(r, 200));

    const amiCalls = vi.mocked(apiFetch).mock.calls.filter(c => c[0].startsWith("/api/aws/ami"));
    expect(amiCalls.length).toBe(0);
  });

  it("Refresh from installer replaces installer-derived value", async () => {
    const state = makeAwsState("4.21", {
      aws: { region: "us-gov-west-1", amiId: "ami-auto-old", amiAutoFilled: true }
    });
    const { updateState } = renderWithState(state);

    const refreshBtn = await screen.findByRole("button", { name: "Refresh from installer" });

    // Mounting with a region already set kicks off the automatic AMI lookup, and
    // the product deliberately disables Refresh while a lookup is in flight so
    // two lookups cannot race. Clicking a disabled button is a no-op, so wait for
    // the causal precondition — that initial lookup having settled — rather than
    // for the button merely being present. Waiting on presence alone is what made
    // this test fail intermittently under full-suite load.
    await waitFor(() => {
      expect(refreshBtn).toBeEnabled();
    });

    fireEvent.click(refreshBtn);

    await waitFor(() => {
      const forceCalls = vi.mocked(apiFetch).mock.calls.filter(
        c => c[0].startsWith("/api/aws/ami") && c[0].includes("force=true")
      );
      expect(forceCalls.length).toBeGreaterThanOrEqual(1);
    });

    // The force request having been *issued* does not mean its response has been
    // applied; updateState runs after the fetch resolves.
    await waitFor(() => {
      expect(updateState).toHaveBeenCalledWith(
        expect.objectContaining({
          platformConfig: expect.objectContaining({
            aws: expect.objectContaining({ amiId: "ami-auto-us-gov-west-1", amiAutoFilled: true })
          })
        })
      );
    });
  });

  it("auto-fill does not create infinite lookup calls", async () => {
    const state = makeAwsState("4.21", { aws: { region: "us-gov-west-1" } });
    renderWithState(state);

    await waitFor(() => {
      const amiCalls = vi.mocked(apiFetch).mock.calls.filter(c => c[0].startsWith("/api/aws/ami"));
      expect(amiCalls.length).toBeGreaterThanOrEqual(1);
    });

    await new Promise(r => setTimeout(r, 500));

    const amiCalls = vi.mocked(apiFetch).mock.calls.filter(c => c[0].startsWith("/api/aws/ami"));
    expect(amiCalls.length).toBeLessThanOrEqual(3);
  });
});
