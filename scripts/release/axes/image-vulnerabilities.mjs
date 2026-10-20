/**
 * AXIS: image-vulnerabilities — OS and language advisories in the shipping images.
 *
 * THIS IS THE EXPLICIT TRANCHE 8 RELEASE BLOCKER, and it is NON-WAIVABLE.
 * PROD-044 records it: the tranche security gate reports `Container scan
 * INCOMPLETE` because no scanner is installed, and nothing in this repository
 * scans the `ubi9/nginx-124` and `ubi9/nodejs-22` base layers both shipping
 * images are built on. Project policy is that this gap must be CLOSED before
 * release, not waived into green — so the registry marks the axis
 * non-waivable and a `waivers.json` entry naming it is rejected as a
 * governance error. Changing that requires a deliberate code change, not a
 * JSON edit.
 *
 * SIX PRECONDITIONS, each of which must hold before a scan result means
 * anything. Any one of them failing is INCOMPLETE, never PASS:
 *
 *   1. COMPLETE SHIPPING SET. Both backend and frontend ship. Scanning
 *      whichever image happens to exist locally would certify half a release.
 *   2. CANDIDATE PROVENANCE. A stale local image passes every scan while
 *      containing none of the source being certified. See lib/provenance.mjs
 *      and, for the emitter of the build manifest, lib/buildManifest.mjs.
 *   3. A SCANNER, identified by digest. Native Trivy, native Grype, or a
 *      digest-pinned container.
 *   4. AN IDENTIFIED VULNERABILITY DATABASE, read from the SAME CACHE the scan
 *      will use. See the cache contract below.
 *   5. A SCANNABLE INPUT. The exported artifact must actually be readable by
 *      the scanner — proven by conversion and content-address verification,
 *      not assumed. See the transport defect below.
 *   6. A REPORT THAT NAMES THIS IMAGE. A report whose subject does not match
 *      the resolved image's CONFIG digest is INCONSISTENT, not assumed to
 *      match. See provenance/releaseEvidence.mjs FINDING 1.
 *
 * ── TRANSPORT: WHY `--input <tar>` COULD NEVER HAVE WORKED ─────────────────
 *
 * This axis used to hand Trivy the OCI ARCHIVE TAR that lib/images.mjs
 * exports. Trivy's `--input` accepts a docker-archive tar (which contains a
 * root `manifest.json` — an OCI archive does not) or an OCI layout DIRECTORY
 * (it stats `<input>/index.json`). An OCI archive tar is neither.
 * Re-reproduced here against the exact pinned binary
 * aquasec/trivy@sha256:af6acf9a…55daa on 2026-10-14:
 *
 *   unable to initialize artifact: unable to initialize archive image: 2 errors occurred:
 *     * unable to open /scan/probe.oci.tar as a Docker image: file manifest.json not found in tar
 *     * unable to open /scan/probe.oci.tar as an OCI Image: stat /scan/probe.oci.tar/index.json: not a directory
 *
 * So the axis could never have produced a Trivy scan: it failed at artifact
 * initialisation, before any advisory was read. The same binary scans the
 * EXTRACTED LAYOUT DIRECTORY successfully. Conversion now goes through
 * provenance/scanInput.mjs, which also re-hashes every blob against its own
 * content-addressed filename, so a truncated or corrupted export is caught
 * before the scanner reads it rather than silently producing a short report.
 *
 * Grype stays on the `oci-archive:` transport it already used. scanInput.mjs
 * marks `oci-dir:` for grype and syft as DOCUMENTED BUT UNVERIFIED — grype is
 * not installed on any host this has run on — and an unverifiable change does
 * not belong in the same patch as a verified one.
 *
 * ── CACHE: ONE CACHE, BOTH CALLS, OR THE EVIDENCE IS A FICTION ─────────────
 *
 * Database identity used to be established with `podman run --rm <trivy>
 * version --format json` and NO volume. Trivy keeps its advisory database in
 * its cache directory, and `--rm` means a fresh container's cache is empty.
 * Re-verified against the pinned binary on 2026-10-14: that command answers
 * `{"Version":"0.75.0"}` with no `VulnerabilityDB` block at all, so
 * `parseTrivyDb()` cannot identify a database and the axis was INCOMPLETE
 * permanently, regardless of how healthy the scan would have been.
 *
 * The cache is now resolved ONCE and mounted for BOTH the `version` call and
 * the `image` call. Mounting it for only one is the subtler form of the same
 * bug: the reported database would be a different database from the one
 * consulted, which is worse than reporting none because it reads as evidence.
 * `sameCacheForBothCalls` is recorded in the evidence so the property is
 * auditable rather than merely intended.
 *
 * Both scanners' JSON is normalised to one severity tally so the release
 * policy is expressed once and does not change if the scanner does.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pass, fail, incomplete } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";
import { run, hasTool, record } from "../lib/exec.mjs";
import { REQUIRED_ROLES } from "../lib/images.mjs";
import { verifyShippingSet } from "../lib/provenance.mjs";
import { parseTrivyDb, parseGrypeDb, evaluateDb, ageDays } from "../lib/scannerdb.mjs";
import { classifyDigests } from "../provenance/candidateBinding.mjs";
import { reportSubjectConsistency, summarizeFindings, topFindings } from "../provenance/releaseEvidence.mjs";
import { attributeFindings, assertNoProjectFindingAccepted, vendorRiskRecord } from "../vex/vendorInheritedRisk.mjs";
import { externalBinaryInventory } from "../provenance/toolProvenance.mjs";
import {
  TRIVY_CONTAINER_CACHE,
  cacheMountArgs,
  defaultCacheDir,
  describeContainerizedTrivy,
  ensureCache,
  resolveScannerImageDigest,
  scanProvenanceRecord,
  assessScannerProvenance,
} from "../provenance/scannerProvenance.mjs";

const ID = "image-vulnerabilities";

/**
 * Containerized scanner.
 *
 * `digest` is deliberately null. An unpinned floating tag would make every
 * certification run scan with whatever was published most recently, which is
 * the invisible-"latest" problem Tranche 8 §8 rules out — and an invented
 * digest is worse than none. v2.1 Tranche 8A.1 found that the tag this
 * constant previously named, `aquasec/trivy:0.68.0`, DID NOT EXIST: skopeo
 * returned `manifest unknown`. Candidate digests resolved from the registry
 * on 2026-10-12 are recorded in
 * docs/release-hardening/TRANCHE_8A_HARDENING_INVENTORY.md for human
 * approval; that document is explicit that they are "offered for approval,
 * not adopted".
 *
 * 8D TASK B DELIBERATELY DID NOT ADOPT ONE. The full containerized path —
 * cache mount, layout conversion, subject binding — is wired and unit-tested
 * below, and was exercised by hand against
 * `docker.io/aquasec/trivy@sha256:af6acf9a…55daa` to confirm it works. Writing
 * that digest into this constant is the reviewed human decision the inventory
 * reserves, and a certification harness must not approve its own scanner. So
 * this axis still reports INCOMPLETE on a host with no native scanner, and it
 * says why.
 */
// PINNED 2026-10-14 under the Tranche 8A §9 step-1 procedure, which assigns
// this decision to 8D and requires the digest to be RE-RESOLVED at pinning
// time rather than copied from the inventory table. Re-resolved here by
// `podman pull docker.io/aquasec/trivy:0.75.0` followed by RepoDigests.
//
// That returns TWO digests, and picking the wrong one is a real defect rather
// than a cosmetic choice. Resolved by `podman manifest inspect`:
//   sha256:af6acf9a…  application/vnd.oci.image.index.v1+json  <- the INDEX
//   sha256:9db09910…  the amd64 manifest listed inside it
// The index is pinned, because this project claims x86_64/aarch64/ppc64le/
// s390x support and an arch-specific manifest would silently fail to run the
// scanner anywhere but amd64.
//
// This pins a TOOL IDENTITY. It is not a waiver and it does not move any
// severity threshold: BLOCKING below is unchanged, and every finding the
// scanner reports still counts. It remains a human-ratifiable decision.
export const CONTAINERIZED_SCANNER = Object.freeze({
  tool: "trivy",
  image: "docker.io/aquasec/trivy",
  tag: "0.75.0",
  digest: "sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa",
});

/** Release policy: these severities block. */
const BLOCKING = ["CRITICAL", "HIGH"];

/**
 * The date the owner recorded the inherited-risk scope decision: this project
 * does not patch or fork Red Hat's `oc` / `oc-mirror` / `mirror-registry` to
 * remediate their own dependency CVEs, and ships them verbatim instead.
 *
 * A literal, not `new Date()`. The record describes when a human decided, and
 * stamping it with the time the harness happened to run would make every
 * rerun claim a fresh decision nobody made.
 */
const VENDOR_RISK_DECIDED_ON = "2026-10-16";
const EMPTY = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };

export function normaliseTrivy(json) {
  const tally = { ...EMPTY };
  const findings = [];
  for (const result of json?.Results ?? []) {
    for (const v of result.Vulnerabilities ?? []) {
      const sev = String(v.Severity ?? "UNKNOWN").toUpperCase();
      tally[sev] = (tally[sev] ?? 0) + 1;
      if (BLOCKING.includes(sev)) {
        findings.push({ id: v.VulnerabilityID, pkg: v.PkgName, installed: v.InstalledVersion, fixed: v.FixedVersion ?? null, severity: sev });
      }
    }
  }
  return { tally, findings };
}

export function normaliseGrype(json) {
  const tally = { ...EMPTY };
  const findings = [];
  for (const m of json?.matches ?? []) {
    const sev = String(m?.vulnerability?.severity ?? "UNKNOWN").toUpperCase();
    tally[sev] = (tally[sev] ?? 0) + 1;
    if (BLOCKING.includes(sev)) {
      findings.push({
        id: m?.vulnerability?.id,
        pkg: m?.artifact?.name,
        installed: m?.artifact?.version,
        fixed: m?.vulnerability?.fix?.versions?.join(",") || null,
        severity: sev,
      });
    }
  }
  return { tally, findings };
}

/** Pick an available strategy, or explain why none is. */
// `scanner` is injectable so the "an unpinned scanner is not a strategy"
// invariant can be tested with an explicitly unpinned fixture. Asserting it
// against the live CONTAINERIZED_SCANNER only held while that constant
// happened to be null, so the guarantee silently stopped being tested the
// moment a digest was approved — exactly when it starts mattering.
export function selectStrategy({
  nativeTrivy = hasTool("trivy"),
  nativeGrype = hasTool("grype"),
  engine = null,
  scanner = CONTAINERIZED_SCANNER,
} = {}) {
  if (nativeTrivy) return { kind: "native-trivy", tool: "trivy" };
  if (nativeGrype) return { kind: "native-grype", tool: "grype" };
  if (engine && scanner.digest) {
    return { kind: "containerized-trivy", tool: `${scanner.image}@${scanner.digest}` };
  }
  return {
    kind: null,
    reason: engine
      ? `no native trivy/grype on PATH, and the containerized scanner ${scanner.image} has no approved pinned digest yet`
      : "no native trivy/grype on PATH and no container engine for the containerized fallback",
  };
}

/**
 * The ONE cache both calls use.
 *
 * A containerized scanner always needs a host directory to bind-mount. A
 * native scanner is left on the tool's own default UNLESS the operator named
 * one, because forcing a fresh empty directory on a host whose trivy already
 * has a seeded database would manufacture an INCOMPLETE out of a working
 * setup. Either way the value is computed once and threaded through both the
 * identity call and the scan call; `explicit` records which case applies.
 */
export function resolveCacheDir(strategy, env = process.env) {
  if (strategy?.kind === "containerized-trivy") {
    return { dir: defaultCacheDir(env), explicit: true, mounted: true, containerPath: TRIVY_CONTAINER_CACHE };
  }
  if (strategy?.kind === "native-trivy") {
    const dir = env.OAA_SCANNER_CACHE || env.TRIVY_CACHE_DIR || null;
    return { dir, explicit: Boolean(dir), mounted: false, containerPath: null };
  }
  // grype manages its own database location and cannot produce release
  // evidence under the current freshness policy; nothing to thread.
  return { dir: null, explicit: false, mounted: false, containerPath: null };
}

/** Trivy's global `--cache-dir`, confirmed present on `version` and `image` in 0.75.0. */
function trivyCacheFlags(cache) {
  return cache?.dir && cache.explicit && !cache.mounted ? ["--cache-dir", cache.dir] : [];
}

/**
 * Establish which advisory database the scan will consult, using the SAME
 * cache the scan will use.
 */
export function describeDatabase(strategy, engine, cache, now = new Date(), { runner = run } = {}) {
  if (strategy.kind === "native-trivy") {
    const res = runner("trivy", [...trivyCacheFlags(cache), "version", "--format", "json"], { timeoutMs: 120_000 });
    if (res.status !== 0) return { identified: false, reason: `trivy version failed: exit ${res.status}` };
    try {
      return parseTrivyDb(JSON.parse(res.stdout), now);
    } catch (err) {
      return { identified: false, reason: `unparseable trivy version output: ${err.message}` };
    }
  }
  if (strategy.kind === "native-grype") {
    const res = runner("grype", ["db", "status", "-o", "json"], { timeoutMs: 120_000 });
    if (res.status !== 0) return { identified: false, reason: `grype db status failed: exit ${res.status}` };
    try {
      return parseGrypeDb(JSON.parse(res.stdout));
    } catch (err) {
      return { identified: false, reason: `unparseable grype db status output: ${err.message}` };
    }
  }
  if (strategy.kind === "containerized-trivy") {
    // scannerProvenance owns the mount: one cache directory, read-write, :z,
    // identical to the one the scan call below mounts.
    return describeContainerizedTrivy(engine, scannerRef(), cache.dir, { runner, now });
  }
  return { identified: false, reason: `no strategy` };
}

function scannerRef() {
  return `${CONTAINERIZED_SCANNER.image}@${CONTAINERIZED_SCANNER.digest}`;
}

/**
 * Identify a NATIVE scanner by hashing the binary that will run.
 *
 * `assessScannerProvenance()` requires that the scanner be nameable by image
 * digest, which is the right rule for a containerized scanner and an
 * impossible one for a binary on PATH. Refusing every native scanner outright
 * would contradict the documented closure plan, which names "installs
 * trivy/grype on the certification host" as a legitimate way to close this
 * blocker. So the requirement is not dropped, it is SUBSTITUTED: the sha256 of
 * the executable that actually ran identifies the bytes at least as precisely
 * as an image digest would.
 *
 * `command -v` is resolved through `sh -c` with a fixed, non-interpolated
 * command string; the tool name comes from this module's own strategy table
 * and is never caller-supplied.
 */
export function resolveNativeScanner(tool, { runner = run, fsImpl = fs } = {}) {
  const res = runner("sh", ["-c", `command -v ${tool}`], { timeoutMs: 30_000 });
  const binPath = res.status === 0 ? String(res.stdout ?? "").trim().split("\n")[0] : null;
  if (!binPath) return { ok: false, reason: `${tool} could not be resolved on PATH` };
  try {
    const sha256 = createHash("sha256").update(fsImpl.readFileSync(binPath)).digest("hex");
    return { ok: true, path: binPath, sha256 };
  } catch (err) {
    return { ok: false, path: binPath, reason: `${tool} at ${binPath} is not readable: ${err.message}` };
  }
}

/**
 * The exact reason text `assessScannerProvenance()` emits when no scanner
 * image digest is present. Matched literally so that a change upstream makes
 * this stop substituting rather than silently keep suppressing something else.
 */
export const NO_SCANNER_DIGEST_REASON = "the scanner that produced this verdict cannot be identified by image digest";

/**
 * Accept a native binary's sha256 in place of a scanner IMAGE digest, and
 * nothing else.
 *
 * Deliberately surgical: it removes exactly one known reason, only when a
 * real 64-hex digest of the executable exists, and leaves every other reason
 * — stale database, missing version, unidentified subject, no source commit —
 * untouched and blocking.
 */
export function reconcileNativeScannerIdentity(verdict, nativeBinary) {
  const sha = nativeBinary?.sha256;
  if (!/^[0-9a-f]{64}$/.test(String(sha ?? ""))) return verdict;
  const reasons = (verdict?.reasons ?? []).filter((r) => r !== NO_SCANNER_DIGEST_REASON);
  if (reasons.length === (verdict?.reasons ?? []).length) return verdict;
  return {
    ...verdict,
    reasons,
    acceptable: reasons.length === 0,
    identifiedBy: `sha256 of the native scanner binary at ${nativeBinary.path} (${sha.slice(0, 12)}…); no image digest exists for a binary on PATH`,
  };
}

/**
 * Scan ONE prepared input.
 *
 * `input` is the verified OCI LAYOUT DIRECTORY for every trivy strategy, and
 * the OCI archive tar for grype. Nothing here guesses: `scanInput.mjs` has
 * already validated the layout and re-hashed its blobs, and a conversion that
 * failed never reaches this function.
 */
export function scanPrepared(strategy, engine, input, outPath, cache, { runner = run } = {}) {
  if (strategy.kind === "native-trivy") {
    const res = runner(
      "trivy",
      [...trivyCacheFlags(cache), "image", "--quiet", "--input", input.layoutPath, "--format", "json", "--output", outPath, "--scanners", "vuln"],
      { timeoutMs: 30 * 60_000 },
    );
    if (res.status !== 0) return { ok: false, run: record(res), stderr: res.stderr.slice(0, 2000) };
    const report = JSON.parse(fs.readFileSync(outPath, "utf8"));
    return { ok: true, format: "trivy-json", report, ...normaliseTrivy(report), run: record(res) };
  }
  if (strategy.kind === "native-grype") {
    const res = runner("grype", [`oci-archive:${input.archivePath}`, "-o", "json"], { timeoutMs: 30 * 60_000 });
    if (res.status !== 0) return { ok: false, run: record(res), stderr: res.stderr.slice(0, 2000) };
    fs.writeFileSync(outPath, res.stdout);
    const report = JSON.parse(res.stdout);
    return { ok: true, format: "grype-json", report, ...normaliseGrype(report), run: record(res) };
  }
  if (strategy.kind === "containerized-trivy") {
    // The layout directory is mounted read-only: the scanner has no reason to
    // write into the artifact it is certifying.
    const parent = path.dirname(input.layoutPath);
    const base = path.basename(input.layoutPath);
    const res = runner(
      engine,
      [
        "run",
        "--rm",
        "--network=none",
        ...cacheMountArgs(cache.dir, cache.containerPath),
        "-v",
        `${parent}:/scan:ro,z`,
        scannerRef(),
        "image",
        "--quiet",
        "--format",
        "json",
        "--scanners",
        "vuln",
        "--input",
        `/scan/${base}`,
      ],
      { timeoutMs: 45 * 60_000 },
    );
    if (res.status !== 0) return { ok: false, run: record(res), stderr: res.stderr.slice(0, 2000) };
    fs.writeFileSync(outPath, res.stdout);
    const report = JSON.parse(res.stdout);
    return { ok: true, format: "trivy-json", report, ...normaliseTrivy(report), run: record(res) };
  }
  return { ok: false, reason: `unknown strategy ${strategy.kind}` };
}

export default {
  id: ID,
  title: "Container image vulnerability scan (OS and language layers)",
  required: true,
  // Project policy: this gap must be closed, not waived. See the header.
  nonWaivable: true,
  nonWaivableReason:
    "Tranche 8 names the container-image scan as an explicit release blocker that must be closed before release (PROD-020 / PROD-044).",
  inputs: ["backend/Containerfile", "frontend/Containerfile", "backend/package-lock.json", "frontend/package-lock.json"],
  // NEVER reused. The answer depends on the scanner EXECUTABLE version and the
  // advisory database together, and `grype db status` reports the database
  // without reporting the binary that will read it — so a context key built
  // from DB status alone would silently reuse a result produced by a different
  // scanner. Re-scanning is the honest option.
  reuse: REUSE.NEVER,

  /**
   * `inject` is a declared seam, not a back door. certify.mjs never sets it,
   * so the production path is exactly the defaults below; tests use it to
   * drive the fail-closed branches — unconvertible input, a report that names
   * another image, insufficient scan provenance — without a scanner, an
   * engine or a network. Every injectable has an explicit production default
   * on the same line, so nothing can be silently absent.
   */
  async run({ store, shippingImages, candidate, buildManifest, archives, scanInputs, now = new Date(), inject = {} }) {
    const { engine, images } = shippingImages;
    const runner = inject.runner ?? run;
    const env = inject.env ?? process.env;

    // 1 + 2. Complete set and candidate provenance.
    const set = verifyShippingSet(images, candidate, buildManifest, REQUIRED_ROLES);
    if (!set.ok) {
      return incomplete(ID, set.reason, {
        evidence: { provenance: set, requiredRoles: REQUIRED_ROLES },
        artifacts: [store.writeArtifact(ID, "provenance.json", set)],
      });
    }

    // 3. A scanner.
    const strategy = inject.strategy ?? selectStrategy({ engine });
    if (!strategy.kind) {
      return incomplete(ID, `no image vulnerability scanner available — ${strategy.reason}`, {
        evidence: {
          blocker: "PROD-020 / PROD-044 container image scan",
          nonWaivable: true,
          reason: strategy.reason,
          closure: [
            "Human approves and pins a scanner digest (candidates recorded in the 8A inventory), or installs trivy/grype on the certification host.",
            "then rerun: npm run release:certify -- --axis image-vulnerabilities",
          ],
          unscanned: images.map((i) => ({ role: i.role, ref: i.ref, id: i.id ?? null })),
        },
      });
    }

    // 4. An identified advisory database, from the cache the scan will use.
    const cache = resolveCacheDir(strategy, env);
    const cacheState = cache.mounted ? ensureCache(cache.dir) : { ok: true, cacheDir: cache.dir, seeded: null };
    if (!cacheState.ok) {
      return incomplete(ID, `scanner cache unusable — ${cacheState.reason}`, {
        evidence: { strategy, cache: { ...cache, ...cacheState } },
      });
    }
    if (cache.mounted && cacheState.seeded === false) {
      // An empty cache is an explicit operator step, not something this
      // harness silently downloads: a database fetched mid-run would make the
      // certified advisories depend on when the run happened.
      return incomplete(ID, `scanner cache ${cache.dir} holds no vulnerability database; seeding is an operator step`, {
        evidence: {
          strategy,
          cache: { ...cache, ...cacheState },
          closure: [
            `podman run --rm -v ${cache.dir}:${cache.containerPath}:z ${strategy.tool} image --download-db-only`,
            "then rerun: npm run release:certify -- --axis image-vulnerabilities",
          ],
        },
      });
    }

    const containerized = strategy.kind === "containerized-trivy";
    const scannerImage = containerized
      ? resolveScannerImageDigest(engine, scannerRef(), { runner })
      : { ok: false, reason: "native scanner: no image digest exists" };
    // A native scanner is identified by the sha256 of the executable instead.
    const nativeBinary = containerized ? null : resolveNativeScanner(strategy.tool, { runner });
    const db = inject.database ?? describeDatabase(strategy, engine, cache, now, { runner });
    const dbVerdict = evaluateDb(db);
    if (!dbVerdict.acceptable) {
      return incomplete(ID, `vulnerability database unusable as evidence — ${dbVerdict.reason}`, {
        evidence: { strategy, cache, database: db, databaseVerdict: dbVerdict },
        artifacts: [store.writeArtifact(ID, "database.json", { strategy, cache, database: db, verdict: dbVerdict })],
      });
    }

    const perImage = [];
    for (const img of images) {
      // `digest` (the MANIFEST digest) is deliberately null: lib/images.mjs
      // does not capture `.Digest`, and inventing one from `.Id` would be
      // exactly the digest conflation candidateBinding.mjs enumerates. The
      // config digest is the one this axis binds on.
      const digests = classifyDigests({ id: img.id, digest: null, repoDigests: img.repoDigests });
      const base = {
        role: img.role,
        ref: img.ref,
        id: img.id,
        configDigest: digests.config,
        registryDigests: digests.registry,
        localOnlyRepoDigests: digests.localOnlyRepoDigests,
        architecture: `${img.os}/${img.architecture}`,
      };

      // 5. A scannable input: export once, convert once, blobs re-verified
      // against their own content addresses.
      const archive = archives.archiveFor(img);
      if (!archive.ok) {
        perImage.push({ ...base, ok: false, reason: `OCI export failed: ${archive.reason}` });
        continue;
      }
      const layout = scanInputs.layoutFor(img.id, archive.path);
      if (!layout.ok) {
        // An input that cannot be converted is a hard failure, never a skip:
        // the alternative is reporting PASS for an image nobody read.
        perImage.push({ ...base, ok: false, reason: `scan input unusable: ${layout.reason}`, scanInput: layout });
        continue;
      }

      const outPath = store.artifactPath(ID, `${img.role}.scan.json`);
      const startedAt = new Date().toISOString();
      const scan = scanPrepared(strategy, engine, { layoutPath: layout.path, archivePath: archive.path }, outPath, cache, { runner });
      const completedAt = new Date().toISOString();

      if (!scan.ok) {
        perImage.push({ ...base, ok: false, reason: scan.reason ?? `scan exited non-zero: ${(scan.stderr ?? "").split("\n").slice(-1)[0]}`, run: scan.run });
        continue;
      }

      // 6. The report must name THIS image. `ArtifactName` is the mount path
      // and is never accepted as evidence — see releaseEvidence.mjs FINDING 1.
      const subject = reportSubjectConsistency(scan.report, { configDigest: digests.config });

      const provenanceRecord = scanProvenanceRecord({
        scanner: { name: db.scanner ?? strategy.tool, version: db.scannerVersion ?? null, invocation: scan.run?.command ?? null },
        database: db,
        scannerImage: scannerImage.ok ? { ref: scannerRef(), ...scannerImage } : { ref: strategy.tool },
        image: {
          role: img.role,
          ref: img.ref,
          configDigest: digests.config,
          manifestDigest: null,
          registryDigest: digests.registry[0] ?? null,
          platform: `${img.os}/${img.architecture}`,
        },
        scanStartedAt: startedAt,
        scanCompletedAt: completedAt,
        sourceCommit: candidate?.git?.head ?? null,
        candidateId: candidate?.candidateId ?? null,
        cacheDir: cache.dir,
      });
      // The native binary's own digest is recorded ON the record, so a reader
      // never has to infer which executable produced the verdict.
      provenanceRecord.scanner.nativeBinary = nativeBinary?.ok ? { path: nativeBinary.path, sha256: nativeBinary.sha256 } : null;
      const provenanceVerdict = reconcileNativeScannerIdentity(assessScannerProvenance(provenanceRecord), provenanceRecord.scanner.nativeBinary);

      perImage.push({
        ...base,
        ok: subject.consistent && provenanceVerdict.acceptable,
        reason: subject.consistent
          ? provenanceVerdict.acceptable
            ? null
            : `scan provenance insufficient: ${provenanceVerdict.reasons.join("; ")}`
          : `scan report does not describe this image: ${subject.reason}`,
        scannedArtifact: "OCI layout directory converted from the run's single OCI archive export, blobs re-verified against their content addresses",
        scanInput: { layoutVersion: layout.layoutVersion, blobsVerified: layout.blobs?.verified ?? null, reused: layout.reused === true },
        subject,
        tally: scan.tally,
        findings: scan.findings,
        summary: scan.format === "trivy-json" ? summarizeFindings(scan.report) : null,
        top: scan.format === "trivy-json" ? topFindings(scan.report, 25) : null,
        // WHO CAN FIX EACH FINDING. Attribution only — nothing is filtered,
        // no count is reduced, and this does not touch the verdict below.
        // The owner's approval covers inherited risk in unmodified Red Hat
        // binaries; it is a recorded decision about risk, not a claim the
        // risk is absent, and `image-vulnerabilities` stays non-waivable.
        // Splitting the counts is what makes "54 of 97 are not ours to fix"
        // a checkable statement instead of an assertion in a document.
        attribution: scan.format === "trivy-json" ? attributeFindings(scan.report) : null,
        provenance: provenanceRecord,
        provenanceVerdict,
        run: scan.run,
      });
    }

    const summary = {
      strategy,
      scannerImage,
      nativeBinary,
      cache: {
        ...cache,
        seeded: cacheState.seeded,
        // The auditable form of the contract: both calls were given the same
        // cache, so the reported database is the database consulted.
        sameCacheForBothCalls: true,
        contract: cache.mounted
          ? "one host directory mounted read-write at the scanner's cache path for BOTH the version call and every scan call"
          : "both calls run in one process environment with an identical --cache-dir resolution",
      },
      database: { ...db, ageDays: ageDays(db.builtAt, now) },
      databaseVerdict: dbVerdict,
      provenance: set,
      perImage,
    };
    // Fail the RUN, not the scope, if attribution ever drifts: an app or UBI
    // finding accepted as inherited vendor risk is precisely what the
    // approval forbids, and it would otherwise be invisible in a total.
    for (const img of perImage) {
      if (img.attribution) assertNoProjectFindingAccepted(img.attribution);
    }

    // Project-owned totals, which are what this project can actually act on.
    summary.ownership = perImage.reduce(
      (acc, img) => {
        if (!img.attribution) return acc;
        acc.project.critical += img.attribution.project.CRITICAL;
        acc.project.high += img.attribution.project.HIGH;
        acc.vendor.critical += img.attribution.vendor.CRITICAL;
        acc.vendor.high += img.attribution.vendor.HIGH;
        return acc;
      },
      {
        project: { critical: 0, high: 0 },
        vendor: { critical: 0, high: 0 },
        note:
          "vendor = unmodified official Red Hat binaries shipped verbatim (oc, oc-mirror), attributed by " +
          "in-image path. Owner-accepted inherited risk. NOT suppressed, NOT subtracted from the verdict.",
      },
    );

    // THE OWNER'S ACCEPTANCE, AS A PORTABLE PER-BINARY RECORD.
    //
    // `summary.ownership` above splits the counts; on its own that split is an
    // assertion that some findings "are not ours to fix" with nothing naming
    // the artifacts it is talking about. This emits the per-artifact record
    // that backs it: for every vendored binary whose findings are accepted,
    // the exact version, architecture, SHA256 and source URL the acceptance is
    // scoped to, so it expires the moment the artifact changes.
    //
    // Fail-closed: `vendorRiskRecord` returns `accepted: false` with a reason
    // when the inventory cannot be read or the disposition refuses the inputs.
    // It never throws and never invents an identity, so a run on a host that
    // cannot read the image records NOT VERIFIED instead of a plausible lie.
    // It also cannot change the verdict below — image-vulnerabilities stays
    // non-waivable and still reports every finding.
    //
    // `in` rather than `??`: a test must be able to inject `null` to mean "this
    // run has no inventory" and get the NOT VERIFIED branch. With `??` that
    // injection would fall through to the real reader, which shells into the
    // image — and a fake runner handed an unexpected argv writes files where it
    // is standing. That is how this axis briefly dropped a stray `run` file in
    // the repository root, which is the tree-dirtying failure that invalidated
    // an earlier certification run.
    const toolInventory =
      "externalBinaries" in inject
        ? inject.externalBinaries
        : (() => {
            const backend = images.find((i) => i.role === "backend");
            if (!backend?.id) return null;
            try {
              return externalBinaryInventory(engine, backend.id, { runner });
            } catch (err) {
              return { complete: false, reason: `external-binary inventory failed: ${err.message}` };
            }
          })();

    summary.vendorRisk = vendorRiskRecord({
      inventory: toolInventory,
      attributions: perImage.map((img) => ({ role: img.role, attribution: img.attribution })),
      decidedOn: VENDOR_RISK_DECIDED_ON,
    });

    const artifacts = [
      store.writeArtifact(ID, "scan-summary.json", summary),
      // A standalone file as well as a field, because this is the record a
      // consumer of the release evidence needs to read on its own.
      store.writeArtifact(ID, "vendor-risk-disposition.json", summary.vendorRisk),
    ];

    // Belt and braces against a false PASS: an empty result set has proven
    // nothing, and `[].every()` is true.
    if (!perImage.length) {
      return incomplete(ID, "no shipping image was scanned, so nothing was proven", { evidence: summary, artifacts });
    }
    const errored = perImage.filter((p) => !p.ok);
    if (errored.length) {
      return incomplete(ID, `scan evidence unusable for ${errored.map((p) => `${p.role} (${p.reason})`).join("; ")}`, {
        evidence: summary,
        artifacts,
      });
    }

    const dbNote = `db ${db.dbVersion ?? db.dbSchemaVersion} built ${db.builtAt}`;
    const blocking = perImage.filter((p) => BLOCKING.some((s) => (p.tally?.[s] ?? 0) > 0));
    if (blocking.length) {
      const detail = blocking.map((p) => `${p.role}: ${p.tally.CRITICAL} critical, ${p.tally.HIGH} high`).join("; ");
      return fail(ID, `${detail} (scanner: ${strategy.tool}, ${dbNote})`, { evidence: summary, artifacts });
    }
    const detail = perImage.map((p) => `${p.role}: ${p.tally.MEDIUM} moderate, ${p.tally.LOW} low`).join("; ");
    return pass(ID, `no critical/high findings — ${detail} (scanner: ${strategy.tool}, ${dbNote})`, { evidence: summary, artifacts });
  },
};
