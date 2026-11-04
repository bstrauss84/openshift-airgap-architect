/**
 * OpenShift Airgap Architect - oc-mirror binary identity on the disconnected
 * side (v2.2.0, Option B)
 *
 * The transfer manifest records the oc-mirror the connected side ran: its
 * executable SHA-256, version, commit and (when known) architecture and the
 * Red Hat release directory it came from. Here the disconnected side compares
 * that with the oc-mirror it would run itself.
 *
 * What a result means — and what it does not:
 *  - match: the same executable bytes. Not a FIPS statement and not proof the
 *    binary suits this machine's RHEL version or CPU (Red Hat: install the
 *    binary for the RHEL version you use).
 *  - different: different bytes. Often intended (the build for this machine's
 *    RHEL version or architecture); never reported as corruption.
 *  - local-missing / not-recorded / invalid-recorded: nothing to compare.
 * A version string is shown for orientation only; only the SHA-256 decides.
 * No path on either machine is reported; no download is made.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

import fs from "node:fs";

const SHA256_RE = /^[a-f0-9]{64}$/;
// A Red Hat release directory name, e.g. 4.22.19 (never "latest").
const RELEASE_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]{1,40})?$/;
const ARCH_DIR = { amd64: "x86_64", x86_64: "x86_64", arm64: "aarch64", aarch64: "aarch64", ppc64le: "ppc64le", s390x: "s390x" };

export const HOST_ARCH = { x64: "amd64", arm64: "arm64", ppc64: "ppc64le", s390x: "s390x" }[process.arch] || process.arch;

const short = (s) => (typeof s === "string" ? s.slice(0, 200) : null);

/**
 * The connected side's oc-mirror as recorded in a transfer (manifest `tool` or a
 * received record), keeping only well-formed values.
 */
export function recordedToolIdentity(tool) {
  if (!tool || typeof tool !== "object") return { present: false };
  const sha256 = typeof tool.sha256 === "string" ? tool.sha256.toLowerCase() : null;
  return {
    present: true,
    sha256: sha256 && SHA256_RE.test(sha256) ? sha256 : null,
    malformedSha256: Boolean(tool.sha256) && !(sha256 && SHA256_RE.test(sha256)),
    version: short(tool.version),
    gitCommit: typeof tool.gitCommit === "string" && /^[0-9a-f]{7,64}$/i.test(tool.gitCommit) ? tool.gitCommit : null,
    arch: typeof tool.arch === "string" && ARCH_DIR[tool.arch] ? tool.arch : null,
    channelRelease: typeof tool.channelRelease === "string" && RELEASE_RE.test(tool.channelRelease) ? tool.channelRelease : null
  };
}

/**
 * Where the same build is published, as a versioned directory (never latest).
 * Only when the release and architecture are both recorded.
 */
export function versionedSourceUrl(recorded) {
  if (!recorded?.channelRelease || !recorded?.arch) return null;
  return `https://mirror.openshift.com/pub/openshift-v4/${ARCH_DIR[recorded.arch]}/clients/ocp/${recorded.channelRelease}/`;
}

/**
 * @param {object} recorded  recordedToolIdentity(...)
 * @param {{ available: boolean, sha256?: string, version?: string, source?: string, problem?: string }} local
 * @returns {{ status: "match"|"different"|"local-missing"|"not-recorded"|"invalid-recorded", text: string, recorded: object, local: object }}
 */
export function compareToolIdentity(recorded, local) {
  const rec = recorded || { present: false };
  const loc = local || { available: false };
  const localView = { available: Boolean(loc.available), sha256: loc.sha256 || null, version: short(loc.version), source: loc.source || null, arch: HOST_ARCH };
  const recView = { sha256: rec.sha256 || null, version: rec.version || null, gitCommit: rec.gitCommit || null, arch: rec.arch || null, channelRelease: rec.channelRelease || null };
  const out = (status, text) => ({ status, text, recorded: recView, local: localView });
  if (!rec.present || (!rec.sha256 && !rec.malformedSha256)) {
    return out("not-recorded", "This transfer does not record the SHA-256 of the oc-mirror the connected side ran (it was prepared by an older Architect), so the two builds cannot be compared.");
  }
  if (rec.malformedSha256) return out("invalid-recorded", "The transfer's recorded oc-mirror SHA-256 is not a valid SHA-256, so the builds were not compared.");
  if (!loc.available || !loc.sha256 || !SHA256_RE.test(loc.sha256)) {
    return out("local-missing", `No usable oc-mirror on this server to compare${loc.problem ? ` (${loc.problem})` : ""}. Disk to mirror needs one.`);
  }
  if (loc.sha256 === rec.sha256) {
    return out("match", `Same bytes: this server's oc-mirror (SHA-256 ${loc.sha256}) is exactly the executable the connected side ran${rec.version ? ` (${rec.version})` : ""}. This proves identical bytes only — not FIPS capability, and not that the build suits this machine's RHEL version or CPU.`);
  }
  const src = versionedSourceUrl(rec);
  return out("different", `Different bytes: this server's oc-mirror${loc.version ? ` (${loc.version})` : ""}, SHA-256 ${loc.sha256}, is not the executable the connected side ran${rec.version ? ` (${rec.version})` : ""}, SHA-256 ${rec.sha256}. That is expected when you installed the build for this machine's RHEL version or CPU architecture and is not by itself a sign of damage.${src ? ` The connected side's build is published in ${src} (a versioned directory, not latest); check any download against that directory's sha256sum.txt.` : " See README-TRANSFER.txt for how to check a build."}`);
}

/**
 * This server's oc-mirror, as preflight would find it (no download), described
 * by its executable SHA-256. Never throws.
 * @param {() => object|null} peek  peekOcMirrorBinary
 * @param {(resolved: object) => Promise<object>} describe  describeOcMirrorTool
 */
export async function localToolIdentity(peek, describe) {
  let found;
  try { found = peek(); } catch (err) { return { available: false, problem: "it could not be located" }; }
  if (!found) return { available: false, problem: "none is installed or configured" };
  if (found.error) return { available: false, problem: "the configured binary is not usable" };
  try {
    // Follows a symlink to the executable it names; an empty or non-regular file is not a tool.
    const st = fs.statSync(found.path);
    if (!st.isFile()) return { available: false, problem: "the configured path is not a regular file" };
    if (st.size === 0) return { available: false, problem: "the binary is empty" };
  } catch {
    return { available: false, problem: "it could not be read" };
  }
  try {
    const t = await describe(found);
    return { available: Boolean(t?.sha256), sha256: t?.sha256 || null, version: t?.version || null, source: found.source === "env" ? "OC_MIRROR_BIN" : found.source === "baked-in" ? "built into this image" : found.source || null };
  } catch {
    return { available: false, problem: "it could not be read" };
  }
}
