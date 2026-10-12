/**
 * Frontend adapter for the target-cluster architecture-support matrix (D3 / DOC-156).
 *
 * Loading and support gating live here; the decision logic lives in
 * `shared/archSupport.js` and is shared with any other consumer. This module
 * holds no matrix of its own — see the canonical data under
 * `data/arch-support/<minor>.json`.
 *
 * WHAT THIS REPLACED
 *
 * `BlueprintStep.jsx` carried `PLATFORM_ARCH_SUPPORT`, a platform-keyed constant
 * with no install method, no OpenShift minor, no reason and no citation, behind
 * an `|| archOptions.map(...)` fallback that opened all four architectures for
 * any platform it did not recognise. It also claimed support the documentation
 * does not: vSphere aarch64, AWS GovCloud aarch64 and bare-metal ppc64le/s390x
 * appear in no supported minor's platform book.
 *
 * SUPPORT GATING
 *
 * The projection glob is eager and matches every minor present on disk,
 * including minors the product does not support. Reads are gated on
 * `SUPPORTED_MINORS` *before* the dataset is consulted, so an unsupported minor
 * resolves closed even though its file is bundled — the same contract
 * `catalogPaths.js` and `docsIndexResolver.js` apply to their own data.
 */

import {
  ARCHITECTURES,
  listArchitectureSupport,
  listArchitectureSupportAcrossMinors,
  resolveArchitectureSupport,
} from "../../shared/archSupport.js";
import { SUPPORTED_MINORS } from "./shared/versionPolicy.js";
import { getOpenShiftMinorFromState } from "./shared/openShiftMinor.js";
import { getScenarioId } from "../../shared/scenarioId.js";
import {
  METHODS_BY_PLATFORM,
  isMethodValidForPlatform,
  scenarioIdsForPlatform,
} from "../../shared/installMethods.js";

const projections = import.meta.glob("./data/arch-support/*.json", { eager: true });

/**
 * minor -> projection document, for SUPPORTED minors only.
 *
 * Built once at module scope. Filtering here rather than at each call site means
 * there is a single place an unsupported minor could become readable, and it is
 * the supported-minor list itself.
 */
const dataset = Object.freeze(
  Object.fromEntries(
    Object.entries(projections)
      .map(([file, mod]) => [file.replace("./data/arch-support/", "").replace(".json", ""), mod.default ?? mod])
      .filter(([minor]) => SUPPORTED_MINORS.includes(minor))
  )
);

/** Minors with a loadable, supported matrix. Sorted for determinism. */
export function availableArchSupportMinors() {
  return Object.keys(dataset).sort();
}

/** True when this minor has a matrix AND is supported. */
export function hasArchSupportForMinor(minor) {
  return Object.prototype.hasOwnProperty.call(dataset, minor);
}

/**
 * Resolve one architecture for a minor + scenario.
 * An unsupported minor resolves closed, exactly as if it had no data.
 */
export function resolveArchSupport({ minor, scenarioId, architecture }) {
  return resolveArchitectureSupport({ dataset, minor, scenarioId, architecture });
}

/**
 * Every architecture for a scenario, resolved against application state.
 *
 * When the user has not yet chosen a release, `getOpenShiftMinorFromState`
 * returns null and there is no minor to decide against. Rather than defaulting
 * to one — which would let a single minor's semantics stand in for an
 * undetermined choice — the answer is intersected across the supported minors:
 * an architecture is offered only if every supported minor offers it, and the
 * exact per-minor answer takes over the moment a release is locked.
 *
 * @param {object} state application state
 * @param {string|null} scenarioId from getScenarioId(platform, method)
 * @returns {{cells: Array, minor: string|null, resolvedFromState: boolean}}
 */
export function listArchSupportForState(state, scenarioId) {
  const minor = getOpenShiftMinorFromState(state);

  if (!scenarioId) {
    // Not a modelled platform x install-method combination: nothing to offer.
    return {
      minor,
      resolvedFromState: Boolean(minor),
      cells: ARCHITECTURES.map((architecture) => ({
        architecture,
        disposition: "unknown",
        offered: false,
        unresolved: true,
        unresolvedCause: "unknown-scenario",
        summary: "Choose a platform and installation method before selecting a cluster architecture.",
      })),
    };
  }

  if (minor && SUPPORTED_MINORS.includes(minor)) {
    return {
      minor,
      resolvedFromState: true,
      cells: listArchitectureSupport({ dataset, minor, scenarioId }),
    };
  }

  if (minor && !SUPPORTED_MINORS.includes(minor)) {
    // A selected-but-unsupported minor must not borrow a supported minor's
    // answer. It is closed, and it says so.
    return {
      minor,
      resolvedFromState: true,
      cells: ARCHITECTURES.map((architecture) => ({
        architecture,
        disposition: "unknown",
        offered: false,
        unresolved: true,
        unresolvedCause: "unknown-minor",
        summary: `OpenShift ${minor} is not supported by this version of OpenShift Airgap Architect.`,
      })),
    };
  }

  return {
    minor: null,
    resolvedFromState: false,
    cells: listArchitectureSupportAcrossMinors({
      dataset,
      minors: SUPPORTED_MINORS,
      scenarioId,
    }),
  };
}

/**
 * Architecture support for a PLATFORM, before an installation method is settled.
 *
 * The Blueprint step asks for the target architecture before the Methodology
 * step exists, so it cannot key the matrix on a method the user has not chosen.
 * Keying it on whatever method happened to be in state produced the reported
 * regression: the cold-start default is "Agent-Based Installer", which Nutanix,
 * AWS GovCloud, Azure Government and IBM Cloud do not offer, so
 * `getScenarioId` returned null and every architecture rendered greyed out —
 * including x86_64, which every one of those platforms documents as supported.
 *
 * This invents no support semantics. It asks the SAME matrix the same question
 * once per method the platform actually offers, and intersects: an architecture
 * is offered here only if every install method for the platform offers it.
 * Intersecting rather than unioning means a later methodology choice can only
 * ever keep an architecture available, never retract one the user already
 * picked — so the UI, state reconciliation and the generator cannot disagree.
 *
 * @returns the same shape as `listArchSupportForState`
 */
export function listArchSupportForPlatform(state, platform) {
  const scenarioIds = scenarioIdsForPlatform(platform);
  if (scenarioIds.length === 0) {
    // Unmodelled platform: unchanged fail-closed behaviour.
    return listArchSupportForState(state, null);
  }

  const perScenario = scenarioIds.map((id) => listArchSupportForState(state, id));
  const first = perScenario[0];

  return {
    ...first,
    cells: first.cells.map((cell, i) => {
      const peers = perScenario.map((r) => r.cells[i]);
      const offered = peers.every((c) => c.offered);
      if (offered) return { ...cell, offered: true };
      // Report the first method that closes it, so the tooltip still names a
      // real reason from the matrix rather than a synthesised one.
      const closing = peers.find((c) => !c.offered) ?? cell;
      return { ...closing, offered: false };
    }),
  };
}

/**
 * Architecture support for the Blueprint step.
 *
 * Uses the exact scenario when the methodology in state is valid for the
 * platform, and falls back to the platform-level answer when it is not —
 * which is the normal case on Blueprint, since Methodology comes later.
 */
export function listArchSupportForBlueprint(state) {
  const platform = state?.blueprint?.platform;
  const method = state?.methodology?.method;
  if (isMethodValidForPlatform(platform, method)) {
    return listArchSupportForState(state, getScenarioId(platform, method));
  }
  return listArchSupportForPlatform(state, platform);
}

/**
 * Every scenarioId the product's CURRENT platform x installation-method surface
 * can reach.
 *
 * Derived, never listed: the platforms come from `METHODS_BY_PLATFORM`, the
 * methods from the same table, and the ids from `getScenarioId` via
 * `scenarioIdsForPlatform`. Onboarding a platform or a method therefore widens
 * this set with no edit here. Note this is deliberately the REACHABLE surface,
 * not `allScenarioIds()`: `azure-government-upi` is modelled in
 * `shared/scenarioId.js` but Azure Government offers only IPI in the UI, so no
 * user can select it and it must not vote on what the UI renders.
 */
export function modelledScenarioIds() {
  return [...new Set(Object.keys(METHODS_BY_PLATFORM).flatMap((platform) => scenarioIdsForPlatform(platform)))];
}

/**
 * Which architectures may be RENDERED AT ALL — the "does this product have any
 * scenario for it" question, as distinct from "is it available right now".
 *
 * TWO DIFFERENT QUESTIONS, DELIBERATELY NOT MERGED
 *
 *   1. Available for the CURRENTLY SELECTED scenario. Answered per-cell by
 *      `listArchSupportForBlueprint`. `aarch64` on vSphere is closed here and
 *      still renders, disabled, with the matrix's own reason: the user can
 *      reach it by changing platform, so showing it is informative.
 *   2. Reachable by ANY currently supported scenario. Answered here. An
 *      architecture no supported minor offers on any modelled platform x
 *      method pair has no state the user could put the wizard into that would
 *      enable it, so a permanently disabled control is noise, not information.
 *
 * The rule is purely a fold over the SAME canonical authority every other
 * answer comes from (`data/arch-support/<minor>.json`, projected into
 * `frontend/src/data/arch-support/`): an architecture is renderable iff at
 * least one supported minor offers it for at least one reachable scenario.
 * There is no architecture name in this function and none in the component.
 * The moment a matrix cell for, say, `ppc64le` becomes `supported` on a
 * modelled scenario, the control reappears — data only, no UI code change.
 *
 * This does NOT touch upstream support evidence. `upstreamSupport`,
 * `upstreamReason` and `upstreamSource` on every hidden ppc64le/s390x cell are
 * untouched, and `scripts/validate-arch-support.js` still requires all four
 * architectures in all twelve rows of all three minors.
 *
 * @param {object} args
 * @param {Record<string, object>} args.dataset minor -> arch-support document
 * @param {string[]} args.minors minors to consider renderable-from
 * @param {string[]} [args.scenarioIds] reachable surface; defaults to the real one
 * @returns {string[]} subset of ARCHITECTURES, in display order
 */
export function computeRenderableArchitectures({ dataset, minors, scenarioIds = modelledScenarioIds() }) {
  const list = Array.isArray(minors) ? minors : [];
  return ARCHITECTURES.filter((architecture) =>
    list.some((minor) =>
      scenarioIds.some(
        (scenarioId) => resolveArchitectureSupport({ dataset, minor, scenarioId, architecture }).offered
      )
    )
  );
}

/**
 * `computeRenderableArchitectures` bound to the real, support-gated dataset and
 * the real supported-minor list. This is what the UI calls.
 */
export function renderableArchitectures() {
  return computeRenderableArchitectures({ dataset, minors: SUPPORTED_MINORS });
}

/** Architecture values currently offered for this state + scenario. */
export function offeredArchSupportForState(state, scenarioId) {
  return listArchSupportForState(state, scenarioId)
    .cells.filter((c) => c.offered)
    .map((c) => c.architecture);
}

/** Test seam: the gated dataset, so tests can assert what is and is not loadable. */
export function __archSupportDatasetForTests() {
  return dataset;
}

export { ARCHITECTURES };
