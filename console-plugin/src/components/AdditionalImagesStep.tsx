/**
 * Additional Images Step (Console Plugin Version)
 *
 * Allows users to specify additional container images to mirror.
 */
import * as React from 'react';
import { Form, FormGroup, TextArea, Content, Switch } from '@patternfly/react-core';
import { useApp } from '../AppProvider';

const AUTOSHIFT_IMAGES = [
  'quay.io/autoshift/autoshift:latest',
  'quay.io/autoshift/bootstrap/openshift-gitops:latest',
  'quay.io/autoshift/bootstrap/advanced-cluster-management:latest',
  'quay.io/autoshift/policies/advanced-cluster-management:latest',
  'quay.io/autoshift/policies/advanced-cluster-security:latest',
  'quay.io/autoshift/policies/ansible-automation-platform:latest',
  'quay.io/autoshift/policies/cluster-observability:latest',
  'quay.io/autoshift/policies/dev-spaces:latest',
  'quay.io/autoshift/policies/developer-hub:latest',
  'quay.io/autoshift/policies/disconnected-mirror:latest',
  'quay.io/autoshift/policies/gitops-dev:latest',
  'quay.io/autoshift/policies/infra-nodes:latest',
  'quay.io/autoshift/policies/kiali:latest',
  'quay.io/autoshift/policies/local-storage:latest',
  'quay.io/autoshift/policies/logging:latest',
  'quay.io/autoshift/policies/loki:latest',
  'quay.io/autoshift/policies/lvm:latest',
  'quay.io/autoshift/policies/machine-health-checks:latest',
  'quay.io/autoshift/policies/manual-remediations:latest',
  'quay.io/autoshift/policies/master-nodes:latest',
  'quay.io/autoshift/policies/metallb:latest',
  'quay.io/autoshift/policies/mtv:latest',
  'quay.io/autoshift/policies/nmstate:latest',
  'quay.io/autoshift/policies/node-feature-discovery:latest',
  'quay.io/autoshift/policies/openshift-compliance-operator:latest',
  'quay.io/autoshift/policies/openshift-data-foundation:latest',
  'quay.io/autoshift/policies/openshift-dns:latest',
  'quay.io/autoshift/policies/openshift-gitops:latest',
  'quay.io/autoshift/policies/openshift-image-registry:latest',
  'quay.io/autoshift/policies/openshift-pipelines:latest',
  'quay.io/autoshift/policies/openshift-virtualization:latest',
  'quay.io/autoshift/policies/quay:latest',
  'quay.io/autoshift/policies/servicemesh3:latest',
  'quay.io/autoshift/policies/storage-nodes:latest',
  'quay.io/autoshift/policies/tempo:latest',
  'quay.io/autoshift/policies/trusted-artifact-signer:latest',
  'quay.io/autoshift/policies/worker-nodes:latest',
  'quay.io/autoshift/policies/cluster-labels:latest',
];

export const AdditionalImagesStep: React.FC = () => {
  const { state, updateState } = useApp();
  const additionalImages = state.additionalImages || {};

  const [imagesText, setImagesText] = React.useState<string>(
    additionalImages.images?.join('\n') || ''
  );
  const [includeAutoshift, setIncludeAutoshift] = React.useState<boolean>(
    additionalImages.includeAutoshift || false
  );

  const syncState = (text: string, autoshift: boolean) => {
    const userImages = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    const allImages = autoshift
      ? [...userImages, ...AUTOSHIFT_IMAGES.filter(img => !userImages.includes(img))]
      : userImages;

    updateState({
      additionalImages: {
        images: allImages,
        includeAutoshift: autoshift,
      },
      imagesetConfig: {
        ...state.imagesetConfig,
        additionalImages: allImages.join('\n'),
      },
    });
  };

  const handleImagesChange = (value: string) => {
    setImagesText(value);
    syncState(value, includeAutoshift);
  };

  const handleAutoshiftToggle = (_event: React.FormEvent, checked: boolean) => {
    setIncludeAutoshift(checked);
    syncState(imagesText, checked);
  };

  const userImageCount = imagesText.split('\n').filter(line => line.trim().length > 0).length;
  const totalImageCount = userImageCount + (includeAutoshift ? AUTOSHIFT_IMAGES.length : 0);

  return (
    <div>
      <Content>
        <Content component="h2">Additional Images (Optional)</Content>
        <Content component="p">
          Specify additional container images to include in the mirror.
          Enter one image reference per line.
        </Content>
      </Content>

      <Form>
        <FormGroup fieldId="include-autoshift">
          <Switch
            id="include-autoshift"
            label="Include AutoShift policy images"
            labelOff="AutoShift policy images not included"
            isChecked={includeAutoshift}
            onChange={handleAutoshiftToggle}
          />
          {includeAutoshift && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#6a6e73' }}>
              {AUTOSHIFT_IMAGES.length} images from quay.io/autoshift will be included
            </div>
          )}
        </FormGroup>

        <FormGroup
          label="Container Images"
          helperText="Format: registry.io/repository/image:tag (one per line)"
        >
          <TextArea
            id="additional-images"
            value={imagesText}
            onChange={(_event, value) => handleImagesChange(value)}
            placeholder={'quay.io/example/app:v1.0\nregistry.io/namespace/image:latest'}
            rows={10}
            style={{ fontFamily: 'monospace' }}
          />
        </FormGroup>
      </Form>

      {totalImageCount > 0 && (
        <div style={{ marginTop: '1rem', padding: '1rem', background: '#f0f0f0', borderRadius: '4px' }}>
          <p style={{ margin: 0 }}>
            <strong>Images to mirror:</strong> {totalImageCount}
            {includeAutoshift && userImageCount > 0 && (
              <span> ({userImageCount} custom + {AUTOSHIFT_IMAGES.length} AutoShift)</span>
            )}
          </p>
        </div>
      )}

      <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#e7f1fa', borderRadius: '4px', border: '1px solid #bee1f4' }}>
        <h4 style={{ marginTop: 0, fontSize: '0.9rem' }}>Common Additional Images:</h4>
        <ul style={{ marginBottom: 0, fontSize: '0.85rem', color: '#333' }}>
          <li>Application images not in operator catalogs</li>
          <li>Custom monitoring or logging tools</li>
          <li>Sidecar containers (service mesh, security scanners)</li>
          <li>Init containers or job images</li>
        </ul>
      </div>
    </div>
  );
};
