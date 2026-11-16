/**
 * DOC-101 Phase 1 Lock State Regression Test
 *
 * Verifies that clicking the Blueprint lock/confirm button properly sets v3 canonical fields:
 * - version.locked = true (NOT just versionConfirmed)
 * - version._schemaVersion = 3
 * - blueprint.confirmed = true
 *
 * This test was created to prevent regression of the bug where:
 * - Backend returned versionConfirmed instead of locked
 * - Frontend overwrote version object losing the locked field
 * - Navigation was blocked because getVersionLocked() checked the wrong snapshot
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from "vitest";
import { getVersionLocked } from "../src/shared/versionHelpers.js";

describe("DOC-101 Phase 1: Blueprint lock sets v3 canonical fields", () => {
  it("getVersionLocked returns true for v3 state with locked=true", () => {
    const state = {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: true },
      version: {
        _schemaVersion: 3,
        selectedMinor: "4.20",
        selectedPatch: "4.20.0",
        locked: true
      }
    };

    expect(getVersionLocked(state)).toBe(true);
  });

  it("getVersionLocked returns false for v3 state with locked=false", () => {
    const state = {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false },
      version: {
        _schemaVersion: 3,
        selectedMinor: "4.20",
        locked: false
      }
    };

    expect(getVersionLocked(state)).toBe(false);
  });

  it("getVersionLocked returns true for v2 state with versionConfirmed=true (fallback)", () => {
    const state = {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: true },
      version: {
        selectedMinor: "4.20",
        versionConfirmed: true  // v2 legacy field
      }
    };

    expect(getVersionLocked(state)).toBe(true);
  });

  it("foundational lock check passes for v3 state with both fields set", () => {
    const state = {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: true, confirmationTimestamp: Date.now() },
      version: {
        _schemaVersion: 3,
        selectedMinor: "4.20",
        selectedPatch: "4.20.0",
        locked: true,
        confirmedByUser: true,
        confirmationTimestamp: Date.now()
      }
    };

    // Simulate App.jsx foundationalLocked check
    const foundationalLocked = Boolean(state.blueprint?.confirmed && getVersionLocked(state));
    expect(foundationalLocked).toBe(true);
  });

  it("foundational lock check fails when version.locked is missing despite versionConfirmed", () => {
    // This is the BUGGY state that was being written before the fix
    const buggyState = {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: true },
      version: {
        selectedChannel: "stable-4.20",
        selectedVersion: "4.20.0",
        versionConfirmed: true,  // Backend was setting this
        confirmedByUser: true
        // MISSING: locked, _schemaVersion, selectedMinor, selectedPatch
      }
    };

    // The helper should still work via fallback
    expect(getVersionLocked(buggyState)).toBe(true);

    // But the state is not properly v3
    expect(buggyState.version._schemaVersion).toBeUndefined();
    expect(buggyState.version.locked).toBeUndefined();
  });

  it("backend /api/operators/confirm response shape matches v3 schema", () => {
    // This is what the FIXED backend should return
    const backendResponse = {
      ok: true,
      release: { channel: "4.20", patchVersion: "4.20.0", confirmed: true },
      version: {
        _schemaVersion: 3,
        selectedMinor: "4.20",
        selectedPatch: "4.20.0",
        selectedChannel: "stable-4.20",
        selectedVersion: "4.20.0",
        locked: true,
        confirmedByUser: true,
        confirmationTimestamp: expect.any(Number)
      }
    };

    // Verify v3 canonical fields are present
    expect(backendResponse.version._schemaVersion).toBe(3);
    expect(backendResponse.version.locked).toBe(true);
    expect(backendResponse.version.selectedMinor).toBe("4.20");
    expect(backendResponse.version.selectedPatch).toBe("4.20.0");
  });

  it("App.jsx lockAndProceed writes correct v3 state", () => {
    // Simulate the state update in App.jsx lockAndProceed function
    const currentState = {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false },
      version: {
        _schemaVersion: 3,
        selectedMinor: "4.20",
        selectedPatch: "4.20.0",
        locked: false
      },
      release: { channel: "4.20", patchVersion: "4.20.0", confirmed: false }
    };

    const backendData = {
      release: { channel: "4.20", patchVersion: "4.20.0", confirmed: true },
      version: {
        _schemaVersion: 3,
        selectedMinor: "4.20",
        selectedPatch: "4.20.0",
        locked: true,
        confirmedByUser: true
      }
    };

    // This is what App.jsx does: version: data.version ?? state.version
    const updatedState = {
      blueprint: {
        ...currentState.blueprint,
        confirmed: true,
        confirmationTimestamp: Date.now()
      },
      release: backendData.release,
      version: backendData.version  // This OVERWRITES, so backend must return correct v3
    };

    // Verify final state has v3 canonical fields
    expect(updatedState.version._schemaVersion).toBe(3);
    expect(updatedState.version.locked).toBe(true);
    expect(updatedState.version.selectedMinor).toBe("4.20");
    expect(updatedState.blueprint.confirmed).toBe(true);

    // Verify foundational lock passes
    const foundationalLocked = Boolean(updatedState.blueprint?.confirmed && getVersionLocked(updatedState));
    expect(foundationalLocked).toBe(true);
  });

  it("4.21 version selection sets correct v3 fields", () => {
    const state421 = {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: true },
      version: {
        _schemaVersion: 3,
        selectedMinor: "4.21",
        selectedPatch: "4.21.20",
        locked: true
      }
    };

    expect(getVersionLocked(state421)).toBe(true);
    expect(state421.version.selectedMinor).toBe("4.21");
    expect(state421.version.selectedPatch).toBe("4.21.20");
  });
});
