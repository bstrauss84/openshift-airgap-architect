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
const _PRODUCTION_MINORS = Object.freeze(["4.18", "4.19", "4.20", "4.21", "4.22"]);

// OAA_EXTRA_SUPPORTED_MINORS — comma-separated list of additional minors to allow at runtime.
// Intended for dev/test environments running versions older than the production support window.
// Extra minors bypass the version gate but have NO audited catalogs or Field Guide content;
// generation quality is best-effort using the nearest production minor's catalog data.
// Example: OAA_EXTRA_SUPPORTED_MINORS=4.18,4.19
const _EXTRA_MINORS = (process.env.OAA_EXTRA_SUPPORTED_MINORS || "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => /^\d+\.\d+$/.test(s) && !_PRODUCTION_MINORS.includes(s));

if (_EXTRA_MINORS.length > 0) {
  console.warn(
    `[versionPolicy] OAA_EXTRA_SUPPORTED_MINORS active: ${_EXTRA_MINORS.join(", ")} — ` +
    `no audited catalogs; generation quality is best-effort`
  );
}

const SUPPORTED_MINORS = Object.freeze([..._PRODUCTION_MINORS, ..._EXTRA_MINORS]);

const TRUST_BUNDLE_POLICY_ALLOWLIST = {
  "4.20": ["Proxyonly", "Always"],
  "4.18": ["Proxyonly", "Always"],
  "4.19": ["Proxyonly", "Always"],
  "4.21": ["Proxyonly", "Always"],
  "4.22": ["Proxyonly", "Always"]
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

function buildUnsupportedVersionError(requestedVersion) {
  const msg = requestedVersion
    ? `OpenShift ${requestedVersion} is not supported by this version of OpenShift Airgap Architect. ` +
      `Supported versions: ${SUPPORTED_MINORS.join(", ")}`
    : `OpenShift version could not be determined from state. ` +
      `Supported versions: ${SUPPORTED_MINORS.join(", ")}`;
  const err = new Error(msg);
  err.code = "UNSUPPORTED_VERSION";
  err.requestedVersion = requestedVersion ?? null;
  err.supportedVersions = SUPPORTED_MINORS;
  return err;
}

function assertSupportedOpenShiftMinorForGeneration(state) {
  const minor = getOpenShiftMinorFromState(state);
  if (!minor) throw buildUnsupportedVersionError(null);
  if (!isSupportedMinor(minor)) throw buildUnsupportedVersionError(minor);
  return minor;
}

export { SUPPORTED_MINORS, _PRODUCTION_MINORS, getMinorVersion, isSupportedMinor, getTrustBundlePolicies, buildUnsupportedVersionError, assertSupportedOpenShiftMinorForGeneration };
