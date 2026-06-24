/**
 * Collection Pipeline List (Console Plugin Version)
 *
 * Lists and monitors CollectionPipeline resources.
 */
import * as React from 'react';
import { PageSection } from '@patternfly/react-core/dist/dynamic/components/Page';
import { Title } from '@patternfly/react-core/dist/dynamic/components/Title';
import { Content } from '@patternfly/react-core/dist/dynamic/components/Content';
import { Button } from '@patternfly/react-core/dist/dynamic/components/Button';
import { Alert } from '@patternfly/react-core/dist/dynamic/components/Alert';
import { Spinner } from '@patternfly/react-core/dist/dynamic/components/Spinner';
import DownloadIcon from '@patternfly/react-icons/dist/dynamic/icons/download-icon';
import {
  Table,
  Thead,
  Tr,
  Th,
  Tbody,
  Td
} from '@patternfly/react-table';
import { useHistory } from 'react-router-dom';

interface CollectionPipeline {
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
  };
  status?: {
    phase: string;
    version?: string;
    startTime?: string;
    completionTime?: string;
    pipelineRunRef?: string;
    bundleUrl?: string;
  };
}

export const CollectionPipelineList: React.FC = () => {
  const history = useHistory();
  const [pipelines, setPipelines] = React.useState<CollectionPipeline[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [downloadingPipeline, setDownloadingPipeline] = React.useState<string | null>(null);

  const fetchPipelines = async () => {
    try {
      const response = await fetch(
        '/api/kubernetes/apis/mirror.mirror.mathianasj.github.com/v1/namespaces/mirror-operator-system/collectionpipelines'
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch pipelines: ${response.status}`);
      }

      const data = await response.json();
      setPipelines(data.items || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load collection pipelines');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchPipelines();

    // Poll for updates every 10 seconds
    const interval = setInterval(fetchPipelines, 10000);
    return () => clearInterval(interval);
  }, []);

  const formatTimestamp = (timestamp?: string) => {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleString();
  };

  const getStatusVariant = (phase?: string): 'success' | 'warning' | 'info' | 'danger' => {
    if (!phase) return 'info';
    if (phase === 'Succeeded' || phase === 'Complete') return 'success';
    if (phase === 'Running' || phase === 'InProgress') return 'info';
    if (phase === 'Failed') return 'danger';
    return 'warning';
  };

  const getDetailUrl = (pipelineName: string) => {
    return `/airgap-architect/collections/${pipelineName}`;
  };

  const handleDownload = async (pipelineName: string) => {
    setDownloadingPipeline(pipelineName);
    try {
      // Call backend API via console plugin proxy to get pre-signed download URLs
      const response = await fetch(`/api/proxy/plugin/airgap-architect-plugin/backend/api/collections/${pipelineName}/download-url`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to get download URL: ${response.status}`);
      }

      const data = await response.json();

      // If we have URLs, download the main bundle (mirror_seq1_000000.tar)
      if (data.urls && data.urls['mirror_seq1_000000.tar']) {
        window.open(data.urls['mirror_seq1_000000.tar'], '_blank');
      } else {
        throw new Error('No bundle URL available');
      }
    } catch (err: any) {
      alert(`Failed to download: ${err.message}`);
    } finally {
      setDownloadingPipeline(null);
    }
  };

  return (
    <>
      <PageSection variant="light">
        <Title headingLevel="h1" size="2xl">
          Collection Pipelines
        </Title>
        <Content component="p">
          View and monitor mirroring collection pipelines
        </Content>
        <div style={{ marginTop: '1rem' }}>
          <Button variant="primary" onClick={() => history.push('/airgap-architect/imagesets/create')}>
            Create New Collection
          </Button>
        </div>
      </PageSection>
      <PageSection>
        {loading && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <Spinner size="lg" />
            <p>Loading collection pipelines...</p>
          </div>
        )}

        {error && (
          <Alert variant="danger" title="Error Loading Pipelines" isInline>
            <p>{error}</p>
          </Alert>
        )}

        {!loading && !error && pipelines.length === 0 && (
          <Alert variant="info" title="No Collection Pipelines" isInline>
            <p>No collection pipelines found. Create one to start mirroring content.</p>
          </Alert>
        )}

        {!loading && !error && pipelines.length > 0 && (
          <Table aria-label="Collection Pipelines Table" variant="compact">
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Version</Th>
                <Th>Created</Th>
                <Th>Completed</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {pipelines.map((pipeline) => (
                <Tr key={pipeline.metadata.name}>
                  <Td>
                    <a
                      href={getDetailUrl(pipeline.metadata.name)}
                      style={{ color: '#0066cc', textDecoration: 'none', cursor: 'pointer' }}
                      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                      onClick={(e) => {
                        e.preventDefault();
                        history.push(getDetailUrl(pipeline.metadata.name));
                      }}
                    >
                      {pipeline.metadata.name}
                    </a>
                  </Td>
                  <Td>
                    <span
                      style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        background:
                          getStatusVariant(pipeline.status?.phase) === 'success'
                            ? '#d4edda'
                            : getStatusVariant(pipeline.status?.phase) === 'danger'
                            ? '#f8d7da'
                            : getStatusVariant(pipeline.status?.phase) === 'info'
                            ? '#d1ecf1'
                            : '#fff3cd',
                        color:
                          getStatusVariant(pipeline.status?.phase) === 'success'
                            ? '#155724'
                            : getStatusVariant(pipeline.status?.phase) === 'danger'
                            ? '#721c24'
                            : getStatusVariant(pipeline.status?.phase) === 'info'
                            ? '#0c5460'
                            : '#856404'
                      }}
                    >
                      {pipeline.status?.phase || 'Pending'}
                    </span>
                  </Td>
                  <Td>{pipeline.status?.version || '-'}</Td>
                  <Td>{formatTimestamp(pipeline.metadata.creationTimestamp)}</Td>
                  <Td>{formatTimestamp(pipeline.status?.completionTime)}</Td>
                  <Td>
                    {(pipeline.status?.phase === 'Complete' || pipeline.status?.phase === 'Succeeded') ? (
                      <Button
                        variant="link"
                        icon={<DownloadIcon />}
                        onClick={() => handleDownload(pipeline.metadata.name)}
                        isLoading={downloadingPipeline === pipeline.metadata.name}
                        isDisabled={downloadingPipeline !== null}
                      >
                        {downloadingPipeline === pipeline.metadata.name ? 'Generating URL...' : 'Download Bundle'}
                      </Button>
                    ) : (
                      <span style={{ color: '#6a6e73', fontSize: '0.875rem' }}>-</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </PageSection>
    </>
  );
};
