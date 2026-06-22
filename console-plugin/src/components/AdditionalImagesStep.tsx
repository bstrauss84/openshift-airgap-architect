/**
 * Additional Images Step (Console Plugin Version)
 *
 * Allows users to specify additional container images to mirror.
 */
import * as React from 'react';
import { Form } from '@patternfly/react-core/dist/dynamic/components/Form';
import { FormGroup } from '@patternfly/react-core/dist/dynamic/components/Form';
import { TextArea } from '@patternfly/react-core/dist/dynamic/components/TextArea';
import { Content } from '@patternfly/react-core/dist/dynamic/components/Content';
import { useApp } from '../AppProvider';

export const AdditionalImagesStep: React.FC = () => {
  const { state, updateState } = useApp();
  const additionalImages = state.additionalImages || {};

  const [imagesText, setImagesText] = React.useState<string>(
    additionalImages.images?.join('\n') || ''
  );

  const handleImagesChange = (value: string) => {
    setImagesText(value);

    // Parse images (one per line, skip empty lines)
    const images = value
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    updateState({
      additionalImages: {
        images
      }
    });
  };

  const imageCount = imagesText.split('\n').filter(line => line.trim().length > 0).length;

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

      {imageCount > 0 && (
        <div style={{ marginTop: '1rem', padding: '1rem', background: '#f0f0f0', borderRadius: '4px' }}>
          <p style={{ margin: 0 }}>
            <strong>Images to mirror:</strong> {imageCount}
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
