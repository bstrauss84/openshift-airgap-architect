/**
 * Tranche 7C.3 / v2.1 blocker — a catalog-scan job that is GONE must be
 * forgotten, not re-requested on every remount.
 *
 * WHAT A HUMAN SAW. Three job ids (one per catalog: redhat, certified,
 * community) answering
 *
 *     GET /api/jobs/<old-id>   404 Job not found
 *
 * and a fresh round of exactly those three 404s every single time they entered
 * the Operators step.
 *
 * MECHANISM, in three parts, all of which this file now drives behaviourally:
 *
 *   (a) The 404 was recorded ONLY in `const goneIds = new Set()` declared
 *       inside the polling `useEffect`. That set dies on unmount. Nothing
 *       removed the id from the component's `jobs` state or from the persisted
 *       `state.operators.scanJobs`, so the seeding effect re-read the same ids
 *       on the next mount and polling re-armed with a fresh, empty `goneIds`.
 *   (b) The re-arm `setTimeout(poll, 4000)` never captured its handle and
 *       cleanup only set `cancelled = true`, while `poll()` had no `cancelled`
 *       guard at its top — so an armed tick still fired after unmount and
 *       issued a complete round of requests from a dead component.
 *   (c) The backend's `deepMerge` could not delete keys, so even a frontend
 *       clear was resurrected by the next `GET /api/state`. That half is
 *       covered by `backend/test/state-empty-object-clear.test.js`.
 *
 * WHY THE PREVIOUS VERSION OF THIS FILE DID NOT CATCH IT. It rendered nothing
 * and issued no fetch: every piece of behavioural scaffolding it defined was
 * dead code, and the three tests it actually ran were greps over the source
 * text. It passed against the broken code.
 *
 * This file mounts the real step through the real store provider, counts real
 * requests per job id, and drives time with fake timers — never a real sleep.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";

import { makeStoreMock } from "./helpers/store-harness.jsx";

const handle = vi.hoisted(() => ({ initialState: null }));

vi.mock("../src/store.jsx", async (importOriginal) => {
  const actual = await importOriginal();
  return makeStoreMock(actual, handle);
});
vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

const { AppProvider, useApp } = await import("../src/store.jsx");
const { default: OperatorsStep } = await import("../src/steps/OperatorsStep.jsx");
const { apiFetch } = await import("../src/api.js");

const MINOR = "4.22";
const JOB_IDS = { redhat: "stale-job-redhat", certified: "stale-job-certified", community: "stale-job-community" };

/**
 * A locked 4.22 run that already has catalog results AND three persisted scan
 * job ids. Results are present deliberately: it makes the mount-time catalog
 * refetch and the auto-scan both short-circuit, so the ONLY requests this test
 * can observe are the job polls it is measuring.
 */
function stateWithPersistedScanJobs(scanJobs = { ...JOB_IDS }) {
  return {
    _schemaVersion: 3,
    version: {
      _schemaVersion: 3,
      selectedMinor: MINOR,
      selectedPatch: `${MINOR}.16`,
      selectedChannel: `stable-${MINOR}`,
      locked: true,
      confirmedByUser: true,
    },
    release: { channel: MINOR, patchVersion: `${MINOR}.16`, confirmed: true },
    blueprint: { platform: "Bare Metal", arch: "x86_64", clusterName: "c", baseDomain: "example.com", confirmed: true },
    methodology: { method: "Agent-Based Installer" },
    credentials: { redHatPullSecretConfigured: true },
    operators: {
      selected: [],
      scenarios: {},
      pendingScenarios: {},
      scenarioAdded: {},
      catalogs: {
        redhat: [{ id: "op-1", name: "cluster-logging", defaultChannel: "stable" }],
        certified: [],
        community: [],
      },
      version: MINOR,
      scanJobs,
      stale: false,
      fastMode: false,
    },
    imagesetConfig: {},
    reviewFlags: {},
    ui: { visitedSteps: { operators: true }, activeStepId: "operators" },
  };
}

let latestState = null;
const StateProbe = () => {
  const { state } = useApp();
  latestState = state;
  return null;
};

/** Count every `/api/jobs/<id>` request, with a controllable response. */
function wireApi(jobRespond) {
  const pollsById = {};
  apiFetch.mockImplementation((path) => {
    const m = /^\/api\/jobs\/([^/?]+)$/.exec(path);
    if (m) {
      pollsById[m[1]] = (pollsById[m[1]] || 0) + 1;
      return jobRespond(m[1], pollsById[m[1]]);
    }
    // `available: false` keeps the auto-scan effect from starting a NEW scan
    // once the stale ids are cleared, which would add requests this test is
    // not measuring.
    if (path.startsWith("/api/operators/credentials")) return Promise.resolve({ available: false });
    if (path.startsWith("/api/operators/status")) {
      return Promise.resolve({ redhat: [], certified: [], community: [] });
    }
    return Promise.resolve({});
  });
  return pollsById;
}

const gone = () => Promise.reject(Object.assign(new Error("Job not found."), { status: 404 }));
const flaky = () => Promise.reject(Object.assign(new Error("Bad gateway"), { status: 502 }));

/** Let every pending promise settle without advancing the clock. */
async function flush(rounds = 25) {
  for (let i = 0; i < rounds; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function advance(ms) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

function mount() {
  return render(
    <AppProvider>
      <StateProbe />
      <OperatorsStep />
    </AppProvider>
  );
}

describe("catalog scan jobs that answered 404 are forgotten, not re-polled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    latestState = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("requests each stale job exactly once, clears it, and never re-arms", async () => {
    const polls = wireApi(gone);
    handle.initialState = stateWithPersistedScanJobs();

    const view = mount();
    await flush();

    // (1) One request per id — the 404 is terminal, so there is nothing to retry.
    expect(polls).toEqual({
      "stale-job-redhat": 1,
      "stale-job-certified": 1,
      "stale-job-community": 1,
    });

    // (2) No re-arm. The old code scheduled `setTimeout(poll, 4000)` because a
    //     swallowed/uncleared 404 kept `allDone` false.
    await advance(4001);
    await advance(20000);
    expect(polls).toEqual({
      "stale-job-redhat": 1,
      "stale-job-certified": 1,
      "stale-job-community": 1,
    });

    // (3) The persisted reference is gone, and the user is told why.
    expect(latestState.operators.scanJobs).toEqual({});
    expect(latestState.operators.stale).toBe(true);
    // An informational record survives, carrying NO job id — nothing that
    // could be turned back into a request.
    expect(Object.keys(latestState.operators.expiredScans).sort()).toEqual([
      "certified",
      "community",
      "redhat",
    ]);
    expect(JSON.stringify(latestState.operators.expiredScans)).not.toContain("stale-job-");

    // (4) An armed tick must not survive unmount.
    const stateAfterUnmountPoint = JSON.parse(JSON.stringify(latestState));
    view.unmount();
    await advance(10000);
    expect(polls).toEqual({
      "stale-job-redhat": 1,
      "stale-job-certified": 1,
      "stale-job-community": 1,
    });

    // (5) THE ACTUAL BLOCKER: remount with the state the store now holds. The
    //     old build re-seeded the three ids here and 404ed all over again.
    handle.initialState = stateAfterUnmountPoint;
    mount();
    await flush();
    await advance(10000);
    expect(polls).toEqual({
      "stale-job-redhat": 1,
      "stale-job-certified": 1,
      "stale-job-community": 1,
    });
  });

  it("a remount that still carries the stale ids forgets them again, once", async () => {
    // Defence in depth for the persistence half: if a slow GET /api/state hands
    // the component the pre-clear scanJobs, the step must re-learn they are
    // gone in ONE round, not loop.
    const polls = wireApi(gone);
    handle.initialState = stateWithPersistedScanJobs();
    const view = mount();
    await flush();
    view.unmount();

    handle.initialState = stateWithPersistedScanJobs();
    mount();
    await flush();
    await advance(20000);

    expect(polls).toEqual({
      "stale-job-redhat": 2,
      "stale-job-certified": 2,
      "stale-job-community": 2,
    });
    expect(latestState.operators.scanJobs).toEqual({});
  });

  it("NEGATIVE CONTROL: a transient 502 is not terminal — it re-arms and keeps the ids", async () => {
    // A 5xx or a network blip must NOT discard a live scan. If this ever goes
    // green for the wrong reason, the 404 handling has been widened into
    // "treat every error as terminal", which would abandon real scans.
    const polls = wireApi(flaky);
    handle.initialState = stateWithPersistedScanJobs();

    mount();
    await flush();

    expect(polls["stale-job-redhat"]).toBe(1);

    await advance(4001);
    expect(polls).toEqual({
      "stale-job-redhat": 2,
      "stale-job-certified": 2,
      "stale-job-community": 2,
    });

    // Nothing was cleared and nothing was marked expired.
    expect(latestState.operators.scanJobs).toEqual({ ...JOB_IDS });
    expect(latestState.operators.expiredScans).toBeUndefined();
  });

  it("an armed retry tick does not fire after unmount", async () => {
    // Isolates sub-problem (b). A re-arm only exists on the NON-terminal path,
    // so a transient 502 is the only way to have a tick in flight at unmount.
    // Before the fix the handle was never captured, cleanup only set
    // `cancelled = true`, and `poll()` did not consult it on entry — so the
    // tick fired and a dead component issued three more requests.
    const polls = wireApi(flaky);
    handle.initialState = stateWithPersistedScanJobs();

    const view = mount();
    await flush();
    expect(polls).toEqual({
      "stale-job-redhat": 1,
      "stale-job-certified": 1,
      "stale-job-community": 1,
    });

    view.unmount();
    await advance(4001);
    await advance(20000);

    expect(polls, "a scheduled tick survived unmount").toEqual({
      "stale-job-redhat": 1,
      "stale-job-certified": 1,
      "stale-job-community": 1,
    });
  });
});
