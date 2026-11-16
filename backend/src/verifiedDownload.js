/**
 * OpenShift Airgap Architect - Verified external artifact acquisition
 *
 * Fail-closed download of external artifacts (openshift-install, mirror-registry)
 * against the publishing channel's own `sha256sum.txt` manifest.
 *
 * WHY THIS MODULE EXISTS
 *
 * `backend/src/ocMirrorRuntime.js` already acquires `oc` and `oc-mirror` this way
 * (resolve -> verify -> extract, see acquireVerifiedTool), and the backend
 * Containerfile does the same at build time. `openshift-install` and
 * `mirror-registry` did NOT: they were fetched over the network and accepted on a
 * non-zero file size alone. `docs/security/SBOM_AND_PROVENANCE.md` records that
 * gap in `verificationGaps`. This module closes it using the same contract, so
 * there is one acquisition policy rather than three.
 *
 * Two things here are deliberately NOT a copy of ocMirrorRuntime.js:
 *
 *   1. The digest is computed by STREAMING the file. `ocMirrorRuntime.sha256File`
 *      uses `fs.readFileSync`, which is fine for a ~100 MB `oc` tarball and wrong
 *      for mirror-registry: that artifact is 1.19 GiB (measured content-length
 *      1280705659 on 2026-10-16), and reading it into a Buffer to hash it would
 *      reintroduce exactly the allocation this change removes.
 *   2. The manifest URL is a parameter, not derived from the openshift-v4 client
 *      layout. mirror-registry lives under /pub/cgw/, not /pub/openshift-v4/, and
 *      both its manifest and its tarball answer 307 to a token-signed CDN URL.
 *
 * SCOPE: this is SHA256 manifest verification, which is what the mirror actually
 * publishes alongside the artifact over the same TLS origin. It is NOT a
 * signature check. `sha256sum.txt.gpg` and `.asc` detached signatures do exist on
 * the mirror, but verifying them requires pinning a Red Hat signing key as a trust
 * anchor, which is a human decision and is deliberately not taken here. Nothing in
 * this file may be described as signature verification.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

/** Suffix of the sidecar that records the digest a cached artifact was verified against. */
const DIGEST_SIDECAR_SUFFIX = ".sha256";

/**
 * In-flight acquisitions, keyed by RESOLVED destination path.
 *
 * Process-local by construction, which is the scope of the defect this closes:
 * the collision observed was two downloads inside one server process. Two
 * separate processes sharing a DATA_DIR volume are still serialised only by
 * the unique staging name and the atomic rename — they cannot corrupt each
 * other's bytes, but they can each perform the transfer. That residual is
 * stated rather than papered over with a lock file, whose stale-lock recovery
 * would be a worse failure mode for an offline tool than a duplicated fetch.
 */
const inFlightAcquisitions = new Map();

/**
 * Parse a `sha256sum.txt` into { fileName -> digest }.
 *
 * Accepts the GNU coreutils shapes the mirror actually publishes: `<hex>  <name>`
 * (two spaces, text mode) and `<hex> *<name>` (binary mode). Anything else on the
 * line is ignored rather than guessed at, and a manifest that parses to zero
 * entries is treated as unparseable by the callers below.
 */
function parseSha256Manifest(text) {
  const entries = new Map();
  if (typeof text !== "string") return entries;
  for (const rawLine of text.split("\n")) {
    const match = rawLine.match(/^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$/);
    if (match) entries.set(match[2], match[1].toLowerCase());
  }
  return entries;
}

/** Fetch and parse a checksum manifest. Throws on transport or parse failure. */
async function fetchSha256Manifest(manifestUrl, { fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(manifestUrl, { redirect: "follow" });
  } catch (err) {
    throw new Error(`Could not fetch checksum manifest ${manifestUrl}: ${err?.message || err}`);
  }
  if (!res.ok) {
    throw new Error(`Could not fetch checksum manifest ${manifestUrl}: HTTP ${res.status}`);
  }
  const manifest = parseSha256Manifest(await res.text());
  if (manifest.size === 0) {
    throw new Error(`Checksum manifest ${manifestUrl} contained no usable SHA256 entries`);
  }
  return manifest;
}

/** Look up one artifact's expected digest. Throws when the manifest does not name it. */
function expectedDigestFor(manifest, fileName, manifestUrl) {
  const digest = manifest.get(fileName);
  if (!digest) {
    throw new Error(`No SHA256 entry for ${fileName} in ${manifestUrl}`);
  }
  return digest;
}

/**
 * SHA256 of a file, computed by streaming it.
 *
 * Never use readFileSync here: the largest artifact this runs against is 1.19 GiB.
 */
async function sha256OfFile(filePath) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

/**
 * A staging name no other transfer can collide with.
 *
 * The pid alone was NOT enough, and that was a real defect rather than a
 * theoretical one. `${destPath}.part-${process.pid}` is a CONSTANT within one
 * server process, so two overlapping acquisitions of the same artifact wrote
 * into the same staging file and whichever renamed second failed with
 * `ENOENT ... rename`. Concurrent `/api/bundle` exports reach this trivially.
 *
 * The pid is kept because it identifies the owner of an orphan left by a hard
 * kill; the UUID is what makes the name unique, including across processes
 * sharing a DATA_DIR volume.
 */
function stagingPathFor(destPath) {
  return `${destPath}.part-${process.pid}-${randomUUID()}`;
}

/**
 * Refuse a cache location that is not a plain file.
 *
 * `rename` onto a symlink replaces the LINK, so it does not write through to
 * the target — but a symlink standing at a cache path is not something this
 * module should quietly destroy either, and reading one back on the cache path
 * below WOULD follow it. `lstat`, not `stat`: the point is to see the link.
 * A missing path is fine; that is the normal first-acquisition case.
 */
async function assertUsableDestination(destPath) {
  let stat;
  try {
    stat = await fs.promises.lstat(destPath);
  } catch (err) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  if (!stat.isFile()) {
    const kind = stat.isSymbolicLink() ? "a symlink" : stat.isDirectory() ? "a directory" : "not a regular file";
    throw new Error(
      `Refusing to use cache destination ${destPath}: it is ${kind}, not a regular file.`
    );
  }
}

/**
 * Stream a URL to a caller-chosen staging path. Never publishes.
 *
 * The response body is piped, never buffered. The previous mirror-registry path
 * did `Buffer.from(await response.arrayBuffer())`, which holds the whole artifact
 * in memory twice — about 2.4 GiB of peak allocation for a single export.
 */
async function streamToStaging(url, stagingPath, { fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { redirect: "follow" });
  } catch (err) {
    throw new Error(`Download failed for ${url}: ${err?.message || err}`);
  }
  if (!res.ok) {
    throw new Error(`Download failed for ${url}: HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error(`Download failed for ${url}: response carried no body`);
  }
  await fs.promises.mkdir(path.dirname(stagingPath), { recursive: true });
  try {
    await pipeline(res.body, createWriteStream(stagingPath));
  } catch (err) {
    await fs.promises.rm(stagingPath, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Stream a URL to disk, publishing atomically on success.
 *
 * Retained for callers that want bytes on disk without manifest verification.
 * `acquireVerifiedArtifact` deliberately does NOT use this: it verifies the
 * staging file before publishing, so unverified bytes never occupy the cache
 * path even transiently.
 */
async function streamToFile(url, destPath, { fetchImpl = globalThis.fetch } = {}) {
  await assertUsableDestination(destPath);
  const stagingPath = stagingPathFor(destPath);
  try {
    await streamToStaging(url, stagingPath, { fetchImpl });
    await fs.promises.rename(stagingPath, destPath);
  } catch (err) {
    await fs.promises.rm(stagingPath, { force: true }).catch(() => {});
    throw err;
  }
}

function digestSidecarPath(artifactPath) {
  return `${artifactPath}${DIGEST_SIDECAR_SUFFIX}`;
}

/** Digest a previous verified acquisition recorded for this artifact, or null. */
async function readRecordedDigest(artifactPath) {
  try {
    const raw = await fs.promises.readFile(digestSidecarPath(artifactPath), "utf8");
    const match = raw.trim().match(/^[0-9a-fA-F]{64}$/);
    return match ? match[0].toLowerCase() : null;
  } catch {
    return null;
  }
}

async function recordDigest(artifactPath, digest) {
  await fs.promises.writeFile(digestSidecarPath(artifactPath), `${digest}\n`, "utf8");
}

/**
 * Acquire one artifact, verified against its channel's own checksum manifest.
 *
 * Fails closed on every failure mode CLAUDE.md names: download failure, missing or
 * unparseable checksum metadata, no manifest entry for the requested file, and
 * digest mismatch. A file that fails verification is deleted rather than left on
 * disk for a later run to find.
 *
 * CACHE SEMANTICS, stated explicitly because "never silently reuse" is a rule here:
 * a cached artifact is reused only when a sidecar records the digest it was
 * verified against AND the bytes on disk still hash to that digest. The digest is
 * recomputed every time; the sidecar is a record, not a substitute for the check.
 * That reuse is offline-capable by design (this is an airgap tool, and the bytes
 * were verified when they were fetched), and it is not silent: the returned
 * provenance carries `cached: true` and the digest, which callers record in the
 * bundle's tool provenance.
 *
 * @returns {Promise<{path:string, sha256:string, url:string, manifestUrl:string,
 *                    fileName:string, cached:boolean, bytes:number}>}
 */
async function acquireVerifiedArtifact(options) {
  const { artifactUrl, manifestUrl, fileName, destPath } = options || {};
  if (!artifactUrl || !manifestUrl || !fileName || !destPath) {
    throw new Error("acquireVerifiedArtifact requires artifactUrl, manifestUrl, fileName and destPath");
  }

  // One transfer per destination, however many callers ask for it.
  //
  // Without this, two concurrent exports both staged and both renamed onto the
  // same cache path. Unique staging names (above) stop them corrupting each
  // other's bytes, but they would still perform the same multi-gigabyte
  // download twice and race to publish it. Keyed on the RESOLVED path so
  // `/data/cache/x` and `/data/./cache/x` are recognised as one destination.
  const key = path.resolve(destPath);
  const existing = inFlightAcquisitions.get(key);
  if (existing) {
    // Same path, different artifact is a programming error, not something to
    // resolve by picking one. Returning the in-flight result would hand the
    // caller a digest and provenance for an artifact it never asked for.
    if (
      existing.artifactUrl !== artifactUrl ||
      existing.manifestUrl !== manifestUrl ||
      existing.fileName !== fileName
    ) {
      throw new Error(
        `Cache destination conflict for ${destPath}: ${existing.fileName} is already in flight ` +
        `for this path, cannot also acquire ${fileName}.`
      );
    }
    // Defensive copy — callers must not be able to mutate each other's result.
    return { ...(await existing.promise) };
  }

  const promise = performAcquisition(options);
  inFlightAcquisitions.set(key, { promise, artifactUrl, manifestUrl, fileName });
  try {
    return { ...(await promise) };
  } finally {
    // Released on settle, success or failure, so a later call re-verifies
    // rather than replaying a stale outcome.
    inFlightAcquisitions.delete(key);
  }
}

async function performAcquisition({
  artifactUrl,
  manifestUrl,
  fileName,
  destPath,
  fetchImpl = globalThis.fetch
}) {
  await assertUsableDestination(destPath);

  // Reuse only bytes we can still prove are the bytes we verified.
  const recorded = await readRecordedDigest(destPath);
  if (recorded && fs.existsSync(destPath)) {
    const actual = await sha256OfFile(destPath);
    if (actual === recorded) {
      const { size } = await fs.promises.stat(destPath);
      return {
        path: destPath, sha256: recorded, url: artifactUrl, manifestUrl,
        fileName, cached: true, bytes: size
      };
    }
    // On-disk corruption, or a partial write from an older build. Discard the
    // sidecar so the stale claim cannot be read again; the file itself is left
    // for the download below to replace atomically, and is only removed if no
    // replacement arrives.
    await fs.promises.rm(digestSidecarPath(destPath), { force: true }).catch(() => {});
  }

  const manifest = await fetchSha256Manifest(manifestUrl, { fetchImpl });
  const expected = expectedDigestFor(manifest, fileName, manifestUrl);

  // VERIFY BEFORE PUBLISH. The digest is computed on the staging file, so a
  // tampered or truncated transfer is deleted from staging and the cache path
  // is never written at all. The previous order — rename, then hash, then
  // `rm(destPath)` on mismatch — meant a bad download briefly occupied the
  // cache path and then deleted whatever was standing there, including a
  // perfectly good artifact another caller was relying on.
  const stagingPath = stagingPathFor(destPath);
  try {
    await streamToStaging(artifactUrl, stagingPath, { fetchImpl });

    const actual = await sha256OfFile(stagingPath);
    if (actual !== expected) {
      throw new Error(
        `SHA256 mismatch for ${fileName}: expected ${expected}, got ${actual}. ` +
        `The downloaded artifact does not match ${manifestUrl} and has been discarded.`
      );
    }

    await fs.promises.rename(stagingPath, destPath);
  } catch (err) {
    await fs.promises.rm(stagingPath, { force: true }).catch(() => {});
    throw err;
  }

  await recordDigest(destPath, expected);
  const { size } = await fs.promises.stat(destPath);
  return {
    path: destPath, sha256: expected, url: artifactUrl, manifestUrl,
    fileName, cached: false, bytes: size
  };
}

export {
  parseSha256Manifest,
  fetchSha256Manifest,
  expectedDigestFor,
  sha256OfFile,
  streamToFile,
  streamToStaging,
  stagingPathFor,
  assertUsableDestination,
  acquireVerifiedArtifact,
  readRecordedDigest,
  digestSidecarPath,
  DIGEST_SIDECAR_SUFFIX
};
