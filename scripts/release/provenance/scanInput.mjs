/**
 * Scanner input conversion: OCI archive tar → verified OCI layout directory.
 *
 * THE DEFECT THIS CLOSES (verified by execution, 2026-10-14).
 *
 * `lib/images.mjs` exports every shipping image with
 * `podman save --format oci-archive`, producing a TAR whose members are
 * `oci-layout`, `index.json` and `blobs/sha256/*`. `axes/image-vulnerabilities.mjs`
 * then hands that tar to Trivy as `--input <path>`. Trivy REJECTS it. The
 * exact failure, reproduced against the pinned scanner
 * aquasec/trivy@sha256:af6acf9a…55daa (v0.75.0):
 *
 *   unable to initialize artifact: unable to initialize archive image: 2 errors occurred:
 *     * unable to open /scan/probe.oci.tar as a Docker image: file manifest.json not found in tar
 *     * unable to open /scan/probe.oci.tar as an OCI Image: stat /scan/probe.oci.tar/index.json: not a directory
 *
 * Trivy's `--input` accepts exactly two shapes: a DOCKER-ARCHIVE tar (which
 * contains `manifest.json` at the root — an OCI archive does not), or an OCI
 * layout DIRECTORY (it stats `<input>/index.json`, which cannot succeed on a
 * regular file). An OCI archive tar is neither, so the vulnerability axis
 * could never have produced a scan — it fails at artifact initialisation,
 * before any advisory is read.
 *
 * WHY CONVERT RATHER THAN RE-EXPORT. `podman save --format oci-dir` is a
 * valid format on podman 5.8.7 and its output scans correctly, so changing
 * the export format would also work. Conversion is chosen anyway, for three
 * reasons:
 *
 *   1. ONE ARTIFACT, PRESERVED. lib/images.mjs's governing rule is that the
 *      scanner and the SBOM generator consume the same bytes. Syft and Grype
 *      are invoked with the `oci-archive:` transport, which requires the tar.
 *      Re-exporting as a directory would force those transports to change
 *      too, and neither syft nor grype is installed on this host or pinned to
 *      a digest — so that change could not be verified by execution. Changing
 *      only the Trivy path keeps every unverifiable change out of the patch.
 *
 *   2. EXTRACTION IS PROVABLY LOSSLESS. The directory is a tar extraction of
 *      the archive, so it is the same bytes by construction, not a second
 *      export that merely ought to agree.
 *
 *   3. IT BUYS AN INTEGRITY CHECK THE TAR DOES NOT OFFER. In an OCI layout
 *      every blob's FILENAME IS ITS DIGEST. Once extracted, each blob can be
 *      re-hashed and checked against its own name — detecting a truncated or
 *      corrupted export before the scanner reads it. `verifyBlobDigests()`
 *      does exactly that. A tar handed straight to a scanner gets no such
 *      check.
 *
 * COST, STATED PLAINLY: the archive and its extraction coexist, so peak disk
 * is roughly double the image size (~1.3 GB backend + ~0.35 GB frontend ⇒
 * ~3.3 GB peak for the pair). `cleanup()` removes the extractions, and the
 * caller's existing `archives.cleanup()` removes the tars.
 *
 * FAIL CLOSED, ALWAYS. Every failure path — missing archive, tar exit
 * non-zero, absent `oci-layout`, unrecognised `imageLayoutVersion`, missing
 * or unparseable `index.json`, empty `manifests`, a blob whose content does
 * not match its filename — returns `{ ok: false, reason }`. Nothing here
 * returns a usable path it has not validated, and no caller may treat an
 * unconvertible input as a skip: an input that cannot be converted is a hard
 * scan failure, because the alternative is reporting PASS for an image that
 * was never read.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../lib/exec.mjs";

/** The only OCI image-layout version this converter recognises. */
export const SUPPORTED_LAYOUT_VERSION = "1.0.0";

/** Digest algorithms whose blob filenames this module can verify. */
export const VERIFIABLE_ALGORITHMS = Object.freeze(["sha256", "sha512"]);

/**
 * Validate an extracted OCI layout directory.
 *
 * Structural only — it does not hash blobs; see `verifyBlobDigests`. Pure
 * with respect to everything except the filesystem it is pointed at, so it is
 * testable against synthetic layouts with no container engine.
 *
 * @returns {{ok:true, layoutVersion:string, manifests:object[]}|{ok:false, reason:string}}
 */
export function validateOciLayout(dir) {
  if (!dir || typeof dir !== "string") return { ok: false, reason: "no layout directory given" };

  let st;
  try {
    st = fs.statSync(dir);
  } catch (err) {
    return { ok: false, reason: `layout directory is not readable: ${err.message}` };
  }
  if (!st.isDirectory()) {
    // This is precisely the shape Trivy rejects, so name it unambiguously.
    return { ok: false, reason: `${dir} is a file, not an OCI layout directory` };
  }

  const layoutFile = path.join(dir, "oci-layout");
  if (!fs.existsSync(layoutFile)) {
    return { ok: false, reason: "not an OCI layout: oci-layout marker file is absent" };
  }
  let layout;
  try {
    layout = JSON.parse(fs.readFileSync(layoutFile, "utf8"));
  } catch (err) {
    return { ok: false, reason: `unparseable oci-layout: ${err.message}` };
  }
  const layoutVersion = layout?.imageLayoutVersion ?? null;
  if (layoutVersion !== SUPPORTED_LAYOUT_VERSION) {
    // An unknown layout version is refused rather than attempted: guessing at
    // a format the scanner may read differently is how silent mis-scans start.
    return { ok: false, reason: `unsupported imageLayoutVersion ${JSON.stringify(layoutVersion)}; expected ${SUPPORTED_LAYOUT_VERSION}` };
  }

  const indexFile = path.join(dir, "index.json");
  if (!fs.existsSync(indexFile)) {
    return { ok: false, reason: "not an OCI layout: index.json is absent" };
  }
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  } catch (err) {
    return { ok: false, reason: `unparseable index.json: ${err.message}` };
  }
  const manifests = Array.isArray(index?.manifests) ? index.manifests : null;
  if (!manifests) return { ok: false, reason: "index.json carries no manifests array" };
  if (!manifests.length) return { ok: false, reason: "index.json lists zero manifests; there is nothing to scan" };

  return { ok: true, layoutVersion, manifests };
}

/**
 * Re-hash every blob and check it against its own filename.
 *
 * In an OCI layout `blobs/<alg>/<hex>` is content-addressed, so the filename
 * is a checksum the export itself supplied. Mismatch means the artifact about
 * to be scanned is not the artifact that was exported.
 *
 * Blobs under an algorithm this module cannot compute are REPORTED as
 * unverified rather than silently passed, so the evidence distinguishes
 * "checked and correct" from "not checked".
 *
 * @returns {{ok:true, verified:number, unverified:object[], bytes:number}
 *          |{ok:false, reason:string, mismatches:object[]}}
 */
export function verifyBlobDigests(dir) {
  const blobRoot = path.join(dir, "blobs");
  if (!fs.existsSync(blobRoot)) return { ok: false, reason: "OCI layout has no blobs/ directory", mismatches: [] };

  const mismatches = [];
  const unverified = [];
  let verified = 0;
  let bytes = 0;

  let algs;
  try {
    algs = fs.readdirSync(blobRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch (err) {
    return { ok: false, reason: `blobs/ is not readable: ${err.message}`, mismatches: [] };
  }
  if (!algs.length) return { ok: false, reason: "blobs/ contains no algorithm directories", mismatches: [] };

  for (const algDir of algs) {
    const alg = algDir.name;
    const dirPath = path.join(blobRoot, alg);
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true }).filter((d) => d.isFile());
    } catch (err) {
      return { ok: false, reason: `blobs/${alg} is not readable: ${err.message}`, mismatches: [] };
    }

    if (!VERIFIABLE_ALGORITHMS.includes(alg)) {
      for (const e of entries) unverified.push({ algorithm: alg, name: e.name, reason: `unsupported digest algorithm "${alg}"` });
      continue;
    }

    for (const entry of entries) {
      const file = path.join(dirPath, entry.name);
      let actual;
      try {
        actual = createHash(alg).update(fs.readFileSync(file)).digest("hex");
      } catch (err) {
        mismatches.push({ algorithm: alg, expected: entry.name, actual: null, reason: `unreadable: ${err.message}` });
        continue;
      }
      bytes += fs.statSync(file).size;
      if (actual !== entry.name) {
        mismatches.push({ algorithm: alg, expected: entry.name, actual });
        continue;
      }
      verified += 1;
    }
  }

  if (mismatches.length) {
    const shown = mismatches.slice(0, 3).map((m) => `${m.algorithm}:${String(m.expected).slice(0, 12)}…`).join(", ");
    return {
      ok: false,
      reason: `${mismatches.length} blob(s) do not match their content address (${shown}); the exported artifact is corrupt`,
      mismatches,
    };
  }
  if (!verified && unverified.length) {
    return { ok: false, reason: `no blob could be verified; all ${unverified.length} use unsupported algorithms`, mismatches: [] };
  }

  return { ok: true, verified, unverified, bytes };
}

/**
 * Extract an OCI archive tar into `destDir`.
 *
 * `tar` is invoked with the archive as an ARGUMENT and `-C destDir`; nothing
 * is interpreted from inside the archive. `--no-same-owner` keeps extraction
 * working unprivileged.
 */
export function extractArchive(archivePath, destDir, { runner = run, timeoutMs = 15 * 60_000 } = {}) {
  if (!archivePath || !fs.existsSync(archivePath)) {
    return { ok: false, reason: `OCI archive ${archivePath ?? "(none)"} does not exist` };
  }
  fs.mkdirSync(destDir, { recursive: true });
  const res = runner("tar", ["-xf", archivePath, "-C", destDir, "--no-same-owner"], { timeoutMs });
  if (res.spawnError) return { ok: false, reason: `could not execute tar: ${res.spawnError}` };
  if (res.timedOut) return { ok: false, reason: `tar extraction timed out after ${timeoutMs}ms` };
  if (res.status !== 0) {
    return { ok: false, reason: (res.stderr || "").trim().split("\n").slice(-1)[0] || `tar exited ${res.status}` };
  }
  return { ok: true };
}

/**
 * Convert one OCI archive tar into a validated OCI layout directory.
 *
 * @returns {{ok:true, path:string, layoutVersion:string, manifests:object[], blobs:object}
 *          |{ok:false, reason:string}}
 */
export function convertArchiveToLayout(archivePath, destDir, { runner = run, verifyBlobs = true, timeoutMs } = {}) {
  const extracted = extractArchive(archivePath, destDir, { runner, ...(timeoutMs ? { timeoutMs } : {}) });
  if (!extracted.ok) return { ok: false, reason: `extraction failed: ${extracted.reason}` };

  const layout = validateOciLayout(destDir);
  if (!layout.ok) return { ok: false, reason: `extracted tree is not a usable OCI layout: ${layout.reason}` };

  let blobs = { verified: null, skipped: true, reason: "blob verification disabled by caller" };
  if (verifyBlobs) {
    const v = verifyBlobDigests(destDir);
    if (!v.ok) return { ok: false, reason: v.reason };
    blobs = { verified: v.verified, unverified: v.unverified, bytes: v.bytes, skipped: false };
  }

  return { ok: true, path: destDir, layoutVersion: layout.layoutVersion, manifests: layout.manifests, blobs };
}

/**
 * Transport strings, so no call site hand-builds one.
 *
 * `trivy` is VERIFIED against the pinned scanner: an OCI layout directory
 * passed to `--input` scans successfully. The `oci-dir:` forms for syft and
 * grype are the documented transports for a layout directory but are NOT
 * verified here — neither tool is installed on this host and neither has an
 * approved pinned digest — so they are marked `verified: false` and no patch
 * in this tranche switches those call sites onto them.
 */
export const TRANSPORTS = Object.freeze({
  trivy: Object.freeze({ build: (dir) => dir, flag: "--input", verified: true }),
  grype: Object.freeze({ build: (dir) => `oci-dir:${dir}`, flag: null, verified: false }),
  syft: Object.freeze({ build: (dir) => `oci-dir:${dir}`, flag: null, verified: false }),
});

/**
 * Run-scoped store of converted scan inputs.
 *
 * Mirrors `ImageArchives`: convert each image at most once per run, hand the
 * same directory to every consumer, and delete the lot in the orchestrator's
 * `finally`. Failures are CACHED as failures, so a second consumer gets the
 * same hard error rather than retrying a conversion already known to be
 * broken.
 */
export class ScanInputs {
  constructor({ tmpRoot = os.tmpdir(), runner = run, verifyBlobs = true } = {}) {
    this.dir = fs.mkdtempSync(path.join(tmpRoot, "oaa-scan-inputs-"));
    this.runner = runner;
    this.verifyBlobs = verifyBlobs;
    this.byKey = new Map();
  }

  /**
   * Layout directory for an already-exported archive.
   *
   * @param {string} key    stable per-image key (the resolved image id)
   * @param {string} archivePath path returned by ImageArchives.archiveFor()
   */
  layoutFor(key, archivePath) {
    if (!key) return { ok: false, reason: "no image key given" };
    if (this.byKey.has(key)) return { ...this.byKey.get(key), reused: true };

    const dest = path.join(this.dir, key.replace(/[^A-Za-z0-9_.-]/g, "_"));
    const outcome = convertArchiveToLayout(archivePath, dest, { runner: this.runner, verifyBlobs: this.verifyBlobs });
    this.byKey.set(key, outcome);
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
