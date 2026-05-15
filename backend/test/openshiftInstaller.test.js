/**
 * OpenShift Installer Binary Download Tests
 *
 * Validates that openshift-install binary download URLs are accessible
 * and downloads work for all supported variants.
 *
 * Uses partial downloads (first 6 MB) to verify accessibility without
 * downloading full ~465 MB binaries.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test version - using 4.21.15 as requested by user
const TEST_VERSION = "4.21.15";
const DOWNLOAD_LIMIT_BYTES = 6 * 1024 * 1024; // 6 MB

/**
 * Run curl command and return result
 */
const runCurl = (url, outputPath, options = {}) =>
  new Promise((resolve, reject) => {
    const args = ["-fsSL"];

    // Add range for partial download if specified
    if (options.range) {
      args.push("--range", options.range);
    }

    // Add max time
    args.push("--max-time", options.timeout || "30");

    // Add URL and output
    args.push(url, "-o", outputPath);

    const child = spawn("curl", args);
    let stderr = "";

    if (child.stderr) {
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        reject(new Error(`curl failed with code ${code}: ${stderr}`));
      }
    });
  });

/**
 * Test if URL is accessible (HTTP HEAD request)
 */
const testUrlAccessible = (url) =>
  new Promise((resolve, reject) => {
    const child = spawn("curl", ["-I", "-fsSL", "--max-time", "10", url]);
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
      if (code === 0 && stdout.includes("HTTP/2 200")) {
        resolve({ accessible: true, headers: stdout });
      } else {
        reject(new Error(`URL not accessible: ${url}\nResponse: ${stdout}\nError: ${stderr}`));
      }
    });
  });

/**
 * Build URL for installer binary
 */
function getInstallerUrl(version, pathArch, fileArch, variant) {
  const base = `https://mirror.openshift.com/pub/openshift-v4/${pathArch}/clients/ocp/${version}`;

  if (variant === 'fips') {
    return `${base}/openshift-install-rhel9-${fileArch}.tar.gz`;
  } else if (variant === 'mac') {
    return `${base}/openshift-install-mac-${fileArch}.tar.gz`;
  } else {
    return `${base}/openshift-install-linux.tar.gz`; // Generic Linux
  }
}

describe("OpenShift Installer Binary URL Validation", () => {
  const tmpDir = path.join(__dirname, "..", "tmp-installer-test");

  before(async () => {
    // Create temp directory for test downloads
    await fs.promises.mkdir(tmpDir, { recursive: true });
  });

  // Test Linux FIPS RHEL 9 binaries (most important for user's use case)
  it("Linux FIPS RHEL 9 x86_64 binary URL is accessible", async () => {
    // Try both x86_64 and amd64 paths (mirror supports both)
    const urlAmd64 = getInstallerUrl(TEST_VERSION, "amd64", "amd64", "fips");
    const urlX86 = getInstallerUrl(TEST_VERSION, "x86_64", "amd64", "fips");

    console.log(`  Testing URL (amd64 path): ${urlAmd64}`);
    console.log(`  Testing URL (x86_64 path): ${urlX86}`);

    // Try amd64 path first
    try {
      await testUrlAccessible(urlAmd64);
      console.log(`  ✓ amd64 path works`);
    } catch (err) {
      // Try x86_64 path as fallback
      console.log(`  ✗ amd64 path failed, trying x86_64...`);
      await testUrlAccessible(urlX86);
      console.log(`  ✓ x86_64 path works`);
    }
  });

  it("Linux FIPS RHEL 9 x86_64 binary downloads (first 6 MB)", async () => {
    const url = getInstallerUrl(TEST_VERSION, "x86_64", "amd64", "fips");
    const outputPath = path.join(tmpDir, "fips-x86_64-partial.tar.gz");

    console.log(`  Downloading first 6 MB from: ${url}`);

    await runCurl(url, outputPath, {
      range: `0-${DOWNLOAD_LIMIT_BYTES - 1}`,
      timeout: 60
    });

    const stats = await fs.promises.stat(outputPath);
    console.log(`  Downloaded: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    assert.ok(stats.size >= 1024 * 1024, "Downloaded at least 1 MB");
    assert.ok(stats.size <= DOWNLOAD_LIMIT_BYTES, "Did not exceed 6 MB limit");

    // Cleanup
    await fs.promises.unlink(outputPath);
  });

  it("Linux FIPS RHEL 9 arm64 binary is accessible", async () => {
    const url = getInstallerUrl(TEST_VERSION, "arm64", "arm64", "fips");
    console.log(`  Testing URL: ${url}`);
    await testUrlAccessible(url);
  });

  it("Linux FIPS RHEL 9 ppc64le binary is accessible", async () => {
    const url = getInstallerUrl(TEST_VERSION, "ppc64le", "ppc64le", "fips");
    console.log(`  Testing URL: ${url}`);
    await testUrlAccessible(url);
  });

  it("Linux FIPS RHEL 9 s390x binary is accessible", async () => {
    const url = getInstallerUrl(TEST_VERSION, "s390x", "s390x", "fips");
    console.log(`  Testing URL: ${url}`);
    await testUrlAccessible(url);
  });

  // Test Linux standard binaries
  it("Linux standard binary is accessible", async () => {
    // Try both x86_64 and amd64 paths
    const urlAmd64 = getInstallerUrl(TEST_VERSION, "amd64", "amd64", "standard");
    const urlX86 = getInstallerUrl(TEST_VERSION, "x86_64", "amd64", "standard");

    console.log(`  Testing URL (amd64 path): ${urlAmd64}`);
    console.log(`  Testing URL (x86_64 path): ${urlX86}`);

    // Try amd64 path first
    try {
      await testUrlAccessible(urlAmd64);
      console.log(`  ✓ amd64 path works`);
    } catch (err) {
      // Try x86_64 path as fallback
      console.log(`  ✗ amd64 path failed, trying x86_64...`);
      await testUrlAccessible(urlX86);
      console.log(`  ✓ x86_64 path works`);
    }
  });

  it("Linux standard binary downloads (first 6 MB)", async () => {
    const url = getInstallerUrl(TEST_VERSION, "x86_64", "amd64", "standard");
    const outputPath = path.join(tmpDir, "standard-x86_64-partial.tar.gz");

    console.log(`  Downloading first 6 MB from: ${url}`);

    await runCurl(url, outputPath, {
      range: `0-${DOWNLOAD_LIMIT_BYTES - 1}`,
      timeout: 60
    });

    const stats = await fs.promises.stat(outputPath);
    console.log(`  Downloaded: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    assert.ok(stats.size >= 1024 * 1024, "Downloaded at least 1 MB");

    // Cleanup
    await fs.promises.unlink(outputPath);
  });

  // Test macOS binaries
  it("macOS arm64 binary is accessible", async () => {
    const url = getInstallerUrl(TEST_VERSION, "arm64", "arm64", "mac");
    console.log(`  Testing URL: ${url}`);
    await testUrlAccessible(url);
  });

  it("macOS generic binary is accessible (works for both Intel and ARM)", async () => {
    // macOS generic binary (no arch suffix) works for both Intel (x86_64) and ARM64
    const urlX86 = `https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/${TEST_VERSION}/openshift-install-mac.tar.gz`;
    const urlArm = `https://mirror.openshift.com/pub/openshift-v4/arm64/clients/ocp/${TEST_VERSION}/openshift-install-mac.tar.gz`;

    console.log(`  Testing URL (x86_64 path): ${urlX86}`);
    console.log(`  Testing URL (arm64 path): ${urlArm}`);

    await testUrlAccessible(urlX86);
    console.log(`  ✓ Generic mac binary works on x86_64 path`);

    await testUrlAccessible(urlArm);
    console.log(`  ✓ Generic mac binary works on arm64 path`);
  });

  it("macOS arm64 binary downloads (first 6 MB)", async () => {
    const url = getInstallerUrl(TEST_VERSION, "arm64", "arm64", "mac");
    const outputPath = path.join(tmpDir, "mac-arm64-partial.tar.gz");

    console.log(`  Downloading first 6 MB from: ${url}`);

    await runCurl(url, outputPath, {
      range: `0-${DOWNLOAD_LIMIT_BYTES - 1}`,
      timeout: 60
    });

    const stats = await fs.promises.stat(outputPath);
    console.log(`  Downloaded: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    assert.ok(stats.size >= 1024 * 1024, "Downloaded at least 1 MB");

    // Cleanup
    await fs.promises.unlink(outputPath);
  });
});

describe("OpenShift Installer URL Pattern Discovery", () => {
  it("documents correct path and filename patterns for mirror.openshift.com", () => {
    // This test documents the findings from URL validation

    const patterns = {
      pathArchitectures: {
        x86_64: "Primary path for Intel/AMD 64-bit (both x86_64 and amd64 work)",
        amd64: "Alternative path for Intel/AMD 64-bit (aliases to x86_64)",
        arm64: "ARM 64-bit / Apple Silicon",
        aarch64: "Alternative ARM 64-bit path (may alias to arm64)",
        ppc64le: "IBM PowerPC 64-bit little-endian",
        s390x: "IBM Z Systems"
      },
      filenamePatternsLinuxFips: {
        standard: "openshift-install-rhel9-{arch}.tar.gz",
        note: "Filename uses amd64/arm64/ppc64le/s390x, NOT x86_64"
      },
      filenamePatternsLinuxStandard: {
        generic: "openshift-install-linux.tar.gz (most common, works for all arch)",
        specific: "openshift-install-linux-{arch}.tar.gz (may not exist)"
      },
      filenamePatternsMac: {
        generic: "openshift-install-mac.tar.gz",
        specific: "openshift-install-mac-{arch}.tar.gz"
      },
      urlStructure: "https://mirror.openshift.com/pub/openshift-v4/{pathArch}/clients/ocp/{version}/{filename}"
    };

    console.log("  Mirror URL Patterns:", JSON.stringify(patterns, null, 2));

    assert.ok(patterns.pathArchitectures.x86_64, "x86_64 path pattern documented");
    assert.ok(patterns.filenamePatternsLinuxFips.standard, "FIPS filename pattern documented");
  });
});
