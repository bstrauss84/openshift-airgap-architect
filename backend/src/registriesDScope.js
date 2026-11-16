/**
 * OpenShift Airgap Architect - signature exemptions scoped to one oc-mirror run (v2.2.0)
 *
 * oc-mirror 4.22.19 ignores CONTAINERS_REGISTRIES_D. It reads registries.d only
 * from `--registries.d` (else ~/.config/containers/registries.d, else
 * /etc/containers/registries.d), copies that into
 * <workspace>/working-dir/containers/registries.d on every run — overwriting
 * files of the same name, never deleting — and reads only that copy (verified
 * on the shipped binary, E12/X3). So an exemption passed with --registries.d
 * would stay in the workspace and silently apply to every later run.
 *
 * This module makes it last exactly one run: snapshot the workspace copy
 * before the run, restore it byte-for-byte afterwards (verified), and keep a
 * ledger so a crash is repaired at start-up. When a restore cannot be
 * verified the snapshot is kept and runs on that workspace are refused until
 * it is resolved (fail closed) — never a lasting, weaker workspace.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SNAP = ".oaa-registries.d-snapshot";
const TAIL = `${path.sep}working-dir${path.sep}containers${path.sep}registries.d`;

/** The registries.d copy oc-mirror reads for this run, or null (disk to mirror is never retried). */
export function workspaceRegistriesDir(mode, archivePath, workspacePath) {
  if (mode === "mirrorToDisk" && archivePath) return path.join(path.resolve(archivePath), "working-dir", "containers", "registries.d");
  if (mode === "mirrorToMirror" && workspacePath) return path.join(path.resolve(workspacePath), "working-dir", "containers", "registries.d");
  return null;
}

const snapOf = (dir) => path.join(path.dirname(dir), SNAP);

function treeHash(dir) {
  if (!fs.existsSync(dir)) return null;
  const h = crypto.createHash("sha256");
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const f = path.join(d, e.name);
      h.update(`${path.relative(dir, f)}\0${e.isDirectory() ? "d" : e.isSymbolicLink() ? `l${fs.readlinkSync(f)}` : "f"}\0`);
      if (e.isDirectory()) walk(f);
      else if (e.isFile()) h.update(fs.readFileSync(f));
    }
  };
  walk(dir);
  return h.digest("hex");
}

const readLedger = (ledger) => {
  try { const v = JSON.parse(fs.readFileSync(ledger, "utf8")); return Array.isArray(v) ? v.filter((d) => typeof d === "string" && d.endsWith(TAIL)) : []; } catch { return []; }
};
const writeLedger = (ledger, list) => {
  const tmp = `${ledger}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify([...new Set(list)]), { mode: 0o600 });
  fs.renameSync(tmp, ledger);
};

export const pendingSnapshot = (dir) => Boolean(dir) && fs.existsSync(snapOf(dir));

/** Record the workspace copy before a run that passes --registries.d. Throws when one is still pending. */
export function snapshotRegistriesD(dir, ledger) {
  if (!dir.endsWith(TAIL)) throw new Error("Not a workspace registries.d directory.");
  const snap = snapOf(dir);
  if (fs.existsSync(snap)) throw new Error(`A signature exemption from an earlier run is still in ${path.dirname(dir)} and could not be removed yet; runs on this workspace wait until it is restored.`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  writeLedger(ledger, [...readLedger(ledger), dir]);
  fs.mkdirSync(snap, { mode: 0o700 });
  const existed = fs.existsSync(dir);
  if (existed) fs.cpSync(dir, path.join(snap, "registries.d"), { recursive: true, verbatimSymlinks: true });
  fs.writeFileSync(path.join(snap, "state.json"), JSON.stringify({ existed, hash: treeHash(dir), at: Date.now() }), { mode: 0o600 });
}

/**
 * Put the workspace copy back exactly as it was. Returns { ok, problem }.
 * Idempotent: with no snapshot there is nothing to do.
 */
export function restoreRegistriesD(dir, ledger) {
  const snap = snapOf(dir);
  if (!fs.existsSync(snap)) {
    writeLedger(ledger, readLedger(ledger).filter((d) => d !== dir));
    return { ok: true, problem: "" };
  }
  try {
    const state = JSON.parse(fs.readFileSync(path.join(snap, "state.json"), "utf8"));
    fs.rmSync(dir, { recursive: true, force: true });
    if (state.existed) fs.cpSync(path.join(snap, "registries.d"), dir, { recursive: true, verbatimSymlinks: true });
    const now = treeHash(dir);
    if (now !== state.hash) return { ok: false, problem: `The workspace's registries.d (${dir}) does not match what it was before the signature retry.` };
    fs.rmSync(snap, { recursive: true, force: true });
    writeLedger(ledger, readLedger(ledger).filter((d) => d !== dir));
    return { ok: true, problem: "" };
  } catch (err) {
    return { ok: false, problem: `The signature exemption in ${dir} could not be removed (${err.code || err.message}).` };
  }
}

/** Start-up: restore every snapshot a crashed run left behind. */
export function restorePending(ledger) {
  return readLedger(ledger).map((dir) => ({ dir, ...restoreRegistriesD(dir, ledger) }));
}

/**
 * Repositories whose sigstore signature lookup failed with Quay's "not found"
 * answer — the one failure the automatic signature retry is for. Read from the
 * repository oc-mirror names in the error ("…sha256-<hex>.sig in <repository>:
 * name unknown: Image not found"), so it works for operator images
 * (docker://…@sha256:…) and additional images (host/repo:tag) alike, as the
 * shipped oc-mirror prints them (OAA_EXACT_BINARY_INTEGRATION S1). Per line;
 * colour codes ignored; nothing else is matched.
 */
export function parseSignatureErrors(output) {
  const found = [];
  // eslint-disable-next-line no-control-regex
  for (const raw of String(output || "").replace(/\x1b\[[0-9;]*m/g, "").split("\n")) {
    const m = /error mirroring image \S+.*?error: reading signatures: reading manifest sha256-[0-9a-f]+\.sig in ([A-Za-z0-9][A-Za-z0-9._\-/:]*[A-Za-z0-9]): name unknown: Image not found/.exec(raw);
    if (m && !found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

