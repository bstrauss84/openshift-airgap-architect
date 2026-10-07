"use strict";

/**
 * Canonical supported-minor accessor for repository tooling.
 *
 * SUPPORTED_MINORS is declared twice by design — once for the backend and once
 * for the frontend — and the two are hand-synchronized. Tooling must never
 * hardcode a third copy, and must never silently default to a single minor:
 * both habits are how a supported minor stops being checked without anyone
 * noticing (harvest lessons L9 and D7).
 *
 * The policy modules are ESM; these scripts are CommonJS, so the constants are
 * read through a dynamic import rather than re-declared here.
 *
 * Used by:
 *   scripts/validate-param-authority.js   (iterate every supported minor)
 *   scripts/validate-supported-minors.mjs (cumulative + baseline guards)
 *   scripts/sync-docs-index.js            (mirror every supported minor)
 */

const path = require("path");
const { pathToFileURL } = require("url");

const repoRoot = path.resolve(__dirname, "..", "..");

const BACKEND_POLICY = path.join(repoRoot, "backend", "src", "versionPolicy.js");
const FRONTEND_POLICY = path.join(repoRoot, "frontend", "src", "shared", "versionPolicy.js");

async function loadPolicy(absPath) {
  const mod = await import(pathToFileURL(absPath).href);
  const list = mod.SUPPORTED_MINORS;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${absPath}: SUPPORTED_MINORS is missing or empty`);
  }
  return Object.freeze([...list]);
}

/**
 * Both declarations, for tooling that must prove they agree.
 * @returns {Promise<{backend: string[], frontend: string[]}>}
 */
async function getSupportedMinorsBothSides() {
  const [backend, frontend] = await Promise.all([
    loadPolicy(BACKEND_POLICY),
    loadPolicy(FRONTEND_POLICY),
  ]);
  return { backend, frontend };
}

/**
 * The supported minors, failing closed if the two declarations disagree.
 *
 * A divergence here means the backend and the frontend disagree about what the
 * product supports. There is no safe way for tooling to pick a side, so this
 * throws rather than guessing.
 *
 * @returns {Promise<string[]>}
 */
async function getSupportedMinors() {
  const { backend, frontend } = await getSupportedMinorsBothSides();
  if (backend.join(",") !== frontend.join(",")) {
    throw new Error(
      "SUPPORTED_MINORS mismatch between backend and frontend version policy:\n" +
        `  backend/src/versionPolicy.js        : [${backend.join(", ")}]\n` +
        `  frontend/src/shared/versionPolicy.js: [${frontend.join(", ")}]\n` +
        "These are hand-synchronized duplicates and must be identical."
    );
  }
  return backend;
}

module.exports = {
  getSupportedMinors,
  getSupportedMinorsBothSides,
  BACKEND_POLICY,
  FRONTEND_POLICY,
};
