/**
 * OpenShift Airgap Architect - Operator Cross-Minor Intent / Selection Reconciliation
 *
 * Three distinct concepts must not be conflated (see docs/DESIGN_SYSTEM.md):
 *
 *   intent            — the packages and quick picks the user asked for.
 *   resolved metadata — catalog image, default channel, scan results for ONE minor.
 *   active selection  — what the UI presents as currently selected, which is only
 *                       meaningful once intent has been reconciled against the
 *                       resolved metadata of the *currently locked* minor.
 *
 * When the locked target minor changes, resolved metadata is invalidated and the
 * active selection must stop presenting as active. Intent is preserved as
 * `operators.pendingScenarios` / unresolved `operators.selected` entries and is
 * reconciled back into an active selection after a successful current-minor scan.
 *
 * Pure and side-effect free so the lifecycle is deterministically testable.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { parseMinorVersionCore } from './openShiftMinor.js';

const CATALOG_KEYS = ['redhat', 'certified', 'community'];

/** Operator index images for a minor. Single source of truth for catalog tags. */
export function catalogImagesForMinor(minor) {
  return {
    redhat: `registry.redhat.io/redhat/redhat-operator-index:v${minor}`,
    certified: `registry.redhat.io/redhat/certified-operator-index:v${minor}`,
    community: `registry.redhat.io/redhat/community-operator-index:v${minor}`,
  };
}

/** True when the operator entry still carries metadata resolved from a catalog scan. */
export function isOperatorResolved(op) {
  return Boolean(op && op.catalogImage && op.defaultChannel);
}

/**
 * The minor that the currently stored operator metadata was resolved against.
 * Prefers the recorded scan minor, then falls back to the catalog image tag so a
 * state written before `operators.version` existed is still classified correctly.
 *
 * @returns {string|null}
 */
export function getResolvedOperatorMinor(operators) {
  const recorded = parseMinorVersionCore(operators?.version || '');
  if (recorded) return recorded;
  for (const op of operators?.selected || []) {
    const match = String(op?.catalogImage || '').match(/:v(\d+\.\d+)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * True when stored operator metadata belongs to a different minor than the one
 * now locked, i.e. the active selection can no longer be trusted as current.
 */
export function hasCrossMinorOperatorState(operators, nextMinor) {
  const resolved = getResolvedOperatorMinor(operators);
  const target = parseMinorVersionCore(nextMinor || '');
  return Boolean(resolved && target && resolved !== target);
}

/**
 * Strip one operator entry back to user intent, dropping everything that was
 * resolved against the old minor's catalogs.
 *
 * `displayName` is kept: it is a human label, not catalog/channel/version
 * metadata, and keeping it means preserved intent stays readable in the UI.
 */
function toIntentOnly(op) {
  return {
    name: op.name,
    id: op.id,
    sources: op.sources,
    ...(op.displayName ? { displayName: op.displayName } : {}),
  };
}

/**
 * Shape operator state down to intent, unconditionally. Callers that have
 * already established a cross-minor change (by their own authoritative signal)
 * use this directly; others go through computeOperatorMinorInvalidation.
 *
 * @param {Object} operators - current `state.operators`
 * @returns {Object} replacement `state.operators`
 */
export function buildInvalidatedOperatorState(operators) {
  const priorActiveScenarios = operators?.scenarios || {};
  const priorPendingScenarios = operators?.pendingScenarios || {};

  return {
    // Intent only — the generator ignores entries without a catalog image, and
    // the UI must not present them as a reconciled current selection.
    selected: (operators?.selected || []).map(toIntentOnly),
    // Active selection presentation is cleared...
    scenarios: {},
    // ...but the quick-pick intent behind it is retained for reconciliation.
    pendingScenarios: { ...priorPendingScenarios, ...priorActiveScenarios },
    scenarioAdded: operators?.scenarioAdded,
    catalogs: {},
    version: null,
    scanJobs: {},
    cachedAt: null,
    stale: true,
    fastMode: operators?.fastMode,
  };
}

/**
 * Compute the operator state patch for a confirmed change of locked target minor.
 *
 * Returns null when there is nothing cross-minor to invalidate, so callers can
 * leave same-minor state untouched.
 *
 * @param {Object} operators - current `state.operators`
 * @param {string} nextMinor - the newly locked target minor
 * @returns {Object|null} replacement `state.operators`
 */
export function computeOperatorMinorInvalidation(operators, nextMinor) {
  if (!hasCrossMinorOperatorState(operators, nextMinor)) return null;
  return buildInvalidatedOperatorState(operators);
}

/**
 * Reconcile preserved intent against freshly scanned catalogs for the locked minor.
 *
 * Unresolved intent stays in `selected` (the generator already omits it) and the
 * owning quick pick stays pending, so an unavailable package surfaces as a
 * conflict instead of silently disappearing or silently re-activating.
 *
 * Returns null when there is nothing to reconcile.
 *
 * @param {Object} operators - current `state.operators`
 * @param {Object} catalogs  - normalized `{ redhat, certified, community }` lists
 * @param {string} minor     - the locked target minor the catalogs belong to
 * @returns {{selected:Array, scenarios:Object, pendingScenarios:Object, unresolvedIntent:string[]}|null}
 */
export function reconcileOperatorsForMinor(operators, catalogs, minor) {
  const target = parseMinorVersionCore(minor || '');
  if (!target) return null;

  const selected = operators?.selected || [];
  const pendingScenarios = operators?.pendingScenarios || {};
  const hasUnresolved = selected.some((op) => !isOperatorResolved(op));
  const hasPending = Object.keys(pendingScenarios).length > 0;
  if (!hasUnresolved && !hasPending) return null;

  const images = catalogImagesForMinor(target);
  const byName = new Map();
  for (const key of CATALOG_KEYS) {
    for (const entry of catalogs?.[key] || []) {
      const name = String(entry?.name || '').toLowerCase();
      if (name && !byName.has(name)) byName.set(name, { entry, key });
    }
  }

  const unresolvedIntent = [];
  const nextSelected = selected.map((op) => {
    if (isOperatorResolved(op)) return op;
    const hit = byName.get(String(op.name || '').toLowerCase());
    if (!hit) {
      unresolvedIntent.push(op.name);
      return op;
    }
    return {
      ...hit.entry,
      ...op,
      // Resolved against the now-current minor.
      displayName: hit.entry.displayName || op.displayName,
      defaultChannel: hit.entry.defaultChannel,
      catalogImage: images[hit.key],
    };
  });

  const resolvedNames = new Set(
    nextSelected.filter(isOperatorResolved).map((op) => String(op.name || '').toLowerCase())
  );

  const nextScenarios = { ...(operators?.scenarios || {}) };
  const nextPending = {};
  for (const scenarioId of Object.keys(pendingScenarios)) {
    const members = nextSelected.filter((op) => (op.sources || []).includes(scenarioId));
    if (members.length === 0) continue; // nothing left to reconcile — drop the pending marker
    const allResolved = members.every((op) => resolvedNames.has(String(op.name || '').toLowerCase()));
    if (allResolved) {
      nextScenarios[scenarioId] = true;
    } else {
      nextPending[scenarioId] = true;
    }
  }

  return {
    selected: nextSelected,
    scenarios: nextScenarios,
    pendingScenarios: nextPending,
    unresolvedIntent,
  };
}
