/**
 * OpenShift Airgap Architect - "Back to Upgrade plan" (v2.3.0 UX correction).
 *
 * When a stage is opened in the full Mirroring workspace, Upgrade records where to come back to:
 * the plan, its step and its stage (names and ids only — never credentials). Mirroring shows a
 * prominent "Back to Upgrade plan" action while the record exists; Upgrade restores the place
 * and clears it. Session storage only: it does not survive closing the tab.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
export const RETURN_KEY = "oaa.upgrade.return.v1";
const MIRRORING_VIEW_KEY = "oaa.mirroring.view.v1";

export const readUpgradeReturn = () => {
  try {
    const v = JSON.parse(sessionStorage.getItem(RETURN_KEY) || "null");
    return v && typeof v.planId === "string" ? v : null;
  } catch { return null; }
};
export const clearUpgradeReturn = () => { try { sessionStorage.removeItem(RETURN_KEY); } catch { /* storage unavailable */ } };

/** Remember the place in Upgrade and choose what Mirroring opens (the profile list, or one operation). */
export const rememberUpgradeReturn = ({ planId, planName, stageId = null, step = "mirror" }, { jobId = null } = {}) => {
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({ planId, planName: String(planName || "").slice(0, 120), stageId, step }));
    sessionStorage.setItem(MIRRORING_VIEW_KEY, JSON.stringify(jobId ? { view: "operations", jobId } : { view: "profiles", jobId: null }));
  } catch { /* storage unavailable: Mirroring still opens, without the way back */ }
};
