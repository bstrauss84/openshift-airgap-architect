/**
 * Release Selection Step (Console Plugin Version)
 *
 * Simplified OpenShift version selector for connected mode.
 * Fetches channels and patch versions from Cincinnati API.
 *
 * Adapted from frontend/src/steps/ReleaseSelectionStep.jsx for React 17 + PF4.
 */
import * as React from 'react';
import {
  Form,
  FormGroup,
  Select,
  SelectOption,
  SelectVariant,
  Spinner,
  Text,
  TextContent,
  TextVariants
} from '@patternfly/react-core';
import { useApp } from '../AppProvider';
import { apiFetch } from '../api';

export const ReleaseSelectionStep: React.FC = () => {
  const { state, updateState } = useApp();
  const release = state.release || {};
  const version = state.version || {};

  const [channels, setChannels] = React.useState<string[]>([]);
  const [patches, setPatches] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [patchesLoading, setPatchesLoading] = React.useState(false);

  const [channelOpen, setChannelOpen] = React.useState(false);
  const [patchOpen, setPatchOpen] = React.useState(false);

  const [selectedChannel, setSelectedChannel] = React.useState(
    version.selectedChannel || (release.channel ? `stable-${release.channel}` : '')
  );
  const [selectedVersion, setSelectedVersion] = React.useState(
    version.selectedVersion || release.patchVersion || ''
  );

  // Fetch available channels on mount
  React.useEffect(() => {
    setLoading(true);
    apiFetch('/api/cincinnati/channels')
      .then((data: any) => {
        const channelList = data.channels || [];
        // Sort channels by semver descending
        const sorted = channelList.sort((a: string, b: string) => {
          const aNum = parseFloat(a.replace('stable-', ''));
          const bNum = parseFloat(b.replace('stable-', ''));
          return bNum - aNum;
        });
        setChannels(sorted);

        // Auto-select first channel if none selected
        if (!selectedChannel && sorted.length > 0) {
          setSelectedChannel(sorted[0]);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch channels:', err);
      })
      .finally(() => setLoading(false));
  }, []);

  // Fetch patches when channel changes
  React.useEffect(() => {
    if (!selectedChannel) return;

    setPatchesLoading(true);
    apiFetch(`/api/cincinnati/graph?channel=${selectedChannel}`)
      .then((data: any) => {
        const versions = data.versions || [];
        setPatches(versions);

        // Auto-select first patch if none selected
        if (!selectedVersion && versions.length > 0) {
          setSelectedVersion(versions[0]);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch patches:', err);
      })
      .finally(() => setPatchesLoading(false));
  }, [selectedChannel]);

  // Update state when selections change
  React.useEffect(() => {
    if (selectedChannel && selectedVersion) {
      const channelNumber = selectedChannel.replace('stable-', '');
      updateState({
        release: {
          ...release,
          channel: channelNumber,
          patchVersion: selectedVersion
        },
        version: {
          selectedChannel,
          selectedVersion
        }
      });
    }
  }, [selectedChannel, selectedVersion]);

  const handleChannelSelect = (_event: any, selection: string) => {
    setSelectedChannel(selection);
    setSelectedVersion(''); // Reset patch when channel changes
    setChannelOpen(false);
  };

  const handlePatchSelect = (_event: any, selection: string) => {
    setSelectedVersion(selection);
    setPatchOpen(false);
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <Spinner size="lg" />
        <p>Loading OpenShift channels...</p>
      </div>
    );
  }

  return (
    <div>
      <TextContent>
        <Text component={TextVariants.h2}>Select OpenShift Release</Text>
        <Text component={TextVariants.p}>
          Choose the OpenShift version you want to mirror to your disconnected environment.
        </Text>
      </TextContent>

      <Form>
        <FormGroup
          label="Release Channel"
          isRequired
          fieldId="channel-select"
          helperText="Major.minor release channel (e.g., stable-4.16)"
        >
          <Select
            variant={SelectVariant.single}
            onToggle={() => setChannelOpen(!channelOpen)}
            onSelect={handleChannelSelect}
            selections={selectedChannel}
            isOpen={channelOpen}
            placeholderText="Select a channel"
          >
            {channels.map((channel) => (
              <SelectOption key={channel} value={channel}>
                {channel}
              </SelectOption>
            ))}
          </Select>
        </FormGroup>

        <FormGroup
          label="Patch Version"
          isRequired
          fieldId="patch-select"
          helperText="Specific patch release to mirror"
        >
          <Select
            variant={SelectVariant.single}
            onToggle={() => setPatchOpen(!patchOpen)}
            onSelect={handlePatchSelect}
            selections={selectedVersion}
            isOpen={patchOpen}
            isDisabled={!selectedChannel || patchesLoading}
            placeholderText={
              patchesLoading
                ? 'Loading versions...'
                : selectedChannel
                ? 'Select a version'
                : 'Select a channel first'
            }
          >
            {patches.map((patch) => (
              <SelectOption key={patch} value={patch}>
                {patch}
              </SelectOption>
            ))}
          </Select>
        </FormGroup>
      </Form>

      {selectedChannel && selectedVersion && (
        <TextContent style={{ marginTop: '20px' }}>
          <Text component={TextVariants.p}>
            <strong>Selected:</strong> OpenShift {selectedVersion} from {selectedChannel} channel
          </Text>
        </TextContent>
      )}
    </div>
  );
};
