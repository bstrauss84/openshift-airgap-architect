/**
 * OpenShift Airgap Architect - low-side → high-side transfer (v2.2.0 M6)
 *
 * The explicit handoff between a mirror-to-disk run (connected, low side) and
 * disk-to-mirror (disconnected, high side):
 *
 *   LOW SIDE  prepareTransfer(): after a successful, non-dry-run mirror to
 *             disk, write into the profile's archive directory
 *               SHA256SUMS                      (sha256sum -c compatible)
 *               oaa-transfer/transfer-manifest.json
 *               oaa-transfer/plan.json          (byte copy of the M5 plan)
 *               oaa-transfer/imageset-config.yaml (byte copy of the run's config)
 *               oaa-transfer/README-TRANSFER.txt
 *             Carry mirror_*.tar, SHA256SUMS and oaa-transfer/ across.
 *
 *   HIGH SIDE verifyTransfer(): read the manifest from a directory the
 *             operator names (contained to the server's allowed roots), then
 *             check every file by size and SHA-256, the plan against its
 *             recorded hash, the configuration against the plan, and every
 *             archive's tar entries. Nothing in the manifest is trusted as a
 *             path: archive names must match mirror_NNNNNN.tar, metadata
 *             names are fixed, and symlinks are refused.
 *             stageTransfer(): copy the verified files into the receiving
 *             profile's own directory (re-hashed while copying) — oc-mirror's
 *             disk-to-mirror writes a working-dir into its --from directory
 *             (verified on 4.22.19: read-only media fail with "mkdir
 *             …/working-dir: permission denied"), so it never runs from the
 *             operator's media.
 *
 * Disk-to-mirror then runs with the staged, verified imageset-config.yaml —
 * never with a configuration regenerated from editable profile state.
 * No credential is ever written into a transfer.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import yaml from "js-yaml";
import { recordedToolIdentity, versionedSourceUrl } from "./ocMirrorIdentity.js";

export const TRANSFER_SCHEMA = "oaa.mirroring.transfer/v1";
export const TRANSFER_DIR = "oaa-transfer";
export const MANIFEST_FILE = "transfer-manifest.json";
export const ARCHIVE_NAME_RE = /^mirror_\d{6}\.tar$/;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_PLAN_BYTES = 1024 * 1024;
const MAX_ARCHIVES = 2000;
const MAX_TAR_ENTRIES = 2_000_000;
const MAX_PINNED_BYTES = 4 * 1024 * 1024;

const sha256Bytes = (b) => crypto.createHash("sha256").update(b).digest("hex");

/** SHA-256 of a file, streamed. */
export const sha256File = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash("sha256");
  fs.createReadStream(file).on("error", reject).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex")));
});

// ---------------------------------------------------------------------------
// Tar inspection: headers are read in place (no extraction), so a multi-GB
// archive costs one small read per entry.
// ---------------------------------------------------------------------------

const cstr = (buf, start, len) => {
  const s = buf.subarray(start, start + len);
  const nul = s.indexOf(0);
  return s.subarray(0, nul < 0 ? s.length : nul).toString("utf8");
};
const octal = (buf, start, len) => {
  const t = cstr(buf, start, len).trim();
  return t ? parseInt(t, 8) : 0;
};

/** A tar entry name that would land outside the extraction directory, or worse. */
export const unsafeEntryName = (name) =>
  !name || name.startsWith("/") || name.split("/").includes("..") || name.includes("\0") || /^[A-Za-z]:/.test(name);

/**
 * List the entries of a ustar/GNU/pax archive and flag anything unsafe.
 * @returns {{ ok: boolean, entries: number, problems: string[], workingDir: boolean, pinned: { name: string, offset: number, size: number }[] }}
 */
export function inspectTar(file) {
  const fd = fs.openSync(file, "r");
  const problems = [];
  const pinned = [];
  let entries = 0;
  let workingDir = false;
  try {
    const size = fs.fstatSync(fd).size;
    const header = Buffer.alloc(512);
    let offset = 0;
    let longName = null;
    let paxPath = null;
    while (offset + 512 <= size) {
      fs.readSync(fd, header, 0, 512, offset);
      if (header.every((b) => b === 0)) break; // end-of-archive block
      const sum = header.reduce((acc, b, i) => acc + (i >= 148 && i < 156 ? 32 : b), 0);
      if (sum !== octal(header, 148, 8)) {
        problems.push(`corrupt tar header at byte ${offset}`);
        break;
      }
      const type = String.fromCharCode(header[156] || 48);
      const bodySize = octal(header, 124, 12);
      const bodyOffset = offset + 512;
      const next = bodyOffset + Math.ceil(bodySize / 512) * 512;
      if (next > size) {
        problems.push(`truncated: an entry ends at byte ${next} but the file has ${size} bytes`);
        break;
      }
      if (type === "L") { // GNU long name for the next entry
        const b = Buffer.alloc(Math.min(bodySize, 65536));
        fs.readSync(fd, b, 0, b.length, bodyOffset);
        longName = cstr(b, 0, b.length);
      } else if (type === "x") { // pax extended header for the next entry
        const b = Buffer.alloc(Math.min(bodySize, 65536));
        fs.readSync(fd, b, 0, b.length, bodyOffset);
        const m = /\d+ path=([^\n]*)\n/.exec(b.toString("utf8"));
        paxPath = m ? m[1] : null;
      } else if (type !== "g") {
        const prefix = cstr(header, 345, 155);
        const raw = paxPath || longName || (prefix ? `${prefix}/${cstr(header, 0, 100)}` : cstr(header, 0, 100));
        const name = raw.replace(/^\.\//, "");
        longName = null;
        paxPath = null;
        entries += 1;
        if (unsafeEntryName(name)) problems.push(`unsafe entry name: ${JSON.stringify(name).slice(0, 200)}`);
        if (!["0", "\0", "5", "2", "1"].includes(type)) problems.push(`unsupported entry type ${JSON.stringify(type)} for ${name.slice(0, 200)}`);
        if ((type === "1" || type === "2") && unsafeEntryName(cstr(header, 157, 100))) problems.push(`link ${name.slice(0, 200)} points outside the archive`);
        if (name === "working-dir" || name.startsWith("working-dir/")) workingDir = true;
        if (/^working-dir\/isc_pinned_[^/]+\.yaml$/.test(name) && type !== "5") pinned.push({ name, offset: bodyOffset, size: bodySize });
        if (entries > MAX_TAR_ENTRIES) {
          problems.push("too many entries");
          break;
        }
      }
      offset = next;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { ok: problems.length === 0, entries, problems, workingDir, pinned };
}

// Blob entries in an oc-mirror archive are content-addressed (verified on 4.22.19):
//   docker/registry/v2/blobs/sha256/<first two hex>/<64 hex>/data
const BLOB_ENTRY_RE = /(?:^|\/)docker\/registry\/v2\/blobs\/sha256\/([0-9a-f]{2})\/([0-9a-f]{64})\/data$/;

/**
 * One streaming pass over an archive: the whole file's SHA-256 and, for every
 * content-addressed blob entry, whether its bytes hash to the digest its name
 * claims. oc-mirror archives a truncated cache blob without complaint (exit 0,
 * verified), and a checksum list made afterwards would "verify" it; this check
 * catches it because the digest comes from the manifests, not from the archive.
 * Manifests are blobs too. Entries that are not content-addressed (working-dir,
 * link files) are not judged here.
 * @returns {Promise<{ sha256: string, blobs: number, corrupt: { digest: string, entry: string, actual: string }[], problems: string[] }>}
 */
export function hashArchive(file, { onBytes } = {}) {
  return new Promise((resolve, reject) => {
    const whole = crypto.createHash("sha256");
    const corrupt = [];
    const problems = [];
    let blobs = 0;
    // Parser state
    let header = Buffer.alloc(0);
    let mode = "header"; // header | body | pad | end
    let remaining = 0;
    let pad = 0;
    let entryName = "";
    let entryType = "0";
    let hasher = null;
    let expected = null;
    let meta = null; // collects GNU long name / pax header bodies
    let longName = null;
    let paxPath = null;
    const finishEntry = () => {
      if (hasher) {
        const actual = hasher.digest("hex");
        blobs += 1;
        if (actual !== expected) corrupt.push({ digest: `sha256:${expected}`, entry: entryName, actual: `sha256:${actual}` });
      } else if (meta) {
        const b = Buffer.concat(meta);
        if (entryType === "L") longName = cstr(b, 0, b.length);
        else if (entryType === "x") { const m = /\d+ path=([^\n]*)\n/.exec(b.toString("utf8")); paxPath = m ? m[1] : null; }
      }
      hasher = null; expected = null; meta = null;
    };
    const startEntry = (h) => {
      const type = String.fromCharCode(h[156] || 48);
      const size = octal(h, 124, 12);
      entryType = type;
      if (type === "L" || type === "x") {
        meta = [];
      } else if (type !== "g") {
        const prefix = cstr(h, 345, 155);
        entryName = (paxPath || longName || (prefix ? `${prefix}/${cstr(h, 0, 100)}` : cstr(h, 0, 100))).replace(/^\.\//, "");
        longName = null; paxPath = null;
        const m = (type === "0" || type === "\0") ? BLOB_ENTRY_RE.exec(entryName) : null;
        if (m && m[2].startsWith(m[1])) { hasher = crypto.createHash("sha256"); expected = m[2]; }
      }
      remaining = size;
      pad = (512 - (size % 512)) % 512;
      mode = size > 0 ? "body" : "pad";
      if (size === 0) finishEntry();
    };
    const feed = (chunk) => {
      let i = 0;
      while (i < chunk.length && mode !== "end") {
        if (mode === "header") {
          const need = 512 - header.length;
          header = Buffer.concat([header, chunk.subarray(i, i + need)]);
          i += Math.min(need, chunk.length - i);
          if (header.length < 512) return;
          const h = header;
          header = Buffer.alloc(0);
          if (h.every((b) => b === 0)) { mode = "end"; return; }
          const sum = h.reduce((acc, b, k) => acc + (k >= 148 && k < 156 ? 32 : b), 0);
          if (sum !== octal(h, 148, 8)) { problems.push("corrupt tar header"); mode = "end"; return; }
          startEntry(h);
        } else if (mode === "body") {
          const n = Math.min(remaining, chunk.length - i);
          const part = chunk.subarray(i, i + n);
          if (hasher) hasher.update(part);
          else if (meta && meta.reduce((a, b) => a + b.length, 0) < 65536) meta.push(Buffer.from(part));
          remaining -= n; i += n;
          if (remaining === 0) { finishEntry(); mode = pad ? "pad" : "header"; }
        } else if (mode === "pad") {
          const n = Math.min(pad, chunk.length - i);
          pad -= n; i += n;
          if (pad === 0) mode = "header";
        }
      }
    };
    fs.createReadStream(file, { highWaterMark: 1 << 20 })
      .on("error", reject)
      .on("data", (d) => { whole.update(d); feed(d); onBytes?.(d.length); })
      .on("end", () => {
        if (mode === "body") problems.push("truncated: the archive ends inside an entry");
        resolve({ sha256: whole.digest("hex"), blobs, corrupt, problems });
      });
  });
}

/** Catalog references as oc-mirror pinned them on the low side (isc_pinned_*.yaml inside the archive). */
export function pinnedCatalogsOf(file, pinnedEntry) {
  if (!pinnedEntry || pinnedEntry.size > MAX_PINNED_BYTES) return null;
  const fd = fs.openSync(file, "r");
  try {
    const b = Buffer.alloc(pinnedEntry.size);
    fs.readSync(fd, b, 0, b.length, pinnedEntry.offset);
    const doc = yaml.load(b.toString("utf8"), { schema: yaml.CORE_SCHEMA }) || {};
    const ops = Array.isArray(doc?.mirror?.operators) ? doc.mirror.operators : [];
    return ops.map((op) => ({ catalog: String(op.catalog || ""), ...(op.targetTag ? { targetTag: String(op.targetTag) } : {}) }));
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Catalogs oc-mirror left as a tag instead of a digest. Pinning is best effort:
 * when it fails, collection resolves the tag again, and a tag that moves
 * meanwhile yields an archive disk to mirror cannot use without reaching the
 * source (DOC-155, reproduced on the exact binary). Not proof of damage; a
 * reason to run mirror to disk again.
 */
export const unpinnedCatalogs = (pinned) => (Array.isArray(pinned) ? pinned.map((c) => c.catalog).filter((c) => c && !/@sha256:[0-9a-f]{64}$/.test(c)) : []);

const DIGEST_TAIL_RE = /@(sha256:[0-9a-f]{64})$/;
/** Repository part of a catalog reference (tag and digest removed). */
const catalogRepository = (ref) => String(ref || "").replace(/@sha256:[0-9a-f]{64}$/, "").replace(/:[\w][\w.-]{0,127}$/, "");

/**
 * DOC-155 (M7): for each catalog in the plan, what is known about its content.
 *  - sourceReference: as the configuration names it (usually a tag);
 *  - pinnedDigest: what oc-mirror pinned in the archive (isc_pinned), or null;
 *  - verifiedDigests: what OAA resolved over verified TLS when the operators
 *    were checked (plan.content.operators.verification), possibly none.
 * status: "matches-verified" | "differs-from-verified" | "not-verified" | "unpinned".
 * A transfer is offline-ready only when every catalog is pinned: an unpinned
 * catalog is the reproduced case where disk to mirror reaches for the source.
 */
export function catalogIdentityReport(plan, pinned) {
  const catalogs = plan?.content?.operators?.catalogs || [];
  // Plans store the checks as an array (createExecutionPlan's catalogVerification).
  const v = plan?.content?.operators?.verification;
  const checks = Array.isArray(v) ? v : (Array.isArray(v?.operators) ? v.operators : []);
  const rows = catalogs.map(({ catalog }) => {
    const repo = catalogRepository(catalog);
    const pinnedRef = (pinned || []).map((p) => p.catalog).find((c) => catalogRepository(c) === repo) || null;
    const pinnedDigest = pinnedRef && DIGEST_TAIL_RE.test(pinnedRef) ? pinnedRef.match(DIGEST_TAIL_RE)[1] : null;
    const verifiedDigests = [...new Set(checks.filter((o) => o.catalogImage === catalog && o.catalogDigest).map((o) => o.catalogDigest))];
    const status = !pinnedDigest ? "unpinned"
      : !verifiedDigests.length ? "not-verified"
      : verifiedDigests.includes(pinnedDigest) ? "matches-verified" : "differs-from-verified";
    return { sourceReference: catalog, pinnedDigest, verifiedDigests, status };
  });
  return { catalogs: rows, offlineReady: rows.every((r) => r.status !== "unpinned") };
}

// ---------------------------------------------------------------------------
// Low side
// ---------------------------------------------------------------------------

/** README section: compare the disconnected side's oc-mirror with the one the connected side ran (Option B). */
const toolCheckSection = (m) => {
  const rec = recordedToolIdentity(m.tool);
  const src = versionedSourceUrl(rec);
  return `
CHECK OC-MIRROR ON THE DISCONNECTED SIDE (optional, offline)
The connected side ran oc-mirror ${rec.version || "(version not recorded)"}${rec.gitCommit ? `, commit ${rec.gitCommit}` : ""}${rec.arch ? `, ${rec.arch}` : ""}.
Its executable SHA-256: ${rec.sha256 || "not recorded"}
On the disconnected machine:
  sha256sum "$(command -v oc-mirror)"     # compare with the SHA-256 above
  oc-mirror version --output=yaml          # orientation only; the SHA-256 decides
Same SHA-256 = the same executable bytes. That says nothing about FIPS or about
whether the build suits this machine: Red Hat says to install the oc-mirror built
for the RHEL version you use (generic or rhel9 build; they are different bytes).
A different SHA-256 is normal when you installed the build for this machine's
RHEL version or CPU architecture.
${src ? `The same release is published in a versioned directory (not "latest"):
  ${src}
Download the build for this machine's RHEL version there and check it with that
directory's sha256sum.txt before use (sha256sum -c --ignore-missing sha256sum.txt).` : `The connected side's oc-mirror came with Architect itself; obtain oc-mirror for
this machine from https://mirror.openshift.com/pub/openshift-v4/<arch>/clients/ocp/<version>/
(a versioned directory, not "latest") and check it with that directory's sha256sum.txt.`}
Receive transfer and the disk to mirror preflight in Architect make this
comparison for you and show the result.
`;
};

const README = (m) => `OpenShift Airgap Architect — mirror-to-disk transfer

Profile:     ${m.origin.profileName} (${m.origin.profileId})
Plan:        ${m.origin.planId}
Run:         ${m.origin.jobId} at ${m.createdAt}
Config:      imageset-config.yaml, SHA-256 ${m.imagesetConfig.sha256}
oc-mirror:   ${m.tool?.version || "unknown"} (SHA-256 ${m.tool?.sha256 || "unknown"})
${m.catalogIdentity?.length ? `
CATALOG IDENTITY (what this transfer contains, per operator catalog)
${m.catalogIdentity.map((c) => `  ${c.sourceReference}
    pinned by oc-mirror: ${c.pinnedDigest || "NOT PINNED (still a tag)"}
    ${{
      "matches-verified": "same content Architect verified over TLS when the operators were checked",
      "differs-from-verified": `DIFFERENT from what was checked (${c.verifiedDigests.join(", ")}): the catalog changed after the check`,
      "not-verified": "not compared: the operators were not checked against this catalog",
      unpinned: "oc-mirror could not pin it; disk to mirror may need the source registry"
    }[c.status]}`).join("\n")}
${m.offlineReady ? "Offline-ready: every catalog is pinned to a digest." : `NOT OFFLINE-READY (prepared anyway at the user's request).
Run mirror to disk again and prepare the transfer again before carrying it.`}
` : ""}
WHAT TO CARRY ACROSS THE AIR GAP
  ${m.archives.map((a) => a.file).join("\n  ")}
  SHA256SUMS
  ${TRANSFER_DIR}/   (this folder)
Keep them together in one directory. The low-side working-dir is not needed:
each archive carries what disk-to-mirror requires.

CHECK THE COPY (any machine with coreutils)
  cd <directory>   &&   sha256sum -c SHA256SUMS
Every line must say OK. A missing or FAILED file means the copy is incomplete
or damaged: copy that file again from the low side; do not edit the manifest.

ON THE DISCONNECTED SIDE
In OpenShift Airgap Architect, Mirroring → Receive transfer, name this
directory. Architect checks every file again, copies them into the receiving
profile, and runs disk to mirror with exactly this imageset-config.yaml.
No credential is included in this transfer: provide the mirror registry's
credentials on the disconnected side.
${toolCheckSection(m)}`;

/**
 * Write the transfer files for one completed mirror-to-disk run.
 * @param {{ archiveDir: string, planDir: string, origin: object, tool: object|null, onProgress?: (done: number, total: number) => void }} args
 * @returns {Promise<object>} the manifest
 */
export async function prepareTransfer({ archiveDir, planDir, origin, tool, onProgress, acknowledgeUnpinned = false, cycle = null }) {
  const archives = fs.readdirSync(archiveDir).filter((f) => ARCHIVE_NAME_RE.test(f)).sort();
  if (!archives.length) throw Object.assign(new Error("The archive directory has no mirror_*.tar files. Run mirror to disk (not a dry run) first."), { code: "NO_ARCHIVES" });
  if (archives.length > MAX_ARCHIVES) throw new Error("Too many archive files.");
  const planBytes = fs.readFileSync(path.join(planDir, "plan.json"));
  const configBytes = fs.readFileSync(path.join(planDir, "imageset-config.yaml"));
  const plan = JSON.parse(planBytes.toString("utf8"));
  if (sha256Bytes(configBytes) !== plan.imagesetConfig?.sha256) throw Object.assign(new Error("The stored plan's configuration no longer matches its SHA-256."), { code: "PLAN_CHANGED" });

  const entries = [];
  let newestPinned = null; // { full, entry } — isc_pinned_<timestamp>.yaml names sort by time
  for (const [i, file] of archives.entries()) {
    const full = path.join(archiveDir, file);
    const st = fs.lstatSync(full);
    if (!st.isFile()) throw new Error(`${file} is not a regular file.`);
    const tar = inspectTar(full);
    if (!tar.ok) throw Object.assign(new Error(`${file}: ${tar.problems.join("; ")}`), { code: "ARCHIVE_INVALID" });
    for (const entry of tar.pinned) if (!newestPinned || entry.name > newestPinned.entry.name) newestPinned = { full, entry };
    const hashed = await hashArchive(full);
    if (hashed.corrupt.length) {
      const list = hashed.corrupt.slice(0, 10).map((c) => c.digest).join(", ");
      throw Object.assign(new Error(`${file} contains ${hashed.corrupt.length} blob(s) whose content does not match their digest (${list}${hashed.corrupt.length > 10 ? ", …" : ""}). The profile's oc-mirror cache holds damaged data, so this archive is not prepared. Nothing was deleted; see "Cache integrity" in the Mirroring documentation.`), { code: "CACHE_CONTENT_CORRUPT", corrupt: hashed.corrupt.slice(0, 200) });
    }
    entries.push({ file, bytes: st.size, sha256: hashed.sha256, entries: tar.entries, containsWorkingDir: tar.workingDir, contentCheck: { method: "sha256 content address", blobs: hashed.blobs } });
    onProgress?.(i + 1, archives.length);
  }
  if (!entries.some((e) => e.containsWorkingDir)) throw Object.assign(new Error("No archive contains oc-mirror's working-dir; disk to mirror would not have what it needs."), { code: "ARCHIVE_INVALID" });
  const pinned = newestPinned ? pinnedCatalogsOf(newestPinned.full, newestPinned.entry) : null;
  const identity = catalogIdentityReport(plan, pinned);
  if (!identity.offlineReady && !acknowledgeUnpinned) {
    const unpinned = identity.catalogs.filter((c) => c.status === "unpinned").map((c) => c.sourceReference);
    throw Object.assign(new Error(`oc-mirror could not pin ${unpinned.join(", ")} to a digest during this run, so the archive may not be usable without the source registry. Run mirror to disk again, or prepare the transfer anyway and accept that it is not offline-ready.`), { code: "CATALOG_NOT_PINNED", unpinned });
  }

  const manifest = {
    schema: TRANSFER_SCHEMA,
    createdAt: new Date().toISOString(),
    origin,
    plan: { file: `${TRANSFER_DIR}/plan.json`, sha256: sha256Bytes(planBytes) },
    imagesetConfig: { file: `${TRANSFER_DIR}/imageset-config.yaml`, sha256: sha256Bytes(configBytes) },
    tool: tool || plan.tool || null,
    // Incremental position of this archive set (see mirroringCycle.js); null when not known.
    cycle: cycle || null,
    content: plan.content || null,
    pinnedCatalogs: pinned,
    unpinnedCatalogs: unpinnedCatalogs(pinned),
    catalogIdentity: identity.catalogs,
    offlineReady: identity.offlineReady,
    ...(identity.offlineReady ? {} : { notOfflineReadyAcknowledged: true }),
    archives: entries,
    credentials: "none — provide destination registry credentials on the disconnected side"
  };
  const tdir = path.join(archiveDir, TRANSFER_DIR);
  // An earlier preparation left these read-only (0444): replace, never write
  // over them (EACCES for a non-root server). The checksum list goes first so
  // an interrupted preparation never leaves old sums beside a new manifest.
  fs.rmSync(path.join(archiveDir, "SHA256SUMS"), { force: true });
  fs.rmSync(tdir, { recursive: true, force: true });
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, "plan.json"), planBytes, { mode: 0o444 });
  fs.writeFileSync(path.join(tdir, "imageset-config.yaml"), configBytes, { mode: 0o444 });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(tdir, MANIFEST_FILE), manifestBytes, { mode: 0o444 });
  fs.writeFileSync(path.join(tdir, "README-TRANSFER.txt"), README(manifest), { mode: 0o444 });
  const sums = [
    ...entries.map((e) => `${e.sha256}  ${e.file}`),
    `${manifest.plan.sha256}  ${manifest.plan.file}`,
    `${manifest.imagesetConfig.sha256}  ${manifest.imagesetConfig.file}`,
    `${sha256Bytes(manifestBytes)}  ${TRANSFER_DIR}/${MANIFEST_FILE}`
  ];
  fs.writeFileSync(path.join(archiveDir, "SHA256SUMS"), `${sums.join("\n")}\n`, { mode: 0o444 });
  return { ...manifest, manifestSha256: sha256Bytes(manifestBytes) };
}

// ---------------------------------------------------------------------------
// High side
// ---------------------------------------------------------------------------

const SHA_RE = /^[a-f0-9]{64}$/;

/** Read a regular, non-symlink file of bounded size inside dir. */
const readContained = (dir, rel, max) => {
  const full = path.join(dir, rel);
  if (path.relative(dir, full).startsWith("..")) throw new Error(`${rel} is outside the transfer directory.`);
  let st;
  try {
    st = fs.lstatSync(full);
  } catch (err) {
    throw new Error(err.code === "ENOENT" ? `${rel} is missing.` : `${rel} cannot be read (${err.code || err.message}).`);
  }
  if (st.isSymbolicLink()) throw new Error(`${rel} is a symbolic link; transfers must contain plain files.`);
  if (!st.isFile()) throw new Error(`${rel} is not a regular file.`);
  if (st.size > max) throw new Error(`${rel} is larger than expected (${st.size} bytes).`);
  return fs.readFileSync(full);
};

/**
 * Check a transfer directory completely. Never throws for a bad transfer:
 * returns { ok, problems[], manifest?, plan?, configSha256?, recovery[] }.
 * `dir` must already be canonical and contained by the caller.
 */
export async function verifyTransfer(dir, { onProgress } = {}) {
  const problems = [];
  const recovery = new Set();
  const fail = (msg, fix) => { problems.push(msg); if (fix) recovery.add(fix); };
  let manifest;
  let manifestBytes;
  try {
    manifestBytes = readContained(dir, path.join(TRANSFER_DIR, MANIFEST_FILE), MAX_MANIFEST_BYTES);
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (err) {
    fail(`No readable transfer manifest (${TRANSFER_DIR}/${MANIFEST_FILE}): ${err.message}`, "Copy the whole oaa-transfer folder from the low side, or prepare the transfer again there.");
    return { ok: false, problems, recovery: [...recovery] };
  }
  const o = manifest?.origin || {};
  if (manifest?.schema !== TRANSFER_SCHEMA) fail(`Unknown transfer format ${JSON.stringify(manifest?.schema)}.`, "Prepare the transfer with a matching OpenShift Airgap Architect version.");
  if (!/^p-[A-Za-z0-9_-]{8,32}$/.test(o.profileId || "") || !/^plan-\d{8}T\d{6}Z-[A-Za-z0-9_-]{6}$/.test(o.planId || "") || !SHA_RE.test(o.planSha256 || "")) fail("The manifest's origin (profile, plan, plan hash) is missing or malformed.");
  if (!Array.isArray(manifest?.archives) || !manifest.archives.length || manifest.archives.length > MAX_ARCHIVES) fail("The manifest lists no archives.");
  if (problems.length) return { ok: false, problems, recovery: [...recovery], manifest };

  // Plan and configuration: fixed names, hashes chained manifest → plan → config.
  let plan;
  let configBytes;
  try {
    const planBytes = readContained(dir, path.join(TRANSFER_DIR, "plan.json"), MAX_PLAN_BYTES);
    if (sha256Bytes(planBytes) !== manifest.plan?.sha256 || manifest.plan.sha256 !== o.planSha256) fail("plan.json does not match the SHA-256 recorded for this run.", "Copy oaa-transfer/plan.json again from the low side.");
    plan = JSON.parse(planBytes.toString("utf8"));
    if (plan.planId !== o.planId || plan.profile?.id !== o.profileId) fail("plan.json belongs to a different plan or profile than the manifest names.");
    configBytes = readContained(dir, path.join(TRANSFER_DIR, "imageset-config.yaml"), MAX_PLAN_BYTES);
    const cs = sha256Bytes(configBytes);
    if (cs !== manifest.imagesetConfig?.sha256 || cs !== plan.imagesetConfig?.sha256) fail("imageset-config.yaml does not match the configuration this archive was made from.", "Copy oaa-transfer/imageset-config.yaml again from the low side; never edit it.");
  } catch (err) {
    fail(err.message, "Copy the whole oaa-transfer folder again from the low side.");
  }

  // Archives: names are constrained, every listed file must be present and
  // identical, and no unlisted archive may sit beside them.
  const listed = new Set();
  for (const a of manifest.archives) {
    if (!ARCHIVE_NAME_RE.test(a?.file || "") || !SHA_RE.test(a?.sha256 || "") || !Number.isSafeInteger(a?.bytes)) {
      fail(`The manifest lists an archive with an unexpected name or hash: ${JSON.stringify(a?.file).slice(0, 80)}.`);
      continue;
    }
    listed.add(a.file);
  }
  let present = [];
  try { present = fs.readdirSync(dir).filter((f) => ARCHIVE_NAME_RE.test(f)); } catch { /* reported below */ }
  for (const extra of present.filter((f) => !listed.has(f))) fail(`${extra} is in the directory but not in this transfer — archives from another run may be mixed in.`, "Use a directory that holds only this transfer's files.");
  let done = 0;
  for (const a of manifest.archives) {
    if (!listed.has(a.file)) continue;
    const full = path.join(dir, a.file);
    let st;
    try { st = fs.lstatSync(full); } catch {
      fail(`${a.file} is missing.`, "Copy the missing archive file(s) again from the low side, then verify again.");
      continue;
    }
    if (st.isSymbolicLink() || !st.isFile()) { fail(`${a.file} is not a plain file.`); continue; }
    if (st.size !== a.bytes) {
      fail(`${a.file} is ${st.size} bytes; ${a.bytes} expected (${st.size < a.bytes ? "incomplete copy" : "different file"}).`, "Copy the archive file(s) again from the low side; an interrupted copy leaves a shorter file.");
      continue;
    }
    const hashed = await hashArchive(full);
    if (hashed.sha256 !== a.sha256) { fail(`${a.file} does not match its recorded SHA-256 (damaged or altered).`, "Copy the archive file(s) again from the low side."); continue; }
    if (hashed.corrupt.length) { fail(`${a.file} contains ${hashed.corrupt.length} blob(s) whose content does not match their digest (for example ${hashed.corrupt[0].digest}); the low side archived damaged cache data.`, "Ask the connected side to repair its cache and prepare a new transfer."); continue; }
    const tar = inspectTar(full);
    if (!tar.ok) fail(`${a.file}: ${tar.problems.slice(0, 3).join("; ")}`);
    done += 1;
    onProgress?.(done, manifest.archives.length);
  }
  return {
    ok: problems.length === 0,
    problems,
    recovery: [...recovery],
    manifest,
    manifestSha256: sha256Bytes(manifestBytes),
    plan,
    configSha256: configBytes ? sha256Bytes(configBytes) : null
  };
}

/**
 * A folder that is, or is inside, a copy Architect already received. Staging
 * replaces its destination first, so receiving such a folder into its own plan
 * would delete the verified copy; it is refused before anything is read.
 * `dir` and `profilesRoot` must be canonical.
 */
export function insideReceivedCopy(dir, profilesRoot) {
  const rel = path.relative(profilesRoot, dir);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep);
  return parts.length >= 2 && parts[1] === "received";
}

/**
 * Whether the destination's filesystem has room for the verified files.
 * Space held by an earlier copy of the same plan counts as free (it is
 * replaced). Returns null, or a message naming both sizes.
 */
export function stagingSpaceProblem(destDir, verified, { statfs = fs.statfsSync } = {}) {
  const need = verified.manifest.archives.reduce((n, a) => n + a.bytes, 0) + 4 * 1024 * 1024;
  let probe = destDir;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  let reusable = 0;
  if (fs.existsSync(destDir)) {
    for (const f of fs.readdirSync(destDir)) {
      try { const st = fs.lstatSync(path.join(destDir, f)); if (st.isFile()) reusable += st.size; } catch { /* gone */ }
    }
  }
  const s = statfs(probe);
  const free = Number(s.bavail) * Number(s.bsize) + reusable;
  if (free >= need) return null;
  const gib = (b) => `${(b / 1024 ** 3).toFixed(2)} GiB`;
  return `Not enough free space to receive this transfer: it needs ${gib(need)} and ${gib(free)} is free where it is copied (${probe}).`;
}

/**
 * Copy a verified transfer into the receiving profile's own directory,
 * re-hashing every byte copied. Throws when anything differs.
 */
export async function stageTransfer(srcDir, destDir, verified) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(destDir, TRANSFER_DIR), { recursive: true });
  const copyHashed = (src, dest, mode) => new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const out = fs.createWriteStream(dest, { flags: "wx", mode });
    fs.createReadStream(src).on("error", reject).on("data", (d) => h.update(d)).pipe(out);
    out.on("error", reject).on("finish", () => resolve(h.digest("hex")));
  });
  for (const a of verified.manifest.archives) {
    const got = await copyHashed(path.join(srcDir, a.file), path.join(destDir, a.file), 0o644);
    if (got !== a.sha256) throw Object.assign(new Error(`${a.file} changed while it was being copied.`), { code: "TRANSFER_CHANGED" });
  }
  for (const [rel, want] of [[path.join(TRANSFER_DIR, "plan.json"), verified.manifest.plan.sha256], [path.join(TRANSFER_DIR, "imageset-config.yaml"), verified.manifest.imagesetConfig.sha256], [path.join(TRANSFER_DIR, MANIFEST_FILE), verified.manifestSha256]]) {
    const got = await copyHashed(path.join(srcDir, rel), path.join(destDir, rel), 0o444);
    if (got !== want) throw Object.assign(new Error(`${rel} changed while it was being copied.`), { code: "TRANSFER_CHANGED" });
  }
}

/** Cheap check before each disk-to-mirror run that the staged copy is still what was verified. */
export function checkStaged(destDir, record) {
  const problems = [];
  for (const a of record.archives) {
    try {
      const st = fs.lstatSync(path.join(destDir, a.file));
      if (!st.isFile() || st.size !== a.bytes) problems.push(`${a.file} changed after it was received.`);
    } catch {
      problems.push(`${a.file} is no longer in the received copy.`);
    }
  }
  try {
    const cfg = fs.readFileSync(path.join(destDir, TRANSFER_DIR, "imageset-config.yaml"));
    if (sha256Bytes(cfg) !== record.configSha256) problems.push("The received imageset-config.yaml no longer matches its SHA-256.");
  } catch {
    problems.push("The received imageset-config.yaml is missing.");
  }
  return problems;
}
