/**
 * OpenShift Airgap Architect - Test Suite
 *
 * DOC-131 — node editor Docked <-> Focus presentation mode.
 *
 * Two earlier DOC-131 attempts failed human acceptance:
 *   1. a CSS-only height change on a nested container (editor stayed trapped
 *      inside <main>'s scroll box);
 *   2. the shell portal correction, which was structurally right but still did
 *      not give the user materially more usable editing area.
 *
 * The accepted resolution keeps Docked exactly as-is and adds an OPTIONAL
 * Focus mode. These tests therefore assert BEHAVIOR and DOM structure — which
 * node is selected, which values survive, what is mounted where — rather than
 * re-asserting CSS strings, which is the mistake the first attempt made.
 *
 * jsdom limitation, stated explicitly: jsdom performs no layout and does not
 * evaluate container queries, so the RENDERED column count and the actual
 * reclaimed width are not verifiable here. Tests covering field density assert
 * only that the responsive contract is declared; the visual result is on the
 * human checklist (items C, D, E).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AppContext } from "../src/store.jsx";
import HostInventoryV2Step from "../src/steps/HostInventoryV2Step.jsx";
import { generateNodesFromCounts } from "../src/hostInventoryV2Helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
const stepJsx = fs.readFileSync(
  path.join(__dirname, "../src/steps/HostInventoryV2Step.jsx"),
  "utf8"
);

/** Body of the first CSS rule whose selector matches exactly. */
function rule(selector) {
  const idx = css.indexOf(selector + " {");
  if (idx === -1) return null;
  const open = css.indexOf("{", idx);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

const initialState = {
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
let mainEl = null;
let yamlEl = null;

/**
 * Stand-in for the App shell row: <main> (owns the node-card pane) ->
 * #node-editor-portal-root -> YAML drawer, matching App.jsx's .main-layout.
 */
function mountShell({ withYaml = false } = {}) {
  document.querySelectorAll(".main-layout").forEach((n) => n.remove());
  const layout = document.createElement("div");
  layout.className = "main-layout";
  mainEl = document.createElement("main");
  mainEl.className = "main";
  layout.appendChild(mainEl);
  shellHost = document.createElement("div");
  shellHost.id = "node-editor-portal-root";
  shellHost.className = "shell-overlay-root";
  layout.appendChild(shellHost);
  if (withYaml) {
    yamlEl = document.createElement("aside");
    yamlEl.className = "yaml-drawer-panel";
    layout.appendChild(yamlEl);
  }
  document.body.appendChild(layout);
  return shellHost;
}

/** Stateful store so edits actually round-trip, as they do in the real app. */
function Harness({ onUpdate }) {
  const [state, setState] = useState(initialState);
  const updateState = (patch) => {
    onUpdate?.(patch);
    setState((prev) => ({ ...prev, ...patch }));
  };
  return (
    <AppContext.Provider value={{ state, updateState, loading: false, startOver: vi.fn() }}>
      <HostInventoryV2Step previewEnabled={false} previewControls={{}} />
    </AppContext.Provider>
  );
}

function renderStep(onUpdate) {
  const result = render(<Harness onUpdate={onUpdate} />, {
    container: mainEl ? document.body.appendChild(document.createElement("div")) : undefined
  });
  // Keep the step inside the shell <main> so "node-card pane" claims are real.
  if (mainEl) mainEl.appendChild(result.container);
  return result;
}

function tiles(container) {
  return container.querySelectorAll(".host-inventory-v2-tile");
}

function drawerEl() {
  const found = document.querySelectorAll('[role="dialog"][aria-label="Edit node"]');
  return found.length ? found[found.length - 1] : null;
}

function openEditor(container, index = 0) {
  fireEvent.click(tiles(container)[index]);
  const drawer = drawerEl();
  expect(drawer).toBeTruthy();
  return drawer;
}

const toggle = () => drawerEl().querySelector(".host-inventory-v2-drawer-mode-toggle");
const closeBtn = () => drawerEl().querySelector('button[aria-label="Close"]');
const title = () => drawerEl().querySelector(".host-inventory-v2-drawer-title").textContent;

beforeEach(() => {
  document.querySelectorAll(".main-layout").forEach((n) => n.remove());
  shellHost = null;
  mainEl = null;
  yamlEl = null;
  delete document.body.dataset.nodeEditorMode;
});

afterEach(() => {
  delete document.body.dataset.nodeEditorMode;
});

describe("DOC-131 F1/F9: Docked remains the default mode", () => {
  it("opens a node in Docked mode with the accepted width bounds intact", () => {
    mountShell();
    const { container } = renderStep();
    const drawer = openEditor(container);

    expect(drawer.dataset.nodeEditorMode).toBe("docked");
    expect(drawer.classList.contains("host-inventory-v2-drawer-focus")).toBe(false);
    expect(drawer.style.minWidth).toBe("400px");
    expect(drawer.style.maxWidth).toBe("800px");
    expect(document.body.dataset.nodeEditorMode).toBeUndefined();
  });

  it("keeps the docked resize handle, and drops it in Focus where it is meaningless", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    expect(shellHost.querySelector(".host-inventory-v2-drawer-resize-handle")).toBeTruthy();

    fireEvent.click(toggle());
    expect(shellHost.querySelector(".host-inventory-v2-drawer-resize-handle")).toBeNull();
  });

  it("reopening a node after closing from Focus starts Docked again", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    fireEvent.click(toggle());
    expect(drawerEl().dataset.nodeEditorMode).toBe("focus");

    fireEvent.click(closeBtn());
    expect(drawerEl()).toBeNull();

    const reopened = openEditor(container);
    expect(reopened.dataset.nodeEditorMode).toBe("docked");
    expect(reopened.style.maxWidth).toBe("800px");
  });
});

describe("DOC-131 F2/F10: the Focus control", () => {
  it("renders a labelled toggle beside Close, without making Close ambiguous", () => {
    mountShell();
    const { container } = renderStep();
    const drawer = openEditor(container);

    const actions = drawer.querySelector(".host-inventory-v2-drawer-header-actions");
    expect(actions).toBeTruthy();
    const buttons = Array.from(actions.querySelectorAll("button"));
    expect(buttons).toHaveLength(2);
    // Toggle first, Close last — "Edit: host   [Focus] [X]".
    expect(buttons[0]).toBe(toggle());
    expect(buttons[1]).toBe(closeBtn());
    expect(closeBtn().getAttribute("aria-label")).toBe("Close");
  });

  it("exposes pressed state and a name that flips with the mode", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);

    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(toggle().getAttribute("aria-label")).toMatch(/focus/i);

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(toggle().getAttribute("aria-label")).toMatch(/exit focus/i);
  });

  it("is icon-only: the accessible name carries the meaning, not visible text", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);

    // Human preference: compact icon beside ×, no "Focus"/"Restore" wording.
    expect(toggle().textContent.trim()).toBe("");
    const icon = toggle().querySelector("svg");
    expect(icon).toBeTruthy();
    // Decorative: the button's aria-label is the only accessible name.
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("focusable")).toBe("false");
    expect(icon.getAttribute("stroke")).toBe("currentColor");
    expect(toggle().getAttribute("aria-label")).toBe("Expand node editor to focus mode");
    expect(toggle().getAttribute("title")).toBe("Expand the editor across the full workspace");
  });

  it("swaps to a distinct restore glyph with the focused label and title", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    const dockedPaths = Array.from(toggle().querySelectorAll("path")).map((p) => p.getAttribute("d"));

    fireEvent.click(toggle());
    const focusedPaths = Array.from(toggle().querySelectorAll("path")).map((p) => p.getAttribute("d"));

    expect(dockedPaths).toHaveLength(4);
    expect(focusedPaths).toHaveLength(4);
    expect(focusedPaths).not.toEqual(dockedPaths);
    expect(toggle().getAttribute("aria-label")).toBe("Exit focus mode");
    expect(toggle().getAttribute("title")).toBe("Restore the docked editor");
  });

  it("keeps Close independently reachable and unambiguous beside the icon", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    fireEvent.click(toggle());

    // × stays a separate control with its own name, and still closes.
    expect(closeBtn()).not.toBe(toggle());
    expect(closeBtn().getAttribute("aria-label")).toBe("Close");
    expect(closeBtn().textContent).toContain("×");
    fireEvent.click(closeBtn());
    expect(drawerEl()).toBeNull();
  });

  it("introduces no icon-library dependency", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../package.json"), "utf8")
    );
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /icon|lucide|heroicons|feather|fontawesome/i.test(d))).toEqual([]);
  });

  it("Escape returns Focus to Docked and never closes the editor", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    fireEvent.click(toggle());
    expect(drawerEl().dataset.nodeEditorMode).toBe("focus");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(drawerEl()).toBeTruthy();
    expect(drawerEl().dataset.nodeEditorMode).toBe("docked");
  });

  it("Escape in Docked mode does not close the editor either", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(drawerEl()).toBeTruthy();
    expect(drawerEl().dataset.nodeEditorMode).toBe("docked");
  });
});

describe("DOC-131 F3/F4: one editor, re-presented — not a second component", () => {
  it("toggling Focus keeps the same selected node and emits no state update", () => {
    mountShell();
    const onUpdate = vi.fn();
    const { container } = renderStep(onUpdate);
    openEditor(container);
    const before = title();

    onUpdate.mockClear();
    fireEvent.click(toggle());

    expect(title()).toBe(before);
    // Presentation only: no canonical node/state mutation.
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("renders exactly one node-editor tree in either mode", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    const count = () => document.querySelectorAll('[role="dialog"][aria-label="Edit node"]').length;
    expect(count()).toBe(1);

    fireEvent.click(toggle());
    expect(count()).toBe(1);
    // And still the single portalled instance, not a modal copy.
    expect(shellHost.querySelectorAll(".host-inventory-v2-drawer")).toHaveLength(1);
  });

  it("Focus stays in the shell overlay layer and is not re-parented into the step", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    fireEvent.click(toggle());

    const drawer = drawerEl();
    expect(shellHost.contains(drawer)).toBe(true);
    expect(container.querySelector(".host-inventory-v2-body").contains(drawer)).toBe(false);
  });

  it("Focus drops the docked width constraint entirely", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    fireEvent.click(toggle());

    const drawer = drawerEl();
    expect(drawer.classList.contains("host-inventory-v2-drawer-focus")).toBe(true);
    expect(drawer.style.width).toBe("");
    expect(drawer.style.minWidth).toBe("");
    expect(drawer.style.maxWidth).toBe("");
  });

  it("signals the shell to yield the node-card pane, and releases it on restore", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    expect(document.body.dataset.nodeEditorMode).toBeUndefined();

    fireEvent.click(toggle());
    expect(document.body.dataset.nodeEditorMode).toBe("focus");

    fireEvent.click(toggle());
    expect(document.body.dataset.nodeEditorMode).toBeUndefined();
  });

  it("releases the shell signal when the editor is closed from Focus", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    fireEvent.click(toggle());
    expect(document.body.dataset.nodeEditorMode).toBe("focus");

    fireEvent.click(closeBtn());
    expect(document.body.dataset.nodeEditorMode).toBeUndefined();
  });

  it("releases the shell signal on unmount (step navigation / Start Over)", () => {
    mountShell();
    const { container, unmount } = renderStep();
    openEditor(container);
    fireEvent.click(toggle());
    expect(document.body.dataset.nodeEditorMode).toBe("focus");

    unmount();
    expect(document.body.dataset.nodeEditorMode).toBeUndefined();
  });

  it("the node-card pane is collapsed by the shell, not by unmounting the step", () => {
    // display:none keeps React state alive; that is what makes F3 value
    // preservation possible. jsdom does not apply the stylesheet, so this
    // asserts the declared contract, not computed geometry.
    const collapse = rule('body[data-node-editor-mode="focus"] .main-layout > .main');
    expect(collapse).toBeTruthy();
    expect(collapse).toMatch(/display:\s*none/);
    expect(collapse).not.toMatch(/visibility|opacity/);

    const overlay = rule('body[data-node-editor-mode="focus"] .shell-overlay-root');
    expect(overlay).toMatch(/flex:\s*1 1 auto/);
  });
});

describe("DOC-131 F3/F9: state and navigation across modes", () => {
  it("preserves a typed field value across Docked -> Focus -> Docked", () => {
    mountShell();
    const { container } = renderStep();
    const drawer = openEditor(container);

    const hostname = within(drawer).getAllByRole("textbox")[0];
    fireEvent.change(hostname, { target: { value: "edge-node-7" } });
    expect(within(drawerEl()).getAllByRole("textbox")[0].value).toBe("edge-node-7");

    fireEvent.click(toggle());
    expect(drawerEl().dataset.nodeEditorMode).toBe("focus");
    expect(within(drawerEl()).getAllByRole("textbox")[0].value).toBe("edge-node-7");

    fireEvent.click(toggle());
    expect(drawerEl().dataset.nodeEditorMode).toBe("docked");
    expect(within(drawerEl()).getAllByRole("textbox")[0].value).toBe("edge-node-7");
  });

  it("Previous / Next change the node while Focus stays active", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    fireEvent.click(toggle());

    const first = title();
    fireEvent.click(drawerEl().querySelector('button[aria-label^="Next node"]'));
    expect(drawerEl().dataset.nodeEditorMode).toBe("focus");
    expect(title()).not.toBe(first);

    fireEvent.click(drawerEl().querySelector('button[aria-label^="Previous node"]'));
    expect(drawerEl().dataset.nodeEditorMode).toBe("focus");
    expect(title()).toBe(first);
  });

  it("Restore after paging lands Docked on the currently selected node", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    fireEvent.click(toggle());
    fireEvent.click(drawerEl().querySelector('button[aria-label^="Next node"]'));
    const paged = title();

    fireEvent.click(toggle());
    expect(drawerEl().dataset.nodeEditorMode).toBe("docked");
    expect(title()).toBe(paged);
    expect(drawerEl().style.maxWidth).toBe("800px");
  });

  it("closing from Focus removes the editor completely", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    fireEvent.click(toggle());

    fireEvent.click(closeBtn());
    expect(drawerEl()).toBeNull();
    expect(shellHost.children.length).toBe(0);
  });
});

describe("DOC-131 F7/F8: coexistence with YAML, Tools and the app shell", () => {
  it("leaves the YAML drawer mounted and beside — never inside — the focused editor", () => {
    mountShell({ withYaml: true });
    const { container } = renderStep();
    openEditor(container);
    fireEvent.click(toggle());

    expect(document.querySelector(".yaml-drawer-panel")).toBe(yamlEl);
    expect(yamlEl.contains(drawerEl())).toBe(false);
    expect(drawerEl().contains(yamlEl)).toBe(false);
    // Sibling order within the shell row is unchanged by Focus.
    const kids = Array.from(yamlEl.parentElement.children);
    expect(kids.indexOf(shellHost)).toBeLessThan(kids.indexOf(yamlEl));
  });

  it("no Focus rule reaches into the YAML drawer", () => {
    const focusRules = css
      .split("\n")
      .filter((l) => l.includes("node-editor-mode") || l.includes("host-inventory-v2-drawer-focus"));
    expect(focusRules.length).toBeGreaterThan(0);
    expect(focusRules.some((l) => l.includes("yaml-drawer"))).toBe(false);
  });

  it("keeps the editor below Tools in stacking order in Focus mode", () => {
    const drawerZ = Number((rule(".host-inventory-v2-drawer").match(/z-index:\s*(\d+)/) || [])[1]);
    const toolsZ = Number((rule(".tools-dropdown") || "").match(/z-index:\s*(\d+)/)?.[1] ?? 20);
    expect(drawerZ).toBeLessThan(toolsZ);
    // Focus must not escalate the editor above Tools / header.
    expect(rule(".host-inventory-v2-drawer-focus")).not.toMatch(/z-index/);
  });

  it("does not use the browser Fullscreen API or cover browser chrome", () => {
    expect(stepJsx).not.toMatch(/requestFullscreen|webkitRequestFullscreen|exitFullscreen/);
    expect(rule(".host-inventory-v2-drawer-focus")).not.toMatch(/position:\s*fixed/);
  });

  it("does not touch header / Shadowman branding", () => {
    expect(stepJsx).not.toContain("sidebar-header");
    expect(stepJsx).not.toMatch(/logo/i);
    const focusCss = css.slice(css.indexOf(".host-inventory-v2-drawer-header-actions"));
    expect(focusCss).not.toMatch(/\.app-header|\.sidebar-header|shadowman/i);
  });
});

describe("DOC-131 F5/F6: reclaimed width becomes density, not dead space", () => {
  /* jsdom does not lay out or evaluate container queries. These assert the
     declared responsive contract only; the rendered result is human item D/E. */

  it("drives field density from the editor's own width, not the viewport", () => {
    // Viewport media queries would be wrong here: the editor narrows when the
    // YAML drawer is open while the viewport does not change.
    expect(css).toContain("container-name: oaa-node-editor");
    expect(css).toMatch(/\.host-inventory-v2-drawer-focus \.host-inventory-v2-drawer-body \{[^}]*container-type:\s*inline-size/);
    expect(css).toMatch(/@container oaa-node-editor \(min-width: 720px\)/);
    expect(css).toMatch(/@container oaa-node-editor \(min-width: 1120px\)/);
  });

  it("caps Focus at three columns so semantic groups are not shredded", () => {
    const wide = css.slice(css.indexOf("@container oaa-node-editor (min-width: 1120px)"));
    expect(wide).toMatch(/grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    // No auto-fill at focus width: that is what produced 5-6 stray columns.
    const mid = css.slice(
      css.indexOf("@container oaa-node-editor (min-width: 720px)"),
      css.indexOf("@container oaa-node-editor (min-width: 1120px)")
    );
    expect(mid).toMatch(/repeat\(2, minmax\(0, 1fr\)\)/);
    expect(mid).not.toContain("auto-fill");
  });

  it("lets prose and separators span their group instead of becoming stray cells", () => {
    const mid = css.slice(css.indexOf("@container oaa-node-editor (min-width: 720px)"));
    expect(mid).toMatch(/\.field-grid > \.note/);
    expect(mid).toMatch(/grid-column:\s*1 \/ -1/);
  });

  it("adds no max-width cap that would recreate the dead-space problem", () => {
    const focusRule = rule(".host-inventory-v2-drawer-focus");
    expect(focusRule).toMatch(/max-width:\s*none/);
    expect(focusRule).toMatch(/flex:\s*1 1 auto/);
  });

  it("keeps editor controls outside the scrolling region so they stay reachable", () => {
    // Structural, not CSS: the header is a sibling of the scroll box, so it
    // cannot scroll away regardless of form length.
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    fireEvent.click(toggle());

    const drawer = drawerEl();
    const body = drawer.querySelector(".host-inventory-v2-drawer-body");
    const header = drawer.querySelector(".host-inventory-v2-drawer-header");
    expect(body).toBeTruthy();
    expect(header).toBeTruthy();
    expect(body.contains(header)).toBe(false);
    expect(header.contains(toggle())).toBe(true);
    expect(header.contains(closeBtn())).toBe(true);
    expect(header.querySelector('button[aria-label^="Previous node"]')).toBeTruthy();
    expect(header.querySelector('button[aria-label^="Next node"]')).toBeTruthy();
  });

  it("reuses existing surface tokens rather than a separate modal implementation", () => {
    expect(stepJsx).not.toContain("NodeModal");
    // Focus reuses the drawer surface; it does not add a modal backdrop layer.
    expect(rule(".host-inventory-v2-drawer-focus")).not.toMatch(/background:/);
    expect(drawerSurfaceIsShared()).toBe(true);
  });

  function drawerSurfaceIsShared() {
    // .host-inventory-v2-drawer-focus is additive on .host-inventory-v2-drawer,
    // so background/radii/typography all come from the accepted docked surface.
    return stepJsx.includes("host-inventory-v2-drawer host-inventory-v2-section");
  }
});

describe("DOC-131 S3: canonical control row, order and sizing", () => {
  /* jsdom lays nothing out, so how many rows the controls occupy at a given
     drawer width is a human item. Asserted here: DOM/tab order, grouping,
     the sizing contract, and that no obsolete Apply-only row survives. */

  const controls = () => drawerEl().querySelector(".host-inventory-v2-drawer-controls");
  const windowActions = () => drawerEl().querySelector(".host-inventory-v2-drawer-header-actions");
  const applyBtn = () => within(drawerEl()).getByRole("button", { name: /apply settings/i });

  /** Every actionable control in the editor header, in DOM order. */
  const headerActions = () =>
    Array.from(
      drawerEl()
        .querySelector(".host-inventory-v2-drawer-header")
        .querySelectorAll("button")
    );

  const labelOf = (b) =>
    b.getAttribute("aria-label") || b.textContent.trim();

  const expectCanonicalOrder = () => {
    const order = headerActions().map(labelOf);
    expect(order).toEqual([
      "Previous node (1 of 5)",
      "Next node (1 of 5)",
      "Apply settings to other nodes…",
      order[3], // Focus/Restore label varies by mode
      "Close"
    ]);
    expect(order[3]).toMatch(/focus/i);
  };

  it("uses the canonical DOM order in Docked: Previous, Next, Apply, Focus, Close", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    expectCanonicalOrder();
  });

  it("uses the same canonical DOM order in Focus", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    fireEvent.click(toggle());
    expect(drawerEl().dataset.nodeEditorMode).toBe("focus");
    expectCanonicalOrder();
  });

  it("keeps the position indicator between Previous and Next", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    const nav = drawerEl().querySelector(".host-inventory-v2-drawer-nav");
    const kids = Array.from(nav.children);
    expect(kids).toHaveLength(3);
    expect(kids[0].getAttribute("aria-label")).toMatch(/^Previous node/);
    expect(kids[1].textContent).toMatch(/1 \/ 5/);
    expect(kids[2].getAttribute("aria-label")).toMatch(/^Next node/);
  });

  it("makes Close the last action and nothing actionable follows it", () => {
    for (const focus of [false, true]) {
      mountShell();
      const { container, unmount } = renderStep();
      openEditor(container);
      if (focus) fireEvent.click(toggle());

      const actions = headerActions();
      expect(labelOf(actions[actions.length - 1])).toBe("Close");

      // Nothing focusable sits after Close anywhere in the header.
      const header = drawerEl().querySelector(".host-inventory-v2-drawer-header");
      const focusables = Array.from(
        header.querySelectorAll("button, a[href], input, select, textarea, [tabindex]")
      );
      expect(focusables[focusables.length - 1]).toBe(closeBtn());
      unmount();
    }
  });

  it("keeps Focus/Restore immediately before Close, as one terminal group", () => {
    for (const focus of [false, true]) {
      mountShell();
      const { container, unmount } = renderStep();
      openEditor(container);
      if (focus) fireEvent.click(toggle());

      const actions = headerActions();
      expect(actions[actions.length - 2]).toBe(toggle());
      expect(actions[actions.length - 1]).toBe(closeBtn());

      // Same wrapper, adjacent siblings, in that order — so responsive
      // wrapping cannot split or reverse the pair.
      expect(windowActions().contains(toggle())).toBe(true);
      expect(windowActions().contains(closeBtn())).toBe(true);
      expect(Array.from(windowActions().children)).toEqual([toggle(), closeBtn()]);
      expect(toggle().nextElementSibling).toBe(closeBtn());
      unmount();
    }
  });

  it("places Apply in the shared control region, not a row of its own", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    expect(controls().contains(applyBtn())).toBe(true);
    // Apply precedes the terminal pair and follows the pager.
    const kids = Array.from(controls().children);
    expect(kids.indexOf(applyBtn())).toBeGreaterThan(
      kids.indexOf(drawerEl().querySelector(".host-inventory-v2-drawer-nav"))
    );
    expect(kids.indexOf(applyBtn())).toBeLessThan(kids.indexOf(windowActions()));
  });

  it("leaves no obsolete Apply-only row behind", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    const header = drawerEl().querySelector(".host-inventory-v2-drawer-header");
    // The header's only non-validation child is the single control region.
    const structural = Array.from(header.children).filter(
      (el) => !el.classList.contains("host-inventory-v2-validation-summary")
    );
    expect(structural).toEqual([controls()]);
  });

  it("keeps Apply a normal peer button, never a shrunken chip", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    // Same control family as its neighbours.
    expect(applyBtn().tagName).toBe("BUTTON");
    expect(applyBtn().classList.contains("ghost")).toBe(true);
    expect(applyBtn().className).not.toMatch(/small|chip|link|compact/);
    expect(applyBtn().getAttribute("style")).toBeNull();
  });

  it("has no CSS rule that uniquely shrinks Apply", () => {
    // The earlier over-compaction was `padding: 0` on this selector.
    const applyRules = [];
    const re = /\.host-inventory-v2-drawer-apply[^{]*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) applyRules.push(m[1]);
    expect(applyRules.length).toBeGreaterThan(0);
    for (const body of applyRules) {
      expect(body).not.toMatch(/padding:/);
      expect(body).not.toMatch(/min-height:/);
      expect(body).not.toMatch(/font-size:/);
      expect(body).not.toMatch(/height:/);
    }
    // And the row declares one shared minimum height for every button on it.
    expect(rule(".host-inventory-v2-drawer-controls .ghost")).toMatch(/min-height:\s*2\.25rem/);
  });

  it("drives wrapping from the drawer's container width, not the viewport", () => {
    const drawerRule = css.slice(css.indexOf(".host-inventory-v2-drawer {\n  container-type"));
    expect(drawerRule.slice(0, 200)).toMatch(/container-type:\s*inline-size/);
    expect(drawerRule.slice(0, 200)).toMatch(/container-name:\s*oaa-node-editor-shell/);

    // The row itself wraps continuously rather than snapping at a breakpoint.
    expect(rule(".host-inventory-v2-drawer-controls")).toMatch(/flex-wrap:\s*wrap/);
    // The one stepped decision is keyed to the container, never the viewport.
    expect(css).toMatch(/@container oaa-node-editor-shell \(max-width: 28rem\)/);
    expect(css).not.toMatch(/@media[^{]*\{[^}]*host-inventory-v2-drawer-controls[^}]*flex-wrap/);
  });

  it("wraps rather than shrinking: controls hold their size, the title gives way", () => {
    expect(rule(".host-inventory-v2-drawer-nav")).toMatch(/flex:\s*0 0 auto/);
    expect(rule(".host-inventory-v2-drawer-apply")).toMatch(/flex:\s*0 0 auto/);
    expect(rule(".host-inventory-v2-drawer-header-actions")).toMatch(/flex:\s*0 0 auto/);
    // The pair never splits across rows.
    expect(rule(".host-inventory-v2-drawer-header-actions")).toMatch(/flex-wrap:\s*nowrap/);
    // Only the title truncates.
    expect(rule(".host-inventory-v2-drawer-title")).toMatch(/text-overflow:\s*ellipsis/);
  });

  it("does not let the title reserve width that forces the terminal pair to wrap", () => {
    // A flex container breaks lines on each item's hypothetical main size
    // (flex-basis clamped by min/max) and only shrinks afterwards, within a
    // line already formed. A title with a large flex-basis therefore pushed
    // the Focus/Close pair onto a second row at full docked width and could
    // never shrink to prevent it. Basis must stay 0 so the title's only
    // line-break cost is its readable min-width floor.
    const titleRule = rule(".host-inventory-v2-drawer-title");
    expect(titleRule).toMatch(/flex:\s*1 1 0\s*;/);
    expect(titleRule).not.toMatch(/flex:\s*1 1 \d+(rem|px)/);
    // Still grows into whatever the controls leave, so a wide row is not
    // rendered with a stunted title.
    expect(titleRule).toMatch(/flex:\s*1 1 /);
    // Readable floor retained rather than collapsing to zero.
    expect(titleRule).toMatch(/min-width:\s*6rem/);

    // Nothing else may reintroduce a large basis for the title; the only
    // other rule is the narrow-container full-row override.
    const titleRules = [];
    const re = /\.host-inventory-v2-drawer-title[^{]*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) titleRules.push(m[1]);
    const bases = titleRules.map((b) => (b.match(/flex:\s*1 1 ([^;]+);/) || [])[1]).filter(Boolean);
    expect(bases.sort()).toEqual(["0", "100%"]);
  });

  it("keeps the wide row free of any forced second action row", () => {
    // No rule pushes the terminal pair onto its own line, and the pair is not
    // given a full-width basis anywhere.
    const actions = rule(".host-inventory-v2-drawer-header-actions");
    expect(actions).not.toMatch(/flex:\s*[^;]*100%/);
    expect(actions).not.toMatch(/width:\s*100%/);
    // The auto margin right-aligns a wrapped pair but must not be the thing
    // that creates the wrap, so it stays on the pair, not on a preceding item.
    expect(rule(".host-inventory-v2-drawer-apply")).not.toMatch(/margin-left:\s*auto/);
    expect(rule(".host-inventory-v2-drawer-nav")).not.toMatch(/margin-left:\s*auto/);
    expect(actions).toMatch(/margin-left:\s*auto/);
  });

  it("keeps button sizing exactly as accepted", () => {
    // Width pressure is solved by the row, never by shrinking a control.
    expect(rule(".host-inventory-v2-drawer-controls .ghost")).toMatch(/min-height:\s*2\.25rem/);
    const iconRule = rule(".host-inventory-v2-drawer-mode-toggle,\n.host-inventory-v2-drawer-close");
    expect(iconRule).toMatch(/min-width:\s*2\.25rem/);
    for (const sel of [".host-inventory-v2-drawer-controls", ".host-inventory-v2-drawer-nav"]) {
      expect(rule(sel)).not.toMatch(/font-size:/);
    }
  });

  it("keeps validation below the control region and above the scrolling form", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    const drawer = drawerEl();
    const header = drawer.querySelector(".host-inventory-v2-drawer-header");
    const body = drawer.querySelector(".host-inventory-v2-drawer-body");

    // Control region is inside the header; the scroll body is a later sibling.
    expect(header.contains(controls())).toBe(true);
    expect(body.contains(controls())).toBe(false);
    expect(
      header.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // Validation, when present, is a full-width row of the header, not a
    // flex item squeezed in beside the controls.
    expect(rule(".host-inventory-v2-validation-summary")).toMatch(/width:\s*100%/);
    expect(rule(".host-inventory-v2-validation-summary")).not.toMatch(/flex:\s*1 1 100%/);
  });

  it("uses one shared control structure for both modes, not two implementations", () => {
    expect(stepJsx).not.toMatch(/DockedHeader|FocusHeader/);
    // Exactly one control region is rendered in either mode.
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    expect(document.querySelectorAll(".host-inventory-v2-drawer-controls")).toHaveLength(1);
    fireEvent.click(toggle());
    expect(document.querySelectorAll(".host-inventory-v2-drawer-controls")).toHaveLength(1);
    // Order is DOM order, never CSS `order`.
    const controlsCss = rule(".host-inventory-v2-drawer-controls");
    expect(controlsCss).not.toMatch(/(^|[^-])order:/);
  });

  it("leaves every control's behaviour unchanged", () => {
    mountShell();
    const { container } = renderStep();
    openEditor(container);
    const first = title();

    fireEvent.click(drawerEl().querySelector('button[aria-label^="Next node"]'));
    expect(title()).not.toBe(first);
    fireEvent.click(drawerEl().querySelector('button[aria-label^="Previous node"]'));
    expect(title()).toBe(first);

    fireEvent.click(toggle());
    expect(drawerEl().dataset.nodeEditorMode).toBe("focus");
    fireEvent.click(toggle());
    expect(drawerEl().dataset.nodeEditorMode).toBe("docked");

    fireEvent.click(applyBtn());
    expect(document.querySelector(".modal-backdrop")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(closeBtn());
    expect(drawerEl()).toBeNull();
  });
});

describe("DOC-131 A: bond member cards are compacted in Focus only", () => {
  /* jsdom does no layout, so the rendered card width, how many sit side by
     side and where the row wraps are NOT asserted here — those are human
     items 1-3. What is asserted: which arrangement hook applies in which
     mode, and that compaction never regroups or reorders the data. */

  function BondHarness() {
    const [state, setState] = useState(() => {
      const nodes = generateNodesFromCounts(3, 2, 0).map((n) => ({ ...n }));
      nodes[0] = {
        ...nodes[0],
        primary: {
          ...nodes[0].primary,
          type: "bond",
          bond: {
            name: "bond0",
            mode: "active-backup",
            slaves: [
              { name: "eth0", macAddress: "52:54:00:aa:11:01" },
              { name: "eth1", macAddress: "52:54:00:aa:11:02" }
            ]
          }
        }
      };
      return { ...initialState, hostInventory: { ...initialState.hostInventory, nodes } };
    });
    return (
      <AppContext.Provider
        value={{ state, updateState: (p) => setState((s) => ({ ...s, ...p })), loading: false, startOver: vi.fn() }}
      >
        <HostInventoryV2Step previewEnabled={false} previewControls={{}} />
      </AppContext.Provider>
    );
  }

  function renderBond() {
    const result = render(<BondHarness />);
    if (mainEl) mainEl.appendChild(result.container);
    return result;
  }

  const section = () => drawerEl().querySelector(".bond-members-section");
  const cards = () => Array.from(section().querySelectorAll(".bond-member-item"));

  it("renders the member collection inside the v2 drawer in BOTH modes (R-C)", () => {
    mountShell();
    const { container } = renderBond();
    openEditor(container);

    // R-C extends the compact arrangement to Docked, so the hook is the v2
    // drawer, not the focus class. Docked must now match it too.
    expect(section()).toBeTruthy();
    expect(section().closest(".host-inventory-v2-drawer")).toBe(drawerEl());
    expect(section().closest(".host-inventory-v2-drawer-focus")).toBeNull();

    fireEvent.click(toggle());
    expect(section().closest(".host-inventory-v2-drawer")).toBe(drawerEl());
    expect(section().closest(".host-inventory-v2-drawer-focus")).toBe(drawerEl());
  });

  it("applies one bounded, container-driven arrangement to Docked and Focus alike", () => {
    const compact = rule(".host-inventory-v2-drawer .bond-members-section");
    expect(compact).toBeTruthy();
    expect(compact).toMatch(/display:\s*grid/);
    expect(compact).toMatch(/justify-content:\s*start/);
    // Bounded max, never 1fr: 1fr would stretch members across the whole row.
    expect(compact).toMatch(/repeat\(auto-fit, minmax\(min\(100%, 14rem\), 16rem\)\)/);
    expect(compact).not.toMatch(/minmax\([^)]*,\s*1fr\)/);

    // Width-driven, not viewport-driven: min(100%, …) collapses to one column
    // on a narrow container, so no @media breakpoint is involved.
    const compactStart = css.indexOf(".host-inventory-v2-drawer .bond-members-section");
    const compactBlock = css.slice(compactStart, compactStart + 400);
    expect(compactBlock).not.toContain("@media");

    // The legacy v1 Host Inventory step keeps the stacked column.
    const base = rule("\n.bond-members-section");
    expect(base).toMatch(/flex-direction:\s*column/);
  });

  it("keeps member cards compact in Docked, not stretched across the drawer", () => {
    // Structural half of R-C: the collection is a grid of bounded tracks in
    // Docked. Rendered track count at a given drawer width is geometry and is
    // a human item.
    mountShell();
    const { container } = renderBond();
    openEditor(container);
    expect(drawerEl().dataset.nodeEditorMode).toBe("docked");
    expect(section().querySelectorAll(".bond-member-item")).toHaveLength(2);
    expect(section().closest(".host-inventory-v2-drawer")).toBeTruthy();
  });

  it("keeps each member's Interface and MAC inside the same card", () => {
    mountShell();
    const { container } = renderBond();
    openEditor(container);
    fireEvent.click(toggle());

    expect(cards()).toHaveLength(2);
    cards().forEach((card) => {
      const inputs = within(card).getAllByRole("textbox");
      expect(inputs).toHaveLength(2);
      expect(card.querySelector(".bond-member-header")).toBeTruthy();
      expect(card.querySelector(".bond-member-fields")).toBeTruthy();
    });
    // Not flattened into one shared grid across members.
    expect(section().querySelectorAll(".bond-member-fields")).toHaveLength(2);
  });

  it("preserves member DOM order and values when entering Focus", () => {
    mountShell();
    const { container } = renderBond();
    openEditor(container);
    const dockedOrder = cards().map((c) => within(c).getAllByRole("textbox")[0].value);
    expect(dockedOrder).toEqual(["eth0", "eth1"]);

    fireEvent.click(toggle());
    expect(cards().map((c) => within(c).getAllByRole("textbox")[0].value)).toEqual(dockedOrder);
    expect(cards().map((c) => c.querySelector(".bond-member-header").textContent)).toEqual([
      "Bond member 1",
      "Bond member 2"
    ]);
    // MAC stays paired with its own interface.
    expect(within(cards()[1]).getAllByRole("textbox")[1].value).toBe("52:54:00:aa:11:02");
  });

  it("keeps Add bond member after the grid, outside it, and still working", () => {
    mountShell();
    const { container } = renderBond();
    openEditor(container);
    fireEvent.click(toggle());

    const add = within(drawerEl()).getByRole("button", { name: /add bond member/i });
    expect(section().contains(add)).toBe(false);
    // Document order: the collection, then the action.
    expect(section().compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(add);
    expect(cards()).toHaveLength(3);
    // Still focused, existing members untouched, new member appended last.
    expect(drawerEl().dataset.nodeEditorMode).toBe("focus");
    expect(cards().map((c) => within(c).getAllByRole("textbox")[0].value)).toEqual(["eth0", "eth1", ""]);
  });

  it("keeps Add bond member outside and after the grid in Docked too", () => {
    mountShell();
    const { container } = renderBond();
    openEditor(container);

    const add = within(drawerEl()).getByRole("button", { name: /add bond member/i });
    expect(section().contains(add)).toBe(false);
    expect(section().compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(add);
    expect(cards()).toHaveLength(3);
    expect(drawerEl().dataset.nodeEditorMode).toBe("docked");
    expect(cards().map((c) => within(c).getAllByRole("textbox")[0].value)).toEqual(["eth0", "eth1", ""]);
  });

  it("does not alter bond markup or data — arrangement is CSS-only", () => {
    const agentJsx = fs.readFileSync(
      path.join(__dirname, "../src/components/NodeDrawerAgentContent.jsx"),
      "utf8"
    );
    // No mode prop threaded into the member markup; the hook is the ancestor.
    expect(agentJsx).not.toMatch(/nodeEditorMode|isNodeEditorFocused|drawer-focus/);
    expect(agentJsx).toContain('className="bond-members-section"');
    expect(agentJsx).toContain('className="bond-member-item"');
  });
});
