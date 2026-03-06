import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";
import { validateStep } from "../src/validation.js";
import { getScenarioId, getRequiredParamsForOutput, getParamMeta } from "../src/catalogResolver.js";
import { AppContext } from "../src/store.jsx";
import NetworkingV2Step from "../src/steps/NetworkingV2Step.jsx";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

function stateWithSegmentedFlow(segmentedFlowV1) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    credentials: {
      pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
      sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test"
    },
    ui: { ...base.ui, segmentedFlowV1 }
  };
}

function stateForNetworkingStep(overrides = {}) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    ui: {
      ...base.ui,
      segmentedFlowV1: true,
      activeStepId: "networking-v2",
      visitedSteps: {
        ...base.ui?.visitedSteps,
        blueprint: true,
        methodology: true,
        "identity-access": true,
        "networking-v2": true
      },
      completedSteps: {
        ...base.ui?.completedSteps,
        blueprint: true,
        methodology: true,
        "identity-access": true
      }
    },
    ...overrides
  };
}

describe("Networking replacement step (Phase 5 Prompt F)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        const body = opts?.body ? JSON.parse(opts.body) : stateWithSegmentedFlow(true);
        return Promise.resolve(body);
      }
      return Promise.resolve({});
    });
  });

  it("renders Networking step when segmented flow ON and user navigates to Networking", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Installation Methodology/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByRole("button", { name: /Proceed/i }).pop());
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Identity & Access/i })).toBeInTheDocument();
    });
    const networkingStepButton = screen.getByRole("button", { name: /^Networking$/i });
    fireEvent.click(networkingStepButton);
    await waitFor(
      () => {
        expect(screen.getByRole("heading", { name: /Cluster Networking/i })).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
    expect(screen.getByPlaceholderText("10.90.0.0/24")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("10.128.0.0/14")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("172.30.0.0/16")).toBeInTheDocument();
  });

  it("when scenario is bare metal (Agent), getScenarioId is bare-metal-agent and VIP params exist in catalog", () => {
    const state = stateForNetworkingStep();
    expect(getScenarioId(state)).toBe("bare-metal-agent");
    const requiredInstall = getRequiredParamsForOutput("bare-metal-agent", "install-config.yaml");
    expect(Array.isArray(requiredInstall)).toBe(true);
    const apiVipPath = "platform.baremetal.apiVIP";
    const ingressVipPath = "platform.baremetal.ingressVIP";
    const apiMeta = getParamMeta("bare-metal-agent", apiVipPath, "install-config.yaml");
    const ingressMeta = getParamMeta("bare-metal-agent", ingressVipPath, "install-config.yaml");
    expect(apiMeta?.required).toBe(false);
    expect(ingressMeta?.required).toBe(false);
  });

  it("when scenario is vsphere-ipi, Networking shows API and Ingress VIPs section (vSphere IPI)", () => {
    const state = stateForNetworkingStep({
      blueprint: {
        ...stateWithBlueprintCompleteMethodologyIncomplete().blueprint,
        platform: "VMware vSphere"
      },
      methodology: { method: "IPI" }
    });
    expect(getScenarioId(state)).toBe("vsphere-ipi");
    render(
      <AppContext.Provider value={{ state, updateState: vi.fn(), loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <NetworkingV2Step />
      </AppContext.Provider>
    );
    const headings = screen.getAllByRole("heading", { name: /API and Ingress VIPs/i });
    expect(headings.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByPlaceholderText("e.g. 192.168.1.10")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. 192.168.1.11")).toBeInTheDocument();
  });

  it("overlap validation: networking-v2 step reports errors when machine overlaps cluster", () => {
    const state = stateForNetworkingStep({
      globalStrategy: {
        ...stateForNetworkingStep().globalStrategy,
        networking: {
          machineNetworkV4: "10.128.0.0/14",
          clusterNetworkCidr: "10.128.0.0/14",
          clusterNetworkHostPrefix: 23,
          serviceNetworkCidr: "172.30.0.0/16",
          networkType: "OVNKubernetes"
        }
      }
    });
    const result = validateStep(state, "networking-v2");
    expect(result.errors).toContain("Machine network overlaps with cluster network CIDR.");
  });

  it("overlap validation: no errors when networks do not overlap", () => {
    const state = stateForNetworkingStep({
      globalStrategy: {
        ...stateForNetworkingStep().globalStrategy,
        networking: {
          machineNetworkV4: "10.90.0.0/24",
          clusterNetworkCidr: "10.128.0.0/14",
          clusterNetworkHostPrefix: 23,
          serviceNetworkCidr: "172.30.0.0/16",
          networkType: "OVNKubernetes"
        }
      }
    });
    const result = validateStep(state, "networking-v2");
    expect(result.errors).toHaveLength(0);
  });

  it("VIPs are not required for networking-v2 (catalog required: false; external LB note)", () => {
    const state = stateForNetworkingStep({
      globalStrategy: {
        ...stateForNetworkingStep().globalStrategy,
        networking: {
          machineNetworkV4: "10.90.0.0/24",
          clusterNetworkCidr: "10.128.0.0/14",
          clusterNetworkHostPrefix: 23,
          serviceNetworkCidr: "172.30.0.0/16",
          networkType: "OVNKubernetes"
        }
      },
      hostInventory: { nodes: [], schemaVersion: 2, apiVip: "", ingressVip: "" }
    });
    const result = validateStep(state, "networking-v2");
    expect(result.errors).not.toContainEqual(
      expect.stringMatching(/API VIP|Ingress VIP|VIP.*required/i)
    );
    expect(result.errors).toHaveLength(0);
  });

  it("when scenario is aws-govcloud-ipi, getScenarioId returns aws-govcloud-ipi and Networking tab shows full form (A2 tab relevance)", () => {
    const state = stateForNetworkingStep({
      blueprint: {
        ...stateWithBlueprintCompleteMethodologyIncomplete().blueprint,
        platform: "AWS GovCloud"
      },
      methodology: { method: "IPI" }
    });
    expect(getScenarioId(state)).toBe("aws-govcloud-ipi");
    const requiredPaths = getRequiredParamsForOutput("aws-govcloud-ipi", "install-config.yaml");
    expect(Array.isArray(requiredPaths)).toBe(true);
  });

  it("when scenario is aws-govcloud-ipi, Networking step shows full form (A2 tab relevance)", async () => {
    const state = stateForNetworkingStep({
      blueprint: {
        ...stateWithBlueprintCompleteMethodologyIncomplete().blueprint,
        platform: "AWS GovCloud"
      },
      methodology: { method: "IPI" }
    });
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        return Promise.resolve(opts?.body ? JSON.parse(opts.body) : state);
      }
      return Promise.resolve({});
    });
    render(<App />);
    await waitFor(() => {
      const clusterHeadings = screen.getAllByRole("heading", { name: /Cluster Networking/i });
      expect(clusterHeadings.length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByPlaceholderText("10.90.0.0/24").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByPlaceholderText("10.128.0.0/14").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByPlaceholderText("172.30.0.0/16").length).toBeGreaterThanOrEqual(1);
  });
});
