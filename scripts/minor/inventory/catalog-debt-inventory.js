#!/usr/bin/env node
"use strict";

/**
 * Catalog authority debt inventory for one OpenShift minor.
 *
 * Produces the evidence-backed repair inventory that must exist BEFORE any
 * canonical catalog row is edited (Tranche 0B, phase 0B-A). It reads canonical
 * data only — never a frontend mirror — and never writes to data/params/**.
 *
 * WHAT IT FINDS
 *
 *   field        a parameter field the executable validator requires and the
 *                row does not carry (outputFile, applies_to, allowed, default, ...)
 *   citation     a citation object that is malformed, carries another minor's
 *                evidence, or cites a section heading that does not exist in
 *                this minor's own documentation
 *   type-alias   a `type` value outside the documented schema enum
 *                (`int` -> `integer`, `bool` -> `boolean`)
 *
 * CROSS-MINOR DETECTION IS DELIBERATELY WIDER THAN THE CITATION GUARD.
 *
 * scripts/validate-catalog-citation-minor.js judges only URLs carrying the
 * `openshift_container_platform/<minor>` segment, because that is the one
 * pattern it can judge without false positives. Three further ways a citation
 * can carry the wrong minor do not match that segment and so are invisible to
 * it:
 *
 *   - the retired `docs.openshift.com/container-platform/<minor>/` host
 *   - `github.com/openshift/installer/blob/release-<minor>/` source links
 *   - a `docTitle` naming a minor ("OpenShift Installer 4.20 Source Code")
 *
 * This inventory reports all four so the repair set is the real one. Which of
 * them the guard should itself enforce is recorded as a finding, not decided
 * here.
 *
 * EVIDENCE
 *
 * Section headings are checked against extracted Red Hat documentation text for
 * the SAME minor, supplied with --evidence-root. Evidence from another minor is
 * never consulted: a 4.20 heading may not exist at 4.21 and vice versa. With no
 * --evidence-root the heading check is reported as `unknown` rather than
 * guessed, so the tool stays useful (and hermetic) without local assets.
 *
 * No network access.
 *
 * Usage:
 *   node scripts/minor/inventory/catalog-debt-inventory.js --minor 4.21 \
 *        [--evidence-root <dir>] [--root <repo>] [--json <out>] [--quiet]
 */

const fs = require("fs");
const path = require("path");

const { parseArgs, parseMinor, MinorArgumentError } = require("../lib/minor.js");
const { validateParam } = require("../../validate-catalog.js");

/** Minor carried by a versioned Red Hat documentation URL, either host form. */
const DOC_URL_MINOR_RE = /(?:openshift_container_platform|container-platform)\/(\d+\.\d+)/;
/** Minor carried by an installer source permalink. */
const INSTALLER_BRANCH_MINOR_RE = /\/blob\/release-(\d+\.\d+)\//;
/** Minor named inside a citation title, e.g. "OpenShift Installer 4.20 Source Code". */
const TITLE_MINOR_RE = /\b(\d+\.\d{1,2})\b/;

/** The retired documentation host. Still resolves, but is not where docs live. */
const LEGACY_DOC_HOST = "docs.openshift.com";

/** `type` values the documented schema enum accepts. */
const SCHEMA_TYPE_ENUM = ["string", "integer", "boolean", "array", "object", "cidr", "ipv4", "ipv6"];
/** Aliases present in catalog data, and the enum value each normalizes to. */
const TYPE_ALIASES = { int: "integer", bool: "boolean" };

/** Citation sub-fields the executable validator requires. */
const CITATION_REQUIRED = ["docId", "docTitle", "sectionHeading", "url"];

// ---------------------------------------------------------------------------
// Documentation evidence
// ---------------------------------------------------------------------------

/**
 * Strip a leading section number or table number and normalize for comparison.
 *
 * "9.1.3. Optional configuration parameters"      -> "optional configuration parameters"
 * "Table 5.3. ImageSetConfiguration parameters"   -> "imagesetconfiguration parameters"
 *
 * Comparing titles rather than numbers is the point: Red Hat renumbers sections
 * between minors while keeping the title, which is the drift worth repairing.
 */
function normalizeHeadingTitle(heading) {
  return String(heading)
    .replace(/^\s*Table\s+[\d.]+\.?\s*/i, "")
    .replace(/^[\d.]+\.?\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The leading number a heading cites, if any: "9.1.3" or "Table 5.3". */
function citedHeadingNumber(heading) {
  const table = String(heading).match(/^\s*(Table\s+\d+(?:\.\d+)*)\./i);
  if (table) return table[1];
  const section = String(heading).match(/^\s*(\d+(?:\.\d+)*)\./);
  return section ? section[1] : null;
}

/**
 * Load the extracted documentation text for one minor.
 * @returns {{books: Record<string,string>, available: boolean}}
 */
function loadDocEvidence(evidenceRoot, minor) {
  if (!evidenceRoot) return { books: {}, available: false };
  const dir = path.join(evidenceRoot, `ocp-${minor}`, "docs", "extracted");
  if (!fs.existsSync(dir)) return { books: {}, available: false };
  const books = {};
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".txt")) books[f] = fs.readFileSync(path.join(dir, f), "utf8");
  }
  return { books, available: Object.keys(books).length > 0 };
}

/**
 * The documentation book a Red Hat documentation URL addresses.
 *
 * Both hosts put the book slug immediately after the rendering segment:
 *   .../openshift_container_platform/4.21/html/<book>/<chapter>
 *   .../openshift_container_platform/4.21/html-single/<book>/...
 *   .../container-platform/4.21/<book>/...        (retired host)
 *
 * Returns null for a URL that addresses no particular book, such as the bare
 * product root `.../openshift_container_platform/4.20/`.
 */
function bookSlugFromUrl(url) {
  if (typeof url !== "string") return null;
  const modern = url.match(/openshift_container_platform\/\d+\.\d+\/(?:html|html-single|pdf)\/([^/#?]+)/);
  if (modern) return modern[1].toLowerCase();
  const legacy = url.match(/container-platform\/\d+\.\d+\/([^/#?]+)/);
  if (legacy) return legacy[1].toLowerCase();
  return null;
}

/**
 * Extracted filenames whose slug does not equal the slug in the live URL.
 *
 * Exactly one, and it is the rename the onboarding runbook already warns about:
 * the 4.20 vSphere book was acquired as `Installing_on_vSphere`, while the page
 * has always been served from `installing_on_vmware_vsphere`. Confirmed live at
 * both 4.20 and 4.21. Without this the 4.20 vSphere citations resolve to no
 * book and their heading defects go unreported — which is how the identical
 * defect was visible at 4.21 and invisible at 4.20.
 *
 * Deliberately a short, evidenced list rather than fuzzy matching: a loose
 * match would silently validate a citation against the wrong book.
 */
const BOOK_SLUG_ALIASES = Object.freeze({
  installing_on_vsphere: "installing_on_vmware_vsphere",
});

/** The book slug an extracted filename corresponds to. */
function bookSlugFromFilename(filename) {
  const slug = filename
    .replace(/^OpenShift_Container_Platform-[\d.]+-/, "")
    .replace(/-en-US\.txt$/, "")
    .toLowerCase();
  return BOOK_SLUG_ALIASES[slug] || slug;
}

/**
 * Locate a heading title in this minor's documentation.
 *
 * Judged ONLY against the book the citation actually addresses. Searching every
 * book would both miss renumbering (a heading title recurs across books — the
 * proxy section appears 27 times) and, worse, report drift for a citation whose
 * book is simply absent from the local evidence set. Absence of evidence is
 * reported as `unknown`, never as a defect.
 *
 * @returns {{status: "exact"|"renumbered"|"absent"|"unknown", found: string[], reason?: string}}
 */
function locateHeading(evidence, heading, url) {
  if (!evidence.available) return { status: "unknown", found: [], reason: "no documentation evidence supplied" };
  const want = normalizeHeadingTitle(heading);
  if (!want) return { status: "unknown", found: [], reason: "citation carries no section heading" };

  const slug = bookSlugFromUrl(url);
  if (!slug) {
    return { status: "unknown", found: [], reason: "URL addresses no specific documentation book" };
  }

  const scoped = Object.entries(evidence.books).filter(([f]) => bookSlugFromFilename(f) === slug);
  if (scoped.length === 0) {
    return { status: "unknown", found: [], reason: `book "${slug}" is not in the extracted evidence set` };
  }

  // Two things a catalog legitimately cites as a "section heading": a numbered
  // section ("9.1.3. Optional configuration parameters") and a numbered table
  // caption ("Table 5.3. ImageSetConfiguration parameters"). The parameter
  // tables are what a reader is actually sent to, so the caption form is a
  // correct citation and must not be reported as missing.
  const SECTION_RE = /^\s*(\d+(?:\.\d+)*)\.?\s+(\S.*?)\s*(?:\d+)?\s*$/;
  const TABLE_RE = /^\s*(Table\s+\d+(?:\.\d+)*)\.\s+(\S.*?)\s*(?:\d+)?\s*$/i;

  const found = new Set();
  for (const [book, text] of scoped) {
    const shortBook = book
      .replace(/^OpenShift_Container_Platform-[\d.]+-/, "")
      .replace(/-en-US\.txt$/, "");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(TABLE_RE) || line.match(SECTION_RE);
      if (!m) continue;
      if (normalizeHeadingTitle(m[2]) !== want) continue;
      found.add(`${shortBook}: ${m[1]}. ${m[2].replace(/\s+\d+$/, "")}`);
    }
  }
  if (found.size === 0) return { status: "absent", found: [] };

  const list = [...found];
  // "exact" when some occurrence carries the same number the citation claims.
  // A citation that claims no number cannot be wrong about one.
  const citedNumber = citedHeadingNumber(heading);
  if (!citedNumber) return { status: "exact", found: list };
  const exact = list.some((h) => h.split(": ").slice(1).join(": ").startsWith(`${citedNumber}.`));
  return { status: exact ? "exact" : "renumbered", found: list };
}

// ---------------------------------------------------------------------------
// Citation analysis
// ---------------------------------------------------------------------------

/**
 * Is this citation pointing at a Red Hat documentation page?
 *
 * Only those carry a documentation `sectionHeading` that can be checked against
 * the extracted books. The catalogs also cite installer Go source
 * (`pkg/types/... - Platform.AWS`) and the external NMState schema
 * (`Interfaces: ethernet`) through the same field; those headings are correct
 * and simply do not live in Red Hat documentation, so checking them there would
 * manufacture hundreds of false findings.
 */
function isProductDocCitation(citation) {
  const url = typeof citation?.url === "string" ? citation.url : "";
  if (!url) return false;
  return /docs\.redhat\.com\//.test(url) || new RegExp(`${LEGACY_DOC_HOST}/`).test(url);
}

/** Shape of a citation object: schema-conformant, or the legacy provenance form. */
function citationShape(citation) {
  if (!citation || typeof citation !== "object") return "malformed";
  const hasAll = CITATION_REQUIRED.every((k) => typeof citation[k] === "string" && citation[k].trim());
  if (hasAll) return "schema";
  if ("source" in citation) return "legacy-provenance";
  return "incomplete";
}

/** Every way this citation carries a minor, and which minor that is. */
function citationMinorSignals(citation) {
  const signals = [];
  const url = typeof citation.url === "string" ? citation.url : "";

  const docMatch = url.match(DOC_URL_MINOR_RE);
  if (docMatch) {
    signals.push({
      signal: "doc-url",
      minor: docMatch[1],
      guardVisible: /openshift_container_platform\//.test(url),
      detail: url,
    });
  }

  const branchMatch = url.match(INSTALLER_BRANCH_MINOR_RE);
  if (branchMatch) {
    signals.push({ signal: "installer-branch", minor: branchMatch[1], guardVisible: false, detail: url });
  }

  if (typeof citation.docTitle === "string") {
    const titleMatch = citation.docTitle.match(TITLE_MINOR_RE);
    if (titleMatch) {
      signals.push({
        signal: "doc-title",
        minor: titleMatch[1],
        guardVisible: false,
        detail: citation.docTitle,
      });
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

function inventoryMinor({ root, minor, evidenceRoot }) {
  const dir = path.join(root, "data", "params", minor);
  if (!fs.existsSync(dir)) {
    throw new Error(`Canonical catalog directory not found: ${dir}`);
  }
  const evidence = loadDocEvidence(evidenceRoot, minor);
  const rows = [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

  let parameterCount = 0;
  let citationCount = 0;

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    (data.parameters || []).forEach((param, index) => {
      parameterCount++;
      const base = { minor, file, index, parameterPath: param.path ?? null };

      // --- field-level failures, straight from the executable validator -----
      for (const message of validateParam(param, index, data.scenarioId)) {
        const field = (message.match(/^param\[\d+\]\.([A-Za-z_[\]0-9]+)/) || [])[1] || "(unknown)";
        if (field.startsWith("citations")) continue; // reported in detail below
        rows.push({
          ...base,
          klass: "field",
          field,
          failure: message.replace(/^param\[\d+\]\./, ""),
          currentValue: param[field] === undefined ? "(absent)" : param[field],
          repairClass: "behavior-affecting",
          confidence: "UNRESOLVED",
          evidenceType: null,
          evidenceSource: null,
        });
      }

      // --- type alias -------------------------------------------------------
      if (typeof param.type === "string" && !SCHEMA_TYPE_ENUM.includes(param.type)) {
        const proposed = TYPE_ALIASES[param.type];
        rows.push({
          ...base,
          klass: "type-alias",
          field: "type",
          failure: `type "${param.type}" is outside the documented schema enum`,
          currentValue: param.type,
          proposedValue: proposed ?? null,
          repairClass: "metadata-only",
          confidence: proposed ? "PROVEN" : "UNRESOLVED",
          evidenceType: "schema",
          evidenceSource: "schema/catalog-parameter-schema.json properties.parameters.items.properties.type.enum",
        });
      }

      // --- citations --------------------------------------------------------
      (param.citations || []).forEach((citation, ci) => {
        citationCount++;
        const shape = citationShape(citation);
        const cbase = { ...base, citationIndex: ci, klass: "citation" };

        if (shape !== "schema") {
          rows.push({
            ...cbase,
            field: `citations[${ci}]`,
            failure: `citation shape "${shape}": missing ${CITATION_REQUIRED.filter(
              (k) => !(citation && typeof citation[k] === "string" && citation[k].trim())
            ).join(", ")}`,
            currentValue: citation,
            repairClass: "metadata-only",
            confidence: "UNRESOLVED",
            evidenceType: null,
            evidenceSource: null,
          });
        }

        for (const sig of citationMinorSignals(citation || {})) {
          if (sig.minor === minor) continue;
          rows.push({
            ...cbase,
            field: `citations[${ci}].${sig.signal}`,
            failure: `cross-minor evidence: ${sig.signal} carries ${sig.minor} inside data/params/${minor}`,
            currentValue: sig.detail,
            guardVisible: sig.guardVisible,
            repairClass: "metadata-only",
            confidence: "UNRESOLVED",
            evidenceType: null,
            evidenceSource: null,
          });
        }

        if (
          isProductDocCitation(citation) &&
          typeof citation.sectionHeading === "string" &&
          citation.sectionHeading.trim()
        ) {
          const located = locateHeading(evidence, citation.sectionHeading, citation.url);
          if (located.status === "absent" || located.status === "renumbered") {
            rows.push({
              ...cbase,
              field: `citations[${ci}].sectionHeading`,
              failure:
                located.status === "absent"
                  ? `sectionHeading not found in any extracted ${minor} documentation book`
                  : `sectionHeading title exists at ${minor} but under a different section number`,
              currentValue: citation.sectionHeading,
              proposedValue: located.found.length === 1 ? located.found[0] : null,
              evidenceType: "docs",
              evidenceSource: located.found.length
                ? located.found.join(" | ")
                : `extracted ${minor} documentation (${Object.keys(evidence.books).length} book(s))`,
              repairClass: "metadata-only",
              confidence: located.status === "renumbered" && located.found.length === 1 ? "PROVEN" : "UNRESOLVED",
            });
          }
        }
      });
    });
  }

  return {
    minor,
    scanned: { files: files.length, parameters: parameterCount, citations: citationCount },
    evidence: {
      available: evidence.available,
      books: Object.keys(evidence.books).length,
      root: evidenceRoot || null,
    },
    rows,
  };
}

function summarize(result) {
  const byClass = {};
  for (const r of result.rows) {
    const key = r.klass === "citation" ? `citation/${r.field.replace(/^citations\[\d+\]\.?/, "") || "shape"}` : r.klass;
    byClass[key] = (byClass[key] || 0) + 1;
  }
  return byClass;
}

const USAGE = `Usage: node scripts/minor/inventory/catalog-debt-inventory.js --minor <X.Y> [options]

  --minor <X.Y>          REQUIRED. Which minor's canonical catalogs to inventory.
  --evidence-root <dir>  Local documentation evidence root (contains ocp-<minor>/docs/extracted).
                         Omitted: heading checks are reported as unknown, never guessed.
  --root <dir>           Repository root (default: this repository).
  --json <file>          Write the machine-readable inventory here.
  --quiet                Suppress the human summary.

Reads canonical data/params/<minor>/** only. Writes nothing except --json.`;

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
      console.error(`catalog-debt-inventory: ${err.message}\n\n${USAGE}`);
      process.exit(2);
    }
    throw err;
  }

  const root = flags.root && flags.root !== true ? path.resolve(String(flags.root)) : path.resolve(__dirname, "..", "..", "..");
  const evidenceRoot = flags["evidence-root"] && flags["evidence-root"] !== true ? path.resolve(String(flags["evidence-root"])) : null;

  let result;
  try {
    result = inventoryMinor({ root, minor, evidenceRoot });
  } catch (err) {
    console.error(`catalog-debt-inventory: ${err.message}`);
    process.exit(1);
  }

  if (flags.json && flags.json !== true) {
    const out = path.resolve(String(flags.json));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
  }

  if (!flags.quiet) {
    console.log(
      `Catalog debt inventory for ${minor}: ${result.scanned.parameters} parameter(s), ` +
        `${result.scanned.citations} citation(s) across ${result.scanned.files} file(s).`
    );
    console.log(
      result.evidence.available
        ? `Documentation evidence: ${result.evidence.books} extracted ${minor} book(s).`
        : `Documentation evidence: NONE supplied — heading checks skipped, not guessed.`
    );
    console.log(`\n${result.rows.length} repair row(s):`);
    for (const [k, v] of Object.entries(summarize(result)).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(5)}  ${k}`);
    }
  }

  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  inventoryMinor,
  citationShape,
  isProductDocCitation,
  citationMinorSignals,
  normalizeHeadingTitle,
  citedHeadingNumber,
  locateHeading,
  bookSlugFromUrl,
  bookSlugFromFilename,
  SCHEMA_TYPE_ENUM,
  TYPE_ALIASES,
};
