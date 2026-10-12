/**
 * OpenShift Airgap Architect - Operator Scenario Quick Picks (SHARED)
 *
 * A Quick Pick is a VERSION-AWARE PRESET: for a given OpenShift minor it names
 * the exact package set the preset stands for. It is therefore data that two
 * different layers need:
 *
 *   - `steps/OperatorsStep.jsx` renders the buttons and applies/removes a pick;
 *   - `shared/operatorMinorReconciliation.js` must RE-EVALUATE a pick's
 *     membership when the locked minor changes.
 *
 * It used to live module-private inside `OperatorsStep.jsx`, which exports only
 * the component. Reconciliation could not read it, so a cross-minor transition
 * re-stamped metadata on the ALREADY-SELECTED entries and never performed the
 * set difference against the destination minor's row. Switching 4.22 -> 4.20
 * with "OpenShift AI" selected therefore did not add the 4.20-only
 * `rhods-prometheus-operator` until the user toggled the pick off and on, and
 * 4.20 -> 4.22 left that package parked as unresolvable intent forever.
 *
 * This module is DATA ONLY and is moved VERBATIM. Nothing about any pick's
 * membership changed when it was lifted out of the step.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

export const scenarios = [
  {
    id: "virtualization",
    label: "Virtualization",
    picks: {
      redhat: ["kubevirt-hyperconverged", "mtv-operator", "kubernetes-nmstate-operator"]
    }
  },
  {
    id: "local-storage",
    label: "Local Storage",
    picks: { redhat: ["lvms-operator", "local-storage-operator"] }
  },
  {
    id: "openshift-ai",
    label: "OpenShift AI",
    // Version-aware since the 4.22 flip: `rhods-prometheus-operator` is present in the
    // redhat catalog at 4.20 and 4.21 but ABSENT at 4.22, and applyScenario skips a
    // not-found package silently. 4.20/4.21 keep the shipped set unchanged; 4.22 omits
    // the package with NO replacement — the 4.22 rhods-operator FBC declares no OLM
    // dependency on it, never references it, and ships no Prometheus image.
    // Evidence: docs/minor-release/4.22/rhoai-package-evidence-4.22.json (finding B1).
    versionPicks: {
      "4.20": { redhat: ["rhods-operator", "rhods-prometheus-operator", "nfd"], certified: ["gpu-operator-certified"] },
      "4.21": { redhat: ["rhods-operator", "rhods-prometheus-operator", "nfd"], certified: ["gpu-operator-certified"] },
      "4.22": { redhat: ["rhods-operator", "nfd"], certified: ["gpu-operator-certified"] }
    }
  },
  {
    id: "compliance",
    label: "Compliance and Security",
    description: "File integrity monitoring (AIDE) and compliance scanning",
    picks: { redhat: ["compliance-operator", "file-integrity-operator"] }
  },
  {
    id: "disconnected",
    label: "Disconnected Update Support",
    picks: { redhat: ["cincinnati-operator"] }
  },
  {
    id: "qol",
    label: "Quality of Life",
    description: "Web Terminal, DevSpaces, and Red Hat Developer Hub (Backstage-based internal developer platform)",
    picks: { redhat: ["web-terminal", "devspaces", "rhdh"] }
  },
  {
    id: "node-health",
    label: "Node Health and Maintenance",
    picks: { redhat: ["self-node-remediation", "fence-agents-remediation", "node-healthcheck-operator", "node-maintenance-operator", "node-observability-operator"] }
  },
  {
    id: "gitops",
    label: "GitOps",
    picks: { redhat: ["openshift-gitops-operator"] }
  },
  {
    id: "cicd",
    label: "CI/CD",
    picks: { redhat: ["openshift-pipelines-operator-rh"] }
  },
  {
    id: "odf",
    label: "OpenShift Data Foundation (Base)",
    description: "Persistent storage with file, block, and object support - base packages for disconnected mirroring",
    versionPicks: {
      "4.16": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator"] },
      "4.17": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator"] },
      "4.18": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies"] },
      "4.19": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies"] },
      "4.20": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator"] },
      "4.21": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator"] },
      "4.22": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator", "ocs-tls-profiles"] }
    }
  },
  {
    id: "odf-local-storage",
    label: "ODF + Local Storage",
    description: "ODF base packages + local-storage-operator for internal mode deployments (Ceph on local disks)",
    versionPicks: {
      "4.16": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "local-storage-operator"] },
      "4.17": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "local-storage-operator"] },
      "4.18": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "local-storage-operator"] },
      "4.19": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "local-storage-operator"] },
      "4.20": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator", "local-storage-operator"] },
      "4.21": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator", "local-storage-operator"] },
      "4.22": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator", "ocs-tls-profiles", "local-storage-operator"] }
    }
  },
  {
    id: "odf-disaster-recovery",
    label: "ODF + Disaster Recovery",
    description: "ODF base packages + Regional-DR/Metro-DR operators for disaster recovery configurations",
    versionPicks: {
      "4.16": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "odf-multicluster-orchestrator", "odr-cluster-operator", "odr-hub-operator"] },
      "4.17": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-multicluster-orchestrator", "odr-cluster-operator", "odr-hub-operator"] },
      "4.18": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-multicluster-orchestrator", "odr-cluster-operator", "odr-hub-operator"] },
      "4.19": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-multicluster-orchestrator", "odr-cluster-operator", "odr-hub-operator"] },
      "4.20": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator", "odf-multicluster-orchestrator", "odr-cluster-operator", "odr-hub-operator"] },
      "4.21": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator", "odf-multicluster-orchestrator", "odr-cluster-operator", "odr-hub-operator"] },
      "4.22": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator", "ocs-tls-profiles", "odf-multicluster-orchestrator", "odr-cluster-operator", "odr-hub-operator", "odr-volsync-plugin-operator"] }
    }
  },
  {
    id: "platform-plus",
    label: "OpenShift Platform Plus",
    description: "Multi-cluster management (ACM + MCE), security (ACS), registry (Quay), and storage (ODF base stack)",
    versionPicks: {
      "4.16": { redhat: ["advanced-cluster-management", "multicluster-engine", "rhacs-operator", "quay-operator", "ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator"] },
      "4.17": { redhat: ["advanced-cluster-management", "multicluster-engine", "rhacs-operator", "quay-operator", "ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator"] },
      "4.18": { redhat: ["advanced-cluster-management", "multicluster-engine", "rhacs-operator", "quay-operator", "ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies"] },
      "4.19": { redhat: ["advanced-cluster-management", "multicluster-engine", "rhacs-operator", "quay-operator", "ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies"] },
      "4.20": { redhat: ["advanced-cluster-management", "multicluster-engine", "rhacs-operator", "quay-operator", "ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator"] },
      "4.21": { redhat: ["advanced-cluster-management", "multicluster-engine", "rhacs-operator", "quay-operator", "ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator"] },
      "4.22": { redhat: ["advanced-cluster-management", "multicluster-engine", "rhacs-operator", "quay-operator", "ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator", "ocs-tls-profiles"] }
    }
  },
  {
    id: "app-dev-suite",
    label: "App Development Suite",
    description: "GitOps, CI/CD pipelines, cloud IDE, and web terminal",
    // The package set genuinely does not vary by minor, but it is still declared
    // per-minor: with `default` removed there is no fallback, so a supported minor
    // without a row has no Quick Pick at all.
    versionPicks: {
      "4.20": { redhat: ["openshift-gitops-operator", "openshift-pipelines-operator-rh", "devspaces", "web-terminal"] },
      "4.21": { redhat: ["openshift-gitops-operator", "openshift-pipelines-operator-rh", "devspaces", "web-terminal"] },
      "4.22": { redhat: ["openshift-gitops-operator", "openshift-pipelines-operator-rh", "devspaces", "web-terminal"] }
    }
  },
  {
    id: "logging",
    label: "Logging Stack",
    description: "Cluster logging with Loki log aggregation (Elasticsearch deprecated in 5.x+)",
    picks: { redhat: ["cluster-logging", "loki-operator"] }
  },
  {
    id: "service-mesh",
    label: "Service Mesh",
    // `jaeger-product` was removed here: Red Hat's own distributed-tracing
    // documentation states the Jaeger Operator is removed from the
    // redhat-operators catalog, support for Jaeger 3.5 ended 2025-11-03 —
    // before any minor this tool supports — and the real `oc-mirror --v2 list
    // operators` scan confirms it is absent at 4.20, 4.21 and 4.22 alike. It was
    // therefore a stale reference that `applyScenario` skipped silently, so this
    // Quick Pick promised three operators and mirrored two.
    //
    // NOT replaced by Tempo/OpenTelemetry. Service Mesh 3 no longer installs or
    // manages tracing components at all, and the OSSM distributed-tracing
    // chapter lists the Tempo and OpenTelemetry operators as prerequisites of an
    // OPTIONAL tracing integration, not of Service Mesh. Offering a tracing
    // Quick Pick is a separate product decision. See DOC-184.
    description: "Istio-based service mesh with Kiali observability",
    picks: { redhat: ["servicemeshoperator", "kiali-ossm"] }
  },
  {
    id: "serverless",
    label: "Serverless",
    description: "Knative-based serverless workloads (Serving and Eventing)",
    picks: { redhat: ["serverless-operator"] }
  },
  {
    id: "network-observability",
    label: "Network Observability",
    description: "eBPF-based network traffic monitoring and analysis",
    picks: { redhat: ["netobserv-operator"] }
  },
  {
    id: "cost-management",
    label: "Cost Management",
    description: "Cluster cost tracking and resource usage metrics",
    picks: { redhat: ["costmanagement-metrics-operator"] }
  },
  {
    id: "quay",
    label: "Red Hat Quay",
    description: "Enterprise container registry with enhanced RBAC",
    picks: { redhat: ["quay-operator"] }
  },
  {
    id: "quay-bridge",
    label: "Quay + OpenShift Integration",
    description: "Quay as default OpenShift registry with namespace sync and ImageStream mirroring",
    picks: { redhat: ["quay-operator", "quay-bridge-operator"] }
  }
];

/**
 * Resolve a Quick Pick's package set for one OpenShift minor.
 *
 * There is deliberately NO `default` fallback. A version-aware Quick Pick that
 * has no row for the selected minor returns `null` and fails closed, because
 * the alternative is worse than no Quick Pick: resolution used to fall through
 * to `default`, so enabling a new minor without authoring its rows made every
 * ODF Quick Pick silently serve the previous minor's package list, and
 * `applyScenario` skips a not-found package without warning. The user would
 * mirror a short set and be told nothing.
 *
 * Flat Quick Picks keep their minor-independent `picks`.
 *
 * @returns {Object|null} `{ catalogId: string[] }`, or null when undefined for this minor
 */
export const resolveScenarioPicks = (scenario, minor) => {
  if (scenario?.versionPicks) return scenario.versionPicks[minor] || null;
  return scenario?.picks || null;
};
