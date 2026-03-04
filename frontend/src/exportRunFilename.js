/**
 * Build a human-readable, filesystem-safe export filename for Export Run (#39).
 * Uses timestamp and sanitized run metadata; omits unset values. No secrets.
 * @param {object} state - Current app state at export time
 * @returns {string} Filename e.g. airgap-run_2026-03-04_1415_bare-metal-agent_amd64_ocp-4.20_fips_3cp_6w.json
 */
import { getScenarioId } from "./hostInventoryV2Helpers.js";

function sanitize(s) {
  if (s == null || typeof s !== "string") return "";
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
}

export function getExportRunFilename(state) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5).replace(":", "");
  const parts = ["airgap-run", `${date}_${time}`];

  const platform = state?.blueprint?.platform;
  const method = state?.methodology?.method;
  const scenarioId = getScenarioId(platform, method);
  if (scenarioId) parts.push(scenarioId);

  const arch = state?.blueprint?.arch;
  if (arch) {
    const a = arch.toLowerCase();
    if (a === "x86_64" || a === "amd64") parts.push("amd64");
    else if (a === "aarch64" || a === "arm64") parts.push("arm64");
    else if (a === "ppc64le") parts.push("ppc64le");
    else if (a === "s390x") parts.push("s390x");
    else if (sanitize(arch)) parts.push(sanitize(arch));
  }

  const version = state?.release?.patchVersion || state?.version?.selectedVersion;
  if (version && typeof version === "string") {
    const match = version.match(/^(\d+)\.(\d+)/);
    if (match) parts.push(`ocp-${match[1]}.${match[2]}`);
  }

  if (state?.globalStrategy?.fips === true) parts.push("fips");
  if (state?.globalStrategy?.proxyEnabled === true) parts.push("proxy");

  const nodes = state?.hostInventory?.nodes || [];
  const masters = nodes.filter((n) => n?.role === "master").length;
  const workers = nodes.filter((n) => n?.role === "worker").length;
  if (masters > 0) parts.push(`${masters}cp`);
  if (workers > 0) parts.push(`${workers}w`);

  const stem = parts.join("_");
  return `${stem}.json`;
}
