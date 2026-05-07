/**
 * Canonical OpenShift minor (e.g. "4.20") — mirrors backend/src/openShiftMinor.js for UI consistency.
 */

function parseChannelMinor(channel) {
  if (channel === null || channel === undefined) return null;
  let s = String(channel).trim();
  if (!s || s.toLowerCase() === "null") return null;
  if (/^stable-/i.test(s)) s = s.replace(/^stable-/i, "");
  const m = s.match(/^(\d+)\.(\d+)/);
  if (!m) return null;
  return `${m[1]}.${m[2]}`;
}

function minorFromPatch(patchVersion, selectedVersion) {
  const patch =
    (patchVersion != null && String(patchVersion).trim()) ||
    (selectedVersion != null && String(selectedVersion).trim()) ||
    "";
  if (!patch || patch.toLowerCase() === "null") return null;
  const parts = patch.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return null;
  return `${parts[0]}.${parts[1]}`;
}

export function getOpenShiftMinorFromSources(release = {}, version = {}) {
  const fromCh = parseChannelMinor(release.channel);
  if (fromCh) return fromCh;
  return minorFromPatch(release.patchVersion, version.selectedVersion);
}

export function getOpenShiftMinorFromState(state) {
  if (!state || typeof state !== "object") return null;
  return getOpenShiftMinorFromSources(state.release || {}, state.version || {});
}
