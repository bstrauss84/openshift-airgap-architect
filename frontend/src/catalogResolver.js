/**
 * Shared catalog resolver for Phase 5 replacement tabs.
 * Read-only: resolve scenario from state, load catalog, get param meta.
 * Validation rules only when catalog explicitly specifies required or allowed.
 * See docs/INDEX.md (authority map) and docs/PARAMS_CATALOG_RULES.md.
 */

import { getScenarioId as getScenarioIdFromPlatformMethod } from "./hostInventoryV2Helpers.js";
import { getCatalogForScenario } from "./catalogPaths.js";
import { getParamMeta } from "./catalogFieldMeta.js";

/**
 * Resolve current scenario ID from app state (for replacement tabs).
 * @param {object} state - app state with blueprint.platform, methodology.method
 * @returns {string|null} e.g. "bare-metal-agent", "bare-metal-ipi", or null
 */
export function getScenarioId(state) {
  const platform = state?.blueprint?.platform;
  const method = state?.methodology?.method;
  return getScenarioIdFromPlatformMethod(platform, method);
}

/** Re-export for replacement tabs. */
export { getCatalogForScenario };

/** Re-export for replacement tabs. */
export { getParamMeta };

/**
 * Returns paths that are required for the given scenario and output file (for required badges).
 * Only includes params where catalog has required: true.
 * @param {string|null} scenarioId - e.g. "bare-metal-agent"
 * @param {string} outputFile - e.g. "install-config.yaml", "agent-config.yaml"
 * @returns {string[]} array of parameter paths
 */
export function getRequiredParamsForOutput(scenarioId, outputFile) {
  const parameters = getCatalogForScenario(scenarioId);
  return parameters
    .filter((p) => p.outputFile === outputFile && p.required === true)
    .map((p) => p.path);
}
