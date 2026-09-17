import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import zlib from 'node:zlib';
import path from 'node:path';
import fs from 'node:fs';
import { createTestServer, closeTestServer } from './helpers/httpServerLifecycle.js';

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';
if (!process.env.DATA_DIR) {
  process.env.DATA_DIR = path.join(
    process.env.TMPDIR || process.env.OAA_SUPERVISOR_SCRATCH || '/tmp',
    'airgap-backend-test'
  );
}
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { app } = await import('../src/index.js');
const {
  computeSha256,
  crc32,
  MANIFEST_FILENAME,
  MANIFEST_SCHEMA_VERSION,
  COMPATIBLE_STATE_SCHEMA_VERSION
} = await import('../src/exportIntegrity.js');

function validManifest(overrides = {}) {
  const base = {
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    generated: {
      timestamp: '2026-09-16T00:00:00.000Z',
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

function buildZipBuffer(fileEntries) {
  const processed = fileEntries.map(fe => {
    const nameBytes = Buffer.from(fe.name, 'utf8');
    const content = Buffer.isBuffer(fe.content) ? fe.content : Buffer.from(fe.content || '', 'utf8');
    const method = fe.method ?? 8;
    const versionMadeBy = (3 << 8) | 20;
    const externalAttrs = (0o100644 << 16) >>> 0;

    let compressedData;
    if (method === 0) {
      compressedData = content;
    } else {
      compressedData = zlib.deflateRawSync(content);
    }

    return {
      nameBytes, content, compressedData, method,
      crc32Val: crc32(content),
      compressedSize: compressedData.length,
      uncompressedSize: content.length,
      versionMadeBy, externalAttrs
    };
  });

  const parts = [];
  let offset = 0;
  const localOffsets = [];

  for (const entry of processed) {
    localOffsets.push(offset);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(entry.method, 8);
    header.writeUInt32LE(entry.crc32Val, 14);
    header.writeUInt32LE(entry.compressedSize, 18);
    header.writeUInt32LE(entry.uncompressedSize, 22);
    header.writeUInt16LE(entry.nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    parts.push(header, entry.nameBytes, entry.compressedData);
    offset += header.length + entry.nameBytes.length + entry.compressedData.length;
  }

  const cdOffset = offset;
  const cdParts = [];
  for (let i = 0; i < processed.length; i++) {
    const entry = processed[i];
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(entry.versionMadeBy, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(entry.method, 10);
    cd.writeUInt32LE(entry.crc32Val, 16);
    cd.writeUInt32LE(entry.compressedSize, 20);
    cd.writeUInt32LE(entry.uncompressedSize, 24);
    cd.writeUInt16LE(entry.nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(entry.externalAttrs, 38);
    cd.writeUInt32LE(localOffsets[i], 42);
    cdParts.push(cd, entry.nameBytes);
  }
  const centralDir = Buffer.concat(cdParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(processed.length, 8);
  eocd.writeUInt16LE(processed.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, centralDir, eocd]);
}

function buildManifestZip(fileMap, manifestOverrides = {}) {
  const checksums = {};
  for (const [name, content] of Object.entries(fileMap)) {
    checksums[name] = computeSha256(Buffer.from(content, 'utf8'));
  }
  const manifest = validManifest({
    ...manifestOverrides,
    integrity: { algorithm: 'sha-256', format: 'lowercase-hex', files: checksums }
  });
  const manifestJson = JSON.stringify(manifest, null, 2);
  const entries = Object.entries(fileMap).map(([name, content]) => ({ name, content }));
  entries.push({ name: MANIFEST_FILENAME, content: manifestJson });
  return buildZipBuffer(entries);
}

describe('POST /api/bundle.import — HTTP integration', () => {
  let server, baseUrl;

  before(async () => {
    ({ server, baseUrl } = await createTestServer(app));
  });

  after(async () => {
    await closeTestServer(server);
  });

  describe('valid archive success', () => {
    it('accepts a valid archive with application/zip', async () => {
      const zip = buildManifestZip(
        { 'install-config.yaml': 'apiVersion: v1\n' },
        { openshift: { selectedMinor: '4.21', selectedPatch: '4.21.20', lockedVersion: true } }
      );
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zip,
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.valid, true);
      assert.strictEqual(body.manifestSchemaVersion, MANIFEST_SCHEMA_VERSION);
      assert.strictEqual(body.stateSchemaVersion, COMPATIBLE_STATE_SCHEMA_VERSION);
      assert.strictEqual(body.selectedMinor, '4.21');
      assert.strictEqual(body.fileCount, 1);
    });

    it('accepts a valid archive with application/octet-stream', async () => {
      const zip = buildManifestZip({ 'install-config.yaml': 'apiVersion: v1\n' });
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: zip,
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.valid, true);
    });

    it('returns exactly five fields on success', async () => {
      const zip = buildManifestZip({
        'install-config.yaml': 'a',
        'agent-config.yaml': 'b',
        'FIELD_MANUAL.md': 'c'
      });
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zip,
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      const keys = Object.keys(body).sort();
      assert.deepStrictEqual(keys, ['fileCount', 'manifestSchemaVersion', 'selectedMinor', 'stateSchemaVersion', 'valid']);
      assert.strictEqual(body.fileCount, 3);
    });

    it('accepts a valid 4.20 archive', async () => {
      const zip = buildManifestZip(
        { 'install-config.yaml': 'data' },
        { openshift: { selectedMinor: '4.20', selectedPatch: '4.20.8', lockedVersion: true } }
      );
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zip,
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.selectedMinor, '4.20');
    });
  });

  describe('rejected media types', () => {
    it('rejects application/json with 415', async () => {
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      });
      assert.strictEqual(res.status, 415);
      const body = await res.json();
      assert.strictEqual(body.code, 'WRONG_MEDIA_TYPE');
    });

    it('rejects multipart/form-data with 415', async () => {
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=----WebKitFormBoundary' },
        body: '------WebKitFormBoundary\r\nContent-Disposition: form-data; name="file"\r\n\r\ndata\r\n------WebKitFormBoundary--',
      });
      assert.strictEqual(res.status, 415);
      const body = await res.json();
      assert.strictEqual(body.code, 'WRONG_MEDIA_TYPE');
    });

    it('rejects text/plain with 415', async () => {
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'hello',
      });
      assert.strictEqual(res.status, 415);
      const body = await res.json();
      assert.strictEqual(body.code, 'WRONG_MEDIA_TYPE');
    });

    it('rejects absent content-type with 415', async () => {
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        body: null,
      });
      assert.strictEqual(res.status, 415);
      const body = await res.json();
      assert.strictEqual(body.code, 'WRONG_MEDIA_TYPE');
    });
  });

  describe('empty or missing body', () => {
    it('rejects empty body with 400 EMPTY_BODY', async () => {
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: new Uint8Array(0),
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.code, 'EMPTY_BODY');
    });
  });

  describe('malformed ZIP', () => {
    it('rejects non-ZIP bytes with 400 INVALID_ARCHIVE', async () => {
      const garbage = Buffer.from('this is not a zip file at all');
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: garbage,
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.code, 'INVALID_ARCHIVE');
    });

    it('rejects truncated ZIP with 400', async () => {
      const validZip = buildManifestZip({ 'test.txt': 'data' });
      const truncated = validZip.subarray(0, 20);
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: truncated,
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.ok(body.code);
    });
  });

  describe('missing manifest', () => {
    it('rejects ZIP without version-manifest.json with 400 MISSING_MANIFEST', async () => {
      const zip = buildZipBuffer([
        { name: 'install-config.yaml', content: 'apiVersion: v1\n' }
      ]);
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zip,
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.code, 'MISSING_MANIFEST');
    });
  });

  describe('invalid manifest', () => {
    it('rejects invalid JSON manifest with 400 MALFORMED_MANIFEST', async () => {
      const zip = buildZipBuffer([
        { name: MANIFEST_FILENAME, content: 'not valid json {{{' }
      ]);
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zip,
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.code, 'MALFORMED_MANIFEST');
    });
  });

  describe('checksum failure', () => {
    it('rejects archive with mismatched checksums with 400 CHECKSUM_MISMATCH', async () => {
      const fileContent = 'apiVersion: v1\n';
      const wrongChecksum = 'sha256:' + '0'.repeat(64);
      const manifest = validManifest({
        integrity: {
          algorithm: 'sha-256',
          format: 'lowercase-hex',
          files: { 'install-config.yaml': wrongChecksum }
        }
      });
      const zip = buildZipBuffer([
        { name: 'install-config.yaml', content: fileContent },
        { name: MANIFEST_FILENAME, content: JSON.stringify(manifest) }
      ]);
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zip,
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.code, 'CHECKSUM_MISMATCH');
    });
  });

  describe('incompatible manifest/state schema (422)', () => {
    it('rejects unsupported manifest schema version with 422', async () => {
      const fileContent = 'data';
      const checksum = computeSha256(Buffer.from(fileContent, 'utf8'));
      const manifest = validManifest({
        manifestSchemaVersion: '99.0.0',
        integrity: {
          algorithm: 'sha-256',
          format: 'lowercase-hex',
          files: { 'test.txt': checksum }
        }
      });
      const zip = buildZipBuffer([
        { name: 'test.txt', content: fileContent },
        { name: MANIFEST_FILENAME, content: JSON.stringify(manifest) }
      ]);
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zip,
      });
      assert.strictEqual(res.status, 422);
      const body = await res.json();
      assert.strictEqual(body.code, 'UNSUPPORTED_MANIFEST_SCHEMA');
    });

    it('rejects incompatible state schema with 422', async () => {
      const fileContent = 'data';
      const checksum = computeSha256(Buffer.from(fileContent, 'utf8'));
      const manifest = validManifest({
        generated: { stateSchemaVersion: 99 },
        integrity: {
          algorithm: 'sha-256',
          format: 'lowercase-hex',
          files: { 'test.txt': checksum }
        }
      });
      const zip = buildZipBuffer([
        { name: 'test.txt', content: fileContent },
        { name: MANIFEST_FILENAME, content: JSON.stringify(manifest) }
      ]);
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zip,
      });
      assert.strictEqual(res.status, 422);
      const body = await res.json();
      assert.strictEqual(body.code, 'INCOMPATIBLE_STATE_SCHEMA');
    });

    it('rejects unsupported OpenShift version with 422', async () => {
      const fileContent = 'data';
      const checksum = computeSha256(Buffer.from(fileContent, 'utf8'));
      const manifest = validManifest({
        openshift: { selectedMinor: '4.99', selectedPatch: '4.99.0', lockedVersion: true },
        integrity: {
          algorithm: 'sha-256',
          format: 'lowercase-hex',
          files: { 'test.txt': checksum }
        }
      });
      const zip = buildZipBuffer([
        { name: 'test.txt', content: fileContent },
        { name: MANIFEST_FILENAME, content: JSON.stringify(manifest) }
      ]);
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zip,
      });
      assert.strictEqual(res.status, 422);
      const body = await res.json();
      assert.strictEqual(body.code, 'UNSUPPORTED_VERSION');
    });

    it('rejects unlocked version with 422', async () => {
      const fileContent = 'data';
      const checksum = computeSha256(Buffer.from(fileContent, 'utf8'));
      const manifest = validManifest({
        openshift: { selectedMinor: '4.21', selectedPatch: '4.21.20', lockedVersion: false },
        integrity: {
          algorithm: 'sha-256',
          format: 'lowercase-hex',
          files: { 'test.txt': checksum }
        }
      });
      const zip = buildZipBuffer([
        { name: 'test.txt', content: fileContent },
        { name: MANIFEST_FILENAME, content: JSON.stringify(manifest) }
      ]);
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zip,
      });
      assert.strictEqual(res.status, 422);
      const body = await res.json();
      assert.strictEqual(body.code, 'UNLOCKED_VERSION');
    });
  });

  describe('unsafe entry name', () => {
    it('rejects path traversal with 400 UNSAFE_ENTRY_NAME', async () => {
      const manifest = validManifest();
      const zip = buildZipBuffer([
        { name: '../../../etc/passwd', content: 'root:x:0:0' },
        { name: MANIFEST_FILENAME, content: JSON.stringify(manifest) }
      ]);
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zip,
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.code, 'UNSAFE_ENTRY_NAME');
    });
  });

  describe('archive limit exceeded', () => {
    it('rejects archive with too many entries through API', async () => {
      const manifest = validManifest();
      const zip = buildZipBuffer([
        { name: MANIFEST_FILENAME, content: JSON.stringify(manifest), method: 0 }
      ]);
      const overridden = Buffer.from(zip);
      const eocdPos = overridden.length - 22;
      overridden.writeUInt16LE(10001, eocdPos + 8);
      overridden.writeUInt16LE(10001, eocdPos + 10);
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: overridden,
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.code, 'ARCHIVE_LIMIT_EXCEEDED');
    });
  });

  describe('validation-only non-persistence contract', () => {
    function snapshotDir(dir) {
      if (!fs.existsSync(dir)) return [];
      const entries = [];
      for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, dirent.name);
        entries.push(full);
        if (dirent.isDirectory()) entries.push(...snapshotDir(full));
      }
      return entries.sort();
    }

    it('successful validation does not create files in DATA_DIR', async () => {
      const before = snapshotDir(process.env.DATA_DIR);
      const zip = buildManifestZip(
        { 'install-config.yaml': 'apiVersion: v1\n', 'agent-config.yaml': 'agent' },
        { openshift: { selectedMinor: '4.21', selectedPatch: '4.21.20', lockedVersion: true } }
      );
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zip,
      });
      assert.strictEqual(res.status, 200);
      const after = snapshotDir(process.env.DATA_DIR);
      assert.deepStrictEqual(after, before);
    });

    it('failed validation does not create files in DATA_DIR', async () => {
      const before = snapshotDir(process.env.DATA_DIR);
      await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: Buffer.from('not a zip'),
      });
      const after = snapshotDir(process.env.DATA_DIR);
      assert.deepStrictEqual(after, before);
    });

    it('response excludes persistence indicators (state, runId, imported, ok, entries, manifest)', async () => {
      const zip = buildManifestZip({ 'install-config.yaml': 'apiVersion: v1\n' });
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zip,
      });
      const body = await res.json();
      assert.strictEqual(body.state, undefined);
      assert.strictEqual(body.runId, undefined);
      assert.strictEqual(body.imported, undefined);
      assert.strictEqual(body.ok, undefined);
      assert.strictEqual(body.entries, undefined);
      assert.strictEqual(body.manifest, undefined);
    });

    it('repeated validation of identical archive is idempotent', async () => {
      const zip = buildManifestZip({ 'install-config.yaml': 'apiVersion: v1\n' });
      const results = [];
      for (let i = 0; i < 3; i++) {
        const res = await fetch(`${baseUrl}/api/bundle.import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/zip' },
          body: zip,
        });
        results.push(await res.json());
      }
      assert.deepStrictEqual(results[0], results[1]);
      assert.deepStrictEqual(results[1], results[2]);
    });
  });

  describe('does not leak internals', () => {
    it('error responses contain only error and code fields', async () => {
      const garbage = Buffer.from('this is not a zip file at all');
      const res = await fetch(`${baseUrl}/api/bundle.import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: garbage,
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.ok(body.error);
      assert.ok(body.code);
      assert.strictEqual(body.stack, undefined);
      assert.strictEqual(body.entries, undefined);
      assert.strictEqual(body.manifest, undefined);
    });
  });
});

describe('/api/run/import — JSON migration path unchanged', () => {
  let server, baseUrl;

  before(async () => {
    ({ server, baseUrl } = await createTestServer(app));
  });

  after(async () => {
    await closeTestServer(server);
  });

  it('accepts a valid JSON run import without manifest validation', async () => {
    const payload = {
      schemaVersion: 2,
      state: {
        version: { _schemaVersion: 3, selectedMinor: '4.21', selectedPatch: '4.21.20', locked: true },
        release: { channel: '4.21', patchVersion: '4.21.20', confirmed: true }
      }
    };
    const res = await fetch(`${baseUrl}/api/run/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(body.state);
  });

  it('rejects invalid run import structure', async () => {
    const res = await fetch(`${baseUrl}/api/run/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 2 }),
    });
    assert.strictEqual(res.status, 400);
  });
});
