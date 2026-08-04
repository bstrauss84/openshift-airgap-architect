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
import { useHistory, useLocation } from 'react-router-dom';
import { MirrorImport } from '../types';

export const MirrorImportDetail: React.FC = () => {
  const history = useHistory();
  const location = useLocation();
  const [mirrorImport, setMirrorImport] = React.useState<MirrorImport | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const importName = location.pathname.match(/\/airgap-architect\/imports\/([^/]+)/)?.[1] || '';

  const fetchImport = async () => {
    if (!importName) return;

    try {
      const response = await fetch(
        `/api/kubernetes/apis/mirror.mirror.mathianasj.github.com/v1/namespaces/mirror-operator-system/mirrorimports/${importName}`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch import: ${response.status}`);
      }

      const data = await response.json();
      setMirrorImport(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load mirror import');
    } finally {
      setLoading(false);
    }
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
                {mirrorImport.status?.message && (
                  <DescriptionListGroup>
                    <DescriptionListTerm>Message</DescriptionListTerm>
                    <DescriptionListDescription>{mirrorImport.status.message}</DescriptionListDescription>
                  </DescriptionListGroup>
                )}
                <DescriptionListGroup>
                  <DescriptionListTerm>Created</DescriptionListTerm>
                  <DescriptionListDescription>
                    {formatTimestamp(mirrorImport.metadata.creationTimestamp)}
                  </DescriptionListDescription>
                </DescriptionListGroup>
                {mirrorImport.status?.startTime && (
                  <DescriptionListGroup>
                    <DescriptionListTerm>Started</DescriptionListTerm>
                    <DescriptionListDescription>
                      {formatTimestamp(mirrorImport.status.startTime)}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                )}
                {mirrorImport.status?.completionTime && (
                  <DescriptionListGroup>
                    <DescriptionListTerm>Completed</DescriptionListTerm>
                    <DescriptionListDescription>
                      {formatTimestamp(mirrorImport.status.completionTime)}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                )}
                {mirrorImport.status?.jobRef && (
                  <DescriptionListGroup>
                    <DescriptionListTerm>Job</DescriptionListTerm>
                    <DescriptionListDescription>{mirrorImport.status.jobRef}</DescriptionListDescription>
                  </DescriptionListGroup>
                )}
              </DescriptionList>
            </CardBody>
          </Card>

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
