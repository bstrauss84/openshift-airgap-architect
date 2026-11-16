#!/usr/bin/env node
"use strict";

/**
 * Parameter-set delta between two extractions (previous minor -> target minor).
 *
 * Promoted from local-docs/ocp-4.21/scripts/compare-raw-extractions.js, which
 * the 0A-0 harvest found to be the only fully version-generic script in the
 * entire 4.21 toolkit — baseline and target supplied as arguments, nothing
 * about any minor baked in. It is the architectural model for scripts/minor/**.
 *
 * DEFECT FIXED IN PROMOTION (harvest finding F1).
 * The original read `comment`, `jsonTag` and `file` from each parameter. The
 * extractor that produces its input emits `description`, `struct` and `field`,
 * and emits no `jsonTag` or `file` at all. Because `comment` was undefined on
 * both sides, `commentChanged` could never be true: description-change
 * detection was structurally dead, and the 4.20 -> 4.21 delta reported
 * `changed: 0` with apparent confidence. Verified against the real output —
 * 0 of 49 added rows carry `file`, 0 carry `comment`.
 *
 * The field names a consumer may rely on are now declared in INPUT_CONTRACT and
 * asserted by the test suite, so the producer and consumer cannot drift apart
 * again without a test failing.
 *
 * Usage:
 *   node scripts/minor/compare/diff-params.js \
 *     --baseline <prev.json> --target <next.json> \
 *     --previous-minor 4.21 --minor 4.22 [--out <file>]
 *
 * Both minors are explicit. The original encoded "added_in_4_21" as a literal;
 * the labels are now derived from the arguments.
 *
 * No network access. Exit 0 success, 1 failure.
 */

const fs = require("fs");
const path = require("path");
const { parseMinor, parseArgs, MinorArgumentError } = require("../lib/minor");

/**
 * The extraction-record fields this comparator reads.
 *
 * Any producer feeding diff-params must emit these names. This is the contract
 * whose absence caused finding F1; it is exported so a producer's test can
 * assert against it rather than assume.
 */
const INPUT_CONTRACT = Object.freeze({
  /** Identity. Required on every record. */
  key: "path",
  /** Compared for change detection. A producer MUST emit these names. */
  compared: Object.freeze(["type", "required", "description"]),
  /** Carried into the output as evidence when present. Optional. */
  provenance: Object.freeze(["goType", "struct", "field"]),
});

function loadExtraction(file, label) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${label} extraction: ${file}`);
  const data = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (!Array.isArray(data.parameters)) {
    throw new Error(`${label} extraction has no parameters array: ${file}`);
  }
  return data;
}

/** Copy the provenance fields that are actually present. */
function provenanceOf(param) {
  const out = {};
  for (const field of INPUT_CONTRACT.provenance) {
    if (param[field] !== undefined) out[field] = param[field];
  }
  return out;
}

/**
 * Compute the delta.
 * @returns {object} added / removed / changed / unchanged plus a summary
 */
function diffParams({ baseline, target, previousMinor, minor }) {
  const baselineMap = new Map(baseline.parameters.map((p) => [p[INPUT_CONTRACT.key], p]));
  const targetMap = new Map(target.parameters.map((p) => [p[INPUT_CONTRACT.key], p]));

  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];
  const needsManualReview = [];

  for (const [key, targetParam] of targetMap) {
    const baselineParam = baselineMap.get(key);

    if (!baselineParam) {
      added.push({
        path: targetParam.path,
        type: targetParam.type,
        required: targetParam.required,
        description: targetParam.description,
        ...provenanceOf(targetParam),
        classification: `added_in_${minor}`,
        evidence: `Present in ${target.source}, absent in ${baseline.source}`,
      });
      continue;
    }

    const typeChanged = baselineParam.type !== targetParam.type;
    const requiredChanged = baselineParam.required !== targetParam.required;
    // F1: compare the field the producer actually emits.
    const descriptionChanged = baselineParam.description !== targetParam.description;

    if (!typeChanged && !requiredChanged && !descriptionChanged) {
      unchanged.push({ path: targetParam.path, type: targetParam.type, required: targetParam.required });
      continue;
    }

    const record = {
      path: targetParam.path,
      classification: [],
      oldValue: {},
      newValue: {},
      evidence: [],
    };

    if (typeChanged) {
      record.classification.push("changed_type");
      record.oldValue.type = baselineParam.type;
      record.newValue.type = targetParam.type;
      record.evidence.push(`Type changed: ${baselineParam.type} -> ${targetParam.type}`);
    }
    if (requiredChanged) {
      record.classification.push("changed_requiredness");
      record.oldValue.required = baselineParam.required;
      record.newValue.required = targetParam.required;
      record.evidence.push(`Required changed: ${baselineParam.required} -> ${targetParam.required}`);
    }
    if (descriptionChanged) {
      record.classification.push("changed_description");
      record.oldValue.description = baselineParam.description;
      record.newValue.description = targetParam.description;
      record.evidence.push("Description changed");
    }

    // A type or requiredness change can alter validation or generated output,
    // so it is never auto-classified.
    if (typeChanged || requiredChanged) {
      record.classification.push("needs_manual_review");
      needsManualReview.push(record);
    }

    changed.push(record);
  }

  for (const [key, baselineParam] of baselineMap) {
    if (targetMap.has(key)) continue;
    removed.push({
      path: baselineParam.path,
      type: baselineParam.type,
      required: baselineParam.required,
      description: baselineParam.description,
      ...provenanceOf(baselineParam),
      classification: `removed_in_${minor}`,
      evidence: `Present in ${baseline.source}, absent in ${target.source}`,
    });
  }

  const byPath = (a, b) => a.path.localeCompare(b.path);

  return {
    comparisonTimestamp: new Date().toISOString(),
    previousMinor,
    minor,
    sourceA: { description: baseline.source, extractedDate: baseline.extractedDate },
    sourceB: { description: target.source, extractedDate: target.extractedDate },
    baselineCount: baseline.parameters.length,
    targetCount: target.parameters.length,
    added: added.sort(byPath),
    removed: removed.sort(byPath),
    changed: changed.sort(byPath),
    unchangedCount: unchanged.length,
    needsManualReviewCount: needsManualReview.length,
    summary: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      unchanged: unchanged.length,
      needsManualReview: needsManualReview.length,
      totalInBaseline: baseline.parameters.length,
      totalInTarget: target.parameters.length,
    },
    note:
      "Raw source delta only. No production catalog support is implied until catalog " +
      "planning and implementation are complete.",
  };
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2));

  const usage =
    "Usage: node scripts/minor/compare/diff-params.js --baseline <file> --target <file> " +
    "--previous-minor <X.Y> --minor <X.Y> [--out <file>]";

  let minor;
  let previousMinor;
  try {
    minor = parseMinor(flags.minor, "--minor");
    previousMinor = parseMinor(flags["previous-minor"], "--previous-minor");
  } catch (err) {
    if (err instanceof MinorArgumentError) {
      console.error(`diff-params: ${err.message}\n\n${usage}`);
      process.exit(1);
    }
    throw err;
  }

  if (!flags.baseline || !flags.target || flags.baseline === true || flags.target === true) {
    console.error(`diff-params: --baseline and --target are both required.\n\n${usage}`);
    process.exit(1);
  }

  let result;
  try {
    const baseline = loadExtraction(path.resolve(String(flags.baseline)), "baseline");
    const target = loadExtraction(path.resolve(String(flags.target)), "target");
    result = diffParams({ baseline, target, previousMinor, minor });
  } catch (err) {
    console.error(`diff-params: ${err.message}`);
    process.exit(1);
  }

  const output = JSON.stringify(result, null, 2);
  if (flags.out && flags.out !== true) {
    fs.writeFileSync(path.resolve(String(flags.out)), output, "utf-8");
    console.error(`Delta written to: ${flags.out}`);
  } else {
    console.log(output);
  }

  console.error(`\n${previousMinor} -> ${minor} parameter delta:`);
  console.error(`  added              : ${result.summary.added}`);
  console.error(`  removed            : ${result.summary.removed}`);
  console.error(`  changed            : ${result.summary.changed}`);
  console.error(`  unchanged          : ${result.summary.unchanged}`);
  console.error(`  needs manual review: ${result.summary.needsManualReview}`);
  process.exit(0);
}

if (require.main === module) main();

module.exports = { diffParams, INPUT_CONTRACT, loadExtraction };
