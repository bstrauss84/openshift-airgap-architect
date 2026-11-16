/**
 * The browser must never ask the backend for the raw mounted pull secret.
 *
 * BlueprintStep used to probe /api/secrets/rh-pull-secret and, when a secret
 * was mounted, follow up with /api/secrets/rh-pull-secret/content and paste
 * the raw credential into the pull-secret field. The backend has no
 * authentication on any route and the shipped OpenShift overlay publishes it
 * on an unauthenticated Route, so that endpoint handed the operator's pull
 * secret to anyone who could reach the API. It is withdrawn (410).
 *
 * The availability probe is deliberately kept — the UI still tells the
 * operator a mounted secret exists — so "the secret is gone from the browser"
 * and "the feature disappeared" are different outcomes, and these tests
 * distinguish them.
 *
 * NON-VACUITY
 * -----------
 * Asserting "/content was not called" is worthless if the component never
 * reached the point of calling anything. Every such assertion is paired with
 * a control proving the availability probe DID fire with available:true —
 * the exact condition that used to trigger the follow-up fetch.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useCallback, useState } from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

import BlueprintStep from "../src/steps/BlueprintStep.jsx";
import { AppContext } from "../src/store.jsx";
import { apiFetch } from "../src/api.js";

vi.mock("../src/api.js", () => ({
  apiFetch: vi.fn(),
  API_BASE: "http://localhost:4000",
}));

const CANARY_SECRET = JSON.stringify({ auths: { "registry.redhat.io": { auth: "CANARY" } } });

function unlockedState(overrides = {}) {
  return {
    _schemaVersion: 3,
    blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false },
    release: { channel: "4.21", patchVersion: "4.21.20", confirmed: false, followLatestMinor: true },
    version: {
      selectedMinor: "4.21",
      selectedPatch: "4.21.20",
      selectedChannel: "stable-4.21",
      selectedVersion: "4.21.20",
      locked: false,
    },
    methodology: { method: "Agent-Based Installer" },
    operators: {},
    ui: {},
    ...overrides,
  };
}

/**
 * @param {boolean} available what the availability probe reports
 * @returns {{paths: string[]}} every path the component requested
 */
function installApiMock(available) {
  const paths = [];
  vi.mocked(apiFetch).mockImplementation((path) => {
    const p = String(path);
    paths.push(p);
    if (p === "/api/secrets/rh-pull-secret") return Promise.resolve({ available });
    // Deliberately still answered, and with a real-looking secret. If the
    // component regresses and calls it, the credential genuinely lands in
    // component state and the assertions below catch it — rather than the
    // mock quietly returning undefined and hiding the regression.
    if (p === "/api/secrets/rh-pull-secret/content") {
      return Promise.resolve({ pullSecret: CANARY_SECRET });
    }
    if (p === "/api/cincinnati/channels") return Promise.resolve({ channels: [] });
    return Promise.resolve({});
  });
  return { paths };
}

function mountStep(initialState) {
  const updates = [];
  const Host = () => {
    const [state, setState] = useState(initialState);
    const updateState = useCallback((patch) => {
      updates.push(patch);
      setState((prev) => ({ ...prev, ...patch }));
    }, []);
    return (
      <AppContext.Provider value={{ state, updateState, loading: false, startOver: () => {} }}>
        <BlueprintStep />
      </AppContext.Provider>
    );
  };
  return { ...render(<Host />), updates };
}

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

describe("the browser never requests the raw mounted pull secret", () => {
  beforeEach(() => { vi.mocked(apiFetch).mockReset(); });

  test("does not fetch /content even when a mounted secret IS available", async () => {
    const { paths } = installApiMock(true);
    mountStep(unlockedState());
    await settle();

    // Control first: without this the assertion below could pass simply
    // because the component never probed at all.
    expect(paths).toContain("/api/secrets/rh-pull-secret");
    expect(paths).not.toContain("/api/secrets/rh-pull-secret/content");
  });

  test("never puts a mounted secret into wizard state", async () => {
    installApiMock(true);
    const { updates } = mountStep(unlockedState());
    await settle();

    const serialized = JSON.stringify(updates);
    expect(serialized).not.toContain("CANARY");
    expect(serialized).not.toContain("blueprintPullSecretEphemeral");
  });

  test("leaves the pull secret field empty rather than pre-filling it", async () => {
    installApiMock(true);
    const { container } = mountStep(unlockedState());
    await settle();

    const field = container.querySelector('textarea[aria-label="Red Hat pull secret JSON"]');
    expect(field).not.toBeNull();
    expect(field.value).toBe("");
  });

  test("still tells the operator a mounted secret exists", async () => {
    installApiMock(true);
    const { container } = mountStep(unlockedState());
    await settle();

    expect(container.textContent).toContain("A mounted pull secret was detected");
    // and it must not be a hint that leaks the credential itself
    expect(container.textContent).not.toContain("CANARY");
  });

  test("says nothing when no secret is mounted", async () => {
    const { paths } = installApiMock(false);
    const { container } = mountStep(unlockedState());
    await settle();

    expect(paths).toContain("/api/secrets/rh-pull-secret");
    expect(container.textContent).not.toContain("A mounted pull secret was detected");
  });
});
