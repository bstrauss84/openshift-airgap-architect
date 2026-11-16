/**
 * PROOF B: the release build manifest, and the build that is allowed to emit it.
 *
 * WHAT THIS CLOSES. `lib/provenance.mjs` documents two accepted proofs that a
 * shipping image was built from the candidate under certification, and then
 * records that NEITHER EXISTS: no Containerfile stamps the OCI labels (proof
 * A) and no build step emits a manifest (proof B). Every container axis is
 * therefore INCOMPLETE before a single assertion is evaluated. This module is
 * proof B's producer. It does not touch proof A — adding `LABEL` lines to the
 * Containerfiles is a product change that belongs in those files, and the
 * patch is reported rather than applied here.
 *
 * THE ONE RULE THAT MAKES A MANIFEST WORTH ANYTHING: a manifest may only be
 * written for images THIS PROCESS JUST BUILT.
 *
 * A manifest assembled by inspecting `localhost/...:latest` would be a
 * self-certifying lie — it would bind whatever image happens to carry the tag
 * to whatever the tree happens to contain, which is precisely the stale-image
 * failure lib/provenance.mjs exists to detect, with a JSON file on top of it.
 * So every entry is sourced from a build this module ran:
 *
 *   1. the build is invoked with `--iidfile`, so the engine itself reports the
 *      image id it produced;
 *   2. the subsequent `image inspect` is addressed BY THAT ID, never by tag;
 *   3. the inspected `.Id` is asserted to equal the iidfile value, so an
 *      inspect that somehow resolved a different artifact fails the emit;
 *   4. a role whose build failed produces NO entry and refuses the WHOLE
 *      manifest. A manifest listing one of two shipping images would let the
 *      container axes bind half a release.
 *
 * WHERE IT IS WRITTEN, AND WHY THAT IS NOT NEGOTIABLE. Under
 * `release-certification/`, which is gitignored. Untracked-but-not-ignored
 * files participate in the candidate id (lib/candidate.mjs folds them in
 * deliberately), so writing the manifest anywhere git can see it would change
 * the very candidate id the manifest claims to describe: it would name
 * candidate A while its own existence made the tree candidate B, and the
 * binding could never match. `writeBuildManifest()` re-checks that property at
 * write time through `manifestAltersCandidate()` and REFUSES rather than
 * producing a file that can never verify.
 *
 * THE MANIFEST IS AS PERISHABLE AS THE CANDIDATE. Any edit to the working tree
 * — including an edit to this harness, since untracked and modified files both
 * feed the candidate id — produces a new candidate id and invalidates the
 * manifest. That is correct and is not a defect: the manifest asserts "these
 * exact image ids were built from this exact tree", and the moment the tree
 * moves the assertion is no longer true. Rebuild, or accept INCOMPLETE.
 *
 * CONFIG DIGEST, NOT "THE IMAGE DIGEST". Entries record the engine's `.Id` —
 * the sha256 of the image CONFIG blob — because that is the only digest that
 * exists for a locally built, never-pushed image, and it is the value
 * `verifyImageProvenance()` compares against. The manifest digest (`.Digest`)
 * and any synthesised `localhost/...@sha256:` repo digest are recorded
 * alongside it under their own names and are never conflated with it; see
 * provenance/candidateBinding.mjs DIGEST_KINDS.
 *
 * BUILD ARGS ARE INTERSECTED WITH THE CONTAINERFILE'S OWN `ARG` DECLARATIONS.
 * Passing `--build-arg OAA_CANDIDATE_ID=…` to a Containerfile that declares no
 * such ARG is silently ignored by the engine (with a warning), so a manifest
 * that merely recorded "we passed it" would overstate what the image carries.
 * The declared set is parsed and the skipped args are recorded as
 * `argsNotDeclared`, which is the machine-readable statement that the proof-A
 * label patch has NOT landed yet.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { run } from "./exec.mjs";
import { DEFAULT_IMAGES, REQUIRED_ROLES } from "./images.mjs";
import { DEFAULT_MANIFEST_RELPATH, MANIFEST_FILENAME, manifestAltersCandidate } from "./provenance.mjs";

export { MANIFEST_FILENAME, DEFAULT_MANIFEST_RELPATH };

/** Schema identity of the emitted document. Consumers must refuse what they do not know. */
export const MANIFEST_SCHEMA_VERSION = 1;

/**
 * Build args the release build offers every image.
 *
 * `APP_GIT_SHA` is already declared by backend/Containerfile. `OAA_CANDIDATE_ID`
 * and `APP_BUILD_TIME` are offered for the proof-A patch and are skipped —
 * visibly — until a Containerfile declares them.
 */
export const OFFERED_BUILD_ARGS = Object.freeze(["APP_GIT_SHA", "OAA_CANDIDATE_ID", "OAA_BUILD_SUPPLIED_REVISION"]);

/** `ARG NAME`, `ARG NAME=default`, with or without leading whitespace. */
const ARG_LINE = /^[ \t]*ARG[ \t]+([A-Za-z_][A-Za-z0-9_]*)/gim;

/** Every build arg a Containerfile declares, across all of its stages. */
export function declaredBuildArgs(containerfileText) {
  const out = new Set();
  const text = String(containerfileText ?? "");
  for (const m of text.matchAll(ARG_LINE)) out.add(m[1]);
  return out;
}

/**
 * `LABEL` keys a Containerfile sets, so the emitter can state whether proof A
 * exists without anybody having to read the file.
 *
 * Backslash continuations are joined first, because the proof-A patch spans
 * several lines and a line-at-a-time scan would see only its first key.
 */
export function declaredLabels(containerfileText) {
  const out = new Set();
  const joined = String(containerfileText ?? "").replace(/\\[ \t]*\r?\n/g, " ");
  for (const line of joined.split("\n")) {
    if (!/^[ \t]*LABEL[ \t]/i.test(line)) continue;
    for (const k of line.matchAll(/([A-Za-z0-9_][A-Za-z0-9_.\-/]*)[ \t]*=/g)) out.add(k[1]);
  }
  return out;
}

const sha256File = (file) => {
  try {
    return `sha256:${createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
  } catch {
    return null;
  }
};

/** Normalise an image id to bare lowercase hex, so iidfile and inspect compare. */
export function bareImageId(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().replace(/^sha256:/, "");
  return /^[0-9a-f]{64}$/.test(v) ? v : null;
}

/** The build specification for every role that ships, derived from lib/images.mjs. */
export function defaultBuildSpecs(images = DEFAULT_IMAGES) {
  return images.map((i) => ({ role: i.role, ref: i.ref, containerfile: i.containerfile, context: "." }));
}

/**
 * Build ONE image and report what the engine actually produced.
 *
 * `--iidfile` is the whole point: it is the engine's own statement of which
 * image this invocation created, independent of any tag. Nothing downstream
 * reads the tag.
 */
export function buildOneImage(spec, { engine, repoRoot, buildArgs = {}, runner = run, timeoutMs = 60 * 60_000, extraArgs = [] } = {}) {
  if (!engine) return { role: spec?.role, ok: false, reason: "no container engine (podman/docker) available" };
  if (!spec?.role || !spec?.containerfile || !spec?.ref) {
    return { role: spec?.role ?? null, ok: false, reason: "build spec needs role, ref and containerfile" };
  }

  const containerfile = path.resolve(repoRoot, spec.containerfile);
  let containerfileText;
  try {
    containerfileText = fs.readFileSync(containerfile, "utf8");
  } catch (err) {
    return { role: spec.role, ok: false, reason: `Containerfile ${spec.containerfile} is not readable: ${err.message}` };
  }

  const declared = declaredBuildArgs(containerfileText);
  const applied = {};
  const argsNotDeclared = [];
  for (const [k, v] of Object.entries(buildArgs)) {
    if (declared.has(k)) applied[k] = v;
    else argsNotDeclared.push(k);
  }

  // The iidfile lives OUTSIDE the repository. Anywhere inside it that git does
  // not ignore would join the untracked set and move the candidate id mid-build.
  const iidFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oaa-build-iid-")), "iid");
  const argv = [
    "build",
    "-f",
    containerfile,
    "-t",
    spec.ref,
    "--iidfile",
    iidFile,
    ...Object.entries(applied).flatMap(([k, v]) => ["--build-arg", `${k}=${v}`]),
    ...extraArgs,
    path.resolve(repoRoot, spec.context ?? "."),
  ];

  const started = new Date();
  const res = runner(engine, argv, { cwd: repoRoot, timeoutMs });
  const completed = new Date();

  let iid = null;
  try {
    iid = bareImageId(fs.readFileSync(iidFile, "utf8"));
  } catch {
    iid = null;
  }
  try {
    fs.rmSync(path.dirname(iidFile), { recursive: true, force: true });
  } catch {
    /* best effort; a leftover temp dir must not fail an otherwise complete build */
  }

  const base = {
    role: spec.role,
    ref: spec.ref,
    containerfile: spec.containerfile,
    containerfileSha256: sha256File(containerfile),
    context: spec.context ?? ".",
    buildArgs: applied,
    argsNotDeclared: argsNotDeclared.sort(),
    declaredLabels: [...declaredLabels(containerfileText)].sort(),
    // Recorded with host paths folded back to repo-relative form.
    //
    // The build genuinely runs with absolute paths — the iidfile must sit
    // outside the repo so it cannot join the untracked set and move the
    // candidate id mid-build. But the RECORD of that command is release
    // evidence meant to be read elsewhere, and verbatim it embedded the
    // build host's home directory, username and a random temp path. The
    // command stays faithful in shape and arguments; only the machine-
    // specific prefixes are normalised.
    command: [engine, ...argv]
      .map((token) => {
        if (typeof token !== "string") return token;
        if (token.startsWith(repoRoot)) {
          const rel = path.relative(repoRoot, token);
          return rel === "" ? "." : rel.split(path.sep).join("/");
        }
        if (token === iidFile) return "<tmp>/iid";
        return token;
      })
      .join(" "),
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    durationMs: completed.getTime() - started.getTime(),
    exitCode: res.status,
  };

  if (res.spawnError) return { ...base, ok: false, reason: `could not execute ${engine}: ${res.spawnError}` };
  if (res.timedOut) return { ...base, ok: false, reason: `${engine} build timed out after ${timeoutMs}ms` };
  if (res.status !== 0) {
    const tail = String(res.stderr || res.stdout || "").trim().split("\n").slice(-4).join(" / ");
    return { ...base, ok: false, reason: `${engine} build exited ${res.status}: ${tail.slice(0, 500)}` };
  }
  if (!iid) {
    // A zero exit with no image id is not a successful build as far as this
    // module is concerned: there is nothing to bind.
    return { ...base, ok: false, reason: "build reported success but wrote no usable image id to --iidfile" };
  }

  return { ...base, ok: true, builtImageId: iid };
}

/**
 * Inspect an image BY ID and confirm it is the one just built.
 *
 * Addressing by id rather than by tag is what stops a concurrent build, or a
 * stale tag, from substituting a different artifact between the build and the
 * inspect.
 */
export function inspectBuiltImage(engine, builtImageId, { runner = run, timeoutMs = 120_000 } = {}) {
  if (!builtImageId) return { ok: false, reason: "no built image id to inspect" };
  const res = runner(engine, ["image", "inspect", builtImageId, "--format", "json"], { timeoutMs });
  if (res.spawnError) return { ok: false, reason: `could not execute ${engine}: ${res.spawnError}` };
  if (res.timedOut) return { ok: false, reason: `${engine} image inspect timed out after ${timeoutMs}ms` };
  if (res.status !== 0) {
    return { ok: false, reason: (res.stderr || "").trim().split("\n")[0] || `${engine} image inspect exited ${res.status}` };
  }
  let data;
  try {
    const parsed = JSON.parse(res.stdout);
    data = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (err) {
    return { ok: false, reason: `unparseable inspect output: ${err.message}` };
  }
  if (!data || typeof data !== "object") return { ok: false, reason: "inspect payload is not an object" };

  const id = typeof data.Id === "string" ? data.Id : null;
  if (!id) return { ok: false, reason: "inspect payload carries no image Id" };
  if (bareImageId(id) !== bareImageId(builtImageId)) {
    return {
      ok: false,
      reason: `inspect resolved a DIFFERENT image (${String(id).slice(0, 19)}…) than the build produced (${builtImageId.slice(0, 12)}…)`,
    };
  }

  return {
    ok: true,
    // Recorded VERBATIM: verifyImageProvenance() compares this against
    // lib/images.mjs's `inspectImage().id`, which is also the raw `.Id`.
    // Normalising here would break string equality on podman, which reports a
    // bare hex id where docker reports a `sha256:`-prefixed one.
    id,
    configDigest: `sha256:${bareImageId(id)}`,
    manifestDigest: typeof data.Digest === "string" ? data.Digest : null,
    repoDigests: Array.isArray(data.RepoDigests) ? [...data.RepoDigests].sort() : [],
    created: typeof data.Created === "string" ? data.Created : null,
    sizeBytes: typeof data.Size === "number" ? data.Size : null,
    platform: {
      os: typeof data.Os === "string" ? data.Os : null,
      architecture: typeof data.Architecture === "string" ? data.Architecture : null,
      variant: typeof data.Variant === "string" ? data.Variant : null,
    },
    labels: { ...(data.Labels ?? {}), ...(data.Config?.Labels ?? {}) },
  };
}

/**
 * Assemble the manifest document. Pure: every input is already resolved, so
 * the whole document shape is testable from fixtures with no engine.
 */
export function buildManifestDocument({ candidate, builds, engine, engineVersion = null, generatedAt, requiredRoles = REQUIRED_ROLES }) {
  const images = builds
    .map((b) => ({
      role: b.role,
      ref: b.ref,
      // THE field verifyImageProvenance() binds on. Named `id` because that is
      // the contract; `configDigest` carries the same value in canonical form.
      id: b.inspect.id,
      configDigest: b.inspect.configDigest,
      manifestDigest: b.inspect.manifestDigest,
      repoDigests: b.inspect.repoDigests,
      platform: b.inspect.platform,
      sizeBytes: b.inspect.sizeBytes,
      created: b.inspect.created,
      builtImageId: b.builtImageId,
      inputs: {
        containerfile: b.containerfile,
        containerfileSha256: b.containerfileSha256,
        context: b.context,
        buildArgs: b.buildArgs,
        argsNotDeclared: b.argsNotDeclared,
        declaredLabels: b.declaredLabels,
      },
      build: {
        command: b.command,
        startedAt: b.startedAt,
        completedAt: b.completedAt,
        durationMs: b.durationMs,
        exitCode: b.exitCode,
        source: "built by scripts/release/buildImages.mjs in this process; image id taken from the engine's own --iidfile",
      },
    }))
    .sort((a, b) => String(a.role).localeCompare(String(b.role)));

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    kind: "oaa.release-build-manifest/v1",
    // The binding. verifyImageProvenance() refuses the manifest outright when
    // this does not equal the candidate being certified.
    candidateId: candidate?.candidateId ?? null,
    candidate: {
      exact: candidate?.exact ?? null,
      head: candidate?.git?.head ?? null,
      branch: candidate?.git?.branch ?? null,
      clean: candidate?.git?.clean ?? null,
      modifiedPaths: candidate?.git?.modifiedPaths?.length ?? null,
      untrackedPaths: candidate?.git?.untrackedPaths?.length ?? null,
    },
    generatedAt,
    builder: { engine, engineVersion, host: { platform: process.platform, arch: process.arch } },
    requiredRoles: [...requiredRoles],
    images,
    provenanceNote:
      "PROOF B. Every entry was produced by a build this process ran; no entry is derived from inspecting a pre-existing tag. " +
      "`id` is the image CONFIG digest (engine .Id), which is the only digest that exists for a never-pushed local build.",
  };
}

/**
 * Structural validation, applied to a document before it is written AND
 * available to anything that reads one back.
 */
export function validateBuildManifest(doc, { requiredRoles = REQUIRED_ROLES } = {}) {
  const problems = [];
  if (!doc || typeof doc !== "object") return { ok: false, problems: ["manifest is not an object"] };
  if (doc.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    problems.push(`unknown manifest schemaVersion ${JSON.stringify(doc.schemaVersion)}; expected ${MANIFEST_SCHEMA_VERSION}`);
  }
  if (typeof doc.candidateId !== "string" || !/^[0-9a-f]{64}$/.test(doc.candidateId)) {
    problems.push("candidateId is missing or is not a sha256 hex digest");
  }
  if (typeof doc.candidate?.head !== "string" || !doc.candidate.head) problems.push("candidate.head is missing");

  const images = Array.isArray(doc.images) ? doc.images : [];
  if (!images.length) problems.push("manifest lists no images");
  const roles = new Set();
  for (const img of images) {
    if (!img?.role) problems.push("an image entry has no role");
    else if (roles.has(img.role)) problems.push(`role "${img.role}" appears more than once`);
    else roles.add(img.role);
    if (!bareImageId(img?.id)) problems.push(`role "${img?.role}" has no usable image id`);
    if (!img?.platform?.architecture) problems.push(`role "${img?.role}" records no architecture`);
    if (!img?.build?.command) problems.push(`role "${img?.role}" records no build command`);
    if (!img?.inputs?.containerfileSha256) problems.push(`role "${img?.role}" records no Containerfile digest`);
  }
  const missing = requiredRoles.filter((r) => !roles.has(r));
  if (missing.length) problems.push(`manifest does not cover required role(s): ${missing.join(", ")}`);

  return { ok: problems.length === 0, problems };
}

/** Resolve the manifest path exactly as `loadBuildManifest()` will read it. */
export function manifestPath(repoRoot, env = process.env) {
  return env.OAA_CERT_BUILD_MANIFEST ? path.resolve(env.OAA_CERT_BUILD_MANIFEST) : path.join(repoRoot, DEFAULT_MANIFEST_RELPATH);
}

/**
 * Write the manifest, refusing any location that would change the candidate id.
 *
 * The refusal is not advisory. A manifest written to a git-visible path can
 * NEVER verify — its own presence moves the candidate — so writing it would
 * manufacture a permanently-unbindable artifact and an unexplainable
 * INCOMPLETE.
 */
export function writeBuildManifest(repoRoot, doc, { env = process.env, fsImpl = fs } = {}) {
  const valid = validateBuildManifest(doc);
  if (!valid.ok) return { ok: false, reason: `refusing to write an invalid manifest: ${valid.problems.join("; ")}`, problems: valid.problems };

  const file = manifestPath(repoRoot, env);
  if (manifestAltersCandidate(repoRoot, file)) {
    return {
      ok: false,
      path: file,
      reason:
        `refusing to write the build manifest to "${path.relative(repoRoot, file)}": that location participates in candidate ` +
        "identity, so the file's own presence would change the candidate it claims to bind. Use release-certification/ or a path outside the repository.",
    };
  }

  try {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fsImpl.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
    fsImpl.renameSync(tmp, file);
  } catch (err) {
    return { ok: false, path: file, reason: `could not write build manifest: ${err.message}` };
  }
  return { ok: true, path: file };
}

/**
 * Build every role and emit the manifest.
 *
 * Fail-closed at the whole-set level: one failed build refuses the entire
 * manifest. A manifest covering one of two shipping images would let the
 * container axes bind half a release, which is the exact failure
 * `verifyShippingSet()` exists to prevent.
 */
export function emitBuildManifest({
  repoRoot,
  candidate,
  specs = defaultBuildSpecs(),
  engine,
  engineVersion = null,
  runner = run,
  now = new Date(),
  requiredRoles = REQUIRED_ROLES,
  extraArgs = [],
  timeoutMs,
} = {}) {
  if (!engine) return { ok: false, reason: "no container engine (podman/docker) available; nothing can be built", builds: [] };
  if (!candidate?.candidateId) return { ok: false, reason: "no candidate was described; a manifest with no candidate binds nothing", builds: [] };

  const missingSpecs = requiredRoles.filter((r) => !specs.some((s) => s.role === r));
  if (missingSpecs.length) {
    return { ok: false, reason: `no build spec for required role(s): ${missingSpecs.join(", ")}`, builds: [] };
  }

  // `OAA_BUILD_SUPPLIED_REVISION` is the positive marker candidateBinding.mjs
  // looks for: with it set, the revision label is this build's by declaration
  // rather than by heuristic. All three are intersected with the
  // Containerfile's own ARG declarations, so the two that no Containerfile
  // declares yet are recorded as skipped instead of being silently implied.
  const buildArgs = {
    APP_GIT_SHA: candidate.git?.head ?? "unknown",
    OAA_CANDIDATE_ID: candidate.candidateId,
    OAA_BUILD_SUPPLIED_REVISION: "true",
  };

  const builds = [];
  for (const spec of specs) {
    const built = buildOneImage(spec, { engine, repoRoot, buildArgs, runner, extraArgs, ...(timeoutMs ? { timeoutMs } : {}) });
    if (!built.ok) {
      builds.push(built);
      continue;
    }
    const inspect = inspectBuiltImage(engine, built.builtImageId, { runner });
    builds.push(inspect.ok ? { ...built, inspect } : { ...built, ok: false, reason: `built, but identity could not be confirmed: ${inspect.reason}` });
  }

  const failed = builds.filter((b) => !b.ok);
  if (failed.length) {
    return {
      ok: false,
      reason: `refusing to emit a partial manifest: ${failed.map((f) => `${f.role} (${f.reason})`).join("; ")}`,
      builds,
      manifest: null,
    };
  }

  const manifest = buildManifestDocument({
    candidate,
    builds,
    engine,
    engineVersion,
    generatedAt: now.toISOString(),
    requiredRoles,
  });
  return { ok: true, builds, manifest };
}
