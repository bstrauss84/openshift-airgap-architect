/**
 * Selected Operators must be visible whenever canonical state holds resolved
 * operators — including on a mount that already starts with a selection, which
 * is exactly what happens after a cross-minor reconciliation, a run import, or
 * a page reload.
 *
 * The three active-selection representations (Quick Pick, Selected Operators,
 * generated ImageSet) must agree. Canonical state and the generator were
 * already correct; this covers the view that was not.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import { AppContext } from "../src/store.jsx";
import OperatorsStep from "../src/steps/OperatorsStep.jsx";
import { catalogImagesForMinor } from "../src/shared/operatorMinorReconciliation.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

const ODF = (minor) => ({
  name: "odf-operator",
  id: "odf-operator-redhat",
  displayName: "OpenShift Data Foundation",
  catalogImage: catalogImagesForMinor(minor).redhat,
  defaultChannel: `stable-${minor}`,
  sources: ["odf"],
});

/** State as it exists *after* a successful cross-minor reconciliation. */
function reconciledState(minor) {
  return {
    blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: true },
    methodology: { method: "IPI" },
    version: {
      _schemaVersion: 3,
      selectedMinor: minor,
      selectedPatch: `${minor}.8`,
      selectedChannel: `stable-${minor}`,
      locked: true,
      confirmedByUser: true,
    },
    release: { channel: minor, patchVersion: `${minor}.8`, confirmed: true },
    credentials: { pullSecretPlaceholder: '{"auths":{"quay.io":{}}}' },
    operators: {
      selected: [ODF(minor)],
      catalogs: {
        redhat: [{ id: "odf-operator-redhat", name: "odf-operator", displayName: "OpenShift Data Foundation", defaultChannel: `stable-${minor}` }],
        certified: [],
        community: [],
      },
      version: minor,
      scenarios: { odf: true },
      pendingScenarios: {},
      scenarioAdded: { "odf-operator-redhat": { odf: true } },
      scanJobs: {},
      stale: false,
    },
    imagesetConfig: {},
    reviewFlags: {},
    ui: { visitedSteps: { operators: true }, activeStepId: "operators" },
  };
}

function renderOperators(state) {
  return render(
    <AppContext.Provider
      value={{ state, updateState: vi.fn(), setState: vi.fn(), loading: false, startOver: vi.fn() }}
    >
      <OperatorsStep />
    </AppContext.Provider>
  );
}

/** Inline max-height the grid wrapper is collapsed to, in px. */
function selectedGridMaxHeightPx() {
  const wrapper = document.querySelector(".selected-grid-wrapper");
  expect(wrapper, "Selected Operators grid wrapper must render").not.toBeNull();
  return Number.parseFloat(String(wrapper.style.maxHeight).replace("px", ""));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(apiFetch).mockImplementation((path) => {
    if (String(path).startsWith("/api/operators/credentials")) return Promise.resolve({ available: false });
    if (String(path).startsWith("/api/operators/status")) {
      return Promise.resolve({ redhat: [], certified: [], community: [] });
    }
    return Promise.resolve({});
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(["4.20", "4.21"])("Selected Operators visibility on a pre-populated mount (%s)", (minor) => {
  it("renders the selected operator card", async () => {
    renderOperators(reconciledState(minor));
    expect(await screen.findByText("OpenShift Data Foundation")).toBeInTheDocument();
  });

  it("does not collapse the Selected Operators grid to zero height", async () => {
    renderOperators(reconciledState(minor));
    await screen.findByText("OpenShift Data Foundation");
    // The regression: actualRowCount was memoised from a ref that is null on the
    // first render and only recomputed when selected.length changed, so a mount
    // that already has a selection pinned max-height at 0px and the section
    // looked empty until the user toggled a selection.
    await waitFor(() => {
      expect(selectedGridMaxHeightPx()).toBeGreaterThan(0);
    });
  });

  it("keeps the count badge consistent with what is shown", async () => {
    renderOperators(reconciledState(minor));
    await screen.findByText("OpenShift Data Foundation");
    expect(screen.getByText("(1)")).toBeInTheDocument();
  });

  it("shows the resolved current-minor channel on the card", async () => {
    renderOperators(reconciledState(minor));
    expect(await screen.findByText(`Default channel: stable-${minor}`)).toBeInTheDocument();
  });

  it("presents the reconciled Quick Pick as active alongside it", async () => {
    renderOperators(reconciledState(minor));
    await screen.findByText("OpenShift Data Foundation");
    await waitFor(() => {
      const active = document.querySelector('.scenario-pick[data-selection-state="active"]');
      expect(active).not.toBeNull();
    });
  });

  it("stays visible without any unselect/reselect cycle", async () => {
    renderOperators(reconciledState(minor));
    await screen.findByText("OpenShift Data Foundation");
    const before = selectedGridMaxHeightPx();
    // No user interaction at all between mount and this assertion.
    await new Promise((r) => setTimeout(r, 120));
    expect(selectedGridMaxHeightPx()).toBe(before);
    expect(before).toBeGreaterThan(0);
  });

  it("recovers height when the viewport resizes", async () => {
    renderOperators(reconciledState(minor));
    await screen.findByText("OpenShift Data Foundation");
    fireEvent(window, new Event("resize"));
    await waitFor(() => {
      expect(selectedGridMaxHeightPx()).toBeGreaterThan(0);
    });
  });
});

describe("empty selection still collapses", () => {
  it("allocates no rows when nothing is selected", async () => {
    const state = reconciledState("4.21");
    state.operators.selected = [];
    state.operators.scenarios = {};
    renderOperators(state);
    await screen.findByText("No operators selected.");
    expect(selectedGridMaxHeightPx()).toBe(0);
  });
});
