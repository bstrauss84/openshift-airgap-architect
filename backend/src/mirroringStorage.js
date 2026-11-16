/**
 * OpenShift Airgap Architect - where Mirroring stores its content (v2.2.0)
 *
 * Mirroring content (archives, oc-mirror workspace and cache, received
 * transfers, plans) can be hundreds of GiB. Like Install's Run oc-mirror step,
 * a profile can put it in any directory the server can write — typically a
 * volume mounted into the container, e.g. -v /data/mirror:/mnt/mirror-data:Z,
 * then /mnt/mirror-data. OAA_MIRROR_STORAGE_ROOT only sets the default for new
 * profiles; unset, the default is DATA_DIR/oc-mirror, exactly as before.
 *
 * Rules:
 * - A location is an absolute, normalized container path that is a real
 *   directory (not a symlink, not reached through one), not "/", not a system
 *   directory, not the application's own directory and not inside another
 *   profile; the server's own user must be able to list, create and delete
 *   files in it (a real write). A location that fails any check blocks
 *   Mirroring runs with the reason; nothing ever falls back to DATA_DIR.
 * - Each profile is pinned to its location (`storageBase`, server-owned; null =
 *   the DATA_DIR default). It can be chosen only while the profile has written
 *   nothing, so history and cache are never split; nothing is ever moved.
 * - The default is read once at start-up.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** Directories a Mirroring location may never be, or be inside. */
const SYSTEM_DIRS = ["/proc", "/sys", "/dev", "/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64", "/boot", "/run", "/var/run", "/var/lib/containers", "/var/lib/docker"];
// The application's own code (container image /app, or the checkout when run directly).
const APP_DIRS = [...new Set(["/app", path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")])];

export const legacyBase = (dataDir) => path.join(path.resolve(dataDir), "oc-mirror");

const shapeProblem = (raw) => {
  if (typeof raw !== "string" || !raw.trim()) return "is empty";
  if (!path.isAbsolute(raw)) return "must be an absolute path inside the container, for example /mnt/mirror-data";
  if (raw.length > 1024) return "is too long";
  if (/[\0\n\r]/.test(raw)) return "contains control characters";
  const norm = path.resolve(raw);
  if (norm === "/") return "cannot be the filesystem root";
  if (SYSTEM_DIRS.some((d) => norm === d || norm.startsWith(`${d}/`))) return `cannot be under the system directory ${SYSTEM_DIRS.find((d) => norm === d || norm.startsWith(`${d}/`))}`;
  return "";
};

/**
 * The storage configuration of this server process: the default location for
 * new profiles.
 * @returns {{ base: string, source: "env"|"default", legacy: string, configProblem: string }}
 */
export function storageConfig(env, dataDir) {
  const legacy = legacyBase(dataDir);
  const raw = env.OAA_MIRROR_STORAGE_ROOT;
  if (raw === undefined || raw === "") return { base: legacy, source: "default", legacy, configProblem: "" };
  const problem = shapeProblem(raw);
  return { base: problem ? String(raw) : path.resolve(raw), source: "env", legacy, configProblem: problem ? `OAA_MIRROR_STORAGE_ROOT ${problem}.` : "" };
}

/**
 * Whether a location may hold Mirroring content at all (before any live check):
 * shape, system and application directories, and other profiles' directories.
 * @param {string[]} otherProfileRoots canonical <base>/profiles/<id> of other profiles
 */
export function locationProblem(base, { otherProfileRoots = [] } = {}) {
  const shape = shapeProblem(base);
  if (shape) return `The location ${shape}.`;
  const norm = path.resolve(base);
  const app = APP_DIRS.find((d) => norm === d || norm.startsWith(`${d}/`) || d.startsWith(`${norm}/`));
  if (app) return `The location cannot be, contain or be inside the application's own directory (${app}).`;
  const other = otherProfileRoots.find((r) => norm === r || norm.startsWith(`${r}/`));
  if (other) return "The location is inside another profile's storage.";
  return "";
}

/**
 * Live check of one storage root with the server's own identity.
 * `create` makes a missing DATA_DIR default (only) on first use, as before.
 */
export function checkStorageBase(base, { create = false, statfs = fs.statfsSync } = {}) {
  const problems = [];
  const identity = typeof process.getuid === "function" ? { uid: process.getuid(), gid: process.getgid() } : { uid: null, gid: null };
  const result = { base, ok: false, problems, ...identity, freeBytes: null, totalBytes: null };
  const shape = shapeProblem(base);
  if (shape) { problems.push(`The storage root ${shape}.`); return result; }
  if (create && !fs.existsSync(base)) {
    try { fs.mkdirSync(base, { recursive: true, mode: 0o750 }); } catch (err) { problems.push(`The storage root ${base} could not be created: ${err.code || err.message}.`); return result; }
  }
  let st;
  try { st = fs.lstatSync(base); } catch {
    problems.push(`The storage root ${base} does not exist in the container. Mount the volume there (for example -v /data/mirror:${base}:Z) or create it.`);
    return result;
  }
  if (st.isSymbolicLink()) { problems.push(`The storage root ${base} is a symbolic link. Name the real directory instead.`); return result; }
  if (!st.isDirectory()) { problems.push(`The storage root ${base} is not a directory.`); return result; }
  let real;
  try { real = fs.realpathSync(base); } catch (err) { problems.push(`The storage root ${base} cannot be resolved: ${err.code || err.message}.`); return result; }
  if (real !== path.resolve(base)) { problems.push(`The storage root ${base} is reached through a symbolic link (${real}). Name the real directory instead.`); return result; }
  try { fs.accessSync(base, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK); } catch {
    problems.push(`The server's user (uid ${identity.uid}, gid ${identity.gid}) cannot read, write and enter ${base}. Give that user ownership or group write access; with SELinux, mount it with :Z (or :z when shared).`);
    return result;
  }
  // A real write, because access() does not see SELinux or a read-only mount.
  const probe = path.join(base, `.oaa-write-check-${crypto.randomBytes(6).toString("hex")}`);
  try {
    fs.writeFileSync(probe, "ok", { flag: "wx", mode: 0o600 });
    fs.unlinkSync(probe);
  } catch (err) {
    try { fs.unlinkSync(probe); } catch { /* not created */ }
    problems.push(`Writing to ${base} failed (${err.code || err.message}). ${err.code === "EROFS" ? "The volume is mounted read-only." : "Check ownership and, with SELinux, the :Z mount option."}`);
    return result;
  }
  try {
    const s = statfs(base);
    result.freeBytes = Number(s.bavail) * Number(s.bsize);
    result.totalBytes = Number(s.blocks) * Number(s.bsize);
  } catch { /* capacity unknown; not a blocker */ }
  result.ok = true;
  return result;
}

/** Every root content may currently live under: the DATA_DIR default, the configured default, and each profile's own. */
export const knownBases = (cfg, profiles = []) => [...new Set([cfg.legacy, ...(cfg.configProblem ? [] : [cfg.base]),
  ...profiles.map((p) => p?.storageBase).filter((b) => typeof b === "string" && !shapeProblem(b)).map((b) => path.resolve(b))])];

/**
 * Directories mounted into this server (container) that could hold Mirroring
 * content: mount points from /proc/self/mountinfo outside system and
 * application directories. Container paths only; nothing about the host is
 * inferred. Live-checked by the caller.
 */
export function mountedCandidates({ mountinfo = "/proc/self/mountinfo" } = {}) {
  let text = "";
  try { text = fs.readFileSync(mountinfo, "utf8"); } catch { return []; }
  // Pseudo filesystems (kernel interfaces, not storage) are never suggested.
  const PSEUDO = new Set(["proc", "sysfs", "cgroup", "cgroup2", "devpts", "devtmpfs", "mqueue", "debugfs", "tracefs", "securityfs", "pstore", "bpf", "autofs", "binfmt_misc", "configfs", "fusectl", "hugetlbfs", "nsfs", "rpc_pipefs", "efivarfs", "selinuxfs", "ramfs", "overlay", "shm"]);
  const points = text.split("\n").map((l) => {
    const f = l.split(" ");
    const sep = f.indexOf("-");
    return sep > 0 && !PSEUDO.has(f[sep + 1]) ? f[4] : null;
  }).filter(Boolean)
    .map((p) => p.replace(/\\040/g, " "))
    .filter((p) => p !== "/" && !locationProblem(p) && !/^\/(tmp|var\/tmp|home|root|var|opt|srv\/?$)$/.test(p));
  return [...new Set(points)].slice(0, 20);
}

/**
 * Whether a profile's content root may still be chosen: nothing has been
 * written for it (no runs, transfers, receipts or imports, and its directory is
 * absent or empty). Returns "" or the reason it is fixed.
 */
export function storageChoiceLocked(profile, profileRoot) {
  if (profile.history?.length) return "This profile has runs; its archives, history and cache stay where they are.";
  if (profile.transfers?.length || profile.received?.length) return "This profile has transfers that live in its current storage.";
  if (profile.imports?.length) return "This profile's imported files are stored in its current storage.";
  try {
    if (fs.existsSync(profileRoot) && fs.readdirSync(profileRoot).length) return "This profile already has files in its current storage.";
  } catch { return "This profile's current storage cannot be read."; }
  return "";
}

/**
 * Where one profile's content lives. A pin that is not even a well-formed
 * location is refused here; everything else is checked live when used.
 * @returns {{ base: string, pinned: string|null, accepted: boolean, reason: string }}
 */
export function profileStorage(profile, cfg) {
  const pinned = typeof profile?.storageBase === "string" && profile.storageBase ? profile.storageBase : null;
  if (!pinned) return { base: cfg.legacy, pinned: null, accepted: true, reason: "" };
  const shape = shapeProblem(pinned);
  if (!shape) return { base: path.resolve(pinned), pinned, accepted: true, reason: "" };
  return { base: pinned, pinned, accepted: false, reason: `This profile's storage location (${String(pinned).slice(0, 200)}) ${shape}; nothing was moved.` };
}

/**
 * The pin a NEW profile gets: null for the DATA_DIR default (follows DATA_DIR),
 * else the configured root — even an invalid one, so that profile is blocked
 * with the reason instead of quietly using DATA_DIR (No Fallback).
 */
export const newProfileStorageBase = (cfg) => (cfg.source === "env" ? cfg.base : null);

/** True when `dir` (canonical) is inside `base` (canonical). */
export const isInside = (dir, base) => dir === base || dir.startsWith(`${base}${path.sep}`);
