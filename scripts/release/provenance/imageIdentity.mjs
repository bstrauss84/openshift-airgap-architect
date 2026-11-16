/**
 * Immutable identity of a shipping container image.
 *
 * WHAT THIS IS FOR. `lib/images.mjs` already resolves a tag to an image ID so
 * that every axis in one run certifies the same artifact. That answers "the
 * same as what?" but not "which artifact, recorded how?". A certification
 * record has to be readable a year later, from a different host, with the
 * local image store long since pruned, and still name exactly what was
 * certified. So identity is captured as a closed, explicitly-enumerated set of
 * fields, digested, and reported as one record.
 *
 * THE INHERITED-LABEL TRAP, which is the reason this module exists at all.
 *
 * `lib/provenance.mjs` accepts `org.opencontainers.image.revision` as proof A
 * that an image was built from the candidate. Both OAA Containerfiles build
 * `FROM registry.access.redhat.com/ubi9/...`, and those Red Hat base images
 * ALREADY SET that label — to the revision of Red Hat's own container-build
 * git repository. Image config labels are inherited by the derived image, so
 * both shipping images carry a revision label that has nothing to do with OAA:
 *
 *   backend  org.opencontainers.image.revision = e573c6075f71… (= vcs-ref, ubi9/nodejs-22)
 *   frontend org.opencontainers.image.revision = 24d2029ef4cc… (= vcs-ref, ubi9/nginx-124)
 *
 * Two consequences, both bad, neither currently visible in a summary:
 *
 *   1. MISLEADING DIAGNOSIS. On a clean candidate the harness reports "image
 *      was built from a different revision (e573c6075f71…)". No such OAA
 *      revision exists. The operator is sent to look for a stale build that
 *      was never made.
 *
 *   2. PROOF B IS UNREACHABLE. `verifyImageProvenance` returns from the
 *      revision-label branch before it ever consults the build manifest. A
 *      correct, candidate-naming `release-build-manifest.json` therefore
 *      CANNOT bind these images while the inherited label is present. The
 *      fallback proof the harness documents does not function for the only
 *      two images it is meant to certify.
 *
 * `revisionLabelProvenance()` below distinguishes an inherited base-image
 * label from a real OAA build label, by the signature Red Hat's images leave:
 * the revision equals `vcs-ref`, and `com.redhat.component` / `name` /
 * `vendor` describe a base image rather than this product. It is a
 * CLASSIFIER, not a fix — the fix is a one-line LABEL in each Containerfile
 * plus an ordering change in lib/provenance.mjs, and both live in tracked
 * files this module does not touch.
 *
 * FAIL CLOSED. No engine, image absent, unparseable inspect output: every one
 * returns `{ ok: false, reason }`. Nothing here ever returns a partially
 * populated identity that could read as a successful resolution.
 */

import { createHash } from "node:crypto";
import { run, hasTool } from "../lib/exec.mjs";
import { REVISION_LABEL, CANDIDATE_LABEL } from "../lib/provenance.mjs";

/**
 * The closed set of fields that constitute recorded image identity.
 *
 * Enumerated rather than "whatever inspect returned", for two reasons: the
 * identity digest must not move when a podman upgrade adds a field, and a
 * reader of the evidence must be able to tell what was deliberately recorded
 * from what happened to be present.
 */
export const IDENTITY_FIELDS = Object.freeze([
  "id",
  "digest",
  "repoDigests",
  "created",
  "architecture",
  "os",
  "sizeBytes",
  "user",
  "cmd",
  "entrypoint",
  "exposedPorts",
]);

/** Red Hat base-image labels that identify the BASE, not the derived product. */
export const BASE_IMAGE_LABELS = Object.freeze([
  "name",
  "version",
  "release",
  "com.redhat.component",
  "vcs-ref",
  "vcs-type",
  "vendor",
  "architecture",
  "build-date",
  "cpe",
]);

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === "string" ? v : null);

/**
 * Normalise one `image inspect` payload into an identity record.
 *
 * Pure, so the whole classification surface is testable from fixtures with no
 * container engine present. Accepts either the bare object or the
 * single-element array podman and docker both emit.
 */
export function parseInspect(raw) {
  const data = Array.isArray(raw) ? raw[0] : raw;
  if (!data || typeof data !== "object") {
    return { ok: false, reason: "inspect payload is not an object" };
  }
  const cfg = data.Config ?? {};
  // Podman reports labels under Config.Labels; some engines also surface them
  // at the top level. Read both, top level last, matching lib/images.mjs.
  const labels = { ...(data.Labels ?? {}), ...(cfg.Labels ?? {}) };

  const identity = {
    id: str(data.Id),
    digest: str(data.Digest),
    repoDigests: arr(data.RepoDigests).filter((d) => typeof d === "string").sort(),
    created: str(data.Created),
    architecture: str(data.Architecture),
    os: str(data.Os),
    sizeBytes: typeof data.Size === "number" ? data.Size : null,
    user: typeof cfg.User === "string" ? cfg.User : "",
    cmd: arr(cfg.Cmd),
    entrypoint: arr(cfg.Entrypoint),
    exposedPorts: Object.keys(cfg.ExposedPorts ?? {}).sort(),
  };

  // An image with no ID is not an identity. Refuse rather than record a
  // record whose primary key is null.
  if (!identity.id) return { ok: false, reason: "inspect payload carries no image Id" };

  return { ok: true, identity, labels };
}

/**
 * Describe the base image, from the labels it left behind.
 *
 * This is INFERENCE FROM INHERITED METADATA, not a parsed Containerfile and
 * not a resolved parent digest. It is reported as such: `method` says where
 * each field came from so no reader mistakes it for a verified base-image
 * reference. Podman does not retain the parent image digest for a squashed or
 * imported image, so there is no stronger signal available locally.
 */
export function describeBaseImage(labels = {}) {
  const name = str(labels.name);
  const version = str(labels.version);
  const release = str(labels.release);
  const component = str(labels["com.redhat.component"]);

  if (!name && !component) {
    return {
      identified: false,
      method: "none",
      reason: "no base-image labels present; base image cannot be inferred from the built artifact",
    };
  }
  return {
    identified: true,
    method: "inherited-label-inference",
    caution: "inferred from labels the base image left in the config; NOT a verified parent digest",
    name,
    component,
    nvr: name && version && release ? `${name}:${version}-${release}` : null,
    buildDate: str(labels["build-date"]),
    vendor: str(labels.vendor),
    cpe: str(labels.cpe),
    vcsRef: str(labels["vcs-ref"]),
  };
}

/**
 * Classify the revision label: is it this product's, or the base image's?
 *
 * Returns one of:
 *   "absent"            no revision label at all
 *   "inherited-base"    the label describes the base image, not this build
 *   "build-supplied"    the label was set by this product's build
 *
 * The inherited signature is `revision === vcs-ref`. Red Hat's container
 * build system writes both from the same source commit, and nothing in the
 * OAA Containerfiles writes `vcs-ref`, so equality is a reliable marker of an
 * untouched inherited pair. Absent a `vcs-ref`, a revision label with
 * base-image provenance labels beside it and no OAA candidate label is still
 * reported as suspect rather than trusted: fail closed.
 */
export function revisionLabelProvenance(labels = {}, context = {}) {
  const revision = str(labels[REVISION_LABEL]);
  if (!revision) return { classification: "absent", revision: null };

  const vcsRef = str(labels["vcs-ref"]);

  /*
   * POSITIVE EVIDENCE BEATS THE HEURISTIC, and closes a false negative the
   * heuristic alone cannot avoid.
   *
   * The fallback rule below reports "inherited-base" whenever four or more
   * base-image labels sit beside the revision and no candidate label is
   * present. Both UBI bases always supply far more than four, so once the
   * Containerfile patch lands and a CLEAN build stamps a real OAA commit into
   * `org.opencontainers.image.revision` WITHOUT a candidate label (correct —
   * a clean candidate needs no candidate id, see lib/provenance.mjs), the
   * heuristic would misclassify that genuine build-supplied revision as
   * inherited. Fail-closed is the right default when nothing better is known,
   * but it must not override knowledge that IS available.
   *
   * `context.candidateRevisions` carries the revisions this candidate could
   * legitimately have been built from — normally just HEAD. A revision that
   * matches one of them was demonstrably not inherited from Red Hat's build
   * system, so it is classified build-supplied on positive evidence. Omitting
   * the context preserves the previous conservative behaviour exactly.
   */
  const candidateRevisions = Array.isArray(context.candidateRevisions) ? context.candidateRevisions.filter(Boolean) : [];
  if (candidateRevisions.includes(revision) && revision !== vcsRef) {
    return {
      classification: "build-supplied",
      revision,
      evidence: "revision matches a revision of the candidate under certification and differs from the base image's vcs-ref",
      basis: "positive-candidate-match",
    };
  }

  if (vcsRef && vcsRef === revision) {
    // A candidate label alongside an inherited revision still means the image
    // IS bound — just not by this label. Say so, rather than implying the
    // image is unbindable.
    const candidateLabel = str(labels[CANDIDATE_LABEL]);
    if (candidateLabel) {
      return {
        classification: "inherited-base",
        revision,
        evidence: `${REVISION_LABEL} is identical to vcs-ref (${vcsRef.slice(0, 12)}…), so the revision label itself is the base image's`,
        baseImage: str(labels.name),
        consequence: `the revision label cannot bind this image, but ${CANDIDATE_LABEL} is present and binds it independently`,
        supersededByCandidateLabel: true,
      };
    }
  }
  if (vcsRef && vcsRef === revision) {
    return {
      classification: "inherited-base",
      revision,
      evidence: `${REVISION_LABEL} is identical to vcs-ref (${vcsRef.slice(0, 12)}…), the base image's own source revision`,
      baseImage: str(labels.name),
      consequence:
        "lib/provenance.mjs treats this as proof A and returns before consulting the build manifest, so proof B is unreachable for this image",
    };
  }

  const baseSignals = BASE_IMAGE_LABELS.filter((l) => labels[l] !== undefined);
  if (!labels[CANDIDATE_LABEL] && baseSignals.length >= 4) {
    return {
      classification: "inherited-base",
      revision,
      evidence: `no ${CANDIDATE_LABEL}, and ${baseSignals.length} base-image labels are present (${baseSignals.join(", ")})`,
      baseImage: str(labels.name),
      consequence: "cannot be distinguished from an inherited base-image revision; treated as inherited, which is the safe direction",
    };
  }

  return { classification: "build-supplied", revision };
}

/** Stable digest over the enumerated identity fields. Key-order independent. */
export function identityDigest(identity) {
  const h = createHash("sha256");
  for (const field of IDENTITY_FIELDS) {
    h.update(field);
    h.update("\0");
    h.update(JSON.stringify(identity?.[field] ?? null));
    h.update("\0");
  }
  return h.digest("hex");
}

/** Which container engine will be used, if any. */
export function selectEngine({ podman = hasTool("podman"), docker = hasTool("docker") } = {}) {
  if (podman) return "podman";
  if (docker) return "docker";
  return null;
}

/**
 * Resolve the full identity record for one image reference.
 *
 * `runner` is injected so the orchestration is testable without an engine;
 * production callers leave it at the default.
 *
 * @returns {{ok:true, ref:string, engine:string, identity:object, identityDigest:string,
 *            labels:object, baseImage:object, revisionLabel:object, candidateLabel:string|null}
 *          | {ok:false, ref:string, reason:string}}
 */
export function resolveImageIdentity(ref, { engine = selectEngine(), runner = run, timeoutMs = 120_000 } = {}) {
  if (!ref || typeof ref !== "string") return { ok: false, ref: ref ?? null, reason: "no image reference given" };
  if (!engine) return { ok: false, ref, reason: "no container engine (podman/docker) available" };

  const res = runner(engine, ["image", "inspect", ref, "--format", "json"], { timeoutMs });
  if (res.spawnError) return { ok: false, ref, engine, reason: `could not execute ${engine}: ${res.spawnError}` };
  if (res.timedOut) return { ok: false, ref, engine, reason: `${engine} image inspect timed out after ${timeoutMs}ms` };
  if (res.status !== 0) {
    return { ok: false, ref, engine, reason: (res.stderr || "").trim().split("\n")[0] || `${engine} image inspect exited ${res.status}` };
  }

  let payload;
  try {
    payload = JSON.parse(res.stdout);
  } catch (err) {
    return { ok: false, ref, engine, reason: `unparseable inspect output: ${err.message}` };
  }

  const parsed = parseInspect(payload);
  if (!parsed.ok) return { ok: false, ref, engine, reason: parsed.reason };

  return {
    ok: true,
    ref,
    engine,
    identity: parsed.identity,
    identityDigest: identityDigest(parsed.identity),
    labels: parsed.labels,
    baseImage: describeBaseImage(parsed.labels),
    revisionLabel: revisionLabelProvenance(parsed.labels),
    candidateLabel: str(parsed.labels[CANDIDATE_LABEL]),
  };
}

/**
 * Resolve the complete expected set, refusing a partial answer.
 *
 * A half-resolved set is never `ok`: recording identity for one of two
 * shipping images and calling it an identity record repeats exactly the
 * "certify half a release" failure lib/images.mjs guards against.
 */
export function resolveIdentitySet(refsByRole, opts = {}) {
  const engine = opts.engine ?? selectEngine();
  const entries = Object.entries(refsByRole ?? {});
  if (!entries.length) return { ok: false, reason: "no image roles requested", engine, images: [] };

  const images = entries.map(([role, ref]) => ({ role, ...resolveImageIdentity(ref, { ...opts, engine }) }));
  const failed = images.filter((i) => !i.ok);

  return {
    ok: failed.length === 0,
    engine,
    reason: failed.length ? `identity unresolved for: ${failed.map((f) => `${f.role} (${f.reason})`).join("; ")}` : null,
    images,
  };
}
