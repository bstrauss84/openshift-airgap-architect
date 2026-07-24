import * as React from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Content,
  Form,
  FormGroup,
  FormSection,
  Spinner,
  TextInput,
} from '@patternfly/react-core';
import TrashIcon from '@patternfly/react-icons/dist/dynamic/icons/trash-icon';
import PlusCircleIcon from '@patternfly/react-icons/dist/dynamic/icons/plus-circle-icon';
import { useApp } from '../AppProvider';
import { OperatorCatalog, OperatorPackage } from '../utils/imageset-config-types';

const CATALOGS = [
  { id: 'redhat', label: 'Red Hat Operators', catalog: 'registry.redhat.io/redhat/redhat-operator-index' },
  { id: 'certified', label: 'Certified Operators', catalog: 'registry.redhat.io/redhat/certified-operator-index' },
  { id: 'community', label: 'Community Operators', catalog: 'registry.redhat.io/redhat/community-operator-index' },
];

const SCENARIOS = [
  { id: 'virtualization', label: 'Virtualization', description: 'KubeVirt, MTV, NMState', operators: { redhat: ['kubevirt-hyperconverged', 'mtv-operator', 'kubernetes-nmstate-operator'] }},
  { id: 'local-storage', label: 'Local Storage', description: 'LVMS and Local Storage', operators: { redhat: ['lvms-operator', 'local-storage-operator'] }},
  { id: 'openshift-ai', label: 'OpenShift AI', description: 'RHODS, NFD, and GPU', operators: { redhat: ['rhods-operator', 'rhods-prometheus-operator', 'nfd'], certified: ['gpu-operator-certified'] }},
  { id: 'compliance', label: 'Compliance and Security', description: 'File integrity and compliance', operators: { redhat: ['compliance-operator', 'file-integrity-operator'] }},
  { id: 'disconnected', label: 'Disconnected Update Support', description: 'Cincinnati operator', operators: { redhat: ['cincinnati-operator'] }},
  { id: 'gitops', label: 'GitOps', description: 'OpenShift GitOps (ArgoCD)', operators: { redhat: ['openshift-gitops-operator'] }},
  { id: 'cicd', label: 'CI/CD', description: 'OpenShift Pipelines (Tekton)', operators: { redhat: ['openshift-pipelines-operator-rh'] }},
  { id: 'logging', label: 'Logging Stack', description: 'Cluster logging with Loki', operators: { redhat: ['cluster-logging', 'loki-operator'] }},
  { id: 'service-mesh', label: 'Service Mesh', description: 'Istio, Kiali, Jaeger', operators: { redhat: ['servicemeshoperator', 'kiali-ossm', 'jaeger-product'] }},
  { id: 'serverless', label: 'Serverless', description: 'Knative workloads', operators: { redhat: ['serverless-operator'] }},
];

interface ScannedOperator {
  name: string;
  displayName?: string;
  description?: string;
  defaultChannel?: string;
}

export const UpdateOperatorsStep: React.FC = () => {
  const { state, updateState } = useApp();
  const release = state.release || {};
  const updateOperators: OperatorCatalog[] = state.updateOperators || [];

  const [scanning, setScanning] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [catalogOperators, setCatalogOperators] = React.useState<Record<string, ScannedOperator[]>>({});
  const [activeCatalog, setActiveCatalog] = React.useState<string>('redhat');
  const [searchTerm, setSearchTerm] = React.useState('');
  const [hasScanned, setHasScanned] = React.useState(false);

  const apiFetch = async (path: string, options?: RequestInit) => {
    const csrfCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('csrf-token='));
    const csrfToken = csrfCookie
      ? decodeURIComponent(csrfCookie.split('=')[1])
      : undefined;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers as Record<string, string>,
    };
    if (csrfToken) headers['X-CSRFToken'] = csrfToken;

    const response = await fetch(
      `/api/proxy/plugin/airgap-architect-plugin/backend${path}`,
      { ...options, headers }
    );
    if (!response.ok) throw new Error(`API request failed: ${response.status}`);
    return response.json();
  };

  const confirmVersion = async () => {
    if (!release.channel || !release.patchVersion) return;
    try {
      await apiFetch('/api/state', {
        method: 'POST',
        body: JSON.stringify({
          release: { channel: release.channel, patchVersion: release.patchVersion, confirmed: true },
          version: {
            selectedChannel: `stable-${release.channel}`,
            selectedVersion: release.patchVersion,
            selectionTimestamp: Date.now(),
            confirmedByUser: true,
            confirmationTimestamp: Date.now(),
            versionConfirmed: true,
          },
        }),
      });
    } catch (err) {
      console.error('Failed to confirm version:', err);
    }
  };

  React.useEffect(() => {
    if (release.channel && release.patchVersion && !hasScanned && !scanning && Object.keys(catalogOperators).length === 0) {
      setHasScanned(true);
      confirmVersion().then(() => startScan());
    }
  }, [release.channel, release.patchVersion, hasScanned, scanning]);

  const startScan = async () => {
    setScanning(true);
    setScanError(null);
    try {
      await apiFetch('/api/operators/scan', { method: 'POST', body: JSON.stringify({}) });
      pollScanStatus();
    } catch (err: any) {
      setScanError(err.message || 'Operator scan failed');
      setScanning(false);
    }
  };

  const pollScanStatus = async () => {
    const version = release.channel;
    if (!version) return;
    try {
      const data = await apiFetch(`/api/operators/status?version=${version}`);
      const newCatalogOps: Record<string, ScannedOperator[]> = {};
      CATALOGS.forEach((cat) => {
        if (data[cat.id]?.results) newCatalogOps[cat.id] = data[cat.id].results;
      });
      setCatalogOperators(newCatalogOps);

      const hasAllResults = CATALOGS.every(
        (cat) => data[cat.id]?.results?.length > 0
      );
      if (hasAllResults) {
        setScanning(false);
      } else {
        setTimeout(pollScanStatus, 2000);
      }
    } catch (err) {
      console.error('Failed to poll scan status:', err);
      setTimeout(pollScanStatus, 2000);
    }
  };

  const syncOperatorsSelected = (catalogs: OperatorCatalog[]) => {
    const selected: Array<{ name: string; defaultChannel?: string; catalogImage: string }> = [];
    for (const cat of catalogs) {
      for (const pkg of cat.packages) {
        const defaultChannel = pkg.channels?.[0]?.name;
        selected.push({
          name: pkg.name,
          ...(defaultChannel ? { defaultChannel } : {}),
          catalogImage: cat.catalog,
        });
      }
    }
    updateState({
      updateOperators: catalogs,
      operators: { ...state.operators, selected, selectionMode: 'packages' },
    });
  };

  const handleRemovePackage = (catalogIndex: number, packageIndex: number) => {
    const updated = updateOperators.map((cat, ci) => {
      if (ci !== catalogIndex) return cat;
      return { ...cat, packages: cat.packages.filter((_, pi) => pi !== packageIndex) };
    }).filter((cat) => cat.packages.length > 0);
    syncOperatorsSelected(updated);
  };

  const handleRemoveCatalog = (catalogIndex: number) => {
    const updated = updateOperators.filter((_, i) => i !== catalogIndex);
    syncOperatorsSelected(updated);
  };

  const isOperatorInList = (catalogImage: string, operatorName: string): boolean => {
    return updateOperators.some(
      (cat) => cat.catalog === catalogImage && cat.packages.some((p) => p.name === operatorName)
    );
  };

  const handleAddOperator = (catalogId: string, operator: ScannedOperator) => {
    const catalogDef = CATALOGS.find((c) => c.id === catalogId);
    if (!catalogDef) return;
    const catalogImage = `${catalogDef.catalog}:v${release.channel}`;

    if (isOperatorInList(catalogImage, operator.name)) return;

    const newPkg: OperatorPackage = {
      name: operator.name,
      channels: operator.defaultChannel ? [{ name: operator.defaultChannel }] : [],
    };

    const existingCatIndex = updateOperators.findIndex((c) => c.catalog === catalogImage);
    let updated: OperatorCatalog[];
    if (existingCatIndex >= 0) {
      updated = updateOperators.map((cat, i) => {
        if (i !== existingCatIndex) return cat;
        return { ...cat, packages: [...cat.packages, newPkg] };
      });
    } else {
      updated = [...updateOperators, { catalog: catalogImage, packages: [newPkg] }];
    }
    syncOperatorsSelected(updated);
  };

  const handleAddScenario = (scenarioId: string) => {
    const scenario = SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) return;

    let updated = [...updateOperators];
    Object.entries(scenario.operators).forEach(([catalogId, opNames]) => {
      const catalogDef = CATALOGS.find((c) => c.id === catalogId);
      if (!catalogDef) return;
      const catalogImage = `${catalogDef.catalog}:v${release.channel}`;

      for (const opName of opNames) {
        if (isOperatorInList(catalogImage, opName)) continue;
        const scannedOps = catalogOperators[catalogId] || [];
        const scanned = scannedOps.find((o) => o.name === opName);
        const newPkg: OperatorPackage = {
          name: opName,
          channels: scanned?.defaultChannel ? [{ name: scanned.defaultChannel }] : [],
        };

        const existingCatIndex = updated.findIndex((c) => c.catalog === catalogImage);
        if (existingCatIndex >= 0) {
          updated = updated.map((cat, i) => {
            if (i !== existingCatIndex) return cat;
            return { ...cat, packages: [...cat.packages, newPkg] };
          });
        } else {
          updated = [...updated, { catalog: catalogImage, packages: [newPkg] }];
        }
      }
    });
    syncOperatorsSelected(updated);
  };

  const getFilteredOperators = (catalogId: string) => {
    const ops = catalogOperators[catalogId] || [];
    if (!searchTerm) return ops;
    const lower = searchTerm.toLowerCase();
    return ops.filter(
      (op) =>
        op.name.toLowerCase().includes(lower) ||
        op.displayName?.toLowerCase().includes(lower) ||
        op.description?.toLowerCase().includes(lower)
    );
  };

  const totalPackages = updateOperators.reduce((sum, cat) => sum + cat.packages.length, 0);

  return (
    <div>
      <Content>
        <Content component="h2">Manage Operators</Content>
        <Content component="p">
          Review the operators from the parent pipeline. Remove operators to deprecate them
          on the high-side, or add new operators to include in the update bundle.
        </Content>
      </Content>

      {/* Current operators from parent */}
      {updateOperators.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <Content component="h3">
            Current Operators ({totalPackages} package{totalPackages !== 1 ? 's' : ''})
          </Content>
          <Alert
            variant="info"
            title="Removing operators"
            isInline
            isPlain
            style={{ marginBottom: '0.5rem' }}
          >
            Removed operators will be excluded from the update bundle, signaling the high-side
            to deprecate them from the mirror registry.
          </Alert>

          {updateOperators.map((cat, catIndex) => (
            <div
              key={cat.catalog}
              style={{
                border: '1px solid #d2d2d2',
                borderRadius: '4px',
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.9rem', color: '#6a6e73' }}>{cat.catalog}</strong>
                <Button
                  variant="link"
                  isDanger
                  onClick={() => handleRemoveCatalog(catIndex)}
                  style={{ fontSize: '0.85rem' }}
                >
                  Remove all
                </Button>
              </div>
              {cat.packages.map((pkg, pkgIndex) => (
                <div
                  key={pkg.name}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.25rem 0.5rem',
                    borderBottom: pkgIndex < cat.packages.length - 1 ? '1px solid #eee' : 'none',
                  }}
                >
                  <div>
                    <span>{pkg.name}</span>
                    {pkg.channels?.[0]?.name && (
                      <span style={{ marginLeft: '0.5rem', color: '#6a6e73', fontSize: '0.85rem' }}>
                        ({pkg.channels[0].name})
                      </span>
                    )}
                  </div>
                  <Button
                    variant="plain"
                    aria-label={`Remove ${pkg.name}`}
                    onClick={() => handleRemovePackage(catIndex, pkgIndex)}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {updateOperators.length === 0 && (
        <Alert variant="info" title="No operators" isInline style={{ marginTop: '1rem' }}>
          No operators are currently selected. Add operators below to include them in the update bundle.
        </Alert>
      )}

      {/* Add new operators */}
      <div style={{ marginTop: '2rem' }}>
        <Content component="h3">Add Operators</Content>

        <Form>
          <FormSection title="Scenario Templates">
            <p style={{ marginBottom: '1rem', color: '#6a6e73' }}>
              Quick-add common operator bundles
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {SCENARIOS.map((scenario) => (
                <Button
                  key={scenario.id}
                  variant="secondary"
                  icon={<PlusCircleIcon />}
                  onClick={() => handleAddScenario(scenario.id)}
                  style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                >
                  {scenario.label}
                  <span style={{ marginLeft: '0.5rem', color: '#6a6e73', fontSize: '0.85rem' }}>
                    — {scenario.description}
                  </span>
                </Button>
              ))}
            </div>
          </FormSection>

          <FormSection title="Browse Operator Catalogs">
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
                    {CATALOGS.map((catalog) => (
                      <Button
                        key={catalog.id}
                        variant={activeCatalog === catalog.id ? 'primary' : 'secondary'}
                        onClick={() => setActiveCatalog(catalog.id)}
                      >
                        {catalog.label}
                      </Button>
                    ))}
                  </div>
                </FormGroup>

                <FormGroup label="Search Operators">
                  <TextInput
                    type="text"
                    id="search-operators-update"
                    value={searchTerm}
                    onChange={(_event, value) => setSearchTerm(value)}
                    placeholder="Search by name or description..."
                  />
                </FormGroup>

                {(() => {
                  const ops = getFilteredOperators(activeCatalog);
                  const catalogDef = CATALOGS.find((c) => c.id === activeCatalog);
                  const catalogImage = catalogDef
                    ? `${catalogDef.catalog}:v${release.channel}`
                    : '';

                  return (
                    <div
                      style={{
                        maxHeight: '400px',
                        overflowY: 'auto',
                        marginTop: '1rem',
                        border: '1px solid #d2d2d2',
                        borderRadius: '4px',
                        padding: '1rem',
                      }}
                    >
                      <h4>{catalogDef?.label}</h4>
                      {ops.length === 0 && (
                        <p>No operators found{searchTerm ? ' matching search' : ''}.</p>
                      )}
                      {ops.map((op) => {
                        const alreadyAdded = isOperatorInList(catalogImage, op.name);
                        return (
                          <div
                            key={op.name}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '0.25rem 0',
                              marginBottom: '0.25rem',
                            }}
                          >
                            <div>
                              <Checkbox
                                id={`update-${activeCatalog}-${op.name}`}
                                label={op.displayName || op.name}
                                description={op.description?.substring(0, 100)}
                                isChecked={alreadyAdded}
                                onChange={(_event, checked) => {
                                  if (checked) {
                                    handleAddOperator(activeCatalog, op);
                                  }
                                }}
                                isDisabled={alreadyAdded}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </>
            )}
          </FormSection>
        </Form>
      </div>

      {totalPackages > 0 && (
        <div style={{ marginTop: '2rem', padding: '1rem', background: '#f0f0f0', borderRadius: '4px' }}>
          <p style={{ margin: 0 }}>
            <strong>Total:</strong> {totalPackages} operator package{totalPackages !== 1 ? 's' : ''} across{' '}
            {updateOperators.length} catalog{updateOperators.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}
    </div>
  );
};
