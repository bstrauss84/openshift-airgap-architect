/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Provisioning-network IP family — the UI used to make IPv6 impossible.
 *
 * Human QA 5E (7C.4): "where, pray tell, am I supposed to do that?" — asked
 * about entering an IPv6 provisioning network, followed by the deeper
 * question of whether the Networking step's IP Stack Mode should govern
 * Platform Specifics IP fields at all.
 *
 * What was actually wrong: the backend and the installer both accept an IPv6
 * provisioning network (`backend/test/t6-gateway-real-path-matrix.test.js`
 * has exercised the IPv6 Managed path for some time), but the FRONTEND
 * validation was hard-coded to IPv4 — `isValidIpv4Cidr(provisioningCIDR)`,
 * `isValidIpv4(clusterProvisioningIP)`, and a 32-bit integer DHCP-range
 * comparison that cannot represent an IPv6 address. So the UI rejected input
 * the generator would have handled.
 *
 * And the answer to the deeper question: the two are INDEPENDENT. The
 * installer only compares the provisioning CIDR against a machine network when
 * both are the same family, so a cross-family provisioning network passes.
 * Evidence is recorded in `shared/provisioningNetworkFamily.js`. These tests
 * pin that independence so a later "tidy-up" cannot couple them.
 */
import { describe, it, expect } from "vitest";
import { validateStep } from "../src/validation.js";

const BASE = {
  _schemaVersion: 3,
  version: { selectedMinor: "4.22", selectedPatch: "4.22.16", selectedChannel: "stable-4.22", locked: true },
  release: { channel: "4.22", patchVersion: "4.22.16" },
  blueprint: { platform: "Bare Metal", clusterName: "airgap", baseDomain: "example.com", arch: "x86_64" },
  methodology: { method: "IPI" }
};

const V4 = {
  provisioningNetwork: "Managed",
  provisioningNetworkCIDR: "172.22.0.0/24",
  provisioningDHCPRange: "172.22.0.10,172.22.0.100",
  clusterProvisioningIP: "172.22.0.3",
  provisioningNetworkGateway: "172.22.0.254"
};

const V6 = {
  provisioningNetwork: "Managed",
  provisioningNetworkCIDR: "fd2e:6f44:5dd8:c956::/64",
  provisioningDHCPRange: "fd2e:6f44:5dd8:c956::10,fd2e:6f44:5dd8:c956::100",
  clusterProvisioningIP: "fd2e:6f44:5dd8:c956::3",
  provisioningNetworkGateway: "fd2e:6f44:5dd8:c956::254"
};

/**
 * Run the validation that owns the provisioning-network fields.
 *
 * Note the argument order: `validateStep(state, stepId)`.
 *
 * Two steps are consulted because they surface different halves of the same
 * `validateNetworkingFormat` result: "platform-specifics" returns the
 * per-field map that feeds PlatformSpecificsStep's `fieldErrors` prop (and
 * returns no step-level errors), while "global" returns the step-level error
 * list used to gate progress. A rule is only genuinely enforced if the user
 * sees it, so both are checked.
 */
function validate(hostInventory, extra = {}) {
  const state = { ...BASE, ...extra, hostInventory: { ...hostInventory } };
  const perField = validateStep(state, "platform-specifics");
  const stepLevel = validateStep(state, "global");
  const errors = stepLevel?.errors || [];
  return {
    errors,
    fieldErrors: perField?.fieldErrors || {},
    text: errors.join(" | ")
  };
}

/** Errors mentioning the provisioning network, so unrelated step errors don't mask the result. */
const provisioningErrors = (r) => r.errors.filter((e) => /provisioning/i.test(e));

describe("the provisioning network accepts either address family", () => {
  it("accepts a complete IPv4 provisioning network", () => {
    expect(provisioningErrors(validate(V4))).toEqual([]);
  });

  it("accepts a complete IPv6 provisioning network", () => {
    // The regression: every one of these fields used to be refused.
    expect(provisioningErrors(validate(V6))).toEqual([]);
  });

  it("no longer claims an IPv6 CIDR is not a valid CIDR", () => {
    const r = validate({ ...V6 });
    expect(r.text).not.toMatch(/Provisioning network CIDR must be a valid/i);
  });

  it("no longer demands an IPv4 cluster provisioning IP", () => {
    const r = validate({ ...V6 });
    expect(r.text).not.toMatch(/Cluster provisioning IP must be a valid IPv4/i);
  });

  it("no longer demands IPv4 DHCP-range endpoints", () => {
    const r = validate({ ...V6 });
    expect(r.text).not.toMatch(/both start and end must be valid IPv4/i);
  });

  it("still rejects genuinely malformed values in either family", () => {
    const bad = validate({ ...V4, provisioningNetworkCIDR: "not-a-cidr" });
    expect(bad.fieldErrors.provisioningNetworkCIDR).toMatch(/valid IPv4 or IPv6 CIDR/i);
  });
});

describe("IPv6 relational rules are enforced, not skipped", () => {
  it("rejects an IPv6 gateway inside the IPv6 DHCP range", () => {
    const r = validate({ ...V6, provisioningNetworkGateway: "fd2e:6f44:5dd8:c956::50" });
    expect(provisioningErrors(r).length).toBeGreaterThan(0);
    expect(r.text).toMatch(/DHCP range/i);
  });

  it("rejects an IPv6 gateway outside the IPv6 CIDR", () => {
    const r = validate({ ...V6, provisioningNetworkGateway: "fd99::254" });
    expect(provisioningErrors(r).length).toBeGreaterThan(0);
  });

  it("rejects a reversed IPv6 DHCP range", () => {
    const r = validate({
      ...V6,
      provisioningDHCPRange: "fd2e:6f44:5dd8:c956::100,fd2e:6f44:5dd8:c956::10"
    });
    expect(r.fieldErrors.provisioningDHCPRange).toMatch(/less than or equal/i);
  });

  it("rejects an IPv6 cluster provisioning IP inside the DHCP range", () => {
    const r = validate({ ...V6, clusterProvisioningIP: "fd2e:6f44:5dd8:c956::50" });
    expect(r.text).toMatch(/conflicts with DHCP range/i);
  });
});

describe("the provisioning network is a single address family", () => {
  it("rejects an IPv4 cluster provisioning IP on an IPv6 network", () => {
    const r = validate({ ...V6, clusterProvisioningIP: "172.22.0.3" });
    expect(r.fieldErrors.clusterProvisioningIP).toMatch(/single address family/i);
  });

  it("rejects an IPv6 gateway on an IPv4 network", () => {
    const r = validate({ ...V4, provisioningNetworkGateway: "fd2e:6f44:5dd8:c956::254" });
    expect(provisioningErrors(r).length).toBeGreaterThan(0);
  });

  it("rejects a mixed-family DHCP range", () => {
    const r = validate({ ...V4, provisioningDHCPRange: "172.22.0.10,fd2e:6f44:5dd8:c956::100" });
    expect(r.fieldErrors.provisioningDHCPRange).toBeTruthy();
  });
});

describe("a Managed IPv6 provisioning network cannot be larger than /64", () => {
  it("rejects /48 under Managed", () => {
    const r = validate({
      provisioningNetwork: "Managed",
      provisioningNetworkCIDR: "fd2e:6f44::/48"
    });
    expect(r.fieldErrors.provisioningNetworkCIDR).toMatch(/larger than a \/64/i);
  });

  it("accepts /64 under Managed", () => {
    const r = validate({ ...V6 });
    expect(r.fieldErrors.provisioningNetworkCIDR).toBeFalsy();
  });

  it("does not apply the rule under Unmanaged — upstream gates it on Managed", () => {
    const r = validate({
      provisioningNetwork: "Unmanaged",
      provisioningNetworkCIDR: "fd2e:6f44::/48"
    });
    expect(r.fieldErrors.provisioningNetworkCIDR).toBeFalsy();
  });

  it("does not apply any prefix rule to IPv4", () => {
    const r = validate({ provisioningNetwork: "Managed", provisioningNetworkCIDR: "172.22.0.0/16" });
    expect(r.fieldErrors.provisioningNetworkCIDR).toBeFalsy();
  });
});

describe("provisioning family is independent of the cluster IP Stack Mode", () => {
  /* The human's deeper question. If these ever start failing, someone has
     coupled two networks the installer treats as unrelated. */
  const stackModes = ["ipv4", "ipv6", "dual-stack"];

  for (const ipStackMode of stackModes) {
    it(`an IPv4 provisioning network is valid with IP Stack Mode = ${ipStackMode}`, () => {
      const r = validate(V4, { globalStrategy: { networking: { ipStackMode } } });
      expect(provisioningErrors(r)).toEqual([]);
    });

    it(`an IPv6 provisioning network is valid with IP Stack Mode = ${ipStackMode}`, () => {
      const r = validate(V6, { globalStrategy: { networking: { ipStackMode } } });
      expect(provisioningErrors(r)).toEqual([]);
    });
  }
});
