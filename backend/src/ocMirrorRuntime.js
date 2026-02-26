/**
 * Architecture-aware oc-mirror binary resolution for Operators scan.
 * Selection is based on BACKEND CONTAINER RUNTIME ARCHITECTURE only, not Blueprint/target arch.
 * Priority: OC_MIRROR_BIN → baked-in (if passes preflight) → runtime-arch mirror → OC_MIRROR_URL/OC_CLIENT_URL → fail.
 */
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const MIRROR_BASE = "https://mirror.openshift.com/pub/openshift-v4";
const BAKED_IN_OC = "/usr/local/bin/oc";
const BAKED_IN_OC_MIRROR = "/usr/local/bin/oc-mirror";
const BAKED_IN_ARCH = "x86_64";

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

/** Get current runtime architecture (Node process.arch). */
function getRuntimeArch() {
  return normalizeRuntimeArch(process.arch);
}

/**
 * Deterministic mirror directory candidates for a normalized arch.
 * Order matters: try first candidate, then second if needed (and well-logged).
 */
function getMirrorArchCandidates(normalizedArch) {
  if (normalizedArch === "x86_64") return ["x86_64", "amd64"];
  if (normalizedArch === "aarch64") return ["aarch64", "arm64"];
  if (normalizedArch === "ppc64le" || normalizedArch === "s390x") return [normalizedArch];
  return [];
}

/** Build mirror URLs for a given arch directory name. */
function getMirrorUrls(archDir) {
  const base = `${MIRROR_BASE}/${archDir}/clients/ocp/latest`;
  return {
    oc: `${base}/openshift-client-linux.tar.gz`,
    ocMirror: `${base}/oc-mirror.tar.gz`
  };
}

/**
 * Run preflight on oc-mirror binary: exists, executable, and can run (e.g. oc-mirror version).
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
  const result = spawnSync(binPath, ["version"], {
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

/** Download a URL to a file (Node 18+ fetch). */
async function downloadToFile(url, destPath) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${url}`);
  }
  const file = createWriteStream(destPath);
  await pipeline(res.body, file);
}

/** Extract oc from openshift-client tarball into dir; returns path to oc. */
function extractOc(tarballPath, outDir) {
  execSync(`tar -xzf "${tarballPath}" -C "${outDir}" oc`, { stdio: "pipe" });
  const ocPath = path.join(outDir, "oc");
  fs.chmodSync(ocPath, 0o755);
  return ocPath;
}

/** Extract oc-mirror from tarball into dir; returns path to oc-mirror. */
function extractOcMirror(tarballPath, outDir) {
  execSync(`tar -xzf "${tarballPath}" -C "${outDir}" oc-mirror`, { stdio: "pipe" });
  const mirrorPath = path.join(outDir, "oc-mirror");
  fs.chmodSync(mirrorPath, 0o755);
  return mirrorPath;
}

/**
 * Resolve oc-mirror binary path following priority:
 * a) OC_MIRROR_BIN
 * b) Baked-in path if exists and passes preflight
 * c) Runtime-arch mirror download
 * d) OC_MIRROR_URL / OC_CLIENT_URL override
 * e) Fail with actionable message
 * Returns { path, source, arch } or { error }.
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

  if (fs.existsSync(BAKED_IN_OC_MIRROR)) {
    const preflight = runPreflight(BAKED_IN_OC_MIRROR);
    if (preflight.ok) {
      setLastResolvedArch(BAKED_IN_ARCH);
      setLastResolvedPaths(BAKED_IN_OC, BAKED_IN_OC_MIRROR);
      return { path: BAKED_IN_OC_MIRROR, source: "baked-in", arch: BAKED_IN_ARCH };
    }
  }

  const candidates = getMirrorArchCandidates(runtimeArch);
  for (const archDir of candidates) {
    const urls = getMirrorUrls(archDir);
    try {
      fs.mkdirSync(toolsDir, { recursive: true });
      const ocTgz = path.join(toolsDir, "oc-client.tar.gz");
      const mirrorTgz = path.join(toolsDir, "oc-mirror.tar.gz");
      await downloadToFile(urls.oc, ocTgz);
      await downloadToFile(urls.ocMirror, mirrorTgz);
      const extractDir = path.join(toolsDir, "bin");
      fs.mkdirSync(extractDir, { recursive: true });
      extractOc(ocTgz, extractDir);
      const mirrorPath = extractOcMirror(mirrorTgz, extractDir);
      fs.unlinkSync(ocTgz);
      fs.unlinkSync(mirrorTgz);
      const preflight = runPreflight(mirrorPath);
      if (preflight.ok) {
        setLastResolvedArch(archDir);
        setLastResolvedPaths(path.join(extractDir, "oc"), mirrorPath);
        return { path: mirrorPath, source: "mirror", arch: archDir };
      }
    } catch (e) {
      continue;
    }
  }

  const ocUrl = process.env.OC_CLIENT_URL?.trim();
  const mirrorUrl = process.env.OC_MIRROR_URL?.trim();
  if (mirrorUrl) {
    try {
      fs.mkdirSync(toolsDir, { recursive: true });
      const mirrorTgz = path.join(toolsDir, "oc-mirror-override.tar.gz");
      await downloadToFile(mirrorUrl, mirrorTgz);
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
      "No usable oc-mirror binary. The Operators scan requires a local oc-mirror that matches the backend runtime architecture. Set OC_MIRROR_BIN to a native binary path, or OC_MIRROR_URL to download one. On Apple Silicon, use a native aarch64 binary or OC_MIRROR_URL.",
    rawStderr: ""
  };
}

/**
 * Get the architecture of the currently available local binaries (for export-bundle default).
 * When baked-in is used, returns x86_64. When resolved from mirror/env, returns that arch.
 * Cached per process; call resolveOcMirrorBinary first to populate.
 */
let _lastResolvedArch = null;
let _lastOcPath = null;
let _lastOcMirrorPath = null;
function setLastResolvedArch(arch) {
  _lastResolvedArch = arch;
}
function setLastResolvedPaths(ocPath, ocMirrorPath) {
  _lastOcPath = ocPath;
  _lastOcMirrorPath = ocMirrorPath;
}
function getLocalBinaryArch() {
  if (_lastResolvedArch) return _lastResolvedArch;
  if (fs.existsSync(BAKED_IN_OC_MIRROR)) {
    const preflight = runPreflight(BAKED_IN_OC_MIRROR);
    if (preflight.ok) return BAKED_IN_ARCH;
  }
  return getRuntimeArch();
}

/** Get paths to oc and oc-mirror for the current local resolution (for export when arch matches). */
function getLocalBinaryPaths() {
  return {
    ocPath: _lastOcPath ?? (fs.existsSync(BAKED_IN_OC) ? BAKED_IN_OC : null),
    ocMirrorPath: _lastOcMirrorPath || BAKED_IN_OC_MIRROR
  };
}

/**
 * Get paths to oc and oc-mirror for the given export architecture.
 * If exportArch is null/empty or matches local, returns local paths (reuse).
 * Otherwise downloads for that arch to dataDir/tools/export-<arch> and returns those paths.
 * Returns { ocPath, ocMirrorPath } or throws.
 */
async function getBinariesForExportArch(exportArch, dataDir) {
  const localArch = getLocalBinaryArch();
  const normalizedExport = exportArch ? normalizeRuntimeArch(exportArch) || exportArch : null;
  if (!normalizedExport || normalizedExport === localArch) {
    const local = getLocalBinaryPaths();
    if (fs.existsSync(local.ocPath) && fs.existsSync(local.ocMirrorPath)) {
      return local;
    }
  }
  const toolsDir = path.join(dataDir || "/data", "tools");
  const exportDir = path.join(toolsDir, `export-${normalizedExport || localArch}`);
  const candidates = getMirrorArchCandidates(normalizedExport || localArch);
  for (const archDir of candidates) {
    const urls = getMirrorUrls(archDir);
    try {
      fs.mkdirSync(exportDir, { recursive: true });
      const ocTgz = path.join(exportDir, "oc-client.tar.gz");
      const mirrorTgz = path.join(exportDir, "oc-mirror.tar.gz");
      await downloadToFile(urls.oc, ocTgz);
      await downloadToFile(urls.ocMirror, mirrorTgz);
      const binDir = path.join(exportDir, "bin");
      fs.mkdirSync(binDir, { recursive: true });
      const ocPath = extractOc(ocTgz, binDir);
      const ocMirrorPath = extractOcMirror(mirrorTgz, binDir);
      fs.unlinkSync(ocTgz);
      fs.unlinkSync(mirrorTgz);
      return { ocPath, ocMirrorPath };
    } catch (e) {
      continue;
    }
  }
  throw new Error(`Could not fetch oc/oc-mirror for architecture ${normalizedExport || exportArch}.`);
}

export {
  getRuntimeArch,
  normalizeRuntimeArch,
  getMirrorArchCandidates,
  getMirrorUrls,
  runPreflight,
  resolveOcMirrorBinary,
  getLocalBinaryArch,
  setLastResolvedArch,
  setLastResolvedPaths,
  getLocalBinaryPaths,
  getBinariesForExportArch,
  BAKED_IN_OC,
  BAKED_IN_OC_MIRROR,
  BAKED_IN_ARCH,
  MIRROR_BASE
};
