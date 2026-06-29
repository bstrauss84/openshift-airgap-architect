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

// Dynamic imports for version-aware catalog loading (ADR-005)
const catalogs = import.meta.glob('./data/catalogs/**/*.json', { eager: true });

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
  const catalogPath = `./data/catalogs/${minorVersion}/${scenarioId}.json`;

  if (!catalogs[catalogPath]) {
    // Check if version directory exists at all
    const versionExists = Object.keys(catalogs).some(path => path.startsWith(`./data/catalogs/${minorVersion}/`));

    if (!versionExists) {
      throw new Error(
        `OpenShift ${minorVersion} is not supported yet. Supported versions: 4.20. ` +
        `To add support for ${minorVersion}, create catalogs at frontend/src/data/catalogs/${minorVersion}/`
      );
    } else {
      throw new Error(
        `Catalog not found for scenario "${scenarioId}" in OpenShift ${minorVersion}. ` +
        `Available scenarios: ${Object.keys(catalogs)
          .filter(p => p.startsWith(`./data/catalogs/${minorVersion}/`))
          .map(p => p.split('/').pop().replace('.json', ''))
          .join(', ')}`
      );
    }
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
