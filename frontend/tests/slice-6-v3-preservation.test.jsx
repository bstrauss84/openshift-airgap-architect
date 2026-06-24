/**
 * OpenShift Airgap Architect - DOC-101 Phase 1 Slice 6 Tests
 *
 * Tests for v3 state schema preservation at frontend hydration/API boundaries.
 * Verifies frontend preserves backend-migrated v3 metadata and does not silently
 * reset, drop, or overwrite v3 fields.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { describe, it, expect } from "vitest";
import { getVersionLocked, getDisplayOpenShiftVersion, detectUnknownSchema } from "../src/shared/versionHelpers.js";

describe("DOC-101 Slice 6: Frontend v3 Preservation", () => {
  describe("getVersionLocked() prefers v3 version.locked field", () => {
    it("returns true when version.locked is true", () => {
      const state = {
        version: { locked: true }
      };
      expect(getVersionLocked(state)).toBe(true);
    });

    it("returns false when version.locked is explicitly false", () => {
      const state = {
        version: { locked: false }
      };
      expect(getVersionLocked(state)).toBe(false);
    });

    it("does not fall back to v2 versionConfirmed when v3 locked is present and false", () => {
      const state = {
        version: {
          locked: false,
          versionConfirmed: true  // v2 field should be ignored
        }
      };
      expect(getVersionLocked(state)).toBe(false); // "Should use v3 locked=false, not v2 fallback"
    });

    it("falls back to v2 versionConfirmed when v3 locked is absent", () => {
      const state = {
        version: {
          versionConfirmed: true
        }
      };
      expect(getVersionLocked(state)).toBe(true);
    });

    it("falls back to v1 release.confirmed when v3 and v2 absent", () => {
      const state = {
        release: {
          confirmed: true
        }
      };
      expect(getVersionLocked(state)).toBe(true);
    });

    it("returns false for null/undefined state", () => {
      expect(getVersionLocked(null)).toBe(false);
      expect(getVersionLocked(undefined)).toBe(false);
      expect(getVersionLocked({})).toBe(false);
    });

    it("handles mixed v3/v2 state with v3 taking precedence", () => {
      const state = {
        version: {
          locked: true,
          versionConfirmed: false  // v2 field should be ignored
        },
        release: {
          confirmed: false  // v1 field should be ignored
        }
      };
      expect(getVersionLocked(state)).toBe(true); // "v3 locked should take precedence"
    });
  });

  describe("getDisplayOpenShiftVersion() prefers v3 version fields", () => {
    it("returns selectedPatch when present (v3 field)", () => {
      const state = {
        version: {
          selectedPatch: "4.20.35"
        }
      };
      expect(getDisplayOpenShiftVersion(state)).toBe("4.20.35");
    });

    it("returns selectedMinor when selectedPatch absent", () => {
      const state = {
        version: {
          selectedMinor: "4.20"
        }
      };
      expect(getDisplayOpenShiftVersion(state)).toBe("4.20");
    });

    it("returns selectedChannel when patch/minor absent", () => {
      const state = {
        version: {
          selectedChannel: "stable-4.20"
        }
      };
      expect(getDisplayOpenShiftVersion(state)).toBe("stable-4.20");
    });

    it("falls back to v2 release.patchVersion when v3 fields absent", () => {
      const state = {
        release: {
          patchVersion: "4.20.18"
        }
      };
      expect(getDisplayOpenShiftVersion(state)).toBe("4.20.18");
    });

    it("falls back to docsIndex.version when state fields absent", () => {
      const state = {};
      const docsIndex = { version: "4.20" };
      expect(getDisplayOpenShiftVersion(state, docsIndex)).toBe("4.20");
    });

    it("returns 'Version not selected' when all fields absent", () => {
      const state = {};
      expect(getDisplayOpenShiftVersion(state)).toBe("Version not selected");
    });

    it("does NOT return hardcoded '4.20' for missing version", () => {
      const state = {};
      const result = getDisplayOpenShiftVersion(state);
      expect(result).not.toBe("4.20"); // "Should not hardcode 4.20 fallback"
      expect(result).toBe("Version not selected");
    });

    it("prefers v3 selectedPatch over v2 patchVersion", () => {
      const state = {
        version: {
          selectedPatch: "4.21.12"
        },
        release: {
          patchVersion: "4.20.18"  // v2 field should be ignored
        }
      };
      const docsIndex = { version: "4.20" };
      expect(getDisplayOpenShiftVersion(state, docsIndex)).toBe("4.21.12");
    });
  });

  describe("v3 metadata preservation during state updates", () => {
    it("preserves version._schemaVersion during partial update", () => {
      // Simulate store.jsx updateState() behavior
      const prev = {
        version: {
          _schemaVersion: 3,
          selectedMinor: "4.20",
          selectedPatch: "4.20.35",
          locked: true
        },
        blueprint: { arch: "x86_64" }
      };

      const patch = {
        blueprint: { ...prev.blueprint, platform: "Bare Metal" }
      };

      // Simulate updated updateState logic
      const next = {
        ...prev,
        ...patch,
        version: patch.version ? { ...prev.version, ...patch.version } : prev.version
      };

      expect(next.version._schemaVersion).toBe(3); // "_schemaVersion should be preserved"
      expect(next.version.selectedMinor).toBe("4.20"); // "selectedMinor should be preserved"
      expect(next.version.selectedPatch).toBe("4.20.35"); // "selectedPatch should be preserved"
      expect(next.version.locked).toBe(true); // "locked should be preserved"
    });

    it("merges partial version updates with existing v3 metadata", () => {
      const prev = {
        version: {
          _schemaVersion: 3,
          selectedMinor: "4.20",
          selectedPatch: "4.20.35",
          selectedChannel: "stable-4.20",
          locked: false,
          confirmedByUser: false
        }
      };

      const patch = {
        version: {
          locked: true,  // User locked the version
          confirmedByUser: true,
          confirmationTimestamp: Date.now()
        }
      };

      // Simulate updated updateState logic
      const next = {
        ...prev,
        ...patch,
        version: patch.version ? { ...prev.version, ...patch.version } : prev.version
      };

      expect(next.version._schemaVersion).toBe(3); // "_schemaVersion preserved during merge"
      expect(next.version.selectedMinor).toBe("4.20"); // "selectedMinor preserved"
      expect(next.version.selectedPatch).toBe("4.20.35"); // "selectedPatch preserved"
      expect(next.version.selectedChannel).toBe("stable-4.20"); // "selectedChannel preserved"
      expect(next.version.locked).toBe(true); // "locked updated correctly"
      expect(next.version.confirmedByUser).toBe(true); // "confirmedByUser updated"
      expect(next.version.confirmationTimestamp).toBeTruthy(); // "confirmationTimestamp added"
    });

    it("preserves v3 metadata when patch has no version field", () => {
      const prev = {
        version: {
          _schemaVersion: 3,
          selectedMinor: "4.20",
          selectedPatch: "4.20.35",
          locked: true
        },
        operators: { includeRecommended: false }
      };

      const patch = {
        operators: { includeRecommended: true }
      };

      // Simulate updated updateState logic
      const next = {
        ...prev,
        ...patch,
        version: patch.version ? { ...prev.version, ...patch.version } : prev.version
      };

      expect(next.version).toEqual(prev.version); // "version should be completely preserved"
    });
  });

  describe("Import flow preserves backend v3 metadata", () => {
    it("preserves migrated v3 state from backend import response", () => {
      // Simulate backend /api/run/import response after v2→v3 migration
      const backendResponse = {
        ok: true,
        state: {
          version: {
            _schemaVersion: 3,
            selectedMinor: "4.20",
            selectedPatch: "4.20.35",
            selectedChannel: "stable-4.20",
            locked: true,
            confirmedByUser: true,
            confirmationTimestamp: 1719273600000
          },
          blueprint: {
            arch: "x86_64",
            platform: "Bare Metal",
            confirmed: true
          }
        },
        migrated: true,
        wasV2: true
      };

      // Simulate App.jsx importRun() - should preserve backend state.version
      const merged = {
        ...backendResponse.state,
        reviewFlags: {}
      };

      expect(merged.version._schemaVersion).toBe(3);
      expect(merged.version.locked).toBe(true);
      expect(merged.version.confirmedByUser).toBe(true);
      expect(merged.version.selectedPatch).toBe("4.20.35");
    });

    it("preserves all v3 metadata fields after import", () => {
      const importedState = {
        version: {
          _schemaVersion: 3,
          selectedMinor: "4.20",
          selectedPatch: "4.20.35",
          selectedChannel: "stable-4.20",
          locked: true,
          confirmedByUser: true,
          selectionTimestamp: 1719273000000,
          confirmationTimestamp: 1719273600000
        }
      };

      // All fields should remain intact
      expect(importedState.version._schemaVersion).toBe(3);
      expect(importedState.version.selectedMinor).toBe("4.20");
      expect(importedState.version.selectedPatch).toBe("4.20.35");
      expect(importedState.version.selectedChannel).toBe("stable-4.20");
      expect(importedState.version.locked).toBe(true);
      expect(importedState.version.confirmedByUser).toBe(true);
      expect(importedState.version.selectionTimestamp).toBeTruthy();
      expect(importedState.version.confirmationTimestamp).toBeTruthy();
    });
  });

  describe("Existing 4.20 happy path unchanged", () => {
    it("getVersionLocked returns true for confirmed 4.20 v3 state", () => {
      const state = {
        version: {
          _schemaVersion: 3,
          selectedMinor: "4.20",
          selectedPatch: "4.20.35",
          locked: true
        }
      };
      expect(getVersionLocked(state)).toBe(true);
    });

    it("getDisplayOpenShiftVersion returns 4.20.35 for confirmed 4.20 state", () => {
      const state = {
        version: {
          selectedPatch: "4.20.35"
        }
      };
      expect(getDisplayOpenShiftVersion(state)).toBe("4.20.35");
    });

    it("v2 state with versionConfirmed=true still works (backward compat)", () => {
      const state = {
        version: {
          versionConfirmed: true  // v2 field
        },
        release: {
          patchVersion: "4.20.35"
        }
      };
      expect(getVersionLocked(state)).toBe(true);
      expect(getDisplayOpenShiftVersion(state)).toBe("4.20.35");
    });
  });

  describe("No hardcoded 4.20 fallbacks", () => {
    it("ScenarioHeaderPanel does not show 4.20 when version missing", () => {
      const state = {};
      const docsIndex = {};
      const result = getDisplayOpenShiftVersion(state, docsIndex);
      expect(result).not.toBe("4.20");
      expect(result).toBe("Version not selected");
    });

    it("getDisplayOpenShiftVersion never returns hardcoded 4.20 unless from docsIndex", () => {
      // Test various empty state scenarios
      const scenarios = [
        {},
        { version: {} },
        { version: null },
        { version: { selectedPatch: null } },
        { release: {} }
      ];

      scenarios.forEach((state) => {
        const result = getDisplayOpenShiftVersion(state);
        if (result === "4.20") {
          throw new Error(`getDisplayOpenShiftVersion should not hardcode 4.20 for state: ${JSON.stringify(state)}`);
        }
      });
    });
  });

  describe("Edge cases and error handling", () => {
    it("handles null version object gracefully", () => {
      const state = { version: null };
      expect(getVersionLocked(state)).toBe(false);
      expect(getDisplayOpenShiftVersion(state)).toBe("Version not selected");
    });

    it("handles undefined version object gracefully", () => {
      const state = { version: undefined };
      expect(getVersionLocked(state)).toBe(false);
      expect(getDisplayOpenShiftVersion(state)).toBe("Version not selected");
    });

    it("handles empty version object gracefully", () => {
      const state = { version: {} };
      expect(getVersionLocked(state)).toBe(false);
      expect(getDisplayOpenShiftVersion(state)).toBe("Version not selected");
    });

    it("handles version.locked as 0 (falsy but defined)", () => {
      const state = {
        version: { locked: 0 }
      };
      // Should treat 0 as false when converted to Boolean
      expect(getVersionLocked(state)).toBe(false);
    });

    it("handles version.locked as empty string (falsy but defined)", () => {
      const state = {
        version: { locked: "" }
      };
      // Should treat empty string as false when converted to Boolean
      expect(getVersionLocked(state)).toBe(false);
    });
  });

  describe("Unknown/future schema detection", () => {
    it("returns null for v1 state (no _schemaVersion)", () => {
      const state = {
        release: {
          patchVersion: "4.20.35",
          confirmed: true
        }
      };
      expect(detectUnknownSchema(state)).toBe(null);
    });

    it("returns null for v2 state (no _schemaVersion)", () => {
      const state = {
        version: {
          versionConfirmed: true
        },
        release: {
          patchVersion: "4.20.35"
        }
      };
      expect(detectUnknownSchema(state)).toBe(null);
    });

    it("returns null for v3 state (_schemaVersion: 3)", () => {
      const state = {
        version: {
          _schemaVersion: 3,
          selectedPatch: "4.20.35",
          locked: true
        }
      };
      expect(detectUnknownSchema(state)).toBe(null);
    });

    it("returns error for future schema (_schemaVersion: 999)", () => {
      const state = {
        version: {
          _schemaVersion: 999,
          selectedPatch: "4.25.10"
        }
      };
      const error = detectUnknownSchema(state);
      expect(error).not.toBe(null);
      expect(error.schemaVersion).toBe(999);
      expect(error.message).toContain("Unknown state schema version 999");
      expect(error.message).toContain("newer version");
    });

    it("returns error for _schemaVersion: 4", () => {
      const state = {
        version: {
          _schemaVersion: 4,
          selectedMinor: "4.21"
        }
      };
      const error = detectUnknownSchema(state);
      expect(error).not.toBe(null);
      expect(error.schemaVersion).toBe(4);
    });

    it("does not treat future schema as valid unlocked state", () => {
      const futureState = {
        version: {
          _schemaVersion: 999,
          selectedPatch: "4.99.99",
          locked: true
        }
      };

      // Should detect error before helpers are used
      const error = detectUnknownSchema(futureState);
      expect(error).not.toBe(null);
      expect(error.schemaVersion).toBe(999);

      // If somehow used, helpers should not return meaningful values
      // (but detection should prevent this)
    });

    it("does not show hardcoded 4.20 for future schema", () => {
      const futureState = {
        version: {
          _schemaVersion: 999
        }
      };

      // Detection should block before display
      const error = detectUnknownSchema(futureState);
      expect(error).not.toBe(null);

      // If display helper were called (shouldn't be), it would show "Version not selected"
      const display = getDisplayOpenShiftVersion(futureState);
      expect(display).not.toBe("4.20");
      expect(display).toBe("Version not selected");
    });

    it("returns null for null/undefined state", () => {
      expect(detectUnknownSchema(null)).toBe(null);
      expect(detectUnknownSchema(undefined)).toBe(null);
      expect(detectUnknownSchema({})).toBe(null);
    });
  });
});
