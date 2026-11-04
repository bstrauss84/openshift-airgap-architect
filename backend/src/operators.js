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
import { appendJobOutput, createJob, getJob, updateJob, updateJobMetadata, safeUnlink } from "./utils.js";
import { activeProcesses } from "./processRegistry.js";
import { isTerminalJobStatus } from "./jobStatus.js";
import logger from "./logger.js";
import { openVerifiedCatalog, loopbackCatalogArgs, loopbackListEnv } from "./verifiedCatalog.js";

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

const storeResults = (version, catalogId, results, identity = null) => {
  db.prepare(
    "INSERT INTO operator_results (version, catalog, results_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(version, catalog) DO UPDATE SET results_json = excluded.results_json, updated_at = excluded.updated_at"
  ).run(version, catalogId, JSON.stringify(results), Date.now());
  if (identity) {
    db.prepare(
      "INSERT INTO operator_catalog_identity (version, catalog, source_reference, resolved_digest, manifest_digest, verified_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(version, catalog) DO UPDATE SET source_reference = excluded.source_reference, resolved_digest = excluded.resolved_digest, manifest_digest = excluded.manifest_digest, verified_at = excluded.verified_at"
    ).run(version, catalogId, identity.sourceReference, identity.resolvedDigest, identity.manifestDigest, identity.verifiedAt);
  } else {
    // Results without a verified identity (none are produced by the product
    // path) must not keep a stale identity from an earlier scan.
    db.prepare("DELETE FROM operator_catalog_identity WHERE version = ? AND catalog = ?").run(version, catalogId);
  }
};

/** The verified identity of the catalog content a stored scan describes, or null. */
const getCatalogIdentity = (version, catalogId) => {
  const row = db.prepare("SELECT source_reference, resolved_digest, manifest_digest, verified_at FROM operator_catalog_identity WHERE version = ? AND catalog = ?").get(version, catalogId);
  return row ? { sourceReference: row.source_reference, resolvedDigest: row.resolved_digest, manifestDigest: row.manifest_digest, verifiedAt: row.verified_at } : null;
};

const getResults = (version, catalogId) => {
  const row = db.prepare("SELECT results_json, updated_at FROM operator_results WHERE version = ? AND catalog = ?").get(version, catalogId);
  if (!row) return null;
  return { results: JSON.parse(row.results_json), updatedAt: row.updated_at, catalogIdentity: getCatalogIdentity(version, catalogId) };
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
  sigkillAfterMs,
  // Recorded on the job (never credentials): which workflow and profile asked for
  // this scan, so the Mirroring Operations view can list it.
  metadata = null,
  // Internal seam (tests only pass a stand-in): how the catalog reaches
  // oc-mirror. The default fetches it over verified TLS and serves it on
  // loopback; there is no environment or API switch around it.
  catalogResolver = openVerifiedCatalog
}) => {
  const jobId = createJob(jobType, message || `Scanning ${catalogId} operators...`);
  if (metadata) updateJobMetadata(jobId, { ...metadata, catalogId, catalogImage, catalogMinor: version });

  if (process.env.NODE_ENV !== "test") {
    logger.info({ tag: "operator-scan:start", jobId, catalogId, catalogImage, version, authProvided: !!authFile }, "Operator scan started");
  }

  // The pull secret is used by OAA's own TLS-verified fetch only; the oc-mirror
  // listing runs offline against the loopback copy and never receives it.
  const resolvedAuthFile = authFile || process.env.REGISTRY_AUTH_FILE;
  const bin = ocMirrorPath || "oc-mirror";
  // `authFile` only. `resolvedAuthFile` may be a mounted REGISTRY_AUTH_FILE
  // that belongs to the operator and must survive every scan.
  const releaseCredentials = onSettled || (() => { if (authFile) safeUnlink(authFile); });
  let credentialsReleased = false;
  const releaseOnce = () => { if (!credentialsReleased) { credentialsReleased = true; releaseCredentials(); } };

  // Phase 1: the verified fetch, stoppable like a child process.
  const controller = new AbortController();
  const fetchHandle = { kill: () => controller.abort() };
  activeProcesses.set(jobId, fetchHandle);
  updateJob(jobId, { status: "running", progress: 5, message: `Fetching the ${catalogId} catalog over verified TLS...` });

  catalogResolver(catalogImage, {
    authFile: resolvedAuthFile,
    signal: controller.signal,
    onProgress: ({ done, total }) => {
      if (total > 0) updateJob(jobId, { progress: 5 + Math.round((done / total) * 50), message: `Fetching the ${catalogId} catalog over verified TLS (${Math.round((done / total) * 100)}%)...` });
    }
  }).then((catalog) => {
    releaseOnce();
    const current = getJob(jobId);
    if (activeProcesses.get(jobId) !== fetchHandle || (current && isTerminalJobStatus(current.status))) {
      // Stopped or shut down while fetching: nothing to spawn, nothing left registered.
      if (activeProcesses.get(jobId) === fetchHandle) activeProcesses.delete(jobId);
      catalog.close?.();
      return;
    }
    const identity = { sourceReference: catalogImage, resolvedDigest: catalog.resolvedDigest, manifestDigest: catalog.manifestDigest, verifiedAt: catalog.fetchedAt };
    appendJobOutput(jobId, `Catalog ${catalogImage} verified over TLS: resolves to ${catalog.resolvedDigest}${catalog.manifestDigest !== catalog.resolvedDigest ? ` (platform manifest ${catalog.manifestDigest})` : ""}.\n`);
    listCatalog(catalog, identity);
  }, (err) => {
    releaseOnce();
    if (activeProcesses.get(jobId) === fetchHandle) activeProcesses.delete(jobId);
    const current = getJob(jobId);
    if (current && isTerminalJobStatus(current.status)) return;
    if (err?.code === "ABORTED") return;
    appendJobOutput(jobId, `\n${err?.message || err}\n`);
    // The reason on its own (the message adds the catalog), for the UI to show once.
    updateJobMetadata(jobId, { failure: { code: err?.code || null, reason: String(err?.message || err) } });
    updateJob(jobId, {
      status: "failed",
      progress: 100,
      message: `The ${catalogId} catalog could not be fetched and verified: ${err?.message || err}`
    });
    if (process.env.NODE_ENV !== "test") {
      logger.warn({ tag: "operator-scan:fetch-failed", jobId, catalogId, code: err?.code }, "Verified catalog fetch failed");
    }
  });

  return jobId;

  // Phase 2: oc-mirror lists the verified, digest-pinned loopback copy.
  function listCatalog(catalog, identity) {
  const args = ["--v2", "list", "operators", ...loopbackCatalogArgs(catalog.localReference, catalog.emptyAuthFile)];
  const env = loopbackListEnv(process.env);

  const child = spawn(bin, args, { env });
  // Registered before the job is advertised as running: a job that reports
  // `running` while /api/jobs/:id/stop answers 404 is exactly the state L3
  // exists to remove.
  activeProcesses.set(jobId, child);
  updateJob(jobId, { status: "running", progress: 60, message: `Listing the ${catalogId} catalog...` });

  let output = "";
  let error = "";
  let downloadStarted = false;
  let settled = false;
  let timer = null;

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
    catalog.close?.();
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

      // oc-mirror's own last error line is the reason; the full output is kept.
      // eslint-disable-next-line no-control-regex
      const lastError = (`${error}`.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").match(/\[ERROR\][^\n]*/g) || []).pop()?.replace(/^\[ERROR\]\s*:?\s*/, "").trim() || "";
      const reason = isArchMismatch(error) ? ARCH_GUIDANCE : `oc-mirror could not list the catalog (exit code ${code})${lastError ? `: ${lastError}` : "; see the output"}.`;
      updateJobMetadata(jobId, { failure: { code: "LIST_FAILED", reason } });
      updateJob(jobId, {
        status: "failed",
        progress: 100,
        message: isArchMismatch(error) ? userMessage : `${userMessage.replace(/\.$/, "")}: ${reason}`
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

    storeResults(version, catalogId, parsed, identity);
    updateJobMetadata(jobId, { packages: parsed.length, catalogDigest: identity.resolvedDigest });

    if (process.env.NODE_ENV !== "test") {
      logger.info({ tag: "operator-scan:complete", jobId, catalogId, version, operatorCount: parsed.length }, "Operator scan completed");
    }

    updateJob(jobId, {
      status: "completed",
      progress: 100,
      message: `Completed ${catalogId} scan (catalog ${identity.resolvedDigest.slice(0, 19)}…, verified over TLS).`,
      output
    });
    });
  });
  }
};

export { getCatalogs, getResults, getCatalogIdentity, runScanJob, authAvailable, createSharedAuthRelease };
