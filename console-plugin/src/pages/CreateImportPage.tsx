import * as React from 'react';
import {
  PageSection,
  Title,
  Content,
  Breadcrumb,
  BreadcrumbItem,
  Button,
} from '@patternfly/react-core';
import { useHistory } from 'react-router-dom';
import { AppProvider, useApp } from '../AppProvider';
import { BundleSourceStep } from '../components/BundleSourceStep';
import { ImportStorageStep } from '../components/ImportStorageStep';
import { ImportConfigStep } from '../components/ImportConfigStep';
import { ImportReviewStep } from '../components/ImportReviewStep';

const CreateImportWizard: React.FC = () => {
  const { state } = useApp();
  const history = useHistory();
  const [currentStep, setCurrentStep] = React.useState(0);

  const steps = [
    {
      name: 'Bundle Source',
      component: <BundleSourceStep />,
      canJumpTo: true,
    },
    {
      name: 'Storage',
      component: <ImportStorageStep />,
      canJumpTo: currentStep >= 1,
    },
    {
      name: 'Configuration',
      component: <ImportConfigStep />,
      canJumpTo: currentStep >= 2,
    },
    {
      name: 'Review & Import',
      component: <ImportReviewStep />,
      canJumpTo: currentStep >= 3,
    },
  ];

  const canProceed = (): boolean => {
    if (currentStep === 0) {
      const source = state.importSource || {};
      if (source.sourceMode === 'upload') return !!source.uploadFile;
      if (source.sourceMode === 'pvc') return !!source.filename;
      return false;
    }
    if (currentStep === 1) {
      const storage = state.importStorage || {};
      return !!storage.pvcName;
    }
    if (currentStep === 2) {
      const config = state.importConfig || {};
      return !!config.targetRegistryUrl;
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
          <BreadcrumbItem isActive>Import Bundle</BreadcrumbItem>
        </Breadcrumb>
        <Title headingLevel="h1" size="2xl">
          Import Bundle
        </Title>
        <Content component="p">
          Upload or select a collection bundle and import it into the disconnected mirror registry.
        </Content>
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
                    fontWeight: currentStep === index ? 600 : 400,
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
              <Button variant="secondary" onClick={() => setCurrentStep(currentStep - 1)}>
                Back
              </Button>
            )}
            {currentStep < steps.length - 1 && (
              <Button variant="primary" onClick={() => setCurrentStep(currentStep + 1)} isDisabled={!canProceed()}>
                Next
              </Button>
            )}
          </div>
        </div>
      </PageSection>
    </div>
  );
};

const CreateImportPage: React.FC = () => {
  return (
    <AppProvider>
      <CreateImportWizard />
    </AppProvider>
  );
};

export default CreateImportPage;
