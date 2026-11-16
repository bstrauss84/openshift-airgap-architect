/**
 * OpenShift Airgap Architect - operator catalog search (v2.2.0 M3, A14)
 *
 * Pure, case-insensitive matching on the human-readable display name AND the
 * canonical package name, so a user can type either "Web Terminal" or
 * "web-terminal". Search only filters what is shown: it never touches the
 * selection.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

export const OPERATOR_CATALOG_IDS = Object.freeze(["redhat", "certified", "community"]);

export const OPERATOR_CATALOG_LABELS = Object.freeze({
  redhat: "Red Hat",
  certified: "Certified",
  community: "Community"
});

const normalize = (s) => String(s || "").toLowerCase().trim();

/** True when the operator's display name or package name contains every query word. */
export function operatorMatches(op, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = `${normalize(op?.displayName)} ${normalize(op?.name)}`;
  return words.every((w) => haystack.includes(w));
}

/**
 * @param {{redhat?: object[], certified?: object[], community?: object[]}} catalogs
 * @param {string} query
 * @param {Set<string>} [excludeIds] ids already selected (shown elsewhere, not here)
 * @returns {{redhat: object[], certified: object[], community: object[]}}
 */
export function filterOperatorCatalogs(catalogs, query, excludeIds = new Set()) {
  const out = {};
  for (const id of OPERATOR_CATALOG_IDS) {
    out[id] = (catalogs?.[id] || []).filter((op) => !excludeIds.has(op.id) && operatorMatches(op, query));
  }
  return out;
}
