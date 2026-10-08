#!/usr/bin/env node
"use strict";

/**
 * Architecture-support matrix guard (D3 / DOC-156).
 *
 * Validates data/arch-support/<minor>.json: the minor x platform x install-method
 * x architecture support matrix authored in v2.1 Tranche 2.
 *
 * WHAT THIS GUARDS, AND WHY EACH RULE EXISTS
 *
 * 1. Every cell carries a disposition, an explicit reason and provenance.
 *    The shape this file replaces was a bare platform -> architecture[] constant
 *    with no reason and no citation, so "why is s390x not offered on vSphere?"
 *    had no answer anywhere in the repository. A cell without provenance is the
 *    defect, not a formatting nit.
 *
 * 2. Provenance must resolve to a declared source, and every declared source
 *    must carry that minor's own URL. Cross-minor backfill is how a 4.20-era
 *    scan came to be presented as a 4.22 claim (runbook Rule 4).
 *
 * 3. Only `supported` may be offered. `unknown` is the DOC-156 OPEN state and
 *    must FAIL CLOSED: recording an evidence gap and then offering the choice
 *    anyway would be worse than not recording it.
 *
 * 4. The file must state, in data, that the matrix does NOT imply a
 *    heterogeneous cluster. Several platforms legitimately list two
 *    architectures; a reader must not be able to take that as permission to mix
 *    them. OCP 4.22 adds ARM compute on x86 control planes upstream, which makes
 *    the distinction load-bearing rather than theoretical.
 *
 * 5. The three architecture axes must stay separate and the export-binary axis
 *    must keep its standing rule. Reading the cluster-node FIPS sentence as an
 *    export-binary restriction is an error this onboarding already made once; the
 *    guard exists so it cannot be re-made silently by deleting the correction.
 *
 * This validator does NOT reach the network. URL liveness is an acquisition-time
 * concern (runbook Rule 6).
 *
 * Usage:
 *   node scripts/validate-arch-support.js
 *   node scripts/validate-arch-support.js --root <fixture-dir>
 */

const fs = require("fs");
const path = require("path");

const SCHEMA_ID = "oaa.archSupport/1";
const ARCHITECTURES = Object.freeze(["x86_64", "aarch64", "ppc64le", "s390x"]);
const DISPOSITIONS = Object.freeze(["supported", "locked", "hidden", "unknown"]);
const INSTALL_METHODS = Object.freeze(["ipi", "upi", "agent"]);
const MINOR_RE = /^\d+\.\d+$/;

/** Minimum length for a reason, so an empty-ish string cannot satisfy rule 1. */
const MIN_REASON_LENGTH = 40;

function validateFile(file, raw, errors) {
  const where = (s) => `${file}: ${s}`;
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    errors.push(where(`invalid JSON: ${e.message}`));
    return;
  }

  const minorFromName = path.basename(file, ".json");
  if (!MINOR_RE.test(minorFromName)) {
    errors.push(where("filename must be <major>.<minor>.json"));
    return;
  }
  if (doc.schema !== SCHEMA_ID) errors.push(where(`schema must be "${SCHEMA_ID}"`));
  if (doc.minor !== minorFromName) {
    errors.push(where(`"minor" is ${JSON.stringify(doc.minor)} but the filename says ${minorFromName}`));
  }

  // --- Rule 5: the three axes, and the export-binary standing rule ---------
  const axes = doc.architectureAxes;
  if (!axes || typeof axes !== "object") {
    errors.push(where("architectureAxes is required: the three architecture axes must stay separate"));
  } else {
    for (const k of ["targetCluster", "exportBinary", "runtimeHost"]) {
      if (!axes[k] || typeof axes[k] !== "object") errors.push(where(`architectureAxes.${k} is required`));
      else if (typeof axes[k].meaning !== "string" || !axes[k].meaning.trim()) {
        errors.push(where(`architectureAxes.${k}.meaning is required`));
      }
    }
    const rule = axes.exportBinary && axes.exportBinary.standingRule;
    if (typeof rule !== "string" || !/openshift-install-rhel9-arm64\.tar\.gz/.test(rule)) {
      errors.push(
        where(
          "architectureAxes.exportBinary.standingRule must record that Red Hat publishes openshift-install-rhel9-arm64.tar.gz, " +
            "so the cluster-node FIPS statement is not re-read as an export-binary restriction"
        )
      );
    }
  }

  // --- Rule 4: no mixed-architecture implication --------------------------
  const homo = doc.homogeneousOnly;
  if (!homo || typeof homo !== "object") {
    errors.push(where("homogeneousOnly is required"));
  } else {
    if (homo.value !== true) errors.push(where("homogeneousOnly.value must be true"));
    if (homo.mixedArchitectureSupported !== false) {
      errors.push(where("homogeneousOnly.mixedArchitectureSupported must be false"));
    }
    if (typeof homo.statement !== "string" || homo.statement.length < MIN_REASON_LENGTH) {
      errors.push(where("homogeneousOnly.statement must spell out that multiple architectures in a row are alternatives, not a mix"));
    }
    if (!Array.isArray(homo.provenance) || homo.provenance.length === 0) {
      errors.push(where("homogeneousOnly.provenance must cite at least one same-minor source"));
    }
  }

  // --- FIPS architectures, kept on the target-cluster axis ----------------
  const fips = doc.fipsValidatedArchitectures;
  if (!fips || typeof fips !== "object") {
    errors.push(where("fipsValidatedArchitectures is required"));
  } else {
    if (fips.axis !== "targetCluster") {
      errors.push(where('fipsValidatedArchitectures.axis must be "targetCluster" — it is a cluster-node statement'));
    }
    if (!Array.isArray(fips.provenance) || fips.provenance.length === 0) {
      errors.push(where("fipsValidatedArchitectures.provenance is required"));
    }
  }

  // --- Sources ------------------------------------------------------------
  const sources = doc.sources;
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) {
    errors.push(where("sources must be an object keyed by source id"));
    return;
  }
  for (const [id, src] of Object.entries(sources)) {
    if (!src || typeof src !== "object") {
      errors.push(where(`sources["${id}"] must be an object`));
      continue;
    }
    for (const k of ["title", "url", "retrieved"]) {
      if (typeof src[k] !== "string" || !src[k].trim()) errors.push(where(`sources["${id}"].${k} is required`));
    }
    // Rule 2: a Red Hat documentation source must carry THIS minor.
    if (typeof src.url === "string") {
      const m = src.url.match(/openshift_container_platform\/(\d+\.\d+)/);
      if (m && m[1] !== doc.minor) {
        errors.push(where(`sources["${id}"].url carries OpenShift ${m[1]} provenance in the ${doc.minor} matrix (cross-minor backfill)`));
      }
    }
  }

  // --- Matrix -------------------------------------------------------------
  if (!Array.isArray(doc.matrix) || doc.matrix.length === 0) {
    errors.push(where("matrix must be a non-empty array"));
    return;
  }
  const seenRows = new Set();
  for (const row of doc.matrix) {
    const rid = `${row && row.platform}/${row && row.installMethod}`;
    if (!row || typeof row !== "object") {
      errors.push(where("matrix entries must be objects"));
      continue;
    }
    if (typeof row.platform !== "string" || !row.platform) errors.push(where(`matrix[${rid}].platform is required`));
    if (!INSTALL_METHODS.includes(row.installMethod)) {
      errors.push(where(`matrix[${rid}].installMethod must be one of ${INSTALL_METHODS.join(", ")}`));
    }
    if (typeof row.scenarioId !== "string" || !row.scenarioId) errors.push(where(`matrix[${rid}].scenarioId is required`));
    if (seenRows.has(rid)) errors.push(where(`duplicate matrix row ${rid}`));
    seenRows.add(rid);

    const cells = row.architectures;
    if (!cells || typeof cells !== "object") {
      errors.push(where(`matrix[${rid}].architectures is required`));
      continue;
    }
    const got = Object.keys(cells).sort();
    if (got.join(",") !== [...ARCHITECTURES].sort().join(",")) {
      errors.push(where(`matrix[${rid}].architectures must cover exactly ${ARCHITECTURES.join(", ")} (got ${got.join(", ") || "none"})`));
    }
    for (const [arch, cell] of Object.entries(cells)) {
      const cid = `matrix[${rid}].${arch}`;
      if (!cell || typeof cell !== "object") {
        errors.push(where(`${cid} must be an object`));
        continue;
      }
      if (!DISPOSITIONS.includes(cell.disposition)) {
        errors.push(where(`${cid}.disposition must be one of ${DISPOSITIONS.join(", ")}`));
      }
      // Rule 3: fail closed. Only `supported` is offered.
      const shouldOffer = cell.disposition === "supported";
      if (cell.offered !== shouldOffer) {
        errors.push(
          where(`${cid}.offered must be ${shouldOffer} for disposition "${cell.disposition}" — only a supported cell may be offered`)
        );
      }
      // Rule 1: explicit reason.
      if (typeof cell.reason !== "string" || cell.reason.trim().length < MIN_REASON_LENGTH) {
        errors.push(where(`${cid}.reason must be an explicit sentence (at least ${MIN_REASON_LENGTH} characters)`));
      }
      // Rule 1 + 2: provenance, resolving to a declared source.
      if (!Array.isArray(cell.provenance) || cell.provenance.length === 0) {
        errors.push(where(`${cid}.provenance must cite at least one source`));
        continue;
      }
      for (const p of cell.provenance) {
        if (!p || typeof p !== "object") {
          errors.push(where(`${cid}.provenance entries must be objects`));
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(sources, p.source)) {
          errors.push(where(`${cid}.provenance cites undeclared source "${p.source}"`));
        }
        if (typeof p.quote !== "string" || !p.quote.trim()) {
          errors.push(where(`${cid}.provenance entries must carry a quote`));
        }
      }
    }
  }
}

function run(root) {
  const dir = path.join(root, "data", "arch-support");
  const errors = [];
  if (!fs.existsSync(dir)) {
    console.error(`Missing ${dir}`);
    return 1;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    console.error(`No .json files in ${dir} — refusing to report an empty read as success.`);
    return 1;
  }
  let cells = 0;
  for (const f of files) {
    const raw = fs.readFileSync(path.join(dir, f), "utf8");
    validateFile(f, raw, errors);
    try {
      const doc = JSON.parse(raw);
      for (const row of doc.matrix || []) cells += Object.keys(row.architectures || {}).length;
    } catch {
      /* already reported */
    }
  }

  if (errors.length) {
    console.error(`Architecture-support guard FAILED with ${errors.length} error(s):`);
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }
  console.log(
    `Architecture-support guard OK: ${files.length} minor file(s) [${files.map((f) => path.basename(f, ".json")).join(", ")}], ${cells} cell(s), every cell carries a disposition, a reason and resolvable provenance.`
  );
  return 0;
}

if (require.main === module) {
  const i = process.argv.indexOf("--root");
  const root = i !== -1 ? process.argv[i + 1] : path.resolve(__dirname, "..");
  process.exit(run(root));
}

module.exports = { run, validateFile, ARCHITECTURES, DISPOSITIONS, INSTALL_METHODS, SCHEMA_ID };
