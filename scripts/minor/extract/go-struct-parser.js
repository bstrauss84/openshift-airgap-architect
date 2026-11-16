"use strict";

/**
 * Go struct reader for the installer source tree.
 *
 * Pure, filesystem-free core so it can be fixture-tested hermetically: callers
 * hand it `{ relPath, text }` records and get back a struct registry plus the
 * named-type and constant information needed to resolve enums and aliases.
 *
 * Why a reader rather than a grep. The 4.21-era extractor matched field lines
 * with a single regex and had no notion of which struct a field belonged to,
 * which is how `parse-go-structs.js` came to emit `struct`/`field` while its
 * consumer read `file`/`jsonTag` (harvest finding F1). Tracking brace depth and
 * package identity costs little and makes the provenance derivable rather than
 * asserted.
 *
 * Scope limits, stated rather than hidden:
 *   - Struct shape only. Defaulting logic (`pkg/asset/installconfig`) and
 *     conditional requiredness (the per-platform `validation` packages) are
 *     invisible here by construction; the runbook Phase 2 notes say to read
 *     those by hand.
 *   - `required` is derived from the absence of `omitempty`, which is a
 *     serialization fact, not a validation fact. Reported as `omitempty` too so
 *     a consumer can tell which question it is answering.
 */

const PACKAGE_RE = /^package\s+([A-Za-z_]\w*)/m;
const TYPE_STRUCT_RE = /^type\s+([A-Z]\w*)\s+struct\s*\{/;
const TYPE_ALIAS_RE = /^type\s+([A-Z]\w*)\s+([\w.\[\]*]+)\s*$/;
const IMPORT_ALIAS_RE = /^\s*(?:([A-Za-z_]\w*)\s+)?"([^"]+)"\s*$/;

/** `Name Type `json:"tag,opts"`” — the common case. */
const FIELD_RE =
  /^([A-Z]\w*)\s+([^\s`]+(?:\s*\{\})?)\s+`([^`]*)`/;
/** Embedded field with a tag: `` TypeName `json:",inline"` ``. */
const EMBEDDED_TAGGED_RE = /^(\*?)([A-Za-z_][\w.]*)\s+`([^`]*)`/;
/** Embedded field with no tag. */
const EMBEDDED_BARE_RE = /^(\*?)([A-Za-z_][\w.]*)\s*$/;

const JSON_TAG_RE = /json:"([^"]*)"/;

function stripLineComment(line) {
  // Good enough for struct bodies: Go string literals inside a field line are
  // confined to the back-quoted tag, which cannot contain `//`.
  const tagStart = line.indexOf("`");
  const tagEnd = tagStart === -1 ? -1 : line.indexOf("`", tagStart + 1);
  const searchFrom = tagEnd === -1 ? 0 : tagEnd;
  const idx = line.indexOf("//", searchFrom);
  return idx === -1 ? line : line.slice(0, idx);
}

/** Collapse a run of `// ...` doc lines into one description string. */
function joinDocComment(lines) {
  return lines
    .map((l) => l.replace(/^\s*\/\/\s?/, "").trimEnd())
    .filter((l) => !l.startsWith("+")) // kubebuilder markers are metadata, not prose
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function markersFrom(lines) {
  const markers = [];
  for (const l of lines) {
    // Marker values carry `;` (kubebuilder enum separator), `/`, `|` and more,
    // so the class is "anything after a leading +" rather than an allowlist
    // that silently drops the markers it did not anticipate.
    const m = l.match(/^\s*\/\/\s*(\+\S.*)$/);
    if (m) markers.push(m[1].trim());
  }
  return markers;
}

function deprecationFrom(lines) {
  for (const l of lines) {
    const m = l.match(/^\s*\/\/\s*Deprecated:\s*(.*)$/);
    if (m) return m[1].trim() || "(no replacement stated)";
  }
  return null;
}

/**
 * Parse one Go file.
 * @param {string} relPath repository-relative path, used verbatim as provenance
 * @param {string} text file contents
 */
function parseGoFile(relPath, text) {
  const pkgMatch = text.match(PACKAGE_RE);
  const pkg = pkgMatch ? pkgMatch[1] : null;
  const lines = text.split("\n");

  const imports = {}; // local alias -> last path segment
  const structs = {}; // Name -> { name, pkg, file, line, fields: [] }
  const aliases = {}; // Name -> underlying type text
  const consts = {}; // type name -> [ { name, value } ]

  let inImportBlock = false;
  let current = null; // active struct
  let depth = 0;
  let doc = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    const trimmed = raw.trim();

    if (!current) {
      if (trimmed === "import (") {
        inImportBlock = true;
        continue;
      }
      if (inImportBlock) {
        if (trimmed === ")") {
          inImportBlock = false;
          continue;
        }
        const im = trimmed.match(IMPORT_ALIAS_RE);
        if (im) {
          const full = im[2];
          const last = full.split("/").pop();
          imports[im[1] || last] = last;
        }
        continue;
      }

      if (trimmed.startsWith("//")) {
        doc.push(raw);
        continue;
      }

      const structMatch = trimmed.match(TYPE_STRUCT_RE);
      if (structMatch) {
        current = {
          name: structMatch[1],
          pkg,
          file: relPath,
          line: lineNo,
          doc: joinDocComment(doc),
          fields: [],
        };
        depth = 1;
        doc = [];
        continue;
      }

      const aliasMatch = trimmed.match(TYPE_ALIAS_RE);
      if (aliasMatch && aliasMatch[2] !== "struct") {
        // The defining file travels with the alias so the walker can resolve
        // `pkg.Type` references in the underlying type against that file's own
        // imports rather than against an empty map. The type's own markers
        // travel with it too, because that is where the authoritative
        // kubebuilder enum lives.
        aliases[aliasMatch[1]] = {
          underlying: aliasMatch[2],
          file: relPath,
          markers: markersFrom(doc),
          enum: kubebuilderEnum(markersFrom(doc)),
        };
        doc = [];
        continue;
      }

      if (trimmed !== "") doc = [];
      continue;
    }

    // Inside a struct body.
    const code = stripLineComment(raw);
    const codeTrimmed = code.trim();

    if (trimmed.startsWith("//")) {
      doc.push(raw);
      continue;
    }
    if (codeTrimmed === "") {
      doc = [];
      continue;
    }

    const opens = (code.match(/\{/g) || []).length;
    const closes = (code.match(/\}/g) || []).length;

    if (depth === 1 && codeTrimmed === "}") {
      structs[current.name] = current;
      current = null;
      depth = 0;
      doc = [];
      continue;
    }

    if (depth === 1) {
      const fm = codeTrimmed.match(FIELD_RE);
      if (fm) {
        current.fields.push(
          makeField({
            name: fm[1],
            goType: fm[2],
            tagText: fm[3],
            file: relPath,
            line: lineNo,
            doc,
          })
        );
        doc = [];
        depth += opens - closes;
        continue;
      }
      const em = codeTrimmed.match(EMBEDDED_TAGGED_RE) || codeTrimmed.match(EMBEDDED_BARE_RE);
      if (em) {
        const typeText = em[2];
        current.fields.push(
          makeField({
            name: typeText.split(".").pop(),
            goType: (em[1] || "") + typeText,
            tagText: em[3] || "",
            file: relPath,
            line: lineNo,
            doc,
            embedded: true,
          })
        );
        doc = [];
        depth += opens - closes;
        continue;
      }
      // Untagged non-embedded field (e.g. `File *asset.File`) — recorded so a
      // consumer can see it exists, but it has no JSON identity.
      const plain = codeTrimmed.match(/^([A-Z]\w*)\s+(\S.*)$/);
      if (plain) {
        current.fields.push(
          makeField({
            name: plain[1],
            goType: plain[2].trim(),
            tagText: "",
            file: relPath,
            line: lineNo,
            doc,
          })
        );
      }
      doc = [];
    }

    depth += opens - closes;
    if (depth <= 0) {
      structs[current.name] = current;
      current = null;
      depth = 0;
      doc = [];
    }
  }

  collectConsts(text, consts);

  return { pkg, file: relPath, imports, structs, aliases, consts };
}

function makeField({ name, goType, tagText, file, line, doc, embedded = false }) {
  const tagMatch = tagText ? tagText.match(JSON_TAG_RE) : null;
  const jsonTag = tagMatch ? tagMatch[1] : null;
  const parts = jsonTag === null ? [] : jsonTag.split(",");
  const jsonName = parts[0] || "";
  const opts = parts.slice(1);
  const docLines = doc || [];
  return {
    name,
    goType: goType.trim(),
    jsonTag,
    jsonName,
    omitempty: opts.includes("omitempty"),
    inline: opts.includes("inline"),
    skipped: jsonName === "-",
    embedded,
    file,
    line,
    description: joinDocComment(docLines),
    markers: markersFrom(docLines),
    deprecated: deprecationFrom(docLines),
  };
}

/**
 * Harvest explicitly typed constants so a named type can be reported with the
 * values the source actually declares for it.
 *
 * ONLY the explicitly typed form is collected:
 *
 *   const Foo SomeType = "foo"
 *   const ( Foo SomeType = "foo"
 *           Bar SomeType = "bar" )
 *
 * An untyped `Name = "value"` line inside the same block is NOT attributed to
 * the preceding line's type. Go only carries a type forward by *implicit
 * repetition* — a line naming a constant with no `=` expression at all — and
 * attributing the explicit-value form instead produces false enum values.
 *
 * Observed for real, which is why this is spelled out: in
 * `pkg/types/gcp/platform.go`, `CloudEnvironmentSovereign = "sovereign"` sits
 * in the same block as the two `FirewallRulesManagementPolicy` constants. The
 * carry-forward version of this function reported a 4.21 -> 4.22 enum change
 * adding `"sovereign"` to `firewallRulesManagement`, which is not true at
 * either minor — the type carries
 * `+kubebuilder:validation:Enum:="Managed";"Unmanaged"` in both.
 */
function collectConsts(text, out) {
  const lines = text.split("\n");
  let inBlock = false;
  for (const raw of lines) {
    const line = stripLineComment(raw).trim();
    if (!inBlock) {
      if (/^const\s*\($/.test(line)) {
        inBlock = true;
        continue;
      }
      const single = line.match(/^const\s+(\w+)\s+([A-Z]\w*)\s*=\s*(.+)$/);
      if (single) push(out, single[2], single[1], single[3]);
      continue;
    }
    if (line === ")") {
      inBlock = false;
      continue;
    }
    const typed = line.match(/^(\w+)\s+([A-Z]\w*)\s*=\s*(.+)$/);
    if (typed) push(out, typed[2], typed[1], typed[3]);
  }
}

/**
 * `+kubebuilder:validation:Enum:="A";"B"` — the generated-API enum declaration.
 *
 * This outranks harvested constants: it is the set the API server validates
 * against, whereas a constant of the right type may exist without being an
 * accepted value.
 */
function kubebuilderEnum(markers) {
  for (const m of markers) {
    const hit = m.match(/^\+kubebuilder:validation:Enum:?=(.+)$/);
    if (!hit) continue;
    const values = hit[1]
      .split(";")
      .map((v) => v.trim().replace(/^"(.*)"$/, "$1"))
      .filter(Boolean);
    if (values.length) return values;
  }
  return null;
}

function push(out, typeName, constName, valueText) {
  const v = valueText.trim().replace(/^"(.*)"$/, "$1");
  if (!out[typeName]) out[typeName] = [];
  out[typeName].push({ name: constName, value: v });
}

module.exports = { parseGoFile, joinDocComment, collectConsts, kubebuilderEnum };
