import { describe, it, expect } from "vitest";
import { getVersionDependentStepIdSet } from "../src/wizardVersionGate.js";

describe("getVersionDependentStepIdSet", () => {
  it("legacy flow gates blueprint, global, and review", () => {
    const visible = [
      { id: "blueprint" },
      { id: "methodology" },
      { id: "global" },
      { id: "inventory" },
      { id: "operators" },
      { id: "review" }
    ];
    const set = getVersionDependentStepIdSet(false, visible);
    expect(set.has("blueprint")).toBe(true);
    expect(set.has("global")).toBe(true);
    expect(set.has("review")).toBe(true);
    expect(set.has("methodology")).toBe(false);
  });

  it("segmented flow gates all wizard steps except operations", () => {
    const visible = [
      { id: "blueprint" },
      { id: "methodology" },
      { id: "identity-access" },
      { id: "networking-v2" },
      { id: "connectivity-mirroring" },
      { id: "trust-proxy" },
      { id: "platform-specifics" },
      { id: "hosts-inventory" },
      { id: "operators" },
      { id: "review" },
      { id: "run-oc-mirror" },
      { id: "operations" }
    ];
    const set = getVersionDependentStepIdSet(true, visible);
    expect(set.has("methodology")).toBe(true);
    expect(set.has("identity-access")).toBe(true);
    expect(set.has("trust-proxy")).toBe(true);
    expect(set.has("review")).toBe(true);
    expect(set.has("operations")).toBe(false);
  });
});
