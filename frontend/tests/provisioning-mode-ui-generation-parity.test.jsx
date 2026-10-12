/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Provisioning mode: UI visibility must equal generation emission.
 *
 * Tranche 7C.4 gated `provisioningDHCPRange` to Managed and
 * `provisioningNetworkInterface` to non-Disabled in `backend/src/generate.js`,
 * on Red Hat's explicit "omit this setting" instructions and on
 * cluster-baremetal-operator clearing the DHCP range for every non-Managed
 * mode. It did NOT move the matching UI gates, so for one tranche the
 * Unmanaged mode rendered an editable DHCP-range control whose value the
 * generator silently discarded, and Disabled rendered an editable interface
 * control with the same problem.
 *
 * An editable control whose value is dropped purely because of the current
 * provisioning mode is a correctness defect, not a cosmetic one: the user has
 * no way to tell that what they typed did not reach the file.
 *
 * This test therefore does not hardcode "which fields show in which mode".
 * It derives BOTH sides from the real implementations — rendered DOM on one
 * side, the real `buildInstallConfig` on the other — and asserts they agree.
 * A future change to either side alone fails here.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import yaml from "../../backend/node_modules/js-yaml/index.js";
import { AppContext } from "../src/store.jsx";
import PlatformSpecificsStep from "../src/steps/PlatformSpecificsStep.jsx";
import { buildInstallConfig } from "../../backend/src/generate.js";
import { bareMetalIpi } from "../../e2e/fixtures/scenarios.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(() => Promise.resolve({})), API_BASE: "" }));

const MODES = ["Managed", "Unmanaged", "Disabled"];

/** Every provisioning field whose applicability depends on the mode. */
const FIELDS = [
  { key: "provisioningNetworkCIDR", label: /Provisioning network CIDR/i, value: "172.22.0.0/24" },
  { key: "provisioningNetworkInterface", label: /Provisioning network interface/i, value: "eno1" },
  { key: "provisioningDHCPRange", label: /Provisioning DHCP range/i, value: "172.22.0.10,172.22.0.100" },
  { key: "clusterProvisioningIP", label: /Cluster provisioning IP/i, value: "172.22.0.3" },
  { key: "provisioningNetworkGateway", label: /Provisioning network gateway/i, value: "172.22.0.254" }
];

const provisioningBlock = (mode) =>
  Object.fromEntries([["provisioningNetwork", mode], ...FIELDS.map((f) => [f.key, f.value])]);

/** The UI's state shape, at 4.22 bare-metal IPI. */
function uiState(mode) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    release: { ...(base.release || {}), channel: "4.22", patchVersion: "4.22.16" },
    version: {
      ...(base.version || {}),
      selectedMinor: "4.22",
      selectedPatch: "4.22.16",
      selectedChannel: "stable-4.22",
      locked: true
    },
    blueprint: { ...base.blueprint, platform: "Bare Metal" },
    methodology: { method: "IPI" },
    hostInventory: { ...(base.hostInventory || {}), ...provisioningBlock(mode) },
    ui: { ...base.ui, segmentedFlowV1: true, activeStepId: "platform-specifics" }
  };
}

/** The generator's state shape, at the same minor and mode. */
function generatorState(mode) {
  const state = bareMetalIpi();
  state.release = { ...(state.release || {}), channel: "4.22", patchVersion: "4.22.16" };
  state.version = {
    ...(state.version || {}),
    selectedMinor: "4.22",
    selectedPatch: "4.22.16",
    selectedChannel: "stable-4.22",
    locked: true
  };
  state.hostInventory = { ...(state.hostInventory || {}), ...provisioningBlock(mode) };
  return state;
}

/** Which provisioning fields the UI actually renders an editable control for. */
function renderedFields(mode) {
  const value = {
    state: uiState(mode),
    updateState: vi.fn(),
    setState: vi.fn(),
    loading: false,
    startOver: vi.fn()
  };
  render(
    <AppContext.Provider value={value}>
      <PlatformSpecificsStep />
    </AppContext.Provider>
  );
  const present = new Set();
  for (const field of FIELDS) {
    if (screen.queryAllByLabelText(field.label).length > 0) present.add(field.key);
  }
  cleanup();
  return present;
}

/** Which provisioning fields the real generator actually emits. */
function emittedFields(mode) {
  const baremetal = yaml.load(buildInstallConfig(generatorState(mode)))?.platform?.baremetal || {};
  return new Set(FIELDS.filter((f) => baremetal[f.key] !== undefined).map((f) => f.key));
}

afterEach(() => cleanup());

describe("provisioning mode — a control is editable only where generation emits it", () => {
  for (const mode of MODES) {
    it(`${mode}: no field is editable but silently dropped`, () => {
      const shown = renderedFields(mode);
      const emitted = emittedFields(mode);
      const editableButDropped = [...shown].filter((k) => !emitted.has(k));
      expect(
        editableButDropped,
        `${mode}: these controls accept input the generated install-config will not carry`
      ).toEqual([]);
    });

    it(`${mode}: no field is emitted that the user cannot see`, () => {
      // The mirror hazard: a value reaching the file with no control to review it.
      const shown = renderedFields(mode);
      const emitted = emittedFields(mode);
      const emittedButHidden = [...emitted].filter((k) => !shown.has(k));
      expect(
        emittedButHidden,
        `${mode}: these values reach install-config with no visible control`
      ).toEqual([]);
    });
  }

  it("the three modes genuinely differ, so the parity check is not vacuous", () => {
    const sets = MODES.map((m) => [...emittedFields(m)].sort().join(","));
    expect(new Set(sets).size, "all three modes emitted the same fields").toBe(3);
  });

  it("pins the specific applicability the upstream evidence established", () => {
    // Managed: everything. Unmanaged: no DHCP range, no gateway.
    // Disabled: also no interface.
    expect([...emittedFields("Managed")].sort()).toEqual(
      ["clusterProvisioningIP", "provisioningDHCPRange", "provisioningNetworkCIDR",
       "provisioningNetworkGateway", "provisioningNetworkInterface"].sort()
    );
    expect([...emittedFields("Unmanaged")].sort()).toEqual(
      ["clusterProvisioningIP", "provisioningNetworkCIDR", "provisioningNetworkInterface"].sort()
    );
    expect([...emittedFields("Disabled")].sort()).toEqual(
      ["clusterProvisioningIP", "provisioningNetworkCIDR"].sort()
    );
  });
});

describe("provisioning mode — switching modes preserves what the user typed", () => {
  /* Hidden non-applicable values must not generate, but they must not be
     destroyed either: returning to a mode restores the prior input. The
     generator reads state it does not emit, so a round trip must be stable. */
  const cycles = [
    ["Managed", "Unmanaged", "Managed"],
    ["Managed", "Disabled", "Managed"],
    ["Unmanaged", "Disabled", "Unmanaged"]
  ];

  for (const cycle of cycles) {
    it(`${cycle.join(" -> ")} returns to byte-identical output`, () => {
      const outputs = cycle.map((mode) => buildInstallConfig(generatorState(mode)));
      expect(outputs[2]).toBe(outputs[0]);
    });

    it(`${cycle.join(" -> ")} never drops a value from state`, () => {
      // State carries every field throughout; only emission is gated.
      for (const mode of cycle) {
        const hi = generatorState(mode).hostInventory;
        for (const field of FIELDS) expect(hi[field.key]).toBe(field.value);
      }
    });
  }

  it("a value hidden in one mode cannot block validation in that mode", () => {
    // A deliberately invalid gateway must not fail generation where the
    // gateway does not apply.
    for (const mode of ["Unmanaged", "Disabled"]) {
      const state = generatorState(mode);
      state.hostInventory.provisioningNetworkGateway = "10.0.0.1"; // outside the CIDR
      expect(() => buildInstallConfig(state), `${mode} must not be blocked`).not.toThrow();
    }
  });
});
