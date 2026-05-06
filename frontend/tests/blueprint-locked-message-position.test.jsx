/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

const stateLocked = {
  blueprint: {
    arch: "x86_64",
    platform: "Bare Metal",
    confirmed: true,
    confirmationTimestamp: Date.now()
  },
  release: { channel: "4.15", patchVersion: "4.15.0", confirmed: true },
  version: { versionConfirmed: true },
  methodology: { method: "Agent-Based Installer" },
  operators: {},
  ui: { activeStepId: "blueprint", visitedSteps: { blueprint: true }, completedSteps: {} }
};

const stateUnlocked = {
  ...stateLocked,
  blueprint: { ...stateLocked.blueprint, confirmed: false, confirmationTimestamp: null }
};

describe("Blueprint: locked message position", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/state") return Promise.resolve(stateLocked);
      if (path === "/api/cincinnati/channels") return Promise.resolve({ channels: ["4.15"] });
      if (path === "/api/cincinnati/patches") return Promise.resolve({ versions: ["4.15.0"] });
      return Promise.resolve({});
    });
  });

  it("when locked, shows 'Foundational selections are locked' above Target Platform section", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /Blueprint/i }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole("button", { name: /Blueprint/i })[0]);
    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: /Foundational selections/i }).length).toBeGreaterThan(0);
    });
    const stepBody = document.querySelector(".step-body");
    expect(stepBody).toBeTruthy();
    const warning = stepBody?.querySelector(".note.warning");
    expect(warning).toBeTruthy();
    expect(warning?.textContent).toMatch(/Foundational selections are locked/i);
    const targetPlatformCard = stepBody?.querySelector(".card");
    expect(targetPlatformCard?.textContent).toMatch(/Target Platform/i);
    expect(stepBody?.children[0]).toHaveClass("note");
    expect(stepBody?.children[0]).toHaveClass("warning");
  });

  it("when not locked, does not show the locked warning", async () => {
    localStorage.removeItem("airgap-architect-state");
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/state") return Promise.resolve(stateUnlocked);
      if (path === "/api/cincinnati/channels") return Promise.resolve({ channels: ["4.15"] });
      if (path === "/api/cincinnati/patches") return Promise.resolve({ versions: ["4.15.0"] });
      return Promise.resolve({});
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /Blueprint/i }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole("button", { name: /Blueprint/i })[0]);
    await waitFor(
      () => {
        const bodies = document.querySelectorAll(".step-body");
        expect(bodies.length).toBeGreaterThan(0);
        const latestBody = bodies[bodies.length - 1];
        expect(latestBody.querySelector(".note.warning")).toBeNull();
      },
      { timeout: 3000 }
    );
  });
});
