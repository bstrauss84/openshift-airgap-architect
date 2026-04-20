#!/usr/bin/env node
"use strict";

/**
 * Every catalog parameter path for agent-config.yaml that documents hosts[].networkConfig
 * must use NMState-style kebab-case segments (no camelCase leakage like prefixLength, baseIface).
 */

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

/** Substrings that must never appear in a networkConfig-related catalog path. */
const FORBIDDEN_SUBSTRINGS = [
  "prefixLength",
  "baseIface",
  "linkAggregation",
  "nextHopAddress",
  "nextHopInterface",
  "routeTableId",
  "totalVfs",
  "macAddress" // nmstate uses mac-address under networkConfig.interfaces
];

function walkJsonFiles(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonFiles(full, out);
    else if (e.name.endsWith(".json")) out.push(full);
  }
}

function validateFile(filePath) {
  const errs = [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    return [`${filePath}: ${e.message}`];
  }
  for (let i = 0; i < (data.parameters || []).length; i++) {
    const p = data.parameters[i];
    if (p.outputFile !== "agent-config.yaml") continue;
    const pathStr = p.path || "";
    if (!pathStr.includes("networkConfig")) continue;
    for (const bad of FORBIDDEN_SUBSTRINGS) {
      if (pathStr.includes(bad)) {
        errs.push(`${filePath}: param[${i}] path "${pathStr}" contains forbidden segment "${bad}" (use kebab-case per NMState).`);
      }
    }
  }
  return errs;
}

function main() {
  const target = process.argv[2] || path.join(repoRoot, "data", "params");
  const resolved = path.isAbsolute(target) ? target : path.join(repoRoot, target);
  const files = [];
  walkJsonFiles(resolved, files);
  files.sort();
  const allErrs = [];
  for (const f of files) {
    allErrs.push(...validateFile(f));
  }
  if (allErrs.length) {
    allErrs.forEach((e) => console.error(e));
    process.exit(1);
  }
  console.log("Agent networkConfig path guard OK:", files.length, "catalog file(s) under", resolved);
  process.exit(0);
}

main();
