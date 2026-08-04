import * as React from 'react';
import { Spinner } from '@patternfly/react-core';
import { CollectionPipelineList } from '../components/CollectionPipelineList';
import { MirrorImportList } from '../components/MirrorImportList';
import { useDeploymentConfig } from '../utils/use-deployment-config';

declare const __COMMIT_SHA__: string;

const AirgapArchitectPage: React.FC = () => {
  const { config, loading, error } = useDeploymentConfig();

  React.useEffect(() => {
    console.log(`[airgap-architect-plugin] commit: ${__COMMIT_SHA__}, config:`, config, error ? `error: ${error}` : '');
  }, [config, error]);

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
