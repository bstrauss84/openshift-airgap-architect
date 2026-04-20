#!/usr/bin/env node
"use strict";

/**
 * Single entrypoint for param catalog authority checks (CI + local).
 * Runs: docs-index schema, validate-catalog, docs-index↔frontend parity, catalog↔frontend parity,
 * agent networkConfig path kebab guard, buildNmState generator guard.
 */

const { spawnSync } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const node = process.execPath;

function run(scriptRelative, args = []) {
  const script = path.join(repoRoot, scriptRelative);
  const r = spawnSync(node, [script, ...args], { stdio: "inherit", cwd: repoRoot });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function main() {
  const version = process.argv[2] || "4.20";
  run("scripts/validate-docs-index.js");
  run("scripts/validate-catalog.js", ["data/params"]);
  run("scripts/validate-docs-index-frontend-parity.js", [version]);
  run("scripts/validate-catalog-frontend-parity.js", [version]);
  run("scripts/validate-catalog-agent-networkconfig-paths.js", ["data/params"]);
  run("scripts/validate-catalog-agent-networkconfig-paths.js", [
    path.join("frontend", "src", "data", "catalogs")
  ]);
  run("scripts/validate-agent-nmstate-generator.js");
  console.log("validate-param-authority: all checks passed.");
  process.exit(0);
}

main();
