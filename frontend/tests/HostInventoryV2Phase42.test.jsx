/**
 * Phase 4.2: Scenario-aware section ordering and compare mode (inventory-v2 only).
 * - Section ordering changes by scenarioId when scenarioAwareLayout is ON.
 * - Compare mode toggling does not modify wizard state.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  getSectionOrderForRender,
  getScenarioId,
  SECTION_IDS,
  DEFAULT_SECTION_ORDER,
  SCENARIO_SECTION_ORDER
} from "../src/hostInventoryV2Helpers.js";
import { AppContext } from "../src/store.jsx";
import HostInventoryV2Step from "../src/steps/HostInventoryV2Step.jsx";

const mockState = {
  blueprint: { platform: "Bare Metal" },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: { nodes: [], apiVip: "10.0.0.1", enableIpv6: false },
  globalStrategy: { networking: { machineNetworkV4: "10.0.0.0/24" } },
  ui: { compareMode: false, scenarioAwareLayout: false }
};

function MockAppProvider({ children, updateStateSpy }) {
  const updateState = updateStateSpy || (() => {});
  const value = {
    state: mockState,
    updateState,
    loading: false,
    startOver: vi.fn()
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

describe("Phase 4.2: section ordering", () => {
  it("returns DEFAULT_SECTION_ORDER when scenarioAwareLayout is OFF regardless of scenarioId", () => {
    expect(getSectionOrderForRender(false, null)).toEqual(DEFAULT_SECTION_ORDER);
    expect(getSectionOrderForRender(false, "bare-metal-agent")).toEqual(DEFAULT_SECTION_ORDER);
    expect(getSectionOrderForRender(false, "bare-metal-ipi")).toEqual(DEFAULT_SECTION_ORDER);
  });

  it("returns scenario-specific order when scenarioAwareLayout is ON", () => {
    expect(getSectionOrderForRender(true, "bare-metal-agent")).toEqual(SCENARIO_SECTION_ORDER["bare-metal-agent"]);
    expect(getSectionOrderForRender(true, "bare-metal-ipi")).toEqual(SCENARIO_SECTION_ORDER["bare-metal-ipi"]);
  });

  it("section ordering can differ by scenarioId when scenarioAwareLayout is ON", () => {
    const orderAgent = getSectionOrderForRender(true, "bare-metal-agent");
    const orderIpi = getSectionOrderForRender(true, "bare-metal-ipi");
    expect(orderAgent).toEqual(SCENARIO_SECTION_ORDER["bare-metal-agent"]);
    expect(orderIpi).toEqual(SCENARIO_SECTION_ORDER["bare-metal-ipi"]);
    expect(orderAgent).toContain(SECTION_IDS.AGENT_OPTIONS);
    expect(orderIpi).toContain(SECTION_IDS.NODE_COUNTS);
  });

  it("getScenarioId returns correct id for Bare Metal + Agent-Based / IPI and vSphere IPI/UPI and AWS GovCloud IPI/UPI and Azure Government IPI", () => {
    expect(getScenarioId("Bare Metal", "Agent-Based Installer")).toBe("bare-metal-agent");
    expect(getScenarioId("Bare Metal", "IPI")).toBe("bare-metal-ipi");
    expect(getScenarioId("Bare Metal", "UPI")).toBe("bare-metal-upi");
    expect(getScenarioId("VMware vSphere", "IPI")).toBe("vsphere-ipi");
    expect(getScenarioId("VMware vSphere", "UPI")).toBe("vsphere-upi");
    expect(getScenarioId("AWS GovCloud", "IPI")).toBe("aws-govcloud-ipi");
    expect(getScenarioId("AWS GovCloud", "UPI")).toBe("aws-govcloud-upi");
    expect(getScenarioId("Azure Government", "IPI")).toBe("azure-government-ipi");
  });

  it("vsphere-upi, aws-govcloud-ipi, azure-government-ipi are not in SCENARIO_IDS_WITH_HOST_INVENTORY so Hosts step is hidden in segmented flow (Prompt J)", () => {
    const { SCENARIO_IDS_WITH_HOST_INVENTORY } = require("../src/hostInventoryV2Helpers.js");
    expect(SCENARIO_IDS_WITH_HOST_INVENTORY).toContain("bare-metal-agent");
    expect(SCENARIO_IDS_WITH_HOST_INVENTORY).toContain("bare-metal-ipi");
    expect(SCENARIO_IDS_WITH_HOST_INVENTORY).not.toContain("vsphere-upi");
    expect(SCENARIO_IDS_WITH_HOST_INVENTORY).not.toContain("vsphere-ipi");
    expect(SCENARIO_IDS_WITH_HOST_INVENTORY).not.toContain("aws-govcloud-ipi");
    expect(SCENARIO_IDS_WITH_HOST_INVENTORY).not.toContain("azure-government-ipi");
  });
});

describe("Phase 4.2: compare mode does not modify wizard state", () => {
  it.skip("compare toggle calls updateState only with ui (no hostInventory, blueprint, methodology)", () => {
    // Compare-mode toggle was removed from HostInventoryV2Step UI; section order is always scenario-aware.
    // If the toggle is re-added, restore this test and remove .skip.
    const updateStateSpy = vi.fn();

    render(
      <MockAppProvider updateStateSpy={updateStateSpy}>
        <HostInventoryV2Step />
      </MockAppProvider>
    );

    const compareLabel = screen.queryByText(/Compare legacy vs scenario-aware/i);
    expect(compareLabel).toBeTruthy();
    const compareInput = compareLabel?.closest("label")?.querySelector('input[type="checkbox"]');
    expect(compareInput).toBeTruthy();

    fireEvent.click(compareInput);

    expect(updateStateSpy).toHaveBeenCalled();
    const patch = updateStateSpy.mock.calls[0][0];
    expect(patch).toHaveProperty("ui");
    expect(patch.ui).toHaveProperty("compareMode", true);
    expect(patch).not.toHaveProperty("hostInventory");
    expect(patch).not.toHaveProperty("blueprint");
    expect(patch).not.toHaveProperty("methodology");
  });
});
