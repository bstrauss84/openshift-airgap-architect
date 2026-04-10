import { describe, it, expect } from "vitest";
import { buildImportedRunGuidance } from "../src/App.jsx";

describe("buildImportedRunGuidance", () => {
  it("composes continue-imported guidance with placeholder review messaging", () => {
    const result = buildImportedRunGuidance({
      continuation: { mode: "continue-imported" },
      statusModel: {
        continuationLocked: true,
        cacheLimited: true,
        reviewNeeded: true,
        secretsOmitted: true
      },
      placeholdersPresent: true
    });

    expect(result.mode).toBe("Continue imported run");
    expect(result.modeDetail).toContain("Imported selections are preserved");
    expect(result.guidance).toContain(
      "Some release or operator selections are locked to keep this imported run consistent."
    );
    expect(result.guidance).toContain(
      "Editing is partially limited by imported cache scope until you restart from fresh connected data."
    );
    expect(result.guidance).toContain(
      "Review is still required before execution because one or more fields need later completion or re-checking."
    );
    expect(result.guidance).toContain(
      "One or more secret classes are omitted from export by current inclusion policy."
    );
  });

  it("composes start-over-from-import guidance without placeholder warning", () => {
    const result = buildImportedRunGuidance({
      continuation: { mode: "start-over-from-import" },
      statusModel: {
        cacheLimited: false,
        reviewNeeded: false,
        secretsOmitted: false
      },
      placeholdersPresent: false
    });

    expect(result.mode).toBe("Start-over from imported run");
    expect(result.modeDetail).toContain("Run-specific selections are reset while imported caches stay available");
    expect(result.guidance).toEqual(["Imported context is coherent and ready for final review."]);
  });

  it("never emits raw debug boolean keys", () => {
    const result = buildImportedRunGuidance({
      continuation: { mode: "continue-imported" },
      statusModel: {
        continuationLocked: true,
        cacheLimited: true,
        reviewNeeded: true,
        secretsOmitted: true
      },
      placeholdersPresent: true
    });
    const text = `${result.mode}\n${result.modeDetail}\n${result.guidance.join("\n")}`.toLowerCase();

    expect(text).not.toContain("continuation-locked");
    expect(text).not.toContain("cache-limited");
    expect(text).not.toContain("review-needed");
    expect(text).not.toContain("secrets-omitted");
  });
});
