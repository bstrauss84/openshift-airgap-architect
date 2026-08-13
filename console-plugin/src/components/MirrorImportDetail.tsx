import * as React from 'react';
import {
  PageSection,
  Title,
  Content,
  Breadcrumb,
  BreadcrumbItem,
  Spinner,
  Alert,
  Card,
  CardTitle,
  CardBody,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Label,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { ExternalLinkAltIcon, CheckCircleIcon, InProgressIcon, ExclamationCircleIcon } from '@patternfly/react-icons';
import { useHistory, useLocation } from 'react-router-dom';
import { MirrorImport } from '../types';

interface PipelineRun {
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
  };
  spec?: {
    pipelineRef?: {
      name: string;
    };
  };
  status?: {
    conditions?: Array<{
      type: string;
      status: string;
      reason?: string;
      message?: string;
    }>;
    startTime?: string;
    completionTime?: string;
    childReferences?: Array<{
      apiVersion: string;
      kind: string;
      name: string;
      pipelineTaskName: string;
    }>;
  };
}

interface TaskRun {
  metadata: {
    name: string;
  };
  status?: {
    conditions?: Array<{
      type: string;
      status: string;
      reason?: string;
    }>;
    startTime?: string;
    completionTime?: string;
  };
}

export const MirrorImportDetail: React.FC = () => {
  const history = useHistory();
  const location = useLocation();
  const [mirrorImport, setMirrorImport] = React.useState<MirrorImport | null>(null);
  const [pipelineRun, setPipelineRun] = React.useState<PipelineRun | null>(null);
  const [taskRuns, setTaskRuns] = React.useState<Array<{ name: string; pipelineTaskName: string; taskRun: TaskRun }>>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingPipelineRun, setLoadingPipelineRun] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isFirstLoadRef = React.useRef(true);

  const importName = location.pathname.match(/\/airgap-architect\/imports\/([^/]+)/)?.[1] || '';
  const namespace = 'mirror-operator-system';

  const fetchImport = async () => {
    if (!importName) return;

    try {
      const response = await fetch(
        `/api/kubernetes/apis/mirror.mirror.mathianasj.github.com/v1/namespaces/${namespace}/mirrorimports/${importName}`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch import: ${response.status}`);
      }

      const data = await response.json();
      setMirrorImport(data);

      if (data.status?.pipelineRunRef) {
        const isInitialLoad = isFirstLoadRef.current;
        fetchPipelineRun(data.status.pipelineRunRef, isInitialLoad);
        isFirstLoadRef.current = false;
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load mirror import');
    } finally {
      setLoading(false);
    }
  };

  const fetchPipelineRun = async (pipelineRunName: string, isInitialLoad = false) => {
    if (isInitialLoad) {
      setLoadingPipelineRun(true);
    }

    try {
      const response = await fetch(
        `/api/kubernetes/apis/tekton.dev/v1/namespaces/${namespace}/pipelineruns/${pipelineRunName}`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch PipelineRun: ${response.status}`);
      }

      const data = await response.json();
      setPipelineRun(data);

      if (data.status?.childReferences) {
        const taskRunPromises = data.status.childReferences
          .filter((ref: any) => ref.kind === 'TaskRun')
          .map(async (ref: any) => {
            try {
              const taskRunResponse = await fetch(
                `/api/kubernetes/apis/tekton.dev/v1/namespaces/${namespace}/taskruns/${ref.name}`
              );
              if (taskRunResponse.ok) {
                const taskRunData = await taskRunResponse.json();
                return {
                  name: ref.name,
                  pipelineTaskName: ref.pipelineTaskName,
                  taskRun: taskRunData
                };
              }
            } catch (err) {
              console.error(`Failed to fetch TaskRun ${ref.name}:`, err);
            }
            return null;
          });

        const fetchedTaskRuns = await Promise.all(taskRunPromises);
        setTaskRuns(fetchedTaskRuns.filter((tr): tr is { name: string; pipelineTaskName: string; taskRun: TaskRun } => tr !== null));
      }
    } catch (err: any) {
      console.error('Failed to fetch PipelineRun:', err);
    } finally {
      if (isInitialLoad) {
        setLoadingPipelineRun(false);
      }
    }
  };

  const getPipelineRunUrl = (pipelineRunName: string) => {
    return `/k8s/ns/${namespace}/tekton.dev~v1~PipelineRun/${pipelineRunName}`;
  };

  const calculateDuration = (startTime?: string, endTime?: string) => {
    if (!startTime) return '-';
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date();
    const durationMs = end.getTime() - start.getTime();

    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((durationMs % (1000 * 60)) / 1000);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const getTaskStatus = (taskRun: any) => {
    const conditions = taskRun?.status?.conditions || [];
    const succeededCondition = conditions.find((c: any) => c.type === 'Succeeded');

    if (!succeededCondition) {
      return { status: 'Pending', variant: 'warning' as const };
    }

    if (succeededCondition.status === 'True') {
      return { status: 'Succeeded', variant: 'success' as const };
    } else if (succeededCondition.status === 'False') {
      return { status: 'Failed', variant: 'danger' as const };
    } else {
      return { status: 'Running', variant: 'info' as const };
    }
  };

  const getSortedTaskRuns = () => {
    return [...taskRuns].sort((a, b) => {
      const aStart = a.taskRun.status?.startTime || '';
      const bStart = b.taskRun.status?.startTime || '';
      return aStart.localeCompare(bStart);
    });
  };

  React.useEffect(() => {
    fetchImport();
    const interval = setInterval(fetchImport, 10000);
    return () => clearInterval(interval);
  }, [importName]);

  const formatTimestamp = (timestamp?: string) => {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleString();
  };

  const getPhaseColor = (phase?: string): 'green' | 'blue' | 'red' | 'orange' | 'grey' => {
    if (!phase) return 'grey';
    if (phase === 'Succeeded' || phase === 'Complete') return 'green';
    if (phase === 'Running' || phase === 'InProgress') return 'blue';
    if (phase === 'Failed') return 'red';
    return 'orange';
  };

  if (loading) {
    return (
      <PageSection>
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <Spinner size="xl" />
          <p style={{ marginTop: '1rem' }}>Loading mirror import...</p>
        </div>
      </PageSection>
    );
  }

  if (error || !mirrorImport) {
    return (
      <PageSection>
        <Alert variant="danger" title="Error" isInline>
          <p>{error || 'Mirror import not found'}</p>
        </Alert>
      </PageSection>
    );
  }

  const phase = mirrorImport.status?.phase || 'Pending';

  return (
    <>
      <PageSection variant="light">
        <Breadcrumb>
          <BreadcrumbItem to="#" onClick={() => history.push('/airgap-architect')}>
            Airgap Architect
          </BreadcrumbItem>
          <BreadcrumbItem isActive>{importName}</BreadcrumbItem>
        </Breadcrumb>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
          <Title headingLevel="h1" size="2xl">
            {importName}
          </Title>
          <Label color={getPhaseColor(phase)}>{phase}</Label>
        </div>
      </PageSection>

      <PageSection>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <Card>
            <CardTitle>Status</CardTitle>
            <CardBody>
              <DescriptionList>
                <DescriptionListGroup>
                  <DescriptionListTerm>Phase</DescriptionListTerm>
                  <DescriptionListDescription>{phase}</DescriptionListDescription>
                </DescriptionListGroup>
                {mirrorImport.status?.conditions?.length > 0 && (() => {
                  const latestCondition = mirrorImport.status.conditions[mirrorImport.status.conditions.length - 1];
                  return latestCondition?.message ? (
                    <DescriptionListGroup>
                      <DescriptionListTerm>Message</DescriptionListTerm>
                      <DescriptionListDescription>{latestCondition.message}</DescriptionListDescription>
                    </DescriptionListGroup>
                  ) : null;
                })()}
                <DescriptionListGroup>
                  <DescriptionListTerm>Created</DescriptionListTerm>
                  <DescriptionListDescription>
                    {formatTimestamp(mirrorImport.metadata.creationTimestamp)}
                  </DescriptionListDescription>
                </DescriptionListGroup>
                {mirrorImport.status?.pipelineRunRef && (
                  <DescriptionListGroup>
                    <DescriptionListTerm>Pipeline Run</DescriptionListTerm>
                    <DescriptionListDescription>
                      <a
                        href={getPipelineRunUrl(mirrorImport.status.pipelineRunRef)}
                        style={{ color: '#0066cc', textDecoration: 'none' }}
                        onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                        onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                      >
                        {mirrorImport.status.pipelineRunRef} <ExternalLinkAltIcon />
                      </a>
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                )}
              </DescriptionList>
            </CardBody>
          </Card>

          {pipelineRun && (
            <Card style={{ gridColumn: '1 / -1' }}>
              <CardTitle>Pipeline Tasks</CardTitle>
              <CardBody>
                {loadingPipelineRun && (
                  <div style={{ textAlign: 'center', padding: '1rem' }}>
                    <Spinner size="md" /> Loading task details...
                  </div>
                )}

                {!loadingPipelineRun && (
                  <>
                    {pipelineRun.status?.startTime && (
                      <DescriptionList isHorizontal style={{ marginBottom: '1rem' }}>
                        <DescriptionListGroup>
                          <DescriptionListTerm>Total Duration</DescriptionListTerm>
                          <DescriptionListDescription>
                            {calculateDuration(pipelineRun.status.startTime, pipelineRun.status.completionTime)}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      </DescriptionList>
                    )}

                    <Table aria-label="Pipeline Tasks" variant="compact">
                      <Thead>
                        <Tr>
                          <Th>Task Name</Th>
                          <Th>Status</Th>
                          <Th>Duration</Th>
                          <Th>Started</Th>
                          <Th>Completed</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {getSortedTaskRuns().map(({ name, pipelineTaskName, taskRun }) => {
                          const taskStatus = getTaskStatus(taskRun);
                          return (
                            <Tr key={name}>
                              <Td>{pipelineTaskName}</Td>
                              <Td>
                                <span
                                  style={{
                                    padding: '0.25rem 0.5rem',
                                    borderRadius: '4px',
                                    fontSize: '0.875rem',
                                    fontWeight: 600,
                                    background:
                                      taskStatus.variant === 'success'
                                        ? '#d4edda'
                                        : taskStatus.variant === 'danger'
                                        ? '#f8d7da'
                                        : taskStatus.variant === 'info'
                                        ? '#d1ecf1'
                                        : '#fff3cd',
                                    color:
                                      taskStatus.variant === 'success'
                                        ? '#155724'
                                        : taskStatus.variant === 'danger'
                                        ? '#721c24'
                                        : taskStatus.variant === 'info'
                                        ? '#0c5460'
                                        : '#856404'
                                  }}
                                >
                                  {taskStatus.status === 'Succeeded' && <CheckCircleIcon style={{ marginRight: '0.25rem' }} />}
                                  {taskStatus.status === 'Running' && <InProgressIcon style={{ marginRight: '0.25rem' }} />}
                                  {taskStatus.status === 'Failed' && <ExclamationCircleIcon style={{ marginRight: '0.25rem' }} />}
                                  {taskStatus.status}
                                </span>
                              </Td>
                              <Td>
                                {calculateDuration(
                                  taskRun.status?.startTime,
                                  taskRun.status?.completionTime
                                )}
                              </Td>
                              <Td>{formatTimestamp(taskRun.status?.startTime)}</Td>
                              <Td>{formatTimestamp(taskRun.status?.completionTime)}</Td>
                            </Tr>
                          );
                        })}
                      </Tbody>
                    </Table>

                    {getSortedTaskRuns().length === 0 && (
                      <Alert variant="info" title="No Tasks" isInline>
                        <p>No task runs found for this pipeline.</p>
                      </Alert>
                    )}
                  </>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardTitle>Bundle</CardTitle>
            <CardBody>
              <DescriptionList>
                <DescriptionListGroup>
                  <DescriptionListTerm>PVC</DescriptionListTerm>
                  <DescriptionListDescription>
                    {mirrorImport.spec?.bundle?.pvc || '-'}
                  </DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Filename</DescriptionListTerm>
                  <DescriptionListDescription>
                    {mirrorImport.spec?.bundle?.filename || '-'}
                  </DescriptionListDescription>
                </DescriptionListGroup>
                {mirrorImport.spec?.storageSize && (
                  <DescriptionListGroup>
                    <DescriptionListTerm>Storage Size</DescriptionListTerm>
                    <DescriptionListDescription>
                      {mirrorImport.spec.storageSize}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                )}
              </DescriptionList>
            </CardBody>
          </Card>

          <Card>
            <CardTitle>Target Registry</CardTitle>
            <CardBody>
              <DescriptionList>
                <DescriptionListGroup>
                  <DescriptionListTerm>URL</DescriptionListTerm>
                  <DescriptionListDescription>
                    {mirrorImport.spec?.targetRegistry?.url || '-'}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>
            </CardBody>
          </Card>

          <Card>
            <CardTitle>Publish Options</CardTitle>
            <CardBody>
              <DescriptionList>
                <DescriptionListGroup>
                  <DescriptionListTerm>CatalogSource</DescriptionListTerm>
                  <DescriptionListDescription>
                    {mirrorImport.spec?.publish?.catalogSource !== false ? 'Enabled' : 'Disabled'}
                  </DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>ImageContentSourcePolicy</DescriptionListTerm>
                  <DescriptionListDescription>
                    {mirrorImport.spec?.publish?.imageContentSourcePolicy !== false ? 'Enabled' : 'Disabled'}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>
            </CardBody>
          </Card>
        </div>
      </PageSection>
    </>
  );
};
