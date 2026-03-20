/**
 * Read-only catalog path lookup for Host Inventory v2 compare-mode annotations.
 * Uses frontend copies from frontend/src/data/catalogs/ (synced from data/params/<version>/).
 * See docs/DATA_AND_FRONTEND_COPIES.md.
 */

import bareMetalAgentCatalog from "./data/catalogs/bare-metal-agent.json";
import bareMetalIpiCatalog from "./data/catalogs/bare-metal-ipi.json";
import bareMetalUpiCatalog from "./data/catalogs/bare-metal-upi.json";
import vsphereIpiCatalog from "./data/catalogs/vsphere-ipi.json";
import vsphereUpiCatalog from "./data/catalogs/vsphere-upi.json";
import awsGovcloudIpiCatalog from "./data/catalogs/aws-govcloud-ipi.json";
import awsGovcloudUpiCatalog from "./data/catalogs/aws-govcloud-upi.json";
import azureGovernmentIpiCatalog from "./data/catalogs/azure-government-ipi.json";
import nutanixIpiCatalog from "./data/catalogs/nutanix-ipi.json";
import vsphereAgentCatalog from "./data/catalogs/vsphere-agent.json";

const CATALOGS = {
  "bare-metal-agent": bareMetalAgentCatalog,
  "bare-metal-ipi": bareMetalIpiCatalog,
  "bare-metal-upi": bareMetalUpiCatalog,
  "vsphere-agent": vsphereAgentCatalog,
  "vsphere-ipi": vsphereIpiCatalog,
  "vsphere-upi": vsphereUpiCatalog,
  "aws-govcloud-ipi": awsGovcloudIpiCatalog,
  "aws-govcloud-upi": awsGovcloudUpiCatalog,
  "azure-government-ipi": azureGovernmentIpiCatalog,
  "nutanix-ipi": nutanixIpiCatalog
};

/**
 * Returns the full parameters array for the given scenario (from frontend catalog copies).
 * @param {string|null} scenarioId - e.g. "bare-metal-agent", "bare-metal-ipi"
 * @returns {object[]} parameters array; empty array when scenario unknown or no parameters
 */
export function getCatalogForScenario(scenarioId) {
  const catalog = scenarioId ? CATALOGS[scenarioId] : null;
  const parameters = catalog?.parameters;
  return Array.isArray(parameters) ? parameters : [];
}

/**
 * Returns the set of parameter paths that exist in the catalog for the given scenario.
 * @param {string|null} scenarioId - e.g. "bare-metal-agent", "bare-metal-ipi"
 * @returns {Set<string>} set of path strings
 */
export function getCatalogPaths(scenarioId) {
  const parameters = getCatalogForScenario(scenarioId);
  if (!parameters.length) return new Set();
  return new Set(parameters.map((p) => p.path));
}
