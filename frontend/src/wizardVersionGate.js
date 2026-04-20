/**
 * Step ids whose completion checkmark requires release/version confirmation (see App.jsx completeFlags).
 * Segmented flow: all wizard steps except Operations; legacy: blueprint, global, review.
 */

export function getVersionDependentStepIdSet(segmentedFlowV1, visibleSteps) {
  if (!segmentedFlowV1) {
    return new Set(["blueprint", "global", "review"]);
  }
  return new Set(visibleSteps.map((s) => s.id).filter((id) => id !== "operations"));
}
