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
 * produced. Syft inventories what a package manager can see: RPMs from the
 * UBI 9 base layers and the backend's npm tree. `oc` and `oc-mirror` are
 * `curl`-ed tarballs unpacked into /usr/local/bin by the Containerfile — no
 * package database records them, so they do NOT appear as components in the
 * generated SPDX or CycloneDX documents, and saying "the SBOM covers the
 * external binaries" would be false.
 *
 * CONTRACT (option B of the tranche's two): the component inventory is a
 * MULTI-DOCUMENT artifact set, and the axis says so.
 *
 *   1. Syft SBOM (SPDX + CycloneDX) — package-detectable image content.
 *   2. external-binaries.json — a REQUIRED companion document covering `oc`
 *      and `oc-mirror`, built from the build-time provenance the backend
 *      image records at /app/tools-provenance.env.
 *
 * Neither document alone is the component inventory. Both are required, and a
 * missing or unparseable external-binaries document makes the axis
 * INCOMPLETE rather than letting a partial inventory read as complete.
 *
 * FORMAT: SPDX 2.3 JSON primary, CycloneDX alternate.
 *
 * This is a PROJECT AND TOOLCHAIN decision, not a regulatory one. An earlier
 * revision claimed US federal guidance effectively selects SPDX; that is not
 * accurate. NTIA's minimum-elements work explicitly recognises multiple
 * interoperable machine-readable formats — SPDX, CycloneDX and SWID — and
 * deliberately does not name a winner. SPDX is chosen here because it is the
 * format most often requested by the disconnected and government OpenShift
 * customers this product serves, and because Syft emits both from one scan so
 * carrying the alternate costs nothing.
 */

import fs from "node:fs";
import path from "node:path";
import { pass, incomplete } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";
import { run, hasTool, record } from "../lib/exec.mjs";
import { runInImage, REQUIRED_ROLES } from "../lib/images.mjs";
import { verifyShippingSet } from "../lib/provenance.mjs";

const ID = "component-inventory";

export const SBOM_FORMATS = Object.freeze({ primary: "spdx-json", alternate: "cyclonedx-json" });

/** As with the scanner: pinned by digest before use, never by floating tag. */
export const CONTAINERIZED_GENERATOR = Object.freeze({
  tool: "syft",
  image: "docker.io/anchore/syft",
  tag: null,
  digest: null,
});

/** Fields the backend image must record for each baked-in external binary. */
export const REQUIRED_TOOL_FIELDS = Object.freeze([
  "OC_RESOLVED_VERSION",
  "OC_RESOLVED_SHA256",
  "OC_MIRROR_RESOLVED_VERSION",
  "OC_MIRROR_RESOLVED_SHA256",
  "TOOLS_RESOLVED_ARCH",
]);

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

/** Parse `tools-provenance.env` into a component list. Pure, so it is testable. */
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

/** Read the build-time tool provenance out of the delivered image. */
function readToolProvenance(engine, img) {
  const res = runInImage(engine, img.id, ["/bin/sh", "-c", "cat /app/tools-provenance.env 2>/dev/null || true"]);
  if (res.status !== 0 || !res.stdout.trim()) {
    return { ok: false, missing: REQUIRED_TOOL_FIELDS, reason: "/app/tools-provenance.env absent or empty in the image" };
  }
  return parseToolProvenance(res.stdout);
}

function generate(generator, engine, archivePath, format, outPath) {
  if (generator.kind === "native-syft") {
    const res = run("syft", ["scan", `oci-archive:${archivePath}`, "-o", `${format}=${outPath}`, "-q"], { timeoutMs: 30 * 60_000 });
    return res.status === 0 ? { ok: true, run: record(res) } : { ok: false, run: record(res), stderr: res.stderr.slice(0, 2000) };
  }
  if (generator.kind === "containerized-syft") {
    const ref = `${CONTAINERIZED_GENERATOR.image}@${CONTAINERIZED_GENERATOR.digest}`;
    const dir = path.dirname(archivePath);
    const base = path.basename(archivePath);
    const res = run(engine, ["run", "--rm", "-v", `${dir}:/scan:z`, ref, "scan", `oci-archive:/scan/${base}`, "-o", format, "-q"], {
      timeoutMs: 45 * 60_000,
    });
    if (res.status !== 0) return { ok: false, run: record(res), stderr: res.stderr.slice(0, 2000) };
    fs.writeFileSync(outPath, res.stdout);
    return { ok: true, run: record(res) };
  }
  return { ok: false, reason: `unknown generator ${generator.kind}` };
}

export default {
  id: ID,
  title: "Component inventory: package SBOMs plus the external binaries they cannot see",
  required: true,
  nonWaivable: true,
  nonWaivableReason: "Tranche 8 requires SBOM / component-inventory closure before release (PROD-023 / PROD-044).",
  inputs: ["backend/Containerfile", "frontend/Containerfile", "backend/package-lock.json", "frontend/package-lock.json"],
  // NEVER reused. A native syft resolves from PATH and its version is not in
  // reach of the selection logic, so the generator that produced a prior SBOM
  // cannot be proven to be the one that would run now.
  reuse: REUSE.NEVER,

  async run({ store, shippingImages, candidate, buildManifest, archives }) {
    const { engine, images } = shippingImages;

    const set = verifyShippingSet(images, candidate, buildManifest, REQUIRED_ROLES);
    if (!set.ok) {
      return incomplete(ID, set.reason, {
        evidence: { provenance: set, requiredRoles: REQUIRED_ROLES },
        artifacts: [store.writeArtifact(ID, "provenance.json", set)],
      });
    }

    // Document 2 first: it needs no generator, so its absence is reported even
    // when the SBOM toolchain is unavailable.
    const externalBinaries = readToolProvenance(engine, images.find((i) => i.role === "backend"));
    const extArtifact = store.writeArtifact(ID, "external-binaries.json", {
      contract: "REQUIRED companion document; oc and oc-mirror are curl-ed tarballs and do NOT appear in the Syft SBOMs",
      image: "backend",
      ...externalBinaries,
    });

    const generator = selectGenerator({ engine });
    if (!generator.kind) {
      return incomplete(ID, `no SBOM generator available — ${generator.reason}`, {
        evidence: {
          backlogItem: "PROD-023",
          nonWaivable: true,
          formats: SBOM_FORMATS,
          reason: generator.reason,
          externalBinaries,
          closure: [
            "Human approves and pins a syft digest (candidates recorded in the 8A inventory), or installs syft on the certification host.",
            "then rerun: npm run release:certify -- --axis component-inventory",
          ],
        },
        artifacts: [extArtifact],
      });
    }

    if (!externalBinaries.ok) {
      return incomplete(
        ID,
        `external-binary provenance missing from the backend image (${externalBinaries.missing.join(", ")}); the component inventory would be incomplete`,
        { evidence: { generator, externalBinaries }, artifacts: [extArtifact] },
      );
    }

    const perImage = [];
    for (const img of images) {
      const archive = archives.archiveFor(img);
      if (!archive.ok) {
        perImage.push({ role: img.role, id: img.id, ok: false, reason: `OCI export failed: ${archive.reason}` });
        continue;
      }
      const emitted = {};
      let okAll = true;
      for (const [label, format] of Object.entries(SBOM_FORMATS)) {
        const outPath = store.artifactPath(ID, `${img.role}.${format}.json`);
        const r = generate(generator, engine, archive.path, format, outPath);
        if (r.ok) emitted[label] = path.relative(store.root, outPath);
        else okAll = false;
        emitted[`${label}Result`] = { ok: r.ok, stderr: r.stderr ?? null };
      }
      perImage.push({
        role: img.role,
        ref: img.ref,
        id: img.id,
        architecture: `${img.os}/${img.architecture}`,
        scannedArtifact: "oci-archive exported from the resolved image id",
        ok: okAll,
        emitted,
      });
    }

    const summary = {
      generator,
      formats: SBOM_FORMATS,
      coverage: {
        sbomCovers: "OS packages from the UBI 9 base layers and the backend's production npm tree",
        sbomDoesNotCover: "oc and oc-mirror — unpacked tarballs with no package-manager record",
        companionDocument: "external-binaries.json",
      },
      provenance: set,
      perImage,
      externalBinaries,
    };
    const artifacts = [extArtifact, store.writeArtifact(ID, "component-inventory.json", summary)];

    const failed = perImage.filter((p) => !p.ok);
    if (failed.length) {
      return incomplete(ID, `SBOM generation failed for ${failed.map((p) => p.role).join(", ")}`, { evidence: summary, artifacts });
    }

    return pass(
      ID,
      `${perImage.length} image SBOMs (${Object.values(SBOM_FORMATS).join(" + ")}, ${generator.tool}) plus an external-binaries document covering oc ${externalBinaries.entries.OC_RESOLVED_VERSION} and oc-mirror ${externalBinaries.entries.OC_MIRROR_RESOLVED_VERSION}`,
      { evidence: summary, artifacts },
    );
  },
};
