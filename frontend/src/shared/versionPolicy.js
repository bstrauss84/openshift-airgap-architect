const SUPPORTED_MINORS = ["4.17", "4.18", "4.19", "4.20"];

const TRUST_BUNDLE_POLICY_ALLOWLIST = {
  "4.17": ["Proxyonly", "Always"],
  "4.18": ["Proxyonly", "Always"],
  "4.19": ["Proxyonly", "Always"],
  "4.20": ["Proxyonly", "Always"]
};

const getMinorVersion = (version) => {
  if (!version || typeof version !== "string") return null;
  const parts = version.split(".");
  if (parts.length < 2) return null;
  return `${parts[0]}.${parts[1]}`;
};

const isSupportedMinor = (minor) => SUPPORTED_MINORS.includes(minor);

/**
 * True for OpenShift 4.17+ minors where install-config still documents additionalTrustBundlePolicy
 * but this repo has not added an explicit per-minor row yet (e.g. 4.21 before catalog scrub).
 */
const isOpenShiftFourTrustPolicyForwardMinor = (minor) => {
  if (!minor || typeof minor !== "string") return false;
  const parts = minor.split(".");
  if (parts.length < 2) return false;
  const maj = Number(parts[0]);
  const min = Number(parts[1]);
  if (!Number.isFinite(maj) || !Number.isFinite(min)) return false;
  return maj === 4 && min >= 17;
};

const getTrustBundlePolicies = (version) => {
  const minor = getMinorVersion(version);
  if (!minor) return [];
  const explicit = TRUST_BUNDLE_POLICY_ALLOWLIST[minor];
  if (explicit) return explicit;
  if (isOpenShiftFourTrustPolicyForwardMinor(minor)) return ["Proxyonly", "Always"];
  return [];
};

/**
 * @typedef {"explicit"|"forward"|"unsupported"|"none"} TrustBundlePolicySource
 * @returns {{ policies: string[], source: TrustBundlePolicySource, minorVersion: string|null }}
 */
const getTrustBundlePolicySupport = (version) => {
  const minor = getMinorVersion(version);
  if (!minor) return { policies: [], source: "none", minorVersion: null };
  if (TRUST_BUNDLE_POLICY_ALLOWLIST[minor]) {
    return { policies: TRUST_BUNDLE_POLICY_ALLOWLIST[minor], source: "explicit", minorVersion: minor };
  }
  if (isOpenShiftFourTrustPolicyForwardMinor(minor)) {
    return { policies: ["Proxyonly", "Always"], source: "forward", minorVersion: minor };
  }
  return { policies: [], source: "unsupported", minorVersion: minor };
};

/**
 * When the selected patch maps to a minor newer than explicit scrubbed catalogs (e.g. 4.21 before docs-index exists),
 * return one generic notice for UI + combined validation. Uses minor only (e.g. 4.21), not z-stream.
 * @param {string} version patch or selected version string
 * @returns {string|null}
 */
const getForwardOpenShiftMinorDocNotice = (version) => {
  const support = getTrustBundlePolicySupport(version);
  if (support.source !== "forward") return null;
  const minor = support.minorVersion || "this minor";
  return `OpenShift ${minor} is not yet fully reflected in this tool's version-scrubbed docs index and catalogs. Confirm generated assets against the official Red Hat OpenShift Container Platform ${minor} documentation before using them in production.`;
};

export {
  SUPPORTED_MINORS,
  getMinorVersion,
  isSupportedMinor,
  getTrustBundlePolicies,
  getTrustBundlePolicySupport,
  getForwardOpenShiftMinorDocNotice
};
