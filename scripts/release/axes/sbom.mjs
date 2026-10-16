/**
 * AXIS: component-inventory — SBOMs plus the external binaries they omit.
 *
 * PROD-023. NON-WAIVABLE, for the same reason as the vulnerability scan:
 * Tranche 8 requires the gap closed, not waived.
 *
 * THE AXIS IS CALLED "component-inventory", NOT "sbom", DELIBERATELY. An
 * earlier revision titled itself "SBOM generation for shipping images and
 * packaged external binaries" and then satisfied the second half by attaching
 * `/app/tools-provenance.env` beside the SBOM. That overstated what it
 * produced. A package-manager scanner inventories what a package manager can
 * see: RPMs from the UBI 9 base layers and the backend's npm tree. `oc` and
 * `oc-mirror` are `curl`-ed tarballs unpacked into /usr/local/bin by the
 * Containerfile — no package database records them, so they do NOT appear as
 * components in the generated documents, and saying "the SBOM covers the
 * external binaries" would be false.
 *
 * ── THE THREE DOCUMENTS (8D), AND WHY NONE OF THEM IS OPTIONAL ─────────────
 *
 *   1. IMAGE-WALKED SBOM. A generator that reads the IMAGE: every file in
 *      every layer, not a lockfile on the build host. This is the document
 *      that can see a vendored copy, a hand-unpacked tarball, or a file a
 *      later layer left behind. It needs syft or trivy, and until one is
 *      available the axis is INCOMPLETE — that has not changed.
 *
 *   2. OFFLINE COMPONENT INVENTORY (new). `provenance/sbomGenerate.mjs`
 *      produces a deterministic CycloneDX document from the two lockfiles and
 *      from `rpm -qa` executed INSIDE each image. It needs no scanner, no
 *      network and no pinned digest, so it is produced on EVERY run. It is
 *      explicitly NOT a substitute for (1) — its own metadata says so, and
 *      `oaa:doesNotCover` enumerates the four things no package manager sees.
 *      What it buys is that the axis now yields real, reviewable, reproducible
 *      evidence while (1) is blocked, instead of an empty INCOMPLETE.
 *
 *   3. EXTERNAL-BINARIES DOCUMENT. Now built by
 *      `provenance/toolProvenance.mjs externalBinaryInventory()` rather than
 *      by this file's `parseToolProvenance()`. Three things it does that the
 *      old reader did not: it distinguishes the DISTRIBUTION-TARBALL checksum
 *      recorded at build time from the INSTALLED-BINARY checksum measured in
 *      the image (they are different artifacts and were being conflated); it
 *      covers `openshift-install` and `mirror-registry`, which are shipped to
 *      users and appear in no image and no env file; and it records each
 *      tool's verification posture, including the two that are NOT
 *      checksum-verified.
 *
 * Neither document alone is the component inventory. A missing or unparseable
 * companion document makes the axis INCOMPLETE rather than letting a partial
 * inventory read as complete.
 *
 * ── SUBJECT BINDING IS NOW REQUIRED, AND IT IS A TIGHTENING ────────────────
 *
 * An SBOM that does not name the image it describes is unverifiable paperwork.
 * Verified against the pinned trivy binary on 2026-10-14: scanning a converted
 * OCI layout yields `metadata.component.name = "/scan/layout"` — the MOUNT
 * PATH — and the only field identifying the subject is
 * `aquasecurity:trivy:ImageID`, which equals podman's `.Id` (the CONFIG
 * digest). `releaseEvidence.sbomSubjectConsistency()` binds on exactly that
 * and refuses `ArtifactName`/`name` as evidence of anything.
 *
 * The binding is implemented and verified for TRIVY output only. Syft's
 * CycloneDX subject fields have never been observed here — syft is on no host
 * this has run on and has no approved pinned digest — so a syft document is
 * reported as UNBOUND and the axis stays INCOMPLETE rather than accepting a
 * document whose subject nobody checked. That is deliberately stricter than
 * the previous revision, which would have PASSED on a syft SBOM with no
 * subject check at all.
 *
 * ── REPRODUCIBILITY ────────────────────────────────────────────────────────
 *
 * The offline inventory is generated TWICE from the same inputs and the two
 * runs are compared with `releaseEvidence.assessSbomReproducibility()`, which
 * reports byte-identity and canonical identity separately. For this generator
 * both hold (the serial number is content-derived and the timestamp is
 * injected). For trivy's own CycloneDX only the canonical form is stable —
 * verified: identical length, different sha256, because of a random serial
 * number, a wall-clock timestamp, random per-component bom-refs AND the array
 * permutation those refs induce.
 *
 * FORMAT: CycloneDX 1.5 for the offline inventory; SPDX 2.3 JSON primary plus
 * CycloneDX alternate when syft is the image-walking generator.
 *
 * The format choice is a PROJECT AND TOOLCHAIN decision, not a regulatory one.
 * An earlier revision claimed US federal guidance effectively selects SPDX;
 * that is not accurate. NTIA's minimum-elements work explicitly recognises
 * multiple interoperable machine-readable formats — SPDX, CycloneDX and SWID
 * — and deliberately does not name a winner.
 */

import fs from "node:fs";
import path from "node:path";
import { pass, incomplete } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";
import { run, hasTool, record } from "../lib/exec.mjs";
import { runInImage, REQUIRED_ROLES } from "../lib/images.mjs";
import { verifyShippingSet } from "../lib/provenance.mjs";
import { classifyDigests } from "../provenance/candidateBinding.mjs";
import {
  assessSbomReproducibility,
  canonicalizeCycloneDx,
  evidenceManifest,
  sbomSubjectConsistency,
} from "../provenance/releaseEvidence.mjs";
import { generateInventory, rpmComponentsFromImage } from "../provenance/sbomGenerate.mjs";
import { externalBinaryInventory } from "../provenance/toolProvenance.mjs";

const ID = "component-inventory";

export const SBOM_FORMATS = Object.freeze({ primary: "spdx-json", alternate: "cyclonedx-json" });

/** As with the scanner: pinned by digest before use, never by floating tag. */
export const CONTAINERIZED_GENERATOR = Object.freeze({
  tool: "syft",
  image: "docker.io/anchore/syft",
  tag: null,
  digest: null,
});

/**
 * The trivy alternative to syft for document (1).
 *
 * Trivy walks the image exactly as it does for a vulnerability scan and emits
 * CycloneDX, so the same pinned binary and the same converted OCI layout serve
 * both axes. Kept as its own constant rather than imported from
 * image-vulnerabilities.mjs so that approving a scanner digest and approving
 * an SBOM-generator digest remain two separate, reviewable decisions.
 */
// PINNED 2026-10-14 to the multi-arch INDEX digest, re-resolved at pinning
// time; see the matching note in axes/image-vulnerabilities.mjs for how the
// index was distinguished from the amd64 manifest. Kept as a separate
// constant on purpose: approving a scanner and approving an SBOM generator
// stay two independently reviewable decisions even when they name the same
// image today. Syft remains unpinned and therefore unavailable.
export const CONTAINERIZED_TRIVY_GENERATOR = Object.freeze({
  tool: "trivy",
  image: "docker.io/aquasec/trivy",
  tag: "0.75.0",
  digest: "sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa",
});

/** Fields the backend image must record for each baked-in external binary. */
export const REQUIRED_TOOL_FIELDS = Object.freeze([
  "OC_RESOLVED_VERSION",
  "OC_RESOLVED_SHA256",
  "OC_MIRROR_RESOLVED_VERSION",
  "OC_MIRROR_RESOLVED_SHA256",
  "TOOLS_RESOLVED_ARCH",
]);

/**
 * Syft selection, unchanged.
 *
 * Deliberately NOT widened to consider trivy: its contract is "is syft
 * available", and the axis's generator choice lives in
 * `selectImageSbomGenerator()` below. Widening this function would also make
 * its unit tests depend on whether the host happens to have trivy installed.
 */
export function selectGenerator({ nativeSyft = hasTool("syft"), engine = null } = {}) {
  if (nativeSyft) return { kind: "native-syft", tool: "syft" };
  if (engine && CONTAINERIZED_GENERATOR.digest) {
    return { kind: "containerized-syft", tool: `${CONTAINERIZED_GENERATOR.image}@${CONTAINERIZED_GENERATOR.digest}` };
  }
  return {
    kind: null,
    reason: engine
      ? `syft is not on PATH and ${CONTAINERIZED_GENERATOR.image} has no approved pinned digest yet`
      : "syft is not on PATH and there is no container engine for the containerized fallback",
  };
}

/**
 * Which generator will produce the IMAGE-WALKED document.
 *
 * Syft first, because it emits SPDX and CycloneDX from one scan and SPDX is
 * what disconnected and government OpenShift customers most often ask for.
 * Trivy second, because its subject binding is the one that has actually been
 * verified here.
 */
// `generator` is injectable for the same reason as `scanner` in
// axes/image-vulnerabilities.mjs: the "unpinned means unavailable" invariant
// must stay testable with a fixture after a real digest is approved.
export function selectImageSbomGenerator({
  nativeSyft = hasTool("syft"),
  nativeTrivy = hasTool("trivy"),
  engine = null,
  generator = CONTAINERIZED_TRIVY_GENERATOR,
} = {}) {
  const syft = selectGenerator({ nativeSyft, engine });
  if (syft.kind) return { ...syft, formats: Object.values(SBOM_FORMATS), subjectBindingVerified: false };
  if (nativeTrivy) return { kind: "native-trivy", tool: "trivy", formats: ["cyclonedx-json"], subjectBindingVerified: true };
  if (engine && generator.digest) {
    return {
      kind: "containerized-trivy",
      tool: `${generator.image}@${generator.digest}`,
      formats: ["cyclonedx-json"],
      subjectBindingVerified: true,
    };
  }
  return {
    kind: null,
    reason:
      `${syft.reason}; trivy is not on PATH and ${generator.image} has no approved pinned digest yet. ` +
      "An image-walked SBOM is the one document a lockfile cannot stand in for.",
  };
}

/**
 * Parse `tools-provenance.env` into a component list. Pure, so it is testable.
 *
 * RETAINED as the minimal structural reader. The axis itself now uses
 * `provenance/toolProvenance.mjs`, which is strictly stronger: it additionally
 * requires both CHANNEL fields, validates each sha256's shape, reconstructs
 * the source URL, measures the installed binary inside the image and asserts
 * that the measured and recorded checksums DIFFER (they cover different
 * artifacts, so equality means one of the two values is wrong).
 */
export function parseToolProvenance(text) {
  const entries = Object.fromEntries(
    String(text ?? "")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
  const missing = REQUIRED_TOOL_FIELDS.filter((f) => !entries[f]);
  if (missing.length) return { ok: false, missing, entries };

  return {
    ok: true,
    entries,
    components: [
      {
        name: "oc",
        version: entries.OC_RESOLVED_VERSION,
        checksum: { algorithm: "SHA256", value: entries.OC_RESOLVED_SHA256 },
        architecture: entries.TOOLS_RESOLVED_ARCH,
        sourceChannel: entries.OC_RESOLVED_CHANNEL ?? null,
        origin: "mirror.openshift.com, verified against the channel's sha256sum.txt at build time",
      },
      {
        name: "oc-mirror",
        version: entries.OC_MIRROR_RESOLVED_VERSION,
        checksum: { algorithm: "SHA256", value: entries.OC_MIRROR_RESOLVED_SHA256 },
        architecture: entries.TOOLS_RESOLVED_ARCH,
        sourceChannel: entries.OC_MIRROR_RESOLVED_CHANNEL ?? null,
        origin: "mirror.openshift.com, verified against the channel's sha256sum.txt at build time",
      },
    ],
  };
}

/** Read the raw build-time tool provenance out of the delivered image. */
export function readToolProvenance(engine, img) {
  const res = runInImage(engine, img.id, ["/bin/sh", "-c", "cat /app/tools-provenance.env 2>/dev/null || true"]);
  if (res.status !== 0 || !res.stdout.trim()) {
    return { ok: false, missing: REQUIRED_TOOL_FIELDS, reason: "/app/tools-provenance.env absent or empty in the image" };
  }
  return parseToolProvenance(res.stdout);
}

/**
 * Generate the image-walked document for one prepared scan input.
 *
 * Every trivy path reads the VERIFIED OCI LAYOUT DIRECTORY, never the archive
 * tar: `--input <tar>` cannot work (see provenance/scanInput.mjs, reproduced
 * against the pinned binary). Syft keeps the `oci-archive:` transport it
 * already used, because scanInput.mjs marks `oci-dir:` for syft as documented
 * but unverified and an unverifiable change does not belong here.
 */
export function generateImageSbom(generator, engine, input, format, outPath, { runner = run } = {}) {
  if (generator.kind === "native-syft") {
    const res = runner("syft", ["scan", `oci-archive:${input.archivePath}`, "-o", `${format}=${outPath}`, "-q"], { timeoutMs: 30 * 60_000 });
    return res.status === 0 ? { ok: true, run: record(res) } : { ok: false, run: record(res), stderr: res.stderr.slice(0, 2000) };
  }
  if (generator.kind === "containerized-syft") {
    const ref = `${CONTAINERIZED_GENERATOR.image}@${CONTAINERIZED_GENERATOR.digest}`;
    const dir = path.dirname(input.archivePath);
    const base = path.basename(input.archivePath);
    const res = runner(engine, ["run", "--rm", "--network=none", "-v", `${dir}:/scan:ro,z`, ref, "scan", `oci-archive:/scan/${base}`, "-o", format, "-q"], {
      timeoutMs: 45 * 60_000,
    });
    if (res.status !== 0) return { ok: false, run: record(res), stderr: res.stderr.slice(0, 2000) };
    fs.writeFileSync(outPath, res.stdout);
    return { ok: true, run: record(res) };
  }
  if (generator.kind === "native-trivy") {
    const res = runner("trivy", ["image", "--quiet", "--input", input.layoutPath, "--format", "cyclonedx", "--output", outPath], {
      timeoutMs: 30 * 60_000,
    });
    return res.status === 0 ? { ok: true, run: record(res) } : { ok: false, run: record(res), stderr: res.stderr.slice(0, 2000) };
  }
  if (generator.kind === "containerized-trivy") {
    const ref = `${CONTAINERIZED_TRIVY_GENERATOR.image}@${CONTAINERIZED_TRIVY_GENERATOR.digest}`;
    const parent = path.dirname(input.layoutPath);
    const base = path.basename(input.layoutPath);
    const res = runner(
      engine,
      ["run", "--rm", "--network=none", "-v", `${parent}:/scan:ro,z`, ref, "image", "--quiet", "--format", "cyclonedx", "--input", `/scan/${base}`],
      { timeoutMs: 45 * 60_000 },
    );
    if (res.status !== 0) return { ok: false, run: record(res), stderr: res.stderr.slice(0, 2000) };
    fs.writeFileSync(outPath, res.stdout);
    return { ok: true, run: record(res) };
  }
  return { ok: false, reason: `unknown generator ${generator.kind}` };
}

/**
 * Does this image-walked document name the image it claims to describe?
 *
 * Implemented for trivy's CycloneDX, where the field has been verified. For a
 * syft document the answer is "not checked", which is reported as UNBOUND —
 * never as consistent-by-default.
 */
export function bindSbomToImage(generator, doc, configDigest) {
  if (generator.kind === "native-trivy" || generator.kind === "containerized-trivy") {
    return { ...sbomSubjectConsistency(doc, { configDigest }), method: "cyclonedx metadata.component aquasecurity:trivy:ImageID" };
  }
  return {
    consistent: false,
    method: null,
    expectedConfigDigest: configDigest,
    observedConfigDigest: null,
    reason:
      `subject binding is not implemented for ${generator.kind}: no syft output has ever been observed on a host this harness has run on, ` +
      "so there is no verified field to bind on. Accepting the document without one would mean shipping an SBOM nobody tied to an image.",
  };
}

export default {
  id: ID,
  title: "Component inventory: package SBOMs plus the external binaries they cannot see",
  required: true,
  nonWaivable: true,
  nonWaivableReason: "Tranche 8 requires SBOM / component-inventory closure before release (PROD-023 / PROD-044).",
  inputs: ["backend/Containerfile", "frontend/Containerfile", "backend/package-lock.json", "frontend/package-lock.json"],
  // NEVER reused. A native syft or trivy resolves from PATH and its version is
  // not in reach of the selection logic, so the generator that produced a
  // prior SBOM cannot be proven to be the one that would run now.
  reuse: REUSE.NEVER,

  /**
   * `inject` is a declared seam, not a back door. certify.mjs never sets it,
   * so the production path is exactly the defaults below; tests use it to
   * drive the fail-closed branches — an unbound SBOM subject, an incomplete
   * external-binary inventory, a refused offline inventory — without syft,
   * trivy, an engine or a network.
   */
  async run({ repoRoot, store, shippingImages, candidate, buildManifest, archives, scanInputs, inject = {} }) {
    const { engine, images } = shippingImages;
    const runner = inject.runner ?? run;

    const set = verifyShippingSet(images, candidate, buildManifest, REQUIRED_ROLES);
    if (!set.ok) {
      return incomplete(ID, set.reason, {
        evidence: { provenance: set, requiredRoles: REQUIRED_ROLES },
        artifacts: [store.writeArtifact(ID, "provenance.json", set)],
      });
    }

    const backend = images.find((i) => i.role === "backend");

    // ── Document 3: external binaries. First, because it needs no generator,
    // so its absence is reported even when the SBOM toolchain is unavailable.
    const externalBinaries = externalBinaryInventory(engine, backend?.id, { runner });
    const artifactPaths = [];
    const writeDoc = (name, body) => {
      const rel = store.writeArtifact(ID, name, body);
      artifactPaths.push(store.artifactPath(ID, name));
      return rel;
    };
    const extArtifact = writeDoc("external-binaries.json", externalBinaries);

    if (!externalBinaries.complete) {
      return incomplete(ID, `external-binary provenance is incomplete (${externalBinaries.reason}); the component inventory would be incomplete`, {
        evidence: { externalBinaries },
        artifacts: [extArtifact],
      });
    }

    // ── Document 2: the offline inventory. Lockfile- and rpmdb-derived, so it
    // is produced on every run with no scanner, no network and no pinned
    // digest. `rpm -qa` runs INSIDE each image, which is the one part of this
    // document that is genuinely image-derived.
    const osInventories = images.map((img) => ({ role: img.role, ...rpmComponentsFromImage(engine, img.id, { imageRole: img.role, runner }) }));
    const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8"));

    let offline;
    try {
      const lockfiles = [
        { component: "backend", lock: readJson("backend/package-lock.json") },
        { component: "frontend", lock: readJson("frontend/package-lock.json") },
      ];
      const subject = {
        type: "application",
        name: "openshift-airgap-architect",
        version: fs.readFileSync(path.join(repoRoot, "VERSION"), "utf8").trim(),
      };
      const subjectImages = images.map((img) => ({
        role: img.role,
        ref: img.ref,
        identity: { id: img.id, digest: null },
        identityDigest: null,
      }));
      // The timestamp is the CANDIDATE's, never the clock: an injected
      // timestamp is what makes two generations of the same candidate
      // byte-identical.
      const spec = { lockfiles, osInventories, externalBinaries, timestamp: candidate.timestamp, subject, subjectImages };
      offline = generateInventory(spec);
      // Generated a second time from the same inputs. Determinism is a claim
      // about this generator, so it is demonstrated rather than asserted.
      offline.second = generateInventory(spec);
    } catch (err) {
      return incomplete(ID, `offline component inventory could not be generated: ${err.message}`, {
        evidence: { externalBinaries, osInventories: osInventories.map((o) => ({ role: o.role, ok: o.ok, reason: o.reason ?? null })) },
        artifacts: [extArtifact],
      });
    }

    if (!offline.ok) {
      return incomplete(ID, `offline component inventory refused: ${offline.problems.join("; ")}`, {
        evidence: { problems: offline.problems, externalBinaries },
        artifacts: [extArtifact, writeDoc("inventory-refused.json", { problems: offline.problems })],
      });
    }

    const offlineBytes = `${JSON.stringify(offline.bom, null, 2)}\n`;
    const offlineBytes2 = `${JSON.stringify(offline.second.bom, null, 2)}\n`;
    const offlineReproducibility = assessSbomReproducibility([
      { bytes: Buffer.from(offlineBytes), document: offline.bom },
      { bytes: Buffer.from(offlineBytes2), document: offline.second.bom },
    ]);
    const offlineArtifact = writeDoc("offline-inventory.cdx.json", offlineBytes);

    if (!offlineReproducibility.ok) {
      return incomplete(ID, `the offline component inventory is not reproducible: ${offlineReproducibility.reason}`, {
        evidence: { offlineReproducibility, tally: offline.tally },
        artifacts: [extArtifact, offlineArtifact],
      });
    }

    // ── Document 1: the image-walked SBOM. The one a lockfile cannot stand in
    // for, and the one that is still blocked.
    const generator = inject.generator ?? selectImageSbomGenerator({ engine });
    if (!generator.kind) {
      return incomplete(ID, `no image-walking SBOM generator available — ${generator.reason}`, {
        evidence: {
          backlogItem: "PROD-023",
          nonWaivable: true,
          formats: SBOM_FORMATS,
          reason: generator.reason,
          produced: {
            offlineInventory: {
              components: offline.bom.components.length,
              tally: offline.tally,
              reproducible: true,
              // Content-derived (RFC 9562 UUIDv8 over the component set), so
              // two runs over the same candidate produce the same value and a
              // changed value is a changed inventory.
              serialNumber: offline.bom.serialNumber,
              sources: offline.sources,
            },
            externalBinaries: { baked: externalBinaries.baked.length, runtimeAcquired: externalBinaries.runtimeAcquired.length },
          },
          stillMissing:
            "a document derived from the IMAGE's filesystem. The offline inventory's npm scopes are lockfile-derived, " +
            "its bundled scope is a declared over-approximation, and neither can see vendored or hand-unpacked content.",
          closure: [
            "Human approves and pins a syft or trivy digest (candidates recorded in the 8A inventory), or installs one on the certification host.",
            "then rerun: npm run release:certify -- --axis component-inventory",
          ],
        },
        artifacts: [extArtifact, offlineArtifact],
      });
    }

    const perImage = [];
    for (const img of images) {
      const digests = classifyDigests({ id: img.id, digest: null, repoDigests: img.repoDigests });
      const base = { role: img.role, ref: img.ref, id: img.id, configDigest: digests.config, architecture: `${img.os}/${img.architecture}` };

      const archive = archives.archiveFor(img);
      if (!archive.ok) {
        perImage.push({ ...base, ok: false, reason: `OCI export failed: ${archive.reason}` });
        continue;
      }
      const layout = scanInputs.layoutFor(img.id, archive.path);
      if (!layout.ok) {
        perImage.push({ ...base, ok: false, reason: `scan input unusable: ${layout.reason}` });
        continue;
      }
      const input = { archivePath: archive.path, layoutPath: layout.path };

      const emitted = {};
      const problems = [];
      let binding = null;
      for (const format of generator.formats) {
        const name = `${img.role}.${format}.json`;
        const outPath = store.artifactPath(ID, name);
        const r = generateImageSbom(generator, engine, input, format, outPath, { runner });
        emitted[format] = { ok: r.ok, path: r.ok ? path.relative(store.root, outPath) : null, stderr: r.stderr ?? null };
        if (!r.ok) {
          problems.push(`${format}: ${r.stderr ?? r.reason ?? "generation failed"}`);
          continue;
        }
        artifactPaths.push(outPath);
        if (format === "cyclonedx-json" || format === "cyclonedx") {
          let doc;
          try {
            doc = JSON.parse(fs.readFileSync(outPath, "utf8"));
          } catch (err) {
            problems.push(`${format}: emitted document is unparseable: ${err.message}`);
            continue;
          }
          binding = bindSbomToImage(generator, doc, digests.config);
          const canonical = canonicalizeCycloneDx(doc);
          emitted[format].componentCount = canonical.ok ? canonical.componentCount : null;
          emitted[format].canonicalDigest = canonical.ok ? canonical.digest : null;
        }
      }

      if (!binding) {
        binding = bindSbomToImage(generator, null, digests.config);
      }
      if (!binding.consistent) problems.push(`subject binding: ${binding.reason}`);

      perImage.push({ ...base, ok: problems.length === 0, reason: problems.join("; ") || null, emitted, binding, problems });
    }

    // Tamper-evidence over the whole set: changing, adding or removing any one
    // evidence file moves `manifestDigest`.
    const evidence = evidenceManifest(artifactPaths);

    const summary = {
      documents: {
        imageWalked: { generator, perImage },
        offlineInventory: {
          sources: offline.sources,
          tally: offline.tally,
          componentCount: offline.bom.components.length,
          serialNumber: offline.bom.serialNumber,
          reproducibility: offlineReproducibility,
          caveat:
            "lockfile-derived for the npm scopes and a declared over-approximation for shipped-bundled; image-derived only for shipped-os. " +
            "NOT a substitute for the image-walked SBOM.",
        },
        externalBinaries: {
          baked: externalBinaries.baked.map((b) => ({ tool: b.tool, version: b.version, checksumSubject: b.checksumSubject, installedSha256: b.installedSha256 })),
          runtimeAcquired: externalBinaries.runtimeAcquired.map((t) => ({ tool: t.tool, checksumVerified: t.checksumVerified })),
          verificationGaps: externalBinaries.verificationGaps,
        },
      },
      coverage: {
        sbomCovers: "OS packages from the UBI 9 base layers and, for the image-walked document, every file the generator catalogs",
        sbomDoesNotCover: "oc, oc-mirror, openshift-install and mirror-registry — no package-manager record",
        companionDocuments: ["external-binaries.json", "offline-inventory.cdx.json"],
      },
      provenance: set,
      evidence,
    };
    const artifacts = [extArtifact, offlineArtifact, writeDoc("component-inventory.json", summary)];

    // Belt and braces against a false PASS: an empty result set has proven
    // nothing, and `[].every()` is true.
    if (!perImage.length) {
      return incomplete(ID, "no shipping image was inventoried, so nothing was proven", { evidence: summary, artifacts });
    }
    const failed = perImage.filter((p) => !p.ok);
    if (failed.length) {
      return incomplete(ID, `image-walked SBOM unusable for ${failed.map((p) => `${p.role} (${p.reason})`).join("; ")}`, {
        evidence: summary,
        artifacts,
      });
    }
    if (!evidence.complete) {
      return incomplete(ID, `evidence files could not be hashed: ${evidence.unreadable.join(", ")}`, { evidence: summary, artifacts });
    }

    return pass(
      ID,
      `${perImage.length} image-walked SBOMs (${generator.formats.join(" + ")}, ${generator.tool}), each bound to its image config digest; ` +
        `a reproducible ${offline.bom.components.length}-component offline inventory; and an external-binaries document covering ` +
        `oc ${externalBinaries.baked.find((b) => b.tool === "oc")?.version} and oc-mirror ${externalBinaries.baked.find((b) => b.tool === "oc-mirror")?.version} ` +
        `(evidence manifest ${evidence.manifestDigest.slice(0, 19)}…)`,
      { evidence: summary, artifacts },
    );
  },
};
