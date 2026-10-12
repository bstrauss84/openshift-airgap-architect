/**
 * Startup integrity check for the shipped read-only data.
 *
 * WHY. A container that cannot see `data/arch-support/<minor>.json` does not
 * fail at boot — every loader in this codebase fails closed, by design, so the
 * app starts happily and the damage appears much later and much further away:
 * the user selects a supported release, the wizard accepts it, and the YAML
 * preview is replaced by "No architecture-support matrix is available for
 * OpenShift 4.21". The same mispackaging made `catalogValidator` fall back to
 * an empty catalog set, silently disabling parameter validation.
 *
 * Failing closed per-lookup is right. Starting up at all when the data a
 * SUPPORTED minor requires is absent is not: that is an application integrity
 * error, not a user-recoverable condition, and it should be caught by the
 * image build or by boot, never surfaced as an internal error inside a
 * generated artifact.
 *
 * This check is about PRESENCE AND LOADABILITY of each supported minor's
 * authority. It deliberately does not re-validate matrix content —
 * `scripts/validate-arch-support.js` owns that.
 */

import fs from "fs";
import path from "path";

import { SUPPORTED_MINORS } from "./versionPolicy.js";
import { canonicalDataRoot } from "./canonicalDataRoot.js";
import { loadArchSupportDataset } from "./archSupportData.js";

/**
 * @returns {{ok: boolean, root: string, problems: string[]}}
 */
export function checkCanonicalDataAvailable() {
  const root = canonicalDataRoot();
  const problems = [];

  // The canonical root must never be the writable runtime volume. That exact
  // collision is the original defect: the backend resolved its shipped data to
  // `/data`, which docker-compose mounts as an empty named volume for the
  // database, downloaded tools and oc-mirror archives. Reading shipped data
  // from a volume that starts empty fails silently by construction, so this is
  // checked explicitly rather than inferred from the data being present.
  const runtimeDir = path.resolve(process.env.DATA_DIR || "/data");
  if (root === runtimeDir) {
    problems.push(
      `canonical data root (${root}) is the writable runtime volume DATA_DIR. ` +
        "Shipped read-only data and runtime state must not share a directory; " +
        "set OAA_CANONICAL_DATA_DIR to where the image placed data/ (the container uses /app/data)."
    );
    return { ok: false, root, problems };
  }
  if (root.startsWith(runtimeDir + path.sep)) {
    problems.push(
      `canonical data root (${root}) is inside the writable runtime volume (${runtimeDir}), ` +
        "so a volume mount would shadow the shipped data."
    );
    return { ok: false, root, problems };
  }

  if (!fs.existsSync(root)) {
    problems.push(`canonical data root does not exist: ${root}`);
    return { ok: false, root, problems };
  }

  const dataset = loadArchSupportDataset();
  for (const minor of SUPPORTED_MINORS) {
    const doc = Object.prototype.hasOwnProperty.call(dataset, minor) ? dataset[minor] : null;
    if (!doc) {
      problems.push(`no architecture-support matrix loaded for supported minor ${minor}`);
    } else if (!Array.isArray(doc.matrix) || doc.matrix.length === 0) {
      problems.push(`architecture-support matrix for ${minor} is empty`);
    }

    const paramsDir = path.join(root, "params", minor);
    if (!fs.existsSync(paramsDir)) {
      problems.push(`no parameter catalog directory for supported minor ${minor}: ${paramsDir}`);
    } else if (fs.readdirSync(paramsDir).filter((f) => f.endsWith(".json")).length === 0) {
      problems.push(`parameter catalog directory for ${minor} contains no catalogs: ${paramsDir}`);
    }
  }

  return { ok: problems.length === 0, root, problems };
}

/**
 * Throws when any supported minor's shipped authority is missing.
 * Call once during startup, before the server accepts requests.
 */
export function assertCanonicalDataAvailable() {
  const { ok, root, problems } = checkCanonicalDataAvailable();
  if (ok) return;

  const err = new Error(
    `Canonical data is incomplete, so this build cannot serve its supported OpenShift releases.\n` +
      `  canonical data root: ${root}\n` +
      problems.map((p) => `  - ${p}`).join("\n") +
      `\nThis is a packaging error. Set OAA_CANONICAL_DATA_DIR to the directory containing ` +
      `arch-support/ and params/ (the container image places it at /app/data). ` +
      `It must NOT point at DATA_DIR, which is the writable runtime volume.`
  );
  err.code = "CANONICAL_DATA_UNAVAILABLE";
  throw err;
}
