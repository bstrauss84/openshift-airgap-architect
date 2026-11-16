/**
 * Tranche 8C — lifecycle axis, BlueprintStep closure item.
 *
 * WHAT THIS FILE IS
 * -----------------
 * `tests/step-navigation-lifecycle.test.jsx` probes resources that step
 * NAVIGATION acquires. It cannot see BlueprintStep's Cincinnati refresh poll,
 * because that poll is armed only by pressing "Update" — an explicit user
 * action the navigation sweep never performs. This file closes that gap by
 * driving the real button and then unmounting the step mid-poll.
 *
 * WHY THE STEP IS UNMOUNTED WITHOUT UNMOUNTING THE STORE
 * -----------------------------------------------------
 * This is the production shape. Navigating away from Blueprint unmounts
 * `BlueprintStep` while `AppProvider` keeps running, so a post-unmount
 * `updateState(...)` from a stale async continuation is NOT a React no-op —
 * it lands in live application state and triggers a persistence POST. The
 * harness below therefore mounts the step inside a long-lived context provider
 * and toggles only the step, and it records every `updateState` call in a plain
 * array BEFORE forwarding it to `setState`, so a write is observable even when
 * React would discard the render.
 *
 * DETERMINISM
 * -----------
 * Fake timers, explicit `act()` + `advanceTimersByTimeAsync` flushes, and an
 * `apiFetch` mock that returns already-resolved promises. No `waitFor`: React
 * Testing Library only detects JEST fake timers, so under vitest fake timers
 * its polling loop is never advanced and it hangs.
 *
 * NON-VACUITY
 * -----------
 * Every "nothing happened after unmount" assertion is paired with a control
 * that proves the same measurement DOES move while the step is mounted, and
 * the timer probe has its own self-check that leaks a timeout from the TEST.
 * No production code is modified to prove a matcher can fail.
 *
 * SCOPE LIMIT
 * -----------
 * jsdom proves add/remove and issue/settle bookkeeping is balanced. It does
 * NOT prove the absence of retained-heap growth; that needs a heap snapshot,
 * not a unit test.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useCallback, useState } from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";

import BlueprintStep from "../src/steps/BlueprintStep.jsx";
import { AppContext } from "../src/store.jsx";
import { apiFetch } from "../src/api.js";

vi.mock("../src/api.js", () => ({
  apiFetch: vi.fn(),
  API_BASE: "http://localhost:4000",
}));

/* ------------------------------------------------------------------ *
 * Probe: which setTimeout handles are still pending
 * ------------------------------------------------------------------ */

/**
 * Wrap `setTimeout`/`clearTimeout` and record which handles are still armed.
 *
 * A handle stops being "live" when it is cleared OR when its callback has run.
 * Installed AFTER `vi.useFakeTimers()` so it wraps the fake implementation.
 *
 * `window === globalThis` under vitest's jsdom environment, but both targets
 * are patched anyway so the probe does not silently become half-blind if that
 * ever changes — the same failure mode documented on the listener probe in
 * tests/step-navigation-lifecycle.test.jsx.
 */
function installTimeoutProbe() {
  const targets = window === globalThis ? [globalThis] : [globalThis, window];
  const saved = targets.map((t) => ({ t, set: t.setTimeout, clear: t.clearTimeout }));
  const origSet = globalThis.setTimeout;
  const origClear = globalThis.clearTimeout;

  /** handle -> delay, insertion ordered so "which one leaked" is answerable. */
  const created = new Map();
  const cleared = new Set();
  const fired = new Set();

  const wrappedSet = function (fn, delay, ...rest) {
    let handle;
    handle = origSet.call(
      globalThis,
      (...args) => {
        fired.add(handle);
        return typeof fn === "function" ? fn(...args) : undefined;
      },
      delay,
      ...rest
    );
    created.set(handle, delay);
    return handle;
  };
  const wrappedClear = function (handle) {
    cleared.add(handle);
    return origClear.call(globalThis, handle);
  };

  for (const { t } of saved) {
    t.setTimeout = wrappedSet;
    t.clearTimeout = wrappedClear;
  }

  return {
    /** Delays of handles that are neither cleared nor already fired. */
    live: () =>
      [...created.entries()]
        .filter(([h]) => !cleared.has(h) && !fired.has(h))
        .map(([, delay]) => delay)
        .sort((a, b) => a - b),
    restore() {
      for (const { t, set, clear } of saved) {
        t.setTimeout = set;
        t.clearTimeout = clear;
      }
    },
  };
}

/**
 * Wrap `AbortController` so every controller the step constructs is reachable
 * after the fact.
 *
 * BlueprintStep owns exactly one, created by its lifecycle effect and aborted
 * by that effect's cleanup. Unlike the shell-wide probe in
 * tests/step-navigation-lifecycle.test.jsx there is no "settled request"
 * disjunct here: this controller's whole job is to outlive individual requests
 * and cancel whatever is still in flight at unmount, so "aborted" is the only
 * acceptable end state.
 */
function installAbortProbe() {
  const Original = globalThis.AbortController;
  const controllers = [];
  class ProbeAbortController extends Original {
    constructor(...args) {
      super(...args);
      controllers.push(this);
    }
  }
  globalThis.AbortController = ProbeAbortController;
  if (window !== globalThis) window.AbortController = ProbeAbortController;
  return {
    controllers,
    unaborted: () => controllers.filter((c) => !c.signal.aborted),
    restore() {
      globalThis.AbortController = Original;
      if (window !== globalThis) window.AbortController = Original;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const CHANNELS = ["4.22", "4.21", "4.20"];

/** Unlocked blueprint with a channel already chosen: "Update" is enabled. */
function unlockedState(overrides = {}) {
  return {
    _schemaVersion: 3,
    blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false },
    release: { channel: "4.21", patchVersion: "4.21.20", confirmed: false, followLatestMinor: true },
    version: {
      selectedMinor: "4.21",
      selectedPatch: "4.21.20",
      selectedChannel: "stable-4.21",
      selectedVersion: "4.21.20",
      locked: false,
    },
    methodology: { method: "Agent-Based Installer" },
    operators: {},
    ui: {},
    ...overrides,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.jobStatus  terminal ("completed"/"failed") or not ("running")
 * @param {number} opts.terminalAfter  report `jobStatus` only from the Nth poll
 *   onwards; earlier polls answer "running". Lets a test unmount the step while
 *   the job is still in flight and then prove the terminal branch — the one
 *   that calls `updateState` — never runs.
 * @param {boolean} opts.deferChannels  hold `/api/cincinnati/channels` open
 * @param {boolean} opts.failChannels  reject `/api/cincinnati/channels`, the way
 *   the real `apiFetch` does on a network failure or any non-2xx
 */
function installApiMock({
  jobStatus = "running",
  terminalAfter = 0,
  deferChannels = false,
  failChannels = false,
} = {}) {
  /** @type {{resolve: Function}[]} */
  const deferred = [];
  let polls = 0;
  vi.mocked(apiFetch).mockImplementation((path, opts = {}) => {
    const p = String(path);
    if (p === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: false });
    if (p === "/api/secrets/rh-pull-secret/content") return Promise.resolve({ pullSecret: "" });
    if (p === "/api/cincinnati/channels") {
      if (failChannels) {
        const err = new Error("Cincinnati upstream unreachable");
        err.status = 502;
        return Promise.reject(err);
      }
      if (deferChannels) {
        return new Promise((resolve) => deferred.push({ resolve, value: { channels: [...CHANNELS] } }));
      }
      return Promise.resolve({ channels: [...CHANNELS] });
    }
    if (p === "/api/cincinnati/update") return Promise.resolve({ channels: [...CHANNELS] });
    if (p === "/api/cincinnati/refresh-job") return Promise.resolve({ jobId: "job-refresh-1" });
    if (p.startsWith("/api/jobs/")) {
      polls += 1;
      const status = polls >= terminalAfter ? jobStatus : "running";
      return Promise.resolve({ id: "job-refresh-1", status, output: "ok\n", message: "boom" });
    }
    if (p.startsWith("/api/cincinnati/patches")) {
      return Promise.resolve({ versions: ["4.21.20", "4.21.19"] });
    }
    return Promise.resolve({});
  });
  return {
    pendingChannelRequests: () => deferred.length,
    releaseChannelRequests: () => {
      const batch = deferred.splice(0, deferred.length);
      for (const d of batch) d.resolve(d.value);
    },
  };
}

/* ------------------------------------------------------------------ *
 * Driving helpers
 * ------------------------------------------------------------------ */

async function flush(passes = 6) {
  for (let i = 0; i < passes; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await flush(3);
}

/**
 * Mount BlueprintStep under a provider that OUTLIVES it, exactly as the real
 * wizard does.
 */
function mountStep(initialState) {
  /** Every `updateState` patch, recorded before React is given a chance to
   *  discard the resulting render. */
  const updates = [];
  const handles = { hideStep: null };

  const Host = () => {
    const [state, setState] = useState(initialState);
    const [show, setShow] = useState(true);
    handles.hideStep = setShow;
    const updateState = useCallback((patch) => {
      updates.push(patch);
      setState((prev) => ({ ...prev, ...patch }));
    }, []);
    return (
      <AppContext.Provider value={{ state, updateState, loading: false, startOver: () => {} }}>
        {show ? <BlueprintStep /> : <div data-testid="step-gone" />}
      </AppContext.Provider>
    );
  };

  const utils = render(<Host />);
  return {
    ...utils,
    updates,
    /** Unmount ONLY the step; the store provider keeps running. */
    unmountStep: async () => {
      await act(async () => {
        handles.hideStep(false);
      });
      await flush(3);
    },
  };
}

const jobPollCount = () =>
  vi.mocked(apiFetch).mock.calls.filter(([p]) => String(p).startsWith("/api/jobs/")).length;

const callsTo = (prefix) =>
  vi.mocked(apiFetch).mock.calls.filter(([p]) => String(p).startsWith(prefix)).length;

function clickUpdate() {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === "Update"
  );
  if (!button) throw new Error("BlueprintStep 'Update' button not found");
  if (button.disabled) throw new Error("BlueprintStep 'Update' button is disabled");
  return act(async () => {
    fireEvent.click(button);
  });
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe("BlueprintStep unmount lifecycle (Tranche 8C, lifecycle axis)", () => {
  /** @type {ReturnType<typeof installTimeoutProbe>} */ let timeouts;
  /** @type {ReturnType<typeof installAbortProbe>} */ let aborts;

  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    // Fake timers FIRST: the timeout probe must wrap the faked implementation.
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    timeouts = installTimeoutProbe();
    aborts = installAbortProbe();
  });

  afterEach(() => {
    aborts.restore();
    timeouts.restore();
    vi.useRealTimers();
  });

  /* --- the Cincinnati refresh poll ---------------------------------- */

  test("control: while the step stays mounted, the refresh poll keeps calling the backend", async () => {
    installApiMock({ jobStatus: "running" });
    mountStep(unlockedState());
    await flush();

    await clickUpdate();
    await flush();

    const armed = jobPollCount();
    // Clicking Update must actually arm the poll, or every assertion in the
    // sibling test below would be vacuously true.
    expect(armed).toBeGreaterThan(0);

    // 5 further 400 ms ticks while mounted.
    await advance(2000);
    expect(
      jobPollCount(),
      "the poll did not advance while mounted — the control is not measuring a live poll"
    ).toBeGreaterThan(armed);
  }, 30_000);

  test("unmounting mid-poll stops the Cincinnati refresh poll", async () => {
    installApiMock({ jobStatus: "running" });
    const h = mountStep(unlockedState());
    await flush();

    await clickUpdate();
    await flush();
    await advance(1200);

    const beforeUnmount = jobPollCount();
    expect(beforeUnmount, "poll never ran, so this assertion would be vacuous").toBeGreaterThan(1);

    await h.unmountStep();
    const atUnmount = jobPollCount();

    // Five more 400 ms slots. A live poll would add ~5 calls.
    await advance(2000);

    expect(
      jobPollCount() - atUnmount,
      `the refresh poll kept hitting /api/jobs after unmount ` +
        `(${atUnmount} -> ${jobPollCount()} calls)`
    ).toBe(0);

    // Residual, characterised rather than hidden: if the loop happens to be
    // inside its `await new Promise(r => setTimeout(r, 400))` when the step
    // unmounts, that one 400 ms handle is still pending at that instant. It is
    // not a leak — it fires once, resolves, the loop sees `signal.aborted` and
    // exits without a request or a setState — but the loop is therefore
    // "stopped within 400 ms", not "stopped instantly". This asserts the
    // bound: once that single slot has elapsed, nothing is left armed.
    expect(
      timeouts.live(),
      "a timer was still armed 2 s after unmount — the poll did not wind down"
    ).toEqual([]);
  }, 30_000);

  test("control: a job that fails while the step is mounted writes highlightJobId to the store", async () => {
    installApiMock({ jobStatus: "failed", terminalAfter: 5 });
    const h = mountStep(unlockedState());
    await flush();

    await clickUpdate();
    await flush();
    const before = h.updates.length;

    await advance(2400); // reach the 5th poll, which reports "failed"
    const uiPatches = h.updates.slice(before).filter((p) => p.ui?.highlightJobId);
    expect(
      uiPatches.length,
      "the terminal-failure branch never ran while mounted — the unmount test below is vacuous"
    ).toBeGreaterThan(0);
    expect(uiPatches[0].ui.highlightJobId).toBe("job-refresh-1");
  }, 30_000);

  test("unmounting mid-poll writes nothing further to the shared store", async () => {
    // Identical job script to the control above, but the step is unmounted
    // BEFORE the poll reaches the failing status.
    installApiMock({ jobStatus: "failed", terminalAfter: 5 });
    const h = mountStep(unlockedState());
    await flush();

    await clickUpdate();
    await flush();
    await advance(800);

    await h.unmountStep();
    const atUnmount = h.updates.length;

    await advance(130_000); // past the terminal poll AND the poll's 120 s deadline
    const leaked = h.updates.slice(atUnmount);
    expect(
      leaked,
      `BlueprintStep wrote to the live app store after it was unmounted: ` +
        `${JSON.stringify(leaked)}`
    ).toEqual([]);
  }, 30_000);

  /* --- the 5 s "Channels updated." timer ---------------------------- */

  test("the 5 s 'Channels updated.' timer is cleared on unmount", async () => {
    installApiMock({ jobStatus: "completed" });
    const h = mountStep(unlockedState());
    await flush();

    await clickUpdate();
    await flush(8);

    // Non-vacuity: the timer must actually be armed before unmount, otherwise
    // "no 5000 ms timer survives" proves nothing.
    expect(
      timeouts.live(),
      "the 5 s banner timer was never armed, so the assertion below would be vacuous"
    ).toContain(5000);
    expect(document.body.textContent).toContain("Channels updated.");

    await h.unmountStep();

    expect(
      timeouts.live(),
      "the 5 s 'Channels updated.' setTimeout survived unmount"
    ).not.toContain(5000);
  }, 30_000);

  /* --- the mount-effect Cincinnati chain ---------------------------- */

  test("a channel load that resolves after unmount neither writes state nor fires the follow-up request", async () => {
    const mock = installApiMock({ deferChannels: true });
    // No channel selected: this is the branch that WOULD call updateState with
    // a newly chosen release channel.
    const h = mountStep(
      unlockedState({
        release: { channel: null, patchVersion: null, confirmed: false, followLatestMinor: true },
      })
    );
    await flush();

    expect(
      mock.pendingChannelRequests(),
      "the mount effect never issued /api/cincinnati/channels"
    ).toBeGreaterThan(0);

    await h.unmountStep();
    const updatesAtUnmount = h.updates.length;
    const followUpsAtUnmount = callsTo("/api/cincinnati/update");

    // Now let the in-flight channel load land.
    mock.releaseChannelRequests();
    await flush(8);

    expect(
      h.updates.length - updatesAtUnmount,
      "the mount-effect channel load wrote to the live app store after unmount — " +
        "in the real wizard that mutates the user's release selection from a dead step"
    ).toBe(0);
    expect(
      callsTo("/api/cincinnati/update") - followUpsAtUnmount,
      "the .finally() follow-up POST fired after the step was unmounted"
    ).toBe(0);
  }, 30_000);

  test("control: the same channel load DOES select a channel while the step is mounted", async () => {
    const mock = installApiMock({ deferChannels: true });
    const h = mountStep(
      unlockedState({
        release: { channel: null, patchVersion: null, confirmed: false, followLatestMinor: true },
      })
    );
    await flush();

    const before = h.updates.length;
    mock.releaseChannelRequests();
    await flush(8);

    // Proves the branch the previous test suppresses is a real, reachable write
    // and that the suppression is not hiding a behaviour change. The newest
    // SUPPORTED channel is chosen — never an unsupported one.
    const releasePatches = h.updates.slice(before).filter((p) => p.release);
    expect(
      releasePatches.length,
      "the mounted channel load selected nothing — the unmount test is vacuous"
    ).toBeGreaterThan(0);
    expect(releasePatches[0].release.channel).toBe("4.22");
    expect(callsTo("/api/cincinnati/update")).toBeGreaterThan(0);
  }, 30_000);

  /* --- the Cincinnati FAILURE path ---------------------------------- */

  test("a failed channel load clears loading, keeps the release selection, and leaks nothing", async () => {
    installApiMock({ failChannels: true });
    const h = mountStep(unlockedState());
    await flush(8);

    // `apiFetch` rejects on network failure and on any non-2xx. The step must
    // absorb that without an unhandled rejection and WITHOUT inventing or
    // clearing a release.
    //
    // NOT asserted as "zero release writes": the separate `release.channel`
    // patch-list effect still runs and re-affirms the SAME 4.21 / 4.21.20 it
    // already had. That is pre-existing behaviour and is not a fallback. What
    // must hold is that no write MOVES or CLEARS the selection.
    const observed = h.updates
      .filter((p) => p.release || p.version)
      .map((p) => ({
        channel: p.release ? p.release.channel : p.version?.selectedMinor,
        patch: p.release ? p.release.patchVersion : p.version?.selectedPatch,
      }));
    for (const { channel, patch } of observed) {
      expect(
        { channel, patch },
        `a failed channel load moved or cleared the release selection: ${JSON.stringify(observed)}`
      ).toEqual({ channel: "4.21", patch: "4.21.20" });
    }

    // `loading` is cleared by the `.finally`, so the spinner must be gone.
    expect(document.body.textContent).not.toContain("Loading channels…");
    // The previously selected channel is still offered (as the "(manual)"
    // option, since the channel list is empty) rather than being dropped.
    expect(document.body.textContent).toContain("stable-4.21");

    await h.unmountStep();
    expect(timeouts.live(), "a timer survived unmount on the failure path").toEqual([]);
  }, 30_000);

  test("unmounting during a failing channel load writes nothing and issues no follow-up", async () => {
    installApiMock({ failChannels: true, deferChannels: true });
    const h = mountStep(unlockedState());
    await flush();

    await h.unmountStep();
    const updatesAtUnmount = h.updates.length;
    const callsAtUnmount = vi.mocked(apiFetch).mock.calls.length;

    await advance(1000);
    expect(h.updates.length, "a dead step wrote to the store on the failure path").toBe(
      updatesAtUnmount
    );
    expect(
      vi.mocked(apiFetch).mock.calls.length,
      "a dead step issued another request on the failure path"
    ).toBe(callsAtUnmount);
  }, 30_000);

  /* --- AbortController cleanup -------------------------------------- */

  test("every AbortController the step constructs is aborted on unmount", async () => {
    installApiMock({ jobStatus: "running" });
    const h = mountStep(unlockedState());
    await flush();

    await clickUpdate();
    await flush();
    await advance(800);

    // Non-vacuity: the step must actually own a controller, and it must still
    // be live while the step is mounted. Without this, "all aborted" would
    // pass on a step that never created one.
    expect(
      aborts.controllers.length,
      "BlueprintStep constructed no AbortController"
    ).toBeGreaterThan(0);
    expect(
      aborts.unaborted().length,
      "the controller was already aborted while the step was still mounted"
    ).toBeGreaterThan(0);

    await h.unmountStep();

    expect(
      aborts.unaborted().length,
      "an AbortController owned by BlueprintStep was not aborted on unmount"
    ).toBe(0);
  }, 30_000);

  test("the in-flight refresh poll is handed the step's signal", async () => {
    installApiMock({ jobStatus: "running" });
    mountStep(unlockedState());
    await flush();

    await clickUpdate();
    await flush();
    await advance(800);

    // The guard flag alone would stop setState but leave the request running
    // in the browser. Proving the signal is actually attached is what makes
    // the cancellation real rather than cosmetic.
    const pollCalls = vi
      .mocked(apiFetch)
      .mock.calls.filter(([p]) => String(p).startsWith("/api/jobs/"));
    expect(pollCalls.length, "the poll never ran").toBeGreaterThan(0);
    for (const [, opts] of pollCalls) {
      expect(opts?.signal, "a job poll was issued without an abort signal").toBeInstanceOf(
        AbortSignal
      );
    }
  }, 30_000);

  /* --- probe self-check --------------------------------------------- */

  describe("probe self-check (non-vacuity)", () => {
    test("the timeout probe reports a timeout that is never cleared, and stops reporting one that fired", async () => {
      expect(timeouts.live()).not.toContain(1234);
      const leaked = setTimeout(() => {}, 1234);
      expect(timeouts.live()).toContain(1234);
      clearTimeout(leaked);
      expect(timeouts.live()).not.toContain(1234);

      setTimeout(() => {}, 4321);
      expect(timeouts.live()).toContain(4321);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4321);
      });
      expect(timeouts.live()).not.toContain(4321);
    });

    test("the abort probe reports a controller that is never aborted", () => {
      const before = aborts.unaborted().length;
      const c = new AbortController();
      expect(aborts.unaborted()).toContain(c);
      expect(aborts.unaborted().length).toBe(before + 1);
      c.abort();
      expect(aborts.unaborted()).not.toContain(c);
      expect(aborts.unaborted().length).toBe(before);
    });
  });
});
