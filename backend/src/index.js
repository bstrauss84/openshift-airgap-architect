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
import { installAccessControl } from "./accessControl.js";
import fs from "node:fs";
import path from "node:path";
import { ZipArchive } from "archiver";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import logger from "./logger.js";
import { loggingMiddleware } from "./middleware/logging.js";
import { metricsMiddleware } from "./middleware/metrics.js";
import { getMetrics, getMetricsContentType } from "./metrics.js";
import { fetchChannels, fetchPatchesForChannel } from "./cincinnati.js";
import { runCincinnatiBackgroundJob } from "./cincinnatiJob.js";
import { authAvailable, getCatalogs, getResults, runScanJob, createSharedAuthRelease } from "./operators.js";
import { resolveOcMirrorBinary, getRuntimeArch, getLocalBinaryArch, getBinariesForExportArch } from "./ocMirrorRuntime.js";
import { db, dataDir } from "./db.js";
import { ensureInstaller, getAwsAmi, getAwsRegions, installerPathFor, warmInstallerStream } from "./installer.js";
import { ensureOpenshiftInstaller } from "./openshiftInstaller.js";
import { acquireVerifiedArtifact } from "./verifiedDownload.js";
import {
  getState,
  setState,
  markStaleJobs,
  getJob,
  getJobMetadata,
  listJobs,
  listJobsByType,
  deleteCompletedJobs,
  cleanupOldJobs,
  getJobsCount,
  writeTempAuth,
  mergePullSecrets,
  safeUnlink,
  createJob,
  updateJob,
  updateJobUnlessTerminal,
  updateJobMetadata,
  appendJobOutput
} from "./utils.js";
import { buildAgentConfig, buildFieldManual, buildImageSetConfig, buildInstallConfig, buildNtpMachineConfigs } from "./generate.js";
import { docsKey, getDocsFromCache, storeDocs, updateDocsLinks } from "./docs.js";
import { applyProxyValueInclusion } from "./exportInclusion.js";
import { migrateStateToV3, isStateV3 } from "../../shared/stateMigration.js";
import { validateBmcVerifyCA } from "../../shared/bmcVerifyCA.js";
import { buildUpdateInfo } from "./releaseUpdateCheck.js";
import { createRuntimePackageArtifacts } from "./runtimePackage.js";
import { getOpenShiftMinorFromState, getOpenShiftMinorFromSources } from "./openShiftMinor.js";
import { assertSupportedOpenShiftMinorForGeneration, isSupportedMinor, buildUnsupportedVersionError } from "./versionPolicy.js";
// validateArchiveBuffer and ZIP_LIMITS are intentionally not imported here: the
// only route that used them was the withdrawn /api/bundle.import (see below).
// They remain exported from exportIntegrity.js for its own unit tests and for
// the eventual DOC-127 validator UI.
import { createIntegrityTracker, MANIFEST_FILENAME } from "./exportIntegrity.js";
import { trackTempArtifact, untrackTempArtifact, releaseAllTempArtifacts } from "./tempArtifacts.js";
import { createShutdownHandler } from "./shutdown.js";
import { activeProcesses } from "./processRegistry.js";
import { sanitizeStateForPersistence, sanitizeCredentialFields, stripProxyCredentials } from "./stateSanitizer.js";
import { assertExportableMirrorOutput, MirrorOutputPolicyError } from "./mirrorOutputPolicy.js";
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
  cincinnatiRefreshSchema,
  operatorConfirmSchema,
  startOverSchema,
  bundlePrepareSchema,
  runImportSchema,
  runDuplicateSchema,
  cincinnatiUpdateSchema,
  operatorsPrefetchSchema,
  jobStopSchema,
  docsUpdateSchema,
  awsWarmInstallerSchema,
  trustAnalyzeSchema,
  bundleZipSchema,
  generateSchema,
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
import { validateAllFiles } from "./yamlValidator.js";
import { detectScenarioId } from "./catalogValidator.js";
import { assertCanonicalDataAvailable } from "./canonicalDataIntegrity.js";

const app = express();
const port = process.env.PORT || 4000;

// API access control boundary: origin allowlist, CSRF defence, identity.
//
// This REPLACES `app.use(cors())`, which sent `Access-Control-Allow-Origin: *`
// on every response and so let arbitrary cross-origin JavaScript both invoke
// and READ every route — including GET /api/generate, which renders the pull
// secret, and POST /api/ssh/keypair, which returns a private key.
//
// Installed first, before the withdrawn-endpoint handler and the body parser,
// because a forbidden origin or a missing identity must be refused before any
// request body is read or any handler runs. See backend/src/accessControl.js
// for why there are three layers and why none of them is sufficient alone.
//
// Startup fails closed on an incoherent or dangerous configuration — notably
// OAA_AUTH_MODE=disabled bound to anything other than loopback, and
// OAA_AUTH_MODE=proxy without a shared secret.
const accessControlConfig = installAccessControl(app);

// POST /api/bundle.import is WITHDRAWN in v2.1. See DOC-127.
//
// The endpoint was an unauthenticated archive validator. It was the only
// ingress that escaped the 10 MB JSON cap (it accepted 512 MiB), and
// validateArchiveBuffer inflates every entry into memory, CRC32s it in a
// per-byte JS loop and SHA-256s it again — all synchronously, with no
// concurrency cap. A small compressed body therefore bought ~1 GiB of RSS and
// seconds of blocked event loop, which starved the /api/health liveness probe.
// No frontend, CLI, e2e test or documented workflow ever called it, so the
// whole surface was a liability with no user.
//
// This handler MUST stay here — after the access-control boundary, before
// express.json() below —
// and MUST remain terminal (never call next()). It replies without reading the
// request body, so no bytes are buffered, inflated or hashed; Node drains the
// unread remainder in streaming fashion when the response finishes. Moving it
// below a body parser, or restoring the old handlers, reopens the DoS.
//
// app.all, not app.post, so no other verb can reach a differently-shaped path.
// 410 rather than 404: a 404 here is indistinguishable from a routing or
// reverse-proxy misconfiguration during incident triage, and Express's default
// 404 would emit HTML, breaking the JSON error contract every other route
// keeps. The endpoint is already named in published docs, so 410 leaks nothing.
//
// The validator itself (exportIntegrity.js) is deliberately NOT deleted: the
// export path shares it, and DOC-127 will reintroduce validation behind a real
// UI. Its unit tests stay green as the regression net for that future work.
// Before any such reintroduction the resource limits must come down and gain a
// compression-ratio cap and a concurrency bound — see the Findings Queue.
app.all("/api/bundle.import", (req, res) => {
  res.status(410).json({
    error: "The bundle validation endpoint has been withdrawn.",
    code: "ENDPOINT_WITHDRAWN"
  });
});

app.use(express.json({ limit: "10mb" }));

// Structured request logging middleware (skip in test mode)
if (process.env.NODE_ENV !== "test") {
  app.use(loggingMiddleware);
}

// Prometheus metrics middleware (records HTTP request duration and counts)
if (process.env.NODE_ENV !== "test") {
  app.use(metricsMiddleware);
}

markStaleJobs();

/**
 * Collect temporary artifacts a previous run left behind.
 *
 * The shutdown sequence releases everything this process owns, but it only
 * runs for SIGTERM/SIGINT. A SIGKILL — which is what the compose profile
 * delivers if an export is mid-`podman save`, and what an OOM or a host loss
 * delivers always — leaves registry pull secrets, ssh key material,
 * registries.d directories and generated imageset configs on the /data
 * volume indefinitely. `markStaleJobs()` above reconciles the job rows; this
 * reconciles the files, and it is the only thing that ever retries an
 * artifact whose removal failed during a previous shutdown.
 *
 * Boot is the one moment when nothing of ours is in flight, so this is safe
 * by construction. Scoped to DATA_DIR/tmp and to our own filename prefixes on
 * purpose: DATA_DIR is single-instance (one SQLite writer), whereas
 * os.tmpdir() is shared, and sweeping that by pattern could destroy a
 * concurrent process's live staging. The temp-artifact registry makes the
 * same promise for the same reason.
 */
const OWNED_TEMP_PREFIXES = /^(registry-auth-|airgap-key-|registries\.d-|imageset-)/;
const sweepAbandonedTempArtifacts = () => {
  const tmpDir = path.join(dataDir, "tmp");
  let removed = 0;
  let failed = 0;
  try {
    if (!fs.existsSync(tmpDir)) return;
    for (const name of fs.readdirSync(tmpDir)) {
      if (!OWNED_TEMP_PREFIXES.test(name)) continue;
      try {
        fs.rmSync(path.join(tmpDir, name), { recursive: true, force: true });
        removed += 1;
      } catch (err) {
        failed += 1;
        logger.warn({ err, tag: "startup", name }, "Abandoned temp artifact could not be removed");
      }
    }
  } catch (err) {
    logger.warn({ err, tag: "startup" }, "Abandoned temp artifact sweep failed");
    return;
  }
  if (removed > 0 || failed > 0) {
    logger.info({ tag: "startup", removed, failed }, "Swept temp artifacts from a previous run");
  }
};

sweepAbandonedTempArtifacts();

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
    logger.debug({ err }, "Cincinnati cache warm failed");
    // ignore warm cache errors
  }
};

warmCincinnatiCache();

// Architectures Red Hat actually publishes mirror-registry for. There is no
// arm64/aarch64 build: /pub/cgw/mirror-registry/latest/mirror-registry-arm64.tar.gz
// and -aarch64 both answer 404 (verified 2026-10-16), while amd64, ppc64le and
// s390x answer 200 and are the three entries in the published sha256sum.txt.
const MIRROR_REGISTRY_ARCHES = Object.freeze(["amd64", "ppc64le", "s390x"]);

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
        logger.info({ tag: "startup", path: p }, "Mounted Red Hat pull secret detected");
        return;
      }
    } catch (err) {
      logger.debug({ err, path: p }, "Pull secret check failed");
      /* continue */
    }
  }
}
detectMountedPullSecret();

function logFeedbackStartupStatus() {
  const config = resolveFeedbackConfig();
  if (config.mode === "disabled") {
    if (config.selectedMode && config.selectedMode !== "disabled") {
      logger.warn({ tag: "startup", selectedMode: config.selectedMode, reason: config.reason }, "Feedback disabled due to configuration");
      return;
    }
    logger.info({ tag: "startup" }, "Feedback mode disabled");
    return;
  }
  logger.info({ tag: "startup", mode: config.mode }, "Feedback mode enabled");
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
      clusterNetworkCidrV6: "fd01::/48",
      clusterNetworkHostPrefixV6: 64,
      serviceNetworkCidr: "172.30.0.0/16",
      serviceNetworkCidrV6: "fd02::/112"
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
      baseDomainResourceGroupName: "",
      vnetMode: "installer-managed",
      virtualNetwork: "",
      networkResourceGroupName: "",
      controlPlaneSubnet: "",
      nodeSubnets: []
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
    schemaVersion: 3,
    ipStackMode: 'ipv4',
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
    // DOC-101 Phase 1 Slice 4: Trust defaults only - NO migration here
    // Migration happens at explicit boundaries: POST /api/state, import, export, generate
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

/**
 * Normalizes incoming release.channel in partial state updates.
 *
 * CRITICAL SEMANTICS:
 * - Explicit incoming channel values (even stable-4.20) must be preserved and normalized to their own minor.
 * - Only OMITTED or empty incoming channels should be backfilled from other sources.
 * - Persisted canonical version.selectedMinor must NOT overwrite an explicit incoming legacy channel update.
 *
 * Normalization rules:
 * - If incoming channel is explicit (present in patch), normalize stable-* prefix to minor-only.
 * - If incoming channel is omitted or empty, backfill from patchVersion or selectedVersion in the patch.
 * - Do NOT backfill from persisted state during normalization (migration handles cross-state precedence).
 *
 * @param {object} patch - Incoming partial state update
 */
function applyReleaseChannelNormalization(patch) {
  if (!patch?.release || typeof patch.release !== "object") return;

  const incomingChannel = patch.release.channel;
  const hasExplicitChannel = "channel" in patch.release;

  // Case 1: Explicit incoming channel (including null) - normalize stable-* prefix only
  if (hasExplicitChannel && incomingChannel !== null && incomingChannel !== undefined && incomingChannel !== "") {
    const channelStr = String(incomingChannel).trim();
    if (channelStr && channelStr.toLowerCase() !== "null") {
      // Strip stable- prefix if present, delegate minor extraction to shared utility
      const stripped = channelStr.replace(/^stable-/i, "");
      // Only normalize if it's a valid version format
      try {
        const minor = getOpenShiftMinorFromSources({ channel: stripped }, {});
        if (minor) {
          patch.release.channel = minor;
        }
      } catch {
        // Leave malformed channel as-is for validation to catch
      }
    }
    return;
  }

  // Case 2: Incoming channel is omitted, null, undefined, or empty - backfill from patch sources only
  if (!hasExplicitChannel || incomingChannel === null || incomingChannel === undefined || incomingChannel === "") {
    // Build effective version from PATCH only (do not merge with persisted state yet)
    const patchVersion = patch.version && typeof patch.version === "object" ? patch.version : {};

    // Try to derive minor from incoming patch fields only
    const minor = getOpenShiftMinorFromSources(
      { patchVersion: patch.release.patchVersion, selectedVersion: null },
      {
        selectedMinor: null, // Do not use persisted canonical here
        selectedPatch: patchVersion.selectedPatch,
        selectedVersion: patchVersion.selectedVersion
      }
    );

    if (minor) {
      patch.release = { ...patch.release, channel: minor };
    }
  }
}

// Deep merge helper for state updates - preserves nested object fields
//
// CLEARING SEMANTICS. A recursive merge can only ever ADD or OVERWRITE keys, so
// before this an explicitly empty object was indistinguishable from "no change"
// and a map could never be emptied server-side. That broke two real clears:
//
//   - OperatorsStep drops a catalog scan job that answered 404 by writing
//     `operators.scanJobs = {}`;
//   - operatorMinorReconciliation's cross-minor invalidation writes
//     `scanJobs: {}`, `catalogs: {}` and `scenarios: {}`.
//
// Both looked fine in the browser and were silently resurrected by the next
// GET /api/state after a reload, so the stale job ids came back and were
// re-polled all over again.
//
// The rule is therefore: an explicitly provided EMPTY object replaces, it does
// not merge. An omitted key still means "leave alone", which is what keeps
// genuine partial patches working - the distinction is between "absent" and
// "present and empty", not between "small" and "large".
//
// Arrays already replaced wholesale (isObject excludes them) and still do.
function deepMerge(target, source) {
  const output = { ...target };

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (Object.keys(source[key]).length === 0) {
          // Explicit clear.
          output[key] = {};
        } else if (!(key in target)) {
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
  // Proxy URL userinfo is a credential (DOC-176). This sanitizer feeds the run
  // export and the high-side runtime package's run payload inside bundle.zip;
  // the latter carried a client-supplied `user:password` verbatim. The proxy
  // endpoint itself is kept.
  if (!includeCredentials && next.globalStrategy?.proxies) {
    for (const key of ["httpProxy", "httpsProxy"]) {
      if (next.globalStrategy.proxies[key]) {
        next.globalStrategy.proxies[key] = stripProxyCredentials(next.globalStrategy.proxies[key]);
      }
    }
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
    logger.debug({ err, path: parent }, "Write access check failed");
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
  // Private key material. Short-lived, but it must not survive an exit that
  // lands between ssh-keygen writing it and the handler unlinking it.
  trackTempArtifact(keyPath, "file", "ssh-key");
  trackTempArtifact(`${keyPath}.pub`, "file", "ssh-key");
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

// Liveness probe: Check process health only (no dependencies)
// Returns uptime for diagnostic purposes
app.get("/api/health", (req, res) => {
  const uptime = process.uptime();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: uptime
  });
});

// Readiness probe: Check DB read and write operations
// Tests both read (getState) and write (cache table) to verify DB health
app.get("/api/ready", async (req, res) => {
  const checks = {
    database_read: "unknown",
    database_write: "unknown"
  };

  try {
    // Check 1: Read from database
    getState();
    checks.database_read = "ok";

    // Check 2: Write test (insert into cache, then delete)
    const testKey = `readiness-probe-${Date.now()}`;
    db.prepare("INSERT INTO cache (key, value, updated_at) VALUES (?, ?, ?)")
      .run(testKey, "test", Date.now());
    db.prepare("DELETE FROM cache WHERE key = ?").run(testKey);
    checks.database_write = "ok";

    res.status(200).json({
      ready: true,
      checks: checks,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error({ err, checks }, "Readiness probe failed");
    res.status(503).json({
      ready: false,
      checks: checks,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Prometheus metrics endpoint: Expose instrumentation metrics for scraping
app.get("/api/metrics", async (_req, res) => {
  try {
    const metrics = await getMetrics();
    res.set("Content-Type", getMetricsContentType());
    res.send(metrics);
  } catch (err) {
    logger.error({ err }, "Failed to retrieve metrics");
    res.status(500).json({ error: "Failed to retrieve metrics" });
  }
});

/** The installed application version from backend/package.json, or "unknown". */
function readAppVersion() {
  try {
    const packagePath = path.join(path.dirname(new URL(import.meta.url).pathname), "../package.json");
    const packageData = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
    return packageData.version || "unknown";
  } catch (err) {
    logger.warn({ err }, "Failed to read backend package.json version");
    return "unknown";
  }
}

// Build info: env-driven; no git at runtime. For APP_GIT_SHA/APP_BUILD_TIME see README and scripts.
//
// `branch` is the configured APP_BRANCH (used for documentation links), NOT the
// branch this build came from — Compose sets it to `main` unconditionally. It is
// kept for API compatibility and must not be presented as build provenance.
app.get("/api/build-info", (_req, res) => {
  const gitSha = (process.env.APP_GIT_SHA || "unknown").trim();
  const buildTime = (process.env.APP_BUILD_TIME || "unknown").trim();
  const repo = (process.env.APP_REPO || "bstrauss84/openshift-airgap-architect").trim();
  const branch = (process.env.APP_BRANCH || "main").trim();
  const version = readAppVersion();

  res.json({ version, gitSha, buildTime, repo, branch });
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

app.post("/api/feedback/submit", (req, res, next) => currentSubmitLimiter()(req, res, next), validateBody(feedbackSubmitSchema), async (req, res) => {
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
    version: readAppVersion(),
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
    logger.info({ tag: "feedback", submissionId, mode: config.mode, githubIssueUrlReady: Boolean(issueDraft.githubIssueUrl) }, "Feedback accepted");
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

// Update check: newest published, stable GitHub Release of APP_REPO vs the installed
// package.json version. The Git SHA is NOT consulted (see shared/updateStatus.js and
// backend/src/releaseUpdateCheck.js). CHECK_UPDATES=false|0 disables it without any
// request. Cache: success 6h, failure 15min.
const UPDATE_CACHE_SUCCESS_MS = 6 * 60 * 60 * 1000;
const UPDATE_CACHE_FAILURE_MS = 15 * 60 * 1000;

let updateInfoCache = null;

app.get("/api/update-info", async (_req, res) => {
  const now = Date.now();
  if (updateInfoCache) {
    const { result, cachedAt, isSuccess } = updateInfoCache;
    const ttl = isSuccess ? UPDATE_CACHE_SUCCESS_MS : UPDATE_CACHE_FAILURE_MS;
    if (now - cachedAt < ttl) {
      return res.json(result);
    }
  }
  const result = await buildUpdateInfo({ installedVersion: readAppVersion() });
  const isSuccess = result.enabled && !result.error && result.releaseIdentity != null;
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

  // CRITICAL VALIDATION: Prevent state corruption where release is confirmed without channel
  // This validation MUST run BEFORE normalization to catch explicit null confirmed channel
  // Explicit null/empty channel with confirmed=true is ALWAYS rejected, even if patchVersion could backfill
  if (patch?.release?.confirmed === true && "channel" in patch.release) {
    const incomingChannel = patch.release.channel;
    if (incomingChannel === null || incomingChannel === undefined || incomingChannel === "") {
      return res.status(400).json({
        error: "Validation failed",
        details: [{
          path: "release.channel",
          message: "Release cannot be confirmed without a channel. Select a version first."
        }]
      });
    }
  }

  // Apply normalization after validation passes
  applyReleaseChannelNormalization(patch);

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

  // DOC-101 Phase 1 Slice 4 Boundary 1: State migration at API boundary
  // CRITICAL: Validate migration BEFORE persisting to prevent database pollution
  // Build candidate merged state in memory only, validate, then persist if valid
  const current = ensureState();
  const merged = deepMerge(current, patch);
  const migrationResult = migrateStateToV3(merged);

  if (migrationResult.error) {
    // SECURITY: Log only safe metadata, never full state (credentials risk)
    logger.warn(
      {
        error: migrationResult.error,
        hasRelease: !!merged.release,
        hasVersion: !!merged.version,
        versionSchemaVersion: merged.version?._schemaVersion || 'none',
        scenarioId: merged.scenarioId || 'none'
      },
      "State migration failed at /api/state boundary"
    );
    // Return 400 without persisting - candidate state was invalid
    return res.status(400).json({
      error: "State migration failed",
      details: [{
        path: "state._schemaVersion",
        message: `Unknown or invalid state schema. ${migrationResult.error}`
      }]
    });
  }

  const candidate = migrationResult.migrated;

  // Version-support check: reject unsupported minors before persistence
  const resolvedMinor = getOpenShiftMinorFromState(candidate);
  if (resolvedMinor && !isSupportedMinor(resolvedMinor)) {
    const vErr = buildUnsupportedVersionError(resolvedMinor);
    return res.status(422).json({
      error: vErr.message,
      code: vErr.code,
      requestedVersion: vErr.requestedVersion,
      supportedVersions: vErr.supportedVersions
    });
  }

  if (candidate.hostInventory) {
    const bmcResult = validateBmcVerifyCA(candidate.hostInventory.bmcVerifyCA);
    if (!bmcResult.valid) {
      return res.status(400).json({
        error: "Validation failed",
        details: [{ path: "hostInventory.bmcVerifyCA", message: bmcResult.error }]
      });
    }
    if (bmcResult.blank) {
      delete candidate.hostInventory.bmcVerifyCA;
    }
  }

  // Migration validation succeeded - sanitize credentials before persistence
  // Security: Strip credentials from state before writing to SQLite
  // Sanitization happens AFTER migration/validation to preserve credential presence during validation
  // but BEFORE setState to prevent credentials from reaching persistent storage
  const sanitized = sanitizeStateForPersistence(candidate);

  if (migrationResult.wasV1 || migrationResult.wasV2) {
    logger.info(
      { wasV1: migrationResult.wasV1, wasV2: migrationResult.wasV2 },
      "State migrated to v3 at /api/state boundary"
    );
  }
  setState(sanitized);
  res.json(candidate);
});

// Mounted Red Hat pull secret endpoints
app.get("/api/secrets/rh-pull-secret", (req, res) => {
  res.json({ available: Boolean(mountedRhPullSecret) });
});

// Raw disclosure of the mounted pull secret is WITHDRAWN.
//
// This endpoint returned the operator's full Red Hat pull secret to any
// caller. The backend has no authentication on any route, and the shipped
// OpenShift overlay (manifests/openshift/route-backend.yaml) publishes it on
// an edge-TLS Route with no auth, so anyone who could reach that Route could
// read the cluster's pull secret. Compose binds 127.0.0.1 and was contained.
//
// It existed only to pre-fill the Blueprint pull-secret textarea in the
// browser. Nothing else needed it: the operations that genuinely use the
// mounted credential — /api/ocmirror/preflight and /api/ocmirror/run —
// resolve it server-side via rhAuthSource: "mounted" and never send it to the
// client, and the operator catalog scan authenticates through the separate
// REGISTRY_AUTH_FILE mechanism. So the credential never has to reach the
// browser at all, and now does not.
//
// The availability probe above is kept deliberately: { available: boolean }
// discloses nothing and is what the UI now uses to tell the operator a
// mounted secret is present.
app.all("/api/secrets/rh-pull-secret/content", (req, res) => {
  res.status(410).json({
    error: "Raw mounted pull secret retrieval has been withdrawn.",
    code: "ENDPOINT_WITHDRAWN"
  });
});

app.post("/api/start-over", validateBody(startOverSchema), (req, res) => {
  const cancelRunningOcMirror = req.body?.cancelRunningOcMirror !== false;
  if (cancelRunningOcMirror) {
    const runningOcMirrorJobs = listJobsByType("oc-mirror-run").filter((job) => job.status === "running");
    for (const job of runningOcMirrorJobs) {
      const proc = activeProcesses.get(job.id);
      if (proc) {
        try {
          proc.kill("SIGTERM");
        } catch (err) {
          logger.debug({ err, jobId: job.id }, "Failed to kill process during start-over");
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
        // Same boundary fix: `${tmpDir}evil/x` is not inside tmpDir. This
        // check matters more here than elsewhere because the path has
        // already been symlink-resolved, so a pass deletes the TARGET.
        if (realPath.startsWith(tmpDir + path.sep)) {
          safeUnlink(realPath);
        } else {
          logger.debug({ realPath, tmpDir }, "Skipping file outside tmpDir");
        }
      } catch (err) {
        logger.debug({ err, path: fullPath }, "Failed to clean temp file");
      }
    });
  }
  res.json(next);
});

app.get("/api/run/export", (req, res) => {
  const state = ensureState();

  // DOC-101 Phase 1 Slice 4 Boundary 3: State schema migration at export boundary
  // Migrate v1/v2 state to v3 before exporting
  const stateMigrationResult = migrateStateToV3(state);

  if (stateMigrationResult.error) {
    // SECURITY: Log only safe metadata, never full exported state (credentials risk)
    logger.warn(
      {
        error: stateMigrationResult.error,
        hasRelease: !!state.release,
        hasVersion: !!state.version,
        versionSchemaVersion: state.version?._schemaVersion || 'none',
        runId: state.runId || 'none'
      },
      "State migration failed at /api/run/export boundary"
    );
    return res.status(400).json({
      error: "Export failed: unknown or invalid state schema",
      details: [{
        path: "state._schemaVersion",
        message: stateMigrationResult.error
      }]
    });
  }

  // Use migrated v3 state (or original if already v3)
  const v3State = stateMigrationResult.migrated;

  // Log migration result if v1/v2 was migrated
  if (stateMigrationResult.wasV1 || stateMigrationResult.wasV2) {
    logger.info(
      {
        wasV1: stateMigrationResult.wasV1,
        wasV2: stateMigrationResult.wasV2,
        runId: v3State.runId || 'none'
      },
      "Exported state migrated to v3 at /api/run/export boundary"
    );
  }

  const options = v3State.exportOptions || {};
  const sanitized = sanitizeStateForExport(v3State, { ...options, includeCredentials: false });
  if (process.env.NODE_ENV !== "test") {
    logger.info({ tag: "run:export", runId: v3State.runId }, "Run exported");
  }
  res.json({
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    runId: v3State.runId,
    state: sanitized,
    migrated: stateMigrationResult.wasV1 || stateMigrationResult.wasV2
  });
});

app.post("/api/run/import", validateBody(runImportSchema), (req, res) => {
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

  // Schema v3: Migrate enableIpv6 → ipStackMode
  if (migrated.hostInventory) {
    const hiSchemaVersion = migrated.hostInventory.schemaVersion || 1;
    if (hiSchemaVersion < 3 && !migrated.hostInventory.ipStackMode) {
      if (migrated.hostInventory.hasOwnProperty('enableIpv6')) {
        migrated.hostInventory.ipStackMode = migrated.hostInventory.enableIpv6 ? 'dual-stack' : 'ipv4';
        delete migrated.hostInventory.enableIpv6;
      } else {
        migrated.hostInventory.ipStackMode = 'ipv4';
      }
      migrated.hostInventory.schemaVersion = 3;
    }
  }
  if (migrated.operators) {
    const expectedVersion = getOpenShiftMinorFromState(migrated) || migrated.release?.channel || null;
    if (migrated.operators.version && migrated.operators.version !== expectedVersion) {
      migrated.operators.stale = true;
    }
  }

  // DOC-101 Phase 1 Slice 4 Boundary 2: State schema migration at import boundary
  // Migrate v1/v2 state to v3 before persisting
  const stateMigrationResult = migrateStateToV3(migrated);

  if (stateMigrationResult.error) {
    // SECURITY: Log only safe metadata, never full imported state (credentials risk)
    logger.warn(
      {
        error: stateMigrationResult.error,
        bundleSchemaVersion: schemaVersion,
        hasRelease: !!migrated.release,
        hasVersion: !!migrated.version,
        versionSchemaVersion: migrated.version?._schemaVersion || 'none',
        runId: migrated.runId || 'none'
      },
      "State migration failed at /api/run/import boundary"
    );
    return res.status(400).json({
      error: "Import failed: unknown or invalid state schema",
      details: [{
        path: "state._schemaVersion",
        message: `Cannot import state with unknown schema. ${stateMigrationResult.error}`
      }]
    });
  }

  const v3State = stateMigrationResult.migrated;

  if (stateMigrationResult.wasV1 || stateMigrationResult.wasV2) {
    logger.info(
      {
        wasV1: stateMigrationResult.wasV1,
        wasV2: stateMigrationResult.wasV2,
        bundleSchemaVersion: schemaVersion
      },
      "Imported state migrated to v3 at /api/run/import boundary"
    );
  }

  const importedMinor = getOpenShiftMinorFromState(v3State);
  if (importedMinor && !isSupportedMinor(importedMinor)) {
    const vErr = buildUnsupportedVersionError(importedMinor);
    return res.status(422).json({
      error: vErr.message,
      code: vErr.code,
      requestedVersion: vErr.requestedVersion,
      supportedVersions: vErr.supportedVersions
    });
  }

  if (v3State.hostInventory) {
    const bmcResult = validateBmcVerifyCA(v3State.hostInventory.bmcVerifyCA);
    if (!bmcResult.valid) {
      return res.status(400).json({
        error: "Validation failed",
        details: [{ path: "hostInventory.bmcVerifyCA", message: bmcResult.error }]
      });
    }
    if (bmcResult.blank) {
      delete v3State.hostInventory.bmcVerifyCA;
    }
  }

  // Persistence-grade, not export-grade.
  //
  // This used sanitizeStateForExport, which only blanks four `credentials.*`
  // fields and the Blueprint ephemeral. It left `credentials.sshPrivateKey`,
  // every `platformConfig.*` password, `hostInventory.nodes[].bmc.password`
  // and userinfo embedded in a proxy URL untouched — and this value is both
  // PERSISTED and returned, so an imported run laundered those credentials
  // into stored state, from which GET /api/state, GET /api/run/export and
  // POST /api/run/duplicate served them back.
  //
  // POST /api/state has always persisted through sanitizeStateForPersistence,
  // which additionally runs a recursive sweep over credential-shaped keys.
  // Both write paths now agree; the import surface was the odd one out, and
  // it is the one the update banner tells operators to use when upgrading.
  const sanitized = sanitizeStateForPersistence(v3State);
  setState(sanitized);
  res.json({ ok: true, state: sanitized, migrated: stateMigrationResult.wasV1 || stateMigrationResult.wasV2 });
});

app.post("/api/run/duplicate", validateBody(runDuplicateSchema), (req, res) => {
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

app.post("/api/cincinnati/update", validateBody(cincinnatiUpdateSchema), async (req, res) => {
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
app.post("/api/cincinnati/refresh-job", validateBody(cincinnatiRefreshSchema), (req, res) => {
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

app.post("/api/operators/confirm", validateBody(operatorConfirmSchema), (req, res) => {
  const state = ensureState();
  const confirmMinor = getOpenShiftMinorFromState(state);
  if (confirmMinor && !isSupportedMinor(confirmMinor)) {
    const vErr = buildUnsupportedVersionError(confirmMinor);
    return res.status(422).json({ error: vErr.message, code: vErr.code, requestedVersion: vErr.requestedVersion, supportedVersions: vErr.supportedVersions });
  }
  const release = { ...state.release, confirmed: true };
  // DOC-101 Phase 1: Use v3 canonical fields (locked, selectedMinor, selectedPatch, _schemaVersion)
  // Preserve existing v3 schema marker and locked state if already set
  const version = {
    _schemaVersion: state.version?._schemaVersion ?? 3,  // v3 schema marker
    selectedMinor: state.release?.channel || state.version?.selectedMinor || null,
    selectedPatch: state.release?.patchVersion || state.version?.selectedPatch || null,
    selectedChannel: state.release?.channel ? `stable-${state.release.channel}` : null,
    selectedVersion: state.release?.patchVersion || null,
    selectionTimestamp: state.version?.selectionTimestamp || Date.now(),
    confirmedByUser: true,
    confirmationTimestamp: Date.now(),
    locked: true  // v3 canonical lock field
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
  if (!isSupportedMinor(catalogMinor)) {
    if (tempAuthFile) safeUnlink(tempAuthFile);
    const vErr = buildUnsupportedVersionError(catalogMinor);
    return res.status(422).json({ error: vErr.message, code: vErr.code, requestedVersion: vErr.requestedVersion, supportedVersions: vErr.supportedVersions });
  }

  if (process.env.NODE_ENV !== "test") {
    logger.info({ tag: "operator-scan:start", requestId: req.requestId, version: catalogMinor, catalogCount: getCatalogs().length, authMethod: tempAuthFile ? "pull-secret" : "mounted" }, "Operator scan started");
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
    // No scan was started, so nothing will ever settle and release the
    // credential this request wrote. Without this the pull secret sits on the
    // /data volume for the lifetime of the process. (The temp-artifact
    // registry would still catch it at shutdown — that is defence in depth,
    // not a reason to leak it.)
    if (tempAuthFile) safeUnlink(tempAuthFile);
    return res.json({ jobs });
  }
  // One pull secret is shared by every catalog in this request, so it is
  // released when the LAST scan settles. Letting each child unlink it meant
  // the first one to finish deleted the credential the other two were still
  // passing to --authfile.
  const catalogsToScan = getCatalogs();
  const releaseScanAuth = createSharedAuthRelease(tempAuthFile, catalogsToScan.length);
  for (const catalog of catalogsToScan) {
    const jobId = runScanJob({
      version: catalogMinor,
      catalogId: catalog.id,
      catalogImage: catalog.image(catalogMinor),
      authFile: tempAuthFile,
      jobType: "operator-scan",
      ocMirrorPath: resolved.path,
      onSettled: releaseScanAuth
    });
    jobs[catalog.id] = jobId;

    if (process.env.NODE_ENV !== "test") {
      logger.info({ tag: "operator-scan:job-created", requestId: req.requestId, jobId, catalogId: catalog.id, version: catalogMinor }, "Operator scan job created");
    }
  }
  res.json({ jobs });
});

app.post("/api/operators/prefetch", validateBody(operatorsPrefetchSchema), async (req, res) => {
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
  if (!isSupportedMinor(catalogMinor)) {
    const vErr = buildUnsupportedVersionError(catalogMinor);
    return res.status(422).json({ error: vErr.message, code: vErr.code, requestedVersion: vErr.requestedVersion, supportedVersions: vErr.supportedVersions });
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
    logger.debug({ err: e }, "oc-mirror binary resolution failed");
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

app.post("/api/jobs/:id/stop", validateBody(jobStopSchema), (req, res) => {
  const jobId = req.params.id;
  const proc = activeProcesses.get(jobId);
  if (!proc) return res.status(404).json({ error: "Job not running." });
  proc.kill("SIGTERM");
  activeProcesses.delete(jobId);
  // Guarded: a job can still be in the registry after reaching a terminal
  // state (a timed-out scan awaiting SIGKILL), and "cancelled" must not
  // overwrite the real outcome.
  updateJobUnlessTerminal(jobId, { status: "cancelled", message: "Stopped by user.", progress: 0 });
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
    logger.debug({ err }, "Archive structure check failed");
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
        logger.debug({ err, path: parent }, "Path check failed");
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
        logger.debug({ err }, "Parent path check failed");
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
      // Intentionally suppressed - fs error treated same as missing config
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
          // Intentionally suppressed - JSON.parse failure is the expected error case
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

  // Add signature verification warnings (reuse existing 'advanced' variable from line 1878)
  const signatureOptions = advanced.signatureOptions || null;
  const removeSignatures = Boolean(advanced.removeSignatures);

  if (removeSignatures) {
    warnings.push("Signature verification disabled globally (--remove-signatures flag). All operator signatures will be skipped, including Red Hat operators. Only use for testing or when registries.d config fails.");
  } else if (signatureOptions) {
    if (signatureOptions.disableCertified) {
      warnings.push("Signature verification disabled for certified operators (registry.connect.redhat.com). This is recommended for operators with missing signatures but reduces security verification.");
    }
    if (signatureOptions.disableCommunity) {
      warnings.push("Signature verification disabled for community operators (quay.io/operatorhubio). Recommended for community operators as signatures are not guaranteed.");
    }
    if (signatureOptions.customRegistries?.length > 0) {
      warnings.push(`Signature verification disabled for custom registries: ${signatureOptions.customRegistries.join(", ")}`);
    }
  }

  const ok = blockers.length === 0;
  res.json({ ok, blockers, warnings, checks, fieldErrors });
});

/** Build oc-mirror CLI args for v1 modes (contract §2B). */
function buildOcMirrorArgs(mode, configPath, archivePath, workspacePath, cachePath, registryUrl, dryRun, advanced, authFile, removeSignatures) {
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
  if (removeSignatures) args.push("--remove-signatures");
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

/**
 * Map registry categories to hostnames for signature disabling.
 * Returns array of registry hostnames to disable signatures for.
 */
function getRegistryHostnamesForSignatureDisabling(signatureOptions) {
  const hostnames = [];

  if (signatureOptions?.disableCertified) {
    hostnames.push("registry.connect.redhat.com");
    hostnames.push("registry.marketplace.redhat.com");
  }

  if (signatureOptions?.disableCommunity) {
    hostnames.push("quay.io/operatorhubio");
  }

  if (signatureOptions?.customRegistries && Array.isArray(signatureOptions.customRegistries)) {
    hostnames.push(...signatureOptions.customRegistries.filter(h => h && typeof h === "string"));
  }

  return hostnames;
}

/**
 * Generate registries.d YAML config file to disable signature verification
 * for specified registry hostnames.
 *
 * Format per Red Hat documentation and containers/image library:
 * docker:
 *   <hostname>:
 *     use-sigstore-attachments: false
 *
 * Setting use-sigstore-attachments to false disables cosign/sigstore signature verification.
 * This is the correct field for oc-mirror v2 which added OCI artifact signature support.
 */
function generateRegistriesDConfig(hostname) {
  return `docker:
  ${hostname}:
    use-sigstore-attachments: false
`;
}

/**
 * Write registries.d config files to temp directory.
 * Returns path to registries.d directory, or null if no configs needed.
 */
function writeRegistriesDConfigs(signatureOptions) {
  if (!signatureOptions) return null;

  const hostnames = getRegistryHostnamesForSignatureDisabling(signatureOptions);
  if (hostnames.length === 0) return null;

  const tmpDir = path.join(dataDir, "tmp");
  const registriesDDir = path.join(tmpDir, `registries.d-${nanoid()}`);

  try {
    fs.mkdirSync(registriesDDir, { recursive: true });
    // Removed by the oc-mirror child's close handler, which a terminating
    // process never reaches.
    trackTempArtifact(registriesDDir, "dir", "registries-d");

    for (const hostname of hostnames) {
      // Sanitize hostname for filename (replace : and / with -)
      const safeFilename = hostname.replace(/[/:]/g, "-") + ".yaml";
      const configPath = path.join(registriesDDir, safeFilename);
      const configContent = generateRegistriesDConfig(hostname);
      fs.writeFileSync(configPath, configContent, "utf8");
    }

    return registriesDDir;
  } catch (err) {
    logger.error({ err }, "Failed to write registries.d configs");
    return null;
  }
}

/**
 * Cleanup registries.d directory.
 */
function cleanupRegistriesDDir(registriesDDir) {
  if (!registriesDDir) return;
  try {
    fs.rmSync(registriesDDir, { recursive: true, force: true });
    untrackTempArtifact(registriesDDir);
  } catch (err) {
    logger.error({ err }, "Failed to cleanup registries.d directory");
  }
}

/**
 * Parse oc-mirror logs for signature verification errors.
 * Returns array of failing image registry paths.
 *
 * Error pattern example:
 * error mirroring image docker://REGISTRY/PATH@sha256:... error: reading signatures:
 * reading manifest sha256-*.sig in REGISTRY/PATH: name unknown: Image not found
 */
function parseSignatureErrors(output) {
  const failedImages = [];
  // Regex to extract registry path from signature errors
  const sigErrorRegex = /error mirroring image docker:\/\/([^@\s]+)@sha256:[^\s]+.*error: reading signatures.*name unknown: Image not found/g;

  let match;
  while ((match = sigErrorRegex.exec(output)) !== null) {
    const imagePath = match[1]; // e.g., "registry.connect.redhat.com/netapp/trident-operator"
    if (!failedImages.includes(imagePath)) {
      failedImages.push(imagePath);
    }
  }

  return failedImages;
}

/**
 * Write per-image registries.d configs for failed images.
 * More granular than writeRegistriesDConfigs (which is per-registry hostname).
 *
 * Generates one YAML file per failing image path with format:
 * docker:
 *   <image-path>:
 *     use-sigstore-attachments: false
 */
function writePerImageRegistriesDConfigs(imagePathsArray) {
  if (!imagePathsArray || imagePathsArray.length === 0) return null;

  const tmpDir = path.join(dataDir, "tmp");
  const registriesDDir = path.join(tmpDir, `registries.d-retry-${nanoid()}`);

  try {
    fs.mkdirSync(registriesDDir, { recursive: true });
    // Removed by the oc-mirror child's close handler, which a terminating
    // process never reaches.
    trackTempArtifact(registriesDDir, "dir", "registries-d");

    for (const imagePath of imagePathsArray) {
      // Sanitize image path for filename
      // e.g., "registry.connect.redhat.com/netapp/trident-operator" ->
      //       "registry.connect.redhat.com-netapp-trident-operator.yaml"
      const safeFilename = imagePath.replace(/[/:]/g, "-") + ".yaml";
      const configPath = path.join(registriesDDir, safeFilename);

      // Generate per-image config (NOT per-registry)
      const configContent = `docker:
  ${imagePath}:
    use-sigstore-attachments: false
`;
      fs.writeFileSync(configPath, configContent, "utf8");
    }

    logger.info({ tag: "smart-retry", count: imagePathsArray.length, registriesDDir }, "Generated per-image registries.d configs");
    return registriesDDir;
  } catch (err) {
    logger.error({ err }, "Failed to write per-image registries.d configs");
    return null;
  }
}

/**
 * Automatically retry oc-mirror with per-image signature disabling.
 * Called when signature errors detected in completed_with_warnings job.
 *
 * @param originalJobId - Job ID of the failed run
 * @param signatureFailures - Array of image paths that failed signature verification
 * @param originalBody - Original request body from /api/ocmirror/run
 */
async function retryWithPerImageSignatureDisable(originalJobId, signatureFailures, originalBody) {
  logger.info({ tag: "smart-retry", originalJobId, signatureFailureCount: signatureFailures.length }, "Starting auto-retry for signature failures");

  // Generate per-image registries.d configs
  const registriesDDir = writePerImageRegistriesDConfigs(signatureFailures);

  if (!registriesDDir) {
    logger.error({ tag: "smart-retry" }, "Failed to generate registries.d configs");
    return null;
  }

  // Create new job for retry
  const retryJobId = createJob("oc-mirror-run", `Auto-retry (signature errors from job ${originalJobId})`);

  // Extract parameters from original body
  const mode = originalBody.mode || "mirrorToDisk";
  const dryRun = originalBody.dryRun ?? false;
  const archivePath = originalBody.archivePath;
  const workspacePath = originalBody.workspacePath;
  const cachePath = originalBody.cachePath;
  const registryUrl = originalBody.registryUrl;
  const advanced = originalBody.advanced || {};

  // Get config path (either from original configPath or use the one from metadata)
  const originalMetadata = getJobMetadata(originalJobId);
  const configPathToUse = originalBody.configPath || originalMetadata.configPath;

  if (!configPathToUse) {
    logger.error({ tag: "smart-retry", retryJobId }, "Cannot retry: no config path available");
    updateJob(retryJobId, { status: "failed", message: "Cannot retry: no config path available" });
    cleanupRegistriesDDir(registriesDDir);
    return null;
  }

  // Update metadata to link to original job
  updateJobMetadata(retryJobId, {
    mode,
    dryRun,
    archiveDir: archivePath || "",
    workspaceDir: workspacePath,
    cacheDir: cachePath || "",
    registryUrl: registryUrl || "",
    configPath: configPathToUse,
    startedAt: Date.now(),
    retryOf: originalJobId,
    signatureFailures,
    retryReason: "automatic signature error retry"
  });

  // Build same args but ensure removeSignatures is false (use registries.d instead)
  const authFile = originalMetadata.authFile || null;
  const args = buildOcMirrorArgs(
    mode,
    configPathToUse,
    archivePath,
    workspacePath,
    cachePath,
    registryUrl,
    dryRun,
    advanced,
    authFile,
    false // removeSignatures = false (use registries.d instead)
  );

  // Resolve oc-mirror binary
  const resolved = await resolveOcMirrorBinary(dataDir);
  if (resolved.error) {
    updateJob(retryJobId, {
      status: "failed",
      progress: 100,
      message: resolved.error,
      output: resolved.rawStderr || resolved.error
    });
    cleanupRegistriesDDir(registriesDDir);
    return null;
  }

  // Set environment variable for registries.d
  const { REGISTRY_AUTH_FILE: _drop, ...envWithoutRegistryAuthFile } = process.env;
  const envVars = {
    ...envWithoutRegistryAuthFile,
    CONTAINERS_REGISTRIES_D: registriesDDir
  };

  logger.info({ tag: "smart-retry", retryJobId, registriesDDir }, "Launching retry job with per-image configs");

  // Spawn oc-mirror retry
  const child = spawn(resolved.path, args, { env: envVars });
  activeProcesses.set(retryJobId, child);
  updateJob(retryJobId, { status: "running", progress: 0, message: "oc-mirror retry running with per-image signature configs." });

  child.stdout.on("data", (data) => appendJobOutput(retryJobId, data.toString()));
  child.stderr.on("data", (data) => appendJobOutput(retryJobId, data.toString()));

  child.on("error", (err) => {
    appendJobOutput(retryJobId, `\n${String(err)}\n`);
    updateJobUnlessTerminal(retryJobId, { status: "failed", message: "oc-mirror retry failed to start." });
    activeProcesses.delete(retryJobId);
    cleanupRegistriesDDir(registriesDDir);
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

    const output = getJob(retryJobId)?.output || "";
    const releaseMatch = output.match(/[✓✗]\s+(\d+)\s*\/\s*(\d+)\s+release images mirrored/);
    const operatorMatch = output.match(/[✓✗]\s+(\d+)\s*\/\s*(\d+)\s+operator images mirrored/);
    const releaseResult = releaseMatch
      ? { succeeded: parseInt(releaseMatch[1], 10), total: parseInt(releaseMatch[2], 10) }
      : null;
    const operatorResult = operatorMatch
      ? { succeeded: parseInt(operatorMatch[1], 10), total: parseInt(operatorMatch[2], 10) }
      : null;

    const failedImages = [];
    const failRe = /\[ERROR\].*?\[Worker\] error mirroring image\s+(\S+)/g;
    let fm;
    while ((fm = failRe.exec(output)) !== null) {
      if (!failedImages.includes(fm[1])) failedImages.push(fm[1]);
    }

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

    const duration = finishedAt - (getJobMetadata(retryJobId).startedAt || finishedAt);
    const durationMinutes = (duration / 1000 / 60).toFixed(1);
    let message = `oc-mirror retry ${status} in ${durationMinutes} minutes.`;
    if (releaseResult) message += ` Release: ${releaseResult.succeeded}/${releaseResult.total}.`;
    if (operatorResult) message += ` Operators: ${operatorResult.succeeded}/${operatorResult.total}.`;

    updateJobUnlessTerminal(retryJobId, { status, progress: 100, message });
    updateJobMetadata(retryJobId, {
      ...getJobMetadata(retryJobId),
      finishedAt,
      duration,
      releaseResult,
      operatorResult,
      failedImages,
      clusterResourcesPath,
      dryRunMappingPath,
      dryRunMissingPath
    });

    activeProcesses.delete(retryJobId);
    cleanupRegistriesDDir(registriesDDir);
  });

  return retryJobId;
}

/** Safely resolve the directory that owns working-dir outputs for a run mode. */
function resolveOcMirrorArtifactsBaseDir(mode, workspacePath, archivePath) {
  const raw = mode === "mirrorToMirror" ? workspacePath : archivePath;
  if (!raw || typeof raw !== "string" || !raw.trim()) return "";
  try {
    return path.resolve(raw);
  } catch {
    // Intentionally suppressed - invalid path resolves to empty string
    return "";
  }
}

app.post("/api/ocmirror/run", validateBody(ocMirrorRunSchema), async (req, res) => {
  const state = ensureState();

  // DOC-101 Phase 1 Slice 5: State schema migration at generation boundary
  // Migrate v1/v2 state to v3 before generating imageset-config.yaml
  const stateMigrationResult = migrateStateToV3(state);

  if (stateMigrationResult.error) {
    // SECURITY: Log only safe metadata, never full state (credentials risk)
    logger.warn(
      {
        error: stateMigrationResult.error,
        hasRelease: !!state.release,
        hasVersion: !!state.version,
        versionSchemaVersion: state.version?._schemaVersion || 'none'
      },
      "State migration failed at oc-mirror generation boundary"
    );
    return res.status(400).json({
      error: "oc-mirror failed: unknown or invalid state schema",
      details: [{
        path: "state._schemaVersion",
        message: stateMigrationResult.error
      }]
    });
  }

  const v3State = stateMigrationResult.migrated;

  // Version must be locked before running oc-mirror
  // Check canonical v3 version.locked field (primary) with backward-compatible fallback to release.confirmed
  const versionLocked = v3State.version?.locked;
  const releaseConfirmed = v3State.release?.confirmed;
  const confirmed = versionLocked ?? releaseConfirmed;

  if (!confirmed) {
    return res.status(400).json({ error: "Version must be confirmed before running oc-mirror" });
  }
  const body = req.body || {};
  const mode = body.mode || "mirrorToDisk";
  const dryRun = Boolean(body.dryRun);
  const archivePath = body.archivePath?.trim() || v3State.mirrorWorkflow?.archivePath?.trim() || v3State.mirrorWorkflow?.outputPath?.trim();
  const workspacePath = body.workspacePath?.trim() || v3State.mirrorWorkflow?.workspacePath?.trim();
  const cachePath = body.cachePath?.trim() || v3State.mirrorWorkflow?.cachePath?.trim();
  const registryFqdn = v3State.globalStrategy?.mirroring?.registryFqdn?.trim();
  const registryUrl = body.registryUrl?.trim() || (registryFqdn ? `docker://${registryFqdn}` : "");
  const configSourceType = body.configSourceType || "generated";
  const configPathExternal = body.configPath?.trim();
  const rhPullSecretRaw = body.rhAuthSource === "mounted" ? mountedRhPullSecret : body.rhPullSecret;
  const mirrorAuthSource = body.mirrorAuthSource || "reuse";
  const mirrorPullSecretRaw = body.mirrorPullSecret;
  const advanced = body.advanced && typeof body.advanced === "object" ? body.advanced : {};

  // Extract signature options from advanced
  const signatureOptions = advanced.signatureOptions || null;
  const removeSignatures = Boolean(advanced.removeSignatures);

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
  // Only a config this backend generated is ours to remove.
  let configPathIsOurs = false;
  const tmpDir = path.join(dataDir, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const jobId = createJob("oc-mirror-run", "oc-mirror run starting.");

  if (configSourceType === "generated") {
    // The other two buildImageSetConfig call sites already assert this. Without it
    // here, an unsupported or unresolvable minor reached the generator directly, and
    // before the FQ-9 fix the generator's `|| "4.20"` default turned that into a
    // silently wrong mirror configuration instead of a refusal.
    try {
      assertSupportedOpenShiftVersion(v3State);
    } catch (error) {
      if (error.code === "UNSUPPORTED_VERSION") {
        return res.status(422).json({
          error: error.message,
          code: error.code,
          requestedVersion: error.requestedVersion,
          supportedVersions: error.supportedVersions
        });
      }
      throw error;
    }
    const configContents = buildImageSetConfig(v3State);
    // This backend generated it, so this backend may delete it. The external
    // branch below does NOT set this: that path is an operator-supplied file
    // on their own disk, and unlinking it destroys user data.
    configPathIsOurs = true;
    // Sits in DATA_DIR/tmp beside the auth file and registries.d dir and is
    // cleaned by the same child `close` handler, so it needs the same
    // shutdown ownership. Carries mirror FQDNs and the operator selection.
    configPathToUse = trackTempArtifact(
      path.join(tmpDir, `imageset-${jobId}.yaml`),
      "file",
      "imageset-config"
    );
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
    if (configPathIsOurs) safeUnlink(configPathToUse);
    return res.json({ jobId });
  }

  // Generate registries.d configs if signature options provided
  let registriesDDir = null;
  if (signatureOptions && !removeSignatures) {
    registriesDDir = writeRegistriesDConfigs(signatureOptions);
  }

  const resolved = await resolveOcMirrorBinary(dataDir);
  if (resolved.error) {
    updateJob(jobId, {
      status: "failed",
      progress: 100,
      message: resolved.error,
      output: resolved.rawStderr || resolved.error
    });
    if (configPathIsOurs) safeUnlink(configPathToUse);
    if (authFile) safeUnlink(authFile);
    return res.json({ jobId });
  }

  try {
    if (mode === "mirrorToMirror" && workspacePath) fs.mkdirSync(path.resolve(workspacePath), { recursive: true });
    if (mode !== "mirrorToMirror" && archivePath) fs.mkdirSync(path.resolve(archivePath), { recursive: true });
    if (cachePath && mode !== "mirrorToMirror") fs.mkdirSync(path.resolve(cachePath), { recursive: true });
  } catch (err) {
    updateJob(jobId, { status: "failed", message: String(err?.message || err), progress: 100 });
    if (configPathIsOurs) safeUnlink(configPathToUse);
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
    startedAt,
    // Credential-stripped. This used to store `body` verbatim, which put the
    // operator's rhPullSecret and mirrorPullSecret in plaintext into SQLite —
    // contradicting this module's own "Pull secrets never persisted to disk"
    // contract (utils.js) — and then served them to anyone, because
    // GET /api/jobs and GET /api/jobs/:id return the whole row unauthenticated
    // and updateJobMetadata performs no redaction.
    //
    // Nothing is lost. The only consumer is the smart-retry path.
    //
    // That path used to read `getJob(jobId)?.metadata`, a property that does
    // not exist — getJob returns the raw row carrying `metadata_json`, and
    // nothing parsed it — so the retry was inert. It now reads through
    // `getJobMetadata`, which parses the same column `updateJobMetadata`
    // writes. The retry works; the stored body stays credential-stripped.
    // Repairing the read must never become a reason to store a raw body here.
    requestBody: sanitizeCredentialFields(body),
    authFile // Store authFile path for retry
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
    authFile,
    removeSignatures
  );
  const fullCommand = `${resolved.path} ${args.join(" ")}`;
  updateJobMetadata(jobId, { ...meta, fullCommand });
  // Do NOT pass REGISTRY_AUTH_FILE to oc-mirror — that env var is consumed by
  // the distribution/distribution local registry component as a YAML config file
  // path (not an OCI auth JSON), causing a startup panic.  Auth is supplied via
  // --authfile flag instead.
  const { REGISTRY_AUTH_FILE: _drop, ...envWithoutRegistryAuthFile } = process.env;

  // Set CONTAINERS_REGISTRIES_D environment variable if registries.d configs generated
  const envVars = { ...envWithoutRegistryAuthFile };
  if (registriesDDir) {
    envVars.CONTAINERS_REGISTRIES_D = registriesDDir;
    logger.info({ tag: "oc-mirror", registriesDDir }, "Using registries.d configs");
  }

  const child = spawn(resolved.path, args, { env: envVars });
  activeProcesses.set(jobId, child);
  updateJob(jobId, { status: "running", progress: 0, message: "oc-mirror running." });
  child.stdout.on("data", (data) => appendJobOutput(jobId, data.toString()));
  child.stderr.on("data", (data) => appendJobOutput(jobId, data.toString()));
  child.on("error", (err) => {
    appendJobOutput(jobId, `\n${String(err)}\n`);
    // Guarded: a stop or a shutdown may already have recorded this job.
    updateJobUnlessTerminal(jobId, { status: "failed", message: "oc-mirror failed to start." });
    activeProcesses.delete(jobId);
    if (registriesDDir) cleanupRegistriesDDir(registriesDDir);
    if (configPathIsOurs) safeUnlink(configPathToUse);
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

    // Parse signature errors for smart retry
    const signatureFailures = parseSignatureErrors(output);

    updateJobMetadata(jobId, {
      exitCode: code,
      finishedAt,
      clusterResourcesPath,
      dryRunMappingPath,
      dryRunMissingPath,
      releaseResult,
      operatorResult,
      failedImages: failedImages.length ? failedImages : undefined,
      signatureFailures: signatureFailures.length ? signatureFailures : undefined,
      retryRecommended: (status === "completed_with_warnings" && signatureFailures.length > 0) || undefined
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

    // Guarded: a SIGTERMed child reports code === null, which this block
    // turns into "failed" — relabelling a job that was deliberately cancelled.
    const outcomeRecorded = updateJobUnlessTerminal(jobId, {
      status,
      progress: status === "completed" ? 100 : status === "completed_with_warnings" ? 100 : 0,
      message
    });

    // Trigger smart retry if signature failures detected.
    //
    // Gated on the write above having been ACCEPTED. `status` is computed
    // locally from the exit code and output, not read back from the job: a
    // SIGTERMed child reports code === null, and if the partial output already
    // showed every release image mirrored it is classified
    // `completed_with_warnings`. So a run the operator explicitly stopped
    // could reach here, spawn a brand-new oc-mirror child, and overwrite
    // "Stopped by user." — restarting work that was deliberately cancelled.
    if (outcomeRecorded && status === "completed_with_warnings" && signatureFailures.length > 0) {
      const currentMetadata = getJobMetadata(jobId);
      const originalRequestBody = currentMetadata.requestBody;

      if (originalRequestBody) {
        logger.info({ tag: "smart-retry", jobId, signatureFailureCount: signatureFailures.length }, "Detected signature failures");
        // Launch retry asynchronously (don't await)
        retryWithPerImageSignatureDisable(jobId, signatureFailures, originalRequestBody)
          .then((retryJobId) => {
            if (retryJobId) {
              // Update original job to reference retry
              updateJobMetadata(jobId, {
                ...currentMetadata,
                retriedAs: retryJobId
              });

              // Update message to inform user about auto-retry
              const opFailed = operatorResult ? operatorResult.total - operatorResult.succeeded : "?";
              // Guarded too: this lands after an await, so a stop can have
              // been recorded in the meantime.
              updateJobUnlessTerminal(jobId, {
                message: `oc-mirror completed with ${opFailed} operator image(s) failed (${signatureFailures.length} signature error(s)). Auto-retry launched (job ${retryJobId}).`
              });
              logger.info({ tag: "smart-retry", retryJobId, originalJobId: jobId }, "Launched retry job");
            }
          })
          .catch((err) => {
            logger.error({ tag: "smart-retry", err, jobId }, "Failed to launch retry");
          });
      } else {
        logger.warn({ tag: "smart-retry", jobId }, "Cannot retry job: no request body in metadata");
      }
    }

    activeProcesses.delete(jobId);
    if (registriesDDir) cleanupRegistriesDDir(registriesDDir);
    if (configPathIsOurs) safeUnlink(configPathToUse);
    if (authFile) safeUnlink(authFile);
  });
  res.json({ jobId });
});

/* DOC-203. Documentation links are per OpenShift minor, so they exist only once
   a SUPPORTED minor is selected. These two endpoints used to fall back to "4.0",
   a release that never existed, which built docs.redhat.com URLs for it and
   cached them under their own key. Now: no minor -> an explicit
   "selection required" answer; an unsupported minor -> 422 UNSUPPORTED_VERSION,
   exactly like every other version boundary. Never a substituted version. */
const DOCS_VERSION_REQUIRED_MESSAGE =
  "Select an OpenShift version before updating documentation links.";

const resolveDocsMinor = (state, res) => {
  const minor = getOpenShiftMinorFromState(state);
  if (minor && !isSupportedMinor(minor)) {
    const vErr = buildUnsupportedVersionError(minor);
    res.status(422).json({ error: vErr.message, code: vErr.code, requestedVersion: vErr.requestedVersion, supportedVersions: vErr.supportedVersions });
    return null;
  }
  return minor;
};

app.get("/api/docs", (req, res) => {
  const state = ensureState();
  const minor = getOpenShiftMinorFromState(state);
  if (!minor) return res.json({ cached: null, versionRequired: true });
  const version = resolveDocsMinor(state, res);
  if (!version) return;
  const key = docsKey(version, state.blueprint?.platform, state.methodology?.method, state.docs?.connectivity);
  const cached = getDocsFromCache(key);
  res.json({ cached });
});

app.post("/api/docs/update", validateBody(docsUpdateSchema), async (req, res) => {
  const state = ensureState();
  if (!getOpenShiftMinorFromState(state)) {
    return res.status(400).json({ error: DOCS_VERSION_REQUIRED_MESSAGE, code: "VERSION_NOT_SELECTED" });
  }
  const version = resolveDocsMinor(state, res);
  if (!version) return;
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

/**
 * Gate an AWS installer-backed request on a well-formed, SUPPORTED version.
 *
 * Two separate holes closed here, both reachable from `?version=`:
 *
 *   1. NO FALLBACK RULE. These three endpoints never consulted
 *      isSupportedMinor, so an unsupported minor (4.23) was passed straight to
 *      the mirror fetch and the downloaded binary was then EXECUTED
 *      (installer.js: `openshift-install coreos print-stream-json`). The
 *      project rule is 422 UNSUPPORTED_VERSION at every boundary — release
 *      selection, imported state, catalogs, preview, generation — and this was
 *      a boundary that had been missed.
 *
 *   2. The value is interpolated into a mirror URL and into
 *      `path.join(toolsDir, \`openshift-install-${version}\`)`
 *      (installer.js:45, :57) with no format check, so `../` traverses. The
 *      strict x.y.z shape removes that whole class rather than escaping it.
 *
 * Returns true when the caller has already responded.
 */
const rejectUnsupportedInstallerVersion = (version, res) => {
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) {
    res.status(400).json({
      error: "Version must be an exact OpenShift patch version, e.g. 4.22.17.",
      code: "MALFORMED_VERSION"
    });
    return true;
  }
  const minor = String(version).split(".").slice(0, 2).join(".");
  if (!isSupportedMinor(minor)) {
    const vErr = buildUnsupportedVersionError(minor);
    res.status(422).json({
      error: vErr.message,
      code: vErr.code,
      requestedVersion: vErr.requestedVersion,
      supportedVersions: vErr.supportedVersions
    });
    return true;
  }
  return false;
};

app.post("/api/aws/warm-installer", validateBody(awsWarmInstallerSchema), (req, res) => {
  const version = req.body?.version || req.query.version;
  if (!version) {
    return res.status(400).json({ error: "Version is required." });
  }
  if (rejectUnsupportedInstallerVersion(version, res)) return;
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
  if (rejectUnsupportedInstallerVersion(version, res)) return;
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
  if (rejectUnsupportedInstallerVersion(version, res)) return;
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

function assertSupportedOpenShiftVersion(v3State) {
  return assertSupportedOpenShiftMinorForGeneration(v3State);
}

/* ---------------------------------------------------------------------------
 * Per-artifact generation isolation (DOC-227).
 *
 * THE DEFECT THIS REPLACES. The preview set used to be built as one straight
 * sequence of generator calls. The first generator to throw aborted the whole
 * request, so a host-networking problem — "NMState interface name must not be
 * empty.", raised inside buildAgentConfig → buildNmState — stopped
 * imageset-config.yaml from being produced at all, even though the imageset
 * document does not read a single host-networking field. The user saw their
 * operator and Quick Pick work frozen behind an unrelated Agent error.
 *
 * THE MODEL. Each previewed output declares what it is and what state it
 * consumes, and is generated inside its own boundary. An output either
 * succeeds with content or fails with ITS OWN error; one failure never
 * suppresses another output. This is deliberately a registry rather than a
 * rule about any particular filename: a future artifact gets isolation by
 * being added here, not by anyone special-casing an error message.
 *
 * `dependsOn` is the derived dependency statement for each output — the
 * top-level state slices its generator actually reads, read out of
 * backend/src/generate.js rather than assumed. It is asserted against real
 * generator behaviour in backend/test/per-artifact-generation-isolation.test.js
 * (mutating a slice an artifact does NOT depend on must not change its bytes),
 * so it cannot quietly drift away from the code.
 *
 * GLOBAL vs ARTIFACT failures are still distinct. Schema migration, the
 * unsupported-target-version boundary and the trust-analysis guards run BEFORE
 * any artifact and still throw for the whole request: those are not one
 * artifact's problem, and CLAUDE.md's No Fallback Rule requires the whole
 * response to fail closed for an unsupported target.
 * ------------------------------------------------------------------------- */
const PREVIEW_ARTIFACTS = [
  {
    id: "install-config.yaml",
    outputs: ["install-config.yaml"],
    // buildInstallConfig: version/release (support gate), blueprint, methodology,
    // globalStrategy (mirroring/networking/ntp), hostInventory (replica counts,
    // rendezvous IP), platformConfig, credentials, trust, exportOptions.
    dependsOn: [
      "version", "release", "blueprint", "methodology", "globalStrategy",
      "hostInventory", "platformConfig", "credentials", "trust", "exportOptions"
    ],
    build: (state) => ({ "install-config.yaml": buildInstallConfig(state) })
  },
  {
    id: "agent-config.yaml",
    outputs: ["agent-config.yaml"],
    // buildAgentConfig: blueprint (baseDomain/clusterName), hostInventory
    // (nodes, NMState, root device hints, IP stack mode, boot artifacts),
    // globalStrategy.ntpServers. Applicability also reads methodology.
    dependsOn: ["blueprint", "methodology", "hostInventory", "globalStrategy"],
    applies: (state) =>
      state.methodology?.method === "Agent-Based Installer" &&
      (state.blueprint?.platform === "Bare Metal" || state.blueprint?.platform === "VMware vSphere"),
    // Preserves the historical shape: the key is present and null when the
    // scenario is not agent-based.
    absent: () => ({ "agent-config.yaml": null }),
    build: (state) => ({ "agent-config.yaml": buildAgentConfig(state) })
  },
  {
    id: "imageset-config.yaml",
    outputs: ["imageset-config.yaml"],
    // buildImageSetConfig: release.patchVersion + the resolved supported minor,
    // blueprint.arch (mirror architectures), imagesetConfig (graph, archive
    // size, additional images, kubeVirtContainer) and operators.selected with
    // their catalog metadata. It reads NO host networking, NO BMC fields and
    // NO platform-specifics.
    dependsOn: ["version", "release", "blueprint", "imagesetConfig", "operators"],
    build: (state) => ({ "imageset-config.yaml": buildImageSetConfig(state) })
  },
  {
    id: "ntp-machine-configs",
    // One generator, two outputs; an error is attributed to both.
    outputs: ["99-chrony-ntp-master.yaml", "99-chrony-ntp-worker.yaml"],
    dependsOn: ["globalStrategy"],
    build: (state) => buildNtpMachineConfigs(state)
  },
  {
    id: "FIELD_MANUAL.md",
    outputs: ["FIELD_MANUAL.md"],
    dependsOn: [
      "version", "release", "blueprint", "methodology", "globalStrategy",
      "hostInventory", "trust", "operators", "docs"
    ],
    build: (state, ctx) => ({ "FIELD_MANUAL.md": buildFieldManual(state, ctx.links) })
  }
];

/**
 * Build every previewed artifact.
 *
 * @param {object} state raw (possibly v1/v2) wizard state
 * @param {{isolate?: boolean}} options
 *   isolate=false (default, legacy): the first artifact error is rethrown
 *   unchanged, so every existing caller — GET /api/generate, the plain POST
 *   used by Review/export, and their status-code mapping — behaves exactly as
 *   before, including `code` and error-class identity.
 *   isolate=true: artifacts that succeed are returned, and artifacts that
 *   failed are reported individually in `fileErrors`.
 * @returns {null|{files: object, fileErrors: object}} null when the version is
 *   not yet confirmed (unchanged signal).
 */
const buildPreviewArtifacts = (state, { isolate = false, exportPolicy = false } = {}) => {
  // DOC-101 Phase 1 Slice 5: State schema migration at generation boundary
  // Migrate v1/v2 state to v3 before generation
  const stateMigrationResult = migrateStateToV3(state);

  if (stateMigrationResult.error) {
    throw new Error(`Generation failed: ${stateMigrationResult.error}`);
  }

  const v3State = stateMigrationResult.migrated;

  // DOC-102 Slice 5F.13: Unsupported version boundary - check support BEFORE confirmation
  // An unconfirmed 4.23 state must throw UNSUPPORTED_VERSION, not return null
  // Returns the supported minor (it throws otherwise), so `version` below can
  // never be a substitute (DOC-203).
  const version = assertSupportedOpenShiftVersion(v3State);

  const confirmed = v3State.version?.locked ?? v3State.release?.confirmed;
  if (!confirmed) return null;

  const key = docsKey(version, v3State.blueprint?.platform, v3State.methodology?.method, v3State.docs?.connectivity);
  const cached = getDocsFromCache(key);
  const links = cached?.links || [];

  // Two policies, chosen explicitly by the caller:
  //
  // - PREVIEW (default): credentials and the SSH key are forced IN, so the
  //   drawer's "Show sensitive values" toggle has something to reveal. The
  //   drawer redacts them for display. These bytes must never be offered as a
  //   download.
  // - EXPORT (`exportPolicy: true`): exactly the rules the bundle applies — the
  //   user's credential-inclusion choices, the SSH key switch and the "Proxy
  //   values" switch. The drawer's per-file Download uses this, so a single
  //   downloaded file can never carry what the bundle would have excluded.
  const baseExportOptions = v3State.exportOptions || {};
  const previewState = exportPolicy
    ? applyProxyValueInclusion(v3State)
    : {
        ...v3State,
        exportOptions: {
          ...baseExportOptions,
          includeCredentials: true,
          inclusion: { ...(baseExportOptions.inclusion || {}), sshPublicKey: true }
        }
      };

  const ctx = { links, version };
  const files = {};
  const fileErrors = {};

  for (const artifact of PREVIEW_ARTIFACTS) {
    if (artifact.applies && !artifact.applies(previewState)) {
      Object.assign(files, artifact.absent ? artifact.absent() : {});
      continue;
    }
    try {
      Object.assign(files, artifact.build(previewState, ctx) || {});
    } catch (error) {
      // Legacy mode: this request fails as a whole, exactly as it used to, and
      // with the original error object so route-level `code`/instanceof
      // mapping is untouched.
      if (!isolate) throw error;
      const message = String(error?.message || error);
      for (const output of artifact.outputs) {
        fileErrors[output] = { message, ...(error?.code ? { code: error.code } : {}), artifact: artifact.id };
      }
    }
  }

  return { files, fileErrors };
};

/** Back-compatible wrapper: files only, first error rethrown. */
const buildPreviewFiles = (state) => {
  const result = buildPreviewArtifacts(state, { isolate: false });
  return result === null ? null : result.files;
};

app.post("/api/trust/analyze", validateBody(trustAnalyzeSchema), (req, res) => {
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
    if (error.code === 'UNSUPPORTED_VERSION') {
      return res.status(422).json({
        error: error.message,
        code: error.code,
        requestedVersion: error.requestedVersion,
        supportedVersions: error.supportedVersions
      });
    }
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
    if (error.code === 'CONFIGURATION_VALIDATION' || error.code === 'FIELD_GUIDE_VERSION_ERROR') {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    return res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/generate", validateBody(generateSchema), (req, res) => {
  const parsed = parseOptionalClientState(req.body?.state, ensureState);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  /* DOC-227. Opt-in per-artifact isolation. The YAML preview drawer asks for
     it, because a preview pane must update whenever ITS OWN artifact is
     generatable; Review/export and every existing API consumer do not, and
     keep the all-or-nothing fail-closed contract their tests pin (an invalid
     install-config still yields 400 with no files there). Global boundaries
     — unsupported target version, schema migration, trust guards — fail the
     whole response in BOTH modes. */
  const isolateArtifacts = req.body?.isolateArtifacts === true;
  // Per-file downloads ask for the export policy; see buildPreviewArtifacts.
  const exportPolicy = req.body?.exportPolicy === true;
  try {
    const result = buildPreviewArtifacts(parsed.state, { isolate: isolateArtifacts, exportPolicy });
    if (!result) return res.status(400).json({ error: "Version not confirmed." });
    const { files, fileErrors } = result;

    // Validate generated YAML against parameter catalogs (advisory, non-blocking)
    const scenarioId = detectScenarioId(parsed.state);
    const catalogMinor = getOpenShiftMinorFromState(parsed.state);
    if (scenarioId) {
      const validation = validateAllFiles(files, scenarioId, catalogMinor);
      if (!validation.valid) {
        logger.warn({
          requestId: req.requestId,
          scenarioId,
          totalErrors: validation.totalErrors,
          fileErrors: Object.keys(validation.fileErrors).reduce((acc, filename) => {
            acc[filename] = validation.fileErrors[filename].totalErrors;
            return acc;
          }, {}),
        }, "Generated YAML validation warnings (non-blocking)");
        // Note: Validation warnings are logged but do not block generation.
        // This allows minimal test fixtures and incomplete states while still
        // providing visibility into potential configuration issues.
      } else {
        logger.debug({
          requestId: req.requestId,
          scenarioId,
          filesValidated: Object.keys(files).filter(f => f.endsWith('.yaml')),
        }, "Generated YAML validation passed");
      }
    }

    /* `fileErrors` is only ever present in isolation mode, so the legacy
       response body is byte-identical for every other caller. */
    res.json(isolateArtifacts ? { files, fileErrors } : { files });
  } catch (error) {
    if (error.code === 'UNSUPPORTED_VERSION') {
      return res.status(422).json({
        error: error.message,
        code: error.code,
        requestedVersion: error.requestedVersion,
        supportedVersions: error.supportedVersions
      });
    }
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
    if (error.code === 'CONFIGURATION_VALIDATION' || error.code === 'FIELD_GUIDE_VERSION_ERROR') {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    return res.status(500).json({ error: String(error?.message || error) });
  }
});

const buildBundleZip = async (state, res) => {
  // DOC-101 Phase 1 Slice 5: State schema migration at generation boundary
  // Migrate v1/v2 state to v3 before bundle generation
  const stateMigrationResult = migrateStateToV3(state);

  if (stateMigrationResult.error) {
    // SECURITY: Log only safe metadata, never full state (credentials risk)
    logger.warn(
      {
        error: stateMigrationResult.error,
        hasRelease: !!state.release,
        hasVersion: !!state.version,
        versionSchemaVersion: state.version?._schemaVersion || 'none'
      },
      "State migration failed at bundle generation boundary"
    );
    res.status(400).json({
      error: "Bundle generation failed: unknown or invalid state schema",
      details: [{
        path: "state._schemaVersion",
        message: stateMigrationResult.error
      }]
    });
    return;
  }

  const v3State = stateMigrationResult.migrated;

  // DOC-102 Slice 5F.13: Unsupported version boundary - check support BEFORE confirmation
  // An unconfirmed 4.23 state must return 422 UNSUPPORTED_VERSION, not "version not confirmed"
  // Returns the supported minor (it throws otherwise), so `version` below can
  // never be a substitute (DOC-203).
  const version = assertSupportedOpenShiftVersion(v3State);

  const confirmed = v3State.version?.locked ?? v3State.release?.confirmed;
  if (!confirmed) {
    res.status(400).json({ error: "Version not confirmed." });
    return;
  }

  if (process.env.NODE_ENV !== "test") {
    logger.info({ tag: "bundle:start", version, platform: v3State.blueprint?.platform, method: v3State.methodology?.method, includeClientTools: Boolean(v3State.exportOptions?.includeClientTools), draftMode: Boolean(v3State.exportOptions?.draftMode) }, "Bundle build started");
  }

  const key = docsKey(version, v3State.blueprint?.platform, v3State.methodology?.method, v3State.docs?.connectivity);
  const cached = getDocsFromCache(key);
  const links = cached?.links || [];
  // DOC-177: the "Proxy values" export switch governs every bundle member that
  // carries proxy endpoints: install-config.yaml, the Field Manual and the
  // high-side runtime package's run payload (below).
  const proxyGovernedState = applyProxyValueInclusion(v3State);
  const installConfig = buildInstallConfig(proxyGovernedState);
  const wantsAgentConfig =
    v3State.methodology?.method === "Agent-Based Installer" &&
    (v3State.blueprint?.platform === "Bare Metal" || v3State.blueprint?.platform === "VMware vSphere");
  const agentConfig = wantsAgentConfig ? buildAgentConfig(v3State) : null;
  const imageSetConfig = buildImageSetConfig(v3State);
  const ntpMachineConfigs = buildNtpMachineConfigs(v3State);
  const fieldManual = buildFieldManual(proxyGovernedState, links);

  // Validate the caller-supplied mirror-output directory HERE, while a clean
  // JSON error is still possible. Everything below this point runs after the
  // response headers commit, where the only honest ending is a truncated
  // transfer — and answering an unsafe path with a 200 and a silent omission
  // would be worse than either: it tells the operator the export succeeded.
  //
  // The roots here are deliberately NARROWER than ALLOWED_BASE_PATHS, which
  // also contains /tmp. /tmp is a reasonable place to let an operator BROWSE
  // (GET /api/fs/ls) and a terrible one to recursively archive into an
  // unauthenticated download: it is world-writable and full of other
  // processes' scratch files, including this server's own staged auth files.
  // Mirror output belongs under the data directory — that is where the
  // product puts it by default (mirrorWorkflow.archivePath above) and where
  // the README tells operators to mount a large drive.
  let mirrorOutputRealPath = null;
  const requestedMirrorOutput =
    v3State.mirrorWorkflow?.archivePath || v3State.mirrorWorkflow?.outputPath;
  if (v3State.mirrorWorkflow?.includeInExport && requestedMirrorOutput) {
    mirrorOutputRealPath = assertExportableMirrorOutput(requestedMirrorOutput, [dataDir]);
  }

  const bundleName = `airgap-${v3State.release?.patchVersion || "unknown"}-install-configs-bundle.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename=${bundleName}`);

  const archive = new ZipArchive({ zlib: { level: 9 } });

  // One owner for every way this export can fail, so the response is
  // terminated exactly once and a failure can never be served as a complete
  // archive.
  let bundleFailure = null;
  const failBundleStream = (err) => {
    if (bundleFailure) return;
    bundleFailure = err instanceof Error ? err : new Error(String(err));
    const clientGone = bundleFailure.code === "ERR_STREAM_PREMATURE_CLOSE";
    logger[clientGone ? "warn" : "error"]({
      err: bundleFailure,
      tag: "bundle:stream",
      code: bundleFailure.code,
      headersSent: res.headersSent
    }, clientGone ? "Bundle transfer ended before completion" : "Bundle export failed");
    if (res.headersSent) {
      // Bytes are already on the wire. The only honest ending is a truncated
      // transfer: the client's decoder fails instead of receiving a
      // well-formed archive. Never write an error string into ZIP output, and
      // never try to send a second response.
      res.destroy(bundleFailure);
    } else {
      // Nothing is on the wire yet, but the ZIP headers were already set at the
      // top of buildBundleZip and Express does not clear an explicitly-set
      // Content-Type: res.json() on this response yields
      // "application/zip; charset=utf-8" with the attachment header intact, so
      // the browser would save this error as bundle.zip. Drop both so the
      // failure arrives as a failure.
      res.removeHeader("Content-Disposition");
      res.removeHeader("Content-Type");
      res.status(500).end(String(err));
    }
    try {
      archive.abort();
    } catch (abortErr) {
      logger.debug({ err: abortErr, tag: "bundle:stream" }, "Archive abort after failure threw");
    }
  };

  archive.on("error", failBundleStream);
  // Archiver downgrades an unreadable entry SOURCE to a warning, decrements the
  // entry count and finalizes a ZIP that is simply missing that member. Only
  // streamFile() members are stat'ed by archiver — append(Buffer) members
  // cannot produce a warning — so any warning here means a streamed member was
  // silently dropped, which must fail the export rather than ship a smaller
  // archive that still looks successful. The warning necessarily precedes
  // finalization, because the stat queue must drain before archiver finalizes.
  archive.on("warning", failBundleStream);

  // pipeline(), not pipe(): streamed members (see tracked.streamFile below) are
  // opened by archiver while the response drains, so the staging that owns them
  // can only be released once this settles. pipeline's promise always settles —
  // it resolves on completion and rejects with ERR_STREAM_PREMATURE_CLOSE
  // within milliseconds of a client disconnect, tearing the archive down with
  // it. archive.finalize()'s own promise is NOT a usable anchor here: on a
  // disconnect it never settles at all, even after archive.abort().
  const archiveDone = pipeline(archive, res);
  // Observed the moment it exists. A client can disconnect while the awaits
  // below are still running, which rejects this long before the final await is
  // reached; without an immediate handler that is an unhandled rejection. The
  // outcome is still awaited at the end — marking a rejection handled does not
  // consume it.
  archiveDone.catch(() => {});

  const tracked = createIntegrityTracker(archive);
  tracked.append(installConfig, { name: "install-config.yaml" });
  if (agentConfig) {
    tracked.append(agentConfig, { name: "agent-config.yaml" });
  }
  tracked.append(imageSetConfig, { name: "imageset-config.yaml" });
  tracked.append(fieldManual, { name: "FIELD_MANUAL.md" });
  Object.entries(ntpMachineConfigs).forEach(([name, content]) => {
    tracked.append(content, { name });
  });
  if (v3State.exportOptions?.draftMode) {
    tracked.append(
      "DRAFT/NOT VALIDATED: Warnings were present at export time. Review before use.\n",
      { name: "DRAFT_NOT_VALIDATED.txt" }
    );
  }
  if (v3State.exportOptions?.includeClientTools) {
    // One option, two promised binaries. Declared BEFORE the attempt so the
    // promise survives a throw, and declared by name so the `fs.existsSync`
    // guards below can no longer drop a binary silently: an unregistered
    // member now fails the export whether or not anything threw.
    tracked.requestDeliverable("includeClientTools", ["tools/oc", "tools/oc-mirror"]);
    try {
      const exportArch = v3State.exportOptions?.exportBinaryArch || getLocalBinaryArch();
      // oc must match the selected target minor; oc-mirror is global-latest.
      const { ocPath, ocMirrorPath, provenance } = await getBinariesForExportArch(
        exportArch,
        dataDir,
        version
      );
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
        tracked.file(ocPath, { name: "tools/oc" });
      }
      if (ocMirrorPath && fs.existsSync(ocMirrorPath)) {
        assertReadableFile(ocMirrorPath, "oc-mirror");
        tracked.file(ocMirrorPath, { name: "tools/oc-mirror" });
      }
      if (Array.isArray(provenance) && provenance.length > 0) {
        tracked.append(
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              targetMinor: version,
              architecture: exportArch,
              policy: {
                oc: "latest patch within the selected target OpenShift minor",
                "oc-mirror": "latest available release globally, independent of target minor"
              },
              tools: provenance.map((p) => ({
                tool: p.tool,
                version: p.version,
                sha256: p.sha256,
                architecture: p.arch,
                channel: p.channel,
                sourceUrl: p.url
              }))
            },
            null,
            2
          ) + "\n",
          { name: "tools/TOOLS_PROVENANCE.json" }
        );
      }
    } catch (e) {
      // Deliberately no `.ERROR.txt` member. A text file standing where a
      // verified binary was requested is a broken promise the operator can
      // only discover across the air gap, with the mirror unreachable by
      // definition. Record the reason; the fatal check before the manifest
      // ends the export through the single failure owner.
      tracked.failDeliverable("includeClientTools", e);
    }
  }
  if (v3State.exportOptions?.includeInstaller) {
    // Hoisted out of the try: the member name is part of the promise and has
    // to be known before the attempt, not only after it succeeds.
    const useFips = v3State.exportOptions?.installerUseFips || false;
    // Preserve binary name (openshift-install-fips for FIPS, openshift-install for standard)
    const binaryName = useFips ? 'openshift-install-fips' : 'openshift-install';
    tracked.requestDeliverable("includeInstaller", [`tools/${binaryName}`]);
    try {
      const version = v3State.release?.patchVersion;
      if (!version) {
        throw new Error("Version not selected.");
      }

      const platformArch = v3State.exportOptions?.installerPlatformArch || ""; // "" means default

      // Download (or retrieve from cache) the requested binary variant
      const installerPath = await ensureOpenshiftInstaller(version, platformArch, useFips, dataDir);

      if (fs.existsSync(installerPath)) {
        tracked.file(installerPath, { name: `tools/${binaryName}` });
      } else {
        throw new Error("Binary not found after download");
      }
    } catch (error) {
      tracked.failDeliverable("includeInstaller", error);
    }
  }
  // Released by the archive-stream `finally` at the end of this function, for
  // the same reason the runtime package is: archiver opens a streamed member's
  // path while the response drains, so releasing at registration time would
  // delete the file out from under it.
  let releaseMirrorRegistryStaging = null;
  if (v3State.exportOptions?.includeMirrorRegistry) {
    // Hoisted: the promised member name, and the manual-download URL the
    // failure reason quotes, were previously recomputed verbatim in the catch.
    // Architecture is caller-supplied and is interpolated into BOTH a URL and a
    // filesystem path, so it is matched against the set Red Hat actually
    // publishes rather than trusted. Verified 2026-10-16: amd64, ppc64le and
    // s390x exist; arm64/aarch64 return 404 — there is no ARM mirror-registry
    // build. The frontend already offers exactly these three
    // (frontend/src/steps/ReviewStep.jsx), so this rejects only values that
    // never came from the UI.
    const requestedMirrorRegistryArch = v3State.exportOptions?.mirrorRegistryArch || "amd64";
    const mirrorRegistryArch = MIRROR_REGISTRY_ARCHES.includes(requestedMirrorRegistryArch)
      ? requestedMirrorRegistryArch
      : null;
    const mirrorRegistryFilename = `mirror-registry-${mirrorRegistryArch || "amd64"}.tar.gz`;
    const mirrorRegistryBase = "https://mirror.openshift.com/pub/cgw/mirror-registry/latest";
    const mirrorRegistryUrl = `${mirrorRegistryBase}/${mirrorRegistryFilename}`;
    tracked.requestDeliverable("includeMirrorRegistry", [`tools/${mirrorRegistryFilename}`]);
    try {
      if (!mirrorRegistryArch) {
        throw new Error(
          `Unsupported mirror-registry architecture "${requestedMirrorRegistryArch}". ` +
          `Red Hat publishes mirror-registry for ${MIRROR_REGISTRY_ARCHES.join(", ")} only.`
        );
      }
      const mirrorRegistryPath = path.join(dataDir, "cache", mirrorRegistryFilename);

      // Verified download, streamed. Two defects closed here:
      //
      //   Integrity: the only check used to be `size > 0`, so any complete
      //   response — a captive-portal page, a truncated-then-padded body, a
      //   tampered artifact — was packaged into the offline bundle and shipped
      //   across the air gap as a trusted installer. Red Hat publishes
      //   sha256sum.txt beside the artifact; it is now authoritative.
      //
      //   Memory: this artifact is 1.19 GiB (measured content-length
      //   1280705659 on 2026-10-16). `Buffer.from(await response.arrayBuffer())`
      //   held it whole, twice — roughly 2.4 GiB of peak allocation for one
      //   export, inside a container with a memory limit. It is now piped to
      //   disk and hashed by streaming, so peak allocation is a buffer, not the
      //   artifact.
      //
      // Both the manifest and the tarball answer 307 to a token-signed CDN URL,
      // which `redirect: "follow"` handles. If the `latest` pointer moves
      // between the two fetches the digests disagree and the export fails with
      // the mismatch message — the correct outcome, not a silent mixed pair.
      const provenance = await acquireVerifiedArtifact({
        artifactUrl: mirrorRegistryUrl,
        manifestUrl: `${mirrorRegistryBase}/sha256sum.txt`,
        fileName: mirrorRegistryFilename,
        destPath: mirrorRegistryPath
      });
      logger.info(
        {
          tag: "mirror-registry",
          filename: mirrorRegistryFilename,
          sizeMB: (provenance.bytes / 1024 / 1024).toFixed(2),
          sha256: provenance.sha256,
          cached: provenance.cached
        },
        "Mirror registry verified against published sha256sum.txt"
      );

      if (!fs.existsSync(mirrorRegistryPath)) {
        // Previously fell through with no member and no note at all — the
        // quietest of the three omission paths.
        throw new Error(`Cached file is missing after download: ${mirrorRegistryPath}`);
      }
      if (fs.statSync(mirrorRegistryPath).size === 0) {
        throw new Error("Cached file is 0 bytes (corrupt)");
      }

      // STREAM THE TARBALL INTO THE ZIP — the other half of the memory fix.
      //
      // Streaming the DOWNLOAD and then calling `tracked.file()` gave the
      // saving straight back: that helper does `fs.readFileSync`, so all
      // 1.19 GiB landed in one Buffer at registration time, inside a container
      // with a memory limit. `tracked.streamFile()` is the bounded path
      // (64 KB window, independent of file size).
      //
      // It carries a precondition the cache path CANNOT satisfy: exclusive
      // ownership, because archiver opens the path later, while the response
      // drains. `dataDir/cache` is shared — a concurrent export can rename a
      // fresh download over this very path, and the member would then be
      // archived from bytes that are not the bytes in the manifest.
      //
      // A hard link is how the precondition is met without copying 1.19 GiB:
      // a second name for the same inode, in a private 0700 directory this
      // request created. Unlinking or renaming the cache name cannot affect
      // it — the inode survives until the last link goes, which is when the
      // archive stream has settled and the `finally` below runs.
      const mirrorRegistryStagingDir = await fs.promises.mkdtemp(
        path.join(dataDir, "cache", "export-mirror-registry-")
      );
      await fs.promises.chmod(mirrorRegistryStagingDir, 0o700);
      releaseMirrorRegistryStaging = () => {
        try {
          fs.rmSync(mirrorRegistryStagingDir, { recursive: true, force: true });
          return { released: true, stagingRoot: mirrorRegistryStagingDir };
        } catch (err) {
          return { released: false, error: err, stagingRoot: mirrorRegistryStagingDir };
        }
      };
      const stagedPath = path.join(mirrorRegistryStagingDir, mirrorRegistryFilename);
      try {
        await fs.promises.link(mirrorRegistryPath, stagedPath);
      } catch (linkError) {
        // EXDEV (staging and cache on different filesystems) or a filesystem
        // with no hard-link support. Copy instead — reflink first where the
        // filesystem offers it, so this usually costs no extra blocks either.
        // This spends DISK, never memory; the streamed read is unchanged.
        logger.warn(
          { tag: "mirror-registry", err: { message: linkError?.message }, code: linkError?.code },
          "Hard link unavailable for export staging, falling back to a copy"
        );
        await fs.promises.copyFile(
          mirrorRegistryPath,
          stagedPath,
          fs.constants.COPYFILE_FICLONE
        );
      }

      // Proves the inode about to be archived is the one that was verified
      // against the published sha256sum.txt, closing the window between
      // acquisition and linking. Checked inside streamFile BEFORE the member
      // is registered, so a mismatch leaves the request unfulfilled and the
      // export terminates through the single failure owner rather than
      // shipping an unverified tool.
      tracked.streamFile(stagedPath, {
        name: `tools/${mirrorRegistryFilename}`,
        expectedSha256: provenance.sha256
      });
    } catch (error) {
      tracked.failDeliverable(
        "includeMirrorRegistry",
        `${String(error?.message || error)} — download manually from ${mirrorRegistryUrl}`
      );
    }
  }
  if (mirrorOutputRealPath) {
    // Already canonicalised and tree-verified before the headers committed,
    // so there is no second decision to make here and no path from the
    // request body left to trust.
    //
    // The symlink filter is deliberate belt-and-braces against the window
    // between validation and streaming: a link planted in that interval would
    // otherwise be followed. `false` omits the entry rather than resolving it,
    // and the integrity tracker's post-conditions fail the transfer if a
    // member it was promised never arrives.
    tracked.directory(mirrorOutputRealPath, "mirror-output", (entry) =>
      entry.stats?.isSymbolicLink?.() ? false : entry
    );
  }

  // High-side runtime package export (DOC-083)
  //
  // Released by the archive-stream `finally` at the end of this function, not
  // here: L2 streams these members, so archiver opens the staged paths while
  // the response drains. Releasing them at registration time (what L1 did,
  // correctly, while members were buffered) would now delete the files out
  // from under archiver, which reports a missing source as a `warning` and
  // silently omits the entry.
  let releaseRuntimePackageStaging = null;
  if (v3State.exportOptions?.includeHighSideRuntimePackage) {
    let runtimePackage = null;
    try {
      // SECURITY: Sanitize state in runPayload to prevent credential leakage
      // High-side runtime package is written to bundle.zip which may be transferred/stored
      // DOC-177: the run payload ships inside this same bundle, so the
      // "Proxy values" switch governs it as well.
      const sanitizedState = sanitizeStateForExport(proxyGovernedState, {
        ...(v3State.exportOptions || {}),
        includeCredentials: false // Never include credentials in runtime package
      });

      // Create runPayload for high-side deployment
      const runPayload = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        sourceProfile: "connected-authoring",
        state: sanitizedState, // Use sanitized state (no credentials)
        version,
        platform: v3State.blueprint?.platform,
        method: v3State.methodology?.method
      };

      runtimePackage = createRuntimePackageArtifacts({
        state: v3State, // createRuntimePackageArtifacts needs full state for other purposes
        exportOptions: v3State.exportOptions,
        runPayload, // But runPayload uses sanitized state
        dataDir
      });

      if (runtimePackage.included) {
        // Add all runtime package files to archive under runtime-package/ directory.
        //
        // streamFile, not file: these include `podman save` / `docker save`
        // image archives, and tracked.file() would hold every one of them in
        // memory at once — registration is a single synchronous pass, so the
        // Buffers accumulate rather than alternate. Measured on the reference
        // host: 590 MB of staged members (podman oci-archive, layers already
        // compressed) grew peak RSS by 628 MB eagerly versus 71 MB streamed.
        // The `docker save` path stages uncompressed layers instead — 1.67 GB
        // for the same two images — so it is the worse of the two. streamFile's
        // precondition
        // holds here and nowhere else in this function: the staging directory
        // is a private 0700 mkdtemp this request created moments ago, nothing
        // else can reach it, and it is released only after the archive stream
        // settles.
        for (const entry of runtimePackage.entries) {
          tracked.streamFile(entry.absolutePath, { name: `runtime-package/${entry.relativePath}` });
        }
        logger.info({
          tag: "runtime-package",
          filesIncluded: runtimePackage.entries.length,
          imageCount: runtimePackage.imageEntries.length
        }, "Runtime package added to export bundle");
      } else {
        // Runtime package was requested but couldn't be fully created
        const errorMessage = runtimePackage.notes.join("\n");
        tracked.append(
          `Runtime package could not be fully generated:\n\n${errorMessage}\n\nPlease ensure:\n- Container images are built and tagged locally\n- Podman or Docker is installed and available\n- Images: ${process.env.RUNTIME_PACKAGE_BACKEND_IMAGE || "localhost/openshift-airgap-architect-backend:latest"}, ${process.env.RUNTIME_PACKAGE_FRONTEND_IMAGE || "localhost/openshift-airgap-architect-frontend:latest"}\n`,
          { name: "runtime-package/RUNTIME_PACKAGE_NOT_INCLUDED.txt" }
        );
        logger.warn({
          tag: "runtime-package",
          notes: runtimePackage.notes
        }, "Runtime package requested but not fully included");
      }
    } catch (error) {
      tracked.append(
        `Failed to create runtime package: ${String(error?.message || error)}\n\nStack trace:\n${error?.stack || "N/A"}\n`,
        { name: "runtime-package/RUNTIME_PACKAGE_ERROR.txt" }
      );
      logger.error({
        tag: "runtime-package",
        error: error?.message || String(error),
        stack: error?.stack
      }, "Runtime package creation failed");
    } finally {
      // Hand ownership to the archive-stream finally below. cleanup() is
      // idempotent and never throws, so running it there once is enough, and
      // it still runs when nothing was staged or staging threw part-way.
      if (runtimePackage) releaseRuntimePackageStaging = runtimePackage.cleanup;
    }
  }

  try {
    // Pre-condition, and the counterpart to the missingStreamedMembers()
    // post-condition below. That one catches a member archiver LOST; this one
    // catches a requested member the producer never registered at all.
    //
    // A tool the operator explicitly ticked and this export could not produce
    // is a promise broken on the far side of the air gap — they carry the
    // archive across and find a text file where a binary should be, with the
    // mirror unreachable by definition. It must terminate through the same
    // single failure owner, never ship as a note inside an otherwise valid
    // archive. Checked BEFORE the manifest is written, so no manifest ever
    // records an unfulfilled request.
    //
    // Documented degraded modes are not registered as deliverables and are
    // deliberately unaffected (see the runtime-package note in
    // exportIntegrity.js).
    const unfulfilled = tracked.unfulfilledRequests();
    if (unfulfilled.length > 0) {
      throw new Error(
        `Bundle omitted requested members: ${unfulfilled
          .map((r) => `${r.option} [${r.missing.join(", ")}]${r.reason ? `: ${r.reason}` : ""}`)
          .join("; ")}`
      );
    }
    const versionManifest = tracked.buildManifest(v3State);
    archive.append(JSON.stringify(versionManifest, null, 2), { name: MANIFEST_FILENAME });
    // finalize() resolves only on a clean end; on a disconnect it never
    // settles, so archiveDone owns the outcome. Its rejection is routed
    // through the same single failure owner rather than discarded, so an
    // aborted archive cannot finish quietly.
    archive.finalize().catch(failBundleStream);
    await archiveDone;

    // Post-condition. Archiver drops an unreadable streamed member with a
    // warning rather than an error, so prove the archive actually carries
    // every member the manifest claims. failBundleStream above is the fast
    // path that truncates the response while that is still possible; this is
    // the backstop that guarantees a silent omission can never be recorded as
    // a successful export.
    const missing = tracked.missingStreamedMembers();
    if (missing.length > 0) {
      failBundleStream(new Error(`Bundle omitted streamed members: ${missing.join(", ")}`));
    }
  } catch (error) {
    failBundleStream(error);
  } finally {
    if (releaseRuntimePackageStaging) {
      const release = releaseRuntimePackageStaging();
      if (!release.released) {
        logger.warn({
          err: release.error,
          tag: "runtime-package",
          stagingRoot: release.stagingRoot
        }, "Runtime package staging directory could not be removed");
      }
    }
    // Only the extra LINK goes here, never the cache file: removing the last
    // name for the inode is exactly what must not happen until the archive has
    // settled, and removing the cache entry itself would defeat the verified
    // cache the next export depends on. Runs on success, failure and abort.
    if (releaseMirrorRegistryStaging) {
      const release = releaseMirrorRegistryStaging();
      if (!release.released) {
        logger.warn({
          err: release.error,
          tag: "mirror-registry",
          stagingRoot: release.stagingRoot
        }, "Mirror registry export staging directory could not be removed");
      }
    }
  }
};

// Path traversal protection: whitelist allowed base directories for filesystem operations
const ALLOWED_BASE_PATHS = [
  path.resolve(process.env.DATA_DIR || "/data"),
  "/tmp"
];

function isPathAllowed(requestedPath) {
  const resolved = path.resolve(requestedPath);
  // Boundary-aware, not a bare string prefix: `/datax` and `/tmpfoo` are
  // siblings of the allowed roots, not children of them, and a bare
  // startsWith admitted both. The root itself stays allowed.
  return ALLOWED_BASE_PATHS.some(
    (base) => resolved === base || resolved.startsWith(base.endsWith(path.sep) ? base : base + path.sep)
  );
}

// The mirror-output export boundary used to live here as isExportableDirectory,
// a lexical prefix test plus a four-name credential blacklist. It was bypassed
// by a symlink lexically inside an allowed root, by a symlinked parent, and by
// any credential file named something the blacklist did not list. It now lives
// in ./mirrorOutputPolicy.js, which canonicalises with realpath and walks the
// tree, and is applied before the response headers commit so an unsafe path
// fails as a 400 instead of producing a ZIP with a silent omission.

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
        logger.debug({ err, name: item.name }, "Stat failed for directory entry");
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
  // Every branch below answers with JSON, but buildBundleZip may already have
  // set Content-Type: application/zip and Content-Disposition: attachment.
  // Express does not replace an explicitly-set Content-Type, so res.json()
  // would ship "application/zip; charset=utf-8" and the browser would save the
  // error object as bundle.zip. Clear both before any of the responses below.
  //
  // Guarded, not unconditional: removeHeader throws ERR_HTTP_HEADERS_SENT once
  // the headers are on the wire, which would turn a handled error into a
  // second, unhandled one. Reaching here post-flush is not believed possible
  // (that path truncates through failBundleStream), but this handler is the
  // error path and must not be the thing that throws.
  if (!res.headersSent) {
    res.removeHeader("Content-Disposition");
    res.removeHeader("Content-Type");
  }

  // DOC-102 Slice 5F.13: Handle unsupported version errors from bundle generation
  //
  // FIELD_GUIDE_VERSION_ERROR is mapped alongside CONFIGURATION_VALIDATION
  // (400). It is raised when a CLIENT-supplied state's version sources
  // contradict each other — e.g. `version.selectedMinor` says 4.20 while a
  // stale `version.selectedVersion` says 4.22.16, which a partial POST to
  // /api/state can leave behind because that endpoint merges. Falling through
  // to the 500 default reported a server fault for a client-input condition.
  // No new taxonomy: this reuses the existing validation status and surfaces
  // the error's own stable code.
  if (error.code === 'UNSUPPORTED_VERSION') {
    return res.status(422).json({
      error: error.message,
      code: error.code,
      requestedVersion: error.requestedVersion,
      supportedVersions: error.supportedVersions
    });
  }
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
  if (error.code === 'CONFIGURATION_VALIDATION' || error.code === 'FIELD_GUIDE_VERSION_ERROR') {
    return res.status(400).json({ error: error.message, code: error.code });
  }
  // A refused mirror-output directory is caller input, not a server fault.
  // Answered as a clean 400 because the check runs before headers commit;
  // the message names the offending entry but never the resolved absolute
  // path, so this cannot be used as a filesystem oracle.
  if (error instanceof MirrorOutputPolicyError) {
    return res.status(400).json({ error: error.message, code: error.code });
  }
  return res.status(500).json({ error: String(error?.message || error) });
};

app.post("/api/bundle.prepare", validateBody(bundlePrepareSchema), (req, res) => {
  const parsed = parseOptionalClientState(req.body?.state, ensureState);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const state = parsed.state;

  // DOC-102 Slice 5F.13: Unsupported version guard before bundle.prepare
  // Migrate to v3 and check support before issuing token
  try {
    const stateMigrationResult = migrateStateToV3(state);
    if (stateMigrationResult.error) {
      return res.status(400).json({
        error: "State migration failed",
        details: [{ path: "state._schemaVersion", message: stateMigrationResult.error }]
      });
    }
    const v3State = stateMigrationResult.migrated;
    assertSupportedOpenShiftVersion(v3State);
  } catch (error) {
    if (error.code === 'UNSUPPORTED_VERSION') {
      return res.status(422).json({
        error: error.message,
        code: error.code,
        requestedVersion: error.requestedVersion,
        supportedVersions: error.supportedVersions
      });
    }
    return res.status(500).json({ error: String(error?.message || error) });
  }

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

app.post("/api/bundle.zip", validateBody(bundleZipSchema), async (req, res) => {
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
  // Refuse to serve a mispackaged build. Every data loader fails closed, so a
  // missing canonical data root would otherwise start normally and surface as
  // "No architecture-support matrix is available" inside a user's YAML
  // preview. See backend/src/canonicalDataIntegrity.js.
  try {
    assertCanonicalDataAvailable();
  } catch (err) {
    console.error(`\nFATAL: ${err.message}\n`);
    process.exit(1);
  }

  // BIND THE ADDRESS THAT WAS VALIDATED, not whatever Node defaults to.
  //
  // This used to be `app.listen(port)`. With no host argument Node binds the
  // unspecified address (`::`, i.e. every interface), so the loopback check in
  // accessControl.js was validating a variable nothing consumed: unauthenticated
  // mode passed its own guard and then served the whole network. The address is
  // resolved in one place and bound here; backend/test/listener-bind-boundary.test.js
  // connects over a real interface to prove the two still agree.
  server = app.listen(port, accessControlConfig.bindAddress, () => {
    const bound = server.address();
    // Match /api/build-info (APP_*); optional GIT_SHA / BUILD_TIME for alternate injectors.
    const bannerSha = (process.env.APP_GIT_SHA || process.env.GIT_SHA || process.env.BUILD_GIT_SHA || "").trim();
    const bannerTime = (process.env.APP_BUILD_TIME || process.env.BUILD_TIME || "").trim();
    const bannerLines = [
      "",
      "╔═══════════════════════════════════════════════════════════════════╗",
      "║                                                                   ║",
      "║          OpenShift Airgap Architect - Backend Server             ║",
      "║                                                                   ║",
      "╚═══════════════════════════════════════════════════════════════════╝",
      "",
      `  Server:        http://localhost:${port}`,
      `  Listening on:  ${accessControlConfig.bindAddress}:${bound?.port ?? port}` +
        (accessControlConfig.bindLoopbackOnly
          ? " (loopback only)"
          : accessControlConfig.bindContainerException
            ? ` (container network namespace — ${accessControlConfig.bindContainerEvidence};` +
              " host exposure is decided by the container engine's port publishing, not by this process)"
            : ""),
      `  Auth mode:     ${accessControlConfig.mode}`,
      `  Mode:          ${process.env.MOCK_MODE === "true" ? "MOCK" : "Production"}`,
      `  Data Dir:      ${process.env.DATA_DIR || "/data"}`,
    ];
    // Version, revision and build time are independent facts. An absent or
    // "unknown" revision is omitted — it does not make this a "dev" build.
    bannerLines.push(`  Version:       ${readAppVersion()}`);
    if (bannerSha && bannerSha.toLowerCase() !== "unknown") {
      bannerLines.push(`  Revision:      ${bannerSha.slice(0, 7)}`);
    }
    if (bannerTime && bannerTime.toLowerCase() !== "unknown") {
      bannerLines.push(`  Built:         ${bannerTime}`);
    }
    bannerLines.push(
      "",
      "  Developed by:  Bill Strauss",
      "  AI Assistance: Claude (Anthropic) • Cursor AI",
      "  License:       MIT",
      "  Repository:    https://github.com/bstrauss84/openshift-airgap-architect",
      "",
      "───────────────────────────────────────────────────────────────────",
      "",
    );
    // Use process.stdout.write for startup banner (visual output, not a log event)
    process.stdout.write(bannerLines.join("\n") + "\n");
    logger.info(
      {
        tag: "startup",
        port,
        // Machine-readable, so an operator or a test can assert the real
        // listening socket rather than inferring it from configuration.
        boundAddress: bound?.address ?? accessControlConfig.bindAddress,
        boundPort: bound?.port ?? port,
        authMode: accessControlConfig.mode,
        loopbackOnly: accessControlConfig.bindLoopbackOnly,
        containerNetworkException: accessControlConfig.bindContainerException,
        mode: process.env.MOCK_MODE === "true" ? "MOCK" : "Production",
        dataDir: process.env.DATA_DIR || "/data"
      },
      "Server started"
    );

    // PROD-012: Automated job cleanup/retention policy
    // Run daily cleanup to prevent unbounded database growth
    const retentionDays = parseInt(process.env.JOB_RETENTION_DAYS, 10) || 7;
    const maxJobCount = parseInt(process.env.JOB_MAX_COUNT, 10) || 100;
    const cleanupIntervalMs = 24 * 60 * 60 * 1000; // 24 hours

    // Run initial cleanup on startup (after 60 seconds to allow any startup
    // jobs to complete). Stored globally so shutdown can clear it too.
    global.startupCleanupTimeout = setTimeout(() => {
      try {
        const result = cleanupOldJobs({ retentionDays, maxCount: maxJobCount });
        if (result.totalDeleted > 0) {
          logger.info({ tag: "job_cleanup", ...result, retentionDays, maxJobCount }, "Job cleanup completed on startup");
        }
      } catch (err) {
        logger.error({ err, tag: "job_cleanup" }, "Job cleanup failed on startup");
      }
    }, 60000);

    // Schedule daily cleanup (stored globally to clear on shutdown)
    global.cleanupInterval = setInterval(() => {
      try {
        const result = cleanupOldJobs({ retentionDays, maxCount: maxJobCount });
        if (result.totalDeleted > 0) {
          logger.info({ tag: "job_cleanup", ...result, retentionDays, maxJobCount }, "Scheduled job cleanup completed");
        }
      } catch (err) {
        logger.error({ err, tag: "job_cleanup" }, "Scheduled job cleanup failed");
      }
    }, cleanupIntervalMs);
  });
  const shutdown = createShutdownHandler({
    getServer: () => server,
    activeProcesses,
    updateJob,
    getJob,
    releaseAllTempArtifacts,
    clearTimers: () => {
      if (global.cleanupInterval) {
        clearInterval(global.cleanupInterval);
        global.cleanupInterval = null;
      }
      if (global.startupCleanupTimeout) {
        clearTimeout(global.startupCleanupTimeout);
        global.startupCleanupTimeout = null;
      }
    },
    logger
  });
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function clearUpdateInfoCache() {
  updateInfoCache = null;
}

export {
  app,
  // DOC-227: exported so the dependency model can be asserted directly rather
  // than only through HTTP.
  PREVIEW_ARTIFACTS,
  buildPreviewArtifacts,
  buildPreviewFiles,
  clearUpdateInfoCache,
  resolveOcMirrorArtifactsBaseDir,
  parseSignatureErrors,
  writePerImageRegistriesDConfigs
};
