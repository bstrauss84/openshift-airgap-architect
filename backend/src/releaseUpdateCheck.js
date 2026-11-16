/**
 * OpenShift Airgap Architect - Published-release update check
 *
 * Builds the GET /api/update-info payload from the configured repository's
 * GitHub Releases API and the installed application version. The status itself
 * is decided by shared/updateStatus.js; this module only gathers trustworthy
 * inputs and refuses anything that is not.
 *
 * Trust boundary, stated plainly: release metadata is accepted from
 * api.github.com over HTTPS for the configured repository. No signature or
 * checksum of any release artifact is verified. A release is eligible only when
 * it is published (not a draft), not a prerelease, carries a stable
 * MAJOR.MINOR.PATCH tag, and every identifying URL names the configured
 * repository. A payload that names a different repository (for example after a
 * redirect from a renamed or transferred repository) fails the whole check
 * closed rather than being partially trusted.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import {
  RELEASE_IDENTITY_SOURCE,
  bareReleaseVersion,
  isStableReleaseVersion,
  resolveUpdateStatus,
  isUrgentUpdateStatus
} from "../../shared/updateStatus.js";
import { compareVersions } from "../../shared/versionUtils.js";

export const DEFAULT_APP_REPO = "bstrauss84/openshift-airgap-architect";
export const GITHUB_TIMEOUT_MS = 2000;
const RELEASES_PER_PAGE = 30;

// GitHub owner/repository naming rules, conservatively.
const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export function isValidRepoSlug(repo) {
  return typeof repo === "string" && REPO_PATTERN.test(repo) && !repo.includes("..");
}

const lower = (s) => String(s).toLowerCase();

/** True when `url` is exactly under `prefix`, compared case-insensitively. */
const isUnder = (url, prefix) => typeof url === "string" && lower(url).startsWith(lower(prefix));

/**
 * Turn a GitHub `GET /repos/:repo/releases` body into a verified release identity.
 *
 * @returns {{ ok: true, releaseIdentity: object } | { ok: false, error: string }}
 */
export function parseReleaseIdentity(data, repo) {
  if (!Array.isArray(data)) {
    return { ok: false, error: "Malformed release metadata: expected a list of releases" };
  }
  const apiPrefix = `https://api.github.com/repos/${repo}/releases/`;
  const htmlPrefix = `https://github.com/${repo}/releases/`;

  let latest = null;
  for (const release of data) {
    if (!release || typeof release !== "object") {
      return { ok: false, error: "Malformed release metadata: release entry is not an object" };
    }
    // Every entry must belong to the configured repository. One that does not
    // means the response is not what was asked for, so nothing in it is trusted.
    if (!isUnder(release.url, apiPrefix) || !isUnder(release.html_url, htmlPrefix)) {
      return { ok: false, error: "Release metadata does not belong to the configured repository" };
    }
    if (release.draft !== false || release.prerelease !== false) continue;
    if (!isStableReleaseVersion(release.tag_name)) continue;
    const publishedAt = typeof release.published_at === "string" ? release.published_at : "";
    if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) continue;

    const version = bareReleaseVersion(release.tag_name);
    if (!latest || compareVersions(version, latest.version) > 0) {
      latest = {
        version,
        tag: release.tag_name,
        name: typeof release.name === "string" ? release.name : "",
        url: release.html_url,
        publishedAt
      };
    }
  }
  return {
    ok: true,
    releaseIdentity: { verified: true, source: RELEASE_IDENTITY_SOURCE, repo, latest }
  };
}

function describeHttpFailure(resp) {
  const remaining = resp.headers?.get?.("x-ratelimit-remaining");
  if ((resp.status === 403 || resp.status === 429) && (remaining === "0" || resp.status === 429)) {
    return `GitHub API rate limit exceeded (HTTP ${resp.status})`;
  }
  return `GitHub API ${resp.status}`;
}

/**
 * Fetch and verify the release identity. Never throws.
 *
 * @returns {Promise<{ releaseIdentity: object|null, error: string|null }>}
 */
export async function fetchReleaseIdentity({ repo, installedVersion, fetchImpl = globalThis.fetch, timeoutMs = GITHUB_TIMEOUT_MS }) {
  const url = `https://api.github.com/repos/${repo}/releases?per_page=${RELEASES_PER_PAGE}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": `openshift-airgap-architect/${installedVersion}`
      }
    });
    if (!resp.ok) return { releaseIdentity: null, error: describeHttpFailure(resp) };
    let data;
    try {
      data = await resp.json();
    } catch {
      return { releaseIdentity: null, error: "Malformed release metadata: response is not JSON" };
    }
    const parsed = parseReleaseIdentity(data, repo);
    return parsed.ok
      ? { releaseIdentity: parsed.releaseIdentity, error: null }
      : { releaseIdentity: null, error: parsed.error };
  } catch (e) {
    return {
      releaseIdentity: null,
      error: e?.name === "AbortError" ? "Request timed out" : (e?.message || "Request failed")
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Build the full /api/update-info payload.
 *
 * Field compatibility: `enabled`, `currentSha`, `latestSha`, `isOutdated`,
 * `checkedAt`, `error`, `repo`, `updateStatus`, `urgent`, `releaseIdentity` keep
 * their names. `latestSha` is always null now (no branch is consulted) and
 * `isOutdated` equals `urgent`. `currentSha` is provenance only and plays no part
 * in the decision.
 */
export async function buildUpdateInfo({ env = process.env, installedVersion, fetchImpl } = {}) {
  const repo = (env.APP_REPO || DEFAULT_APP_REPO).trim();
  const currentSha = (env.APP_GIT_SHA || "").trim() || "unknown";
  const disabled = env.CHECK_UPDATES === "false" || env.CHECK_UPDATES === "0";
  const checkedAt = new Date().toISOString();

  const base = {
    enabled: !disabled,
    installedVersion: installedVersion || "unknown",
    currentSha,
    latestSha: null,
    checkedAt,
    repo
  };

  let error = null;
  let releaseIdentity = null;
  if (disabled) {
    // No request is made at all.
  } else if (!isStableReleaseVersion(installedVersion)) {
    error = "Installed application version is unavailable or not a stable release version";
  } else if (!isValidRepoSlug(repo)) {
    error = "APP_REPO is not a valid owner/repository name";
  } else {
    ({ releaseIdentity, error } = await fetchReleaseIdentity({ repo, installedVersion, fetchImpl }));
  }

  const updateStatus = resolveUpdateStatus({ disabled, installedVersion, fetchError: error, releaseIdentity });
  const urgent = isUrgentUpdateStatus(updateStatus);
  return { ...base, error, releaseIdentity, updateStatus, urgent, isOutdated: urgent };
}
