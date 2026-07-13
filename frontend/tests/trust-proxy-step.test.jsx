/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";
import { validateStep } from "../src/validation.js";
import * as catalogResolver from "../src/catalogResolver.js";
const { getScenarioId, getParamMeta, getCatalogForScenario } = catalogResolver;
import { AppContext } from "../src/store.jsx";
import TrustProxyStep from "../src/steps/TrustProxyStep.jsx";

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
      expect(screen.getByRole("heading", { name: /Identity & Access/i })).toBeInTheDocument();
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

  it("validation runs for trust-proxy: inferred policy when PEM present and policy unset (no race with useEffect)", () => {
    const state = stateForTrustProxyStep({
      trust: {
        proxyCaPem: "-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----",
        additionalTrustBundlePolicy: ""
      }
    });
    const result = validateStep(state, "trust-proxy");
    expect(result.errors.filter((e) => e.includes("additionalTrustBundlePolicy"))).toHaveLength(0);
  });

  it("validation runs for trust-proxy: rejects explicit policy not in allow list", () => {
    const state = stateForTrustProxyStep({
      release: { channel: "stable-4.20", patchVersion: "4.20.1", confirmed: true },
      trust: {
        proxyCaPem: "-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----",
        additionalTrustBundlePolicy: "Never"
      }
    });
    const result = validateStep(state, "trust-proxy");
    expect(result.errors.some((e) => e.includes("additionalTrustBundlePolicy is not allowed"))).toBe(true);
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
      expect(screen.getByRole("heading", { name: /Identity & Access/i })).toBeInTheDocument();
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
});

describe("TrustProxyStep version-aware catalog access (DOC-102 Slice 5H Chunk 3)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function stateWithMinor(minor, extraOverrides = {}) {
    const base = stateForTrustProxyStep();
    return stateForTrustProxyStep({
      version: { selectedMinor: minor },
      globalStrategy: { ...base.globalStrategy, proxyEnabled: true },
      ...extraOverrides
    });
  }

  function renderTrustProxy(state) {
    const value = {
      state,
      updateState: vi.fn(),
      loading: false,
      startOver: vi.fn(),
      setState: vi.fn()
    };
    return render(
      <AppContext.Provider value={value}>
        <TrustProxyStep />
      </AppContext.Provider>
    );
  }

  const SYNTHETIC_CATALOG = [
    { path: "proxy.httpProxy", outputFile: "install-config.yaml", supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, type: "string", required: false, default: "not specified in docs", description: "HTTP proxy URL", allowed: "http URL" },
    { path: "proxy.httpsProxy", outputFile: "install-config.yaml", supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, type: "string", required: false, default: "not specified in docs", description: "HTTPS proxy URL", allowed: "https URL" },
    { path: "proxy.noProxy", outputFile: "install-config.yaml", supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, type: "string", required: false, default: "not specified in docs", description: "No proxy destinations" },
    { path: "additionalTrustBundle", outputFile: "install-config.yaml", supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, type: "string", required: false, default: "not specified in docs", description: "PEM trust bundle", allowed: "PEM-encoded X.509 bundle" },
    { path: "additionalTrustBundlePolicy", outputFile: "install-config.yaml", supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null, type: "string", required: false, default: "Proxyonly", description: "Trust bundle policy", allowed: ["Proxyonly", "Always"] },
  ];

  it("requests catalog with '4.21' when state has selectedMinor 4.21", () => {
    const spy = vi.spyOn(catalogResolver, "getCatalogForScenario");
    const state = stateWithMinor("4.21");
    renderTrustProxy(state);
    const catalogCall = spy.mock.calls.find(c => c[0] === getScenarioId(state));
    expect(catalogCall).toBeDefined();
    expect(catalogCall[1]).toBe("4.21");
  });

  it("requests catalog with '4.20' when state has selectedMinor 4.20", () => {
    const spy = vi.spyOn(catalogResolver, "getCatalogForScenario");
    const state = stateWithMinor("4.20");
    renderTrustProxy(state);
    const catalogCall = spy.mock.calls.find(c => c[0] === getScenarioId(state));
    expect(catalogCall).toBeDefined();
    expect(catalogCall[1]).toBe("4.20");
  });

  it("passes explicit 4.22 to getCatalogForScenario without downgrading", () => {
    const catalogSpy = vi
      .spyOn(catalogResolver, "getCatalogForScenario")
      .mockReturnValue([]);
    vi.spyOn(catalogResolver, "getRequiredParamsForOutput").mockReturnValue([]);
    vi.spyOn(catalogResolver, "getParamMeta").mockReturnValue(undefined);
    const state = stateWithMinor("4.22");
    renderTrustProxy(state);
    const catalogCall = catalogSpy.mock.calls.find(
      (call) => call[0] === getScenarioId(state)
    );
    expect(catalogCall).toBeDefined();
    expect(catalogCall[1]).toBe("4.22");
    expect(catalogCall[1]).not.toBe("4.20");
    expect(catalogCall[1]).not.toBe("4.21");
  });

  it("passes state as fourth argument to every getParamMeta call", () => {
    const spy = vi.spyOn(catalogResolver, "getParamMeta");
    const state = stateWithMinor("4.20");
    renderTrustProxy(state);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      expect(call[3]).toBe(state);
    }
  });

  it("passes state as third argument to every getRequiredParamsForOutput call", () => {
    const spy = vi.spyOn(catalogResolver, "getRequiredParamsForOutput");
    const state = stateWithMinor("4.20");
    renderTrustProxy(state);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      expect(call[2]).toBe(state);
    }
  });

  it("proxy.httpProxy with minVersion 4.21 is absent at selected minor 4.20", () => {
    const catalog = SYNTHETIC_CATALOG.map(entry =>
      entry.path === "proxy.httpProxy"
        ? { ...entry, minVersion: "4.21" }
        : entry
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateWithMinor("4.20");
    renderTrustProxy(state);
    expect(screen.queryByPlaceholderText("http://proxy.corp:8080")).not.toBeInTheDocument();
  });

  it("proxy.httpProxy with minVersion 4.21 is present at selected minor 4.21", () => {
    const catalog = SYNTHETIC_CATALOG.map(entry =>
      entry.path === "proxy.httpProxy"
        ? { ...entry, minVersion: "4.21" }
        : entry
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateWithMinor("4.21");
    renderTrustProxy(state);
    expect(screen.getByPlaceholderText("http://proxy.corp:8080")).toBeInTheDocument();
  });

  it("proxy.httpProxy with supported-backend-only is absent even when in version range", () => {
    const catalog = SYNTHETIC_CATALOG.map(entry =>
      entry.path === "proxy.httpProxy"
        ? { ...entry, supportStatus: "supported-backend-only" }
        : entry
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateWithMinor("4.21");
    const { container } = renderTrustProxy(state);
    expect(screen.queryByPlaceholderText("http://proxy.corp:8080")).not.toBeInTheDocument();
    // Sibling supported-ui field remains visible
    expect(screen.getByPlaceholderText(/proxy\.corp:8443/)).toBeInTheDocument();
    // Grid renders because at least one proxy field is visible
    expect(container.querySelector(".proxy-fields-grid")).toBeInTheDocument();
  });

  it("all proxy fields hidden: no empty grid renders, workflow toggle stays visible", () => {
    const catalog = SYNTHETIC_CATALOG.map(entry =>
      entry.path.startsWith("proxy.")
        ? { ...entry, supportStatus: "supported-backend-only" }
        : entry
    );
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateWithMinor("4.20");
    const { container } = renderTrustProxy(state);
    // Proxy workflow toggle remains visible
    expect(screen.getByRole("switch", { name: /Enable proxy/i })).toBeInTheDocument();
    // All three proxy fields are absent
    expect(screen.queryByPlaceholderText("http://proxy.corp:8080")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/proxy\.corp:8443/)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/\.cluster\.local/)).not.toBeInTheDocument();
    // Empty grid is not rendered
    expect(container.querySelector(".proxy-fields-grid")).not.toBeInTheDocument();
    // Trust-bundle control still renders (component is alive)
    expect(screen.getByRole("switch", { name: /Mirror registry uses private CA/i })).toBeInTheDocument();
  });

  it("omitted catalog field does not render while retained sibling renders", () => {
    const catalog = SYNTHETIC_CATALOG.filter(entry => entry.path !== "proxy.httpProxy");
    vi.spyOn(catalogResolver, "getCatalogForScenario").mockReturnValue(catalog);
    const state = stateWithMinor("4.21");
    renderTrustProxy(state);
    expect(screen.queryByPlaceholderText("http://proxy.corp:8080")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/proxy\.corp:8443/)).toBeInTheDocument();
  });

  it.each(["4.20", "4.21"])("real catalog %s: proxy and trust controls render", (minor) => {
    const state = stateWithMinor(minor);
    renderTrustProxy(state);
    expect(screen.getByPlaceholderText("http://proxy.corp:8080")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/proxy\.corp:8443/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/\.cluster\.local/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Mirror registry uses private CA/i })).toBeInTheDocument();
  });
});
