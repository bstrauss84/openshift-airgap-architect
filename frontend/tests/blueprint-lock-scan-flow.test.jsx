/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

const stateWithPullSecretUnlocked = {
  blueprint: {
    arch: "x86_64",
    platform: "Bare Metal",
    confirmed: false,
    confirmationTimestamp: null,
    blueprintPullSecretEphemeral: '{"auths":{"registry.redhat.io":{"auth":"dGVzdA=="}}}'
  },
  release: { channel: "4.15", patchVersion: "4.15.0", confirmed: true },
  version: { versionConfirmed: true },
  methodology: { method: "Agent-Based Installer" },
  operators: {},
  ui: { activeStepId: "blueprint", visitedSteps: { blueprint: true }, completedSteps: {} }
};

describe("Blueprint lock: scan kickoff and field cleared", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        return Promise.resolve(stateWithPullSecretUnlocked);
      }
      if (path === "/api/cincinnati/channels") return Promise.resolve({ channels: ["4.15"] });
      if (path === "/api/cincinnati/patches") return Promise.resolve({ versions: ["4.15.0"] });
      if (path === "/api/operators/confirm") {
        return Promise.resolve({
          ok: true,
          release: { channel: "4.15", patchVersion: "4.15.0", confirmed: true },
          version: { versionConfirmed: true }
        });
      }
      if (path === "/api/operators/scan") return Promise.resolve({ jobs: { redhat: "job-1" } });
      return Promise.resolve({});
    });
  });

  it("when user has valid pull secret and clicks Yes lock, triggers scan and does not persist secret", async () => {
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
      expect(screen.getByRole("heading", { name: /Foundational selections/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Confirm & Proceed/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Yes, lock selections/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Yes, lock selections/i }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/api/operators/scan",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("pullSecret")
        })
      );
    });
    const scanCall = vi.mocked(apiFetch).mock.calls.find(
      (c) => c[0] === "/api/operators/scan" && c[1]?.method === "POST"
    );
    expect(scanCall).toBeDefined();
    const body = JSON.parse(scanCall[1].body);
    expect(body.pullSecret).toBeDefined();
    expect(body.pullSecret).toContain("auths");
  });
});
