import { isSupportedMinor } from './versionPolicy.js';
import { parseMinorVersionCore } from './openShiftMinor.js';

export const TRANSITION_ERRORS = Object.freeze({
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  INVALID_TARGET: 'INVALID_TARGET',
  PATCH_MINOR_MISMATCH: 'PATCH_MINOR_MISMATCH',
  INVALID_STATE: 'INVALID_STATE',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
});

/**
 * Compute a deterministic state patch for an explicitly requested supported-minor transition.
 *
 * Pure, side-effect-free. Does not mutate input. The returned patch is suitable for
 * one atomic application by a future confirmed UI path (M02).
 *
 * @param {Object} currentState - Current application state
 * @param {string} targetMinor - Target minor version (e.g., "4.21")
 * @param {Object} options
 * @param {number} options.timestamp - Selection timestamp (positive finite number, required for determinism)
 * @param {string} [options.patch] - Explicit patch version; must match targetMinor if provided
 * @returns {{ ok: true, patch: Object } | { ok: false, error: string, code: string }}
 */
export function computeReleaseTransition(currentState, targetMinor, options = {}) {
  if (!currentState || typeof currentState !== 'object') {
    return { ok: false, error: 'Current state must be a non-null object', code: TRANSITION_ERRORS.INVALID_STATE };
  }

  const { timestamp } = options;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
    return { ok: false, error: 'options.timestamp must be a positive finite number', code: TRANSITION_ERRORS.INVALID_TIMESTAMP };
  }

  const parsedMinor = parseMinorVersionCore(targetMinor);
  if (!parsedMinor || parsedMinor !== targetMinor) {
    return { ok: false, error: `Invalid target minor version: "${targetMinor}"`, code: TRANSITION_ERRORS.INVALID_TARGET };
  }

  if (!isSupportedMinor(parsedMinor)) {
    return { ok: false, error: `Unsupported minor version: "${parsedMinor}"`, code: TRANSITION_ERRORS.UNSUPPORTED_VERSION };
  }

  const { patch: explicitPatch } = options;
  let selectedPatch = null;
  if (explicitPatch !== undefined && explicitPatch !== null) {
    const patchMinor = parseMinorVersionCore(explicitPatch);
    if (patchMinor !== parsedMinor) {
      return {
        ok: false,
        error: `Patch "${explicitPatch}" does not match target minor "${parsedMinor}"`,
        code: TRANSITION_ERRORS.PATCH_MINOR_MISMATCH,
      };
    }
    selectedPatch = explicitPatch;
  }

  const version = {
    selectedMinor: parsedMinor,
    selectedPatch,
    selectedChannel: `stable-${parsedMinor}`,
    locked: false,
    lockTimestamp: null,
    selectionTimestamp: timestamp,
    confirmedByUser: false,
    _schemaVersion: 3,
  };

  const release = {
    channel: parsedMinor,
    patchVersion: selectedPatch,
    confirmed: false,
    followLatestMinor: currentState.release?.followLatestMinor ?? true,
  };

  const operators = {
    ...currentState.operators,
    stale: true,
  };

  return {
    ok: true,
    patch: { version, release, operators },
  };
}
