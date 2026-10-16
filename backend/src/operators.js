/**
 * OpenShift Airgap Architect - Operator Catalog Scanning
 *
 * Scans RedHat, certified, and community operator catalogs using oc-mirror.
 * Parses operator metadata (name, display name, default channel) and stores
 * results in SQLite. Does not persist pull secrets or credentials.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { db } from "./db.js";
import { appendJobOutput, createJob, getJob, updateJob, safeUnlink } from "./utils.js";
import { activeProcesses } from "./processRegistry.js";
import { isTerminalJobStatus } from "./jobStatus.js";
import logger from "./logger.js";

/** Ceiling for one catalog scan. Overridable because a cold index pull on a
 *  slow link is legitimately long; the default only has to beat "forever". */
const DEFAULT_SCAN_TIMEOUT_MS = 15 * 60 * 1000;
const scanTimeoutMs = () => {
  const raw = Number(process.env.OPERATOR_SCAN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SCAN_TIMEOUT_MS;
};

/** Grace between SIGTERM and SIGKILL for a scan that overran its limit. */
const SIGKILL_ESCALATION_MS = 10 * 1000;

/** Render a duration without claiming "0s" for a sub-second limit. */
const formatSeconds = (ms) => (ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`);

const ARCH_MISMATCH_SIGNATURES = ["ld-linux-x86-64.so.2", "qemu-x86_64-static"];
const isArchMismatch = (stderr) =>
  typeof stderr === "string" && ARCH_MISMATCH_SIGNATURES.some((sig) => stderr.includes(sig));
const ARCH_GUIDANCE =
  "The oc-mirror binary is not compatible with this container's CPU architecture. " +
  "Rebuild the container so it bakes in the correct native binary, or set OC_MIRROR_BIN " +
  "to a compatible binary path, or set OC_MIRROR_URL to a download URL (see README).";

/**
 * One pull secret serves every catalog in a scan request, so it belongs to
 * the request rather than to any single child. Unlinking it from the first
 * child's `close` handler deleted the credential the other scans were still
 * passing to `--authfile`.
 */
const createSharedAuthRelease = (authFile, count) => {
  let outstanding = count;
  return () => {
    if (!authFile) return;
    outstanding -= 1;
    if (outstanding > 0) return;
    safeUnlink(authFile);
  };
};

const catalogs = [
  { id: "redhat", image: (v) => `registry.redhat.io/redhat/redhat-operator-index:v${v}` },
  { id: "certified", image: (v) => `registry.redhat.io/redhat/certified-operator-index:v${v}` },
  { id: "community", image: (v) => `registry.redhat.io/redhat/community-operator-index:v${v}` }
];

const getCatalogs = () => catalogs;

const parseOperatorTable = (text, catalogId) => {
  const lines = text.split("\n").map((l) => l.trimEnd()).filter(Boolean);
  const headerIndex = lines.findIndex((l) => l.startsWith("NAME"));
  if (headerIndex === -1) return [];
  const header = lines[headerIndex];
  const displayIdx = header.indexOf("DISPLAY NAME");
  const channelIdx = header.indexOf("DEFAULT CHANNEL");
  const rows = lines.slice(headerIndex + 1);
  const results = [];
  for (const row of rows) {
    if (!row.trim()) continue;
    const name = displayIdx > 0 ? row.slice(0, displayIdx).trim() : row.split(/\s{2,}/)[0];
    const displayName = displayIdx >= 0 && channelIdx > displayIdx
      ? row.slice(displayIdx, channelIdx).trim()
      : "";
    const defaultChannel = channelIdx >= 0 ? row.slice(channelIdx).trim() : "";
    if (!name) continue;
    results.push({
      id: `${catalogId}:${name}`,
      name,
      displayName: displayName || "",
      defaultChannel: defaultChannel || "",
      catalog: catalogId
    });
  }
  return results;
};

const storeResults = (version, catalogId, results) => {
  db.prepare(
    "INSERT INTO operator_results (version, catalog, results_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(version, catalog) DO UPDATE SET results_json = excluded.results_json, updated_at = excluded.updated_at"
  ).run(version, catalogId, JSON.stringify(results), Date.now());
};

const getResults = (version, catalogId) => {
  const row = db.prepare("SELECT results_json, updated_at FROM operator_results WHERE version = ? AND catalog = ?").get(version, catalogId);
  if (!row) return null;
  return { results: JSON.parse(row.results_json), updatedAt: row.updated_at };
};

const authAvailable = () => {
  const file = process.env.REGISTRY_AUTH_FILE;
  if (!file) return false;
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
};

const runScanJob = ({
  version,
  catalogId,
  catalogImage,
  authFile,
  jobType = "operator-scan",
  message,
  ocMirrorPath,
  onSettled,
  timeoutMs,
  sigkillAfterMs
}) => {
  const jobId = createJob(jobType, message || `Scanning ${catalogId} operators...`);

  if (process.env.NODE_ENV !== "test") {
    logger.info({ tag: "operator-scan:start", jobId, catalogId, catalogImage, version, authProvided: !!authFile }, "Operator scan started");
  }

  const resolvedAuthFile = authFile || process.env.REGISTRY_AUTH_FILE;
  const args = ["--v2", "list", "operators", `--catalog=${catalogImage}`];
  if (resolvedAuthFile) {
    args.push(`--authfile=${resolvedAuthFile}`);
  }
  const { REGISTRY_AUTH_FILE: _drop, ...envWithoutRegistryAuthFile } = process.env;
  const env = { ...envWithoutRegistryAuthFile };
  const bin = ocMirrorPath || "oc-mirror";

  const child = spawn(bin, args, { env });
  // Registered before the job is advertised as running: a job that reports
  // `running` while /api/jobs/:id/stop answers 404 is exactly the state L3
  // exists to remove.
  activeProcesses.set(jobId, child);
  updateJob(jobId, { status: "running", progress: 5 });

  let output = "";
  let error = "";
  let downloadStarted = false;
  let settled = false;
  let timer = null;

  // `authFile` only. `resolvedAuthFile` may be a mounted REGISTRY_AUTH_FILE
  // that belongs to the operator and must survive every scan.
  const releaseCredentials = onSettled || (() => { if (authFile) safeUnlink(authFile); });

  /**
   * Exactly one outcome per child.
   *
   * Node emits BOTH `error` and `close` when a spawn fails, which is how the
   * ENOENT diagnostic used to be overwritten by a generic failure message and
   * an empty output column. A stop or a shutdown can also land before either,
   * which is how a `cancelled` job used to come back relabelled `failed`.
   * Credentials are released on every path, including those that write no
   * status because the outcome is already recorded.
   */
  const settle = (finalize) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    releaseCredentials();
    const current = getJob(jobId);
    if (current && isTerminalJobStatus(current.status)) return;
    finalize();
  };

  const limitMs = Number.isFinite(timeoutMs) ? timeoutMs : scanTimeoutMs();
  if (limitMs > 0) {
    timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Already gone; `close` will settle it.
      }
      // SIGTERM is a request. A child that ignores it — which oc-mirror can
      // do while it is mid-write — would otherwise keep pulling from the
      // registry behind a job row that already says `failed`, and shutdown
      // would re-send the same ignored signal. Nothing else in this codebase
      // escalates, so this is the only place that can.
      const graceMs = Number.isFinite(sigkillAfterMs) ? sigkillAfterMs : SIGKILL_ESCALATION_MS;
      const sigkillTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already gone.
        }
      }, graceMs);
      sigkillTimer.unref?.();
      child.once("close", () => clearTimeout(sigkillTimer));

      settle(() => updateJob(jobId, {
        status: "failed",
        progress: 100,
        message: `oc-mirror timed out after ${formatSeconds(limitMs)} (${catalogId}).`
      }));
    }, limitMs);
    // A pending scan timer must never hold the event loop open by itself.
    timer.unref?.();
  }

  child.stdout.on("data", (data) => {
    const s = data.toString();
    output += s;
    appendJobOutput(jobId, s);

    // Detect catalog download/processing events
    if (!downloadStarted && (s.includes("Pulling") || s.includes("Downloading") || s.includes("copying"))) {
      downloadStarted = true;
      if (process.env.NODE_ENV !== "test") {
        logger.info({ tag: "operator-scan:download", jobId, catalogId, event: "catalog_download_started" }, "Catalog download started");
      }
      updateJob(jobId, { progress: 20, message: `Downloading ${catalogId} catalog...` });
    }
  });
  child.stderr.on("data", (data) => {
    const s = data.toString();
    error += s;
    appendJobOutput(jobId, s);
  });
  child.on("error", (err) => {
    const detail = err?.message || "oc-mirror spawn error";
    // Appended, not assigned: the `close` that Node also emits for a failed
    // spawn used to replace this with `error || output`, which was empty.
    appendJobOutput(jobId, `\n${detail}\n`);
    settle(() => updateJob(jobId, {
      status: "failed",
      progress: 100,
      message: isArchMismatch(`${error}\n${detail}`)
        ? ARCH_GUIDANCE
        : `oc-mirror failed to start (${catalogId}): ${detail}`
    }));
  });

  child.on("close", (code) => {
    // Unconditional: the registry must not retain a dead child even when the
    // job's outcome was already recorded elsewhere.
    activeProcesses.delete(jobId);
    settle(() => {
    if (code !== 0) {
      const userMessage = isArchMismatch(error)
        ? ARCH_GUIDANCE
        : `oc-mirror failed (${catalogId}).`;

      if (process.env.NODE_ENV !== "test") {
        logger.warn({ tag: "operator-scan:failed", jobId, catalogId, exitCode: code, archMismatch: isArchMismatch(error) }, "Operator scan failed");
      }

      updateJob(jobId, {
        status: "failed",
        progress: 100,
        message: userMessage,
        output: error || output
      });
      return;
    }

    if (process.env.NODE_ENV !== "test") {
      logger.info({ tag: "operator-scan:parsing", jobId, catalogId, event: "parsing_operator_table" }, "Parsing operator table");
    }
    updateJob(jobId, { progress: 80, message: `Parsing ${catalogId} operators...` });

    const parsed = parseOperatorTable(output, catalogId);

    if (process.env.NODE_ENV !== "test") {
      logger.info({ tag: "operator-scan:caching", jobId, catalogId, version, operatorCount: parsed.length, event: "storing_to_cache" }, "Caching operator results");
    }
    updateJob(jobId, { progress: 95, message: `Caching ${parsed.length} ${catalogId} operators...` });

    storeResults(version, catalogId, parsed);

    if (process.env.NODE_ENV !== "test") {
      logger.info({ tag: "operator-scan:complete", jobId, catalogId, version, operatorCount: parsed.length }, "Operator scan completed");
    }

    updateJob(jobId, {
      status: "completed",
      progress: 100,
      message: `Completed ${catalogId} scan.`,
      output
    });
    });
  });

  return jobId;
};

export { getCatalogs, getResults, runScanJob, authAvailable, createSharedAuthRelease };
