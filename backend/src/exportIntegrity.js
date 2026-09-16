import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MANIFEST_FILENAME = 'version-manifest.json';
const MANIFEST_SCHEMA_VERSION = '1.0.0';

function computeSha256(content) {
  const hash = crypto.createHash('sha256');
  hash.update(Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8'));
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

export {
  MANIFEST_FILENAME,
  MANIFEST_SCHEMA_VERSION,
  computeSha256,
  getAppIdentity,
  buildVersionManifest,
  createIntegrityTracker
};
