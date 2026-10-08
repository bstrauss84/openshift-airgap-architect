/**
 * FQ-10 — VersionSupportGate is the load boundary for per-minor data.
 *
 * The gate exists so that every catalog consumer below it can stay synchronous: no step
 * component had to learn about loading states, which is what kept the lazy-loading
 * change small. These tests assert the two properties that makes that safe:
 *
 *   1. children do not mount until the selected minor's data is resident;
 *   2. a version switch while a load is in flight cannot mount children against the
 *      wrong minor's data.
 *
 * Property 2 is defended twice in the gate — a cancellation flag on the effect, and an
 * identity check comparing the RESOLVED minor to the currently selected one — because a
 * cancellation flag alone does not cover a resolution arriving for a superseded minor
 * within a still-live effect.
 */
import React from "react";
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { SUPPORTED_MINORS } from "../src/shared/versionPolicy.js";

const BASELINE = SUPPORTED_MINORS[0];
const NEWEST = SUPPORTED_MINORS[SUPPORTED_MINORS.length - 1];

/** Deferred promise so a load can be held open across a version switch. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const mockState = { current: null };

vi.mock("../src/store.jsx", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useApp: () => ({
      state: mockState.current,
      startOver: vi.fn(),
      updateState: vi.fn(),
    }),
  };
});

const loadCalls = [];
const pending = new Map();

/**
 * Fake residency set shared by the mocked loaders and the mocked readiness predicates.
 *
 * It must stay COHERENT: the gate now re-derives readiness from actual cache residency
 * (isVersionedDataReady), so a mock that resolves a load while reporting the resource as
 * never-resident would make the gate report a load failure. Modelling residency is what
 * lets these tests keep deterministic control over timing.
 */
const residentCatalogs = new Set();
const residentDocsIndex = new Set();

vi.mock("../src/catalogPaths.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    areCatalogsLoadedForMinor: (minor) => residentCatalogs.has(minor),
    ensureCatalogsForMinor: (minor) => {
      loadCalls.push(minor);
      if (pending.has(minor)) {
        return pending.get(minor).promise.then((resolved) => {
          residentCatalogs.add(minor);
          return resolved;
        });
      }
      residentCatalogs.add(minor);
      return Promise.resolve(minor);
    },
  };
});

vi.mock("../src/docsIndexResolver.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isDocsIndexResolvedForMinor: (minor) => residentDocsIndex.has(minor),
    ensureDocsIndexForMinor: (minor) => {
      residentDocsIndex.add(minor);
      return Promise.resolve(minor);
    },
  };
});

const stateFor = (minor) => ({
  version: { selectedMinor: minor, selectedPatch: `${minor}.1`, selectedChannel: `stable-${minor}`, locked: true },
  release: { channel: minor, patchVersion: `${minor}.1`, confirmed: true },
  ui: {},
});

let VersionSupportGate;

beforeEach(async () => {
  loadCalls.length = 0;
  pending.clear();
  residentCatalogs.clear();
  residentDocsIndex.clear();
  vi.resetModules();
  ({ VersionSupportGate } = await import("../src/App.jsx"));
});

afterEach(() => cleanup());

describe("VersionSupportGate gates on per-minor data", () => {
  test("children do not mount until the selected minor's data is resident", async () => {
    const held = deferred();
    pending.set(NEWEST, held);
    mockState.current = stateFor(NEWEST);

    render(
      <VersionSupportGate>
        <div data-testid="child">loaded</div>
      </VersionSupportGate>
    );

    expect(screen.queryByTestId("child")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(`Loading OpenShift ${NEWEST}`);

    held.resolve(NEWEST);
    await waitFor(() => expect(screen.getByTestId("child")).toBeInTheDocument());
  });

  test("children mount once the load resolves for the selected minor", async () => {
    mockState.current = stateFor(NEWEST);
    render(
      <VersionSupportGate>
        <div data-testid="child">loaded</div>
      </VersionSupportGate>
    );
    await waitFor(() => expect(screen.getByTestId("child")).toBeInTheDocument());
    expect(loadCalls).toContain(NEWEST);
  });

  test("a load resolving for a superseded minor does not mount children", async () => {
    // Select the newest minor and hold its load open.
    const heldNewest = deferred();
    const heldBaseline = deferred();
    pending.set(NEWEST, heldNewest);
    pending.set(BASELINE, heldBaseline);
    mockState.current = stateFor(NEWEST);

    const { rerender } = render(
      <VersionSupportGate>
        <div data-testid="child">loaded</div>
      </VersionSupportGate>
    );
    expect(screen.queryByTestId("child")).toBeNull();

    // User switches to the baseline minor before the first load lands.
    mockState.current = stateFor(BASELINE);
    rerender(
      <VersionSupportGate>
        <div data-testid="child">loaded</div>
      </VersionSupportGate>
    );

    // The stale load now resolves. It must NOT unblock the gate, because the selection
    // has moved on: mounting here would render BASELINE's selection against NEWEST data.
    heldNewest.resolve(NEWEST);
    await Promise.resolve();
    expect(screen.queryByTestId("child")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(`Loading OpenShift ${BASELINE}`);

    // Only the current minor's own load unblocks it.
    heldBaseline.resolve(BASELINE);
    await waitFor(() => expect(screen.getByTestId("child")).toBeInTheDocument());
  });

  test("no version selected mounts children without loading anything", () => {
    mockState.current = { version: {}, release: {}, ui: {} };
    render(
      <VersionSupportGate>
        <div data-testid="child">loaded</div>
      </VersionSupportGate>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(loadCalls).toHaveLength(0);
  });

  test("an unsupported minor shows the recovery UI and never loads data", () => {
    mockState.current = stateFor("4.22");
    render(
      <VersionSupportGate>
        <div data-testid="child">loaded</div>
      </VersionSupportGate>
    );
    expect(screen.queryByTestId("child")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Unsupported OpenShift Version");
    // Fail-closed: 4.22 must not even attempt a catalog load.
    expect(loadCalls).not.toContain("4.22");
  });

  test("a load failure surfaces an error instead of mounting children", async () => {
    const failing = deferred();
    // Rejects, so the mock never marks the catalogs resident - matching reality.
    pending.set(NEWEST, failing);
    mockState.current = stateFor(NEWEST);
    render(
      <VersionSupportGate>
        <div data-testid="child">loaded</div>
      </VersionSupportGate>
    );
    failing.resolve(Promise.reject(new Error("chunk load failed")));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not load OpenShift"));
    expect(screen.queryByTestId("child")).toBeNull();
  });
});
