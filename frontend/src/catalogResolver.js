/**
 * OpenShift Airgap Architect - Catalog Resolver for Replacement Tabs
 *
 * Shared catalog resolver for Phase 5 replacement tabs.
 * Resolves scenario from state, loads catalog, retrieves parameter metadata.
 * Validation rules only apply when catalog explicitly specifies required or allowed values.
 * See docs/INDEX.md (authority map) and docs/PARAMS_CATALOG_RULES.md.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { getScenarioId as getScenarioIdFromPlatformMethod } from "./hostInventoryV2Helpers.js";
import { getCatalogForScenario, getCatalogParameters } from "./catalogPaths.js";
import { getFieldMeta, getParamMeta as getParamMetaFromCatalog } from "./catalogFieldMeta.js";
import { getOpenShiftMinorFromState } from "./shared/openShiftMinor.js";

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

/**
 * Version-aware wrapper for getParamMeta (includes description field).
 * Re-exports catalogFieldMeta's getParamMeta with version from state.
 * @param {string} scenarioId - e.g. "bare-metal-agent"
 * @param {string} path - e.g. "platform.baremetal.apiVIP"
 * @param {string} outputFile - e.g. "install-config.yaml"
 * @param {object} state - app state (for version resolution, optional)
 * @returns {object|null} field metadata with description
 */
export function getParamMeta(scenarioId, path, outputFile, state) {
  const version = state ? (getOpenShiftMinorFromState(state) || '4.20') : '4.20';
  return getParamMetaFromCatalog(scenarioId, path, outputFile, version);
}

/**
 * Returns paths that are required for the given scenario and output file (for required badges).
 * Only includes params where catalog has required: true.
 * @param {string|null} scenarioId - e.g. "bare-metal-agent"
 * @param {string} outputFile - e.g. "install-config.yaml", "agent-config.yaml"
 * @param {object} state - app state (for version resolution)
 * @returns {string[]} array of parameter paths (empty if scenarioId is null)
 */
export function getRequiredParamsForOutput(scenarioId, outputFile, state) {
  if (!scenarioId) return [];
  const version = getOpenShiftMinorFromState(state) || '4.20';
  const parameters = getCatalogParameters(scenarioId, version);
  return parameters
    .filter((p) => p.outputFile === outputFile && p.required === true)
    .map((p) => p.path);
}
