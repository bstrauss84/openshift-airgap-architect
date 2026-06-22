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
  };
}

export const CollectionPipelineList: React.FC = () => {
  const history = useHistory();
  const [pipelines, setPipelines] = React.useState<CollectionPipeline[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

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
              </Tr>
            </Thead>
            <Tbody>
              {pipelines.map((pipeline) => (
                <Tr key={pipeline.metadata.name}>
                  <Td>{pipeline.metadata.name}</Td>
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
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </PageSection>
    </>
  );
};
