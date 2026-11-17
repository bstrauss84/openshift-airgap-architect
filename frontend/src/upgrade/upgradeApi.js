/**
 * OpenShift Airgap Architect - Upgrade workflow API client (v2.3.0).
 *
 * Thin wrappers over /api/upgrade. Credentials are only ever sent in the body
 * of a sequence start (the server keeps them in memory for that sequence) and
 * are never stored in the browser beyond the existing session-only credential.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { apiFetch, API_BASE } from "../api.js";

const post = (path, body) => apiFetch(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export const fetchUpgrade = () => apiFetch("/api/upgrade");
export const createPlan = (name) => post("/api/upgrade/plans", name ? { name } : {});
export const updatePlan = (id, patch) => post(`/api/upgrade/plans/${id}`, patch);
export const setActivePlan = (planId) => post("/api/upgrade/active", { planId });
export const deletionPreview = (id) => apiFetch(`/api/upgrade/plans/${id}/deletion-preview`);
export const deletePlan = (id, { removeStageProfiles = false } = {}) => apiFetch(`/api/upgrade/plans/${id}?removeStageProfiles=${removeStageProfiles ? "true" : "false"}`, { method: "DELETE" });
export const fetchGraph = (channel, arch, source = "public") => apiFetch(`/api/upgrade/graph?channel=${encodeURIComponent(channel)}&arch=${encodeURIComponent(arch)}&source=${source}`);
export const refreshGraph = (channel, arch) => post("/api/upgrade/graph/refresh", { channel, arch });
export const importGraph = (body) => post("/api/upgrade/graph/import", body);
export const fetchTargets = (id, channel) => apiFetch(`/api/upgrade/plans/${id}/targets${channel ? `?channel=${encodeURIComponent(channel)}` : ""}`);
export const solvePlan = (id, route) => post(`/api/upgrade/plans/${id}/solve`, route ? { route } : {});
export const prepareStages = (id) => post(`/api/upgrade/plans/${id}/stages`, {});
export const fetchReadiness = (id) => apiFetch(`/api/upgrade/plans/${id}/readiness`);
export const importInventory = (id, kind, text) => post(`/api/upgrade/plans/${id}/inventory`, { kind, text });
export const clearInventory = (id) => apiFetch(`/api/upgrade/plans/${id}/inventory`, { method: "DELETE" });
export const importBundle = (id, text) => post(`/api/upgrade/plans/${id}/inventory/bundle`, { text });
export const collectorScriptUrl = () => `${API_BASE}/api/upgrade/readiness-collector`;
export const attest = (id, checkId, attested, note) => post(`/api/upgrade/plans/${id}/attest`, { checkId, attested, ...(note ? { note } : {}) });
export const setClusterProgress = (id, stageId, state) => post(`/api/upgrade/plans/${id}/cluster-progress`, { stageId, state });
export const fetchInstructions = (id, registry) => apiFetch(`/api/upgrade/plans/${id}/instructions${registry ? `?registry=${encodeURIComponent(registry)}` : ""}`);
export const fetchArtifacts = (id) => apiFetch(`/api/upgrade/plans/${id}/artifacts`);
export const previewSequence = (id, body) => post(`/api/upgrade/plans/${id}/sequence/preview`, body);
export const startSequence = (id, body) => post(`/api/upgrade/plans/${id}/sequence`, body);
export const importPackage = (text) => post("/api/upgrade/import", { text });
export const analyzePresets = (id, files) => post(`/api/upgrade/plans/${id}/presets/analyze`, { files });
export const saveOperatorIntent = (id, body) => post(`/api/upgrade/plans/${id}/operator-intent`, body);
export const applyIntentToStages = (id, keys, includeImages) => post(`/api/upgrade/plans/${id}/operator-intent/apply-to-stages`, { keys, includeImages: Boolean(includeImages) });
export const packageZipUrl = (id) => `${API_BASE}/api/upgrade/plans/${id}/package.zip`;
// v2.3.0 UX correction.
export const saveMirrorSettings = (id, body) => post(`/api/upgrade/plans/${id}/mirror`, body);
export const destinationCheck = (id, body) => post(`/api/upgrade/plans/${id}/sequence/destination-check`, body);
export const copyStageOperators = (id, stageId, toStageIds) => post(`/api/upgrade/plans/${id}/stages/${stageId}/copy-operators`, toStageIds ? { toStageIds } : {});
/** A stage profile's validated ImageSetConfiguration (the Mirroring preview route; read-only). */
export const fetchStageConfig = (profileId) => post(`/api/mirroring/profiles/${encodeURIComponent(profileId)}/preview`, {});
/** Exploration only (D-1): a route across older minors from the public graph; never changes a plan. */
export const exploreRoute = (body) => post("/api/upgrade/explore", body);
/** Existing Mirroring scan route (one job per catalog for one minor); credentials in this request only. */
export const startCatalogScan = (body) => post("/api/operators/scan", body);
/** Cached scan results for one catalog minor (all three catalogs). */
export const fetchCatalogStatus = (minor) => apiFetch(`/api/operators/status?version=${encodeURIComponent(minor)}`);
/** What each stage catalog is known to list for each selected operator (cached Live-check listings; read-only). */
export const fetchChannelEvidence = (id) => apiFetch(`/api/upgrade/plans/${id}/channel-evidence`);
