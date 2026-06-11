/**
 * ImageSet Configuration Wizard
 *
 * Multi-step wizard for creating ImageSetConfiguration YAML.
 * Wraps the three connected-flow steps from frontend in a PatternFly Wizard.
 */
import * as React from 'react';
import {
  Wizard,
  WizardStep,
  WizardHeader,
  WizardFooter,
  Button
} from '@patternfly/react-core';
import { useNavigate } from 'react-router-dom';

// Import the actual step components from frontend
// These will be symlinked or copied during build
// @ts-ignore - JSX components from frontend
import ReleaseSelectionStep from '../../../frontend/src/steps/ReleaseSelectionStep.jsx';
// @ts-ignore
import OperatorsStep from '../../../frontend/src/steps/OperatorsStep.jsx';
// @ts-ignore
import ImageSetConfigStep from '../../../frontend/src/steps/ImageSetConfigStep.jsx';

interface ImageSetWizardProps {
  onClose?: () => void;
}

export const ImageSetWizard: React.FC<ImageSetWizardProps> = ({ onClose }) => {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = React.useState(0);

  const steps: WizardStep[] = [
    {
      name: 'Release Selection',
      component: <ReleaseSelectionStep />
    },
    {
      name: 'Operators',
      component: <OperatorsStep />
    },
    {
      name: 'ImageSet Configuration',
      component: <ImageSetConfigStep />
    }
  ];

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      navigate('/airgap-architect');
    }
  };

  const handleNext = () => {
    if (activeStep < steps.length - 1) {
      setActiveStep(activeStep + 1);
    }
  };

  const handleBack = () => {
    if (activeStep > 0) {
      setActiveStep(activeStep - 1);
    }
  };

  const handleFinish = () => {
    // On finish, show the YAML output (handled by ImageSetConfigStep)
    // For now, just close the wizard
    handleClose();
  };

  return (
    <Wizard
      height={600}
      title="Create ImageSet Configuration"
      description="Generate ImageSetConfiguration YAML for oc-mirror"
      steps={steps}
      startAtStep={activeStep + 1}
      onClose={handleClose}
      footer={
        <WizardFooter
          onNext={handleNext}
          onBack={handleBack}
          onClose={handleClose}
          isBackDisabled={activeStep === 0}
          isNextDisabled={activeStep === steps.length - 1}
        >
          {activeStep === steps.length - 1 && (
            <Button variant="primary" onClick={handleFinish}>
              Finish
            </Button>
          )}
        </WizardFooter>
      }
    />
  );
};
