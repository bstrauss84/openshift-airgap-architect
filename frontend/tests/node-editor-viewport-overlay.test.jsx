/**
 * OpenShift Airgap Architect - Test Suite
 *
 * R3 / DOC-131: the Host Inventory node editor must be a genuine
 * application-level drawer, positioned by the app shell rather than by the
 * Host Inventory grid.
 *
 * A previous attempt set a viewport-derived height on the nested
 * .host-inventory-v2-body container. That FAILED human acceptance: the element
 * still lived inside <main>'s own scroll box, so the editor stayed visually
 * trapped in the Host Inventory section. These tests therefore assert the
 * STRUCTURAL relationship (where the drawer is mounted), not that a CSS string
 * exists.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AppContext } from "../src/store.jsx";
import HostInventoryV2Step from "../src/steps/HostInventoryV2Step.jsx";
import { generateNodesFromCounts } from "../src/hostInventoryV2Helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
const appJsx = fs.readFileSync(path.join(__dirname, "../src/App.jsx"), "utf8");
const stepJsx = fs.readFileSync(
  path.join(__dirname, "../src/steps/HostInventoryV2Step.jsx"),
  "utf8"
);

/** Extract the body of the first CSS rule whose selector matches exactly. */
function rule(selector) {
  const idx = css.indexOf(selector + " {");
  if (idx === -1) return null;
  const open = css.indexOf("{", idx);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

function setViewport(width, height) {
  window.innerWidth = width;
  window.innerHeight = height;
  window.dispatchEvent(new Event("resize"));
}

const baseState = {
  blueprint: { platform: "Bare Metal", baseDomain: "example.com" },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: {
    nodes: generateNodesFromCounts(3, 2, 0),
    ipStackMode: "ipv4"
  },
  globalStrategy: { networking: { machineNetworkV4: "10.0.0.0/24" } },
  ui: {}
};

let shellHost = null;

/**
 * Mount a stand-in for the App shell overlay layer (App.jsx owns the real one).
 * Any stale host is cleared here rather than in afterEach: removing it before
 * React unmounts its portal leaves the tree in a broken state for later tests.
 */
function mountShellHost() {
  document.querySelectorAll("#node-editor-portal-root").forEach((n) => n.remove());
  shellHost = document.createElement("div");
  shellHost.id = "node-editor-portal-root";
  shellHost.className = "shell-overlay-root";
  document.body.appendChild(shellHost);
  return shellHost;
}

beforeEach(() => {
  document.querySelectorAll("#node-editor-portal-root").forEach((n) => n.remove());
  shellHost = null;
});

function renderStep() {
  const value = {
    state: baseState,
    updateState: vi.fn(),
    loading: false,
    startOver: vi.fn()
  };
  return render(
    <AppContext.Provider value={value}>
      <HostInventoryV2Step previewEnabled={false} previewControls={{}} />
    </AppContext.Provider>
  );
}

/* RTL auto-cleanup is not active in this suite, so prior renders stay in the
   DOM. Always scope tile lookup to the live container, never document-wide. */
function openEditor(container) {
  const tiles = container.querySelectorAll(".host-inventory-v2-tile");
  expect(tiles.length).toBeGreaterThan(0);
  fireEvent.click(tiles[0]);
  const scope = shellHost || container;
  const drawer = scope.querySelector('[role="dialog"][aria-label="Edit node"]');
  expect(drawer).toBeTruthy();
  return drawer;
}

describe("R3: node editor is an application-level drawer (structural)", () => {
  it("portals the drawer OUT of the Host Inventory body into the shell overlay layer", () => {
    const host = mountShellHost();
    const { container } = renderStep();
    const drawer = openEditor(container);

    // The regression that failed acceptance: drawer nested inside the step box.
    const stepBody = container.querySelector(".host-inventory-v2-body");
    expect(stepBody).toBeTruthy();
    expect(stepBody.contains(drawer)).toBe(false);

    // It must live in the shell overlay layer instead.
    expect(host.contains(drawer)).toBe(true);
    expect(drawer.closest("#node-editor-portal-root")).toBe(host);
  });

  it("portals the resize handle alongside the drawer so they stay adjacent", () => {
    const host = mountShellHost();
    const { container } = renderStep();
    openEditor(container);
    const handle = host.querySelector(".host-inventory-v2-drawer-resize-handle");
    expect(handle).toBeTruthy();
    expect(host.contains(handle)).toBe(true);
  });

  it("App shell renders the overlay root as a sibling of <main>, before the YAML drawer", () => {
    const mainIdx = appJsx.indexOf('<main className="main"');
    const rootIdx = appJsx.indexOf('id="node-editor-portal-root"');
    const yamlIdx = appJsx.indexOf("<YamlDrawer");
    expect(mainIdx).toBeGreaterThan(-1);
    expect(rootIdx).toBeGreaterThan(-1);
    expect(yamlIdx).toBeGreaterThan(-1);
    // Order inside .main-layout: main → overlay root → YAML drawer.
    expect(rootIdx).toBeGreaterThan(mainIdx);
    expect(yamlIdx).toBeGreaterThan(rootIdx);
    // And it must be outside the <main> element, not nested in it.
    expect(appJsx.slice(mainIdx, rootIdx)).toContain("</main>");
  });

  it("uses a real portal rather than re-parenting via CSS", () => {
    expect(stepJsx).toContain("createPortal");
    expect(stepJsx).toContain("node-editor-portal-root");
  });

  it("falls back to in-place rendering when no shell overlay layer exists", () => {
    // Bare-component contexts (other test suites) must keep working.
    const { container } = renderStep();
    const drawer = openEditor(container);
    const stepBody = container.querySelector(".host-inventory-v2-body");
    expect(stepBody.contains(drawer)).toBe(true);
  });

  it("closing the editor removes it from the shell overlay layer", () => {
    const host = mountShellHost();
    const { container } = renderStep();
    openEditor(container);
    expect(host.querySelector(".host-inventory-v2-drawer")).toBeTruthy();
    fireEvent.click(host.querySelector('button[aria-label="Close"]'));
    expect(host.querySelector(".host-inventory-v2-drawer")).toBeNull();
    expect(host.children.length).toBe(0);
  });
});

describe("R3: shell overlay layer layout contract", () => {
  it("overlay root is a flex item that collapses when empty", () => {
    const body = rule(".shell-overlay-root");
    expect(body).toBeTruthy();
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/min-height:\s*0/);
    const empty = rule(".shell-overlay-root:empty");
    expect(empty).toMatch(/display:\s*none/);
  });

  it("no longer imposes a viewport-height box on the nested step container", () => {
    const body = rule(".host-inventory-v2-body.host-inventory-v2-body-with-drawer");
    expect(body).toBeTruthy();
    // The failed approach: height/max-height derived on the nested container.
    expect(body).not.toMatch(/(^|[\s;])height:/);
    expect(body).not.toMatch(/max-height:/);
    expect(body).not.toContain("100dvh");
  });

  it("drops the now-dead node-editor height tokens", () => {
    expect(css).not.toContain("--oaa-node-editor-h");
    expect(css).not.toContain("--oaa-node-editor-chrome-h");
  });

  it("drawer fills the overlay row and scrolls internally", () => {
    const drawer = rule(".host-inventory-v2-drawer");
    expect(drawer).toMatch(/height:\s*100%/);
    expect(drawer).toMatch(/overflow:\s*hidden/);
    const drawerBody = rule(".host-inventory-v2-drawer-body");
    expect(drawerBody).toMatch(/overflow-y:\s*auto/);
    expect(drawerBody).toMatch(/min-height:\s*0/);
  });

  it("stays below the app header and Tools in stacking order", () => {
    const drawerZ = Number((rule(".host-inventory-v2-drawer").match(/z-index:\s*(\d+)/) || [])[1]);
    const toolsZ = Number((rule(".tools-dropdown") || "").match(/z-index:\s*(\d+)/)?.[1] ?? 20);
    expect(drawerZ).toBeLessThan(toolsZ);
  });
});

describe("R3: previously accepted behavior preserved", () => {
  beforeEach(() => setViewport(1920, 1080));

  it("keeps the established horizontal width bounds", () => {
    mountShellHost();
    const { container } = renderStep();
    const drawer = openEditor(container);
    expect(drawer.style.minWidth).toBe("400px");
    expect(drawer.style.maxWidth).toBe("800px");
  });

  it("keeps Previous / Next, Validation and close controls", () => {
    mountShellHost();
    const { container } = renderStep();
    const drawer = openEditor(container);
    expect(drawer.querySelector('button[aria-label^="Previous node"]')).toBeTruthy();
    expect(drawer.querySelector('button[aria-label^="Next node"]')).toBeTruthy();
    expect(drawer.querySelector('button[aria-label="Close"]')).toBeTruthy();
  });

  it("does not touch the Shadowman branding element", () => {
    expect(stepJsx).not.toContain("sidebar-header");
    expect(stepJsx).not.toMatch(/logo/i);
  });

  it("opens at a shorter viewport too", () => {
    setViewport(1366, 768);
    mountShellHost();
    const { container } = renderStep();
    expect(openEditor(container)).toBeTruthy();
  });
});
