/**
 * A Quick Pick is a VERSION-AWARE PRESET, so changing the locked minor must
 * re-evaluate its MEMBERSHIP — not merely re-stamp metadata on whatever was
 * already selected.
 *
 * WHAT A HUMAN SAW. With "OpenShift AI" selected:
 *
 *   - 4.22 → 4.20 did NOT add the 4.20-only `rhods-prometheus-operator`. The
 *     pick showed as active and the generated ImageSet was one package short.
 *     Toggling the pick off and on was the only recovery.
 *   - 4.20 → 4.22 left `rhods-prometheus-operator` behind as intent that can
 *     never resolve (the package does not exist at 4.22), which parked the
 *     pick in `pendingScenarios` permanently, behind a conflict banner.
 *
 * MECHANISM. `reconcileOperatorsForMinor` derived a pick's membership from
 * `op.sources` on the ALREADY-SELECTED entries. It never consulted the
 * destination minor's `versionPicks` row — it could not, because the table was
 * module-private inside `OperatorsStep.jsx`, which exports only the component.
 * It was a metadata re-resolver, not a preset re-evaluator: no set difference
 * was ever computed.
 *
 * This file drives the REAL shipped Quick Pick table, the REAL reconciler, and
 * the REAL catalog inventory captured by `oc-mirror --v2 list operators`
 * (`docs/minor-release/4.22/operator-catalog-scan-4.22.json`), across all six
 * ordered pairs of supported minors, and takes the 4.22 → 4.20 case all the
 * way to the generated `imageset-config.yaml`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
/* The backend's own js-yaml (v4) is imported by path on purpose: a bare
   `js-yaml` specifier resolves to the repo root's v5, which ships no default
   export. Same reason as preview-sensitive-redaction.security.test.js. */
import yaml from "../../backend/node_modules/js-yaml/index.js";

import { SUPPORTED_MINORS } from "../src/shared/versionPolicy.js";
import { scenarios, resolveScenarioPicks } from "../src/shared/operatorQuickPicks.js";
import {
  buildInvalidatedOperatorState,
  reconcileOperatorsForMinor,
  catalogImagesForMinor,
  isOperatorResolved,
} from "../src/shared/operatorMinorReconciliation.js";
import { buildImageSetConfig } from "../../backend/src/generate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const SCAN = JSON.parse(
  readFileSync(join(REPO, "docs", "minor-release", "4.22", "operator-catalog-scan-4.22.json"), "utf8")
);

const PATCH = { "4.20": "4.20.40", "4.21": "4.21.35", "4.22": "4.22.16" };

/**
 * Catalog lists shaped like a real `/api/operators/status` response.
 *
 * `redhat` is the real per-minor inventory. `certified` was captured at 4.22
 * only, so the same list stands in at 4.20 and 4.21; the sole certified
 * package any Quick Pick names is `gpu-operator-certified`, which is present
 * at all three, so this substitution cannot mask a membership difference.
 */
const toList = (packages, catalog) =>
  Object.entries(packages).map(([name, defaultChannel]) => ({
    id: `${catalog}-${name}`,
    name,
    displayName: name,
    defaultChannel,
    catalog,
  }));

const CATALOGS = Object.fromEntries(
  SUPPORTED_MINORS.map((minor) => [
    minor,
    {
      redhat: toList(SCAN.packages[`redhat-${minor}`], "redhat"),
      certified: toList(SCAN.packages["certified-4.22"], "certified"),
      community: [],
    },
  ])
);

const lower = (s) => String(s || "").toLowerCase();
const namesOwnedBy = (operators, scenarioId) =>
  (operators.selected || [])
    .filter((op) => (op.sources || []).includes(scenarioId))
    .map((op) => op.name)
    .sort();

const rowNames = (scenarioId, minor) => {
  const picks = resolveScenarioPicks(
    scenarios.find((s) => s.id === scenarioId),
    minor
  );
  return Object.values(picks || {})
    .flat()
    .sort();
};

/** `applyScenario`, reproduced: what state looks like right after clicking a pick at `minor`. */
function stateWithPickApplied(minor, scenarioIds) {
  const images = catalogImagesForMinor(minor);
  const selected = [];
  const scenarioAdded = {};
  const activeScenarios = {};
  for (const scenarioId of scenarioIds) {
    const picks = resolveScenarioPicks(scenarios.find((s) => s.id === scenarioId), minor);
    expect(picks, `${scenarioId} has no row at ${minor}`).toBeTruthy();
    activeScenarios[scenarioId] = true;
    for (const [catalogId, names] of Object.entries(picks)) {
      for (const name of names) {
        const found = CATALOGS[minor][catalogId].find((op) => lower(op.name) === lower(name));
        if (!found) continue; // production: `if (!found) return;`
        const existing = selected.find((op) => op.id === found.id);
        if (existing) {
          existing.sources = Array.from(new Set([...existing.sources, scenarioId]));
        } else {
          selected.push({ ...found, catalogImage: images[catalogId], sources: [scenarioId] });
        }
        scenarioAdded[found.id] = { ...(scenarioAdded[found.id] || {}), [scenarioId]: true };
      }
    }
  }
  return {
    selected,
    scenarios: activeScenarios,
    pendingScenarios: {},
    scenarioAdded,
    catalogs: CATALOGS[minor],
    version: minor,
    stale: false,
    fastMode: false,
    scanJobs: {},
  };
}

/**
 * The real transition: invalidate on the minor change (what App.jsx does), then
 * reconcile once the destination catalogs land (what OperatorsStep does).
 */
function transition(operators, toMinor) {
  const invalidated = buildInvalidatedOperatorState(operators);
  const reconciled = reconcileOperatorsForMinor(invalidated, CATALOGS[toMinor], toMinor);
  return {
    ...invalidated,
    ...(reconciled || {}),
    catalogs: CATALOGS[toMinor],
    version: toMinor,
  };
}

const ORDERED_PAIRS = SUPPORTED_MINORS.flatMap((from) =>
  SUPPORTED_MINORS.filter((to) => to !== from).map((to) => [from, to])
);

describe("the transition matrix this file covers", () => {
  it("is all six ordered pairs of the three supported minors", () => {
    expect(ORDERED_PAIRS.map(([a, b]) => `${a}->${b}`).sort()).toEqual(
      ["4.20->4.21", "4.20->4.22", "4.21->4.20", "4.21->4.22", "4.22->4.20", "4.22->4.21"].sort()
    );
  });

  it("the package at the centre of the defect really does vary by minor", () => {
    // If this ever stops being true the rest of the file proves nothing.
    expect(rowNames("openshift-ai", "4.20")).toContain("rhods-prometheus-operator");
    expect(rowNames("openshift-ai", "4.21")).toContain("rhods-prometheus-operator");
    expect(rowNames("openshift-ai", "4.22")).not.toContain("rhods-prometheus-operator");
    expect(SCAN.packages["redhat-4.20"]["rhods-prometheus-operator"]).toBeTruthy();
    expect(SCAN.packages["redhat-4.22"]["rhods-prometheus-operator"]).toBeUndefined();
  });
});

describe.each(ORDERED_PAIRS)("openshift-ai membership: %s -> %s", (from, to) => {
  const before = stateWithPickApplied(from, ["openshift-ai"]);
  const after = transition(before, to);

  it("ends with exactly the destination minor's package set", () => {
    expect(namesOwnedBy(after, "openshift-ai")).toEqual(rowNames("openshift-ai", to));
  });

  it("every member is resolved against the DESTINATION minor's catalogs", () => {
    for (const op of after.selected) {
      expect(isOperatorResolved(op), `${op.name} unresolved`).toBe(true);
      expect(op.catalogImage).toContain(`:v${to}`);
      expect(op.catalogImage).not.toContain(`:v${from}`);
    }
  });

  it("the pick presents as ACTIVE, not pending — there is no conflict to review", () => {
    expect(after.scenarios["openshift-ai"]).toBe(true);
    expect(after.pendingScenarios).toEqual({});
    expect(after.unresolvedIntent).toEqual([]);
  });

  it("provenance survives so the pick can still be toggled off cleanly", () => {
    for (const op of after.selected) {
      expect(op.sources).toContain("openshift-ai");
      expect(after.scenarioAdded[op.id]?.["openshift-ai"]).toBe(true);
    }
  });
});

describe("openshift-ai: the two directions the human reported, stated exactly", () => {
  it("4.22 -> 4.20 ADDS rhods-prometheus-operator", () => {
    const after = transition(stateWithPickApplied("4.22", ["openshift-ai"]), "4.20");
    const added = after.selected.find((op) => op.name === "rhods-prometheus-operator");
    expect(added, "the 4.20-only package was never added").toBeTruthy();
    expect(added.sources).toEqual(["openshift-ai"]);
    expect(added.catalogImage).toBe(catalogImagesForMinor("4.20").redhat);
    expect(added.defaultChannel).toBe(SCAN.packages["redhat-4.20"]["rhods-prometheus-operator"]);
  });

  it("4.22 -> 4.20 puts it in the generated imageset-config under the 4.20 catalog", () => {
    // The artifact is what the user actually mirrors, so the claim is made there.
    const after = transition(stateWithPickApplied("4.22", ["openshift-ai"]), "4.20");
    const doc = yaml.load(
      buildImageSetConfig({
        release: { channel: "4.20", patchVersion: PATCH["4.20"] },
        version: { _schemaVersion: 3, selectedMinor: "4.20", selectedPatch: PATCH["4.20"], locked: true },
        blueprint: { arch: "x86_64", platform: "Bare Metal" },
        operators: after,
      })
    );
    const redhat = doc.mirror.operators.find(
      (entry) => entry.catalog === catalogImagesForMinor("4.20").redhat
    );
    expect(redhat, "no 4.20 redhat catalog block was emitted").toBeTruthy();
    expect(redhat.packages.map((p) => p.name).sort()).toEqual(
      ["nfd", "rhods-operator", "rhods-prometheus-operator"].sort()
    );
    // And nothing from the minor we left.
    expect(JSON.stringify(doc)).not.toContain(":v4.22");
  });

  it("4.20 -> 4.22 REMOVES it and leaves the pick active, not pending", () => {
    const after = transition(stateWithPickApplied("4.20", ["openshift-ai"]), "4.22");
    expect(after.selected.map((op) => op.name)).not.toContain("rhods-prometheus-operator");
    expect(after.scenarios["openshift-ai"]).toBe(true);
    expect(after.pendingScenarios["openshift-ai"]).toBeUndefined();
    expect(after.pendingScenarios).toEqual({});
    // No orphaned provenance.
    expect(Object.keys(after.scenarioAdded)).not.toContain("redhat-rhods-prometheus-operator");
  });

  it("4.20 -> 4.22 emits nothing for the removed package", () => {
    const after = transition(stateWithPickApplied("4.20", ["openshift-ai"]), "4.22");
    const out = buildImageSetConfig({
      release: { channel: "4.22", patchVersion: PATCH["4.22"] },
      version: { _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: PATCH["4.22"], locked: true },
      blueprint: { arch: "x86_64", platform: "Bare Metal" },
      operators: after,
    });
    expect(out).not.toContain("rhods-prometheus-operator");
    expect(out).toContain("rhods-operator");
  });
});

/* ------------------------------------------------------------------ */
/* Generalised: every version-aware pick, every ordered pair            */
/* ------------------------------------------------------------------ */

const VERSION_AWARE_IDS = scenarios.filter((s) => s.versionPicks).map((s) => s.id);

describe("every version-aware Quick Pick re-evaluates in both directions", () => {
  it("there are six of them, five of which vary across the supported window", () => {
    expect(VERSION_AWARE_IDS).toHaveLength(6);
    const varying = VERSION_AWARE_IDS.filter(
      (id) => new Set(SUPPORTED_MINORS.map((m) => JSON.stringify(rowNames(id, m)))).size > 1
    );
    expect(varying.sort()).toEqual(
      ["odf", "odf-disaster-recovery", "odf-local-storage", "openshift-ai", "platform-plus"].sort()
    );
    // app-dev-suite is the control: identical at all three minors.
    expect(varying).not.toContain("app-dev-suite");
  });

  for (const scenarioId of VERSION_AWARE_IDS) {
    describe.each(ORDERED_PAIRS)(`${scenarioId}: %s -> %s`, (from, to) => {
      const after = transition(stateWithPickApplied(from, [scenarioId]), to);

      it("owns exactly the destination row, no more and no less", () => {
        expect(namesOwnedBy(after, scenarioId)).toEqual(rowNames(scenarioId, to));
      });

      it("carries no package that only the source minor's row named", () => {
        const onlyAtSource = rowNames(scenarioId, from).filter((n) => !rowNames(scenarioId, to).includes(n));
        for (const name of onlyAtSource) {
          expect(after.selected.map((op) => op.name), `${name} survived ${from} -> ${to}`).not.toContain(name);
        }
      });

      it("is active at the destination, with no leftover conflict", () => {
        expect(after.scenarios[scenarioId]).toBe(true);
        expect(after.pendingScenarios).toEqual({});
        expect(after.unresolvedIntent).toEqual([]);
      });
    });
  }
});

/* ------------------------------------------------------------------ */
/* Ownership: removal must not take something it does not own           */
/* ------------------------------------------------------------------ */

describe("ownership rules on the removal pass", () => {
  it("an operator the human ALSO selected manually survives, with manual provenance", () => {
    const before = stateWithPickApplied("4.20", ["openshift-ai"]);
    const target = before.selected.find((op) => op.name === "rhods-prometheus-operator");
    // `selectOperator` on an already-present entry: ensureSources adds "manual".
    target.sources = [...target.sources, "manual"];

    const after = transition(before, "4.22");
    const survivor = after.selected.find((op) => op.name === "rhods-prometheus-operator");
    expect(survivor, "a manually selected operator was deleted by a Quick Pick re-evaluation").toBeTruthy();
    expect(survivor.sources).toEqual(["manual"]);
    // The pick no longer owns it, so the pick itself is complete and active...
    expect(after.scenarios["openshift-ai"]).toBe(true);
    // ...while the human's own choice is honestly reported as unavailable at
    // 4.22 rather than being invented a channel.
    expect(isOperatorResolved(survivor)).toBe(false);
    expect(survivor.catalogImage).toBeUndefined();
    expect(after.unresolvedIntent).toContain("rhods-prometheus-operator");
  });

  it("an operator another pick still owns survives the first owner dropping it", () => {
    // The ownership rule verbatim from removeScenarioOperators: strip the id,
    // delete only when this pick added it AND no source remains.
    const before = stateWithPickApplied("4.22", ["odf"]);
    const shared = before.selected.find((op) => op.name === "ocs-tls-profiles");
    expect(shared, "fixture precondition: ocs-tls-profiles is a 4.22 ODF member").toBeTruthy();
    shared.sources = ["odf", "platform-plus"];

    const after = transition(before, "4.20");
    const survivor = after.selected.find((op) => op.name === "ocs-tls-profiles");
    expect(survivor, "an operator another pick owns was deleted").toBeTruthy();
    expect(survivor.sources).toEqual(["platform-plus"]);
  });

  it("two picks co-owning a package: it leaves only when the LAST owner drops it", () => {
    const before = stateWithPickApplied("4.22", ["odf", "platform-plus"]);
    const shared = before.selected.find((op) => op.name === "ocs-tls-profiles");
    expect(shared.sources.sort()).toEqual(["odf", "platform-plus"]);

    const after = transition(before, "4.20");
    expect(after.selected.map((op) => op.name)).not.toContain("ocs-tls-profiles");
    // Provenance for the departed package is pruned, not orphaned.
    expect(after.scenarioAdded["redhat-ocs-tls-profiles"]).toBeUndefined();
    expect(after.scenarios).toEqual({ odf: true, "platform-plus": true });
    expect(after.pendingScenarios).toEqual({});
  });

  it("two picks co-owning a package: the addition is made once, with both owners", () => {
    const before = stateWithPickApplied("4.20", ["odf", "platform-plus"]);
    expect(before.selected.map((op) => op.name)).not.toContain("ocs-tls-profiles");

    const after = transition(before, "4.22");
    const added = after.selected.filter((op) => op.name === "ocs-tls-profiles");
    expect(added, "the shared package was duplicated or missed").toHaveLength(1);
    expect(added[0].sources.sort()).toEqual(["odf", "platform-plus"]);
    expect(after.scenarioAdded[added[0].id]).toEqual({ odf: true, "platform-plus": true });
    expect(after.scenarios).toEqual({ odf: true, "platform-plus": true });
  });
});

/* ------------------------------------------------------------------ */
/* Fail-closed contracts that must NOT be relaxed by the new pass       */
/* ------------------------------------------------------------------ */

describe("fail-closed contracts are preserved", () => {
  it("a package the destination catalogs genuinely lack keeps the pick PENDING", () => {
    // Not reachable from the shipped data (every row resolves at every
    // supported minor), so it is forced here: the 4.20 catalogs are served
    // without `rhods-prometheus-operator`.
    const starved = {
      ...CATALOGS["4.20"],
      redhat: CATALOGS["4.20"].redhat.filter((op) => op.name !== "rhods-prometheus-operator"),
    };
    const invalidated = buildInvalidatedOperatorState(stateWithPickApplied("4.22", ["openshift-ai"]));
    const after = reconcileOperatorsForMinor(invalidated, starved, "4.20");

    expect(after.scenarios["openshift-ai"]).toBeUndefined();
    expect(after.pendingScenarios["openshift-ai"]).toBe(true);
    expect(after.unresolvedIntent).toContain("rhods-prometheus-operator");
    // Nothing invented: no entry, no channel, no catalog image.
    expect(after.selected.map((op) => op.name)).not.toContain("rhods-prometheus-operator");
    for (const op of after.selected) {
      if (!isOperatorResolved(op)) expect(op.defaultChannel).toBeFalsy();
    }
  });

  it("a minor with no row for the pick is left alone rather than invented", () => {
    // `resolveScenarioPicks` returns null for an unsupported minor, and the
    // membership pass must then do nothing at all — not empty the pick.
    const before = stateWithPickApplied("4.22", ["openshift-ai"]);
    const invalidated = buildInvalidatedOperatorState(before);
    // 4.19 has no openshift-ai row and is not supported; reconcile against the
    // 4.20 catalogs so lookups can still succeed.
    const after = reconcileOperatorsForMinor(invalidated, CATALOGS["4.20"], "4.19");
    expect(resolveScenarioPicks(scenarios.find((s) => s.id === "openshift-ai"), "4.19")).toBeNull();
    expect(namesOwnedBy(after, "openshift-ai").sort()).toEqual(rowNames("openshift-ai", "4.22"));
  });

  it("a scenario id with no Quick Pick definition has no membership inferred", () => {
    const operators = {
      selected: [{ name: "cluster-logging", id: "redhat-cluster-logging", sources: ["legacy-pick"] }],
      pendingScenarios: { "legacy-pick": true },
      scenarioAdded: { "redhat-cluster-logging": { "legacy-pick": true } },
    };
    const after = reconcileOperatorsForMinor(operators, CATALOGS["4.22"], "4.22");
    expect(after.selected.map((op) => op.name)).toEqual(["cluster-logging"]);
    expect(after.scenarios["legacy-pick"]).toBe(true);
  });
});
