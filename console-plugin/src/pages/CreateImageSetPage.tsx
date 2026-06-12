import * as React from 'react';
import {
  PageSection,
  Title,
  Content,
  Breadcrumb,
  BreadcrumbItem
} from '@patternfly/react-core';
import { useHistory } from 'react-router-dom';
import { AppProvider } from '../AppProvider';
import { ReleaseSelectionStep } from '../components/ReleaseSelectionStep';

const CreateImageSetPage: React.FC = () => {
  const history = useHistory();

  return (
    <AppProvider>
      <PageSection variant="light">
        <Breadcrumb>
          <BreadcrumbItem to="#" onClick={() => history.push('/airgap-architect')}>
            Airgap Architect
          </BreadcrumbItem>
          <BreadcrumbItem isActive>Create ImageSet Configuration</BreadcrumbItem>
        </Breadcrumb>
        <Title headingLevel="h1" size="2xl">
          Create ImageSet Configuration
        </Title>
        <Content component="p">
          Configure and generate ImageSetConfiguration YAML for oc-mirror.
        </Content>
      </PageSection>
      <PageSection>
        <ReleaseSelectionStep />
      </PageSection>
    </AppProvider>
  );
};

export default CreateImageSetPage;
