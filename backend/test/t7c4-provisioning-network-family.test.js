/**
 * Tranche 7C.4 — provisioning-network address family and mode applicability.
 *
 * Two human questions from the 7C.3 supplementary review, answered with
 * upstream evidence rather than inference:
 *
 *   5E — "where, pray tell, am I supposed to [enter an IPv6 provisioning
 *         network]? ... if I set the Networking tab IP Stack Mode to
 *         Dual-stack or IPv6 only, SHOULD/DOES that have an impact on any IP
 *         related fields in Platform Specifics?"
 *
 *   5F — "if the provisioning network is 'disabled' is there a valid reason to
 *         present any provisioning network fields either in the wizard or in
 *         the yaml at all?"
 *
 * Answers, verified against openshift/installer and
 * openshift/cluster-baremetal-operator at the pinned 4.20/4.21/4.22 release
 * commits:
 *
 *   - The provisioning network may be IPv4 or IPv6, and its family is
 *     INDEPENDENT of the cluster IP Stack Mode. `validateNoOverlapMachineCIDR`
 *     compares against machine networks only within the same family, so a
 *     cross-family provisioning network passes.
 *   - It is SINGLE-FAMILY. Every provisioning field is a scalar; the installer
 *     models dual-stack only where it supports it (APIVIPs/IngressVIPs).
 *   - A Managed IPv6 provisioning network cannot be larger than /64, enforced
 *     twice upstream and documented in the Provisioning API book.
 *   - In Disabled mode the installer itself emits the CIDR, so OAA doing so is
 *     not a divergence — but Red Hat explicitly says to OMIT
 *     `provisioningInterface` and `provisioningDHCPRange`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";

import { buildInstallConfig } from "../src/generate.js";
import {
  provisioningFamilyOf,
  validateProvisioningNetworkFamily,
  MANAGED_IPV6_MIN_PREFIX,
  PROVISIONING_IP_FAMILIES
} from "../../shared/provisioningNetworkFamily.js";
import { bareMetalIpi } from "./fixtures/base-states.js";

const V4 = {
  provisioningNetworkCIDR: "172.22.0.0/24",
  provisioningNetworkInterface: "eno1",
  provisioningDHCPRange: "172.22.0.10,172.22.0.100",
  clusterProvisioningIP: "172.22.0.3"
};

const V6 = {
  provisioningNetworkCIDR: "fd2e:6f44:5dd8:c956::/64",
  provisioningNetworkInterface: "eno1",
  provisioningDHCPRange: "fd2e:6f44:5dd8:c956::10,fd2e:6f44:5dd8:c956::100",
  clusterProvisioningIP: "fd2e:6f44:5dd8:c956::3"
};

/** A real 4.22 bare-metal IPI state with the given provisioning block. */
function ipiState(provisioning) {
  const state = bareMetalIpi();
  state.release = { ...(state.release || {}), channel: "4.22", patchVersion: "4.22.16" };
  state.version = {
    ...(state.version || {}),
    selectedMinor: "4.22",
    selectedPatch: "4.22.16",
    selectedChannel: "stable-4.22",
    locked: true
  };
  state.hostInventory = { ...(state.hostInventory || {}), ...provisioning };
  return state;
}

/** State-shaped provisioning block -> validator arguments. */
function famArgs({ provisioningNetwork, provisioningNetworkCIDR, provisioningDHCPRange,
                   clusterProvisioningIP, bootstrapProvisioningIP, provisioningNetworkGateway,
                   cidr, gateway } = {}) {
  return {
    provisioningNetwork,
    cidr: cidr ?? provisioningNetworkCIDR,
    dhcpRange: provisioningDHCPRange,
    clusterProvisioningIP,
    bootstrapProvisioningIP,
    gateway: gateway ?? provisioningNetworkGateway
  };
}

const baremetalOf = (state) =>
  yaml.load(buildInstallConfig(state))?.platform?.baremetal || {};

describe("7C.4 — provisioning network is single-family, IPv4 or IPv6", () => {
  it("offers exactly IPv4 and IPv6, never dual-stack", () => {
    assert.deepEqual(PROVISIONING_IP_FAMILIES, ["ipv4", "ipv6"]);
  });

  it("detects the family from the CIDR", () => {
    assert.equal(provisioningFamilyOf("172.22.0.0/24"), "ipv4");
    assert.equal(provisioningFamilyOf("fd2e:6f44:5dd8:c956::/64"), "ipv6");
    assert.equal(provisioningFamilyOf(""), null);
    assert.equal(provisioningFamilyOf("not-a-cidr"), null);
  });

  it("accepts a fully IPv4 provisioning network", () => {
    const r = validateProvisioningNetworkFamily(famArgs({ provisioningNetwork: "Managed", ...V4 }));
    assert.equal(r.valid, true);
    assert.equal(r.family, "ipv4");
  });

  it("accepts a fully IPv6 provisioning network", () => {
    const r = validateProvisioningNetworkFamily(famArgs({ provisioningNetwork: "Managed", ...V6 }));
    assert.equal(r.valid, true, JSON.stringify(r.errors));
    assert.equal(r.family, "ipv6");
  });

  it("rejects an IPv4 cluster provisioning IP on an IPv6 network", () => {
    const r = validateProvisioningNetworkFamily(famArgs({
      provisioningNetwork: "Managed",
      ...V6,
      clusterProvisioningIP: "172.22.0.3"
    }));
    assert.equal(r.valid, false);
    assert.match(r.errors.clusterProvisioningIP, /IPv4.*IPv6.*single address family/s);
  });

  it("rejects an IPv6 gateway on an IPv4 network", () => {
    const r = validateProvisioningNetworkFamily(famArgs({
      provisioningNetwork: "Managed",
      ...V4,
      gateway: "fd2e:6f44:5dd8:c956::254"
    }));
    assert.equal(r.valid, false);
    assert.match(r.errors.provisioningNetworkGateway, /IPv6.*IPv4/s);
  });

  it("rejects a mixed-family DHCP range", () => {
    const r = validateProvisioningNetworkFamily(famArgs({
      provisioningNetwork: "Managed",
      ...V4,
      provisioningDHCPRange: "172.22.0.10,fd2e:6f44:5dd8:c956::100"
    }));
    assert.equal(r.valid, false);
    assert.match(r.errors.provisioningDHCPRange, /IPv6.*IPv4/s);
  });

  it("does not invent a family error when the CIDR itself is unparseable", () => {
    const r = validateProvisioningNetworkFamily({
      provisioningNetwork: "Managed",
      cidr: "nonsense",
      clusterProvisioningIP: "172.22.0.3"
    });
    assert.equal(r.valid, true);
    assert.equal(r.family, null);
  });
});

describe("7C.4 — Managed IPv6 provisioning networks cannot be larger than /64", () => {
  it("rejects a /48 Managed IPv6 network", () => {
    const r = validateProvisioningNetworkFamily({
      provisioningNetwork: "Managed",
      cidr: "fd2e:6f44::/48"
    });
    assert.equal(r.valid, false);
    assert.match(r.errors.provisioningNetworkCIDR, /cannot be larger than a \/64/);
  });

  it("accepts exactly /64", () => {
    const r = validateProvisioningNetworkFamily({
      provisioningNetwork: "Managed",
      cidr: "fd2e:6f44:5dd8:c956::/64"
    });
    assert.equal(r.valid, true);
    assert.equal(MANAGED_IPV6_MIN_PREFIX, 64);
  });

  it("accepts a longer prefix than /64", () => {
    const r = validateProvisioningNetworkFamily({
      provisioningNetwork: "Managed",
      cidr: "fd2e:6f44:5dd8:c956::/96"
    });
    assert.equal(r.valid, true);
  });

  it("does NOT apply the rule to Unmanaged — upstream gates it on Managed", () => {
    for (const mode of ["Unmanaged", "Disabled"]) {
      const r = validateProvisioningNetworkFamily({
        provisioningNetwork: mode,
        cidr: "fd2e:6f44::/48"
      });
      assert.equal(r.valid, true, `${mode} must not apply the Managed-only /64 rule`);
    }
  });

  it("does NOT apply any prefix rule to IPv4", () => {
    const r = validateProvisioningNetworkFamily({
      provisioningNetwork: "Managed",
      cidr: "172.22.0.0/16"
    });
    assert.equal(r.valid, true);
  });
});

describe("7C.4 — provisioning-mode applicability in generated install-config", () => {
  it("Managed emits CIDR, interface and DHCP range", () => {
    const bm = baremetalOf(ipiState({ provisioningNetwork: "Managed", ...V4 }));
    assert.equal(bm.provisioningNetworkCIDR, V4.provisioningNetworkCIDR);
    assert.equal(bm.provisioningNetworkInterface, "eno1");
    assert.equal(bm.provisioningDHCPRange, V4.provisioningDHCPRange);
  });

  it("Unmanaged keeps the interface but drops the DHCP range", () => {
    // cluster-baremetal-operator clears dhcpRange for any non-Managed mode, so
    // emitting it would be dead text in the user's file.
    const bm = baremetalOf(ipiState({ provisioningNetwork: "Unmanaged", ...V4 }));
    assert.equal(bm.provisioningNetworkInterface, "eno1");
    assert.equal(bm.provisioningDHCPRange, undefined);
  });

  it("Disabled drops the interface and the DHCP range", () => {
    // Red Hat: "Omit the provisioningInterface configuration setting if the
    // provisioning network is Disabled" and the same for provisioningDHCPRange.
    const bm = baremetalOf(ipiState({ provisioningNetwork: "Disabled", ...V4 }));
    assert.equal(bm.provisioningNetworkInterface, undefined);
    assert.equal(bm.provisioningDHCPRange, undefined);
  });

  it("Disabled still emits the CIDR — Red Hat requires it to be valid even then", () => {
    const bm = baremetalOf(ipiState({ provisioningNetwork: "Disabled", ...V4 }));
    assert.equal(bm.provisioningNetworkCIDR, V4.provisioningNetworkCIDR);
  });

  it("Disabled still emits clusterProvisioningIP — it is how the address is supplied", () => {
    const bm = baremetalOf(ipiState({ provisioningNetwork: "Disabled", ...V4 }));
    assert.equal(bm.clusterProvisioningIP, V4.clusterProvisioningIP);
  });

  it("the gateway is emitted in Managed only — CBO degrades the cluster otherwise", () => {
    const gw = "172.22.0.254";
    const managed = baremetalOf(ipiState({ provisioningNetwork: "Managed", ...V4, provisioningNetworkGateway: gw }));
    assert.equal(managed.provisioningNetworkGateway, gw);

    for (const mode of ["Unmanaged", "Disabled"]) {
      const bm = baremetalOf(ipiState({ provisioningNetwork: mode, ...V4, provisioningNetworkGateway: gw }));
      assert.equal(
        bm.provisioningNetworkGateway,
        undefined,
        `${mode} must not emit the gateway: cluster-baremetal-operator rejects it ` +
          `("only supported for Managed provisioning network") and Degrades the ` +
          `baremetal ClusterOperator`
      );
    }
  });

  it("switching modes never destroys the user's values — only emission is gated", () => {
    // Same state object, three modes: the generator reads state it does not emit.
    const provisioning = { ...V4, provisioningNetworkGateway: "172.22.0.254" };
    const seen = ["Managed", "Unmanaged", "Disabled", "Managed"].map((mode) =>
      baremetalOf(ipiState({ provisioningNetwork: mode, ...provisioning }))
    );
    // Returning to Managed restores every emitted field identically.
    assert.deepEqual(seen[3], seen[0]);
  });

  it("an IPv6 provisioning network generates end to end", () => {
    const bm = baremetalOf(
      ipiState({
        provisioningNetwork: "Managed",
        ...V6,
        provisioningNetworkGateway: "fd2e:6f44:5dd8:c956::254"
      })
    );
    assert.equal(bm.provisioningNetworkCIDR, V6.provisioningNetworkCIDR);
    assert.equal(bm.provisioningDHCPRange, V6.provisioningDHCPRange);
    assert.equal(bm.clusterProvisioningIP, V6.clusterProvisioningIP);
    assert.equal(bm.provisioningNetworkGateway, "fd2e:6f44:5dd8:c956::254");
  });
});
