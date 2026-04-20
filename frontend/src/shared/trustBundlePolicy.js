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
 * Classifies trust PEM sources for default-policy and UI sync (mirror CAs → Always; proxy-only CAs → Proxyonly).
 * @returns {"none"|"mirror"|"proxy-only"}
 */
export function trustBundleInferTier(trust) {
  if (!trust) return "none";
  const mirrorBlocks = extractPemCertificateBlocks(trust.mirrorRegistryCaPem);
  const proxyBlocks = extractPemCertificateBlocks(trust.proxyCaPem);
  if (mirrorBlocks.length > 0) return "mirror";
  if (proxyBlocks.length > 0) return "proxy-only";
  return "none";
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
 * Default policy when a trust bundle exists but the user has not chosen one (aligned with install-config generator).
 * Mirror registry PEMs → Always (nodes must trust the mirror everywhere). Proxy-only PEMs → Proxyonly (per 4.x docs:
 * bundle scoped to proxy trust path). Empty bundle should not call this.
 */
export function inferDefaultAdditionalTrustBundlePolicy(trust, globalStrategy) {
  const strategy = globalStrategy || {};
  const mirrorBlocks = extractPemCertificateBlocks(trust?.mirrorRegistryCaPem);
  const proxyBlocks = extractPemCertificateBlocks(trust?.proxyCaPem);
  if (mirrorBlocks.length > 0) return "Always";
  if (proxyBlocks.length > 0) return "Proxyonly";
  return strategy.proxyEnabled ? "Proxyonly" : "Always";
}

/**
 * Returns trust with additionalTrustBundlePolicy cleared when no PEM blocks, or set to the inferred default when
 * blocks exist, options exist, and policy is unset. When `previousTrust` is provided and the mirror vs proxy-only
 * tier changes, policy is reset to the new inferred default so defaults track which CAs are present.
 * @param {object|undefined|null} [previousTrust] trust snapshot before the current edit (omit on first sync).
 */
export function withAutoTrustBundlePolicy(trust, globalStrategy, scenarioId, selectedVersion, previousTrust) {
  const next = { ...trust };
  const options = getTrustPolicyOptionsForScenario(scenarioId, selectedVersion);
  if (!hasEffectiveTrustBundle(next)) {
    if (next.additionalTrustBundlePolicy) {
      next.additionalTrustBundlePolicy = "";
    }
    return next;
  }
  const inferred = inferDefaultAdditionalTrustBundlePolicy(next, globalStrategy);
  const prevPolicy = (next.additionalTrustBundlePolicy || "").trim();
  const hasPrevious = previousTrust !== undefined && previousTrust !== null;
  const prevTier = hasPrevious ? trustBundleInferTier(previousTrust) : trustBundleInferTier(next);
  const nextTier = trustBundleInferTier(next);
  if (!prevPolicy && options.length) {
    next.additionalTrustBundlePolicy = inferred;
  } else if (options.length && hasPrevious && prevTier !== nextTier) {
    next.additionalTrustBundlePolicy = inferred;
  }
  return next;
}
