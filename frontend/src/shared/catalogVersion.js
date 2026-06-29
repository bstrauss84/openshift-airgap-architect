/**
 * Catalog Version Utilities
 *
 * Strict version parsing for catalog loading.
 * Mirrors shared/versionUtils.js behavior for frontend use.
 *
 * CRITICAL: Never returns default fallback values.
 * Invalid/missing versions throw clear errors.
 *
 * @module frontend/src/shared/catalogVersion
 */

/**
 * Extracts the minor version from a full version string with strict validation.
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

  if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) {
    throw new Error(
      `Invalid version format: "${version}". Expected numeric major.minor (e.g., "4.20")`
    );
  }

  return `${parts[0]}.${parts[1]}`;
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
