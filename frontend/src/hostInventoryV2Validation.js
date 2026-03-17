/**
 * Catalog-driven validation for Host Inventory v2 only (Phase 4.3).
 * Uses getFieldMeta for required and allowed; does not guess. Conditional requiredness only when provable from UI.
 */

import { getFieldMeta } from "./catalogFieldMeta.js";

/** Catalog path for role: agent-config hosts[].role. */
const ROLE_PATH_AGENT = "hosts[].role";
const ROLE_OUTPUT_AGENT = "agent-config.yaml";
/** install-config for bare metal IPI host role is in platform.baremetal.hosts - agent uses agent-config hosts[].role. */

/**
 * Returns catalog-only validation for inventory v2: errors/warnings when catalog explicitly says required or allowed.
 * Does not duplicate validateNode; callers merge with validateNode results.
 * @param {object} state - app state (hostInventory, blueprint, methodology)
 * @param {string|null} scenarioId - "bare-metal-agent" | "bare-metal-ipi" | null
 * @returns {{ errors: string[], warnings: string[], perNode: Array<{ errors: string[], warnings: string[], fieldErrors: object }> }}
 */
export function getCatalogValidationForInventoryV2(state, scenarioId) {
  const errors = [];
  const warnings = [];
  const inventory = state?.hostInventory || {};
  const nodes = inventory.nodes || [];
  const perNode = nodes.map(() => ({ errors: [], warnings: [], fieldErrors: {} }));

  if (!scenarioId) return { errors, warnings, perNode };

  // Bare metal IPI: install-config platform.baremetal.hosts requires at least one host
  if (scenarioId === "bare-metal-ipi") {
    if (nodes.length === 0) {
      errors.push("At least one host is required for bare metal IPI (install-config platform.baremetal.hosts).");
    }
    nodes.forEach((node, idx) => {
      const bmcAddr = (node.bmc?.address || "").trim();
      if (!bmcAddr) {
        perNode[idx].warnings.push("BMC address is recommended for provisioning.");
      }
    });
  }

  // Bare metal Agent: 2 control plane nodes require 1 arbiter (4.20 doc: only valid topology with 2 CP is 2 CP + arbiter).
  if (scenarioId === "bare-metal-agent") {
    const masterCount = nodes.filter((n) => n.role === "master").length;
    const arbiterCount = nodes.filter((n) => n.role === "arbiter").length;
    if (masterCount === 2 && arbiterCount === 0) {
      errors.push("Two control plane nodes require one arbiter node for this topology. Add a host with role arbiter, or use 1 or 3+ control plane nodes.");
    }
  }

  // API/Ingress VIPs are validated on the Networking step; not on Hosts page.

  // Enum validation: role must be in catalog allowed list when catalog provides it
  const roleMeta = getFieldMeta(scenarioId, ROLE_OUTPUT_AGENT, ROLE_PATH_AGENT);
  const allowedRoles = Array.isArray(roleMeta?.allowed) ? roleMeta.allowed : null;

  nodes.forEach((node, idx) => {
    const role = (node.role || "").trim();
    if (allowedRoles && role && !allowedRoles.includes(role)) {
      const msg = `Role must be one of: ${allowedRoles.join(", ")}.`;
      perNode[idx].errors.push(msg);
      perNode[idx].fieldErrors["role"] = msg;
    }
  });

  return { errors, warnings, perNode };
}

/**
 * Merge catalog validation into existing validateNode-style result.
 * @param {{ errors: string[], warnings: string[], fieldErrors: object }} base - from validateNode
 * @param {{ errors: string[], warnings: string[], fieldErrors: object }} catalog - one perNode entry
 * @returns {{ errors: string[], warnings: string[], fieldErrors: object }}
 */
export function mergeNodeValidation(base, catalog) {
  const errors = [...(base?.errors || []), ...(catalog?.errors || [])];
  const warnings = [...(base?.warnings || []), ...(catalog?.warnings || [])];
  const fieldErrors = { ...(base?.fieldErrors || {}), ...(catalog?.fieldErrors || {}) };
  return { errors, warnings, fieldErrors };
}
