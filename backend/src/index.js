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
import { ensureInstaller, getAwsAmi, getAwsRegions, installerPathFor, warmInstallerStream } from "./installer.js";
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
  safeUnlink,
  createJob,
  updateJob,
  appendJobOutput
} from "./utils.js";
import { buildAgentConfig, buildFieldManual, buildImageSetConfig, buildInstallConfig, buildNtpMachineConfigs } from "./generate.js";
import { docsKey, getDocsFromCache, storeDocs, updateDocsLinks } from "./docs.js";

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

markStaleJobs();

const warmCincinnatiCache = async () => {
  try {
    await fetchChannels(false);
  } catch {
    // ignore warm cache errors
  }
};

warmCincinnatiCache();

const activeProcesses = new Map();

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
    confirmed: false
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
      subnet: ""
    },
    azure: {
      cloudName: "AzureUSGovernmentCloud",
      region: "",
      resourceGroupName: "",
      baseDomainResourceGroupName: ""
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
    additionalTrustBundlePolicy: ""
  },
  docs: {
    connectivity: "fully-disconnected",
    links: []
  },
  exportOptions: {
    includeCredentials: false,
    includeCertificates: true,
    includeClientTools: false,
    includeInstaller: false,
    exportBinaryArch: null,
    draftMode: false
  },
  mirrorWorkflow: {
    outputPath: path.join(dataDir, "oc-mirror-output"),
    includeInExport: false
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
  if (existing) return existing;
  const initial = defaultState();
  setState(initial);
  return initial;
};

const updateState = (patch) => {
  const current = ensureState();
  const merged = { ...current, ...patch };
  setState(merged);
  return merged;
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
  }
  if (includeCredentials && next.credentials?.mirrorRegistryPullSecret) {
    next.credentials.mirrorRegistryPullSecret = normalizePullSecret(next.credentials.mirrorRegistryPullSecret);
  }
  return next;
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
  res.json(ensureState());
});

app.post("/api/state", (req, res) => {
  const patch = req.body || {};
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

app.post("/api/start-over", (req, res) => {
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
    fs.readdirSync(tmpDir).forEach((file) => safeUnlink(path.join(tmpDir, file)));
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
  const migrated = schemaVersion === 1
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

app.post("/api/cincinnati/patches/update", async (req, res) => {
  try {
    const channel = req.body.channel;
    const versions = await fetchPatchesForChannel(channel, true);
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

app.post("/api/ocmirror/run", async (req, res) => {
  const state = ensureState();
  const confirmed = state.version?.versionConfirmed ?? state.release?.confirmed;
  if (!confirmed) {
    return res.status(400).json({ error: "Version not confirmed." });
  }
  const outputPath = req.body?.outputPath || state.mirrorWorkflow?.outputPath;
  if (!outputPath) {
    return res.status(400).json({ error: "Output path is required." });
  }
  const minBytes = Number(req.body?.minBytes || 0);
  try {
    const pathInfo = await checkPath(outputPath);
    if (!pathInfo.writable) {
      return res.status(400).json({ error: "Output path is not writable." });
    }
    if (minBytes && pathInfo.freeBytes < minBytes) {
      return res.status(400).json({ error: "Insufficient free space at output path." });
    }
    fs.mkdirSync(outputPath, { recursive: true });
  } catch (error) {
    return res.status(500).json({ error: String(error?.message || error) });
  }
  const jobId = createJob("oc-mirror-run", "oc-mirror run starting.");
  const resolved = await resolveOcMirrorBinary(dataDir);
  if (resolved.error) {
    updateJob(jobId, {
      status: "failed",
      progress: 100,
      message: resolved.error,
      output: resolved.rawStderr || resolved.error
    });
    return res.json({ jobId });
  }
  const configContents = buildImageSetConfig(state);
  const tmpDir = path.join(dataDir, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const configPath = path.join(tmpDir, `imageset-${jobId}.yaml`);
  fs.writeFileSync(configPath, configContents, "utf8");
  let authFile = null;
  if (req.body?.pullSecret) {
    const normalized = normalizePullSecret(req.body.pullSecret);
    authFile = writeTempAuth(normalized);
  }
  const env = {
    ...process.env,
    REGISTRY_AUTH_FILE: authFile || process.env.REGISTRY_AUTH_FILE
  };
  const child = spawn(resolved.path, ["--config", configPath, `file://${outputPath}`, "--v2"], { env });
  activeProcesses.set(jobId, child);
  updateJob(jobId, { status: "running", progress: 0, message: "oc-mirror running." });
  child.stdout.on("data", (data) => appendJobOutput(jobId, data.toString()));
  child.stderr.on("data", (data) => appendJobOutput(jobId, data.toString()));
  child.on("error", (err) => {
    appendJobOutput(jobId, `\n${String(err)}\n`);
    updateJob(jobId, { status: "failed", message: "oc-mirror failed to start." });
    activeProcesses.delete(jobId);
    safeUnlink(configPath);
    if (authFile) safeUnlink(authFile);
  });
  child.on("close", (code) => {
    const status = code === 0 ? "completed" : "failed";
    updateJob(jobId, {
      status,
      progress: code === 0 ? 100 : 0,
      message: code === 0 ? "oc-mirror completed." : `oc-mirror exited with code ${code}.`
    });
    activeProcesses.delete(jobId);
    safeUnlink(configPath);
    if (authFile) safeUnlink(authFile);
  });
  res.json({ jobId });
});

app.get("/api/docs", (req, res) => {
  const state = ensureState();
  const version = state.release?.channel ? `4.${state.release.channel.split(".")[1]}` : "4.0";
  const key = docsKey(version, state.blueprint?.platform, state.methodology?.method, state.docs?.connectivity);
  const cached = getDocsFromCache(key);
  res.json({ cached });
});

app.post("/api/docs/update", async (req, res) => {
  const state = ensureState();
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
  const version = state.release?.channel ? `4.${state.release.channel.split(".")[1]}` : "4.0";
  const key = docsKey(version, state.blueprint?.platform, state.methodology?.method, state.docs?.connectivity);
  const cached = getDocsFromCache(key);
  const links = cached?.links || [];
  const installConfig = buildInstallConfig(state);
  const agentConfig =
    state.blueprint?.platform === "Bare Metal" && state.methodology?.method === "Agent-Based Installer"
      ? buildAgentConfig(state)
      : null;
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

app.get("/api/generate", (req, res) => {
  const state = ensureState();
  const files = buildPreviewFiles(state);
  if (!files) return res.status(400).json({ error: "Version not confirmed." });
  res.json({ files });
});

app.post("/api/generate", (req, res) => {
  const bodyState = req.body?.state;
  const state = bodyState && typeof bodyState === "object" ? bodyState : ensureState();
  const files = buildPreviewFiles(state);
  if (!files) return res.status(400).json({ error: "Version not confirmed." });
  res.json({ files });
});

const buildBundleZip = async (state, res) => {
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
  const agentConfig =
    state.blueprint?.platform === "Bare Metal" && state.methodology?.method === "Agent-Based Installer"
      ? buildAgentConfig(state)
      : null;
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
      await resolveOcMirrorBinary(dataDir);
      const exportArch = state.exportOptions?.exportBinaryArch || getLocalBinaryArch();
      const { ocPath, ocMirrorPath } = await getBinariesForExportArch(exportArch, dataDir);
      if (ocPath && fs.existsSync(ocPath)) {
        archive.file(ocPath, { name: "tools/oc" });
      }
      if (ocMirrorPath && fs.existsSync(ocMirrorPath)) {
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
      await ensureInstaller(version);
      const installerPath = installerPathFor(version);
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
  if (state.mirrorWorkflow?.includeInExport && state.mirrorWorkflow?.outputPath) {
    const rawPath = state.mirrorWorkflow.outputPath;
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

app.get("/api/bundle.zip", async (req, res) => {
  const state = ensureState();
  await buildBundleZip(state, res);
});

app.post("/api/bundle.zip", async (req, res) => {
  const bodyState = req.body?.state;
  const state = bodyState && typeof bodyState === "object" ? bodyState : ensureState();
  await buildBundleZip(state, res);
});

let server;
if (process.env.NODE_ENV !== "test") {
  server = app.listen(port, () => {
    console.log(`Backend listening on ${port}`);
  });
  const shutdown = (signal) => {
    console.log(`Received ${signal}, shutting down...`);
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function clearUpdateInfoCache() {
  updateInfoCache = null;
}

export { app, clearUpdateInfoCache };
