#!/usr/bin/env node
"use strict";

/**
 * Bounded catalog repair engine for Tranche 0B.
 *
 * Applies ONLY the evidence-backed transformations enumerated in
 * ./proven-repairs.js, to ONE minor's canonical catalogs, using ONLY that
 * minor's own evidence. There is no pattern-rewriting fallback and no
 * heuristic: a row that matches no approved rule is reported as `unmatched`
 * and left byte-for-byte unchanged.
 *
 * FAIL CLOSED
 *   - `--minor` is required and must name an existing canonical directory.
 *   - `--check` writes nothing and exits non-zero if any change is pending.
 *   - Unmatched rows always exit non-zero, in every mode. Silence is never
 *     success: the engine reports what it could not prove.
 *   - A citation whose heading is on the H3 list is frozen outright. A
 *     repair that would empty a parameter's citations array is refused.
 *
 * SCOPE
 *   reads and writes data/params/<minor>/** only. Never a frontend mirror,
 *   never another minor, never a docs index. Mirrors are regenerated
 *   afterwards by the tracked sync scripts, not by this tool.
 *
 * No network access.
 *
 * Usage:
 *   node scripts/minor/repair/apply-catalog-repairs.js --minor 4.21 --check
 *   node scripts/minor/repair/apply-catalog-repairs.js --minor 4.21 --apply
 *   node scripts/minor/repair/apply-catalog-repairs.js --minor 4.21 --apply --report out.json
 */

const fs = require("fs");
const path = require("path");

const { parseArgs, parseMinor, MinorArgumentError } = require("../lib/minor.js");
const R = require("./proven-repairs.js");

const DOC_URL_MINOR_RE = /openshift_container_platform\/(\d+\.\d+)\//;
const LEGACY_HOST_RE = /^https:\/\/docs\.openshift\.com\/container-platform\/(\d+\.\d+)\/(.+)$/;

/** Rebuild an installer-source citation; a null symbol cites the file alone. */
function buildInstallerCitation(minor, goFile, symbol) {
  const c = R.installerCitation(minor, goFile, symbol ?? "");
  if (!symbol) c.sectionHeading = goFile;
  return c;
}

/**
 * Split an `installer-source-code` sectionHeading into file and symbol.
 *
 * Two valid forms: `<file.go> - <Struct>.<Field>`, and a bare `<file.go>` for
 * asset-generation code that backs a parameter without declaring a field of
 * it. The bare form must parse, not least because this engine emits it.
 */
function splitInstallerHeading(heading) {
  const text = String(heading || "").trim();
  const withSymbol = text.match(/^(\S+\.go)\s*-\s*(\S+)$/);
  if (withSymbol) return { goFile: withSymbol[1], symbol: withSymbol[2] };
  const fileOnly = text.match(/^(\S+\.go)$/);
  if (fileOnly) return { goFile: fileOnly[1], symbol: null };
  return null;
}

/** The documentation citation an `ocp_docs` stub should become, if proven. */
function stubDocCitation(minor, scenarioId, paramPath) {
  const family = R.SCENARIO_REFERENCE_PAGE[scenarioId];
  if (!family) return null;
  const section = (R.STUB_SECTIONS[family] || {})[paramPath];
  if (!section) return null;
  const page = R.PARAM_REFERENCE_PAGES[family];
  return {
    docId: page.docId,
    docTitle: page.docTitle,
    sectionHeading: section,
    url: page.url(minor),
  };
}


/** Context shape the resolution matcher needs. */
function pctxOf(ctx) {
  return { scenarioId: ctx.scenarioId, paramPath: ctx.paramPath, minor: ctx.minor };
}

/** First resolution rule whose `when` matches this citation, or null. */
function findResolution(citation, { scenarioId, paramPath }) {
  if (!citation || typeof citation !== "object") return null;
  for (const rule of R.CITATION_RESOLUTIONS) {
    const w = rule.when;
    if (w.docId && citation.docId !== w.docId) continue;
    if (w.sectionHeading && citation.sectionHeading !== w.sectionHeading) continue;
    if (w.sectionHeadingOneOf && !w.sectionHeadingOneOf.includes(citation.sectionHeading)) continue;
    if (w.paramPathPrefix && !String(paramPath || "").startsWith(w.paramPathPrefix)) continue;
    if (w.scenarioId && scenarioId !== w.scenarioId) continue;
    return rule;
  }
  return null;
}

/** Build the replacement citation a resolution rule specifies. */
function buildResolvedCitation(rule, ctx) {
  const { minor, scenarioId, paramPath } = ctx;
  let to = rule.to;

  if (to.byScenario) {
    to = to.byScenario[scenarioId] || to.byScenario["*"];
    if (!to) return null;
  }

  if (to.installerByPath) {
    const mapped = to.installerByPath[paramPath];
    if (!mapped) return null;
    return buildInstallerCitation(minor, mapped[0], mapped[1]);
  }

  const page = to.family ? R.PARAM_REFERENCE_PAGES[to.family] : R.EXTRA_PAGES[to.page];
  if (!page) return null;
  return {
    docId: page.docId,
    docTitle: page.docTitle,
    sectionHeading: to.sectionHeading,
    url: page.url(minor),
  };
}

// ---------------------------------------------------------------------------
// Citation-level repair
// ---------------------------------------------------------------------------

/**
 * @returns {{citation: object|null, change: object|null, unmatched: object|null, frozen: boolean}}
 *   citation === null means "remove this citation".
 */
function repairCitation(citation, ctx) {
  const { minor, scenarioId, paramPath } = ctx;
  const at = { minor, scenarioId, paramPath };

  // --- deterministic same-minor authority resolution ------------------------
  // Runs BEFORE the H3 freeze: a row only stays frozen if no rule places it.
  const resolution = findResolution(citation, pctxOf(ctx));
  if (resolution) {
    const moved = buildResolvedCitation(resolution, ctx);
    if (!moved) {
      return {
        citation,
        change: null,
        frozen: false,
        unmatched: { ...at, rule: `resolution:${resolution.id}`, detail: `rule matched but produced no target for ${paramPath}` },
      };
    }
    if (JSON.stringify(moved) === JSON.stringify(citation)) {
      return { citation, change: null, unmatched: null, frozen: false };
    }
    return {
      citation: moved,
      change: {
        ...at,
        rule: `h3-resolved:${resolution.id}`,
        from: `${citation.docId} :: ${citation.sectionHeading}`,
        to: `${moved.docId} :: ${moved.sectionHeading}`,
        kind: "provenance",
        tier: resolution.tier,
      },
      unmatched: null,
      frozen: false,
    };
  }

  // --- H3: frozen, in every mode -------------------------------------------
  if (R.isH3Citation(citation)) {
    return { citation, change: null, unmatched: null, frozen: true };
  }

  // --- legacy {source, url, note} shape ------------------------------------
  if (citation && typeof citation.source === "string") {
    const handling = R.LEGACY_SOURCE_HANDLING[citation.source];

    if (handling === "installer") {
      const mapped = (R.LEGACY_INSTALLER_URL_MAP[minor] || {})[citation.url];
      if (!mapped) {
        return {
          citation,
          change: null,
          frozen: false,
          unmatched: { ...at, rule: "legacy-installer", detail: `no approved mapping for URL: ${citation.url}` },
        };
      }
      return {
        citation: buildInstallerCitation(minor, mapped[0], mapped[1]),
        change: { ...at, rule: "legacy-installer-normalized", from: citation.url, to: `${mapped[0]} - ${mapped[1] ?? "(file)"}`, kind: "provenance" },
        unmatched: null,
        frozen: false,
      };
    }

    if (handling === "drop") {
      return {
        citation: null,
        change: { ...at, rule: "internal-analysis-removed", from: citation.url, to: "(removed)", kind: "provenance" },
        unmatched: null,
        frozen: false,
      };
    }

    if (handling === "docs") {
      const doc = stubDocCitation(minor, scenarioId, paramPath);
      if (doc) {
        return {
          citation: doc,
          change: { ...at, rule: "ocp-docs-stub-resolved", from: "(URL-less ocp_docs stub)", to: `${doc.sectionHeading} @ ${doc.url}`, kind: "provenance" },
          unmatched: null,
          frozen: false,
        };
      }
      return {
        citation: null,
        change: { ...at, rule: "ocp-docs-stub-removed", from: "(URL-less ocp_docs stub)", to: "(removed; installer-source provenance retained)", kind: "provenance" },
        unmatched: null,
        frozen: false,
      };
    }

    return {
      citation,
      change: null,
      frozen: false,
      unmatched: { ...at, rule: "legacy-citation", detail: `unknown legacy source "${citation.source}"` },
    };
  }

  // --- internal pseudo-citation --------------------------------------------
  if (citation && citation.docId === "missing-parameter-analysis") {
    const mapped = (R.PSEUDO_CITATION_REPLACEMENTS[minor] || {})[paramPath];
    if (!mapped) {
      return {
        citation,
        change: null,
        frozen: false,
        unmatched: { ...at, rule: "pseudo-citation", detail: `no approved replacement for ${paramPath}` },
      };
    }
    return {
      citation: buildInstallerCitation(minor, mapped[0], mapped[1]),
      change: { ...at, rule: "pseudo-citation-replaced", from: citation.docTitle, to: `${mapped[0]} - ${mapped[1]}`, kind: "provenance" },
      unmatched: null,
      frozen: false,
    };
  }

  // --- installer-source-code citation --------------------------------------
  if (citation && citation.docId === "installer-source-code") {
    const parts = splitInstallerHeading(citation.sectionHeading);
    if (!parts) {
      return {
        citation,
        change: null,
        frozen: false,
        unmatched: { ...at, rule: "installer-citation", detail: `unparseable sectionHeading: ${citation.sectionHeading}` },
      };
    }
    const corrected = (parts.symbol && R.INSTALLER_FILE_CORRECTIONS[`${parts.goFile}|${parts.symbol}`]) || parts.goFile;
    const next = buildInstallerCitation(minor, corrected, parts.symbol);
    if (next.url === citation.url && next.docTitle === citation.docTitle && next.sectionHeading === citation.sectionHeading) {
      return { citation, change: null, unmatched: null, frozen: false };
    }
    const reasons = [];
    if (corrected !== parts.goFile) reasons.push(`file ${parts.goFile} -> ${corrected}`);
    if (citation.docTitle !== next.docTitle) reasons.push(`title -> ${minor}`);
    if (!String(citation.url).includes(R.INSTALLER_PINS[minor].branch)) reasons.push(`branch -> ${R.INSTALLER_PINS[minor].branch}`);
    return {
      citation: next,
      change: { ...at, rule: "installer-citation-aligned", from: `${parts.goFile} @ ${citation.docTitle}`, to: reasons.join("; "), kind: "provenance" },
      unmatched: null,
      frozen: false,
    };
  }

  // --- documentation citation ----------------------------------------------
  if (!citation || typeof citation.url !== "string") {
    return { citation, change: null, unmatched: null, frozen: false };
  }

  let next = { ...citation };
  const reasons = [];

  // Page relocation: the cited page returns 404 at BOTH minors. Rebuild the
  // citation against the proven same-minor page.
  const relPathMatch = citation.url.match(/openshift_container_platform\/\d+\.\d+\/(.+)$/);
  const pageReloc = relPathMatch ? R.PAGE_RELOCATIONS[relPathMatch[1].split("#")[0]] : null;
  if (pageReloc) {
    const page = pageReloc.family ? R.PARAM_REFERENCE_PAGES[pageReloc.family] : pageReloc;
    const headingFixForReloc = (R.HEADING_CORRECTIONS[minor] || {})[citation.sectionHeading];
    const moved = {
      docId: page.docId,
      docTitle: page.docTitle,
      sectionHeading: headingFixForReloc ? headingFixForReloc.to : citation.sectionHeading,
      url: page.url(minor),
    };
    return {
      citation: moved,
      change: { ...at, rule: "broken-page-relocated", from: citation.url, to: `${moved.url} :: ${moved.sectionHeading}`, kind: "provenance" },
      unmatched: null,
      frozen: false,
    };
  }

  // Relocation: the cited book does not exist; move the whole citation to the
  // parameter-reference page for this minor, at the section located there.
  const reloc = R.CITATION_RELOCATIONS[citation.sectionHeading];
  if (reloc) {
    const section = reloc.sections[paramPath];
    if (!section) {
      return {
        citation,
        change: null,
        frozen: false,
        unmatched: { ...at, rule: "citation-relocation", detail: `no located section for ${paramPath} under "${citation.sectionHeading}"` },
      };
    }
    const page = R.PARAM_REFERENCE_PAGES[reloc.family];
    const moved = { docId: page.docId, docTitle: page.docTitle, sectionHeading: section, url: page.url(minor) };
    return {
      citation: moved,
      change: { ...at, rule: "citation-relocated", from: `${citation.docId} :: ${citation.sectionHeading}`, to: `${moved.docId} :: ${section}`, kind: "provenance" },
      unmatched: null,
      frozen: false,
    };
  }

  // A minor embedded in the citation's own identifier or title.
  for (const spec of R.MINOR_LABELLED_FIELDS) {
    const value = next[spec.field];
    if (typeof value !== "string") continue;
    const m = value.match(spec.pattern);
    if (!m || m[1] === minor) continue;
    next[spec.field] = value.replace(m[1], minor);
    reasons.push(`${spec.field} label ${m[1]} -> ${minor}`);
  }

  const headingFix = (R.HEADING_CORRECTIONS[minor] || {})[citation.sectionHeading];
  if (headingFix) {
    next.sectionHeading = headingFix.to;
    reasons.push(`heading -> ${headingFix.to}`);
  }

  const legacyHost = citation.url.match(LEGACY_HOST_RE);
  if (legacyHost) {
    const builder = R.LEGACY_HOST_URL_MAP[legacyHost[2]];
    if (!builder) {
      return {
        citation,
        change: null,
        frozen: false,
        unmatched: { ...at, rule: "legacy-host", detail: `no approved modern equivalent for ${citation.url}` },
      };
    }
    next.url = builder(minor);
    reasons.push(`retired host -> docs.redhat.com ${minor}`);
  } else {
    const urlMinor = citation.url.match(DOC_URL_MINOR_RE);
    if (urlMinor && urlMinor[1] !== minor) {
      const [base, fragment] = citation.url.split("#");
      const proven = R.DOC_URL_PROVEN_4_21[base];
      if (!proven || proven.to !== minor) {
        return {
          citation,
          change: null,
          frozen: false,
          unmatched: { ...at, rule: "doc-url-minor", detail: `${minor} target not proven for ${base}` },
        };
      }
      next.url = base.replace(`/${urlMinor[1]}/`, `/${minor}/`) + (fragment ? `#${fragment}` : "");
      reasons.push(`url ${urlMinor[1]} -> ${minor}`);
    }
  }

  if (reasons.length === 0) return { citation, change: null, unmatched: null, frozen: false };
  return {
    citation: next,
    change: { ...at, rule: "doc-citation-aligned", from: citation.sectionHeading, to: reasons.join("; "), kind: "provenance" },
    unmatched: null,
    frozen: false,
  };
}

// ---------------------------------------------------------------------------
// Parameter-level repair
// ---------------------------------------------------------------------------

/**
 * Key order used by every already-valid catalog row. Newly filled fields are
 * placed here rather than appended, so a repaired row reads like its
 * neighbours. Keys outside this list keep their original relative order at the
 * end — the list is a preference, not an allowlist, so an unknown key is never
 * dropped.
 */
const CANONICAL_KEY_ORDER = [
  "path",
  "outputFile",
  "type",
  "items_type",
  "allowed",
  "enum",
  "default",
  "required",
  "description",
  "applies_to",
  "ipi_only",
  "notes",
  "conditionals",
  "deprecated",
  "deprecatedReason",
  "replacement",
  "replacementPath",
  "removalVersion",
  "citations",
  "supportStatus",
  "minVersion",
  "maxVersion",
  "versionNotes",
  "validationRules",
];

function orderKeys(param) {
  const out = {};
  for (const k of CANONICAL_KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(param, k)) out[k] = param[k];
  }
  for (const k of Object.keys(param)) {
    if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = param[k];
  }
  return out;
}

function repairParameter(param, ctx) {
  const next = JSON.parse(JSON.stringify(param));
  const changes = [];
  const unmatched = [];
  let frozen = 0;
  const at = { minor: ctx.minor, scenarioId: ctx.scenarioId, paramPath: param.path };
  const pctx = { ...ctx, paramPath: param.path };

  // R1 type alias — metadata only
  if (typeof next.type === "string" && R.TYPE_ALIASES[next.type]) {
    changes.push({ ...at, rule: "type-alias", from: next.type, to: R.TYPE_ALIASES[next.type], kind: "metadata" });
    next.type = R.TYPE_ALIASES[next.type];
  }

  // R8 default: null -> sentinel
  if (next.default === null) {
    changes.push({ ...at, rule: "null-default-normalized", from: null, to: R.NULL_DEFAULT_NORMALIZES_TO, kind: "metadata" });
    next.default = R.NULL_DEFAULT_NORMALIZES_TO;
  }

  // R5 field fills
  const fill = R.FIELD_FILLS[param.path];
  const missing = ["outputFile", "applies_to", "allowed", "default"].filter(
    (k) => next[k] === undefined || next[k] === null
  );
  if (missing.length) {
    if (!fill) {
      unmatched.push({ ...at, rule: "field-fill", detail: `missing [${missing.join(", ")}] and no approved fill for this path` });
    } else {
      if (missing.includes("outputFile")) {
        next.outputFile = "install-config.yaml";
        changes.push({ ...at, rule: "field-fill", field: "outputFile", from: "(absent)", to: next.outputFile, kind: "behaviour" });
      }
      if (missing.includes("applies_to")) {
        next.applies_to = [ctx.scenarioId];
        changes.push({ ...at, rule: "field-fill", field: "applies_to", from: "(absent)", to: JSON.stringify(next.applies_to), kind: "behaviour" });
      }
      if (missing.includes("allowed")) {
        next.allowed = fill.allowed;
        changes.push({ ...at, rule: "field-fill", field: "allowed", from: "(absent)", to: JSON.stringify(fill.allowed), kind: "behaviour", evidence: fill.allowedEvidence || fill.goType });
      }
      if (missing.includes("default")) {
        const value = "default" in fill ? fill.default : R.NOT_SPECIFIED;
        next.default = value;
        changes.push({ ...at, rule: "field-fill", field: "default", from: "(absent)", to: JSON.stringify(value), kind: "behaviour", evidence: fill.defaultEvidence || "no default in that minor's docs or installer defaults package" });
      }
    }
  }

  // R6/R7 citations
  if (Array.isArray(next.citations)) {
    const rebuilt = [];
    for (const citation of next.citations) {
      const r = repairCitation(citation, pctx);
      if (r.frozen) frozen++;
      if (r.change) changes.push(r.change);
      if (r.unmatched) unmatched.push(r.unmatched);
      if (r.citation !== null) rebuilt.push(r.citation);
    }
    if (rebuilt.length === 0 && next.citations.length > 0) {
      unmatched.push({ ...at, rule: "citations", detail: "repair would leave the citations array empty; refused" });
    } else {
      next.citations = rebuilt;
    }
  }

  return { param: changes.length ? orderKeys(next) : next, changes, unmatched, frozen };
}

// ---------------------------------------------------------------------------
// Catalog / minor level
// ---------------------------------------------------------------------------

function repairMinor({ root, minor }) {
  const dir = path.join(root, "data", "params", minor);
  if (!fs.existsSync(dir)) throw new Error(`Canonical catalog directory not found: ${dir}`);

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const result = { minor, changes: [], unmatched: [], frozen: 0, files: [], parameters: 0 };

  for (const file of files) {
    const full = path.join(dir, file);
    const original = fs.readFileSync(full, "utf8");
    const data = JSON.parse(original);
    const ctx = { minor, scenarioId: data.scenarioId };
    let fileChanged = false;

    data.parameters = (data.parameters || []).map((param) => {
      result.parameters++;
      const r = repairParameter(param, ctx);
      result.changes.push(...r.changes.map((c) => ({ ...c, file })));
      result.unmatched.push(...r.unmatched.map((u) => ({ ...u, file })));
      result.frozen += r.frozen;
      if (r.changes.length) fileChanged = true;
      return r.param;
    });

    if (fileChanged) {
      // Preserve the repository's existing two-space, newline-terminated style.
      result.files.push({ file, path: `data/params/${minor}/${file}`, content: `${JSON.stringify(data, null, 2)}\n` });
    }
  }

  return result;
}

const USAGE = `Usage: node scripts/minor/repair/apply-catalog-repairs.js --minor <X.Y> (--check | --apply) [options]

  --minor <X.Y>   REQUIRED. The ONLY minor read or written.
  --check         Write nothing. Exit non-zero if any repair is pending.
  --apply         Write the repaired canonical catalogs.
  --report <file> Write the full change/provenance report as JSON.
  --root <dir>    Repository root (default: this repository).

Applies only the rules in scripts/minor/repair/proven-repairs.js. Rows matching
no approved rule are reported and left unchanged, and always cause a non-zero
exit. H3 citations are frozen. Frontend mirrors are NOT touched: regenerate
them with \`npm run sync-catalogs\`.`;

function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    process.exit(0);
  }

  let minor;
  try {
    minor = parseMinor(flags.minor, "--minor");
  } catch (err) {
    if (err instanceof MinorArgumentError) {
      console.error(`apply-catalog-repairs: ${err.message}\n\n${USAGE}`);
      process.exit(2);
    }
    throw err;
  }

  const check = flags.check === true;
  const apply = flags.apply === true;
  if (check === apply) {
    console.error(`apply-catalog-repairs: exactly one of --check or --apply is required.\n\n${USAGE}`);
    process.exit(2);
  }

  const root = flags.root && flags.root !== true ? path.resolve(String(flags.root)) : path.resolve(__dirname, "..", "..", "..");

  let result;
  try {
    result = repairMinor({ root, minor });
  } catch (err) {
    console.error(`apply-catalog-repairs: ${err.message}`);
    process.exit(1);
  }

  const byRule = {};
  for (const c of result.changes) byRule[c.rule] = (byRule[c.rule] || 0) + 1;
  const byKind = {};
  for (const c of result.changes) byKind[c.kind] = (byKind[c.kind] || 0) + 1;

  console.log(
    `Catalog repairs for ${minor}: ${result.changes.length} change(s) across ` +
      `${result.files.length} file(s) of ${result.parameters} parameter(s).`
  );
  for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${rule}`);
  }
  console.log(`  ${String(byKind.provenance || 0).padStart(5)}  [kind] provenance/metadata-only`);
  console.log(`  ${String(byKind.metadata || 0).padStart(5)}  [kind] metadata-only`);
  console.log(`  ${String(byKind.behaviour || 0).padStart(5)}  [kind] behaviour-affecting`);
  console.log(`  ${String(result.frozen).padStart(5)}  H3 citation(s) frozen, untouched`);

  if (flags.report && flags.report !== true) {
    const out = path.resolve(String(flags.report));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(
      out,
      `${JSON.stringify(
        {
          minor,
          installerPin: R.INSTALLER_PINS[minor],
          summary: { changes: result.changes.length, byRule, byKind, frozen: result.frozen, unmatched: result.unmatched.length },
          changes: result.changes,
          unmatched: result.unmatched,
        },
        null,
        1
      )}\n`
    );
    console.log(`\nReport: ${out}`);
  }

  if (result.unmatched.length) {
    console.error(`\n${result.unmatched.length} row(s) matched no approved rule and were left unchanged:`);
    const seen = new Set();
    for (const u of result.unmatched) {
      const k = `${u.rule}|${u.detail}`;
      if (seen.has(k)) continue;
      seen.add(k);
      console.error(`  [${u.rule}] ${u.detail}`);
      console.error(`      first seen: ${u.file} ${u.paramPath}`);
    }
    console.error("\nFAIL: every repair must be backed by an approved evidence rule.");
    process.exit(1);
  }

  if (check) {
    if (result.changes.length) {
      console.error(`\nFAIL (--check): ${result.changes.length} repair(s) pending. Re-run with --apply.`);
      process.exit(1);
    }
    console.log("\nOK (--check): no repairs pending.");
    process.exit(0);
  }

  for (const f of result.files) {
    fs.writeFileSync(path.join(root, f.path), f.content);
  }
  console.log(`\nWrote ${result.files.length} canonical file(s) under data/params/${minor}/.`);
  console.log("Regenerate the frontend mirrors with `npm run sync-catalogs`.");
  process.exit(0);
}

if (require.main === module) main();

module.exports = { repairCitation, repairParameter, repairMinor, findResolution, buildResolvedCitation, orderKeys, CANONICAL_KEY_ORDER, buildInstallerCitation, splitInstallerHeading, stubDocCitation };
