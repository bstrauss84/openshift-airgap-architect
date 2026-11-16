/**
 * Scanner and vulnerability-database provenance, and the cache contract that
 * makes the containerized scanner able to report either one.
 *
 * THE DEFECT THIS CLOSES (verified by execution, 2026-10-14).
 *
 * `axes/image-vulnerabilities.mjs describeDatabase()` establishes database
 * identity for the containerized strategy with:
 *
 *     podman run --rm <trivy> version --format json
 *
 * No volume is mounted. Trivy keeps its advisory database in its cache
 * directory (`/root/.cache/trivy` in the published image), and `--rm` means a
 * fresh container has an EMPTY cache. Reproduced against the pinned scanner
 * aquasec/trivy@sha256:af6acf9a…55daa:
 *
 *     $ podman run --rm <trivy> version --format json
 *     {"Version":"0.75.0"}
 *
 * There is no `VulnerabilityDB` block, so `parseTrivyDb()` returns
 * `{identified:false, reason:"trivy version output carried no VulnerabilityDB
 * block"}`, `evaluateDb()` refuses it, and the axis returns INCOMPLETE —
 * permanently, on every run, no matter how healthy the scan itself would be.
 * The same empty cache also means the scan call would re-download the ~1.6 GB
 * database on every image, or fail outright on a disconnected host.
 *
 * With the cache mounted, the same command on the same host answers in full:
 *
 *     {"Version":"0.75.0","VulnerabilityDB":{"Version":2,
 *      "NextUpdate":"2026-10-14T19:11:46.909501616Z",
 *      "UpdatedAt":"2026-10-13T19:11:46.909502157Z",
 *      "DownloadedAt":"2026-10-13T23:15:52.028759106Z"}}
 *
 * THE CACHE CONTRACT. One named cache directory is mounted READ-WRITE at the
 * scanner's cache path for BOTH calls — the `version` call that establishes
 * database identity and the `image` call that performs the scan. Mounting it
 * for only one of them is the subtler form of the same bug: the reported
 * database would then be a different database from the one actually
 * consulted, which is worse than reporting none, because it reads as
 * evidence.
 *
 *   - Default location: `OAA_SCANNER_CACHE`, else `<os.tmpdir()>/oaa-scanner-cache`.
 *     Deliberately NOT inside the repository: a multi-gigabyte database under
 *     the worktree would join the untracked-file set that forms the candidate
 *     id (see lib/provenance.mjs), so the cache would change the identity of
 *     the candidate it exists to help certify.
 *   - Read-write, because Trivy writes a lock file and may refresh the DB.
 *   - `:z` so the mount works under SELinux, matching the existing call sites.
 *
 * SEEDING IS THE OPERATOR'S ACT, NOT THIS MODULE'S. On a disconnected host
 * nothing here may reach the network, and on a connected one a silent
 * download would make the certified database depend on when the run happened
 * rather than on what the operator approved. `ensureCache()` therefore
 * CREATES the directory and REPORTS whether it holds a database; it never
 * populates one. An empty cache is an explicit, actionable INCOMPLETE with
 * the seeding command in the evidence.
 *
 * STALENESS NEVER PASSES. `assessScannerProvenance()` refuses to return
 * `acceptable` when the database is unidentifiable, when it carries no build
 * timestamp, or when Trivy's own `NextUpdate` horizon has passed. It invents
 * no age threshold of its own — the horizon is the vendor's declaration,
 * consistent with lib/scannerdb.mjs — but it adds the one thing that module
 * cannot see: the IMAGE DIGEST of the scanner that produced the answer. A
 * scanner version string is self-reported by the binary; the digest is what
 * actually ran.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../lib/exec.mjs";
import { parseTrivyDb, evaluateDb, ageDays } from "../lib/scannerdb.mjs";

/** Cache path INSIDE the published aquasec/trivy image. */
export const TRIVY_CONTAINER_CACHE = "/root/.cache/trivy";

/** Marker whose presence means the cache actually holds an advisory database. */
export const TRIVY_DB_MARKER = path.join("db", "metadata.json");

/** Where the persistent cache lives on the certification host. */
export function defaultCacheDir(env = process.env) {
  return env.OAA_SCANNER_CACHE || path.join(os.tmpdir(), "oaa-scanner-cache");
}

/**
 * Ensure the cache directory exists and report whether it is seeded.
 *
 * Never downloads. `seeded:false` is a reportable state, not an error to
 * paper over.
 */
export function ensureCache(cacheDir = defaultCacheDir(), { fsImpl = fs } = {}) {
  if (!cacheDir || typeof cacheDir !== "string") return { ok: false, reason: "no scanner cache directory configured" };
  try {
    fsImpl.mkdirSync(cacheDir, { recursive: true });
  } catch (err) {
    return { ok: false, reason: `scanner cache ${cacheDir} is not creatable: ${err.message}` };
  }

  const marker = path.join(cacheDir, TRIVY_DB_MARKER);
  const seeded = fsImpl.existsSync(marker);
  let metadata = null;
  if (seeded) {
    try {
      metadata = JSON.parse(fsImpl.readFileSync(marker, "utf8"));
    } catch (err) {
      return { ok: false, cacheDir, seeded: true, reason: `cache metadata at ${marker} is unparseable: ${err.message}` };
    }
  }
  return { ok: true, cacheDir, seeded, marker, metadata };
}

/** The `-v` argument mounting the cache for a containerized scanner. */
export function cacheMountArgs(cacheDir, containerPath = TRIVY_CONTAINER_CACHE) {
  return ["-v", `${cacheDir}:${containerPath}:z`];
}

/**
 * Resolve the image digest of the scanner that will actually run.
 *
 * A pinned reference already names a digest, but the reference is what was
 * REQUESTED; this reads back what the engine HAS, so the evidence records the
 * bytes that executed rather than the intent.
 */
export function resolveScannerImageDigest(engine, ref, { runner = run, timeoutMs = 120_000 } = {}) {
  if (!engine) return { ok: false, reason: "no container engine" };
  const res = runner(engine, ["image", "inspect", ref, "--format", "json"], { timeoutMs });
  if (res.spawnError) return { ok: false, reason: `could not execute ${engine}: ${res.spawnError}` };
  if (res.status !== 0) {
    return { ok: false, reason: (res.stderr || "").trim().split("\n")[0] || `${engine} image inspect exited ${res.status}` };
  }
  let data;
  try {
    const parsed = JSON.parse(res.stdout);
    data = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (err) {
    return { ok: false, reason: `unparseable scanner inspect output: ${err.message}` };
  }
  const repoDigests = Array.isArray(data?.RepoDigests) ? data.RepoDigests : [];

  /*
   * THE PINNED DIGEST IS THE ONE IN THE REFERENCE, not simply the first
   * RepoDigest.
   *
   * One image can be addressable by SEVERAL registry digests — verified on
   * this host, where aquasec/trivy carries both sha256:9db09910… and
   * sha256:af6acf9a… (one per manifest media type). Taking `RepoDigests[0]`
   * therefore reported sha256:9db09910… for a scanner that was pinned to and
   * pulled by sha256:af6acf9a…. That is precisely the digest-conflation this
   * module exists to prevent: the evidence would name a digest the operator
   * never approved. So the digest is read from the REFERENCE when it carries
   * one, and the list is only consulted as a fallback for a tag-based ref.
   */
  const refDigest = typeof ref === "string" && ref.includes("@") ? ref.split("@")[1] : null;
  const fromList = repoDigests.map((d) => d.split("@")[1]).filter(Boolean);
  const pinnedDigest = refDigest ?? (fromList.length === 1 ? fromList[0] : null);

  return {
    ok: true,
    // Config digest — podman's `Id`. NOT the manifest digest. See imageIdentity.mjs.
    configDigest: typeof data?.Id === "string" ? data.Id : null,
    manifestDigest: typeof data?.Digest === "string" ? data.Digest : null,
    repoDigests,
    pinnedDigest,
    // An ambiguous tag-based pull is reportable, not silently resolved.
    pinnedDigestAmbiguous: !refDigest && fromList.length > 1 ? fromList : null,
    // Did the engine actually have the bytes the reference named?
    pinnedDigestConfirmed: refDigest ? fromList.includes(refDigest) : null,
  };
}

/**
 * Ask a containerized Trivy to describe itself and its database, WITH the
 * cache mounted. This is the call that today returns `{"Version":"0.75.0"}`
 * because the mount is missing.
 */
export function describeContainerizedTrivy(engine, ref, cacheDir, { runner = run, timeoutMs = 300_000, now = new Date() } = {}) {
  const res = runner(
    engine,
    ["run", "--rm", "--network=none", ...cacheMountArgs(cacheDir), ref, "version", "--format", "json"],
    { timeoutMs },
  );
  if (res.spawnError) return { identified: false, reason: `could not execute ${engine}: ${res.spawnError}` };
  if (res.timedOut) return { identified: false, reason: `containerized trivy version timed out after ${timeoutMs}ms` };
  if (res.status !== 0) {
    return { identified: false, reason: `containerized trivy version failed: exit ${res.status}` };
  }
  try {
    return parseTrivyDb(JSON.parse(res.stdout), now);
  } catch (err) {
    return { identified: false, reason: `unparseable trivy version output: ${err.message}` };
  }
}

/**
 * The complete machine-readable provenance record for one scan.
 *
 * Everything a reader needs a year later to decide whether the verdict still
 * means anything, in one closed object. Each field is either present with a
 * real value or explicitly null — never silently omitted.
 */
export function scanProvenanceRecord({
  scanner,
  database,
  scannerImage,
  image,
  scanStartedAt,
  scanCompletedAt,
  sourceCommit,
  candidateId = null,
  cacheDir = null,
}) {
  return {
    scanner: {
      name: scanner?.name ?? null,
      version: scanner?.version ?? null,
      invocation: scanner?.invocation ?? null,
      image: {
        ref: scannerImage?.ref ?? null,
        // Three distinct digests; see imageIdentity.mjs DIGEST_KINDS.
        pinnedDigest: scannerImage?.pinnedDigest ?? null,
        manifestDigest: scannerImage?.manifestDigest ?? null,
        configDigest: scannerImage?.configDigest ?? null,
      },
    },
    vulnerabilityDatabase: {
      identified: database?.identified === true,
      schemaVersion: database?.dbVersion ?? database?.dbSchemaVersion ?? null,
      updatedAt: database?.builtAt ?? null,
      nextUpdate: database?.nextUpdate ?? null,
      downloadedAt: database?.downloadedAt ?? null,
      ageDays: ageDays(database?.builtAt, scanCompletedAt ? new Date(scanCompletedAt) : new Date()),
      expiredByToolDeclaration: database?.expiredByToolDeclaration ?? null,
      freshnessPolicy: database?.freshnessPolicy ?? null,
      cacheDir,
    },
    subject: {
      role: image?.role ?? null,
      ref: image?.ref ?? null,
      configDigest: image?.configDigest ?? null,
      manifestDigest: image?.manifestDigest ?? null,
      registryDigest: image?.registryDigest ?? null,
      platform: image?.platform ?? null,
    },
    scan: {
      startedAt: scanStartedAt ?? null,
      completedAt: scanCompletedAt ?? null,
    },
    source: {
      commit: sourceCommit ?? null,
      candidateId,
    },
  };
}

/**
 * Is this scan usable as RELEASE evidence?
 *
 * Layered on `evaluateDb()` rather than replacing it: that module owns the
 * database freshness rule and the deliberate trivy/grype asymmetry. What is
 * added here is scanner-identity sufficiency — a verdict whose producing
 * binary cannot be named by digest is not reproducible evidence either.
 *
 * Returns `{acceptable, reasons[]}`. `acceptable` is never true with a
 * non-empty `reasons`.
 */
export function assessScannerProvenance(record) {
  const reasons = [];

  const db = record?.vulnerabilityDatabase ?? {};
  const dbForEval = {
    identified: db.identified,
    scanner: record?.scanner?.name ?? null,
    dbVersion: db.schemaVersion,
    builtAt: db.updatedAt,
    nextUpdate: db.nextUpdate,
    expiredByToolDeclaration: db.expiredByToolDeclaration,
    reason: db.identified ? null : "vulnerability database could not be identified",
  };
  const dbVerdict = evaluateDb(dbForEval);
  if (!dbVerdict.acceptable) reasons.push(dbVerdict.reason);

  const img = record?.scanner?.image ?? {};
  if (!img.pinnedDigest && !img.manifestDigest && !img.configDigest) {
    reasons.push("the scanner that produced this verdict cannot be identified by image digest");
  }
  if (!record?.scanner?.version) {
    reasons.push("no scanner version was recorded");
  }

  const subject = record?.subject ?? {};
  if (!subject.configDigest && !subject.manifestDigest) {
    reasons.push("the scanned image cannot be identified by digest");
  }
  if (!record?.source?.commit) {
    reasons.push("no source commit was recorded, so the verdict cannot be tied to a candidate");
  }

  return { acceptable: reasons.length === 0, reasons, databaseVerdict: dbVerdict };
}
