/**
 * Create CollectionPipeline Step (Console Plugin Version)
 *
 * Fetches ImageSetConfiguration YAML from the backend and submits
 * a CollectionPipeline CR to trigger mirroring.
 */
import * as React from 'react';
import { Button, Alert, Spinner, Content, CodeBlock, CodeBlockCode, FormGroup, TextInput } from '@patternfly/react-core';
import { useApp } from '../AppProvider';
import { apiFetch } from '../api';
import { useHistory } from 'react-router-dom';
import { generateChildName, getCsrfToken } from '../utils/pipeline-helpers';

export const CreateCollectionPipelineStep: React.FC = () => {
  const { state } = useApp();
  const history = useHistory();
  const release = state.release || {};
  const operators = state.operators || {};
  const additionalImages = state.additionalImages || {};
  const parentPipeline = state.parentPipeline || null;

  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [createdName, setCreatedName] = React.useState<string>('');
  const [imageSetYAML, setImageSetYAML] = React.useState<string>('');
  const [generating, setGenerating] = React.useState(false);
  const [generateError, setGenerateError] = React.useState<string | null>(null);
  const [pvcSize, setPvcSize] = React.useState<string>('100Gi');

  React.useEffect(() => {
    let cancelled = false;
    const fetchImageSetConfig = async () => {
      setGenerating(true);
      setGenerateError(null);
      try {
        const stateForGenerate = {
          ...state,
          docs: { ...state.docs, connectivity: 'connected' },
          mirrorOperatorPipeline: true,
          ...(state.updateChannels?.length > 0
            ? { platformChannels: state.updateChannels }
            : {}),
        };

        // Replicate operators across all platform channel minor versions
        // Parent operators may only have v4.21 catalogs; adding stable-4.22
        // requires v4.22 catalog entries for the same operators
        if (state.updateChannels?.length > 0 && stateForGenerate.operators?.selected?.length > 0) {
          const channelMinors = new Set(
            state.updateChannels.map((ch: any) => ch.name.replace('stable-', ''))
          );
          const expandedSelected: any[] = [];
          const seenCombos = new Set<string>();

          for (const op of stateForGenerate.operators.selected) {
            for (const minor of channelMinors) {
              const baseCatalog = op.catalogImage.replace(/:v[\d.]+$/, '');
              const newCatalogImage = `${baseCatalog}:v${minor}`;
              const key = `${newCatalogImage}:${op.name}`;
              if (!seenCombos.has(key)) {
                seenCombos.add(key);
                expandedSelected.push({ ...op, catalogImage: newCatalogImage });
              }
            }
          }

          stateForGenerate.operators = {
            ...stateForGenerate.operators,
            selected: expandedSelected,
          };
        }
        const data = await apiFetch('/api/generate', {
          method: 'POST',
          body: JSON.stringify({ state: stateForGenerate }),
        });
        if (!cancelled) {
          setImageSetYAML(data.files?.['imageset-config.yaml'] || '');
        }
      } catch (err: any) {
        if (!cancelled) {
          setGenerateError(err.message || 'Failed to generate ImageSetConfiguration');
        }
      } finally {
        if (!cancelled) {
          setGenerating(false);
        }
      }
    };
    fetchImageSetConfig();
    return () => { cancelled = true; };
  }, [state.release, state.operators, state.additionalImages, state.imagesetConfig, state.updateChannels, state.updateOperators]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);

    try {
      const pipelineName = parentPipeline
        ? generateChildName(parentPipeline)
        : `collection-${Date.now()}`;
      const namespace = 'mirror-operator-system';

      const collectionPipeline: Record<string, any> = {
        apiVersion: 'mirror.mirror.mathianasj.github.com/v1',
        kind: 'CollectionPipeline',
        metadata: {
          name: pipelineName,
          namespace: namespace
        },
        spec: {
          imageSetConfig: imageSetYAML,
          storage: {
            output: {
              pvc: `collection-${release.channel || '4.x'}-output`
            }
          },
          pvcSize: pvcSize,
          pvcStorageClass: 'gp3-csi',
          ...(parentPipeline ? { parentPipeline } : {})
        }
      };

      const csrfToken = getCsrfToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (csrfToken) {
        headers['X-CSRFToken'] = csrfToken;
      }

      const response = await fetch(
        `/api/kubernetes/apis/mirror.mirror.mathianasj.github.com/v1/namespaces/${namespace}/collectionpipelines`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(collectionPipeline)
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create CollectionPipeline: ${response.status} - ${errorText}`);
      }

      setCreatedName(pipelineName);
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
        <Alert variant="success" title="Collection Pipeline Created" isInline>
          <p>
            CollectionPipeline <strong>{createdName}</strong> has been created successfully.
          </p>
        </Alert>
        <div style={{ marginTop: '2rem' }}>
          <Button variant="primary" onClick={() => history.push('/airgap-architect')}>
            View Collection Pipelines
          </Button>
        </div>
      </div>
    );
  }

  // Calculate summary statistics
  const updateChannels = state.updateChannels || [];
  const updateOps = state.updateOperators || [];
  const updateChannelCount = updateChannels.length;
  const updateOperatorCount = updateOps.reduce((sum: number, cat: any) => sum + (cat.packages?.length || 0), 0);

  const operatorCount = operators.selectionMode === 'catalogs'
    ? 0
    : Object.values(operators.operatorsByCatalog || {}).reduce((sum: number, ops: any) => sum + ops.length, 0);
  const catalogCount = operators.selectionMode === 'catalogs'
    ? (operators.fullCatalogs || []).length
    : 0;
  const additionalImageCount = (additionalImages.images || []).length;

  return (
    <div>
      <Content>
        <Content component="h2">{parentPipeline ? 'Review and Create Update Bundle' : 'Review and Create'}</Content>
        <Content component="p">
          {parentPipeline
            ? 'Review the ImageSetConfiguration for this delta update bundle.'
            : 'Review the ImageSetConfiguration that will be used for mirroring.'}
        </Content>
      </Content>

      <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
        <h4>Configuration Summary:</h4>
        {parentPipeline && (
          <>
            <p>
              <strong>Type:</strong> Delta / Update Collection
            </p>
            <p>
              <strong>Parent Pipeline:</strong> {parentPipeline}
            </p>
          </>
        )}
        {parentPipeline && updateChannelCount > 0 ? (
          <p>
            <strong>Platform Channels:</strong> {updateChannelCount} channel entr{updateChannelCount === 1 ? 'y' : 'ies'}
          </p>
        ) : (
          <p>
            <strong>OpenShift Version:</strong> {release.patchVersion} (channel: stable-{release.channel})
          </p>
        )}
        {parentPipeline && updateOperatorCount > 0 ? (
          <p>
            <strong>Operators:</strong> {updateOperatorCount} package(s) across {updateOps.length} catalog(s)
          </p>
        ) : (
          <>
            {operators.selectionMode === 'catalogs' && catalogCount > 0 && (
              <p>
                <strong>Catalogs:</strong> {catalogCount} full catalog(s) selected
              </p>
            )}
            {operators.selectionMode === 'packages' && operatorCount > 0 && (
              <p>
                <strong>Operators:</strong> {operatorCount} package(s) selected
              </p>
            )}
          </>
        )}
        {additionalImageCount > 0 && (
          <p>
            <strong>Additional Images:</strong> {additionalImageCount} image(s)
          </p>
        )}
      </div>

      <div style={{ marginTop: '1rem', maxWidth: '300px' }}>
        <FormGroup label="PVC Storage Size" fieldId="pvc-size"
          helperText="Size of the PersistentVolumeClaim for mirrored content (e.g. 100Gi, 200Gi)."
        >
          <TextInput
            id="pvc-size"
            value={pvcSize}
            onChange={(_event, value) => setPvcSize(value)}
          />
        </FormGroup>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <h4>ImageSetConfiguration YAML:</h4>
        {generating && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <Spinner size="lg" />
            <p>Generating ImageSetConfiguration...</p>
          </div>
        )}
        {generateError && (
          <Alert variant="danger" title="Error Generating Configuration" isInline>
            <p>{generateError}</p>
          </Alert>
        )}
        {!generating && !generateError && imageSetYAML && (
          <CodeBlock>
            <CodeBlockCode>{imageSetYAML}</CodeBlockCode>
          </CodeBlock>
        )}
      </div>

      {error && (
        <Alert variant="danger" title="Error Creating Pipeline" isInline style={{ marginTop: '1rem' }}>
          <p>{error}</p>
        </Alert>
      )}

      <div style={{ marginTop: '2rem' }}>
        <Button
          variant="primary"
          onClick={handleCreate}
          isDisabled={creating || generating || !imageSetYAML}
          icon={creating ? <Spinner size="md" /> : undefined}
        >
          {creating ? 'Creating...' : parentPipeline ? 'Create Update Bundle' : 'Create Collection Pipeline'}
        </Button>
      </div>
    </div>
  );
};
