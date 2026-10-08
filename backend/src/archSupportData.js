/**
 * Backend loader for the canonical target-cluster architecture matrix.
 *
 * Reads `data/arch-support/<minor>.json` — the same canonical files the
 * frontend projection is generated from, and the same files
 * `scripts/validate-arch-support.js` guards. There is deliberately no second
 * table here: this module only loads, and `shared/archSupport.js` decides.
 *
 * The path convention mirrors `backend/src/catalogValidator.js`, which already
 * reads `../../data/params/<minor>`.
 *
 * Fails closed: a missing directory, an unreadable file or a malformed document
 * yields no entry for that minor, and the resolver treats an absent minor as
 * "no answer" rather than as permission.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCH_SUPPORT_DIR = path.resolve(__dirname, "../../data/arch-support");

/** minor -> parsed document. Built once; the files are tracked build inputs. */
let cache = null;

function loadArchSupportDataset() {
  if (cache) return cache;
  const dataset = {};
  let entries = [];
  try {
    entries = fs.readdirSync(ARCH_SUPPORT_DIR);
  } catch {
    // No directory: every lookup resolves closed. Deliberately not thrown here,
    // so the failure surfaces at the architecture assertion with context rather
    // than at module load.
    cache = Object.freeze({});
    return cache;
  }
  for (const file of entries) {
    if (!file.endsWith(".json")) continue;
    const minor = file.replace(/\.json$/, "");
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(ARCH_SUPPORT_DIR, file), "utf8"));
      if (doc && Array.isArray(doc.matrix)) dataset[minor] = doc;
    } catch {
      // A malformed file contributes nothing. Same fail-closed outcome.
    }
  }
  cache = Object.freeze(dataset);
  return cache;
}

/** Test seam: drop the cache so a fixture directory can be exercised. */
function __resetArchSupportCacheForTests() {
  cache = null;
}

export { loadArchSupportDataset, __resetArchSupportCacheForTests, ARCH_SUPPORT_DIR };
