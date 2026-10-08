/**
 * Tranche 6 §13 — the version transition matrix across all three supported minors.
 *
 * This is the certification that could not be complete before the flip: with
 * only 4.20 and 4.21 supported there were two forward edges and one backward
 * edge. With 4.22 supported there are six, and the 4.22 edges are the ones that
 * matter, because 4.22 is the only minor that carries a field the others do not.
 *
 * Transitions go through the real `computeReleaseTransition` flow — the same
 * function `App.jsx` calls — not through hand-written state rewriting. Every
 * downstream surface the patch is supposed to invalidate is then checked at the
 * destination minor using the real resolvers.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { computeReleaseTransition, TRANSITION_ERRORS } from "../src/shared/versionReleaseTransition.js";
import { SUPPORTED_MINORS, isSupportedMinor, getTrustBundlePolicySupport } from "../src/shared/versionPolicy.js";
import { getCatalogForScenario, getAvailableCatalogScenarios, UnsupportedVersionError } from "../src/catalogPaths.js";
import { getDocsIndexForState } from "../src/docsIndexResolver.js";
import { offeredArchSupportForState, hasArchSupportForMinor } from "../src/archSupportResolver.js";
import { hasCrossMinorOperatorState, getResolvedOperatorMinor } from "../src/shared/operatorMinorReconciliation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, "..", "src", "steps", "OperatorsStep.jsx"), "utf8");

const TS = 1_760_000_000_000;
const PATCH = { "4.20": "4.20.40", "4.21": "4.21.35", "4.22": "4.22.16" };

/** A locked, confirmed state at `minor`, with resolved operator metadata. */
function lockedState(minor, overrides = {}) {
  return {
    _schemaVersion: 3,
    version: {
      _schemaVersion: 3,
      selectedMinor: minor,
      selectedPatch: PATCH[minor],
      selectedChannel: `stable-${minor}`,
      locked: true,
      lockTimestamp: TS,
      confirmedByUser: true,
    },
    release: { channel: minor, patchVersion: PATCH[minor], confirmed: true, followLatestMinor: false },
    blueprint: { platform: "Bare Metal", arch: "x86_64", clusterName: "t", baseDomain: "example.com", confirmed: true },
    methodology: { method: "IPI" },
    hostInventory: { nodes: [], provisioningNetwork: "Managed" },
    operators: {
      version: minor,
      stale: false,
      selected: [
        { id: "op-1", name: "cluster-logging", catalog: "redhat", catalogImage: `registry.redhat.io/redhat/redhat-operator-index:v${minor}`, defaultChannel: "stable", sources: ["logging"] },
      ],
      scenarios: { logging: true },
      catalogs: { redhat: [{ id: "op-1", name: "cluster-logging", defaultChannel: "stable" }] },
    },
    ...overrides,
  };
}

/** Apply a transition patch the way the app does: shallow-merge the patch keys. */
function applyPatch(state, patch) {
  return { ...state, ...patch };
}

const FORWARD = [["4.20", "4.21"], ["4.20", "4.22"], ["4.21", "4.22"]];
const BACKWARD = [["4.22", "4.21"], ["4.22", "4.20"], ["4.21", "4.20"]];
const ALL_EDGES = [...FORWARD, ...BACKWARD];

describe("T6 §13 — the matrix is complete for three supported minors", () => {
  it("supported minors are exactly 4.20, 4.21, 4.22", () => {
    expect([...SUPPORTED_MINORS]).toEqual(["4.20", "4.21", "4.22"]);
  });

  it("every ordered pair of distinct supported minors is covered", () => {
    const expected = [];
    for (const a of SUPPORTED_MINORS) for (const b of SUPPORTED_MINORS) if (a !== b) expected.push(`${a}->${b}`);
    expect(ALL_EDGES.map(([a, b]) => `${a}->${b}`).sort()).toEqual(expected.sort());
    expect(ALL_EDGES).toHaveLength(6);
  });
});

describe.each(ALL_EDGES)("T6 §13 — transition %s -> %s", (from, to) => {
  const before = lockedState(from);
  const result = computeReleaseTransition(before, to, { timestamp: TS, patch: PATCH[to] });
  const after = result.ok ? applyPatch(before, result.patch) : null;

  it("the transition is accepted", () => {
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it("selected minor, patch and channel all move to the destination", () => {
    expect(after.version.selectedMinor).toBe(to);
    expect(after.version.selectedPatch).toBe(PATCH[to]);
    expect(after.version.selectedChannel).toBe(`stable-${to}`);
    expect(after.release.channel).toBe(to);
    expect(after.release.patchVersion).toBe(PATCH[to]);
  });

  it("the destination is left UNLOCKED and unconfirmed — relock is a deliberate act", () => {
    expect(after.version.locked).toBe(false);
    expect(after.version.lockTimestamp).toBeNull();
    expect(after.version.confirmedByUser).toBe(false);
    expect(after.release.confirmed).toBe(false);
  });

  it("no trace of the source minor survives in the version or release block", () => {
    const blob = JSON.stringify({ version: after.version, release: after.release });
    expect(blob).not.toContain(from);
  });

  it("the input state is not mutated", () => {
    expect(before.version.selectedMinor).toBe(from);
    expect(before.version.locked).toBe(true);
  });

  it("catalogs resolve at the destination and carry destination rows", () => {
    const params = getCatalogForScenario("bare-metal-ipi", to);
    expect(Array.isArray(params)).toBe(true);
    expect(params.length).toBeGreaterThan(0);
  });

  it("the docs index resolves at the destination", () => {
    expect(getDocsIndexForState(after)).not.toBeNull();
  });

  it("architecture support is re-resolved at the destination", () => {
    expect(hasArchSupportForMinor(to)).toBe(true);
    expect(offeredArchSupportForState(after, "bare-metal-ipi")).toEqual(["x86_64", "aarch64"]);
  });

  it("the trust-bundle policy at the destination is explicit, with no stale caveat", () => {
    expect(getTrustBundlePolicySupport(`${to}.0`).source).toBe("explicit");
  });

  it("resolved operator metadata from the source minor is invalidated, intent retained", () => {
    // Cross-minor catalog images and channels are no longer current. The policy
    // is: drop resolved metadata, keep the user's intent for re-reconciliation.
    expect(hasCrossMinorOperatorState(before.operators, to)).toBe(true);
    expect(getResolvedOperatorMinor(after.operators)).not.toBe(from);
    const blob = JSON.stringify(after.operators);
    expect(blob, "a source-minor catalog image must not survive the transition").not.toContain(`index:v${from}`);
  });

  it("every version-aware Quick Pick has an explicit row at the destination", () => {
    const re = /versionPicks:\s*\{/g;
    let m;
    let blocks = 0;
    while ((m = re.exec(SRC))) {
      let i = re.lastIndex, depth = 1;
      while (i < SRC.length && depth > 0) {
        if (SRC[i] === "{") depth++;
        else if (SRC[i] === "}") depth--;
        i++;
      }
      const body = SRC.slice(re.lastIndex, i - 1);
      expect(body, `a versionPicks block has no "${to}" row`).toContain(`"${to}":`);
      blocks++;
    }
    expect(blocks).toBeGreaterThanOrEqual(6);
  });
});

describe("T6 §13 — the 4.22-only field does not leak backward", () => {
  // platform.baremetal.provisioningNetworkGateway is the ONLY install-config
  // path 4.22 adds that Architect exposes. A state carrying it must not cause
  // that field to become visible or generatable after moving to 4.20 or 4.21.
  const GATEWAY = "platform.baremetal.provisioningNetworkGateway";

  const with422Gateway = () => {
    const st = lockedState("4.22");
    st.hostInventory = {
      ...st.hostInventory,
      provisioningNetworkCIDR: "172.22.0.0/24",
      provisioningDHCPRange: "172.22.0.10,172.22.0.100",
      clusterProvisioningIP: "172.22.0.3",
      provisioningNetworkGateway: "172.22.0.254",
    };
    return st;
  };

  it("the field is a supported-ui catalog row at 4.22 for bare-metal-ipi", () => {
    const row = getCatalogForScenario("bare-metal-ipi", "4.22").find((p) => p.path === GATEWAY);
    expect(row).toBeTruthy();
    expect(row.supportStatus).toBe("supported-ui");
    expect(row.minVersion).toBe("4.22");
  });

  it.each(["4.20", "4.21"])("the field has no catalog row at all at %s", (minor) => {
    const row = getCatalogForScenario("bare-metal-ipi", minor).find((p) => p.path === GATEWAY);
    expect(row).toBeUndefined();
  });

  it.each([["4.21"], ["4.20"]])("transitioning 4.22 -> %s keeps the value in state but offers no control", (to) => {
    const before = with422Gateway();
    const result = computeReleaseTransition(before, to, { timestamp: TS, patch: PATCH[to] });
    expect(result.ok).toBe(true);
    const after = applyPatch(before, result.patch);

    // The transition patch deliberately does not touch hostInventory: silently
    // destroying user input on a version change would be worse than carrying it.
    // Safety comes from the destination catalog having no row for the path, so
    // no control renders and generation never reads it (certified backend-side).
    expect(after.hostInventory.provisioningNetworkGateway).toBe("172.22.0.254");
    const row = getCatalogForScenario("bare-metal-ipi", to).find((p) => p.path === GATEWAY);
    expect(row, `${to} must not offer the 4.22-only field`).toBeUndefined();
  });

  it("returning to 4.22 makes the field available again without re-entry", () => {
    const before = with422Gateway();
    const down = applyPatch(before, computeReleaseTransition(before, "4.20", { timestamp: TS, patch: PATCH["4.20"] }).patch);
    const up = applyPatch(down, computeReleaseTransition(down, "4.22", { timestamp: TS, patch: PATCH["4.22"] }).patch);
    expect(up.version.selectedMinor).toBe("4.22");
    expect(up.hostInventory.provisioningNetworkGateway).toBe("172.22.0.254");
    const row = getCatalogForScenario("bare-metal-ipi", "4.22").find((p) => p.path === GATEWAY);
    expect(row.supportStatus).toBe("supported-ui");
  });
});

describe("T6 §13 — unsupported transitions are blocked with no partial mutation", () => {
  it.each(SUPPORTED_MINORS)("%s -> 4.23 is refused", (from) => {
    const before = lockedState(from);
    const snapshot = JSON.stringify(before);
    const result = computeReleaseTransition(before, "4.23", { timestamp: TS });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(TRANSITION_ERRORS.UNSUPPORTED_VERSION);
    expect(result.patch).toBeUndefined();
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("4.23 never falls back to 4.22", () => {
    expect(isSupportedMinor("4.23")).toBe(false);
    const result = computeReleaseTransition(lockedState("4.22"), "4.23", { timestamp: TS });
    expect(JSON.stringify(result)).not.toContain("4.22");
    expect(() => getCatalogForScenario("bare-metal-ipi", "4.23")).toThrow(UnsupportedVersionError);
    expect(getDocsIndexForState({ version: { selectedMinor: "4.23" } })).toBeNull();
    expect(hasArchSupportForMinor("4.23")).toBe(false);
  });

  it("a patch from the wrong minor is refused rather than coerced", () => {
    const result = computeReleaseTransition(lockedState("4.21"), "4.22", { timestamp: TS, patch: "4.21.35" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(TRANSITION_ERRORS.PATCH_MINOR_MISMATCH);
  });
});

describe("T6 §13 — scenario coverage is identical at every supported minor", () => {
  // DOC-166: `data/params/4.20/oc-mirror-v2.json` is a LEGACY per-minor copy of
  // the ImageSetConfiguration schema. That schema is a property of the
  // oc-mirror tool, not of the target OpenShift minor, so 4.21 and 4.22 have no
  // such file and no production module reads the 4.20 one. The catalog resolver
  // globs files, so it still reports it as an available "scenario" at 4.20.
  // It is inert, known, and its retirement is explicitly non-blocking.
  const LEGACY_NON_SCENARIO = "oc-mirror-v2";
  const platformScenarios = (m) =>
    [...getAvailableCatalogScenarios(m)].filter((s) => s !== LEGACY_NON_SCENARIO).sort();

  it("all three minors offer the same 12 platform scenarios", () => {
    expect(platformScenarios("4.22")).toHaveLength(12);
    expect(platformScenarios("4.22")).toEqual(platformScenarios("4.21"));
    expect(platformScenarios("4.22")).toEqual(platformScenarios("4.20"));
  });

  it("the only non-scenario catalog entry is the inert legacy 4.20 one", () => {
    // Pinned so the exception cannot quietly spread to a new minor.
    const extra = (m) => [...getAvailableCatalogScenarios(m)].filter((s) => s === LEGACY_NON_SCENARIO);
    expect(extra("4.20")).toEqual([LEGACY_NON_SCENARIO]);
    expect(extra("4.21")).toEqual([]);
    expect(extra("4.22")).toEqual([]);
  });
});
