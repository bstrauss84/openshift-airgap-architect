/**
 * OpenShift Airgap Architect - Mirroring execution plans (v2.2.0 M5)
 *
 * Every Mirroring run writes an IMMUTABLE plan before oc-mirror starts:
 *
 *   <DATA_DIR>/oc-mirror/profiles/<id>/plans/<planId>/
 *     imageset-config.yaml   the exact bytes oc-mirror is given (--config)
 *     plan.json              what was run, with what, from what
 *
 * The plan is the low side's record and, from M6, the high side's input:
 * disk-to-mirror will consume this file and never regenerate the
 * configuration from current state (DOC-155 H2). So:
 *
 * - both files are created exclusively (`wx`: never overwritten) and made
 *   read-only (0444); the run uses the plan's own config file, which is never
 *   deleted afterwards;
 * - plan.json binds the config by SHA-256, records the oc-mirror binary that
 *   ran it (version, commit, SHA-256 of the executable, where it came from),
 *   the catalog references and packages exactly as generated, the profile's
 *   imported originals by hash (never copied or changed), the profile's
 *   directories and the non-secret options;
 * - nothing secret is ever written: no pull secret, no auth file path.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { nanoid } from "nanoid";
import { sha256OfFile } from "./verifiedDownload.js";
import { profilePaths, isValidProfileId } from "./mirroringState.js";

export const PLAN_SCHEMA = "oaa.mirroring.plan/v1";
const PLAN_ID_RE = /^plan-\d{8}T\d{6}Z-[A-Za-z0-9_-]{6}$/;

export const isValidPlanId = (id) => typeof id === "string" && PLAN_ID_RE.test(id);

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

export const planDir = (dataDir, profileId, planId) => {
  if (!isValidProfileId(profileId) || !isValidPlanId(planId)) throw new Error("Invalid plan reference.");
  return path.join(profilePaths(dataDir, profileId).root, "plans", planId);
};

const toolCache = new Map();

/**
 * Identity of the oc-mirror executable about to run: SHA-256 of its bytes and
 * the version it reports. Cached per path, size and mtime. A version that
 * cannot be read is recorded as unknown, never guessed.
 */
export async function describeOcMirrorTool(resolved) {
  const stat = fs.statSync(resolved.path);
  const key = `${resolved.path}:${stat.size}:${stat.mtimeMs}`;
  if (!toolCache.has(key)) {
    let version = null;
    let gitCommit = null;
    const probe = spawnSync(resolved.path, ["version", "--output=json"], { encoding: "utf8", timeout: 15000 });
    try {
      const parsed = JSON.parse(probe.stdout || "");
      version = typeof parsed?.clientVersion?.gitVersion === "string" ? parsed.clientVersion.gitVersion : null;
      gitCommit = typeof parsed?.clientVersion?.gitCommit === "string" ? parsed.clientVersion.gitCommit : null;
    } catch {
      version = null;
    }
    toolCache.set(key, {
      name: "oc-mirror",
      version: version || "unknown (the binary did not report a version)",
      gitCommit,
      sha256: await sha256OfFile(resolved.path),
      path: resolved.path,
      source: resolved.source || "unknown",
      ...(resolved.version ? { channelRelease: resolved.version } : {}),
      ...(resolved.url ? { url: resolved.url } : {}),
      ...(resolved.sha256 ? { tarballSha256: resolved.sha256 } : {}),
      ...(resolved.arch ? { arch: resolved.arch } : {})
    });
  }
  return toolCache.get(key);
}

/** Catalogs and packages exactly as the generated ImageSetConfiguration names them. */
export const catalogReferencesOf = (configYaml) => {
  const doc = yaml.load(configYaml) || {};
  const operators = Array.isArray(doc?.mirror?.operators) ? doc.mirror.operators : [];
  return operators.map((op) => ({
    catalog: String(op.catalog || ""),
    packages: (Array.isArray(op.packages) ? op.packages : []).map((pkg) => ({
      name: String(pkg.name || ""),
      channels: (Array.isArray(pkg.channels) ? pkg.channels : []).map((ch) => ({
        name: String(ch.name || ""),
        ...(ch.minVersion ? { minVersion: String(ch.minVersion) } : {}),
        ...(ch.maxVersion ? { maxVersion: String(ch.maxVersion) } : {})
      }))
    }))
  }));
};

const stamp = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

/**
 * Write the plan for one run. Throws (the run must not start) if either file
 * cannot be created exclusively.
 *
 * @returns {{ planId: string, dir: string, configPath: string, planPath: string, record: object }}
 */
export function createExecutionPlan({ dataDir, profile, configYaml, tool, mode, dryRun, options, catalogVerification, jobId, architect, now = new Date(), contentOverride = null, recoveryOf = null }) {
  const planId = `plan-${stamp(now)}-${nanoid(6)}`;
  const dir = planDir(dataDir, profile.id, planId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const paths = profilePaths(dataDir, profile.id);
  const configBytes = Buffer.from(configYaml, "utf8");
  const configPath = path.join(dir, "imageset-config.yaml");
  fs.writeFileSync(configPath, configBytes, { flag: "wx", mode: 0o444 });

  const c = profile.content;
  const plan = {
    schema: PLAN_SCHEMA,
    planId,
    createdAt: now.toISOString(),
    jobId: jobId || null,
    profile: { id: profile.id, name: profile.name },
    workflow: { mode, dryRun: Boolean(dryRun) },
    imagesetConfig: {
      file: "imageset-config.yaml",
      sha256: sha256(configBytes),
      bytes: configBytes.length,
      source: (profile.imports || []).length ? "generated from the profile, which includes imported files" : "generated from the profile"
    },
    importedOriginals: (profile.imports || []).map((imp) => ({ fileName: imp.fileName, sha256: imp.sha256, importedAt: new Date(imp.importedAt).toISOString() })),
    // A recovery attempt records the original plan's content (the profile may have changed since).
    ...(recoveryOf ? { recoveryOf } : {}),
    content: contentOverride || {
      platform: c.platform
        ? { release: profile.platform.release.patchVersion, channel: profile.platform.version.selectedChannel || null, architecture: profile.platform.architecture || null, graph: profile.platform.graph }
        : null,
      operators: c.operators
        ? { catalogMinor: profile.operators.catalogMinor, catalogs: catalogReferencesOf(configYaml), verification: catalogVerification || null }
        : null,
      additionalImages: c.additionalImages ? profile.additionalImages.map((img) => img.name) : null
    },
    tool,
    execution: {
      archiveDir: paths.archivePath,
      workspaceDir: paths.workspacePath,
      cacheDir: paths.cachePath,
      options: options || {}
    },
    architect: architect || {}
  };
  const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, "utf8");
  const planPath = path.join(dir, "plan.json");
  fs.writeFileSync(planPath, planBytes, { flag: "wx", mode: 0o444 });
  return {
    planId,
    dir,
    configPath,
    planPath,
    record: { planId, planSha256: sha256(planBytes), configSha256: plan.imagesetConfig.sha256, toolSha256: tool?.sha256 || null, toolVersion: tool?.version || null }
  };
}

/**
 * Read a plan back and verify it is unchanged: plan.json must hash to the
 * recorded value (when given) and the config must hash to what plan.json says.
 * @returns {{ ok: true, plan: object, configYaml: string } | { ok: false, reason: string }}
 */
export function readExecutionPlan(dataDir, profileId, planId, expectedPlanSha256 = null) {
  let dir;
  try { dir = planDir(dataDir, profileId, planId); } catch { return { ok: false, reason: "invalid" }; }
  let planBytes;
  let configBytes;
  try {
    planBytes = fs.readFileSync(path.join(dir, "plan.json"));
    configBytes = fs.readFileSync(path.join(dir, "imageset-config.yaml"));
  } catch {
    return { ok: false, reason: "missing" };
  }
  if (expectedPlanSha256 && sha256(planBytes) !== expectedPlanSha256) return { ok: false, reason: "plan-changed" };
  let plan;
  try { plan = JSON.parse(planBytes.toString("utf8")); } catch { return { ok: false, reason: "plan-unreadable" }; }
  if (plan.schema !== PLAN_SCHEMA || plan.planId !== planId) return { ok: false, reason: "plan-unreadable" };
  if (sha256(configBytes) !== plan.imagesetConfig?.sha256) return { ok: false, reason: "config-changed" };
  return { ok: true, plan, configYaml: configBytes.toString("utf8") };
}
