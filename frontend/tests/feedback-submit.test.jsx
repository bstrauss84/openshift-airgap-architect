import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

function mountWithFeedbackMocks(
  submitImpl,
  config = { visible: true, enabled: true, mode: "offline", reason: "" }
) {
  vi.mocked(apiFetch).mockImplementation((path, options) => {
    if (path === "/api/state") return Promise.resolve(stateWithBlueprintCompleteMethodologyIncomplete());
    if (path === "/api/schema/stepMap") return Promise.resolve({});
    if (path === "/api/build-info") return Promise.resolve({ gitSha: "abc1234", buildTime: "2026-03-24", repo: "owner/repo", branch: "main" });
    if (path === "/api/update-info") return Promise.resolve({ enabled: false });
    if (path === "/api/feedback/config") {
      return Promise.resolve({
        visible: config.visible,
        enabled: config.enabled,
        mode: config.mode,
        reason: config.reason || "",
        challengeRequired: Boolean(config.enabled),
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
    if (path === "/api/feedback/submit" && options?.method === "POST") {
      return submitImpl(path, options);
    }
    return Promise.resolve({});
  });
  return render(<App />);
}

async function openDrawer() {
  const startButton = await screen.findByRole("button", { name: /continue install|start new install/i });
  fireEvent.click(startButton);
  const feedbackButtons = await screen.findAllByRole("button", { name: /open feedback/i });
  const openButton = feedbackButtons[0];
  fireEvent.click(openButton);
  await screen.findByRole("dialog", { name: /feedback/i });
}

describe("Feedback submit behavior", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.mocked(apiFetch).mockReset();
  });

  it("submits feedback successfully in offline mode", async () => {
    mountWithFeedbackMocks(() =>
      Promise.resolve({
        ok: true,
        submissionId: "abc123",
        mode: "offline",
        delivered: false,
        handoff: {
          schemaVersion: 1,
          exportedAt: "2026-03-24T00:00:00.000Z",
          payload: { submissionId: "abc123" }
        }
      })
    );
    await openDrawer();

    fireEvent.change(screen.getByLabelText(/summary/i), { target: { value: "Need improvement" } });
    fireEvent.change(screen.getByLabelText(/details/i), { target: { value: "More detail here" } });
    fireEvent.click(screen.getByRole("button", { name: /submit feedback/i }));

    await waitFor(() => {
      expect(screen.getByText(/feedback submitted successfully/i)).toBeInTheDocument();
    });
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/feedback/submit",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows rate-limit style error when submit fails", async () => {
    mountWithFeedbackMocks(() => Promise.reject(new Error("Too many feedback submissions.")));
    await openDrawer();

    fireEvent.change(screen.getByLabelText(/summary/i), { target: { value: "Need improvement" } });
    fireEvent.change(screen.getByLabelText(/details/i), { target: { value: "More detail here" } });
    fireEvent.click(screen.getByRole("button", { name: /submit feedback/i }));

    await waitFor(() => {
      expect(screen.getByText(/too many feedback submissions/i)).toBeInTheDocument();
    });
  });

  it("does not expose feedback submission UI when online mode is unconfigured", async () => {
    mountWithFeedbackMocks(
      () => Promise.resolve({ ok: true }),
      {
        visible: false,
        enabled: false,
        mode: "disabled",
        reason: "Relay mode requires FEEDBACK_RELAY_URL."
      }
    );
    const startButton = await screen.findByRole("button", { name: /continue install|start new install/i });
    fireEvent.click(startButton);
    await waitFor(() => {
      expect(screen.queryAllByRole("button", { name: /open feedback/i })).toHaveLength(0);
    });
    expect(apiFetch).not.toHaveBeenCalledWith(
      "/api/feedback/submit",
      expect.objectContaining({ method: "POST" })
    );
  });
});
