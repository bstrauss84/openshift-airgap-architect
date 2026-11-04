/**
 * Owner report (2026-11-03): after scrolling deep into the long Operators tab,
 * switching to the short Platform tab kept the scroll offset — an empty screen
 * the reader had to scroll up from. A deliberate tab switch now brings the tab
 * row back to its natural place under the sticky header, so the new panel
 * starts right below it; near the top nothing moves; Go to links keep scrolling
 * to their own target. (jsdom has no layout: geometry is stubbed here; the
 * real-browser check is ~/oaa-investigations/v220/tabscroll/browser-tabscroll.mjs.)
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import ProfileWorkspace from "../src/mirroring/ProfileWorkspace.jsx";
import { _resetSourceCredentialsForTests } from "../src/mirroring/sourceCredentialSession.js";
import { _resetScanSessionsForTests } from "../src/mirroring/useProfileCatalogs.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

const paths = { root: "/d", archivePath: "/d/a", workspacePath: "/d/w", cachePath: "/d/c", receivedPath: "/d/r" };
const profile = {
  id: "p-tabscroll01", name: "Tab scroll", updatedAt: 1, kind: "planned", content: { platform: true, operators: true, additionalImages: true },
  platform: { release: { channel: "4.22", patchVersion: "4.22.20" }, version: { selectedMinor: "4.22", locked: false }, graph: true },
  operators: { catalogMinor: "4.22", catalogMinorSource: "platform", selected: [] },
  additionalImages: [{ id: "i1", name: "quay.io/a/b:1", source: "user" }],
  options: {}, execution: { mode: "mirrorToDisk", registryUrl: "", options: {} }, history: [], transfers: [], received: [], imports: [],
  readiness: [{ path: "platform.version.locked", message: "Lock the selected OpenShift release before generating platform content." }],
  paths, catalogReconciliation: null
};

let scroll; // the page scroll container's scrollTop (jsdom does not keep one)
let anchorTop; // where the marker above the tab row is, relative to the viewport
const MAIN_TOP = 145;
const HEADER_H = 52;

beforeEach(() => {
  _resetSourceCredentialsForTests();
  _resetScanSessionsForTests();
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation((path) => {
    if (path === "/api/mirroring/operations") return Promise.resolve({ operations: [] });
    if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: false });
    if (/\/runs$/.test(path)) return Promise.resolve({ runs: [], activeVerification: null });
    if (path.startsWith("/api/mirroring/storage")) return Promise.resolve({ configured: { base: "/d", source: "default", ok: true }, profile: { base: "/d", source: "default", ok: true, paths } });
    return Promise.resolve({});
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function rect() {
    if (this.id === "mirroring-main") return { top: MAIN_TOP, bottom: 900, left: 0, right: 1366, width: 1366, height: 755 };
    if (this.classList?.contains("mirroring-tabs-anchor")) return { top: anchorTop, bottom: anchorTop, left: 0, right: 1000, width: 1000, height: 0 };
    return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
  });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = () => {
  const r = render(<main id="mirroring-main" style={{ "--mirroring-header-h": `${HEADER_H}px` }}><ProfileWorkspace profile={profile} onEditContent={vi.fn()} onDelete={vi.fn()} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} onShowOperation={vi.fn()} /></main>);
  const main = r.container.querySelector("#mirroring-main");
  scroll = 0;
  Object.defineProperty(main, "scrollTop", { configurable: true, get: () => scroll, set: (v) => { scroll = v; } });
  return main;
};
// What the fix computes from the same inputs (the header height as the browser resolves it).
const headerH = () => parseFloat(window.getComputedStyle(document.querySelector(".mirroring-tabs-anchor")).getPropertyValue("--mirroring-header-h")) || 0;

describe("tab switch after scrolling deep (owner, 2026-11-03)", () => {
  it("deep in Operators, clicking Platform brings the tab row back under the header (the old code kept the offset)", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /^Operators/ }));
    scroll = 3188;
    anchorTop = -1500; // the tab row's own place is far above the viewport
    fireEvent.click(screen.getByRole("tab", { name: /^Platform/ }));
    expect(screen.getByRole("tab", { name: /^Platform/ })).toHaveAttribute("aria-selected", "true");
    expect(scroll).toBe(3188 + (-1500 - (MAIN_TOP + headerH())));
    expect(scroll).toBeLessThan(3188);
  });

  it("keyboard activation (arrow keys) does the same, without the browser scrolling to the focused tab", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /^Operators/ }));
    scroll = 2500;
    anchorTop = -900;
    fireEvent.keyDown(screen.getByRole("tab", { name: /^Operators/ }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: /^Platform/ })).toHaveAttribute("aria-selected", "true");
    expect(scroll).toBe(2500 + (-900 - (MAIN_TOP + headerH())));
  });

  it("near the top (the tab row still in its own place) the reader's position is kept", () => {
    mount();
    scroll = 120;
    anchorTop = 400;
    fireEvent.click(screen.getByRole("tab", { name: /^Operators/ }));
    expect(scroll).toBe(120);
  });

  it("Go to links scroll to their own target, not to the tab row", () => {
    mount();
    scroll = 2000;
    anchorTop = -800;
    fireEvent.click(screen.getByRole("button", { name: "Go to release lock" }));
    expect(screen.getByRole("tab", { name: /^Platform/ })).toHaveAttribute("aria-selected", "true");
    expect(scroll).toBe(2000);
  });
});
