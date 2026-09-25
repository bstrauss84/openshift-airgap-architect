/**
 * OpenShift Airgap Architect - Preflight Transport Error Classification Tests
 *
 * Tests that RunOcMirrorStep's preflight error handling correctly classifies
 * network errors, backend 5xx errors, and ordinary blockers into distinct
 * user-facing messages.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

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

describe("Preflight transport error classification", () => {
  let state;

  beforeEach(() => {
    localStorage.clear();
    state = stateWithRunOcMirrorStep();
  });

  afterEach(() => {
    cleanup();
  });

  function renderStep(preflightHandler) {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") return Promise.resolve(state);
      if (path === "/api/jobs") return Promise.resolve({ jobs: [] });
      if (path === "/api/ocmirror/preflight") return preflightHandler();
      return Promise.resolve({});
    });
    return render(
      <AppProvider>
        <RunOcMirrorStep />
      </AppProvider>
    );
  }

  async function clickPreflight() {
    await waitFor(() => {
      expect(screen.getAllByTestId("run-preflight-btn").length).toBeGreaterThanOrEqual(1);
    });
    fireEvent.click(screen.getAllByTestId("run-preflight-btn")[0]);
  }

  it("network/fetch rejection shows backend-unavailable message", async () => {
    renderStep(() => Promise.reject(new TypeError("Failed to fetch")));
    await clickPreflight();

    await waitFor(() => {
      expect(screen.getByText(/Unable to contact the Airgap Architect backend/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Confirm the backend\/container is running/)).toBeInTheDocument();
  });

  it("backend 5xx shows HTTP status and message", async () => {
    const err = new Error("Bad gateway");
    err.status = 502;
    err.message = "Bad gateway";
    renderStep(() => Promise.reject(err));
    await clickPreflight();

    await waitFor(() => {
      expect(screen.getByText(/Backend error \(HTTP 502\): Bad gateway/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Check backend logs and retry/)).toBeInTheDocument();
  });

  it("ordinary preflight blocker displays blocker text", async () => {
    renderStep(() => Promise.resolve({
      ok: false,
      blockers: ["Archive path is required."],
      warnings: [],
      checks: {}
    }));
    await clickPreflight();

    await waitFor(() => {
      expect(screen.getByText("Archive path is required.")).toBeInTheDocument();
    });
    expect(screen.getByText(/Preflight blockers/)).toBeInTheDocument();
  });

  it("successful retry clears previous error", async () => {
    let callCount = 0;
    renderStep(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Promise.resolve({ ok: true, blockers: [], warnings: [], checks: {} });
    });

    await clickPreflight();
    await waitFor(() => {
      expect(screen.getByText(/Unable to contact the Airgap Architect backend/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByTestId("run-preflight-btn")[0]);
    await waitFor(() => {
      expect(screen.getByText(/Preflight passed/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Unable to contact the Airgap Architect backend/)).not.toBeInTheDocument();
  });
});
