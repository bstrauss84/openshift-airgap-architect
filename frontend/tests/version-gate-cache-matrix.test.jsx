/**
 * FQ-10 — gate readiness must require BOTH lazy resources, from a genuinely cold cache.
 *
 * Catalogs and docs-index have independent caches. Deriving readiness from catalogs
 * alone let a warm-catalog / cold-docs-index state look ready, which short-circuited the
 * load effect and left the docs-index permanently unresolved. These tests pin the full
 * 2×2 cache matrix plus the two concurrency cases.
 *
 * IMPORTANT — this file deliberately does NOT mock the loaders.
 *
 * `tests/setup.js` preloads every supported minor so legacy unit tests can call
 * synchronous catalog readers. That preloading would mask exactly the lifecycle contract
 * under test here, so every test below resets BOTH caches to cold first and drives the
 * real `VersionSupportGate` against the real `import.meta.glob` loaders. The afterAll
 * hook restores what setup.js established so file ordering cannot matter.
 */
import React from "react";
import { describe, test, expect, beforeEach, afterEach, afterAll } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";

import { VersionSupportGate, isVersionedDataReady } from "../src/App.jsx";
import { SUPPORTED_MINORS } from "../src/shared/versionPolicy.js";
import {
  ensureCatalogsForMinor,
  areCatalogsLoadedForMinor,
  __resetCatalogCacheForTests,
} from "../src/catalogPaths.js";
import {
  ensureDocsIndexForMinor,
  isDocsIndexResolvedForMinor,
  __resetDocsIndexCacheForTests,
} from "../src/docsIndexResolver.js";

const BASELINE = SUPPORTED_MINORS[0];
const NEWEST = SUPPORTED_MINORS[SUPPORTED_MINORS.length - 1];

const stateFor = (minor) => ({
  version: { selectedMinor: minor, selectedPatch: `${minor}.1`, selectedChannel: `stable-${minor}`, locked: true },
  release: { channel: minor, patchVersion: `${minor}.1`, confirmed: true },
  ui: {},
});

/**
 * Minimal store stub. The gate only reads `state`, `startOver` and `updateState`, so a
 * real provider would add moving parts without adding coverage.
 */
let currentState = null;
const Harness = () => (
  <VersionSupportGate>
    <div data-testid="child">mounted</div>
  </VersionSupportGate>
);

import { vi } from "vitest";
vi.mock("../src/store.jsx", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useApp: () => ({ state: currentState, startOver: vi.fn(), updateState: vi.fn() }),
  };
});

const goCold = () => {
  __resetCatalogCacheForTests();
  __resetDocsIndexCacheForTests();
};

beforeEach(goCold);
afterEach(cleanup);

afterAll(async () => {
  // Restore what tests/setup.js established for every other test file.
  await Promise.all(
    SUPPORTED_MINORS.flatMap((m) => [ensureCatalogsForMinor(m), ensureDocsIndexForMinor(m)])
  );
});

describe("readiness predicate requires both resources", () => {
  test("cold + cold is not ready", () => {
    expect(areCatalogsLoadedForMinor(NEWEST)).toBe(false);
    expect(isDocsIndexResolvedForMinor(NEWEST)).toBe(false);
    expect(isVersionedDataReady(NEWEST)).toBe(false);
  });

  test("warm catalogs + cold docs-index is NOT ready — the short-circuit this guards", async () => {
    await ensureCatalogsForMinor(NEWEST);
    expect(areCatalogsLoadedForMinor(NEWEST)).toBe(true);
    expect(isDocsIndexResolvedForMinor(NEWEST)).toBe(false);
    expect(isVersionedDataReady(NEWEST)).toBe(false);
  });

  test("cold catalogs + warm docs-index is not ready", async () => {
    await ensureDocsIndexForMinor(NEWEST);
    expect(areCatalogsLoadedForMinor(NEWEST)).toBe(false);
    expect(isDocsIndexResolvedForMinor(NEWEST)).toBe(true);
    expect(isVersionedDataReady(NEWEST)).toBe(false);
  });

  test("warm + warm is ready", async () => {
    await Promise.all([ensureCatalogsForMinor(NEWEST), ensureDocsIndexForMinor(NEWEST)]);
    expect(isVersionedDataReady(NEWEST)).toBe(true);
  });

  test("readiness is per minor, never global", async () => {
    await Promise.all([ensureCatalogsForMinor(NEWEST), ensureDocsIndexForMinor(NEWEST)]);
    expect(isVersionedDataReady(NEWEST)).toBe(true);
    expect(isVersionedDataReady(BASELINE)).toBe(false);
  });
});

describe("the real gate, driven from a cold cache", () => {
  test("cold + cold: blocks, then mounts once both resolve", async () => {
    currentState = stateFor(NEWEST);
    render(<Harness />);
    expect(screen.queryByTestId("child")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("child")).toBeInTheDocument());
    expect(areCatalogsLoadedForMinor(NEWEST)).toBe(true);
    expect(isDocsIndexResolvedForMinor(NEWEST)).toBe(true);
  });

  test("warm catalogs + cold docs-index: the gate still loads the docs-index", async () => {
    // The regression: initialising readiness from catalogs alone made this mount
    // immediately with the docs-index never requested.
    await ensureCatalogsForMinor(NEWEST);
    expect(isDocsIndexResolvedForMinor(NEWEST)).toBe(false);

    currentState = stateFor(NEWEST);
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("child")).toBeInTheDocument());
    expect(isDocsIndexResolvedForMinor(NEWEST)).toBe(true);
  });

  test("cold catalogs + warm docs-index: the gate still loads the catalogs", async () => {
    await ensureDocsIndexForMinor(NEWEST);
    expect(areCatalogsLoadedForMinor(NEWEST)).toBe(false);

    currentState = stateFor(NEWEST);
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("child")).toBeInTheDocument());
    expect(areCatalogsLoadedForMinor(NEWEST)).toBe(true);
  });

  test("warm + warm: mounts without blocking", async () => {
    await Promise.all([ensureCatalogsForMinor(NEWEST), ensureDocsIndexForMinor(NEWEST)]);
    currentState = stateFor(NEWEST);
    render(<Harness />);
    // Already resident, so the initializer reports ready on the first render.
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  test("version switch while BOTH are in flight settles on the final selection", async () => {
    currentState = stateFor(NEWEST);
    const { rerender } = render(<Harness />);
    expect(screen.queryByTestId("child")).toBeNull();

    // Switch before anything has resolved.
    currentState = stateFor(BASELINE);
    rerender(<Harness />);

    await waitFor(() => expect(screen.getByTestId("child")).toBeInTheDocument());
    // The gate committed to the minor that was selected last.
    expect(isVersionedDataReady(BASELINE)).toBe(true);
  });

  test("a stale completion from the previous minor does not mount the new one early", async () => {
    currentState = stateFor(NEWEST);
    const { rerender } = render(<Harness />);

    // Let the NEWEST load finish while NEWEST is still selected.
    await waitFor(() => expect(screen.getByTestId("child")).toBeInTheDocument());
    expect(isVersionedDataReady(NEWEST)).toBe(true);

    // Now switch to a minor whose data is still cold. The already-resident NEWEST data
    // must not satisfy readiness for BASELINE.
    __resetCatalogCacheForTests();
    __resetDocsIndexCacheForTests();
    await ensureCatalogsForMinor(NEWEST);
    await ensureDocsIndexForMinor(NEWEST);

    currentState = stateFor(BASELINE);
    await act(async () => {
      rerender(<Harness />);
    });
    expect(isVersionedDataReady(BASELINE)).toBe(true);
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});

describe("fail-closed behaviour is retained", () => {
  test("an unsupported minor never loads and never mounts children", async () => {
    currentState = stateFor("4.23");
    render(<Harness />);
    expect(screen.queryByTestId("child")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Unsupported OpenShift Version");
    expect(areCatalogsLoadedForMinor("4.23")).toBe(false);
    expect(isDocsIndexResolvedForMinor("4.23")).toBe(false);
  });
});
