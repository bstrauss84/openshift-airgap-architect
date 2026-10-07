"use strict";

/**
 * Shared minor-version handling for scripts/minor/**.
 *
 * Two rules this module exists to enforce, both from the 0A-0 harvest:
 *
 *   NO HIDDEN DEFAULT. A script that needs a minor takes it explicitly and
 *   fails closed if it is absent. The 4.21-era tooling used
 *   `process.argv[2] || "4.20"` in seven places, so a forgotten argument
 *   silently produced 4.20 results that looked like success.
 *
 *   NO FORKING. These scripts are parameterized, never copied per minor. The
 *   4.20 -> 4.21 toolkit was forked with a single `sed` substitution; all 18
 *   pairs differ only in minor literals, and the substitution rewrote
 *   provenance claims without rewriting the evidence behind them.
 *
 * See docs/minor-release/MINOR_ONBOARDING_RUNBOOK.md and
 * docs/minor-release/SCRIPTS_MINOR_SPECIFICATION.md.
 */

const path = require("path");

const MINOR_RE = /^\d+\.\d+$/;

class MinorArgumentError extends Error {}

/**
 * Parse and validate a minor version.
 * @param {unknown} value
 * @param {string} flagName for the error message, e.g. "--minor"
 * @returns {string} canonical "<major>.<minor>"
 * @throws {MinorArgumentError} on anything that is not exactly a minor
 */
function parseMinor(value, flagName = "--minor") {
  if (value === undefined || value === null || value === "") {
    throw new MinorArgumentError(
      `${flagName} is required. These scripts never assume a minor: ` +
        "pass it explicitly (e.g. --minor 4.22)."
    );
  }
  const str = String(value).trim();
  if (!MINOR_RE.test(str)) {
    throw new MinorArgumentError(
      `${flagName} "${str}" is not a minor version. Expected "<major>.<minor>", e.g. 4.22. ` +
        "A patch version such as 4.22.3 is not accepted here."
    );
  }
  return str;
}

/** Numeric (not lexical) minor comparison: 4.9 sorts before 4.21. */
function compareMinors(a, b) {
  const [aMaj, aMin] = a.split(".").map(Number);
  const [bMaj, bMin] = b.split(".").map(Number);
  return aMaj - bMaj || aMin - bMin;
}

/**
 * Minimal, explicit flag parser.
 *
 * Deliberately not a dependency: these scripts run during acquisition on
 * machines that may not have node_modules installed.
 *
 * @param {string[]} argv typically process.argv.slice(2)
 * @returns {{flags: Record<string,string|true>, positional: string[]}}
 */
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    if (eq !== -1) {
      flags[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  }
  return { flags, positional };
}

/**
 * Resolve the per-minor workspace directory.
 *
 * Required and explicit: the harvested scripts assumed an implicit `../analysis`
 * sibling, which only made sense inside a per-minor fork directory. An
 * un-forked script cannot infer where a given minor's working files live.
 */
function requireWorkspace(flags, flagName = "--workspace") {
  const value = flags[flagName.replace(/^--/, "")];
  if (!value || value === true) {
    throw new MinorArgumentError(
      `${flagName} is required (directory for this minor's working files).`
    );
  }
  return path.resolve(String(value));
}

module.exports = {
  MINOR_RE,
  MinorArgumentError,
  parseMinor,
  compareMinors,
  parseArgs,
  requireWorkspace,
};
