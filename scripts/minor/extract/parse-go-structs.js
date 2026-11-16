#!/usr/bin/env node
"use strict";

/**
 * Extract the install-config / agent-config parameter surface from a pinned
 * openshift/installer source tree.
 *
 * Produces exactly the record shape `scripts/minor/compare/diff-params.js`
 * declares in `INPUT_CONTRACT`, which is what makes `changed_description`
 * detection live rather than structurally dead (harvest finding F1, gap list
 * GAP-12). `scripts/minor/extract/parse-go-structs.test.js` asserts the two
 * against each other so they cannot drift apart again.
 *
 *   node scripts/minor/extract/parse-go-structs.js \
 *     --minor 4.22 --source <installer-clone> --root install-config \
 *     --out <file>
 *
 * PROVENANCE IS DERIVED, NEVER ASSERTED (runbook rule 5). The commit recorded
 * in the output is read from the clone with `git rev-parse HEAD`; there is no
 * flag to state one. A provenance string produced by substitution is not
 * evidence, which is the defect that made the 4.20 -> 4.21 `sed` fork look
 * like it had worked.
 *
 * No network access. Exit 0 success, 1 failure. Fails closed on an empty or
 * missing source tree rather than reporting zero parameters as success.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { parseMinor, parseArgs, MinorArgumentError } = require("../lib/minor");
const { parseGoFile } = require("./go-struct-parser");
const { walk } = require("./go-struct-walker");

/**
 * Entry points, named rather than guessed.
 *
 * `agent-config` is listed with two candidate files because the type moved:
 * `pkg/types/agent/agentconfig_types.go` at 4.21 and earlier,
 * `pkg/types/agent/agent_config_type.go` at 4.22. Discovery is by struct name
 * within the package, so the rename is absorbed rather than hardcoded.
 */
const ROOTS = Object.freeze({
  "install-config": { pkg: "types", struct: "InstallConfig" },
  "agent-config": { pkg: "agent", struct: "Config" },
});

const DEFAULT_SCAN_DIRS = ["pkg/types"];

function listGoFiles(root, scanDirs) {
  const files = [];
  const stack = scanDirs.map((d) => path.join(root, d));
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!e.name.endsWith(".go")) continue;
      if (e.name.endsWith("_test.go")) continue;
      if (e.name.startsWith("zz_generated")) continue;
      files.push(full);
    }
  }
  return files.sort();
}

/**
 * Build packageName -> merged registry.
 *
 * Package name collisions across directories are real in this tree (several
 * packages are called `validation`). Merging by package name is correct for
 * resolving a `pkg.Type` reference because the importing file's alias already
 * narrowed it to one import path; what it cannot do is distinguish two
 * same-named packages both reachable from one file. That case is reported in
 * `collisions` rather than silently resolved.
 */
function buildIndex(root, files) {
  const index = {};
  const collisions = [];
  const perFile = [];

  for (const full of files) {
    const rel = path.relative(root, full);
    const parsed = parseGoFile(rel, fs.readFileSync(full, "utf-8"));
    if (!parsed.pkg) continue;
    perFile.push(parsed);

    if (!index[parsed.pkg]) {
      index[parsed.pkg] = {
        structs: {},
        aliases: {},
        consts: {},
        importsByFile: {},
        dirs: new Set(),
      };
    }
    const entry = index[parsed.pkg];
    entry.dirs.add(path.dirname(rel));
    entry.importsByFile[rel] = parsed.imports;

    for (const [name, s] of Object.entries(parsed.structs)) {
      if (entry.structs[name] && entry.structs[name].file !== s.file) {
        collisions.push({ pkg: parsed.pkg, struct: name, files: [entry.structs[name].file, s.file] });
      }
      entry.structs[name] = s;
    }
    Object.assign(entry.aliases, parsed.aliases);
    for (const [t, vals] of Object.entries(parsed.consts)) {
      entry.consts[t] = (entry.consts[t] || []).concat(vals);
    }
  }

  for (const entry of Object.values(index)) {
    entry.dirs = Array.from(entry.dirs).sort();
  }
  return { index, collisions, fileCount: perFile.length };
}

function resolveCommit(sourceDir) {
  try {
    return execFileSync("git", ["-C", sourceDir, "rev-parse", "HEAD"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function extract({ sourceDir, rootKey, scanDirs, minor, release }) {
  const rootSpec = ROOTS[rootKey];
  if (!rootSpec) {
    throw new Error(`Unknown --root "${rootKey}". Known: ${Object.keys(ROOTS).join(", ")}`);
  }
  if (!fs.existsSync(sourceDir)) throw new Error(`Source tree not found: ${sourceDir}`);

  const files = listGoFiles(sourceDir, scanDirs);
  if (files.length === 0) {
    throw new Error(
      `No .go files under ${scanDirs.join(", ")} in ${sourceDir}. ` +
        "Refusing to report an empty extraction as success."
    );
  }

  const { index, collisions, fileCount } = buildIndex(sourceDir, files);
  const pkg = index[rootSpec.pkg];
  const struct = pkg && pkg.structs[rootSpec.struct];
  if (!struct) {
    throw new Error(
      `Root struct ${rootSpec.pkg}.${rootSpec.struct} not found in ${sourceDir}. ` +
        "The entry point moved or the scan roots are wrong; this is a stop-and-report."
    );
  }

  const walked = walk(index, { pkg: rootSpec.pkg, struct });
  if (walked.parameters.length === 0) {
    throw new Error("Walk produced zero parameters. Failing closed.");
  }

  const commit = resolveCommit(sourceDir);
  if (!commit) {
    throw new Error(
      `Could not derive a commit from ${sourceDir}. Provenance is derived, never ` +
        "asserted (runbook rule 5); an unpinnable tree is a stop-and-report."
    );
  }

  return {
    schema: "oaa.minor.extraction/1",
    minor,
    release: release || null,
    root: rootKey,
    rootStruct: `${rootSpec.pkg}.${rootSpec.struct}`,
    rootFile: struct.file,
    source: `openshift/installer @ ${commit}${release ? ` (released ${release})` : ""}`,
    installerCommit: commit,
    scanDirs,
    extractedDate: new Date().toISOString(),
    goFileCount: fileCount,
    packageCount: Object.keys(index).length,
    parameterCount: walked.parameters.length,
    truncated: walked.truncated,
    packageNameCollisions: collisions,
    parameters: walked.parameters,
  };
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const usage =
    "Usage: node scripts/minor/extract/parse-go-structs.js --minor <X.Y> " +
    "--source <installer-clone> [--root install-config|agent-config] " +
    "[--scan-dir pkg/types] [--release <x.y.z>] [--out <file>]";

  let minor;
  try {
    minor = parseMinor(flags.minor, "--minor");
  } catch (err) {
    if (err instanceof MinorArgumentError) {
      console.error(`parse-go-structs: ${err.message}\n\n${usage}`);
      process.exit(1);
    }
    throw err;
  }

  if (!flags.source || flags.source === true) {
    console.error(`parse-go-structs: --source is required.\n\n${usage}`);
    process.exit(1);
  }

  const scanDirs = flags["scan-dir"] && flags["scan-dir"] !== true
    ? String(flags["scan-dir"]).split(",")
    : DEFAULT_SCAN_DIRS;

  let result;
  try {
    result = extract({
      sourceDir: path.resolve(String(flags.source)),
      rootKey: flags.root && flags.root !== true ? String(flags.root) : "install-config",
      scanDirs,
      minor,
      release: flags.release && flags.release !== true ? String(flags.release) : null,
    });
  } catch (err) {
    console.error(`parse-go-structs: ${err.message}`);
    process.exit(1);
  }

  const output = JSON.stringify(result, null, 2);
  if (flags.out && flags.out !== true) {
    fs.writeFileSync(path.resolve(String(flags.out)), output, "utf-8");
    console.error(`Extraction written to: ${flags.out}`);
  } else {
    console.log(output);
  }

  console.error(`\n${result.root} extraction for ${minor}:`);
  console.error(`  installer commit : ${result.installerCommit}`);
  console.error(`  go files scanned : ${result.goFileCount}`);
  console.error(`  parameters       : ${result.parameterCount}`);
  console.error(`  truncated chains : ${result.truncated.length}`);
  if (result.packageNameCollisions.length) {
    console.error(`  package-name collisions: ${result.packageNameCollisions.length} (see output)`);
  }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { extract, buildIndex, listGoFiles, ROOTS, DEFAULT_SCAN_DIRS };
