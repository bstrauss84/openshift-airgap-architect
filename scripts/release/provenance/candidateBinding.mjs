/**
 * The OAA source-SHA ↔ build-manifest binding contract, and the digest
 * taxonomy a provenance report must not collapse.
 *
 * ── PART 1: THE ORDERING DEFECT (verified against the real images) ─────────
 *
 * `lib/provenance.mjs verifyImageProvenance()` evaluates proofs in this order:
 *
 *     candidate label → revision label → build manifest
 *
 * and each branch RETURNS. The revision-label branch therefore returns before
 * the build manifest is ever consulted. That would be harmless if only OAA
 * builds set a revision label. They do not: both shipping images inherit one
 * from their UBI base. Verified by `podman image inspect` on 2026-10-14:
 *
 *   backend   org.opencontainers.image.revision = e573c6075f71cca94d900cafd032ccfa0f871961
 *             vcs-ref                           = e573c6075f71cca94d900cafd032ccfa0f871961   (identical)
 *             name = ubi9/nodejs-22, com.redhat.component = nodejs-22-container
 *
 *   frontend  org.opencontainers.image.revision = 24d2029ef4cca0becd2733ebfbbc8e901f67f6cb
 *             vcs-ref                           = 24d2029ef4cca0becd2733ebfbbc8e901f67f6cb   (identical)
 *             name = ubi9/nginx-124, com.redhat.component = nginx-124-container
 *
 * Neither SHA is an object in this repository — `git cat-file -t` fails for
 * both. So the two consequences imageIdentity.mjs predicts are real:
 *
 *   1. The harness reports "image was built from a different revision
 *      (e573c6075f71…)", sending an operator to hunt for an OAA build that
 *      has never existed.
 *   2. Proof B is DEAD CODE for the only two images this harness certifies. A
 *      perfectly correct `release-build-manifest.json` can never bind them,
 *      because the inherited label short-circuits the function first.
 *
 * THE FIX IS ORDERING PLUS CLASSIFICATION, not deleting proof A. A revision
 * label is still good evidence when this build actually set it. What must
 * change is that an INHERITED revision label is treated as ABSENT — it is not
 * evidence about OAA at all — so evaluation falls through to the manifest.
 * `bindImageToCandidate()` below is the reference implementation; the patch
 * for lib/provenance.mjs mirrors it.
 *
 * ── PART 2: THE BINDING CONTRACT ───────────────────────────────────────────
 *
 * An image is bound to a candidate when at least one holds, checked in this
 * order, with inherited labels discarded before any of it:
 *
 *   B1 CANDIDATE LABEL  `io.oaa.candidate-id` == candidate id.
 *                       Binds a clean OR dirty candidate. Strongest, because
 *                       the candidate id covers uncommitted and untracked
 *                       files that no commit SHA describes.
 *
 *   B2 BUILD-SUPPLIED REVISION  `org.opencontainers.image.revision` == HEAD,
 *                       AND the label is classified build-supplied, AND the
 *                       candidate is CLEAN. Refused for a dirty candidate: a
 *                       commit SHA cannot describe a tree that differs from
 *                       that commit.
 *
 *   B3 BUILD MANIFEST   a manifest naming this candidate id and listing this
 *                       role against this image's CONFIG digest. Reachable
 *                       now, because B2 no longer swallows inherited labels.
 *
 * WHAT THE BUILD MUST STAMP — NOT YET DELIVERED. No Containerfile in this
 * repository sets any of the labels below; `grep LABEL backend/Containerfile
 * frontend/Containerfile` returns nothing, and no build step emits a
 * manifest. So B1 and B2 are currently UNREACHABLE for both shipping images
 * and every container axis is INCOMPLETE by design, which a live
 * `certify --axis containers` confirms. The block below is the proposed
 * patch, stated so the verifier and the thing it verifies are described in
 * one place — it is a specification, not a description of the build:
 *
 *     ARG APP_GIT_SHA
 *     ARG OAA_CANDIDATE_ID
 *     LABEL org.opencontainers.image.revision="$APP_GIT_SHA" \
 *           io.oaa.candidate-id="$OAA_CANDIDATE_ID" \
 *           io.oaa.build-supplied-revision="true"
 *
 * `io.oaa.build-supplied-revision` is the positive marker that removes all
 * guesswork: with it present, the revision label is this build's by
 * declaration, not by heuristic. The heuristic in
 * imageIdentity.revisionLabelProvenance() remains for images built before the
 * patch, and remains fail-closed.
 *
 * ── PART 3: DIGESTS THAT ARE NOT THE SAME DIGEST ───────────────────────────
 *
 * Four distinct values, all verified on this host. Conflating any two
 * produces a report that looks precise and is wrong.
 *
 *   CONFIG   podman `.Id`. The sha256 of the image CONFIG blob. Verified: for
 *            aquasec/trivy, `.Id` = 6d93f1ec925b… and the exported manifest's
 *            `config.digest` = sha256:6d93f1ec925b… — the same value. This is
 *            the only digest that exists for a locally built, never-pushed
 *            image and is what a build manifest should bind.
 *
 *   MANIFEST podman `.Digest`. The sha256 of the image MANIFEST. For a PULLED
 *            image this is the registry digest it was pulled by (trivy:
 *            sha256:af6acf9a…55daa, exactly the pinned digest). For a LOCALLY
 *            BUILT image it is computed locally and has never been published.
 *
 *   REGISTRY entries in `.RepoDigests`, and only when the repository is a real
 *            registry. Verified that one image can carry SEVERAL: trivy has
 *            both sha256:9db09910… and sha256:af6acf9a… (one per manifest
 *            media type). Verified ALSO that podman SYNTHESISES a repo digest
 *            for a never-pushed local build — the backend image reports
 *            `localhost/openshift-airgap-architect-backend@sha256:eeec74ed…`,
 *            which is NOT a registry digest and must never be reported as
 *            one. `localhost/` is the marker.
 *
 *   EXPORT   the manifest digest INSIDE an exported OCI layout — what a
 *            scanner reading `--input` actually addresses. Verified to differ
 *            from all of the above: re-exporting trivy yields manifest digest
 *            sha256:6b0c412d73f5…, because podman re-serialises the manifest
 *            into OCI media types. A scan report naming "the image digest"
 *            without saying WHICH is therefore ambiguous by construction.
 */

import { REVISION_LABEL, CANDIDATE_LABEL } from "../lib/provenance.mjs";
import { revisionLabelProvenance } from "./imageIdentity.mjs";

/** Label a patched build sets to declare its revision label is its own. */
export const BUILD_SUPPLIED_REVISION_LABEL = "io.oaa.build-supplied-revision";

/** The four digest kinds, with what each is and is not. */
export const DIGEST_KINDS = Object.freeze({
  config: Object.freeze({
    source: "podman .Id",
    is: "sha256 of the image config blob",
    isNot: "not a registry digest; not the manifest digest",
    existsForLocalBuild: true,
  }),
  manifest: Object.freeze({
    source: "podman .Digest",
    is: "sha256 of the image manifest",
    isNot: "equals a registry digest only when the image was pulled, never when it was built locally",
    existsForLocalBuild: true,
  }),
  registry: Object.freeze({
    source: "podman .RepoDigests, excluding localhost/ entries",
    is: "digest the image is addressable by in a real registry; there may be more than one",
    isNot: "absent for an image that has never been pushed",
    existsForLocalBuild: false,
  }),
  export: Object.freeze({
    source: "index.json of an exported OCI layout",
    is: "manifest digest the scanner addresses when reading --input",
    isNot: "generally DIFFERENT from .Digest, because the manifest is re-serialised on export",
    existsForLocalBuild: true,
  }),
});

/** A repository reference that is not a real registry. */
export function isLocalOnlyRepository(repoDigest) {
  if (typeof repoDigest !== "string") return true;
  const repo = repoDigest.split("@")[0];
  return repo.startsWith("localhost/") || !repo.includes("/") || !repo.split("/")[0].includes(".");
}

/**
 * Sort an inspect payload's digests into the taxonomy, refusing to invent a
 * registry digest for an image that was never pushed.
 */
export function classifyDigests({ id = null, digest = null, repoDigests = [] } = {}) {
  const all = Array.isArray(repoDigests) ? repoDigests.filter((d) => typeof d === "string") : [];
  const registry = all.filter((d) => !isLocalOnlyRepository(d));
  const localOnly = all.filter((d) => isLocalOnlyRepository(d));

  return {
    config: id ? (id.startsWith("sha256:") ? id : `sha256:${id}`) : null,
    manifest: digest ?? null,
    registry,
    localOnlyRepoDigests: localOnly,
    published: registry.length > 0,
    note: registry.length
      ? null
      : "image has never been pushed: podman synthesises a localhost/ repo digest, which is NOT a registry digest",
  };
}

/**
 * Bind one image to one candidate. Reference implementation of the corrected
 * ordering; pure, so it is fully testable from fixtures.
 *
 * @returns {{bound:boolean, method:string|null, reason:string, observed:object}}
 */
export function bindImageToCandidate(image, candidate, manifestResult = { present: false }, { candidateRevisions } = {}) {
  const labels = image?.labels ?? {};
  const head = candidate?.git?.head ?? null;
  const candidateId = candidate?.candidateId ?? null;
  const dirty = candidate?.git?.clean === false;

  const revisionClass = revisionLabelProvenance(labels, {
    candidateRevisions: candidateRevisions ?? (head ? [head] : []),
  });
  const declaredBuildSupplied = String(labels[BUILD_SUPPLIED_REVISION_LABEL] ?? "").toLowerCase() === "true";

  const observed = {
    candidateLabel: labels[CANDIDATE_LABEL] ?? null,
    revisionLabel: labels[REVISION_LABEL] ?? null,
    revisionClassification: declaredBuildSupplied ? "build-supplied" : revisionClass.classification,
    revisionDeclaredBuildSupplied: declaredBuildSupplied,
    manifestPresent: Boolean(manifestResult?.present),
  };

  if (!image?.present) {
    return { role: image?.role, bound: false, method: null, reason: "image is not present locally", observed };
  }

  // --- B1: candidate label -------------------------------------------------
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

  // --- B2: revision label, but ONLY when this build supplied it -----------
  //
  // THE ORDERING FIX. An inherited label is not evidence about OAA, so it is
  // treated as absent and evaluation FALLS THROUGH to the manifest instead of
  // returning a verdict about Red Hat's build commit.
  const revisionIsOurs = declaredBuildSupplied || observed.revisionClassification === "build-supplied";
  if (observed.revisionLabel && revisionIsOurs) {
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
      return {
        role: image.role,
        bound: true,
        method: "oci-label:revision",
        reason: "image revision label was supplied by this build and matches HEAD of a clean candidate",
        observed,
      };
    }
    return {
      role: image.role,
      bound: false,
      method: null,
      reason: `image was built from a different revision (${String(observed.revisionLabel).slice(0, 12)}…)`,
      observed,
    };
  }

  // --- B3: build manifest --------------------------------------------------
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

  // --- Unbound. Say WHY precisely, naming the inherited label as inherited. -
  if (observed.revisionLabel && observed.revisionClassification === "inherited-base") {
    return {
      role: image.role,
      bound: false,
      method: null,
      reason:
        `no OAA provenance: the only ${REVISION_LABEL} present (${String(observed.revisionLabel).slice(0, 12)}…) was INHERITED ` +
        `from the base image ${revisionClass.baseImage ?? "(unknown)"} and does not describe an OAA build; ` +
        `no ${CANDIDATE_LABEL} and no build manifest were found`,
      observed,
    };
  }
  return {
    role: image.role,
    bound: false,
    method: null,
    reason: `no provenance: image carries neither ${REVISION_LABEL} nor ${CANDIDATE_LABEL}, and no build manifest was found`,
    observed,
  };
}
