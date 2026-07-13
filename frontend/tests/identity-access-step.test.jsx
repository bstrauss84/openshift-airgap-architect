/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, within } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";
import { validateStep } from "../src/validation.js";
import * as catalogResolver from "../src/catalogResolver.js";
const { getScenarioId } = catalogResolver;
import { AppContext } from "../src/store.jsx";
import IdentityAccessStep from "../src/steps/IdentityAccessStep.jsx";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

function stateWithSegmentedFlow(segmentedFlowV1) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return { ...base, ui: { ...base.ui, segmentedFlowV1 } };
}

function stateWithSegmentedFlowAndIdentity(overrides = {}) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    ui: {
      ...base.ui,
      segmentedFlowV1: true,
      activeStepId: "identity-access",
      visitedSteps: { ...base.ui?.visitedSteps, blueprint: true, methodology: true, "identity-access": true },
      completedSteps: { ...base.ui?.completedSteps, blueprint: true, methodology: true }
    },
    ...overrides
  };
}

describe("Identity & Access step (Phase 5 Prompt C)", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        const body = opts?.body ? JSON.parse(opts.body) : stateWithSegmentedFlow(true);
        return Promise.resolve(body);
      }
      return Promise.resolve({});
    });
  });

  it("renders Identity & Access step with Cluster Identity and Access Credentials when segmented flow ON", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Installation Methodology/i })).toBeInTheDocument();
    });
    const proceedButtons = screen.getAllByRole("button", { name: /Proceed/i });
    fireEvent.click(proceedButtons[proceedButtons.length - 1]);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Identity & Access/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /Cluster Identity/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Access Credentials/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/example\.com/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ssh-rsa/)).toBeInTheDocument();
  });

  it("required fields (cluster name, base domain, pull secret) are validated when on identity-access", () => {
    const empty = stateWithSegmentedFlowAndIdentity({
      blueprint: { ...stateWithBlueprintCompleteMethodologyIncomplete().blueprint, clusterName: "", baseDomain: "" },
      credentials: {}
    });
    const r1 = validateStep(empty, "identity-access");
    expect(r1.errors).toContain("Cluster name is required.");
    expect(r1.errors).toContain("Base domain is required.");
    expect(r1.errors.some((e) => e.includes("Pull secret") || e.includes("pull secret"))).toBe(true);

    const withIdentity = stateWithSegmentedFlowAndIdentity({
      blueprint: { ...stateWithBlueprintCompleteMethodologyIncomplete().blueprint, clusterName: "my-cluster", baseDomain: "example.com" },
      credentials: { pullSecretPlaceholder: '{"auths":{"quay.io":{}}}', sshPublicKey: "ssh-rsa AAAA test" }
    });
    const r2 = validateStep(withIdentity, "identity-access");
    expect(r2.errors).toHaveLength(0);
  });

  it("when segmentedFlowV1 is ON and user is on identity-access, validation reflects catalog/state", () => {
    const state = stateWithSegmentedFlowAndIdentity({
      blueprint: { platform: "Bare Metal", clusterName: "agent-cluster", baseDomain: "example.com", confirmed: true, confirmationTimestamp: Date.now(), arch: "x86_64" },
      methodology: { method: "Agent-Based Installer" },
      credentials: { pullSecretPlaceholder: '{"auths":{}}', sshPublicKey: "" }
    });
    const result = validateStep(state, "identity-access");
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length >= 0).toBe(true);
  });
});

describe("IdentityAccessStep version-aware catalog access (DOC-102 Slice 5H Chunk 5)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function stateWithMinor(minor, extraOverrides = {}) {
    return stateWithSegmentedFlowAndIdentity({
      version: { selectedMinor: minor },
      credentials: {
        pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
        sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test"
      },
      ...extraOverrides
    });
  }

  function renderIdentityAccess(state) {
    const value = {
      state,
      updateState: vi.fn(),
      loading: false,
      startOver: vi.fn(),
      setState: vi.fn()
    };
    return render(
      <AppContext.Provider value={value}>
        <IdentityAccessStep />
      </AppContext.Provider>
    );
  }

  const INSTALL_CONFIG = "install-config.yaml";

  const SYNTHETIC_CATALOG = [
    { path: "metadata.name", outputFile: INSTALL_CONFIG, supportStatus: "supported-derived", minVersion: "4.20", maxVersion: null, type: "string", required: true, default: "agent-cluster", description: "Cluster name" },
    { path: "baseDomain", outputFile: INSTALL_CONFIG, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, type: "string", required: true, default: "not specified in docs", description: "Base domain" },
    { path: "pullSecret", outputFile: INSTALL_CONFIG, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, type: "string", required: true, default: "not specified in docs", description: "Pull secret" },
    { path: "sshKey", outputFile: INSTALL_CONFIG, supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, type: "string", required: false, default: "not specified in docs", description: "SSH public key" },
    { path: "fips", outputFile: INSTALL_CONFIG, supportStatus: "supported-backend-only", minVersion: "4.20", maxVersion: null, type: "boolean", required: false, default: false, description: "FIPS mode" },
  ];

  it("requests catalog with '4.20' when state has selectedMinor 4.20", () => {
    const spy = vi.spyOn(catalogResolver, "getCatalogForScenario");
    const state = stateWithMinor("4.20");
    renderIdentityAccess(state);
    const catalogCall = spy.mock.calls.find(c => c[0] === getScenarioId(state));
    expect(catalogCall).toBeDefined();
    expect(catalogCall[1]).toBe("4.20");
  });

  it("requests catalog with '4.21' when state has selectedMinor 4.21", () => {
    const spy = vi.spyOn(catalogResolver, "getCatalogForScenario");
    const state = stateWithMinor("4.21");
    renderIdentityAccess(state);
    const catalogCall = spy.mock.calls.find(c => c[0] === getScenarioId(state));
    expect(catalogCall).toBeDefined();
    expect(catalogCall[1]).toBe("4.21");
  });

  it("passes explicit 4.22 to getCatalogForScenario without downgrading", () => {
    const catalogSpy = vi
      .spyOn(catalogResolver, "getCatalogForScenario")
      .mockReturnValue([]);
    vi.spyOn(catalogResolver, "getParamMeta").mockReturnValue(undefined);
    const state = stateWithMinor("4.22");
    renderIdentityAccess(state);
    const catalogCall = catalogSpy.mock.calls.find(
      (call) => call[0] === getScenarioId(state)
    );
    expect(catalogCall).toBeDefined();
    expect(catalogCall[1]).toBe("4.22");
    expect(catalogCall[1]).not.toBe("4.20");
    expect(catalogCall[1]).not.toBe("4.21");
  });

  it("passes state as fourth argument to every getParamMeta call", () => {
    const metaSpy = vi.spyOn(catalogResolver, "getParamMeta");
    const state = stateWithMinor("4.20");
    renderIdentityAccess(state);
    expect(metaSpy.mock.calls.length).toBeGreaterThan(0);
    for (const call of metaSpy.mock.calls) {
      expect(call[3]).toBe(state);
    }
  });

  it("baseDomain with minVersion 4.21 is absent at selected minor 4.20", () => {
    const catalog = SYNTHETIC_CATALOG.map(entry =>
      entry.path === "baseDomain"
        ? { ...entry, minVersion: "4.21" }
        : entry
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateWithMinor("4.20");
    renderIdentityAccess(state);
    expect(screen.queryByPlaceholderText("example.com")).not.toBeInTheDocument();
  });

  it("baseDomain with minVersion 4.21 is present at selected minor 4.21", () => {
    const catalog = SYNTHETIC_CATALOG.map(entry =>
      entry.path === "baseDomain"
        ? { ...entry, minVersion: "4.21" }
        : entry
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateWithMinor("4.21");
    renderIdentityAccess(state);
    expect(screen.getByPlaceholderText("example.com")).toBeInTheDocument();
  });

  it("supported-ui sibling remains visible when baseDomain is version-gated", () => {
    const catalog = SYNTHETIC_CATALOG.map(entry =>
      entry.path === "baseDomain"
        ? { ...entry, minVersion: "4.21" }
        : entry
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateWithMinor("4.20");
    renderIdentityAccess(state);
    expect(screen.getByPlaceholderText("ssh-rsa AAAA...")).toBeInTheDocument();
  });

  it("baseDomain with supported-backend-only is absent even when in version range", () => {
    const catalog = SYNTHETIC_CATALOG.map(entry =>
      entry.path === "baseDomain"
        ? { ...entry, supportStatus: "supported-backend-only" }
        : entry
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateWithMinor("4.21");
    renderIdentityAccess(state);
    expect(screen.queryByPlaceholderText("example.com")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("ssh-rsa AAAA...")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Identity & Access/i })).toBeInTheDocument();
  });

  it("omitted catalog field does not render while retained sibling renders", () => {
    const catalog = SYNTHETIC_CATALOG.filter(entry => entry.path !== "baseDomain");
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateWithMinor("4.20");
    renderIdentityAccess(state);
    expect(screen.queryByPlaceholderText("example.com")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("ssh-rsa AAAA...")).toBeInTheDocument();
  });

  it("Cluster Name and FIPS remain visible with synthetic non-renderable statuses", () => {
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(SYNTHETIC_CATALOG);
    const state = stateWithMinor("4.20");
    renderIdentityAccess(state);
    expect(screen.getByPlaceholderText("agent-cluster")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Security Compliance/i })).toBeInTheDocument();
    const secSection = screen.getByRole("heading", { name: /Security Compliance/i }).closest("section");
    expect(within(secSection).getByRole("switch")).toBeInTheDocument();
  });

  it.each(["4.20", "4.21"])("Cluster Name and FIPS remain visible with real catalog %s", (minor) => {
    const state = stateWithMinor(minor);
    renderIdentityAccess(state);
    expect(screen.getByPlaceholderText("agent-cluster")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Security Compliance/i })).toBeInTheDocument();
    const secSection = screen.getByRole("heading", { name: /Security Compliance/i }).closest("section");
    expect(within(secSection).getByRole("switch")).toBeInTheDocument();
  });

  it("Access Credentials heading absent when both pullSecret and sshKey are non-renderable", () => {
    const catalog = SYNTHETIC_CATALOG.map(entry =>
      (entry.path === "pullSecret" || entry.path === "sshKey")
        ? { ...entry, supportStatus: "supported-backend-only" }
        : entry
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateWithMinor("4.20", {
      credentials: {
        sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test",
        pullSecretPlaceholder: '{"auths":{"quay.io":{}}}'
      }
    });
    renderIdentityAccess(state);
    expect(screen.queryByRole("heading", { name: /Access Credentials/i })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("agent-cluster")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Security Compliance/i })).toBeInTheDocument();
    const secSection = screen.getByRole("heading", { name: /Security Compliance/i }).closest("section");
    expect(within(secSection).getByRole("switch")).toBeInTheDocument();
    expect(state.credentials.sshPublicKey).toBe("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test");
    expect(state.credentials.pullSecretPlaceholder).toBe('{"auths":{"quay.io":{}}}');
  });

  it.each(["4.20", "4.21"])("real catalog %s: principal Identity and Access controls render", (minor) => {
    const state = stateWithMinor(minor);
    renderIdentityAccess(state);
    expect(screen.getByPlaceholderText("agent-cluster")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("example.com")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ssh-rsa AAAA...")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Red Hat pull secret/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Security Compliance/i })).toBeInTheDocument();
    const secSection = screen.getByRole("heading", { name: /Security Compliance/i }).closest("section");
    expect(within(secSection).getByRole("switch")).toBeInTheDocument();
  });
});
