/**
 * OpenShift Airgap Architect - "Start new Install…" (v2.3.0, RFC §18.2/§18.3)
 *
 * The only way to clear the Install workflow. Its wording is rendered from the
 * server's own preview (GET /api/start-over/preview), and the reset sends the
 * preview's token back, so what the user reads is what runs: Install's own
 * selections and runs only. Mirroring profiles, Upgrade plans, their stage
 * profiles and every Mirroring/Upgrade run are listed as kept/unaffected.
 * If the scope changes before confirmation, the server refuses (409) and the
 * dialog shows the new scope instead of resetting.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useState } from "react";
import ScopedConfirmModal from "./components/ScopedConfirmModal.jsx";
import { apiFetch } from "./api.js";

const jobLabel = (j) => {
  const what = j.type === "oc-mirror-run" ? "oc-mirror run" : j.type === "upgrade-sequence" ? "Upgrade stage sequence" : j.type === "operator-scan" ? "operator scan" : j.type;
  const where = j.archivePath || j.workspacePath;
  return `${what} ${j.id}${where ? ` (${where})` : ""}`;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default function InstallResetDialog({ isOpen, onClose, onReset, startOver }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPreview(await apiFetch("/api/start-over/preview?cancelInstallRuns=true"));
    } catch (err) {
      setPreview(null);
      setError(`Could not check what Start new Install would affect, so it is not offered right now: ${String(err?.message || err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) { setNotice(""); load(); }
  }, [isOpen, load]);

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const next = await startOver({ cancelInstallRuns: true, previewToken: preview.token });
      onReset?.(next);
      onClose();
    } catch (err) {
      if (err?.payload?.code === "RESET_SCOPE_CHANGED") {
        setNotice("What this would affect changed while the dialog was open (for example, a run started or finished). Review the updated list.");
        await load();
      } else {
        setError(`Start new Install failed: ${String(err?.message || err)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const p = preview?.preserved || {};
  const removed = ["Install selections, lock-ins and entered values (you return to the first Install step)", "Temporary files of finished Install runs"];
  const kept = preview ? [
    `${plural(p.mirroringProfiles || 0, "Mirroring profile", "Mirroring profiles")}`,
    `${plural(p.upgradePlans || 0, "Upgrade plan", "Upgrade plans")}${p.upgradeStageProfiles ? ` and their ${plural(p.upgradeStageProfiles, "stage profile", "stage profiles")}` : ""}`,
    "Operation history, and mirrored data and transfers on disk",
    "Bundles and run files you already exported",
    "Credentials held in this browser for Mirroring or Upgrade"
  ] : [];
  const affected = (preview?.cancel || []).map((j) => `${jobLabel(j)} — may leave partial mirror content to check before running again`);
  const unaffected = [
    ...(preview?.unaffected || []).map((j) => `${jobLabel(j)} (${j.workflow === "upgrade" ? "Upgrade" : "Mirroring"}) keeps running`),
    ...(preview?.keepInstall || []).map((j) => `${jobLabel(j)} keeps running`),
    ...(preview?.unclassified || []).map((j) => `${jobLabel(j)} keeps running (its owning workflow is not recorded, so it is never stopped automatically)`)
  ];
  return (
    <ScopedConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      id="install-reset"
      title="Start a new Install?"
      intro="This clears the Install workflow only."
      removed={preview ? removed : []}
      kept={kept}
      affected={affected}
      unaffected={unaffected}
      loading={loading}
      error={error || null}
      notes={notice ? [notice] : []}
      confirmLabel={affected.length ? `Stop ${plural(affected.length, "Install run", "Install runs")} and start a new Install` : "Start a new Install"}
      confirmDisabled={!preview}
      busy={busy}
      onConfirm={confirm}
    />
  );
}
