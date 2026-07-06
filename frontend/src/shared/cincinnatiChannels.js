/**
 * OpenShift Airgap Architect - Cincinnati Channel Ordering
 *
 * Cincinnati channel ordering helpers for Blueprint step.
 * Backend may return channels in any order; we sort by semantic version (X.Y) for deterministic ordering.
 *
 * CRITICAL: Cincinnati availability is NOT the same as application support.
 * Always filter upstream channels against centralized SUPPORTED_MINORS before auto-selection.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { SUPPORTED_MINORS } from './versionPolicy.js';

/** Sort channel strings (e.g. "4.17", "4.21") ascending by semantic version so newest is last. */
export function sortChannelsBySemverAscending(channelList) {
  return [...(channelList || [])].sort((a, b) => {
    const [amj, ami] = (a || "").split(".").map(Number);
    const [bmj, bmi] = (b || "").split(".").map(Number);
    if (amj !== bmj) return amj - bmj;
    return (ami || 0) - (bmi || 0);
  });
}

/** Sort channels descending (newest first) for Blueprint minor-channel dropdown display. */
export function sortChannelsBySemverDescending(channelList) {
  const asc = sortChannelsBySemverAscending(channelList);
  return asc.slice().reverse();
}

/** Return the newest channel from a list; order-independent. */
export function getNewestChannel(channelList) {
  const sorted = sortChannelsBySemverAscending(channelList);
  return sorted.length ? sorted[sorted.length - 1] : null;
}

/**
 * Filter Cincinnati channels to only application-supported versions.
 * Cincinnati may expose 4.22 before the app supports it.
 * @param {string[]} upstreamChannels - Channels from Cincinnati (e.g. ["4.20", "4.21", "4.22"])
 * @returns {{supported: string[], unsupported: string[]}}
 */
export function filterSupportedChannels(upstreamChannels) {
  const supported = [];
  const unsupported = [];

  for (const channel of upstreamChannels || []) {
    if (SUPPORTED_MINORS.includes(channel)) {
      supported.push(channel);
    } else {
      unsupported.push(channel);
    }
  }

  return { supported, unsupported };
}

/**
 * Get the newest SUPPORTED channel from Cincinnati list.
 * Never auto-selects unsupported versions even if Cincinnati exposes them.
 * @param {string[]} upstreamChannels - Channels from Cincinnati
 * @returns {string|null} Newest supported channel or null
 */
export function getNewestSupportedChannel(upstreamChannels) {
  const { supported } = filterSupportedChannels(upstreamChannels);
  return getNewestChannel(supported);
}
