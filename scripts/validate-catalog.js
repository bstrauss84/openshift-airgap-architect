#!/usr/bin/env node
"use strict";

/**
 * Validate params catalog against schema v2.0.0 (DOC-101 Phase 1 Slice 2).
 *
 * Schema v1.x requirements:
 * - Required: path, outputFile, description, applies_to, citations (non-empty)
 * - Citation: docId, docTitle, sectionHeading, url required
 * - No duplicate path+outputFile
 * - allowed/type/required/default must be concrete or "not specified in docs"
 *
 * Schema v2.0.0 NEW requirements (BREAKING):
 * - supportStatus REQUIRED (MUST be present, MUST NOT be "unknown-needs-review")
 * - minVersion: Minor version format "4.20" (defaults to "4.20" if omitted)
 * - maxVersion: Minor version format "4.21" or null (defaults to null)
 * - versionNotes: Optional version-specific notes
 * - validationRules: Optional sparse version-specific validation rules
 */

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const defaultTarget = path.join(repoRoot, "data", "params", "4.20");

/**
 * The contract this validator actually enforces, exported so it can be compared
 * mechanically against schema/catalog-parameter-schema.json.
 *
 * The schema file documents catalog schema v2.0.0 but nothing executes it: the
 * rules below are what run. That made the schema decorative and allowed the two
 * to drift silently. scripts/validate-catalog-schema-conformance.test.js now
 * holds them to each other, and it reads these constants rather than restating
 * them, so a change here is detected instead of quietly diverging.
 *
 * Keep every rule below sourced from these constants.
 */
const CONTRACT = Object.freeze({
  /** Catalog-file top-level keys that must be present. */
  fileRequired: Object.freeze(["version", "scenarioId", "parameters"]),

  /** Parameter fields that must be present and non-null. */
  paramRequired: Object.freeze([
    "path",
    "outputFile",
    "description",
    "applies_to",
    "citations",
    "supportStatus",
    "minVersion",
    "maxVersion"
  ]),

  /**
   * Parameter fields that must also be PRESENT. Presence is mandatory for all
   * four; whether a concrete value is required differs per field and is
   * governed by sentinelAllowedFor below.
   */
  paramRequiredConcrete: Object.freeze(["allowed", "type", "required", "default"]),

  /** Sentinel for a value the documentation does not state. */
  notSpecifiedSentinel: "not specified in docs",

  /**
   * Fields where the sentinel is a legitimate value.
   *
   * `type` and `required` are deliberately absent: a parameter always has a
   * data type and is always either required or not, independently of whether
   * the documentation spells it out. Tranche 0B confirmed all 2121 parameters
   * carry a concrete value for both, closing DIVERGENCE_REGISTER entry
   * `required-field-accepts-sentinel`.
   */
  sentinelAllowedFor: Object.freeze(["allowed", "default"]),

  /**
   * Permitted `type` values. Enforced since Tranche 0B normalized the 194
   * parameters that used the `int`/`bool` aliases, closing DIVERGENCE_REGISTER
   * entry `type-enum-not-enforced`.
   */
  typeEnum: Object.freeze(["string", "integer", "boolean", "array", "object", "cidr", "ipv4", "ipv6"]),

  /**
   * Permitted `outputFile` values. Enforced since Tranche 0B filled the 78
   * parameters that lacked the field, closing DIVERGENCE_REGISTER entry
   * `outputfile-enum-not-enforced`.
   */
  outputFileEnum: Object.freeze(["install-config.yaml", "agent-config.yaml", "imageset-config.yaml"]),

  /** Fields that must be present but are allowed to be explicitly null. */
  nullableRequired: Object.freeze(["maxVersion"]),

  /** Permitted supportStatus values. */
  supportStatuses: Object.freeze([
    "supported-ui",
    "supported-backend-only",
    "supported-derived",
    "docs-only-not-supported",
    "hidden-not-applicable",
    "deprecated-supported",
    "removed"
  ]),

  /** Explicitly CI-fatal supportStatus value (never valid in a committed catalog). */
  forbiddenSupportStatus: "unknown-needs-review",

  /** Minor-version format for minVersion, maxVersion and validationRules keys. */
  versionPattern: /^4\.\d+$/,

  /** Citation sub-fields that must be present and non-empty. */
  citationRequired: Object.freeze(["docId", "docTitle", "sectionHeading", "url"])
});

function getFilesToValidate(targetPath) {
  const resolved = path.isAbsolute(targetPath) ? targetPath : path.join(repoRoot, targetPath);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return [resolved];
  const files = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".json")) files.push(full);
    }
  }
  walk(resolved);
  return files.sort();
}

function validateParam(p, i, scenarioId) {
  const errs = [];
  const need = CONTRACT.paramRequired;
  for (const k of need) {
    // Nullable-required fields (maxVersion) must exist but may be null.
    if (CONTRACT.nullableRequired.includes(k)) {
      if (!p.hasOwnProperty(k)) errs.push(`param[${i}].${k} required (use null for unbounded)`);
    } else if (p[k] === undefined || p[k] === null) {
      errs.push(`param[${i}].${k} required`);
    }
  }

  // Schema v2.0.0: supportStatus validation
  if (p.supportStatus !== undefined) {
    const validStatuses = CONTRACT.supportStatuses;
    if (!validStatuses.includes(p.supportStatus)) {
      errs.push(`param[${i}].supportStatus must be one of: ${validStatuses.join(", ")}`);
    }
    if (p.supportStatus === CONTRACT.forbiddenSupportStatus) {
      errs.push(`param[${i}].supportStatus CANNOT be "${CONTRACT.forbiddenSupportStatus}" in committed catalogs (CI FAIL)`);
    }
  }

  // Schema v2.0.0: minVersion/maxVersion format validation
  const versionPattern = CONTRACT.versionPattern;
  if (p.minVersion !== undefined && p.minVersion !== null) {
    if (!versionPattern.test(p.minVersion)) {
      errs.push(`param[${i}].minVersion must be minor version format "4.20" (got: ${p.minVersion})`);
    }
  }
  if (p.maxVersion !== undefined && p.maxVersion !== null) {
    if (!versionPattern.test(p.maxVersion)) {
      errs.push(`param[${i}].maxVersion must be minor version format "4.21" or null (got: ${p.maxVersion})`);
    }
  }

  // Schema v2.0.0: validationRules structure validation
  if (p.validationRules !== undefined && p.validationRules !== null) {
    if (typeof p.validationRules !== "object" || Array.isArray(p.validationRules)) {
      errs.push(`param[${i}].validationRules must be object with version keys ("4.20", "4.21", etc.)`);
    } else {
      for (const versionKey of Object.keys(p.validationRules)) {
        if (!versionPattern.test(versionKey)) {
          errs.push(`param[${i}].validationRules key "${versionKey}" must be minor version format "4.20"`);
        }
        const rules = p.validationRules[versionKey];
        if (typeof rules !== "object" || Array.isArray(rules)) {
          errs.push(`param[${i}].validationRules["${versionKey}"] must be object with required/allowed/default fields`);
        }
      }
    }
  }
  if (!Array.isArray(p.citations)) {
    if (p.citations !== undefined) errs.push(`param[${i}].citations must be array`);
  } else {
    if (p.citations.length === 0) errs.push(`param[${i}].citations must be non-empty`);
    for (let j = 0; j < p.citations.length; j++) {
      const c = p.citations[j];
      if (!c || !c.docId || !c.sectionHeading || !c.url) {
        errs.push(`param[${i}].citations[${j}] must have docId, sectionHeading, url`);
      }
      if (!c || !c.docTitle || typeof c.docTitle !== "string" || c.docTitle.trim() === "") {
        errs.push(`param[${i}].citations[${j}] must have non-empty docTitle`);
      }
    }
  }
  const optionalConcrete = CONTRACT.paramRequiredConcrete;
  const sentinel = CONTRACT.notSpecifiedSentinel;
  for (const k of optionalConcrete) {
    const sentinelOk = CONTRACT.sentinelAllowedFor.includes(k);
    if (p[k] === undefined || p[k] === null) {
      errs.push(
        sentinelOk
          ? `param[${i}].${k} required (use "${sentinel}" if not in docs)`
          : `param[${i}].${k} required`
      );
    } else if (k === "required") {
      if (p[k] !== true && p[k] !== false) {
        errs.push(`param[${i}].required must be true or false`);
      }
    } else if (k === "type") {
      if (!CONTRACT.typeEnum.includes(p[k])) {
        errs.push(`param[${i}].type must be one of: ${CONTRACT.typeEnum.join(", ")} (got: ${p[k]})`);
      }
    } else if (typeof p[k] === "string" && p[k] !== sentinel) {
      // concrete string value is ok
    } else if (p[k] === sentinel) {
      // ok
    } else if (Array.isArray(p[k]) || typeof p[k] === "number" || typeof p[k] === "boolean") {
      // concrete value ok (for allowed as array, default as various)
    } else {
      errs.push(`param[${i}].${k} must be concrete or the string "${sentinel}"`);
    }
  }

  if (p.outputFile !== undefined && p.outputFile !== null && !CONTRACT.outputFileEnum.includes(p.outputFile)) {
    errs.push(`param[${i}].outputFile must be one of: ${CONTRACT.outputFileEnum.join(", ")} (got: ${p.outputFile})`);
  }

  return errs;
}

function validateFile(filePath) {
  const errs = [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    return [`${filePath}: ${e.message}`];
  }
  if (!data.version || !data.scenarioId || !Array.isArray(data.parameters)) {
    errs.push(`${filePath}: required keys version, scenarioId, parameters (array)`);
  }
  // Multi-file: scenarioId must match filename (e.g. vsphere-ipi.json -> scenarioId "vsphere-ipi")
  const baseName = path.basename(filePath, ".json");
  if (data.scenarioId && data.scenarioId !== baseName) {
    errs.push(`${filePath}: scenarioId "${data.scenarioId}" must match filename (expected "${baseName}")`);
  }
  const seen = new Set();
  for (let i = 0; i < (data.parameters || []).length; i++) {
    const p = data.parameters[i];
    const key = `${p.path || ""}\0${p.outputFile || ""}`;
    if (seen.has(key)) errs.push(`${filePath}: duplicate path+outputFile param[${i}]`);
    seen.add(key);
    errs.push(...validateParam(p, i, data.scenarioId).map((e) => `${filePath}: ${e}`));
  }
  return errs;
}

/** Infer OCP version from path (e.g. data/params/4.20 -> "4.20"). */
function versionFromParamsPath(dirPath) {
  const match = path.resolve(dirPath).match(/[/\\]params[/\\]([\d.]+)[/\\]?$/);
  return match ? match[1] : null;
}

/** When validating a versioned directory, ensure every scenario in docs-index has a catalog. */
function validateAgainstDocsIndex(dirPath, files, allErrs) {
  const version = versionFromParamsPath(dirPath);
  if (!version) return;
  const indexPath = path.join(repoRoot, "data", "docs-index", `${version}.json`);
  if (!fs.existsSync(indexPath)) return;
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch (e) {
    allErrs.push(`${indexPath}: ${e.message}`);
    return;
  }
  const scenarios = index.scenarios ? Object.keys(index.scenarios) : [];
  const catalogIds = new Set(files.map((f) => path.basename(f, ".json")));
  for (const scenarioId of scenarios) {
    if (!catalogIds.has(scenarioId)) {
      allErrs.push(`data/params/${version}: missing catalog for scenario "${scenarioId}" (expected ${scenarioId}.json)`);
    }
  }
}

function main() {
  const target = process.argv[2] || defaultTarget;
  const resolved = path.isAbsolute(target) ? target : path.join(repoRoot, target);
  const files = getFilesToValidate(target);
  const allErrs = [];
  for (const f of files) {
    allErrs.push(...validateFile(f));
  }
  if (fs.statSync(resolved).isDirectory()) {
    validateAgainstDocsIndex(resolved, files, allErrs);
  }
  if (allErrs.length) {
    allErrs.forEach((e) => console.error(e));
    process.exit(1);
  }
  console.log("Validated", files.length, "file(s)");
  process.exit(0);
}

// Guarded so the conformance test can import CONTRACT without running the CLI.
if (require.main === module) main();

module.exports = { CONTRACT, validateParam, validateFile };
