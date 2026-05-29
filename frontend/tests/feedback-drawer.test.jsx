/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

function setupMock({ visible = true, enabled = true, mode = "offline" } = {}) {
  vi.mocked(apiFetch).mockImplementation((path) => {
    if (path === "/api/state") return Promise.resolve(stateWithBlueprintCompleteMethodologyIncomplete());
    if (path === "/api/schema/stepMap") return Promise.resolve({});
    if (path === "/api/build-info") return Promise.resolve({ gitSha: "abc1234", buildTime: "2026-03-24", repo: "owner/repo", branch: "main" });
    if (path === "/api/update-info") return Promise.resolve({ enabled: false });
    if (path === "/api/feedback/config") {
      return Promise.resolve({
        visible,
        enabled,
        mode,
        reason: enabled ? "" : "Feedback disabled",
        challengeRequired: enabled,
        minDwellMs: 0,
        limits: { summaryMaxChars: 200, detailsMaxChars: 4000, contactMaxChars: 200, maxPayloadBytes: 32768 },
        enums: { categories: ["bug", "docs", "ux", "request", "security", "other"], severities: ["low", "medium", "high", "critical"] }
      });
    }
    if (path === "/api/feedback/challenge") {
      return Promise.resolve({
        token: "token-abc",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60000,
        minDwellMs: 0
      });
    }
    if (path === "/api/state" && path?.method === "POST") return Promise.resolve({});
    return Promise.resolve({});
  });
}

describe("Feedback drawer visibility and open/close", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.mocked(apiFetch).mockReset();
  });

  it("shows Feedback trigger and opens drawer when feedback is visible", async () => {
    setupMock({ visible: true, enabled: true, mode: "offline" });
    render(<App />);
    const startButton = await screen.findByRole("button", { name: /continue install|start new install/i });
    fireEvent.click(startButton);

    const openButton = await screen.findByRole("button", { name: /open feedback/i });
    fireEvent.click(openButton);

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /feedback/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/do not include secrets/i)).toBeInTheDocument();

    const closeButton = screen.getByRole("button", { name: /close feedback/i });
    fireEvent.click(closeButton);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /feedback/i })).toBeNull();
    });
  });

  it("shows Feedback trigger button even when feedback config is disabled (v1.7.0 regression fix)", async () => {
    // v1.7.0 regression fix: Feedback button always visible regardless of config
    // Rationale: Config fetch can fail, but users should always have access to feedback
    setupMock({ visible: false, enabled: false, mode: "disabled" });
    render(<App />);
    const startButton = await screen.findByRole("button", { name: /continue install|start new install/i });
    fireEvent.click(startButton);

    // Button should be visible even when config says disabled
    await waitFor(() => {
      expect(screen.queryAllByRole("button", { name: /open feedback/i })).toHaveLength(1);
    });

    // Clicking it should still open the drawer (FeedbackDrawer component handles disabled state)
    const feedbackButton = screen.getByRole("button", { name: /open feedback/i });
    fireEvent.click(feedbackButton);

    // Drawer should open (it will show disabled UI inside, but drawer itself opens)
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /feedback/i })).toBeInTheDocument();
    });
  });
});
