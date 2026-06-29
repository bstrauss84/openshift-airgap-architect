/**
 * Catalog Version Utilities
 *
 * Strict version parsing for catalog loading.
 * Thin throwing wrapper around core parsing logic (shared with openShiftMinor.js).
 *
 * **Relationship to other version utilities:**
 * - `frontend/src/shared/openShiftMinor.js` → null-safe parsing for UI/state (returns null on invalid)
 * - `frontend/src/shared/catalogVersion.js` → strict throwing parser for catalog loading (throws on invalid)
 *
 * Both share the same core parsing logic (parseMinorVersion) to avoid duplication.
 * catalogVersion wraps it with error throwing for catalog loading safety.
 *
 * CRITICAL: Never returns default fallback values.
 * Invalid/missing versions throw clear errors.
 *
 * @module frontend/src/shared/catalogVersion
 */

/**
 * Core version parsing logic (shared with openShiftMinor.js).
 * Extracted to avoid duplication. Returns null on invalid input.
 *
 * @private
 * @param {string} version - Version string
 * @returns {string|null} Minor version or null if invalid
 */
function parseMinorVersion(version) {
  if (version === null || version === undefined || typeof version !== 'string') {
    return null;
  }

  const cleaned = String(version).trim().replace(/^v/, '');
  if (!cleaned || cleaned.toLowerCase() === 'null') {
    return null;
  }

  const parts = cleaned.split('.').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) {
    return null;
  }

  return `${parts[0]}.${parts[1]}`;
}

/**
 * Extracts the minor version from a full version string with strict validation.
 *
 * Throws on invalid input (required for catalog loading).
 * Use openShiftMinor.js functions for UI/state parsing that needs null-safe behavior.
 *
 * @param {string} version - Full version (e.g., "4.20.15", "4.21.0", "4.20")
 * @returns {string} Minor version (e.g., "4.20", "4.21")
 * @throws {Error} If version is invalid, missing, or malformed
 *
 * @example
 * getMinorVersion("4.20.15") → "4.20"
 * getMinorVersion("4.21.0") → "4.21"
 * getMinorVersion("4.20") → "4.20"
 * getMinorVersion("invalid") → throws Error
 * getMinorVersion(null) → throws Error
 */
export function getMinorVersion(version) {
  const result = parseMinorVersion(version);

  if (result === null) {
    if (!version || typeof version !== 'string') {
      throw new Error(
        `Invalid version: expected non-empty string, got ${typeof version === 'string' ? `"${version}"` : typeof version}`
      );
    }
    const cleaned = String(version).trim().replace(/^v/, '');
    if (!cleaned) {
      throw new Error('Invalid version: empty string after trimming');
    }
    const parts = cleaned.split('.').filter(Boolean);
    if (parts.length < 2) {
      throw new Error(
        `Invalid version format: "${version}". Expected format: "4.20" or "4.20.15"`
      );
    }
    throw new Error(
      `Invalid version format: "${version}". Expected numeric major.minor (e.g., "4.20")`
    );
  }

  return result;
}

/**
 * Validates that a minor version string is well-formed.
 *
 * @param {string} minorVersion - Minor version to validate (e.g., "4.20")
 * @returns {boolean} True if valid
 */
export function isValidMinorVersion(minorVersion) {
  try {
    const result = getMinorVersion(minorVersion);
    return result === minorVersion;
  } catch {
    return false;
  }
}
