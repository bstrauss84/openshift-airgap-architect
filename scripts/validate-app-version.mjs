#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// SemVer 2.0.0 regex — supports prerelease and build metadata
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function isValidSemVer(v) {
  return typeof v === "string" && SEMVER_RE.test(v);
}

export function readCanonicalVersion(root) {
  const raw = readFileSync(join(root, "VERSION"), "utf-8").trim();
  if (!raw) return { value: null, error: "VERSION file is empty" };
  if (!isValidSemVer(raw)) return { value: raw, error: `VERSION "${raw}" is not valid SemVer 2.0.0` };
  return { value: raw, error: null };
}

function readJsonVersion(filePath) {
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return { value: data.version ?? null, error: null };
  } catch (err) {
    return { value: null, error: `Failed to read ${filePath}: ${err.message}` };
  }
}

function readLockfileVersions(filePath) {
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    const top = data.version ?? null;
    const root = data.packages?.[""]?.version ?? null;
    return { top, root, error: null };
  } catch (err) {
    return { top: null, root: null, error: `Failed to read ${filePath}: ${err.message}` };
  }
}

const MANIFESTS = [
  { label: "package.json", rel: "package.json" },
  { label: "backend/package.json", rel: "backend/package.json" },
  { label: "frontend/package.json", rel: "frontend/package.json" },
  { label: "shared/package.json", rel: "shared/package.json" },
];

const LOCKFILES = [
  { label: "package-lock.json", rel: "package-lock.json" },
  { label: "backend/package-lock.json", rel: "backend/package-lock.json" },
  { label: "frontend/package-lock.json", rel: "frontend/package-lock.json" },
];

export function validate(root) {
  const errors = [];
  const canonical = readCanonicalVersion(root);

  if (canonical.error) {
    errors.push(`VERSION: ${canonical.error}`);
    return { ok: false, version: canonical.value, errors };
  }

  const expected = canonical.value;

  for (const m of MANIFESTS) {
    const result = readJsonVersion(join(root, m.rel));
    if (result.error) {
      errors.push(`${m.label}: ${result.error}`);
    } else if (result.value !== expected) {
      errors.push(`${m.label}#version: expected "${expected}", got "${result.value}"`);
    }
  }

  for (const l of LOCKFILES) {
    const result = readLockfileVersions(join(root, l.rel));
    if (result.error) {
      errors.push(`${l.label}: ${result.error}`);
    } else {
      if (result.top !== expected) {
        errors.push(`${l.label} top-level version: expected "${expected}", got "${result.top}"`);
      }
      if (result.root !== expected) {
        errors.push(`${l.label} packages[""].version: expected "${expected}", got "${result.root}"`);
      }
    }
  }

  return { ok: errors.length === 0, version: expected, errors };
}

function isCLI() {
  try {
    return process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
  } catch {
    return false;
  }
}

if (isCLI()) {
  const cliRoot = process.argv[2] ? resolve(process.argv[2]) : resolve(import.meta.dirname, "..");
  let result;
  try {
    result = validate(cliRoot);
  } catch (err) {
    const versionPath = join(cliRoot, "VERSION");
    console.error(`App version validation FAILED:\n  - VERSION ${versionPath}: ${err.message}`);
    process.exit(1);
  }

  if (result.ok) {
    console.log(`App version synchronized: ${result.version}`);
    process.exit(0);
  } else {
    console.error("App version validation FAILED:");
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}
