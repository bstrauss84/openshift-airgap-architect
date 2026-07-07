/**
 * Canonical OpenShift minor (e.g. "4.20") for operator catalog image tags and stable-* channels.
 * release.channel is normally the minor only; accept optional stable- prefix and derive from
 * patchVersion / version.selectedVersion when channel is missing (prevents vnull catalog refs).
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

/**
 * DOC-102 Slice 5F.13: Canonical v3 precedence - version.selectedMinor takes priority over release.channel
 * Precedence: version.selectedMinor → release.channel → version.selectedPatch → patches → selectedVersion
 *
 * @param {object} [release]
 * @param {object} [version]
 * @returns {string|null}
 */
export function getOpenShiftMinorFromSources(release = {}, version = {}) {
  // Parse version parsing primitive (shared across utilities)
  const parseMinorCore = (v) => {
    if (!v || typeof v !== "string") return null;
    const parts = v.split(".").filter(Boolean);
    if (parts.length < 2) return null;
    if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return null;
    return `${parts[0]}.${parts[1]}`;
  };

  // 1. Canonical v3: version.selectedMinor
  const fromSelectedMinor = version.selectedMinor ? parseMinorCore(version.selectedMinor) : null;
  if (fromSelectedMinor) return fromSelectedMinor;

  // 2. Legacy/derived: release.channel
  const fromCh = parseChannelMinor(release.channel);
  if (fromCh) return fromCh;

  // 3. Canonical v3: version.selectedPatch
  const fromSelectedPatch = version.selectedPatch ? parseMinorCore(version.selectedPatch) : null;
  if (fromSelectedPatch) return fromSelectedPatch;

  // 4. Fallbacks: patches and selectedVersion
  return minorFromPatch(release.patchVersion, version.selectedVersion);
}

/**
 * @param {object} [state]
 * @returns {string|null}
 */
export function getOpenShiftMinorFromState(state) {
  if (!state || typeof state !== "object") return null;
  return getOpenShiftMinorFromSources(state.release || {}, state.version || {});
}
