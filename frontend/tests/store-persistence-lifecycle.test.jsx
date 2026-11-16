/**
 * Regression: debounced state persistence must not outlive its owner.
 *
 * FQ-9. `AppProvider` (src/store.jsx) debounces its POST to /api/state by
 * 600 ms and clears that timer in the effect cleanup. If the component tree is
 * never unmounted, the timer survives the test and fires after vitest has reset
 * module mocks, at which point the mocked `apiFetch` is a bare `vi.fn()`
 * returning `undefined` and `undefined.catch` throws. That surfaced as an
 * intermittent non-zero suite exit (~1 run in 5) while every assertion passed.
 *
 * The real `apiFetch` is declared `async` and therefore ALWAYS returns a
 * Promise, so `undefined` is not a production contract and optional chaining
 * would only have hidden the leak. The defect was the missing unmount:
 * tests/setup.js now runs `cleanup()` after every test.
 *
 * These tests are deterministic — fake timers, explicit unmount, explicit
 * advance — so they do not depend on scheduling luck.
 */
import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

import { apiFetch } from "../src/api.js";
import { AppProvider, useApp } from "../src/store.jsx";

// Mirrors the hostile shape used across the suite: a bare vi.fn() whose default
// return value is `undefined`. Reproducing it here is the point of the test.
vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "http://localhost:4000" }));

const DEBOUNCE_MS = 600;

/** Minimal consumer that can mutate state so the persistence effect re-runs. */
function Mutator() {
  const { state, updateState } = useApp();
  return (
    <button type="button" onClick={() => updateState({ scratchpad: `v-${Date.now()}` })}>
      {state ? "ready" : "loading"}
    </button>
  );
}

function hydrated() {
  return {
    _schemaVersion: 3,
    version: { selectedMinor: "4.21", selectedPatch: "4.21.20", selectedChannel: "stable-4.21", locked: false },
    ui: {},
  };
}

/** Count only the debounced persistence calls, ignoring hydration GETs. */
function persistCalls() {
  return vi.mocked(apiFetch).mock.calls.filter(
    ([path, opts]) => path === "/api/state" && opts?.method === "POST"
  );
}

describe("debounced state persistence lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.mocked(apiFetch).mockReset();
    // Hydration GET plus any POST both resolve, as production always does.
    vi.mocked(apiFetch).mockImplementation(() => Promise.resolve(hydrated()));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("unmounting before the debounce elapses cancels the pending POST", async () => {
    const { unmount } = render(
      <AppProvider>
        <Mutator />
      </AppProvider>
    );

    // Let hydration settle so the persistence effect has scheduled its timer.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const before = persistCalls().length;

    // The lifecycle transition under test: the owner goes away first.
    unmount();

    // Now push well past the debounce window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3);
    });

    expect(persistCalls().length).toBe(before);
  });

  test("the cancelled timer cannot invoke a reset mock after teardown", async () => {
    // This is the exact failure shape: the mock is reset to its bare form
    // (returning undefined) in the window between unmount and timer expiry.
    // Before the fix the timer still fired here and threw
    // "Cannot read properties of undefined (reading 'catch')".
    const { unmount } = render(
      <AppProvider>
        <Mutator />
      </AppProvider>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    unmount();

    // Teardown-equivalent: apiFetch now returns undefined, as a bare vi.fn() does.
    vi.mocked(apiFetch).mockReset();
    expect(vi.mocked(apiFetch)()).toBeUndefined();

    let thrown = null;
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3);
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeNull();
    // Only the probe call above; the debounced POST never fired.
    expect(persistCalls().length).toBe(0);
  });

  test("a mounted provider still persists after the debounce elapses", async () => {
    // Guards against 'fixing' the leak by disabling persistence.
    render(
      <AppProvider>
        <Mutator />
      </AppProvider>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);
    });

    const posts = persistCalls();
    expect(posts.length).toBeGreaterThan(0);

    const [, opts] = posts[posts.length - 1];
    expect(opts.method).toBe("POST");
    expect(() => JSON.parse(opts.body)).not.toThrow();
    expect(opts.signal).toBeDefined();
  });

  test("production apiFetch is async, so undefined is not a valid return", async () => {
    // Pins the contract the store's unguarded `.catch` relies on. If apiFetch
    // ever stops returning a Promise this fails here, rather than surfacing as
    // an intermittent crash in an unrelated suite.
    const actual = await vi.importActual("../src/api.js");
    expect(actual.apiFetch.constructor.name).toBe("AsyncFunction");
  });
});

/**
 * The actual fix under test.
 *
 * The leak existed because trees were NEVER unmounted: vitest runs without
 * `globals: true`, so React Testing Library's automatic cleanup was never
 * registered, and only some test files called `cleanup()` by hand. Effect
 * cleanups therefore never ran and timers outlived their test.
 *
 * The pair below deliberately does NOT call `unmount()`. It asserts the
 * guarantee that tests/setup.js now provides. Reverting that file makes the
 * second test fail.
 */
describe("global test lifecycle (tests/setup.js afterEach cleanup)", () => {
  test("renders a provider and deliberately leaves it mounted", () => {
    render(
      <AppProvider>
        <Mutator />
      </AppProvider>
    );
    expect(document.body.querySelectorAll("button").length).toBeGreaterThan(0);
  });

  test("the previous test's tree was unmounted before this test began", () => {
    // Without afterEach(cleanup) the button from the previous test is still in
    // document.body, its effects are still live, and its 600 ms persistence
    // timer is still pending — which is exactly how the post-teardown crash
    // was reached.
    expect(document.body.querySelectorAll("button").length).toBe(0);
    expect(document.body.innerHTML).toBe("");
  });
});
