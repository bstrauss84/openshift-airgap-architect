/**
 * Field meta resolver for catalog-driven controls (Phase 4.3).
 * Read-only: scenarioId + outputFile + path → { type, allowed, required, default } when specified in catalog;
 * otherwise returns nulls. Only uses values that are NOT "not specified in docs".
 * Catalogs live in frontend/src/data/catalogs/ (see docs/DATA_AND_FRONTEND_COPIES.md).
 */

import bareMetalAgentCatalog from "./data/catalogs/bare-metal-agent.json";
import bareMetalIpiCatalog from "./data/catalogs/bare-metal-ipi.json";
import bareMetalUpiCatalog from "./data/catalogs/bare-metal-upi.json";
import vsphereIpiCatalog from "./data/catalogs/vsphere-ipi.json";
import vsphereUpiCatalog from "./data/catalogs/vsphere-upi.json";
import awsGovcloudIpiCatalog from "./data/catalogs/aws-govcloud-ipi.json";
import awsGovcloudUpiCatalog from "./data/catalogs/aws-govcloud-upi.json";
import azureGovernmentIpiCatalog from "./data/catalogs/azure-government-ipi.json";
import nutanixIpiCatalog from "./data/catalogs/nutanix-ipi.json";
import vsphereAgentCatalog from "./data/catalogs/vsphere-agent.json";

const CATALOGS = {
  "bare-metal-agent": bareMetalAgentCatalog,
  "bare-metal-ipi": bareMetalIpiCatalog,
  "bare-metal-upi": bareMetalUpiCatalog,
  "vsphere-agent": vsphereAgentCatalog,
  "vsphere-ipi": vsphereIpiCatalog,
  "vsphere-upi": vsphereUpiCatalog,
  "aws-govcloud-ipi": awsGovcloudIpiCatalog,
  "aws-govcloud-upi": awsGovcloudUpiCatalog,
  "azure-government-ipi": azureGovernmentIpiCatalog,
  "nutanix-ipi": nutanixIpiCatalog
};

const NOT_SPECIFIED = "not specified in docs";

function isSpecified(value) {
  if (value == null) return false;
  if (typeof value === "string" && value === NOT_SPECIFIED) return false;
  return true;
}

/**
 * Returns normalized field metadata from the scenario catalog when the parameter exists and has specified values.
 * @param {string|null} scenarioId - e.g. "bare-metal-agent", "bare-metal-ipi"
 * @param {string} outputFile - e.g. "install-config.yaml", "agent-config.yaml"
 * @param {string} path - e.g. "platform.baremetal.apiVIP", "hosts[].role"
 * @returns {{ type: string|null, allowed: string|array|null, required: boolean|null, default: any } | null}
 *   - type, allowed, required, default only set when catalog specifies them (not "not specified in docs").
 *   - allowed is array when catalog has JSON array; string otherwise if specified.
 *   - Returns null when scenarioId is null or parameter not found.
 */
export function getFieldMeta(scenarioId, outputFile, path) {
  const catalog = scenarioId ? CATALOGS[scenarioId] : null;
  const parameters = catalog?.parameters;
  if (!Array.isArray(parameters) || !path) return null;

  const param = parameters.find((p) => p.path === path && p.outputFile === outputFile);
  if (!param) return null;

  const type = isSpecified(param.type) ? param.type : null;
  let allowed = null;
  if (Array.isArray(param.allowed)) {
    allowed = param.allowed;
  } else if (isSpecified(param.allowed)) {
    allowed = param.allowed;
  }
  const required = typeof param.required === "boolean" ? param.required : null;
  const defaultVal = isSpecified(param.default) ? param.default : null;

  return { type, allowed, required, default: defaultVal };
}

/**
 * Returns whether the catalog defines an enum (array of allowed values) for the field.
 * @param {string|null} scenarioId
 * @param {string} outputFile
 * @param {string} path
 * @returns {boolean}
 */
export function hasAllowedList(scenarioId, outputFile, path) {
  const meta = getFieldMeta(scenarioId, outputFile, path);
  return Array.isArray(meta?.allowed) && meta.allowed.length > 0;
}

/** Safe defaults when parameter is not in catalog (per PARAMS_CATALOG_RULES: do not treat as required). */
const DEFAULT_PARAM_META = {
  type: null,
  allowed: null,
  default: null,
  required: false,
  description: null
};

/**
 * Returns param metadata for replacement tabs: type, allowed, default, required, description.
 * Only uses values present in catalog; "not specified in docs" is treated as unspecified.
 * When parameter is not found, returns safe defaults (e.g. required: false).
 * @param {string|null} scenarioId - e.g. "bare-metal-agent", "bare-metal-ipi"
 * @param {string} path - e.g. "metadata.name", "baseDomain"
 * @param {string} outputFile - e.g. "install-config.yaml", "agent-config.yaml"
 * @returns {{ type: string|null, allowed: array|string|null, default: any, required: boolean, description: string|null }}
 */
export function getParamMeta(scenarioId, path, outputFile) {
  const catalog = scenarioId ? CATALOGS[scenarioId] : null;
  const parameters = catalog?.parameters;
  if (!Array.isArray(parameters) || !path) return { ...DEFAULT_PARAM_META };

  const param = parameters.find((p) => p.path === path && p.outputFile === outputFile);
  if (!param) return { ...DEFAULT_PARAM_META };

  const type = isSpecified(param.type) ? param.type : null;
  let allowed = null;
  if (Array.isArray(param.allowed)) {
    allowed = param.allowed;
  } else if (isSpecified(param.allowed)) {
    allowed = param.allowed;
  }
  const defaultVal = isSpecified(param.default) ? param.default : null;
  const required = typeof param.required === "boolean" ? param.required : false;
  const description = typeof param.description === "string" ? param.description : null;

  return { type, allowed, default: defaultVal, required, description };
}
