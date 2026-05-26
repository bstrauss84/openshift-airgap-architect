/**
 * OpenShift Airgap Architect - YAML Validation Against Parameter Catalogs
 *
 * Validates generated install-config.yaml, agent-config.yaml, and imageset-config.yaml
 * against parameter catalogs. Checks required fields, enum values, and platform-specific
 * applicability by parsing generated YAML and comparing to catalog metadata.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import yaml from "js-yaml";
import { getCatalog } from "./catalogValidator.js";

// ===================================================================
// YAML VALUE EXTRACTION
// ===================================================================

/**
 * Extract value from parsed YAML object using dot-notation path.
 * Handles array notation (e.g., "hosts[0].name" or "hosts[].name").
 *
 * @param {Object} yamlObj - Parsed YAML object
 * @param {string} path - Dot-notation path (e.g., "baseDomain", "platform.aws.region")
 * @returns {*} Value at path or undefined if not found
 */
function getValueFromYaml(yamlObj, path) {
  if (!yamlObj || !path) return undefined;

  // Handle array notation: hosts[].name means check all hosts for name field
  if (path.includes("[]")) {
    const arrayPath = path.split("[]")[0];
    const remainingPath = path.split("[]")[1]?.replace(/^\./, "");

    const arrayValue = getValueFromYaml(yamlObj, arrayPath);
    if (!Array.isArray(arrayValue)) return undefined;

    if (!remainingPath) return arrayValue;

    // Return array of values for each element
    return arrayValue.map((item) => getValueFromYaml(item, remainingPath));
  }

  // Handle indexed array notation: hosts[0].name
  const indexedArrayMatch = path.match(/^([^[]+)\[(\d+)\]\.(.+)$/);
  if (indexedArrayMatch) {
    const [, arrayPath, index, remainingPath] = indexedArrayMatch;
    const arrayValue = getValueFromYaml(yamlObj, arrayPath);
    if (!Array.isArray(arrayValue)) return undefined;
    return getValueFromYaml(arrayValue[Number(index)], remainingPath);
  }

  // Standard dot notation
  const parts = path.split(".");
  let current = yamlObj;

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
// YAML VALIDATION FUNCTIONS
// ===================================================================

/**
 * Validate required fields are present in generated YAML.
 *
 * @param {string} yamlContent - YAML content as string
 * @param {string} outputFile - Output file name (e.g., "install-config.yaml")
 * @param {string} scenarioId - Scenario identifier (e.g., "bare-metal-ipi")
 * @returns {Object} { valid: boolean, errors: Array<{path, message, description}> }
 */
export function validateRequiredFields(yamlContent, outputFile, scenarioId) {
  const catalog = getCatalog(scenarioId);
  if (!catalog) {
    return { valid: false, errors: [{ path: "catalog", message: `Catalog not found for scenario: ${scenarioId}` }] };
  }

  let yamlObj;
  try {
    yamlObj = yaml.load(yamlContent);
  } catch (err) {
    return { valid: false, errors: [{ path: "yaml", message: `YAML parse error: ${err.message}` }] };
  }

  const errors = [];
  const requiredParams = catalog.parameters.filter(
    (p) => p.required === true && p.outputFile === outputFile
  );

  for (const param of requiredParams) {
    const value = getValueFromYaml(yamlObj, param.path);

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
          message: `Required field missing in ${outputFile}`,
          description: param.description,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate enum values against allowed lists in generated YAML.
 *
 * @param {string} yamlContent - YAML content as string
 * @param {string} outputFile - Output file name
 * @param {string} scenarioId - Scenario identifier
 * @returns {Object} { valid: boolean, errors: Array<{path, message, allowed, description}> }
 */
export function validateEnumValues(yamlContent, outputFile, scenarioId) {
  const catalog = getCatalog(scenarioId);
  if (!catalog) {
    return { valid: false, errors: [{ path: "catalog", message: `Catalog not found for scenario: ${scenarioId}` }] };
  }

  let yamlObj;
  try {
    yamlObj = yaml.load(yamlContent);
  } catch (err) {
    return { valid: false, errors: [{ path: "yaml", message: `YAML parse error: ${err.message}` }] };
  }

  const errors = [];
  const enumParams = catalog.parameters.filter(
    (p) => Array.isArray(p.allowed) && p.allowed.length > 0 && p.outputFile === outputFile
  );

  for (const param of enumParams) {
    const value = getValueFromYaml(yamlObj, param.path);

    if (!isValuePresent(value)) continue; // Skip empty values (required validation handles this)

    // Handle array values
    if (Array.isArray(value)) {
      value.forEach((item, idx) => {
        if (isValuePresent(item) && !param.allowed.includes(item)) {
          errors.push({
            path: `${param.path}[${idx}]`,
            message: `Invalid enum value in ${outputFile}: "${item}"`,
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
          message: `Invalid enum value in ${outputFile}: "${value}"`,
          allowed: param.allowed,
          description: param.description,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that generated YAML only contains parameters applicable to the scenario.
 * Checks that platform-specific parameters don't leak into other scenarios.
 *
 * @param {string} yamlContent - YAML content as string
 * @param {string} outputFile - Output file name
 * @param {string} scenarioId - Scenario identifier
 * @returns {Object} { valid: boolean, errors: Array<{path, message, appliesTo}> }
 */
export function validateApplicability(yamlContent, outputFile, scenarioId) {
  const catalog = getCatalog(scenarioId);
  if (!catalog) {
    return { valid: false, errors: [{ path: "catalog", message: `Catalog not found for scenario: ${scenarioId}` }] };
  }

  let yamlObj;
  try {
    yamlObj = yaml.load(yamlContent);
  } catch (err) {
    return { valid: false, errors: [{ path: "yaml", message: `YAML parse error: ${err.message}` }] };
  }

  const errors = [];

  // Check for parameters that don't apply to this scenario
  for (const param of catalog.parameters) {
    if (param.outputFile !== outputFile) continue;

    // Skip if parameter applies to this scenario
    if (!param.applies_to || param.applies_to.includes(scenarioId)) continue;

    const value = getValueFromYaml(yamlObj, param.path);

    if (isValuePresent(value)) {
      errors.push({
        path: param.path,
        message: `Parameter in ${outputFile} does not apply to scenario: ${scenarioId}`,
        appliesTo: param.applies_to,
        description: param.description,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Comprehensive validation combining all checks for a single YAML file.
 *
 * @param {string} yamlContent - YAML content as string
 * @param {string} outputFile - Output file name (e.g., "install-config.yaml")
 * @param {string} scenarioId - Scenario identifier
 * @returns {Object} { valid: boolean, errors: Object<string, Array>, totalErrors: number }
 */
export function validateYaml(yamlContent, outputFile, scenarioId) {
  const requiredValidation = validateRequiredFields(yamlContent, outputFile, scenarioId);
  const enumValidation = validateEnumValues(yamlContent, outputFile, scenarioId);
  const applicabilityValidation = validateApplicability(yamlContent, outputFile, scenarioId);

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

/**
 * Validate all generated YAML files for a deployment.
 *
 * @param {Object} files - Generated files object { "install-config.yaml": string, "agent-config.yaml": string, ... }
 * @param {string} scenarioId - Scenario identifier
 * @returns {Object} { valid: boolean, fileErrors: Object<filename, validation>, totalErrors: number }
 */
export function validateAllFiles(files, scenarioId) {
  const fileErrors = {};
  let totalErrors = 0;

  for (const [filename, content] of Object.entries(files)) {
    if (!content) continue; // Skip null/empty files

    // Only validate YAML files (skip .md, .txt, etc.)
    if (!filename.endsWith(".yaml")) continue;

    const validation = validateYaml(content, filename, scenarioId);
    fileErrors[filename] = validation;
    totalErrors += validation.totalErrors;
  }

  return {
    valid: totalErrors === 0,
    fileErrors,
    totalErrors,
  };
}
