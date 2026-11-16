/**
 * Catalog Version Utilities Tests
 *
 * Tests for strict version parsing used in catalog loading.
 */

import { describe, it, expect } from 'vitest';
import { getMinorVersion, isValidMinorVersion } from '../src/shared/catalogVersion.js';

describe('catalogVersion: getMinorVersion', () => {
  it('extracts minor from patch version', () => {
    expect(getMinorVersion('4.20.15')).toBe('4.20');
    expect(getMinorVersion('4.21.0')).toBe('4.21');
    expect(getMinorVersion('4.19.25')).toBe('4.19');
  });

  it('returns minor version when already minor', () => {
    expect(getMinorVersion('4.20')).toBe('4.20');
    expect(getMinorVersion('4.21')).toBe('4.21');
  });

  it('strips leading v prefix', () => {
    expect(getMinorVersion('v4.20')).toBe('4.20');
    expect(getMinorVersion('v4.21.5')).toBe('4.21');
  });

  it('throws on invalid version formats', () => {
    expect(() => getMinorVersion('invalid')).toThrow(/Invalid version format/);
    expect(() => getMinorVersion('4')).toThrow(/Invalid version format/);
    expect(() => getMinorVersion('4.x')).toThrow(/Expected numeric major.minor/);
    expect(() => getMinorVersion('x.y')).toThrow(/Expected numeric major.minor/);
  });

  it('throws on null/undefined/empty', () => {
    expect(() => getMinorVersion(null)).toThrow(/Invalid version/);
    expect(() => getMinorVersion(undefined)).toThrow(/Invalid version/);
    expect(() => getMinorVersion('')).toThrow(/Invalid version/);
    expect(() => getMinorVersion('   ')).toThrow(/Invalid version/);
  });

  it('throws on non-string input', () => {
    expect(() => getMinorVersion(420)).toThrow(/Invalid version/);
    expect(() => getMinorVersion({})).toThrow(/Invalid version/);
    expect(() => getMinorVersion([])).toThrow(/Invalid version/);
  });
});

describe('catalogVersion: isValidMinorVersion', () => {
  it('returns true for valid minor versions', () => {
    expect(isValidMinorVersion('4.20')).toBe(true);
    expect(isValidMinorVersion('4.21')).toBe(true);
    expect(isValidMinorVersion('5.0')).toBe(true);
  });

  it('returns false for patch versions', () => {
    expect(isValidMinorVersion('4.20.15')).toBe(false);
  });

  it('returns false for invalid formats', () => {
    expect(isValidMinorVersion('invalid')).toBe(false);
    expect(isValidMinorVersion('4')).toBe(false);
    expect(isValidMinorVersion('')).toBe(false);
    expect(isValidMinorVersion(null)).toBe(false);
  });
});
