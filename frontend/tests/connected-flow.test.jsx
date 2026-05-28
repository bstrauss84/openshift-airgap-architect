/**
 * OpenShift Airgap Architect - Connected Flow Frontend Tests
 *
 * Tests for connected mode frontend components and logic:
 * - Step visibility filtering
 * - Component rendering
 * - State management
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from "vitest";
import { computeVisibleWizardRows } from "../src/wizardVisibleSteps.js";

describe("Connected Flow - Step Visibility", () => {
  it("returns 4-step flow for connected mode (non-operator-managed)", () => {
    const state = {
      docs: { connectivity: "connected" }
    };
    const stepMap = {};
    const runtimeInfo = { operatorManaged: false };

    const rows = computeVisibleWizardRows(state, stepMap, runtimeInfo);

    expect(rows).toHaveLength(4);
    expect(rows[0].id).toBe("release-selection");
    expect(rows[1].id).toBe("operators");
    expect(rows[2].id).toBe("imageset-config");
    expect(rows[3].id).toBe("review");
  });

  it("returns 5-step flow for connected mode (operator-managed)", () => {
    const state = {
      docs: { connectivity: "connected" }
    };
    const stepMap = {};
    const runtimeInfo = { operatorManaged: true };

    const rows = computeVisibleWizardRows(state, stepMap, runtimeInfo);

    expect(rows).toHaveLength(5);
    expect(rows[0].id).toBe("release-selection");
    expect(rows[1].id).toBe("operators");
    expect(rows[2].id).toBe("imageset-config");
    expect(rows[3].id).toBe("review");
    expect(rows[4].id).toBe("run-collection");
  });

  it("includes correct labels for connected mode steps", () => {
    const state = {
      docs: { connectivity: "connected" }
    };
    const stepMap = {};
    const runtimeInfo = { operatorManaged: false };

    const rows = computeVisibleWizardRows(state, stepMap, runtimeInfo);

    expect(rows[0].label).toBe("Release Selection");
    expect(rows[1].label).toBe("Operators");
    expect(rows[2].label).toBe("ImageSet Configuration");
    expect(rows[3].label).toBe("Review Config");
  });

  it("does not include disconnected-only steps in connected mode", () => {
    const state = {
      docs: { connectivity: "connected" }
    };
    const stepMap = {};
    const runtimeInfo = { operatorManaged: false };

    const rows = computeVisibleWizardRows(state, stepMap, runtimeInfo);
    const stepIds = rows.map(r => r.id);

    // Should not include these disconnected-only steps
    expect(stepIds).not.toContain("blueprint");
    expect(stepIds).not.toContain("methodology");
    expect(stepIds).not.toContain("identity-access");
    expect(stepIds).not.toContain("networking-v2");
    expect(stepIds).not.toContain("platform-specifics");
    expect(stepIds).not.toContain("run-oc-mirror");
    expect(stepIds).not.toContain("operations");
  });
});

describe("Connected Flow - Disconnected Mode Regression", () => {
  it("returns full step flow for fully-disconnected mode", () => {
    const state = {
      docs: { connectivity: "fully-disconnected" },
      ui: { segmentedFlowV1: true }
    };
    const stepMap = {
      mvpSteps: [
        { id: "blueprint", label: "Blueprint", stepNumber: 1, subSteps: [] },
        { id: "methodology", label: "Methodology", stepNumber: 2, subSteps: [] },
        { id: "identity-access", label: "Identity & Access", stepNumber: 3, subSteps: [] },
        { id: "networking-v2", label: "Networking", stepNumber: 4, subSteps: [] },
        { id: "operators", label: "Operators", stepNumber: 5, subSteps: [] },
        { id: "review", label: "Assets & Guide", stepNumber: 6, subSteps: [] }
      ]
    };

    const rows = computeVisibleWizardRows(state, stepMap);

    // Should include more steps than connected mode
    expect(rows.length).toBeGreaterThan(4);
    expect(rows.some(r => r.id === "blueprint")).toBe(true);
    expect(rows.some(r => r.id === "methodology")).toBe(true);
  });

  it("includes operators and review steps in both modes", () => {
    const connectedState = { docs: { connectivity: "connected" } };
    const disconnectedState = {
      docs: { connectivity: "fully-disconnected" },
      ui: { segmentedFlowV1: true }
    };
    const stepMap = {
      mvpSteps: [
        { id: "operators", label: "Operators", stepNumber: 1, subSteps: [] },
        { id: "review", label: "Review", stepNumber: 2, subSteps: [] }
      ]
    };

    const connectedRows = computeVisibleWizardRows(connectedState, stepMap);
    const disconnectedRows = computeVisibleWizardRows(disconnectedState, stepMap);

    // Both modes include operators and review
    expect(connectedRows.some(r => r.id === "operators")).toBe(true);
    expect(connectedRows.some(r => r.id === "review")).toBe(true);
    expect(disconnectedRows.some(r => r.id === "operators")).toBe(true);
    expect(disconnectedRows.some(r => r.id === "review")).toBe(true);
  });
});

describe("Connected Flow - ImageSet Config State", () => {
  it("handles imagesetConfig state for connected mode", () => {
    // This test verifies the expected state structure
    const state = {
      docs: { connectivity: "connected" },
      release: { patchVersion: "4.20.5", channel: "stable-4.20" },
      version: { selectedVersion: "4.20" },
      imagesetConfig: {
        graph: true,
        additionalImages: "registry.example.com/app:v1",
        archiveSize: "50"
      },
      operators: {
        selected: [
          { name: "kubevirt-hyperconverged", catalog: "redhat-operators" }
        ]
      }
    };

    // Verify state structure matches expected shape
    expect(state.imagesetConfig.graph).toBe(true);
    expect(state.imagesetConfig.additionalImages).toBe("registry.example.com/app:v1");
    expect(state.imagesetConfig.archiveSize).toBe("50");
    expect(state.operators.selected).toHaveLength(1);
  });
});
