#!/usr/bin/env node
/**
 * Canonical application-identity setter.
 *
 * VERSION is the single source of truth for the application version. Four
 * package.json manifests and three lockfiles must agree with it; that invariant
 * is enforced by scripts/validate-app-version.mjs (npm run check:app-version).
 *
 * Before this script existed, moving the application identity meant hand-editing
 * eight files and hoping the validator agreed. This makes it one command:
 *
 *   node scripts/set-app-version.mjs 2.1.0-dev
 *   node scripts/set-app-version.mjs 2.1.0 --dry-run
 *
 * The script writes VERSION and every manifest/lockfile from that one input,
 * then re-runs the validator and fails if the result is inconsistent. It does
 * not touch dependency trees, so it is safe to run without a reinstall.
 *
 * Exit codes: 0 success (or clean --dry-run), 1 failure.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isValidSemVer, validate } from "./validate-app-version.mjs";

/** package.json manifests whose top-level "version" must equal VERSION. */
const MANIFESTS = [
  "package.json",
  "backend/package.json",
  "frontend/package.json",
  "shared/package.json",
];

/** Lockfiles whose top-level "version" AND packages[""].version must equal VERSION. */
const LOCKFILES = [
  "package-lock.json",
  "backend/package-lock.json",
  "frontend/package-lock.json",
];

/**
 * Read a JSON file, apply `mutate`, and write it back with the repository's
 * canonical formatting (2-space indent, trailing newline). Every tracked
 * manifest and lockfile round-trips byte-identically under that formatting, so
 * this rewrites only the values that actually changed.
 *
 * @returns {{changed: boolean, from: unknown[]}} what was touched
 */
function editJson(absPath, mutate, { dryRun }) {
  const raw = readFileSync(absPath, "utf-8");
  const data = JSON.parse(raw);
  const before = [];
  mutate(data, before);
  const next = `${JSON.stringify(data, null, 2)}\n`;
  const changed = next !== raw;
  if (changed && !dryRun) writeFileSync(absPath, next, "utf-8");
  return { changed, from: before };
}

export function setAppVersion(root, version, { dryRun = false } = {}) {
  if (!isValidSemVer(version)) {
    return { ok: false, errors: [`"${version}" is not valid SemVer 2.0.0`], changes: [] };
  }

  const changes = [];
  const errors = [];

  const versionPath = join(root, "VERSION");
  let previous = null;
  try {
    previous = readFileSync(versionPath, "utf-8").trim();
  } catch (err) {
    return { ok: false, errors: [`VERSION: ${err.message}`], changes: [] };
  }
  if (previous !== version) {
    if (!dryRun) writeFileSync(versionPath, `${version}\n`, "utf-8");
    changes.push({ file: "VERSION", from: previous, to: version });
  }

  for (const rel of MANIFESTS) {
    try {
      const { changed, from } = editJson(
        join(root, rel),
        (data, before) => {
          before.push(data.version ?? null);
          data.version = version;
        },
        { dryRun }
      );
      if (changed) changes.push({ file: rel, from: from[0], to: version });
    } catch (err) {
      errors.push(`${rel}: ${err.message}`);
    }
  }

  for (const rel of LOCKFILES) {
    try {
      const { changed, from } = editJson(
        join(root, rel),
        (data, before) => {
          before.push(data.version ?? null);
          data.version = version;
          // npm lockfile v2+ mirrors the root package version under packages[""].
          if (data.packages && data.packages[""]) data.packages[""].version = version;
        },
        { dryRun }
      );
      if (changed) changes.push({ file: rel, from: from[0], to: version });
    } catch (err) {
      errors.push(`${rel}: ${err.message}`);
    }
  }

  if (errors.length) return { ok: false, errors, changes };

  // Fail closed: the setter is only correct if the checker agrees afterwards.
  if (!dryRun) {
    const verdict = validate(root);
    if (!verdict.ok) {
      return {
        ok: false,
        errors: ["post-write validation failed:", ...verdict.errors],
        changes,
      };
    }
  }

  return { ok: true, errors: [], changes };
}

function isCLI() {
  try {
    return process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
  } catch {
    return false;
  }
}

if (isCLI()) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const version = args.find((a) => !a.startsWith("--"));

  if (!version) {
    console.error("Usage: node scripts/set-app-version.mjs <semver> [--dry-run]");
    console.error("Example: node scripts/set-app-version.mjs 2.1.0-dev");
    process.exit(1);
  }

  const root = resolve(import.meta.dirname, "..");
  const result = setAppVersion(root, version, { dryRun });

  if (!result.ok) {
    console.error("Set app version FAILED:");
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  if (result.changes.length === 0) {
    console.log(`App version already ${version}; nothing to change.`);
    process.exit(0);
  }

  console.log(`${dryRun ? "[dry-run] would set" : "Set"} app version to ${version}:`);
  for (const c of result.changes) console.log(`  - ${c.file}: ${c.from} -> ${c.to}`);
  if (!dryRun) console.log("Post-write validation passed.");
  process.exit(0);
}
