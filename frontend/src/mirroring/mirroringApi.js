/**
 * OpenShift Airgap Architect - Mirroring API client (v2.2.0)
 *
 * Thin wrappers over the server-owned /api/mirroring routes (M1). The server
 * derives every filesystem path and validates every version; this client only
 * sends user selections. No credential is ever part of a profile write.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { apiFetch, API_BASE } from "../api.js";

const json = (method, body) => ({ method, body: JSON.stringify(body ?? {}) });
const profileUrl = (id, suffix = "") => `/api/mirroring/profiles/${encodeURIComponent(id)}${suffix}`;

export const fetchMirroring = (options = {}) => apiFetch("/api/mirroring", options);
export const createProfile = (body) => apiFetch("/api/mirroring/profiles", json("POST", body));
export const updateProfile = (id, body) => apiFetch(profileUrl(id), json("POST", body));
export const lockProfileRelease = (id) => apiFetch(profileUrl(id, "/lock"), json("POST", {}));
export const unlockProfileRelease = (id) => apiFetch(profileUrl(id, "/unlock"), json("POST", {}));
export const deleteProfile = (id) => apiFetch(profileUrl(id), { method: "DELETE" });
export const setActiveProfile = (profileId) => apiFetch("/api/mirroring/active", json("POST", { profileId }));
export const reconcileCatalog = (id, action) => apiFetch(profileUrl(id, "/reconcile-catalog"), json("POST", { action }));
export const analyzeImport = (body) => apiFetch("/api/mirroring/import/analyze", json("POST", body));
export const applyImport = (body) => apiFetch("/api/mirroring/import/apply", json("POST", body));
export const fetchImportOriginal = (id, importId) => apiFetch(profileUrl(id, `/imports/${encodeURIComponent(importId)}`));
export const reviewImport = (id, importId, itemIds) => apiFetch(profileUrl(id, `/imports/${encodeURIComponent(importId)}/review`), json("POST", { action: "omit", itemIds }));

// M5 — execution. Credentials travel only in these request bodies and are
// never part of a profile write.
export const preflightProfile = (id, body) => apiFetch(profileUrl(id, "/preflight"), json("POST", body));
export const runProfile = (id, body) => apiFetch(profileUrl(id, "/run"), json("POST", body));
export const fetchProfileRuns = (id, options = {}) => apiFetch(profileUrl(id, "/runs"), options);
export const fetchPlan = (id, planId, sha256) => apiFetch(profileUrl(id, `/plans/${encodeURIComponent(planId)}${sha256 ? `?sha256=${encodeURIComponent(sha256)}` : ""}`));
export const verifyCatalogs = (id, body) => apiFetch(profileUrl(id, "/verify-catalogs"), json("POST", body));
export const fetchJob = (jobId, options = {}) => apiFetch(`/api/jobs/${encodeURIComponent(jobId)}`, options);
export const stopJob = (jobId) => apiFetch(`/api/jobs/${encodeURIComponent(jobId)}/stop`, json("POST", {}));
// M6 — low-side transfer and high-side receipt.
export const prepareTransfer = (id, jobId, { acknowledgeUnpinned = false } = {}) => apiFetch(profileUrl(id, "/transfer"), json("POST", acknowledgeUnpinned ? { jobId, acknowledgeUnpinned: true } : { jobId }));
export const receiveTransfer = (transferDir) => apiFetch("/api/mirroring/receive", json("POST", { transferDir }));
// Operations: a read-only view over the job engine (live output stays GET /api/jobs/:id).
export const fetchOperations = (options = {}) => apiFetch("/api/mirroring/operations", options);
export const fetchOperation = (jobId) => apiFetch(`/api/mirroring/operations/${encodeURIComponent(jobId)}`);
/** The sanitized log as text, with the file name the server proposes. */
export const fetchOperationLog = async (jobId) => {
  const res = await fetch(`${API_BASE}/api/mirroring/operations/${encodeURIComponent(jobId)}/log`, { credentials: "same-origin" });
  if (!res.ok) {
    let message = res.statusText;
    try { message = (await res.json()).error || message; } catch { /* not JSON */ }
    throw new Error(message || `The log could not be downloaded (HTTP ${res.status}).`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || `mirroring-${jobId}.log`;
  return { text: await res.text(), filename: name };
};
// Where Mirroring content is stored (container paths), checked live on the server.
export const fetchStorage = (profileId) => apiFetch(`/api/mirroring/storage${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ""}`);
// Choose one of the administrator-approved storage roots while the profile is still empty.
export const chooseStorage = (id, base) => apiFetch(profileUrl(id, "/storage"), json("POST", { base }));
// "Run the same again" for an unfinished run: credentials for this attempt only.
export const retryOperation = (profileId, jobId, body) => apiFetch(profileUrl(profileId, `/operations/${encodeURIComponent(jobId)}/retry`), json("POST", body));
// Folder browser for the storage location (directories under allowed locations only).
export const browseStorage = (dir) => apiFetch(`/api/mirroring/storage/browse${dir ? `?path=${encodeURIComponent(dir)}` : ""}`);
