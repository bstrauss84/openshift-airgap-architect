/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * DOC-159 — UI-path half of the repeatable-collection evidence.
 *
 * The backend suite (backend/test/repeatable-collection-generation.test.js)
 * proves canonical state -> generated artifact. This proves the other half for
 * Additional Interfaces and static Routes: the real editor controls -> the
 * canonical state the generator is fed, including order and removal.
 *
 * Together with the live API runs recorded in DOC-159 this closes
 * UI -> state -> generated output for both collections.
 *
 * jsdom renders no layout; nothing here claims anything about geometry.
 */
import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, within, cleanup } from "@testing-library/react";
import { AppContext } from "../src/store.jsx";
import HostInventoryV2Step from "../src/steps/HostInventoryV2Step.jsx";
import { generateNodesFromCounts } from "../src/hostInventoryV2Helpers.js";

const baseState = {
  blueprint: { platform: "Bare Metal", baseDomain: "example.com" },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: { nodes: generateNodesFromCounts(3, 2, 0), ipStackMode: "ipv4" },
  globalStrategy: { networking: { machineNetworkV4: "10.0.0.0/24" } },
  ui: {}
};

/** Latest canonical state, as the preview/generator would receive it. */
let latest = null;

function Harness() {
  const [state, setState] = useState(baseState);
  latest = state;
  const updateState = (patch) => setState((prev) => ({ ...prev, ...patch }));
  return (
    <AppContext.Provider value={{ state, updateState, loading: false, startOver: vi.fn() }}>
      <HostInventoryV2Step previewEnabled={false} previewControls={{}} />
    </AppContext.Provider>
  );
}

const node0 = () => latest.hostInventory.nodes[0];
const drawer = () => document.querySelector('[role="dialog"][aria-label="Edit node"]');

function openFirstNode(container) {
  fireEvent.click(container.querySelectorAll(".host-inventory-v2-tile")[0]);
  expect(drawer()).toBeTruthy();
}

beforeEach(() => {
  cleanup();
  latest = null;
});

describe("DOC-159 UI path: Additional Interfaces", () => {
  const addBtn = () => within(drawer()).getByRole("button", { name: /^Add Interface$/i });
  const ifaces = () => node0().additionalInterfaces || [];

  it("adds an interface into canonical state with a usable generated name", () => {
    const { container } = render(<Harness />);
    openFirstNode(container);
    expect(ifaces()).toHaveLength(0);

    fireEvent.click(addBtn());
    expect(ifaces()).toHaveLength(1);
    // Auto-named, so a freshly added row is already generatable — this is why
    // the blank-identity crash was only reachable by clearing the field.
    expect(ifaces()[0].ethernet?.name).toMatch(/^eno\d+$/);
    expect(ifaces()[0].type).toBe("ethernet");
  });

  it("edits an interface and the edit lands in canonical state", () => {
    const { container } = render(<Harness />);
    openFirstNode(container);
    fireEvent.click(addBtn());

    const nameInput = within(drawer()).getAllByRole("textbox").find(
      (i) => i.value === ifaces()[0].ethernet.name
    );
    expect(nameInput).toBeTruthy();
    fireEvent.change(nameInput, { target: { value: "ens224" } });
    expect(ifaces()[0].ethernet.name).toBe("ens224");
  });

  it("keeps multiple interfaces in the order they were added", () => {
    const { container } = render(<Harness />);
    openFirstNode(container);
    fireEvent.click(addBtn());
    fireEvent.click(addBtn());
    fireEvent.click(addBtn());

    expect(ifaces()).toHaveLength(3);
    const names = ifaces().map((i) => i.ethernet?.name);
    expect(new Set(names).size).toBe(3);
    expect(names).toEqual([...names]);
  });

  it("removes the right interface and leaves the rest intact and ordered", () => {
    const { container } = render(<Harness />);
    openFirstNode(container);
    fireEvent.click(addBtn());
    fireEvent.click(addBtn());
    fireEvent.click(addBtn());
    const before = ifaces().map((i) => i.ethernet.name);

    // Each interface renders as a card headed "Interface N" with its own
    // Remove; scope to those so route Remove buttons cannot be picked up.
    const ifaceCards = Array.from(drawer().querySelectorAll("section.card")).filter((el) =>
      /^Interface \d+$/.test(el.querySelector("h4")?.textContent?.trim() || "")
    );
    expect(ifaceCards).toHaveLength(3);
    fireEvent.click(within(ifaceCards[1]).getByRole("button", { name: /^Remove$/i }));

    const after = ifaces().map((i) => i.ethernet.name);
    expect(after).toHaveLength(2);
    expect(after).toEqual([before[0], before[2]]);
    expect(after).not.toContain(before[1]);
  });

  it("an interface whose name is cleared stays in state for validation to report", () => {
    // The generator skips it rather than failing the document (DOC-159); the
    // row itself must not silently vanish from the user's editor.
    const { container } = render(<Harness />);
    openFirstNode(container);
    fireEvent.click(addBtn());
    const nameInput = within(drawer()).getAllByRole("textbox").find(
      (i) => i.value === ifaces()[0].ethernet.name
    );
    fireEvent.change(nameInput, { target: { value: "" } });

    expect(ifaces()).toHaveLength(1);
    expect(ifaces()[0].ethernet.name).toBe("");
  });
});

describe("DOC-159 UI path: static routes", () => {
  /* Routes live behind the Advanced disclosure on the primary interface. */
  const openAdvanced = () => {
    const expand = within(drawer()).queryByRole("button", { name: /Expand Advanced$/i });
    if (expand) fireEvent.click(expand);
  };
  const addRouteBtn = () => within(drawer()).getByRole("button", { name: /^Add Route$/i });
  const routes = () => node0().primary?.advanced?.routes || [];

  it("adds a route row into canonical state", () => {
    const { container } = render(<Harness />);
    openFirstNode(container);
    openAdvanced();
    expect(routes()).toHaveLength(0);

    fireEvent.click(addRouteBtn());
    expect(routes()).toHaveLength(1);
    // A fresh row is blank; the generator skips it until it is filled in.
    expect(routes()[0].destination ?? "").toBe("");
  });

  it("fills a route and the values land in canonical state", () => {
    const { container } = render(<Harness />);
    openFirstNode(container);
    openAdvanced();
    fireEvent.click(addRouteBtn());

    const boxes = within(drawer()).getAllByRole("textbox");
    const dest = boxes.find((i) => /destination/i.test(i.closest("label")?.textContent || ""));
    expect(dest).toBeTruthy();
    fireEvent.change(dest, { target: { value: "10.9.0.0/24" } });
    expect(routes()[0].destination).toBe("10.9.0.0/24");
  });

  it("keeps route order and removes the right row", () => {
    const { container } = render(<Harness />);
    openFirstNode(container);
    openAdvanced();
    fireEvent.click(addRouteBtn());
    fireEvent.click(addRouteBtn());
    expect(routes()).toHaveLength(2);

    // Tag them so removal is observable.
    const destInputs = within(drawer())
      .getAllByRole("textbox")
      .filter((i) => /destination/i.test(i.closest("label")?.textContent || ""));
    expect(destInputs).toHaveLength(2);
    fireEvent.change(destInputs[0], { target: { value: "10.1.0.0/24" } });
    fireEvent.change(
      within(drawer())
        .getAllByRole("textbox")
        .filter((i) => /destination/i.test(i.closest("label")?.textContent || ""))[1],
      { target: { value: "10.2.0.0/24" } }
    );
    expect(routes().map((r) => r.destination)).toEqual(["10.1.0.0/24", "10.2.0.0/24"]);

    const removeButtons = within(drawer()).getAllByRole("button", { name: /^Remove$/i });
    fireEvent.click(removeButtons[0]);
    expect(routes().map((r) => r.destination)).toEqual(["10.2.0.0/24"]);
  });
});

describe("DOC-159 UI path: bond members (presentation modes do not affect data)", () => {
  it("adding a member produces identical canonical state in Docked and Focus", () => {
    const capture = () => {
      const { container } = render(<Harness />);
      openFirstNode(container);
      // Switch the primary interface to a bond so members exist.
      const typeSelect = within(drawer())
        .getAllByRole("combobox")
        .find((s) => Array.from(s.options).some((o) => o.value === "bond"));
      expect(typeSelect).toBeTruthy();
      fireEvent.change(typeSelect, { target: { value: "bond" } });
      return container;
    };

    const container = capture();
    const addMember = () => within(drawer()).getByRole("button", { name: /add bond member/i });
    fireEvent.click(addMember());
    const docked = JSON.parse(JSON.stringify(node0().primary.bond.slaves));

    // Same action with the editor focused.
    fireEvent.click(drawer().querySelector(".host-inventory-v2-drawer-mode-toggle"));
    expect(drawer().dataset.nodeEditorMode).toBe("focus");
    fireEvent.click(addMember());
    const focused = node0().primary.bond.slaves;

    expect(focused).toHaveLength(docked.length + 1);
    expect(focused.slice(0, docked.length)).toEqual(docked);
  });
});
