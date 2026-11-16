#!/usr/bin/env node
"use strict";

/**
 * Generate the frontend architecture-support projection from canonical data.
 *
 *   data/arch-support/<minor>.json          ->  frontend/src/data/arch-support/<minor>.json
 *            CANONICAL                                    GENERATED PROJECTION
 *
 * Data direction is one-way (runbook Rule 3). Edit canonical, regenerate the
 * projection, never the reverse, and never read the projection as a data source
 * in tooling.
 *
 * WHY A PROJECTION RATHER THAN A STRAIGHT MIRROR
 *
 * The catalogs and the docs-index are mirrored verbatim because the browser
 * needs every field. The architecture matrix is different: 137 KB of its 157 KB
 * is `reason` prose and per-cell `provenance` quotes, which exist for auditors
 * and for the guard, not for a disabled-button tooltip. Mirroring it whole would
 * put ~92 KB of citation text into the eager bundle — against a 1,320 KB budget
 * that FQ-10 fought to reclaim — to render tooltips that need one sentence.
 *
 * So the projection keeps the SHAPE of the canonical document (same `matrix`
 * array, same `scenarioId`, same per-architecture keys) and drops only the audit
 * fields. `shared/archSupport.js` therefore reads either form unchanged, and
 * `--check` fails if the two ever disagree on a disposition or a summary.
 *
 * Usage:
 *   node scripts/sync-arch-support.js            write the projection
 *   node scripts/sync-arch-support.js --check    verify, exit 1 on drift
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const CANONICAL_DIR = path.join(REPO_ROOT, "data", "arch-support");
const PROJECTION_DIR = path.join(REPO_ROOT, "frontend", "src", "data", "arch-support");

const PROJECTION_SCHEMA = "oaa.archSupport.projection/1";

/** Build the projection document for one canonical document. */
function project(doc) {
  return {
    schema: PROJECTION_SCHEMA,
    _generated:
      "GENERATED from data/arch-support/" +
      doc.minor +
      ".json by scripts/sync-arch-support.js. Do not edit. Audit fields (reason, provenance, sources) are deliberately omitted; read the canonical file for those.",
    minor: doc.minor,
    homogeneousOnly: {
      value: doc.homogeneousOnly.value,
      mixedArchitectureSupported: doc.homogeneousOnly.mixedArchitectureSupported,
      statement: doc.homogeneousOnly.statement,
    },
    fipsValidatedArchitectures: {
      architectures: doc.fipsValidatedArchitectures.architectures,
      excludes: doc.fipsValidatedArchitectures.excludes,
      axis: doc.fipsValidatedArchitectures.axis,
      scope: doc.fipsValidatedArchitectures.scope,
    },
    matrix: doc.matrix.map((row) => ({
      platform: row.platform,
      installMethod: row.installMethod,
      scenarioId: row.scenarioId,
      architectures: Object.fromEntries(
        Object.entries(row.architectures).map(([arch, cell]) => [
          arch,
          { disposition: cell.disposition, offered: cell.offered, summary: cell.summary },
        ])
      ),
    })),
  };
}

function serialize(doc) {
  return JSON.stringify(doc, null, 2) + "\n";
}

function run(check) {
  if (!fs.existsSync(CANONICAL_DIR)) {
    console.error(`Missing canonical directory ${CANONICAL_DIR}`);
    return 1;
  }
  const files = fs.readdirSync(CANONICAL_DIR).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    console.error("No canonical arch-support files found — refusing to report an empty read as success.");
    return 1;
  }

  fs.mkdirSync(PROJECTION_DIR, { recursive: true });

  let drifted = 0;
  let written = 0;
  let inSync = 0;
  const seen = new Set();

  for (const file of files) {
    const doc = JSON.parse(fs.readFileSync(path.join(CANONICAL_DIR, file), "utf8"));
    const expected = serialize(project(doc));
    const target = path.join(PROJECTION_DIR, file);
    seen.add(file);

    const actual = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    if (actual === expected) {
      inSync++;
      continue;
    }
    if (check) {
      drifted++;
      console.error(`  DRIFT  ${file}${actual === null ? " (projection missing)" : ""}`);
      continue;
    }
    fs.writeFileSync(target, expected);
    written++;
    console.log(`  synced ${file}`);
  }

  // An orphan is a projection whose canonical source is gone. Leaving one behind
  // would keep a retired minor loadable in the browser.
  const orphans = fs.existsSync(PROJECTION_DIR)
    ? fs.readdirSync(PROJECTION_DIR).filter((f) => f.endsWith(".json") && !seen.has(f))
    : [];
  for (const o of orphans) {
    if (check) {
      drifted++;
      console.error(`  ORPHAN ${o} (no canonical source)`);
    } else {
      fs.unlinkSync(path.join(PROJECTION_DIR, o));
      console.log(`  removed orphan ${o}`);
    }
  }

  if (check) {
    if (drifted > 0) {
      console.error(`\nArch-support projection OUT OF SYNC: ${drifted} file(s). Run: node scripts/sync-arch-support.js`);
      return 1;
    }
    console.log(`Arch-support projection is in sync (${inSync} file(s)).`);
    return 0;
  }

  console.log(`Arch-support projection: ${inSync} in sync, ${written} written, ${orphans.length} orphan(s) removed.`);
  return 0;
}

if (require.main === module) {
  process.exit(run(process.argv.includes("--check")));
}

module.exports = { run, project, PROJECTION_SCHEMA };
