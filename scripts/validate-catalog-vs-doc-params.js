#!/usr/bin/env node
"use strict";

/**
 * Params reconciliation: compare a scenario catalog to an optional "doc params" list
 * (expected paths from doc tables). Reports missing in catalog, extra in catalog,
 * and required mismatch. No auto-edit. Use with PARAMS_RECONCILIATION_CHECKLIST.md.
 *
 * Usage: node scripts/validate-catalog-vs-doc-params.js <catalog.json> [doc-params.json]
 * Example: node scripts/validate-catalog-vs-doc-params.js frontend/src/data/catalogs/vsphere-ipi.json
 *          node scripts/validate-catalog-vs-doc-params.js frontend/src/data/catalogs/vsphere-ipi.json docs/vsphere-ipi-doc-params.json
 *
 * doc-params.json (optional): array of { "path": "...", "required": true|false } or just "path" strings.
 * If omitted, only catalog paths and required flags are printed (no diff).
 */

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const catalogPath = process.argv[2];
const docParamsPath = process.argv[3];

if (!catalogPath) {
  console.error("Usage: node scripts/validate-catalog-vs-doc-params.js <catalog.json> [doc-params.json]");
  process.exit(1);
}

const catalogFull = path.isAbsolute(catalogPath) ? catalogPath : path.join(repoRoot, catalogPath);
let catalog;
try {
  catalog = JSON.parse(fs.readFileSync(catalogFull, "utf8"));
} catch (e) {
  console.error("Failed to read catalog:", e.message);
  process.exit(1);
}

const params = Array.isArray(catalog) ? catalog : (catalog.parameters || catalog.params || []);
const catalogPaths = new Map();
params.forEach((p) => {
  if (p && p.path) catalogPaths.set(p.path, p);
});

function main() {
  if (!docParamsPath) {
    console.log("Catalog:", catalogPath);
    console.log("Paths in catalog:", catalogPaths.size);
    console.log("");
    const required = params.filter((p) => p && p.required === true);
    console.log("Required (required: true):", required.length);
    required.forEach((p) => console.log("  -", p.path));
    return;
  }

  const docParamsFull = path.isAbsolute(docParamsPath) ? docParamsPath : path.join(repoRoot, docParamsPath);
  let docList;
  try {
    docList = JSON.parse(fs.readFileSync(docParamsFull, "utf8"));
  } catch (e) {
    console.error("Failed to read doc-params file:", e.message);
    process.exit(1);
  }

  if (!Array.isArray(docList)) {
    console.error("doc-params.json must be an array of { path, required? } or path strings.");
    process.exit(1);
  }

  const expected = new Map();
  docList.forEach((item) => {
    const pathStr = typeof item === "string" ? item : (item && item.path);
    const required = typeof item === "object" && item && "required" in item ? item.required : undefined;
    if (pathStr) expected.set(pathStr, { required });
  });

  console.log("Params reconciliation: catalog vs doc-params list");
  console.log("Catalog:", catalogPath);
  console.log("Doc params list:", docParamsPath);
  console.log("");

  const missing = [];
  const requiredMismatch = [];
  expected.forEach((meta, pathStr) => {
    const cat = catalogPaths.get(pathStr);
    if (!cat) missing.push(pathStr);
    else if (meta.required !== undefined && cat.required !== meta.required) {
      requiredMismatch.push({ path: pathStr, docRequired: meta.required, catalogRequired: cat.required });
    }
  });

  const extra = [];
  catalogPaths.forEach((_, pathStr) => {
    if (!expected.has(pathStr)) extra.push(pathStr);
  });

  let failed = false;
  if (missing.length > 0) {
    console.log("In doc list, not in catalog (" + missing.length + "):");
    missing.forEach((p) => console.log("  -", p));
    console.log("");
    failed = true;
  }
  if (requiredMismatch.length > 0) {
    console.log("Required mismatch (" + requiredMismatch.length + "):");
    requiredMismatch.forEach(({ path: p, docRequired, catalogRequired }) => {
      console.log("  -", p, "| doc required:", docRequired, "| catalog required:", catalogRequired);
    });
    console.log("");
    failed = true;
  }
  if (extra.length > 0) {
    console.log("In catalog, not in doc list (" + extra.length + ") [optional to align]:");
    extra.slice(0, 30).forEach((p) => console.log("  -", p));
    if (extra.length > 30) console.log("  ... and", extra.length - 30, "more");
    console.log("");
  }

  if (!failed) console.log("No missing paths or required mismatches.");
  if (failed) process.exit(1);
}

main();
