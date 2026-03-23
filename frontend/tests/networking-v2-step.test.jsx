import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
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
    const { container } = render(
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

    expect(screen.getAllByPlaceholderText("e.g. 10.90.0.1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByPlaceholderText("e.g. fd00::1").length).toBeGreaterThanOrEqual(1);
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

    expect(screen.getAllByPlaceholderText("e.g. 10.90.0.1").length).toBeGreaterThanOrEqual(1);
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
    expect(result.errors).toContain("IBM Cloud install-config networking in OpenShift 4.20 is documented as IPv4 only.");
    expect(result.errors).toContain("IBM Cloud install-config clusterNetwork in OpenShift 4.20 is documented as IPv4 only.");
    expect(result.errors).toContain("IBM Cloud install-config serviceNetwork in OpenShift 4.20 is documented as IPv4 only.");
    const { container } = render(
      <AppContext.Provider value={{ state, updateState: vi.fn(), loading: false, startOver: vi.fn(), setState: vi.fn() }}>
        <NetworkingV2Step />
      </AppContext.Provider>
    );
    const view = within(container);
    expect(view.getByText(/IBM Cloud disconnected install in OpenShift 4.20 documents IPv4-only networking/i)).toBeInTheDocument();
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
    expect(screen.getByPlaceholderText("e.g. 10.0.0.5")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. 10.0.0.6")).toBeInTheDocument();
  });
});
