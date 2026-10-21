/**
 * OpenShift Airgap Architect - Update status vocabulary (SHARED)
 *
 * Single source of truth for "what does the update check actually know?".
 *
 * Lives in shared/ because both sides need the same answer and must not drift:
 *   - backend : computes the status in GET /api/update-info
 *   - frontend: decides what, if anything, to show the operator
 *
 * THE CONTRACT (v2.1.1)
 *
 * An update is available when, and only when, the configured repository's GitHub
 * Releases API lists a PUBLISHED, STABLE release whose semantic version is
 * strictly NEWER than the installed application version (package.json).
 *
 * What this deliberately does NOT use:
 *   - the Git SHA of the running build. It is optional provenance. The Compose
 *     default leaves it "unknown", and that must not disable update detection;
 *   - a branch head. A differing commit is not a release and may even be OLDER
 *     than the running build (v1.7.1 shipped exactly that false prompt);
 *   - a bare tag. A tag is not a published release.
 *
 * TRUST BOUNDARY
 *
 * "Verified" here means: the release metadata came from the GitHub REST API for
 * the configured repository, every release object names that repository, and the
 * release is published (not draft) and not a prerelease. It does NOT mean any
 * cryptographic signature or artifact checksum was verified — none is.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { compareVersions, normalizeVersion } from "./versionUtils.js";

export const UPDATE_STATUS = Object.freeze({
  /** Operator turned update checks off (CHECK_UPDATES=false|0). */
  DISABLED: "disabled",
  /** The installed application version is missing or not a stable X.Y.Z. */
  UNKNOWN: "unknown",
  /**
   * The release lookup did not produce a trustworthy answer: timeout, network
   * failure, non-OK response, rate limit, malformed payload, or repository
   * identity mismatch. No conclusion about updates is drawn either way.
   */
  OFFLINE: "offline",
  /** No published stable release is newer than the installed version. */
  UP_TO_DATE: "up-to-date",
  /**
   * A published, stable release newer than the installed version exists in the
   * configured repository. The ONLY state that raises the urgent prompt.
   */
  PUBLISHED_SUPPORTED_UPDATE: "published-supported-update"
});

/** Identifies where a verified release identity came from. */
export const RELEASE_IDENTITY_SOURCE = "github-releases-api";

/**
 * A stable release version: exactly MAJOR.MINOR.PATCH, optional leading "v".
 *
 * normalizeVersion() also accepts two-part "X.Y" and pads it; that padding is
 * rejected here because "2.1" is not a release identity. Prerelease and build
 * suffixes ("2.2.0-rc.1", "2.0.0-dev") are rejected by normalizeVersion itself.
 */
export function isStableReleaseVersion(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  const bare = trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
  try {
    return normalizeVersion(trimmed) === bare;
  } catch {
    return false;
  }
}

/** Strip an optional leading "v" from a value already known to be stable. */
export function bareReleaseVersion(value) {
  const trimmed = String(value).trim();
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}

/**
 * The newest published release, but only when the identity is verified and
 * well-formed. Anything partial is treated as no identity at all.
 */
export function verifiedLatestRelease(releaseIdentity) {
  if (!releaseIdentity || releaseIdentity.verified !== true) return null;
  const latest = releaseIdentity.latest;
  if (!latest || !isStableReleaseVersion(latest.version)) return null;
  return latest;
}

/**
 * Resolve the single truthful status.
 *
 * Order matters: operator intent (disabled) first, then whether a comparison is
 * possible at all (installed version, lookup outcome), and only then the
 * comparison itself. The newer-than check is recomputed here from the two
 * versions rather than trusting any precomputed flag.
 *
 * @param {object}  input
 * @param {boolean} [input.disabled]          CHECK_UPDATES is off.
 * @param {string}  [input.installedVersion]  package.json version of this app.
 * @param {string}  [input.fetchError]        Non-empty when the lookup failed.
 * @param {object|null} [input.releaseIdentity]
 *   `{ verified: true, source, repo, latest: { version, tag, url, publishedAt } | null }`
 *   from a completed release lookup, or null when none completed.
 * @returns {string} one of UPDATE_STATUS
 */
export function resolveUpdateStatus({
  disabled = false,
  installedVersion,
  fetchError,
  releaseIdentity = null
} = {}) {
  if (disabled) return UPDATE_STATUS.DISABLED;
  if (!isStableReleaseVersion(installedVersion)) return UPDATE_STATUS.UNKNOWN;
  if (fetchError) return UPDATE_STATUS.OFFLINE;
  if (!releaseIdentity || releaseIdentity.verified !== true) return UPDATE_STATUS.OFFLINE;

  const latest = verifiedLatestRelease(releaseIdentity);
  if (latest && compareVersions(bareReleaseVersion(latest.version), bareReleaseVersion(installedVersion)) > 0) {
    return UPDATE_STATUS.PUBLISHED_SUPPORTED_UPDATE;
  }
  // No eligible release, the same version, or an OLDER one: never a downgrade prompt.
  return UPDATE_STATUS.UP_TO_DATE;
}

/**
 * Whether the status justifies an urgent, prominent upgrade prompt.
 *
 * Deliberately a whitelist of one. A new status added later is non-urgent until
 * someone decides otherwise, rather than inheriting urgency by default.
 */
export function isUrgentUpdateStatus(status) {
  return status === UPDATE_STATUS.PUBLISHED_SUPPORTED_UPDATE;
}

/**
 * Read the status off an /api/update-info payload.
 *
 * Falls back to recomputing from the raw fields when `updateStatus` is absent.
 * An older backend sends no `installedVersion`/verified identity, so the result
 * fails closed rather than reading the legacy `isOutdated` boolean.
 */
export function updateStatusOf(updateInfo) {
  if (!updateInfo) return UPDATE_STATUS.UNKNOWN;
  if (updateInfo.updateStatus) return updateInfo.updateStatus;
  return resolveUpdateStatus({
    disabled: updateInfo.enabled === false,
    installedVersion: updateInfo.installedVersion,
    fetchError: updateInfo.error,
    releaseIdentity: updateInfo.releaseIdentity ?? null
  });
}
