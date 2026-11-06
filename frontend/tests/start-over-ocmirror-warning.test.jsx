/**
 * OpenShift Airgap Architect - Test Suite
 *
 * v2.3.0 §18: "New Install…" is scoped to Install. The dialog is rendered from
 * the server's preview (what is cleared, kept and stopped), the reset sends
 * the preview's token back, Mirroring/Upgrade runs are listed as not affected,
 * a scope change is shown instead of applied, and opening Install from the
 * landing page never resets anything.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

const TOKEN = "a".repeat(64);
const PREVIEW = {
  token: TOKEN,
  cancel: [{ id: "job-install", type: "oc-mirror-run", workflow: "install", archivePath: "/data/oc-mirror/archives" }],
  keepInstall: [],
  unaffected: [{ id: "job-stage", type: "oc-mirror-run", workflow: "upgrade" }, { id: "job-mirror", type: "oc-mirror-run", workflow: "mirroring" }],
  unclassified: [],
  installRunsRunning: 1,
  preserved: { mirroringProfiles: 2, upgradePlans: 1, upgradeStageProfiles: 3 }
};

function mockServer(state, { preview = PREVIEW, startOver } = {}) {
  vi.mocked(apiFetch).mockImplementation((path, options) => {
    if (path === "/api/state") {
      if (options?.method === "POST") return Promise.resolve(JSON.parse(options.body));
      return Promise.resolve(state);
    }
    if (path === "/api/schema/stepMap") return Promise.resolve({});
    if (path === "/api/build-info") return Promise.resolve({ gitSha: "unknown", buildTime: "unknown", repo: "", branch: "main" });
    if (path === "/api/update-info") return Promise.resolve({ enabled: false });
    if (path === "/api/mirroring") return Promise.resolve({ profiles: [{ id: "p1" }, { id: "p2" }, { id: "p3", ownedBy: { workflow: "upgrade" } }] });
    if (path === "/api/upgrade") return Promise.resolve({ plans: [{ id: "u1" }] });
    if (path.startsWith("/api/start-over/preview")) return Promise.resolve(preview);
    if (path === "/api/start-over") return startOver ? startOver(options) : Promise.resolve({ ...state, ui: { ...state.ui, activeStepId: "blueprint", visitedSteps: {}, completedSteps: {} } });
    return Promise.resolve({});
  });
}

describe("New Install… (scoped Install reset)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(apiFetch).mockReset();
  });

  it("the landing header has no global reset; each card says what exists", async () => {
    mockServer(stateWithBlueprintCompleteMethodologyIncomplete());
    render(<App />);
    await screen.findByRole("button", { name: /Continue install/i });
    expect(screen.queryByRole("button", { name: /^Start Over$/i })).toBeNull();
    await waitFor(() => expect(screen.getByTestId("landing-mirroring-status")).toHaveTextContent("2 profiles · 1 Upgrade stage profile"));
    expect(screen.getByTestId("landing-upgrade-status")).toHaveTextContent("1 plan");
    expect(screen.getByTestId("landing-install-status")).toHaveTextContent(/In progress/);
  });

  it("lists what is cleared, kept and stopped from the server preview, and confirms with its token", async () => {
    mockServer(stateWithBlueprintCompleteMethodologyIncomplete());
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "New Install…" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText(/2 Mirroring profiles/)).toBeInTheDocument());
    expect(within(dialog).getByText(/1 Upgrade plan and their 3 stage profiles/)).toBeInTheDocument();
    expect(within(dialog).getByText(/job-install/)).toBeInTheDocument();
    expect(within(dialog).getByText(/job-stage \(Upgrade\) keeps running/)).toBeInTheDocument();
    expect(within(dialog).getByText(/job-mirror \(Mirroring\) keeps running/)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));
    fireEvent.click(within(dialog).getByRole("button", { name: /Stop 1 Install run and start a new Install/ }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/start-over", expect.objectContaining({ method: "POST", body: JSON.stringify({ cancelInstallRuns: true, previewToken: TOKEN }) })));
    expect(apiFetch).not.toHaveBeenCalledWith("/api/jobs?type=oc-mirror-run");
  });

  it("with nothing running, the confirmation says so plainly", async () => {
    mockServer(stateWithBlueprintCompleteMethodologyIncomplete(), { preview: { ...PREVIEW, cancel: [], unaffected: [], installRunsRunning: 0 } });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "New Install…" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Start a new Install" })).not.toBeDisabled());
    expect(within(dialog).queryByText(/Running work that will be stopped/)).toBeNull();
  });

  it("a scope change after the preview is shown, not applied", async () => {
    let calls = 0;
    mockServer(stateWithBlueprintCompleteMethodologyIncomplete(), {
      startOver: () => {
        calls += 1;
        const e = new Error("What Start new Install would affect changed after the confirmation was shown.");
        e.status = 409;
        e.payload = { code: "RESET_SCOPE_CHANGED" };
        return Promise.reject(e);
      }
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "New Install…" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: /start a new Install/i }));
    await waitFor(() => expect(within(dialog).getByText(/changed while the dialog was open/)).toBeInTheDocument());
    expect(calls).toBe(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opening Install from the landing page never calls the reset (F-SO-3)", async () => {
    const fresh = stateWithBlueprintCompleteMethodologyIncomplete();
    fresh.ui = { ...(fresh.ui || {}), visitedSteps: {}, completedSteps: {} };
    mockServer(fresh);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Start new install/i }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: /What would you like to do\?/ })).toBeNull());
    expect(apiFetch).not.toHaveBeenCalledWith("/api/start-over", expect.anything());
  });
});
