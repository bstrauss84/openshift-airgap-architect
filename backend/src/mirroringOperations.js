/**
 * OpenShift Airgap Architect - Mirroring operations (v2.2.0)
 *
 * A read-only view over the existing job engine for everything the Mirroring
 * workflow ran: oc-mirror runs (and their automatic signature retries),
 * transfer preparations, receipts, live catalog checks and operator catalog
 * scans (catalog discovery; one job per catalog, not an oc-mirror mirroring run). Nothing here starts,
 * stops or changes work; Stop stays POST /api/jobs/:id/stop.
 *
 * - operationOf(): one job as the Mirroring view describes it — what ran,
 *   from where to where, the command with credentials removed, the oc-mirror
 *   binary, the plan and configuration identity, the outcome.
 * - linkOperations(): connects a mirror to disk with the transfer prepared
 *   from it, a receipt with the run it came from (when this server has it), and
 *   a disk to mirror with the receipt that staged its transfer.
 * - sanitizedLog(): the stored output (already redacted when it was stored)
 *   with colour codes removed, temporary credential paths hidden and a header
 *   naming the run, for download.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

const KIND_BY_TYPE = {
  "oc-mirror-run": "run",
  "mirroring-transfer": "transfer",
  "mirroring-receive": "receive",
  "operator-verify": "catalog-check",
  "operator-scan": "catalog-scan"
};

const CATALOG_LABEL = { redhat: "Red Hat", certified: "Certified", community: "Community" };

const MODE_LABEL = { mirrorToDisk: "Mirror to disk", mirrorToMirror: "Mirror to mirror", diskToMirror: "Disk to mirror" };

export const TEMP_CREDENTIALS = "<temporary credentials file, deleted after the run>";
// writeTempAuth() names: <DATA_DIR>/tmp/registry-auth-<id>.json
const AUTHFILE_PATH_RE = /\S*registry-auth-[A-Za-z0-9_-]+\.json/g;

/** The command as run, with the credentials file path hidden. */
export function redactCommand(fullCommand) {
  if (typeof fullCommand !== "string" || !fullCommand) return null;
  return fullCommand
    .replace(/(--authfile[ =])\S+/g, `$1${TEMP_CREDENTIALS}`)
    .replace(AUTHFILE_PATH_RE, TEMP_CREDENTIALS);
}

const parseMeta = (job) => {
  try {
    const m = typeof job.metadata_json === "string" ? JSON.parse(job.metadata_json || "{}") : job.metadata_json || {};
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
};

/** One line describing a plan's content (the same wording as a received record). */
export function contentSummaryOf(content) {
  if (!content) return null;
  return [
    content.platform && `OpenShift ${content.platform.release}`,
    content.operators && `operators from the ${content.operators.catalogMinor} catalogs`,
    Array.isArray(content.additionalImages) && `${content.additionalImages.length} additional image(s)`
  ].filter(Boolean).join(", ") || null;
}

/**
 * @param {object} job a jobs row (output not needed)
 * @param {Record<string, object>} profiles the Mirroring slice's profiles by id
 */
export function operationOf(job, profiles = {}) {
  const meta = parseMeta(job);
  const kind = KIND_BY_TYPE[job.type] || "other";
  const profileId = meta.profileId || null;
  const profile = profileId ? profiles[profileId] : null;
  const plan = meta.plan || null;
  const received = plan?.kind === "received" && profile ? (profile.received || []).find((r) => r.planId === plan.planId) : null;
  const op = {
    jobId: job.id,
    kind,
    status: job.status,
    message: job.message || "",
    progress: job.progress ?? null,
    createdAt: job.created_at || null,
    updatedAt: job.updated_at || null,
    profileId,
    profileName: profile?.name || meta.profileName || null,
    profileExists: Boolean(profile)
  };
  if (kind === "run") {
    const mode = meta.mode || null;
    Object.assign(op, {
      mode,
      title: `${meta.retryOf ? "Automatic signature retry — " : ""}${MODE_LABEL[mode] || "oc-mirror run"}${meta.dryRun ? " (dry run)" : ""}`,
      dryRun: Boolean(meta.dryRun),
      startedAt: meta.startedAt || null,
      finishedAt: meta.finishedAt || null,
      exitCode: meta.exitCode ?? null,
      source: mode === "diskToMirror"
        ? `Received transfer ${plan?.planId || ""}`.trim()
        : "Source registries named in the plan's configuration",
      destination: mode === "mirrorToDisk" ? (meta.archiveDir || null) : (meta.registryUrl ? `docker://${meta.registryUrl.replace(/^docker:\/\//, "")}` : null),
      workspaceDir: meta.workspaceDir || null,
      cacheDir: meta.cacheDir || null,
      archiveDir: meta.archiveDir || null,
      command: redactCommand(meta.fullCommand),
      tool: meta.tool
        ? { version: meta.tool.version || null, gitCommit: meta.tool.gitCommit || null, sha256: meta.tool.sha256 || null, source: meta.tool.source || null, arch: meta.tool.arch || null }
        : plan?.toolVersion || plan?.toolSha256 ? { version: plan.toolVersion || null, sha256: plan.toolSha256 || null } : null,
      plan: plan ? {
        planId: plan.planId || null,
        planSha256: plan.planSha256 || null,
        configSha256: plan.configSha256 || null,
        kind: plan.kind === "received" ? "received" : "generated",
        networkConfined: plan.kind === "received" ? Boolean(plan.networkConfined) : null,
        originProfileId: plan.originProfileId || null,
        originJobId: plan.originJobId || null
      } : null,
      contentSummary: received?.summary || null,
      releaseResult: meta.releaseResult || null,
      operatorResult: meta.operatorResult || null,
      failedImages: Array.isArray(meta.failedImages) ? meta.failedImages : [],
      signatureFailures: Array.isArray(meta.signatureFailures) ? meta.signatureFailures.length : 0,
      retryOf: meta.retryOf || null,
      retriedAs: meta.retriedAs || null,
      recoveryOf: meta.recoveryOf || null,
      verificationState: meta.verification?.state || null,
      dryRunMappingPath: meta.dryRunMappingPath || null,
      dryRunMissingPath: meta.dryRunMissingPath || null
    });
  } else if (kind === "transfer") {
    Object.assign(op, {
      title: "Prepare transfer",
      sourceJobId: meta.sourceJobId || null,
      plan: meta.planId ? { planId: meta.planId } : null,
      transferDir: meta.transferDir || null,
      manifestSha256: meta.manifestSha256 || null,
      archives: meta.archives ?? null,
      bytes: meta.bytes ?? null,
      offlineReady: typeof meta.offlineReady === "boolean" ? meta.offlineReady : null,
      unpinnedCatalogs: Array.isArray(meta.unpinnedCatalogs) ? meta.unpinnedCatalogs : []
    });
  } else if (kind === "receive") {
    Object.assign(op, {
      title: "Receive transfer",
      transferDir: meta.transferDir || null,
      plan: meta.planId ? { planId: meta.planId, originProfileId: meta.originProfileId || null } : null,
      manifestSha256: meta.manifestSha256 || null,
      archives: meta.archives ?? null,
      offlineReady: typeof meta.offlineReady === "boolean" ? meta.offlineReady : null,
      problems: Array.isArray(meta.problems) ? meta.problems : [],
      recovery: Array.isArray(meta.recovery) ? meta.recovery : []
    });
  } else if (kind === "catalog-check") {
    Object.assign(op, { title: "Live catalog check", catalogMinor: meta.catalogMinor || null });
  } else if (kind === "catalog-scan") {
    const label = CATALOG_LABEL[meta.catalogId] || meta.catalogId || "operator";
    Object.assign(op, {
      title: `Catalog scan — ${label} catalog${meta.catalogMinor ? ` (OpenShift ${meta.catalogMinor})` : ""}`,
      catalogId: meta.catalogId || null,
      catalogMinor: meta.catalogMinor || null,
      source: meta.catalogImage || null,
      scanId: meta.scanId || null,
      packages: Number.isInteger(meta.packages) ? meta.packages : null,
      catalogDigest: meta.catalogDigest || null,
      failureReason: meta.failure?.reason || null
    });
  }
  return op;
}

/**
 * Adds `links` to each operation: { label, jobId } pairs pointing at related
 * operations in the same list. Only facts recorded by the jobs are used.
 */
export function linkOperations(ops) {
  const byId = new Map(ops.map((o) => [o.jobId, o]));
  const add = (o, label, jobId) => {
    if (!jobId || !byId.has(jobId) || jobId === o.jobId) return;
    o.links = o.links || [];
    if (!o.links.some((l) => l.jobId === jobId)) o.links.push({ label, jobId, at: byId.get(jobId).startedAt || byId.get(jobId).createdAt || null });
  };
  for (const o of ops) o.links = [];
  for (const o of ops) {
    if (o.kind === "transfer") {
      add(o, "Mirror to disk it was prepared from", o.sourceJobId);
      add(byId.get(o.sourceJobId) || {}, "Transfer prepared from this run", o.jobId);
    }
    if (o.kind === "run" && o.retryOf) { add(o, "Run it retried", o.retryOf); add(byId.get(o.retryOf) || {}, "Automatic retry", o.jobId); }
    if (o.kind === "run" && o.recoveryOf) { add(o, "Original run", o.recoveryOf); add(byId.get(o.recoveryOf) || {}, "Run again (attempt)", o.jobId); }
    if (o.kind === "catalog-scan" && o.scanId) {
      for (const r of ops) if (r.kind === "catalog-scan" && r.scanId === o.scanId) add(o, `Same scan: ${r.title.replace(/^Catalog scan — /, "").replace(/ \(OpenShift [^)]*\)$/, "")}`, r.jobId);
    }
    if (o.kind === "receive" && o.plan?.planId) {
      for (const r of ops) {
        if (r.kind === "run" && r.mode === "mirrorToDisk" && r.plan?.planId === o.plan.planId) { add(o, "Mirror to disk it came from", r.jobId); add(r, "Received on this server", o.jobId); }
        if (r.kind === "transfer" && r.plan?.planId === o.plan.planId) add(o, "Transfer preparation", r.jobId);
        if (r.kind === "run" && r.mode === "diskToMirror" && r.plan?.planId === o.plan.planId && r.profileId === o.profileId) { add(r, "Receipt that staged this transfer", o.jobId); add(o, "Disk to mirror from this transfer", r.jobId); }
      }
    }
  }
  return ops;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** Downloadable log: header + stored output, colour codes and credential paths removed. */
export function sanitizedLog(job, op, redact = (t) => t) {
  const lines = [
    "# OpenShift Airgap Architect — Mirroring operation log",
    `# Operation: ${op.title || op.kind} (job ${op.jobId})`,
    `# Status: ${op.status}${op.exitCode != null ? ` (oc-mirror exit code ${op.exitCode})` : ""}`,
    op.profileName ? `# Profile: ${op.profileName} (${op.profileId})` : null,
    op.createdAt ? `# Created: ${new Date(Number(op.createdAt)).toISOString()}` : null,
    op.startedAt ? `# Started: ${new Date(op.startedAt).toISOString()}` : null,
    op.finishedAt ? `# Finished: ${new Date(op.finishedAt).toISOString()}` : null,
    op.source ? `# Source: ${op.source}` : null,
    op.destination ? `# Destination: ${op.destination}` : null,
    op.plan?.planId ? `# Plan: ${op.plan.planId}${op.plan.configSha256 ? ` · configuration SHA-256 ${op.plan.configSha256}` : ""}` : null,
    op.tool ? `# oc-mirror: ${op.tool.version || "unknown"}${op.tool.sha256 ? ` · SHA-256 ${op.tool.sha256}` : ""}` : null,
    op.command ? `# Command: ${op.command}` : null,
    op.message ? `# Message: ${op.message}` : null,
    "# Credentials are never written to this log; pull-secret values and temporary credential paths are removed.",
    "# The server keeps the last 500 KB of output per job.",
    ""
  ].filter((l) => l !== null);
  const body = redact(String(job.output || "")).replace(ANSI_RE, "").replace(/\r(?!\n)/g, "\n").replace(AUTHFILE_PATH_RE, TEMP_CREDENTIALS);
  return `${lines.join("\n")}\n${body}${body.endsWith("\n") ? "" : "\n"}`;
}

// oc-mirror v2 exit status is a bit field (cli/executor.go at the shipped
// commit): 1 generic error, 2 release, 4 operators, 8 additional images, 16 helm.
const EXIT_BITS = [[2, "OpenShift release images"], [4, "operator images"], [8, "additional images"], [16, "Helm charts"]];

/**
 * What a run's exit status says, in words. Exit 0 is oc-mirror's own report;
 * Architect does not independently re-check the destination.
 * @returns {{ state: "running"|"complete"|"incomplete"|"failed"|"stopped"|"unknown", text: string, parts: string[] }}
 */
export function runOutcome(op) {
  if (op.status === "queued" || op.status === "running") return { state: "running", text: "Still running.", parts: [] };
  if (op.status === "cancelled") return { state: "stopped", text: "Stopped before it finished: the result is incomplete. Running the same workflow again continues from what was already copied (oc-mirror skips what it has).", parts: [] };
  const code = op.exitCode;
  if (code === 0 && op.status === "completed") return { state: "complete", text: "oc-mirror reported that everything in the configuration was mirrored (exit code 0). Architect does not re-check the destination independently.", parts: [] };
  if (!Number.isInteger(code)) return { state: "unknown", text: "No exit code was recorded, so whether the run is complete is not known.", parts: [] };
  const parts = EXIT_BITS.filter(([bit]) => code & bit).map(([, label]) => label);
  if (parts.length) return { state: "incomplete", text: `Incomplete: oc-mirror reported failures in ${parts.join(", ")} (exit code ${code}). What did copy is kept; running the same workflow again retries the rest.`, parts };
  return { state: "failed", text: `oc-mirror stopped with an error (exit code ${code}); see the end of the output.`, parts: [] };
}

/**
 * oc-mirror's own per-image error file for this run, if it wrote one:
 * <dir>/working-dir/logs/mirroring_errors_*.txt, modified while the run was
 * active. Bounded and returned as plain lines; never parsed into guesses.
 */
/**
 * The error lists already in the run's directories before it started
 * ({ file, mtimeMs }), so a later read never attributes an earlier attempt's
 * list to this run — a retry can start within a second of the attempt it
 * repeats finishing, inside readRunErrorFile's mtime tolerance.
 */
export function snapshotErrorFiles(dirs, { fsImpl } = {}) {
  const out = [];
  for (const dir of dirs.filter(Boolean)) {
    const logs = `${dir}/working-dir/logs`;
    let names = [];
    try { names = fsImpl.readdirSync(logs).filter((n) => /^mirroring_errors_[\w.:-]+\.txt$/.test(n)); } catch { continue; }
    for (const n of names) {
      try { out.push({ file: `${logs}/${n}`, mtimeMs: fsImpl.lstatSync(`${logs}/${n}`).mtimeMs }); } catch { /* gone */ }
    }
  }
  return out;
}

export function readRunErrorFile(dirs, startedAt, finishedAt, { fsImpl, before = [] } = {}) {
  const f = fsImpl;
  const preexisting = new Map((Array.isArray(before) ? before : []).map((b) => [b.file, b.mtimeMs]));
  const candidates = [];
  for (const dir of dirs.filter(Boolean)) {
    const logs = `${dir}/working-dir/logs`;
    let names = [];
    try { names = f.readdirSync(logs).filter((n) => /^mirroring_errors_[\w.:-]+\.txt$/.test(n)); } catch { continue; }
    for (const n of names) {
      try {
        const st = f.lstatSync(`${logs}/${n}`);
        if (!st.isFile()) continue;
        const t = st.mtimeMs;
        // Present before this run and not written since: an earlier attempt's list.
        if (preexisting.has(`${logs}/${n}`) && preexisting.get(`${logs}/${n}`) === t) continue;
        if (startedAt && t < startedAt - 1000) continue;
        if (finishedAt && t > finishedAt + 60000) continue;
        candidates.push({ file: `${logs}/${n}`, t, size: st.size });
      } catch { /* gone */ }
    }
  }
  if (!candidates.length) return null;
  const newest = candidates.sort((a, b) => b.t - a.t)[0];
  const fd = f.openSync(newest.file, "r");
  try {
    const buf = Buffer.alloc(Math.min(newest.size, 64 * 1024));
    f.readSync(fd, buf, 0, buf.length, 0);
    const lines = buf.toString("utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return { file: newest.file, lines: lines.slice(0, 200), truncated: lines.length > 200 || newest.size > buf.length };
  } finally {
    f.closeSync(fd);
  }
}
