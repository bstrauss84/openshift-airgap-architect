/**
 * OpenShift Airgap Architect - Test Suite
 *
 * R5: comma-delimited input editing contract (Backspace/cursor behavior).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppContext } from "../src/store.jsx";
import PlatformSpecificsStep from "../src/steps/PlatformSpecificsStep.jsx";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(() => Promise.resolve({})) }));

function vsphereState() {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    blueprint: { ...base.blueprint, platform: "VMware vSphere" },
    methodology: { method: "Agent-Based Installer" },
    credentials: {
      pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
      sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test"
    },
    platformConfig: {
      vsphere: {
        placementMode: "failureDomains",
        failureDomains: [
          {
            name: "fd-0",
            region: "",
            zone: "",
            server: "",
            topology: { computeCluster: "", datacenter: "", datastore: "", networks: [], folder: "", resourcePool: "", template: "" }
          }
        ]
      }
    },
    ui: { ...base.ui, segmentedFlowV1: true, activeStepId: "platform-specifics" }
  };
}

/** Stateful harness so controlled inputs actually round-trip through app state. */
function Harness({ initial, onState }) {
  const [state, setState] = React.useState(initial);
  const updateState = React.useCallback((patch) => {
    setState((prev) => {
      const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
      onState?.(next);
      return next;
    });
  }, [onState]);
  return (
    <AppContext.Provider value={{ state, updateState, setState, loading: false, startOver: vi.fn() }}>
      <PlatformSpecificsStep />
    </AppContext.Provider>
  );
}

function getNetworksInput() {
  return screen.getByPlaceholderText(/VM Network or VM Network, DPG-1/i);
}

describe("R5: comma-delimited Networks field editing contract", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it("typing a multi-item comma list preserves exactly what the user typed", async () => {
    const user = userEvent.setup();
    render(<Harness initial={vsphereState()} />);
    const input = getNetworksInput();
    await user.click(input);
    await user.keyboard("ergseg, rtyertyer,");
    expect(input).toHaveValue("ergseg, rtyertyer,");
  });

  it("Backspace from the end deletes the entire field continuously (no sticking at commas)", async () => {
    const user = userEvent.setup();
    render(<Harness initial={vsphereState()} />);
    const input = getNetworksInput();
    await user.click(input);
    await user.keyboard("ergseg, rtyertyer,");
    const typed = input.value;
    expect(typed.length).toBeGreaterThan(0);

    // One Backspace per character must empty the field. If the value is
    // reconstructed by split/trim/join on each keystroke, deletion stalls at
    // comma boundaries and the field never empties.
    for (let i = 0; i < typed.length; i++) {
      await user.keyboard("{Backspace}");
    }
    expect(input).toHaveValue("");
  });

  it("a single Backspace always shortens the value by exactly one character", async () => {
    const user = userEvent.setup();
    render(<Harness initial={vsphereState()} />);
    const input = getNetworksInput();
    await user.click(input);
    await user.keyboard("aa, bb");
    // "aa, bb" -> delete back through the space and comma one char at a time
    const expected = ["aa, b", "aa, ", "aa,", "aa", "a", ""];
    for (const want of expected) {
      await user.keyboard("{Backspace}");
      expect(input).toHaveValue(want);
    }
  });

  it("supports mid-string editing without caret jumping to the end", async () => {
    const user = userEvent.setup();
    render(<Harness initial={vsphereState()} />);
    const input = getNetworksInput();
    await user.click(input);
    await user.keyboard("alpha, beta");
    // Place caret right after "alpha" (index 5) and type "X"
    input.setSelectionRange(5, 5);
    await user.keyboard("X");
    expect(input).toHaveValue("alphaX, beta");
    expect(input.selectionStart).toBe(6);
  });

  it("pasting a comma-delimited value works", async () => {
    const user = userEvent.setup();
    render(<Harness initial={vsphereState()} />);
    const input = getNetworksInput();
    await user.click(input);
    await user.paste("DPG-Management, DPG-Storage");
    expect(input).toHaveValue("DPG-Management, DPG-Storage");
  });

  it("commits a normalized array with no empty entries on blur", async () => {
    const user = userEvent.setup();
    let latest = null;
    render(<Harness initial={vsphereState()} onState={(s) => { latest = s; }} />);
    const input = getNetworksInput();
    await user.click(input);
    await user.keyboard("VM Network, , DPG-1,");
    await user.tab();
    const nets = latest?.platformConfig?.vsphere?.failureDomains?.[0]?.topology?.networks;
    expect(nets).toEqual(["VM Network", "DPG-1"]);
  });

  it("clearing the field commits an empty list", async () => {
    const user = userEvent.setup();
    let latest = null;
    render(<Harness initial={vsphereState()} onState={(s) => { latest = s; }} />);
    const input = getNetworksInput();
    await user.click(input);
    await user.keyboard("one, two");
    await user.clear(input);
    await user.tab();
    const nets = latest?.platformConfig?.vsphere?.failureDomains?.[0]?.topology?.networks;
    expect(nets).toEqual([]);
  });
});
