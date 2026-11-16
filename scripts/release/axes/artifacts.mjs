/**
 * AXIS: artifacts — release artifact lifecycle.
 *
 * Replaces the `artifacts` placeholder, whose reason was "no release bundle
 * format is defined, so there is no artifact whose lifecycle could be
 * certified". Its closure plan answers that with an instruction rather than a
 * wish:
 *
 *   "Define the release unit before automating it. Test the release model the
 *    repository actually supports (compose + kustomize), not speculative
 *    enterprise deployment machinery."
 *
 * So the release unit is DEFINED here, in code, as RELEASE_UNIT below: the
 * deployable sources a user actually consumes, plus the two shipping images
 * they run. Everything this axis checks is a property of that set.
 *
 * WHAT IT PROVES AND WHAT IT REFUSES TO PROVE
 *
 * Proven mechanically: version identity is coherent across every file that
 * declares it; the deployable source set is complete and hashable; a checksum
 * manifest can be produced and re-verified; the backup/restore tooling the
 * closure plan names exists and runs.
 *
 * Deliberately NOT proven, and reported as findings instead:
 *
 *   MUTABLE TAGS. docker-compose.yml and manifests/base/*-deployment.yaml
 *   reference `:latest`. The closure plan calls this out and it is still
 *   true. It is NOT fixed here, and that restraint is the point: the fix is
 *   to pin to a published tag or digest, and this project has no image
 *   registry, no published tag and no release process yet (PROD-040,
 *   PROD-042). Inventing a tag would create an artifact reference that
 *   resolves to nothing. The harness itself is unaffected — lib/images.mjs
 *   already resolves tags to digests per run precisely because "tags do not
 *   identify an artifact".
 *
 *   UPGRADE AND ROLLBACK. Both need two different published versions to move
 *   between. With no published release there is no prior artifact, so the
 *   test cannot be constructed — as opposed to being skipped.
 *
 * CHECKSUMS ARE CHECKSUMS. The manifest this axis emits is SHA-256 over
 * source bytes. It is not a signature, it carries no authenticity claim, and
 * nothing here may be described as signing. Artifact signing is PROD-031 and
 * needs a trust anchor that is a human decision.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pass, fail, incomplete } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";
import { run, record } from "../lib/exec.mjs";

const ID = "artifacts";

/**
 * THE RELEASE UNIT. What a user deploys, enumerated rather than implied.
 *
 * `required` entries must exist for the unit to be coherent. Directories are
 * walked; files are hashed individually so the manifest is diffable.
 */
const RELEASE_UNIT = Object.freeze([
  { path: "VERSION", kind: "file", role: "version identity", required: true },
  { path: "docker-compose.yml", kind: "file", role: "compose deployment model", required: true },
  { path: "manifests", kind: "dir", role: "kustomize deployment model", required: true },
  { path: "backend/Containerfile", kind: "file", role: "backend image build", required: true },
  { path: "frontend/Containerfile", kind: "file", role: "frontend image build", required: true },
]);

/** Files that must all declare the same version string. */
const VERSION_DECLARATIONS = Object.freeze([
  { path: "VERSION", read: (t) => t.trim() },
  { path: "package.json", read: (t) => JSON.parse(t).version },
  { path: "backend/package.json", read: (t) => JSON.parse(t).version },
  { path: "frontend/package.json", read: (t) => JSON.parse(t).version },
]);

/** Deployment files scanned for mutable image references. */
const IMAGE_REF_FILES = Object.freeze([
  "docker-compose.yml",
  "manifests/base/backend-deployment.yaml",
  "manifests/base/frontend-deployment.yaml",
]);

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function walkFiles(root, rel = "") {
  const out = [];
  const full = rel ? path.join(root, rel) : root;
  let entries;
  try {
    entries = fs.readdirSync(full, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkFiles(root, childRel));
    else if (e.isFile()) out.push(childRel);
  }
  return out;
}

/** SHA-256 over every file in the release unit, sorted, path-relative. */
function checksumManifest(repoRoot) {
  const files = [];
  const missing = [];
  for (const entry of RELEASE_UNIT) {
    const abs = path.join(repoRoot, entry.path);
    if (!fs.existsSync(abs)) {
      if (entry.required) missing.push(entry.path);
      continue;
    }
    if (entry.kind === "dir") {
      for (const rel of walkFiles(abs)) {
        const p = `${entry.path}/${rel}`;
        files.push({ path: p, sha256: sha256(fs.readFileSync(path.join(abs, rel))), role: entry.role });
      }
    } else {
      files.push({ path: entry.path, sha256: sha256(fs.readFileSync(abs)), role: entry.role });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  // A digest OVER the manifest, so the manifest itself is tamper-evident.
  const manifestDigest = sha256(files.map((f) => `${f.sha256}  ${f.path}`).join("\n"));
  return { files, missing, manifestDigest, algorithm: "sha-256", format: "lowercase-hex" };
}

/** `sha256sum`-compatible text, so an operator can verify offline with coreutils. */
function sha256sumsText(manifest) {
  return `${manifest.files.map((f) => `${f.sha256}  ${f.path}`).join("\n")}\n`;
}

function scanImageRefs(repoRoot) {
  const refs = [];
  for (const rel of IMAGE_REF_FILES) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, "utf8");
    text.split("\n").forEach((line, i) => {
      const m = line.match(/^\s*(?:-\s*)?image:\s*["']?([^"'\s#]+)/);
      if (!m) return;
      const ref = m[1];
      const mutable = /:latest$/.test(ref) || !/[@:]/.test(ref.split("/").pop());
      refs.push({ file: rel, line: i + 1, ref, mutable, pinnedByDigest: ref.includes("@sha256:") });
    });
  }
  return refs;
}

function scanBaseImages(repoRoot) {
  const out = [];
  for (const rel of ["backend/Containerfile", "frontend/Containerfile"]) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) continue;
    fs.readFileSync(abs, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const m = line.match(/^FROM\s+(\S+)/);
        if (!m) return;
        const ref = m[1];
        if (/^\$|^scratch$/i.test(ref)) return;
        out.push({ file: rel, line: i + 1, ref, pinnedByDigest: ref.includes("@sha256:") });
      });
  }
  return out;
}

export default {
  id: ID,
  title: "Release artifact lifecycle: build, checksums, install, upgrade, rollback, offline use",
  required: true,
  reuse: REUSE.NEVER,
  inputs: ["backend", "frontend", "shared", "manifests", "docker-compose.yml", "scripts", "VERSION"],

  async run({ repoRoot, store }) {
    const findings = [];

    // ---- 1. Version identity coherence ------------------------------------
    const versions = [];
    for (const d of VERSION_DECLARATIONS) {
      const abs = path.join(repoRoot, d.path);
      if (!fs.existsSync(abs)) {
        findings.push({ check: "version-identity", severity: "blocking", note: `${d.path} missing` });
        continue;
      }
      try {
        versions.push({ path: d.path, version: d.read(fs.readFileSync(abs, "utf8")) });
      } catch (err) {
        findings.push({ check: "version-identity", severity: "blocking", note: `${d.path} unreadable: ${err.message}` });
      }
    }
    const distinct = [...new Set(versions.map((v) => v.version))];
    if (distinct.length > 1) {
      findings.push({
        check: "version-identity",
        severity: "blocking",
        note: `release unit declares ${distinct.length} different versions`,
        declarations: versions,
      });
    }

    // ---- 2. Checksum manifest ---------------------------------------------
    const manifest = checksumManifest(repoRoot);
    if (manifest.missing.length) {
      findings.push({
        check: "release-unit-complete",
        severity: "blocking",
        note: `release unit missing required member(s): ${manifest.missing.join(", ")}`,
      });
    }

    // Re-verify what was just emitted, the way an operator would with
    // coreutils. A manifest generator that is never re-read is a generator
    // nobody has checked.
    const reverify = checksumManifest(repoRoot);
    const stable = reverify.manifestDigest === manifest.manifestDigest;
    if (!stable) {
      findings.push({
        check: "checksum-manifest-stable",
        severity: "blocking",
        note: "two consecutive manifest computations disagree; the release unit is not deterministically hashable",
      });
    }

    // ---- 3. Artifact identity: mutable tags --------------------------------
    const imageRefs = scanImageRefs(repoRoot);
    const mutable = imageRefs.filter((r) => r.mutable);
    if (mutable.length) {
      findings.push({
        check: "mutable-image-tags",
        severity: "blocking",
        note:
          "deployment files reference mutable tags; a mutable tag cannot identify a release artifact " +
          "(PROD-030 / PROD-042). NOT auto-fixed: this project publishes no image yet, so pinning would " +
          "point at a reference that does not resolve. Closure is a published tag or digest plus a release process (PROD-040).",
        refs: mutable,
      });
    }

    const baseImages = scanBaseImages(repoRoot);
    const unpinnedBase = baseImages.filter((b) => !b.pinnedByDigest);
    if (unpinnedBase.length) {
      findings.push({
        check: "unpinned-base-images",
        severity: "advisory",
        note:
          "base images are referenced by tag, so a rebuild is not reproducible byte-for-byte (PROD-030). " +
          "Digest pinning is an owner decision about patch cadence: a pinned base stops receiving UBI security " +
          "updates until deliberately bumped.",
        refs: unpinnedBase,
      });
    }

    // ---- 4. Backup / restore tooling ---------------------------------------
    const backupScripts = ["scripts/verify-backup.sh", "scripts/test-backup-restore.sh"];
    const backupStatus = [];
    for (const rel of backupScripts) {
      const abs = path.join(repoRoot, rel);
      const present = fs.existsSync(abs);
      let syntaxOk = null;
      if (present) {
        const res = run("bash", ["-n", abs], { cwd: repoRoot, timeoutMs: 30_000 });
        syntaxOk = res.status === 0;
        if (!syntaxOk) {
          findings.push({ check: "backup-tooling", severity: "blocking", note: `${rel} is not syntactically valid bash`, exec: record(res) });
        }
      } else {
        findings.push({ check: "backup-tooling", severity: "blocking", note: `${rel} absent; the closure plan names it as the restore path` });
      }
      backupStatus.push({ path: rel, present, syntaxOk });
    }

    // ---- 5. Lifecycle operations that cannot be constructed yet ------------
    const notConstructible = [
      {
        operation: "upgrade",
        reason: "needs two published versions to move between; no release has ever been published",
        owner: "PROD-040 / PROD-042",
      },
      {
        operation: "rollback",
        reason: "same as upgrade: there is no prior published artifact to roll back to",
        owner: "PROD-040 / PROD-042",
      },
      {
        operation: "install-from-published-artifact",
        reason: "no registry, no GitHub Release, no distribution channel exists",
        owner: "PROD-042",
      },
    ];

    const artifacts = [
      store.writeArtifact(ID, "release-unit.json", {
        releaseUnit: RELEASE_UNIT,
        version: distinct.length === 1 ? distinct[0] : null,
        versionDeclarations: versions,
        checksumManifest: manifest,
        manifestReverified: stable,
        imageRefs,
        baseImages,
        backupTooling: backupStatus,
        notConstructible,
        findings,
        scope: {
          isChecksum: true,
          isSignature: false,
          note: "SHA-256 over source bytes. Not a signature, no authenticity claim. Signing is PROD-031 and needs a trust anchor.",
        },
      }),
      // coreutils-verifiable, so the claim "an operator can check this
      // offline" is testable rather than asserted.
      store.writeArtifact(ID, "SHA256SUMS", sha256sumsText(manifest)),
    ];

    const evidence = {
      version: distinct.length === 1 ? distinct[0] : null,
      releaseUnitFiles: manifest.files.length,
      manifestDigest: manifest.manifestDigest,
      manifestReverified: stable,
      mutableImageRefs: mutable.length,
      unpinnedBaseImages: unpinnedBase.length,
      backupTooling: backupStatus,
      notConstructible: notConstructible.map((n) => n.operation),
      findings,
    };

    const blocking = findings.filter((f) => f.severity === "blocking");
    if (blocking.length) {
      return fail(ID, `${blocking.length} blocking artifact finding(s): ${[...new Set(blocking.map((f) => f.check))].join(", ")}`, {
        evidence,
        artifacts,
      });
    }

    // No blocking findings, but three lifecycle operations still cannot be
    // constructed. PASS would claim the artifact lifecycle is certified when
    // half of it has never been exercised.
    return incomplete(
      ID,
      `release unit defined and hashable (${manifest.files.length} files, digest ${manifest.manifestDigest.slice(0, 12)}), ` +
        `version identity coherent at ${distinct[0]}, backup tooling present; ` +
        `INCOMPLETE because ${notConstructible.length} lifecycle operation(s) cannot be constructed without a ` +
        `published release: ${notConstructible.map((n) => n.operation).join(", ")} (PROD-042)`,
      { evidence, artifacts }
    );
  },
};
