#!/usr/bin/env node
"use strict";

/**
 * Catalog citation and provenance minor guard.
 *
 * Every citation in data/params/<minor>/** must carry only that minor's
 * provenance. A 4.21 catalog citing a 4.20 page is a defect: the cited section
 * may not exist at 4.21, and the reader is sent to the wrong release. The same
 * is true of a 4.21 row whose evidence is a release-4.20 installer permalink.
 *
 * This is the catalog-side equivalent of the Field Guide's
 * provenance.js:certifyDocRefs, which already throws when a doc URL's minor
 * does not match the resolved minor. The Field Guide has had that guard for a
 * while; the catalogs never did, which is how data/params/4.21/ came to hold
 * 939 citations carrying 4.20 provenance and none carrying 4.21.
 *
 * SIX SIGNALS. See MINOR_SIGNALS below. The guard originally judged only the
 * first and so reported 810 of those 939; Tranche 0B found the rest. Each is
 * anchored on a marker unique to minor-bearing provenance, so this is
 * emphatically not "any 4.xx anywhere is drift".
 *
 * TWO EXPLICIT MODES. Exactly one must be given; there is no default, so a
 * caller can never get report semantics when they meant enforcement.
 *
 *   --report   print findings, exit 0 even when drift exists
 *   --strict   print findings, exit 1 if any drift exists
 *
 * STATUS. Tranche 0B repaired all 939 and CI enforces --strict. There is
 * deliberately NO suppression list: a citation that cannot be placed from its
 * own minor's authorities is frozen and reported by the repair engine, never
 * excused here. Making --strict pass by excusing rows would reintroduce
 * exactly the silent permissive path this guard exists to prevent.
 *
 * --report remains for human diagnosis; it prints the same findings and exits
 * 0, and must never be the enforced CI path.
 *
 * Usage:
 *   node scripts/validate-catalog-citation-minor.js --report
 *   node scripts/validate-catalog-citation-minor.js --strict
 *   node scripts/validate-catalog-citation-minor.js --report --minor 4.21
 *   node scripts/validate-catalog-citation-minor.js --strict --root <fixture>
 *
 * No network access: this compares citation text against the directory name.
 * It does not fetch anything. URL liveness is an acquisition-time concern.
 */

const fs = require("fs");
const path = require("path");

/**
 * A citation can carry a minor in four structurally identifiable ways. Each
 * pattern is anchored on a marker that only ever appears in minor-bearing
 * provenance, so an ordinary version number in prose, a CIDR, a port or a
 * product version elsewhere in the citation is never matched.
 *
 * This is deliberately NOT "any 4.xx anywhere is drift". A URL or title with
 * no minor-bearing marker carries no minor to be wrong about and is left
 * alone: absence of a minor is not evidence of drift, and treating it as such
 * would break the first time a catalog legitimately cites a Kubernetes doc, an
 * RFC, the NMState schema or an unversioned Red Hat page.
 *
 * Tranche 0B found the last three empirically. The guard originally judged
 * only the first, which is why it reported 810 cross-minor citations in
 * data/params/4.21/** when the real figure was 939: 20 sat on the retired
 * documentation host and 109 were installer permalinks pinned to
 * release-4.20, carrying "OpenShift Installer 4.20 Source Code" titles.
 */
const MINOR_SIGNALS = Object.freeze([
  {
    signal: "doc-url",
    field: "url",
    // .../openshift_container_platform/<minor>/html|html-single|pdf/...
    pattern: /openshift_container_platform\/(\d+\.\d+)/g,
    describe: "Red Hat documentation URL",
  },
  {
    signal: "legacy-doc-url",
    field: "url",
    // The retired host, which kept a different layout:
    // docs.openshift.com/container-platform/<minor>/...
    pattern: /docs\.openshift\.com\/container-platform\/(\d+\.\d+)/g,
    describe: "retired docs.openshift.com documentation URL",
  },
  {
    signal: "installer-branch",
    field: "url",
    // github.com/openshift/installer/blob|tree/release-<minor>/...
    pattern: /github\.com\/openshift\/installer\/(?:blob|tree|raw)\/release-(\d+\.\d+)\//g,
    describe: "openshift/installer release branch permalink",
  },
  {
    signal: "installer-title",
    field: "docTitle",
    // The established installer-source citation title form, and only that
    // form: "OpenShift Installer <minor> Source Code".
    pattern: /^OpenShift Installer (\d+\.\d+) Source Code$/g,
    describe: "minor-labelled installer source citation title",
  },
  {
    signal: "doc-id-label",
    field: "docId",
    // A documentation citation whose identifier embeds the minor, e.g.
    // "ocp-4.20-baremetal-ipi". Anchored, so an id merely containing digits
    // is never matched.
    pattern: /^ocp-(\d+\.\d+)-/g,
    describe: "minor-labelled documentation citation id",
  },
  {
    signal: "doc-title-label",
    field: "docTitle",
    // "Installing OpenShift Container Platform <minor> on ..." — anchored at
    // the start, so a version mentioned mid-title is not provenance.
    pattern: /^(?:Installing )?OpenShift Container Platform (\d+\.\d+) /g,
    describe: "minor-labelled documentation citation title",
  },
]);

const MINOR_DIR_RE = /^\d+\.\d+$/;

/** Every (signal, minor) pair this citation structurally declares. */
function citationMinorSignals(citation) {
  if (!citation || typeof citation !== "object") return [];
  const found = [];
  for (const spec of MINOR_SIGNALS) {
    const value = citation[spec.field];
    if (typeof value !== "string") continue;
    // Fresh regex per use: the specs carry /g and are shared.
    const re = new RegExp(spec.pattern.source, "g");
    for (const m of value.matchAll(re)) {
      found.push({ signal: spec.signal, describe: spec.describe, minor: m[1], value });
    }
  }
  return found;
}

/**
 * @returns {{findings: object[], scanned: {minors: string[], files: number, citations: number}}}
 */
function auditCitationMinors({ root, onlyMinor } = {}) {
  const paramsRoot = path.join(root, "data", "params");
  const findings = [];
  const scanned = { minors: [], files: 0, citations: 0 };

  if (!fs.existsSync(paramsRoot)) {
    throw new Error(`Canonical params directory not found: ${paramsRoot}`);
  }

  const minors = fs
    .readdirSync(paramsRoot)
    .filter((n) => MINOR_DIR_RE.test(n) && fs.statSync(path.join(paramsRoot, n)).isDirectory())
    .filter((n) => !onlyMinor || n === onlyMinor)
    .sort();

  for (const minor of minors) {
    scanned.minors.push(minor);
    const dir = path.join(paramsRoot, minor);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      scanned.files++;
      let data;
      try {
        data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
      } catch (err) {
        findings.push({ minor, file, kind: "unparseable", detail: err.message });
        continue;
      }
      for (const param of data.parameters || []) {
        for (const citation of param.citations || []) {
          scanned.citations++;
          for (const sig of citationMinorSignals(citation)) {
            if (sig.minor === minor) continue;
            findings.push({
              minor,
              file,
              kind: "wrong-minor",
              signal: sig.signal,
              describe: sig.describe,
              path: param.path,
              urlMinor: sig.minor,
              url: sig.value,
            });
          }
        }
      }
    }
  }

  return { findings, scanned };
}

const USAGE = `Usage: node scripts/validate-catalog-citation-minor.js (--report | --strict) [--minor <X.Y>] [--root <dir>]

  --report   print findings, exit 0 even when drift exists (human diagnostic)
  --strict   print findings, exit 1 if any drift exists    (enforced in CI)

Exactly one mode is required. There is no default: an omitted mode must never
silently resolve to the permissive one.`;

function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes("--strict");
  const report = argv.includes("--report");

  // Fail closed on an ambiguous or missing mode.
  if (strict && report) {
    console.error("citation-minor guard: --report and --strict are mutually exclusive.\n\n" + USAGE);
    process.exit(2);
  }
  if (!strict && !report) {
    console.error("citation-minor guard: a mode is required.\n\n" + USAGE);
    process.exit(2);
  }

  const minorIdx = argv.indexOf("--minor");
  const rootIdx = argv.indexOf("--root");
  const onlyMinor = minorIdx !== -1 ? argv[minorIdx + 1] : undefined;
  const root = rootIdx !== -1 ? path.resolve(argv[rootIdx + 1]) : path.resolve(__dirname, "..");

  let result;
  try {
    result = auditCitationMinors({ root, onlyMinor });
  } catch (err) {
    console.error(`citation-minor guard: ${err.message}`);
    process.exit(1);
  }

  const { findings, scanned } = result;

  console.log(
    `Catalog citation/provenance minor guard: scanned ${scanned.citations} citation(s) ` +
      `across ${scanned.files} file(s) in minor(s) [${scanned.minors.join(", ")}].`
  );

  if (findings.length === 0) {
    console.log("All citations carry only their own minor's provenance.");
    process.exit(0);
  }

  // Summarise rather than print thousands of lines.
  const byMinor = new Map();
  for (const f of findings) {
    const key = `${f.minor} -> ${f.urlMinor ?? f.kind} [${f.signal ?? f.kind}]`;
    byMinor.set(key, (byMinor.get(key) || 0) + 1);
  }

  console.log(`\n${findings.length} citation(s) carry another minor's provenance:`);
  for (const [key, count] of [...byMinor].sort()) {
    const [lhs, rest] = key.split(" -> ");
    const [other, signal] = rest.split(" [");
    console.log(`  data/params/${lhs}/** carries ${other} via ${signal.replace("]", "")} : ${count}`);
  }

  const sample = findings.slice(0, 5);
  console.log("\nFirst findings:");
  for (const f of sample) {
    console.log(`  ${f.minor}/${f.file}  ${f.path}  (${f.describe ?? f.kind})`);
    console.log(`    ${f.url}`);
  }
  if (findings.length > sample.length) {
    console.log(`  ... and ${findings.length - sample.length} more`);
  }

  if (strict) {
    console.error(
      "\nFAIL (--strict): each citation must be repaired to an authoritative equivalent for its own minor.\n" +
        "A blind string replacement is NOT acceptable: Red Hat restructures documentation between\n" +
        "minors, so each target page must be confirmed to exist with the cited sectionHeading.\n" +
        "Unresolved mappings stop and report. See docs/minor-release/MINOR_ONBOARDING_RUNBOOK.md rule 4."
    );
    process.exit(1);
  }

  console.log(
    "\n--report MODE (exit 0). CI enforces --strict; this mode exists for human\n" +
      "diagnosis only. Each finding must be repaired to an authoritative equivalent for\n" +
      "its own minor — never by blind string replacement, and never by excusing the row.\n" +
      "See docs/minor-release/MINOR_ONBOARDING_RUNBOOK.md rule 4."
  );
  process.exit(0);
}

if (require.main === module) main();

module.exports = { auditCitationMinors, citationMinorSignals, MINOR_SIGNALS };
