/**
 * OpenShift Airgap Architect - ImageSetConfiguration import (v2.2.0 M4)
 *
 * Turns one or more existing oc-mirror v2 ImageSetConfiguration files into
 * Mirroring profiles. Pure: no filesystem, no state, no oc-mirror. The routes
 * persist the result (and the original bytes) in one write.
 *
 * Contract:
 *  - Every file goes through the shared structural validator first
 *    (imagesetConfigValidator.js). An invalid file is never applied.
 *  - Mapping never invents anything: no platform release, catalog minor,
 *    channel or package metadata that the file does not state. A section the
 *    guided editor cannot represent faithfully (several release channels, a
 *    custom catalog, targetRepo, helm, ...) is NOT transformed: it is listed
 *    as an unresolved item, the original file is kept, and the profile is not
 *    ready until the user explicitly leaves each item out.
 *  - Unsupported OpenShift minors are reported, never replaced (No Fallback).
 *  - A file whose catalogs and platform release name different minors is
 *    imported as written (catalogMinorSource "import"); the profile then asks
 *    the user to align or split, like any other preserved conflict.
 *  - Several files can become separate profiles, one merged profile, or be
 *    merged into an existing profile. Any ambiguous or destructive merge is a
 *    conflict that needs an explicit resolution before anything is applied.
 *    Rows a person typed or edited in an existing profile are never removed
 *    or changed by an import.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

import crypto from "node:crypto";
import { validateImageSetConfigText, MAX_IMAGESET_CONFIG_BYTES } from "./imagesetConfigValidator.js";
import { getMinorVersion } from "../../shared/versionUtils.js";
import { isSupportedMinor } from "./versionPolicy.js";

export const MAX_IMPORT_FILES = 10;
export const MAX_IMPORT_TOTAL_BYTES = 6 * 1024 * 1024;
export const IMPORT_MODES = Object.freeze(["separate", "merge", "into"]);

const CATALOG_RE = /^registry\.redhat\.io\/redhat\/(redhat|certified|community)-operator-index:v(\d+\.\d+)$/;
const ARCH_FROM_MIRROR = { amd64: "x86_64", arm64: "aarch64" };

/** Display-safe file name: basename only, no control characters, bounded. */
export const sanitizeFileName = (name) => {
  const base = String(name || "").split(/[\\/]/).pop() || "";
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
  return clean || "imported.yaml";
};

const minorOf = (version) => {
  try { return getMinorVersion(String(version)); } catch { return null; }
};

const shortId = (seed) => crypto.createHash("sha256").update(seed).digest("hex").slice(0, 12);

const item = (path, code, message) => ({ id: `u-${shortId(`${path}|${code}|${message}`)}`, path, code, message, status: "open" });

/**
 * Map one structurally valid, normalized document into profile fields.
 *
 * @returns {{ content, platform, operators, additionalImages, options, unresolved: object[] }}
 */
export const mapDocumentToProfile = (doc, { importId, fileName }) => {
  const unresolved = [];
  const m = doc.mirror || {};
  const content = { platform: false, operators: false, additionalImages: false };
  const out = { content, platform: null, operators: null, additionalImages: [], options: {}, unresolved };

  // ---- platform --------------------------------------------------------
  if (m.platform) {
    const p = m.platform;
    const channels = Array.isArray(p.channels) ? p.channels : [];
    if (p.release) unresolved.push(item("mirror.platform.release", "UNREPRESENTABLE", "A release image pinned with mirror.platform.release cannot be edited here."));
    if (channels.length === 0) {
      unresolved.push(item("mirror.platform", "UNREPRESENTABLE", "The platform section names no release channel, so there is no OpenShift release to mirror."));
    } else if (channels.length > 1) {
      unresolved.push(item("mirror.platform.channels", "UNREPRESENTABLE", `The file mirrors ${channels.length} release channels (${channels.map((c) => c.name).join(", ")}). A profile mirrors one OpenShift release; import each channel as its own profile or edit the file.`));
    } else {
      const ch = channels[0];
      const chMatch = /^stable-(\d+\.\d+)$/.exec(ch.name || "");
      const reasons = [];
      if (!chMatch) reasons.push(`channel ${ch.name} (the guided editor mirrors stable-<minor> channels)`);
      if (ch.type && ch.type !== "ocp") reasons.push(`type ${ch.type}`);
      if (ch.shortestPath) reasons.push("shortestPath");
      if (ch.full) reasons.push("full");
      if (!ch.minVersion || ch.minVersion !== ch.maxVersion) reasons.push("a version range (the guided editor mirrors exactly one release: minVersion equal to maxVersion)");
      const chMinor = chMatch ? chMatch[1] : null;
      if (chMinor && ch.minVersion && minorOf(ch.minVersion) !== chMinor) reasons.push(`release ${ch.minVersion}, which is not in channel ${ch.name}`);
      if (reasons.length) {
        unresolved.push(item("mirror.platform.channels[0]", "UNREPRESENTABLE", `The platform channel uses ${reasons.join(", ")}, which the guided editor cannot represent without changing what is mirrored.`));
      } else if (!isSupportedMinor(chMinor)) {
        unresolved.push(item("mirror.platform.channels[0]", "UNSUPPORTED_VERSION", `OpenShift ${chMinor} is not supported by this version of OpenShift Airgap Architect. The platform release was not imported, and no other release was substituted.`));
      } else {
        const archs = Array.isArray(p.architectures) ? p.architectures : [];
        let architecture = null;
        let archOk = true;
        if (archs.length > 1 || (archs.length === 1 && !ARCH_FROM_MIRROR[archs[0]])) {
          archOk = false;
          unresolved.push(item("mirror.platform.architectures", "UNREPRESENTABLE", `Architectures ${archs.join(", ")} cannot be represented; a profile mirrors one architecture (amd64 or arm64).`));
        } else if (archs.length === 1) {
          architecture = ARCH_FROM_MIRROR[archs[0]];
        }
        if (archOk) {
          content.platform = true;
          out.platform = {
            release: { channel: chMinor, patchVersion: ch.minVersion, confirmed: false },
            version: { selectedMinor: chMinor, selectedPatch: ch.minVersion, selectedChannel: ch.name, selectedVersion: ch.minVersion, locked: false },
            architecture,
            // Absent means false in oc-mirror; the profile model defaults to true, so set it explicitly.
            graph: p.graph === true,
            kubeVirtContainer: p.kubeVirtContainer === true
          };
        }
      }
    }
  }

  // ---- operators ---------------------------------------------------------
  if (Array.isArray(m.operators) && m.operators.length) {
    const usable = [];
    m.operators.forEach((op, i) => {
      const base = `mirror.operators[${i}]`;
      const cm = CATALOG_RE.exec(op.catalog || "");
      const extras = ["targetCatalog", "targetTag", "full", "skipDependencies", "targetCatalogSourceTemplate"].filter((k) => op[k] !== undefined && op[k] !== false && op[k] !== "");
      if (!cm) {
        unresolved.push(item(`${base}.catalog`, "UNREPRESENTABLE", `Catalog ${op.catalog} is not one of the Red Hat, certified or community index images tagged by OpenShift minor (custom, digest-pinned and oci:// catalogs are kept in the original file but cannot be edited here).`));
        return;
      }
      if (extras.length) {
        unresolved.push(item(base, "UNREPRESENTABLE", `Catalog ${op.catalog} uses ${extras.join(", ")}, which the guided editor cannot represent.`));
        return;
      }
      if (!Array.isArray(op.packages) || op.packages.length === 0) {
        unresolved.push(item(`${base}.packages`, "UNREPRESENTABLE", `Catalog ${op.catalog} lists no packages, which mirrors the whole catalog. The guided editor mirrors chosen packages only.`));
        return;
      }
      usable.push({ index: i, key: cm[1], minor: cm[2], op });
    });
    const minors = [...new Set(usable.map((u) => u.minor))];
    if (minors.length > 1) {
      unresolved.push(item("mirror.operators", "UNREPRESENTABLE", `The catalogs are for several OpenShift minors (${minors.join(", ")}). A profile uses one catalog minor; import them as separate files or edit the file.`));
    } else if (minors.length === 1 && !isSupportedMinor(minors[0])) {
      unresolved.push(item("mirror.operators", "UNSUPPORTED_VERSION", `The operator catalogs are for OpenShift ${minors[0]}, which this version of OpenShift Airgap Architect does not support. They were not imported, and no other minor was substituted.`));
    } else if (minors.length === 1) {
      const selected = [];
      for (const u of usable) {
        u.op.packages.forEach((pkg, j) => {
          const path = `mirror.operators[${u.index}].packages[${j}]`;
          const channels = Array.isArray(pkg.channels) ? pkg.channels : [];
          if (pkg.defaultChannel) {
            unresolved.push(item(path, "UNREPRESENTABLE", `Package ${pkg.name} sets defaultChannel, which the guided editor cannot represent.`));
            return;
          }
          if (channels.length > 1) {
            unresolved.push(item(path, "UNREPRESENTABLE", `Package ${pkg.name} mirrors ${channels.length} channels (${channels.map((c) => c.name).join(", ")}); the guided editor mirrors one channel per package.`));
            return;
          }
          if (channels.length === 0 && (pkg.minVersion || pkg.maxVersion)) {
            unresolved.push(item(path, "UNREPRESENTABLE", `Package ${pkg.name} filters versions on the package itself; the guided editor filters on a channel.`));
            return;
          }
          const ch = channels[0] || null;
          selected.push({
            id: `${u.op.catalog}::${pkg.name}`,
            name: pkg.name,
            catalog: u.key,
            catalogImage: u.op.catalog,
            // The channel the file names, or none: never the catalog's default
            // invented here. A package without a channel is resolved to the
            // catalog's default channel only when the scanned catalogs say so.
            defaultChannel: ch ? ch.name : null,
            ...(ch?.minVersion ? { minVersion: ch.minVersion } : {}),
            ...(ch?.maxVersion ? { maxVersion: ch.maxVersion } : {}),
            sources: [`import:${importId}`]
          });
        });
      }
      if (selected.length) {
        content.operators = true;
        out.operators = { catalogMinor: minors[0], catalogMinorSource: "import", selected };
      }
    }
  }

  // ---- additional images -------------------------------------------------
  if (Array.isArray(m.additionalImages)) {
    m.additionalImages.forEach((img, i) => {
      if (img.targetRepo || img.targetTag) {
        unresolved.push(item(`mirror.additionalImages[${i}]`, "UNREPRESENTABLE", `Image ${img.name} sets targetRepo/targetTag, which the guided editor cannot represent.`));
        return;
      }
      out.additionalImages.push({ id: `img-imp${shortId(`${importId}|${i}|${img.name}`)}`, name: img.name, source: `import:${fileName}`.slice(0, 64) });
    });
    if (out.additionalImages.length) content.additionalImages = true;
  }

  // ---- everything else the guided editor does not model ------------------
  for (const [key, label] of [["blockedImages", "Blocked images"], ["helm", "Helm charts"], ["samples", "Samples"]]) {
    if (m[key] && (!Array.isArray(m[key]) || m[key].length) && (key !== "helm" || (m.helm.local?.length || m.helm.repositories?.length))) {
      unresolved.push(item(`mirror.${key}`, "UNREPRESENTABLE", `${label} (mirror.${key}) are kept in the original file but cannot be edited or generated here yet.`));
    }
  }
  if (Number.isSafeInteger(doc.archiveSize) && doc.archiveSize >= 1) out.options.archiveSize = doc.archiveSize;
  return out;
};

/**
 * Validate and map each file. `files` is [{ name, bytes: Buffer }].
 * @returns {{ files: object[], totalBytes: number }}
 */
export const analyzeFiles = (files) => {
  let totalBytes = 0;
  const analyzed = files.map((f, index) => {
    const fileName = sanitizeFileName(f.name);
    totalBytes += f.bytes.length;
    const result = validateImageSetConfigText(f.bytes);
    const sha256 = result.meta.sha256;
    const importId = `imp-${sha256.slice(0, 12)}`;
    const base = { index, fileName, bytes: f.bytes.length, sha256, importId, stage: result.stage, errors: result.errors, warnings: result.warnings };
    if (!result.ok) return { ...base, status: "invalid" };
    const mapped = mapDocumentToProfile(result.normalized, { importId, fileName });
    const anyContent = Object.values(mapped.content).some(Boolean);
    return { ...base, status: "valid", mapped, representable: anyContent };
  });
  return { files: analyzed, totalBytes };
};

const releaseKey = (platform) => (platform ? JSON.stringify([platform.release.patchVersion, platform.architecture, platform.graph, platform.kubeVirtContainer]) : null);
const describeRelease = (platform) => `release ${platform.release.patchVersion}${platform.architecture ? ` (${platform.architecture})` : ""}${platform.graph ? ", graph" : ""}${platform.kubeVirtContainer ? ", KubeVirt container" : ""}`;
const describeOp = (op) => `channel ${op.defaultChannel || "(catalog default)"}${op.minVersion ? `, from ${op.minVersion}` : ""}${op.maxVersion ? `, up to ${op.maxVersion}` : ""}`;
const opSignature = (op) => JSON.stringify([op.defaultChannel || null, op.minVersion || null, op.maxVersion || null]);

/**
 * Conflicts among the sources being merged. A source is
 * { label, mapped } where mapped has content/platform/operators/additionalImages/options.
 * Returns [{ id, kind, message, options: [{ id, label }] }]. Option ids are
 * source indexes as strings.
 */
export const detectMergeConflicts = (sources) => {
  const conflicts = [];
  const withPlatform = sources.map((s, i) => ({ i, s })).filter(({ s }) => s.mapped.platform);
  const distinctReleases = new Map();
  for (const { i, s } of withPlatform) {
    const k = releaseKey(s.mapped.platform);
    if (!distinctReleases.has(k)) distinctReleases.set(k, i);
  }
  if (distinctReleases.size > 1) {
    conflicts.push({
      id: "platform",
      kind: "platform",
      message: "The sources mirror different OpenShift platform releases. A profile mirrors one release.",
      options: [...distinctReleases.values()].map((i) => ({ id: String(i), label: `${sources[i].label}: ${describeRelease(sources[i].mapped.platform)}` }))
    });
  }
  const withOps = sources.map((s, i) => ({ i, s })).filter(({ s }) => s.mapped.operators);
  const minors = new Map();
  for (const { i, s } of withOps) if (!minors.has(s.mapped.operators.catalogMinor)) minors.set(s.mapped.operators.catalogMinor, i);
  if (minors.size > 1) {
    conflicts.push({
      id: "catalog-minor",
      kind: "catalog-minor",
      message: "The sources use operator catalogs for different OpenShift minors. A profile uses one catalog minor; operators from the other sources are re-resolved from the chosen minor's catalogs.",
      options: [...minors.entries()].map(([minor, i]) => ({ id: String(i), label: `${sources[i].label}: OpenShift ${minor} catalogs` }))
    });
  }
  // Same package (catalog + name) with a different channel or version range.
  const byPkg = new Map();
  for (const { i, s } of withOps) {
    for (const op of s.mapped.operators.selected) {
      const k = `${op.catalog || ""}|${op.name}`;
      if (!byPkg.has(k)) byPkg.set(k, new Map());
      const sig = opSignature(op);
      if (!byPkg.get(k).has(sig)) byPkg.get(k).set(sig, { i, op });
    }
  }
  for (const [k, sigs] of byPkg) {
    if (sigs.size < 2) continue;
    const name = k.split("|")[1];
    conflicts.push({
      id: `package:${k}`,
      kind: "package",
      message: `Package ${name} is listed with different channels or version limits.`,
      options: [...sigs.values()].map(({ i, op }) => ({ id: String(i), label: `${sources[i].label}: ${describeOp(op)}` }))
    });
  }
  const sizes = new Map();
  for (const [i, s] of sources.entries()) if (s.mapped.options?.archiveSize && !sizes.has(s.mapped.options.archiveSize)) sizes.set(s.mapped.options.archiveSize, i);
  if (sizes.size > 1) {
    conflicts.push({
      id: "archive-size",
      kind: "option",
      message: "The sources set different archive sizes.",
      options: [...sizes.entries()].map(([size, i]) => ({ id: String(i), label: `${sources[i].label}: ${size} GiB` }))
    });
  }
  return conflicts;
};

/**
 * Merge mapped sources into one profile body, applying resolutions. Source 0
 * may be an existing profile (mode "into"); its user-owned image rows and
 * operators are kept unchanged.
 * @returns {{ body: object, notes: string[] }}
 */
export const mergeSources = (sources, resolutions) => {
  const notes = [];
  const pick = (id, fallbackIndex) => {
    const chosen = resolutions?.[id];
    return chosen !== undefined ? Number(chosen) : fallbackIndex;
  };
  const content = { platform: false, operators: false, additionalImages: false };
  let platform = null;
  const platIdx = pick("platform", sources.findIndex((s) => s.mapped.platform));
  if (platIdx >= 0 && sources[platIdx]?.mapped.platform) {
    platform = sources[platIdx].mapped.platform;
    content.platform = true;
  }
  let operators = null;
  const opsSources = sources.map((s, i) => ({ s, i })).filter(({ s }) => s.mapped.operators);
  if (opsSources.length) {
    const minorIdx = pick("catalog-minor", opsSources[0].i);
    const minor = sources[minorIdx].mapped.operators.catalogMinor;
    const source = sources[minorIdx].mapped.operators.catalogMinorSource || "import";
    // Every source's entries per package; a resolution picks the source, else
    // identical entries collapse to the first (a real difference is a conflict
    // and apply refuses until it is resolved).
    const byKey = new Map();
    for (const { s, i } of opsSources) {
      for (const op of s.mapped.operators.selected) {
        const k = `${op.catalog || ""}|${op.name}`;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push({ op, i });
      }
    }
    for (const [k, entries] of byKey) {
      const chosen = resolutions?.[`package:${k}`];
      const hit = chosen !== undefined ? entries.find((e) => e.i === Number(chosen)) : null;
      byKey.set(k, hit || entries[0]);
    }
    const selected = [...byKey.values()].map(({ op }) => {
      const tag = /:v(\d+\.\d+)$/.exec(op.catalogImage || "")?.[1];
      // From another minor: keep the package as intent; re-resolved from the chosen minor's catalogs.
      return tag && tag !== minor ? { id: op.id.replace(/:v\d+\.\d+::/, `:v${minor}::`), name: op.name, ...(op.displayName ? { displayName: op.displayName } : {}), ...(op.sources ? { sources: op.sources } : {}) } : op;
    });
    operators = { catalogMinor: minor, catalogMinorSource: source, selected };
    content.operators = selected.length > 0;
  }
  const images = [];
  const seen = new Set();
  for (const s of sources) {
    for (const img of s.mapped.additionalImages || []) {
      if (seen.has(img.name)) {
        notes.push(`Image ${img.name} appeared more than once; it is listed once.`);
        continue;
      }
      seen.add(img.name);
      images.push(img);
    }
  }
  content.additionalImages = images.length > 0;
  const sizeIdx = pick("archive-size", sources.findIndex((s) => s.mapped.options?.archiveSize));
  const archiveSize = sizeIdx >= 0 ? sources[sizeIdx]?.mapped.options?.archiveSize : undefined;
  return {
    body: { content, platform, operators, additionalImages: images, options: archiveSize ? { archiveSize } : {} },
    notes
  };
};

/** Existing profile as a merge source (mode "into"). */
export const profileAsSource = (profile) => ({
  label: `Current profile "${profile.name}"`,
  mapped: {
    content: profile.content,
    platform: profile.content.platform && profile.platform.release.patchVersion ? profile.platform : null,
    operators: profile.content.operators && profile.operators.catalogMinor ? profile.operators : null,
    additionalImages: profile.additionalImages,
    options: profile.options || {}
  }
});

/** Size checks for an import request. Returns an error message or "". */
export const importSizeProblem = (files) => {
  if (!files.length) return "Choose at least one file to import.";
  if (files.length > MAX_IMPORT_FILES) return `At most ${MAX_IMPORT_FILES} files can be imported at once.`;
  const total = files.reduce((n, f) => n + f.bytes.length, 0);
  if (total > MAX_IMPORT_TOTAL_BYTES) return `The files total ${total} bytes; at most ${MAX_IMPORT_TOTAL_BYTES} bytes can be imported at once.`;
  const big = files.find((f) => f.bytes.length > MAX_IMAGESET_CONFIG_BYTES);
  if (big) return `${sanitizeFileName(big.name)} is larger than ${MAX_IMAGESET_CONFIG_BYTES} bytes (1 MiB).`;
  return "";
};
