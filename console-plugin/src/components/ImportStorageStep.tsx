import * as React from 'react';
import {
  Content,
  Radio,
  FormGroup,
  TextInput,
  Alert,
  Spinner,
} from '@patternfly/react-core';
import {
  Table,
  Thead,
  Tr,
  Th,
  Tbody,
  Td
} from '@patternfly/react-table';
import { useApp } from '../AppProvider';
import { apiFetch } from '../api';
import { PvcInfo } from '../types';

function suggestPvcSize(fileSizeBytes: number): string {
  if (!fileSizeBytes || fileSizeBytes <= 0) return '100Gi';
  const fileSizeGi = fileSizeBytes / (1024 ** 3);
  const suggested = Math.max(50, Math.ceil((fileSizeGi * 2) / 10) * 10);
  return `${suggested}Gi`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const ImportStorageStep: React.FC = () => {
  const { state, updateState } = useApp();
  const fileSize = state.importSource?.fileSize || 0;
  const filename = state.importSource?.filename || '';

  const [storageMode, setStorageMode] = React.useState<'new' | 'existing'>(
    state.importStorage?.isNewPvc === false ? 'existing' : 'new'
  );
  const [pvcName, setPvcName] = React.useState<string>(
    state.importStorage?.pvcName || `import-${filename.replace(/\.(tar\.gz|tar|tgz)$/, '').replace(/[^a-z0-9-]/gi, '-').toLowerCase().substring(0, 50)}`
  );
  const [pvcSize, setPvcSize] = React.useState<string>(
    state.importStorage?.pvcSize || suggestPvcSize(fileSize)
  );

  const [pvcs, setPvcs] = React.useState<PvcInfo[]>([]);
  const [loadingPvcs, setLoadingPvcs] = React.useState(false);
  const [pvcsError, setPvcsError] = React.useState<string | null>(null);
  const [selectedExistingPvc, setSelectedExistingPvc] = React.useState<string>(
    (!state.importStorage?.isNewPvc && state.importStorage?.pvcName) || ''
  );

  React.useEffect(() => {
    if (storageMode === 'existing') {
      fetchPvcs();
    }
  }, [storageMode]);

  React.useEffect(() => {
    if (storageMode === 'new') {
      updateState({
        importStorage: { pvcName, pvcSize, isNewPvc: true },
      });
    }
  }, [pvcName, pvcSize, storageMode]);

  const fetchPvcs = async () => {
    setLoadingPvcs(true);
    setPvcsError(null);
    try {
      const data = await apiFetch('/api/mirror-import/pvcs');
      setPvcs(data.pvcs || []);
    } catch (err: any) {
      setPvcsError(err.message || 'Failed to list PVCs');
    } finally {
      setLoadingPvcs(false);
    }
  };

  const handleModeChange = (mode: 'new' | 'existing') => {
    setStorageMode(mode);
    if (mode === 'new') {
      updateState({
        importStorage: { pvcName, pvcSize, isNewPvc: true },
      });
    } else {
      updateState({
        importStorage: { pvcName: selectedExistingPvc, pvcSize: '', isNewPvc: false },
      });
    }
  };

  const handleSelectExistingPvc = (name: string) => {
    setSelectedExistingPvc(name);
    updateState({
      importStorage: { pvcName: name, pvcSize: '', isNewPvc: false },
    });
  };

  const parsePvcCapacityBytes = (capacity: string): number => {
    const match = capacity.match(/^(\d+)(Gi|Ti|Mi)?$/);
    if (!match) return 0;
    const num = parseInt(match[1], 10);
    const unit = match[2] || 'Gi';
    if (unit === 'Ti') return num * 1024 * 1024 * 1024 * 1024;
    if (unit === 'Gi') return num * 1024 * 1024 * 1024;
    if (unit === 'Mi') return num * 1024 * 1024;
    return num;
  };

  return (
    <div>
      <Content>
        <Content component="h2">Storage</Content>
        <Content component="p">
          Choose a PVC to store the imported bundle.
          {fileSize > 0 && (
            <> Bundle file size: <strong>{formatFileSize(fileSize)}</strong>.</>
          )}
        </Content>
      </Content>

      <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <Radio
          id="storage-new"
          name="storage-mode"
          label="Create new PVC"
          description="Create a new PersistentVolumeClaim for this import"
          isChecked={storageMode === 'new'}
          onChange={() => handleModeChange('new')}
        />
        <Radio
          id="storage-existing"
          name="storage-mode"
          label="Use existing PVC"
          description="Select a PVC that already exists in the namespace"
          isChecked={storageMode === 'existing'}
          onChange={() => handleModeChange('existing')}
        />
      </div>

      {storageMode === 'new' && (
        <div style={{ marginTop: '2rem', maxWidth: '400px' }}>
          <FormGroup label="PVC Name" fieldId="pvc-name" isRequired>
            <TextInput
              id="pvc-name"
              value={pvcName}
              onChange={(_event, value) => setPvcName(value)}
            />
          </FormGroup>
          <FormGroup
            label="PVC Size"
            fieldId="pvc-size"
            helperText={
              fileSize > 0
                ? `Suggested: ${suggestPvcSize(fileSize)} (2x bundle size for extraction workspace)`
                : 'Size of the PVC (e.g. 100Gi, 200Gi)'
            }
            style={{ marginTop: '1rem' }}
          >
            <TextInput
              id="pvc-size"
              value={pvcSize}
              onChange={(_event, value) => setPvcSize(value)}
            />
          </FormGroup>
        </div>
      )}

      {storageMode === 'existing' && (
        <div style={{ marginTop: '2rem' }}>
          {loadingPvcs && (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <Spinner size="lg" />
              <p>Loading PVCs...</p>
            </div>
          )}

          {pvcsError && (
            <Alert variant="danger" title="Error Loading PVCs" isInline>
              <p>{pvcsError}</p>
            </Alert>
          )}

          {!loadingPvcs && !pvcsError && pvcs.length === 0 && (
            <Alert variant="warning" title="No PVCs Found" isInline>
              <p>No PVCs found in the namespace. Create a new PVC instead.</p>
            </Alert>
          )}

          {!loadingPvcs && !pvcsError && pvcs.length > 0 && (
            <>
              <Table aria-label="PVCs" variant="compact">
                <Thead>
                  <Tr>
                    <Th />
                    <Th>Name</Th>
                    <Th>Capacity</Th>
                    <Th>Status</Th>
                    <Th>Access Modes</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {pvcs.map((pvc) => {
                    const capacityBytes = parsePvcCapacityBytes(pvc.capacity);
                    const tooSmall = fileSize > 0 && capacityBytes > 0 && capacityBytes < fileSize * 2;
                    return (
                      <Tr
                        key={pvc.name}
                        isSelectable
                        isSelected={selectedExistingPvc === pvc.name}
                        onRowClick={() => handleSelectExistingPvc(pvc.name)}
                        style={{ cursor: 'pointer' }}
                      >
                        <Td>
                          <input
                            type="radio"
                            name="existing-pvc"
                            checked={selectedExistingPvc === pvc.name}
                            onChange={() => handleSelectExistingPvc(pvc.name)}
                          />
                        </Td>
                        <Td>{pvc.name}</Td>
                        <Td>
                          {pvc.capacity}
                          {tooSmall && (
                            <span style={{ color: '#c9190b', marginLeft: '0.5rem', fontSize: '0.875rem' }}>
                              (may be too small)
                            </span>
                          )}
                        </Td>
                        <Td>{pvc.phase}</Td>
                        <Td>{pvc.accessModes.join(', ')}</Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>

              {selectedExistingPvc && fileSize > 0 && (() => {
                const selected = pvcs.find((p) => p.name === selectedExistingPvc);
                if (!selected) return null;
                const capacityBytes = parsePvcCapacityBytes(selected.capacity);
                if (capacityBytes > 0 && capacityBytes < fileSize * 2) {
                  return (
                    <Alert variant="warning" title="PVC may be too small" isInline style={{ marginTop: '1rem' }}>
                      <p>
                        The selected PVC ({selected.capacity}) may not have enough space for the bundle
                        ({formatFileSize(fileSize)}) plus extraction workspace. Consider a PVC of at least{' '}
                        {suggestPvcSize(fileSize)}.
                      </p>
                    </Alert>
                  );
                }
                return null;
              })()}
            </>
          )}
        </div>
      )}
    </div>
  );
};
