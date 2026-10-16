/**
 * Shipping-image resolution and the run-scoped archive lifecycle.
 *
 * THREE REQUIREMENTS, all of which the container axes depend on.
 *
 * 1. ONE RESOLUTION PER RUN. Image *tags* do not identify an artifact:
 *    `localhost/...:latest` names whatever was built last, and a rebuild
 *    between two axes would have them certify different artifacts under one
 *    summary. Resolution happens once; axes address images by ID.
 *
 * 2. THE COMPLETE SET. `backend` and `frontend` are both shipped. Scanning
 *    whichever happens to exist locally and reporting PASS would certify half
 *    a release, so a missing required role blocks every image axis.
 *
 * 3. ONE EXACT ARTIFACT FOR EVERY STRATEGY. The scanner and the SBOM
 *    generator must consume the same bytes, and those bytes must be the ones
 *    auditable later. Both therefore read an OCI archive exported from the
 *    resolved image ID, rather than each reaching into the local image store
 *    with its own auto-detection. These images are 0.3-1.3 GB, so the export
 *    is done ONCE per run and shared, then deleted when the run ends.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, hasTool } from "./exec.mjs";

/** Every role that ships. A release is not certified unless all are. */
export const REQUIRED_ROLES = Object.freeze(["backend", "frontend"]);

export const DEFAULT_IMAGES = Object.freeze([
  {
    role: "backend",
    ref: process.env.RUNTIME_PACKAGE_BACKEND_IMAGE || "localhost/openshift-airgap-architect-backend:latest",
    containerfile: "backend/Containerfile",
  },
  {
    role: "frontend",
    ref: process.env.RUNTIME_PACKAGE_FRONTEND_IMAGE || "localhost/openshift-airgap-architect-frontend:latest",
    containerfile: "frontend/Containerfile",
  },
]);

export function containerEngine() {
  if (hasTool("podman")) return "podman";
  if (hasTool("docker")) return "docker";
  return null;
}

/**
 * Inspect one image, returning its full identity or an explanation.
 *
 * `RepoDigests` is recorded when present but is frequently empty for locally
 * built images that were never pushed — that absence is itself reportable
 * provenance, not an error.
 */
export function inspectImage(engine, ref) {
  const res = run(engine, ["image", "inspect", ref, "--format", "json"], { timeoutMs: 120_000 });
  if (res.status !== 0) {
    return { ref, present: false, reason: res.stderr.trim().split("\n")[0] || `exit ${res.status}` };
  }
  let data;
  try {
    const parsed = JSON.parse(res.stdout);
    data = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (err) {
    return { ref, present: false, reason: `unparseable inspect output: ${err.message}` };
  }
  const cfg = data?.Config ?? {};
  return {
    ref,
    present: true,
    id: data?.Id ?? null,
    repoDigests: data?.RepoDigests ?? [],
    created: data?.Created ?? null,
    architecture: data?.Architecture ?? null,
    os: data?.Os ?? null,
    size: data?.Size ?? null,
    user: cfg.User ?? "",
    exposedPorts: Object.keys(cfg.ExposedPorts ?? {}),
    env: cfg.Env ?? [],
    cmd: cfg.Cmd ?? [],
    entrypoint: cfg.Entrypoint ?? [],
    // Podman reports labels on Config.Labels; some engines also surface them at
    // the top level. Provenance verification depends on these, so read both.
    labels: { ...(data?.Labels ?? {}), ...(cfg.Labels ?? {}) },
    parent: data?.Parent ?? null,
  };
}

/** Resolve every shipping image once, so all axes certify the same artifacts. */
export function resolveShippingImages(images = DEFAULT_IMAGES) {
  const engine = containerEngine();
  if (!engine) {
    return { engine: null, images: images.map((i) => ({ ...i, present: false, reason: "no container engine" })) };
  }
  return {
    engine,
    engineVersion: run(engine, ["--version"], { timeoutMs: 30_000 }).stdout.trim(),
    images: images.map((i) => ({ ...i, ...inspectImage(engine, i.ref) })),
  };
}

/** Run a command inside an image, addressed by ID. Used for filesystem assertions. */
export function runInImage(engine, imageId, argv, { timeoutMs = 120_000 } = {}) {
  return run(engine, ["run", "--rm", "--network=none", "--entrypoint", argv[0], imageId, ...argv.slice(1)], {
    timeoutMs,
  });
}

/**
 * Run-scoped OCI archive store.
 *
 * Exports each image at most once per run and hands the same path to every
 * consumer. `cleanup()` is called from the orchestrator's `finally`, so the
 * multi-gigabyte archives do not outlive the run even when an axis throws —
 * a certification harness must not leak the resources it criticises.
 */
export class ImageArchives {
  constructor(engine, { tmpRoot = os.tmpdir() } = {}) {
    this.engine = engine;
    this.dir = fs.mkdtempSync(path.join(tmpRoot, "oaa-certify-archives-"));
    this.byId = new Map();
  }

  /**
   * Export `image` to an OCI archive, or return the already-exported path.
   * @returns {{ok: true, path: string, reused: boolean} | {ok: false, reason: string}}
   */
  archiveFor(image) {
    if (!this.engine) return { ok: false, reason: "no container engine" };
    if (!image?.present || !image.id) return { ok: false, reason: `image ${image?.ref} is not present` };
    if (this.byId.has(image.id)) return { ...this.byId.get(image.id), reused: true };

    const dest = path.join(this.dir, `${image.role}.oci`);
    const res = run(this.engine, ["save", "--format", "oci-archive", "-o", dest, image.id], { timeoutMs: 30 * 60_000 });
    const outcome =
      res.status === 0
        ? { ok: true, path: dest }
        : { ok: false, reason: (res.stderr || res.stdout).trim().split("\n").slice(-1)[0] || `exit ${res.status}` };
    this.byId.set(image.id, outcome);
    return { ...outcome, reused: false };
  }

  cleanup() {
    try {
      fs.rmSync(this.dir, { recursive: true, force: true });
    } catch {
      /* best effort: a leftover temp dir must not fail an otherwise complete run */
    }
  }
}
