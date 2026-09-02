import * as React from 'react';
import { Spinner, Alert } from '@patternfly/react-core';
import { CollectionPipelineList } from '../components/CollectionPipelineList';
import { useDeploymentConfig } from '../utils/use-deployment-config';

declare const __COMMIT_SHA__: string;

const MirrorImportList = React.lazy(() =>
  import('../components/MirrorImportList').then(m => ({ default: m.MirrorImportList }))
);

class PluginErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <Alert variant="danger" title="Plugin Error" isInline>
          <p>{this.state.error.message}</p>
          <pre style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>{this.state.error.stack}</pre>
        </Alert>
      );
    }
    return this.props.children;
  }
}

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
    return (
      <PluginErrorBoundary>
        <React.Suspense fallback={<Spinner size="xl" />}>
          <MirrorImportList />
        </React.Suspense>
      </PluginErrorBoundary>
    );
  }

  return <CollectionPipelineList />;
};

export default AirgapArchitectPage;
