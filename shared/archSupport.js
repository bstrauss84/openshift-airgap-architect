/**
 * Target-cluster architecture support resolver (D3 / DOC-156).
 *
 * THE AXIS THIS OWNS, AND THE TWO IT DOES NOT
 *
 * This module answers exactly one question: *may this OpenShift minor, on this
 * scenario (platform x install method), run its cluster nodes on this CPU
 * architecture?* That is the **target-cluster** axis.
 *
 * It is NOT:
 *   - the **export/download binary** axis — which `openshift-install` / `oc` /
 *     `oc-mirror` build the operator downloads. Owned by ReviewStep.jsx and
 *     backend/src/openshiftInstaller.js. Red Hat publishes
 *     `openshift-install-rhel9-arm64.tar.gz`, so the ARM64 RHEL 9 FIPS download
 *     option is correct and must not be removed on the strength of a
 *     cluster-node FIPS statement.
 *   - the **Architect runtime** axis — the architecture this application's own
 *     container runs on. Owned by backend/src/ocMirrorRuntime.js.
 *
 * Conflating them is an error this onboarding already made once and corrected.
 *
 * WHY A RESOLVER RATHER THAN A TABLE
 *
 * The shape this replaces was a platform-keyed constant in BlueprintStep.jsx:
 * no install method, no OpenShift minor, no reason, no citation, and an
 * `|| archOptions.map(...)` fallback that opened ALL FOUR architectures for any
 * platform it did not recognise. It also asserted more than the documentation
 * supports — vSphere aarch64, AWS GovCloud aarch64 and bare-metal
 * ppc64le/s390x are documented by no supported minor's platform book.
 *
 * This module holds NO matrix of its own. Every answer comes from
 * `data/arch-support/<minor>.json`, which carries a disposition, a reason, a
 * short UI summary and per-cell provenance for all 48 cells per minor.
 *
 * FAIL CLOSED
 *
 * An unknown minor, an unmodelled scenario, an unrecognised architecture or a
 * malformed version all resolve to `offered: false` with `unresolved: true`.
 * There is deliberately no fallback to another minor, no platform-only lookup
 * that discards the install method, and no inference for a future minor: those
 * are precisely the behaviours that would let a newly onboarded minor silently
 * inherit an older minor's support claims.
 *
 * Pure: the dataset is injected. Callers own loading (and therefore bundling).
 */

import { getMinorVersion } from "./versionUtils.js";

/** The four target-cluster architectures the product models, in display order. */
const ARCHITECTURES = Object.freeze(["x86_64", "aarch64", "ppc64le", "s390x"]);

/** Dispositions a cell may carry. Only `supported` is ever offered. */
const DISPOSITIONS = Object.freeze(["supported", "locked", "hidden", "unknown"]);

/** Why a lookup could not be resolved. Surfaced so callers can distinguish causes. */
const UNRESOLVED = Object.freeze({
  MALFORMED_VERSION: "malformed-version",
  UNKNOWN_MINOR: "unknown-minor",
  UNKNOWN_SCENARIO: "unknown-scenario",
  UNKNOWN_ARCHITECTURE: "unknown-architecture",
  MISSING_CELL: "missing-cell",
});

class ArchitectureSupportError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "ArchitectureSupportError";
    this.code = "ARCH_SUPPORT_UNRESOLVED";
    this.unresolvedCause = cause;
  }
}

/** A closed answer. Never offered, and it says why. */
function closed(cause, summary, extra = {}) {
  return Object.freeze({
    disposition: "unknown",
    offered: false,
    unresolved: true,
    unresolvedCause: cause,
    summary,
    reason: summary,
    provenance: [],
    ...extra,
  });
}

/**
 * Normalize a version to its minor, without throwing.
 * @param {string} version e.g. "4.21", "4.21.35", "v4.21.0"
 * @returns {string|null} the minor, or null when the input is not a version
 */
function toMinor(version) {
  if (typeof version !== "string" || !version.trim()) return null;
  try {
    return getMinorVersion(version);
  } catch {
    return null;
  }
}

/**
 * Resolve one cell.
 *
 * @param {object} args
 * @param {Record<string, object>} args.dataset minor -> parsed arch-support document
 * @param {string} args.minor OpenShift version or minor
 * @param {string} args.scenarioId e.g. "bare-metal-ipi"
 * @param {string} args.architecture e.g. "aarch64"
 * @returns {{disposition: string, offered: boolean, summary: string, reason: string,
 *            provenance: Array, unresolved?: boolean, unresolvedCause?: string}}
 */
function resolveArchitectureSupport({ dataset, minor, scenarioId, architecture }) {
  const resolvedMinor = toMinor(minor);
  if (!resolvedMinor) {
    return closed(UNRESOLVED.MALFORMED_VERSION, "Select an OpenShift release before choosing a cluster architecture.");
  }
  if (!ARCHITECTURES.includes(architecture)) {
    return closed(
      UNRESOLVED.UNKNOWN_ARCHITECTURE,
      `"${architecture}" is not a target-cluster architecture this product models.`
    );
  }

  const doc = dataset && Object.prototype.hasOwnProperty.call(dataset, resolvedMinor) ? dataset[resolvedMinor] : null;
  if (!doc) {
    // No fallback to another minor. A minor with no matrix has no answer.
    return closed(
      UNRESOLVED.UNKNOWN_MINOR,
      `No architecture-support matrix is available for OpenShift ${resolvedMinor}.`
    );
  }

  const row = (doc.matrix || []).find((r) => r.scenarioId === scenarioId);
  if (!row) {
    return closed(
      UNRESOLVED.UNKNOWN_SCENARIO,
      `OpenShift ${resolvedMinor} has no architecture-support row for "${scenarioId}".`
    );
  }

  const cell = row.architectures && row.architectures[architecture];
  if (!cell || !DISPOSITIONS.includes(cell.disposition)) {
    return closed(
      UNRESOLVED.MISSING_CELL,
      `OpenShift ${resolvedMinor} ${scenarioId} carries no decided cell for ${architecture}.`
    );
  }

  // `offered` is authored in the data and validated by scripts/validate-arch-support.js,
  // which rejects any cell where it disagrees with the disposition. It is recomputed
  // here anyway so a hand-edited file can never open a non-supported cell at runtime.
  return Object.freeze({
    disposition: cell.disposition,
    offered: cell.disposition === "supported",
    summary: cell.summary,
    reason: cell.reason ?? cell.summary,
    provenance: cell.provenance ?? [],
    minor: resolvedMinor,
    scenarioId,
    architecture,
  });
}

/**
 * Resolve every architecture for one minor + scenario, in display order.
 * @returns {Array<object>} one resolved cell per entry of ARCHITECTURES
 */
function listArchitectureSupport({ dataset, minor, scenarioId }) {
  return ARCHITECTURES.map((architecture) =>
    resolveArchitectureSupport({ dataset, minor, scenarioId, architecture })
  );
}

/**
 * Resolve across several minors at once, offering an architecture only when
 * EVERY named minor offers it.
 *
 * This exists for the one real case where the product must answer before the
 * user has committed to a release: the Blueprint step presents platform,
 * architecture and release together, so architecture is reachable while
 * `version.selectedMinor` is still null. Intersecting across the currently
 * supported minors is strictly more conservative than picking one of them, and
 * — unlike a default — it cannot quietly adopt a single minor's semantics. An
 * architecture supported by only some supported minors stays closed until the
 * user picks one, at which point the exact per-minor answer applies.
 *
 * @param {object} args
 * @param {Record<string, object>} args.dataset
 * @param {string[]} args.minors minors to intersect; empty or unknown => closed
 * @param {string} args.scenarioId
 */
function listArchitectureSupportAcrossMinors({ dataset, minors, scenarioId }) {
  const list = Array.isArray(minors) ? minors.filter((m) => toMinor(m)) : [];
  if (list.length === 0) {
    return ARCHITECTURES.map(() =>
      closed(UNRESOLVED.UNKNOWN_MINOR, "No OpenShift minor is available to resolve architecture support against.")
    );
  }
  return ARCHITECTURES.map((architecture) => {
    const perMinor = list.map((m) => resolveArchitectureSupport({ dataset, minor: m, scenarioId, architecture }));
    const blocked = perMinor.find((c) => !c.offered);
    if (!blocked) {
      // Every minor offers it. Report the first, with the agreeing set recorded.
      return Object.freeze({ ...perMinor[0], minor: null, agreedAcrossMinors: list.slice() });
    }
    return Object.freeze({ ...blocked, agreedAcrossMinors: null });
  });
}

/**
 * Strict variant for callers that must not proceed on an unsupported choice.
 * @throws {ArchitectureSupportError}
 */
function assertArchitectureSupported({ dataset, minor, scenarioId, architecture }) {
  const cell = resolveArchitectureSupport({ dataset, minor, scenarioId, architecture });
  if (!cell.offered) {
    throw new ArchitectureSupportError(
      `Architecture "${architecture}" is not supported for ${scenarioId} on OpenShift ${minor}: ${cell.summary}`,
      cell.unresolvedCause ?? cell.disposition
    );
  }
  return cell;
}

/** The architectures offered for a minor + scenario. Convenience for UI gating. */
function offeredArchitectures({ dataset, minor, scenarioId }) {
  return listArchitectureSupport({ dataset, minor, scenarioId })
    .filter((c) => c.offered)
    .map((c) => c.architecture);
}

export {
  ARCHITECTURES,
  DISPOSITIONS,
  UNRESOLVED,
  ArchitectureSupportError,
  resolveArchitectureSupport,
  listArchitectureSupport,
  listArchitectureSupportAcrossMinors,
  assertArchitectureSupported,
  offeredArchitectures,
};
