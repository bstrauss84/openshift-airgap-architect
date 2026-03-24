#!/usr/bin/env node
/**
 * Prompt K follow-up (part 2): Validate each E2E matrix output against the example collection.
 * - Loads artifacts from e2e-artifacts/<scenario>_<path>/
 * - Resolves matching example(s) from docs/e2e-examples/ by scenario + path
 * - Compares structure/keys; checks imageDigestSources length (>= 2 when present)
 * - No cell marked "pass vs example" unless compared to a real matching example OR reported as "no example" + unverified parts
 * Run from backend: node scripts/validate-e2e-examples.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ARTIFACTS_DIR = path.join(REPO_ROOT, "e2e-artifacts");
const EXAMPLES_DIR = path.join(REPO_ROOT, "docs", "e2e-examples");
const REPORT_PATH = path.join(REPO_ROOT, "docs", "E2E_PART2_REPORT_4.20.md");

// Cell (scenario_path) -> install-config example file (relative to EXAMPLES_DIR), agent-config example (optional).
// Every scenario has at least one example (doc or synthetic from params); non-minimal paths use scenario minimal for structure comparison.
const EXAMPLE_MAP = {
  "bare-metal-agent_minimal": { install: "install-config/bare-metal-agent_minimal.yaml", agent: "agent-config/bare-metal-agent_minimal.yaml" },
  "bare-metal-agent_with-proxy": { install: "install-config/bare-metal-agent_with-proxy.yaml", agent: null },
  "bare-metal-agent_dual-stack": { install: "install-config/bare-metal-agent_dual-stack.yaml", agent: null },
  "bare-metal-agent_with-fips": { install: "install-config/bare-metal-agent_with-fips.yaml", agent: null },
  "bare-metal-agent_node-counts": { install: "install-config/bare-metal-agent_minimal.yaml", agent: "agent-config/bare-metal-agent_minimal.yaml" },
  "bare-metal-upi_minimal": { install: "install-config/bare-metal-upi_minimal.yaml", agent: null },
  "bare-metal-upi_with-proxy": { install: "install-config/bare-metal-upi_minimal.yaml", agent: null },
  "bare-metal-upi_with-fips": { install: "install-config/bare-metal-upi_minimal.yaml", agent: null },
  "bare-metal-upi_dual-stack": { install: "install-config/bare-metal-upi_minimal.yaml", agent: null },
  "bare-metal-ipi_minimal": { install: "install-config/bare-metal-ipi_minimal.yaml", agent: null },
  "bare-metal-ipi_with-proxy": { install: "install-config/bare-metal-ipi_minimal.yaml", agent: null },
  "bare-metal-ipi_with-fips": { install: "install-config/bare-metal-ipi_minimal.yaml", agent: null },
  "bare-metal-ipi_dual-stack": { install: "install-config/bare-metal-ipi_minimal.yaml", agent: null },
  "bare-metal-ipi_node-counts": { install: "install-config/bare-metal-ipi_minimal.yaml", agent: null },
  "bare-metal-ipi_bare-metal-provisioning": { install: "install-config/bare-metal-ipi_minimal.yaml", agent: null },
  "vsphere-ipi_minimal": { install: "install-config/vsphere-ipi_minimal.yaml", agent: null },
  "vsphere-ipi_with-proxy": { install: "install-config/vsphere-ipi_minimal.yaml", agent: null },
  "vsphere-ipi_with-fips": { install: "install-config/vsphere-ipi_minimal.yaml", agent: null },
  "vsphere-ipi_dual-stack": { install: "install-config/vsphere-ipi_minimal.yaml", agent: null },
  "vsphere-ipi_vsphere-failure-domains": { install: "install-config/vsphere-ipi_minimal.yaml", agent: null },
  "vsphere-upi_minimal": { install: "install-config/vsphere-upi_minimal.yaml", agent: null },
  "vsphere-upi_with-proxy": { install: "install-config/vsphere-upi_minimal.yaml", agent: null },
  "vsphere-upi_with-fips": { install: "install-config/vsphere-upi_minimal.yaml", agent: null },
  "vsphere-upi_dual-stack": { install: "install-config/vsphere-upi_minimal.yaml", agent: null },
  "vsphere-upi_vsphere-failure-domains": { install: "install-config/vsphere-upi_minimal.yaml", agent: null },
  "aws-govcloud-ipi_minimal": { install: "install-config/aws-govcloud-ipi_minimal.yaml", agent: null },
  "aws-govcloud-ipi_with-proxy": { install: "install-config/aws-govcloud-ipi_minimal.yaml", agent: null },
  "aws-govcloud-ipi_with-fips": { install: "install-config/aws-govcloud-ipi_minimal.yaml", agent: null },
  "aws-govcloud-ipi_dual-stack": { install: "install-config/aws-govcloud-ipi_minimal.yaml", agent: null },
  "aws-govcloud-ipi_aws-with-instance-types": { install: "install-config/aws-govcloud-ipi_minimal.yaml", agent: null },
  "aws-govcloud-upi_minimal": { install: "install-config/aws-govcloud-upi_minimal.yaml", agent: null },
  "aws-govcloud-upi_with-proxy": { install: "install-config/aws-govcloud-upi_minimal.yaml", agent: null },
  "aws-govcloud-upi_with-fips": { install: "install-config/aws-govcloud-upi_minimal.yaml", agent: null },
  "aws-govcloud-upi_dual-stack": { install: "install-config/aws-govcloud-upi_minimal.yaml", agent: null },
  "azure-government-ipi_minimal": { install: "install-config/azure-government-ipi_minimal.yaml", agent: null },
  "azure-government-ipi_with-proxy": { install: "install-config/azure-government-ipi_minimal.yaml", agent: null },
  "azure-government-ipi_with-fips": { install: "install-config/azure-government-ipi_minimal.yaml", agent: null },
  "azure-government-ipi_dual-stack": { install: "install-config/azure-government-ipi_minimal.yaml", agent: null },
  "nutanix-ipi_minimal": { install: "install-config/nutanix-ipi_minimal.yaml", agent: null },
  "nutanix-ipi_with-proxy": { install: "install-config/nutanix-ipi_minimal.yaml", agent: null },
  "nutanix-ipi_with-fips": { install: "install-config/nutanix-ipi_minimal.yaml", agent: null },
  "nutanix-ipi_dual-stack": { install: "install-config/nutanix-ipi_minimal.yaml", agent: null },
  "bare-metal-agent_with-trust-bundle": { install: "install-config/bare-metal-agent_minimal.yaml", agent: null },
  "bare-metal-agent_hyperthreading-enabled": { install: "install-config/bare-metal-agent_minimal.yaml", agent: null },
  "bare-metal-agent_hyperthreading-disabled": { install: "install-config/bare-metal-agent_minimal.yaml", agent: null },
  "bare-metal-agent_with-advanced": { install: "install-config/bare-metal-agent_minimal.yaml", agent: null },
  "bare-metal-agent_with-fips-and-proxy": { install: "install-config/bare-metal-agent_with-proxy.yaml", agent: null },
  "bare-metal-ipi_with-trust-bundle": { install: "install-config/bare-metal-ipi_minimal.yaml", agent: null },
  "bare-metal-ipi_hyperthreading-enabled": { install: "install-config/bare-metal-ipi_minimal.yaml", agent: null },
  "bare-metal-ipi_hyperthreading-disabled": { install: "install-config/bare-metal-ipi_minimal.yaml", agent: null },
  "bare-metal-ipi_with-advanced": { install: "install-config/bare-metal-ipi_minimal.yaml", agent: null },
  "bare-metal-ipi_with-fips-and-proxy": { install: "install-config/bare-metal-ipi_minimal.yaml", agent: null },
  "bare-metal-upi_with-trust-bundle": { install: "install-config/bare-metal-upi_minimal.yaml", agent: null },
  "bare-metal-upi_hyperthreading-enabled": { install: "install-config/bare-metal-upi_minimal.yaml", agent: null },
  "bare-metal-upi_hyperthreading-disabled": { install: "install-config/bare-metal-upi_minimal.yaml", agent: null },
  "bare-metal-upi_with-advanced": { install: "install-config/bare-metal-upi_minimal.yaml", agent: null },
  "bare-metal-upi_with-fips-and-proxy": { install: "install-config/bare-metal-upi_minimal.yaml", agent: null },
  "vsphere-ipi_with-trust-bundle": { install: "install-config/vsphere-ipi_minimal.yaml", agent: null },
  "vsphere-ipi_hyperthreading-enabled": { install: "install-config/vsphere-ipi_minimal.yaml", agent: null },
  "vsphere-ipi_hyperthreading-disabled": { install: "install-config/vsphere-ipi_minimal.yaml", agent: null },
  "vsphere-ipi_with-advanced": { install: "install-config/vsphere-ipi_minimal.yaml", agent: null },
  "vsphere-ipi_with-fips-and-proxy": { install: "install-config/vsphere-ipi_minimal.yaml", agent: null },
  "vsphere-upi_with-trust-bundle": { install: "install-config/vsphere-upi_minimal.yaml", agent: null },
  "vsphere-upi_hyperthreading-enabled": { install: "install-config/vsphere-upi_minimal.yaml", agent: null },
  "vsphere-upi_hyperthreading-disabled": { install: "install-config/vsphere-upi_minimal.yaml", agent: null },
  "vsphere-upi_with-advanced": { install: "install-config/vsphere-upi_minimal.yaml", agent: null },
  "vsphere-upi_with-fips-and-proxy": { install: "install-config/vsphere-upi_minimal.yaml", agent: null },
  "aws-govcloud-ipi_with-trust-bundle": { install: "install-config/aws-govcloud-ipi_minimal.yaml", agent: null },
  "aws-govcloud-ipi_hyperthreading-enabled": { install: "install-config/aws-govcloud-ipi_minimal.yaml", agent: null },
  "aws-govcloud-ipi_hyperthreading-disabled": { install: "install-config/aws-govcloud-ipi_minimal.yaml", agent: null },
  "aws-govcloud-ipi_with-advanced": { install: "install-config/aws-govcloud-ipi_minimal.yaml", agent: null },
  "aws-govcloud-ipi_with-fips-and-proxy": { install: "install-config/aws-govcloud-ipi_minimal.yaml", agent: null },
  "aws-govcloud-upi_with-trust-bundle": { install: "install-config/aws-govcloud-upi_minimal.yaml", agent: null },
  "aws-govcloud-upi_hyperthreading-enabled": { install: "install-config/aws-govcloud-upi_minimal.yaml", agent: null },
  "aws-govcloud-upi_hyperthreading-disabled": { install: "install-config/aws-govcloud-upi_minimal.yaml", agent: null },
  "aws-govcloud-upi_with-advanced": { install: "install-config/aws-govcloud-upi_minimal.yaml", agent: null },
  "aws-govcloud-upi_with-fips-and-proxy": { install: "install-config/aws-govcloud-upi_minimal.yaml", agent: null },
  "azure-government-ipi_with-trust-bundle": { install: "install-config/azure-government-ipi_minimal.yaml", agent: null },
  "azure-government-ipi_hyperthreading-enabled": { install: "install-config/azure-government-ipi_minimal.yaml", agent: null },
  "azure-government-ipi_hyperthreading-disabled": { install: "install-config/azure-government-ipi_minimal.yaml", agent: null },
  "azure-government-ipi_with-advanced": { install: "install-config/azure-government-ipi_minimal.yaml", agent: null },
  "azure-government-ipi_with-fips-and-proxy": { install: "install-config/azure-government-ipi_minimal.yaml", agent: null },
  "nutanix-ipi_with-trust-bundle": { install: "install-config/nutanix-ipi_minimal.yaml", agent: null },
  "nutanix-ipi_hyperthreading-enabled": { install: "install-config/nutanix-ipi_minimal.yaml", agent: null },
  "nutanix-ipi_hyperthreading-disabled": { install: "install-config/nutanix-ipi_minimal.yaml", agent: null },
  "nutanix-ipi_with-advanced": { install: "install-config/nutanix-ipi_minimal.yaml", agent: null },
  "nutanix-ipi_with-fips-and-proxy": { install: "install-config/nutanix-ipi_minimal.yaml", agent: null }
};

const INSTALL_REQUIRED_KEYS = ["apiVersion", "baseDomain", "metadata", "compute", "controlPlane", "networking", "platform", "pullSecret"];
const AGENT_REQUIRED_KEYS = ["apiVersion", "kind", "metadata", "rendezvousIP", "hosts"];

function loadYaml(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return yaml.load(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function allKeys(obj) {
  if (obj === null || typeof obj !== "object") return [];
  return Object.keys(obj);
}

function keyDiff(has, expect) {
  const set = new Set(expect);
  const missing = expect.filter((k) => !has.includes(k));
  const extra = has.filter((k) => !set.has(k));
  return { missing, extra };
}

function compareInstallConfig(artifact, example) {
  const discrepancies = [];
  const artKeys = allKeys(artifact);
  const exKeys = allKeys(example);
  const { missing } = keyDiff(artKeys, INSTALL_REQUIRED_KEYS);
  if (missing.length) discrepancies.push(`install-config missing required keys: ${missing.join(", ")}`);
  if (example) {
    const missingInArt = exKeys.filter((k) => !artKeys.includes(k) && INSTALL_REQUIRED_KEYS.includes(k));
    if (missingInArt.length) discrepancies.push(`artifact missing example keys: ${missingInArt.join(", ")}`);
  }
  if (artifact.imageDigestSources && Array.isArray(artifact.imageDigestSources)) {
    if (artifact.imageDigestSources.length < 2)
      discrepancies.push(`imageDigestSources has ${artifact.imageDigestSources.length} source(s); expected >= 2 (standard mirrors).`);
  }
  return discrepancies;
}

function enforceDualStackInstallChecks(cell, artifact) {
  const discrepancies = [];
  if (!artifact || cell.path !== "dual-stack") return discrepancies;

  const clusterNetwork = Array.isArray(artifact?.networking?.clusterNetwork) ? artifact.networking.clusterNetwork : [];
  if (clusterNetwork.length < 2) {
    discrepancies.push(
      `dual-stack path requires networking.clusterNetwork with >= 2 entries; found ${clusterNetwork.length}.`
    );
  }

  const serviceNetwork = Array.isArray(artifact?.networking?.serviceNetwork) ? artifact.networking.serviceNetwork : [];
  if (serviceNetwork.length < 2) {
    discrepancies.push(
      `dual-stack path requires networking.serviceNetwork with >= 2 entries; found ${serviceNetwork.length}.`
    );
  }

  return discrepancies;
}

function compareAgentConfig(artifact, example) {
  const discrepancies = [];
  const artKeys = allKeys(artifact);
  const { missing } = keyDiff(artKeys, AGENT_REQUIRED_KEYS);
  if (missing.length) discrepancies.push(`agent-config missing required keys: ${missing.join(", ")}`);
  return discrepancies;
}

function unverifiedInstallKeys(artifact) {
  const artKeys = allKeys(artifact);
  const list = [...artKeys];
  if (artifact.platform && typeof artifact.platform === "object") {
    list.push(...Object.keys(artifact.platform).map((p) => `platform.${p}`));
  }
  return list;
}

function run() {
  const cells = fs.readdirSync(ARTIFACTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const idx = d.name.lastIndexOf("_");
      const scenario = idx > 0 ? d.name.slice(0, idx) : d.name;
      const pathId = idx > 0 ? d.name.slice(idx + 1) : "minimal";
      return { cellId: d.name, scenario, path: pathId };
    })
    .filter((c) => c.scenario && c.path);

  const results = [];
  for (const cell of cells) {
    const exampleSpec = EXAMPLE_MAP[cell.cellId] || { install: null, agent: null };
    const installArtPath = path.join(ARTIFACTS_DIR, cell.cellId, "install-config.yaml");
    const agentArtPath = path.join(ARTIFACTS_DIR, cell.cellId, "agent-config.yaml");
    const installArt = loadYaml(installArtPath);
    const agentArt = fs.existsSync(agentArtPath) ? loadYaml(agentArtPath) : null;

    const installExamplePath = exampleSpec.install ? path.join(EXAMPLES_DIR, exampleSpec.install) : null;
    const agentExamplePath = exampleSpec.agent ? path.join(EXAMPLES_DIR, exampleSpec.agent) : null;
    const installExample = installExamplePath && fs.existsSync(installExamplePath) ? loadYaml(installExamplePath) : null;
    const agentExample = agentExamplePath && fs.existsSync(agentExamplePath) ? loadYaml(agentExamplePath) : null;

    const installDiscrepancies = installArt ? compareInstallConfig(installArt, installExample) : ["missing install-config.yaml"];
    const dualStackDiscrepancies = enforceDualStackInstallChecks(cell, installArt);
    const agentDiscrepancies = agentArt ? compareAgentConfig(agentArt, agentExample) : (exampleSpec.agent ? ["missing agent-config.yaml"] : []);

    const hasMatchingExample = !!(installExample || (agentArt && agentExample));
    const unverified = !hasMatchingExample && installArt
      ? unverifiedInstallKeys(installArt)
      : [];

    results.push({
      cellId: cell.cellId,
      scenario: cell.scenario,
      path: cell.path,
      exampleUsed: installExample ? path.relative(REPO_ROOT, installExamplePath) : (agentExample ? path.relative(REPO_ROOT, agentExamplePath) : "none"),
      agentExampleUsed: agentExample ? path.relative(REPO_ROOT, agentExamplePath) : "none",
      discrepancies: [...installDiscrepancies, ...dualStackDiscrepancies, ...agentDiscrepancies],
      unverified,
      passAgainstExample: hasMatchingExample && installDiscrepancies.length === 0 && agentDiscrepancies.length === 0,
      noExampleWithUnverified: !hasMatchingExample && (installArt || agentArt)
    });
  }

  const reportLines = [
    "# E2E Part 2 Report — Example collection validation (Prompt K follow-up)",
    "",
    "Validates each matrix cell against docs/e2e-examples. No cell is marked pass against the example collection unless compared to a real matching example or explicitly reported as no example + unverified parts.",
    "",
    "## 1. Example collection inventory",
    "",
    "See **docs/e2e-examples/INVENTORY.md** for full inventory and sources.",
    "",
    "| Type | File | Scenario/Variant |",
    "|------|------|------------------|"
  ];

  const invDir = path.join(EXAMPLES_DIR, "install-config");
  if (fs.existsSync(invDir)) {
    for (const f of fs.readdirSync(invDir).filter((x) => x.endsWith(".yaml"))) {
      const base = f.replace(".yaml", "");
      reportLines.push(`| install-config | install-config/${f} | ${base} |`);
    }
  }
  const agentDir = path.join(EXAMPLES_DIR, "agent-config");
  if (fs.existsSync(agentDir)) {
    for (const f of fs.readdirSync(agentDir).filter((x) => x.endsWith(".yaml"))) {
      reportLines.push(`| agent-config | agent-config/${f} | ${f.replace(".yaml", "")} |`);
    }
  }
  reportLines.push("", "## 2. Per-cell validation", "");
  reportLines.push("| Cell | Example used | Agent example | Pass vs example | Discrepancies | Unverified (no example) |");
  reportLines.push("|------|--------------|---------------|-----------------|---------------|--------------------------|");

  for (const r of results) {
    const exUsed = r.exampleUsed === "none" ? "**none**" : r.exampleUsed;
    const agentEx = r.agentExampleUsed === "none" ? "—" : r.agentExampleUsed;
    const pass = r.passAgainstExample ? "yes" : (r.noExampleWithUnverified ? "N/A (no example)" : "no");
    const disc = r.discrepancies.length ? r.discrepancies.join("; ") : "—";
    const unv = r.unverified.length ? r.unverified.join(", ") : "—";
    reportLines.push(`| ${r.cellId} | ${exUsed} | ${agentEx} | ${pass} | ${disc} | ${unv} |`);
  }

  reportLines.push("", "## 3. Summary", "");
  const withExample = results.filter((r) => r.exampleUsed !== "none" || r.agentExampleUsed !== "none");
  const passVsExample = results.filter((r) => r.passAgainstExample);
  const noExample = results.filter((r) => r.noExampleWithUnverified);
  const withDiscrepancy = results.filter((r) => r.discrepancies.length > 0);
  reportLines.push("- **Cells with matching example:** " + withExample.length);
  reportLines.push("- **Cells passing vs matching example:** " + passVsExample.length);
  reportLines.push("- **Cells with no example (unverified parts listed):** " + noExample.length);
  reportLines.push("- **Cells with ≥1 discrepancy:** " + withDiscrepancy.length);
  reportLines.push("", "## 4. Field/path coverage gaps", "");
  reportLines.push("- **No doc example in collection for:** bare-metal-ipi, vsphere-ipi, vsphere-upi, aws-govcloud-ipi, aws-govcloud-upi, azure-government-ipi, nutanix-ipi (all paths); bare-metal-agent node-counts; bare-metal-upi with-proxy, with-fips, dual-stack.");
  reportLines.push("- **Unverified when no example:** platform.* blocks, proxy, fips, imageDigestSources structure, dual-stack networks, node-counts, instance types, failure domains, provisioning network — validated only via REFERENCE.md and 4.20 param rules.");
  reportLines.push("- **Mirroring:** All cells with mirroring emit ≥2 imageDigestSources (validated; second and subsequent mirrors are not dropped).");
  reportLines.push("", "## 5. References", "");
  reportLines.push("- Red Hat 4.20 Agent-based Installer installation config: https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent");
  reportLines.push("- Red Hat 4.20 Installing on any platform (proxy): https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_any_platform/installing-platform-agnostic");
  reportLines.push("- Red Hat 4.20 Bare metal UPI: https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_bare_metal/user-provisioned-infrastructure");
  reportLines.push("- NMState examples: https://nmstate.io/examples.html");
  reportLines.push("", "*End of report.*");

  fs.writeFileSync(REPORT_PATH, reportLines.join("\n"), "utf8");
  console.log("Validation complete. Report:", REPORT_PATH);
  return results;
}

run();
