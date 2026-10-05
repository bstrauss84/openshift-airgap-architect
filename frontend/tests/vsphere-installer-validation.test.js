/**
 * OpenShift Airgap Architect - Test Suite
 *
 * R4: vSphere validation against the OpenShift installer contract.
 *
 * Authority (verified against actual source, not documentation):
 *   openshift/installer release-4.20 and release-4.21
 *     pkg/types/vsphere/validation/platform.go
 *       validateVCenters()       -> server required + validate.Host()
 *       validateFailureDomains() -> server required + validate.Host() + must
 *                                   exist in vcenters; zone/region required;
 *                                   datastore/computeCluster/folder full paths;
 *                                   datastore+folder must contain datacenter;
 *                                   networks required, max 10
 *     pkg/validate/validate.go
 *       Host(v) = net.ParseIP(v) != nil || IsDNS1123Subdomain(v)
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from "vitest";
import { isValidVsphereHost, validateStep } from "../src/validation.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

const VCENTER = "vcenter.example.com";

function fd(overrides = {}, topoOverrides = {}) {
  return {
    name: "fd-0",
    region: "region-a",
    zone: "zone-a",
    server: VCENTER,
    topology: {
      datacenter: "Datacenter1",
      computeCluster: "/Datacenter1/host/Cluster1",
      datastore: "/Datacenter1/datastore/DS1",
      networks: ["VM Network"],
      folder: "",
      resourcePool: "",
      template: "",
      ...topoOverrides
    },
    ...overrides
  };
}

function vsphereState(vsphereOverrides = {}) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    blueprint: { ...base.blueprint, platform: "VMware vSphere" },
    methodology: { method: "IPI" },
    credentials: {
      pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
      sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test"
    },
    platformConfig: {
      vsphere: {
        vcenter: VCENTER,
        username: "administrator@vsphere.local",
        password: "secret",
        placementMode: "failureDomains",
        failureDomains: [fd()],
        ...vsphereOverrides
      }
    }
  };
}

function errorsFor(state) {
  const r = validateStep(state, "platform-specifics");
  return { errors: r.errors || [], fieldErrors: r.fieldErrors || {} };
}

describe("R4: validate.Host contract (installer pkg/validate/validate.go)", () => {
  it("accepts a normal FQDN", () => {
    expect(isValidVsphereHost("vcenter.example.com")).toBe(true);
  });

  it("accepts an IPv4 address", () => {
    expect(isValidVsphereHost("192.168.1.10")).toBe(true);
  });

  it("accepts an IPv6 address", () => {
    expect(isValidVsphereHost("2001:db8::1")).toBe(true);
  });

  it("accepts a single-label hostname with no dot (installer permits it)", () => {
    // IsDNS1123Subdomain allows a single label. A naive FQDN regex would
    // wrongly reject this, which the installer would have accepted.
    expect(isValidVsphereHost("vcenter")).toBe(true);
  });

  it("accepts an all-numeric multi-label name (odd-looking but DNS-1123 valid)", () => {
    expect(isValidVsphereHost("1.2.3.4.5")).toBe(true);
  });

  it("accepts hyphens inside labels", () => {
    expect(isValidVsphereHost("vc-01.sub-domain.example.com")).toBe(true);
  });

  it("rejects uppercase (DNS-1123 is lowercase only)", () => {
    expect(isValidVsphereHost("VCenter.Example.COM")).toBe(false);
  });

  it("rejects a leading or trailing hyphen in a label", () => {
    expect(isValidVsphereHost("-vcenter.example.com")).toBe(false);
    expect(isValidVsphereHost("vcenter-.example.com")).toBe(false);
  });

  it("rejects spaces, underscores and schemes", () => {
    expect(isValidVsphereHost("vcenter .example.com")).toBe(false);
    expect(isValidVsphereHost("vcenter_01.example.com")).toBe(false);
    expect(isValidVsphereHost("https://vcenter.example.com")).toBe(false);
  });

  it("rejects blank and over-long names", () => {
    expect(isValidVsphereHost("")).toBe(false);
    expect(isValidVsphereHost("   ")).toBe(false);
    expect(isValidVsphereHost("a".repeat(254))).toBe(false);
  });

  it("rejects an out-of-range IPv4 octet", () => {
    expect(isValidVsphereHost("999.1.1.1")).toBe(false);
  });
});

describe("R4: vCenter server field validation", () => {
  it("blank vCenter server produces a visible field error", () => {
    const { errors, fieldErrors } = errorsFor(vsphereState({ vcenter: "" }));
    expect(fieldErrors.vsphereVcenter).toBeTruthy();
    expect(errors.some((e) => /vCenter server is required/i.test(e))).toBe(true);
  });

  it("malformed vCenter server produces a visible field error", () => {
    const { errors, fieldErrors } = errorsFor(vsphereState({ vcenter: "not a host!" }));
    expect(fieldErrors.vsphereVcenter).toBeTruthy();
    // Wording must advertise the installer's actual contract (validate.Host
    // accepts single-label hostnames), not an FQDN/IP-only promise.
    expect(errors.some((e) => /hostname, FQDN, or IP address/i.test(e))).toBe(true);
  });

  it("valid FQDN vCenter produces no vCenter field error", () => {
    const { fieldErrors } = errorsFor(vsphereState());
    expect(fieldErrors.vsphereVcenter).toBeFalsy();
  });

  it("valid IP vCenter produces no vCenter field error", () => {
    const state = vsphereState({ vcenter: "192.168.1.10", failureDomains: [fd({ server: "192.168.1.10" })] });
    const { fieldErrors } = errorsFor(state);
    expect(fieldErrors.vsphereVcenter).toBeFalsy();
  });
});

describe("R4: failure-domain server semantics", () => {
  it("blank failure-domain server is rejected", () => {
    const { fieldErrors } = errorsFor(vsphereState({ failureDomains: [fd({ server: "" })] }));
    expect(fieldErrors.fd_0_server).toBeTruthy();
  });

  it("malformed failure-domain server is rejected", () => {
    const { fieldErrors } = errorsFor(vsphereState({ failureDomains: [fd({ server: "bad host" })] }));
    expect(fieldErrors.fd_0_server).toBeTruthy();
  });

  it("failure-domain server not matching a configured vCenter is rejected", () => {
    const { errors, fieldErrors } = errorsFor(vsphereState({ failureDomains: [fd({ server: "other.example.com" })] }));
    expect(fieldErrors.fd_0_server).toBeTruthy();
    expect(errors.some((e) => /does not exist in vcenters/i.test(e))).toBe(true);
  });

  it("failure-domain server matching the configured vCenter is accepted", () => {
    const { fieldErrors } = errorsFor(vsphereState());
    expect(fieldErrors.fd_0_server).toBeFalsy();
  });
});

describe("R4: failure-domain region/zone requiredness", () => {
  it("missing region is rejected", () => {
    const { fieldErrors } = errorsFor(vsphereState({ failureDomains: [fd({ region: "" })] }));
    expect(fieldErrors.fd_0_region).toBeTruthy();
  });

  it("missing zone is rejected", () => {
    const { fieldErrors } = errorsFor(vsphereState({ failureDomains: [fd({ zone: "" })] }));
    expect(fieldErrors.fd_0_zone).toBeTruthy();
  });
});

describe("R4: topology path and network rules still hold", () => {
  it("short computeCluster name is still rejected (existing behavior preserved)", () => {
    const { fieldErrors } = errorsFor(vsphereState({ failureDomains: [fd({}, { computeCluster: "Cluster1" })] }));
    expect(fieldErrors.fd_0_computeCluster).toBeTruthy();
  });

  it("short datastore name is still rejected (existing behavior preserved)", () => {
    const { fieldErrors } = errorsFor(vsphereState({ failureDomains: [fd({}, { datastore: "DS1" })] }));
    expect(fieldErrors.fd_0_datastore).toBeTruthy();
  });

  it("full valid paths produce no path errors", () => {
    const { fieldErrors } = errorsFor(vsphereState());
    expect(fieldErrors.fd_0_computeCluster).toBeFalsy();
    expect(fieldErrors.fd_0_datastore).toBeFalsy();
  });

  it("datastore in the wrong datacenter is rejected", () => {
    const { errors } = errorsFor(vsphereState({ failureDomains: [fd({}, { datastore: "/OtherDC/datastore/DS1" })] }));
    expect(errors.some((e) => /does not exist in the correct datacenter/i.test(e))).toBe(true);
  });

  it("folder in the wrong datacenter is rejected", () => {
    const { errors } = errorsFor(vsphereState({ failureDomains: [fd({}, { folder: "/OtherDC/vm/OpenShift" })] }));
    expect(errors.some((e) => /folder defined does not exist in the correct datacenter/i.test(e))).toBe(true);
  });

  it("a valid folder under the right datacenter is accepted", () => {
    const { fieldErrors } = errorsFor(vsphereState({ failureDomains: [fd({}, { folder: "/Datacenter1/vm/OpenShift" })] }));
    expect(fieldErrors.fd_0_folder).toBeFalsy();
  });

  it("more than 10 networks is rejected (installer caps at 10)", () => {
    const many = Array.from({ length: 11 }, (_, i) => `net-${i}`);
    const { fieldErrors } = errorsFor(vsphereState({ failureDomains: [fd({}, { networks: many })] }));
    expect(fieldErrors.fd_0_networks).toBeTruthy();
  });

  it("exactly 10 networks is accepted", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `net-${i}`);
    const { fieldErrors } = errorsFor(vsphereState({ failureDomains: [fd({}, { networks: ten })] }));
    expect(fieldErrors.fd_0_networks).toBeFalsy();
  });
});

describe("R4: 4.20 and 4.21 share the same vSphere platform contract", () => {
  // The only validateFailureDomains/validateVCenters differences between
  // release-4.20 and release-4.21 are the template/clusterOSImage mutual
  // exclusion and dnsRecordsType, not the field rules exercised here.
  for (const minor of ["4.20", "4.21"]) {
    it(`rejects a malformed vCenter server on ${minor}`, () => {
      const base = vsphereState();
      const state = {
        ...base,
        version: { _schemaVersion: 3, selectedMinor: minor, selectedPatch: `${minor}.1`, locked: true },
        release: { channel: `stable-${minor}`, patchVersion: `${minor}.1`, confirmed: true },
        platformConfig: { vsphere: { ...base.platformConfig.vsphere, vcenter: "BAD HOST" } }
      };
      expect(errorsFor(state).fieldErrors.vsphereVcenter).toBeTruthy();
    });

    it(`accepts a valid configuration on ${minor}`, () => {
      const base = vsphereState();
      const state = {
        ...base,
        version: { _schemaVersion: 3, selectedMinor: minor, selectedPatch: `${minor}.1`, locked: true },
        release: { channel: `stable-${minor}`, patchVersion: `${minor}.1`, confirmed: true }
      };
      const { fieldErrors } = errorsFor(state);
      expect(fieldErrors.vsphereVcenter).toBeFalsy();
      expect(fieldErrors.fd_0_server).toBeFalsy();
    });
  }
});
