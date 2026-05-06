/**
 * OpenShift Airgap Architect - Wizard Version Gate Logic
 *
 * Step IDs whose completion checkmark requires release/version confirmation.
 * Segmented flow: all wizard steps except Operations; legacy: blueprint, global, review.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

export function getVersionDependentStepIdSet(segmentedFlowV1, visibleSteps) {
  if (!segmentedFlowV1) {
    return new Set(["blueprint", "global", "review"]);
  }
  return new Set(visibleSteps.map((s) => s.id).filter((id) => id !== "operations"));
}
