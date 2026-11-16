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
import { scenarios as QUICK_PICKS, resolveScenarioPicks } from './operatorQuickPicks.js';

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
 * Two distinct passes, in this order:
 *
 *   1. RE-RESOLUTION of metadata — catalog image and default channel for every
 *      entry that lost them when the minor changed.
 *   2. MEMBERSHIP RE-EVALUATION of every Quick Pick — the set difference
 *      between what the pick owns today and what the DESTINATION minor's row
 *      actually names.
 *
 * Pass 2 did not exist. A Quick Pick is a version-aware preset, but
 * reconciliation only ever re-stamped metadata on the entries that were
 * already selected, so "OpenShift AI" carried its 4.22 membership into 4.20
 * (missing the 4.20-only `rhods-prometheus-operator` until the user toggled
 * the pick off and on) and carried its 4.20 membership into 4.22 (parking that
 * now-nonexistent package as permanently unresolvable intent, with a conflict
 * banner and a pick stuck in `pendingScenarios`).
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
 * @returns {{selected:Array, scenarios:Object, pendingScenarios:Object, scenarioAdded:Object, unresolvedIntent:string[]}|null}
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

  /* ---- pass 2: Quick Pick membership against the DESTINATION minor ------ */

  const nextScenarioAdded = { ...(operators?.scenarioAdded || {}) };
  /** Picks that must stay pending because the destination row names a package the destination catalogs do not carry. */
  const forcedPending = new Set();
  const missingForPicks = [];
  let working = nextSelected;

  const pruneScenarioAdded = (opId, scenarioId) => {
    const nextAdded = { ...(nextScenarioAdded[opId] || {}) };
    delete nextAdded[scenarioId];
    if (Object.keys(nextAdded).length === 0) delete nextScenarioAdded[opId];
    else nextScenarioAdded[opId] = nextAdded;
  };

  // Active picks are included as well as pending ones: membership is a property
  // of the pick, not of how it currently presents.
  const pickIds = Object.keys({ ...(operators?.scenarios || {}), ...pendingScenarios });
  for (const scenarioId of pickIds) {
    const definition = QUICK_PICKS.find((s) => s.id === scenarioId);
    // An id with no definition carries no membership we are entitled to infer.
    if (!definition) continue;
    // Fail closed exactly as the UI does: a version-aware pick with no row for
    // this minor is undefined, not "keep whatever you had".
    const picks = resolveScenarioPicks(definition, target);
    if (!picks) continue;

    /** lowercase package name -> `{ name, catalogId }` as the row declares it */
    const wanted = new Map();
    for (const [catalogId, names] of Object.entries(picks)) {
      for (const name of names || []) {
        wanted.set(String(name).toLowerCase(), { name: String(name), catalogId });
      }
    }

    // REMOVE: owned by this pick, but not a member at the destination minor.
    // The ownership rule is `removeScenarioOperators`' rule verbatim, so an
    // operator the human also picked manually, or that another active pick
    // still owns, is retained rather than deleted.
    working = working
      .map((op) => {
        const priorSources = op.sources || [];
        if (!priorSources.includes(scenarioId)) return op;
        if (wanted.has(String(op.name || '').toLowerCase())) return op;
        const sources = priorSources.filter((source) => source !== scenarioId);
        const addedByScenario = Boolean(nextScenarioAdded[op.id]?.[scenarioId]);
        const removeEntirely = addedByScenario && sources.length === 0;
        pruneScenarioAdded(op.id, scenarioId);
        return removeEntirely ? null : { ...op, sources };
      })
      .filter(Boolean);

    // ADD: a member at the destination minor that no entry carries this pick's
    // provenance for. Mirrors `applyScenario`.
    for (const [lowerName, { name: declaredName }] of wanted) {
      const existingIndex = working.findIndex(
        (op) => String(op.name || '').toLowerCase() === lowerName
      );
      if (existingIndex >= 0) {
        const existing = working[existingIndex];
        if ((existing.sources || []).includes(scenarioId)) continue;
        const sources = new Set(
          existing.sources && existing.sources.length ? existing.sources : ['manual']
        );
        sources.add(scenarioId);
        working = working.map((op, i) => (i === existingIndex ? { ...op, sources: Array.from(sources) } : op));
        nextScenarioAdded[existing.id] = { ...(nextScenarioAdded[existing.id] || {}), [scenarioId]: true };
        continue;
      }
      const hit = byName.get(lowerName);
      if (!hit) {
        // Fail closed: no invented entry, no invented channel. The pick stays
        // visibly pending until the package really is resolvable.
        missingForPicks.push(declaredName);
        forcedPending.add(scenarioId);
        continue;
      }
      working = [
        ...working,
        {
          ...hit.entry,
          catalogImage: images[hit.key],
          sources: [scenarioId],
        },
      ];
      nextScenarioAdded[hit.entry.id] = {
        ...(nextScenarioAdded[hit.entry.id] || {}),
        [scenarioId]: true,
      };
    }
  }

  const resolvedNames = new Set(
    working.filter(isOperatorResolved).map((op) => String(op.name || '').toLowerCase())
  );

  const nextScenarios = { ...(operators?.scenarios || {}) };
  const nextPending = {};
  for (const scenarioId of Object.keys(pendingScenarios)) {
    const members = working.filter((op) => (op.sources || []).includes(scenarioId));
    // Nothing left to reconcile — drop the pending marker. A pick blocked only
    // by a package missing from the destination catalogs is NOT "nothing left".
    if (members.length === 0 && !forcedPending.has(scenarioId)) continue;
    const allResolved =
      !forcedPending.has(scenarioId) &&
      members.every((op) => resolvedNames.has(String(op.name || '').toLowerCase()));
    if (allResolved) {
      nextScenarios[scenarioId] = true;
    } else {
      nextPending[scenarioId] = true;
    }
  }
  // An ACTIVE pick whose destination row names an unavailable package must stop
  // presenting as active rather than quietly under-delivering.
  for (const scenarioId of forcedPending) {
    if (nextScenarios[scenarioId]) {
      delete nextScenarios[scenarioId];
      nextPending[scenarioId] = true;
    }
  }

  // Only report intent that is still carried by a selected entry. A package the
  // destination row no longer names was removed above, so it is no longer a
  // conflict — it is simply not part of this minor's preset.
  const stillSelectedUnresolved = new Set(
    working.filter((op) => !isOperatorResolved(op)).map((op) => String(op.name || ''))
  );
  const finalUnresolvedIntent = [
    ...new Set([
      ...unresolvedIntent.filter((name) => stillSelectedUnresolved.has(String(name))),
      ...missingForPicks,
    ]),
  ];

  return {
    selected: working,
    scenarios: nextScenarios,
    pendingScenarios: nextPending,
    scenarioAdded: nextScenarioAdded,
    unresolvedIntent: finalUnresolvedIntent,
  };
}
