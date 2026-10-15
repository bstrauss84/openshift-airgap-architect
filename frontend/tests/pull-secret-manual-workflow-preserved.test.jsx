/**
 * The manual pull-secret workflow survives the mounted-secret withdrawal.
 *
 * Correcting the unauthenticated disclosure removed exactly one thing: the
 * Blueprint field is no longer auto-filled from the backend-mounted secret,
 * because serving that credential to the browser is what the vulnerability
 * was. Everything the operator does by hand is unchanged, and this file is
 * the guard that it stays that way.
 *
 * Three pull-secret concepts are deliberately kept apart here, because they
 * have different security boundaries and conflating them is how the original
 * defect happened:
 *
 *   manually entered   — typed/pasted/uploaded by the operator, lives in
 *                        component state as blueprintPullSecretEphemeral
 *   session-retained   — the same value, carried to later wizard pages when
 *                        "Retain pull secret..." is ticked
 *   backend-mounted    — supplied by the deployment, used server-side only,
 *                        never sent to the browser
 *
 * Only the third changed. These tests cover the first two.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useCallback, useState } from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";

import BlueprintStep from "../src/steps/BlueprintStep.jsx";
import { AppContext } from "../src/store.jsx";
import { apiFetch } from "../src/api.js";

vi.mock("../src/api.js", () => ({
  apiFetch: vi.fn(),
  API_BASE: "http://localhost:4000",
}));

// Built at runtime rather than written as a base64-looking literal: a
// realistic credential-shaped string committed to source is itself a finding
// and trips the repository's own gitleaks scan.
const MARKER = `OAA_SYNTH_TYPED_${Math.random().toString(16).slice(2).toUpperCase()}`;
const TYPED_SECRET = JSON.stringify({
  auths: { "registry.redhat.io": { auth: MARKER, email: "op@example.invalid" } }
});

function unlockedState(overrides = {}) {
  return {
    _schemaVersion: 3,
    blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false, ...(overrides.blueprint || {}) },
    release: { channel: "4.21", patchVersion: "4.21.20", confirmed: false, followLatestMinor: true },
    version: {
      selectedMinor: "4.21", selectedPatch: "4.21.20",
      selectedChannel: "stable-4.21", selectedVersion: "4.21.20", locked: false,
    },
    methodology: { method: "Agent-Based Installer" },
    credentials: {},
    operators: {},
    ui: {},
  };
}

/** @param {boolean} mountedAvailable what the availability probe reports */
function installApiMock(mountedAvailable = true) {
  vi.mocked(apiFetch).mockImplementation((path) => {
    const p = String(path);
    if (p === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: mountedAvailable });
    if (p === "/api/cincinnati/channels") return Promise.resolve({ channels: [] });
    return Promise.resolve({});
  });
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

const secretField = (container) =>
  container.querySelector('textarea[aria-label="Red Hat pull secret JSON"]');

/**
 * Type into the secret field the way SecretInput actually works.
 *
 * SecretInput holds a local value and only lifts it to the parent on BLUR
 * (components/SecretInput.jsx handleBlur) — paste, drop and file upload lift
 * immediately, plain typing does not. A bare fireEvent.change therefore
 * updates nothing outside the component, which is a property of the input
 * widget and not of the pull-secret workflow. Committing with a blur is what
 * an operator does by moving on from the field.
 */
async function enterSecret(container, value) {
  const field = secretField(container);
  await act(async () => {
    fireEvent.change(field, { target: { value } });
    fireEvent.blur(field);
  });
  return field;
}

describe("manual pull-secret entry and retention still work", () => {
  beforeEach(() => { vi.mocked(apiFetch).mockReset(); });

  test("the operator can still type a pull secret into the Blueprint field", async () => {
    installApiMock(true);
    const { container, updates } = mountStep(unlockedState());
    await settle();

    expect(secretField(container)).not.toBeNull();
    expect(secretField(container).disabled).toBe(false);

    await enterSecret(container, TYPED_SECRET);

    const written = updates.filter((u) => u.blueprint?.blueprintPullSecretEphemeral);
    expect(written.length).toBeGreaterThan(0);
    expect(written.at(-1).blueprint.blueprintPullSecretEphemeral).toBe(TYPED_SECRET);
  });

  test("a mounted secret being present does not block manual entry", async () => {
    // The badge is informational. Before the fix the field was pre-filled and
    // the operator was overriding; now it starts empty and must still accept
    // input while the badge is showing.
    installApiMock(true);
    const { container, updates } = mountStep(unlockedState());
    await settle();

    expect(container.textContent).toContain("A mounted pull secret was detected");

    await enterSecret(container, TYPED_SECRET);
    const written = updates.filter((u) => u.blueprint?.blueprintPullSecretEphemeral);
    expect(written.at(-1).blueprint.blueprintPullSecretEphemeral).toBe(TYPED_SECRET);
  });

  test("the retain checkbox is offered once a secret has been entered", async () => {
    installApiMock(false);
    const { container } = mountStep(
      unlockedState({ blueprint: { blueprintPullSecretEphemeral: TYPED_SECRET } })
    );
    await settle();

    expect(container.textContent).toContain("Retain pull secret for use on subsequent pages");
  });

  test("ticking retain records the flag that drives carry-forward", async () => {
    // lockAndProceed in App.jsx copies blueprintPullSecretEphemeral into
    // credentials.pullSecretPlaceholder only when this flag is set, so the
    // flag reaching state is the contract the later wizard pages depend on.
    installApiMock(false);
    const { container, updates } = mountStep(
      unlockedState({ blueprint: { blueprintPullSecretEphemeral: TYPED_SECRET } })
    );
    await settle();

    const checkbox = [...container.querySelectorAll('input[type="checkbox"]')].find(
      (el) => el.closest("label")?.textContent?.includes("Retain pull secret")
        || el.parentElement?.parentElement?.textContent?.includes("Retain pull secret")
    );
    expect(checkbox, "the retain checkbox must still be rendered").toBeTruthy();

    await act(async () => { fireEvent.click(checkbox); });

    const flagged = updates.filter((u) => u.blueprint?.blueprintRetainPullSecret === true);
    expect(flagged.length).toBeGreaterThan(0);
    // The secret itself must survive the toggle, or carry-forward would copy nothing.
    expect(flagged.at(-1).blueprint.blueprintPullSecretEphemeral).toBe(TYPED_SECRET);
  });

  test("the badge disappears once the operator supplies their own secret", async () => {
    installApiMock(true);
    const { container } = mountStep(
      unlockedState({ blueprint: { blueprintPullSecretEphemeral: TYPED_SECRET } })
    );
    await settle();

    expect(container.textContent).not.toContain("A mounted pull secret was detected");
  });
});
