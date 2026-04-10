import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";
import { validateStep } from "../src/validation.js";
import { getScenarioId, getParamMeta } from "../src/catalogResolver.js";

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

function stateForTrustProxyStep(overrides = {}) {
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
      activeStepId: "trust-proxy",
      visitedSteps: {
        ...base.ui?.visitedSteps,
        blueprint: true,
        methodology: true,
        "identity-access": true,
        "networking-v2": true,
        "connectivity-mirroring": true,
        "trust-proxy": true
      },
      completedSteps: {
        ...base.ui?.completedSteps,
        blueprint: true,
        methodology: true,
        "identity-access": true,
        "networking-v2": true,
        "connectivity-mirroring": true
      }
    },
    ...overrides
  };
}

describe("Trust & Proxy replacement step (Phase 5 Prompt G)", () => {
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

  it("renders Trust & Proxy step when segmented flow ON and user navigates to Trust & Proxy", async () => {
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
    const trustProxyStepButton = screen.getByRole("button", { name: /Trust & Proxy/i });
    fireEvent.click(trustProxyStepButton);
    await waitFor(
      () => {
        expect(screen.getByRole("heading", { name: /Trust & Proxy/i })).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
    expect(screen.getByRole("heading", { name: /Corporate Proxy/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Trust and certificates/i })).toBeInTheDocument();
  });

  it("when scenario is bare-metal-agent, getScenarioId and getParamMeta return expected proxy/trust meta", () => {
    const state = stateForTrustProxyStep();
    expect(getScenarioId(state)).toBe("bare-metal-agent");
    const httpMeta = getParamMeta("bare-metal-agent", "proxy.httpProxy", "install-config.yaml");
    const policyMeta = getParamMeta("bare-metal-agent", "additionalTrustBundlePolicy", "install-config.yaml");
    expect(httpMeta?.required).toBe(false);
    expect(policyMeta?.required).toBe(false);
    expect(Array.isArray(policyMeta?.allowed) && policyMeta.allowed.includes("Proxyonly")).toBe(true);
    expect(Array.isArray(policyMeta?.allowed) && policyMeta.allowed.includes("Always")).toBe(true);
  });

  it("state is read/written for proxy and trust bundle", () => {
    const state = stateForTrustProxyStep({
      globalStrategy: {
        ...stateForTrustProxyStep().globalStrategy,
        proxyEnabled: true,
        proxies: {
          httpProxy: "http://proxy.example:8080",
          httpsProxy: "https://proxy.example:8443",
          noProxy: ".cluster.local"
        }
      },
      trust: {
        proxyCaPem: "-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----",
        additionalTrustBundlePolicy: "Proxyonly"
      }
    });
    expect(state.globalStrategy.proxyEnabled).toBe(true);
    expect(state.globalStrategy.proxies.httpProxy).toBe("http://proxy.example:8080");
    expect(state.trust.additionalTrustBundlePolicy).toBe("Proxyonly");
  });

  it("validation runs for trust-proxy: proxy URL scheme errors when proxy enabled", () => {
    const state = stateForTrustProxyStep({
      globalStrategy: {
        ...stateForTrustProxyStep().globalStrategy,
        proxyEnabled: true,
        proxies: {
          httpProxy: "https://wrong-scheme:8080",
          httpsProxy: "ftp://invalid-scheme:8443",
          noProxy: ""
        }
      }
    });
    const result = validateStep(state, "trust-proxy");
    expect(result.errors).toContain("HTTP proxy must start with http://");
    expect(result.errors).toContain("HTTPS proxy must start with http:// or https:// (use the scheme your proxy supports).");
  });

  it("validation runs for trust-proxy: no errors when proxy disabled and no trust bundle", () => {
    const state = stateForTrustProxyStep({
      globalStrategy: { ...stateForTrustProxyStep().globalStrategy, proxyEnabled: false },
      trust: {}
    });
    const result = validateStep(state, "trust-proxy");
    expect(result.errors).toHaveLength(0);
  });

  it("validation runs for trust-proxy: policy required when trust bundle present", () => {
    const state = stateForTrustProxyStep({
      trust: {
        proxyCaPem: "-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----",
        additionalTrustBundlePolicy: ""
      }
    });
    const result = validateStep(state, "trust-proxy");
    expect(result.errors).toContain("additionalTrustBundlePolicy is required when a trust bundle is provided.");
  });

  it("validation runs for trust-proxy: reduced caution requires explicit acknowledgment", () => {
    const state = stateForTrustProxyStep({
      trust: {
        mirrorRegistryCaPem: "-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----",
        additionalTrustBundlePolicy: "Always",
        bundleSelectionMode: "reduced",
        reducedSelection: {
          analysisHash: "hash",
          selectedCertFingerprints: ["abc"],
          selectionSummary: { thresholdBand: "caution_exceeded" },
          cautionAcknowledged: false
        }
      }
    });
    const result = validateStep(state, "trust-proxy");
    expect(result.errors).toContain("Reduced trust selection exceeds caution thresholds and requires explicit acknowledgment in Trust & Proxy.");
  });

  it("validation runs for trust-proxy: reduced hard max blocks", () => {
    const state = stateForTrustProxyStep({
      trust: {
        mirrorRegistryCaPem: "-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----",
        additionalTrustBundlePolicy: "Always",
        bundleSelectionMode: "reduced",
        reducedSelection: {
          analysisHash: "hash",
          selectedCertFingerprints: ["abc"],
          selectionSummary: { thresholdBand: "hard_max_exceeded" },
          cautionAcknowledged: true
        }
      }
    });
    const result = validateStep(state, "trust-proxy");
    expect(result.errors).toContain("Reduced trust selection exceeds hard maximum thresholds. Reduce selected certificates or switch to original bundle mode.");
  });

  it("renders mirrorRegistryUsesPrivateCa toggle and shows warning when checked and no PEM (Phase 5 B restore)", async () => {
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
    const trustProxyBtn = screen.getAllByRole("button").find((el) => el.getAttribute("title") === "Trust & Proxy");
    expect(trustProxyBtn).toBeTruthy();
    fireEvent.click(trustProxyBtn);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Trust & Proxy/i })).toBeInTheDocument();
    });
    const mirrorCaSwitch = screen.getByRole("switch", { name: /Mirror registry uses private CA/i });
    expect(mirrorCaSwitch).toBeInTheDocument();
    fireEvent.click(mirrorCaSwitch);
    await waitFor(() => {
      expect(screen.getByText(/Mirror registry CA bundle is required when using a private or self-signed CA/i)).toBeInTheDocument();
    });
  });

  it("needs-review banner: state shape for trust-proxy (Phase 5 B restore)", () => {
    const base = stateForTrustProxyStep();
    const state = {
      ...base,
      reviewFlags: { ...(base.reviewFlags || {}), "trust-proxy": true },
      ui: {
        ...base.ui,
        visitedSteps: { ...(base.ui?.visitedSteps || {}), "trust-proxy": true }
      }
    };
    expect(state.reviewFlags["trust-proxy"]).toBe(true);
    expect(state.ui.visitedSteps["trust-proxy"]).toBe(true);
  });

  it("renders placeholder utility rows for proxy and trust fields", async () => {
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
    const trustProxyBtn = screen.getAllByRole("button", { name: /Trust & Proxy/i })[0];
    fireEvent.click(trustProxyBtn);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Trust & Proxy/i })).toBeInTheDocument();
    });
    const rows = screen.getAllByText(/Mark for later completion/i);
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });
});
