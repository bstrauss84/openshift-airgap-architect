#!/usr/bin/env node
/**
 * The release build: build every shipping image and emit PROOF B.
 *
 *   node scripts/release/buildImages.mjs                 build both roles, emit the manifest
 *   node scripts/release/buildImages.mjs --dry-run       show what would be built, build nothing
 *   node scripts/release/buildImages.mjs --verify-only   re-check an existing manifest, build nothing
 *   node scripts/release/buildImages.mjs --no-cache      force a from-scratch build
 *
 * WHY THIS IS A SEPARATE ENTRY POINT FROM certify.mjs. The certification
 * harness's standing rule is that a run NEVER mutates the candidate: no
 * install, no build, no git write. A harness that built the thing it certifies
 * could always make its own evidence pass. Building is therefore an explicit,
 * separate operator act, and certification only ever reads the result.
 *
 * ORDER OF OPERATIONS MATTERS AND IS NOT INTERCHANGEABLE.
 *
 *   1. Describe the candidate. The candidate id covers HEAD plus the tracked,
 *      staged and untracked deltas.
 *   2. Build. A build does not write into the worktree, so the candidate id is
 *      unchanged by it.
 *   3. Emit the manifest into gitignored evidence space, so the file's own
 *      existence does not move the candidate id (see lib/buildManifest.mjs).
 *   4. RE-DESCRIBE the candidate and refuse to write if it moved. Something
 *      else editing the tree during a long build would otherwise produce a
 *      manifest that names a candidate nobody can reproduce.
 *   5. Verify the emitted manifest the way certification will read it —
 *      loadBuildManifest() + verifyShippingSet() against freshly inspected
 *      images — so the emitter proves its own output binds rather than
 *      asserting that it should.
 *
 * THE MANIFEST IS PERISHABLE. Edit anything in the worktree afterwards and the
 * candidate id moves, so the manifest no longer binds and the container axes
 * correctly return INCOMPLETE. Rebuild. That is the contract, not a bug.
 *
 * Exit codes: 0 manifest emitted and verified, 1 build or emit failed,
 * 2 emitted but did not verify, 3 harness error.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describeCandidate } from "./lib/candidate.mjs";
import { emitBuildManifest, defaultBuildSpecs, writeBuildManifest, manifestPath, validateBuildManifest } from "./lib/buildManifest.mjs";
import { run } from "./lib/exec.mjs";
import { containerEngine, resolveShippingImages, REQUIRED_ROLES } from "./lib/images.mjs";
import { loadBuildManifest, verifyShippingSet } from "./lib/provenance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

export const EXIT = Object.freeze({ OK: 0, BUILD_FAILED: 1, UNVERIFIED: 2, HARNESS_ERROR: 3 });

export function parseArgs(argv) {
  const opts = { roles: [], dryRun: false, verifyOnly: false, noCache: false, help: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--role") opts.roles.push(argv[++i]);
    else if (a.startsWith("--role=")) opts.roles.push(a.slice(7));
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--verify-only") opts.verifyOnly = true;
    else if (a === "--no-cache") opts.noCache = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else opts.unknown.push(a);
  }
  return opts;
}

/**
 * Read the manifest back exactly as certification will, and check it binds the
 * images that are actually resolvable right now.
 *
 * Deliberately goes through `loadBuildManifest()` and `verifyShippingSet()`
 * rather than re-reading the in-memory document: the thing worth proving is
 * that the CONSUMER accepts the file, not that the producer believes it.
 */
export function verifyEmittedManifest(repoRoot, candidate, { resolve = resolveShippingImages } = {}) {
  const shipping = resolve();
  const loaded = loadBuildManifest(repoRoot);
  if (!loaded.present) return { ok: false, reason: loaded.error ?? `no build manifest at ${loaded.path}`, loaded };
  if (loaded.error) return { ok: false, reason: loaded.error, loaded };

  const structural = validateBuildManifest(loaded.manifest);
  if (!structural.ok) return { ok: false, reason: `manifest is structurally invalid: ${structural.problems.join("; ")}`, loaded };

  const set = verifyShippingSet(shipping.images, candidate, loaded, REQUIRED_ROLES);
  return { ok: set.ok, reason: set.reason, set, path: loaded.path, images: shipping.images.map((i) => ({ role: i.role, id: i.id ?? null })) };
}

export async function main(argv = [], { repoRoot = REPO_ROOT, now = new Date(), engine = containerEngine(), runner = run } = {}) {
  const opts = parseArgs(argv);
  const w = (s) => process.stdout.write(s);

  if (opts.help) {
    w(`${fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]}\n`);
    return EXIT.OK;
  }
  if (opts.unknown.length) {
    process.stderr.write(`unknown argument(s): ${opts.unknown.join(" ")}\n`);
    return EXIT.HARNESS_ERROR;
  }

  const candidate = describeCandidate(repoRoot, { now });
  w(`candidate : ${candidate.exact}\n`);
  w(`candidate id: ${candidate.candidateId}\n`);
  w(`manifest  : ${manifestPath(repoRoot)}\n`);

  if (opts.verifyOnly) {
    const verified = verifyEmittedManifest(repoRoot, candidate);
    w(`\nverify: ${verified.ok ? "BINDS" : "DOES NOT BIND"} — ${verified.reason ?? "every required role is bound to this candidate"}\n`);
    return verified.ok ? EXIT.OK : EXIT.UNVERIFIED;
  }

  const all = defaultBuildSpecs();
  const specs = opts.roles.length ? all.filter((s) => opts.roles.includes(s.role)) : all;
  if (!specs.length) {
    process.stderr.write(`no build spec matches role(s): ${opts.roles.join(", ")}\n`);
    return EXIT.HARNESS_ERROR;
  }

  if (opts.dryRun) {
    for (const s of specs) w(`would build ${s.role}: -f ${s.containerfile} -t ${s.ref} (context ${s.context})\n`);
    w("\n--dry-run: nothing was built and no manifest was written.\n");
    return EXIT.OK;
  }

  if (!engine) {
    process.stderr.write("no container engine (podman/docker) available; nothing can be built\n");
    return EXIT.BUILD_FAILED;
  }

  // A --role-scoped build cannot produce a complete manifest, and a manifest
  // covering one of two shipping images would let the container axes bind half
  // a release. Say so before spending minutes on the build.
  const partial = REQUIRED_ROLES.filter((r) => !specs.some((s) => s.role === r));
  if (partial.length) {
    process.stderr.write(
      `--role selects a PARTIAL set (missing: ${partial.join(", ")}). A manifest must cover every shipping role, so none will be written.\n`,
    );
    return EXIT.HARNESS_ERROR;
  }

  const engineVersion = runner(engine, ["--version"], { timeoutMs: 30_000 }).stdout.trim() || null;
  w(`engine    : ${engineVersion ?? engine}\n\n`);

  const emitted = emitBuildManifest({
    repoRoot,
    candidate,
    specs,
    engine,
    engineVersion,
    runner,
    now,
    extraArgs: opts.noCache ? ["--no-cache"] : [],
  });

  for (const b of emitted.builds) {
    w(`${String(b.role).padEnd(10)} ${b.ok ? "built" : "FAILED"}  ${b.ok ? `${b.inspect.id.slice(0, 12)} ${b.inspect.platform.os}/${b.inspect.platform.architecture} ${Math.round(b.durationMs / 1000)}s` : b.reason}\n`);
    if (b.ok && b.argsNotDeclared.length) {
      w(`${"".padEnd(10)} note: ${b.containerfile} declares no ${b.argsNotDeclared.join(", ")} — proof-A labels are NOT stamped; this manifest is the only binding\n`);
    }
  }

  if (!emitted.ok) {
    process.stderr.write(`\n${emitted.reason}\n`);
    return EXIT.BUILD_FAILED;
  }

  // Step 4: the tree must not have moved under a long build.
  const after = describeCandidate(repoRoot, { now });
  if (after.candidateId !== candidate.candidateId) {
    process.stderr.write(
      `\nthe working tree changed during the build (candidate ${candidate.candidateId.slice(0, 12)}… → ${after.candidateId.slice(0, 12)}…).\n` +
        "A manifest naming either candidate would be wrong, so none was written. Rebuild on a settled tree.\n",
    );
    return EXIT.BUILD_FAILED;
  }

  const written = writeBuildManifest(repoRoot, emitted.manifest);
  if (!written.ok) {
    process.stderr.write(`\n${written.reason}\n`);
    return EXIT.BUILD_FAILED;
  }
  w(`\nmanifest  : ${written.path}\n`);

  const verified = verifyEmittedManifest(repoRoot, candidate);
  w(`verify    : ${verified.ok ? "BINDS" : "DOES NOT BIND"} — ${verified.reason ?? "every required role is bound to this candidate"}\n`);
  return verified.ok ? EXIT.OK : EXIT.UNVERIFIED;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`release build error: ${err?.stack ?? err}\n`);
    process.exit(EXIT.HARNESS_ERROR);
  }
}
