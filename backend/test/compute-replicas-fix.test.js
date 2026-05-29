/**
 * Compute Replicas Fix Tests
 *
 * Tests that compute (worker) replicas field correctly flows from frontend state
 * to YAML output for all IPI scenarios without host inventory.
 *
 * Bug: vSphere IPI, Azure Government IPI, and IBM Cloud IPI were not using
 * platformConfig.computeReplicas, causing worker count to be 0 in generated YAML.
 *
 * Fix: Added logic to use platformConfig.computeReplicas for all IPI scenarios
 * without host inventory (vSphere IPI, Azure IPI, IBM Cloud IPI).
 *
 * Created: 2026-05-28
 * Author: Bill Strauss
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildInstallConfig } from "../src/generate.js";

describe("Compute Replicas Fix", () => {
  const baseState = {
    blueprint: {
      platform: "vSphere",
      clusterName: "test-cluster",
      baseDomain: "example.com",
      arch: "amd64"
    },
    methodology: {
      method: "IPI"
    },
    globalStrategy: {
      networking: {
        networkType: "OVNKubernetes",
        machineNetworkV4: "10.0.0.0/24"
      }
    },
    hostInventory: {
      nodes: [] // No host inventory for IPI
    },
    platformConfig: {}
  };

  describe("vSphere IPI", () => {
    it("should use platformConfig.computeReplicas for worker count", () => {
      const state = {
        ...baseState,
        platformConfig: {
          controlPlaneReplicas: 3,
          computeReplicas: 5
        }
      };

      const yaml = buildInstallConfig(state);

      assert.match(yaml, new RegExp("compute:"));
      assert.match(yaml, new RegExp("replicas: 5"));
      assert.match(yaml, new RegExp("controlPlane:"));
      assert.match(yaml, new RegExp("replicas: 3"));
    });

    it("should default to 3 workers if computeReplicas not specified", () => {
      const state = {
        ...baseState,
        platformConfig: {
          controlPlaneReplicas: 3
        }
      };

      const yaml = buildInstallConfig(state);

      assert.match(yaml, new RegExp("compute:"));
      assert.match(yaml, new RegExp("replicas: 3"));
    });

    it("should allow 0 workers for compact cluster", () => {
      const state = {
        ...baseState,
        platformConfig: {
          controlPlaneReplicas: 3,
          computeReplicas: 0
        }
      };

      const yaml = buildInstallConfig(state);

      assert.match(yaml, new RegExp("compute:"));
      assert.match(yaml, new RegExp("replicas: 0"));
    });

    it("should allow 1 control plane + 0 workers for SNO", () => {
      const state = {
        ...baseState,
        platformConfig: {
          controlPlaneReplicas: 1,
          computeReplicas: 0
        }
      };

      const yaml = buildInstallConfig(state);

      assert.match(yaml, new RegExp("controlPlane:"));
      assert.match(yaml, new RegExp("replicas: 1"));
      assert.match(yaml, new RegExp("compute:"));
      assert.match(yaml, new RegExp("replicas: 0"));
    });

    it("should support large worker counts", () => {
      const state = {
        ...baseState,
        platformConfig: {
          controlPlaneReplicas: 3,
          computeReplicas: 20
        }
      };

      const yaml = buildInstallConfig(state);

      assert.match(yaml, new RegExp("replicas: 20"));
    });
  });

  describe("Azure Government IPI", () => {
    it("should use platformConfig.computeReplicas for worker count", () => {
      const state = {
        ...baseState,
        blueprint: {
          ...baseState.blueprint,
          platform: "Azure Government"
        },
        platformConfig: {
          controlPlaneReplicas: 3,
          computeReplicas: 4
        }
      };

      const yaml = buildInstallConfig(state);

      assert.match(yaml, new RegExp("compute:"));
      assert.match(yaml, new RegExp("replicas: 4"));
    });

    it("should default to 3 workers if computeReplicas not specified", () => {
      const state = {
        ...baseState,
        blueprint: {
          ...baseState.blueprint,
          platform: "Azure Government"
        },
        platformConfig: {}
      };

      const yaml = buildInstallConfig(state);

      assert.match(yaml, new RegExp("compute:"));
      assert.match(yaml, new RegExp("replicas: 3"));
    });
  });

  describe("IBM Cloud IPI", () => {
    it("should use platformConfig.computeReplicas for worker count", () => {
      const state = {
        ...baseState,
        blueprint: {
          ...baseState.blueprint,
          platform: "IBM Cloud"
        },
        platformConfig: {
          controlPlaneReplicas: 3,
          computeReplicas: 6
        }
      };

      const yaml = buildInstallConfig(state);

      assert.match(yaml, new RegExp("compute:"));
      assert.match(yaml, new RegExp("replicas: 6"));
    });

    it("should default to 3 workers if computeReplicas not specified", () => {
      const state = {
        ...baseState,
        blueprint: {
          ...baseState.blueprint,
          platform: "IBM Cloud"
        },
        platformConfig: {}
      };

      const yaml = buildInstallConfig(state);

      assert.match(yaml, new RegExp("compute:"));
      assert.match(yaml, new RegExp("replicas: 3"));
    });
  });

  describe("Existing scenarios still work", () => {
    it("AWS GovCloud IPI should still use platformConfig.computeReplicas", () => {
      const state = {
        ...baseState,
        blueprint: {
          ...baseState.blueprint,
          platform: "AWS GovCloud"
        },
        platformConfig: {
          computeReplicas: 7
        }
      };

      const yaml = buildInstallConfig(state);

      assert.match(yaml, new RegExp("compute:"));
      assert.match(yaml, new RegExp("replicas: 7"));
    });

    it("Nutanix IPI should still use platformConfig.computeReplicas", () => {
      const state = {
        ...baseState,
        blueprint: {
          ...baseState.blueprint,
          platform: "Nutanix"
        },
        platformConfig: {
          nutanixTopology: "ha",
          computeReplicas: 8
        }
      };

      const yaml = buildInstallConfig(state);

      assert.match(yaml, new RegExp("compute:"));
      assert.match(yaml, new RegExp("replicas: 8"));
    });

    it("bare-metal-ipi with host inventory should use node count", () => {
      const state = {
        ...baseState,
        blueprint: {
          ...baseState.blueprint,
          platform: "Bare Metal"
        },
        hostInventory: {
          nodes: [
            { role: "master" },
            { role: "master" },
            { role: "master" },
            { role: "worker" },
            { role: "worker" }
          ]
        },
        platformConfig: {
          computeReplicas: 99 // Should be ignored - node count takes precedence
        }
      };

      const yaml = buildInstallConfig(state);

      assert.match(yaml, new RegExp("compute:"));
      assert.match(yaml, new RegExp("replicas: 2")); // 2 workers from nodes, not 99
    });
  });

  describe("Edge cases", () => {
    it("should handle undefined computeReplicas", () => {
      const state = {
        ...baseState,
        platformConfig: {
          controlPlaneReplicas: 3,
          computeReplicas: undefined
        }
      };

      const yaml = buildInstallConfig(state);
      assert.match(yaml, new RegExp("replicas: 3")); // Default
    });

    it("should handle null computeReplicas", () => {
      const state = {
        ...baseState,
        platformConfig: {
          controlPlaneReplicas: 3,
          computeReplicas: null
        }
      };

      const yaml = buildInstallConfig(state);
      assert.match(yaml, new RegExp("replicas: 3")); // Default
    });

    it("should handle string computeReplicas (convert to number)", () => {
      const state = {
        ...baseState,
        platformConfig: {
          controlPlaneReplicas: 3,
          computeReplicas: "10"
        }
      };

      const yaml = buildInstallConfig(state);

      assert.match(yaml, new RegExp("replicas: 10"));
    });
  });
});
