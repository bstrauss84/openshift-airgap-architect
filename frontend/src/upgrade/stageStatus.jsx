/**
 * OpenShift Airgap Architect - Upgrade stage content status (v2.3.0 UX correction).
 *
 * A stage is one release's content: platform release + that minor's operators, mirrored into
 * the disconnected registry. Its tracker covers CONTENT ONLY — whether the cluster was updated
 * is the administrator's statement on the "Update the cluster" step, never inferred from
 * mirroring. Every step comes from recorded evidence (runs, transfers, receipts, destination
 * checks); no percentages. Steps a mirror-to-mirror stage does not need show "not needed".
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React from "react";

/** Content state → [badge state, text]. Text carries the meaning; colour only repeats it. */
export const CONTENT_STATE_TEXT = {
  planned: ["NOT_CHECKED", "○ not mirrored yet"],
  running: ["NOT_CHECKED", "… mirroring now"],
  "mirrored-to-disk": ["PENDING", "▣ mirrored to disk — next: prepare the transfer"],
  "transfer-prepared": ["PENDING", "⇢ transfer prepared — carry it across the air gap"],
  "transfer-received": ["PENDING", "⇢ received — next: disk to mirror"],
  "in-registry-unverified": ["WARNING", "⚠ in the registry, not confirmed by a destination check"],
  "registry-verified": ["VERIFIED", "✓ in the registry, every image confirmed"],
  "profile-missing": ["BLOCKED", "✕ no stage profile (prepare the stages, or receive this stage's transfer)"]
};

export const contentStateText = (state) => (CONTENT_STATE_TEXT[state] || ["NOT_CHECKED", state || "unknown"]);

export function StageProgress({ view, compact = false }) {
  const kinds = new Set((view.content?.evidence || []).map((e) => e.kind));
  const direct = kinds.has("mirrored-to-registry");
  const steps = [
    { id: "disk", label: "Mirrored to disk", done: kinds.has("mirrored-to-disk"), skip: direct && !kinds.has("mirrored-to-disk") },
    { id: "transfer", label: "Transfer prepared", done: kinds.has("transfer-prepared"), skip: direct && !kinds.has("transfer-prepared") },
    { id: "received", label: "Received", done: kinds.has("transfer-received"), skip: direct && !kinds.has("transfer-received") },
    { id: "registry", label: "In the registry", done: kinds.has("mirrored-to-registry") || kinds.has("loaded-into-registry") },
    { id: "verified", label: "Verified in the registry", done: kinds.has("registry-verified") }
  ];
  const running = view.content?.state === "running";
  const next = steps.findIndex((st) => !st.done && !st.skip);
  return (
    <ol className={`upgrade-stage-progress${compact ? " compact" : ""}`} aria-label={`Stage ${view.id.slice(1)} content progress`}>
      {steps.map((st, i) => {
        const state = st.done ? "done" : st.skip ? "skipped" : running && i === next ? "active" : "todo";
        return (
          <li key={st.id} className="upgrade-stage-progress-step" data-state={state} aria-current={i === next ? "step" : undefined}>
            <span className="upgrade-stage-progress-dot" aria-hidden="true">{state === "done" ? "✓" : state === "skipped" ? "–" : state === "active" ? "●" : "○"}</span>
            <span>{st.label}{state === "skipped" ? " (not needed)" : state === "active" ? " (in progress)" : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}
