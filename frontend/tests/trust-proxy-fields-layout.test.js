/**
 * OpenShift Airgap Architect - Test Suite
 *
 * Owner report (2026-11-04): the three Trust & Proxy fields (HTTP Proxy,
 * HTTPS Proxy, No Proxy) scrolled sideways at common desktop widths, hiding
 * HTTP Proxy and No Proxy off the sides. Cause: each column had a fixed 500px
 * minimum (1540px plus gaps) inside a horizontally scrolling grid. The row now
 * reflows instead (3 → 2 → 1 columns) and the textareas resize vertically
 * only, so resizing never widens the row.
 *
 * jsdom has no layout, so these guard the CSS that produces the behaviour; the
 * real-browser check at 420–1920px is
 * ~/oaa-investigations/v220/final-docs/shots/proxy-probe.mjs.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");

/** Every rule body for an exact selector (media-query copies included). */
function rules(selector) {
  const out = [];
  let idx = css.indexOf(selector + " {");
  while (idx !== -1) {
    const open = css.indexOf("{", idx);
    out.push(css.slice(open + 1, css.indexOf("}", open)));
    idx = css.indexOf(selector + " {", open);
  }
  return out;
}

describe("Trust & Proxy proxy fields fit the row (owner, 2026-11-04)", () => {
  it("the grid never scrolls sideways and its columns can shrink to the container", () => {
    const grid = rules(".proxy-fields-grid");
    expect(grid.length).toBeGreaterThan(0);
    for (const body of grid) {
      expect(body).not.toMatch(/overflow-x:\s*(auto|scroll)/);
      // A column minimum must be capped by the container (min(100%, …)), never a bare fixed width.
      const cols = body.match(/grid-template-columns:\s*([^;]+);/)?.[1] || "";
      for (const m of cols.matchAll(/minmax\((min\([^)]*\)|[^,]+),/g)) {
        expect(m[1].trim()).toMatch(/^(0|min\(100%,\s*\d+px\))$/);
      }
    }
  });

  it("the field cells may shrink below their content width", () => {
    expect(rules(".proxy-fields-grid .proxy-field-cell").some((b) => /min-width:\s*0/.test(b))).toBe(true);
  });

  it("the proxy textareas resize vertically only", () => {
    const ta = rules(".proxy-field-textarea");
    expect(ta.some((b) => /resize:\s*vertical/.test(b))).toBe(true);
    expect(ta.some((b) => /resize:\s*(both|horizontal)/.test(b))).toBe(false);
  });
});
