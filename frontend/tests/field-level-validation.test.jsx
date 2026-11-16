/**
 * Regression tests: platform-specifics validation returns fieldErrors with
 * correct keys for AWS GovCloud, vSphere failure-domain, and Azure IPI
 * scenarios, enabling field-level error presentation in the UI.
 */
import { describe, it, expect } from "vitest";
import { validateStep } from "../src/validation.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

function makeState(platform, method, minor, platformConfig) {
  const base = stateWithBlueprintCompleteMethodologyIncomplete();
  return {
    ...base,
    blueprint: { ...base.blueprint, platform, confirmed: true },
    methodology: { method },
    version: { versionConfirmed: true, selectedMinor: minor },
    release: { channel: minor, patchVersion: minor + ".8", confirmed: true },
    platformConfig: platformConfig || {},
  };
}

describe("Field-level validation: fieldErrors keys", () => {
  describe("AWS GovCloud IPI", () => {
    it("returns awsRegion fieldError when region is missing", () => {
      const state = makeState("AWS GovCloud", "IPI", "4.21", { aws: {} });
      const result = validateStep(state, "platform-specifics");
      expect(result.fieldErrors).toBeDefined();
      expect(result.fieldErrors.awsRegion).toBeTruthy();
    });

    it("does not return awsRegion fieldError when region is provided", () => {
      const state = makeState("AWS GovCloud", "IPI", "4.21", {
        aws: { region: "us-gov-west-1" },
      });
      const result = validateStep(state, "platform-specifics");
      expect(result.fieldErrors?.awsRegion).toBeFalsy();
    });
  });

  describe("Azure Government IPI", () => {
    it("returns azureRegion fieldError when region is missing", () => {
      const state = makeState("Azure Government", "IPI", "4.21", { azure: {} });
      const result = validateStep(state, "platform-specifics");
      expect(result.fieldErrors).toBeDefined();
      expect(result.fieldErrors.azureRegion).toBeTruthy();
    });

    it("does not return azureRegion fieldError when region is provided", () => {
      const state = makeState("Azure Government", "IPI", "4.21", {
        azure: { region: "usgovvirginia" },
      });
      const result = validateStep(state, "platform-specifics");
      expect(result.fieldErrors?.azureRegion).toBeFalsy();
    });
  });

  describe("vSphere IPI failure-domain mode", () => {
    it("returns fd_0_computeCluster fieldError for invalid path", () => {
      const state = makeState("VMware vSphere", "IPI", "4.21", {
        vsphere: {
          placementMode: "failureDomains",
          failureDomains: [
            {
              name: "fd-0",
              server: "vcenter.local",
              topology: {
                datacenter: "DC1",
                computeCluster: "Cluster1",
                datastore: "/DC1/datastore/DS1",
                networks: ["VM Network"],
              },
            },
          ],
        },
      });
      const result = validateStep(state, "platform-specifics");
      expect(result.fieldErrors).toBeDefined();
      expect(result.fieldErrors.fd_0_computeCluster).toBeTruthy();
      expect(result.fieldErrors.fd_0_computeCluster).toContain("inventory path");
    });

    it("returns fd_0_datastore fieldError for invalid path", () => {
      const state = makeState("VMware vSphere", "IPI", "4.21", {
        vsphere: {
          placementMode: "failureDomains",
          failureDomains: [
            {
              name: "fd-0",
              server: "vcenter.local",
              topology: {
                datacenter: "DC1",
                computeCluster: "/DC1/host/Cluster1",
                datastore: "DS1",
                networks: ["VM Network"],
              },
            },
          ],
        },
      });
      const result = validateStep(state, "platform-specifics");
      expect(result.fieldErrors.fd_0_datastore).toBeTruthy();
    });

    it("returns fd_0_folder fieldError for invalid path", () => {
      const state = makeState("VMware vSphere", "IPI", "4.21", {
        vsphere: {
          placementMode: "failureDomains",
          failureDomains: [
            {
              name: "fd-0",
              server: "vcenter.local",
              topology: {
                datacenter: "DC1",
                computeCluster: "/DC1/host/Cluster1",
                datastore: "/DC1/datastore/DS1",
                folder: "MyFolder",
                networks: ["VM Network"],
              },
            },
          ],
        },
      });
      const result = validateStep(state, "platform-specifics");
      expect(result.fieldErrors.fd_0_folder).toBeTruthy();
    });

    it("returns no fd_0_computeCluster fieldError for valid full path", () => {
      const state = makeState("VMware vSphere", "IPI", "4.21", {
        vsphere: {
          placementMode: "failureDomains",
          failureDomains: [
            {
              name: "fd-0",
              server: "vcenter.local",
              topology: {
                datacenter: "DC1",
                computeCluster: "/DC1/host/Cluster1",
                datastore: "/DC1/datastore/DS1",
                networks: ["VM Network"],
              },
            },
          ],
        },
      });
      const result = validateStep(state, "platform-specifics");
      expect(result.fieldErrors?.fd_0_computeCluster).toBeFalsy();
      expect(result.fieldErrors?.fd_0_datastore).toBeFalsy();
    });
  });

  describe("vSphere IPI legacy mode", () => {
    it("returns legacy fieldErrors when required fields are missing", () => {
      const state = makeState("VMware vSphere", "IPI", "4.21", {
        vsphere: { placementMode: "legacy" },
      });
      const result = validateStep(state, "platform-specifics");
      expect(result.fieldErrors).toBeDefined();
      expect(result.fieldErrors.vsphereVcenter).toBeTruthy();
      expect(result.fieldErrors.vsphereLegacyDatacenter).toBeTruthy();
      expect(result.fieldErrors.vsphereLegacyCluster).toBeTruthy();
      expect(result.fieldErrors.vsphereLegacyNetwork).toBeTruthy();
    });
  });

  describe("result shape", () => {
    it("always returns fieldErrors object (even if empty) for AWS", () => {
      const state = makeState("AWS GovCloud", "IPI", "4.21", {
        aws: { region: "us-gov-west-1" },
      });
      const result = validateStep(state, "platform-specifics");
      expect(result).toHaveProperty("fieldErrors");
      expect(typeof result.fieldErrors).toBe("object");
    });

    it("always returns fieldErrors object (even if empty) for Azure", () => {
      const state = makeState("Azure Government", "IPI", "4.21", {
        azure: { region: "usgovvirginia", baseDomainResourceGroupName: "rg-1" },
      });
      const result = validateStep(state, "platform-specifics");
      expect(result).toHaveProperty("fieldErrors");
      expect(typeof result.fieldErrors).toBe("object");
    });

    it("always returns fieldErrors object (even if empty) for vSphere", () => {
      const state = makeState("VMware vSphere", "IPI", "4.21", {
        vsphere: {
          placementMode: "failureDomains",
          failureDomains: [
            {
              name: "fd-0",
              server: "vcenter.local",
              topology: {
                datacenter: "DC1",
                computeCluster: "/DC1/host/Cluster1",
                datastore: "/DC1/datastore/DS1",
                networks: ["VM Network"],
              },
            },
          ],
        },
      });
      const result = validateStep(state, "platform-specifics");
      expect(result).toHaveProperty("fieldErrors");
      expect(typeof result.fieldErrors).toBe("object");
    });
  });
});
