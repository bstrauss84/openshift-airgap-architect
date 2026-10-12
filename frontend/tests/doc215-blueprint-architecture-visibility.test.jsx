/**
 * DOC-215 — an architecture with NO current OAA scenario is not drawn at all.
 *
 * THE REPORTED DEFECT. The Blueprint step rendered four CPU Architecture
 * cards, two of which — ppc64le (IBM Power) and s390x (IBM Z) — were disabled
 * in every state the product can reach: all 12 modelled scenarios x all 3
 * supported minors (4.20, 4.21, 4.22) carry `disposition: "hidden"` for both.
 * A control that no user action can ever enable is noise, not information.
 *
 * THE TWO QUESTIONS THIS FILE KEEPS APART.
 *
 *   1. "Unavailable for the scenario I have selected" — aarch64 on vSphere.
 *      Still RENDERED, disabled, with the matrix's own reason, because the
 *      user can reach it by switching to bare metal. Hiding it would destroy
 *      information.
 *   2. "No currently supported OAA scenario at all" — ppc64le and s390x today.
 *      NOT RENDERED.
 *
 * THE RULE IS DATA, NOT A NAME CHECK. `renderableArchitectures()` folds the
 * same canonical authority every other architecture answer comes from
 * (`data/arch-support/<minor>.json`, projected to
 * `frontend/src/data/arch-support/`) over the reachable platform x method
 * surface (`shared/installMethods.js` -> `shared/scenarioId.js`). No
 * architecture is named in the resolver or in BlueprintStep. The synthetic
 * authority block below is the load-bearing proof: with ONLY the data swapped
 * and no component change, a hidden architecture becomes renderable, and a
 * rendered one disappears.
 *
 * WHAT IS NOT CLAIMED. OpenShift 4.20/4.21/4.22 DO support ppc64le and s390x,
 * on IBM Power and IBM Z — platforms this product does not model. The upstream
 * evidence in the matrix is untouched; the last block here pins that.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ARCHITECTURES } from "../../shared/archSupport.js";
import { SUPPORTED_MINORS } from "../src/shared/versionPolicy.js";
import {
  renderableArchitectures,
  computeRenderableArchitectures,
  modelledScenarioIds,
} from "../src/archSupportResolver.js";
import { METHODS_BY_PLATFORM } from "../../shared/installMethods.js";
import { getScenarioId } from "../../shared/scenarioId.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(() => new Promise(() => {})) }));

const REPO = join(__dirname, "..", "..");
const CANONICAL_DIR = join(REPO, "data", "arch-support");
const PROJECTION_DIR = join(REPO, "frontend", "src", "data", "arch-support");

const MINORS = readdirSync(CANONICAL_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(".json", ""))
  .sort();

const readDoc = (dir, minor) => JSON.parse(readFileSync(join(dir, `${minor}.json`), "utf8"));
const canonical = Object.fromEntries(MINORS.map((m) => [m, readDoc(CANONICAL_DIR, m)]));

/* ------------------------------------------------------------------ */
/* STEP A — the reachability proof, recomputed from canonical data      */
/* ------------------------------------------------------------------ */

describe("DOC-215 — reachability of each architecture across the whole product surface", () => {
  it("the reachable surface is every platform x method pair the UI offers", () => {
    const expected = [
      ...new Set(
        Object.entries(METHODS_BY_PLATFORM).flatMap(([platform, methods]) =>
          methods.map((method) => getScenarioId(platform, method)).filter(Boolean)
        )
      ),
    ];
    expect([...modelledScenarioIds()].sort()).toEqual([...expected].sort());
    // azure-government-upi is modelled in scenarioId.js but Azure Government
    // offers only IPI, so no user can select it. It must not vote.
    expect(modelledScenarioIds()).not.toContain("azure-government-upi");
  });

  it("recomputed from canonical disk data: x86_64 and aarch64 have scenarios, ppc64le and s390x have none", () => {
    const reachable = new Set(modelledScenarioIds());
    const supportedScenarios = (arch) =>
      MINORS.filter((m) => SUPPORTED_MINORS.includes(m)).flatMap((m) =>
        canonical[m].matrix
          .filter((row) => reachable.has(row.scenarioId) && row.architectures[arch]?.disposition === "supported")
          .map((row) => `${m}/${row.scenarioId}`)
      );

    expect(supportedScenarios("x86_64").length).toBeGreaterThan(0);
    expect(supportedScenarios("aarch64").length).toBeGreaterThan(0);
    expect(supportedScenarios("ppc64le")).toEqual([]);
    expect(supportedScenarios("s390x")).toEqual([]);
  });

  it("renderableArchitectures() agrees with that independent recomputation", () => {
    const reachable = new Set(modelledScenarioIds());
    const expected = ARCHITECTURES.filter((arch) =>
      SUPPORTED_MINORS.some((m) =>
        canonical[m].matrix.some(
          (row) => reachable.has(row.scenarioId) && row.architectures[arch]?.disposition === "supported"
        )
      )
    );
    expect(renderableArchitectures()).toEqual(expected);
    expect(renderableArchitectures()).toEqual(["x86_64", "aarch64"]);
  });
});

/* ------------------------------------------------------------------ */
/* STEP B/C — what the step renders                                     */
/* ------------------------------------------------------------------ */

function baseState({ platform, method, minor, locked = false }) {
  return {
    _schemaVersion: 3,
    blueprint: {
      arch: "x86_64",
      platform,
      clusterName: "test-cluster",
      baseDomain: "example.com",
      confirmed: locked,
    },
    methodology: { method },
    release: minor ? { channel: `stable-${minor}`, patchVersion: `${minor}.1` } : { channel: null, patchVersion: null },
    version: minor
      ? { selectedMinor: minor, selectedPatch: `${minor}.1`, selectedChannel: `stable-${minor}`, locked: false }
      : {},
    globalStrategy: { networking: {} },
  };
}

/** The CPU Architecture section's card for one architecture, or null. */
function archCard(label) {
  const heading = screen.getByRole("heading", { name: /CPU Architecture/i });
  const section = heading.closest("section");
  return within(section).queryByRole("button", { name: new RegExp(`^${label}`) });
}

describe("DOC-215 — the Blueprint step draws only architectures OAA has a scenario for", () => {
  afterEach(() => cleanup());

  async function renderStep(stateArgs) {
    const { AppContext } = await import("../src/store.jsx");
    const { default: BlueprintStep } = await import("../src/steps/BlueprintStep.jsx");
    const state = baseState(stateArgs);
    render(
      <AppContext.Provider value={{ state, updateState: vi.fn(), setState: vi.fn() }}>
        <BlueprintStep />
      </AppContext.Provider>
    );
  }

  const PLATFORMS = Object.keys(METHODS_BY_PLATFORM);

  for (const minor of SUPPORTED_MINORS) {
    for (const platform of PLATFORMS) {
      it(`${minor} / ${platform}: x86_64 and aarch64 are drawn; ppc64le and s390x are not`, async () => {
        await renderStep({ platform, method: METHODS_BY_PLATFORM[platform][0], minor });
        expect(archCard("x86_64"), "x86_64 card missing").not.toBeNull();
        expect(archCard("aarch64"), "aarch64 card missing").not.toBeNull();
        expect(archCard("ppc64le"), "ppc64le card still drawn").toBeNull();
        expect(archCard("s390x"), "s390x card still drawn").toBeNull();
      });
    }
  }

  it("aarch64 is NOT hidden globally — it renders disabled where the scenario closes it", async () => {
    await renderStep({ platform: "VMware vSphere", method: "IPI", minor: "4.22" });
    const arm = archCard("aarch64");
    expect(arm).not.toBeNull();
    expect(arm).toBeDisabled();
    // Still carries the matrix's reason, so hiding never replaces explaining.
    expect(arm.getAttribute("title")).toMatch(/4\.22/);
  });

  it("aarch64 is enabled where a scenario does offer it", async () => {
    await renderStep({ platform: "Bare Metal", method: "IPI", minor: "4.22" });
    expect(archCard("aarch64")).toBeEnabled();
  });

  it("visibility does not depend on the platform, an unmodelled platform included", async () => {
    await renderStep({ platform: "Totally Unknown Platform", method: "IPI", minor: "4.22" });
    expect(archCard("x86_64")).toBeDisabled();
    expect(archCard("aarch64")).toBeDisabled();
    expect(archCard("ppc64le")).toBeNull();
    expect(archCard("s390x")).toBeNull();
  });

  it("visibility does not depend on a release being chosen", async () => {
    await renderStep({ platform: "Bare Metal", method: "IPI", minor: null });
    expect(archCard("x86_64")).toBeEnabled();
    expect(archCard("ppc64le")).toBeNull();
    expect(archCard("s390x")).toBeNull();
  });

  it("a locked blueprint still draws the two renderable cards, both disabled", async () => {
    await renderStep({ platform: "Bare Metal", method: "IPI", minor: "4.22", locked: true });
    expect(archCard("x86_64")).toBeDisabled();
    expect(archCard("aarch64")).toBeDisabled();
    expect(archCard("ppc64le")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* THE AUTHORITY-DRIVEN PROOF                                           */
/*                                                                      */
/* The ONLY thing these tests change is the authority document. The     */
/* resolver and BlueprintStep.jsx are the shipped ones, imported fresh. */
/* If visibility were special-cased on architecture names, both would   */
/* fail.                                                                */
/* ------------------------------------------------------------------ */

/** The shipped projection for a minor, with one cell's disposition rewritten. */
function withDisposition(minor, scenarioId, architecture, disposition) {
  const doc = readDoc(PROJECTION_DIR, minor);
  const row = doc.matrix.find((r) => r.scenarioId === scenarioId);
  row.architectures[architecture] = {
    ...row.architectures[architecture],
    disposition,
    offered: disposition === "supported",
    summary: `Synthetic authority fixture: ${architecture} ${disposition} on ${scenarioId}.`,
  };
  return doc;
}

/** The shipped projection for a minor, with one architecture closed everywhere. */
function withArchitectureClosed(minor, architecture) {
  const doc = readDoc(PROJECTION_DIR, minor);
  for (const row of doc.matrix) {
    row.architectures[architecture] = {
      ...row.architectures[architecture],
      disposition: "hidden",
      offered: false,
      summary: `Synthetic authority fixture: ${architecture} closed on ${row.scenarioId}.`,
    };
  }
  return doc;
}

describe("DOC-215 — visibility follows the authority, with no component change", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    cleanup();
    for (const m of MINORS) vi.doUnmock(`../src/data/arch-support/${m}.json`);
  });

  async function renderWithSyntheticAuthority(docsByMinor, stateArgs) {
    for (const [minor, doc] of Object.entries(docsByMinor)) {
      vi.doMock(`../src/data/arch-support/${minor}.json`, () => ({ default: doc }));
    }
    const { AppContext } = await import("../src/store.jsx");
    const { default: BlueprintStep } = await import("../src/steps/BlueprintStep.jsx");
    render(
      <AppContext.Provider value={{ state: baseState(stateArgs), updateState: vi.fn(), setState: vi.fn() }}>
        <BlueprintStep />
      </AppContext.Provider>
    );
  }

  it("an onboarded ppc64le scenario makes the ppc64le card appear — data only", async () => {
    // Pretend a future tranche marked ppc64le supported on ONE modelled
    // scenario at ONE supported minor. Nothing else changes.
    await renderWithSyntheticAuthority(
      { "4.22": withDisposition("4.22", "bare-metal-ipi", "ppc64le", "supported") },
      { platform: "Bare Metal", method: "IPI", minor: "4.22" }
    );
    const card = archCard("ppc64le");
    expect(card, "ppc64le did not become renderable from the authority alone").not.toBeNull();
    expect(card).toBeEnabled();
    // s390x gained no scenario, so it stays hidden: the rule is per-architecture.
    expect(archCard("s390x")).toBeNull();
  });

  it("the onboarded architecture renders on OTHER platforms too, disabled, like any modelled architecture", async () => {
    await renderWithSyntheticAuthority(
      { "4.22": withDisposition("4.22", "bare-metal-ipi", "s390x", "supported") },
      { platform: "Nutanix", method: "IPI", minor: "4.22" }
    );
    const card = archCard("s390x");
    expect(card).not.toBeNull();
    expect(card).toBeDisabled();
  });

  it("conversely: an architecture that loses every scenario stops rendering — aarch64 is not special-cased", async () => {
    await renderWithSyntheticAuthority(
      Object.fromEntries(SUPPORTED_MINORS.map((m) => [m, withArchitectureClosed(m, "aarch64")])),
      { platform: "Bare Metal", method: "IPI", minor: "4.22" }
    );
    expect(archCard("aarch64"), "aarch64 is being rendered unconditionally").toBeNull();
    expect(archCard("x86_64")).toBeEnabled();
  });

  it("the pure fold is injectable and names no architecture", () => {
    const dataset = { "4.22": withDisposition("4.22", "vsphere-ipi", "s390x", "supported") };
    expect(computeRenderableArchitectures({ dataset, minors: ["4.22"] })).toContain("s390x");
    // An id outside the reachable surface cannot make an architecture visible.
    expect(
      computeRenderableArchitectures({ dataset, minors: ["4.22"], scenarioIds: ["bare-metal-ipi"] })
    ).not.toContain("s390x");
    // No minors, no dataset: closed, never open-by-default.
    expect(computeRenderableArchitectures({ dataset, minors: [] })).toEqual([]);
    expect(computeRenderableArchitectures({ dataset: {}, minors: SUPPORTED_MINORS })).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The upstream record must survive the UI change                       */
/* ------------------------------------------------------------------ */

describe("DOC-215 — hiding the control does not touch the support evidence", () => {
  for (const minor of MINORS) {
    it(`${minor}: canonical keeps full ppc64le and s390x cells, upstream evidence included`, () => {
      const doc = readDoc(CANONICAL_DIR, minor);
      expect(doc.matrix.length).toBe(12);
      for (const row of doc.matrix) {
        for (const arch of ["ppc64le", "s390x"]) {
          const cell = row.architectures[arch];
          expect(cell, `${minor}/${row.scenarioId}/${arch} missing`).toBeTruthy();
          expect(typeof cell.reason).toBe("string");
          expect(cell.reason.length).toBeGreaterThan(0);
          expect(Array.isArray(cell.provenance)).toBe(true);
          expect(typeof cell.upstreamSupport).toBe("string");
          expect(typeof cell.upstreamReason).toBe("string");
          expect(typeof cell.upstreamSource).toBe("string");
        }
      }
    });

    it(`${minor}: the frontend projection still carries both cells (slim shape: disposition + summary)`, () => {
      const doc = readDoc(PROJECTION_DIR, minor);
      expect(doc.matrix.length).toBe(12);
      for (const row of doc.matrix) {
        for (const arch of ["ppc64le", "s390x"]) {
          const cell = row.architectures[arch];
          expect(cell, `projection ${minor}/${row.scenarioId}/${arch} missing`).toBeTruthy();
          expect(cell.disposition).toBe("hidden");
          expect(typeof cell.summary).toBe("string");
          expect(cell.summary.length).toBeGreaterThan(0);
        }
      }
    });

    it(`${minor}: ppc64le and s390x remain FIPS-validated target-cluster architectures in the record`, () => {
      const doc = readDoc(CANONICAL_DIR, minor);
      expect(doc.fipsValidatedArchitectures.architectures).toContain("ppc64le");
      expect(doc.fipsValidatedArchitectures.architectures).toContain("s390x");
    });

    it(`${minor}: the record still attributes them to IBM Power and IBM Z, not to "OpenShift does not support"`, () => {
      const raw = readFileSync(join(CANONICAL_DIR, `${minor}.json`), "utf8");
      expect(raw).toMatch(/IBM Power/);
      expect(raw).toMatch(/IBM Z/);
    });
  }

  it("the product still models four architectures; only two are currently drawn", () => {
    expect(ARCHITECTURES).toEqual(["x86_64", "aarch64", "ppc64le", "s390x"]);
    expect(renderableArchitectures().length).toBeLessThan(ARCHITECTURES.length);
  });
});
