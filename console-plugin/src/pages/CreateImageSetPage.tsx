import * as React from 'react';
import {
  PageSection,
  Title,
  Content,
  Breadcrumb,
  BreadcrumbItem,
  Button,
  Wizard,
  WizardStep
} from '@patternfly/react-core';
import { Alert } from '@patternfly/react-core/dist/dynamic/components/Alert';
import { useHistory } from 'react-router-dom';
import { AppProvider, useApp } from '../AppProvider';
import { ReleaseSelectionStep } from '../components/ReleaseSelectionStep';
import { OperatorsSelectionStepWithScan } from '../components/OperatorsSelectionStepWithScan';
import { AdditionalImagesStep } from '../components/AdditionalImagesStep';
import { CreateCollectionPipelineStep } from '../components/CreateCollectionPipelineStep';

const CreateImageSetWizard: React.FC = () => {
  const { state, updateState } = useApp();
  const history = useHistory();
  const [currentStep, setCurrentStep] = React.useState(0);

  const searchParams = new URLSearchParams(window.location.search);
  const parentPipelineName = searchParams.get('parentPipeline') || null;

  React.useEffect(() => {
    if (parentPipelineName) {
      updateState({ parentPipeline: parentPipelineName });
    }
  }, [parentPipelineName]);

  const steps = [
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
    const release = state.release || {};
    const operators = state.operators || {};

    if (currentStep === 0) {
      return release.channel && release.patchVersion;
    }
    // Step 2 (operators) is optional
    if (currentStep === 1) {
      return true;
    }
    return true;
  };

  return (
    <div>
      <PageSection variant="light">
        <Breadcrumb>
          <BreadcrumbItem to="#" onClick={() => history.push('/airgap-architect')}>
            Airgap Architect
          </BreadcrumbItem>
          <BreadcrumbItem isActive>
            {parentPipelineName ? 'Create Update Bundle' : 'Create Collection Pipeline'}
          </BreadcrumbItem>
        </Breadcrumb>
        <Title headingLevel="h1" size="2xl">
          {parentPipelineName ? 'Create Update Bundle' : 'Create Collection Pipeline'}
        </Title>
        <Content component="p">
          {parentPipelineName
            ? `Create a delta update bundle based on "${parentPipelineName}". Only new or changed images will be collected.`
            : 'Create a new mirroring collection pipeline for disconnected OpenShift.'}
        </Content>
        {parentPipelineName && (
          <Alert variant="info" title="Delta Collection" isInline style={{ marginTop: '1rem' }}>
            This pipeline will reuse the oc-mirror cache from the parent pipeline, collecting only
            updated content. The resulting bundle will be smaller and faster to produce.
          </Alert>
        )}
      </PageSection>

      <PageSection>
        {/* Simple step-by-step wizard */}
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
