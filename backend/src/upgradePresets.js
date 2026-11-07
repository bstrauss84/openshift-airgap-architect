/**
 * Previous ImageSetConfigurations as OPTIONAL, EDITABLE presets for an
 * Upgrade plan (v2.3.0 owner correction pass).
 *
 * An ImageSetConfiguration says what someone once asked oc-mirror to mirror.
 * It is NOT a record of what is installed in a cluster, what was mirrored
 * successfully, what was transferred, or what is in a registry. Everything
 * extracted here is labelled "imported preset (unverified)" with per-file
 * provenance, and nothing is applied to a plan until the user accepts it.
 *
 * Parsing: the shared safe YAML parser (size, encoding, depth and alias
 * limits; no custom tags). oc-mirror v2 files (mirror.openshift.io/v2alpha1)
 * also pass the shared structural validator. oc-mirror v1 files
 * (mirror.openshift.io/v1alpha2) are read field by field for the same few
 * fields only (platform channels, operator catalogs/packages/channels,
 * additional images); everything else in them is ignored and said so.
 * Unsupported OpenShift minors are reported and never used to widen support.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import crypto from "node:crypto";
import { parseImageSetConfigText, validateImageSetConfigText } from "./imagesetConfigValidator.js";
import { sanitizeFileName } from "./mirroringImport.js";
import { SUPPORTED_MINORS } from "./versionPolicy.js";
import { getMinorVersion } from "../../shared/versionUtils.js";
import { gaVersion } from "../../shared/upgradePath.js";

export const MAX_PRESET_FILES = 10;
export const MAX_PRESET_TOTAL_BYTES = 6 * 1024 * 1024;
export const PRESET_CONFIDENCE = "imported preset (unverified): what a configuration file asked to mirror, not what is installed or mirrored";

const CATALOG_RE = /^registry\.redhat\.io\/redhat\/(redhat|certified|community)-operator-index:v(\d+\.\d+)$/;
const PACKAGE_RE = /^[a-z0-9][a-z0-9._-]{0,252}$/;
const CHANNEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RELEASE_CHANNEL_RE = /^(stable|fast|eus|candidate)-(\d+\.\d+)$/;
const IMAGE_RE = /^[a-z0-9][a-z0-9.\-]*(:\d+)?(\/[a-z0-9._\-]+)+(:[A-Za-z0-9._-]{1,128}|@sha256:[a-f0-9]{64})$/;

const minorOf = (v) => { try { return getMinorVersion(String(v)); } catch { return null; } };
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);

/** Read the few fields we use from a parsed document, tolerating v1 and v2 shapes. */
const extract = (doc) => {
  const notes = [];
  const m = isObj(doc.mirror) ? doc.mirror : {};
  const releases = [];
  if (isObj(m.platform)) {
    for (const ch of arr(m.platform.channels)) {
      if (!isObj(ch) || typeof ch.name !== "string") { notes.push("A platform channel entry without a name was ignored."); continue; }
      const cm = RELEASE_CHANNEL_RE.exec(ch.name);
      releases.push({
        channel: ch.name,
        channelMinor: cm ? cm[2] : null,
        minVersion: gaVersion(ch.minVersion) || null,
        maxVersion: gaVersion(ch.maxVersion) || null,
        shortestPath: ch.shortestPath === true,
        full: ch.full === true
      });
    }
    const archs = arr(m.platform.architectures).filter((a) => typeof a === "string");
    if (archs.length) releases.forEach((r) => { r.architectures = archs.slice(0, 4); });
  }
  const operators = [];
  for (const op of arr(m.operators)) {
    if (!isObj(op) || typeof op.catalog !== "string") continue;
    const cm = CATALOG_RE.exec(op.catalog);
    if (!cm) { notes.push(`Catalog ${op.catalog.slice(0, 120)} is not a Red Hat, certified or community index tagged by OpenShift minor; its packages were not offered.`); continue; }
    if (!arr(op.packages).length) { notes.push(`Catalog ${op.catalog} mirrors the whole catalog (no packages listed); no individual operators were offered.`); continue; }
    for (const pkg of arr(op.packages)) {
      if (!isObj(pkg) || !PACKAGE_RE.test(String(pkg.name || ""))) { notes.push("A package entry with an invalid name was ignored."); continue; }
      const channels = arr(pkg.channels).filter((c) => isObj(c) && CHANNEL_RE.test(String(c.name || ""))).map((c) => ({ name: c.name, minVersion: typeof c.minVersion === "string" ? c.minVersion.slice(0, 64) : null, maxVersion: typeof c.maxVersion === "string" ? c.maxVersion.slice(0, 64) : null }));
      operators.push({ name: pkg.name, catalogKind: cm[1], catalogMinor: cm[2], catalogImage: op.catalog, channels, defaultChannel: CHANNEL_RE.test(String(pkg.defaultChannel || "")) ? pkg.defaultChannel : null });
    }
  }
  const images = [];
  for (const img of arr(m.additionalImages)) {
    const name = isObj(img) ? String(img.name || "") : "";
    if (IMAGE_RE.test(name) && name.length <= 512) images.push(name);
    else if (name) notes.push(`Additional image ${name.slice(0, 80)} is not a full image reference and was ignored.`);
  }
  for (const k of ["helm", "blockedImages", "samples"]) if (m[k] && (!Array.isArray(m[k]) || m[k].length)) notes.push(`mirror.${k} is not used by Upgrade presets.`);
  return { releases, operators, images, notes };
};

/**
 * Analyze one or more files. Pure; nothing is stored.
 * @param {{name: string, text: string}[]} files
 */
export const analyzePresetFiles = (files) => {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return { error: { status: 400, code: "PRESET_NO_FILES", message: "Choose at least one ImageSetConfiguration file." } };
  if (list.length > MAX_PRESET_FILES) return { error: { status: 413, code: "PRESET_TOO_MANY", message: `At most ${MAX_PRESET_FILES} files at once.` } };
  const total = list.reduce((n, f) => n + Buffer.byteLength(String(f?.text || "")), 0);
  if (total > MAX_PRESET_TOTAL_BYTES) return { error: { status: 413, code: "PRESET_TOO_LARGE", message: `The files total ${total} bytes; the limit is ${MAX_PRESET_TOTAL_BYTES}.` } };

  const fileResults = [];
  const releases = new Map();
  const operators = new Map();
  const images = new Map();
  list.forEach((f, index) => {
    const fileName = sanitizeFileName(f?.name);
    const parsed = parseImageSetConfigText(String(f?.text ?? ""));
    const sha256 = parsed.meta?.sha256 || crypto.createHash("sha256").update(String(f?.text ?? "")).digest("hex");
    const base = { index, fileName, sha256, bytes: parsed.meta?.bytes || 0 };
    if (!parsed.ok) { fileResults.push({ ...base, status: "invalid", format: null, errors: parsed.errors.map((e) => e.message) }); return; }
    const doc = parsed.document;
    const apiVersion = isObj(doc) ? doc.apiVersion : null;
    if (!isObj(doc) || doc.kind !== "ImageSetConfiguration") { fileResults.push({ ...base, status: "invalid", format: null, errors: ["This is not an ImageSetConfiguration (kind)."] }); return; }
    let format;
    if (apiVersion === "mirror.openshift.io/v2alpha1") {
      const v = validateImageSetConfigText(String(f.text));
      if (!v.ok) { fileResults.push({ ...base, status: "invalid", format: "oc-mirror v2", errors: v.errors.slice(0, 10).map((e) => e.message) }); return; }
      format = "oc-mirror v2 (v2alpha1)";
    } else if (apiVersion === "mirror.openshift.io/v1alpha2") {
      format = "oc-mirror v1 (v1alpha2) — read for platform channels, operator packages and additional images only";
    } else {
      fileResults.push({ ...base, status: "invalid", format: null, errors: [`Unsupported apiVersion ${String(apiVersion).slice(0, 60)}; expected mirror.openshift.io/v2alpha1 (or v1alpha2).`] });
      return;
    }
    const ex = extract(doc);
    const source = { file: fileName, sha256 };
    for (const r of ex.releases) {
      const key = `${r.channel}|${r.minVersion}|${r.maxVersion}`;
      const supported = Boolean(r.channelMinor && SUPPORTED_MINORS.includes(r.channelMinor));
      const cur = releases.get(key) || { ...r, supported, sources: [] };
      cur.sources.push(source);
      releases.set(key, cur);
    }
    for (const o of ex.operators) {
      const key = `${o.catalogKind}|${o.name}`;
      const cur = operators.get(key) || { key, name: o.name, catalogKind: o.catalogKind, variants: [], sources: [] };
      cur.variants.push({ catalogMinor: o.catalogMinor, supportedMinor: SUPPORTED_MINORS.includes(o.catalogMinor), channels: o.channels, defaultChannel: o.defaultChannel, source });
      cur.sources.push(source);
      operators.set(key, cur);
    }
    for (const img of ex.images) {
      const cur = images.get(img) || { name: img, sources: [] };
      cur.sources.push(source);
      images.set(img, cur);
    }
    fileResults.push({ ...base, status: "valid", format, notes: ex.notes.slice(0, 30) });
  });

  // Reconcile operators: a duplicate is fine; differing channels across files are a conflict the user resolves.
  const operatorProposals = [...operators.values()].map((o) => {
    const channelNames = [...new Set(o.variants.flatMap((v) => v.channels.map((c) => c.name)))];
    const minors = [...new Set(o.variants.map((v) => v.catalogMinor))];
    const conflicts = [];
    if (channelNames.length > 1) conflicts.push(`Files name different channels: ${channelNames.join(", ")}. Choose one.`);
    if (minors.some((m) => !SUPPORTED_MINORS.includes(m))) conflicts.push(`Catalog minor(s) ${minors.filter((m) => !SUPPORTED_MINORS.includes(m)).join(", ")} are not supported; the stage catalogs (${SUPPORTED_MINORS.join(", ")}) are used instead, and the channel must be checked there.`);
    return {
      key: o.key, name: o.name, catalogKind: o.catalogKind, catalogMinors: minors, channelOptions: channelNames,
      suggestedChannel: channelNames.length === 1 ? channelNames[0] : null,
      duplicates: o.sources.length > 1 ? o.sources.length : 0,
      conflicts, sources: o.sources, confidence: PRESET_CONFIDENCE
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const releaseProposals = [...releases.values()].map((r) => ({ ...r, confidence: PRESET_CONFIDENCE, note: r.supported ? "A hint only: it is what a file mirrored, not the cluster's current release." : `OpenShift ${r.channelMinor || "?"} is outside the supported minors; shown for context, never used.` }));
  const imageProposals = [...images.values()].map((i) => ({ ...i, duplicates: i.sources.length > 1 ? i.sources.length : 0, confidence: PRESET_CONFIDENCE }));
  return { files: fileResults, releases: releaseProposals, operators: operatorProposals, images: imageProposals, confidence: PRESET_CONFIDENCE };
};

/** Operator categories the plan distinguishes (owner correction pass). */
export const OPERATOR_CATEGORIES = Object.freeze({
  "preset-mirrored": "Previously mirrored or selected (from imported configuration files; unverified)",
  installed: "Currently installed (confirmed by you or by an imported cluster export)",
  requested: "New operator requested for installation",
  retained: "Installed and kept without a requested update"
});
export const OPERATOR_CONFIDENCE = Object.freeze(["imported-preset", "cluster-export", "user-confirmed", "user-entered"]);
