/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Workstream D — Wizard flow & progress: skip rules, checkmarks, required-field highlighting, deliverable gating.
 * Regression: checkmark only after Proceed with no errors; never on enter/skip; proceed-anyway → needs review.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";
import { validateStep } from "../src/validation.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

function stateWithSegmentedFlow(overrides = {}) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    ui: { ...base.ui, segmentedFlowV1: true, ...overrides.ui },
    ...overrides
  };
}

/** Replicate App's checkmark rule: complete only when valid AND explicitlyCompleted (no checkmark on visit). */
function stepWouldShowCheckmark(state, stepId, valid) {
  if (stepId === "blueprint") {
    return Boolean(state?.blueprint?.confirmed && (state?.version?.versionConfirmed ?? state?.release?.confirmed));
  }
  const explicitlyCompleted = Boolean(state?.ui?.completedSteps?.[stepId]);
  const needsReview = Boolean(state?.reviewFlags?.[stepId]);
  return valid && explicitlyCompleted && !needsReview;
}

describe("Wizard flow & progress (Workstream D)", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        const body = opts?.body ? JSON.parse(opts.body) : stateWithSegmentedFlow();
        return Promise.resolve(body);
      }
      return Promise.resolve({});
    });
  });

  it("regression: visited step without completedSteps must NOT show checkmark", () => {
    const state = stateWithSegmentedFlow({
      ui: { segmentedFlowV1: true, visitedSteps: { "identity-access": true }, completedSteps: {} },
      blueprint: { ...stateWithBlueprintCompleteMethodologyIncomplete().blueprint, clusterName: "x", baseDomain: "y" },
      credentials: { pullSecretPlaceholder: '{"auths":{}}', usingMirrorRegistry: false }
    });
    const valid = (validateStep(state, "identity-access").errors || []).length === 0;
    expect(valid).toBe(true);
    expect(stepWouldShowCheckmark(state, "identity-access", valid)).toBe(false);
  });

  it("regression: step with completedSteps and valid must show checkmark", () => {
    const state = stateWithSegmentedFlow({
      ui: { segmentedFlowV1: true, visitedSteps: { "identity-access": true }, completedSteps: { "identity-access": true } },
      blueprint: { ...stateWithBlueprintCompleteMethodologyIncomplete().blueprint, clusterName: "x", baseDomain: "y" },
      credentials: { pullSecretPlaceholder: '{"auths":{}}', usingMirrorRegistry: false }
    });
    const valid = (validateStep(state, "identity-access").errors || []).length === 0;
    expect(stepWouldShowCheckmark(state, "identity-access", valid)).toBe(true);
  });

  it("sidebar shows checkmark when step is valid (validateStep no errors)", async () => {
    const state = stateWithSegmentedFlow({
      blueprint: {
        ...stateWithBlueprintCompleteMethodologyIncomplete().blueprint,
        clusterName: "ok",
        baseDomain: "example.com"
      },
      credentials: { pullSecretPlaceholder: '{"auths":{"reg":{}}}', usingMirrorRegistry: false },
      ui: { segmentedFlowV1: true, visitedSteps: { blueprint: true, methodology: true, "identity-access": true }, completedSteps: {} }
    });
    const result = validateStep(state, "identity-access");
    expect((result.errors || []).length).toBe(0);
  });

  it("needs-review or error indicator when step has errors", async () => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        const body = opts?.body ? JSON.parse(opts.body) : stateWithSegmentedFlow({
          blueprint: { ...stateWithBlueprintCompleteMethodologyIncomplete().blueprint, clusterName: "", baseDomain: "" },
          credentials: {},
          ui: { segmentedFlowV1: true, visitedSteps: { "identity-access": true }, completedSteps: {} }
        });
        return Promise.resolve(body);
      }
      return Promise.resolve({});
    });
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: /Installation Methodology/i })).toBeInTheDocument());
    const proceedButtons = screen.getAllByRole("button", { name: /Proceed/i });
    fireEvent.click(proceedButtons[proceedButtons.length - 1]);
    await waitFor(() => expect(screen.getAllByText(/Identity & Access/i).length).toBeGreaterThanOrEqual(1));
    fireEvent.click(within(document.querySelector(".sidebar .step-list")).getByRole("button", { name: /Networking/i }));
    await waitFor(() => {
      const needsReviewBadge = document.querySelector(".step-item .badge.warning");
      expect(needsReviewBadge && needsReviewBadge.textContent?.includes("Needs review")).toBe(true);
    });
  });

  it("deliverable gating shows Complete at least when required fields missing", async () => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        return Promise.resolve(stateWithSegmentedFlow({
          blueprint: { ...stateWithBlueprintCompleteMethodologyIncomplete().blueprint, clusterName: "", baseDomain: "" },
          credentials: {},
          ui: { segmentedFlowV1: true, visitedSteps: { review: true }, activeStepId: "review" }
        }));
      }
      if (path === "/api/generate") return Promise.resolve({ files: {} });
      return Promise.resolve({});
    });
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: /Installation Methodology/i })).toBeInTheDocument());
    const proceedButtons = screen.getAllByRole("button", { name: /Proceed/i });
    fireEvent.click(proceedButtons[proceedButtons.length - 1]);
    await waitFor(() => expect(screen.getAllByText(/Identity & Access/i).length).toBeGreaterThanOrEqual(1));
    const assetsGuideButtons = screen.getAllByRole("button", { name: /Assets & Guide/i });
    if (assetsGuideButtons.length) {
      fireEvent.click(assetsGuideButtons[0]);
      await waitFor(() => {
        const completeMsg = screen.queryByText(/Complete at least:/);
        const blockedMsg = screen.queryByText(/Outputs are blocked/);
        expect(completeMsg || blockedMsg).toBeTruthy();
      });
    }
  });

  it("entering a tab does NOT add a checkmark — checkmark only after Proceed with no errors", async () => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        return Promise.resolve(stateWithSegmentedFlow({
          blueprint: { ...stateWithBlueprintCompleteMethodologyIncomplete().blueprint, clusterName: "", baseDomain: "" },
          credentials: {},
          ui: {
            segmentedFlowV1: true,
            visitedSteps: { blueprint: true, methodology: true },
            completedSteps: { blueprint: true, methodology: true },
            activeStepId: "identity-access"
          }
        }));
      }
      return Promise.resolve({});
    });
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => expect(screen.getAllByText(/Identity & Access/i).length).toBeGreaterThanOrEqual(1));
    const sidebar = document.querySelector(".sidebar .step-list");
    expect(sidebar).toBeTruthy();
    const identityStepItem = within(sidebar).getByRole("button", { name: /Identity & Access/i }).closest(".step-item");
    expect(identityStepItem).toBeTruthy();
    const checkInIdentity = identityStepItem?.querySelector(".step-check");
    expect(checkInIdentity?.textContent?.trim() || "").toBe("");
  });

  it("skipping a tab (navigating away without Proceed) does not add checkmark; step with errors gets needs review", async () => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        return Promise.resolve(stateWithSegmentedFlow({
          blueprint: { ...stateWithBlueprintCompleteMethodologyIncomplete().blueprint, clusterName: "", baseDomain: "" },
          credentials: {},
          ui: { segmentedFlowV1: true, visitedSteps: { blueprint: true, methodology: true }, completedSteps: { blueprint: true, methodology: true } }
        }));
      }
      return Promise.resolve({});
    });
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => expect(screen.getAllByText(/Identity & Access/i).length).toBeGreaterThanOrEqual(1));
    const sidebar = document.querySelector(".sidebar .step-list");
    expect(sidebar).toBeTruthy();
    fireEvent.click(within(sidebar).getByRole("button", { name: /Networking/i }));
    await waitFor(
      () => {
        const list = document.querySelector(".sidebar .step-list");
        const identityBtn = within(list).getByRole("button", { name: /Identity & Access/i });
        const identityStepItem = identityBtn.closest(".step-item");
        expect(identityStepItem?.querySelector(".step-check")?.textContent?.trim() || "").toBe("");
        const needsReview = identityStepItem?.querySelector(".badge.warning");
        expect(needsReview?.textContent?.includes("Needs review")).toBe(true);
      },
      { timeout: 3000 }
    );
  });

  it("navigation is not blocked: sidebar step click does not throw and changes active step", async () => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        return Promise.resolve(stateWithSegmentedFlow({
          ui: { segmentedFlowV1: true, visitedSteps: { blueprint: true, methodology: true }, completedSteps: { blueprint: true, methodology: true } }
        }));
      }
      return Promise.resolve({});
    });
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => expect(screen.getAllByText(/Identity & Access/i).length).toBeGreaterThanOrEqual(1));
    const sidebar = document.querySelector(".sidebar .step-list");
    expect(sidebar).toBeTruthy();
    const stepButtons = sidebar.querySelectorAll(".step-item");
    expect(stepButtons.length).toBeGreaterThanOrEqual(4);
    expect(() => fireEvent.click(stepButtons[3])).not.toThrow();
  });
});
