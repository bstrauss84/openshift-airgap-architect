/**
 * Collection Pipeline List (Console Plugin Version)
 *
 * Lists and monitors CollectionPipeline resources.
 */
import * as React from 'react';
import {
  PageSection, Title, Content, Button, Alert, Spinner,
  Dropdown, DropdownItem, DropdownList, MenuToggle, Divider,
  Modal, ModalHeader, ModalBody, ModalFooter, ModalVariant,
} from '@patternfly/react-core';
import { EllipsisVIcon } from '@patternfly/react-icons';
import {
  Table,
  Thead,
  Tr,
  Th,
  Tbody,
  Td
} from '@patternfly/react-table';
import { useHistory } from 'react-router-dom';
import { CollectionPipeline } from '../types';
import { getCsrfToken } from '../utils/pipeline-helpers';

export const CollectionPipelineList: React.FC = () => {
  const history = useHistory();
  const [pipelines, setPipelines] = React.useState<CollectionPipeline[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [openMenuPipeline, setOpenMenuPipeline] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

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

  const handleDownload = (pipelineName: string) => {
    const proxyBase = '/api/proxy/plugin/airgap-architect-plugin/backend';
    window.open(`${proxyBase}/api/collections/${pipelineName}/download/bundle`, '_blank');
  };

  const handleDelete = async (name: string) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const headers: Record<string, string> = {};
      const csrfToken = getCsrfToken();
      if (csrfToken) headers['X-CSRFToken'] = csrfToken;

      const response = await fetch(
        `/api/kubernetes/apis/mirror.mirror.mathianasj.github.com/v1/namespaces/mirror-operator-system/collectionpipelines/${name}`,
        { method: 'DELETE', headers }
      );
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete: ${response.status} - ${errorText}`);
      }
      setDeleteTarget(null);
      fetchPipelines();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete pipeline');
    } finally {
      setDeleting(false);
    }
  };

  const isComplete = (phase?: string) => phase === 'Complete' || phase === 'Succeeded';

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
                <Th>Type</Th>
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
                        background: pipeline.spec?.parentPipeline ? '#d1ecf1' : '#e8e8e8',
                        color: pipeline.spec?.parentPipeline ? '#0c5460' : '#151515'
                      }}
                      title={pipeline.spec?.parentPipeline ? `Parent: ${pipeline.spec.parentPipeline}` : ''}
                    >
                      {pipeline.spec?.parentPipeline ? 'Update' : 'Base'}
                    </span>
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
                  <Td isActionCell>
                    <Dropdown
                      isOpen={openMenuPipeline === pipeline.metadata.name}
                      onSelect={() => setOpenMenuPipeline(null)}
                      onOpenChange={(open) => { if (!open) setOpenMenuPipeline(null); }}
                      toggle={(toggleRef) => (
                        <MenuToggle
                          ref={toggleRef}
                          variant="plain"
                          onClick={() => setOpenMenuPipeline(
                            openMenuPipeline === pipeline.metadata.name ? null : pipeline.metadata.name
                          )}
                          isExpanded={openMenuPipeline === pipeline.metadata.name}
                          aria-label={`Actions for ${pipeline.metadata.name}`}
                        >
                          <EllipsisVIcon />
                        </MenuToggle>
                      )}
                      popperProps={{ position: 'right' }}
                    >
                      <DropdownList>
                        {isComplete(pipeline.status?.phase) && (
                          <>
                            <DropdownItem
                              key="download"
                              onClick={() => handleDownload(pipeline.metadata.name)}
                            >
                              Download Bundle
                            </DropdownItem>
                            <DropdownItem
                              key="update"
                              onClick={() => history.push(`/airgap-architect/imagesets/create?parentPipeline=${pipeline.metadata.name}`)}
                            >
                              Create Update Bundle
                            </DropdownItem>
                            <Divider key="separator" />
                          </>
                        )}
                        <DropdownItem
                          key="delete"
                          isDanger
                          onClick={() => setDeleteTarget(pipeline.metadata.name)}
                        >
                          Delete
                        </DropdownItem>
                      </DropdownList>
                    </Dropdown>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </PageSection>

      <Modal
        variant={ModalVariant.small}
        isOpen={deleteTarget !== null}
        onClose={() => { setDeleteTarget(null); setDeleteError(null); }}
        aria-label="Delete collection pipeline confirmation"
      >
        <ModalHeader title="Delete Collection Pipeline?" />
        <ModalBody>
          <p>
            Are you sure you want to delete <strong>{deleteTarget}</strong>? This action cannot be undone.
          </p>
          {deleteError && (
            <Alert variant="danger" title="Delete Failed" isInline style={{ marginTop: '1rem' }}>
              <p>{deleteError}</p>
            </Alert>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="danger"
            onClick={() => deleteTarget && handleDelete(deleteTarget)}
            isLoading={deleting}
            isDisabled={deleting}
          >
            Delete
          </Button>
          <Button
            variant="link"
            onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
            isDisabled={deleting}
          >
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
};
