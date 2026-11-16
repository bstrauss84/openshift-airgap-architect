/**
 * Unsupported Version - Generation & Bundle Tests
 *
 * DOC-102 Slice 5F.13: assertSupportedOpenShiftVersion must reject an unsupported
 * minor before builders execute. 4.22 became supported in the v2.1 flip, so 4.23
 * carries the rejection cases here.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SUPPORTED_MINORS, isSupportedMinor, buildUnsupportedVersionError, assertSupportedOpenShiftMinorForGeneration } from '../src/versionPolicy.js';
import { getOpenShiftMinorFromState } from '../src/openShiftMinor.js';
import { buildInstallConfig } from '../src/generate.js';

describe('Unsupported Version - Shared Assertion Logic', () => {

  it('isSupportedMinor rejects 4.23', () => {
    assert.strictEqual(isSupportedMinor('4.23'), false);
  });

  it('isSupportedMinor accepts 4.22', () => {
    assert.strictEqual(isSupportedMinor('4.22'), true);
  });

  it('isSupportedMinor accepts 4.21', () => {
    assert.strictEqual(isSupportedMinor('4.21'), true);
  });

  it('isSupportedMinor accepts 4.20', () => {
    assert.strictEqual(isSupportedMinor('4.20'), true);
  });

  it('getOpenShiftMinorFromState resolves 4.22 from canonical selectedMinor', () => {
    const state = {
      version: {
        _schemaVersion: 3,
        selectedMinor: '4.22',
        selectedPatch: '4.22.1',
        locked: true
      },
      release: {
        channel: '4.21',
        patchVersion: '4.22.1',
        confirmed: true
      }
    };

    const minor = getOpenShiftMinorFromState(state);
    assert.strictEqual(minor, '4.22');
  });

  it('SUPPORTED_MINORS contains exactly 4.20, 4.21 and 4.22', () => {
    assert.deepStrictEqual(SUPPORTED_MINORS, ['4.20', '4.21', '4.22']);
  });

  it('SUPPORTED_MINORS does not include 4.23', () => {
    assert.ok(!SUPPORTED_MINORS.includes('4.23'));
  });
});

describe('Unsupported Version - Direct Error Parity', () => {
  const state423 = {
    version: { _schemaVersion: 3, selectedMinor: '4.23', selectedPatch: '4.23.1', locked: true },
    release: { channel: '4.23', patchVersion: '4.23.1', confirmed: true },
    blueprint: { platform: 'Bare Metal', baseDomain: 'example.com', clusterName: 'test-cluster' },
    methodology: { method: 'Agent-Based Installer' },
    credentials: { sshPublicKey: 'ssh-rsa test' },
    globalStrategy: { networking: { networkType: 'OVNKubernetes', machineNetworkV4: '192.168.1.0/24' } },
    hostInventory: { nodes: [] },
  };

  it('assertSupportedOpenShiftMinorForGeneration error matches buildUnsupportedVersionError shape', () => {
    const directErr = buildUnsupportedVersionError('4.23');
    let assertionErr;
    try { assertSupportedOpenShiftMinorForGeneration(state423); } catch (e) { assertionErr = e; }
    assert.strictEqual(assertionErr.code, directErr.code);
    assert.strictEqual(assertionErr.requestedVersion, directErr.requestedVersion);
    assert.deepStrictEqual(assertionErr.supportedVersions, directErr.supportedVersions);
  });

  it('buildInstallConfig throws same error shape as assertSupportedOpenShiftMinorForGeneration', () => {
    let genErr;
    try { buildInstallConfig(state423); } catch (e) { genErr = e; }
    assert.strictEqual(genErr.code, 'UNSUPPORTED_VERSION');
    assert.strictEqual(genErr.requestedVersion, '4.23');
    assert.deepStrictEqual(genErr.supportedVersions, SUPPORTED_MINORS);
  });

  it('null version error parity: direct helper vs assertion', () => {
    const directErr = buildUnsupportedVersionError(null);
    let assertionErr;
    try { assertSupportedOpenShiftMinorForGeneration({}); } catch (e) { assertionErr = e; }
    assert.strictEqual(assertionErr.code, directErr.code);
    assert.strictEqual(assertionErr.requestedVersion, directErr.requestedVersion);
    assert.deepStrictEqual(assertionErr.supportedVersions, directErr.supportedVersions);
  });
});
