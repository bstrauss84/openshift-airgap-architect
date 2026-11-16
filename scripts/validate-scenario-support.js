#!/usr/bin/env node
"use strict";

/**
 * Platform x installation-method scenario-surface guard (v2.1 Tranche 7C.1).
 *
 * WHY THIS AXIS EXISTS SEPARATELY FROM EVERY OTHER GUARD
 *
 * Minor onboarding already diffs install-config fields, AgentConfig fields,
 * NMState shapes, CPU architectures, operators and docs. None of those can see
 * a change in WHICH platform/method combinations are supported, because a new
 * combination can appear with identical fields and identical architectures.
 *
 * Nutanix + Agent is the worked example. Red Hat's Agent-based Installer book
 * lists `nutanix` under "Supported platforms" in 4.20, 4.21 and 4.22, while
 * this product models only `nutanix-ipi`. Nothing detected that, and nothing
 * could have: an unmodelled scenario has no scenarioId, so it has no row in
 * data/arch-support/, no parameter catalog, and no docs-index entry. It is
 * structurally invisible to every authority that is keyed by scenarioId.
 *
 * This guard reads data/scenario-support/<minor>.json, which records the
 * upstream disposition and the OAA disposition SEPARATELY so a gap between
 * them is visible rather than absent.
 *
 * NOT A COMPETING AUTHORITY. It does not restate architecture support
 * (data/arch-support owns that), nor which methods the UI offers
 * (shared/installMethods.js owns that), nor the scenarioId mapping
 * (shared/scenarioId.js owns that). It cross-checks all three and owns only
 * the per-minor upstream-vs-OAA disposition, which nothing else records.
 *
 * FAIL-CLOSED RULES
 *   - an unreviewed cell (`unknown-needs-review` on the OAA side) fails;
 *   - a cell whose OAA disposition is not a known vocabulary term fails;
 *   - a scenarioId the product can produce but which has no cell fails;
 *   - a cell claiming `modelled` whose scenarioId does not exist fails;
 *   - a cell `modelled` upstream-`not-supported` fails: the product would be
 *     offering something the documentation denies;
 *   - every minor must carry the full platform x method grid, so a newly
 *     onboarded minor cannot quietly omit a combination.
 *
 * Usage:
 *   node scripts/validate-scenario-support.js
 *   node scripts/validate-scenario-support.js --diff 4.21 4.22
 *   node scripts/validate-scenario-support.js --root <fixture-dir>
 */

const fs = require("fs");
const path = require("path");

const SCHEMA_ID = "oaa.scenarioSupport/1";
const METHODS = Object.freeze(["IPI", "UPI", "Agent"]);

/** Upstream vocabulary: what Red Hat's documentation says. */
const UPSTREAM = Object.freeze([
  "supported",
  "not-supported",
  // Red Hat's own sources disagree. Added in Tranche 7C.2 for Nutanix + Agent:
  // the installation-overview "Supported platforms" table leaves the
  // Agent-based Installer cell blank for Nutanix in 4.20, 4.21 and 4.22, while
  // the Agent book's own "Supported platforms" list names `nutanix` and the
  // Nutanix book says "You can install an OpenShift Container Platform cluster
  // on Nutanix by using the Agent-based Installer." Flattening that to
  // "supported" would hide a real documentation defect; flattening it to
  // "not-supported" would assert something two platform-specific books deny.
  "documentation-conflict",
  "unknown-needs-review",
]);

/**
 * OAA vocabulary: what this product does about it.
 *   modelled                             — implemented and offered
 *   intentionally-not-modelled           — a reviewed decision not to implement
 *   modelled-pending-upstream-review     — implemented, upstream evidence incomplete
 *   modelled-unreachable-pending-upstream-review
 *                                        — mapped internally but not offered in the UI
 *   unknown-needs-review                 — nobody has looked. Always fails.
 */
const OAA = Object.freeze([
  "modelled",
  "intentionally-not-modelled",
  "modelled-pending-upstream-review",
  "modelled-unreachable-pending-upstream-review",
  "unknown-needs-review",
]);

const MIN_REASON = 30;

function loadScenarioIds(root) {
  const src = fs.readFileSync(path.join(root, "shared", "scenarioId.js"), "utf8");
  const ids = new Set();
  for (const m of src.matchAll(/["']([a-z0-9]+(?:-[a-z0-9]+)*)["']\s*,?\s*$/gm)) {
    if (/-(ipi|upi|agent)$/.test(m[1])) ids.add(m[1]);
  }
  for (const m of src.matchAll(/:\s*["']([a-z0-9-]+-(?:ipi|upi|agent))["']/g)) ids.add(m[1]);
  return ids;
}

function validateDoc(file, doc, productScenarioIds, errors) {
  const where = (p, m) => `${file} ${p}/${m}`;
  if (doc.$schema !== SCHEMA_ID) errors.push(`${file}: $schema must be "${SCHEMA_ID}"`);
  if (!Array.isArray(doc.sources) || doc.sources.length === 0) {
    errors.push(`${file}: no sources declared`);
  }
  const sourceIds = new Set((doc.sources || []).map((s) => s.id));
  for (const s of doc.sources || []) {
    if (!/^https:\/\/docs\.redhat\.com\/.*\/html-single\//.test(s.url || "")) {
      errors.push(`${file}: source ${s.id} is not an html-single docs.redhat.com URL`);
    }
    // Cross-minor backfill is how a 4.20-era reading becomes a 4.22 claim.
    if (s.url && !s.url.includes(`/${doc.minor}/`)) {
      errors.push(`${file}: source ${s.id} does not cite this minor's own URL`);
    }
  }

  const rows = Array.isArray(doc.matrix) ? doc.matrix : [];
  const seen = new Set();
  for (const r of rows) {
    const key = `${r.platform}|${r.method}`;
    if (seen.has(key)) errors.push(`${file}: duplicate cell ${key}`);
    seen.add(key);

    if (!METHODS.includes(r.method)) errors.push(`${where(r.platform, r.method)}: unknown method`);
    if (!UPSTREAM.includes(r.upstream)) {
      errors.push(`${where(r.platform, r.method)}: upstream "${r.upstream}" is not in the vocabulary`);
    }
    if (!OAA.includes(r.oaa)) {
      errors.push(`${where(r.platform, r.method)}: oaa "${r.oaa}" is not in the vocabulary`);
    }

    // Every cell must say WHY, or the record is unreviewable.
    if ((r.upstreamReason || "").length < MIN_REASON) {
      errors.push(`${where(r.platform, r.method)}: upstreamReason is missing or too short`);
    }
    if ((r.oaaReason || "").length < MIN_REASON) {
      errors.push(`${where(r.platform, r.method)}: oaaReason is missing or too short`);
    }
    for (const p of r.provenance || []) {
      if (!sourceIds.has(p)) errors.push(`${where(r.platform, r.method)}: provenance "${p}" is not a declared source`);
    }
    if (!(r.provenance || []).length) {
      errors.push(`${where(r.platform, r.method)}: no provenance`);
    }

    // Fail closed on anything unreviewed.
    if (r.oaa === "unknown-needs-review") {
      errors.push(
        `${where(r.platform, r.method)}: OAA disposition is unknown-needs-review. ` +
          "An unreviewed platform/method cell must be dispositioned before release."
      );
    }

    // An unreconciled documentation conflict must not be exposed either.
    if (r.oaa.startsWith("modelled") && r.upstream === "documentation-conflict") {
      errors.push(
        `${where(r.platform, r.method)}: OAA models a combination whose upstream support is an ` +
          "unreconciled documentation conflict. Fail closed until Red Hat's sources agree."
      );
    }

    // The product must not offer what the documentation denies.
    const isModelled = r.oaa.startsWith("modelled");
    if (isModelled && r.upstream === "not-supported") {
      errors.push(
        `${where(r.platform, r.method)}: OAA models a combination Red Hat documents as unsupported.`
      );
    }
    if (isModelled && !r.scenarioId) {
      errors.push(`${where(r.platform, r.method)}: marked modelled but carries no scenarioId`);
    }
    if (isModelled && r.scenarioId && !productScenarioIds.has(r.scenarioId)) {
      errors.push(
        `${where(r.platform, r.method)}: scenarioId "${r.scenarioId}" is not produced by shared/scenarioId.js`
      );
    }
    if (!isModelled && r.scenarioId) {
      errors.push(`${where(r.platform, r.method)}: not modelled, yet declares scenarioId "${r.scenarioId}"`);
    }
  }

  // The grid must be complete, so onboarding cannot omit a combination.
  const platforms = [...new Set(rows.map((r) => r.platform))];
  for (const p of platforms) {
    for (const m of METHODS) {
      if (!seen.has(`${p}|${m}`)) errors.push(`${file}: missing cell for ${p}/${m}`);
    }
  }

  // Every scenario the product can actually produce needs a cell.
  const covered = new Set(rows.map((r) => r.scenarioId).filter(Boolean));
  for (const id of productScenarioIds) {
    if (!covered.has(id)) {
      errors.push(`${file}: shared/scenarioId.js produces "${id}" but no cell covers it`);
    }
  }
}

function readMinors(root) {
  const dir = path.join(root, "data", "scenario-support");
  if (!fs.existsSync(dir)) return null;
  const out = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    try {
      out.set(path.basename(f, ".json"), JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
    } catch (e) {
      out.set(path.basename(f, ".json"), { __parseError: e.message });
    }
  }
  return out;
}

/**
 * Scenario-surface diff between two minors — the onboarding check.
 * Returns the list of differences; an empty list means the surface is unchanged.
 */
function diffMinors(docA, docB) {
  const key = (r) => `${r.platform}/${r.method}`;
  const a = new Map((docA.matrix || []).map((r) => [key(r), r]));
  const b = new Map((docB.matrix || []).map((r) => [key(r), r]));
  const diffs = [];
  for (const [k, rb] of b) {
    const ra = a.get(k);
    if (!ra) {
      diffs.push({ cell: k, kind: "new-cell", to: rb.upstream });
      continue;
    }
    if (ra.upstream !== rb.upstream) {
      diffs.push({ cell: k, kind: "upstream-changed", from: ra.upstream, to: rb.upstream });
    }
    if (ra.oaa !== rb.oaa) {
      diffs.push({ cell: k, kind: "oaa-changed", from: ra.oaa, to: rb.oaa });
    }
  }
  for (const k of a.keys()) if (!b.has(k)) diffs.push({ cell: k, kind: "removed-cell" });
  return diffs;
}

function run(root, supportedMinors) {
  const errors = [];
  const docs = readMinors(root);
  if (!docs) {
    console.error(`Missing ${path.join(root, "data", "scenario-support")}`);
    return 1;
  }
  let productScenarioIds;
  try {
    productScenarioIds = loadScenarioIds(root);
  } catch (e) {
    console.error(`Could not read shared/scenarioId.js: ${e.message}`);
    return 1;
  }

  for (const minor of supportedMinors) {
    const doc = docs.get(minor);
    if (!doc) {
      errors.push(`supported minor ${minor} has no data/scenario-support/${minor}.json`);
      continue;
    }
    if (doc.__parseError) {
      errors.push(`${minor}.json is not valid JSON: ${doc.__parseError}`);
      continue;
    }
    if (doc.minor !== minor) errors.push(`${minor}.json declares minor "${doc.minor}"`);
    validateDoc(`${minor}.json`, doc, productScenarioIds, errors);
  }

  // Report the surface diff between consecutive supported minors. A change is
  // not an error — it is the thing onboarding must consciously disposition —
  // but it is always surfaced so it cannot pass unnoticed.
  const diffReport = [];
  for (let i = 1; i < supportedMinors.length; i += 1) {
    const [prev, cur] = [supportedMinors[i - 1], supportedMinors[i]];
    const a = docs.get(prev);
    const b = docs.get(cur);
    if (a && b && !a.__parseError && !b.__parseError) {
      for (const d of diffMinors(a, b)) {
        diffReport.push(`${prev} -> ${cur}  ${d.cell}  ${d.kind}` + (d.from ? ` (${d.from} -> ${d.to})` : ""));
      }
    }
  }

  if (errors.length) {
    console.error(`Scenario-surface guard FAILED with ${errors.length} error(s):`);
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }

  const cells = supportedMinors.reduce((n, m) => n + (docs.get(m)?.matrix?.length || 0), 0);
  console.log(
    `Scenario-surface guard OK: ${supportedMinors.length} minor(s) [${supportedMinors.join(", ")}], ${cells} ` +
      `platform x method cell(s), every cell reviewed with provenance, no modelled scenario contradicts the ` +
      `documentation, and every scenarioId the product can produce is covered.`
  );
  if (diffReport.length) {
    console.log("  scenario-surface changes across supported minors:");
    for (const d of diffReport) console.log(`    ${d}`);
  } else {
    console.log("  scenario surface is identical across all supported minors.");
  }
  return 0;
}

if (require.main === module) {
  const i = process.argv.indexOf("--root");
  const root = i !== -1 ? process.argv[i + 1] : path.resolve(__dirname, "..");
  const { getSupportedMinors } = require("./lib/supported-minors");
  getSupportedMinors()
    .then((minors) => process.exit(run(root, minors)))
    .catch((err) => {
      console.error(`Could not read the supported-minor list: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { run, validateDoc, diffMinors, loadScenarioIds, UPSTREAM, OAA, METHODS, SCHEMA_ID };
