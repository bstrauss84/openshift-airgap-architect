import * as React from 'react';
import { Spinner } from '@patternfly/react-core';
import { CollectionPipelineList } from '../components/CollectionPipelineList';
import { MirrorImportList } from '../components/MirrorImportList';
import { useDeploymentConfig } from '../utils/use-deployment-config';

const AirgapArchitectPage: React.FC = () => {
  const { config, loading } = useDeploymentConfig();

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem' }}>
        <Spinner size="xl" />
      </div>
    );
  }

  if (config?.deploymentSide === 'disconnected') {
    return <MirrorImportList />;
  }

  return <CollectionPipelineList />;
};

export default AirgapArchitectPage;
