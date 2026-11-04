/**
 * OpenShift Airgap Architect - oc-mirror v2 ImageSetConfiguration validator
 * (v2.2.0 M4, DOC-166)
 *
 * ONE structural authority for every workflow. The Install generator's
 * output, the Install external-config preflight, Mirroring profile previews
 * and Mirroring imports are all checked here, against
 * `data/oc-mirror-v2/imageset-config-schema.json` (the global, tool-scoped
 * schema; never a per-minor copy). There is no second allowlist anywhere.
 *
 * What "valid" means here, precisely:
 *  - STRUCTURALLY valid: oc-mirror v2 would decode the document and pass its
 *    own `Validate` checks, plus the Architect policy rules recorded in the
 *    schema (where the binary would accept the file but then fail later, or
 *    silently lose part of the user's intent: a second YAML document, a
 *    case-duplicated key, an unknown channel type, a missing package name).
 *  - It is NOT a statement that a catalog, package, channel or image exists.
 *    Availability needs a live catalog scan or registry access, which this
 *    module never performs.
 *  - It is NOT a statement about OpenShift version support. Supported-minor
 *    rules (No Fallback) are applied by the callers, separately.
 *
 * Every finding carries an `authority`: "binary" (oc-mirror refuses the
 * document when loading it), "binary-at-run" (oc-mirror loads it, then fails
 * while collecting content) or "architect" (oc-mirror would accept it but
 * silently lose or misread part of it; Architect refuses it up front).
 *
 * Parsing is bounded: size, encoding, document count, nesting depth, aliases,
 * expanded node count and YAML tags. Messages name the path and the rule and
 * never echo a value that could be a credential.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import yaml from "js-yaml";
import { canonicalDataRoot } from "./canonicalDataRoot.js";

export const MAX_IMAGESET_CONFIG_BYTES = 1024 * 1024;
export const MAX_YAML_DEPTH = 32;
export const MAX_YAML_ALIASES = 20;
export const MAX_YAML_NODES = 20000;

const SCHEMA_REL = path.join("oc-mirror-v2", "imageset-config-schema.json");

export class ImageSetSchemaUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImageSetSchemaUnavailableError";
    this.code = "IMAGESET_SCHEMA_UNAVAILABLE";
  }
}

let cachedSchema = null;
let cachedFrom = null;

/**
 * Load the global schema. Fails closed: a missing or malformed authority is
 * an integrity error, never "everything is valid".
 */
export const loadImageSetConfigSchema = () => {
  const file = path.join(canonicalDataRoot(), SCHEMA_REL);
  if (cachedSchema && cachedFrom === file) return cachedSchema;
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new ImageSetSchemaUnavailableError(`The oc-mirror ImageSetConfiguration schema could not be loaded (${path.basename(file)}): ${err.code || err.message}`);
  }
  if (!schema || typeof schema.fields !== "object" || !Array.isArray(schema.paths) || !Array.isArray(schema.rules)) {
    throw new ImageSetSchemaUnavailableError("The oc-mirror ImageSetConfiguration schema is incomplete (fields, paths and rules are required).");
  }
  cachedSchema = schema;
  cachedFrom = file;
  return schema;
};

/** Test seam. */
export const _resetImageSetSchemaCacheForTests = () => { cachedSchema = null; cachedFrom = null; };

// --------------------------------------------------------------------------
// Value description that never leaks credentials
// --------------------------------------------------------------------------

const CREDENTIAL_URL_RE = /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]*@/i;

/** Short, credential-free rendering of a scalar for an error message. */
export const describeValue = (value) => {
  if (value === null) return "null";
  if (typeof value === "string") {
    const clean = value
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1***@")
      .replace(/[\u0000-\u001f\u007f]/g, "?");
    return JSON.stringify(clean.length > 120 ? `${clean.slice(0, 117)}...` : clean);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return "a list";
  return "a mapping";
};

const typeOf = (v) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  if (typeof v === "object") return "a mapping";
  if (typeof v === "number") return Number.isInteger(v) ? "a whole number" : "a number";
  return `a ${typeof v}`;
};

// --------------------------------------------------------------------------
// Parsing
// --------------------------------------------------------------------------

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const parseError = (code, message, mark) => ({
  code,
  message,
  ...(mark && Number.isInteger(mark.line) ? { line: mark.line + 1, column: (mark.column || 0) + 1 } : {})
});

/**
 * Decode and parse ImageSetConfiguration text with every bound applied.
 *
 * @param {string|Buffer} input
 * @returns {{ ok: boolean, document?: object, errors: object[], meta: { bytes: number, sha256: string, documents: number, aliases: number } }}
 */
export const parseImageSetConfigText = (input) => {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(typeof input === "string" ? input : "", "utf8");
  const meta = { bytes: buf.length, sha256: sha256(buf), documents: 0, aliases: 0 };
  const fail = (code, message, mark) => ({ ok: false, errors: [parseError(code, message, mark)], meta });
  if (typeof input !== "string" && !Buffer.isBuffer(input)) return fail("NOT_TEXT", "The configuration must be text.");
  if (buf.length === 0) return fail("EMPTY_FILE", "The file is empty.");
  if (buf.length > MAX_IMAGESET_CONFIG_BYTES) {
    return fail("TOO_LARGE", `The file is ${buf.length} bytes; the limit is ${MAX_IMAGESET_CONFIG_BYTES} bytes (1 MiB). An ImageSetConfiguration is normally a few kilobytes.`);
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return fail("ENCODING", "The file is not valid UTF-8 text. Save it as UTF-8 (UTF-16 and other encodings are not accepted).");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Control characters other than tab / LF / CR mean a binary or mangled file.
  const ctrl = text.search(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
  if (ctrl !== -1) {
    const line = text.slice(0, ctrl).split("\n").length;
    return fail("CONTROL_CHARACTER", `The file contains a control character on line ${line}; it does not look like a YAML text file.`, { line: line - 1, column: 0 });
  }

  let aliases = 0;
  let docs;
  try {
    docs = yaml.loadAll(text, null, {
      schema: yaml.CORE_SCHEMA,
      json: false,
      maxDepth: MAX_YAML_DEPTH,
      listener: (event, state) => {
        // A node that begins with "*" is an alias; count them against the bound.
        // (An empty value closes with the same shape as an alias, so the
        // close event cannot tell them apart; the opening character can.)
        if (event !== "open") return;
        let p = state.position;
        while (state.input[p] === " " || state.input[p] === "\t") p += 1;
        if (state.input[p] === "*") aliases += 1;
      }
    });
  } catch (err) {
    const reason = String(err?.reason || err?.message || err);
    const mark = err?.mark;
    if (/maxDepth/.test(reason)) return fail("TOO_DEEP", `The YAML is nested more than ${MAX_YAML_DEPTH} levels deep.`, mark);
    if (/duplicated mapping key/.test(reason)) return fail("DUPLICATE_KEY", "A key appears twice in the same mapping. oc-mirror rejects this ('already set in map'); remove one of them.", mark);
    if (/unknown tag/.test(reason)) return fail("UNSUPPORTED_TAG", "The file uses a YAML tag (such as !!binary or a custom !tag) that an ImageSetConfiguration never needs. Use plain values.", mark);
    return fail("INVALID_YAML", `The file is not valid YAML: ${reason.replace(/[\u0000-\u001f]/g, " ").slice(0, 200)}.`, mark);
  }
  meta.aliases = aliases;
  const nonEmpty = docs.filter((d) => d !== null && d !== undefined);
  meta.documents = nonEmpty.length;
  if (nonEmpty.length === 0) return fail("EMPTY_FILE", "The file contains no YAML document.");
  if (nonEmpty.length > 1) {
    return fail("MULTIPLE_DOCUMENTS", `The file contains ${nonEmpty.length} YAML documents. oc-mirror reads only the first and silently ignores the rest, so import each ImageSetConfiguration as its own file.`);
  }
  if (aliases > MAX_YAML_ALIASES) {
    return fail("TOO_MANY_ALIASES", `The file uses ${aliases} YAML aliases (*name); at most ${MAX_YAML_ALIASES} are accepted. Expand the repeated sections.`);
  }
  // Expanded size bound (alias expansion can multiply nodes without bytes).
  let nodes = 0;
  const count = (v) => {
    nodes += 1;
    if (nodes > MAX_YAML_NODES) return;
    if (Array.isArray(v)) for (const x of v) { count(x); if (nodes > MAX_YAML_NODES) return; }
    else if (v && typeof v === "object") for (const x of Object.values(v)) { count(x); if (nodes > MAX_YAML_NODES) return; }
  };
  count(nonEmpty[0]);
  if (nodes > MAX_YAML_NODES) return fail("TOO_MANY_NODES", `The document expands to more than ${MAX_YAML_NODES} values.`);
  const doc = nonEmpty[0];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return fail("NOT_A_MAPPING", `The document is ${typeOf(doc)}; an ImageSetConfiguration is a mapping that starts with apiVersion and kind.`);
  }
  return { ok: true, document: doc, errors: [], meta };
};

// --------------------------------------------------------------------------
// Structural validation against the schema
// --------------------------------------------------------------------------

/** Masterminds semver.NewVersion (non-strict): optional v, 1-3 numeric parts, optional pre-release and build. */
const SEMVER_RE = /^v?(0|[1-9]\d*)(\.(0|[1-9]\d*))?(\.(0|[1-9]\d*))?(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
export const isSemverLike = (v) => typeof v === "string" && SEMVER_RE.test(v.trim());

// [registry[:port]/]path[:tag][@sha256:digest] — a tag or a digest is required.
// The registry is optional because oc-mirror's ParseRef accepts Docker Hub
// short names (upstream's own test data uses `redhat-operators:v4.7`).
const PATH_COMPONENT = "[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*";
const REF_RE = new RegExp(`^(?:(?<first>[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]+)?)\\/)?(?<path>${PATH_COMPONENT}(?:\\/${PATH_COMPONENT})*)(?::(?<tag>[\\w][\\w.-]{0,127}))?(?:@(?<digest>sha256:[a-f0-9]{64}))?$`);

/** Parse an image reference; null when it does not parse. */
export const parseImageReference = (value) => {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const ref = v.startsWith("docker://") ? v.slice("docker://".length) : v;
  const m = REF_RE.exec(ref);
  if (!m) return null;
  const first = m.groups.first || null;
  // A first segment is a registry host only if it looks like one.
  const isHost = Boolean(first && (first.includes(".") || first.includes(":") || first === "localhost"));
  return {
    registry: isHost ? first : null,
    repository: isHost ? m.groups.path : (first ? `${first}/${m.groups.path}` : m.groups.path),
    tag: m.groups.tag || null,
    digest: m.groups.digest || null
  };
};

/** @returns {"" | string} empty when valid, else a reason */
export const imageReferenceProblem = (value, { allowOci = false } = {}) => {
  if (typeof value !== "string" || !value.trim()) return "is empty";
  const v = value.trim();
  if (allowOci && v.startsWith("oci://")) return v.length > "oci://".length ? "" : "names no path after oci://";
  const ref = parseImageReference(v);
  if (!ref) return "is not an image reference of the form registry/repository/name:tag or @sha256:digest";
  if (!ref.tag && !ref.digest) return "has neither a :tag nor an @sha256: digest, which oc-mirror requires";
  return "";
};

const childKey = (schemaPath, key) => (schemaPath ? `${schemaPath}.${key}` : key);

/** Map of schemaPath -> { lowerKey -> canonicalKey } for object children. */
const buildChildIndex = (fields) => {
  const index = new Map();
  for (const p of Object.keys(fields)) {
    const lastDot = p.lastIndexOf(".");
    const parent = lastDot === -1 ? "" : p.slice(0, lastDot);
    const key = lastDot === -1 ? p : p.slice(lastDot + 1);
    if (!index.has(parent)) index.set(parent, new Map());
    index.get(parent).set(key.toLowerCase(), key);
  }
  return index;
};

const finding = (actualPath, code, rule, authority, message, severity = "error") => ({ path: actualPath || "(document)", code, rule, authority, severity, message });

/**
 * Validate a parsed document. Returns the findings and a NORMALIZED copy of
 * the document (case-variant keys renamed to the documented spelling) that
 * mapping code can read without guessing.
 *
 * @param {object} doc
 * @returns {{ valid: boolean, errors: object[], warnings: object[], normalized: object|null }}
 */
export const validateImageSetConfigDocument = (doc) => {
  const schema = loadImageSetConfigSchema();
  const fields = schema.fields;
  const children = buildChildIndex(fields);
  const rejected = schema.rejectedPaths || {};
  const errors = [];
  const warnings = [];

  const checkString = (value, spec, actualPath, schemaPath) => {
    if (spec.enum && !spec.enum.includes(value)) {
      const authority = schemaPath === "kind" ? "binary" : "architect";
      const extra = schemaPath === "mirror.platform.channels[].type"
        ? " oc-mirror would silently treat an unknown type as ocp."
        : schemaPath === "apiVersion" ? " oc-mirror does not check apiVersion, but other values describe a different schema (v1alpha2 is oc-mirror v1)." : "";
      errors.push(finding(actualPath, "INVALID_VALUE", "enum", authority, `${actualPath} is ${describeValue(value)}; it must be ${spec.enum.map((e) => `"${e}"`).join(" or ")}.${extra}`));
    }
    if (spec.format === "semver" && value && !isSemverLike(value)) {
      errors.push(finding(actualPath, "NOT_SEMVER", "semver-version-filters", "binary", `${actualPath} is ${describeValue(value)}; oc-mirror requires a semantic version such as 1.2.3.`));
    }
    if (spec.format === "image-reference") {
      const problem = imageReferenceProblem(value, { allowOci: schemaPath === "mirror.operators[].catalog" });
      // Catalogs are parsed by oc-mirror's Validate (refused at load); additional
      // images only when content is collected (accepted at load, fails at run).
      const authority = schemaPath === "mirror.operators[].catalog" ? "binary" : "binary-at-run";
      if (problem) errors.push(finding(actualPath, "INVALID_IMAGE_REFERENCE", "image-reference", authority, `${actualPath} ${problem}.`));
      else if (!value.trim().startsWith("oci://") && !parseImageReference(value)?.registry) {
        warnings.push(finding(actualPath, "SHORT_IMAGE_NAME", "image-reference", "architect", `${actualPath} names no registry, so it resolves to Docker Hub (docker.io). Write the full registry host if that is not intended.`, "warning"));
      }
    }
    if (spec.format === "http-url-without-credentials" && value && !/^https?:\/\/[^\s]+$/i.test(value)) {
      errors.push(finding(actualPath, "INVALID_URL", "field-type", "architect", `${actualPath} must be an http:// or https:// URL.`));
    }
    if (CREDENTIAL_URL_RE.test(value)) {
      errors.push(finding(actualPath, "CREDENTIALS_IN_URL", "credentials-in-url", "architect", `${actualPath} embeds a user name and password in a URL. Remove them; registry and repository credentials belong in an auth file, never in the configuration.`));
    }
  };

  const walk = (value, schemaPath, actualPath) => {
    // The document root and each list item are mappings described by their children.
    const spec = schemaPath === "" || schemaPath.endsWith("[]") ? { type: "object" } : fields[schemaPath];
    const t = spec.type;
    if (t === "object") {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        errors.push(finding(actualPath, "WRONG_TYPE", "field-type", "binary", `${actualPath || "The document"} must be a mapping, not ${typeOf(value)}.`));
        return null;
      }
      const index = children.get(schemaPath) || new Map();
      const out = {};
      const seen = new Map(); // canonical -> original key
      for (const [key, child] of Object.entries(value)) {
        const here = actualPath ? `${actualPath}.${key}` : key;
        const canonical = index.get(String(key).toLowerCase());
        if (!canonical) {
          const rej = rejected[childKey(schemaPath, key)];
          errors.push(finding(here, "UNKNOWN_FIELD", "unknown-field", "binary",
            `${here} is not an oc-mirror v2 ImageSetConfiguration field; oc-mirror rejects unknown fields.${rej?.correctPath ? ` Use ${rej.correctPath} instead.` : ""}`));
          continue;
        }
        if (seen.has(canonical)) {
          errors.push(finding(here, "DUPLICATE_KEY_CASE", "yaml-case-duplicate-key", "architect",
            `${here} and ${actualPath ? `${actualPath}.` : ""}${seen.get(canonical)} are the same field written two ways. oc-mirror would silently keep only the last one; keep one.`));
          continue;
        }
        seen.set(canonical, key);
        const childSchema = childKey(schemaPath, canonical);
        if (key !== canonical) {
          if (fields[childSchema]?.caseSensitiveKey) {
            errors.push(finding(here, "UNKNOWN_FIELD", "unknown-field", "binary", `${here} must be written exactly as "${canonical}"; oc-mirror matches this key exactly.`));
            continue;
          }
          warnings.push(finding(here, "KEY_CASE", "yaml-key-case", "architect",
            `${here} is read as ${actualPath ? `${actualPath}.` : ""}${canonical} (oc-mirror ignores key case). Prefer the documented spelling.`, "warning"));
        }
        const childActual = actualPath ? `${actualPath}.${canonical}` : canonical;
        if (child === null) {
          // Go's encoding/json leaves a field unset for null, whatever its type,
          // so this is not a decode error; it is simply no value.
          if (!fields[childSchema]?.required) {
            warnings.push(finding(childActual, "NULL_VALUE", "required", "architect", `${childActual} has no value and is ignored.`, "warning"));
          }
          continue;
        }
        const v = walk(child, childSchema, childActual);
        if (v !== undefined) out[canonical] = v;
      }
      for (const [, canonical] of index) {
        const cs = childKey(schemaPath, canonical);
        const req = fields[cs]?.required;
        if (!req) continue;
        const present = Object.prototype.hasOwnProperty.call(out, canonical) && out[canonical] !== null && out[canonical] !== "";
        if (!present) {
          const where = actualPath ? `${actualPath}.${canonical}` : canonical;
          // Written but empty: oc-mirror's presence check passes, so it fails later instead.
          const writtenEmpty = [...seen.keys()].includes(canonical);
          const authority = writtenEmpty ? "architect" : req;
          errors.push(finding(where, "REQUIRED", "required", authority,
            authority === "binary" ? `${where} is required; oc-mirror refuses the document without it.` : `${where} needs a value. oc-mirror would accept the document but then fail or skip this entry later.`));
        }
      }
      return out;
    }
    if (t === "array<object>" || t === "array<string>") {
      if (!Array.isArray(value)) {
        errors.push(finding(actualPath, "WRONG_TYPE", "field-type", "binary", `${actualPath} must be a list, not ${typeOf(value)}.`));
        return null;
      }
      return value.map((item, i) => {
        const itemPath = `${actualPath}[${i}]`;
        if (t === "array<object>") return walk(item, `${schemaPath}[]`, itemPath);
        if (typeof item !== "string") {
          errors.push(finding(itemPath, "WRONG_TYPE", "field-type", "binary", `${itemPath} must be text, not ${typeOf(item)}.`));
          return item;
        }
        if (spec.itemEnum && !spec.itemEnum.includes(item)) {
          errors.push(finding(itemPath, "INVALID_VALUE", "enum", "architect", `${itemPath} is ${describeValue(item)}; it must be one of ${spec.itemEnum.join(", ")}. oc-mirror would find no release images for it.`));
        }
        if (CREDENTIAL_URL_RE.test(item)) {
          errors.push(finding(itemPath, "CREDENTIALS_IN_URL", "credentials-in-url", "architect", `${itemPath} embeds a user name and password in a URL. Remove them.`));
        }
        return item;
      });
    }
    if (t === "string") {
      if (typeof value !== "string") {
        const hint = typeof value === "number" ? " Quote it, for example \"1.0\": YAML reads an unquoted number as a number." : "";
        errors.push(finding(actualPath, "WRONG_TYPE", "field-type", "binary", `${actualPath} must be text, not ${typeOf(value)}.${hint}`));
        return value;
      }
      checkString(value, spec, actualPath, schemaPath);
      return value;
    }
    if (t === "boolean") {
      if (typeof value !== "boolean") errors.push(finding(actualPath, "WRONG_TYPE", "field-type", "binary", `${actualPath} must be true or false, not ${typeOf(value)}.`));
      return value;
    }
    if (t === "integer") {
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        errors.push(finding(actualPath, "WRONG_TYPE", "field-type", "binary", `${actualPath} must be a whole number, not ${typeOf(value)}.`));
      } else if (typeof spec.min === "number" && value < spec.min) {
        errors.push(finding(actualPath, "OUT_OF_RANGE", "field-type", "architect", `${actualPath} must be at least ${spec.min}; ${value} is not a usable size (oc-mirror accepts it but it is meaningless).`));
      }
      return value;
    }
    return value;
  };

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    errors.push(finding("", "NOT_A_MAPPING", "field-type", "binary", "The document must be a mapping."));
    return { valid: false, errors, warnings, normalized: null };
  }
  const normalized = walk(doc, "", "");
  semanticChecks(normalized || {}, errors);
  return { valid: errors.length === 0, errors, warnings, normalized };
};

/** Binary `Validate` rules plus the empty-mirror rule, on the normalized document. */
const semanticChecks = (doc, errors) => {
  const m = doc.mirror;
  if (!m || typeof m !== "object" || Array.isArray(m)) return;
  const hasPlatform = Array.isArray(m.platform?.channels) && m.platform.channels.length > 0;
  const hasHelm = (Array.isArray(m.helm?.local) && m.helm.local.length) || (Array.isArray(m.helm?.repositories) && m.helm.repositories.length);
  const has = hasPlatform || (Array.isArray(m.operators) && m.operators.length) ||
    (Array.isArray(m.additionalImages) && m.additionalImages.length) || hasHelm || (Array.isArray(m.samples) && m.samples.length);
  if (!has) {
    errors.push(finding("mirror", "EMPTY_MIRROR", "empty-mirror", "architect", "mirror lists nothing to mirror. oc-mirror stops with 'no images to copy'. Add platform channels, operators or additional images."));
  }
  if (Array.isArray(m.platform?.channels)) {
    const names = new Set();
    m.platform.channels.forEach((ch, i) => {
      if (!ch || typeof ch.name !== "string" || !ch.name) return;
      if (names.has(ch.name)) errors.push(finding(`mirror.platform.channels[${i}].name`, "DUPLICATE_ENTRY", "no-duplicates", "binary", `Release channel ${describeValue(ch.name)} appears more than once; oc-mirror rejects duplicates.`));
      names.add(ch.name);
    });
  }
  if (Array.isArray(m.operators)) {
    const catalogs = new Set();
    m.operators.forEach((op, i) => {
      if (!op || typeof op !== "object" || typeof op.catalog !== "string") return;
      const unique = `${op.catalog}|${op.targetCatalog || ""}|${op.targetTag || ""}`;
      if (catalogs.has(unique)) errors.push(finding(`mirror.operators[${i}].catalog`, "DUPLICATE_ENTRY", "no-duplicates", "binary", `Catalog ${describeValue(op.catalog)} is listed more than once with the same target; oc-mirror rejects duplicates. Merge their packages into one entry.`));
      catalogs.add(unique);
      if (!Array.isArray(op.packages)) return;
      const pkgs = new Set();
      op.packages.forEach((pkg, j) => {
        if (!pkg || typeof pkg !== "object") return;
        const base = `mirror.operators[${i}].packages[${j}]`;
        if (typeof pkg.name === "string" && pkg.name) {
          if (pkgs.has(pkg.name)) errors.push(finding(`${base}.name`, "DUPLICATE_ENTRY", "no-duplicates", "binary", `Package ${describeValue(pkg.name)} appears more than once in this catalog; oc-mirror rejects duplicates.`));
          pkgs.add(pkg.name);
        }
        const pkgFilter = Boolean(pkg.minVersion || pkg.maxVersion);
        if (!Array.isArray(pkg.channels)) return;
        const chans = new Set();
        pkg.channels.forEach((ch, k) => {
          if (!ch || typeof ch !== "object") return;
          if (typeof ch.name === "string" && ch.name) {
            if (chans.has(ch.name)) errors.push(finding(`${base}.channels[${k}].name`, "DUPLICATE_ENTRY", "no-duplicates", "binary", `Channel ${describeValue(ch.name)} appears more than once for this package; oc-mirror rejects duplicates.`));
            chans.add(ch.name);
          }
          if (pkgFilter && (ch.minVersion || ch.maxVersion)) {
            errors.push(finding(`${base}.channels[${k}]`, "MIXED_VERSION_FILTERS", "no-mixed-version-filters", "binary", `Package ${describeValue(pkg.name)} filters versions both on the package and on a channel; oc-mirror allows only one of the two.`));
          }
        });
      });
    });
  }
};

/**
 * Parse and validate in one call. `stage` tells the caller which kind of
 * problem it is: "parse" (not a usable YAML document), "structure" (a YAML
 * document that is not a valid ImageSetConfiguration) or "valid".
 */
export const validateImageSetConfigText = (input) => {
  const parsed = parseImageSetConfigText(input);
  if (!parsed.ok) return { ok: false, stage: "parse", errors: parsed.errors, warnings: [], document: null, normalized: null, meta: parsed.meta };
  const result = validateImageSetConfigDocument(parsed.document);
  return {
    ok: result.valid,
    stage: result.valid ? "valid" : "structure",
    errors: result.errors,
    warnings: result.warnings,
    document: parsed.document,
    normalized: result.normalized,
    meta: parsed.meta
  };
};

/** A generated configuration failed structural validation: a generator defect, never shown as valid. */
export class ImageSetConfigInvalidError extends Error {
  constructor(errors, message = "The generated ImageSetConfiguration is not structurally valid for oc-mirror v2.") {
    super(message);
    this.name = "ImageSetConfigInvalidError";
    this.code = "IMAGESET_CONFIG_INVALID";
    this.status = 422;
    this.errors = errors;
  }
}

/**
 * Throw ImageSetConfigInvalidError unless `yamlText` is structurally valid.
 * Used on every GENERATED configuration (Install and Mirroring) before it is
 * previewed, exported or executed.
 */
export const assertImageSetConfigStructure = (yamlText) => {
  const result = validateImageSetConfigText(yamlText);
  if (!result.ok) throw new ImageSetConfigInvalidError(result.errors);
  return result;
};

/** "path: message" lines for preflight-style string lists. */
export const formatImageSetFindings = (findings) =>
  findings.map((f) => (f.line ? `Line ${f.line}: ${f.message}` : f.message));
