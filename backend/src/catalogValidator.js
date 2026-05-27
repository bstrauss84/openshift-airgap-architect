/**
 * OpenShift Airgap Architect - Parameter Catalog Validator
 *
 * Provides metadata-driven validation of user state against parameter catalogs.
 * Validates required fields, enum values, and platform-specific applicability.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===================================================================
// CATALOG LOADING
// ===================================================================

let catalogCache = null;

/**
 * Load all parameter catalogs from /data/params/4.20/
 * Caches results for performance.
 *
 * @returns {Object} Map of scenarioId -> catalog object
 */
function loadCatalogs() {
  if (catalogCache) return catalogCache;

  const catalogDir = path.resolve(__dirname, "../../data/params/4.20");

  // Check if directory exists before trying to read
  if (!fs.existsSync(catalogDir)) {
    console.error(`[catalogValidator] Catalog directory not found: ${catalogDir}`);
    console.error(`[catalogValidator] __dirname: ${__dirname}`);
    console.error(`[catalogValidator] Searched path: ${catalogDir}`);
    // Return empty cache - validation will be skipped
    catalogCache = {};
    return catalogCache;
  }

  const catalogFiles = fs.readdirSync(catalogDir).filter((f) => f.endsWith(".json") && !f.includes(".bak"));

  catalogCache = {};

  for (const file of catalogFiles) {
    const scenarioId = file.replace(".json", "");
    const content = JSON.parse(fs.readFileSync(path.join(catalogDir, file), "utf8"));
    catalogCache[scenarioId] = content;
  }

  return catalogCache;
}

/**
 * Get parameter catalog for a specific scenario.
 *
 * @param {string} scenarioId - Scenario identifier (e.g., "bare-metal-ipi")
 * @returns {Object|null} Catalog object or null if not found
 */
export function getCatalog(scenarioId) {
  const catalogs = loadCatalogs();
  return catalogs[scenarioId] || null;
}

/**
 * Get all parameter catalogs.
 *
 * @returns {Object} Map of scenarioId -> catalog object
 */
export function getAllCatalogs() {
  return loadCatalogs();
}

// ===================================================================
// VALUE EXTRACTION FROM STATE
// ===================================================================

/**
 * Extract value from state using dot-notation path.
 * Handles array notation (e.g., "hosts[0].name" or "hosts[].name").
 *
 * @param {Object} state - User state object
 * @param {string} path - Dot-notation path (e.g., "blueprint.baseDomain")
 * @returns {*} Value at path or undefined if not found
 */
function getValueFromState(state, path) {
  if (!state || !path) return undefined;

  // Handle array notation: hosts[].name means check all hosts for name field
  if (path.includes("[]")) {
    const arrayPath = path.split("[]")[0];
    const remainingPath = path.split("[]")[1]?.replace(/^\./, "");

    const arrayValue = getValueFromState(state, arrayPath);
    if (!Array.isArray(arrayValue)) return undefined;

    if (!remainingPath) return arrayValue;

    // Return array of values for each element
    return arrayValue.map((item) => getValueFromState(item, remainingPath));
  }

  // Handle indexed array notation: hosts[0].name
  const indexedArrayMatch = path.match(/^([^[]+)\[(\d+)\]\.(.+)$/);
  if (indexedArrayMatch) {
    const [, arrayPath, index, remainingPath] = indexedArrayMatch;
    const arrayValue = getValueFromState(state, arrayPath);
    if (!Array.isArray(arrayValue)) return undefined;
    return getValueFromState(arrayValue[Number(index)], remainingPath);
  }

  // Standard dot notation
  const parts = path.split(".");
  let current = state;

  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }

  return current;
}

/**
 * Check if a value is present (not null, undefined, or empty string).
 *
 * @param {*} value - Value to check
 * @returns {boolean} True if value is present
 */
function isValuePresent(value) {
  if (value == null) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

// ===================================================================
// VALIDATION FUNCTIONS
// ===================================================================

/**
 * Validate required fields are present in state.
 *
 * @param {Object} state - User state object
 * @param {string} scenarioId - Scenario identifier (e.g., "bare-metal-ipi")
 * @returns {Object} { valid: boolean, errors: Array<{path, message}> }
 */
export function validateRequiredFields(state, scenarioId) {
  const catalog = getCatalog(scenarioId);
  if (!catalog) {
    return { valid: false, errors: [{ path: "catalog", message: `Catalog not found for scenario: ${scenarioId}` }] };
  }

  const errors = [];
  const requiredParams = catalog.parameters.filter((p) => p.required === true);

  for (const param of requiredParams) {
    const value = getValueFromState(state, param.path);

    // Handle array fields: hosts[].name requires ALL hosts to have name
    if (param.path.includes("[]")) {
      if (Array.isArray(value)) {
        const missingIndices = [];
        value.forEach((item, idx) => {
          if (!isValuePresent(item)) {
            missingIndices.push(idx);
          }
        });

        if (missingIndices.length > 0) {
          errors.push({
            path: param.path,
            message: `Required field missing at indices: ${missingIndices.join(", ")}`,
            description: param.description,
          });
        }
      }
    } else {
      // Standard field
      if (!isValuePresent(value)) {
        errors.push({
          path: param.path,
          message: `Required field missing`,
          description: param.description,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate enum values against allowed lists.
 *
 * @param {Object} state - User state object
 * @param {string} scenarioId - Scenario identifier
 * @returns {Object} { valid: boolean, errors: Array<{path, message, allowed}> }
 */
export function validateEnumValues(state, scenarioId) {
  const catalog = getCatalog(scenarioId);
  if (!catalog) {
    return { valid: false, errors: [{ path: "catalog", message: `Catalog not found for scenario: ${scenarioId}` }] };
  }

  const errors = [];
  const enumParams = catalog.parameters.filter(
    (p) => Array.isArray(p.allowed) && p.allowed.length > 0
  );

  for (const param of enumParams) {
    const value = getValueFromState(state, param.path);

    if (!isValuePresent(value)) continue; // Skip empty values (required validation handles this)

    // Handle array values
    if (Array.isArray(value)) {
      value.forEach((item, idx) => {
        if (isValuePresent(item) && !param.allowed.includes(item)) {
          errors.push({
            path: `${param.path}[${idx}]`,
            message: `Invalid value: "${item}"`,
            allowed: param.allowed,
            description: param.description,
          });
        }
      });
    } else {
      // Single value
      if (!param.allowed.includes(value)) {
        errors.push({
          path: param.path,
          message: `Invalid value: "${value}"`,
          allowed: param.allowed,
          description: param.description,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate platform-specific applicability.
 * Checks that parameters only used by specific platforms are not present
 * in states for other platforms.
 *
 * @param {Object} state - User state object
 * @param {string} scenarioId - Scenario identifier
 * @returns {Object} { valid: boolean, errors: Array<{path, message, appliesTo}> }
 */
export function validateApplicability(state, scenarioId) {
  const catalog = getCatalog(scenarioId);
  if (!catalog) {
    return { valid: false, errors: [{ path: "catalog", message: `Catalog not found for scenario: ${scenarioId}` }] };
  }

  const errors = [];

  // Check for parameters that don't apply to this scenario
  for (const param of catalog.parameters) {
    // Skip if parameter applies to this scenario
    if (!param.applies_to || param.applies_to.includes(scenarioId)) continue;

    const value = getValueFromState(state, param.path);

    if (isValuePresent(value)) {
      errors.push({
        path: param.path,
        message: `Parameter does not apply to scenario: ${scenarioId}`,
        appliesTo: param.applies_to,
        description: param.description,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Comprehensive validation combining all checks.
 *
 * @param {Object} state - User state object
 * @param {string} scenarioId - Scenario identifier
 * @returns {Object} { valid: boolean, errors: Object<string, Array> }
 */
export function validateState(state, scenarioId) {
  const requiredValidation = validateRequiredFields(state, scenarioId);
  const enumValidation = validateEnumValues(state, scenarioId);
  const applicabilityValidation = validateApplicability(state, scenarioId);

  const allErrors = {
    required: requiredValidation.errors,
    enum: enumValidation.errors,
    applicability: applicabilityValidation.errors,
  };

  const totalErrors = requiredValidation.errors.length +
                      enumValidation.errors.length +
                      applicabilityValidation.errors.length;

  return {
    valid: totalErrors === 0,
    errors: allErrors,
    totalErrors,
  };
}

// ===================================================================
// SCENARIO DETECTION
// ===================================================================

/**
 * Detect scenario ID from state object.
 * Examines blueprint.platform and methodology.method to determine scenario.
 *
 * @param {Object} state - User state object
 * @returns {string|null} Scenario ID or null if cannot be determined
 */
export function detectScenarioId(state) {
  if (!state?.blueprint) return null;

  // Normalize platform: "Bare Metal" -> "bare-metal", "VMware vSphere" -> "vsphere"
  const platform = state.blueprint.platform;
  if (!platform) return null;

  let normalizedPlatform;
  if (platform === "Bare Metal") {
    normalizedPlatform = "bare-metal";
  } else if (platform === "VMware vSphere" || platform === "vSphere") {
    normalizedPlatform = "vsphere";
  } else if (platform === "AWS GovCloud" || platform === "AWS") {
    normalizedPlatform = "aws";
  } else if (platform === "Azure Government" || platform === "Azure") {
    normalizedPlatform = "azure";
  } else if (platform === "Nutanix") {
    normalizedPlatform = "nutanix";
  } else if (platform === "IBM Cloud" || platform === "IBMCloud") {
    normalizedPlatform = "ibmcloud";
  } else {
    normalizedPlatform = platform.toLowerCase().replace(/\s+/g, "-");
  }

  // Normalize install method: "Agent-Based Installer" -> "agent", "UPI" -> "upi", "IPI" -> "ipi"
  const method = state.methodology?.method;
  let normalizedMethod;
  if (method === "Agent-Based Installer") {
    normalizedMethod = "agent";
  } else if (method === "UPI") {
    normalizedMethod = "upi";
  } else if (method === "IPI") {
    normalizedMethod = "ipi";
  } else if (method) {
    normalizedMethod = method.toLowerCase();
  }

  // Map platform + method to scenario ID
  const scenarioMap = {
    "bare-metal-ipi": "bare-metal-ipi",
    "bare-metal-upi": "bare-metal-upi",
    "bare-metal-agent": "bare-metal-agent",
    "vsphere-ipi": "vsphere-ipi",
    "vsphere-upi": "vsphere-upi",
    "vsphere-agent": "vsphere-agent",
    "aws-ipi": "aws-govcloud-ipi",
    "aws-upi": "aws-govcloud-upi",
    "azure-ipi": "azure-government-ipi",
    "azure-upi": "azure-government-upi",
    "nutanix-ipi": "nutanix-ipi",
    "ibmcloud-ipi": "ibm-cloud-ipi",
  };

  const key = normalizedMethod ? `${normalizedPlatform}-${normalizedMethod}` : normalizedPlatform;
  return scenarioMap[key] || null;
}

/**
 * Clear catalog cache (useful for testing).
 */
export function clearCatalogCache() {
  catalogCache = null;
}
