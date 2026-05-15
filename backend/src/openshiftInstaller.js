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

const dataDir = process.env.DATA_DIR || "/data";
const toolsDir = path.join(dataDir, "tools");

/**
 * Run a command and return stdout/stderr
 */
const runCmd = (cmd, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...options });
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
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || stdout || `${cmd} failed with code ${code}`));
      }
    });
  });

/**
 * Normalize Node.js process.arch to mirror path conventions
 * Node reports: x64, arm64
 * Mirror uses: x86_64, amd64, aarch64, arm64, ppc64le, s390x
 */
function normalizeInstallerArch(arch) {
  const map = {
    'x64': 'amd64',
    'amd64': 'amd64',
    'x86_64': 'amd64',
    'arm64': 'arm64',
    'aarch64': 'arm64',
    'ppc64le': 'ppc64le',
    's390x': 's390x'
  };
  return map[arch] || arch;
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
 */
function getInstallerUrls(version, platform, arch, useFips) {
  // Note: Mirror uses arch in the base path (e.g., /pub/openshift-v4/amd64/clients/...)
  const base = `https://mirror.openshift.com/pub/openshift-v4/${arch}/clients/ocp/${version}`;

  if (useFips) {
    // FIPS RHEL 9 variant (Linux only)
    return [
      `${base}/openshift-install-rhel9-${arch}.tar.gz`,
      `${base}/openshift-install-rhel9-${arch}-${version}.tar.gz` // Try with version suffix
    ];
  } else if (platform === 'mac') {
    // macOS variants
    return [
      `${base}/openshift-install-mac-${arch}.tar.gz`,
      `${base}/openshift-install-mac-${arch}-${version}.tar.gz`,
      `${base}/openshift-install-mac.tar.gz` // Generic fallback
    ];
  } else {
    // Linux standard variants
    return [
      `${base}/openshift-install-linux.tar.gz`, // Generic (most common)
      `${base}/openshift-install-linux-${arch}.tar.gz`,
      `${base}/openshift-install-linux-${arch}-${version}.tar.gz`
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
  const cachePath = path.join(cacheDir, 'openshift-install');

  // Check if already cached
  if (fs.existsSync(cachePath)) {
    console.log(`[openshiftInstaller] Using cached binary: ${variantKey}`);
    return cachePath;
  }

  // Download from mirror (try multiple URL patterns)
  const urls = getInstallerUrls(version, platform, arch, useFips);

  for (const url of urls) {
    try {
      console.log(`[openshiftInstaller] Attempting download: ${url}`);
      const tarPath = path.join(toolsDir, `tmp-installer-${Date.now()}.tar.gz`);
      const extractDir = path.join(toolsDir, `extract-installer-${Date.now()}`);

      // Download tar.gz
      await runCmd("curl", ["-fsSL", url, "-o", tarPath]);

      // Extract
      await fs.promises.mkdir(extractDir, { recursive: true });
      await runCmd("tar", ["-xzf", tarPath, "-C", extractDir]);

      // Find openshift-install binary in extracted files
      const binaryPath = path.join(extractDir, 'openshift-install');
      if (!fs.existsSync(binaryPath)) {
        throw new Error('openshift-install binary not found in archive');
      }

      // Move to cache location
      await fs.promises.mkdir(cacheDir, { recursive: true });
      await fs.promises.copyFile(binaryPath, cachePath);
      await runCmd("chmod", ["+x", cachePath]);

      // Cleanup temp files
      await fs.promises.unlink(tarPath);
      await fs.promises.rm(extractDir, { recursive: true, force: true });

      console.log(`[openshiftInstaller] Downloaded and cached: ${variantKey}`);

      // Clean up old cached binaries (keep last 2 versions)
      // Run async without waiting (fire-and-forget)
      cleanupOldInstallerBinaries(dataDir).catch(() => {});

      return cachePath;

    } catch (err) {
      console.log(`[openshiftInstaller] Failed to download from ${url}: ${err.message}`);
      // Try next URL pattern
    }
  }

  throw new Error(`Failed to download openshift-install for ${variantKey} from any URL pattern`);
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

    console.log(`[openshiftInstaller] Cleaning up old cached binaries (keeping last ${keepLastN} versions: ${sortedVersions.slice(0, keepLastN).join(', ')})`);

    for (const version of versionsToDelete) {
      const dirsForVersion = versionMap.get(version);
      for (const dir of dirsForVersion) {
        try {
          await fs.promises.rm(dir.path, { recursive: true, force: true });
          console.log(`[openshiftInstaller] Deleted old cache: ${dir.name}`);
        } catch (err) {
          console.log(`[openshiftInstaller] Failed to delete ${dir.name}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.log(`[openshiftInstaller] Cleanup failed: ${err.message}`);
    // Don't throw - cleanup is non-critical
  }
}

export { ensureOpenshiftInstaller, normalizeInstallerArch, cleanupOldInstallerBinaries };
