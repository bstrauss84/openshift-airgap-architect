/**
 * CycloneDX component inventory, without Syft.
 *
 * WHY THIS EXISTS. axes/sbom.mjs reports INCOMPLETE because `syft` is not on
 * PATH and the containerized generator has no approved pinned digest. That is
 * the correct verdict and this module does not change it. What it changes is
 * the cost of the gap: a package-manager-derived and rpmdb-derived inventory
 * can be produced TODAY, offline, deterministically, from sources that are
 * each individually auditable — and having one makes the remaining delta to a
 * real image scan small, named, and reviewable instead of total.
 *
 * THIS IS NOT A SUBSTITUTE FOR AN IMAGE SCAN, and the document says so in its
 * own metadata. Every BOM emitted carries `oaa:derivation` naming its sources
 * and `oaa:doesNotCover` naming what no package manager can see. The four
 * things it cannot see are real and are not hidden:
 *
 *   - files installed outside any package manager (except the four external
 *     binaries, which the companion document from toolProvenance.mjs covers);
 *   - anything vendored inside an npm package's published tarball;
 *   - layers deleted later in the build but still present in image history;
 *   - the base image's own non-RPM content.
 *
 * SCOPE SEPARATION IS THE HARD REQUIREMENT, and it is four-way, not two-way.
 * The two-way split (shipped / builder) is what v2.1 Tranche 7C proved
 * insufficient: it made the frontend look clean because its runtime image
 * ships no npm tree, while `react`, `react-dom`, `prismjs` and
 * `@patternfly/react-core` are COMPILED INTO the JavaScript that image serves
 * to every browser. They are shipped. They are simply not shipped as packages.
 *
 *   SHIPPED_RUNTIME   present as package-manager-visible files in the final
 *                     image. Backend production npm tree at /app/node_modules.
 *   SHIPPED_BUNDLED   not present as files; compiled into shipped artifacts.
 *                     Frontend non-dev dependencies, inlined into dist/*.js.
 *                     A vulnerability here reaches users. Patching it requires
 *                     a rebuild, not an image-layer update.
 *   SHIPPED_OS        RPMs in the final image, read from the image's own rpmdb.
 *   BUILDER_ONLY      executes on the build host, absent from the final image.
 *                     Bounded blast radius, NOT zero — owned by 8G via
 *                     dependencies-builder. This module CLASSIFIES these; it
 *                     does not dispose of them.
 *
 * SHIPPED_BUNDLED IS A DECLARED SCOPE, NOT A PROVEN ONE. It is derived from
 * "non-dev dependency of a component whose build output ships", not from
 * reading the bundler's module graph. Tree-shaking can drop a declared
 * dependency entirely, so the set is an OVER-approximation: every bundled
 * package is in it, and some members may not actually be bundled. That
 * direction is the safe one for a security inventory and the components carry
 * `oaa:inclusionProven: false` so no reader mistakes it for an exact answer.
 *
 * DETERMINISM. `npm sbom` was evaluated and rejected as the generator: it
 * emits a random `serialNumber` and a wall-clock `timestamp` on every
 * invocation, and without `--package-lock-only` it reports the installed tree
 * — a property of the operator's disk rather than of the candidate, which is
 * the exact failure mode axes/dependencies.mjs avoids with
 * `--package-lock-only`. Here the lockfile is read directly, components are
 * sorted, and the serial number is DERIVED FROM THE CONTENT, so the same
 * candidate yields byte-identical output. `timestamp` is injected by the
 * caller rather than read from the clock.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { run } from "../lib/exec.mjs";

export const SPEC_VERSION = "1.5";

export const SCOPES = Object.freeze({
  SHIPPED_RUNTIME: "shipped-runtime",
  SHIPPED_BUNDLED: "shipped-bundled",
  SHIPPED_OS: "shipped-os",
  BUILDER_ONLY: "builder-only",
  EXTERNAL_BINARY: "shipped-external-binary",
});

/** Scopes whose contents reach a user. */
export const SHIPPED_SCOPES = Object.freeze([
  SCOPES.SHIPPED_RUNTIME,
  SCOPES.SHIPPED_BUNDLED,
  SCOPES.SHIPPED_OS,
  SCOPES.EXTERNAL_BINARY,
]);

/**
 * How each component's npm tree maps onto the scopes, derived from the
 * Containerfiles rather than assumed.
 *
 *   backend/Containerfile   a builder stage runs `npm ci --omit=dev` and the
 *                           final stage takes `COPY --from=builder
 *                           /app/node_modules`, so the production tree — and
 *                           only the production tree — is present at
 *                           /app/node_modules. (It ran the install directly
 *                           in a single final stage until the runtime base
 *                           moved to ubi9/nodejs-22-minimal; the scope
 *                           mapping is unchanged, only the mechanism.)
 *   frontend/Containerfile  two stages; only /build/frontend/dist crosses the
 *                           boundary. No node_modules, no package.json, no
 *                           Node.js in the runtime image — so nothing is
 *                           SHIPPED_RUNTIME, and the production deps move to
 *                           SHIPPED_BUNDLED.
 */
export const NPM_SCOPE_MAP = Object.freeze({
  backend: { prod: SCOPES.SHIPPED_RUNTIME, dev: SCOPES.BUILDER_ONLY },
  frontend: { prod: SCOPES.SHIPPED_BUNDLED, dev: SCOPES.BUILDER_ONLY },
});

const DOES_NOT_COVER = Object.freeze([
  "files installed outside any package manager (see the external-binaries companion document from toolProvenance.mjs)",
  "code vendored inside a published npm tarball, which has no separate package record",
  "content from layers removed later in the build but retained in image history",
  "non-RPM content of the UBI base images",
]);

// ---------------------------------------------------------------------------
// npm lockfile
// ---------------------------------------------------------------------------

/** `node_modules/@scope/name` → `@scope/name`; nested paths use the last segment. */
export function packageNameFromLockPath(lockPath) {
  const marker = "node_modules/";
  const i = lockPath.lastIndexOf(marker);
  if (i === -1) return null;
  const name = lockPath.slice(i + marker.length);
  return name || null;
}

/** purl for an npm package, matching npm's own encoding of the scope. */
export function npmPurl(name, version) {
  if (!name) return null;
  const encoded = name.startsWith("@") ? `%40${name.slice(1)}` : name;
  return version ? `pkg:npm/${encoded}@${version}` : `pkg:npm/${encoded}`;
}

/** `sha512-<base64>` → a CycloneDX hash entry. Unknown algorithms are dropped, not guessed. */
export function integrityToHash(integrity) {
  const m = String(integrity ?? "").match(/^(sha(?:256|384|512))-([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const alg = `SHA-${m[1].slice(3)}`;
  let content;
  try {
    content = Buffer.from(m[2], "base64").toString("hex");
  } catch {
    return null;
  }
  // A truncated or mis-padded base64 digest decodes to the wrong length.
  // Refusing it beats publishing a hash that will never verify.
  const expectedBytes = { "SHA-256": 32, "SHA-384": 48, "SHA-512": 64 }[alg];
  if (content.length !== expectedBytes * 2) return null;
  return { alg, content };
}

/**
 * Components from an npm lockfile (lockfileVersion 2 or 3).
 *
 * `dev` and `devOptional` both mean "reachable only through a devDependency
 * edge", so both land in the builder scope. The root entry (key "") is the
 * component itself, not a dependency, and is excluded.
 */
export function componentsFromLockfile(lock, { component, scopeMap = NPM_SCOPE_MAP } = {}) {
  const version = lock?.lockfileVersion;
  if (version !== 2 && version !== 3) {
    return { ok: false, reason: `unsupported lockfileVersion ${JSON.stringify(version)}; expected 2 or 3`, components: [] };
  }
  const packages = lock?.packages;
  if (!packages || typeof packages !== "object") {
    return { ok: false, reason: "lockfile has no `packages` map", components: [] };
  }
  const scopes = scopeMap[component];
  if (!scopes) return { ok: false, reason: `no scope mapping declared for component "${component}"`, components: [] };

  const out = [];
  const skipped = [];
  for (const [lockPath, entry] of Object.entries(packages)) {
    if (lockPath === "") continue;
    if (entry?.link === true) continue; // a workspace symlink, not a distinct component
    const name = entry?.name ?? packageNameFromLockPath(lockPath);
    const ver = entry?.version ?? null;
    if (!name || !ver) {
      skipped.push({ lockPath, reason: "no resolvable name/version" });
      continue;
    }
    const isDev = entry.dev === true || entry.devOptional === true;
    const scope = isDev ? scopes.dev : scopes.prod;
    const hash = integrityToHash(entry.integrity);

    out.push({
      type: "library",
      // `#${lockPath}` is load-bearing, not decoration. npm installs the same
      // name@version at several nested paths (archiver, compress-commons and
      // crc32-stream each get their own buffer@6.0.3), so a ref built from
      // name@version alone repeats — and CycloneDX 1.5 requires bom-ref to be
      // unique within a BOM. Worse, VEX addresses components BY bom-ref, so a
      // statement about one nested copy would silently cover all of them.
      // `lockPath` is the key of the lockfile's `packages` map, so it is
      // unique by construction and stable across runs.
      // releaseEvidence.canonicalRef() already learned this lesson for
      // trivy's SBOM; this applies it to the one we emit ourselves.
      "bom-ref": `${component}:${scope}:${name}@${ver}#${lockPath}`,
      name,
      version: ver,
      purl: npmPurl(name, ver),
      ...(hash ? { hashes: [hash] } : {}),
      properties: [
        { name: "oaa:scope", value: scope },
        { name: "oaa:component", value: component },
        { name: "oaa:source", value: `${component}/package-lock.json` },
        { name: "oaa:derivation", value: "package-manager-derived (lockfile), NOT image-derived" },
        { name: "oaa:lockPath", value: lockPath },
        ...(entry.resolved ? [{ name: "oaa:resolved", value: String(entry.resolved) }] : []),
        ...(scope === SCOPES.SHIPPED_BUNDLED
          ? [
              { name: "oaa:inclusionProven", value: "false" },
              {
                name: "oaa:inclusionBasis",
                value:
                  "non-dev dependency of a component whose build output ships; Vite inlines imported modules into dist/. " +
                  "Per-package inclusion is NOT proven and tree-shaking may exclude this package.",
              },
            ]
          : []),
      ],
    });
  }

  if (!out.length) return { ok: false, reason: "lockfile yielded no components", components: [], skipped };
  return { ok: true, components: out, skipped };
}

// ---------------------------------------------------------------------------
// Image rpmdb
// ---------------------------------------------------------------------------

/** The query format `rpmComponentsFromImage` requests. Field order is load-bearing. */
export const RPM_QUERY_FORMAT = "%{NAME}|%{EPOCH}|%{VERSION}|%{RELEASE}|%{ARCH}|%{SOURCERPM}\\n";

/**
 * Parse `rpm -qa --qf RPM_QUERY_FORMAT` output.
 *
 * `gpg-pubkey` entries are pseudo-packages holding trusted signing keys, not
 * software — they are excluded from the component list and counted, rather
 * than dropped silently.
 */
export function rpmComponentsFromQuery(text, { imageRole } = {}) {
  const components = [];
  const excluded = [];
  const malformed = [];

  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split("|");
    if (parts.length < 5) {
      malformed.push(line);
      continue;
    }
    const [name, epochRaw, ver, rel, arch, srpm] = parts;
    if (!name || !ver || !rel) {
      malformed.push(line);
      continue;
    }
    if (name === "gpg-pubkey") {
      excluded.push({ name, reason: "signing key pseudo-package, not software" });
      continue;
    }
    const epoch = epochRaw && epochRaw !== "(none)" ? epochRaw : null;
    const version = `${epoch ? `${epoch}:` : ""}${ver}-${rel}`;
    const qualifiers = [`arch=${arch || "noarch"}`, "distro=rhel-9"];

    components.push({
      type: "library",
      "bom-ref": `${imageRole}:${SCOPES.SHIPPED_OS}:${name}@${version}`,
      name,
      version,
      purl: `pkg:rpm/redhat/${name}@${encodeURIComponent(version)}?${qualifiers.join("&")}`,
      properties: [
        { name: "oaa:scope", value: SCOPES.SHIPPED_OS },
        { name: "oaa:component", value: imageRole },
        { name: "oaa:source", value: "rpmdb read from inside the built image" },
        { name: "oaa:derivation", value: "image-derived (rpm -qa executed in the final image)" },
        ...(srpm && srpm !== "(none)" ? [{ name: "oaa:sourceRpm", value: srpm }] : []),
      ],
    });
  }

  if (malformed.length) {
    return { ok: false, reason: `${malformed.length} unparseable rpm line(s); refusing a partial OS inventory`, components, malformed };
  }
  if (!components.length) return { ok: false, reason: "rpm query returned no packages", components, excluded };
  return { ok: true, components, excluded, malformed: [] };
}

/**
 * Read the OS package inventory out of a built image, by image ID.
 *
 * This is genuinely IMAGE-DERIVED — the image's own rpmdb, read by the
 * image's own rpm — so it needs no scanner and no network. It is the one part
 * of this inventory that does not carry the package-manager-derived caveat.
 */
export function rpmComponentsFromImage(engine, imageId, { runner = run, imageRole, timeoutMs = 180_000 } = {}) {
  if (!engine) return { ok: false, reason: "no container engine available", components: [] };
  if (!imageId) return { ok: false, reason: "no image id given", components: [] };

  const res = runner(
    engine,
    ["run", "--rm", "--network=none", "--entrypoint", "rpm", imageId, "-qa", "--qf", RPM_QUERY_FORMAT],
    { timeoutMs },
  );
  if (res.spawnError) return { ok: false, reason: `could not execute ${engine}: ${res.spawnError}`, components: [] };
  if (res.timedOut) return { ok: false, reason: `rpm query timed out after ${timeoutMs}ms`, components: [] };
  if (res.status !== 0) {
    return { ok: false, reason: `rpm query exited ${res.status}: ${(res.stderr || "").trim().split("\n")[0]}`, components: [] };
  }
  return rpmComponentsFromQuery(res.stdout, { imageRole });
}

// ---------------------------------------------------------------------------
// External binaries
// ---------------------------------------------------------------------------

/**
 * CycloneDX components for the external binaries, from an
 * `externalBinaryInventory()` result.
 *
 * The hash recorded is the MEASURED binary hash where one exists, because a
 * CycloneDX `hashes` entry on a component means "this component's bytes".
 * The distribution-tarball checksum is carried as a property, labelled, so
 * both are available and neither can be mistaken for the other.
 */
export function externalBinaryComponents(inventory, { imageRole = "backend" } = {}) {
  const baked = (inventory?.baked ?? []).map((t) => {
    const measured = t.installedSha256 ? [{ alg: "SHA-256", content: t.installedSha256 }] : [];
    return {
      type: "application",
      "bom-ref": `${imageRole}:${SCOPES.EXTERNAL_BINARY}:${t.tool}@${t.version}`,
      name: t.tool,
      version: t.version,
      ...(measured.length ? { hashes: measured } : {}),
      properties: [
        { name: "oaa:scope", value: SCOPES.EXTERNAL_BINARY },
        { name: "oaa:component", value: imageRole },
        { name: "oaa:derivation", value: "declared from build-time provenance and measured in the image" },
        { name: "oaa:installedPath", value: t.path },
        { name: "oaa:sourceUrl", value: String(t.url) },
        { name: "oaa:distributionTarballSha256", value: String(t.sha256) },
        { name: "oaa:distributionTarball", value: String(t.checksumCovers) },
        { name: "oaa:checksumVerifiedAtBuild", value: String(t.checksumVerified === true) },
        {
          name: "oaa:note",
          value: "no package manager records this binary; it is absent from any Syft-generated SBOM for this image",
        },
      ],
    };
  });

  const runtimeAcquired = (inventory?.runtimeAcquired ?? []).map((t) => ({
    type: "application",
    "bom-ref": `runtime-acquired:${SCOPES.EXTERNAL_BINARY}:${t.tool}`,
    name: t.tool,
    version: "unpinned-at-build",
    properties: [
      { name: "oaa:scope", value: SCOPES.EXTERNAL_BINARY },
      { name: "oaa:component", value: "runtime-acquired" },
      { name: "oaa:derivation", value: "declared from source; NOT present in any image" },
      { name: "oaa:acquisition", value: String(t.acquisition) },
      { name: "oaa:urlTemplate", value: String(t.urlTemplate) },
      { name: "oaa:checksumVerified", value: String(t.checksumVerified === true) },
      ...(t.finding ? [{ name: "oaa:finding", value: String(t.finding) }] : []),
    ],
  }));

  return [...baked, ...runtimeAcquired];
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

const scopeOf = (c) => c.properties?.find((p) => p.name === "oaa:scope")?.value ?? "unknown";

/** Total order over components, so the same inputs always produce the same bytes. */
function compareComponents(a, b) {
  return (
    String(scopeOf(a)).localeCompare(scopeOf(b)) ||
    String(a.name).localeCompare(String(b.name)) ||
    String(a.version).localeCompare(String(b.version)) ||
    String(a["bom-ref"]).localeCompare(String(b["bom-ref"]))
  );
}

/**
 * A serial number derived from the content.
 *
 * RFC 9562 UUIDv8 is the custom-layout version, which is exactly what this
 * is: 122 bits of a content digest. Using it rather than a random v4 means
 * two BOMs with the same serial number provably describe the same component
 * set, and regenerating an unchanged candidate does not produce a diff.
 */
export function deterministicSerialNumber(components) {
  const h = createHash("sha256").update(JSON.stringify(components)).digest("hex");
  const uuid = [h.slice(0, 8), h.slice(8, 12), `8${h.slice(13, 16)}`, ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20), h.slice(20, 32)].join("-");
  return `urn:uuid:${uuid}`;
}

/** Count components per scope. The headline number of the whole document. */
export function scopeTally(components) {
  const tally = {};
  for (const scope of Object.values(SCOPES)) tally[scope] = 0;
  for (const c of components) {
    const s = scopeOf(c);
    tally[s] = (tally[s] ?? 0) + 1;
  }
  return tally;
}

/**
 * Assemble a deterministic CycloneDX document.
 *
 * `timestamp` is REQUIRED and injected. Reading the clock here would make the
 * output non-reproducible and would quietly defeat the point of the
 * content-derived serial number.
 */
/**
 * Canonical, sorted rendering of the image identities this BOM describes.
 *
 * WHY THE BOM MUST CARRY THESE. `shipped-os` components are read from a
 * specific image's rpmdb by `rpm -qa` executed inside it. A BOM that lists
 * 592 RPMs without naming the image they came from cannot be checked against
 * anything: a reader a year later cannot tell whether it describes the image
 * that shipped or one built on a developer's laptop. Writing the identities
 * to a sibling file is not a tie — files get separated.
 *
 * Only the digest kinds that actually exist locally are recorded, each under
 * its own name, because `config`, `manifest` and `registry` digests are
 * different values (see candidateBinding.mjs DIGEST_KINDS). Sorting by role
 * keeps the serialised value byte-stable.
 */
export function canonicalSubjectImages(images) {
  const rows = (Array.isArray(images) ? images : [])
    .map((img) => ({
      role: img.role ?? null,
      ref: img.ref ?? null,
      configDigest: img.identity?.id ? (String(img.identity.id).startsWith("sha256:") ? img.identity.id : `sha256:${img.identity.id}`) : null,
      manifestDigest: img.identity?.digest ?? null,
      identityDigest: img.identityDigest ?? null,
    }))
    .sort((a, b) => String(a.role).localeCompare(String(b.role)));
  return JSON.stringify(rows);
}

export function buildCycloneDx({ components, subject, timestamp, derivation, doesNotCover = DOES_NOT_COVER, subjectImages = null }) {
  if (!timestamp) throw new TypeError("buildCycloneDx requires an explicit timestamp; reading the clock would make output non-reproducible");
  if (!Array.isArray(components) || !components.length) throw new TypeError("buildCycloneDx requires a non-empty component list");

  const sorted = [...components].sort(compareComponents);
  const imageProperty = subjectImages ? [{ name: "oaa:subjectImages", value: canonicalSubjectImages(subjectImages) }] : [];
  return {
    bomFormat: "CycloneDX",
    specVersion: SPEC_VERSION,
    serialNumber: deterministicSerialNumber(sorted),
    version: 1,
    metadata: {
      timestamp,
      tools: [{ vendor: "OpenShift Airgap Architect", name: "scripts/release/provenance/sbomGenerate.mjs", version: "8D" }],
      component: subject,
      properties: [
        { name: "oaa:derivation", value: derivation },
        { name: "oaa:doesNotCover", value: doesNotCover.join(" | ") },
        { name: "oaa:scopeTally", value: JSON.stringify(scopeTally(sorted)) },
        {
          name: "oaa:notASubstituteFor",
          value:
            "a filesystem-walking image scan (syft/trivy). This document is derived from lockfiles and the image rpmdb, " +
            "not from a full layer walk, and omits anything neither source records.",
        },
        ...imageProperty,
      ],
    },
    components: sorted,
  };
}

/**
 * Build the full inventory for the release, fail-closed.
 *
 * Every declared source must produce components. A source that fails is
 * reported and the whole generation is refused — a BOM missing one of its
 * four scopes looks exactly like a BOM whose fourth scope is empty, and a
 * reader cannot tell the difference. Emitting it would be the half-SBOM this
 * module was asked not to produce.
 *
 * @param {object} spec
 * @param {Array<{component:string, lock:object}>} spec.lockfiles
 * @param {Array<{role:string, components:object[]}>} [spec.osInventories]
 * @param {object} [spec.externalBinaries] result of externalBinaryInventory()
 * @param {string} spec.timestamp
 */
export function generateInventory({ lockfiles = [], osInventories = [], externalBinaries = null, timestamp, subject, subjectImages = null }) {
  const problems = [];
  const components = [];
  const sources = [];

  if (!lockfiles.length) problems.push("no lockfiles supplied; the npm scopes would be silently empty");

  for (const { component, lock } of lockfiles) {
    const res = componentsFromLockfile(lock, { component });
    if (!res.ok) problems.push(`${component}: ${res.reason}`);
    else {
      components.push(...res.components);
      sources.push(`${component}/package-lock.json (lockfileVersion ${lock.lockfileVersion}, ${res.components.length} components)`);
    }
  }

  for (const os of osInventories) {
    if (!os?.ok) problems.push(`${os?.role ?? "unknown"} OS inventory: ${os?.reason ?? "absent"}`);
    else {
      components.push(...os.components);
      sources.push(`${os.role} image rpmdb (${os.components.length} packages)`);
    }
  }

  if (externalBinaries) {
    if (!externalBinaries.complete) problems.push(`external binaries: ${externalBinaries.reason}`);
    const ext = externalBinaryComponents(externalBinaries);
    if (!ext.length) problems.push("external-binary inventory produced no components");
    else {
      components.push(...ext);
      sources.push(`external binaries (${ext.length} entries, ${externalBinaries.verificationGaps?.length ?? 0} verification gap(s))`);
    }
  } else {
    problems.push("no external-binary inventory supplied; oc, oc-mirror, openshift-install and mirror-registry would be invisible");
  }

  if (problems.length) {
    return { ok: false, problems, partialComponentCount: components.length, bom: null };
  }

  const bom = buildCycloneDx({
    components,
    subject,
    subjectImages,
    timestamp,
    derivation: `package-manager-derived and image-rpmdb-derived; sources: ${sources.join("; ")}`,
  });
  return { ok: true, problems: [], bom, tally: scopeTally(bom.components), sources };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * `node scripts/release/provenance/sbomGenerate.mjs <outDir> [--no-images]`
 *
 * Writes `inventory.cdx.json` plus `external-binaries.json`. Intended for
 * producing evidence outside a certification run; the certification path goes
 * through the axis, not through here.
 */
async function main(argv) {
  const outDir = argv.find((a) => !a.startsWith("--"));
  if (!outDir) {
    process.stderr.write("usage: sbomGenerate.mjs <outDir> [--no-images] [--timestamp <iso>]\n");
    return 2;
  }
  const noImages = argv.includes("--no-images");
  const tsIdx = argv.indexOf("--timestamp");
  const timestamp = tsIdx !== -1 ? argv[tsIdx + 1] : new Date().toISOString();

  const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
  const { selectEngine, resolveIdentitySet } = await import("./imageIdentity.mjs");
  const { externalBinaryInventory } = await import("./toolProvenance.mjs");

  const lockfiles = [
    { component: "backend", lock: readJson(path.join(repoRoot, "backend", "package-lock.json")) },
    { component: "frontend", lock: readJson(path.join(repoRoot, "frontend", "package-lock.json")) },
  ];

  let osInventories = [];
  let externalBinaries = null;
  let identity = null;

  if (!noImages) {
    const engine = selectEngine();
    identity = resolveIdentitySet({
      backend: process.env.RUNTIME_PACKAGE_BACKEND_IMAGE || "localhost/openshift-airgap-architect-backend:latest",
      frontend: process.env.RUNTIME_PACKAGE_FRONTEND_IMAGE || "localhost/openshift-airgap-architect-frontend:latest",
    });
    if (!identity.ok) {
      process.stderr.write(`image identity unresolved: ${identity.reason}\n`);
      return 1;
    }
    osInventories = identity.images.map((img) => ({
      role: img.role,
      ...rpmComponentsFromImage(engine, img.identity.id, { imageRole: img.role }),
    }));
    const backend = identity.images.find((i) => i.role === "backend");
    externalBinaries = externalBinaryInventory(engine, backend.identity.id);
  }

  const result = generateInventory({
    lockfiles,
    osInventories,
    externalBinaries,
    timestamp,
    subject: { type: "application", name: "openshift-airgap-architect", version: fs.readFileSync(path.join(repoRoot, "VERSION"), "utf8").trim() },
    // Bind the document to the exact images its shipped-os scope was read
    // from, so the BOM is self-contained evidence rather than a list that
    // needs a sibling file to be meaningful.
    subjectImages: identity?.images ?? null,
  });

  fs.mkdirSync(outDir, { recursive: true });
  if (identity) fs.writeFileSync(path.join(outDir, "image-identity.json"), `${JSON.stringify(identity, null, 2)}\n`);
  if (externalBinaries) fs.writeFileSync(path.join(outDir, "external-binaries.json"), `${JSON.stringify(externalBinaries, null, 2)}\n`);

  if (!result.ok) {
    fs.writeFileSync(path.join(outDir, "inventory-refused.json"), `${JSON.stringify({ problems: result.problems }, null, 2)}\n`);
    process.stderr.write(`REFUSED: ${result.problems.join("; ")}\n`);
    return 1;
  }
  fs.writeFileSync(path.join(outDir, "inventory.cdx.json"), `${JSON.stringify(result.bom, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result.tally, null, 2)}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main(process.argv.slice(2)));
}
