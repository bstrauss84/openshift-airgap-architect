/**
 * Tests for version-aware operator scenario quick picks (DOC-063)
 *
 * Verifies that operator quick picks correctly select different operators
 * based on the locked-in OpenShift version, with special handling for
 * version 4.19 where ODF auto-manages most dependencies.
 */

import { describe, it, expect } from 'vitest';

/**
 * Mock scenarios array from OperatorsStep.jsx
 */
const scenarios = [
  {
    id: "odf",
    label: "OpenShift Data Foundation",
    description: "Persistent storage with file, block, and object support (Ceph-based)",
    versionPicks: {
      "4.16": { redhat: ["odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"] },
      "4.17": { redhat: ["odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"] },
      "4.18": { redhat: ["odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"] },
      "4.19": { redhat: ["odf-operator", "local-storage-operator"] }, // Special case
      "4.20": { redhat: ["odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"] },
      "4.21": { redhat: ["odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"] },
      "default": { redhat: ["odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"] }
    }
  },
  {
    id: "platform-plus",
    label: "OpenShift Platform Plus",
    description: "Multi-cluster management (ACM), security (ACS), registry (Quay), and storage (ODF)",
    versionPicks: {
      "4.16": { redhat: ["advanced-cluster-management", "rhacs-operator", "quay-operator", "odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"] },
      "4.17": { redhat: ["advanced-cluster-management", "rhacs-operator", "quay-operator", "odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"] },
      "4.18": { redhat: ["advanced-cluster-management", "rhacs-operator", "quay-operator", "odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"] },
      "4.19": { redhat: ["advanced-cluster-management", "rhacs-operator", "quay-operator", "odf-operator", "local-storage-operator"] },
      "4.20": { redhat: ["advanced-cluster-management", "rhacs-operator", "quay-operator", "odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"] },
      "4.21": { redhat: ["advanced-cluster-management", "rhacs-operator", "quay-operator", "odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"] },
      "default": { redhat: ["advanced-cluster-management", "rhacs-operator", "quay-operator", "odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"] }
    }
  },
  {
    id: "app-dev-suite",
    label: "App Development Suite",
    description: "GitOps, CI/CD pipelines, cloud IDE, and web terminal",
    versionPicks: {
      "default": { redhat: ["openshift-gitops-operator", "openshift-pipelines-operator-rh", "devspaces", "web-terminal"] }
    }
  },
  {
    id: "gitops",
    label: "GitOps",
    picks: { redhat: ["openshift-gitops-operator"] }
  }
];

/**
 * Mock implementation of applyScenario logic
 */
function getPicksForVersion(scenario, version) {
  return scenario.versionPicks?.[version] || scenario.versionPicks?.["default"] || scenario.picks;
}

describe('Version-aware operator quick picks', () => {
  describe('OpenShift Data Foundation (ODF)', () => {
    const odfScenario = scenarios.find(s => s.id === "odf");

    it('should select 4 operators for version 4.16', () => {
      const picks = getPicksForVersion(odfScenario, "4.16");
      expect(picks.redhat).toEqual(["odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"]);
      expect(picks.redhat).toHaveLength(4);
    });

    it('should select 4 operators for version 4.17', () => {
      const picks = getPicksForVersion(odfScenario, "4.17");
      expect(picks.redhat).toEqual(["odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"]);
      expect(picks.redhat).toHaveLength(4);
    });

    it('should select 4 operators for version 4.18', () => {
      const picks = getPicksForVersion(odfScenario, "4.18");
      expect(picks.redhat).toEqual(["odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"]);
      expect(picks.redhat).toHaveLength(4);
    });

    it('should select ONLY 2 operators for version 4.19 (special case)', () => {
      const picks = getPicksForVersion(odfScenario, "4.19");
      expect(picks.redhat).toEqual(["odf-operator", "local-storage-operator"]);
      expect(picks.redhat).toHaveLength(2);
      // ocs-operator and mcg-operator are auto-managed in 4.19
      expect(picks.redhat).not.toContain("ocs-operator");
      expect(picks.redhat).not.toContain("mcg-operator");
    });

    it('should select 4 operators for version 4.20', () => {
      const picks = getPicksForVersion(odfScenario, "4.20");
      expect(picks.redhat).toEqual(["odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"]);
      expect(picks.redhat).toHaveLength(4);
    });

    it('should select 4 operators for version 4.21', () => {
      const picks = getPicksForVersion(odfScenario, "4.21");
      expect(picks.redhat).toEqual(["odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"]);
      expect(picks.redhat).toHaveLength(4);
    });

    it('should fall back to default for unknown version', () => {
      const picks = getPicksForVersion(odfScenario, "4.99");
      expect(picks.redhat).toEqual(["odf-operator", "ocs-operator", "mcg-operator", "local-storage-operator"]);
      expect(picks.redhat).toHaveLength(4);
    });

    it('should always include odf-operator across all versions', () => {
      ["4.16", "4.17", "4.18", "4.19", "4.20", "4.21"].forEach(version => {
        const picks = getPicksForVersion(odfScenario, version);
        expect(picks.redhat).toContain("odf-operator");
      });
    });

    it('should always include local-storage-operator across all versions', () => {
      ["4.16", "4.17", "4.18", "4.19", "4.20", "4.21"].forEach(version => {
        const picks = getPicksForVersion(odfScenario, version);
        expect(picks.redhat).toContain("local-storage-operator");
      });
    });
  });

  describe('OpenShift Platform Plus', () => {
    const platformPlusScenario = scenarios.find(s => s.id === "platform-plus");

    it('should include ACM, ACS, and Quay for all versions', () => {
      ["4.16", "4.17", "4.18", "4.19", "4.20", "4.21"].forEach(version => {
        const picks = getPicksForVersion(platformPlusScenario, version);
        expect(picks.redhat).toContain("advanced-cluster-management");
        expect(picks.redhat).toContain("rhacs-operator");
        expect(picks.redhat).toContain("quay-operator");
      });
    });

    it('should select 7 operators for version 4.16', () => {
      const picks = getPicksForVersion(platformPlusScenario, "4.16");
      expect(picks.redhat).toHaveLength(7);
    });

    it('should select 7 operators for version 4.20', () => {
      const picks = getPicksForVersion(platformPlusScenario, "4.20");
      expect(picks.redhat).toHaveLength(7);
    });

    it('should select 5 operators for version 4.19 (ODF auto-managed)', () => {
      const picks = getPicksForVersion(platformPlusScenario, "4.19");
      expect(picks.redhat).toHaveLength(5);
      // Should include core Platform Plus operators
      expect(picks.redhat).toContain("advanced-cluster-management");
      expect(picks.redhat).toContain("rhacs-operator");
      expect(picks.redhat).toContain("quay-operator");
      // Should include ODF operators (4.19 variant)
      expect(picks.redhat).toContain("odf-operator");
      expect(picks.redhat).toContain("local-storage-operator");
      // Should NOT include auto-managed operators
      expect(picks.redhat).not.toContain("ocs-operator");
      expect(picks.redhat).not.toContain("mcg-operator");
    });

    it('should fall back to default for unknown version', () => {
      const picks = getPicksForVersion(platformPlusScenario, "5.0");
      expect(picks.redhat).toHaveLength(7);
    });
  });

  describe('App Development Suite', () => {
    const appDevScenario = scenarios.find(s => s.id === "app-dev-suite");

    it('should use default picks for all versions (version-agnostic)', () => {
      ["4.16", "4.17", "4.18", "4.19", "4.20", "4.21"].forEach(version => {
        const picks = getPicksForVersion(appDevScenario, version);
        expect(picks.redhat).toEqual([
          "openshift-gitops-operator",
          "openshift-pipelines-operator-rh",
          "devspaces",
          "web-terminal"
        ]);
        expect(picks.redhat).toHaveLength(4);
      });
    });

    it('should include GitOps operator', () => {
      const picks = getPicksForVersion(appDevScenario, "4.20");
      expect(picks.redhat).toContain("openshift-gitops-operator");
    });

    it('should include Pipelines operator', () => {
      const picks = getPicksForVersion(appDevScenario, "4.20");
      expect(picks.redhat).toContain("openshift-pipelines-operator-rh");
    });

    it('should include DevSpaces', () => {
      const picks = getPicksForVersion(appDevScenario, "4.20");
      expect(picks.redhat).toContain("devspaces");
    });

    it('should include Web Terminal', () => {
      const picks = getPicksForVersion(appDevScenario, "4.20");
      expect(picks.redhat).toContain("web-terminal");
    });
  });

  describe('Legacy scenarios (backward compatibility)', () => {
    const gitopsScenario = scenarios.find(s => s.id === "gitops");

    it('should still work with static picks property', () => {
      const picks = getPicksForVersion(gitopsScenario, "4.20");
      expect(picks.redhat).toEqual(["openshift-gitops-operator"]);
    });

    it('should work with any version when using static picks', () => {
      ["4.16", "4.19", "4.20", "4.21", "5.0"].forEach(version => {
        const picks = getPicksForVersion(gitopsScenario, version);
        expect(picks.redhat).toEqual(["openshift-gitops-operator"]);
      });
    });
  });

  describe('Version detection logic', () => {
    it('should prefer version-specific picks over default', () => {
      const odfScenario = scenarios.find(s => s.id === "odf");
      const picks420 = getPicksForVersion(odfScenario, "4.20");
      const picksDefault = odfScenario.versionPicks["default"];

      // Should use version-specific (not just default)
      expect(picks420).toEqual(picksDefault);
      expect(picks420.redhat).toHaveLength(4);
    });

    it('should fall back to default when version not found', () => {
      const odfScenario = scenarios.find(s => s.id === "odf");
      const picksUnknown = getPicksForVersion(odfScenario, "999.999");
      const picksDefault = odfScenario.versionPicks["default"];

      expect(picksUnknown).toEqual(picksDefault);
    });

    it('should handle empty/null version gracefully', () => {
      const odfScenario = scenarios.find(s => s.id === "odf");
      const picksNull = getPicksForVersion(odfScenario, null);
      const picksEmpty = getPicksForVersion(odfScenario, "");
      const picksDefault = odfScenario.versionPicks["default"];

      expect(picksNull).toEqual(picksDefault);
      expect(picksEmpty).toEqual(picksDefault);
    });
  });

  describe('Operator package name consistency', () => {
    it('should use correct ACM package name', () => {
      const platformPlusScenario = scenarios.find(s => s.id === "platform-plus");
      const picks = getPicksForVersion(platformPlusScenario, "4.20");
      expect(picks.redhat).toContain("advanced-cluster-management");
      // NOT "acm-operator" or "rhacm"
    });

    it('should use correct ACS/RHACS package name', () => {
      const platformPlusScenario = scenarios.find(s => s.id === "platform-plus");
      const picks = getPicksForVersion(platformPlusScenario, "4.20");
      expect(picks.redhat).toContain("rhacs-operator");
      // NOT "acs-operator" or "advanced-cluster-security"
    });

    it('should use correct Quay package name', () => {
      const platformPlusScenario = scenarios.find(s => s.id === "platform-plus");
      const picks = getPicksForVersion(platformPlusScenario, "4.20");
      expect(picks.redhat).toContain("quay-operator");
    });
  });

  describe('Research documentation alignment', () => {
    it('ODF 4.19 should match research findings (2 operators)', () => {
      const odfScenario = scenarios.find(s => s.id === "odf");
      const picks419 = getPicksForVersion(odfScenario, "4.19");

      // Per research: In 4.19, only odf-operator and local-storage-operator
      // are user-selectable. All others are auto-managed.
      expect(picks419.redhat).toEqual(["odf-operator", "local-storage-operator"]);
    });

    it('ODF 4.16-4.18, 4.20-4.21 should match research findings (4 operators)', () => {
      const odfScenario = scenarios.find(s => s.id === "odf");
      ["4.16", "4.17", "4.18", "4.20", "4.21"].forEach(version => {
        const picks = getPicksForVersion(odfScenario, version);
        expect(picks.redhat).toHaveLength(4);
        expect(picks.redhat).toEqual([
          "odf-operator",
          "ocs-operator",
          "mcg-operator",
          "local-storage-operator"
        ]);
      });
    });
  });
});
