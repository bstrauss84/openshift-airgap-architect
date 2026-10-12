/**
 * Helper/tooltip coverage for the host-networking surface.
 *
 * WHY THIS EXISTS. The existing helper automation (tests/hint-syntax.test.js)
 * checks hint SYNTAX in one step file; nothing checked whether a control had a
 * helper at all, and nothing reached fields that only appear after a type is
 * chosen, a mode is switched, a checkbox is ticked or a panel is expanded. The
 * Additional Interfaces surface — almost entirely conditional — therefore had
 * essentially no helper text and no test noticed.
 *
 * WHAT THIS DOES. It renders the node editor in a MAXIMAL-REVEAL state: every
 * primary interface type's controls, static addressing in dual-stack, the
 * primary Advanced panel with a route, and four additional interfaces (one per
 * type) each with SR-IOV on, VRF on and a route. Then it walks every editable
 * control actually in the DOM and requires an info icon on each one that
 * belongs to host networking.
 *
 * Controls outside this tranche's scope (host identity, root device hints, BMC)
 * are listed explicitly rather than pattern-matched, so a new networking field
 * cannot slip through by accident — it will simply be unknown, and fail.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { AppContext } from "../src/store.jsx";
import HostInventoryV2Step from "../src/steps/HostInventoryV2Step.jsx";

const MINOR = "4.22";

/** Out of scope for this tranche: host identity, root device hints, BMC. */
const NON_NETWORKING_LABELS = new Set([
  "Role",
  "Hostname",
  "Use FQDN (shortname.baseDomain)",
  "Root device — deviceName (optional)",
  "Root device — hctl (optional)",
  "Root device — model (optional)",
  "Root device — vendor (optional)",
  "Root device — serial number (optional)",
  "Root device — wwn (optional)",
  "Root device — min size GB (optional)",
  "Root device — rotational (optional)",
  "BMC address",
  "BMC username",
  "BMC password",
  "Disable BMC certificate verification (e.g. self-signed)",
  "Boot MAC"
]);

const advanced = (overrides = {}) => ({
  mtu: "1500",
  sriov: { enabled: true, totalVfs: "8" },
  vrf: { enabled: true, name: "vrf0", tableId: "100", ports: "" },
  routes: [{ destination: "203.0.113.0/24", nextHopAddress: "192.0.2.254", nextHopInterface: "" }],
  ...overrides
});

const bond = (name) => ({
  name,
  mode: "active-backup",
  slaves: [
    { name: "eno1", macAddress: "00:00:5E:00:53:01" },
    { name: "eno2", macAddress: "00:00:5E:00:53:02" }
  ]
});

const iface = (type, i) => ({
  type,
  mode: "static",
  ipv4Cidr: "198.51.100.2{i}0/24".replace("{i}", String(i)),
  ipv6Cidr: "2001:db8:10::20/64",
  ethernet: { name: `eno${10 + i}`, macAddress: "00:00:5E:00:53:0A" },
  bond: bond(`bond${i + 1}`),
  vlan: { id: `${100 + i}`, baseIface: "", name: "" },
  advanced: advanced()
});

/**
 * Every conditional networking field this editor can show.
 *
 * Two primary types are needed to reach them all: `vlan-on-bond` reveals the
 * bond and VLAN controls, `vlan-on-ethernet` reveals the primary ethernet
 * name/MAC pair that a bond row hides. Both are audited.
 */
const maximalNode = (primaryType = "vlan-on-bond") => ({
  role: "master",
  hostname: "master-0",
  rootDevice: "",
  dnsServers: "192.0.2.53",
  dnsSearch: "example.com",
  bmc: { address: "", username: "", password: "", bootMACAddress: "" },
  primary: {
    type: primaryType,
    mode: "static",
    ipv4Cidr: "192.0.2.10/24",
    ipv4Gateway: "192.0.2.1",
    ipv6Cidr: "2001:db8::10/64",
    ipv6Gateway: "2001:db8::1",
    ethernet: { name: "eno5", macAddress: "00:00:5E:00:53:05" },
    bond: bond("bond0"),
    vlan: { id: "100", baseIface: "", name: "" },
    advanced: advanced()
  },
  additionalInterfaces: [
    iface("ethernet", 0),
    iface("bond", 1),
    iface("vlan-on-ethernet", 2),
    iface("vlan-on-bond", 3)
  ]
});

const stateWith = (node) => ({
  version: { selectedMinor: MINOR, selectedPatch: "4.22.16", selectedChannel: `stable-${MINOR}`, locked: true },
  release: { channel: MINOR, patchVersion: "4.22.16", confirmed: true },
  blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "ocp1" },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: { nodes: [node], ipStackMode: "dual-stack" },
  globalStrategy: { networking: { machineNetworkV4: "192.0.2.0/24" } },
  ui: { compareMode: false, scenarioAwareLayout: false }
});

function Harness({ initialState }) {
  const [state, setState] = React.useState(initialState);
  const value = {
    state,
    updateState: (patch) => setState((prev) => ({ ...prev, ...patch })),
    loading: false,
    startOver: vi.fn()
  };
  return (
    <AppContext.Provider value={value}>
      <HostInventoryV2Step />
    </AppContext.Provider>
  );
}

/** Accessible label of a control, however it is associated. */
function labelOf(el) {
  if (el.id) {
    const labels = Array.from(document.querySelectorAll(`label[for="${el.id}"]`));
    if (labels.length) return labels.map((l) => l.textContent).join(" ").replace(/\s+/g, " ").trim();
  }
  const wrapping = el.closest("label");
  if (wrapping) {
    const clone = wrapping.cloneNode(true);
    clone.querySelectorAll("input, select, textarea, button").forEach((n) => n.remove());
    return clone.textContent.replace(/\s+/g, " ").trim();
  }
  return "";
}

const hasInfoIcon = (el) => {
  const row = el.closest(".field-with-info-row");
  return Boolean(row && row.querySelector(".field-info-icon"));
};

function renderMaximal(primaryType = "vlan-on-bond") {
  render(<Harness initialState={stateWith(maximalNode(primaryType))} />);
  fireEvent.click(screen.getByText(/master-0/i));
  // Both Advanced surfaces open themselves for a node that already has routes;
  // click anything still collapsed so nothing conditional is missed.
  document.querySelectorAll(".host-inventory-v2-drawer .card-header-collapse-btn").forEach((btn) => {
    if (btn.getAttribute("aria-expanded") !== "true") fireEvent.click(btn);
  });
}

/**
 * Audits the NODE EDITOR drawer only. Step-level agent options that live
 * outside the drawer (for example "Boot artifacts base URL") are a different
 * surface and are not part of this tranche.
 *
 * @returns {{networking: string[], covered: string[], missing: string[], unknown: string[]}}
 */
function auditCoverage() {
  const drawer = document.querySelector(".host-inventory-v2-drawer");
  if (!drawer) throw new Error("node editor drawer did not render");
  const controls = Array.from(drawer.querySelectorAll("input, select, textarea"));
  const networking = [];
  const covered = [];
  const missing = [];
  const unknown = [];
  for (const el of controls) {
    const label = labelOf(el);
    if (!label) {
      unknown.push(`<${el.tagName.toLowerCase()}> with no label at all`);
      continue;
    }
    if (NON_NETWORKING_LABELS.has(label)) continue;
    networking.push(label);
    (hasInfoIcon(el) ? covered : missing).push(label);
  }
  return {
    networking: [...new Set(networking)].sort(),
    covered: [...new Set(covered)].sort(),
    missing: [...new Set(missing)].sort(),
    unknown
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("helper coverage: every revealed host-networking control has an info icon", () => {
  it("reveals a large conditional surface, not just the static top-level controls", () => {
    renderMaximal();
    const { networking } = auditCoverage();
    /* Guards the audit itself: if a future change stops revealing the
       conditional fields, the coverage assertion below would pass vacuously. */
    expect(networking.length).toBeGreaterThanOrEqual(25);
    for (const conditional of [
      "VLAN Interface Name (auto)",   // only for VLAN rows
      "SR-IOV Total VFs",             // only when SR-IOV is ticked
      "VRF Table ID",                 // only when VRF is ticked
      "Bond Member MAC",              // only for bond rows
      "IPv6 Address/CIDR",            // only in static mode, IPv6-capable cluster
      "Next Hop Interface (optional)" // only inside an expanded Advanced panel
    ]) {
      expect(networking).toContain(conditional);
    }
  });

  it("no revealed networking control is missing its helper", () => {
    renderMaximal();
    const { missing } = auditCoverage();
    expect(missing).toEqual([]);
  });

  it("every control in the editor has an accessible label", () => {
    renderMaximal();
    const { unknown } = auditCoverage();
    expect(unknown).toEqual([]);
  });

  it("coverage is 100% of the networking surface", () => {
    renderMaximal();
    const { networking, covered } = auditCoverage();
    expect(covered.length).toBe(networking.length);
  });

  it("the primary ethernet controls, which a bond row hides, are covered too", () => {
    renderMaximal("vlan-on-ethernet");
    const { networking, missing } = auditCoverage();
    expect(networking).toContain("Ethernet interface");
    expect(networking).toContain("Ethernet MAC");
    expect(missing).toEqual([]);
  });
});

describe("helper quality: networking hints follow the established gold standard", () => {
  const source = readFileSync(join(__dirname, "../src/components/NodeDrawerAgentContent.jsx"), "utf8");

  /** label="X" ... hint={`...`} pairs, in source order. */
  function hintsByLabel(text) {
    const out = new Map();
    const re = /label="([^"]+)"\s*\n\s*hint=\{`([\s\S]*?)`\}\s*\n/g;
    let m;
    while ((m = re.exec(text)) !== null) out.set(m[1], m[2]);
    return out;
  }

  const hints = hintsByLabel(source);

  /* The fields this tranche authored or rewrote. The gold standard is the
     4.21 AWS platform field pattern: WHAT / WHEN IT APPLIES / FORMAT or
     OPTIONS / VALID VALUES / HOW USED / IMPORTANT / EXAMPLE. */
  const GOLD_STANDARD_FIELDS = [
    "VLAN ID",
    "VLAN name",
    "IPv4 CIDR",
    "IPv4 gateway",
    "IPv6 CIDR",
    "IPv6 gateway",
    "Interface",
    "MAC address",
    "DNS servers",
    "DNS search",
    "MTU",
    "Destination",
    "Next Hop Address",
    "Next Hop Interface (optional)",
    "Type",
    "IP Assignment",
    "Ethernet Interface Name",
    "Ethernet MAC Address",
    "Bond Name",
    "Bond Mode",
    "Bond Member Interface",
    "Bond Member MAC",
    "VLAN Interface Name (auto)",
    "IPv4 Address/CIDR",
    "IPv6 Address/CIDR",
    "MTU (optional)",
    "SR-IOV",
    "SR-IOV Total VFs",
    "VRF",
    "VRF Name",
    "VRF Table ID",
    "VRF Ports (comma-separated)"
  ];

  for (const label of GOLD_STANDARD_FIELDS) {
    it(`"${label}" has a hint`, () => {
      expect(hints.has(label)).toBe(true);
    });

    it(`"${label}" states what it is, when it applies, its shape, and an example`, () => {
      const hint = hints.get(label) || "";
      expect(hint).toMatch(/\*\*What is this:\*\*/);
      expect(hint).toMatch(/\*\*When it applies:\*\*/);
      expect(hint).toMatch(/\*\*(Format|Options):\*\*/);
      expect(hint).toMatch(/\*\*(Valid values|Options):\*\*/);
      expect(hint).toMatch(/\*\*How it's used:\*\*/);
      expect(hint).toMatch(/\*\*Important:\*\*/);
      expect(hint).toMatch(/\*\*Example:\*\*/);
    });
  }

  it("no unsupported future field was documented into existence", () => {
    /* A hint must describe a control that actually renders. Every gold-standard
       label above is asserted present in the DOM by the coverage audit, so the
       two lists are cross-checked against each other. */
    renderMaximal();
    const { networking } = auditCoverage();
    const documentedButAbsent = GOLD_STANDARD_FIELDS.filter((l) => !networking.includes(l));
    expect(documentedButAbsent).toEqual([]);
  });
});
