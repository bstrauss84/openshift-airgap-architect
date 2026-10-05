import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
const aboutModal = fs.readFileSync(path.join(__dirname, "../src/components/AboutModal.jsx"), "utf8");
const runModal = fs.readFileSync(path.join(__dirname, "../src/components/RunConfirmationModal.jsx"), "utf8");

const CANONICAL_TOKENS = [
  "--card-bg",
  "--border-color",
  "--text-subtle",
  "--text-secondary",
];

describe("Modal theme token definitions", () => {
  it("defines all canonical tokens used by modals in the light theme", () => {
    for (const token of CANONICAL_TOKENS) {
      const defPattern = new RegExp(`^\\s*${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "m");
      expect(css).toMatch(defPattern);
    }
  });

  it("defines all canonical tokens used by modals in the dark theme", () => {
    const darkStart = css.indexOf('body[data-theme="dark"]');
    expect(darkStart).toBeGreaterThan(-1);
    const darkSection = css.slice(darkStart);
    for (const token of CANONICAL_TOKENS) {
      const defPattern = new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`);
      expect(darkSection).toMatch(defPattern);
    }
  });

  it("does not define competing alias tokens (--bg-primary, --border-primary, etc.)", () => {
    const aliasTokens = ["--bg-primary", "--border-primary", "--text-primary", "--text-muted", "--link-color"];
    for (const alias of aliasTokens) {
      const defPattern = new RegExp(`^\\s*${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "m");
      expect(css).not.toMatch(defPattern);
    }
  });
});

describe("Modal components use canonical design-system tokens", () => {
  it("AboutModal uses --card-bg for background", () => {
    expect(aboutModal).toContain("var(--card-bg)");
  });

  it("AboutModal uses --border-color for border", () => {
    expect(aboutModal).toContain("var(--border-color)");
  });

  it("AboutModal does not reference alias tokens", () => {
    expect(aboutModal).not.toContain("var(--bg-primary)");
    expect(aboutModal).not.toContain("var(--border-primary)");
    expect(aboutModal).not.toContain("var(--text-muted)");
  });

  it("RunConfirmationModal uses --card-bg for background", () => {
    expect(runModal).toContain("var(--card-bg)");
  });

  it("RunConfirmationModal uses --border-color for border", () => {
    expect(runModal).toContain("var(--border-color)");
  });

  it("RunConfirmationModal does not reference alias tokens", () => {
    expect(runModal).not.toContain("var(--bg-primary)");
    expect(runModal).not.toContain("var(--border-primary)");
    expect(runModal).not.toContain("var(--text-muted)");
  });
});
