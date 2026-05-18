/**
 * OpenShift Airgap Architect - Operators Selection Step
 *
 * RedHat and certified operator catalog scanning and selection. Scenario-based
 * quick-pick templates (virtualization, storage, AI, networking) and manual
 * operator search. Integrates with backend catalog scanning API.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useEffect, useRef, useState, useMemo } from "react";
import { apiFetch } from "../api.js";
import { useApp } from "../store.jsx";
import { getOpenShiftMinorFromState } from "../shared/openShiftMinor.js";
import { useCatalogScanProgress } from "../useCatalogScanProgress.js";
import SecretInput from "../components/SecretInput.jsx";
import CollapsibleSection from "../components/CollapsibleSection.jsx";
import Banner from "../components/Banner.jsx";
import Button from "../components/Button.jsx";
import Switch from "../components/Switch.jsx";
import OptionRow from "../components/OptionRow.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";

const scenarios = [
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
    picks: { redhat: ["rhods-operator", "rhods-prometheus-operator", "nfd"], certified: ["gpu-operator-certified"] }
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
      "default": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator"] }
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
      "default": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator", "local-storage-operator"] }
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
      "default": { redhat: ["ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator", "odf-multicluster-orchestrator", "odr-cluster-operator", "odr-hub-operator"] }
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
      "default": { redhat: ["advanced-cluster-management", "multicluster-engine", "rhacs-operator", "quay-operator", "ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator", "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator", "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator"] }
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
    id: "logging",
    label: "Logging Stack",
    description: "Cluster logging with Loki log aggregation (Elasticsearch deprecated in 5.x+)",
    picks: { redhat: ["cluster-logging", "loki-operator"] }
  },
  {
    id: "service-mesh",
    label: "Service Mesh",
    description: "Istio-based service mesh with Kiali observability and Jaeger distributed tracing",
    picks: { redhat: ["servicemeshoperator", "kiali-ossm", "jaeger-product"] }
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

const catalogImages = (version) => ({
  redhat: `registry.redhat.io/redhat/redhat-operator-index:v${version}`,
  certified: `registry.redhat.io/redhat/certified-operator-index:v${version}`,
  community: `registry.redhat.io/redhat/community-operator-index:v${version}`
});

const OperatorsStep = ({ previewControls, previewEnabled }) => {
  const { state, updateState, setState } = useApp();
  const [activeTab, setActiveTab] = useState("redhat");
  const [authAvailable, setAuthAvailable] = useState(false);
  const [jobs, setJobs] = useState({});
  const [jobStatuses, setJobStatuses] = useState({});
  const { displayProgress, start, complete, fail } = useCatalogScanProgress();
  const prevStatusesRef = useRef({});
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);
  const [pullSecretInput, setPullSecretInput] = useState("");
  const [scanError, setScanError] = useState("");
  const [prefetching, setPrefetching] = useState(false);
  const [discoveryEnabled, setDiscoveryEnabled] = useState(true);
  const [selectedGridRows, setSelectedGridRows] = useState(2);
  const selectedGridRef = useRef(null);
  const hasVisited = state.ui?.visitedSteps?.operators;

  // Local state for text inputs (onBlur pattern)
  const [additionalImagesLocal, setAdditionalImagesLocal] = useState(() => state.imagesetConfig?.additionalImages || "");
  const [archiveSizeLocal, setArchiveSizeLocal] = useState(() => state.imagesetConfig?.archiveSize || "");

  // Sync local state when store changes
  useEffect(() => {
    setAdditionalImagesLocal(state.imagesetConfig?.additionalImages || "");
  }, [state.imagesetConfig?.additionalImages]);
  useEffect(() => {
    setArchiveSizeLocal(state.imagesetConfig?.archiveSize || "");
  }, [state.imagesetConfig?.archiveSize]);
  const needsReview = state.reviewFlags?.operators && hasVisited;
  const staleResults = state.operators?.stale && hasVisited;
  const hasScanJobs = Object.keys(jobs).length > 0;
  const hasScanJobsFromState = Object.keys(state.operators?.scanJobs || {}).length > 0;
  const hasBlueprintRetainedSecret = Boolean(
    state.blueprint?.blueprintRetainPullSecret &&
    state.blueprint?.blueprintPullSecretEphemeral?.trim()
  );
  const hasRetainedPullSecret = Boolean(
    state.credentials?.pullSecretPlaceholder &&
    state.credentials.pullSecretPlaceholder.trim() &&
    state.credentials.pullSecretPlaceholder !== "{\"auths\":{}}"
  );
  const hasCredentialSource = authAvailable || pullSecretInput || hasRetainedPullSecret || hasBlueprintRetainedSecret;
  const anyScanFailed = ["redhat", "certified", "community"].some((id) => jobStatuses[id]?.status === "failed");
  const scansInProgressOrComplete = hasScanJobs && !anyScanFailed;
  const showStaleWarning = staleResults && !scansInProgressOrComplete;
  const discoveryAlreadyRunningOrDone = hasScanJobs || hasScanJobsFromState;

  const version = getOpenShiftMinorFromState(state) || "";
  const normalizeCatalogs = (data) => ({
    redhat: Array.isArray(data?.redhat) ? data.redhat : data?.redhat?.results || [],
    certified: Array.isArray(data?.certified) ? data.certified : data?.certified?.results || [],
    community: Array.isArray(data?.community) ? data.community : data?.community?.results || []
  });
  // Only use cached catalogs if version matches; prevents showing operators from wrong version after import
  const catalogsData = (state.operators?.version === version) ? (state.operators?.catalogs || {}) : {};
  const catalogs = normalizeCatalogs(catalogsData);
  const selected = state.operators?.selected || [];
  const scenarioSelections = state.operators?.scenarios || {};
  const confirmed = state.version?.versionConfirmed ?? state.release?.confirmed;
  const selectionsKey = `${version}-${confirmed}`;
  const hasResults = catalogs.redhat.length || catalogs.certified.length || catalogs.community.length;
  const fastMode = Boolean(state.operators?.fastMode);
  const cachedAt = state.operators?.cachedAt || null;
  const selectedIds = new Set(selected.map((op) => op.id));
  const filteredCatalogs = {
    redhat: catalogs.redhat.filter((op) => !selectedIds.has(op.id)),
    certified: catalogs.certified.filter((op) => !selectedIds.has(op.id)),
    community: catalogs.community.filter((op) => !selectedIds.has(op.id))
  };

  // Calculate actual row count for selected operators grid
  const actualRowCount = useMemo(() => {
    if (!selectedGridRef.current || selected.length === 0) return 0;
    const gridWidth = selectedGridRef.current.offsetWidth;
    const cardMinWidth = 220; // From grid minmax(min(100%, 220px), 1fr)
    const gap = 12;
    const columnsPerRow = Math.floor((gridWidth + gap) / (cardMinWidth + gap)) || 1;
    return Math.ceil(selected.length / columnsPerRow);
  }, [selected.length]);

  const maxExpandableRows = Math.max(2, actualRowCount);
  const showScrollbar = actualRowCount > selectedGridRows;

  // Auto-expand Scan Status if any scan needs attention
  const shouldExpandScanStatus = useMemo(() => {
    const catalogIds = ["redhat", "certified", "community"];
    const hasJobs = Object.keys(jobs).length > 0;

    if (!hasJobs) return false; // No jobs, stay collapsed

    return catalogIds.some((catalogId) => {
      const status = jobStatuses[catalogId]?.status;
      // Expand if status is not "completed" or if job exists but status not loaded
      return !status || status !== "completed";
    });
  }, [jobStatuses, jobs]);

  // Resize handle drag handler
  const startResize = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startRows = selectedGridRows;

    const onMouseMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const rowHeight = 140; // Estimated height per row
      const newRows = Math.max(2, Math.min(maxExpandableRows, startRows + Math.round(deltaY / rowHeight)));
      setSelectedGridRows(newRows);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  useEffect(() => {
    apiFetch("/api/operators/credentials")
      .then((data) => setAuthAvailable(data.available))
      .catch(() => setAuthAvailable(false));
  }, []);

  useEffect(() => {
    const fromState = state.operators?.scanJobs;
    if (fromState && typeof fromState === "object" && Object.keys(fromState).length > 0) {
      setJobs((prev) => (Object.keys(prev).length === 0 ? { ...fromState } : prev));
    }
  }, [state.operators?.scanJobs]);

  useEffect(() => {
    const catalogIds = ["redhat", "certified", "community"];
    for (const id of catalogIds) {
      const job = jobStatuses[id];
      const status = job?.status;
      const prev = prevStatusesRef.current[id];
      if (status === "running" || status === "queued") {
        if (prev !== "running" && prev !== "queued") {
          const createdAt = job?.created_at ?? job?.createdAt;
          start(id, typeof createdAt === "number" ? createdAt : null);
        }
      } else if (status === "completed") {
        complete(id);
      } else if (status === "failed") {
        fail(id);
      }
      prevStatusesRef.current[id] = status;
    }
  }, [jobStatuses, start, complete, fail]);

  useEffect(() => {
    if (!confirmed || !version) return;
    if (state.operators?.version === version && catalogs.redhat.length) return;
    setLoadingCatalogs(true);
    apiFetch(`/api/operators/status?version=${version}`)
      .then((data) => {
        setState((prev) => ({
          ...prev,
          operators: {
            ...prev.operators,
            catalogs: normalizeCatalogs(data),
            version,
            cachedAt: Object.values(data || {}).find((item) => item?.updatedAt)?.updatedAt || null
          }
        }));
      })
      .finally(() => setLoadingCatalogs(false));
  }, [selectionsKey]);

  useEffect(() => {
    if (!confirmed || !version) return;
    if (hasResults) return;
    if (!authAvailable) return;
    if (fastMode) return;
    if (Object.keys(state.operators?.scanJobs || {}).length > 0) return;
    startScan().catch(() => {});
  }, [authAvailable, confirmed, version, fastMode, state.operators?.scanJobs]);

  const canScan = confirmed;
  const scanEnabled = canScan && hasCredentialSource;
  const scenarioReady = hasResults;

  const ensureSources = (op, source) => {
    const sources = new Set(op.sources && op.sources.length ? op.sources : ["manual"]);
    if (source) sources.add(source);
    return { ...op, sources: Array.from(sources) };
  };

  const applyScenario = (scenario) => {
    setState((prev) => {
      const images = catalogImages(version);
      const prevSelected = prev.operators?.selected || [];
      const nextSelected = [...prevSelected];
      const scenarioAdded = { ...(prev.operators?.scenarioAdded || {}) };

      // Get version-specific picks or fall back to static picks
      const picks = scenario.versionPicks?.[version] || scenario.versionPicks?.["default"] || scenario.picks;

      Object.entries(picks).forEach(([catalogId, names]) => {
        const list = catalogs[catalogId] || [];
        names.forEach((name) => {
          const target = name.toLowerCase();
          const found = list.find((op) => op.name?.toLowerCase() === target);
          if (!found) return;
          const existingIndex = nextSelected.findIndex((item) => item.id === found.id);
          if (existingIndex >= 0) {
            nextSelected[existingIndex] = ensureSources(nextSelected[existingIndex], scenario.id);
            const prevSources = prevSelected.find((item) => item.id === found.id)?.sources || [];
            if (!prevSources.includes(scenario.id)) {
              scenarioAdded[found.id] = { ...(scenarioAdded[found.id] || {}), [scenario.id]: true };
            }
            return;
          }
          nextSelected.push({ ...found, catalogImage: images[catalogId], sources: [scenario.id] });
          scenarioAdded[found.id] = { ...(scenarioAdded[found.id] || {}), [scenario.id]: true };
        });
      });
      const scenarios = { ...(prev.operators?.scenarios || {}), [scenario.id]: true };
      return {
        ...prev,
        operators: { ...prev.operators, selected: nextSelected, scenarios, scenarioAdded, version }
      };
    });
  };

  const removeScenarioOperators = (scenarioId) => {
    setState((prev) => {
      const prevSelected = prev.operators?.selected || [];
      const scenarioAdded = { ...(prev.operators?.scenarioAdded || {}) };
      const nextSelected = prevSelected
        .map((op) => {
          const sources = (op.sources || ["manual"]).filter((source) => source !== scenarioId);
          const addedByScenario = Boolean(scenarioAdded[op.id]?.[scenarioId]);
          const removeEntirely = addedByScenario && sources.length === 0;
          if (removeEntirely) {
            const nextAdded = { ...(scenarioAdded[op.id] || {}) };
            delete nextAdded[scenarioId];
            if (Object.keys(nextAdded).length === 0) {
              delete scenarioAdded[op.id];
            } else {
              scenarioAdded[op.id] = nextAdded;
            }
            return null;
          }
          const nextAdded = { ...(scenarioAdded[op.id] || {}) };
          delete nextAdded[scenarioId];
          if (Object.keys(nextAdded).length === 0) {
            delete scenarioAdded[op.id];
          } else {
            scenarioAdded[op.id] = nextAdded;
          }
          return { ...op, sources };
        })
        .filter(Boolean);
      const scenarios = { ...(prev.operators?.scenarios || {}) };
      delete scenarios[scenarioId];
      return {
        ...prev,
        operators: { ...prev.operators, selected: nextSelected, scenarios, scenarioAdded, version }
      };
    });
  };

  const handleScenarioClick = (scenario) => {
    if (!scenarioReady) {
      if (scanEnabled && !loadingCatalogs) {
        setScanError("Scanning catalogs before applying scenario...");
        startScan().catch(() => setScanError("Operator scan failed. Check pull secret and try again."));
      } else {
        setScanError("Scenario picks require operator catalogs. Run a scan first.");
      }
      return;
    }

    // Check if ALL operators from this scenario are currently selected
    const picks = scenario.versionPicks?.[version] || scenario.versionPicks?.["default"] || scenario.picks;
    const allPickNames = Object.values(picks).flat().map((name) => name.toLowerCase());
    const allOperatorsSelected = allPickNames.every((name) =>
      selected.some((op) => op.name?.toLowerCase() === name)
    );

    if (allOperatorsSelected) {
      // All operators are selected, so remove them
      removeScenarioOperators(scenario.id);
    } else {
      // Some operators are missing, so add them (applyScenario handles existing ones gracefully)
      applyScenario(scenario);
    }
  };

  const startScan = async () => {
    setLoadingCatalogs(true);
    setScanError("");
    updateState({ operators: { ...state.operators, stale: false } });
    const secretToUse = pullSecretInput ||
      (hasBlueprintRetainedSecret ? state.blueprint?.blueprintPullSecretEphemeral : "") ||
      (hasRetainedPullSecret ? state.credentials?.pullSecretPlaceholder : "");
    const payload = secretToUse ? { pullSecret: secretToUse } : {};
    try {
      const data = await apiFetch("/api/operators/scan", { method: "POST", body: JSON.stringify(payload) });
      setJobs(data.jobs || {});
      setLoadingCatalogs(false);
    } catch (err) {
      setScanError("Operator scan failed. Check pull secret and try again.");
      setLoadingCatalogs(false);
    }
  };

  const prefetchCatalogs = async () => {
    setPrefetching(true);
    setScanError("");
    try {
      const data = await apiFetch("/api/operators/prefetch", { method: "POST" });
      setJobs(data.jobs || {});
    } catch (err) {
      setScanError("Operator prefetch failed. Check registry auth and try again.");
    } finally {
      setPrefetching(false);
    }
  };

  useEffect(() => {
    const ids = Object.values(jobs);
    if (!ids.length) return;
    let cancelled = false;
    let prevPolledStatuses = {};
    let pollCount = 0;
    const MAX_POLLS = 150; // 150 * 4s = 10 minutes max polling time
    const startTime = Date.now();
    const MAX_DURATION_MS = 10 * 60 * 1000; // 10 minutes

    const poll = async () => {
      pollCount++;
      const elapsed = Date.now() - startTime;

      // Safety: stop polling after max iterations or time
      if (pollCount > MAX_POLLS || elapsed > MAX_DURATION_MS) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(`[AirgapArchitect] Catalog scan polling stopped: max ${pollCount > MAX_POLLS ? 'iterations' : 'duration'} reached`);
        }
        return;
      }

      const nextStatuses = {};
      for (const id of ids) {
        try {
          const job = await apiFetch(`/api/jobs/${id}`);
          const catalogId = Object.entries(jobs).find(([, jobId]) => jobId === id)?.[0];
          if (catalogId) {
            nextStatuses[catalogId] = job;

            // Log status transitions
            const prev = prevPolledStatuses[catalogId];
            if (prev?.status !== job.status && process.env.NODE_ENV !== "production") {
              if (typeof window !== "undefined" && window.console?.info) {
                window.console.info(`[AirgapArchitect] Job status changed`, {
                  catalogId,
                  jobId: id,
                  from: prev?.status || "unknown",
                  to: job.status,
                  progress: job.progress
                });
              }
            }
          }
          if (job.status === "completed" || job.status === "failed") {
            const data = await apiFetch(`/api/operators/status?version=${version}`);
            if (!cancelled) {
              setState((prev) => ({
                ...prev,
                operators: { ...prev.operators, catalogs: normalizeCatalogs(data), version }
              }));
            }
          }
        } catch {
          // ignore
        }
      }

      // Update previous statuses for next poll
      prevPolledStatuses = { ...nextStatuses };
      if (!cancelled) {
        setJobStatuses(nextStatuses);
      }
      const allDone = ids.every((jobId) => {
        const status = Object.values(nextStatuses).find((item) => item?.id === jobId);
        return status && (status.status === "completed" || status.status === "failed");
      });
      const anyFailed = Object.values(nextStatuses).some((item) => item?.status === "failed");
      if (allDone && !anyFailed) {
        setState((prev) => ({
          ...prev,
          credentials: { ...prev.credentials, redHatPullSecretConfigured: true }
        }));
        if (pullSecretInput) setPullSecretInput("");
      }

      // Stop polling if all jobs are done or cancelled
      if (!cancelled && !allDone) {
        setTimeout(poll, 4000);
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [jobs, version]);

  const selectOperator = (op) => {
    setState((prev) => {
      const prevSelected = prev.operators?.selected || [];
      const existing = prevSelected.find((item) => item.id === op.id);
      if (existing) {
        const nextSelected = prevSelected.map((item) =>
          item.id === op.id ? ensureSources(item, "manual") : item
        );
        return { ...prev, operators: { ...prev.operators, selected: nextSelected, version } };
      }
      const images = catalogImages(version);
      const next = [...prevSelected, { ...op, catalogImage: images[op.catalog], sources: ["manual"] }];
      return { ...prev, operators: { ...prev.operators, selected: next, version } };
    });
  };

  const removeOperator = (id) => {
    setState((prev) => {
      const prevSelected = prev.operators?.selected || [];
      const removedOp = prevSelected.find((op) => op.id === id);
      const next = prevSelected.filter((op) => op.id !== id);
      const scenarioAdded = { ...(prev.operators?.scenarioAdded || {}) };
      const scenarioStates = { ...(prev.operators?.scenarios || {}) };

      // Check if this operator was added by any scenarios
      const operatorScenarios = Object.keys(scenarioAdded[id] || {});
      operatorScenarios.forEach((scenarioId) => {
        // Find the scenario definition
        const scenarioDef = scenarios.find((s) => s.id === scenarioId);
        if (!scenarioDef) return;

        // Get version-aware or static picks
        const picks = scenarioDef.versionPicks?.[version] || scenarioDef.versionPicks?.["default"] || scenarioDef.picks;
        const allPickNames = Object.values(picks).flat().map((name) => name.toLowerCase());

        // Check if ALL operators from this scenario are still selected
        const allOperatorsStillSelected = allPickNames.every((name) =>
          next.some((op) => op.name?.toLowerCase() === name)
        );

        // If not all operators are selected, deselect the scenario
        if (!allOperatorsStillSelected) {
          delete scenarioStates[scenarioId];
        }
      });

      // Clean up scenarioAdded tracking for this operator
      delete scenarioAdded[id];

      // Add removed operator to catalogs if not already present (e.g., operator from imported run with no cached catalog data)
      let updatedCatalogs = prev.operators?.catalogs ? { ...prev.operators.catalogs } : {};
      if (removedOp) {
        const catalogId = removedOp.catalog; // 'redhat', 'certified', or 'community'
        if (catalogId && updatedCatalogs[catalogId]) {
          const catalogList = Array.isArray(updatedCatalogs[catalogId])
            ? updatedCatalogs[catalogId]
            : (updatedCatalogs[catalogId]?.results || []);
          const exists = catalogList.some((op) => op.id === id);
          if (!exists) {
            // Add to catalog so it appears in available operators
            const updatedList = [...catalogList, removedOp];
            updatedCatalogs[catalogId] = Array.isArray(updatedCatalogs[catalogId])
              ? updatedList
              : { ...updatedCatalogs[catalogId], results: updatedList };
          }
        } else if (catalogId) {
          // Catalog doesn't exist at all, create it
          updatedCatalogs[catalogId] = [removedOp];
        }
      }

      return {
        ...prev,
        operators: {
          ...prev.operators,
          selected: next,
          scenarios: scenarioStates,
          scenarioAdded,
          catalogs: updatedCatalogs,
          version
        }
      };
    });
  };

  const clearAllSelections = () => {
    setState((prev) => {
      return {
        ...prev,
        operators: {
          ...prev.operators,
          selected: [],
          scenarios: {},
          scenarioAdded: {},
          version
        }
      };
    });
  };

  const warnVersionChange = state.operators?.version && state.operators?.version !== version;
  const keepCurrent = () => {
    updateState({ operators: { ...state.operators, version } });
  };
  const restartScans = () => {
    updateState({ operators: { ...state.operators, catalogs: { redhat: [], certified: [], community: [] }, selected: [], version } });
    startScan().catch(() => {});
  };

  return (
    <div className="step">
      <div className="step-header">
        <div className="step-header-main">
          <h2>Operator Catalog Strategy</h2>
          <p className="subtle">Select Day 2 operators to mirror into the disconnected registry.</p>
        </div>
      </div>

      <div className="step-body">
        {needsReview ? (
          <Banner variant="warning">
            Version or upstream selections changed. Operator selections and scan results may be stale.
            <div className="actions">
              <Button variant="secondary" onClick={() => updateState({ reviewFlags: { ...state.reviewFlags, operators: false } })}>
                Re-evaluate this page
              </Button>
            </div>
          </Banner>
        ) : null}
        {!canScan ? (
          <Banner variant="warning">Operator discovery is disabled until you confirm versions in Release Management.</Banner>
        ) : null}
        {!hasCredentialSource && !discoveryAlreadyRunningOrDone ? (
          <Banner variant="info">Operator discovery disabled; provide registry.redhat.io credentials to populate catalogs.</Banner>
        ) : null}
        {warnVersionChange ? (
          <Banner variant="warning">
            Version changed after scans started. Re-run scans to align catalogs with {version}.
            <div className="actions">
              <Button variant="secondary" onClick={keepCurrent}>Keep Current Selection</Button>
              <Button variant="secondary" onClick={restartScans}>Restart Scans</Button>
            </div>
          </Banner>
        ) : null}
        {showStaleWarning ? (
          <Banner variant="warning">
            Existing operator scan results are marked stale. Re-scan to ensure results match this version.
          </Banner>
        ) : null}
        <div className="sticky-panel">
          <CollapsibleSection title="Operator Catalog Selection" defaultCollapsed={true}>
            <OptionRow
              title="Enable Operator Discovery"
              description="Use pull secret and scan to populate operator catalogs from Red Hat."
            >
              <Switch
                checked={discoveryEnabled}
                onChange={(checked) => setDiscoveryEnabled(checked)}
                aria-label="Enable Operator Discovery"
              />
            </OptionRow>
            {!discoveryEnabled ? (
              <Banner variant="info">Operator discovery is disabled. Enable it above to scan and select operators.</Banner>
            ) : (
              <CollapsibleSection title="Discovery options" defaultCollapsed={discoveryAlreadyRunningOrDone && (hasCredentialSource || hasResults)} wrapInCard={false}>
                    {hasRetainedPullSecret && discoveryAlreadyRunningOrDone ? (
                      <p className="note subtle" style={{ marginTop: 0, marginBottom: 12 }}>
                        Using pull secret from Blueprint. You can scan or re-scan below.
                      </p>
                    ) : null}
                    <div className="credentials-field-constrained">
                      <SecretInput
                        value={pullSecretInput}
                        onChange={setPullSecretInput}
                        label="Red Hat pull secret (optional)"
                        labelEmphasis="Red Hat pull secret (optional)"
                        hint={`Red Hat pull secret for scanning Operator catalogs (optional).

**What is this:**
Authentication credentials for pulling Operator catalog metadata from Red Hat registries (registry.redhat.io and quay.io) when you click "Scan" below.

**When needed:**
**Optional** - only required if you want to populate Operator catalogs by scanning Red Hat registries:
• You don't have a pull secret already configured (mounted or retained from Blueprint)
• You want fresh operator catalog metadata from Red Hat
• You're using the "Scan" feature to discover available operators

**When NOT needed:**
• Pull secret is already mounted in the container
• You retained a pull secret from the Blueprint tab
• You're manually uploading catalog files
• You're not using operators in your installation

**Pull secret sources:**

**1. Mounted pull secret:**
If running in a container with a pull secret mounted, it's automatically detected and used. No need to paste one here.

**2. Retained from Blueprint:**
If you provided a pull secret on the Blueprint tab and checked "Retain for oc-mirror runs", it's carried forward here.

**3. Paste for this scan only:**
Paste a fresh pull secret just for this operator scan. It's not stored or exported.

**Where to get it:**
Download from OpenShift Cluster Manager at console.redhat.com:
1. Log in with your Red Hat account
2. Navigate to OpenShift → Downloads
3. Click "Download pull secret" or "Copy pull secret"

**How it's used:**
• Authenticates to registry.redhat.io and quay.io when clicking "Scan"
• Retrieves latest Operator catalog index images
• Extracts operator bundle metadata for selection
• **Not stored** - used only for this scan, not persisted or exported

**Format:**
Standard Red Hat pull secret JSON:
\`\`\`json
{
  "auths": {
    "cloud.openshift.com": {"auth": "...", "email": "..."},
    "quay.io": {"auth": "...", "email": "..."},
    "registry.redhat.io": {"auth": "...", "email": "..."}
  }
}
\`\`\`

**Fast mode:**
Enable "Fast mode" below to use cached catalog data from previous scans instead of fetching fresh data (skips pull secret requirement if cache exists).

**Important:**
• Requires active Red Hat subscription or trial
• This is separate from the install-config pull secret (Identity & Access tab)
• Only used for catalog scanning, not for cluster installation`}
                        getPullSecretUrl="https://console.redhat.com/openshift/downloads#tool-pull-secret"
                        placeholder="Paste Red Hat pull secret JSON"
                        rows={4}
                        aria-label="Red Hat pull secret JSON for operator discovery"
                      />
                    </div>
                    <OptionRow
                      title="Fast mode"
                      description="Use cached catalogs when available"
                      note={fastMode && cachedAt ? `Using cached catalogs from ${new Date(cachedAt).toLocaleString()}.` : null}
                      style={{ marginTop: "1rem" }}
                    >
                      <Switch
                        checked={fastMode}
                        onChange={(checked) => updateState({ operators: { ...state.operators, fastMode: checked } })}
                        aria-label="Fast mode"
                      />
                    </OptionRow>
                    {scanError ? <Banner variant="warning">{scanError}</Banner> : null}
                    <div className="actions">
                      <Button variant="primary" onClick={startScan} disabled={!scanEnabled}>
                        {loadingCatalogs ? "Scanning…" : "Scan / Update Operators (5-10 min)"}
                      </Button>
                      <Button variant="secondary" onClick={prefetchCatalogs} disabled={!authAvailable || prefetching}>
                        {prefetching ? "Prefetching…" : "Prefetch catalogs"}
                      </Button>
                    </div>
              </CollapsibleSection>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Scan Status" defaultCollapsed={!shouldExpandScanStatus}>
              <div className="scan-status-list">
                {["redhat", "certified", "community"].map((catalogId) => {
                  const status = jobStatuses[catalogId];
                  const isFailed = status?.status === "failed";
                  const isStale = isFailed && status?.message?.includes("Server restarted");
                  const failedOutput = isFailed && !isStale ? status?.output : "";
                  const failedLine = isStale
                    ? "Scan was interrupted by a server or page reload. Use Prefetch catalogs to run again."
                    : isFailed
                      ? (status?.message || "") + (failedOutput ? ` — ${failedOutput}` : "")
                      : (status?.message || "");
                  const progressPercent =
                    status?.status === "completed"
                      ? 100
                      : status?.status === "failed"
                        ? (status?.progress ?? 0)
                        : (displayProgress[catalogId] ?? status?.progress ?? 0);
                  const createdAt = status?.created_at ?? status?.createdAt;
                  const elapsedMin = typeof createdAt === "number" && (status?.status === "running" || status?.status === "queued")
                    ? Math.floor((Date.now() - createdAt) / 60_000)
                    : null;
                  const elapsedLabel = elapsedMin != null && elapsedMin >= 1
                    ? ` (started ${elapsedMin} min ago)`
                    : "";
                  return (
                    <div key={catalogId} className="scan-status-card">
                      <div className="scan-status-card-main">
                        <strong>{catalogId === "redhat" ? "Red Hat" : catalogId === "certified" ? "Certified" : "Community"}</strong>
                        <span className="subtle scan-status-progress">
                          {status ? `${status.status} • ${progressPercent}%${elapsedLabel}` : "Waiting to scan"}
                        </span>
                      </div>
                      {failedLine ? <div className="subtle scan-status-card-detail">{failedLine}</div> : null}
                    </div>
                  );
                })}
              </div>
          </CollapsibleSection>
        </div>

        <CollapsibleSection title="ImageSet options" defaultCollapsed={false}>
          <OptionRow
            title="Include update graph"
            description="Add graph: true under mirror.platform in ImageSetConfiguration. Required for disconnected clusters to determine upgrade paths via the Cincinnati graph (oc-mirror v2)."
          >
            <Switch
              checked={state.imagesetConfig?.graph !== false}
              onChange={(checked) => updateState({ imagesetConfig: { ...(state.imagesetConfig || {}), graph: checked } })}
              aria-label="Include update graph in ImageSetConfiguration"
            />
          </OptionRow>
          <div style={{ marginTop: 12 }}>
            <FieldLabelWithInfo
              label="Additional images to mirror (optional)"
              hint={`Manually specify additional container images to mirror beyond OpenShift and Operator catalogs.

**What is this:**
A list of container images to include in the mirror operation. Each image is specified by its full registry path and tag.

**When needed:**
**Optional** - only needed if you have custom or third-party images to mirror:
• Internal applications or tools not available in Red Hat catalogs
• Third-party container images required by your workloads
• Custom-built images from your development teams
• Partner applications not available as Operators

**When NOT needed:**
• You're only mirroring OpenShift platform images
• You're only using Red Hat Operator catalog images
• All your workloads use images from Red Hat registries

**Format:**
One image reference per line in the format: \`registry.example.com/repository/image:tag\`

**How it's used:**
Added to the \`mirror.additionalImages\` array in the ImageSetConfiguration YAML. oc-mirror will download these images along with platform and operator images, then push them to your disconnected registry during the mirror operation.

**Example:**
\`\`\`
quay.io/myorg/app:v1.2.3
registry.example.com/tools/monitoring:latest
gcr.io/vendor/database:stable
\`\`\``}
            />
            <textarea
              rows={4}
              style={{ width: "100%", resize: "vertical", fontFamily: "monospace", fontSize: "0.875rem", marginTop: 6 }}
              value={additionalImagesLocal}
              onChange={(e) => setAdditionalImagesLocal(e.target.value)}
              onBlur={(e) => updateState({ imagesetConfig: { ...(state.imagesetConfig || {}), additionalImages: e.target.value } })}
              placeholder={"quay.io/org/app:tag\nregistry.example.com/repo/image:v1.0"}
              aria-label="Additional images to mirror"
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <FieldLabelWithInfo
              label="Archive chunk size — GiB (optional)"
              hint={`Maximum size for each archive file when mirroring to disk for transfer.

**What is this:**
The size limit (in GiB) for individual tar archive files created by oc-mirror when mirroring to disk. When the mirror exceeds this size, oc-mirror splits it into multiple numbered archive files.

**When needed:**
**Optional** - only needed if you need smaller archive files:
• Physical media has size limits (USB drives, portable hard drives)
• File system limits (FAT32 has 4 GiB file limit)
• Network transfer limits
• Easier to manage smaller chunks for sneakernet transfer

**When NOT needed:**
• Default 500 GiB chunks work for your transfer method
• Mirroring directly between registries (not to disk)
• Your transfer media supports files larger than 500 GiB

**Format:**
Positive integer representing GiB (gibibytes). Common values: 100, 200, 500.

**How it's used:**
Sets the top-level \`archiveSize\` field in the ImageSetConfiguration YAML. oc-mirror will split the mirrored content into files named \`mirror_000001.tar\`, \`mirror_000002.tar\`, etc., each up to this size limit.

**Important:**
⚠️ Smaller chunks mean more files to manage during transfer. Balance between file size limits and number of files.

**Example:**
100 — Split into 100 GiB chunks for USB hard drives
200 — Split into 200 GiB chunks for portable storage
(blank) — Use default 500 GiB chunk size`}
            />
            <input
              type="number"
              min={1}
              style={{ maxWidth: 120, marginTop: 6 }}
              value={archiveSizeLocal}
              onChange={(e) => setArchiveSizeLocal(e.target.value)}
              onBlur={(e) => updateState({ imagesetConfig: { ...(state.imagesetConfig || {}), archiveSize: e.target.value } })}
              placeholder="e.g. 100"
              aria-label="Archive chunk size in GiB"
            />
          </div>
        </CollapsibleSection>

        <section className="card">
          <h3 className="card-title">Scenario Quick Picks</h3>
          <p className="card-subtitle">One-click presets for common operator sets.</p>
          <div className="scenario-picks">
            {scenarios.map((scenario) => {
              const isVersionAware = Boolean(scenario.versionPicks);
              const effectiveVersion = isVersionAware ? (scenario.versionPicks[version] ? version : "default") : null;
              const titleText = !scenarioReady
                ? "Scenario picks need operator catalogs"
                : scenario.description
                  ? `${scenario.description}${isVersionAware ? ` (${effectiveVersion})` : ""}`
                  : isVersionAware
                    ? `Version-aware quick pick (${effectiveVersion})`
                    : "";

              return (
                <button
                  key={scenario.id}
                  type="button"
                  className={`scenario-pick ${scenarioSelections?.[scenario.id] ? "selected" : ""}`}
                  onClick={() => handleScenarioClick(scenario)}
                  title={titleText}
                  disabled={!scenarioReady}
                >
                  <span className="scenario-pick-label">{scenario.label}</span>
                  {isVersionAware && effectiveVersion && (
                    <span className="scenario-pick-version subtle" aria-label={`for OpenShift ${effectiveVersion}`}>
                      {effectiveVersion}
                    </span>
                  )}
                  {scenarioSelections?.[scenario.id] ? <span className="scenario-pick-check" aria-hidden>✓</span> : null}
                </button>
              );
            })}
          </div>
        </section>

        <section className="card">
        <div className="selected-operators-header">
          <div className="selected-operators-title">
            <h3>Selected Operators</h3>
            {selected.length > 0 && <span className="operator-count">({selected.length})</span>}
          </div>
          {selected.length > 0 && (
            <Button variant="ghost" onClick={clearAllSelections}>
              Clear selections
            </Button>
          )}
        </div>
        <div
          className="selected-grid-wrapper"
          style={{
            maxHeight: `${Math.min(selectedGridRows, actualRowCount) * 140}px`
          }}
        >
          <div ref={selectedGridRef} className="selected-grid">
            {selected.length === 0 ? <div className="subtle">No operators selected.</div> : null}
            {selected.map((op) => (
              <div key={op.id} className="selected-card">
                <div className="operator-name">{op.name}</div>
                <div className="subtle">default channel: {op.defaultChannel || "unknown"}</div>
                {op.displayName ? <div className="subtle">{op.displayName}</div> : null}
                <button className="ghost" onClick={() => removeOperator(op.id)}>Remove</button>
              </div>
            ))}
          </div>
        </div>
        {actualRowCount > 2 && (
          <div
            className="selected-grid-resize-handle"
            onMouseDown={startResize}
          >
            <div className="resize-handle-bar"></div>
          </div>
        )}
        </section>

        <section className="card">
        <div className="tabs">
          {["redhat", "certified", "community"].map((tab) => (
            <button
              key={tab}
              className={`tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "redhat" ? "Red Hat" : tab === "certified" ? "Certified" : "Community"}
            </button>
          ))}
        </div>
        <div className="operator-scroll">
          {loadingCatalogs && !(filteredCatalogs[activeTab] || []).length ? (
            <div className="loading">Loading operators…</div>
          ) : null}
          <div className="operator-grid">
            {(filteredCatalogs[activeTab] || []).map((op) => (
              <button key={op.id} className="operator-card" onClick={() => selectOperator(op)}>
                <div className="operator-name">{op.name}</div>
                <div className="subtle">default channel: {op.defaultChannel || "unknown"}</div>
                {op.displayName ? <div className="subtle">{op.displayName}</div> : null}
                <span className="operator-add">Add</span>
              </button>
            ))}
          </div>
        </div>
        </section>
      </div>
    </div>
  );
};

export default OperatorsStep;
