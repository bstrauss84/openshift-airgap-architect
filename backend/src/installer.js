import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const dataDir = process.env.DATA_DIR || "/tmp/airgap-architect-data";
const toolsDir = path.join(dataDir, "tools");
const cacheDir = path.join(dataDir, "cache");

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

const installerPathFor = (version) => path.join(toolsDir, `openshift-install-${version}`);

const ensureInstaller = async (version) => {
  if (!version) {
    throw new Error("OpenShift version is required to download openshift-install.");
  }
  await fs.promises.mkdir(toolsDir, { recursive: true });
  const target = installerPathFor(version);
  if (fs.existsSync(target)) {
    return target;
  }
  const tarPath = path.join(toolsDir, `openshift-install-${version}.tar.gz`);
  const url = `https://mirror.openshift.com/pub/openshift-v4/clients/ocp/${version}/openshift-install-linux.tar.gz`;
  await runCmd("curl", ["-fsSL", url, "-o", tarPath]);
  await runCmd("tar", ["-xzf", tarPath, "-C", toolsDir]);
  const extracted = path.join(toolsDir, "openshift-install");
  if (!fs.existsSync(extracted)) {
    throw new Error("openshift-install binary not found after extraction.");
  }
  await fs.promises.rename(extracted, target);
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

export { ensureInstaller, getStreamMetadata, getAwsRegions, getAwsAmi, installerPathFor, warmInstallerStream };
