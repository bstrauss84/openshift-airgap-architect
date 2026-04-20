#!/usr/bin/env node
"use strict";

/**
 * Ensures frontend docs-index JSON matches canonical data/docs-index/<version>.json
 * after stable normalization (sorted scenario keys, sorted doc lists by id).
 * See docs/PARAM_AUTHORITY.md and docs/DATA_AND_FRONTEND_COPIES.md.
 */

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

function normalizeDocsIndex(data) {
  const o = JSON.parse(JSON.stringify(data));
  if (o.scenarios && typeof o.scenarios === "object" && !Array.isArray(o.scenarios)) {
    const sorted = {};
    for (const sid of Object.keys(o.scenarios).sort()) {
      const sc = o.scenarios[sid];
      if (sc && Array.isArray(sc.docs)) {
        sorted[sid] = {
          ...sc,
          docs: sc.docs.slice().sort((a, b) => (a.id || "").localeCompare(b.id || ""))
        };
      } else {
        sorted[sid] = sc;
      }
    }
    o.scenarios = sorted;
  }
  if (Array.isArray(o.sharedDocs)) {
    o.sharedDocs = o.sharedDocs.slice().sort((a, b) => (a.id || "").localeCompare(b.id || ""));
  }
  return o;
}

function stableStringify(data) {
  return JSON.stringify(normalizeDocsIndex(data));
}

function main() {
  const version = process.argv[2] || "4.20";
  const fePath = path.join(repoRoot, "frontend", "src", "data", "docs-index", `${version}.json`);
  const canonPath = path.join(repoRoot, "data", "docs-index", `${version}.json`);
  const errs = [];

  if (!fs.existsSync(fePath)) errs.push(`Missing frontend docs index: ${fePath}`);
  if (!fs.existsSync(canonPath)) errs.push(`Missing canonical docs index: ${canonPath}`);
  if (errs.length) {
    errs.forEach((e) => console.error(e));
    process.exit(1);
  }

  let feJson;
  let caJson;
  try {
    feJson = JSON.parse(fs.readFileSync(fePath, "utf8"));
    caJson = JSON.parse(fs.readFileSync(canonPath, "utf8"));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  if (stableStringify(feJson) !== stableStringify(caJson)) {
    console.error(
      `Docs index mismatch for ${version}.json. ` +
        `Sync: cp frontend/src/data/docs-index/${version}.json data/docs-index/${version}.json ` +
        `(or the reverse) so canonical and frontend stay identical, then re-run validation.`
    );
    process.exit(1);
  }

  console.log("Docs index parity OK:", path.basename(fePath));
  process.exit(0);
}

main();
