#!/usr/bin/env node
/**
 * Cumulative minor-support guards.
 *
 * Makes the cumulative-support rule enforcement rather than convention. Adding
 * a new OpenShift minor must never remove one that already shipped, and the
 * version-awareness baseline must not drift as a side effect of onboarding.
 * See docs/minor-release/MINOR_ONBOARDING_RUNBOOK.md rule 1 and
 * OCP-4.22 v2.1 implementation plan Revision 3 §1.0 (R8).
 *
 * Four checks:
 *   1. BACKEND/FRONTEND AGREEMENT — the two hand-synchronized SUPPORTED_MINORS
 *      declarations are identical. A divergence means the backend and frontend
 *      disagree about what the product supports.
 *   2. SUPERSET (cumulative) — SUPPORTED_MINORS contains every minor recorded in
 *      scripts/lib/released-minor-support.json. A silently dropped minor fails.
 *   3. BASELINE — SUPPORTED_MINORS[0] equals the recorded baselineMinor, so the
 *      version-awareness baseline cannot move incidentally.
 *   4. WELL-FORMED — ascending order, no duplicates, canonical "<major>.<minor>".
 *
 * This guard deliberately does NOT assert an exact supported set. Widening is
 * expected and allowed; narrowing is not.
 *
 * Usage:
 *   node scripts/validate-supported-minors.mjs
 *   node scripts/validate-supported-minors.mjs --json
 *
 * No network access. Exit 0 pass, 1 fail.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MINOR_RE = /^\d+\.\d+$/;

function compareMinors(a, b) {
  const [aMaj, aMin] = a.split(".").map(Number);
  const [bMaj, bMin] = b.split(".").map(Number);
  return aMaj - bMaj || aMin - bMin;
}

async function loadSupportedMinors(absPath) {
  const mod = await import(pathToFileURL(absPath).href);
  return mod.SUPPORTED_MINORS;
}

export async function validateSupportedMinors(root) {
  const errors = [];
  const checks = [];

  const backendPath = join(root, "backend", "src", "versionPolicy.js");
  const frontendPath = join(root, "frontend", "src", "shared", "versionPolicy.js");
  const recordPath = join(root, "scripts", "lib", "released-minor-support.json");

  let backend;
  let frontend;
  let record;

  try {
    backend = await loadSupportedMinors(backendPath);
    frontend = await loadSupportedMinors(frontendPath);
  } catch (err) {
    return { ok: false, errors: [`Failed to load version policy: ${err.message}`], checks };
  }

  try {
    record = JSON.parse(readFileSync(recordPath, "utf-8"));
  } catch (err) {
    return { ok: false, errors: [`Failed to read ${recordPath}: ${err.message}`], checks };
  }

  for (const [label, list] of [["backend", backend], ["frontend", frontend]]) {
    if (!Array.isArray(list) || list.length === 0) {
      errors.push(`${label} SUPPORTED_MINORS is missing or empty`);
    }
  }
  if (errors.length) return { ok: false, errors, checks };

  // 1. Backend/frontend agreement.
  const agree = backend.join(",") === frontend.join(",");
  checks.push({ id: "fe-be-agreement", ok: agree });
  if (!agree) {
    errors.push(
      "SUPPORTED_MINORS differs between backend and frontend:\n" +
        `    backend/src/versionPolicy.js        : [${backend.join(", ")}]\n` +
        `    frontend/src/shared/versionPolicy.js: [${frontend.join(", ")}]\n` +
        "  These are hand-synchronized duplicates and must be identical."
    );
  }

  const supported = backend;
  const previouslyReleased = record.previouslyReleasedMinors ?? [];
  const baselineMinor = record.baselineMinor;

  // 2. Superset / cumulative guard.
  const dropped = previouslyReleased.filter((m) => !supported.includes(m));
  checks.push({ id: "cumulative-superset", ok: dropped.length === 0 });
  if (dropped.length > 0) {
    errors.push(
      `CUMULATIVE SUPPORT VIOLATION: previously released minor(s) [${dropped.join(", ")}] ` +
        `are no longer in SUPPORTED_MINORS [${supported.join(", ")}].\n` +
        "  Supported OpenShift minors are cumulative by default. Adding a minor must never remove one.\n" +
        "  Retiring a minor is a standalone, human-authorized product decision — never a side effect of\n" +
        "  onboarding. If retirement really was authorized, update scripts/lib/released-minor-support.json\n" +
        "  in that same explicit, reviewed commit and say so in the commit message."
    );
  }

  // 3. Baseline guard.
  const baselineOk = supported[0] === baselineMinor;
  checks.push({ id: "baseline-minor", ok: baselineOk });
  if (!baselineOk) {
    errors.push(
      `BASELINE VIOLATION: SUPPORTED_MINORS[0] is "${supported[0]}", expected "${baselineMinor}".\n` +
        "  The first entry is the version-awareness baseline that catalogFieldMeta.js compares against\n" +
        "  for contextual 'New in OpenShift X.Y' badges. Moving it changes badge semantics for every\n" +
        "  already-supported minor, so it is a standalone human decision recorded in\n" +
        "  scripts/lib/released-minor-support.json — not something an onboarding change may do."
    );
  }

  // 4. Well-formed.
  const malformed = supported.filter((m) => !MINOR_RE.test(m));
  const duplicates = supported.filter((m, i) => supported.indexOf(m) !== i);
  const sorted = [...supported].sort(compareMinors);
  const isSorted = sorted.join(",") === supported.join(",");
  const wellFormed = malformed.length === 0 && duplicates.length === 0 && isSorted;
  checks.push({ id: "well-formed", ok: wellFormed });
  if (malformed.length) errors.push(`Malformed minor(s) in SUPPORTED_MINORS: [${malformed.join(", ")}]`);
  if (duplicates.length) errors.push(`Duplicate minor(s) in SUPPORTED_MINORS: [${duplicates.join(", ")}]`);
  if (!isSorted) {
    errors.push(
      `SUPPORTED_MINORS must be ascending; got [${supported.join(", ")}], expected [${sorted.join(", ")}].\n` +
        "  Order is semantic: index 0 is the version-awareness baseline."
    );
  }

  return { ok: errors.length === 0, errors, checks, supported, previouslyReleased, baselineMinor };
}

function isCLI() {
  try {
    return process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
  } catch {
    return false;
  }
}

if (isCLI()) {
  const root = resolve(import.meta.dirname, "..");
  const result = await validateSupportedMinors(root);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (!result.ok) {
    console.error("Supported-minor guards FAILED:");
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log("Supported-minor guards passed:");
  console.log(`  supported            : [${result.supported.join(", ")}]`);
  console.log(`  previously released  : [${result.previouslyReleased.join(", ")}] (all still supported)`);
  console.log(`  version-aware baseline: ${result.baselineMinor} (= SUPPORTED_MINORS[0])`);
  console.log("  backend and frontend declarations agree.");
  process.exit(0);
}
