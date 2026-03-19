/**
 * Cincinnati channel ordering for Blueprint step. Backend may return channels in any order;
 * we sort by semantic version (X.Y) so newest is deterministic.
 */

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
