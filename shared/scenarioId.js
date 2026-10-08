/**
 * Canonical scenario-id resolution: (platform label, install method) -> scenarioId.
 *
 * This mapping already existed in `frontend/src/hostInventoryV2Helpers.js` and had
 * no backend counterpart, because until now only the UI needed it. The generation
 * boundary needs it too (to consult the D3 architecture matrix, which is keyed by
 * scenario), and duplicating a platform/method table is exactly what the
 * architecture work has been removing. So the implementation moved here and the
 * frontend helper delegates — one table, two consumers.
 *
 * The twelve ids are the canonical scenario set: the same set that keys
 * `data/params/<minor>/*.json` and `data/arch-support/<minor>.json`.
 *
 * Returns null for any combination the product does not model. Callers must treat
 * null as "not a modelled scenario", never as a default.
 */

const SCENARIO_BY_PLATFORM_METHOD = Object.freeze({
  "Bare Metal": Object.freeze({
    "Agent-Based Installer": "bare-metal-agent",
    IPI: "bare-metal-ipi",
    UPI: "bare-metal-upi",
  }),
  "VMware vSphere": Object.freeze({
    "Agent-Based Installer": "vsphere-agent",
    IPI: "vsphere-ipi",
    UPI: "vsphere-upi",
  }),
  "AWS GovCloud": Object.freeze({
    IPI: "aws-govcloud-ipi",
    UPI: "aws-govcloud-upi",
  }),
  "Azure Government": Object.freeze({
    IPI: "azure-government-ipi",
    UPI: "azure-government-upi",
  }),
  "IBM Cloud": Object.freeze({ IPI: "ibm-cloud-ipi" }),
  Nutanix: Object.freeze({ IPI: "nutanix-ipi" }),
});

/**
 * @param {string} platform  Blueprint platform label, e.g. "Bare Metal"
 * @param {string} method    Methodology label, e.g. "IPI"
 * @returns {string|null} scenarioId, or null when the combination is not modelled
 */
function getScenarioId(platform, method) {
  const byMethod = SCENARIO_BY_PLATFORM_METHOD[platform];
  if (!byMethod) return null;
  return byMethod[method] ?? null;
}

/** Every modelled scenario id. Derived, so it cannot drift from the map. */
function allScenarioIds() {
  return Object.values(SCENARIO_BY_PLATFORM_METHOD).flatMap((m) => Object.values(m));
}

export { getScenarioId, allScenarioIds, SCENARIO_BY_PLATFORM_METHOD };
