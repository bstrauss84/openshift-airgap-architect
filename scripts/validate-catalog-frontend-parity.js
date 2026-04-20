#!/usr/bin/env node
"use strict";

/**
 * Ensures frontend catalog JSON files are byte-for-byte the same catalog as canonical
 * data/params/<version>/ after stable JSON normalization (sorted parameters).
 *
 * Canonical data/params is the authority; frontend copies must match before merge/ship.
 * See docs/PARAM_AUTHORITY.md and docs/DATA_AND_FRONTEND_COPIES.md.
 */

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

function stableStringify(catalog) {
  const o = JSON.parse(JSON.stringify(catalog));
  if (Array.isArray(o.parameters)) {
    o.parameters = o.parameters
      .slice()
      .sort((a, b) => `${a.path || ""}\0${a.outputFile || ""}`.localeCompare(`${b.path || ""}\0${b.outputFile || ""}`));
  }
  return JSON.stringify(o);
}

function main() {
  const version = process.argv[2] || "4.20";
  const feDir = path.join(repoRoot, "frontend", "src", "data", "catalogs");
  const canonDir = path.join(repoRoot, "data", "params", version);
  const errs = [];

  if (!fs.existsSync(feDir)) errs.push(`Missing frontend catalogs dir: ${feDir}`);
  if (!fs.existsSync(canonDir)) errs.push(`Missing canonical params dir: ${canonDir}`);
  if (errs.length) {
    errs.forEach((e) => console.error(e));
    process.exit(1);
  }

  const feFiles = fs.readdirSync(feDir).filter((f) => f.endsWith(".json")).sort();
  const canonFiles = fs.readdirSync(canonDir).filter((f) => f.endsWith(".json")).sort();

  if (feFiles.join(",") !== canonFiles.join(",")) {
    const onlyFe = feFiles.filter((f) => !canonFiles.includes(f));
    const onlyCanon = canonFiles.filter((f) => !feFiles.includes(f));
    if (onlyFe.length) errs.push(`Catalog set mismatch: only in frontend: ${onlyFe.join(", ")}`);
    if (onlyCanon.length) errs.push(`Catalog set mismatch: only in data/params/${version}: ${onlyCanon.join(", ")}`);
  }

  for (const name of feFiles) {
    const fePath = path.join(feDir, name);
    const caPath = path.join(canonDir, name);
    if (!fs.existsSync(caPath)) {
      errs.push(`Canonical missing ${caPath} (frontend has ${name})`);
      continue;
    }
    let feJson;
    let caJson;
    try {
      feJson = JSON.parse(fs.readFileSync(fePath, "utf8"));
      caJson = JSON.parse(fs.readFileSync(caPath, "utf8"));
    } catch (e) {
      errs.push(`${name}: ${e.message}`);
      continue;
    }
    if (stableStringify(feJson) !== stableStringify(caJson)) {
      errs.push(
        `Catalog content mismatch: ${name}. ` +
          `Normalize with: copy frontend/src/data/catalogs/${name} to data/params/${version}/${name} ` +
          `(or vice versa) so canonical and frontend stay identical, then run node scripts/validate-catalog.js data/params/${version}.`
      );
    }
  }

  if (errs.length) {
    errs.forEach((e) => console.error(e));
    process.exit(1);
  }
  console.log("Catalog parity OK:", feFiles.length, "file(s) for version", version);
  process.exit(0);
}

main();
