/**
 * OpenShift Airgap Architect - Test Suite
 *
 * D: header/Shadowman compaction was conditional on the Shadowman graphic being
 * structurally separate from the "Red Hat OpenShift / Airgap Architect" text.
 *
 * It is NOT. The header renders a single <img class="brand-banner"> whose source
 * is one combined raster containing both the figure and the wordmark; the
 * product name exists in markup only as alt text. Shrinking Shadowman would
 * therefore shrink the wordmark too, so per instruction the header is unchanged
 * ("combined asset; deferred").
 *
 * These assertions pin that evidence: if the branding is ever split into a
 * separate graphic + live text, this test fails and the compaction request
 * becomes actionable again.
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
const appSrc = fs.readFileSync(path.join(__dirname, "../src/App.jsx"), "utf8");
const bannerPath = path.join(__dirname, "../public/airgap-architect-banner.png");

describe("D: header branding is a single combined asset (compaction deferred)", () => {
  it("renders the brand as one <img>, with no sibling product-name text node", () => {
    const i = appSrc.indexOf('<div className="brand">');
    expect(i).toBeGreaterThan(-1);
    const brand = appSrc.slice(i, appSrc.indexOf("</div>", i));
    expect(brand).toContain('className="brand-banner"');
    expect(brand).toContain("airgap-architect-banner.png");
    // The wordmark is not live text anywhere in the brand block.
    expect(brand).not.toMatch(/>\s*Red Hat OpenShift/);
    expect(brand).not.toMatch(/>\s*Airgap Architect/);
  });

  it("carries the product name only as alt text, confirming it is baked into the image", () => {
    expect(appSrc).toContain('alt="Red Hat OpenShift Airgap Architect"');
  });

  it("references no separate Shadowman element or asset in the header", () => {
    const i = appSrc.indexOf('<div className="brand">');
    const brand = appSrc.slice(i, appSrc.indexOf("</div>", i));
    expect(brand).not.toMatch(/shadowman/i);
    expect(brand).not.toContain("airgap-architect-logo");
  });

  it("the banner asset exists and is a single wide raster", () => {
    const buf = fs.readFileSync(bannerPath);
    expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    // 1534x423 — a banner, i.e. figure and wordmark side by side in one file.
    expect(width).toBeGreaterThan(height * 2);
  });

  it("header branding styles remain untouched by this tranche", () => {
    const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
    const i = css.indexOf(".brand-banner {");
    const body = css.slice(i, css.indexOf("}", i));
    expect(body).toMatch(/height:\s*120px/);
    expect(body).toMatch(/width:\s*auto/);
  });
});
