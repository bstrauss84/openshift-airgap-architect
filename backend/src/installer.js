/**
 * OpenShift Airgap Architect - OpenShift Installer Management
 *
 * Handles download, caching, and verification of openshift-install binaries
 * for multiple versions and architectures. Provides installer metadata (AMI IDs,
 * AWS regions) and installer binary stream for bundle exports.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { acquireVerifiedArtifact } from "./verifiedDownload.js";
import {
  verifyCachedBinary,
  discardUnverifiedBinary,
  writeBinaryProvenance,
  describeCacheRejection
} from "./binaryProvenance.js";

const dataDir = process.env.DATA_DIR || "/data";
const toolsDir = path.join(dataDir, "tools");
const cacheDir = path.join(dataDir, "cache");

const MIRROR_BASE = "https://mirror.openshift.com/pub/openshift-v4";
const INSTALLER_TARBALL = "openshift-install-linux.tar.gz";

/**
 * Mirror directory for the architecture THIS PROCESS RUNS ON.
 *
 * This is the execution-host axis, and it is not the target cluster architecture.
 * `getAwsRegions(version, arch)` takes a *cluster* arch used to index CoreOS
 * stream metadata; the binary that prints that metadata has to match the host
 * that executes it. Conflating the two is the two-axis error Tranche 1.5 called
 * out as a permanent lesson.
 *
 * This mattered in practice. The URL here used to be
 * `/pub/openshift-v4/clients/ocp/<version>/openshift-install-linux.tar.gz`, with
 * no architecture segment at all. That path is an alias for x86_64 — verified
 * 2026-10-16: it returns a manifest byte-identical to the x86_64 one, and the
 * four architectures publish four DIFFERENT binaries under the same file name
 * (x86_64 8398d94d…, aarch64 757f3442…, ppc64le 25de5bbe…, s390x 440b0210…).
 * So on any non-x86_64 host the backend downloaded an x86_64 binary and then
 * spawned it for `coreos print-stream-json`, which cannot execute — breaking the
 * AWS region and AMI lookups on aarch64 hosts, including Apple Silicon.
 */
function hostInstallerArchDir(nodeArch = process.arch) {
  const s = String(nodeArch || "").toLowerCase().trim();
  if (s === "x64" || s === "amd64" || s === "x86_64") return "x86_64";
  // aarch64 and arm64 are aliases on the mirror and resolve to the same digest.
  if (s === "arm64" || s === "aarch64") return "aarch64";
  if (s === "ppc64le") return "ppc64le";
  if (s === "s390x") return "s390x";
  return null;
}

/** Channel base for one version and host architecture. */
function installerChannelBase(version, archDir) {
  return `${MIRROR_BASE}/${archDir}/clients/ocp/${version}`;
}

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

/**
 * Download (or reuse) openshift-install for the execution host, verified against
 * the channel's own sha256sum.txt before anything is extracted or executed.
 *
 * Previously this fetched the tarball with `curl -fsSL` and extracted it with no
 * integrity check whatsoever, then handed the result to `getStreamMetadata`,
 * which SPAWNS it. That made every byte on the path from the mirror to a child
 * process unverified. The extraction now happens only after the digest matches.
 *
 * `fetchImpl` and `nodeArch` are injectable so the failure modes can be tested
 * hermetically; neither is used by production callers.
 */
const ensureInstaller = async (version, { fetchImpl, nodeArch = process.arch, toolsDirOverride } = {}) => {
  if (!version) {
    throw new Error("OpenShift version is required to download openshift-install.");
  }
  const archDir = hostInstallerArchDir(nodeArch);
  if (!archDir) {
    throw new Error(
      `Unsupported host architecture for openshift-install: ${nodeArch}. ` +
      `Supported: x86_64, aarch64, ppc64le, s390x.`
    );
  }
  const effectiveToolsDir = toolsDirOverride || toolsDir;
  await fs.promises.mkdir(effectiveToolsDir, { recursive: true });
  const target = toolsDirOverride
    ? path.join(effectiveToolsDir, `openshift-install-${version}`)
    : installerPathFor(version);

  const channelBase = installerChannelBase(version, archDir);
  const tarPath = path.join(effectiveToolsDir, `openshift-install-${version}-${archDir}.tar.gz`);
  const artifactUrl = `${channelBase}/${INSTALLER_TARBALL}`;
  const manifestUrl = `${channelBase}/sha256sum.txt`;

  // Identity the cached executable must prove before it is spawned.
  //
  // `arch` is the load-bearing field here. The cache path is
  // `openshift-install-<version>` with NO architecture segment, so a binary
  // extracted earlier on an x86_64 host occupies exactly the path an aarch64
  // host looks in — and the old `fs.existsSync(target)` returned it, after
  // which `getStreamMetadata` SPAWNS it. The four architectures publish four
  // different binaries under one file name, so that is an Exec format error
  // at best. The digest is recomputed below regardless; this just states what
  // the bytes are required to be.
  //
  // `tarballSha256` is left to the acquisition step, which is the only thing
  // that knows the channel's published digest. On a cache hit it is read back
  // out of the record rather than re-asserted, so a valid cache needs no
  // network — see the undefined-field skip in verifyCachedBinary.
  const identity = {
    tool: "openshift-install",
    version,
    platform: "linux",
    arch: archDir,
    variant: "standard"
  };

  const verdict = await verifyCachedBinary(target, identity);
  if (verdict.usable) {
    return target;
  }
  if (verdict.reason !== "absent") {
    // Bytes exist that cannot be proven. They are never returned, never
    // spawned and never exported; they are removed so no later call can find
    // them either.
    await discardUnverifiedBinary(target);
  }

  let provenance;
  try {
    provenance = await acquireVerifiedArtifact({
      artifactUrl,
      manifestUrl,
      fileName: INSTALLER_TARBALL,
      destPath: tarPath,
      ...(fetchImpl ? { fetchImpl } : {})
    });
  } catch (err) {
    // Fail closed, and say which of the two things went wrong. Silently
    // reusing the rejected cache here is precisely the defect being fixed, so
    // the offline case is an error with a reason, not a fallback.
    if (verdict.reason !== "absent") {
      throw new Error(
        `Cached openshift-install at ${target} was rejected because ` +
        `${describeCacheRejection(verdict.reason, verdict.detail)}, and it could not be ` +
        `re-acquired: ${err?.message || err}`
      );
    }
    throw err;
  }

  // Extract into a private directory: the tarball also carries README/LICENSE,
  // and the old code extracted straight into toolsDir alongside the cache.
  const extractDir = await fs.promises.mkdtemp(path.join(effectiveToolsDir, `install-${version}-`));
  try {
    try {
      await runCmd("tar", ["-xzf", tarPath, "-C", extractDir, "openshift-install"]);
    } catch (err) {
      throw describeExtractionFailure(err, version, effectiveToolsDir);
    }
    const extracted = path.join(extractDir, "openshift-install");
    if (!fs.existsSync(extracted)) {
      throw new Error("openshift-install binary not found after extraction.");
    }
    await fs.promises.rename(extracted, target);
    await runCmd("chmod", ["+x", target]);
    // Recorded AFTER chmod, so the digest covers the file in exactly the state
    // a later reuse will hash it in. A crash between the rename and this write
    // leaves a binary with no record, which the next call treats as
    // `no-provenance-record` and discards — the safe direction.
    await writeBinaryProvenance(target, {
      ...identity,
      tarballSha256: provenance.sha256,
      sourceUrl: artifactUrl,
      manifestUrl
    });
  } finally {
    await fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {});
  }
  return target;
};

/* A failed extraction used to surface tar's raw stderr in the UI ("tar:
   openshift-install: Wrote only 2048 of 10240 bytes"). That short write is
   what running out of space (or a disk quota) looks like. Say so, name the
   directory, and keep the original text for diagnosis. The verified tarball
   is kept, so a retry after freeing space does not re-download it. */
const OUT_OF_SPACE = /Wrote only \d+ of \d+ bytes|No space left on device|Disk quota exceeded/i;
const describeExtractionFailure = (err, version, dir) => {
  const detail = String(err?.message || err).trim();
  if (OUT_OF_SPACE.test(detail)) {
    return new Error(
      `Not enough free space to extract openshift-install ${version} into ${dir} ` +
      `(about 0.8 GB is needed). Free space or a disk quota on that volume, or use a larger ` +
      `data volume, then retry; the verified download is kept. (tar: ${detail})`
    );
  }
  return new Error(`Extracting openshift-install ${version} failed: ${detail}`);
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
  describeExtractionFailure,
  ensureInstaller,
  getStreamMetadata,
  getAwsRegions,
  getAwsAmi,
  installerPathFor,
  warmInstallerStream,
  hostInstallerArchDir,
  installerChannelBase,
  INSTALLER_TARBALL
};
