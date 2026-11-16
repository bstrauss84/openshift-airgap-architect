import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appJsx = fs.readFileSync(path.join(__dirname, "../src/App.jsx"), "utf8");

describe("YAML preview useEffect dependencies", () => {
  it("includes state?.imagesetConfig in preview generation dependencies", () => {
    expect(appJsx).toContain("state?.imagesetConfig");
  });

  it("includes state?.exportOptions in preview generation dependencies", () => {
    expect(appJsx).toContain("state?.exportOptions");
  });

  it("includes all critical state keys in the preview useEffect dependency array", () => {
    const requiredDeps = [
      "state?.globalStrategy",
      "state?.platformConfig",
      "state?.hostInventory",
      "state?.credentials",
      "state?.trust",
      "state?.operators",
      "state?.blueprint",
      "state?.methodology",
      "state?.release",
      "state?.version",
      "state?.imagesetConfig",
      "state?.exportOptions",
    ];
    for (const dep of requiredDeps) {
      expect(appJsx).toContain(dep);
    }
  });
});
