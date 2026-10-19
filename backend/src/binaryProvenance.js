/**
 * OpenShift Airgap Architect — provenance for EXTRACTED executables
 *
 * WHY THIS MODULE EXISTS
 *
 * `backend/src/verifiedDownload.js` closed the gap on *tarballs*: nothing is
 * downloaded without matching the publishing channel's own `sha256sum.txt`, and
 * a cached tarball is reused only when its bytes still hash to the digest they
 * were verified against. That verification stopped at the tarball.
 *
 * What the product actually runs and ships is the EXECUTABLE extracted from
 * that tarball, and both cache hits returned it unchecked:
 *
 *   - `installer.js` — `if (fs.existsSync(target)) return target;`, where
 *     `target` is `openshift-install-<version>` with NO architecture segment.
 *     That binary is then handed to `spawn()` for `coreos print-stream-json`.
 *   - `openshiftInstaller.js` — the same shape, for the binary that is written
 *     into the offline bundle and run by an operator across the air gap.
 *
 * So an extracted binary could predate the checksum work entirely, be corrupted
 * on disk, be left behind by a half-finished extraction, or — in the
 * `installer.js` case — be the binary for a different execution host
 * architecture. None of that was detectable, because nothing recorded what the
 * bytes at that path were supposed to be.
 *
 * WHAT A RECORD BINDS
 *
 * One sidecar per executable, written atomically, binding the executable's own
 * SHA256 to the full identity it was produced for: tool, version, platform,
 * architecture, FIPS variant, and the digest of the checksum-verified tarball
 * it came out of. Reuse re-hashes the executable and requires every field to
 * match. A record is evidence, never a substitute for the hash.
 *
 * FAIL-CLOSED, AND OFFLINE-CAPABLE
 *
 * A cache that is legacy (no record), corrupt, or mismatched is never run and
 * never exported — it is discarded, and reacquired if the network allows. When
 * it does not, the caller fails with an error that names the reason rather than
 * falling back to unverified bytes. A VALID record stays usable with no network
 * at all, which is the case that matters for a disconnected-install tool.
 *
 * SCOPE: this is SHA256 provenance over bytes this process verified and
 * extracted itself. It is NOT signature verification, and nothing here may be
 * described as such — see the trust-anchor decision record referenced from
 * `docs/security/SBOM_AND_PROVENANCE.md`.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sha256OfFile } from "./verifiedDownload.js";

/** Suffix of the sidecar recording what an extracted executable is. */
const PROVENANCE_SUFFIX = ".provenance.json";

/**
 * Bumped only on an INCOMPATIBLE record shape.
 *
 * An unrecognised version is treated exactly like a missing record: the cache
 * is discarded and reacquired. That is deliberately the safe direction — a
 * downgrade meeting a newer record must not reuse bytes it cannot interpret.
 */
const PROVENANCE_SCHEMA_VERSION = 1;

/** Identity fields that must ALL match for a cached executable to be reused. */
const IDENTITY_FIELDS = Object.freeze([
  "tool",
  "version",
  "platform",
  "arch",
  "variant",
  "tarballSha256"
]);

function provenancePathFor(binaryPath) {
  return `${binaryPath}${PROVENANCE_SUFFIX}`;
}

/**
 * Write the record for an executable, atomically.
 *
 * Temp-then-rename, so a crash mid-write cannot leave a truncated record that
 * parses into a partial identity. The executable is hashed here, after it is in
 * its final location with its final mode, so the digest describes exactly the
 * bytes a later reuse will hash.
 */
async function writeBinaryProvenance(binaryPath, identity) {
  for (const field of IDENTITY_FIELDS) {
    if (!identity?.[field]) {
      throw new Error(`writeBinaryProvenance requires identity.${field}`);
    }
  }

  const record = {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    tool: identity.tool,
    version: identity.version,
    platform: identity.platform,
    arch: identity.arch,
    variant: identity.variant,
    tarballSha256: identity.tarballSha256,
    binarySha256: await sha256OfFile(binaryPath),
    recordedAt: new Date().toISOString(),
    ...(identity.sourceUrl ? { sourceUrl: identity.sourceUrl } : {}),
    ...(identity.manifestUrl ? { manifestUrl: identity.manifestUrl } : {})
  };

  const recordPath = provenancePathFor(binaryPath);
  const staging = `${recordPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.promises.writeFile(staging, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await fs.promises.rename(staging, recordPath);
  } catch (err) {
    await fs.promises.rm(staging, { force: true }).catch(() => {});
    throw err;
  }
  return record;
}

/** Parse a record, or null when absent, unreadable or not valid JSON. */
async function readBinaryProvenance(binaryPath) {
  let raw;
  try {
    raw = await fs.promises.readFile(provenancePathFor(binaryPath), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether a cached executable may be run or exported.
 *
 * Returns `{ usable, reason, detail, record }`. `reason` is a stable slug so
 * callers can log and test it without matching prose:
 *
 *   absent                        nothing at that path
 *   not-a-regular-file            a symlink, directory or device sits there
 *   no-provenance-record          a legacy cache from before this existed
 *   unreadable-provenance-record  present but not parseable JSON
 *   unsupported-provenance-schema a record this build cannot interpret
 *   incomplete-provenance-record  a field the identity check needs is missing
 *   identity-mismatch             right path, wrong binary (arch, version, …)
 *   binary-digest-mismatch        the bytes changed since they were recorded
 *
 * Every non-`absent` reason means bytes exist that must NOT be trusted.
 */
async function verifyCachedBinary(binaryPath, identity) {
  let stat;
  try {
    stat = await fs.promises.lstat(binaryPath);
  } catch (err) {
    if (err?.code === "ENOENT") return { usable: false, reason: "absent", detail: null, record: null };
    throw err;
  }
  if (!stat.isFile()) {
    return { usable: false, reason: "not-a-regular-file", detail: binaryPath, record: null };
  }

  const record = await readBinaryProvenance(binaryPath);
  if (record === null) {
    // Distinguish "never recorded" from "recorded and since mangled": both are
    // discarded, but only the second indicates something went wrong on disk.
    const present = fs.existsSync(provenancePathFor(binaryPath));
    return {
      usable: false,
      reason: present ? "unreadable-provenance-record" : "no-provenance-record",
      detail: null,
      record: null
    };
  }

  if (record.schemaVersion !== PROVENANCE_SCHEMA_VERSION) {
    return {
      usable: false,
      reason: "unsupported-provenance-schema",
      detail: `record schemaVersion ${record.schemaVersion}, this build understands ${PROVENANCE_SCHEMA_VERSION}`,
      record
    };
  }

  for (const field of IDENTITY_FIELDS) {
    if (!record[field]) {
      return { usable: false, reason: "incomplete-provenance-record", detail: field, record };
    }
  }
  if (typeof record.binarySha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.binarySha256)) {
    return { usable: false, reason: "incomplete-provenance-record", detail: "binarySha256", record };
  }

  const mismatched = IDENTITY_FIELDS.filter(
    (field) => identity?.[field] !== undefined && record[field] !== identity[field]
  );
  if (mismatched.length > 0) {
    return {
      usable: false,
      reason: "identity-mismatch",
      detail: mismatched
        .map((field) => `${field}: cached ${record[field]}, required ${identity[field]}`)
        .join("; "),
      record
    };
  }

  // The hash is the authority. Everything above only decides WHAT the bytes
  // were supposed to be; this decides whether they still are.
  const actual = await sha256OfFile(binaryPath);
  if (actual !== record.binarySha256) {
    return {
      usable: false,
      reason: "binary-digest-mismatch",
      detail: `recorded ${record.binarySha256}, found ${actual}`,
      record
    };
  }

  return { usable: true, reason: null, detail: null, record };
}

/**
 * Remove an executable that failed verification, along with its record.
 *
 * Both go, and the record goes LAST is not an option here — neither ordering is
 * atomic, so the safety comes from `verifyCachedBinary` refusing either half on
 * its own: a record without its binary is `absent`, a binary without its record
 * is `no-provenance-record`.
 */
async function discardUnverifiedBinary(binaryPath) {
  await fs.promises.rm(binaryPath, { force: true, recursive: false }).catch(() => {});
  await fs.promises.rm(provenancePathFor(binaryPath), { force: true }).catch(() => {});
}

/** Operator-facing explanation of why a cache was refused. */
function describeCacheRejection(reason, detail) {
  const base = {
    "not-a-regular-file": "the cache path is not a regular file",
    "no-provenance-record": "it predates binary provenance recording and cannot be proven verified",
    "unreadable-provenance-record": "its provenance record is corrupt",
    "unsupported-provenance-schema": "its provenance record uses an unsupported schema",
    "incomplete-provenance-record": "its provenance record is missing required identity fields",
    "identity-mismatch": "it was produced for a different version, platform, architecture or variant",
    "binary-digest-mismatch": "its bytes no longer match the digest recorded when it was extracted"
  }[reason] || `it failed verification (${reason})`;
  return detail ? `${base} (${detail})` : base;
}

export {
  provenancePathFor,
  writeBinaryProvenance,
  readBinaryProvenance,
  verifyCachedBinary,
  discardUnverifiedBinary,
  describeCacheRejection,
  PROVENANCE_SUFFIX,
  PROVENANCE_SCHEMA_VERSION,
  IDENTITY_FIELDS
};
