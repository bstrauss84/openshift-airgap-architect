import * as React from 'react';
import { PageSection, Title, Content, Button, Alert, Spinner } from '@patternfly/react-core';
import {
  Table,
  Thead,
  Tr,
  Th,
  Tbody,
  Td
} from '@patternfly/react-table';
import { useHistory } from 'react-router-dom';
import { MirrorImport } from '../types';

export const MirrorImportList: React.FC = () => {
  const history = useHistory();
  const [imports, setImports] = React.useState<MirrorImport[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchImports = async () => {
    try {
      const response = await fetch(
        '/api/kubernetes/apis/mirror.mirror.mathianasj.github.com/v1/namespaces/mirror-operator-system/mirrorimports'
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch imports: ${response.status}`);
      }

      const data = await response.json();
      setImports(data.items || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load mirror imports');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchImports();
    const interval = setInterval(fetchImports, 10000);
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

  const getStatusColor = (phase?: string) => {
    const variant = getStatusVariant(phase);
    const map = {
      success: { bg: '#d4edda', fg: '#155724' },
      danger: { bg: '#f8d7da', fg: '#721c24' },
      info: { bg: '#d1ecf1', fg: '#0c5460' },
      warning: { bg: '#fff3cd', fg: '#856404' },
    };
    return map[variant];
  };

  return (
    <>
      <PageSection variant="light">
        <Title headingLevel="h1" size="2xl">
          Mirror Imports
        </Title>
        <Content component="p">
          Upload and import mirrored content bundles into the disconnected registry
        </Content>
        <div style={{ marginTop: '1rem' }}>
          <Button variant="primary" onClick={() => history.push('/airgap-architect/imports/create')}>
            Import Bundle
          </Button>
        </div>
      </PageSection>
      <PageSection>
        {loading && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <Spinner size="lg" />
            <p>Loading mirror imports...</p>
          </div>
        )}

        {error && (
          <Alert variant="danger" title="Error Loading Imports" isInline>
            <p>{error}</p>
          </Alert>
        )}

        {!loading && !error && imports.length === 0 && (
          <Alert variant="info" title="No Mirror Imports" isInline>
            <p>No mirror imports found. Import a collection bundle to get started.</p>
          </Alert>
        )}

        {!loading && !error && imports.length > 0 && (
          <Table aria-label="Mirror Imports Table" variant="compact">
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Target Registry</Th>
                <Th>Bundle File</Th>
                <Th>Created</Th>
                <Th>Completed</Th>
              </Tr>
            </Thead>
            <Tbody>
              {imports.map((imp) => {
                const colors = getStatusColor(imp.status?.phase);
                return (
                  <Tr key={imp.metadata.name}>
                    <Td>
                      <a
                        href={`/airgap-architect/imports/${imp.metadata.name}`}
                        style={{ color: '#0066cc', textDecoration: 'none', cursor: 'pointer' }}
                        onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                        onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                        onClick={(e) => {
                          e.preventDefault();
                          history.push(`/airgap-architect/imports/${imp.metadata.name}`);
                        }}
                      >
                        {imp.metadata.name}
                      </a>
                    </Td>
                    <Td>
                      <span
                        style={{
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          background: colors.bg,
                          color: colors.fg,
                        }}
                      >
                        {imp.status?.phase || 'Pending'}
                      </span>
                    </Td>
                    <Td>{imp.spec?.targetRegistry?.url || '-'}</Td>
                    <Td>{imp.spec?.bundle?.filename || '-'}</Td>
                    <Td>{formatTimestamp(imp.metadata.creationTimestamp)}</Td>
                    <Td>{formatTimestamp(imp.status?.completionTime)}</Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </PageSection>
    </>
  );
};
