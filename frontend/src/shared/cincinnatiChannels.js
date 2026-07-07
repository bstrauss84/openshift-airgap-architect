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
import { compareVersions } from '../../../shared/versionUtils.js';

/** Sort channel strings (e.g. "4.17", "4.21") ascending by semantic version so newest is last. */
export function sortChannelsBySemverAscending(channelList) {
  return [...(channelList || [])].sort((a, b) => compareVersions(a, b));
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
 * Classify Cincinnati channels into supported, newer unsupported, older out-of-scope, and invalid.
 * Uses shared version utilities for comparisons (no ad hoc split/Number).
 *
 * @param {string[]} upstreamChannels - Channels from Cincinnati (e.g. ["4.17", "4.18", "4.19", "4.20", "4.21", "4.22"])
 * @returns {{supported: string[], newerUnsupported: string[], olderOutOfScope: string[], invalid: string[]}}
 *
 * Example:
 *   upstream: ["4.17", "4.18", "4.19", "4.20", "4.21", "4.22"]
 *   SUPPORTED_MINORS: ["4.20", "4.21"]
 *   result: {
 *     supported: ["4.20", "4.21"],
 *     newerUnsupported: ["4.22"],
 *     olderOutOfScope: ["4.17", "4.18", "4.19"],
 *     invalid: []
 *   }
 */
export function classifyChannels(upstreamChannels) {
  const supported = [];
  const newerUnsupported = [];
  const olderOutOfScope = [];
  const invalid = [];

  // CRITICAL: Never mutate frozen SUPPORTED_MINORS - copy first
  const latestSupported = [...SUPPORTED_MINORS].sort((a, b) => compareVersions(b, a))[0]; // Descending, pick first

  for (const channel of upstreamChannels || []) {
    // Validate format (must be X.Y)
    if (!/^\d+\.\d+$/.test(channel)) {
      invalid.push(channel);
      continue;
    }

    if (SUPPORTED_MINORS.includes(channel)) {
      supported.push(channel);
    } else {
      // Not supported - is it newer or older than our support range?
      const comparison = compareVersions(channel, latestSupported);
      if (comparison > 0) {
        // Newer than latest supported
        newerUnsupported.push(channel);
      } else {
        // Older than supported range
        olderOutOfScope.push(channel);
      }
    }
  }

  return { supported, newerUnsupported, olderOutOfScope, invalid };
}

/**
 * Filter Cincinnati channels to only application-supported versions.
 * Backward compatibility wrapper for classifyChannels.
 * @param {string[]} upstreamChannels - Channels from Cincinnati (e.g. ["4.20", "4.21", "4.22"])
 * @returns {{supported: string[], unsupported: string[]}}
 */
export function filterSupportedChannels(upstreamChannels) {
  const { supported, newerUnsupported, olderOutOfScope, invalid } = classifyChannels(upstreamChannels);
  // Combine all non-supported into 'unsupported' for backward compatibility
  return {
    supported,
    unsupported: [...newerUnsupported, ...olderOutOfScope, ...invalid]
  };
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
