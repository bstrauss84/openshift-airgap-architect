/**
 * Version-aware docs-index resolver.
 *
 * Returns the exact docs-index for the selected OpenShift minor,
 * or null when the version is missing, malformed, or unsupported.
 * No fallback to another minor.
 *
 * LAZY by minor (FQ-10), matching catalogPaths.js. Previously each minor's docs-index
 * was a static top-level import, so every supported minor's index sat in the initial
 * chunk. Smaller than the catalogs (~20 KB minified each) but it grows on the same
 * cumulative curve, and keeping one loading model for all versioned data is what stops
 * the next addition from quietly reintroducing the problem.
 */

import { getOpenShiftMinorFromState } from "./shared/openShiftMinor.js";
import { SUPPORTED_MINORS } from "./shared/versionPolicy.js";

const docsIndexLoaders = import.meta.glob("./data/docs-index/*.json");

/**
 * minor -> docs-index object, or `null` meaning RESOLVED-ABSENT.
 *
 * The distinction matters to the gate. "Not yet attempted" and "attempted, and this
 * supported minor genuinely ships no docs-index" must not look alike, or a readiness
 * check cannot tell a cold cache from a legitimately empty one and would either hang
 * forever or short-circuit. Map presence = resolution happened; the value = what it
 * resolved to. Readers pass the minor, so no cross-version bleed.
 */
const docsIndexByMinor = new Map();
const inFlight = new Map();

const pathFor = (minor) => `./data/docs-index/${minor}.json`;

/**
 * Resolve one minor's docs-index. Idempotent and concurrency-safe.
 * @param {string} minor e.g. "4.21"
 * @returns {Promise<string|null>} the resolved minor, or null for an unsupported minor
 */
export function ensureDocsIndexForMinor(minor) {
  if (!minor || !SUPPORTED_MINORS.includes(minor)) return Promise.resolve(null);
  if (docsIndexByMinor.has(minor)) return Promise.resolve(minor);
  if (inFlight.has(minor)) return inFlight.get(minor);

  const loader = docsIndexLoaders[pathFor(minor)];
  if (!loader) {
    // A supported minor with no docs-index is a data gap, not a crash. Record it as an
    // EXPLICIT resolved-absent outcome so the gate can proceed; callers already handle
    // a null index by rendering without documentation links.
    docsIndexByMinor.set(minor, null);
    return Promise.resolve(minor);
  }

  const promise = loader()
    .then((mod) => {
      docsIndexByMinor.set(minor, mod.default ?? mod);
      inFlight.delete(minor);
      return minor;
    })
    .catch((err) => {
      inFlight.delete(minor);
      throw err;
    });

  inFlight.set(minor, promise);
  return promise;
}

/**
 * Whether a minor's docs-index resolution has COMPLETED — including completing as
 * "this minor has no docs-index". Synchronous; this is the gate's readiness input.
 */
export function isDocsIndexResolvedForMinor(minor) {
  return docsIndexByMinor.has(minor);
}

/** Whether resolution completed AND produced an actual index. */
export function hasDocsIndexForMinor(minor) {
  return docsIndexByMinor.get(minor) != null;
}

/** Test seam. */
export function __resetDocsIndexCacheForTests() {
  docsIndexByMinor.clear();
  inFlight.clear();
}

export function getDocsIndexForState(state) {
  const minor = getOpenShiftMinorFromState(state);
  if (!minor) return null;
  // Unchanged contract: null for unsupported, missing, or not-yet-loaded. Callers
  // already handle null, so a pre-load read degrades to "no doc links" rather than
  // to another minor's links.
  return docsIndexByMinor.get(minor) || null;
}
