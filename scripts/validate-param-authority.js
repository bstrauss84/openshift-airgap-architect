#!/usr/bin/env node
"use strict";

/**
 * Single entrypoint for param catalog authority checks (CI + local).
 *
 * Runs, in order:
 *   - docs-index schema                       (all minors present on disk)
 *   - validate-catalog                        (recursive over data/params, all minors)
 *   - docs-index <-> frontend parity          (once per supported minor)
 *   - catalog   <-> frontend parity           (once per supported minor)
 *   - agent networkConfig path kebab guard    (canonical + frontend trees)
 *   - buildNmState generator guard
 *
 * Supported minors come from the canonical version policy, not from an
 * argument. Previously this took `process.argv[2] || "4.20"` and passed that
 * single value to both parity children, so CI — which passes no argument —
 * never parity-checked any minor except 4.20. With three minors arriving that
 * blind spot grows, so the list is now iterated.
 *
 * Every check runs even if an earlier one fails, and a PASS/FAIL summary is
 * printed at the end. Exiting on the first failure meant a single red check
 * masked the health of every check behind it — which is exactly the state this
 * gate was in: one data-schema failure hid the fact that catalog parity was
 * also broken. Exit status is still nonzero if anything failed, so the gate is
 * no weaker; it is only more legible.
 */

const { spawnSync } = require("child_process");
const path = require("path");
const { getSupportedMinors } = require("./lib/supported-minors");

const repoRoot = path.resolve(__dirname, "..");
const node = process.execPath;

/** Checks whose failures are catalog CONTENT, versus checks that prove tooling/mechanism health. */
const KIND = { DATA: "data", MECHANISM: "mechanism" };

function run(results, { label, kind, script, args = [] }) {
  console.log(`\n--- ${label} ---`);
  const r = spawnSync(node, [path.join(repoRoot, script), ...args], {
    stdio: "inherit",
    cwd: repoRoot,
  });
  const status = r.status ?? 1;
  results.push({ label, kind, status });
  return status;
}

async function main() {
  let supportedMinors;
  try {
    supportedMinors = await getSupportedMinors();
  } catch (err) {
    console.error(`validate-param-authority: ${err.message}`);
    process.exit(1);
  }

  console.log(`validate-param-authority: supported minors = ${supportedMinors.join(", ")}`);

  const results = [];

  run(results, {
    label: "docs-index schema (all minors)",
    kind: KIND.MECHANISM,
    script: "scripts/validate-docs-index.js",
  });

  run(results, {
    label: "catalog schema v2.0.0 (recursive, all minors)",
    kind: KIND.DATA,
    script: "scripts/validate-catalog.js",
    args: ["data/params"],
  });

  for (const minor of supportedMinors) {
    run(results, {
      label: `docs-index frontend parity ${minor}`,
      kind: KIND.MECHANISM,
      script: "scripts/validate-docs-index-frontend-parity.js",
      args: [minor],
    });
  }

  for (const minor of supportedMinors) {
    run(results, {
      label: `catalog frontend parity ${minor}`,
      kind: KIND.MECHANISM,
      script: "scripts/validate-catalog-frontend-parity.js",
      args: [minor],
    });
  }

  run(results, {
    label: "agent networkConfig kebab-case paths (canonical)",
    kind: KIND.DATA,
    script: "scripts/validate-catalog-agent-networkconfig-paths.js",
    args: ["data/params"],
  });

  run(results, {
    label: "agent networkConfig kebab-case paths (frontend mirror)",
    kind: KIND.DATA,
    script: "scripts/validate-catalog-agent-networkconfig-paths.js",
    args: [path.join("frontend", "src", "data", "catalogs")],
  });

  run(results, {
    label: "buildNmState generator guard",
    kind: KIND.MECHANISM,
    script: "scripts/validate-agent-nmstate-generator.js",
  });

  const failed = results.filter((r) => r.status !== 0);

  console.log("\n=== validate-param-authority summary ===");
  for (const r of results) {
    console.log(`  ${r.status === 0 ? "PASS" : "FAIL"}  [${r.kind}]  ${r.label}`);
  }

  if (failed.length === 0) {
    console.log("\nvalidate-param-authority: all checks passed.");
    process.exit(0);
  }

  const failedMechanism = failed.filter((r) => r.kind === KIND.MECHANISM);
  console.log(
    `\n${failed.length} check(s) failed ` +
      `(${failedMechanism.length} mechanism, ${failed.length - failedMechanism.length} data).`
  );
  if (failedMechanism.length === 0) {
    console.log(
      "All failures are catalog CONTENT failures. No tooling, parity or schema\n" +
        "mechanism defect is hiding inside this output."
    );
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(`validate-param-authority: unexpected failure: ${err.stack || err.message}`);
  process.exit(1);
});
