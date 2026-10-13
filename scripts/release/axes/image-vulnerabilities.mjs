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
 * FOUR PRECONDITIONS, each of which must hold before a scan result means
 * anything. Any one of them failing is INCOMPLETE, never PASS:
 *
 *   1. COMPLETE SHIPPING SET. Both backend and frontend ship. Scanning
 *      whichever image happens to exist locally would certify half a release.
 *   2. CANDIDATE PROVENANCE. A stale local image passes every scan while
 *      containing none of the source being certified. See lib/provenance.mjs.
 *   3. A SCANNER. Native Trivy, native Grype, or a digest-pinned container.
 *   4. AN IDENTIFIED VULNERABILITY DATABASE. A pinned scanner fixes the code
 *      that reads advisories, not the advisories. See lib/scannerdb.mjs.
 *
 * ONE ARTIFACT FOR EVERY STRATEGY. All three strategies scan the same OCI
 * archive, exported once per run from the resolved image ID and shared with
 * the SBOM axis. Letting each scanner reach into the local image store with
 * its own source auto-detection would mean the bytes scanned are not provably
 * the bytes reported, which is exactly what §10 of the tranche forbids.
 *
 * Both scanners' JSON is normalised to one severity tally so the release
 * policy is expressed once and does not change if the scanner does.
 */

import fs from "node:fs";
import { pass, fail, incomplete } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";
import { run, hasTool, record } from "../lib/exec.mjs";
import { REQUIRED_ROLES } from "../lib/images.mjs";
import { verifyShippingSet } from "../lib/provenance.mjs";
import { parseTrivyDb, parseGrypeDb, evaluateDb, ageDays } from "../lib/scannerdb.mjs";

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
 * approval. 8D owns pinning them; until then this axis reports INCOMPLETE.
 */
export const CONTAINERIZED_SCANNER = Object.freeze({
  tool: "trivy",
  image: "docker.io/aquasec/trivy",
  tag: null,
  digest: null,
});

/** Release policy: these severities block. */
const BLOCKING = ["CRITICAL", "HIGH"];
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
export function selectStrategy({ nativeTrivy = hasTool("trivy"), nativeGrype = hasTool("grype"), engine = null } = {}) {
  if (nativeTrivy) return { kind: "native-trivy", tool: "trivy" };
  if (nativeGrype) return { kind: "native-grype", tool: "grype" };
  if (engine && CONTAINERIZED_SCANNER.digest) {
    return { kind: "containerized-trivy", tool: `${CONTAINERIZED_SCANNER.image}@${CONTAINERIZED_SCANNER.digest}` };
  }
  return {
    kind: null,
    reason: engine
      ? `no native trivy/grype on PATH, and the containerized scanner ${CONTAINERIZED_SCANNER.image} has no approved pinned digest yet`
      : "no native trivy/grype on PATH and no container engine for the containerized fallback",
  };
}

/** Establish which advisory database the scan will consult. */
export function describeDatabase(strategy, engine, now = new Date()) {
  if (strategy.kind === "native-trivy") {
    const res = run("trivy", ["version", "--format", "json"], { timeoutMs: 120_000 });
    if (res.status !== 0) return { identified: false, reason: `trivy version failed: exit ${res.status}` };
    try {
      return parseTrivyDb(JSON.parse(res.stdout), now);
    } catch (err) {
      return { identified: false, reason: `unparseable trivy version output: ${err.message}` };
    }
  }
  if (strategy.kind === "native-grype") {
    const res = run("grype", ["db", "status", "-o", "json"], { timeoutMs: 120_000 });
    if (res.status !== 0) return { identified: false, reason: `grype db status failed: exit ${res.status}` };
    try {
      return parseGrypeDb(JSON.parse(res.stdout));
    } catch (err) {
      return { identified: false, reason: `unparseable grype db status output: ${err.message}` };
    }
  }
  if (strategy.kind === "containerized-trivy") {
    const ref = `${CONTAINERIZED_SCANNER.image}@${CONTAINERIZED_SCANNER.digest}`;
    const res = run(engine, ["run", "--rm", ref, "version", "--format", "json"], { timeoutMs: 300_000 });
    if (res.status !== 0) return { identified: false, reason: `containerized trivy version failed: exit ${res.status}` };
    try {
      return parseTrivyDb(JSON.parse(res.stdout), now);
    } catch (err) {
      return { identified: false, reason: `unparseable trivy version output: ${err.message}` };
    }
  }
  return { identified: false, reason: `no strategy` };
}

/** Scan one already-exported OCI archive. Every strategy reads the same bytes. */
function scanArchive(strategy, engine, archivePath, outPath) {
  if (strategy.kind === "native-trivy") {
    const res = run("trivy", ["image", "--quiet", "--input", archivePath, "--format", "json", "--output", outPath, "--scanners", "vuln"], {
      timeoutMs: 30 * 60_000,
    });
    if (res.status !== 0) return { ok: false, run: record(res), stderr: res.stderr.slice(0, 2000) };
    return { ok: true, ...normaliseTrivy(JSON.parse(fs.readFileSync(outPath, "utf8"))), run: record(res) };
  }
  if (strategy.kind === "native-grype") {
    const res = run("grype", [`oci-archive:${archivePath}`, "-o", "json"], { timeoutMs: 30 * 60_000 });
    if (res.status !== 0) return { ok: false, run: record(res), stderr: res.stderr.slice(0, 2000) };
    fs.writeFileSync(outPath, res.stdout);
    return { ok: true, ...normaliseGrype(JSON.parse(res.stdout)), run: record(res) };
  }
  if (strategy.kind === "containerized-trivy") {
    const ref = `${CONTAINERIZED_SCANNER.image}@${CONTAINERIZED_SCANNER.digest}`;
    const dir = archivePath.slice(0, archivePath.lastIndexOf("/"));
    const base = archivePath.slice(archivePath.lastIndexOf("/") + 1);
    const res = run(
      engine,
      ["run", "--rm", "-v", `${dir}:/scan:z`, ref, "image", "--quiet", "--format", "json", "--input", `/scan/${base}`],
      { timeoutMs: 45 * 60_000 },
    );
    if (res.status !== 0) return { ok: false, run: record(res), stderr: res.stderr.slice(0, 2000) };
    fs.writeFileSync(outPath, res.stdout);
    return { ok: true, ...normaliseTrivy(JSON.parse(res.stdout)), run: record(res) };
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

  async run({ store, shippingImages, candidate, buildManifest, archives, now = new Date() }) {
    const { engine, images } = shippingImages;

    // 1 + 2. Complete set and candidate provenance.
    const set = verifyShippingSet(images, candidate, buildManifest, REQUIRED_ROLES);
    if (!set.ok) {
      return incomplete(ID, set.reason, {
        evidence: { provenance: set, requiredRoles: REQUIRED_ROLES },
        artifacts: [store.writeArtifact(ID, "provenance.json", set)],
      });
    }

    // 3. A scanner.
    const strategy = selectStrategy({ engine });
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

    // 4. An identified advisory database.
    const db = describeDatabase(strategy, engine, now);
    const dbVerdict = evaluateDb(db);
    if (!dbVerdict.acceptable) {
      return incomplete(ID, `vulnerability database unusable as evidence — ${dbVerdict.reason}`, {
        evidence: { strategy, database: db, databaseVerdict: dbVerdict },
        artifacts: [store.writeArtifact(ID, "database.json", { strategy, database: db, verdict: dbVerdict })],
      });
    }

    const perImage = [];
    for (const img of images) {
      const archive = archives.archiveFor(img);
      if (!archive.ok) {
        perImage.push({ role: img.role, id: img.id, ok: false, reason: `OCI export failed: ${archive.reason}` });
        continue;
      }
      const outPath = store.artifactPath(ID, `${img.role}.scan.json`);
      const scan = scanArchive(strategy, engine, archive.path, outPath);
      perImage.push({
        role: img.role,
        ref: img.ref,
        id: img.id,
        architecture: `${img.os}/${img.architecture}`,
        scannedArtifact: "oci-archive exported from the resolved image id",
        ...scan,
      });
    }

    const summary = {
      strategy,
      database: { ...db, ageDays: ageDays(db.builtAt, now) },
      databaseVerdict: dbVerdict,
      provenance: set,
      perImage,
    };
    const artifacts = [store.writeArtifact(ID, "scan-summary.json", summary)];

    const errored = perImage.filter((p) => !p.ok);
    if (errored.length) {
      return incomplete(ID, `scan failed for ${errored.map((p) => p.role).join(", ")} using ${strategy.kind}`, {
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
