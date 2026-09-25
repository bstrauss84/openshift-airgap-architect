/**
 * Regression tests: unsupported 4.22 run import must surface a visible
 * error with the requested version and supported versions, must not
 * replace live state, and must leave the app usable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../src/api.js", async () => {
  return { apiFetch: vi.fn(() => Promise.resolve({})) };
});

const { apiFetch } = await import("../src/api.js");
const { default: App } = await import("../src/App.jsx");

function setupMock(initialState) {
  vi.mocked(apiFetch).mockImplementation((path, options) => {
    if (path === "/api/state") {
      if (options?.method === "POST") return Promise.resolve(initialState);
      return Promise.resolve(initialState);
    }
    if (path === "/api/schema/stepMap") return Promise.resolve({});
    if (path === "/api/build-info") return Promise.resolve({
      gitSha: "test", buildTime: "2026-01-01T00:00:00Z", repo: "test/repo", branch: "develop"
    });
    if (path === "/api/update-info") return Promise.resolve({ enabled: false });
    if (path === "/api/feedback/config") return Promise.resolve({ mode: "disabled" });
    if (path === "/api/generate") return Promise.resolve({ files: {} });
    if (path === "/api/run/import") {
      const body = JSON.parse(options.body);
      const version = body?.state?.version?.selectedMinor || body?.state?.release?.channel;
      if (version === "4.22") {
        const err = new Error("OpenShift version 4.22 is not supported");
        err.status = 422;
        err.payload = {
          error: "OpenShift version 4.22 is not supported",
          code: "UNSUPPORTED_VERSION",
          requestedVersion: "4.22",
          supportedVersions: ["4.20", "4.21"]
        };
        throw err;
      }
      return Promise.resolve({ state: body.state || body });
    }
    return Promise.resolve({});
  });
}

const validState = {
  blueprint: {
    arch: "x86_64", platform: "Bare Metal",
    clusterName: "test", baseDomain: "example.com", confirmed: true,
  },
  release: { channel: "4.20", patchVersion: "4.20.8", confirmed: true },
  version: { _schemaVersion: 3, selectedMinor: "4.20", selectedPatch: "4.20.8", locked: true },
  methodology: { method: "Agent-Based Installer" },
  globalStrategy: { networking: {} },
  platformConfig: {},
  hostInventory: { nodes: [], schemaVersion: 2 },
  operators: { selected: [] },
  credentials: { pullSecretPlaceholder: '{"auths":{"quay.io":{}}}', sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test" },
  trust: {},
  ui: { segmentedFlowV1: true, showLanding: false, activeStepId: "blueprint",
        visitedSteps: { blueprint: true }, completedSteps: {} },
};

if (typeof File.prototype.text !== "function") {
  File.prototype.text = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

describe("Import unsupported version error handling", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(apiFetch).mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("4.22 import surfaces visible blocked-banner mentioning 4.22 and supported versions", async () => {
    setupMock(validState);
    render(<App />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/api/state", expect.anything());
    });

    const fileInput = document.querySelector('input[type="file"][accept=".json"]');
    expect(fileInput).not.toBeNull();

    const importPayload = {
      state: {
        ...validState,
        version: { _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: "4.22.1", locked: true },
        release: { channel: "4.22", patchVersion: "4.22.1", confirmed: true },
      }
    };
    const blob = new Blob([JSON.stringify(importPayload)], { type: "application/json" });
    const file = new File([blob], "test-run.json", { type: "application/json" });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      const banner = document.querySelector('.blocked-banner');
      expect(banner).not.toBeNull();
    }, { timeout: 3000 });

    const banner = document.querySelector('.blocked-banner');
    const bannerText = banner.textContent;
    expect(bannerText).toContain("4.22");
    expect(bannerText).toContain("4.20");
    expect(bannerText).toContain("4.21");
  });

  it("4.22 import does not replace live state", async () => {
    setupMock(validState);
    render(<App />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/api/state", expect.anything());
    });

    const fileInput = document.querySelector('input[type="file"][accept=".json"]');
    const importPayload = {
      state: {
        ...validState,
        version: { _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: "4.22.1", locked: true },
        release: { channel: "4.22", patchVersion: "4.22.1", confirmed: true },
      }
    };
    const blob = new Blob([JSON.stringify(importPayload)], { type: "application/json" });
    const file = new File([blob], "test-run.json", { type: "application/json" });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      const banner = document.querySelector('.blocked-banner');
      expect(banner).not.toBeNull();
    }, { timeout: 3000 });

    const postStateCalls = vi.mocked(apiFetch).mock.calls.filter(
      c => c[0] === "/api/state" && c[1]?.method === "POST"
    );
    const any422State = postStateCalls.some(c => {
      try {
        const body = JSON.parse(c[1].body);
        return body?.version?.selectedMinor === "4.22" || body?.release?.channel === "4.22";
      } catch { return false; }
    });
    expect(any422State).toBe(false);
  });

  it("file input is reset after failed import (allows retry)", async () => {
    setupMock(validState);
    render(<App />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/api/state", expect.anything());
    });

    const fileInput = document.querySelector('input[type="file"][accept=".json"]');
    const importPayload = { state: { ...validState, version: { _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: "4.22.1", locked: true }, release: { channel: "4.22", patchVersion: "4.22.1", confirmed: true } } };
    const blob = new Blob([JSON.stringify(importPayload)], { type: "application/json" });
    const file = new File([blob], "test-run.json", { type: "application/json" });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      const banner = document.querySelector('.blocked-banner');
      expect(banner).not.toBeNull();
    }, { timeout: 3000 });

    expect(fileInput.value).toBe("");
  });

  it("fallback uses canonical SUPPORTED_MINORS when payload omits supportedVersions", async () => {
    vi.mocked(apiFetch).mockImplementation((path, options) => {
      if (path === "/api/state") return Promise.resolve(validState);
      if (path === "/api/schema/stepMap") return Promise.resolve({});
      if (path === "/api/build-info") return Promise.resolve({ gitSha: "test", buildTime: "2026-01-01T00:00:00Z", repo: "test/repo", branch: "develop" });
      if (path === "/api/update-info") return Promise.resolve({ enabled: false });
      if (path === "/api/feedback/config") return Promise.resolve({ mode: "disabled" });
      if (path === "/api/generate") return Promise.resolve({ files: {} });
      if (path === "/api/run/import") {
        const err = new Error("Unsupported version");
        err.status = 422;
        err.payload = { code: "UNSUPPORTED_VERSION", requestedVersion: "4.22" };
        throw err;
      }
      return Promise.resolve({});
    });

    render(<App />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/api/state", expect.anything());
    });

    const fileInput = document.querySelector('input[type="file"][accept=".json"]');
    const importPayload = { state: { ...validState, version: { _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: "4.22.1", locked: true }, release: { channel: "4.22", patchVersion: "4.22.1", confirmed: true } } };
    const blob = new Blob([JSON.stringify(importPayload)], { type: "application/json" });
    const file = new File([blob], "test-run.json", { type: "application/json" });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      const banner = document.querySelector('.blocked-banner');
      expect(banner).not.toBeNull();
    }, { timeout: 3000 });

    const banner = document.querySelector('.blocked-banner');
    const bannerText = banner.textContent;
    expect(bannerText).toContain("4.22");
    expect(bannerText).toContain("4.20");
    expect(bannerText).toContain("4.21");
  });

  it("generic import error also surfaces visible blocked-banner", async () => {
    vi.mocked(apiFetch).mockImplementation((path, options) => {
      if (path === "/api/state") return Promise.resolve(validState);
      if (path === "/api/schema/stepMap") return Promise.resolve({});
      if (path === "/api/build-info") return Promise.resolve({ gitSha: "test", buildTime: "2026-01-01T00:00:00Z", repo: "test/repo", branch: "develop" });
      if (path === "/api/update-info") return Promise.resolve({ enabled: false });
      if (path === "/api/feedback/config") return Promise.resolve({ mode: "disabled" });
      if (path === "/api/run/import") throw new Error("Malformed JSON");
      return Promise.resolve({});
    });

    render(<App />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/api/state", expect.anything());
    });

    const fileInput = document.querySelector('input[type="file"][accept=".json"]');
    const blob = new Blob(["not-json"], { type: "application/json" });
    const file = new File([blob], "bad.json", { type: "application/json" });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      const banner = document.querySelector('.blocked-banner');
      expect(banner).not.toBeNull();
    }, { timeout: 3000 });

    const banner = document.querySelector('.blocked-banner');
    expect(banner.textContent).toContain("Import failed");
  });
});
