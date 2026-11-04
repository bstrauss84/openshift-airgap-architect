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
import crypto from "node:crypto";
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
import { recordedToolIdentity, compareToolIdentity, localToolIdentity } from "./ocMirrorIdentity.js";
import { resolveOcMirrorBinary, peekOcMirrorBinary, getRuntimeArch, getLocalBinaryArch, getBinariesForExportArch } from "./ocMirrorRuntime.js";
import { sharedPreflightItems, describeTrust, item as preflightItem, registryOfImage } from "./ocMirrorPreflightItems.js";
import { createExecutionPlan, describeOcMirrorTool, readExecutionPlan, isValidPlanId } from "./mirroringPlan.js";
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
  listWorkflowJobSummaries,
  redactJobOutputForStorage,
  deleteCompletedJobs,
  cleanupOldJobs,
  getJobsCount,
  writeTempAuth,
  secretTempDir,
  secretTempLocation,
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
import { isWithinCliLimit, cliLimitMessage } from "../../shared/ocMirrorCliLimits.js";
import { buildUpdateInfo } from "./releaseUpdateCheck.js";
import { createRuntimePackageArtifacts } from "./runtimePackage.js";
import { getOpenShiftMinorFromState, getOpenShiftMinorFromSources } from "./openShiftMinor.js";
import { assertSupportedOpenShiftMinorForGeneration, isSupportedMinor, buildUnsupportedVersionError } from "./versionPolicy.js";
import { getMinorVersion } from "../../shared/versionUtils.js";
// validateArchiveBuffer and ZIP_LIMITS are intentionally not imported here: the
// only route that used them was the withdrawn /api/bundle.import (see below).
// They remain exported from exportIntegrity.js for its own unit tests and for
// the eventual DOC-127 validator UI.
import { createIntegrityTracker, MANIFEST_FILENAME } from "./exportIntegrity.js";
import { trackTempArtifact, untrackTempArtifact, releaseAllTempArtifacts } from "./tempArtifacts.js";
import { createShutdownHandler } from "./shutdown.js";
import { activeProcesses } from "./processRegistry.js";
import { isTerminalJobStatus } from "./jobStatus.js";
import { createRunResources } from "./ocMirrorRunResources.js";
import {
  emptyMirroringSlice,
  normalizeMirroringSlice,
  normalizeProfile,
  isValidProfileId,
  newProfileId,
  profilePaths,
  validateProfileStructure,
  findUnsupportedProfileVersion,
  generationReadiness,
  draftProfileView,
  projectProfileForGeneration,
  describeProfile,
  profileWarnings,
  parseExactMinor,
  deriveCatalogMinor,
  reconcileCatalogConflict,
  MAX_PROFILES,
  operatorVerificationState,
  receivedDir,
  isCalendarDate
} from "./mirroringState.js";
import { prepareTransfer, verifyTransfer, stageTransfer, checkStaged, insideReceivedCopy, stagingSpaceProblem, hashArchive, TRANSFER_DIR } from "./mirroringTransfer.js";
import { readHistory, cycleRecord, cycleDecision, destinationKey } from "./mirroringCycle.js";
import { protectBeforeRun, keepRunArchives } from "./mirroringArchives.js";
import { workspaceRegistriesDir, snapshotRegistriesD, restoreRegistriesD, restorePending, pendingSnapshot, parseSignatureErrors } from "./registriesDScope.js";
import { classifyRecovery } from "./mirroringRecovery.js";
import { verifyArchiveSet, parseMapping, verifyDestination } from "./mirroringVerify.js";
import { openVerifiedCatalog } from "./verifiedCatalog.js";
import { parseRegistryAuth, combineRegistryAuths, authFileDocument, RegistryAuthError } from "./registryAuth.js";
import { operationOf, linkOperations, sanitizedLog, contentSummaryOf, runOutcome, readRunErrorFile, snapshotErrorFiles } from "./mirroringOperations.js";
import { storageConfig, checkStorageBase, profileStorage, newProfileStorageBase, knownBases, isInside, storageChoiceLocked, locationProblem, mountedCandidates } from "./mirroringStorage.js";
import {
  runListOperators,
  parsePackageListing,
  parseChannelVersions,
  classifyLookupFailure,
  classifyFetchFailure,
  judgeOperator,
  storePackageDetails,
  getPackageDetails
} from "./operatorPackageLookup.js";
import {
  analyzeFiles as analyzeImportFiles,
  detectMergeConflicts,
  mergeSources,
  profileAsSource,
  importSizeProblem,
  sanitizeFileName
} from "./mirroringImport.js";
import {
  reserveOcMirrorRun,
  releaseOcMirrorRunReservation,
  runInProgressBody
} from "./ocMirrorRunGuard.js";
import { resolveExternalConfigPath, checkImageSetConfigContent } from "./externalConfigPolicy.js";
import {
  assertImageSetConfigStructure,
  loadImageSetConfigSchema,
  ImageSetConfigInvalidError,
  ImageSetSchemaUnavailableError
} from "./imagesetConfigValidator.js";
import { sanitizeStateForPersistence, sanitizeCredentialFields, stripProxyCredentials } from "./stateSanitizer.js";
import { assertExportableMirrorOutput, MirrorOutputPolicyError } from "./mirrorOutputPolicy.js";
import {
  validateBody,
  stateUpdateSchema,
  sshKeypairSchema,
  operatorScanSchema,
  ocMirrorPreflightSchema,
  ocMirrorRunSchema,
  mirroringProfileWriteSchema,
  mirroringEmptySchema,
  mirroringReconcileCatalogSchema,
  mirroringImportSchema,
  mirroringImportReviewSchema,
  mirroringActiveSchema,
  mirroringVerifyCatalogsSchema,
  mirroringReceiveSchema,
  mirroringTransferPrepareSchema,
  mirroringStorageChoiceSchema,
  mirroringRetrySchema,
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

// API responses can carry credentials (request bodies) and tool output: never
// stored by browsers or intermediaries. A route may still set its own policy.
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

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
  // DATA_DIR/tmp, plus this instance's own private credential directory
  // (unique to this DATA_DIR, see utils.js secretTempLocation).
  const dirs = [...new Set([path.join(dataDir, "tmp"), secretTempDir()])];
  let removed = 0;
  let failed = 0;
  for (const tmpDir of dirs) {
    try {
      if (!fs.existsSync(tmpDir)) continue;
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
    }
  }
  if (removed > 0 || failed > 0) {
    logger.info({ tag: "startup", removed, failed }, "Swept temp artifacts from a previous run");
  }
};

sweepAbandonedTempArtifacts();

// Signature exemptions are scoped to one oc-mirror run (registriesDScope.js);
// one a crashed run left in a workspace is undone before anything else runs.
const REGISTRIES_D_LEDGER = path.join(dataDir, "registries-d-pending.json");
for (const r of restorePending(REGISTRIES_D_LEDGER)) {
  if (r.ok) logger.info({ tag: "startup", dir: r.dir }, "Restored a workspace registries.d left by an interrupted signature retry");
  else logger.error({ tag: "startup", dir: r.dir, problem: r.problem }, "A workspace registries.d could not be restored; runs on that workspace are refused until it is");
}

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

// On the disconnected side (AIRGAP_RUNTIME_SIDE=high-side, set by the
// runtime package) the backend makes no Internet request on its own: no
// Cincinnati warm-up at start and no release update check (v2.2.0 M6).
const isHighSideRuntime = () => process.env.AIRGAP_RUNTIME_SIDE === "high-side";
if (!isHighSideRuntime()) warmCincinnatiCache();

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

/**
 * Pull secret for content that does not come from Red Hat registries (v2.2.0
 * M5: a Mirroring profile with additional images only). None is fine —
 * oc-mirror then pulls anonymously; one that is given must still be valid.
 */
function validateOptionalPullSecret(secret) {
  if (!secret || typeof secret !== "string" || secret.trim().length === 0) return { valid: true, absent: true };
  let parsed;
  try {
    parsed = JSON.parse(secret);
  } catch {
    return { valid: false, error: "The pull secret must be valid JSON." };
  }
  if (!parsed?.auths || typeof parsed.auths !== "object") return { valid: false, error: "The pull secret must contain an 'auths' object." };
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
  // The Mirroring slice is owned by the /api/mirroring routes and is not part
  // of an Install run: GET /api/state, the run export and the runtime-package
  // payload all describe the Install workflow only (v2.2.0 M1).
  if (next && "mirroring" in next) delete next.mirroring;
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
  // A missing path is created with `mkdir -p` by the run, so what matters is
  // the nearest directory that exists: whether it is writable and how much
  // space it has. Checking only the immediate parent failed (df: No such file)
  // for any path two levels below an existing directory — every new Mirroring
  // profile (v2.2.0 M5) and a first Install run on a fresh volume.
  let parent = resolved;
  while (!fs.existsSync(parent) && path.dirname(parent) !== parent) parent = path.dirname(parent);
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

export const GENERATED_SSH_KEY_COMMENT = "openshift-airgap-architect-generated";

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
  // A fixed, neutral comment: without -C, ssh-keygen labels the key with this
  // server's user@hostname (a workstation's account and internal domain, or a
  // container's user and id), which then travels into install-config sshKey.
  const args = ["-N", "", "-C", GENERATED_SSH_KEY_COMMENT, "-f", keyPath];
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
  const result = await buildUpdateInfo({
    installedVersion: readAppVersion(),
    env: isHighSideRuntime() ? { ...process.env, CHECK_UPDATES: "false" } : process.env
  });
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
  // Server-owned slice (v2.2.0 M1): the Install wizard persists its whole state
  // on a debounce, so accepting `mirroring` here would let a stale browser copy
  // overwrite profiles written through /api/mirroring. The current slice is
  // kept by the merge below.
  if ("mirroring" in patch) delete patch.mirroring;

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

/**
 * Temp artifacts (generated config, registry auth file, registries.d dir) of
 * each running oc-mirror job, so a Start Over that must leave that job alone
 * also leaves its files alone. Entries are removed when the child settles.
 * @type {Map<string, string[]>}
 */
const runTempArtifactsByJob = new Map();

const isMirroringJob = (jobId) => getJobMetadata(jobId)?.workflow === "mirroring";

const runningOcMirrorJobs = () => listJobsByType("oc-mirror-run").filter((job) => job.status === "running");

const cancelOcMirrorJob = (job, message) => {
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
    message,
    progress: 0
  });
};

/** Paths a running job still needs; temp cleanup must not delete them. */
const protectedTempPaths = (jobs) => {
  const out = [];
  for (const job of jobs) {
    for (const p of runTempArtifactsByJob.get(job.id) || []) {
      try { out.push(fs.realpathSync(p)); } catch { /* already gone */ }
    }
  }
  return out;
};

app.post("/api/start-over", validateBody(startOverSchema), (req, res) => {
  const cancelRunningOcMirror = req.body?.cancelRunningOcMirror !== false;
  // Install Start Over is scoped to the Install workflow (v2.2.0 M1): it never
  // cancels a Mirroring job, never deletes that job's temp files and never
  // resets the Mirroring slice.
  const mirroringRuns = runningOcMirrorJobs().filter((job) => isMirroringJob(job.id));
  if (cancelRunningOcMirror) {
    const installRuns = runningOcMirrorJobs().filter((job) => !isMirroringJob(job.id));
    for (const job of installRuns) {
      cancelOcMirrorJob(job, "Cancelled by Start Over.");
    }
  }
  const preservedMirroring = ensureState().mirroring;
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
  setState(preservedMirroring ? { ...next, mirroring: preservedMirroring } : next);
  const keepPaths = protectedTempPaths(mirroringRuns);
  const tmpDir = path.join(process.env.DATA_DIR || "/data", "tmp");
  if (fs.existsSync(tmpDir)) {
    fs.readdirSync(tmpDir).forEach((file) => {
      const fullPath = path.join(tmpDir, file);
      try {
        const realPath = fs.realpathSync(fullPath); // Resolve symlinks
        if (keepPaths.includes(realPath)) return;
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
      details: err.issues || String(err)
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
  // An Install run import replaces the Install workflow only (v2.2.0 M1). A
  // bundle cannot carry Mirroring profiles in, and importing one does not
  // erase the profiles already here.
  delete sanitized.mirroring;
  const currentMirroring = ensureState().mirroring;
  setState(currentMirroring ? { ...sanitized, mirroring: currentMirroring } : sanitized);
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

const sendUnsupportedVersion = (res, vErr, extra = {}) =>
  res.status(422).json({ error: vErr.message, code: vErr.code, requestedVersion: vErr.requestedVersion, supportedVersions: vErr.supportedVersions, ...extra });

/**
 * Neutral version lock (v2.2.0 M1). Locks a workflow's OWN `{release, version}`
 * pair and returns the locked pair; it writes nothing. Install locks its global
 * release through POST /api/operators/confirm (unchanged contract); a Mirroring
 * profile locks its own platform release through
 * POST /api/mirroring/profiles/:id/lock. Neither can touch the other's lock.
 * Returns `{ error }` (UNSUPPORTED_VERSION) for an unsupported minor.
 */
const buildLockedVersionSelection = (source) => {
  const confirmMinor = getOpenShiftMinorFromState(source);
  if (confirmMinor && !isSupportedMinor(confirmMinor)) {
    return { error: buildUnsupportedVersionError(confirmMinor) };
  }
  const release = { ...source.release, confirmed: true };
  // DOC-101 Phase 1: Use v3 canonical fields (locked, selectedMinor, selectedPatch, _schemaVersion)
  // Preserve existing v3 schema marker and locked state if already set
  const version = {
    _schemaVersion: source.version?._schemaVersion ?? 3,  // v3 schema marker
    selectedMinor: source.release?.channel || source.version?.selectedMinor || null,
    selectedPatch: source.release?.patchVersion || source.version?.selectedPatch || null,
    selectedChannel: source.release?.channel ? `stable-${source.release.channel}` : null,
    selectedVersion: source.release?.patchVersion || null,
    selectionTimestamp: source.version?.selectionTimestamp || Date.now(),
    confirmedByUser: true,
    confirmationTimestamp: Date.now(),
    locked: true  // v3 canonical lock field
  };
  return { release, version };
};

app.post("/api/operators/confirm", validateBody(operatorConfirmSchema), (req, res) => {
  const state = ensureState();
  const locked = buildLockedVersionSelection(state);
  if (locked.error) return sendUnsupportedVersion(res, locked.error);
  // F19 (v2.2.0 M5): the lock used to confirm whatever release the server held,
  // including none at all — a lock that raced the client's debounced save stored
  // `confirmed: true` with no channel, which POST /api/state then refused (400)
  // and generation could not resolve (422). Lock only a complete selection,
  // exactly as the Mirroring profile lock already requires.
  if (!state.release?.channel || !state.release?.patchVersion) {
    return res.status(409).json({
      error: "Select an OpenShift release and patch before locking.",
      code: "RELEASE_SELECTION_INCOMPLETE"
    });
  }
  const { release, version } = locked;
  updateState({ release, version });
  res.json({ ok: true, release, version });
});

/**
 * Catalog minor for a scan/prefetch request (v2.2.0 M1). A Mirroring caller
 * names its catalog minor explicitly; it must be an exact, supported minor and
 * the Install lock is then irrelevant. Without one, the Install behaviour is
 * unchanged: the Install release must be confirmed and supplies the minor.
 * Returns { minor } (possibly null for the Install path, resolved later),
 * or { status, body } to send.
 */
const resolveRequestedCatalogMinor = (body) => {
  if (body?.catalogMinor === undefined) return { explicit: false, minor: null };
  const exact = parseExactMinor(body.catalogMinor);
  if (!exact) return { status: 400, body: { error: "catalogMinor must be a minor version such as 4.22." } };
  if (!isSupportedMinor(exact)) {
    const vErr = buildUnsupportedVersionError(exact);
    return { status: 422, body: { error: vErr.message, code: vErr.code, requestedVersion: vErr.requestedVersion, supportedVersions: vErr.supportedVersions } };
  }
  return { explicit: true, minor: exact };
};

app.post("/api/operators/scan", validateBody(operatorScanSchema), async (req, res) => {
  // Do not log req.body; it may contain pullSecret. Do not persist pullSecret.
  const state = ensureState();
  const requested = resolveRequestedCatalogMinor(req.body);
  if (requested.status) return res.status(requested.status).json(requested.body);
  if (!requested.explicit && !state.release?.confirmed) {
    return res.status(400).json({ error: "Version not confirmed." });
  }
  // Mirroring names its source credential explicitly (rhAuthSource), exactly as
  // its runs and live checks do: "mounted" = the server's mounted Red Hat pull
  // secret, "inline" = the pull secret in this request. Neither falls back to
  // REGISTRY_AUTH_FILE, which stays the Install workflow's scan credential.
  const mirroringAuth = req.body?.rhAuthSource || null;
  if (mirroringAuth && !requested.explicit) {
    return res.status(400).json({ error: "rhAuthSource is for Mirroring scans, which name their catalogMinor.", code: "REGISTRY_AUTH_INVALID" });
  }
  if (req.body?.profileId && !readMirroringSlice().profiles[req.body.profileId]) {
    return res.status(404).json({ error: "No Mirroring profile with that id.", code: "PROFILE_NOT_FOUND" });
  }
  if (mirroringAuth === "mounted" && !mountedRhPullSecret) {
    return res.status(400).json({ error: "No Red Hat pull secret is mounted on the server. Paste the pull secret for this scan instead.", code: "REGISTRY_AUTH_MISSING" });
  }
  if (mirroringAuth === "inline" && !req.body?.pullSecret) {
    return res.status(400).json({ error: "Paste the Red Hat pull secret for this scan (or use the pull secret mounted on the server, if there is one).", code: "REGISTRY_AUTH_MISSING" });
  }
  if (!mirroringAuth && !authAvailable() && !req.body?.pullSecret && String(process.env.MOCK_MODE).toLowerCase() !== "true") {
    return res.status(400).json({ error: "Registry auth not configured." });
  }
  if (String(process.env.MOCK_MODE).toLowerCase() === "true") {
    const catalogMinor = requested.minor ?? getOpenShiftMinorFromState(state);
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
  // Version boundary first (No Fallback), then the credential: nothing is
  // written for a request that is refused anyway.
  const catalogMinor = requested.minor ?? getOpenShiftMinorFromState(state);
  if (!catalogMinor) {
    return res.status(400).json({
      error: "OpenShift release minor is not set. Select minor channel and patch in Blueprint (or ensure patchVersion is set)."
    });
  }
  if (!isSupportedMinor(catalogMinor)) {
    const vErr = buildUnsupportedVersionError(catalogMinor);
    return res.status(422).json({ error: vErr.message, code: vErr.code, requestedVersion: vErr.requestedVersion, supportedVersions: vErr.supportedVersions });
  }
  let tempAuthFile = null;
  const sourceSecret = mirroringAuth === "mounted" ? mountedRhPullSecret : req.body?.pullSecret;
  if (sourceSecret) {
    let doc;
    try { doc = authFileDocument(parseRegistryAuth(sourceSecret, mirroringAuth === "mounted" ? "mounted pull secret" : "pull secret")); } catch (err) {
      return res.status(400).json({ error: err instanceof RegistryAuthError ? err.message : "The pull secret could not be read.", code: "REGISTRY_AUTH_INVALID" });
    }
    tempAuthFile = writeTempAuth(doc);
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
  // Mirroring scans are listed in Mirroring Operations; the three catalog jobs of
  // one request share a scanId. Install scans carry no workflow tag (unchanged).
  const scanMetadata = requested.explicit && req.body?.profileId
    ? { workflow: "mirroring", profileId: req.body.profileId, scanId: nanoid(), authSource: mirroringAuth || (tempAuthFile ? "inline" : "mounted") }
    : null;
  for (const catalog of catalogsToScan) {
    const jobId = runScanJob({
      metadata: scanMetadata,
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
  const requested = resolveRequestedCatalogMinor(req.body);
  if (requested.status) return res.status(requested.status).json(requested.body);
  if (!requested.explicit && !state.release?.confirmed) {
    return res.status(400).json({ error: "Version not confirmed." });
  }
  if (!authAvailable()) {
    return res.status(400).json({ error: "Registry auth not configured." });
  }
  const catalogMinor = requested.minor ?? getOpenShiftMinorFromState(state);
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

/**
 * oc-mirror preflight, shared by the Install route and the Mirroring profile
 * route (v2.2.0 M1). Returns `{ status, json }`.
 *
 * `opts.workflow === "mirroring"` changes exactly one rule: Mirroring never
 * reuses the Install workflow's stored mirror-registry credentials.
 */
async function computeOcMirrorPreflight(state, body, opts = {}) {
  const isMirroring = opts.workflow === "mirroring";
  const mode = body.mode || "mirrorToDisk";
  const archivePath = body.archivePath?.trim() || "";
  const workspacePath = body.workspacePath?.trim() || "";
  // oc-mirror uses its cache in ALL three workflows, mirrorToMirror included
  // (verified against the shipped 4.22 binary: without --cache-dir it creates
  // $HOME/.oc-mirror/.cache, with it <cache-dir>/.oc-mirror/.cache). The run
  // route falls back to the stored Install cache path, so preflight checks the
  // same path the run will use.
  const cachePath = body.cachePath?.trim()
    || (mode === "mirrorToMirror" && !isMirroring ? state.mirrorWorkflow?.cachePath?.trim() || "" : "");
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
    return { status: 400, json: { error: "Invalid mode." } };
  }

  const pathOverlapBlockers = checkPathOverlap(
    mode !== "mirrorToMirror" ? archivePath : null,
    workspacePath,
    cachePath || null,
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
    if (mode === "mirrorToMirror" && !cachePath) {
      checks.cachePath = null;
      warnings.push("No cache path is set, so oc-mirror will use $HOME/.oc-mirror/.cache, which every run without a cache path shares.");
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

  let externalConfigRealPath = null;
  if (configSourceType === "generated") {
    checks.config = "present";
  } else if (configPath) {
    const resolvedConfig = resolveExternalConfigPath(configPath, ALLOWED_BASE_PATHS);
    if (resolvedConfig.ok) {
      checks.config = "present";
      externalConfigRealPath = resolvedConfig.realPath;
    } else {
      checks.config = "missing";
      blockers.push(resolvedConfig.message);
      fieldErrors.configPath = { severity: "blocker", message: resolvedConfig.message };
    }
  } else {
    const msg = "Config path is required when using external config.";
    blockers.push(msg);
    fieldErrors.configPath = { severity: "blocker", message: msg };
  }

  // Auth checks per mode
  if (mode === "mirrorToDisk" || mode === "mirrorToMirror") {
    // Red Hat registry credentials are required when the content comes from
    // Red Hat (always for Install; for a Mirroring profile with platform or
    // operator content). Additional images only: optional (M5).
    const validation = opts.pullSecretPolicy === "optional" ? validateOptionalPullSecret(rhPullSecret) : validateRhPullSecret(rhPullSecret);
    if (validation.valid && validation.absent) {
      checks.auth = "absent";
    } else if (validation.valid) {
      checks.auth = "present";
    } else {
      checks.auth = "missing";
      blockers.push(validation.error);
      fieldErrors.rhPullSecret = { severity: "blocker", message: validation.error };
    }
  }
  if (mode === "diskToMirror" || mode === "mirrorToMirror") {
    let mirrorSecretPresent = false;
    if (isMirroring && mirrorAuthSource === "reuse") {
      const msg = "Mirroring does not reuse the Install workflow's mirror registry credentials. Provide the mirror registry credentials for this run.";
      blockers.push(msg);
      fieldErrors.mirrorPullSecret = { severity: "blocker", message: msg };
    } else if (mirrorAuthSource === "reuse") {
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
  // Ranges the binary enforces (F12): it refuses anything outside 1–10.
  for (const [key, label] of [["parallelImages", "Parallel images"], ["parallelLayers", "Parallel layers"]]) {
    if (advanced[key] != null && !isWithinCliLimit(key, Number(advanced[key]))) {
      const msg = cliLimitMessage(key, label);
      blockers.push(msg);
      fieldErrors[key] = { severity: "blocker", message: msg };
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
  // Note: 'strictArchive' is harder to validate, skip for now.
  // --since is honoured only by mirrorToDisk (the shipped binary warns "since
  // flag is only taken into account during mirrorToDisk workflow" for
  // diskToMirror and ignores it for mirrorToMirror), so it is not passed for
  // the other modes; say so rather than imply it took effect.
  // F23 (v2.2.0 M6): oc-mirror accepts only yyyy-MM-dd and refuses anything
  // else ("--since flag needs to be in format yyyy-MM-dd"), verified on 4.22.19.
  if (advanced.since && mode === "mirrorToDisk" && !isCalendarDate(String(advanced.since))) {
    const msg = "Since must be a date as yyyy-MM-dd, for example 2026-01-31 (the only format oc-mirror accepts).";
    blockers.push(msg);
    fieldErrors.since = { severity: "blocker", message: msg };
  }
  if (advanced.since && mode !== "mirrorToDisk") {
    warnings.push("The --since option applies only to mirror-to-disk runs and will not be passed for this mode.");
  }

  // Generated config: the same structural validator the run applies, so a
  // generator defect is a preflight blocker rather than a failed run (M4).
  // Only structural findings are reported here; version and lock problems
  // have their own checks and messages.
  if (configSourceType === "generated" && typeof opts.buildGeneratedConfig === "function") {
    try {
      opts.buildGeneratedConfig();
    } catch (error) {
      if (error instanceof ImageSetConfigInvalidError) {
        for (const f of error.errors) blockers.push(`Generated ImageSetConfiguration: ${f.message}`);
      } else if (error instanceof ImageSetSchemaUnavailableError) {
        blockers.push(error.message);
      }
    }
  }

  // External config validation: the shared oc-mirror v2 structural validator
  // (externalConfigPolicy.js -> imagesetConfigValidator.js).
  if (configSourceType !== "generated" && externalConfigRealPath && checks.config === "present") {
    try {
      const configContent = fs.readFileSync(externalConfigRealPath, "utf8");
      const result = checkImageSetConfigContent(configContent);
      for (const msg of result.blockers) {
        blockers.push(msg);
        fieldErrors.configPath = { severity: "blocker", message: msg };
      }
      for (const msg of result.warnings) {
        warnings.push(msg);
        if (!fieldErrors.configPath) fieldErrors.configPath = { severity: "warning", message: msg };
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

  // Structured checks for the UI (v2.2.0 M5): the binary a run would use
  // (found without downloading), and how registry certificates are trusted.
  const peek = peekOcMirrorBinary();
  let tool = peek;
  if (peek && !peek.error) {
    try {
      tool = { ...peek, tool: await describeOcMirrorTool(peek) };
    } catch (err) {
      tool = { error: `The oc-mirror binary at ${peek.path} could not be inspected: ${String(err?.message || err)}` };
    }
  }
  if (tool?.error) blockers.push(tool.error);
  const trust = describeTrust();
  if (trust.status === "block") blockers.push(trust.detail);
  const items = sharedPreflightItems({
    mode, checks, fieldErrors, archivePath, workspacePath, cachePath, registryUrl, configSourceType,
    rhPullSecret, rhAuthSource, mirrorPullSecret: body.mirrorPullSecret || null, tool, trust,
    redHatContent: opts.pullSecretPolicy !== "optional", imageRegistries: opts.imageRegistries || []
  });

  const ok = blockers.length === 0;
  return { status: 200, json: { ok, blockers, warnings, checks, fieldErrors, items } };
}

app.post("/api/ocmirror/preflight", validateBody(ocMirrorPreflightSchema), async (req, res) => {
  const state = ensureState();
  const result = await computeOcMirrorPreflight(state, req.body || {}, {
    buildGeneratedConfig: () => {
      const migrated = migrateStateToV3(state);
      if (migrated.error) return null;
      const locked = migrated.migrated.version?.locked ?? migrated.migrated.release?.confirmed;
      if (!locked) return null; // the run route refuses an unlocked release separately
      assertSupportedOpenShiftVersion(migrated.migrated);
      return buildCheckedImageSetConfig(migrated.migrated);
    }
  });
  res.status(result.status).json(result.json);
});

/** Build oc-mirror CLI args for v1 modes (contract §2B). */
function buildOcMirrorArgs(mode, configPath, archivePath, workspacePath, cachePath, registryUrl, dryRun, advanced, authFile, removeSignatures, registriesDDir = null) {
  const args = ["--config", configPath, "--v2"];
  if (authFile) args.push("--authfile", authFile);
  const adv = advanced || {};
  if (adv.logLevel) args.push("--log-level", String(adv.logLevel));
  if (adv.parallelImages != null) args.push("--parallel-images", String(adv.parallelImages));
  if (adv.parallelLayers != null) args.push("--parallel-layers", String(adv.parallelLayers));
  if (adv.imageTimeout) args.push("--image-timeout", String(adv.imageTimeout));
  if (adv.retryTimes != null) args.push("--retry-times", String(adv.retryTimes));
  if (adv.retryDelay) args.push("--retry-delay", String(adv.retryDelay));
  if (adv.since && mode === "mirrorToDisk") args.push("--since", String(adv.since));
  if (adv.strictArchive) args.push("--strict-archive");
  if (removeSignatures) args.push("--remove-signatures");
  // The only way oc-mirror reads a registries.d (it ignores CONTAINERS_REGISTRIES_D);
  // the copy it leaves in the workspace is undone after the run (registriesDScope.js).
  if (registriesDDir) args.push("--registries.d", registriesDDir);
  if (mode === "mirrorToMirror" && workspacePath) args.push("--workspace", `file://${path.resolve(workspacePath)}`);
  // All three workflows use the cache (verified against the shipped binary);
  // without --cache-dir mirrorToMirror fell back to $HOME/.oc-mirror/.cache.
  if (cachePath) {
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
 * Write per-image registries.d configs for failed images.
 * More granular than writeRegistriesDConfigs (which is per-registry hostname).
 *
 * Generates one YAML file per failing image path with format:
 * docker:
 *   <image-path>:
 *     use-sigstore-attachments: false
 */
function writePerImageRegistriesDConfigs(imagePathsArray, signatureOptions = null) {
  if (!imagePathsArray || imagePathsArray.length === 0) return null;
  // The retry must not verify more than the run it retries did: the hostnames
  // that run already exempted (signatureOptions) stay exempt, plus the failing
  // image paths. Nothing else is relaxed.
  const inheritedHosts = getRegistryHostnamesForSignatureDisabling(signatureOptions);

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
    for (const hostname of inheritedHosts) {
      const safeFilename = `inherited-${hostname.replace(/[/:]/g, "-")}.yaml`;
      fs.writeFileSync(path.join(registriesDDir, safeFilename), generateRegistriesDConfig(hostname), "utf8");
    }

    logger.info({ tag: "smart-retry", count: imagePathsArray.length, inherited: inheritedHosts.length, registriesDDir }, "Generated per-image registries.d configs");
    return registriesDDir;
  } catch (err) {
    logger.error({ err }, "Failed to write per-image registries.d configs");
    return null;
  }
}

/**
 * Automatically retry oc-mirror with per-image signature disabling.
 * Called when signature errors are detected in a completed_with_warnings run.
 *
 * F13 (v2.2.0 M5): the retry runs from the original run's in-memory context —
 * its resolved paths, options and config path — not from the credential-
 * stripped request body (which has no pull secret, no generated config path,
 * and no Mirroring profile paths). It TAKES the original run's resources
 * (config + auth file, see ocMirrorRunResources.js) and releases them exactly
 * once on every exit path: launch refused, launch failed, child error, child
 * close (completed, failed or stopped).
 *
 * @param {string} originalJobId
 * @param {string[]} signatureFailures image paths that failed signature reads
 * @param {object} runCtx the original run's context (see startReservedOcMirrorRun)
 * @returns {Promise<string|null>} the retry job id, or null when no retry ran
 */
async function retryWithPerImageSignatureDisable(originalJobId, signatureFailures, runCtx) {
  const { resources } = runCtx;
  logger.info({ tag: "smart-retry", originalJobId, signatureFailureCount: signatureFailures.length }, "Starting auto-retry for signature failures");

  if (!resources.configPath || (resources.configIsOurs && !fs.existsSync(resources.configPath))) {
    logger.error({ tag: "smart-retry", originalJobId }, "Cannot retry: the run's configuration is not available");
    updateJobMetadata(originalJobId, { signatureRetry: { state: "skipped", reason: "The run's configuration was no longer available, so no automatic retry was started." } });
    resources.release();
    return null;
  }

  const registriesDDir = writePerImageRegistriesDConfigs(signatureFailures, runCtx.removeSignatures ? null : runCtx.signatureOptions);
  if (!registriesDDir) {
    logger.error({ tag: "smart-retry" }, "Failed to generate registries.d configs");
    resources.release();
    return null;
  }

  // The retry is a new oc-mirror run, so it needs the single run slot. If the
  // operator started another run in the meantime, skip the retry rather than
  // run two at once.
  const retryToken = nanoid();
  const retryReservation = reserveOcMirrorRun(getJob, retryToken);
  if (!retryReservation.ok) {
    logger.warn({ tag: "smart-retry", originalJobId, activeJobId: retryReservation.activeJobId }, "Auto-retry skipped: another oc-mirror run is in progress");
    updateJobMetadata(originalJobId, { signatureRetry: { state: "skipped", reason: "Another oc-mirror run was in progress, so the automatic signature retry was skipped. Run this workflow again when that run has finished." } });
    cleanupRegistriesDDir(registriesDDir);
    resources.release();
    return null;
  }
  try {
    return await launchSignatureRetry();
  } finally {
    releaseOcMirrorRunReservation(retryToken);
  }

  async function launchSignatureRetry() {
    const { mode, dryRun, archivePath, workspacePath, cachePath, registryUrl, advanced } = runCtx;
    const retryJobId = createJob("oc-mirror-run", `Auto-retry (signature errors from job ${originalJobId})`);
    // From here until the child settles, this job owns the files; Start Over
    // leaves them alone while it runs.
    runTempArtifactsByJob.set(retryJobId, [...resources.paths(), registriesDDir]);
    // The exemption lasts for this retry only: the workspace copy oc-mirror
    // makes of it is put back afterwards (registriesDScope.js).
    const wsRegistriesD = workspaceRegistriesDir(mode, archivePath, workspacePath);
    let scopedExemption = false;
    const releaseAll = () => {
      runTempArtifactsByJob.delete(retryJobId);
      if (scopedExemption) {
        scopedExemption = false;
        const r = restoreRegistriesD(wsRegistriesD, REGISTRIES_D_LEDGER);
        if (!r.ok) {
          appendJobOutput(retryJobId, `\n${r.problem} Later runs on this workspace are refused until it is restored.\n`);
          updateJobMetadata(retryJobId, { registriesDRestoreProblem: r.problem });
        }
      }
      cleanupRegistriesDDir(registriesDDir);
      resources.release();
    };

    updateJobMetadata(retryJobId, {
      mode,
      dryRun,
      archiveDir: archivePath || "",
      workspaceDir: workspacePath,
      cacheDir: cachePath || "",
      registryUrl: registryUrl || "",
      configSourceType: runCtx.configSourceType,
      configPath: runCtx.configPathForRecord,
      startedAt: Date.now(),
      errorFilesBefore: snapshotErrorFiles(mode === "mirrorToMirror" ? [workspacePath] : [archivePath], { fsImpl: fs }),
      retryOf: originalJobId,
      signatureFailures,
      retryReason: "automatic signature error retry",
      ...(runCtx.planRecord ? { plan: runCtx.planRecord } : {}),
      // A retry belongs to the same workflow (and profile) as the run it retries.
      ...(runCtx.workflow === "mirroring" ? { workflow: "mirroring", profileId: runCtx.profileId || null } : {})
    });

    // Same command, except signatures are handled per repository through
    // --registries.d rather than --remove-signatures.
    const args = buildOcMirrorArgs(mode, resources.configPath, archivePath, workspacePath, cachePath, registryUrl, dryRun, advanced, resources.authFile, false, registriesDDir);

    const resolved = await resolveOcMirrorBinary(dataDir);
    if (resolved.error) {
      updateJob(retryJobId, { status: "failed", progress: 100, message: resolved.error, output: resolved.rawStderr || resolved.error });
      releaseAll();
      return retryJobId;
    }
    // A stop or Start Over can land while the binary resolves.
    if (isTerminalJobStatus(getJob(retryJobId)?.status)) {
      releaseAll();
      return retryJobId;
    }

    const { REGISTRY_AUTH_FILE: _drop, ...envWithoutRegistryAuthFile } = process.env;
    const envVars = { ...envWithoutRegistryAuthFile, ...(runCtx.envOverrides || {}) };
    if (!wsRegistriesD) {
      updateJob(retryJobId, { status: "failed", progress: 100, message: "Automatic signature retry is not available for this workflow." });
      releaseAll();
      return retryJobId;
    }
    try {
      if (pendingSnapshot(wsRegistriesD)) {
        const r = restoreRegistriesD(wsRegistriesD, REGISTRIES_D_LEDGER);
        if (!r.ok) throw new Error(r.problem);
      }
      snapshotRegistriesD(wsRegistriesD, REGISTRIES_D_LEDGER);
      scopedExemption = true;
    } catch (err) {
      updateJob(retryJobId, { status: "failed", progress: 100, message: `${String(err?.message || err)} The retry was not started.` });
      releaseAll();
      return retryJobId;
    }
    updateJobMetadata(retryJobId, { ...getJobMetadata(retryJobId), fullCommand: `${resolved.path} ${args.join(" ")}` });

    logger.info({ tag: "smart-retry", retryJobId, registriesDDir }, "Launching retry job with per-image configs");
    if (runCtx.beforeSpawn) {
      try {
        const extra = runCtx.beforeSpawn({ jobId: retryJobId });
        if (extra) updateJobMetadata(retryJobId, extra);
      } catch (err) {
        updateJob(retryJobId, { status: "failed", progress: 100, message: `${String(err?.message || err)} The retry was not started.` });
        releaseAll();
        return retryJobId;
      }
    }
    const child = spawn(resolved.path, args, { env: envVars });
    activeProcesses.set(retryJobId, child);
    updateJob(retryJobId, { status: "running", progress: 0, message: "oc-mirror retry running with per-image signature configs." });

    child.stdout.on("data", (data) => appendJobOutput(retryJobId, data.toString()));
    child.stderr.on("data", (data) => appendJobOutput(retryJobId, data.toString()));

    let settled = false;
    child.on("error", (err) => {
      appendJobOutput(retryJobId, `\n${String(err)}\n`);
      updateJobUnlessTerminal(retryJobId, { status: "failed", message: "oc-mirror retry failed to start." });
      activeProcesses.delete(retryJobId);
      if (!settled) { settled = true; releaseAll(); }
    });

    child.on("close", (code) => {
      const finishedAt = Date.now();
      if (code === 0 && !dryRun && runCtx.afterSuccess) {
        try {
          const extra = runCtx.afterSuccess({ jobId: retryJobId, finishedAt });
          if (extra) updateJobMetadata(retryJobId, extra);
        } catch (err) {
          appendJobOutput(retryJobId, `\nArchitect could not keep this run's archives in their own folder (${String(err?.message || err)}).\n`);
        }
      }
      const output = getJob(retryJobId)?.output || "";
      const summary = summarizeOcMirrorOutput(output, mode, workspacePath, archivePath, dryRun);
      const status = classifyOcMirrorExit(code, summary);
      const duration = finishedAt - (getJobMetadata(retryJobId).startedAt || finishedAt);
      const durationMinutes = (duration / 1000 / 60).toFixed(1);
      // Recovered only when oc-mirror finished cleanly and none of the original
      // references failed again (by its signature error or its failed-image list).
      const againFailing = new Set([...parseSignatureErrors(output), ...((summary.failedImages || []).map((r) => String(r).replace(/^docker:\/\//, "").replace(/[@:][^/]*$/, "")))]);
      const unresolved = signatureFailures.filter((ref) => againFailing.has(ref) || [...againFailing].some((f) => f.startsWith(`${ref}`)));
      const resolved = signatureFailures.filter((ref) => !unresolved.includes(ref));
      const recovered = code === 0 && unresolved.length === 0;
      let message = recovered
        ? `Automatic signature retry finished: ${resolved.length} repositor${resolved.length === 1 ? "y" : "ies"} mirrored without sigstore signatures (${resolved.join(", ")}). A cluster that requires signatures for them will reject these images.`
        : `Automatic signature retry ${status} in ${durationMinutes} minutes; ${unresolved.length ? `still failing: ${unresolved.join(", ")}` : `oc-mirror exited with code ${code}`}.`;
      if (summary.releaseResult) message += ` Release: ${summary.releaseResult.succeeded}/${summary.releaseResult.total}.`;
      if (summary.operatorResult) message += ` Operators: ${summary.operatorResult.succeeded}/${summary.operatorResult.total}.`;

      updateJobUnlessTerminal(retryJobId, { status, progress: 100, message });
      updateJobMetadata(retryJobId, {
        exitCode: code,
        finishedAt,
        duration,
        ...summary,
        signatureRecovery: { exempted: signatureFailures, resolved: code === 0 ? resolved : [], unresolved: code === 0 ? unresolved : signatureFailures, verified: recovered, scope: "per repository, this retry only" }
      });

      activeProcesses.delete(retryJobId);
      if (!settled) { settled = true; releaseAll(); }
    });

    return retryJobId;
  }
}

/** Result lines oc-mirror prints, and where its outputs land, for one finished run. */
function summarizeOcMirrorOutput(output, mode, workspacePath, archivePath, dryRun) {
  const artifactsBaseDir = resolveOcMirrorArtifactsBaseDir(mode, workspacePath, archivePath);
  // Patterns:  ✓ 190 / 190 release images mirrored successfully
  //            ✗ 109 / 112 operator images mirrored: Some operator images failed
  const releaseMatch = output.match(/[✓✗]\s+(\d+)\s*\/\s*(\d+)\s+release images mirrored/);
  const operatorMatch = output.match(/[✓✗]\s+(\d+)\s*\/\s*(\d+)\s+operator images mirrored/);
  // Failed image refs from "[ERROR]: [Worker] error mirroring image …" lines.
  const failedImages = [];
  const failRe = /\[ERROR\].*?\[Worker\] error mirroring image\s+(\S+)/g;
  let fm;
  while ((fm = failRe.exec(output)) !== null) {
    if (!failedImages.includes(fm[1])) failedImages.push(fm[1]);
  }
  return {
    clusterResourcesPath: artifactsBaseDir ? path.join(artifactsBaseDir, "working-dir", "cluster-resources") : "",
    dryRunMappingPath: dryRun && artifactsBaseDir ? path.join(artifactsBaseDir, "working-dir", "dry-run", "mapping.txt") : "",
    dryRunMissingPath: dryRun && artifactsBaseDir ? path.join(artifactsBaseDir, "working-dir", "dry-run", "missing.txt") : "",
    releaseResult: releaseMatch ? { succeeded: parseInt(releaseMatch[1], 10), total: parseInt(releaseMatch[2], 10) } : null,
    operatorResult: operatorMatch ? { succeeded: parseInt(operatorMatch[1], 10), total: parseInt(operatorMatch[2], 10) } : null,
    failedImages: failedImages.length ? failedImages : undefined
  };
}

/**
 * "completed_with_warnings" when oc-mirror exited non-zero but every release
 * image succeeded (the cluster can still be installed) and some operators were
 * attempted (a partial operator failure rather than a total run failure).
 */
function classifyOcMirrorExit(code, { releaseResult, operatorResult }) {
  if (code === 0) return "completed";
  if (releaseResult && releaseResult.succeeded === releaseResult.total && operatorResult && operatorResult.total > 0) {
    return "completed_with_warnings";
  }
  return "failed";
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
  const registryFqdn = v3State.globalStrategy?.mirroring?.registryFqdn?.trim();
  const result = await startOcMirrorRun({
    state,
    body: req.body || {},
    workflow: "install",
    defaults: {
      archivePath: v3State.mirrorWorkflow?.archivePath?.trim() || v3State.mirrorWorkflow?.outputPath?.trim(),
      workspacePath: v3State.mirrorWorkflow?.workspacePath?.trim(),
      cachePath: v3State.mirrorWorkflow?.cachePath?.trim(),
      registryUrl: registryFqdn ? `docker://${registryFqdn}` : ""
    },
    // The other two buildImageSetConfig call sites already assert this. Without it
    // here, an unsupported or unresolvable minor reached the generator directly, and
    // before the FQ-9 fix the generator's `|| "4.20"` default turned that into a
    // silently wrong mirror configuration instead of a refusal.
    buildGeneratedConfig: () => {
      assertSupportedOpenShiftVersion(v3State);
      return buildCheckedImageSetConfig(v3State);
    }
  });
  res.status(result.status).json(result.json);
});

/**
 * Start an oc-mirror run for either workflow (v2.2.0 M1). Returns
 * `{ status, json }`. The caller has already applied its own precondition
 * (Install: the Install release lock; Mirroring: the profile's own version
 * boundary) and supplies `buildGeneratedConfig` for generated configs.
 *
 * Mirroring runs (`workflow: "mirroring"`) take their directories only from
 * `defaults` (the profile's derived paths, never the request body), never
 * reuse Install credentials, and are tagged in job metadata so Install Start
 * Over leaves them alone. Every run, either workflow, holds the single
 * oc-mirror run slot while it is active.
 *
 * `preparePlan(resolvedBinary, jobId)` (Mirroring, M5) writes the immutable
 * execution plan and returns `{ configPath, record }`; the run then uses the
 * plan's config file, which it never deletes.
 */
async function startOcMirrorRun(ctx) {
  const { state, body, workflow = "install", profileId = null, defaults = {}, buildGeneratedConfig, preparePlan = null, envOverrides = null, storage = null, beforeSpawn = null, afterSuccess = null, verifyAfter = null } = ctx;
  const isMirroring = workflow === "mirroring";
  const fromBodyOrDefault = (key) => (isMirroring ? defaults[key] : (body[key]?.trim() || defaults[key]));
  const mode = body.mode || "mirrorToDisk";
  const dryRun = Boolean(body.dryRun);
  const archivePath = fromBodyOrDefault("archivePath");
  const workspacePath = fromBodyOrDefault("workspacePath");
  const cachePath = fromBodyOrDefault("cachePath");
  const registryUrl = body.registryUrl?.trim() || defaults.registryUrl || "";
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
    return { status: 400, json: { error: "Invalid mode." } };
  }
  // --dry-run is a global oc-mirror v2 flag valid for all modes
  if ((mode === "mirrorToDisk" || mode === "diskToMirror") && !archivePath) {
    return { status: 400, json: { error: "Archive path is required." } };
  }
  if (mode === "mirrorToMirror" && !workspacePath) {
    return { status: 400, json: { error: "Workspace path is required." } };
  }
  if ((mode === "diskToMirror" || mode === "mirrorToMirror") && !registryUrl) {
    return { status: 400, json: { error: "Registry URL is required for this mode." } };
  }
  if (configSourceType === "external" && !configPathExternal) {
    return { status: 400, json: { error: "Config path is required when using external config." } };
  }

  if (isMirroring && (mode === "diskToMirror" || mode === "mirrorToMirror") && mirrorAuthSource === "reuse") {
    return { status: 400, json: { error: "Mirroring does not reuse the Install workflow's mirror registry credentials. Provide the mirror registry credentials for this run." } };
  }

  // One oc-mirror run at a time (owner decision 5). Checked and reserved
  // synchronously, before any await, so concurrent requests cannot both pass.
  const reservationToken = nanoid();
  const reservation = reserveOcMirrorRun(getJob, reservationToken);
  if (!reservation.ok) {
    return { status: 409, json: runInProgressBody(reservation.activeJobId) };
  }
  // A Mirroring run plans with the profile's storage root as read by its route;
  // a storage change in between (it holds this same reservation) is refused here.
  if (isMirroring && ctx.storageBaseExpected !== undefined && (readMirroringSlice().profiles[profileId]?.storageBase ?? null) !== ctx.storageBaseExpected) {
    releaseOcMirrorRunReservation(reservationToken);
    return { status: 409, json: { error: "This profile's storage location changed while the run was starting. Run the preflight again.", code: "STORAGE_ROOT_CHANGED" } };
  }
  try {
    return await startReservedOcMirrorRun();
  } finally {
    // The spawned child (if any) is in activeProcesses by now and holds the
    // slot from there; every earlier exit simply frees it.
    releaseOcMirrorRunReservation(reservationToken);
  }

  async function startReservedOcMirrorRun() {
    let configPathToUse = null;
    // Only a config this backend generated into DATA_DIR/tmp is ours to remove:
    // never an operator's external file, never a Mirroring plan (which is the
    // immutable record of what was run, M5).
    let configPathIsOurs = false;
    const tmpDir = path.join(dataDir, "tmp");
    fs.mkdirSync(tmpDir, { recursive: true });
    const jobId = createJob("oc-mirror-run", "oc-mirror run starting.");

    // Mirroring (M5): the binary is resolved first so the immutable plan can
    // record exactly the executable this run uses, and the run is given the
    // plan's own config file.
    let plan = null;
    let resolvedForPlan = null;
    if (preparePlan) {
      resolvedForPlan = await resolveOcMirrorBinary(dataDir);
      if (resolvedForPlan.error) {
        updateJob(jobId, { status: "failed", progress: 100, message: resolvedForPlan.error, output: resolvedForPlan.rawStderr || resolvedForPlan.error });
        return { status: 200, json: { jobId } };
      }
      try {
        plan = await preparePlan(resolvedForPlan, jobId);
      } catch (err) {
        updateJob(jobId, { status: "failed", progress: 100, message: `The execution plan could not be written, so nothing was run: ${String(err?.message || err)}` });
        return { status: 200, json: { jobId } };
      }
      configPathToUse = plan.configPath;
    } else if (configSourceType === "generated") {
      let configContents;
      try {
        configContents = buildGeneratedConfig();
      } catch (error) {
        if (error.code === "UNSUPPORTED_VERSION") {
          updateJob(jobId, { status: "failed", message: error.message, progress: 100 });
          return {
            status: 422,
            json: {
              error: error.message,
              code: error.code,
              requestedVersion: error.requestedVersion,
              supportedVersions: error.supportedVersions
            }
          };
        }
        if (isImagesetValidationError(error)) {
          updateJob(jobId, { status: "failed", message: error.message, progress: 100 });
          return { status: error instanceof ImageSetConfigInvalidError ? 422 : 500, json: imagesetValidationErrorBody(error) };
        }
        updateJob(jobId, { status: "failed", message: String(error?.message || error), progress: 100 });
        throw error;
      }
      configPathIsOurs = true;
      // Sits in DATA_DIR/tmp beside the auth file and registries.d dir and is
      // cleaned by the same owner, so it needs the same shutdown ownership.
      // Carries mirror FQDNs and the operator selection.
      configPathToUse = trackTempArtifact(
        path.join(tmpDir, `imageset-${jobId}.yaml`),
        "file",
        "imageset-config"
      );
      fs.writeFileSync(configPathToUse, configContents, "utf8");
    } else {
      // Contained, canonicalised, size-bounded (externalConfigPolicy.js).
      const resolvedConfig = resolveExternalConfigPath(configPathExternal, ALLOWED_BASE_PATHS);
      if (!resolvedConfig.ok) {
        const message = resolvedConfig.reason === "missing" || resolvedConfig.reason === "not-file"
          ? "External config file not found."
          : resolvedConfig.message;
        updateJob(jobId, { status: "failed", message, progress: 100 });
        return { status: 200, json: { jobId } };
      }
      configPathToUse = resolvedConfig.realPath;
    }

    let authFile = null;
    try {
      // Each credential set is parsed and checked on its own; a registry named
      // in both with different values is refused rather than one silently winning.
      const rhLabel = body.rhAuthSource === "mounted" ? "The mounted pull secret" : "The source pull secret";
      const parse = (raw, label) => parseRegistryAuth(raw, label.replace(/^The /, "").toLowerCase());
      const sets = [];
      const mirrorRaw = mirrorAuthSource === "reuse" ? state.credentials?.mirrorRegistryPullSecret : mirrorPullSecretRaw;
      if (mode !== "diskToMirror" && rhPullSecretRaw) sets.push({ label: rhLabel, auths: parse(rhPullSecretRaw, rhLabel) });
      if (mode !== "mirrorToDisk" && mirrorRaw && typeof mirrorRaw === "string") sets.push({ label: "the destination registry credentials", auths: parse(mirrorRaw, "the destination registry credentials") });
      if (sets.length) authFile = writeTempAuth(authFileDocument(combineRegistryAuths(sets)));
    } catch (err) {
      const message = err instanceof RegistryAuthError ? err.message : "The credentials could not be read.";
      updateJob(jobId, { status: "failed", message, progress: 100 });
      updateJobMetadata(jobId, { code: err instanceof RegistryAuthError ? err.code : "REGISTRY_AUTH_INVALID" });
      if (configPathIsOurs) safeUnlink(configPathToUse);
      return { status: 200, json: { jobId } };
    }

    // Config + auth file: owned by this run, handed to a signature retry if one
    // starts, released exactly once either way (F13).
    const resources = createRunResources({ configPath: configPathToUse, configIsOurs: configPathIsOurs, authFile });

    // Generate registries.d configs if signature options provided
    let registriesDDir = null;
    if (signatureOptions && !removeSignatures) {
      registriesDDir = writeRegistriesDConfigs(signatureOptions);
    }
    const failEarly = (message, output) => {
      updateJob(jobId, { status: "failed", progress: 100, message, ...(output ? { output } : {}) });
      if (registriesDDir) cleanupRegistriesDDir(registriesDDir);
      resources.release();
      return { status: 200, json: { jobId } };
    };

    const resolved = resolvedForPlan || await resolveOcMirrorBinary(dataDir);
    if (resolved.error) return failEarly(resolved.error, resolved.rawStderr || resolved.error);

    try {
      if (mode === "mirrorToMirror" && workspacePath) fs.mkdirSync(path.resolve(workspacePath), { recursive: true });
      if (mode !== "mirrorToMirror" && archivePath) fs.mkdirSync(path.resolve(archivePath), { recursive: true });
      if (cachePath) fs.mkdirSync(path.resolve(cachePath), { recursive: true });
    } catch (err) {
      return failEarly(String(err?.message || err));
    }

    const startedAt = Date.now();
    const configPathForRecord = plan ? plan.configPath : (configPathExternal || "");
    const meta = {
      mode,
      dryRun,
      archiveDir: archivePath || "",
      workspaceDir: workspacePath,
      cacheDir: cachePath || "",
      registryUrl: registryUrl || "",
      configSourceType,
      configPath: configPathForRecord,
      startedAt,
      errorFilesBefore: snapshotErrorFiles(mode === "mirrorToMirror" ? [workspacePath] : [archivePath], { fsImpl: fs }),
      // Credential-stripped. This used to store `body` verbatim, which put the
      // operator's rhPullSecret and mirrorPullSecret in plaintext into SQLite —
      // contradicting this module's own "Pull secrets never persisted to disk"
      // contract (utils.js) — and then served them to anyone, because
      // GET /api/jobs and GET /api/jobs/:id return the whole row unauthenticated
      // and updateJobMetadata performs no redaction. Kept as an audit record of
      // the request; the signature retry runs from the in-memory run context
      // below (F13), never from this. Repairing the retry must never become a
      // reason to store a raw body here.
      requestBody: sanitizeCredentialFields(body),
      ...(plan ? { plan: plan.record } : {}),
      ...(isMirroring ? { workflow: "mirroring", profileId, tool: await describeOcMirrorTool(resolved).catch(() => null), ...(storage ? { storage } : {}) } : {})
    };
    updateJobMetadata(jobId, meta);

    // Everything a signature retry needs, resolved once (F13).
    const runCtx = {
      mode, dryRun, archivePath, workspacePath, cachePath, registryUrl, advanced,
      signatureOptions, removeSignatures, configSourceType, configPathForRecord,
      workflow, profileId, planRecord: plan ? plan.record : null, resources, envOverrides, beforeSpawn, afterSuccess
    };

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
      removeSignatures,
      registriesDDir
    );
    const fullCommand = `${resolved.path} ${args.join(" ")}`;
    updateJobMetadata(jobId, { ...meta, fullCommand });
    // Do NOT pass REGISTRY_AUTH_FILE to oc-mirror — that env var is consumed by
    // the distribution/distribution local registry component as a YAML config file
    // path (not an OCI auth JSON), causing a startup panic.  Auth is supplied via
    // --authfile flag instead.
    const { REGISTRY_AUTH_FILE: _drop, ...envWithoutRegistryAuthFile } = process.env;

    const envVars = { ...envWithoutRegistryAuthFile, ...(envOverrides || {}) };
    // A workspace still holding an earlier run's exemption is restored first;
    // if that fails the run does not start (no lasting, weaker workspace).
    const wsRegistriesD = workspaceRegistriesDir(mode, archivePath, workspacePath);
    if (wsRegistriesD && pendingSnapshot(wsRegistriesD)) {
      const r = restoreRegistriesD(wsRegistriesD, REGISTRIES_D_LEDGER);
      if (!r.ok) {
        if (registriesDDir) cleanupRegistriesDDir(registriesDDir);
        return failEarly(`${r.problem} The run was not started.`);
      }
    }
    let scopedExemption = false;
    if (registriesDDir && wsRegistriesD) {
      try { snapshotRegistriesD(wsRegistriesD, REGISTRIES_D_LEDGER); scopedExemption = true; } catch (err) {
        cleanupRegistriesDDir(registriesDDir);
        return failEarly(`${String(err?.message || err)} The run was not started.`);
      }
      logger.info({ tag: "oc-mirror", registriesDDir }, "Using registries.d configs for this run only");
    }
    const undoExemption = () => {
      if (!scopedExemption) return;
      scopedExemption = false;
      const r = restoreRegistriesD(wsRegistriesD, REGISTRIES_D_LEDGER);
      if (!r.ok) {
        appendJobOutput(jobId, `\n${r.problem} Later runs on this workspace are refused until it is restored.\n`);
        updateJobMetadata(jobId, { registriesDRestoreProblem: r.problem });
      }
    };

    // Mirroring: keep earlier archives out of oc-mirror's reach and note the
    // workspace history, inside the reserved slot (nothing else can run).
    if (beforeSpawn) {
      try {
        const extra = beforeSpawn({ jobId });
        if (extra) updateJobMetadata(jobId, extra);
      } catch (err) {
        undoExemption();
        if (registriesDDir) cleanupRegistriesDDir(registriesDDir);
        return failEarly(`${String(err?.message || err)} The run was not started; nothing was changed.`);
      }
    }
    const child = spawn(resolved.path, args, { env: envVars });
    activeProcesses.set(jobId, child);
    runTempArtifactsByJob.set(jobId, [...resources.paths(), registriesDDir].filter(Boolean));
    updateJob(jobId, { status: "running", progress: 0, message: "oc-mirror running." });
    child.stdout.on("data", (data) => appendJobOutput(jobId, data.toString()));
    child.stderr.on("data", (data) => appendJobOutput(jobId, data.toString()));
    child.on("error", (err) => {
      appendJobOutput(jobId, `\n${String(err)}\n`);
      // Guarded: a stop or a shutdown may already have recorded this job.
      updateJobUnlessTerminal(jobId, { status: "failed", message: "oc-mirror failed to start." });
      activeProcesses.delete(jobId);
      runTempArtifactsByJob.delete(jobId);
      undoExemption();
      if (registriesDDir) cleanupRegistriesDDir(registriesDDir);
      resources.release();
    });
    child.on("close", (code) => {
      const finishedAt = Date.now();
      // Before the outcome is recorded (and the slot frees up): a successful real
      // run's archives go to their own set and its incremental cycle is recorded.
      if (code === 0 && !dryRun && afterSuccess) {
        try {
          const extra = afterSuccess({ jobId, finishedAt });
          if (extra) updateJobMetadata(jobId, extra);
        } catch (err) {
          appendJobOutput(jobId, `\nArchitect could not keep this run's archives in their own folder (${String(err?.message || err)}); they stay where oc-mirror wrote them and are moved aside before the next run.\n`);
        }
      }
      const settle = () => {
        const output = getJob(jobId)?.output || "";
        const summary = summarizeOcMirrorOutput(output, mode, workspacePath, archivePath, dryRun);
        const status = classifyOcMirrorExit(code, summary);
        const { operatorResult } = summary;

        // Parse signature errors for smart retry
        const signatureFailures = parseSignatureErrors(output);

        updateJobMetadata(jobId, {
          exitCode: code,
          finishedAt,
          ...summary,
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
        const verification = getJobMetadata(jobId).verification;
        if (verification) message += ` Result check: ${VERIFICATION_TEXT[verification.state] || verification.state}.`;

        // Guarded: a SIGTERMed child reports code === null, which this block
        // turns into "failed" — relabelling a job that was deliberately cancelled.
        const outcomeRecorded = updateJobUnlessTerminal(jobId, {
          status,
          progress: status === "completed" ? 100 : status === "completed_with_warnings" ? 100 : 0,
          message
        });

        activeProcesses.delete(jobId);
        runTempArtifactsByJob.delete(jobId);
        undoExemption();
        if (registriesDDir) cleanupRegistriesDDir(registriesDDir);

        // Trigger smart retry if signature failures detected.
        //
        // Gated on the write above having been ACCEPTED. `status` is computed
        // locally from the exit code and output, not read back from the job: a
        // SIGTERMed child reports code === null, and if the partial output already
        // showed every release image mirrored it is classified
        // `completed_with_warnings`. So a run the operator explicitly stopped
        // could reach here, spawn a brand-new oc-mirror child, and overwrite
        // "Stopped by user." — restarting work that was deliberately cancelled.
        // Eligible only for the verified signature-read failure, never for release
        // images (exit bit 2) or a fatal error, and never for disk to mirror: the
        // high side cannot get signatures the low side never archived (verified).
        const imageFailuresOnly = Number.isInteger(code) && code !== 0 && (code & ~(4 | 8)) === 0;
        const signatureEligible = outcomeRecorded && !dryRun && signatureFailures.length > 0 && mode !== "diskToMirror"
          && (imageFailuresOnly || (status === "completed_with_warnings" && Number.isInteger(code) && (code & 2) === 0));
        if (!signatureEligible) {
          if (outcomeRecorded && signatureFailures.length > 0) {
            updateJobMetadata(jobId, { signatureRetry: { state: "not-applicable", reason: mode === "diskToMirror"
              ? "Disk to mirror cannot be retried for signatures: the transfer does not contain them. Prepare a new transfer on the connected side."
              : "These failures are not only the known signature-read error, so no automatic retry was started." } });
          }
          resources.release();
          return;
        }
        logger.info({ tag: "smart-retry", jobId, signatureFailureCount: signatureFailures.length }, "Detected signature failures");
        // The retry takes the config and auth file; it releases them (F13).
        retryWithPerImageSignatureDisable(jobId, signatureFailures, runCtx)
          .then((retryJobId) => {
            if (!retryJobId) return;
            updateJobMetadata(jobId, { retriedAs: retryJobId, signatureRetry: { state: "started", retryJobId } });
            // A Mirroring retry belongs to the same profile's history.
            if (isMirroring && profileId) appendMirroringHistory(profileId, retryJobId);
            // Guarded too: this lands after an await, so a stop can have
            // been recorded in the meantime.
            if (getJob(jobId)?.status !== "cancelled") {
              updateJob(jobId, { message: `oc-mirror could not read the signatures of ${signatureFailures.length} repositor${signatureFailures.length === 1 ? "y" : "ies"} (${signatureFailures.join(", ")}). An automatic retry for those repositories only was started (job ${retryJobId}).` });
            }
            logger.info({ tag: "smart-retry", retryJobId, originalJobId: jobId }, "Launched retry job");
          })
          .catch((err) => {
            logger.error({ tag: "smart-retry", err, jobId }, "Failed to launch retry");
            resources.release();
          });
      };
      // A recovery attempt is checked before its outcome is recorded (the slot
      // stays held; Stop reaches the checking process).
      if (code === 0 && !dryRun && verifyAfter && !isTerminalJobStatus(getJob(jobId)?.status)) {
        updateJob(jobId, { message: "oc-mirror finished; Architect is checking the result…" });
        verifyAfter({ jobId, args, resolved, authFile, envVars, register: (proc) => activeProcesses.set(jobId, proc) })
          .then((verification) => updateJobMetadata(jobId, { verification }))
          .catch((err) => updateJobMetadata(jobId, { verification: { state: "unverifiable", checks: [{ name: "Verification", ok: false, detail: String(err?.message || err).slice(0, 500) }] } }))
          .finally(settle);
      } else {
        settle();
      }
    });
    return { status: 200, json: { jobId } };
  }
}

// ===================================================================
// Mirroring workflow (v2.2.0 M1 backend foundation)
//
// The Mirroring slice is server-owned (see mirroringState.js): these routes
// are its only writers. Every write is normalized and passes the structural
// and supported-minor boundaries before it is stored; generation, preflight
// and run re-check the version boundary because stored state is not trusted
// to have stayed valid. None of these routes reads or writes Install state,
// and none depends on the Install release lock.
// ===================================================================

const readMirroringSlice = () => normalizeMirroringSlice(ensureState().mirroring);

// Where Mirroring content lives (mirroringStorage.js): read once at start-up,
// so it cannot change while a run is active.
const mirrorStorage = storageConfig(process.env, dataDir);
if (mirrorStorage.configProblem) logger.warn({ tag: "mirroring-storage", problem: mirrorStorage.configProblem }, "Mirroring storage root is not usable; Mirroring runs are blocked until it is fixed");
/** The storage context of one profile: its pinned root (or the DATA_DIR default). */
const storeOf = (profile) => ({ base: profileStorage(profile, mirrorStorage).base });
/** null when the profile's storage can be used now; otherwise why not. Blocks runs, preparations and receipts. */
const mirroringStorageProblem = (profile) => {
  const ps = profileStorage(profile, mirrorStorage);
  if (!ps.accepted) {
    return mirrorStorage.configProblem && ps.pinned === mirrorStorage.base
      ? `${mirrorStorage.configProblem} Mirroring content is not stored anywhere else instead.`
      : ps.reason;
  }
  // The DATA_DIR default is created on first use, as before; a configured root must already exist.
  const check = checkStorageBase(ps.base, { create: ps.pinned === null });
  return check.ok ? null : check.problems.join(" ");
};
/** What the UI shows about a profile's storage (no live filesystem check). */
const storageView = (profile) => {
  const ps = profileStorage(profile, mirrorStorage);
  return { base: ps.base, source: ps.pinned ? "configured" : "default", accepted: ps.accepted, reason: ps.reason || null };
};
const describeMirroringProfile = (profile) => describeProfile(storeOf(profile), profile, { storage: storageView(profile) });

const writeMirroringSlice = (slice) => {
  setState({ ...ensureState(), mirroring: normalizeMirroringSlice(slice) });
};

const describeMirroringSlice = (slice) => ({
  _schema: slice._schema,
  activeProfileId: slice.activeProfileId,
  profiles: Object.values(slice.profiles).map((profile) => describeMirroringProfile(profile))
});

const mirroringProfileRunning = (profileId) =>
  runningOcMirrorJobs().some((job) => {
    const meta = getJobMetadata(job.id);
    return meta.workflow === "mirroring" && meta.profileId === profileId;
  });

/** Loads the addressed profile or sends 404; returns { slice, profile } or null. */
const loadMirroringProfile = (req, res) => {
  const id = req.params.id;
  const slice = readMirroringSlice();
  if (!isValidProfileId(id) || !slice.profiles[id]) {
    res.status(404).json({ error: "Mirroring profile not found." });
    return null;
  }
  return { slice, profile: slice.profiles[id] };
};

/** Structural (400) then supported-minor (422) boundary. Sends and returns false on failure. */
const checkMirroringProfileBoundaries = (res, profile) => {
  const structural = validateProfileStructure(profile);
  if (structural.length) {
    res.status(400).json({ error: "Validation failed", details: structural });
    return false;
  }
  const vErr = findUnsupportedProfileVersion(profile);
  if (vErr) {
    sendUnsupportedVersion(res, vErr, { path: vErr.path });
    return false;
  }
  return true;
};

const releaseSelectionOf = (platform) => JSON.stringify([
  platform?.release?.channel || null,
  platform?.release?.patchVersion || null,
  platform?.version?.selectedMinor || null,
  platform?.version?.selectedPatch || null
]);

/**
 * Catalog verification is the server's own record (M5): whatever a client
 * sends is dropped, and the stored record for the same operator id is kept
 * (operatorVerificationState treats it as stale if the operator changed).
 */
const keepServerVerification = (currentSelected, incoming) => {
  const byId = new Map((currentSelected || []).map((op) => [op.id, op]));
  return incoming.map((op) => {
    if (!op || typeof op !== "object") return op;
    const { verification: _clientValue, ...rest } = op;
    const stored = byId.get(op.id)?.verification;
    return stored ? { ...rest, verification: stored } : rest;
  });
};

/** Field-wise merge where null removes a field (M5 run options, archive size). */
const mergeClearable = (current, patch) => {
  const out = { ...(current || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
};

/** Applies a validated write body to a stored profile (section-wise replace). */
const applyMirroringProfileWrite = (current, body) => {
  const now = Date.now();
  const next = {
    ...current,
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.content ? { content: { ...current.content, ...body.content } } : {}),
    ...(body.platform ? {
      platform: {
        ...current.platform,
        ...body.platform,
        release: body.platform.release ? { ...current.platform.release, ...body.platform.release } : current.platform.release,
        version: body.platform.version ? { ...current.platform.version, ...body.platform.version } : current.platform.version
      }
    } : {}),
    ...(body.operators ? { operators: { ...current.operators, ...body.operators, ...(body.operators.selected ? { selected: keepServerVerification(current.operators.selected, body.operators.selected) } : {}) } } : {}),
    ...(body.additionalImages ? { additionalImages: body.additionalImages } : {}),
    ...(body.options ? { options: mergeClearable(current.options, body.options) } : {}),
    execution: {
      ...current.execution,
      ...(body.execution ? { ...body.execution, options: mergeClearable(current.execution.options, body.execution.options) } : {}),
      lastRunJobId: current.execution.lastRunJobId
    },
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: now,
    history: current.history
  };
  // Locking is explicit (POST .../lock), never a side effect of a write.
  if (body.platform?.release && "confirmed" in body.platform.release) next.platform.release.confirmed = current.platform.release.confirmed;
  if (body.platform?.version && "locked" in body.platform.version) next.platform.version.locked = current.platform.version.locked;
  return normalizeProfile(next, current.id);
};

app.get("/api/mirroring", (req, res) => {
  res.json(describeMirroringSlice(readMirroringSlice()));
});

/**
 * Which profile the Mirroring UI has open (v2.2.0 M2), so the selection
 * survives a reload. `null` closes the selection. Changes nothing else.
 */
app.post("/api/mirroring/active", validateBody(mirroringActiveSchema), (req, res) => {
  const slice = readMirroringSlice();
  const id = req.body.profileId;
  if (id !== null && (!isValidProfileId(id) || !slice.profiles[id])) {
    return res.status(404).json({ error: "Mirroring profile not found." });
  }
  slice.activeProfileId = id;
  writeMirroringSlice(slice);
  res.json(describeMirroringSlice(readMirroringSlice()));
});

app.post("/api/mirroring/profiles", validateBody(mirroringProfileWriteSchema), (req, res) => {
  const slice = readMirroringSlice();
  if (Object.keys(slice.profiles).length >= MAX_PROFILES) {
    return res.status(409).json({ error: `A maximum of ${MAX_PROFILES} mirroring profiles is supported.` });
  }
  const id = newProfileId();
  const base = normalizeProfile({}, id);
  const written = applyMirroringProfileWrite(base, req.body || {});
  // A new profile starts unlocked whatever the body says.
  written.platform.release.confirmed = false;
  written.platform.version.locked = false;
  const derived = deriveCatalogMinor(null, written, { incomingCatalogMinor: req.body?.operators?.catalogMinor });
  if (derived.error) return res.status(derived.error.status).json({ error: derived.error.message, code: derived.error.code });
  const profile = normalizeProfile({ ...derived.profile, storageBase: newProfileStorageBase(mirrorStorage) }, id);
  if (!checkMirroringProfileBoundaries(res, profile)) return;
  slice.profiles[id] = profile;
  slice.activeProfileId = id;
  writeMirroringSlice(slice);
  res.status(201).json(describeMirroringProfile(profile));
});

// Updates use POST, not PATCH: the backend's CORS preflight allows
// GET/POST/DELETE only, and a cross-origin browser (Compose dev topology)
// would otherwise be refused before the request reached this route.
app.post("/api/mirroring/profiles/:id", validateBody(mirroringProfileWriteSchema), (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  const { slice, profile } = loaded;
  // A received profile's content is its transfer's (M6): only its name and
  // execution settings may change.
  if (profile.kind === "received" && ["content", "platform", "operators", "additionalImages", "options"].some((k) => req.body?.[k] !== undefined)) {
    return res.status(409).json({ error: "This profile was received from a low-side transfer; its content is the transfer's and cannot be edited. Change the low-side profile and send a new transfer.", code: "RECEIVED_PROFILE_READ_ONLY" });
  }
  const written = applyMirroringProfileWrite(profile, req.body || {});
  const derived = deriveCatalogMinor(profile, written, { incomingCatalogMinor: req.body?.operators?.catalogMinor });
  if (derived.error) return res.status(derived.error.status).json({ error: derived.error.message, code: derived.error.code });
  const next = normalizeProfile(derived.profile, profile.id);
  // A locked release is never changed silently: unlock first.
  if (profile.platform.version.locked && releaseSelectionOf(next.platform) !== releaseSelectionOf(profile.platform)) {
    return res.status(409).json({
      error: "The OpenShift release for this profile is locked. Unlock it before changing the release.",
      code: "VERSION_LOCKED"
    });
  }
  if (!checkMirroringProfileBoundaries(res, next)) return;
  slice.profiles[profile.id] = next;
  writeMirroringSlice(slice);
  res.json(describeMirroringProfile(next));
});

app.post("/api/mirroring/profiles/:id/lock", validateBody(mirroringEmptySchema), (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  const { slice, profile } = loaded;
  if (!profile.platform.release.channel || !profile.platform.release.patchVersion) {
    return res.status(400).json({ error: "Select an OpenShift release and patch before locking." });
  }
  const locked = buildLockedVersionSelection(profile.platform);
  if (locked.error) return sendUnsupportedVersion(res, locked.error, { path: "platform" });
  const lockedProfile = normalizeProfile({
    ...profile,
    platform: { ...profile.platform, release: locked.release, version: locked.version },
    updatedAt: Date.now()
  }, profile.id);
  // Locking never changes the minor, but keep the derived catalog minor exact.
  const next = normalizeProfile(deriveCatalogMinor(profile, lockedProfile).profile, profile.id);
  if (!checkMirroringProfileBoundaries(res, next)) return;
  slice.profiles[profile.id] = next;
  writeMirroringSlice(slice);
  res.json(describeMirroringProfile(next));
});

app.post("/api/mirroring/profiles/:id/unlock", validateBody(mirroringEmptySchema), (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  const { slice, profile } = loaded;
  if (mirroringProfileRunning(profile.id)) {
    return res.status(409).json({ error: "This profile has an oc-mirror run in progress." });
  }
  const next = normalizeProfile({
    ...profile,
    platform: {
      ...profile.platform,
      release: { ...profile.platform.release, confirmed: false },
      version: { ...profile.platform.version, locked: false, confirmedByUser: false }
    },
    updatedAt: Date.now()
  }, profile.id);
  slice.profiles[profile.id] = next;
  writeMirroringSlice(slice);
  res.json(describeMirroringProfile(next));
});

/**
 * Explicit reconciliation of a preserved catalog/platform minor conflict (M4):
 * "align" makes the catalogs follow the platform minor; "split" moves the
 * operators, with their own catalog minor, into a new operators-only profile.
 * One write: either both profiles change or neither does.
 */
app.post("/api/mirroring/profiles/:id/reconcile-catalog", validateBody(mirroringReconcileCatalogSchema), (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  const { slice, profile } = loaded;
  if (req.body.action === "split" && Object.keys(slice.profiles).length >= MAX_PROFILES) {
    return res.status(409).json({ error: `A maximum of ${MAX_PROFILES} mirroring profiles is supported.` });
  }
  const result = reconcileCatalogConflict(profile, req.body.action, newProfileId());
  if (result.error) return res.status(result.error.status).json({ error: result.error.message, code: result.error.code });
  const kept = normalizeProfile(result.profile, profile.id);
  if (!checkMirroringProfileBoundaries(res, kept)) return;
  if (result.newProfile && !checkMirroringProfileBoundaries(res, result.newProfile)) return;
  slice.profiles[profile.id] = kept;
  if (result.newProfile) slice.profiles[result.newProfile.id] = result.newProfile;
  writeMirroringSlice(slice);
  res.json({
    profile: describeMirroringProfile(kept),
    ...(result.newProfile ? { newProfile: describeMirroringProfile(result.newProfile) } : {})
  });
});

/* ---------------------------------------------------------------------------
 * ImageSetConfiguration import (v2.2.0 M4). See backend/src/mirroringImport.js
 * for the mapping contract. Nothing here runs oc-mirror.
 * ------------------------------------------------------------------------- */

const decodeImportFiles = (files) => files.map((f) => ({ name: f.name, bytes: Buffer.from(f.contentBase64, "base64") }));

const importSummary = (mapped) => ({
  content: mapped.content,
  platformRelease: mapped.platform?.release?.patchVersion || null,
  catalogMinor: mapped.operators?.catalogMinor || null,
  operators: mapped.operators?.selected?.length || 0,
  operatorsWithoutChannel: (mapped.operators?.selected || []).filter((o) => !o.defaultChannel).length,
  images: mapped.additionalImages.length,
  archiveSize: mapped.options?.archiveSize || null,
  catalogPlatformMismatch: mapped.platform && mapped.operators && mapped.platform.release.channel !== mapped.operators.catalogMinor
    ? { platformMinor: mapped.platform.release.channel, catalogMinor: mapped.operators.catalogMinor }
    : null
});

/** Analysis shared by analyze and apply; never trusts a client-side mapping. */
const buildImportPlan = (body, slice) => {
  const decoded = decodeImportFiles(body.files);
  const sizeProblem = importSizeProblem(decoded);
  if (sizeProblem) return { error: { status: 400, code: "IMPORT_TOO_LARGE", message: sizeProblem } };
  const { files } = analyzeImportFiles(decoded);
  const mode = body.mode || "separate";
  const alreadyImported = (sha) => Object.values(slice.profiles)
    .filter((p) => (p.imports || []).some((i) => i.sha256 === sha))
    .map((p) => p.name);
  const described = files.map((f) => ({
    index: f.index,
    fileName: f.fileName,
    bytes: f.bytes,
    sha256: f.sha256,
    status: f.status,
    stage: f.stage,
    errors: f.errors,
    warnings: f.warnings,
    ...(f.status === "valid" ? {
      representable: f.representable,
      summary: importSummary(f.mapped),
      unresolved: f.mapped.unresolved,
      alreadyImportedInto: alreadyImported(f.sha256)
    } : {})
  }));
  let target = null;
  if (mode === "into") {
    target = isValidProfileId(body.profileId) ? slice.profiles[body.profileId] : null;
    if (!target) return { error: { status: 404, code: "IMPORT_TARGET_NOT_FOUND", message: "Choose an existing profile to import into." } };
  }
  const valid = files.filter((f) => f.status === "valid");
  const sources = [
    ...(target ? [profileAsSource(target)] : []),
    ...valid.map((f) => ({ label: f.fileName, mapped: f.mapped }))
  ];
  const conflicts = mode === "separate" ? [] : detectMergeConflicts(sources);
  const blocking = [];
  if (files.some((f) => f.status === "invalid")) blocking.push("Remove the files that are not valid ImageSetConfigurations; they are never imported.");
  const empty = valid.filter((f) => !f.representable);
  if (empty.length) blocking.push(`Nothing in ${empty.map((f) => f.fileName).join(", ")} can be represented in a profile, so ${empty.length === 1 ? "it" : "they"} cannot be imported here.`);
  if (mode !== "separate" && sources.length < 2) blocking.push(mode === "into" ? "Choose at least one valid file to import into the profile." : "Merging needs at least two valid files.");
  const resolutions = body.resolutions || {};
  const unresolvedConflicts = conflicts.filter((c) => !c.options.some((o) => o.id === resolutions[c.id]));
  return { files, described, mode, target, sources, conflicts, unresolvedConflicts, blocking };
};

app.post("/api/mirroring/import/analyze", validateBody(mirroringImportSchema), (req, res) => {
  const plan = buildImportPlan(req.body, readMirroringSlice());
  if (plan.error) return res.status(plan.error.status).json({ error: plan.error.message, code: plan.error.code });
  res.json({
    mode: plan.mode,
    files: plan.described,
    conflicts: plan.conflicts,
    blocking: plan.blocking,
    applicable: plan.blocking.length === 0 && plan.unresolvedConflicts.length === 0
  });
});

const importRecord = (f, mode, unresolved) => ({
  id: `imp-${f.sha256.slice(0, 12)}`,
  fileName: f.fileName,
  sha256: f.sha256,
  bytes: f.bytes,
  importedAt: Date.now(),
  mode,
  unresolved,
  warnings: f.warnings.map((w) => ({ path: w.path, message: w.message }))
});

app.post("/api/mirroring/import/apply", validateBody(mirroringImportSchema), (req, res) => {
  const slice = readMirroringSlice();
  const plan = buildImportPlan(req.body, slice);
  if (plan.error) return res.status(plan.error.status).json({ error: plan.error.message, code: plan.error.code });
  if (plan.blocking.length) return res.status(400).json({ error: plan.blocking.join(" "), code: "IMPORT_NOT_APPLICABLE" });
  if (plan.unresolvedConflicts.length) {
    return res.status(409).json({ error: "Resolve every conflict before importing.", code: "IMPORT_CONFLICTS_UNRESOLVED", conflicts: plan.unresolvedConflicts });
  }
  const valid = plan.files.filter((f) => f.status === "valid");
  const names = req.body.names || [];
  const now = Date.now();
  const built = []; // { profile, files: [analyzed file] }
  const defaultName = (f) => f.fileName.replace(/\.ya?ml$/i, "").slice(0, 80) || "Imported profile";

  const finish = (prev, body, id, extra = {}) => {
    const draft = normalizeProfile({ ...(prev || {}), ...body, ...extra, id, updatedAt: now, createdAt: prev?.createdAt || now, storageBase: prev ? prev.storageBase : newProfileStorageBase(mirrorStorage) }, id);
    // Catalogs from the file are kept as written; a minor that differs from
    // the platform minor becomes a preserved conflict the user reconciles.
    return normalizeProfile(deriveCatalogMinor(draft, draft).profile, id);
  };

  if (plan.mode === "separate") {
    if (Object.keys(slice.profiles).length + valid.length > MAX_PROFILES) {
      return res.status(409).json({ error: `A maximum of ${MAX_PROFILES} mirroring profiles is supported.` });
    }
    valid.forEach((f, i) => {
      const id = newProfileId();
      built.push({ profile: finish(null, {
        name: (names[i] || "").trim() || defaultName(f),
        content: f.mapped.content,
        platform: f.mapped.platform || {},
        operators: f.mapped.operators || { selected: [] },
        additionalImages: f.mapped.additionalImages,
        options: f.mapped.options,
        imports: [importRecord(f, "separate", f.mapped.unresolved)]
      }, id), files: [f] });
    });
  } else {
    const merged = mergeSources(plan.sources, req.body.resolutions || {});
    const records = valid.map((f) => importRecord(f, plan.mode, f.mapped.unresolved));
    if (plan.mode === "merge") {
      if (Object.keys(slice.profiles).length + 1 > MAX_PROFILES) {
        return res.status(409).json({ error: `A maximum of ${MAX_PROFILES} mirroring profiles is supported.` });
      }
      built.push({ profile: finish(null, {
        name: (names[0] || "").trim() || `Imported (${valid.length} files)`,
        ...merged.body,
        platform: merged.body.platform || {},
        operators: merged.body.operators || { selected: [] },
        imports: records
      }, newProfileId()), files: valid });
    } else {
      const target = plan.target;
      if (mirroringProfileRunning(target.id)) {
        return res.status(409).json({ error: "This profile has an oc-mirror run in progress." });
      }
      const platformChanged = merged.body.platform && releaseSelectionOf(merged.body.platform) !== releaseSelectionOf(target.platform);
      const platform = merged.body.platform
        ? (platformChanged
          // Choosing the imported release is an explicit resolution; it is not locked until the user locks it.
          ? { ...merged.body.platform, release: { ...merged.body.platform.release, confirmed: false }, version: { ...merged.body.platform.version, locked: false } }
          : target.platform)
        : target.platform;
      built.push({ profile: finish(target, {
        content: {
          platform: target.content.platform || merged.body.content.platform,
          operators: target.content.operators || merged.body.content.operators,
          additionalImages: target.content.additionalImages || merged.body.content.additionalImages
        },
        platform,
        operators: merged.body.operators || target.operators,
        additionalImages: merged.body.additionalImages,
        options: { ...(target.options || {}), ...merged.body.options },
        imports: [...(target.imports || []), ...records]
      }, target.id), files: valid });
    }
  }

  for (const { profile } of built) {
    if (!checkMirroringProfileBoundaries(res, profile)) return;
  }

  // Originals first (owner-only files under each profile's own directory),
  // then ONE state write. If anything fails, remove what this request wrote:
  // either the whole import is applied or none of it is.
  const written = [];
  try {
    for (const { profile, files } of built) {
      const dir = path.join(profilePaths(storeOf(profile), profile.id).root, "imports");
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      for (const f of files) {
        const target = path.join(dir, `${f.sha256}.yaml`);
        if (fs.existsSync(target)) continue;
        const original = decodeImportFiles([req.body.files[f.index]])[0].bytes;
        fs.writeFileSync(target, original, { mode: 0o600, flag: "wx" });
        written.push(target);
      }
    }
    for (const { profile } of built) slice.profiles[profile.id] = profile;
    slice.activeProfileId = built[0].profile.id;
    writeMirroringSlice(slice);
  } catch (error) {
    for (const file of written) { try { fs.unlinkSync(file); } catch { /* already gone */ } }
    logger.warn({ tag: "mirroring-import:failed", requestId: req.requestId, files: req.body.files.length, reason: error.code || error.name }, "Mirroring import failed and was rolled back");
    return res.status(500).json({ error: "The import could not be saved. Nothing was changed.", code: "IMPORT_FAILED" });
  }
  res.json({
    ...describeMirroringSlice(readMirroringSlice()),
    imported: built.map(({ profile }) => profile.id),
    mode: plan.mode
  });
});

/** Read-only view of an imported original, verified against its recorded hash. */
app.get("/api/mirroring/profiles/:id/imports/:importId", (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  const record = (loaded.profile.imports || []).find((i) => i.id === req.params.importId);
  if (!record) return res.status(404).json({ error: "Imported file not found for this profile." });
  const file = path.join(profilePaths(storeOf(loaded.profile), loaded.profile.id).root, "imports", `${record.sha256}.yaml`);
  let bytes;
  try { bytes = fs.readFileSync(file); } catch { return res.status(404).json({ error: "The original file is no longer on the server.", code: "IMPORT_ORIGINAL_MISSING" }); }
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha !== record.sha256) return res.status(409).json({ error: "The stored original no longer matches its recorded SHA-256; it is not shown.", code: "IMPORT_ORIGINAL_CHANGED" });
  let content = bytes.toString("utf8");
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  res.json({ id: record.id, fileName: sanitizeFileName(record.fileName), sha256: record.sha256, bytes: bytes.length, content: content.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1***@") });
});

/** Leave unresolved parts of an imported file out of this profile, explicitly. */
app.post("/api/mirroring/profiles/:id/imports/:importId/review", validateBody(mirroringImportReviewSchema), (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  const { slice, profile } = loaded;
  const idx = (profile.imports || []).findIndex((i) => i.id === req.params.importId);
  if (idx === -1) return res.status(404).json({ error: "Imported file not found for this profile." });
  const ids = req.body.itemIds === "all" ? null : new Set(req.body.itemIds);
  const imports = profile.imports.map((imp, i) => (i !== idx ? imp : {
    ...imp,
    unresolved: imp.unresolved.map((u) => (!ids || ids.has(u.id) ? { ...u, status: "omitted" } : u))
  }));
  const next = normalizeProfile({ ...profile, imports, updatedAt: Date.now() }, profile.id);
  slice.profiles[profile.id] = next;
  writeMirroringSlice(slice);
  res.json(describeMirroringProfile(next));
});

app.delete("/api/mirroring/profiles/:id", (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  const { slice, profile } = loaded;
  if (mirroringProfileRunning(profile.id)) {
    return res.status(409).json({ error: "This profile has an oc-mirror run in progress. Stop it before deleting the profile." });
  }
  // Removes the profile record only. Archives, workspace and cache on disk are
  // operator data and are never deleted by this route.
  delete slice.profiles[profile.id];
  if (slice.activeProfileId === profile.id) slice.activeProfileId = null;
  writeMirroringSlice(slice);
  res.json({ ok: true, deletedProfileId: profile.id, retainedPaths: profilePaths(storeOf(profile), profile.id) });
});

/**
 * Generation boundary for a profile. Returns { yaml } or sends the error and
 * returns null.
 */
const generateMirroringConfig = (res, profile) => {
  if (!checkMirroringProfileBoundaries(res, profile)) return null;
  const readiness = generationReadiness(profile);
  if (readiness.length) {
    res.status(400).json({ error: "This profile is not ready to generate an ImageSetConfiguration.", code: "PROFILE_NOT_READY", details: readiness });
    return null;
  }
  const projection = projectProfileForGeneration(profile);
  try {
    return { yaml: buildCheckedImageSetConfig(projection.state, projection.options), projection };
  } catch (error) {
    if (error.code === "UNSUPPORTED_VERSION") {
      sendUnsupportedVersion(res, error);
      return null;
    }
    if (error.code === "UNSUPPORTED_ARCHITECTURE" || error.name === "ArchitectureSupportError") {
      res.status(422).json({ error: error.message, code: error.code || "UNSUPPORTED_ARCHITECTURE" });
      return null;
    }
    if (isImagesetValidationError(error)) {
      res.status(error instanceof ImageSetConfigInvalidError ? 422 : 500).json(imagesetValidationErrorBody(error));
      return null;
    }
    throw error;
  }
};

/**
 * DRAFT preview for a profile that is not ready (v2.2.0, R-UX09): what the
 * current selection renders to with the SAME generator and schema check, with
 * the readiness blockers, never downloadable or runnable (the validated
 * preview, download and runs keep using generateMirroringConfig). The text
 * starts with a DRAFT header naming the blockers.
 */
app.post("/api/mirroring/profiles/:id/preview-draft", validateBody(mirroringEmptySchema), (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  const p = loaded.profile;
  if (p.kind === "received") return res.status(409).json({ error: "A received profile has no draft: it uses its transfer's configuration.", code: "NO_DRAFT" });
  if (!checkMirroringProfileBoundaries(res, p)) return;
  const blockers = generationReadiness(p);
  if (!blockers.length) return res.status(409).json({ error: "This profile is ready: use the validated preview.", code: "PROFILE_READY" });
  const view = draftProfileView(p);
  const base = { draft: true, profileId: p.id, blockers, omitted: view.omitted };
  if (!view.profile) return res.json({ ...base, imagesetConfig: null });
  try {
    const projection = projectProfileForGeneration(view.profile);
    const yaml = buildCheckedImageSetConfig(projection.state, projection.options);
    const unlocked = p.content.platform && view.profile.content.platform && !p.platform.version.locked;
    const header = [
      "# DRAFT — not runnable and not downloadable. Architect generates the real file when this profile is ready.",
      ...blockers.map((b) => `# Blocker: ${b.message}`),
      ...(unlocked ? [`# Platform: release ${p.platform.release.patchVersion} is selected but not locked.`] : []),
      ...view.omitted.map((o) => `# Not shown: ${o.group} (${o.reason}).`)
    ].join("\n");
    return res.json({ ...base, imagesetConfig: `${header}\n${yaml}` });
  } catch (error) {
    if (error.code === "UNSUPPORTED_VERSION") return sendUnsupportedVersion(res, error);
    return res.json({ ...base, imagesetConfig: null, error: String(error.message || error) });
  }
});

app.post("/api/mirroring/profiles/:id/preview", validateBody(mirroringEmptySchema), (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  // A received profile shows the configuration its transfer carries, exactly
  // as received (M6); nothing is generated for it.
  if (loaded.profile.kind === "received") {
    const r = pickReceived(loaded.profile);
    if (!r) return res.status(400).json({ error: "This profile has not received a transfer yet.", code: "PROFILE_NOT_READY", details: generationReadiness(loaded.profile) });
    const problems = receivedConfigProblems(loaded.profile, r);
    if (problems.length) return res.status(409).json({ error: problems.join(" "), code: "TRANSFER_CHANGED" });
    return res.json({
      profileId: loaded.profile.id,
      imagesetConfig: fs.readFileSync(path.join(receivedDir(storeOf(loaded.profile), loaded.profile.id, r.planId), TRANSFER_DIR, "imageset-config.yaml"), "utf8"),
      validation: {
        structure: "valid",
        received: { planId: r.planId, configSha256: r.configSha256 },
        summary: `The configuration received with plan ${r.planId} (SHA-256 ${r.configSha256}), verified when it was received. It is shown read-only and used exactly as received.`
      },
      warnings: [],
      content: { received: { status: "included", planId: r.planId, summary: r.summary } }
    });
  }
  const generated = generateMirroringConfig(res, loaded.profile);
  if (!generated) return;
  const p = loaded.profile;
  const resolvedOps = p.operators.selected.filter((op) => op.catalogImage && op.defaultChannel);
  const unverified = p.content.operators ? resolvedOps.filter((op) => op.verifiedMinor !== p.operators.catalogMinor).length : 0;
  const schema = loadImageSetConfigSchema();
  const checkedWith = schema.provenance?.reverifiedAgainst?.channelReleaseName || schema.provenance?.binaryVerifiedAgainst?.channelReleaseName;
  res.json({
    profileId: p.id,
    imagesetConfig: generated.yaml,
    // Structure is checked (buildCheckedImageSetConfig). Catalog availability
    // is a different question and is reported as such, never implied.
    validation: {
      structure: "valid",
      schemaCheckedWith: checkedWith ? `oc-mirror ${checkedWith}` : null,
      catalogVerification: !p.content.operators ? "not-applicable" : unverified ? "pending" : "verified",
      unverifiedOperators: unverified,
      summary: `Structure checked against the oc-mirror v2 ImageSetConfiguration schema${checkedWith ? ` (verified with oc-mirror ${checkedWith})` : ""}.${
        !p.content.operators ? "" : unverified
          ? ` ${unverified} operator(s) have not been seen in scanned OpenShift ${p.operators.catalogMinor} catalogs yet; valid structure does not mean a package or channel exists.`
          : ` Every included operator was found in the scanned OpenShift ${p.operators.catalogMinor} catalogs.`}`
    },
    warnings: describeMirroringProfile(p).warnings,
    // What the YAML contains and why: selected, not selected, or selected but unavailable.
    content: {
      platform: p.content.platform
        ? { status: "included", release: p.platform.release.patchVersion }
        : { status: "not-selected" },
      operators: p.content.operators
        ? { status: "included", catalogMinor: p.operators.catalogMinor, included: resolvedOps.length, unresolved: p.operators.selected.length - resolvedOps.length }
        : { status: "not-selected" },
      additionalImages: p.content.additionalImages
        ? { status: "included", included: p.additionalImages.length }
        : { status: "not-selected" }
    }
  });
});

/**
 * Which workflows a profile can run, and why not (M6). A null entry means
 * available.
 * - Planned profiles mirror to disk (low side) or mirror to mirror.
 * - Disk to mirror runs only from a received, verified transfer of a
 *   mirror-to-disk run (its exact configuration), never from a configuration
 *   regenerated from editable profile state (DOC-155 H2). A planned profile
 *   can hold its own received transfers (low and high side on one server).
 * - A received profile was created from a transfer; it only runs disk to mirror.
 */
const mirroringModeAvailability = (profile) => (profile.kind === "received"
  ? {
    mirrorToDisk: "This profile was received from a low-side transfer. Mirror to disk runs on the connected side, in the profile the transfer came from.",
    mirrorToMirror: "This profile was received from a low-side transfer. Mirror to mirror needs the source registries and runs from a planned profile.",
    diskToMirror: profile.received?.length ? null : "Receive a transfer first."
  }
  : {
    mirrorToDisk: null,
    mirrorToMirror: null,
    diskToMirror: profile.received?.length ? null : "Disk to mirror runs only from a verified transfer of a mirror-to-disk run. Prepare the transfer after a mirror-to-disk run and receive it (Receive transfer), then run disk to mirror from it — the configuration is never regenerated."
  });
const mirroringModeRefusal = (profile, mode) => ({
  error: mirroringModeAvailability(profile)[mode] || "Unknown workflow.",
  code: "MIRRORING_MODE_NOT_AVAILABLE",
  mode
});

/** The received transfer a disk-to-mirror request names (default: the latest). */
const pickReceived = (profile, planId) => {
  const list = profile.received || [];
  if (planId !== undefined && planId !== null && planId !== "") return list.find((r) => r.planId === planId) || null;
  return list[list.length - 1] || null;
};

/** host[:port] of a docker:// destination, and the bare host. */
const destinationHost = (registryUrl) => {
  const hostPort = String(registryUrl || "").replace(/^docker:\/\//, "").split("/")[0];
  return { hostPort, host: hostPort.replace(/:\d+$/, "") };
};

/**
 * Environment that confines oc-mirror's disk to mirror to the destination
 * registry and local addresses (M6): every other HTTP(S) request goes to an
 * address nothing listens on and fails at once, instead of reaching — or
 * hanging on — a source registry from the disconnected side. oc-mirror honours
 * the standard proxy variables (containers/image uses the Go proxy settings).
 */
const DISCONNECTED_PROXY = "http://127.0.0.1:9";
const disconnectedEnv = (registryUrl) => {
  const { hostPort, host } = destinationHost(registryUrl);
  const noProxy = [...new Set([host, hostPort, "localhost", "127.0.0.1", "::1"].filter(Boolean))].join(",");
  return {
    HTTPS_PROXY: DISCONNECTED_PROXY, https_proxy: DISCONNECTED_PROXY,
    HTTP_PROXY: DISCONNECTED_PROXY, http_proxy: DISCONNECTED_PROXY,
    ALL_PROXY: DISCONNECTED_PROXY, all_proxy: DISCONNECTED_PROXY,
    NO_PROXY: noProxy, no_proxy: noProxy
  };
};

const RECEIVED_PLAN_ID_RE = /^plan-\d{8}T\d{6}Z-[A-Za-z0-9_-]{6}$/;

/** Request body for a profile preflight/run: the profile owns paths, config source and saved options. */
const FULL_BASELINE_SINCE = "2000-01-01";
const VERIFICATION_TEXT = {
  "fully-verified": "fully verified",
  "partially-verified": "partly verified (see the operation's details)",
  incomplete: "incomplete — see what is missing in the operation's details",
  unverifiable: "could not be verified"
};
const mirroringExecutionBody = (body, profile) => {
  const paths = profilePaths(storeOf(profile), profile.id);
  const { archivePath: _a, workspacePath: _w, cachePath: _c, configPath: _p, configSourceType: _s, advanced, receivedPlanId, isolateNetwork, fullBaseline, ...rest } = body || {};
  const mode = rest.mode || (profile.kind === "received" ? "diskToMirror" : profile.execution.mode);
  // A full transfer: oc-mirror uses the newest history strictly before --since
  // as its delta baseline; a date before every history means none (verified).
  const full = fullBaseline === true && mode === "mirrorToDisk";
  const received = mode === "diskToMirror" ? pickReceived(profile, typeof receivedPlanId === "string" ? receivedPlanId : undefined) : null;
  return {
    ...rest,
    mode,
    registryUrl: rest.registryUrl || profile.execution.registryUrl || undefined,
    // Disk to mirror reads the verified copy of the received transfer.
    archivePath: received ? receivedDir(storeOf(profile), profile.id, received.planId) : paths.archivePath,
    workspacePath: paths.workspacePath,
    cachePath: paths.cachePath,
    configSourceType: "generated",
    // The profile's saved run options, with anything this request sets on top.
    advanced: { ...(profile.execution.options || {}), ...(advanced && typeof advanced === "object" ? advanced : {}), ...(full ? { since: FULL_BASELINE_SINCE } : {}) },
    _fullBaseline: full,
    _received: received,
    _receivedPlanIdRequested: typeof receivedPlanId === "string" ? receivedPlanId : null,
    _isolateNetwork: isolateNetwork !== false
  };
};

/** The received transfer's configuration, checked again (bytes and structure) before use. */
const receivedConfigProblems = (profile, record) => {
  const dir = receivedDir(storeOf(profile), profile.id, record.planId);
  const problems = checkStaged(dir, record);
  if (!problems.length) {
    const result = checkImageSetConfigContent(fs.readFileSync(path.join(dir, TRANSFER_DIR, "imageset-config.yaml"), "utf8"));
    problems.push(...result.blockers.map((b) => `The received configuration is not a valid ImageSetConfiguration: ${b}`));
  }
  return problems;
};

/** Live-catalog standing of a profile's included operators (M5). */
const catalogVerificationSummary = (profile) => {
  if (!profile.content.operators) return null;
  const ops = profile.operators.selected.filter((op) => op.catalogImage && op.defaultChannel);
  const rows = ops.map((op) => ({ id: op.id, name: op.name, displayName: op.displayName || null, catalogImage: op.catalogImage, channel: op.defaultChannel, ...operatorVerificationState(op) }));
  const count = (st) => rows.filter((r) => r.status === st).length;
  return {
    total: rows.length,
    verified: count("verified"),
    unverified: count("unverified"),
    missing: count("package-not-found") + count("channel-not-found"),
    rangeEmpty: count("range-empty"),
    operators: rows
  };
};

const sha256Hex = (text) => crypto.createHash("sha256").update(text).digest("hex");

/** Whether each of the profile's derived directories really is its own (no symlink escape, nothing shared). */
const profileIsolationProblems = (profile) => {
  const paths = profilePaths(storeOf(profile), profile.id);
  const root = path.resolve(paths.root);
  const problems = [];
  try {
    const realRoot = fs.realpathSync(root);
    const realBase = fs.realpathSync(storeOf(profile).base);
    if (realRoot !== root || !isInside(realRoot, realBase)) problems.push(`This profile's directory ${root} resolves to ${realRoot}, outside the storage root ${realBase}.`);
  } catch { /* not created yet: derived, so it will be inside the root */ }
  for (const [label, dir] of [["archive", paths.archivePath], ["workspace", paths.workspacePath], ["cache", paths.cachePath], ["received transfers", paths.receivedPath]]) {
    let real = dir;
    try { real = fs.realpathSync(dir); } catch { continue; } // not created yet: derived, so it will be the profile's own
    if (real !== path.resolve(dir) || !real.startsWith(`${root}${path.sep}`)) {
      problems.push(`The ${label} directory ${dir} resolves to ${real}, outside this profile's own directory.`);
    }
  }
  return problems;
};

/** Mirroring-only preflight items, in the order a user reads them. */
const MODE_TEXT = {
  mirrorToDisk: "Mirror to disk (low side): oc-mirror pulls the content from the source registries into this profile's archive directory, for transfer to the disconnected side.",
  mirrorToMirror: "Mirror to mirror (connected): oc-mirror copies the content straight from the source registries into your registry, keeping its incremental history in this profile's workspace.",
  diskToMirror: "Disk to mirror (high side): oc-mirror loads a received transfer into your registry, using exactly the configuration recorded with the low-side run."
};
const mirroringPreflightItems = (profile, body, generated) => {
  const mode = body.mode;
  const items = [];
  const refusal = mirroringModeAvailability(profile)[mode];
  if (profile.kind === "received") {
    const o = profile.origin;
    items.push(preflightItem("profile", "pass", "Received profile", `Created from a transfer of "${o.profileName || o.profileId}" (plan ${o.planId}). Its content is the transfer's and is not edited here.`));
  } else {
    const readiness = generationReadiness(profile);
    items.push(readiness.length && mode !== "diskToMirror"
      ? preflightItem("profile", "block", "Profile content", readiness.map((r) => r.message).join(" "))
      : preflightItem("profile", "pass", "Profile content", `${profile.name}: ${[profile.content.platform && `OpenShift ${profile.platform.release.patchVersion}`, profile.content.operators && `${profile.operators.selected.filter((op) => op.catalogImage && op.defaultChannel).length} operator(s) from the ${profile.operators.catalogMinor} catalogs`, profile.content.additionalImages && `${profile.additionalImages.length} additional image(s)`].filter(Boolean).join(", ") || "no content selected"}.`));
  }
  items.push(refusal ? preflightItem("mode", "block", "Workflow", refusal) : preflightItem("mode", "pass", "Workflow", MODE_TEXT[mode] || mode));

  if (mode === "diskToMirror") {
    const r = body._received;
    if (body._receivedPlanIdRequested && !r) {
      items.push(preflightItem("received", "block", "Received transfer", `This profile has no received transfer for plan ${body._receivedPlanIdRequested}.`));
    } else if (r) {
      const problems = receivedConfigProblems(profile, r);
      items.push(problems.length
        ? preflightItem("received", "block", "Received transfer", problems.join(" "))
        : preflightItem("received", "pass", "Received transfer", `Plan ${r.planId} from "${r.origin.profileName || r.origin.profileId}", ${r.archives.length} archive file(s), ${(r.archives.reduce((n, a) => n + a.bytes, 0) / 1024 ** 3).toFixed(2)} GiB; every file was checked by SHA-256 when it was received on ${new Date(r.receivedAt).toISOString()}.`));
      // Option B: compared again now (the local binary may have changed since the receipt). Never blocks:
      // the tool check above decides whether a usable oc-mirror exists; this only says whose bytes it is.
      {
        const identity = compareToolIdentity(
          recordedToolIdentity({ sha256: r.toolSha256, version: r.toolVersion, gitCommit: r.toolGitCommit, arch: r.toolArch, channelRelease: r.toolChannelRelease }),
          body._localTool || { available: false, problem: "it was not checked" }
        );
        const st = { match: "pass", different: "warn", "local-missing": "unverified", "not-recorded": "info", "invalid-recorded": "warn" }[identity.status];
        items.push(preflightItem("oc-mirror-identity", st, "oc-mirror build (connected vs this side)", identity.text));
      }
      items.push(preflightItem("config-identity", "pass", "Configuration identity", `SHA-256 ${r.configSha256}: the configuration recorded with the low-side run (oc-mirror ${r.toolVersion || "unknown"}). It is used exactly as received; nothing is regenerated from this profile.`));
      // Transfer order for this destination: refused gaps and rollbacks block here
      // exactly as the run does (oc-mirror itself would exit 0).
      if (body.registryUrl) {
        const order = transferOrderFor(profile, r, body.registryUrl);
        items.push(preflightItem("transfer-order", order.allowed ? (order.status === "unknown" ? "warn" : "pass") : "block", "Transfer order", order.message));
      }
      // DOC-155 (M7): whether oc-mirror pinned every catalog on the low side.
      if (r.offlineReady === false) {
        const unpinned = (r.catalogIdentity || []).filter((c) => c.status === "unpinned").map((c) => c.sourceReference);
        items.push(preflightItem("catalog-identity", "warn", "Catalog identity", `Not offline-ready: the low side prepared this transfer although oc-mirror could not pin ${unpinned.join(", ") || "a catalog"} to a digest. Disk to mirror may need the source registry and then fail here. Prefer a new transfer from a fresh mirror to disk.`));
      } else if (r.offlineReady === true) {
        const n = (r.catalogIdentity || []).length;
        items.push(preflightItem("catalog-identity", "pass", "Catalog identity", n ? `Every operator catalog (${n}) was pinned to a digest by oc-mirror on the low side.` : "No operator catalogs in this transfer."));
      } else {
        items.push(preflightItem("catalog-identity", "unverified", "Catalog identity", "This transfer was prepared before catalog identity was recorded, so whether every catalog is pinned to a digest is not known."));
      }
    }
    items.push(body._isolateNetwork
      ? preflightItem("network", "pass", "Network on the disconnected side", `oc-mirror may reach only ${destinationHost(body.registryUrl).hostPort || "the destination registry"} and local addresses; every other request fails at once instead of reaching a source registry.`)
      : preflightItem("network", "warn", "Network on the disconnected side", "Network confinement is off: if the transfer does not contain everything oc-mirror needs, it may try to reach a source registry (and wait for its timeouts on a disconnected host)."));
  } else if (generated) {
    const imports = profile.imports || [];
    items.push(preflightItem("config-identity", "pass", "Configuration identity",
      `SHA-256 ${sha256Hex(generated)} (${Buffer.byteLength(generated)} bytes), generated from this profile and checked against the oc-mirror v2 schema. Each run stores this exact file, unchanged, in its plan.${imports.length ? ` Imported originals kept unchanged: ${imports.map((i) => `${i.fileName} (SHA-256 ${i.sha256.slice(0, 12)}…)`).join(", ")}.` : ""}`));
  }
  const isolation = profileIsolationProblems(profile);
  {
    // Where the content goes, checked as the server's own user (read, write, enter, free space).
    const ps = profileStorage(profile, mirrorStorage);
    const problem = mirroringStorageProblem(profile);
    const check = problem ? null : checkStorageBase(ps.base, { create: ps.pinned === null });
    const gib = (b) => `${(b / 1024 ** 3).toFixed(1)} GiB`;
    const where = `${ps.pinned ? "Mirroring storage root" : "Default storage (the application data directory)"} ${ps.base}`;
    if (problem) items.push(preflightItem("storage", "block", "Storage", problem));
    else if (check.freeBytes != null && check.freeBytes < 10 * 1024 ** 3) items.push(preflightItem("storage", "warn", "Storage", `${where}: only ${gib(check.freeBytes)} free. A mirror can need hundreds of GiB; oc-mirror fails part-way when the disk fills. Free space, or set OAA_MIRROR_STORAGE_ROOT to a larger volume for new profiles.`));
    else items.push(preflightItem("storage", "pass", "Storage", `${where}: readable and writable by the server's user (uid ${check.uid}); ${check.freeBytes != null ? `${gib(check.freeBytes)} free of ${gib(check.totalBytes)}` : "free space not reported"}.`));
  }
  items.push(isolation.length
    ? preflightItem("isolation", "block", "Profile isolation", isolation.join(" "))
    : preflightItem("isolation", "pass", "Profile isolation", `Archive, workspace, cache and received transfers are this profile's own, under ${profilePaths(storeOf(profile), profile.id).root}. No other profile or the Install workflow uses them.`));
  if (mode === "mirrorToDisk") {
    try {
      const existing = fs.readdirSync(profilePaths(storeOf(profile), profile.id).archivePath).filter((f) => /^mirror_.*\.tar$/.test(f));
      if (existing.length) {
        items.push(preflightItem("archive-replace", "info", "Earlier archives", `${existing.length} archive file(s) from an earlier run are in this profile's archive directory. oc-mirror deletes the archives in its destination when it starts — even for a dry run or a run that then fails — so Architect moves them into their run's own folder first (archives/sets/…). Nothing is deleted.`));
      }
    } catch { /* no archive directory yet */ }
    items.push(preflightItem("archive-size", "info", "Archive size", profile.options?.archiveSize
      ? `Archives are split into files of at most about ${profile.options.archiveSize} GiB (archiveSize).`
      : "oc-mirror's default archive size applies (no archiveSize in the configuration)."));
  }
  if (mode === "mirrorToMirror") {
    items.push(preflightItem("workspace-history", "info", "Incremental history", `oc-mirror keeps what it has mirrored in this profile's workspace (${profilePaths(storeOf(profile), profile.id).workspacePath}) and cache, so a later run copies only what is new. Another profile never reads them.`));
  }
  const verification = mode === "diskToMirror" ? null : catalogVerificationSummary(profile);
  if (verification) {
    if (verification.missing) {
      items.push(preflightItem("catalogs", "block", "Live catalog check", verification.operators.filter((o) => o.status === "package-not-found" || o.status === "channel-not-found").map((o) => o.message).join(" ")));
    } else if (verification.unverified) {
      items.push(preflightItem("catalogs", "unverified", "Live catalog check", `${verification.unverified} of ${verification.total} operator(s) have not been checked against the live catalogs, so whether each package and channel exists is unverified (structure is valid either way). oc-mirror stops while collecting if one does not exist. Check the catalogs before running, or run anyway.`));
    } else if (verification.rangeEmpty) {
      items.push(preflightItem("catalogs", "warn", "Live catalog check", verification.operators.filter((o) => o.status === "range-empty").map((o) => o.message).join(" ")));
    } else {
      items.push(preflightItem("catalogs", "pass", "Live catalog check", `All ${verification.total} operator(s) were found with their channels in the live catalogs.`));
    }
  }
  return items;
};

app.post("/api/mirroring/profiles/:id/preflight", validateBody(ocMirrorPreflightSchema), async (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  const { profile } = loaded;
  if (!checkMirroringProfileBoundaries(res, profile)) return;
  const body = mirroringExecutionBody(req.body, profile);
  const d2m = body.mode === "diskToMirror";
  const ready = !d2m && profile.kind !== "received" && generationReadiness(profile).length === 0;
  let generated = null;
  const result = await computeOcMirrorPreflight(ensureState(), body, {
    workflow: "mirroring",
    pullSecretPolicy: profile.content.platform || profile.content.operators ? "redhat" : "optional",
    imageRegistries: profile.content.additionalImages ? profile.additionalImages.map((img) => registryOfImage(img.name)) : [],
    ...(ready ? { buildGeneratedConfig: () => { const p = projectProfileForGeneration(profile); generated = buildCheckedImageSetConfig(p.state, p.options); return generated; } } : {})
  });
  if (result.status === 200) {
    if (!d2m) {
      for (const problem of generationReadiness(profile)) {
        result.json.blockers.push(problem.message);
        result.json.ok = false;
      }
      result.json.warnings.push(...profileWarnings(profile).map((w) => w.message));
    }
    // Option B: this server's oc-mirror identity, for the disk to mirror comparison (no download).
    if (body._received) body._localTool = await localToolIdentity(peekOcMirrorBinary, describeOcMirrorTool);
    const extra = mirroringPreflightItems(profile, body, generated);
    for (const it of extra) {
      if (it.status === "block" && !result.json.blockers.includes(it.detail) && (it.id !== "profile" || d2m)) result.json.blockers.push(it.detail);
    }
    if (d2m) {
      if (!body._received && !extra.some((i) => i.id === "received")) result.json.blockers.push(mirroringModeAvailability(profile).diskToMirror || "Receive a transfer first.");
      // The shared "configuration" check describes generated files; disk to mirror uses the received one.
      result.json.items = result.json.items.filter((i) => i.id !== "config");
    }
    result.json.items = [...extra, ...result.json.items];
    result.json.ok = result.json.blockers.length === 0;
    result.json.catalogVerification = catalogVerificationSummary(profile);
  }
  res.status(result.status).json(result.json);
});

/**
 * Mirror to disk (E13 protection and transfer cycles):
 * - before oc-mirror starts, nothing may sit where it deletes: the profile's
 *   earlier top-level archives move into their run's set (or preserved/);
 * - after a successful real run, its incremental cycle is recorded and its
 *   archives move into archives/sets/<planId>/.
 */
const m2dArchiveHooks = (profile, archiveDir, body) => ({
  beforeSpawn: ({ jobId }) => {
    // The latest successful real mirror to disk without its own set owns any top-level archives.
    const owner = [...profile.history].reverse().map((id) => ({ id, job: getJob(id), meta: getJobMetadata(id) }))
      .find(({ id, job, meta }) => id !== jobId && meta.mode === "mirrorToDisk" && !meta.dryRun && meta.plan?.planId && meta.plan.kind !== "received" && ["completed", "completed_with_warnings"].includes(job?.status));
    const ownerPlanId = owner && !owner.meta.archiveSet ? owner.meta.plan.planId : null;
    const moved = protectBeforeRun(archiveDir, { ownerPlanId });
    if (moved) {
      if (moved.planId && owner) updateJobMetadata(owner.id, { archiveSet: { dir: moved.dir, files: moved.files } });
      appendJobOutput(jobId, `Architect moved ${moved.files.length} earlier archive file(s) to ${moved.dir} before starting: oc-mirror deletes the archives in its destination when it starts. Nothing was deleted.\n`);
    }
    return { historyBefore: readHistory(archiveDir).map(({ name, time, sha256 }) => ({ name, time, sha256 })) };
  },
  afterSuccess: ({ jobId }) => {
    const meta = getJobMetadata(jobId);
    const planId = meta.plan?.planId;
    if (!planId) return null;
    const priorRuns = profile.history.map((id) => getJobMetadata(id)).filter((m) => m.mode === "mirrorToDisk" && !m.dryRun && m.plan?.planId && m.plan.planId !== planId)
      .map((m) => ({ planId: m.plan.planId, produced: m.cycle?.produced || null, startedAt: m.startedAt, finishedAt: m.finishedAt }));
    const cycle = cycleRecord({ before: meta.historyBefore || [], after: readHistory(archiveDir), since: (meta.plan && body.advanced?.since) || null, planId, createdAt: new Date(meta.startedAt || Date.now()).toISOString(), priorRuns });
    const set = keepRunArchives(archiveDir, planId);
    return { cycle, ...(set ? { archiveSet: set } : {}) };
  }
});

/**
 * oc-mirror's own dry run for a disk-to-mirror or mirror-to-mirror attempt,
 * then a fetch of every destination it maps (mirroringVerify.js). The dry run
 * touches neither the destination nor the archives (verified, X5); it runs
 * while the attempt still holds the run slot and its credentials.
 */
const verifyByDryRun = (mappingDir) => ({ args, resolved, authFile, envVars, register }) => new Promise((resolve, reject) => {
  const dryArgs = args.includes("--dry-run") ? args : [...args, "--dry-run"];
  const child = spawn(resolved.path, dryArgs, { env: envVars });
  register(child);
  let out = "";
  child.stdout.on("data", (d) => { if (out.length < 200000) out += d; });
  child.stderr.on("data", (d) => { if (out.length < 200000) out += d; });
  child.on("error", reject);
  child.on("close", async (code) => {
    if (code !== 0) return resolve({ state: "unverifiable", checks: [{ name: "oc-mirror dry run", ok: false, detail: `The dry run used to list the expected images exited with code ${code}.` }] });
    const file = path.join(mappingDir, "working-dir", "dry-run", "mapping.txt");
    let mapping = [];
    try { mapping = parseMapping(fs.readFileSync(file, "utf8")); } catch { /* reported below */ }
    if (!mapping.length) return resolve({ state: "unverifiable", checks: [{ name: "oc-mirror dry run", ok: false, detail: `No mapping.txt at ${file}.` }] });
    try { resolve(await verifyDestination(mapping, { authFile, env: envVars })); } catch (err) { reject(err); }
  });
});

/** Remember one recovery attempt on the profile (no credentials; persisted). */
const recordRecoveryAttempt = (profileId, originJobId, attemptJobId, planId, classification) => {
  const slice = readMirroringSlice();
  const current = slice.profiles[profileId];
  if (!current) return;
  const list = current.recoveries || [];
  const existing = list.find((r) => r.originJobId === originJobId);
  const attempt = { jobId: attemptJobId, planId, at: Date.now() };
  current.recoveries = existing
    ? list.map((r) => (r === existing ? { ...r, attempts: [...r.attempts, attempt] } : r))
    : [...list, { originJobId, classification: classification || null, createdAt: Date.now(), attempts: [attempt] }];
  slice.profiles[profileId] = normalizeProfile(current, profileId);
  writeMirroringSlice(slice);
};

/** What a finished run needs, from its own record (Operations details and the retry route). */
const recoveryFor = (job, meta) => {
  const errorFile = (() => {
    try { return readRunErrorFile(meta.mode === "mirrorToMirror" ? [meta.workspaceDir] : [meta.archiveDir], meta.startedAt, meta.finishedAt, { fsImpl: fs, before: meta.errorFilesBefore }); } catch { return null; }
  })();
  return classifyRecovery({ status: job.status, exitCode: meta.exitCode ?? null, dryRun: Boolean(meta.dryRun), mode: meta.mode }, errorFile?.lines || [], job.output || "");
};

/** Record a job in a profile's history (the profile is re-read; it may have changed meanwhile). */
const appendMirroringHistory = (profileId, jobId, { last = true } = {}) => {
  const slice = readMirroringSlice();
  const current = slice.profiles[profileId];
  if (!current) return;
  if (last) current.execution.lastRunJobId = jobId;
  current.history = [...current.history.filter((h) => h !== jobId), jobId];
  slice.profiles[profileId] = normalizeProfile(current, profileId);
  writeMirroringSlice(slice);
};

app.post("/api/mirroring/profiles/:id/run", validateBody(ocMirrorRunSchema), async (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  const { profile } = loaded;
  const body = mirroringExecutionBody(req.body, profile);
  if (mirroringModeAvailability(profile)[body.mode]) return res.status(409).json(mirroringModeRefusal(profile, body.mode));
  const storageProblem = mirroringStorageProblem(profile);
  if (storageProblem) return res.status(409).json({ error: storageProblem, code: "MIRRORING_STORAGE_UNAVAILABLE" });
  if (profileIsolationProblems(profile).length) {
    return res.status(409).json({ error: profileIsolationProblems(profile).join(" "), code: "PROFILE_NOT_ISOLATED" });
  }
  if (body.mode === "diskToMirror") return runReceivedTransfer(req, res, profile, body);
  const generated = generateMirroringConfig(res, profile);
  if (!generated) return;
  const verification = catalogVerificationSummary(profile);
  if (verification?.missing) {
    return res.status(409).json({
      error: "The live catalogs do not contain every selected operator or channel. Fix the selection or check the catalogs again before running.",
      code: "CATALOG_VERIFICATION_FAILED",
      details: verification.operators.filter((o) => o.status === "package-not-found" || o.status === "channel-not-found").map((o) => ({ path: `operators.${o.name}`, message: o.message }))
    });
  }
  const paths = profilePaths(storeOf(profile), profile.id);
  const dryRun = Boolean(body.dryRun);
  const result = await startOcMirrorRun({
    state: ensureState(),
    body: runServiceBody(body),
    workflow: "mirroring",
    profileId: profile.id,
    storage: storageView(profile),
    storageBaseExpected: profile.storageBase ?? null,
    ...(body.mode === "mirrorToDisk" ? m2dArchiveHooks(profile, paths.archivePath, body) : {}),
    defaults: {
      archivePath: paths.archivePath,
      workspacePath: paths.workspacePath,
      cachePath: paths.cachePath,
      registryUrl: profile.execution.registryUrl || ""
    },
    preparePlan: async (resolved, jobId) => createExecutionPlan({
      dataDir: storeOf(profile),
      profile,
      configYaml: generated.yaml,
      tool: await describeOcMirrorTool(resolved),
      mode: body.mode,
      dryRun,
      // Non-secret options exactly as passed to oc-mirror, plus the archive size in the file.
      options: { ...(profile.options?.archiveSize ? { archiveSize: profile.options.archiveSize } : {}), ...body.advanced },
      catalogVerification: verification ? verification.operators.map((o) => ({ name: o.name, catalogImage: o.catalogImage, channel: o.channel, status: o.status, checkedAt: o.checkedAt || null, ...(o.catalogDigest ? { catalogDigest: o.catalogDigest } : {}) })) : null,
      jobId,
      architect: { version: readAppVersion(), gitSha: (process.env.APP_GIT_SHA || "unknown").trim() }
    })
  });
  if (result.status === 200 && result.json.jobId) appendMirroringHistory(profile.id, result.json.jobId);
  res.status(result.status).json(result.json);
});

/** When a received plan was created on the connected side (its verified, staged plan.json). */
const receivedPlanCreatedAt = (profile, record) => {
  if (record.planCreatedAt) return record.planCreatedAt;
  try { return Date.parse(JSON.parse(fs.readFileSync(path.join(receivedDir(storeOf(profile), profile.id, record.planId), TRANSFER_DIR, "plan.json"), "utf8")).createdAt) || null; } catch { return null; }
};
/** Transfer-order decision for loading `record` into `registryUrl` (mirroringCycle.js). */
const transferOrderFor = (profile, record, registryUrl) => {
  const dest = destinationKey(registryUrl);
  const applied = (profile.appliedCycles || []).filter((a) => a.destination === dest);
  return cycleDecision({ planId: record.planId, planCreatedAt: receivedPlanCreatedAt(profile, record), cycle: record.cycle || null }, applied);
};

/**
 * "Run the same again" for an unfinished Mirroring run (manual; never automatic).
 * Byte-identical configuration and options from the original plan, a new plan
 * linked to it, the same profile's workspace and cache; credentials are asked
 * for again; a received transfer is re-hashed first; the result is checked
 * before it is reported (mirroringVerify.js).
 */
app.post("/api/mirroring/profiles/:id/operations/:jobId/retry", validateBody(mirroringRetrySchema), async (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  const { profile } = loaded;
  const job = getJob(req.params.jobId);
  const meta = job ? getJobMetadata(job.id) : {};
  if (!job || job.type !== "oc-mirror-run" || meta.workflow !== "mirroring" || meta.profileId !== profile.id || !profile.history.includes(job.id)) {
    return res.status(404).json({ error: "That run is not in this profile's history.", code: "OPERATION_NOT_FOUND" });
  }
  if (!["mirrorToDisk", "mirrorToMirror", "diskToMirror"].includes(meta.mode) || meta.dryRun || !meta.plan?.planId) return res.status(409).json({ error: "Only a real mirror run can be run again.", code: "NOT_RECOVERABLE" });
  const recovery = recoveryFor(job, meta);
  if (!recovery.eligible) return res.status(409).json({ error: recovery.text, code: "RECOVERY_NOT_OFFERED", classification: recovery.classification });
  if (mirroringProfileRunning(profile.id) || transferJobRunning(profile.id)) return res.status(409).json({ error: "Something is running for this profile; try again when it has finished.", code: "PROFILE_BUSY" });
  const storageProblem = mirroringStorageProblem(profile);
  if (storageProblem) return res.status(409).json({ error: storageProblem, code: "MIRRORING_STORAGE_UNAVAILABLE" });
  if (profileIsolationProblems(profile).length) return res.status(409).json({ error: profileIsolationProblems(profile).join(" "), code: "PROFILE_NOT_ISOLATED" });
  const originId = job.id;

  if (meta.mode === "diskToMirror") {
    const record = (profile.received || []).find((r) => r.planId === meta.plan.planId);
    if (!record) return res.status(409).json({ error: "The received transfer this run used is no longer in the profile.", code: "TRANSFER_NOT_RECEIVED" });
    // Re-check every staged byte before loading it again (not only sizes).
    const staged = receivedDir(storeOf(profile), profile.id, record.planId);
    for (const a of record.archives) {
      let h;
      try { h = await hashArchive(path.join(staged, a.file)); } catch { return res.status(409).json({ error: `${a.file} is no longer in the received copy.`, code: "TRANSFER_CHANGED" }); }
      if (h.sha256 !== a.sha256 || h.corrupt.length) return res.status(409).json({ error: `${a.file} changed after it was received; receive the transfer again.`, code: "TRANSFER_CHANGED" });
    }
    const body = mirroringExecutionBody({ mode: "diskToMirror", registryUrl: req.body.registryUrl || meta.registryUrl, mirrorAuthSource: "inline", mirrorPullSecret: req.body.mirrorPullSecret, receivedPlanId: record.planId, isolateNetwork: req.body.isolateNetwork ?? meta.plan.networkConfined !== false }, profile);
    // The original attempt's run options, not the profile's current ones.
    if (meta.requestBody?.advanced && typeof meta.requestBody.advanced === "object") body.advanced = { ...meta.requestBody.advanced };
    return runReceivedTransfer(req, res, profile, body, { recoveryOf: originId, classification: recovery.classification, verifyAfter: verifyByDryRun(staged) });
  }

  const read = readExecutionPlan(storeOf(profile), profile.id, meta.plan.planId, meta.plan.planSha256);
  if (!read.ok) return res.status(409).json({ error: "The original run's plan is missing or changed, so it cannot be run again exactly.", code: "PLAN_CHANGED" });
  const original = read.plan;
  const paths = profilePaths(storeOf(profile), profile.id);
  const body = mirroringExecutionBody({
    mode: meta.mode,
    ...(req.body.rhAuthSource ? { rhAuthSource: req.body.rhAuthSource } : {}),
    ...(req.body.rhPullSecret ? { rhPullSecret: req.body.rhPullSecret } : {}),
    ...(meta.mode === "mirrorToMirror" ? { registryUrl: req.body.registryUrl || meta.registryUrl, mirrorAuthSource: "inline", mirrorPullSecret: req.body.mirrorPullSecret } : {}),
    // The original run's options exactly (not the profile's current ones).
    advanced: { ...(original.execution?.options || {}) }
  }, profile);
  body.advanced = { ...(original.execution?.options || {}) };
  delete body.advanced.archiveSize;
  const result = await startOcMirrorRun({
    state: ensureState(),
    body: runServiceBody(body),
    workflow: "mirroring",
    profileId: profile.id,
    storage: storageView(profile),
    storageBaseExpected: profile.storageBase ?? null,
    ...(meta.mode === "mirrorToDisk" ? m2dArchiveHooks(profile, paths.archivePath, body) : {}),
    verifyAfter: meta.mode === "mirrorToDisk"
      ? async ({ jobId }) => {
        const m = getJobMetadata(jobId);
        const errors = (() => { try { return readRunErrorFile([paths.archivePath], m.startedAt, Date.now(), { fsImpl: fs, before: m.errorFilesBefore })?.lines || []; } catch { return []; } })();
        return verifyArchiveSet(m.archiveSet?.dir, { expectPinned: Boolean(original.content?.operators), historyAdvanced: Boolean(m.cycle?.produced), errorLines: errors });
      }
      : verifyByDryRun(paths.workspacePath),
    defaults: { archivePath: paths.archivePath, workspacePath: paths.workspacePath, cachePath: paths.cachePath, registryUrl: profile.execution.registryUrl || "" },
    preparePlan: async (resolved, jobId) => {
      const plan = createExecutionPlan({
        dataDir: storeOf(profile),
        profile,
        configYaml: read.configYaml,
        tool: await describeOcMirrorTool(resolved),
        mode: meta.mode,
        dryRun: false,
        options: original.execution?.options || {},
        catalogVerification: original.content?.operators?.verification || null,
        jobId,
        architect: { version: readAppVersion(), gitSha: (process.env.APP_GIT_SHA || "unknown").trim() },
        contentOverride: original.content,
        recoveryOf: { jobId: originId, planId: original.planId }
      });
      if (plan.record.configSha256 !== original.imagesetConfig.sha256) throw new Error("The configuration for the new attempt does not match the original byte for byte.");
      return { ...plan, record: { ...plan.record, recoveryOf: originId } };
    }
  });
  if (result.status === 200 && result.json.jobId) {
    appendMirroringHistory(profile.id, result.json.jobId);
    updateJobMetadata(result.json.jobId, { recoveryOf: originId, recoveryClassification: recovery.classification });
    recordRecoveryAttempt(profile.id, originId, result.json.jobId, null, recovery.classification);
  }
  res.status(result.status).json(result.json);
});

/**
 * Disk to mirror from a received transfer (M6): its staged, verified
 * configuration and archives, the profile's own cache, network confined to the
 * destination unless the request opts out. Nothing is generated.
 */
async function runReceivedTransfer(req, res, profile, body, extra = {}) {
  const record = body._received;
  if (!record) return res.status(409).json({ error: body._receivedPlanIdRequested ? `This profile has no received transfer for plan ${body._receivedPlanIdRequested}.` : "Receive a transfer first.", code: "TRANSFER_NOT_RECEIVED" });
  if (!body.registryUrl) return res.status(400).json({ error: "Registry URL is required for disk to mirror." });
  if (!checkMirroringProfileBoundaries(res, profile)) return;
  const problems = receivedConfigProblems(profile, record);
  if (problems.length) return res.status(409).json({ error: problems.join(" "), code: "TRANSFER_CHANGED" });
  // Known gaps and rollbacks are refused before oc-mirror runs (it would exit 0).
  const order = transferOrderFor(profile, record, body.registryUrl);
  if (!order.allowed && !body.dryRun) return res.status(409).json({ error: order.message, code: order.status === "rollback" ? "TRANSFER_ROLLBACK" : "TRANSFER_GAP" });
  const stagedDir = receivedDir(storeOf(profile), profile.id, record.planId);
  const paths = profilePaths(storeOf(profile), profile.id);
  const result = await startOcMirrorRun({
    state: ensureState(),
    body: runServiceBody(body),
    workflow: "mirroring",
    profileId: profile.id,
    storage: storageView(profile),
    storageBaseExpected: profile.storageBase ?? null,
    defaults: { archivePath: stagedDir, workspacePath: paths.workspacePath, cachePath: paths.cachePath, registryUrl: profile.execution.registryUrl || "" },
    // The staged configuration is the run's config; it is never deleted.
    preparePlan: async () => ({
      configPath: path.join(stagedDir, TRANSFER_DIR, "imageset-config.yaml"),
      record: {
        kind: "received",
        planId: record.planId,
        planSha256: record.origin.planSha256,
        configSha256: record.configSha256,
        manifestSha256: record.manifestSha256,
        originProfileId: record.origin.profileId,
        originJobId: record.origin.jobId,
        networkConfined: body._isolateNetwork,
        ...(extra.recoveryOf ? { recoveryOf: extra.recoveryOf } : {})
      }
    }),
    ...(extra.verifyAfter ? { verifyAfter: extra.verifyAfter } : {}),
    envOverrides: body._isolateNetwork ? disconnectedEnv(body.registryUrl) : null,
    // Remember what this destination has received, for the transfer-order guard.
    afterSuccess: ({ jobId, finishedAt }) => {
      const slice = readMirroringSlice();
      const current = slice.profiles[profile.id];
      if (!current) return null;
      const entry = { planId: record.planId, destination: destinationKey(body.registryUrl), planCreatedAt: receivedPlanCreatedAt(profile, record), kind: record.cycle?.kind || null, produced: record.cycle?.produced || null, jobId, at: finishedAt };
      current.appliedCycles = [...(current.appliedCycles || []).filter((a) => !(a.destination === entry.destination && a.planId === entry.planId)), entry];
      slice.profiles[profile.id] = normalizeProfile(current, profile.id);
      writeMirroringSlice(slice);
      return { transferOrder: order.status };
    }
  });
  if (result.status === 200 && result.json.jobId) {
    appendMirroringHistory(profile.id, result.json.jobId);
    if (extra.recoveryOf) {
      updateJobMetadata(result.json.jobId, { recoveryOf: extra.recoveryOf, recoveryClassification: extra.classification || null });
      recordRecoveryAttempt(profile.id, extra.recoveryOf, result.json.jobId, record.planId, extra.classification);
    }
  }
  res.status(result.status).json(result.json);
}

/** Request bodies of the run service carry no internal (underscore) fields. */
const runServiceBody = (body) => Object.fromEntries(Object.entries(body).filter(([k]) => !k.startsWith("_")));

/** One transfer preparation or receipt at a time per profile (M6). */
const runningTransferJobs = new Map();
const transferJobRunning = (profileId) => {
  const id = runningTransferJobs.get(profileId);
  return id && !isTerminalJobStatus(getJob(id)?.status) ? id : null;
};

/**
 * Low side (M6): write the transfer files for a completed, non-dry-run mirror
 * to disk — the latest one, because oc-mirror replaces the archives in the
 * profile's archive directory on every run.
 */
app.post("/api/mirroring/profiles/:id/transfer", validateBody(mirroringTransferPrepareSchema), async (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  const { profile } = loaded;
  if (profile.kind === "received") return res.status(409).json({ error: "A received profile has no mirror-to-disk runs to transfer.", code: "NOTHING_TO_TRANSFER" });
  const storageProblem = mirroringStorageProblem(profile);
  if (storageProblem) return res.status(409).json({ error: storageProblem, code: "MIRRORING_STORAGE_UNAVAILABLE" });
  const job = getJob(req.body.jobId);
  const meta = job ? getJobMetadata(job.id) : {};
  if (!job || meta.profileId !== profile.id || !profile.history.includes(job.id)) return res.status(404).json({ error: "That run is not in this profile's history." });
  if (meta.mode !== "mirrorToDisk" || meta.dryRun || !meta.plan?.planId || meta.plan.kind === "received") return res.status(409).json({ error: "Only a mirror-to-disk run that is not a dry run can be transferred.", code: "NOT_TRANSFERABLE" });
  if (!["completed", "completed_with_warnings"].includes(job.status)) return res.status(409).json({ error: `The run ${job.status === "running" ? "is still running" : "did not complete"}; nothing to transfer.`, code: "NOT_TRANSFERABLE" });
  // Runs since this tranche keep their archives in their own set; older runs
  // shared one folder, where a later run replaced them.
  const ownSet = meta.archiveSet?.dir && fs.existsSync(meta.archiveSet.dir) ? meta.archiveSet.dir : null;
  if (meta.archiveSet?.dir && !ownSet) return res.status(409).json({ error: "This run's archive folder is no longer on the server.", code: "ARCHIVES_MISSING" });
  const later = ownSet ? null : profile.history.slice(profile.history.indexOf(job.id) + 1).find((id) => {
    const m = getJobMetadata(id);
    return m.mode === "mirrorToDisk" && !m.dryRun && !["failed", "cancelled"].includes(getJob(id)?.status);
  });
  if (later) return res.status(409).json({ error: "A later mirror-to-disk run has replaced this run's archives. Transfer the latest run instead.", code: "ARCHIVES_REPLACED", latestJobId: later });
  if (mirroringProfileRunning(profile.id) || transferJobRunning(profile.id)) return res.status(409).json({ error: "Wait for this profile's current run or transfer to finish.", code: "PROFILE_BUSY" });
  const planCheck = readExecutionPlan(storeOf(profile), profile.id, meta.plan.planId, meta.plan.planSha256);
  if (!planCheck.ok) return res.status(409).json({ error: "The run's stored plan is missing or changed, so its transfer cannot be trusted.", code: "PLAN_CHANGED" });
  const transferJobId = createJob("mirroring-transfer", "Preparing the transfer: checking archive files…");
  updateJobMetadata(transferJobId, { workflow: "mirroring", profileId: profile.id, sourceJobId: job.id, planId: meta.plan.planId });
  runningTransferJobs.set(profile.id, transferJobId);
  updateJob(transferJobId, { status: "running", progress: 1 });
  res.json({ jobId: transferJobId });
  try {
    const paths = profilePaths(storeOf(profile), profile.id);
    const manifest = await prepareTransfer({
      archiveDir: ownSet || paths.archivePath,
      cycle: meta.cycle || null,
      planDir: path.join(paths.root, "plans", meta.plan.planId),
      origin: { profileId: profile.id, profileName: profile.name, jobId: job.id, planId: meta.plan.planId, planSha256: meta.plan.planSha256, runStatus: job.status },
      tool: planCheck.plan.tool || null,
      acknowledgeUnpinned: req.body.acknowledgeUnpinned === true,
      onProgress: (done, total) => updateJob(transferJobId, { progress: Math.max(1, Math.round((done / total) * 99)), message: `Preparing the transfer: checked ${done} of ${total} archive file(s)…` })
    });
    const slice = readMirroringSlice();
    const current = slice.profiles[profile.id];
    if (current) {
      current.transfers = [...current.transfers.filter((t) => t.jobId !== job.id), { jobId: job.id, planId: meta.plan.planId, manifestSha256: manifest.manifestSha256, preparedAt: Date.now(), archives: manifest.archives, offlineReady: manifest.offlineReady, transferDir: ownSet || paths.archivePath, cycleKind: manifest.cycle?.kind || null }];
      slice.profiles[profile.id] = normalizeProfile(current, profile.id);
      writeMirroringSlice(slice);
    }
    const unpinned = manifest.unpinnedCatalogs || [];
    const identity = manifest.catalogIdentity || [];
    updateJobMetadata(transferJobId, { ...getJobMetadata(transferJobId), manifestSha256: manifest.manifestSha256, archives: manifest.archives.length, bytes: manifest.archives.reduce((n, a) => n + a.bytes, 0), transferDir: ownSet || paths.archivePath, cycle: manifest.cycle || null, unpinnedCatalogs: unpinned, catalogIdentity: identity, offlineReady: manifest.offlineReady });
    const differs = identity.filter((c) => c.status === "differs-from-verified").map((c) => c.sourceReference);
    const notes = [
      manifest.offlineReady ? "" : ` NOT offline-ready: oc-mirror could not pin ${identity.filter((c) => c.status === "unpinned").map((c) => c.sourceReference).join(", ")} to a digest; disk to mirror may need the source. Run mirror to disk again, then prepare the transfer again, before carrying it across.`,
      differs.length ? ` Note: ${differs.join(", ")} changed after the operators were checked; the transfer holds the newer content. Check the operators again if that matters.` : ""
    ].join("");
    updateJobUnlessTerminal(transferJobId, { status: manifest.offlineReady && !differs.length ? "completed" : "completed_with_warnings", progress: 100, message: `Transfer ready: ${manifest.archives.length} archive file(s), SHA256SUMS and oaa-transfer/ in ${paths.archivePath}.${notes}` });
  } catch (err) {
    if (err?.code === "CATALOG_NOT_PINNED") updateJobMetadata(transferJobId, { ...getJobMetadata(transferJobId), code: err.code, unpinnedCatalogs: err.unpinned || [] });
    else if (err?.code === "CACHE_CONTENT_CORRUPT") updateJobMetadata(transferJobId, { code: err.code, corruptBlobs: (err.corrupt || []).map((c) => c.digest) });
    else if (err?.code) updateJobMetadata(transferJobId, { code: err.code });
    updateJobUnlessTerminal(transferJobId, { status: "failed", progress: 100, message: `The transfer could not be prepared: ${String(err?.message || err)}` });
  } finally {
    runningTransferJobs.delete(profile.id);
  }
});

/** Canonical, contained transfer directory, or { error }. */
const resolveTransferDir = (raw) => {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 4096) return { error: "Name the directory that holds the transfer." };
  let real;
  try { real = fs.realpathSync(path.resolve(raw.trim())); } catch { return { error: "That directory does not exist on the server." }; }
  // Transfer media may also sit on the Mirroring storage volume (accepted roots only; realpath, so no link escapes).
  const mirrorRoots = knownBases(mirrorStorage, Object.values(readMirroringSlice().profiles)).filter((b) => b !== mirrorStorage.legacy).map((b) => { try { return fs.realpathSync(b); } catch { return null; } }).filter(Boolean);
  if (!isPathAllowed(real) && !mirrorRoots.some((b) => isInside(real, b))) return { error: `The transfer must be under ${[...ALLOWED_BASE_PATHS, ...mirrorRoots].join(" or ")} on the server (mount the transfer media there).` };
  if (!fs.statSync(real).isDirectory()) return { error: "That path is not a directory." };
  return { dir: real };
};

/** Supported-minor boundary for content arriving in a transfer (No Fallback). */
const unsupportedTransferVersion = (plan) => {
  const minors = [];
  const rel = plan?.content?.platform?.release;
  if (rel) { try { minors.push(getMinorVersion(rel)); } catch { minors.push(String(rel)); } }
  if (plan?.content?.operators?.catalogMinor) minors.push(String(plan.content.operators.catalogMinor));
  const bad = minors.find((m) => !isSupportedMinor(m));
  return bad ? buildUnsupportedVersionError(bad) : null;
};

/**
 * High side (M6): verify a transfer completely, copy it into the receiving
 * profile, and record it. The receiving profile is the transfer's own
 * profile when this server has it (low and high side on one server),
 * otherwise a new "received" profile bound to the transfer's origin — never
 * an unrelated profile.
 */
app.post("/api/mirroring/receive", validateBody(mirroringReceiveSchema), async (req, res) => {
  const resolved = resolveTransferDir(req.body.transferDir);
  if (resolved.error) return res.status(400).json({ error: resolved.error, code: "TRANSFER_DIR_INVALID" });
  // Every root a profile's received copies can live under (DATA_DIR default and the Mirroring storage roots).
  const receivedCopyRoots = knownBases(mirrorStorage, Object.values(readMirroringSlice().profiles)).map((b) => { const r = path.join(b, "profiles"); try { return fs.realpathSync(r); } catch { return r; } });
  if (receivedCopyRoots.some((root) => insideReceivedCopy(resolved.dir, root))) {
    return res.status(400).json({ error: "That folder is a copy Architect already received, not the transfer you carried across. Name the folder where you copied the transfer files.", code: "TRANSFER_DIR_IS_RECEIVED_COPY" });
  }
  const jobId = createJob("mirroring-receive", "Receiving the transfer: checking files…");
  updateJobMetadata(jobId, { workflow: "mirroring", transferDir: resolved.dir });
  updateJob(jobId, { status: "running", progress: 1 });
  res.json({ jobId });
  let target = null;
  try {
    const verified = await verifyTransfer(resolved.dir, {
      onProgress: (done, total) => updateJob(jobId, { progress: Math.max(1, Math.round((done / total) * 70)), message: `Receiving the transfer: checked ${done} of ${total} archive file(s)…` })
    });
    if (!verified.ok) {
      appendJobOutput(jobId, `${verified.problems.map((p) => `PROBLEM: ${p}`).join("\n")}\n${verified.recovery.map((r) => `TO FIX: ${r}`).join("\n")}\n`);
      updateJobMetadata(jobId, { ...getJobMetadata(jobId), problems: verified.problems, recovery: verified.recovery });
      updateJobUnlessTerminal(jobId, { status: "failed", progress: 100, message: `The transfer failed verification: ${verified.problems[0]}${verified.problems.length > 1 ? ` (and ${verified.problems.length - 1} more)` : ""}` });
      return;
    }
    const vErr = unsupportedTransferVersion(verified.plan);
    if (vErr) {
      updateJobUnlessTerminal(jobId, { status: "failed", progress: 100, message: `${vErr.message} The transfer was not received.` });
      return;
    }
    const o = verified.manifest.origin;
    let slice = readMirroringSlice();
    // Room for the copy, checked before any profile is created or replaced.
    const existingTarget = slice.profiles[o.profileId]?.kind === "planned" ? o.profileId
      : Object.values(slice.profiles).find((p) => p.kind === "received" && p.origin?.profileId === o.profileId)?.id || null;
    const targetStore = existingTarget ? storeOf(slice.profiles[existingTarget]) : { base: profileStorage({ storageBase: newProfileStorageBase(mirrorStorage) }, mirrorStorage).base };
    const storeProblem = mirroringStorageProblem(existingTarget ? slice.profiles[existingTarget] : { storageBase: newProfileStorageBase(mirrorStorage) });
    if (storeProblem) {
      updateJobUnlessTerminal(jobId, { status: "failed", progress: 100, message: `${storeProblem} Nothing was copied.` });
      return;
    }
    const space = stagingSpaceProblem(existingTarget ? receivedDir(targetStore, existingTarget, o.planId) : path.join(targetStore.base, "profiles", "new", "received", o.planId), verified);
    if (space) {
      updateJobUnlessTerminal(jobId, { status: "failed", progress: 100, message: `${space} Free space on the server (or move DATA_DIR to a larger volume), then receive again. Nothing was copied.` });
      return;
    }
    if (slice.profiles[o.profileId]?.kind === "planned") {
      target = o.profileId;
    } else {
      target = Object.values(slice.profiles).find((p) => p.kind === "received" && p.origin?.profileId === o.profileId)?.id || null;
      if (!target) {
        if (Object.keys(slice.profiles).length >= MAX_PROFILES) throw new Error(`At most ${MAX_PROFILES} profiles.`);
        target = newProfileId();
        slice.profiles[target] = normalizeProfile({
          name: `Received: ${o.profileName || o.profileId}`.slice(0, 80),
          kind: "received",
          origin: o,
          content: { platform: Boolean(verified.plan.content?.platform), operators: Boolean(verified.plan.content?.operators), additionalImages: Boolean(verified.plan.content?.additionalImages) },
          execution: { mode: "diskToMirror" },
          storageBase: newProfileStorageBase(mirrorStorage)
        }, target);
        writeMirroringSlice(slice);
      }
    }
    if (mirroringProfileRunning(target) || transferJobRunning(target)) throw new Error("The receiving profile is running something; try again when it finishes.");
    runningTransferJobs.set(target, jobId);
    updateJob(jobId, { progress: 75, message: "Receiving the transfer: copying the verified files into the profile…" });
    await stageTransfer(resolved.dir, receivedDir(storeOf(slice.profiles[target]), target, o.planId), verified);
    slice = readMirroringSlice();
    const current = slice.profiles[target];
    if (!current) throw new Error("The receiving profile was deleted while the transfer was copied.");
    const identity = compareToolIdentity(recordedToolIdentity(verified.manifest.tool), await localToolIdentity(peekOcMirrorBinary, describeOcMirrorTool));
    const identityAtReceipt = { status: identity.status, localSha256: identity.local.sha256, localVersion: identity.local.version, checkedAt: Date.now() };
    const record = {
      origin: o,
      configSha256: verified.configSha256,
      manifestSha256: verified.manifestSha256,
      receivedAt: Date.now(),
      sourceDir: resolved.dir,
      toolVersion: verified.manifest.tool?.version || null,
      toolSha256: verified.manifest.tool?.sha256 || null,
      toolGitCommit: verified.manifest.tool?.gitCommit || null,
      toolArch: verified.manifest.tool?.arch || null,
      toolChannelRelease: verified.manifest.tool?.channelRelease || null,
      // Option B: is this server's oc-mirror the executable the connected side ran? (bytes only)
      toolIdentity: identityAtReceipt,
      offlineReady: typeof verified.manifest.offlineReady === "boolean" ? verified.manifest.offlineReady : null,
      catalogIdentity: verified.manifest.catalogIdentity || null,
      cycle: verified.manifest.cycle || null,
      planCreatedAt: Date.parse(verified.plan?.createdAt || "") || null,
      summary: [verified.plan.content?.platform && `OpenShift ${verified.plan.content.platform.release}`, verified.plan.content?.operators && `operators from the ${verified.plan.content.operators.catalogMinor} catalogs`, verified.plan.content?.additionalImages && `${verified.plan.content.additionalImages.length} additional image(s)`].filter(Boolean).join(", "),
      archives: verified.manifest.archives
    };
    current.received = [...current.received.filter((r) => r.planId !== o.planId), record];
    slice.profiles[target] = normalizeProfile(current, target);
    writeMirroringSlice(slice);
    updateJobMetadata(jobId, { ...getJobMetadata(jobId), profileId: target, profileName: current.name, planId: o.planId, originProfileId: o.profileId, manifestSha256: verified.manifestSha256, archives: verified.manifest.archives.length, offlineReady: record.offlineReady, toolIdentity: { status: identity.status, text: identity.text } });
    appendJobOutput(jobId, `oc-mirror build: ${identity.text}\n`);
    appendMirroringHistory(target, jobId, { last: false });
    updateJobUnlessTerminal(jobId, { status: "completed", progress: 100, message: `Transfer received into "${current.name}": ${verified.manifest.archives.length} archive file(s) verified and copied; plan ${o.planId}.` });
  } catch (err) {
    updateJobUnlessTerminal(jobId, { status: "failed", progress: 100, message: `The transfer could not be received: ${String(err?.message || err)}` });
  } finally {
    if (target && runningTransferJobs.get(target) === jobId) runningTransferJobs.delete(target);
  }
});

/** A profile's runs, newest first, with what each ran (M5). */
app.get("/api/mirroring/profiles/:id/runs", (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  const runs = [...loaded.profile.history].reverse().slice(0, 25).map((jobId) => {
    const job = getJob(jobId);
    if (!job) return { jobId, missing: true };
    const meta = getJobMetadata(jobId);
    return {
      jobId,
      status: job.status,
      message: job.message,
      progress: job.progress,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      mode: meta.mode || null,
      dryRun: Boolean(meta.dryRun),
      startedAt: meta.startedAt || null,
      finishedAt: meta.finishedAt || null,
      exitCode: meta.exitCode ?? null,
      archiveDir: meta.archiveDir || null,
      plan: meta.plan || null,
      releaseResult: meta.releaseResult || null,
      operatorResult: meta.operatorResult || null,
      failedImages: meta.failedImages || [],
      signatureFailures: meta.signatureFailures || [],
      retriedAs: meta.retriedAs || null,
      retryOf: meta.retryOf || null,
      dryRunMappingPath: meta.dryRunMappingPath || null,
      dryRunMissingPath: meta.dryRunMissingPath || null
    };
  });
  // A catalog check still running for this profile, so a reloaded page can
  // show and stop it (the job engine is the only source of truth).
  const verifyJobId = runningCatalogVerifications.get(loaded.profile.id);
  const verifyJob = verifyJobId ? getJob(verifyJobId) : null;
  res.json({
    profileId: loaded.profile.id,
    runs,
    activeVerification: verifyJob && !isTerminalJobStatus(verifyJob.status) ? { jobId: verifyJobId, status: verifyJob.status, progress: verifyJob.progress } : null
  });
});

/**
 * Where Mirroring content is stored on this server: the configured root (or
 * the DATA_DIR default) checked live as the server's user, and — with
 * ?profileId= — the root that profile is pinned to. Paths are container paths.
 */
app.get("/api/mirroring/storage", (req, res) => {
  const cfg = mirrorStorage;
  const forNew = cfg.configProblem
    ? { base: cfg.base, ok: false, problems: [cfg.configProblem], freeBytes: null, totalBytes: null }
    : checkStorageBase(cfg.base, { create: cfg.source === "default" });
  // Suggestions: the default and the volumes mounted into this server that the
  // server's user can write (checked live). Any other directory can be typed.
  const suggestions = [...new Set([...(cfg.configProblem ? [] : [cfg.base]), cfg.legacy, ...mountedCandidates()])].map((base) => {
    const c = checkStorageBase(base, { create: base === cfg.legacy });
    return { base, isDefault: base === cfg.base && !cfg.configProblem, isDataDirDefault: base === cfg.legacy, ok: c.ok, problems: c.problems, freeBytes: c.freeBytes, totalBytes: c.totalBytes };
  }).filter((r) => r.ok || r.isDefault);
  const out = {
    configured: { base: cfg.base, source: cfg.source, variable: "OAA_MIRROR_STORAGE_ROOT", ...forNew },
    defaultBase: cfg.legacy,
    suggestions,
    configProblems: cfg.configProblem ? [cfg.configProblem] : []
  };
  const id = typeof req.query.profileId === "string" ? req.query.profileId : null;
  if (id) {
    const profile = readMirroringSlice().profiles[id];
    if (!profile) return res.status(404).json({ error: "Profile not found." });
    const view = storageView(profile);
    const problem = mirroringStorageProblem(profile);
    const check = problem ? null : checkStorageBase(view.base, { create: view.source === "default" });
    const paths = profilePaths(storeOf(profile), profile.id);
    const busy = mirroringProfileRunning(profile.id) || transferJobRunning(profile.id);
    const locked = busy ? "Something is running for this profile." : storageChoiceLocked(profile, paths.root);
    out.profile = { ...view, ok: !problem, problem, freeBytes: check?.freeBytes ?? null, totalBytes: check?.totalBytes ?? null, uid: check?.uid ?? null, gid: check?.gid ?? null, paths, choiceLocked: locked || null };
  }
  res.json(out);
});

/**
 * Folder browser for the storage location (directories only). Like Install's
 * Browse, but scoped to where Mirroring content can sensibly live: the data
 * directory, /tmp, the default location, every volume mounted into the server
 * and existing profile locations — never the whole filesystem. Paths are
 * canonical (no symlink escapes); no file names, sizes or contents are listed.
 */
app.get("/api/mirroring/storage/browse", (req, res) => {
  const roots = [...new Set([path.resolve(process.env.DATA_DIR || "/data"), "/tmp", ...knownBases(mirrorStorage, Object.values(readMirroringSlice().profiles)), ...mountedCandidates()])]
    .filter((r) => fs.existsSync(r)).map((r) => { try { return fs.realpathSync(r); } catch { return null; } }).filter(Boolean);
  const requested = typeof req.query.path === "string" && req.query.path ? req.query.path : null;
  if (!requested) return res.json({ path: null, parent: null, roots: [...new Set(roots)], entries: [] });
  if (!path.isAbsolute(requested) || requested.length > 1024) return res.status(400).json({ error: "Use an absolute path.", code: "BROWSE_PATH_INVALID" });
  let probe = path.resolve(requested);
  while (!fs.existsSync(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe);
  let real;
  try { real = fs.realpathSync(probe); } catch { return res.status(404).json({ error: "That folder does not exist.", code: "BROWSE_NOT_FOUND" }); }
  const root = roots.find((r) => isInside(real, r));
  if (!root) return res.status(403).json({ error: "Only the data directory, /tmp, mounted volumes and existing profile locations can be browsed. Type any other path directly.", code: "BROWSE_OUTSIDE" });
  let entries = [];
  try {
    entries = fs.readdirSync(real, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name).sort((a, b) => a.localeCompare(b)).slice(0, 500);
  } catch (err) {
    return res.status(403).json({ error: `The server's user cannot list ${real} (${err.code || err.message}).`, code: "BROWSE_DENIED" });
  }
  let writable = false;
  try { fs.accessSync(real, fs.constants.W_OK | fs.constants.X_OK); writable = true; } catch { /* reported */ }
  res.json({ path: real, requestedMissing: real !== path.resolve(requested), parent: real === root ? null : path.dirname(real), root, roots: [...new Set(roots)], entries, writable });
});

/**
 * Choose where a profile's content goes: any directory the server's user can
 * write (validated: real directory, not a system, application or other
 * profile's directory), only while nothing has been written for the profile.
 * Never moves anything.
 */
app.post("/api/mirroring/profiles/:id/storage", validateBody(mirroringStorageChoiceSchema), (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  const { profile } = loaded;
  const wanted = path.resolve(req.body.base);
  const slice0 = readMirroringSlice();
  const otherProfileRoots = Object.values(slice0.profiles).filter((p) => p.id !== profile.id).map((p) => profilePaths(storeOf(p), p.id).root);
  const bad = locationProblem(req.body.base, { otherProfileRoots });
  if (bad) return res.status(400).json({ error: bad, code: "STORAGE_LOCATION_INVALID" });
  if (mirroringProfileRunning(profile.id) || transferJobRunning(profile.id)) {
    return res.status(409).json({ error: "Something is running for this profile; change its storage when it has finished.", code: "PROFILE_BUSY" });
  }
  const locked = storageChoiceLocked(profile, profilePaths(storeOf(profile), profile.id).root);
  if (locked) return res.status(409).json({ error: `${locked} Its storage cannot be changed; create a new profile to use another location.`, code: "STORAGE_ROOT_LOCKED" });
  // A missing last directory is created when its parent exists (like Install's
  // run does for its directories); nothing deeper is created.
  if (!fs.existsSync(wanted) && fs.existsSync(path.dirname(wanted))) {
    try { fs.mkdirSync(wanted, { mode: 0o750 }); } catch (err) { return res.status(409).json({ error: `${wanted} could not be created (${err.code || err.message}). Create it, give the server's user write access, then try again.`, code: "MIRRORING_STORAGE_UNAVAILABLE" }); }
  }
  const check = checkStorageBase(wanted, { create: wanted === mirrorStorage.legacy });
  if (!check.ok) return res.status(409).json({ error: check.problems.join(" "), code: "MIRRORING_STORAGE_UNAVAILABLE" });
  // Hold the one-run slot while switching, so no run can be between reading
  // the old root and writing its plan (the run re-checks after reserving).
  const token = nanoid();
  const held = reserveOcMirrorRun(getJob, token);
  if (!held.ok) return res.status(409).json({ error: "An oc-mirror run is in progress on this server; change the storage location when it has finished.", code: "OC_MIRROR_RUN_IN_PROGRESS" });
  try {
  const slice = readMirroringSlice();
  const current = slice.profiles[profile.id];
  current.storageBase = wanted === mirrorStorage.legacy ? null : wanted;
  current.updatedAt = Date.now();
  slice.profiles[profile.id] = normalizeProfile(current, profile.id);
  writeMirroringSlice(slice);
  res.json(describeMirroringProfile(slice.profiles[profile.id]));
  } finally {
    releaseOcMirrorRunReservation(token);
  }
});

/**
 * Everything the Mirroring workflow ran, newest first, across profiles: runs,
 * transfer preparations, receipts and catalog checks, linked to each other.
 * A read-only view of the job engine; output is fetched per job.
 */
app.get("/api/mirroring/operations", (req, res) => {
  const profiles = readMirroringSlice().profiles;
  const operations = linkOperations(listWorkflowJobSummaries("mirroring", 200).map((job) => operationOf(job, profiles)));
  res.json({ operations });
});

const loadMirroringOperation = (req, res) => {
  const job = getJob(req.params.jobId);
  const profiles = readMirroringSlice().profiles;
  if (!job || getJobMetadata(job.id).workflow !== "mirroring") {
    res.status(404).json({ error: "No Mirroring operation with that id.", code: "OPERATION_NOT_FOUND" });
    return null;
  }
  const op = operationOf(job, profiles);
  // What a generated plan contained, read from the plan itself (verified).
  if (op.kind === "run" && op.plan?.kind === "generated" && op.profileId && op.plan.planId && isValidPlanId(op.plan.planId)) {
    const read = profiles[op.profileId] ? readExecutionPlan(storeOf(profiles[op.profileId]), op.profileId, op.plan.planId, op.plan.planSha256) : { ok: false };
    op.contentSummary = read.ok ? contentSummaryOf(read.plan.content) : null;
    op.planReadable = read.ok;
  }
  const profile = op.profileId ? profiles[op.profileId] : null;
  if (op.kind === "run") {
    op.outcome = runOutcome(op);
    const m = getJobMetadata(job.id);
    op.recovery = m.dryRun ? null : recoveryFor(job, m);
    op.verification = m.verification || null;
    op.signatureRetry = m.signatureRetry || null;
    op.signatureRecovery = m.signatureRecovery || null;
    op.recoveryOf = m.recoveryOf || null;
    const meta = getJobMetadata(job.id);
    op.storage = meta.storage || null;
    // oc-mirror writes its error list into the working-dir of the directory it ran against.
    const dirs = op.mode === "mirrorToMirror" ? [op.workspaceDir] : [op.archiveDir];
    try { op.errorFile = readRunErrorFile(dirs, op.startedAt, op.finishedAt, { fsImpl: fs, before: meta.errorFilesBefore }); } catch { op.errorFile = null; }
    if (op.errorFile) op.errorFile.lines = op.errorFile.lines.map((l) => redactJobOutputForStorage(l));
    if (op.mode === "mirrorToDisk" && profile) op.archives = (profile.transfers || []).find((t) => t.jobId === job.id)?.archives || null;
  }
  if (op.kind === "transfer" && profile) op.archiveList = (profile.transfers || []).find((t) => t.jobId === op.sourceJobId)?.archives || null;
  if (op.kind === "receive" && profile && op.plan?.planId) op.archiveList = (profile.received || []).find((r) => r.planId === op.plan.planId)?.archives || null;
  if (op.kind === "run" && op.mode === "mirrorToDisk" && op.archives) { op.archiveList = op.archives; delete op.archives; }
  return { job, op };
};

/** One operation with its links and content summary (no output; use GET /api/jobs/:id). */
app.get("/api/mirroring/operations/:jobId", (req, res) => {
  const loaded = loadMirroringOperation(req, res);
  if (!loaded) return;
  const related = linkOperations(listWorkflowJobSummaries("mirroring", 200).map((job) => operationOf(job, readMirroringSlice().profiles)));
  loaded.op.links = related.find((o) => o.jobId === loaded.op.jobId)?.links || [];
  res.json({ operation: loaded.op });
});

/** The operation's output as a sanitized text download. */
app.get("/api/mirroring/operations/:jobId/log", (req, res) => {
  const loaded = loadMirroringOperation(req, res);
  if (!loaded) return;
  const stamp = new Date(Number(loaded.job.created_at) || Date.now()).toISOString().replace(/[:]/g, "-").replace(/\..+/, "");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="mirroring-${loaded.op.kind}-${stamp}-${loaded.job.id.replace(/[^A-Za-z0-9_-]/g, "")}.log"`);
  res.setHeader("Cache-Control", "no-store");
  // Lets a UI on another allowed origin (a split UI/API deployment) read the file name.
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  res.send(sanitizedLog(loaded.job, loaded.op, redactJobOutputForStorage));
});

/** One stored plan, verified against its own hashes before it is shown (M5). */
app.get("/api/mirroring/profiles/:id/plans/:planId", (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  if (!isValidPlanId(req.params.planId)) return res.status(404).json({ error: "Plan not found." });
  const expected = typeof req.query.sha256 === "string" && /^[a-f0-9]{64}$/.test(req.query.sha256) ? req.query.sha256 : null;
  const read = readExecutionPlan(storeOf(loaded.profile), loaded.profile.id, req.params.planId, expected);
  if (!read.ok) {
    if (read.reason === "missing" || read.reason === "invalid") return res.status(404).json({ error: "The plan is no longer on the server.", code: "PLAN_MISSING" });
    return res.status(409).json({ error: "The stored plan no longer matches its recorded SHA-256, so it is not shown.", code: "PLAN_CHANGED", reason: read.reason });
  }
  res.json({ plan: read.plan, imagesetConfig: read.configYaml });
});

/** One catalog verification at a time per profile. */
const runningCatalogVerifications = new Map();

/**
 * Check a profile's included operators against the live catalogs (M5): the
 * package exists, its channel exists, and — when a range is set — which listed
 * versions fall within it. Uses oc-mirror's own listing (the scan engine), so
 * it needs the same registry access as a scan; anything that cannot be checked
 * is recorded as unverified, never as passed.
 */
app.post("/api/mirroring/profiles/:id/verify-catalogs", validateBody(mirroringVerifyCatalogsSchema), async (req, res) => {
  const loaded = loadMirroringProfile(req, res);
  if (!loaded) return;
  const { profile } = loaded;
  if (!checkMirroringProfileBoundaries(res, profile)) return;
  if (!profile.content.operators) return res.status(409).json({ error: "This profile has no operator content to check.", code: "NOTHING_TO_VERIFY" });
  const ops = profile.operators.selected.filter((op) => op.catalogImage && op.defaultChannel);
  if (!ops.length) return res.status(409).json({ error: "None of the selected operators is resolved for a catalog yet, so there is nothing to check.", code: "NOTHING_TO_VERIFY" });
  const active = runningCatalogVerifications.get(profile.id);
  if (active && !isTerminalJobStatus(getJob(active)?.status)) return res.status(409).json({ error: "A catalog check is already running for this profile.", code: "VERIFICATION_IN_PROGRESS", jobId: active });

  const resolved = await resolveOcMirrorBinary(dataDir);
  const jobId = createJob("operator-verify", `Checking ${ops.length} operator(s) against the live catalogs…`);
  updateJobMetadata(jobId, { workflow: "mirroring", profileId: profile.id, catalogMinor: profile.operators.catalogMinor });
  if (resolved.error) {
    updateJob(jobId, { status: "failed", progress: 100, message: resolved.error });
    return res.json({ jobId });
  }
  let authFile = null;
  // The mounted secret is used only when chosen; no ambient credential fallback.
  const inline = req.body.rhAuthSource === "mounted" ? mountedRhPullSecret : req.body.rhPullSecret;
  try {
    if (inline) authFile = writeTempAuth(authFileDocument(parseRegistryAuth(inline, "pull secret")));
  } catch (err) {
    updateJob(jobId, { status: "failed", progress: 100, message: err instanceof RegistryAuthError ? err.message : "The pull secret could not be read." });
    return res.json({ jobId });
  }
  const authForList = authFile;
  runningCatalogVerifications.set(profile.id, jobId);
  updateJob(jobId, { status: "running", progress: 1 });
  res.json({ jobId });

  const results = new Map();
  // One verified fetch per catalog image: the pull secret is used by
  // OAA's own TLS-verified client only; oc-mirror lists the loopback copy.
  const catalogs = new Map(); // catalogImage -> { catalog } | { failure }
  const openCatalog = async (image) => {
    if (catalogs.has(image)) return catalogs.get(image);
    const controller = new AbortController();
    const handle = { kill: () => controller.abort() };
    activeProcesses.set(jobId, handle);
    appendJobOutput(jobId, `Fetching ${image} over verified TLS…\n`);
    let entry;
    try {
      const catalog = await openVerifiedCatalog(image, { authFile: authForList, dataDir, signal: controller.signal });
      appendJobOutput(jobId, `${image} verified: resolves to ${catalog.resolvedDigest}.\n`);
      entry = { catalog };
    } catch (err) {
      entry = { failure: classifyFetchFailure(err) };
      appendJobOutput(jobId, `${image}: ${entry.failure.message}\n`);
    } finally {
      if (activeProcesses.get(jobId) === handle) activeProcesses.delete(jobId);
    }
    catalogs.set(image, entry);
    return entry;
  };
  try {
    for (const [index, op] of ops.entries()) {
      if (isTerminalJobStatus(getJob(jobId)?.status)) break; // stopped
      const facts = {};
      const source = await openCatalog(op.catalogImage);
      if (isTerminalJobStatus(getJob(jobId)?.status)) break;
      if (source.failure) {
        facts.failure = source.failure;
        const verdict = judgeOperator(op, facts);
        results.set(op.id, { ...verdict, checkedAt: Date.now() });
        appendJobOutput(jobId, `[${verdict.status}] ${verdict.message}\n`);
        updateJob(jobId, { progress: Math.max(1, Math.round(((index + 1) / ops.length) * 100)) });
        continue;
      }
      facts.catalogDigest = source.catalog.resolvedDigest;
      const listed = await runListOperators({ bin: resolved.path, localReference: source.catalog.localReference, emptyAuthFile: source.catalog.emptyAuthFile, pkg: op.name, jobId });
      if (listed.exitCode === 0) {
        facts.listing = parsePackageListing(listed.stdout);
        if (!facts.listing) facts.failure = { kind: "error", message: "oc-mirror's package listing was not in the expected format." };
      } else {
        facts.failure = classifyLookupFailure(listed);
      }
      if (facts.listing && (op.minVersion || op.maxVersion) && facts.listing.channels.some((c) => c.name === op.defaultChannel)) {
        const ch = await runListOperators({ bin: resolved.path, localReference: source.catalog.localReference, emptyAuthFile: source.catalog.emptyAuthFile, pkg: op.name, channel: op.defaultChannel, jobId });
        facts.versions = ch.exitCode === 0 ? parseChannelVersions(ch.stdout) : null;
        if (!facts.versions) facts.failure = ch.exitCode === 0 ? { kind: "error", message: "oc-mirror's version listing was not in the expected format." } : classifyLookupFailure(ch);
      }
      if (isTerminalJobStatus(getJob(jobId)?.status)) break;
      if (facts.listing) {
        const prior = getPackageDetails(op.catalogImage, op.name) || {};
        storePackageDetails(op.catalogImage, op.name, {
          listing: facts.listing,
          versions: { ...(prior.versions || {}), ...(facts.versions ? { [op.defaultChannel]: facts.versions } : {}) },
          checkedAt: Date.now()
        });
      }
      const verdict = judgeOperator(op, facts);
      results.set(op.id, { ...verdict, checkedAt: Date.now(), catalogDigest: facts.catalogDigest || null });
      appendJobOutput(jobId, `[${verdict.status}] ${verdict.message}${verdict.detail ? ` (${verdict.detail})` : ""}\n`);
      updateJob(jobId, { progress: Math.max(1, Math.round(((index + 1) / ops.length) * 100)) });
    }
  } catch (err) {
    // The response has gone already; record the failure on the job instead of
    // leaving it "running" behind an unhandled rejection.
    logger.error({ err, jobId }, "Catalog verification failed");
    updateJobUnlessTerminal(jobId, { status: "failed", progress: 100, message: `The catalog check failed: ${String(err?.message || err)}` });
    return;
  } finally {
    if (authFile) safeUnlink(authFile);
    runningCatalogVerifications.delete(profile.id);
    for (const entry of catalogs.values()) await entry.catalog?.close().catch(() => {});
  }

  // Record what was checked on the profile as it is NOW; an operator the user
  // changed meanwhile keeps a record for what was checked, which reads as stale.
  const slice = readMirroringSlice();
  const current = slice.profiles[profile.id];
  if (current && results.size) {
    current.operators.selected = current.operators.selected.map((op) => {
      const r = results.get(op.id);
      const checked = ops.find((o) => o.id === op.id);
      if (!r || !checked) return op;
      const found = r.status !== "package-not-found" && r.status !== "unverified";
      return {
        ...op,
        ...(found && checked.catalogImage === op.catalogImage ? { verifiedMinor: current.operators.catalogMinor } : {}),
        verification: {
          status: r.status, message: r.message, checkedAt: r.checkedAt, source: "live",
          catalogImage: checked.catalogImage, ...(r.catalogDigest ? { catalogDigest: r.catalogDigest } : {}),
          channel: checked.defaultChannel, minVersion: checked.minVersion || "", maxVersion: checked.maxVersion || ""
        }
      };
    });
    slice.profiles[profile.id] = normalizeProfile(current, profile.id);
    writeMirroringSlice(slice);
  }
  const all = [...results.values()];
  const n = (st) => all.filter((r) => r.status === st).length;
  const missing = n("package-not-found") + n("channel-not-found");
  const message = `Checked ${all.length} of ${ops.length} operator(s): ${n("verified")} verified, ${missing} not found, ${n("range-empty")} with no version in range, ${n("unverified")} not checked.`;
  updateJobUnlessTerminal(jobId, {
    status: all.length < ops.length || n("unverified") || missing || n("range-empty") ? "completed_with_warnings" : "completed",
    progress: 100,
    message
  });
});

app.post("/api/mirroring/start-over", validateBody(mirroringEmptySchema), (req, res) => {
  // Scoped to Mirroring: cancels only Mirroring runs, resets only the Mirroring
  // slice, and deletes no mirrored data on disk.
  const cancelled = [];
  for (const job of runningOcMirrorJobs()) {
    if (!isMirroringJob(job.id)) continue;
    cancelOcMirrorJob(job, "Cancelled by Mirroring Start Over.");
    cancelled.push(job.id);
  }
  writeMirroringSlice(emptyMirroringSlice());
  res.json({ ok: true, cancelledJobIds: cancelled, mirroring: describeMirroringSlice(readMirroringSlice()) });
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
/**
 * Every GENERATED ImageSetConfiguration (Install preview, export bundle and
 * run; Mirroring preview and run) passes the shared oc-mirror v2 structural
 * validator (DOC-166, v2.2.0 M4) before anyone sees or executes it. A valid
 * document is returned byte-for-byte as the generator produced it; an invalid
 * one is a generator defect and fails closed (IMAGESET_CONFIG_INVALID, 422).
 */
const buildCheckedImageSetConfig = (state, options) => {
  const text = buildImageSetConfig(state, options);
  assertImageSetConfigStructure(text);
  return text;
};

/** JSON body for an invalid generated configuration or a missing schema. */
const imagesetValidationErrorBody = (error) => (error instanceof ImageSetConfigInvalidError
  ? { error: error.message, code: error.code, details: error.errors }
  : { error: error.message, code: error.code });

const isImagesetValidationError = (error) =>
  error instanceof ImageSetConfigInvalidError || error instanceof ImageSetSchemaUnavailableError;

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
    build: (state) => ({ "imageset-config.yaml": buildCheckedImageSetConfig(state) })
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
    if (isImagesetValidationError(error)) {
      return res.status(error instanceof ImageSetConfigInvalidError ? 422 : 500).json(imagesetValidationErrorBody(error));
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
  const imageSetConfig = buildCheckedImageSetConfig(v3State);
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
  // A generated imageset-config.yaml that oc-mirror v2 would refuse is never
  // packaged (v2.2.0 M4): the whole bundle fails closed with the findings.
  if (isImagesetValidationError(error)) {
    return res.status(error instanceof ImageSetConfigInvalidError ? 422 : 500).json(imagesetValidationErrorBody(error));
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
