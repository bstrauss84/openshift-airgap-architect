import React, { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api.js";
import { useApp } from "../store.jsx";
import { useCatalogScanProgress } from "../useCatalogScanProgress.js";
import SecretInput from "../components/SecretInput.jsx";
import CollapsibleSection from "../components/CollapsibleSection.jsx";
import Banner from "../components/Banner.jsx";
import Button from "../components/Button.jsx";
import Switch from "../components/Switch.jsx";
import OptionRow from "../components/OptionRow.jsx";

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
    picks: { redhat: ["compliance-operator", "container-security-operator"] }
  },
  {
    id: "disconnected",
    label: "Disconnected Update Support",
    picks: { redhat: ["cincinnati-operator"] }
  },
  {
    id: "qol",
    label: "Quality of Life",
    picks: { redhat: ["web-terminal", "devspaces"] }
  },
  {
    id: "node-health",
    label: "Node Health and Maintenance",
    picks: { redhat: ["self-node-remediation", "node-healthcheck-operator", "node-maintenance-operator", "node-observability-operator"] }
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
  const hasVisited = state.ui?.visitedSteps?.operators;
  const needsReview = state.reviewFlags?.operators && hasVisited;
  const staleResults = state.operators?.stale && hasVisited;
  const hasScanJobs = Object.keys(jobs).length > 0;
  const hasScanJobsFromState = Object.keys(state.operators?.scanJobs || {}).length > 0;
  const hasRetainedPullSecret = Boolean(
    state.credentials?.pullSecretPlaceholder &&
    state.credentials.pullSecretPlaceholder.trim() &&
    state.credentials.pullSecretPlaceholder !== "{\"auths\":{}}"
  );
  const hasCredentialSource = authAvailable || pullSecretInput || hasRetainedPullSecret;
  const anyScanFailed = ["redhat", "certified", "community"].some((id) => jobStatuses[id]?.status === "failed");
  const scansInProgressOrComplete = hasScanJobs && !anyScanFailed;
  const showStaleWarning = staleResults && !scansInProgressOrComplete;
  const discoveryAlreadyRunningOrDone = hasScanJobs || hasScanJobsFromState;

  const version = state.release?.channel;
  const normalizeCatalogs = (data) => ({
    redhat: Array.isArray(data?.redhat) ? data.redhat : data?.redhat?.results || [],
    certified: Array.isArray(data?.certified) ? data.certified : data?.certified?.results || [],
    community: Array.isArray(data?.community) ? data.community : data?.community?.results || []
  });
  const catalogs = normalizeCatalogs(state.operators?.catalogs || {});
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
      Object.entries(scenario.picks).forEach(([catalogId, names]) => {
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
    if (scenarioSelections?.[scenario.id]) {
      removeScenarioOperators(scenario.id);
      return;
    }
    applyScenario(scenario);
  };

  const startScan = async () => {
    setLoadingCatalogs(true);
    setScanError("");
    updateState({ operators: { ...state.operators, stale: false } });
    const secretToUse = pullSecretInput || (hasRetainedPullSecret ? state.credentials?.pullSecretPlaceholder : "");
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
    const poll = async () => {
      const nextStatuses = {};
      for (const id of ids) {
        try {
          const job = await apiFetch(`/api/jobs/${id}`);
          const catalogId = Object.entries(jobs).find(([, jobId]) => jobId === id)?.[0];
          if (catalogId) {
            nextStatuses[catalogId] = job;
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
      if (!cancelled) {
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
      const next = prevSelected.filter((op) => op.id !== id);
      return { ...prev, operators: { ...prev.operators, selected: next, version } };
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
        {previewEnabled ? (
          <div className="header-actions">
            <button className="ghost" onClick={() => previewControls?.setShowPreview((prev) => !prev)}>
              {previewControls?.showPreview ? "Hide YAML" : "Show YAML"}
            </button>
          </div>
        ) : null}
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
          <section className="card">
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
                    <SecretInput
                      value={pullSecretInput}
                      onChange={setPullSecretInput}
                      label="Red Hat pull secret (optional)"
                      labelEmphasis="Red Hat pull secret (optional)"
                      labelHint={
                        state.credentials?.redHatPullSecretConfigured
                          ? "Pull secret configured for operator discovery."
                          : hasRetainedPullSecret && discoveryAlreadyRunningOrDone
                            ? "From Blueprint (in memory only). Used for catalog scan; not stored or exported."
                            : "Used only for catalog scan. Red Hat login required to obtain."
                      }
                      getPullSecretUrl="https://console.redhat.com/openshift/downloads#tool-pull-secret"
                      placeholder="Paste Red Hat pull secret JSON"
                      rows={4}
                      aria-label="Red Hat pull secret JSON for operator discovery"
                    />
                    <OptionRow
                      title="Fast mode"
                      description="Use cached catalogs when available"
                      note={fastMode && cachedAt ? `Using cached catalogs from ${new Date(cachedAt).toLocaleString()}.` : null}
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
          </section>

          <CollapsibleSection title="Scan Status" defaultCollapsed={false}>
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

        <CollapsibleSection title="ImageSet options" defaultCollapsed={true}>
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
            <label className="label-emphasis" style={{ display: "block", marginBottom: 4 }}>
              Additional images to mirror (optional)
            </label>
            <p className="note subtle" style={{ marginTop: 0, marginBottom: 6 }}>
              One image reference per line (e.g. quay.io/org/app:tag). Added to mirror.additionalImages in ImageSetConfiguration.
            </p>
            <textarea
              rows={4}
              style={{ width: "100%", resize: "vertical", fontFamily: "monospace", fontSize: "0.875rem" }}
              value={state.imagesetConfig?.additionalImages || ""}
              onChange={(e) => updateState({ imagesetConfig: { ...(state.imagesetConfig || {}), additionalImages: e.target.value } })}
              placeholder={"quay.io/org/app:tag\nregistry.example.com/repo/image:v1.0"}
              aria-label="Additional images to mirror"
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <label className="label-emphasis" style={{ display: "block", marginBottom: 4 }}>
              Archive chunk size — GiB (optional)
            </label>
            <p className="note subtle" style={{ marginTop: 0, marginBottom: 6 }}>
              Split oc-mirror output into archive files of this size. Leave blank for no limit. Sets storageConfig.local.archiveSize in ImageSetConfiguration (oc-mirror v2).
            </p>
            <input
              type="number"
              min={1}
              style={{ maxWidth: 120 }}
              value={state.imagesetConfig?.archiveSize || ""}
              onChange={(e) => updateState({ imagesetConfig: { ...(state.imagesetConfig || {}), archiveSize: e.target.value } })}
              placeholder="e.g. 100"
              aria-label="Archive chunk size in GiB"
            />
          </div>
        </CollapsibleSection>

        <section className="card">
          <h3 className="card-title">Scenario Quick Picks</h3>
          <p className="card-subtitle">One-click presets for common operator sets.</p>
          <div className="scenario-picks">
            {scenarios.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                className={`scenario-pick ${scenarioSelections?.[scenario.id] ? "selected" : ""}`}
                onClick={() => handleScenarioClick(scenario)}
                title={!scenarioReady ? "Scenario picks need operator catalogs" : ""}
                disabled={!scenarioReady}
              >
                <span className="scenario-pick-label">{scenario.label}</span>
                {scenarioSelections?.[scenario.id] ? <span className="scenario-pick-check" aria-hidden>✓</span> : null}
              </button>
            ))}
          </div>
        </section>

        <section className="card">
        <h3>Selected Operators</h3>
        <div className="selected-grid">
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
