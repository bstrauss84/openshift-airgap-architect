/**
 * OpenShift Airgap Architect - oc-mirror Runtime
 *
 * Architecture-aware oc-mirror binary resolution and download.
 * Selection based on backend container runtime architecture (not target Blueprint arch).
 * Priority: OC_MIRROR_BIN env → baked-in binary → runtime-arch download → fail.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { execSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const MIRROR_BASE = "https://mirror.openshift.com/pub/openshift-v4";
const BAKED_IN_OC = "/usr/local/bin/oc";
const BAKED_IN_OC_MIRROR = "/usr/local/bin/oc-mirror";

function isReadableFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** Normalize runtime arch to a canonical name for mirror paths. */
function normalizeRuntimeArch(arch) {
  if (!arch || typeof arch !== "string") return null;
  const s = arch.toLowerCase().trim();
  if (s === "x64" || s === "amd64") return "x86_64";
  if (s === "arm64" || s === "aarch64") return "aarch64";
  if (s === "ppc64le") return "ppc64le";
  if (s === "s390x") return "s390x";
  if (s === "x86_64") return "x86_64";
  return null;
}

const BAKED_IN_ARCH = normalizeRuntimeArch(process.arch) || "x86_64";

/** Get current runtime architecture (Node process.arch). */
function getRuntimeArch() {
  return normalizeRuntimeArch(process.arch);
}

/**
 * Deterministic mirror directory candidates for a normalized arch.
 */
function getMirrorArchCandidates(normalizedArch) {
  if (normalizedArch === "x86_64") return ["x86_64", "amd64"];
  if (normalizedArch === "aarch64") return ["aarch64", "arm64"];
  if (normalizedArch === "ppc64le" || normalizedArch === "s390x") return [normalizedArch];
  return [];
}

// Tool acquisition policy (see CLAUDE.md "External tool version policy"):
//   oc-mirror = GLOBAL latest official release, independent of target OCP minor
//               (Red Hat directs users to the latest oc-mirror v2 regardless of
//               which OCP versions are being mirrored).
//   oc        = latest patch WITHIN the selected supported target minor.
// Both are checksum-verified against Red Hat's own sha256sum.txt and their
// resolved version/hash is recorded. No z-stream is hardcoded.
const OC_MIRROR_CHANNEL = "latest";
const OC_TARBALL = "openshift-client-linux.tar.gz";
const OC_MIRROR_TARBALL = "oc-mirror.tar.gz";

/** Channel directory holding the latest patch for a supported target minor. */
function ocChannelForMinor(minor) {
  if (!minor || !/^\d+\.\d+$/.test(String(minor))) {
    throw new Error(`Invalid OpenShift minor for oc resolution: ${minor}`);
  }
  return `latest-${minor}`;
}

function channelBaseUrl(archDir, channel) {
  return `${MIRROR_BASE}/${archDir}/clients/ocp/${channel}`;
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

/** Resolve the concrete release version a channel currently points at. */
async function resolveChannelVersion(archDir, channel) {
  const url = `${channelBaseUrl(archDir, channel)}/release.txt`;
  const match = (await fetchText(url)).match(/^Name:\s+(\S+)/m);
  if (!match) throw new Error(`Could not determine release version from ${url}`);
  return match[1];
}

/** Read the authoritative SHA256 for one artifact from the channel's sha256sum.txt. */
async function resolveExpectedSha256(archDir, channel, fileName) {
  const url = `${channelBaseUrl(archDir, channel)}/sha256sum.txt`;
  for (const line of (await fetchText(url)).split("\n")) {
    const m = line.match(/^([0-9a-f]{64})\s+(\S+)\s*$/);
    if (m && m[2] === fileName) return m[1];
  }
  throw new Error(`No SHA256 entry for ${fileName} in ${url}`);
}

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function verifySha256(filePath, expectedHash) {
  const actual = sha256File(filePath);
  if (actual !== expectedHash) {
    throw new Error(`SHA256 mismatch for ${path.basename(filePath)}: expected ${expectedHash}, got ${actual}`);
  }
}

// Provenance for every dynamically resolved tool, keyed by `${member}:${arch}:${channel}`.
const _resolvedToolProvenance = new Map();

function recordToolProvenance(entry) {
  _resolvedToolProvenance.set(`${entry.tool}:${entry.arch}:${entry.channel}`, entry);
  return entry;
}

/** All tool resolutions recorded in this process (for bundle/build evidence). */
function getResolvedToolProvenance() {
  return Array.from(_resolvedToolProvenance.values());
}

/**
 * Resolve → verify → extract one official tool. Fails closed on any error:
 * download failure, missing/unparseable checksum metadata, or hash mismatch.
 * Returns { path, tool, version, sha256, url, arch, channel }.
 */
async function acquireVerifiedTool({ archDir, channel, fileName, member, finalPath }) {
  const url = `${channelBaseUrl(archDir, channel)}/${fileName}`;
  const version = await resolveChannelVersion(archDir, channel);
  const expectedSha = await resolveExpectedSha256(archDir, channel, fileName);

  const parentDir = path.dirname(finalPath);
  fs.mkdirSync(parentDir, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(parentDir, "fetch-"));
  try {
    const tgz = path.join(workDir, fileName);
    await downloadToFile(url, tgz);
    verifySha256(tgz, expectedSha);
    const extracted = extractMember(tgz, workDir, member);
    fs.copyFileSync(extracted, finalPath);
    fs.chmodSync(finalPath, 0o755);
    return recordToolProvenance({
      path: finalPath, tool: member, version, sha256: expectedSha, url, arch: archDir, channel
    });
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/**
 * Run preflight on oc-mirror binary.
 * Returns { ok: boolean, message?: string, rawStderr?: string }.
 */
function runPreflight(binPath) {
  if (!binPath || typeof binPath !== "string") {
    return { ok: false, message: "No binary path provided.", rawStderr: "" };
  }
  try {
    const stat = fs.statSync(binPath);
    if (!stat.isFile()) {
      return { ok: false, message: `${binPath} is not a file.`, rawStderr: "" };
    }
    if (!(stat.mode & 0o111)) {
      return { ok: false, message: `${binPath} is not executable.`, rawStderr: "" };
    }
  } catch (e) {
    return {
      ok: false,
      message: `${binPath}: ${e?.message || "not found"}.`,
      rawStderr: ""
    };
  }
  // oc-mirror v2 makes --v1/--v2 mandatory: a bare `oc-mirror version` exits
  // non-zero with "the use of the flag --v1 or --v2 is mandatory", which made
  // this preflight reject every otherwise-healthy binary.
  const result = spawnSync(binPath, ["--v2", "version"], {
    encoding: "utf8",
    timeout: 10000,
    env: { ...process.env, PATH: process.env.PATH || "" }
  });
  const stderr = result.stderr || result.error?.message || "";
  if (result.status !== 0 && result.signal) {
    return {
      ok: false,
      message: `Binary failed to run (signal ${result.signal}).`,
      rawStderr: stderr
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      message: "Configured oc-mirror binary cannot run in this container. The Operators scan requires a local oc-mirror binary that matches the backend runtime architecture. On Apple Silicon, use a native aarch64 binary or configure OC_MIRROR_BIN / OC_MIRROR_URL.",
      rawStderr: stderr
    };
  }
  return { ok: true, rawStderr: stderr };
}

/**
 * True when the binary implements `--v2 list operators`. oc-mirror 4.21.x and
 * earlier expose operator listing only under the deprecated --v1 executor, so
 * operator discovery requires a binary that passes this check.
 */
function supportsV2ListOperators(binPath) {
  if (!binPath) return false;
  const result = spawnSync(binPath, ["--v2", "list", "operators", "--help"], {
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, PATH: process.env.PATH || "" }
  });
  // Exit status alone is not sufficient: when `list` is absent the binary falls
  // through to root help and still exits 0. Require the operator-listing
  // contract to actually appear in the help output.
  const out = `${result.stdout || ""}${result.stderr || ""}`;
  return /oc-mirror list operators/.test(out) && /--catalogs?\b/.test(out);
}

/** Download a URL to a file. */
async function downloadToFile(url, destPath) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${url}`);
  }
  const file = createWriteStream(destPath);
  await pipeline(res.body, file);
}

// GNU tar (1.34, shipped in UBI9) has no --no-absolute-filenames option — that
// spelling is cpio's. Passing it made every extraction fail, which the caller's
// candidate loop swallowed and reported as "Could not fetch oc/oc-mirror".
// GNU tar already strips leading "/" unless -P/--absolute-names is given, so
// the default behavior is what we want.
function extractMember(tarballPath, outDir, member) {
  execSync(`tar -xzf "${tarballPath}" -C "${outDir}" "${member}"`, { stdio: "pipe" });
  const memberPath = path.join(outDir, member);
  fs.chmodSync(memberPath, 0o755);
  return memberPath;
}

function extractOc(tarballPath, outDir) {
  return extractMember(tarballPath, outDir, "oc");
}

function extractOcMirror(tarballPath, outDir) {
  return extractMember(tarballPath, outDir, "oc-mirror");
}

let _lastResolvedArch = null;
let _lastOcPath = null;
let _lastOcMirrorPath = null;
let _lastAcquisitionError = null;
const _exportBinaryFetchInflight = new Map();
function setLastResolvedArch(arch) {
  _lastResolvedArch = arch;
}
function setLastResolvedPaths(ocPath, ocMirrorPath) {
  _lastOcPath = ocPath;
  _lastOcMirrorPath = ocMirrorPath;
}

/**
 * Resolve oc-mirror binary path.
 * Returns { path, source, arch } or { error, rawStderr? }.
 */
async function resolveOcMirrorBinary(dataDir) {
  const envBin = process.env.OC_MIRROR_BIN?.trim();
  if (envBin) {
    const preflight = runPreflight(envBin);
    if (preflight.ok) {
      setLastResolvedArch(getRuntimeArch());
      setLastResolvedPaths(BAKED_IN_OC, envBin);
      return { path: envBin, source: "env", arch: getRuntimeArch() };
    }
    return {
      error: preflight.message,
      rawStderr: preflight.rawStderr
    };
  }

  const runtimeArch = getRuntimeArch();
  const toolsDir = path.join(dataDir || "/data", "tools");

  // Baked-in binary is only usable if it implements v2 operator listing;
  // otherwise fall through and resolve the current global-latest oc-mirror.
  if (fs.existsSync(BAKED_IN_OC_MIRROR)) {
    const preflight = runPreflight(BAKED_IN_OC_MIRROR);
    if (preflight.ok && supportsV2ListOperators(BAKED_IN_OC_MIRROR)) {
      setLastResolvedArch(BAKED_IN_ARCH);
      setLastResolvedPaths(BAKED_IN_OC, BAKED_IN_OC_MIRROR);
      return { path: BAKED_IN_OC_MIRROR, source: "baked-in", arch: BAKED_IN_ARCH };
    }
  }

  // Global-latest oc-mirror, checksum-verified against Red Hat's sha256sum.txt.
  const candidates = getMirrorArchCandidates(runtimeArch);
  let lastError = null;
  for (const archDir of candidates) {
    try {
      const binDir = path.join(toolsDir, "bin");
      const resolved = await acquireVerifiedTool({
        archDir,
        channel: OC_MIRROR_CHANNEL,
        fileName: OC_MIRROR_TARBALL,
        member: "oc-mirror",
        finalPath: path.join(binDir, "oc-mirror")
      });
      const preflight = runPreflight(resolved.path);
      if (!preflight.ok) {
        lastError = preflight.message;
        continue;
      }
      if (!supportsV2ListOperators(resolved.path)) {
        lastError = `Resolved oc-mirror ${resolved.version} does not implement "--v2 list operators".`;
        continue;
      }
      setLastResolvedArch(archDir);
      setLastResolvedPaths(_lastOcPath, resolved.path);
      return {
        path: resolved.path,
        source: "mirror",
        arch: archDir,
        version: resolved.version,
        sha256: resolved.sha256,
        url: resolved.url
      };
    } catch (e) {
      lastError = e?.message || String(e);
      continue;
    }
  }
  if (lastError) {
    _lastAcquisitionError = lastError;
  }

  const mirrorUrl = process.env.OC_MIRROR_URL?.trim();
  const mirrorUrlSha = process.env.OC_MIRROR_SHA256?.trim();
  if (mirrorUrl) {
    if (!mirrorUrlSha) {
      return {
        error: "OC_MIRROR_URL requires OC_MIRROR_SHA256 for artifact integrity verification.",
        rawStderr: ""
      };
    }
    try {
      fs.mkdirSync(toolsDir, { recursive: true });
      const mirrorTgz = path.join(toolsDir, "oc-mirror-override.tar.gz");
      await downloadToFile(mirrorUrl, mirrorTgz);
      verifySha256(mirrorTgz, mirrorUrlSha);
      const extractDir = path.join(toolsDir, "override");
      fs.mkdirSync(extractDir, { recursive: true });
      const mirrorPath = extractOcMirror(mirrorTgz, extractDir);
      fs.unlinkSync(mirrorTgz);
      const preflight = runPreflight(mirrorPath);
      if (preflight.ok) {
        setLastResolvedArch(runtimeArch);
        setLastResolvedPaths(null, mirrorPath);
        return { path: mirrorPath, source: "env-url", arch: runtimeArch };
      }
      return { error: preflight.message, rawStderr: preflight.rawStderr };
    } catch (e) {
      return {
        error: `OC_MIRROR_URL download failed: ${e?.message || e}.`,
        rawStderr: ""
      };
    }
  }

  return {
    error:
      "No usable oc-mirror binary. The Operators scan requires a local oc-mirror that matches the backend runtime architecture and implements \"--v2 list operators\". Set OC_MIRROR_BIN to a native binary path, or OC_MIRROR_URL (with OC_MIRROR_SHA256) to download one. On Apple Silicon, use a native aarch64 binary."
      + (_lastAcquisitionError ? ` Last acquisition error: ${_lastAcquisitionError}` : ""),
    rawStderr: ""
  };
}

function getLocalBinaryArch() {
  if (_lastResolvedArch) return _lastResolvedArch;
  if (fs.existsSync(BAKED_IN_OC_MIRROR)) {
    const preflight = runPreflight(BAKED_IN_OC_MIRROR);
    if (preflight.ok) return BAKED_IN_ARCH;
  }
  return getRuntimeArch();
}

function getLocalBinaryPaths() {
  const lastOc = _lastOcPath && isReadableFile(_lastOcPath) ? _lastOcPath : null;
  const lastOcMirror = _lastOcMirrorPath && isReadableFile(_lastOcMirrorPath) ? _lastOcMirrorPath : null;
  const bakedOc = isReadableFile(BAKED_IN_OC) ? BAKED_IN_OC : null;
  const bakedOcMirror = isReadableFile(BAKED_IN_OC_MIRROR) ? BAKED_IN_OC_MIRROR : null;
  return {
    ocPath: lastOc ?? bakedOc,
    ocMirrorPath: lastOcMirror ?? bakedOcMirror
  };
}

/**
 * Resolve oc and oc-mirror for a downloadable asset bundle.
 *
 * Deliberately asymmetric (see CLAUDE.md "External tool version policy"):
 *   oc        → latest patch within `targetMinor` (must match the target cluster)
 *   oc-mirror → current global latest (vendor directs latest regardless of target)
 *
 * The baked-in `oc` is NOT reused here: it belongs to whichever minor the image
 * was built against, which is not necessarily the selected target minor.
 *
 * Returns { ocPath, ocMirrorPath, provenance: [...] }. Throws (fails closed) on
 * download, checksum-metadata, or integrity failure.
 */
async function getBinariesForExportArch(exportArch, dataDir, targetMinor) {
  const localArch = getLocalBinaryArch();
  const normalizedExport = exportArch ? normalizeRuntimeArch(exportArch) || exportArch : localArch;
  const ocChannel = ocChannelForMinor(targetMinor);

  const toolsDir = path.join(dataDir || "/data", "tools");
  const exportDir = path.join(toolsDir, `export-${normalizedExport}`);
  const ocFinalPath = path.join(exportDir, ocChannel, "oc");
  const ocMirrorFinalPath = path.join(exportDir, OC_MIRROR_CHANNEL, "oc-mirror");

  const fetchKey = `${normalizedExport}:${ocChannel}`;
  const existing = _exportBinaryFetchInflight.get(fetchKey);
  if (existing) return existing;

  const fetchPromise = (async () => {
    const candidates = getMirrorArchCandidates(normalizedExport);
    if (candidates.length === 0) {
      throw new Error(`Unsupported architecture for tool download: ${exportArch ?? normalizedExport}.`);
    }
    let lastError = null;
    for (const archDir of candidates) {
      try {
        const ocResolved = await acquireVerifiedTool({
          archDir, channel: ocChannel, fileName: OC_TARBALL,
          member: "oc", finalPath: ocFinalPath
        });
        const ocMirrorResolved = await acquireVerifiedTool({
          archDir, channel: OC_MIRROR_CHANNEL, fileName: OC_MIRROR_TARBALL,
          member: "oc-mirror", finalPath: ocMirrorFinalPath
        });
        return {
          ocPath: ocResolved.path,
          ocMirrorPath: ocMirrorResolved.path,
          provenance: [ocResolved, ocMirrorResolved]
        };
      } catch (e) {
        lastError = e?.message || String(e);
      }
    }
    throw new Error(
      `Could not fetch oc/oc-mirror for architecture ${normalizedExport}: ${lastError}`
    );
  })();

  _exportBinaryFetchInflight.set(fetchKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    _exportBinaryFetchInflight.delete(fetchKey);
  }
}

export {
  getRuntimeArch,
  resolveOcMirrorBinary,
  getLocalBinaryArch,
  getBinariesForExportArch,
  verifySha256,
  sha256File,
  supportsV2ListOperators,
  resolveChannelVersion,
  resolveExpectedSha256,
  acquireVerifiedTool,
  getResolvedToolProvenance,
  ocChannelForMinor,
  OC_MIRROR_CHANNEL,
  OC_TARBALL,
  OC_MIRROR_TARBALL
};
