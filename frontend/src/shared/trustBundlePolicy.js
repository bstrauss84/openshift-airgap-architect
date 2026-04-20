/**
 * additionalTrustBundlePolicy defaults and allow-list resolution (Trust & Proxy, Global Strategy, validation).
 * Mirrors TrustProxyStep semantics: catalog allowed values when present, else version-based list.
 */
import { getParamMeta } from "../catalogResolver.js";
import { getTrustBundlePolicies } from "./versionPolicy.js";

const INSTALL_CONFIG = "install-config.yaml";

export function extractPemCertificateBlocks(pem) {
  return (pem || "").match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)?.map((block) => block.trim()) || [];
}

/** Effective PEM blocks (mirror + proxy), de-duplicated like TrustProxyStep effectiveBundle. */
export function hasEffectiveTrustBundle(trust) {
  const mirrorBlocks = extractPemCertificateBlocks(trust?.mirrorRegistryCaPem);
  const proxyBlocks = extractPemCertificateBlocks(trust?.proxyCaPem);
  return Array.from(new Set([...mirrorBlocks, ...proxyBlocks])).join("\n").trim().length > 0;
}

/**
 * Allowed policy enum values for UI and validation: catalog when it defines allowed[], else version policy list.
 * @param {string|null} scenarioId
 * @param {string} selectedVersion patch or selected version string
 * @returns {string[]}
 */
export function getTrustPolicyOptionsForScenario(scenarioId, selectedVersion) {
  const metaPolicy = getParamMeta(scenarioId, "additionalTrustBundlePolicy", INSTALL_CONFIG);
  const policyAllowed = Array.isArray(metaPolicy?.allowed)
    ? metaPolicy.allowed
    : metaPolicy?.allowed
      ? [metaPolicy.allowed]
      : [];
  if (policyAllowed.length) return policyAllowed;
  return getTrustBundlePolicies(selectedVersion || "");
}

/**
 * Default policy when a trust bundle exists but the user has not chosen one (same as TrustProxyStep / generate.js).
 */
export function inferDefaultAdditionalTrustBundlePolicy(trust, globalStrategy) {
  const strategy = globalStrategy || {};
  return trust?.mirrorRegistryCaPem ? "Always" : strategy.proxyEnabled ? "Proxyonly" : "Always";
}

/**
 * Returns trust with additionalTrustBundlePolicy cleared when no PEM blocks, or set to the inferred default when
 * blocks exist, options exist, and policy is unset. Use on PEM edits so validation never races useEffect.
 */
export function withAutoTrustBundlePolicy(trust, globalStrategy, scenarioId, selectedVersion) {
  const next = { ...trust };
  const options = getTrustPolicyOptionsForScenario(scenarioId, selectedVersion);
  if (!hasEffectiveTrustBundle(next)) {
    if (next.additionalTrustBundlePolicy) {
      next.additionalTrustBundlePolicy = "";
    }
    return next;
  }
  if (!next.additionalTrustBundlePolicy && options.length) {
    next.additionalTrustBundlePolicy = inferDefaultAdditionalTrustBundlePolicy(next, globalStrategy);
  }
  return next;
}
