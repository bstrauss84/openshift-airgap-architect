/**
 * v2.2.0 M2 — app-wide accessibility improvements to shared pieces:
 * selection cards expose aria-pressed and a non-colour cue at every call site,
 * help icons are keyboard reachable, and reduced motion is honoured.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import FieldLabelWithInfo from "../src/components/FieldLabelWithInfo.jsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(__dirname, "../src", rel), "utf8");
const css = read("styles.css");

afterEach(cleanup);

describe("selection cards", () => {
  const SITES = ["steps/BlueprintStep.jsx", "steps/MethodologyStep.jsx", "steps/PlatformSpecificsStep.jsx",
    "mirroring/ContentSelection.jsx", "mirroring/MirroringShell.jsx"];
  it.each(SITES)("%s: every .select-card carries aria-pressed and the visible check cue", (rel) => {
    const src = read(rel);
    const cards = src.split('className={`select-card').length - 1;
    expect(cards).toBeGreaterThan(0);
    expect(src.split("aria-pressed=").length - 1).toBeGreaterThanOrEqual(cards);
    expect(src.split('className="select-card-check"').length - 1).toBeGreaterThanOrEqual(cards);
  });

  it("the selected cue does not depend on colour alone", () => {
    expect(css).toMatch(/\.select-card\[aria-pressed="true"\] \.select-card-check \{\s*display: inline;/);
    expect(css).toMatch(/\.select-card\[aria-pressed="true"\] \{\s*border-width: 3px;/);
    expect(css).toMatch(/\.select-card:focus-visible \{/);
  });
});

describe("reduced motion", () => {
  it("prefers-reduced-motion removes transitions, animations and hover lifts app-wide", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block.length).toBeGreaterThan(50);
    expect(block).toMatch(/transition-duration: 0\.01ms !important/);
    expect(block).toMatch(/animation-duration: 0\.01ms !important/);
    expect(block).toMatch(/\.select-card:hover:not\(:disabled\)[\s\S]*transform: none !important/);
  });
});

describe("help icons are keyboard reachable", () => {
  it("the icon is in the tab order and a short hint shows on focus", () => {
    render(<FieldLabelWithInfo label="Example field" hint="Short help text."><input /></FieldLabelWithInfo>);
    const icon = screen.getByRole("button", { name: "More information" });
    expect(icon.getAttribute("tabindex")).toBeNull();
    fireEvent.focus(icon);
    expect(screen.getByRole("tooltip").textContent).toContain("Short help text.");
    fireEvent.blur(icon);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("a long hint opens from the keyboard (button activation) and closes on Escape", () => {
    const long = "Long help. ".repeat(30);
    render(<FieldLabelWithInfo label="Example field" hint={long}><input /></FieldLabelWithInfo>);
    const icon = screen.getByRole("button", { name: "Open help (click to read)" });
    expect(icon.getAttribute("tabindex")).toBeNull();
    fireEvent.click(icon);
    expect(screen.getByRole("dialog", { name: "Help" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Help" })).toBeNull();
  });
});

describe("Mirroring API methods pass the backend CORS preflight", () => {
  it("mirroringApi uses only GET, POST and DELETE (accessControl allows GET,POST,DELETE,OPTIONS)", () => {
    const api = read("mirroring/mirroringApi.js");
    const methods = [...api.matchAll(/(?:json\("|method: ")([A-Z]+)"/g)].map((m) => m[1]);
    expect(methods.length).toBeGreaterThan(3);
    for (const m of methods) expect(["GET", "POST", "DELETE"]).toContain(m);
    const backend = fs.readFileSync(path.join(__dirname, "../../backend/src/accessControl.js"), "utf8");
    expect(backend).toMatch(/Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS"/);
  });
});
