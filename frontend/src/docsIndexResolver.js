/**
 * Version-aware docs-index resolver.
 *
 * Returns the exact docs-index for the selected OpenShift minor,
 * or null when the version is missing, malformed, or unsupported.
 * No fallback to another minor.
 */

import { getOpenShiftMinorFromState } from "./shared/openShiftMinor.js";
import docsIndex420 from "./data/docs-index/4.20.json";
import docsIndex421 from "./data/docs-index/4.21.json";

const DOCS_INDEX_BY_MINOR = {
  "4.20": docsIndex420,
  "4.21": docsIndex421,
};

export function getDocsIndexForState(state) {
  const minor = getOpenShiftMinorFromState(state);
  if (!minor) return null;
  return DOCS_INDEX_BY_MINOR[minor] || null;
}
