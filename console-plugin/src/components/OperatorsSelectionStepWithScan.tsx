/**
 * Operators Selection Step with Live Catalog Scanning
 *
 * Supports full operator browsing via backend catalog scanning
 */
import * as React from 'react';
import { Form, FormGroup, FormSection, Checkbox, Radio, TextInput, Button, Alert, Spinner, Content } from '@patternfly/react-core';
import { useApp } from '../AppProvider';

// Catalog definitions
const CATALOGS = [
  { id: 'redhat', label: 'Red Hat Operators', catalog: 'registry.redhat.io/redhat/redhat-operator-index' },
  { id: 'certified', label: 'Certified Operators', catalog: 'registry.redhat.io/redhat/certified-operator-index' },
  { id: 'community', label: 'Community Operators', catalog: 'registry.redhat.io/redhat/community-operator-index' }
];

// Scenario templates (synchronized with frontend)
const SCENARIOS = [
  { id: 'virtualization', label: 'Virtualization', description: 'KubeVirt, MTV, NMState', operators: { redhat: ['kubevirt-hyperconverged', 'mtv-operator', 'kubernetes-nmstate-operator'] }},
  { id: 'local-storage', label: 'Local Storage', description: 'LVMS and Local Storage', operators: { redhat: ['lvms-operator', 'local-storage-operator'] }},
  { id: 'openshift-ai', label: 'OpenShift AI', description: 'RHODS, NFD, and GPU', operators: { redhat: ['rhods-operator', 'rhods-prometheus-operator', 'nfd'], certified: ['gpu-operator-certified'] }},
  { id: 'compliance', label: 'Compliance and Security', description: 'File integrity and compliance', operators: { redhat: ['compliance-operator', 'file-integrity-operator'] }},
  { id: 'disconnected', label: 'Disconnected Update Support', description: 'Cincinnati operator', operators: { redhat: ['cincinnati-operator'] }},
  { id: 'qol', label: 'Quality of Life', description: 'Web Terminal, DevSpaces, RHDH', operators: { redhat: ['web-terminal', 'devspaces', 'rhdh'] }},
  { id: 'node-health', label: 'Node Health and Maintenance', description: 'Node remediation and health', operators: { redhat: ['self-node-remediation', 'fence-agents-remediation', 'node-healthcheck-operator', 'node-maintenance-operator', 'node-observability-operator'] }},
  { id: 'gitops', label: 'GitOps', description: 'OpenShift GitOps (ArgoCD)', operators: { redhat: ['openshift-gitops-operator'] }},
  { id: 'cicd', label: 'CI/CD', description: 'OpenShift Pipelines (Tekton)', operators: { redhat: ['openshift-pipelines-operator-rh'] }},
  { id: 'odf', label: 'OpenShift Data Foundation', description: 'File, block, and object storage', operators: { redhat: ['ocs-operator', 'odf-operator', 'mcg-operator', 'odf-csi-addons-operator', 'ocs-client-operator', 'odf-prometheus-operator', 'recipe', 'rook-ceph-operator', 'cephcsi-operator', 'odf-dependencies', 'odf-external-snapshotter-operator'] }},
  { id: 'odf-local-storage', label: 'ODF + Local Storage', description: 'ODF with local storage', operators: { redhat: ['ocs-operator', 'odf-operator', 'mcg-operator', 'odf-csi-addons-operator', 'ocs-client-operator', 'odf-prometheus-operator', 'recipe', 'rook-ceph-operator', 'cephcsi-operator', 'odf-dependencies', 'odf-external-snapshotter-operator', 'local-storage-operator'] }},
  { id: 'odf-disaster-recovery', label: 'ODF + Disaster Recovery', description: 'ODF with Regional/Metro DR', operators: { redhat: ['ocs-operator', 'odf-operator', 'mcg-operator', 'odf-csi-addons-operator', 'ocs-client-operator', 'odf-prometheus-operator', 'recipe', 'rook-ceph-operator', 'cephcsi-operator', 'odf-dependencies', 'odf-external-snapshotter-operator', 'odf-multicluster-orchestrator', 'odr-cluster-operator', 'odr-hub-operator'] }},
  { id: 'platform-plus', label: 'OpenShift Platform Plus', description: 'ACM, MCE, ACS, Quay, ODF', operators: { redhat: ['advanced-cluster-management', 'multicluster-engine', 'rhacs-operator', 'quay-operator', 'ocs-operator', 'odf-operator', 'mcg-operator', 'odf-csi-addons-operator', 'ocs-client-operator', 'odf-prometheus-operator', 'recipe', 'rook-ceph-operator', 'cephcsi-operator', 'odf-dependencies', 'odf-external-snapshotter-operator'] }},
  { id: 'app-dev-suite', label: 'App Development Suite', description: 'GitOps, CI/CD, IDE, terminal', operators: { redhat: ['openshift-gitops-operator', 'openshift-pipelines-operator-rh', 'devspaces', 'web-terminal'] }},
  { id: 'logging', label: 'Logging Stack', description: 'Cluster logging with Loki', operators: { redhat: ['cluster-logging', 'loki-operator'] }},
  { id: 'service-mesh', label: 'Service Mesh', description: 'Istio, Kiali, Jaeger', operators: { redhat: ['servicemeshoperator', 'kiali-ossm', 'jaeger-product'] }},
  { id: 'serverless', label: 'Serverless', description: 'Knative workloads', operators: { redhat: ['serverless-operator'] }},
  { id: 'network-observability', label: 'Network Observability', description: 'eBPF traffic monitoring', operators: { redhat: ['netobserv-operator'] }},
  { id: 'cost-management', label: 'Cost Management', description: 'Resource usage metrics', operators: { redhat: ['costmanagement-metrics-operator'] }},
  { id: 'quay', label: 'Red Hat Quay', description: 'Enterprise container registry', operators: { redhat: ['quay-operator'] }},
  { id: 'quay-bridge', label: 'Quay + OpenShift Integration', description: 'Quay as default registry', operators: { redhat: ['quay-operator', 'quay-bridge-operator'] }}
];

interface ScanJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  message?: string;
}

interface OperatorPackage {
  name: string;
  displayName?: string;
  description?: string;
  defaultChannel?: string;
}

export const OperatorsSelectionStepWithScan: React.FC = () => {
  const { state, updateState } = useApp();
  const release = state.release || {};
  const operators = state.operators || {};

  const [selectionMode, setSelectionMode] = React.useState<'catalogs' | 'packages'>(
    operators.selectionMode || 'packages'
  );
  const [selectedCatalogs, setSelectedCatalogs] = React.useState<Set<string>>(
    new Set(operators.selectedCatalogs || [])
  );
  const [scanning, setScanning] = React.useState(false);
  const [scanJobs, setScanJobs] = React.useState<Record<string, string>>({});
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [catalogOperators, setCatalogOperators] = React.useState<Record<string, OperatorPackage[]>>({});
  const [selectedOperators, setSelectedOperators] = React.useState<Record<string, Set<string>>>(
    operators.selectedOperatorsByCatalog || {}
  );
  const [selectedScenarios, setSelectedScenarios] = React.useState<Set<string>>(
    new Set(operators.selectedScenarios || [])
  );
  const [searchTerm, setSearchTerm] = React.useState('');
  const [activeCatalog, setActiveCatalog] = React.useState<string>('redhat');
  const [hasScanned, setHasScanned] = React.useState(false);

  const handleScenarioToggle = (scenarioId: string, checked: boolean) => {
    const newScenarios = new Set(selectedScenarios);
    const newSelectedOps = { ...selectedOperators };

    if (checked) {
      newScenarios.add(scenarioId);
      // Add scenario operators to selected operators
      const scenario = SCENARIOS.find(s => s.id === scenarioId);
      if (scenario) {
        Object.entries(scenario.operators).forEach(([catalogId, ops]) => {
          if (!newSelectedOps[catalogId]) {
            newSelectedOps[catalogId] = new Set();
          }
          ops.forEach(op => newSelectedOps[catalogId].add(op));
        });
      }
    } else {
      newScenarios.delete(scenarioId);
      // Remove scenario operators from selected operators
      const scenario = SCENARIOS.find(s => s.id === scenarioId);
      if (scenario) {
        Object.entries(scenario.operators).forEach(([catalogId, ops]) => {
          if (newSelectedOps[catalogId]) {
            ops.forEach(op => newSelectedOps[catalogId].delete(op));
          }
        });
      }
    }

    setSelectedScenarios(newScenarios);
    setSelectedOperators(newSelectedOps);
    updateOperatorState(selectionMode, selectedCatalogs, newSelectedOps, newScenarios);
  };

  // Confirm version with backend before scanning (via /api/state)
  const confirmVersion = async () => {
    if (!release.channel || !release.patchVersion) return;

    try {
      await apiFetch('/api/state', {
        method: 'POST',
        body: JSON.stringify({
          release: {
            channel: release.channel,
            patchVersion: release.patchVersion,
            confirmed: true
          },
          version: {
            selectedChannel: `stable-${release.channel}`,
            selectedVersion: release.patchVersion,
            selectionTimestamp: Date.now(),
            confirmedByUser: true,
            confirmationTimestamp: Date.now(),
            versionConfirmed: true
          }
        })
      });
    } catch (err) {
      console.error('Failed to confirm version:', err);
    }
  };

  // Auto-start scan when release version is available
  React.useEffect(() => {
    if (release.channel && release.patchVersion && !hasScanned && !scanning && Object.keys(catalogOperators).length === 0) {
      setHasScanned(true);
      confirmVersion().then(() => startScan());
    }
  }, [release.channel, release.patchVersion, hasScanned, scanning]);

  // Proxy backend API through console plugin proxy with CSRF token
  const apiFetch = async (path: string, options?: RequestInit) => {
    // Get CSRF token from cookie
    const csrfCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('csrf-token='));

    const csrfToken = csrfCookie
      ? decodeURIComponent(csrfCookie.split('=')[1])
      : undefined;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers as Record<string, string>
    };

    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken;
    }

    const response = await fetch(`/api/proxy/plugin/airgap-architect-plugin/backend${path}`, {
      ...options,
      headers
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    return response.json();
  };

  // Start catalog scan
  const startScan = async () => {
    setScanning(true);
    setScanError(null);

    try {
      // Backend in operator-managed mode already has pull secret access
      const data = await apiFetch('/api/operators/scan', {
        method: 'POST',
        body: JSON.stringify({})
      });

      setScanJobs(data.jobs || {});
      pollScanStatus();
    } catch (err: any) {
      setScanError(err.message || 'Operator scan failed');
      setScanning(false);
    }
  };

  // Poll scan status
  const pollScanStatus = async () => {
    const version = release.channel;
    if (!version) return;

    try {
      const data = await apiFetch(`/api/operators/status?version=${version}`);

      // Update catalog operators
      const newCatalogOps: Record<string, OperatorPackage[]> = {};
      CATALOGS.forEach(cat => {
        if (data[cat.id]?.results) {
          newCatalogOps[cat.id] = data[cat.id].results;
        }
      });

      setCatalogOperators(newCatalogOps);

      // Check if we have results for all catalogs (scan completed successfully)
      const hasAllResults = CATALOGS.every(cat =>
        data[cat.id]?.results && Array.isArray(data[cat.id].results) && data[cat.id].results.length > 0
      );

      if (hasAllResults) {
        setScanning(false);
      } else {
        // Continue polling
        setTimeout(pollScanStatus, 2000);
      }
    } catch (err) {
      console.error('Failed to poll scan status:', err);
      setTimeout(pollScanStatus, 2000);
    }
  };

  const handleModeChange = (mode: 'catalogs' | 'packages') => {
    setSelectionMode(mode);
    updateOperatorState(mode, selectedCatalogs, selectedOperators, selectedScenarios);
  };

  const handleCatalogToggle = (catalogId: string, checked: boolean) => {
    const newSelected = new Set(selectedCatalogs);
    if (checked) {
      newSelected.add(catalogId);
    } else {
      newSelected.delete(catalogId);
    }
    setSelectedCatalogs(newSelected);
    updateOperatorState(selectionMode, newSelected, selectedOperators, selectedScenarios);
  };

  const handleOperatorToggle = (catalogId: string, operatorName: string, checked: boolean) => {
    const newSelected = { ...selectedOperators };
    if (!newSelected[catalogId]) {
      newSelected[catalogId] = new Set();
    }

    if (checked) {
      newSelected[catalogId].add(operatorName);
    } else {
      newSelected[catalogId].delete(operatorName);
    }

    setSelectedOperators(newSelected);
    updateOperatorState(selectionMode, selectedCatalogs, newSelected, selectedScenarios);
  };

  const updateOperatorState = (
    mode: 'catalogs' | 'packages',
    catalogs: Set<string>,
    ops: Record<string, Set<string>>,
    scenarios?: Set<string>
  ) => {
    const operatorsByCatalog: Record<string, string[]> = {};
    const selected: Array<{ name: string; defaultChannel?: string; catalogImage: string }> = [];

    if (mode === 'packages') {
      Object.entries(ops).forEach(([catalogId, opSet]) => {
        operatorsByCatalog[catalogId] = Array.from(opSet);
        const catalogDef = CATALOGS.find(c => c.id === catalogId);
        const catalogImage = catalogDef ? `${catalogDef.catalog}:v${release.channel}` : '';
        const scannedOps = catalogOperators[catalogId] || [];

        Array.from(opSet).forEach(opName => {
          const scanned = scannedOps.find(o => o.name === opName);
          selected.push({
            name: opName,
            ...(scanned?.defaultChannel ? { defaultChannel: scanned.defaultChannel } : {}),
            catalogImage
          });
        });
      });
    }

    updateState({
      operators: {
        selectionMode: mode,
        selectedCatalogs: Array.from(catalogs),
        selectedScenarios: scenarios ? Array.from(scenarios) : Array.from(selectedScenarios),
        selectedOperatorsByCatalog: ops,
        operatorsByCatalog,
        selected,
        fullCatalogs: mode === 'catalogs' ? CATALOGS.filter(c => catalogs.has(c.id)) : []
      }
    });
  };

  const getTotalSelected = () => {
    if (selectionMode === 'catalogs') {
      return selectedCatalogs.size;
    }
    return Object.values(selectedOperators).reduce((sum, ops) => sum + ops.size, 0);
  };

  const getFilteredOperators = (catalogId: string) => {
    const operators = catalogOperators[catalogId] || [];
    if (!searchTerm) return operators;

    const lowerSearch = searchTerm.toLowerCase();
    return operators.filter(op =>
      op.name.toLowerCase().includes(lowerSearch) ||
      op.displayName?.toLowerCase().includes(lowerSearch) ||
      op.description?.toLowerCase().includes(lowerSearch)
    );
  };

  return (
    <div>
      <Content>
        <Content component="h2">Select Operators</Content>
        <Content component="p">
          Scan operator catalogs and select packages to mirror.
        </Content>
      </Content>

      <Form>
        <FormSection title="Selection Mode">
          <FormGroup>
            <Radio
              id="mode-catalogs"
              name="selection-mode"
              label="Mirror Entire Catalogs"
              description="Mirror complete operator catalogs (all operators)"
              isChecked={selectionMode === 'catalogs'}
              onChange={() => handleModeChange('catalogs')}
            />
            <Radio
              id="mode-packages"
              name="selection-mode"
              label="Select Individual Packages"
              description="Choose specific operators to minimize mirror size"
              isChecked={selectionMode === 'packages'}
              onChange={() => handleModeChange('packages')}
              style={{ marginTop: '1rem' }}
            />
          </FormGroup>
        </FormSection>

        {selectionMode === 'catalogs' && (
          <FormSection title="Operator Catalogs">
            {CATALOGS.map(catalog => (
              <FormGroup key={catalog.id}>
                <Checkbox
                  id={catalog.id}
                  label={catalog.label}
                  description={`${catalog.catalog}:v${release.channel || '4.x'}`}
                  isChecked={selectedCatalogs.has(catalog.id)}
                  onChange={(_event, checked) => handleCatalogToggle(catalog.id, checked)}
                />
              </FormGroup>
            ))}
          </FormSection>
        )}

        {selectionMode === 'packages' && (
          <>
            <FormSection title="Scenario Templates">
              <p style={{ marginBottom: '1rem', color: '#6a6e73' }}>
                Quick-select common operator bundles
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                {SCENARIOS.map(scenario => {
                  const scenarioOps = Object.values(scenario.operators).flat();
                  const isSelected = selectedScenarios.has(scenario.id);
                  return (
                    <Checkbox
                      key={scenario.id}
                      id={`scenario-${scenario.id}`}
                      label={scenario.label}
                      description={scenario.description}
                      isChecked={isSelected}
                      onChange={(_event, checked) => handleScenarioToggle(scenario.id, checked)}
                    />
                  );
                })}
              </div>
            </FormSection>

            <FormSection title="Browse Operator Catalogs">
              {!scanning && Object.keys(catalogOperators).length === 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <Alert variant="info" title="Loading Operators" isInline>
                    <p>Scanning operator catalogs...</p>
                  </Alert>
                </div>
              )}

              {scanning && (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <Spinner size="lg" />
                  <p>Scanning operator catalogs...</p>
                </div>
              )}

              {scanError && (
                <Alert variant="danger" title="Scan Failed" isInline>
                  <p>{scanError}</p>
                </Alert>
              )}

              {!scanning && Object.keys(catalogOperators).length > 0 && (
              <>
                <FormGroup label="Catalog">
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    {CATALOGS.map(catalog => {
                      const selected = selectedOperators[catalog.id] || new Set();
                      const isActive = activeCatalog === catalog.id;
                      return (
                        <Button
                          key={catalog.id}
                          variant={isActive ? 'primary' : 'secondary'}
                          onClick={() => setActiveCatalog(catalog.id)}
                        >
                          {catalog.label} ({selected.size})
                        </Button>
                      );
                    })}
                  </div>
                </FormGroup>

                <FormGroup label="Search Operators">
                  <TextInput
                    type="text"
                    id="search-operators"
                    value={searchTerm}
                    onChange={(_event, value) => setSearchTerm(value)}
                    placeholder="Search by name or description..."
                  />
                </FormGroup>

                {(() => {
                  const ops = getFilteredOperators(activeCatalog);
                  const selected = selectedOperators[activeCatalog] || new Set();

                  return (
                    <div style={{ maxHeight: '400px', overflowY: 'auto', marginTop: '1rem', border: '1px solid #d2d2d2', borderRadius: '4px', padding: '1rem' }}>
                      <h4>{CATALOGS.find(c => c.id === activeCatalog)?.label} ({selected.size} selected)</h4>
                      {ops.length === 0 && (
                        <p>No operators found{searchTerm ? ' matching search' : ''}.</p>
                      )}
                      {ops.map(op => (
                        <div key={op.name} style={{ marginBottom: '0.5rem' }}>
                          <Checkbox
                            id={`${activeCatalog}-${op.name}`}
                            label={op.displayName || op.name}
                            description={op.description?.substring(0, 100)}
                            isChecked={selected.has(op.name)}
                            onChange={(_event, checked) => handleOperatorToggle(activeCatalog, op.name, checked)}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </>
            )}
            </FormSection>
          </>
        )}
      </Form>

      {getTotalSelected() > 0 && (
        <div style={{ marginTop: '2rem', padding: '1rem', background: '#f0f0f0', borderRadius: '4px' }}>
          <p style={{ margin: 0 }}>
            <strong>Selected:</strong> {selectionMode === 'catalogs'
              ? `${selectedCatalogs.size} catalog(s)`
              : `${getTotalSelected()} operator(s)`}
          </p>
        </div>
      )}
    </div>
  );
};
