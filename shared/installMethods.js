/**
 * Which installation methods each target platform offers — one table, one owner.
 *
 * WHY THIS MODULE EXISTS. This table lived only inside
 * `frontend/src/steps/MethodologyStep.jsx`, where it was reachable solely by
 * the Methodology step. The Blueprint step — which comes FIRST and asks for the
 * CPU architecture — had no way to know whether the methodology currently in
 * state was even valid for the platform the user had just clicked.
 *
 * The consequence was a release blocker. `getScenarioId(platform, method)`
 * returns null for an unmodelled pair, and the architecture matrix resolves a
 * null scenario to "no answer", which the UI renders as every architecture
 * greyed out. The backend's cold-start state ships
 * `methodology.method = "Agent-Based Installer"`, so selecting Nutanix, AWS
 * GovCloud, Azure Government or IBM Cloud — none of which offer an
 * agent-based install — produced exactly that: a platform whose documented
 * x86_64 support is unambiguous, with x86_64 unclickable.
 *
 * Bare Metal appeared to work only because the shipped default pair happens to
 * be modelled as `bare-metal-agent`.
 *
 * SCOPE NOTE. The method sets below are reproduced verbatim from the
 * MethodologyStep table they replace. This module centralises the table; it
 * does not change which methods the product offers. One known disagreement is
 * deliberately preserved rather than silently resolved: `shared/scenarioId.js`
 * models `azure-government-upi`, but Azure Government offers only IPI here, so
 * that scenario is unreachable from the UI. Red Hat's installation-overview
 * Table 2.2 (user-provisioned) carries no Government-regions row at all, so
 * the narrower set is the defensible one and widening it would be a
 * support-surface change, not a bug fix.
 */

import { getScenarioId } from "./scenarioId.js";

/** platform label -> install methods offered, in display order. */
const METHODS_BY_PLATFORM = Object.freeze({
  "Bare Metal": Object.freeze(["Agent-Based Installer", "IPI", "UPI"]),
  "VMware vSphere": Object.freeze(["IPI", "UPI", "Agent-Based Installer"]),
  Nutanix: Object.freeze(["IPI"]),
  "AWS GovCloud": Object.freeze(["IPI", "UPI"]),
  "Azure Government": Object.freeze(["IPI"]),
  "IBM Cloud": Object.freeze(["IPI"]),
});

/** True when this platform is modelled by the product. */
export function isModelledPlatform(platform) {
  return Object.prototype.hasOwnProperty.call(METHODS_BY_PLATFORM, platform);
}

/**
 * Methods offered for a platform.
 * @returns {string[]} empty for an unmodelled platform — callers decide.
 */
export function installMethodsForPlatform(platform) {
  return isModelledPlatform(platform) ? [...METHODS_BY_PLATFORM[platform]] : [];
}

/** True when this exact platform + method pair is offered. */
export function isMethodValidForPlatform(platform, method) {
  return installMethodsForPlatform(platform).includes(method);
}

/**
 * The method to use for a platform, preserving the user's choice when it is
 * still valid. Deterministic: the same inputs always yield the same method.
 *
 * @returns {string|null} null for an unmodelled platform
 */
export function reconcileMethodForPlatform(platform, method) {
  if (!isModelledPlatform(platform)) return null;
  if (isMethodValidForPlatform(platform, method)) return method;
  return METHODS_BY_PLATFORM[platform][0];
}

/**
 * Every scenarioId reachable for a platform, across all its methods.
 *
 * Lets a caller answer a platform-level question before the user has chosen a
 * method, without inventing support semantics of its own: the scenarios come
 * from `getScenarioId`, exactly as they would once a method is picked.
 */
export function scenarioIdsForPlatform(platform) {
  const ids = installMethodsForPlatform(platform)
    .map((method) => getScenarioId(platform, method))
    .filter(Boolean);
  return [...new Set(ids)];
}

export { METHODS_BY_PLATFORM };
