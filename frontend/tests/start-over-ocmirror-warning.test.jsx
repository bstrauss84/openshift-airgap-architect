import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

function makeState() {
  return stateWithBlueprintCompleteMethodologyIncomplete();
}

describe("Start Over oc-mirror safety", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(apiFetch).mockReset();
  });

  it("shows conditional warning and cancels running oc-mirror jobs on Start Over", async () => {
    const state = makeState();
    vi.mocked(apiFetch).mockImplementation((path, options) => {
      if (path === "/api/state") {
        if (options?.method === "POST") return Promise.resolve(JSON.parse(options.body));
        return Promise.resolve(state);
      }
      if (path === "/api/schema/stepMap") return Promise.resolve({});
      if (path === "/api/build-info") return Promise.resolve({ gitSha: "unknown", buildTime: "unknown", repo: "", branch: "main" });
      if (path === "/api/update-info") return Promise.resolve({ enabled: false });
      if (path === "/api/jobs?type=oc-mirror-run") {
        return Promise.resolve({
          jobs: [
            {
              id: "job-1",
              type: "oc-mirror-run",
              status: "running",
              metadata_json: JSON.stringify({
                archiveDir: "/data/oc-mirror/archives",
                cacheDir: "/data/oc-mirror/cache"
              })
            }
          ]
        });
      }
      if (path === "/api/start-over") {
        return Promise.resolve({
          ...state,
          blueprint: { ...state.blueprint, confirmed: false },
          release: { ...state.release, confirmed: false },
          version: { ...state.version, versionConfirmed: false },
          ui: { ...state.ui, activeStepId: "blueprint", visitedSteps: {}, completedSteps: {} }
        });
      }
      return Promise.resolve({});
    });

    render(<App />);
    const startOverButton = await screen.findByRole("button", { name: /^Start Over$/i });
    fireEvent.click(startOverButton);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/api/jobs?type=oc-mirror-run");
    });
    await waitFor(() => {
      expect(screen.getByText(/An oc-mirror run is currently active/i)).toBeInTheDocument();
    });
    const activeCountNote = screen.getByText(/Active oc-mirror runs:/i).closest("div");
    expect(activeCountNote?.textContent || "").toMatch(/Active oc-mirror runs:\s*1/i);

    const confirmButton = screen.getByRole("button", { name: /cancel run and start over/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/api/start-over",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ cancelRunningOcMirror: true })
        })
      );
    });
  });

  it("keeps default confirmation text when no oc-mirror run is active", async () => {
    const state = makeState();
    vi.mocked(apiFetch).mockImplementation((path, options) => {
      if (path === "/api/state") {
        if (options?.method === "POST") return Promise.resolve(JSON.parse(options.body));
        return Promise.resolve(state);
      }
      if (path === "/api/schema/stepMap") return Promise.resolve({});
      if (path === "/api/build-info") return Promise.resolve({ gitSha: "unknown", buildTime: "unknown", repo: "", branch: "main" });
      if (path === "/api/update-info") return Promise.resolve({ enabled: false });
      if (path === "/api/jobs?type=oc-mirror-run") return Promise.resolve({ jobs: [] });
      return Promise.resolve({});
    });

    render(<App />);
    const startOverButton = await screen.findByRole("button", { name: /^Start Over$/i });
    fireEvent.click(startOverButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Yes, start over/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/An oc-mirror run is currently active/i)).toBeNull();
  });
});
