/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Repeatable user-editable collections must propagate add / edit / remove all
 * the way into the generated artifacts.
 *
 * Regression origin (human QA, 2026-10-05): a bond member added in the node
 * editor appeared in the UI but never showed up in the agent-config.yaml YAML
 * Preview; only the original members did. The generator was NOT
 * cardinality-limited — three fully populated members always generated
 * correctly. The real cause was that a just-added member is
 * `{ name: "", macAddress: "" }`, whose empty name reached the NMState
 * interface-name invariant at the end of buildNmState and threw. That failed
 * the whole /api/generate request, so the UI kept rendering the last
 * successful preview: a stale two-member document.
 *
 * Incomplete repeatable rows are now skipped during generation — the same rule
 * the route collection already used — so the document keeps generating and the
 * member appears as soon as it is named. Validation still reports the
 * incomplete row to the user.
 */
import { test } from "node:test";
import assert from "node:assert";
import { buildAgentConfig, buildInstallConfig } from "../src/generate.js";

const MAC = (n) => `52:54:00:aa:11:0${n}`;

const member = (n) => ({ name: `eth${n}`, macAddress: MAC(n) });
const blankMember = () => ({ name: "", macAddress: "" });

const nodeWithSlaves = (slaves, over = {}) => ({
  role: "master",
  hostname: "master-0",
  rootDevice: "/dev/sda",
  primary: {
    type: "bond",
    mode: "static",
    ipv4Cidr: "10.0.0.10/24",
    ipv4Gateway: "10.0.0.1",
    bond: { name: "bond0", mode: "active-backup", slaves }
  },
  additionalInterfaces: [],
  ...over
});

const agentState = (node) => ({
  blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "c" },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: { nodes: [node], ipStackMode: "ipv4" },
  globalStrategy: { networking: { machineNetworkV4: "10.0.0.0/24" } }
});

/** Ordered bond member names from the nmstate link-aggregation port list. */
const bondPorts = (yaml) => {
  const start = yaml.indexOf("port:");
  assert.ok(start > -1, "expected a link-aggregation port list");
  const lines = yaml.slice(start).split("\n").slice(1);
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s+- (\S+)\s*$/);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
};

/** Ordered MAC-identified interfaces from the agent-config hosts entry. */
const hostInterfaces = (yaml) => {
  const out = [];
  const re = /- name: (\S+)\n\s+macAddress: (\S+)/g;
  let m;
  while ((m = re.exec(yaml))) out.push(`${m[1]}=${m[2]}`);
  return out;
};

test("two bond members generate two members", () => {
  const yaml = buildAgentConfig(agentState(nodeWithSlaves([member(0), member(1)])));
  assert.deepStrictEqual(bondPorts(yaml), ["eth0", "eth1"]);
  assert.deepStrictEqual(hostInterfaces(yaml), [`eth0=${MAC(0)}`, `eth1=${MAC(1)}`]);
});

test("adding a third member propagates into the generated agent-config", () => {
  const yaml = buildAgentConfig(agentState(nodeWithSlaves([member(0), member(1), member(2)])));
  assert.deepStrictEqual(bondPorts(yaml), ["eth0", "eth1", "eth2"]);
  assert.deepStrictEqual(hostInterfaces(yaml), [
    `eth0=${MAC(0)}`,
    `eth1=${MAC(1)}`,
    `eth2=${MAC(2)}`
  ]);
});

test("a just-added blank member does not fail generation (the reported defect)", () => {
  const state = agentState(nodeWithSlaves([member(0), member(1), blankMember()]));
  let yaml;
  assert.doesNotThrow(() => {
    yaml = buildAgentConfig(state);
  }, "a blank member must not throw and freeze the preview on a stale document");
  // The incomplete row is simply not emitted yet.
  assert.deepStrictEqual(bondPorts(yaml), ["eth0", "eth1"]);
});

test("the blank member appears as soon as it is named, with no reload", () => {
  // Same state object lineage the UI produces as the user types.
  const named = buildAgentConfig(
    agentState(nodeWithSlaves([member(0), member(1), { name: "eth2", macAddress: "" }]))
  );
  assert.deepStrictEqual(bondPorts(named), ["eth0", "eth1", "eth2"]);

  const withMac = buildAgentConfig(agentState(nodeWithSlaves([member(0), member(1), member(2)])));
  assert.ok(hostInterfaces(withMac).includes(`eth2=${MAC(2)}`));
});

test("removing a member removes it everywhere and keeps the rest ordered", () => {
  // Start 0,1,2 then remove the middle one.
  const yaml = buildAgentConfig(agentState(nodeWithSlaves([member(0), member(2)])));
  assert.deepStrictEqual(bondPorts(yaml), ["eth0", "eth2"]);
  const ifaces = hostInterfaces(yaml);
  assert.deepStrictEqual(ifaces, [`eth0=${MAC(0)}`, `eth2=${MAC(2)}`]);
  assert.ok(!ifaces.some((i) => i.startsWith("eth1=")), "removed member must not linger");
  assert.strictEqual(new Set(ifaces).size, ifaces.length, "no duplicate members");
});

test("add / remove / add again stays deterministic and ordered", () => {
  const seq = [
    [[member(0), member(1)], ["eth0", "eth1"]],
    [[member(0), member(1), member(2)], ["eth0", "eth1", "eth2"]],
    [[member(0), member(2)], ["eth0", "eth2"]],
    [[member(0), member(2), member(3)], ["eth0", "eth2", "eth3"]]
  ];
  for (const [slaves, expected] of seq) {
    assert.deepStrictEqual(bondPorts(buildAgentConfig(agentState(nodeWithSlaves(slaves)))), expected);
  }
});

test("editing a member's interface and MAC updates the generated output", () => {
  const yaml = buildAgentConfig(
    agentState(nodeWithSlaves([member(0), { name: "enp5s0", macAddress: "aa:bb:cc:dd:ee:ff" }]))
  );
  assert.deepStrictEqual(bondPorts(yaml), ["eth0", "enp5s0"]);
  assert.ok(hostInterfaces(yaml).includes("enp5s0=aa:bb:cc:dd:ee:ff"));
});

test("generation is pure: repeated calls on the same state give identical output", () => {
  // Guards against a cached/stale snapshot being reused across renders.
  const state = agentState(nodeWithSlaves([member(0), member(1), member(2)]));
  assert.strictEqual(buildAgentConfig(state), buildAgentConfig(state));
});

test("preview and bundle download read the same generator, so they cannot diverge", async () => {
  // Structural: /api/generate (preview + Assets) and /api/bundle.zip both call
  // buildAgentConfig(state). Proven by source rather than by booting a server.
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const calls = src.match(/buildAgentConfig\(/g) || [];
  assert.ok(calls.length >= 2, "expected preview and bundle paths to share the generator");
  assert.ok(!/buildAgentConfig\(\s*\{/.test(src), "generator must be fed whole state, not a rebuilt literal");
});

test("vlan-on-bond behaves the same for a just-added blank member", () => {
  const node = nodeWithSlaves([member(0), member(1), blankMember()]);
  node.primary.type = "vlan-on-bond";
  node.primary.vlan = { id: "100", name: "bond0.100" };
  let yaml;
  assert.doesNotThrow(() => {
    yaml = buildAgentConfig(agentState(node));
  });
  assert.deepStrictEqual(bondPorts(yaml), ["eth0", "eth1"]);
});

test("additional-interface bond members follow the same rule", () => {
  const node = nodeWithSlaves([member(0), member(1)], {
    additionalInterfaces: [
      {
        type: "bond",
        mode: "dhcp",
        bond: {
          name: "bond1",
          mode: "active-backup",
          slaves: [{ name: "eth8", macAddress: MAC(8) }, blankMember()]
        }
      }
    ]
  });
  let yaml;
  assert.doesNotThrow(() => {
    yaml = buildAgentConfig(agentState(node));
  });
  assert.ok(yaml.includes("eth8"), "named additional bond member is emitted");
});

test("an additional interface whose name is cleared does not fail the document", () => {
  // Same defect class found by the audit: a blank identity reached the NMState
  // invariant. A freshly added additional interface is auto-named, so this is
  // reached by clearing the field rather than by adding.
  const cleared = nodeWithSlaves([member(0), member(1)], {
    additionalInterfaces: [{ type: "ethernet", mode: "dhcp", ethernet: { name: "", macAddress: "" } }]
  });
  assert.doesNotThrow(() => buildAgentConfig(agentState(cleared)));

  const blankBond = nodeWithSlaves([member(0), member(1)], {
    additionalInterfaces: [
      {
        type: "bond",
        mode: "dhcp",
        bond: { name: "", mode: "active-backup", slaves: [member(8), member(9)] }
      }
    ]
  });
  // Previously this defaulted to "bond0" and collided with the primary bond.
  assert.doesNotThrow(() => buildAgentConfig(agentState(blankBond)));
});

test("a genuine duplicate interface name is still rejected", () => {
  // Skipping incomplete rows must not become "silently tolerate conflicts".
  const dupe = nodeWithSlaves([
    { name: "eth0", macAddress: MAC(0) },
    { name: "eth0", macAddress: MAC(1) }
  ]);
  assert.throws(() => buildAgentConfig(agentState(dupe)), /Duplicate NMState interface name/);
});

test("static routes add / edit / remove propagate", () => {
  const withRoutes = (routes) => {
    const node = nodeWithSlaves([member(0), member(1)]);
    node.primary.advanced = { routes };
    return buildAgentConfig(agentState(node));
  };
  const destinations = (yaml) => (yaml.match(/destination: (\S+)/g) || []).map((s) => s.split(" ")[1]);

  const one = withRoutes([{ destination: "10.9.0.0/24", nextHopAddress: "10.0.0.254" }]);
  assert.ok(destinations(one).includes("10.9.0.0/24"));

  const two = withRoutes([
    { destination: "10.9.0.0/24", nextHopAddress: "10.0.0.254" },
    { destination: "10.8.0.0/24", nextHopAddress: "10.0.0.253" }
  ]);
  assert.ok(destinations(two).includes("10.8.0.0/24"));

  // A just-added blank route is skipped, not fatal.
  let withBlank;
  assert.doesNotThrow(() => {
    withBlank = withRoutes([
      { destination: "10.9.0.0/24", nextHopAddress: "10.0.0.254" },
      { destination: "", nextHopAddress: "" }
    ]);
  });
  assert.ok(!destinations(withBlank).includes(""));

  const removed = withRoutes([{ destination: "10.8.0.0/24", nextHopAddress: "10.0.0.253" }]);
  assert.ok(!destinations(removed).includes("10.9.0.0/24"), "removed route must disappear");
});

/* ---------------------------------------------------------------------- */

const vsphereState = (failureDomains) => ({
  blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "c" },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: { nodes: [], ipStackMode: "ipv4" },
  globalStrategy: { networking: { machineNetworkV4: "10.0.0.0/24" } },
  platformConfig: {
    vsphere: { placementMode: "failureDomains", vcenter: "vc.example.com", failureDomains }
  },
  release: { patchVersion: "4.21.20" },
  version: { selectedPatch: "4.21.20" }
});

const fd = (n, over = {}) => ({
  name: `fd-${n}`,
  region: `r${n}`,
  zone: `z${n}`,
  server: "vc.example.com",
  topology: {
    datacenter: "dc1",
    computeCluster: "/dc1/host/cl1",
    datastore: "/dc1/datastore/ds1",
    networks: ["vm-net"]
  },
  ...over
});

const fdNames = (yaml) => (yaml.match(/^\s+- name: (fd-\S+)/gm) || []).map((s) => s.trim().slice(8));

test("vSphere failure domains add / edit / remove propagate to install-config", () => {
  const one = buildInstallConfig(vsphereState([fd(0)]));
  assert.deepStrictEqual(fdNames(one), ["fd-0"]);

  const two = buildInstallConfig(vsphereState([fd(0), fd(1)]));
  assert.deepStrictEqual(fdNames(two), ["fd-0", "fd-1"]);

  const edited = buildInstallConfig(vsphereState([fd(0), fd(1, { zone: "zone-edited" })]));
  assert.ok(edited.includes("zone-edited"), "edited failure domain value must appear");

  const removed = buildInstallConfig(vsphereState([fd(0)]));
  assert.deepStrictEqual(fdNames(removed), ["fd-0"]);
  assert.ok(!removed.includes("fd-1"), "removed failure domain must disappear");
});

test("a just-added blank vSphere failure domain is skipped, not emitted malformed", () => {
  const blank = {
    name: "",
    region: "",
    zone: "",
    server: "",
    topology: { datacenter: "", computeCluster: "", datastore: "", networks: [] }
  };
  let yaml;
  assert.doesNotThrow(() => {
    yaml = buildInstallConfig(vsphereState([fd(0), fd(1), blank]));
  });
  assert.deepStrictEqual(fdNames(yaml), ["fd-0", "fd-1"]);
});
