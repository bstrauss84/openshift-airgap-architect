/**
 * Workflow isolation (v2.3.0 P0b): which parts of the server-owned state and
 * which jobs belong to which workflow.
 *
 * Architect has three independent workflows — Install, Mirroring and Upgrade.
 * Install's state is the top level of `app_state`; Mirroring and Upgrade each
 * own one slice of it, written only through their own routes. Before v2.3.0
 * every Install boundary (autosave, Start Over, run import, export) kept or
 * stripped the Mirroring slice with its own one-off line, and a reset decided
 * what to cancel by exclusion ("everything that is not Mirroring"). A third
 * workflow would have been silently erased or cancelled. This module is the
 * single list and the single set of rules every boundary uses.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import crypto from "node:crypto";

/** State keys owned by a workflow other than Install. Never written by Install routes. */
export const SERVER_OWNED_SLICES = Object.freeze(["mirroring", "upgrade"]);

/** A copy without any server-owned slice (Install autosave, run import, export). */
export const stripServerOwnedSlices = (obj) => {
  if (!obj || typeof obj !== "object") return obj;
  const out = { ...obj };
  for (const key of SERVER_OWNED_SLICES) delete out[key];
  return out;
};

/**
 * `next` (a replacement Install state) with every server-owned slice taken
 * from `current`, never from `next`: a replacement of the Install workflow
 * cannot carry another workflow's data in, nor drop the data already here.
 */
export const withServerOwnedSlices = (next, current) => {
  const out = stripServerOwnedSlices(next || {});
  for (const key of SERVER_OWNED_SLICES) {
    if (current && current[key] !== undefined) out[key] = current[key];
  }
  return out;
};

/** The workflows a job may belong to. */
export const WORKFLOWS = Object.freeze(["install", "mirroring", "upgrade"]);

/**
 * The workflow a job belongs to, from its metadata — or null when it carries
 * no recognised tag. Upgrade stage jobs run on the Mirroring engine
 * (`workflow: "mirroring"`) and name their owner in `owner.workflow`.
 * Unrecognised jobs are never assumed to be Install's (owner direction: an
 * untagged running job is never safe to cancel merely because it is untagged).
 */
export const workflowOfJobMetadata = (meta) => {
  const owner = meta?.owner?.workflow;
  if (WORKFLOWS.includes(owner)) return owner;
  if (WORKFLOWS.includes(meta?.workflow)) return meta.workflow;
  return null;
};

// Only jobs actually running: a "queued" row that never started (or was left by
// an earlier process) is neither cancelled nor reported.
const RUNNING = new Set(["running"]);

/**
 * What "Start new Install" would do right now. One pure function shared by
 * the preview and the reset itself, so the confirmation the user reads is the
 * behaviour that runs.
 *
 * @param {object} p
 * @param {Array<{id:string,type:string,status:string}>} p.jobs - all known jobs
 * @param {(id:string)=>object} p.metaOf - job metadata reader
 * @param {object} p.state - current server state (for preserved counts)
 * @param {boolean} p.cancelInstallRuns - whether Install oc-mirror runs are to be cancelled
 */
export const planInstallReset = ({ jobs, metaOf, state, cancelInstallRuns }) => {
  const running = (jobs || []).filter((j) => RUNNING.has(j.status));
  const cancel = [];
  const keepInstall = [];
  const unaffected = [];
  const unclassified = [];
  for (const job of running) {
    const meta = metaOf(job.id) || {};
    const workflow = workflowOfJobMetadata(meta);
    const entry = { id: job.id, type: job.type, workflow, ...(meta.archivePath ? { archivePath: meta.archivePath } : {}), ...(meta.workspacePath ? { workspacePath: meta.workspacePath } : {}) };
    if (workflow === null) unclassified.push(entry);
    else if (workflow !== "install") unaffected.push(entry);
    else if (job.type === "oc-mirror-run" && cancelInstallRuns) cancel.push(entry);
    else keepInstall.push(entry);
  }
  const mirroring = state?.mirroring && typeof state.mirroring === "object" ? state.mirroring : null;
  const upgrade = state?.upgrade && typeof state.upgrade === "object" ? state.upgrade : null;
  const profiles = mirroring?.profiles && typeof mirroring.profiles === "object" ? Object.values(mirroring.profiles) : [];
  const plans = Array.isArray(upgrade?.plans) ? upgrade.plans : [];
  const preserved = {
    mirroringProfiles: profiles.filter((p) => !p?.ownedBy).length,
    upgradePlans: plans.length,
    upgradeStageProfiles: profiles.filter((p) => p?.ownedBy?.workflow === "upgrade").length
  };
  const installRunsRunning = running.filter((j) => j.type === "oc-mirror-run" && workflowOfJobMetadata(metaOf(j.id) || {}) === "install").length;
  const scope = {
    cancel: cancel.map((j) => j.id).sort(),
    keepInstall: keepInstall.map((j) => j.id).sort(),
    unaffected: unaffected.map((j) => j.id).sort(),
    unclassified: unclassified.map((j) => j.id).sort()
  };
  const token = crypto.createHash("sha256").update(JSON.stringify({ scope, cancelInstallRuns: Boolean(cancelInstallRuns) })).digest("hex");
  return { cancel, keepInstall, unaffected, unclassified, preserved, installRunsRunning, token };
};
