/**
 * v2.2.0 M3 — Install Operators: a superseded catalog load cannot overwrite the
 * current minor.
 *
 * The mount-time catalog load (keyed on version + lock) had no cancellation.
 * If the locked minor changed while `/api/operators/status?version=<old>` was
 * in flight, the late answer still wrote the OLD minor's catalogs, stamped
 * `operators.version` with the old minor and reconciled the selections
 * against it. This drives that exact interleaving through the real step and
 * asserts the late answer is dropped, and that no loading indicator is left
 * spinning when the next effect run returns early (Unlock).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";
import { makeStoreMock } from "./helpers/store-harness.jsx";

const handle = vi.hoisted(() => ({ initialState: null }));
vi.mock("../src/store.jsx", async (importOriginal) => makeStoreMock(await importOriginal(), handle));
vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

const { AppProvider, useApp } = await import("../src/store.jsx");
const { default: OperatorsStep } = await import("../src/steps/OperatorsStep.jsx");
const { apiFetch } = await import("../src/api.js");

const lockedState = (minor, locked = true) => ({
  _schemaVersion: 3,
  version: { _schemaVersion: 3, selectedMinor: minor, selectedPatch: `${minor}.3`, selectedChannel: `stable-${minor}`, locked, confirmedByUser: locked },
  release: { channel: minor, patchVersion: `${minor}.3`, confirmed: locked },
  blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: true },
  methodology: { method: "Agent-Based Installer" },
  credentials: {},
  operators: {
    selected: [{ id: "redhat:web-terminal", name: "web-terminal" }], // intent awaiting resolution
    scenarios: {}, pendingScenarios: {}, scenarioAdded: {}, catalogs: {}, version: null, scanJobs: {}, stale: false, fastMode: true
  },
  imagesetConfig: {},
  reviewFlags: {},
  ui: { visitedSteps: { operators: true }, activeStepId: "operators" }
});

const catalogFor = (minor) => ({ redhat: { results: [{ id: "redhat:web-terminal", name: "web-terminal", defaultChannel: `ch-${minor}` }], updatedAt: "t" }, certified: { results: [] }, community: { results: [] } });

let latest = null;
const Probe = () => { latest = useApp().state; return null; };

async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

let pending;
beforeEach(() => {
  pending = {};
  vi.clearAllMocks();
  apiFetch.mockImplementation((path) => {
    const m = /\/api\/operators\/status\?version=(.+)$/.exec(path);
    if (m) return new Promise((resolve) => { pending[m[1]] = () => resolve(catalogFor(m[1])); });
    if (path.startsWith("/api/operators/credentials")) return Promise.resolve({ available: false });
    return Promise.resolve({});
  });
});
afterEach(cleanup);

describe("Install catalog load: superseded responses are dropped", () => {
  it("a late 4.21 answer after the minor changed to 4.22 does not stamp 4.21", async () => {
    handle.initialState = lockedState("4.21");
    render(<AppProvider><Probe /><OperatorsStep /></AppProvider>);
    await flush();
    expect(pending["4.21"]).toBeTypeOf("function");

    await act(async () => { handle.setState(lockedState("4.22")); });
    await flush();
    expect(pending["4.22"]).toBeTypeOf("function");

    await act(async () => { pending["4.22"](); });
    await flush();
    expect(latest.operators.version).toBe("4.22");
    expect(latest.operators.selected[0].defaultChannel).toBe("ch-4.22");

    // The superseded 4.21 request answers last.
    await act(async () => { pending["4.21"](); });
    await flush();
    expect(latest.operators.version).toBe("4.22");
    expect(latest.operators.selected[0].defaultChannel).toBe("ch-4.22");
    expect(latest.operators.selected[0].catalogImage).toMatch(/:v4\.22$/);
  });

  it("unlocking while a load is in flight leaves no 'Loading operators…' spinner", async () => {
    handle.initialState = lockedState("4.21");
    const { container } = render(<AppProvider><Probe /><OperatorsStep /></AppProvider>);
    await flush();
    expect(container.textContent).toContain("Loading operators…");
    await act(async () => { handle.setState(lockedState("4.21", false)); }); // next effect run returns early
    await flush();
    expect(container.textContent).not.toContain("Loading operators…");
    await act(async () => { pending["4.21"](); });
    await flush();
    expect(latest.operators.version).toBe(null); // the cancelled answer wrote nothing
  });
});
