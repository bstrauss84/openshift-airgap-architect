/**
 * OpenShift Airgap Architect - OpenShift Installer Variant Management
 *
 * Handles download, caching, and verification of openshift-install binary variants
 * for multiple platforms (Linux, macOS), architectures (x86_64, arm64, ppc64le, s390x),
 * and types (standard vs FIPS RHEL 9).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import logger from "./logger.js";
import { acquireVerifiedArtifact, digestSidecarPath } from "./verifiedDownload.js";
import {
  verifyCachedBinary,
  discardUnverifiedBinary,
  writeBinaryProvenance,
  describeCacheRejection
} from "./binaryProvenance.js";

const dataDir = process.env.DATA_DIR || "/data";
const toolsDir = path.join(dataDir, "tools");

/**
 * Run a command and return stdout/stderr
 * Inherits environment to support HTTP_PROXY, HTTPS_PROXY, etc.
 */
const runCmd = (cmd, args, options = {}) =>
  new Promise((resolve, reject) => {
    // Inherit environment variables (especially proxy settings)
    const spawnOptions = {
      env: { ...process.env },
      ...options
    };

    const child = spawn(cmd, args, spawnOptions);
    let stdout = "";
    let stderr = "";
    if (child.stdout) {
      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    }
    child.on("error", (err) => {
      // Include command context in error
      const cmdStr = `${cmd} ${args.join(' ')}`;
      err.message = `Command failed: ${cmdStr}\nError: ${err.message}`;
      reject(err);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const cmdStr = `${cmd} ${args.join(' ')}`;
        const errMsg = stderr || stdout || `Exit code ${code}`;
        reject(new Error(`Command failed: ${cmdStr}\n${errMsg}`));
      }
    });
  });

/**
 * Normalize Node.js process.arch to mirror path conventions
 * Node reports: x64, arm64
 * Mirror uses: x86_64 (preferred), arm64, ppc64le, s390x for paths
 * Filenames use: amd64, arm64, ppc64le, s390x
 */
function normalizeInstallerArch(arch) {
  const map = {
    'x64': 'x86_64',      // Node.js x64 -> mirror x86_64 path
    'amd64': 'x86_64',    // Common alias -> mirror x86_64 path
    'x86_64': 'x86_64',   // Already correct
    'arm64': 'arm64',     // Already correct
    'aarch64': 'arm64',   // ARM alias -> arm64
    'ppc64le': 'ppc64le', // Already correct
    's390x': 's390x'      // Already correct
  };
  return map[arch] || arch;
}

/**
 * Get filename architecture (different from path architecture for x86_64/amd64)
 */
function getFilenameArch(pathArch) {
  // Filenames use 'amd64' but paths use 'x86_64'
  if (pathArch === 'x86_64') return 'amd64';
  return pathArch;
}

/**
 * Parse "linux-amd64" or "mac-arm64" into { platform, arch }
 */
function parseInstallerPlatformArch(platformArch) {
  if (!platformArch) return null;
  const [platform, arch] = platformArch.split('-');
  return { platform, arch };
}

/**
 * Build download URLs for different binary variants
 * Returns array of URLs to try (fallback order)
 *
 * Mirror structure:
 * - Path uses: x86_64, arm64, ppc64le, s390x
 * - Filename uses: amd64 (for x86_64), arm64, ppc64le, s390x
 */
function getInstallerUrls(version, platform, arch, useFips) {
  // Note: Mirror uses arch in the base path (e.g., /pub/openshift-v4/x86_64/clients/...)
  const base = `https://mirror.openshift.com/pub/openshift-v4/${arch}/clients/ocp/${version}`;
  const fileArch = getFilenameArch(arch);

  if (useFips) {
    // FIPS RHEL 9 variant (Linux only)
    // Only arch-specific filenames exist for FIPS
    return [
      `${base}/openshift-install-rhel9-${fileArch}.tar.gz`
    ];
  } else if (platform === 'mac') {
    // macOS variants
    // Generic mac binary works for both Intel (x86_64) and ARM64
    // Arch-specific binaries exist for arm64 but NOT for amd64/x86_64
    return [
      `${base}/openshift-install-mac.tar.gz`, // Generic (works for all mac)
      `${base}/openshift-install-mac-${fileArch}.tar.gz` // Arch-specific (arm64 only)
    ];
  } else {
    // Linux standard variants
    return [
      `${base}/openshift-install-linux.tar.gz` // Generic (most common, works for all arch)
    ];
  }
}

/**
 * Download and cache openshift-install binary for specified variant
 *
 * @param {string} version - OpenShift version (e.g., "4.20.18")
 * @param {string} platformArch - Platform+arch (e.g., "linux-amd64", "mac-arm64") or "" for default
 * @param {boolean} useFips - Use FIPS RHEL 9 variant
 * @param {string} dataDir - Data directory path
 * @returns {Promise<string>} Path to cached binary
 */
async function ensureOpenshiftInstaller(version, platformArch, useFips, dataDir) {
  const toolsDir = path.join(dataDir, 'tools');

  // Parse platform/arch or use defaults
  let platform = 'linux';
  let arch = normalizeInstallerArch(process.arch);
  if (platformArch) {
    const parsed = parseInstallerPlatformArch(platformArch);
    if (parsed) {
      platform = parsed.platform;
      arch = parsed.arch;
    }
  }

  // Build cache key (e.g., "openshift-install-4.20.18-linux-amd64-fips")
  const variantKey = [version, platform, arch, useFips ? 'fips' : 'standard'].join('-');
  const cacheDir = path.join(toolsDir, `export-${variantKey}`);

  // Preserve original binary name (openshift-install-fips for FIPS, openshift-install for standard)
  const binaryName = useFips ? 'openshift-install-fips' : 'openshift-install';
  const cachePath = path.join(cacheDir, binaryName);

  // Identity the cached executable must prove before it is exported.
  //
  // This binary is written into bundle.zip under tools/ and run by an operator
  // across the air gap, where the mirror is unreachable by definition. The
  // directory name already encodes the variant, so a cross-variant collision
  // is not the risk here; an extracted binary that predates provenance
  // recording, or that has been corrupted or half-written since, is. Until
  // this change `fs.existsSync(cachePath)` was the entire check.
  //
  // `tarballSha256` is deliberately not asserted on the cache path: it would
  // require the channel manifest, and therefore a network round trip, to reuse
  // bytes this process already verified and recorded. Offline reuse is the
  // point. The executable's own digest is still recomputed every time.
  const identity = {
    tool: binaryName,
    version,
    platform,
    arch,
    variant: useFips ? "fips" : "standard"
  };

  const verdict = await verifyCachedBinary(cachePath, identity);
  if (verdict.usable) {
    logger.info(
      { tag: "openshiftInstaller", variantKey, sha256: verdict.record.binarySha256 },
      "Using cached binary (provenance re-verified)"
    );
    return cachePath;
  }
  if (verdict.reason !== "absent") {
    logger.warn(
      { tag: "openshiftInstaller", variantKey, reason: verdict.reason, detail: verdict.detail },
      "Discarding cached binary that cannot be proven verified"
    );
    await discardUnverifiedBinary(cachePath);
  }

  // Verify tools directory exists and is writable before attempting download
  try {
    await fs.promises.mkdir(toolsDir, { recursive: true });
    await fs.promises.access(toolsDir, fs.constants.W_OK);
  } catch (err) {
    throw new Error(`Tools directory not writable: ${toolsDir}\nError: ${err.message}\nCheck permissions and DATA_DIR environment variable.`);
  }

  // Download from mirror (try multiple URL patterns)
  const urls = getInstallerUrls(version, platform, arch, useFips);
  const attemptedUrls = [];
  const errorDetails = [];

  logger.info({ tag: "openshiftInstaller", variantKey, toolsDir, urlCount: urls.length }, "Downloading installer binary");

  // Log proxy configuration for debugging
  const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy'];
  const activeProxies = proxyVars.filter(v => process.env[v]);
  if (activeProxies.length > 0) {
    logger.info({ tag: "openshiftInstaller", proxies: activeProxies }, "Proxy configuration detected");
  } else {
    logger.debug({ tag: "openshiftInstaller" }, "No proxy configuration detected");
  }

  for (const url of urls) {
    try {
      logger.debug({ tag: "openshiftInstaller", url }, "Attempting URL");
      attemptedUrls.push(url);

      // Use simple paths like installer.js does (no temp directories with timestamps)
      const tarPath = path.join(toolsDir, `installer-${variantKey}.tar.gz`);

      // Verify against the channel's own sha256sum.txt BEFORE extraction.
      //
      // This binary is written into the offline bundle under tools/ and is then
      // run by an operator, across an air gap, to build a cluster. Until this
      // change the only integrity check anywhere on that path was `curl -fsSL`
      // exiting zero — the gap recorded as `verificationGaps` in
      // docs/security/SBOM_AND_PROVENANCE.md.
      //
      // The manifest is fetched per candidate URL rather than once, because the
      // candidates for macOS span two file names (generic and arch-specific) and
      // a missing manifest entry has to fail THAT candidate and move on, exactly
      // as a 404 already did. A candidate whose entry is absent is never
      // downloaded; a candidate that downloads but mismatches is discarded.
      const channelBase = url.slice(0, url.lastIndexOf("/"));
      const fileName = url.slice(url.lastIndexOf("/") + 1);
      logger.debug({ tag: "openshiftInstaller", tarPath, fileName }, "Downloading and verifying tarball");
      const provenance = await acquireVerifiedArtifact({
        artifactUrl: url,
        manifestUrl: `${channelBase}/sha256sum.txt`,
        fileName,
        destPath: tarPath
      });
      logger.info(
        { tag: "openshiftInstaller", fileName, sha256: provenance.sha256, cached: provenance.cached },
        "Installer tarball verified against channel sha256sum.txt"
      );

      // Extract directly to cacheDir (match installer.js pattern)
      logger.debug({ tag: "openshiftInstaller", cacheDir }, "Extracting tarball");
      await fs.promises.mkdir(cacheDir, { recursive: true });
      await runCmd("tar", ["-xzf", tarPath, "-C", cacheDir]);

      // Find extracted binary
      // FIPS binaries are named 'openshift-install-fips', standard are 'openshift-install'
      let extractedBinary = path.join(cacheDir, 'openshift-install');
      if (!fs.existsSync(extractedBinary)) {
        // Try FIPS naming
        extractedBinary = path.join(cacheDir, 'openshift-install-fips');
      }

      if (!fs.existsSync(extractedBinary)) {
        // List what was actually extracted
        const extractedFiles = await fs.promises.readdir(cacheDir);
        throw new Error(`Binary not found after extraction. Files in ${cacheDir}: ${extractedFiles.join(', ')}`);
      }

      logger.debug({ tag: "openshiftInstaller", binary: path.basename(extractedBinary) }, "Found binary");

      // Rename to final cache path
      logger.debug({ tag: "openshiftInstaller", cachePath }, "Moving binary to cache");
      await fs.promises.rename(extractedBinary, cachePath);
      await runCmd("chmod", ["+x", cachePath]);

      // Bind the executable to the verified tarball it came out of. Written
      // after chmod so the digest describes the file in the state a later
      // reuse will hash it in, and atomically, so a crash cannot leave a
      // truncated record that parses into a partial identity.
      await writeBinaryProvenance(cachePath, {
        ...identity,
        tarballSha256: provenance.sha256,
        sourceUrl: url,
        manifestUrl: `${channelBase}/sha256sum.txt`
      });

      // Cleanup tar file and the digest sidecar written beside it. Both go: the
      // extracted binary is what is cached from here on, so a sidecar left
      // pointing at a deleted tarball would be dead metadata that a later
      // integrity check could misread as a verified artifact.
      await fs.promises.unlink(tarPath);
      await fs.promises.rm(digestSidecarPath(tarPath), { force: true }).catch(() => {});

      logger.info({ tag: "openshiftInstaller", variantKey }, "Successfully cached installer binary");

      // Clean up old cached binaries (keep last 2 versions)
      // Run async without waiting (fire-and-forget)
      cleanupOldInstallerBinaries(dataDir).catch(() => {});

      return cachePath;

    } catch (err) {
      const errorDetail = `URL: ${url}\nError: ${err.message}`;
      errorDetails.push(errorDetail);
      logger.error({ tag: "openshiftInstaller", err: { message: err.message }, url }, "Download attempt failed");
      // Try next URL pattern
    }
  }

  // All URLs failed - build comprehensive error message.
  //
  // When a cache was rejected above, say so here. Reusing it would be the
  // defect this change exists to fix, so the offline outcome is an error that
  // names the reason, never a quiet fallback to unprovable bytes.
  const errorMsg = [
    `Failed to download openshift-install for ${variantKey}.`,
    ...(verdict.reason !== "absent"
      ? [
          ``,
          `A cached binary was present at ${cachePath} but was rejected because ` +
            `${describeCacheRejection(verdict.reason, verdict.detail)}. It was discarded ` +
            `rather than exported unverified.`
        ]
      : []),
    ``,
    `Attempted URLs (${attemptedUrls.length}):`,
    ...attemptedUrls.map(u => `  - ${u}`),
    ``,
    `Error details:`,
    ...errorDetails.map(d => `  ${d.split('\n').join('\n  ')}`),
    ``,
    `Mirror structure: https://mirror.openshift.com/pub/openshift-v4/{arch}/clients/ocp/{version}/`,
    `Expected path arch: ${arch}, filename arch: ${getFilenameArch(arch)}`,
    `Tools directory: ${toolsDir}`,
    ``,
    `Troubleshooting:`,
    `  1. Check network connectivity to mirror.openshift.com`,
    `  2. Verify HTTP_PROXY and HTTPS_PROXY environment variables if behind proxy`,
    `  3. Check ${toolsDir} exists and is writable`,
    `  4. Try downloading manually: curl -fsSL "${attemptedUrls[0]}" -o test.tar.gz`
  ].join('\n');

  throw new Error(errorMsg);
}

/**
 * Clean up old cached installer binaries, keeping only the last N versions
 *
 * @param {string} dataDir - Data directory path
 * @param {number} keepLastN - Number of most recent versions to keep (default: 2)
 */
async function cleanupOldInstallerBinaries(dataDir, keepLastN = 2) {
  const toolsDir = path.join(dataDir, 'tools');

  try {
    const entries = await fs.promises.readdir(toolsDir, { withFileTypes: true });

    // Find all export-* directories (cached installer binaries)
    const exportDirs = entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith('export-'))
      .map(entry => {
        // Parse version from directory name: "export-4.20.18-linux-amd64-fips"
        const match = entry.name.match(/^export-(\d+\.\d+\.\d+)-/);
        if (match) {
          return {
            name: entry.name,
            version: match[1],
            path: path.join(toolsDir, entry.name)
          };
        }
        return null;
      })
      .filter(Boolean);

    if (exportDirs.length <= keepLastN) {
      // Not enough cached versions to need cleanup
      return;
    }

    // Group by version and get unique versions
    const versionMap = new Map();
    exportDirs.forEach(dir => {
      if (!versionMap.has(dir.version)) {
        versionMap.set(dir.version, []);
      }
      versionMap.get(dir.version).push(dir);
    });

    // Sort versions (semantic versioning descending: newest first)
    const sortedVersions = Array.from(versionMap.keys()).sort((a, b) => {
      const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
      const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
      if (aMajor !== bMajor) return bMajor - aMajor;
      if (aMinor !== bMinor) return bMinor - aMinor;
      return bPatch - aPatch;
    });

    // Keep last N versions, delete the rest
    const versionsToDelete = sortedVersions.slice(keepLastN);

    if (versionsToDelete.length === 0) {
      return; // Nothing to delete
    }

    logger.info({ tag: "openshiftInstaller", keepLastN, keepVersions: sortedVersions.slice(0, keepLastN) }, "Cleaning up old cached binaries");

    for (const version of versionsToDelete) {
      const dirsForVersion = versionMap.get(version);
      for (const dir of dirsForVersion) {
        try {
          await fs.promises.rm(dir.path, { recursive: true, force: true });
          logger.info({ tag: "openshiftInstaller", dirName: dir.name }, "Deleted old cache");
        } catch (err) {
          logger.warn({ tag: "openshiftInstaller", dirName: dir.name, err: { message: err.message } }, "Failed to delete old cache");
        }
      }
    }
  } catch (err) {
    logger.warn({ tag: "openshiftInstaller", err: { message: err.message } }, "Cleanup failed");
    // Don't throw - cleanup is non-critical
  }
}

export { ensureOpenshiftInstaller, normalizeInstallerArch, cleanupOldInstallerBinaries };
