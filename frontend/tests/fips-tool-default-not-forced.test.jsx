/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Cluster FIPS vs the downloaded installer variant — two axes, one nudge.
 *
 * Human QA question (7C.4 §20): enabling cluster FIPS should NOT force the FIPS
 * installer variant so the user cannot change it, but it SHOULD default the
 * tool selection to the FIPS variant, because that is what someone building a
 * FIPS cluster normally needs.
 *
 * `frontend/tests/fips-installer-architectures.test.jsx` guards WHICH FIPS
 * binaries are offered. Nothing guarded the default-vs-force contract, so it
 * could only be checked by hand. These are the behavioural tests that retire
 * that manual check:
 *
 *   state.globalStrategy.fips      — the CLUSTER setting
 *   exportOptions.installerUseFips — the DOWNLOADED TOOL setting
 *
 * They must stay independently settable. Enabling the first nudges the second
 * on; nothing may pin it there.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

const handle = vi.hoisted(() => ({ state: null, updateState: null }));

vi.mock("../src/api.js", () => ({
  apiFetch: vi.fn(() => Promise.resolve({ runtimeArch: "amd64", localBinaryArch: "amd64" })),
  API_BASE: "http://localhost:4000"
}));

vi.mock("../src/store.jsx", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useApp: () => ({
      state: handle.state,
      updateState: handle.updateState,
      setState: handle.updateState
    })
  };
});

const { default: ReviewStep } = await import("../src/steps/ReviewStep.jsx");

/** Minimal state that still renders the installer export options. */
function baseState({ fips = false, installerUseFips = false } = {}) {
  return {
    _schemaVersion: 3,
    version: { selectedMinor: "4.22", selectedPatch: "4.22.16", selectedChannel: "stable-4.22", locked: true },
    release: { channel: "4.22", patchVersion: "4.22.16" },
    blueprint: { platform: "Bare Metal", clusterName: "airgap", baseDomain: "example.com", arch: "x86_64" },
    methodology: { method: "IPI" },
    globalStrategy: { fips },
    networking: {},
    hostInventory: { nodes: [] },
    operators: { selected: [] },
    credentials: {},
    trust: {},
    exportOptions: { includeInstaller: true, installerUseFips, includeCredentials: false },
    ui: {}
  };
}

/** Renders ReviewStep against a live, test-controlled state object. */
function renderReview(initial) {
  let current = initial;
  const rerenderers = [];
  handle.state = current;
  handle.updateState = (patch) => {
    current = { ...current, ...patch };
    handle.state = current;
    act(() => { rerenderers.forEach((fn) => fn()); });
  };

  const Harness = () => {
    const [, bump] = React.useReducer((n) => n + 1, 0);
    if (!rerenderers.includes(bump)) rerenderers.push(bump);
    return <ReviewStep />;
  };

  const utils = render(<Harness />);
  return { ...utils, getState: () => current };
}

/** The installer options live inside the collapsed "Advanced / Tools" group. */
function openAdvancedTools() {
  const heading = screen.getByText(/Advanced \/ Tools/i);
  const toggle = heading.closest("button") || heading.parentElement.querySelector("button") || heading;
  act(() => { fireEvent.click(toggle); });
}

const fipsToolSwitch = () => screen.getByLabelText("Include FIPS-enabled installer");

beforeEach(() => {
  handle.state = null;
  handle.updateState = null;
});
afterEach(() => cleanup());

describe("cluster FIPS defaults the installer tool variant but never forces it", () => {
  it("defaults the FIPS installer variant on when cluster FIPS is enabled", () => {
    const { getState } = renderReview(baseState({ fips: true, installerUseFips: false }));
    expect(getState().exportOptions.installerUseFips).toBe(true);
  });

  it("leaves the tool variant alone when cluster FIPS is off", () => {
    const { getState } = renderReview(baseState({ fips: false, installerUseFips: false }));
    expect(getState().exportOptions.installerUseFips).toBe(false);
  });

  it("does not disable the control — the user can still change it", () => {
    // This is the "must not force" half. A disabled switch would be a force.
    renderReview(baseState({ fips: true, installerUseFips: false }));
    openAdvancedTools();
    expect(fipsToolSwitch()).not.toBeDisabled();
  });

  it("respects the user turning the FIPS tool variant back off under cluster FIPS", () => {
    // The auto-default keys on a CHANGE to cluster FIPS, so an explicit opt-out
    // must survive subsequent renders rather than being re-forced on.
    const { getState } = renderReview(baseState({ fips: true, installerUseFips: false }));
    expect(getState().exportOptions.installerUseFips).toBe(true);

    act(() => {
      handle.updateState({
        exportOptions: { ...getState().exportOptions, installerUseFips: false }
      });
    });

    expect(getState().exportOptions.installerUseFips).toBe(false);
    openAdvancedTools();
    expect(fipsToolSwitch()).not.toBeDisabled();
  });

  it("keeps a FIPS tool download selected when cluster FIPS is switched off", () => {
    // Separate axes: the cluster setting must not reach in and clear the
    // download choice either.
    const { getState } = renderReview(baseState({ fips: false, installerUseFips: true }));
    expect(getState().exportOptions.installerUseFips).toBe(true);
  });

  it("tells the user the setting was defaulted, not imposed", () => {
    renderReview(baseState({ fips: true, installerUseFips: true }));
    openAdvancedTools();
    expect(document.body.textContent).toMatch(/Auto-enabled based on FIPS mode/i);
  });
});
