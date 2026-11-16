/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Switching the provisioning network's address family must swap drafts, not
 * leave the previous family's addresses in the fields.
 *
 * Human QA A7 (7C.4B): with IPv4 provisioning values entered, selecting IPv6
 * left every IPv4 value sitting in the fields until deleted by hand — and
 * until then the preview, assets and bundle all carried values of the wrong
 * family.
 *
 * Contract:
 *   - the outgoing family's values are parked, not destroyed;
 *   - the incoming family's fields are blank the first time, and restored on
 *     any later return;
 *   - only the SELECTED family validates, generates and appears in output;
 *   - the parked draft is inert — it cannot validate, generate or block;
 *   - family-agnostic fields (mode, interface, MAC) are untouched;
 *   - the behaviour holds in Managed, Unmanaged and Disabled.
 */
import { describe, it, expect } from "vitest";
import yaml from "../../backend/node_modules/js-yaml/index.js";
import {
  selectedProvisioningFamily,
  switchProvisioningFamily,
  PROVISIONING_DRAFT_KEY
} from "../../shared/provisioningNetworkFamily.js";
import { validateStep } from "../src/validation.js";
import { buildInstallConfig } from "../../backend/src/generate.js";
import { bareMetalIpi } from "../../e2e/fixtures/scenarios.js";

const V4 = {
  provisioningNetworkCIDR: "172.22.0.0/24",
  provisioningDHCPRange: "172.22.0.10,172.22.0.100",
  clusterProvisioningIP: "172.22.0.3",
  provisioningNetworkGateway: "172.22.0.254"
};
const V6 = {
  provisioningNetworkCIDR: "fd2e:6f44:5dd8:c956::/64",
  provisioningDHCPRange: "fd2e:6f44:5dd8:c956::10,fd2e:6f44:5dd8:c956::100",
  clusterProvisioningIP: "fd2e:6f44:5dd8:c956::3",
  provisioningNetworkGateway: "fd2e:6f44:5dd8:c956::254"
};

const FAMILY_FIELDS = Object.keys(V4);

/** Host inventory as the UI holds it. */
const inventory = (mode, values) => ({
  provisioningNetwork: mode,
  provisioningNetworkInterface: "eno1",
  provisioningMACAddress: "52:54:00:00:00:01",
  ...values
});

/** Apply a family switch the way the step's onChange does. */
function switchTo(hi, family) {
  const patch = switchProvisioningFamily(hi, family);
  return patch ? { ...hi, ...patch } : hi;
}

/** Generated platform.baremetal for this host inventory at 4.22. */
function generated(hi) {
  const state = bareMetalIpi();
  state.release = { channel: "4.22", patchVersion: "4.22.16" };
  state.version = {
    selectedMinor: "4.22",
    selectedPatch: "4.22.16",
    selectedChannel: "stable-4.22",
    locked: true
  };
  state.hostInventory = { ...(state.hostInventory || {}), ...hi };
  return yaml.load(buildInstallConfig(state))?.platform?.baremetal || {};
}

/** Step validation for this host inventory at 4.22 bare-metal IPI. */
function validate(hi) {
  const state = {
    _schemaVersion: 3,
    release: { channel: "4.22", patchVersion: "4.22.16" },
    version: { selectedMinor: "4.22", selectedPatch: "4.22.16", selectedChannel: "stable-4.22", locked: true },
    blueprint: { platform: "Bare Metal", clusterName: "c", baseDomain: "example.com", arch: "x86_64" },
    methodology: { method: "IPI" },
    hostInventory: hi
  };
  return {
    errors: validateStep(state, "global").errors || [],
    fieldErrors: validateStep(state, "platform-specifics").fieldErrors || {}
  };
}

describe("the selected family is explicit once chosen", () => {
  it("defaults to IPv4 with nothing configured", () => {
    expect(selectedProvisioningFamily({})).toBe("ipv4");
  });

  it("an imported run with no stored choice opens on the family its CIDR has", () => {
    expect(selectedProvisioningFamily({ provisioningNetworkCIDR: "fd2e::/64" })).toBe("ipv6");
  });

  it("an explicit choice survives the CIDR being cleared", () => {
    // Otherwise clearing the field would snap the selector back underneath the user.
    expect(
      selectedProvisioningFamily({ provisioningNetworkIpFamily: "ipv6", provisioningNetworkCIDR: "" })
    ).toBe("ipv6");
  });

  it("switching to the family already selected is a no-op", () => {
    expect(switchProvisioningFamily(inventory("Managed", V4), "ipv4")).toBeNull();
  });
});

describe("IPv4 -> IPv6 -> IPv4 -> IPv6 round trip", () => {
  it("the first switch to IPv6 blanks every family-bound field", () => {
    const after = switchTo(inventory("Managed", V4), "ipv6");
    for (const field of FAMILY_FIELDS) expect(after[field]).toBe("");
  });

  it("the first switch leaves family-agnostic fields alone", () => {
    const after = switchTo(inventory("Managed", V4), "ipv6");
    expect(after.provisioningNetwork).toBe("Managed");
    expect(after.provisioningNetworkInterface).toBe("eno1");
    expect(after.provisioningMACAddress).toBe("52:54:00:00:00:01");
  });

  it("generation carries no stale IPv4 value after switching to IPv6", () => {
    // The actual defect: the bundle used to carry the wrong family's values.
    const after = switchTo(inventory("Managed", V4), "ipv6");
    const bm = generated(after);
    for (const field of FAMILY_FIELDS) expect(bm[field]).toBeUndefined();
    expect(JSON.stringify(bm)).not.toContain("172.22.0.");
  });

  it("returning to IPv4 restores exactly what was entered", () => {
    let hi = switchTo(inventory("Managed", V4), "ipv6");
    hi = { ...hi, ...V6 };
    hi = switchTo(hi, "ipv4");
    for (const field of FAMILY_FIELDS) expect(hi[field]).toBe(V4[field]);
  });

  it("returning to IPv6 restores the IPv6 values entered earlier", () => {
    let hi = switchTo(inventory("Managed", V4), "ipv6");
    hi = { ...hi, ...V6 };
    hi = switchTo(hi, "ipv4");
    hi = switchTo(hi, "ipv6");
    for (const field of FAMILY_FIELDS) expect(hi[field]).toBe(V6[field]);
  });

  it("generation follows the selected family through the whole round trip", () => {
    let hi = switchTo(inventory("Managed", V4), "ipv6");
    hi = { ...hi, ...V6 };
    expect(generated(hi).provisioningNetworkCIDR).toBe(V6.provisioningNetworkCIDR);
    hi = switchTo(hi, "ipv4");
    expect(generated(hi).provisioningNetworkCIDR).toBe(V4.provisioningNetworkCIDR);
    hi = switchTo(hi, "ipv6");
    expect(generated(hi).provisioningNetworkCIDR).toBe(V6.provisioningNetworkCIDR);
  });
});

describe("the parked draft is inert", () => {
  it("it never reaches the generated install-config", () => {
    let hi = switchTo(inventory("Managed", V4), "ipv6");
    hi = { ...hi, ...V6 };
    const text = JSON.stringify(generated(hi));
    expect(text).not.toContain("172.22.0.");
    expect(hi[PROVISIONING_DRAFT_KEY].ipv4.provisioningNetworkCIDR).toBe(V4.provisioningNetworkCIDR);
  });

  it("an INVALID parked value cannot block the current family", () => {
    // Park a gateway outside its CIDR, then switch away from it.
    let hi = inventory("Managed", { ...V4, provisioningNetworkGateway: "10.0.0.1" });
    expect(validate(hi).errors.some((e) => /provisioning/i.test(e))).toBe(true);
    hi = switchTo(hi, "ipv6");
    hi = { ...hi, ...V6 };
    expect(validate(hi).errors.filter((e) => /provisioning/i.test(e))).toEqual([]);
  });

  it("validation follows the selected family only", () => {
    /* An IPv4 gateway on the now-selected IPv6 network must be refused. Two
       rules catch it — CIDR containment and the family check — and
       containment reports first; the contract is the rejection, not which
       message wins the field slot. Message-level coverage of the family rule
       is in provisioning-network-ip-family.test.js. */
    let hi = switchTo(inventory("Managed", V4), "ipv6");
    hi = { ...hi, ...V6, provisioningNetworkGateway: "172.22.0.254" };
    const r = validate(hi);
    expect(r.fieldErrors.provisioningNetworkGateway).toBeTruthy();
    expect(r.errors.some((e) => /gateway/i.test(e))).toBe(true);
  });

  it("the SAME value is accepted once its own family is selected again", () => {
    // Proves the rejection above is about family, not about the value itself.
    let hi = switchTo(inventory("Managed", V4), "ipv6");
    hi = switchTo(hi, "ipv4");
    expect(hi.provisioningNetworkGateway).toBe("172.22.0.254");
    expect(validate(hi).errors.filter((e) => /provisioning/i.test(e))).toEqual([]);
  });
});

describe("drafts survive mode changes and state round trips", () => {
  for (const mode of ["Managed", "Unmanaged", "Disabled"]) {
    it(`${mode}: a family switch blanks and restores the same way`, () => {
      let hi = switchTo(inventory(mode, V4), "ipv6");
      expect(hi.provisioningNetworkCIDR).toBe("");
      hi = switchTo(hi, "ipv4");
      expect(hi.provisioningNetworkCIDR).toBe(V4.provisioningNetworkCIDR);
      expect(hi.provisioningNetwork).toBe(mode);
    });
  }

  it("changing provisioning mode does not destroy either draft", () => {
    let hi = switchTo(inventory("Managed", V4), "ipv6");
    hi = { ...hi, ...V6 };
    hi = { ...hi, provisioningNetwork: "Disabled" };
    hi = { ...hi, provisioningNetwork: "Managed" };
    expect(hi[PROVISIONING_DRAFT_KEY].ipv4.provisioningNetworkCIDR).toBe(V4.provisioningNetworkCIDR);
    hi = switchTo(hi, "ipv4");
    expect(hi.provisioningNetworkCIDR).toBe(V4.provisioningNetworkCIDR);
  });

  it("a JSON state round trip does not collapse the two drafts", () => {
    // Export/import and the /api/state round trip are both JSON.
    let hi = switchTo(inventory("Managed", V4), "ipv6");
    hi = { ...hi, ...V6 };
    const revived = JSON.parse(JSON.stringify(hi));
    expect(selectedProvisioningFamily(revived)).toBe("ipv6");
    expect(revived.provisioningNetworkCIDR).toBe(V6.provisioningNetworkCIDR);
    const back = switchTo(revived, "ipv4");
    expect(back.provisioningNetworkCIDR).toBe(V4.provisioningNetworkCIDR);
  });
});
