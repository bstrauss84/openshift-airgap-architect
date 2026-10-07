#!/usr/bin/env node
"use strict";

/**
 * Catalog citation minor guard.
 *
 * Every citation URL in data/params/<minor>/** must point at that minor's
 * documentation. A 4.21 catalog citing a 4.20 page is a provenance defect: the
 * cited section may not exist at 4.21, and the reader is sent to the wrong
 * release.
 *
 * This is the catalog-side equivalent of the Field Guide's
 * provenance.js:certifyDocRefs, which already throws when a doc URL's minor
 * does not match the resolved minor. The Field Guide has had that guard for a
 * while; the catalogs never did, which is how data/params/4.21/ came to hold
 * 810 citation URLs pointing at /4.20/ and zero pointing at /4.21/.
 *
 * TWO EXPLICIT MODES. Exactly one must be given; there is no default, so a
 * caller can never get report semantics when they meant enforcement.
 *
 *   --report   print findings, exit 0 even when drift exists
 *   --strict   print findings, exit 1 if any drift exists
 *
 * STAGING. CI runs --report today because the existing 4.20/4.21 citation debt
 * is owned by Tranche 0B. Running it non-blocking now means the guard is in
 * place BEFORE the next minor's catalogs are authored, so a third generation of
 * drift is caught on arrival rather than discovered later.
 *
 * ---------------------------------------------------------------------------
 * TRANCHE 0B CUTOVER — one unambiguous action.
 *
 *   1. Repair the citations (see MINOR_ONBOARDING_RUNBOOK.md rule 4: each to an
 *      authoritative equivalent for its own minor; no blind string replacement;
 *      unresolved mappings stop and report).
 *   2. Confirm clean:  npm run check:citation-minor:strict   -> must exit 0
 *   3. In .github/workflows/ci.yml, change the step
 *        "Catalog citation minor guard (report-only, pre-0B)"
 *      to run  npm run check:citation-minor:strict
 *      and rename it to drop "(report-only, pre-0B)".
 *   4. Optionally delete the  check:citation-minor  (report) npm script so only
 *      the enforcing form remains.
 *
 * No other change is needed; the detection logic is identical in both modes.
 * ---------------------------------------------------------------------------
 *
 * Usage:
 *   node scripts/validate-catalog-citation-minor.js --report
 *   node scripts/validate-catalog-citation-minor.js --strict
 *   node scripts/validate-catalog-citation-minor.js --report --minor 4.21
 *   node scripts/validate-catalog-citation-minor.js --strict --root <fixture>
 *
 * No network access: this compares URL text against the directory name. It does
 * not fetch anything. URL liveness is an acquisition-time concern (plan R4).
 */

const fs = require("fs");
const path = require("path");

/**
 * Versioned OpenShift Container Platform documentation URLs carry the minor in
 * a fixed path segment: .../openshift_container_platform/<minor>/html/...
 *
 * Scope is deliberately narrow. A URL is only ever judged if it contains this
 * segment. Anything else — a Kubernetes doc, an RFC, a GitHub link, a Red Hat
 * knowledge-base article, an unversioned openshift.com page — carries no minor
 * to be wrong about and is left alone. Absence of "/4.xx/" is NOT evidence of
 * drift, and treating it as such would make the guard unusable the first time
 * a catalog legitimately cites a non-versioned source.
 */
const OCP_DOC_URL_RE = /openshift_container_platform\/(\d+\.\d+)/g;

const MINOR_DIR_RE = /^\d+\.\d+$/;

function collectCitationUrls(param) {
  if (!Array.isArray(param.citations)) return [];
  return param.citations
    .map((c) => (c && typeof c.url === "string" ? c.url : null))
    .filter(Boolean);
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
        for (const url of collectCitationUrls(param)) {
          scanned.citations++;
          // A single URL could in principle carry more than one version segment.
          for (const match of url.matchAll(OCP_DOC_URL_RE)) {
            const urlMinor = match[1];
            if (urlMinor !== minor) {
              findings.push({
                minor,
                file,
                kind: "wrong-minor",
                path: param.path,
                urlMinor,
                url,
              });
            }
          }
        }
      }
    }
  }

  return { findings, scanned };
}

const USAGE = `Usage: node scripts/validate-catalog-citation-minor.js (--report | --strict) [--minor <X.Y>] [--root <dir>]

  --report   print findings, exit 0 even when drift exists (CI today, pre-0B)
  --strict   print findings, exit 1 if any drift exists    (CI after 0B)

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
    `Catalog citation minor guard: scanned ${scanned.citations} citation URL(s) ` +
      `across ${scanned.files} file(s) in minor(s) [${scanned.minors.join(", ")}].`
  );

  if (findings.length === 0) {
    console.log("All citation URLs reference their own minor.");
    process.exit(0);
  }

  // Summarise rather than print thousands of lines.
  const byMinor = new Map();
  for (const f of findings) {
    const key = `${f.minor} -> ${f.urlMinor ?? f.kind}`;
    byMinor.set(key, (byMinor.get(key) || 0) + 1);
  }

  console.log(`\n${findings.length} citation URL(s) reference the wrong minor:`);
  for (const [key, count] of [...byMinor].sort()) {
    console.log(`  data/params/${key.split(" -> ")[0]}/** cites /${key.split(" -> ")[1]}/ : ${count}`);
  }

  const sample = findings.slice(0, 5);
  console.log("\nFirst findings:");
  for (const f of sample) {
    console.log(`  ${f.minor}/${f.file}  ${f.path}`);
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
    "\n--report MODE (exit 0). This is pre-existing 4.20/4.21 citation debt owned by Tranche 0B.\n" +
      "The guard runs non-blocking so it is in place before the next minor's catalogs are authored.\n" +
      "0B cutover: repair the citations, confirm `npm run check:citation-minor:strict` exits 0, then\n" +
      "switch the CI step to that script. See the header of this file for the exact steps."
  );
  process.exit(0);
}

if (require.main === module) main();

module.exports = { auditCitationMinors, OCP_DOC_URL_RE };
