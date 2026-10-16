/**
 * OpenShift Airgap Architect - Update status vocabulary (SHARED)
 *
 * Single source of truth for "what does the update check actually know?".
 *
 * Lives in shared/ because both sides need the same answer and must not drift:
 *   - backend : computes the status in GET /api/update-info
 *   - frontend: decides what, if anything, to show the operator
 *
 * WHY THIS EXISTS
 *
 * The check asks GitHub for the newest COMMIT on a configured branch
 * (`/repos/:repo/commits?sha=<branch>`) and previously set a single `isOutdated`
 * boolean from `latestSha !== currentSha`. A differing commit is not evidence of a
 * newer published, supported release, and treating it as one is actively wrong
 * here:
 *
 *   - the repository has ZERO published GitHub Releases, so "a newer release is
 *     available" is not currently a statement this app can truthfully make;
 *   - `APP_BRANCH` defaults to `main`, which points at the v1.7.1 commit, so a
 *     running v2.1 build compares unequal and would be told to "update" to
 *     something five months OLDER than itself;
 *   - a tag is not a release either: `v2.0.0` is tagged but unpublished.
 *
 * So the distinguishable situations are kept distinct, and ONLY a verified release
 * identity may produce the urgent state. No trusted release-identity source is
 * implemented yet, so production passes `releaseIdentity: null` and the urgent
 * state is unreachable by construction — fail closed. The parameter exists so the
 * urgent UI can be exercised by a synthetic fixture without pretending a published
 * release exists.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

export const UPDATE_STATUS = Object.freeze({
  /** Operator turned update checks off (CHECK_UPDATES=false|0). */
  DISABLED: "disabled",
  /** The running build cannot be identified, so no comparison is meaningful. */
  UNKNOWN: "unknown",
  /** The lookup did not complete: timeout, network failure, or a non-OK response. */
  OFFLINE: "offline",
  /** The running build matches the branch head. */
  UP_TO_DATE: "up-to-date",
  /**
   * The configured branch carries a different commit. This says the SOURCE BRANCH
   * moved, nothing more — it does not mean a newer supported release was published,
   * and the branch may even be older than the running build.
   */
  DEVELOPMENT_BRANCH_AHEAD: "development-branch-ahead",
  /**
   * A newer published, supported release was confirmed by a trusted release-identity
   * source. This is the ONLY state that justifies an urgent upgrade prompt, and
   * nothing in production can currently produce it.
   */
  PUBLISHED_SUPPORTED_UPDATE: "published-supported-update"
});

/** Seven-character prefix comparison, matching how the SHAs are displayed. */
const short = (s) => (s && String(s).length >= 7 ? String(s).slice(0, 7) : String(s || ""));

const isUnknownSha = (sha) => !sha || String(sha).toLowerCase() === "unknown";

/**
 * A release identity counts only when it was explicitly verified AND reports
 * itself as newer. Anything partial is treated as no identity at all, so an
 * unverified or malformed payload can never reach the urgent state.
 */
function hasVerifiedNewerRelease(releaseIdentity) {
  return Boolean(
    releaseIdentity &&
    releaseIdentity.verified === true &&
    releaseIdentity.isNewer === true
  );
}

/**
 * Resolve the single truthful status.
 *
 * Order matters: operator intent (disabled) first, then whether a comparison is
 * even possible (unknown build, failed lookup), and only then the comparison
 * itself. A verified release identity outranks the branch comparison, because it
 * is the stronger evidence.
 *
 * @param {object}  input
 * @param {boolean} [input.disabled]        CHECK_UPDATES is off.
 * @param {string}  [input.currentSha]      The running build's commit.
 * @param {string}  [input.latestSha]       Head commit of the configured branch.
 * @param {string}  [input.fetchError]      Non-empty when the lookup failed.
 * @param {object|null} [input.releaseIdentity] Verified published-release facts,
 *   or null when no trusted source was consulted. Production passes null.
 * @returns {string} one of UPDATE_STATUS
 */
export function resolveUpdateStatus({
  disabled = false,
  currentSha,
  latestSha,
  fetchError,
  releaseIdentity = null
} = {}) {
  if (disabled) return UPDATE_STATUS.DISABLED;
  if (isUnknownSha(currentSha)) return UPDATE_STATUS.UNKNOWN;
  if (fetchError) return UPDATE_STATUS.OFFLINE;

  if (hasVerifiedNewerRelease(releaseIdentity)) {
    return UPDATE_STATUS.PUBLISHED_SUPPORTED_UPDATE;
  }

  if (isUnknownSha(latestSha)) return UPDATE_STATUS.UNKNOWN;
  if (short(latestSha) === short(currentSha)) return UPDATE_STATUS.UP_TO_DATE;

  return UPDATE_STATUS.DEVELOPMENT_BRANCH_AHEAD;
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
 * Falls back to recomputing from the raw fields when `updateStatus` is absent, so
 * a frontend talking to an older backend still fails closed rather than reading
 * the legacy `isOutdated` boolean — which is exactly the flag that cannot
 * distinguish "branch moved" from "release published".
 */
export function updateStatusOf(updateInfo) {
  if (!updateInfo) return UPDATE_STATUS.UNKNOWN;
  if (updateInfo.updateStatus) return updateInfo.updateStatus;
  return resolveUpdateStatus({
    disabled: updateInfo.enabled === false,
    currentSha: updateInfo.currentSha,
    latestSha: updateInfo.latestSha,
    fetchError: updateInfo.error,
    releaseIdentity: updateInfo.releaseIdentity ?? null
  });
}
