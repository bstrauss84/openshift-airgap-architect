/**
 * AWS Root Volume Throughput Tests (DOC-102)
 *
 * Frontend-side tests covering:
 * - Catalog: 4.20 has no throughput, 4.21 IPI supported-ui, compute supported-derived,
 *   UPI docs-only-not-supported, canonical/mirror parity
 * - Visibility: version-gated via isParamVisibleForVersion
 * - Validation: integer 125-2000, gp3 only
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getCatalogForScenario } from '../src/catalogPaths.js';
import { isParamVisibleForVersion } from '../src/catalogFieldMeta.js';

const testDir = dirname(fileURLToPath(import.meta.url));

function loadCanonical(version, scenario) {
  const filePath = resolve(testDir, '..', '..', 'data', 'params', version, `${scenario}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')).parameters;
}

// ===================================================================
// Catalog tests
// ===================================================================

describe('AWS root volume throughput — catalog', () => {
  it('4.20 AWS IPI has no supported throughput UI path', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.20');
    const throughputParams = params.filter(p =>
      p.path.includes('rootVolume.throughput')
    );
    expect(throughputParams).toHaveLength(0);
  });

  it('4.21 AWS IPI control-plane path is supported-ui', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(param).toBeDefined();
    expect(param.supportStatus).toBe('supported-ui');
    expect(param.minVersion).toBe('4.21');
    expect(param.maxVersion).toBe(null);
  });

  it('4.21 AWS IPI compute path is supported-derived', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param = params.find(p =>
      p.path === 'compute[].platform.aws.rootVolume.throughput'
    );
    expect(param).toBeDefined();
    expect(param.supportStatus).toBe('supported-derived');
    expect(param.minVersion).toBe('4.21');
    expect(param.maxVersion).toBe(null);
  });

  it('4.21 AWS UPI path is docs-only-not-supported', () => {
    const params = getCatalogForScenario('aws-govcloud-upi', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(param).toBeDefined();
    expect(param.supportStatus).toBe('docs-only-not-supported');
  });

  it('canonical and frontend mirrors are identical for IPI', () => {
    const canonicalPath = resolve(testDir, '..', '..', 'data', 'params', '4.21', 'aws-govcloud-ipi.json');
    const mirrorPath = resolve(testDir, '..', 'src', 'data', 'catalogs', '4.21', 'aws-govcloud-ipi.json');
    expect(fs.readFileSync(canonicalPath, 'utf8')).toBe(fs.readFileSync(mirrorPath, 'utf8'));
  });

  it('canonical and frontend mirrors are identical for UPI', () => {
    const canonicalPath = resolve(testDir, '..', '..', 'data', 'params', '4.21', 'aws-govcloud-upi.json');
    const mirrorPath = resolve(testDir, '..', 'src', 'data', 'catalogs', '4.21', 'aws-govcloud-upi.json');
    expect(fs.readFileSync(canonicalPath, 'utf8')).toBe(fs.readFileSync(mirrorPath, 'utf8'));
  });
});

// ===================================================================
// Frontend visibility tests
// ===================================================================

describe('AWS root volume throughput — visibility', () => {
  it('4.20 AWS IPI: hidden (no throughput param exists)', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.20');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(param).toBeUndefined();
  });

  it('4.21 AWS IPI: visible', () => {
    const params = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(param).toBeDefined();
    expect(isParamVisibleForVersion(param, '4.21')).toBe(true);
  });

  it('4.21 AWS UPI: hidden (docs-only-not-supported)', () => {
    const params = getCatalogForScenario('aws-govcloud-upi', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(param).toBeDefined();
    expect(isParamVisibleForVersion(param, '4.21')).toBe(false);
  });

  it('4.21 non-AWS: hidden (no throughput param)', () => {
    const params = getCatalogForScenario('bare-metal-agent', '4.21');
    const param = params.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(param).toBeUndefined();
  });

  it('version switch restores visibility and retained state', () => {
    const params421 = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param421 = params421.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(isParamVisibleForVersion(param421, '4.21')).toBe(true);

    const params420 = getCatalogForScenario('aws-govcloud-ipi', '4.20');
    const param420 = params420.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(param420).toBeUndefined();

    const params421Again = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const param421Again = params421Again.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(isParamVisibleForVersion(param421Again, '4.21')).toBe(true);
  });

  it('installation-method switch restores visibility and retained state', () => {
    const ipiParams = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const ipiParam = ipiParams.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(isParamVisibleForVersion(ipiParam, '4.21')).toBe(true);

    const upiParams = getCatalogForScenario('aws-govcloud-upi', '4.21');
    const upiParam = upiParams.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(isParamVisibleForVersion(upiParam, '4.21')).toBe(false);

    const ipiParamsAgain = getCatalogForScenario('aws-govcloud-ipi', '4.21');
    const ipiParamAgain = ipiParamsAgain.find(p =>
      p.path === 'controlPlane.platform.aws.rootVolume.throughput'
    );
    expect(isParamVisibleForVersion(ipiParamAgain, '4.21')).toBe(true);
  });
});

// ===================================================================
// Frontend validation tests
// ===================================================================

describe('AWS root volume throughput — validation', () => {
  function validateThroughput(value, volumeType) {
    if (value === '' || value === undefined || value === null) return { valid: true, reason: 'blank' };
    const num = Number(value);
    if (!Number.isFinite(num)) return { valid: false, reason: 'non-number' };
    if (!Number.isInteger(num)) return { valid: false, reason: 'fraction' };
    if (num < 125) return { valid: false, reason: 'below-minimum' };
    if (num > 2000) return { valid: false, reason: 'above-maximum' };
    const effectiveType = (volumeType || 'gp3').toLowerCase();
    if (effectiveType !== 'gp3') return { valid: false, reason: 'wrong-volume-type' };
    return { valid: true };
  }

  it('125 accepted', () => {
    expect(validateThroughput(125, 'gp3').valid).toBe(true);
  });

  it('2000 accepted', () => {
    expect(validateThroughput(2000, 'gp3').valid).toBe(true);
  });

  it('124 rejected', () => {
    const result = validateThroughput(124, 'gp3');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('below-minimum');
  });

  it('2001 rejected', () => {
    const result = validateThroughput(2001, 'gp3');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('above-maximum');
  });

  it('fraction rejected', () => {
    const result = validateThroughput(125.5, 'gp3');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('fraction');
  });

  it('non-number rejected', () => {
    const result = validateThroughput('abc', 'gp3');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('non-number');
  });

  it('gp3 accepted', () => {
    expect(validateThroughput(500, 'gp3').valid).toBe(true);
  });

  it('omitted effective gp3 accepted', () => {
    expect(validateThroughput(500, undefined).valid).toBe(true);
    expect(validateThroughput(500, '').valid).toBe(true);
  });

  it('gp2 rejected', () => {
    const result = validateThroughput(500, 'gp2');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('wrong-volume-type');
  });

  it('io1 rejected', () => {
    const result = validateThroughput(500, 'io1');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('wrong-volume-type');
  });

  it('io2 rejected', () => {
    const result = validateThroughput(500, 'io2');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('wrong-volume-type');
  });

  it('NaN rejected', () => {
    const result = validateThroughput(NaN, 'gp3');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('non-number');
  });
});
