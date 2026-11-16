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

/**
 * POST /api/bundle.import is withdrawn in v2.1. See DOC-127.
 *
 * This file previously held 27 HTTP integration tests for the archive
 * validation endpoint. That endpoint was an unauthenticated decompression
 * denial of service: the only ingress exempt from the 10 MB JSON cap, it
 * accepted 512 MiB and then inflated every entry into memory, CRC32'd it in a
 * per-byte JS loop and SHA-256'd it again, all synchronously and with no
 * concurrency cap. A small compressed body bought ~1 GiB of RSS and seconds of
 * blocked event loop, which starved the /api/health liveness probe. Nothing
 * called it — no frontend control, no CLI, no e2e spec, no documented workflow.
 *
 * Those tests are rewritten rather than skipped because
 * backend/test/test-integrity.test.js forbids it.skip / describe.skip and
 * every aliased and option-object form of them.
 *
 * Coverage is not lost. What those tests really asserted was that the
 * validator is correct, and that lives in import-integrity.test.js, which
 * exercises validateArchiveBuffer directly and stays green as the regression
 * net for the eventual DOC-127 validator UI. What is gone is only the claim
 * that the validator is reachable over HTTP, which is the point.
 *
 * The ZIP builders above are kept deliberately: the central proof below has to
 * send a genuinely valid archive to be worth anything.
 */
describe('POST /api/bundle.import — withdrawn', () => {
  let server, baseUrl;

  before(async () => {
    ({ server, baseUrl } = await createTestServer(app));
  });

  after(async () => {
    await closeTestServer(server);
  });

  const post = (body, contentType) => fetch(`${baseUrl}/api/bundle.import`, {
    method: 'POST',
    headers: contentType ? { 'Content-Type': contentType } : {},
    body
  });

  it('answers 410 ENDPOINT_WITHDRAWN for a body that used to validate', async () => {
    const zip = buildManifestZip(
      { 'install-config.yaml': 'apiVersion: v1\n' },
      { openshift: { selectedMinor: '4.21', selectedPatch: '4.21.20', lockedVersion: true } }
    );
    const res = await post(zip, 'application/zip');
    assert.strictEqual(res.status, 410);
    assert.deepStrictEqual(await res.json(), {
      error: 'The bundle validation endpoint has been withdrawn.',
      code: 'ENDPOINT_WITHDRAWN'
    });
  });

  /**
   * The actual attack, pinned as a regression test.
   *
   * A deflate stream of zeros amplifies about 1020:1, and the only gate before
   * the inflate loop is a central-directory NAME check for
   * version-manifest.json (exportIntegrity.js:745) — the manifest's contents
   * are not parsed until every entry has been inflated, CRC32'd and retained.
   * So a one-byte junk manifest entry buys the full cost, and the archive is
   * ultimately rejected as MALFORMED_MANIFEST only after the damage is done.
   *
   * Measured against the validator directly, in an isolated memory-capped
   * child process at this scale: 32 KiB of request body produced ~115 MiB of
   * RSS and ~240ms of blocked event loop at 4x this size. The endpoint's own
   * limits permitted 1 GiB, i.e. roughly 2.2s of blocking per request, with no
   * concurrency cap and no authentication.
   *
   * Scaled down deliberately: the assertion is that this body is now ignored,
   * so it costs nothing to send. If the route is ever reconnected to the
   * parser this test starts allocating for real and fails loudly on time.
   */
  it('ignores a decompression bomb that used to cost ~115 MiB and block the loop', async () => {
    const bomb = buildZipBuffer([
      ...Array.from({ length: 4 }, (_, i) => (
        { name: `pad-${i}.bin`, content: Buffer.alloc(8 * 1024 * 1024, 0) })),
      { name: MANIFEST_FILENAME, content: 'x' }
    ]);
    assert.ok(bomb.length < 128 * 1024,
      `bomb should be tiny on the wire, was ${bomb.length} bytes`);

    const started = Date.now();
    const res = await post(bomb, 'application/zip');
    const elapsed = Date.now() - started;

    assert.strictEqual(res.status, 410);
    assert.strictEqual((await res.json()).code, 'ENDPOINT_WITHDRAWN');
    assert.ok(elapsed < 1000,
      `request took ${elapsed}ms — the body looks like it was still inflated`);
  });

  /**
   * The core proof that no parsing happens.
   *
   * These three bodies used to take three visibly different routes through the
   * server: a valid archive returned 200 with manifest fields, random bytes
   * returned 400 INVALID_ARCHIVE, and a truncated archive returned 400 only
   * after the central directory had been read. Each of those outcomes was
   * reachable solely by inflating and hashing the payload.
   *
   * So asserting the three responses are now identical is a behavioural proof
   * that the parser is never entered: any residual inspection of the body
   * would have to make them diverge again. This is preferable to mocking
   * validateArchiveBuffer, which is impossible anyway — ESM namespace objects
   * are frozen, so mock.method cannot patch the export.
   */
  it('cannot tell a valid archive from garbage — the parser is never entered', async () => {
    const valid = buildManifestZip({ 'install-config.yaml': 'apiVersion: v1\n' });
    const garbage = Buffer.alloc(2 * 1024 * 1024, 0x41);
    const truncated = valid.subarray(0, Math.floor(valid.length / 2));

    const seen = [];
    for (const body of [valid, garbage, truncated]) {
      const res = await post(body, 'application/zip');
      seen.push({ status: res.status, body: await res.text() });
    }

    assert.strictEqual(seen[0].status, 410);
    for (const response of seen.slice(1)) {
      assert.deepStrictEqual(response, seen[0],
        'responses differ, so something still inspected the request body');
    }
  });

  it('answers 410 for every content type, including those that used to 415', async () => {
    for (const contentType of [
      'application/zip', 'application/octet-stream',
      'application/json', 'multipart/form-data', 'text/plain', null
    ]) {
      const res = await post('{"not":"a zip"}', contentType);
      assert.strictEqual(res.status, 410, `content-type ${contentType}`);
      assert.strictEqual((await res.json()).code, 'ENDPOINT_WITHDRAWN');
    }
  });

  it('answers 410 for an empty body, which used to be 400 EMPTY_BODY', async () => {
    const res = await post(Buffer.alloc(0), 'application/zip');
    assert.strictEqual(res.status, 410);
    assert.strictEqual((await res.json()).code, 'ENDPOINT_WITHDRAWN');
  });

  it('is withdrawn for every method that reaches the route', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(`${baseUrl}/api/bundle.import`, { method });
      assert.strictEqual(res.status, 410, `${method} should be withdrawn`);
      assert.strictEqual((await res.json()).code, 'ENDPOINT_WITHDRAWN');
    }
  });

  it('answers OPTIONS from the CORS layer, which is not a bypass', async () => {
    // Pinned because the documentation used to claim 410 "on every verb",
    // which is not what happens: app.use(cors()) is registered before this
    // route and terminates the preflight itself. That is correct behaviour —
    // a preflight carries no body and reveals nothing — but the claim was
    // wrong, and asserting the real shape keeps the docs honest.
    const res = await fetch(`${baseUrl}/api/bundle.import`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.invalid', 'Access-Control-Request-Method': 'POST' }
    });
    assert.strictEqual(res.status, 204, 'preflight is answered by cors(), not the route');
    assert.strictEqual((await res.text()).length, 0, 'a preflight must carry no body');
  });

  it('leaves /api/health responsive under repeated oversized uploads', async () => {
    // Deliberately a responsiveness assertion and not a load test. 40 x 1 MiB
    // is enough to pin the regression and nothing like the ~1 GiB per request
    // the old handler allowed; reproducing the original blow-up on a developer
    // workstation is not an acceptable way to test for it. Traffic of this
    // shape previously drove /api/health to ~15s against a 5s liveness
    // threshold, so a health probe failing here is the regression itself.
    const payload = Buffer.alloc(1024 * 1024, 0x42);
    const started = Date.now();
    for (let i = 0; i < 40; i++) {
      await post(payload, 'application/zip');
      const health = await fetch(`${baseUrl}/api/health`);
      assert.strictEqual(health.status, 200, `health degraded on iteration ${i}`);
    }
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 10_000, `40 rejected uploads plus health probes took ${elapsed}ms`);
  });
});

/**
 * Static guard against an accidental revert.
 *
 * Paired with the behavioural proof above rather than standing alone, because
 * it catches a different failure: someone re-registering the route *below* a
 * body parser, where the behavioural test could still pass while the DoS was
 * back.
 *
 * Matches call syntax rather than the bare identifiers. index.js names both
 * symbols in the comment explaining why they are gone, so an identifier-only
 * regex would fire on that comment and fail for the wrong reason.
 */
describe('bundle import parser is unreachable from any route', () => {
  it('index.js contains no express.raw and no validateArchiveBuffer call', async () => {
    const source = await fs.promises.readFile(
      new URL('../src/index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /express\s*\.\s*raw\s*\(/,
      'express.raw reintroduces an unbounded request body buffer');
    assert.doesNotMatch(source, /validateArchiveBuffer\s*\(/,
      'validateArchiveBuffer reintroduces synchronous inflate over request bytes');
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
