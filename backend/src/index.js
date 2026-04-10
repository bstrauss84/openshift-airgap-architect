/**
 * Backend API: state, Cincinnati, operator scan jobs, YAML generation, export ZIP.
 * Express app; state in SQLite via utils; pull secrets never persisted.
 */
import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import { fetchChannels, fetchPatchesForChannel } from "./cincinnati.js";
import { authAvailable, getCatalogs, getResults, runScanJob } from "./operators.js";
import { resolveOcMirrorBinary, getRuntimeArch, getLocalBinaryArch, getBinariesForExportArch } from "./ocMirrorRuntime.js";
import { db, dataDir } from "./db.js";
import {
  ensureInstaller,
  getAwsAmi,
  getAwsRegions,
  installerPathFor,
  normalizeInstallerArch,
  normalizeInstallerTargetHostOsFamily,
  warmInstallerStream
} from "./installer.js";
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
import {
  buildFeedbackIssueDraft,
  createChallengeToken,
  resolveFeedbackConfig,
  validateFeedbackPayload,
  verifyChallengeToken
} from "./feedback.js";
import { createInMemoryRateLimiter } from "./feedbackRateLimit.js";
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

markStaleJobs();

const getClientAddress = (req) => {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    return fwd.split(",")[0].trim();
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
  if (String(process.env.AIRGAP_RUNTIME_SIDE || "").trim().toLowerCase() === "high-side") {
    return;
  }
  try {
    await fetchChannels(false);
  } catch {
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

const defaultCacheDomainProvenance = () => ({
  source: "unknown",
  timestamp: null,
  originatingApp: {
    gitSha: (process.env.APP_GIT_SHA || "unknown").trim() || "unknown",
    buildTime: (process.env.APP_BUILD_TIME || "unknown").trim() || "unknown"
  },
  originatingProfile: defaultOperationalProfile(),
  releaseScope: null,
  stale: false,
  invalidationReason: null
});

const defaultCacheProvenance = () => ({
  releaseMetadata: defaultCacheDomainProvenance(),
  operatorMetadata: defaultCacheDomainProvenance(),
  docsMetadata: defaultCacheDomainProvenance(),
  awsMetadata: defaultCacheDomainProvenance()
});

const defaultContinuationState = () => ({
  importedRun: false,
  mode: "none",
  sourceProfile: null,
  importedAt: null,
  operatorCacheScope: {
    channel: null,
    patchVersion: null
  },
  locks: {
    releaseMinor: false,
    releasePatch: false,
    operatorSelections: false,
    operatorChannelsPackages: false,
    mirroredAssumptions: false
  }
});

// Mounted Red Hat pull secret — detected at startup, held in memory only, never persisted.
let mountedRhPullSecret = null;

function detectMountedPullSecret() {
  const candidates = [
    process.env.PULL_SECRET_FILE,
    "/run/secrets/pull-secret",
    path.join(dataDir, "pull-secret.json"),
    path.join(process.env.HOME || "/root", ".openshift", "pull-secret"),
  ].filter(Boolean);
  const RH_REGISTRIES = ["registry.redhat.io", "quay.io", "cloud.openshift.com", "registry.connect.redhat.com"];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf8").trim();
      const parsed = JSON.parse(raw);
      if (parsed?.auths && RH_REGISTRIES.some((r) => parsed.auths[r])) {
        mountedRhPullSecret = raw;
        console.log(`[startup] Mounted Red Hat pull secret detected at: ${p}`);
        return;
      }
    } catch { /* continue */ }
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
    exportBinaryArch: null,
    installerTargetHostOsFamily: "rhel9",
    installerTargetArch: "x86_64",
    installerTargetFipsRequired: false,
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
  },
  continuation: defaultContinuationState(),
  cacheProvenance: defaultCacheProvenance(),
  statusModel: {
    continuationLocked: false,
    cacheLimited: false,
    reviewNeeded: false,
    secretsOmitted: true
  },
  runtime: {
    operationalProfile: null
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
    const normalizedContinuation = ensureContinuationShape(next.continuation);
    if (JSON.stringify(normalizedContinuation) !== JSON.stringify(next.continuation || {})) {
      next.continuation = normalizedContinuation;
      changed = true;
    }
    const normalizedProvenance = ensureCacheProvenanceShape(next.cacheProvenance);
    if (JSON.stringify(normalizedProvenance) !== JSON.stringify(next.cacheProvenance || {})) {
      next.cacheProvenance = normalizedProvenance;
      changed = true;
    }
    const nextStatusModel = buildStatusModel(next);
    if (JSON.stringify(nextStatusModel) !== JSON.stringify(next.statusModel || {})) {
      next.statusModel = nextStatusModel;
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
  const merged = withStatusModel({ ...current, ...patch });
  setState(merged);
  return merged;
};

const defaultOperationalProfile = () => {
  const runtimeSide = String(process.env.AIRGAP_RUNTIME_SIDE || "").trim().toLowerCase();
  return runtimeSide === "high-side" ? "disconnected-execution" : "connected-authoring";
};

const resolveOperationalProfile = (state) => {
  return defaultOperationalProfile();
};

const capabilitiesForProfile = (profile) => {
  if (profile === "disconnected-execution") {
    return {
      internetEgressAllowed: false,
      releaseRefreshAllowed: false,
      operatorCatalogRefreshAllowed: false,
      docsRefreshAllowed: false,
      awsLiveLookupAllowed: false,
      binaryDownloadAllowed: false,
      mirrorToDiskAllowed: false,
      mirrorToMirrorAllowed: false,
      diskToMirrorAllowed: true,
      updateCheckAllowed: false,
      feedbackWebActionsAllowed: false,
      highSidePackageExportAllowed: true
    };
  }
  return {
    internetEgressAllowed: true,
    releaseRefreshAllowed: true,
    operatorCatalogRefreshAllowed: true,
    docsRefreshAllowed: true,
    awsLiveLookupAllowed: true,
    binaryDownloadAllowed: true,
    mirrorToDiskAllowed: true,
    mirrorToMirrorAllowed: true,
    diskToMirrorAllowed: true,
    updateCheckAllowed: true,
    feedbackWebActionsAllowed: true,
    highSidePackageExportAllowed: true
  };
};

const getProfileContract = (state) => {
  const profile = resolveOperationalProfile(state);
  return {
    profile,
    capabilities: capabilitiesForProfile(profile),
    source: "runtime-default"
  };
};

const hasCapability = (state, capabilityKey) => {
  const contract = getProfileContract(state);
  return Boolean(contract.capabilities?.[capabilityKey]);
};

const rejectForCapability = (res, state, capabilityKey, actionLabel) => {
  const contract = getProfileContract(state);
  return res.status(403).json({
    error: `${actionLabel} is unavailable in the ${contract.profile} profile.`,
    profile: contract.profile,
    capability: capabilityKey
  });
};

const ensureContinuationShape = (value) => {
  const base = defaultContinuationState();
  const next = { ...(value || {}) };
  next.operatorCacheScope = { ...base.operatorCacheScope, ...(value?.operatorCacheScope || {}) };
  next.locks = { ...base.locks, ...(value?.locks || {}) };
  return { ...base, ...next };
};

const ensureCacheProvenanceShape = (value) => {
  const base = defaultCacheProvenance();
  const input = value || {};
  return {
    releaseMetadata: { ...base.releaseMetadata, ...(input.releaseMetadata || {}) },
    operatorMetadata: { ...base.operatorMetadata, ...(input.operatorMetadata || {}) },
    docsMetadata: { ...base.docsMetadata, ...(input.docsMetadata || {}) },
    awsMetadata: { ...base.awsMetadata, ...(input.awsMetadata || {}) }
  };
};

const isReleaseOutsideOperatorCacheScope = (state) => {
  const continuation = ensureContinuationShape(state?.continuation);
  if (!continuation.importedRun) return false;
  const scopeChannel = continuation.operatorCacheScope?.channel;
  if (!scopeChannel) return false;
  const selectedChannel = state?.release?.channel || null;
  if (!selectedChannel) return false;
  return selectedChannel !== scopeChannel;
};

const buildStatusModel = (state) => {
  const continuation = ensureContinuationShape(state?.continuation);
  const locks = continuation.locks || {};
  const continuationLocked = Boolean(
    locks.releaseMinor ||
    locks.releasePatch ||
    locks.operatorSelections ||
    locks.operatorChannelsPackages ||
    locks.mirroredAssumptions
  );
  const reviewNeeded = Boolean(state?.reviewFlags?.review);
  const secretsOmitted = !(state?.exportOptions?.includeCredentials);
  const cacheLimited = Boolean(
    continuation.importedRun &&
    (continuation.mode === "start-over-from-import" || isReleaseOutsideOperatorCacheScope(state))
  );
  return {
    continuationLocked,
    cacheLimited,
    reviewNeeded,
    secretsOmitted
  };
};

const withStatusModel = (state) => ({
  ...state,
  statusModel: buildStatusModel(state)
});

const withCacheProvenanceUpdate = (state, domain, patch = {}) => {
  const cacheProvenance = ensureCacheProvenanceShape(state?.cacheProvenance);
  const base = cacheProvenance[domain] || defaultCacheDomainProvenance();
  const nextDomain = {
    ...base,
    ...patch,
    timestamp: patch.timestamp ?? Date.now(),
    originatingApp: patch.originatingApp || base.originatingApp || {
      gitSha: (process.env.APP_GIT_SHA || "unknown").trim() || "unknown",
      buildTime: (process.env.APP_BUILD_TIME || "unknown").trim() || "unknown"
    },
    originatingProfile: patch.originatingProfile || resolveOperationalProfile(state)
  };
  return {
    ...state,
    cacheProvenance: {
      ...cacheProvenance,
      [domain]: nextDomain
    }
  };
};

const getContinuationLockViolation = (current, patch) => {
  const locks = ensureContinuationShape(current?.continuation).locks;
  if (!patch || typeof patch !== "object") return null;
  if (locks.releaseMinor && patch.release && Object.prototype.hasOwnProperty.call(patch.release, "channel")) {
    const nextValue = patch.release.channel;
    const currentValue = current?.release?.channel;
    if (nextValue !== currentValue) {
      return "Release minor is locked for continuation mode. Use Start Over to change it.";
    }
  }
  if (locks.releasePatch && patch.release && Object.prototype.hasOwnProperty.call(patch.release, "patchVersion")) {
    const nextValue = patch.release.patchVersion;
    const currentValue = current?.release?.patchVersion;
    if (nextValue !== currentValue) {
      return "Release patch is locked for continuation mode. Use Start Over to change it.";
    }
  }
  if (locks.operatorSelections && patch.operators && Object.prototype.hasOwnProperty.call(patch.operators, "selected")) {
    const nextSelected = JSON.stringify(patch.operators.selected || []);
    const currentSelected = JSON.stringify(current?.operators?.selected || []);
    if (nextSelected !== currentSelected) {
      return "Operator selections are locked for continuation mode. Use Start Over to change them.";
    }
  }
  if (locks.operatorChannelsPackages && patch.operators && Object.prototype.hasOwnProperty.call(patch.operators, "catalogs")) {
    const nextCatalogs = JSON.stringify(patch.operators.catalogs || {});
    const currentCatalogs = JSON.stringify(current?.operators?.catalogs || {});
    if (nextCatalogs !== currentCatalogs) {
      return "Operator channels/packages are locked for continuation mode. Use Start Over to change them.";
    }
  }
  return null;
};

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
  child.stdout.on("data", (data) => { stdout += data.toString(); });
  child.stderr.on("data", (data) => { stderr += data.toString(); });
  child.on("error", (error) => {
    if (error?.code === "ENOENT") {
      return reject(new Error("ssh-keygen is not available in the backend image. Rebuild the backend after installing openssh-client."));
    }
    return reject(error);
  });
  child.on("close", (code) => {
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
  } catch {
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
  const tmpDir = path.join(dataDir, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const keyPath = path.join(tmpDir, `airgap-key-${nanoid()}`);
  const alg = String(algorithm || "ed25519").toLowerCase();
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
  child.stderr.on("data", (data) => { stderr += data.toString(); });
  child.on("error", reject);
  child.on("close", (code) => {
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
  const state = ensureState();
  const feedbackAllowed = hasCapability(state, "feedbackWebActionsAllowed");
  const config = resolveFeedbackConfig();
  res.json({
    enabled: feedbackAllowed ? config.enabled : false,
    visible: feedbackAllowed ? config.visible : false,
    mode: feedbackAllowed ? config.mode : "disabled",
    reason: feedbackAllowed ? config.reason : "Feedback is disabled in high-side/disconnected execution profile.",
    challengeRequired: feedbackAllowed ? config.enabled : false,
    minDwellMs: config.minDwellMs,
    limits: config.limits,
    enums: config.enums,
    githubRepo: config.githubRepo || ""
  });
});

app.get("/api/feedback/challenge", (req, res, next) => currentChallengeLimiter()(req, res, next), (_req, res) => {
  const state = ensureState();
  if (!hasCapability(state, "feedbackWebActionsAllowed")) {
    return rejectForCapability(res, state, "feedbackWebActionsAllowed", "Feedback challenge");
  }
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
  const state = ensureState();
  if (!hasCapability(state, "feedbackWebActionsAllowed")) {
    return rejectForCapability(res, state, "feedbackWebActionsAllowed", "Feedback submission");
  }
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
  const state = ensureState();
  if (!hasCapability(state, "updateCheckAllowed")) {
    const contract = getProfileContract(state);
    return res.json({
      enabled: false,
      currentSha: (process.env.APP_GIT_SHA || "unknown").trim() || "unknown",
      latestSha: null,
      isOutdated: false,
      checkedAt: new Date().toISOString(),
      error: `Update checks are disabled in ${contract.profile}.`,
      branch: (process.env.APP_BRANCH || "main").trim(),
      repo: (process.env.APP_REPO || "bstrauss84/openshift-airgap-architect").trim(),
      profile: contract.profile
    });
  }
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

app.get("/api/profile/capabilities", (_req, res) => {
  const state = ensureState();
  const contract = getProfileContract(state);
  res.json(contract);
});

app.get("/api/state", (req, res) => {
  res.json(withStatusModel(ensureState()));
});

app.post("/api/state", (req, res) => {
  const patch = req.body || {};
  const current = ensureState();
  const lockViolation = getContinuationLockViolation(current, patch);
  if (lockViolation) {
    return res.status(409).json({
      error: lockViolation,
      continuationLocked: true
    });
  }
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
  let merged = updateState(patch);
  const releaseScopeMismatch = isReleaseOutsideOperatorCacheScope(merged);
  if (merged?.operators) {
    const nextOperators = {
      ...merged.operators,
      cacheScopeMismatch: releaseScopeMismatch
    };
    if (JSON.stringify(nextOperators) !== JSON.stringify(merged.operators)) {
      merged = updateState({ operators: nextOperators });
    }
  }
  res.json(withStatusModel(merged));
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
  const current = ensureState();
  const cancelRunningOcMirror = req.body?.cancelRunningOcMirror !== false;
  if (cancelRunningOcMirror) {
    const runningOcMirrorJobs = listJobsByType("oc-mirror-run").filter((job) => job.status === "running");
    for (const job of runningOcMirrorJobs) {
      const proc = activeProcesses.get(job.id);
      if (proc) {
        try {
          proc.kill("SIGTERM");
        } catch {
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
  const continuation = ensureContinuationShape(current.continuation);
  if (continuation.importedRun) {
    const preservedOperators = current.operators || {};
    const preservedDocs = current.docs || {};
    next.operators = {
      ...next.operators,
      catalogs: preservedOperators.catalogs || next.operators.catalogs,
      version: preservedOperators.version || null,
      cachedAt: preservedOperators.cachedAt || null,
      stale: false,
      cacheScopeMismatch: false
    };
    next.docs = {
      ...next.docs,
      links: preservedDocs.links || [],
      connectivity: preservedDocs.connectivity || next.docs.connectivity
    };
    next.cacheProvenance = ensureCacheProvenanceShape(current.cacheProvenance);
    next.continuation = {
      ...continuation,
      mode: "start-over-from-import",
      locks: {
        releaseMinor: false,
        releasePatch: false,
        operatorSelections: false,
        operatorChannelsPackages: false,
        mirroredAssumptions: false
      }
    };
    next.statusModel = buildStatusModel(next);
  }
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
    fs.readdirSync(tmpDir).forEach((file) => safeUnlink(path.join(tmpDir, file)));
  }
  res.json(withStatusModel(next));
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
    sourceProfile: resolveOperationalProfile(state),
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
  let migrated = schemaVersion === 1
    ? { ...defaultState(), ...payload.state, exportOptions: payload.state.exportOptions || defaultState().exportOptions }
    : payload.state;
  if (!migrated.runId) migrated.runId = nanoid();
  if (!migrated.exportOptions) migrated.exportOptions = defaultState().exportOptions;
  if (migrated.operators) {
    const expectedVersion = migrated.release?.channel || null;
    if (migrated.operators.version && migrated.operators.version !== expectedVersion) {
      migrated.operators.stale = true;
    }
  }
  const importedAt = new Date().toISOString();
  const importedReleaseChannel = migrated.release?.channel || migrated.operators?.version || null;
  migrated.continuation = {
    importedRun: true,
    mode: "continue-imported",
    sourceProfile: payload.sourceProfile || "connected-authoring",
    importedAt,
    operatorCacheScope: {
      channel: importedReleaseChannel,
      patchVersion: migrated.release?.patchVersion || null
    },
    locks: {
      releaseMinor: true,
      releasePatch: true,
      operatorSelections: true,
      operatorChannelsPackages: true,
      mirroredAssumptions: true
    }
  };
  migrated.operators = {
    ...(migrated.operators || {}),
    cacheScopeMismatch: false
  };
  migrated.cacheProvenance = ensureCacheProvenanceShape(migrated.cacheProvenance);
  migrated = withCacheProvenanceUpdate(migrated, "releaseMetadata", {
    source: "imported",
    releaseScope: importedReleaseChannel
  });
  migrated = withCacheProvenanceUpdate(migrated, "operatorMetadata", {
    source: "imported",
    releaseScope: migrated.operators?.version || importedReleaseChannel
  });
  migrated = withCacheProvenanceUpdate(migrated, "docsMetadata", {
    source: "imported",
    releaseScope: importedReleaseChannel
  });
  migrated = withCacheProvenanceUpdate(migrated, "awsMetadata", {
    source: "imported",
    releaseScope: importedReleaseChannel
  });
  const sanitized = sanitizeStateForExport(migrated, { ...(migrated.exportOptions || {}), includeCredentials: false });
  sanitized.statusModel = buildStatusModel(sanitized);
  setState(sanitized);
  res.json({ ok: true, state: withStatusModel(sanitized) });
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
    const state = ensureState();
    const channels = await fetchChannels(false);
    updateState({
      cacheProvenance: withCacheProvenanceUpdate(state, "releaseMetadata", {
        source: "cached",
        releaseScope: "channels",
        stale: false,
        invalidationReason: null
      }).cacheProvenance
    });
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/cincinnati/update", async (req, res) => {
  const state = ensureState();
  if (!hasCapability(state, "releaseRefreshAllowed")) {
    return rejectForCapability(res, state, "releaseRefreshAllowed", "Release channel refresh");
  }
  try {
    const channels = await fetchChannels(true);
    updateState({
      cacheProvenance: withCacheProvenanceUpdate(state, "releaseMetadata", {
        source: "live",
        releaseScope: "channels",
        stale: false,
        invalidationReason: null
      }).cacheProvenance
    });
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/cincinnati/patches", async (req, res) => {
  try {
    const state = ensureState();
    const channel = req.query.channel;
    const versions = await fetchPatchesForChannel(channel, false);
    updateState({
      cacheProvenance: withCacheProvenanceUpdate(state, "releaseMetadata", {
        source: "cached",
        releaseScope: channel || null,
        stale: false,
        invalidationReason: null
      }).cacheProvenance
    });
    res.json({ versions });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/cincinnati/patches/update", async (req, res) => {
  const state = ensureState();
  if (!hasCapability(state, "releaseRefreshAllowed")) {
    return rejectForCapability(res, state, "releaseRefreshAllowed", "Release patch refresh");
  }
  try {
    const channel = req.body.channel;
    const versions = await fetchPatchesForChannel(channel, true);
    updateState({
      cacheProvenance: withCacheProvenanceUpdate(state, "releaseMetadata", {
        source: "live",
        releaseScope: channel || null,
        stale: false,
        invalidationReason: null
      }).cacheProvenance
    });
    res.json({ versions });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
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

app.post("/api/operators/scan", async (req, res) => {
  // Do not log req.body; it may contain pullSecret. Do not persist pullSecret.
  const state = ensureState();
  if (!hasCapability(state, "operatorCatalogRefreshAllowed")) {
    return rejectForCapability(res, state, "operatorCatalogRefreshAllowed", "Operator catalog refresh");
  }
  if (!state.release?.confirmed) {
    return res.status(400).json({ error: "Version not confirmed." });
  }
  if (!authAvailable() && !req.body?.pullSecret && String(process.env.MOCK_MODE).toLowerCase() !== "true") {
    return res.status(400).json({ error: "Registry auth not configured." });
  }
  if (String(process.env.MOCK_MODE).toLowerCase() === "true") {
    const version = state.release?.channel;
    const jobs = {};
    for (const catalog of getCatalogs()) {
      const jobId = createJob("operator-scan", `Mock scan ${catalog.id}`);
      const file = path.join(process.cwd(), "mock-data", `operators-${catalog.id}-${version}.json`);
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        dbPrepareMockStore(version, catalog.id, data.results);
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
  const version = state.release?.channel;
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
      version,
      catalogId: catalog.id,
      catalogImage: catalog.image(version),
      authFile: tempAuthFile,
      jobType: "operator-scan",
      ocMirrorPath: resolved.path
    });
    jobs[catalog.id] = jobId;
  }
  updateState({
    cacheProvenance: withCacheProvenanceUpdate(state, "operatorMetadata", {
      source: "live",
      releaseScope: version || null,
      stale: false,
      invalidationReason: null
    }).cacheProvenance
  });
  res.json({ jobs });
});

app.post("/api/operators/prefetch", async (req, res) => {
  const state = ensureState();
  if (!hasCapability(state, "operatorCatalogRefreshAllowed")) {
    return rejectForCapability(res, state, "operatorCatalogRefreshAllowed", "Operator catalog prefetch");
  }
  if (!state.release?.confirmed) {
    return res.status(400).json({ error: "Version not confirmed." });
  }
  if (!authAvailable()) {
    return res.status(400).json({ error: "Registry auth not configured." });
  }
  const version = state.release?.channel;
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
      version,
      catalogId: catalog.id,
      catalogImage: catalog.image(version),
      jobType: "operator-prefetch",
      message: `Prefetching ${catalog.id} operators...`,
      ocMirrorPath: resolved.path
    });
    jobs[catalog.id] = jobId;
  }
  updateState({
    cacheProvenance: withCacheProvenanceUpdate(state, "operatorMetadata", {
      source: "live",
      releaseScope: version || null,
      stale: false,
      invalidationReason: null
    }).cacheProvenance
  });
  res.json({ jobs });
});

app.get("/api/operators/status", (req, res) => {
  const state = ensureState();
  const version = req.query.version;
  const response = {};
  for (const catalog of getCatalogs()) {
    const cached = getResults(version, catalog.id);
    response[catalog.id] = cached || { results: [], updatedAt: null };
  }
  updateState({
    cacheProvenance: withCacheProvenanceUpdate(state, "operatorMetadata", {
      source: "cached",
      releaseScope: version || null,
      stale: false,
      invalidationReason: null
    }).cacheProvenance
  });
  res.json(response);
});

app.get("/api/runtime-info", async (req, res) => {
  try {
    await resolveOcMirrorBinary(dataDir);
  } catch (e) {
    // ignore; we still return arch info
  }
  res.json({
    runtimeArch: getRuntimeArch(),
    localBinaryArch: getLocalBinaryArch()
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

app.post("/api/system/path-check", async (req, res) => {
  const target = req.body?.path;
  const minBytes = Number(req.body?.minBytes || 0);
  if (!target) return res.status(400).json({ error: "Path is required." });
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

app.post("/api/ssh/keypair", async (req, res) => {
  try {
    const algorithm = req.body?.algorithm || "ed25519";
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
  } catch {
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

app.post("/api/ocmirror/preflight", async (req, res) => {
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
      blockers.push("Archive path is required.");
      return;
    }
    if (!archivePath) return;
    try {
      const info = await checkPath(archivePath);
      const meetsMin = !minBytes || info.freeBytes >= minBytes;
      if (mode === "mirrorToDisk") {
        if (!info.writable) blockers.push("Archive path is not writable.");
        if (!meetsMin) blockers.push("Insufficient disk space at archive path.");
        checks.archivePath = {
          exists: info.exists,
          writable: info.writable,
          freeBytes: info.freeBytes,
          meetsMin,
          structure: "ok"
        };
      } else if (mode === "diskToMirror") {
        if (!info.exists) blockers.push("Source archive path does not exist.");
        const structure = checkD2mArchiveStructure(archivePath);
        if (structure === "invalid") {
          blockers.push("Source archive path must contain oc-mirror output (working-dir or tar files).");
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
      blockers.push(`Archive path check failed: ${String(err?.message || err)}.`);
    }
  };

  const checkWorkspace = async () => {
    if (!workspacePath) {
      if (mode === "mirrorToMirror") blockers.push("Workspace path is required.");
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
      } catch {}
      if (!info.exists && !creatable) blockers.push("Workspace path is not creatable or writable.");
      if (info.exists && !info.writable) blockers.push("Workspace path is not writable.");
      const meetsMin = !minBytes || freeBytes >= minBytes;
      if (minBytes && !meetsMin) warnings.push("Low disk space at workspace path.");
      if (info.exists && fs.existsSync(path.join(path.resolve(workspacePath), "working-dir"))) {
        warnings.push("Workspace already contains oc-mirror data.");
      }
      checks.workspacePath = {
        exists: info.exists,
        creatable: creatable || info.writable,
        writable: info.exists ? info.writable : writable,
        freeBytes: freeBytes || info.freeBytes
      };
    } catch (err) {
      blockers.push(`Workspace path check failed: ${String(err?.message || err)}.`);
    }
  };

  const checkCache = async () => {
    if (mode === "mirrorToMirror") {
      checks.cachePath = null;
      return;
    }
    if (!cachePath && (mode === "mirrorToDisk" || mode === "diskToMirror")) {
      blockers.push("Cache path is required.");
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
      } catch {}
      if (!info.exists && !creatable) blockers.push("Cache path is not creatable or writable.");
      if (info.exists && !info.writable) blockers.push("Cache path is not writable.");
      checks.cachePath = {
        exists: info.exists,
        creatable: creatable || info.writable,
        writable: info.exists ? info.writable : writable
      };
    } catch (err) {
      blockers.push(`Cache path check failed: ${String(err?.message || err)}.`);
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
        blockers.push("Config file not found.");
      }
    } catch {
      checks.config = "missing";
      blockers.push("Config file not found.");
    }
  } else {
    blockers.push("Config path is required when using external config.");
  }

  // Auth checks per mode
  if (mode === "mirrorToDisk" || mode === "mirrorToMirror") {
    if (rhPullSecret && typeof rhPullSecret === "string" && rhPullSecret.trim().length > 0) {
      checks.auth = "present";
    } else {
      checks.auth = "missing";
      warnings.push("Red Hat pull secret is required to pull from registry.redhat.io / quay.io.");
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
          warnings.push("Mirror registry credentials in Identity & Access do not appear to be valid JSON.");
        }
      } else {
        warnings.push("Mirror registry credentials not found in Identity & Access.");
      }
    } else if (mirrorPullSecret && typeof mirrorPullSecret === "string" && mirrorPullSecret.trim().length > 0) {
      mirrorSecretPresent = true;
    } else {
      warnings.push("Mirror registry credentials will be required at run time.");
    }
    if (mode === "diskToMirror") checks.auth = mirrorSecretPresent ? "present" : "missing";
    else if (!mirrorSecretPresent) checks.auth = "missing";
  }

  if (mode === "diskToMirror" || mode === "mirrorToMirror") {
    checks.registryUrl = registryUrl ? "non-empty" : "empty";
    if (!registryUrl) blockers.push("Registry URL is required for this mode.");
  }

  const ok = blockers.length === 0;
  res.json({ ok, blockers, warnings, checks });
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

app.post("/api/ocmirror/run", async (req, res) => {
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
  if (mode === "mirrorToDisk" && !hasCapability(state, "mirrorToDiskAllowed")) {
    return rejectForCapability(res, state, "mirrorToDiskAllowed", "Mirror-to-disk workflow");
  }
  if (mode === "mirrorToMirror" && !hasCapability(state, "mirrorToMirrorAllowed")) {
    return rejectForCapability(res, state, "mirrorToMirrorAllowed", "Mirror-to-mirror workflow");
  }
  if (mode === "diskToMirror" && !hasCapability(state, "diskToMirrorAllowed")) {
    return rejectForCapability(res, state, "diskToMirrorAllowed", "Disk-to-mirror workflow");
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
  const version = state.release?.channel ? `4.${state.release.channel.split(".")[1]}` : "4.0";
  const key = docsKey(version, state.blueprint?.platform, state.methodology?.method, state.docs?.connectivity);
  const cached = getDocsFromCache(key);
  updateState({
    cacheProvenance: withCacheProvenanceUpdate(state, "docsMetadata", {
      source: "cached",
      releaseScope: state.release?.channel || null,
      stale: !Boolean(cached?.links?.length),
      invalidationReason: cached?.links?.length ? null : "missing_docs_cache"
    }).cacheProvenance
  });
  res.json({ cached });
});

app.post("/api/docs/update", async (req, res) => {
  const state = ensureState();
  if (!hasCapability(state, "docsRefreshAllowed")) {
    return rejectForCapability(res, state, "docsRefreshAllowed", "Documentation refresh");
  }
  const version = state.release?.channel ? `4.${state.release.channel.split(".")[1]}` : "4.0";
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
  updateState({
    cacheProvenance: withCacheProvenanceUpdate(state, "docsMetadata", {
      source: "live",
      releaseScope: state.release?.channel || null,
      stale: false,
      invalidationReason: null
    }).cacheProvenance
  });
  res.json({ jobId: job.jobId, links: job.validated });
});

app.post("/api/aws/warm-installer", (req, res) => {
  const state = ensureState();
  if (!hasCapability(state, "awsLiveLookupAllowed")) {
    return rejectForCapability(res, state, "awsLiveLookupAllowed", "AWS metadata warmup");
  }
  const version = req.body?.version || req.query.version;
  if (!version) {
    return res.status(400).json({ error: "Version is required." });
  }
  warmInstallerStream(version);
  res.status(202).json({ status: "started", version });
});

app.get("/api/aws/regions", async (req, res) => {
  const state = ensureState();
  if (!hasCapability(state, "awsLiveLookupAllowed")) {
    return rejectForCapability(res, state, "awsLiveLookupAllowed", "AWS regions lookup");
  }
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
    updateState({
      cacheProvenance: withCacheProvenanceUpdate(state, "awsMetadata", {
        source: force ? "live" : "cached",
        releaseScope: version,
        stale: false,
        invalidationReason: null
      }).cacheProvenance
    });
    res.json({ version, arch, regions });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/aws/ami", async (req, res) => {
  const state = ensureState();
  if (!hasCapability(state, "awsLiveLookupAllowed")) {
    return rejectForCapability(res, state, "awsLiveLookupAllowed", "AWS AMI lookup");
  }
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
    updateState({
      cacheProvenance: withCacheProvenanceUpdate(state, "awsMetadata", {
        source: force ? "live" : "cached",
        releaseScope: version,
        stale: false,
        invalidationReason: null
      }).cacheProvenance
    });
    res.json({ version, arch, region, ami });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

const sanitizeStateForArtifactGeneration = (state) => {
  const next = JSON.parse(JSON.stringify(state || {}));
  if (next.exportOptions?.includeCertificates === false && next.trust) {
    next.trust.mirrorRegistryCaPem = "";
    next.trust.proxyCaPem = "";
    next.trust.additionalTrustBundlePolicy = "";
  }
  return next;
};

const detectPlaceholderUsage = (state) => {
  const hi = state?.hostInventory || {};
  if (state?.methodology?.placeholderValuesEnabled) return true;
  const tokenRe = /\{\{[^}]+\}\}/;
  const scan = (value) => {
    if (value == null) return false;
    if (typeof value === "string") return tokenRe.test(value);
    if (Array.isArray(value)) return value.some(scan);
    if (typeof value === "object") return Object.values(value).some(scan);
    return false;
  };
  return scan(hi.nodes) || scan(hi);
};

const buildExportReadinessManifest = (state) => {
  const contract = getProfileContract(state);
  const exportOptions = state.exportOptions || {};
  const includeCredentials = Boolean(exportOptions.includeCredentials);
  const includeCertificates = exportOptions.includeCertificates !== false;
  const includeClientTools = Boolean(exportOptions.includeClientTools);
  const includeInstaller = Boolean(exportOptions.includeInstaller);
  const installerTargetHostOsFamily = normalizeInstallerTargetHostOsFamily(exportOptions.installerTargetHostOsFamily || "rhel9");
  const profile = contract.profile;
  const hasOperatorCache = Boolean(
    (state.operators?.catalogs?.redhat || []).length ||
    (state.operators?.catalogs?.certified || []).length ||
    (state.operators?.catalogs?.community || []).length
  );
  const hasDocsCache = Boolean((state.docs?.links || []).length);
  const installerTargetArch = normalizeInstallerArch(exportOptions.installerTargetArch || "x86_64");
  const statusModel = buildStatusModel(state);
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    app: {
      gitSha: (process.env.APP_GIT_SHA || "unknown").trim() || "unknown",
      buildTime: (process.env.APP_BUILD_TIME || "unknown").trim() || "unknown",
      branch: (process.env.APP_BRANCH || "main").trim() || "main"
    },
    sourceProfile: profile,
    targetProfile: "disconnected-execution",
    capabilities: contract.capabilities,
    includedCaches: {
      releaseMetadata: Boolean(state.release?.channel && state.release?.patchVersion),
      operatorMetadata: hasOperatorCache,
      docsMetadata: hasDocsCache,
      awsMetadata: false
    },
    includedTools: {
      ocClient: includeClientTools,
      ocMirror: includeClientTools,
      openshiftInstall: includeInstaller,
      installerTargetHostOsFamily,
      installerTargetArch,
      installerTargetFipsRequired: Boolean(exportOptions.installerTargetFipsRequired),
      installerPackagingPolicy: {
        validatedTargetHostOsFamilies: ["rhel8", "rhel9"],
        validatedTargetArchitectures: ["x86_64"],
        fipsAwareSelection: "validated-input",
        artifactVariantByHostOsOrFips: false,
        notes: "openshift-install artifact selection is version+architecture based in this release; host OS family and FIPS inputs are validated and recorded."
      }
    },
    runtimePackageIncluded: false,
    placeholdersPresent: detectPlaceholderUsage(state),
    secrets: {
      pullSecret: includeCredentials ? "included" : "omitted",
      platformCredentials: includeCredentials ? "included" : "omitted",
      mirrorRegistryCredentials: includeCredentials ? "included" : "omitted",
      bmcCredentials: includeCredentials ? "included" : "omitted",
      trustBundleAndCertificates: includeCertificates ? "included" : "omitted",
      sshPublicKey: "included",
      proxyValues: "included"
    },
    staleDataWarnings: {
      operatorsStale: Boolean(state.operators?.stale),
      docsLinksMissing: !hasDocsCache,
      operatorCacheScopeMismatch: Boolean(state.operators?.cacheScopeMismatch)
    },
    continuationReady: Boolean(
      state.continuation?.mode === "continue-imported" ||
      (state.blueprint?.confirmed && (state.version?.versionConfirmed ?? state.release?.confirmed))
    ),
    mirrorPayloadNotIncluded: true,
    runStatus: statusModel,
    diskToMirrorReady: Boolean(
      state.mirrorWorkflow?.archivePath &&
      state.mirrorWorkflow?.lastRunJobId
    ),
    lockedSelections: {
      releaseMinor: state.release?.channel || null,
      releasePatch: state.release?.patchVersion || null,
      operatorSelectionsLocked: Boolean(state.blueprint?.confirmed && (state.version?.versionConfirmed ?? state.release?.confirmed))
    },
    notes: [
      "High-side runtime package archive is not included in this transfer bundle.",
      "oc-mirror payload transfer remains explicit and separate from app transfer artifacts.",
      "Legacy mirror-output bundling is deprecated for transfer bundles; use handoff doc/manifest/log/support bundle outputs."
    ]
  };
  return manifest;
};

const buildPreviewFiles = (rawState) => {
  const state = sanitizeStateForArtifactGeneration(rawState);
  const confirmed = state.version?.versionConfirmed ?? state.release?.confirmed;
  if (!confirmed) return null;
  const version = state.release?.channel ? `4.${state.release.channel.split(".")[1]}` : "4.0";
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
  const bodyState = req.body?.state;
  const state = bodyState && typeof bodyState === "object" ? bodyState : ensureState();
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

const buildBundleZip = async (rawState, res) => {
  const state = sanitizeStateForArtifactGeneration(rawState);
  const confirmed = state.version?.versionConfirmed ?? state.release?.confirmed;
  if (!confirmed) {
    res.status(400).json({ error: "Version not confirmed." });
    return;
  }
  const version = state.release?.channel ? `4.${state.release.channel.split(".")[1]}` : "4.0";
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
  const readinessManifest = buildExportReadinessManifest(state);

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
  archive.append(JSON.stringify(readinessManifest, null, 2), { name: "EXPORT_READINESS_MANIFEST.json" });
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
    if (!hasCapability(state, "binaryDownloadAllowed")) {
      archive.append(
        `Client tool download is disabled in profile ${resolveOperationalProfile(state)}.\n`,
        { name: "tools/oc-mirror.ERROR.txt" }
      );
    } else {
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
  }
  if (state.exportOptions?.includeInstaller) {
    if (!hasCapability(state, "binaryDownloadAllowed")) {
      archive.append(
        `Installer download is disabled in profile ${resolveOperationalProfile(state)}.\n`,
        { name: "tools/openshift-install.ERROR.txt" }
      );
    } else {
      try {
        const version = state.release?.patchVersion;
        if (!version) {
          throw new Error("Version not selected.");
        }
        const targetHostOsFamily = normalizeInstallerTargetHostOsFamily(
          state.exportOptions?.installerTargetHostOsFamily || "rhel9"
        );
        const targetHostFipsRequired = Boolean(state.exportOptions?.installerTargetFipsRequired);
        const targetArch = normalizeInstallerArch(state.exportOptions?.installerTargetArch || "x86_64");
        await ensureInstaller(version, {
          arch: targetArch,
          osFamily: targetHostOsFamily,
          fipsRequired: targetHostFipsRequired
        });
        const installerPath = installerPathFor(version, targetArch);
        if (fs.existsSync(installerPath)) {
          archive.file(installerPath, { name: "tools/openshift-install" });
        }
      } catch (error) {
        archive.append(
          `Failed to include openshift-install: ${String(error?.message || error)}\n`,
          { name: "tools/openshift-install.ERROR.txt" }
        );
      }
    }
  }
  const mirrorOutputPath = state.mirrorWorkflow?.archivePath || state.mirrorWorkflow?.outputPath;
  if (state.mirrorWorkflow?.includeInExport && mirrorOutputPath) {
    archive.append(
      [
        "Mirror payload bundling is intentionally disabled for transfer bundles in this release.",
        "Use Run oc-mirror handoff downloads (doc/manifest/log/support bundle) and transfer archive/workspace paths explicitly.",
        `Requested mirror output path: ${String(mirrorOutputPath)}`
      ].join("\n") + "\n",
      { name: "mirror-output/MIRROR_OUTPUT_NOT_INCLUDED.txt" }
    );
  }
  archive.finalize();
};

app.get("/api/fs/ls", (req, res) => {
  const reqPath = (req.query.path || "/").toString();
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
      } catch {
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
  const bodyState = req.body?.state;
  const state = bodyState && typeof bodyState === "object" ? bodyState : ensureState();
  purgeExpiredBundleStates();
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
  let state = null;
  if (token) {
    const pending = pendingBundleStates.get(token);
    if (!pending || Date.now() >= pending.expiresAt) {
      return res.status(410).json({ error: "Bundle token expired. Regenerate and retry download." });
    }
    state = pending.state;
  }
  if (!state) state = ensureState();
  try {
    await buildBundleZip(state, res);
  } catch (error) {
    return handleBundleZipError(res, error);
  }
});

app.post("/api/bundle.zip", async (req, res) => {
  const bodyState = req.body?.state;
  const state = bodyState && typeof bodyState === "object" ? bodyState : ensureState();
  try {
    await buildBundleZip(state, res);
  } catch (error) {
    return handleBundleZipError(res, error);
  }
});

let server;
if (process.env.NODE_ENV !== "test") {
  server = app.listen(port, () => {
    console.log(`Backend listening on ${port}`);
  });
  const shutdown = (signal) => {
    console.log(`Received ${signal}, shutting down...`);
    // Kill any active child processes (oc-mirror runs, scan jobs).
    for (const [, child] of activeProcesses.entries()) {
      try { child.kill("SIGTERM"); } catch {}
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

export { app, buildExportReadinessManifest, clearUpdateInfoCache, resolveOcMirrorArtifactsBaseDir };
