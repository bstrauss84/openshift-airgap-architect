/**
 * Centralized Version Utility
 *
 * Provides semantic version comparison and normalization for OpenShift versions.
 *
 * **CRITICAL RULE:** Never use string comparison for version checks.
 * Always use these utilities to ensure correct semantic version ordering.
 *
 * Supported version format: "4.20", "4.20.15", "4.21.0"
 *
 * @module shared/versionUtils
 */

/**
 * Normalizes an OpenShift version string to canonical format.
 *
 * @param {string} version - Version string (e.g., "4.20", "4.20.15", "v4.20")
 * @returns {string} Normalized version (e.g., "4.20.0", "4.20.15")
 * @throws {Error} If version is invalid format
 *
 * @example
 * normalizeVersion("4.20") → "4.20.0"
 * normalizeVersion("v4.21.5") → "4.21.5"
 * normalizeVersion("4.20.0") → "4.20.0"
 */
function normalizeVersion(version) {
  if (typeof version !== 'string' || !version) {
    throw new Error('Version must be a non-empty string');
  }

  // Remove leading 'v' if present
  const cleaned = version.trim().replace(/^v/, '');

  // Match semantic version pattern (major.minor or major.minor.patch)
  const match = cleaned.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);

  if (!match) {
    throw new Error(`Invalid version format: ${version}. Expected format: "4.20" or "4.20.15"`);
  }

  const [, major, minor, patch = '0'] = match;
  return `${major}.${minor}.${patch}`;
}

/**
 * Extracts the minor version from a full version string.
 *
 * Used for catalog lookups and version-gating logic.
 *
 * @param {string} version - Full version (e.g., "4.20.15", "4.21.0")
 * @returns {string} Minor version (e.g., "4.20", "4.21")
 * @throws {Error} If version is invalid
 *
 * @example
 * getMinorVersion("4.20.15") → "4.20"
 * getMinorVersion("4.21.0") → "4.21"
 * getMinorVersion("4.20") → "4.20"
 */
function getMinorVersion(version) {
  const normalized = normalizeVersion(version);
  const [major, minor] = normalized.split('.');
  return `${major}.${minor}`;
}

/**
 * Compares two OpenShift versions using semantic versioning.
 *
 * @param {string} versionA - First version to compare
 * @param {string} versionB - Second version to compare
 * @returns {number} -1 if A < B, 0 if A === B, 1 if A > B
 * @throws {Error} If either version is invalid
 *
 * @example
 * compareVersions("4.20", "4.21") → -1 (4.20 is less than 4.21)
 * compareVersions("4.21.0", "4.21.0") → 0 (equal)
 * compareVersions("4.21.5", "4.20.10") → 1 (4.21 is greater)
 * compareVersions("4.20.1", "4.20.10") → -1 (patch level comparison)
 */
function compareVersions(versionA, versionB) {
  const normA = normalizeVersion(versionA);
  const normB = normalizeVersion(versionB);

  const [majorA, minorA, patchA] = normA.split('.').map(Number);
  const [majorB, minorB, patchB] = normB.split('.').map(Number);

  // Compare major version
  if (majorA !== majorB) {
    return majorA < majorB ? -1 : 1;
  }

  // Compare minor version
  if (minorA !== minorB) {
    return minorA < minorB ? -1 : 1;
  }

  // Compare patch version
  if (patchA !== patchB) {
    return patchA < patchB ? -1 : 1;
  }

  return 0; // Versions are equal
}

/**
 * Checks if a version is within a specified range (inclusive).
 *
 * @param {string} version - Version to check
 * @param {string|null} minVersion - Minimum version (null = no minimum)
 * @param {string|null} maxVersion - Maximum version (null = no maximum)
 * @returns {boolean} True if version is within range
 * @throws {Error} If version format is invalid
 *
 * @example
 * isVersionInRange("4.20", "4.20", "4.22") → true
 * isVersionInRange("4.19", "4.20", null) → false (below minimum)
 * isVersionInRange("4.23", null, "4.22") → false (above maximum)
 * isVersionInRange("4.21", null, null) → true (no constraints)
 */
function isVersionInRange(version, minVersion, maxVersion) {
  const normalized = normalizeVersion(version);

  if (minVersion !== null) {
    if (compareVersions(normalized, minVersion) < 0) {
      return false; // Version is below minimum
    }
  }

  if (maxVersion !== null) {
    if (compareVersions(normalized, maxVersion) > 0) {
      return false; // Version is above maximum
    }
  }

  return true;
}

/**
 * Checks if version A is greater than or equal to version B.
 *
 * @param {string} versionA - Version to check
 * @param {string} versionB - Version to compare against
 * @returns {boolean} True if A >= B
 *
 * @example
 * isVersionGTE("4.21", "4.20") → true
 * isVersionGTE("4.20", "4.20") → true
 * isVersionGTE("4.19", "4.20") → false
 */
function isVersionGTE(versionA, versionB) {
  return compareVersions(versionA, versionB) >= 0;
}

/**
 * Checks if version A is less than version B.
 *
 * @param {string} versionA - Version to check
 * @param {string} versionB - Version to compare against
 * @returns {boolean} True if A < B
 *
 * @example
 * isVersionLT("4.20", "4.21") → true
 * isVersionLT("4.21", "4.20") → false
 * isVersionLT("4.20", "4.20") → false
 */
function isVersionLT(versionA, versionB) {
  return compareVersions(versionA, versionB) < 0;
}

/**
 * Checks if a parameter is supported for a given OpenShift version.
 *
 * Uses catalog metadata (minVersion/maxVersion) to determine support.
 *
 * @param {Object} param - Catalog parameter with minVersion/maxVersion
 * @param {string} version - OpenShift version to check
 * @returns {boolean} True if parameter is supported for this version
 *
 * @example
 * const param = { path: "foo", minVersion: "4.20", maxVersion: null };
 * isParamSupportedForVersion(param, "4.21") → true
 * isParamSupportedForVersion(param, "4.19") → false
 *
 * const deprecatedParam = { path: "bar", minVersion: "4.19", maxVersion: "4.20" };
 * isParamSupportedForVersion(deprecatedParam, "4.21") → false (removed in 4.21)
 */
function isParamSupportedForVersion(param, version) {
  return isVersionInRange(
    version,
    param.minVersion || null,
    param.maxVersion || null
  );
}

// Node.js module exports
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeVersion,
    getMinorVersion,
    compareVersions,
    isVersionInRange,
    isVersionGTE,
    isVersionLT,
    isParamSupportedForVersion
  };
}

// Browser ES module exports (for frontend)
if (typeof window !== 'undefined') {
  window.versionUtils = {
    normalizeVersion,
    getMinorVersion,
    compareVersions,
    isVersionInRange,
    isVersionGTE,
    isVersionLT,
    isParamSupportedForVersion
  };
}
