import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { SUPPORTED_MINORS } from './versionPolicy.js';

const MANIFEST_FILENAME = 'version-manifest.json';
const MANIFEST_SCHEMA_VERSION = '1.0.0';
const COMPATIBLE_STATE_SCHEMA_VERSION = 3;
const CHECKSUM_PATTERN = /^sha256:[0-9a-f]{64}$/;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const ZIP_SIG_LOCAL = 0x04034b50;
const ZIP_SIG_CENTRAL = 0x02014b50;
const ZIP_SIG_EOCD = 0x06054b50;
const ZIP_SIG_ZIP64_LOCATOR = 0x07064b50;

const ZIP_METHOD_STORED = 0;
const ZIP_METHOD_DEFLATED = 8;

const ZIP_LIMITS = Object.freeze({
  MAX_ARCHIVE_BYTES: 512 * 1024 * 1024,
  MAX_ENTRY_COUNT: 10_000,
  MAX_INDIVIDUAL_UNCOMPRESSED_BYTES: 256 * 1024 * 1024,
  MAX_TOTAL_UNCOMPRESSED_BYTES: 1024 * 1024 * 1024
});

function computeSha256(content) {
  const hash = crypto.createHash('sha256');
  if (Buffer.isBuffer(content) || ArrayBuffer.isView(content)) {
    hash.update(content);
  } else {
    hash.update(Buffer.from(String(content), 'utf8'));
  }
  return `sha256:${hash.digest('hex')}`;
}

function getAppIdentity() {
  const commit = (process.env.APP_GIT_SHA || 'unknown').trim();
  const buildTime = (process.env.APP_BUILD_TIME || 'unknown').trim();

  let version = 'unknown';
  try {
    const packagePath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '../package.json'
    );
    version = JSON.parse(fs.readFileSync(packagePath, 'utf-8')).version || 'unknown';
  } catch {
    // version stays "unknown"
  }

  return { version, commit, buildTime };
}

function walkDirectorySync(dirPath, prefix) {
  const results = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    const entryName = prefix ? `${prefix}/${entry.name}` : entry.name;
    const resolved = entry.isSymbolicLink() ? fs.statSync(fullPath) : entry;
    if (resolved.isDirectory()) {
      results.push(...walkDirectorySync(fullPath, entryName));
    } else if (resolved.isFile()) {
      results.push({ name: entryName, path: fullPath });
    }
  }
  return results;
}

function buildVersionManifest(v3State, fileChecksums) {
  return {
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    generated: {
      timestamp: new Date().toISOString(),
      appIdentity: getAppIdentity(),
      stateSchemaVersion: v3State.version?._schemaVersion ?? 3
    },
    openshift: {
      selectedMinor: v3State.version?.selectedMinor,
      selectedPatch: v3State.version?.selectedPatch || v3State.release?.patchVersion,
      lockedVersion: v3State.version?.locked === true
    },
    compatibility: {
      minimumManifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      stateFormatCompatible: [3],
      warnings: []
    },
    integrity: {
      algorithm: 'sha-256',
      format: 'lowercase-hex',
      files: { ...fileChecksums }
    }
  };
}

function createIntegrityTracker(archive) {
  const checksums = {};

  return {
    append(content, options) {
      archive.append(content, options);
      checksums[options.name] = computeSha256(content);
    },
    file(filePath, options) {
      const content = fs.readFileSync(filePath);
      const { mode } = fs.statSync(filePath);
      archive.append(content, { ...options, mode });
      checksums[options.name] = computeSha256(content);
    },
    directory(dirPath, prefix) {
      for (const entry of walkDirectorySync(dirPath, prefix)) {
        const content = fs.readFileSync(entry.path);
        const { mode } = fs.statSync(entry.path);
        archive.append(content, { name: entry.name, mode });
        checksums[entry.name] = computeSha256(content);
      }
    },
    buildManifest(v3State) {
      return buildVersionManifest(v3State, checksums);
    },
    getChecksums() {
      return { ...checksums };
    }
  };
}

function makeImportError(code, message, details) {
  const err = new Error(message);
  err.code = code;
  if (details) err.details = details;
  return err;
}

function requireString(obj, field, section) {
  if (typeof obj[field] !== 'string') {
    throw makeImportError('MALFORMED_MANIFEST', `Missing or invalid ${section}.${field}: expected string`, { field: `${section}.${field}`, received: obj[field] });
  }
}

function requireObject(obj, field, section) {
  const val = obj[field];
  if (!val || typeof val !== 'object' || Array.isArray(val)) {
    throw makeImportError('MALFORMED_MANIFEST', `Missing or invalid ${section}: expected object`, { field: section });
  }
}

function normalizeEntryName(name) {
  const segments = name.split('/');
  const resolved = [];
  for (const seg of segments) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') { resolved.pop(); continue; }
    resolved.push(seg);
  }
  return resolved.join('/');
}

function detectNameCollisions(names, label) {
  const normalizedMap = new Map();
  for (const name of names) {
    const norm = normalizeEntryName(name);
    if (normalizedMap.has(norm)) {
      throw makeImportError('NAME_COLLISION', `${label} entries "${normalizedMap.get(norm)}" and "${name}" resolve to the same normalized path "${norm}"`, { first: normalizedMap.get(norm), second: name, normalized: norm });
    }
    normalizedMap.set(norm, name);
  }
}

function isManifestAlias(name) {
  return normalizeEntryName(name) === MANIFEST_FILENAME;
}

function validateArchiveManifest(manifest, archiveEntries) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw makeImportError('MALFORMED_MANIFEST', 'Manifest must be a non-null object');
  }

  if (typeof manifest.manifestSchemaVersion !== 'string') {
    throw makeImportError('MALFORMED_MANIFEST', 'Missing or invalid manifestSchemaVersion: expected string', { field: 'manifestSchemaVersion', received: manifest.manifestSchemaVersion });
  }
  if (manifest.manifestSchemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw makeImportError('UNSUPPORTED_MANIFEST_SCHEMA', `Unsupported manifestSchemaVersion: ${manifest.manifestSchemaVersion}; expected ${MANIFEST_SCHEMA_VERSION}`, { received: manifest.manifestSchemaVersion, expected: MANIFEST_SCHEMA_VERSION });
  }

  requireObject(manifest, 'generated', 'generated');
  if (typeof manifest.generated.stateSchemaVersion !== 'number') {
    throw makeImportError('MALFORMED_MANIFEST', 'Missing or invalid generated.stateSchemaVersion: expected number', { field: 'generated.stateSchemaVersion', received: manifest.generated.stateSchemaVersion });
  }
  if (manifest.generated.stateSchemaVersion !== COMPATIBLE_STATE_SCHEMA_VERSION) {
    throw makeImportError('INCOMPATIBLE_STATE_SCHEMA', `Incompatible stateSchemaVersion: ${manifest.generated.stateSchemaVersion}; expected ${COMPATIBLE_STATE_SCHEMA_VERSION}`, { received: manifest.generated.stateSchemaVersion, expected: COMPATIBLE_STATE_SCHEMA_VERSION });
  }
  requireString(manifest.generated, 'timestamp', 'generated');
  requireObject(manifest.generated, 'appIdentity', 'generated.appIdentity');
  requireString(manifest.generated.appIdentity, 'version', 'generated.appIdentity');
  requireString(manifest.generated.appIdentity, 'commit', 'generated.appIdentity');
  requireString(manifest.generated.appIdentity, 'buildTime', 'generated.appIdentity');

  requireObject(manifest, 'openshift', 'openshift');
  if (typeof manifest.openshift.selectedMinor !== 'string') {
    throw makeImportError('MALFORMED_MANIFEST', 'Missing or invalid openshift.selectedMinor: expected string', { field: 'openshift.selectedMinor', received: manifest.openshift.selectedMinor });
  }
  if (!SUPPORTED_MINORS.includes(manifest.openshift.selectedMinor)) {
    throw makeImportError('UNSUPPORTED_VERSION', `Unsupported openshift.selectedMinor: ${manifest.openshift.selectedMinor}`, { received: manifest.openshift.selectedMinor, supportedVersions: [...SUPPORTED_MINORS] });
  }
  const minor = manifest.openshift.selectedMinor;
  requireString(manifest.openshift, 'selectedPatch', 'openshift');
  if (typeof manifest.openshift.lockedVersion !== 'boolean') {
    throw makeImportError('MALFORMED_MANIFEST', 'Missing or invalid openshift.lockedVersion: expected boolean', { field: 'openshift.lockedVersion', received: manifest.openshift.lockedVersion });
  }
  if (manifest.openshift.lockedVersion !== true) {
    throw makeImportError('UNLOCKED_VERSION', 'Archive was exported from an unlocked version state; import requires lockedVersion === true', { received: manifest.openshift.lockedVersion });
  }

  requireObject(manifest, 'compatibility', 'compatibility');
  requireString(manifest.compatibility, 'minimumManifestSchemaVersion', 'compatibility');
  if (manifest.compatibility.minimumManifestSchemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw makeImportError('INCOMPATIBLE_MANIFEST_SCHEMA', `Archive requires manifest schema ${manifest.compatibility.minimumManifestSchemaVersion}; this importer supports ${MANIFEST_SCHEMA_VERSION}`, { received: manifest.compatibility.minimumManifestSchemaVersion, supported: MANIFEST_SCHEMA_VERSION });
  }
  if (!Array.isArray(manifest.compatibility.stateFormatCompatible)) {
    throw makeImportError('MALFORMED_MANIFEST', 'Missing or invalid compatibility.stateFormatCompatible: expected array', { field: 'compatibility.stateFormatCompatible' });
  }
  if (!manifest.compatibility.stateFormatCompatible.includes(COMPATIBLE_STATE_SCHEMA_VERSION)) {
    throw makeImportError('INCOMPATIBLE_STATE_SCHEMA', `Archive compatible state formats ${JSON.stringify(manifest.compatibility.stateFormatCompatible)} do not include current schema ${COMPATIBLE_STATE_SCHEMA_VERSION}`, { received: manifest.compatibility.stateFormatCompatible, expected: COMPATIBLE_STATE_SCHEMA_VERSION });
  }
  if (!Array.isArray(manifest.compatibility.warnings)) {
    throw makeImportError('MALFORMED_MANIFEST', 'Missing or invalid compatibility.warnings: expected array', { field: 'compatibility.warnings' });
  }

  requireObject(manifest, 'integrity', 'integrity');
  if (typeof manifest.integrity.algorithm !== 'string') {
    throw makeImportError('MALFORMED_MANIFEST', 'Missing or invalid integrity.algorithm: expected string', { field: 'integrity.algorithm', received: manifest.integrity.algorithm });
  }
  if (manifest.integrity.algorithm !== 'sha-256') {
    throw makeImportError('INVALID_CHECKSUM_ALGORITHM', `Unsupported integrity algorithm: ${manifest.integrity.algorithm}; expected sha-256`, { received: manifest.integrity.algorithm });
  }
  if (manifest.integrity.format !== 'lowercase-hex') {
    throw makeImportError('MALFORMED_MANIFEST', `Missing or invalid integrity.format: expected "lowercase-hex"`, { field: 'integrity.format', received: manifest.integrity.format });
  }
  if (!manifest.integrity.files || typeof manifest.integrity.files !== 'object' || Array.isArray(manifest.integrity.files)) {
    throw makeImportError('MALFORMED_MANIFEST', 'Missing or invalid integrity.files section');
  }

  const manifestFileEntries = manifest.integrity.files;

  if (MANIFEST_FILENAME in manifestFileEntries) {
    throw makeImportError('MANIFEST_SELF_REFERENCE', `${MANIFEST_FILENAME} must not appear in integrity.files`);
  }

  const manifestNames = Object.keys(manifestFileEntries);
  for (const name of manifestNames) {
    if (isManifestAlias(name)) {
      throw makeImportError('MANIFEST_SELF_REFERENCE', `Checksum key "${name}" resolves to ${MANIFEST_FILENAME}`, { file: name, normalized: MANIFEST_FILENAME });
    }
    const checksum = manifestFileEntries[name];
    if (typeof checksum !== 'string' || !CHECKSUM_PATTERN.test(checksum)) {
      throw makeImportError('INVALID_CHECKSUM_FORMAT', `Invalid checksum for ${name}: expected sha256:<64 lowercase hex>`, { file: name, received: checksum });
    }
  }

  detectNameCollisions(manifestNames, 'Checksum');

  if (!archiveEntries || typeof archiveEntries !== 'object' || Array.isArray(archiveEntries)) {
    throw makeImportError('MALFORMED_MANIFEST', 'archiveEntries must be a non-null object');
  }

  const archiveNames = Object.keys(archiveEntries).filter(n => n !== MANIFEST_FILENAME);
  for (const name of archiveNames) {
    if (isManifestAlias(name)) {
      throw makeImportError('MANIFEST_SELF_REFERENCE', `Archive entry "${name}" resolves to ${MANIFEST_FILENAME}`, { file: name, normalized: MANIFEST_FILENAME });
    }
  }

  const manifestNameSet = new Set(manifestNames);
  const archiveNameSet = new Set(archiveNames);

  if (archiveNameSet.size !== archiveNames.length) {
    const seen = new Set();
    const dupes = [];
    for (const n of archiveNames) {
      if (seen.has(n)) dupes.push(n);
      seen.add(n);
    }
    throw makeImportError('DUPLICATE_ENTRY', `Duplicate archive entry names: ${dupes.join(', ')}`, { duplicates: dupes });
  }

  detectNameCollisions(archiveNames, 'Archive');

  for (const name of manifestNames) {
    if (!archiveNameSet.has(name)) {
      throw makeImportError('MISSING_FILE', `Manifest references file not found in archive: ${name}`, { file: name });
    }
  }

  for (const name of archiveNames) {
    if (!manifestNameSet.has(name)) {
      throw makeImportError('UNLISTED_FILE', `Archive contains file without checksum coverage: ${name}`, { file: name });
    }
  }

  for (const name of manifestNames) {
    const fileBytes = archiveEntries[name];
    if (!Buffer.isBuffer(fileBytes) && !(fileBytes instanceof Uint8Array)) {
      throw makeImportError('MALFORMED_MANIFEST', `Archive entry ${name} must be a Buffer or Uint8Array`, { file: name });
    }
    const computed = computeSha256(fileBytes);
    const expected = manifestFileEntries[name];
    if (computed !== expected) {
      throw makeImportError('CHECKSUM_MISMATCH', `Checksum mismatch for ${name}`, { file: name, expected, computed });
    }
  }

  return {
    valid: true,
    manifestSchemaVersion: manifest.manifestSchemaVersion,
    stateSchemaVersion: manifest.generated.stateSchemaVersion,
    selectedMinor: minor,
    fileCount: manifestNames.length
  };
}

function findEocd(buf) {
  const minPos = Math.max(0, buf.length - 22 - 65535);
  for (let pos = buf.length - 22; pos >= minPos; pos--) {
    if (buf.readUInt32LE(pos) === ZIP_SIG_EOCD) {
      const commentLen = buf.readUInt16LE(pos + 20);
      if (pos + 22 + commentLen === buf.length) {
        return pos;
      }
    }
  }
  throw makeImportError('INVALID_ARCHIVE', 'End of central directory record not found');
}

function validateArchiveBuffer(zipBuffer) {
  if (!Buffer.isBuffer(zipBuffer)) {
    throw makeImportError('INVALID_ARCHIVE', 'Expected a Buffer', { received: typeof zipBuffer });
  }
  if (zipBuffer.length > ZIP_LIMITS.MAX_ARCHIVE_BYTES) {
    throw makeImportError('ARCHIVE_LIMIT_EXCEEDED',
      `Archive size ${zipBuffer.length} exceeds limit of ${ZIP_LIMITS.MAX_ARCHIVE_BYTES} bytes`,
      { limit: 'MAX_ARCHIVE_BYTES', actual: zipBuffer.length, max: ZIP_LIMITS.MAX_ARCHIVE_BYTES });
  }
  if (zipBuffer.length < 22) {
    throw makeImportError('INVALID_ARCHIVE', 'Buffer too small to contain a valid ZIP archive');
  }

  const eocdPos = findEocd(zipBuffer);

  if (eocdPos >= 20) {
    if (zipBuffer.readUInt32LE(eocdPos - 20) === ZIP_SIG_ZIP64_LOCATOR) {
      throw makeImportError('UNSUPPORTED_ZIP_FEATURE', 'ZIP64 archives are not supported');
    }
  }

  const diskNumber = zipBuffer.readUInt16LE(eocdPos + 4);
  const cdDisk = zipBuffer.readUInt16LE(eocdPos + 6);
  const cdCountDisk = zipBuffer.readUInt16LE(eocdPos + 8);
  const cdCountTotal = zipBuffer.readUInt16LE(eocdPos + 10);
  const cdSize = zipBuffer.readUInt32LE(eocdPos + 12);
  const cdOffset = zipBuffer.readUInt32LE(eocdPos + 16);

  if (diskNumber !== 0 || cdDisk !== 0) {
    throw makeImportError('UNSUPPORTED_ZIP_FEATURE', 'Multi-disk ZIP archives are not supported');
  }
  if (cdCountDisk !== cdCountTotal) {
    throw makeImportError('INVALID_ARCHIVE',
      'Central directory entry count mismatch between disk and total');
  }
  if (cdCountTotal === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) {
    throw makeImportError('UNSUPPORTED_ZIP_FEATURE', 'ZIP64 archives are not supported');
  }
  if (cdCountTotal > ZIP_LIMITS.MAX_ENTRY_COUNT) {
    throw makeImportError('ARCHIVE_LIMIT_EXCEEDED',
      `Entry count ${cdCountTotal} exceeds limit of ${ZIP_LIMITS.MAX_ENTRY_COUNT}`,
      { limit: 'MAX_ENTRY_COUNT', actual: cdCountTotal, max: ZIP_LIMITS.MAX_ENTRY_COUNT });
  }
  if (cdOffset + cdSize > zipBuffer.length) {
    throw makeImportError('INVALID_ARCHIVE', 'Central directory extends beyond archive bounds');
  }

  const entries = [];
  const nameSet = new Set();
  let pos = cdOffset;

  for (let i = 0; i < cdCountTotal; i++) {
    if (pos + 46 > cdOffset + cdSize) {
      throw makeImportError('INVALID_ARCHIVE', 'Truncated central directory entry');
    }
    if (zipBuffer.readUInt32LE(pos) !== ZIP_SIG_CENTRAL) {
      throw makeImportError('INVALID_ARCHIVE',
        `Invalid central directory signature at offset ${pos}`);
    }

    const versionMadeBy = zipBuffer.readUInt16LE(pos + 4);
    const flags = zipBuffer.readUInt16LE(pos + 8);
    const method = zipBuffer.readUInt16LE(pos + 10);
    const entryCrc32 = zipBuffer.readUInt32LE(pos + 16);
    const compressedSize = zipBuffer.readUInt32LE(pos + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(pos + 24);
    const nameLength = zipBuffer.readUInt16LE(pos + 28);
    const extraLength = zipBuffer.readUInt16LE(pos + 30);
    const commentLength = zipBuffer.readUInt16LE(pos + 32);
    const externalAttrs = zipBuffer.readUInt32LE(pos + 38);
    const versionNeeded = zipBuffer.readUInt16LE(pos + 6);
    const localHeaderOffset = zipBuffer.readUInt32LE(pos + 42);

    if (pos + 46 + nameLength + extraLength + commentLength > cdOffset + cdSize) {
      throw makeImportError('INVALID_ARCHIVE',
        'Central directory entry extends beyond central directory bounds');
    }
    if (compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF ||
        localHeaderOffset === 0xFFFFFFFF) {
      throw makeImportError('UNSUPPORTED_ZIP_FEATURE', 'ZIP64 archives are not supported');
    }

    const nameBuffer = zipBuffer.subarray(pos + 46, pos + 46 + nameLength);
    let name;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(nameBuffer);
    } catch {
      throw makeImportError('INVALID_ARCHIVE', 'Entry name contains malformed UTF-8');
    }

    if (flags & 0x01) {
      throw makeImportError('UNSUPPORTED_ZIP_FEATURE',
        'Encrypted entries are not supported', { file: name });
    }
    if (flags & 0x40) {
      throw makeImportError('UNSUPPORTED_ZIP_FEATURE',
        'Encrypted entries are not supported', { file: name });
    }

    if (name.length === 0) {
      throw makeImportError('UNSAFE_ENTRY_NAME', 'Empty entry name');
    }
    if (name.includes('\0')) {
      throw makeImportError('UNSAFE_ENTRY_NAME', 'Entry name contains null byte',
        { file: name.replace(/\0/g, '\\0') });
    }
    if (name.includes('\\')) {
      throw makeImportError('UNSAFE_ENTRY_NAME', 'Entry name contains backslash',
        { file: name });
    }
    if (name.startsWith('/')) {
      throw makeImportError('UNSAFE_ENTRY_NAME', 'Absolute path in entry name',
        { file: name });
    }
    const segments = name.replace(/\/$/, '').split('/');
    for (const seg of segments) {
      if (seg === '..') {
        throw makeImportError('UNSAFE_ENTRY_NAME', 'Path traversal in entry name',
          { file: name });
      }
    }

    if (/^[A-Za-z]:\//.test(name)) {
      throw makeImportError('UNSAFE_ENTRY_NAME',
        'Windows drive-absolute path in entry name', { file: name });
    }

    if (versionNeeded >= 45) {
      throw makeImportError('UNSUPPORTED_ZIP_FEATURE',
        'ZIP64 archives are not supported', { file: name, versionNeeded });
    }

    const extraFieldStart = pos + 46 + nameLength;
    let extraFieldPos = extraFieldStart;
    while (extraFieldPos + 4 <= extraFieldStart + extraLength) {
      const fieldId = zipBuffer.readUInt16LE(extraFieldPos);
      const fieldSize = zipBuffer.readUInt16LE(extraFieldPos + 2);
      if (fieldId === 0x0001) {
        throw makeImportError('UNSUPPORTED_ZIP_FEATURE',
          'ZIP64 extended information in central directory', { file: name });
      }
      extraFieldPos += 4 + fieldSize;
    }

    const hostOS = (versionMadeBy >> 8) & 0xFF;
    if (hostOS === 3) {
      const unixMode = (externalAttrs >>> 16) & 0xFFFF;
      const fileType = unixMode & 0o170000;
      if (fileType === 0o120000) {
        throw makeImportError('UNSUPPORTED_ZIP_FEATURE',
          'Symlink entries are not supported', { file: name });
      }
      if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) {
        throw makeImportError('UNSUPPORTED_ZIP_FEATURE',
          'Special file entries are not supported', { file: name });
      }
    }

    const isDirectory = name.endsWith('/');

    if (nameSet.has(name)) {
      throw makeImportError('DUPLICATE_ENTRY', `Duplicate entry name: ${name}`,
        { file: name });
    }
    if (isDirectory) {
      const baseName = name.slice(0, -1);
      if (nameSet.has(baseName)) {
        throw makeImportError('UNSAFE_ENTRY_NAME',
          `File-directory ambiguity: "${baseName}" exists as both file and directory`,
          { file: name, conflicting: baseName });
      }
    } else if (nameSet.has(name + '/')) {
      throw makeImportError('UNSAFE_ENTRY_NAME',
        `File-directory ambiguity: "${name}" exists as both file and directory`,
        { file: name, conflicting: name + '/' });
    }
    nameSet.add(name);

    if (isDirectory) {
      if (method !== ZIP_METHOD_STORED) {
        throw makeImportError('INVALID_ARCHIVE',
          `Directory entry "${name}" has non-stored compression method`,
          { file: name, method });
      }
      if (compressedSize !== 0 || uncompressedSize !== 0) {
        throw makeImportError('INVALID_ARCHIVE',
          `Directory entry "${name}" has non-zero size`,
          { file: name, compressedSize, uncompressedSize });
      }
      pos += 46 + nameLength + extraLength + commentLength;
      continue;
    }

    if (method !== ZIP_METHOD_STORED && method !== ZIP_METHOD_DEFLATED) {
      throw makeImportError('UNSUPPORTED_ZIP_FEATURE',
        `Unsupported compression method ${method}`, { file: name, method });
    }

    if (uncompressedSize > ZIP_LIMITS.MAX_INDIVIDUAL_UNCOMPRESSED_BYTES) {
      throw makeImportError('ARCHIVE_LIMIT_EXCEEDED',
        `Entry "${name}" uncompressed size ${uncompressedSize} exceeds limit`,
        { limit: 'MAX_INDIVIDUAL_UNCOMPRESSED_BYTES', file: name,
          actual: uncompressedSize, max: ZIP_LIMITS.MAX_INDIVIDUAL_UNCOMPRESSED_BYTES });
    }

    entries.push({
      name, method, flags, crc32: entryCrc32,
      compressedSize, uncompressedSize, localHeaderOffset
    });
    pos += 46 + nameLength + extraLength + commentLength;
  }

  if (pos !== cdOffset + cdSize) {
    throw makeImportError('INVALID_ARCHIVE',
      'Central directory size does not match consumed bytes');
  }

  for (const entry of entries) {
    if (entry.name !== MANIFEST_FILENAME && isManifestAlias(entry.name)) {
      throw makeImportError('MULTIPLE_MANIFESTS',
        `Entry "${entry.name}" resolves to ${MANIFEST_FILENAME}`,
        { file: entry.name, normalized: MANIFEST_FILENAME });
    }
  }

  const manifestCount = entries.filter(e => e.name === MANIFEST_FILENAME).length;
  if (manifestCount === 0) {
    throw makeImportError('MISSING_MANIFEST',
      `Archive does not contain ${MANIFEST_FILENAME}`);
  }
  if (manifestCount > 1) {
    throw makeImportError('MULTIPLE_MANIFESTS',
      `Archive contains ${manifestCount} entries named ${MANIFEST_FILENAME}`);
  }

  let totalDeclaredUncompressed = 0;
  for (const entry of entries) {
    totalDeclaredUncompressed += entry.uncompressedSize;
    if (totalDeclaredUncompressed > ZIP_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw makeImportError('ARCHIVE_LIMIT_EXCEEDED',
        `Total uncompressed size exceeds limit of ${ZIP_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES}`,
        { limit: 'MAX_TOTAL_UNCOMPRESSED_BYTES', max: ZIP_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES });
    }
  }

  const archiveEntries = {};
  const localRegions = [];
  let totalExtracted = 0;

  for (const entry of entries) {
    if (entry.localHeaderOffset + 30 > zipBuffer.length) {
      throw makeImportError('INVALID_ARCHIVE',
        `Local file header for "${entry.name}" extends beyond archive bounds`);
    }
    if (zipBuffer.readUInt32LE(entry.localHeaderOffset) !== ZIP_SIG_LOCAL) {
      throw makeImportError('INVALID_ARCHIVE',
        `Invalid local file header signature for "${entry.name}"`);
    }

    const localVersionNeeded = zipBuffer.readUInt16LE(entry.localHeaderOffset + 4);
    const localFlags = zipBuffer.readUInt16LE(entry.localHeaderOffset + 6);
    const localMethod = zipBuffer.readUInt16LE(entry.localHeaderOffset + 8);
    const localCrc32Val = zipBuffer.readUInt32LE(entry.localHeaderOffset + 14);
    const localCompressedSize = zipBuffer.readUInt32LE(entry.localHeaderOffset + 18);
    const localUncompressedSize = zipBuffer.readUInt32LE(entry.localHeaderOffset + 22);
    const localNameLength = zipBuffer.readUInt16LE(entry.localHeaderOffset + 26);
    const localExtraLength = zipBuffer.readUInt16LE(entry.localHeaderOffset + 28);

    if (entry.localHeaderOffset + 30 + localNameLength > zipBuffer.length) {
      throw makeImportError('INVALID_ARCHIVE',
        `Local file header name for "${entry.name}" extends beyond archive bounds`);
    }
    const localNameBuffer = zipBuffer.subarray(
      entry.localHeaderOffset + 30,
      entry.localHeaderOffset + 30 + localNameLength
    );
    let localName;
    try {
      localName = new TextDecoder('utf-8', { fatal: true }).decode(localNameBuffer);
    } catch {
      throw makeImportError('INVALID_ARCHIVE',
        `Local file header name for "${entry.name}" contains malformed UTF-8`);
    }
    if (localName !== entry.name) {
      throw makeImportError('INVALID_ARCHIVE',
        `Local file header name does not match central directory name "${entry.name}"`);
    }

    if (localVersionNeeded >= 45) {
      throw makeImportError('UNSUPPORTED_ZIP_FEATURE',
        'ZIP64 archives are not supported', { file: entry.name });
    }
    if (localMethod !== entry.method) {
      throw makeImportError('INVALID_ARCHIVE',
        `Local header method does not match central directory for "${entry.name}"`,
        { file: entry.name, localMethod, centralMethod: entry.method });
    }
    if (localFlags !== entry.flags) {
      throw makeImportError('INVALID_ARCHIVE',
        `Local header flags do not match central directory for "${entry.name}"`,
        { file: entry.name, localFlags, centralFlags: entry.flags });
    }

    const localExtraFieldStart = entry.localHeaderOffset + 30 + localNameLength;
    let localExtraFieldPos = localExtraFieldStart;
    while (localExtraFieldPos + 4 <= localExtraFieldStart + localExtraLength) {
      const fieldId = zipBuffer.readUInt16LE(localExtraFieldPos);
      const fieldSize = zipBuffer.readUInt16LE(localExtraFieldPos + 2);
      if (fieldId === 0x0001) {
        throw makeImportError('UNSUPPORTED_ZIP_FEATURE',
          'ZIP64 extended information in local header', { file: entry.name });
      }
      localExtraFieldPos += 4 + fieldSize;
    }

    const hasDataDescriptor = (entry.flags & 0x08) !== 0;
    if (hasDataDescriptor) {
      if (localCrc32Val !== 0 || localCompressedSize !== 0 || localUncompressedSize !== 0) {
        throw makeImportError('INVALID_ARCHIVE',
          `Local header for "${entry.name}" has data descriptor flag but non-zero CRC/sizes`,
          { file: entry.name });
      }
    } else {
      if (localCrc32Val !== entry.crc32) {
        throw makeImportError('INVALID_ARCHIVE',
          `Local header CRC32 does not match central directory for "${entry.name}"`,
          { file: entry.name });
      }
      if (localCompressedSize !== entry.compressedSize) {
        throw makeImportError('INVALID_ARCHIVE',
          `Local header compressed size does not match central directory for "${entry.name}"`,
          { file: entry.name });
      }
      if (localUncompressedSize !== entry.uncompressedSize) {
        throw makeImportError('INVALID_ARCHIVE',
          `Local header uncompressed size does not match central directory for "${entry.name}"`,
          { file: entry.name });
      }
    }

    const dataStart = entry.localHeaderOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + entry.compressedSize > zipBuffer.length) {
      throw makeImportError('INVALID_ARCHIVE',
        `Compressed data for "${entry.name}" extends beyond archive bounds`);
    }

    const compressedData = zipBuffer.subarray(dataStart, dataStart + entry.compressedSize);
    let uncompressedData;

    if (entry.method === ZIP_METHOD_STORED) {
      if (entry.compressedSize !== entry.uncompressedSize) {
        throw makeImportError('INVALID_ARCHIVE',
          `Stored entry "${entry.name}" has mismatched compressed/uncompressed sizes`,
          { file: entry.name,
            compressedSize: entry.compressedSize,
            uncompressedSize: entry.uncompressedSize });
      }
      uncompressedData = compressedData;
    } else {
      try {
        uncompressedData = zlib.inflateRawSync(compressedData, {
          maxOutputLength: ZIP_LIMITS.MAX_INDIVIDUAL_UNCOMPRESSED_BYTES
        });
      } catch (err) {
        if (err.code === 'ERR_BUFFER_TOO_LARGE') {
          throw makeImportError('ARCHIVE_LIMIT_EXCEEDED',
            `Entry "${entry.name}" exceeds maximum uncompressed size during inflation`,
            { limit: 'MAX_INDIVIDUAL_UNCOMPRESSED_BYTES', file: entry.name,
              max: ZIP_LIMITS.MAX_INDIVIDUAL_UNCOMPRESSED_BYTES });
        }
        throw makeImportError('INVALID_ARCHIVE',
          `Failed to decompress "${entry.name}"`, { file: entry.name });
      }
    }

    if (uncompressedData.length !== entry.uncompressedSize) {
      throw makeImportError('INVALID_ARCHIVE',
        `Uncompressed size mismatch for "${entry.name}": expected ${entry.uncompressedSize}, got ${uncompressedData.length}`,
        { file: entry.name, expected: entry.uncompressedSize, actual: uncompressedData.length });
    }

    const computedCrc = crc32(uncompressedData);
    if (computedCrc !== entry.crc32) {
      throw makeImportError('CRC32_MISMATCH', `CRC32 mismatch for "${entry.name}"`,
        { file: entry.name, expected: entry.crc32, computed: computedCrc });
    }

    totalExtracted += uncompressedData.length;
    if (totalExtracted > ZIP_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw makeImportError('ARCHIVE_LIMIT_EXCEEDED', 'Total extracted size exceeds limit',
        { limit: 'MAX_TOTAL_UNCOMPRESSED_BYTES', max: ZIP_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES });
    }

    let entryRegionEnd = dataStart + entry.compressedSize;
    if (hasDataDescriptor) {
      let descPos = entryRegionEnd;
      if (descPos + 4 <= zipBuffer.length &&
          zipBuffer.readUInt32LE(descPos) === 0x08074b50) {
        descPos += 4;
      }
      if (descPos + 12 > zipBuffer.length) {
        throw makeImportError('INVALID_ARCHIVE',
          `Data descriptor for "${entry.name}" extends beyond archive bounds`);
      }
      const descCrc32 = zipBuffer.readUInt32LE(descPos);
      const descCompressedSize = zipBuffer.readUInt32LE(descPos + 4);
      const descUncompressedSize = zipBuffer.readUInt32LE(descPos + 8);
      if (descCrc32 !== entry.crc32 ||
          descCompressedSize !== entry.compressedSize ||
          descUncompressedSize !== entry.uncompressedSize) {
        throw makeImportError('INVALID_ARCHIVE',
          `Data descriptor does not match central directory for "${entry.name}"`);
      }
      entryRegionEnd = descPos + 12;
    }

    if (entryRegionEnd > cdOffset) {
      throw makeImportError('INVALID_ARCHIVE',
        `Local data region for "${entry.name}" extends into central directory`);
    }
    localRegions.push({
      name: entry.name, start: entry.localHeaderOffset, end: entryRegionEnd
    });

    archiveEntries[entry.name] = uncompressedData;
  }

  localRegions.sort((a, b) => a.start - b.start);
  for (let i = 1; i < localRegions.length; i++) {
    if (localRegions[i].start < localRegions[i - 1].end) {
      throw makeImportError('INVALID_ARCHIVE',
        `Local data regions overlap: "${localRegions[i - 1].name}" and "${localRegions[i].name}"`);
    }
  }

  let manifest;
  try {
    manifest = JSON.parse(archiveEntries[MANIFEST_FILENAME].toString('utf8'));
  } catch {
    throw makeImportError('MALFORMED_MANIFEST',
      `${MANIFEST_FILENAME} contains invalid JSON`);
  }

  const result = validateArchiveManifest(manifest, archiveEntries);
  return { ...result, manifest, entries: archiveEntries };
}

export {
  MANIFEST_FILENAME,
  MANIFEST_SCHEMA_VERSION,
  COMPATIBLE_STATE_SCHEMA_VERSION,
  CHECKSUM_PATTERN,
  ZIP_LIMITS,
  computeSha256,
  crc32,
  getAppIdentity,
  buildVersionManifest,
  createIntegrityTracker,
  validateArchiveManifest,
  validateArchiveBuffer
};
