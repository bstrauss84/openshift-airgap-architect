/** Operator catalog scan via oc-mirror list operators; results stored in DB, not credentials. */
import { spawn } from "node:child_process";
import { db } from "./db.js";
import { createJob, updateJob, safeUnlink } from "./utils.js";

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

const runScanJob = ({ version, catalogId, catalogImage, authFile, jobType = "operator-scan", message }) => {
  const jobId = createJob(jobType, message || `Scanning ${catalogId} operators...`);
  updateJob(jobId, { status: "running", progress: 5 });

  const args = ["--v1", "list", "operators", `--catalog=${catalogImage}`];
  const env = { ...process.env, REGISTRY_AUTH_FILE: authFile || process.env.REGISTRY_AUTH_FILE };

  const child = spawn("oc-mirror", args, { env });
  let output = "";
  let error = "";

  child.stdout.on("data", (data) => {
    output += data.toString();
  });
  child.stderr.on("data", (data) => {
    error += data.toString();
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
    "Operators scan requires a linux/amd64 backend container. On Apple Silicon, set `platform: linux/amd64` for the backend in docker-compose.yml and rebuild (see README).";

  child.on("close", (code) => {
    if (authFile) safeUnlink(authFile);
    if (code !== 0) {
      const userMessage = isArchMismatch(error)
        ? ARCH_GUIDANCE
        : `oc-mirror failed (${catalogId}).`;
      updateJob(jobId, {
        status: "failed",
        progress: 100,
        message: userMessage,
        output: error || output
      });
      return;
    }
    const parsed = parseOperatorTable(output, catalogId);
    storeResults(version, catalogId, parsed);
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
