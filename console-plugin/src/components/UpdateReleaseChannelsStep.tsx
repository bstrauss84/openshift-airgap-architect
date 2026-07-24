import * as React from 'react';
import {
  Alert,
  Button,
  Content,
  Form,
  FormGroup,
  Select,
  SelectOption,
  SelectList,
  MenuToggle,
  MenuToggleElement,
  Spinner,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { TrashIcon, PlusCircleIcon } from '@patternfly/react-icons';
import { useApp } from '../AppProvider';
import { apiFetch } from '../api';
import { PlatformChannel } from '../utils/imageset-config-types';

export const UpdateReleaseChannelsStep: React.FC = () => {
  const { state, updateState } = useApp();
  const updateChannels: PlatformChannel[] = state.updateChannels || [];

  const [channels, setChannels] = React.useState<string[]>([]);
  const [patches, setPatches] = React.useState<string[]>([]);
  const [loadingChannels, setLoadingChannels] = React.useState(false);
  const [loadingPatches, setLoadingPatches] = React.useState(false);

  const [channelOpen, setChannelOpen] = React.useState(false);
  const [patchOpen, setPatchOpen] = React.useState(false);
  const [selectedChannel, setSelectedChannel] = React.useState('');
  const [selectedVersion, setSelectedVersion] = React.useState('');
  const [duplicateError, setDuplicateError] = React.useState('');

  React.useEffect(() => {
    setLoadingChannels(true);
    apiFetch('/api/cincinnati/channels')
      .then((data: any) => {
        const channelList = data.channels || [];
        const sorted = channelList.sort((a: string, b: string) => {
          const aNum = parseFloat(a.replace('stable-', ''));
          const bNum = parseFloat(b.replace('stable-', ''));
          return bNum - aNum;
        });
        setChannels(sorted);
      })
      .catch((err) => console.error('Failed to fetch channels:', err))
      .finally(() => setLoadingChannels(false));
  }, []);

  React.useEffect(() => {
    if (!selectedChannel) {
      setPatches([]);
      return;
    }
    setLoadingPatches(true);
    apiFetch(`/api/cincinnati/patches?channel=${selectedChannel}`)
      .then((data: any) => setPatches(data.versions || []))
      .catch((err) => console.error('Failed to fetch patches:', err))
      .finally(() => setLoadingPatches(false));
  }, [selectedChannel]);

  const deriveReleaseState = (channelList: PlatformChannel[]) => {
    if (channelList.length === 0) return;
    const sorted = [...channelList].sort((a, b) => {
      const aParts = a.maxVersion.split('.').map(Number);
      const bParts = b.maxVersion.split('.').map(Number);
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        if ((bParts[i] || 0) !== (aParts[i] || 0)) return (bParts[i] || 0) - (aParts[i] || 0);
      }
      return 0;
    });
    const highest = sorted[0];
    const channelNumber = highest.name.replace('stable-', '');
    updateState({
      release: { channel: channelNumber, patchVersion: highest.maxVersion },
      version: { selectedChannel: highest.name, selectedVersion: highest.maxVersion },
    });
  };

  const handleRemoveChannel = (index: number) => {
    const updated = updateChannels.filter((_, i) => i !== index);
    updateState({ updateChannels: updated });
    deriveReleaseState(updated);
  };

  const handleAddChannel = () => {
    if (!selectedChannel || !selectedVersion) return;

    const channelName = selectedChannel.startsWith('stable-') ? selectedChannel : `stable-${selectedChannel}`;
    const exists = updateChannels.some(
      (ch) => ch.name === channelName && ch.minVersion === selectedVersion
    );
    if (exists) {
      setDuplicateError(`${channelName} @ ${selectedVersion} is already in the list.`);
      return;
    }

    setDuplicateError('');
    const newChannel: PlatformChannel = {
      name: channelName,
      minVersion: selectedVersion,
      maxVersion: selectedVersion,
    };
    const updated = [...updateChannels, newChannel];
    updateState({ updateChannels: updated });
    deriveReleaseState(updated);
    setSelectedChannel('');
    setSelectedVersion('');
  };

  const handleChannelSelect = (_event: any, selection: string) => {
    setSelectedChannel(selection);
    setSelectedVersion('');
    setChannelOpen(false);
    setDuplicateError('');
  };

  const handlePatchSelect = (_event: any, selection: string) => {
    setSelectedVersion(selection);
    setPatchOpen(false);
    setDuplicateError('');
  };

  return (
    <div>
      <Content>
        <Content component="h2">Manage Platform Channels</Content>
        <Content component="p">
          Review the platform channels from the parent pipeline. Remove versions to deprecate them
          on the high-side, or add new versions to include in the update bundle.
        </Content>
      </Content>

      {updateChannels.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <Content component="h3">Current Platform Channels</Content>
          <Alert
            variant="info"
            title="Removing a channel entry"
            isInline
            isPlain
            style={{ marginBottom: '0.5rem' }}
          >
            Removed versions will be excluded from the update bundle, signaling the high-side
            to deprecate and clean up those mirrored releases.
          </Alert>
          <Table aria-label="Platform channels" variant="compact">
            <Thead>
              <Tr>
                <Th>Channel</Th>
                <Th>Min Version</Th>
                <Th>Max Version</Th>
                <Th width={10}>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {updateChannels.map((ch, index) => (
                <Tr key={`${ch.name}-${ch.minVersion}-${index}`}>
                  <Td>{ch.name}</Td>
                  <Td>{ch.minVersion}</Td>
                  <Td>{ch.maxVersion}</Td>
                  <Td>
                    <Button
                      variant="plain"
                      aria-label={`Remove ${ch.name} ${ch.minVersion}`}
                      onClick={() => handleRemoveChannel(index)}
                    >
                      <TrashIcon />
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}

      {updateChannels.length === 0 && (
        <Alert
          variant="warning"
          title="No platform channels"
          isInline
          style={{ marginTop: '1rem' }}
        >
          At least one platform channel is required. Add a new version below.
        </Alert>
      )}

      <div style={{ marginTop: '2rem' }}>
        <Content component="h3">Add New Channel Entry</Content>
        {loadingChannels ? (
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <Spinner size="md" />
            <span style={{ marginLeft: '0.5rem' }}>Loading channels...</span>
          </div>
        ) : (
          <Form>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <FormGroup label="Release Channel" fieldId="add-channel-select">
                <Select
                  isOpen={channelOpen}
                  selected={selectedChannel}
                  onSelect={handleChannelSelect}
                  onOpenChange={(isOpen) => setChannelOpen(isOpen)}
                  toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
                    <MenuToggle
                      ref={toggleRef}
                      onClick={() => setChannelOpen(!channelOpen)}
                      isExpanded={channelOpen}
                      style={{ minWidth: '200px' }}
                    >
                      {selectedChannel ? `stable-${selectedChannel}` : 'Select a channel'}
                    </MenuToggle>
                  )}
                >
                  <SelectList>
                    {channels.map((channel) => (
                      <SelectOption key={channel} value={channel}>
                        {`stable-${channel}`}
                      </SelectOption>
                    ))}
                  </SelectList>
                </Select>
              </FormGroup>

              <FormGroup label="Patch Version" fieldId="add-patch-select">
                <Select
                  isOpen={patchOpen}
                  selected={selectedVersion}
                  onSelect={handlePatchSelect}
                  onOpenChange={(isOpen) => setPatchOpen(isOpen)}
                  toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
                    <MenuToggle
                      ref={toggleRef}
                      onClick={() => setPatchOpen(!patchOpen)}
                      isExpanded={patchOpen}
                      isDisabled={!selectedChannel || loadingPatches}
                      style={{ minWidth: '200px' }}
                    >
                      {selectedVersion ||
                        (loadingPatches
                          ? 'Loading...'
                          : selectedChannel
                          ? 'Select a version'
                          : 'Select a channel first')}
                    </MenuToggle>
                  )}
                >
                  <SelectList>
                    {patches.map((patch) => (
                      <SelectOption key={patch} value={patch}>
                        {patch}
                      </SelectOption>
                    ))}
                  </SelectList>
                </Select>
              </FormGroup>

              <Button
                variant="secondary"
                icon={<PlusCircleIcon />}
                onClick={handleAddChannel}
                isDisabled={!selectedChannel || !selectedVersion}
              >
                Add
              </Button>
            </div>

            {duplicateError && (
              <Alert variant="warning" title={duplicateError} isInline isPlain style={{ marginTop: '0.5rem' }} />
            )}
          </Form>
        )}
      </div>
    </div>
  );
};
