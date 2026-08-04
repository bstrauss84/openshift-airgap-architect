import * as React from 'react';
import {
  Content,
  FormGroup,
  TextInput,
  Switch,
} from '@patternfly/react-core';
import { useApp } from '../AppProvider';
import { useDeploymentConfig } from '../utils/use-deployment-config';

export const ImportConfigStep: React.FC = () => {
  const { state, updateState } = useApp();
  const { config } = useDeploymentConfig();

  const [targetUrl, setTargetUrl] = React.useState<string>(
    state.importConfig?.targetRegistryUrl || config?.targetRegistryDefaults?.url || ''
  );
  const [catalogSource, setCatalogSource] = React.useState<boolean>(
    state.importConfig?.catalogSource !== false
  );
  const [icsp, setIcsp] = React.useState<boolean>(
    state.importConfig?.imageContentSourcePolicy !== false
  );

  React.useEffect(() => {
    updateState({
      importConfig: {
        targetRegistryUrl: targetUrl,
        catalogSource,
        imageContentSourcePolicy: icsp,
      },
    });
  }, [targetUrl, catalogSource, icsp]);

  return (
    <div>
      <Content>
        <Content component="h2">Configuration</Content>
        <Content component="p">
          Configure the target mirror registry and publish options for this import.
        </Content>
      </Content>

      <div style={{ marginTop: '2rem', maxWidth: '500px' }}>
        <FormGroup
          label="Target Registry URL"
          fieldId="target-registry"
          isRequired
          helperText="The mirror registry where images will be pushed (e.g. mirror.example.com:8443)"
        >
          <TextInput
            id="target-registry"
            value={targetUrl}
            onChange={(_event, value) => setTargetUrl(value)}
            placeholder="mirror.example.com:8443"
          />
        </FormGroup>

        <Content component="h3" style={{ marginTop: '2rem' }}>Publish Options</Content>
        <Content component="p">
          Choose which cluster resources to create or update after importing images.
        </Content>

        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <Switch
            id="catalog-source"
            label="Create/update CatalogSource"
            labelOff="Do not create CatalogSource"
            isChecked={catalogSource}
            onChange={(_event, checked) => setCatalogSource(checked)}
          />
          <Switch
            id="icsp"
            label="Create/update ImageContentSourcePolicy (IDMS/ITMS)"
            labelOff="Do not create ImageContentSourcePolicy"
            isChecked={icsp}
            onChange={(_event, checked) => setIcsp(checked)}
          />
        </div>
      </div>
    </div>
  );
};
