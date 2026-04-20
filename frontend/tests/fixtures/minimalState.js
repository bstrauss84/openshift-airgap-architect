/**
 * Minimal state fixture for tests. Matches shape expected by App/store.
 * Use for Continue-resume and step visibility tests.
 */
export function stateWithBlueprintCompleteMethodologyIncomplete() {
  return {
    blueprint: {
      arch: "x86_64",
      platform: "Bare Metal",
      clusterName: "test-cluster",
      baseDomain: "example.com",
      confirmed: true,
      confirmationTimestamp: Date.now()
    },
    release: { channel: "4.15", patchVersion: "4.15.0", confirmed: true },
    version: { versionConfirmed: true },
    methodology: { method: "Agent-Based Installer" },
    globalStrategy: {
      networking: {},
      mirroring: {
        registryFqdn: "registry.local:5000",
        sources: [
          { source: "quay.io/openshift-release-dev/ocp-release", mirrors: ["registry.local:5000/ocp-release"] }
        ]
      }
    },
    hostInventory: { nodes: [], schemaVersion: 2 },
    operators: { selected: [], catalogs: {} },
    credentials: {},
    trust: {},
    platformConfig: {},
    reviewFlags: {},
    docs: { connectivity: "fully-disconnected" },
    ui: {
      activeStepId: "blueprint",
      segmentedFlowV1: false,
      visitedSteps: { blueprint: true },
      completedSteps: { blueprint: true }
    }
  };
}
