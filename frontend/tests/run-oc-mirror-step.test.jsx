/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
      const headings = screen.getAllByRole("heading", { level: 2, name: /Run oc-mirror/i });
      expect(headings.length).toBeGreaterThanOrEqual(1);
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

/* ------------------------------------------------------------------ */
/* Stale job polling terminates on 404 (v2.1 Tranche 7C.3)             */
/* ------------------------------------------------------------------ */

import { isJobGone, allJobsSettled, isTerminalJobStatus } from "../src/shared/jobPolling.js";

describe("T7C.3 — job polling stops when the job is gone", () => {
  /**
   * WHAT A HUMAN SAW. The browser console filled with
   * `GET /api/jobs/<old-id> 404 Job not found` for the same few IDs, repeating
   * every couple of seconds and never stopping.
   *
   * MECHANISM. This step's `setInterval` called `apiFetch(...).then(...)` with
   * NO `.catch`, so a missing job produced an unhandled rejection twice a
   * second for as long as the step was mounted, and nothing ever cleared
   * `runningJobId`. `OperatorsStep` had the mirror-image bug: `catch { ignore }`
   * meant a 404 recorded no status, so its "all done" predicate could never
   * become true and it re-armed every 4 seconds until a 10-minute cap.
   *
   * CONTRACT. A 404 for a job we were already polling is TERMINAL. A network
   * error or 5xx is not — those stay retryable, because treating them as
   * terminal would abandon a run that is still going.
   */
  describe("the shared predicate", () => {
    it("treats 404 as gone", () => {
      expect(isJobGone({ status: 404 })).toBe(true);
    });

    it("does NOT treat transient failures as gone", () => {
      // The important half: a blip must not abandon a running mirror job.
      for (const status of [500, 502, 503, 504, 429, undefined]) {
        expect(isJobGone({ status }), `status ${status} must stay retryable`).toBe(false);
      }
      expect(isJobGone(new Error("network down"))).toBe(false);
      expect(isJobGone(null)).toBe(false);
    });

    it("knows which statuses are final", () => {
      for (const s of ["completed", "completed_with_warnings", "failed", "cancelled"]) {
        expect(isTerminalJobStatus(s)).toBe(true);
      }
      for (const s of ["running", "queued", "pending", undefined]) {
        expect(isTerminalJobStatus(s)).toBe(false);
      }
    });
  });

  describe("multi-job settling", () => {
    const statuses = (map) => (id) => map[id];

    it("a gone job no longer blocks settling — the operator-scan defect", () => {
      // Before the fix this returned false forever, which is what kept the
      // 4-second loop alive.
      expect(allJobsSettled(["a", "b"], statuses({ a: "completed" }), new Set(["b"]))).toBe(true);
    });

    it("a still-running job keeps polling alive", () => {
      expect(allJobsSettled(["a", "b"], statuses({ a: "completed", b: "running" }), new Set())).toBe(false);
    });

    it("an unknown-status job keeps polling alive", () => {
      // Not gone, just no answer yet. Must NOT settle.
      expect(allJobsSettled(["a"], statuses({}), new Set())).toBe(false);
    });

    it("all gone settles", () => {
      expect(allJobsSettled(["a", "b"], statuses({}), new Set(["a", "b"]))).toBe(true);
    });

    it("completed and failed both settle", () => {
      expect(allJobsSettled(["a", "b"], statuses({ a: "completed", b: "failed" }), new Set())).toBe(true);
    });
  });

  /**
   * NOT COVERED HERE, deliberately and stated rather than faked: the
   * 2-second `setInterval` in RunOcMirrorStep only arms once `runningJobId`
   * is set by actually starting a mirror run, which a mounted-component test
   * cannot reach without a full run flow. An earlier version of this file
   * asserted that path and PASSED with the fix reverted — it was exercising
   * the one-shot `lastRunJobId` effect instead. The behavioural core of the
   * fix is the predicate above, and the operator-scan loop that a human
   * actually hit is covered end-to-end in
   * `tests/operator-scan-stale-job-polling.test.jsx`.
   */
});
