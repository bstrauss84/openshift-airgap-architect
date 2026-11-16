#!/usr/bin/env node
"use strict";

/**
 * Corrected parameter analysis — the false-positive filter.
 *
 * Promoted from local-docs/ocp-4.21/scripts/corrected-analysis.js (itself a
 * sed-fork of the 4.20 original; the two differ only in one directory literal).
 *
 * WHY THIS MATTERS. A raw comparison of installer-source parameters against the
 * catalogs produced a 67% false-positive rate: 340 of 502 reported gaps were
 * not gaps. Without these rules a reviewer facing a new minor either drowns or
 * rubber-stamps. The 0A-0 harvest singled this file out as the one artifact
 * whose logic must survive verbatim, so EVERY suppression rule below is carried
 * over unchanged and each is individually test-covered in
 * scripts/minor/compare/corrected-analysis.test.js.
 *
 * WHAT CHANGED IN PROMOTION (and only this):
 *   - the hardcoded `data/params/4.21` directory became --minor
 *   - the hardcoded 12-element SCENARIOS array became discovery from the
 *     catalog directory, which also fixes its silent omission of oc-mirror-v2
 *   - the implicit `../analysis` sibling became --workspace
 * No rule, regex, threshold or branch was altered.
 *
 * DOMAIN KNOWLEDGE a future reader needs (harvest; AUDIT_AUTOMATION_GUIDE.md):
 *   - Expect ~67% false positives on raw comparison. Platform applicability is
 *     the single largest source.
 *   - Catalogs may legitimately be STRICTER than Go structs. Agent scenarios
 *     require VIPs although the struct marks them optional. Not a defect.
 *   - Go type aliases serialize as primitives in YAML: AWSLBType,
 *     CloudEnvironment, ProvisioningNetwork, DiskType -> string;
 *     ipnet.IPNet -> string in CIDR notation. Catalogs describe YAML, not Go.
 *   - imageContentSources and imageDigestSources are mutually exclusive union
 *     members; their `.source` children are required only if the parent exists.
 *   - Nested-struct extraction is shallow; deep paths need manual inspection.
 *   - Conditional requiredness is not in struct tags — read validation funcs.
 *   - Runtime defaults live in pkg/asset/installconfig and are invisible here.
 *   - 100% automation is not achievable; these rules need human judgement.
 *
 * Usage:
 *   node scripts/minor/compare/corrected-analysis.js \
 *     --minor 4.22 --workspace <dir> [--catalog-root <dir>] [--out <file>]
 *
 * Reads:  <workspace>/installer-source-params.json
 *         <workspace>/agent-config-params.json
 *         <catalog-root>/<minor>/*.json      (default catalog-root: data/params)
 * Writes: --out, or <workspace>/corrected-analysis.json
 *
 * Canonical catalogs only — never the generated frontend mirror.
 * No network access.
 */

const fs = require("fs");
const path = require("path");
const { parseMinor, parseArgs, requireWorkspace, MinorArgumentError } = require("../lib/minor");

/** Strip array notation so catalog `compute[].name` matches source `compute.name`. */
function normalizePath(p) {
  return p.replace(/\[\]/g, "");
}

/**
 * RULE SET 1 — CONDITIONAL_REQUIRED.
 *
 * A nested field marked required in the Go struct is required only IF its
 * parent is present. Reporting it as a catalog requiredness mismatch is a false
 * positive. Carried over verbatim.
 */
const NESTED_REQUIRED_PATTERNS = [
  /\.(source|mirrors)$/, // imageContentSources.source, etc.
  /\.(cidr|hostPrefix)$/, // clusterNetwork.cidr, etc.
  /\.(username|password|address)$/, // BMC fields, etc.
  /\.(diskSizeGB|diskType)$/, // Azure disk fields
  /\.(iops|size|type|kmsKeyARN)$/, // AWS rootVolume fields
  /\.(subscriptionId|resourceGroup|name)$/, // Azure fields
  /\.(bootMACAddress|bmc|disableCertificateVerification)$/, // Bare metal host fields
  /\.(provisioningNetworkInterface|provisioningBridge|provisioningNetworkCIDR)$/, // Bare metal provisioning
];

function isRequiredFalsePositive(paramPath, sourceRequired, catalogRequired) {
  const normalizedPath = normalizePath(paramPath);

  if (NESTED_REQUIRED_PATTERNS.some((pattern) => pattern.test(normalizedPath))) {
    return true; // required IF parent exists
  }

  // Platform fields themselves are context-dependent (only required when doing
  // platform overrides).
  if (
    (normalizedPath === "controlPlane.platform" || normalizedPath === "compute.platform") &&
    sourceRequired &&
    !catalogRequired
  ) {
    return true;
  }

  // Platform-specific fields under controlPlane/compute are required IF that
  // platform is the one in use.
  if (normalizedPath.includes(".platform.") && sourceRequired && !catalogRequired) {
    return true;
  }

  // Array-indexed nested fields deeper than two segments are conditional.
  if (paramPath.includes("[]")) {
    const depth = normalizedPath.split(".").length;
    if (depth > 2) return true;
  }

  return false;
}

/**
 * RULE SET 2 — TYPE_REPRESENTATION / EXTERNAL_ENUMS.
 *
 * The catalog describes the YAML shape; the Go struct describes the Go shape.
 * Where they differ by representation rather than meaning, it is not a
 * mismatch. Carried over verbatim.
 */
function isTypeFalsePositive(paramPath, sourceType, catalogType, sourceGoType) {
  // CIDR: catalog "string" (YAML), source ipnet.IPNet (Go).
  if (sourceGoType === "ipnet.IPNet" && catalogType === "string") return true;

  // External enum types render as enum strings in YAML.
  if (sourceGoType?.startsWith("configv1.") && catalogType === "string") return true;

  // Capability / FeatureSet enums.
  if (
    (paramPath.includes("baselineCapabilitySet") || paramPath.includes("featureSet")) &&
    sourceType === "object" &&
    catalogType === "string"
  ) {
    return true;
  }

  // controlPlane[] array notation vs controlPlane object: notation, not type.
  if (paramPath.includes("controlPlane") && sourceType === "object" && catalogType === "array") {
    return true;
  }

  return false;
}

/**
 * RULE SET 3 — PLATFORM_SPECIFIC applicability.
 *
 * The largest single source of false positives: AWS parameters are not
 * "missing" from a vSphere catalog. Carried over verbatim, including the
 * scenario-prefix to installer-platform mapping.
 */
const PLATFORM_MAP = {
  aws: "aws",
  azure: "azure",
  bare: "baremetal",
  ibm: "ibmcloud",
  nutanix: "nutanix",
  vsphere: "vsphere",
};

function isApplicableToScenario(param, scenarioId) {
  const [platform, method] = scenarioId.split("-").slice(0, 2);
  const installMethod = scenarioId.includes("agent") ? "agent" : method;

  // agent-config parameters apply only to agent scenarios.
  if (param.outputFile === "agent-config.yaml" && installMethod !== "agent") {
    return false;
  }

  if (param.path) {
    const platformMatch = param.path.match(
      /^(platform|controlPlane\.platform|compute\.platform)\.([^.]+)/
    );
    if (platformMatch) {
      const paramPlatform = platformMatch[2];
      const expectedPlatform = PLATFORM_MAP[platform] || platform;
      // "none" is valid for all platforms.
      if (paramPlatform !== expectedPlatform && paramPlatform !== "none") {
        return false;
      }
    }
  }

  return true;
}

/** Discover scenarios from the catalog directory rather than a literal list. */
function discoverScenarios(catalogDir) {
  if (!fs.existsSync(catalogDir)) {
    throw new Error(`Catalog directory not found: ${catalogDir}`);
  }
  const scenarios = fs
    .readdirSync(catalogDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.basename(f, ".json"))
    .sort();
  if (scenarios.length === 0) {
    // Fail closed: an empty catalog set would otherwise report every parameter
    // as missing, which is how a broken directory read produced a confident
    // wrong answer during 4.21.
    throw new Error(`No catalog files found in ${catalogDir}`);
  }
  return scenarios;
}

function loadJson(file, label) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${label}: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

/**
 * Run the corrected analysis.
 * @returns {object} summary, identical in shape to the harvested script's output
 */
function correctedAnalysis({ minor, workspace, catalogRoot }) {
  const catalogDir = path.join(catalogRoot, minor);
  const scenarios = discoverScenarios(catalogDir);

  const sourceParams = loadJson(
    path.join(workspace, "installer-source-params.json"),
    "installer-source extraction"
  );
  const agentParams = loadJson(
    path.join(workspace, "agent-config-params.json"),
    "agent-config extraction"
  );

  const correctedAnalysisByScenario = {};

  for (const scenarioId of scenarios) {
    const catalogPath = path.join(catalogDir, `${scenarioId}.json`);
    const catalog = fs.existsSync(catalogPath)
      ? JSON.parse(fs.readFileSync(catalogPath, "utf-8"))
      : { parameters: [] };
    const catalogParams = catalog.parameters || [];

    const catalogNormalizedPaths = new Set(catalogParams.map((p) => normalizePath(p.path)));

    const applicableSourceParams = [];
    for (const param of sourceParams.parameters) {
      if (isApplicableToScenario(param, scenarioId)) {
        applicableSourceParams.push({ ...param, source: "InstallConfig" });
      }
    }
    if (scenarioId.includes("agent")) {
      for (const param of agentParams.parameters) {
        applicableSourceParams.push({ ...param, source: "AgentConfig" });
      }
    }

    // REAL missing parameters (high confidence).
    const realMissing = applicableSourceParams.filter((param) => {
      const normalized = normalizePath(param.path);
      if (catalogNormalizedPaths.has(normalized)) return false;

      // Deprecated fields are intentionally excluded from catalogs.
      if (param.field && param.field.includes("Deprecated")) return false;
      if (param.description && param.description.includes("Deprecated")) return false;

      // Orphan-nested: if the parent is absent from the catalog, the child is
      // expected to be absent too.
      if (param.path.split(".").length > 2) {
        const parentPath = param.path.split(".").slice(0, -1).join(".");
        if (!catalogNormalizedPaths.has(normalizePath(parentPath))) return false;
      }

      return true;
    });

    // REAL metadata discrepancies (filtered).
    const realDiscrepancies = [];
    for (const catalogParam of catalogParams) {
      const normalized = normalizePath(catalogParam.path);
      const sourceParam = applicableSourceParams.find(
        (sp) => normalizePath(sp.path) === normalized
      );
      if (!sourceParam) continue;

      const issues = [];

      if (catalogParam.required !== sourceParam.required && sourceParam.required !== undefined) {
        if (
          !isRequiredFalsePositive(catalogParam.path, sourceParam.required, catalogParam.required)
        ) {
          issues.push({
            field: "required",
            catalogValue: catalogParam.required,
            sourceValue: sourceParam.required,
            confidence: "medium",
          });
        }
      }

      if (catalogParam.type && sourceParam.type) {
        const catalogType = catalogParam.type.toLowerCase();
        const sourceType = sourceParam.type.toLowerCase();
        if (catalogType !== sourceType && catalogType !== "unknown" && sourceType !== "unknown") {
          if (!isTypeFalsePositive(catalogParam.path, sourceType, catalogType, sourceParam.goType)) {
            issues.push({
              field: "type",
              catalogValue: catalogParam.type,
              sourceValue: sourceParam.type,
              goType: sourceParam.goType,
              confidence: "low",
            });
          }
        }
      }

      if (issues.length > 0) {
        realDiscrepancies.push({ path: catalogParam.path, issues });
      }
    }

    const catalogOnly = catalogParams.filter((catalogParam) => {
      const normalized = normalizePath(catalogParam.path);
      return !applicableSourceParams.some((sp) => normalizePath(sp.path) === normalized);
    });

    correctedAnalysisByScenario[scenarioId] = {
      totalInCatalog: catalogParams.length,
      totalApplicableFromSource: applicableSourceParams.length,
      realMissing: realMissing.length,
      realDiscrepancies: realDiscrepancies.length,
      catalogOnly: catalogOnly.length,
      details: {
        missingHighConfidence: realMissing
          .filter((p) => !p.path.includes(".platform.") || p.path.split(".").length <= 3)
          .slice(0, 20),
        discrepanciesHighConfidence: realDiscrepancies.filter((d) =>
          d.issues.some((i) => i.confidence === "high" || i.confidence === "medium")
        ),
        catalogOnlyParams: catalogOnly.map((p) => ({
          path: p.path,
          type: p.type,
          required: p.required,
        })),
      },
    };
  }

  return {
    timestamp: new Date().toISOString(),
    minor,
    note: "FALSE POSITIVES FILTERED - High confidence issues only",
    filteringApplied: {
      requiredFilters: [
        "Nested fields (required IF parent exists)",
        "Platform-specific fields (context-dependent)",
        "imageContentSources.source and imageDigestSources.source (conditional)",
      ],
      typeFilters: [
        "CIDR notation (string in YAML, ipnet.IPNet in Go)",
        "External enums (configv1.* types)",
        "Array notation differences (controlPlane[] vs controlPlane object)",
      ],
      applicabilityFilters: [
        "Platform-specific params (AWS params not flagged missing from vSphere)",
        "Platform-specific params in controlPlane/compute",
        "Install method-specific (agent-config params only for agent scenarios)",
        "Deprecated fields",
      ],
    },
    scenariosAnalyzed: scenarios,
    totalRealMissing: Object.values(correctedAnalysisByScenario).reduce(
      (sum, s) => sum + s.realMissing,
      0
    ),
    totalRealDiscrepancies: Object.values(correctedAnalysisByScenario).reduce(
      (sum, s) => sum + s.realDiscrepancies,
      0
    ),
    totalCatalogOnly: Object.values(correctedAnalysisByScenario).reduce(
      (sum, s) => sum + s.catalogOnly,
      0
    ),
    byScenario: correctedAnalysisByScenario,
  };
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  let minor;
  let workspace;
  try {
    minor = parseMinor(flags.minor, "--minor");
    workspace = requireWorkspace(flags);
  } catch (err) {
    if (err instanceof MinorArgumentError) {
      console.error(`corrected-analysis: ${err.message}`);
      console.error(
        "\nUsage: node scripts/minor/compare/corrected-analysis.js --minor <X.Y> --workspace <dir> " +
          "[--catalog-root <dir>] [--out <file>]"
      );
      process.exit(1);
    }
    throw err;
  }

  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const catalogRoot = flags["catalog-root"]
    ? path.resolve(String(flags["catalog-root"]))
    : path.join(repoRoot, "data", "params");

  let summary;
  try {
    summary = correctedAnalysis({ minor, workspace, catalogRoot });
  } catch (err) {
    console.error(`corrected-analysis: ${err.message}`);
    process.exit(1);
  }

  const outPath = flags.out
    ? path.resolve(String(flags.out))
    : path.join(workspace, "corrected-analysis.json");
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

  console.log(`Corrected analysis for ${minor} (false positives filtered)`);
  console.log(`  scenarios analysed   : ${summary.scenariosAnalyzed.length}`);
  console.log(`  real missing         : ${summary.totalRealMissing}`);
  console.log(`  real discrepancies   : ${summary.totalRealDiscrepancies}`);
  console.log(`  catalog-only         : ${summary.totalCatalogOnly}`);
  console.log(`  written to           : ${outPath}`);
  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  correctedAnalysis,
  isRequiredFalsePositive,
  isTypeFalsePositive,
  isApplicableToScenario,
  normalizePath,
  discoverScenarios,
  NESTED_REQUIRED_PATTERNS,
  PLATFORM_MAP,
};
