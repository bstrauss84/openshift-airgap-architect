/**
 * Tranche 8C — lifecycle axis, frontend closure item.
 *
 * Closure text (scripts/release/axes/planned.mjs, `lifecycle.closure`):
 *
 *   "Frontend: assert no setInterval, listener or AbortController survives
 *    unmount across repeated step navigation."
 *
 * WHAT THIS FILE IS
 * -----------------
 * A resource probe, not a feature test. It installs instrumented wrappers
 * around the four long-lived browser resources the application actually
 * acquires — `setInterval`, `window`/`document` event listeners,
 * `AbortController` and `EventSource` — drives the REAL wizard through three
 * identical forward/backward navigation sweeps, and then unmounts.
 *
 * WHY "COUNTS RETURN TO BASELINE" IS THE WRONG ASSERTION ON ITS OWN
 * ----------------------------------------------------------------
 * The axis's own `known.caution` says:
 *
 *   "The raw counts above are signal for where to probe, not evidence of a
 *    defect. Asymmetry is often legitimate."
 *
 * A listener installed once for the lifetime of the shell and never removed
 * until unmount is not a leak. What distinguishes a leak is GROWTH: one more
 * listener, interval or controller for every navigation. So this file asserts
 * two different things, and the second is the one that carries the weight:
 *
 *   1. After unmount, nothing created during the run is still live, except
 *      entries on an EXPLICIT, NAMED allowlist.
 *   2. Across cycles, the live-resource census is FLAT — cycle 3 equals
 *      cycle 2 — and the allowlist itself is NON-GROWING.
 *
 * (1) alone would fail on legitimate once-per-process listeners. (2) alone
 * would pass a tree that allocates everything on first mount and frees
 * nothing. Together they separate "mounts one and keeps it" from "mounts one
 * per navigation".
 *
 * NON-VACUITY
 * -----------
 * Every matcher in here is exercised against a deliberately leaked resource
 * that this TEST creates — a never-cleared interval, an unremoved
 * `document` listener, an un-aborted `AbortController`, an unclosed
 * `EventSource` — in the "probe self-check" block at the bottom. No
 * production code is modified to prove the point. If a matcher stopped being
 * able to see a leak, those self-checks fail.
 *
 * DETERMINISM
 * -----------
 * Fake timers, explicit `act()` microtask flushes, and an `apiFetch` mock that
 * returns already-resolved promises. No sleeps, no `waitFor` (which cannot
 * work under vitest fake timers in this repo: React Testing Library only
 * detects JEST fake timers, so its polling loop would never be advanced).
 * The global `afterEach(cleanup)` lives in tests/setup.js.
 *
 * WHAT IS COVERED — and what is NOT
 * ---------------------------------
 * COVERED. All 8 classic-flow steps and all 12 segmented-flow steps, three
 * sweeps each, forward and back, via the real sidebar buttons:
 *   Blueprint, Methodology, Global Strategy, Host Inventory, Operators,
 *   Assets & Guide, Run oc-mirror, Operations
 *   + Identity & Access, Networking, Connectivity & Mirroring, Trust & Proxy,
 *     Platform Specifics, Hosts / Inventory  (ui.segmentedFlowV1)
 * and with them these resource owners:
 *   - src/App.jsx:593      15 s jobs-count `setInterval`      (shell-scoped)
 *   - src/App.jsx:855      `document` click dropdown-close listener
 *   - src/App.jsx:896      AppShell `AbortController`
 *   - src/store.jsx:82     per-state-change persistence `AbortController`
 *   - src/useCatalogScanProgress.js:50   250 ms progress `setInterval`
 *                          (mounted unconditionally by OperatorsStep)
 *   - src/steps/OperatorsStep.jsx:135    `window` resize fallback listener
 *   - src/steps/ReviewStep.jsx:310       generate `AbortController`, driven
 *                          past its 100 ms settle timer so the controller is
 *                          attached to a REAL request, not merely constructed
 *   - src/steps/OperationsStep.jsx:95    10 s job-list `setInterval`
 *   - src/steps/OperationsStep.jsx:124   log-stream `EventSource`, opened once
 *                          per cycle through the real "View logs" button
 *
 * COVERED BY A DEDICATED TEST IN THIS FILE, not by the navigation sweeps:
 *   - src/steps/RunOcMirrorStep.jsx:208-242  2 s job poll. Armed only when
 *     `runningJobId` is set, which navigation alone never does. A previous
 *     revision of this header listed it as NOT COVERED because that state is
 *     "writable ONLY by completing a real oc-mirror run". The premise is
 *     correct; the conclusion was not. The run path is three real button
 *     clicks whose every backend interaction is already mocked here, so it is
 *     fully drivable without a backend or an oc-mirror binary. The old note
 *     also rested the cleanup claim on being "structurally identical" to the
 *     three intervals proven here — an argument from similarity, not
 *     evidence. See the test "the Run oc-mirror job poll is armed by the real
 *     run path and released on unmount" below.
 *
 * COVERED BY tests/blueprint-step-unmount-lifecycle.test.jsx:
 *   - src/steps/BlueprintStep.jsx  Cincinnati refresh job poll (chained 400 ms
 *     `setTimeout`, 120 s budget), the 5 s "Channels updated." banner timer,
 *     and the mount-effect channel-load continuation. Armed by the "Update"
 *     button rather than by navigation, and the shape that matters there is
 *     unmounting the STEP while the store keeps running — see that file.
 *
 * NOT COVERED, and why. Stated plainly rather than papered over:
 *   - src/steps/OperatorsStep.jsx:611 (`setTimeout` scan-status poll chain).
 *     Requires in-flight catalog scan jobs; none exist under navigation.
 *   - Modal/drawer-scoped listeners (YamlDrawer, ToolsDrawer, FeedbackDrawer,
 *     AboutModal, Modal, RunConfirmationModal, TooltipInfo,
 *     FieldLabelWithInfo, useFocusTrap, dragDropCopyPolicy). These mount on
 *     user actions this probe does not perform. Open/close lifecycle is a
 *     separate axis item, not "step navigation".
 *   - Listeners on elements INSIDE the React tree. Deliberately out of scope:
 *     those nodes are detached and collectable at unmount. Only `window` and
 *     `document` outlive the tree and can therefore accumulate.
 *   - Real browsers. This is jsdom. It proves the add/remove and
 *     acquire/release bookkeeping is balanced; it does not prove the absence
 *     of retained-heap growth, which needs a heap snapshot, not a unit test.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";

import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";

vi.mock("../src/api.js", () => ({
  apiFetch: vi.fn(),
  API_BASE: "http://localhost:4000",
}));

/* ------------------------------------------------------------------ *
 * Probes
 * ------------------------------------------------------------------ */

/**
 * Wrap `setInterval`/`clearInterval` and record which handles are still armed.
 *
 * Installed AFTER `vi.useFakeTimers()` so it wraps the fake implementation
 * rather than being clobbered by it.
 */
function installIntervalProbe() {
  const targets = window === globalThis ? [globalThis] : [globalThis, window];
  const saved = targets.map((t) => ({ t, set: t.setInterval, clear: t.clearInterval }));
  const origSet = globalThis.setInterval;
  const origClear = globalThis.clearInterval;

  /** handle -> delay. Insertion-ordered, so "which one leaked" is answerable. */
  const created = new Map();
  const cleared = new Set();

  const wrappedSet = function (fn, delay, ...rest) {
    const handle = origSet.call(globalThis, fn, delay, ...rest);
    created.set(handle, delay);
    return handle;
  };
  const wrappedClear = function (handle) {
    cleared.add(handle);
    return origClear.call(globalThis, handle);
  };

  for (const { t } of saved) {
    t.setInterval = wrappedSet;
    t.clearInterval = wrappedClear;
  }

  return {
    /** Handles created during the run that were never cleared. */
    live: () => [...created.entries()].filter(([h]) => !cleared.has(h)).map(([, delay]) => delay),
    createdCount: () => created.size,
    restore() {
      for (const { t, set, clear } of saved) {
        t.setInterval = set;
        t.clearInterval = clear;
      }
    },
  };
}

/**
 * Keep a MULTISET of live `window` / `document` event-listener registrations.
 *
 * Matching is by (target, type, listener identity, capture) — the same tuple
 * the DOM itself uses — not by raw add/remove counts. Raw counts cannot tell a
 * removed-and-re-added listener from a leaked one, which is precisely the
 * distinction the axis's `known.caution` warns about.
 *
 * Only `window` and `document` are tracked. Listeners bound to elements INSIDE
 * the React tree are not leaks in the sense this item is about: those elements
 * are detached and collectable at unmount, and React removes its own delegated
 * root listeners with the container. `window` and `document` are the two
 * targets that outlive every component, so they are the ones that can actually
 * accumulate.
 *
 * WHY THIS PATCHES MORE THAN `EventTarget.prototype`
 * --------------------------------------------------
 * Measured in this environment (vitest 2.1 + jsdom 25), via a throwaway probe:
 *
 *   window === globalThis                                  -> true
 *   hasOwnProperty(window, "addEventListener")             -> true
 *   window.addEventListener === EventTarget.prototype.add… -> false
 *   document.addEventListener === EventTarget.prototype.add… -> true
 *
 * vitest's jsdom environment copies the jsdom window's members onto the Node
 * global with `bindFunctions: true`, so `addEventListener` exists as an OWN,
 * pre-bound property of `window`. A probe that patched only
 * `EventTarget.prototype` would therefore see every `document.addEventListener`
 * call and NONE of the `window.addEventListener` calls — silently blind to the
 * ~10 `window.addEventListener` sites in `src/`, while still looking like it
 * worked. That blind spot was found by this file's own self-check, not by
 * reasoning, and is the reason the self-check exists.
 */
function installListenerProbe() {
  /** @type {{target: EventTarget, type: string, listener: unknown, capture: boolean}[]} */
  const live = [];
  const captureOf = (options) =>
    typeof options === "boolean" ? options : Boolean(options && options.capture);
  const tracked = (target) => target === window || target === document;
  const name = (target) => (target === window ? "window" : "document");

  // Guards against double-booking if one patched entry point delegates to
  // another (e.g. a Window method that internally hits the prototype).
  let recording = false;

  /** Every distinct label ever registered. Coverage evidence, not an assertion. */
  const seenEver = new Set();

  const record = (target, type, listener, options) => {
    if (recording || !tracked(target) || listener == null) return;
    recording = true;
    try {
      const capture = captureOf(options);
      seenEver.add(`${name(target)}:${type}${capture ? ":capture" : ""}`);
      // The DOM treats a duplicate (type, listener, capture) add as a no-op.
      // Mirror that, or the probe would over-count and manufacture a fake leak.
      const dup = live.some(
        (e) => e.target === target && e.type === type && e.listener === listener && e.capture === capture
      );
      if (!dup) live.push({ target, type, listener, capture });
    } finally {
      recording = false;
    }
  };

  const unrecord = (target, type, listener, options) => {
    if (recording || !tracked(target) || listener == null) return;
    recording = true;
    try {
      const capture = captureOf(options);
      const i = live.findIndex(
        (e) => e.target === target && e.type === type && e.listener === listener && e.capture === capture
      );
      if (i >= 0) live.splice(i, 1);
    } finally {
      recording = false;
    }
  };

  /** @type {{holder: object, hadOwn: boolean, add: Function, remove: Function}[]} */
  const patched = [];
  const patch = (holder, fallbackThis) => {
    const hadOwn =
      Object.prototype.hasOwnProperty.call(holder, "addEventListener") &&
      Object.prototype.hasOwnProperty.call(holder, "removeEventListener");
    const add = holder.addEventListener;
    const remove = holder.removeEventListener;
    holder.addEventListener = function (type, listener, options) {
      record(this ?? fallbackThis, type, listener, options);
      return add.call(this, type, listener, options);
    };
    holder.removeEventListener = function (type, listener, options) {
      unrecord(this ?? fallbackThis, type, listener, options);
      return remove.call(this, type, listener, options);
    };
    patched.push({ holder, hadOwn, add, remove });
  };

  // Record which entry points are genuinely distinct BEFORE patching anything,
  // so patching the prototype cannot make a later identity test lie.
  const windowIsDistinct = window.addEventListener !== EventTarget.prototype.addEventListener;
  const documentIsDistinct = document.addEventListener !== EventTarget.prototype.addEventListener;

  patch(EventTarget.prototype, null);
  if (windowIsDistinct) patch(window, window);
  if (documentIsDistinct) patch(document, document);

  return {
    /** Stable, sortable labels for the currently live registrations. */
    snapshot: () =>
      live.map((e) => `${name(e.target)}:${e.type}${e.capture ? ":capture" : ""}`).sort(),
    /** Union of everything ever registered. Used to prove the probe saw the sites it claims to cover. */
    seenEver: () => [...seenEver].sort(),
    restore() {
      for (const { holder, hadOwn, add, remove } of patched.reverse()) {
        if (hadOwn || holder === EventTarget.prototype) {
          holder.addEventListener = add;
          holder.removeEventListener = remove;
        } else {
          delete holder.addEventListener;
          delete holder.removeEventListener;
        }
      }
    },
  };
}

/**
 * Wrap `AbortController` so every controller the application constructs is
 * reachable after the fact, and record which signals were handed to a request
 * that has already settled.
 *
 * "Not aborted" is NOT automatically a leak: a controller whose request
 * already completed has nothing left to cancel. The assertion is therefore
 * `aborted || owning request settled`.
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
    /** Controllers that are neither aborted nor owned by a settled request. */
    dangling: (settledSignals) =>
      controllers.filter((c) => !c.signal.aborted && !settledSignals.has(c.signal)),
    restore() {
      globalThis.AbortController = Original;
      if (window !== globalThis) window.AbortController = Original;
    },
  };
}

/**
 * jsdom ships no `EventSource`, so one has to be provided for OperationsStep's
 * log stream to be reachable at all.
 *
 * It IS in scope for this item. An `EventSource` is a long-lived network
 * handle owned by a component's effect and released only by that effect's
 * cleanup — exactly the shape of resource the closure text is about, and the
 * only one here that holds a server connection rather than a timer slot. A
 * leaked one keeps an HTTP connection and a server-side SSE writer alive after
 * the user has navigated away, which is strictly worse than a leaked interval.
 */
function installEventSourceProbe() {
  const Original = globalThis.EventSource;
  const instances = [];
  class ProbeEventSource extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 1;
      this.closed = false;
      this.onerror = null;
      instances.push(this);
    }
    close() {
      this.closed = true;
      this.readyState = 2;
    }
  }
  globalThis.EventSource = ProbeEventSource;
  if (window !== globalThis) window.EventSource = ProbeEventSource;

  return {
    instances,
    open: () => instances.filter((es) => !es.closed),
    restore() {
      if (Original === undefined) {
        delete globalThis.EventSource;
        if (window !== globalThis) delete window.EventSource;
      } else {
        globalThis.EventSource = Original;
        if (window !== globalThis) window.EventSource = Original;
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * Allowlist
 * ------------------------------------------------------------------ *
 *
 * Registrations that are deliberately installed once and are NOT expected to
 * be torn down by React unmount. Each entry must name its owner and say why
 * it is legitimate. An empty allowlist is the strongest possible result and is
 * what this run currently produces; the mechanism exists so that a future,
 * legitimately process-scoped listener can be recorded here explicitly rather
 * than silently widening the assertion.
 *
 * Whatever is in here is additionally required to be NON-GROWING across
 * cycles — being allowlisted exempts a listener from "must be removed", never
 * from "must not multiply".
 */
const LISTENER_ALLOWLIST = Object.freeze([
  // react-dom. `listenToAllSupportedEvents` attaches `selectionchange` to the
  // OWNER DOCUMENT rather than to the React root container, because the event
  // does not bubble. It is guarded by react-dom's own `_reactListening<rand>`
  // marker (node_modules/react-dom/cjs/react-dom.development.js:9146-9155), so
  // it is installed at most ONCE per document for the life of the process and
  // is never removed. Not ours, not a leak, provably non-growing. Confirmed by
  // capturing the registering stack, not by assumption.
  "document:selectionchange",

  // jsdom's CSS selector engine (nwsapi), installed lazily by
  // `initNwsapi` -> `addNwsapi` the first time a selector is evaluated, to back
  // `:hover`. Test-environment infrastructure that does not exist in a browser
  // and is not reachable from application code at all. Stack-confirmed:
  //   node_modules/nwsapi/src/nwsapi.js:1773-1775
  //   node_modules/jsdom/lib/jsdom/living/helpers/selectors.js:10,38
  // These appear only when nwsapi happens to initialise AFTER the probe is
  // installed, which is run-dependent (observed in roughly 2 of 5 runs). They
  // are allowlisted rather than baselined precisely because their presence is
  // not deterministic; the allowlist permits them without requiring them.
  "document:mouseover:capture",
  "document:mouseout:capture",
]);

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/**
 * A locked, landing-skipped wizard.
 *
 * `blueprint.confirmed` + `version.locked` make `foundationalLocked` true in
 * App.jsx, which is what lets `attemptNavigate` move to any step instead of
 * bouncing back to Blueprint. `ui.showLanding: false` skips the landing page
 * so the wizard shell mounts directly.
 */
/**
 * Which wizard variant the `apiFetch` mock should hydrate.
 *
 * Reset to `false` in `beforeEach`; the segmented-flow test flips it before
 * rendering.
 */
let segmentedFlow = false;

function lockedWizardState() {
  return {
    _schemaVersion: 3,
    blueprint: {
      arch: "x86_64",
      platform: "Bare Metal",
      clusterName: "lifecycle-probe",
      baseDomain: "example.com",
      confirmed: true,
      confirmationTimestamp: 1_700_000_000_000,
    },
    release: { channel: "4.21", patchVersion: "4.21.20", confirmed: true },
    version: {
      selectedMinor: "4.21",
      selectedPatch: "4.21.20",
      selectedChannel: "stable-4.21",
      locked: true,
      versionConfirmed: true,
    },
    methodology: { method: "Agent-Based Installer" },
    globalStrategy: {
      networking: {},
      mirroring: {
        registryFqdn: "registry.local:5000",
        sources: [
          {
            source: "quay.io/openshift-release-dev/ocp-release",
            mirrors: ["registry.local:5000/ocp-release"],
          },
        ],
      },
    },
    hostInventory: { nodes: [], schemaVersion: 2 },
    operators: { selected: [], catalogs: {} },
    credentials: {},
    trust: {},
    platformConfig: {},
    mirrorWorkflow: {},
    reviewFlags: {},
    docs: { connectivity: "fully-disconnected" },
    ui: {
      showLanding: false,
      activeStepId: "blueprint",
      segmentedFlowV1: segmentedFlow,
      visitedSteps: { blueprint: true },
      completedSteps: { blueprint: true },
    },
  };
}

/**
 * Job id handed back by `/api/ocmirror/run`.
 *
 * Deliberately the SAME id as `JOB.id`, so the generic `/api/jobs/<id>` branch
 * answers with a NON-terminal ("running") job. A terminal status would make
 * RunOcMirrorStep clear `runningJobId` on the first tick and tear its own
 * interval down, which would make "the interval is cleared on unmount" pass
 * for the wrong reason.
 */
const RUN_JOB_ID = "job-lifecycle-1";

/** One oc-mirror job, so the Operations step has a row to select. */
const JOB = {
  id: "job-lifecycle-1",
  type: "oc-mirror-run",
  status: "running",
  created_at: "2026-10-14T00:00:00.000Z",
  output: "",
  metadata_json: null,
};

/**
 * Signals handed to an `apiFetch` call that has already settled.
 *
 * Populated by the mock below. Used to tell "controller with nothing left to
 * cancel" apart from "controller still owning an in-flight request".
 */
let settledSignals;

function installApiMock() {
  settledSignals = new Set();
  vi.mocked(apiFetch).mockImplementation((path, opts = {}) => {
    const settle = (value) => {
      if (opts.signal) settledSignals.add(opts.signal);
      return Promise.resolve(value);
    };
    if (path === "/api/state") {
      return settle(opts.body ? JSON.parse(opts.body) : lockedWizardState());
    }
    if (path === "/api/schema/stepMap") return settle({});
    if (path === "/api/build-info") return settle({ gitSha: "test", buildTime: "test", repo: "", branch: "" });
    if (path === "/api/update-info") return settle({ enabled: false });
    if (path === "/api/feedback/config") return settle({ visible: false, enabled: false, mode: "disabled", reason: "" });
    if (path === "/api/jobs/count") return settle({ count: 1 });
    if (path === "/api/jobs") return settle({ jobs: [JOB] });
    if (path.startsWith("/api/jobs/")) return settle(JOB);
    if (path === "/api/generate") return settle({ files: { "install-config.yaml": "apiVersion: v1\n" } });
    if (path === "/api/runtime-info") return settle({});
    if (path === "/api/secrets/rh-pull-secret") return settle({ available: false });
    if (path.startsWith("/api/operators/")) return settle({ jobs: {}, status: {} });
    if (path === "/api/cincinnati/channels") return settle({ channels: [] });
    // Reached only by the "Run oc-mirror job poll" test below, which clicks the
    // real buttons. Navigation alone never calls either endpoint, so adding
    // them does not change what the sweeps above measure.
    if (path === "/api/ocmirror/preflight") {
      return settle({ ok: true, blockers: [], warnings: [], checks: {}, fieldErrors: {} });
    }
    if (path === "/api/ocmirror/run") return settle({ jobId: RUN_JOB_ID });
    return settle({});
  });
}

/* ------------------------------------------------------------------ *
 * Driving helpers
 * ------------------------------------------------------------------ */

/**
 * Flush React effects and already-resolved promises without moving the clock.
 *
 * `advanceTimersByTimeAsync(0)` drains the microtask queue between fake-timer
 * ticks, which is what settles the mock's resolved promises. Several passes,
 * because an effect that setStates on resolution schedules another render that
 * runs its own effects.
 */
async function flush(passes = 4) {
  for (let i = 0; i < passes; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

/** Advance the fake clock, then settle whatever that released. */
async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await flush(2);
}

function sidebarStepButtons() {
  const list = document.querySelector(".sidebar .step-list");
  return list ? [...list.querySelectorAll("button.step-item")] : [];
}

function activeStepLabel() {
  const current = document.querySelector(".sidebar .step-item.active .step-label");
  return current ? current.textContent.trim() : null;
}

async function clickStep(index) {
  const buttons = sidebarStepButtons();
  if (!buttons[index] || buttons[index].disabled) return false;
  await act(async () => {
    fireEvent.click(buttons[index]);
  });
  await flush(3);
  return true;
}

/* ------------------------------------------------------------------ *
 * The probe run
 * ------------------------------------------------------------------ */

describe("step navigation resource lifecycle (Tranche 8C, lifecycle axis)", () => {
  /** @type {ReturnType<typeof installIntervalProbe>} */ let intervals;
  /** @type {ReturnType<typeof installListenerProbe>} */ let listeners;
  /** @type {ReturnType<typeof installAbortProbe>} */ let aborts;
  /** @type {ReturnType<typeof installEventSourceProbe>} */ let streams;

  beforeEach(() => {
    localStorage.clear();
    segmentedFlow = false;
    vi.mocked(apiFetch).mockReset();
    installApiMock();
    // Fake timers FIRST: the interval probe must wrap the faked implementation.
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    intervals = installIntervalProbe();
    listeners = installListenerProbe();
    aborts = installAbortProbe();
    streams = installEventSourceProbe();
  });

  afterEach(() => {
    streams.restore();
    aborts.restore();
    listeners.restore();
    intervals.restore();
    vi.useRealTimers();
  });

  /**
   * Drive the wizard through three identical forward/backward sweeps, unmount,
   * and assert the six properties below.
   *
   * Shared between the two flow variants, because `ui.segmentedFlowV1` swaps
   * SIX different step components into the wizard (Identity & Access,
   * Networking, Connectivity & Mirroring, Trust & Proxy, Platform Specifics,
   * Hosts / Inventory) and those components own listener sites of their own.
   * Covering only one variant would leave half the step inventory unprobed.
   */
  async function runNavigationSweep({ label }) {
    const baselineListeners = listeners.snapshot();

    const { unmount } = render(<App />);
    await flush(6);

    const stepLabels = sidebarStepButtons().map((b) =>
      b.querySelector(".step-label")?.textContent.trim()
    );

    // The wizard must actually be mounted and navigable, or everything below
    // is measuring an empty tree.
    expect(stepLabels.length).toBeGreaterThanOrEqual(6);
    expect(activeStepLabel()).toBe("Blueprint");

    /** Per-cycle census of resources that are live once the cycle returns home. */
    const census = [];
    /** Step labels actually reached, per cycle. */
    const visited = [];
    /** How many log streams this run actually opened, per cycle. */
    const openedStreamsPerCycle = [];

    for (let cycle = 0; cycle < 3; cycle++) {
      const reached = [];
      // Forward through every visible step.
      for (let i = 0; i < stepLabels.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        if (await clickStep(i)) reached.push(activeStepLabel());

        if (activeStepLabel() === "Assets & Guide") {
          // ReviewStep arms a 100 ms settle timer before it fires the
          // AbortController-backed /api/generate. Let it through once per
          // cycle so the controller is exercised on a REAL request rather
          // than only being constructed and discarded.
          // eslint-disable-next-line no-await-in-loop
          await advance(150);
        }
        if (activeStepLabel() === "Operations") {
          // Open a job's log stream so OperationsStep constructs its
          // EventSource. This is the only reachable entry point:
          // `selectedJobId` is component-local state with no seedable path
          // (the `ui.highlightJobId` route self-clears, so it would fire on
          // cycle 1 only and break the flatness comparison).
          const viewLogs = [...document.querySelectorAll("button")].find(
            (b) => b.textContent.trim() === "View logs"
          );
          if (viewLogs) {
            // eslint-disable-next-line no-await-in-loop
            await act(async () => {
              fireEvent.click(viewLogs);
            });
            // eslint-disable-next-line no-await-in-loop
            await flush(3);
            openedStreamsPerCycle[cycle] = (openedStreamsPerCycle[cycle] || 0) + 1;
          }
        }
      }
      // Back through every visible step, ending on Blueprint.
      for (let i = stepLabels.length - 2; i >= 0; i--) {
        // eslint-disable-next-line no-await-in-loop
        await clickStep(i);
      }

      visited.push(reached);
      census.push({
        intervals: intervals.live().slice().sort((a, b) => a - b),
        listeners: listeners.snapshot(),
        controllers: aborts.controllers.length,
        openStreams: streams.open().length,
      });
    }

    // Diagnostics for whoever reads a failure.
    const report = JSON.stringify(
      {
        flow: label,
        stepLabels,
        visited,
        openedStreamsPerCycle,
        totalStreams: streams.instances.length,
        listenersSeenEver: listeners.seenEver(),
        census,
      },
      null,
      2
    );

    // --- Assertion 1: navigation actually happened ------------------------
    // Without this, a wizard that silently refused to move would make every
    // "flat across cycles" assertion below trivially true.
    expect(visited[0].length).toBeGreaterThanOrEqual(6);
    expect(new Set(visited[0]).size).toBeGreaterThanOrEqual(6);
    expect(activeStepLabel()).toBe("Blueprint");

    // The probe must demonstrably observe BOTH targets. This is the standing
    // guard against the vitest/jsdom blind spot documented on
    // installListenerProbe: a probe that patches only `EventTarget.prototype`
    // sees every `document` registration and NO `window` registration, and
    // still looks perfectly healthy. Measured here: `window:resize`
    // (OperatorsStep's no-ResizeObserver fallback, src/steps/OperatorsStep.jsx:135)
    // and `document:click` (AppShell's dropdown-close, src/App.jsx:855).
    const everSeen = listeners.seenEver();
    expect(
      everSeen.filter((e) => e.startsWith("window:")),
      `probe never observed a window-target listener — it is blind\n${report}`
    ).not.toHaveLength(0);
    expect(
      everSeen.filter((e) => e.startsWith("document:")),
      `probe never observed a document-target listener — it is blind\n${report}`
    ).not.toHaveLength(0);

    // --- Assertion 2: the census is FLAT across cycles --------------------
    // Cycle 1 may legitimately differ from 2 and 3: first mount of the shell
    // installs process-scoped resources. Cycles 2 and 3 are identical work,
    // so any difference between them is per-navigation accumulation.
    expect(census[2].intervals, `interval census grew\n${report}`).toEqual(census[1].intervals);
    expect(census[2].listeners, `listener census grew\n${report}`).toEqual(census[1].listeners);
    expect(census[2].openStreams, `open EventSource count grew\n${report}`).toBe(
      census[1].openStreams
    );
    // AbortController construction is allowed to be per-navigation (the store
    // builds one per state change); what matters is that none survive. See
    // assertion 5.

    // Opt-in census dump. `LIFECYCLE_REPORT=1 npx vitest run
    // tests/step-navigation-lifecycle.test.jsx` prints what the probe saw,
    // which is how a future maintainer decides whether a new survivor belongs
    // on LISTENER_ALLOWLIST or is a real defect.
    if (process.env.LIFECYCLE_REPORT) console.log(`\nLIFECYCLE CENSUS\n${report}`);

    // --- Assertion 3: unmount releases every interval ---------------------
    unmount();
    await flush(3);

    expect(intervals.createdCount(), `no interval was ever created\n${report}`).toBeGreaterThan(0);
    expect(intervals.live(), `setInterval survived unmount\n${report}`).toEqual([]);

    // --- Assertion 4: unmount releases every window/document listener -----
    const survivors = listeners
      .snapshot()
      .filter((entry) => !baselineListeners.includes(entry));
    const unexpected = survivors.filter((entry) => !LISTENER_ALLOWLIST.includes(entry));
    expect(unexpected, `listener survived unmount\n${report}`).toEqual([]);

    // Allowlisted entries are exempt from removal, never from growth.
    for (const allowed of LISTENER_ALLOWLIST) {
      const perCycle = census.map((c) => c.listeners.filter((e) => e === allowed).length);
      expect(perCycle[2], `allowlisted listener "${allowed}" is growing\n${report}`).toBe(
        perCycle[1]
      );
    }

    // --- Assertion 5: no AbortController is left dangling -----------------
    expect(aborts.controllers.length, `no AbortController was ever created\n${report}`)
      .toBeGreaterThan(0);
    if (process.env.LIFECYCLE_REPORT) {
      const abortedNow = aborts.controllers.filter((c) => c.signal.aborted).length;
      console.log(
        `AbortControllers post-unmount: total=${aborts.controllers.length} ` +
          `aborted=${abortedNow} settledSignals=${settledSignals.size}`
      );
    }
    // Measured today (classic flow): 106 constructed, 106/106 aborted after
    // unmount, with 46 signals also attached to a settled request. So the
    // `settled` disjunct in `dangling()` is currently SLACK, not the deciding
    // branch — the code is strictly better than the contract asserted here.
    // The disjunct is kept because a fire-and-forget controller on an
    // already-completed request is a legitimate pattern that must not be
    // reported as a leak, and it is proven non-vacuous by the self-check
    // below rather than by this run.
    const dangling = aborts.dangling(settledSignals);
    expect(dangling.length, `AbortController neither aborted nor settled\n${report}`).toBe(0);

    // --- Assertion 6: no EventSource is left open -------------------------
    // Guarded first: "nothing open" is only meaningful if something was
    // opened. Without this the assertion would pass on an OperationsStep that
    // never streams at all.
    expect(
      streams.instances.length,
      `no EventSource was ever opened, so the stream assertion would be vacuous\n${report}`
    ).toBeGreaterThan(0);
    expect(streams.open().map((es) => es.url), `EventSource survived unmount\n${report}`).toEqual(
      []
    );

    return { stepLabels, census };
  }

  test("classic flow: three forward/back sweeps leak no interval, listener, controller or stream", async () => {
    const { stepLabels } = await runNavigationSweep({ label: "classic" });
    // Pin the inventory this variant actually probed, so a future step-list
    // change cannot silently shrink coverage while the test still passes.
    expect(stepLabels).toEqual([
      "Blueprint",
      "Methodology",
      "Global Strategy",
      "Host Inventory",
      "Operators",
      "Assets & Guide",
      "Run oc-mirror",
      "Operations",
    ]);
  }, 60_000);

  test("segmented flow: three forward/back sweeps leak no interval, listener, controller or stream", async () => {
    segmentedFlow = true;
    const { stepLabels } = await runNavigationSweep({ label: "segmented" });
    expect(stepLabels).toEqual([
      "Blueprint",
      "Methodology",
      "Identity & Access",
      "Networking",
      "Connectivity & Mirroring",
      "Trust & Proxy",
      "Platform Specifics",
      "Hosts / Inventory",
      "Operators",
      "Assets & Guide",
      "Run oc-mirror",
      "Operations",
    ]);
  }, 60_000);

  /**
   * Second, independent sweep: mount and unmount the whole shell repeatedly.
   *
   * Step navigation inside one shell cannot see a resource that the SHELL
   * itself acquires once and never releases (App.jsx's 15 s jobs-count poll is
   * exactly that shape). Remounting is what exposes it.
   */
  test("repeated full mount/unmount of the shell returns every resource to baseline", async () => {
    const baselineListeners = listeners.snapshot();
    const perMount = [];

    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line no-await-in-loop
      const { unmount } = await act(async () => render(<App />));
      // eslint-disable-next-line no-await-in-loop
      await flush(6);
      perMount.push({
        liveIntervals: intervals.live().length,
        liveListeners: listeners.snapshot().length,
      });
      unmount();
      // eslint-disable-next-line no-await-in-loop
      await flush(3);
      perMount[i].afterUnmountIntervals = intervals.live().length;
      // Same allowlist as the navigation sweeps, and for the same reason.
      // Applying it here is not cosmetic: react-dom's once-per-document
      // `selectionchange` registration is guarded by a marker it sets ON THE
      // DOCUMENT, so it is registered by whichever test mounts React FIRST.
      // Without this filter the result would depend on test order — verified
      // by running this test alone with `-t "repeated full mount"`, which
      // failed with 3 survivors while the whole file passed.
      perMount[i].afterUnmountListeners = listeners
        .snapshot()
        .filter((e) => !baselineListeners.includes(e) && !LISTENER_ALLOWLIST.includes(e)).length;
    }

    const report = JSON.stringify(perMount, null, 2);
    // Each mount must acquire something, or the probe is watching nothing.
    expect(perMount.some((m) => m.liveIntervals > 0), `no interval armed on mount\n${report}`).toBe(
      true
    );
    // and each unmount must give it all back.
    for (const m of perMount) {
      expect(m.afterUnmountIntervals, `interval survived unmount\n${report}`).toBe(0);
      expect(m.afterUnmountListeners, `listener survived unmount\n${report}`).toBe(0);
    }
  }, 60_000);

  /**
   * RunOcMirrorStep's 2 s job poll (src/steps/RunOcMirrorStep.jsx:208-242).
   *
   * This used to be listed as NOT COVERED on the grounds that `runningJobId`
   * is "writable ONLY by completing a real oc-mirror run". The first half is
   * true — navigation never arms it — but the conclusion was wrong: the run
   * path is three real button clicks (Run preflight -> Run oc-mirror ->
   * Confirm & Run), every one of which is driven entirely by `apiFetch`
   * responses that are already mocked here. No real oc-mirror binary, no
   * backend and no filesystem are involved.
   *
   * So the interval is armed here through the genuine user path rather than by
   * reaching into component state, and then the shell is unmounted WHILE the
   * job is still running. "Its cleanup is structurally identical to the three
   * intervals that ARE proven" was an argument from similarity; this is
   * evidence.
   */
  test("the Run oc-mirror job poll is armed by the real run path and released on unmount", async () => {
    const { unmount } = render(<App />);
    await flush(6);

    const stepLabels = sidebarStepButtons().map((b) =>
      b.querySelector(".step-label")?.textContent.trim()
    );
    const runIndex = stepLabels.indexOf("Run oc-mirror");
    expect(runIndex, "the Run oc-mirror step is not in the sidebar").toBeGreaterThan(-1);
    expect(await clickStep(runIndex)).toBe(true);
    expect(activeStepLabel()).toBe("Run oc-mirror");

    const byText = (text, root = document) =>
      [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
    // The SIDEBAR step button is also labelled "Run oc-mirror", and it comes
    // first in document order. Scope the action lookup to the step's own
    // actions row or the test silently re-clicks navigation instead.
    const actions = document.querySelector(".ocmirror-actions-row");
    expect(actions, "oc-mirror actions row not rendered").toBeTruthy();

    // 1. Preflight must pass, or the Run button stays disabled.
    const preflight = document.querySelector('[data-testid="run-preflight-btn"]');
    expect(preflight, "preflight button not rendered").toBeTruthy();
    await act(async () => {
      fireEvent.click(preflight);
    });
    await flush(4);

    // 2. Open the confirmation modal.
    const runButton = byText("Run oc-mirror", document.querySelector(".ocmirror-actions-row"));
    expect(runButton, "Run oc-mirror action button not rendered").toBeTruthy();
    expect(runButton.disabled, "Run oc-mirror stayed disabled after a passing preflight").toBe(
      false
    );
    await act(async () => {
      fireEvent.click(runButton);
    });
    await flush(3);

    // 3. Confirm. This is what finally sets `runningJobId`.
    const confirm = byText("Confirm & Run");
    expect(confirm, "run confirmation modal did not open").toBeTruthy();
    await act(async () => {
      fireEvent.click(confirm);
    });
    await flush(6);

    // The interval must actually exist, or everything below is vacuous. The
    // 2000 ms delay is the poll's own signature and is not used by any other
    // interval in the tree (App 15 s, OperationsStep 10 s, catalog scan 250 ms).
    const armed = intervals.live();
    expect(
      armed.filter((d) => d === 2000),
      `the 2 s job poll was never armed by the real run path; live intervals = ${JSON.stringify(armed)}`
    ).toHaveLength(1);

    // And it must really be polling, not merely registered.
    const pollsBefore = vi
      .mocked(apiFetch)
      .mock.calls.filter(([p]) => p === `/api/jobs/${RUN_JOB_ID}`).length;
    await advance(6000);
    const pollsAfter = vi
      .mocked(apiFetch)
      .mock.calls.filter(([p]) => p === `/api/jobs/${RUN_JOB_ID}`).length;
    expect(pollsAfter, "the armed interval issued no job poll").toBeGreaterThan(pollsBefore);

    // The job is still "running", so nothing cleared the interval for us.
    expect(intervals.live().filter((d) => d === 2000)).toHaveLength(1);

    unmount();
    await flush(3);

    expect(
      intervals.live(),
      "an interval survived unmount while an oc-mirror job was still running"
    ).toEqual([]);

    // No further polling after unmount either — a cleared handle that somehow
    // still fired would be invisible to the handle census alone.
    const pollsAtUnmount = vi
      .mocked(apiFetch)
      .mock.calls.filter(([p]) => p === `/api/jobs/${RUN_JOB_ID}`).length;
    await advance(6000);
    expect(
      vi.mocked(apiFetch).mock.calls.filter(([p]) => p === `/api/jobs/${RUN_JOB_ID}`).length,
      "the job poll kept calling the backend after unmount"
    ).toBe(pollsAtUnmount);
  }, 60_000);

  /* ---------------------------------------------------------------- *
   * Probe self-check: every matcher above must be able to FAIL.
   *
   * These deliberately leak resources from the TEST itself — never from
   * production code — and assert that the probe sees the leak. A test that
   * cannot fail is worse than no test; this is the evidence that it can.
   * ---------------------------------------------------------------- */
  describe("probe self-check (non-vacuity)", () => {
    test("the interval probe reports an interval that is never cleared", () => {
      expect(intervals.live()).toEqual([]);
      const leaked = setInterval(() => {}, 1234);
      expect(intervals.live()).toEqual([1234]);
      clearInterval(leaked);
      expect(intervals.live()).toEqual([]);
    });

    test("the listener probe reports an unremoved window/document listener", () => {
      const before = listeners.snapshot();
      const leaked = () => {};
      document.addEventListener("click", leaked);
      window.addEventListener("resize", leaked, true);
      const during = listeners.snapshot();
      expect(during.filter((e) => !before.includes(e)).sort()).toEqual([
        "document:click",
        "window:resize:capture",
      ]);

      // Removal with the WRONG capture flag must not be credited — this is
      // the DOM's own rule, and getting it wrong is how a probe silently
      // stops seeing real leaks.
      window.removeEventListener("resize", leaked);
      expect(listeners.snapshot()).toContain("window:resize:capture");

      document.removeEventListener("click", leaked);
      window.removeEventListener("resize", leaked, true);
      expect(listeners.snapshot()).toEqual(before);
    });

    test("the listener probe does not double-count a duplicate registration", () => {
      const before = listeners.snapshot();
      const fn = () => {};
      document.addEventListener("scroll", fn);
      document.addEventListener("scroll", fn);
      expect(listeners.snapshot().filter((e) => e === "document:scroll")).toHaveLength(1);
      document.removeEventListener("scroll", fn);
      expect(listeners.snapshot()).toEqual(before);
    });

    test("the abort probe reports a controller that is neither aborted nor settled", () => {
      const settled = new Set();
      const dangled = new AbortController();
      expect(aborts.dangling(settled)).toContain(dangled);

      // Aborting clears it...
      dangled.abort();
      expect(aborts.dangling(settled)).not.toContain(dangled);

      // ...and so does owning a request that already settled, which is why
      // "not aborted" alone is not treated as a leak.
      const used = new AbortController();
      expect(aborts.dangling(settled)).toContain(used);
      settled.add(used.signal);
      expect(aborts.dangling(settled)).not.toContain(used);
    });

    test("the EventSource probe reports a stream that is never closed", () => {
      const es = new EventSource("http://localhost:4000/api/jobs/x/stream");
      expect(streams.open()).toContain(es);
      es.close();
      expect(streams.open()).not.toContain(es);
    });
  });
});
