/**
 * FQ-10 — per-minor lazy loading of versioned catalog and docs-index data.
 *
 * Eager bundling put every supported minor's complete catalog set into the initial
 * application chunk, so the entry grew linearly with the number of supported minors —
 * which R8 makes cumulative by design. Measured entry JS: 2,662 KB eager, 1,048 KB lazy.
 *
 * What these tests protect, beyond the size win:
 *   - version resolution stays FAIL-CLOSED: an unsupported minor is rejected before any
 *     fetch, and an unloaded read throws instead of returning empty data;
 *   - a load that resolves for one minor can never satisfy a read for another, so a
 *     version switch mid-flight cannot bleed stale data.
 *
 * NOTE ON SETUP: tests/setup.js preloads every supported minor, reproducing the
 * application's post-gate state. These tests call __resetCatalogCacheForTests() so they
 * can observe genuine pre-load behaviour, and restore the preload afterwards so they do
 * not disturb other files.
 */
import { describe, test, expect, beforeEach, afterAll } from "vitest";
import {
  ensureCatalogsForMinor,
  areCatalogsLoadedForMinor,
  getCatalogForScenario,
  getAvailableCatalogVersions,
  getAvailableCatalogScenarios,
  UnsupportedVersionError,
  CatalogNotLoadedError,
  __resetCatalogCacheForTests,
} from "../src/catalogPaths.js";
import {
  ensureDocsIndexForMinor,
  getDocsIndexForState,
  isDocsIndexResolvedForMinor,
  __resetDocsIndexCacheForTests,
} from "../src/docsIndexResolver.js";
import { SUPPORTED_MINORS } from "../src/shared/versionPolicy.js";

const BASELINE = SUPPORTED_MINORS[0]; // 4.20
const NEWEST = SUPPORTED_MINORS[SUPPORTED_MINORS.length - 1]; // 4.21

beforeEach(() => {
  __resetCatalogCacheForTests();
  __resetDocsIndexCacheForTests();
});

afterAll(async () => {
  // Restore what tests/setup.js established, so file ordering cannot matter.
  await Promise.all(
    SUPPORTED_MINORS.flatMap((m) => [ensureCatalogsForMinor(m), ensureDocsIndexForMinor(m)])
  );
});

describe("discovery stays synchronous", () => {
  test("available versions are known without loading any catalog", () => {
    // The glob KEYS are static; only the content is deferred. If discovery needed a
    // load, every caller of these would have to become async for no size benefit.
    expect(areCatalogsLoadedForMinor(NEWEST)).toBe(false);
    expect(getAvailableCatalogVersions()).toEqual(expect.arrayContaining(SUPPORTED_MINORS));
  });

  test("available scenarios are known without loading any catalog", () => {
    expect(areCatalogsLoadedForMinor(NEWEST)).toBe(false);
    const scenarios = getAvailableCatalogScenarios(NEWEST);
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios).toContain("bare-metal-agent");
  });
});

describe("fail-closed version resolution", () => {
  test("reading before load throws instead of returning empty data", () => {
    // Returning [] would silently render a scenario with no parameters — exactly the
    // failure mode version-awareness exists to prevent.
    expect(() => getCatalogForScenario("bare-metal-agent", NEWEST)).toThrow(CatalogNotLoadedError);
  });

  test("an unsupported minor is rejected before any fetch is attempted", async () => {
    await expect(ensureCatalogsForMinor("4.23")).rejects.toBeInstanceOf(UnsupportedVersionError);
    expect(areCatalogsLoadedForMinor("4.23")).toBe(false);
  });

  test("an unsupported minor is still rejected after other minors are resident", async () => {
    await ensureCatalogsForMinor(NEWEST);
    await expect(ensureCatalogsForMinor("4.23")).rejects.toBeInstanceOf(UnsupportedVersionError);
    expect(() => getCatalogForScenario("bare-metal-agent", "4.23")).toThrow(UnsupportedVersionError);
  });

  test("loading one minor does not make another readable", async () => {
    await ensureCatalogsForMinor(NEWEST);
    expect(areCatalogsLoadedForMinor(NEWEST)).toBe(true);
    expect(areCatalogsLoadedForMinor(BASELINE)).toBe(false);
    expect(() => getCatalogForScenario("bare-metal-agent", BASELINE)).toThrow(CatalogNotLoadedError);
  });
});

describe("the correct minor's data is loaded and served", () => {
  test("each minor serves its own catalog content", async () => {
    await Promise.all(SUPPORTED_MINORS.map((m) => ensureCatalogsForMinor(m)));
    for (const minor of SUPPORTED_MINORS) {
      const params = getCatalogForScenario("bare-metal-agent", minor);
      expect(Array.isArray(params)).toBe(true);
      expect(params.length).toBeGreaterThan(0);
    }
  });

  test("a patch version resolves to its minor", async () => {
    await ensureCatalogsForMinor(`${NEWEST}.35`);
    expect(areCatalogsLoadedForMinor(NEWEST)).toBe(true);
    expect(getCatalogForScenario("bare-metal-agent", `${NEWEST}.35`).length).toBeGreaterThan(0);
  });

  test("the two minors' catalogs are distinguishable, so a mix-up would be detectable", async () => {
    await Promise.all(SUPPORTED_MINORS.map((m) => ensureCatalogsForMinor(m)));
    const citationMinor = (minor) => {
      const params = getCatalogForScenario("bare-metal-agent", minor);
      const withCitation = params.find((p) => p.citations?.[0]?.url?.includes("openshift_container_platform/"));
      return withCitation.citations[0].url.match(/openshift_container_platform\/(\d+\.\d+)\//)[1];
    };
    // Each minor's catalog cites its own documentation; this is what the citation
    // guard enforces, and it gives these tests a content fingerprint per minor.
    for (const minor of SUPPORTED_MINORS) {
      expect(citationMinor(minor)).toBe(minor);
    }
  });

  test("repeat loads are idempotent and concurrent loads share one result", async () => {
    const [a, b, c] = await Promise.all([
      ensureCatalogsForMinor(NEWEST),
      ensureCatalogsForMinor(NEWEST),
      ensureCatalogsForMinor(NEWEST),
    ]);
    expect([a, b, c]).toEqual([NEWEST, NEWEST, NEWEST]);
    expect(getCatalogForScenario("bare-metal-agent", NEWEST).length).toBeGreaterThan(0);
  });
});

describe("stale async results cannot bleed across a version switch", () => {
  test("a load resolving after a switch cannot satisfy a read for the new minor", async () => {
    // Simulate: user selects 4.21, load starts; user switches to 4.20 before it lands.
    const pendingNewest = ensureCatalogsForMinor(NEWEST);
    // The 4.20 read must not be satisfied by the in-flight 4.21 load...
    expect(() => getCatalogForScenario("bare-metal-agent", BASELINE)).toThrow(CatalogNotLoadedError);
    const resolved = await pendingNewest;
    // ...and once it lands it is still filed under 4.21 only.
    expect(resolved).toBe(NEWEST);
    expect(() => getCatalogForScenario("bare-metal-agent", BASELINE)).toThrow(CatalogNotLoadedError);
  });

  test("ensureCatalogsForMinor reports WHICH minor it loaded, so a caller can reject a stale resolution", async () => {
    // This return value is the contract VersionSupportGate relies on: it compares the
    // resolved minor against the currently selected one and discards a mismatch.
    const results = await Promise.all(SUPPORTED_MINORS.map((m) => ensureCatalogsForMinor(m)));
    expect(results).toEqual(SUPPORTED_MINORS);
  });

  test("interleaved loads each land under their own minor", async () => {
    const [first, second] = await Promise.all([
      ensureCatalogsForMinor(NEWEST),
      ensureCatalogsForMinor(BASELINE),
    ]);
    expect(first).toBe(NEWEST);
    expect(second).toBe(BASELINE);
    const newestParams = getCatalogForScenario("bare-metal-agent", NEWEST);
    const baselineParams = getCatalogForScenario("bare-metal-agent", BASELINE);
    expect(newestParams).not.toBe(baselineParams);
  });
});

describe("docs-index follows the same per-minor model", () => {
  const stateFor = (minor) => ({
    version: { selectedMinor: minor, selectedPatch: `${minor}.1`, selectedChannel: `stable-${minor}`, locked: true },
    release: { channel: minor, patchVersion: `${minor}.1` },
  });

  test("returns null before load rather than another minor's index", async () => {
    expect(isDocsIndexResolvedForMinor(NEWEST)).toBe(false);
    expect(getDocsIndexForState(stateFor(NEWEST))).toBeNull();
  });

  test("serves the selected minor's index after load", async () => {
    await ensureDocsIndexForMinor(NEWEST);
    const idx = getDocsIndexForState(stateFor(NEWEST));
    expect(idx).toBeTruthy();
    expect(idx.version ?? NEWEST).toBeTruthy();
    expect(idx.baseUrl).toContain(`/${NEWEST}/`);
  });

  test("loading one minor's index does not serve it for another", async () => {
    await ensureDocsIndexForMinor(NEWEST);
    expect(getDocsIndexForState(stateFor(BASELINE))).toBeNull();
  });

  test("an unsupported minor never loads", async () => {
    // Resolves null (not the minor) and records nothing: an unsupported minor must not
    // reach "resolved" even as resolved-absent.
    await expect(ensureDocsIndexForMinor("4.23")).resolves.toBeNull();
    expect(isDocsIndexResolvedForMinor("4.23")).toBe(false);
    expect(getDocsIndexForState(stateFor("4.23"))).toBeNull();
  });

  test("each loaded index points at its own minor's documentation", async () => {
    await Promise.all(SUPPORTED_MINORS.map((m) => ensureDocsIndexForMinor(m)));
    for (const minor of SUPPORTED_MINORS) {
      expect(getDocsIndexForState(stateFor(minor)).baseUrl).toContain(`/${minor}/`);
    }
  });
});
