/**
 * Cincinnati Channels - Frozen SUPPORTED_MINORS Immutability Tests
 *
 * Regression tests for DOC-102 Slice 5F.13 frozen-array mutation defect.
 * SUPPORTED_MINORS is Object.freeze(["4.20", "4.21"]) and must never be mutated.
 */

import { describe, it, expect } from 'vitest';
import { SUPPORTED_MINORS } from '../src/shared/versionPolicy.js';
import {
  classifyChannels,
  filterSupportedChannels,
  getNewestSupportedChannel,
  sortChannelsBySemverAscending,
  sortChannelsBySemverDescending
} from '../src/shared/cincinnatiChannels.js';

describe('Cincinnati Channels - SUPPORTED_MINORS Immutability', () => {
  it('SUPPORTED_MINORS is frozen and immutable', () => {
    expect(Object.isFrozen(SUPPORTED_MINORS)).toBe(true);
    expect(SUPPORTED_MINORS).toEqual(['4.20', '4.21']);
  });

  it('classifyChannels does not mutate SUPPORTED_MINORS', () => {
    const beforeClassify = [...SUPPORTED_MINORS];
    const upstream = ['4.17', '4.18', '4.19', '4.20', '4.21', '4.22'];

    classifyChannels(upstream);

    // SUPPORTED_MINORS must remain unchanged
    expect(SUPPORTED_MINORS).toEqual(beforeClassify);
    expect(SUPPORTED_MINORS).toEqual(['4.20', '4.21']);
  });

  it('classifyChannels correctly classifies all channel types', () => {
    const upstream = ['4.17', '4.18', '4.19', '4.20', '4.21', '4.22'];

    const result = classifyChannels(upstream);

    expect(result.supported).toEqual(['4.20', '4.21']);
    expect(result.newerUnsupported).toEqual(['4.22']);
    expect(result.olderOutOfScope).toEqual(['4.17', '4.18', '4.19']);
    expect(result.invalid).toEqual([]);
  });

  it('classifyChannels handles invalid channel formats', () => {
    const upstream = ['4.20', 'stable-4.21', '4.x', 'invalid', '4.22'];

    const result = classifyChannels(upstream);

    expect(result.supported).toEqual(['4.20']);
    expect(result.newerUnsupported).toEqual(['4.22']);
    expect(result.invalid).toEqual(['stable-4.21', '4.x', 'invalid']);
  });

  it('getNewestSupportedChannel selects 4.21 when 4.22 is available', () => {
    const upstream = ['4.20', '4.21', '4.22'];

    const newest = getNewestSupportedChannel(upstream);

    expect(newest).toBe('4.21'); // Never auto-selects unsupported 4.22
  });

  it('getNewestSupportedChannel handles only unsupported channels', () => {
    const upstream = ['4.17', '4.18', '4.22', '4.23'];

    const newest = getNewestSupportedChannel(upstream);

    expect(newest).toBeNull(); // No supported channels available
  });

  it('filterSupportedChannels separates supported and unsupported', () => {
    const upstream = ['4.19', '4.20', '4.21', '4.22'];

    const result = filterSupportedChannels(upstream);

    expect(result.supported).toEqual(['4.20', '4.21']);
    expect(result.unsupported).toEqual(['4.22', '4.19']); // Newer + older combined
  });

  it('sortChannelsBySemverAscending does not mutate input', () => {
    const channels = ['4.21', '4.19', '4.20'];
    const original = [...channels];

    const sorted = sortChannelsBySemverAscending(channels);

    expect(channels).toEqual(original); // Input unchanged
    expect(sorted).toEqual(['4.19', '4.20', '4.21']);
  });

  it('sortChannelsBySemverDescending returns newest first', () => {
    const channels = ['4.19', '4.21', '4.20'];

    const sorted = sortChannelsBySemverDescending(channels);

    expect(sorted).toEqual(['4.21', '4.20', '4.19']);
  });

  it('multiple classifyChannels calls preserve SUPPORTED_MINORS', () => {
    const upstream1 = ['4.20', '4.21', '4.22'];
    const upstream2 = ['4.17', '4.20', '4.21'];

    classifyChannels(upstream1);
    classifyChannels(upstream2);
    classifyChannels(upstream1);

    // SUPPORTED_MINORS must still be unchanged
    expect(SUPPORTED_MINORS).toEqual(['4.20', '4.21']);
    expect(Object.isFrozen(SUPPORTED_MINORS)).toBe(true);
  });
});
