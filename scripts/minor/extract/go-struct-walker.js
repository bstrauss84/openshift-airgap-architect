"use strict";

/**
 * Walk a parsed Go struct registry into a flat, YAML-shaped parameter list.
 *
 * The output record set is the producer half of
 * `scripts/minor/compare/diff-params.js` `INPUT_CONTRACT`: every name that
 * comparator reads is emitted here, which is what closes harvest finding F1 at
 * the producer end (gap list GAP-12).
 *
 * Deliberate behaviours:
 *   - Paths are YAML paths, not Go paths. An array of structs contributes a
 *     `name[]` segment, matching how `data/params/<minor>/**` already spells
 *     `hosts[].networkConfig.interfaces[]`.
 *   - `inline` fields contribute no segment, matching encoding/json.
 *   - Named non-struct types resolve to the primitive they serialize as.
 *     Catalogs describe YAML, not Go — a `ProvisioningNetwork` is a `string`.
 *   - Recursion is cycle-guarded per chain, not globally, so the same struct
 *     reached by two different paths is emitted for both.
 */

const { kubebuilderEnum: kubebuilderEnumOf } = require("./go-struct-parser");

const PRIMITIVES = {
  string: "string",
  bool: "boolean",
  byte: "integer",
  rune: "integer",
  int: "integer",
  int8: "integer",
  int16: "integer",
  int32: "integer",
  int64: "integer",
  uint: "integer",
  uint8: "integer",
  uint16: "integer",
  uint32: "integer",
  uint64: "integer",
  float32: "number",
  float64: "number",
};

/**
 * Types that are structs in Go but serialize as a scalar, so descending into
 * them would invent paths that cannot appear in YAML. Each is listed with the
 * form it actually takes on the wire.
 */
const SCALAR_STRUCTS = {
  "ipnet.IPNet": "string", // CIDR notation
  "net.IP": "string",
  "net.IPNet": "string",
  "metav1.Time": "string",
  "metav1.Duration": "string",
  "time.Duration": "string",
  "resource.Quantity": "string",
  "intstr.IntOrString": "string",
};

/** Strip pointer/array/map decoration, reporting what was stripped. */
function decompose(goType) {
  let t = goType.trim();
  let isArray = false;
  let isMap = false;
  for (;;) {
    if (t.startsWith("*")) {
      t = t.slice(1).trim();
      continue;
    }
    if (t.startsWith("[]")) {
      isArray = true;
      t = t.slice(2).trim();
      continue;
    }
    const m = t.match(/^map\[[^\]]+\](.*)$/);
    if (m) {
      isMap = true;
      t = m[1].trim();
      continue;
    }
    break;
  }
  return { base: t, isArray, isMap };
}

/**
 * Resolve a Go type reference to one of:
 *   { kind: "primitive", type }
 *   { kind: "struct", struct, pkg }
 *   { kind: "opaque", type }   external or unresolvable
 */
function resolveType(index, pkgName, fileImports, base, seenAliases = new Set()) {
  if (PRIMITIVES[base]) return { kind: "primitive", type: PRIMITIVES[base] };
  if (base === "interface{}" || base === "any") return { kind: "opaque", type: "object" };
  if (SCALAR_STRUCTS[base]) return { kind: "primitive", type: SCALAR_STRUCTS[base] };

  let targetPkg = pkgName;
  let name = base;
  const dot = base.indexOf(".");
  if (dot !== -1) {
    const alias = base.slice(0, dot);
    name = base.slice(dot + 1);
    targetPkg = fileImports[alias] || alias;
  }

  const pkg = index[targetPkg];
  if (!pkg) return { kind: "opaque", type: "object" };

  if (pkg.structs[name]) return { kind: "struct", struct: pkg.structs[name], pkg: targetPkg };

  const alias = pkg.aliases[name];
  if (alias !== undefined) {
    const key = `${targetPkg}.${name}`;
    if (seenAliases.has(key)) return { kind: "opaque", type: "object" };
    seenAliases.add(key);
    const inner = decompose(alias.underlying);
    const aliasImports = pkg.importsByFile[alias.file] || {};
    const resolved = resolveType(index, targetPkg, aliasImports, inner.base, seenAliases);
    if (inner.isArray) return { kind: "primitive", type: "array", element: resolved };
    if (inner.isMap) return { kind: "primitive", type: "object", element: resolved };
    return { ...resolved, aliasOf: `${targetPkg}.${name}` };
  }

  return { kind: "opaque", type: "object" };
}

/**
 * Allowed values for a named type.
 *
 * Two sources, in priority order:
 *   1. `+kubebuilder:validation:Enum` on the type declaration — the set the
 *      generated API actually validates against.
 *   2. Explicitly typed constants of that type — weaker, because a constant of
 *      the right type is not by itself proof the value is accepted.
 *
 * The source is reported alongside the values so a classification row can say
 * which kind of evidence it rests on rather than implying they are equivalent.
 */
function enumFor(index, pkgName, fileImports, base) {
  let targetPkg = pkgName;
  let name = base;
  const dot = base.indexOf(".");
  if (dot !== -1) {
    targetPkg = fileImports[base.slice(0, dot)] || base.slice(0, dot);
    name = base.slice(dot + 1);
  }
  const pkg = index[targetPkg];
  if (!pkg) return null;

  const alias = pkg.aliases[name];
  if (alias && alias.enum) {
    return { values: alias.enum, source: "kubebuilder-enum-marker" };
  }
  if (!pkg.consts[name]) return null;
  const values = Array.from(
    new Set(pkg.consts[name].map((c) => c.value).filter((v) => !/[(){}]/.test(v)))
  );
  return values.length ? { values, source: "typed-constants" } : null;
}

/**
 * @param {object} index  packageName -> { structs, aliases, consts, importsFor }
 * @param {object} root   { pkg, struct } entry point, e.g. types.InstallConfig
 * @param {object} opts   { maxDepth }
 */
function walk(index, root, opts = {}) {
  const maxDepth = opts.maxDepth || 14;
  const out = [];
  const truncated = [];

  function descend(struct, pkgName, prefix, chain, depth) {
    if (depth > maxDepth) {
      truncated.push({ path: prefix, reason: `max depth ${maxDepth} reached` });
      return;
    }
    const fileImports = index[pkgName] ? index[pkgName].importsByFile[struct.file] || {} : {};

    for (const field of struct.fields) {
      if (field.skipped) continue;
      if (field.jsonTag === null && !field.inline) continue; // no JSON identity

      const { base, isArray, isMap } = decompose(field.goType);
      const resolved = resolveType(index, pkgName, fileImports, base);

      let path;
      if (field.inline && !field.jsonName) {
        path = prefix; // inline contributes no segment
      } else if (!field.jsonName) {
        continue;
      } else {
        const seg = isArray ? `${field.jsonName}[]` : field.jsonName;
        path = prefix ? `${prefix}.${seg}` : seg;
      }

      let yamlType;
      if (isArray) yamlType = "array";
      else if (isMap) yamlType = "object";
      else if (resolved.kind === "struct") yamlType = "object";
      else yamlType = resolved.type || "object";

      const fieldEnum = kubebuilderEnumOf(field.markers);
      const typeEnum = enumFor(index, pkgName, fileImports, base);
      const allowed = fieldEnum
        ? { values: fieldEnum, source: "kubebuilder-enum-marker" }
        : typeEnum;

      if (!(field.inline && !field.jsonName)) {
        out.push({
          path,
          type: yamlType,
          required: !field.omitempty,
          description: field.description,
          goType: field.goType,
          struct: `${pkgName}.${struct.name}`,
          field: field.name,
          file: field.file,
          line: field.line,
          jsonTag: field.jsonTag,
          omitempty: field.omitempty,
          optionalMarker: field.markers.includes("+optional"),
          deprecated: field.deprecated !== null,
          deprecationNote: field.deprecated,
          markers: field.markers,
          enum: allowed ? allowed.values : null,
          enumSource: allowed ? allowed.source : null,
          elementKind: isArray || isMap ? (resolved.kind === "struct" ? "object" : resolved.type) : null,
        });
      }

      if (resolved.kind === "struct") {
        const id = `${resolved.pkg}.${resolved.struct.name}`;
        if (chain.has(id)) {
          truncated.push({ path, reason: `recursive type ${id}` });
          continue;
        }
        const next = new Set(chain);
        next.add(id);
        descend(resolved.struct, resolved.pkg, path, next, depth + 1);
      }
    }
  }

  descend(root.struct, root.pkg, "", new Set([`${root.pkg}.${root.struct.name}`]), 0);

  const seen = new Map();
  for (const rec of out) {
    // A path reachable twice (e.g. via controlPlane and compute) keeps the
    // first occurrence; both carry the same struct and line.
    if (!seen.has(rec.path)) seen.set(rec.path, rec);
  }
  return {
    parameters: Array.from(seen.values()).sort((a, b) => a.path.localeCompare(b.path)),
    truncated,
    emittedBeforeDedup: out.length,
  };
}

module.exports = { walk, decompose, resolveType, PRIMITIVES, SCALAR_STRUCTS };
