/**
 * Where the backend finds the canonical, read-only data it ships with:
 * `data/arch-support/<minor>.json` and `data/params/<minor>/*.json`.
 *
 * WHY THIS MODULE EXISTS — a container packaging defect this resolves.
 *
 * `archSupportData.js` and `catalogValidator.js` both resolved
 * `path.resolve(__dirname, "../../data")`. In the repository that is correct:
 * `backend/src/../../data` is `<repo>/data`. In the container it is not, and
 * the way it fails is worse than a missing directory:
 *
 *   - `backend/Containerfile` sets `WORKDIR /app` and `COPY backend/src ./src`,
 *     so the code lives at `/app/src` and `../../data` resolves to `/data`.
 *   - The shipped data is copied by `COPY data ./data`, i.e. to `/app/data`.
 *   - `/data` is already taken: `docker-compose.yml` mounts the `backend-data`
 *     named volume there and sets `DATA_DIR=/data`. It is the WRITABLE RUNTIME
 *     volume holding the database, downloaded tools and oc-mirror archives.
 *
 * So the backend did not merely look in the wrong place — it looked inside an
 * empty runtime volume that legitimately exists. `loadArchSupportDataset()`
 * returned `{}` for every minor, and the YAML preview reported "No
 * architecture-support matrix is available for OpenShift 4.21" for a
 * configuration the UI had just accepted. The same path made
 * `catalogValidator` log a not-found and fall back to an empty catalog set,
 * silently disabling catalog validation in every containerized run.
 *
 * Note this is NOT specific to 4.21: in a container it failed identically for
 * every supported minor.
 *
 * THE CONTRACT. One explicit setting, no path guessing. The container declares
 * where it put the data; the repository default is the repository layout.
 * `/data` is deliberately never a candidate — that is runtime state, not
 * shipped data, and conflating the two is what caused this.
 *
 * Integrity is asserted at startup by `assertCanonicalDataAvailable()` in
 * `canonicalDataIntegrity.js`, so a mispackaged image fails loudly on boot
 * instead of surfacing an internal authority error inside a user's YAML
 * preview.
 */

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repository layout: `backend/src` → `<repo>/data`. */
const REPO_DEFAULT = path.resolve(__dirname, "../../data");

/**
 * Absolute path to the shipped read-only data root.
 *
 * Set `OAA_CANONICAL_DATA_DIR` when the deployment layout differs from the
 * repository's — `backend/Containerfile` sets it to `/app/data`.
 */
export function canonicalDataRoot() {
  const override = (process.env.OAA_CANONICAL_DATA_DIR || "").trim();
  return override ? path.resolve(override) : REPO_DEFAULT;
}

export { REPO_DEFAULT as CANONICAL_DATA_ROOT_REPO_DEFAULT };
