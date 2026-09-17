import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import {
  computeSha256,
  buildVersionManifest,
  validateArchiveManifest,
  validateArchiveBuffer,
  crc32,
  ZIP_LIMITS,
  MANIFEST_FILENAME,
  MANIFEST_SCHEMA_VERSION,
  COMPATIBLE_STATE_SCHEMA_VERSION
} from '../src/exportIntegrity.js';
import { SUPPORTED_MINORS } from '../src/versionPolicy.js';
import { baseStates } from './fixtures/index.js';

function validManifest(overrides = {}) {
  const base = {
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    generated: {
      timestamp: '2026-09-15T00:00:00.000Z',
      appIdentity: { version: '2.0.0-dev', commit: 'abc123', buildTime: 'unknown' },
      stateSchemaVersion: COMPATIBLE_STATE_SCHEMA_VERSION,
      ...overrides.generated
    },
    openshift: {
      selectedMinor: '4.21',
      selectedPatch: '4.21.20',
      lockedVersion: true,
      ...overrides.openshift
    },
    compatibility: {
      minimumManifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      stateFormatCompatible: [3],
      warnings: [],
      ...overrides.compatibility
    },
    integrity: {
      algorithm: 'sha-256',
      format: 'lowercase-hex',
      files: {},
      ...overrides.integrity
    }
  };
  if (overrides.manifestSchemaVersion !== undefined) base.manifestSchemaVersion = overrides.manifestSchemaVersion;
  return base;
}

function fileBuffer(content) {
  return Buffer.from(content, 'utf8');
}

function manifestWithFiles(fileMap, manifestOverrides = {}) {
  const files = {};
  for (const [name, content] of Object.entries(fileMap)) {
    files[name] = computeSha256(fileBuffer(content));
  }
  return validManifest({ ...manifestOverrides, integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files } });
}

function archiveFromStrings(fileMap) {
  const entries = {};
  for (const [name, content] of Object.entries(fileMap)) {
    entries[name] = fileBuffer(content);
  }
  return entries;
}

describe('Import Integrity Validator', () => {
  describe('valid archives', () => {
    it('accepts a valid 4.21 archive with correct checksums', () => {
      const files = { 'install-config.yaml': 'apiVersion: v1\nkind: InstallConfig\n', 'imageset-config.yaml': 'kind: ImageSetConfiguration\n' };
      const manifest = manifestWithFiles(files, { openshift: { selectedMinor: '4.21', selectedPatch: '4.21.20', lockedVersion: true } });
      const archive = archiveFromStrings(files);
      const result = validateArchiveManifest(manifest, archive);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.selectedMinor, '4.21');
      assert.strictEqual(result.fileCount, 2);
    });

    it('accepts a valid 4.20 archive with correct checksums', () => {
      const files = { 'install-config.yaml': 'apiVersion: v1\n', 'FIELD_MANUAL.md': '# Field Manual\n' };
      const manifest = manifestWithFiles(files, { openshift: { selectedMinor: '4.20', selectedPatch: '4.20.8', lockedVersion: true } });
      const archive = archiveFromStrings(files);
      const result = validateArchiveManifest(manifest, archive);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.selectedMinor, '4.20');
      assert.strictEqual(result.fileCount, 2);
    });

    it('accepts single-file archive', () => {
      const files = { 'install-config.yaml': 'content' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings(files);
      const result = validateArchiveManifest(manifest, archive);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.fileCount, 1);
    });

    it('ignores version-manifest.json in archive entries', () => {
      const files = { 'install-config.yaml': 'content' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings(files);
      archive[MANIFEST_FILENAME] = fileBuffer('{"manifest":"data"}');
      const result = validateArchiveManifest(manifest, archive);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.fileCount, 1);
    });

    it('accepts nested directory paths', () => {
      const files = { 'mirror-output/subdir/file.txt': 'nested content', 'install-config.yaml': 'config' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings(files);
      const result = validateArchiveManifest(manifest, archive);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.fileCount, 2);
    });

    it('returns schema and version metadata on success', () => {
      const files = { 'test.yaml': 'data' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings(files);
      const result = validateArchiveManifest(manifest, archive);
      assert.strictEqual(result.manifestSchemaVersion, MANIFEST_SCHEMA_VERSION);
      assert.strictEqual(result.stateSchemaVersion, COMPATIBLE_STATE_SCHEMA_VERSION);
    });

    it('round-trips through buildVersionManifest', () => {
      const state = baseStates.bareMetalAgent({
        version: { selectedMinor: '4.21', selectedPatch: '4.21.15', locked: true },
        release: { channel: '4.21', patchVersion: '4.21.15', confirmed: true }
      });
      const fileContents = { 'install-config.yaml': 'apiVersion: v1', 'agent-config.yaml': 'agentConfig' };
      const checksums = {};
      for (const [name, content] of Object.entries(fileContents)) {
        checksums[name] = computeSha256(fileBuffer(content));
      }
      const manifest = buildVersionManifest(state, checksums);
      const archive = archiveFromStrings(fileContents);
      const result = validateArchiveManifest(manifest, archive);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.selectedMinor, '4.21');
    });
  });

  describe('malformed/non-object manifest', () => {
    it('rejects null manifest', () => {
      assert.throws(() => validateArchiveManifest(null, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        return true;
      });
    });

    it('rejects undefined manifest', () => {
      assert.throws(() => validateArchiveManifest(undefined, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        return true;
      });
    });

    it('rejects string manifest', () => {
      assert.throws(() => validateArchiveManifest('not an object', {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        return true;
      });
    });

    it('rejects array manifest', () => {
      assert.throws(() => validateArchiveManifest([], {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        return true;
      });
    });

    it('rejects number manifest', () => {
      assert.throws(() => validateArchiveManifest(42, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        return true;
      });
    });
  });

  describe('unsupported manifestSchemaVersion', () => {
    it('rejects version 2.0.0', () => {
      const manifest = validManifest({ manifestSchemaVersion: '2.0.0' });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'UNSUPPORTED_MANIFEST_SCHEMA');
        assert.strictEqual(err.details.received, '2.0.0');
        assert.strictEqual(err.details.expected, MANIFEST_SCHEMA_VERSION);
        return true;
      });
    });

    it('rejects missing manifestSchemaVersion as malformed', () => {
      const manifest = validManifest();
      delete manifest.manifestSchemaVersion;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'manifestSchemaVersion');
        return true;
      });
    });

    it('rejects numeric manifestSchemaVersion as malformed', () => {
      const manifest = validManifest({ manifestSchemaVersion: 1 });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'manifestSchemaVersion');
        return true;
      });
    });
  });

  describe('incompatible stateSchemaVersion', () => {
    it('rejects stateSchemaVersion 2', () => {
      const manifest = validManifest({ generated: { stateSchemaVersion: 2 } });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'INCOMPATIBLE_STATE_SCHEMA');
        assert.strictEqual(err.details.received, 2);
        assert.strictEqual(err.details.expected, COMPATIBLE_STATE_SCHEMA_VERSION);
        return true;
      });
    });

    it('rejects stateSchemaVersion 4', () => {
      const manifest = validManifest({ generated: { stateSchemaVersion: 4 } });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'INCOMPATIBLE_STATE_SCHEMA');
        assert.strictEqual(err.details.received, 4);
        return true;
      });
    });

    it('rejects missing generated section', () => {
      const manifest = validManifest();
      delete manifest.generated;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        return true;
      });
    });

    it('rejects null generated section', () => {
      const manifest = validManifest();
      manifest.generated = null;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        return true;
      });
    });
  });

  describe('unsupported openshift.selectedMinor', () => {
    it('rejects 4.22 with UNSUPPORTED_VERSION', () => {
      const manifest = validManifest({ openshift: { selectedMinor: '4.22', selectedPatch: '4.22.1', lockedVersion: true } });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'UNSUPPORTED_VERSION');
        assert.strictEqual(err.details.received, '4.22');
        assert.deepStrictEqual(err.details.supportedVersions, [...SUPPORTED_MINORS]);
        return true;
      });
    });

    it('rejects 4.19 with UNSUPPORTED_VERSION', () => {
      const manifest = validManifest({ openshift: { selectedMinor: '4.19' } });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'UNSUPPORTED_VERSION');
        assert.strictEqual(err.details.received, '4.19');
        return true;
      });
    });

    it('rejects null selectedMinor as malformed', () => {
      const manifest = validManifest({ openshift: { selectedMinor: null, selectedPatch: '4.21.20', lockedVersion: true } });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'openshift.selectedMinor');
        return true;
      });
    });

    it('rejects missing openshift section', () => {
      const manifest = validManifest();
      delete manifest.openshift;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        return true;
      });
    });

    it('does not fall back from 4.22 to 4.21', () => {
      const files = { 'install-config.yaml': 'content' };
      const manifest = manifestWithFiles(files, { openshift: { selectedMinor: '4.22', selectedPatch: '4.22.1', lockedVersion: true } });
      const archive = archiveFromStrings(files);
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.strictEqual(err.code, 'UNSUPPORTED_VERSION');
        return true;
      });
    });
  });

  describe('invalid checksum algorithm', () => {
    it('rejects sha-512 algorithm', () => {
      const manifest = validManifest({ integrity: { algorithm: 'sha-512', format: 'lowercase-hex', files: {} } });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'INVALID_CHECKSUM_ALGORITHM');
        assert.strictEqual(err.details.received, 'sha-512');
        return true;
      });
    });

    it('rejects missing integrity section', () => {
      const manifest = validManifest();
      delete manifest.integrity;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        return true;
      });
    });

    it('rejects missing integrity.files', () => {
      const manifest = validManifest();
      delete manifest.integrity.files;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        return true;
      });
    });
  });

  describe('invalid checksum format', () => {
    it('rejects checksum without sha256: prefix', () => {
      const manifest = validManifest({ integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { 'test.yaml': 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' } } });
      assert.throws(() => validateArchiveManifest(manifest, { 'test.yaml': fileBuffer('x') }), (err) => {
        assert.strictEqual(err.code, 'INVALID_CHECKSUM_FORMAT');
        assert.strictEqual(err.details.file, 'test.yaml');
        return true;
      });
    });

    it('rejects checksum with uppercase hex', () => {
      const manifest = validManifest({ integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { 'test.yaml': 'sha256:ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789' } } });
      assert.throws(() => validateArchiveManifest(manifest, { 'test.yaml': fileBuffer('x') }), (err) => {
        assert.strictEqual(err.code, 'INVALID_CHECKSUM_FORMAT');
        return true;
      });
    });

    it('rejects checksum with wrong length', () => {
      const manifest = validManifest({ integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { 'test.yaml': 'sha256:abcdef' } } });
      assert.throws(() => validateArchiveManifest(manifest, { 'test.yaml': fileBuffer('x') }), (err) => {
        assert.strictEqual(err.code, 'INVALID_CHECKSUM_FORMAT');
        return true;
      });
    });

    it('rejects non-string checksum value', () => {
      const manifest = validManifest({ integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { 'test.yaml': 12345 } } });
      assert.throws(() => validateArchiveManifest(manifest, { 'test.yaml': fileBuffer('x') }), (err) => {
        assert.strictEqual(err.code, 'INVALID_CHECKSUM_FORMAT');
        return true;
      });
    });
  });

  describe('checksum mismatch', () => {
    it('detects single-byte content mutation', () => {
      const files = { 'install-config.yaml': 'original content' };
      const manifest = manifestWithFiles(files);
      const archive = { 'install-config.yaml': fileBuffer('Original content') };
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.strictEqual(err.code, 'CHECKSUM_MISMATCH');
        assert.strictEqual(err.details.file, 'install-config.yaml');
        assert.ok(err.details.expected);
        assert.ok(err.details.computed);
        assert.notStrictEqual(err.details.expected, err.details.computed);
        return true;
      });
    });

    it('detects trailing newline difference', () => {
      const files = { 'config.yaml': 'data' };
      const manifest = manifestWithFiles(files);
      const archive = { 'config.yaml': fileBuffer('data\n') };
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.strictEqual(err.code, 'CHECKSUM_MISMATCH');
        return true;
      });
    });

    it('detects empty-vs-non-empty content', () => {
      const files = { 'config.yaml': '' };
      const manifest = manifestWithFiles(files);
      const archive = { 'config.yaml': fileBuffer('non-empty') };
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.strictEqual(err.code, 'CHECKSUM_MISMATCH');
        return true;
      });
    });

    it('exact byte sensitivity - whitespace variants', () => {
      const files = { 'config.yaml': 'key: value' };
      const manifest = manifestWithFiles(files);
      const archive = { 'config.yaml': fileBuffer('key:  value') };
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.strictEqual(err.code, 'CHECKSUM_MISMATCH');
        return true;
      });
    });
  });

  describe('missing file referenced by manifest', () => {
    it('rejects when manifest references a file not in archive', () => {
      const manifest = validManifest({ integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { 'install-config.yaml': computeSha256(fileBuffer('x')) } } });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MISSING_FILE');
        assert.strictEqual(err.details.file, 'install-config.yaml');
        return true;
      });
    });

    it('rejects when one of multiple files is missing', () => {
      const files = { 'a.yaml': 'a', 'b.yaml': 'b' };
      const manifest = manifestWithFiles(files);
      const archive = { 'a.yaml': fileBuffer('a') };
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.strictEqual(err.code, 'MISSING_FILE');
        assert.strictEqual(err.details.file, 'b.yaml');
        return true;
      });
    });
  });

  describe('unlisted file in archive', () => {
    it('rejects archive file without checksum coverage', () => {
      const files = { 'install-config.yaml': 'content' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings({ ...files, 'extra-file.txt': 'surprise' });
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.strictEqual(err.code, 'UNLISTED_FILE');
        assert.strictEqual(err.details.file, 'extra-file.txt');
        return true;
      });
    });

    it('rejects archive with only unlisted files', () => {
      const manifest = validManifest();
      assert.throws(() => validateArchiveManifest(manifest, { 'rogue.txt': fileBuffer('data') }), (err) => {
        assert.strictEqual(err.code, 'UNLISTED_FILE');
        return true;
      });
    });
  });

  describe('manifest self-reference', () => {
    it('rejects version-manifest.json in integrity.files', () => {
      const checksum = computeSha256(fileBuffer('manifest content'));
      const manifest = validManifest({ integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { [MANIFEST_FILENAME]: checksum } } });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MANIFEST_SELF_REFERENCE');
        return true;
      });
    });

    it('rejects manifest self-reference even with other valid files', () => {
      const files = { 'install-config.yaml': 'content' };
      const checksums = {
        'install-config.yaml': computeSha256(fileBuffer('content')),
        [MANIFEST_FILENAME]: computeSha256(fileBuffer('self'))
      };
      const manifest = validManifest({ integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: checksums } });
      assert.throws(() => validateArchiveManifest(manifest, archiveFromStrings(files)), (err) => {
        assert.strictEqual(err.code, 'MANIFEST_SELF_REFERENCE');
        return true;
      });
    });
  });

  describe('bidirectional coverage enforcement', () => {
    it('accepts exactly matching sets', () => {
      const files = { 'a.yaml': 'aa', 'b.yaml': 'bb', 'c.yaml': 'cc' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings(files);
      const result = validateArchiveManifest(manifest, archive);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.fileCount, 3);
    });

    it('rejects manifest-only entries', () => {
      const files = { 'a.yaml': 'aa', 'b.yaml': 'bb' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings({ 'a.yaml': 'aa' });
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.strictEqual(err.code, 'MISSING_FILE');
        return true;
      });
    });

    it('rejects archive-only entries', () => {
      const files = { 'a.yaml': 'aa' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings({ 'a.yaml': 'aa', 'b.yaml': 'bb' });
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.strictEqual(err.code, 'UNLISTED_FILE');
        return true;
      });
    });
  });

  describe('exact entry name matching', () => {
    it('treats paths as case-sensitive', () => {
      const manifest = manifestWithFiles({ 'Install-Config.yaml': 'content' });
      const archive = archiveFromStrings({ 'install-config.yaml': 'content' });
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.ok(err.code === 'MISSING_FILE' || err.code === 'UNLISTED_FILE');
        return true;
      });
    });

    it('does not normalize slashes', () => {
      const manifest = manifestWithFiles({ 'dir/file.txt': 'content' });
      const archive = archiveFromStrings({ 'dir\\file.txt': 'content' });
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.ok(err.code === 'MISSING_FILE' || err.code === 'UNLISTED_FILE');
        return true;
      });
    });

    it('does not strip leading dot-slash', () => {
      const manifest = manifestWithFiles({ './file.txt': 'content' });
      const archive = archiveFromStrings({ 'file.txt': 'content' });
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.ok(err.code === 'MISSING_FILE' || err.code === 'UNLISTED_FILE');
        return true;
      });
    });
  });

  describe('does not mutate inputs', () => {
    it('manifest object is unchanged after validation', () => {
      const files = { 'test.yaml': 'data' };
      const manifest = manifestWithFiles(files);
      const manifestSnapshot = JSON.stringify(manifest);
      const archive = archiveFromStrings(files);
      validateArchiveManifest(manifest, archive);
      assert.strictEqual(JSON.stringify(manifest), manifestSnapshot);
    });

    it('archive entries are unchanged after validation', () => {
      const files = { 'test.yaml': 'data' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings(files);
      const originalBytes = Buffer.from(archive['test.yaml']);
      validateArchiveManifest(manifest, archive);
      assert.ok(archive['test.yaml'].equals(originalBytes));
    });
  });

  describe('Uint8Array input support', () => {
    it('accepts Uint8Array file content', () => {
      const content = 'uint8 test content';
      const files = { 'test.yaml': content };
      const manifest = manifestWithFiles(files);
      const archive = { 'test.yaml': new Uint8Array(fileBuffer(content)) };
      const result = validateArchiveManifest(manifest, archive);
      assert.strictEqual(result.valid, true);
    });
  });

  describe('archiveEntries input validation', () => {
    it('rejects null archiveEntries', () => {
      const manifest = validManifest();
      assert.throws(() => validateArchiveManifest(manifest, null), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        return true;
      });
    });

    it('rejects array archiveEntries', () => {
      const manifest = validManifest();
      assert.throws(() => validateArchiveManifest(manifest, []), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        return true;
      });
    });
  });

  describe('conditional and nested entry names', () => {
    it('validates agent-config.yaml when present', () => {
      const files = { 'install-config.yaml': 'install', 'agent-config.yaml': 'agent' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings(files);
      const result = validateArchiveManifest(manifest, archive);
      assert.strictEqual(result.valid, true);
    });

    it('validates deeply nested paths', () => {
      const files = { 'mirror-output/registry/images/sha256/abc123': 'image data', 'install-config.yaml': 'config' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings(files);
      const result = validateArchiveManifest(manifest, archive);
      assert.strictEqual(result.valid, true);
    });

    it('detects mismatch in nested path content', () => {
      const files = { 'tools/oc': 'binary-v1', 'install-config.yaml': 'config' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings({ 'tools/oc': 'binary-v2', 'install-config.yaml': 'config' });
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.strictEqual(err.code, 'CHECKSUM_MISMATCH');
        assert.strictEqual(err.details.file, 'tools/oc');
        return true;
      });
    });
  });

  describe('required generated identity fields', () => {
    it('rejects missing generated.timestamp', () => {
      const manifest = validManifest();
      delete manifest.generated.timestamp;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.ok(err.message.includes('generated.timestamp'));
        return true;
      });
    });

    it('rejects non-string generated.timestamp', () => {
      const manifest = validManifest();
      manifest.generated.timestamp = 12345;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'generated.timestamp');
        return true;
      });
    });

    it('rejects missing generated.appIdentity', () => {
      const manifest = validManifest();
      delete manifest.generated.appIdentity;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.ok(err.message.includes('appIdentity'));
        return true;
      });
    });

    it('rejects null generated.appIdentity', () => {
      const manifest = validManifest();
      manifest.generated.appIdentity = null;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        return true;
      });
    });

    it('rejects missing generated.appIdentity.version', () => {
      const manifest = validManifest();
      delete manifest.generated.appIdentity.version;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'generated.appIdentity.version');
        return true;
      });
    });

    it('rejects missing generated.appIdentity.commit', () => {
      const manifest = validManifest();
      delete manifest.generated.appIdentity.commit;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'generated.appIdentity.commit');
        return true;
      });
    });

    it('rejects missing generated.appIdentity.buildTime', () => {
      const manifest = validManifest();
      delete manifest.generated.appIdentity.buildTime;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'generated.appIdentity.buildTime');
        return true;
      });
    });

    it('rejects numeric appIdentity.version', () => {
      const manifest = validManifest();
      manifest.generated.appIdentity.version = 2;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'generated.appIdentity.version');
        return true;
      });
    });
  });

  describe('required openshift fields', () => {
    it('rejects missing openshift.selectedPatch', () => {
      const manifest = validManifest();
      delete manifest.openshift.selectedPatch;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'openshift.selectedPatch');
        return true;
      });
    });

    it('rejects numeric openshift.selectedPatch', () => {
      const manifest = validManifest();
      manifest.openshift.selectedPatch = 421;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'openshift.selectedPatch');
        return true;
      });
    });

    it('rejects missing openshift.lockedVersion', () => {
      const manifest = validManifest();
      delete manifest.openshift.lockedVersion;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.ok(err.message.includes('lockedVersion'));
        return true;
      });
    });

    it('rejects string openshift.lockedVersion', () => {
      const manifest = validManifest();
      manifest.openshift.lockedVersion = 'true';
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'openshift.lockedVersion');
        return true;
      });
    });

    it('rejects lockedVersion false with UNLOCKED_VERSION', () => {
      const files = { 'test.yaml': 'data' };
      const manifest = manifestWithFiles(files, { openshift: { selectedMinor: '4.21', selectedPatch: '4.21.20', lockedVersion: false } });
      const archive = archiveFromStrings(files);
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.strictEqual(err.code, 'UNLOCKED_VERSION');
        assert.strictEqual(err.details.received, false);
        return true;
      });
    });
  });

  describe('required compatibility fields', () => {
    it('rejects missing compatibility section', () => {
      const manifest = validManifest();
      delete manifest.compatibility;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.ok(err.message.includes('compatibility'));
        return true;
      });
    });

    it('rejects null compatibility section', () => {
      const manifest = validManifest();
      manifest.compatibility = null;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        return true;
      });
    });

    it('rejects missing compatibility.minimumManifestSchemaVersion', () => {
      const manifest = validManifest();
      delete manifest.compatibility.minimumManifestSchemaVersion;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'compatibility.minimumManifestSchemaVersion');
        return true;
      });
    });

    it('rejects numeric compatibility.minimumManifestSchemaVersion', () => {
      const manifest = validManifest();
      manifest.compatibility.minimumManifestSchemaVersion = 1;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'compatibility.minimumManifestSchemaVersion');
        return true;
      });
    });

    it('rejects missing compatibility.stateFormatCompatible', () => {
      const manifest = validManifest();
      delete manifest.compatibility.stateFormatCompatible;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'compatibility.stateFormatCompatible');
        return true;
      });
    });

    it('rejects non-array compatibility.stateFormatCompatible', () => {
      const manifest = validManifest();
      manifest.compatibility.stateFormatCompatible = 3;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'compatibility.stateFormatCompatible');
        return true;
      });
    });
  });

  describe('required integrity.format field', () => {
    it('rejects missing integrity.format', () => {
      const manifest = validManifest();
      delete manifest.integrity.format;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.ok(err.message.includes('integrity.format'));
        return true;
      });
    });

    it('rejects wrong integrity.format value', () => {
      const manifest = validManifest();
      manifest.integrity.format = 'base64';
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'integrity.format');
        assert.strictEqual(err.details.received, 'base64');
        return true;
      });
    });
  });

  describe('name collision detection', () => {
    it('detects dot-dot traversal collision in checksum keys: b.yaml vs a/../b.yaml', () => {
      const checksum = computeSha256(fileBuffer('content'));
      const manifest = validManifest({
        integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { 'b.yaml': checksum, 'a/../b.yaml': checksum } }
      });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'NAME_COLLISION');
        assert.strictEqual(err.details.normalized, 'b.yaml');
        return true;
      });
    });

    it('detects dot-slash collision in checksum keys: file.txt vs ./file.txt', () => {
      const checksum = computeSha256(fileBuffer('content'));
      const manifest = validManifest({
        integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { 'file.txt': checksum, './file.txt': checksum } }
      });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'NAME_COLLISION');
        assert.strictEqual(err.details.normalized, 'file.txt');
        return true;
      });
    });

    it('detects collision in archive entries: b.yaml vs a/../b.yaml', () => {
      const files = { 'b.yaml': 'content' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings(files);
      archive['a/../b.yaml'] = fileBuffer('other');
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.strictEqual(err.code, 'NAME_COLLISION');
        assert.strictEqual(err.details.normalized, 'b.yaml');
        return true;
      });
    });

    it('detects collision in archive entries: file.txt vs ./file.txt', () => {
      const files = { 'file.txt': 'content' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings(files);
      archive['./file.txt'] = fileBuffer('other');
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.strictEqual(err.code, 'NAME_COLLISION');
        assert.strictEqual(err.details.normalized, 'file.txt');
        return true;
      });
    });

    it('detects deep traversal collision: dir/sub/file vs dir/other/../sub/file', () => {
      const checksum = computeSha256(fileBuffer('content'));
      const manifest = validManifest({
        integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { 'dir/sub/file': checksum, 'dir/other/../sub/file': checksum } }
      });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'NAME_COLLISION');
        assert.strictEqual(err.details.normalized, 'dir/sub/file');
        return true;
      });
    });

    it('does not false-positive on legitimately distinct paths', () => {
      const files = { 'a/b.yaml': 'content1', 'c/b.yaml': 'content2' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings(files);
      const result = validateArchiveManifest(manifest, archive);
      assert.strictEqual(result.valid, true);
    });

    it('reports both colliding literal names', () => {
      const checksum = computeSha256(fileBuffer('data'));
      const manifest = validManifest({
        integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { 'config.yaml': checksum, './config.yaml': checksum } }
      });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'NAME_COLLISION');
        assert.strictEqual(err.details.first, 'config.yaml');
        assert.strictEqual(err.details.second, './config.yaml');
        return true;
      });
    });
  });

  describe('manifest filename alias rejection', () => {
    it('rejects ./version-manifest.json in checksum keys', () => {
      const checksum = computeSha256(fileBuffer('data'));
      const manifest = validManifest({
        integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { './version-manifest.json': checksum } }
      });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MANIFEST_SELF_REFERENCE');
        assert.strictEqual(err.details.file, './version-manifest.json');
        assert.strictEqual(err.details.normalized, MANIFEST_FILENAME);
        return true;
      });
    });

    it('rejects dir/../version-manifest.json in checksum keys', () => {
      const checksum = computeSha256(fileBuffer('data'));
      const manifest = validManifest({
        integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { 'dir/../version-manifest.json': checksum } }
      });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MANIFEST_SELF_REFERENCE');
        assert.strictEqual(err.details.normalized, MANIFEST_FILENAME);
        return true;
      });
    });

    it('rejects ./version-manifest.json in archive entries', () => {
      const files = { 'install-config.yaml': 'content' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings(files);
      archive['./version-manifest.json'] = fileBuffer('alias');
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.strictEqual(err.code, 'MANIFEST_SELF_REFERENCE');
        assert.strictEqual(err.details.file, './version-manifest.json');
        return true;
      });
    });

    it('rejects dir/../version-manifest.json in archive entries', () => {
      const files = { 'install-config.yaml': 'content' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings(files);
      archive['dir/../version-manifest.json'] = fileBuffer('alias');
      assert.throws(() => validateArchiveManifest(manifest, archive), (err) => {
        assert.strictEqual(err.code, 'MANIFEST_SELF_REFERENCE');
        assert.strictEqual(err.details.normalized, MANIFEST_FILENAME);
        return true;
      });
    });

    it('does not reject non-manifest paths containing manifest filename as substring', () => {
      const files = { 'not-version-manifest.json': 'data', 'install-config.yaml': 'config' };
      const manifest = manifestWithFiles(files);
      const archive = archiveFromStrings(files);
      const result = validateArchiveManifest(manifest, archive);
      assert.strictEqual(result.valid, true);
    });
  });

  describe('compatibility.warnings validation', () => {
    it('rejects missing compatibility.warnings', () => {
      const manifest = validManifest();
      delete manifest.compatibility.warnings;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'compatibility.warnings');
        return true;
      });
    });

    it('rejects non-array compatibility.warnings', () => {
      const manifest = validManifest();
      manifest.compatibility.warnings = 'none';
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'compatibility.warnings');
        return true;
      });
    });

    it('accepts empty warnings array', () => {
      const files = { 'test.yaml': 'data' };
      const manifest = manifestWithFiles(files, { compatibility: { minimumManifestSchemaVersion: MANIFEST_SCHEMA_VERSION, stateFormatCompatible: [3], warnings: [] } });
      const archive = archiveFromStrings(files);
      const result = validateArchiveManifest(manifest, archive);
      assert.strictEqual(result.valid, true);
    });

    it('accepts non-empty warnings array', () => {
      const files = { 'test.yaml': 'data' };
      const manifest = manifestWithFiles(files, { compatibility: { minimumManifestSchemaVersion: MANIFEST_SCHEMA_VERSION, stateFormatCompatible: [3], warnings: ['some warning'] } });
      const archive = archiveFromStrings(files);
      const result = validateArchiveManifest(manifest, archive);
      assert.strictEqual(result.valid, true);
    });
  });

  describe('compatibility semantic conflict detection', () => {
    it('rejects minimumManifestSchemaVersion higher than supported', () => {
      const manifest = validManifest({ compatibility: { minimumManifestSchemaVersion: '2.0.0', stateFormatCompatible: [3], warnings: [] } });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'INCOMPATIBLE_MANIFEST_SCHEMA');
        assert.strictEqual(err.details.received, '2.0.0');
        assert.strictEqual(err.details.supported, MANIFEST_SCHEMA_VERSION);
        return true;
      });
    });

    it('rejects stateFormatCompatible that excludes current schema', () => {
      const manifest = validManifest({ compatibility: { minimumManifestSchemaVersion: MANIFEST_SCHEMA_VERSION, stateFormatCompatible: [4, 5], warnings: [] } });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'INCOMPATIBLE_STATE_SCHEMA');
        assert.deepStrictEqual(err.details.received, [4, 5]);
        assert.strictEqual(err.details.expected, COMPATIBLE_STATE_SCHEMA_VERSION);
        return true;
      });
    });

    it('rejects empty stateFormatCompatible', () => {
      const manifest = validManifest({ compatibility: { minimumManifestSchemaVersion: MANIFEST_SCHEMA_VERSION, stateFormatCompatible: [], warnings: [] } });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'INCOMPATIBLE_STATE_SCHEMA');
        return true;
      });
    });
  });

  describe('discriminator field type classification', () => {
    it('missing stateSchemaVersion is MALFORMED_MANIFEST not INCOMPATIBLE', () => {
      const manifest = validManifest();
      delete manifest.generated.stateSchemaVersion;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'generated.stateSchemaVersion');
        return true;
      });
    });

    it('string stateSchemaVersion is MALFORMED_MANIFEST not INCOMPATIBLE', () => {
      const manifest = validManifest();
      manifest.generated.stateSchemaVersion = '3';
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'generated.stateSchemaVersion');
        return true;
      });
    });

    it('well-formed unsupported stateSchemaVersion 4 is INCOMPATIBLE_STATE_SCHEMA', () => {
      const manifest = validManifest();
      manifest.generated.stateSchemaVersion = 4;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'INCOMPATIBLE_STATE_SCHEMA');
        assert.strictEqual(err.details.received, 4);
        return true;
      });
    });

    it('missing selectedMinor is MALFORMED_MANIFEST not UNSUPPORTED_VERSION', () => {
      const manifest = validManifest();
      delete manifest.openshift.selectedMinor;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'openshift.selectedMinor');
        return true;
      });
    });

    it('numeric selectedMinor is MALFORMED_MANIFEST not UNSUPPORTED_VERSION', () => {
      const manifest = validManifest();
      manifest.openshift.selectedMinor = 421;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'openshift.selectedMinor');
        return true;
      });
    });

    it('well-formed unsupported selectedMinor 4.22 is UNSUPPORTED_VERSION', () => {
      const manifest = validManifest({ openshift: { selectedMinor: '4.22', selectedPatch: '4.22.1', lockedVersion: true } });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'UNSUPPORTED_VERSION');
        assert.strictEqual(err.details.received, '4.22');
        return true;
      });
    });

    it('missing integrity.algorithm is MALFORMED_MANIFEST not INVALID_CHECKSUM_ALGORITHM', () => {
      const manifest = validManifest();
      delete manifest.integrity.algorithm;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'integrity.algorithm');
        return true;
      });
    });

    it('numeric integrity.algorithm is MALFORMED_MANIFEST not INVALID_CHECKSUM_ALGORITHM', () => {
      const manifest = validManifest();
      manifest.integrity.algorithm = 256;
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.strictEqual(err.details.field, 'integrity.algorithm');
        return true;
      });
    });

    it('well-formed wrong algorithm sha-512 is INVALID_CHECKSUM_ALGORITHM', () => {
      const manifest = validManifest({ integrity: { algorithm: 'sha-512', format: 'lowercase-hex', files: {} } });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'INVALID_CHECKSUM_ALGORITHM');
        return true;
      });
    });
  });

  describe('unlocked version rejection', () => {
    it('rejects lockedVersion false with stable UNLOCKED_VERSION code', () => {
      const manifest = validManifest({ openshift: { selectedMinor: '4.20', selectedPatch: '4.20.8', lockedVersion: false } });
      assert.throws(() => validateArchiveManifest(manifest, {}), (err) => {
        assert.strictEqual(err.code, 'UNLOCKED_VERSION');
        assert.strictEqual(err.details.received, false);
        return true;
      });
    });
  });
});

function buildZipBuffer(fileEntries, options = {}) {
  const processed = fileEntries.map(fe => {
    const nameBytes = fe.rawName ?? Buffer.from(fe.name, 'utf8');
    const content = Buffer.isBuffer(fe.content) ? fe.content : Buffer.from(fe.content || '', 'utf8');
    const method = fe.method ?? 8;
    const flags = fe.flags ?? 0;
    const versionMadeBy = fe.versionMadeBy ?? ((3 << 8) | 20);
    const externalAttrs = fe.externalAttrs ?? ((0o100644 << 16) >>> 0);

    let compressedData;
    if (method === 0) {
      compressedData = content;
    } else if (method === 8) {
      compressedData = zlib.deflateRawSync(content);
    } else {
      compressedData = content;
    }

    return {
      nameBytes, content, compressedData, method, flags, versionMadeBy, externalAttrs,
      crc32Val: fe.crc32Override ?? crc32(content),
      compressedSize: fe.compressedSizeOverride ?? compressedData.length,
      uncompressedSize: fe.uncompressedSizeOverride ?? content.length,
      versionNeeded: fe.versionNeeded ?? 20,
      localFlags: fe.localFlags,
      localMethod: fe.localMethod,
      localCrc32Override: fe.localCrc32Override,
      localCompressedSizeOverride: fe.localCompressedSizeOverride,
      localUncompressedSizeOverride: fe.localUncompressedSizeOverride,
      localVersionNeeded: fe.localVersionNeeded,
      centralExtra: fe.centralExtra,
      localExtra: fe.localExtra
    };
  });

  const parts = [];
  let offset = 0;
  const localOffsets = [];

  for (const entry of processed) {
    localOffsets.push(offset);
    const localExtra = entry.localExtra || Buffer.alloc(0);
    const hasDD = (entry.flags & 0x08) !== 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(entry.localVersionNeeded ?? entry.versionNeeded, 4);
    header.writeUInt16LE(entry.localFlags ?? entry.flags, 6);
    header.writeUInt16LE(entry.localMethod ?? entry.method, 8);
    if (hasDD) {
      header.writeUInt32LE(entry.localCrc32Override ?? 0, 14);
      header.writeUInt32LE(entry.localCompressedSizeOverride ?? 0, 18);
      header.writeUInt32LE(entry.localUncompressedSizeOverride ?? 0, 22);
    } else {
      header.writeUInt32LE(entry.localCrc32Override ?? entry.crc32Val, 14);
      header.writeUInt32LE(entry.localCompressedSizeOverride ?? entry.compressedSize, 18);
      header.writeUInt32LE(entry.localUncompressedSizeOverride ?? entry.uncompressedSize, 22);
    }
    header.writeUInt16LE(entry.nameBytes.length, 26);
    header.writeUInt16LE(localExtra.length, 28);
    parts.push(header, entry.nameBytes, localExtra, entry.compressedData);
    offset += header.length + entry.nameBytes.length + localExtra.length + entry.compressedData.length;

    if (hasDD) {
      const dd = Buffer.alloc(16);
      dd.writeUInt32LE(0x08074b50, 0);
      dd.writeUInt32LE(entry.crc32Val, 4);
      dd.writeUInt32LE(entry.compressedSize, 8);
      dd.writeUInt32LE(entry.uncompressedSize, 12);
      parts.push(dd);
      offset += 16;
    }
  }

  const cdOffset = offset;
  const cdParts = [];
  for (let i = 0; i < processed.length; i++) {
    const entry = processed[i];
    const centralExtra = entry.centralExtra || Buffer.alloc(0);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(entry.versionMadeBy, 4);
    cd.writeUInt16LE(entry.versionNeeded, 6);
    cd.writeUInt16LE(entry.flags, 8);
    cd.writeUInt16LE(entry.method, 10);
    cd.writeUInt32LE(entry.crc32Val, 16);
    cd.writeUInt32LE(entry.compressedSize, 20);
    cd.writeUInt32LE(entry.uncompressedSize, 24);
    cd.writeUInt16LE(entry.nameBytes.length, 28);
    cd.writeUInt16LE(centralExtra.length, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(entry.externalAttrs, 38);
    cd.writeUInt32LE(localOffsets[i], 42);
    cdParts.push(cd, entry.nameBytes, centralExtra);
  }
  const centralDir = Buffer.concat(cdParts);

  const extraParts = [];
  if (options.injectZip64Locator) {
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    extraParts.push(locator);
  }
  if (options.cdPadding) {
    extraParts.unshift(options.cdPadding);
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(processed.length, 8);
  eocd.writeUInt16LE(processed.length, 10);
  eocd.writeUInt32LE(options.cdSizeOverride ?? centralDir.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, centralDir, ...extraParts, eocd]);
}

function buildManifestZip(fileMap, manifestOverrides = {}, zipOptions = {}) {
  const checksums = {};
  for (const [name, content] of Object.entries(fileMap)) {
    checksums[name] = computeSha256(Buffer.from(content, 'utf8'));
  }
  const manifest = validManifest({
    ...manifestOverrides,
    integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: checksums }
  });
  const manifestJson = JSON.stringify(manifest, null, 2);
  const method = zipOptions.method ?? 8;
  const entries = Object.entries(fileMap).map(([name, content]) => ({ name, content, method }));
  entries.push({ name: MANIFEST_FILENAME, content: manifestJson, method });
  return buildZipBuffer(entries, zipOptions);
}

describe('Archive Buffer Validator (validateArchiveBuffer)', () => {
  describe('valid archives', () => {
    it('accepts a valid deflate-compressed archive with correct manifest', () => {
      const files = { 'install-config.yaml': 'apiVersion: v1\n', 'imageset-config.yaml': 'kind: ImageSetConfiguration\n' };
      const zip = buildManifestZip(files, { openshift: { selectedMinor: '4.21', selectedPatch: '4.21.20', lockedVersion: true } });
      const result = validateArchiveBuffer(zip);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.selectedMinor, '4.21');
      assert.strictEqual(result.fileCount, 2);
      assert.ok(result.manifest);
      assert.ok(result.entries);
    });

    it('accepts a valid stored-compression archive', () => {
      const files = { 'install-config.yaml': 'content' };
      const zip = buildManifestZip(files, {}, { method: 0 });
      const result = validateArchiveBuffer(zip);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.fileCount, 1);
    });

    it('returns parsed manifest in result', () => {
      const files = { 'test.yaml': 'data' };
      const zip = buildManifestZip(files);
      const result = validateArchiveBuffer(zip);
      assert.strictEqual(result.manifest.manifestSchemaVersion, MANIFEST_SCHEMA_VERSION);
      assert.ok(result.manifest.integrity);
      assert.ok(result.manifest.integrity.files['test.yaml']);
    });

    it('returns extracted entry buffers in result', () => {
      const files = { 'test.yaml': 'test data content' };
      const zip = buildManifestZip(files);
      const result = validateArchiveBuffer(zip);
      assert.ok(Buffer.isBuffer(result.entries['test.yaml']));
      assert.strictEqual(result.entries['test.yaml'].toString('utf8'), 'test data content');
      assert.ok(result.entries[MANIFEST_FILENAME]);
    });

    it('accepts mixed stored and deflate entries', () => {
      const fileContent = 'mixed content test';
      const checksum = computeSha256(Buffer.from(fileContent, 'utf8'));
      const manifest = validManifest({
        integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { 'stored.txt': checksum } }
      });
      const zip = buildZipBuffer([
        { name: 'stored.txt', content: fileContent, method: 0 },
        { name: MANIFEST_FILENAME, content: JSON.stringify(manifest), method: 8 }
      ]);
      const result = validateArchiveBuffer(zip);
      assert.strictEqual(result.valid, true);
    });

    it('accepts archive with nested directory paths', () => {
      const files = { 'mirror-output/subdir/file.txt': 'nested', 'install-config.yaml': 'config' };
      const zip = buildManifestZip(files);
      const result = validateArchiveBuffer(zip);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.fileCount, 2);
    });

    it('skips directory entries without error', () => {
      const fileContent = 'data';
      const checksum = computeSha256(Buffer.from(fileContent, 'utf8'));
      const manifest = validManifest({
        integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { 'file.txt': checksum } }
      });
      const zip = buildZipBuffer([
        { name: 'subdir/', content: '', method: 0 },
        { name: 'file.txt', content: fileContent, method: 0 },
        { name: MANIFEST_FILENAME, content: JSON.stringify(manifest), method: 0 }
      ]);
      const result = validateArchiveBuffer(zip);
      assert.strictEqual(result.valid, true);
    });
  });

  describe('input validation', () => {
    it('rejects non-Buffer input', () => {
      assert.throws(() => validateArchiveBuffer('not a buffer'), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        return true;
      });
    });

    it('rejects undefined input', () => {
      assert.throws(() => validateArchiveBuffer(undefined), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        return true;
      });
    });

    it('rejects buffer too small for ZIP', () => {
      assert.throws(() => validateArchiveBuffer(Buffer.alloc(10)), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        assert.ok(err.message.includes('too small'));
        return true;
      });
    });

    it('rejects buffer without EOCD signature', () => {
      assert.throws(() => validateArchiveBuffer(Buffer.alloc(100)), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        assert.ok(err.message.includes('End of central directory'));
        return true;
      });
    });
  });

  describe('ZIP64 rejection', () => {
    it('rejects ZIP with ZIP64 EOCD locator', () => {
      const files = { 'test.yaml': 'data' };
      const zip = buildManifestZip(files, {}, { method: 0, injectZip64Locator: true });
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSUPPORTED_ZIP_FEATURE');
        assert.ok(err.message.includes('ZIP64'));
        return true;
      });
    });

    it('rejects EOCD with 0xFFFF entry count', () => {
      const zip = buildZipBuffer([{ name: MANIFEST_FILENAME, content: '{}', method: 0 }]);
      const eocdPos = zip.length - 22;
      zip.writeUInt16LE(0xFFFF, eocdPos + 8);
      zip.writeUInt16LE(0xFFFF, eocdPos + 10);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSUPPORTED_ZIP_FEATURE');
        assert.ok(err.message.includes('ZIP64'));
        return true;
      });
    });
  });

  describe('encryption rejection', () => {
    it('rejects encrypted entries (general purpose bit 0)', () => {
      const zip = buildZipBuffer([
        { name: MANIFEST_FILENAME, content: '{}', method: 0, flags: 0x01 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSUPPORTED_ZIP_FEATURE');
        assert.ok(err.message.includes('ncrypted'));
        return true;
      });
    });

    it('rejects strong encryption (general purpose bit 6)', () => {
      const zip = buildZipBuffer([
        { name: MANIFEST_FILENAME, content: '{}', method: 0, flags: 0x40 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSUPPORTED_ZIP_FEATURE');
        assert.ok(err.message.includes('ncrypted'));
        return true;
      });
    });
  });

  describe('unsupported compression', () => {
    it('rejects compression method other than stored/deflate', () => {
      const zip = buildZipBuffer([
        { name: 'file.txt', content: 'data', method: 9 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSUPPORTED_ZIP_FEATURE');
        assert.ok(err.message.includes('compression method'));
        assert.strictEqual(err.details.method, 9);
        return true;
      });
    });
  });

  describe('entry name safety', () => {
    it('rejects absolute paths', () => {
      const zip = buildZipBuffer([
        { name: '/etc/passwd', content: 'root', method: 0 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSAFE_ENTRY_NAME');
        assert.ok(err.message.includes('Absolute'));
        return true;
      });
    });

    it('rejects path traversal with ..', () => {
      const zip = buildZipBuffer([
        { name: '../secret', content: 'data', method: 0 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSAFE_ENTRY_NAME');
        assert.ok(err.message.includes('traversal'));
        return true;
      });
    });

    it('rejects mid-path traversal', () => {
      const zip = buildZipBuffer([
        { name: 'subdir/../../etc/passwd', content: 'data', method: 0 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSAFE_ENTRY_NAME');
        return true;
      });
    });

    it('rejects null bytes in names', () => {
      const zip = buildZipBuffer([
        { name: 'file\0.txt', content: 'data', method: 0 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSAFE_ENTRY_NAME');
        assert.ok(err.message.includes('null'));
        return true;
      });
    });

    it('rejects backslash in names', () => {
      const zip = buildZipBuffer([
        { name: 'dir\\file.txt', content: 'data', method: 0 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSAFE_ENTRY_NAME');
        assert.ok(err.message.includes('backslash'));
        return true;
      });
    });

    it('rejects malformed UTF-8 in entry names', () => {
      const zip = buildZipBuffer([
        { rawName: Buffer.from([0x66, 0x69, 0x6C, 0x65, 0xFF, 0xFE]), content: 'data', method: 0 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        assert.ok(err.message.includes('UTF-8'));
        return true;
      });
    });
  });

  describe('duplicate entries', () => {
    it('rejects duplicate entry names in central directory', () => {
      const zip = buildZipBuffer([
        { name: 'file.txt', content: 'first', method: 0 },
        { name: 'file.txt', content: 'second', method: 0 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'DUPLICATE_ENTRY');
        assert.strictEqual(err.details.file, 'file.txt');
        return true;
      });
    });
  });

  describe('symlink and special file rejection', () => {
    it('rejects symlink entries based on Unix external attributes', () => {
      const symlinkAttrs = (0o120777 << 16) >>> 0;
      const zip = buildZipBuffer([
        { name: 'link.txt', content: 'target', method: 0, externalAttrs: symlinkAttrs },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSUPPORTED_ZIP_FEATURE');
        assert.ok(err.message.includes('ymlink'));
        return true;
      });
    });

    it('rejects device entries based on Unix external attributes', () => {
      const blockDevAttrs = (0o060644 << 16) >>> 0;
      const zip = buildZipBuffer([
        { name: 'dev', content: '', method: 0, externalAttrs: blockDevAttrs },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSUPPORTED_ZIP_FEATURE');
        assert.ok(err.message.includes('Special'));
        return true;
      });
    });

    it('accepts entries from non-Unix host OS without mode checks', () => {
      const content = 'data';
      const checksum = computeSha256(Buffer.from(content, 'utf8'));
      const manifest = validManifest({
        integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { 'file.txt': checksum } }
      });
      const zip = buildZipBuffer([
        { name: 'file.txt', content, method: 0, versionMadeBy: (0 << 8) | 20 },
        { name: MANIFEST_FILENAME, content: JSON.stringify(manifest), method: 0, versionMadeBy: (0 << 8) | 20 }
      ]);
      const result = validateArchiveBuffer(zip);
      assert.strictEqual(result.valid, true);
    });
  });

  describe('manifest requirements', () => {
    it('rejects archive without version-manifest.json', () => {
      const zip = buildZipBuffer([
        { name: 'file.txt', content: 'data', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'MISSING_MANIFEST');
        return true;
      });
    });

    it('rejects archive with manifest alias ./version-manifest.json', () => {
      const zip = buildZipBuffer([
        { name: './version-manifest.json', content: '{}', method: 0 },
        { name: 'file.txt', content: 'data', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'MULTIPLE_MANIFESTS');
        assert.strictEqual(err.details.normalized, MANIFEST_FILENAME);
        return true;
      });
    });

    it('rejects archive with manifest alias dir/../version-manifest.json', () => {
      const zip = buildZipBuffer([
        { name: 'dir/../version-manifest.json', content: '{}', method: 0 },
        { name: 'file.txt', content: 'data', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSAFE_ENTRY_NAME');
        return true;
      });
    });

    it('rejects malformed manifest JSON', () => {
      const zip = buildZipBuffer([
        { name: MANIFEST_FILENAME, content: 'not valid json {{{', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        return true;
      });
    });
  });

  describe('CRC32 integrity verification', () => {
    it('rejects CRC32 mismatch from falsified header', () => {
      const zip = buildZipBuffer([
        { name: MANIFEST_FILENAME, content: '{}', method: 0, crc32Override: 0xDEADBEEF }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'CRC32_MISMATCH');
        assert.strictEqual(err.details.expected, 0xDEADBEEF);
        assert.ok(typeof err.details.computed === 'number');
        return true;
      });
    });

    it('detects data corruption in stored entry', () => {
      const zip = buildZipBuffer([
        { name: 'file.txt', content: 'test data content', method: 0 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      const dataStart = 30 + Buffer.from('file.txt').length;
      zip[dataStart] ^= 0xFF;
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'CRC32_MISMATCH');
        assert.strictEqual(err.details.file, 'file.txt');
        return true;
      });
    });

    it('detects corrupted compressed data', () => {
      const zip = buildZipBuffer([
        { name: 'file.txt', content: 'some test data that will be deflate compressed', method: 8 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      const dataStart = 30 + Buffer.from('file.txt').length;
      zip[dataStart + 2] ^= 0xFF;
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.ok(err.code === 'INVALID_ARCHIVE' || err.code === 'CRC32_MISMATCH',
          `Expected INVALID_ARCHIVE or CRC32_MISMATCH but got ${err.code}`);
        return true;
      });
    });
  });

  describe('SHA-256 manifest checksum delegation', () => {
    it('propagates CHECKSUM_MISMATCH from manifest validation', () => {
      const content = 'original content';
      const wrongChecksum = computeSha256(Buffer.from('different content', 'utf8'));
      const manifest = validManifest({
        integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { 'test.yaml': wrongChecksum } }
      });
      const zip = buildZipBuffer([
        { name: 'test.yaml', content, method: 0 },
        { name: MANIFEST_FILENAME, content: JSON.stringify(manifest), method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'CHECKSUM_MISMATCH');
        assert.strictEqual(err.details.file, 'test.yaml');
        return true;
      });
    });

    it('propagates UNSUPPORTED_VERSION from manifest validation', () => {
      const files = { 'test.yaml': 'data' };
      const zip = buildManifestZip(files, { openshift: { selectedMinor: '4.22', selectedPatch: '4.22.1', lockedVersion: true } });
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSUPPORTED_VERSION');
        assert.strictEqual(err.details.received, '4.22');
        return true;
      });
    });

    it('propagates UNLISTED_FILE from manifest validation', () => {
      const manifest = validManifest({
        integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: {} }
      });
      const zip = buildZipBuffer([
        { name: 'unlisted.txt', content: 'data', method: 0 },
        { name: MANIFEST_FILENAME, content: JSON.stringify(manifest), method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNLISTED_FILE');
        return true;
      });
    });
  });

  describe('resource limits', () => {
    it('exports ZIP_LIMITS with all required fields', () => {
      assert.strictEqual(ZIP_LIMITS.MAX_ARCHIVE_BYTES, 512 * 1024 * 1024);
      assert.strictEqual(ZIP_LIMITS.MAX_ENTRY_COUNT, 10_000);
      assert.strictEqual(ZIP_LIMITS.MAX_INDIVIDUAL_UNCOMPRESSED_BYTES, 256 * 1024 * 1024);
      assert.strictEqual(ZIP_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES, 1024 * 1024 * 1024);
    });

    it('ZIP_LIMITS is frozen', () => {
      assert.ok(Object.isFrozen(ZIP_LIMITS));
    });

    it('rejects entry count exceeding MAX_ENTRY_COUNT', () => {
      const zip = buildZipBuffer([{ name: MANIFEST_FILENAME, content: '{}', method: 0 }]);
      const eocdPos = zip.length - 22;
      zip.writeUInt16LE(ZIP_LIMITS.MAX_ENTRY_COUNT + 1, eocdPos + 8);
      zip.writeUInt16LE(ZIP_LIMITS.MAX_ENTRY_COUNT + 1, eocdPos + 10);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'ARCHIVE_LIMIT_EXCEEDED');
        assert.strictEqual(err.details.limit, 'MAX_ENTRY_COUNT');
        return true;
      });
    });

    it('rejects entry exceeding MAX_INDIVIDUAL_UNCOMPRESSED_BYTES', () => {
      const zip = buildZipBuffer([
        { name: 'big.bin', content: 'x', method: 0,
          uncompressedSizeOverride: ZIP_LIMITS.MAX_INDIVIDUAL_UNCOMPRESSED_BYTES + 1 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'ARCHIVE_LIMIT_EXCEEDED');
        assert.strictEqual(err.details.limit, 'MAX_INDIVIDUAL_UNCOMPRESSED_BYTES');
        return true;
      });
    });

    it('rejects total uncompressed size exceeding MAX_TOTAL_UNCOMPRESSED_BYTES', () => {
      const entrySize = ZIP_LIMITS.MAX_INDIVIDUAL_UNCOMPRESSED_BYTES;
      const entries = [];
      for (let i = 0; i < 5; i++) {
        entries.push({ name: `file${i}.bin`, content: 'x', method: 0, uncompressedSizeOverride: entrySize });
      }
      entries.push({ name: MANIFEST_FILENAME, content: '{}', method: 0 });
      const zip = buildZipBuffer(entries);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'ARCHIVE_LIMIT_EXCEEDED');
        assert.strictEqual(err.details.limit, 'MAX_TOTAL_UNCOMPRESSED_BYTES');
        return true;
      });
    });
  });

  describe('truncated structures', () => {
    it('rejects truncated archive missing central directory', () => {
      const zip = buildManifestZip({ 'test.yaml': 'data' }, {}, { method: 0 });
      const truncated = zip.subarray(0, Math.floor(zip.length / 2));
      assert.throws(() => validateArchiveBuffer(truncated), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        return true;
      });
    });

    it('rejects archive where central directory extends beyond bounds', () => {
      const zip = buildZipBuffer([{ name: MANIFEST_FILENAME, content: '{}', method: 0 }]);
      const eocdPos = zip.length - 22;
      zip.writeUInt32LE(zip.length, eocdPos + 16);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        return true;
      });
    });
  });

  describe('data descriptor support', () => {
    it('accepts generator-compatible deflate archive with data descriptors', () => {
      const files = { 'install-config.yaml': 'apiVersion: v1\nkind: InstallConfig\n' };
      const zip = buildManifestZip(files, {
        openshift: { selectedMinor: '4.21', selectedPatch: '4.21.20', lockedVersion: true }
      }, { method: 8, flags: 0x08 });
      const result = validateArchiveBuffer(zip);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.selectedMinor, '4.21');
    });

    it('accepts stored entry with data descriptor', () => {
      const files = { 'test.yaml': 'simple content' };
      const zip = buildManifestZip(files, {}, { method: 0, flags: 0x08 });
      const result = validateArchiveBuffer(zip);
      assert.strictEqual(result.valid, true);
    });

    it('rejects data descriptor CRC mismatch with central directory', () => {
      const content = 'test data';
      const contentBuf = Buffer.from(content, 'utf8');
      const checksum = computeSha256(contentBuf);
      const manifest = validManifest({
        integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: { 'file.txt': checksum } }
      });
      const zip = buildZipBuffer([
        { name: 'file.txt', content, method: 0, flags: 0x08 },
        { name: MANIFEST_FILENAME, content: JSON.stringify(manifest), method: 0 }
      ]);
      const localNameLen = Buffer.from('file.txt').length;
      const ddStart = 30 + localNameLen + contentBuf.length;
      zip.writeUInt32LE(0xDEADBEEF, ddStart + 4);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        assert.ok(err.message.includes('Data descriptor'));
        return true;
      });
    });

    it('rejects non-zero local CRC/sizes when data descriptor flag set', () => {
      const zip = buildZipBuffer([
        {
          name: 'file.txt', content: 'data', method: 0, flags: 0x08,
          localCrc32Override: 0x12345678
        },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        assert.ok(err.message.includes('data descriptor flag but non-zero'));
        return true;
      });
    });
  });

  describe('local header cross-validation', () => {
    it('rejects local header method mismatch with central directory', () => {
      const zip = buildZipBuffer([
        { name: 'file.txt', content: 'data', method: 0, localMethod: 8 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        assert.ok(err.message.includes('method'));
        return true;
      });
    });

    it('rejects local header flags mismatch with central directory', () => {
      const zip = buildZipBuffer([
        { name: 'file.txt', content: 'data', method: 0, localFlags: 0x08 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        assert.ok(err.message.includes('flags'));
        return true;
      });
    });

    it('rejects local header CRC mismatch when no data descriptor', () => {
      const zip = buildZipBuffer([
        { name: 'file.txt', content: 'data', method: 0, localCrc32Override: 0xAAAAAAAA },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        assert.ok(err.message.includes('CRC32'));
        return true;
      });
    });

    it('rejects local header compressed size mismatch', () => {
      const zip = buildZipBuffer([
        { name: 'file.txt', content: 'data', method: 0, localCompressedSizeOverride: 999 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        assert.ok(err.message.includes('compressed size'));
        return true;
      });
    });

    it('rejects local header uncompressed size mismatch', () => {
      const zip = buildZipBuffer([
        { name: 'file.txt', content: 'data', method: 0, localUncompressedSizeOverride: 999 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        assert.ok(err.message.includes('uncompressed size'));
        return true;
      });
    });

    it('rejects local-only encryption (flags mismatch)', () => {
      const zip = buildZipBuffer([
        { name: 'file.txt', content: 'data', method: 0, localFlags: 0x01 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        assert.ok(err.message.includes('flags'));
        return true;
      });
    });
  });

  describe('ZIP64 version-needed and extra field rejection', () => {
    it('rejects central directory version-needed >= 45', () => {
      const zip = buildZipBuffer([
        { name: 'file.txt', content: 'data', method: 0, versionNeeded: 45 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSUPPORTED_ZIP_FEATURE');
        assert.ok(err.message.includes('ZIP64'));
        return true;
      });
    });

    it('rejects local header version-needed >= 45', () => {
      const zip = buildZipBuffer([
        { name: 'file.txt', content: 'data', method: 0, localVersionNeeded: 45 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSUPPORTED_ZIP_FEATURE');
        assert.ok(err.message.includes('ZIP64'));
        return true;
      });
    });

    it('rejects ZIP64 extra field in central directory', () => {
      const zip64Extra = Buffer.alloc(8);
      zip64Extra.writeUInt16LE(0x0001, 0);
      zip64Extra.writeUInt16LE(4, 2);
      const zip = buildZipBuffer([
        { name: 'file.txt', content: 'data', method: 0, centralExtra: zip64Extra },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSUPPORTED_ZIP_FEATURE');
        assert.ok(err.message.includes('ZIP64'));
        return true;
      });
    });

    it('rejects ZIP64 extra field in local header', () => {
      const zip64Extra = Buffer.alloc(8);
      zip64Extra.writeUInt16LE(0x0001, 0);
      zip64Extra.writeUInt16LE(4, 2);
      const zip = buildZipBuffer([
        { name: 'file.txt', content: 'data', method: 0, localExtra: zip64Extra },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSUPPORTED_ZIP_FEATURE');
        assert.ok(err.message.includes('ZIP64'));
        return true;
      });
    });

    it('allows non-ZIP64 extra fields', () => {
      const customExtra = Buffer.alloc(8);
      customExtra.writeUInt16LE(0x5455, 0);
      customExtra.writeUInt16LE(4, 2);
      const files = { 'test.yaml': 'data' };
      const checksums = {};
      for (const [name, content] of Object.entries(files)) {
        checksums[name] = computeSha256(Buffer.from(content, 'utf8'));
      }
      const manifest = validManifest({
        integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: checksums }
      });
      const zip = buildZipBuffer([
        { name: 'test.yaml', content: 'data', method: 0, centralExtra: customExtra, localExtra: customExtra },
        { name: MANIFEST_FILENAME, content: JSON.stringify(manifest), method: 0 }
      ]);
      const result = validateArchiveBuffer(zip);
      assert.strictEqual(result.valid, true);
    });
  });

  describe('exact central directory consumption', () => {
    it('rejects archive with CD size mismatch', () => {
      const zip = buildZipBuffer([
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ], { cdSizeOverride: 100 });
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        assert.ok(err.message.includes('consumed bytes') || err.message.includes('Central directory'));
        return true;
      });
    });
  });

  describe('directory entry validation', () => {
    it('rejects duplicate directory entries', () => {
      const zip = buildZipBuffer([
        { name: 'subdir/', content: '', method: 0 },
        { name: 'subdir/', content: '', method: 0 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'DUPLICATE_ENTRY');
        assert.strictEqual(err.details.file, 'subdir/');
        return true;
      });
    });

    it('rejects file-directory ambiguity: file then directory', () => {
      const zip = buildZipBuffer([
        { name: 'foo', content: 'data', method: 0 },
        { name: 'foo/', content: '', method: 0 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSAFE_ENTRY_NAME');
        assert.ok(err.message.includes('ambiguity'));
        return true;
      });
    });

    it('rejects file-directory ambiguity: directory then file', () => {
      const zip = buildZipBuffer([
        { name: 'bar/', content: '', method: 0 },
        { name: 'bar', content: 'data', method: 0 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSAFE_ENTRY_NAME');
        assert.ok(err.message.includes('ambiguity'));
        return true;
      });
    });

    it('rejects directory with non-stored compression', () => {
      const zip = buildZipBuffer([
        { name: 'subdir/', content: '', method: 8 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        assert.ok(err.message.includes('non-stored'));
        return true;
      });
    });

    it('rejects directory with non-zero size', () => {
      const zip = buildZipBuffer([
        { name: 'subdir/', content: 'non-empty', method: 0 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        assert.ok(err.message.includes('non-zero size'));
        return true;
      });
    });
  });

  describe('Windows drive-absolute path rejection', () => {
    it('rejects C:/ drive-absolute path', () => {
      const zip = buildZipBuffer([
        { name: 'C:/Windows/System32/config', content: 'data', method: 0 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSAFE_ENTRY_NAME');
        assert.ok(err.message.includes('Windows'));
        return true;
      });
    });

    it('rejects lowercase drive letter', () => {
      const zip = buildZipBuffer([
        { name: 'd:/data/file.txt', content: 'data', method: 0 },
        { name: MANIFEST_FILENAME, content: '{}', method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'UNSAFE_ENTRY_NAME');
        assert.ok(err.message.includes('Windows'));
        return true;
      });
    });
  });

  describe('local data region bounds and overlap', () => {
    it('rejects local data region extending into central directory', () => {
      const zip = buildManifestZip({ 'test.yaml': 'data' }, {}, { method: 0 });
      const eocdPos = zip.length - 22;
      const cdOffset = zip.readUInt32LE(eocdPos + 16);
      zip.writeUInt32LE(cdOffset - 1, eocdPos + 16);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'INVALID_ARCHIVE');
        return true;
      });
    });
  });

  describe('sanitized JSON.parse errors', () => {
    it('does not leak raw JSON content in error message', () => {
      const malicious = '<script>alert("xss")</script>{{{not json}}}';
      const zip = buildZipBuffer([
        { name: MANIFEST_FILENAME, content: malicious, method: 0 }
      ]);
      assert.throws(() => validateArchiveBuffer(zip), err => {
        assert.strictEqual(err.code, 'MALFORMED_MANIFEST');
        assert.ok(!err.message.includes('script'));
        assert.ok(!err.message.includes('alert'));
        assert.ok(err.message.includes('invalid JSON'));
        return true;
      });
    });
  });

  describe('legacy JSON import unaffected', () => {
    it('validateArchiveManifest still works independently of ZIP adapter', () => {
      const files = { 'install-config.yaml': 'content', 'agent-config.yaml': 'agent' };
      const manifest = manifestWithFiles(files, { openshift: { selectedMinor: '4.21', selectedPatch: '4.21.20', lockedVersion: true } });
      const archive = archiveFromStrings(files);
      const result = validateArchiveManifest(manifest, archive);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.selectedMinor, '4.21');
    });
  });
});
