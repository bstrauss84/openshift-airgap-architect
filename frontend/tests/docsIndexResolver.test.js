/**
 * docsIndexResolver tests (DOC-102 Slice 5J)
 *
 * Proves version-aware docs-index resolution:
 * exact 4.20, exact 4.21, patch values, missing, unsupported,
 * and no silent fallback to 4.20.
 */

import { describe, it, expect } from 'vitest';
import { getDocsIndexForState } from '../src/docsIndexResolver.js';
import docsIndex420 from '../src/data/docs-index/4.20.json';
import docsIndex421 from '../src/data/docs-index/4.21.json';

describe('getDocsIndexForState', () => {
  it('resolves canonical 4.20 state to the 4.20 index', () => {
    const state = { version: { selectedMinor: '4.20' } };
    const result = getDocsIndexForState(state);
    expect(result).toBe(docsIndex420);
    expect(result.version).toBe('4.20');
    expect(result.baseUrl).toContain('/4.20/');
  });

  it('resolves canonical 4.21 state to the 4.21 index', () => {
    const state = { version: { selectedMinor: '4.21' } };
    const result = getDocsIndexForState(state);
    expect(result).toBe(docsIndex421);
    expect(result.version).toBe('4.21');
    expect(result.baseUrl).toContain('/4.21/');
  });

  it('resolves patch value 4.21.3 through the canonical state helper', () => {
    const state = { version: { selectedPatch: '4.21.3' } };
    const result = getDocsIndexForState(state);
    expect(result).toBe(docsIndex421);
  });

  it('resolves patch value 4.20.15 to the 4.20 index', () => {
    const state = { version: { selectedPatch: '4.20.15' } };
    const result = getDocsIndexForState(state);
    expect(result).toBe(docsIndex420);
  });

  it('resolves via release.channel stable-4.21', () => {
    const state = { release: { channel: 'stable-4.21' } };
    const result = getDocsIndexForState(state);
    expect(result).toBe(docsIndex421);
  });

  it('returns null for missing version', () => {
    expect(getDocsIndexForState({})).toBeNull();
    expect(getDocsIndexForState({ version: {} })).toBeNull();
  });

  it('returns null for null state', () => {
    expect(getDocsIndexForState(null)).toBeNull();
  });

  it('returns null for unsupported 4.22', () => {
    const state = { version: { selectedMinor: '4.22' } };
    expect(getDocsIndexForState(state)).toBeNull();
  });

  it('returns null for unsupported 4.19', () => {
    const state = { version: { selectedMinor: '4.19' } };
    expect(getDocsIndexForState(state)).toBeNull();
  });

  it('no resolver path silently returns 4.20', () => {
    const unsupported422 = getDocsIndexForState({ version: { selectedMinor: '4.22' } });
    const missing = getDocsIndexForState({});
    const nullState = getDocsIndexForState(null);
    expect(unsupported422).not.toBe(docsIndex420);
    expect(missing).not.toBe(docsIndex420);
    expect(nullState).not.toBe(docsIndex420);
    expect(unsupported422).toBeNull();
    expect(missing).toBeNull();
    expect(nullState).toBeNull();
  });
});
