#!/usr/bin/env node
"use strict";

/**
 * Docs-index discovery: for a given version (and optional platform), output suggested
 * doc tree (IDs, path segments, URLs) for the OpenShift install docs on docs.redhat.com.
 * Use when adding a new scenario or version to know which URLs to map. Manual review
 * before merging into data/docs-index/<version>.json.
 *
 * Usage: node scripts/docs-index-discovery.js [version] [platform]
 * Example: node scripts/docs-index-discovery.js 4.20 vsphere
 * Defaults: version=4.20, platform=all (print all known path segments).
 *
 * Canonical source: https://docs.redhat.com/en/documentation/openshift_container_platform/<version>/
 */

const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const version = process.argv[2] || "4.20";
const platform = process.argv[3] || "all";

const baseUrl = `https://docs.redhat.com/en/documentation/openshift_container_platform/${version}/`;

// Known install-book path segments (html) for discovery. Keys are labels; value is path segment under baseUrl.
const KNOWN_SECTIONS = {
  vsphere: [
    { id: "installing-on-vmware-vsphere", path: "html/installing_on_vmware_vsphere/", title: "Installing on VMware vSphere" },
    { id: "installer-provisioned-infrastructure", path: "html/installing_on_vmware_vsphere/installer-provisioned-infrastructure", title: "Installer-provisioned infrastructure (vSphere IPI)" },
    { id: "installation-config-parameters-vsphere", path: "html/installing_on_vmware_vsphere/installation-config-parameters-vsphere", title: "Installation configuration parameters for vSphere" },
    { id: "preparing-to-install-vsphere", path: "html/installing_on_vmware_vsphere/preparing-to-install-on-vsphere", title: "Preparing to install on vSphere" }
  ],
  "bare-metal-agent": [
    { id: "installing-agent-based-installer", path: "html/installing_an_on-premise_cluster_with_the_agent-based_installer/", title: "Installing a cluster with the Agent-based Installer" },
    { id: "installation-config-parameters-agent", path: "html/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent", title: "Installation configuration parameters for the Agent-based Installer" }
  ],
  "aws-govcloud": [
    { id: "installing-aws-govcloud", path: "html/installing_on_aws_govcloud/", title: "Installing on AWS GovCloud" }
  ],
  shared: [
    { id: "disconnected-environments", path: "html/disconnected_environments/index", title: "Installing a cluster on disconnected infrastructure" },
    { id: "installing-platform-agnostic", path: "html/installing_on_any_platform/", title: "Installing a cluster (platform-agnostic)" }
  ]
};

function main() {
  console.log("Docs-index discovery");
  console.log("Version:", version);
  console.log("Base URL:", baseUrl);
  console.log("Platform filter:", platform);
  console.log("");

  const toPrint = [];
  if (platform === "all") {
    Object.entries(KNOWN_SECTIONS).forEach(([key, entries]) => {
      entries.forEach((e) => toPrint.push({ ...e, group: key }));
    });
  } else if (KNOWN_SECTIONS[platform]) {
    KNOWN_SECTIONS[platform].forEach((e) => toPrint.push({ ...e, group: platform }));
    if (platform !== "shared") {
      KNOWN_SECTIONS.shared.forEach((e) => toPrint.push({ ...e, group: "shared" }));
    }
  } else {
    console.error("Unknown platform. Use: all, vsphere, bare-metal-agent, aws-govcloud.");
    process.exit(1);
  }

  console.log("Suggested doc tree (manual review before merging into docs-index):");
  console.log("");
  toPrint.forEach((e, i) => {
    const url = e.path.startsWith("http") ? e.path : baseUrl + e.path.replace(/\/$/, "");
    console.log(`${i + 1}. [${e.id}]`);
    console.log(`   Title: ${e.title}`);
    console.log(`   URL: ${url}`);
    console.log("");
  });

  console.log("Next steps:");
  console.log("  1. Open each URL in a browser and confirm it exists for this version.");
  console.log("  2. Add or update entries in data/docs-index/" + version + ".json.");
  console.log("  3. Run: node scripts/validate-docs-index.js");
  console.log("  4. Optionally run: node scripts/scenario-doc-mapping.js <scenarioId> --check-urls");
}

main();
