import { describe, it, expect } from "vitest";
import { validateStep } from "../src/validation.js";

describe("validateVipsInMachineNetwork via validateStep", () => {
  it("vsphere-ipi: errors when VIPs are outside machine network", () => {
    const state = {
      blueprint: { platform: "VMware vSphere" },
      methodology: { method: "IPI" },
      globalStrategy: { networking: { machineNetworkV4: "10.0.0.0/24" } },
      platformConfig: {
        vsphere: {
          apiVIPs: ["192.168.1.10"],
          ingressVIPs: ["192.168.1.11"]
        }
      },
      credentials: {}
    };
    const result = validateStep(state, "networking-v2");
    expect(result.errors.some((e) => e.includes("API VIPs must be within the machine network"))).toBe(true);
    expect(result.errors.some((e) => e.includes("Ingress VIPs must be within the machine network"))).toBe(true);
  });

  it("vsphere-upi: vSphere VIP-in-machine-network validation does not run (UPI uses top-level networking VIPs)", () => {
    const state = {
      blueprint: { platform: "VMware vSphere" },
      methodology: { method: "UPI" },
      globalStrategy: { networking: { machineNetworkV4: "10.0.0.0/24" } },
      platformConfig: {
        vsphere: {
          apiVIPs: ["192.168.1.10"],
          ingressVIPs: ["192.168.1.11"]
        }
      },
      credentials: {}
    };
    const result = validateStep(state, "networking-v2");
    expect(result.errors.some((e) => e.includes("API VIPs must be within the machine network"))).toBe(false);
    expect(result.errors.some((e) => e.includes("Ingress VIPs must be within the machine network"))).toBe(false);
  });
});

