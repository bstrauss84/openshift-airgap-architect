#!/usr/bin/env node
"use strict";

/**
 * Ensures frontend catalog JSON files are byte-for-byte the same catalog as canonical
 * data/params/<version>/ after stable JSON normalization (sorted parameters).
 *
 * Canonical data/params is the authority; frontend copies must match before merge/ship.
 * See docs/PARAM_AUTHORITY.md and docs/DATA_AND_FRONTEND_COPIES.md.
 *
 * Usage: node scripts/validate-catalog-frontend-parity.js <minor>
 *
 * The minor is REQUIRED. It previously defaulted to "4.20", which meant a
 * forgotten argument silently checked one minor and reported success for the
 * repository as a whole.
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
  const version = process.argv[2];
  if (!version) {
    console.error("Usage: node scripts/validate-catalog-frontend-parity.js <minor>");
    console.error("Example: node scripts/validate-catalog-frontend-parity.js 4.21");
    console.error("The minor is required; this check must never silently assume one.");
    process.exit(1);
  }
  if (!/^\d+\.\d+$/.test(version)) {
    console.error(`Invalid minor "${version}" (expected form: 4.21)`);
    process.exit(1);
  }

  // The frontend mirror is versioned per ADR-001/ADR-005:
  // frontend/src/data/catalogs/<minor>/<scenario>.json.
  // This path previously omitted the <minor> segment, so readdir returned only
  // the version subdirectories, the .json filter yielded an empty set, and every
  // canonical catalog was reported as unmatched — for BOTH minors, not just 4.21.
  const feDir = path.join(repoRoot, "frontend", "src", "data", "catalogs", version);
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
        `Catalog content mismatch: ${name} (version ${version}). ` +
          `data/params/${version}/${name} is canonical; frontend/src/data/catalogs/${version}/${name} is a generated mirror. ` +
          `Fix the canonical file, then regenerate the mirror with: npm run sync-catalogs ` +
          `(verify first with npm run sync-catalogs:check). ` +
          `Never copy the mirror back over canonical.`
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
