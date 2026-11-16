/**
 * v2.2.0 M3 — shared Tools drawer and Home, on the real App tree.
 *
 * Install (part-way through) → Tools → Home → Mirroring → Tools → Home →
 * Install must lose nothing: same step, same state (including an in-memory
 * secret that is never persisted), no Start Over request, one global theme.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import React from "react";

const harness = vi.hoisted(() => ({ initialState: null }));
vi.mock("../src/store.jsx", async (importOriginal) => {
  const { makeStoreMock } = await import("./helpers/store-harness.jsx");
  return makeStoreMock(await importOriginal(), harness);
});
vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(() => Promise.resolve({})), API_BASE: "" }));
const { default: App } = await import("../src/App.jsx");
const { apiFetch } = await import("../src/api.js");

const partialInstall = () => ({
  _schemaVersion: 3,
  version: { _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: "4.22.16", selectedChannel: "stable-4.22", locked: true },
  release: { channel: "4.22", patchVersion: "4.22.16", confirmed: true },
  blueprint: {
    platform: "Bare Metal", arch: "x86_64", clusterName: "edge-cluster", baseDomain: "example.com", confirmed: true,
    blueprintPullSecretEphemeral: "{\"auths\":{\"registry.example.invalid\":{\"auth\":\"dGVzdDp0ZXN0\"}}}"
  },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: { nodes: [] },
  operators: { selected: [] },
  reviewFlags: {},
  ui: { activeStepId: "methodology", visitedSteps: { blueprint: true, methodology: true }, completedSteps: { blueprint: true } }
});


afterEach(() => {
  cleanup();
  sessionStorage.clear();
  document.body.removeAttribute("data-theme");
  localStorage.removeItem("airgap-theme");
});

const landing = () => screen.queryByRole("button", { name: /Start new install|Continue install/i });
const openTools = () => {
  fireEvent.click(screen.getByRole("button", { name: "Open Tools" }));
  return screen.getByRole("dialog", { name: "Tools" });
};

describe("Home is navigation, not Start Over", () => {
  it("Install → Home → Mirroring → Home → Install keeps the step, the state and the in-memory secret", async () => {
    harness.initialState = partialInstall();
    render(<App />);
    await waitFor(() => expect(landing()).not.toBeNull());
    fireEvent.click(landing());
    await waitFor(() => expect(landing()).toBeNull());
    const stepHeading = () => document.querySelector("#main-content h2")?.textContent;
    await waitFor(() => expect(stepHeading()).toBeTruthy());
    const before = stepHeading();

    // Install → Home (Tools drawer)
    let drawer = openTools();
    expect(within(drawer).getByRole("button", { name: "Start Over" })).toBeTruthy(); // Install keeps Start Over
    fireEvent.click(within(drawer).getByRole("button", { name: "Home" }));
    await waitFor(() => expect(landing()).not.toBeNull());

    // → Mirroring
    fireEvent.click(screen.getByRole("button", { name: "Open Mirroring" }));
    await screen.findByRole("heading", { name: "Mirroring", level: 2 });
    drawer = openTools();
    // One global theme: toggled from Mirroring...
    fireEvent.click(within(drawer).getByRole("switch", { name: "Dark mode" }));
    expect(document.body.dataset.theme).toBe("dark");
    expect(within(drawer).queryByRole("button", { name: "Start Over" })).toBeNull();
    fireEvent.click(within(drawer).getByRole("button", { name: "Home" }));
    await waitFor(() => expect(landing()).not.toBeNull());

    // → Install again: same step, nothing reset
    fireEvent.click(landing());
    await waitFor(() => expect(landing()).toBeNull());
    await waitFor(() => expect(stepHeading()).toBe(before));
    // ...and still dark in Install.
    expect(document.body.dataset.theme).toBe("dark");
    drawer = openTools();
    expect(within(drawer).getByRole("switch", { name: "Dark mode" }).getAttribute("aria-checked")).toBe("true");

    const calls = vi.mocked(apiFetch).mock.calls.map(([p]) => String(p));
    expect(calls.some((p) => p.includes("start-over"))).toBe(false);
  });

  it("the Install store, including the never-persisted pull secret, survives the round trip", async () => {
    harness.initialState = partialInstall();
    render(<App />);
    await waitFor(() => expect(landing()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Open Mirroring" }));
    await screen.findByRole("heading", { name: "Mirroring", level: 2 });
    fireEvent.click(within(openTools()).getByRole("button", { name: "Home" }));
    await waitFor(() => expect(landing()).not.toBeNull());
    // Read the one live store the App is using.
    let seen = null;
    harness.setState((prev) => { seen = prev; return prev; });
    expect(seen.blueprint.blueprintPullSecretEphemeral).toContain("registry.example.invalid");
    expect(seen.blueprint.clusterName).toBe("edge-cluster");
    expect(seen.ui.visitedSteps).toEqual({ blueprint: true, methodology: true });
  });
});
