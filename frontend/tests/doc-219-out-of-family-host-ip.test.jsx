/**
 * DOC-219 — an imported out-of-family primary address must not vanish silently.
 *
 * The primary interface's address fields are cluster-stack-coupled: the drawer
 * hides a family the cluster does not enable, and buildNmState writes that
 * family as disabled. An address in that family can still arrive in IMPORTED
 * state, and it used to disappear from the generated configuration with no
 * message anywhere. Now:
 *   - validateNode reports it as a non-blocking WARNING (it reaches the Host
 *     Inventory panel and the Review "draft" banner through the existing
 *     warnings channel), never as an error;
 *   - the drawer shows the hidden value and offers an explicit removal;
 *   - nothing is removed unless the user asks.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AppContext } from "../src/store.jsx";
import HostInventoryV2Step from "../src/steps/HostInventoryV2Step.jsx";
import { validateNode, validateStep } from "../src/validation.js";

const MINOR = "4.22";
const V4 = { ipv4Cidr: "192.0.2.10/24", ipv4Gateway: "192.0.2.1" };
const V6 = { ipv6Cidr: "2001:db8::10/64", ipv6Gateway: "2001:db8::1" };
const NO_V4 = { ipv4Cidr: "", ipv4Gateway: "" };
const NO_V6 = { ipv6Cidr: "", ipv6Gateway: "" };

const node = (addresses) => ({
  role: "master",
  hostname: "master-0",
  rootDevice: "/dev/sda",
  dnsServers: "",
  dnsSearch: "",
  bmc: { address: "", username: "", password: "", bootMACAddress: "" },
  primary: {
    type: "ethernet",
    mode: "static",
    ethernet: { name: "eno5", macAddress: "00:00:5E:00:53:05" },
    vlan: { id: "", baseIface: "", name: "" },
    advanced: { mtu: "1500", sriov: { enabled: false, totalVfs: "" }, vrf: { enabled: false }, routes: [] },
    ...addresses
  },
  additionalInterfaces: []
});

const FAMILIES = {
  ipv4: { enableIpv4: true, enableIpv6: false },
  ipv6: { enableIpv4: false, enableIpv6: true },
  "dual-stack": { enableIpv4: true, enableIpv6: true }
};
const run = (n, mode) => validateNode({ node: n, ...FAMILIES[mode], platform: "Bare Metal", method: "Agent-Based Installer" });
const unusedWarnings = (r) => r.warnings.filter((w) => /is not written to the generated host network configuration/.test(w));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("DOC-219 validateNode reports unused out-of-family primary values", () => {
  it("IPv6-only + leftover IPv4: a warning naming the values, and no new error", () => {
    const r = run(node({ ...V4, ...V6 }), "ipv6");
    expect(r.errors).toEqual([]);
    const w = unusedWarnings(r);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/IPv4 value 192\.0\.2\.10\/24 \/ 192\.0\.2\.1 is set but the cluster is IPv6-only/);
    expect(w[0]).toMatch(/Remove it .* or set the cluster IP stack to dual-stack/);
  });

  it("IPv4-only + leftover IPv6: the mirror-image warning", () => {
    const r = run(node({ ...V4, ...V6 }), "ipv4");
    expect(r.errors).toEqual([]);
    const w = unusedWarnings(r);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/IPv6 value 2001:db8::10\/64 \/ 2001:db8::1 is set but the cluster is IPv4-only/);
  });

  it("a leftover gateway alone is reported too", () => {
    const w = unusedWarnings(run(node({ ...NO_V4, ipv4Gateway: "192.0.2.1", ...V6 }), "ipv6"));
    expect(w[0]).toMatch(/IPv4 value 192\.0\.2\.1 is set/);
  });

  it("dual-stack uses both families: nothing to report", () => {
    expect(unusedWarnings(run(node({ ...V4, ...V6 }), "dual-stack"))).toEqual([]);
  });

  it("clean single-family nodes: nothing to report", () => {
    expect(unusedWarnings(run(node({ ...V4, ...NO_V6 }), "ipv4"))).toEqual([]);
    expect(unusedWarnings(run(node({ ...NO_V4, ...V6 }), "ipv6"))).toEqual([]);
  });

  it("validation never mutates the node (the imported data is preserved)", () => {
    const n = node({ ...V4, ...V6 });
    const before = JSON.stringify(n);
    run(n, "ipv6");
    expect(JSON.stringify(n)).toBe(before);
  });
});

describe("DOC-219 the warning reaches the Review step's draft channel", () => {
  it("validateStep(review) carries it as a warning, and adds no error", () => {
    const state = {
      version: { selectedMinor: MINOR, selectedPatch: "4.22.16", selectedChannel: `stable-${MINOR}`, locked: true },
      release: { channel: MINOR, patchVersion: "4.22.16", confirmed: true },
      blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "ocp1" },
      methodology: { method: "Agent-Based Installer" },
      hostInventory: { nodes: [node({ ...V4, ...V6 })], ipStackMode: "ipv6" },
      globalStrategy: { networking: {} }
    };
    const withLeftover = validateStep(state, "review");
    const clean = validateStep({ ...state, hostInventory: { ...state.hostInventory, nodes: [node({ ...NO_V4, ...V6 })] } }, "review");
    expect(withLeftover.warnings.some((w) => /IPv4 value 192\.0\.2\.10\/24/.test(w))).toBe(true);
    expect(clean.warnings.some((w) => /is not written to the generated host network configuration/.test(w))).toBe(false);
    expect(withLeftover.errors).toEqual(clean.errors);
  });
});

function Harness({ initialState, onState }) {
  const [state, setState] = React.useState(initialState);
  React.useEffect(() => { onState(state); }, [state, onState]);
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

function openEditor(addresses, ipStackMode) {
  const seen = { state: null };
  const initialState = {
    version: { selectedMinor: MINOR, selectedPatch: "4.22.16", selectedChannel: `stable-${MINOR}`, locked: true },
    release: { channel: MINOR, patchVersion: "4.22.16", confirmed: true },
    blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "ocp1" },
    methodology: { method: "Agent-Based Installer" },
    hostInventory: { nodes: [node(addresses)], ipStackMode },
    globalStrategy: { networking: { machineNetworkV4: "192.0.2.0/24" } },
    ui: { compareMode: false, scenarioAwareLayout: false }
  };
  render(<Harness initialState={initialState} onState={(s) => { seen.state = s; }} />);
  fireEvent.click(screen.getByText(/master-0/i));
  return seen;
}

describe("DOC-219 the drawer surfaces the hidden value and removes it only on request", () => {
  it("IPv6-only: shows the hidden IPv4 values; removal is explicit and leaves IPv6 intact", () => {
    const seen = openEditor({ ...V4, ...V6 }, "ipv6");
    const note = document.querySelector('[data-unused-family="ipv4"]');
    expect(note).not.toBeNull();
    expect(note.textContent).toMatch(/192\.0\.2\.10\/24 \/ 192\.0\.2\.1/);
    // Nothing was removed by merely rendering.
    expect(seen.state.hostInventory.nodes[0].primary.ipv4Cidr).toBe(V4.ipv4Cidr);

    fireEvent.click(screen.getByRole("button", { name: "Remove unused IPv4 values" }));
    const primary = seen.state.hostInventory.nodes[0].primary;
    expect(primary.ipv4Cidr).toBe("");
    expect(primary.ipv4Gateway).toBe("");
    expect(primary.ipv6Cidr).toBe(V6.ipv6Cidr);
    expect(primary.ipv6Gateway).toBe(V6.ipv6Gateway);
    expect(document.querySelector('[data-unused-family="ipv4"]')).toBeNull();
  });

  it("IPv4-only: offers removal of hidden IPv6 values", () => {
    openEditor({ ...V4, ...V6 }, "ipv4");
    expect(document.querySelector('[data-unused-family="ipv6"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Remove unused IPv6 values" })).toBeTruthy();
  });

  it("dual-stack and clean nodes show no notice", () => {
    openEditor({ ...V4, ...V6 }, "dual-stack");
    expect(document.querySelector("[data-unused-family]")).toBeNull();
    cleanup();
    openEditor({ ...NO_V4, ...V6 }, "ipv6");
    expect(document.querySelector("[data-unused-family]")).toBeNull();
  });
});
