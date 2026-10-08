/**
 * OpenShift Airgap Architect - Catalog Path Lookup
 *
 * Version-aware catalog lookup for parameters.
 * Uses frontend copies from frontend/src/data/catalogs/<version>/ (synced from data/params/<version>/).
 * See ADR-001, ADR-005, docs/DATA_AND_FRONTEND_COPIES.md.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { getMinorVersion } from './shared/catalogVersion.js';
import { SUPPORTED_MINORS } from './shared/versionPolicy.js';

/**
 * Per-minor catalog loaders (ADR-005), LAZY by design (FQ-10).
 *
 * This glob is deliberately not `{ eager: true }`. Eager loading put every supported
 * minor's complete catalog set into the initial application chunk, so the browser
 * downloaded 4.20's catalogs to render a 4.21 cluster and the entry bundle grew
 * linearly with the number of supported minors — which R8 makes cumulative by design.
 * Measured: eager entry 2,662 KB, lazy entry 1,115 KB.
 *
 * The loaders are keyed by path; the module keys themselves are static, so version and
 * scenario DISCOVERY stays synchronous. Only the catalog CONTENT is fetched on demand.
 */
const catalogLoaders = import.meta.glob('./data/catalogs/**/*.json');

/**
 * minor -> { scenarioId: catalogObject }, populated by ensureCatalogsForMinor().
 *
 * Keyed by minor, and every reader passes the minor it wants. A late-arriving load for
 * one minor therefore cannot be served to a reader asking for another: cross-version
 * bleed is structurally impossible here rather than merely guarded against.
 */
const catalogsByMinor = new Map();

/** In-flight loads, so concurrent callers share one promise instead of racing. */
const inFlight = new Map();

/**
 * Typed error for unsupported OpenShift versions.
 * UI can catch this to show recovery options instead of generic error boundary.
 */
export class UnsupportedVersionError extends Error {
  constructor(requestedVersion, supportedVersions) {
    super(
      `OpenShift ${requestedVersion} is not supported by this version of OpenShift Airgap Architect. ` +
      `Supported versions: ${supportedVersions.join(', ')}`
    );
    this.name = 'UnsupportedVersionError';
    this.requestedVersion = requestedVersion;
    this.supportedVersions = supportedVersions;
  }
}

/**
 * Thrown when a supported minor's catalogs are read before they have been loaded.
 *
 * This is a programming error, not a user-facing state, and it fails closed: returning
 * empty data would silently render a scenario with no parameters, which is the failure
 * mode version-awareness exists to prevent.
 */
export class CatalogNotLoadedError extends Error {
  constructor(minor) {
    super(
      `Catalogs for OpenShift ${minor} have not been loaded. ` +
      `Call ensureCatalogsForMinor("${minor}") and await it before reading catalog data.`
    );
    this.name = 'CatalogNotLoadedError';
    this.requestedVersion = minor;
  }
}

/**
 * Load every catalog for one minor into the cache. Idempotent and concurrency-safe.
 *
 * @param {string} version e.g. "4.21" or "4.21.35"
 * @returns {Promise<string>} the resolved minor, so a caller can confirm which load
 *   actually completed rather than assuming it was the one it asked for
 * @throws {UnsupportedVersionError} when the minor is outside SUPPORTED_MINORS
 */
export function ensureCatalogsForMinor(version) {
  const minor = getMinorVersion(version);

  // Support policy is checked before any fetch: an unsupported minor must not be
  // loadable even if its files happen to exist on disk.
  if (!SUPPORTED_MINORS.includes(minor)) {
    return Promise.reject(new UnsupportedVersionError(minor, SUPPORTED_MINORS));
  }
  if (catalogsByMinor.has(minor)) return Promise.resolve(minor);
  if (inFlight.has(minor)) return inFlight.get(minor);

  const prefix = `./data/catalogs/${minor}/`;
  const paths = Object.keys(catalogLoaders).filter((p) => p.startsWith(prefix));
  if (paths.length === 0) {
    return Promise.reject(
      new Error(`No catalogs found for OpenShift ${minor}. Refusing to continue with an empty catalog set.`)
    );
  }

  const promise = Promise.all(
    paths.map(async (p) => {
      const mod = await catalogLoaders[p]();
      return [p.slice(prefix.length).replace('.json', ''), mod.default ?? mod];
    })
  )
    .then((entries) => {
      // Commit as one unit. A partially populated bucket would let a reader see some
      // scenarios and not others.
      catalogsByMinor.set(minor, Object.fromEntries(entries));
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
 * Whether a minor's catalogs are resident. Synchronous; for gates and tests.
 * @param {string} version
 * @returns {boolean}
 */
export function areCatalogsLoadedForMinor(version) {
  try {
    return catalogsByMinor.has(getMinorVersion(version));
  } catch {
    return false;
  }
}

/** Test seam: drop all cached catalogs so load behaviour can be exercised repeatedly. */
export function __resetCatalogCacheForTests() {
  catalogsByMinor.clear();
  inFlight.clear();
}

/**
 * Get all available catalog versions from filesystem (sorted descending).
 * @returns {string[]} e.g. ["4.21", "4.20"]
 */
export function getAvailableCatalogVersions() {
  const versions = [...new Set(
    Object.keys(catalogLoaders)
      .filter(p => p.startsWith('./data/catalogs/'))
      .map(p => p.split('/')[3])
      .filter(Boolean)
  )];

  return versions.sort((a, b) => {
    const [aMajor, aMinor] = a.split('.').map(Number);
    const [bMajor, bMinor] = b.split('.').map(Number);
    if (aMajor !== bMajor) return bMajor - aMajor;
    return bMinor - aMinor;
  });
}

/**
 * Get all catalog scenario IDs available for a given version (sorted alphabetically).
 * Derived from the catalog glob — no hand-maintained list.
 * @param {string} version - OpenShift minor version e.g. "4.20", "4.21"
 * @returns {string[]} e.g. ["aws-govcloud-ipi", "azure-government-ipi", ...]
 */
export function getAvailableCatalogScenarios(version) {
  const prefix = `./data/catalogs/${version}/`;
  return [...new Set(
    Object.keys(catalogLoaders)
      .filter(p => p.startsWith(prefix))
      .map(p => p.slice(prefix.length).replace('.json', ''))
      .filter(Boolean)
  )].sort();
}

/**
 * Get the latest supported catalog version (not just filesystem presence).
 * Uses centralized version policy, not filesystem discovery.
 * @returns {string|null} e.g. "4.21" or null if no supported versions
 */
export function getLatestSupportedVersion() {
  if (!SUPPORTED_MINORS.length) return null;
  const sorted = [...SUPPORTED_MINORS].sort((a, b) => {
    const [aMajor, aMinor] = a.split('.').map(Number);
    const [bMajor, bMinor] = b.split('.').map(Number);
    if (aMajor !== bMajor) return bMajor - aMajor;
    return bMinor - aMinor;
  });
  return sorted[0];
}

/**
 * Returns the parameters array for the given scenario and version.
 * Backward compatible with original API (returns parameters array, not catalog object).
 * @param {string} scenarioId - e.g. "bare-metal-agent", "bare-metal-ipi"
 * @param {string} version - OpenShift version e.g. "4.20", "4.21.15"
 * @returns {object[]} parameters array
 * @throws {Error} when version is not supported or scenario not found
 */
export function getCatalogForScenario(scenarioId, version = '4.20') {
  if (!scenarioId || typeof scenarioId !== 'string') {
    throw new Error(`Invalid scenarioId: expected non-empty string, got ${typeof scenarioId}`);
  }

  const minorVersion = getMinorVersion(version);

  // Check against centralized version policy first (Cincinnati availability ≠ app support)
  if (!SUPPORTED_MINORS.includes(minorVersion)) {
    throw new UnsupportedVersionError(minorVersion, SUPPORTED_MINORS);
  }

  // Reads are per-minor, so a load that completed for a different minor can never
  // satisfy this call (FQ-10 stale-result isolation).
  const bucket = catalogsByMinor.get(minorVersion);
  if (!bucket) {
    throw new CatalogNotLoadedError(minorVersion);
  }

  if (!bucket[scenarioId]) {
    // Version is supported and loaded, but the scenario does not exist in it.
    const availableScenarios = Object.keys(bucket).sort().join(', ');
    throw new Error(
      `Catalog not found for scenario "${scenarioId}" in OpenShift ${minorVersion}. ` +
      `Available scenarios: ${availableScenarios || 'none'}`
    );
  }

  const catalog = bucket[scenarioId];
  const parameters = catalog?.parameters;

  if (!Array.isArray(parameters)) {
    throw new Error(`Invalid catalog structure for ${scenarioId} ${minorVersion}: parameters must be an array`);
  }

  return parameters;
}

/**
 * Alias for getCatalogForScenario (both return parameters array).
 * @param {string} scenarioId - e.g. "bare-metal-agent", "bare-metal-ipi"
 * @param {string} version - OpenShift version e.g. "4.20"
 * @returns {object[]} parameters array
 * @throws {Error} when version is not supported or scenario not found
 */
export function getCatalogParameters(scenarioId, version = '4.20') {
  return getCatalogForScenario(scenarioId, version);
}

/**
 * Returns the set of parameter paths that exist in the catalog for the given scenario.
 * @param {string} scenarioId - e.g. "bare-metal-agent", "bare-metal-ipi"
 * @param {string} version - OpenShift version e.g. "4.20"
 * @returns {Set<string>} set of path strings
 * @throws {Error} when version is not supported or scenario not found
 */
export function getCatalogPaths(scenarioId, version = '4.20') {
  const parameters = getCatalogParameters(scenarioId, version);
  if (!parameters.length) return new Set();
  return new Set(parameters.map((p) => p.path));
}
