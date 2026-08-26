/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within, cleanup } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";
import { validateStep } from "../src/validation.js";
import * as catalogResolver from "../src/catalogResolver.js";
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
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        const body = opts?.body ? JSON.parse(opts.body) : stateWithSegmentedFlow(true);
        return Promise.resolve(body);
      }
      return Promise.resolve({});
    });
  });

  afterEach(() => {
    cleanup();
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
    const { container } = render(
      <AppContext.Provider value={{ state, updateState: vi.fn(), loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <NetworkingV2Step />
      </AppContext.Provider>
    );
    const headings = screen.getAllByRole("heading", { name: /API and Ingress VIPs/i });
    expect(headings.length).toBeGreaterThanOrEqual(1);
    // VIP placeholders default to 10.90.0.x when no machine network is configured
    expect(screen.getAllByPlaceholderText("e.g. 10.90.0.2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByPlaceholderText("e.g. 10.90.0.3").length).toBeGreaterThanOrEqual(1);
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
      },
      // bare-metal-agent requires VIPs; include valid values so this test isolates overlap validation
      hostInventory: { ...(stateForNetworkingStep().hostInventory || {}), nodes: [], schemaVersion: 2, apiVip: "10.90.0.10", ingressVip: "10.90.0.11" }
    });
    const result = validateStep(state, "networking-v2");
    expect(result.errors).toHaveLength(0);
  });

  it("bare-metal-agent: API/Ingress VIPs are required for networking-v2 (doc-driven)", () => {
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
      blueprint: { ...stateForNetworkingStep().blueprint, platform: "Bare Metal" },
      methodology: { method: "Agent-Based Installer" },
      hostInventory: { nodes: [], schemaVersion: 2, apiVip: "", ingressVip: "" }
    });
    const result = validateStep(state, "networking-v2");
    expect(result.errors.some((e) => /API VIPs are required/i.test(e))).toBe(true);
    expect(result.errors.some((e) => /Ingress VIPs are required/i.test(e))).toBe(true);
  });

  it("bare-metal-agent dual-stack: VIP note/placeholder do not mention comma-separated dual-stack", () => {
    const state = stateForNetworkingStep({
      blueprint: { ...stateForNetworkingStep().blueprint, platform: "Bare Metal" },
      methodology: { method: "Agent-Based Installer" },
      hostInventory: { ...(stateForNetworkingStep().hostInventory || {}), nodes: [], enableIpv6: true, apiVip: "", ingressVip: "", apiVipV6: "", ingressVipV6: "" }
    });

    const { container } = render(
      <AppContext.Provider value={{ state, updateState: vi.fn(), loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <NetworkingV2Step />
      </AppContext.Provider>
    );

    expect(screen.getAllByPlaceholderText("e.g. 10.90.0.2").length).toBeGreaterThanOrEqual(1);
    // IPv6 VIP placeholders default to fd00::2/fd00::3 when no IPv6 machine network is configured
    expect(screen.getAllByPlaceholderText("e.g. fd00::2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/separate IPv4 and IPv6 fields/i)).toBeInTheDocument();
    expect(within(container).queryByText(/comma-separated/i)).toBeNull();
  });

  it("bare-metal-agent single-stack: VIP placeholders do not include comma-separated dual-stack examples", () => {
    const state = stateForNetworkingStep({
      blueprint: { ...stateForNetworkingStep().blueprint, platform: "Bare Metal" },
      methodology: { method: "Agent-Based Installer" },
      hostInventory: { ...(stateForNetworkingStep().hostInventory || {}), nodes: [], enableIpv6: false, apiVip: "", ingressVip: "" }
    });

    const { container } = render(
      <AppContext.Provider value={{ state, updateState: vi.fn(), loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <NetworkingV2Step />
      </AppContext.Provider>
    );

    expect(screen.getAllByPlaceholderText("e.g. 10.90.0.2").length).toBeGreaterThanOrEqual(1);
    expect(within(container).queryByText(/comma-separated/i)).toBeNull();
  });

  it("vSphere IPI: API/Ingress VIPs must be within machine network", () => {
    const state = stateForNetworkingStep({
      blueprint: { ...stateForNetworkingStep().blueprint, platform: "VMware vSphere" },
      methodology: { method: "IPI" },
      globalStrategy: {
        ...stateForNetworkingStep().globalStrategy,
        networking: {
          machineNetworkV4: "10.0.0.0/16",
          clusterNetworkCidr: "10.128.0.0/14",
          clusterNetworkHostPrefix: 23,
          serviceNetworkCidr: "172.30.0.0/16",
          networkType: "OVNKubernetes"
        }
      },
      platformConfig: {
        vsphere: {
          apiVIPs: ["192.168.1.10"],
          ingressVIPs: ["10.0.0.5"]
        }
      }
    });
    const result = validateStep(state, "networking-v2");
    expect(result.errors.some((e) => /API VIPs must be within the machine network/i.test(e))).toBe(true);
    expect(result.fieldErrors?.apiVip).toBeDefined();
    expect(result.errors.some((e) => /Ingress VIPs must be within the machine network/i.test(e))).toBe(false);
  });

  it("vSphere IPI: no VIP-in-machine-network error when VIPs are inside CIDR", () => {
    const state = stateForNetworkingStep({
      blueprint: { ...stateForNetworkingStep().blueprint, platform: "VMware vSphere" },
      methodology: { method: "IPI" },
      globalStrategy: {
        ...stateForNetworkingStep().globalStrategy,
        networking: {
          machineNetworkV4: "10.0.0.0/16",
          clusterNetworkCidr: "10.128.0.0/14",
          clusterNetworkHostPrefix: 23,
          serviceNetworkCidr: "172.30.0.0/16",
          networkType: "OVNKubernetes"
        }
      },
      platformConfig: {
        vsphere: {
          apiVIPs: ["10.0.0.10"],
          ingressVIPs: ["10.0.0.11"]
        }
      }
    });
    const result = validateStep(state, "networking-v2");
    expect(result.errors.filter((e) => /must be within the machine network/i.test(e))).toHaveLength(0);
  });


  it("vsphere-agent: when IPv6 is enabled, cluster and service IPv6 fields show without machine IPv6 filled (shared dual-stack visibility)", async () => {
    const base = stateForNetworkingStep({
      blueprint: { ...stateForNetworkingStep().blueprint, platform: "VMware vSphere" },
      methodology: { method: "Agent-Based Installer" },
      hostInventory: {
        enableIpv6: true,
        schemaVersion: 2,
        nodes: [
          { role: "master", hostname: "m-0" },
          { role: "master", hostname: "m-1" }
        ],
        apiVip: "10.90.0.10",
        ingressVip: "10.90.0.11"
      },
      globalStrategy: {
        ...stateForNetworkingStep().globalStrategy,
        networking: {
          machineNetworkV4: "10.90.0.0/24",
          machineNetworkV6: "",
          clusterNetworkCidr: "10.128.0.0/14",
          clusterNetworkHostPrefix: 23,
          serviceNetworkCidr: "172.30.0.0/16",
          networkType: "OVNKubernetes"
        }
      }
    });
    expect(getScenarioId(base)).toBe("vsphere-agent");
    const { container } = render(
      <AppContext.Provider value={{ state: base, updateState: vi.fn(), loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <NetworkingV2Step />
      </AppContext.Provider>
    );
    const view = within(container);
    await waitFor(() => {
      expect(view.getByText(/Cluster Network IPv6 CIDR/i)).toBeInTheDocument();
      expect(view.getByText(/Service Network IPv6 CIDR/i)).toBeInTheDocument();
      expect(view.getByPlaceholderText("fd01::/48")).toBeInTheDocument();
      expect(view.getByPlaceholderText("fd02::/112")).toBeInTheDocument();
    });
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

  it("when scenario is ibm-cloud-ipi, networking enforces IPv4-only and hides IPv6 fields", () => {
    const state = stateForNetworkingStep({
      blueprint: {
        ...stateWithBlueprintCompleteMethodologyIncomplete().blueprint,
        platform: "IBM Cloud"
      },
      methodology: { method: "IPI" },
      hostInventory: { enableIpv6: true },
      globalStrategy: {
        ...(stateForNetworkingStep().globalStrategy || {}),
        networking: {
          machineNetworkV4: "10.90.0.0/24",
          machineNetworkV6: "fd10:90::/64",
          clusterNetworkCidr: "10.128.0.0/14",
          clusterNetworkCidrV6: "fd01::/48",
          serviceNetworkCidr: "172.30.0.0/16",
          serviceNetworkCidrV6: "fd02::/112"
        }
      }
    });
    expect(getScenarioId(state)).toBe("ibm-cloud-ipi");
    const result = validateStep(state, "networking-v2");
    expect(result.errors).toContain("IBM Cloud install-config networking supports IPv4 addresses only.");
    expect(result.errors).toContain("IBM Cloud install-config clusterNetwork supports IPv4 addresses only.");
    expect(result.errors).toContain("IBM Cloud install-config serviceNetwork supports IPv4 addresses only.");
    const { container } = render(
      <AppContext.Provider value={{ state, updateState: vi.fn(), loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <NetworkingV2Step />
      </AppContext.Provider>
    );
    const view = within(container);
    expect(view.getByText(/IBM Cloud disconnected install documents IPv4-only networking/i)).toBeInTheDocument();
    expect(view.queryByLabelText(/Enable IPv6/i)).not.toBeInTheDocument();
    expect(view.queryByPlaceholderText("fd01::/48")).not.toBeInTheDocument();
    expect(view.queryByPlaceholderText("fd02::/112")).not.toBeInTheDocument();
  });

  it("when IPv6 is enabled, cluster and service IPv6 fields are visible without requiring machineNetworkV6", () => {
    const state = stateForNetworkingStep({
      blueprint: {
        ...stateWithBlueprintCompleteMethodologyIncomplete().blueprint,
        platform: "Bare Metal"
      },
      methodology: { method: "Agent-Based Installer" },
      globalStrategy: {
        networking: {
          machineNetworkV4: "192.168.1.0/24",
          machineNetworkV6: "",
          clusterNetworkCidr: "10.128.0.0/14",
          serviceNetworkCidr: "172.30.0.0/16"
        }
      },
      hostInventory: { enableIpv6: true, apiVip: "", ingressVip: "" }
    });
    const updateState = vi.fn();
    render(
      <AppContext.Provider value={{ state, updateState, loading: false, startOver: vi.fn() }}>
        <NetworkingV2Step />
      </AppContext.Provider>
    );
    expect(screen.getAllByPlaceholderText("fd01::/48").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByPlaceholderText("fd02::/112").length).toBeGreaterThanOrEqual(1);
  });

  it("when scenario is aws-govcloud-ipi, Networking step shows full form (A2 tab relevance)", () => {
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

    render(
      <AppContext.Provider value={{ state, updateState: vi.fn(), loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <NetworkingV2Step />
      </AppContext.Provider>
    );

    expect(screen.getAllByPlaceholderText("10.90.0.0/24").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByPlaceholderText("10.128.0.0/14").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByPlaceholderText("172.30.0.0/16").length).toBeGreaterThanOrEqual(1);
  });

  it("when scenario is nutanix-ipi, Networking shows Nutanix API and Ingress VIP fields", () => {
    const base = stateForNetworkingStep({
      blueprint: {
        ...stateWithBlueprintCompleteMethodologyIncomplete().blueprint,
        platform: "Nutanix"
      },
      methodology: { method: "IPI" },
      globalStrategy: {
        networking: {
          machineNetworkV4: "10.90.0.0/24",
          clusterNetworkCidr: "10.128.0.0/14",
          serviceNetworkCidr: "172.30.0.0/16",
          networkType: "OVNKubernetes"
        }
      }
    });
    expect(getScenarioId(base)).toBe("nutanix-ipi");
    render(
      <AppContext.Provider value={{ state: base, updateState: vi.fn(), loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <NetworkingV2Step />
      </AppContext.Provider>
    );
    expect(screen.getAllByText(/Nutanix IPI/i).length).toBeGreaterThanOrEqual(1);
    // VIP placeholders are now dynamic based on machine network (defaults to 10.90.0.2/3 if not set)
    expect(screen.getAllByPlaceholderText("e.g. 10.90.0.2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByPlaceholderText("e.g. 10.90.0.3").length).toBeGreaterThanOrEqual(1);
  });
});

describe("NetworkingV2Step version-aware catalog access (DOC-102 Slice 5H Chunk 6)", () => {
  const INSTALL_CONFIG = "install-config.yaml";

  const SYNTHETIC_CATALOG = [
    { path: "networking.machineNetwork[].cidr", outputFile: INSTALL_CONFIG, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null, required: false },
    { path: "networking.clusterNetwork[].cidr", outputFile: INSTALL_CONFIG, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null, required: false },
    { path: "networking.clusterNetwork[].hostPrefix", outputFile: INSTALL_CONFIG, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null, required: false },
    { path: "networking.serviceNetwork", outputFile: INSTALL_CONFIG, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, required: true },
    { path: "networking.clusterNetwork", outputFile: INSTALL_CONFIG, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null, required: false },
    { path: "networking.machineNetwork", outputFile: INSTALL_CONFIG, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null, required: false },
    { path: "platform.baremetal.apiVIPs", outputFile: INSTALL_CONFIG, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, required: false },
    { path: "platform.baremetal.ingressVIPs", outputFile: INSTALL_CONFIG, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, required: false },
  ];

  function stateForNetworkingV2(versionOverrides = {}) {
    return stateForNetworkingStep({
      version: { selectedMinor: "4.20", ...versionOverrides },
      globalStrategy: {
        networking: {
          machineNetworkV4: "10.90.0.0/24",
          clusterNetworkCidr: "10.128.0.0/14",
          clusterNetworkHostPrefix: 23,
          serviceNetworkCidr: "172.30.0.0/16",
          networkType: "OVNKubernetes"
        }
      }
    });
  }

  function renderNetworking(state) {
    return render(
      <AppContext.Provider value={{ state, updateState: vi.fn(), loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <NetworkingV2Step />
      </AppContext.Provider>
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("requests catalog with '4.20' when state has selectedMinor 4.20", () => {
    const spy = vi.spyOn(catalogResolver, "getCatalogForScenario");
    const state = stateForNetworkingV2({ selectedMinor: "4.20" });
    renderNetworking(state);
    const catalogCall = spy.mock.calls.find((c) => c[0] === "bare-metal-agent");
    expect(catalogCall[1]).toBe("4.20");
  });

  it("requests catalog with '4.21' when state has selectedMinor 4.21", () => {
    const spy = vi.spyOn(catalogResolver, "getCatalogForScenario");
    const state = stateForNetworkingV2({ selectedMinor: "4.21" });
    renderNetworking(state);
    const catalogCall = spy.mock.calls.find((c) => c[0] === "bare-metal-agent");
    expect(catalogCall[1]).toBe("4.21");
  });

  it("passes explicit 4.22 to getCatalogForScenario without downgrading", () => {
    const catalogSpy = vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue([]);
    vi.spyOn(catalogResolver, "getParamMeta").mockReturnValue(undefined);
    vi.spyOn(catalogResolver, "getRequiredParamsForOutput").mockReturnValue([]);
    const state = stateForNetworkingV2({ selectedMinor: "4.22" });
    renderNetworking(state);
    const catalogCall = catalogSpy.mock.calls.find((c) => c[0] === "bare-metal-agent");
    expect(catalogCall[1]).toBe("4.22");
    expect(catalogCall[1]).not.toBe("4.20");
    expect(catalogCall[1]).not.toBe("4.21");
  });

  it("passes state as fourth argument to every getParamMeta call", () => {
    const metaSpy = vi.spyOn(catalogResolver, "getParamMeta");
    const state = stateForNetworkingV2();
    renderNetworking(state);
    expect(metaSpy.mock.calls.length).toBeGreaterThan(0);
    for (const call of metaSpy.mock.calls) {
      expect(call[3]).toBe(state);
    }
  });

  it("passes state as third argument to every getRequiredParamsForOutput call", () => {
    const spy = vi.spyOn(catalogResolver, "getRequiredParamsForOutput");
    const state = stateForNetworkingV2();
    renderNetworking(state);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      expect(call[2]).toBe(state);
    }
  });

  it("networking.serviceNetwork with minVersion 4.21 is absent at selected minor 4.20", () => {
    const catalog = SYNTHETIC_CATALOG.map((e) =>
      e.path === "networking.serviceNetwork" ? { ...e, minVersion: "4.21" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateForNetworkingV2({ selectedMinor: "4.20" });
    renderNetworking(state);
    expect(screen.queryByPlaceholderText("172.30.0.0/16")).not.toBeInTheDocument();
  });

  it("networking.serviceNetwork with minVersion 4.21 is present at selected minor 4.21", () => {
    const catalog = SYNTHETIC_CATALOG.map((e) =>
      e.path === "networking.serviceNetwork" ? { ...e, minVersion: "4.21" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateForNetworkingV2({ selectedMinor: "4.21" });
    renderNetworking(state);
    expect(screen.getByPlaceholderText("172.30.0.0/16")).toBeInTheDocument();
  });

  it("exception controls remain visible when networking.serviceNetwork is version-gated", () => {
    const catalog = SYNTHETIC_CATALOG.map((e) =>
      e.path === "networking.serviceNetwork" ? { ...e, minVersion: "4.21" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateForNetworkingV2({ selectedMinor: "4.20" });
    renderNetworking(state);
    expect(screen.getByPlaceholderText("10.90.0.0/24")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("10.128.0.0/14")).toBeInTheDocument();
  });

  it("networking.serviceNetwork with supported-backend-only is absent even when in version range", () => {
    const catalog = SYNTHETIC_CATALOG.map((e) =>
      e.path === "networking.serviceNetwork" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateForNetworkingV2({ selectedMinor: "4.21" });
    renderNetworking(state);
    expect(screen.queryByPlaceholderText("172.30.0.0/16")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("10.128.0.0/14")).toBeInTheDocument();
  });

  it("omitted catalog field does not render while retained sibling renders", () => {
    const catalog = SYNTHETIC_CATALOG.filter((e) => e.path !== "networking.serviceNetwork");
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateForNetworkingV2({ selectedMinor: "4.20" });
    renderNetworking(state);
    expect(screen.queryByPlaceholderText("172.30.0.0/16")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("10.128.0.0/14")).toBeInTheDocument();
  });

  it("Cluster Network and Machine Network remain visible with synthetic non-renderable statuses", () => {
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(SYNTHETIC_CATALOG);
    const state = stateForNetworkingV2();
    renderNetworking(state);
    expect(screen.getByPlaceholderText("10.90.0.0/24")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("10.128.0.0/14")).toBeInTheDocument();
  });

  it.each(["4.20", "4.21"])("Cluster Network and Machine Network remain visible with real catalog %s", (version) => {
    const state = stateForNetworkingV2({ selectedMinor: version });
    renderNetworking(state);
    expect(screen.getByPlaceholderText("10.90.0.0/24")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("10.128.0.0/14")).toBeInTheDocument();
  });

  it("Service network group absent when networking.serviceNetwork hidden; exception controls and card remain", () => {
    const catalog = SYNTHETIC_CATALOG.map((e) =>
      e.path === "networking.serviceNetwork" ? { ...e, supportStatus: "supported-backend-only" } : e
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateForNetworkingV2();
    renderNetworking(state);
    const serviceH4s = screen.queryAllByRole("heading", { level: 4 }).filter((el) => /Service network/i.test(el.textContent));
    expect(serviceH4s).toHaveLength(0);
    expect(screen.getByPlaceholderText("10.90.0.0/24")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("10.128.0.0/14")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Cluster Networking/i })).toBeInTheDocument();
    expect(state.globalStrategy.networking.serviceNetworkCidr).toBe("172.30.0.0/16");
  });

  it("API and Ingress VIPs card absent when all VIP catalog fields hidden", () => {
    const catalog = SYNTHETIC_CATALOG.map((e) => {
      if (e.path === "platform.baremetal.apiVIPs" || e.path === "platform.baremetal.ingressVIPs") {
        return { ...e, supportStatus: "supported-backend-only" };
      }
      return e;
    });
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateForNetworkingV2();
    renderNetworking(state);
    expect(screen.queryByRole("heading", { name: /API and Ingress VIPs/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Cluster Networking/i })).toBeInTheDocument();
  });

  it.each(["4.20", "4.21"])("real catalog %s: principal networking controls render", (version) => {
    const state = stateForNetworkingV2({ selectedMinor: version });
    renderNetworking(state);
    expect(screen.getByPlaceholderText("172.30.0.0/16")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("10.90.0.0/24")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("10.128.0.0/14")).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText("e.g. 10.90.0.2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByPlaceholderText("e.g. 10.90.0.3").length).toBeGreaterThanOrEqual(1);
  });
});

describe("NetworkingV2Step vSphere IPI VIP metadata-based visibility (DOC-102 Slice 5H Chunk 6 Phase 2)", () => {
  const IC = "install-config.yaml";

  const VSPHERE_IPI_CATALOG = [
    { path: "networking.machineNetwork[].cidr", outputFile: IC, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null },
    { path: "networking.clusterNetwork[].cidr", outputFile: IC, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null },
    { path: "networking.clusterNetwork[].hostPrefix", outputFile: IC, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null },
    { path: "networking.serviceNetwork", outputFile: IC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "networking.clusterNetwork", outputFile: IC, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null },
    { path: "networking.machineNetwork", outputFile: IC, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null },
    { path: "platform.vsphere.apiVIPs", outputFile: IC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
    { path: "platform.vsphere.ingressVIPs", outputFile: IC, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null },
  ];

  function vsphereIpiState(overrides = {}) {
    return stateForNetworkingStep({
      blueprint: { ...stateWithBlueprintCompleteMethodologyIncomplete().blueprint, platform: "VMware vSphere" },
      methodology: { method: "IPI" },
      version: { selectedMinor: "4.20" },
      globalStrategy: {
        networking: {
          machineNetworkV4: "10.90.0.0/24",
          clusterNetworkCidr: "10.128.0.0/14",
          clusterNetworkHostPrefix: 23,
          serviceNetworkCidr: "172.30.0.0/16",
          networkType: "OVNKubernetes"
        }
      },
      ...overrides
    });
  }

  function renderNetworking(state) {
    return render(
      <AppContext.Provider value={{ state, updateState: vi.fn(), loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <NetworkingV2Step />
      </AppContext.Provider>
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  // Category 1: Renderable vSphere VIP metadata
  it("renderable metadata: both VIP controls render when catalog has supported-ui entries", () => {
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(VSPHERE_IPI_CATALOG);
    const state = vsphereIpiState();
    renderNetworking(state);
    expect(screen.getAllByPlaceholderText("e.g. 10.90.0.2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByPlaceholderText("e.g. 10.90.0.3").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("heading", { name: /API and Ingress VIPs/i })).toBeInTheDocument();
  });

  // Category 2: Non-renderable metadata
  it("non-renderable metadata: VIP controls and card absent when both VIPs are supported-backend-only", () => {
    const catalog = VSPHERE_IPI_CATALOG.map((e) => {
      if (e.path === "platform.vsphere.apiVIPs" || e.path === "platform.vsphere.ingressVIPs") {
        return { ...e, supportStatus: "supported-backend-only" };
      }
      return e;
    });
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = vsphereIpiState();
    renderNetworking(state);
    expect(screen.queryByPlaceholderText("e.g. 10.90.0.2")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("e.g. 10.90.0.3")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /API and Ingress VIPs/i })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("10.90.0.0/24")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("10.128.0.0/14")).toBeInTheDocument();
  });

  // Category 3: Missing metadata
  it("missing metadata: VIP controls absent when catalog omits vSphere VIP entries entirely", () => {
    const catalog = VSPHERE_IPI_CATALOG.filter(
      (e) => e.path !== "platform.vsphere.apiVIPs" && e.path !== "platform.vsphere.ingressVIPs"
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = vsphereIpiState();
    renderNetworking(state);
    expect(screen.queryByPlaceholderText("e.g. 10.90.0.2")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("e.g. 10.90.0.3")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /API and Ingress VIPs/i })).not.toBeInTheDocument();
  });

  // Category 4: Partial visibility
  it("partial visibility: only API VIPs renders when apiVIPs is supported-ui and ingressVIPs is supported-backend-only", () => {
    const catalog = VSPHERE_IPI_CATALOG.map((e) => {
      if (e.path === "platform.vsphere.ingressVIPs") {
        return { ...e, supportStatus: "supported-backend-only" };
      }
      return e;
    });
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = vsphereIpiState();
    renderNetworking(state);
    expect(screen.getAllByPlaceholderText("e.g. 10.90.0.2").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByPlaceholderText("e.g. 10.90.0.3")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /API and Ingress VIPs/i })).toBeInTheDocument();
  });

  it("partial visibility: only Ingress VIPs renders when ingressVIPs is supported-ui and apiVIPs is supported-backend-only", () => {
    const catalog = VSPHERE_IPI_CATALOG.map((e) => {
      if (e.path === "platform.vsphere.apiVIPs") {
        return { ...e, supportStatus: "supported-backend-only" };
      }
      return e;
    });
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = vsphereIpiState();
    renderNetworking(state);
    expect(screen.queryByPlaceholderText("e.g. 10.90.0.2")).not.toBeInTheDocument();
    expect(screen.getAllByPlaceholderText("e.g. 10.90.0.3").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("heading", { name: /API and Ingress VIPs/i })).toBeInTheDocument();
  });

  // Category 5: State preservation
  it("state preservation: hiding VIP fields does not clear stored VIP values", () => {
    const catalog = VSPHERE_IPI_CATALOG.map((e) => {
      if (e.path === "platform.vsphere.apiVIPs" || e.path === "platform.vsphere.ingressVIPs") {
        return { ...e, supportStatus: "supported-backend-only" };
      }
      return e;
    });
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = vsphereIpiState({
      platformConfig: {
        vsphere: {
          apiVIPs: ["10.90.0.50"],
          ingressVIPs: ["10.90.0.51"]
        }
      }
    });
    renderNetworking(state);
    expect(screen.queryByPlaceholderText("e.g. 10.90.0.2")).not.toBeInTheDocument();
    expect(state.platformConfig.vsphere.apiVIPs).toEqual(["10.90.0.50"]);
    expect(state.platformConfig.vsphere.ingressVIPs).toEqual(["10.90.0.51"]);
  });

  // Category 6: Real catalogs
  it.each(["4.20", "4.21"])("real catalog %s: vsphere-ipi VIP controls render", (version) => {
    const state = vsphereIpiState({ version: { selectedMinor: version } });
    renderNetworking(state);
    expect(screen.getByRole("heading", { name: /API and Ingress VIPs/i })).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText("e.g. 10.90.0.2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByPlaceholderText("e.g. 10.90.0.3").length).toBeGreaterThanOrEqual(1);
  });
});
