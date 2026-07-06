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

// Dynamic imports for version-aware catalog loading (ADR-005)
const catalogs = import.meta.glob('./data/catalogs/**/*.json', { eager: true });

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
 * Get all available catalog versions from filesystem (sorted descending).
 * @returns {string[]} e.g. ["4.21", "4.20"]
 */
export function getAvailableCatalogVersions() {
  const versions = [...new Set(
    Object.keys(catalogs)
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

  const catalogPath = `./data/catalogs/${minorVersion}/${scenarioId}.json`;

  if (!catalogs[catalogPath]) {
    // Version is supported but scenario doesn't exist
    const availableScenarios = Object.keys(catalogs)
      .filter(p => p.startsWith(`./data/catalogs/${minorVersion}/`))
      .map(p => p.split('/').pop().replace('.json', ''))
      .join(', ');

    throw new Error(
      `Catalog not found for scenario "${scenarioId}" in OpenShift ${minorVersion}. ` +
      `Available scenarios: ${availableScenarios || 'none'}`
    );
  }

  const catalog = catalogs[catalogPath].default ?? catalogs[catalogPath];
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
