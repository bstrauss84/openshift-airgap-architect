import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");

describe("1080p vertical space optimization", () => {
  it("has a max-height: 1100px media query", () => {
    expect(css).toContain("@media (max-height: 1100px)");
  });

  it("reduces step-header padding at low height", () => {
    const mediaBlock = css.slice(css.indexOf("@media (max-height: 1100px)"));
    expect(mediaBlock).toContain(".step-header");
  });

  it("reduces host inventory drawer control-row spacing at low height", () => {
    // DOC-131: the pager is a flex item of the shared control row now, not a
    // standalone band, so the low-height saving is taken on the row itself.
    const mediaBlock = css.slice(css.indexOf("@media (max-height: 1100px)"));
    expect(mediaBlock).toContain(".host-inventory-v2-drawer-controls");
  });

  it("reduces host inventory editor h4 margins at low height", () => {
    const mediaBlock = css.slice(css.indexOf("@media (max-height: 1100px)"));
    expect(mediaBlock).toContain(".host-inventory-v2-editor h4");
  });
});
