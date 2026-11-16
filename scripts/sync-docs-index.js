#!/usr/bin/env node
"use strict";

/**
 * Docs-index Sync Utility (Version-Aware)
 *
 * Mirrors the canonical docs index to the frontend:
 *   data/docs-index/<minor>.json  ->  frontend/src/data/docs-index/<minor>.json
 *
 * This closes the last manual copy step in the per-minor data pipeline.
 * scripts/sync-catalogs.js has always mirrored data/params/<minor>/ for us, but
 * nothing mirrored the docs index: docs/PARAM_AUTHORITY.md and
 * docs/DATA_AND_FRONTEND_COPIES.md both just instructed a human to "copy" it.
 * A hand-copy step whose only symptom when skipped is a wrong documentation
 * link in the UI is exactly the kind of step that should not exist.
 * (Harvest GAP-06; plan correction #4.)
 *
 * Direction is canonical -> frontend, always. The frontend file is a generated
 * mirror and is never a source.
 *
 * MODES (identical semantics to scripts/sync-catalogs.js, deliberately):
 *   (none)      write the mirror. Human-invoked: npm run sync-docs-index
 *   --check     CI/hook GATE. Writes nothing. Exits 1 on ANY drift, including
 *               an orphan mirror file with no canonical source.
 *   --dry-run   human PREVIEW. Writes nothing, prints drift, exits 0. NOT a gate.
 *
 * Usage:
 *   node scripts/sync-docs-index.js                 # write the mirror
 *   node scripts/sync-docs-index.js --check         # CI gate
 *   node scripts/sync-docs-index.js --dry-run       # preview only
 *   node scripts/sync-docs-index.js --verbose
 *   node scripts/sync-docs-index.js --root <dir>    # fixture tree (tests)
 *
 * Exit codes:
 *   0  in sync, brought into sync, or --dry-run preview
 *   1  drift detected under --check, or a hard error
 *
 * Determinism: the mirror is a byte-for-byte copy of canonical. No reformatting,
 * no key reordering, no timestamp. Running it twice changes nothing.
 * No network access.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

function log(message, color = "reset") {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function sha256(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/** Minor-version filenames only: "4.21.json". Anything else is ignored, not guessed at. */
const MINOR_FILE_RE = /^(\d+\.\d+)\.json$/;

/**
 * @param {object} options
 * @param {string} options.root            repository root (or a fixture root)
 * @param {boolean} [options.dryRun]       report only; never write
 * @param {boolean} [options.verbose]
 * @param {(m: string, c?: string) => void} [options.logger]
 * @returns {{ok: boolean, synced: string[], identical: string[], drifted: string[], errors: string[]}}
 */
function syncDocsIndex({ root, check = false, dryRun: dryRunOpt = false, verbose = false, logger = log } = {}) {
  // --check implies no writes; --dry-run also writes nothing.
  const dryRun = dryRunOpt || check;
  const canonicalDir = path.join(root, "data", "docs-index");
  const mirrorDir = path.join(root, "frontend", "src", "data", "docs-index");

  const result = { ok: true, synced: [], identical: [], drifted: [], errors: [] };

  if (!fs.existsSync(canonicalDir)) {
    result.errors.push(`Canonical docs-index directory not found: ${canonicalDir}`);
    result.ok = false;
    return result;
  }

  const canonicalFiles = fs
    .readdirSync(canonicalDir)
    .filter((f) => MINOR_FILE_RE.test(f))
    .sort();

  if (canonicalFiles.length === 0) {
    result.errors.push(`No <minor>.json files in ${canonicalDir}`);
    result.ok = false;
    return result;
  }

  if (!fs.existsSync(mirrorDir)) {
    if (dryRun) {
      result.drifted.push(...canonicalFiles);
      result.ok = false;
      logger(`Mirror directory missing: ${mirrorDir}`, "red");
      return result;
    }
    fs.mkdirSync(mirrorDir, { recursive: true });
    if (verbose) logger(`Created ${mirrorDir}`, "green");
  }

  for (const name of canonicalFiles) {
    const canonicalPath = path.join(canonicalDir, name);
    const mirrorPath = path.join(mirrorDir, name);

    const canonicalHash = sha256(canonicalPath);
    const mirrorHash = sha256(mirrorPath);

    if (canonicalHash === mirrorHash) {
      result.identical.push(name);
      if (verbose) logger(`  = ${name} (in sync)`, "gray");
      continue;
    }

    if (dryRun) {
      result.drifted.push(name);
      result.ok = false;
      logger(
        `  ! ${name} ${mirrorHash === null ? "missing from mirror" : "differs from canonical"}`,
        "red"
      );
      continue;
    }

    try {
      fs.copyFileSync(canonicalPath, mirrorPath);
      result.synced.push(name);
      logger(`  -> ${name} synced`, "green");
    } catch (err) {
      result.errors.push(`${name}: ${err.message}`);
      result.ok = false;
    }
  }

  // An extra mirror file with no canonical counterpart is drift too: it means a
  // minor was removed canonically, or someone authored straight into the mirror.
  if (fs.existsSync(mirrorDir)) {
    const canonicalSet = new Set(canonicalFiles);
    const orphans = fs
      .readdirSync(mirrorDir)
      .filter((f) => MINOR_FILE_RE.test(f) && !canonicalSet.has(f))
      .sort();
    for (const orphan of orphans) {
      result.drifted.push(orphan);
      result.ok = false;
      logger(`  ! ${orphan} exists in the frontend mirror with no canonical source`, "red");
    }
  }

  return result;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const dryRun = args.includes("--dry-run") || check;
  const verbose = args.includes("--verbose");
  const rootFlag = args.indexOf("--root");
  const root =
    rootFlag !== -1 && args[rootFlag + 1]
      ? path.resolve(args[rootFlag + 1])
      : path.resolve(__dirname, "..");

  log("═══════════════════════════════════════════════════", "blue");
  log("  Docs-Index Sync Utility (Version-Aware)", "blue");
  log("═══════════════════════════════════════════════════", "blue");
  if (check) log("  [CHECK MODE - read-only; non-zero exit on any drift]", "yellow");
  else if (dryRun) log("  [DRY RUN - preview only; exits 0 even on drift. Use --check to gate.]", "yellow");
  log("");

  const result = syncDocsIndex({ root, check, dryRun, verbose });

  log("");
  log(`  in sync : ${result.identical.length}`, "gray");
  if (!dryRun) log(`  synced  : ${result.synced.length}`, result.synced.length ? "green" : "gray");
  if (dryRun) log(`  drifted : ${result.drifted.length}`, result.drifted.length ? "red" : "gray");
  if (result.errors.length) {
    log(`  errors  : ${result.errors.length}`, "red");
    result.errors.forEach((e) => log(`    - ${e}`, "red"));
  }
  log("");

  if (!result.ok) {
    if (result.drifted.length) {
      log("Frontend docs-index mirror is out of sync with canonical data/docs-index/.", "red");
      log("Fix the canonical file if it is wrong, then run: npm run sync-docs-index", "red");
      log("Never copy the mirror back over canonical.", "red");
    }
    // A preview must never fail the caller; only --check gates. Hard errors
    // (missing canonical directory, unreadable file) always fail.
    const hardError = result.errors.length > 0;
    if (check || hardError) process.exit(1);
    log("Preview only (--dry-run exits 0 even with drift; use --check to gate).", "yellow");
    process.exit(0);
  }

  log("Docs-index mirror is in sync.", "green");
  process.exit(0);
}

if (require.main === module) main();

module.exports = { syncDocsIndex };
