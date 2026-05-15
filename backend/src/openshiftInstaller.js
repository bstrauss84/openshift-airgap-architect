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
  const cachePath = path.join(cacheDir, 'openshift-install');

  // Check if already cached
  if (fs.existsSync(cachePath)) {
    console.log(`[openshiftInstaller] Using cached binary: ${variantKey}`);
    return cachePath;
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

  console.log(`[openshiftInstaller] Downloading ${variantKey}`);
  console.log(`[openshiftInstaller] Tools directory: ${toolsDir}`);
  console.log(`[openshiftInstaller] Will try ${urls.length} URL pattern(s)`);

  // Log proxy configuration for debugging
  const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy'];
  const activeProxies = proxyVars.filter(v => process.env[v]);
  if (activeProxies.length > 0) {
    console.log(`[openshiftInstaller] Proxy configuration detected: ${activeProxies.join(', ')}`);
  } else {
    console.log(`[openshiftInstaller] No proxy configuration detected`);
  }

  for (const url of urls) {
    try {
      console.log(`[openshiftInstaller] Attempting: ${url}`);
      attemptedUrls.push(url);

      const tarPath = path.join(toolsDir, `tmp-installer-${Date.now()}.tar.gz`);
      const extractDir = path.join(toolsDir, `extract-installer-${Date.now()}`);

      // Ensure tools directory exists
      await fs.promises.mkdir(toolsDir, { recursive: true });

      // Download tar.gz with verbose error reporting
      try {
        await runCmd("curl", ["-fsSL", "--max-time", "300", url, "-o", tarPath]);
      } catch (curlErr) {
        throw new Error(`Download failed: ${curlErr.message}`);
      }

      // Verify download succeeded and file exists
      if (!fs.existsSync(tarPath)) {
        throw new Error('Downloaded file not found on disk');
      }

      const downloadStats = await fs.promises.stat(tarPath);
      if (downloadStats.size < 1024) {
        throw new Error(`Downloaded file too small (${downloadStats.size} bytes), likely an error page`);
      }

      console.log(`[openshiftInstaller] Downloaded ${(downloadStats.size / 1024 / 1024).toFixed(2)} MB`);

      // Extract
      await fs.promises.mkdir(extractDir, { recursive: true });
      try {
        await runCmd("tar", ["-xzf", tarPath, "-C", extractDir]);
      } catch (tarErr) {
        throw new Error(`Extraction failed: ${tarErr.message}`);
      }

      // Find openshift-install binary in extracted files
      const binaryPath = path.join(extractDir, 'openshift-install');
      if (!fs.existsSync(binaryPath)) {
        // List what was actually extracted
        const extractedFiles = await fs.promises.readdir(extractDir);
        throw new Error(`Binary not found in archive. Extracted files: ${extractedFiles.join(', ')}`);
      }

      // Move to cache location
      await fs.promises.mkdir(cacheDir, { recursive: true });
      await fs.promises.copyFile(binaryPath, cachePath);
      await runCmd("chmod", ["+x", cachePath]);

      // Cleanup temp files
      await fs.promises.unlink(tarPath);
      await fs.promises.rm(extractDir, { recursive: true, force: true });

      console.log(`[openshiftInstaller] Successfully cached: ${variantKey}`);

      // Clean up old cached binaries (keep last 2 versions)
      // Run async without waiting (fire-and-forget)
      cleanupOldInstallerBinaries(dataDir).catch(() => {});

      return cachePath;

    } catch (err) {
      const errorDetail = `URL: ${url}\nError: ${err.message}`;
      errorDetails.push(errorDetail);
      console.error(`[openshiftInstaller] Failed: ${err.message}`);
      // Try next URL pattern
    }
  }

  // All URLs failed - build comprehensive error message
  const errorMsg = [
    `Failed to download openshift-install for ${variantKey}.`,
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
