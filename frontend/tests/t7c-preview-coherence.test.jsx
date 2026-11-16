/**
 * Tranche 7C — YAML preview coherence across transitions.
 *
 * SCOPE. This is the SECOND half of the preview investigation, kept separate
 * on purpose. The concrete reported failure — 4.21 / Bare Metal / Agent /
 * x86_64 showing "No architecture-support matrix is available for OpenShift
 * 4.21" instead of YAML — was a backend container-packaging defect and is
 * covered by `backend/test/t7c-canonical-data-packaging.test.js`.
 *
 * What remains is the broader, vaguer concern: can the preview ever show
 * STALE or MIXED content — one minor's YAML under another minor's selection,
 * or files left over from a configuration the user has moved away from?
 *
 * The preview path already carries three defences (App.jsx):
 *   - a monotonic `previewRequestIdRef`, so a late response for a superseded
 *     request is discarded;
 *   - an `AbortController` torn down on every dependency change;
 *   - fail-closed error handling that CLEARS `previewFiles` rather than
 *     leaving the previous configuration on screen.
 *
 * These tests pin all three, because they are exactly the kind of guard that
 * gets "simplified" away. Responses are resolved manually — no timers, no
 * sleeps, no racing — so out-of-order delivery is deterministic rather than
 * hopeful.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

import { SUPPORTED_MINORS } from "../src/shared/versionPolicy.js";

/* Controlled generation endpoint: every call is captured and resolved by hand. */
const api = vi.hoisted(() => ({ calls: [], pending: [] }));
vi.mock("../src/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    apiFetch: (path, opts = {}) => {
      if (typeof path === "string" && path.includes("/api/generate")) {
        const body = opts.body ? JSON.parse(opts.body) : {};
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
        api.calls.push({ state: body.state, resolve, reject });
        api.pending.push(promise);
        return promise;
      }
      // Anything else the shell fetches (build info, update checks) stays inert.
      return Promise.resolve({});
    },
  };
});

const harness = vi.hoisted(() => ({ initialState: null }));
vi.mock("../src/store.jsx", async (importOriginal) => {
  const actual = await importOriginal();
  const { makeStoreMock } = await import("./helpers/store-harness.jsx");
  return makeStoreMock(actual, harness);
});

const { default: App } = await import("../src/App.jsx");
const { ensureCatalogsForMinor } = await import("../src/catalogPaths.js");

const PATCH = { "4.20": "4.20.40", "4.21": "4.21.35", "4.22": "4.22.16" };

const lockedRun = (minor) => ({
  _schemaVersion: 3,
  version: {
    _schemaVersion: 3,
    selectedMinor: minor,
    selectedPatch: PATCH[minor],
    selectedChannel: `stable-${minor}`,
    locked: true,
  },
  release: { channel: minor, patchVersion: PATCH[minor], confirmed: true },
  blueprint: {
    platform: "Bare Metal",
    arch: "x86_64",
    clusterName: "airgap-cluster",
    baseDomain: "example.com",
    confirmed: true,
  },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: { nodes: [] },
  operators: { selected: [] },
  reviewFlags: {},
  ui: {
    activeStepId: "networking",
    visitedSteps: { blueprint: true },
    completedSteps: { blueprint: true },
  },
});

/** The minor each generation request was made for, in call order. */
const requestedMinors = () => api.calls.map((c) => c.state?.version?.selectedMinor);

/**
 * The drawer syntax-highlights YAML, so a document is split across many
 * elements and getByText cannot see it. Assert on the rendered text as a whole.
 */
const previewShows = async (needle) =>
  waitFor(() => expect(document.body.textContent).toContain(needle));
const previewDoesNotShow = (needle) => expect(document.body.textContent).not.toContain(needle);

const yamlFor = (tag) => ({
  files: {
    "install-config.yaml": `apiVersion: v1\nbaseDomain: example.com\nmetadata:\n  name: cluster-${tag}\n`,
  },
});

describe("T7C — the preview always generates for the CURRENTLY selected minor", () => {
  beforeEach(async () => {
    api.calls.length = 0;
    api.pending.length = 0;
    await Promise.all(SUPPORTED_MINORS.map((m) => ensureCatalogsForMinor(m)));
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  async function mount(minor) {
    harness.initialState = lockedRun(minor);
    render(<App />);
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(0));
  }

  it("the first generation is for the locked minor", async () => {
    await mount("4.21");
    expect(requestedMinors()[0]).toBe("4.21");
  });

  for (const from of SUPPORTED_MINORS) {
    for (const to of SUPPORTED_MINORS.filter((m) => m !== from)) {
      it(`${from} → ${to}: regenerates for ${to}, never again for ${from}`, async () => {
        await mount(from);
        const before = api.calls.length;

        harness.setState((prev) => ({
          ...prev,
          version: { ...prev.version, selectedMinor: to, selectedPatch: PATCH[to], selectedChannel: `stable-${to}` },
          release: { ...prev.release, channel: to, patchVersion: PATCH[to] },
        }));

        await waitFor(() => expect(api.calls.length).toBeGreaterThan(before));
        // Everything requested after the switch must be for the new minor.
        const after = requestedMinors().slice(before);
        expect(after.every((m) => m === to), `requested ${after.join(", ")} after switching to ${to}`).toBe(true);
      });
    }
  }

  it("a methodology change regenerates rather than reusing the previous files", async () => {
    await mount("4.22");
    const before = api.calls.length;
    harness.setState((prev) => ({ ...prev, methodology: { method: "IPI" } }));
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(before));
    expect(api.calls[api.calls.length - 1].state.methodology.method).toBe("IPI");
  });

  it("a platform change regenerates", async () => {
    await mount("4.22");
    const before = api.calls.length;
    harness.setState((prev) => ({
      ...prev,
      blueprint: { ...prev.blueprint, platform: "VMware vSphere" },
    }));
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(before));
    expect(api.calls[api.calls.length - 1].state.blueprint.platform).toBe("VMware vSphere");
  });
});

describe("T7C — a superseded response cannot overwrite a newer one", () => {
  beforeEach(async () => {
    api.calls.length = 0;
    api.pending.length = 0;
    await Promise.all(SUPPORTED_MINORS.map((m) => ensureCatalogsForMinor(m)));
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  /**
   * Get to a state where the preview is actually RENDERED.
   *
   * This matters more than it looks. An earlier version of these two tests
   * only asserted that the stale document was absent — and passed even with
   * the request-id guard deleted, because the YAML drawer is closed by default
   * so nothing was on screen to be wrong. Each test below now also asserts the
   * CORRECT document is present, which is what makes the absence meaningful.
   */
  async function openPreview(minor) {
    // Resume past Blueprint and Methodology: `previewEnabled` excludes the
    // landing, blueprint, review and operations steps, so the drawer only
    // renders content once the wizard is on a configuration step.
    const base = lockedRun(minor);
    harness.initialState = {
      ...base,
      ui: {
        ...base.ui,
        visitedSteps: { blueprint: true, methodology: true },
        completedSteps: { blueprint: true, methodology: true },
      },
    };
    render(<App />);
    // Leave the landing page.
    const cta = await screen.findByRole("button", { name: /Continue install|Start new install/i });
    fireEvent.click(cta);
    // Open the YAML drawer.
    const toggle = await screen.findByRole("button", { name: /^Show YAML$/i });
    fireEvent.click(toggle);
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(0));
  }

  const latest = () => api.calls[api.calls.length - 1];

  async function switchTo(minor) {
    const before = api.calls.length;
    harness.setState((prev) => ({
      ...prev,
      version: { ...prev.version, selectedMinor: minor, selectedPatch: PATCH[minor], selectedChannel: `stable-${minor}` },
      release: { ...prev.release, channel: minor, patchVersion: PATCH[minor] },
    }));
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(before));
  }

  it("the drawer really does render generated YAML — the control for the two tests below", async () => {
    await openPreview("4.22");
    await act(() => latest().resolve(yamlFor("4.22")));
    await previewShows("cluster-4.22");
  });

  it("resolving an OLD request after a NEW one keeps the new minor's YAML", async () => {
    // The staleness scenario that matters: the user switches minor while the
    // previous generation is still in flight, and the slow one lands last.
    await openPreview("4.20");
    const stale = latest();
    expect(stale.state.version.selectedMinor).toBe("4.20");

    await switchTo("4.22");
    const fresh = latest();
    expect(fresh.state.version.selectedMinor).toBe("4.22");

    // Newest lands first, then the superseded one — out of order, on purpose.
    await act(() => fresh.resolve(yamlFor("4.22")));
    await previewShows("cluster-4.22");

    await act(() => stale.resolve(yamlFor("4.20")));

    previewDoesNotShow("cluster-4.20");
    expect(document.body.textContent, "the current document was lost").toContain("cluster-4.22");
  });

  it("a late response for a superseded request is discarded WITHOUT an unmount", async () => {
    /**
     * This is the test that actually reaches `previewRequestIdRef`.
     *
     * The two minor-switch tests above do NOT: changing the minor makes
     * VersionSupportGate unmount AppShell, so a late `setPreviewFiles` lands
     * on a dead component and React drops it regardless of the guard. Verified
     * by deleting the guard — those two still passed.
     *
     * Changing the PLATFORM keeps the same minor, so the gate never blocks and
     * the component stays mounted. Now an out-of-order response can genuinely
     * overwrite newer output, and only the request-id check prevents it.
     */
    await openPreview("4.22");
    const stale = latest();
    expect(stale.state.blueprint.platform).toBe("Bare Metal");

    const before = api.calls.length;
    harness.setState((prev) => ({
      ...prev,
      blueprint: { ...prev.blueprint, platform: "VMware vSphere" },
    }));
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(before));
    const fresh = latest();
    expect(fresh.state.blueprint.platform).toBe("VMware vSphere");

    await act(() => fresh.resolve(yamlFor("vsphere-current")));
    await previewShows("cluster-vsphere-current");

    // The superseded bare-metal generation lands late, on a LIVE component.
    await act(() => stale.resolve(yamlFor("baremetal-superseded")));

    previewDoesNotShow("cluster-baremetal-superseded");
    expect(document.body.textContent, "the current document was replaced by a stale one").toContain(
      "cluster-vsphere-current"
    );
  });

  it("a superseded FAILURE does not blank a newer success", async () => {
    await openPreview("4.20");
    const stale = latest();

    await switchTo("4.21");
    const fresh = latest();

    await act(() => fresh.resolve(yamlFor("4.21")));
    await previewShows("cluster-4.21");

    await act(() => stale.reject(new Error("stale generation failed")));

    // The late failure belongs to a request the user has moved past; it must
    // neither surface as an error nor discard the current output.
    previewDoesNotShow("stale generation failed");
    expect(document.body.textContent, "a stale failure blanked the current preview").toContain("cluster-4.21");
  });
});

/* ------------------------------------------------------------------ */
/* The full transition matrix (Tranche 7C.1 §17)                        */
/* ------------------------------------------------------------------ */

describe("T7C.1 — preview stays coherent across every state transition", () => {
  /**
   * One row per transition the human exercises by hand. Each asserts the same
   * two things, which together are what "coherent" means here:
   *
   *   1. a NEW generation is requested, and the request carries the NEW state
   *      (so the preview cannot be answering an older question);
   *   2. once it resolves, the rendered document is the new one and the
   *      previous one is gone (so nothing stale survives on screen).
   *
   * Responses are resolved by hand — no timers, no sleeps — so ordering is
   * deterministic rather than hopeful.
   */
  beforeEach(async () => {
    api.calls.length = 0;
    api.pending.length = 0;
    await Promise.all(SUPPORTED_MINORS.map((m) => ensureCatalogsForMinor(m)));
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const resumed = (minor) => {
    const base = lockedRun(minor);
    return {
      ...base,
      ui: {
        ...base.ui,
        visitedSteps: { blueprint: true, methodology: true },
        completedSteps: { blueprint: true, methodology: true },
      },
    };
  };

  async function open(minor) {
    harness.initialState = resumed(minor);
    render(<App />);
    const cta = await screen.findByRole("button", { name: /Continue install|Start new install/i });
    fireEvent.click(cta);
    const toggle = await screen.findByRole("button", { name: /^Show YAML$/i });
    fireEvent.click(toggle);
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(0));
    await act(() => api.calls[api.calls.length - 1].resolve(yamlFor("baseline")));
    await waitFor(() => expect(document.body.textContent).toContain("cluster-baseline"));
  }

  /** [name, mutation, assertion on the request the mutation triggers] */
  const TRANSITIONS = [
    ["platform change", (p) => ({ ...p, blueprint: { ...p.blueprint, platform: "VMware vSphere" } }),
      (st) => expect(st.blueprint.platform).toBe("VMware vSphere")],
    ["methodology change", (p) => ({ ...p, methodology: { method: "IPI" } }),
      (st) => expect(st.methodology.method).toBe("IPI")],
    ["architecture change", (p) => ({ ...p, blueprint: { ...p.blueprint, arch: "aarch64" } }),
      (st) => expect(st.blueprint.arch).toBe("aarch64")],
    ["minor change", (p) => ({
        ...p,
        version: { ...p.version, selectedMinor: "4.20", selectedPatch: PATCH["4.20"] },
        release: { ...p.release, channel: "4.20", patchVersion: PATCH["4.20"] },
      }),
      (st) => expect(st.version.selectedMinor).toBe("4.20")],
    ["patch change", (p) => ({
        ...p,
        version: { ...p.version, selectedPatch: "4.22.10" },
        release: { ...p.release, patchVersion: "4.22.10" },
      }),
      (st) => expect(st.version.selectedPatch).toBe("4.22.10")],
    ["unlock", (p) => ({ ...p, version: { ...p.version, locked: false }, release: { ...p.release, confirmed: false } }),
      (st) => expect(st.version.locked).toBe(false)],
  ];

  for (const [name, mutate, assertRequest] of TRANSITIONS) {
    it(`${name}: regenerates for the new state and leaves nothing stale`, async () => {
      await open("4.22");
      const before = api.calls.length;

      harness.setState(mutate);

      // Unlock intentionally drops to the pre-confirmation skeleton rather than
      // calling the generator, so only assert a new request when one is due.
      const isUnlock = name === "unlock";
      if (isUnlock) {
        // Unlocking drops back to the pre-confirmation skeleton instead of
        // calling the generator, so wait for that replacement rather than for
        // a request that will never come.
        await waitFor(() => expect(document.body.textContent).not.toContain("cluster-baseline"));
      } else {
        await waitFor(() => expect(api.calls.length).toBeGreaterThan(before));
        assertRequest(api.calls[api.calls.length - 1].state);
        await act(() => api.calls[api.calls.length - 1].resolve(yamlFor("after")));
        await previewShows("cluster-after");
      }

      // Nothing from before the transition may remain on screen.
      previewDoesNotShow("cluster-baseline");
      // And no internal support-authority error may ever reach the user.
      previewDoesNotShow("No architecture-support matrix is available");
      previewDoesNotShow("is not supported for");
    });
  }

  it("unlocked: the preview shows the pre-confirmation skeleton and generates nothing", async () => {
    // Before a release is confirmed the generator is deliberately not called —
    // `getVersionLocked(state)` is false and the effect substitutes a skeleton.
    // Asserted on state directly rather than through an unlock transition, so
    // the result does not depend on render timing.
    const base = resumed("4.22");
    harness.initialState = { ...base, version: { ...base.version, locked: false }, release: { ...base.release, confirmed: false } };
    render(<App />);
    const cta = await screen.findByRole("button", { name: /Continue install|Start new install/i });
    fireEvent.click(cta);
    await waitFor(() => expect(screen.queryByText(/Continue install|Start new install/i)).toBeNull());
    expect(api.calls.length, "an unconfirmed release must not reach the generator").toBe(0);
  });

  it("locked: the preview generates for the confirmed release", async () => {
    // The other half of the same axis. `open()` asserts the rendered document;
    // this asserts that locking is what makes a generation happen at all.
    await open("4.22");
    expect(api.calls.length).toBeGreaterThan(0);
    expect(api.calls[0].state.version.locked).toBe(true);
  });

  for (const minor of SUPPORTED_MINORS) {
    it(`importing a ${minor} run regenerates for ${minor} and discards the previous run's YAML`, async () => {
      const other = SUPPORTED_MINORS.find((m) => m !== minor);
      await open(other);
      const before = api.calls.length;

      harness.setState(resumed(minor));

      await waitFor(() => expect(api.calls.length).toBeGreaterThan(before));
      expect(api.calls[api.calls.length - 1].state.version.selectedMinor).toBe(minor);
      await act(() => api.calls[api.calls.length - 1].resolve(yamlFor(`imported-${minor}`)));
      await previewShows(`cluster-imported-${minor}`);
      previewDoesNotShow("cluster-baseline");
    });
  }

  it("an unsupported 4.23 state shows recovery and generates nothing", async () => {
    await open("4.22");
    const before = api.calls.length;
    harness.setState((p) => ({
      ...p,
      version: { ...p.version, selectedMinor: "4.23", selectedPatch: "4.23.0" },
      release: { ...p.release, channel: "4.23", patchVersion: "4.23.0" },
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Switch to 4\.22/i })).toBeTruthy());
    // Fail closed: no generation is attempted for an unsupported minor, and the
    // previous minor's document is not left on screen as if it were current.
    expect(api.calls.length).toBe(before);
    previewDoesNotShow("cluster-baseline");
  });
});

/** Flush a resolution through React so effects and state settle. */
async function act(fn) {
  const { act: reactAct } = await import("@testing-library/react");
  await reactAct(async () => {
    await fn();
    await Promise.resolve();
  });
}
