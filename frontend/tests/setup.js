/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Unmount every rendered React tree after each test.
 *
 * React Testing Library only registers its automatic cleanup when the test
 * runner exposes global `afterEach` — that is, under `globals: true`. This
 * project runs vitest WITHOUT globals, so auto-cleanup was never active, and
 * only some test files called `cleanup()` by hand.
 *
 * The consequence was that component trees were never unmounted, so React
 * effect cleanup functions never ran and any pending timer or subscription
 * outlived its test. `AppProvider` in src/store.jsx debounces its state POST by
 * 600 ms and clears that timer in its effect cleanup; with no unmount the timer
 * survived the test, then fired after vitest had reset module mocks. At that
 * point the mocked `apiFetch` was a bare `vi.fn()` returning `undefined`, and
 * `undefined.catch` threw — surfacing as an intermittent non-zero suite exit
 * (~1 run in 5) even though every assertion passed.
 *
 * This is a test-lifecycle defect, not a product defect: the real `apiFetch` is
 * declared `async` and therefore always returns a Promise, and the production
 * effect cleanup already clears the timer and aborts the request on unmount.
 * Suppressing the symptom with optional chaining would have hidden the leak
 * rather than fixed it.
 *
 * `cleanup()` is idempotent, so test files that already call it themselves are
 * unaffected.
 *
 * Regression coverage: tests/store-persistence-lifecycle.test.jsx
 */
afterEach(() => {
  cleanup();
});

/**
 * FQ-10: preload every supported minor's catalog and docs-index data before any test
 * runs.
 *
 * Production loads this data lazily, per selected minor, behind `VersionSupportGate`
 * (see frontend/src/catalogPaths.js). Unit tests exercise functions that sit *below*
 * that gate — `validateStep`, `getParamMeta`, the step components — and so would
 * otherwise hit `CatalogNotLoadedError` for data the running application always has
 * resident by the time those functions are reachable.
 *
 * Preloading here reproduces the application's post-gate state. It does not weaken the
 * production guarantee: the gate is what enforces load-before-read at runtime, and
 * tests/catalog-lazy-loading.test.js asserts the gate's behaviour directly, including
 * that an unloaded read fails closed rather than returning empty data.
 */
import { SUPPORTED_MINORS } from "../src/shared/versionPolicy.js";
import { ensureCatalogsForMinor } from "../src/catalogPaths.js";
import { ensureDocsIndexForMinor } from "../src/docsIndexResolver.js";

await Promise.all(
  SUPPORTED_MINORS.flatMap((minor) => [
    ensureCatalogsForMinor(minor),
    ensureDocsIndexForMinor(minor),
  ])
);
