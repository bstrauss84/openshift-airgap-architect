import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import {
  computeSha256,
  getAppIdentity,
  buildVersionManifest,
  createIntegrityTracker,
  MANIFEST_FILENAME,
  MANIFEST_SCHEMA_VERSION
} from '../src/exportIntegrity.js';
import { baseStates } from './fixtures/index.js';
import { migrateStateToV3 } from '../../shared/stateMigration.js';
import { assertSupportedOpenShiftMinorForGeneration } from '../src/versionPolicy.js';

function parseZipEntries(buffer) {
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('EOCD not found');

  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const cdCount = buffer.readUInt16LE(eocdOffset + 10);
  const entries = [];
  let pos = cdOffset;

  for (let i = 0; i < cdCount; i++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pos + 10);
    const compSize = buffer.readUInt32LE(pos + 20);
    const uncompSize = buffer.readUInt32LE(pos + 24);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLen);

    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;

    let content;
    if (method === 0) {
      content = buffer.subarray(dataStart, dataStart + uncompSize);
    } else if (method === 8) {
      content = zlib.inflateRawSync(buffer.subarray(dataStart, dataStart + compSize));
    }

    entries.push({ name, content });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function getZipEntryNames(buffer) {
  return parseZipEntries(buffer).map(e => e.name);
}

async function buildTestZip(state, addEntries) {
  const chunks = [];
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const tracked = createIntegrityTracker(archive);
  archive.on('data', chunk => chunks.push(chunk));

  addEntries(tracked);

  const manifest = tracked.buildManifest(state);
  archive.append(JSON.stringify(manifest, null, 2), { name: MANIFEST_FILENAME });

  await new Promise((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
    archive.finalize();
  });

  return { buffer: Buffer.concat(chunks), manifest, checksums: tracked.getChecksums() };
}

describe('Export Integrity Helper', () => {
  describe('computeSha256', () => {
    it('produces deterministic sha256: prefixed lowercase hex for known bytes', () => {
      const result = computeSha256('hello');
      assert.strictEqual(result, 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('produces correct hash for empty string', () => {
      const result = computeSha256('');
      assert.strictEqual(result, 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('handles Buffer input consistently with string', () => {
      const fromStr = computeSha256('test content');
      const fromBuf = computeSha256(Buffer.from('test content', 'utf8'));
      assert.strictEqual(fromStr, fromBuf);
    });

    it('uses sha256: prefix with lowercase hex format', () => {
      const result = computeSha256('anything');
      assert.match(result, /^sha256:[0-9a-f]{64}$/);
    });
  });

  describe('getAppIdentity', () => {
    it('reads version from backend/package.json as 2.0.0-dev', () => {
      const identity = getAppIdentity();
      assert.strictEqual(identity.version, '2.0.0-dev');
    });

    it('does not silently substitute bare 2.0.0 for 2.0.0-dev', () => {
      const identity = getAppIdentity();
      assert.notStrictEqual(identity.version, '2.0.0');
    });

    it('returns commit and buildTime fields from env or unknown', () => {
      const identity = getAppIdentity();
      assert.ok(typeof identity.commit === 'string');
      assert.ok(typeof identity.buildTime === 'string');
    });
  });

  describe('buildVersionManifest', () => {
    it('produces complete frozen-schema manifest structure', () => {
      const state = baseStates.bareMetalAgent({
        version: { selectedMinor: '4.21', selectedPatch: '4.21.15', locked: true },
        release: { channel: '4.21', patchVersion: '4.21.15', confirmed: true }
      });
      const checksums = { 'install-config.yaml': 'sha256:abc123' };
      const manifest = buildVersionManifest(state, checksums);

      assert.strictEqual(manifest.manifestSchemaVersion, MANIFEST_SCHEMA_VERSION);
      assert.ok(manifest.generated.timestamp);
      assert.strictEqual(typeof manifest.generated.timestamp, 'string');
      assert.strictEqual(manifest.generated.appIdentity.version, '2.0.0-dev');
      assert.strictEqual(manifest.generated.stateSchemaVersion, 3);
      assert.strictEqual(manifest.openshift.selectedMinor, '4.21');
      assert.strictEqual(manifest.openshift.selectedPatch, '4.21.15');
      assert.strictEqual(manifest.openshift.lockedVersion, true);
      assert.strictEqual(manifest.compatibility.minimumManifestSchemaVersion, '1.0.0');
      assert.deepStrictEqual(manifest.compatibility.stateFormatCompatible, [3]);
      assert.deepStrictEqual(manifest.compatibility.warnings, []);
      assert.strictEqual(manifest.integrity.algorithm, 'sha-256');
      assert.strictEqual(manifest.integrity.format, 'lowercase-hex');
      assert.deepStrictEqual(manifest.integrity.files, checksums);
    });

    it('records locked 4.20 without fallback to other version', () => {
      const state = baseStates.minimal();
      const manifest = buildVersionManifest(state, {});
      assert.strictEqual(manifest.openshift.selectedMinor, '4.20');
      assert.strictEqual(manifest.openshift.selectedPatch, '4.20.8');
      assert.strictEqual(manifest.openshift.lockedVersion, true);
    });

    it('records locked 4.21 without fallback to other version', () => {
      const state = baseStates.minimal({
        version: { selectedMinor: '4.21', selectedPatch: '4.21.20', locked: true },
        release: { channel: '4.21', patchVersion: '4.21.20', confirmed: true }
      });
      const manifest = buildVersionManifest(state, {});
      assert.strictEqual(manifest.openshift.selectedMinor, '4.21');
      assert.strictEqual(manifest.openshift.selectedPatch, '4.21.20');
      assert.strictEqual(manifest.openshift.lockedVersion, true);
    });

    it('does not include stateChecksum or state payload', () => {
      const state = baseStates.minimal();
      const manifest = buildVersionManifest(state, {});
      assert.strictEqual(manifest.stateChecksum, undefined);
      assert.strictEqual(manifest.state, undefined);
      assert.strictEqual(manifest.integrity.files['state.json'], undefined);
    });
  });

  describe('createIntegrityTracker with real ZIP generation', () => {
    it('manifest is present at ZIP root and is the final entry', async () => {
      const state = baseStates.minimal();
      const { buffer } = await buildTestZip(state, (tracked) => {
        tracked.append('install config content', { name: 'install-config.yaml' });
        tracked.append('imageset config content', { name: 'imageset-config.yaml' });
        tracked.append('field manual content', { name: 'FIELD_MANUAL.md' });
      });

      const names = getZipEntryNames(buffer);
      assert.ok(names.includes(MANIFEST_FILENAME), 'manifest must be in ZIP');
      assert.strictEqual(names[names.length - 1], MANIFEST_FILENAME, 'manifest must be the final entry');
    });

    it('complete one-to-one checksum coverage for every non-manifest entry', async () => {
      const state = baseStates.minimal();
      const { buffer, manifest } = await buildTestZip(state, (tracked) => {
        tracked.append('install config', { name: 'install-config.yaml' });
        tracked.append('imageset config', { name: 'imageset-config.yaml' });
        tracked.append('field manual', { name: 'FIELD_MANUAL.md' });
      });

      const names = getZipEntryNames(buffer);
      const nonManifest = names.filter(n => n !== MANIFEST_FILENAME);
      const manifestFiles = Object.keys(manifest.integrity.files);

      for (const name of nonManifest) {
        assert.ok(manifest.integrity.files[name], `Missing checksum for: ${name}`);
      }
      for (const name of manifestFiles) {
        assert.ok(names.includes(name), `Phantom checksum for: ${name}`);
      }
      assert.strictEqual(nonManifest.length, manifestFiles.length, 'Count mismatch');
    });

    it('checksums verify against extracted entry bytes', async () => {
      const testContent = 'apiVersion: v1\nkind: InstallConfig\nmetadata:\n  name: test\n';
      const state = baseStates.minimal();
      const { buffer, manifest } = await buildTestZip(state, (tracked) => {
        tracked.append(testContent, { name: 'install-config.yaml' });
      });

      const entries = parseZipEntries(buffer);
      for (const entry of entries) {
        if (entry.name === MANIFEST_FILENAME) continue;
        const recomputed = computeSha256(entry.content);
        assert.strictEqual(
          recomputed,
          manifest.integrity.files[entry.name],
          `Checksum mismatch for ${entry.name}`
        );
      }
    });

    it('conditional file inclusion - agent config present when expected', async () => {
      const state = baseStates.bareMetalAgent();
      const { manifest, buffer } = await buildTestZip(state, (tracked) => {
        tracked.append('install', { name: 'install-config.yaml' });
        tracked.append('agent', { name: 'agent-config.yaml' });
        tracked.append('imageset', { name: 'imageset-config.yaml' });
        tracked.append('manual', { name: 'FIELD_MANUAL.md' });
      });

      assert.ok(manifest.integrity.files['agent-config.yaml'], 'agent-config checksum must be present');
      const names = getZipEntryNames(buffer);
      assert.ok(names.includes('agent-config.yaml'));
    });

    it('conditional file omission - absent files have no checksum entry', async () => {
      const state = baseStates.awsGovcloudIpi();
      const { manifest } = await buildTestZip(state, (tracked) => {
        tracked.append('install', { name: 'install-config.yaml' });
        tracked.append('imageset', { name: 'imageset-config.yaml' });
        tracked.append('manual', { name: 'FIELD_MANUAL.md' });
      });

      assert.strictEqual(manifest.integrity.files['agent-config.yaml'], undefined);
    });

    it('tracks file entries from disk with correct checksum', async () => {
      const tmpFile = path.join(process.env.TMPDIR || '/tmp', `integrity-test-${Date.now()}.txt`);
      const fileContent = 'binary-like content for tools/oc';
      fs.writeFileSync(tmpFile, fileContent);

      try {
        const state = baseStates.minimal();
        const { manifest, buffer } = await buildTestZip(state, (tracked) => {
          tracked.append('config', { name: 'install-config.yaml' });
          tracked.file(tmpFile, { name: 'tools/test-binary' });
        });

        assert.ok(manifest.integrity.files['tools/test-binary']);
        const entries = parseZipEntries(buffer);
        const fileEntry = entries.find(e => e.name === 'tools/test-binary');
        assert.ok(fileEntry);
        assert.strictEqual(computeSha256(fileEntry.content), manifest.integrity.files['tools/test-binary']);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('file mutation after tracking cannot cause checksum/content divergence (TOCTOU)', async () => {
      const tmpFile = path.join(process.env.TMPDIR || '/tmp', `integrity-toctou-${Date.now()}.txt`);
      const originalContent = 'original content before mutation';
      fs.writeFileSync(tmpFile, originalContent);

      try {
        const chunks = [];
        const archive = new ZipArchive({ zlib: { level: 9 } });
        const tracked = createIntegrityTracker(archive);
        archive.on('data', chunk => chunks.push(chunk));

        tracked.file(tmpFile, { name: 'tools/test-binary' });

        fs.writeFileSync(tmpFile, 'MUTATED content after tracking');

        const state = baseStates.minimal();
        const manifest = tracked.buildManifest(state);
        archive.append(JSON.stringify(manifest, null, 2), { name: MANIFEST_FILENAME });

        await new Promise((resolve, reject) => {
          archive.on('end', resolve);
          archive.on('error', reject);
          archive.finalize();
        });

        const buffer = Buffer.concat(chunks);
        const entries = parseZipEntries(buffer);
        const fileEntry = entries.find(e => e.name === 'tools/test-binary');
        assert.ok(fileEntry, 'file entry must exist');

        assert.strictEqual(fileEntry.content.toString('utf8'), originalContent,
          'archived bytes must be the pre-mutation snapshot');
        assert.strictEqual(computeSha256(fileEntry.content), manifest.integrity.files['tools/test-binary'],
          'manifest checksum must match archived bytes');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('nested entry path - directory tracking with subdirectories', async () => {
      const tmpDir = path.join(process.env.TMPDIR || '/tmp', `integrity-dir-${Date.now()}`);
      fs.mkdirSync(path.join(tmpDir, 'subdir'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'file1.txt'), 'content1');
      fs.writeFileSync(path.join(tmpDir, 'subdir', 'file2.txt'), 'content2');

      try {
        const state = baseStates.minimal();
        const { manifest, buffer } = await buildTestZip(state, (tracked) => {
          tracked.append('base config', { name: 'install-config.yaml' });
          tracked.directory(tmpDir, 'mirror-output');
        });

        assert.ok(manifest.integrity.files['mirror-output/file1.txt'], 'flat file checksum');
        assert.ok(manifest.integrity.files['mirror-output/subdir/file2.txt'], 'nested file checksum');

        const entries = parseZipEntries(buffer);
        const nestedEntry = entries.find(e => e.name === 'mirror-output/subdir/file2.txt');
        assert.ok(nestedEntry, 'nested entry must exist in ZIP');
        assert.strictEqual(
          computeSha256(nestedEntry.content),
          manifest.integrity.files['mirror-output/subdir/file2.txt'],
          'nested entry checksum must verify'
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('manifest is excluded from its own checksum map', async () => {
      const state = baseStates.minimal();
      const { manifest, checksums } = await buildTestZip(state, (tracked) => {
        tracked.append('content', { name: 'test.yaml' });
      });

      assert.strictEqual(checksums[MANIFEST_FILENAME], undefined, 'tracker must not track manifest');
      assert.strictEqual(manifest.integrity.files[MANIFEST_FILENAME], undefined, 'manifest must not self-reference');
    });

    it('no state payload or stateChecksum in manifest or ZIP entries', async () => {
      const state = baseStates.minimal();
      const { buffer, manifest } = await buildTestZip(state, (tracked) => {
        tracked.append('config', { name: 'install-config.yaml' });
      });

      assert.strictEqual(manifest.stateChecksum, undefined);
      assert.strictEqual(manifest.state, undefined);
      const names = getZipEntryNames(buffer);
      assert.ok(!names.includes('state.json'), 'state.json must not be in ZIP');
    });
  });

  describe('Version boundary enforcement', () => {
    it('locked 4.20 succeeds through migration and version check', () => {
      const state = baseStates.minimal();
      const result = migrateStateToV3(state);
      assert.ok(!result.error);
      assertSupportedOpenShiftMinorForGeneration(result.migrated);
      const manifest = buildVersionManifest(result.migrated, {});
      assert.strictEqual(manifest.openshift.selectedMinor, '4.20');
      assert.strictEqual(manifest.openshift.lockedVersion, true);
    });

    it('locked 4.21 succeeds through migration and version check', () => {
      const state = baseStates.minimal({
        version: { selectedMinor: '4.21', selectedPatch: '4.21.20', locked: true },
        release: { channel: '4.21', patchVersion: '4.21.20', confirmed: true }
      });
      const result = migrateStateToV3(state);
      assert.ok(!result.error);
      assertSupportedOpenShiftMinorForGeneration(result.migrated);
      const manifest = buildVersionManifest(result.migrated, {});
      assert.strictEqual(manifest.openshift.selectedMinor, '4.21');
    });

    it('unlocked state fails version confirmation check', () => {
      const state = baseStates.minimal({
        version: { locked: false },
        release: { confirmed: false }
      });
      const result = migrateStateToV3(state);
      assert.ok(!result.error);
      const v3State = result.migrated;
      const confirmed = v3State.version?.locked ?? v3State.release?.confirmed;
      assert.strictEqual(confirmed, false, 'unlocked state must fail confirmation');
    });

    it('unsupported 4.22 fails with UNSUPPORTED_VERSION error', () => {
      const state = baseStates.minimal({
        version: { selectedMinor: '4.22', selectedPatch: '4.22.1', locked: true },
        release: { channel: '4.22', patchVersion: '4.22.1', confirmed: true }
      });
      const result = migrateStateToV3(state);
      assert.ok(!result.error);
      assert.throws(
        () => assertSupportedOpenShiftMinorForGeneration(result.migrated),
        (err) => {
          assert.strictEqual(err.code, 'UNSUPPORTED_VERSION');
          assert.deepStrictEqual(err.supportedVersions, ['4.20', '4.21']);
          return true;
        }
      );
    });
  });
});
