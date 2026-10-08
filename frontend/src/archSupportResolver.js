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
