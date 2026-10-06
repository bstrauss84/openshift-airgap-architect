/**
 * R2: the contextual "New in OpenShift X.Y" badge must be derived from
 * (field introduction minor === locked target minor), not from a hardcoded
 * 4.21 concept, so no code change is needed when a later minor is onboarded.
 *
 * Provenance ("introduced in 4.21") and contextual presentation ("new in the
 * release you have locked") are separate concepts and are asserted separately.
 *
 * NOTE: this file proves the *helper* is generic by feeding it a hypothetical
 * later minor directly. It does NOT add that minor to the supported list, does
 * not create catalogs for it, and does not touch unsupported-version gating.
 */
import { describe, it, expect } from 'vitest';
import { getFieldAnnotationInfo } from '../src/catalogFieldMeta.js';
import { getCatalogForScenario } from '../src/catalogPaths.js';
import { SUPPORTED_MINORS, isSupportedMinor } from '../src/shared/versionPolicy.js';

const INSTALL_CONFIG = 'install-config.yaml';
const BASELINE = SUPPORTED_MINORS[0];
const THROUGHPUT = 'controlPlane.platform.aws.rootVolume.throughput';

/** A synthetic catalog lets us model a minor beyond what the product supports. */
function catalog(entries) {
  return entries.map((e) => ({ outputFile: INSTALL_CONFIG, ...e }));
}

describe('contextual "New in OpenShift X.Y" badge is data-driven', () => {
  const params = catalog([
    { path: 'field.baseline', minVersion: BASELINE },
    { path: 'field.in421', minVersion: '4.21' },
    { path: 'field.inLater', minVersion: '4.99' },
  ]);

  it('badges a 4.21-introduced field only when 4.21 is the locked target', () => {
    const info = getFieldAnnotationInfo('field.in421', INSTALL_CONFIG, params, '4.21', BASELINE);
    expect(info.isIntroduced).toBe(true);
    expect(info.introductionMinor).toBe('4.21');
  });

  it('does not badge a 4.21-introduced field when a LATER minor is locked', () => {
    // The whole point of R2: provenance is not a permanent badge.
    const info = getFieldAnnotationInfo('field.in421', INSTALL_CONFIG, params, '4.99', BASELINE);
    expect(info.isIntroduced).toBe(false);
    expect(info.introductionMinor).toBeNull();
  });

  it('still reports true provenance when the badge does not apply', () => {
    const info = getFieldAnnotationInfo('field.in421', INSTALL_CONFIG, params, '4.99', BASELINE);
    expect(info.introducedInMinor).toBe('4.21');
  });

  it('badges a field whose introduction minor equals that later locked target', () => {
    const info = getFieldAnnotationInfo('field.inLater', INSTALL_CONFIG, params, '4.99', BASELINE);
    expect(info.isIntroduced).toBe(true);
    expect(info.introductionMinor).toBe('4.99');
  });

  it('does not badge the field at the baseline minor', () => {
    const info = getFieldAnnotationInfo('field.baseline', INSTALL_CONFIG, params, BASELINE, BASELINE);
    expect(info.isIntroduced).toBe(false);
    expect(info.introducedInMinor).toBe(BASELINE);
  });

  it('does not badge a 4.21 field when an EARLIER minor is locked', () => {
    const info = getFieldAnnotationInfo('field.in421', INSTALL_CONFIG, params, BASELINE, BASELINE);
    expect(info.isIntroduced).toBe(false);
  });

  it('contains no hardcoded minor: the rule is introduction === locked target', () => {
    for (const locked of [BASELINE, '4.21', '4.37', '4.99']) {
      const info = getFieldAnnotationInfo('field.inLater', INSTALL_CONFIG, params, locked, BASELINE);
      expect(info.isIntroduced).toBe(locked === '4.99');
    }
  });
});

describe('real catalog behaviour for the AWS throughput field', () => {
  const params420 = getCatalogForScenario('aws-govcloud-ipi', '4.20') || [];
  const params421 = getCatalogForScenario('aws-govcloud-ipi', '4.21') || [];

  it('is absent or unbadged under locked 4.20', () => {
    const info = getFieldAnnotationInfo(THROUGHPUT, INSTALL_CONFIG, params420, '4.20', BASELINE);
    expect(info.isIntroduced).toBe(false);
  });

  it('is badged "New in OpenShift 4.21" under locked 4.21', () => {
    const info = getFieldAnnotationInfo(THROUGHPUT, INSTALL_CONFIG, params421, '4.21', BASELINE);
    expect(info.isIntroduced).toBe(true);
    expect(info.introductionMinor).toBe('4.21');
  });

  it('would not be badged if a later minor were the locked target', () => {
    const info = getFieldAnnotationInfo(THROUGHPUT, INSTALL_CONFIG, params421, '4.99', BASELINE);
    expect(info.isIntroduced).toBe(false);
    expect(info.introducedInMinor).toBe('4.21');
  });
});

describe('this genericity work enables no unsupported-version support', () => {
  it('supported minors remain exactly 4.20 and 4.21', () => {
    expect(SUPPORTED_MINORS).toEqual(['4.20', '4.21']);
  });

  it('4.22 is still rejected as unsupported', () => {
    expect(isSupportedMinor('4.22')).toBe(false);
  });

  it('the hypothetical minor used above is not supported either', () => {
    expect(isSupportedMinor('4.99')).toBe(false);
  });

  it('catalog lookup still fails closed for an unsupported minor', () => {
    expect(() => getCatalogForScenario('aws-govcloud-ipi', '4.22')).toThrow(/not supported/i);
  });
});
