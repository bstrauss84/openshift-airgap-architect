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
  const need = ["path", "outputFile", "description", "applies_to", "citations", "supportStatus", "minVersion", "maxVersion"];
  for (const k of need) {
    // maxVersion can be null (unbounded), but field must exist
    if (k === "maxVersion") {
      if (!p.hasOwnProperty(k)) errs.push(`param[${i}].maxVersion required (use null for unbounded)`);
    } else if (p[k] === undefined || p[k] === null) {
      errs.push(`param[${i}].${k} required`);
    }
  }

  // Schema v2.0.0: supportStatus validation
  if (p.supportStatus !== undefined) {
    const validStatuses = [
      "supported-ui",
      "supported-backend-only",
      "supported-derived",
      "docs-only-not-supported",
      "hidden-not-applicable",
      "deprecated-supported",
      "removed"
    ];
    if (!validStatuses.includes(p.supportStatus)) {
      errs.push(`param[${i}].supportStatus must be one of: ${validStatuses.join(", ")}`);
    }
    if (p.supportStatus === "unknown-needs-review") {
      errs.push(`param[${i}].supportStatus CANNOT be "unknown-needs-review" in committed catalogs (CI FAIL)`);
    }
  }

  // Schema v2.0.0: minVersion/maxVersion format validation
  const versionPattern = /^4\.\d+$/;
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
  const optionalConcrete = ["allowed", "type", "required", "default"];
  for (const k of optionalConcrete) {
    if (p[k] === undefined || p[k] === null) {
      errs.push(`param[${i}].${k} required (use "not specified in docs" if not in docs)`);
    } else if (k === "required") {
      if (p[k] !== true && p[k] !== false && p[k] !== "not specified in docs") {
        errs.push(`param[${i}].required must be true, false, or "not specified in docs"`);
      }
    } else if (typeof p[k] === "string" && p[k] !== "not specified in docs") {
      // concrete string value is ok
    } else if (p[k] === "not specified in docs") {
      // ok
    } else if (Array.isArray(p[k]) || typeof p[k] === "number" || typeof p[k] === "boolean") {
      // concrete value ok (for allowed as array, default as various)
    } else {
      errs.push(`param[${i}].${k} must be concrete or the string "not specified in docs"`);
    }
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

main();
