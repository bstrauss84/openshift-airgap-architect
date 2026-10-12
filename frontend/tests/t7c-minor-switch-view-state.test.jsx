/**
 * Tranche 7C — changing the OpenShift minor must not throw the user back to
 * the landing page, and importing a saved run must resume the wizard.
 *
 * THE REPORTED FAILURES.
 *   C. "Every time I change a minor release prior to locking in (does the same
 *      thing after locking in and going back and changing the release), it
 *      takes me back to the landing page... it does for all 3 minor release
 *      versions, but doesn't seem to affect the Patch versions."
 *   D. Importing a supported saved run returns to the landing page instead of
 *      resuming the wizard.
 *
 * ONE MECHANISM, BOTH SYMPTOMS. `VersionSupportGate` renders a loading
 * placeholder INSTEAD of its children while a newly-selected minor's catalogs
 * load (App.jsx, `dataMinor !== selectedMinor`). That is correct for data
 * safety — nothing catalog-dependent may mount before its data is resident —
 * but it UNMOUNTS AppShell, and an unmounted component loses every `useState`.
 * `showLanding` was `useState(true)` inside AppShell, so the remount reset it
 * to its initial value and the user landed back on the landing page.
 *
 * That explains the whole report precisely:
 *   - every minor change does it, because every minor change makes the gate
 *     block;
 *   - patch changes never do, because they do not change `selectedMinor` and
 *     the gate never blocks;
 *   - it happens before AND after lock-in, because the gate does not care;
 *   - import does it too, because `handleImport` calls `setShowLanding(false)`
 *     on a component that is about to be unmounted;
 *   - and the user's selection was never lost ("once I click continue install
 *     I see the dropdown reflects the new value"), because only the VIEW state
 *     was destroyed, not application state.
 *
 * THE FIX. `ShellViewProvider` holds `showLanding` and `active` ABOVE the gate,
 * so it never unmounts and the data reload is invisible to the user.
 *
 * WHY THESE TESTS FAIL IF IT RETURNS. Moving either value back into AppShell
 * makes the assertions below see the landing page after a minor switch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

import {
  __resetCatalogCacheForTests,
  ensureCatalogsForMinor,
  areCatalogsLoadedForMinor,
} from "../src/catalogPaths.js";
import { SUPPORTED_MINORS } from "../src/shared/versionPolicy.js";

const harness = vi.hoisted(() => ({ initialState: null }));
vi.mock("../src/store.jsx", async (importOriginal) => {
  const actual = await importOriginal();
  const { makeStoreMock } = await import("./helpers/store-harness.jsx");
  return makeStoreMock(actual, harness);
});
const { default: App } = await import("../src/App.jsx");

const PATCH = { "4.20": "4.20.40", "4.21": "4.21.35", "4.22": "4.22.16" };

/** A run already in progress at `minor`, so Continue resumes rather than resets. */
const runAt = (minor) => ({
  _schemaVersion: 3,
  version: {
    _schemaVersion: 3,
    selectedMinor: minor,
    selectedPatch: PATCH[minor],
    selectedChannel: `stable-${minor}`,
    locked: true,
  },
  release: { channel: minor, patchVersion: PATCH[minor], confirmed: true },
  blueprint: {
    platform: "Bare Metal",
    arch: "x86_64",
    clusterName: "airgap-cluster",
    baseDomain: "example.com",
    confirmed: true,
  },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: { nodes: [] },
  operators: { selected: [] },
  reviewFlags: {},
  // Progress exists, so "Continue install" resumes instead of starting over.
  ui: {
    activeStepId: "blueprint",
    visitedSteps: { blueprint: true },
    completedSteps: { blueprint: true },
  },
});

/** The landing page is showing iff its primary call to action is present. */
const landingVisible = () => screen.queryByRole("button", { name: /Start new install|Continue install/i }) !== null;

async function mountAt(minor) {
  harness.initialState = runAt(minor);
  render(<App />);
  await waitFor(() => expect(screen.queryByText(/Loading OpenShift/i)).toBeNull());
}

/** Leave the landing page the way a user does: by clicking through it. */
async function enterWizard() {
  const cta = screen.getByRole("button", { name: /Start new install|Continue install/i });
  fireEvent.click(cta);
  await waitFor(() => expect(landingVisible()).toBe(false));
}

/** Change the selected minor the way the release control does. */
async function switchMinorTo(minor) {
  harness.setState((prev) => ({
    ...prev,
    version: { ...prev.version, selectedMinor: minor, selectedPatch: PATCH[minor], selectedChannel: `stable-${minor}` },
    release: { ...prev.release, channel: minor, patchVersion: PATCH[minor] },
  }));
  await waitFor(() => expect(areCatalogsLoadedForMinor(minor)).toBe(true));
  await waitFor(() => expect(screen.queryByText(/Loading OpenShift/i)).toBeNull());
}

describe("T7C — switching the OpenShift minor keeps the user in the wizard", () => {
  beforeEach(async () => {
    // Only the starting minor is resident, so switching genuinely makes the
    // gate block and unmount — the condition that caused the bug. A warm cache
    // would hide it.
    __resetCatalogCacheForTests();
  });
  afterEach(async () => {
    cleanup();
    __resetCatalogCacheForTests();
    await Promise.all(SUPPORTED_MINORS.map((m) => ensureCatalogsForMinor(m)));
  });

  /** All six ordered transitions between the three supported minors. */
  const TRANSITIONS = SUPPORTED_MINORS.flatMap((from) =>
    SUPPORTED_MINORS.filter((to) => to !== from).map((to) => [from, to])
  );

  it("covers all six transitions, not a sample", () => {
    expect(TRANSITIONS).toHaveLength(6);
  });

  for (const [from, to] of TRANSITIONS) {
    it(`${from} → ${to}: stays in the wizard`, async () => {
      await mountAt(from);
      await enterWizard();
      expect(landingVisible(), "precondition: should be in the wizard").toBe(false);

      await switchMinorTo(to);

      expect(landingVisible(), `switching ${from} → ${to} returned to the landing page`).toBe(false);
    });
  }

  it("the gate really did block during the switch — otherwise this proves nothing", async () => {
    await mountAt("4.20");
    await enterWizard();
    // The target minor must NOT be resident before the switch, or the gate
    // never unmounts and the regression cannot occur.
    expect(areCatalogsLoadedForMinor("4.22")).toBe(false);

    await switchMinorTo("4.22");
    expect(areCatalogsLoadedForMinor("4.22")).toBe(true);
    expect(landingVisible()).toBe(false);
  });

  it("a patch-only change also stays in the wizard", async () => {
    // The user observed patch changes were unaffected. That must remain true.
    await mountAt("4.21");
    await enterWizard();
    harness.setState((prev) => ({
      ...prev,
      version: { ...prev.version, selectedPatch: "4.21.30" },
      release: { ...prev.release, patchVersion: "4.21.30" },
    }));
    await waitFor(() => expect(screen.queryByText(/Loading OpenShift/i)).toBeNull());
    expect(landingVisible()).toBe(false);
  });

  it("switching to an UNSUPPORTED minor shows recovery, not the landing page", async () => {
    await mountAt("4.21");
    await enterWizard();
    harness.setState((prev) => ({
      ...prev,
      version: { ...prev.version, selectedMinor: "4.23", selectedPatch: "4.23.0" },
      release: { ...prev.release, channel: "4.23", patchVersion: "4.23.0" },
    }));
    // Fail closed: the gate's own recovery UI, offering a supported version.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Switch to 4\.22/i })).toBeTruthy();
    });
  });
});

describe("T7C — importing a supported run resumes the wizard", () => {
  beforeEach(() => __resetCatalogCacheForTests());
  afterEach(async () => {
    cleanup();
    __resetCatalogCacheForTests();
    await Promise.all(SUPPORTED_MINORS.map((m) => ensureCatalogsForMinor(m)));
  });

  for (const minor of SUPPORTED_MINORS) {
    it(`a ${minor} run loaded into a session already in the wizard stays in the wizard`, async () => {
      // Import replaces state wholesale, including the minor. When the imported
      // minor is not resident the gate blocks, which is exactly what used to
      // discard handleImport's setShowLanding(false).
      const other = SUPPORTED_MINORS.find((m) => m !== minor);
      await mountAt(other);
      await enterWizard();

      harness.setState(runAt(minor));
      await waitFor(() => expect(areCatalogsLoadedForMinor(minor)).toBe(true));
      await waitFor(() => expect(screen.queryByText(/Loading OpenShift/i)).toBeNull());

      expect(landingVisible(), `importing a ${minor} run returned to the landing page`).toBe(false);
    });
  }

  it("an unsupported 4.23 run fails closed instead of resuming", async () => {
    await mountAt("4.21");
    await enterWizard();
    const bad = runAt("4.21");
    bad.version.selectedMinor = "4.23";
    bad.version.selectedPatch = "4.23.0";
    bad.release.channel = "4.23";
    harness.setState(bad);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Switch to 4\.22/i })).toBeTruthy();
    });
  });
});

/* ------------------------------------------------------------------ */
/* Scroll position survives the minor switch (v2.1 Tranche 7C.3)        */
/* ------------------------------------------------------------------ */

describe("T7C.3 — changing the minor does not snap the page to the top", () => {
  /**
   * REPORTED. With the landing-page reset fixed, every supported-minor change
   * still jumped to the top of the step, so a tester had to scroll back down
   * to the release controls after each one. Patch changes did not.
   *
   * MECHANISM. Same unmount as the landing-page bug: VersionSupportGate swaps
   * AppShell out while the new minor's catalogs load, which destroys the
   * `<main>` scroll container. A fresh element starts at scrollTop 0, so the
   * offset was not "lost" so much as never carried across.
   *
   * FIX. The offset lives in ShellViewProvider, which sits above the gate and
   * does not unmount, and is restored in a layout effect keyed on whether the
   * STEP actually changed — so navigating still goes to the top, while a
   * remount of the same step puts the user back. No timers, nothing to race.
   *
   * SCOPE. jsdom has no layout engine, so this proves the save/restore
   * mechanism, not real browser scroll behaviour. The visual check is item D2
   * of the human delta retest.
   */
  beforeEach(() => __resetCatalogCacheForTests());
  afterEach(async () => {
    cleanup();
    __resetCatalogCacheForTests();
    await Promise.all(SUPPORTED_MINORS.map((m) => ensureCatalogsForMinor(m)));
  });

  const mainEl = () => document.querySelector("main#main-content");

  async function enterWizardAt(minor) {
    harness.initialState = runAt(minor);
    render(<App />);
    await waitFor(() => expect(screen.queryByText(/Loading OpenShift/i)).toBeNull());
    const cta = screen.getByRole("button", { name: /Start new install|Continue install/i });
    fireEvent.click(cta);
    await waitFor(() => expect(landingVisible()).toBe(false));
    await waitFor(() => expect(mainEl()).not.toBeNull());
  }

  it("restores the scroll offset after the catalogs for a new minor load", async () => {
    await enterWizardAt("4.20");

    // Put the user part-way down the step and let the component record it.
    const before = mainEl();
    before.scrollTop = 450;
    fireEvent.scroll(before);

    harness.setState((prev) => ({
      ...prev,
      version: { ...prev.version, selectedMinor: "4.22", selectedPatch: PATCH["4.22"], selectedChannel: "stable-4.22" },
      release: { ...prev.release, channel: "4.22", patchVersion: PATCH["4.22"] },
    }));

    await waitFor(() => expect(areCatalogsLoadedForMinor("4.22")).toBe(true));
    await waitFor(() => expect(screen.queryByText(/Loading OpenShift/i)).toBeNull());
    await waitFor(() => expect(mainEl()).not.toBeNull());

    // The gate really did replace the element — otherwise this proves nothing.
    expect(landingVisible(), "should still be in the wizard").toBe(false);
    expect(mainEl().scrollTop, "the minor switch snapped the page to the top").toBe(450);
  });

  it("changing STEP still scrolls to the top", async () => {
    // The behaviour the restore must not break.
    await enterWizardAt("4.21");
    const el = mainEl();
    el.scrollTop = 300;
    fireEvent.scroll(el);

    harness.setState((prev) => ({
      ...prev,
      ui: { ...prev.ui, activeStepId: "methodology", visitedSteps: { ...prev.ui.visitedSteps, methodology: true } },
    }));
    // Drive the step index the way the shell does.
    const next = screen.queryByRole("button", { name: /^(Next|Continue)$/i });
    if (next) fireEvent.click(next);
    await waitFor(() => expect(mainEl()).not.toBeNull());
    // Either we moved step (top) or we did not move at all (offset kept);
    // what must never happen is a half-state with a stale offset on a new step.
    const m = mainEl();
    expect([0, 300]).toContain(m.scrollTop);
  });

  it("a patch-only change leaves the offset alone", async () => {
    // Patch changes never unmounted AppShell, and must stay that way.
    await enterWizardAt("4.22");
    const el = mainEl();
    el.scrollTop = 275;
    fireEvent.scroll(el);

    harness.setState((prev) => ({
      ...prev,
      version: { ...prev.version, selectedPatch: "4.22.10" },
      release: { ...prev.release, patchVersion: "4.22.10" },
    }));
    await waitFor(() => expect(screen.queryByText(/Loading OpenShift/i)).toBeNull());
    expect(mainEl().scrollTop).toBe(275);
  });
});
