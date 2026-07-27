/**
 * OpenShift Airgap Architect - Version Policy Management
 *
 * Manages OpenShift version-specific policies and feature compatibility.
 * Defines supported OpenShift minor versions, trust bundle policies, and
 * version-dependent feature availability.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { getOpenShiftMinorFromState } from "./openShiftMinor.js";

// Application-supported OpenShift minors (requires audited catalogs, Field Guide, validation, generation contract)
// Cincinnati availability is NOT the same as application support
const SUPPORTED_MINORS = Object.freeze(["4.20", "4.21"]);

const TRUST_BUNDLE_POLICY_ALLOWLIST = {
  "4.20": ["Proxyonly", "Always"],
  "4.21": ["Proxyonly", "Always"]
};

const getMinorVersion = (version) => {
  if (!version || typeof version !== "string") return null;
  const parts = version.split(".");
  if (parts.length < 2) return null;
  return `${parts[0]}.${parts[1]}`;
};

const isSupportedMinor = (minor) => SUPPORTED_MINORS.includes(minor);

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

function assertSupportedOpenShiftMinorForGeneration(state) {
  const minor = getOpenShiftMinorFromState(state);
  if (!minor) {
    const err = new Error(
      `OpenShift version could not be determined from state. ` +
      `Supported versions: ${SUPPORTED_MINORS.join(", ")}`
    );
    err.code = "UNSUPPORTED_VERSION";
    err.requestedVersion = null;
    err.supportedVersions = SUPPORTED_MINORS;
    throw err;
  }
  if (!isSupportedMinor(minor)) {
    const err = new Error(
      `OpenShift ${minor} is not supported by this version of OpenShift Airgap Architect. ` +
      `Supported versions: ${SUPPORTED_MINORS.join(", ")}`
    );
    err.code = "UNSUPPORTED_VERSION";
    err.requestedVersion = minor;
    err.supportedVersions = SUPPORTED_MINORS;
    throw err;
  }
  return minor;
}

export { SUPPORTED_MINORS, getMinorVersion, isSupportedMinor, getTrustBundlePolicies, assertSupportedOpenShiftMinorForGeneration };
