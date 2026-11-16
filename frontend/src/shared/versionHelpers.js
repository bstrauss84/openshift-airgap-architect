/**
 * OpenShift Airgap Architect - Version Helper Functions
 *
 * v3-aware helpers for accessing version metadata from state.
 * Provides compatibility with v1/v2 legacy fields during migration period.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Get canonical version lock status from state.
 *
 * Prefers v3 `version.locked` field.
 * Falls back to v2 `version.versionConfirmed` or v1 `release.confirmed` for compatibility
 * with stale localStorage or mid-migration import state.
 *
 * @param {object} state - Application state (or subset with version/release)
 * @returns {boolean} Whether version is locked/confirmed
 */
export function getVersionLocked(state) {
  if (!state) return false;

  // v3 canonical field (explicit check for undefined to allow false values)
  if (state.version?.locked !== undefined) {
    return Boolean(state.version.locked);
  }

  // v2 compatibility fallback while stale local/import state is migrating
  if (state.version?.versionConfirmed !== undefined) {
    return Boolean(state.version.versionConfirmed);
  }

  // v1 compatibility fallback
  if (state.release?.confirmed !== undefined) {
    return Boolean(state.release.confirmed);
  }

  return false;
}

/**
 * Get OpenShift version for display purposes.
 *
 * Prefers v3 version fields, falls back to legacy fields, shows neutral text if missing.
 * Does NOT default to hardcoded "4.20" for missing/malformed version.
 *
 * @param {object} state - Application state
 * @param {object} docsIndex - Optional docs index object with version field
 * @returns {string} Version string for display
 */
export function getDisplayOpenShiftVersion(state, docsIndex) {
  return (
    state?.version?.selectedPatch ||
    state?.version?.selectedMinor ||
    state?.version?.selectedChannel ||
    state?.release?.patchVersion ||
    docsIndex?.version ||
    "Version not selected"
  );
}

/**
 * Detect unknown/future state schema version.
 *
 * Returns error object if schema version is unknown/unsupported.
 * Frontend supports v1 (no _schemaVersion), v2 (no _schemaVersion), and v3 (_schemaVersion: 3).
 * Any other _schemaVersion value is unknown/future and must block.
 *
 * @param {object} state - Application state
 * @returns {object|null} Error object { schemaVersion, message } or null if supported
 */
export function detectUnknownSchema(state) {
  if (!state) return null;

  const schemaVersion = state.version?._schemaVersion;

  // No _schemaVersion = v1 or v2 (acceptable - backend will migrate)
  if (schemaVersion === undefined || schemaVersion === null) {
    return null;
  }

  // v3 is supported
  if (schemaVersion === 3) {
    return null;
  }

  // Any other value is unknown/future - BLOCK
  return {
    schemaVersion,
    message: `Unknown state schema version ${schemaVersion}. This state was created by a newer version of this tool. Please upgrade or start a new configuration.`
  };
}
