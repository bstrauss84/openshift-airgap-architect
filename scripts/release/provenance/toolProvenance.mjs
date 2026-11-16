/**
 * External-binary provenance: the components no package manager records.
 *
 * `oc`, `oc-mirror`, `openshift-install` and `mirror-registry` are tarballs
 * fetched from mirror.openshift.com and unpacked. No rpmdb, no npm tree, no
 * SBOM generator sees them — Syft would produce a document that silently
 * omits the four largest and most security-relevant binaries in the product.
 * axes/sbom.mjs already says so and attaches a companion document; this
 * module is the machinery behind that document, with three things the
 * existing `parseToolProvenance` does not do.
 *
 * 1. CHECKSUM SUBJECT. `/app/tools-provenance.env` records
 *    `OC_RESOLVED_SHA256`, and axes/sbom.mjs emits it as the component's
 *    `checksum`. It is NOT the checksum of the component. It is the checksum
 *    of `openshift-client-linux.tar.gz`, the DISTRIBUTION ARCHIVE, taken from
 *    Red Hat's `sha256sum.txt`. Measured in the shipping image:
 *
 *      recorded  OC_RESOLVED_SHA256 466f6c5d0604…   (tarball)
 *      measured  sha256 /usr/local/bin/oc d3c21a0d2ab0…   (extracted binary)
 *
 *    Both are legitimate and they answer different questions — "did Red Hat
 *    ship these bytes" versus "are these the bytes in the image". A consumer
 *    handed one labelled as the other will verify the wrong artifact and
 *    conclude the image is corrupt. Every record here carries
 *    `checksumSubject` and, where the image was read, BOTH values.
 *
 * 2. THE BINARIES THAT ARE NOT BAKED IN. `openshift-install` and
 *    `mirror-registry` never appear in `tools-provenance.env` because the
 *    Containerfile does not install them; the backend downloads them at
 *    request time into `DATA_DIR/cache` and packages them into user bundles.
 *    They are shipped TO USERS and absent from every inventory. Omitting them
 *    because they are not in the image would reproduce, one layer down, the
 *    exact overstatement axes/sbom.mjs was renamed to avoid.
 *
 * 3. VERIFICATION POSTURE, PER TOOL, FROM THE SOURCE. CLAUDE.md requires every
 *    external tool to be verified against its channel's own `sha256sum.txt`
 *    before use or packaging. That holds for `oc` and `oc-mirror`. It does
 *    NOT hold for the other two, and the declarations below record that as a
 *    finding rather than leaving the inventory implying uniform verification.
 *    See `RUNTIME_ACQUIRED_TOOLS`.
 *
 * SHAPE. Records match `getResolvedToolProvenance()` in
 * backend/src/ocMirrorRuntime.js — `{ path, tool, version, sha256, url, arch,
 * channel }` — so the build-time inventory and the runtime inventory are one
 * vocabulary, with the additional fields named explicitly as additions.
 *
 * FAIL CLOSED throughout. A missing field, an absent binary, an unreadable
 * image: all return `ok: false` with the reason. Nothing degrades to a
 * shorter list that reads as a complete one.
 */

import { run } from "../lib/exec.mjs";

/** The provenance vocabulary shared with backend/src/ocMirrorRuntime.js. */
export const RUNTIME_PROVENANCE_FIELDS = Object.freeze(["tool", "version", "sha256", "url", "arch", "channel", "path"]);

/** What a recorded sha256 is the checksum OF. Never left implicit. */
export const CHECKSUM_SUBJECT = Object.freeze({
  TARBALL: "distribution-tarball",
  BINARY: "installed-binary",
});

export const MIRROR_BASE = "https://mirror.openshift.com/pub/openshift-v4";

/** Fields `/app/tools-provenance.env` must carry for the inventory to be complete. */
export const REQUIRED_ENV_FIELDS = Object.freeze([
  "OC_RESOLVED_VERSION",
  "OC_RESOLVED_SHA256",
  "OC_RESOLVED_CHANNEL",
  "OC_MIRROR_RESOLVED_VERSION",
  "OC_MIRROR_RESOLVED_SHA256",
  "OC_MIRROR_RESOLVED_CHANNEL",
  "TOOLS_RESOLVED_ARCH",
]);

/**
 * Binaries baked into the backend image by backend/Containerfile.
 *
 * `tarball` is what the recorded sha256 actually covers, and is what makes
 * the source URL reconstructible.
 */
export const BAKED_TOOLS = Object.freeze([
  {
    tool: "oc",
    path: "/usr/local/bin/oc",
    tarball: "openshift-client-linux.tar.gz",
    versionField: "OC_RESOLVED_VERSION",
    sha256Field: "OC_RESOLVED_SHA256",
    channelField: "OC_RESOLVED_CHANNEL",
    policy: "latest patch WITHIN the selected supported target minor (CLAUDE.md external tool version policy)",
  },
  {
    tool: "oc-mirror",
    path: "/usr/local/bin/oc-mirror",
    tarball: "oc-mirror.tar.gz",
    versionField: "OC_MIRROR_RESOLVED_VERSION",
    sha256Field: "OC_MIRROR_RESOLVED_SHA256",
    channelField: "OC_MIRROR_RESOLVED_CHANNEL",
    policy: "latest available release GLOBALLY, independent of target minor (CLAUDE.md external tool version policy)",
  },
]);

/**
 * Binaries the backend downloads at request time and packages into the
 * artifacts users receive. Not in the image, therefore not in `rpm -qa`, not
 * in any npm tree, and not in `tools-provenance.env`.
 *
 * `checksumVerified` is a statement about the code at the cited location.
 *
 * BOTH ENTRIES WERE `false` WHEN READ AT TRANCHE 8D, AND BOTH ARE NOW `true`.
 * The original finding was real: backend/src/installer.js and
 * backend/src/openshiftInstaller.js each opened with a header claiming
 * "download, caching, and verification" while containing no hashing, checksum
 * fetch or integrity comparison at all, and the only post-download check in the
 * mirror-registry path was `stat.size > 0`.
 *
 * That was closed by `backend/src/verifiedDownload.js`, which resolves each
 * artifact's expected digest from the publishing channel's own `sha256sum.txt`
 * and fails closed on download failure, missing or unparseable checksum
 * metadata, a manifest with no entry for the file, or a digest mismatch.
 *
 * A SECOND, NARROWER GAP WAS FOUND AND CLOSED ON 2026-10-16, and the entries
 * below were widened in the same change rather than left to overstate the
 * earlier fix. Tarball verification said nothing about the EXTRACTED
 * executable, and both cache hits returned one on an `fs.existsSync` check
 * alone — so a binary predating the checksum work, corrupted on disk, or (the
 * `installer.js` cache path carries no architecture segment) extracted for a
 * different execution host, was spawned and packaged unverified.
 * `backend/src/binaryProvenance.js` now binds each extracted executable's own
 * digest to its full identity and re-hashes it on every reuse. Separately, the
 * verified mirror-registry tarball is hard-linked into private export staging
 * and re-proved against its digest as it is streamed into the bundle, so the
 * bytes archived are provably the bytes verified.
 *
 * THIS BLOCK IS HAND-MAINTAINED AND THAT IS A HAZARD. It is a hardcoded
 * assertion about source code, emitted verbatim into shipped release evidence
 * (`external-binaries.json` -> `verificationGaps`). It therefore keeps claiming
 * whatever it last said, regardless of what the code does — which is exactly
 * what happened: the generator went on reporting both gaps as open after they
 * were fixed, so a consumer reading the evidence would have been told the
 * product was less safe than it is. When either file's verification posture
 * changes, THIS CONSTANT MUST CHANGE IN THE SAME COMMIT.
 *
 * What is still NOT claimed: this is SHA256 manifest verification, not
 * signature verification. The manifest and the artifact share an origin, so it
 * does not prove authenticity. Detached GPG signatures exist on the mirror but
 * are not checked — that needs a pinned Red Hat trust anchor, which is a human
 * decision recorded in
 * docs/security/DECISION_RECORD_API_EXPOSURE_AND_TRUST_ANCHORS.md (Decision B).
 */
export const RUNTIME_ACQUIRED_TOOLS = Object.freeze([
  {
    tool: "openshift-install",
    acquisition: "downloaded at request time into DATA_DIR/cache and packaged into the generated bundle",
    source: "backend/src/installer.js, backend/src/openshiftInstaller.js, backend/src/verifiedDownload.js, backend/src/binaryProvenance.js",
    urlTemplate: "https://mirror.openshift.com/pub/openshift-v4/<arch>/clients/ocp/<version>/openshift-install-linux.tar.gz",
    bakedIntoImage: false,
    checksumVerified: true,
    verificationMethod:
      "SHA256 against the channel's own sha256sum.txt, fail-closed, verified before the cache path is written; " +
      "the EXTRACTED executable additionally carries a provenance record binding its own SHA256 to the verified " +
      "tarball, version, platform, architecture and FIPS variant, re-hashed on every reuse; signature NOT verified",
    finding: null,
  },
  {
    tool: "mirror-registry",
    acquisition: "downloaded at request time into DATA_DIR/cache and packaged into the generated bundle",
    source: "backend/src/index.js (mirror-registry export path), backend/src/verifiedDownload.js",
    urlTemplate: "https://mirror.openshift.com/pub/cgw/mirror-registry/latest/mirror-registry-<arch>.tar.gz",
    bakedIntoImage: false,
    checksumVerified: true,
    verificationMethod:
      "SHA256 against the published sha256sum.txt, fail-closed, verified before the cache path is written; " +
      "the verified inode is hard-linked into private export staging and re-proved against that digest as it is " +
      "streamed into the bundle; signature NOT verified",
    finding: null,
  },
]);

const SHA256_RE = /^[0-9a-f]{64}$/;

/** Parse `KEY=value` provenance text. Pure; blank lines and comments ignored. */
export function parseProvenanceEnv(text) {
  const entries = {};
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    entries[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const missing = REQUIRED_ENV_FIELDS.filter((f) => !entries[f]);
  const malformed = BAKED_TOOLS.map((t) => t.sha256Field)
    .filter((f) => entries[f] && !SHA256_RE.test(entries[f]))
    .map((f) => `${f} is not a 64-character lowercase hex sha256`);

  if (missing.length || malformed.length) {
    return { ok: false, entries, missing, malformed };
  }
  return { ok: true, entries, missing: [], malformed: [] };
}

/** Mirror directory for a normalised architecture, matching the Containerfile's cases. */
export function mirrorArchDir(arch) {
  const a = String(arch ?? "").toLowerCase();
  if (a === "x86_64" || a === "amd64" || a === "x64") return "x86_64";
  if (a === "aarch64" || a === "arm64") return "aarch64";
  if (a === "ppc64le") return "ppc64le";
  if (a === "s390x") return "s390x";
  return null;
}

/** Reconstruct the exact URL the Containerfile fetched a tarball from. */
export function tarballUrl({ arch, channel, tarball }) {
  const dir = mirrorArchDir(arch);
  if (!dir || !channel || !tarball) return null;
  return `${MIRROR_BASE}/${dir}/clients/ocp/${channel}/${tarball}`;
}

/**
 * Turn parsed env entries into provenance records.
 *
 * Records carry `sha256` in the `getResolvedToolProvenance()` position, and
 * `checksumSubject` naming what it covers. `installedSha256` stays null until
 * the image is actually measured — an unmeasured field is null, never
 * optimistically filled from the tarball value.
 */
export function toProvenanceRecords(parsed) {
  if (!parsed?.ok) return { ok: false, reason: "provenance env is incomplete", missing: parsed?.missing ?? [], records: [] };
  const e = parsed.entries;
  const arch = e.TOOLS_RESOLVED_ARCH;

  const records = BAKED_TOOLS.map((t) => {
    const channel = e[t.channelField];
    return {
      tool: t.tool,
      version: e[t.versionField],
      sha256: e[t.sha256Field],
      checksumSubject: CHECKSUM_SUBJECT.TARBALL,
      checksumCovers: t.tarball,
      checksumAuthority: `${MIRROR_BASE}/${mirrorArchDir(arch)}/clients/ocp/${channel}/sha256sum.txt`,
      url: tarballUrl({ arch, channel, tarball: t.tarball }),
      arch,
      channel,
      path: t.path,
      bakedIntoImage: true,
      checksumVerified: true,
      verifiedAt: "image build time, by `sha256sum --check --strict` in backend/Containerfile",
      versionPolicy: t.policy,
      installedSha256: null,
      installedSizeBytes: null,
    };
  });

  const unresolvableUrl = records.filter((r) => !r.url).map((r) => r.tool);
  if (unresolvableUrl.length) {
    return {
      ok: false,
      reason: `source URL is not reconstructible for ${unresolvableUrl.join(", ")} (unsupported TOOLS_RESOLVED_ARCH "${arch}")`,
      records,
    };
  }
  return { ok: true, records };
}

/** Parse `sha256sum` output: `<hex>  <path>` per line. */
export function parseSha256Sums(text) {
  const out = {};
  for (const line of String(text ?? "").split("\n")) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(\S+)\s*$/);
    if (m) out[m[2]] = m[1];
  }
  return out;
}

/** Parse `stat -c '%n %s'` output into a path → size map. */
export function parseSizes(text) {
  const out = {};
  for (const line of String(text ?? "").split("\n")) {
    const m = line.trim().match(/^(\S+)\s+(\d+)$/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

/**
 * Attach measured values and cross-check them against what was recorded.
 *
 * The cross-check asserts the two checksums DIFFER. They must: one is a
 * gzipped tar, the other a file inside it, so equality would mean the build
 * wrote the wrong value — or that someone "fixed" the apparent mismatch by
 * copying one field into the other. That is the specific regression this
 * guards, and it is why the assertion runs in the direction it does.
 */
export function reconcileMeasured(records, { sums = {}, sizes = {} } = {}) {
  const reconciled = records.map((r) => {
    const installedSha256 = sums[r.path] ?? null;
    const installedSizeBytes = sizes[r.path] ?? null;
    const problems = [];
    if (!installedSha256) problems.push(`binary not found or not hashable at ${r.path} in the image`);
    else if (installedSha256 === r.sha256) {
      problems.push(
        `installed-binary sha256 equals the recorded distribution-tarball sha256 for ${r.tool}; ` +
          "one of the two values is wrong — they cover different artifacts and cannot match",
      );
    }
    return { ...r, installedSha256, installedSizeBytes, problems };
  });
  const problems = reconciled.flatMap((r) => r.problems);
  return { ok: problems.length === 0, records: reconciled, problems };
}

/**
 * Read external-binary provenance out of a built image, addressed by ID.
 *
 * Deliberately addressed by image ID, not tag, for the reason lib/images.mjs
 * gives: a tag names whatever was built last.
 */
export function inventoryBakedTools(engine, imageId, { runner = run, timeoutMs = 180_000 } = {}) {
  if (!engine) return { ok: false, reason: "no container engine available" };
  if (!imageId) return { ok: false, reason: "no image id given" };

  const inImage = (argv) =>
    runner(engine, ["run", "--rm", "--network=none", "--entrypoint", argv[0], imageId, ...argv.slice(1)], { timeoutMs });

  const envRes = inImage(["cat", "/app/tools-provenance.env"]);
  if (envRes.status !== 0 || !String(envRes.stdout).trim()) {
    return { ok: false, reason: "/app/tools-provenance.env is absent or empty in the image" };
  }

  const parsed = parseProvenanceEnv(envRes.stdout);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: `tool provenance incomplete: ${[...parsed.missing.map((m) => `missing ${m}`), ...parsed.malformed].join("; ")}`,
      missing: parsed.missing,
      malformed: parsed.malformed,
    };
  }

  const built = toProvenanceRecords(parsed);
  if (!built.ok) return built;

  const paths = BAKED_TOOLS.map((t) => t.path);
  const sumRes = inImage(["sha256sum", ...paths]);
  const sizeRes = inImage(["stat", "-c", "%n %s", ...paths]);

  const reconciled = reconcileMeasured(built.records, {
    sums: parseSha256Sums(sumRes.stdout),
    sizes: parseSizes(sizeRes.stdout),
  });

  return {
    ok: reconciled.ok,
    reason: reconciled.ok ? null : reconciled.problems.join("; "),
    imageId,
    baked: reconciled.records,
    runtimeAcquired: RUNTIME_ACQUIRED_TOOLS.map((t) => ({ ...t })),
    problems: reconciled.problems,
  };
}

/**
 * The complete external-binary inventory, baked plus runtime-acquired.
 *
 * `complete` is true only when every baked tool reconciled AND every
 * runtime-acquired tool's verification posture is known. `verificationGaps`
 * is always populated from the declarations, so a caller cannot read this
 * document and come away believing every external binary is checksum-verified.
 */
export function externalBinaryInventory(engine, imageId, opts = {}) {
  const baked = inventoryBakedTools(engine, imageId, opts);
  const gaps = RUNTIME_ACQUIRED_TOOLS.filter((t) => !t.checksumVerified).map((t) => ({ tool: t.tool, finding: t.finding, source: t.source }));

  return {
    contract:
      "REQUIRED companion document. These binaries have no package-manager record and appear in NO generated SBOM; " +
      "an SBOM presented without this document understates the shipped component set.",
    complete: baked.ok,
    reason: baked.reason ?? null,
    imageId: imageId ?? null,
    baked: baked.baked ?? [],
    runtimeAcquired: RUNTIME_ACQUIRED_TOOLS.map((t) => ({ ...t })),
    verificationGaps: gaps,
    checksumSubjects: CHECKSUM_SUBJECT,
  };
}
