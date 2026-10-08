/**
 * Tranche 7B — SR-IOV Day-1 NMState shape, and a structural guard over every
 * key the generator emits.
 *
 * THE DEFECT. `addEthernet()` assigned a top-level `entry.sriov`, so enabling
 * SR-IOV produced `interfaces[].sriov.total-vfs`. Every authority places it
 * under the interface's `ethernet` object:
 *
 *   - upstream NMState YAML API: `interfaces[].ethernet.sr-iov.total-vfs`
 *   - OCP 4.20 Agent-based Installer §1.9: `ethernet: sr-iov: total-vfs: 2`
 *   - OCP 4.21 Agent-based Installer §1.9: `ethernet: sr-iov: total-vfs: 2`
 *   - OCP 4.22 Agent-based Installer §1.9: `ethernet: sr-iov: total-vfs: 8`
 *
 * NMState's deserializer is strict, so the unknown key did not merely lose the
 * SR-IOV setting — it invalidated the entire host `networkConfig`.
 *
 * WHY IT SHIPPED. One test asserted the wrong shape, and nothing validated the
 * generated document's structure at all. The second describe block below is
 * that missing control: an allow-list over every emitted key, so an unknown
 * property fails in CI instead of at install time.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";

import { buildAgentConfig } from "../src/generate.js";
import { SUPPORTED_MINORS } from "../src/versionPolicy.js";
import { bareMetalAgent, vsphereAgent } from "./fixtures/base-states.js";

const PATCH = { "4.20": "4.20.40", "4.21": "4.21.35", "4.22": "4.22.16" };

/** Documentation-safe values only: RFC 5737 / RFC 7042 ranges, generic names. */
const NIC = { A: "ethernet0", B: "ethernet1" };
const MAC = { A: "00:00:5E:00:53:01", B: "00:00:5E:00:53:02" };

/**
 * The two scenarios that expose SR-IOV AND reach the agent NMState generator.
 * `buildAgentConfig` runs only for Agent-Based Installer on Bare Metal or
 * vSphere; no other scenario can emit SR-IOV at all.
 */
const AGENT_SCENARIOS = [
  ["bare-metal-agent", bareMetalAgent],
  ["vsphere-agent", vsphereAgent],
];

function stateWithSriov(fixture, minor, { enabled = true, totalVfs = "8", type = "ethernet" } = {}) {
  const node = (host) => ({
    hostname: host,
    role: "master",
    primary: {
      type,
      mode: "static",
      ipv4Cidr: "192.0.2.10/24",
      ipv4Gateway: "192.0.2.1",
      ethernet: { name: NIC.A, macAddress: MAC.A },
      bond: {
        name: "bond0",
        mode: "802.3ad",
        slaves: [
          { name: NIC.A, macAddress: MAC.A },
          { name: NIC.B, macAddress: MAC.B },
        ],
      },
      vlan: { id: "100", baseIface: "bond0", name: "bond0.100" },
      advanced: {
        mtu: "1500",
        sriov: { enabled, totalVfs },
        vrf: { enabled: false },
        routes: [],
      },
    },
    bmc: {},
    rootDevice: "",
    dns: { servers: "", search: "" },
  });

  return fixture({
    version: { selectedMinor: minor, selectedPatch: PATCH[minor], selectedChannel: `stable-${minor}`, locked: true },
    release: { channel: minor, patchVersion: PATCH[minor], confirmed: true },
    hostInventory: { nodes: [node("m0"), node("m1"), node("m2")], ipStackMode: "ipv4" },
  });
}

const netConfig = (state) => yaml.load(buildAgentConfig(state)).hosts[0].networkConfig;

/* ------------------------------------------------------------------ */
/* The fix, at every supported minor and every affected scenario        */
/* ------------------------------------------------------------------ */

describe("T7B — SR-IOV nests under ethernet.sr-iov at every supported minor", () => {
  for (const minor of SUPPORTED_MINORS) {
    for (const [label, fixture] of AGENT_SCENARIOS) {
      describe(`${minor} / ${label}`, () => {
        const nc = netConfig(stateWithSriov(fixture, minor));
        const eth = nc.interfaces.find((i) => i.name === NIC.A && i.type === "ethernet");

        it("emits the ethernet interface", () => {
          assert.ok(eth, `no ${NIC.A} ethernet interface generated`);
        });

        it("places total-vfs at interfaces[].ethernet.sr-iov.total-vfs", () => {
          assert.equal(eth.ethernet["sr-iov"]["total-vfs"], 8);
        });

        it("emits NO top-level `sriov` key on any interface", () => {
          const offenders = nc.interfaces.filter((i) => "sriov" in i).map((i) => i.name);
          assert.deepEqual(offenders, [], "a top-level sriov key is not valid NMState");
        });

        it("total-vfs is a number, not a string", () => {
          assert.equal(typeof eth.ethernet["sr-iov"]["total-vfs"], "number");
        });

        it("the ethernet object carries nothing but sr-iov", () => {
          // Guards against the merge accidentally picking up unrelated state.
          assert.deepEqual(Object.keys(eth.ethernet), ["sr-iov"]);
        });
      });
    }
  }

  it("the shape is identical across all three minors — no version divergence", () => {
    const shapes = SUPPORTED_MINORS.map((m) => {
      const nc = netConfig(stateWithSriov(bareMetalAgent, m));
      return JSON.stringify(nc.interfaces.find((i) => i.name === NIC.A).ethernet);
    });
    assert.equal(new Set(shapes).size, 1, `shapes diverged: ${shapes.join(" | ")}`);
  });
});

describe("T7B — SR-IOV on bond members and VLAN-on-bond", () => {
  // Every path that calls addEthernet was affected, not just a plain ethernet
  // primary: bond members are added as ethernet interfaces too.
  for (const type of ["bond", "vlan-on-bond", "vlan-on-ethernet"]) {
    it(`${type}: member/base ethernet interfaces nest SR-IOV correctly`, () => {
      const nc = netConfig(stateWithSriov(bareMetalAgent, "4.22", { type }));
      const eths = nc.interfaces.filter((i) => i.type === "ethernet");
      assert.ok(eths.length > 0, "expected at least one ethernet interface");
      for (const e of eths) {
        assert.ok(e.ethernet?.["sr-iov"], `${e.name} lost its SR-IOV block`);
        assert.equal(e.ethernet["sr-iov"]["total-vfs"], 8);
        assert.equal("sriov" in e, false, `${e.name} emitted a top-level sriov key`);
      }
    });
  }
});

describe("T7B — SR-IOV disabled or unset emits nothing", () => {
  for (const minor of SUPPORTED_MINORS) {
    it(`${minor}: disabled SR-IOV produces no ethernet.sr-iov block`, () => {
      const nc = netConfig(stateWithSriov(bareMetalAgent, minor, { enabled: false, totalVfs: "" }));
      for (const i of nc.interfaces) {
        assert.equal("sriov" in i, false);
        assert.equal(i.ethernet?.["sr-iov"], undefined, `${i.name} emitted SR-IOV while disabled`);
      }
    });
  }

  it("enabled with an empty VF count emits nothing — the existing contract", () => {
    const nc = netConfig(stateWithSriov(bareMetalAgent, "4.22", { enabled: true, totalVfs: "" }));
    for (const i of nc.interfaces) assert.equal(i.ethernet?.["sr-iov"], undefined);
  });

  it("enabled with a non-numeric VF count emits nothing", () => {
    const nc = netConfig(stateWithSriov(bareMetalAgent, "4.22", { enabled: true, totalVfs: "many" }));
    for (const i of nc.interfaces) assert.equal(i.ethernet?.["sr-iov"], undefined);
  });

  it("disabled output is byte-identical to output from a state with no sriov key at all", () => {
    const withDisabled = buildAgentConfig(stateWithSriov(bareMetalAgent, "4.22", { enabled: false, totalVfs: "" }));
    const stripped = stateWithSriov(bareMetalAgent, "4.22", { enabled: false, totalVfs: "" });
    for (const n of stripped.hostInventory.nodes) delete n.primary.advanced.sriov;
    assert.equal(withDisabled, buildAgentConfig(stripped));
  });
});

describe("T7B — a persisted/imported state regenerates the corrected shape", () => {
  it("round-tripping state through JSON still produces ethernet.sr-iov", () => {
    // A configuration saved before the fix carries `primary.advanced.sriov` in
    // state; the state shape is unchanged, so re-generating must now be correct.
    const state = JSON.parse(JSON.stringify(stateWithSriov(bareMetalAgent, "4.22")));
    const eth = netConfig(state).interfaces.find((i) => i.name === NIC.A);
    assert.equal(eth.ethernet["sr-iov"]["total-vfs"], 8);
    assert.equal("sriov" in eth, false);
  });
});

/* ------------------------------------------------------------------ */
/* The missing control: every emitted key must be in the schema          */
/* ------------------------------------------------------------------ */

describe("T7B — structural guard: every generated NMState key is schema-valid", () => {
  /**
   * Allow-list derived from the NMState YAML API and Red Hat's Day-1 Agent
   * examples. The point is not to enumerate all of NMState — it is that a key
   * OAA emits which is NOT on this list must be a deliberate, reviewed
   * addition, caught here rather than by a failed install.
   */
  const TOP_LEVEL = new Set(["interfaces", "routes", "dns-resolver", "route-rules"]);
  const IFACE = new Set([
    "name", "type", "state", "mtu", "mac-address", "description", "identifier",
    "ipv4", "ipv6", "ethernet", "link-aggregation", "vlan", "vrf", "bridge", "infiniband",
  ]);
  const IP = new Set(["enabled", "dhcp", "autoconf", "address", "auto-dns", "auto-gateway", "auto-routes"]);
  const ADDRESS = new Set(["ip", "prefix-length"]);
  const ETHERNET = new Set(["sr-iov", "speed", "duplex", "auto-negotiation"]);
  const SRIOV = new Set(["total-vfs", "vfs"]);
  const BOND = new Set(["mode", "port", "options"]);
  const VLAN = new Set(["base-iface", "id", "protocol"]);
  const VRF = new Set(["port", "route-table-id"]);
  const ROUTE = new Set(["destination", "next-hop-address", "next-hop-interface", "table-id", "metric", "state"]);

  /** A state exercising every family the generator can currently produce. */
  const everythingState = () => {
    const node = (h) => ({
      hostname: h,
      role: "master",
      dnsServers: "192.0.2.53,192.0.2.54",
      dnsSearch: "example.com",
      primary: {
        type: "vlan-on-bond",
        mode: "static",
        ipv4Cidr: "192.0.2.10/24",
        ipv4Gateway: "192.0.2.1",
        ipv6Cidr: "2001:db8:1::10/64",
        ipv6Gateway: "2001:db8:1::1",
        ethernet: { name: NIC.A, macAddress: MAC.A },
        bond: { name: "bond0", mode: "802.3ad", slaves: [{ name: NIC.A, macAddress: MAC.A }, { name: NIC.B, macAddress: MAC.B }] },
        vlan: { id: "100", baseIface: "bond0", name: "bond0.100" },
        advanced: {
          mtu: "9000",
          sriov: { enabled: true, totalVfs: "8" },
          vrf: { enabled: true, name: "vrf-red", tableId: "100", ports: "bond0.100" },
          routes: [{ destination: "198.51.100.0/24", nextHopAddress: "192.0.2.254", nextHopInterface: "bond0.100" }],
        },
      },
      bmc: {},
      rootDevice: "",
      dns: { servers: "", search: "" },
    });
    return bareMetalAgent({
      version: { selectedMinor: "4.22", selectedPatch: "4.22.16", selectedChannel: "stable-4.22", locked: true },
      release: { channel: "4.22", patchVersion: "4.22.16", confirmed: true },
      hostInventory: { nodes: [node("m0"), node("m1"), node("m2")], ipStackMode: "dual-stack" },
    });
  };

  const nc = netConfig(everythingState());
  const check = (obj, allowed, where) => {
    for (const k of Object.keys(obj ?? {})) {
      assert.ok(allowed.has(k), `unknown NMState key "${k}" at ${where} — not in the schema allow-list`);
    }
  };

  it("exercises every family the generator can emit", () => {
    const types = new Set(nc.interfaces.map((i) => i.type));
    for (const t of ["ethernet", "bond", "vlan", "vrf"]) assert.ok(types.has(t), `fixture did not produce a ${t}`);
    assert.ok(nc.routes.config.length >= 2, "expected a default route plus an extra route");
    assert.ok(nc["dns-resolver"].config.server.length > 0);
  });

  it("top-level document keys are valid", () => check(nc, TOP_LEVEL, "document root"));

  it("every interface key is valid", () => {
    for (const i of nc.interfaces) check(i, IFACE, `interfaces[${i.name}]`);
  });

  it("ipv4 / ipv6 keys are valid", () => {
    for (const i of nc.interfaces) {
      check(i.ipv4, IP, `${i.name}.ipv4`);
      check(i.ipv6, IP, `${i.name}.ipv6`);
      for (const a of i.ipv4?.address ?? []) check(a, ADDRESS, `${i.name}.ipv4.address[]`);
      for (const a of i.ipv6?.address ?? []) check(a, ADDRESS, `${i.name}.ipv6.address[]`);
    }
  });

  it("ethernet / sr-iov keys are valid", () => {
    for (const i of nc.interfaces) {
      check(i.ethernet, ETHERNET, `${i.name}.ethernet`);
      check(i.ethernet?.["sr-iov"], SRIOV, `${i.name}.ethernet.sr-iov`);
    }
  });

  it("bond, vlan and vrf keys are valid", () => {
    for (const i of nc.interfaces) {
      check(i["link-aggregation"], BOND, `${i.name}.link-aggregation`);
      check(i.vlan, VLAN, `${i.name}.vlan`);
      check(i.vrf, VRF, `${i.name}.vrf`);
    }
  });

  it("route keys are valid", () => {
    for (const r of nc.routes.config) check(r, ROUTE, "routes.config[]");
  });

  it("dns-resolver keys are valid", () => {
    check(nc["dns-resolver"], new Set(["config", "running"]), "dns-resolver");
    check(nc["dns-resolver"].config, new Set(["server", "search"]), "dns-resolver.config");
  });

  it("the guard is not vacuous — it rejects an injected unknown key", () => {
    const tampered = { ...nc.interfaces[0], bogusProperty: true };
    assert.throws(
      () => check(tampered, IFACE, "tampered"),
      /unknown NMState key "bogusProperty"/
    );
  });
});
