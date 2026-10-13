/**
 * Source-candidate ↔ shipping-image binding.
 *
 * THE GAP THIS CLOSES. Resolving `localhost/...:latest` to an immutable image
 * ID guarantees every container axis inspects the SAME image. It does not
 * guarantee that image was built from the candidate being certified. A local
 * image from last week satisfies "same image" perfectly while certifying
 * source it has never contained. Tag, creation time, `:latest`, and the
 * developer's memory of having rebuilt are all worthless as proof.
 *
 * TWO ACCEPTED PROOFS, both independently verified here — never asserted by
 * the thing being certified:
 *
 *   A. OCI LABELS (preferred). The image carries
 *        org.opencontainers.image.revision = <git sha>
 *      and, for a dirty candidate, io.oaa.candidate-id = <candidate id>.
 *      Labels are baked at build time and are part of the image config, so
 *      they travel with the artifact into a registry and back.
 *
 *   B. BUILD MANIFEST. A deterministic release-build step emits a manifest
 *      naming the candidate it built from and the resulting image IDs.
 *      Certification requires the manifest to name THIS candidate and to list
 *      the exact resolved image IDs.
 *
 * WHY A CLEAN CANDIDATE NEEDS LESS THAN A DIRTY ONE. A commit SHA uniquely
 * determines the source tree, so `image.revision` alone binds a clean
 * candidate. A dirty candidate's bytes are described by no commit, so the
 * revision label cannot distinguish it from a build of the clean commit; it
 * requires the candidate id explicitly.
 *
 * NEITHER PROOF EXISTS IN THE REPOSITORY TODAY. Neither Containerfile sets
 * these labels and no build step emits a manifest, so every container axis is
 * INCOMPLETE until 8D/8F adds one. That is the designed outcome: adding the
 * labels is a product change this tranche does not make, and an unprovable
 * binding must not be allowed to read as PASS.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Standard OCI annotation for the source revision an image was built from. */
export const REVISION_LABEL = "org.opencontainers.image.revision";

/** Project-specific label binding an image to a full candidate id (dirty-safe). */
export const CANDIDATE_LABEL = "io.oaa.candidate-id";

export const MANIFEST_FILENAME = "release-build-manifest.json";

/**
 * Default manifest location: inside the gitignored evidence directory.
 *
 * NOT the repository root. Untracked files participate in the candidate id
 * (deliberately — an uncommitted new source file changes behaviour as much as
 * an edit to a tracked one), and `release-build-manifest.json` at the root is
 * untracked and NOT ignored. Writing it would therefore change the very
 * candidate id it exists to bind: the manifest would describe candidate A
 * while its own presence made the tree candidate B, and the binding could
 * never match. `release-certification/` is gitignored, so files beneath it are
 * excluded by `git ls-files --others --exclude-standard` and cannot move the
 * candidate id.
 */
export const DEFAULT_MANIFEST_RELPATH = path.join("release-certification", MANIFEST_FILENAME);

/**
 * Would a file at this path participate in the candidate identity?
 *
 * True for anything inside the repository that git would report as tracked or
 * as an untracked-but-not-ignored file. Such a location is self-referential
 * and is refused rather than silently used.
 */
export function manifestAltersCandidate(repoRoot, file) {
  const rel = path.relative(repoRoot, file);
  // Outside the repository entirely: cannot affect candidate identity.
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;

  const ignored = spawnSync("git", ["-C", repoRoot, "check-ignore", "-q", "--", rel], { stdio: "ignore" }).status === 0;
  if (ignored) return false;

  // Not ignored. Whether it exists yet or not, creating it would add an
  // untracked file to the candidate — or, if tracked, it is already part of it.
  return true;
}

/**
 * Load the build manifest, if a release-build step produced one.
 *
 * `OAA_CERT_BUILD_MANIFEST` overrides the location, and is validated by the
 * same rule: an override pointing somewhere that participates in candidate
 * identity is rejected, not used. The fix for that is to point it outside the
 * tree or at ignored evidence space — never to weaken untracked-file binding.
 */
export function loadBuildManifest(repoRoot, env = process.env) {
  const overridden = Boolean(env.OAA_CERT_BUILD_MANIFEST);
  const file = overridden ? path.resolve(env.OAA_CERT_BUILD_MANIFEST) : path.join(repoRoot, DEFAULT_MANIFEST_RELPATH);

  if (manifestAltersCandidate(repoRoot, file)) {
    return {
      present: false,
      path: file,
      error:
        `build manifest location "${path.relative(repoRoot, file)}" participates in candidate identity, so writing it ` +
        `would change the candidate it claims to describe. Put it under release-certification/ or outside the repository.`,
    };
  }

  if (!fs.existsSync(file)) return { present: false, path: file };
  try {
    return { present: true, path: file, manifest: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (err) {
    return { present: true, path: file, error: `unparseable build manifest: ${err.message}` };
  }
}

/**
 * Decide whether one resolved image is provably built from this candidate.
 *
 * Pure: takes already-read inputs so it is directly testable without podman,
 * a registry or a git repository.
 *
 * @param {object} image    resolved image (id, labels, role, ref)
 * @param {object} candidate from describeCandidate()
 * @param {object} [manifestResult] from loadBuildManifest()
 */
export function verifyImageProvenance(image, candidate, manifestResult = { present: false }) {
  const labels = image?.labels ?? {};
  const head = candidate?.git?.head ?? null;
  const candidateId = candidate?.candidateId ?? null;
  const dirty = candidate?.git?.clean === false;

  const observed = {
    revisionLabel: labels[REVISION_LABEL] ?? null,
    candidateLabel: labels[CANDIDATE_LABEL] ?? null,
    manifestPresent: Boolean(manifestResult?.present),
  };

  if (!image?.present) {
    return { role: image?.role, bound: false, method: null, reason: "image is not present locally", observed };
  }

  // --- Proof A: OCI labels -------------------------------------------------
  if (observed.candidateLabel) {
    if (observed.candidateLabel === candidateId) {
      return { role: image.role, bound: true, method: "oci-label:candidate-id", reason: "image carries this candidate id", observed };
    }
    return {
      role: image.role,
      bound: false,
      method: null,
      reason: `image is labelled with a DIFFERENT candidate (${String(observed.candidateLabel).slice(0, 12)}…)`,
      observed,
    };
  }

  if (observed.revisionLabel) {
    if (dirty) {
      return {
        role: image.role,
        bound: false,
        method: null,
        reason: `candidate is dirty, so a revision label cannot bind it; ${CANDIDATE_LABEL} is required`,
        observed,
      };
    }
    if (observed.revisionLabel === head) {
      return { role: image.role, bound: true, method: "oci-label:revision", reason: "image revision label matches HEAD of a clean candidate", observed };
    }
    return {
      role: image.role,
      bound: false,
      method: null,
      reason: `image was built from a different revision (${String(observed.revisionLabel).slice(0, 12)}…)`,
      observed,
    };
  }

  // --- Proof B: build manifest --------------------------------------------
  if (manifestResult?.present) {
    if (manifestResult.error) {
      return { role: image.role, bound: false, method: null, reason: manifestResult.error, observed };
    }
    const m = manifestResult.manifest ?? {};
    if (m.candidateId !== candidateId) {
      return {
        role: image.role,
        bound: false,
        method: null,
        reason: `build manifest describes a different candidate (${String(m.candidateId).slice(0, 12)}…)`,
        observed,
      };
    }
    const entry = (m.images ?? []).find((i) => i.role === image.role);
    if (!entry) {
      return { role: image.role, bound: false, method: null, reason: `build manifest does not list role "${image.role}"`, observed };
    }
    if (entry.id !== image.id) {
      return {
        role: image.role,
        bound: false,
        method: null,
        reason: "build manifest lists a different image id for this role than the one resolved locally",
        observed: { ...observed, manifestImageId: entry.id, resolvedImageId: image.id },
      };
    }
    return { role: image.role, bound: true, method: "build-manifest", reason: "build manifest binds this image id to this candidate", observed };
  }

  return {
    role: image.role,
    bound: false,
    method: null,
    reason: `no provenance: image carries neither ${REVISION_LABEL} nor ${CANDIDATE_LABEL}, and no build manifest was found`,
    observed,
  };
}

/**
 * Verify the COMPLETE expected shipping-image set.
 *
 * Returns `ok` only when every required role is present AND candidate-bound.
 * A partial set is never acceptable: scanning one of two shipping images and
 * reporting PASS would certify half a release.
 */
export function verifyShippingSet(images, candidate, manifestResult, requiredRoles) {
  const perImage = images.map((img) => ({ ...verifyImageProvenance(img, candidate, manifestResult), ref: img.ref, id: img.id ?? null }));
  const roles = new Set(images.filter((i) => i.present).map((i) => i.role));

  const missingRoles = requiredRoles.filter((r) => !roles.has(r));
  const unbound = perImage.filter((p) => requiredRoles.includes(p.role) && !p.bound && !missingRoles.includes(p.role));

  let reason = null;
  if (missingRoles.length) reason = `required shipping image(s) not present locally: ${missingRoles.join(", ")}`;
  else if (unbound.length) reason = `shipping image(s) not provably built from this candidate: ${unbound.map((u) => `${u.role} (${u.reason})`).join("; ")}`;

  return { ok: !reason, reason, missingRoles, unbound, perImage, requiredRoles };
}
