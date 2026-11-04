/**
 * v2.2.0 M4 finding: the Install archive-size field accepted fractions and
 * negatives, which made the generated imageset-config.yaml invalid for
 * oc-mirror (int64). The field now says so after blur; a whole number shows
 * nothing.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const harness = vi.hoisted(() => ({ initialState: null }));
vi.mock("../src/store.jsx", async (importOriginal) => {
  const { makeStoreMock } = await import("./helpers/store-harness.jsx");
  return makeStoreMock(await importOriginal(), harness);
});
vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(() => Promise.resolve({})), API_BASE: "" }));
const { AppProvider } = await import("../src/store.jsx");
const { default: OperatorsStep } = await import("../src/steps/OperatorsStep.jsx");
const mount = () => render(<AppProvider><OperatorsStep /></AppProvider>);

afterEach(cleanup);

const state = () => ({
  _schemaVersion: 3,
  version: { _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: "4.22.16", selectedChannel: "stable-4.22", locked: true },
  release: { channel: "4.22", patchVersion: "4.22.16", confirmed: true },
  blueprint: { platform: "Bare Metal", arch: "x86_64" },
  operators: { selected: [], catalogs: {} },
  imagesetConfig: {},
  ui: { visitedSteps: {} }
});

describe("Install archive chunk size", () => {
  it.each([["4.5"], ["-2"], ["0"]])("%s is explained after blur, not before", async (value) => {
    harness.initialState = state();
    mount();
    const input = screen.getByLabelText("Archive chunk size in GiB");
    fireEvent.change(input, { target: { value } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByRole("alert").textContent).toMatch(/whole number of GiB, 1 or more/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").closest(".field-control-support").parentElement.classList.contains("field-control-stack")).toBe(true);
  });

  it("a whole number is fine", () => {
    harness.initialState = state();
    mount();
    const input = screen.getByLabelText("Archive chunk size in GiB");
    fireEvent.change(input, { target: { value: "100" } });
    fireEvent.blur(input);
    expect(screen.queryByText(/whole number of GiB/)).toBeNull();
  });
});
