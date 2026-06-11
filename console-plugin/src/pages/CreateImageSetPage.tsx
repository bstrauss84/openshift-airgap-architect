import * as React from 'react';
import {
  PageSection,
  Title,
  TextContent,
  Text,
  TextVariants,
  Breadcrumb,
  BreadcrumbItem
} from '@patternfly/react-core';
import { useNavigate } from 'react-router-dom';
import { AppProvider } from '../AppProvider';
import { ReleaseSelectionStep } from '../components/ReleaseSelectionStep';

const CreateImageSetPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <AppProvider>
      <PageSection variant="light">
        <Breadcrumb>
          <BreadcrumbItem to="#" onClick={() => navigate('/airgap-architect')}>
            Airgap Architect
          </BreadcrumbItem>
          <BreadcrumbItem isActive>Create ImageSet Configuration</BreadcrumbItem>
        </Breadcrumb>
        <Title headingLevel="h1" size="2xl">
          Create ImageSet Configuration
        </Title>
        <TextContent>
          <Text component={TextVariants.p}>
            Configure and generate ImageSetConfiguration YAML for oc-mirror.
          </Text>
        </TextContent>
      </PageSection>
      <PageSection>
        <ReleaseSelectionStep />
      </PageSection>
    </AppProvider>
  );
};

export default CreateImageSetPage;
