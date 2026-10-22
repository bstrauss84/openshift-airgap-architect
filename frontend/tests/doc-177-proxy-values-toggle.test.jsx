/**
 * DOC-177 — the "Proxy values" export switch.
 *
 * The backend half (backend/test/doc-177-proxy-values-export.test.js) proves the
 * downloaded bundle honours `exportOptions.inclusion.proxyValues`. This half
 * proves the Review step actually writes that flag, independently of every
 * credential flag, and that its description says what the switch does.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

const handle = vi.hoisted(() => ({ state: null, updateState: null }));

vi.mock("../src/api.js", () => ({
  apiFetch: vi.fn(() => Promise.resolve({ runtimeArch: "amd64", localBinaryArch: "amd64" })),
  API_BASE: "http://localhost:4000"
}));

vi.mock("../src/store.jsx", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useApp: () => ({ state: handle.state, updateState: handle.updateState, setState: handle.updateState })
  };
});

const { default: ReviewStep } = await import("../src/steps/ReviewStep.jsx");

function baseState(exportOptions) {
  return {
    _schemaVersion: 3,
    version: { selectedMinor: "4.22", selectedPatch: "4.22.16", selectedChannel: "stable-4.22", locked: true },
    release: { channel: "4.22", patchVersion: "4.22.16" },
    blueprint: { platform: "Bare Metal", clusterName: "airgap", baseDomain: "example.com", arch: "x86_64" },
    methodology: { method: "IPI" },
    globalStrategy: { proxyEnabled: true, proxies: { httpProxy: "http://proxy.example:3128" } },
    networking: {},
    hostInventory: { nodes: [] },
    operators: { selected: [] },
    credentials: {},
    trust: {},
    exportOptions,
    ui: {}
  };
}

function renderReview(initial) {
  let current = initial;
  const rerenderers = [];
  handle.state = current;
  handle.updateState = (patch) => {
    current = { ...current, ...patch };
    handle.state = current;
    act(() => { rerenderers.forEach((fn) => fn()); });
  };
  const Harness = () => {
    const [, bump] = React.useReducer((n) => n + 1, 0);
    if (!rerenderers.includes(bump)) rerenderers.push(bump);
    return <ReviewStep />;
  };
  render(<Harness />);
  return { getState: () => current };
}

const proxySwitch = () => screen.getByLabelText("Include proxy values");

beforeEach(() => { handle.state = null; handle.updateState = null; });
afterEach(() => cleanup());

describe("DOC-177 Proxy values switch", () => {
  it("is on by default, including for a legacy state with no inclusion map", () => {
    renderReview(baseState({ includeCredentials: false }));
    expect(proxySwitch()).toHaveAttribute("aria-checked", "true");
  });

  it("turning it off writes inclusion.proxyValues=false and leaves credential flags alone", () => {
    const { getState } = renderReview(baseState({ includeCredentials: false, includeCertificates: true }));
    act(() => { fireEvent.click(proxySwitch()); });
    const opts = getState().exportOptions;
    expect(opts.inclusion.proxyValues).toBe(false);
    expect(opts.includeCredentials).toBe(false);
    expect(opts.includeCertificates).toBe(true);
    expect(opts.inclusion.pullSecret).toBe(false);
    expect(proxySwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("turning it back on restores inclusion.proxyValues=true", () => {
    const { getState } = renderReview(baseState({ includeCredentials: false, inclusion: { proxyValues: false } }));
    expect(proxySwitch()).toHaveAttribute("aria-checked", "false");
    act(() => { fireEvent.click(proxySwitch()); });
    expect(getState().exportOptions.inclusion.proxyValues).toBe(true);
  });

  it("describes exactly what it governs", () => {
    renderReview(baseState({ includeCredentials: false }));
    expect(screen.getByText(/install-config\.yaml, Field Manual and any high-side runtime package/)).toBeInTheDocument();
    expect(screen.getByText(/REPLACE_WITH_… marker/)).toBeInTheDocument();
  });
});
