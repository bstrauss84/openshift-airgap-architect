#!/usr/bin/env node
"use strict";

/**
 * Scenario doc mapping: list doc IDs and URLs for a given scenario from the docs-index.
 * Use for re-running scenario-by-scenario doc discovery (e.g. vSphere 4.20 IPI, then other scenarios/versions).
 *
 * Usage: node scripts/scenario-doc-mapping.js [scenarioId] [path/to/docs-index/4.20.json] [--check-urls]
 * Example: node scripts/scenario-doc-mapping.js vsphere-ipi
 *          node scripts/scenario-doc-mapping.js vsphere-ipi data/docs-index/4.20.json --check-urls
 * Default index: data/docs-index/4.20.json
 * --check-urls: fetch each doc URL (HEAD) and report status (ok/fail). Requires network.
 */

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const defaultIndexPath = path.join(repoRoot, "data", "docs-index", "4.20.json");

const args = process.argv.slice(2).filter((a) => a !== "--check-urls");
const checkUrls = process.argv.includes("--check-urls");
const scenarioId = args[0] || "vsphere-ipi";
const indexPath = args[1] || defaultIndexPath;

let data;
try {
  data = JSON.parse(fs.readFileSync(indexPath, "utf8"));
} catch (e) {
  console.error("Failed to read docs-index:", e.message);
  process.exit(1);
}

const scenarios = data.scenarios || {};
const scenario = scenarios[scenarioId];
if (!scenario) {
  console.error("Scenario not found:", scenarioId);
  console.error("Available:", Object.keys(scenarios).join(", "));
  process.exit(1);
}

const docs = scenario.docs || [];

async function checkUrl(url) {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    return res.ok ? "ok" : `HTTP ${res.status}`;
  } catch (e) {
    return `error: ${e.message}`;
  }
}

async function main() {
  console.log("Scenario:", scenarioId);
  console.log("Version:", data.version || "—");
  console.log("");
  console.log("Docs:");
  if (!checkUrls) {
    docs.forEach((doc, i) => {
      console.log(`  ${i + 1}. [${doc.id}] ${doc.title}`);
      console.log(`     ${doc.url}`);
      if (doc.notes) console.log(`     Notes: ${doc.notes}`);
      console.log("");
    });
  } else {
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const status = await checkUrl(doc.url);
      const statusStr = status === "ok" ? "ok" : "FAIL";
      console.log(`  ${i + 1}. [${doc.id}] ${doc.title}`);
      console.log(`     ${doc.url}`);
      console.log(`     Status: ${statusStr}${status !== "ok" ? " (" + status + ")" : ""}`);
      if (doc.notes) console.log(`     Notes: ${doc.notes}`);
      console.log("");
    }
  }

  if (data.sharedDocs && data.sharedDocs.length > 0 && !checkUrls) {
    console.log("Shared docs (reference; apply to multiple scenarios):");
    data.sharedDocs.slice(0, 5).forEach((doc, i) => {
      console.log(`  ${i + 1}. [${doc.id}] ${doc.title}`);
    });
    if (data.sharedDocs.length > 5) console.log(`  ... and ${data.sharedDocs.length - 5} more`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
