import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { AppProvider } from "../src/store.jsx";
import RunOcMirrorStep from "../src/steps/RunOcMirrorStep.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

function stateWithRunOcMirrorStep(overrides = {}) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    version: { ...base.version, versionConfirmed: true },
    release: { ...base.release, confirmed: true },
    globalStrategy: {
      ...base.globalStrategy,
      mirroring: { registryFqdn: "registry.local:5000", sources: [] }
    },
    mirrorWorkflow: {
      mode: "mirrorToDisk",
      configSourceType: "generated",
      archivePath: "",
      workspacePath: "",
      cachePath: "",
      includeInExport: false
    },
    ui: {
      ...base.ui,
      segmentedFlowV1: true,
      activeStepId: "run-oc-mirror",
      visitedSteps: { ...base.ui?.visitedSteps },
      completedSteps: { ...base.ui?.completedSteps }
    },
    ...overrides
  };
}

function renderWithProvider(initialState) {
  vi.mocked(apiFetch).mockImplementation((path) => {
    if (path === "/api/state") return Promise.resolve(initialState || stateWithRunOcMirrorStep());
    if (path === "/api/jobs") return Promise.resolve({ jobs: [] });
    return Promise.resolve({});
  });
  return render(
    <AppProvider>
      <RunOcMirrorStep />
    </AppProvider>
  );
}

describe("Run oc-mirror step (v1)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/state") return Promise.resolve(stateWithRunOcMirrorStep());
      if (path === "/api/jobs") return Promise.resolve({ jobs: [] });
      return Promise.resolve({});
    });
  });
  afterEach(() => {
    cleanup();
  });

  it("renders Run oc-mirror step with mode selection and Run button disabled until preflight", async () => {
    renderWithProvider();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: /Run oc-mirror/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/Choose workflow/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Mirror to disk/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Disk to mirror/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Mirror to mirror/i })).toBeInTheDocument();
    const runButton = screen.getByRole("button", { name: /^Run oc-mirror$/i });
    expect(runButton).toBeDisabled();
  });

  it("shows Run button enabled after preflight with no blockers", async () => {
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/state") return Promise.resolve(stateWithRunOcMirrorStep());
      if (path === "/api/ocmirror/preflight") {
        return Promise.resolve({ ok: true, blockers: [], warnings: [], checks: {} });
      }
      if (path === "/api/jobs") return Promise.resolve({ jobs: [] });
      return Promise.resolve({});
    });
    render(
      <AppProvider>
        <RunOcMirrorStep />
      </AppProvider>
    );
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: /Run oc-mirror/i })).toBeInTheDocument();
    });
    const preflightButtons = screen.getAllByTestId("run-preflight-btn");
    fireEvent.click(preflightButtons[0]);
    await waitFor(() => {
      expect(screen.getByText(/Preflight passed/i)).toBeInTheDocument();
    });
    const runButtons = screen.getAllByRole("button", { name: /^Run oc-mirror$/i });
    const enabledRun = runButtons.find((b) => !b.disabled);
    expect(enabledRun).toBeDefined();
    expect(enabledRun).not.toBeDisabled();
  });
});
