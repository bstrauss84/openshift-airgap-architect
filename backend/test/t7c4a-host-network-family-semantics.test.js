/**
 * Tranche 7C.4A — host networkConfig address-family semantics, asserted on the
 * GENERATED NMState rather than on field visibility.
 *
 * WHAT WAS WRONG. Tranche 7C.4 concluded that "primary/additional/bond/VLAN L3
 * addressing and default routes are all CLUSTER-STACK-COUPLED", and justified
 * it by observing that this tool's own `addIpConfig` discarded any family that
 * did not match the cluster IP stack mode. That is circular — the tool's
 * implementation was treated as the authority for what the tool should do.
 *
 * WHAT THE AUTHORITY ACTUALLY SAYS.
 *
 *   PRIMARY cluster/node endpoint path — genuinely coupled. The host must hold
 *   an address in every machine network (assisted-service
 *   `belongs-to-machine-cidr`), and node-IP selection derives from the
 *   default-route / VIP-routing interface with a cluster-derived `preferIPv6`
 *   (baremetal-runtimecfg `cmd/runtimecfg/node-ip.go`).
 *
 *   ADDITIONAL / SECONDARY interfaces — independent. Red Hat delegates
 *   `hosts[].networkConfig` wholesale to NMState: "The configuration must match
 *   the Host Network Management API defined in the Declarative Network API
 *   (nmstate documentation)" (Agent-based Installer 4.20/4.21/4.22 §9.2.2,
 *   Table 9.8). `interfaces[].ipv4` and `interfaces[].ipv6` are independent
 *   per-interface sub-objects. openshift/installer copies
 *   `host.NetworkConfig.Raw` through verbatim and validates it only with
 *   `nmstatectl gc`; the documented pre-ISO validation list (§1.11) contains no
 *   family rule. Red Hat itself requires a SEPARATE storage network for iSCSI
 *   boot (§7.1) with no family constraint.
 *
 *   ROUTES — a route is constrained by the family enabled on ITS OWN next-hop
 *   interface, which is the only rule nmstate enforces
 *   (`rust/src/lib/route.rs`: "The next hop interface of desired Route ... has
 *   been marked as IPv6 disabled"). The cluster/default route stays coupled.
 *
 *   DNS — passed through verbatim; nmstate requires only that SOME interface on
 *   the host has the matching family enabled (`rust/src/lib/nm/dns.rs`).
 *
 * Verified empirically against `nmstatectl gc` — the same binary the installer
 * invokes in `ValidateStaticConfigParams` — that an IPv4 primary with an
 * IPv6-only secondary ethernet and VLAN, mixed-family DNS and an IPv6 secondary
 * route is accepted.
 *
 * These tests assert the generated agent-config NMState, per §7 of the tranche
 * brief, because field visibility was exactly what the previous contract got
 * right while the output stayed wrong.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";

import { buildAgentConfig } from "../src/generate.js";
import { bareMetalAgent } from "../../e2e/fixtures/scenarios.js";

const V4 = { cidr: "192.168.111.80/24", gw: "192.168.111.1" };
const V6 = { cidr: "2001:db8:1::10/64", gw: "2001:db8:1::1" };
const SECONDARY_V4 = "10.10.5.10/24";
const SECONDARY_V6 = "2001:db8:5::10/64";

/**
 * One agent host at 4.22 with the given cluster stack mode, a primary
 * interface of `primaryType`, and one additional interface of `extraType`.
 */
function agentDoc({
  ipStackMode,
  primaryType = "ethernet",
  primaryV4 = true,
  primaryV6 = false,
  extraType = "ethernet",
  extraV4 = null,
  extraV6 = null,
  extraRoutes = [],
  dnsServers = ""
}) {
  const state = bareMetalAgent();
  state.release = { channel: "4.22", patchVersion: "4.22.16" };
  state.version = {
    selectedMinor: "4.22",
    selectedPatch: "4.22.16",
    selectedChannel: "stable-4.22",
    locked: true
  };

  const primary = {
    type: primaryType,
    mode: "static",
    ethernet: { name: "eno1" },
    bond: { name: "bond0", mode: "802.3ad", slaves: [{ name: "eno1" }, { name: "eno2" }] },
    vlan: { id: "100" },
    ...(primaryV4 ? { ipv4Cidr: V4.cidr, ipv4Gateway: V4.gw } : {}),
    ...(primaryV6 ? { ipv6Cidr: V6.cidr, ipv6Gateway: V6.gw } : {})
  };

  const extra = {
    type: extraType,
    mode: "static",
    ethernet: { name: "eno9" },
    bond: { name: "bond9", mode: "802.3ad", slaves: [{ name: "eno7" }, { name: "eno8" }] },
    vlan: { id: "400" },
    ...(extraV4 ? { ipv4Cidr: extraV4 } : {}),
    ...(extraV6 ? { ipv6Cidr: extraV6 } : {}),
    advanced: { routes: extraRoutes }
  };

  state.hostInventory = {
    ...(state.hostInventory || {}),
    ipStackMode,
    nodes: [
      {
        name: "master-0",
        role: "master",
        ipStackMode,
        primary,
        additionalInterfaces: [extra],
        dnsServers
      }
    ]
  };

  const doc = yaml.load(buildAgentConfig(state));
  return doc.hosts[0].networkConfig;
}

const iface = (nc, name) => nc.interfaces.find((i) => i.name === name);
const v4On = (i) => i?.ipv4?.enabled === true;
const v6On = (i) => i?.ipv6?.enabled === true;
const addr = (i, fam) => (i?.[fam]?.address || []).map((a) => `${a.ip}/${a["prefix-length"]}`);

/** The logical interface an additional row of each type ends up emitting. */
const EXTRA_NAME = { ethernet: "eno9", bond: "bond9", "vlan-on-bond": "bond9.400" };

describe("7C.4A — PRIMARY path follows the cluster IP stack mode", () => {
  it("IPv4-only: the primary carries IPv4 and has IPv6 disabled", () => {
    const nc = agentDoc({ ipStackMode: "ipv4", primaryV4: true, primaryV6: true });
    const p = iface(nc, "eno1");
    assert.equal(v4On(p), true);
    assert.deepEqual(addr(p, "ipv4"), [V4.cidr]);
    assert.equal(v6On(p), false, "an IPv6 primary address must not survive an IPv4-only cluster");
  });

  it("IPv6-only: the primary carries IPv6 and has IPv4 disabled", () => {
    const nc = agentDoc({ ipStackMode: "ipv6", primaryV4: true, primaryV6: true });
    const p = iface(nc, "eno1");
    assert.equal(v6On(p), true);
    assert.deepEqual(addr(p, "ipv6"), [V6.cidr]);
    assert.equal(v4On(p), false, "an IPv4 primary address must not survive an IPv6-only cluster");
  });

  it("dual-stack: the primary carries both", () => {
    const nc = agentDoc({ ipStackMode: "dual-stack", primaryV4: true, primaryV6: true });
    const p = iface(nc, "eno1");
    assert.equal(v4On(p), true);
    assert.equal(v6On(p), true);
  });

  for (const primaryType of ["bond", "vlan-on-bond"]) {
    it(`${primaryType} AS THE PRIMARY path is coupled too — by role, not by type`, () => {
      const name = primaryType === "bond" ? "bond0" : "bond0.100";
      const nc = agentDoc({ ipStackMode: "ipv6", primaryType, primaryV4: true, primaryV6: true });
      const p = iface(nc, name);
      assert.ok(p, `expected the primary to be emitted as ${name}`);
      assert.equal(v6On(p), true);
      assert.equal(v4On(p), false);
    });
  }
});

describe("7C.4A — the cluster default route stays cluster-stack-coupled", () => {
  const defaultRoutes = (nc) =>
    nc.routes.config.filter((r) => r.destination === "0.0.0.0/0" || r.destination === "::/0");

  it("IPv4-only: only the IPv4 default route is emitted", () => {
    const nc = agentDoc({ ipStackMode: "ipv4", primaryV4: true, primaryV6: true });
    assert.deepEqual(defaultRoutes(nc).map((r) => r.destination), ["0.0.0.0/0"]);
  });

  it("IPv6-only: only the IPv6 default route is emitted", () => {
    const nc = agentDoc({ ipStackMode: "ipv6", primaryV4: true, primaryV6: true });
    assert.deepEqual(defaultRoutes(nc).map((r) => r.destination), ["::/0"]);
  });

  it("dual-stack: both default routes exist and share one interface", () => {
    /* Red Hat, Agent-based Installer §9.1.2 and the OVN-Kubernetes plugin
       guide §1.2: "both IPv4 and IPv6 traffic must use the same network
       interface as the default gateway" and "both the IPv4 and IPv6 routing
       tables must contain the default gateway" — otherwise ovnkube-node
       CrashLoopBackOffs with "multiple gateway interfaces detected". This must
       not be loosened while secondary interfaces are decoupled. */
    const nc = agentDoc({ ipStackMode: "dual-stack", primaryV4: true, primaryV6: true });
    const routes = defaultRoutes(nc);
    assert.deepEqual(routes.map((r) => r.destination).sort(), ["0.0.0.0/0", "::/0"]);
    assert.equal(new Set(routes.map((r) => r["next-hop-interface"])).size, 1,
      "both default routes must leave by the same interface");
  });
});

describe("7C.4A — ADDITIONAL interfaces are INDEPENDENT of the cluster stack", () => {
  for (const stack of ["ipv4", "ipv6", "dual-stack"]) {
    for (const extraType of ["ethernet", "bond", "vlan-on-bond"]) {
      it(`${stack} / additional ${extraType}: an IPv4 secondary address is kept`, () => {
        const nc = agentDoc({
          ipStackMode: stack,
          primaryV4: stack !== "ipv6",
          primaryV6: stack !== "ipv4",
          extraType,
          extraV4: SECONDARY_V4
        });
        const e = iface(nc, EXTRA_NAME[extraType]);
        assert.ok(e, `expected ${EXTRA_NAME[extraType]} to be emitted`);
        assert.equal(v4On(e), true, "an IPv4 storage/management address is valid in any cluster stack");
        assert.deepEqual(addr(e, "ipv4"), [SECONDARY_V4]);
      });

      it(`${stack} / additional ${extraType}: an IPv6 secondary address is kept`, () => {
        const nc = agentDoc({
          ipStackMode: stack,
          primaryV4: stack !== "ipv6",
          primaryV6: stack !== "ipv4",
          extraType,
          extraV6: SECONDARY_V6
        });
        const e = iface(nc, EXTRA_NAME[extraType]);
        assert.equal(v6On(e), true, "an IPv6 secondary address is valid in any cluster stack");
        assert.deepEqual(addr(e, "ipv6"), [SECONDARY_V6]);
      });
    }
  }

  it("THE REGRESSION CASE: IPv6-only cluster, IPv4 storage NIC, both survive correctly", () => {
    const nc = agentDoc({
      ipStackMode: "ipv6",
      primaryV4: false,
      primaryV6: true,
      extraType: "ethernet",
      extraV4: SECONDARY_V4
    });
    const p = iface(nc, "eno1");
    const e = iface(nc, "eno9");
    assert.equal(v6On(p), true, "primary keeps the cluster family");
    assert.equal(v4On(p), false, "primary does not gain the other family");
    assert.equal(v4On(e), true, "the secondary keeps its own family");
    assert.equal(v6On(e), false, "the secondary gains nothing it was not given");
  });

  it("a secondary interface with no address of either family stays fully disabled", () => {
    const nc = agentDoc({ ipStackMode: "dual-stack", extraType: "ethernet" });
    const e = iface(nc, "eno9");
    assert.equal(v4On(e), false);
    assert.equal(v6On(e), false);
  });
});

describe("7C.4A — an additional route follows ITS OWN next-hop interface", () => {
  it("an IPv4 route out of an IPv4 secondary is emitted in an IPv6-only cluster", () => {
    const nc = agentDoc({
      ipStackMode: "ipv6",
      primaryV4: false,
      primaryV6: true,
      extraType: "ethernet",
      extraV4: SECONDARY_V4,
      extraRoutes: [
        { destination: "203.0.113.0/24", nextHopAddress: "10.10.5.1", nextHopInterface: "eno9" }
      ]
    });
    const r = nc.routes.config.find((x) => x.destination === "203.0.113.0/24");
    assert.ok(r, "the storage route must reach the document");
    assert.equal(r["next-hop-interface"], "eno9");
  });

  it("an IPv6 route out of an IPv6 secondary is emitted in an IPv4-only cluster", () => {
    const nc = agentDoc({
      ipStackMode: "ipv4",
      extraType: "ethernet",
      extraV6: SECONDARY_V6,
      extraRoutes: [
        { destination: "2001:db8:7::/64", nextHopAddress: "2001:db8:5::1", nextHopInterface: "eno9" }
      ]
    });
    const r = nc.routes.config.find((x) => x.destination === "2001:db8:7::/64");
    assert.ok(r, "the IPv6 secondary route must reach the document");
  });

  it("a route whose family is disabled on its own next hop is NOT emitted", () => {
    /* The one rule nmstate really enforces. The secondary has no IPv6, so an
       IPv6 route out of it is invalid and must not be generated. */
    const nc = agentDoc({
      ipStackMode: "dual-stack",
      extraType: "ethernet",
      extraV4: SECONDARY_V4,
      extraRoutes: [
        { destination: "2001:db8:7::/64", nextHopAddress: "2001:db8:5::1", nextHopInterface: "eno9" }
      ]
    });
    assert.equal(
      nc.routes.config.find((x) => x.destination === "2001:db8:7::/64"),
      undefined,
      "IPv6 is disabled on eno9, so nmstate would reject this route"
    );
  });
});

describe("7C.4A — DNS is passed through verbatim", () => {
  it("a mixed-family resolver list is preserved in every stack mode", () => {
    for (const stack of ["ipv4", "ipv6", "dual-stack"]) {
      const nc = agentDoc({
        ipStackMode: stack,
        primaryV4: stack !== "ipv6",
        primaryV6: stack !== "ipv4",
        extraType: "ethernet",
        extraV4: SECONDARY_V4,
        dnsServers: "192.168.111.1,2001:db8:1::53"
      });
      assert.deepEqual(
        nc["dns-resolver"].config.server,
        ["192.168.111.1", "2001:db8:1::53"],
        `${stack}: nmstate requires only that SOME interface has the family enabled`
      );
    }
  });
});
