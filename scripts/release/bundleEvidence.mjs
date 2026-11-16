#!/usr/bin/env node
/**
 * Assemble the release evidence bundle for a certification run, and ask the
 * release gate whether it is shippable.
 *
 *   node scripts/release/bundleEvidence.mjs                 newest run
 *   node scripts/release/bundleEvidence.mjs --run <runId>   a specific run
 *   node scripts/release/bundleEvidence.mjs --json          machine-readable
 *
 * WHY THIS FILE EXISTS
 *
 * `provenance/releaseEvidence.mjs` implements a complete release gate —
 * `evaluateReleaseGate`, `assembleEvidenceBundle`, `assertReleaseArtifact`,
 * `gateExitCode` — with full unit-test coverage and **no caller anywhere in
 * the repository**. Its own header calls `assertReleaseArtifact` "the single
 * supported entry point for 'may I ship this'", and nothing invoked it. A
 * gate nothing calls is not a gate; it is a well-tested opinion. This is the
 * caller.
 *
 * IT IS DRY-RUN ONLY, AND THAT IS NOT A LIMITATION — IT IS THE POINT.
 *
 * It reads a completed run's evidence, assembles the bundle, evaluates the
 * gate and prints the verdict. It does not tag, push, upload, create a
 * GitHub Release, write into the git tree, or mark anything published.
 * Publication is an explicit human act that has not been authorised, and a
 * tool that could perform it by accident is a tool that eventually will.
 *
 * It also never WRITES a release claim it has not earned: the bundle is
 * emitted into the run's own evidence directory, which is gitignored, and a
 * PRELIMINARY bundle is structurally different from a RELEASE one (no
 * `release` block at all) so a consumer cannot misread one as the other.
 *
 * EXIT CODES mirror the gate: 0 release-certifiable, 1 blocked, 3 harness
 * error. A blocked bundle is the expected outcome today.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assembleEvidenceBundle,
  assertReleaseArtifact,
  evidenceManifest,
  ARTIFACT_KIND,
} from "./provenance/releaseEvidence.mjs";
import { EVIDENCE_DIRNAME, priorRuns } from "./lib/evidence.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXIT = Object.freeze({ CERTIFIABLE: 0, BLOCKED: 1, HARNESS_ERROR: 3 });

function parseArgs(argv) {
  const opts = { runId: null, json: false, evidenceDir: path.join(REPO_ROOT, EVIDENCE_DIRNAME) };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--run") opts.runId = argv[++i];
    else if (a === "--json") opts.json = true;
    else if (a === "--evidence-dir") opts.evidenceDir = path.resolve(argv[++i]);
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

/** Newest run directory, or a named one. */
function resolveRun(evidenceDir, runId) {
  const runsDir = path.join(evidenceDir, "runs");
  if (!fs.existsSync(runsDir)) throw new Error(`no evidence at ${runsDir}; run \`npm run release:certify\` first`);
  if (runId) {
    const dir = path.join(runsDir, runId);
    if (!fs.existsSync(dir)) throw new Error(`no such run: ${runId}`);
    return dir;
  }
  const runs = priorRuns(evidenceDir);
  if (!runs.length) throw new Error(`no completed runs under ${runsDir}`);
  // priorRuns is newest-first by construction.
  const newest = runs[0];
  return typeof newest === "string" ? path.join(runsDir, newest) : newest.dir ?? path.join(runsDir, newest.runId);
}

/**
 * Collect the observations the gate needs from a run directory.
 *
 * Everything is read from what the axes actually wrote. Nothing is
 * synthesised: a missing input stays missing so the gate blocks on it, which
 * is the behaviour `evaluateReleaseGate` is built around ("anything unknown,
 * unreadable, absent or merely unasserted produces a blocker").
 */
function collectObservations(runDir) {
  const metadata = readJson(path.join(runDir, "metadata.json"));
  const summary = readJson(path.join(runDir, "summary.json"));

  const candidate = metadata
    ? {
        candidateId: metadata.candidateId ?? null,
        head: metadata.git?.head ?? null,
        clean: metadata.git?.clean ?? null,
        dirtyCount: metadata.git?.dirtyCount ?? null,
      }
    : null;

  const inventory = readJson(path.join(runDir, "axes", "component-inventory.json"));
  const vulns = readJson(path.join(runDir, "axes", "image-vulnerabilities.json"));
  const containers = readJson(path.join(runDir, "axes", "containers.json"));

  const ev = inventory?.result?.evidence ?? inventory?.evidence ?? {};
  const vulnEv = vulns?.result?.evidence ?? vulns?.evidence ?? {};
  const contEv = containers?.result?.evidence ?? containers?.evidence ?? {};

  // Hash whatever artifacts the run actually produced, portably.
  const artifactPaths = [];
  for (const sub of fs.readdirSync(runDir, { withFileTypes: true })) {
    if (!sub.isDirectory() || sub.name === "axes") continue;
    for (const f of fs.readdirSync(path.join(runDir, sub.name))) {
      artifactPaths.push(path.join(runDir, sub.name, f));
    }
  }
  const evidence = artifactPaths.length ? evidenceManifest(artifactPaths, { root: runDir }) : null;

  return {
    candidate,
    images: contEv.images ?? vulnEv.images ?? [],
    scanner: vulnEv.scanner ?? null,
    database: vulnEv.database ?? vulnEv.vulnerabilityDatabase ?? null,
    sboms: ev.documents ? [ev.documents] : [],
    sbomReproducibility: ev.reproducibility ?? null,
    evidence,
    workflow: summary ? { runId: summary.runId ?? path.basename(runDir), verdict: summary.releaseVerdict ?? null } : null,
  };
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(String(err.message));
    return EXIT.HARNESS_ERROR;
  }

  if (opts.help) {
    console.log(
      [
        "Assemble the release evidence bundle and evaluate the release gate.",
        "",
        "  --run <runId>        a specific certification run (default: newest)",
        "  --evidence-dir <p>   evidence root (default: ./release-certification)",
        "  --json               print the bundle as JSON",
        "",
        "DRY RUN ONLY. Never tags, pushes, uploads or publishes anything.",
        "Exit: 0 release-certifiable, 1 blocked, 3 harness error.",
      ].join("\n"),
    );
    return EXIT.CERTIFIABLE;
  }

  let runDir;
  let observations;
  try {
    runDir = resolveRun(opts.evidenceDir, opts.runId);
    observations = collectObservations(runDir);
  } catch (err) {
    console.error(`bundleEvidence: ${err.message}`);
    return EXIT.HARNESS_ERROR;
  }

  const bundle = assembleEvidenceBundle(observations);

  // Written beside the run it describes, inside gitignored evidence space, so
  // producing it cannot move the candidate id it is bound to.
  const outPath = path.join(runDir, "evidence-bundle.json");
  fs.writeFileSync(outPath, `${JSON.stringify(bundle, null, 2)}\n`);

  if (opts.json) {
    console.log(JSON.stringify(bundle, null, 2));
  } else {
    console.log("OAA Release Evidence Bundle (DRY RUN — nothing is published)");
    console.log("===========================================================");
    console.log(`run       : ${path.basename(runDir)}`);
    console.log(`candidate : ${bundle.candidate.id ?? "unknown"}`);
    console.log(`kind      : ${bundle.kind}`);
    console.log(`digest    : ${bundle.bundleDigest}`);
    console.log(`written   : ${path.relative(REPO_ROOT, outPath)}`);
    console.log("");
    // Compared against the exported constant, not a bare string: `kind` is a
    // namespaced media-type-like id ("oaa.release-evidence.release/v1"), and
    // a literal "RELEASE" would never match — silently reporting every
    // bundle as blocked, including a genuinely certifiable one.
    if (bundle.kind === ARTIFACT_KIND.RELEASE) {
      console.log("RELEASE GATE: PASS — this evidence is release-grade.");
      console.log("Publication is still a separate, explicit human act. This tool does not perform it.");
    } else {
      console.log(`RELEASE GATE: BLOCKED (${bundle.preliminary.blockerCodes.length} blocker code(s))`);
      for (const b of bundle.preliminary.blockers) {
        console.log(`  - [${b.code}] ${b.detail ?? b.message ?? ""}`);
      }
      if (bundle.preliminary.rescanRequiredAfterCommit) {
        console.log("");
        console.log("  NOTE: the candidate was dirty. Evidence bound to an uncommitted tree");
        console.log("        cannot be reproduced; rescan after committing.");
      }
    }
  }

  // The gate's own entry point, used the way its header says it must be: it
  // throws rather than returning false, so a blocked artifact cannot be
  // ignored by a caller that forgets to check a boolean.
  try {
    assertReleaseArtifact(bundle);
    return EXIT.CERTIFIABLE;
  } catch {
    return EXIT.BLOCKED;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}

export { main, collectObservations, resolveRun };
