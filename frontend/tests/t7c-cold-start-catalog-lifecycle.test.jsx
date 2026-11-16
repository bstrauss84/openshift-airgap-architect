/**
 * Tranche 7C — cold-start catalog lifecycle.
 *
 * THE BUG THE HUMAN HIT. On first load after a container build — and again
 * after Start Over — the app rendered the ErrorBoundary:
 *
 *   CatalogNotLoadedError: Catalogs for OpenShift 4.20 have not been loaded.
 *     at getCatalogForScenario → getCatalogParameters
 *     → getRequiredParamsForOutput → validateStep → AppShell useMemo
 *
 * MECHANISM. `catalogResolver` defaulted a missing selected minor to `'4.20'`.
 * With no version chosen yet, `VersionSupportGate` returns children without
 * loading anything (it has no minor to load), AppShell still validates every
 * step, and the defaulted read hit a catalog that was never resident.
 *
 * WHY EVERY EXISTING TEST PASSED. `frontend/tests/setup.js` preloads every
 * supported minor's catalogs before every test file, to reproduce the
 * application's POST-gate state. There is a real PRE-gate state — no version
 * selected — that the preload made unobservable. These tests defeat the
 * preload with `__resetCatalogCacheForTests()` so the genuine cold condition is
 * exercised.
 *
 * WHY THESE FAIL IF THE DEFECT RETURNS. Restoring `|| '4.20'` in
 * `catalogResolver` makes the no-version cases below throw
 * CatalogNotLoadedError instead of returning an empty requirement set, and the
 * AppShell render test falls into the ErrorBoundary again.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import React from "react";

import {
  __resetCatalogCacheForTests,
  ensureCatalogsForMinor,
  areCatalogsLoadedForMinor,
  getCatalogForScenario,
  CatalogNotLoadedError,
} from "../src/catalogPaths.js";
import { getRequiredParamsForOutput, getParamMeta } from "../src/catalogResolver.js";
import { validateStep } from "../src/validation.js";
import { computeVisibleWizardRows } from "../src/wizardVisibleSteps.js";
import { SUPPORTED_MINORS } from "../src/shared/versionPolicy.js";

/* The real App tree, over a store we control. See helpers/store-harness.jsx. */
const harness = vi.hoisted(() => ({ initialState: null }));
vi.mock("../src/store.jsx", async (importOriginal) => {
  const actual = await importOriginal();
  const { makeStoreMock } = await import("./helpers/store-harness.jsx");
  return makeStoreMock(actual, harness);
});
const { default: App } = await import("../src/App.jsx");

/** Restore the suite-wide warm cache the global setup established. */
async function rewarmAllCatalogs() {
  await Promise.all(SUPPORTED_MINORS.map((m) => ensureCatalogsForMinor(m)));
}

/**
 * A brand-new run — exactly what the user saw on first load.
 *
 * THE FIXTURE IS THE BUG. This mirrors `defaultState()` in
 * `backend/src/index.js:337`, and the two fields that matter are easy to miss:
 * the backend pre-populates `blueprint.platform` and `methodology.method`, so
 * `getScenarioId()` resolves to "bare-metal-agent" on the very first render,
 * while `version` carries no selected minor at all. A catalog read is
 * therefore attempted before any version exists — and with the old
 * `|| '4.20'` default it read a minor that lazy loading had never fetched.
 *
 * An "empty" fixture with no platform or methodology does NOT reproduce this:
 * `getRequiredParamsForOutput` short-circuits on a missing scenarioId and the
 * defect stays invisible. That is precisely how it reached a user.
 */
const freshState = () => ({
  _schemaVersion: 3,
  version: {
    _schemaVersion: 3,
    selectedChannel: null,
    selectedVersion: null,
    versionConfirmed: false,
    confirmedByUser: false,
  },
  release: { channel: null, patchVersion: null, confirmed: false, followLatestMinor: true },
  blueprint: { arch: "x86_64", platform: "Bare Metal", baseDomain: "example.com", clusterName: "airgap-cluster", confirmed: false },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: { nodes: [] },
  operators: { selected: [] },
  ui: { activeStepId: "blueprint", visitedSteps: {}, completedSteps: {} },
});

const lockedState = (minor) => ({
  ...freshState(),
  version: { _schemaVersion: 3, selectedMinor: minor, selectedPatch: `${minor}.1`, selectedChannel: `stable-${minor}`, locked: true },
  release: { channel: minor, patchVersion: `${minor}.1`, confirmed: true },
  blueprint: { platform: "Bare Metal", arch: "x86_64", clusterName: "c", baseDomain: "example.com" },
  methodology: { method: "Agent-Based Installer" },
});

describe("T7C — COLD cache: no version selected must not read any catalog", () => {
  beforeEach(() => { __resetCatalogCacheForTests(); });
  afterEach(async () => { await rewarmAllCatalogs(); });

  it("the cache really is cold — otherwise this whole file proves nothing", () => {
    for (const m of SUPPORTED_MINORS) expect(areCatalogsLoadedForMinor(m)).toBe(false);
  });

  it("getRequiredParamsForOutput returns no requirements instead of throwing", () => {
    expect(getRequiredParamsForOutput("bare-metal-agent", "install-config.yaml", freshState())).toEqual([]);
  });

  it("getParamMeta returns null instead of throwing", () => {
    expect(getParamMeta("bare-metal-agent", "platform.baremetal.apiVIPs", "install-config.yaml", freshState())).toBeNull();
  });

  it("validateStep runs for every wizard step without throwing", () => {
    // AppShell's errorFlags/incompleteStepLabels useMemos run validateStep over
    // every visible row. The row list comes from production
    // (computeVisibleWizardRows) rather than a hardcoded copy, so a future step
    // is covered automatically instead of silently escaping this guard.
    const state = freshState();
    const ids = computeVisibleWizardRows(state, {}).map((r) => r.id);
    expect(ids.length, "no wizard rows — the loop below would be vacuous").toBeGreaterThan(0);
    for (const id of ids) {
      expect(() => validateStep(state, id), `validateStep("${id}") threw on a fresh run`).not.toThrow();
    }
  });

  it("validateStep also survives the segmented flow's row set", () => {
    // The legacy and segmented flows expose different steps, and only the
    // segmented set reaches some catalog-backed validators.
    const state = freshState();
    state.ui.segmentedFlowV1 = true;
    const ids = computeVisibleWizardRows(state, {}).map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(() => validateStep(state, id), `validateStep("${id}") threw on a fresh run`).not.toThrow();
    }
  });

  it("validateStep still returns a usable result shape, not a swallowed error", () => {
    const r = validateStep(freshState(), "blueprint");
    expect(r).toBeTruthy();
    expect(Array.isArray(r.errors)).toBe(true);
  });
});

describe("T7C — COLD cache: a SELECTED minor still fails closed", () => {
  // The fix must not become a blanket "return empty on any unloaded catalog".
  beforeEach(() => { __resetCatalogCacheForTests(); });
  afterEach(async () => { await rewarmAllCatalogs(); });

  it("reading a selected minor's unloaded catalog throws CatalogNotLoadedError", () => {
    expect(() => getCatalogForScenario("bare-metal-agent", "4.22")).toThrow(CatalogNotLoadedError);
  });

  it("getRequiredParamsForOutput throws when a REAL selected minor is not resident", () => {
    expect(() => getRequiredParamsForOutput("bare-metal-agent", "install-config.yaml", lockedState("4.22")))
      .toThrow(CatalogNotLoadedError);
  });

  it("no 4.20 fallback is reintroduced: a 4.22 state never reads 4.20 data", async () => {
    await ensureCatalogsForMinor("4.20");
    expect(areCatalogsLoadedForMinor("4.20")).toBe(true);
    expect(areCatalogsLoadedForMinor("4.22")).toBe(false);
    // With only 4.20 resident, a 4.22 state must still fail rather than
    // silently answering from the baseline catalog.
    expect(() => getRequiredParamsForOutput("bare-metal-agent", "install-config.yaml", lockedState("4.22")))
      .toThrow(CatalogNotLoadedError);
  });
});

describe("T7C — WARM cache behaves normally", () => {
  it("a selected, resident minor returns real requirements", async () => {
    await rewarmAllCatalogs();
    const req = getRequiredParamsForOutput("bare-metal-agent", "install-config.yaml", lockedState("4.22"));
    expect(Array.isArray(req)).toBe(true);
    expect(req.length).toBeGreaterThan(0);
  });

  it("every supported minor resolves its own requirements", async () => {
    await rewarmAllCatalogs();
    for (const m of SUPPORTED_MINORS) {
      expect(getRequiredParamsForOutput("bare-metal-agent", "install-config.yaml", lockedState(m)).length)
        .toBeGreaterThan(0);
    }
  });
});

describe("T7C — load races", () => {
  beforeEach(() => { __resetCatalogCacheForTests(); });
  afterEach(async () => { await rewarmAllCatalogs(); });

  it("a pending load is not mistaken for a resident one", async () => {
    const pending = ensureCatalogsForMinor("4.22");
    // Synchronously after kicking off the load, residency must still be false.
    expect(areCatalogsLoadedForMinor("4.22")).toBe(false);
    await pending;
    expect(areCatalogsLoadedForMinor("4.22")).toBe(true);
  });

  it("concurrent loads of the same minor settle consistently", async () => {
    const [a, b, c] = await Promise.all([
      ensureCatalogsForMinor("4.21"),
      ensureCatalogsForMinor("4.21"),
      ensureCatalogsForMinor("4.21"),
    ]);
    expect([a, b, c]).toEqual(["4.21", "4.21", "4.21"]);
    expect(areCatalogsLoadedForMinor("4.21")).toBe(true);
  });

  it("loading one minor does not make another appear resident", async () => {
    await ensureCatalogsForMinor("4.21");
    expect(areCatalogsLoadedForMinor("4.21")).toBe(true);
    expect(areCatalogsLoadedForMinor("4.20")).toBe(false);
    expect(areCatalogsLoadedForMinor("4.22")).toBe(false);
  });

  it("switching minor mid-load leaves no stale residency claim", async () => {
    const first = ensureCatalogsForMinor("4.20");
    const second = ensureCatalogsForMinor("4.22");
    await Promise.all([first, second]);
    expect(areCatalogsLoadedForMinor("4.20")).toBe(true);
    expect(areCatalogsLoadedForMinor("4.22")).toBe(true);
    // Residency is per-minor and derived from the cache, never from which
    // promise resolved last.
    expect(areCatalogsLoadedForMinor("4.21")).toBe(false);
  });
});


/* ------------------------------------------------------------------ */
/* The layer the user actually hit: a real render of the real App tree   */
/* ------------------------------------------------------------------ */

describe("T7C — the real App tree mounts on a cold start", () => {
  /**
   * The crash surfaced inside AppShell's `errorFlags` useMemo (App.jsx:529 in
   * the human's stack trace), so the regression needs a render of the real
   * component tree, not just a helper call. The store is replaced (see
   * `helpers/store-harness.jsx`); ErrorBoundary, VersionSupportGate and
   * AppShell are entirely real.
   *
   * NOTE ON MODULE IDENTITY. These tests deliberately do NOT call
   * `vi.resetModules()`. Doing so would give the App tree its own copy of
   * `catalogPaths.js` with its own cache, so `__resetCatalogCacheForTests()`
   * and `areCatalogsLoadedForMinor()` in this file would be inspecting a
   * different module instance than the one the app reads — every residency
   * assertion would pass vacuously.
   */
  beforeEach(() => { __resetCatalogCacheForTests(); });
  afterEach(async () => { cleanup(); vi.restoreAllMocks(); await rewarmAllCatalogs(); });

  async function mountApp(state) {
    harness.initialState = state;
    const consoleErrors = [];
    vi.spyOn(console, "error").mockImplementation((...a) => consoleErrors.push(a.map(String).join(" ")));
    render(<App />);
    return consoleErrors;
  }

  it("a fresh run with no version selected does not fall into the ErrorBoundary", async () => {
    const consoleErrors = await mountApp(freshState());

    // The ErrorBoundary's own heading. Its presence IS the reported bug.
    expect(screen.queryByText(/Something went wrong/i)).toBeNull();
    // ...and the recovery affordance the user had to click twice.
    expect(screen.queryByRole("button", { name: /Refresh page/i })).toBeNull();

    const fatal = consoleErrors.filter((e) =>
      /CatalogNotLoadedError|error occurred in the <AppShell>/.test(e)
    );
    expect(fatal, `catalog/boundary errors on cold start:\n${fatal.join("\n")}`).toEqual([]);
  });

  it("the fresh run renders the landing page, so the check above is not vacuous", async () => {
    await mountApp(freshState());
    expect(screen.getByRole("button", { name: /Start new install/i })).toBeTruthy();
  });

  it("no catalogs were loaded, because no version was selected", async () => {
    await mountApp(freshState());
    for (const m of SUPPORTED_MINORS) {
      expect(areCatalogsLoadedForMinor(m), `${m} loaded with no version selected`).toBe(false);
    }
  });

  it("a run WITH a selected minor still loads through the gate and reaches the wizard", async () => {
    // The complementary half: the fix removed a bogus default, it must not have
    // disabled the gate. Only the selected minor may be loaded.
    const consoleErrors = await mountApp(lockedState("4.22"));

    await waitFor(() => expect(areCatalogsLoadedForMinor("4.22")).toBe(true));
    await waitFor(() => expect(screen.queryByText(/Loading OpenShift/i)).toBeNull());

    expect(screen.queryByText(/Something went wrong/i)).toBeNull();
    expect(consoleErrors.filter((e) => /CatalogNotLoadedError/.test(e))).toEqual([]);
    expect(areCatalogsLoadedForMinor("4.20")).toBe(false);
    expect(areCatalogsLoadedForMinor("4.21")).toBe(false);
  });
});
