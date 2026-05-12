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
import { db } from "./db.js";
import { appendJobOutput, createJob, updateJob, safeUnlink } from "./utils.js";

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
    return !!file && !!require("node:fs").existsSync(file);
  } catch {
    return false;
  }
};

const runScanJob = ({ version, catalogId, catalogImage, authFile, jobType = "operator-scan", message, ocMirrorPath }) => {
  const jobId = createJob(jobType, message || `Scanning ${catalogId} operators...`);

  if (process.env.NODE_ENV !== "test") {
    console.log("[operator-scan:start]", {
      jobId,
      catalogId,
      catalogImage,
      version,
      authProvided: !!authFile
    });
  }

  updateJob(jobId, { status: "running", progress: 5 });

  const args = ["--v1", "list", "operators", `--catalog=${catalogImage}`];
  const env = { ...process.env, REGISTRY_AUTH_FILE: authFile || process.env.REGISTRY_AUTH_FILE };
  const bin = ocMirrorPath || "oc-mirror";

  const child = spawn(bin, args, { env });
  let output = "";
  let error = "";
  let downloadStarted = false;

  child.stdout.on("data", (data) => {
    const s = data.toString();
    output += s;
    appendJobOutput(jobId, s);

    // Detect catalog download/processing events
    if (!downloadStarted && (s.includes("Pulling") || s.includes("Downloading") || s.includes("copying"))) {
      downloadStarted = true;
      if (process.env.NODE_ENV !== "test") {
        console.log("[operator-scan:download]", { jobId, catalogId, event: "catalog_download_started" });
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
    updateJob(jobId, {
      status: "failed",
      progress: 100,
      message: `oc-mirror failed to start (${catalogId}).`,
      output: err?.message || "oc-mirror spawn error"
    });
  });

  const ARCH_MISMATCH_SIGNATURES = ["ld-linux-x86-64.so.2", "qemu-x86_64-static"];
  const isArchMismatch = (stderr) =>
    typeof stderr === "string" && ARCH_MISMATCH_SIGNATURES.some((sig) => stderr.includes(sig));
  const ARCH_GUIDANCE =
    "The oc-mirror binary is not compatible with this container's CPU architecture. " +
    "Rebuild the container so it bakes in the correct native binary, or set OC_MIRROR_BIN " +
    "to a compatible binary path, or set OC_MIRROR_URL to a download URL (see README).";

  child.on("close", (code) => {
    if (authFile) safeUnlink(authFile);
    if (code !== 0) {
      const userMessage = isArchMismatch(error)
        ? ARCH_GUIDANCE
        : `oc-mirror failed (${catalogId}).`;

      if (process.env.NODE_ENV !== "test") {
        console.log("[operator-scan:failed]", {
          jobId,
          catalogId,
          exitCode: code,
          archMismatch: isArchMismatch(error)
        });
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
      console.log("[operator-scan:parsing]", { jobId, catalogId, event: "parsing_operator_table" });
    }
    updateJob(jobId, { progress: 80, message: `Parsing ${catalogId} operators...` });

    const parsed = parseOperatorTable(output, catalogId);

    if (process.env.NODE_ENV !== "test") {
      console.log("[operator-scan:caching]", {
        jobId,
        catalogId,
        version,
        operatorCount: parsed.length,
        event: "storing_to_cache"
      });
    }
    updateJob(jobId, { progress: 95, message: `Caching ${parsed.length} ${catalogId} operators...` });

    storeResults(version, catalogId, parsed);

    if (process.env.NODE_ENV !== "test") {
      console.log("[operator-scan:complete]", {
        jobId,
        catalogId,
        version,
        operatorCount: parsed.length
      });
    }

    updateJob(jobId, {
      status: "completed",
      progress: 100,
      message: `Completed ${catalogId} scan.`,
      output
    });
  });

  return jobId;
};

export { getCatalogs, getResults, runScanJob, authAvailable };
