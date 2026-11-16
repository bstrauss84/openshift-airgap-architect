/**
 * OpenShift Airgap Architect - oc-mirror v2 command-line limits (v2.2.0 M5, F12)
 *
 * Limits the oc-mirror binary enforces on its own flags, shared by the backend
 * request schemas and preflight, and by the Install and Mirroring forms, so the
 * UI never offers a value the binary refuses.
 *
 * Evidence (exact binary, re-probed 2026-10-27): oc-mirror from
 * clients/ocp/latest = 4.22.19 (tarball sha256 58251fe1…, binary sha256
 * 55b55cf1…, component 4.22.0-…-ged9ff0d). `--parallel-images` and
 * `--parallel-layers` 0, 11 and 32 are rejected before any network access with
 * "[Executor] the flag parallel-images must be between the range 1 to 10"
 * (and "parallel-layers …"); 10 is accepted. Upstream: executor.go Validate.
 * `oc-mirror --help` does not print the range, so it is recorded here; the
 * defaults (4 and 5) are the ones `--help` prints. Only limits the binary was
 * seen to enforce belong here: other ranges (e.g. retry times 0–10) are
 * Architect policy and stay with their schemas.
 *
 * The oc-mirror policy resolves the latest global release, so a later binary
 * may change a limit; re-probe the shipped binary when the schema provenance
 * (data/oc-mirror-v2/imageset-config-schema.json) is re-verified.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

export const OC_MIRROR_CLI_LIMITS = Object.freeze({
  parallelImages: Object.freeze({ flag: "--parallel-images", min: 1, max: 10, default: 4 }),
  parallelLayers: Object.freeze({ flag: "--parallel-layers", min: 1, max: 10, default: 5 })
});

/** Whole number within the flag's accepted range. */
export const isWithinCliLimit = (key, value) => {
  const limit = OC_MIRROR_CLI_LIMITS[key];
  return Boolean(limit) && Number.isInteger(value) && value >= limit.min && value <= limit.max;
};

/** "Parallel images must be a whole number from 1 to 10." */
export const cliLimitMessage = (key, label) => {
  const limit = OC_MIRROR_CLI_LIMITS[key];
  return `${label} must be a whole number from ${limit.min} to ${limit.max}.`;
};
