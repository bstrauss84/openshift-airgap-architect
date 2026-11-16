/**
 * OpenShift Airgap Architect - keep mirror-to-disk archives safe (v2.2.0)
 *
 * oc-mirror's mirror to disk deletes every mirror_*.tar at the top level of its
 * destination when it starts — also for a dry run and for a run that then fails
 * (verified on 4.22.19; archive.go). It never looks into subdirectories, and the
 * workspace's incremental history stays at <dest>/working-dir.
 *
 * So OAA never leaves an archive at the top level:
 * - after a successful mirror to disk its archives are renamed (same
 *   filesystem, nothing copied) into <dest>/sets/<planId>/;
 * - before every mirror to disk, whatever is still at the top level is moved
 *   aside first: into its run's set when it is known, otherwise into
 *   <dest>/preserved/<time>/. Nothing is deleted.
 * Transfers are prepared from the run's own set, so a later run can never
 * replace or destroy them.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import fs from "node:fs";
import path from "node:path";

export const ARCHIVE_RE = /^mirror_\d{6}\.tar$/;
const SET_DIR = "sets";
const PRESERVED_DIR = "preserved";
const PLAN_ID_RE = /^plan-\d{8}T\d{6}Z-[A-Za-z0-9_-]{6}$/;

/** Top-level archive files (and the transfer files written beside them). */
export function topLevelArchives(destDir) {
  let names = [];
  try { names = fs.readdirSync(destDir); } catch { return { archives: [], transferFiles: [] }; }
  const archives = names.filter((n) => ARCHIVE_RE.test(n) && fs.lstatSync(path.join(destDir, n)).isFile()).sort();
  const transferFiles = names.filter((n) => n === "SHA256SUMS" || n === "oaa-transfer");
  return { archives, transferFiles };
}

export const setDir = (destDir, planId) => {
  if (!PLAN_ID_RE.test(planId || "")) throw new Error("Invalid plan id.");
  return path.join(destDir, SET_DIR, planId);
};

/**
 * Move the top-level archives (and SHA256SUMS / oaa-transfer/) into `target`,
 * which must not exist yet or be empty. Same filesystem: rename only.
 * @returns {{ dir: string, files: { file: string, bytes: number }[] }|null}
 */
function moveInto(destDir, target) {
  const { archives, transferFiles } = topLevelArchives(destDir);
  if (!archives.length) return null;
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(`${target} already holds files; nothing was moved.`);
  fs.mkdirSync(target, { recursive: true, mode: 0o750 });
  const files = [];
  for (const name of [...archives, ...transferFiles]) {
    const from = path.join(destDir, name);
    const to = path.join(target, name);
    if (ARCHIVE_RE.test(name)) files.push({ file: name, bytes: fs.lstatSync(from).size });
    fs.renameSync(from, to);
  }
  return { dir: target, files };
}

/** After a successful mirror to disk: its archives into <dest>/sets/<planId>/. */
export function keepRunArchives(destDir, planId) {
  return moveInto(destDir, setDir(destDir, planId));
}

/**
 * Before any mirror to disk: nothing may remain where oc-mirror deletes.
 * `owner` names the run the files belong to when that is known (the latest
 * successful real mirror to disk without a set), otherwise they are preserved
 * under a timestamped folder.
 * @returns {{ dir: string, files: object[], planId: string|null }|null}
 */
export function protectBeforeRun(destDir, { ownerPlanId = null, now = new Date() } = {}) {
  const { archives } = topLevelArchives(destDir);
  if (!archives.length) return null;
  if (ownerPlanId) {
    const target = setDir(destDir, ownerPlanId);
    if (!fs.existsSync(target) || !fs.readdirSync(target).length) return { ...moveInto(destDir, target), planId: ownerPlanId };
  }
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return { ...moveInto(destDir, path.join(destDir, PRESERVED_DIR, stamp)), planId: null };
}
