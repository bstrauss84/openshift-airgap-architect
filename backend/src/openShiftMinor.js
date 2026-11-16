/**
 * Canonical OpenShift minor (e.g. "4.20") for operator catalog image tags and stable-* channels.
 * release.channel is normally the minor only; accept optional stable- prefix and derive from
 * patchVersion / version.selectedVersion when channel is missing (prevents vnull catalog refs).
 */

import { getMinorVersion } from '../../shared/versionUtils.js';

/**
 * Normalize channel string to minor version, stripping stable- prefix.
 * @param {string|null|undefined} channel - Channel string like "4.20" or "stable-4.20"
 * @returns {string|null} Minor version like "4.20" or null if invalid
 */
function parseChannelMinor(channel) {
  if (channel === null || channel === undefined) return null;
  let s = String(channel).trim();
  if (!s || s.toLowerCase() === "null") return null;

  // Strip stable- prefix if present
  if (/^stable-/i.test(s)) {
    s = s.replace(/^stable-/i, "");
  }

  // Delegate to shared version utility for validation and extraction
  try {
    return getMinorVersion(s);
  } catch {
    // Invalid version format
    return null;
  }
}

/**
 * Extract minor version from patch version or selectedVersion.
 * @param {string|null|undefined} patchVersion - Patch version like "4.20.15"
 * @param {string|null|undefined} selectedVersion - Selected version like "4.21.0"
 * @returns {string|null} Minor version like "4.20" or null if invalid
 */
function minorFromPatch(patchVersion, selectedVersion) {
  const patch =
    (patchVersion != null && String(patchVersion).trim()) ||
    (selectedVersion != null && String(selectedVersion).trim()) ||
    "";
  if (!patch || patch.toLowerCase() === "null") return null;

  // Delegate to shared version utility
  try {
    return getMinorVersion(patch);
  } catch {
    // Invalid version format
    return null;
  }
}

/**
 * DOC-102 Slice 5F.13: Canonical v3 precedence - version.selectedMinor takes priority over release.channel
 *
 * Global state interpretation precedence:
 * 1. version.selectedMinor
 * 2. release.channel
 * 3. version.selectedPatch
 * 4. release.patchVersion
 * 5. version.selectedVersion
 * 6. release.selectedVersion
 *
 * @param {object} [release]
 * @param {object} [version]
 * @returns {string|null}
 */
export function getOpenShiftMinorFromSources(release = {}, version = {}) {
  // Helper to safely extract minor using shared utility
  const tryGetMinor = (v) => {
    if (!v || typeof v !== "string") return null;
    try {
      return getMinorVersion(v);
    } catch {
      return null;
    }
  };

  // 1. Canonical v3: version.selectedMinor
  const fromSelectedMinor = tryGetMinor(version.selectedMinor);
  if (fromSelectedMinor) return fromSelectedMinor;

  // 2. Legacy/derived: release.channel (supports stable-* prefix)
  const fromCh = parseChannelMinor(release.channel);
  if (fromCh) return fromCh;

  // 3. Canonical v3: version.selectedPatch
  const fromSelectedPatch = tryGetMinor(version.selectedPatch);
  if (fromSelectedPatch) return fromSelectedPatch;

  // 4. Fallback: release.patchVersion
  const fromReleasePatch = tryGetMinor(release.patchVersion);
  if (fromReleasePatch) return fromReleasePatch;

  // 5. Fallback: version.selectedVersion
  const fromVersionSelected = tryGetMinor(version.selectedVersion);
  if (fromVersionSelected) return fromVersionSelected;

  // 6. Final fallback: release.selectedVersion
  const fromReleaseSelected = tryGetMinor(release.selectedVersion);
  if (fromReleaseSelected) return fromReleaseSelected;

  return null;
}

/**
 * @param {object} [state]
 * @returns {string|null}
 */
export function getOpenShiftMinorFromState(state) {
  if (!state || typeof state !== "object") return null;
  return getOpenShiftMinorFromSources(state.release || {}, state.version || {});
}
