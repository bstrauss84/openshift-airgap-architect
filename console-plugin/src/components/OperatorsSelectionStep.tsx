/**
 * Operators Selection Step (Console Plugin Version)
 *
 * Supports both catalog-level selection and individual operator selection.
 * Operator bundles synchronized with frontend scenarios.
 */
import * as React from 'react';
import { Form, FormGroup, FormSection } from '@patternfly/react-core/dist/dynamic/components/Form';
import { Checkbox } from '@patternfly/react-core/dist/dynamic/components/Checkbox';
import { Radio } from '@patternfly/react-core/dist/dynamic/components/Radio';
import { TextInput } from '@patternfly/react-core/dist/dynamic/components/TextInput';
import { Content } from '@patternfly/react-core/dist/dynamic/components/Content';
import { useApp } from '../AppProvider';

// Catalog options (matches frontend catalogImages)
const CATALOGS = [
  { id: 'redhat', label: 'Red Hat Operators', catalog: 'registry.redhat.io/redhat/redhat-operator-index' },
  { id: 'certified', label: 'Certified Operators', catalog: 'registry.redhat.io/redhat/certified-operator-index' },
  { id: 'community', label: 'Community Operators', catalog: 'registry.redhat.io/redhat/community-operator-index' }
];

// TODO: Move operator bundles to backend API
// These scenarios should be fetched from a backend endpoint (e.g., /api/operators/bundles)
// instead of being hardcoded here. This would provide a single source of truth and
// eliminate the need to sync this array between frontend and console plugin.
// The backend should expose the same structure as frontend/src/steps/OperatorsStep.jsx
// so both UIs can consume it consistently.
//
// Scenario templates (synchronized with frontend scenarios array)
const SCENARIOS = [
  {
    id: 'virtualization',
    label: 'Virtualization',
    description: 'KubeVirt, MTV, NMState for VM workloads',
    operators: { redhat: ['kubevirt-hyperconverged', 'mtv-operator', 'kubernetes-nmstate-operator'] }
  },
  {
    id: 'local-storage',
    label: 'Local Storage',
    description: 'LVMS and Local Storage operators',
    operators: { redhat: ['lvms-operator', 'local-storage-operator'] }
  },
  {
    id: 'openshift-ai',
    label: 'OpenShift AI',
    description: 'RHODS, NFD, and GPU operator',
    operators: { redhat: ['rhods-operator', 'rhods-prometheus-operator', 'nfd'], certified: ['gpu-operator-certified'] }
  },
  {
    id: 'compliance',
    label: 'Compliance and Security',
    description: 'File integrity monitoring (AIDE) and compliance scanning',
    operators: { redhat: ['compliance-operator', 'file-integrity-operator'] }
  },
  {
    id: 'disconnected',
    label: 'Disconnected Update Support',
    description: 'Cincinnati operator for disconnected cluster updates',
    operators: { redhat: ['cincinnati-operator'] }
  },
  {
    id: 'qol',
    label: 'Quality of Life',
    description: 'Web Terminal, DevSpaces, and Red Hat Developer Hub',
    operators: { redhat: ['web-terminal', 'devspaces', 'rhdh'] }
  },
  {
    id: 'node-health',
    label: 'Node Health and Maintenance',
    description: 'Node remediation, health checking, and maintenance',
    operators: { redhat: ['self-node-remediation', 'fence-agents-remediation', 'node-healthcheck-operator', 'node-maintenance-operator', 'node-observability-operator'] }
  },
  {
    id: 'gitops',
    label: 'GitOps',
    description: 'OpenShift GitOps (ArgoCD)',
    operators: { redhat: ['openshift-gitops-operator'] }
  },
  {
    id: 'cicd',
    label: 'CI/CD',
    description: 'OpenShift Pipelines (Tekton)',
    operators: { redhat: ['openshift-pipelines-operator-rh'] }
  },
  {
    id: 'odf',
    label: 'OpenShift Data Foundation (Base)',
    description: 'Persistent storage with file, block, and object support',
    operators: { redhat: ['ocs-operator', 'odf-operator', 'mcg-operator', 'odf-csi-addons-operator', 'ocs-client-operator', 'odf-prometheus-operator', 'recipe', 'rook-ceph-operator', 'cephcsi-operator', 'odf-dependencies', 'odf-external-snapshotter-operator'] }
  },
  {
    id: 'odf-local-storage',
    label: 'ODF + Local Storage',
    description: 'ODF base packages + local-storage-operator for internal mode',
    operators: { redhat: ['ocs-operator', 'odf-operator', 'mcg-operator', 'odf-csi-addons-operator', 'ocs-client-operator', 'odf-prometheus-operator', 'recipe', 'rook-ceph-operator', 'cephcsi-operator', 'odf-dependencies', 'odf-external-snapshotter-operator', 'local-storage-operator'] }
  },
  {
    id: 'odf-disaster-recovery',
    label: 'ODF + Disaster Recovery',
    description: 'ODF base + Regional-DR/Metro-DR operators',
    operators: { redhat: ['ocs-operator', 'odf-operator', 'mcg-operator', 'odf-csi-addons-operator', 'ocs-client-operator', 'odf-prometheus-operator', 'recipe', 'rook-ceph-operator', 'cephcsi-operator', 'odf-dependencies', 'odf-external-snapshotter-operator', 'odf-multicluster-orchestrator', 'odr-cluster-operator', 'odr-hub-operator'] }
  },
  {
    id: 'platform-plus',
    label: 'OpenShift Platform Plus',
    description: 'ACM, MCE, ACS, Quay, and ODF base stack',
    operators: { redhat: ['advanced-cluster-management', 'multicluster-engine', 'rhacs-operator', 'quay-operator', 'ocs-operator', 'odf-operator', 'mcg-operator', 'odf-csi-addons-operator', 'ocs-client-operator', 'odf-prometheus-operator', 'recipe', 'rook-ceph-operator', 'cephcsi-operator', 'odf-dependencies', 'odf-external-snapshotter-operator'] }
  },
  {
    id: 'app-dev-suite',
    label: 'App Development Suite',
    description: 'GitOps, CI/CD pipelines, cloud IDE, and web terminal',
    operators: { redhat: ['openshift-gitops-operator', 'openshift-pipelines-operator-rh', 'devspaces', 'web-terminal'] }
  },
  {
    id: 'logging',
    label: 'Logging Stack',
    description: 'Cluster logging with Loki log aggregation',
    operators: { redhat: ['cluster-logging', 'loki-operator'] }
  },
  {
    id: 'service-mesh',
    label: 'Service Mesh',
    description: 'Istio-based service mesh with Kiali and Jaeger',
    operators: { redhat: ['servicemeshoperator', 'kiali-ossm', 'jaeger-product'] }
  },
  {
    id: 'serverless',
    label: 'Serverless',
    description: 'Knative-based serverless workloads',
    operators: { redhat: ['serverless-operator'] }
  },
  {
    id: 'network-observability',
    label: 'Network Observability',
    description: 'eBPF-based network traffic monitoring',
    operators: { redhat: ['netobserv-operator'] }
  },
  {
    id: 'cost-management',
    label: 'Cost Management',
    description: 'Cluster cost tracking and resource usage metrics',
    operators: { redhat: ['costmanagement-metrics-operator'] }
  },
  {
    id: 'quay',
    label: 'Red Hat Quay',
    description: 'Enterprise container registry',
    operators: { redhat: ['quay-operator'] }
  },
  {
    id: 'quay-bridge',
    label: 'Quay + OpenShift Integration',
    description: 'Quay as default OpenShift registry',
    operators: { redhat: ['quay-operator', 'quay-bridge-operator'] }
  }
];

export const OperatorsSelectionStep: React.FC = () => {
  const { state, updateState } = useApp();
  const release = state.release || {};
  const operators = state.operators || {};

  const [selectionMode, setSelectionMode] = React.useState<'catalogs' | 'packages'>(
    operators.selectionMode || 'packages'
  );
  const [selectedCatalogs, setSelectedCatalogs] = React.useState<Set<string>>(
    new Set(operators.selectedCatalogs || [])
  );
  const [selectedScenarios, setSelectedScenarios] = React.useState<Set<string>>(
    new Set(operators.selectedScenarios || [])
  );
  const [customOperators, setCustomOperators] = React.useState<string>(
    operators.customOperators?.join(', ') || ''
  );

  const updateOperatorState = (mode: 'catalogs' | 'packages', catalogs: Set<string>, scenarios: Set<string>, custom: string) => {
    // Collect operators from selected scenarios - group by catalog
    const operatorsByCatalog: Record<string, string[]> = {};

    Array.from(scenarios).forEach(id => {
      const scenario = SCENARIOS.find(s => s.id === id);
      if (scenario) {
        Object.entries(scenario.operators).forEach(([catalog, ops]) => {
          if (!operatorsByCatalog[catalog]) {
            operatorsByCatalog[catalog] = [];
          }
          operatorsByCatalog[catalog].push(...ops);
        });
      }
    });

    // Add custom operators to redhat catalog by default
    const customOps = custom.split(',').map(s => s.trim()).filter(s => s.length > 0);
    if (customOps.length > 0) {
      if (!operatorsByCatalog['redhat']) {
        operatorsByCatalog['redhat'] = [];
      }
      operatorsByCatalog['redhat'].push(...customOps);
    }

    // Dedupe operators in each catalog
    Object.keys(operatorsByCatalog).forEach(catalog => {
      operatorsByCatalog[catalog] = Array.from(new Set(operatorsByCatalog[catalog]));
    });

    // Build operators.selected[] for backend compatibility
    const selected: Array<{ name: string; catalogImage: string }> = [];
    if (mode === 'packages') {
      Object.entries(operatorsByCatalog).forEach(([catalogId, ops]) => {
        const catalogDef = CATALOGS.find(c => c.id === catalogId);
        const catalogImage = catalogDef ? `${catalogDef.catalog}:v${release.channel}` : '';
        ops.forEach(opName => {
          selected.push({ name: opName, catalogImage });
        });
      });
    }

    updateState({
      operators: {
        selectionMode: mode,
        selectedCatalogs: Array.from(catalogs),
        selectedScenarios: Array.from(scenarios),
        customOperators: customOps,
        operatorsByCatalog: mode === 'packages' ? operatorsByCatalog : {},
        selected,
        fullCatalogs: mode === 'catalogs' ? CATALOGS.filter(c => catalogs.has(c.id)) : []
      }
    });
  };

  const handleModeChange = (mode: 'catalogs' | 'packages') => {
    setSelectionMode(mode);
    updateOperatorState(mode, selectedCatalogs, selectedScenarios, customOperators);
  };

  const handleCatalogToggle = (catalogId: string, checked: boolean) => {
    const newSelected = new Set(selectedCatalogs);
    if (checked) {
      newSelected.add(catalogId);
    } else {
      newSelected.delete(catalogId);
    }
    setSelectedCatalogs(newSelected);
    updateOperatorState(selectionMode, newSelected, selectedScenarios, customOperators);
  };

  const handleScenarioToggle = (scenarioId: string, checked: boolean) => {
    const newSelected = new Set(selectedScenarios);
    if (checked) {
      newSelected.add(scenarioId);
    } else {
      newSelected.delete(scenarioId);
    }
    setSelectedScenarios(newSelected);
    updateOperatorState(selectionMode, selectedCatalogs, newSelected, customOperators);
  };

  const handleCustomOperatorsChange = (value: string) => {
    setCustomOperators(value);
    updateOperatorState(selectionMode, selectedCatalogs, selectedScenarios, value);
  };

  const getTotalSelectedCount = () => {
    if (selectionMode === 'catalogs') {
      return selectedCatalogs.size;
    }
    const operatorsByCatalog = operators.operatorsByCatalog || {};
    return Object.values(operatorsByCatalog).reduce((sum: number, ops: any) => sum + ops.length, 0);
  };

  return (
    <div>
      <Content>
        <Content component="h2">Select Operators</Content>
        <Content component="p">
          Choose to mirror entire catalogs or select individual operator packages.
        </Content>
      </Content>

      <Form>
        <FormSection title="Selection Mode">
          <FormGroup>
            <Radio
              id="mode-catalogs"
              name="selection-mode"
              label="Mirror Entire Catalogs"
              description="Mirror complete operator catalogs (recommended for fully mirroring all operators)"
              isChecked={selectionMode === 'catalogs'}
              onChange={() => handleModeChange('catalogs')}
            />
            <Radio
              id="mode-packages"
              name="selection-mode"
              label="Select Individual Packages"
              description="Choose specific operator packages to minimize mirror size"
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                {SCENARIOS.map(scenario => (
                  <FormGroup key={scenario.id}>
                    <Checkbox
                      id={scenario.id}
                      label={scenario.label}
                      description={scenario.description}
                      isChecked={selectedScenarios.has(scenario.id)}
                      onChange={(_event, checked) => handleScenarioToggle(scenario.id, checked)}
                    />
                  </FormGroup>
                ))}
              </div>
            </FormSection>

            <FormSection title="Additional Operators">
              <FormGroup
                label="Custom Operator Packages"
                helperText="Enter operator package names separated by commas (added to redhat catalog)"
              >
                <TextInput
                  type="text"
                  id="custom-operators"
                  value={customOperators}
                  onChange={(_event, value) => handleCustomOperatorsChange(value)}
                  placeholder="e.g., advanced-cluster-management, openshift-serverless"
                />
              </FormGroup>
            </FormSection>
          </>
        )}
      </Form>

      {getTotalSelectedCount() > 0 && (
        <div style={{ marginTop: '2rem', padding: '1rem', background: '#f0f0f0', borderRadius: '4px' }}>
          <p style={{ margin: 0 }}>
            <strong>Selected:</strong> {selectionMode === 'catalogs'
              ? `${selectedCatalogs.size} catalog(s)`
              : `${getTotalSelectedCount()} operator package(s)`}
          </p>
        </div>
      )}
    </div>
  );
};
