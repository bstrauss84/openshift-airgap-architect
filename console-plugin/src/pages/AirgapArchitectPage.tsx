import * as React from 'react';
import {
  PageSection,
  Title,
  Button,
  Card,
  CardBody,
  CardTitle,
  Gallery,
  GalleryItem,
  Text,
  TextContent,
  TextVariants
} from '@patternfly/react-core';
import { useHistory } from 'react-router-dom';
import { PlusCircleIcon } from '@patternfly/react-icons';

const AirgapArchitectPage: React.FC = () => {
  const history = useHistory();

  const handleCreateImageSet = () => {
    history.push('/airgap-architect/imagesets/create');
  };

  return (
    <>
      <PageSection variant="light">
        <Title headingLevel="h1" size="2xl">
          Airgap Architect
        </Title>
        <TextContent>
          <Text component={TextVariants.p}>
            Create and manage ImageSetConfiguration resources for disconnected OpenShift environments.
          </Text>
        </TextContent>
      </PageSection>
      <PageSection>
        <Gallery hasGutter minWidths={{ default: '100%', md: '300px' }}>
          <GalleryItem>
            <Card isClickable onClick={handleCreateImageSet}>
              <CardTitle>
                <PlusCircleIcon /> Create ImageSet Configuration
              </CardTitle>
              <CardBody>
                Generate ImageSetConfiguration YAML for mirroring OpenShift releases and operators
                to disconnected registries using oc-mirror.
              </CardBody>
            </Card>
          </GalleryItem>
          <GalleryItem>
            <Card>
              <CardTitle>Manage ImageSets</CardTitle>
              <CardBody>
                View and manage existing ImageSetConfiguration resources in your cluster.
                (Coming soon)
              </CardBody>
            </Card>
          </GalleryItem>
        </Gallery>
      </PageSection>
    </>
  );
};

export default AirgapArchitectPage;
