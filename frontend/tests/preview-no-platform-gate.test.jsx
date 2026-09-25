/**
 * Regression tests: YAML preview must generate even when platform-specifics
 * has validation errors. The preview gate was removed because partial/current
 * state should always produce a best-effort preview after version lock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

vi.mock("../src/api.js", async () => {
  return { apiFetch: vi.fn(() => Promise.resolve({})) };
});

const { apiFetch } = await import("../src/api.js");
const { default: App } = await import("../src/App.jsx");

function setupAppMock(initialState) {
  let currentState = initialState;
  vi.mocked(apiFetch).mockImplementation((path, options) => {
    if (path === "/api/state") {
      if (options?.method === "POST") {
        currentState = JSON.parse(options.body);
        return Promise.resolve(currentState);
      }
      return Promise.resolve(currentState);
    }
    if (path === "/api/schema/stepMap") return Promise.resolve({});
    if (path === "/api/build-info") return Promise.resolve({
      gitSha: "test", buildTime: "2026-01-01T00:00:00Z", repo: "test/repo", branch: "develop"
    });
    if (path === "/api/update-info") return Promise.resolve({ enabled: false });
    if (path === "/api/feedback/config") return Promise.resolve({ mode: "disabled" });
    if (path === "/api/generate") {
      return Promise.resolve({ files: { "install-config.yaml": "apiVersion: v1\nmetadata:\n  name: test\n" } });
    }
    return Promise.resolve({});
  });
}

function makeLockedState(platform, method, minor, platformConfig) {
  return {
    blueprint: {
      arch: "x86_64", platform,
      clusterName: "test-cluster", baseDomain: "example.com", confirmed: true,
    },
    release: { channel: minor, patchVersion: minor + ".8", confirmed: true },
    version: { _schemaVersion: 3, selectedMinor: minor, selectedPatch: minor + ".8", locked: true },
    methodology: { method },
    globalStrategy: { networking: {}, mirroring: { registryFqdn: "registry.local:5000", sources: [] } },
    platformConfig: platformConfig || {},
    hostInventory: { nodes: [], schemaVersion: 2 },
    operators: { selected: [] },
    credentials: { pullSecretPlaceholder: '{"auths":{"quay.io":{}}}', sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test" },
    trust: {},
    ui: { segmentedFlowV1: true, showLanding: false, activeStepId: "platform-specifics",
          visitedSteps: { blueprint: true }, completedSteps: { blueprint: true } },
  };
}

describe("Preview generation without platform-specifics gate", () => {
  beforeEach(() => { localStorage.clear(); vi.mocked(apiFetch).mockReset(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("locked 4.20 incomplete AWS still calls /api/generate", async () => {
    const state = makeLockedState("AWS GovCloud", "IPI", "4.20", {
      aws: {},
    });
    setupAppMock(state);
    render(<App />);
    await waitFor(() => {
      const genCalls = vi.mocked(apiFetch).mock.calls.filter(c => c[0] === "/api/generate");
      expect(genCalls.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });
  });

  it("locked 4.21 incomplete AWS still calls /api/generate", async () => {
    const state = makeLockedState("AWS GovCloud", "IPI", "4.21", {
      aws: {},
    });
    setupAppMock(state);
    render(<App />);
    await waitFor(() => {
      const genCalls = vi.mocked(apiFetch).mock.calls.filter(c => c[0] === "/api/generate");
      expect(genCalls.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });
  });

  it("incomplete vSphere Platform Specifics still calls /api/generate", async () => {
    const state = makeLockedState("VMware vSphere", "IPI", "4.21", {
      vsphere: { placementMode: "legacy" },
    });
    setupAppMock(state);
    render(<App />);
    await waitFor(() => {
      const genCalls = vi.mocked(apiFetch).mock.calls.filter(c => c[0] === "/api/generate");
      expect(genCalls.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });
  });

  it("incomplete Azure BYO VNet still calls /api/generate", async () => {
    const state = makeLockedState("Azure Government", "IPI", "4.21", {
      azure: { vnetMode: "existing-vnet", virtualNetwork: "my-vnet" },
    });
    setupAppMock(state);
    render(<App />);
    await waitFor(() => {
      const genCalls = vi.mocked(apiFetch).mock.calls.filter(c => c[0] === "/api/generate");
      expect(genCalls.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });
  });

  it("version transition 4.21 → 4.20 triggers preview regeneration", async () => {
    const state421 = makeLockedState("AWS GovCloud", "IPI", "4.21", {
      aws: { region: "us-gov-west-1" },
    });
    setupAppMock(state421);
    const { rerender } = render(<App />);
    await waitFor(() => {
      const genCalls = vi.mocked(apiFetch).mock.calls.filter(c => c[0] === "/api/generate");
      expect(genCalls.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });

    const firstGenCount = vi.mocked(apiFetch).mock.calls.filter(c => c[0] === "/api/generate").length;

    const state420 = makeLockedState("AWS GovCloud", "IPI", "4.20", {
      aws: { region: "us-gov-west-1" },
    });
    vi.mocked(apiFetch).mockImplementation((path, options) => {
      if (path === "/api/state") {
        if (options?.method === "POST") return Promise.resolve(state420);
        return Promise.resolve(state420);
      }
      if (path === "/api/schema/stepMap") return Promise.resolve({});
      if (path === "/api/build-info") return Promise.resolve({ gitSha: "test", buildTime: "2026-01-01T00:00:00Z", repo: "test/repo", branch: "develop" });
      if (path === "/api/update-info") return Promise.resolve({ enabled: false });
      if (path === "/api/feedback/config") return Promise.resolve({ mode: "disabled" });
      if (path === "/api/generate") return Promise.resolve({ files: { "install-config.yaml": "apiVersion: v1\n" } });
      return Promise.resolve({});
    });
    rerender(<App />);

    await waitFor(() => {
      const genCalls = vi.mocked(apiFetch).mock.calls.filter(c => c[0] === "/api/generate");
      expect(genCalls.length).toBeGreaterThan(firstGenCount);
    }, { timeout: 3000 });
  });
});
