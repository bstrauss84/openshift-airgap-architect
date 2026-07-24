import * as React from 'react';
import {
  PageSection,
  Title,
  Content,
  Breadcrumb,
  BreadcrumbItem,
  Button,
  Alert,
  Spinner
} from '@patternfly/react-core';
import { useHistory } from 'react-router-dom';
import { AppProvider, useApp } from '../AppProvider';
import { ReleaseSelectionStep } from '../components/ReleaseSelectionStep';
import { OperatorsSelectionStepWithScan } from '../components/OperatorsSelectionStepWithScan';
import { AdditionalImagesStep } from '../components/AdditionalImagesStep';
import { CreateCollectionPipelineStep } from '../components/CreateCollectionPipelineStep';
import { UpdateReleaseChannelsStep } from '../components/UpdateReleaseChannelsStep';
import { UpdateOperatorsStep } from '../components/UpdateOperatorsStep';
import { useParentPipeline } from '../utils/use-parent-pipeline';

const CreateImageSetWizard: React.FC = () => {
  const { state, updateState } = useApp();
  const history = useHistory();
  const [currentStep, setCurrentStep] = React.useState(0);

  const searchParams = new URLSearchParams(window.location.search);
  const parentPipelineName = searchParams.get('parentPipeline') || null;
  const isUpdateMode = Boolean(parentPipelineName);

  const { parentConfig, loading: parentLoading, error: parentError } = useParentPipeline(parentPipelineName);

  React.useEffect(() => {
    if (parentPipelineName) {
      updateState({ parentPipeline: parentPipelineName });
    }
  }, [parentPipelineName]);

  // Seed update state from parent config once loaded
  const [seeded, setSeeded] = React.useState(false);
  React.useEffect(() => {
    if (parentConfig && !seeded) {
      updateState({
        parentConfig,
        updateChannels: parentConfig.platformChannels,
        updateOperators: parentConfig.operators,
        updateAdditionalImages: parentConfig.additionalImages,
        additionalImages: { images: parentConfig.additionalImages },
      });

      // Derive release state from highest version for operator scanning compat
      if (parentConfig.platformChannels.length > 0) {
        const sorted = [...parentConfig.platformChannels].sort((a, b) => {
          const aParts = a.maxVersion.split('.').map(Number);
          const bParts = b.maxVersion.split('.').map(Number);
          for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
            if ((bParts[i] || 0) !== (aParts[i] || 0)) return (bParts[i] || 0) - (aParts[i] || 0);
          }
          return 0;
        });
        const highest = sorted[0];
        const channelNumber = highest.name.replace('stable-', '');
        updateState({
          release: { channel: channelNumber, patchVersion: highest.maxVersion },
          version: { selectedChannel: highest.name, selectedVersion: highest.maxVersion },
        });
      }

      // Derive operators.selected for backend compat
      const selected: Array<{ name: string; defaultChannel?: string; catalogImage: string }> = [];
      for (const cat of parentConfig.operators) {
        for (const pkg of cat.packages) {
          const defaultChannel = pkg.channels?.[0]?.name;
          selected.push({
            name: pkg.name,
            ...(defaultChannel ? { defaultChannel } : {}),
            catalogImage: cat.catalog,
          });
        }
      }
      updateState({ operators: { selected, selectionMode: 'packages' } });

      setSeeded(true);
    }
  }, [parentConfig, seeded]);

  const baseSteps = [
    {
      name: 'Release Selection',
      component: <ReleaseSelectionStep />,
      canJumpTo: true
    },
    {
      name: 'Operators',
      component: <OperatorsSelectionStepWithScan />,
      canJumpTo: currentStep >= 1
    },
    {
      name: 'Additional Images',
      component: <AdditionalImagesStep />,
      canJumpTo: currentStep >= 2
    },
    {
      name: 'Create Pipeline',
      component: <CreateCollectionPipelineStep />,
      canJumpTo: currentStep >= 3
    }
  ];

  const updateSteps = [
    {
      name: 'Release Channels',
      component: <UpdateReleaseChannelsStep />,
      canJumpTo: true
    },
    {
      name: 'Operators',
      component: <UpdateOperatorsStep />,
      canJumpTo: currentStep >= 1
    },
    {
      name: 'Additional Images',
      component: <AdditionalImagesStep />,
      canJumpTo: currentStep >= 2
    },
    {
      name: 'Create Pipeline',
      component: <CreateCollectionPipelineStep />,
      canJumpTo: currentStep >= 3
    }
  ];

  const steps = isUpdateMode ? updateSteps : baseSteps;

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const canProceed = () => {
    if (currentStep === 0) {
      if (isUpdateMode) {
        return (state.updateChannels || []).length > 0;
      }
      const release = state.release || {};
      return release.channel && release.patchVersion;
    }
    return true;
  };

  if (isUpdateMode && parentLoading) {
    return (
      <div>
        <PageSection variant="light">
          <Breadcrumb>
            <BreadcrumbItem to="#" onClick={() => history.push('/airgap-architect')}>
              Airgap Architect
            </BreadcrumbItem>
            <BreadcrumbItem isActive>Create Update Bundle</BreadcrumbItem>
          </Breadcrumb>
          <Title headingLevel="h1" size="2xl">Create Update Bundle</Title>
        </PageSection>
        <PageSection>
          <div style={{ textAlign: 'center', padding: '4rem' }}>
            <Spinner size="xl" />
            <p style={{ marginTop: '1rem' }}>Loading parent pipeline configuration...</p>
          </div>
        </PageSection>
      </div>
    );
  }

  return (
    <div>
      <PageSection variant="light">
        <Breadcrumb>
          <BreadcrumbItem to="#" onClick={() => history.push('/airgap-architect')}>
            Airgap Architect
          </BreadcrumbItem>
          <BreadcrumbItem isActive>
            {isUpdateMode ? 'Create Update Bundle' : 'Create Collection Pipeline'}
          </BreadcrumbItem>
        </Breadcrumb>
        <Title headingLevel="h1" size="2xl">
          {isUpdateMode ? 'Create Update Bundle' : 'Create Collection Pipeline'}
        </Title>
        <Content component="p">
          {isUpdateMode
            ? `Create a delta update bundle based on "${parentPipelineName}". Only new or changed images will be collected.`
            : 'Create a new mirroring collection pipeline for disconnected OpenShift.'}
        </Content>
        {isUpdateMode && (
          <Alert variant="info" title="Delta Collection" isInline style={{ marginTop: '1rem' }}>
            This pipeline will reuse the oc-mirror cache from the parent pipeline, collecting only
            updated content. The resulting bundle will be smaller and faster to produce.
          </Alert>
        )}
        {isUpdateMode && parentError && (
          <Alert variant="warning" title="Could not load parent configuration" isInline style={{ marginTop: '1rem' }}>
            {parentError}. You can still configure the update bundle manually.
          </Alert>
        )}
      </PageSection>

      <PageSection>
        <div>
          <div style={{ marginBottom: '2rem', borderBottom: '1px solid #d2d2d2' }}>
            <div style={{ display: 'flex', gap: '2rem' }}>
              {steps.map((step, index) => (
                <div
                  key={index}
                  style={{
                    paddingBottom: '1rem',
                    borderBottom: currentStep === index ? '3px solid #0066cc' : '3px solid transparent',
                    cursor: step.canJumpTo ? 'pointer' : 'default',
                    color: currentStep === index ? '#0066cc' : index < currentStep ? '#151515' : '#6a6e73',
                    fontWeight: currentStep === index ? 600 : 400
                  }}
                  onClick={() => step.canJumpTo && setCurrentStep(index)}
                >
                  {index + 1}. {step.name}
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: '2rem', marginBottom: '2rem' }}>
            {steps[currentStep].component}
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
            {currentStep > 0 && (
              <Button variant="secondary" onClick={handleBack}>
                Back
              </Button>
            )}
            {currentStep < steps.length - 1 && (
              <Button variant="primary" onClick={handleNext} isDisabled={!canProceed()}>
                Next
              </Button>
            )}
          </div>
        </div>
      </PageSection>
    </div>
  );
};

const CreateImageSetPage: React.FC = () => {
  return (
    <AppProvider>
      <CreateImageSetWizard />
    </AppProvider>
  );
};

export default CreateImageSetPage;
