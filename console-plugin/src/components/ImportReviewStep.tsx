import * as React from 'react';
import {
  Content,
  Button,
  Alert,
  Spinner,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Progress,
  ProgressMeasureLocation,
} from '@patternfly/react-core';
import { useApp } from '../AppProvider';
import { apiFetch } from '../api';
import { getCsrfToken } from '../utils/pipeline-helpers';
import { chunkedUpload } from '../utils/chunked-upload';
import { useHistory } from 'react-router-dom';

function formatFileSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const ImportReviewStep: React.FC = () => {
  const { state } = useApp();
  const history = useHistory();
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [createdName, setCreatedName] = React.useState('');
  const [uploadProgress, setUploadProgress] = React.useState<number | null>(null);
  const [uploadStatus, setUploadStatus] = React.useState<string>('');
  const abortRef = React.useRef<AbortController | null>(null);

  const source = state.importSource || {};
  const storage = state.importStorage || {};
  const config = state.importConfig || {};

  const needsUpload = source.sourceMode === 'upload' && source.uploadFile;

  React.useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const pollJobStatus = async (jobId: string): Promise<void> => {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const job = await apiFetch(`/api/jobs/${jobId}`);
        if (job.progress !== undefined) {
          setUploadProgress(job.progress);
        }
        if (job.message) {
          setUploadStatus(job.message);
        }
        if (job.status === 'completed') return;
        if (job.status === 'failed') {
          throw new Error(job.message || 'Upload failed');
        }
      } catch (err: any) {
        if (err.message?.includes('Upload failed') || err.message?.includes('failed')) {
          throw err;
        }
      }
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setCreating(false);
    setUploadProgress(null);
    setUploadStatus('');
  };

  const handleSubmit = async () => {
    setCreating(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let bundlePvc = storage.pvcName;
      let bundleFilename = source.filename;

      if (needsUpload) {
        setUploadStatus('Starting upload...');
        setUploadProgress(0);

        const result = await chunkedUpload({
          file: source.uploadFile,
          filename: source.filename || `import-${Date.now()}.tar`,
          pvcName: storage.pvcName || '',
          pvcSize: storage.pvcSize || '',
          isNewPvc: storage.isNewPvc || false,
          onProgress: (progress) => {
            setUploadProgress(progress.overallPercent);
            setUploadStatus(progress.message);
          },
          signal: controller.signal,
        });

        if (result.jobId) {
          await pollJobStatus(result.jobId);
        }
        bundleFilename = result.filename || source.filename;
        setUploadStatus('Upload complete');
        setUploadProgress(100);
      } else if (storage.isNewPvc) {
        setUploadStatus('Creating PVC...');
        const csrfToken = getCsrfToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (csrfToken) headers['X-CSRFToken'] = csrfToken;

        const pvcBody = {
          apiVersion: 'v1',
          kind: 'PersistentVolumeClaim',
          metadata: {
            name: storage.pvcName,
            namespace: 'mirror-operator-system',
          },
          spec: {
            accessModes: ['ReadWriteOnce'],
            resources: { requests: { storage: storage.pvcSize } },
          },
        };

        await fetch('/api/kubernetes/api/v1/namespaces/mirror-operator-system/persistentvolumeclaims', {
          method: 'POST',
          headers,
          body: JSON.stringify(pvcBody),
        });
      }

      setUploadStatus('Creating MirrorImport...');

      const importName = `import-${Date.now()}`;
      const namespace = 'mirror-operator-system';

      const mirrorImport = {
        apiVersion: 'mirror.mirror.mathianasj.github.com/v1',
        kind: 'MirrorImport',
        metadata: {
          name: importName,
          namespace,
        },
        spec: {
          bundle: {
            pvc: bundlePvc,
            filename: bundleFilename,
          },
          targetRegistry: {
            url: config.targetRegistryUrl,
          },
          publish: {
            catalogSource: config.catalogSource !== false,
            imageContentSourcePolicy: config.imageContentSourcePolicy !== false,
          },
          ...(storage.isNewPvc && storage.pvcSize ? { storageSize: storage.pvcSize } : {}),
        },
      };

      const csrfToken = getCsrfToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['X-CSRFToken'] = csrfToken;

      const response = await fetch(
        `/api/kubernetes/apis/mirror.mirror.mathianasj.github.com/v1/namespaces/${namespace}/mirrorimports`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(mirrorImport),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create MirrorImport: ${response.status} - ${errorText}`);
      }

      setCreatedName(importName);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Unknown error occurred');
    } finally {
      setCreating(false);
    }
  };

  if (success) {
    return (
      <div>
        <Alert variant="success" title="Mirror Import Created" isInline>
          <p>
            MirrorImport <strong>{createdName}</strong> has been created successfully.
            The operator will begin importing the bundle into the target registry.
          </p>
        </Alert>
        <div style={{ marginTop: '2rem' }}>
          <Button variant="primary" onClick={() => history.push(`/airgap-architect/imports/${createdName}`)}>
            View Import Details
          </Button>
          <Button variant="link" onClick={() => history.push('/airgap-architect')} style={{ marginLeft: '1rem' }}>
            Back to List
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Content>
        <Content component="h2">Review and Import</Content>
        <Content component="p">
          Review the import configuration before creating the MirrorImport resource.
        </Content>
      </Content>

      <div style={{ marginTop: '1.5rem' }}>
        <DescriptionList isHorizontal>
          <DescriptionListGroup>
            <DescriptionListTerm>Source</DescriptionListTerm>
            <DescriptionListDescription>
              {source.sourceMode === 'upload' ? 'Browser upload' : 'Import volume'}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Bundle File</DescriptionListTerm>
            <DescriptionListDescription>
              {source.filename || '-'}
              {source.fileSize > 0 && ` (${formatFileSize(source.fileSize)})`}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>PVC</DescriptionListTerm>
            <DescriptionListDescription>
              {storage.pvcName || '-'}
              {storage.isNewPvc && ' (new)'}
              {storage.isNewPvc && storage.pvcSize && ` — ${storage.pvcSize}`}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Target Registry</DescriptionListTerm>
            <DescriptionListDescription>
              {config.targetRegistryUrl || '-'}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Publish CatalogSource</DescriptionListTerm>
            <DescriptionListDescription>
              {config.catalogSource !== false ? 'Yes' : 'No'}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Publish ICSP/IDMS</DescriptionListTerm>
            <DescriptionListDescription>
              {config.imageContentSourcePolicy !== false ? 'Yes' : 'No'}
            </DescriptionListDescription>
          </DescriptionListGroup>
        </DescriptionList>
      </div>

      {uploadProgress !== null && (
        <div style={{ marginTop: '1.5rem' }}>
          <Progress
            value={uploadProgress}
            title={uploadStatus}
            measureLocation={ProgressMeasureLocation.top}
          />
        </div>
      )}

      {error && (
        <Alert variant="danger" title="Error" isInline style={{ marginTop: '1rem' }}>
          <p>{error}</p>
        </Alert>
      )}

      <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
        <Button
          variant="primary"
          onClick={handleSubmit}
          isDisabled={creating || !source.filename || !storage.pvcName || !config.targetRegistryUrl}
          icon={creating ? <Spinner size="md" /> : undefined}
        >
          {creating
            ? uploadProgress !== null
              ? 'Uploading...'
              : 'Creating...'
            : 'Import Bundle'}
        </Button>
        {creating && uploadProgress !== null && uploadProgress < 46 && (
          <Button variant="link" isDanger onClick={handleCancel}>
            Cancel Upload
          </Button>
        )}
      </div>
    </div>
  );
};
