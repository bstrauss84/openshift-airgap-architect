/**
 * Tranche 7C — CPU architecture must be selectable on the Blueprint step.
 *
 * THE REPORTED FAILURE. "Only bare metal has selectable CPU architectures. All
 * the other target platforms have all of their supported architectures greyed
 * out/unclickable, including the ones that used to be available."
 *
 * MECHANISM. `BlueprintStep` keyed the architecture matrix on
 * `getScenarioId(platform, state.methodology.method)`. Methodology is a LATER
 * wizard step, so on Blueprint that method is the shipped default
 * ("Agent-Based Installer", from `defaultState()` in backend/src/index.js) or a
 * stale choice carried over from a previous platform. Nutanix, AWS GovCloud,
 * Azure Government and IBM Cloud do not offer an agent-based install, so
 * `getScenarioId` returned null, and `listArchSupportForState` resolves a null
 * scenario to all cells `offered: false`. Every architecture rendered greyed —
 * x86_64 included, which all six platforms document as supported.
 *
 * Bare Metal escaped only because the shipped default pair happens to be
 * modelled as `bare-metal-agent`.
 *
 * WHY THE EXISTING TESTS PASSED. `blueprint-architecture-d3.test.jsx` always
 * builds state with a method that is VALID for the platform under test, so it
 * never exercises the pair a user actually produces by clicking a platform.
 *
 * SUPPORT TRUTH USED HERE is Red Hat's installation-overview "Supported
 * installation methods for different platforms" (Table 2.1 / 2.2), which is
 * identical across 4.20, 4.21 and 4.22: x86_64 on all six platforms, aarch64
 * additionally on bare metal, ppc64le and s390x on none of them. These
 * expectations are written out literally rather than read from
 * `data/arch-support/*.json`, so the test checks the data against documented
 * truth instead of against itself.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

import {
  listArchSupportForBlueprint,
  listArchSupportForPlatform,
  offeredArchSupportForState,
} from "../src/archSupportResolver.js";
import { SUPPORTED_MINORS } from "../src/shared/versionPolicy.js";
import {
  installMethodsForPlatform,
  reconcileMethodForPlatform,
  isMethodValidForPlatform,
} from "../../shared/installMethods.js";
import { getScenarioId } from "../../shared/scenarioId.js";

vi.mock("../src/api.js", () => ({
  apiFetch: vi.fn(() => Promise.resolve({})),
}));

/**
 * Documented architecture support, per Red Hat installation-overview
 * Table 2.1/2.2 for 4.20, 4.21 and 4.22 (identical in all three).
 * Deliberately NOT derived from the product's own matrix.
 */
const DOCUMENTED = {
  "Bare Metal": ["x86_64", "aarch64"],
  "VMware vSphere": ["x86_64"],
  Nutanix: ["x86_64"],
  "AWS GovCloud": ["x86_64"],
  "Azure Government": ["x86_64"],
  "IBM Cloud": ["x86_64"],
};

const PLATFORMS = Object.keys(DOCUMENTED);
const PATCH = { "4.20": "4.20.40", "4.21": "4.21.35", "4.22": "4.22.16" };

/** A run at a locked minor, with whatever (platform, method) pair is given. */
const stateFor = (minor, platform, method) => ({
  _schemaVersion: 3,
  version: {
    _schemaVersion: 3,
    selectedMinor: minor,
    selectedPatch: PATCH[minor],
    selectedChannel: `stable-${minor}`,
    locked: true,
  },
  release: { channel: minor, patchVersion: PATCH[minor], confirmed: true },
  blueprint: { platform, arch: "x86_64", clusterName: "c", baseDomain: "example.com" },
  methodology: { method },
  hostInventory: { nodes: [] },
  operators: { selected: [] },
  ui: { activeStepId: "blueprint", visitedSteps: {}, completedSteps: {} },
});

const offered = (result) => result.cells.filter((c) => c.offered).map((c) => c.architecture).sort();

/* ------------------------------------------------------------------ */
/* The reported failure: the shipped default method, every platform     */
/* ------------------------------------------------------------------ */

describe("T7C — every platform offers its documented architectures with the DEFAULT method", () => {
  // "Agent-Based Installer" is what defaultState() ships, so this is the state
  // a user is in the instant they click a platform card.
  const DEFAULT_METHOD = "Agent-Based Installer";

  for (const minor of SUPPORTED_MINORS) {
    for (const platform of PLATFORMS) {
      it(`${minor} / ${platform}: offers exactly ${DOCUMENTED[platform].join(", ")}`, () => {
        const result = listArchSupportForBlueprint(stateFor(minor, platform, DEFAULT_METHOD));
        expect(offered(result)).toEqual([...DOCUMENTED[platform]].sort());
      });
    }
  }

  it("x86_64 is selectable on all six platforms at all three minors — the headline symptom", () => {
    const greyed = [];
    for (const minor of SUPPORTED_MINORS) {
      for (const platform of PLATFORMS) {
        const result = listArchSupportForBlueprint(stateFor(minor, platform, DEFAULT_METHOD));
        const cell = result.cells.find((c) => c.architecture === "x86_64");
        if (!cell?.offered) greyed.push(`${minor}/${platform}`);
      }
    }
    expect(greyed, `x86_64 greyed out for: ${greyed.join(", ")}`).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Every method the platform actually offers                            */
/* ------------------------------------------------------------------ */

describe("T7C — the answer does not depend on which valid method is selected", () => {
  for (const minor of SUPPORTED_MINORS) {
    for (const platform of PLATFORMS) {
      it(`${minor} / ${platform}: identical across ${installMethodsForPlatform(platform).join(", ")}`, () => {
        const answers = installMethodsForPlatform(platform).map((method) =>
          offered(listArchSupportForBlueprint(stateFor(minor, platform, method))).join(",")
        );
        expect(new Set(answers).size, `methods disagreed: ${answers.join(" | ")}`).toBe(1);
        expect(answers[0].split(",").sort()).toEqual([...DOCUMENTED[platform]].sort());
      });
    }
  }
});

/* ------------------------------------------------------------------ */
/* With no methodology settled at all                                   */
/* ------------------------------------------------------------------ */

describe("T7C — a platform answers before any methodology exists", () => {
  for (const platform of PLATFORMS) {
    it(`${platform}: resolves without a method in state`, () => {
      const state = stateFor("4.22", platform, undefined);
      expect(offered(listArchSupportForBlueprint(state))).toEqual([...DOCUMENTED[platform]].sort());
    });
  }

  it("an unmodelled platform is still closed, and says why", () => {
    const result = listArchSupportForBlueprint(stateFor("4.22", "Totally Unknown Platform", undefined));
    expect(result.cells.every((c) => !c.offered)).toBe(true);
    expect(result.cells[0].unresolvedCause).toBe("unknown-scenario");
  });

  it("an unsupported minor stays closed even with a valid platform", () => {
    // 4.23 must not borrow a supported minor's answer.
    const state = stateFor("4.22", "Bare Metal", "Agent-Based Installer");
    state.version.selectedMinor = "4.23";
    state.version.selectedPatch = "4.23.0";
    expect(offered(listArchSupportForBlueprint(state))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The platform-level intersection is genuinely an intersection         */
/* ------------------------------------------------------------------ */

describe("T7C — platform-level resolution intersects, it does not widen", () => {
  it("never offers an architecture that some valid method would close", () => {
    for (const minor of SUPPORTED_MINORS) {
      for (const platform of PLATFORMS) {
        const platformLevel = new Set(offered(listArchSupportForPlatform(stateFor(minor, platform, undefined), platform)));
        for (const method of installMethodsForPlatform(platform)) {
          const perMethod = new Set(offeredArchSupportForState(stateFor(minor, platform, method), getScenarioId(platform, method)));
          for (const arch of platformLevel) {
            expect(perMethod.has(arch), `${minor}/${platform}: ${arch} offered platform-wide but closed for ${method}`).toBe(true);
          }
        }
      }
    }
  });

  it("ppc64le and s390x are offered nowhere — no platform book documents them", () => {
    for (const minor of SUPPORTED_MINORS) {
      for (const platform of PLATFORMS) {
        const got = offered(listArchSupportForBlueprint(stateFor(minor, platform, "Agent-Based Installer")));
        expect(got).not.toContain("ppc64le");
        expect(got).not.toContain("s390x");
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* Method reconciliation keeps state modelled                           */
/* ------------------------------------------------------------------ */

describe("T7C — selecting a platform leaves a modelled (platform, method) pair", () => {
  it("every platform reconciles the shipped default to a method it offers", () => {
    for (const platform of PLATFORMS) {
      const method = reconcileMethodForPlatform(platform, "Agent-Based Installer");
      expect(isMethodValidForPlatform(platform, method), `${platform} -> ${method}`).toBe(true);
      expect(getScenarioId(platform, method), `${platform}/${method} has no scenarioId`).toBeTruthy();
    }
  });

  it("a method that is already valid is preserved, not reset", () => {
    expect(reconcileMethodForPlatform("Bare Metal", "UPI")).toBe("UPI");
    expect(reconcileMethodForPlatform("VMware vSphere", "Agent-Based Installer")).toBe("Agent-Based Installer");
  });

  it("every platform × method pair the UI can produce has a scenarioId", () => {
    // The null-scenario state is what greyed the architecture cards. After
    // reconciliation it must be unreachable from the UI.
    const unmodelled = [];
    for (const platform of PLATFORMS) {
      for (const method of installMethodsForPlatform(platform)) {
        if (!getScenarioId(platform, method)) unmodelled.push(`${platform}/${method}`);
      }
    }
    expect(unmodelled, `pairs with no scenarioId: ${unmodelled.join(", ")}`).toEqual([]);
  });

  it("an unmodelled platform yields no method rather than a wrong one", () => {
    expect(reconcileMethodForPlatform("Totally Unknown Platform", "IPI")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* The rendered step: architecture buttons must be clickable            */
/* ------------------------------------------------------------------ */

describe("T7C — the Blueprint step renders selectable architecture buttons", () => {
  // A helper assertion alone would not have caught this: the defect was in
  // what the step passed to the resolver, not in the resolver.
  const harness = vi.hoisted(() => ({ initialState: null }));
  afterEach(() => cleanup());

  async function renderBlueprint(state) {
    harness.initialState = state;
    vi.doMock("../src/store.jsx", async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, useApp: () => ({ state, updateState: vi.fn(), setState: vi.fn() }) };
    });
    const { default: BlueprintStep } = await import("../src/steps/BlueprintStep.jsx");
    render(<BlueprintStep />);
  }

  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("../src/store.jsx"));

  for (const platform of PLATFORMS) {
    it(`${platform}: the x86_64 card is enabled`, async () => {
      await renderBlueprint(stateFor("4.22", platform, "Agent-Based Installer"));
      const card = screen.getByRole("button", { name: /x86_64/i });
      expect(card.disabled, `${platform}: x86_64 card is disabled`).toBe(false);
    });
  }

  it("Bare Metal additionally enables aarch64", async () => {
    await renderBlueprint(stateFor("4.22", "Bare Metal", "Agent-Based Installer"));
    expect(screen.getByRole("button", { name: /aarch64|arm64/i }).disabled).toBe(false);
  });

  it("vSphere leaves aarch64 disabled — the matrix closes it", async () => {
    await renderBlueprint(stateFor("4.22", "VMware vSphere", "Agent-Based Installer"));
    expect(screen.getByRole("button", { name: /aarch64|arm64/i }).disabled).toBe(true);
  });

  // DOC-215. "Offered nowhere" and "drawn as a dead control" are different
  // failures; the block above only proved the first. No current OAA scenario
  // can select ppc64le or s390x, so the cards are not drawn at all — while
  // aarch64, which IS selectable somewhere in the product, keeps its card on
  // every platform. Full coverage, including the synthetic-authority proof
  // that this is data-driven, is in
  // doc215-blueprint-architecture-visibility.test.jsx.
  for (const platform of PLATFORMS) {
    it(`${platform}: draws no ppc64le or s390x card, and still draws aarch64`, async () => {
      await renderBlueprint(stateFor("4.22", platform, "Agent-Based Installer"));
      expect(screen.queryByRole("button", { name: /ppc64le/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /s390x/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /aarch64|arm64/i })).not.toBeNull();
    });
  }
});
