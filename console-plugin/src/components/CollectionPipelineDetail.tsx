/**
 * Collection Pipeline Detail View (Console Plugin Version)
 *
 * Displays comprehensive details about a single CollectionPipeline including:
 * - Run status and progress
 * - Pre-signed download URLs for bundle and signature files
 * - Link to SBOM in Trusted Application Analyzer
 * - Configuration details (versions, operators, images)
 * - ImageSetConfiguration YAML
 */
import * as React from 'react';
import { useParams, useHistory } from 'react-router-dom';
import {
  PageSection, Title, Content, Button, Alert, Spinner,
  Card, CardBody, CardTitle,
  DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription,
  CodeBlock, CodeBlockCode,
  List, ListItem,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { DownloadIcon, ExternalLinkAltIcon, CheckCircleIcon, InProgressIcon, ExclamationCircleIcon } from '@patternfly/react-icons';
import { CollectionPipeline } from '../types';

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

export const CollectionPipelineDetail: React.FC = () => {
  // OpenShift Console plugins need to parse the path manually
  // since useParams doesn't work with console plugin routes
  const history = useHistory();
  const pathname = window.location.pathname;
  const match = pathname.match(/\/airgap-architect\/collections\/([^/]+)/);
  const name = match ? match[1] : undefined;

  // Debug logging
  console.log('CollectionPipelineDetail - name param:', name);
  console.log('CollectionPipelineDetail - location:', window.location.href);
  console.log('CollectionPipelineDetail - pathname:', pathname);

  const [pipeline, setPipeline] = React.useState<CollectionPipeline | null>(null);
  const [pipelineRun, setPipelineRun] = React.useState<PipelineRun | null>(null);
  const [taskRuns, setTaskRuns] = React.useState<Array<{ name: string; pipelineTaskName: string; taskRun: TaskRun }>>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingPipelineRun, setLoadingPipelineRun] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [downloadUrls, setDownloadUrls] = React.useState<{ bundle?: string; signature?: string; bundleSize?: number } | null>(null);
  const [loadingDownloadUrls, setLoadingDownloadUrls] = React.useState(false);

  // Track if this is the first load using a ref
  const isFirstLoadRef = React.useRef(true);

  const namespace = 'mirror-operator-system';

  const fetchPipeline = async () => {
    if (!name) {
      setError('Collection pipeline name is missing from URL');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(
        `/api/kubernetes/apis/mirror.mirror.mathianasj.github.com/v1/namespaces/${namespace}/collectionpipelines/${name}`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch pipeline: ${response.status}`);
      }

      const data = await response.json();
      setPipeline(data);

      // Fetch PipelineRun details if available
      if (data.status?.pipelineRunRef) {
        // Only show loading on first fetch, not on auto-refresh
        const isInitialLoad = isFirstLoadRef.current;
        fetchPipelineRun(data.status.pipelineRunRef, isInitialLoad);
        isFirstLoadRef.current = false;
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load collection pipeline');
    } finally {
      setLoading(false);
    }
  };

  const fetchPipelineRun = async (pipelineRunName: string, isInitialLoad = false) => {
    // Only show loading spinner on initial load, not on auto-refresh
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

      // Fetch individual TaskRuns from childReferences
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
      // Don't set error state - we still want to show the pipeline details
    } finally {
      if (isInitialLoad) {
        setLoadingPipelineRun(false);
      }
    }
  };

  // Determine completion status
  const isComplete = pipeline?.status?.phase === 'Complete' || pipeline?.status?.phase === 'Succeeded';
  const isRunning = pipeline?.status?.phase === 'Running' || pipeline?.status?.phase === 'InProgress';
  const isFailed = pipeline?.status?.phase === 'Failed';

  React.useEffect(() => {
    fetchPipeline();

    // Poll for updates every 10 seconds
    const interval = setInterval(fetchPipeline, 10000);
    return () => clearInterval(interval);
  }, [name]);

  // Fetch download URLs when pipeline becomes complete
  React.useEffect(() => {
    if (isComplete && !downloadUrls && !loadingDownloadUrls) {
      fetchDownloadUrls();
    }
  }, [isComplete, name]);

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

  const getPipelineRunUrl = (pipelineRunName: string) => {
    return `/k8s/ns/${namespace}/tekton.dev~v1~PipelineRun/${pipelineRunName}`;
  };

  const getSbomUrl = () => {
    // SBOM URL should be set by the operator in the CollectionPipeline status
    // This should be the specific SBOM URL for this collection, not just the base TPA URL
    return pipeline?.status?.sbomUrl;
  };

  const fetchDownloadUrls = async () => {
    if (!name || !isComplete) {
      return;
    }

    setLoadingDownloadUrls(true);
    try {
      // Call backend API to get pre-signed download URLs with proper public endpoint
      const response = await fetch(`/api/proxy/plugin/airgap-architect-plugin/backend/api/collections/${name}/download-url`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to get download URLs: ${response.status}`);
      }

      const data = await response.json();

      // Extract bundle and signature URLs from the response
      // The backend returns URLs keyed by filename with { url, size } objects
      const urls = data.urls || {};
      const bundleKey = Object.keys(urls).find(key => key.endsWith('.tar.gz') || key.endsWith('.tar'));
      const signatureKey = Object.keys(urls).find(key => key.endsWith('.sig'));

      const bundleEntry = bundleKey ? urls[bundleKey] : undefined;
      const signatureEntry = signatureKey ? urls[signatureKey] : undefined;

      setDownloadUrls({
        bundle: typeof bundleEntry === 'object' ? bundleEntry?.url : bundleEntry,
        bundleSize: typeof bundleEntry === 'object' ? bundleEntry?.size : undefined,
        signature: typeof signatureEntry === 'object' ? signatureEntry?.url : signatureEntry,
      });
    } catch (err: any) {
      console.error('Failed to fetch download URLs:', err);
      // Fall back to using status URLs if API call fails
      setDownloadUrls({
        bundle: pipeline?.status?.bundleUrl,
        signature: pipeline?.status?.signatureUrl
      });
    } finally {
      setLoadingDownloadUrls(false);
    }
  };

  const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
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
    return taskRuns.sort((a, b) => {
      const aStart = a.taskRun.status?.startTime || '';
      const bStart = b.taskRun.status?.startTime || '';
      return aStart.localeCompare(bStart);
    });
  };

  const parseImageSetConfig = (yaml?: string) => {
    if (!yaml) return null;

    try {
      // Simple YAML parsing for display purposes
      const lines = yaml.split('\n');
      const config: any = {
        version: '',
        channel: '',
        operators: [],
        catalogs: [],
        additionalImages: []
      };

      let inOperators = false;
      let inAdditionalImages = false;
      let currentCatalog = '';

      for (const line of lines) {
        if (line.includes('minVersion:')) {
          config.version = line.split(':')[1].trim();
        }
        if (line.includes('name: stable-')) {
          config.channel = line.split('stable-')[1].trim();
        }
        if (line.includes('operators:')) {
          inOperators = true;
          inAdditionalImages = false;
        }
        if (line.includes('additionalImages:')) {
          inAdditionalImages = true;
          inOperators = false;
        }
        if (inOperators && line.includes('- catalog:')) {
          currentCatalog = line.split('catalog:')[1].trim();
          config.catalogs.push(currentCatalog);
        }
        if (inOperators && line.includes('- name:')) {
          config.operators.push(line.split('name:')[1].trim());
        }
        if (inAdditionalImages && line.includes('- name:')) {
          config.additionalImages.push(line.split('name:')[1].trim());
        }
      }

      return config;
    } catch (err) {
      console.error('Failed to parse ImageSetConfig:', err);
      return null;
    }
  };

  const parsedConfig = parseImageSetConfig(pipeline?.spec?.imageSetConfig);

  if (loading) {
    return (
      <PageSection>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <Spinner size="lg" />
          <p>Loading collection pipeline...</p>
        </div>
      </PageSection>
    );
  }

  if (error || !pipeline) {
    return (
      <PageSection>
        <Alert variant="danger" title="Error Loading Pipeline" isInline>
          <p>{error || 'Pipeline not found'}</p>
        </Alert>
        <div style={{ marginTop: '1rem' }}>
          <Button variant="link" onClick={() => history.push('/airgap-architect')}>
            Back to Collection Pipelines
          </Button>
        </div>
      </PageSection>
    );
  }

  return (
    <>
      <PageSection variant="light">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Title headingLevel="h1" size="2xl">
              {pipeline.metadata.name}
            </Title>
            <Content component="p">Collection Pipeline Details</Content>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {isComplete && (
              <Button
                variant="primary"
                onClick={() => history.push(`/airgap-architect/imagesets/create?parentPipeline=${pipeline.metadata.name}`)}
              >
                Create Update Bundle
              </Button>
            )}
            <Button variant="secondary" onClick={() => history.push('/airgap-architect')}>
              Back to List
            </Button>
          </div>
        </div>
      </PageSection>

      <PageSection>
        {/* Status Card */}
        <Card style={{ marginBottom: '1rem' }}>
          <CardTitle>Status</CardTitle>
          <CardBody>
            <DescriptionList isHorizontal>
              <DescriptionListGroup>
                <DescriptionListTerm>Current Phase</DescriptionListTerm>
                <DescriptionListDescription>
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
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Created</DescriptionListTerm>
                <DescriptionListDescription>
                  {formatTimestamp(pipeline.metadata.creationTimestamp)}
                </DescriptionListDescription>
              </DescriptionListGroup>
              {pipeline.status?.startTime && (
                <DescriptionListGroup>
                  <DescriptionListTerm>Started</DescriptionListTerm>
                  <DescriptionListDescription>
                    {formatTimestamp(pipeline.status.startTime)}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              )}
              {pipeline.status?.completionTime && (
                <DescriptionListGroup>
                  <DescriptionListTerm>Completed</DescriptionListTerm>
                  <DescriptionListDescription>
                    {formatTimestamp(pipeline.status.completionTime)}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              )}
              {pipeline.status?.pipelineRunRef && (
                <DescriptionListGroup>
                  <DescriptionListTerm>Pipeline Run</DescriptionListTerm>
                  <DescriptionListDescription>
                    <a
                      href={getPipelineRunUrl(pipeline.status.pipelineRunRef)}
                      style={{ color: '#0066cc', textDecoration: 'none' }}
                      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                    >
                      {pipeline.status.pipelineRunRef} <ExternalLinkAltIcon />
                    </a>
                  </DescriptionListDescription>
                </DescriptionListGroup>
              )}
            </DescriptionList>
          </CardBody>
        </Card>

        {/* Lineage Card */}
        <Card style={{ marginBottom: '1rem' }}>
          <CardTitle>Lineage</CardTitle>
          <CardBody>
            <DescriptionList isHorizontal>
              <DescriptionListGroup>
                <DescriptionListTerm>Type</DescriptionListTerm>
                <DescriptionListDescription>
                  {pipeline.spec?.parentPipeline ? 'Delta / Update Collection' : 'Base Collection'}
                </DescriptionListDescription>
              </DescriptionListGroup>
              {pipeline.spec?.parentPipeline && (
                <>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Parent Pipeline</DescriptionListTerm>
                    <DescriptionListDescription>
                      <a
                        href={`/airgap-architect/collections/${pipeline.spec.parentPipeline}`}
                        style={{ color: '#0066cc', textDecoration: 'none' }}
                        onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                        onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                        onClick={(e) => {
                          e.preventDefault();
                          history.push(`/airgap-architect/collections/${pipeline.spec!.parentPipeline}`);
                        }}
                      >
                        {pipeline.spec.parentPipeline}
                      </a>
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  {pipeline.status?.parentPipelineVersion && (
                    <DescriptionListGroup>
                      <DescriptionListTerm>Parent Version</DescriptionListTerm>
                      <DescriptionListDescription>
                        {pipeline.status.parentPipelineVersion}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  )}
                </>
              )}
              {pipeline.status?.workingPvcName && (
                <DescriptionListGroup>
                  <DescriptionListTerm>Working PVC</DescriptionListTerm>
                  <DescriptionListDescription>
                    {pipeline.status.workingPvcName}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              )}
            </DescriptionList>
          </CardBody>
        </Card>

        {/* Pipeline Task Runs Card */}
        {pipelineRun && (
          <Card style={{ marginBottom: '1rem' }}>
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

        {/* Downloads Card (only show when complete) */}
        {isComplete && (downloadUrls || getSbomUrl()) && (
          <Card style={{ marginBottom: '1rem' }}>
            <CardTitle>Downloads</CardTitle>
            <CardBody>
              {loadingDownloadUrls && (
                <div style={{ textAlign: 'center', padding: '1rem' }}>
                  <Spinner size="md" /> Generating download URLs...
                </div>
              )}

              {!loadingDownloadUrls && (
                <>
                  <List>
                    {downloadUrls?.bundle && (
                      <ListItem>
                        <Button
                          variant="link"
                          icon={<DownloadIcon />}
                          component="a"
                          href={downloadUrls.bundle}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Download Collection Bundle (.tar.gz){downloadUrls.bundleSize ? ` (${formatBytes(downloadUrls.bundleSize)})` : ''}
                        </Button>
                      </ListItem>
                    )}
                    {downloadUrls?.signature && (
                      <ListItem>
                        <Button
                          variant="link"
                          icon={<DownloadIcon />}
                          component="a"
                          href={downloadUrls.signature}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Download Signature (.sig)
                        </Button>
                      </ListItem>
                    )}
                  </List>

                  {getSbomUrl() && (
                    <div style={{ marginTop: '1rem' }}>
                      <Button
                        variant="link"
                        icon={<ExternalLinkAltIcon />}
                        component="a"
                        href={getSbomUrl()}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View SBOM in Trusted Application Analyzer
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        )}

        {/* Configuration Details Card */}
        {parsedConfig && (
          <Card style={{ marginBottom: '1rem' }}>
            <CardTitle>Configuration</CardTitle>
            <CardBody>
              <DescriptionList isHorizontal>
                <DescriptionListGroup>
                  <DescriptionListTerm>OpenShift Version</DescriptionListTerm>
                  <DescriptionListDescription>
                    {parsedConfig.version || '-'} (channel: stable-{parsedConfig.channel || '-'})
                  </DescriptionListDescription>
                </DescriptionListGroup>
                {parsedConfig.catalogs.length > 0 && (
                  <DescriptionListGroup>
                    <DescriptionListTerm>Catalogs</DescriptionListTerm>
                    <DescriptionListDescription>
                      <List>
                        {parsedConfig.catalogs.map((catalog: string, idx: number) => (
                          <ListItem key={idx}>{catalog}</ListItem>
                        ))}
                      </List>
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                )}
                {parsedConfig.operators.length > 0 && (
                  <DescriptionListGroup>
                    <DescriptionListTerm>Operators ({parsedConfig.operators.length})</DescriptionListTerm>
                    <DescriptionListDescription>
                      <List>
                        {parsedConfig.operators.slice(0, 10).map((op: string, idx: number) => (
                          <ListItem key={idx}>{op}</ListItem>
                        ))}
                        {parsedConfig.operators.length > 10 && (
                          <ListItem>... and {parsedConfig.operators.length - 10} more</ListItem>
                        )}
                      </List>
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                )}
                {parsedConfig.additionalImages.length > 0 && (
                  <DescriptionListGroup>
                    <DescriptionListTerm>Additional Images ({parsedConfig.additionalImages.length})</DescriptionListTerm>
                    <DescriptionListDescription>
                      <List>
                        {parsedConfig.additionalImages.slice(0, 5).map((img: string, idx: number) => (
                          <ListItem key={idx}>{img}</ListItem>
                        ))}
                        {parsedConfig.additionalImages.length > 5 && (
                          <ListItem>... and {parsedConfig.additionalImages.length - 5} more</ListItem>
                        )}
                      </List>
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                )}
              </DescriptionList>
            </CardBody>
          </Card>
        )}

        {/* ImageSetConfiguration YAML Card */}
        {pipeline.spec?.imageSetConfig && (
          <Card style={{ marginBottom: '1rem' }}>
            <CardTitle>ImageSetConfiguration YAML</CardTitle>
            <CardBody>
              <CodeBlock>
                <CodeBlockCode>{pipeline.spec.imageSetConfig}</CodeBlockCode>
              </CodeBlock>
            </CardBody>
          </Card>
        )}

        {/* Storage Configuration Card */}
        {pipeline.spec?.storage && (
          <Card style={{ marginBottom: '1rem' }}>
            <CardTitle>Storage Configuration</CardTitle>
            <CardBody>
              <DescriptionList isHorizontal>
                {pipeline.spec.storage.output?.pvc && (
                  <DescriptionListGroup>
                    <DescriptionListTerm>Output PVC</DescriptionListTerm>
                    <DescriptionListDescription>
                      {pipeline.spec.storage.output.pvc}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                )}
                {pipeline.spec.storageSize && (
                  <DescriptionListGroup>
                    <DescriptionListTerm>Storage Size</DescriptionListTerm>
                    <DescriptionListDescription>
                      {pipeline.spec.storageSize}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                )}
              </DescriptionList>
            </CardBody>
          </Card>
        )}
      </PageSection>
    </>
  );
};
