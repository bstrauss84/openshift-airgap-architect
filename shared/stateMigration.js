/**
 * State Schema Migration System (v2.0.0 DOC-101 Phase 1 Slice 3)
 *
 * Pure shared migration helper used at ALL state boundaries:
 * - Backend import (/api/run/import)
 * - Backend export (/api/run/export)
 * - Backend generation (generate.js)
 * - Frontend hydration (App.jsx initial state)
 * - Frontend API calls (state updates)
 *
 * State Schema Evolution:
 * - v1: Legacy schema (release.channel, no version object)
 * - v2: Dual schema (release + partial version object, inconsistent)
 * - v3: Canonical version object (version.locked, version.selectedMinor)
 *
 * Migration Rules:
 * - v1 → v3: Migrate release.channel → version.selectedMinor
 * - v2 → v3: Migrate release + version → canonical version object
 * - v3 → v3: No-op (already v3)
 * - Unknown: BLOCK with error (never silent fallback)
 *
 * @module shared/stateMigration
 */

/**
 * Normalize channel name to minor version.
 * Handles both "4.20" and "stable-4.20" formats.
 *
 * @private
 * @param {string} channel - Channel name (e.g., "4.20", "stable-4.20")
 * @returns {string|null} Minor version (e.g., "4.20") or null if malformed
 */
function normalizeChannelToMinor(channel) {
  if (!channel || typeof channel !== 'string') return '4.20';

  // Strip "stable-", "fast-", "candidate-", "eus-" prefixes
  const stripped = channel.replace(/^(stable-|fast-|candidate-|eus-)/, '');

  // Validate format: X.Y where X and Y are digits
  // Accepts: 4.20, 4.21, etc.
  // Rejects: latest, 4.x, 4.20.15, stable-mars, etc.
  const validPattern = /^(\d+)\.(\d+)$/;
  if (!validPattern.test(stripped)) {
    return null; // Malformed channel
  }

  return stripped || '4.20';
}

/**
 * Migrates state from v1/v2 to v3 schema.
 *
 * **CRITICAL**: This function is PURE and IDEMPOTENT.
 * - Does NOT mutate input state
 * - Multiple calls with same input produce same output
 * - Returns new state object (deep clone where needed)
 *
 * @param {Object} state - Input state (v1, v2, or v3)
 * @returns {Object} Migration result with {migrated, wasV1, wasV2, wasV3, error}
 *
 * @example
 * const { migrated, error, wasV2 } = migrateStateToV3(importedState);
 * if (error) throw new Error(error);
 * setState(migrated);
 */
export function migrateStateToV3(state) {
  // Safety: handle null/undefined
  if (!state || typeof state !== 'object') {
    return {
      migrated: null,
      error: 'State must be a non-null object',
      wasV1: false,
      wasV2: false,
      wasV3: false
    };
  }

  // Already v3? Return normalized clone (safe for mutation downstream)
  if (state.version?._schemaVersion === 3) {
    // Deep clone to avoid accidental mutation of shared state
    const cloned = JSON.parse(JSON.stringify(state));

    // Canonicalize legacy confirmation fields even when state is v3
    // This handles the case where a v3 state receives a patch with legacy fields like versionConfirmed
    if (cloned.version) {
      // For v3 states, only canonicalize version-level legacy fields
      // Do NOT use release.confirmed to override version.locked (release is derived, not canonical)
      const hasVersionLegacyConfirmation =
        cloned.version.versionConfirmed !== undefined ||
        cloned.version.confirmedByUser !== undefined;

      if (hasVersionLegacyConfirmation) {
        // Canonicalize version-level legacy fields to locked
        // If ANY version legacy confirmation field is true, set locked to true
        const locked =
          cloned.version.versionConfirmed === true ||
          cloned.version.confirmedByUser === true ||
          (cloned.version.locked !== undefined && cloned.version.locked);

        cloned.version.locked = locked;
        delete cloned.version.versionConfirmed;
        delete cloned.version.confirmedByUser;

        // Sync release from canonical version
        if (cloned.release) {
          cloned.release.confirmed = locked;
        }
      } else {
        // No version-level legacy fields, but sync release.confirmed if inconsistent
        // version.locked is canonical, release.confirmed is derived
        if (cloned.release && cloned.release.confirmed !== cloned.version.locked) {
          cloned.release.confirmed = cloned.version.locked;
        }
      }
    }

    return {
      migrated: cloned,
      wasV1: false,
      wasV2: false,
      wasV3: true,
      error: null
    };
  }

  // Detect v2: has release object, version exists but not v3
  const isV2 = state.release && state.version && !state.version._schemaVersion;

  // Detect v1: has release object, no version object
  const isV1 = state.release && !state.version;

  if (isV2) {
    return migrateV2ToV3(state);
  }

  if (isV1) {
    return migrateV1ToV3(state);
  }

  // Unknown schema version - BLOCK (never silent fallback)
  return {
    migrated: null,
    error: `Unknown state schema version. Expected v1, v2, or v3. Found: ${JSON.stringify({
      hasRelease: !!state.release,
      hasVersion: !!state.version,
      versionSchemaVersion: state.version?._schemaVersion || 'none'
    })}`,
    wasV1: false,
    wasV2: false,
    wasV3: false,
    detectedSchema: 'unknown'
  };
}

/**
 * Migrates v1 state to v3.
 *
 * v1 Schema:
 * ```
 * {
 *   release: { channel: "4.20", confirmed: false, ... },
 *   // No version object
 * }
 * ```
 *
 * v3 Schema:
 * ```
 * {
 *   version: { selectedMinor: "4.20", locked: false, _schemaVersion: 3, ... },
 *   release: { ... } // Kept for backward compat
 * }
 * ```
 *
 * @private
 */
function migrateV1ToV3(state) {
  const selectedMinor = normalizeChannelToMinor(state.release?.channel);

  // Reject malformed channels
  if (selectedMinor === null) {
    return {
      migrated: null,
      error: `Invalid channel format: "${state.release?.channel}". Expected format: "4.20" or "stable-4.20"`,
      wasV1: true,
      wasV2: false,
      wasV3: false
    };
  }

  const migratedState = {
    ...state,
    version: {
      selectedMinor,
      selectedPatch: state.release?.patchVersion || null,
      selectedChannel: `stable-${selectedMinor}`,
      locked: state.release?.confirmed || false,
      lockTimestamp: state.release?.confirmationTimestamp || null,
      selectionTimestamp: Date.now(),

      // Migration metadata
      _migrated: true,
      _migratedFrom: 'v1',
      _previousChannel: state.release?.channel || null,
      _schemaVersion: 3
    },
    // Keep release for backward compat (synced)
    release: {
      channel: selectedMinor,
      patchVersion: state.release?.patchVersion || null,
      confirmed: state.release?.confirmed || false,
      followLatestMinor: state.release?.followLatestMinor ?? true
    }
  };

  return {
    migrated: migratedState,
    wasV1: true,
    wasV2: false,
    wasV3: false,
    error: null
  };
}

/**
 * Migrates v2 state to v3.
 *
 * v2 Schema (inconsistent dual schema):
 * ```
 * {
 *   release: { channel: "4.20", confirmed: true, ... },
 *   version: { selectedChannel: "...", versionConfirmed: true, ... } // No _schemaVersion
 * }
 * ```
 *
 * v3 Schema (canonical):
 * ```
 * {
 *   version: { selectedMinor: "4.20", locked: true, _schemaVersion: 3, ... },
 *   release: { ... } // Synced from version
 * }
 * ```
 *
 * @private
 */
function migrateV2ToV3(state) {
  // Prefer version object values over release object (version is newer)
  const selectedMinor = state.version?.selectedMinor || normalizeChannelToMinor(state.release?.channel);

  // Reject malformed channels
  if (selectedMinor === null) {
    return {
      migrated: null,
      error: `Invalid channel format: "${state.release?.channel}". Expected format: "4.20" or "stable-4.20"`,
      wasV1: false,
      wasV2: true,
      wasV3: false
    };
  }

  const selectedPatch = state.version?.selectedPatch || state.release?.patchVersion || null;

  // Handle multiple legacy confirmation field names
  // Priority: ANY confirmation field === true should set locked: true
  // This matches v3 canonicalization behavior and handles the case where
  // v2 default state has versionConfirmed: false but a patch has release.confirmed: true
  const locked =
    state.version?.locked === true ||
    state.version?.versionConfirmed === true ||
    state.release?.confirmed === true ||
    (state.version?.locked !== undefined && state.version.locked) ||
    false;

  const migratedState = {
    ...state,
    version: {
      selectedMinor,
      selectedPatch,
      selectedChannel: state.version?.selectedChannel || `stable-${selectedMinor}`,
      locked,
      lockTimestamp: state.version?.lockTimestamp || state.release?.confirmationTimestamp || null,
      selectionTimestamp: state.version?.selectionTimestamp || Date.now(),

      // Migration metadata
      _migrated: true,
      _migratedFrom: 'v2',
      _previousChannel: state.release?.channel || null,
      _previousVersionObject: state.version ? { ...state.version } : null,
      _schemaVersion: 3
    },
    // Sync release from canonical version
    release: {
      channel: selectedMinor,
      patchVersion: selectedPatch,
      confirmed: locked,
      followLatestMinor: state.release?.followLatestMinor ?? true
    }
  };

  return {
    migrated: migratedState,
    wasV1: false,
    wasV2: true,
    wasV3: false,
    error: null
  };
}

/**
 * Checks if state is v3 schema without migration.
 *
 * @param {Object} state - State to check
 * @returns {boolean} True if state is already v3
 */
export function isStateV3(state) {
  return state?.version?._schemaVersion === 3;
}

/**
 * Creates a minimal valid v3 state (for defaults).
 *
 * @returns {Object} Minimal v3 state with default values
 */
export function createDefaultV3State() {
  return {
    version: {
      selectedMinor: '4.20',
      selectedPatch: null,
      selectedChannel: 'stable-4.20',
      locked: false,
      lockTimestamp: null,
      selectionTimestamp: null,
      confirmedByUser: false,
      _schemaVersion: 3
    },
    release: {
      channel: '4.20',
      patchVersion: null,
      confirmed: false,
      followLatestMinor: true
    }
  };
}

/**
 * Synchronizes release object from canonical version object.
 *
 * Used after updating version.locked or version.selectedMinor to keep
 * release object in sync for backward compatibility.
 *
 * @param {Object} state - v3 state
 * @returns {Object} State with release synced from version
 */
export function syncReleaseFromVersion(state) {
  if (!isStateV3(state)) {
    throw new Error('syncReleaseFromVersion requires v3 state');
  }

  return {
    ...state,
    release: {
      ...state.release,
      channel: state.version.selectedMinor,
      patchVersion: state.version.selectedPatch,
      confirmed: state.version.locked
    }
  };
}

// ES Module exports
export default {
  migrateStateToV3,
  isStateV3,
  createDefaultV3State,
  syncReleaseFromVersion
};
