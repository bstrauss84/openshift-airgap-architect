/**
 * DOC-120: vSphere failure-domain inventory-path frontend validation tests.
 *
 * Authoritative source: OpenShift installer release-4.20 and release-4.21
 * pkg/types/vsphere/validation/platform.go
 *
 * computeCluster: ^/(.*?)/host/(.*?)$
 * datastore:      ^/(.*?)/datastore/(.*?)$
 * folder:         ^/(.*?)/vm/(.*?)$
 * resourcePool:   ^/(.*?)/host/(.*?)$  (more segments allowed)
 * datacenter:     short name (max 80 chars, no path validation)
 * networks:       short names (no path validation)
 *
 * Legacy placement mode: short names are valid inputs because the backend
 * converts them to full paths in generate.js. DO NOT reject legacy short names.
 */

import { describe, it, expect } from "vitest";
import { validateStep } from "../src/validation.js";

function makeVsphereIpiState(vsphereConfig) {
  return {
    blueprint: { platform: "VMware vSphere", arch: "x86_64", clusterName: "test", baseDomain: "example.com", confirmed: true },
    methodology: { method: "IPI" },
    release: { channel: "4.21", patchVersion: "4.21.8", confirmed: true },
    version: { _schemaVersion: 3, selectedMinor: "4.21", selectedPatch: "4.21.8", locked: true },
    credentials: { pullSecretPlaceholder: '{"auths":{"quay.io":{}}}', sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test" },
    platformConfig: { vsphere: vsphereConfig },
    ui: {
      segmentedFlowV1: true,
      activeStepId: "platform-specifics",
      visitedSteps: { blueprint: true, methodology: true, "identity-access": true, "platform-specifics": true },
      completedSteps: { blueprint: true, methodology: true, "identity-access": true }
    }
  };
}

function fdState(topologyOverrides) {
  return makeVsphereIpiState({
    placementMode: "failureDomains",
    username: "admin",
    password: "secret",
    failureDomains: [{
      name: "fd-0",
      server: "vcenter.example.com",
      region: "DC1",
      zone: "C1",
      topology: {
        datacenter: "DC1",
        computeCluster: "/DC1/host/Cluster1",
        datastore: "/DC1/datastore/DS1",
        networks: ["VM Network"],
        folder: "",
        resourcePool: "",
        template: "",
        ...topologyOverrides
      }
    }]
  });
}

describe("DOC-120: vSphere failure-domain inventory-path validation", () => {
  describe("computeCluster", () => {
    it("rejects short name in failure-domain mode", () => {
      const result = validateStep(fdState({ computeCluster: "Cluster1" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("computeCluster") && e.includes("full inventory path"))).toBe(true);
    });

    it("accepts valid full path", () => {
      const result = validateStep(fdState({ computeCluster: "/DC1/host/Cluster1" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("computeCluster"))).toBe(false);
    });

    it("rejects path missing /host/ segment", () => {
      const result = validateStep(fdState({ computeCluster: "/DC1/Cluster1" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("computeCluster"))).toBe(true);
    });

    it("accepts nested cluster path", () => {
      const result = validateStep(fdState({ computeCluster: "/Production-DC/host/Prod-Cluster" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("computeCluster"))).toBe(false);
    });

    it("does not validate empty computeCluster (not a path format error)", () => {
      const result = validateStep(fdState({ computeCluster: "" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("computeCluster") && e.includes("full inventory path"))).toBe(false);
    });
  });

  describe("datastore", () => {
    it("rejects short name in failure-domain mode", () => {
      const result = validateStep(fdState({ datastore: "myDatastore" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("datastore") && e.includes("full inventory path"))).toBe(true);
    });

    it("accepts valid full path", () => {
      const result = validateStep(fdState({ datastore: "/DC1/datastore/DS1" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("datastore") && e.includes("full inventory path"))).toBe(false);
    });

    it("rejects path missing /datastore/ segment", () => {
      const result = validateStep(fdState({ datastore: "/DC1/DS1" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("datastore"))).toBe(true);
    });

    it("accepts nested datastore path with special characters", () => {
      const result = validateStep(fdState({ datastore: "/Production-DC/datastore/vsan-Datastore" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("datastore") && e.includes("full inventory path"))).toBe(false);
    });
  });

  describe("folder", () => {
    it("rejects path missing /vm/ segment when provided", () => {
      const result = validateStep(fdState({ folder: "/DC1/MyFolder" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("folder"))).toBe(true);
    });

    it("accepts valid folder path", () => {
      const result = validateStep(fdState({ folder: "/DC1/vm/OpenShift" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("folder"))).toBe(false);
    });

    it("accepts nested folder path", () => {
      const result = validateStep(fdState({ folder: "/DC1/vm/Production/OCP-Cluster" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("folder"))).toBe(false);
    });

    it("does not validate empty folder (optional field)", () => {
      const result = validateStep(fdState({ folder: "" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("folder"))).toBe(false);
    });
  });

  describe("resourcePool", () => {
    it("rejects short name when provided", () => {
      const result = validateStep(fdState({ resourcePool: "MyPool" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("resourcePool"))).toBe(true);
    });

    it("accepts valid resourcePool path", () => {
      const result = validateStep(fdState({ resourcePool: "/DC1/host/Cluster1/Resources/OCP-Pool" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("resourcePool"))).toBe(false);
    });
  });

  describe("template", () => {
    it("rejects path missing /vm/ segment when provided", () => {
      const result = validateStep(fdState({ template: "/DC1/rhcos-template" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("template"))).toBe(true);
    });

    it("accepts valid template path", () => {
      const result = validateStep(fdState({ template: "/DC1/vm/rhcos-templates/rhcos-4.21" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("template"))).toBe(false);
    });
  });

  describe("fields NOT requiring path validation", () => {
    it("datacenter accepts short name (no path requirement)", () => {
      const result = validateStep(fdState({ datacenter: "MyDC" }), "platform-specifics");
      expect(result.errors.some(e => e.includes("datacenter") && e.includes("inventory path"))).toBe(false);
    });

    it("networks accepts short names (no path requirement)", () => {
      const result = validateStep(fdState({}), "platform-specifics");
      expect(result.errors.some(e => e.includes("networks") && e.includes("inventory path"))).toBe(false);
    });
  });

  describe("legacy placement mode: short names remain valid", () => {
    it("legacy cluster short name accepted (backend converts to full path)", () => {
      const state = makeVsphereIpiState({
        placementMode: "legacy",
        vcenter: "vcenter.example.com",
        datacenter: "DC1",
        cluster: "Cluster1",
        datastore: "DS1",
        network: "VM Network",
        username: "admin",
        password: "secret"
      });
      const result = validateStep(state, "platform-specifics");
      expect(result.errors.some(e => e.includes("full inventory path"))).toBe(false);
    });

    it("legacy datastore short name accepted (backend converts to full path)", () => {
      const state = makeVsphereIpiState({
        placementMode: "legacy",
        vcenter: "vcenter.example.com",
        datacenter: "DC1",
        cluster: "C1",
        datastore: "myDatastore",
        network: "VM Network",
        username: "admin",
        password: "secret"
      });
      const result = validateStep(state, "platform-specifics");
      expect(result.errors.some(e => e.includes("full inventory path"))).toBe(false);
    });
  });

  describe("multiple failure domains", () => {
    it("reports errors for each invalid FD independently", () => {
      const state = makeVsphereIpiState({
        placementMode: "failureDomains",
        username: "admin",
        password: "secret",
        failureDomains: [
          { name: "fd-0", server: "vc1", region: "DC1", zone: "C1", topology: { datacenter: "DC1", computeCluster: "ShortName", datastore: "/DC1/datastore/DS1", networks: ["net"] } },
          { name: "fd-1", server: "vc1", region: "DC2", zone: "C2", topology: { datacenter: "DC2", computeCluster: "/DC2/host/C2", datastore: "BadDS", networks: ["net"] } }
        ]
      });
      const result = validateStep(state, "platform-specifics");
      expect(result.errors.some(e => e.includes("fd-0") && e.includes("computeCluster"))).toBe(true);
      expect(result.errors.some(e => e.includes("fd-1") && e.includes("datastore"))).toBe(true);
      expect(result.errors.some(e => e.includes("fd-0") && e.includes("datastore"))).toBe(false);
      expect(result.errors.some(e => e.includes("fd-1") && e.includes("computeCluster"))).toBe(false);
    });
  });
});
