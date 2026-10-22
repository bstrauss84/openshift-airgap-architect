/**
 * DOC-203 — Global Strategy documentation links must name the selected minor.
 *
 * The step built docs.redhat.com links as `${selectedVersion || "4.0"}`, so a
 * state with no version linked OpenShift 4.0 — a release that does not exist —
 * and the FIPS link carried a second, guard-invisible copy of that fallback.
 * Now a link exists only for a selected, supported minor; otherwise the label
 * says a version must be selected.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { AppContext } from "../src/store.jsx";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";
import GlobalStrategyStep from "../src/steps/GlobalStrategyStep.jsx";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(() => Promise.resolve({})) }));

const DOCS_ROOT = "https://docs.redhat.com/en/documentation/openshift_container_platform/";

function awsState(minor) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  const version = minor
    ? { ...base.version, selectedMinor: minor, selectedPatch: `${minor}.0`, selectedVersion: `${minor}.0`, locked: true }
    : { _schemaVersion: 3, locked: false };
  const release = minor ? { ...base.release, channel: minor, patchVersion: `${minor}.0` } : {};
  return {
    ...base,
    version,
    release,
    blueprint: { ...base.blueprint, platform: "AWS GovCloud" },
    methodology: { method: "IPI" },
    globalStrategy: { ...base.globalStrategy, fips: true },
    platformConfig: { aws: {} }
  };
}

function renderStep(state) {
  return render(
    <AppContext.Provider value={{ state, updateState: vi.fn(), loading: false, startOver: vi.fn(), setState: vi.fn() }}>
      <GlobalStrategyStep />
    </AppContext.Provider>
  );
}

const docsHrefs = (container) =>
  [...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => h.startsWith(DOCS_ROOT));

afterEach(cleanup);

describe("DOC-203 Global Strategy docs links", () => {
  for (const minor of ["4.20", "4.21", "4.22"]) {
    it(`${minor}: every version-specific link names ${minor}, including FIPS`, () => {
      const { container } = renderStep(awsState(minor));
      const hrefs = docsHrefs(container);
      expect(hrefs.length).toBeGreaterThanOrEqual(2);
      for (const href of hrefs) expect(href.startsWith(`${DOCS_ROOT}${minor}/`)).toBe(true);
      expect(hrefs.some((h) => h.includes("fips"))).toBe(true);
      expect(container.querySelector("[data-docs-link-unavailable]")).toBeNull();
    });
  }

  it("no version selected: no fabricated 4.0 link, an honest label instead", () => {
    const { container } = renderStep(awsState(null));
    expect(docsHrefs(container)).toEqual([]);
    expect(container.innerHTML).not.toMatch(/openshift_container_platform\/4\.0/);
    const unavailable = [...container.querySelectorAll("[data-docs-link-unavailable]")];
    expect(unavailable.length).toBeGreaterThanOrEqual(2);
    for (const el of unavailable) expect(el.textContent).toMatch(/select an OpenShift version/);
  });

  it("an unsupported minor never renders the step at all (fails closed upstream)", () => {
    // The step reads version-gated catalogs, which throw UnsupportedVersionError
    // for 4.23; the app's recovery UI handles that before any step renders. So
    // there is no 4.23 link to suppress — and certainly no substituted one.
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderStep(awsState("4.23"))).toThrow(/4\.23 is not supported/);
    console.error.mockRestore();
  });
});
