/**
 * OpenShift Airgap Architect - Test Suite
 *
 * C: operator tiles and Selected Operators lead with the human-readable
 * displayName, keep the canonical package name as secondary text, then the
 * default channel.
 *
 * Presentation only. The canonical package identifier (`op.name`) must remain
 * what selection, state, removal and ImageSetConfiguration generation use —
 * displayName must never leak into generated config.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(
  path.join(__dirname, "../src/steps/OperatorsStep.jsx"),
  "utf8"
);
const generateSrc = fs.readFileSync(
  path.join(__dirname, "../../backend/src/generate.js"),
  "utf8"
);

/** The two card render blocks: Selected Operators card, and catalog tile. */
function cardBlocks() {
  const blocks = [];
  let idx = 0;
  while (true) {
    const i = src.indexOf('<div className="operator-name">', idx);
    if (i === -1) break;
    const end = src.indexOf("Default channel:", i);
    expect(end, "operator card must render a Default channel line").toBeGreaterThan(i);
    blocks.push(src.slice(i, src.indexOf("</div>", end) + 6));
    idx = end;
  }
  return blocks;
}

/** Mirrors the JSX heading expression so fallback logic is executable. */
const heading = (op) => op.displayName || op.name;
const showsPackageLine = (op) => Boolean(op.displayName);

describe("C: operator card presentation hierarchy", () => {
  it("has exactly two card render sites (catalog tile + selected card)", () => {
    expect(cardBlocks().length).toBe(2);
  });

  it("both sites lead with displayName and fall back to the package name", () => {
    for (const block of cardBlocks()) {
      expect(block).toContain("{op.displayName || op.name}");
    }
  });

  it("both sites show 'Package: <name>' only when a displayName exists", () => {
    for (const block of cardBlocks()) {
      expect(block).toContain("op.displayName ?");
      expect(block).toContain("Package: ");
      expect(block).toContain("{op.name}");
    }
  });

  it("orders heading → Package → Default channel at both sites", () => {
    for (const block of cardBlocks()) {
      const h = block.indexOf("{op.displayName || op.name}");
      const pkg = block.indexOf("Package: ");
      const chan = block.indexOf("Default channel:");
      expect(h).toBeGreaterThan(-1);
      expect(pkg).toBeGreaterThan(h);
      expect(chan).toBeGreaterThan(pkg);
    }
  });

  it("uses 'Default channel' capitalization, not the old lowercase form", () => {
    expect(src).not.toContain("default channel:");
    expect(src).toContain("Default channel:");
  });

  it("no longer renders displayName as a trailing subtle line", () => {
    expect(src).not.toContain("{op.displayName}</div>");
  });
});

describe("C: fallback behavior", () => {
  it("uses the package name as the heading when displayName is missing", () => {
    for (const op of [
      { name: "3scale-operator" },
      { name: "3scale-operator", displayName: "" },
      { name: "3scale-operator", displayName: undefined }
    ]) {
      expect(heading(op)).toBe("3scale-operator");
      expect(showsPackageLine(op)).toBe(false);
    }
  });

  it("avoids a duplicate 'Package:' line in the fallback case", () => {
    const op = { name: "3scale-operator" };
    expect(heading(op)).toBe(op.name);
    expect(showsPackageLine(op)).toBe(false);
  });

  it("leads with displayName when present and keeps the package name secondary", () => {
    const op = { name: "3scale-operator", displayName: "Red Hat Integration - 3scale" };
    expect(heading(op)).toBe("Red Hat Integration - 3scale");
    expect(showsPackageLine(op)).toBe(true);
  });
});

describe("C: canonical identity is unchanged by presentation", () => {
  it("selection and removal remain keyed on the canonical id, not displayName", () => {
    const selectIdx = src.indexOf("const selectOperator");
    const selectBody = src.slice(selectIdx, selectIdx + 900);
    expect(selectBody).toContain("item.id === op.id");
    expect(selectBody).not.toContain("displayName ===");

    const removeIdx = src.indexOf("const removeOperator");
    const removeBody = src.slice(removeIdx, removeIdx + 600);
    expect(removeBody).toContain("op.id !== id");
    expect(removeBody).not.toContain("displayName");
  });

  it("ImageSetConfiguration emits the package name and never displayName", () => {
    // backend/src/generate.js builds packages[] from the operator entries.
    const idx = generateSrc.indexOf("byCatalog.get(op.catalogImage).push(");
    expect(idx).toBeGreaterThan(-1);
    const push = generateSrc.slice(idx, generateSrc.indexOf("});", idx));
    expect(push).toContain("name: op.name");
    expect(push).not.toContain("displayName");
    // Whole generator must never reference displayName.
    expect(generateSrc).not.toContain("displayName");
  });
});
