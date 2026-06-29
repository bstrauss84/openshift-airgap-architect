/**
 * OpenShift Airgap Architect - Catalog Field Metadata Resolver
 *
 * Version-aware field meta resolver for catalog-driven controls.
 * Maps scenarioId + version + outputFile + path → { type, allowed, required, default } from parameter catalogs.
 * Only uses values that are NOT "not specified in docs".
 * Catalogs live in frontend/src/data/catalogs/<version>/ (see ADR-001, ADR-005, docs/DATA_AND_FRONTEND_COPIES.md).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { getCatalogForScenario } from './catalogPaths';

const NOT_SPECIFIED = "not specified in docs";

function isSpecified(value) {
  if (value == null) return false;
  if (typeof value === "string" && value === NOT_SPECIFIED) return false;
  return true;
}

/**
 * Returns normalized field metadata from the scenario catalog when the parameter exists and has specified values.
 * @param {string} scenarioId - e.g. "bare-metal-agent", "bare-metal-ipi"
 * @param {string} outputFile - e.g. "install-config.yaml", "agent-config.yaml"
 * @param {string} path - e.g. "platform.baremetal.apiVIP", "hosts[].role"
 * @param {string} version - OpenShift version e.g. "4.20"
 * @returns {{ type: string|null, allowed: string|array|null, required: boolean|null, default: any } | null}
 *   - type, allowed, required, default only set when catalog specifies them (not "not specified in docs").
 *   - allowed is array when catalog has JSON array; string otherwise if specified.
 *   - Returns null when scenarioId is null or parameter not found.
 */
export function getFieldMeta(scenarioId, outputFile, path, version = '4.20') {
  if (!scenarioId) return null;

  const parameters = getCatalogForScenario(scenarioId, version);

  if (!Array.isArray(parameters) || parameters.length === 0) return null;

  const param = parameters.find(
    (p) => p.outputFile === outputFile && p.path === path
  );

  if (!param) return null;

  const meta = {
    type: null,
    allowed: null,
    required: null,
    default: undefined
  };

  if (isSpecified(param.type)) {
    meta.type = param.type;
  }

  if (isSpecified(param.allowed)) {
    meta.allowed = param.allowed;
  }

  if (isSpecified(param.required)) {
    meta.required = param.required;
  }

  if (isSpecified(param.default)) {
    meta.default = param.default;
  }

  return meta;
}

/**
 * Backward compatibility wrapper for tests and legacy code.
 * OLD signature: (scenarioId, path, outputFile) vs NEW: (scenarioId, outputFile, path, version)
 * Includes description field for compatibility.
 * @deprecated Use getFieldMeta with correct parameter order
 */
export function getParamMeta(scenarioId, path, outputFile, version = '4.20') {
  const meta = getFieldMeta(scenarioId, outputFile, path, version);

  if (!meta) {
    return {
      type: null,
      allowed: null,
      default: null,
      required: false,
      description: null
    };
  }

  // Add description field from catalog
  const parameters = getCatalogForScenario(scenarioId, version);
  const param = parameters.find((p) => p.path === path && p.outputFile === outputFile);
  const description = param?.description && param.description !== NOT_SPECIFIED ? param.description : null;

  return {
    ...meta,
    description,
    // Ensure required defaults to false when not specified
    required: meta.required ?? false,
    // Ensure default is null when undefined
    default: meta.default !== undefined ? meta.default : null
  };
}

/**
 * Returns whether the catalog defines an enum (array of allowed values) for the field.
 * @param {string|null} scenarioId
 * @param {string} outputFile
 * @param {string} path
 * @param {string} version
 * @returns {boolean}
 */
export function hasAllowedList(scenarioId, outputFile, path, version = '4.20') {
  const meta = getFieldMeta(scenarioId, outputFile, path, version);
  return Array.isArray(meta?.allowed) && meta.allowed.length > 0;
}
