/**
 * Regression tests: YAML preview must generate even when platform-specifics
 * has validation errors. The preview gate was removed because partial/current
 * state should always produce a best-effort preview after version lock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, waitFor, screen, fireEvent, act } from "@testing-library/react";

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
    // Release controls need real Cincinnati data: with no channels the minor
    // selector has no options, and with no versions BlueprintStep nulls out
    // release.patchVersion.
    if (String(path).startsWith("/api/cincinnati/patches")) {
      const m = String(path).match(/channel=([^&]+)/);
      const ch = m ? decodeURIComponent(m[1]) : "4.21";
      return Promise.resolve({ versions: [`${ch}.8`, `${ch}.3`] });
    }
    if (String(path).startsWith("/api/cincinnati")) {
      return Promise.resolve({ channels: ["4.20", "4.21"] });
    }
    if (path === "/api/operators/confirm") {
      // Mirrors the real endpoint: it returns the now-locked canonical version,
      // which is what re-enables preview generation after a release change.
      return Promise.resolve({
        version: { ...currentState.version, locked: true, confirmedByUser: true },
        release: { ...currentState.release, confirmed: true },
      });
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

  /**
   * Minor versions seen by POST /api/generate, in call order.
   *
   * Asserting on the *content* of the generate requests is what makes this test
   * meaningful: a bare call-count delta cannot distinguish "regenerated for the
   * new version" from "a second start-up render happened to land".
   */
  /** Minor versions the frontend has actually persisted, in call order. */
  function persistedMinors() {
    return vi.mocked(apiFetch).mock.calls
      .filter((c) => c[0] === "/api/state" && c[1]?.method === "POST" && c[1]?.body)
      .map((c) => {
        try { return JSON.parse(c[1].body)?.version?.selectedMinor ?? null; }
        catch { return null; }
      });
  }

  function generatedMinors() {
    return vi.mocked(apiFetch).mock.calls
      .filter((c) => c[0] === "/api/generate" && c[1]?.body)
      .map((c) => {
        try { return JSON.parse(c[1].body)?.state?.version?.selectedMinor ?? null; }
        catch { return null; }
      });
  }

  it("version transition 4.21 → 4.20 triggers preview regeneration", async () => {
    const state421 = makeLockedState("AWS GovCloud", "IPI", "4.21", {
      aws: { region: "us-gov-west-1" },
    });
    // Start on Blueprint: the release change is driven through the real UI.
    state421.ui.activeStepId = "blueprint";
    setupAppMock(state421);
    render(<App />);

    // Preview generated for the originally locked minor.
    await waitFor(() => {
      expect(generatedMinors()).toContain("4.21");
    }, { timeout: 3000 });

    // Real transition: unlock the release, pick 4.20, re-lock. A bare
    // rerender(<App />) cannot do this — App loads state from the store once at
    // mount, so re-rendering the same element changes no version state at all
    // and never actually exercised a transition.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Change release/i }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Yes, unlock release/i }));
    });

    // The minor selector stays disabled until the unlock has been applied;
    // firing change on a disabled control is a silent no-op.
    const channelSelect = screen.getByLabelText(/Minor channel/i);
    await waitFor(() => {
      expect(channelSelect).toBeEnabled();
    }, { timeout: 3000 });
    await act(async () => {
      fireEvent.change(channelSelect, { target: { value: "4.20" } });
    });

    // Changing the channel refetches the patch list; re-locking is rejected
    // until a patch for the new minor is resolved. Wait for that causal state
    // rather than for the button merely existing — the lock button is disabled
    // meanwhile, and clicking a disabled button is a silent no-op.
    await waitFor(() => {
      expect(screen.getByLabelText(/Patch version/i)).toHaveValue("4.20.8");
    }, { timeout: 3000 });

    // /api/operators/confirm resolves against the *persisted* state, so the new
    // minor must have reached the backend before the lock is confirmed —
    // otherwise confirm legitimately echoes back the previous version. The
    // frontend persists on a debounce, hence waiting on the POST rather than
    // on the control state alone.
    await waitFor(() => {
      expect(persistedMinors()).toContain("4.20");
    }, { timeout: 3000 });

    // Preview is gated on the version being locked, so the transition is only
    // complete once 4.20 is re-locked through the Core Lock confirmation.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Confirm & Proceed/i }));
    });
    const lockButton = await screen.findByRole("button", { name: /Yes, lock selections/i });
    await waitFor(() => {
      expect(lockButton).toBeEnabled();
    }, { timeout: 3000 });
    await act(async () => {
      fireEvent.click(lockButton);
    });

    await waitFor(() => {
      expect(generatedMinors()).toContain("4.20");
    }, { timeout: 3000 });
  });
});
