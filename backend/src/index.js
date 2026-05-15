/**
 * OpenShift Airgap Architect - Backend API Server
 *
 * Main Express application handling state management, Cincinnati integration,
 * operator scanning, YAML generation, and export bundle creation.
 * State stored in SQLite; pull secrets never persisted to disk.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import "./configureFetchProxy.js";
import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import { fetchChannels, fetchPatchesForChannel } from "./cincinnati.js";
import { runCincinnatiBackgroundJob } from "./cincinnatiJob.js";
import { authAvailable, getCatalogs, getResults, runScanJob } from "./operators.js";
import { resolveOcMirrorBinary, getRuntimeArch, getLocalBinaryArch, getBinariesForExportArch } from "./ocMirrorRuntime.js";
import { db, dataDir } from "./db.js";
import { ensureInstaller, getAwsAmi, getAwsRegions, installerPathFor, warmInstallerStream } from "./installer.js";
import { ensureOpenshiftInstaller } from "./openshiftInstaller.js";
import {
  getState,
  setState,
  markStaleJobs,
  getJob,
  listJobs,
  listJobsByType,
  deleteCompletedJobs,
  getJobsCount,
  writeTempAuth,
  mergePullSecrets,
  safeUnlink,
  createJob,
  updateJob,
  updateJobMetadata,
  appendJobOutput
} from "./utils.js";
import { buildAgentConfig, buildFieldManual, buildImageSetConfig, buildInstallConfig, buildNtpMachineConfigs } from "./generate.js";
import { docsKey, getDocsFromCache, storeDocs, updateDocsLinks } from "./docs.js";
import { getOpenShiftMinorFromState, getOpenShiftMinorFromSources } from "./openShiftMinor.js";
import {
  validateBody,
  stateUpdateSchema,
  sshKeypairSchema,
  operatorScanSchema,
  ocMirrorPreflightSchema,
  ocMirrorRunSchema,
  pathCheckSchema,
  feedbackSubmitSchema,
  cincinnatiPatchesUpdateSchema,
} from "./schemas.js";
import {
  buildFeedbackIssueDraft,
  createChallengeToken,
  resolveFeedbackConfig,
  validateFeedbackPayload,
  verifyChallengeToken
} from "./feedback.js";
import { createInMemoryRateLimiter } from "./feedbackRateLimit.js";
import { parseOptionalClientState } from "./clientStateGuard.js";
import { ANALYSIS_TRIGGER_DEFAULTS } from "./trustAnalysis/riskConstants.js";
import {
  TrustAnalysisHashMismatchError,
  TrustSelectionHardLimitError,
  analyzeTrustState
} from "./trustAnalysis/index.js";

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Request logging middleware (skip in test mode)
if (process.env.NODE_ENV !== "test") {
  app.use((req, res, next) => {
    const requestId = req.headers["x-request-id"] || `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const startTime = Date.now();

    // Attach request ID to request for potential later use
    req.requestId = requestId;

    // Log request completion
    res.on("finish", () => {
      const duration = Date.now() - startTime;
      const logLevel = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

      // Skip logging for health/status endpoints to reduce noise
      if (req.path === "/api/health" || req.path === "/api/jobs/count") return;

      const logData = {
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: `${duration}ms`
      };

      if (logLevel === "error") {
        console.error("[request]", logData);
      } else if (logLevel === "warn") {
        console.warn("[request]", logData);
      } else {
        console.log("[request]", logData);
      }
    });

    next();
  });
}

markStaleJobs();

// Only trust X-Forwarded-For header from known proxy IPs to prevent spoofing
const TRUSTED_PROXIES = (process.env.TRUSTED_PROXIES || "").split(",").filter(Boolean);

const getClientAddress = (req) => {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    // Only trust X-Forwarded-For if request comes from a trusted proxy
    if (TRUSTED_PROXIES.length > 0 && TRUSTED_PROXIES.includes(req.ip)) {
      return fwd.split(",")[0].trim();
    }
  }
  return req.ip || "unknown";
};

let submitLimiter = null;
let submitLimiterKey = "";
let challengeLimiter = null;
let challengeLimiterKey = "";

function currentSubmitLimiter() {
  const key = [
    process.env.FEEDBACK_RATE_LIMIT_WINDOW_MS || "",
    process.env.FEEDBACK_RATE_LIMIT_MAX || "",
    process.env.FEEDBACK_BURST_WINDOW_MS || "",
    process.env.FEEDBACK_BURST_MAX || ""
  ].join("|");
  if (submitLimiter && submitLimiterKey === key) return submitLimiter;
  submitLimiterKey = key;
  submitLimiter = createInMemoryRateLimiter({
    windowMs: Number(process.env.FEEDBACK_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    max: Number(process.env.FEEDBACK_RATE_LIMIT_MAX || 5),
    burstWindowMs: Number(process.env.FEEDBACK_BURST_WINDOW_MS || 60 * 1000),
    burstMax: Number(process.env.FEEDBACK_BURST_MAX || 2),
    keyFn: getClientAddress
  });
  return submitLimiter;
}

function currentChallengeLimiter() {
  const key = [
    process.env.FEEDBACK_CHALLENGE_WINDOW_MS || "",
    process.env.FEEDBACK_CHALLENGE_MAX || ""
  ].join("|");
  if (challengeLimiter && challengeLimiterKey === key) return challengeLimiter;
  challengeLimiterKey = key;
  challengeLimiter = createInMemoryRateLimiter({
    windowMs: Number(process.env.FEEDBACK_CHALLENGE_WINDOW_MS || 60 * 1000),
    max: Number(process.env.FEEDBACK_CHALLENGE_MAX || 20),
    keyFn: getClientAddress
  });
  return challengeLimiter;
}

const warmCincinnatiCache = async () => {
  try {
    await fetchChannels(false);
  } catch (err) {
    if (process.env.DEBUG) console.error("Cincinnati cache warm failed:", err);
    // ignore warm cache errors
  }
};

warmCincinnatiCache();

const activeProcesses = new Map();
const pendingBundleStates = new Map();
const BUNDLE_STATE_TTL_MS = 10 * 60 * 1000;

const purgeExpiredBundleStates = () => {
  const now = Date.now();
  for (const [token, entry] of pendingBundleStates.entries()) {
    if (!entry || now >= entry.expiresAt) pendingBundleStates.delete(token);
  }
};

// Mounted Red Hat pull secret — detected at startup, held in memory only, never persisted.
let mountedRhPullSecret = null;

const RH_REGISTRIES = ["registry.redhat.io", "quay.io", "cloud.openshift.com", "registry.connect.redhat.com"];

/**
 * Validates a Red Hat pull secret for required registry entries.
 * @param {string} secret - Pull secret JSON string
 * @returns {{valid: boolean, error?: string}} Validation result
 */
function validateRhPullSecret(secret) {
  if (!secret || typeof secret !== "string" || secret.trim().length === 0) {
    return { valid: false, error: "Red Hat pull secret is required to pull from registry.redhat.io / quay.io." };
  }

  let parsed;
  try {
    parsed = JSON.parse(secret);
  } catch (err) {
    return { valid: false, error: "Red Hat pull secret must be valid JSON." };
  }

  if (!parsed?.auths || typeof parsed.auths !== "object") {
    return { valid: false, error: "Red Hat pull secret must contain an 'auths' object." };
  }

  const hasRhRegistry = RH_REGISTRIES.some((r) => parsed.auths[r]);
  if (!hasRhRegistry) {
    return {
      valid: false,
      error: `Red Hat pull secret must include credentials for at least one Red Hat registry: ${RH_REGISTRIES.join(", ")}.`
    };
  }

  return { valid: true };
}

function detectMountedPullSecret() {
  const candidates = [
    process.env.PULL_SECRET_FILE,
    "/run/secrets/pull-secret",
    path.join(dataDir, "pull-secret.json"),
    path.join(process.env.HOME || "/root", ".openshift", "pull-secret"),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf8").trim();
      const validation = validateRhPullSecret(raw);
      if (validation.valid) {
        mountedRhPullSecret = raw;
        console.log(`[startup] Mounted Red Hat pull secret detected at: ${p}`);
        return;
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`Pull secret check failed for ${p}:`, err);
      /* continue */
    }
  }
}
detectMountedPullSecret();

function logFeedbackStartupStatus() {
  const config = resolveFeedbackConfig();
  if (config.mode === "disabled") {
    if (config.selectedMode && config.selectedMode !== "disabled") {
      console.warn("[startup] Feedback disabled due to configuration:", {
        selectedMode: config.selectedMode,
        reason: config.reason
      });
      return;
    }
    console.log("[startup] Feedback mode disabled.");
    return;
  }
  console.log("[startup] Feedback mode enabled:", { mode: config.mode });
}
if (process.env.NODE_ENV !== "test") {
  logFeedbackStartupStatus();
}

const defaultState = () => ({
  runId: nanoid(),
  blueprint: {
    arch: "x86_64",
    platform: "Bare Metal",
    baseDomain: "example.com",
    clusterName: "airgap-cluster",
    confirmed: false,
    confirmationTimestamp: null
  },
  release: {
    channel: null,
    patchVersion: null,
    confirmed: false,
    /** When true, "Update" may advance the selected minor to the newest available. Cleared when the user picks a minor manually. */
    followLatestMinor: true
  },
  version: {
    selectedChannel: null,
    selectedVersion: null,
    selectionTimestamp: null,
    confirmedByUser: false,
    confirmationTimestamp: null,
    versionConfirmed: false
  },
  methodology: {
    method: "Agent-Based Installer"
  },
  globalStrategy: {
    fips: false,
    proxyEnabled: false,
    proxies: { httpProxy: "", httpsProxy: "", noProxy: "" },
    ntpServers: [],
    networking: {
      networkType: "OVNKubernetes",
      machineNetworkV4: "10.90.0.0/24",
      machineNetworkV6: "",
      clusterNetworkCidr: "10.128.0.0/14",
      clusterNetworkHostPrefix: 23,
      serviceNetworkCidr: "172.30.0.0/16"
    },
    mirroring: {
      registryFqdn: "registry.local:5000",
      sources: [
        { source: "quay.io/openshift-release-dev/ocp-release", mirrors: ["registry.local:5000/ocp-release"] },
        { source: "quay.io/openshift-release-dev/ocp-v4.0-art-dev", mirrors: ["registry.local:5000/ocp-v4.0-art-dev"] }
      ]
    }
  },
  platformConfig: {
    publish: "External",
    credentialsMode: "",
    aws: {
      region: "",
      subnets: "",
      hostedZone: "",
      hostedZoneRole: "",
      lbType: "",
      amiId: "",
      controlPlaneInstanceType: "",
      workerInstanceType: ""
    },
    vsphere: {
      vcenter: "",
      username: "",
      password: "",
      datacenter: "",
      cluster: "",
      datastore: "",
      network: "",
      folder: "",
      resourcePool: ""
    },
    nutanix: {
      endpoint: "",
      port: "9440",
      username: "",
      password: "",
      cluster: "",
      subnet: "",
      apiVIP: "",
      ingressVIP: "",
      apiVIPV6: "",
      ingressVIPV6: ""
    },
    azure: {
      cloudName: "AzureUSGovernmentCloud",
      region: "",
      resourceGroupName: "",
      baseDomainResourceGroupName: ""
    },
    ibmcloud: {
      vpcMode: "existing-vpc",
      region: "",
      resourceGroupName: "",
      networkResourceGroupName: "",
      vpcName: "",
      controlPlaneSubnets: "",
      computeSubnets: "",
      serviceEndpoints: "",
      type: "",
      dedicatedHostsProfile: "",
      dedicatedHostsName: "",
      defaultMachineBootVolumeEncryptionKey: "",
      controlPlaneBootVolumeEncryptionKey: "",
      computeBootVolumeEncryptionKey: ""
    }
  },
  hostInventory: {
    apiVip: "",
    ingressVip: "",
    provisioningNetwork: "Managed",
    schemaVersion: 2,
    enableIpv6: false,
    nodes: [],
    bootArtifactsBaseURL: ""
  },
  operators: {
    selected: [],
    catalogs: {
      redhat: [],
      certified: [],
      community: []
    },
    stale: false,
    scenarios: {},
    scenarioAdded: {},
    fastMode: false
  },
  reviewFlags: {
    methodology: false,
    global: false,
    inventory: false,
    operators: false,
    review: false
  },
  credentials: {
    sshPublicKey: "",
    pullSecretPlaceholder: "{\"auths\":{}}",
    redHatPullSecretConfigured: false,
    mirrorRegistryCredentialsConfigured: false,
    mirrorRegistryPullSecret: "",
    mirrorRegistryUnauthenticated: false
  },
  trust: {
    mirrorRegistryUsesPrivateCa: false,
    mirrorRegistryCaPem: "",
    proxyCaPem: "",
    additionalTrustBundlePolicy: "",
    bundleSelectionMode: "original",
    reducedSelection: null
  },
  docs: {
    connectivity: "fully-disconnected",
    links: []
  },
  imagesetConfig: {
    graph: true,
    additionalImages: "",
    archiveSize: ""
  },
  exportOptions: {
    includeCredentials: false,
    includeCertificates: true,
    includeClientTools: false,
    includeInstaller: false,
    installerUseFips: false,        // Use FIPS RHEL 9 variant for openshift-install
    installerPlatformArch: "",       // Platform+arch for openshift-install ("" = default)
    exportBinaryArch: null,
    draftMode: false
  },
  mirrorWorkflow: {
    outputPath: path.join(dataDir, "oc-mirror-output"),
    archivePath: path.join(dataDir, "oc-mirror", "archives"),
    workspacePath: path.join(dataDir, "oc-mirror", "workspace"),
    cachePath: path.join(dataDir, "oc-mirror", "cache"),
    includeInExport: false,
    mode: "mirrorToDisk",
    configSourceType: "generated",
    configPath: "",
    registryUrl: "",
    dryRun: false,
    logLevel: "info",
    parallelImages: 4,
    parallelLayers: 5,
    imageTimeout: "10m",
    retryTimes: 2,
    retryDelay: "1s",
    since: "",
    strictArchive: false,
    lastRunJobId: null
  },
  ui: {
    activeStepId: "blueprint",
    visitedSteps: {},
    completedSteps: {},
    segmentedFlowV1: true
  }
});

const ensureState = () => {
  const existing = getState();
  if (existing) {
    let changed = false;
    const next = { ...existing };
    next.trust = { ...(existing.trust || {}) };
    if (!Object.prototype.hasOwnProperty.call(next.trust, "bundleSelectionMode")) {
      next.trust.bundleSelectionMode = "original";
      changed = true;
    }
    if (!Object.prototype.hasOwnProperty.call(next.trust, "reducedSelection")) {
      next.trust.reducedSelection = null;
      changed = true;
    }
    if (changed) {
      setState(next);
      return next;
    }
    return existing;
  }
  const initial = defaultState();
  setState(initial);
  return initial;
};

const updateState = (patch) => {
  const current = ensureState();
  // Deep merge patch into current state to preserve nested fields
  const merged = deepMerge(current, patch);
  setState(merged);
  return merged;
};

/** Merge-aware: fills canonical minor in release.channel when null/empty or legacy stable-* (avoids vnull operator catalogs). */
function applyReleaseChannelNormalization(patch) {
  if (!patch?.release || typeof patch.release !== "object") return;
  const current = getState();
  if (!current) return;
  const curRel = current.release || {};
  const curVer = current.version || {};
  const effective = { ...curRel, ...patch.release };
  const effVer = patch.version && typeof patch.version === "object" ? { ...curVer, ...patch.version } : curVer;
  const minor = getOpenShiftMinorFromSources(effective, effVer);
  if (!minor) return;
  const ch = effective.channel;
  const needs =
    ch === null ||
    ch === undefined ||
    ch === "" ||
    (typeof ch === "string" && /^stable-/i.test(String(ch).trim()));
  if (needs) {
    patch.release = { ...patch.release, channel: minor };
  }
}

// Deep merge helper for state updates - preserves nested object fields
function deepMerge(target, source) {
  const output = { ...target };

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          output[key] = source[key];
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        output[key] = source[key];
      }
    });
  }

  return output;
}

function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

const sanitizeStateForExport = (state, options = {}) => {
  const includeCredentials = Boolean(options.includeCredentials);
  const includeCertificates = options.includeCertificates !== false;
  const next = JSON.parse(JSON.stringify(state));
  if (next?.blueprint && "blueprintPullSecretEphemeral" in next.blueprint) {
    delete next.blueprint.blueprintPullSecretEphemeral;
  }
  if (!includeCredentials && next.credentials) {
    next.credentials.pullSecretPlaceholder = "{\"auths\":{}}";
    next.credentials.redHatPullSecretConfigured = false;
    next.credentials.mirrorRegistryCredentialsConfigured = false;
    next.credentials.mirrorRegistryPullSecret = "";
  }
  if (!includeCertificates && next.trust) {
    next.trust.mirrorRegistryCaPem = "";
    next.trust.proxyCaPem = "";
    next.trust.additionalTrustBundlePolicy = "";
    next.trust.bundleSelectionMode = "original";
    next.trust.reducedSelection = null;
  }
  if (includeCredentials && next.credentials?.mirrorRegistryPullSecret) {
    next.credentials.mirrorRegistryPullSecret = normalizePullSecret(next.credentials.mirrorRegistryPullSecret);
  }
  return next;
};

const trustAnalysisCache = new Map();
const TRUST_ANALYSIS_CACHE_TTL_MS = 30 * 60 * 1000;
const TRUST_ANALYSIS_CACHE_MAX = 128;

const getCachedTrustAnalysis = (state) => {
  const analysis = analyzeTrustState(state);
  const selection = state?.trust?.bundleSelectionMode === "reduced"
    ? JSON.stringify(state?.trust?.reducedSelection?.selectedCertFingerprints || [])
    : "original";
  const key = `${analysis.analysisHash}:${state?.trust?.bundleSelectionMode || "original"}:${selection}`;
  const now = Date.now();
  const cached = trustAnalysisCache.get(key);
  if (cached && now - cached.timestamp <= TRUST_ANALYSIS_CACHE_TTL_MS) {
    return cached.value;
  }
  trustAnalysisCache.set(key, { timestamp: now, value: analysis });
  if (trustAnalysisCache.size > TRUST_ANALYSIS_CACHE_MAX) {
    const oldest = Array.from(trustAnalysisCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, trustAnalysisCache.size - TRUST_ANALYSIS_CACHE_MAX);
    for (const [oldKey] of oldest) trustAnalysisCache.delete(oldKey);
  }
  return analysis;
};

const normalizePullSecret = (input) => {
  if (!input) return null;
  const raw = typeof input === "string" ? input : JSON.stringify(input);
  const parsed = JSON.parse(raw);
  if (parsed.auths) return JSON.stringify(parsed);
  return JSON.stringify({ auths: parsed });
};

const runDf = (targetPath) => new Promise((resolve, reject) => {
  const child = spawn("df", ["-Pk", targetPath]);
  let stdout = "";
  let stderr = "";
  let resolved = false;

  // Set timeout for df command (10 seconds should be plenty)
  const timeout = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      child.kill("SIGTERM");
      reject(new Error("df command timed out after 10 seconds"));
    }
  }, 10000);

  child.stdout.on("data", (data) => { stdout += data.toString(); });
  child.stderr.on("data", (data) => { stderr += data.toString(); });

  child.on("error", (error) => {
    if (!resolved) {
      resolved = true;
      clearTimeout(timeout);
      if (error?.code === "ENOENT") {
        return reject(new Error("df command is not available in the backend image."));
      }
      return reject(error);
    }
  });

  child.on("close", (code, signal) => {
    if (resolved) return; // Already handled
    resolved = true;
    clearTimeout(timeout);

    if (signal) {
      return reject(new Error(`df killed by signal ${signal}`));
    }

    if (code !== 0) return reject(new Error(stderr || stdout || "df failed"));
    resolve(stdout);
  });
});

const checkPath = async (targetPath) => {
  const resolved = path.resolve(targetPath);
  const exists = fs.existsSync(resolved);
  const stats = exists ? fs.statSync(resolved) : null;
  const parent = exists ? resolved : path.dirname(resolved);
  let writable = false;
  try {
    fs.accessSync(parent, fs.constants.W_OK);
    writable = true;
  } catch (err) {
    if (process.env.DEBUG) console.error(`Write access check failed for ${parent}:`, err);
    writable = false;
  }
  const output = await runDf(parent);
  const lines = output.trim().split("\n");
  const parts = lines[1]?.trim().split(/\s+/) || [];
  const totalKb = Number(parts[1] || 0);
  const availKb = Number(parts[3] || 0);
  return {
    path: resolved,
    exists,
    type: stats ? (stats.isDirectory() ? "directory" : "file") : "missing",
    writable,
    totalBytes: totalKb * 1024,
    freeBytes: availKb * 1024
  };
};

const generateSshKeypair = (algorithm = "ed25519") => new Promise((resolve, reject) => {
  const validAlgorithms = ['ed25519', 'rsa', 'ecdsa'];
  const alg = String(algorithm || "ed25519").toLowerCase();
  if (!validAlgorithms.includes(alg)) {
    return reject(new Error(`Invalid algorithm: ${alg}. Supported: ${validAlgorithms.join(', ')}`));
  }
  const tmpDir = path.join(dataDir, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const keyPath = path.join(tmpDir, `airgap-key-${nanoid()}`);
  const args = ["-N", "", "-f", keyPath];
  if (alg === "rsa") {
    args.unshift("-b", "4096", "-t", "rsa");
  } else if (alg === "ecdsa") {
    args.unshift("-b", "521", "-t", "ecdsa");
  } else {
    args.unshift("-t", "ed25519");
  }

  const child = spawn("ssh-keygen", args);
  let stderr = "";
  let resolved = false;

  // Set timeout for ssh-keygen (30 seconds)
  const timeout = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      child.kill("SIGTERM");
      safeUnlink(keyPath);
      safeUnlink(`${keyPath}.pub`);
      reject(new Error("ssh-keygen timed out after 30 seconds"));
    }
  }, 30000);

  child.stderr.on("data", (data) => { stderr += data.toString(); });

  child.on("error", (err) => {
    if (!resolved) {
      resolved = true;
      clearTimeout(timeout);
      safeUnlink(keyPath);
      safeUnlink(`${keyPath}.pub`);
      reject(err);
    }
  });

  child.on("close", (code, signal) => {
    if (resolved) return; // Already handled by timeout or error
    resolved = true;
    clearTimeout(timeout);

    if (signal) {
      safeUnlink(keyPath);
      safeUnlink(`${keyPath}.pub`);
      return reject(new Error(`ssh-keygen killed by signal ${signal}`));
    }

    if (code !== 0) {
      safeUnlink(keyPath);
      safeUnlink(`${keyPath}.pub`);
      return reject(new Error(stderr || "ssh-keygen failed"));
    }

    try {
      const privateKey = fs.readFileSync(keyPath, "utf8");
      const publicKey = fs.readFileSync(`${keyPath}.pub`, "utf8").trim();
      safeUnlink(keyPath);
      safeUnlink(`${keyPath}.pub`);
      resolve({ publicKey, privateKey });
    } catch (error) {
      safeUnlink(keyPath);
      safeUnlink(`${keyPath}.pub`);
      reject(error);
    }
  });
});

const dbPrepareMockStore = (version, catalogId, results) => {
  db.prepare(
    "INSERT INTO operator_results (version, catalog, results_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(version, catalog) DO UPDATE SET results_json = excluded.results_json, updated_at = excluded.updated_at"
  ).run(version, catalogId, JSON.stringify(results), Date.now());
};

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Readiness: DB must be readable (and writable at startup). Use for smoke checks after container start.
app.get("/api/ready", (req, res) => {
  try {
    getState();
    res.json({ ready: true });
  } catch (err) {
    res.status(503).json({ ready: false, error: String(err?.message || err) });
  }
});

// Build info: env-driven; no git at runtime. For APP_GIT_SHA/APP_BUILD_TIME see README and scripts.
app.get("/api/build-info", (_req, res) => {
  const gitSha = (process.env.APP_GIT_SHA || "unknown").trim();
  const buildTime = (process.env.APP_BUILD_TIME || "unknown").trim();
  const repo = (process.env.APP_REPO || "bstrauss84/openshift-airgap-architect").trim();
  const branch = (process.env.APP_BRANCH || "main").trim();
  res.json({ gitSha, buildTime, repo, branch });
});

app.get("/api/feedback/config", (_req, res) => {
  const config = resolveFeedbackConfig();
  res.json({
    enabled: config.enabled,
    visible: config.visible,
    mode: config.mode,
    reason: config.reason,
    challengeRequired: config.enabled,
    minDwellMs: config.minDwellMs,
    limits: config.limits,
    enums: config.enums,
    githubRepo: config.githubRepo || ""
  });
});

app.get("/api/feedback/challenge", (req, res, next) => currentChallengeLimiter()(req, res, next), (_req, res) => {
  const config = resolveFeedbackConfig();
  if (!config.enabled) {
    return res.status(403).json({ error: config.reason || "Feedback is unavailable." });
  }
  const challenge = createChallengeToken(config);
  return res.json({
    token: challenge.token,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    minDwellMs: config.minDwellMs
  });
});

app.post("/api/feedback/submit", (req, res, next) => currentSubmitLimiter()(req, res, next), async (req, res) => {
  const config = resolveFeedbackConfig();
  if (!config.enabled) {
    return res.status(403).json({ error: config.reason || "Feedback is unavailable." });
  }
  const parsed = validateFeedbackPayload(req.body, config);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }
  const challengeResult = verifyChallengeToken(parsed.challengeToken, config);
  if (!challengeResult.ok) {
    return res.status(400).json({ error: challengeResult.error });
  }

  const build = {
    gitSha: (process.env.APP_GIT_SHA || "unknown").trim(),
    buildTime: (process.env.APP_BUILD_TIME || "unknown").trim(),
    branch: (process.env.APP_BRANCH || "main").trim()
  };
  const submissionId = nanoid();
  const submission = {
    schemaVersion: 1,
    submissionId,
    receivedAt: new Date().toISOString(),
    build,
    mode: config.mode,
    payload: parsed.payload
  };

  const issueDraft = buildFeedbackIssueDraft({ submission, config });
  const handoff = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    issueDraft,
    payload: submission
  };
  // Keep logs metadata-only and never include feedback text.
  if (process.env.NODE_ENV !== "test") {
    console.log("Feedback accepted", {
      submissionId,
      mode: config.mode,
      githubIssueUrlReady: Boolean(issueDraft.githubIssueUrl)
    });
  }
  return res.json({
    ok: true,
    submissionId,
    mode: config.mode,
    githubIssueUrl: issueDraft.githubIssueUrl || "",
    issueDraft,
    handoff
  });
});

// Update check: GitHub latest commit vs APP_GIT_SHA. CHECK_UPDATES=false|0 disables. Cache: success 6h, failure 15min.
const CHECK_UPDATES_DEFAULT = true;
const UPDATE_CACHE_SUCCESS_MS = 6 * 60 * 60 * 1000;
const UPDATE_CACHE_FAILURE_MS = 15 * 60 * 1000;
const GITHUB_TIMEOUT_MS = 2000;

let updateInfoCache = null;

async function fetchUpdateInfo() {
  const repo = (process.env.APP_REPO || "bstrauss84/openshift-airgap-architect").trim();
  const branch = (process.env.APP_BRANCH || "main").trim();
  const currentSha = (process.env.APP_GIT_SHA || "").trim();
  const enabled = process.env.CHECK_UPDATES;
  const disabled = enabled === "false" || enabled === "0";
  if (disabled) {
    return {
      enabled: false,
      currentSha: currentSha || "unknown",
      latestSha: null,
      isOutdated: false,
      checkedAt: new Date().toISOString(),
      error: null,
      branch,
      repo
    };
  }
  const checkedAt = new Date().toISOString();
  const currentUnknown = !currentSha || String(currentSha).toLowerCase() === "unknown";
  if (currentUnknown) {
    return {
      enabled: true,
      currentSha: currentSha || "unknown",
      latestSha: null,
      isOutdated: false,
      checkedAt,
      error: !currentSha ? "APP_GIT_SHA not set" : "Build SHA unknown; cannot determine if update available",
      branch,
      repo
    };
  }
  const url = `https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github.v3+json" }
    });
    clearTimeout(timeoutId);
    if (!resp.ok) {
      const body = await resp.text();
      return {
        enabled: true,
        currentSha,
        latestSha: null,
        isOutdated: false,
        checkedAt,
        error: `GitHub API ${resp.status}: ${body.slice(0, 80)}`,
        branch,
        repo
      };
    }
    const data = await resp.json();
    const latestSha = Array.isArray(data) && data[0]?.sha ? String(data[0].sha) : null;
    const short = (s) => (s && s.length >= 7 ? s.slice(0, 7) : (s || ""));
    const latestUnknown = !latestSha || String(latestSha).toLowerCase() === "unknown";
    const isOutdated = !latestUnknown && latestSha && short(latestSha) !== short(currentSha);
    return {
      enabled: true,
      currentSha,
      latestSha,
      isOutdated: Boolean(isOutdated),
      checkedAt,
      error: null,
      branch,
      repo
    };
  } catch (e) {
    clearTimeout(timeoutId);
    const message = e.name === "AbortError" ? "Request timed out" : (e.message || "Request failed");
    return {
      enabled: true,
      currentSha,
      latestSha: null,
      isOutdated: false,
      checkedAt,
      error: message,
      branch,
      repo
    };
  }
}

app.get("/api/update-info", async (_req, res) => {
  const now = Date.now();
  if (updateInfoCache) {
    const { result, cachedAt, isSuccess } = updateInfoCache;
    const ttl = isSuccess ? UPDATE_CACHE_SUCCESS_MS : UPDATE_CACHE_FAILURE_MS;
    if (now - cachedAt < ttl) {
      return res.json(result);
    }
  }
  const result = await fetchUpdateInfo();
  const isSuccess = result.enabled && !result.error && result.latestSha != null;
  updateInfoCache = { result, cachedAt: now, isSuccess };
  res.json(result);
});

const defaultStepMap = {
  version: "1",
  mvpSteps: [
    { stepNumber: 0, id: "start", label: "Start", description: "Choose a path to get started", subSteps: [], requiredOutputs: [] },
    { stepNumber: 1, id: "blueprint", label: "Blueprint", description: "Platform, architecture, install family, connectivity", subSteps: [], requiredOutputs: [], locks: ["release", "platform", "installFamily", "connectivity"] },
    { stepNumber: 2, id: "methodology", label: "Methodology", description: "Choose install method (Help me choose)", subSteps: [], requiredOutputs: [], dependsOnLock: true },
    { stepNumber: 3, id: "global", label: "Global Strategy", description: "Cluster identity, network-wide, VIPs, DHCP vs Static, advanced", subSteps: [{ id: "network-wide", label: "Network-wide" }, { id: "vips-ingress", label: "VIPs and ingress" }, { id: "dhcp-static", label: "DHCP vs Static plan" }, { id: "advanced-networking", label: "Advanced networking", collapsedByDefault: true }], requiredOutputs: [] },
    { stepNumber: 4, id: "inventory", label: "Host Inventory", description: "Hosts, VIPs, BMC (Bare Metal Agent/IPI only)", subSteps: [], requiredOutputs: [] },
    { stepNumber: 5, id: "operators", label: "Operators", description: "Operator catalog and selections", subSteps: [], requiredOutputs: [] },
    { stepNumber: 6, id: "review", label: "Assets & Guide", description: "Canonical YAML output and export", subSteps: [], requiredOutputs: ["install-config.yaml", "agent-config.yaml"] },
    { stepNumber: 7, id: "run-oc-mirror", label: "Run oc-mirror", description: "Run oc-mirror now (coming soon)", subSteps: [], requiredOutputs: [] },
    { stepNumber: 8, id: "operations", label: "Operations", description: "Jobs, oc-mirror, docs update", subSteps: [], requiredOutputs: [] }
  ],
  outOfScopePlaceholders: [{ id: "hosts", label: "Hosts", reason: "Planned in a later release" }, { id: "storage", label: "Storage", reason: "Planned in a later release" }, { id: "discovery-iso", label: "Discovery ISO", reason: "Planned in a later release" }]
};
function findStepMapPath() {
  const candidates = [
    path.join(process.cwd(), "schema", "stepMap.json"),
    path.join(process.cwd(), "..", "schema", "stepMap.json")
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}
app.get("/api/schema/stepMap", (req, res) => {
  const file = findStepMapPath();
  if (file) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return res.json(data);
    } catch (err) {
      return res.status(500).json({ error: "stepMap invalid" });
    }
  }
  res.json(defaultStepMap);
});

app.get("/api/state", (req, res) => {
  // Security: Never expose credentials via GET endpoint
  const state = ensureState();
  const sanitized = sanitizeStateForExport(state, { includeCredentials: false });
  res.json(sanitized);
});

app.post("/api/state", validateBody(stateUpdateSchema), (req, res) => {
  const patch = req.body || {};
  applyReleaseChannelNormalization(patch);

  // CRITICAL VALIDATION: Prevent state corruption where release is confirmed without channel
  // Only validate if BOTH confirmed=true AND channel is explicitly null in the patch
  if (patch?.release?.confirmed === true && "channel" in patch.release) {
    if (patch.release.channel === null || patch.release.channel === undefined || patch.release.channel === "") {
      return res.status(400).json({
        error: "Validation failed",
        details: [{
          path: "release.channel",
          message: "Release cannot be confirmed without a channel. Select a version first."
        }]
      });
    }
  }

  // CRITICAL VALIDATION: Prevent version confirmation without selectedVersion
  // Only validate if confirmed AND selectedVersion is explicitly null in the patch
  if ((patch?.version?.versionConfirmed === true || patch?.version?.confirmedByUser === true) && "selectedVersion" in patch.version) {
    if (patch.version.selectedVersion === null || patch.version.selectedVersion === undefined || patch.version.selectedVersion === "") {
      return res.status(400).json({
        error: "Validation failed",
        details: [{
          path: "version.selectedVersion",
          message: "Version cannot be confirmed without selecting a version. Select a version first."
        }]
      });
    }
  }

  // Security: Defense in depth - reject state updates that include credentials
  // Frontend should have stripped these, but validate server-side to prevent compromised client
  if (patch?.credentials?.pullSecretPlaceholder ||
      patch?.credentials?.mirrorRegistryPullSecret ||
      patch?.blueprint?.blueprintPullSecretEphemeral) {
    return res.status(400).json({
      error: "Credentials should not be included in state POST. Frontend must strip sensitive data before sending."
    });
  }

  // Remove ephemeral fields that should never be persisted
  if (patch?.blueprint && "blueprintPullSecretEphemeral" in patch.blueprint) {
    const nextBlueprint = { ...patch.blueprint };
    delete nextBlueprint.blueprintPullSecretEphemeral;
    patch.blueprint = nextBlueprint;
  }
  if (patch?.credentials) {
    const nextCreds = { ...patch.credentials };
    delete nextCreds.pullSecretPlaceholder;
    delete nextCreds.mirrorRegistryPullSecret;
    patch.credentials = nextCreds;
  }
  const merged = updateState(patch);
  res.json(merged);
});

// Mounted Red Hat pull secret endpoints
app.get("/api/secrets/rh-pull-secret", (req, res) => {
  res.json({ available: Boolean(mountedRhPullSecret) });
});

app.get("/api/secrets/rh-pull-secret/content", (req, res) => {
  if (!mountedRhPullSecret) return res.status(404).json({ error: "No mounted pull secret." });
  res.json({ pullSecret: mountedRhPullSecret });
});

app.post("/api/start-over", (req, res) => {
  const cancelRunningOcMirror = req.body?.cancelRunningOcMirror !== false;
  if (cancelRunningOcMirror) {
    const runningOcMirrorJobs = listJobsByType("oc-mirror-run").filter((job) => job.status === "running");
    for (const job of runningOcMirrorJobs) {
      const proc = activeProcesses.get(job.id);
      if (proc) {
        try {
          proc.kill("SIGTERM");
        } catch (err) {
          if (process.env.DEBUG) console.error(`Failed to kill process ${job.id}:`, err);
          // Best-effort cancellation; mark cancelled either way.
        }
      }
      activeProcesses.delete(job.id);
      updateJob(job.id, {
        status: "cancelled",
        message: "Cancelled by Start Over.",
        progress: 0
      });
    }
  }
  const next = defaultState();
  next.reviewFlags = {
    methodology: false,
    global: false,
    inventory: false,
    operators: false,
    review: false
  };
  next.ui = {
    ...(next.ui || {}),
    activeStepId: "blueprint",
    visitedSteps: {}
  };
  setState(next);
  const tmpDir = path.join(process.env.DATA_DIR || "/data", "tmp");
  if (fs.existsSync(tmpDir)) {
    fs.readdirSync(tmpDir).forEach((file) => {
      const fullPath = path.join(tmpDir, file);
      try {
        const realPath = fs.realpathSync(fullPath); // Resolve symlinks
        if (realPath.startsWith(tmpDir)) { // Ensure within tmpDir
          safeUnlink(realPath);
        } else if (process.env.DEBUG) {
          console.error(`Skipping file outside tmpDir: ${realPath}`);
        }
      } catch (err) {
        if (process.env.DEBUG) console.error(`Failed to clean temp file ${fullPath}:`, err);
      }
    });
  }
  res.json(next);
});

app.get("/api/run/export", (req, res) => {
  const state = ensureState();
  const options = state.exportOptions || {};
  const sanitized = sanitizeStateForExport(state, { ...options, includeCredentials: false });
  if (process.env.NODE_ENV !== "test") {
    console.log("Run exported", { runId: state.runId });
  }
  res.json({
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    runId: state.runId,
    state: sanitized
  });
});

app.post("/api/run/import", (req, res) => {
  const payload = req.body || {};
  const schemaVersion = payload.schemaVersion || 1;
  if (!payload.state || typeof payload.state !== "object") {
    return res.status(400).json({ error: "Invalid run bundle: missing state." });
  }
  if (schemaVersion > 2) {
    return res.status(400).json({ error: `Unsupported run bundle schemaVersion ${schemaVersion}.` });
  }

  // Security: Validate imported state structure against schema
  // Prevents injection of malicious nested objects or invalid data types
  try {
    stateUpdateSchema.parse(payload.state);
  } catch (err) {
    return res.status(400).json({
      error: "Invalid state structure in imported run bundle",
      details: err.errors || String(err)
    });
  }

  const migrated = schemaVersion === 1
    ? { ...defaultState(), ...payload.state, exportOptions: payload.state.exportOptions || defaultState().exportOptions }
    : payload.state;
  if (!migrated.runId) migrated.runId = nanoid();
  if (!migrated.exportOptions) migrated.exportOptions = defaultState().exportOptions;
  if (migrated.operators) {
    const expectedVersion = getOpenShiftMinorFromState(migrated) || migrated.release?.channel || null;
    if (migrated.operators.version && migrated.operators.version !== expectedVersion) {
      migrated.operators.stale = true;
    }
  }
  const sanitized = sanitizeStateForExport(migrated, { ...(migrated.exportOptions || {}), includeCredentials: false });
  setState(sanitized);
  res.json({ ok: true, state: sanitized });
});

app.post("/api/run/duplicate", (req, res) => {
  const state = ensureState();
  const clone = JSON.parse(JSON.stringify(state));
  clone.runId = nanoid();
  setState(clone);
  res.json({ ok: true, state: clone });
});

app.get("/api/cincinnati/channels", async (req, res) => {
  try {
    const channels = await fetchChannels(false);
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/cincinnati/update", async (req, res) => {
  try {
    const channels = await fetchChannels(true);
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/cincinnati/patches", async (req, res) => {
  try {
    const channel = req.query.channel;
    const versions = await fetchPatchesForChannel(channel, false);
    res.json({ versions });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/cincinnati/patches/update", validateBody(cincinnatiPatchesUpdateSchema), async (req, res) => {
  try {
    const channel = req.body.channel;
    const versions = await fetchPatchesForChannel(channel, true);
    res.json({ versions });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** Async Cincinnati refresh for Operations visibility; Blueprint Update uses this + poll. */
app.post("/api/cincinnati/refresh-job", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const preferredChannel =
    typeof body.preferredChannel === "string" && body.preferredChannel.trim()
      ? body.preferredChannel.trim()
      : typeof body.channel === "string" && body.channel.trim()
        ? body.channel.trim()
        : null;
  const jobId = createJob("cincinnati-refresh", "Refreshing Cincinnati channels and patch list…");
  updateJob(jobId, { status: "running", progress: 5 });
  res.status(202).json({ jobId });
  setImmediate(() => {
    runCincinnatiBackgroundJob(jobId, { preferredChannel }).catch((err) => {
      appendJobOutput(jobId, `\nUnhandled: ${String(err?.message || err)}\n`);
      updateJob(jobId, { status: "failed", progress: 100, message: String(err?.message || err) });
    });
  });
});

app.get("/api/operators/credentials", (req, res) => {
  res.json({ available: authAvailable() });
});

app.post("/api/operators/confirm", (req, res) => {
  const state = ensureState();
  const release = { ...state.release, confirmed: true };
  const version = {
    selectedChannel: state.release?.channel ? `stable-${state.release.channel}` : null,
    selectedVersion: state.release?.patchVersion || null,
    selectionTimestamp: state.version?.selectionTimestamp || Date.now(),
    confirmedByUser: true,
    confirmationTimestamp: Date.now(),
    versionConfirmed: true
  };
  updateState({ release, version });
  res.json({ ok: true, release, version });
});

app.post("/api/operators/scan", validateBody(operatorScanSchema), async (req, res) => {
  // Do not log req.body; it may contain pullSecret. Do not persist pullSecret.
  const state = ensureState();
  if (!state.release?.confirmed) {
    return res.status(400).json({ error: "Version not confirmed." });
  }
  if (!authAvailable() && !req.body?.pullSecret && String(process.env.MOCK_MODE).toLowerCase() !== "true") {
    return res.status(400).json({ error: "Registry auth not configured." });
  }
  if (String(process.env.MOCK_MODE).toLowerCase() === "true") {
    const catalogMinor = getOpenShiftMinorFromState(state);
    const jobs = {};
    for (const catalog of getCatalogs()) {
      const jobId = createJob("operator-scan", `Mock scan ${catalog.id}`);
      const file = path.join(process.cwd(), "mock-data", `operators-${catalog.id}-${catalogMinor || "unknown"}.json`);
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        dbPrepareMockStore(catalogMinor || "unknown", catalog.id, data.results);
      }
      updateJob(jobId, { status: "completed", progress: 100, message: "Mock data loaded." });
      jobs[catalog.id] = jobId;
    }
    return res.json({ jobs });
  }
  let tempAuthFile = null;
  if (req.body?.pullSecret) {
    const normalized = normalizePullSecret(req.body.pullSecret);
    tempAuthFile = writeTempAuth(normalized);
  }
  const catalogMinor = getOpenShiftMinorFromState(state);
  if (!catalogMinor) {
    if (tempAuthFile) safeUnlink(tempAuthFile);
    return res.status(400).json({
      error: "OpenShift release minor is not set. Select minor channel and patch in Blueprint (or ensure patchVersion is set)."
    });
  }

  if (process.env.NODE_ENV !== "test") {
    console.log("[operator-scan:start]", {
      requestId: req.requestId,
      version: catalogMinor,
      catalogCount: getCatalogs().length,
      authMethod: tempAuthFile ? "pull-secret" : "mounted"
    });
  }

  const resolved = await resolveOcMirrorBinary(dataDir);
  const jobs = {};
  if (resolved.error) {
    for (const catalog of getCatalogs()) {
      const jobId = createJob("operator-scan", `Scanning ${catalog.id} operators...`);
      updateJob(jobId, {
        status: "failed",
        progress: 100,
        message: resolved.error,
        output: resolved.rawStderr || resolved.error
      });
      jobs[catalog.id] = jobId;
    }
    return res.json({ jobs });
  }
  for (const catalog of getCatalogs()) {
    const jobId = runScanJob({
      version: catalogMinor,
      catalogId: catalog.id,
      catalogImage: catalog.image(catalogMinor),
      authFile: tempAuthFile,
      jobType: "operator-scan",
      ocMirrorPath: resolved.path
    });
    jobs[catalog.id] = jobId;

    if (process.env.NODE_ENV !== "test") {
      console.log("[operator-scan:job-created]", {
        requestId: req.requestId,
        jobId,
        catalogId: catalog.id,
        version: catalogMinor
      });
    }
  }
  res.json({ jobs });
});

app.post("/api/operators/prefetch", async (req, res) => {
  const state = ensureState();
  if (!state.release?.confirmed) {
    return res.status(400).json({ error: "Version not confirmed." });
  }
  if (!authAvailable()) {
    return res.status(400).json({ error: "Registry auth not configured." });
  }
  const catalogMinor = getOpenShiftMinorFromState(state);
  if (!catalogMinor) {
    return res.status(400).json({
      error: "OpenShift release minor is not set. Select minor channel and patch in Blueprint (or ensure patchVersion is set)."
    });
  }
  const resolved = await resolveOcMirrorBinary(dataDir);
  const jobs = {};
  if (resolved.error) {
    for (const catalog of getCatalogs()) {
      const jobId = createJob("operator-prefetch", `Prefetching ${catalog.id} operators...`);
      updateJob(jobId, {
        status: "failed",
        progress: 100,
        message: resolved.error,
        output: resolved.rawStderr || resolved.error
      });
      jobs[catalog.id] = jobId;
    }
    return res.json({ jobs });
  }
  for (const catalog of getCatalogs()) {
    const jobId = runScanJob({
      version: catalogMinor,
      catalogId: catalog.id,
      catalogImage: catalog.image(catalogMinor),
      jobType: "operator-prefetch",
      message: `Prefetching ${catalog.id} operators...`,
      ocMirrorPath: resolved.path
    });
    jobs[catalog.id] = jobId;
  }
  res.json({ jobs });
});

app.get("/api/operators/status", (req, res) => {
  const version = req.query.version;
  const response = {};
  for (const catalog of getCatalogs()) {
    const cached = getResults(version, catalog.id);
    response[catalog.id] = cached || { results: [], updatedAt: null };
  }
  res.json(response);
});

app.get("/api/runtime-info", async (req, res) => {
  try {
    await resolveOcMirrorBinary(dataDir);
  } catch (e) {
    if (process.env.DEBUG) console.error("oc-mirror binary resolution failed:", e);
    // ignore; we still return arch info
  }

  // Detect platform (Linux, Mac, Windows)
  let detectedPlatform = 'linux';
  if (process.platform === 'darwin') {
    detectedPlatform = 'mac';
  } else if (process.platform === 'win32') {
    detectedPlatform = 'windows';
  }

  // Normalize architecture for installer URLs (x64 -> amd64, arm64 -> arm64, etc.)
  const { normalizeInstallerArch } = await import('./openshiftInstaller.js');
  const normalizedArch = normalizeInstallerArch(process.arch);

  res.json({
    runtimeArch: getRuntimeArch(),
    localBinaryArch: getLocalBinaryArch(),
    detectedPlatform: detectedPlatform,
    detectedInstallerVariant: `${detectedPlatform}-${normalizedArch}` // e.g., "linux-amd64"
  });
});

app.get("/api/jobs", (req, res) => {
  const type = req.query.type;
  const jobs = type ? listJobsByType(type) : listJobs();
  res.json({ jobs });
});

app.get("/api/jobs/count", (req, res) => {
  res.json({ count: getJobsCount() });
});

app.delete("/api/jobs", (req, res) => {
  const completedOnly = req.query.completed === "true" || req.query.completed === "1";
  const deleted = completedOnly ? deleteCompletedJobs() : 0;
  res.json({ deleted });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found." });
  res.json(job);
});

app.get("/api/jobs/:id/stream", (req, res) => {
  const jobId = req.params.id;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (payload) => {
    res.write(`event: update\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const job = getJob(jobId);
  if (!job) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: "Job not found." })}\n\n`);
    return res.end();
  }
  send(job);
  const interval = setInterval(() => {
    const latest = getJob(jobId);
    if (!latest) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: "Job not found." })}\n\n`);
      clearInterval(interval);
      return res.end();
    }
    send(latest);
    if (["completed", "failed", "cancelled"].includes(latest.status)) {
      res.write(`event: done\ndata: ${JSON.stringify(latest)}\n\n`);
      clearInterval(interval);
      res.end();
    }
  }, 1000);
  req.on("close", () => clearInterval(interval));
});

app.post("/api/jobs/:id/stop", (req, res) => {
  const jobId = req.params.id;
  const proc = activeProcesses.get(jobId);
  if (!proc) return res.status(404).json({ error: "Job not running." });
  proc.kill("SIGTERM");
  activeProcesses.delete(jobId);
  updateJob(jobId, { status: "cancelled", message: "Stopped by user.", progress: 0 });
  res.json({ ok: true });
});

app.post("/api/system/path-check", validateBody(pathCheckSchema), async (req, res) => {
  const target = req.body.path;
  const minBytes = Number(req.body?.minBytes || 0);
  try {
    const info = await checkPath(target);
    res.json({
      ...info,
      meetsMin: minBytes ? info.freeBytes >= minBytes : true
    });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/ssh/keypair", validateBody(sshKeypairSchema), async (req, res) => {
  try {
    // Zod schema handles validation and default value
    const { algorithm } = req.body;
    const keypair = await generateSshKeypair(algorithm);
    res.json(keypair);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

/** Check if dir exists and contains working-dir or any .tar file (d2m source). */
function checkD2mArchiveStructure(archivePath) {
  try {
    const resolved = path.resolve(archivePath);
    if (!fs.existsSync(resolved)) return "missing";
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return "invalid";
    const entries = fs.readdirSync(resolved);
    if (entries.includes("working-dir")) {
      const wd = path.join(resolved, "working-dir");
      if (fs.statSync(wd).isDirectory()) return "ok";
    }
    if (entries.some((e) => e.endsWith(".tar"))) return "ok";
    return "invalid";
  } catch (err) {
    if (process.env.DEBUG) console.error(`Archive structure check failed:`, err);
    return "invalid";
  }
}

/** Return blocker strings for path overlaps (contract §6C). */
function checkPathOverlap(archivePath, workspacePath, cachePath, mode) {
  const blockers = [];
  const norm = (p) => (p ? path.resolve(String(p).trim()) : "");
  const a = norm(archivePath);
  const w = norm(workspacePath);
  const c = norm(cachePath);
  if (a && w) {
    if (a === w) {
      // same path allowed for m2d; contract says allow
    } else if (a.startsWith(w + path.sep)) {
      blockers.push("Archive path must not be inside workspace path.");
    } else if (w.startsWith(a + path.sep)) {
      blockers.push("Workspace path must not be inside archive path.");
    }
  }
  if (c && w && c === w) {
    blockers.push("Cache path must not equal workspace path.");
  }
  if (c && a && (c.startsWith(a + path.sep) || a.startsWith(c + path.sep))) {
    blockers.push("Cache path must not be inside archive path or contain it.");
  }
  return blockers;
}

app.post("/api/ocmirror/preflight", validateBody(ocMirrorPreflightSchema), async (req, res) => {
  const state = ensureState();
  const body = req.body || {};
  const mode = body.mode || "mirrorToDisk";
  const archivePath = body.archivePath?.trim() || "";
  const workspacePath = body.workspacePath?.trim() || "";
  const cachePath = body.cachePath?.trim() || "";
  const registryUrl = body.registryUrl?.trim() || "";
  const configSourceType = body.configSourceType || "generated";
  const configPath = body.configPath?.trim() || "";
  const rhAuthSource = body.rhAuthSource;
  const rhPullSecret = rhAuthSource === "mounted" ? mountedRhPullSecret : body.rhPullSecret;
  const mirrorAuthSource = body.mirrorAuthSource || "reuse";
  const mirrorPullSecret = body.mirrorPullSecret;
  const minBytes = Number(body.minBytes || 0);

  const blockers = [];
  const warnings = [];
  const fieldErrors = {}; // Maps field names to { severity: "blocker" | "warning", message: string }
  const checks = {
    archivePath: null,
    workspacePath: null,
    cachePath: null,
    config: "missing",
    auth: "missing",
    registryUrl: "empty"
  };

  const validModes = ["mirrorToDisk", "diskToMirror", "mirrorToMirror"];
  if (!validModes.includes(mode)) {
    return res.status(400).json({ error: "Invalid mode." });
  }

  const pathOverlapBlockers = checkPathOverlap(
    mode !== "mirrorToMirror" ? archivePath : null,
    workspacePath,
    mode !== "mirrorToMirror" ? cachePath : null,
    mode
  );
  blockers.push(...pathOverlapBlockers);

  const checkArchive = async () => {
    if (!archivePath && (mode === "mirrorToDisk" || mode === "diskToMirror")) {
      const msg = "Archive path is required.";
      blockers.push(msg);
      fieldErrors.archivePath = { severity: "blocker", message: msg };
      return;
    }
    if (!archivePath) return;
    try {
      const info = await checkPath(archivePath);
      const meetsMin = !minBytes || info.freeBytes >= minBytes;
      if (mode === "mirrorToDisk") {
        if (!info.writable) {
          const msg = "Archive path is not writable.";
          blockers.push(msg);
          fieldErrors.archivePath = { severity: "blocker", message: msg };
        }
        if (!meetsMin) {
          const msg = "Insufficient disk space at archive path.";
          blockers.push(msg);
          fieldErrors.archivePath = { severity: "blocker", message: msg };
        }
        checks.archivePath = {
          exists: info.exists,
          writable: info.writable,
          freeBytes: info.freeBytes,
          meetsMin,
          structure: "ok"
        };
      } else if (mode === "diskToMirror") {
        if (!info.exists) {
          const msg = "Source archive path does not exist.";
          blockers.push(msg);
          fieldErrors.archivePath = { severity: "blocker", message: msg };
        }
        const structure = checkD2mArchiveStructure(archivePath);
        if (structure === "invalid") {
          const msg = "Source archive path must contain oc-mirror output (working-dir or tar files).";
          blockers.push(msg);
          fieldErrors.archivePath = { severity: "blocker", message: msg };
        }
        checks.archivePath = {
          exists: info.exists,
          writable: info.writable,
          freeBytes: info.freeBytes,
          meetsMin: meetsMin,
          structure
        };
      }
    } catch (err) {
      const msg = `Archive path check failed: ${String(err?.message || err)}.`;
      blockers.push(msg);
      fieldErrors.archivePath = { severity: "blocker", message: msg };
    }
  };

  const checkWorkspace = async () => {
    if (!workspacePath) {
      if (mode === "mirrorToMirror") {
        const msg = "Workspace path is required.";
        blockers.push(msg);
        fieldErrors.workspacePath = { severity: "blocker", message: msg };
      }
      return;
    }
    try {
      const info = await checkPath(workspacePath);
      const parent = info.exists ? workspacePath : path.dirname(path.resolve(workspacePath));
      let creatable = false;
      let writable = false;
      let freeBytes = 0;
      try {
        const parentInfo = await checkPath(parent);
        writable = parentInfo.writable;
        freeBytes = parentInfo.freeBytes;
        creatable = parentInfo.writable;
      } catch (err) {
        if (process.env.DEBUG) console.error(`Path check failed for ${parent}:`, err);
      }
      if (!info.exists && !creatable) {
        const msg = "Workspace path is not creatable or writable.";
        blockers.push(msg);
        fieldErrors.workspacePath = { severity: "blocker", message: msg };
      }
      if (info.exists && !info.writable) {
        const msg = "Workspace path is not writable.";
        blockers.push(msg);
        fieldErrors.workspacePath = { severity: "blocker", message: msg };
      }
      const meetsMin = !minBytes || freeBytes >= minBytes;
      if (minBytes && !meetsMin) {
        const msg = "Low disk space at workspace path.";
        warnings.push(msg);
        fieldErrors.workspacePath = { severity: "warning", message: msg };
      }
      if (info.exists && fs.existsSync(path.join(path.resolve(workspacePath), "working-dir"))) {
        const msg = "Workspace already contains oc-mirror data.";
        warnings.push(msg);
        if (!fieldErrors.workspacePath) {
          fieldErrors.workspacePath = { severity: "warning", message: msg };
        }
      }
      checks.workspacePath = {
        exists: info.exists,
        creatable: creatable || info.writable,
        writable: info.exists ? info.writable : writable,
        freeBytes: freeBytes || info.freeBytes
      };
    } catch (err) {
      const msg = `Workspace path check failed: ${String(err?.message || err)}.`;
      blockers.push(msg);
      fieldErrors.workspacePath = { severity: "blocker", message: msg };
    }
  };

  const checkCache = async () => {
    if (mode === "mirrorToMirror") {
      checks.cachePath = null;
      return;
    }
    if (!cachePath && (mode === "mirrorToDisk" || mode === "diskToMirror")) {
      const msg = "Cache path is required.";
      blockers.push(msg);
      fieldErrors.cachePath = { severity: "blocker", message: msg };
      return;
    }
    if (!cachePath) return;
    try {
      const info = await checkPath(cachePath);
      const parent = info.exists ? cachePath : path.dirname(path.resolve(cachePath));
      let creatable = false;
      let writable = false;
      try {
        const parentInfo = await checkPath(parent);
        writable = parentInfo.writable;
        creatable = parentInfo.writable;
      } catch (err) {
        if (process.env.DEBUG) console.error("Parent path check failed:", err);
      }
      if (!info.exists && !creatable) {
        const msg = "Cache path is not creatable or writable.";
        blockers.push(msg);
        fieldErrors.cachePath = { severity: "blocker", message: msg };
      }
      if (info.exists && !info.writable) {
        const msg = "Cache path is not writable.";
        blockers.push(msg);
        fieldErrors.cachePath = { severity: "blocker", message: msg };
      }
      checks.cachePath = {
        exists: info.exists,
        creatable: creatable || info.writable,
        writable: info.exists ? info.writable : writable
      };
    } catch (err) {
      const msg = `Cache path check failed: ${String(err?.message || err)}.`;
      blockers.push(msg);
      fieldErrors.cachePath = { severity: "blocker", message: msg };
    }
  };

  await checkArchive();
  if (mode === "mirrorToMirror") await checkWorkspace();
  await checkCache();

  if (configSourceType === "generated") {
    checks.config = "present";
  } else if (configPath) {
    try {
      const resolved = path.resolve(configPath);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        checks.config = "present";
      } else {
        checks.config = "missing";
        const msg = "Config file not found.";
        blockers.push(msg);
        fieldErrors.configPath = { severity: "blocker", message: msg };
      }
    } catch {
      checks.config = "missing";
      const msg = "Config file not found.";
      blockers.push(msg);
      fieldErrors.configPath = { severity: "blocker", message: msg };
    }
  } else {
    const msg = "Config path is required when using external config.";
    blockers.push(msg);
    fieldErrors.configPath = { severity: "blocker", message: msg };
  }

  // Auth checks per mode
  if (mode === "mirrorToDisk" || mode === "mirrorToMirror") {
    const validation = validateRhPullSecret(rhPullSecret);
    if (validation.valid) {
      checks.auth = "present";
    } else {
      checks.auth = "missing";
      blockers.push(validation.error);
      fieldErrors.rhPullSecret = { severity: "blocker", message: validation.error };
    }
  }
  if (mode === "diskToMirror" || mode === "mirrorToMirror") {
    let mirrorSecretPresent = false;
    if (mirrorAuthSource === "reuse") {
      const secret = state.credentials?.mirrorRegistryPullSecret;
      if (secret && typeof secret === "string" && secret.trim().length > 0) {
        try {
          JSON.parse(secret);
          mirrorSecretPresent = true;
        } catch {
          const msg = "Mirror registry credentials in Identity & Access do not appear to be valid JSON.";
          blockers.push(msg);
          fieldErrors.mirrorPullSecret = { severity: "blocker", message: msg };
        }
      } else {
        const msg = "Mirror registry credentials not found in Identity & Access.";
        blockers.push(msg);
        fieldErrors.mirrorPullSecret = { severity: "blocker", message: msg };
      }
    } else if (mirrorPullSecret && typeof mirrorPullSecret === "string" && mirrorPullSecret.trim().length > 0) {
      mirrorSecretPresent = true;
    } else {
      const msg = "Mirror registry credentials are required for this mode.";
      blockers.push(msg);
      fieldErrors.mirrorPullSecret = { severity: "blocker", message: msg };
    }
    if (mode === "diskToMirror") checks.auth = mirrorSecretPresent ? "present" : "missing";
    else if (!mirrorSecretPresent) checks.auth = "missing";
  }

  if (mode === "diskToMirror" || mode === "mirrorToMirror") {
    checks.registryUrl = registryUrl ? "non-empty" : "empty";
    if (!registryUrl) {
      const msg = "Registry URL is required for this mode.";
      blockers.push(msg);
      fieldErrors.registryUrl = { severity: "blocker", message: msg };
    }
  }

  // Advanced options validation
  const advanced = body.advanced || {};
  const validLogLevels = ["error", "warn", "info", "debug", "trace"];
  if (advanced.logLevel && !validLogLevels.includes(advanced.logLevel)) {
    const msg = `Log level must be one of: ${validLogLevels.join(", ")}`;
    blockers.push(msg);
    fieldErrors.logLevel = { severity: "blocker", message: msg };
  }
  if (advanced.parallelImages != null) {
    const val = Number(advanced.parallelImages);
    if (!Number.isInteger(val) || val < 1 || val > 32) {
      const msg = "Parallel images must be an integer between 1 and 32.";
      blockers.push(msg);
      fieldErrors.parallelImages = { severity: "blocker", message: msg };
    }
  }
  if (advanced.parallelLayers != null) {
    const val = Number(advanced.parallelLayers);
    if (!Number.isInteger(val) || val < 1 || val > 32) {
      const msg = "Parallel layers must be an integer between 1 and 32.";
      blockers.push(msg);
      fieldErrors.parallelLayers = { severity: "blocker", message: msg };
    }
  }
  if (advanced.imageTimeout) {
    // Validate Go duration format (e.g., "10m", "1h", "30s")
    const durationRegex = /^(\d+(\.\d+)?)(ns|us|µs|ms|s|m|h)$/;
    if (!durationRegex.test(advanced.imageTimeout)) {
      const msg = "Image timeout must be a valid Go duration (e.g., 10m, 1h, 30s).";
      blockers.push(msg);
      fieldErrors.imageTimeout = { severity: "blocker", message: msg };
    }
  }
  if (advanced.retryTimes != null) {
    const val = Number(advanced.retryTimes);
    if (!Number.isInteger(val) || val < 0 || val > 10) {
      const msg = "Retry times must be an integer between 0 and 10.";
      blockers.push(msg);
      fieldErrors.retryTimes = { severity: "blocker", message: msg };
    }
  }
  if (advanced.retryDelay) {
    const durationRegex = /^(\d+(\.\d+)?)(ns|us|µs|ms|s|m|h)$/;
    if (!durationRegex.test(advanced.retryDelay)) {
      const msg = "Retry delay must be a valid Go duration (e.g., 1s, 5s, 30s).";
      blockers.push(msg);
      fieldErrors.retryDelay = { severity: "blocker", message: msg };
    }
  }
  // Note: 'since' and 'strictArchive' are harder to validate (digest/ISO date format), skip for now

  // External config YAML validation
  if (configSourceType !== "generated" && configPath && checks.config === "present") {
    try {
      const configContent = fs.readFileSync(path.resolve(configPath), "utf8");
      // Basic YAML syntax check - try to parse
      const yaml = await import("yaml");
      const parsed = yaml.parse(configContent);
      // Check for required fields
      if (!parsed || typeof parsed !== "object") {
        const msg = "Config file must contain valid YAML.";
        blockers.push(msg);
        fieldErrors.configPath = { severity: "blocker", message: msg };
      } else {
        if (!parsed.apiVersion) {
          const msg = "Config file missing required field: apiVersion";
          blockers.push(msg);
          fieldErrors.configPath = { severity: "blocker", message: msg };
        }
        if (parsed.kind !== "ImageSetConfiguration") {
          const msg = 'Config file kind must be "ImageSetConfiguration"';
          blockers.push(msg);
          fieldErrors.configPath = { severity: "blocker", message: msg };
        }
        if (!parsed.mirror || (!parsed.mirror.platform && !parsed.mirror.operators && !parsed.mirror.additionalImages)) {
          const msg = "Config file must specify at least one of: mirror.platform, mirror.operators, or mirror.additionalImages";
          warnings.push(msg);
          fieldErrors.configPath = { severity: "warning", message: msg };
        }
      }
    } catch (err) {
      const msg = `Config file validation failed: ${String(err?.message || err)}`;
      blockers.push(msg);
      fieldErrors.configPath = { severity: "blocker", message: msg };
    }
  }

  const ok = blockers.length === 0;
  res.json({ ok, blockers, warnings, checks, fieldErrors });
});

/** Build oc-mirror CLI args for v1 modes (contract §2B). */
function buildOcMirrorArgs(mode, configPath, archivePath, workspacePath, cachePath, registryUrl, dryRun, advanced, authFile) {
  const args = ["--config", configPath, "--v2"];
  if (authFile) args.push("--authfile", authFile);
  const adv = advanced || {};
  if (adv.logLevel) args.push("--log-level", String(adv.logLevel));
  if (adv.parallelImages != null) args.push("--parallel-images", String(adv.parallelImages));
  if (adv.parallelLayers != null) args.push("--parallel-layers", String(adv.parallelLayers));
  if (adv.imageTimeout) args.push("--image-timeout", String(adv.imageTimeout));
  if (adv.retryTimes != null) args.push("--retry-times", String(adv.retryTimes));
  if (adv.retryDelay) args.push("--retry-delay", String(adv.retryDelay));
  if (adv.since) args.push("--since", String(adv.since));
  if (adv.strictArchive) args.push("--strict-archive");
  if (mode === "mirrorToMirror" && workspacePath) args.push("--workspace", `file://${path.resolve(workspacePath)}`);
  if (cachePath && (mode === "mirrorToDisk" || mode === "diskToMirror")) {
    args.push("--cache-dir", path.resolve(cachePath));
  }
  if (dryRun) args.push("--dry-run");
  if (mode === "mirrorToDisk") {
    args.push(`file://${path.resolve(archivePath)}`);
  } else if (mode === "diskToMirror") {
    args.push("--from", `file://${path.resolve(archivePath)}`);
    args.push(registryUrl.startsWith("docker://") ? registryUrl : `docker://${registryUrl}`);
  } else {
    args.push(registryUrl.startsWith("docker://") ? registryUrl : `docker://${registryUrl}`);
  }
  return args;
}

/** Safely resolve the directory that owns working-dir outputs for a run mode. */
function resolveOcMirrorArtifactsBaseDir(mode, workspacePath, archivePath) {
  const raw = mode === "mirrorToMirror" ? workspacePath : archivePath;
  if (!raw || typeof raw !== "string" || !raw.trim()) return "";
  try {
    return path.resolve(raw);
  } catch {
    return "";
  }
}

app.post("/api/ocmirror/run", validateBody(ocMirrorRunSchema), async (req, res) => {
  const state = ensureState();
  const confirmed = state.version?.versionConfirmed ?? state.release?.confirmed;
  if (!confirmed) {
    return res.status(400).json({ error: "Version not confirmed." });
  }
  const body = req.body || {};
  const mode = body.mode || "mirrorToDisk";
  const dryRun = Boolean(body.dryRun);
  const archivePath = body.archivePath?.trim() || state.mirrorWorkflow?.archivePath?.trim() || state.mirrorWorkflow?.outputPath?.trim();
  const workspacePath = body.workspacePath?.trim() || state.mirrorWorkflow?.workspacePath?.trim();
  const cachePath = body.cachePath?.trim() || state.mirrorWorkflow?.cachePath?.trim();
  const registryFqdn = state.globalStrategy?.mirroring?.registryFqdn?.trim();
  const registryUrl = body.registryUrl?.trim() || (registryFqdn ? `docker://${registryFqdn}` : "");
  const configSourceType = body.configSourceType || "generated";
  const configPathExternal = body.configPath?.trim();
  const rhPullSecretRaw = body.rhAuthSource === "mounted" ? mountedRhPullSecret : body.rhPullSecret;
  const mirrorAuthSource = body.mirrorAuthSource || "reuse";
  const mirrorPullSecretRaw = body.mirrorPullSecret;
  const advanced = body.advanced && typeof body.advanced === "object" ? body.advanced : {};

  if (!["mirrorToDisk", "diskToMirror", "mirrorToMirror"].includes(mode)) {
    return res.status(400).json({ error: "Invalid mode." });
  }
  // --dry-run is a global oc-mirror v2 flag valid for all modes
  if ((mode === "mirrorToDisk" || mode === "diskToMirror") && !archivePath) {
    return res.status(400).json({ error: "Archive path is required." });
  }
  if (mode === "mirrorToMirror" && !workspacePath) {
    return res.status(400).json({ error: "Workspace path is required." });
  }
  if ((mode === "diskToMirror" || mode === "mirrorToMirror") && !registryUrl) {
    return res.status(400).json({ error: "Registry URL is required for this mode." });
  }
  if (configSourceType === "external" && !configPathExternal) {
    return res.status(400).json({ error: "Config path is required when using external config." });
  }

  let configPathToUse = null;
  const tmpDir = path.join(dataDir, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const jobId = createJob("oc-mirror-run", "oc-mirror run starting.");

  if (configSourceType === "generated") {
    const configContents = buildImageSetConfig(state);
    configPathToUse = path.join(tmpDir, `imageset-${jobId}.yaml`);
    fs.writeFileSync(configPathToUse, configContents, "utf8");
  } else {
    try {
      const resolved = path.resolve(configPathExternal);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        updateJob(jobId, { status: "failed", message: "External config file not found.", progress: 100 });
        return res.json({ jobId });
      }
      configPathToUse = resolved;
    } catch (err) {
      updateJob(jobId, { status: "failed", message: String(err?.message || err), progress: 100 });
      return res.json({ jobId });
    }
  }

  let authFile = null;
  try {
    if (mode === "mirrorToDisk") {
      if (rhPullSecretRaw) {
        authFile = writeTempAuth(normalizePullSecret(rhPullSecretRaw));
      }
    } else if (mode === "diskToMirror") {
      if (mirrorAuthSource === "reuse") {
        const secret = state.credentials?.mirrorRegistryPullSecret;
        if (secret && typeof secret === "string") authFile = writeTempAuth(normalizePullSecret(secret));
      } else if (mirrorPullSecretRaw) {
        authFile = writeTempAuth(normalizePullSecret(mirrorPullSecretRaw));
      }
    } else if (mode === "mirrorToMirror") {
      const rhRaw = rhPullSecretRaw;
      const mirrorRaw = mirrorAuthSource === "reuse"
        ? state.credentials?.mirrorRegistryPullSecret
        : mirrorPullSecretRaw;
      if (rhRaw && mirrorRaw) {
        authFile = writeTempAuth(mergePullSecrets(normalizePullSecret(rhRaw), normalizePullSecret(mirrorRaw)));
      } else if (rhRaw) {
        authFile = writeTempAuth(normalizePullSecret(rhRaw));
      } else if (mirrorRaw) {
        authFile = writeTempAuth(normalizePullSecret(mirrorRaw));
      }
    }
  } catch (err) {
    updateJob(jobId, { status: "failed", message: "Invalid pull secret JSON.", progress: 100 });
    safeUnlink(configPathToUse);
    return res.json({ jobId });
  }

  const resolved = await resolveOcMirrorBinary(dataDir);
  if (resolved.error) {
    updateJob(jobId, {
      status: "failed",
      progress: 100,
      message: resolved.error,
      output: resolved.rawStderr || resolved.error
    });
    safeUnlink(configPathToUse);
    if (authFile) safeUnlink(authFile);
    return res.json({ jobId });
  }

  try {
    if (mode === "mirrorToMirror" && workspacePath) fs.mkdirSync(path.resolve(workspacePath), { recursive: true });
    if (mode !== "mirrorToMirror" && archivePath) fs.mkdirSync(path.resolve(archivePath), { recursive: true });
    if (cachePath && mode !== "mirrorToMirror") fs.mkdirSync(path.resolve(cachePath), { recursive: true });
  } catch (err) {
    updateJob(jobId, { status: "failed", message: String(err?.message || err), progress: 100 });
    safeUnlink(configPathToUse);
    if (authFile) safeUnlink(authFile);
    return res.json({ jobId });
  }

  const startedAt = Date.now();
  const meta = {
    mode,
    dryRun,
    archiveDir: archivePath || "",
    workspaceDir: workspacePath,
    cacheDir: cachePath || "",
    registryUrl: registryUrl || "",
    configSourceType,
    configPath: configPathExternal || "",
    startedAt
  };
  updateJobMetadata(jobId, meta);

  const args = buildOcMirrorArgs(
    mode,
    configPathToUse,
    archivePath,
    workspacePath,
    cachePath,
    registryUrl,
    dryRun,
    advanced,
    authFile
  );
  const fullCommand = `${resolved.path} ${args.join(" ")}`;
  updateJobMetadata(jobId, { ...meta, fullCommand });
  // Do NOT pass REGISTRY_AUTH_FILE to oc-mirror — that env var is consumed by
  // the distribution/distribution local registry component as a YAML config file
  // path (not an OCI auth JSON), causing a startup panic.  Auth is supplied via
  // --authfile flag instead.
  const { REGISTRY_AUTH_FILE: _drop, ...envWithoutRegistryAuthFile } = process.env;
  const child = spawn(resolved.path, args, { env: envWithoutRegistryAuthFile });
  activeProcesses.set(jobId, child);
  updateJob(jobId, { status: "running", progress: 0, message: "oc-mirror running." });
  child.stdout.on("data", (data) => appendJobOutput(jobId, data.toString()));
  child.stderr.on("data", (data) => appendJobOutput(jobId, data.toString()));
  child.on("error", (err) => {
    appendJobOutput(jobId, `\n${String(err)}\n`);
    updateJob(jobId, { status: "failed", message: "oc-mirror failed to start." });
    activeProcesses.delete(jobId);
    safeUnlink(configPathToUse);
    if (authFile) safeUnlink(authFile);
  });
  child.on("close", (code) => {
    const finishedAt = Date.now();
    const artifactsBaseDir = resolveOcMirrorArtifactsBaseDir(mode, workspacePath, archivePath);
    const clusterResourcesPath = artifactsBaseDir
      ? path.join(artifactsBaseDir, "working-dir", "cluster-resources")
      : "";
    const dryRunMappingPath = dryRun
      ? (artifactsBaseDir ? path.join(artifactsBaseDir, "working-dir", "dry-run", "mapping.txt") : "")
      : "";
    const dryRunMissingPath = dryRun
      ? (artifactsBaseDir ? path.join(artifactsBaseDir, "working-dir", "dry-run", "missing.txt") : "")
      : "";

    // Parse accumulated output for oc-mirror result summary lines.
    // Patterns:  ✓ 190 / 190 release images mirrored successfully
    //            ✗ 109 / 112 operator images mirrored: Some operator images failed
    const output = getJob(jobId)?.output || "";
    const releaseMatch = output.match(/[✓✗]\s+(\d+)\s*\/\s*(\d+)\s+release images mirrored/);
    const operatorMatch = output.match(/[✓✗]\s+(\d+)\s*\/\s*(\d+)\s+operator images mirrored/);
    const releaseResult = releaseMatch
      ? { succeeded: parseInt(releaseMatch[1], 10), total: parseInt(releaseMatch[2], 10) }
      : null;
    const operatorResult = operatorMatch
      ? { succeeded: parseInt(operatorMatch[1], 10), total: parseInt(operatorMatch[2], 10) }
      : null;

    // Collect failed image refs from [ERROR]: [Worker] error mirroring image … lines.
    const failedImages = [];
    const failRe = /\[ERROR\].*?\[Worker\] error mirroring image\s+(\S+)/g;
    let fm;
    while ((fm = failRe.exec(output)) !== null) {
      if (!failedImages.includes(fm[1])) failedImages.push(fm[1]);
    }

    // Determine nuanced status:
    // "completed_with_warnings" when the run exited non-zero but all release images
    // succeeded (cluster can still be installed) and at least some operators were
    // attempted (partial operator failure rather than a total run failure).
    let status;
    if (code === 0) {
      status = "completed";
    } else if (
      releaseResult && releaseResult.succeeded === releaseResult.total &&
      operatorResult && operatorResult.total > 0
    ) {
      status = "completed_with_warnings";
    } else {
      status = "failed";
    }

    updateJobMetadata(jobId, {
      exitCode: code,
      finishedAt,
      clusterResourcesPath,
      dryRunMappingPath,
      dryRunMissingPath,
      releaseResult,
      operatorResult,
      failedImages: failedImages.length ? failedImages : undefined
    });

    let message;
    if (status === "completed") {
      message = "oc-mirror completed.";
    } else if (status === "completed_with_warnings") {
      const opFailed = operatorResult ? operatorResult.total - operatorResult.succeeded : "?";
      message = `oc-mirror completed with warnings: ${opFailed} operator image(s) failed.`;
    } else {
      message = `oc-mirror exited with code ${code}.`;
    }

    updateJob(jobId, {
      status,
      progress: status === "completed" ? 100 : status === "completed_with_warnings" ? 100 : 0,
      message
    });
    activeProcesses.delete(jobId);
    safeUnlink(configPathToUse);
    if (authFile) safeUnlink(authFile);
  });
  res.json({ jobId });
});

app.get("/api/docs", (req, res) => {
  const state = ensureState();
  const version = getOpenShiftMinorFromState(state) || "4.0";
  const key = docsKey(version, state.blueprint?.platform, state.methodology?.method, state.docs?.connectivity);
  const cached = getDocsFromCache(key);
  res.json({ cached });
});

app.post("/api/docs/update", async (req, res) => {
  const state = ensureState();
  const version = getOpenShiftMinorFromState(state) || "4.0";
  const key = docsKey(version, state.blueprint?.platform, state.methodology?.method, state.docs?.connectivity);
  const cached = getDocsFromCache(key);
  if (cached && Date.now() - cached.updatedAt < 5 * 60 * 1000) {
    return res.json({ jobId: null, links: cached.links, cached: true });
  }
  const job = await updateDocsLinks({
    version,
    platform: state.blueprint?.platform,
    methodology: state.methodology?.method,
    connectivity: state.docs?.connectivity
  });
  storeDocs(key, job.validated);
  res.json({ jobId: job.jobId, links: job.validated });
});

app.post("/api/aws/warm-installer", (req, res) => {
  const version = req.body?.version || req.query.version;
  if (!version) {
    return res.status(400).json({ error: "Version is required." });
  }
  warmInstallerStream(version);
  res.status(202).json({ status: "started", version });
});

app.get("/api/aws/regions", async (req, res) => {
  const state = ensureState();
  const confirmed = state.version?.versionConfirmed ?? state.release?.confirmed;
  if (!confirmed) {
    return res.status(400).json({ error: "Version not confirmed." });
  }
  const version = req.query.version || state.release?.patchVersion;
  const arch = req.query.arch || state.blueprint?.arch;
  const force = req.query.force === "true";
  if (!version || !arch) {
    return res.status(400).json({ error: "Version and architecture are required." });
  }
  try {
    const regions = await getAwsRegions(version, arch, force);
    res.json({ version, arch, regions });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/aws/ami", async (req, res) => {
  const state = ensureState();
  const confirmed = state.version?.versionConfirmed ?? state.release?.confirmed;
  if (!confirmed) {
    return res.status(400).json({ error: "Version not confirmed." });
  }
  const version = req.query.version || state.release?.patchVersion;
  const arch = req.query.arch || state.blueprint?.arch;
  const region = req.query.region;
  const force = req.query.force === "true";
  if (!version || !arch || !region) {
    return res.status(400).json({ error: "Version, architecture, and region are required." });
  }
  try {
    const ami = await getAwsAmi(version, arch, region, force);
    if (!ami) {
      return res.status(404).json({ error: `No AMI found for ${region} (${arch}).` });
    }
    res.json({ version, arch, region, ami });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

const buildPreviewFiles = (state) => {
  const confirmed = state.version?.versionConfirmed ?? state.release?.confirmed;
  if (!confirmed) return null;
  const version = getOpenShiftMinorFromState(state) || "4.0";
  const key = docsKey(version, state.blueprint?.platform, state.methodology?.method, state.docs?.connectivity);
  const cached = getDocsFromCache(key);
  const links = cached?.links || [];
  const installConfig = buildInstallConfig(state);
  const wantsAgentConfig =
    state.methodology?.method === "Agent-Based Installer" &&
    (state.blueprint?.platform === "Bare Metal" || state.blueprint?.platform === "VMware vSphere");
  const agentConfig = wantsAgentConfig ? buildAgentConfig(state) : null;
  const imageSetConfig = buildImageSetConfig(state);
  const ntpMachineConfigs = buildNtpMachineConfigs(state);
  const fieldManual = buildFieldManual(state, links);
  return {
    "install-config.yaml": installConfig,
    "agent-config.yaml": agentConfig,
    "imageset-config.yaml": imageSetConfig,
    "FIELD_MANUAL.md": fieldManual,
    ...ntpMachineConfigs
  };
};

app.post("/api/trust/analyze", (req, res) => {
  const bodyState = req.body?.state;
  const state = bodyState && typeof bodyState === "object" ? bodyState : ensureState();
  try {
    const analysis = getCachedTrustAnalysis(state);
    res.json({
      analysis,
      triggerDefaults: ANALYSIS_TRIGGER_DEFAULTS
    });
  } catch (error) {
    res.status(400).json({ error: String(error?.message || error) });
  }
});

app.get("/api/generate", (req, res) => {
  const state = ensureState();
  try {
    const files = buildPreviewFiles(state);
    if (!files) return res.status(400).json({ error: "Version not confirmed." });
    res.json({ files });
  } catch (error) {
    if (error instanceof TrustAnalysisHashMismatchError) {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        analysisHashMismatch: true,
        details: error.details || {}
      });
    }
    if (error instanceof TrustSelectionHardLimitError) {
      return res.status(422).json({
        error: error.message,
        code: error.code,
        trustSelectionHardLimitExceeded: true,
        details: error.details || {}
      });
    }
    return res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/generate", (req, res) => {
  const parsed = parseOptionalClientState(req.body?.state, ensureState);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const files = buildPreviewFiles(parsed.state);
    if (!files) return res.status(400).json({ error: "Version not confirmed." });
    res.json({ files });
  } catch (error) {
    if (error instanceof TrustAnalysisHashMismatchError) {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        analysisHashMismatch: true,
        details: error.details || {}
      });
    }
    if (error instanceof TrustSelectionHardLimitError) {
      return res.status(422).json({
        error: error.message,
        code: error.code,
        trustSelectionHardLimitExceeded: true,
        details: error.details || {}
      });
    }
    return res.status(500).json({ error: String(error?.message || error) });
  }
});

const buildBundleZip = async (state, res) => {
  const confirmed = state.version?.versionConfirmed ?? state.release?.confirmed;
  if (!confirmed) {
    res.status(400).json({ error: "Version not confirmed." });
    return;
  }

  const version = getOpenShiftMinorFromState(state) || "4.0";

  if (process.env.NODE_ENV !== "test") {
    console.log("[bundle:start]", {
      version,
      platform: state.blueprint?.platform,
      method: state.methodology?.method,
      includeClientTools: Boolean(state.exportOptions?.includeClientTools),
      draftMode: Boolean(state.exportOptions?.draftMode)
    });
  }

  const key = docsKey(version, state.blueprint?.platform, state.methodology?.method, state.docs?.connectivity);
  const cached = getDocsFromCache(key);
  const links = cached?.links || [];
  const installConfig = buildInstallConfig(state);
  const wantsAgentConfig =
    state.methodology?.method === "Agent-Based Installer" &&
    (state.blueprint?.platform === "Bare Metal" || state.blueprint?.platform === "VMware vSphere");
  const agentConfig = wantsAgentConfig ? buildAgentConfig(state) : null;
  const imageSetConfig = buildImageSetConfig(state);
  const ntpMachineConfigs = buildNtpMachineConfigs(state);
  const fieldManual = buildFieldManual(state, links);

  const bundleName = `airgap-${state.release?.patchVersion || "unknown"}-install-configs-bundle.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename=${bundleName}`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    res.status(500).end(String(err));
  });
  archive.pipe(res);
  archive.append(installConfig, { name: "install-config.yaml" });
  if (agentConfig) {
    archive.append(agentConfig, { name: "agent-config.yaml" });
  }
  archive.append(imageSetConfig, { name: "imageset-config.yaml" });
  archive.append(fieldManual, { name: "FIELD_MANUAL.md" });
  Object.entries(ntpMachineConfigs).forEach(([name, content]) => {
    archive.append(content, { name });
  });
  if (state.exportOptions?.draftMode) {
    archive.append(
      "DRAFT/NOT VALIDATED: Warnings were present at export time. Review before use.\n",
      { name: "DRAFT_NOT_VALIDATED.txt" }
    );
  }
  if (state.exportOptions?.includeClientTools) {
    try {
      const exportArch = state.exportOptions?.exportBinaryArch || getLocalBinaryArch();
      const { ocPath, ocMirrorPath } = await getBinariesForExportArch(exportArch, dataDir);
      const assertReadableFile = (filePath, label) => {
        if (!filePath || !fs.existsSync(filePath)) return false;
        fs.accessSync(filePath, fs.constants.R_OK);
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
          throw new Error(`${label} path is not a regular file: ${filePath}`);
        }
        return true;
      };
      if (ocPath && fs.existsSync(ocPath)) {
        assertReadableFile(ocPath, "oc");
        archive.file(ocPath, { name: "tools/oc" });
      }
      if (ocMirrorPath && fs.existsSync(ocMirrorPath)) {
        assertReadableFile(ocMirrorPath, "oc-mirror");
        archive.file(ocMirrorPath, { name: "tools/oc-mirror" });
      }
    } catch (e) {
      archive.append(
        `Failed to include oc/oc-mirror: ${String(e?.message || e)}\n`,
        { name: "tools/oc-mirror.ERROR.txt" }
      );
    }
  }
  if (state.exportOptions?.includeInstaller) {
    try {
      const version = state.release?.patchVersion;
      if (!version) {
        throw new Error("Version not selected.");
      }

      const useFips = state.exportOptions?.installerUseFips || false;
      const platformArch = state.exportOptions?.installerPlatformArch || ""; // "" means default

      // Download (or retrieve from cache) the requested binary variant
      const installerPath = await ensureOpenshiftInstaller(version, platformArch, useFips, dataDir);

      if (fs.existsSync(installerPath)) {
        // Preserve binary name (openshift-install-fips for FIPS, openshift-install for standard)
        const binaryName = useFips ? 'openshift-install-fips' : 'openshift-install';
        archive.file(installerPath, { name: `tools/${binaryName}` });
      } else {
        throw new Error("Binary not found after download");
      }
    } catch (error) {
      archive.append(
        `Failed to include openshift-install: ${String(error?.message || error)}\n`,
        { name: "tools/openshift-install.ERROR.txt" }
      );
    }
  }
  if (state.exportOptions?.includeMirrorRegistry) {
    try {
      const mirrorRegistryArch = state.exportOptions?.mirrorRegistryArch || "amd64";
      const mirrorRegistryFilename = `mirror-registry-${mirrorRegistryArch}.tar.gz`;
      const mirrorRegistryUrl = `https://mirror.openshift.com/pub/cgw/mirror-registry/latest/${mirrorRegistryFilename}`;
      const mirrorRegistryPath = path.join(dataDir, "cache", mirrorRegistryFilename);

      // Ensure cache directory exists
      fs.mkdirSync(path.join(dataDir, "cache"), { recursive: true });

      // Download if not already cached or if cached file is invalid
      const needsDownload = !fs.existsSync(mirrorRegistryPath) || fs.statSync(mirrorRegistryPath).size === 0;

      if (needsDownload) {
        // Use Node's built-in fetch which handles redirects automatically (301, 302, 307, 308)
        const response = await fetch(mirrorRegistryUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Stream response to file
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(mirrorRegistryPath, Buffer.from(buffer));

        // Verify download succeeded and file is not empty
        const stat = fs.statSync(mirrorRegistryPath);
        if (stat.size === 0) {
          fs.unlinkSync(mirrorRegistryPath); // Remove corrupt file
          throw new Error("Downloaded file is 0 bytes (download failed)");
        }

        if (process.env.NODE_ENV !== "production") {
          console.log(`[Mirror Registry] Downloaded ${mirrorRegistryFilename} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
        }
      }

      if (fs.existsSync(mirrorRegistryPath)) {
        const stat = fs.statSync(mirrorRegistryPath);
        if (stat.size > 0) {
          archive.file(mirrorRegistryPath, { name: `tools/${mirrorRegistryFilename}` });
        } else {
          throw new Error("Cached file is 0 bytes (corrupt)");
        }
      }
    } catch (error) {
      const mirrorRegistryArch = state.exportOptions?.mirrorRegistryArch || "amd64";
      const mirrorRegistryFilename = `mirror-registry-${mirrorRegistryArch}.tar.gz`;
      const mirrorRegistryUrl = `https://mirror.openshift.com/pub/cgw/mirror-registry/latest/${mirrorRegistryFilename}`;
      archive.append(
        `Failed to include mirror-registry: ${String(error?.message || error)}\nDownload manually from: ${mirrorRegistryUrl}\n`,
        { name: "tools/mirror-registry.ERROR.txt" }
      );
    }
  }
  const mirrorOutputPath = state.mirrorWorkflow?.archivePath || state.mirrorWorkflow?.outputPath;
  if (state.mirrorWorkflow?.includeInExport && mirrorOutputPath) {
    const rawPath = mirrorOutputPath;
    try {
      const resolved = path.resolve(rawPath);
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        archive.directory(resolved, "mirror-output");
      } else {
        archive.append(
          `Mirror output path is not a directory: ${resolved}\n`,
          { name: "mirror-output/MIRROR_OUTPUT_NOT_INCLUDED.txt" }
        );
      }
    } catch (error) {
      archive.append(
        `Mirror output could not be included: ${String(error?.message || error)}. Path: ${rawPath}\n`,
        { name: "mirror-output/MIRROR_OUTPUT_NOT_INCLUDED.txt" }
      );
    }
  }
  archive.finalize();
};

// Path traversal protection: whitelist allowed base directories for filesystem operations
const ALLOWED_BASE_PATHS = [
  path.resolve(process.env.DATA_DIR || "/data"),
  "/tmp"
];

function isPathAllowed(requestedPath) {
  const resolved = path.resolve(requestedPath);
  return ALLOWED_BASE_PATHS.some(base => resolved.startsWith(base));
}

app.get("/api/fs/ls", (req, res) => {
  const reqPath = (req.query.path || "/").toString();
  if (!isPathAllowed(reqPath)) {
    return res.status(403).json({ error: "Access denied to requested path" });
  }
  // Walk up to nearest existing ancestor if the requested path doesn't exist
  let resolved = reqPath;
  let requestedMissing = false;
  while (resolved && resolved !== path.dirname(resolved)) {
    if (fs.existsSync(resolved)) break;
    requestedMissing = true;
    resolved = path.dirname(resolved);
  }
  // Final fallback: root "/"
  if (!fs.existsSync(resolved)) resolved = "/";
  let entries = [];
  try {
    const items = fs.readdirSync(resolved, { withFileTypes: true });
    for (const item of items) {
      try {
        let type = "file";
        const stat = fs.statSync(path.join(resolved, item.name));
        if (stat.isDirectory()) type = "dir";
        const entry = { name: item.name, type };
        if (type === "file") entry.size = stat.size;
        entries.push(entry);
      } catch (err) {
        if (process.env.DEBUG) console.error(`Stat failed for ${item.name}:`, err);
        // skip entries with permission errors
      }
    }
  } catch (err) {
    const isPermission = err.code === "EACCES" || err.code === "EPERM";
    const hint = isPermission
      ? " — Check that the host directory is owned by the user running podman/docker (not root) and that the volume mount includes :Z on SELinux hosts (Fedora/RHEL/CentOS). See README: Run oc-mirror → Mounting external storage."
      : "";
    return res.status(400).json({ error: err.message + hint });
  }
  // dirs first, then files, alphabetical within each group
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  res.json({ path: resolved, entries, requestedPath: reqPath, requestedMissing });
});

const handleBundleZipError = (res, error) => {
  if (error instanceof TrustAnalysisHashMismatchError) {
    return res.status(409).json({
      error: error.message,
      code: error.code,
      analysisHashMismatch: true,
      details: error.details || {}
    });
  }
  if (error instanceof TrustSelectionHardLimitError) {
    return res.status(422).json({
      error: error.message,
      code: error.code,
      trustSelectionHardLimitExceeded: true,
      details: error.details || {}
    });
  }
  return res.status(500).json({ error: String(error?.message || error) });
};

app.post("/api/bundle.prepare", (req, res) => {
  const parsed = parseOptionalClientState(req.body?.state, ensureState);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const state = parsed.state;
  purgeExpiredBundleStates();

  // Security: Prevent memory exhaustion from excessive pending bundle requests
  const MAX_PENDING_BUNDLES = 50;
  if (pendingBundleStates.size >= MAX_PENDING_BUNDLES) {
    return res.status(429).json({
      error: "Too many pending bundle preparations. Please wait and try again later."
    });
  }

  const token = nanoid();
  pendingBundleStates.set(token, {
    state,
    expiresAt: Date.now() + BUNDLE_STATE_TTL_MS
  });
  res.json({
    token,
    expiresAt: new Date(Date.now() + BUNDLE_STATE_TTL_MS).toISOString()
  });
});

app.get("/api/bundle.zip", async (req, res) => {
  purgeExpiredBundleStates();
  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (!token) {
    return res
      .status(400)
      .json({ error: "Missing bundle download token. Prepare a bundle with POST /api/bundle.prepare first." });
  }
  const pending = pendingBundleStates.get(token);
  if (!pending || Date.now() >= pending.expiresAt) {
    return res.status(410).json({ error: "Bundle token expired or invalid. Regenerate and retry download." });
  }
  const state = pending.state;
  try {
    await buildBundleZip(state, res);
  } catch (error) {
    return handleBundleZipError(res, error);
  }
});

app.post("/api/bundle.zip", async (req, res) => {
  const parsed = parseOptionalClientState(req.body?.state, ensureState);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    await buildBundleZip(parsed.state, res);
  } catch (error) {
    return handleBundleZipError(res, error);
  }
});

let server;
if (process.env.NODE_ENV !== "test") {
  server = app.listen(port, () => {
    console.log("");
    console.log("╔═══════════════════════════════════════════════════════════════════╗");
    console.log("║                                                                   ║");
    console.log("║          OpenShift Airgap Architect - Backend Server             ║");
    console.log("║                                                                   ║");
    console.log("╚═══════════════════════════════════════════════════════════════════╝");
    console.log("");
    console.log(`  Server:        http://localhost:${port}`);
    console.log(`  Mode:          ${process.env.MOCK_MODE === "true" ? "MOCK" : "Production"}`);
    console.log(`  Data Dir:      ${process.env.DATA_DIR || "/data"}`);
    // Match /api/build-info (APP_*); optional GIT_SHA / BUILD_TIME for alternate injectors.
    const bannerSha = (process.env.APP_GIT_SHA || process.env.GIT_SHA || process.env.BUILD_GIT_SHA || "").trim();
    const bannerTime = (process.env.APP_BUILD_TIME || process.env.BUILD_TIME || "").trim();
    if (bannerSha || bannerTime) {
      console.log(`  Build:         ${bannerSha ? String(bannerSha).slice(0, 7) : "dev"} • ${bannerTime || "unknown"}`);
    }
    console.log("");
    console.log("  Developed by:  Bill Strauss");
    console.log("  AI Assistance: Claude (Anthropic) • Cursor AI");
    console.log("  License:       MIT");
    console.log("  Repository:    https://github.com/billstrauss/openshift-airgap-architect");
    console.log("");
    console.log("───────────────────────────────────────────────────────────────────");
    console.log("");
  });
  const shutdown = (signal) => {
    console.log(`Received ${signal}, shutting down...`);
    // Kill any active child processes (oc-mirror runs, scan jobs).
    for (const [, child] of activeProcesses.entries()) {
      try {
        child.kill("SIGTERM");
      } catch (err) {
        if (process.env.DEBUG) console.error("Kill child process failed:", err);
      }
    }
    activeProcesses.clear();
    // Exit immediately. Waiting on server.close() hangs because Node's built-in
    // fetch() uses undici connection pools with ref'd TCP sockets for outgoing
    // requests (Cincinnati API, GitHub) that outlive the express server itself —
    // server.close() never calls back. SQLite (better-sqlite3) flushes
    // synchronously via process.on('exit') so there is no data-loss risk.
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function clearUpdateInfoCache() {
  updateInfoCache = null;
}

export { app, clearUpdateInfoCache, resolveOcMirrorArtifactsBaseDir };
