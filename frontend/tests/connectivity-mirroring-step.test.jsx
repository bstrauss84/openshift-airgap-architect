import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { useState } from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";
import { validateStep } from "../src/validation.js";
import { getScenarioId, getParamMeta } from "../src/catalogResolver.js";
import ConnectivityMirroringStep from "../src/steps/ConnectivityMirroringStep.jsx";
import { AppContext } from "../src/store.jsx";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

function stateWithSegmentedFlow(segmentedFlowV1) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    credentials: {
      pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
      usingMirrorRegistry: true,
      mirrorRegistryPullSecret: '{"auths":{"mirror.corp.local:5000":{}}}',
      mirrorRegistryUnauthenticated: false,
      sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test"
    },
    ui: { ...base.ui, segmentedFlowV1 }
  };
}

function stateForConnectivityMirroringStep(overrides = {}) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    credentials: {
      pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
      sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test"
    },
    ui: {
      ...base.ui,
      segmentedFlowV1: true,
      activeStepId: "connectivity-mirroring",
      visitedSteps: {
        ...base.ui?.visitedSteps,
        blueprint: true,
        methodology: true,
        "identity-access": true,
        "networking-v2": true,
        "connectivity-mirroring": true
      },
      completedSteps: {
        ...base.ui?.completedSteps,
        blueprint: true,
        methodology: true,
        "identity-access": true,
        "networking-v2": true
      }
    },
    ...overrides
  };
}

function StatefulAppContext({ initialState, children }) {
  const [state, setState] = useState(initialState);
  const updateState = (patch) => setState((prev) => ({ ...prev, ...patch }));
  return (
    <AppContext.Provider value={{ state, updateState, setState, loading: false, startOver: vi.fn() }}>
      {children}
    </AppContext.Provider>
  );
}

describe("Connectivity & Mirroring replacement step (Phase 5 Prompt H)", () => {
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

  it("renders Connectivity & Mirroring step when segmented flow ON and user navigates to Connectivity & Mirroring", async () => {
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
    const connectivityStepButton = screen.getByRole("button", { name: /Connectivity & Mirroring/i });
    fireEvent.click(connectivityStepButton);
    await waitFor(
      () => {
        expect(screen.getByRole("heading", { name: /Connectivity & Mirroring/i })).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
    expect(screen.getByRole("heading", { name: /Mirroring Configuration/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Time & NTP/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/registry\.corp\.local:5000/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/time\.corp\.local/)).toBeInTheDocument();
  });

  it("hides Mirroring Configuration when mirror registry is not in use", async () => {
    const base = stateForConnectivityMirroringStep();
    const state = {
      ...base,
      credentials: {
        ...base.credentials,
        usingMirrorRegistry: false,
        mirrorRegistryPullSecret: "",
        mirrorRegistryUnauthenticated: false,
        // Ensure we still treat the pull secret placeholder as present (connected path)
        pullSecretPlaceholder: '{"auths":{"quay.io":{}}}'
      }
    };

    const { container } = render(
      <StatefulAppContext initialState={state}>
        <ConnectivityMirroringStep />
      </StatefulAppContext>
    );

    expect(within(container).queryByRole("heading", { name: /Mirroring Configuration/i })).toBeNull();
    expect(within(container).getByRole("heading", { name: /Time & NTP/i })).toBeInTheDocument();
  });

  it("auto-derives Local Registry FQDN from unambiguous mirror pull secret", async () => {
    const state = stateForConnectivityMirroringStep({
      credentials: {
        ...stateForConnectivityMirroringStep().credentials,
        usingMirrorRegistry: true,
        // single registry auth entry
        mirrorRegistryPullSecret: '{"auths":{"mirror.corp.local:5001":{}}}',
        mirrorRegistryUnauthenticated: false
      },
      globalStrategy: {
        ...stateForConnectivityMirroringStep().globalStrategy,
        mirroring: {
          ...stateForConnectivityMirroringStep().globalStrategy.mirroring,
          registryFqdn: "registry.local:5000"
        }
      }
    });

    const { container } = render(
      <StatefulAppContext initialState={state}>
        <ConnectivityMirroringStep />
      </StatefulAppContext>
    );

    // Wait for effect hydration.
    await waitFor(() => {
      expect(within(container).getByRole("textbox", { name: /Local Registry FQDN/i })).toHaveValue("mirror.corp.local:5001");
    });
  });

  it("does not silently derive Local Registry FQDN when mirror pull secret contains multiple auth entries", async () => {
    const state = stateForConnectivityMirroringStep({
      credentials: {
        ...stateForConnectivityMirroringStep().credentials,
        usingMirrorRegistry: true,
        mirrorRegistryPullSecret: '{"auths":{"a.corp.local:5000":{},"b.corp.local:5000":{}}}',
        mirrorRegistryUnauthenticated: false
      },
      globalStrategy: {
        ...stateForConnectivityMirroringStep().globalStrategy,
        mirroring: {
          ...stateForConnectivityMirroringStep().globalStrategy.mirroring,
          registryFqdn: "registry.local:5000"
        }
      }
    });

    const { container } = render(
      <StatefulAppContext initialState={state}>
        <ConnectivityMirroringStep />
      </StatefulAppContext>
    );

    await waitFor(() => {
      expect(within(container).getByRole("textbox", { name: /Local Registry FQDN/i })).toHaveValue("registry.local:5000");
      expect(within(container).getByText(/contains multiple registries/i)).toBeInTheDocument();
    });
  });

  it("when scenario is bare-metal-agent, getScenarioId and getParamMeta return expected mirroring/NTP meta", () => {
    const state = stateForConnectivityMirroringStep();
    expect(getScenarioId(state)).toBe("bare-metal-agent");
    const imageDigestMeta = getParamMeta("bare-metal-agent", "imageDigestSources", "install-config.yaml");
    const ntpMeta = getParamMeta("bare-metal-agent", "additionalNTPSources", "agent-config.yaml");
    expect(imageDigestMeta?.required).toBe(false);
    expect(ntpMeta?.required).toBe(false);
  });

  it("state is read/written for mirroring and NTP", () => {
    const state = stateForConnectivityMirroringStep({
      globalStrategy: {
        ...stateForConnectivityMirroringStep().globalStrategy,
        mirroring: {
          registryFqdn: "registry.corp.local:5000",
          sources: [
            { source: "quay.io/openshift-release-dev/ocp-release", mirrors: ["registry.corp.local:5000/ocp-release"] }
          ]
        },
        ntpServers: ["time.corp.local", "10.90.0.10"]
      }
    });
    expect(state.globalStrategy.mirroring.registryFqdn).toBe("registry.corp.local:5000");
    expect(state.globalStrategy.mirroring.sources[0].source).toContain("ocp-release");
    expect(state.globalStrategy.ntpServers).toEqual(["time.corp.local", "10.90.0.10"]);
  });

  it("validation runs for connectivity-mirroring: error when mirror URL set but source empty", () => {
    const state = stateForConnectivityMirroringStep({
      globalStrategy: {
        ...stateForConnectivityMirroringStep().globalStrategy,
        mirroring: {
          registryFqdn: "registry.local:5000",
          sources: [
            { source: "", mirrors: ["registry.local:5000/ocp-release"] }
          ]
        }
      }
    });
    const result = validateStep(state, "connectivity-mirroring");
    expect(result.errors).toContain("Source repository is required when mirror URL(s) are set.");
  });

  it("validation runs for connectivity-mirroring: no errors when source and mirrors both set", () => {
    const state = stateForConnectivityMirroringStep({
      globalStrategy: {
        ...stateForConnectivityMirroringStep().globalStrategy,
        mirroring: {
          registryFqdn: "registry.local:5000",
          sources: [
            { source: "quay.io/openshift-release-dev/ocp-release", mirrors: ["registry.local:5000/ocp-release"] }
          ]
        },
        ntpServers: ["time.corp.local"]
      }
    });
    const result = validateStep(state, "connectivity-mirroring");
    expect(result.errors).toHaveLength(0);
  });
});
