import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const dataDir = process.env.DATA_DIR || "/data";
const toolsDir = path.join(dataDir, "tools");
const cacheDir = path.join(dataDir, "cache");
const VERIFIED_INSTALLER_TARGET_ARCHES = new Set(["x86_64"]);
const VERIFIED_INSTALLER_TARGET_OS_FAMILIES = new Set(["rhel8", "rhel9"]);

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

const normalizeInstallerArch = (arch) => {
  const raw = String(arch || "x86_64").trim().toLowerCase();
  if (raw === "amd64" || raw === "x64") return "x86_64";
  if (raw === "arm64") return "aarch64";
  if (raw === "x86_64" || raw === "aarch64" || raw === "ppc64le" || raw === "s390x") return raw;
  return raw;
};

const normalizeInstallerTargetHostOsFamily = (osFamily) => {
  const raw = String(osFamily || "rhel9").trim().toLowerCase();
  if (raw === "rhel-8" || raw === "rhel_8") return "rhel8";
  if (raw === "rhel-9" || raw === "rhel_9") return "rhel9";
  return raw;
};

const installerMirrorArch = (arch) => {
  if (arch === "x86_64") return "amd64";
  if (arch === "aarch64") return "arm64";
  return arch;
};

const installerPathFor = (version, arch = "x86_64") => path.join(
  toolsDir,
  `openshift-install-${version}-${normalizeInstallerArch(arch)}`
);

const buildInstallerDownloadCandidates = (version, arch) => {
  const base = `https://mirror.openshift.com/pub/openshift-v4/clients/ocp/${version}`;
  const mirrorArch = installerMirrorArch(arch);
  if (arch === "x86_64") {
    return [
      `${base}/openshift-install-linux.tar.gz`,
      `${base}/openshift-install-linux-${mirrorArch}.tar.gz`
    ];
  }
  return [`${base}/openshift-install-linux-${mirrorArch}.tar.gz`];
};

const ensureInstaller = async (version, options = {}) => {
  if (!version) {
    throw new Error("OpenShift version is required to download openshift-install.");
  }
  const arch = normalizeInstallerArch(options.arch || "x86_64");
  const osFamily = normalizeInstallerTargetHostOsFamily(options.osFamily || "rhel9");
  const fipsRequired = Boolean(options.fipsRequired);
  if (!VERIFIED_INSTALLER_TARGET_ARCHES.has(arch)) {
    throw new Error(
      `Installer packaging for architecture "${arch}" is not verified in this release. ` +
      `Supported installer target architectures: ${Array.from(VERIFIED_INSTALLER_TARGET_ARCHES).join(", ")}.`
    );
  }
  if (!VERIFIED_INSTALLER_TARGET_OS_FAMILIES.has(osFamily)) {
    throw new Error(
      `Installer packaging for target host OS family "${osFamily}" is not verified in this release. ` +
      `Supported target host OS families: ${Array.from(VERIFIED_INSTALLER_TARGET_OS_FAMILIES).join(", ")}.`
    );
  }
  // There is no separate openshift-install payload by RHEL host family or FIPS mode;
  // these inputs are still validated and recorded for readiness/reporting.
  void fipsRequired;
  await fs.promises.mkdir(toolsDir, { recursive: true });
  const target = installerPathFor(version, arch);
  if (fs.existsSync(target)) {
    return target;
  }
  const tarPath = path.join(toolsDir, `openshift-install-${version}-${arch}.tar.gz`);
  const candidates = buildInstallerDownloadCandidates(version, arch);
  let lastError = null;
  for (const url of candidates) {
    try {
      await runCmd("curl", ["-fsSL", url, "-o", tarPath]);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    throw new Error(`Failed to download openshift-install for ${version} (${arch}): ${String(lastError?.message || lastError)}`);
  }
  await runCmd("tar", ["-xzf", tarPath, "-C", toolsDir]);
  const extracted = path.join(toolsDir, "openshift-install");
  if (!fs.existsSync(extracted)) {
    throw new Error("openshift-install binary not found after extraction.");
  }
  await fs.promises.rename(extracted, target);
  await fs.promises.unlink(tarPath).catch(() => {});
  await runCmd("chmod", ["+x", target]);
  return target;
};

/** In-flight promise per version so warm and regions/AMI requests share one download. */
const streamMetadataPromises = new Map();

const getStreamMetadata = async (version, force = false) => {
  await fs.promises.mkdir(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, `stream-${version}.json`);
  if (!force && fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  }
  if (!streamMetadataPromises.has(version) || force) {
    const promise = (async () => {
      const installer = await ensureInstaller(version);
      const { stdout } = await runCmd(installer, ["coreos", "print-stream-json"]);
      const metadata = JSON.parse(stdout);
      fs.writeFileSync(cachePath, JSON.stringify(metadata, null, 2));
      return metadata;
    })().catch((err) => {
      streamMetadataPromises.delete(version);
      throw err;
    });
    streamMetadataPromises.set(version, promise);
  }
  return streamMetadataPromises.get(version);
};

/** Start downloading installer and parsing stream metadata in the background (fire-and-forget). */
const warmInstallerStream = (version) => {
  if (!version) return;
  getStreamMetadata(version).catch(() => {});
};

/** Stream metadata may use amd64/arm64; blueprint uses x86_64/aarch64. Try both. */
const archForStream = (arch) => {
  if (arch === "x86_64") return "amd64";
  if (arch === "aarch64") return "arm64";
  return arch;
};

const getAwsRegions = async (version, arch, force = false) => {
  const metadata = await getStreamMetadata(version, force);
  const archKey = metadata?.architectures?.[arch] ? arch : archForStream(arch);
  const regions = metadata?.architectures?.[archKey]?.images?.aws?.regions || {};
  return Object.keys(regions).sort();
};

const getAwsAmi = async (version, arch, region, force = false) => {
  const metadata = await getStreamMetadata(version, force);
  const archKey = metadata?.architectures?.[arch] ? arch : archForStream(arch);
  return metadata?.architectures?.[archKey]?.images?.aws?.regions?.[region]?.image || null;
};

export {
  ensureInstaller,
  getStreamMetadata,
  getAwsRegions,
  getAwsAmi,
  installerPathFor,
  normalizeInstallerArch,
  normalizeInstallerTargetHostOsFamily,
  warmInstallerStream
};
