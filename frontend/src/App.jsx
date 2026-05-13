/**
 * OpenShift Airgap Architect - Main Application
 *
 * Wizard-based UI for generating OpenShift disconnected installation configurations.
 * Supports both legacy flow (Global Strategy, Host Inventory) and segmented flow
 * (Identity & Access, Networking, Connectivity & Mirroring, Trust & Proxy,
 * Platform Specifics, Hosts/Inventory).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppProvider, useApp } from "./store.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Modal from "./components/Modal.jsx";
import LandingPage from "./LandingPage.jsx";
import BlueprintStep from "./steps/BlueprintStep.jsx";
import PlaceholderCard from "./components/PlaceholderCard.jsx";
import MethodologyStep from "./steps/MethodologyStep.jsx";
import HostInventoryStep from "./steps/HostInventoryStep.jsx";
import HostInventoryV2Step from "./steps/HostInventoryV2Step.jsx";
import GlobalStrategyStep from "./steps/GlobalStrategyStep.jsx";
import OperatorsStep from "./steps/OperatorsStep.jsx";
import ReviewStep from "./steps/ReviewStep.jsx";
import RunOcMirrorStep from "./steps/RunOcMirrorStep.jsx";
import OperationsStep from "./steps/OperationsStep.jsx";
import IdentityAccessStep from "./steps/IdentityAccessStep.jsx";
import NetworkingV2Step from "./steps/NetworkingV2Step.jsx";
import ConnectivityMirroringStep from "./steps/ConnectivityMirroringStep.jsx";
import TrustProxyStep from "./steps/TrustProxyStep.jsx";
import PlatformSpecificsStep from "./steps/PlatformSpecificsStep.jsx";
import HostsInventorySegmentStep from "./steps/HostsInventorySegmentStep.jsx";
import ScenarioHeaderPanel from "./components/ScenarioHeaderPanel.jsx";
import ToolsDrawer from "./components/ToolsDrawer.jsx";
import FeedbackDrawer from "./components/FeedbackDrawer.jsx";
import YamlDrawer from "./components/YamlDrawer.jsx";
import {
  validateStep,
  validateBlueprintPullSecretOptional,
  reconcileReviewFlagsForImportedState
} from "./validation.js";
import { computeVisibleWizardRows, findFirstAttentionStepIndex } from "./wizardVisibleSteps.js";
import { getScenarioId } from "./catalogResolver.js";
import { SCENARIO_IDS_WITH_HOST_INVENTORY } from "./hostInventoryV2Helpers.js";
import { getOpenShiftMinorFromState } from "./shared/openShiftMinor.js";
import { apiFetch } from "./api.js";
import { getFeedbackConfig } from "./feedbackApi.js";
import { getVersionDependentStepIdSet } from "./wizardVersionGate.js";

/** Used for Landing banner and tests; true only when update is available and no error/unknown. */
export function shouldShowUpdateBanner(updateInfo) {
  if (!updateInfo?.enabled || !updateInfo?.isOutdated || updateInfo?.error) return false;
  const cur = updateInfo?.currentSha && String(updateInfo.currentSha).toLowerCase();
  const lat = updateInfo?.latestSha && String(updateInfo.latestSha).toLowerCase();
  if (!cur || cur === "unknown" || !lat || lat === "unknown") return false;
  return true;
}
import { logAction } from "./logger.js";
import { getExportRunFilename } from "./exportRunFilename.js";

const COMPONENT_MAP = {
  "blueprint": BlueprintStep,
  "install-method": MethodologyStep,
  methodology: MethodologyStep,
  "cluster-identity": () => <PlaceholderCard title="Cluster identity" />,
  inventory: HostInventoryStep,
  "inventory-v2": HostInventoryV2Step,
  networking: GlobalStrategyStep,
  global: GlobalStrategyStep,
  "disconnected-proxy": () => <PlaceholderCard title="Disconnected and proxy" />,
  operators: OperatorsStep,
  "review-generate": ReviewStep,
  review: ReviewStep,
  "run-oc-mirror": RunOcMirrorStep,
  operations: OperationsStep,
  "identity-access": IdentityAccessStep,
  "networking-v2": NetworkingV2Step,
  "connectivity-mirroring": ConnectivityMirroringStep,
  "trust-proxy": TrustProxyStep,
  "platform-specifics": PlatformSpecificsStep,
  "hosts-inventory": HostsInventorySegmentStep
};

const FALLBACK_WIZARD_STEPS = [
  { stepNumber: 1, id: "blueprint", label: "Blueprint", subSteps: [], component: BlueprintStep },
  { stepNumber: 2, id: "methodology", label: "Methodology", subSteps: [], component: MethodologyStep },
  { stepNumber: 3, id: "global", label: "Global Strategy", subSteps: [{ id: "network-wide", label: "Network-wide" }, { id: "vips-ingress", label: "VIPs and ingress" }, { id: "dhcp-static", label: "DHCP vs Static plan" }, { id: "advanced-networking", label: "Advanced networking", collapsedByDefault: true }], component: GlobalStrategyStep },
  { stepNumber: 4, id: "inventory", label: "Host Inventory", subSteps: [], component: HostInventoryStep },
  { stepNumber: 5, id: "operators", label: "Operators", subSteps: [], component: OperatorsStep },
  { stepNumber: 6, id: "review", label: "Assets & Guide", subSteps: [], component: ReviewStep },
  { stepNumber: 7, id: "run-oc-mirror", label: "Run oc-mirror", subSteps: [], component: RunOcMirrorStep },
  { stepNumber: 8, id: "operations", label: "Operations", subSteps: [], component: OperationsStep }
];

/** Maps OLD step ids (from pre–stepMap flow) to NEW step ids. "start" is Step 0 and is never legacy. */
const LEGACY_STEP_ID_MAP = {
  "core-lock-in": "blueprint",
  blueprint: "blueprint",
  release: "blueprint",
  "install-method": "methodology",
  methodology: "methodology",
  "cluster-identity": "global",
  global: "global",
  networking: "global",
  inventory: "inventory",
  "inventory-v2": "inventory-v2",
  operators: "operators",
  "review-generate": "review",
  review: "review",
  "run-oc-mirror": "run-oc-mirror",
  operations: "operations",
  "identity-access": "identity-access",
  "networking-v2": "networking-v2",
  "connectivity-mirroring": "connectivity-mirroring",
  "trust-proxy": "trust-proxy",
  "platform-specifics": "platform-specifics",
  "hosts-inventory": "hosts-inventory"
};

function getOcMirrorJobMetadata(job) {
  if (!job?.metadata_json) return null;
  try {
    return typeof job.metadata_json === "string"
      ? JSON.parse(job.metadata_json)
      : job.metadata_json;
  } catch {
    return null;
  }
}

function buildWizardSteps(stepMap) {
  if (!stepMap?.mvpSteps?.length) return FALLBACK_WIZARD_STEPS;
  const wizard = stepMap.mvpSteps
    .filter((s) => s.stepNumber >= 1)
    .map((s) => ({
      stepNumber: s.stepNumber,
      id: s.id,
      label: s.label,
      subSteps: s.subSteps || [],
      component: COMPONENT_MAP[s.id] || (() => <PlaceholderCard title={s.label} />)
    }));
  return wizard.length ? wizard : FALLBACK_WIZARD_STEPS;
}

/** Error boundary with optional fallback message and refresh. Never logs or exposes secrets. */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      const message = this.props.fallbackMessage ?? "Something went wrong; refresh or go back.";
      return (
        <div className="app-loading" role="alert">
          <div>
            <h3>{message}</h3>
            {this.props.showRefresh !== false ? (
              <button type="button" className="primary" onClick={() => window.location.reload()}>
                Refresh page
              </button>
            ) : null}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const AppShell = () => {
  const { state, loading, startOver, updateState, setState } = useApp();
  const [active, setActive] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showReleaseWarning, setShowReleaseWarning] = useState(false);
  const [showBlueprintWarning, setShowBlueprintWarning] = useState(false);
  const [showCoreLockWarning, setShowCoreLockWarning] = useState(false);
  const [lockAndProceedLoading, setLockAndProceedLoading] = useState(false);
  const [showStartOverConfirm, setShowStartOverConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showSwitchFlowConfirm, setShowSwitchFlowConfirm] = useState(false);
  const [pendingSwitchFlow, setPendingSwitchFlow] = useState(null);
  const [validationModal, setValidationModal] = useState(null);
  const [highlightErrors, setHighlightErrors] = useState(false);
  const [pendingNavIndex, setPendingNavIndex] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("airgap-theme") || "light");
  const [showPreview, setShowPreview] = useState(false);
  const [previewFiles, setPreviewFiles] = useState({});
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewRequestIdRef = useRef(0);
  const [confirmingRelease, setConfirmingRelease] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [showStartOverModal, setShowStartOverModal] = useState(false);
  const [startOverRunningJobs, setStartOverRunningJobs] = useState([]);
  const [startOverCheckingJobs, setStartOverCheckingJobs] = useState(false);
  const [startOverCheckError, setStartOverCheckError] = useState("");
  const [stepMap, setStepMap] = useState(null);
  const [blockedMessage, setBlockedMessage] = useState("");
  const [runActionsOpen, setRunActionsOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [jobsCount, setJobsCount] = useState(0);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [yamlDrawerOpen, setYamlDrawerOpen] = useState(false);
  const [lockToast, setLockToast] = useState("");
  const [updateInfo, setUpdateInfo] = useState(null);
  const [buildInfo, setBuildInfo] = useState(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackConfig, setFeedbackConfig] = useState({
    visible: false,
    enabled: false,
    mode: "disabled",
    reason: ""
  });
  const importRef = useRef(null);
  const runActionsRef = useRef(null);
  const prefsRef = useRef(null);
  const mainContentRef = useRef(null);

  useEffect(() => {
    const el = mainContentRef.current;
    if (el && typeof el.scrollTop === "number") el.scrollTop = 0;
  }, [active]);

  useEffect(() => {
    apiFetch("/api/schema/stepMap")
      .then((data) => setStepMap(data))
      .catch(() => setStepMap({}));
  }, []);

  // Build info: fetch once on load. Update info: fetch only when Landing is shown (once on initial Landing, again when user returns to Landing).
  useEffect(() => {
    apiFetch("/api/build-info").then(setBuildInfo).catch(() => setBuildInfo({ gitSha: "unknown", buildTime: "unknown", repo: "", branch: "" }));
  }, []);

  // Developer attribution console message
  useEffect(() => {
    const styles = {
      title: "color: #0066cc; font-size: 20px; font-weight: bold; padding: 10px 0 5px 0;",
      subtitle: "color: #666; font-size: 14px;",
      info: "color: #333; font-size: 13px;",
      link: "color: #0066cc; font-size: 13px;",
    };
    console.log("%c🚀 OpenShift Airgap Architect", styles.title);
    console.log("%cDeveloped by Bill Strauss", styles.subtitle);
    console.log("%cWith AI assistance from Claude (Anthropic) and Cursor AI", styles.info);
    console.log("%cMIT License • https://github.com/billstrauss/openshift-airgap-architect", styles.link);
  }, []);

  useEffect(() => {
    getFeedbackConfig()
      .then(setFeedbackConfig)
      .catch(() =>
        setFeedbackConfig({
          visible: false,
          enabled: false,
          mode: "disabled",
          reason: "Feedback configuration unavailable."
        })
      );
  }, []);

  // Sync showLanding from loaded state on mount (for imports/restores that have showLanding: false)
  useEffect(() => {
    if (!loading && state?.ui?.showLanding === false) {
      setShowLanding(false);
    }
  }, [loading, state?.ui?.showLanding]);

  useEffect(() => {
    if (!showLanding) return;
    apiFetch("/api/update-info").then(setUpdateInfo).catch(() => setUpdateInfo({ enabled: false, error: "Unavailable" }));
  }, [showLanding]);

  // Operations (N) badge: poll job count when in wizard so header and sidebar can show count (§9.3 placement)
  useEffect(() => {
    if (showLanding) return;
    const load = () => apiFetch("/api/jobs/count").then((d) => setJobsCount(d.count ?? 0)).catch(() => setJobsCount(0));
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [showLanding]);

  const showHostInventory = useMemo(() => {
    const sid = getScenarioId(state);
    return Boolean(sid && SCENARIO_IDS_WITH_HOST_INVENTORY.includes(sid));
  }, [state]);
  const segmentedFlowV1 = state?.ui?.segmentedFlowV1 === true;
  const visibleSteps = useMemo(() => {
    const rows = computeVisibleWizardRows(state, stepMap || {});
    return rows.map((s) => ({
      ...s,
      component: COMPONENT_MAP[s.id] || (() => <PlaceholderCard title={s.label} />)
    }));
  }, [state, stepMap]);

  const foundationalLocked = Boolean(
    state?.blueprint?.confirmed && (state?.version?.versionConfirmed ?? state?.release?.confirmed)
  );

  const sidebarSteps = useMemo(
    () => {
      // Show Operations in sidebar if unlocked (for Cincinnati job visibility) or if locked
      return visibleSteps;
    },
    [visibleSteps]
  );
  const Current = visibleSteps[active]?.component || visibleSteps[0]?.component;
  const activeStepId = visibleSteps[active]?.id;
  const activeStepValidation = useMemo(
    () => (activeStepId && state ? validateStep(state, activeStepId) : {}),
    [state, activeStepId]
  );
  const fieldErrors = activeStepValidation?.fieldErrors || {};
  // Deliverable gating (Workstream D): list of step labels that have errors (for "Complete at least: …" on Review).
  const incompleteStepLabels = useMemo(() => {
    if (!state) return [];
    const reviewIdx = visibleSteps.findIndex((s) => s.id === "review");
    if (reviewIdx <= 0) return [];
    const stepsBeforeReview = visibleSteps.slice(0, reviewIdx);
    return stepsBeforeReview
      .filter((step) => (validateStep(state, step.id).errors || []).length > 0)
      .map((step) => step.label);
  }, [state, visibleSteps]);

  const versionConfirmed = state?.version?.versionConfirmed ?? state?.release?.confirmed;
  const versionDependentSteps = useMemo(
    () => getVersionDependentStepIdSet(segmentedFlowV1, visibleSteps),
    [segmentedFlowV1, visibleSteps]
  );
  const blueprintReady = Boolean(state?.blueprint?.arch && state?.blueprint?.platform);
  const releaseReady = Boolean(getOpenShiftMinorFromState(state) && state?.release?.patchVersion);

  const errorFlags = useMemo(() => {
    if (!state) return {};
    const flags = {};
    visibleSteps.forEach((step) => {
      const result = validateStep(state, step.id);
      flags[step.id] = (result.errors || []).length > 0;
    });
    return flags;
  }, [state, visibleSteps]);

  const blueprintPullSecretBlocking = useMemo(() => {
    const ephemeral = (state?.blueprint?.blueprintPullSecretEphemeral || "").trim();
    if (!ephemeral) return false;
    return !validateBlueprintPullSecretOptional(ephemeral).valid;
  }, [state?.blueprint?.blueprintPullSecretEphemeral]);

  // Checkmarks only after Proceed is clicked with no validation errors. Visiting a tab never adds a checkmark; skip or "proceed anyway" → needs review.
  const completeFlags = useMemo(() => {
    if (!state) return {};
    const flags = {};
    visibleSteps.forEach((step) => {
      const result = validateStep(state, step.id);
      const valid = (result.errors || []).length === 0;
      const versionOk = versionDependentSteps.has(step.id) ? Boolean(versionConfirmed) : true;
      const needsReview = Boolean(state.reviewFlags?.[step.id]);
      const explicitlyCompleted = Boolean(state.ui?.completedSteps?.[step.id]);
      const completed =
        step.id === "blueprint"
          ? Boolean(state.blueprint?.confirmed && (state?.version?.versionConfirmed ?? state?.release?.confirmed))
          : valid && explicitlyCompleted && !needsReview && versionOk;
      flags[step.id] = completed;
    });
    return flags;
  }, [state, visibleSteps, versionConfirmed, versionDependentSteps]);

  const canProceed = useMemo(() => true, []);

  // Install progress: any visited or completed step (reuses existing state, no new system).
  const hasProgress = useMemo(() => {
    const visited = state?.ui?.visitedSteps && Object.keys(state.ui.visitedSteps).length > 0;
    const completed = state?.ui?.completedSteps && Object.keys(state.ui.completedSteps).length > 0;
    return Boolean(visited || completed);
  }, [state?.ui?.visitedSteps, state?.ui?.completedSteps]);

  // First incomplete step for resume: earliest step not in completedSteps (so we don't skip Methodology when only Blueprint is done).
  const firstIncompleteStepIndex = useMemo(() => {
    const idx = visibleSteps.findIndex((step) => {
      if (step.id === "blueprint") {
        return !(state?.blueprint?.confirmed && (state?.version?.versionConfirmed ?? state?.release?.confirmed));
      }
      return !state?.ui?.completedSteps?.[step.id];
    });
    return idx >= 0 ? idx : Math.max(0, visibleSteps.length - 1);
  }, [visibleSteps, state?.ui?.completedSteps, state?.blueprint?.confirmed, state?.version?.versionConfirmed, state?.release?.confirmed]);

  const previewStepId = visibleSteps[active]?.id;
  const hasRunningOcMirrorJobs = startOverRunningJobs.length > 0;
  const startOverArtifactPaths = useMemo(() => {
    const paths = new Set();
    startOverRunningJobs.forEach((job) => {
      const meta = getOcMirrorJobMetadata(job);
      if (meta?.archiveDir) paths.add(meta.archiveDir);
      if (meta?.workspaceDir) paths.add(meta.workspaceDir);
      if (meta?.cacheDir) paths.add(meta.cacheDir);
    });
    if (!paths.size) {
      const archivePath = state?.mirrorWorkflow?.archivePath?.trim();
      const workspacePath = state?.mirrorWorkflow?.workspacePath?.trim();
      const cachePath = state?.mirrorWorkflow?.cachePath?.trim();
      if (archivePath) paths.add(archivePath);
      if (workspacePath) paths.add(workspacePath);
      if (cachePath) paths.add(cachePath);
    }
    return Array.from(paths);
  }, [
    startOverRunningJobs,
    state?.mirrorWorkflow?.archivePath,
    state?.mirrorWorkflow?.workspacePath,
    state?.mirrorWorkflow?.cachePath
  ]);
  const previewTarget = useMemo(() => {
    if (previewStepId === "review") return "install-config.yaml";
    if (previewStepId === "global") return "install-config.yaml";
    return "install-config.yaml";
  }, [previewStepId]);
  const previewEnabled = useMemo(() => {
    // Enable preview on all steps after Blueprint lock-in, except landing/blueprint/review/operations
    const locked = Boolean(
      state?.blueprint?.confirmed &&
      (state?.version?.versionConfirmed ?? state?.release?.confirmed)
    );
    const excludedSteps = ["landing", "blueprint", "review", "operations"];
    return locked && !excludedSteps.includes(previewStepId);
  }, [previewStepId, state?.blueprint?.confirmed, state?.version?.versionConfirmed, state?.release?.confirmed]);
  const yamlDrawerScenario = useMemo(() => ({
    isAgentBased: state?.methodology?.method === "Agent-Based Installer" &&
                  (state?.blueprint?.platform === "Bare Metal" ||
                   state?.blueprint?.platform === "VMware vSphere"),
    platform: state?.blueprint?.platform,
    method: state?.methodology?.method
  }), [state?.methodology?.method, state?.blueprint?.platform]);
  const feedbackScenarioContext = useMemo(
    () => ({
      platform: state?.blueprint?.platform || "",
      methodology: state?.methodology?.method || "",
      connectivity: state?.docs?.connectivity || "",
      version: state?.release?.patchVersion || "",
      scenarioId: getScenarioId(state) || ""
    }),
    [state]
  );
  const extraPreviewFiles = useMemo(() => {
    if (!previewFiles) return [];
    return Object.entries(previewFiles).filter(([name]) => name.startsWith("99-chrony-ntp-"));
  }, [previewFiles]);

  useEffect(() => {
    if (!previewEnabled && showPreview) {
      setShowPreview(false);
    }
  }, [previewEnabled, showPreview]);

  useEffect(() => {
    if (active >= visibleSteps.length) {
      setActive(Math.max(0, visibleSteps.length - 1));
    }
  }, [visibleSteps.length, active]);

  // Route guard: before lock, only Blueprint is allowed. Redirect any other route to Blueprint.
  useEffect(() => {
    if (showLanding || !state?.ui) return;
    if (foundationalLocked) return;
    const blueprintIndex = visibleSteps.findIndex((s) => s.id === "blueprint");
    if (blueprintIndex < 0) return;
    if (active !== blueprintIndex) {
      setActive(blueprintIndex);
      updateState({ ui: { ...state.ui, activeStepId: "blueprint" } });
      setLockToast("Lock your foundational selections to continue.");
      const t = setTimeout(() => setLockToast(""), 4000);
      return () => clearTimeout(t);
    }
  }, [showLanding, state, foundationalLocked, active, visibleSteps, updateState]);

  // Required-field highlighting (Workstream D): when landing on a step with errors, show highlights; clear when step has no errors.
  useEffect(() => {
    const stepId = visibleSteps[active]?.id;
    if (!stepId || !state) return;
    const result = validateStep(state, stepId);
    const hasErrors = (result.errors || []).length > 0;
    setHighlightErrors(hasErrors);
  }, [active, visibleSteps, state]);

  // Sync active step index from persisted activeStepId. Fires on every change so programmatic
  // navigation (e.g. "View full logs in Operations") actually moves the user to the target step.
  const lastSyncedActiveStepId = useRef(null);
  useEffect(() => {
    if (!state?.ui?.activeStepId || !visibleSteps.length) return;
    if (state.ui.activeStepId === lastSyncedActiveStepId.current) return;
    const currentStepId = visibleSteps[active]?.id;
    if (state.ui.activeStepId === currentStepId) {
      lastSyncedActiveStepId.current = state.ui.activeStepId;
      return;
    }
    const idx = visibleSteps.findIndex((s) => s.id === state.ui.activeStepId);
    if (idx >= 0) {
      setActive(idx);
      lastSyncedActiveStepId.current = state.ui.activeStepId;
    }
  }, [state?.ui?.activeStepId, visibleSteps, active]);

  useEffect(() => {
    if (!state?.ui) return;
    if (!showHostInventory && state.ui.activeStepId === "inventory") {
      const currentId = visibleSteps[active]?.id || "global";
      updateState({ ui: { ...state.ui, activeStepId: currentId } });
    }
  }, [showHostInventory, state?.ui?.activeStepId, visibleSteps, active, updateState, state?.ui]);

  // Segmented flow: when user was on Hosts and methodology no longer has host inventory, move to step at current index (e.g. Operators).
  useEffect(() => {
    if (!state?.ui || !segmentedFlowV1) return;
    const hasHostsStep = visibleSteps.some((s) => s.id === "hosts-inventory");
    if (hasHostsStep || state.ui.activeStepId !== "hosts-inventory") return;
    const fallbackId = visibleSteps[active]?.id ?? "operators";
    updateState({ ui: { ...state.ui, activeStepId: fallbackId } });
  }, [segmentedFlowV1, state?.ui?.activeStepId, visibleSteps, active, updateState, state?.ui]);

  useEffect(() => {
    if (!state?.ui) return;
    if (showLanding) return;
    const currentStepId = visibleSteps[active]?.id;
    if (!currentStepId) return;
    const visitedSteps = { ...(state.ui.visitedSteps || {}) };
    if (!visitedSteps[currentStepId]) {
      visitedSteps[currentStepId] = true;
      updateState({ ui: { ...state.ui, visitedSteps } });
    }
  }, [active, visibleSteps, state?.ui, showLanding, updateState]);

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem("airgap-theme", theme);
  }, [theme]);

  useEffect(() => {
    const close = (e) => {
      if (runActionsRef.current && !runActionsRef.current.contains(e.target)) setRunActionsOpen(false);
      if (prefsRef.current && !prefsRef.current.contains(e.target)) setPrefsOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    if (!showPreview) return;

    const confirmed = state?.version?.versionConfirmed ?? state?.release?.confirmed;
    if (!confirmed) {
      // Show skeleton YAML before version confirmation
      setPreviewError("");
      setPreviewFiles({
        "install-config.yaml": `apiVersion: v1
baseDomain: example.com
metadata:
  name: cluster-name
# Complete configuration after confirming OpenShift version`,
        "agent-config.yaml": state?.methodology?.method === "Agent-Based Installer" ?
          `apiVersion: v1beta1
kind: AgentConfig
metadata:
  name: cluster-name
# Complete configuration after confirming OpenShift version` : null
      });
      return;
    }

    setPreviewError("");
    setPreviewLoading(true);

    // Track request ID to ignore stale responses when typing fast
    previewRequestIdRef.current += 1;
    const currentRequestId = previewRequestIdRef.current;

    apiFetch("/api/generate")
      .then((data) => {
        // Only apply result if this is still the latest request
        if (currentRequestId === previewRequestIdRef.current) {
          logAction("generate_preview", { stepId: previewStepId });
          setPreviewFiles(data.files || {});
          setPreviewLoading(false);
        }
      })
      .catch((error) => {
        // Only show error if this is still the latest request
        if (currentRequestId === previewRequestIdRef.current) {
          setPreviewError(String(error?.message || error));
          setPreviewLoading(false);
        }
      });
  }, [
    showPreview,
    previewStepId,
    state?.release?.patchVersion,
    state?.blueprint?.platform,
    state?.blueprint?.confirmed,
    state?.methodology?.method,
    // Track individual fields that affect YAML generation
    state?.blueprint?.clusterName,
    state?.blueprint?.baseDomain,
    state?.globalStrategy?.fips,
    state?.globalStrategy?.proxyEnabled,
    state?.globalStrategy?.proxies,
    state?.globalStrategy?.mirroring,
    state?.credentials?.pullSecret,
    state?.credentials?.sshKey,
    state?.credentials?.username,
    state?.credentials?.password,
    state?.trust?.bundle,
    state?.trust?.policy,
    state?.platformConfig?.region,
    state?.platformConfig?.instanceType,
    state?.platformConfig?.replicas,
    state?.hostInventory?.nodes,
    state?.hostInventory?.vips,
    state?.operators?.selected,
    // Full state for other changes
    state
  ]);

  const setActiveStep = (nextIndex, options = {}) => {
    const index = Math.max(0, Math.min(nextIndex, visibleSteps.length - 1));
    const prevStepId = visibleSteps[active]?.id;
    const nextStepId = visibleSteps[index]?.id;
    const visitedSteps = { ...(state.ui?.visitedSteps || {}) };
    const completedSteps = { ...(state.ui?.completedSteps || {}) };
    if (prevStepId) visitedSteps[prevStepId] = true;
    if (nextStepId) visitedSteps[nextStepId] = true;
    if (options.markComplete && prevStepId === options.markComplete) {
      completedSteps[prevStepId] = true;
    }

    const nextReviewFlags = { ...(state.reviewFlags || {}) };
    if (prevStepId && prevStepId !== nextStepId) {
      if (options.skipReviewForStep && prevStepId === options.skipReviewForStep) {
        nextReviewFlags[prevStepId] = false;
      } else {
        const validation = validateStep(state, prevStepId);
        if (validation.errors?.length) {
          nextReviewFlags[prevStepId] = true;
        } else {
          if (nextReviewFlags[prevStepId]) nextReviewFlags[prevStepId] = false;
          const autoCompleteOnValidLeave = new Set(["hosts-inventory", "inventory-v2", "inventory"]);
          if (autoCompleteOnValidLeave.has(prevStepId)) {
            completedSteps[prevStepId] = true;
          }
        }
      }
    }

    setActive(index);
    if (pendingNavIndex !== null) {
      setPendingNavIndex(null);
    }
    if (prevStepId !== nextStepId) {
      logAction("step_change", { fromStepId: prevStepId, toStepId: nextStepId });
    }
    if (nextStepId && state.ui?.activeStepId !== nextStepId) {
      updateState({
        ui: {
          ...state.ui,
          activeStepId: nextStepId,
          visitedSteps,
          completedSteps
        },
        reviewFlags: nextReviewFlags
      });
    } else if (JSON.stringify(nextReviewFlags) !== JSON.stringify(state.reviewFlags || {})) {
      updateState({
        reviewFlags: nextReviewFlags,
        ui: { ...state.ui, visitedSteps, completedSteps }
      });
    }
  };

  const advance = () => setActiveStep(active + 1);

  const attemptNavigate = (nextIndex) => {
    const index = Math.max(0, Math.min(nextIndex, visibleSteps.length - 1));
    const targetStepId = visibleSteps[index]?.id;
    const blueprintIndex = visibleSteps.findIndex((s) => s.id === "blueprint");

    if (!foundationalLocked) {
      if (targetStepId !== "blueprint") {
        setLockToast("Lock your foundational selections to continue.");
        setTimeout(() => setLockToast(""), 4000);
        if (active !== blueprintIndex) setActive(blueprintIndex);
        return;
      }
      setLockToast("");
    }

    if (index <= active) {
      setActiveStep(index);
      return;
    }
    const currentStep = visibleSteps[active]?.id;
    if (currentStep === "blueprint" && !foundationalLocked) {
      setPendingNavIndex(index);
      setShowCoreLockWarning(true);
      return;
    }
    const result = validateStep(state, currentStep);
    const hasErrors = result.errors?.length > 0;
    if (hasErrors) setHighlightErrors(true);
    setActiveStep(index, !hasErrors && currentStep ? { markComplete: currentStep } : {});
  };
  const proceed = () => attemptNavigate(active + 1);
  const back = () => {
    if (active === 0) {
      setShowLanding(true);
    } else {
      setActiveStep(active - 1);
    }
  };
  const confirmBlueprintAndProceed = () => {
    if (!blueprintReady) return;
    setShowBlueprintWarning(false);
    setHighlightErrors(false);
    updateState({
      blueprint: {
        ...state.blueprint,
        confirmed: true,
        confirmationTimestamp: Date.now()
      },
      reviewFlags: { ...(state.reviewFlags || {}), blueprint: false }
    });
    const target = pendingNavIndex ?? active;
    setPendingNavIndex(null);
    setActiveStep(target, { skipReviewForStep: "blueprint" });
  };

  const confirmReleaseAndProceed = async () => {
    if (!releaseReady || confirmingRelease) return;
    setConfirmingRelease(true);
    try {
      const data = await apiFetch("/api/operators/confirm", { method: "POST" });
      setHighlightErrors(false);
      updateState({
        release: { ...state.release, confirmed: true },
        version: data.version,
        reviewFlags: { ...(state.reviewFlags || {}), release: false }
      });
      setShowReleaseWarning(false);
      const target = pendingNavIndex ?? active + 1;
      setPendingNavIndex(null);
      setActiveStep(target, { skipReviewForStep: "blueprint", markComplete: "blueprint" });
    } finally {
      setConfirmingRelease(false);
    }
  };
  const handleInstallClick = async () => {
    // If no progress (fresh start), clear state like Start Over does
    if (!hasProgress) {
      const nextState = await startOver({ cancelRunningOcMirror: false });
      if (nextState) setState(nextState);
    }
    setShowLanding(false);
    const nextIndex = hasProgress ? firstIncompleteStepIndex : 0;
    setActive(nextIndex);
    const stepId = visibleSteps[nextIndex]?.id;
    if (stepId && state?.ui) {
      updateState({
        ui: {
          ...state.ui,
          activeStepId: stepId,
          visitedSteps: { ...(state.ui.visitedSteps || {}), [stepId]: true }
        }
      });
    }
  };

  const handleStartOverClick = async () => {
    setShowStartOverModal(true);
    setStartOverRunningJobs([]);
    setStartOverCheckError("");
    setStartOverCheckingJobs(true);
    try {
      const data = await apiFetch("/api/jobs?type=oc-mirror-run");
      const running = (data.jobs || []).filter((job) => job.status === "running");
      setStartOverRunningJobs(running);
    } catch (error) {
      setStartOverCheckError(String(error?.message || error));
      setStartOverRunningJobs([]);
    } finally {
      setStartOverCheckingJobs(false);
    }
  };

  const lockAndProceed = async () => {
    if (!blueprintReady || !releaseReady || lockAndProceedLoading) return;
    const ephemeralSecret = (state.blueprint?.blueprintPullSecretEphemeral || "").trim();
    const secretValid = ephemeralSecret && validateBlueprintPullSecretOptional(ephemeralSecret).valid;
    setLockAndProceedLoading(true);
    try {
      const data = await apiFetch("/api/operators/confirm", { method: "POST" });
      updateState({
        blueprint: {
          ...state.blueprint,
          confirmed: true,
          confirmationTimestamp: Date.now(),
          ...(state.blueprint?.blueprintRetainPullSecret ? {} : { blueprintPullSecretEphemeral: undefined })
        },
        release: data.release ?? { ...state.release, confirmed: true },
        version: data.version ?? state.version,
        reviewFlags: { ...(state.reviewFlags || {}), blueprint: false, release: false },
        ...(state.blueprint?.blueprintRetainPullSecret && secretValid
          ? { credentials: { ...state.credentials, pullSecretPlaceholder: ephemeralSecret } }
          : {})
      });
      setShowCoreLockWarning(false);
      const patchVersion = data.release?.patchVersion ?? state.release?.patchVersion;
      if (patchVersion) {
        apiFetch("/api/aws/warm-installer", {
          method: "POST",
          body: JSON.stringify({ version: patchVersion, arch: state.blueprint?.arch })
        }).catch(() => {});
      }
      if (secretValid) {
        try {
          const scanData = await apiFetch("/api/operators/scan", {
            method: "POST",
            body: JSON.stringify({ pullSecret: ephemeralSecret })
          });
          const scanJobs = scanData?.jobs && Object.keys(scanData.jobs).length ? scanData.jobs : {};
          if (Object.keys(scanJobs).length) {
            updateState({
              operators: {
                ...state.operators,
                scanJobs
              }
            });
          }
        } catch {
          // scan failed; user can start scan from Operators step
        }
      }
      const target = pendingNavIndex ?? active + 1;
      setPendingNavIndex(null);
      setActiveStep(target, { skipReviewForStep: "blueprint", markComplete: "blueprint" });
    } finally {
      setLockAndProceedLoading(false);
    }
  };

  const confirmStartOver = async () => {
    const nextState = await startOver({ cancelRunningOcMirror: hasRunningOcMirrorJobs });
    if (nextState) setState(nextState);
    setShowStartOverModal(false);
    setStartOverRunningJobs([]);
    setStartOverCheckError("");
    setShowLanding(true);
    setActive(0);
    // Close YAML drawer on start over
    setYamlDrawerOpen(false);
    setShowPreview(false);
  };

  const exportRun = async () => {
    const filename = getExportRunFilename(state);
    logAction("export_run", { filename });
    const data = await apiFetch("/api/run/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importRun = async (file) => {
    if (!file) return;
    logAction("import_run");
    const text = await file.text();
    const payload = JSON.parse(text);
    const data = await apiFetch("/api/run/import", { method: "POST", body: JSON.stringify(payload) });
    setIsToolsOpen(false);

    // Clear the file input value so re-selecting the same file will trigger onChange
    if (importRef.current) {
      importRef.current.value = "";
    }

    const baseState = data.state || {};
    const ui = baseState.ui || {};
    const rowState =
      ui.segmentedFlowV1 == null
        ? { ...baseState, ui: { ...ui, segmentedFlowV1: true } }
        : baseState;
    const rows = computeVisibleWizardRows(rowState, stepMap || {});
    const stepIds = rows.map((r) => r.id);
    const reviewFlags = reconcileReviewFlagsForImportedState(rowState, stepIds);
    const merged = { ...rowState, reviewFlags };

    const importedUi = merged.ui || {};
    const importedLocked = Boolean(
      merged.blueprint?.confirmed &&
      (merged.version?.versionConfirmed ?? merged.release?.confirmed)
    );

    if (importedUi.showLanding === true) {
      setState(merged);
      setActive(0);
      return;
    }

    // Hide landing page when importing a state that doesn't explicitly request it
    setShowLanding(false);

    let targetIdx = 0;
    let targetStepId = rows[0]?.id || "blueprint";

    if (!importedLocked) {
      const blueprintIdx = rows.findIndex((s) => s.id === "blueprint");
      targetIdx = blueprintIdx >= 0 ? blueprintIdx : 0;
      targetStepId = rows[targetIdx]?.id || "blueprint";
    } else {
      const attnIdx = findFirstAttentionStepIndex(rows, merged);
      if (attnIdx >= 0) {
        targetIdx = attnIdx;
        targetStepId = rows[targetIdx].id;
      } else {
        const stepId = LEGACY_STEP_ID_MAP[importedUi.activeStepId] || importedUi.activeStepId || "blueprint";
        const idx = rows.findIndex((s) => s.id === stepId);
        targetIdx = idx >= 0 ? idx : 0;
        targetStepId = rows[targetIdx]?.id || stepId;
      }
    }

    const nextUi = {
      ...importedUi,
      activeStepId: targetStepId,
      visitedSteps: { ...(importedUi.visitedSteps || {}), [targetStepId]: true }
    };

    setState({ ...merged, ui: nextUi });
    setActive(targetIdx);
  };

  if (loading || !state) {
    return <div className="app-loading">Loading Airgap Architect…</div>;
  }

  if (showLanding) {
    return (
      <div className="app-shell">
        <header className="app-header">
          <div className="brand">
            <img
              className="brand-banner"
              src="/airgap-architect-banner.png"
              alt="Red Hat OpenShift Airgap Architect"
            />
          </div>
          <div className="header-actions">
            {hasProgress ? (
              <button type="button" className="ghost" onClick={handleStartOverClick}>
                Start Over
              </button>
            ) : null}
          </div>
        </header>
        {shouldShowUpdateBanner(updateInfo) ? (
          <div className="update-available-banner" role="status">
            <strong>Update available</strong>
            {" "}
            (current: {(updateInfo.currentSha || "").slice(0, 7)}, latest: {(updateInfo.latestSha || "").slice(0, 7)} on {updateInfo.branch || "main"}).
            {" "}
            See Tools → About for update steps.
          </div>
        ) : null}
        <div className="app landing-view">
          <div className="content landing-content">
            <LandingPage hasProgress={hasProgress} onStartInstall={handleInstallClick} />
          </div>
        </div>
        <Modal
          isOpen={showStartOverModal}
          onClose={() => setShowStartOverModal(false)}
          ariaLabelledBy="start-over-title"
        >
          <h3 id="start-over-title">Start Over</h3>
          <p className="subtle">
            This will clear all selections, lock-ins, and user entries, and return you to the landing page.
          </p>
          {startOverCheckingJobs ? (
            <div className="note subtle">Checking for active oc-mirror runs…</div>
          ) : null}
          {startOverCheckError ? (
            <div className="note warning">
              Could not verify oc-mirror run status. Continuing with Start Over will still cancel any tracked running oc-mirror jobs.
            </div>
          ) : null}
          {!startOverCheckingJobs && hasRunningOcMirrorJobs ? (
            <>
              <div className="note subtle">
                Active oc-mirror runs: <strong>{startOverRunningJobs.length}</strong>
              </div>
              <div className="note warning">
                An oc-mirror run is currently active. Continuing will cancel that run and may leave partial or incomplete mirror content on disk.
              </div>
              <div className="note subtle">
                Review and validate these paths before restarting a mirror run:
                <ul style={{ marginTop: 6, marginBottom: 0 }}>
                  {startOverArtifactPaths.map((p) => (
                    <li key={p}><code>{p}</code></li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
          <div className="actions">
            <button type="button" className="ghost" onClick={() => setShowStartOverModal(false)}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={confirmStartOver} disabled={startOverCheckingJobs}>
              {hasRunningOcMirrorJobs ? "Yes, cancel run and start over" : "Yes, start over"}
            </button>
          </div>
        </Modal>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {!showLanding ? (
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
      ) : null}
      <header className="app-header">
        <div className="brand">
          <button className="ghost icon-button" onClick={() => setSidebarOpen((prev) => !prev)} aria-label="Toggle navigation">
            ☰
          </button>
          <img
            className="brand-banner"
            src="/airgap-architect-banner.png"
            alt="Red Hat OpenShift Airgap Architect"
          />
        </div>
        <div className="header-actions">
          {previewEnabled && (
            <button
              type="button"
              className="ghost icon-button"
              onClick={() => {
                const newState = !yamlDrawerOpen;
                if (!newState) {
                  // Closing drawer - clear sizing from localStorage
                  localStorage.removeItem('yamlDrawerWidth');
                  localStorage.removeItem('yamlDrawerSplitRatio');
                }
                setYamlDrawerOpen(newState);
                setShowPreview(newState);
              }}
              title={yamlDrawerOpen ? "Hide YAML preview" : "Show YAML preview"}
              aria-label={yamlDrawerOpen ? "Hide YAML" : "Show YAML"}
            >
              {yamlDrawerOpen ? "Hide YAML" : "Show YAML"}
            </button>
          )}
          <button
            type="button"
            className="ghost icon-button"
            onClick={() => setIsToolsOpen((open) => !open)}
            title="Tools: theme, export/import, start over, operations"
            aria-label="Open Tools"
          >
            ⚙ Tools
          </button>
          {feedbackConfig?.visible ? (
            <button
              type="button"
              className="ghost icon-button feedback-trigger"
              onClick={() => setFeedbackOpen(true)}
              title="Share feedback"
              aria-label="Open Feedback"
            >
              💬 Feedback
            </button>
          ) : null}
        </div>
      </header>
      {showLanding ? (
        <div className="app landing-view">
          <div className="content landing-content">
            <LandingPage hasProgress={hasProgress} onStartInstall={handleInstallClick} />
          </div>
        </div>
      ) : (
      <div className="app">
        <ErrorBoundary fallbackMessage="Navigation error; refresh the page.">
          <Sidebar
            steps={sidebarSteps}
            activeStepId={visibleSteps[active]?.id}
            onStepClick={(stepId) => attemptNavigate(visibleSteps.findIndex((s) => s.id === stepId))}
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            reviewFlags={state.reviewFlags || {}}
            errorFlags={errorFlags}
            completeFlags={completeFlags}
            visitedSteps={state.ui?.visitedSteps || {}}
            operationsCount={jobsCount}
            foundationalLocked={foundationalLocked}
            lockToast={lockToast}
            setLockToast={setLockToast}
          />
        </ErrorBoundary>
        <div className="content">
          {blockedMessage ? (
            <div className="blocked-banner" role="alert">
              <span>{blockedMessage}</span>
              <button type="button" className="ghost" onClick={() => setBlockedMessage("")}>Dismiss</button>
            </div>
          ) : null}
          <input
            ref={importRef}
            type="file"
            accept=".json"
            style={{ display: "none" }}
            onChange={(e) => importRun(e.target.files?.[0])}
          />
          {segmentedFlowV1 ? (
            <div className="scenario-header-wrap">
              <ScenarioHeaderPanel state={state} />
            </div>
          ) : null}
          <div className="main-layout" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <main className="main" id="main-content" aria-label="Wizard step content" ref={mainContentRef} style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
              <ErrorBoundary fallbackMessage="Something went wrong in this step; refresh or go back.">
                <Current
                    previewControls={{ showPreview, setShowPreview }}
                    previewEnabled={previewEnabled}
                    highlightErrors={highlightErrors}
                    fieldErrors={fieldErrors}
                    incompleteStepLabels={incompleteStepLabels}
                    onRequestStartOver={handleStartOverClick}
                    onNavigateToOperations={(jobId) => {
                      const opsIdx = visibleSteps.findIndex((s) => s.id === "operations");
                      if (opsIdx < 0) return;
                      const prevStepId = visibleSteps[active]?.id;
                      const visitedSteps = { ...(state.ui?.visitedSteps || {}), ...(prevStepId ? { [prevStepId]: true } : {}), operations: true };
                      setActive(opsIdx);
                      updateState({ ui: { ...state.ui, activeStepId: "operations", highlightJobId: jobId || undefined, visitedSteps } });
                    }}
                  />
              </ErrorBoundary>
            </main>
            {yamlDrawerOpen && previewEnabled && (
              <YamlDrawer
                isOpen={yamlDrawerOpen}
                onClose={() => {
                  // Clear sizing from localStorage on close
                  localStorage.removeItem('yamlDrawerWidth');
                  localStorage.removeItem('yamlDrawerSplitRatio');
                  setYamlDrawerOpen(false);
                  setShowPreview(false);
                }}
                previewFiles={previewFiles}
                activeStepId={previewStepId}
                scenario={yamlDrawerScenario}
                showIncompleteWarning={!!errorFlags[previewStepId]}
                loading={previewLoading}
                error={previewError}
                resetSizing={false}
              />
            )}
          </div>
          <footer className="footer">
            {visibleSteps[active]?.id !== "operations" ? (
              <button type="button" className="ghost" onClick={back}>
                {active === 0 ? "Return to Landing Page" : "Back"}
              </button>
            ) : null}
            <div className="footer-spacer" />
            {visibleSteps[active]?.id === "run-oc-mirror" ? (
              <>
                <button type="button" className="ghost" onClick={() => attemptNavigate(0)}>
                  Back to Blueprint
                </button>
                <button type="button" className="primary" onClick={proceed} disabled={!canProceed}>
                  Continue to Operations
                </button>
              </>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const coreLockLocked =
                    state.blueprint?.confirmed && (state?.version?.versionConfirmed ?? state?.release?.confirmed);
                  if (visibleSteps[active]?.id === "blueprint" && !coreLockLocked) {
                    setPendingNavIndex(active + 1);
                    setShowCoreLockWarning(true);
                    return;
                  }
                  if (active === visibleSteps.length - 1) {
                    attemptNavigate(firstIncompleteStepIndex);
                  } else {
                    proceed();
                  }
                }}
                disabled={
                  !canProceed ||
                  (visibleSteps[active]?.id === "blueprint" && (!blueprintReady || !releaseReady))
                }
              >
                {active === visibleSteps.length - 1
                  ? "Finish"
                  : visibleSteps[active]?.id === "blueprint" &&
                      !(state.blueprint?.confirmed && (state?.version?.versionConfirmed ?? state?.release?.confirmed))
                    ? "Confirm & Proceed"
                    : visibleSteps[active]?.id === "blueprint"
                      ? "Proceed"
                      : "Proceed"}
              </button>
            )}
          </footer>
        </div>
      </div>
      )}
        <Modal
          isOpen={showCoreLockWarning}
          onClose={() => { setShowCoreLockWarning(false); setPendingNavIndex(null); }}
          ariaLabelledBy="core-lock-title"
        >
          <h3 id="core-lock-title">Lock foundational selections?</h3>
          <p className="modal-copy subtle">
            The following will be locked. You will need to use Start Over to change them later.
          </p>
          <dl className="modal-summary">
            <dt>Target Platform</dt>
            <dd>{state.blueprint?.platform ?? "—"}</dd>
            <dt>CPU Architecture</dt>
            <dd>{state.blueprint?.arch ?? "—"}</dd>
            <dt>OpenShift release</dt>
            <dd>
              {releaseReady
                ? `stable-${getOpenShiftMinorFromState(state)} / ${state.release?.patchVersion}`
                : "—"}
            </dd>
          </dl>
          <div className="actions">
            <button type="button" className="ghost" onClick={() => { setShowCoreLockWarning(false); setPendingNavIndex(null); }}>
              No, go back
            </button>
            <button type="button" className="primary" onClick={lockAndProceed} disabled={!blueprintReady || !releaseReady || lockAndProceedLoading || blueprintPullSecretBlocking}>
              {lockAndProceedLoading ? "Locking…" : "Yes, lock selections"}
            </button>
          </div>
        </Modal>
        <Modal
          isOpen={showReleaseWarning}
          onClose={() => setShowReleaseWarning(false)}
          ariaLabelledBy="release-warning-title"
        >
          <h3 id="release-warning-title">Release selection</h3>
          <p className="subtle">
            This release selection will be locked from this point, and you&apos;ll need to click Start Over to change it later. Continue?
          </p>
          <div className="actions">
            <button type="button" className="ghost" onClick={() => setShowReleaseWarning(false)}>No</button>
            <button type="button" className="primary" onClick={confirmReleaseAndProceed} disabled={!releaseReady || confirmingRelease}>
              {confirmingRelease ? "…" : "Yes"}
            </button>
          </div>
        </Modal>
        <Modal
          isOpen={showBlueprintWarning}
          onClose={() => setShowBlueprintWarning(false)}
          ariaLabelledBy="blueprint-warning-title"
        >
          <h3 id="blueprint-warning-title">Blueprint selection</h3>
          <p className="subtle">
            These selections will be locked from this point, and you&apos;ll need to click Start Over to change them later. Continue?
          </p>
          <div className="actions">
            <button type="button" className="ghost" onClick={() => setShowBlueprintWarning(false)}>No</button>
            <button type="button" className="primary" onClick={confirmBlueprintAndProceed} disabled={!blueprintReady}>
              Yes
            </button>
          </div>
        </Modal>
        <Modal
          isOpen={!!validationModal}
          onClose={() => {
            setValidationModal(null);
            setPendingNavIndex(null);
            setHighlightErrors(true);
          }}
          ariaLabelledBy="validation-modal-title"
        >
          <h3 id="validation-modal-title">{validationModal?.title}</h3>
          {validationModal?.errors?.length ? (
            <div className="list">
              {validationModal.errors.map((item, idx) => (
                <div key={`error-${idx}`} className="note warning">{item}</div>
              ))}
            </div>
          ) : null}
          {validationModal?.warnings?.length ? (
            <div className="list">
              {validationModal.warnings.map((item, idx) => (
                <div key={`warn-${idx}`} className="note">{item}</div>
              ))}
            </div>
          ) : null}
          {validationModal?.warningNote ? (
            <div className="note warning">{validationModal.warningNote}</div>
          ) : null}
          <div className="actions">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setValidationModal(null);
                setPendingNavIndex(null);
                setHighlightErrors(true);
              }}
            >
              Cancel
            </button>
            {validationModal?.allowProceed ? (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const target = pendingNavIndex ?? active + 1;
                  setValidationModal(null);
                  setPendingNavIndex(null);
                  setHighlightErrors(false);
                  setActiveStep(target, {});
                }}
              >
                I understand, proceed anyway
              </button>
            ) : null}
          </div>
        </Modal>
        <Modal
          isOpen={showStartOverModal}
          onClose={() => setShowStartOverModal(false)}
          ariaLabelledBy="start-over-title"
        >
          <h3 id="start-over-title">Start Over</h3>
          <p className="subtle">
            This will clear all selections, lock-ins, and user entries, and return you to the landing page.
          </p>
          {startOverCheckingJobs ? (
            <div className="note subtle">Checking for active oc-mirror runs…</div>
          ) : null}
          {startOverCheckError ? (
            <div className="note warning">
              Could not verify oc-mirror run status. Continuing with Start Over will still cancel any tracked running oc-mirror jobs.
            </div>
          ) : null}
          {!startOverCheckingJobs && hasRunningOcMirrorJobs ? (
            <>
              <div className="note subtle">
                Active oc-mirror runs: <strong>{startOverRunningJobs.length}</strong>
              </div>
              <div className="note warning">
                An oc-mirror run is currently active. Continuing will cancel that run and may leave partial or incomplete mirror content on disk.
              </div>
              <div className="note subtle">
                Review and validate these paths before restarting a mirror run:
                <ul style={{ marginTop: 6, marginBottom: 0 }}>
                  {startOverArtifactPaths.map((p) => (
                    <li key={p}><code>{p}</code></li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
          <div className="actions">
            <button type="button" className="ghost" onClick={() => setShowStartOverModal(false)}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={confirmStartOver} disabled={startOverCheckingJobs}>
              {hasRunningOcMirrorJobs ? "Yes, cancel run and start over" : "Yes, start over"}
            </button>
          </div>
        </Modal>
        <ToolsDrawer
          isOpen={isToolsOpen}
          onClose={() => setIsToolsOpen(false)}
          theme={theme}
          setTheme={setTheme}
          onExportRun={exportRun}
          onImportClick={() => importRef.current?.click()}
          onStartOver={handleStartOverClick}
          jobsCount={jobsCount}
          onNavigateToOperations={() => attemptNavigate(visibleSteps.findIndex((s) => s.id === "operations"))}
          isLocked={foundationalLocked}
          logAction={logAction}
          buildInfo={buildInfo}
          updateInfo={updateInfo}
        />
        <FeedbackDrawer
          isOpen={feedbackOpen}
          onClose={() => setFeedbackOpen(false)}
          config={feedbackConfig}
          uiContext={visibleSteps[active]?.id || ""}
          scenarioContext={feedbackScenarioContext}
        />
    </div>
  );
};

const App = () => (
  <AppProvider>
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  </AppProvider>
);

export default App;
