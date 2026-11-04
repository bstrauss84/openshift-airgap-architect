/**
 * OpenShift Airgap Architect - check what a recovery attempt really produced (v2.2.0)
 *
 * Exit code 0 is oc-mirror's own claim. After a "Run the same again" attempt,
 * Architect checks the result itself, as far as that is possible:
 *
 * - mirror to disk: the run's archive set exists, every tar entry is safe, every
 *   content-addressed blob hashes to its digest (E5d), the workspace history
 *   advanced, catalogs are pinned when operators are mirrored, and oc-mirror's
 *   error list is empty. (No dry run here: on the shipped oc-mirror a mirror-to-
 *   disk dry run deletes the archives in its destination — E13.)
 * - disk to mirror / mirror to mirror: oc-mirror's own dry run (which touches
 *   neither the destination nor archives — X5) lists every source -> destination
 *   reference in working-dir/dry-run/mapping.txt; each destination manifest is
 *   fetched with the attempt's credentials over verified TLS, and a digest-tagged
 *   one (…:sha256-<hex>) must have that digest.
 *
 * Outcome: fully-verified | partially-verified | incomplete | unverifiable.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import fs from "node:fs";
import path from "node:path";
import { inspectTar, hashArchive } from "./mirroringTransfer.js";
import { createRegistryClient, registryCoordinates } from "./verifiedRegistry.js";

const check = (name, ok, detail) => ({ name, ok, detail });

/** Archive set of a mirror to disk. */
export async function verifyArchiveSet(setDir, { expectPinned = false, historyAdvanced = false, errorLines = [] } = {}) {
  const checks = [];
  let names = [];
  try { names = fs.readdirSync(setDir).filter((n) => /^mirror_\d{6}\.tar$/.test(n)).sort(); } catch { /* reported below */ }
  checks.push(check("Archive files", names.length > 0, names.length ? `${names.length} archive file(s) in ${setDir}.` : `No archive files in ${setDir || "(none recorded)"}.`));
  let blobs = 0;
  const corrupt = [];
  let pinned = false;
  for (const n of names) {
    const full = path.join(setDir, n);
    const tar = inspectTar(full);
    if (!tar.ok) checks.push(check(`Archive ${n}`, false, tar.problems.slice(0, 3).join("; ")));
    if (tar.pinned.length) pinned = true;
    const h = await hashArchive(full);
    blobs += h.blobs;
    corrupt.push(...h.corrupt);
  }
  if (names.length) checks.push(check("Blob content", corrupt.length === 0, corrupt.length ? `${corrupt.length} blob(s) do not match their digest (for example ${corrupt[0].digest}).` : `${blobs} content-addressed blob(s) match their digests.`));
  checks.push(check("Incremental history", historyAdvanced, historyAdvanced ? "oc-mirror recorded this archive in the workspace history." : "The workspace history did not advance, so oc-mirror did not record this archive as complete."));
  if (expectPinned) checks.push(check("Catalogs pinned", pinned, pinned ? "The archive records the catalogs pinned by digest." : "The archive has no pinned catalog record."));
  checks.push(check("oc-mirror error list", errorLines.length === 0, errorLines.length ? `${errorLines.length} line(s) in oc-mirror's error list.` : "Empty."));
  const failed = checks.filter((c) => !c.ok);
  return { state: failed.length ? "incomplete" : "fully-verified", checks, scope: "archive set (content-addressed blobs, history, catalogs, error list)" };
}

/** source -> destination pairs from oc-mirror's dry-run mapping.txt. */
export function parseMapping(text) {
  return String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf("=docker://");
    if (!l.startsWith("docker://") || i < 0) return null;
    return { source: l.slice("docker://".length, i), destination: l.slice(i + "=docker://".length) };
  }).filter(Boolean);
}

/** Fetch every destination manifest named by the mapping. */
export async function verifyDestination(mapping, { authFile, env = process.env, signal = null, limit = 5000 } = {}) {
  const clients = new Map();
  const missing = [];
  const mismatched = [];
  const errors = [];
  let present = 0;
  const pairs = mapping.slice(0, limit);
  try {
    for (const { destination } of pairs) {
      let coords;
      try { coords = registryCoordinates(destination); } catch (err) { errors.push({ destination, problem: err.message }); continue; }
      const key = `${coords.host}/${coords.repository}`;
      if (!clients.has(key)) clients.set(key, createRegistryClient(coords, { authFile, env, signal, retries: 2 }));
      const client = clients.get(key);
      const ref = coords.digest || coords.tag;
      try {
        const res = await client.get(`/v2/${coords.repository}/manifests/${ref}`, { Accept: "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json" });
        const body = Buffer.from(await res.arrayBuffer());
        const digest = `sha256:${(await import("node:crypto")).createHash("sha256").update(body).digest("hex")}`;
        const wanted = /^sha256-([0-9a-f]{64})$/.exec(coords.tag || "")?.[1];
        if (wanted && digest !== `sha256:${wanted}`) mismatched.push({ destination, digest });
        else present += 1;
      } catch (err) {
        if (err?.code === "NOT_FOUND" || err?.status === 404) missing.push(destination);
        else errors.push({ destination, problem: String(err?.message || err).slice(0, 300) });
      }
    }
  } finally {
    for (const c of clients.values()) { try { c.close(); } catch { /* closed */ } }
  }
  const total = pairs.length;
  const state = !total ? "unverifiable"
    : missing.length || mismatched.length ? "incomplete"
      : errors.length ? "partially-verified"
        : mapping.length > limit ? "partially-verified" : "fully-verified";
  return {
    state,
    scope: `destination manifests for ${total} mapped image(s)${mapping.length > limit ? ` (first ${limit} of ${mapping.length})` : ""}`,
    checks: [
      check("Destination images present", missing.length === 0 && mismatched.length === 0, `${present} of ${total} present${missing.length ? `; missing: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", …" : ""}` : ""}${mismatched.length ? `; wrong digest: ${mismatched.slice(0, 5).map((m) => m.destination).join(", ")}` : ""}.`),
      ...(errors.length ? [check("Could not check", false, `${errors.length} image(s) could not be checked (for example ${errors[0].destination}: ${errors[0].problem}).`)] : [])
    ],
    missing, mismatched, errors: errors.slice(0, 50)
  };
}
