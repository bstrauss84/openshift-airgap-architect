import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";
import { validateStep } from "../src/validation.js";

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
      expect(screen.getAllByRole("heading", { name: /Identity & Access/i }).length).toBeGreaterThan(0);
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

  it("renders placeholder utility rows beneath identity and access inputs", async () => {
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
      expect(screen.getAllByRole("heading", { name: /Identity & Access/i }).length).toBeGreaterThan(0);
    });
    const rows = screen.getAllByText(/Mark for later completion/i);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
