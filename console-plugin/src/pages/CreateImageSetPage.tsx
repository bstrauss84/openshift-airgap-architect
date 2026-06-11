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

const CreateImageSetPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <>
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
        <TextContent>
          <Text component={TextVariants.h2}>Connected Flow Wizard</Text>
          <Text component={TextVariants.p}>
            The wizard will be integrated here in Phase 2. It will include:
          </Text>
          <ul>
            <li>Release Selection - Choose OpenShift versions to mirror</li>
            <li>Operator Selection - Select operators from catalogs</li>
            <li>ImageSet Configuration - Review and generate YAML</li>
          </ul>
        </TextContent>
      </PageSection>
    </>
  );
};

export default CreateImageSetPage;
