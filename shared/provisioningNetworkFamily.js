/**
 * OpenShift Airgap Architect — bare-metal provisioning-network address family.
 *
 * WHY THIS MODULE EXISTS
 *
 * The bare-metal provisioning network is a SEPARATE network from the cluster's
 * machine/cluster/service networks, and its address family is INDEPENDENT of
 * the Networking step's IP Stack Mode. That independence is proven, not
 * assumed — `pkg/types/baremetal/validation/platform.go`
 * (`validateNoOverlapMachineCIDR`) compares the provisioning CIDR against each
 * machine network ONLY when the two are the same family:
 *
 *     netIsIPv6 := target.IP.To4() == nil
 *     for _, machineCIDR := range n.MachineNetwork {
 *         machineCIDRisIPv6 := machineCIDR.CIDR.IP.To4() == nil
 *         // Only compare if both are the same IP version
 *         if netIsIPv6 == machineCIDRisIPv6 { ... }
 *     }
 *
 * A provisioning CIDR of a different family from every machine network simply
 * skips every comparison and passes. No validation anywhere in
 * `pkg/types/baremetal/` requires the provisioning family to match the
 * cluster's stack mode. So the provisioning network must get its own family
 * control rather than inheriting the Networking step's choice.
 *
 * SINGLE FAMILY, NOT DUAL STACK
 *
 * `ProvisioningNetworkCIDR` is a scalar `*ipnet.IPNet`, and
 * `ClusterProvisioningIP`, `BootstrapProvisioningIP`, `ProvisioningDHCPRange`
 * and `ProvisioningNetworkGateway` are scalar strings. Contrast `APIVIPs
 * []string` / `IngressVIPs []string`, which carry
 * `+kubebuilder:validation:MaxItems=2` and the comment "In dual stack clusters
 * it contains an IPv4 and IPv6 address". The installer models dual-stack where
 * it is supported; it deliberately does not model it here. Dual-stack is
 * therefore NOT offered for this surface.
 *
 * THE /64 CONSTRAINT IS REAL AND MANAGED-ONLY
 *
 * Enforced twice upstream, in both cases gated on Managed:
 *
 *   openshift/installer `pkg/types/baremetal/validation/platform.go`
 *     validateCIDRSize(): "provisioningNetworkCIDR mask must be greater than
 *     or equal to 64 for IPv6 networks" — guarded by
 *     `p.ProvisioningNetwork == baremetal.ManagedProvisioningNetwork`,
 *     with the call-site comment "due to a dnsmasq limitation".
 *
 *   openshift/cluster-baremetal-operator
 *     `api/v1alpha1/provisioning_validation.go`: the same rule, again
 *     `&& provisioningNetworkMode == ProvisioningNetworkManaged`.
 *
 * Red Hat states it in the Provisioning API book only (Ch.13 §13.1.1): "When
 * using IPv6 and in a network managed by the Baremetal IPI solution this cannot
 * be a network larger than a /64." It is absent from the bare-metal IPI install
 * chapter at 4.20, 4.21 and 4.22.
 *
 * Unmanaged IPv6 provisioning networks shorter than /64 are accepted upstream,
 * so they are accepted here. There is no IPv4 prefix-length constraint.
 *
 * FAMILY AGREEMENT IS IMPLICIT UPSTREAM, EXPLICIT HERE
 *
 * The installer enforces family agreement through `net.IPNet.Contains`, which
 * returns false across families. That produces a correct rejection with a
 * confusing message ("not in the provisioning network") for what is really a
 * family mismatch. This module reports the mismatch as such, which is the same
 * outcome with a message a user can act on.
 */

import { isIpv4, isIpv6, parseIp, parseCidr } from "./provisioningNetworkGateway.js";

/** Families offered for the provisioning network. Dual-stack is deliberately absent. */
const PROVISIONING_IP_FAMILIES = ["ipv4", "ipv6"];

/** Minimum IPv6 prefix length for a Managed provisioning network (dnsmasq limitation). */
const MANAGED_IPV6_MIN_PREFIX = 64;

const familyLabel = (family) => (family === "ipv6" ? "IPv6" : "IPv4");

/**
 * The address family a provisioning CIDR declares.
 * @param {string} cidr
 * @returns {"ipv4"|"ipv6"|null} null when absent or unparseable
 */
function provisioningFamilyOf(cidr) {
  const parsed = parseCidr(cidr);
  if (!parsed) return null;
  return parsed.family === 6 ? "ipv6" : "ipv4";
}

/** The prefix length of a CIDR, or null when absent/unparseable. */
function prefixLengthOf(cidr) {
  const raw = String(cidr ?? "").trim();
  const slash = raw.lastIndexOf("/");
  if (slash === -1) return null;
  if (!parseCidr(raw)) return null;
  const bits = Number(raw.slice(slash + 1));
  return Number.isInteger(bits) ? bits : null;
}

/** The family of a bare address, or null when absent/unparseable. */
function addressFamilyOf(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (isIpv4(v)) return "ipv4";
  if (isIpv6(v)) return "ipv6";
  const parsed = parseIp(v);
  if (!parsed) return null;
  return parsed.family === 6 ? "ipv6" : "ipv4";
}

/**
 * Validate the provisioning network's address family and IPv6 prefix size.
 *
 * Deliberately does NOT re-check containment, DHCP ordering or the gateway's
 * relational rules — `shared/provisioningNetworkGateway.js` and the existing
 * host-inventory validation own those. This module answers one question: are
 * all the provisioning fields in the same family, and is a Managed IPv6
 * network small enough.
 *
 * Fields that are absent or unparseable are SKIPPED rather than failed: each
 * raises its own format error elsewhere, and a derived family error stacked on
 * top of it is noise.
 *
 * @param {object} args
 * @param {string} [args.provisioningNetwork] Managed | Unmanaged | Disabled
 * @param {string} [args.cidr] provisioningNetworkCIDR
 * @param {string} [args.dhcpRange] "start,end"
 * @param {string} [args.clusterProvisioningIP]
 * @param {string} [args.bootstrapProvisioningIP]
 * @param {string} [args.gateway] provisioningNetworkGateway
 * @returns {{valid: boolean, family: "ipv4"|"ipv6"|null, errors: Record<string,string>}}
 */
function validateProvisioningNetworkFamily({
  provisioningNetwork,
  cidr,
  dhcpRange,
  clusterProvisioningIP,
  bootstrapProvisioningIP,
  gateway
} = {}) {
  const errors = {};
  const family = provisioningFamilyOf(cidr);

  // Without a parseable CIDR there is no family to compare against. The CIDR's
  // own format error is raised by the caller's field validation.
  if (!family) return { valid: true, family: null, errors };

  if (family === "ipv6" && provisioningNetwork === "Managed") {
    const bits = prefixLengthOf(cidr);
    if (bits !== null && bits < MANAGED_IPV6_MIN_PREFIX) {
      errors.provisioningNetworkCIDR =
        `A Managed IPv6 provisioning network cannot be larger than a /${MANAGED_IPV6_MIN_PREFIX} ` +
        `(a dnsmasq limitation). Use /${MANAGED_IPV6_MIN_PREFIX} or longer, not /${bits}.`;
    }
  }

  const expect = (value, field, label) => {
    const actual = addressFamilyOf(value);
    if (!actual || actual === family) return;
    errors[field] =
      `${label} is ${familyLabel(actual)}, but the provisioning network CIDR is ` +
      `${familyLabel(family)}. The provisioning network is a single address family.`;
  };

  expect(clusterProvisioningIP, "clusterProvisioningIP", "Cluster provisioning IP");
  expect(bootstrapProvisioningIP, "bootstrapProvisioningIP", "Bootstrap provisioning IP");
  expect(gateway, "provisioningNetworkGateway", "Provisioning network gateway");

  const endpoints = String(dhcpRange ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const endpoint of endpoints) {
    const actual = addressFamilyOf(endpoint);
    if (!actual || actual === family) continue;
    errors.provisioningDHCPRange =
      `Provisioning DHCP range endpoint ${endpoint} is ${familyLabel(actual)}, but the ` +
      `provisioning network CIDR is ${familyLabel(family)}. The provisioning network is a ` +
      `single address family.`;
    break;
  }

  return { valid: Object.keys(errors).length === 0, family, errors };
}

/**
 * The provisioning fields whose value is bound to the selected address family.
 *
 * Mode, interface name and MAC are deliberately absent: they are family
 * agnostic and must survive a family switch untouched.
 */
const FAMILY_BOUND_PROVISIONING_FIELDS = [
  "provisioningNetworkCIDR",
  "provisioningDHCPRange",
  "clusterProvisioningIP",
  "bootstrapProvisioningIP",
  "provisioningNetworkGateway"
];

/** Where the non-selected family's values are parked. */
const PROVISIONING_DRAFT_KEY = "provisioningDraftsByFamily";

/**
 * The provisioning family currently in force.
 *
 * An explicit stored choice wins, so clearing the CIDR cannot silently snap
 * the selector back. With no stored choice — an imported run, or a
 * configuration from before the selector existed — the CIDR's own family is
 * used, so such a run opens showing the family it actually has.
 */
function selectedProvisioningFamily(hostInventory) {
  const stored = hostInventory?.provisioningNetworkIpFamily;
  if (stored === "ipv4" || stored === "ipv6") return stored;
  return provisioningFamilyOf(hostInventory?.provisioningNetworkCIDR) || "ipv4";
}

/**
 * Switch the provisioning network between IPv4 and IPv6, parking the outgoing
 * family's values and restoring the incoming family's.
 *
 * WHY DRAFTS. The provisioning network is single-family, so only one family's
 * values can ever be live. Leaving the previous family's addresses sitting in
 * the fields — which is what used to happen — meant the user had to delete
 * them by hand, and until they did, the preview and the generated bundle
 * carried values of the wrong family.
 *
 * The LIVE fields keep their existing names, so validation, generation,
 * preview, assets and the bundle all continue to read exactly one set of
 * values and needed no change. The parked draft is inert state: nothing
 * validates it, nothing generates from it, and it cannot block the current
 * configuration.
 *
 * Returns a patch for `hostInventory`. A no-op switch returns null so callers
 * can skip a pointless state write.
 *
 * @param {object} hostInventory current host-inventory state
 * @param {"ipv4"|"ipv6"} nextFamily the family being selected
 * @returns {object|null} the patch to merge, or null when nothing changes
 */
function switchProvisioningFamily(hostInventory, nextFamily) {
  if (nextFamily !== "ipv4" && nextFamily !== "ipv6") return null;
  const current = selectedProvisioningFamily(hostInventory);
  if (current === nextFamily) return null;

  const drafts = { ...(hostInventory?.[PROVISIONING_DRAFT_KEY] || {}) };

  // Park every family-bound value currently on screen.
  const outgoing = {};
  for (const field of FAMILY_BOUND_PROVISIONING_FIELDS) {
    outgoing[field] = hostInventory?.[field] ?? "";
  }
  drafts[current] = outgoing;

  // Restore the incoming family's parked values, or blank if it has none yet.
  const incoming = drafts[nextFamily] || {};
  const patch = { provisioningNetworkIpFamily: nextFamily, [PROVISIONING_DRAFT_KEY]: drafts };
  for (const field of FAMILY_BOUND_PROVISIONING_FIELDS) {
    patch[field] = incoming[field] ?? "";
  }
  return patch;
}

export {
  PROVISIONING_IP_FAMILIES,
  MANAGED_IPV6_MIN_PREFIX,
  provisioningFamilyOf,
  prefixLengthOf,
  addressFamilyOf,
  validateProvisioningNetworkFamily,
  FAMILY_BOUND_PROVISIONING_FIELDS,
  PROVISIONING_DRAFT_KEY,
  selectedProvisioningFamily,
  switchProvisioningFamily
};
