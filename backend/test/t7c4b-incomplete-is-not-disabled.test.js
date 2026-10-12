/**
 * Tranche 7C.4B — an incomplete static interface must not be generated as a
 * deliberately disabled one.
 *
 * WHAT THE HUMAN SAW (B4, screenshot 2026-10-12 11-34-05). After switching the
 * cluster to IPv6-only, the agent-config preview showed an interface with
 * `ipv4: {enabled: false}` AND `ipv6: {enabled: false}`, while the node editor
 * reported that an IPv6 address was required. Generation had SUCCEEDED, so
 * that document was the CURRENT one, not a retained last-valid one — there was
 * no "Preview not updated" banner.
 *
 * Two different interfaces were involved, and only one of them was wrong:
 *
 *   bond0     — both families disabled. CORRECT. It is the bond beneath a
 *               vlan-on-bond primary; the L3 lives on the VLAN. Red Hat's own
 *               Agent-based Installer §1.8 example shows exactly this shape.
 *   bond0.90  — both families disabled. WRONG. This is the L3 carrier. The
 *               user had selected static addressing in an IPv6-only cluster
 *               and had not yet typed the IPv6 address.
 *
 * WHY IT MATTERED. In NMState, `enabled: false` is a statement of intent — the
 * Declarative Network API defines it as removing the address, and for IPv6 the
 * link-local address too. Writing it for an address the user has merely not
 * entered yet conflates three distinct states:
 *
 *   A  IPv6 intentionally off        -> ipv6: {enabled: false}
 *   B  IPv6 static, fully configured -> ipv6: {enabled: true, address: [...]}
 *   C  IPv6 static, address MISSING  -> neither of the above
 *
 * The generator was collapsing C into A, producing a confident-looking
 * document for a node with no address of any family. The "IPv4 is not enabled
 * on bond0.90" route error was a DOWNSTREAM SYMPTOM of that false state, not
 * an independent fault: the route was silently dropped because the interface
 * it pointed at had been recorded as having IPv4 off.
 *
 * THE FIX. State C now fails generation, which routes it into the contract the
 * repository already has for a current state that cannot be generated: the
 * preview keeps the last valid document under an explicit banner (DOC-160 as
 * refined, per-artifact under DOC-227). `buildNmState` already did precisely
 * this for an empty interface name; this follows that precedent rather than
 * inventing a third representation.
 *
 * It is a COMPLETENESS check, not a family check — one family is enough.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";

import { buildAgentConfig } from "../src/generate.js";
import { bareMetalAgent } from "../../e2e/fixtures/scenarios.js";

/** One agent host at 4.22 with the given cluster stack and primary addressing. */
function hostState({
  ipStackMode,
  primaryType = "ethernet",
  mode = "static",
  ipv4Cidr = null,
  ipv6Cidr = null,
  additionalInterfaces = [],
  routes = []
}) {
  const state = bareMetalAgent();
  state.release = { channel: "4.22", patchVersion: "4.22.16" };
  state.version = {
    selectedMinor: "4.22",
    selectedPatch: "4.22.16",
    selectedChannel: "stable-4.22",
    locked: true
  };
  state.hostInventory = {
    ...(state.hostInventory || {}),
    ipStackMode,
    nodes: [
      {
        name: "master-0",
        hostname: "master-0",
        role: "master",
        ipStackMode,
        primary: {
          type: primaryType,
          mode,
          ethernet: { name: "eno1", macAddress: "52:54:00:00:00:01" },
          bond: {
            name: "bond0",
            mode: "active-backup",
            slaves: [
              { name: "eno1", macAddress: "52:54:00:00:00:01" },
              { name: "eno2", macAddress: "52:54:00:00:00:02" }
            ]
          },
          vlan: { id: "90", baseIface: "", name: "" },
          ...(ipv4Cidr ? { ipv4Cidr, ipv4Gateway: "192.168.111.1" } : {}),
          ...(ipv6Cidr ? { ipv6Cidr, ipv6Gateway: "2001:db8:1::1" } : {}),
          advanced: { routes }
        },
        additionalInterfaces
      }
    ]
  };
  return state;
}

const nmstate = (state) => yaml.load(buildAgentConfig(state)).hosts[0].networkConfig;
const iface = (nc, name) => nc.interfaces.find((i) => i.name === name);

/* ----------------------------------------------------------------------- */
/* CASE 1 — IPv6-only cluster, primary static IPv6 COMPLETE                 */
/* ----------------------------------------------------------------------- */

test("CASE 1: complete static IPv6 primary generates ipv6.enabled=true with its address", () => {
  const nc = nmstate(hostState({ ipStackMode: "ipv6", ipv6Cidr: "2001:db8:1::10/64" }));
  const p = iface(nc, "eno1");
  assert.equal(p.ipv6.enabled, true);
  assert.deepEqual(p.ipv6.address, [{ ip: "2001:db8:1::10", "prefix-length": 64 }]);
  assert.equal(p.ipv4.enabled, false, "the other family is legitimately off in a single-stack cluster");
});

/* ----------------------------------------------------------------------- */
/* CASE 2 — IPv6-only cluster, primary static IPv6 INCOMPLETE               */
/* ----------------------------------------------------------------------- */

test("CASE 2: incomplete static IPv6 primary REFUSES to generate rather than claiming IPv6 is off", () => {
  // The exact screenshot state: IPv4 was entered before the cluster became
  // IPv6-only, and no IPv6 address has been typed yet.
  const state = hostState({ ipStackMode: "ipv6", ipv4Cidr: "192.168.111.80/24" });
  assert.throws(
    () => buildAgentConfig(state),
    /set to static addressing but has no IPv6 address/,
    "an incomplete interface must not be emitted as a disabled one"
  );
});

test("CASE 2: the refusal names the interface and tells the user what to do", () => {
  const state = hostState({
    ipStackMode: "ipv6",
    primaryType: "vlan-on-bond",
    ipv4Cidr: "192.168.111.80/24"
  });
  assert.throws(() => buildAgentConfig(state), (err) => {
    assert.match(err.message, /"bond0\.90"/, "names the L3 carrier, not the bond beneath it");
    assert.match(err.message, /Enter one, or set this interface to DHCP/);
    return true;
  });
});

test("CASE 2: no document with a node carrying no address of any family can be produced", () => {
  // The property that actually matters, asserted over every stack mode.
  for (const ipStackMode of ["ipv4", "ipv6", "dual-stack"]) {
    let nc = null;
    try {
      nc = nmstate(hostState({ ipStackMode }));
    } catch {
      continue; // refused, which is the correct outcome
    }
    const l3 = iface(nc, "eno1");
    assert.ok(
      l3.ipv4.enabled === true || l3.ipv6.enabled === true,
      `${ipStackMode}: generated an L3 interface with no enabled family`
    );
  }
});

test("CASE 2: DHCP is unaffected — only static addressing requires an address", () => {
  const nc = nmstate(hostState({ ipStackMode: "ipv4", mode: "dhcp" }));
  assert.equal(iface(nc, "eno1").ipv4.enabled, true);
  assert.equal(iface(nc, "eno1").ipv4.dhcp, true);
});

test("CASE 2: an unaddressed SECONDARY is NOT refused — that is a valid L2-only NIC", () => {
  /* Scope guard. The IP-assignment control offers only DHCP and Static, so an
     unaddressed secondary is the only way to express an interface that exists
     for MTU, SR-IOV or as a bond carrier. `enabled: false` is the correct
     NMState there, and refusing it would remove a capability. Only the
     primary — which carries the node address — must be addressed. */
  const nc = nmstate(hostState({
    ipStackMode: "ipv4",
    ipv4Cidr: "192.168.111.80/24",
    additionalInterfaces: [
      {
        type: "ethernet",
        mode: "static",
        ethernet: { name: "eno9", macAddress: "52:54:00:00:00:09" },
        advanced: { mtu: "9000", routes: [] }
      }
    ]
  }));
  const l2 = iface(nc, "eno9");
  assert.equal(l2.ipv4.enabled, false);
  assert.equal(l2.ipv6.enabled, false);
  assert.equal(l2.mtu, 9000, "it still carries the L2 settings it exists for");
});

test("CASE 2: one family is enough — dual-stack with only IPv4 still generates", () => {
  // A completeness check, not a demand that every enabled family be filled in.
  const nc = nmstate(hostState({ ipStackMode: "dual-stack", ipv4Cidr: "192.168.111.80/24" }));
  assert.equal(iface(nc, "eno1").ipv4.enabled, true);
  assert.equal(iface(nc, "eno1").ipv6.enabled, false);
});

test("CASE 2: a bond beneath a VLAN keeps both families off — that one IS intentional", () => {
  /* Guards against over-correcting. Red Hat's ABI §1.8 example shows the bond
     carrying ipv4/ipv6 disabled while the VLAN on top carries the address. */
  const nc = nmstate(hostState({
    ipStackMode: "ipv6",
    primaryType: "vlan-on-bond",
    ipv6Cidr: "2001:db8:1::10/64"
  }));
  const bond = iface(nc, "bond0");
  const vlan = iface(nc, "bond0.90");
  assert.equal(bond.ipv4.enabled, false);
  assert.equal(bond.ipv6.enabled, false);
  assert.equal(vlan.ipv6.enabled, true, "the VLAN is the L3 carrier and must be addressed");
});

/* ----------------------------------------------------------------------- */
/* CASE 3 — IPv6-only cluster + an independent additional IPv4 interface    */
/* ----------------------------------------------------------------------- */

test("CASE 3: an IPv4 secondary survives in an IPv6-only cluster alongside an IPv6 primary", () => {
  const nc = nmstate(hostState({
    ipStackMode: "ipv6",
    ipv6Cidr: "2001:db8:1::10/64",
    additionalInterfaces: [
      {
        type: "ethernet",
        mode: "static",
        ethernet: { name: "eno9", macAddress: "52:54:00:00:00:09" },
        ipv4Cidr: "10.10.5.10/24",
        advanced: { routes: [] }
      }
    ]
  }));
  const primary = iface(nc, "eno1");
  const secondary = iface(nc, "eno9");
  assert.equal(primary.ipv6.enabled, true);
  assert.equal(primary.ipv4.enabled, false);
  assert.equal(secondary.ipv4.enabled, true, "a storage NIC is not bound to the cluster family");
  assert.deepEqual(secondary.ipv4.address, [{ ip: "10.10.5.10", "prefix-length": 24 }]);
  assert.equal(secondary.ipv6.enabled, false, "and gains nothing it was not given");
});

/* ----------------------------------------------------------------------- */
/* CASE 4 — an IPv4 route pointed at an interface with IPv4 disabled        */
/* ----------------------------------------------------------------------- */

test("CASE 4: a route whose family is off on its own next hop is not emitted", () => {
  const nc = nmstate(hostState({
    ipStackMode: "ipv6",
    ipv6Cidr: "2001:db8:1::10/64",
    additionalInterfaces: [
      {
        type: "ethernet",
        mode: "static",
        ethernet: { name: "eno9", macAddress: "52:54:00:00:00:09" },
        ipv6Cidr: "2001:db8:5::10/64",
        advanced: {
          routes: [
            { destination: "10.0.0.0/24", nextHopAddress: "10.10.5.1", nextHopInterface: "eno9" }
          ]
        }
      }
    ]
  }));
  assert.equal(
    nc.routes.config.find((r) => r.destination === "10.0.0.0/24"),
    undefined,
    "eno9 has no IPv4, so nmstate would reject this route"
  );
});

test("CASE 4: the same route IS emitted once its next hop actually has IPv4", () => {
  // Proves CASE 4 is about the interface's family, not about the route itself.
  const nc = nmstate(hostState({
    ipStackMode: "ipv6",
    ipv6Cidr: "2001:db8:1::10/64",
    additionalInterfaces: [
      {
        type: "ethernet",
        mode: "static",
        ethernet: { name: "eno9", macAddress: "52:54:00:00:00:09" },
        ipv4Cidr: "10.10.5.10/24",
        advanced: {
          routes: [
            { destination: "10.0.0.0/24", nextHopAddress: "10.10.5.1", nextHopInterface: "eno9" }
          ]
        }
      }
    ]
  }));
  const r = nc.routes.config.find((x) => x.destination === "10.0.0.0/24");
  assert.ok(r, "the storage route must reach the document");
  assert.equal(r["next-hop-interface"], "eno9");
});

test("B4 REGRESSION: the screenshot state can no longer produce a silently wrong document", () => {
  /* The whole defect in one assertion. Before the fix this generated
     successfully, with bond0.90 reporting both families off and the primary
     route silently dropped. */
  const state = hostState({
    ipStackMode: "ipv6",
    primaryType: "vlan-on-bond",
    ipv4Cidr: "192.168.111.80/24",
    routes: [{ destination: "10.0.0.0/24", nextHopAddress: "192.168.111.254", nextHopInterface: "" }]
  });
  assert.throws(() => buildAgentConfig(state), /no IPv6 address/);
});
