import * as React from 'react';
import {
  Content,
  Radio,
  Alert,
  Spinner,
  Button,
  Progress,
  ProgressMeasureLocation,
} from '@patternfly/react-core';
import { UploadIcon } from '@patternfly/react-icons';
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
import { ImportPvcFile } from '../types';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const BundleSourceStep: React.FC = () => {
  const { state, updateState } = useApp();
  const [sourceMode, setSourceMode] = React.useState<'upload' | 'pvc'>(state.importSource?.sourceMode || 'upload');
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [pvcFiles, setPvcFiles] = React.useState<ImportPvcFile[]>([]);
  const [loadingFiles, setLoadingFiles] = React.useState(false);
  const [filesError, setFilesError] = React.useState<string | null>(null);
  const [selectedPvcFile, setSelectedPvcFile] = React.useState<string>(state.importSource?.filename || '');

  React.useEffect(() => {
    if (sourceMode === 'pvc') {
      fetchPvcFiles();
    }
  }, [sourceMode]);

  const fetchPvcFiles = async () => {
    setLoadingFiles(true);
    setFilesError(null);
    try {
      const data = await apiFetch('/api/mirror-import/files');
      setPvcFiles(data.files || []);
    } catch (err: any) {
      setFilesError(err.message || 'Failed to list files');
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleModeChange = (mode: 'upload' | 'pvc') => {
    setSourceMode(mode);
    updateState({
      importSource: { ...state.importSource, sourceMode: mode, filename: '', fileSize: 0 },
    });
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    if (file) {
      updateState({
        importSource: {
          sourceMode: 'upload',
          filename: file.name,
          fileSize: file.size,
          uploadFile: file,
        },
      });
    }
  };

  const handlePvcFileSelect = (fileName: string, fileSize: number) => {
    setSelectedPvcFile(fileName);
    updateState({
      importSource: {
        sourceMode: 'pvc',
        filename: fileName,
        fileSize: fileSize,
      },
    });
  };

  return (
    <div>
      <Content>
        <Content component="h2">Bundle Source</Content>
        <Content component="p">
          Choose how to provide the collection bundle for import.
        </Content>
      </Content>

      <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <Radio
          id="source-upload"
          name="source-mode"
          label="Upload from browser"
          description="Upload a collection bundle tar file directly from your computer"
          isChecked={sourceMode === 'upload'}
          onChange={() => handleModeChange('upload')}
        />
        <Radio
          id="source-pvc"
          name="source-mode"
          label="Select from import volume"
          description="Choose a bundle file already placed on the import PVC"
          isChecked={sourceMode === 'pvc'}
          onChange={() => handleModeChange('pvc')}
        />
      </div>

      {sourceMode === 'upload' && (
        <div style={{ marginTop: '2rem' }}>
          <div
            style={{
              border: '2px dashed #d2d2d2',
              borderRadius: '8px',
              padding: '2rem',
              textAlign: 'center',
              cursor: 'pointer',
              background: selectedFile ? '#f0fdf4' : '#fafafa',
            }}
            onClick={() => document.getElementById('file-upload-input')?.click()}
          >
            <UploadIcon style={{ fontSize: '2rem', color: '#6a6e73', marginBottom: '0.5rem' }} />
            <p style={{ margin: '0.5rem 0' }}>
              {selectedFile
                ? `Selected: ${selectedFile.name} (${formatFileSize(selectedFile.size)})`
                : 'Click to select a .tar or .tar.gz bundle file'}
            </p>
            <input
              id="file-upload-input"
              type="file"
              accept=".tar,.tar.gz,.tgz"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            {!selectedFile && (
              <Button variant="secondary" style={{ marginTop: '0.5rem' }}>
                Choose File
              </Button>
            )}
          </div>
          {selectedFile && (
            <Alert variant="info" isInline title="File selected" style={{ marginTop: '1rem' }}>
              The file will be uploaded when you submit the import on the final step.
            </Alert>
          )}
        </div>
      )}

      {sourceMode === 'pvc' && (
        <div style={{ marginTop: '2rem' }}>
          {loadingFiles && (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <Spinner size="lg" />
              <p>Scanning import volume for bundle files...</p>
            </div>
          )}

          {filesError && (
            <Alert variant="danger" title="Error Loading Files" isInline>
              <p>{filesError}</p>
            </Alert>
          )}

          {!loadingFiles && !filesError && pvcFiles.length === 0 && (
            <Alert variant="warning" title="No Bundle Files Found" isInline>
              <p>
                No .tar or .tar.gz files found on the import volume. Place your bundle file on the import PVC
                and try again.
              </p>
            </Alert>
          )}

          {!loadingFiles && !filesError && pvcFiles.length > 0 && (
            <Table aria-label="PVC Files" variant="compact">
              <Thead>
                <Tr>
                  <Th />
                  <Th>Filename</Th>
                  <Th>Size</Th>
                  <Th>Modified</Th>
                </Tr>
              </Thead>
              <Tbody>
                {pvcFiles.map((file) => (
                  <Tr
                    key={file.name}
                    isSelectable
                    isSelected={selectedPvcFile === file.name}
                    onRowClick={() => handlePvcFileSelect(file.name, file.size)}
                    style={{ cursor: 'pointer' }}
                  >
                    <Td>
                      <input
                        type="radio"
                        name="pvc-file"
                        checked={selectedPvcFile === file.name}
                        onChange={() => handlePvcFileSelect(file.name, file.size)}
                      />
                    </Td>
                    <Td>{file.name}</Td>
                    <Td>{formatFileSize(file.size)}</Td>
                    <Td>{new Date(file.modified).toLocaleString()}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}

          <div style={{ marginTop: '1rem' }}>
            <Button variant="link" onClick={fetchPvcFiles} isDisabled={loadingFiles}>
              Refresh file list
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
