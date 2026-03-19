import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppContext } from "../src/store.jsx";
import MethodologyStep from "../src/steps/MethodologyStep.jsx";

describe("MethodologyStep placeholder mode", () => {
  it("does not show Placeholder Values Mode for Bare Metal (deferred / hidden)", () => {
    const state = {
      blueprint: { platform: "Bare Metal" },
      methodology: { method: "Agent-Based Installer" },
      hostInventory: { nodes: [], schemaVersion: 2 },
      ui: { visitedSteps: { methodology: true }, activeStepId: "methodology" },
      reviewFlags: {}
    };
    const updateState = vi.fn();
    render(
      <AppContext.Provider value={{ state, updateState, loading: false, startOver: vi.fn() }}>
        <MethodologyStep />
      </AppContext.Provider>
    );
    expect(screen.queryByText(/Placeholder Values Mode/i)).toBeNull();
    expect(
      screen.queryByRole("switch", { name: /Enable placeholder values for sensitive environment-specific fields/i })
    ).toBeNull();
  });
});
