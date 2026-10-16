/**
 * Regression: "Tools -> Export Run" must never hand the user a stale snapshot.
 *
 * `exportRun` (src/App.jsx) downloads whatever `GET /api/run/export` returns, and
 * that endpoint serialises the SERVER's copy of the run. The server copy is only
 * refreshed by the debounced `POST /api/state` in src/store.jsx, which waits
 * 600 ms after the last edit. So the window between an edit and the debounce
 * firing is a window in which Export Run writes a file that silently predates the
 * edit the user just made — and the file looks completely normal.
 *
 * Two failure modes are covered, because they need different fixes:
 *
 *   1. Pending debounce. The edit is in the browser but has not been POSTed yet.
 *      Export must flush first and only then read the server copy.
 *   2. Failed save. The POST happened and was rejected/dropped. store.jsx used to
 *      swallow this with `.catch(() => {})`, so the UI believed it was saved.
 *      Export must refuse rather than emit a backup the user will trust.
 *
 * These are ordering assertions against the recorded apiFetch call log, not copy
 * assertions, so they fail if the flush is removed or reordered.
 */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

import { apiFetch } from "../src/api.js";
import { AppProvider, useApp } from "../src/store.jsx";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "http://localhost:4000" }));

const DEBOUNCE_MS = 600;

function hydrated() {
  return {
    _schemaVersion: 3,
    version: { selectedMinor: "4.21", selectedPatch: "4.21.20", selectedChannel: "stable-4.21", locked: false },
    ui: {},
  };
}

/** Ordered log of the calls that matter, so ordering can be asserted directly. */
function callLog() {
  return vi.mocked(apiFetch).mock.calls.map(([path, opts]) => `${opts?.method || "GET"} ${path}`);
}

function persistCalls() {
  return vi.mocked(apiFetch).mock.calls.filter(
    ([path, opts]) => path === "/api/state" && opts?.method === "POST"
  );
}

/**
 * Consumer that mutates state and then exports, mirroring what App.jsx's
 * `exportRun` does: flush any pending save, then read the server copy.
 */
function Harness({ onResult }) {
  const { state, updateState, flushPendingSave } = useApp();
  return (
    <div>
      <button type="button" data-testid="edit" onClick={() => updateState({ scratchpad: "edited-value" })}>
        {state ? "ready" : "loading"}
      </button>
      <button
        type="button"
        data-testid="export"
        onClick={async () => {
          const flush = await flushPendingSave();
          if (!flush.ok) {
            onResult({ exported: false, reason: flush.error });
            return;
          }
          const data = await apiFetch("/api/run/export");
          onResult({ exported: true, data });
        }}
      >
        export
      </button>
    </div>
  );
}

describe("Export Run freshness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation(() => Promise.resolve(hydrated()));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("the store exposes a flush so a pending save can be forced", () => {
    // Without this the race is unfixable from App.jsx: the pending payload and
    // its timer are private to the provider.
    let api = null;
    function Probe() {
      api = useApp();
      return null;
    }
    render(
      <AppProvider>
        <Probe />
      </AppProvider>
    );
    expect(typeof api.flushPendingSave).toBe("function");
  });

  test("exporting immediately after an edit persists the edit BEFORE reading the server copy", async () => {
    const results = [];
    const { getByTestId } = render(
      <AppProvider>
        <Harness onResult={(r) => results.push(r)} />
      </AppProvider>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Edit, then export well inside the 600 ms debounce window.
    await act(async () => {
      getByTestId("edit").click();
      await vi.advanceTimersByTimeAsync(10);
    });

    const postsBeforeExport = persistCalls().length;

    await act(async () => {
      getByTestId("export").click();
      await vi.advanceTimersByTimeAsync(0);
    });

    // A save must have been forced rather than waiting out the debounce.
    expect(persistCalls().length).toBeGreaterThan(postsBeforeExport);

    // And it must carry the edit.
    const lastPost = persistCalls()[persistCalls().length - 1];
    expect(JSON.parse(lastPost[1].body).scratchpad).toBe("edited-value");

    // Ordering is the actual guarantee: POST /api/state precedes the export read.
    const log = callLog();
    const lastPostIdx = log.lastIndexOf("POST /api/state");
    const exportIdx = log.lastIndexOf("GET /api/run/export");
    expect(exportIdx).toBeGreaterThan(-1);
    expect(lastPostIdx).toBeLessThan(exportIdx);

    expect(results[0]?.exported).toBe(true);
  });

  test("a failed save aborts the export instead of emitting a stale backup", async () => {
    const results = [];
    const { getByTestId } = render(
      <AppProvider>
        <Harness onResult={(r) => results.push(r)} />
      </AppProvider>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Every POST now fails, as a 400/500/offline backend would.
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state" && opts?.method === "POST") {
        return Promise.reject(new Error("Validation failed"));
      }
      return Promise.resolve(hydrated());
    });

    await act(async () => {
      getByTestId("edit").click();
      await vi.advanceTimersByTimeAsync(10);
    });

    await act(async () => {
      getByTestId("export").click();
      await vi.advanceTimersByTimeAsync(0);
    });

    // The export read must NOT have happened.
    expect(callLog()).not.toContain("GET /api/run/export");
    expect(results[0]?.exported).toBe(false);
    expect(String(results[0]?.reason || "")).toMatch(/Validation failed/);
  });

  test("exporting with nothing pending does not force a redundant save", async () => {
    // Guards against 'fixing' the race by POSTing unconditionally on every export.
    const results = [];
    const { getByTestId } = render(
      <AppProvider>
        <Harness onResult={(r) => results.push(r)} />
      </AppProvider>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      getByTestId("edit").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);
    });
    // Drain the save's own microtasks so the generation watermark has advanced
    // before the "is anything pending?" question is asked.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const settled = persistCalls().length;

    await act(async () => {
      getByTestId("export").click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(persistCalls().length).toBe(settled);
    expect(results[0]?.exported).toBe(true);
  });

  test("a late reply for an OLDER generation cannot mark a newer edit as saved", async () => {
    // The ordering hazard the generation watermark exists for. Generation N's POST
    // is answered AFTER generation N+1's. A boolean "saved" flag would be set by
    // the late reply and the newer edit would never be flushed, so Export Run
    // would serve a snapshot missing it.
    const resolvers = [];
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state" && opts?.method === "POST") {
        return new Promise((resolve) => resolvers.push({ resolve, body: opts.body }));
      }
      return Promise.resolve(hydrated());
    });

    let api = null;
    function Probe() {
      api = useApp();
      return null;
    }
    render(
      <AppProvider>
        <Probe />
      </AppProvider>
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const answer = (value) => {
      const hit = resolvers.find((r) => JSON.parse(r.body).scratchpad === value && !r.done);
      if (hit) { hit.done = true; hit.resolve(hydrated()); }
      return Boolean(hit);
    };

    // Generation N reaches the network and is deliberately left unanswered.
    await act(async () => { api.updateState({ scratchpad: "first" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50); });
    expect(resolvers.some((r) => JSON.parse(r.body).scratchpad === "first")).toBe(true);

    // Generation N+1 supersedes it while N is still outstanding.
    await act(async () => { api.updateState({ scratchpad: "second" }); });

    // Start the flush but do NOT await it yet: it is legitimately blocked on the
    // outstanding generation N, and awaiting here would deadlock the test rather
    // than the product.
    let flushPromise = null;
    await act(async () => {
      flushPromise = api.flushPendingSave();
      await vi.advanceTimersByTimeAsync(0);
    });

    // Now answer the OLDER request, late and out of order.
    await act(async () => {
      expect(answer("first")).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
    });

    // The late reply for N must NOT have satisfied N+1: a POST carrying "second"
    // must still be issued. A boolean "saved" flag would have skipped it, and
    // Export Run would then have served a snapshot missing the newer edit.
    await act(async () => {
      expect(answer("second")).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
    });

    const flushed = await flushPromise;
    expect(flushed?.ok).toBe(true);
    const bodies = persistCalls().map(([, o]) => JSON.parse(o.body).scratchpad);
    expect(bodies).toContain("second");
  });

  test("unmounting mid-flush does not leave a pending timer or throw", async () => {
    const { getByTestId, unmount } = render(
      <AppProvider>
        <Harness onResult={() => {}} />
      </AppProvider>
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { getByTestId("edit").click(); });

    unmount();

    let thrown = null;
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3); });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeNull();
  });

  test("rapid edits export the LAST value, not an intermediate one", async () => {
    function RapidHarness({ onResult }) {
      const { state, updateState, flushPendingSave } = useApp();
      return (
        <div>
          <button type="button" data-testid="edit-a" onClick={() => updateState({ scratchpad: "a" })}>
            {state ? "ready" : "loading"}
          </button>
          <button type="button" data-testid="edit-b" onClick={() => updateState({ scratchpad: "b" })}>b</button>
          <button
            type="button"
            data-testid="export"
            onClick={async () => {
              const flush = await flushPendingSave();
              onResult({ ok: flush.ok });
            }}
          >
            export
          </button>
        </div>
      );
    }

    const results = [];
    const { getByTestId } = render(
      <AppProvider>
        <RapidHarness onResult={(r) => results.push(r)} />
      </AppProvider>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Each interaction needs its own act() so React commits the state change and
    // runs the persistence effect before the next one is dispatched.
    await act(async () => {
      getByTestId("edit-a").click();
      await vi.advanceTimersByTimeAsync(5);
    });
    await act(async () => {
      getByTestId("edit-b").click();
      await vi.advanceTimersByTimeAsync(5);
    });
    await act(async () => {
      getByTestId("export").click();
      await vi.advanceTimersByTimeAsync(0);
    });

    const lastPost = persistCalls()[persistCalls().length - 1];
    expect(JSON.parse(lastPost[1].body).scratchpad).toBe("b");
    expect(results[0]?.ok).toBe(true);
  });
});

/**
 * Anti-revert guard.
 *
 * The race is only closed while there is exactly ONE place that reads
 * GET /api/run/export, and that place flushes first. A second caller
 * reintroduces the defect silently, which is precisely what had happened:
 * src/steps/ReviewStep.jsx carried its own unflushed `exportRun()`. It was
 * unreachable — the identifier appeared exactly once, its own declaration — so
 * it was never a live vulnerability, but it was a working copy of the bug
 * waiting to be wired up. It has been removed.
 */
describe("single flushing export entrypoint", () => {
  const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

  function jsxFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return jsxFiles(full);
      return /\.jsx?$/.test(e.name) ? [full] : [];
    });
  }

  test("exactly one source file calls GET /api/run/export", () => {
    const callers = jsxFiles(SRC).filter((f) =>
      /apiFetch\(\s*["'`]\/api\/run\/export/.test(fs.readFileSync(f, "utf8"))
    );
    expect(callers.map((f) => path.relative(SRC, f))).toEqual(["App.jsx"]);
  });

  test("that caller awaits flushPendingSave before reading the server copy", () => {
    const app = fs.readFileSync(path.join(SRC, "App.jsx"), "utf8");
    const flushIdx = app.indexOf("await flushPendingSave()");
    const exportIdx = app.indexOf('apiFetch("/api/run/export")');
    expect(flushIdx).toBeGreaterThan(-1);
    expect(exportIdx).toBeGreaterThan(-1);
    expect(flushIdx).toBeLessThan(exportIdx);
  });
});
